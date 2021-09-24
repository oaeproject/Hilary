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

import DiscussionsAPI from 'oae-discussions';

import { pipe, filter, keys, isEmpty } from 'ramda';
import _ from 'underscore';

import * as AuthzInvitationsDAO from 'oae-authz/lib/invitations/dao.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as ResourceActions from 'oae-resource/lib/actions.js';
import * as DiscussionsDAO from 'oae-discussions/lib/internal/dao.js';

import { Context } from 'oae-context';
import { Invitation } from 'oae-authz/lib/invitations/model.js';
import { ResourceConstants } from 'oae-resource/lib/constants.js';

import { DiscussionsConstants } from 'oae-discussions/lib/constants.js';

import { logger } from 'oae-logger';

const log = logger('oae-discussions-invitations');

/*!
 * When an invitation is accepted, pass on the events to update discussion members and then feed
 * back the discussion resources into the event emitter
 */
ResourceActions.emitter.when(
  ResourceConstants.events.ACCEPTED_INVITATION,
  (ctx, invitationHashes, memberChangeInfosByResourceId, inviterUsersById, token, callback) => {
    // Filter the invitations and changes down to only discussion invitations
    const discussionIds = pipe(keys, filter(_isDiscussionId))(memberChangeInfosByResourceId);
    if (isEmpty(discussionIds)) return callback();

    DiscussionsDAO.getDiscussionsById(discussionIds, null, (error, discussions) => {
      if (error) {
        log().warn(
          {
            err: error,
            discussionIds
          },
          'An error occurred while getting discussions to update discussion libraries after an invitation was accepted'
        );
        return callback();
      }

      // Invoke the "accept invitation" handler with the resources when we have them. We
      // invoke this after the get principals call for test synchronization
      callback(null, discussions);

      // Fire members update tasks for each discussion
      _.each(discussions, (discussion) => {
        const invitationHash = _.findWhere(invitationHashes, { resourceId: discussion.id });
        const inviterUser = inviterUsersById[invitationHash.inviterUserId];

        const invitationCtx = Context.fromUser(inviterUser);
        const invitation = Invitation.fromHash(invitationHash, discussion, inviterUser);
        const memberChangeInfo = memberChangeInfosByResourceId[discussion.id];

        return DiscussionsAPI.emit(
          DiscussionsConstants.events.UPDATED_DISCUSSION_MEMBERS,
          invitationCtx,
          discussion,
          memberChangeInfo,
          { invitation }
        );
      });
    });
  }
);

/*!
 * When a discussion is deleted, we delete all invitations associated to it
 */
DiscussionsAPI.when(DiscussionsConstants.events.DELETED_DISCUSSION, (ctx, discussion, memberIds, callback) => {
  AuthzInvitationsDAO.deleteInvitationsByResourceId(discussion.id, (error) => {
    if (error) {
      log().warn(
        {
          err: error,
          discussionId: discussion.id
        },
        'An error occurred while removing invitations after a discussion was deleted'
      );
    }

    return callback();
  });
});

/**
 * Determine if the given id is a discussion id
 *
 * @param  {String}     discussionId    The id to check
 * @return {Boolean}                    Whether or not the string was a discussion id
 * @api private
 */
const _isDiscussionId = function (discussionId) {
  return AuthzUtil.isResourceId(discussionId) && discussionId.indexOf('d:') === 0;
};
