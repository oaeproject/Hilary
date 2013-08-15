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

var ActivityAPI = require('oae-activity');
var ActivityModel = require('oae-activity/lib/model');

var FollowingAPI = require('oae-following');
var FollowingConstants = require('oae-following/lib/constants').FollowingConstants;

////////////
// FOLLOW //
////////////

ActivityAPI.registerActivityType(FollowingConstants.activity.ACTIVITY_FOLLOW,
    {
        'groupBy': [
            {
                'actor': true
            },
            {
                'object': true
            }
        ],
        'notifications': {
            'email': true,
            'emailTemplateModule': 'oae-following',
            'emailTemplateId': 'notify-follow'
        }
    }
);

/*!
 * Post a content-create activity when a user creates a content item.
 */
FollowingAPI.on(FollowingConstants.events.FOLLOW, function(ctx, followingUser, followedUser) {
    var millis = Date.now();
    var actorResource = new ActivityModel.ActivitySeedResource('user', followingUser.id, {'user': followingUser});
    var objectResource = new ActivityModel.ActivitySeedResource('user', followedUser.id, {'user': followedUser});
    var activitySeed = new ActivityModel.ActivitySeed(FollowingConstants.activity.ACTIVITY_FOLLOW, millis, FollowingConstants.activity.VERB_FOLLOW, actorResource, objectResource);
    ActivityAPI.postActivity(ctx, activitySeed);
});
