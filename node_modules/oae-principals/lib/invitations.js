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

const _ = require('underscore');

const AuthzUtil = require('oae-authz/lib/util');
const { Context } = require('oae-context');
const { Invitation } = require('oae-authz/lib/invitations/model');
const ResourceActions = require('oae-resource/lib/actions');
const { ResourceConstants } = require('oae-resource/lib/constants');

const { PrincipalsConstants } = require('oae-principals/lib/constants');
const PrincipalsDAO = require('oae-principals/lib/internal/dao');
const PrincipalsEmitter = require('oae-principals/lib/internal/emitter');
const PrincipalsUtil = require('oae-principals/lib/util');

const log = require('oae-logger').logger('oae-principals-invitations');

/*!
 * When an invitation is accepted, pass on the events to update group members and then feed back the
 * group resources into the event emitter
 */
ResourceActions.emitter.when(
  ResourceConstants.events.ACCEPTED_INVITATION,
  (ctx, invitationHashes, memberChangeInfosByResourceId, inviterUsersById, token, callback) => {
    // Filter the invitations and changes down to only group invitations
    let groupIds = _.chain(memberChangeInfosByResourceId)
      .keys()
      .filter(AuthzUtil.isGroupId)
      .value();
    if (_.isEmpty(groupIds)) {
      return callback();
    }

    // Note that some of these group ids could be folder authz ids. Therefore we need to limit to
    // only actual group resources that come from this query
    PrincipalsDAO.getPrincipals(groupIds, null, (err, groupsById) => {
      if (err) {
        log().warn(
          {
            err,
            groupIds
          },
          'An error occurred while getting groups to update group libraries after an invitation was accepted'
        );
        return callback();
      }

      // Filter out soft-deleted groups
      const groups = _.chain(groupsById)
        .values()
        .filter(group => {
          return !group.deleted;
        })
        .value();
      if (_.isEmpty(groups)) {
        return callback();
      }

      groupIds = _.pluck(groups, 'id');

      // Touch all the group last modified timestamps who are having an invitation accepted
      // for them
      _touchAllGroups(groups, updatedGroupsById => {
        // Invoke the "accept invitation" handler with the resources when we have them. We
        // invoke this after the get principals call for test synchronization
        callback(null, _.values(updatedGroupsById));

        // Fire members update tasks for each group
        _.each(groups, group => {
          const updatedGroup = updatedGroupsById[group.id];
          if (!updatedGroup) {
            return;
          }

          const invitationHash = _.findWhere(invitationHashes, { resourceId: group.id });
          const inviterUser = inviterUsersById[invitationHash.inviterUserId];

          const invitationCtx = Context.fromUser(inviterUser);
          const invitation = Invitation.fromHash(invitationHash, updatedGroup, inviterUser);
          const memberChangeInfo = memberChangeInfosByResourceId[group.id];

          return PrincipalsEmitter.emit(
            PrincipalsConstants.events.UPDATED_GROUP_MEMBERS,
            invitationCtx,
            updatedGroup,
            group,
            memberChangeInfo,
            { invitation }
          );
        });
      });
    });
  }
);

/**
 * Update the last modified timestamp of all the specified groups
 *
 * @param  {Group[]}    groups                          The groups whose last modified timestamps to touch
 * @param  {Function}   callback                        Standard callback function
 * @param  {Object}     callback.err                    An error that occurred, if any
 * @param  {Object}     callback.updatedGroupsById      The updated group profiles, keyed by group id
 * @api private
 */
const _touchAllGroups = function(groups, callback) {
  const updatedGroupsById = {};
  const _done = _.chain(groups)
    .size()
    .after(() => {
      return callback(updatedGroupsById);
    })
    .value();

  _.each(groups, group => {
    PrincipalsUtil.touchLastModified(group, (err, updatedGroup) => {
      if (err) {
        log().warn(
          {
            err,
            groupId: group.id
          },
          'An error occurred while updating group libraries after invitation was accepted'
        );
      }

      updatedGroupsById[group.id] = updatedGroup;
      return _done();
    });
  });
};
