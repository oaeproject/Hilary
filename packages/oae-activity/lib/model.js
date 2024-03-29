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
import clone from 'clone';

import { ActivityConstants } from 'oae-activity/lib/constants.js';

/// /////////////
// SEED MODEL //
/// /////////////

/**
 * An Activity seed resource that can be used to locate a resource in the system that is associated to an activity. Intended
 * to be the most light-weight representation possible that provides enough data to gather more information from the system and
 * build an Activity Entity.
 *
 * @param  {String}    resourceType    The type of resource (user, comment, userProfile, etc...)
 * @param  {String}    resourceId      The ID of the resource
 * @param  {Object}    [resourceData]  A resourceType-specific blob of JSON data that provides more information needed to construct the Activity Object. For example, for a comment you may include the parent content object that you had at the time the comment was posted.
 */
const ActivitySeedResource = function (resourceType, resourceId, resourceData) {
  const that = {};
  that.resourceType = resourceType;
  that.resourceId = resourceId;
  that.resourceData = resourceData;
  return that;
};

/**
 * Create a standard activity seed resource from a resource. This implies that the resource type
 * will be that of the supplied resource, the resource id will be that of the supplied resource, and
 * the data will be an object keyed by the resource type, whose value is the resource itself
 *
 * @param  {Resource}               resource    The resource from which to create the activity seed resource
 * @return {ActivitySeedResource}               The activity seed resource, as described in the summary
 */
ActivitySeedResource.fromResource = function (resource) {
  return new ActivitySeedResource(resource.resourceType, resource.id, _.object([[resource.resourceType, resource]]));
};

/**
 * An Activity Seed object that can be used to produce all entities (actor, object, target) that were involved in an activity and
 * finally construct an Activity.
 *
 * @param  {String}                activityType        The type of activity that occurred. e.g., comment-post, content-update, etc...
 * @param  {Number}                published           The number of milliseconds since the epoch that this activity occurred
 * @param  {String}                verb                The action that was performed, as per the activity verb in the ActivityStrea.ms specification. See `ActivityConstants.verbs` for suppored verbs.
 * @param  {ActivitySeedResource}  actorResource       The Actor (i.e., user) that performed the activity
 * @param  {ActivitySeedResource}  [objectResource]    The Object on which the activity was performed
 * @param  {ActivitySeedResource}  [targetResource]    The Target resource of the activity, as recommended in the ActivityStrea.ms specification
 */
const ActivitySeed = function (activityType, published, verb, actorResource, objectResource, targetResource) {
  const that = {};
  that.activityType = activityType;
  that.published = published;
  that.verb = verb;
  that.actorResource = actorResource;
  that.objectResource = objectResource;
  that.targetResource = targetResource;
  return that;
};

/// /////////////////
// ACTIVITY MODEL //
/// /////////////////

/*!
 * The following is the OAE activity model which is 99% based on the activitystrea.ms JSON model specification:
 * http://activitystrea.ms/specs/json/1.0
 *
 * In additional the ActivityStrea.ms model, OAE makes some guarantees about what information will be available, including custom
 * activity attributes, which will be reflected and documented in this model specification.
 */

/**
 * An Activity media link model, based on the media link model: http://activitystrea.ms/specs/json/1.0/#media-link
 *
 * Represents a media item that can be used to represent an Object.
 *
 * @param  {String}    url         The url to the media item
 * @param  {Number}    [width]     The recommended width of the media item
 * @param  {Number}    [height]    The recommended height of the media item
 * @param  {Number}    [duration]  The length in seconds of the media item if it is time-based, such as audio or video
 */
const ActivityMediaLink = function (url, width, height, duration) {
  const that = {};
  that.url = url;
  that.width = width;
  that.height = height;
  that.duration = duration;
  return that;
};

/**
 * An activity that occurred.
 *
 * @param  {String}            oaeActivityType     The type of activity that occurred
 * @param  {String}            oaeActivityId       The unique ID of the activity
 * @param  {String}            verb                The action that was performend
 * @param  {Number}            published           The datetime that the activity occurred, in millis since the epoch
 * @param  {ActivityEntity}    actor               The actor Object that performed the action
 * @param  {ActivityEntity}    [object]            The object Object on which the action was performed
 * @param  {ActivityEntity}    [target]            The target Object of the activity, as described in the ActivityStrea.ms specification
 */
const Activity = function (oaeActivityType, oaeActivityId, verb, published, actor, object, target) {
  const that = {};
  that[ActivityConstants.properties.OAE_ACTIVITY_TYPE] = oaeActivityType;
  that[ActivityConstants.properties.OAE_ACTIVITY_ID] = oaeActivityId;
  that.verb = verb;
  that.published = published;
  that.actor = actor;
  that.object = object;
  that.target = target;
  return that;
};

/**
 * A very generic activity Entity model, based on the ActivityStrea.ms "Object" model specification. The local terminology of the ActivityStrea.ms
 * "Object" model is the "Entity" model. Entity is being used in place so as to not cause confusion with the "object" entity type, which
 * represents the entity on which an activity was performed.
 *
 * @param  {String}    objectType          The type of object / resourceType (e.g., user, content, etc...)
 * @param  {String}    id                  The ID of the object
 * @param  {String}    visibility          The visibility of the object
 * @param  {Object}    [opts]              Optional properties of the Object
 * @param  {String}    [opts.url]          The URL of the object
 * @param  {String}    [opts.displayName]  The display name of the object
 * @param  {MediaLink} [opts.image]        A media item that represents the object
 * @param  {String}    [opts.summary]      A rich-text (e.g., HTML) summary of the object
 * @param  {Number}    [opts.published]    Time in millis since the epoch when the object was published
 * @param  {Number}    [opts.created]      Time in millis since the epoch when the object was created
 * @param  {Object}    [opts.ext]          A hash of custom extension properties that will be overlayed onto the Object model
 */
const ActivityEntity = function (objectType, id, visibility, options) {
  options = options || {};
  const ext = options.ext || {};
  delete options.ext;
  return _.extend({}, ext, options, { objectType, id, 'oae:visibility': visibility });
};

/**
 * A stream of activities, as per the ActivityStrea.ms specification
 *
 * @param  {Activity[]}    activities  An array of activities to return
 * @param  {String}        nextToken   The value to provide when retrieving the next set of activities in the stream
 */
const ActivityStream = function (activities, nextToken) {
  return { items: activities, nextToken };
};

/// ///////////////
// ASSOCIATIONS //
/// ///////////////

/**
 * An association session is an object that can be used to access associations that are registered for activity entities by
 * type (see ActivityAPI#registerActivityEntityAssociation for more information). During the lifetime of the session, any
 * access to associations for an entity will become cached, such that subsequent calls will not make perform expensive
 * operations multiple times. This is important during the routing phase of activities since it is common for this to
 * happen.
 *
 * # Example
 *
 * ```javascript
 *  var associationsSession = new AssociationSession(ActivityRegistry.getRegisteredActivityEntityAssociations(), actor, object, target);
 *  var associationsContext = associationsSession.createAssociationsContext(actor.objectType, actor.id);
 *  associationsContext.get('followers', function(err, followers) {
 *      if (err) {
 *          return callback(err);
 *      }
 *
 *      _.each(followers, ...);
 *      ...
 *  });
 * ```
 *
 * @param  {Object}                 registeredAssociations  All the associations that are registered to the activity API as per ActivityRegistry#getRegisteredActivityEntityAssociations
 * @param  {Object}                 actor                   The persistent actor entity, as created by the entity producer
 * @param  {Object}                 object                  The persistent object entity, as created by the entity producer
 * @param  {Object}                 target                  The persistent target entity, as created by the entity producer
 * @return {AssociationsSession}                            The AssociationSession object that can be used to get the association context
 */
const AssociationsSession = function (registeredAssociations, actor, object, target) {
  // The associations session that will be returned as the result of this method
  const associationsSession = {};

  // A cache to hold associations that are fetched within the lifetime of this session
  const _associationsCache = {};

  // A hash to index what entities we actually know about
  const _knownEntities = {};

  if (actor) {
    _knownEntities[actor.objectType] = {};
    _knownEntities[actor.objectType][actor[ActivityConstants.properties.OAE_ID]] = actor;
  }

  if (object) {
    _knownEntities[object.objectType] = _knownEntities[object.objectType] || {};
    _knownEntities[object.objectType][object[ActivityConstants.properties.OAE_ID]] =
      _knownEntities[object.objectType][object[ActivityConstants.properties.OAE_ID]] || object;
  }

  if (target) {
    _knownEntities[target.objectType] = _knownEntities[target.objectType] || {};
    _knownEntities[target.objectType][target[ActivityConstants.properties.OAE_ID]] =
      _knownEntities[target.objectType][target[ActivityConstants.properties.OAE_ID]] || target;
  }

  /**
   * A method that can be used to fetch the associations of another entity in context
   *
   * @param  {String}     entityType              The type of entity whose association to fetch
   * @param  {String}     entityId                The id of the entity whose association to fetch
   * @param  {String}     associationName         The name of the association to fetch
   * @param  {Function}   callback                Standard callback function
   * @param  {Object}     callback.err            An error that occurred, if any
   * @param  {Object}     callback.association    The association. Usually a list of strings indicating ids, however can really be any value. Note that it cannot be used for routing purposes if it does not return an array of strings
   */
  associationsSession.getByEntityId = function (entityType, entityId, associationName, callback) {
    // If we have a cached entry, return it immediately
    const cachedAssociation =
      _associationsCache[entityType] &&
      _associationsCache[entityType][entityId] &&
      _associationsCache[entityType][entityId][associationName];
    if (cachedAssociation) {
      return callback(null, clone(cachedAssociation));
    }

    // If this association implementation does not exist for this entity type, return undefined
    const associationFunction =
      registeredAssociations[entityType] && registeredAssociations[entityType][associationName];
    if (!_.isFunction(associationFunction)) {
      return callback();
    }

    // Ensure the entity is actually a member of the session (i.e., is actor, object or target)
    const entity = _knownEntities[entityType] && _knownEntities[entityType][entityId];
    if (!entity) {
      return callback();
    }

    // Invoke the association function with the entity identified by type/id in context
    associationFunction(
      associationsSession.createAssociationsContext(entityType, entityId),
      entity,
      (error, association) => {
        if (error) return callback(error);

        if (!association) {
          /**
           * A successful but falsey association is simply treated as an empty result, as it cannot be confused with
           * the association (or context entity) not existing
           */
          association = [];
        }

        /**
         * Cache the association result. We plant an object with field association
         * so we can distinguish a cached `undefined` result from a non-existing cache entry
         */
        _associationsCache[entityType] = _associationsCache[entityType] || {};
        _associationsCache[entityType][entityId] = _associationsCache[entityType][entityId] || {};
        _associationsCache[entityType][entityId][associationName] = association;
        return callback(null, clone(association));
      }
    );
  };

  /**
   * Create a user-friendly association context that has access to the L1 session cache
   *
   * @param  {String}             entityType  The type of entity for which this association context was created
   * @param  {String}             entityId    The id of the entity for which this association context was created
   * @return {AssociationContext}             The association context, with method `get` and `getByEntityId` to get entity associations
   */
  associationsSession.createAssociationsContext = function (entityType, entityId) {
    // The associations context that will be the return value of this method
    const associationsContext = {};

    /*!
     * Get the parent associations session for this associations context
     *
     * @return {AssociationsSession}    The parent associationsSession
     */
    associationsContext.getSession = function () {
      return associationsSession;
    };

    /*!
     * A method that can be used to fetch the associations of the entity in context
     *
     * @param  {String}     associationName         The name of the association to fetch
     * @param  {Object}     callback.err            An error that occurred, if any
     * @param  {Object}     callback.association    The association. Usually a list of strings indicating ids, however can really be any value. Note that it cannot be used for routing purposes if it does not return an array of strings
     */
    associationsContext.get = function (associationName, callback) {
      return associationsContext.getSession().getByEntityId(entityType, entityId, associationName, callback);
    };

    return associationsContext;
  };

  return associationsSession;
};

export {
  ActivitySeedResource,
  ActivitySeed,
  ActivityMediaLink,
  Activity,
  ActivityEntity,
  ActivityStream,
  AssociationsSession
};
