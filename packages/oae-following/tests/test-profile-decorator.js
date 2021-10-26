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

import * as ConfigTestsUtil from 'oae-config/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests/lib/util.js';
import * as FollowingTestsUtil from 'oae-following/lib/test/util.js';

describe('Following Profile Decorator', () => {
  /**
   * Test that ensures the proper result of the following decorator among all cross-tenant visibility cases
   */
  it('verify following decorator for different visibility scenarios', (callback) => {
    TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0) => {
      // Ensure anonymous doesn't see a following property
      RestAPI.User.getUser(publicTenant0.anonymousRestContext, publicTenant0.publicUser.user.id, (error, user) => {
        assert.ok(!error);
        assert.ok(!user.following);

        // Ensure a user doesn't see a following property on their own profile
        RestAPI.User.getUser(publicTenant0.publicUser.restContext, publicTenant0.publicUser.user.id, (error, user) => {
          assert.ok(!error);
          assert.ok(!user.following);

          // Ensure user profile reports a user can follow a user from their tenant
          RestAPI.User.getUser(
            publicTenant0.publicUser.restContext,
            publicTenant0.loggedinUser.user.id,
            (error, user) => {
              assert.ok(!error);
              assert.ok(user.following);
              assert.strictEqual(user.following.canFollow, true);
              assert.strictEqual(user.following.isFollowing, false);

              // Ensure user profile reports a user can follow a public user from an external public tenant
              RestAPI.User.getUser(
                publicTenant0.publicUser.restContext,
                publicTenant1.publicUser.user.id,
                (error, user) => {
                  assert.ok(!error);
                  assert.ok(user.following);
                  assert.strictEqual(user.following.canFollow, true);
                  assert.strictEqual(user.following.isFollowing, false);

                  // Ensure user profile reports a user cannot follow a public user from an external private tenant
                  RestAPI.User.getUser(
                    publicTenant0.publicUser.restContext,
                    privateTenant0.publicUser.user.id,
                    (error, user) => {
                      assert.ok(!error);
                      assert.ok(user.following);
                      assert.strictEqual(user.following.canFollow, false);
                      assert.strictEqual(user.following.isFollowing, false);

                      // Make privateTenant0 public so we can do a cross-tenant follow
                      ConfigTestsUtil.updateConfigAndWait(
                        TestsUtil.createGlobalAdminRestContext(),
                        privateTenant0.tenant.alias,
                        { 'oae-tenants/tenantprivacy/tenantprivate': false },
                        (error_) => {
                          assert.ok(!error_);

                          const followedIds = [
                            publicTenant0.loggedinUser.user.id,
                            publicTenant1.publicUser.user.id,
                            privateTenant0.publicUser.user.id
                          ];

                          // Follow the test subject users
                          FollowingTestsUtil.followAll(publicTenant0.publicUser.restContext, followedIds, () => {
                            // Make the tenant private again
                            ConfigTestsUtil.updateConfigAndWait(
                              TestsUtil.createGlobalAdminRestContext(),
                              privateTenant0.tenant.alias,
                              { 'oae-tenants/tenantprivacy/tenantprivate': true },
                              (error_) => {
                                assert.ok(!error_);

                                // Ensure user profile now reports that they are followed, and can no longer be followed
                                RestAPI.User.getUser(
                                  publicTenant0.publicUser.restContext,
                                  publicTenant0.loggedinUser.user.id,
                                  (error, user) => {
                                    assert.ok(!error);
                                    assert.ok(user.following);
                                    assert.strictEqual(user.following.canFollow, false);
                                    assert.strictEqual(user.following.isFollowing, true);

                                    // Ensure user profile now reports that they are followed, and can no longer be followed
                                    RestAPI.User.getUser(
                                      publicTenant0.publicUser.restContext,
                                      publicTenant1.publicUser.user.id,
                                      (error, user) => {
                                        assert.ok(!error);
                                        assert.ok(user.following);
                                        assert.strictEqual(user.following.canFollow, false);
                                        assert.strictEqual(user.following.isFollowing, true);

                                        // Ensure user profile now reports the user from the private tenant is being followed, and still cannot be followed
                                        RestAPI.User.getUser(
                                          publicTenant0.publicUser.restContext,
                                          privateTenant0.publicUser.user.id,
                                          (error, user) => {
                                            assert.ok(!error);
                                            assert.ok(user.following);
                                            assert.strictEqual(user.following.canFollow, false);
                                            assert.strictEqual(user.following.isFollowing, true);
                                            return callback();
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
});
