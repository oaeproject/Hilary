/*!
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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

const _ = require('underscore');

const AuthzInvitationsDAO = require('oae-authz/lib/invitations/dao');
const AuthzUtil = require('oae-authz/lib/util');
const { Context } = require('oae-context');
const { Invitation } = require('oae-authz/lib/invitations/model');
const ResourceActions = require('oae-resource/lib/actions');
const { ResourceConstants } = require('oae-resource/lib/constants');

const FoldersAPI = require('oae-folders');
const { FoldersConstants } = require('oae-folders/lib/constants');
const FoldersDAO = require('oae-folders/lib/internal/dao');

const log = require('oae-logger').logger('oae-folders-invitations');

/*!
 * When an invitation is accepted, pass on the events to update folder members and then feed back
 * the folder resources into the event emitter
 */
ResourceActions.emitter.when(
  ResourceConstants.events.ACCEPTED_INVITATION,
  (ctx, invitationHashes, memberChangeInfosByResourceId, inviterUsersById, token, callback) => {
    // Filter the invitations and changes down to only folder invitations
    const folderGroupIds = _.chain(memberChangeInfosByResourceId)
      .keys()
      .filter(AuthzUtil.isGroupId)
      .value();
    if (_.isEmpty(folderGroupIds)) {
      return callback();
    }

    FoldersDAO.getFoldersByGroupIds(folderGroupIds, (err, folders) => {
      if (err) {
        log().warn(
          {
            err,
            folderGroupIds
          },
          'An error occurred while getting folders to update folder libraries after an invitation was accepted'
        );
        return callback();
      }
      if (_.isEmpty(folders)) {
        return callback();
      }

      // Invoke the "accept invitation" handler with the resources when we have them. We
      // invoke this after the get principals call for test synchronization
      callback(null, folders);

      // Fire members update tasks for each folder
      _.each(folders, folder => {
        const invitationHash = _.findWhere(invitationHashes, { resourceId: folder.groupId });
        const inviterUser = inviterUsersById[invitationHash.inviterUserId];

        const invitationCtx = Context.fromUser(inviterUser);
        const invitation = Invitation.fromHash(invitationHash, folder, inviterUser);
        const memberChangeInfo = memberChangeInfosByResourceId[folder.groupId];

        return FoldersAPI.emitter.emit(
          FoldersConstants.events.UPDATED_FOLDER_MEMBERS,
          invitationCtx,
          folder,
          memberChangeInfo,
          { invitation }
        );
      });
    });
  }
);

/*!
 * When a folder is deleted, we delete all invitations associated to it
 */
FoldersAPI.emitter.when(
  FoldersConstants.events.DELETED_FOLDER,
  (ctx, folder, memberIds, callback) => {
    AuthzInvitationsDAO.deleteInvitationsByResourceId(folder.id, err => {
      if (err) {
        log().warn(
          {
            err,
            folderId: folder.id
          },
          'An error occurred while removing invitations after a folder was deleted'
        );
      }

      return callback();
    });
  }
);

/**
 * Determine if the given id is a folder id
 *
 * @param  {String}     folderId    The id to check
 * @return {Boolean}                Whether or not the string was a folder id
 * @api private
 */
// eslint-disable-next-line no-unused-vars
const _isFolderId = function(folderId) {
  return AuthzUtil.isResourceId(folderId) && folderId.indexOf('f:') === 0;
};
