/*!
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import { format } from 'node:util';

import {
  is,
  equals,
  pipe,
  filter,
  keys,
  difference,
  reject,
  and,
  mergeRight,
  length,
  forEach,
  values,
  union,
  not,
  either,
  prop,
  defaultTo,
  isEmpty,
  forEachObjIndexed
} from 'ramda';

import { isUserId, isGroupId, getResourceFromId, isEmail } from 'oae-authz/lib/util.js';
import { logger } from 'oae-logger';
import { telemetry } from 'oae-telemetry';
import * as TenantsUtil from 'oae-tenants/lib/util.js';

import { ActivityConstants } from 'oae-activity/lib/constants.js';
import * as ActivityModel from 'oae-activity/lib/model.js';
import { createActivityStreamId } from 'oae-activity/lib/util.js';
import ActivityEmitter from './emitter.js';
import * as ActivityRegistry from './registry.js';
import * as ActivitySystemConfig from './config.js';

import { createActivityId, saveQueuedActivities } from './dao.js';
import { getBucketNumber } from './buckets.js';

const { NOTIFICATION, EMAIL } = ActivityConstants.streams;

const STREAM_TYPE = 'streamType';

const differs = pipe(equals, not);
const defaultToEmptyArray = defaultTo([]);
const defaultToEmptyObject = defaultTo({});
const compact = reject(pipe(Boolean, not));
const aintAFunction = pipe(is(Function), not);
const aintArray = pipe(is(Array), not);
const streamTypeIsNotification = pipe(prop(STREAM_TYPE), equals(NOTIFICATION));
const streamTypeIsEmail = pipe(prop(STREAM_TYPE), equals(EMAIL));

const log = logger('oae-activity-router');
const Telemetry = telemetry('activity');

/**
 * Produce, route and queue an activity from an activity seed.
 *
 * @param  {ActivitySeed}  activitySeed        The activity seed that was used to post the activity
 * @param  {Function}      [callback]          Invoked when the process completes
 * @param  {Object}        [callback.err]      An error that occurred, if any
 */
const routeActivity = function (activitySeed, callback) {
  callback = defaultTo((error) => {
    if (error) {
      log().error({ err: error, activitySeed }, 'Error handling activity');
    }
  })(callback);

  log().trace({ activitySeed }, 'Routing activity seed');

  // Record the amount of time the activity sat in the message queue before routing began
  Telemetry.appendDuration('mq.time', activitySeed.published);
  const routingStartTime = Date.now();

  // Produce all of the activity entities
  _produceAllEntities(activitySeed, (error, actor, object, target) => {
    if (error) {
      log().error({ err: error, activitySeed }, 'An error occurred when producing the entities for an activity seed');
      return callback(error);
    }

    // Produce the routes from the actor, object and target entities
    _produceAllRoutes(activitySeed, actor, object, target, (error, routes) => {
      if (error) {
        log().error({ err: error, activitySeed }, 'An error occurred when producing the routes for an activity seed');
        return callback(error);
      }

      // If no routes were generated then we're done
      if (isEmpty(routes)) return callback();

      /**
       * A hash that maps: {resourceId -> streamType -> activity} for each
       * routed destination of an activity
       */
      const allRoutedActivities = {};

      /**
       * A hash that maps {activityId -> activity} for each
       * activity that will be delivered to a persistent activity stream
       */
      const allDeliveredActivities = {};

      // Generate an ID for this activity
      const activityId = createActivityId(activitySeed.published);

      // Create the routed activities
      forEach((route) => {
        // Create the activity metadata
        const activity = {};
        activity[ActivityConstants.properties.OAE_ACTIVITY_TYPE] = activitySeed.activityType;
        activity[ActivityConstants.properties.OAE_ACTIVITY_ID] = activityId;
        activity.verb = activitySeed.verb;
        activity.published = activitySeed.published;

        if (actor) {
          activity.actor = actor;
        }

        if (object) {
          activity.object = object;
        }

        if (target) {
          activity.target = target;
        }

        // Index all routed activities by their id and stream type
        allRoutedActivities[route.resourceId] = allRoutedActivities[route.resourceId] || {};
        allRoutedActivities[route.resourceId][route.streamType] = activity;

        // Select the activities that are not part of a transient route so they can be stored
        let activityStreamId = null;
        if (!route.transient) {
          activityStreamId = createActivityStreamId(route.resourceId, route.streamType);
          allDeliveredActivities[activityStreamId] = activity;
        }

        // Do some visibility bucketing if the stream requires it
        const stream = ActivityRegistry.getRegisteredActivityStreamType(route.streamType);
        if (stream && stream.visibilityBucketing) {
          /**
           * Determine if all the entities in the activity are public
           * so we can safely route to public activity streams
           */
          if (_canRouteToPublicStream(actor, object, target)) {
            /**
             * If we're routing to a user who is also the actor of the activity we
             * will also route the activity to the public activitystream of the user
             */
            if (isUserId(route.resourceId) && route.resourceId === actor.id) {
              allRoutedActivities[route.resourceId][route.streamType + '#public'] = activity;
              if (!route.transient) {
                activityStreamId = createActivityStreamId(route.resourceId, route.streamType + '#public');
                allDeliveredActivities[activityStreamId] = activity;
              }
            }

            // If a group is involved in a public activity we route the activity to the group's public activity stream
            const publicGroupEntity = _getGroupEntity(actor, object, target);
            if (publicGroupEntity) {
              allRoutedActivities[publicGroupEntity.id] = defaultToEmptyObject(
                allRoutedActivities[publicGroupEntity.id]
              );
              allRoutedActivities[publicGroupEntity.id][route.streamType + '#public'] = activity;

              if (not(route.transient)) {
                activityStreamId = createActivityStreamId(publicGroupEntity.id, route.streamType + '#public');
                allDeliveredActivities[activityStreamId] = activity;
              }
            }
          }

          /**
           * Determine if all the entities in the activity are public or loggedin
           * so we can safely route to loggedin activity streams
           */
          if (_canRouteToLoggedinStream(actor, object, target)) {
            /**
             * If we're routing to a user who is also the actor of the activity we
             * will also route the activity to the loggedin activitystream of the user
             */
            if (isUserId(route.resourceId) && route.resourceId === actor.id) {
              allRoutedActivities[route.resourceId][route.streamType + '#loggedin'] = activity;
              if (not(route.transient)) {
                activityStreamId = createActivityStreamId(route.resourceId, route.streamType + '#loggedin');
                allDeliveredActivities[activityStreamId] = activity;
              }
            }

            // If a group is involved in a loggedin activity we route the activity to the group's loggedin activity stream
            const loggedinGroupEntity = _getGroupEntity(actor, object, target);
            if (loggedinGroupEntity) {
              allRoutedActivities[loggedinGroupEntity.id] = defaultToEmptyObject(
                allRoutedActivities[loggedinGroupEntity.id]
              );
              allRoutedActivities[loggedinGroupEntity.id][route.streamType + '#loggedin'] = activity;

              if (not(route.transient)) {
                activityStreamId = createActivityStreamId(loggedinGroupEntity.id, route.streamType + '#loggedin');
                allDeliveredActivities[activityStreamId] = activity;
              }
            }
          }
        }
      }, routes);

      log().trace({ activitySeed, allRoutedActivities }, 'Finished routed activities');

      // Queue the activity entities to be collected and aggregated
      _queueActivities(activitySeed, allDeliveredActivities, (error_) => {
        if (error_) return callback(error_);

        // Emit an event for the routed activities
        ActivityEmitter.emit(ActivityConstants.events.ROUTED_ACTIVITIES, allRoutedActivities);

        // The number of activities that were handled
        Telemetry.incr('count');

        // How many routed activities are created and how long it took
        Telemetry.incr('routed.count', length(values(allDeliveredActivities)));
        Telemetry.appendDuration('routing.time', routingStartTime);
        return callback();
      });
    });
  });
};

/**
 * Produce activity entities based on the actor, object and target resources of the given activity seed.
 *
 * @param  {ActivitySeed}      activitySeed                The activity seed from which to extract the actor, object and target resource information
 * @param  {Function}          callback                    Standard callback function
 * @param  {Object}            callback.err                An error that occurred, if any
 * @param  {ActivityEntity}    callback.actor              The actor activity entity
 * @param  {ActivityEntity}    [callback.object]           The object activity entity, if one was specified
 * @param  {ActivityEntity}    [callback.target]           The actor activity entity, if one was specified
 * @api private
 */
const _produceAllEntities = function (activitySeed, callback) {
  _produceEntity(activitySeed.actorResource, (error, actor) => {
    if (error) return callback(error);

    _produceEntity(activitySeed.objectResource, (error, object) => {
      if (error) return callback(error);

      _produceEntity(activitySeed.targetResource, (error, target) => {
        if (error) return callback(error);

        return callback(null, actor, object, target);
      });
    });
  });
};

/**
 * Produce an activity entity with the given seed resource information.
 *
 * @param  {ActivitySeedResource}  resource                The activity resource that was used to seed the activity
 * @param  {Function}              callback                Standard callback function
 * @param  {Object}                callback.err            An error that occurred, if any
 * @param  {ActivityEntity}        callback.activityEntity The activity entity that was produced
 * @api private
 */
const _produceEntity = function (resource, callback) {
  if (not(resource)) return callback();

  // Find the producer for this resource type. If there isn't one registered, we fall back to the default producer
  const activityEntityType = defaultToEmptyObject(
    ActivityRegistry.getRegisteredActivityEntityTypes()[resource.resourceType]
  );
  const producer = defaultTo(_defaultActivityEntityProducer, activityEntityType.producer);

  producer(resource, (error, entity) => {
    if (error) return callback(error);

    // Ensure a valid resource id and resource type
    entity = defaultToEmptyObject(entity);
    entity.objectType = resource.resourceType;
    entity[ActivityConstants.properties.OAE_ID] = resource.resourceId;

    log().trace(
      {
        resource,
        entity
      },
      'Produced activity entity.'
    );

    return callback(null, entity);
  });
};

/**
 * Produce the routes for the given actor, object and target activity entities.
 *
 * @param  {ActivitySeed}   activitySeed                The activity seed that was used to post the activity
 * @param  {ActivityEntity} actor                       The actor entity that was produced for the activity
 * @param  {ActivityEntity} [object]                    The object entity that was produced for the activity
 * @param  {ActivityEntity} [target]                    The target entity that was produced for the activity
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object[]}       callback.routes             The routes for the activitySeed. Each route is an object containing the `resourceId` and `streamType` for the activity. It will also include whether or not the stream is transient
 * @api private
 */
const _produceAllRoutes = function (activitySeed, actor, object, target, callback) {
  log().trace(
    {
      activitySeed,
      actorEntity: actor,
      objectEntity: object,
      targetEntity: target
    },
    'Producing routes for activity entities.'
  );

  const associationsSession = new ActivityModel.AssociationsSession(
    ActivityRegistry.getRegisteredActivityEntityAssociations(),
    actor,
    object,
    target
  );
  const activityConfig = ActivityRegistry.getRegisteredActivityTypes()[activitySeed.activityType];

  // If this is an unknown activity entity, we can't route it as we don't know how
  if (not(activityConfig)) return callback(null, []);

  const actorRouteConfig = _getRouterConfigForObjectType(activityConfig, ActivityConstants.entityTypes.ACTOR);
  const objectRouteConfig = _getRouterConfigForObjectType(activityConfig, ActivityConstants.entityTypes.OBJECT);
  const targetRouteConfig = _getRouterConfigForObjectType(activityConfig, ActivityConstants.entityTypes.TARGET);

  /**
   * Create the associations context primed for each entity.
   * All these contexts are created with the same associations session,
   * which means access to the same association for the same entity will not
   * duplicate queries to the database within this routing session
   */
  const associationsContexts = {
    actor: associationsSession.createAssociationsContext(actor.objectType, actor[ActivityConstants.properties.OAE_ID]),
    object: object
      ? associationsSession.createAssociationsContext(object.objectType, object[ActivityConstants.properties.OAE_ID])
      : null,
    target: target
      ? associationsSession.createAssociationsContext(target.objectType, target[ActivityConstants.properties.OAE_ID])
      : null
  };

  // Route the actor entity
  _produceRoutes(associationsContexts.actor, actor, actorRouteConfig, (error, actorRoutes) => {
    if (error) return callback(error);

    // Route the object entity
    _produceRoutes(associationsContexts.object, object, objectRouteConfig, (error, objectRoutes) => {
      if (error) return callback(error);

      // Route the target entity
      _produceRoutes(associationsContexts.target, target, targetRouteConfig, (error, targetRoutes) => {
        if (error) return callback(error);

        // Determine the propagation rules for the actor
        _producePropagation(associationsContexts.actor, actor, (error, actorPropagationRules) => {
          if (error) return callback(error);

          // Determine the propagation rules for the object
          _producePropagation(associationsContexts.object, object, (error, objectPropagationRules) => {
            if (error) return callback(error);

            // Determine the propagation rules for the target
            _producePropagation(associationsContexts.target, target, (error, targetPropagationRules) => {
              if (error) return callback(error);

              /**
               * The list of routes unioned represents all the routes the activity "wants" to be routed to.
               * We will need to further filter this list down to those that the propagation rules specify
               * it is "allowed" to be routed to based on the individual entity propagation rules
               */
              const allRoutes = pipe(
                union([...objectRoutes, ...targetRoutes]),
                compact,
                filter((route) => {
                  if (either(streamTypeIsNotification, streamTypeIsEmail)(route)) {
                    // If this is a notification or email route, we can only accept users other than the actor
                    const isPrincipalRoute = either(isUserId, isEmail)(route.resourceId);
                    const resourceIdAintTheActor = differs(
                      actor[ActivityConstants.properties.OAE_ID],
                      route.resourceId
                    );
                    return and(isPrincipalRoute, resourceIdAintTheActor);
                  }

                  // This route is not a notification or email, we need to include it so we can apply propagation on it
                  return true;
                })
              )(actorRoutes);

              // First filter down the routes by the actor propagation
              _applyPropagations(
                {
                  objectType: ActivityConstants.entityTypes.ACTOR,
                  propagations: actorPropagationRules,
                  routes: allRoutes,
                  associationsContexts,
                  entity: actor,
                  entityRoutes: actorRoutes
                },
                (error, includedRoutes) => {
                  if (error) return callback(error);

                  // No routes survived the actor propagation, simply return the empty array
                  if (isEmpty(includedRoutes)) return callback(null, []);

                  // Further filter routes down by object propagation
                  _applyPropagations(
                    {
                      objectType: ActivityConstants.entityTypes.OBJECT,
                      propagations: objectPropagationRules,
                      routes: includedRoutes,
                      associationsContexts,
                      entity: object,
                      entityRoutes: objectRoutes
                    },
                    (error, includedRoutes) => {
                      if (error) return callback(error);

                      // No routes survived the object propagation, simply return the empty array
                      if (isEmpty(includedRoutes)) return callback(null, []);

                      // Further filter routes down by target propagation
                      _applyPropagations(
                        {
                          objectType: ActivityConstants.entityTypes.TARGET,
                          propagations: targetPropagationRules,
                          routes: includedRoutes,
                          associationsContexts,
                          entity: target,
                          entityRoutes: targetRoutes
                        },
                        (error, includedRoutes) => {
                          if (error) return callback(error);

                          // Return the final list of routes
                          return callback(null, includedRoutes);
                        }
                      );
                    }
                  );
                }
              );
            });
          });
        });
      });
    });
  });
};

/**
 * Given the entities of an activity, return whether the
 * activity can be routed to a public activity stream
 *
 * @param  {ActivityEntity}     actor       The actor entity that was produced for the activity
 * @param  {ActivityEntity}     object      The object entity that was produced for the activity
 * @param  {ActivityEntity}     [target]    The target entity that was produced for the activity
 * @return {Boolean}                        `true` if the activity can be routed to the actor's public activity stream
 * @api private
 */
const _canRouteToPublicStream = function (actor, object, target) {
  return (
    actor['oae:visibility'] === 'public' &&
    (!object || object['oae:visibility'] === 'public') &&
    (!target || target['oae:visibility'] === 'public')
  );
};

/**
 * Given the entities of an activity, return whether the
 * activity can be routed to a loggedin activity stream
 *
 * @param  {ActivityEntity}     actor       The actor entity that was produced for the activity
 * @param  {ActivityEntity}     object      The object entity that was produced for the activity
 * @param  {ActivityEntity}     [target]    The target entity that was produced for the activity
 * @return {Boolean}                        `true` if the activity can be routed to the actor's loggedin activity stream
 * @api private
 */
const _canRouteToLoggedinStream = function (actor, object, target) {
  return (
    (actor['oae:visibility'] === 'public' || actor['oae:visibility'] === 'loggedin') &&
    (!object || object['oae:visibility'] === 'public' || object['oae:visibility'] === 'loggedin') &&
    (!target || target['oae:visibility'] === 'public' || target['oae:visibility'] === 'loggedin')
  );
};

/**
 * Given the entities of an activity, return the entity that is a group
 *
 * @param  {ActivityEntity}     actor       The actor entity that was produced for the activity
 * @param  {ActivityEntity}     object      The object entity that was produced for the activity
 * @param  {ActivityEntity}     [target]    The target entity that was produced for the activity
 * @return {ActivityEntity}                 The entity that is a group or `null` if no group entity was found
 * @api private
 */
const _getGroupEntity = function (actor, object, target) {
  if (object && isGroupId(object.id)) {
    return object;
  }

  if (target && isGroupId(target.id)) {
    return target;
  }

  return null;
};

/**
 * Trim the given list of routes down by the propagation rules. If the entity is not specified, we simply indicate all routes survived as the
 * entity is simply not defined (e.g., it is an activity that had no target, and this is determining propagation of the target)
 *
 * @param  {String}                 objectType                      The type of activity object (as enumerated by ActivityConstants.entityTypes) whose propagation is to be applied
 * @param  {Object[]}               propagations                    The list of propagation rules to define how to trim down the list of routes
 * @param  {String[]}               routes                          The list of routes to filter according to propagation rules
 * @param  {Object}                 associationsContexts            An object containing the associations contexts for the actor, object and target entities
 * @param  {AssociationsContext}    associationsContexts.actor      The associations context for the actor entity
 * @param  {AssociationsContext}    [associationsContexts.object]   The associations context for the object entity. `null` if there is no object
 * @param  {AssociationsContext}    [associationsContexts.target]   The associations context for the target entity. `null` if there is no target
 * @param  {Object}                 entity                          The persistent entity, as produced by the entity producer, whose propagation to apply
 * @param  {String[]}               entityRoutes                    The routes that have been specified by the entity router
 * @param  {Function}               callback                        Standard callback function
 * @param  {Object}                 callback.err                    An error that occurred, if any
 * @param  {String[]}               callback.includedRoutes         The routes to which the propagation rules indicate are safe to receive the entity
 * @param  {String[]}               callback.excludedRoutes         The routes to which the propagation rules indicate are unsafe to receive the entity
 * @api private
 */
const _applyPropagations = function (data, callback, _includeRoutes, _excludeRoutes) {
  const { objectType, propagations, routes, associationsContexts, entity, entityRoutes } = data;
  if (!entity) return callback(null, routes, []);

  /**
   * Seed the _includeRoutes and _excludeRoutes, such that by default all routes are excluded.
   * As we go through the propagations chain, routes are added to the includes list as they are determined to be safe
   */
  _includeRoutes = _includeRoutes || [];
  _excludeRoutes = _excludeRoutes || routes;
  // We have exhausted the list of propagation rules, return the result
  if (isEmpty(propagations)) return callback(null, _includeRoutes, _excludeRoutes);

  const propagation = propagations.shift();
  _applyPropagation(
    objectType,
    propagation,
    _excludeRoutes,
    associationsContexts,
    entity,
    entityRoutes,
    (error, includeRoutes, excludeRoutes) => {
      if (error) {
        log().warn({ err: error, propagation, entity }, 'There was an error applying a propagation rule for an entity');
      } else {
        _includeRoutes = union(_includeRoutes, includeRoutes);
        _excludeRoutes = excludeRoutes;
      }

      /** If there are no more routes to exclude, then we have included all.
       * There is no value in looking at more propagationrules in this chain as we've already included them all
       */
      if (isEmpty(excludeRoutes)) return callback(null, _includeRoutes, _excludeRoutes);

      // There are still more routes to try and include. Continue shifting through the propagation rules chain
      return _applyPropagations(
        {
          objectType,
          propagations,
          routes,
          associationsContexts,
          entity,
          entityRoutes
        },
        callback,
        _includeRoutes,
        _excludeRoutes
      );
    }
  );
};

/**
 * Trim the given list of routes down by the given propagation rule
 *
 * @param  {String}                 objectType                      The type of activity object (as enumerated by ActivityConstants.entityTypes) whose propagation is to be applied
 * @param  {Object}                 propagation                     The propagation rule that defines how to trim down the list of routes
 * @param  {String[]}               routes                          The list of routes to filter according to propagation rule
 * @param  {Object}                 associationsContexts            An object containing the associations contexts for the actor, object and target entities
 * @param  {AssociationsContext}    associationsContexts.actor      The associations context for the actor entity
 * @param  {AssociationsContext}    [associationsContexts.object]   The associations context for the object entity. `null` if there is no object
 * @param  {AssociationsContext}    [associationsContexts.target]   The associations context for the target entity. `null` if there is no target
 * @param  {Object}                 entity                          The persistent entity, as produced by the entity producer, whose propagation to apply
 * @param  {String[]}               entityRoutes                    The routes that have been specified by the entity router
 * @param  {Function}               callback                        Standard callback function
 * @param  {Object}                 callback.err                    An error that occurred, if any
 * @param  {String[]}               callback.includedRoutes         The routes to which the propagation rule indicates are safe to receive the entity
 * @param  {String[]}               callback.excludedRoutes         The routes to which the propagation rule indicates are unsafe to receive the entity
 * @api private
 */
const _applyPropagation = function (
  objectType,
  propagation,
  routes,
  associationsContexts,
  entity,
  entityRoutes,
  callback
) {
  entityRoutes = entityRoutes || [];

  const entityId = entity[ActivityConstants.properties.OAE_ID];
  const entityTenantAlias = getResourceFromId(entityId).tenantAlias;

  const includedRoutes = [];
  const excludedRoutes = [];

  /*!
   * Apply an association to the given routes, populating the `includedRoutes` and `excludedRoutes` arrays with routes from
   * the `routes` array according to who the association determines can and cannot receive the entity
   *
   * @param  {AssociationsContext}    associationsCtx     The associations context from which to apply the specified association
   * @param  {String}                 associationName     The name of the association to apply
   * @param  {Function}               callback            Standard callback function
   * @param  {Error}                  callback.err        An error that occurred, if any
   */
  const _applyAssociationsCtx = function (associationsCtx, associationName, callback) {
    associationsCtx.get(associationName, (error, associations) => {
      if (error) {
        log().warn({ err: error, association: associationName }, 'An error occurred while applying associations');
      }

      // Index the entity associations into a hash to make the next loop O(n) instead of O(n^2)
      const associationRoutesHash = {};
      forEach((associationRoute) => {
        associationRoutesHash[associationRoute] = true;
      }, defaultToEmptyArray(associations));

      // Split the routes into those who are in the entity associations and those who are not
      forEach((route) => {
        if (associationRoutesHash[route.resourceId]) {
          includedRoutes.push(route);
        } else {
          excludedRoutes.push(route);
        }
      }, routes);

      return callback();
    });
  };

  // Include all the routes
  if (propagation.type === ActivityConstants.entityPropagation.ALL) return callback(null, routes, []);

  if (propagation.type === ActivityConstants.entityPropagation.TENANT) {
    // Split the routes into those in the same tenant, and those in other tenants
    forEach((route) => {
      const routeTenantAlias = getResourceFromId(route.resourceId).tenantAlias;
      if (routeTenantAlias === entityTenantAlias) {
        includedRoutes.push(route);
      } else {
        excludedRoutes.push(route);
      }
    }, routes);

    return callback(null, includedRoutes, excludedRoutes);
  }

  if (propagation.type === ActivityConstants.entityPropagation.INTERACTING_TENANTS) {
    // Split the routes into those who can interact with the entity's tenant, and those who cannot
    forEach((route) => {
      const routeTenantAlias = getResourceFromId(route.resourceId).tenantAlias;
      if (TenantsUtil.canInteract(entityTenantAlias, routeTenantAlias)) {
        includedRoutes.push(route);
      } else {
        excludedRoutes.push(route);
      }
    }, routes);

    return callback(null, includedRoutes, excludedRoutes);
  }

  if (propagation.type === ActivityConstants.entityPropagation.ROUTES) {
    // Index the entity routes into a hash to make the next loop O(n) instead of O(n^2)
    const entityRoutesHash = {};
    forEach((entityRoute) => {
      entityRoutesHash[entityRoute.resourceId] = true;
    }, entityRoutes);

    // Split the routes into those who are in the entity routes and those who are not
    forEach((route) => {
      if (entityRoutesHash[route.resourceId]) {
        includedRoutes.push(route);
      } else {
        excludedRoutes.push(route);
      }
    }, routes);

    return callback(null, includedRoutes, excludedRoutes);
  }

  switch (propagation.type) {
    // Apply the "self" association of the item
    case ActivityConstants.entityPropagation.SELF: {
      _applyAssociationsCtx(associationsContexts[objectType], 'self', (error) => {
        if (error) return callback(error);

        return callback(null, includedRoutes, excludedRoutes);
      });

      break;
    }

    // Apply the specified association of the item
    case ActivityConstants.entityPropagation.ASSOCIATION: {
      _applyAssociationsCtx(associationsContexts[objectType], propagation.association, (error) => {
        if (error) return callback(error);

        return callback(null, includedRoutes, excludedRoutes);
      });

      break;
    }

    case ActivityConstants.entityPropagation.EXTERNAL_ASSOCIATION: {
      /*!
       * Apply a specified association that is of an entity that is external to the item itself. This is useful
       * in situations where an item you have access to has been impacted by an item that you do not have access
       * to in an activity. It is useful for you to still receive the activity, even though more basic propagation
       * may indicate that you don't have access. For example:
       *
       *  * UserA is the manager of ContentA, but not a member of private GroupB
       *  * UserB adds ContentA to the library of GroupB
       *  * This generates activity "content-share" with an {actor, object, target} of {UserB, ContentA, GroupB}
       *  * UserA should receive this activity since they are a manager of ContentA, but theoretically they don't
       *    have access to GroupB
       *
       * For this case, we actually do want to deliver the activity to UserA's activity feed. This is not necessarily
       * a privacy breach, because UserA is now able to discover GroupB VIA the members list of ContentA. To express
       * this relationship, EXTERNAL_ASSOCATION can be used on groups to indicate:
       *
       *  "The 'managers' association of the 'object' entity of an activity is allowed to receive the group as an activity"
       *
       * Thus, the "managers" of ContentA will be in the propagation list of GroupB since ContentA is the "object" entity
       * of the activity.
       */

      const externalAssociationsCtx = associationsContexts[propagation.objectType];
      // There is no entity that is of this object type (e.g., no object or no target), therefore we apply no inclusions
      if (not(externalAssociationsCtx)) return callback(null, [], routes);

      _applyAssociationsCtx(externalAssociationsCtx, propagation.association, (error) => {
        if (error) return callback(error);

        return callback(null, includedRoutes, excludedRoutes);
      });

      break;
    }

    default: {
      return callback(new Error(format('Received invalid propagation type "%s"', propagation.type)));
    }
  }
};

/**
 * Determine the propagation rules for the given entity
 *
 * @param  {AssociationsContext}    associationsCtx         The associations context with the persistent entity in context
 * @param  {Object}                 entity                  The persistent entity, as created by the entity producer, for which to produce the propagation rules
 * @param  {Function}               callback                Standard callback function
 * @param  {Object}                 callback.err            An error that occurred, if any
 * @param  {Object[]}               callback.propagations   The list of propagation rules to define where the entity is allowed to be routed. See ActivityAPI#registerActivityEntityType for more information on propagation rules
 * @api private
 */
const _producePropagation = function (associationsCtx, entity, callback) {
  if (not(entity)) return callback();

  const entityTypeConfig = ActivityRegistry.getRegisteredActivityEntityTypes()[entity.objectType];
  if (not(entityTypeConfig) || aintAFunction(entityTypeConfig.propagation)) {
    return callback(null, [{ type: ActivityConstants.entityPropagation.ROUTES }]);
  }

  entityTypeConfig.propagation(associationsCtx, entity, callback);
};

/**
 * Produce the routes for the activity entity based on the routing configuration of the activity that is applied to this entity
 *
 * @param  {AssociationsContext}    associationsctx                 The associations context for the provided entity
 * @param  {Object}                 entity                          The entity, as produced by the entity producer, to route
 * @param  {Object[]}               routeConfig                     The route configuration for this entity
 * @param  {Function}               callback                        Standard callback function
 * @param  {Object}                 callback.err                    An error that occurred, if any
 * @param  {Object[]}               callback.routes                 The routes derived from the routers. Each route is an object indicating if it's `transient` or not, what `streamType` it's part of and the `resourceId` it's intended for
 * @api private
 */
const _produceRoutes = function (associationsCtx, entity, routeConfig, callback) {
  if (not(entity) || isEmpty(routeConfig)) return callback(null, []);

  const routes = [];

  /*!
   * Recursively produce the routes for the activity entity based on the routing configuration of the activity that is applied to this entity
   */
  const routeStreamAssociations = function () {
    if (isEmpty(routeConfig)) {
      log().trace({ entity, routes }, 'Generated routes for activity entity');
      return callback(null, routes);
    }

    const stream = routeConfig.pop();
    _routeAssociations(associationsCtx, [...stream.associationNames], (error, streamRoutes) => {
      if (error) return callback(error);

      // Collect the routes for this stream
      forEach((streamRoute) => {
        routes.push({
          resourceId: streamRoute,
          streamType: stream.streamType,
          transient: stream.transient
        });
      }, streamRoutes);

      routeStreamAssociations();
    });
  };

  routeStreamAssociations();
};

/**
 * Execute the given associations on the context, aggregating the results into an array. Note this method will
 * modify the provided `associationNames` array, so copy it if you need it afterward
 *
 * @param  {AssociationsContext}    associationsCtx     The associations context on which to execute the associations
 * @param  {String[]}               associationNames    The names of the associations to execute
 * @param  {Function}               callback            Standard callback function
 * @param  {Object}                 callback.err        An error that occurred, if any
 * @param  {String[]}               callback.routes     The aggregated routes from all associations
 * @api private
 */
const _routeAssociations = function (associationsCtx, associationNames, callback, _routes) {
  _routes = defaultToEmptyArray(_routes);
  if (isEmpty(associationNames)) return callback(null, _routes);

  // Pick off the next association
  let associationName = associationNames.shift();

  // If an association name starts with an `^` character, it should be used to exclude routes
  let exclusionAssociation = false;
  if (associationName.charAt(0) === '^') {
    exclusionAssociation = true;

    // Remove the ^-character from the association name
    associationName = associationName.slice(1);

    /**
     * TODO: There is potential for a slight optimization here.
     * If the collected routes so far (_routes array) is empty, there is nothing to exclude
     * and we could skip executing the association and move on to the next one.
     */
  }

  associationsCtx.get(associationName, (error, associations) => {
    if (error) {
      log().warn({ err: error }, 'Error fetching association "%s"', associationName);
    } else if (associations && aintArray(associations)) {
      log().warn('Ignoring using association "%s" as a route which returns a non-array object', associationName);
    } else if (associations) {
      _routes = exclusionAssociation ? difference(_routes, associations) : union(_routes, associations);
    }

    return _routeAssociations(associationsCtx, associationNames, callback, _routes);
  });
};

/**
 * Get the routers from the activity config for a particular object type (i.e., actor, object, target)
 *
 * @param  {Object}     activityConfig      The activity configuration object registered using ActivityAPI#registerActivityType
 * @param  {String}     objectType          The object type whose routers to fetch. One of: actor, object, target
 * @return {Object[]}                       An array of objects in which each object represents a stream. Each object has a `streamType` key which holds the name of the stream, a `transient` key which indicates if this stream should result in transient activities and an `associationNames` key which lists the associations
 */
const _getRouterConfigForObjectType = function (activityConfig, objectType) {
  const routerConfig = [];
  const noStreams = pipe(prop('streams'), not);
  const noActivityConfig = not;

  if (either(noActivityConfig, noStreams)(activityConfig)) return routerConfig;

  forEachObjIndexed((streamConfig, streamType) => {
    if (streamConfig.router && streamConfig.router[objectType]) {
      routerConfig.push({
        streamType,
        associationNames: streamConfig.router[objectType],
        transient: streamConfig.transient
      });
    }
  }, activityConfig.streams);

  return routerConfig;
};

/**
 * An entity producer that simply returns the resource data as the persistent entity
 *
 * @see #registerActivityEntityType for parameter details in the `producer` option.
 * @api private
 */
// Simply return the resourceData. If no resource data was specified, the router will just default to an empty object
const _defaultActivityEntityProducer = function (resource, callback) {
  return callback(null, mergeRight({}, resource.resourceData));
};

/**
 * Queue the given set of routed activities for collection.
 *
 * @param  {ActivitySeed}  activitySeed        The activity seed from which the activities were generated.
 * @param  {Object}        routedActivities    An object whose value is the activity to deliver, where the key is the route to which the activity should be delivered.
 * @param  {Function}      callback            Standard callback function
 * @param  {Object}        callback.err        An error that occurred, if any
 * @param  {Number[]}      callback.buckets    The collection buckets that received activities as a result of this invocation
 * @api private
 */
const _queueActivities = function (activitySeed, routedActivities, callback) {
  const allRoutes = keys(routedActivities);
  const activityBuckets = [];

  // Assign all activities to their processing buckets to support safe concurrency
  for (const route of allRoutes) {
    const bucketNumber = _getBucketNumber(route, activitySeed);
    activityBuckets[bucketNumber] = activityBuckets[bucketNumber] || [];
    activityBuckets[bucketNumber].push({ route, activity: routedActivities[route] });
  }

  /**
   * Queue the aggregates into their associated buckets to
   * indicate they need to be collected and delivered
   */
  saveQueuedActivities(activityBuckets, (error) => {
    if (error) {
      log().error({ err: error, activitySeed }, 'Could not save the queued activities for an activity seed');
      return callback(error);
    }

    // Log telemetry for each bucket. Important to monitor for "hot buckets"
    forEach((bucket, bucketNumber) => {
      // eslint-disable-next-line unicorn/explicit-length-check
      if (bucket && bucket.length) {
        Telemetry.incr('routed.' + bucketNumber + '.count', bucket.length);
      }
    }, activityBuckets);

    return callback(null, keys(activityBuckets));
  });
};

/**
 * Get the bucket number in which a routed activity should be queued. Bucket numbers are chosen to ensure that routed activities
 * that need to be collected in serial (e.g., only one process should collect them at a time) always land in the same bucket (i.e.,
 * because buckets are only collected by one process at one time).
 *
 * The selection is based on a hash of the route and activity type, since all routed activities of the same route and activity type
 * exhert race conditions when aggregating and replacing activities in feeds. When taking into consideration global "public" and
 * "loggedin" routes (not implemented yet, but likely implemented later), it's important to ensure we don't have "hot buckets".
 * Currently it is expected that the bucket that holds the most common activity (e.g., "content-share") of the public route will be
 * the most common bucket, so if that one fills faster than can be collected by a single process, it may be necessary to further
 * discriminate based on other factors, such as characteristics of the aggregate keys.
 *
 * By "characteristics of the aggregate keys", it should be possible to find one identifier that is common in all potential pivot
 * points of the activity. For "content-share", it is the actor, so we could include the ID of the actor in the hash for those
 * types of activities, which should further distribute activities such as "content-share" in the public route. This is not
 * implemented yet as it is not known to be necessary, especially as global public / loggedin routes are not implemented.
 *
 * More information about the race conditions in aggregating activities, please see the documentation in
 * `oae-activity/lib/internal/aggregator.js`.
 *
 * @param  {String}        route           The string of the route.
 * @param  {ActivitySeed}  activitySeed    The activity seed from which the activity seed is being generated.
 * @return {Number}                        The bucket number in which to queue the activity for processing.
 * @api private
 */
const _getBucketNumber = function (route, activitySeed) {
  const numberOfBuckets = ActivitySystemConfig.getConfig().numberOfProcessingBuckets;
  return getBucketNumber(route + activitySeed.activityType, numberOfBuckets);
};

export { routeActivity };
