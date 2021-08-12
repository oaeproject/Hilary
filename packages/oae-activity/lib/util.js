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

import { format } from 'util';
import _ from 'underscore';

import * as AuthzAPI from 'oae-authz';
import { AuthzConstants } from 'oae-authz/lib/constants.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';

import { ActivityConstants } from 'oae-activity/lib/constants.js';

/**
 * Get a propagation specification that is standard for a resource. This effectively assumes that a resource does not get
 * propagated to those who do not have implicit or explicit access, therefore they will not be on the propagation list. For
 * explicit membership to be recognized here, the resource type (e.g., content, discussion) must have an association registered
 * called 'members'. If it doesn't, then private unjoinable resources will not be routed to anyone, not even their members.
 *
 * This method is not suitable, for example, in situations where a resource has a "scrubbing" mechanism that makes it acceptable
 * for it to be propagated to unprivileged users. One example is 'user', where users are propagated to *all* routes even if they
 * are private, as the transformer will scrub sensitive information during the transformation phase.
 *
 * @param  {String}     resourceVisibility      The visibility of the resource being propagated
 * @param  {String}     resourceJoinable        The joinability setting of the resource
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object[]}   callback.propagation    The array of propagation specs that will describe who has access to receive it in their feed
 */
const getStandardResourcePropagation = function (resourceVisibility, resourceJoinable, callback) {
  const propagation = [];
  if (resourceVisibility === AuthzConstants.visibility.PUBLIC) {
    propagation.push({ type: ActivityConstants.entityPropagation.ALL });
    return callback(null, propagation);
  }

  // If the resource's visibility is loggedin, we do not allow users who are not part of the tenant to see it
  if (resourceVisibility === AuthzConstants.visibility.LOGGEDIN) {
    propagation.push({ type: ActivityConstants.entityPropagation.TENANT });

    // If the resource's visibility is private but it is joinable, users of the same tenant can see it since they
    // may have the opportunity to join it
  } else if (
    resourceVisibility === AuthzConstants.visibility.PRIVATE &&
    (resourceJoinable === AuthzConstants.joinable.YES || resourceJoinable === AuthzConstants.joinable.REQUEST)
  ) {
    propagation.push({ type: ActivityConstants.entityPropagation.TENANT });
  }

  // Always allow routing to the self association of all of the actor, object, target, since they
  // have interacted in some way with the resource (and will include the self association of the
  // resource we are currently propagating)
  propagation.push(
    {
      type: ActivityConstants.entityPropagation.EXTERNAL_ASSOCIATION,
      objectType: 'actor',
      association: 'self'
    },
    {
      type: ActivityConstants.entityPropagation.EXTERNAL_ASSOCIATION,
      objectType: 'object',
      association: 'self'
    },
    {
      type: ActivityConstants.entityPropagation.EXTERNAL_ASSOCIATION,
      objectType: 'target',
      association: 'self'
    }
  );

  // Always allow routing to the members of the item whether it's loggedin or private
  propagation.push({
    type: ActivityConstants.entityPropagation.ASSOCIATION,
    association: 'members'
  });
  return callback(null, propagation);
};

/**
 * Get all the direct and indirect members of the given resource, keyed by their role. This is useful for activity routing
 * where you need to get direct and indirect members for routes and entity propagation.
 *
 * @param  {String}    resourceId              The ID of the resource whose members to fetch
 * @param  {Function}  callback                Standard callback function
 * @param  {Object}    callback.err            An error that occurred, if any
 * @param  {Object}    callback.membersByRole  An object holding all the direct and indirect members of the given resource item. The key of the hash is the role, and the values are a list of strings that represent the principal ids of those members
 */
const getAllAuthzMembersByRole = function (resourceId, callback) {
  AuthzAPI.getAuthzMembers(resourceId, null, 10000, (error, members) => {
    if (error) {
      return callback(error);
    }

    const membersByRole = {};
    const groupMembersByRole = {};

    // Gather the direct membersByRole and aggregate the groupMembersByRole so we can get their descendants
    _.each(members, (member) => {
      const { id } = member;
      const { role } = member;
      membersByRole[role] = membersByRole[role] || [];
      membersByRole[role].push(id);
      if (AuthzUtil.isGroupId(id)) {
        groupMembersByRole[role] = groupMembersByRole[role] || [];
        groupMembersByRole[role].push(id);
      }
    });

    // Merge the descendants by role of all the group members descendants
    _getAllAuthzGroupMembersByRole(groupMembersByRole, (error, indirectMembersByRole) => {
      if (error) {
        return callback(error);
      }

      // Aggregate each set of indirect members into its associated group of roles
      _.each(indirectMembersByRole, (indirectMembers, role) => {
        membersByRole[role] = _.union(membersByRole[role], indirectMembers);
      });

      // At this point membersByRole holds a hash of all direct and indirect members of the content, keyed by their role
      return callback(null, membersByRole);
    });
  });
};

/**
 * Internal function to recursively aggregate all members by their role. This is similar to `getAllAuthzMembersByRole`, except it
 * starts with a hash of lists of direct members, keyed by their roles.
 *
 * @param  {Object}    groupRoles              An object keyed by a role whose values are a list of group ids that have that role directly on the resource
 * @param  {Function}  callback                Standard callback function
 * @param  {Object}    callback.err            An error that occurred, if any
 * @param  {Object}    callback.membersByRole  An object containing all members categorized by their role. The key is the role, and the value is a list of principal ids that represent the members
 * @api private
 */
const _getAllAuthzGroupMembersByRole = function (groupRoles, callback) {
  const roles = _.keys(groupRoles);
  if (_.isEmpty(roles)) {
    return callback(null, {});
  }

  // These variables hold the state of the looped _getAllAuthzMembers executions below
  const membersByRole = {};
  let done = 0;
  const todo = roles.length;
  let finished = false;

  // For each role, collect their group descendants into the membersByRole object
  _.each(groupRoles, (groupIds, role) => {
    _getAllAuthzMembers(groupIds, (error, members) => {
      if (finished) {
        // Nothing to do, we probably already failed and called the callback
      } else if (error) {
        // We just received an error, mark that we're done and call the callback
        finished = true;
        return callback(error);
      } else {
        // Add the role members, decrement the number todo and exit if there are no more to do
        membersByRole[role] = members;
        done++;
        if (done === todo) {
          finished = true;
          return callback(null, membersByRole);
        }
      }
    });
  });
};

/**
 * Internal function to recursively aggregate all the direct and indirect members of a list of groups.
 *
 * @param  {String[]}  groupIds            The groups whose direct and indirect members to aggregate
 * @param  {Function}  callback            Standard callback function
 * @param  {Object}    callback.err        An error that occurred, if any
 * @param  {Object}    callback.members    An object keyed by the member's principal id, whose value is simply `true`
 * @param  {Object}    [aggregatedMembers] Internal parameter used for recursion to collect all visited members. Holds the same format as `callback.members`.
 * @api private
 */
const _getAllAuthzMembers = function (groupIds, callback, aggregatedMembers) {
  aggregatedMembers = aggregatedMembers || {};
  if (_.isEmpty(groupIds)) {
    return callback(null, _.keys(aggregatedMembers));
  }

  const groupId = groupIds.shift();
  AuthzAPI.getAuthzMembers(groupId, null, 10000, (error, members) => {
    if (error) {
      return callback(error);
    }

    // Aggregate the memberIds
    for (const element of members) {
      const memberId = element.id;
      if (!aggregatedMembers[memberId] && AuthzUtil.isGroupId(memberId) && !_.contains(groupIds, memberId)) {
        // If this is a group and we have not aggregated it yet, add it to the groupIds
        groupIds.push(memberId);
      }

      // Aggregate the member's id
      aggregatedMembers[memberId] = true;
    }

    return _getAllAuthzMembers(groupIds, callback, aggregatedMembers);
  });
};

/**
 * Constructs an activity stream ID
 *
 * @param  {String}     resourceId          The ID of the resource
 * @param  {String}     activityStreamType  The type of the activity stream. ex: `activity` or `notification`
 * @return {String}                         The created activity stream id
 */
const createActivityStreamId = function (resourceId, activityStreamType) {
  return format('%s#%s', resourceId, activityStreamType);
};

/**
 * Takes an activity stream ID and parses it into a resource ID and an activity stream type
 *
 * @param  {String}     activityStreamId    The activity stream ID to parse
 * @return {Object}                         An object containing the `resourceId` and the `streamType` for this activity stream ID
 */
const parseActivityStreamId = function (activityStreamId) {
  const parts = activityStreamId.split('#');
  return {
    resourceId: parts[0],
    streamType: parts[1]
  };
};

export { getStandardResourcePropagation, getAllAuthzMembersByRole, createActivityStreamId, parseActivityStreamId };
