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
const { Invitation} = require('oae-authz/lib/invitations/model');
const ResourceActions = require('oae-resource/lib/actions');
const { ResourceConstants}  = require('oae-resource/lib/constants');

const ContentAPI = require('oae-content');
const { ContentConstants}  = require('oae-content/lib/constants');
const ContentDAO = require('oae-content/lib/internal/dao');

const log = require('oae-logger').logger('oae-content-invitations');

/*!
 * When an invitation is accepted, pass on the events to update content members and then feed back
 * the content item resources into the event emitter
 */
ResourceActions.emitter.when(
  ResourceConstants.events.ACCEPTED_INVITATION,
  (ctx, invitationHashes, memberChangeInfosByResourceId, inviterUsersById, token, callback) => {
    // Filter the invitations and changes down to only content invitations
    const contentIds = _.chain(memberChangeInfosByResourceId)
      .keys()
      .filter(_isContentId)
      .value();
    if (_.isEmpty(contentIds)) {
      return callback();
    }

    // Get all the content profiles
    ContentDAO.Content.getMultipleContentItems(contentIds, null, (err, contentItems) => {
      if (err) {
        log().warn(
          {
            err,
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
      _.each(contentItems, contentItem => {
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
ContentAPI.emitter.when(
  ContentConstants.events.DELETED_CONTENT,
  (ctx, content, members, callback) => {
    AuthzInvitationsDAO.deleteInvitationsByResourceId(content.id, err => {
      if (err) {
        log().warn(
          {
            err,
            contentId: content.id
          },
          'An error occurred while removing invitations after a content item was deleted'
        );
      }

      return callback();
    });
  }
);

/**
 * Determine if the given id is a content id
 *
 * @param  {String}     contentId   The id to check
 * @return {Boolean}                Whether or not the string was a content id
 * @api private
 */
const _isContentId = function(contentId) {
  return AuthzUtil.isResourceId(contentId) && contentId.indexOf('c:') === 0;
};
