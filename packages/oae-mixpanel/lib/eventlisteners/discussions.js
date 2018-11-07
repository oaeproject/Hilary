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

const DiscussionsAPI = require('oae-discussions');
const { DiscussionsConstants } = require('oae-discussions/lib/constants');

const MixpanelUtil = require('oae-mixpanel/lib/util');

module.exports = function(client) {
  /*!
     * Retrieving a discussion
     */
  MixpanelUtil.listen(
    DiscussionsAPI,
    DiscussionsConstants.events.GET_DISCUSSION_PROFILE,
    (ctx, discussion) => {
      const params = getBasicDiscussionParameters(ctx, discussion);
      params.id = discussion.id;
      params.visibility = discussion.visibility;
      client.track(DiscussionsConstants.events.GET_DISCUSSION_PROFILE, params);
      client.people.increment(
        params.distinct_id,
        DiscussionsConstants.events.GET_DISCUSSION_PROFILE
      );
    }
  );

  /*!
     * Retrieving a discussion library
     */
  MixpanelUtil.listen(
    DiscussionsAPI,
    DiscussionsConstants.events.GET_DISCUSSION_LIBRARY,
    (ctx, principalId, visibility, start, limit, discussions) => {
      const params = MixpanelUtil.getBasicParameters(ctx);
      params.isOwner = principalId === params.distinct_id;
      params.libraryVisibility = visibility;
      params.start = start || 0;
      client.track(DiscussionsConstants.events.GET_DISCUSSION_LIBRARY, params);
      client.people.increment(
        params.distinct_id,
        DiscussionsConstants.events.GET_DISCUSSION_LIBRARY
      );
    }
  );

  /*!
     * Creating a discussion
     */
  MixpanelUtil.listen(
    DiscussionsAPI,
    DiscussionsConstants.events.CREATED_DISCUSSION,
    (ctx, discussion, memberChangeInfo) => {
      const params = getBasicDiscussionParameters(ctx, discussion);
      params.id = discussion.id;
      params.visibility = discussion.visibility;
      params.nrOfMembers = memberChangeInfo.members.added.length;
      client.track(DiscussionsConstants.events.CREATED_DISCUSSION, params);
      client.people.increment(params.distinct_id, DiscussionsConstants.events.CREATED_DISCUSSION);
    }
  );

  /*!
     * Updating a discussion
     */
  MixpanelUtil.listen(
    DiscussionsAPI,
    DiscussionsConstants.events.UPDATED_DISCUSSION,
    (ctx, newDiscussion, oldDiscussion) => {
      const params = getBasicDiscussionParameters(ctx, newDiscussion);
      params.id = newDiscussion.id;
      params.newVisibility = newDiscussion.visibility;
      params.oldVisibility = oldDiscussion.visibility;
      params.updatedVisibility = newDiscussion.visibility !== oldDiscussion.visibility;
      params.updatedDisplayName = newDiscussion.displayName !== oldDiscussion.displayName;
      params.updatedDescription = newDiscussion.description !== oldDiscussion.description;
      client.track(DiscussionsConstants.events.UPDATED_DISCUSSION, params);
      client.people.increment(params.distinct_id, DiscussionsConstants.events.UPDATED_DISCUSSION);
    }
  );

  /*!
     * Sharing a discussion / Updating its members
     */
  MixpanelUtil.listen(
    DiscussionsAPI,
    DiscussionsConstants.events.UPDATED_DISCUSSION_MEMBERS,
    (ctx, discussion, memberChangeInfo, opts) => {
      const addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
      const updatedMemberIds = _.pluck(memberChangeInfo.members.updated, 'id');
      const removedMemberIds = _.pluck(memberChangeInfo.members.removed, 'id');

      const params = getBasicDiscussionParameters(ctx, discussion);
      params.id = discussion.id;
      params.visibility = discussion.visibility;
      params.newMembers = addedMemberIds.length;
      params.updatedMembers = updatedMemberIds.length;
      params.removedMembers = removedMemberIds.length;
      params.deltaMembers = params.newMembers - params.removedMembers;
      client.track(DiscussionsConstants.events.UPDATED_DISCUSSION_MEMBERS, params);
      client.people.increment(
        params.distinct_id,
        DiscussionsConstants.events.UPDATED_DISCUSSION_MEMBERS
      );
    }
  );

  /*!
     * Deleting a discussion
     */
  MixpanelUtil.listen(
    DiscussionsAPI,
    DiscussionsConstants.events.DELETED_DISCUSSION,
    (ctx, discussion) => {
      const params = getBasicDiscussionParameters(ctx, discussion);
      params.id = discussion.id;
      params.visibility = discussion.visibility;
      client.track(DiscussionsConstants.events.DELETED_DISCUSSION, params);
      client.people.increment(params.distinct_id, DiscussionsConstants.events.DELETED_DISCUSSION);
    }
  );

  /*!
     * Creating a comment
     */
  MixpanelUtil.listen(
    DiscussionsAPI,
    DiscussionsConstants.events.CREATED_DISCUSSION_MESSAGE,
    (ctx, message, discussion) => {
      const params = getBasicDiscussionParameters(ctx, discussion);
      params.id = discussion.id;
      params.visibility = discussion.visibility;
      params.messageLength = message.body.length;
      params.level = message.level;
      client.track(DiscussionsConstants.events.CREATED_DISCUSSION_MESSAGE, params);
      client.people.increment(
        params.distinct_id,
        DiscussionsConstants.events.CREATED_DISCUSSION_MESSAGE
      );
    }
  );

  /*!
     * Deleting a comment
     */
  MixpanelUtil.listen(
    DiscussionsAPI,
    DiscussionsConstants.events.DELETED_DISCUSSION_MESSAGE,
    (ctx, message, discussion, deleteType) => {
      const params = getBasicDiscussionParameters(ctx, discussion);
      params.id = discussion.id;
      params.visibility = discussion.visibility;
      params.deleteType = discussion.deleteType;
      params.level = message.level;
      client.track(DiscussionsConstants.events.DELETED_DISCUSSION_MESSAGE, params);
      client.people.increment(
        params.distinct_id,
        DiscussionsConstants.events.DELETED_DISCUSSION_MESSAGE
      );
    }
  );
};

/**
 * Get the basic event parameters given a context and a discussion
 *
 * @param  {Context}        ctx             The context that triggered the event
 * @param  {Discussion}     discussion      The discussion that was involved in the event
 * @return {Object}                         A set of mixpanel event parameters
 * @api private
 */
const getBasicDiscussionParameters = function(ctx, discussion) {
  const params = MixpanelUtil.getBasicParameters(ctx);
  params.id = discussion.id;
  params.visibility = discussion.visibility;
  params.descriptionLength = (discussion.description || '').length;
  params.age = Date.now() - discussion.created;
  return params;
};
