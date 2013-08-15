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

var _ = require('underscore');
var assert = require('assert');

var FollowingDAO = require('oae-following/lib/internal/dao');
var TestsUtil = require('oae-tests/lib/util');

describe('Following DAO', function() {

    it('verify we can save and get follows', function(callback) {
        var userIdFollowed = 'c:cam:followed';
        var userIdFollower = 'c:cam:follower';

        FollowingDAO.saveFollows(userIdFollower, [userIdFollowed], function(err) {
            assert.ok(!err);

            FollowingDAO.getFollowers(userIdFollowed, null, 10, function(err, followerIds) {
                assert.ok(!err);
                assert.equal(followerIds.length, 1);
                assert.equal(followerIds[0], userIdFollower);

                FollowingDAO.getFollowing(userIdFollower, null, 10, function(err, followingIds) {
                    assert.ok(!err);
                    assert.equal(followingIds.length, 1);
                    assert.equal(followingIds[0], userIdFollowed);
                    return callback(err);
                });
            });
        });
    });
});