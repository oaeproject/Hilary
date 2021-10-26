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

import assert from 'node:assert';
import _ from 'underscore';

import * as RestAPI from 'oae-rest';
import * as SearchTestUtil from 'oae-search/lib/test/util.js';
import * as TestsUtil from 'oae-tests/lib/util.js';

/**
 * Create 2 users, one following the other
 *
 * @param  {RestContext}    restCtx                         The REST context with which to create the users
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.follower               An object holding the restContext and user object of the user following the other
 * @param  {RestContext}    callback.follower.restContext   The rest context of the user following the other
 * @param  {User}           callback.follower.user          The user object representing the user following the other
 * @param  {Object}         callback.followed               An object holding the restContext and user object of the user being followed by the other
 * @param  {RestContext}    callback.followed.restContext   The rest context of the user following the other
 * @param  {User}           callback.followed.user          The user object representing the user being followed by the other
 */
const createFollowerAndFollowed = function (restCtx, callback) {
  TestsUtil.generateTestUsers(restCtx, 2, (error, testUsers) => {
    const follower = _.values(testUsers)[0];
    const following = _.values(testUsers)[1];

    RestAPI.Following.follow(follower.restContext, following.user.id, (error) => {
      assert.ok(!error);
      return callback(follower, following);
    });
  });
};

/**
 * Perform the requests necessary for the provided followed user to become followed by the given list of users
 *
 * @param  {String}         followedUserId                      The id of the user to be followed
 * @param  {Object[]}       followerUserInfos                   The users with which to follow the followed user
 * @param  {RestContext}    followerUserInfos[i].restContext    The REST context that can be used to make the request to follow the followed user for this user
 * @param  {User}           followerUserInfos[i].user           The user object of the user to follow the followed user
 * @param  {Function}       callback                            Standard callback function
 */
const followByAll = function (followedUserId, followerUserInfos, callback) {
  if (_.isEmpty(followerUserInfos)) {
    return callback();
  }

  followerUserInfos = [...followerUserInfos];
  const followerUserInfo = followerUserInfos.shift();
  RestAPI.Following.follow(followerUserInfo.restContext, followedUserId, (error) => {
    assert.ok(!error);

    // Recursively invoke the method again to follow the followedUserId by the next follower user in the list
    return followByAll(followedUserId, followerUserInfos, callback);
  });
};

/**
 * Perform the requests necessary for the provided follower user to begin following all the followed users
 *
 * @param  {RestContext}    restContext         The REST context that can be used to make the request to follow the followed users
 * @param  {String[]}       followedUserIds     The ids of the users to follow
 * @param  {Function}       callback            Standard callback function
 */
const followAll = function (restContext, followedUserIds, callback) {
  if (_.isEmpty(followedUserIds)) {
    return callback();
  }

  followedUserIds = [...followedUserIds];
  const followedUserId = followedUserIds.shift();
  RestAPI.Following.follow(restContext, followedUserId, (error) => {
    assert.ok(!error);

    // Recursively invoke the method again to follow the next user in the list
    return followAll(restContext, followedUserIds, callback);
  });
};

/**
 * Get all the followers, ensuring the list of all user ids is equal to the one provided
 *
 * @param  {RestContext}    restContext             The REST context that will be used to list the followers
 * @param  {String}         userId                  The id of the user whose followers to check
 * @param  {Object}         [opts]                  Optional arguments
 * @param  {Number}         [opts.batchSize]        The page size to fetch when getting all followers
 * @param  {String[]}       expectedFollowerIds     The list of user ids to expect
 * @param  {Function}       callback                Invoked when all assertions pass
 * @param  {User[]}         callback.followers      All followers of the specified user
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertGetAllFollowersEquals = function (restCtx, userId, options, expectedFollowerIds, callback) {
  assertGetAllFollowersSucceeds(restCtx, userId, options, (followers) => {
    assert.deepStrictEqual(_.pluck(followers, 'id').sort(), [...expectedFollowerIds].sort());
    return callback(followers);
  });
};

/**
 * Get all the followers of the specified user
 *
 * @param  {RestContext}    restContext             The REST context that will be used to list the followers
 * @param  {String}         userId                  The id of the user whose followers to get
 * @param  {Object}         [opts]                  Optional arguments
 * @param  {Number}         [opts.batchSize]        The page size to fetch when getting all followers
 * @param  {Function}       callback                Invoked when all assertions pass
 * @param  {User[]}         callback.followers      All followers of the specified user
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertGetAllFollowersSucceeds = function (restCtx, userId, options, callback, _followers, _nextToken) {
  if (_nextToken === null) {
    return callback(_followers);
  }

  options = options || {};
  assertGetFollowersSucceeds(restCtx, userId, { start: _nextToken, limit: options.batchSize }, (result) =>
    assertGetAllFollowersSucceeds(
      restCtx,
      userId,
      options,
      callback,
      _.union(_followers, result.results),
      result.nextToken
    )
  );
};

/**
 * Get a list of followers for the specified user
 *
 * @param  {RestContext}    restContext             The REST context that will be used to list the followers
 * @param  {String}         userId                  The id of the user whose followers to get
 * @param  {Object}         [opts]                  Optional arguments
 * @param  {Number}         [opts.start]            The paging index at which to start listing followers
 * @param  {Number}         [opts.limit]            The maximum number of followers to return
 * @param  {Function}       callback                Invoked when all assertions pass
 * @param  {User[]}         callback.followers      A list of followers of the specified user
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertGetFollowersSucceeds = function (restCtx, userId, options, callback) {
  options = options || {};
  RestAPI.Following.getFollowers(restCtx, userId, options.start, options.limit, (error, result, nextToken) => {
    assert.ok(!error);
    assert.ok(_.isArray(result.results));
    if (_.isNumber(options.limit) && options.limit > 0) {
      assert.ok(result.results.length <= options.limit);
    }

    assert.ok(_.isString(result.nextToken) || _.isNull(result.nextToken));

    return callback(result, nextToken);
  });
};

/**
 * Get all the users followed by the specified user, ensuring the list of all user ids is equal to the
 * one provided
 *
 * @param  {RestContext}    restContext             The REST context that will be used to list the followed users
 * @param  {String}         userId                  The id of the user whose followed users to check
 * @param  {Object}         [opts]                  Optional arguments
 * @param  {Number}         [opts.batchSize]        The page size to fetch when getting all followed users
 * @param  {String[]}       expectedFollowingIds    The list of user ids to expect
 * @param  {Function}       callback                Invoked when all assertions pass
 * @param  {User[]}         callback.following      All followed users of the specified user
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertGetAllFollowingEquals = function (restCtx, userId, options, expectedFollowingIds, callback) {
  assertGetAllFollowingSucceeds(restCtx, userId, options, (following) => {
    assert.deepStrictEqual(_.pluck(following, 'id').sort(), [...expectedFollowingIds].sort());
    return callback(following);
  });
};

/**
 * Get all the users followed by the specified user of the specified user
 *
 * @param  {RestContext}    restContext             The REST context that will be used to list the followed users
 * @param  {String}         userId                  The id of the user whose followed users to get
 * @param  {Object}         [opts]                  Optional arguments
 * @param  {Number}         [opts.batchSize]        The page size to fetch when getting all followed users
 * @param  {Function}       callback                Invoked when all assertions pass
 * @param  {User[]}         callback.following      All followed users of the specified user
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertGetAllFollowingSucceeds = function (restCtx, userId, options, callback, _following, _nextToken) {
  if (_nextToken === null) {
    return callback(_following);
  }

  options = options || {};
  assertGetFollowingSucceeds(restCtx, userId, { start: _nextToken, limit: options.batchSize }, (result) =>
    assertGetAllFollowingSucceeds(
      restCtx,
      userId,
      options,
      callback,
      _.union(_following, result.results),
      result.nextToken
    )
  );
};

/**
 * Get a list of users being followed by the specified user
 *
 * @param  {RestContext}    restContext             The REST context that will be used to list the followed users
 * @param  {String}         userId                  The id of the user whose followed users to get
 * @param  {Object}         [opts]                  Optional arguments
 * @param  {Number}         [opts.start]            The paging index at which to start listing followed users
 * @param  {Number}         [opts.limit]            The maximum number of followed users to return
 * @param  {Function}       callback                Invoked when all assertions pass
 * @param  {User[]}         callback.following      A list of users who are being followed by the specified user
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertGetFollowingSucceeds = function (restCtx, userId, options, callback) {
  options = options || {};
  RestAPI.Following.getFollowing(restCtx, userId, options.start, options.limit, (error, result, nextToken) => {
    assert.ok(!error);
    assert.ok(_.isArray(result.results));
    if (_.isNumber(options.limit) && options.limit > 0) {
      assert.ok(result.results.length <= options.limit);
    }

    assert.ok(_.isString(result.nextToken) || _.isNull(result.nextToken));

    return callback(result, nextToken);
  });
};

/**
 * Ensure that the follower user follows the followed user according to both the follower and following listings.
 *
 * @param  {String}         followerUserId      The id of the follower user
 * @param  {RestContext}    followerRestCtx     The REST context that can be used to execute requests on behalf of the follower user
 * @param  {String}         followedUserId      The id of the expected followed user
 * @param  {RestContext}    followerRestCtx     The REST context that can be used to execute requests on behalf of the followed user
 * @param  {Function}       callback            Standard callback function
 */
const assertFollows = function (followerUserId, followerRestCtx, followedUserId, followedRestCtx, callback) {
  _findFollowerAndFollowing(followerUserId, followerRestCtx, followedUserId, followedRestCtx, (follower, followed) => {
    assert.ok(follower);
    assert.strictEqual(follower.id, followerUserId);
    assert.ok(followed);
    assert.strictEqual(followed.id, followedUserId);
    return callback();
  });
};

/**
 * Ensure that the follower user *does not* follow the followed user according to both the follower and following listings.
 *
 * @param  {String}         followerUserId      The id of the follower user
 * @param  {RestContext}    followerRestCtx     The REST context that can be used to execute requests on behalf of the follower user
 * @param  {String}         followedUserId      The id of the expected followed user
 * @param  {RestContext}    followerRestCtx     The REST context that can be used to execute requests on behalf of the followed user
 * @param  {Function}       callback            Standard callback function
 */
const assertDoesNotFollow = function (followerUserId, followerRestCtx, followedUserId, followedRestCtx, callback) {
  _findFollowerAndFollowing(followerUserId, followerRestCtx, followedUserId, followedRestCtx, (follower, followed) => {
    if (follower) {
      assert.notStrictEqual(follower.id, followerUserId);
    }

    if (followed) {
      assert.notStrictEqual(followed.id, followedUserId);
    }

    return callback();
  });
};

/**
 * Ensure that both the following and follower feeds return the expected http status code
 *
 * @param  {RestContext}    restCtx     The REST context to perform the requests with
 * @param  {String[]}       userIds     The ids of the users whose feeds to request
 * @param  {Number}         httpCode    The expected HTTP status code
 * @param  {Function}       callback    Standard callback function
 * @throws {AssertionError}             Thrown if an assertion fails
 */
const assertNoFollowFeedAccess = function (restCtx, userIds, httpCode, callback) {
  if (_.isEmpty(userIds)) {
    return callback();
  }

  const userId = userIds.shift();
  RestAPI.Following.getFollowers(restCtx, userId, null, null, (error) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);

    RestAPI.Following.getFollowing(restCtx, userId, null, null, (error) => {
      assert.ok(error);
      assert.strictEqual(error.code, httpCode);
      return assertNoFollowFeedAccess(restCtx, userIds, httpCode, callback);
    });
  });
};

/**
 * Ensure that both the following and follower feeds do not err when requesting with the given rest context
 *
 * @param  {RestContext}    restCtx     The REST context to perform the requests with
 * @param  {String[]}       userIds     The ids of the users whose feeds to request
 * @param  {Function}       callback    Standard callback function
 */
const assertHasFollowFeedAccess = function (restCtx, userIds, callback) {
  if (_.isEmpty(userIds)) {
    return callback();
  }

  const userId = userIds.shift();
  _findFollowerAndFollowing(userId, restCtx, userId, restCtx, () =>
    // We don't actually care about the results, we just care about the no-err assertions in the method
    assertHasFollowFeedAccess(restCtx, userIds, callback)
  );
};

/**
 * Ensure that the user in context does not have access to search the followers or following of the given users
 *
 * @param  {RestContext}    restCtx     The REST context to perform the requests with
 * @param  {String[]}       userIds     The ids of the users whose search feeds the user in context should not have access to
 * @param  {Number}         httpCode    The expected HTTP status code
 * @param  {Function}       callback    Standard callback function
 */
const assertNoSearchFeedAccess = function (restCtx, userIds, httpCode, callback) {
  if (_.isEmpty(userIds)) {
    return callback();
  }

  const userId = userIds.shift();
  RestAPI.Search.search(restCtx, 'following', [userId], null, (error, response) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    assert.ok(!response);

    RestAPI.Search.search(restCtx, 'followers', [userId], null, (error, response) => {
      assert.ok(error);
      assert.strictEqual(error.code, httpCode);
      assert.ok(!response);
      return assertNoSearchFeedAccess(restCtx, userIds, httpCode, callback);
    });
  });
};

/**
 * Ensure that the user in context has access to search the followers or following of the given users
 *
 * @param  {RestContext}    restCtx         The REST context to perform the requests with
 * @param  {String[]}       userIds         The ids of the users whose search feeds the user in context should have access to
 * @param  {Function}       callback        Standard callback function
 */
const assertHasSearchFeedAccess = function (restCtx, userIds, callback) {
  if (_.isEmpty(userIds)) {
    return callback();
  }

  const userId = userIds.shift();
  searchFollowerAndFollowing(userId, restCtx, userId, restCtx, () =>
    // We don't actually care about the results, we just care about the no-err assertions in the method
    assertHasSearchFeedAccess(restCtx, userIds, callback)
  );
};

/**
 * Search the following feed as the followerUserId and the followers feed of the followedUserId with no query parameters. This will effectively
 * get the search documents that represents the "follower user" and the "followed user" from the "followers" and "following" search feeds,
 * respectively.
 *
 * @param  {String}         followerUserId              The id of the follower user
 * @param  {RestContext}    followerRestCtx             The REST context that can be used to execute requests on behalf of the follower user
 * @param  {String}         followedUserId              The id of the expected followed user
 * @param  {RestContext}    followerRestCtx             The REST context that can be used to execute requests on behalf of the followed user
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         [callback.followerUserDoc]  The follower user document from the following search that matches the follower user id. If unspecified, the user was not found
 * @param  {Object}         [callback.followedUserDoc]  The followed user document from the followers search that matches the followed user id. If unspecified, the user was not found
 */
const searchFollowerAndFollowing = function (
  followerUserId,
  followerRestCtx,
  followedUserId,
  followedRestCtx,
  callback
) {
  SearchTestUtil.searchAll(followerRestCtx, 'following', [followerUserId], null, (error, followingResponse) => {
    assert.ok(!error);

    SearchTestUtil.searchAll(followedRestCtx, 'followers', [followedUserId], null, (error, followerResponse) => {
      assert.ok(!error);

      return callback(
        _.findWhere(followerResponse.results, { id: followerUserId }),
        _.findWhere(followingResponse.results, { id: followedUserId })
      );
    });
  });
};

/**
 * Find the follower user from the following list and the followed user from the follower list from each user.
 *
 * @param  {String}         followerUserId          The id of the follower user
 * @param  {RestContext}    followerRestCtx         The REST context that can be used to execute requests on behalf of the follower user
 * @param  {String}         followedUserId          The id of the expected followed user
 * @param  {RestContext}    followerRestCtx         The REST context that can be used to execute requests on behalf of the followed user
 * @param  {Function}       callback                Standard callback function
 * @param  {User}           [callback.follower]     The follower user from the following list. If unspecified, the user was not found
 * @param  {User}           [callback.followed]     The followed user from the followers list. If unspecified, the user was not found
 * @api private
 */
const _findFollowerAndFollowing = function (
  followerUserId,
  followerRestCtx,
  followedUserId,
  followedRestCtx,
  callback
) {
  // To ensure the first item would be the user we're looking for, we simply slice one character off the end as the start
  assertGetAllFollowingSucceeds(followerRestCtx, followerUserId, null, (following) => {
    const followed = _.findWhere(following, { id: followedUserId });

    // Now we're looking for the follower user in the followers list of the followed user
    assertGetAllFollowersSucceeds(followedRestCtx, followedUserId, null, (followers) => {
      const follower = _.findWhere(followers, { id: followerUserId });

      return callback(follower, followed);
    });
  });
};

export {
  createFollowerAndFollowed,
  followByAll,
  followAll,
  assertGetAllFollowersEquals,
  assertGetAllFollowersSucceeds,
  assertGetFollowersSucceeds,
  assertGetAllFollowingEquals,
  assertGetAllFollowingSucceeds,
  assertGetFollowingSucceeds,
  assertFollows,
  assertDoesNotFollow,
  assertNoFollowFeedAccess,
  assertHasFollowFeedAccess,
  searchFollowerAndFollowing,
  assertNoSearchFeedAccess,
  assertHasSearchFeedAccess
};
