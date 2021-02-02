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

import { assert } from 'chai';
import { describe, before, it } from 'mocha';

import * as ConfigTestsUtil from 'oae-config/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests/lib/util';
import * as FollowingTestsUtil from 'oae-following/lib/test/util';
import { drop, map, path } from 'ramda';

describe('Following', () => {
  let globalAdminOnTenantRestContext = null;
  let camAnonymousRestContext = null;
  let camAdminRestContext = null;
  let gtAdminRestContext = null;

  /**
   * Function that will fill up the anonymous and admin REST context
   */
  before((callback) => {
    camAnonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);

    // Authenticate the global admin into a tenant so we can perform user-tenant requests with a global admin to test their access
    RestAPI.Admin.loginOnTenant(TestsUtil.createGlobalAdminRestContext(), 'localhost', null, (error, ctx) => {
      assert.notExists(error);
      globalAdminOnTenantRestContext = ctx;
      return callback();
    });
  });

  /*!
   * Ensure that the given feeds have the same users (by id) and in the same order
   *
   * @param  {User[]}     oneFeedUsers    One feed of users to compare with
   * @param  {User[]}     otherFeedUsers  The other feed of users to compare with
   */
  const _assertFeedsEqual = function (oneFeedUsers, otherFeedUsers) {
    assert.ok(oneFeedUsers);
    assert.ok(otherFeedUsers);
    assert.strictEqual(oneFeedUsers.length, otherFeedUsers.length);
    for (const each of oneFeedUsers) {
      assert.ok(each.id);
      assert.strictEqual(each.id, each.id);
    }
  };

  /**
   * Verify we get an "empty" response when there are no users in the followers or following list
   */
  it('verify with no followers or following', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, testUsers) => {
      assert.notExists(error);

      const { 0: user } = testUsers;

      // Verify clean empty response
      RestAPI.Following.getFollowers(user.restContext, user.user.id, null, null, (error, response) => {
        assert.notExists(error);
        assert.ok(response);
        assert.ok(response.results);
        assert.strictEqual(response.results.length, 0);
        assert.ok(!response.nextToken);

        // Verify clean empty response again
        RestAPI.Following.getFollowing(user.restContext, user.user.id, null, null, (error, response) => {
          assert.notExists(error);
          assert.ok(response);
          assert.ok(response.results);
          assert.strictEqual(response.results.length, 0);
          assert.ok(!response.nextToken);
          return callback();
        });
      });
    });
  });

  /**
   * Test that verifies following a user results in both the follower and following lists getting updated
   */
  it('verify following and unfollowing', (callback) => {
    // Create 2 users, one following the other
    FollowingTestsUtil.createFollowerAndFollowed(camAdminRestContext, (follower, followed) => {
      // Ensure the follower and following feeds indicate they are indeed following
      FollowingTestsUtil.assertFollows(
        follower.user.id,
        follower.restContext,
        followed.user.id,
        followed.restContext,
        () => {
          // Unfollow the user and verify that they are no longer in the following and followers lists
          RestAPI.Following.unfollow(follower.restContext, followed.user.id, (error) => {
            assert.notExists(error);

            // Ensure the follower and following feeds indicate they are no longer following
            FollowingTestsUtil.assertDoesNotFollow(
              follower.user.id,
              follower.restContext,
              followed.user.id,
              followed.restContext,
              callback
            );
          });
        }
      );
    });
  });

  /**
   * Test that verifies the privacy rules on follow lists (followers and following)
   */
  it('verify following list privacy', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 4, (error, testUsers) => {
      assert.notExists(error);
      const { 0: privateUser, 1: loggedinUser, 2: publicUser, 3: bert } = testUsers;

      RestAPI.User.updateUser(privateUser.restContext, privateUser.user.id, { visibility: 'private' }, (error_) => {
        assert.notExists(error_);

        RestAPI.User.updateUser(
          loggedinUser.restContext,
          loggedinUser.user.id,
          { visibility: 'loggedin' },
          (error_) => {
            assert.notExists(error_);

            // Verify anonymous can only see public user feeds
            FollowingTestsUtil.assertNoFollowFeedAccess(
              camAnonymousRestContext,
              [privateUser.user.id, loggedinUser.user.id],
              401,
              () => {
                FollowingTestsUtil.assertHasFollowFeedAccess(camAnonymousRestContext, [publicUser.user.id], () => {
                  // Verify gt admin can only see public user feeds
                  FollowingTestsUtil.assertNoFollowFeedAccess(
                    gtAdminRestContext,
                    [privateUser.user.id, loggedinUser.user.id],
                    401,
                    () => {
                      FollowingTestsUtil.assertHasFollowFeedAccess(gtAdminRestContext, [publicUser.user.id], () => {
                        // Verify bert can see only public and loggedin user feeds
                        FollowingTestsUtil.assertNoFollowFeedAccess(
                          bert.restContext,
                          [privateUser.user.id],
                          401,
                          () => {
                            FollowingTestsUtil.assertHasFollowFeedAccess(
                              bert.restContext,
                              [publicUser.user.id, loggedinUser.user.id],
                              () => {
                                // Verify private user can see all feeds
                                FollowingTestsUtil.assertHasFollowFeedAccess(
                                  privateUser.restContext,
                                  [publicUser.user.id, loggedinUser.user.id, privateUser.user.id],
                                  () => {
                                    // Verify cam admin can see all feeds
                                    FollowingTestsUtil.assertHasFollowFeedAccess(
                                      camAdminRestContext,
                                      [publicUser.user.id, loggedinUser.user.id, privateUser.user.id],
                                      () => {
                                        // Verify global admin can see all feeds
                                        FollowingTestsUtil.assertHasFollowFeedAccess(
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
   * Test that verifies validation of the get followers feed
   */
  it('verify get followers validation', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, testUsers) => {
      assert.notExists(error);

      const { 0: bert } = testUsers;

      // Verify a non-valid id
      RestAPI.Following.getFollowers(bert.restContext, 'not-a-valid-id', null, null, (error /* , response */) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);

        // Verify a resource id that is not a user
        RestAPI.Following.getFollowers(bert.restContext, 'g:not-a:user-id', null, null, (error /* , response */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);

          // Verify a non-existing user
          RestAPI.Following.getFollowers(bert.restContext, 'u:cam:nonExistentUserId', null, null, (
            error /* , response */
          ) => {
            assert.ok(error);
            assert.strictEqual(error.code, 404);

            // Sanity check a valid fetch
            RestAPI.Following.getFollowers(bert.restContext, bert.user.id, null, null, (error, response) => {
              assert.notExists(error);
              assert.ok(response);
              return callback();
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies validation of the get following feed
   */
  it('verify get following validation', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, testUsers) => {
      assert.notExists(error);

      const { 0: bert } = testUsers;

      // Verify a non-valid id
      RestAPI.Following.getFollowing(bert.restContext, 'not-a-valid-id', null, null, (error /* , response */) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);

        // Verify a resource id that is not a user
        RestAPI.Following.getFollowing(bert.restContext, 'g:not-a:user-id', null, null, (error /* , response */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);

          // Verify a non-existing user
          RestAPI.Following.getFollowing(bert.restContext, 'u:cam:nonExistentUserId', null, null, (
            error /* , response */
          ) => {
            assert.ok(error);
            assert.strictEqual(error.code, 404);

            // Sanity check a valid fetch
            RestAPI.Following.getFollowing(bert.restContext, bert.user.id, null, null, (error, response) => {
              assert.notExists(error);
              assert.ok(response);
              return callback();
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies validation of the follow action
   */
  it('verify follow validation', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, testUsers) => {
      assert.notExists(error);

      const { 0: bert, 1: simon } = testUsers;

      // Verify a non-valid id
      RestAPI.Following.follow(bert.restContext, 'not-a-valid-id', (error_) => {
        assert.ok(error_);
        assert.strictEqual(error_.code, 400);

        // Verify a resource id that is not a user
        RestAPI.Following.follow(bert.restContext, 'g:not-a:user-id', (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, 400);

          // Verify a non-existing user
          RestAPI.Following.follow(bert.restContext, 'u:cam:nonExistentUserId', (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 404);

            // Ensure no following took place
            RestAPI.Following.getFollowing(bert.restContext, bert.user.id, null, null, (error, response) => {
              assert.notExists(error);
              assert.ok(response);
              assert.ok(response.results);
              assert.strictEqual(response.results.length, 0);

              // Sanity check inputs
              RestAPI.Following.follow(bert.restContext, simon.user.id, (error_) => {
                assert.notExists(error_);
                return callback();
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies the authorization of the follow action
   */
  it('verify follow authorization', (callback) => {
    TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0) => {
      // Ensure a user cannot follow themself
      RestAPI.Following.follow(publicTenant0.publicUser.restContext, publicTenant0.publicUser.user.id, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);

        // Ensure a user cannot follow a public user from an external private tenant
        RestAPI.Following.follow(publicTenant0.publicUser.restContext, privateTenant0.publicUser.user.id, (error) => {
          assert.ok(error);
          assert.strictEqual(error.code, 401);

          // Ensure a user cannot follow a loggedin user from an external public tenant
          RestAPI.Following.follow(
            publicTenant0.publicUser.restContext,
            publicTenant1.loggedinUser.user.id,
            (error) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);

              // Ensure a user cannot follow a private user from an external public tenant
              RestAPI.Following.follow(
                publicTenant0.publicUser.restContext,
                publicTenant1.privateUser.user.id,
                (error) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 401);

                  // Verify that the publicTenant0 public user is still not following anyone
                  RestAPI.Following.getFollowing(
                    publicTenant0.publicUser.restContext,
                    publicTenant0.publicUser.user.id,
                    null,
                    null,
                    (error, response) => {
                      assert.notExists(error);
                      assert.ok(response);
                      assert.ok(response.results);
                      assert.strictEqual(response.results.length, 0);

                      // Sanity check can follow public user from external public tenant
                      RestAPI.Following.follow(
                        publicTenant0.publicUser.restContext,
                        publicTenant1.publicUser.user.id,
                        (error_) => {
                          assert.notExists(error_);
                          return FollowingTestsUtil.assertFollows(
                            publicTenant0.publicUser.user.id,
                            publicTenant0.publicUser.restContext,
                            publicTenant1.publicUser.user.id,
                            publicTenant1.publicUser.restContext,
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
      });
    });
  });

  /**
   * Test that verifies the authorization of the unfollow action
   */
  it('verify unfollow authorization', (callback) => {
    TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1 /* , privateTenant0 */) => {
      // Perform a follow from publicTenant0 to publicTenant1
      RestAPI.Following.follow(publicTenant0.publicUser.restContext, publicTenant1.publicUser.user.id, (error) => {
        assert.notExists(error);

        // Now make publicTenant1 private
        ConfigTestsUtil.updateConfigAndWait(
          TestsUtil.createGlobalAdminRestContext(),
          publicTenant1.tenant.alias,
          { 'oae-tenants/tenantprivacy/tenantprivate': true },
          (error) => {
            assert.notExists(error);

            // Now make sure we can unfollow the user in the newly private tenant
            RestAPI.Following.unfollow(
              publicTenant0.publicUser.restContext,
              publicTenant1.publicUser.user.id,
              (error) => {
                assert.notExists(error);

                // Ensure that the following user is not following anyone anymore
                RestAPI.Following.getFollowing(
                  publicTenant0.publicUser.restContext,
                  publicTenant0.publicUser.user.id,
                  null,
                  null,
                  (error, response) => {
                    assert.notExists(error);
                    assert.ok(response);
                    assert.ok(response.results);
                    assert.strictEqual(response.results.length, 0);
                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });
  });

  /**
   * Test that verifies validation of the follow action
   */
  it('verify unfollow validation', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, testUsers) => {
      assert.notExists(error);

      const { 0: bert, 1: simon } = testUsers;

      // Verify anonymous cannot unfollow anyone
      RestAPI.Following.unfollow(camAnonymousRestContext, simon.user.id, (error_) => {
        assert.ok(error_);
        assert.strictEqual(error_.code, 401);

        // Verify a non-valid id
        RestAPI.Following.unfollow(bert.restContext, 'not-a-valid-id', (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, 400);

          // Verify a resource id that is not a user
          RestAPI.Following.unfollow(bert.restContext, 'g:not-a:user-id', (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 400);

            // Sanity check inputs
            RestAPI.Following.unfollow(bert.restContext, simon.user.id, (error_) => {
              assert.notExists(error_);
              return callback();
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies paging of the following feed
   */
  it('verify paging of the following feed', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 10, (error, testUsers) => {
      assert.notExists(error);

      const { 0: follower } = testUsers;
      testUsers = drop(1, testUsers);
      const followingUserIds = map(path(['user', 'id']), testUsers);

      // Make the follower follow all the 9 following users
      FollowingTestsUtil.followAll(follower.restContext, followingUserIds, () => {
        // Get the natural following order
        RestAPI.Following.getFollowing(follower.restContext, follower.user.id, null, 9, (error, response) => {
          assert.notExists(error);
          assert.strictEqual(response.results.length, 9);

          const followingUsers = response.results;

          // Get the first 2, ensure we were restricted by the limit
          RestAPI.Following.getFollowing(follower.restContext, follower.user.id, null, 2, (error, response) => {
            assert.notExists(error);
            _assertFeedsEqual(response.results, followingUsers.slice(0, 2));

            // Get the next 2, ensure it is the next 2-item-slice of the following array
            RestAPI.Following.getFollowing(
              follower.restContext,
              follower.user.id,
              response.nextToken,
              2,
              (error, response) => {
                assert.notExists(error);
                _assertFeedsEqual(response.results, followingUsers.slice(2, 4));

                // Now overflow the list
                RestAPI.Following.getFollowing(
                  follower.restContext,
                  follower.user.id,
                  response.nextToken,
                  8,
                  (error, response) => {
                    assert.notExists(error);
                    assert.ok(!response.nextToken);
                    _assertFeedsEqual(response.results, followingUsers.slice(4));
                    return callback();
                  }
                );
              }
            );
          });
        });
      });
    });
  });

  /**
   * Test that verifies paging of the followers feed
   */
  it('verify paging of the followers feed', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 10, (error, followers) => {
      assert.notExists(error);

      const { 0: followed } = followers;
      followers = drop(1, followers);

      // Make the follower follow all the 9 following users
      FollowingTestsUtil.followByAll(followed.user.id, followers, () => {
        // Get the natural following order
        RestAPI.Following.getFollowers(followed.restContext, followed.user.id, null, 9, (error, response) => {
          assert.notExists(error);
          assert.strictEqual(response.results.length, 9);

          const followerUsers = response.results;

          // Get the first 2, ensure we were restricted by the limit
          RestAPI.Following.getFollowers(followed.restContext, followed.user.id, null, 2, (error, response) => {
            assert.notExists(error);
            _assertFeedsEqual(response.results, followerUsers.slice(0, 2));

            // Get the next 2, ensure it is the next 2-item-slice of the following array
            RestAPI.Following.getFollowers(
              followed.restContext,
              followed.user.id,
              response.nextToken,
              2,
              (error, response) => {
                assert.notExists(error);
                _assertFeedsEqual(response.results, followerUsers.slice(2, 4));

                // Now overflow the list
                RestAPI.Following.getFollowers(
                  followed.restContext,
                  followed.user.id,
                  response.nextToken,
                  8,
                  (error, response) => {
                    assert.notExists(error);
                    assert.ok(!response.nextToken);
                    _assertFeedsEqual(response.results, followerUsers.slice(4));
                    return callback();
                  }
                );
              }
            );
          });
        });
      });
    });
  });
});
