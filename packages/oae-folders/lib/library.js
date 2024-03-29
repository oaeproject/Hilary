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

import * as AuthzAPI from 'oae-authz';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as ContentAPI from 'oae-content';
import Counter from 'oae-util/lib/counter.js';
import * as LibraryAPI from 'oae-library';
import * as OaeUtil from 'oae-util/lib/util.js';

import { logger } from 'oae-logger';

import * as FoldersAPI from 'oae-folders';
import * as FoldersAuthz from 'oae-folders/lib/authz.js';
import * as FoldersContentLibrary from 'oae-folders/lib/internal/content-library.js';
import * as FoldersDAO from 'oae-folders/lib/internal/dao.js';
import * as FoldersFoldersLibrary from 'oae-folders/lib/internal/folders-library.js';

import { FoldersConstants } from 'oae-folders/lib/constants.js';
import { ContentConstants } from 'oae-content/lib/constants.js';

const log = logger('oae-folders-library');

// When updating folders in a principal folders library, update at most once every hour to
// avoid thrashing the libraries with updates and causing duplicates
const LIBRARY_UPDATE_THRESHOLD_SECONDS = 3600;

// Keep track of libraries that are being purged. This allows
// the tests to know when all libraries have been purged
const purgeCounter = new Counter();

/**
 * Invoke the handler the next time all libraries are purged. If there
 * are no libraries being purged when this is invoked, the handler
 * is invoked immediately
 *
 * @param  {Function}   handler     The handler to invoke when all libraries have been purged
 */
const whenAllPurged = function (handler) {
  purgeCounter.whenZero(handler);
};

/*!
 * Register a library indexer that can provide resources to reindex the folders library
 */
LibraryAPI.Index.registerLibraryIndex(FoldersConstants.library.FOLDERS_LIBRARY_INDEX_NAME, {
  pageResources(libraryId, start, limit, callback) {
    // Query all the group ids ('g') to which the principal is directly associated in this
    // batch of paged resources. Since the group can be a member of both user groups and
    // folder groups, we filter down to just the folder groups for folder libraries
    AuthzAPI.getRolesForPrincipalAndResourceType(libraryId, 'g', start, limit, (error, roles, nextToken) => {
      if (error) {
        return callback(error);
      }

      // We just need the ids, not the roles
      const ids = _.pluck(roles, 'id');
      FoldersDAO.getFoldersByGroupIds(ids, (error, folders) => {
        if (error) {
          return callback(error);
        }

        // Remove empty items, which indicates they mapped to user groups and not folder
        // groups
        folders = _.compact(folders);

        // Convert all the folders into the light-weight library items that describe how
        // they are placed in a library index
        const resources = _.map(folders, (folder) => ({ rank: folder.lastModified, resource: folder }));

        return callback(null, resources, nextToken);
      });
    });
  }
});

/*!
 * Register a library indexer that can provide resources to reindex the folder content library
 */
LibraryAPI.Index.registerLibraryIndex(FoldersConstants.library.CONTENT_LIBRARY_INDEX_NAME, {
  pageResources(libraryId, start, limit, callback) {
    const options = {
      fields: ['contentId', 'tenantAlias', 'visibility', 'lastModified'],
      start,
      limit
    };

    // Page through the content items that are in the folder to build the library resources
    FoldersDAO.getContentItems(libraryId, options, (error, contentItems, nextToken) => {
      if (error) {
        return callback(error);
      }

      // Convert all the content into the light-weight library items that describe how
      // they are placed in a library index
      const resources = _.map(contentItems, (contentItem) => ({
        rank: contentItem.lastModified,
        resource: contentItem
      }));

      return callback(null, resources, nextToken);
    });
  }
});

/*!
 * Configure the search endpoint that allows you to search for content in a folder
 */
LibraryAPI.Search.registerLibrarySearch('folder-content', ['content'], {
  getLibraryOwner(folderId, callback) {
    FoldersDAO.getFolder(folderId, (error, folder) => {
      if (error) {
        return callback(error);
      }

      // We use the *groupId* as a "direct member" of content in the search index
      const library = folder;
      library.indexedId = folder.groupId;
      return callback(null, library);
    });
  }
});

/*!
 * Configure the search endpoint that allows you to search for folders in a principal's library
 */
LibraryAPI.Search.registerLibrarySearch('folder-library', ['folder']);

/*!
 * When a folder is created, insert it into all folder libraries that it becomes a part of
 */
FoldersAPI.emitter.when(FoldersConstants.events.CREATED_FOLDER, (ctx, folder, memberChangeInfo, callback) => {
  const addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
  FoldersFoldersLibrary.insert(addedMemberIds, folder, (error) => {
    if (error) {
      log().warn(
        {
          err: error,
          folderId: folder.id,
          memberIds: addedMemberIds
        },
        'An error occurred while inserting a folder into folder libraries after create'
      );
    }

    return callback();
  });
});

/*!
 * When a folder is updated, we need to update the folder libraries it's in
 */
FoldersAPI.emitter.on(FoldersConstants.events.UPDATED_FOLDER, (ctx, updatedFolder, oldFolder) => {
  // Keep track of the async operation
  purgeCounter.incr();

  _getAllMemberIds(updatedFolder.groupId, (error, memberIds) => {
    if (error) {
      purgeCounter.decr();
      return log().error({ err: error, updatedFolder }, 'An error occurred while retrieving the members for a folder');
    }

    FoldersFoldersLibrary.update(memberIds, updatedFolder, oldFolder.lastModified, (error) => {
      if (error) {
        purgeCounter.decr();
        return log().error({ err: error, updatedFolder }, 'Could not update the folder libraries for a set of users');
      }

      // At this point the async operation is over
      return purgeCounter.decr();
    });
  });
});

/*!
 * When a folder gets deleted we remove it as an authz member of all the content items
 * it contained. Eventually we also purge all its content libraries
 */
FoldersAPI.emitter.when(FoldersConstants.events.DELETED_FOLDER, (ctx, folder, removedMemberIds, callback) => {
  // Keep track of the async operation
  purgeCounter.incr();

  // Purge the content library as it's no longer needed
  FoldersContentLibrary.purge(folder, (error) => {
    if (error) {
      log().error(
        {
          err: error,
          folderId: folder.id,
          folderGroupId: folder.groupId
        },
        'Unable to purge a folder content library'
      );
    }

    FoldersFoldersLibrary.remove(removedMemberIds, folder, (error) => {
      if (error) {
        log().error(
          {
            err: error,
            folderId: folder.id,
            folderGroupId: folder.groupId,
            removedMemberIds
          },
          'An error occurred while purging a folder content library'
        );
      }

      purgeCounter.decr();
      return callback();
    });
  });
});

/**
 * When a folder members are updated, pass the required updates to its members library as well
 * as all the folder libraries that contain the discussion
 */
FoldersAPI.emitter.when(
  FoldersConstants.events.UPDATED_FOLDER_MEMBERS,
  (ctx, folder, memberChangeInfo, options, callback) => {
    purgeCounter.incr();

    const addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
    // Const updatedMemberIds = _.pluck(memberChangeInfo.members.updated, 'id');
    const removedMemberIds = _.pluck(memberChangeInfo.members.removed, 'id');

    // Insert the folder into the libraries of new members
    FoldersFoldersLibrary.insert(addedMemberIds, folder, (error) => {
      if (error) {
        log(ctx).warn(
          {
            err: error,
            folderId: folder.id,
            principalIds: addedMemberIds
          },
          'An error occurred while adding folder to member libraries after role assignment'
        );
      }

      // Remove the folder from the libraries of removed members
      FoldersFoldersLibrary.remove(removedMemberIds, folder, (error) => {
        if (error) {
          log(ctx).warn(
            {
              err: error,
              folderId: folder.id,
              principalIds: removedMemberIds
            },
            'An error occurred while removing folder from member libraries after role removal'
          );
        }

        /**
         * TODO: Test timestamp doesn't update with subsequent set-permissions
         * For all current members, update the folder in their libraries. This includes
         * members that were just added which is a bit of a waste, but easier to code
         */
        const memberIdsAfterUpdate = _.keys(memberChangeInfo.roles.after);
        OaeUtil.invokeIfNecessary(
          _testLibraryUpdateThreshold(folder),
          FoldersFoldersLibrary.update,
          memberIdsAfterUpdate,
          folder,
          null,
          (error) => {
            if (error) {
              log(ctx).warn(
                {
                  err: error,
                  folderId: folder.id,
                  principalIds: memberIdsAfterUpdate
                },
                'An error occurred while updating folder in member libraries after having permissions updated'
              );
            }

            purgeCounter.decr();
            return callback();
          }
        );
      });
    });
  }
);

/*!
 * When a new comment is created for the folder, update its last modified date and update its
 * rank in all folders libraries
 */
FoldersAPI.emitter.on(FoldersConstants.events.CREATED_COMMENT, (ctx, message, folder) => {
  if (_testLibraryUpdateThreshold(folder)) {
    purgeCounter.incr();

    // Try and get the principals whose libraries will be updated
    _getAllMemberIds(folder.groupId, (error, memberIds) => {
      if (error) {
        // There isn't much we can do at this point other than log an error
        purgeCounter.decr();
        return log().warn(
          {
            err: error,
            folderId: folder.id
          },
          'Error fetching folder members list to update library. Skipping updating libraries'
        );
      }

      // Bump the `lastModified` timestamp and update the folder libraries for all of the
      // members
      FoldersFoldersLibrary.update(memberIds, folder, null, (error) => {
        if (error) {
          // There isn't much we can do at this point other than log an error
          log().warn(
            {
              err: error,
              folderId: folder.id
            },
            'Error updating the folder libraries when a message came in'
          );
        }

        purgeCounter.decr();
      });
    });
  }
});

/*!
 * When a content item is updated, we need to re-insert it into all the folders that
 * contain it. There are multiple reasons for this:
 *
 *  1.  The visibility might have changed. We need to insert the content item in the
 *      correct visibility bucket
 *
 *  2.  The `lastModified` timestamp on the content object has changed, which means
 *      the `rank` of the item in the library is outdated. Re-inserting the item
 *      resolves this
 *
 *  3.  We need to bump the last updated items in a library to the top. By re-inserting
 *      the content item with its latest `lastModified` timestamp this will be achieved
 */
ContentAPI.emitter.on(ContentConstants.events.UPDATED_CONTENT, (ctx, newContentObject, oldContentObject) => {
  purgeCounter.incr();

  // Purge all the libraries this content item was in
  FoldersAuthz.getFoldersForContent(newContentObject.id, (error, folders) => {
    if (error) {
      // The error is logged further down the chain, there isn't much more that we can do
      purgeCounter.decr();
      return;
    }

    // Remove and insert the content item from the folder-content library so its placed
    // in the correct visibility bucket
    _.each(folders, (folder) => {
      purgeCounter.incr();

      // Remove the content item from the old visibility bucket
      FoldersContentLibrary.remove(folder, [oldContentObject], (error) => {
        if (error) {
          log().error(
            { err: error, folder: folder.folderId, contentId: oldContentObject.id },
            "Unable to update a folder's content library"
          );
        }

        // Insert the content item in the proper visibility bucket
        FoldersContentLibrary.insert(folder, [newContentObject], (error) => {
          if (error) {
            log().error(
              { err: error, folder: folder.folderId, contentId: oldContentObject.id },
              "Unable to update a folder's content library"
            );
          }

          purgeCounter.decr();
        });
      });
    });

    purgeCounter.decr();
  });
});

/*!
 * When a content item is removed, we need to remove it from the folders it's in
 */
ContentAPI.emitter.on(ContentConstants.events.DELETED_CONTENT, (ctx, contentObject, members) => {
  // Keep track of the async operation
  purgeCounter.incr();

  // Get all the folder that contained this piece of content
  const groupIds = AuthzUtil.getGroupIds(members);
  FoldersDAO.getFoldersByGroupIds(groupIds, (error, folders) => {
    if (error) {
      purgeCounter.decr();
      log().error({ err: error, contentId: contentObject.id }, 'Unable to remove content from a folder');
      return;
    }

    // Remove the piece of content from each folder
    _.each(folders, (folder) => {
      purgeCounter.incr();

      FoldersContentLibrary.remove(folder, [contentObject], () => {
        purgeCounter.decr();
      });
    });

    purgeCounter.decr();
  });
});

/**
 * Get all members of the specified group id
 *
 * @param  {String}     groupId             The id of the group whose member ids to get
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String[]}   callback.memberIds  The ids of the members of the group
 * @api private
 */
const _getAllMemberIds = function (groupId, callback) {
  AuthzAPI.getAllAuthzMembers(groupId, (error, memberIdRoles) => {
    if (error) {
      return callback(error);
    }

    return callback(null, _.pluck(memberIdRoles, 'id'));
  });
};

/**
 * Given a folder, determine if sufficient time has passed since it's last update to re-order it
 * once again in user and group principal libraries
 *
 * @param  {Folder}     folder      The folder whose last modified date to test
 * @return {Boolean}                `true` if the folder can be updated in user and group libraries
 * @api private
 */
const _testLibraryUpdateThreshold = function (folder) {
  return !folder.lastModified || Date.now() - folder.lastModified > LIBRARY_UPDATE_THRESHOLD_SECONDS * 1000;
};

export { whenAllPurged };
