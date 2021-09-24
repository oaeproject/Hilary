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

import _ from 'underscore';

import * as ActivityAPI from 'oae-activity/lib/api.js';
import * as ActivityModel from 'oae-activity/lib/model.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as FollowingDAO from 'oae-following/lib/internal/dao.js';
import * as FollowingAPI from 'oae-following/lib/api.js';

import { AuthzConstants } from 'oae-authz/lib/constants.js';
import { ActivityConstants } from 'oae-activity/lib/constants.js';
import { FollowingConstants } from 'oae-following/lib/constants.js';

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

/*!
 * Register a user association that presents all the followers of a user
 */
ActivityAPI.registerActivityEntityAssociation('user', 'followers', (associationsCtx, entity, callback) => {
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
      followers = _.filter(followers, (follower) => {
        return userTenantAlias === AuthzUtil.getPrincipalFromId(follower).tenantAlias;
      });
    }

    return callback(null, followers);
  });
});
