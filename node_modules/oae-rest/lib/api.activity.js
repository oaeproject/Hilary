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

var RestUtil = require('./util');

/**
 * Get the activity stream of the user in context.
 *
 * @param  {RestContext}    restCtx                 Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Object}         [opts]                  Optional parameters for the request
 * @param  {Number}         [opts.start]            The activity ID to start from, this activity will not be included in the response
 * @param  {Number}         [opts.limit]            The maximum number of activities to return
 * @param  {String}         [opts.format]           The format that should be used to format the activities
 * @param  {Function}       callback                Standard callback method
 * @param  {Object}         callback.err            Error object containing error code and error message
 * @param  {ActivityStream} callback.activityStream The stream of activities
 */
var getCurrentUserActivityStream = module.exports.getCurrentUserActivityStream = function(restCtx, opts, callback) {
    RestUtil.RestRequest(restCtx, '/api/activity', 'GET', opts, callback);
};

/**
 * Get the activity stream by its id.
 *
 * @param  {RestContext}    restCtx                 Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         activityStreamId        The ID of the activity stream to fetch
 * @param  {Object}         [opts]                  Optional parameters for the request
 * @param  {Number}         [opts.start]            The activity ID to start from, this activity will not be included in the response
 * @param  {Number}         [opts.limit]            The maximum number of activities to return
 * @param  {String}         [opts.format]           The format that should be used to format the activities
 * @param  {Function}       callback                Standard callback method
 * @param  {Object}         callback.err            Error object containing error code and error message
 * @param  {ActivityStream} callback.activityStream The stream of activities
 */
var getActivityStream = module.exports.getActivityStream = function(restCtx, activityStreamId, opts, callback) {
    RestUtil.RestRequest(restCtx, '/api/activity/' + RestUtil.encodeURIComponent(activityStreamId), 'GET', opts, callback);
};

/**
 * Get the notifications for the current user in context.
 *
 * @param  {RestContext}    restCtx                     Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Object}         [opts]                      Optional parameters for the request
 * @param  {Number}         [opts.start]                The notification ID to start from, this notification will not be included in the response
 * @param  {Number}         [opts.limit]                The maximum number of notifications to return
 * @param  {String}         [opts.format]               The format that should be used to format the activities
 * @param  {Function}       callback                    Standard callback method
 * @param  {Object}         callback.err                Error object containing error code and error message
 * @param  {ActivityStream} callback.notificationStream The stream of notifications
 */
var getNotificationStream = module.exports.getNotificationStream = function(restCtx, opts, callback) {
    RestUtil.RestRequest(restCtx, '/api/notifications', 'GET', opts, callback);
};

/**
 * Mark all notifications for the current user in context as read.
 *
 * @param  {RestContext}    restCtx                 Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Function}       callback                Invoked when the request has completed
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Number}         callback.lastReadTime   The timestamp (millis since epoch) detailing the last time notifications were marked as read
 */
var markNotificationsRead = module.exports.markNotificationsRead = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/notifications/markRead', 'POST', null, callback);
};

/**
 * Manually perform a collection of the current activities that have been queued for aggregation.
 *
 * @param  {RestContext}   restCtx              The REST context with which to perform the collection request
 * @param  {Function}      callback             Standard callback method
 * @param  {Object}        callback.err         Error object containing error code and error message
 */
var collect = module.exports.collect = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/activity/collect', 'POST', null, callback);
};
