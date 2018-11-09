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

const ActivityAPI = require('oae-activity');
const { ActivityConstants } = require('oae-activity/lib/constants');
const ActivityModel = require('oae-activity/lib/model');
const { AuthzConstants } = require('oae-authz/lib/constants');
const AuthzUtil = require('oae-authz/lib/util');

const FollowingAPI = require('oae-following');
const { FollowingConstants } = require('oae-following/lib/constants');
const FollowingDAO = require('oae-following/lib/internal/dao');

/// ///////////////////
// FOLLOWING-FOLLOW //
/// ///////////////////

ActivityAPI.registerActivityType(FollowingConstants.activity.ACTIVITY_FOLLOW, {
  groupBy: [
    // Branden followed Simon, Nicolaas and 3 others
    { actor: true },

    // Simon, Bert and 3 others followed Stuart
    { object: true }
  ],
  streams: {
    activity: {
      router: {
        actor: ['self', 'followers'],
        object: ['self']
      }
    },
    notification: {
      router: {
        object: ['self']
      }
    },
    email: {
      router: {
        object: ['self']
      }
    }
  }
});

/*!
 * Post a following-follow activity when a user follows another user
 */
FollowingAPI.emitter.on(FollowingConstants.events.FOLLOW, (ctx, followingUser, followedUser) => {
  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', followingUser.id, {
    user: followingUser
  });
  const objectResource = new ActivityModel.ActivitySeedResource('user', followedUser.id, {
    user: followedUser
  });
  const activitySeed = new ActivityModel.ActivitySeed(
    FollowingConstants.activity.ACTIVITY_FOLLOW,
    millis,
    ActivityConstants.verbs.FOLLOW,
    actorResource,
    objectResource
  );
  ActivityAPI.postActivity(ctx, activitySeed);
});

/// ///////////////////////////////
// ACTIVITY ENTITY ASSOCIATIONS //
/// ///////////////////////////////

/*!
 * Register a user association that presents all the followers of a user
 */
ActivityAPI.registerActivityEntityAssociation(
  'user',
  'followers',
  (associationsCtx, entity, callback) => {
    // Get all the followers of the user
    const userId = entity.user.id;
    const userTenantAlias = entity.user.tenant.alias;
    const userVisibility = entity.user.visibility;

    // When a user is private, their followers are effectively no longer associated
    if (userVisibility === AuthzConstants.visibility.PRIVATE) {
      return callback(null, []);
    }

    FollowingDAO.getFollowers(userId, null, 10000, (err, followers) => {
      if (err) {
        return callback(err);
      }
      if (userVisibility === AuthzConstants.visibility.LOGGEDIN) {
        // If the user is loggedin, only associate the user to followers that are within their tenant
        followers = _.filter(followers, follower => {
          return userTenantAlias === AuthzUtil.getPrincipalFromId(follower).tenantAlias;
        });
      }

      return callback(null, followers);
    });
  }
);
