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

import sockjs from 'sockjs';

import * as OAE from 'oae-util/lib/oae';
import * as OaeUtil from 'oae-util/lib/util';

import * as ActivityAPI from 'oae-activity';
import * as ActivityPush from './internal/push.js';

/**
 * Activity streams
 */

/**
 * Request handler to get the activity stream of the given stream ID. It will fetch the activities and send out
 * the response.
 *
 * @param  {String}     resourceId          The ID of the activity stream to fetch
 * @param  {Request}    req                 The express request object
 * @param  {Response}   res                 The express response object
 * @api private
 */
const _handleGetActivities = function (resourceId, request, response) {
  const limit = OaeUtil.getNumberParam(request.query.limit, 10, 1, 25);
  const { start } = request.query;
  ActivityAPI.getActivityStream(
    request.ctx,
    resourceId,
    start,
    limit,
    request.query.format,
    (error, activityStream) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).send(activityStream);
    }
  );
};

/**
 * @REST getActivity
 *
 * Get the activity stream for the current user
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /activity
 * @QueryParam  {string}            [format]            The desired activity stream format. Defaults to activitystreams     [activitystreams,internal]
 * @QueryParam  {number}            [limit]             The maximum number of activities to return. Default: 25
 * @QueryParam  {string}            [start]             The activity paging token from which to start fetching activities
 * @Return      {ActivityStream}                        The activity stream for the current user
 * @HttpResponse                    200                 Activity stream returned
 * @HttpResponse                    400                 Must specify an activity stream
 * @HttpResponse                    400                 Unknown activity stream id
 * @HttpResponse                    400                 Unknown activity transformer
 * @HttpResponse                    400                 You can only view activity streams for a principal
 * @HttpResponse                    401                 Must be a member of a group to see its activity stream
 * @HttpResponse                    401                 Must be logged in to see an activity stream
 * @HttpResponse                    401                 Only authenticated users can retrieve a user's activity stream
 */
OAE.tenantRouter.on('get', '/api/activity', (request, response) => {
  const userId = request.ctx.user() ? request.ctx.user().id : null;
  _handleGetActivities(userId, request, response);
});

/**
 * @REST getActivityActivityStreamId
 *
 * Get the `activty` activity stream for a resource
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /activity/{resourceId}
 * @PathParam   {string}            resourceId          The id of the resource for which to get the activity stream
 * @QueryParam  {string}            [format]            The desired activity stream format. Defaults to activitystreams     [activitystreams,internal]
 * @QueryParam  {number}            [limit]             The maximum number of activities to return. Default: 25
 * @QueryParam  {string}            [start]             The activity paging token from which to start fetching activities
 * @Return      {ActivityStream}                        The activity stream for the specified resource
 * @HttpResponse                    200                 Activity stream returned
 * @HttpResponse                    400                 Must specify an activity stream
 * @HttpResponse                    400                 Unknown activity stream id
 * @HttpResponse                    400                 Unknown activity transformer
 * @HttpResponse                    400                 You can only view activity streams for a principal
 * @HttpResponse                    401                 Must be a member of a group to see its activity stream
 * @HttpResponse                    401                 Must be logged in to see an activity stream
 * @HttpResponse                    404                 Unknown type of resource
 */
OAE.tenantRouter.on('get', '/api/activity/:resourceId', (request, response) => {
  _handleGetActivities(request.params.resourceId, request, response);
});

/// ///////////////////////
// NOTIFICATION STREAMS //
/// ///////////////////////

/**
 * @REST getNotifications
 *
 * Get the notification stream for the current user
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /notifications
 * @QueryParam  {string}            [format]            The desired notification stream format. Defaults to activitystreams     [activitystreams,internal]
 * @QueryParam  {number}            [limit]             The maximum number of notificiations to return. Default: 25
 * @QueryParam  {string}            [start]             The notification paging token from which to start fetching notifications
 * @Return      {ActivityStream}                        The notifications stream
 * @HttpResponse                    200                 Notifications returned
 * @HttpResponse                    400                 Unknown activity transformer
 * @HttpResponse                    401                 Only authenticated users can retrieve a notification stream
 * @HttpResponse                    401                 You can only request your own notification stream
 */
OAE.tenantRouter.on('get', '/api/notifications', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 10, 1, 25);
  const userId = request.ctx.user() ? request.ctx.user().id : null;
  ActivityAPI.getNotificationStream(
    request.ctx,
    userId,
    request.query.start,
    limit,
    request.query.format,
    (error, notificationStream) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).send(notificationStream);
    }
  );
});

/**
 * @REST postNotificationsMarkRead
 *
 * Mark all notifications for the current user as read
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /notifications/markRead
 * @Return      {NotificationsRead}                     The timestamp (millis since epoch) that was persisted as the time at which the notifications were last read
 * @HttpResponse                    200                 Notifications marked as read
 * @HttpResponse                    401                 You must be logged in to mark notifications read
 */
OAE.tenantRouter.on('post', '/api/notifications/markRead', (request, response) => {
  ActivityAPI.markNotificationsRead(request.ctx, (error, lastReadTime) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).send(JSON.stringify({ lastReadTime }));
  });
});

/// /////////////////////
// PUSH NOTIFICATIONS //
/// /////////////////////

// Add websocket support
const sockjsOptions = {
  // No-op the logging
  log() {}
};
OAE.tenantServer.sockjs = sockjs.createServer(sockjsOptions);
OAE.tenantServer.sockjs.installHandlers(OAE.tenantServer.httpServer, { prefix: '/api/push' });

/*!
 * Listen for new websocket connections
 */
OAE.tenantServer.sockjs.on('connection', ActivityPush.registerConnection);
