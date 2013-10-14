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

var RestUtil = require('./util');

/**
 * Get the list of followers of a user
 *
 * @param  {RestContext}    restCtx                     The REST context with which to make the request
 * @param  {String}         userId                      The id of the user whose followers to get
 * @param  {Number}         [start]                     The id of the user from which to start returning this page of results
 * @param  {Number}         [limit]                     The maximum number of users to return
 * @param  {Function}       callback                    Standard callback method
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object}         callback.response           A response containing the followers
 * @param  {User[]}         callback.response.results   The users that follow the user specified by `userId`
 * @param  {String}         callback.response.nextToken The token to use as the `start` parameter for the next page of followers
 */
var getFollowers = module.exports.getFollowers = function(restCtx, userId, start, limit, callback) {
    RestUtil.RestRequest(restCtx, '/api/following/' + RestUtil.encodeURIComponent(userId) + '/followers', 'GET', {'start': start, 'limit': limit}, callback);
};

/**
 * Get the list of users that the user specified by `userId` follows
 *
 * @param  {RestContext}    restCtx                     The REST context with which to make the request
 * @param  {String}         userId                      The id of the user whose following list to get
 * @param  {Number}         [start]                     The is of the user from which to start returning this page of results
 * @param  {Number}         [limit]                     The maximum number of activities to return
 * @param  {Function}       callback                    Standard callback method
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object}         callback.response           A response containing the users that the specified user follows
 * @param  {User[]}         callback.response.results   The users that the specified user is following
 * @param  {String}         callback.response.nextToken The token to use as the `start` parameter for the next page of followed users
 */
var getFollowing = module.exports.getFollowing = function(restCtx, userId, start, limit, callback) {
    RestUtil.RestRequest(restCtx, '/api/following/' + RestUtil.encodeURIComponent(userId) + '/following', 'GET', {'start': start, 'limit': limit}, callback);
};

/**
 * Start following a user
 *
 * @param  {RestContext}    restCtx         The REST context with which to make the request
 * @param  {String}         userId          The id of the user to follow
 * @param  {Function}       callback        Invoked when the process completes
 * @param  {Object}         callback.err    An error that occurred, if any
 */
var follow = module.exports.follow = function(restCtx, userId, callback) {
    RestUtil.RestRequest(restCtx, '/api/following/' + RestUtil.encodeURIComponent(userId) + '/follow', 'POST', null, callback);
};

/**
 * Stop following a user
 *
 * @param  {RestContext}    restCtx         The REST context with which to make the request
 * @param  {String}         userId          The id of the user to unfollow
 * @param  {Function}       callback        Invoked when the process completes
 * @param  {Object}         callback.err    An error that occurred, if any
 */
var unfollow = module.exports.unfollow = function(restCtx, userId, callback) {
    RestUtil.RestRequest(restCtx, '/api/following/' + RestUtil.encodeURIComponent(userId) + '/unfollow', 'POST', null, callback);
};
