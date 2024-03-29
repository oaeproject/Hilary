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

import _ from 'underscore';

import * as AuthzUtil from 'oae-authz/lib/util.js';

import { logger } from 'oae-logger';
import * as TenantsAPI from 'oae-tenants';

import { ActivityConstants } from 'oae-activity/lib/constants.js';
import * as ActivityRegistry from './registry.js';

const log = logger('oae-activity-push');

/**
 * Given an array of persistent activities from a stream, convert them into activities suitable to be delivered to the UI.
 *
 * @param  {Context}    ctx                 Current execution context
 * @param  {Object[]}   activities          The array of persistent activities to transform. These activities will be modified in-place. The specific model of each activity entity is proprietary to the custom producer and transformer that persist and convert the entities.
 * @param  {String}     [transformerType]   The type of transformer to retrieve. One of `ActivityConstants.transformerTypes`. Defaults to `activitystreams`
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const transformActivities = function (ctx, activities, transformerType, callback) {
  transformerType = transformerType || 'activitystreams';

  const activityEntitiesByObjectType = {};
  const transformedActivityEntitiesByObjectType = {};

  // Collect and index all the entities to be transformed by objectType -> activityId -> entityId
  try {
    for (const activity of activities) {
      const activityId = activity[ActivityConstants.properties.OAE_ACTIVITY_ID];
      _getActivityEntitiesByObjectType(activityId, activity.actor, activityEntitiesByObjectType);
      _getActivityEntitiesByObjectType(activityId, activity.object, activityEntitiesByObjectType);
      _getActivityEntitiesByObjectType(activityId, activity.target, activityEntitiesByObjectType);
    }
  } catch (error) {
    const logActivities = _.map(activities, (activity) => ({
      actor: activity.actor.id,
      object: activity.object.id,
      target: activity.target.id
    }));

    log().error({ error, activities: logActivities, user: ctx.user() }, 'Failed to get activity entities');
    throw error;
  }

  const objectTypes = _.keys(activityEntitiesByObjectType);
  let errorOccurred = null;
  let numberProcessed = 0;

  /*!
   * Handles the callback for when a set of entities for an object type have been transformed.
   */
  const _handleTransform = function (error, objectType, transformedActivityEntities) {
    if (errorOccurred) {
      // Do nothing because we've already err'd
      return;
    }

    if (error) {
      errorOccurred = error;
      return callback(error);
    }

    // Record the transformed entities
    transformedActivityEntitiesByObjectType[objectType] = transformedActivityEntities;

    numberProcessed++;
    if (numberProcessed === objectTypes.length) {
      _transformActivities(transformedActivityEntitiesByObjectType, activities);
      return callback();
    }
  };

  // Transform all entities of each object type and activity
  if (objectTypes.length > 0) {
    for (const objectType of objectTypes) {
      const transformer = _getEntityTypeTransformer(objectType, transformerType);
      transformer(ctx, activityEntitiesByObjectType[objectType], (error, transformedActivityEntities) => {
        if (error) return callback(error);

        // Ensure all transformed entities have at least the objectType and the oae:id
        for (const activityId of _.keys(transformedActivityEntities)) {
          for (const entityId of _.keys(transformedActivityEntities[activityId])) {
            if (!transformedActivityEntities[activityId][entityId].objectType) {
              transformedActivityEntities[activityId][entityId].objectType = objectType;
            }

            if (!transformedActivityEntities[activityId][entityId][ActivityConstants.properties.OAE_ID]) {
              transformedActivityEntities[activityId][entityId][ActivityConstants.properties.OAE_ID] = entityId;
            }

            // We only need the tenant information when transforming the entities into ActivityStrea.ms compliant entities
            if (transformerType === ActivityConstants.transformerTypes.ACTIVITYSTREAMS) {
              _addTenantInformationToActivityEntity(transformedActivityEntities[activityId][entityId]);
            }
          }
        }

        return _handleTransform(error, objectType, transformedActivityEntities);
      });
    }
  } else {
    return callback();
  }
};

/**
 * Get the activity entity transformer for a given object type and transformer type
 *
 * @param  {String}     objectType          The type of the entity for which to retrieve the transformer, ex: `user`, `group`, ...
 * @param  {String}     transformerType     The type of transformer to retrieve. One of `ActivityConstants.transformerTypes`
 * @return {Function}                       The activity entity transformer
 * @api private
 */
const _getEntityTypeTransformer = function (objectType, transformerType) {
  const activityEntityType = ActivityRegistry.getRegisteredActivityEntityTypes()[objectType] || {};
  const { transformer } = activityEntityType;
  if (_.isObject(transformer) && _.isFunction(transformer[transformerType])) {
    return transformer[transformerType];
  }

  if (_.isFunction(transformer)) {
    return transformer;
  }

  return _defaultActivityEntityTransformer;
};

/**
 * Categorize the given entity into the appropriate {objectType -> activityId} location of the activityEntitiesByObjectType
 * object. If the given entity is actually a collection of entities, they will all be collected individually and stored on the
 * activityEntitiesByObjectType object as well.
 *
 * The returned `activityEntitiesByObjectType` parameter is a deep hash that looks like the following:
 *
 * ```javascript
 *  {
 *      '<objectType0>': {
 *          '<activityId0>': {
 *              '<entityId0>': { <Persistent Entity> },
 *              ...
 *          },
 *          ...
 *      },
 *      ..
 *  }
 * ```
 * Or, more concretely:
 *
 * ```javascript
 *  {
 *      'user': {
 *          '123456789:PTweoiru': {
 *             'u:oae:JKeojwd_': { <User Entity> },
 *             'u:oae:NFi_df-': { <User Entity> }
 *          },
 *          '123456787:Dfwiuvq': { <User Entity> }
 *      },
 *      'content': {
 *          '123456789:PTweoiru': {
 *              'c:oae:UyeODow7': { <Content Entity> },
 *          }
 *      },
 *      'group': {
 *          '123456787:Dfwiuvq': { <Group Entity> }
 *      }
 *  }
 * ```
 *
 * @param  {String}    activityId                      The ID of the activity to which the entity belongs
 * @param  {Object}    entity                          The persistent entity that should be categorized into the activityEntitiesByObjectType object
 * @param  {String}    entity.objectType               The objectType of the entity, as specified by the ActivityStrea.ms Object objectType definition
 * @param  {Object}    activityEntitiesByObjectType    An object of: objectType -> activityId -> entityId -> persistentEntity that holds the categorized entities of all the activities in a stream request
 * @api private
 */
const _getActivityEntitiesByObjectType = function (activityId, entity, activityEntitiesByObjectType) {
  if (entity && entity.objectType !== 'collection') {
    _collectStuff(activityEntitiesByObjectType, entity, activityId);
  } else if (entity) {
    // This is actually a collection of more entities. Iterate and collect them.
    for (const eachEntity of entity[ActivityConstants.properties.OAE_COLLECTION]) {
      _collectStuff(activityEntitiesByObjectType, eachEntity, activityId);
    }
  }
};

const _collectStuff = (activityEntities, entity, activityId) => {
  activityEntities[entity.objectType] = activityEntities[entity.objectType] || {};
  activityEntities[entity.objectType][activityId] = activityEntities[entity.objectType][activityId] || {};
  activityEntities[entity.objectType][activityId][entity[ActivityConstants.properties.OAE_ID]] = entity;
};

/**
 * Transform all the activities into activities that can be displayed in an activity stream. This involves replacing all top-level
 * entities (e.g., actor, object, target) in the activities with those that have been transformed by the transformers.
 *
 * @param  {Object}    transformedActivityEntitiesByObjectType     An object of: objectType -> activityId -> entityId -> transformedEntity that holds the categorized entities of all the activities in a stream request
 * @param  {Object[]}  activities                                  A list of raw activities to be delivered in a stream. These activities are to be transformed by this method such that they may be delivered to the UI
 * @api private
 */
const _transformActivities = function (transformedActivityEntitiesByObjectType, activities) {
  for (const activity of activities) {
    const activityId = activity[ActivityConstants.properties.OAE_ACTIVITY_ID];
    activity.actor = _transformEntity(transformedActivityEntitiesByObjectType, activityId, activity.actor);
    activity.object = _transformEntity(transformedActivityEntitiesByObjectType, activityId, activity.object);
    activity.target = _transformEntity(transformedActivityEntitiesByObjectType, activityId, activity.target);
  }
};

/**
 * Transform the given entity with the data in transformedActivityEntitiesByObjectType.
 *
 * @param  {Object}    transformedActivityEntitiesByObjectType     An object of: objectType -> activityId -> entityId -> transformedEntity that holds the categorized entities of all the activities in a stream request
 * @param  {String}    activityId                                  The ID of the activity to which the entity belongs
 * @param  {Object}    entity                                      The persistent activity entity that should be transformed with the transformed entities object
 * @api private
 */
const _transformEntity = function (transformedActivityEntitiesByObjectType, activityId, entity) {
  if (!entity) {
    return entity;
  }

  const entityId = entity[ActivityConstants.properties.OAE_ID];
  if (entity.objectType !== 'collection') {
    return transformedActivityEntitiesByObjectType[entity.objectType][activityId][entityId];
  }

  const transformedCollection = [];
  for (const collectionEntity of entity[ActivityConstants.properties.OAE_COLLECTION]) {
    const transformedEntity = _transformEntity(transformedActivityEntitiesByObjectType, activityId, collectionEntity);
    if (transformedEntity) {
      transformedCollection.push(transformedEntity);
    }
  }

  entity[ActivityConstants.properties.OAE_COLLECTION] = transformedCollection;
  return entity;
};

/**
 * By default, a transformation can just pick the oae:id and the objectType of an entity when delivering to an activity stream.
 *
 * For more information on these parameters, please @see #registerActivityEntityTransformer
 * @api private
 */
const _defaultActivityEntityTransformer = function (ctx, activityEntities, callback) {
  const transformedEntities = {};
  _.each(activityEntities, (entities, activityId) => {
    transformedEntities[activityId] = transformedEntities[activityId] || {};
    _.each(entities, (entity, entityKey) => {
      // Pick just the objectType and the oae:id of the entity for the transformed entity.
      transformedEntities[activityId][entityKey] = _.pick(entity, 'objectType', ActivityConstants.properties.OAE_ID);
    });
  });

  return callback(null, transformedEntities);
};

/**
 * Adds the compact tenant information to those activity entities that are OAE entities.
 * The tenant information will be placed in an 'oae:tenant' key.
 *
 * @param  {ActivityEntity}  [entity]  The entity or the collection of entities to add the tenant information to.
 * @api private
 */
const _addTenantInformationToActivityEntity = function (entity) {
  if (entity) {
    // If the entity is a single entity, apply the tenant information
    if (entity[ActivityConstants.properties.OAE_ID]) {
      const { tenantAlias } = AuthzUtil.getResourceFromId(entity[ActivityConstants.properties.OAE_ID]);
      const tenant = TenantsAPI.getTenant(tenantAlias);
      if (tenant) {
        entity[ActivityConstants.properties.OAE_TENANT] = tenant.compact();
      }

      // If the entity is a collection of entities, iterate over each one and apply the tenant information
    } else if (entity[ActivityConstants.properties.OAE_COLLECTION]) {
      _.each(entity[ActivityConstants.properties.OAE_COLLECTION], _addTenantInformationToActivityEntity);
    }
  }
};

export { transformActivities };
