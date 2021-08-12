/*
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

import * as Cassandra from 'oae-util/lib/cassandra.js';
import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import { Context } from 'oae-context';
import PrincipalsAPI from 'oae-principals';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

import * as AuthenticationAPI from 'oae-authentication';
import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationTestUtil from 'oae-authentication/lib/test/util.js';
import { LoginId } from 'oae-authentication/lib/model.js';

describe('Authentication', () => {
  // Rest context that can be used for anonymous requests on the cambridge tenant
  let asCambridgeAnonymousUser = null;
  // Rest context that can be used for anonymous requests on the georgia tech tenant
  let asGeorgiaAnonymousUser = null;
  // Rest context that can be used for anonymous requests on the global admin tenant
  let asAnonymousOnAdminTenant = null;
  // Rest context that can be used every time we need to make a request as a tenant admin
  let asCambridgeTenantAdmin = null;
  // Rest context that can be used every time we need to make a request as a global admin
  let asGlobalAdmin = null;

  /**
   * Function that will fill up the tenant admin and anonymous rest context
   */
  before((callback) => {
    // Prepare the contexts with which we'll perform requests
    asCambridgeAnonymousUser = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    asGeorgiaAnonymousUser = TestsUtil.createTenantRestContext(global.oaeTests.tenants.gt.host);
    asAnonymousOnAdminTenant = TestsUtil.createGlobalRestContext();
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(
      global.oaeTests.tenants.cam.host
    );
    asGlobalAdmin = TestsUtil.createGlobalAdminRestContext();

    return callback();
  });

  /**
   * Ensure that all tests will start with local authentication enabled, even if tests that disable it fail
   */
  afterEach((callback) => {
    return AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
      asCambridgeTenantAdmin,
      null,
      { 'oae-authentication/local/enabled': true },
      callback
    );
  });

  describe('Local authentication', () => {
    /**
     * Test that verifies that users can log into the system using a local authorization strategy
     */
    it('verify local authentication', (callback) => {
      // Create a test user
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        // Log the user out first, to make sure that the cookie jar for the user is empty
        RestAPI.Authentication.logout(user.restContext, (error, body, response) => {
          assert.notExists(error);
          assert.strictEqual(response.statusCode, 302);
          assert.strictEqual(response.headers.location, '/');

          // Login without a user id
          RestAPI.Authentication.login(user.restContext, null, 'password', (error_) => {
            assert.ok(error_);

            // Log in with the wrong password
            RestAPI.Authentication.login(
              user.restContext,
              user.restContext.username,
              'wrong-password',
              (error_) => {
                assert.ok(error_);

                // Log in with the correct password
                RestAPI.Authentication.login(
                  user.restContext,
                  user.restContext.username,
                  'password',
                  (error_) => {
                    assert.notExists(error_);

                    // Verify that we are actually logged in
                    RestAPI.User.getMe(user.restContext, (error, meObject) => {
                      assert.notExists(error);
                      assert.ok(meObject);
                      assert.strictEqual(meObject.id, user.user.id);

                      // Logout
                      RestAPI.Authentication.logout(user.restContext, (error, body, response) => {
                        assert.notExists(error);
                        assert.strictEqual(response.statusCode, 302);
                        assert.strictEqual(response.headers.location, '/');

                        // Verify that we are now logged out
                        RestAPI.User.getMe(user.restContext, (error, meObject) => {
                          assert.notExists(error);
                          assert.ok(meObject);
                          assert.strictEqual(meObject.anon, true);
                          return callback();
                        });
                      });
                    });
                  }
                );
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies that an account can't be created with an existing id
     */
    it('verify account creation locking', (callback) => {
      let error1;
      let error2;
      let count = 0;

      /*!
       * Callback for the create user requests
       */
      const checkComplete = function () {
        count++;
        // Make sure both calls to createUser have returned
        if (count === 2) {
          // Make sure at most one call errored
          if (error1 && error2) {
            assert.fail('Expected only one create user call to fail');
          }

          // Make sure at least one call errored
          const error = error1 || error2;
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      };

      // Create a test user
      const userId = TestsUtil.generateTestUserId();
      const email1 = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );
      const email2 = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );
      RestAPI.User.createUser(
        asCambridgeTenantAdmin,
        userId,
        'password',
        'Test User',
        email1,
        {},
        (error /* , createdUser */) => {
          error1 = error;
          checkComplete();
        }
      );
      RestAPI.User.createUser(
        asCambridgeTenantAdmin,
        userId,
        'password',
        'Test User',
        email2,
        {},
        (error /* , createdUser */) => {
          error2 = error;
          checkComplete();
        }
      );
    });

    /**
     * Test that verifies that logging in with a non-existing user doesn't work
     */
    it('verify failed authentication', (callback) => {
      // Try to log in as an invalid user
      RestAPI.Authentication.login(
        asCambridgeAnonymousUser,
        'invalid-user',
        'password',
        (error) => {
          assert.ok(error);
          assert.strictEqual(error.code, 401);

          // Try to log in as a non-existing user
          RestAPI.Authentication.login(
            asCambridgeAnonymousUser,
            'u:cam:non-existing-user',
            'password',
            (error) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);
              return callback();
            }
          );
        }
      );
    });

    /**
     * Test that verifies that logging in is properly separated by tenant
     */
    it('verify tenant login separation', (callback) => {
      // Create a test user
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        // Verify that we cannot login on tenant B
        const anonymousGtRestContext = TestsUtil.createTenantRestContext(
          global.oaeTests.tenants.gt.host
        );
        RestAPI.Authentication.login(
          anonymousGtRestContext,
          user.restContext.username,
          'password',
          (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 401);

            // Verify that we can login on tenant A
            const anonymousCamRestContext = TestsUtil.createTenantRestContext(
              global.oaeTests.tenants.cam.host
            );
            RestAPI.Authentication.login(
              anonymousCamRestContext,
              user.restContext.username,
              'password',
              (error_) => {
                assert.notExists(error_);
                return callback();
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that when local authentication is disabled for a tenant, it is not possible to
     * login with local authentication
     */
    it('verify disable local authentication', (callback) => {
      // Create a user and associated anonymous context they we'll use to verify local login
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: jack } = users;

        // Sanity check login with the rest context
        RestAPI.User.getMe(jack.restContext, (error, me) => {
          assert.notExists(error);
          assert.strictEqual(me.id, jack.user.id);

          // Log it out and sanity check we're anonymous again
          RestAPI.Authentication.logout(jack.restContext, (error, body, response) => {
            assert.notExists(error);
            assert.strictEqual(response.statusCode, 302);
            assert.strictEqual(response.headers.location, '/');

            RestAPI.User.getMe(jack.restContext, (error, me) => {
              assert.notExists(error);
              assert.strictEqual(me.anon, true);

              // Disable local authentication for the 'camtest' tenant
              ConfigTestUtil.updateConfigAndWait(
                asCambridgeTenantAdmin,
                null,
                { 'oae-authentication/local/enabled': false },
                (error_) => {
                  assert.notExists(error_);
                }
              );

              // Wait for the strategies to be refreshed then continue
              AuthenticationAPI.emitter.once(
                AuthenticationConstants.events.REFRESHED_STRATEGIES,
                (/* tenant */) => {
                  // Verify local authentication fails
                  RestAPI.Authentication.login(
                    jack.restContext,
                    jack.restContext.username,
                    'password',
                    (error, body, response) => {
                      assert.notExists(error);
                      assert.strictEqual(response.statusCode, 302);
                      assert.strictEqual(response.headers.location, '/?authentication=disabled');

                      // Ensure the user is still anonymous
                      RestAPI.User.getMe(jack.restContext, (error, me) => {
                        assert.notExists(error);
                        assert.strictEqual(me.anon, true);

                        // Re-enable local authentication
                        ConfigTestUtil.updateConfigAndWait(
                          asCambridgeTenantAdmin,
                          null,
                          { 'oae-authentication/local/enabled': true },
                          (error_) => {
                            assert.notExists(error_);
                          }
                        );

                        // Wait for the strategies to be refreshed then continue
                        AuthenticationAPI.emitter.once(
                          AuthenticationConstants.events.REFRESHED_STRATEGIES,
                          (/* tenant */) => {
                            // Verify authentication succeeds now
                            RestAPI.Authentication.login(
                              jack.restContext,
                              jack.restContext.username,
                              'password',
                              (error_) => {
                                assert.notExists(error_);

                                RestAPI.User.getMe(jack.restContext, (error, me) => {
                                  assert.notExists(error);
                                  assert.strictEqual(me.id, jack.user.id);
                                  return callback();
                                });
                              }
                            );
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
      });
    });

    /**
     * Test that verifies that you need to be logged in to be able to log out
     */
    it('verify you need to be logged in to be able to log out', (callback) => {
      RestAPI.Authentication.logout(asCambridgeAnonymousUser, (error /* , body, response */) => {
        assert.strictEqual(error.code, 400);

        // Create a user
        TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: user } = users;

          // Make a request to the home page. RestUtil will log the user in on-the-fly
          RestAPI.User.getMe(user.restContext, (error, me) => {
            assert.notExists(error);
            assert.ok(!me.anon);

            // Sanity-check we can still log out
            RestAPI.Authentication.logout(user.restContext, (error /* , body, response */) => {
              assert.notExists(error);
              RestAPI.User.getMe(user.restContext, (error, me) => {
                assert.notExists(error);
                assert.ok(me.anon);

                return callback();
              });
            });
          });
        });
      });
    });
  });

  describe('Admin login', () => {
    /**
     * Test that verifies that a global administrator can successfully login on the global admin tenant
     */
    it('verify global administrator authentication', (callback) => {
      // Get the me feed, this should log in the global admin as well
      RestAPI.User.getMe(asGlobalAdmin, (error, meObject) => {
        assert.notExists(error);
        assert.ok(meObject);
        assert.strictEqual(meObject.isGlobalAdmin, true);

        // Logout
        RestAPI.Authentication.logout(asGlobalAdmin, (error, body, response) => {
          assert.notExists(error);
          assert.strictEqual(response.statusCode, 302);
          assert.strictEqual(response.headers.location, '/');

          // Verify that the global admin has been logged out
          RestAPI.User.getMe(asGlobalAdmin, (error, meObject) => {
            assert.notExists(error);
            assert.ok(meObject);
            assert.strictEqual(meObject.anon, true);

            // Log the global admin back in so the cookie jar can be restored
            RestAPI.Authentication.login(
              asGlobalAdmin,
              asGlobalAdmin.username,
              asGlobalAdmin.userPassword,
              (error_) => {
                assert.notExists(error_);
                return callback();
              }
            );
          });
        });
      });
    });
  });

  describe('User password', () => {
    /**
     * Test that verifies that it should be possible to change a user's password
     */
    it('verify change password', (callback) => {
      // Create a test user
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: userA, 1: userB } = users;

        // Try changing the password with a wrong old password
        RestAPI.Authentication.changePassword(
          userA.restContext,
          userA.user.id,
          'wrong-password',
          'totally-new-password',
          (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 401);

            // Try changing the password with the correct old password
            RestAPI.Authentication.changePassword(
              userA.restContext,
              userA.user.id,
              'password',
              'totally-new-password',
              (error_) => {
                assert.notExists(error_);
                userA.restContext.userPassword = 'totally-new-password';

                // Try changing someone else's password
                RestAPI.Authentication.changePassword(
                  userA.restContext,
                  userB.user.id,
                  'password',
                  'totally-new-password',
                  (error_) => {
                    assert.ok(error_);
                    assert.strictEqual(error_.code, 401);

                    // Try logging in with the wrong password
                    RestAPI.Authentication.login(
                      asCambridgeAnonymousUser,
                      userA.restContext.username,
                      'password',
                      (error_) => {
                        assert.ok(error_);
                        assert.strictEqual(error_.code, 401);

                        // Try logging in with the wrong password
                        const anonymousRestContext = TestsUtil.createTenantRestContext(
                          global.oaeTests.tenants.cam.host
                        );
                        RestAPI.Authentication.login(
                          anonymousRestContext,
                          userA.restContext.username,
                          'password',
                          (error_) => {
                            assert.ok(error_);
                            assert.strictEqual(error_.code, 401);

                            // Try logging in with the new password
                            RestAPI.Authentication.login(
                              anonymousRestContext,
                              userA.restContext.username,
                              'totally-new-password',
                              (error_) => {
                                assert.notExists(error_);
                                return callback();
                              }
                            );
                          }
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

    /**
     * Test that verifies that an admin user can change a user's password
     */
    it('verify admin change password', (callback) => {
      // Create a test user
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        // Try to change the password as the anonymous user
        RestAPI.Authentication.changePassword(
          asCambridgeAnonymousUser,
          user.user.id,
          'password',
          'totally-new-password',
          (error_) => {
            assert.ok(error_);

            // Try to change the password as the tenant admin
            RestAPI.Authentication.changePassword(
              asCambridgeTenantAdmin,
              user.user.id,
              'password',
              'totally-new-password',
              (error_) => {
                assert.notExists(error_);

                // Make a broken password change request as admin
                RestAPI.Authentication.changePassword(
                  asCambridgeTenantAdmin,
                  'notARealUserID',
                  'password',
                  'totally-new-password',
                  (error_) => {
                    assert.ok(error_);
                    assert.strictEqual(error_.code, 400);

                    // Try changing passwords for a user with no local strategy
                    const twitterTestUserId = TestsUtil.generateTestUserId();
                    const email = TestsUtil.generateTestEmailAddress(
                      null,
                      global.oaeTests.tenants.cam.emailDomains[0]
                    );
                    const ctx = new Context(global.oaeTests.tenants.cam);
                    const loginId = new LoginId(
                      ctx.tenant().alias,
                      AuthenticationConstants.providers.TWITTER,
                      twitterTestUserId
                    );
                    AuthenticationAPI.createUser(
                      ctx,
                      loginId,
                      'Twitter User',
                      { email },
                      (error, userObject) => {
                        assert.notExists(error);
                        assert.ok(userObject);

                        RestAPI.Authentication.changePassword(
                          asCambridgeTenantAdmin,
                          userObject.id,
                          'password',
                          'totally-new-password',
                          (error_) => {
                            assert.ok(error_);
                            assert.strictEqual(error_.code, 400);

                            return callback();
                          }
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

    /**
     * Test that verifies that a global administrator can change his password
     */
    it('verify change global administrator password', (callback) => {
      const previousPassword = asGlobalAdmin.userPassword;
      const newPassword = previousPassword + '1';

      // Get the admin user id
      RestAPI.User.getMe(asGlobalAdmin, (error, me) => {
        assert.notExists(error);
        const userId = me.id;

        // Set their password to something different
        RestAPI.Authentication.changePassword(
          asGlobalAdmin,
          userId,
          previousPassword,
          newPassword,
          (error_) => {
            assert.notExists(error_);

            // Logout and verify they can log in with the new password
            RestAPI.Authentication.logout(asGlobalAdmin, (error, body, response) => {
              assert.notExists(error);
              assert.strictEqual(response.statusCode, 302);
              assert.strictEqual(response.headers.location, '/');

              RestAPI.User.getMe(asGlobalAdmin, (error, me) => {
                assert.notExists(error);
                assert.strictEqual(me.anon, true);
                asGlobalAdmin.userPassword = newPassword;

                RestAPI.Authentication.login(
                  asGlobalAdmin,
                  asGlobalAdmin.username,
                  asGlobalAdmin.userPassword,
                  (error_) => {
                    assert.notExists(error_);

                    // Verify they indeed logged in successfully
                    RestAPI.User.getMe(asGlobalAdmin, (error, me) => {
                      assert.notExists(error);
                      assert.strictEqual(me.id, userId);

                      // Change the password back to avoid messing up following tests
                      RestAPI.Authentication.changePassword(
                        asGlobalAdmin,
                        userId,
                        newPassword,
                        previousPassword,
                        (error) => {
                          assert.notExists(error);

                          // Make a broken password change request as global admin
                          RestAPI.Authentication.changePassword(
                            asGlobalAdmin,
                            'notARealUserID',
                            'password',
                            'new-pass',
                            (error) => {
                              assert.ok(error);
                              assert.strictEqual(error.code, 400);

                              return callback();
                            }
                          );
                        }
                      );
                    });
                  }
                );
              });
            });
          }
        );
      });
    });
  });

  describe('Login id exists', () => {
    /**
     * Test that verifies that we can check whether or not a username is already being used on a tenant
     */
    it('verify username exists', (callback) => {
      let username = TestsUtil.generateTestUserId();

      // Verify that the username doesn't exist yet
      RestAPI.Authentication.exists(asCambridgeAnonymousUser, username, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 404);

        // Create a user with this login id
        const email = TestsUtil.generateTestEmailAddress(
          null,
          global.oaeTests.tenants.cam.emailDomains[0]
        );
        RestAPI.User.createUser(
          asCambridgeTenantAdmin,
          username,
          'password',
          'Test User',
          email,
          {},
          (error, createdUser) => {
            assert.notExists(error);
            assert.ok(createdUser);

            // Verify that the username exists
            RestAPI.Authentication.exists(asCambridgeAnonymousUser, username, (error_) => {
              assert.notExists(error_);

              // Verify that the username exists, even if we change the text case
              RestAPI.Authentication.exists(
                asCambridgeAnonymousUser,
                username.toLowerCase(),
                (error_) => {
                  assert.notExists(error_);
                  RestAPI.Authentication.exists(
                    asCambridgeAnonymousUser,
                    username.toUpperCase(),
                    (error_) => {
                      assert.notExists(error_);

                      // Verify that the username is still available on different tenants
                      RestAPI.Authentication.exists(asGeorgiaAnonymousUser, username, (error_) => {
                        assert.ok(error_);
                        assert.strictEqual(error_.code, 404);

                        // Go through the same steps for creating users through the global admin tenant
                        username = TestsUtil.generateTestUserId();

                        // Verify that the username doesn't exist yet
                        RestAPI.Authentication.existsOnTenant(
                          asGlobalAdmin,
                          global.oaeTests.tenants.cam.alias,
                          username,
                          (error_) => {
                            assert.ok(error_);
                            assert.strictEqual(error_.code, 404);

                            // Create a user with this login id
                            const email = TestsUtil.generateTestEmailAddress(
                              null,
                              global.oaeTests.tenants.cam.emailDomains[0]
                            );
                            RestAPI.User.createUserOnTenant(
                              asGlobalAdmin,
                              global.oaeTests.tenants.cam.alias,
                              username,
                              'password',
                              'Test User',
                              email,
                              { visibility: 'public' },
                              (error, createdUser) => {
                                assert.notExists(error);
                                assert.ok(createdUser);

                                // Verify that the username exists
                                RestAPI.Authentication.existsOnTenant(
                                  asGlobalAdmin,
                                  global.oaeTests.tenants.cam.alias,
                                  username,
                                  (error_) => {
                                    assert.notExists(error_);

                                    // Verify that the username exists, even if we change the text case
                                    RestAPI.Authentication.existsOnTenant(
                                      asGlobalAdmin,
                                      global.oaeTests.tenants.cam.alias,
                                      username.toLowerCase(),
                                      (error_) => {
                                        assert.notExists(error_);
                                        RestAPI.Authentication.existsOnTenant(
                                          asGlobalAdmin,
                                          global.oaeTests.tenants.cam.alias,
                                          username.toUpperCase(),
                                          (error_) => {
                                            assert.notExists(error_);

                                            // Verify that the username is still available on different tenants
                                            RestAPI.Authentication.exists(
                                              asGeorgiaAnonymousUser,
                                              username,
                                              (error_) => {
                                                assert.ok(error_);
                                                assert.strictEqual(error_.code, 404);

                                                // Verify that the username is still available on the global admin tenant
                                                RestAPI.Authentication.existsOnTenant(
                                                  asGlobalAdmin,
                                                  'admin',
                                                  username,
                                                  (error_) => {
                                                    assert.ok(error_);
                                                    assert.strictEqual(error_.code, 404);

                                                    return callback();
                                                  }
                                                );
                                              }
                                            );
                                          }
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
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies that a username needs to be provided when checking for existence
     */
    it('verify login id exists validation', (callback) => {
      // Verify that the existence cannot be checked when a null username is provided
      RestAPI.Authentication.exists(asCambridgeAnonymousUser, null, (error) => {
        assert.ok(error);

        // Verify that the existence cannot be checked when an empty string username is provided
        RestAPI.Authentication.exists(asCambridgeAnonymousUser, '', (error) => {
          assert.ok(error);
          return callback();
        });
      });
    });
  });

  describe('#getOrCreateUser', () => {
    /**
     * Test that verifies the working of the getOrCreateUser function. This will use the internal
     * API as this would normally be called by Facebook, Twitter, etc. authentication
     */
    it('verify getOrCreateUser', (callback) => {
      const externalId = TestsUtil.generateTestUserId();
      const ctx = new Context(global.oaeTests.tenants.cam);
      const email = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );

      AuthenticationAPI.getOrCreateUser(
        ctx,
        AuthenticationConstants.providers.TWITTER,
        externalId,
        null,
        'Nicolaas Matthijs',
        { email },
        (error, userObject, loginId, created) => {
          assert.notExists(error);
          assert.ok(userObject);
          assert.strictEqual(created, true);

          // Get the user again through the same function
          AuthenticationAPI.getOrCreateUser(
            ctx,
            AuthenticationConstants.providers.TWITTER,
            externalId,
            null,
            'Branden Visser',
            { email },
            (error, userObject, loginId, created) => {
              assert.notExists(error);
              assert.ok(userObject);
              assert.strictEqual(userObject.displayName, 'Nicolaas Matthijs');
              assert.strictEqual(created, false);
              return callback();
            }
          );
        }
      );
    });
  });

  describe('#createUser', () => {
    /**
     * Test that verifies that a user cannot be created without a login id
     */
    it('verify create without login id', (callback) => {
      const ctx = new Context(global.oaeTests.tenants.cam);
      const email = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );
      AuthenticationAPI.createUser(
        ctx,
        undefined,
        'Branden Visser',
        { email },
        (error /* , userObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a user cannot be created without a tenant alias
     */
    it('verify create without tenant alias', (callback) => {
      const ctx = new Context(global.oaeTests.tenants.cam);
      const username = TestsUtil.generateTestUserId();
      const email = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );
      const loginId = new LoginId(undefined, AuthenticationConstants.providers.LOCAL, username, {
        password: 'password'
      });
      AuthenticationAPI.createUser(
        ctx,
        loginId,
        'Branden Visser',
        { email },
        (error /* , userObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a user cannot be created without a login provider
     */
    it('verify create without provider', (callback) => {
      const ctx = new Context(global.oaeTests.tenants.cam);
      const username = TestsUtil.generateTestUserId();
      const email = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );
      const loginId = new LoginId(ctx.tenant().alias, undefined, username, {
        password: 'password'
      });
      AuthenticationAPI.createUser(
        ctx,
        loginId,
        'Branden Visser',
        { email },
        (error /* , userObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a user cannot be created without a username
     */
    it('verify create without external id', (callback) => {
      const ctx = new Context(global.oaeTests.tenants.cam);
      const email = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );
      const loginId = new LoginId(
        ctx.tenant().alias,
        AuthenticationConstants.providers.LOCAL,
        undefined,
        {
          password: 'password'
        }
      );
      AuthenticationAPI.createUser(
        ctx,
        loginId,
        'Branden Visser',
        { email },
        (error /* , userObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a user cannot be created with an empty display name
     */
    it('verify create with empty display name', (callback) => {
      const ctx = new Context(global.oaeTests.tenants.cam);
      const username = TestsUtil.generateTestUserId();
      const loginId = new LoginId(
        ctx.tenant().alias,
        AuthenticationConstants.providers.LOCAL,
        username,
        {
          password: '12345'
        }
      );
      const email = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );

      // Test with `undefined` display name
      AuthenticationAPI.createUser(ctx, loginId, undefined, { email }, (error /* , userObj */) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);

        // Test with `null` display name
        AuthenticationAPI.createUser(ctx, loginId, null, { email }, (error /* , userObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);

          // Test with empty string display name
          AuthenticationAPI.createUser(ctx, loginId, '', { email }, (error /* , userObj */) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);
            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies that a user cannot be created with an invalid email address
     */
    it('verify create with invalid email address', (callback) => {
      const ctx = new Context(global.oaeTests.tenants.cam);
      const username = TestsUtil.generateTestUserId();
      const loginId = new LoginId(
        ctx.tenant().alias,
        AuthenticationConstants.providers.LOCAL,
        username,
        {
          password: '12345'
        }
      );

      // Test with an invalid email address
      AuthenticationAPI.createUser(
        ctx,
        loginId,
        'Test',
        { email: 'not an email address' },
        (error /* , userObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a user cannot be created without a password
     */
    it('verify create local without password', (callback) => {
      const ctx = new Context(global.oaeTests.tenants.cam);
      const username = TestsUtil.generateTestUserId();
      const email = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );
      const loginId = new LoginId(
        ctx.tenant().alias,
        AuthenticationConstants.providers.LOCAL,
        username
      );
      AuthenticationAPI.createUser(
        ctx,
        loginId,
        'Branden Visser',
        { email },
        (error /* , userObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a user cannot be created with a short password
     */
    it('verify create local with short password', (callback) => {
      const ctx = new Context(global.oaeTests.tenants.cam);
      const username = TestsUtil.generateTestUserId();
      const email = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );
      const loginId = new LoginId(
        ctx.tenant().alias,
        AuthenticationConstants.providers.LOCAL,
        username,
        {
          password: '12345'
        }
      );
      AuthenticationAPI.createUser(
        ctx,
        loginId,
        'Branden Visser',
        { email },
        (error /* , userObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a user can be created with a local login strategy
     */
    it('verify create user with local loginId', (callback) => {
      const ctx = new Context(global.oaeTests.tenants.cam);
      const email = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );
      const username = TestsUtil.generateTestUserId();
      const userRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
      const loginId = new LoginId(
        ctx.tenant().alias,
        AuthenticationConstants.providers.LOCAL,
        username,
        {
          password: 'password'
        }
      );
      AuthenticationAPI.createUser(
        ctx,
        loginId,
        'Branden Visser',
        { email },
        (error, userObject) => {
          assert.notExists(error);
          assert.ok(userObject);

          // Verify we can log in as this user
          RestAPI.Authentication.login(userRestContext, username, 'password', (error_) => {
            assert.notExists(error_);

            // Verify that we are actually logged in
            RestAPI.User.getMe(userRestContext, (error, meObject) => {
              assert.notExists(error);
              assert.ok(meObject);
              assert.strictEqual(meObject.id, userObject.id);
              return callback();
            });
          });
        }
      );
    });

    /**
     * Test that verifies that a user can be created with a non-local login strategy (twitter, facebook, etc.)
     */
    it('verify create user with non-local loginId', (callback) => {
      const ctx = new Context(global.oaeTests.tenants.cam);
      const username = TestsUtil.generateTestUserId();
      const email = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );
      const loginId = new LoginId(
        ctx.tenant().alias,
        AuthenticationConstants.providers.TWITTER,
        username
      );
      AuthenticationAPI.createUser(
        ctx,
        loginId,
        'Branden Visser',
        { email },
        (error, userObject) => {
          assert.notExists(error);
          assert.ok(userObject);

          // Verify the mapping exists
          AuthenticationAPI.getUserIdFromLoginId(
            ctx.tenant().alias,
            AuthenticationConstants.providers.TWITTER,
            username,
            (error, userId) => {
              assert.notExists(error);
              assert.strictEqual(userId, userObject.id);
              return callback();
            }
          );
        }
      );
    });

    /**
     * Test that verifies that creating a user fails if the local login id is already taken
     */
    it('verify creating a user fails if the local login id is already taken', (callback) => {
      const ctx = new Context(global.oaeTests.tenants.cam);
      const username = TestsUtil.generateTestUserId();
      const email = TestsUtil.generateTestEmailAddress(
        null,
        global.oaeTests.tenants.cam.emailDomains[0]
      );

      // Create the user with the login id
      const loginId = new LoginId(
        ctx.tenant().alias,
        AuthenticationConstants.providers.LOCAL,
        username,
        {
          password: 'password'
        }
      );
      AuthenticationAPI.createUser(
        ctx,
        loginId,
        'Branden Visser',
        { email },
        (error, userObject) => {
          assert.notExists(error);

          // Ensure we get an error when trying to create a user with the same login id
          AuthenticationAPI.createUser(ctx, loginId, 'Evil Branden Visser', { email }, (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 400);

            // Ensure the original user profile wasn't updated with the new display name
            RestAPI.User.getUser(asGlobalAdmin, userObject.id, (error, userObject) => {
              assert.notExists(error);
              assert.strictEqual(userObject.displayName, 'Branden Visser');

              return callback();
            });
          });
        }
      );
    });
  });

  describe('#createTenantAdminUser', () => {
    /**
     * Test that verifies the profile parameters when creating a tenant admin user
     */
    it('verify tenant administrator profile parameters', (callback) => {
      let username = TestsUtil.generateTestUserId();
      const password = 'password';
      const displayName = 'The Admin of Cam Tenants';
      let email = TestsUtil.generateTestEmailAddress();
      const options = {
        locale: 'en_US',
        publicAlias: 'Super User LOL',
        acceptedTC: 'true'
      };

      // Ensure the profile parameters are accurate when creating a tenant administrator as a global administrator
      RestAPI.User.createTenantAdminUserOnTenant(
        asGlobalAdmin,
        global.oaeTests.tenants.cam.alias,
        username,
        password,
        displayName,
        email,
        options,
        (error, user) => {
          assert.notExists(error);
          assert.strictEqual(user.displayName, displayName);
          assert.strictEqual(user.email, email.toLowerCase());
          assert.strictEqual(user.locale, options.locale);
          assert.strictEqual(user.publicAlias, options.publicAlias);
          assert.strictEqual(user.visibility, 'private');

          // Ensure the user's persisted properties are accurate and that they a tenant administrator
          RestAPI.User.getUser(asGlobalAdmin, user.id, (error, user) => {
            assert.notExists(error);
            assert.strictEqual(user.displayName, displayName);
            assert.strictEqual(user.email, email.toLowerCase());
            assert.strictEqual(user.locale, options.locale);
            assert.strictEqual(user.publicAlias, options.publicAlias);
            assert.strictEqual(user.visibility, 'private');
            assert.ok(user.isTenantAdmin);
            assert.ok(!user.isGlobalAdmin);

            // Ensure the profile parameters are accurate when creating a new tenant administrator as a tenant administrator
            username = TestsUtil.generateTestUserId();
            email = TestsUtil.generateTestEmailAddress();
            RestAPI.User.createTenantAdminUser(
              asCambridgeTenantAdmin,
              username,
              password,
              displayName,
              email,
              options,
              (error, user) => {
                assert.notExists(error);
                assert.strictEqual(user.displayName, displayName);
                assert.strictEqual(user.email, email.toLowerCase());
                assert.strictEqual(user.locale, options.locale);
                assert.strictEqual(user.publicAlias, options.publicAlias);
                assert.strictEqual(user.visibility, 'private');

                // Ensure the user's persisted properties are accurate and that they are a tenant administrator
                RestAPI.User.getUser(asCambridgeTenantAdmin, user.id, (error, user) => {
                  assert.notExists(error);
                  assert.strictEqual(user.displayName, displayName);
                  assert.strictEqual(user.email, email.toLowerCase());
                  assert.strictEqual(user.locale, options.locale);
                  assert.strictEqual(user.publicAlias, options.publicAlias);
                  assert.strictEqual(user.visibility, 'private');
                  assert.ok(user.isTenantAdmin);
                  assert.ok(!user.isGlobalAdmin);

                  return callback();
                });
              }
            );
          });
        }
      );
    });

    /**
     * Test that verifies authorization of creating a tenant administrator on a given tenant
     */
    it('verify authorization of creating a tenant admin user on a tenant', (callback) => {
      const username = TestsUtil.generateTestUserId();
      const email = TestsUtil.generateTestEmailAddress();

      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        // Ensure anonymous global tenant user cannot create a tenant admin
        RestAPI.User.createTenantAdminUserOnTenant(
          asAnonymousOnAdminTenant,
          global.oaeTests.tenants.cam.alias,
          username,
          'password',
          'displayName',
          email,
          {},
          (error /* , user */) => {
            assert.ok(error);
            assert.strictEqual(error.code, 401);

            // Ensure anonymous user tenant user cannot create a tenant admin on a tenant
            RestAPI.User.createTenantAdminUserOnTenant(
              asCambridgeAnonymousUser,
              global.oaeTests.tenants.cam.alias,
              username,
              'password',
              'displayName',
              email,
              {},
              (error /* , user */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 404);

                // Ensure regular user tenant user cannot create a tenant admin on a tenant
                RestAPI.User.createTenantAdminUserOnTenant(
                  mrvisser.restContext,
                  global.oaeTests.tenants.cam.alias,
                  username,
                  'password',
                  'displayName',
                  email,
                  {},
                  (error /* , user */) => {
                    assert.ok(error);
                    assert.strictEqual(error.code, 404);

                    // Sanity check global admin can create a tenant administrator on another tenant
                    RestAPI.User.createTenantAdminUserOnTenant(
                      asGlobalAdmin,
                      global.oaeTests.tenants.cam.alias,
                      username,
                      'password',
                      'displayName',
                      email,
                      {},
                      (error /* , user */) => {
                        assert.notExists(error);

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
    });

    /**
     * Test that verifies authorization of creating a tenant administrator on the current tenant
     */
    it('verify authorization of creating a tenant admin user on the current tenant', (callback) => {
      const username = TestsUtil.generateTestUserId();
      const email = TestsUtil.generateTestEmailAddress();

      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        // Ensure anonymous users cannot create tenant admins
        RestAPI.User.createTenantAdminUser(
          asCambridgeAnonymousUser,
          username,
          'password',
          'displayName',
          email,
          {},
          (error /* , user */) => {
            assert.ok(error);
            assert.strictEqual(error.code, 401);

            // Ensure regular users cannot create tenant admins
            RestAPI.User.createTenantAdminUser(
              mrvisser.restContext,
              username,
              'password',
              'displayName',
              email,
              {},
              (error /* , user */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 401);

                // Sanity check a tenant administrator can create a new tenant administrator on the tenant
                RestAPI.User.createTenantAdminUser(
                  asCambridgeTenantAdmin,
                  username,
                  'password',
                  'displayName',
                  email,
                  {},
                  (error /* , user */) => {
                    assert.notExists(error);

                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies validation of creating a tenant administrator on a specified tenant
     */
    it('verify validation of creating a tenant admin user on a specified tenant', (callback) => {
      const username = TestsUtil.generateTestUserId();
      const password = 'password';
      const displayName = 'The Admin of Cam Tenants';
      const email = TestsUtil.generateTestEmailAddress();
      const options = {
        locale: 'en_US',
        publicAlias: 'Super User LOL',
        acceptedTC: 'true'
      };

      // Ensure a tenant alias is required
      RestAPI.User.createTenantAdminUserOnTenant(
        asGlobalAdmin,
        null,
        username,
        password,
        displayName,
        email,
        options,
        (error /* , user */) => {
          assert.ok(error);

          // Note that this technically hits the "update user" endpoint with user id "createTenantAdmin". The mistake can be so subtle in
          // an API that we'll still verify this to ensure the mistake can't ever result in an accepted request if APIs are refactored
          assert.strictEqual(error.code, 400);

          // Ensure a username is required
          RestAPI.User.createTenantAdminUserOnTenant(
            asGlobalAdmin,
            global.oaeTests.tenants.cam.alias,
            null,
            password,
            displayName,
            email,
            options,
            (error /* , user */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);

              // Ensure a password is required
              RestAPI.User.createTenantAdminUserOnTenant(
                asGlobalAdmin,
                global.oaeTests.tenants.cam.alias,
                username,
                null,
                displayName,
                email,
                options,
                (error /* , user */) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 400);

                  // Ensure a displayName is required
                  RestAPI.User.createTenantAdminUserOnTenant(
                    asGlobalAdmin,
                    global.oaeTests.tenants.cam.alias,
                    username,
                    password,
                    null,
                    email,
                    options,
                    (error /* , user */) => {
                      assert.ok(error);
                      assert.strictEqual(error.code, 400);

                      // Ensure target tenant cannot be the global admin tenant
                      RestAPI.User.createTenantAdminUserOnTenant(
                        asGlobalAdmin,
                        'admin',
                        username,
                        password,
                        displayName,
                        email,
                        options,
                        (error /* , user */) => {
                          assert.ok(error);
                          assert.strictEqual(error.code, 400);

                          // Sanity check we can create one with these parameters
                          RestAPI.User.createTenantAdminUserOnTenant(
                            asGlobalAdmin,
                            global.oaeTests.tenants.cam.alias,
                            username,
                            password,
                            displayName,
                            email,
                            options,
                            (error /* , user */) => {
                              assert.notExists(error);

                              return callback();
                            }
                          );
                        }
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

    /**
     * Test that verifies validation of creating a tenant administrator on the current tenant
     */
    it('verify validation of creating a tenant admin user on the current tenant', (callback) => {
      const username = TestsUtil.generateTestUserId();
      const password = 'password';
      const displayName = 'The Admin of Cam Tenants';
      const email = TestsUtil.generateTestEmailAddress();
      const options = {
        locale: 'en_US',
        publicAlias: 'Super User LOL',
        acceptedTC: 'true'
      };

      // Ensure a username is required
      RestAPI.User.createTenantAdminUser(
        asCambridgeTenantAdmin,
        null,
        password,
        displayName,
        email,
        options,
        (error /* , user */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);

          // Ensure a password is required
          RestAPI.User.createTenantAdminUser(
            asCambridgeTenantAdmin,
            username,
            null,
            displayName,
            email,
            options,
            (error /* , user */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);

              // Ensure a displayName is required
              RestAPI.User.createTenantAdminUser(
                asCambridgeTenantAdmin,
                username,
                password,
                null,
                email,
                options,
                (error /* , user */) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 400);

                  // Ensure a valid email is required
                  RestAPI.User.createTenantAdminUser(
                    asGlobalAdmin,
                    username,
                    password,
                    displayName,
                    null,
                    options,
                    (error /* , user */) => {
                      assert.ok(error);
                      assert.strictEqual(error.code, 400);
                      RestAPI.User.createTenantAdminUser(
                        asGlobalAdmin,
                        username,
                        password,
                        displayName,
                        'Not an email',
                        options,
                        (error /* , user */) => {
                          assert.ok(error);
                          assert.strictEqual(error.code, 400);

                          // Ensure target tenant cannot be the global admin tenant by requesting with the global administrator
                          RestAPI.User.createTenantAdminUser(
                            asGlobalAdmin,
                            username,
                            password,
                            displayName,
                            email,
                            options,
                            (error /* , user */) => {
                              assert.ok(error);
                              assert.strictEqual(error.code, 400);

                              // Sanity check we can create one with these parameters
                              RestAPI.User.createTenantAdminUser(
                                asCambridgeTenantAdmin,
                                username,
                                password,
                                displayName,
                                email,
                                options,
                                (error /* , user */) => {
                                  assert.notExists(error);

                                  return callback();
                                }
                              );
                            }
                          );
                        }
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

  describe('#createGlobalAdminUser', () => {
    /**
     * Test that verifies the profile parameters when creating a global admin user
     */
    it('verify global administrator profile parameters', (callback) => {
      const username = TestsUtil.generateTestUserId();
      const password = 'password';
      const displayName = 'The Admin of Global Tenants';
      const email = TestsUtil.generateTestEmailAddress();
      const options = {
        locale: 'en_US',
        publicAlias: 'Super User LOL'
      };

      RestAPI.User.createGlobalAdminUser(
        asGlobalAdmin,
        username,
        password,
        displayName,
        email,
        options,
        (error, user) => {
          assert.notExists(error);
          assert.strictEqual(user.displayName, displayName);
          assert.strictEqual(user.email, email.toLowerCase());
          assert.strictEqual(user.locale, options.locale);
          assert.strictEqual(user.publicAlias, options.publicAlias);
          assert.strictEqual(user.visibility, 'private');

          RestAPI.User.getUser(asGlobalAdmin, user.id, (error, user) => {
            assert.notExists(error);
            assert.strictEqual(user.displayName, displayName);
            assert.strictEqual(user.email, email.toLowerCase());
            assert.strictEqual(user.locale, options.locale);
            assert.strictEqual(user.publicAlias, options.publicAlias);
            assert.strictEqual(user.visibility, 'private');
            assert.ok(!user.isTenantAdmin);
            assert.ok(user.isGlobalAdmin);
            return callback();
          });
        }
      );
    });

    /**
     * Test that ensures that creating a global admin user is authorized properly
     */
    it('verify authorization of creating a global admin user', (callback) => {
      const userId = TestsUtil.generateTestUserId();
      const email = TestsUtil.generateTestEmailAddress();

      // Ensure anonymous on cam tenant cannot create a global admin user. We expect a 404 because the endpoint is
      // only mounted on the global tenant
      RestAPI.User.createGlobalAdminUser(
        asCambridgeAnonymousUser,
        userId,
        userId,
        userId,
        email,
        {},
        (error, user) => {
          assert.ok(error);

          // Note that this technically hits the "update user" endpoint with user id "createGlobalAdmin". The mistake can be so subtle in
          // an API that we'll still verify this to ensure the mistake can't ever result in an accepted request if APIs are refactored
          assert.strictEqual(error.code, 400);
          assert.ok(!user);

          // Ensure anonymous on global admin tenant cannot create a global admin user
          RestAPI.User.createGlobalAdminUser(
            asAnonymousOnAdminTenant,
            userId,
            userId,
            userId,
            email,
            {},
            (error, user) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);
              assert.ok(!user);

              // Ensure tenant admin on cam tenant cannot create a global admin user. We expect a 404 because the endpoint is
              // only mounted on the global tenant
              RestAPI.User.createGlobalAdminUser(
                asCambridgeTenantAdmin,
                userId,
                userId,
                userId,
                email,
                {},
                (error, user) => {
                  assert.ok(error);

                  // Note that this technically hits the "update user" endpoint with user id "createGlobalAdmin". The mistake can be so subtle in
                  // an API that we'll still verify this to ensure the mistake can't ever result in an accepted request if APIs are refactored
                  assert.strictEqual(error.code, 400);
                  assert.ok(!user);

                  const testGlobalUserRestContext = TestsUtil.createGlobalRestContext();

                  // Ensure that the credentials do not authenticate a value global administrator
                  RestAPI.Authentication.login(
                    testGlobalUserRestContext,
                    userId,
                    userId,
                    (error_) => {
                      assert.ok(error_);
                      assert.strictEqual(error_.code, 401);

                      // Verify the context was not authenticated
                      RestAPI.User.getMe(testGlobalUserRestContext, (error, me) => {
                        assert.notExists(error);
                        assert.ok(me.anon);

                        // Sanity check that we can create the user and authenticate its context
                        RestAPI.User.createGlobalAdminUser(
                          asGlobalAdmin,
                          userId,
                          userId,
                          userId,
                          email,
                          {},
                          (error, user) => {
                            assert.notExists(error);
                            assert.ok(user);
                            assert.strictEqual(user.displayName, userId);

                            RestAPI.Authentication.login(
                              testGlobalUserRestContext,
                              userId,
                              userId,
                              (error_) => {
                                assert.notExists(error_);

                                RestAPI.User.getMe(testGlobalUserRestContext, (error, me) => {
                                  assert.notExists(error);
                                  assert.strictEqual(me.displayName, userId);

                                  return callback();
                                });
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

    /**
     * Test that verifies parameter validation of the create global admin user endpoint
     */
    it('verify validation of creating a global admin user', (callback) => {
      const username = TestsUtil.generateTestUserId();
      const email = TestsUtil.generateTestEmailAddress();

      // Ensure you cannot create a global admin user without a username
      RestAPI.User.createGlobalAdminUser(
        asGlobalAdmin,
        null,
        username,
        username,
        email,
        {},
        (error, user) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.ok(!user);

          // Ensure you cannot create a global admin user without a password
          RestAPI.User.createGlobalAdminUser(
            asGlobalAdmin,
            username,
            null,
            username,
            email,
            {},
            (error, user) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);
              assert.ok(!user);

              // Ensure you cannot create a global admin user with a password that is too short
              RestAPI.User.createGlobalAdminUser(
                asGlobalAdmin,
                username,
                'a',
                username,
                email,
                {},
                (error, user) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 400);
                  assert.ok(!user);

                  // Ensure you cannot create a global admin user without a displayName
                  RestAPI.User.createGlobalAdminUser(
                    asGlobalAdmin,
                    username,
                    username,
                    null,
                    email,
                    {},
                    (error, user) => {
                      assert.ok(error);
                      assert.strictEqual(error.code, 400);
                      assert.ok(!user);

                      // Ensure you cannot create a global admin user without a valid email address
                      RestAPI.User.createGlobalAdminUser(
                        asGlobalAdmin,
                        username,
                        username,
                        null,
                        null,
                        {},
                        (error, user) => {
                          assert.ok(error);
                          assert.strictEqual(error.code, 400);
                          assert.ok(!user);
                          RestAPI.User.createGlobalAdminUser(
                            asGlobalAdmin,
                            username,
                            username,
                            null,
                            'not an email',
                            {},
                            (error, user) => {
                              assert.ok(error);
                              assert.strictEqual(error.code, 400);
                              assert.ok(!user);

                              // Ensure the global admin still cannot be authenticated
                              const testGlobalUserRestContext = TestsUtil.createGlobalRestContext();

                              // Ensure that the credentials do not authenticate a valid global administrator
                              RestAPI.Authentication.login(
                                testGlobalUserRestContext,
                                username,
                                username,
                                (error_) => {
                                  assert.ok(error_);
                                  assert.strictEqual(error_.code, 401);

                                  // Verify the context was not authenticated
                                  RestAPI.User.getMe(testGlobalUserRestContext, (error, me) => {
                                    assert.notExists(error);
                                    assert.ok(me.anon);

                                    // Sanity check the user can be created through the REST endpoints
                                    RestAPI.User.createGlobalAdminUser(
                                      asGlobalAdmin,
                                      username,
                                      username,
                                      username,
                                      email,
                                      {},
                                      (error, user) => {
                                        assert.notExists(error);
                                        assert.ok(user);

                                        // Ensure when we try and create one with the same loginId, we get a 400 error
                                        RestAPI.User.createGlobalAdminUser(
                                          asGlobalAdmin,
                                          username,
                                          username,
                                          username,
                                          email,
                                          {},
                                          (error /* , secondUser */) => {
                                            assert.ok(error);
                                            assert.strictEqual(error.code, 400);
                                            return callback();
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
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies creating a global admin user results in a user created who has global admin privileges
     */
    it('verify creating global admin user results in a user that has global admin user privileges', (callback) => {
      const userId = TestsUtil.generateTestUserId();
      const email = TestsUtil.generateTestEmailAddress();

      // Create a global admin user
      RestAPI.User.createGlobalAdminUser(
        asGlobalAdmin,
        userId,
        userId,
        userId,
        email,
        {},
        (error /* , user */) => {
          assert.notExists(error);

          // Log them in
          const createdGlobalAdminRestContext = TestsUtil.createGlobalRestContext();
          RestAPI.Authentication.login(createdGlobalAdminRestContext, userId, userId, (error_) => {
            assert.notExists(error_);

            // Ensure the `isGlobalAdmin` flag on the user is true
            RestAPI.User.getMe(createdGlobalAdminRestContext, (error, me) => {
              assert.notExists(error);
              assert.strictEqual(me.isGlobalAdmin, true);
              assert.ok(!me.isTenantAdmin);

              // The global admin user should be created as private
              assert.strictEqual(me.visibility, 'private');

              return callback();
            });
          });
        }
      );
    });
  });

  describe('#associateLoginId', () => {
    /**
     * Test that verifies that a login id mapping cannot be done without a login id
     */
    it('verify associate without loginId', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        // Associate a login id to the user, with no login id
        const ctx = new Context(global.oaeTests.tenants.cam, user.user);
        AuthenticationAPI.associateLoginId(ctx, undefined, user.user.id, (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, 400);
          return callback();
        });
      });
    });

    /**
     * Test that verifies that a login id mapping cannot be done without a tenant
     */
    it('verify associate without tenant', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        // Associate a login id to the user, with no tenant
        const ctx = new Context(global.oaeTests.tenants.cam, user.user);
        const loginId = new LoginId(
          undefined,
          AuthenticationConstants.providers.LOCAL,
          user.user.id,
          {
            password: 'password'
          }
        );
        AuthenticationAPI.associateLoginId(ctx, loginId, user.user.id, (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, 400);
          return callback();
        });
      });
    });

    /**
     * Test that verifies that a login id mapping cannot be done without a login provider
     */
    it('verify associate without provider', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        // Associate a login id to the user, with no login provider
        const ctx = new Context(global.oaeTests.tenants.cam, user.user);
        const loginId = new LoginId(ctx.tenant().alias, undefined, user.user.id, {
          password: 'password'
        });
        AuthenticationAPI.associateLoginId(ctx, loginId, user.id, (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, 400);
          return callback();
        });
      });
    });

    /**
     * Test that verifies that a login id mapping cannot be done without an external id
     */
    it('verify associate without external id', (callback) => {
      const email = TestsUtil.generateTestEmailAddress();
      let ctx = new Context(global.oaeTests.tenants.cam);
      PrincipalsAPI.createUser(ctx, null, 'Branden Visser', { email }, (error, user) => {
        assert.notExists(error);
        ctx = new Context(global.oaeTests.tenants.cam, user);
        const loginId = new LoginId(
          ctx.tenant().alias,
          AuthenticationConstants.providers.LOCAL,
          undefined,
          {
            password: 'password'
          }
        );

        // Associate a login id to the user, with no external id
        AuthenticationAPI.associateLoginId(ctx, loginId, user.id, (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, 400);
          return callback();
        });
      });
    });

    /**
     * Test that verifies that a login id mapping cannot be done without a user id
     */
    it('verify associate without user id', (callback) => {
      const email = TestsUtil.generateTestEmailAddress();
      let ctx = new Context(global.oaeTests.tenants.cam);
      PrincipalsAPI.createUser(ctx, null, 'Branden Visser', { email }, (error, user) => {
        assert.notExists(error);
        const userId = TestsUtil.generateTestUserId();
        ctx = new Context(global.oaeTests.tenants.cam, user);
        const loginId = new LoginId(
          ctx.tenant().alias,
          AuthenticationConstants.providers.LOCAL,
          userId,
          {
            password: 'password'
          }
        );

        // Associate a login id to the user, with no user id
        AuthenticationAPI.associateLoginId(ctx, loginId, undefined, (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, 400);
          return callback();
        });
      });
    });

    /**
     * Test that verifies that a login id mapping cannot be done when providing no password
     */
    it('verify associate local without password', (callback) => {
      let ctx = new Context(global.oaeTests.tenants.cam);
      const email = TestsUtil.generateTestEmailAddress();
      PrincipalsAPI.createUser(ctx, null, 'Branden Visser', { email }, (error, user) => {
        assert.notExists(error);
        const userId = TestsUtil.generateTestUserId();
        ctx = new Context(global.oaeTests.tenants.cam, user);
        const loginId = new LoginId(
          ctx.tenant().alias,
          AuthenticationConstants.providers.LOCAL,
          userId
        );

        // Associate a login id to the user, with no password
        AuthenticationAPI.associateLoginId(ctx, loginId, user.id, (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, 400);
          return callback();
        });
      });
    });

    /**
     * Test that verifies that a login id mapping cannot be done when providing a short password
     */
    it('verify associate local with short password', (callback) => {
      let ctx = new Context(global.oaeTests.tenants.cam);
      const email = TestsUtil.generateTestEmailAddress();
      PrincipalsAPI.createUser(ctx, null, 'Branden Visser', { email }, (error, user) => {
        assert.notExists(error);
        const userId = TestsUtil.generateTestUserId();
        ctx = new Context(global.oaeTests.tenants.cam, user);
        const loginId = new LoginId(
          ctx.tenant().alias,
          AuthenticationConstants.providers.LOCAL,
          userId,
          {
            password: '12345'
          }
        );

        // Associate a login id to the user, with short password
        AuthenticationAPI.associateLoginId(ctx, loginId, user.id, (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, 400);
          return callback();
        });
      });
    });

    /**
     * Test that verifies that a user can map a login id to his user id
     */
    it('verify associate login id to self', (callback) => {
      let ctx = new Context(global.oaeTests.tenants.cam);
      const email = TestsUtil.generateTestEmailAddress();
      PrincipalsAPI.createUser(ctx, null, 'Branden Visser', { email }, (error, user) => {
        assert.notExists(error);
        const userId = TestsUtil.generateTestUserId();
        ctx = new Context(global.oaeTests.tenants.cam, user);
        const loginId = new LoginId(
          ctx.tenant().alias,
          AuthenticationConstants.providers.LOCAL,
          userId,
          {
            password: 'password'
          }
        );

        // Associate a login id to the user
        AuthenticationAPI.associateLoginId(ctx, loginId, user.id, (error_) => {
          assert.notExists(error_);

          // Verify the login id is mapped
          AuthenticationAPI.getUserIdFromLoginId(
            ctx.tenant().alias,
            AuthenticationConstants.providers.LOCAL,
            userId,
            (error, userId) => {
              assert.notExists(error);
              assert.strictEqual(user.id, userId);
              return callback();
            }
          );
        });
      });
    });

    /**
     * Test that verifies that a user can map multiple login ids to his user id
     */
    it('verify associate multiple login ids to self', (callback) => {
      let ctx = new Context(global.oaeTests.tenants.cam);
      const email = TestsUtil.generateTestEmailAddress();
      PrincipalsAPI.createUser(ctx, null, 'Branden Visser', { email }, (error, user) => {
        assert.notExists(error);
        const userId = TestsUtil.generateTestUserId() + ':withcolon';
        const twitterId = TestsUtil.generateTestUserId() + ':withcolon';
        ctx = new Context(global.oaeTests.tenants.cam, user);

        // Associate a login id to the user
        AuthenticationAPI.associateLoginId(
          ctx,
          new LoginId(ctx.tenant().alias, AuthenticationConstants.providers.LOCAL, userId, {
            password: 'password'
          }),
          user.id,
          (error_) => {
            assert.notExists(error_);

            // Associate a second twitter id to the user
            AuthenticationAPI.associateLoginId(
              ctx,
              new LoginId(ctx.tenant().alias, AuthenticationConstants.providers.TWITTER, twitterId),
              user.id,
              (error_) => {
                assert.notExists(error_);

                // Verify the local login id is mapped
                AuthenticationAPI.getUserIdFromLoginId(
                  ctx.tenant().alias,
                  AuthenticationConstants.providers.LOCAL,
                  userId,
                  (error, userId) => {
                    assert.notExists(error);
                    assert.strictEqual(user.id, userId);

                    // Verify the twitter login id is mapped
                    AuthenticationAPI.getUserIdFromLoginId(
                      ctx.tenant().alias,
                      AuthenticationConstants.providers.TWITTER,
                      twitterId,
                      (error, userId) => {
                        assert.notExists(error);
                        assert.strictEqual(user.id, userId);
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
    });

    /**
     * Test that verifies that an admin user can associate a login id to a user id
     */
    it('verify admin associate login id', (callback) => {
      const email = TestsUtil.generateTestEmailAddress();
      const ctx = TestsUtil.createTenantAdminContext(global.oaeTests.tenants.cam);
      PrincipalsAPI.createUser(ctx, null, 'Branden Visser', { email }, (error, user) => {
        assert.notExists(error);
        const userId = TestsUtil.generateTestUserId() + ':withcolon';

        // Associate a login id to the user
        AuthenticationAPI.associateLoginId(
          ctx,
          new LoginId(ctx.tenant().alias, AuthenticationConstants.providers.LOCAL, userId, {
            password: 'password'
          }),
          user.id,
          (error_) => {
            assert.notExists(error_);

            // Verify the local login id is mapped
            AuthenticationAPI.getUserIdFromLoginId(
              ctx.tenant().alias,
              AuthenticationConstants.providers.LOCAL,
              userId,
              (error, userId) => {
                assert.notExists(error);
                assert.strictEqual(user.id, userId);
                return callback();
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that a user cannot associate a login id to someone else's user id
     */
    it('verify another user cannot associate login id', (callback) => {
      let email = TestsUtil.generateTestEmailAddress();
      const ctx = TestsUtil.createTenantAdminContext(global.oaeTests.tenants.cam);
      PrincipalsAPI.createUser(ctx, null, 'Branden Visser', { email }, (error, mrvisser) => {
        assert.notExists(error);
        const mrvisserUsername = TestsUtil.generateTestUserId() + ':withcolon';

        email = TestsUtil.generateTestEmailAddress();
        PrincipalsAPI.createUser(ctx, null, 'Bert Pareyn', { email }, (error, bert) => {
          assert.notExists(error);
          const bertCtx = new Context(global.oaeTests.tenants.cam, bert);

          // Associate a login id to the user
          AuthenticationAPI.associateLoginId(
            bertCtx,
            new LoginId(
              ctx.tenant().alias,
              AuthenticationConstants.providers.LOCAL,
              mrvisserUsername,
              {
                password: 'password'
              }
            ),
            mrvisser.id,
            (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 401);

              // Verify the local login id is not mapped
              AuthenticationAPI.getUserIdFromLoginId(
                ctx.tenant().alias,
                AuthenticationConstants.providers.LOCAL,
                mrvisserUsername,
                (error, mrvisserId) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 404);
                  assert.ok(!mrvisserId);
                  return callback();
                }
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies that a user can only be mapped to 1 login id per login provider
     */
    it('verify cannot associate multiple login ids of same type', (callback) => {
      const email = TestsUtil.generateTestEmailAddress();
      let ctx = new Context(global.oaeTests.tenants.cam);
      PrincipalsAPI.createUser(ctx, null, 'Branden Visser', { email }, (error, user) => {
        assert.notExists(error);
        const userId = TestsUtil.generateTestUserId() + ':withcolon';
        const userId2 = TestsUtil.generateTestUserId() + ':withcolon';
        ctx = new Context(global.oaeTests.tenants.cam, user);

        // Associate a login id to the user
        AuthenticationAPI.associateLoginId(
          ctx,
          new LoginId(ctx.tenant().alias, AuthenticationConstants.providers.LOCAL, userId, {
            password: 'password'
          }),
          user.id,
          (error_) => {
            assert.notExists(error_);

            // Associate a second twitter id to the user
            AuthenticationAPI.associateLoginId(
              ctx,
              new LoginId(ctx.tenant().alias, AuthenticationConstants.providers.LOCAL, userId2, {
                password: 'password'
              }),
              user.id,
              (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 400);

                // Verify the first local login id is mapped
                AuthenticationAPI.getUserIdFromLoginId(
                  ctx.tenant().alias,
                  AuthenticationConstants.providers.LOCAL,
                  userId,
                  (error, userId) => {
                    assert.notExists(error);
                    assert.strictEqual(user.id, userId);

                    // Verify the second local login id is not mapped
                    AuthenticationAPI.getUserIdFromLoginId(
                      ctx.tenant().alias,
                      AuthenticationConstants.providers.LOCAL,
                      userId2,
                      (error, userId) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 404);
                        assert.ok(!userId);
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
    });

    /**
     * Test that verifies that an admin can associate an existing login id with a different user
     */
    it('verify admin re-associate login id', (callback) => {
      const adminCtx = TestsUtil.createTenantAdminContext(global.oaeTests.tenants.cam);
      const mrvisserUsername = TestsUtil.generateTestUserId() + ':withcolon';
      const mrvisserLoginId = new LoginId(
        global.oaeTests.tenants.cam.alias,
        AuthenticationConstants.providers.TWITTER,
        mrvisserUsername
      );
      const mrvisserEmail = TestsUtil.generateTestEmailAddress();
      const bertUsername = TestsUtil.generateTestUserId() + ':withcolon';
      const bertLoginId = new LoginId(
        global.oaeTests.tenants.cam.alias,
        AuthenticationConstants.providers.LOCAL,
        bertUsername,
        { password: 'password' }
      );
      const bertEmail = TestsUtil.generateTestEmailAddress();
      AuthenticationAPI.createUser(
        adminCtx,
        mrvisserLoginId,
        'Branden Visser',
        { email: mrvisserEmail },
        (error /* , user */) => {
          assert.notExists(error);

          AuthenticationAPI.createUser(
            adminCtx,
            bertLoginId,
            'Bert Pareyn',
            { email: bertEmail },
            (error, bert) => {
              assert.notExists(error);

              AuthenticationAPI.associateLoginId(
                adminCtx,
                new LoginId(
                  adminCtx.tenant().alias,
                  AuthenticationConstants.providers.TWITTER,
                  mrvisserUsername
                ),
                bert.id,
                (error_) => {
                  assert.notExists(error_);

                  AuthenticationAPI.getUserIdFromLoginId(
                    adminCtx.tenant().alias,
                    AuthenticationConstants.providers.TWITTER,
                    mrvisserUsername,
                    (error, userId) => {
                      assert.notExists(error);
                      assert.strictEqual(userId, bert.id);
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

    /**
     * Test that verifies that a loginId can't be associated to a non-existing user
     */
    it('verify login can only associate to existing users', (callback) => {
      const adminCtx = TestsUtil.createTenantAdminContext(global.oaeTests.tenants.cam);
      AuthenticationAPI.associateLoginId(
        adminCtx,
        new LoginId(
          adminCtx.tenant().alias,
          AuthenticationConstants.providers.TWITTER,
          TestsUtil.generateTestUserId() + ':withcolon'
        ),
        'u:camtest:notARealUserId',
        (error, userId) => {
          assert.ok(error);
          assert.strictEqual(error.code, 404);
          assert.ok(!userId);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a non-admin cannot associate an existing login id with a different user
     */
    it('verify non-admin cannot re-associate login id', (callback) => {
      const tenant = global.oaeTests.tenants.cam;
      const adminCtx = TestsUtil.createTenantAdminContext(tenant);
      const mrvisserUsername = TestsUtil.generateTestUserId();
      const mrvisserLoginId = new LoginId(
        tenant.alias,
        AuthenticationConstants.providers.TWITTER,
        mrvisserUsername
      );
      const mrvisserEmail = TestsUtil.generateTestEmailAddress();
      const bertUsername = TestsUtil.generateTestUserId();
      const bertLoginId = new LoginId(
        tenant.alias,
        AuthenticationConstants.providers.LOCAL,
        bertUsername,
        {
          password: 'password'
        }
      );
      const bertEmail = TestsUtil.generateTestEmailAddress();
      AuthenticationAPI.createUser(
        adminCtx,
        mrvisserLoginId,
        'Branden Visser',
        { email: mrvisserEmail },
        (error, mrvisser) => {
          assert.notExists(error);

          AuthenticationAPI.createUser(
            adminCtx,
            bertLoginId,
            'Bert Pareyn',
            { email: bertEmail },
            (error, bert) => {
              assert.notExists(error);
              const bertCtx = new Context(tenant, bert);

              AuthenticationAPI.associateLoginId(
                bertCtx,
                new LoginId(
                  tenant.alias,
                  AuthenticationConstants.providers.TWITTER,
                  mrvisserUsername
                ),
                bert.id,
                (error_) => {
                  assert.ok(error_);
                  assert.strictEqual(error_.code, 401);

                  AuthenticationAPI.getUserIdFromLoginId(
                    tenant.alias,
                    AuthenticationConstants.providers.TWITTER,
                    mrvisserUsername,
                    (error, userId) => {
                      assert.notExists(error);
                      assert.strictEqual(userId, mrvisser.id);
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
    /**
     * Test that trying to get a userId from an invalid loginId errors
     */
    it('verify validation in getUserIdFromLoginId', (callback) => {
      const tenant = global.oaeTests.tenants.cam;
      AuthenticationAPI.getUserIdFromLoginId(
        tenant.alias,
        AuthenticationConstants.providers.TWITTER,
        '',
        (error /* , userId */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });
  });

  describe('#registerStrategy', () => {
    /**
     * Test that verifies that a strategy cannot be registered twice.
     */
    it('verify a strategy cannot be registered twice', () => {
      assert.throws(() => {
        AuthenticationAPI.registerStrategy('local', {});
      });
    });
  });

  describe('Events', () => {
    /**
     * Test that verifies that the authentication refreshedStrategies event gets invoked with a tenant object when the strategies
     * are refreshed.
     */
    it('verify the refresh strategy event is fired with a tenant when strategies are refreshed', (callback) => {
      AuthenticationAPI.emitter.once(
        AuthenticationConstants.events.REFRESHED_STRATEGIES,
        (tenant) => {
          assert.ok(tenant);
          assert.ok(tenant.alias);
          assert.strictEqual(tenant.alias, global.oaeTests.tenants.cam.alias);
          return callback();
        }
      );

      // Refresh and propagate to the event binding above
      AuthenticationAPI.refreshStrategies(global.oaeTests.tenants.cam);
    });
  });

  describe('Password reset', () => {
    /**
     * Test that verifies that when a user requests a password reset, a secret is generated that can be used to set the new password
     */
    it('verify that when a user requests a password reset, a secret is generated and can be used to set the new password', (callback) => {
      // Create a test user
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;
        const userRestContext = user.restContext;
        const { username } = userRestContext;
        // Log the user out first
        RestAPI.Authentication.logout(userRestContext, (error, body, response) => {
          assert.notExists(error);
          assert.strictEqual(response.statusCode, 302);
          assert.strictEqual(response.headers.location, '/');
          // Check that a password secret can be retrieved
          RestAPI.Authentication.getResetPasswordSecret(
            asCambridgeAnonymousUser,
            username,
            (error /* , body, response */) => {
              assert.notExists(error);
              const loginId = new LoginId(global.oaeTests.tenants.cam.alias, 'local', username);
              // Ensure secret is saved correctly in db
              Cassandra.runQuery(
                'SELECT "secret" FROM "AuthenticationLoginId" WHERE "loginId" = ?',
                [loginId.tenantAlias + ':' + loginId.provider + ':' + loginId.externalId],
                (error, rows) => {
                  assert.notExists(error);
                  const secret = rows[0].get('secret');
                  // Check that an empty password can't be set
                  let newPassword = '';
                  RestAPI.Authentication.resetPassword(
                    asCambridgeAnonymousUser,
                    username,
                    secret,
                    newPassword,
                    (error_) => {
                      assert.ok(error_);
                      assert.strictEqual(error_.code, 400);
                      // Check that a password under 6 char long can't be set
                      newPassword = 'inval';
                      RestAPI.Authentication.resetPassword(
                        asCambridgeAnonymousUser,
                        username,
                        secret,
                        newPassword,
                        (error_) => {
                          assert.ok(error_);
                          assert.strictEqual(error_.code, 400);
                          // Check that a valid new password can be set
                          newPassword = 'newPassword';
                          RestAPI.Authentication.resetPassword(
                            asCambridgeAnonymousUser,
                            username,
                            secret,
                            newPassword,
                            (error_) => {
                              assert.notExists(error_);
                              // Check user can login with new password
                              RestAPI.Authentication.login(
                                asCambridgeAnonymousUser,
                                username,
                                newPassword,
                                (error_) => {
                                  assert.notExists(error_);
                                  // Verify that we are actually logged in
                                  RestAPI.User.getMe(user.restContext, (error, meObject) => {
                                    assert.notExists(error);
                                    assert.ok(meObject);
                                    assert.strictEqual(meObject.id, user.id);
                                    callback();
                                  });
                                }
                              );
                            }
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
});
