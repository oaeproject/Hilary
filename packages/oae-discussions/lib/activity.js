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

import * as ActivityAPI from 'oae-activity';
import * as ActivityModel from 'oae-activity/lib/model';
import * as ActivityUtil from 'oae-activity/lib/util';
import * as AuthzUtil from 'oae-authz/lib/util';
import * as MessageBoxAPI from 'oae-messagebox';
import * as MessageBoxUtil from 'oae-messagebox/lib/util';
import * as PrincipalsUtil from 'oae-principals/lib/util';
import * as TenantsUtil from 'oae-tenants/lib/util';
import { AuthzConstants } from 'oae-authz/lib/constants';
import { ActivityConstants } from 'oae-activity/lib/constants';
import * as DiscussionsDAO from './internal/dao.js';
import DiscussionsAPI from './api.js';

import { DiscussionsConstants } from './constants.js';

/**
 * Discussion create
 */

ActivityAPI.registerActivityType(DiscussionsConstants.activity.ACTIVITY_DISCUSSION_CREATE, {
  groupBy: [{ actor: true }],
  streams: {
    activity: {
      router: {
        actor: ['self', 'followers'],
        object: ['self', 'members']
      }
    },
    notification: {
      router: {
        object: ['members']
      }
    },
    email: {
      router: {
        object: ['members']
      }
    }
  }
});

/*!
 * Post a discussion-create activity when a user creates a discussion.
 */
DiscussionsAPI.on(DiscussionsConstants.events.CREATED_DISCUSSION, (ctx, discussion) => {
  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const objectResource = new ActivityModel.ActivitySeedResource('discussion', discussion.id, {
    discussion
  });
  const activitySeed = new ActivityModel.ActivitySeed(
    DiscussionsConstants.activity.ACTIVITY_DISCUSSION_CREATE,
    millis,
    ActivityConstants.verbs.CREATE,
    actorResource,
    objectResource
  );
  ActivityAPI.postActivity(ctx, activitySeed);
});

/// /////////////////////////////////////////////////////
// DISCUSSION-UPDATE and DISCUSSION-UPDATE-VISIBILITY //
/// /////////////////////////////////////////////////////

ActivityAPI.registerActivityType(DiscussionsConstants.activity.ACTIVITY_DISCUSSION_UPDATE, {
  streams: {
    activity: {
      router: {
        actor: ['self'],
        object: ['self', 'members']
      }
    },
    notification: {
      router: {
        object: ['managers']
      }
    },
    email: {
      router: {
        object: ['managers']
      }
    }
  }
});

ActivityAPI.registerActivityType(DiscussionsConstants.activity.ACTIVITY_DISCUSSION_UPDATE_VISIBILITY, {
  streams: {
    activity: {
      router: {
        actor: ['self'],
        object: ['self', 'members']
      }
    },
    notification: {
      router: {
        object: ['managers']
      }
    }
  }
});

/*!
 * Post either a discussion-update or discussion-update-visibility activity when a user updates a discussion's metadata.
 */
DiscussionsAPI.on(DiscussionsConstants.events.UPDATED_DISCUSSION, (ctx, newDiscussion, oldDiscussion) => {
  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const objectResource = new ActivityModel.ActivitySeedResource('discussion', newDiscussion.id, {
    discussion: newDiscussion
  });

  // We discriminate between general updates and visibility changes.
  // If the visibility has changed, we fire a visibility changed activity *instead* of an update activity
  let activityType = null;
  activityType =
    newDiscussion.visibility === oldDiscussion.visibility
      ? DiscussionsConstants.activity.ACTIVITY_DISCUSSION_UPDATE
      : DiscussionsConstants.activity.ACTIVITY_DISCUSSION_UPDATE_VISIBILITY;

  const activitySeed = new ActivityModel.ActivitySeed(
    activityType,
    millis,
    ActivityConstants.verbs.UPDATE,
    actorResource,
    objectResource
  );
  ActivityAPI.postActivity(ctx, activitySeed);
});

/// /////////////////////
// DISCUSSION-MESSAGE //
/// /////////////////////

ActivityAPI.registerActivityType(DiscussionsConstants.activity.ACTIVITY_DISCUSSION_MESSAGE, {
  groupBy: [{ target: true }],
  streams: {
    activity: {
      router: {
        actor: ['self'],
        target: ['message-contributors', 'members']
      }
    },
    notification: {
      router: {
        target: ['message-contributors', 'members']
      }
    },
    email: {
      router: {
        target: ['message-contributors', 'members']
      }
    },
    message: {
      transient: true,
      router: {
        // Route the activity to the discussion
        target: ['self']
      }
    }
  }
});

/*!
 * Post a discussion-message activity when a user comments on a discussion
 */
DiscussionsAPI.on(DiscussionsConstants.events.CREATED_DISCUSSION_MESSAGE, (ctx, message, discussion) => {
  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const objectResource = new ActivityModel.ActivitySeedResource('discussion-message', message.id, {
    discussionId: discussion.id,
    message
  });
  const targetResource = new ActivityModel.ActivitySeedResource('discussion', discussion.id, {
    discussion
  });
  const activitySeed = new ActivityModel.ActivitySeed(
    DiscussionsConstants.activity.ACTIVITY_DISCUSSION_MESSAGE,
    millis,
    ActivityConstants.verbs.POST,
    actorResource,
    objectResource,
    targetResource
  );
  ActivityAPI.postActivity(ctx, activitySeed);
});

/// ////////////////////////////////////////////////////////////////////////////////
// DISCUSSION-SHARE, DISCUSSION-ADD-TO-LIBRARY and DISCUSSION-UPDATE-MEMBER-ROLE //
/// ////////////////////////////////////////////////////////////////////////////////s

ActivityAPI.registerActivityType(DiscussionsConstants.activity.ACTIVITY_DISCUSSION_ADD_TO_LIBRARY, {
  // "Branden Visser added 5 items to his library"
  groupBy: [{ actor: true }],
  streams: {
    activity: {
      router: {
        actor: ['self', 'followers'],
        object: ['managers']
      }
    }
  }
});

ActivityAPI.registerActivityType(DiscussionsConstants.activity.ACTIVITY_DISCUSSION_SHARE, {
  groupBy: [
    // "Branden Visser shared a discussion with 5 users and groups"
    { actor: true, object: true },

    // "Branden Visser shared 8 discussions with OAE Team"
    { actor: true, target: true }
  ],

  streams: {
    activity: {
      router: {
        actor: ['self'],
        object: ['managers'],
        target: ['self', 'members', 'followers']
      }
    },
    notification: {
      router: {
        target: ['self']
      }
    },
    email: {
      router: {
        target: ['self']
      }
    }
  }
});

ActivityAPI.registerActivityType(DiscussionsConstants.activity.ACTIVITY_DISCUSSION_UPDATE_MEMBER_ROLE, {
  groupBy: [{ actor: true, target: true }],
  streams: {
    activity: {
      router: {
        actor: ['self'],
        object: ['self', 'members'],
        target: ['managers']
      }
    }
  }
});

/*!
 * Post a discussion-share or discussion-add-to-library activity based on discussion sharing
 */
DiscussionsAPI.on(
  DiscussionsConstants.events.UPDATED_DISCUSSION_MEMBERS,
  (ctx, discussion, memberChangeInfo, options) => {
    if (options.invitation) {
      // If this member update came from an invitation, we bypass adding activity as there is a
      // dedicated activity for that
      return;
    }

    const addedPrincipalIds = _.pluck(memberChangeInfo.members.added, 'id');
    const updatedPrincipalIds = _.pluck(memberChangeInfo.members.updated, 'id');

    const millis = Date.now();
    const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
      user: ctx.user()
    });
    const discussionResource = new ActivityModel.ActivitySeedResource('discussion', discussion.id, {
      discussion
    });

    // For users that are newly added to the discussion, post either a share or "add to library" activity, depending on context
    _.each(addedPrincipalIds, (principalId) => {
      if (principalId === ctx.user().id) {
        // Users can't "share" with themselves, they actually "add it to their library"
        ActivityAPI.postActivity(
          ctx,
          new ActivityModel.ActivitySeed(
            DiscussionsConstants.activity.ACTIVITY_DISCUSSION_ADD_TO_LIBRARY,
            millis,
            ActivityConstants.verbs.ADD,
            actorResource,
            discussionResource
          )
        );
      } else {
        // A user shared discussion with some other user, fire the discussion share activity
        const principalResourceType = PrincipalsUtil.isGroup(principalId) ? 'group' : 'user';
        const principalResource = new ActivityModel.ActivitySeedResource(principalResourceType, principalId);
        ActivityAPI.postActivity(
          ctx,
          new ActivityModel.ActivitySeed(
            DiscussionsConstants.activity.ACTIVITY_DISCUSSION_SHARE,
            millis,
            ActivityConstants.verbs.SHARE,
            actorResource,
            discussionResource,
            principalResource
          )
        );
      }
    });

    // For users whose role changed, post the discussion-update-member-role activity
    _.each(updatedPrincipalIds, (principalId) => {
      const principalResourceType = PrincipalsUtil.isGroup(principalId) ? 'group' : 'user';
      const principalResource = new ActivityModel.ActivitySeedResource(principalResourceType, principalId);
      ActivityAPI.postActivity(
        ctx,
        new ActivityModel.ActivitySeed(
          DiscussionsConstants.activity.ACTIVITY_DISCUSSION_UPDATE_MEMBER_ROLE,
          millis,
          ActivityConstants.verbs.UPDATE,
          actorResource,
          principalResource,
          discussionResource
        )
      );
    });
  }
);

/// ////////////////////////
// ACTIVITY ENTITY TYPES //
/// ////////////////////////

/*!
 * Produces a persistent 'discussion' activity entity
 * @see ActivityAPI#registerActivityEntityType
 */
const _discussionProducer = function (resource, callback) {
  const discussion =
    resource.resourceData && resource.resourceData.discussion ? resource.resourceData.discussion : null;

  // If the discussion item was fired with the resource, use it instead of fetching
  if (discussion) {
    return callback(null, _createPersistentDiscussionActivityEntity(discussion));
  }

  DiscussionsDAO.getDiscussion(resource.resourceId, (error, discussion) => {
    if (error) {
      return callback(error);
    }

    return callback(null, _createPersistentDiscussionActivityEntity(discussion));
  });
};

/**
 * Create the persistent discussion entity that can be transformed into an activity entity for the UI.
 *
 * @param  {Discussion}     discussion      The discussion that provides the data for the entity.
 * @return {Object}                         An object containing the entity data that can be transformed into a UI discussion activity entity
 * @api private
 */
const _createPersistentDiscussionActivityEntity = function (discussion) {
  return new ActivityModel.ActivityEntity('discussion', discussion.id, discussion.visibility, {
    discussion
  });
};

/*!
 * Produces an persistent activity entity that represents a message that was posted
 * @see ActivityAPI#registerActivityEntityType
 */
const _discussionMessageProducer = function (resource, callback) {
  const { message, discussionId } = resource.resourceData;
  DiscussionsDAO.getDiscussion(discussionId, (error, discussion) => {
    if (error) {
      return callback(error);
    }

    MessageBoxUtil.createPersistentMessageActivityEntity(message, (error, entity) => {
      if (error) {
        return callback(error);
      }

      // Store the discussion id and visibility on the entity as these are required for routing the activities
      entity.objectType = 'discussion-message';
      entity.discussionId = discussion.id;
      entity.discussionVisibility = discussion.visibility;
      return callback(null, entity);
    });
  });
};

/*!
 * Transform the discussion persistent activity entities into UI-friendly ones
 * @see ActivityAPI#registerActivityEntityType
 */
const _discussionTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};

  _.each(activityEntities, (entities, activityId) => {
    transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
    _.each(entities, (entity, entityId) => {
      // Transform the persistent entity into an ActivityStrea.ms compliant format
      transformedActivityEntities[activityId][entityId] = _transformPersistentDiscussionActivityEntity(ctx, entity);
    });
  });
  return callback(null, transformedActivityEntities);
};

/*!
 * Transform the discussion persistent activity entities into their OAE profiles
 * @see ActivityAPI#registerActivityEntityType
 */
const _discussionInternalTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};

  _.each(activityEntities, (entities, activityId) => {
    transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
    _.each(entities, (entity, entityId) => {
      // Transform the persistent entity into the OAE model
      transformedActivityEntities[activityId][entityId] = entity.discussion;
    });
  });
  return callback(null, transformedActivityEntities);
};

/**
 * Transform a discussion object into an activity entity suitable to be displayed in an activity stream.
 *
 * For more details on the transformed entity model, @see ActivityAPI#registerActivityEntityTransformer
 *
 * @param  {Context}           ctx         Standard context object containing the current user and the current tenant
 * @param  {Object}            entity      The persistent activity entity to transform
 * @return {ActivityEntity}                The activity entity that represents the given discussion item
 */
const _transformPersistentDiscussionActivityEntity = function (ctx, entity) {
  const { discussion } = entity;

  // Generate URLs for this activity
  const tenant = ctx.tenant();
  const baseUrl = TenantsUtil.getBaseUrl(tenant);
  const globalId = baseUrl + '/api/discussion/' + discussion.id;
  const resource = AuthzUtil.getResourceFromId(discussion.id);
  const profileUrl = baseUrl + '/discussion/' + resource.tenantAlias + '/' + resource.resourceId;

  const options = {};
  options.url = profileUrl;
  options.displayName = discussion.displayName;
  options.ext = {};
  options.ext[ActivityConstants.properties.OAE_ID] = discussion.id;
  options.ext[ActivityConstants.properties.OAE_VISIBILITY] = discussion.visibility;
  options.ext[ActivityConstants.properties.OAE_PROFILEPATH] = discussion.profilePath;
  return new ActivityModel.ActivityEntity('discussion', globalId, discussion.visibility, options);
};

/*!
 * Transform the persisted message activity entities into UI-friendly ones
 * @see ActivityAPI#registerActivityEntityType
 */
const _discussionMessageTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};
  _.keys(activityEntities).forEach((activityId) => {
    transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
    _.keys(activityEntities[activityId]).forEach((entityId) => {
      const entity = activityEntities[activityId][entityId];
      const { discussionId } = entity;
      const resource = AuthzUtil.getResourceFromId(discussionId);
      const profilePath = '/discussion/' + resource.tenantAlias + '/' + resource.resourceId;
      const urlFormat = '/api/discussion/' + discussionId + '/messages/%s';
      transformedActivityEntities[activityId][entityId] = MessageBoxUtil.transformPersistentMessageActivityEntity(
        ctx,
        entity,
        profilePath,
        urlFormat
      );
    });
  });
  return callback(null, transformedActivityEntities);
};

/*!
 * Transform the persisted message activity entities into UI-friendly ones
 * @see ActivityAPI#registerActivityEntityType
 */
const _discussionMessageInternalTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};
  _.keys(activityEntities).forEach((activityId) => {
    transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
    _.keys(activityEntities[activityId]).forEach((entityId) => {
      const entity = activityEntities[activityId][entityId];
      transformedActivityEntities[activityId][
        entityId
      ] = MessageBoxUtil.transformPersistentMessageActivityEntityToInternal(ctx, entity.message);
    });
  });
  return callback(null, transformedActivityEntities);
};

ActivityAPI.registerActivityEntityType('discussion', {
  producer: _discussionProducer,
  transformer: {
    activitystreams: _discussionTransformer,
    internal: _discussionInternalTransformer
  },
  propagation(associationsCtx, entity, callback) {
    ActivityUtil.getStandardResourcePropagation(entity.discussion.visibility, AuthzConstants.joinable.NO, callback);
  }
});

ActivityAPI.registerActivityEntityType('discussion-message', {
  producer: _discussionMessageProducer,
  transformer: {
    activitystreams: _discussionMessageTransformer,
    internal: _discussionMessageInternalTransformer
  },
  propagation(associationsCtx, entity, callback) {
    return callback(null, [{ type: ActivityConstants.entityPropagation.ALL }]);
  }
});

/// ///////////////////////////////
// ACTIVITY ENTITY ASSOCIATIONS //
/// ///////////////////////////////

/*!
 * Register an association that presents the discussion
 */
ActivityAPI.registerActivityEntityAssociation('discussion', 'self', (associationsCtx, entity, callback) => {
  return callback(null, [entity[ActivityConstants.properties.OAE_ID]]);
});

/*!
 * Register an association that presents the members of a discussion categorized by role
 */
ActivityAPI.registerActivityEntityAssociation('discussion', 'members-by-role', (associationsCtx, entity, callback) => {
  ActivityUtil.getAllAuthzMembersByRole(entity[ActivityConstants.properties.OAE_ID], callback);
});

/*!
 * Register an association that presents all the indirect members of a discussion
 */
ActivityAPI.registerActivityEntityAssociation('discussion', 'members', (associationsCtx, entity, callback) => {
  associationsCtx.get('members-by-role', (error, membersByRole) => {
    if (error) {
      return callback(error);
    }

    return callback(null, _.flatten(_.values(membersByRole)));
  });
});

/*!
 * Register an association that presents all the managers of a discussion
 */
ActivityAPI.registerActivityEntityAssociation('discussion', 'managers', (associationsCtx, entity, callback) => {
  associationsCtx.get('members-by-role', (error, membersByRole) => {
    if (error) {
      return callback(error);
    }

    return callback(null, membersByRole[AuthzConstants.role.MANAGER]);
  });
});

/*!
 * Register an assocation that presents all the commenting contributors of a discussion
 */
ActivityAPI.registerActivityEntityAssociation(
  'discussion',
  'message-contributors',
  (associationsCtx, entity, callback) => {
    MessageBoxAPI.getRecentContributions(entity[ActivityConstants.properties.OAE_ID], null, 100, callback);
  }
);

/*!
 * Register an association that presents the discussion for a discussion-message entity
 */
ActivityAPI.registerActivityEntityAssociation('discussion-message', 'self', (associationsCtx, entity, callback) => {
  return callback(null, [entity.discussionId]);
});
