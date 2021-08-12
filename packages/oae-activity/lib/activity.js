/*!
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
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

import * as AuthzAPI from 'oae-authz';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as ContentAPI from 'oae-content';
import * as DiscussionsAPI from 'oae-discussions';
import * as FoldersAPI from 'oae-folders';
import * as Signature from 'oae-util/lib/signature.js';
import * as MeetingsAPI from 'oae-jitsi/lib/api.meetings.js';

import * as ActivityAPI from './api.js';

ActivityAPI.registerActivityStreamType('activity', {
  transient: false,
  visibilityBucketing: true,
  authorizationHandler(ctx, resourceId, token, callback) {
    // Tenant admins can see all the streams
    const resource = AuthzUtil.getResourceFromId(resourceId);
    if (ctx.user() && ctx.user().isAdmin(resource.tenantAlias)) {
      return callback();

      // User streams
    }

    if (AuthzUtil.isUserId(resourceId)) {
      return _authorizeUserActivityStream(ctx, resourceId, token, callback);

      // Group streams
    }

    if (AuthzUtil.isGroupId(resourceId)) {
      return _authorizeGroupActivityStream(ctx, resourceId, token, callback);

      // Content streams
    }

    if (resource.resourceType === 'c') {
      return _authorizeContentActivityStream(ctx, resourceId, token, callback);

      // Discussion streams
    }

    if (resource.resourceType === 'd') {
      return _authorizeDiscussionActivityStream(ctx, resourceId, token, callback);

      // Folder streams
    }

    if (resource.resourceType === 'f') {
      return _authorizeFolderActivityStream(ctx, resourceId, token, callback);

      // Jitsi streams
    }

    if (resource.resourceType === 'm') {
      return _authorizeJitsiActivityStream(ctx, resourceId, token, callback);

      // Unknown type of resource
    }

    return callback({ code: 404, msg: 'Unknown type of resource' });
  }
});

ActivityAPI.registerActivityStreamType('message', {
  transient: true,
  authorizationHandler(ctx, resourceId, token, callback) {
    // Tenant admins can see all the streams
    const resource = AuthzUtil.getResourceFromId(resourceId);
    if (ctx.user() && ctx.user().isAdmin(resource.tenantAlias)) {
      return callback();

      // Content streams
    }

    if (resourceId[0] === 'c') {
      return _authorizeContentActivityStream(ctx, resourceId, token, callback);

      // Discussion streams
    }

    if (resourceId[0] === 'd') {
      return _authorizeDiscussionActivityStream(ctx, resourceId, token, callback);

      // Folder streams
    }

    if (resourceId[0] === 'f') {
      return _authorizeFolderActivityStream(ctx, resourceId, token, callback);

      // Meeting streams
    }

    if (resourceId[0] === 'm') {
      return _authorizeJitsiActivityStream(ctx, resourceId, token, callback);

      // Unknown type of resource
    }

    return callback({ code: 404, msg: 'Unknown type of resource' });
  }
});

ActivityAPI.registerActivityStreamType('notification', {
  transient: false,
  push: {
    delivery: {
      phase: 'aggregation'
    }
  },
  authorizationHandler(ctx, resourceId, token, callback) {
    if (!AuthzUtil.isUserId(resourceId)) {
      return callback({ code: 400, msg: 'Only users can have notification streams' });
    }

    if (!ctx.user()) {
      return callback({
        code: 401,
        msg: 'Only authenticated users can retrieve a notification stream'
      });
    }

    if (ctx.user().id !== resourceId) {
      return callback({ code: 401, msg: 'You can only request your own notification stream' });
    }

    return callback();
  }
});

/**
 * User authorization handler
 *
 * @see ActivityAPI#registerActivityStream
 * @api private
 */
const _authorizeUserActivityStream = function (ctx, userId, token, callback) {
  if (!ctx.user()) {
    return callback({
      code: 401,
      msg: "Only authenticated users can retrieve a user's activity stream"
    });
  }

  if (ctx.user().id !== userId) {
    return callback({ code: 401, msg: 'You can only request your own notification stream' });
  }

  return callback();
};

/**
 * Group authorization handler
 *
 * @see ActivityAPI#registerActivityStream
 * @api private
 */
const _authorizeGroupActivityStream = function (ctx, groupId, token, callback) {
  if (!ctx.user()) {
    return callback({ code: 401, msg: 'Must be a member of a group to see its activity stream' });
  }

  if (_.isObject(token)) {
    if (!Signature.verifyExpiringResourceSignature(ctx, groupId, token.expires, token.signature)) {
      return callback({ code: 401, msg: 'Invalid signature' });
    }

    return callback();
  }

  AuthzAPI.hasAnyRole(ctx.user().id, groupId, (error, hasAnyRole) => {
    if (error) {
      return callback(error);
    }

    if (!hasAnyRole) {
      return callback({ code: 401, msg: 'Must be a member of a group to see its activity stream' });
    }

    return callback();
  });
};

/**
 * Content authorization handler
 *
 * @see ActivityAPI#registerActivityStream
 * @api private
 */
const _authorizeContentActivityStream = function (ctx, contentId, token, callback) {
  if (_.isObject(token)) {
    if (!Signature.verifyExpiringResourceSignature(ctx, contentId, token.expires, token.signature)) {
      return callback({ code: 401, msg: 'Invalid signature' });
    }

    return callback();
  }

  ContentAPI.getContent(ctx, contentId, (error) => {
    if (error) {
      return callback(error);
    }

    return callback();
  });
};

/**
 * Discussion authorization handler
 *
 * @see ActivityAPI#registerActivityStream
 * @api private
 */
const _authorizeDiscussionActivityStream = function (ctx, discussionId, token, callback) {
  if (_.isObject(token)) {
    if (!Signature.verifyExpiringResourceSignature(ctx, discussionId, token.expires, token.signature)) {
      return callback({ code: 401, msg: 'Invalid signature' });
    }

    return callback();
  }

  DiscussionsAPI.Discussions.getDiscussion(ctx, discussionId, (error) => {
    if (error) {
      return callback(error);
    }

    return callback();
  });
};

/**
 * Folder authorization handler
 *
 * @see ActivityAPI#registerActivityStream
 * @api private
 */
const _authorizeFolderActivityStream = function (ctx, folderId, token, callback) {
  if (_.isObject(token)) {
    if (!Signature.verifyExpiringResourceSignature(ctx, folderId, token.expires, token.signature)) {
      return callback({ code: 401, msg: 'Invalid signature' });
    }

    return callback();
  }

  FoldersAPI.getFolder(ctx, folderId, (error) => {
    if (error) {
      return callback(error);
    }

    return callback();
  });
};

/**
 * Meeting authorization handler
 *
 * @see ActivityAPI#registerActivityStream
 * @api private
 */
const _authorizeJitsiActivityStream = function (ctx, meetingId, token, callback) {
  if (_.isObject(token)) {
    if (!Signature.verifyExpiringResourceSignature(ctx, meetingId, token.expires, token.signature)) {
      return callback({ code: 401, msg: 'Invalid signature' });
    }

    return callback();
  }

  MeetingsAPI.getMeeting(ctx, meetingId, (error) => {
    if (error) {
      return callback(error);
    }

    return callback();
  });
};
