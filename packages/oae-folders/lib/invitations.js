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

import _ from 'underscore';

import { logger } from 'oae-logger';
import { pipe, keys, filter } from 'ramda';

import * as AuthzInvitationsDAO from 'oae-authz/lib/invitations/dao';
import * as AuthzUtil from 'oae-authz/lib/util';
const { isGroupId } = AuthzUtil;
import * as ResourceActions from 'oae-resource/lib/actions';
import * as FoldersAPI from 'oae-folders';
import * as FoldersDAO from 'oae-folders/lib/internal/dao';

import { Context } from 'oae-context';
import { Invitation } from 'oae-authz/lib/invitations/model';
import { ResourceConstants } from 'oae-resource/lib/constants';
import { FoldersConstants } from 'oae-folders/lib/constants';

const log = logger('oae-folders-invitations');

/*!
 * When an invitation is accepted, pass on the events to update folder members and then feed back
 * the folder resources into the event emitter
 */
ResourceActions.emitter.when(
  ResourceConstants.events.ACCEPTED_INVITATION,
  (ctx, invitationHashes, memberChangeInfosByResourceId, inviterUsersById, token, callback) => {
    // Filter the invitations and changes down to only folder invitations
    const folderGroupIds = pipe(keys, filter(isGroupId))(memberChangeInfosByResourceId);
    if (_.isEmpty(folderGroupIds)) {
      return callback();
    }

    FoldersDAO.getFoldersByGroupIds(folderGroupIds, (error, folders) => {
      if (error) {
        log().warn(
          {
            err: error,
            folderGroupIds
          },
          'An error occurred while getting folders to update folder libraries after an invitation was accepted'
        );
        return callback();
      }

      if (_.isEmpty(folders)) {
        return callback();
      }

      /**
       * Invoke the "accept invitation" handler with the resources when we have them.
       * We invoke this after the get principals call for test synchronization
       */
      callback(null, folders);

      // Fire members update tasks for each folder
      _.each(folders, (folder) => {
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
FoldersAPI.emitter.when(FoldersConstants.events.DELETED_FOLDER, (ctx, folder, memberIds, callback) => {
  AuthzInvitationsDAO.deleteInvitationsByResourceId(folder.id, (error) => {
    if (error) {
      log().warn(
        {
          err: error,
          folderId: folder.id
        },
        'An error occurred while removing invitations after a folder was deleted'
      );
    }

    return callback();
  });
});

/**
 * Determine if the given id is a folder id
 *
 * @param  {String}     folderId    The id to check
 * @return {Boolean}                Whether or not the string was a folder id
 * @api private
 */
// eslint-disable-next-line no-unused-vars
const _isFolderId = function (folderId) {
  return AuthzUtil.isResourceId(folderId) && folderId.indexOf('f:') === 0;
};
