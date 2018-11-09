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

const PrincipalsAPI = require('oae-principals');
const { PrincipalsConstants } = require('oae-principals/lib/constants');

const MixpanelUtil = require('oae-mixpanel/lib/util');

module.exports = function(client) {
  /*!
     * Retrieving a group
     */
  MixpanelUtil.listen(PrincipalsAPI, PrincipalsConstants.events.GET_GROUP_PROFILE, (ctx, group) => {
    const params = getBasicGroupParameters(ctx, group);
    client.track(PrincipalsConstants.events.GET_GROUP_PROFILE, params);
    client.people.increment(params.distinct_id, PrincipalsConstants.events.GET_GROUP_PROFILE);
  });

  /*!
     * Creating a group
     */
  MixpanelUtil.listen(
    PrincipalsAPI,
    PrincipalsConstants.events.CREATED_GROUP,
    (ctx, group, memberChangeInfo) => {
      const params = getBasicGroupParameters(ctx, group);
      params.nrOfMembers = memberChangeInfo.members.added.length;
      client.track(PrincipalsConstants.events.CREATED_GROUP, params);
      client.people.increment(params.distinct_id, PrincipalsConstants.events.CREATED_GROUP);
    }
  );

  /*!
     * Updating a group
     */
  MixpanelUtil.listen(
    PrincipalsAPI,
    PrincipalsConstants.events.UPDATED_GROUP,
    (ctx, newGroup, oldGroup) => {
      const params = getBasicGroupParameters(ctx, newGroup);
      params.newVisibility = newGroup.visibility;
      params.oldVisibility = oldGroup.oldVisibility;
      params.updatedVisibility = newGroup.visibility !== oldGroup.visibility;
      params.updatedDisplayName = newGroup.displayName !== oldGroup.displayName;
      params.updatedDescription = newGroup.description !== oldGroup.description;
      params.updatedJoinable = newGroup.joinable !== oldGroup.joinable;
      client.track(PrincipalsConstants.events.UPDATED_GROUP, params);
      client.people.increment(params.distinct_id, PrincipalsConstants.events.UPDATED_GROUP);
    }
  );

  /*!
     * Deleting a group
     */
  MixpanelUtil.listen(PrincipalsAPI, PrincipalsConstants.events.DELETED_GROUP, (ctx, group) => {
    const params = getBasicGroupParameters(ctx, group);
    client.track(PrincipalsConstants.events.DELETED_GROUP, params);
    client.people.increment(params.distinct_id, PrincipalsConstants.events.DELETED_GROUP);
  });

  /*!
     * Restoring a group
     */
  MixpanelUtil.listen(PrincipalsAPI, PrincipalsConstants.events.RESTORED_GROUP, (ctx, group) => {
    const params = getBasicGroupParameters(ctx, group);
    client.track(PrincipalsConstants.events.RESTORED_GROUP, params);
    client.people.increment(params.distinct_id, PrincipalsConstants.events.RESTORED_GROUP);
  });

  /*!
     * Sharing a group / Updating its members
     */
  MixpanelUtil.listen(
    PrincipalsAPI,
    PrincipalsConstants.events.UPDATED_GROUP_MEMBERS,
    // eslint-disable-next-line no-unused-vars
    (ctx, group, oldGroup, memberChangeInfo, opts) => {
      let addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
      let updatedMemberIds = _.pluck(memberChangeInfo.members.updated, 'id');
      let removedMemberIds = _.pluck(memberChangeInfo.members.removed, 'id');

      const params = getBasicGroupParameters(ctx, group);
      params.newMembers = addedMemberIds.length;
      params.updatedMembers = updatedMemberIds.length;
      params.removedMembers = removedMemberIds.length;
      params.deltaMembers = params.newMembers - params.removedMembers;
      client.track(PrincipalsConstants.events.UPDATED_GROUP_MEMBERS, params);
      client.people.increment(params.distinct_id, PrincipalsConstants.events.UPDATED_GROUP_MEMBERS);
    }
  );

  /*!
     * Joining a group
     */
  MixpanelUtil.listen(PrincipalsAPI, PrincipalsConstants.events.JOINED_GROUP, (ctx, group) => {
    const params = getBasicGroupParameters(ctx, group);
    client.track(PrincipalsConstants.events.JOINED_GROUP, params);
    client.people.increment(params.distinct_id, PrincipalsConstants.events.JOINED_GROUP);
  });

  /*!
     * Leaving a group
     */
  MixpanelUtil.listen(PrincipalsAPI, PrincipalsConstants.events.LEFT_GROUP, (ctx, group) => {
    const params = getBasicGroupParameters(ctx, group);
    client.track(PrincipalsConstants.events.LEFT_GROUP, params);
    client.people.increment(params.distinct_id, PrincipalsConstants.events.LEFT_GROUP);
  });

  /*!
     * Setting a group's picture
     */
  MixpanelUtil.listen(PrincipalsAPI, PrincipalsConstants.events.SET_GROUP_PICTURE, (ctx, group) => {
    const params = getBasicGroupParameters(ctx, group);
    client.track(PrincipalsConstants.events.SET_GROUP_PICTURE, params);
    client.people.increment(params.distinct_id, PrincipalsConstants.events.SET_GROUP_PICTURE);
  });
};

/**
 * Get the basic event parameters given a context and a group
 *
 * @param  {Context}    ctx         The context that triggered the event
 * @param  {Group}      group       The group that was involved in the event
 * @return {Object}                 A set of mixpanel event parameters
 * @api private
 */
const getBasicGroupParameters = function(ctx, group) {
  const params = MixpanelUtil.getBasicParameters(ctx);
  params.id = group.id;
  params.visibility = group.visibility;
  params.joinable = group.joinable;
  params.descriptionLength = (group.description || '').length;
  params.age = Date.now() - group.created;
  return params;
};
