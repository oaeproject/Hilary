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

import util from 'util';
import _ from 'underscore';
import { logger } from 'oae-logger';
import { setUpConfig } from 'oae-config';

import * as AuthzAPI from 'oae-authz';
import * as AuthzInvitations from 'oae-authz/lib/invitations';
import * as AuthzPermissions from 'oae-authz/lib/permissions';
import * as ContentAPI from 'oae-content';
import * as ContentDAO from 'oae-content/lib/internal/dao';
import * as ContentUtil from 'oae-content/lib/internal/util';
import * as EmitterAPI from 'oae-emitter';
import * as LibraryAPI from 'oae-library';

import * as MessageBoxAPI from 'oae-messagebox';
import * as OaeUtil from 'oae-util/lib/util';
import * as GroupAPI from 'oae-principals/lib/api.group';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao';
import * as PrincipalsUtil from 'oae-principals/lib/util';
import * as ResourceActions from 'oae-resource/lib/actions';
import * as SearchAPI from 'oae-search';
import * as Signature from 'oae-util/lib/signature';
import { MessageBoxConstants } from 'oae-messagebox/lib/constants';
import { AuthzConstants } from 'oae-authz/lib/constants';
import { Validator as validator } from 'oae-util/lib/validator';
const {
  getNestedObject,
  makeSureThat,
  ifNotThenThrow,
  isLoggedInUser,
  isUserId,
  isPrincipalId,
  isNotEmpty,
  isANumber,
  isObject
} = validator;
import pipe from 'ramda/src/pipe';
import isIn from 'validator/lib/isIn';
import isInt from 'validator/lib/isInt';
import * as FoldersFoldersLibrary from './internal/foldersLibrary';
import * as FoldersAuthz from './authz';
import * as FoldersContentLibrary from './internal/contentLibrary';
import * as FoldersDAO from './internal/dao';

import { FoldersConstants } from './constants';

const log = logger('oae-folders-api');

const FoldersConfig = setUpConfig('oae-folders');

/*!
 * ### Events
 *
 * * `getFolderProfile(ctx, folder)`: A folder profile was retrieved
 * * `createdFolder(ctx, folder, members)`: A new folder was created
 * * `updatedFolder(ctx, oldFolder, newFolder)`: A folder was updated
 * * `deletedFolder(ctx, folder, memberIds)`: A folder was deleted
 * * `updatedFolderMembers(ctx, folder, memberUpdates, addedMemberIds, updatedMemberIds, removedMemberIds)`: The members of a folder have been updated
 * * `updatedFolderVisibility(ctx, folder, visibility, affectedContentItems, failedContentItems)`: The content items in a folder their visibility have been updated
 * * `addedContentItems(ctx, actionContext, folder, contentItems)`: One or more content items were added to a folder
 * * `removedContentItems(ctx, folder, contentIds)`: One or more content items were removed from a folder
 * * `createdComment(ctx, folder, message)`: A comment was placed on a folder
 */
const FoldersAPI = new EmitterAPI.EventEmitter();

/**
 * Create a folder
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         displayName             The display name of the folder
 * @param  {String}         [description]           The description of the folder. By default, a folder will have no description
 * @param  {String}         [visibility]            The visibility of the folder. One of `AuthzConstants.visibility`. This will default to a value configured for the tenant
 * @param  {Object}         [roles]                 An object whose keys are principal ids and values are the role they should have on the folder. By default only the creator of the folder will be a manager
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Folder}         callback.folder         The folder that was created
 */
const createFolder = function(ctx, displayName, description, visibility, roles, callback) {
  visibility = visibility || FoldersConfig.getValue(ctx.tenant().alias, 'visibility', 'folder');
  roles = roles || {};

  const allVisibilities = _.values(AuthzConstants.visibility);

  // Verify basic properties
  try {
    pipe(
      validator.isLoggedInUser,
      validator.generateError({
        code: 401,
        msg: 'Anonymous users cannot create a folder'
      })
    )(ctx);

    pipe(
      validator.isNotEmpty,
      validator.generateError({
        code: 400,
        msg: 'Must provide a display name for the folder'
      })
    )(displayName);

    pipe(
      validator.isShortString,
      validator.generateError({
        code: 400,
        msg: 'A display name can be at most 1000 characters long'
      })
    )(displayName);
  } catch (error) {
    return callback(error);
  }

  if (description) {
    try {
      pipe(
        validator.isMediumString,
        validator.generateError({
          code: 400,
          msg: 'A description can be at most 10000 characters long'
        })
      )(description);
    } catch (error) {
      return callback(error);
    }
  }

  try {
    pipe(
      isIn,
      validator.generateError({
        code: 400,
        msg: 'An invalid folder visibility option has been provided. Must be one of: ' + allVisibilities.join(', ')
      })
    )(visibility, allVisibilities);
  } catch (error) {
    return callback(error);
  }

  // Verify each role is valid
  try {
    _.each(roles, role => {
      pipe(
        isIn,
        validator.generateError({
          code: 400,
          msg: util.format('The role "%s" is not a valid member role for a folder', role)
        })
      )(role, FoldersConstants.role.ALL_PRIORITY);
    });
  } catch (error) {
    return callback(error);
  }

  // Check if the current user can manage any of the specified managers
  const managerIds = _.chain(roles)
    .keys()
    .filter(principalId => {
      return roles[principalId] === AuthzConstants.role.MANAGER;
    })
    .value();
  GroupAPI.canManageAny(ctx, managerIds, (err, canManageAny) => {
    if (err && err.code !== 404) {
      return callback(err);
    }

    if (err) {
      return callback({ code: 400, msg: 'One or more target principals could not be found' });
    }

    if (!canManageAny) {
      // We only make the current user a manager of the folder if they cannot
      // manage any of the specified managers
      roles[ctx.user().id] = AuthzConstants.role.MANAGER;
    }

    const createFn = _.partial(FoldersDAO.createFolder, ctx.user().id, displayName, description, visibility);
    ResourceActions.create(ctx, roles, createFn, (err, folder, memberChangeInfo) => {
      if (err) {
        return callback(err);
      }

      FoldersAPI.emit(FoldersConstants.events.CREATED_FOLDER, ctx, folder, memberChangeInfo, errs => {
        if (errs) {
          return callback(_.first(errs));
        }

        return callback(null, folder);
      });
    });
  });
};

/**
 * Update a folder's metadata
 *
 * @param  {Context}        ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}         folderId                        The id of the folder to update
 * @param  {Object}         updates                         The updates that should be persisted on the folder
 * @param  {String}         [updates.displayName]           The new display name for the folder
 * @param  {String}         [updates.description]           The new description for the folder
 * @param  {String}         [updates.visibility]            The new visibility for the folder
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Folder}         callback.folder                 The updated folder
 */
const updateFolder = function(ctx, folderId, updates, callback) {
  const allVisibilities = _.values(AuthzConstants.visibility);

  try {
    pipe(
      validator.isLoggedInUser,
      validator.generateError({
        code: 401,
        msg: 'Anonymous users cannot create a folder'
      })
    )(ctx);

    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: util.format('The folder id "%s" is not a valid resource id', folderId)
      })
    )(folderId);

    pipe(
      validator.isObject,
      validator.generateError({
        code: 400,
        msg: 'Missing update information'
      })
    )(updates, updates);
  } catch (error) {
    return callback(error);
  }

  // Ensure that at least one valid update field was provided
  const updateFields = _.keys(updates);
  const legalUpdateFields = ['displayName', 'description', 'visibility'];

  try {
    pipe(
      validator.isArrayNotEmpty,
      ifNotThenThrow({
        code: 400,
        msg: 'One of ' + legalUpdateFields.join(', ') + ' must be provided'
      })
    )(_.intersection(updateFields, legalUpdateFields));
  } catch (error) {
    return callback(error);
  }

  try {
    _.each(updates, (val, key) => {
      pipe(
        isIn,
        validator.generateError({
          code: 400,
          msg: 'Unknown update field provided'
        })
      )(key, legalUpdateFields);
    });
  } catch (error) {
    return callback(error);
  }

  if (updates.displayName) {
    try {
      pipe(
        validator.isShortString,
        validator.generateError({
          code: 400,
          msg: 'A display name can be at most 1000 characters long'
        })
      )(updates.displayName);
    } catch (error) {
      return callback(error);
    }
  }

  if (updates.description) {
    try {
      pipe(
        validator.isMediumString,
        validator.generateError({
          code: 400,
          msg: 'A description can be at most 10000 characters long'
        })
      )(updates.description);
    } catch (error) {
      return callback(error);
    }
  }

  if (updates.visibility) {
    try {
      pipe(
        isIn,
        validator.generateError({
          code: 400,
          msg: 'An invalid folder visibility option has been provided. Must be one of: ' + allVisibilities.join(', ')
        })
      )(updates.visibility, allVisibilities);
    } catch (error) {
      return callback(error);
    }
  }

  // Get the folder from storage to use for permission checks
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Ensure the current user can manage the folder
    AuthzPermissions.canManage(ctx, folder, err => {
      if (err) {
        return callback(err);
      }

      // Update the folder's metadata
      FoldersDAO.updateFolder(folder, updates, (err, updatedFolder) => {
        if (err) {
          return callback(err);
        }

        FoldersAPI.emit(FoldersConstants.events.UPDATED_FOLDER, ctx, updatedFolder, folder);

        // Get the full folder profile for the updated folder
        return _getFullFolderProfile(ctx, updatedFolder, callback);
      });
    });
  });
};

/**
 * Update the content items in a folder
 *
 * @param  {Context}        ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}         folderId                        The id of the folder for which to update the visibility of the content items
 * @param  {String}         visibility                      The new visibility for the content items in the folder
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Content[]}      callback.failedContent          The content items that could not be updated
 */
const updateFolderContentVisibility = function(ctx, folderId, visibility, callback) {
  const allVisibilities = _.values(AuthzConstants.visibility);

  try {
    pipe(
      validator.isLoggedInUser,
      validator.generateError({
        code: 401,
        msg: 'Anonymous users cannot update the visibility of items in a folder'
      })
    )(ctx);

    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: util.format('The folder id "%s" is not a valid resource id', folderId)
      })
    )(folderId);

    pipe(
      validator.isNotEmpty,
      validator.generateError({
        code: 400,
        msg: 'Missing visibility value'
      })
    )(visibility);

    pipe(
      isIn,
      validator.generateError({
        code: 400,
        msg: 'An invalid folder visibility option has been provided. Must be one of: ' + allVisibilities.join(', ')
      })
    )(visibility, allVisibilities);
  } catch (error) {
    return callback(error);
  }

  // Get the folder from storage to use for permission checks
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Ensure the current user can manage the folder
    AuthzPermissions.canManage(ctx, folder, err => {
      if (err) {
        return callback(err);
      }

      // Apply the visibility on all the content items in the folder
      _updateFolderContentVisibility(ctx, folder, visibility, callback);
    });
  });
};

/**
 * Set the `newVisibility` visibility on all the content items in the folder. This function
 * assumes that the current user has manager rights on the given folder.
 *
 * Keep in mind that this is *NOT* a lightweight operation. The following actions will take place:
 *   -  The private folder library needs to be listed (to retrieve the content ids)
 *   -  All those content items need to be retrieved
 *   -  All those content items need to be updated
 *       -  Because each content item can have it own set of permissions, we need to check
 *          each content item at a time
 *       -  This means an authz check happens PER content item
 *   -  Each update triggers a search reindex of the content item
 *   -  Purges the folder content library
 *
 * @param  {Context}        ctx                         Standard context object containing the current user and the current tenant
 * @param  {Folder}         folder                      The folder for which to update the visibility of the content items
 * @param  {String}         visibility                  The new visibility for the content items
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Content[]}      callback.failedContent      The content items that could not be updated
 * @api private
 */
const _updateFolderContentVisibility = function(ctx, folder, visibility, callback) {
  // Get all the content items in this folder
  FoldersAuthz.getContentInFolder(folder, (err, contentIds) => {
    if (err) {
      log().error({ err, folderId: folder.id }, 'Got an error when updating the visibility of content in a folder');
      return callback(err);
    }

    // Get the content objects
    ContentDAO.Content.getMultipleContentItems(contentIds, null, (err, contentItems) => {
      if (err) {
        log().error({ err, folderId: folder.id }, 'Got an error when updating the visibility of content in a folder');
        return callback(err);
      }

      contentItems = _.chain(contentItems)
        // Remove null content items. This can happen if libraries are in an inconsistent
        // state. For example, if an item was deleted from the system but hasn't been removed
        // from the libraries, a `null` value would be returned by `getMultipleContentItems`
        .compact()

        // Grab those content items that don't have the desired visibility
        .filter(content => {
          return content.visibility !== visibility;
        })
        .value();

      const failedContent = [];

      /*!
       * Executed once all the content items have been updated
       */
      const done = function() {
        FoldersContentLibrary.purge(folder, err => {
          if (err) {
            return callback(err);
          }

          // Sign the previews for each content item
          _.each(failedContent, content => {
            ContentUtil.augmentContent(ctx, content);
          });

          FoldersAPI.emit(
            FoldersConstants.events.UPDATED_FOLDER_VISIBILITY,
            ctx,
            folder,
            visibility,
            contentItems,
            failedContent
          );
          return callback(null, failedContent);
        });
      };

      /*!
       * Update a batch of content items
       */
      const updateBatch = function() {
        // If there are no items to update, we can move on
        if (_.isEmpty(contentItems)) {
          return done();
        }

        // Get the next batch of content items that should be updated
        const contentItemsToUpdate = contentItems.splice(0, 20);

        // We move on to the next batch once all content items in the current batch have been updated
        const contentUpdated = _.after(contentItemsToUpdate.length, updateBatch);

        // Try and update each content item
        _.each(contentItemsToUpdate, content => {
          _updateContentVisibility(ctx, content, visibility, err => {
            if (err) {
              failedContent.push(content);
            }

            contentUpdated();
          });
        });
      };

      // Update the first batch of content items
      updateBatch();
    });
  });
};

/**
 * Update the visibility of a given content item. This function will update
 * the visibility of the content item if, and only if, the current user has
 * manager rights on that item. It will *NOT* trigger any content-update activities
 *
 * @param  {Context}        ctx                         Standard context object containing the current user and the current tenant
 * @param  {Folder}         content                     The content item for which to update the visibility
 * @param  {String}         visibility                  The new visibility of the content item
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @api private
 */
const _updateContentVisibility = function(ctx, content, visibility, callback) {
  AuthzPermissions.canManage(ctx, content, err => {
    if (err) {
      return callback(err);
    }

    ContentDAO.Content.updateContent(content, { visibility }, true, err => {
      if (err) {
        return callback(err);
      }

      // Because we updated the visibility with the DAO, we'll need to
      // manually trigger a search reindexing event
      SearchAPI.postIndexTask('content', [{ id: content.id }], {
        resource: true
      });

      // Return to the caller
      return callback();
    });
  });
};

/**
 * Get a folder by its id
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         folderId            The id of the folder to get
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Folder}         callback.folder     The folder identified by the given id
 */
const getFolder = function(ctx, folderId, callback) {
  try {
    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: util.format('The folder id "%s" is not a valid resource id', folderId)
      })
    )(folderId);
  } catch (error) {
    return callback(error);
  }

  // Get the folder from storage to use for permission checks
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Ensure the current user can view the folder
    AuthzPermissions.canView(ctx, folder, err => {
      if (err) {
        return callback(err);
      }

      // Sign the folder previews (if any)
      folder = _augmentFolder(ctx, folder);

      // Return the folder to the user
      return callback(null, folder);
    });
  });
};

/**
 * Get the full folder profile, which includes additional information about the relation of the
 * current user to the folder
 *
 * @param  {Context}        ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}         folderId                        The id of the folder whose full profile to get
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Folder}         callback.folder                 The basic profile of the folder, with some additional information provided
 * @param  {Boolean}        callback.folder.canManage       Whether or not the current user can manage the folder
 * @param  {Boolean}        callback.folder.canShare        Whether or not the current user can share the folder
 * @param  {Boolean}        callback.folder.canAddItem      Whether or not the current user can add a content item to the folder
 * @param  {User}           callback.folder.createdBy       The basic profile of the user who created the folder
 */
const getFullFolderProfile = function(ctx, folderId, callback) {
  try {
    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: util.format('The folder id "%s" is not a valid resource id', folderId)
      })
    )(folderId);
  } catch (error) {
    return callback(error);
  }

  // Get the folder from storage to use for permissions checks
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    _getFullFolderProfile(ctx, folder, callback);
  });
};

/**
 * Get a full folder profile. Next to the basic folder profile, this will include the profile of the user who originally
 * created the profile, a set of properties that determine whether the folder can be managed, shared or content can be
 * added to it by the current user and finally a signature that allows the user to sign up for push notifications relating
 * to the folder
 *
 * @param  {Context}        ctx                             Standard context object containing the current user and the current tenant
 * @param  {Folder}         folder                          The folder whose full profile to get
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Folder}         callback.folder                 The full folder profile
 * @param  {Boolean}        callback.folder.canManage       Whether or not the current user can manage the folder
 * @param  {Boolean}        callback.folder.canShare        Whether or not the current user can share the folder
 * @param  {Boolean}        callback.folder.canAddItem      Whether or not the current user can add a content item to the folder
 * @param  {User}           callback.folder.createdBy       The basic profile of the user who created the folder
 * @api private
 */
const _getFullFolderProfile = function(ctx, folder, callback) {
  AuthzPermissions.resolveEffectivePermissions(ctx, folder, (err, permissions) => {
    if (err) {
      return callback(err);
    }

    if (!permissions.canView) {
      return callback({ code: 401, msg: 'You are not authorized to view this folder' });
    }

    // Sign the folder previews (if any)
    folder = _augmentFolder(ctx, folder);

    folder.canManage = permissions.canManage;
    folder.canShare = permissions.canShare;
    folder.canAddItem = permissions.canManage;

    if (ctx.user()) {
      // Add a signature that can be used to subscribe to push notifications
      folder.signature = Signature.createExpiringResourceSignature(ctx, folder.id);
    }

    // Populate the creator of the folder
    PrincipalsUtil.getPrincipal(ctx, folder.createdBy, (err, creator) => {
      if (err) {
        log(ctx).warn(
          {
            err,
            userId: folder.createdBy,
            folderId: folder.id
          },
          'An error occurred getting the creator of a folder. Proceeding with empty user for full profile'
        );
      }

      if (creator) {
        folder.createdBy = creator;
      }

      FoldersAPI.emit(FoldersConstants.events.GET_FOLDER_PROFILE, ctx, folder);
      return callback(null, folder);
    });
  });
};

/**
 * Delete a folder
 *
 * @param  {Context}        ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}         folderId                    The id of the folder to delete
 * @param  {Boolean}        deleteContent               Whether or not to delete the content that's in the folder
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Content[]}      callback.failedContent      The content items that could not be deleted
 */
const deleteFolder = function(ctx, folderId, deleteContent, callback) {
  try {
    pipe(validator.isResourceId, ifNotThenThrow({ code: 400, msg: 'a folder id must be provided' }))(folderId);

    pipe(
      validator.isLoggedInUser,
      validator.generateError({
        code: 401,
        msg: 'You must be authenticated to delete a folder'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    AuthzPermissions.canManage(ctx, folder, err => {
      if (err) {
        return callback(err);
      }

      _deleteFolder(folder, (err, memberIds) => {
        if (err) {
          return callback(err);
        }

        // eslint-disable-next-line no-unused-vars
        FoldersAPI.emit(FoldersConstants.events.DELETED_FOLDER, ctx, folder, memberIds, errs => {
          // Get all the content items that were in this folder so we can either
          // remove the content items or remove the authz link
          FoldersAuthz.getContentInFolder(folder, (err, contentIds) => {
            if (err) {
              return callback(err);
            }

            // Delete the content if we were instructed to do so
            if (deleteContent) {
              _deleteContent(ctx, contentIds, failedContent => {
                // Get the content objects that we couldn't delete
                ContentDAO.Content.getMultipleContentItems(failedContent, null, (err, contentItems) => {
                  if (err) {
                    return callback(err);
                  }

                  _.chain(contentItems)
                    // Remove null content items. This can happen if libraries are in an inconsistent
                    // state. For example, if an item was deleted from the system but hasn't been removed
                    // from the libraries, a `null` value would be returned by `getMultipleContentItems`
                    .compact()

                    // Sign the content items, note that we don't have to do any permission
                    // checks here, as the user had access to these content items by virtue
                    // of being a member of the folder
                    .each(contentItem => {
                      ContentUtil.augmentContent(ctx, contentItem);
                    });

                  return callback(null, contentItems);
                });
              });

              // Otherwise remove the folder as an authz member of
              // all the content items
            } else {
              return _removeAuthzFolderFromContentItems(folder, contentIds, callback);
            }
          });
        });
      });
    });
  });
};

/**
 * Delete a folder. This function will not perform any access checks.
 *
 * @param  {Folder}         folder                  The folder that should be removed
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error object, if any
 * @param  {String[]}       callback.memberIds      The ids of the principals who were members of this folder
 * @api private
 */
const _deleteFolder = function(folder, callback) {
  // Get all the principal ids who are a member of this folder
  AuthzAPI.getAllAuthzMembers(folder.groupId, (err, memberRoles) => {
    if (err) {
      return callback(err);
    }

    // Remove each principal from this folder
    const memberIds = _.pluck(memberRoles, 'id');
    const roleChanges = {};
    _.each(memberIds, memberId => {
      roleChanges[memberId] = false;
    });

    // Update the authz associations
    AuthzAPI.updateRoles(folder.groupId, roleChanges, err => {
      if (err) {
        return callback(err);
      }

      // Remove the actual folder
      FoldersDAO.deleteFolder(folder.id, err => {
        if (err) {
          return callback(err);
        }

        return callback(null, memberIds);
      });
    });
  });
};

/**
 * Delete a set of content items
 *
 * @param  {Context}        ctx                         Standard context object containing the current user and the current tenant
 * @param  {String[]}       contentIds                  The ids of the content items to remove
 * @param  {Function}       callback                    Standard callback function
 * @param  {Content[]}      callback.failedContent      The content items that could not be deleted
 * @api private
 */
const _deleteContent = function(ctx, contentIds, callback, _failedContent) {
  _failedContent = _failedContent || [];

  // If there are no items to delete, we can return to the caller
  if (contentIds.length === 0) {
    return callback(_failedContent);
  }

  // In order to not overload the database with a massive amount of queries
  // we delete the content items in batches
  const contentIdsToDelete = contentIds.splice(0, 20);

  // Only proceed to the next batch if all content from this batch has been removed
  const done = _.after(contentIdsToDelete.length, () => {
    _deleteContent(ctx, contentIds, callback, _failedContent);
  });

  // Delete each content item
  _.each(contentIdsToDelete, contentId => {
    ContentAPI.deleteContent(ctx, contentId, err => {
      // Keep track of the content items that could not be deleted
      if (err) {
        _failedContent.push(contentId);
      }

      done();
    });
  });
};

/**
 * Remove the authz membership between a folder and a set of content items
 *
 * @param  {Folder}     folder          The folder for which to remove the authz membership
 * @param  {String[]}   contentIds      The content ids for which to remove the authz membership
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error object, if any
 * @api private
 */
const _removeAuthzFolderFromContentItems = function(folder, contentIds, callback) {
  if (_.isEmpty(contentIds)) {
    return callback();
  }

  // In order to not overload the database with a massive amount of queries
  // we remove the authz link in batches
  const contentIdsToDelete = contentIds.splice(0, 20);

  // Only proceed to the next batch if all links in this batch have been removed
  const done = _.after(contentIdsToDelete.length, () => {
    _removeAuthzFolderFromContentItems(folder, contentIds, callback);
  });

  // Remove the link between the content items and the folder
  _.each(contentIdsToDelete, contentId => {
    // Remove the folder as an authz member
    const roleChange = {};
    roleChange[folder.groupId] = false;
    AuthzAPI.updateRoles(contentId, roleChange, err => {
      if (err) {
        log().error(
          {
            err,
            folderId: folder.id,
            folderGroupId: folder.groupId,
            contentId
          },
          'Unable to remove the folder from a group'
        );
      }

      done();
    });
  });
};

/**
 * List the members of a folder
 *
 * @param  {Context}        ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}         folderId                        The id of the folder whose members to get
 * @param  {String}         [start]                         A token that indicates where in the list to start returning members. Use the `nextToken` result from this method to determine where to start the next page of members
 * @param  {Number}         [limit]                         The maximum number of members to return
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Object[]}       callback.results                An array of objects indicating the members of the folder and their roles
 * @param  {User|Group}     callback.results[i].profile     The basic profile of the user or group who is a member of the folder
 * @param  {String}         callback.results[i].role        The role of the user or group on the folder
 * @param  {String}         callback.nextToken              The token to use for the next `start` value in order to get the next page of members. If this value is `null`, it indicates that there are no more members to page
 */
const getFolderMembers = function(ctx, folderId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: 'A folder id must be provided'
      })
    )(folderId);
  } catch (error) {
    return callback(error);
  }

  getFolder(ctx, folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Get the folder members
    AuthzAPI.getAuthzMembers(folder.groupId, start, limit, (err, memberRoles, nextToken) => {
      if (err) {
        return callback(err);
      }

      // Get the basic profiles for all of these principals
      PrincipalsUtil.getPrincipals(ctx, _.pluck(memberRoles, 'id'), (err, memberProfiles) => {
        if (err) {
          return callback(err);
        }

        // Merge the member profiles and roles into a single object
        const memberList = _.map(memberRoles, memberRole => {
          return {
            profile: memberProfiles[memberRole.id],
            role: memberRole.role
          };
        });

        return callback(null, memberList, nextToken);
      });
    });
  });
};

/**
 * Get the invitations for the specified folder
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         folderId                The id of the folder to get the invitations for
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Invitation[]}   callback.invitations    The invitations
 */
const getFolderInvitations = function(ctx, folderId, callback) {
  try {
    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: 'A valid resource id must be specified'
      })
    )(folderId);
  } catch (error) {
    return callback(error);
  }

  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    return AuthzInvitations.getAllInvitations(ctx, folder, callback);
  });
};

/**
 * Resend an invitation email for the specified email and folder
 *
 * @param  {Context}        ctx             Standard context object containing the current user and the current tenant
 * @param  {String}         folderId        The id of the folder to which the email was invited
 * @param  {String}         email           The email that was previously invited
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
const resendFolderInvitation = function(ctx, folderId, email, callback) {
  try {
    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: 'A valid resource id must be specified'
      })
    )(folderId);
  } catch (error) {
    return callback(error);
  }

  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    return ResourceActions.resendInvitation(ctx, folder, email, callback);
  });
};

/**
 * Share a folder with a set of users and groups. All users and groups who are shared the
 * folder will be given the `member` role. However, if they already have a different role, the
 * existing role will not be changed
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     folderId        The id of the folder to share
 * @param  {String[]}   principalIds    The ids of the users and groups with whom to share the folder
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const shareFolder = function(ctx, folderId, principalIds, callback) {
  try {
    pipe(
      validator.isLoggedInUser,
      validator.generateError({
        code: 401,
        msg: 'You have to be logged in to be able to share a folder'
      })
    )(ctx);

    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: 'A valid folder id must be provided'
      })
    )(folderId);
  } catch (error) {
    return callback(error);
  }

  // Ensure the folder exists
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Perform the share operation
    ResourceActions.share(ctx, folder, principalIds, AuthzConstants.role.VIEWER, (err, memberChangeInfo) => {
      if (err) {
        return callback(err);
      }

      if (_.isEmpty(memberChangeInfo.changes)) {
        // If no new members were actually added, we don't have to do anything more
        return callback();
      }

      FoldersAPI.emit(FoldersConstants.events.UPDATED_FOLDER_MEMBERS, ctx, folder, memberChangeInfo, {}, errs => {
        if (errs) {
          return callback(_.first(errs));
        }

        return callback();
      });
    });
  });
};

/**
 * Set permissions to the folder. This is similar to sharing a folder, however rather than
 * only giving users and groups the `member` role, other roles can be applied and also users and
 * groups can be removed from the folder membership
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     folderId        The id of the folder whose permissions to set
 * @param  {Object}     changes         An object whose key is the user or group id to set on the folder, and the value is the role you wish them to have. If the role of a user is set to `false`, then it indicates to remove the user from the folder
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const setFolderPermissions = function(ctx, folderId, changes, callback) {
  try {
    pipe(
      validator.isLoggedInUser,
      validator.generateError({
        code: 401,
        msg: 'You have to be logged in to be able to change folder permissions'
      })
    )(ctx);

    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: 'A valid folder id must be provided'
      })
    )(folderId);
  } catch (error) {
    return callback(error);
  }

  // eslint-disable-next-line no-unused-vars
  try {
    _.each(changes, (role, principalId) => {
      pipe(
        validator.isValidRoleChange,
        validator.generateError({
          code: 400,
          msg: 'The role change: ' + role + ' is not a valid value. Must either be a string, or false'
        })
      )(role);

      if (role) {
        pipe(
          isIn,
          validator.generateError({
            code: 400,
            msg:
              'The role: "' +
              role +
              '" is not a valid value. Must be one of: ' +
              FoldersConstants.role.ALL_PRIORITY.join(', ') +
              '; or false'
          })
        )(role, FoldersConstants.role.ALL_PRIORITY);
      }
    });
  } catch (error) {
    return callback(error);
  }

  // Get the folder object, throwing an error if it doesn't exist, but not applying permissions checks
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Set the folder roles
    ResourceActions.setRoles(ctx, folder, changes, (err, memberChangeInfo) => {
      if (err) {
        return callback(err);
      }

      if (_.isEmpty(memberChangeInfo.changes)) {
        return callback();
      }

      FoldersAPI.emit(FoldersConstants.events.UPDATED_FOLDER_MEMBERS, ctx, folder, memberChangeInfo, {}, errs => {
        if (errs) {
          return callback(_.first(errs));
        }

        return callback();
      });
    });
  });
};

/**
 * Add a set of content items to a folder
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     folderId        The id of the folder to which to add the content items
 * @param  {String[]}   contentIds      The ids of the content items to add to the folder
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const addContentItemsToFolder = function(ctx, folderId, contentIds, callback) {
  try {
    pipe(
      validator.isLoggedInUser,
      validator.generateError({
        code: 401,
        msg: 'You have to be authenticated to be able to add an item to a folder'
      })
    )(ctx);

    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: 'A valid folder id must be provided'
      })
    )(folderId);

    pipe(
      validator.isArray,
      validator.generateError({
        code: 400,
        msg: 'Must specify at least one content item to add'
      })
    )(contentIds);

    pipe(
      validator.isArrayNotEmpty,
      validator.generateError({
        code: 400,
        msg: 'You must specify at least one content item to add'
      })
    )(_.values(contentIds));

    // Ensure each content id is valid
    _.each(contentIds, contentId => {
      pipe(
        validator.isResourceId,
        validator.generateError({
          code: 400,
          msg: util.format('The id "%s" is not a valid content id', contentId)
        })
      )(contentId);
    });
  } catch (error) {
    return callback(error);
  }

  // Get the folder to which we're trying to add the content items
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Get the content profiles of all items being added for permission checks
    ContentDAO.Content.getMultipleContentItems(contentIds, null, (err, contentItems) => {
      if (err) {
        return callback(err);
      }

      // Return an error if one or more content items could not be found
      contentItems = _.compact(contentItems);
      if (contentItems.length !== contentIds.length) {
        return callback({
          code: 404,
          msg: 'One or more of the specified content items do not exist'
        });
      }

      // Determine if the content items can be added to the folder
      FoldersAuthz.canAddItemsToFolder(ctx, folder, contentItems, err => {
        if (err && err.code !== 401) {
          return callback(err);
        }

        if (err && !_.isEmpty(err.invalidContentIds)) {
          return callback({
            code: 401,
            msg: util.format(
              'You are not authorized to add the following items to the folder: %s',
              err.invalidContentIds.join(', ')
            )
          });
        }

        if (err) {
          return callback(err);
        }

        // Add all the items to the folder
        return _addContentItemsToFolderLibrary(ctx, 'add-to-folder', folder, contentItems.slice(), callback);
      });
    });
  });
};

/**
 * Add content items to a folder. Note that this method does *NOT* perform any
 * permission or validation checks.
 *
 * @param  {String}         actionContext       One of `content-create` or `add-to-folder`
 * @param  {Folder}         folder              The folder to which to add the content items
 * @param  {Content[]}      contentItems        The content items to add
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error object, if any
 * @api private
 */
const _addContentItemsToFolderLibrary = function(ctx, actionContext, folder, contentItems, callback) {
  // First, make the folder a member of all the content items
  _addContentItemsToAuthzFolder(folder, contentItems.slice(), err => {
    if (err) {
      return callback(err);
    }

    // Second, add the content items in the folder's library buckets
    FoldersContentLibrary.insert(folder, contentItems, err => {
      if (err) {
        log(ctx).warn(
          {
            err,
            folderId: folder.id,
            contentIds: _.pluck(contentItems, 'id')
          },
          'An error occurred while inserting content items into a folder library'
        );
      }

      FoldersAPI.emit(FoldersConstants.events.ADDED_CONTENT_ITEMS, ctx, actionContext, folder, contentItems);

      return callback(err);
    });
  });
};

/**
 * Remove a set of content items from a folder
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     folderId        The id of the folder from which to remove the content items
 * @param  {String[]}   contentIds      The ids of the content items to remove from the folder
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const removeContentItemsFromFolder = function(ctx, folderId, contentIds, callback) {
  try {
    pipe(
      validator.isLoggedInUser,
      validator.generateError({
        code: 401,
        msg: 'You have to be authenticated to be able to remove an item from a folder'
      })
    )(ctx);

    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: 'A valid folder id must be provided'
      })
    )(folderId);

    pipe(
      validator.isArray,
      validator.generateError({
        code: 400,
        msg: 'You must specify at least one content item to remove'
      })
    )(contentIds);

    pipe(
      validator.isArrayNotEmpty,
      validator.generateError({
        code: 400,
        msg: 'You must specify at least one content item to remove'
      })
    )(_.values(contentIds));

    // Ensure each content id is valid
    _.each(contentIds, contentId => {
      pipe(
        validator.isResourceId,
        ifNotThenThrow({
          code: 400,
          msg: util.format('The id "%s" is not a valid content id', contentId)
        })
      )(contentId);
    });
  } catch (error) {
    return callback(error);
  }

  // Get the folder from which we're trying to remove the content items
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Ensure that the user is allowed to remove items from this folder
    AuthzPermissions.canManage(ctx, folder, err => {
      if (err) {
        return callback(err);
      }

      // Get the content profiles of all items being removed
      ContentDAO.Content.getMultipleContentItems(contentIds, null, (err, contentItems) => {
        if (err) {
          return callback(err);
        }

        // Return an error if one or more content items could not be found
        contentItems = _.compact(contentItems);
        if (contentItems.length !== contentIds.length) {
          return callback({
            code: 404,
            msg: 'One or more of the specified content items do not exist'
          });
        }

        // Remove all the items from the folder
        _removeContentItemsFromFolder(folder, contentIds.slice(), err => {
          if (err) {
            return callback(err);
          }

          FoldersContentLibrary.remove(folder, contentItems, err => {
            if (err) {
              log(ctx).warn(
                {
                  err,
                  folderId: folder.id,
                  contentIds
                },
                'An error occurred while removing content items from a folder library'
              );
            }

            FoldersAPI.emit(FoldersConstants.events.REMOVED_CONTENT_ITEMS, ctx, folder, contentItems);
            return callback();
          });
        });
      });
    });
  });
};

/**
 * List a user or group library of folders
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         principalId             The id of the user or group whose library of folders to list
 * @param  {String}         [start]                 A token that indicates where in the list to start returning folders. Use the `nextToken` result from this method to determine where to start the next page of folders
 * @param  {Number}         [limit]                 The maximum number of folders to return
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Folder[]}       callback.folders        The list of folders
 * @param  {String}         callback.nextToken      The token to use for the next `start` value in order to get the next page of folders. If this value is `null`, it indicates that there are no more folders to page
 */
const getFoldersLibrary = function(ctx, principalId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      validator.isPrincipalId,
      validator.generateError({
        code: 400,
        msg: 'A user or group id must be provided'
      })
    )(principalId);
  } catch (error) {
    return callback(error);
  }

  // Get the principal
  PrincipalsDAO.getPrincipal(principalId, (err, principal) => {
    if (err) {
      return callback(err);
    }

    // Determine which library visibility the current user should receive
    LibraryAPI.Authz.resolveTargetLibraryAccess(ctx, principal.id, principal, (err, hasAccess, visibility) => {
      if (err) {
        return callback(err);
      }

      if (!hasAccess) {
        return callback({ code: 401, msg: 'You do not have have access to this library' });
      }

      // Get the folder ids from the library index
      FoldersFoldersLibrary.list(principal, visibility, { start, limit }, (err, folderIds, nextToken) => {
        if (err) {
          return callback(err);
        }

        // Get the folder objects from the folderIds
        FoldersDAO.getFoldersByIds(folderIds, (err, folders) => {
          if (err) {
            return callback(err);
          }

          folders = _.map(folders, folder => {
            return _augmentFolder(ctx, folder);
          });

          // Emit an event indicating that the folder library has been retrieved
          FoldersAPI.emit(
            FoldersConstants.events.GET_FOLDERS_LIBRARY,
            ctx,
            principalId,
            visibility,
            start,
            limit,
            folders
          );

          return callback(null, folders, nextToken);
        });
      });
    });
  });
};

/**
 * Get the folders that are managed by the current user
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Folder[]}       callback.folders        The folders which the current user can manage
 */
const getManagedFolders = function(ctx, callback) {
  if (!ctx.user()) {
    return callback({ code: 401, msg: 'Anonymous users cannot manage folders' });
  }

  // Get all the groups this user is a member of
  AuthzAPI.getRolesForPrincipalAndResourceType(ctx.user().id, 'g', null, 1000, (err, roles) => {
    if (err) {
      return callback(err);
    }

    // Get all the groups the user manages
    const managedGroupIds = _.chain(roles)
      .filter(role => {
        return role.role === AuthzConstants.role.MANAGER;
      })
      .map(role => {
        return role.id;
      })
      .value();

    // Get all the folders that match these groups
    FoldersDAO.getFoldersByGroupIds(managedGroupIds, (err, folders) => {
      if (err) {
        return callback(err);
      }

      folders = _.chain(folders)
        // Because we retrieved all the folders that this user manages
        // we sort them, so they can be displayed immediately
        .sort((a, b) => {
          return a.displayName.localeCompare(b.displayName);
        })

        // Augment the folder with the signed preview urls
        .map(folder => {
          return _augmentFolder(ctx, folder);
        })
        .value();

      return callback(null, folders);
    });
  });
};

/**
 * Remove a folder from a principal's library
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         principalId         The principal id of the library from which to remove this folder
 * @param  {String}         folderId            The id of the folder that should be removed
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 */
const removeFolderFromLibrary = function(ctx, principalId, folderId, callback) {
  try {
    pipe(
      validator.isLoggedInUser,
      validator.generateError({
        code: 401,
        msg: 'You must be authenticated to remove a folder from a library'
      })
    )(ctx);

    pipe(
      validator.isPrincipalId,
      validator.generateError({
        code: 400,
        msg: 'A user or group id must be provided'
      })
    )(principalId);

    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: 'A valid folder id must be provided'
      })
    )(folderId);
  } catch (error) {
    return callback(error);
  }

  // Make sure the folder exists
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Make sure the target user exists
    PrincipalsDAO.getPrincipal(principalId, (err, principal) => {
      if (err) {
        return callback(err);
      }

      // Verify the current user has access to remove folders from the target library
      AuthzPermissions.canRemoveRole(ctx, principal, folder, (err, memberChangeInfo) => {
        if (err) {
          return callback(err);
        }

        // All validation checks have passed, finally persist the role change and update the library
        AuthzAPI.updateRoles(folder.groupId, memberChangeInfo.changes, err => {
          if (err) {
            return callback(err);
          }

          FoldersAPI.emit(FoldersConstants.events.UPDATED_FOLDER_MEMBERS, ctx, folder, memberChangeInfo, {}, errs => {
            if (errs) {
              return callback(_.first(errs));
            }

            return callback();
          });
        });
      });
    });
  });
};

/**
 * List the library of content items that have been added to a folder
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         folderId                The id of the folder whose content library to list
 * @param  {String}         [start]                 A token that indicates where in the list to start returning content items. Use the `nextToken` result from this method to determine where to start the next page of content items
 * @param  {Number}         [limit]                 The maximum number of content items to return
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Folder[]}       callback.contentItems   The list of content items in the folder library
 * @param  {String}         callback.nextToken      The token to use for the next `start` value in order to get the next page of content items. If this value is `null`, it indicates that there are no more content items to page
 */
const getFolderContentLibrary = function(ctx, folderId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: 'A folder id must be provided'
      })
    )(folderId);
  } catch (error) {
    return callback(error);
  }

  // Get the folder
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Determine which library visibility the current user should receive
    LibraryAPI.Authz.resolveTargetLibraryAccess(ctx, folder.groupId, folder, (err, hasAccess, visibility) => {
      if (err) {
        return callback(err);
      }

      if (!hasAccess) {
        return callback({ code: 401, msg: 'You do not have access to this folder' });
      }

      FoldersContentLibrary.list(folder, visibility, { start, limit }, (err, contentIds, nextToken) => {
        if (err) {
          return callback(err);
        }

        ContentDAO.Content.getMultipleContentItems(contentIds, null, (err, contentItems) => {
          if (err) {
            return callback(err);
          }

          contentItems = _.chain(contentItems)
            // Remove null content items. This can happen if libraries are in an inconsistent
            // state. For example, if an item was deleted from the system but hasn't been removed
            // from the libraries, a `null` value would be returned by `getMultipleContentItems`
            .compact()

            // Augment each content item with its signed preview urls
            .each(contentItem => {
              ContentUtil.augmentContent(ctx, contentItem);
            })
            .value();

          return callback(null, contentItems, nextToken);
        });
      });
    });
  });
};

/// ///////////
// Comments //
/// ///////////

/**
 * Create a new message in a folder. If `replyToCreatedTimestamp` is specified, the message will be
 * a reply to the message in the folder identified by that timestamp.
 *
 * @param  {Context}            ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}             folderId                        The id of the folder to which to post the message
 * @param  {String}             body                            The body of the message
 * @param  {String|Number}      [replyToCreatedTimestamp]       The timestamp of the message to which this message is a reply. Not specifying this will create a top level message
 * @param  {Function}           callback                        Standard callback function
 * @param  {Object}             callback.err                    An error that occurred, if any
 * @param  {Message}            callback.message                The created message
 */
const createMessage = function(ctx, folderId, body, replyToCreatedTimestamp, callback) {
  try {
    pipe(
      validator.isLoggedInUser,
      validator.generateError({
        code: 401,
        msg: 'Only authenticated users can post to folders'
      })
    )(ctx);

    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: 'Invalid folder id provided'
      })
    )(folderId);

    pipe(
      validator.isNotEmpty,
      validator.generateError({
        code: 400,
        msg: 'A message body must be provided'
      })
    )(body);

    pipe(
      validator.isLongString,
      validator.generateError({
        code: 400,
        msg: 'A message body can only be 100000 characters long'
      })
    )(body);
  } catch (error) {
    return callback(error);
  }

  if (replyToCreatedTimestamp) {
    try {
      pipe(
        isInt,
        validator.generateError({
          code: 400,
          msg: 'Invalid reply-to timestamp provided'
        })
      )(String(replyToCreatedTimestamp));
    } catch (error) {
      return callback(error);
    }
  }

  // Get the folder from storage to use for permission checks
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Ensure the current user can view the folder
    AuthzPermissions.canInteract(ctx, folder, err => {
      if (err) {
        return callback(err);
      }

      // Create the message
      MessageBoxAPI.createMessage(
        folderId,
        ctx.user().id,
        body,
        { replyToCreated: replyToCreatedTimestamp },
        (err, message) => {
          if (err) {
            return callback(err);
          }

          // Get a UI-appropriate representation of the current user
          PrincipalsUtil.getPrincipal(ctx, ctx.user().id, (err, createdBy) => {
            if (err) {
              return callback(err);
            }

            message.createdBy = createdBy;

            // The message has been created in the database so we can emit the `createdComment` event
            FoldersAPI.emit(FoldersConstants.events.CREATED_COMMENT, ctx, message, folder, errs => {
              if (errs) {
                return callback(_.first(errs));
              }

              return callback(null, message);
            });
          });
        }
      );
    });
  });
};

/**
 * Delete a message in a folder. Managers of the folder can delete all messages while people that have access
 * to the folder can only delete their own messages. Therefore, anonymous users will never be able to delete messages.
 *
 * @param  {Context}        ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}         folderId                    The id of the folder from which to delete the message
 * @param  {Number}         messageCreatedDate          The timestamp of the message that should be deleted
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Comment}        [callback.softDeleted]      When the message has been soft deleted (because it has replies), a stripped down message object representing the deleted message will be returned, with the `deleted` parameter set to `false`. If the message has been deleted from the index, no message object will be returned
 */
const deleteMessage = function(ctx, folderId, messageCreatedDate, callback) {
  try {
    pipe(
      validator.isLoggedInUser,
      validator.generateError({
        code: 401,
        msg: 'Only authenticated users can delete messages'
      })
    )(ctx);

    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: 'A folder id must be provided'
      })
    )(folderId);

    pipe(
      isInt,
      validator.generateError({
        code: 400,
        msg: 'A valid integer message created timestamp must be specified'
      })
    )(String(messageCreatedDate));
  } catch (error) {
    return callback(error);
  }

  // Get the folder from storage to use for permission checks
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Ensure that the message exists. We also need it so we can make sure we have access to delete it
    MessageBoxAPI.getMessages(folderId, [messageCreatedDate], { scrubDeleted: false }, (err, messages) => {
      if (err) {
        return callback(err);
      }

      if (!messages[0]) {
        return callback({ code: 404, msg: 'The specified message does not exist' });
      }

      const message = messages[0];

      // Determine if we have access to delete the folder message
      AuthzPermissions.canManageMessage(ctx, folder, message, err => {
        if (err) {
          return callback(err);
        }

        // Delete the message using the "leaf" method, which will SOFT delete if the message has replies, or HARD delete if it does not
        MessageBoxAPI.deleteMessage(
          folderId,
          messageCreatedDate,
          { deleteType: MessageBoxConstants.deleteTypes.LEAF },
          (err, deleteType, deletedMessage) => {
            if (err) {
              return callback(err);
            }

            FoldersAPI.emit(FoldersConstants.events.DELETED_COMMENT, ctx, message, folder, deleteType);

            // If a soft-delete occurred, we want to inform the consumer of the soft-delete message model
            if (deleteType === MessageBoxConstants.deleteTypes.SOFT) {
              return callback(null, deletedMessage);
            }

            return callback();
          }
        );
      });
    });
  });
};

/**
 * Get the messages in a folder
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         folderId                The id of the folder for which to get the messages
 * @param  {String}         [start]                 The `threadKey` of the message from which to start retrieving messages (exclusively). By default, will start fetching from the most recent message
 * @param  {Number}         [limit]                 The maximum number of results to return. Default: 10
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Message[]}      callback.messages       The messages in the folder. Of the type `MessageBoxModel#Message`
 * @param  {String}         callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 */
const getMessages = function(ctx, folderId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      validator.isResourceId,
      validator.generateError({
        code: 400,
        msg: 'Must provide a valid folder id'
      })
    )(folderId);

    pipe(
      isInt,
      validator.generateError({
        code: 400,
        msg: 'Must provide a valid limit'
      })
    )(String(limit));
  } catch (error) {
    return callback(error);
  }

  // Get the folder from storage to use for permission checks
  FoldersDAO.getFolder(folderId, (err, folder) => {
    if (err) {
      return callback(err);
    }

    // Ensure the current user can view the folder
    AuthzPermissions.canView(ctx, folder, err => {
      if (err) {
        return callback(err);
      }

      // Fetch the messages from the message box
      MessageBoxAPI.getMessagesFromMessageBox(folderId, start, limit, null, (err, messages, nextToken) => {
        if (err) {
          return callback(err);
        }

        // Get the unique user ids from the messages so we can retrieve their full user objects
        const userIds = _.chain(messages)
          .map(message => {
            return message.createdBy;
          })
          .uniq()
          .compact()
          .value();

        // Get the basic principal profiles of the messagers
        PrincipalsUtil.getPrincipals(ctx, userIds, (err, users) => {
          if (err) {
            return callback(err);
          }

          // Attach the user profiles to the message objects
          _.each(messages, message => {
            if (users[message.createdBy]) {
              message.createdBy = users[message.createdBy];
            }
          });

          return callback(err, messages, nextToken);
        });
      });
    });
  });
};

/**
 * Recursively add the given list of content items to the given folder. This method is
 * destructive to the `contentItems` parameter as it iterates
 *
 * @param  {Folder}         folder          The folder to which to add the content items
 * @param  {Content[]}      contentItems    The content items to add to the folder
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 * @api private
 */
const _addContentItemsToAuthzFolder = function(folder, contentItems, callback) {
  if (_.isEmpty(contentItems)) {
    return callback();
  }

  const roleChange = {};
  roleChange[folder.groupId] = AuthzConstants.role.VIEWER;

  const contentItem = contentItems.pop();
  AuthzAPI.updateRoles(contentItem.id, roleChange, err => {
    if (err) {
      return callback(err);
    }

    return _addContentItemsToAuthzFolder(folder, contentItems, callback);
  });
};

/**
 * Recursively remove the given list of content items from the given folder. This method is
 * destructive to the `contentIds` parameter as it iterates
 *
 * @param  {Folder}         folder          The folder from which to remove the content items
 * @param  {String[]}       contentIds      The ids of the content items to remove from the folder
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 * @api private
 */
const _removeContentItemsFromFolder = function(folder, contentIds, callback) {
  if (_.isEmpty(contentIds)) {
    return callback();
  }

  const roleChange = {};
  roleChange[folder.groupId] = false;

  const contentId = contentIds.pop();
  AuthzAPI.updateRoles(contentId, roleChange, err => {
    if (err) {
      return callback(err);
    }

    return _removeContentItemsFromFolder(folder, contentIds, callback);
  });
};

/**
 * Augment the folder object by signing the preview uris
 *
 * @param  {Context}    ctx         Standard context object containing the current user and the current tenant
 * @param  {Folder}     folder      The folder object to augment
 * @return {Folder}                 The augmented folder holding the signed urls
 * @api private
 */
const _augmentFolder = function(ctx, folder) {
  if (folder.previews && folder.previews.thumbnailUri) {
    folder.previews.thumbnailUrl = ContentUtil.getSignedDownloadUrl(ctx, folder.previews.thumbnailUri);
  }

  if (folder.previews && folder.previews.wideUri) {
    folder.previews.wideUrl = ContentUtil.getSignedDownloadUrl(ctx, folder.previews.wideUri);
  }

  return folder;
};

export {
  createFolder,
  updateFolder,
  updateFolderContentVisibility,
  getFolder,
  getFullFolderProfile,
  deleteFolder,
  getFolderMembers,
  getFolderInvitations,
  resendFolderInvitation,
  shareFolder,
  setFolderPermissions,
  addContentItemsToFolder,
  _addContentItemsToFolderLibrary,
  removeContentItemsFromFolder,
  getFoldersLibrary,
  getManagedFolders,
  removeFolderFromLibrary,
  getFolderContentLibrary,
  createMessage,
  deleteMessage,
  getMessages,
  FoldersAPI as emitter
};
