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

var FollowingAPI = require('oae-following');
var FollowingConstants = require('oae-following/lib/constants').FollowingConstants;

var MixpanelUtil = require('oae-mixpanel/lib/util');

module.exports = function(client) {

    /*!
     * Following a user
     */
    MixpanelUtil.listen(FollowingAPI, FollowingConstants.events.FOLLOW, function(ctx, follower, followedUser) {
        var params = MixpanelUtil.getBasicParameters(ctx);
        params.followed = followedUser.id;
        client.track(FollowingConstants.events.FOLLOW, params);
        client.people.increment(params.distinct_id, FollowingConstants.events.FOLLOW);
    });

    /*!
     * Unfollowing a user
     */
    MixpanelUtil.listen(FollowingAPI, FollowingConstants.events.UNFOLLOW, function(ctx, follower, unfollowedUserId) {
        var params = MixpanelUtil.getBasicParameters(ctx);
        params.unfollowed = unfollowedUserId;
        client.track(FollowingConstants.events.UNFOLLOW, params);
        client.people.increment(params.distinct_id, FollowingConstants.events.UNFOLLOW);
    });

    /*!
     * Getting the users that are following a user
     */
    MixpanelUtil.listen(FollowingAPI, FollowingConstants.events.GET_FOLLOWERS, function(ctx, userId, start, limit, users) {
        var params = MixpanelUtil.getBasicParameters(ctx);
        params.start = start || 0;
        client.track(FollowingConstants.events.GET_FOLLOWERS, params);
        client.people.increment(params.distinct_id, FollowingConstants.events.GET_FOLLOWERS);
    });

    /*!
     * Getting the users that a user is following
     */
    MixpanelUtil.listen(FollowingAPI, FollowingConstants.events.GET_FOLLOWING, function(ctx, userId, start, limit, users) {
        var params = MixpanelUtil.getBasicParameters(ctx);
        params.start = start || 0;
        client.track(FollowingConstants.events.GET_FOLLOWING, params);
        client.people.increment(params.distinct_id, FollowingConstants.events.GET_FOLLOWING);
    });
};
