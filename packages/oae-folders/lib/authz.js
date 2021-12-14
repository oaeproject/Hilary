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
import * as AuthzPermissions from 'oae-authz/lib/permissions.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import { logger } from 'oae-logger';
import * as FoldersDAO from './internal/dao.js';

const log = logger('folders-authz');

/**
 * Determine if the user invoking the current request is allowed to add content items to a given
 * folder, and if it is possible for the target content items to be added to the folder
 *
 * @param  {Context}    ctx                                 Current execution context
 * @param  {Folder}     folder                              The folder for which to check if the current user can add items to it
 * @param  {String[]}   contentItems                        The content items being added to the folder
 * @param  {Function}   callback                            Standard callback function
 * @param  {Object}     callback.err                        An error that occurred, if any
 * @param  {String[]}   [callback.invalidContentIds]        If there was a permission issue against a target content items, the invalid content ids will be in this array
 */
const canAddItemsToFolder = function (ctx, folder, contentItems, callback) {
  // Anonymous users can never add something to a folder
  if (!ctx.user()) {
    return callback({ code: 401, msg: 'You must be authenticated to add items to a folder' });
  }

  // A user must be able to manage a folder to add items to it
  AuthzPermissions.canManage(ctx, folder, (error) => {
    if (error) {
      return callback(error);
    }

    // I must be able to interact with all target content items in order to add them to a folder
    // of mine. Note that this is a special case in which we allow a viewer of a private content
    // item to extend its access to others (e.g., add the private item to a folder, then share
    // the folder with someone else). This is intentional as it is a necessary feature for
    // folders to be usable
    AuthzPermissions.canInteract(ctx, contentItems, (error) => {
      if (error) {
        error.invalidContentIds = _.keys(error.invalidResources);
        return callback(error);
      }

      return callback();
    });
  });
};

/**
 * Given a content item, get the folders that it resides in.
 *
 * @param  {String}     contentId           The content id for which to retrieve the folders it resides in
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Folder[]}   callback.folders    The folders that contain the content item
 */
const getFoldersForContent = function (contentId, callback) {
  AuthzAPI.getAuthzMembers(contentId, null, 10_000, (error, members) => {
    if (error) {
      log().error({ err: error, contentId }, 'Unable to get the members of a piece of content');
      return callback(error);
    }

    const groupIds = AuthzUtil.getGroupIds(members);
    FoldersDAO.getFoldersByGroupIds(groupIds, callback);
  });
};

/**
 * Given a folder, get all the ids of content items that are in it. Note that
 * this function does not perform any access-checks or visibility scoping.
 *
 * @param  {Folder}         folder                  The folder for which to retrieve the content ids
 * @param  {Function}       callback                Standard callback funciton
 * @param  {Object}         callback.err            An error object, if any
 * @param  {String[]}       callback.contentIds     The ids of the content items that are in the folder
 */
const getContentInFolder = function (folder, callback) {
  // Get the content items in this folder from the canonical source
  AuthzAPI.getAllRolesForPrincipalAndResourceType(folder.groupId, 'c', (error, roles) => {
    if (error) {
      return callback(error);
    }

    return callback(null, _.pluck(roles, 'id'));
  });
};

export { getFoldersForContent, canAddItemsToFolder, getContentInFolder };
