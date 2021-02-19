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

import assert from 'assert';

import * as RestAPI from 'oae-rest';
import * as SearchTestsUtil from 'oae-search/lib/test/util';
import * as TestsUtil from 'oae-tests/lib/util';
import * as FollowingTestsUtil from 'oae-following/lib/test/util';

let globalAdminOnTenantRestContext = null;
let camAnonymousRestContext = null;
let camAdminRestContext = null;
let gtAdminRestContext = null;

describe('Following Search', () => {
  /**
   * Function that will fill up the anonymous and admin REST context
   *
   * Because we truncate the `Principals` table in one of our tests we need
   * to re-create the rest contexts for each test so we can ensure our admin
   * session will always point to a valid principal record
   */
  beforeEach((callback) => {
    camAnonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);

    // Authenticate the global admin into a tenant so we can perform user-tenant requests with a global admin to test their access
    RestAPI.Admin.loginOnTenant(TestsUtil.createGlobalAdminRestContext(), 'localhost', null, (error, ctx) => {
      assert.ok(!error);
      globalAdminOnTenantRestContext = ctx;
      return callback();
    });
  });

  /**
   * Test that verifies searching the following and followers lists results in a correct empty search result
   */
  it('verify search with no followers or following', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, testUsers) => {
      assert.ok(!error);
      const { 0: user } = testUsers;

      RestAPI.Search.search(user.restContext, 'following', [user.user.id], null, (error, response) => {
        assert.ok(!error);
        assert.ok(response);
        assert.strictEqual(response.total, 0);
        assert.ok(response.results);
        assert.strictEqual(response.results.length, 0);

        RestAPI.Search.search(user.restContext, 'followers', [user.user.id], null, (error, response) => {
          assert.ok(!error);
          assert.ok(response);
          assert.strictEqual(response.total, 0);
          assert.ok(response.results);
          assert.strictEqual(response.results.length, 0);
          return callback();
        });
      });
    });
  });

  /**
   * Test that verifies validation of the following search
   */
  it('verify validation of following search', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, testUsers) => {
      assert.ok(!error);
      const { 0: user } = testUsers;

      // Ensure failure with a non-valid resource id
      RestAPI.Search.search(user.restContext, 'following', ['not-a-valid-id'], null, (error, response) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        assert.ok(!response);

        // Ensure failure with group id instead of user id
        RestAPI.Search.search(user.restContext, 'following', ['g:not-a:user-id'], null, (error, response) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.ok(!response);

          // Ensure failure with non-existent user id
          RestAPI.Search.search(user.restContext, 'following', ['u:cam:nonExistentUserId'], null, (error, response) => {
            assert.ok(error);
            assert.strictEqual(error.code, 404);
            assert.ok(!response);

            // Sanity check a valid search
            RestAPI.Search.search(user.restContext, 'following', [user.user.id], null, (error, response) => {
              assert.ok(response);
              assert.strictEqual(response.total, 0);
              assert.ok(response.results);
              assert.strictEqual(response.results.length, 0);
              return callback();
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies validation of the followers search
   */
  it('verify validation of followers search', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, testUsers) => {
      assert.ok(!error);
      const { 0: user } = testUsers;

      // Ensure failure with a non-valid resource id
      RestAPI.Search.search(user.restContext, 'followers', ['not-a-valid-id'], null, (error, response) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        assert.ok(!response);

        // Ensure failure with group id instead of user id
        RestAPI.Search.search(user.restContext, 'followers', ['g:not-a:user-id'], null, (error, response) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.ok(!response);

          // Ensure failure with non-existent user id
          RestAPI.Search.search(user.restContext, 'followers', ['u:cam:nonExistentUserId'], null, (error, response) => {
            assert.ok(error);
            assert.strictEqual(error.code, 404);
            assert.ok(!response);

            // Sanity check a valid search
            RestAPI.Search.search(user.restContext, 'followers', [user.user.id], null, (error, response) => {
              assert.ok(response);
              assert.strictEqual(response.total, 0);
              assert.ok(response.results);
              assert.strictEqual(response.results.length, 0);
              return callback();
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies when someone follows someone, they appear in both the following and followers search of the respective users
   */
  it('verify followers and following searches reflect follows and unfollows', (callback) => {
    // Create 2 users, one following the other
    FollowingTestsUtil.createFollowerAndFollowed(camAdminRestContext, (follower, followed) => {
      // Search the following feed of the follower and the followers feed of the followed user and ensure that the users appear in the respective results
      FollowingTestsUtil.searchFollowerAndFollowing(
        follower.user.id,
        follower.restContext,
        followed.user.id,
        followed.restContext,
        (followerUserDoc, followedUserDoc) => {
          assert.ok(followerUserDoc);
          assert.ok(followedUserDoc);

          // Unfollow the user and ensure that neither appears in the feeds now
          RestAPI.Following.unfollow(follower.restContext, followed.user.id, (error) => {
            assert.ok(!error);

            // Perform the search on the follower and following feeds and ensure that the users no longer appear
            FollowingTestsUtil.searchFollowerAndFollowing(
              follower.user.id,
              follower.restContext,
              followed.user.id,
              followed.restContext,
              (followerUserDoc, followedUserDoc) => {
                assert.ok(!followerUserDoc);
                assert.ok(!followedUserDoc);
                return callback();
              }
            );
          });
        }
      );
    });
  });

  /**
   * Test that verifies the followers and following search privacy doesn't leak sensitive information
   */
  it('verify follow search privacy', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 4, (error, testUsers) => {
      const { 0: privateUser, 1: loggedinUser, 2: publicUser, 3: bert } = testUsers;

      RestAPI.User.updateUser(privateUser.restContext, privateUser.user.id, { visibility: 'private' }, (error_) => {
        assert.ok(!error_);

        RestAPI.User.updateUser(
          loggedinUser.restContext,
          loggedinUser.user.id,
          { visibility: 'loggedin' },
          (error_) => {
            assert.ok(!error_);

            // Verify anonymous can only see public follow searches
            FollowingTestsUtil.assertNoSearchFeedAccess(
              camAnonymousRestContext,
              [privateUser.user.id, loggedinUser.user.id],
              401,
              () => {
                FollowingTestsUtil.assertHasFollowFeedAccess(camAnonymousRestContext, [publicUser.user.id], () => {
                  // Verify gt admin can only see public follow searches
                  FollowingTestsUtil.assertNoSearchFeedAccess(
                    gtAdminRestContext,
                    [privateUser.user.id, loggedinUser.user.id],
                    401,
                    () => {
                      FollowingTestsUtil.assertHasSearchFeedAccess(gtAdminRestContext, [publicUser.user.id], () => {
                        // Verify bert can see only public and loggedin follow searches
                        FollowingTestsUtil.assertNoSearchFeedAccess(
                          bert.restContext,
                          [privateUser.user.id],
                          401,
                          () => {
                            FollowingTestsUtil.assertHasSearchFeedAccess(
                              bert.restContext,
                              [publicUser.user.id, loggedinUser.user.id],
                              () => {
                                // Verify private user can see follow searches
                                FollowingTestsUtil.assertHasSearchFeedAccess(
                                  privateUser.restContext,
                                  [publicUser.user.id, loggedinUser.user.id, privateUser.user.id],
                                  () => {
                                    // Verify cam admin can see follow searches
                                    FollowingTestsUtil.assertHasSearchFeedAccess(
                                      camAdminRestContext,
                                      [publicUser.user.id, loggedinUser.user.id, privateUser.user.id],
                                      () => {
                                        // Verify global admin can see follow searches
                                        FollowingTestsUtil.assertHasSearchFeedAccess(
                                          globalAdminOnTenantRestContext,
                                          [publicUser.user.id, loggedinUser.user.id, privateUser.user.id],
                                          callback
                                        );
                                      }
                                    );
                                  }
                                );
                              }
                            );
                          }
                        );
                      });
                    }
                  );
                });
              }
            );
          }
        );
      });
    });
  });

  /**
   * Test that verifies that followers are reindexed when the search index is built with reindexAll
   */
  it('verify following search reindexes with reindex all', (callback) => {
    // Clear all the data in the system to speed up the `reindexAll` operation in this test
    TestsUtil.clearAllData(() => {
      // Create 2 users, one following the other
      FollowingTestsUtil.createFollowerAndFollowed(camAdminRestContext, (follower, followed) => {
        // Search the following feed of the follower and the followers feed of the followed user and ensure that the users appear in the respective results
        FollowingTestsUtil.searchFollowerAndFollowing(
          follower.user.id,
          follower.restContext,
          followed.user.id,
          followed.restContext,
          (followerUserDoc, followedUserDoc) => {
            assert.ok(followerUserDoc);
            assert.ok(followedUserDoc);

            // Delete the search index
            SearchTestsUtil.deleteAll(() => {
              // Ensure the following relationship can no longer be found when searching them
              FollowingTestsUtil.searchFollowerAndFollowing(
                follower.user.id,
                follower.restContext,
                followed.user.id,
                followed.restContext,
                (followerUserDoc, followedUserDoc) => {
                  assert.ok(!followerUserDoc);
                  assert.ok(!followedUserDoc);

                  // Reindex all resources
                  SearchTestsUtil.reindexAll(TestsUtil.createGlobalAdminRestContext(), () => {
                    // Ensure the follower and following search index are searchable again
                    FollowingTestsUtil.searchFollowerAndFollowing(
                      follower.user.id,
                      follower.restContext,
                      followed.user.id,
                      followed.restContext,
                      (followerUserDoc, followedUserDoc) => {
                        assert.ok(followerUserDoc);
                        assert.ok(followedUserDoc);

                        return callback();
                      }
                    );
                  });
                }
              );
            });
          }
        );
      });
    });
  });
});
