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
import { pipe, keys, filter } from 'ramda';

import * as AuthzInvitationsDAO from 'oae-authz/lib/invitations/dao.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import { Context } from 'oae-context';
import { Invitation } from 'oae-authz/lib/invitations/model.js';
import * as ResourceActions from 'oae-resource/lib/actions.js';
import { ResourceConstants } from 'oae-resource/lib/constants.js';

import * as ContentAPI from 'oae-content';
import { ContentConstants } from 'oae-content/lib/constants.js';
import * as ContentDAO from 'oae-content/lib/internal/dao.js';

import { logger } from 'oae-logger';

const log = logger('oae-content-invitations');

/*!
 * When an invitation is accepted, pass on the events to update content members and then feed back
 * the content item resources into the event emitter
 */
ResourceActions.emitter.when(
  ResourceConstants.events.ACCEPTED_INVITATION,
  (ctx, invitationHashes, memberChangeInfosByResourceId, inviterUsersById, token, callback) => {
    // Filter the invitations and changes down to only content invitations
    const contentIds = pipe(keys, filter(_isContentId))(memberChangeInfosByResourceId);
    if (_.isEmpty(contentIds)) {
      return callback();
    }

    // Get all the content profiles
    ContentDAO.Content.getMultipleContentItems(contentIds, null, (error, contentItems) => {
      if (error) {
        log().warn(
          {
            err: error,
            contentIds
          },
          'An error occurred while getting content items to update content libraries after an invitation was accepted'
        );
        return callback();
      }

      // Invoke the "accept invitation" handler with the resources when we have them. We
      // invoke this after the get principals call for test synchronization
      callback(null, contentItems);

      // Fire members update tasks for each content item
      _.each(contentItems, (contentItem) => {
        const invitationHash = _.findWhere(invitationHashes, { resourceId: contentItem.id });
        const inviterUser = inviterUsersById[invitationHash.inviterUserId];

        const invitationCtx = Context.fromUser(inviterUser);
        const invitation = Invitation.fromHash(invitationHash, contentItem, inviterUser);
        const memberChangeInfo = memberChangeInfosByResourceId[contentItem.id];

        return ContentAPI.emitter.emit(
          ContentConstants.events.UPDATED_CONTENT_MEMBERS,
          invitationCtx,
          contentItem,
          memberChangeInfo,
          { invitation }
        );
      });
    });
  }
);

/*!
 * When content is deleted, delete all its invitations as well
 */
ContentAPI.emitter.when(ContentConstants.events.DELETED_CONTENT, (ctx, content, members, callback) => {
  AuthzInvitationsDAO.deleteInvitationsByResourceId(content.id, (error) => {
    if (error) {
      log().warn(
        {
          err: error,
          contentId: content.id
        },
        'An error occurred while removing invitations after a content item was deleted'
      );
    }

    return callback();
  });
});

/**
 * Determine if the given id is a content id
 *
 * @param  {String}     contentId   The id to check
 * @return {Boolean}                Whether or not the string was a content id
 * @api private
 */
const _isContentId = function (contentId) {
  return AuthzUtil.isResourceId(contentId) && contentId.indexOf('c:') === 0;
};
