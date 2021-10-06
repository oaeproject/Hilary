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

import * as ActivityAPI from 'oae-activity/lib/api.js';
import * as ActivityModel from 'oae-activity/lib/model.js';
import * as ActivityUtil from 'oae-activity/lib/util.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as MessageBoxAPI from 'oae-messagebox';
import * as MessageBoxUtil from 'oae-messagebox/lib/util.js';
import * as PrincipalsUtil from 'oae-principals/lib/util.js';
import * as ContentAPI from 'oae-content';
import { ActivityConstants } from 'oae-activity/lib/constants.js';
import { AuthzConstants } from 'oae-authz/lib/constants.js';
import { ContentConstants } from 'oae-content/lib/constants.js';
import * as Etherpad from './internal/etherpad.js';
import * as ContentUtil from './internal/util.js';
import * as ContentDAO from './internal/dao.js';

/**
 * Content create
 */
ActivityAPI.registerActivityType(ContentConstants.activity.ACTIVITY_CONTENT_CREATE, {
  groupBy: [{ actor: true, target: true }],
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
 * Post a content-create activity when a user creates a content item.
 */
ContentAPI.emitter.on(
  ContentConstants.events.CREATED_CONTENT,
  (ctx, content, revision, memberChangeInfo, folderIds) => {
    const millis = Date.now();
    const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
      user: ctx.user()
    });
    const objectResource = new ActivityModel.ActivitySeedResource('content', content.id, {
      content
    });
    let targetResource = null;

    // Get the extra members
    const extraMembers = _.chain(memberChangeInfo.changes)
      .keys()
      .filter((member) => member !== ctx.user().id)
      .value();

    // If we only added 1 extra user or group, we set the target to that entity
    if (_.isEmpty(folderIds) && extraMembers.length === 1) {
      const targetResourceType = PrincipalsUtil.isGroup(extraMembers[0]) ? 'group' : 'user';
      targetResource = new ActivityModel.ActivitySeedResource(targetResourceType, extraMembers[0]);

      // If we added the file to just 1 folder, we set it as a target
    } else if (_.isEmpty(extraMembers) && folderIds.length === 1) {
      targetResource = new ActivityModel.ActivitySeedResource('folder', folderIds[0]);
    }

    // Generate the activity seed and post it to the queue
    const activitySeed = new ActivityModel.ActivitySeed(
      ContentConstants.activity.ACTIVITY_CONTENT_CREATE,
      millis,
      ActivityConstants.verbs.CREATE,
      actorResource,
      objectResource,
      targetResource
    );
    ActivityAPI.postActivity(ctx, activitySeed);
  }
);

/// ///////////////////////////////////////////////
// CONTENT-UPDATE and CONTENT-UPDATE-VISIBILITY //
/// ///////////////////////////////////////////////

ActivityAPI.registerActivityType(ContentConstants.activity.ACTIVITY_CONTENT_UPDATE, {
  groupBy: [{ object: true }],
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

ActivityAPI.registerActivityType(ContentConstants.activity.ACTIVITY_CONTENT_UPDATE_VISIBILITY, {
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
 * Post either a content-update or content-update-visibility activity when a user updates a content item's metadata.
 */
ContentAPI.emitter.on(ContentConstants.events.UPDATED_CONTENT, (ctx, newContent, oldContent, _) => {
  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const objectResource = new ActivityModel.ActivitySeedResource('content', newContent.id, {
    content: newContent
  });

  // We discriminate between general updates and visibility changes. If the visibility has changed, we fire a visibility changed activity *instead* of an update activity
  let activityType = null;
  activityType =
    newContent.visibility === oldContent.visibility
      ? ContentConstants.activity.ACTIVITY_CONTENT_UPDATE
      : ContentConstants.activity.ACTIVITY_CONTENT_UPDATE_VISIBILITY;

  const activitySeed = new ActivityModel.ActivitySeed(
    activityType,
    millis,
    ActivityConstants.verbs.UPDATE,
    actorResource,
    objectResource
  );
  ActivityAPI.postActivity(ctx, activitySeed);
});

/// ///////////////////
// CONTENT-REVISION //
/// ///////////////////

ActivityAPI.registerActivityType(ContentConstants.activity.ACTIVITY_CONTENT_REVISION, {
  groupBy: [{ object: true }],
  streams: {
    activity: {
      router: {
        actor: ['self'],
        object: ['self', 'members']
      }
    },
    notification: {
      router: {
        object: ['members', '^online-authors']
      }
    },
    email: {
      router: {
        object: ['members', '^online-authors']
      }
    }
  }
});

/*!
 * Post a content-revision activity when a user uploads a new file body
 */
ContentAPI.emitter.on(
  ContentConstants.events.UPDATED_CONTENT_BODY,
  // eslint-disable-next-line no-unused-vars
  (ctx, newContentObject, oldContentObject, revision) => {
    const millis = Date.now();
    const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
      user: ctx.user()
    });
    const objectResource = new ActivityModel.ActivitySeedResource('content', newContentObject.id, {
      content: newContentObject
    });
    const activitySeed = new ActivityModel.ActivitySeed(
      ContentConstants.activity.ACTIVITY_CONTENT_REVISION,
      millis,
      ActivityConstants.verbs.UPDATE,
      actorResource,
      objectResource
    );
    ActivityAPI.postActivity(ctx, activitySeed);
  }
);

/*!
 * Post a content-revision activity when a user has made an edit to a collaborative document (even though there is technically no new revision)
 */
ContentAPI.emitter.on(ContentConstants.events.EDITED_COLLABDOC, (ctx, contentObject) => {
  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const objectResource = new ActivityModel.ActivitySeedResource('content', contentObject.id, {
    content: contentObject
  });
  const activitySeed = new ActivityModel.ActivitySeed(
    ContentConstants.activity.ACTIVITY_CONTENT_REVISION,
    millis,
    ActivityConstants.verbs.UPDATE,
    actorResource,
    objectResource
  );
  ActivityAPI.postActivity(ctx, activitySeed);
});

/**
 * Content-restored-revision
 */

ActivityAPI.registerActivityType(ContentConstants.activity.ACTIVITY_CONTENT_RESTORED_REVISION, {
  groupBy: [{ object: true }],
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

/*!
 * Post a content-restored-revision activity when a user restores an old revision.
 */
ContentAPI.emitter.on(
  ContentConstants.events.RESTORED_REVISION,
  // eslint-disable-next-line no-unused-vars
  (ctx, newContentObject, oldContentObject, restoredRevision) => {
    const millis = Date.now();
    const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
      user: ctx.user()
    });
    const objectResource = new ActivityModel.ActivitySeedResource('content', newContentObject.id, {
      content: newContentObject
    });
    const activitySeed = new ActivityModel.ActivitySeed(
      ContentConstants.activity.ACTIVITY_CONTENT_RESTORED_REVISION,
      millis,
      ActivityConstants.verbs.UPDATE,
      actorResource,
      objectResource
    );
    ActivityAPI.postActivity(ctx, activitySeed);
  }
);

/// //////////////////
// CONTENT-COMMENT //
/// //////////////////

ActivityAPI.registerActivityType(ContentConstants.activity.ACTIVITY_CONTENT_COMMENT, {
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
        // Route the activity to the piece of content
        target: ['self']
      }
    }
  }
});

/*!
 * Post a content-comment activity when a user comments on a content item
 */
ContentAPI.emitter.on(ContentConstants.events.CREATED_COMMENT, (ctx, message, content) => {
  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const objectResource = new ActivityModel.ActivitySeedResource('content-comment', message.id, {
    contentId: content.id,
    message
  });
  const targetResource = new ActivityModel.ActivitySeedResource('content', content.id, {
    content
  });
  const activitySeed = new ActivityModel.ActivitySeed(
    ContentConstants.activity.ACTIVITY_CONTENT_COMMENT,
    millis,
    ActivityConstants.verbs.POST,
    actorResource,
    objectResource,
    targetResource
  );
  ActivityAPI.postActivity(ctx, activitySeed);
});

/// ///////////////////////////////////////////////////////////////////////
// CONTENT-SHARE, CONTENT-ADD-TO-LIBRARY and CONTENT-UPDATE-MEMBER-ROLE //
/// ///////////////////////////////////////////////////////////////////////

ActivityAPI.registerActivityType(ContentConstants.activity.ACTIVITY_CONTENT_ADD_TO_LIBRARY, {
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

ActivityAPI.registerActivityType(ContentConstants.activity.ACTIVITY_CONTENT_SHARE, {
  groupBy: [
    // "Branden Visser shared Content Item with 5 users and groups"
    { actor: true, object: true },

    // "Branden Visser shared 8 files with OAE Team"
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

ActivityAPI.registerActivityType(ContentConstants.activity.ACTIVITY_CONTENT_UPDATE_MEMBER_ROLE, {
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
 * Post a content-share or content-add-to-library activity based on content sharing
 */
ContentAPI.emitter.on(ContentConstants.events.UPDATED_CONTENT_MEMBERS, (ctx, content, memberChangeInfo, options) => {
  if (options.invitation) {
    // If this member update came from an invitation, we bypass adding activity as there is a
    // dedicated activity for that
    return;
  }

  const addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
  const updatedMemberIds = _.pluck(memberChangeInfo.members.updated, 'id');

  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const contentResource = new ActivityModel.ActivitySeedResource('content', content.id, {
    content
  });

  // When a user is added, it is considered either a content-share or a content-add-to-library activity, depending on if the
  // added user is the current user in context
  _.each(addedMemberIds, (memberId) => {
    if (memberId === ctx.user().id) {
      // Users can't "share" with themselves, they actually "add it to their library"
      ActivityAPI.postActivity(
        ctx,
        new ActivityModel.ActivitySeed(
          ContentConstants.activity.ACTIVITY_CONTENT_ADD_TO_LIBRARY,
          millis,
          ActivityConstants.verbs.ADD,
          actorResource,
          contentResource
        )
      );
    } else {
      // A user shared content with some other user, fire the content share activity
      const principalResourceType = PrincipalsUtil.isGroup(memberId) ? 'group' : 'user';
      const principalResource = new ActivityModel.ActivitySeedResource(principalResourceType, memberId);
      ActivityAPI.postActivity(
        ctx,
        new ActivityModel.ActivitySeed(
          ContentConstants.activity.ACTIVITY_CONTENT_SHARE,
          millis,
          ActivityConstants.verbs.SHARE,
          actorResource,
          contentResource,
          principalResource
        )
      );
    }
  });

  // When a user's role is updated, we fire a "content-update-member-role" activity
  _.each(updatedMemberIds, (memberId) => {
    const principalResourceType = PrincipalsUtil.isGroup(memberId) ? 'group' : 'user';
    const principalResource = new ActivityModel.ActivitySeedResource(principalResourceType, memberId);
    ActivityAPI.postActivity(
      ctx,
      new ActivityModel.ActivitySeed(
        ContentConstants.activity.ACTIVITY_CONTENT_UPDATE_MEMBER_ROLE,
        millis,
        ActivityConstants.verbs.UPDATE,
        actorResource,
        principalResource,
        contentResource
      )
    );
  });
});

/// ////////////////////////
// ACTIVITY ENTITY TYPES //
/// ////////////////////////

/*!
 * Produces a persistent 'content' activity entity
 * @see ActivityAPI#registerActivityEntityType
 */
const _contentProducer = function (resource, callback) {
  const content = resource.resourceData && resource.resourceData.content ? resource.resourceData.content : null;

  // If the content item was fired with the resource, use it instead of fetching
  if (content) {
    return callback(null, ContentUtil.createPersistentContentActivityEntity(content));
  }

  ContentDAO.Content.getContent(resource.resourceId, (error, content) => {
    if (error) {
      return callback(error);
    }

    return callback(null, ContentUtil.createPersistentContentActivityEntity(content));
  });
};

/*!
 * Produces an persistent activity entity that represents a comment that was posted
 * @see ActivityAPI#registerActivityEntityType
 */
const _contentCommentProducer = function (resource, callback) {
  const { message, contentId } = resource.resourceData;
  ContentDAO.Content.getContent(contentId, (error, content) => {
    if (error) {
      return callback(error);
    }

    MessageBoxUtil.createPersistentMessageActivityEntity(message, (error, entity) => {
      if (error) {
        return callback(error);
      }

      // Store the content id and visibility on the entity as these are required for routing the activities.
      entity.objectType = 'content-comment';
      entity.contentId = content.id;
      entity.contentVisibility = content.visibility;
      return callback(null, entity);
    });
  });
};

/*!
 * Transform the content persistent activity entities into UI-friendly ones
 * @see ActivityAPI#registerActivityEntityType
 */
const _contentTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};

  // Collect all the revision ids so we can fetch their preview data
  let allRevisionIds = [];
  // eslint-disable-next-line no-unused-vars
  _.each(activityEntities, (entities, activityId) => {
    // eslint-disable-next-line no-unused-vars
    _.each(entities, (entity, entityId) => {
      allRevisionIds.push(entity.content.latestRevisionId);
    });
  });

  // No need to retrieve the same revision twice
  allRevisionIds = _.uniq(allRevisionIds);

  // Fetch the previews and attach them to the transformed entities
  ContentDAO.Previews.getPreviewUris(allRevisionIds, (error, previews) => {
    if (error) {
      return callback(error);
    }

    _.each(activityEntities, (entities, activityId) => {
      transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
      _.each(entities, (entity, entityId) => {
        // Transform the persistent entity with its up-to-date preview status
        transformedActivityEntities[activityId][entityId] = ContentUtil.transformPersistentContentActivityEntity(
          ctx,
          entity,
          previews[entity.content.latestRevisionId]
        );
      });
    });

    return callback(null, transformedActivityEntities);
  });
};

/*!
 * Transform the content persistent activity entities into their OAE profiles
 * @see ActivityAPI#registerActivityEntityType
 */
const _contentInternalTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};

  // Collect all the revision ids so we can fetch their preview data
  let allRevisionIds = [];
  // eslint-disable-next-line no-unused-vars
  _.each(activityEntities, (entities, activityId) => {
    // eslint-disable-next-line no-unused-vars
    _.each(entities, (entity, entityId) => {
      allRevisionIds.push(entity.content.latestRevisionId);
    });
  });

  // No need to retrieve the same revision twice
  allRevisionIds = _.uniq(allRevisionIds);

  // We need the full previews object for the internal content object
  ContentDAO.Revisions.getMultipleRevisions(
    allRevisionIds,
    { fields: ['revisionId', 'previews'] },
    (error, revisions) => {
      if (error) {
        return callback(error);
      }

      const previews = {};
      _.each(revisions, (revision) => {
        previews[revision.revisionId] = revision.previews;
      });

      _.each(activityEntities, (entities, activityId) => {
        transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
        _.each(entities, (entity, entityId) => {
          // Transform the persistent entity with its up-to-date preview status
          transformedActivityEntities[activityId][entityId] =
            ContentUtil.transformPersistentContentActivityEntityToInternal(
              ctx,
              entity,
              previews[entity.content.latestRevisionId]
            );
        });
      });

      return callback(null, transformedActivityEntities);
    }
  );
};

/*!
 * Transform the comment persistent activity entities into UI-friendly ones
 * @see ActivityAPI#registerActivityEntityType
 */
const _contentCommentTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};
  for (const activityId of _.keys(activityEntities)) {
    transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
    for (const entityId of _.keys(activityEntities[activityId])) {
      const entity = activityEntities[activityId][entityId];
      const contentId = entity.message.messageBoxId;
      const contentResource = AuthzUtil.getResourceFromId(contentId);
      const profilePath = '/content/' + contentResource.tenantAlias + '/' + contentResource.resourceId;
      const urlFormat = '/api/content/' + contentId + '/messages/%s';
      transformedActivityEntities[activityId][entityId] = MessageBoxUtil.transformPersistentMessageActivityEntity(
        ctx,
        entity,
        profilePath,
        urlFormat
      );
    }
  }

  return callback(null, transformedActivityEntities);
};

/*!
 * Transform the comment persistent activity entities into OAE profiles
 * @see ActivityAPI#registerActivityEntityType
 */
const _contentCommentInternalTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};
  for (const activityId of _.keys(activityEntities)) {
    transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
    for (const entityId of _.keys(activityEntities[activityId])) {
      const entity = activityEntities[activityId][entityId];
      transformedActivityEntities[activityId][entityId] =
        MessageBoxUtil.transformPersistentMessageActivityEntityToInternal(ctx, entity.message);
    }
  }

  return callback(null, transformedActivityEntities);
};

ActivityAPI.registerActivityEntityType('content', {
  producer: _contentProducer,
  transformer: {
    activitystreams: _contentTransformer,
    internal: _contentInternalTransformer
  },
  propagation(associationsCtx, entity, callback) {
    ActivityUtil.getStandardResourcePropagation(entity.content.visibility, AuthzConstants.joinable.NO, callback);
  }
});

ActivityAPI.registerActivityEntityType('content-comment', {
  producer: _contentCommentProducer,
  transformer: {
    activitystreams: _contentCommentTransformer,
    internal: _contentCommentInternalTransformer
  },
  propagation(associationsCtx, entity, callback) {
    return callback(null, [{ type: ActivityConstants.entityPropagation.ALL }]);
  }
});

/// ///////////////////////////////
// ACTIVITY ENTITY ASSOCIATIONS //
/// ///////////////////////////////

/*!
 * Register an association that presents the content item
 */
ActivityAPI.registerActivityEntityAssociation('content', 'self', (associationsCtx, entity, callback) =>
  callback(null, [entity[ActivityConstants.properties.OAE_ID]])
);

/*!
 * Register an association that presents the members of a content item categorized by role
 */
ActivityAPI.registerActivityEntityAssociation('content', 'members-by-role', (associationsCtx, entity, callback) => {
  ActivityUtil.getAllAuthzMembersByRole(entity[ActivityConstants.properties.OAE_ID], callback);
});

/*!
 * Register an association that presents all the indirect members of a content item
 */
ActivityAPI.registerActivityEntityAssociation('content', 'members', (associationsCtx, entity, callback) => {
  associationsCtx.get('members-by-role', (error, membersByRole) => {
    if (error) {
      return callback(error);
    }

    return callback(null, _.values(membersByRole).flat());
  });
});

/*!
 * Register an association that presents all the managers of a content item
 */
ActivityAPI.registerActivityEntityAssociation('content', 'managers', (associationsCtx, entity, callback) => {
  associationsCtx.get('members-by-role', (error, membersByRole) => {
    if (error) {
      return callback(error);
    }

    return callback(null, membersByRole[AuthzConstants.role.MANAGER]);
  });
});

/*!
 * Register an association that presents those users who are active on a collaborative document right now
 */
ActivityAPI.registerActivityEntityAssociation('content', 'online-authors', (associationsCtx, entity, callback) => {
  // Ignore content items that aren't collaborative documents
  if (entity.content.resourceSubType !== 'collabdoc') {
    return callback(null, []);
  }

  // Grab the authors who are currently in the collaborative document
  Etherpad.getOnlineAuthors(entity.content.id, entity.content.etherpadPadId, (error, onlineAuthorIds) => {
    if (error) {
      return callback(error);
    }

    ContentDAO.Etherpad.getUserIds(onlineAuthorIds, (error, userIds) => {
      if (error) {
        return callback(error);
      }

      return callback(null, _.values(userIds));
    });
  });
});

/*!
 * Register an assocation that presents all the commenting contributors of a content item
 */
ActivityAPI.registerActivityEntityAssociation(
  'content',
  'message-contributors',
  (associationsCtx, entity, callback) => {
    MessageBoxAPI.getRecentContributions(entity[ActivityConstants.properties.OAE_ID], null, 100, callback);
  }
);

/*!
 * Register an association that presents the content item for a content-comment entity
 */
ActivityAPI.registerActivityEntityAssociation('content-comment', 'self', (associationsCtx, entity, callback) =>
  callback(null, [entity.contentId])
);
