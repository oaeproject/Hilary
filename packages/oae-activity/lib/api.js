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
import * as async from 'async';

import * as AuthzUtil from 'oae-authz/lib/util';
import * as LibraryAuthz from 'oae-library/lib/api.authz';
import { logger } from 'oae-logger';
import * as OAE from 'oae-util/lib/oae';
import * as OaeUtil from 'oae-util/lib/util';
import * as PrincipalsUtil from 'oae-principals/lib/util';
import * as Redis from 'oae-util/lib/redis';
import { Validator as validator } from 'oae-authz/lib/validator';

const {
  getNestedObject,
  makeSureThat,
  otherwise,
  isLoggedInUser,
  isUserId,
  isPrincipalId,
  isNotEmpty,
  isANumber,
  isObject
} = validator;

import pipe from 'ramda/src/pipe';
import isIn from 'validator/lib/isIn';

import { setUpConfig } from 'oae-config';
import { ActivityConstants } from 'oae-activity/lib/constants';
import { ActivityStream } from 'oae-activity/lib/model';
import * as MQ from 'oae-util/lib/mq';
import ActivityEmitter from './internal/emitter';
import * as ActivityEmail from './internal/email';
import * as ActivityNotifications from './internal/notifications';
import * as ActivityRegistry from './internal/registry';
import * as ActivityRouter from './internal/router';
import * as ActivitySystemConfig from './internal/config';
import * as ActivityTransformer from './internal/transformer';
import * as ActivityDAO from './internal/dao';
import * as ActivityAggregator from './internal/aggregator';

const log = logger('oae-activity-api');
const ActivityConfig = setUpConfig('oae-activity');

// Keeps track of whether or not the activity processing handler has been bound to the task queue
let boundWorker = false;

// Keeps track of the collection polling timer so that it may be cleared if activity processing is disabled
let collectionPollingTimer = null;

// Keeps track of the mail polling timer so that it may be cleared if mail processing is disabled
let mailPollingTimer = null;

/**
 * ## ActivityAPI
 *
 * ### Events
 *
 *  * `deliveredActivities(activities)` - Indicates activities have just been aggregated and delivered to an activity stream. The individual (unaggregated) persistent activities are provided
 *  * `getActivityStream(ctx, activityStreamId, start, limit, transformerType, activities) - Indicates that an activity stream has been retrieved
 *  * `resetAggregation(activityStreamIds) - Indicates that aggregation has been reset for a set of activity streams
 *  * `routedActivities(activities)` - Indicates that activities have been routed
 *  * `updatedUser(ctx, newUser, oldUser) - Indicates that a user updated his email preferences
 */

/**
 * Refresh the activities configuration.
 *
 * @param  {Object}     [config]        The object containing the configuration properties. See the `config.activity` object in the base `./config.js` for more information
 * @param  {Function}   [callback]      Invoked when the configuration has been refreshed
 * @param  {Object}     [callback.err]  An error that occurred, if any
 */
const refreshConfiguration = function(config, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err }, 'Error refreshing activities configuration');
      }
    };

  config = ActivitySystemConfig.refreshConfiguration(config);

  log().info({ config }, 'Refreshing activity configuration');

  // Configure redis. Either uses the main connection pool, or a dedicated one if config.activity.redis was configured
  let redisClient = Redis.getClient();
  if (config.redis) {
    redisClient = Redis.createClient(config.redis);
  }

  ActivityDAO.init(redisClient);

  // Reset the collection polling interval
  clearInterval(collectionPollingTimer);
  if (config.processActivityJobs && config.collectionPollingFrequency > 0) {
    const collectionPollingFrequencyInMs = config.collectionPollingFrequency * 1000;
    // Delegate to the aggregator to collect/aggregate all buckets
    collectionPollingTimer = setInterval(ActivityAggregator.collectAllBuckets, collectionPollingFrequencyInMs);
  }

  // Reset the mail polling interval
  clearInterval(mailPollingTimer);
  if (config.processActivityJobs && config.mail.pollingFrequency > 0) {
    const mailPollingFrequencyInMs = config.mail.pollingFrequency * 1000;
    // Collect and send email
    mailPollingTimer = setInterval(ActivityEmail.collectAllBuckets, mailPollingFrequencyInMs);
  }

  // Enable / Disable the worker binding, if necessary
  if (config.processActivityJobs && !boundWorker) {
    boundWorker = true;
    // Bind directly to the `routeActivity` router method
    return MQ.subscribe(ActivityConstants.mq.TASK_ACTIVITY, ActivityRouter.routeActivity, callback);
  }

  if (!config.processActivityJobs && boundWorker) {
    boundWorker = false;
    return MQ.unsubscribe(ActivityConstants.mq.TASK_ACTIVITY, callback);
  }

  return callback();
};

/*!
 * When the system starts shutting down, we want to stop the collecting polling timer so that no new collections
 * begin during the grace-time for active work to complete.
 */
OAE.registerPreShutdownHandler('oae-activity', null, callback => {
  log().info('Clearing the activity collection poller');
  clearInterval(collectionPollingTimer);
  return callback();
});

/**
 * Registers an activity stream type and its options with the application
 *
 * @param  {String}     activityStreamType                          The name of the stream that will be registered. e.g., activity, notification, message, etc...
 * @param  {Object}     options                                     The options for this stream
 * @param  {Boolean}    [options.transient]                         If `true`, activities in this stream will only be routed and fire push events to the client, however it will not be aggregated and will not be persisted into a stream in the database. Default: `false`
 * @param  {Object}     [options.push]                              A set of options for modifying the behaviour of push notifications on the stream
 * @param  {Object}     [options.push.delivery]                     Indicates at which activity delivery phase(s) activities should be pushed to the client
 * @param  {String}     [options.push.delivery.phase]               Indicates when a single activity should be pushed to the client. One of `routing` or `aggregation`. Defaults to `routing`
 * @param  {Boolean}    [options.visibilityBucketing]               If `true`, activities with only public entities will also be routed to `<activityStreamType>-public`, public and loggedin entities will also be routed to `<activityStreamType>-loggedin`
 * @param  {Function}   options.authorizationHandler                A function that can be used to perform an authorization check to see if a user has access to this stream
 * @param  {Context}    options.authorizationHandler.ctx            The current request context
 * @param  {String}     options.authorizationHandler.resourceId     The resource the user wishes to see the activity stream for
 * @param  {Object}     [options.authorizationHandler.token]        A token that can be used to perform the authorization check, if this is `null` the check should be based on the `Context` and the `resourceId`
 * @param  {Function}   options.authorizationHandler.callback       Standard callback function that should be executed once the authorization check has completed
 * @param  {Object}     options.authorizationHandler.callback.err   An error object. If the user is not authorized to access this stream, a 401 error should be returned
 * @throws {Error}                                                  An error is thrown if an activity stream was already registered under this name
 */
const registerActivityStreamType = function(activityStreamType, options) {
  ActivityRegistry.registerActivityStreamType(activityStreamType, options);
};

/**
 * Get the options for an activity stream type
 *
 * @param  {String}     activtyStreamType   The name of the stream for which to retrieve the options
 * @return {Object}                         The options for the stream
 */
const getRegisteredActivityStreamType = function(activtyStreamType) {
  return ActivityRegistry.getRegisteredActivityStreamType(activtyStreamType);
};

/**
 * Registers an activity type with the application. While not all activities that are posted are required to be registered here,
 * this is how special activity behaviour, such as aggregation pivot points, may be specified.
 *
 * # `options.groupBy`
 *
 * The groupBy option allows the ability control how an activity is aggregated in an activity feed. It takes an array of objects
 * that specify all the "pivot points" on which activity entities will be collected. If an activity has no pivot points configured
 * for it with this option, then the activity will never aggregate and collect. However it will still be protected from duplicates
 * that occur within the aggregation window, by updating the existing activity and moving it to the top of the feed as the most
 * recent activity. Following are some configuration examples.
 *
 * ## Example 1
 *
 * ```javascript
 *  options.groupBy = [
 *      {
 *          'actor': true,
 *          'object': true
 *      }
 *  ];
 * ```
 *
 * This option specifies that if multiple activities of this type are delivered to a route that share the same "actor" and "object"
 * entity, they will be rolled up into one activity, where the "target" is a collection of the different targets involves in the
 * two activities. For example:
 *
 * Activity #1: Branden shared Syllabus with GroupA
 * Activity #2: Branden shared Syllabus with UserB
 *
 * If those activities are delivered to the same route within a configurable window of time, they will be grouped together as
 * something like "Branden shared syllabus with 2 users and groups".
 *
 * ## Example 2
 *
 * ```javascript
 *  options.groupBy = [
 *      {
 *          'actor': true,
 *          'object': true
 *      },
 *      {
 *          'actor': true,
 *          'target': true
 *      }
 *  ];
 * ```
 *
 * In this scenario, an activity will be pivoted on TWO different combinations of entities: actor+object and actor+target. This
 * enables the ability to maintain 2 separate aggregation branches for the activity. For example:
 *
 * Activity #1: Branden shared Syllabus with GroupA
 * Activity #2: Branden shared Syllabus with GroupB
 * Activity #3: Branden shared Introduction with Group A
 *
 * If those activities are delivered to the same route within a configurable window of time, they will be grouped together and
 * delivered as 2 separate aggregate activities (instead of the 3 activities):
 *
 * Aggregate #1: Branden shared 2 items with Group A
 * Aggregate #2: Branden shared Syllabus with 2 users and groups
 *
 * # `options.streams`
 *
 * The `streams` option allows one to configure what streams should receive the activity based on the actor, object and target of the
 * activity. The array of strings expected for each router specification (see params) indicates the name of an association (as
 * registered for that entity type) to use to derive the routes. All routes from all specified associations will be unioned
 * together in order to find the final list of routes. However, if an association is prefixed with the `^` character, its results will
 * not be unioned, but will be excluded from the previously collected results. Note that the ordering of this exclusion-association
 * in the router configuration is therefore important.
 *
 * Activity routing is *not* tied to solely users or groups. It's perfectly acceptable to route activities to other resources such
 * as content items items or discussions by adding the `self` association. This is how push notifications for those kind of resources work.
 *
 * The full list of routes combined between actor, object and target will make the entire list of routes to which the activity will
 * be delivered. Note that in order to protect resources from being delivered to unprivileged users, there is also the notion of
 * `propagation` (@see #registerActivityEntityType), which will ultimiately restrict to which routes an activity may be delivered.
 *
 * ## Example - Router configuration
 *
 * Lets say when a user adds another user to a group (actor: user1, object: principal2, target: group1), you might have a streams
 * configuration like this:
 *
 * ```javascript
 *  options.streams = {
 *      'activity': {
 *          'router': {
 *              'actor': ['self', 'followers'],
 *              'object': ['self', 'members', 'followers'],
 *              'target': ['self', 'members']
 *          }
 *      },
 *      'notification': {
 *          'router': {
 *              'object': ['self'],
 *              'target': ['managers']
 *          },
 *          'email': {
 *                'email': true,
 *                'emailTemplateModule': 'oae-principals',
 *                'emailTemplateId': 'notify-group-add-member'
 *          }
 *      }
 *  }
 * ```
 *
 * In this routing configuration, the `actor` configuration says that the actor user themself along with all of their followers
 * should receive the activity. The `object` configuration indicates that the group/user should receive an activity as well as the
 * members and the followers. Since `object` can be either user or group, obviously users don't have "members", so if it the
 * `object` is a group, the non-existing association will be ignored. The same goes for groups who don't have followers (yet?). For
 * notifications, the `object` entity (user or group) itself will receive a notification, though group notifications will be
 * filtered out as that is not implemented, similarly, all managers of the `target` group will receive a notification about the
 * activity. The `notification` stream is the only stream who can add a special `email` object.
 *
 * Example - Association exclusion
 *
 * Lets say you want to notify all the managers of a piece of a collaborative document (object) except for the authors that are
 * currently online:
 *
 * ```javascript
 * options.streams = {
 *      'notification': {
 *          'router': {
 *              'object': ['managers', '^online-authors']
 *          }
 *      }
 *  }
 * ```
 *
 * In this routing configuration, the `object` configuration states that the managers of the collaborative document should be retrieved
 * and the online authors should be excluded from the result. Note that switching the parameters will give different results.
 *
 * ```javascript
 *    ...
 *    'object': ['^online-authors', 'managers']
 *    ...
 * ```
 *
 * In this routing configuration, we would exclude the online authors from the empty set, followed by adding all the managers.
 * The net result is that a notification would be sent to *all* managers.
 *
 * @param  {String}         activityType                                                The type of activity to register
 * @param  {Object}         options                                                     The options which specify how the activities of this type behave
 * @param  {Object[]}       [options.groupBy]                                           An array of objects which specify on which entities to pivot to activate activity aggregates. If not specified, the activity will not aggregate
 * @param  {Object}         options.streams                                             An object containing the routing and other options for each stream
 * @param  {Object}         options.streams[streamType]                                 An object describing the routing and other options for the stream as defined by `streamType`. `streamType` should be one of the streamTypes that was useed in #registerActivityStream. ex: `activity`, `notification`, `message`, ...
 * @param  {Object}         options.streams[streamType].router                          The routers that will route this activity among the stream routes, at least one of its children needs to be defined
 * @param  {String[]}       [options.streams[streamType].router.actor]                  A list of association names whose results (relative to the actor entity) will be combined to form the routes for this stream
 * @param  {String[]}       [options.streams[streamType].router.object]                 A list of association names whose results (relative to the object entity) will be combined to form the routes for this stream
 * @param  {String[]}       [options.streams[streamType].router.target]                 A list of association names whose results (relative to the target entity) will be combined to form the routes for this stream
 * @param  {Object}         [options.streams[notification].email                        The `notification` stream is currently the only stream that supports sending out e-mail
 * @param  {Boolean}        [options.streams[notification].email.email]                 Whether or not a notification for this activity should send an email
 * @param  {String}         [options.streams[notification].email.emailTemplateModule]   If sending an email, the module where the email template for this notification resides
 * @param  {String}         [options.streams[notification].email.emailTemplateId]       If sending an email, the id for the email template
 * @throws {Error}                                                                      If a set of options are already registered for the `activityType` or the options contain invalid data
 */
const registerActivityType = function(activityType, options) {
  ActivityRegistry.registerActivityType(activityType, options);
};

/**
 * Registers an activity entity type with the system. The custom behaviour defined for an activity entity type are discussed in
 * this appropriately long comment block.
 *
 *
 * # Producer
 *
 * The activity entity producer is responsible for gathering the data that will be necessary to transform it into an ActivityEntity
 * when an activity feed is requested. This model is persisted into the stream, and the "transformer" will be responsible for
 * taking this data and converting it into the ActivityEntity object that is suitable to be displayed in the activity stream.
 *
 * For example, when someone posts a comment on a content item, an activity (content-comment) is generated. When displaying the
 * activity in the stream, it is useful to have additional context associated with the comment, such as its parent, if any. The
 * producer becomes useful because it can fetch the comment that was posted as well as its parent to be persisted directly into
 * the activity feed (denormalization). So when the activity stream is requested, multiple queries are not required to fetch
 * this information about the activity each time. The activity entity "transformer" is then provided this data to generate the
 * appropriate ActivityStrea.ms model when requested by a client.
 *
 * The astute reader will notice that there is no "user context" to take into consideration here. This is because permissions are
 * not taken into consideration at this stage. The release of the data passed on by the producer is controlled by `propagation` and
 * further more by the `transformer` if appropriate. See those blocks for additional details.
 *
 *
 * # Transformer
 *
 * The entity transformer is responsible for taking the entity data that was produced by the activity entity producer, and generating
 * the ActivityEntity for the current request. Since this transformer is invoked for every entity for every activity stream request,
 * it is important to do as little heavy-lifting here as possible, and rather defer as much work to the producer as possible, as the
 * data is only produced once per activity.
 *
 * The `activityEntities` parameter is a breakdown of all the entities of the appropriate `resourceType` in the current set of
 * activities being transformed. This object is structured like so:
 *
 * ```javascript
 * {
 *      'activityId0': {
 *          'resourceId0': { <Produced Entity Data> },
 *          'resourceId1': { <Produced Entity Data> }
 *      },
 *      'activityId1': {
 *          'resourceId0': { <Produced Entity Data> },
 *          'resourceId2': { <Produced Entity Data> },
 *          'resourceId3': { <Produced Entity Data> }
 *      }
 * }
 * ```
 *
 * Similarly, the `transformedActivityEntities` that are returned by the transformer are in the same format, except the
 * <Produced Entity Data> would be replaced with the <Transformed Entity>.
 *
 * Why is the entity data discriminated by activity id *and* resource id? It is technically possible for an entity in one activity
 * to have data that is different than an entity in another entity, even if it has the same id. Some reasons for this:
 *
 *  *   The producer produces data based on a particular activityType and entityType (actor, object, target), therefore it may have
 *      chosen to include different data based on what is relevant for that particular context
 *  *   Since entities are stored in a denormalized way in the activity, they are not updated when the entity data changes over
 *      time. Therefore, a newer activity may have a more recent version of the entity.
 *
 * So, if we don't keep transformed entities keyed by the activity to which they belong, we can end up overwriting entity data in
 * other activities.
 *
 * The `<Transformed Entity>` should be a JavaScript object complient with the activitystrea.ms model: http://activitystrea.ms/. In
 * addition to the core properties there, there are some agreed-upon extension properties which can be found in
 * `ActivityConstants.properties`. You are free to create your own extension properties as well as needed, but please prefix them
 * with "oae:". Here is an example of a transformed group:
 *
 * ```javascript
 *  {
 *      "oae:id": "g:camtest:group-PTqTgCydcBf",
 *      "oae:thumbnail": {
 *          "url": "/path/to/thumbnail.png",
 *          "width": 32,
 *          "height": 32
 *      },
 *      "oae:visibility": "public",
 *      "oae:joinable": "no",
 *      "displayName": "group-PTqTgCydcBf",
 *      "url": "http://tenant.host.com/group/g:camtest:group-PTqTgCydcBf",
 *      "image": {
 *          "url": "/path/to/image.png",
 *          "width": 162,
 *          "height": 162
 *      },
 *      "objectType": "group",
 *      "id": "http://tenant.host.com/api/group/g:camtest:group-PTqTgCydcBf"
 *  }
 * ```
 *
 * It is required that you provide two transformers. One for providing activitystrea.ms compliant data and one that can be used internally.
 *
 *
 * # Propagation
 *
 * Propagation is responsible for, given an entity, determine who is allowed to receive this entity in their activity stream. This
 * happens once per activity during the routing phase in order to narrow the list of routes down to a subset of users/groups who
 * are indeed permissible to receive the entity. There are several different "types" of propagation that can be used to describe how
 * entities may be released to streams, as enumerated by `ActivityConstants.entityPropagation`:
 *
 *  * "all"                 - Indicates that *all* users and groups can see this entity. Common for resources whose visibility is `public`
 *  * "tenant"              - Indicates that only users and groups that belong to the same tenant as the entity can see it. Common for
 *                            resources whose visibility is "loggedin"
 *  * "interacting_tenants" - Indicates that only users and groups that belong to a tenant that can "interact" with the tenant to which
 *                            the entity belongs can see this entity. Common in situations when you have a resource who is configured to
 *                            be joinable (e.g., a group manager sets the group to be joinable) but it is also private. We can indicate
 *                            with this propagation type that the group can be released so that others may discover and join it, however
 *                            only to those users who are admissible to join it (i.e., those whose tenants can interact with it)
 *  * "routes"              - The default. Indicates that only the users / groups who have been specified as routes for the entity may
 *                            receive this entity
 *  * "association"         - Indicates that the result of a particular association may receive this entity. Useful to indiciate that only
 *                            members of a private item may receive it. This propagation type must be accompanied with a property
 *                            "association" indicating the name of the assocation that should provide the list of user and group ids
 *  * "self"                - Indicates that only the entity or the entities specified by the "self" association can receive this
 *
 * Since the result of the `propagation` function is an *array* of propagations, this gives us flexibility to specify multiple ways the
 * item is allowed to be propagated, such that they are "unioned" / combined with "OR" semantics. For the common case of a "loggedin"
 * resource, it is useful to say "only users of this tenant, or those who are members are allowed receive this resource". This can be
 * expressed with a propagation array of:
 *
 * ```json
 *  [
 *      {
 *          "type": "tenant"
 *      },
 *      {
 *          "type": "association",
 *          "association": "members"
 *      }
 *  ]
 * ```
 *
 * So that users who belong to a different tenant, but have been granted explicit access to the resource, can receive the activity that
 * holds the entity.
 *
 * @param  {String}                 activityEntityType                                          The name of the entity type to register
 * @param  {Object}                 [options]                                                   The options specifying the custom entity type functionality
 * @param  {Function}               [options.producer]                                          The implementation of the entity producer (see comment summary for more information). If unspecified, the `resourceData` of the ActivitySeedResource will simply be used as the produced persistent entity
 * @param  {ActivitySeedResource}   [options.producer.resource]                                 The activity seed resource that was created for the entity when the activity was fired using `ActivityAPI.postActivity`
 * @param  {Function}               [options.producer.callback]                                 Standard callback function. The producer must fire this with the produced entity when complete
 * @param  {Object}                 [options.producer.err]                                      An error that occurred while producing the entity, if any
 * @param  {Object}                 [options.producer.entity]                                   The produced persistent activity entity that will be persisted to the routes
 * @param  {Object}                 [options.transformer]                                       The object containing the transformer implementations of the entity transformer (see comment summary for more information). If unspecified, only the `objectType` and `oae:id` of the produced entity will be used as the transformed entity. You should provide a transformer for activitystrea.ms compliant data (keyed by `activitystreams`) and one for internal usage (keyed by `internal)
 * @param  {Context}                [options.transformer[type].ctx]                             The API context in which the current request is being performed. Contains the current authenticated user (if any) and the current tenant
 * @param  {Object}                 [options.transformer[type].entities]                        The persistent activity entities (as produced by the producer) to transform to a model suitable for the UI. See the method summary for the expected format of this object
 * @param  {Function}               [options.transformer[type].callback]                        Standard callback function. The transformer must fire this with the transformed entities when complete
 * @param  {Object}                 [options.transformer[type].callback.err]                    An error that occurred while transforming the entities, if any
 * @param  {Object}                 [options.transformer[type].callback.transformedEntities]    The transformed entities. See the method summary for the expected format of these entities
 * @param  {Function}               [options.propagation]                                       The function that determines for an entity how it should be propagated among potential routes (see comment summary for more information). If unspecified, the propagation for entities of this type will default to `ActivityConstants.entityPropagation.ROUTES`
 * @param  {AssociationsContext}    [options.propagation.associations]                          The associations object with which registered associations for the activity entity type can be accessed. Associations for this entity are registered separately and pluggable by other modules. See ActivityAPI#registerActivityEntityAssociation for more information
 * @param  {Object}                 [options.propagation.entity]                                The persistent activity entity (as produced by the producer) whose propagation rules to determine
 * @param  {Function}               [options.propagation.callback]                              Standard callback function. The propagation function must fire this with the array of propagation rules when it has completed
 * @param  {Object}                 [options.propagation.callback.err]                          An error that occurred while determining the propagation rules, if any
 * @param  {Object[]}               [options.propagation.callback.propagation]                  The array of propagation rules to apply to the entity. For more information on the format of these objects, see the method summary
 */
const registerActivityEntityType = function(activityEntityType, options) {
  ActivityRegistry.registerActivityEntityType(activityEntityType, options);
};

/**
 * Registers an association for an activity entity type. The association should return some value that can be used either by a router, or
 * by an ad-hoc `associationsCtx.get` or `associationsSession.getByEntityId` call. There 2 benefits of using named associations over simply
 * fetching data from their APIs in different areas (should note that the *implementation* of the association provided here will indeed
 * fetch data from the respective API):
 *
 *  1.  By providing a simple name to refer to the association, routing then becomes a matter of configuration, rather than a complex
 *      implementation that is duplicated across different activity types; and
 *  2.  By managing the access of the associations in the associations session, we can create an L1 cache that will store the result
 *      of each named association per entity in local memory until the routing session is complete. This ultimately allows us to
 *      split the process of propagation and routing which was previously combined in order to optimize the number of queries to the
 *      db during routing
 *
 * Note that to be useful in the context of routing, the association will need to return an array of strings (i.e., routes). However,
 * assocations can be created that return other values (e.g., String, Number, Object) in an ad-hoc way for use in other ways, such as
 * determining propagation or to derive other associations. A good example of this is the "members-by-role" association registered by
 * the content module.
 *
 * @param  {String}                 activityEntityType                          The type of entity for which to register this association
 * @param  {String}                 associationName                             The name of the association to register. Will be accessed by this name using the assocations context: `associationsCtx.get('associationName', ...)`
 * @param  {Function}               associationFunction                         The function to register that fetches the associated ids
 * @param  {AssociationsContext}    associationFunction.associationsCtx         The associations context that can be used to help derive this new association
 * @param  {Object}                 associationFunction.entity                  The persistent activity entity, as produced by the entity producer for this entity type
 * @param  {Function}               associationFunction.callback                Standard callback function. The association function must fire this with the association when it has completed its process
 * @param  {Object}                 associationFunction.callback.err            An error that occurred, if any
 * @param  {Array|Object}           associationFunction.callback.association    The result of the association. To be useful as a route, this should be an array of strings, however other data structures can be provided as well for ad-hoc operations using the associations context directly
 */
const registerActivityEntityAssociation = function(activityEntityType, associationName, associationFunction) {
  ActivityRegistry.registerActivityEntityAssociation(activityEntityType, associationName, associationFunction);
};

/**
 * Get the activity stream for a principal
 *
 * @param  {Context}            ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}             principalId             The ID of the user for which the activity stream should be retrieved
 * @param  {String}             [start]                 Determines the point at which activities are returned for paging purposes.  If not provided, the first x elements will be returned
 * @param  {Number}             [limit]                 The maximum number of activities to return. Default: 25
 * @param  {String}             [transformerType]       The type of transformer with which the activities should be transformed. One of `ActivityConstants.transformerTypes`. If left null, this will default to `ActivityConstants.transformerTypes.ACTIVITYSTREAMS`
 * @param  {Function}           callback                Standard callback function
 * @param  {Object}             callback.err            An error that occurred, if any
 * @param  {ActivityStream}     callback.activities     The activity stream containing the requested set of activities
 */
const getActivityStream = function(ctx, principalId, start, limit, transformerType, callback) {
  transformerType = transformerType || ActivityConstants.transformerTypes.ACTIVITYSTREAMS;

  try {
    pipe(
      isIn,
      otherwise({
        code: 400,
        msg: 'Unknown activity transformer type'
      }),
      makeSureThat(true, principalId, isPrincipalId),
      otherwise({
        code: 400,
        msg: 'You can only view activity streams for a principal'
      })
    )(transformerType, _.values(ActivityConstants.transformerTypes));
  } catch (error) {
    return callback(error);
  }

  limit = OaeUtil.getNumberParam(limit, 25, 1);

  PrincipalsUtil.getPrincipal(ctx, principalId, (err, principal) => {
    if (err) {
      return callback(err);
    }

    // Determining which activity stream should be returned is exactly the same
    // as resolving which library should be returned to a user. We can simply
    // re-use the library-authz logic
    LibraryAuthz.resolveTargetLibraryAccess(ctx, principalId, principal, (err, hasAccess, visibility) => {
      if (err) {
        return callback(err);
      }

      if (!hasAccess) {
        return callback({ code: 401, msg: 'You cannot access this activity stream' });
      }

      let activityStreamType = 'activity';
      if (visibility === 'public' || visibility === 'loggedin') {
        activityStreamType += '#' + visibility;
      }

      // Return the activities
      return _getActivityStream(ctx, principalId + '#' + activityStreamType, start, limit, transformerType, callback);
    });
  });
};

/**
 * Get the notification stream for a user
 *
 * @param  {Context}            ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}             userId                      The ID of the user for which the notifications should be retrieved
 * @param  {String}             [start]                     Determines the point at which activities are returned for paging purposes.  If not provided, the first x elements will be returned
 * @param  {Number}             [limit]                     The maximum number of activities to return. Default: 25
 * @param  {String}             [transformerType]           The type of transformer with which the activities should be transformed. One of `ActivityConstants.transformerTypes`. If left null, this will default to `ActivityConstants.transformerTypes.ACTIVITYSTREAMS`
 * @param  {Function}           callback                    Standard callback function
 * @param  {Object}             callback.err                An error that occurred, if any
 * @param  {ActivityStream}     callback.notifications      The requested set of notifications
 */
const getNotificationStream = function(ctx, userId, start, limit, transformerType, callback) {
  transformerType = transformerType || ActivityConstants.transformerTypes.ACTIVITYSTREAMS;

  try {
    pipe(
      isIn,
      otherwise({
        code: 400,
        msg: 'Unknown activity transformer type'
      }),
      makeSureThat(true, ctx, isLoggedInUser),
      otherwise({
        code: 401,
        msg: 'You must be logged in to get a notification stream'
      }),
      makeSureThat(true, userId, isUserId),
      otherwise({
        code: 400,
        msg: 'You can only view the notification streams for a user'
      })
    )(transformerType, _.values(ActivityConstants.transformerTypes));
  } catch (error) {
    return callback(error);
  }

  limit = OaeUtil.getNumberParam(limit, 25, 1);

  // Ensure authorization
  const { tenantAlias } = AuthzUtil.getResourceFromId(userId);
  if (ctx.user().id !== userId && ctx.user().isAdmin(tenantAlias)) {
    return callback({ code: 401, msg: 'You are not allowed to view this notification stream' });
  }

  // Return the notifications
  return _getActivityStream(ctx, userId + '#notification', start, limit, transformerType, callback);
};

/**
 * Mark all notifications for the current user as read
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const markNotificationsRead = function(ctx, callback) {
  try {
    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You must be logged in to mark notifications read'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  ActivityNotifications.markNotificationsRead(ctx.user(), callback);
};

// TODO Jsdoc
const isActivityFeedDisabled = ctx => {
  return !ActivityConfig.getValue(ctx.tenant().alias, 'activity', 'enabled');
};

/**
 * Post an activity in the system to be routed.
 *
 * @param  {Context}       ctx                 Standard context object containing the current user and the current tenant
 * @param  {ActivitySeed}  activitySeed        The activity "seed" object, which represents the smallest amount of information necessary to generate an activity
 * @param  {Function}      callback            Standard callback function
 * @param  {Object}        callback.err        An error that occurred, if any
 */
const postActivity = function(ctx, activitySeed, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err, activitySeed }, 'Error posting activity');
      }
    };

  // Short-circuit if we find that activities are disabled for this tenant
  if (isActivityFeedDisabled(ctx)) {
    return callback();
  }

  const getAttribute = getNestedObject(activitySeed);
  const thereIsActivity = Boolean(activitySeed);
  const thereIsActivityActor = thereIsActivity && activitySeed.actorResource;
  const thereIsActivityObject = thereIsActivity && activitySeed.objectResource;
  const thereIsActivityTarget = thereIsActivity && activitySeed.targetResource;

  const runValidations = pipe(
    makeSureThat(true, activitySeed, isObject),
    otherwise({
      code: 400,
      msg: 'No activity seed provided.'
    }),
    makeSureThat(thereIsActivity, getAttribute(['activityType']), isNotEmpty),
    otherwise({
      code: 400,
      msg: 'Activity seed did not have an activity type.'
    }),
    makeSureThat(thereIsActivity, getAttribute(['verb']), isNotEmpty),
    otherwise({
      code: 400,
      msg: 'Activity seed did not have a verb.'
    }),
    makeSureThat(thereIsActivity, getAttribute(['published']), isANumber),
    otherwise({
      code: 400,
      msg: 'Activity seed did not have a valid publish date.'
    }),
    makeSureThat(thereIsActivity, getAttribute(['actorResource']), isObject),
    otherwise({
      code: 400,
      msg: 'Activity seed did not have an actor resource'
    }),
    makeSureThat(thereIsActivityActor, getAttribute(['actorResource', 'resourceId']), isNotEmpty),
    otherwise({
      code: 400,
      msg: 'Actor of activity seed did not have a resourceId'
    }),
    makeSureThat(thereIsActivityActor, getAttribute(['actorResource', 'resourceType']), isNotEmpty),
    otherwise({
      code: 400,
      msg: 'Actor of activity seed did not have a resourceType'
    }),
    makeSureThat(thereIsActivityObject, getAttribute(['objectResource', 'resourceId']), isNotEmpty),
    otherwise({
      code: 400,
      msg: 'Object of activity seed was specified and did not have a resourceId'
    }),
    makeSureThat(thereIsActivityObject, getAttribute(['objectResource', 'resourceType']), isNotEmpty),
    otherwise({
      code: 400,
      msg: 'Object of activity seed was specified and did not have a resourceType'
    }),
    makeSureThat(thereIsActivityTarget, getAttribute(['targetResource', 'resourceId']), isNotEmpty),
    otherwise({
      code: 400,
      msg: 'Target of activity seed was specified and did not have a resourceId'
    }),
    makeSureThat(thereIsActivityTarget, getAttribute(['targetResource', 'resourceType']), isNotEmpty),
    otherwise({
      code: 400,
      msg: 'Target of activity seed was specified and did not have a resourceType'
    })
  );

  try {
    runValidations();
  } catch (error) {
    return callback(error);
  }

  MQ.submit(ActivityConstants.mq.TASK_ACTIVITY, JSON.stringify(activitySeed), callback);
};

/**
 * Internal function to get an activity stream by its ID. This bypasses permission checks.
 *
 * @param  {Context}           ctx                      Standard context object containing the current user and the current tenant
 * @param  {String}            activtyStreamId          The ID of the activity stream to fetch. ex: `u:cam:abc123#activity`
 * @param  {Number}            start                    Determines the point at which activities are returned for paging purposes.  If not provided, the first x elements will be returned
 * @param  {Number}            limit                    The number of activities to fetch
 * @param  {String}            transformerType          The type of transformer with which the activities should be transformed. One of `ActivityConstants.transformerTypes`
 * @param  {Function}          callback                 Standard callback function
 * @param  {Object}            callback.err             An error that occurred, if any
 * @param j {ActivityStream}    callback.activityStream  The activity stream
 * @api private
 */
const _getActivityStream = function(ctx, activityStreamId, start, limit, transformerType, callback) {
  ActivityDAO.getActivities(activityStreamId, start, limit, (err, activities, nextToken) => {
    if (err) return callback(err);

    ActivityTransformer.transformActivities(ctx, activities, transformerType, err => {
      if (err) return callback(err);

      // Emit an event indicating that the activity stream has been retrieved
      ActivityEmitter.emit(
        ActivityConstants.events.GET_ACTIVITY_STREAM,
        ctx,
        activityStreamId,
        start,
        limit,
        transformerType,
        activities
      );

      // Wrap the transformed activities in a stream
      return callback(null, new ActivityStream(activities, nextToken));
    });
  });
};

/**
 * Remove principal from activityStream table
 *
 * @param  {String}     principalId     The id of the user to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 */
const removeActivityStream = function(ctx, principalId, callback) {
  callback = callback || function() {};

  if (ctx.user().isGlobalAdmin() || ctx.user().isAdmin() || ctx.user().isTenantAdmin()) {
    const activityTypes = [
      '#activity',
      '#email',
      '#activity#public',
      '#activity#private',
      '#activity#loggedin',
      '#notification'
    ];

    async.eachSeries(
      activityTypes,
      function(activityType, done) {
        // Get all the activity streams corresponding to the deleted principal
        ActivityDAO.getActivities(principalId + activityType, null, null, function(err, activities) {
          if (err) return callback(err);

          // Delete all data in the ActivityStreams table corresponding to the deleted principal
          ActivityDAO.deleteActivities(activities, function(err) {
            if (err) return callback(err);

            return done();
          });
        });
      },
      function() {
        return callback();
      }
    );
  } else {
    return callback({ code: 400, msg: 'You must be an admin' });
  }
};

export {
  removeActivityStream,
  refreshConfiguration,
  registerActivityStreamType,
  getRegisteredActivityStreamType,
  registerActivityType,
  registerActivityEntityType,
  registerActivityEntityAssociation,
  getActivityStream,
  getNotificationStream,
  markNotificationsRead,
  postActivity,
  ActivityEmitter as emitter
};
