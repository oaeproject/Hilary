/*!
 * Copyright 2012 Sakai Foundation (SF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://www.osedu.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

var RestUtil = require('./util');

var COLLECTION_DELAY = 250;

/**
 * Get the activity stream of the user in context.
 *
 * @param   {RestContext}   restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. For this function to work, the passed in restCtx should be an anonymous REST context
 * @param   {Object}        [opts]              Optional parameters for the request
 * @param   {Number}        [opts.from]         The time since the epoch in millis from which to get activities. All activities after this time will have occurred after this time
 * @param   {Number}        [opts.limit]        The number of activities to return
 * @param   {Function}      callback            Standard callback method
 * @param   {Object}        callback.err        Error object containing error code and error message
 */
var getCurrentUserActivityStream = module.exports.getCurrentUserActivityStream = function(restCtx, opts, callback) {
    RestUtil.RestRequest(restCtx, '/api/activity', 'GET', opts, callback);
};

/**
 * Get the activity stream by its id.
 *
 * @param   {RestContext}   restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. For this function to work, the passed in restCtx should be an anonymous REST context
 * @param   {String}        activityStreamId    The ID of the activity stream to fetch
 * @param   {Object}        [opts]              Optional parameters for the request
 * @param   {Number}        [opts.from]         The time since the epoch in millis from which to get activities. All activities after this time will have occurred after this time
 * @param   {Number}        [opts.limit]        The number of activities to return
 * @param   {Function}      callback            Standard callback method
 * @param   {Object}        callback.err        Error object containing error code and error message
 */
var getActivityStream = module.exports.getActivityStream = function(restCtx, activityStreamId, opts, callback) {
    RestUtil.RestRequest(restCtx, '/api/activity/' + RestUtil.encodeURIComponent(activityStreamId), 'GET', opts, callback);
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
