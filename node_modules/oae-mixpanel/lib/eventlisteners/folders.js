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

/* eslint-disable no-unused-vars */
const _ = require('underscore');

const FoldersAPI = require('oae-folders');
const { FoldersConstants } = require('oae-folders/lib/constants');

const MixpanelUtil = require('oae-mixpanel/lib/util');

module.exports = function(client) {
  /*!
     * Retrieving a folder
     */
  MixpanelUtil.listen(FoldersAPI, FoldersConstants.events.GET_FOLDER_PROFILE, (ctx, folder) => {
    const params = getBasicFolderParameters(ctx, folder);
    client.track(FoldersConstants.events.GET_FOLDER_PROFILE, params);
    client.people.increment(params.distinct_id, FoldersConstants.events.GET_FOLDER_PROFILE);
  });

  /*!
     * Creating a folder
     */
  MixpanelUtil.listen(
    FoldersAPI,
    FoldersConstants.events.CREATED_FOLDER,
    (ctx, folder, memberChangeInfo) => {
      const params = getBasicFolderParameters(ctx, folder);
      params.nrOfMembers = memberChangeInfo.members.added.length;
      client.track(FoldersConstants.events.CREATED_FOLDER, params);
      client.people.increment(params.distinct_id, FoldersConstants.events.CREATED_FOLDER);
    }
  );

  /*!
     * Retrieving a folder library
     */
  MixpanelUtil.listen(
    FoldersAPI,
    FoldersConstants.events.GET_FOLDERS_LIBRARY,
    (ctx, principalId, visibility, start, limit, folders) => {
      const params = MixpanelUtil.getBasicParameters(ctx);
      params.libraryVisibility = visibility;
      params.isOwner = principalId === params.distinct_id;
      params.start = start || 0;
      client.track(FoldersConstants.events.GET_FOLDERS_LIBRARY, params);
      client.people.increment(params.distinct_id, FoldersConstants.events.GET_FOLDERS_LIBRARY);
    }
  );

  /*!
     * Updating a folder
     */
  MixpanelUtil.listen(
    FoldersAPI,
    FoldersConstants.events.UPDATED_FOLDER,
    (ctx, newFolder, oldFolder) => {
      const params = getBasicFolderParameters(ctx, newFolder);
      params.newVisibility = newFolder.visibility;
      params.oldVisibility = oldFolder.oldVisibility;
      params.updatedVisibility = newFolder.visibility !== oldFolder.visibility;
      params.updatedDisplayName = newFolder.displayName !== oldFolder.displayName;
      client.track(FoldersConstants.events.UPDATED_FOLDER, params);
      client.people.increment(params.distinct_id, FoldersConstants.events.UPDATED_FOLDER);
    }
  );

  /*!
     * Updating the visibility of a folder's content items
     */
  MixpanelUtil.listen(
    FoldersAPI,
    FoldersConstants.events.UPDATED_FOLDER_VISIBILITY,
    (ctx, folder, visibility, affectedContentItems, failedContentItems) => {
      const params = getBasicFolderParameters(ctx, folder);
      params.contentVisibility = visibility;
      params.nrOfAffectedItems = affectedContentItems.length;
      params.nrOfFailedItems = failedContentItems.length;
      client.track(FoldersConstants.events.UPDATED_FOLDER_VISIBILITY, params);
      client.people.increment(
        params.distinct_id,
        FoldersConstants.events.UPDATED_FOLDER_VISIBILITY
      );
    }
  );

  /*!
     * Sharing a folder / Updating its members
     */
  MixpanelUtil.listen(
    FoldersAPI,
    FoldersConstants.events.UPDATED_FOLDER_MEMBERS,
    (ctx, folder, memberChangeInfo, opts) => {
      const addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
      const updatedMemberIds = _.pluck(memberChangeInfo.members.updated, 'id');
      const removedMemberIds = _.pluck(memberChangeInfo.members.removed, 'id');

      const params = getBasicFolderParameters(ctx, folder);
      params.newMembers = addedMemberIds.length;
      params.updatedMembers = updatedMemberIds.length;
      params.removedMembers = removedMemberIds.length;
      client.track(FoldersConstants.events.UPDATED_FOLDER_MEMBERS, params);
      client.people.increment(params.distinct_id, FoldersConstants.events.UPDATED_FOLDER_MEMBERS);
    }
  );

  /*!
     * Adding items to a folder
     */
  MixpanelUtil.listen(
    FoldersAPI,
    FoldersConstants.events.ADDED_CONTENT_ITEMS,
    (ctx, actionContext, folder, contentItems) => {
      if (actionContext === 'add-to-folder') {
        const params = getBasicFolderParameters(ctx, folder);
        params.nrOfContentItems = contentItems.length;
        client.track(FoldersConstants.events.ADDED_CONTENT_ITEMS, params);
        client.people.increment(params.distinct_id, FoldersConstants.events.ADDED_CONTENT_ITEMS);
      }
    }
  );

  /*!
     * Removing items from a folder
     */
  MixpanelUtil.listen(
    FoldersAPI,
    FoldersConstants.events.REMOVED_CONTENT_ITEMS,
    (ctx, folder, contentItems) => {
      const params = getBasicFolderParameters(ctx, folder);
      params.nrOfContentItems = contentItems.length;
      client.track(FoldersConstants.events.REMOVED_CONTENT_ITEMS, params);
      client.people.increment(params.distinct_id, FoldersConstants.events.REMOVED_CONTENT_ITEMS);
    }
  );

  /*!
     * Deleting a folder
     */
  MixpanelUtil.listen(FoldersAPI, FoldersConstants.events.DELETED_FOLDER, (ctx, folder) => {
    const params = getBasicFolderParameters(ctx, folder);
    client.track(FoldersConstants.events.DELETED_FOLDER, params);
    client.people.increment(params.distinct_id, FoldersConstants.events.DELETED_FOLDER);
  });

  /*!
     * Creating a comment
     */
  MixpanelUtil.listen(
    FoldersAPI,
    FoldersConstants.events.CREATED_COMMENT,
    (ctx, message, folder) => {
      const params = getBasicFolderParameters(ctx, folder);
      params.messageLength = message.body.length;
      params.level = message.level;
      client.track(FoldersConstants.events.CREATED_COMMENT, params);
      client.people.increment(params.distinct_id, FoldersConstants.events.CREATED_COMMENT);
    }
  );

  /*!
     * Deleting a comment
     */
  MixpanelUtil.listen(
    FoldersAPI,
    FoldersConstants.events.DELETED_COMMENT,
    (ctx, message, folder, deleteType) => {
      const params = getBasicFolderParameters(ctx, folder);
      params.deleteType = folder.deleteType;
      params.level = message.level;
      client.track(FoldersConstants.events.DELETED_COMMENT, params);
      client.people.increment(params.distinct_id, FoldersConstants.events.DELETED_COMMENT);
    }
  );
};

/**
 * Get the basic event parameters given a context and a folder
 *
 * @param  {Context}    ctx         The context that triggered the event
 * @param  {Folder}     folder      The folder that was involved in the event
 * @return {Object}                 A set of mixpanel event parameters
 * @api private
 */
const getBasicFolderParameters = function(ctx, folder) {
  const params = MixpanelUtil.getBasicParameters(ctx);
  params.id = folder.id;
  params.visibility = folder.visibility;
  params.age = Date.now() - folder.created;
  return params;
};
