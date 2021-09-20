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

import PrincipalsAPI from 'oae-principals';
import * as FollowingAuthz from 'oae-following/lib/authz.js';
import * as FollowingDAO from 'oae-following/lib/internal/dao.js';

const init = (callback) => {
  /*!
   * Register a full user profile decorator that will indicate if the user in context
   * is following, or is able to follow the user profile being accessed.
   */
  PrincipalsAPI.registerFullUserProfileDecorator('following', (ctx, user, callback) => {
    if (!ctx.user()) {
      return callback();
    }

    if (ctx.user().id === user.id) {
      return callback();
    }

    // Determine if the current user is following the given user
    FollowingDAO.isFollowing(ctx.user().id, [user.id], (err, following) => {
      if (err) {
        return callback(err);
      }

      // If the user is following them, we can't follow anymore, so we have all our answers
      const isFollowing = following[user.id];
      if (isFollowing) {
        return callback(null, _createFullUserProfileDecoration(false, true));
      }

      // If we aren't following, see if we're allowed to follow them
      let canFollow = true;
      FollowingAuthz.canFollow(ctx, user, (err) => {
        if (err && err.code !== 401) {
          return callback(err);
        }

        if (err) {
          canFollow = false;
        }

        return callback(null, _createFullUserProfileDecoration(canFollow, false));
      });
    });
  });

  /*!
   * Return the decoration object indicating if the user can follow the other, or if they are
   * currently following them
   *
   * @param  {Boolean}    [canFollow]     Whether or not the decoration object should indicate that the user can be followed by the user receiving the profile. Default: `false`
   * @param  {Boolean}    [isFollowing]   Whether or not the decoration object should indicate that the user is being followed by the user receiving the profile. Default: `false`
   * @return {Object}                     The decoration object to attach to the user profile
   * @api private
   */
  const _createFullUserProfileDecoration = function (canFollow, isFollowing) {
    return {
      canFollow: canFollow === true,
      isFollowing: isFollowing === true
    };
  };

  return callback();
};

export { init };
