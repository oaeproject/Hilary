/*
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
import * as ContentUtil from 'oae-content/lib/internal/util.js';
import * as MessageBoxAPI from 'oae-messagebox';
import * as MessageBoxUtil from 'oae-messagebox/lib/util.js';
import PreviewConstants from 'oae-preview-processor/lib/constants.js';
import * as PrincipalsUtil from 'oae-principals/lib/util.js';
import * as TenantsUtil from 'oae-tenants/lib/util.js';
import * as FoldersAPI from 'oae-folders';
import * as FoldersDAO from 'oae-folders/lib/internal/dao.js';

import { AuthzConstants } from 'oae-authz/lib/constants.js';
import { ActivityConstants } from 'oae-activity/lib/constants.js';
import { ContentConstants } from 'oae-content/lib/constants.js';
import { FoldersConstants } from 'oae-folders/lib/constants.js';

ActivityAPI.registerActivityType(FoldersConstants.activity.ACTIVITY_FOLDER_CREATE, {
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
 * Post a folder-create activity when a user creates a folder
 */
FoldersAPI.emitter.on(FoldersConstants.events.CREATED_FOLDER, (ctx, folder, memberChangeInfo) => {
  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const objectResource = new ActivityModel.ActivitySeedResource('folder', folder.id, { folder });
  let targetResource = null;

  // Get the extra members
  const extraMembers = _.chain(memberChangeInfo.members.added).pluck('id').without(ctx.user().id).value();

  // If we only added 1 extra user or group, we set the target to that entity
  if (extraMembers.length === 1) {
    const targetResourceType = PrincipalsUtil.isGroup(extraMembers[0]) ? 'group' : 'user';
    targetResource = new ActivityModel.ActivitySeedResource(targetResourceType, extraMembers[0]);
  }

  // Generate the activity seed and post it to the queue
  const activitySeed = new ActivityModel.ActivitySeed(
    FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
    millis,
    ActivityConstants.verbs.CREATE,
    actorResource,
    objectResource,
    targetResource
  );
  ActivityAPI.postActivity(ctx, activitySeed);
});

/// ///////////////////////
// FOLDER-ADD-TO-FOLDER //
/// ///////////////////////

ActivityAPI.registerActivityType(FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER, {
  // Simon added Content A and B to folder X
  // Simon added Content A, B and C to folder Y
  groupBy: [{ target: true }],
  streams: {
    activity: {
      router: {
        actor: ['self', 'followers'],
        object: ['managers'],
        target: ['members']
      }
    },
    notification: {
      router: {
        target: ['members']
      }
    },
    email: {
      router: {
        target: ['members']
      }
    }
  }
});

/*!
 * Post a folder-add-to-folder activity when a user adds content items to a folder
 */
FoldersAPI.emitter.on(FoldersConstants.events.ADDED_CONTENT_ITEMS, (ctx, actionContext, folder, contentItems) => {
  // Ignore activities triggered by content-create
  if (actionContext !== 'content-create') {
    const millis = Date.now();
    const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
      user: ctx.user()
    });
    const targetResource = new ActivityModel.ActivitySeedResource('folder', folder.id, {
      folder
    });
    _.each(contentItems, (content) => {
      const objectResource = new ActivityModel.ActivitySeedResource('content', content.id, {
        content
      });
      const activitySeed = new ActivityModel.ActivitySeed(
        FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER,
        millis,
        ActivityConstants.verbs.ADD,
        actorResource,
        objectResource,
        targetResource
      );
      ActivityAPI.postActivity(ctx, activitySeed);
    });
  }
});

/// ////////////////////////////////////////////
// FOLDER-UPDATE and FOLDER-UPDATE-VISIBILITY//
/// ////////////////////////////////////////////

ActivityAPI.registerActivityType(FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE, {
  groupBy: [{ actor: true }],
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

ActivityAPI.registerActivityType(FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_VISIBILITY, {
  groupBy: [{ actor: true }],
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
 * Post a folder-update activity when a user updates a folder
 */
FoldersAPI.emitter.on(FoldersConstants.events.UPDATED_FOLDER, (ctx, oldFolder, updatedFolder) => {
  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const objectResource = new ActivityModel.ActivitySeedResource('folder', updatedFolder.id, {
    folder: updatedFolder
  });

  let activityType = null;
  if (updatedFolder.visibility === oldFolder.visibility) {
    activityType = FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE;
  } else {
    activityType = FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_VISIBILITY;
  }

  const activitySeed = new ActivityModel.ActivitySeed(
    activityType,
    millis,
    ActivityConstants.verbs.UPDATE,
    actorResource,
    objectResource
  );
  ActivityAPI.postActivity(ctx, activitySeed);
});

/// /////////////////
// FOLDER-COMMENT //
/// /////////////////

ActivityAPI.registerActivityType(FoldersConstants.activity.ACTIVITY_FOLDER_COMMENT, {
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
        // Route the activity to the folder
        target: ['self']
      }
    }
  }
});

/*!
 * Post a folder-comment activity when a user comments on a folder
 */
FoldersAPI.emitter.on(FoldersConstants.events.CREATED_COMMENT, (ctx, message, folder) => {
  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const objectResource = new ActivityModel.ActivitySeedResource('folder-comment', message.id, {
    folderId: folder.id,
    message
  });
  const targetResource = new ActivityModel.ActivitySeedResource('folder', folder.id, { folder });
  const activitySeed = new ActivityModel.ActivitySeed(
    FoldersConstants.activity.ACTIVITY_FOLDER_COMMENT,
    millis,
    ActivityConstants.verbs.POST,
    actorResource,
    objectResource,
    targetResource
  );
  ActivityAPI.postActivity(ctx, activitySeed);
});

/// /////////////////////////////////////////////
// FOLDER-SHARE and FOLDER-UPDATE-MEMBER-ROLE //
/// /////////////////////////////////////////////

ActivityAPI.registerActivityType(FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_LIBRARY, {
  // "Branden Visser added 5 folders to his library"
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

ActivityAPI.registerActivityType(FoldersConstants.activity.ACTIVITY_FOLDER_SHARE, {
  groupBy: [
    // "Branden Visser shared Folder with 5 users and groups"
    { actor: true, object: true },

    // "Branden Visser shared 8 folders with OAE Team"
    { actor: true, target: true }
  ],
  streams: {
    activity: {
      router: {
        actor: ['self', 'followers'],
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

ActivityAPI.registerActivityType(FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE, {
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

FoldersAPI.emitter.on(FoldersConstants.events.UPDATED_FOLDER_MEMBERS, (ctx, folder, memberChangeInfo, opts) => {
  if (opts.invitation) {
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
  const folderResource = new ActivityModel.ActivitySeedResource('folder', folder.id, { folder });

  // When a user is added, it is considered either a folder-share or a folder-add-to-library
  // activity, depending on whether the added user is the current user in context
  _.each(addedMemberIds, (memberId) => {
    if (memberId === ctx.user().id) {
      // Users can't "share" with themselves, they actually "add it to their library"
      ActivityAPI.postActivity(
        ctx,
        new ActivityModel.ActivitySeed(
          FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_LIBRARY,
          millis,
          ActivityConstants.verbs.ADD,
          actorResource,
          folderResource
        )
      );
    } else {
      // A user shared a folder with some other user, fire the folder share activity
      const principalResourceType = PrincipalsUtil.isGroup(memberId) ? 'group' : 'user';
      const principalResource = new ActivityModel.ActivitySeedResource(principalResourceType, memberId);
      ActivityAPI.postActivity(
        ctx,
        new ActivityModel.ActivitySeed(
          FoldersConstants.activity.ACTIVITY_FOLDER_SHARE,
          millis,
          ActivityConstants.verbs.SHARE,
          actorResource,
          folderResource,
          principalResource
        )
      );
    }
  });

  // When a user's role is updated, we fire a "folder-update-member-role" activity
  _.each(updatedMemberIds, (memberId) => {
    const principalResourceType = PrincipalsUtil.isGroup(memberId) ? 'group' : 'user';
    const principalResource = new ActivityModel.ActivitySeedResource(principalResourceType, memberId);
    ActivityAPI.postActivity(
      ctx,
      new ActivityModel.ActivitySeed(
        FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
        millis,
        ActivityConstants.verbs.UPDATE,
        actorResource,
        principalResource,
        folderResource
      )
    );
  });
});

/// ////////////////////////
// ACTIVITY ENTITY TYPES //
/// ////////////////////////

/*!
 * Produces a persistent 'folder' activity entity
 * @see ActivityAPI#registerActivityEntityType
 */
const _folderProducer = function (resource, callback) {
  const folder = resource.resourceData && resource.resourceData.folder ? resource.resourceData.folder : null;

  // If the folder was fired with the resource, use it instead of fetching
  if (folder) {
    return callback(null, _createPersistentFolderActivityEntity(folder));
  }

  FoldersDAO.getFolder(resource.resourceId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    return callback(null, _createPersistentFolderActivityEntity(folder));
  });
};

/*!
 * Transform the folder persistent activity entities into UI-friendly ones
 * @see ActivityAPI#registerActivityEntityType
 */
const _folderTransformer = function (ctx, activityEntities, callback) {
  // Collect all the folder ids so we can fetch their preview data
  let folderIds = [];
  // eslint-disable-next-line no-unused-vars
  _.each(activityEntities, (entities, activityId) => {
    // eslint-disable-next-line no-unused-vars
    _.each(entities, (entity, entityId) => {
      folderIds.push(entity.folder.id);
    });
  });
  folderIds = _.uniq(folderIds);

  // Grab the latest folder objects
  FoldersDAO.getFoldersByIds(folderIds, (err, folders) => {
    if (err) {
      return callback(err);
    }

    const foldersById = _.indexBy(folders, 'id');
    const transformedActivityEntities = {};
    _.each(activityEntities, (entitiesPerActivity, activityId) => {
      transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
      _.each(entitiesPerActivity, (entity, entityId) => {
        transformedActivityEntities[activityId][entityId] = _transformPersistentFolderActivityEntity(
          ctx,
          entity,
          foldersById
        );
      });
    });

    return callback(null, transformedActivityEntities);
  });
};

/*!
 * Produces a persistent activity entity that represents a comment that was posted
 * @see ActivityAPI#registerActivityEntityType
 */
const _folderCommentProducer = function (resource, callback) {
  const { message, folderId } = resource.resourceData;
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    MessageBoxUtil.createPersistentMessageActivityEntity(message, (err, entity) => {
      if (err) {
        return callback(err);
      }

      // Store the folder id and visibility on the entity as these are required for routing the activities
      entity.objectType = 'folder-comment';
      entity.folderId = folder.id;
      entity.folderVisibility = folder.visibility;
      return callback(null, entity);
    });
  });
};

/*!
 * Transform the persisted comment activity entities into UI-friendly ones
 * @see ActivityAPI#registerActivityEntityType
 */
const _folderCommentTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};
  _.keys(activityEntities).forEach((activityId) => {
    transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
    _.keys(activityEntities[activityId]).forEach((entityId) => {
      const entity = activityEntities[activityId][entityId];
      const { folderId } = entity;
      const resource = AuthzUtil.getResourceFromId(folderId);
      const profilePath = '/folder/' + resource.tenantAlias + '/' + resource.resourceId;
      const urlFormat = '/api/folder/' + folderId + '/messages/%s';
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
 * Transform the persisted comment activity entities into UI-friendly ones
 * @see ActivityAPI#registerActivityEntityType
 */
const _folderCommentInternalTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};
  _.keys(activityEntities).forEach((activityId) => {
    transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
    _.keys(activityEntities[activityId]).forEach((entityId) => {
      const entity = activityEntities[activityId][entityId];
      transformedActivityEntities[activityId][entityId] =
        MessageBoxUtil.transformPersistentMessageActivityEntityToInternal(ctx, entity.message);
    });
  });
  return callback(null, transformedActivityEntities);
};

ActivityAPI.registerActivityEntityType('folder', {
  producer: _folderProducer,
  transformer: {
    activitystreams: _folderTransformer,
    internal: _folderTransformer
  },
  propagation(associationsCtx, entity, callback) {
    ActivityUtil.getStandardResourcePropagation(entity.folder.visibility, AuthzConstants.joinable.NO, callback);
  }
});

ActivityAPI.registerActivityEntityType('folder-comment', {
  producer: _folderCommentProducer,
  transformer: {
    activitystreams: _folderCommentTransformer,
    internal: _folderCommentInternalTransformer
  },
  propagation(associationsCtx, entity, callback) {
    return callback(null, [{ type: ActivityConstants.entityPropagation.ALL }]);
  }
});

/// ///////////////////////////////
// ACTIVITY ENTITY ASSOCIATIONS //
/// ///////////////////////////////

/*!
 * Register an association that presents the folder
 */
ActivityAPI.registerActivityEntityAssociation('folder', 'self', (associationsCtx, entity, callback) => {
  return callback(null, [entity[ActivityConstants.properties.OAE_ID]]);
});

/*!
 * Register an association that presents the members of a folder categorized by role
 */
ActivityAPI.registerActivityEntityAssociation('folder', 'members-by-role', (associationsCtx, entity, callback) => {
  ActivityUtil.getAllAuthzMembersByRole(entity[FoldersConstants.activity.PROP_OAE_GROUP_ID], callback);
});

/*!
 * Register an association that presents all the indirect members of a folder
 */
ActivityAPI.registerActivityEntityAssociation('folder', 'members', (associationsCtx, entity, callback) => {
  associationsCtx.get('members-by-role', (err, membersByRole) => {
    if (err) {
      return callback(err);
    }

    return callback(null, _.flatten(_.values(membersByRole)));
  });
});

/*!
 * Register an association that presents all the managers of a content item
 */
ActivityAPI.registerActivityEntityAssociation('folder', 'managers', (associationsCtx, entity, callback) => {
  associationsCtx.get('members-by-role', (err, membersByRole) => {
    if (err) {
      return callback(err);
    }

    return callback(null, membersByRole[AuthzConstants.role.MANAGER]);
  });
});

/*!
 * Register an assocation that presents all the commenting contributors of a folder
 */
ActivityAPI.registerActivityEntityAssociation('folder', 'message-contributors', (associationsCtx, entity, callback) => {
  MessageBoxAPI.getRecentContributions(entity[ActivityConstants.properties.OAE_ID], null, 100, callback);
});

/*!
 * Register an association that presents the folder for a folder-comment entity
 */
ActivityAPI.registerActivityEntityAssociation('folder-comment', 'self', (associationsCtx, entity, callback) => {
  return callback(null, [entity.folderId]);
});

/**
 * Create the persistent folder entity that can be transformed into an activity entity for the UI.
 *
 * @param  {Folder}     folder      The folder that provides the data for the entity
 * @return {Object}                 An object containing the entity data that can be transformed into a UI folder activity entity
 * @api private
 */
const _createPersistentFolderActivityEntity = function (folder) {
  const opts = { folder };
  opts[FoldersConstants.activity.PROP_OAE_GROUP_ID] = folder.groupId;
  return new ActivityModel.ActivityEntity('folder', folder.id, folder.visibility, opts);
};

/**
 * Transform a folder object into an activity entity suitable to be displayed in an activity stream.
 *
 * For more details on the transformed entity model, @see ActivityAPI#registerActivityEntityTransformer
 *
 * @param  {Context}            ctx                 Standard context object containing the current user and the current tenant
 * @param  {Object}             entity              The persisted activity entity to transform
 * @param  {Object}             foldersById         A set of folders keyed against their folder id
 * @return {ActivityEntity}                         The activity entity that represents the given folder
 */
const _transformPersistentFolderActivityEntity = function (ctx, entity, foldersById) {
  // Grab the folder from the `foldersById` hash as it would contain the updated
  // previews object. If it can't be found (because it has been deleted) we fall
  // back to the folder that was provided in the activity
  const folderId = entity.folder.id;
  const folder = foldersById[folderId] || entity.folder;

  const tenant = ctx.tenant();
  const baseUrl = TenantsUtil.getBaseUrl(tenant);
  const globalId = baseUrl + '/api/folder/' + folder.id;
  const profileUrl = baseUrl + folder.profilePath;
  const opts = {
    displayName: folder.displayName,
    url: profileUrl,
    ext: {}
  };
  opts.ext[ActivityConstants.properties.OAE_ID] = folder.id;
  opts.ext[ActivityConstants.properties.OAE_VISIBILITY] = folder.visibility;
  opts.ext[ActivityConstants.properties.OAE_PROFILEPATH] = folder.profilePath;

  if (folder.previews && folder.previews.thumbnailUri) {
    const thumbnailUrl = ContentUtil.getSignedDownloadUrl(ctx, folder.previews.thumbnailUri, -1);
    opts.image = new ActivityModel.ActivityMediaLink(
      thumbnailUrl,
      PreviewConstants.SIZES.IMAGE.THUMBNAIL,
      PreviewConstants.SIZES.IMAGE.THUMBNAIL
    );
  }

  if (folder.previews && folder.previews.wideUri) {
    const wideUrl = ContentUtil.getSignedDownloadUrl(ctx, folder.previews.wideUri, -1);
    opts.ext[ContentConstants.activity.PROP_OAE_WIDE_IMAGE] = new ActivityModel.ActivityMediaLink(
      wideUrl,
      PreviewConstants.SIZES.IMAGE.WIDE_WIDTH,
      PreviewConstants.SIZES.IMAGE.WIDE_HEIGHT
    );
  }

  return new ActivityModel.ActivityEntity('folder', globalId, folder.visibility, opts);
};
