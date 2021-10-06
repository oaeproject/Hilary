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

import fs from 'node:fs';
import { format } from 'node:util';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { pluck, mergeRight, keys } from 'ramda';
import { assert } from 'chai';

import * as AuthenticationAPI from 'oae-authentication';
import * as AuthzInvitationsDAO from 'oae-authz/lib/invitations/dao.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import * as EmailTestUtil from 'oae-email/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util.js';
import * as TestsUtil from 'oae-tests';
import PrincipalsAPI from 'oae-principals';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util.js';

import { RestContext } from 'oae-rest/lib/model.js';
import { Context } from 'oae-context';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Users', () => {
  // Rest contexts that can be used to make requests as different types of users
  let asCambridgeAnonymousUser = null; // Anonymous user associated to a tenant
  let asCambridgeTenantAdmin = null; // Cambridge tenant admin
  let asGeorgiaTechTenantAdmin = null; // Georgia tech tenant admin
  let asGlobalAdmin = null; // global administrator
  let asGlobalAnonymous = null; // Anonymous user browsing the global admin tenant
  let asAnotherGlobalAdmin = null; // API context for the global admin (to be used on back-end API calls, not REST calls)

  /**
   * @return {Stream} A stream to jpg image
   * @api private
   */
  const _getPictureStream = () => fs.createReadStream(format('%s/data/restroom.jpg', __dirname));

  /**
   * Function that will fill up the REST and admin contexts
   */
  before((callback) => {
    // Fill up the request contexts
    asCambridgeAnonymousUser = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    asGeorgiaTechTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    asGlobalAdmin = TestsUtil.createGlobalAdminRestContext();
    asAnotherGlobalAdmin = TestsUtil.createGlobalAdminContext();
    asGlobalAnonymous = TestsUtil.createGlobalRestContext();
    return callback();
  });

  describe('Full User Profile Decorators', () => {
    /**
     * Test that verifies you cannot register a duplicate profile decorator, nor can you register one without a function
     */
    it('verify register full user profile decorator error scenarios', (callback) => {
      const testId = TestsUtil.generateRandomText();
      assert.throws(() => {
        PrincipalsAPI.registerFullUserProfileDecorator(testId);
      });

      // Verify we can successfully register one with a function afterward
      PrincipalsAPI.registerFullUserProfileDecorator(testId, (ctx, user, callback) => callback());

      // Verify we cannot register a duplicate
      assert.throws(() => {
        PrincipalsAPI.registerFullUserProfileDecorator(testId, (ctx, user, callback) => callback());
      });

      return callback();
    });

    /**
     * Test that verifies the serialization of many different possible types provided by some test decorators
     */
    it('verify various user profile decorator response types', (callback) => {
      const testUndefinedNamespace = TestsUtil.generateRandomText();
      const testNullNamespace = TestsUtil.generateRandomText();
      const testZeroNamespace = TestsUtil.generateRandomText();
      const testEmptyStringNamespace = TestsUtil.generateRandomText();
      const testFalseNamespace = TestsUtil.generateRandomText();
      const testErrorNamespace = TestsUtil.generateRandomText();

      PrincipalsAPI.registerFullUserProfileDecorator(testUndefinedNamespace, (ctx, user, callback) => callback());
      PrincipalsAPI.registerFullUserProfileDecorator(testNullNamespace, (ctx, user, callback) => callback(null, null));
      PrincipalsAPI.registerFullUserProfileDecorator(testZeroNamespace, (ctx, user, callback) => callback(null, 0));
      PrincipalsAPI.registerFullUserProfileDecorator(testEmptyStringNamespace, (ctx, user, callback) =>
        callback(null, '')
      );
      PrincipalsAPI.registerFullUserProfileDecorator(testFalseNamespace, (ctx, user, callback) =>
        callback(null, false)
      );
      PrincipalsAPI.registerFullUserProfileDecorator(testErrorNamespace, (ctx, user, callback) =>
        callback({ code: 500, msg: 'Expected' })
      );

      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        RestAPI.User.getUser(user.restContext, user.user.id, (error, userProfile) => {
          assert.notExists(error);

          assert.notInclude(keys(userProfile), testUndefinedNamespace);
          assert.notInclude(keys(userProfile), testErrorNamespace);

          // Ensure all the others return exactly as-is
          assert.strictEqual(userProfile[testNullNamespace], null);
          assert.strictEqual(userProfile[testZeroNamespace], 0);
          assert.strictEqual(userProfile[testEmptyStringNamespace], '');
          assert.strictEqual(userProfile[testFalseNamespace], false);
          return callback();
        });
      });
    });

    /**
     * Test that verifies a user profile decorator cannot override existing properties
     */
    it('verify a user profile decorator cannot overwrite existing user properties', (callback) => {
      PrincipalsAPI.registerFullUserProfileDecorator('visibility', (ctx, user, callback) => {
        // Try setting the user visibility on the fly
        user.visibility = 'loggedin';

        // Try setting the user visibility VIA using the 'visibility' property as the namespace of our decorator
        return callback(null, 'private');
      });

      // Create a public user to test with
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        // Verify the visibility of the user is still public
        RestAPI.User.getUser(user.restContext, user.user.id, (error, user) => {
          assert.notExists(error);
          assert.strictEqual(user.visibility, 'public');
          return callback();
        });
      });
    });
  });

  describe('Create user', () => {
    /**
     * Test that verifies that recaptcha is bypassed when a valid invitation token is specified
     */
    it('verify recaptcha is bypassed with valid invitation token', (callback) => {
      // Create a tenant with recaptcha enabled and clear up any pending emails
      TestsUtil.setupMultiTenantPrivacyEntities((tenant) => {
        ConfigTestUtil.updateConfigAndWait(
          tenant.adminRestContext,
          null,
          { 'oae-principals/recaptcha/enabled': true },
          (error) => {
            assert.notExists(error);
            EmailTestUtil.collectAndFetchAllEmails(() => {
              const email = TestsUtil.generateTestEmailAddress(null, tenant.tenant.emailDomains[0]);
              const profile = {
                username: TestsUtil.generateTestUserId(),
                password: 'password',
                displayName: TestsUtil.generateRandomText(),
                email
              };

              // Ensure a user creating an account without an invitation token results in 400
              PrincipalsTestUtil.assertCreateUserFails(tenant.anonymousRestContext, profile, 400, () => {
                // Perform a create request with a token that does not map to any existing invitaion token, ensuring it fails
                PrincipalsTestUtil.assertCreateUserFails(tenant.anonymousRestContext, profile, 400, () => {
                  // Generate an invitation token for the email address
                  AuthzInvitationsDAO.getOrCreateTokensByEmails([email], (error, emailTokens) => {
                    assert.notExists(error);

                    // Perform the same request, but with a valid invitation token,
                    // which should create the user and not send an email
                    // verification (because the token email matches the specified
                    // email)
                    const profileWithValidToken = mergeRight(profile, {
                      invitationToken: emailTokens[email]
                    });
                    PrincipalsTestUtil.assertCreateUserSucceeds(
                      tenant.anonymousRestContext,
                      profileWithValidToken,
                      (user, token) => {
                        assert.ok(user);
                        assert.strictEqual(user.email, email.toLowerCase());
                        assert.ok(!token);

                        // Ensure no verification email was sent since we had a verification token
                        EmailTestUtil.collectAndFetchAllEmails((/* messages */) => callback());
                      }
                    );
                  });
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that it should only be possible to create a user if there are valid reCaptcha tokens present or the current user is an admin
     */
    it('verify create user', (callback) => {
      // Try to create a user as an anonymous user with no reCaptcha tokens
      const recaptchaTenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const host = TenantsTestUtil.generateTestTenantHost();

      // Verify recaptcha token is needed when feature is enabled
      TenantsTestUtil.createTenantAndWait(
        asGlobalAdmin,
        recaptchaTenantAlias,
        recaptchaTenantAlias,
        host,
        null,
        (error, recaptchaTenant) => {
          assert.notExists(error);

          // Enable recaptcha for this tenant
          ConfigTestUtil.updateConfigAndWait(
            asGlobalAdmin,
            recaptchaTenantAlias,
            { 'oae-principals/recaptcha/enabled': true },
            (error_) => {
              assert.notExists(error_);

              const parameters = {
                username: TestsUtil.generateTestUserId(),
                email: TestsUtil.generateTestEmailAddress(null, recaptchaTenant.emailDomains[0]),
                password: 'password',
                displayName: 'Test User',
                visibility: 'public'
              };
              const recaptchaAnonymousRestContext = TestsUtil.createTenantRestContext(host);
              PrincipalsTestUtil.assertCreateUserFails(recaptchaAnonymousRestContext, parameters, 400, () => {
                parameters.email = TestsUtil.generateTestEmailAddress(
                  null,
                  global.oaeTests.tenants.cam.emailDomains[0]
                );
                PrincipalsTestUtil.assertCreateUserSucceeds(asCambridgeTenantAdmin, parameters, (createdUser) => {
                  assert.ok(createdUser);
                  assert.strictEqual(createdUser.displayName, 'Test User');
                  assert.strictEqual(createdUser.publicAlias, 'Test User');
                  assert.strictEqual(createdUser.visibility, 'public');
                  assert.strictEqual(createdUser.resourceType, 'user');
                  assert.strictEqual(createdUser.email, parameters.email.toLowerCase());
                  assert.strictEqual(
                    createdUser.profilePath,
                    '/user/' + createdUser.tenant.alias + '/' + AuthzUtil.getResourceFromId(createdUser.id).resourceId
                  );
                  const userRestContext = TestsUtil.createTenantRestContext(
                    global.oaeTests.tenants.cam.host,
                    parameters.username,
                    parameters.password
                  );

                  // Try creating a user with the same username, which should fail
                  parameters.email = TestsUtil.generateTestEmailAddress(null, recaptchaTenant.emailDomains[0]);
                  PrincipalsTestUtil.assertCreateUserFails(recaptchaAnonymousRestContext, parameters, 400, () => {
                    // Try creating a new user as the created user
                    parameters.username = TestsUtil.generateTestUserId();
                    parameters.email = TestsUtil.generateTestEmailAddress(
                      null,
                      global.oaeTests.tenants.cam.emailDomains[0]
                    );
                    PrincipalsTestUtil.assertCreateUserFails(userRestContext, parameters, 401, () => {
                      // We promote the created user to be a tenant admin
                      RestAPI.User.setTenantAdmin(asGlobalAdmin, createdUser.id, true, (error__) => {
                        assert.notExists(error__);

                        // Try creating the user again
                        PrincipalsTestUtil.assertCreateUserSucceeds(userRestContext, parameters, (/* userObj */) => {
                          // Create a user on a tenant as the global administrator
                          let newUsername = TestsUtil.generateTestUserId();
                          const email3 = TestsUtil.generateTestEmailAddress(
                            null,
                            global.oaeTests.tenants.cam.emailDomains[0]
                          );
                          RestAPI.User.createUserOnTenant(
                            asGlobalAdmin,
                            global.oaeTests.tenants.cam.alias,
                            newUsername,
                            'password',
                            'Test User',
                            email3,
                            { visibility: 'public' },
                            (error, userObject) => {
                              assert.notExists(error);
                              assert.ok(userObject);
                              assert.strictEqual(userObject.displayName, 'Test User');
                              assert.strictEqual(userObject.publicAlias, 'Test User');
                              assert.strictEqual(userObject.visibility, 'public');
                              assert.strictEqual(userObject.resourceType, 'user');
                              assert.strictEqual(
                                userObject.profilePath,
                                '/user/' +
                                  userObject.tenant.alias +
                                  '/' +
                                  AuthzUtil.getResourceFromId(userObject.id).resourceId
                              );

                              // Create a user on the global tenant as the global administrator
                              newUsername = TestsUtil.generateTestUserId();
                              const email4 = TestsUtil.generateTestEmailAddress(
                                null,
                                global.oaeTests.tenants.cam.emailDomains[0]
                              );
                              RestAPI.User.createUserOnTenant(
                                asGlobalAdmin,
                                global.oaeTests.tenants.cam.alias,
                                newUsername,
                                'password',
                                'Test User',
                                email4,
                                { visibility: 'public' },
                                (error, userObject) => {
                                  assert.notExists(error);
                                  assert.ok(userObject);

                                  // Verify we cannot create a user on the global admin tenant as an anonymous user
                                  newUsername = TestsUtil.generateTestUserId();
                                  const email5 = TestsUtil.generateTestEmailAddress();
                                  RestAPI.User.createUserOnTenant(
                                    asGlobalAnonymous,
                                    'admin',
                                    newUsername,
                                    'password',
                                    'Test User',
                                    email5,
                                    {},
                                    (error /* , userObj */) => {
                                      assert.ok(error);
                                      assert.strictEqual(error.code, 401);

                                      // Verify we cannot create a user on another tenant as global admin anonymous user
                                      const email6 = TestsUtil.generateTestEmailAddress(
                                        null,
                                        global.oaeTests.tenants.cam.emailDomains[0]
                                      );
                                      RestAPI.User.createUserOnTenant(
                                        asGlobalAnonymous,
                                        global.oaeTests.tenants.cam.alias,
                                        newUsername,
                                        'password',
                                        'Test User',
                                        email6,
                                        {},
                                        (error /* , userObj */) => {
                                          assert.ok(error);
                                          assert.strictEqual(error.code, 401);

                                          /**
                                           * Verify we cannot create a user on another tenant as a tenant admin.
                                           * We check for a 404 because at the moment there is no such endpoint bound to the user tenan
                                           */
                                          newUsername = TestsUtil.generateTestUserId();
                                          const email7 = TestsUtil.generateTestEmailAddress(
                                            null,
                                            global.oaeTests.tenants.gt.emailDomains[0]
                                          );
                                          RestAPI.User.createUserOnTenant(
                                            asCambridgeTenantAdmin,
                                            global.oaeTests.tenants.gt.alias,
                                            newUsername,
                                            'password',
                                            'Test User',
                                            email7,
                                            { visibility: 'public' },
                                            (error /* , userObj */) => {
                                              assert.ok(error);
                                              assert.strictEqual(error.code, 404);
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
                    });
                  });
                });
              });
            }
          );
        }
      );
    });

    /**
     * Test that verifies that emails belong to the configured tenant's email domain
     */
    it("verify the email address has to belong to the configured tenant's email domain when creating a local user", (callback) => {
      // Create a tenant but don't configure an email domain yet
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      TenantsTestUtil.createTenantAndWait(asGlobalAdmin, tenantAlias, tenantAlias, tenantHost, {}, (error) => {
        assert.notExists(error);

        // Disable reCaptcha
        ConfigTestUtil.updateConfigAndWait(
          asGlobalAdmin,
          tenantAlias,
          { 'oae-principals/recaptcha/enabled': false },
          (error) => {
            assert.notExists(error);

            const emailDomain1 = tenantHost;
            const emailDomain2 = TenantsTestUtil.generateTestTenantHost();

            // Verify accounts can be created for any email domain
            _verifyCreateUserWithEmailDomain(tenantHost, emailDomain1, () => {
              _verifyCreateUserWithEmailDomain(tenantHost, emailDomain2, () => {
                // Configure the tenant with an email domain
                RestAPI.Tenants.updateTenant(asGlobalAdmin, tenantAlias, { emailDomains: [emailDomain1] }, (error) => {
                  assert.notExists(error);

                  // Only user accounts with an email that belongs to the configured email domain can be created
                  _verifyCreateUserWithEmailDomain(tenantHost, emailDomain1, () => {
                    _verifyCreateUserWithEmailDomainFails(tenantHost, emailDomain2, () => callback());
                  });
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that administrators can create user accounts with an email address
     * that does not match the configured email domain
     */
    it('verify administrators can create user accounts with an email address that does not match the configured email domain', (callback) => {
      // Create a tenant but don't configure an email domain yet
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(tenantAlias, tenantHost, (error, tenant, tenantAdminRestContext) => {
        assert.notExists(error);

        const emailDomain = tenantHost;

        // Verify a tenant administrator can create a user with an email address that does
        // not match the tenant's configured email domain
        const parameters = {
          username: TestsUtil.generateTestUserId(),
          password: 'password',
          displayName: 'displayName',
          email: TestsUtil.generateTestEmailAddress()
        };
        PrincipalsTestUtil.assertCreateUserSucceeds(tenantAdminRestContext, parameters, () => {
          // Verify a tenant administrator can create a user with an email address that
          // does match the tenant's configured email domain
          const parameters = {
            username: TestsUtil.generateTestUserId(),
            password: 'password',
            displayName: 'displayName',
            email: TestsUtil.generateTestEmailAddress(null, emailDomain)
          };
          PrincipalsTestUtil.assertCreateUserSucceeds(tenantAdminRestContext, parameters, () => callback());
        });
      });
    });

    /**
     * Verify a user can be created with an email that belongs to a given email domain
     *
     * @param  {String}         tenantHost          The host of the tenant to create the user on
     * @param  {String}         emailDomain         The email domain that the new user's email should belong to
     * @param  {Function}       callback            Standard callback function
     * @api private
     */
    const _verifyCreateUserWithEmailDomain = function (tenantHost, emailDomain, callback) {
      const restContext = TestsUtil.createTenantRestContext(tenantHost);
      const parameters = {
        username: TestsUtil.generateTestUserId(),
        password: 'password',
        displayName: 'displayName',
        email: TestsUtil.generateTestEmailAddress(null, emailDomain)
      };
      return PrincipalsTestUtil.assertCreateUserSucceeds(restContext, parameters, callback);
    };

    /**
     * Verify a user cannot be created with an email that belongs to a given email domain
     *
     * @param  {String}         tenantHost          The host of the tenant to create the user on
     * @param  {String}         emailDomain         The email domain that the new user's email should belong to
     * @param  {Function}       callback            Standard callback function
     * @api private
     */
    const _verifyCreateUserWithEmailDomainFails = function (tenantHost, emailDomain, callback) {
      const restContext = TestsUtil.createTenantRestContext(tenantHost);
      const parameters = {
        username: TestsUtil.generateTestUserId(),
        password: 'password',
        displayName: 'displayName',
        email: TestsUtil.generateTestEmailAddress(null, emailDomain)
      };
      return PrincipalsTestUtil.assertCreateUserFails(restContext, parameters, 400, callback);
    };

    /**
     * Test that verifies that the default tenant user visibility is used when creating a user without a visibility
     */
    it('verify user visibility defaults to the tenant default when created', (callback) => {
      const camTenantAlias = global.oaeTests.tenants.cam.alias;

      // Create a user to ensure the default user visibility of the tenant starts as public
      const email1 = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      RestAPI.User.createUser(
        asCambridgeTenantAdmin,
        TestsUtil.generateTestUserId(),
        'password',
        'Bart',
        email1,
        {},
        (error, createdUser) => {
          assert.notExists(error);
          assert.strictEqual(createdUser.visibility, 'public');

          // Change the default user visibility of the tenant to loggedin
          ConfigTestUtil.updateConfigAndWait(
            asGlobalAdmin,
            camTenantAlias,
            { 'oae-principals/user/visibility': 'loggedin' },
            (error_) => {
              assert.notExists(error_);

              // Create a user to ensure its visibility defaults to loggedin
              const email2 = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
              RestAPI.User.createUser(
                asCambridgeTenantAdmin,
                TestsUtil.generateTestUserId(),
                'password',
                'Lisa',
                email2,
                {},
                (error, createdUser) => {
                  assert.notExists(error);
                  assert.strictEqual(createdUser.visibility, 'loggedin');

                  // Reset the default user visibility of the tenant back to the global default
                  ConfigTestUtil.clearConfigAndWait(
                    asGlobalAdmin,
                    camTenantAlias,
                    ['oae-principals/user/visibility'],
                    (error_) => {
                      assert.notExists(error_);

                      // Ensure a user's visibility can be overridden when they are created
                      const email3 = TestsUtil.generateTestEmailAddress(
                        null,
                        global.oaeTests.tenants.cam.emailDomains[0]
                      );
                      RestAPI.User.createUser(
                        asCambridgeTenantAdmin,
                        TestsUtil.generateTestUserId(),
                        'password',
                        'Homer',
                        email3,
                        { visibility: 'private' },
                        (error, createdUser) => {
                          assert.notExists(error);
                          assert.strictEqual(createdUser.visibility, 'private');
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

    /**
     * Test that verifies that the default tenant user email preference is used when creating a user without an email preference
     */
    it('verify email preference defaults to the tenant default when created', (callback) => {
      const camTenantAlias = global.oaeTests.tenants.cam.alias;

      // Create a user to ensure the default user email preference of the tenant starts as immediate
      const email1 = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      RestAPI.User.createUser(
        asCambridgeTenantAdmin,
        TestsUtil.generateTestUserId(),
        'password',
        'Bert',
        email1,
        {},
        (error, createdUser) => {
          assert.notExists(error);
          assert.strictEqual(createdUser.emailPreference, 'immediate');

          // Change the default user email preference of the tenant to weekly
          ConfigTestUtil.updateConfigAndWait(
            asGlobalAdmin,
            camTenantAlias,
            { 'oae-principals/user/emailPreference': 'weekly' },
            (error_) => {
              assert.notExists(error_);

              // Create a user to ensure its email preference defaults to weekly
              const email2 = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
              RestAPI.User.createUser(
                asCambridgeTenantAdmin,
                TestsUtil.generateTestUserId(),
                'password',
                'Lisa',
                email2,
                {},
                (error, createdUser) => {
                  assert.notExists(error);
                  assert.strictEqual(createdUser.emailPreference, 'weekly');

                  // Reset the default user email preference of the tenant back to the global default
                  ConfigTestUtil.clearConfigAndWait(
                    asGlobalAdmin,
                    camTenantAlias,
                    ['oae-principals/user/emailPreference'],
                    (error_) => {
                      assert.notExists(error_);

                      // Ensure a user's email preference can be overridden when they are created
                      const email3 = TestsUtil.generateTestEmailAddress(
                        null,
                        global.oaeTests.tenants.cam.emailDomains[0]
                      );
                      RestAPI.User.createUser(
                        asCambridgeTenantAdmin,
                        TestsUtil.generateTestUserId(),
                        'password',
                        'Homer',
                        email3,
                        { emailPreference: 'daily' },
                        (error, createdUser) => {
                          assert.notExists(error);
                          assert.strictEqual(createdUser.emailPreference, 'daily');
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

    /**
     * Test that verifies that users their usernames get lowercased.
     * See https://github.com/oaeproject/Hilary/issues/594
     */
    it('verify lowercasing of usernames', (callback) => {
      const username = TestsUtil.generateTestUserId() + 'Aa';
      const lowerCasedUsername = username.toLowerCase();
      const upperCasedUsername = username.toUpperCase();

      const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      RestAPI.User.createUser(
        asCambridgeTenantAdmin,
        username,
        'password',
        'Test User',
        email,
        {},
        (error, createdUser) => {
          assert.notExists(error);

          // Verify we cannot create another user account where the username only differs in the casing
          const email2 = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
          RestAPI.User.createUser(
            asCambridgeTenantAdmin,
            lowerCasedUsername,
            'password',
            'Test User',
            email2,
            {},
            (error_) => {
              assert.strictEqual(error_.code, 400);
              RestAPI.User.createUser(
                asCambridgeTenantAdmin,
                upperCasedUsername,
                'password',
                'Test User',
                email2,
                {},
                (error_) => {
                  assert.strictEqual(error_.code, 400);

                  // When logging in with the same username but in lower case we should succesfully log in
                  const userRestContext = TestsUtil.createTenantRestContext(
                    global.oaeTests.tenants.cam.host,
                    lowerCasedUsername,
                    'password'
                  );
                  RestAPI.Authentication.login(userRestContext, lowerCasedUsername, 'password', (error_) => {
                    assert.notExists(error_);
                    RestAPI.User.getMe(userRestContext, (error, meData) => {
                      assert.notExists(error);
                      assert.strictEqual(meData.id, createdUser.id);

                      // When logging in with the same username but in upper case we should succesfully log in
                      const userRestContext = TestsUtil.createTenantRestContext(
                        global.oaeTests.tenants.cam.host,
                        upperCasedUsername,
                        'password'
                      );
                      RestAPI.Authentication.login(userRestContext, upperCasedUsername, 'password', (error_) => {
                        assert.notExists(error_);
                        RestAPI.User.getMe(userRestContext, (error, meData) => {
                          assert.notExists(error);
                          assert.strictEqual(meData.id, createdUser.id);
                          callback();
                        });
                      });
                    });
                  });
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies that users created without a locale get the default tenant locale
     */
    it('verify user gets default locale', (callback) => {
      const userId1 = TestsUtil.generateTestUserId();
      const userId2 = TestsUtil.generateTestUserId();
      const userId3 = TestsUtil.generateTestUserId();

      // Create user without locale
      const email1 = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      RestAPI.User.createUser(
        asCambridgeTenantAdmin,
        userId1,
        'password',
        'Test User 1',
        email1,
        {},
        (error, createdUser1) => {
          assert.notExists(error);
          assert.ok(createdUser1);
          // Check that the user has been given the default locale
          assert.strictEqual(createdUser1.locale, 'en_GB');

          // Set default language to Spanish
          ConfigTestUtil.updateConfigAndWait(
            asGlobalAdmin,
            global.oaeTests.tenants.cam.alias,
            { 'oae-principals/user/defaultLanguage': 'es_ES' },
            (error_) => {
              assert.notExists(error_);

              // Create user without locale
              const email2 = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
              RestAPI.User.createUser(
                asCambridgeTenantAdmin,
                userId2,
                'password',
                'Test User 2',
                email2,
                {},
                (error, createdUser2) => {
                  assert.notExists(error);
                  assert.ok(createdUser2);
                  // Check that the user has been given the new default locale
                  assert.strictEqual(createdUser2.locale, 'es_ES');

                  // Create a user with no locale, but using an Accept-Language header
                  const acceptLanguageRestContext = new RestContext('http://localhost:2001', {
                    hostHeader: global.oaeTests.tenants.cam.host,
                    additionalHeaders: { 'Accept-Language': 'en-us' }
                  });
                  ConfigTestUtil.updateConfigAndWait(
                    asCambridgeTenantAdmin,
                    null,
                    { 'oae-principals/recaptcha/enabled': false },
                    (error_) => {
                      assert.notExists(error_);

                      const email3 = TestsUtil.generateTestEmailAddress(
                        null,
                        global.oaeTests.tenants.cam.emailDomains[0]
                      );
                      RestAPI.User.createUser(
                        acceptLanguageRestContext,
                        userId3,
                        'password',
                        'Test User 3',
                        email3,
                        {},
                        (error, createdUser3) => {
                          assert.notExists(error);
                          assert.ok(createdUser3);
                          assert.strictEqual(createdUser3.locale, 'en_US');

                          ConfigTestUtil.clearConfigAndWait(
                            asCambridgeTenantAdmin,
                            null,
                            ['oae-principals/recaptcha/enabled'],
                            (error_) => {
                              assert.notExists(error_);
                              // Check that the first user still has the old default locale
                              RestAPI.User.getUser(asCambridgeTenantAdmin, createdUser1.id, (error, user) => {
                                assert.notExists(error);
                                assert.ok(user);
                                assert.strictEqual(user.locale, 'en_GB');

                                // Set default language to British English again
                                ConfigTestUtil.updateConfigAndWait(
                                  asGlobalAdmin,
                                  global.oaeTests.tenants.cam.alias,
                                  { 'oae-principals/user/defaultLanguage': 'en_GB' },
                                  (error_) => {
                                    assert.notExists(error_);

                                    // Check that the second user still has the Spanish locale
                                    RestAPI.User.getUser(asCambridgeTenantAdmin, createdUser2.id, (error, user) => {
                                      assert.notExists(error);
                                      assert.ok(user);
                                      assert.strictEqual(user.locale, 'es_ES');
                                      callback();
                                    });
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
    });

    /**
     * Test that verifies that anonymous users with accept-language headers get a
     * locale in the me feed
     */
    it('verify anonymous locale', (callback) => {
      const acceptLanguageRestContext = new RestContext('http://localhost:2001', {
        hostHeader: global.oaeTests.tenants.cam.host,
        additionalHeaders: { 'Accept-Language': 'en-us' }
      });
      RestAPI.User.getMe(acceptLanguageRestContext, (error, meData) => {
        assert.notExists(error);
        assert.ok(meData.anon);
        assert.strictEqual(meData.locale, 'en_US');

        // This guy prefers US English but will take Spanish if that's all we have
        const acceptLanguageRestContext = new RestContext('http://localhost:2001', {
          hostHeader: global.oaeTests.tenants.cam.host,
          additionalHeaders: { 'Accept-Language': 'es-es;q=0.5, en-us' }
        });
        RestAPI.User.getMe(acceptLanguageRestContext, (error, meData) => {
          assert.notExists(error);
          assert.ok(meData.anon);
          assert.strictEqual(meData.locale, 'en_US');

          // If you just say a language without specifying the country we'll give you some form of that language
          const acceptLanguageRestContext = new RestContext('http://localhost:2001', {
            hostHeader: global.oaeTests.tenants.cam.host,
            additionalHeaders: { 'Accept-Language': 'en' }
          });
          RestAPI.User.getMe(acceptLanguageRestContext, (error, meData) => {
            assert.notExists(error);
            assert.ok(meData.anon);
            assert.strictEqual(meData.locale.slice(0, 2), 'en');

            // Make sure polyglots serve the most preferred language
            // @see https://github.com/oaeproject/Hilary/pull/862
            const acceptLanguageRestContext = new RestContext('http://localhost:2001', {
              hostHeader: global.oaeTests.tenants.cam.host,
              additionalHeaders: {
                'Accept-Language':
                  'en-US,en;q=0.93,es-ES;q=0.87,es;q=0.80,it-IT;q=0.73,it;q=0.67,de-DE;q=0.60,de;q=0.53,fr-FR;q=0.47,fr;q=0.40,ja;q=0.33,zh-Hans-CN;q=0.27,zh-Hans;q=0.20,ar-SA;q=0.13,ar;q=0.067'
              }
            });
            RestAPI.User.getMe(acceptLanguageRestContext, (error, meData) => {
              assert.notExists(error);
              assert.ok(meData.anon);
              assert.strictEqual(meData.locale, 'en_US');

              // If the user only speaks a language that we don't support, the me object will indicate
              // that the user has no language preference
              const acceptLanguageRestContext = new RestContext('http://localhost:2001', {
                hostHeader: global.oaeTests.tenants.cam.host,
                additionalHeaders: { 'Accept-Language': 'qq-ZZ' }
              });
              RestAPI.User.getMe(acceptLanguageRestContext, (error, meData) => {
                assert.notExists(error);
                assert.ok(meData.anon);
                assert.ok(!meData.locale);

                // If the user only speaks languages that we don't support, the me object will indicate
                // that the user has no language preference
                const acceptLanguageRestContext = new RestContext('http://localhost:2001', {
                  hostHeader: global.oaeTests.tenants.cam.host,
                  additionalHeaders: { 'Accept-Language': 'qq-ZZ, zz-ZZ;q=0.50, qq-QQ;q=0.30' }
                });
                RestAPI.User.getMe(acceptLanguageRestContext, (error, meData) => {
                  assert.notExists(error);
                  assert.ok(meData.anon);
                  assert.ok(!meData.locale);

                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that validation on user creation is done appropriately
     */
    it('verify validation', (callback) => {
      const userId = TestsUtil.generateTestUserId();
      const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);

      // Create user with no user id
      RestAPI.User.createUser(asCambridgeTenantAdmin, null, 'password', 'Test User', email, {}, (error, userObject) => {
        assert.ok(error);
        assert.ok(!userObject);

        // Create user with empty password
        RestAPI.User.createUser(asCambridgeTenantAdmin, userId, null, 'Test User', email, {}, (error, userObject) => {
          assert.ok(error);
          assert.ok(!userObject);

          // Create user with short password
          RestAPI.User.createUser(
            asCambridgeTenantAdmin,
            userId,
            'short',
            'Test User',
            email,
            {},
            (error, userObject) => {
              assert.ok(error);
              assert.ok(!userObject);

              // Create user with no display name
              RestAPI.User.createUser(
                asCambridgeTenantAdmin,
                userId,
                'password',
                null,
                email,
                {},
                (error, userObject) => {
                  assert.ok(error);
                  assert.ok(!userObject);

                  // Create user with unkown visibility setting
                  RestAPI.User.createUser(
                    asCambridgeTenantAdmin,
                    userId,
                    'password',
                    'Test User',
                    email,
                    { visibility: 'unknown' },
                    (error, userObject) => {
                      assert.ok(error);
                      assert.ok(!userObject);

                      // Create user with displayName that is longer than the maximum allowed size
                      const longDisplayName = TestsUtil.generateRandomText(100);
                      RestAPI.User.createUser(
                        asCambridgeTenantAdmin,
                        userId,
                        'password',
                        longDisplayName,
                        email,
                        {},
                        (error /* , userObj */) => {
                          assert.ok(error);
                          assert.strictEqual(error.code, 400);

                          // Create a user with no email address
                          RestAPI.User.createUser(
                            asCambridgeTenantAdmin,
                            userId,
                            'password',
                            'Test user',
                            null,
                            {},
                            (error /* , userObj */) => {
                              assert.ok(error);
                              assert.strictEqual(error.code, 400);

                              // Create a user with an invalid email address
                              RestAPI.User.createUser(
                                asCambridgeTenantAdmin,
                                userId,
                                'password',
                                'Test user',
                                'not an email address',
                                {},
                                (error /* , userObj */) => {
                                  assert.ok(error);
                                  assert.strictEqual(error.code, 400);
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
    });
  });

  describe('Import users', () => {
    /**
     * Return a function that gets a stream to a file in the 'data' directory of the current test directory
     *
     * @param  {String}     filename    The name of the file in the test data directory to be loaded
     * @return {Function}               A function that, when executed without parameters, returns a stream to the file in the test data directory with the provided filename
     */
    const getDataFileStream = function (filename) {
      return function () {
        return fs.createReadStream(format('%s/data/%s', __dirname, filename));
      };
    };

    /**
     * Verify that a user object matches its expected content
     *
     * @param  {Object}       err                  An error object, if truthy this user will be considered invalid
     * @param  {User}         meObj                The user me object to verify
     * @param  {String}       expectedDisplayName  The displayName the meObj is expected to contain
     * @param  {String}       expectedPublicAlias  The public alias the meObj is expected to contain
     * @param  {String}       expectedEmail        The email address the meObj is expected to contain
     * @api private
     */
    const _verifyUser = function (error, meObject, expectedDisplayName, expectedPublicAlias, expectedEmail) {
      assert.notExists(error);
      assert.ok(meObject);
      assert.strictEqual(meObject.displayName, expectedDisplayName);
      assert.strictEqual(meObject.publicAlias, expectedPublicAlias);
      assert.strictEqual(meObject.email, expectedEmail);
    };

    /*!
     * Test that verifies that a CSV user file can be imported using a local authentication strategy and that a user's
     * display name will be overridden when the account already exists and the display name is the same as the user's
     * external id
     */
    it('verify import local users and display name override', (callback) => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = 'displayname.import.tests.com';
      TestsUtil.createTenantWithAdmin(tenantAlias, tenantHost, (error, tenant, tenantAdminRestContext) => {
        assert.notExists(error);

        // Import users as a global admin using a local authentication strategy
        PrincipalsTestUtil.importUsers(
          asGlobalAdmin,
          tenant.alias,
          getDataFileStream('users-with-password-displayname.csv'),
          'local',
          null,
          (error_) => {
            assert.notExists(error_);

            // Verify that all imported users have been created
            // First user in the csv
            const nicolaasRestContext = TestsUtil.createTenantRestContext(tenant.host, 'user-zfdHliPLa', 'password1');
            RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
              _verifyUser(
                error,
                nicolaasMeObject,
                'Nicolaas Matthijs',
                'Nicolaas Matthijs',
                'nicolaas@displayname.import.tests.com'
              );

              // User with missing first name
              const simonRestContext = TestsUtil.createTenantRestContext(tenant.host, 'user-HlKKreaDP', 'password4');
              RestAPI.User.getMe(simonRestContext, (error, simonMeObject) => {
                _verifyUser(error, simonMeObject, 'Gaeremynck', 'Gaeremynck', 'simon@displayname.import.tests.com');

                // User with more complex display name
                const stuartRestContext = TestsUtil.createTenantRestContext(tenant.host, 'user-IrewPDSAw', 'password5');
                RestAPI.User.getMe(stuartRestContext, (error, stuartMeObject) => {
                  _verifyUser(
                    error,
                    stuartMeObject,
                    'Stuart D. Freeman',
                    'Stuart D. Freeman',
                    'stuart@displayname.import.tests.com'
                  );

                  // Last user in the csv
                  const stephenRestContext = TestsUtil.createTenantRestContext(
                    tenant.host,
                    'user-bbLwAWxpd',
                    'password26'
                  );
                  RestAPI.User.getMe(stephenRestContext, (error, stephenMeObject) => {
                    _verifyUser(
                      error,
                      stephenMeObject,
                      'Stephen Thomas',
                      'Stephen Thomas',
                      'stephen@displayname.import.tests.com'
                    );

                    // Update a user's display name to be the same as its external id
                    RestAPI.User.updateUser(
                      nicolaasRestContext,
                      nicolaasMeObject.id,
                      { displayName: 'user-zfdHliPLa' },
                      (error, user) => {
                        assert.notExists(error);
                        assert.ok(user);
                        assert.strictEqual(user.id, nicolaasMeObject.id);
                        assert.strictEqual(user.displayName, 'user-zfdHliPLa');

                        // Verify that the update is reflected in the me feed
                        RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                          _verifyUser(
                            error,
                            nicolaasMeObject,
                            'user-zfdHliPLa',
                            'Nicolaas Matthijs',
                            'nicolaas@displayname.import.tests.com'
                          );

                          // Re-import the users to verify that the displayName is reverted back to the display name
                          // provided in the CSV file. This time, the import is attempted as a tenant admin
                          PrincipalsTestUtil.importUsers(
                            tenantAdminRestContext,
                            null,
                            getDataFileStream('users-with-password-displayname.csv'),
                            'local',
                            null,
                            (error_) => {
                              assert.notExists(error_);

                              // Verify that the display name is correctly reverted
                              RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                                _verifyUser(
                                  error,
                                  nicolaasMeObject,
                                  'Nicolaas Matthijs',
                                  'Nicolaas Matthijs',
                                  'nicolaas@displayname.import.tests.com'
                                );

                                // Update the user's display name to a different real display name
                                RestAPI.User.updateUser(
                                  nicolaasRestContext,
                                  nicolaasMeObject.id,
                                  { displayName: 'N. Matthijs' },
                                  (error, user) => {
                                    assert.notExists(error);
                                    assert.ok(user);
                                    assert.strictEqual(user.id, nicolaasMeObject.id);
                                    assert.strictEqual(user.displayName, 'N. Matthijs');

                                    // Verify that the update is reflected in the me feed
                                    RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                                      _verifyUser(
                                        error,
                                        nicolaasMeObject,
                                        'N. Matthijs',
                                        'Nicolaas Matthijs',
                                        'nicolaas@displayname.import.tests.com'
                                      );

                                      // Re-import the users as a tenant admin to verify that the displayName is not reverted
                                      // back to the display name provided in the CSV file
                                      PrincipalsTestUtil.importUsers(
                                        tenantAdminRestContext,
                                        null,
                                        getDataFileStream('users-with-password-displayname.csv'),
                                        'local',
                                        null,
                                        (error_) => {
                                          assert.notExists(error_);

                                          // Verify that the display name has not been reverted
                                          RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                                            _verifyUser(
                                              error,
                                              nicolaasMeObject,
                                              'N. Matthijs',
                                              'Nicolaas Matthijs',
                                              'nicolaas@displayname.import.tests.com'
                                            );

                                            // Re-import the users using the `forceProfileUpdate` flag to verify that the displayName is reverted to
                                            // the display name provided in the CSV file
                                            PrincipalsTestUtil.importUsers(
                                              tenantAdminRestContext,
                                              null,
                                              getDataFileStream('users-with-password-displayname.csv'),
                                              'local',
                                              true,
                                              (error_) => {
                                                assert.notExists(error_);

                                                // Verify that the display name is correctly reverted
                                                RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                                                  _verifyUser(
                                                    error,
                                                    nicolaasMeObject,
                                                    'Nicolaas Matthijs',
                                                    'Nicolaas Matthijs',
                                                    'nicolaas@displayname.import.tests.com'
                                                  );

                                                  // Update the user's display name to be the same as its external id
                                                  RestAPI.User.updateUser(
                                                    nicolaasRestContext,
                                                    nicolaasMeObject.id,
                                                    { displayName: 'user-zfdHliPLa' },
                                                    (error, user) => {
                                                      assert.notExists(error);
                                                      assert.ok(user);
                                                      assert.strictEqual(user.id, nicolaasMeObject.id);
                                                      assert.strictEqual(user.displayName, 'user-zfdHliPLa');

                                                      // Re-import the users using the `forceProfileUpdate` flag to verify that the displayName is correctly reverted to
                                                      // the display name provided in the CSV file when providing the flag
                                                      PrincipalsTestUtil.importUsers(
                                                        tenantAdminRestContext,
                                                        null,
                                                        getDataFileStream('users-with-password-displayname.csv'),
                                                        'local',
                                                        true,
                                                        (error_) => {
                                                          assert.notExists(error_);

                                                          // Verify that the display name is correctly reverted
                                                          RestAPI.User.getMe(
                                                            nicolaasRestContext,
                                                            (error, nicolaasMeObject) => {
                                                              _verifyUser(
                                                                error,
                                                                nicolaasMeObject,
                                                                'Nicolaas Matthijs',
                                                                'Nicolaas Matthijs',
                                                                'nicolaas@displayname.import.tests.com'
                                                              );
                                                              return callback();
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
                                    });
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
          }
        );
      });
    });

    /*!
     * Test that verifies that a CSV user file can be imported using a local authentication strategy and that a user's
     * email address will be overridden when the account already exists and the email address is not set
     */
    it('verify import local users and email address override', (callback) => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = 'email.test.com';
      TestsUtil.createTenantWithAdmin(tenantAlias, tenantHost, (error, tenant, tenantAdminRestContext) => {
        assert.notExists(error);

        // Import users as a global admin using a local authentication strategy
        PrincipalsTestUtil.importUsers(
          asGlobalAdmin,
          tenant.alias,
          getDataFileStream('users-with-password-email.csv'),
          'local',
          null,
          (error_) => {
            assert.notExists(error_);

            const nicolaasRestContext = TestsUtil.createTenantRestContext(tenant.host, 'user-zfdHliPLa', 'password1');
            RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
              _verifyUser(error, nicolaasMeObject, 'Nicolaas Matthijs', 'Nicolaas Matthijs', 'nicolaas@email.test.com');

              // Update the user's email address to a different real one
              const email = 'nicolaas@my.other.mail.address.com';
              PrincipalsTestUtil.assertUpdateUserSucceeds(
                nicolaasRestContext,
                nicolaasMeObject.id,
                { email },
                (user, token) => {
                  assert.notExists(error);
                  // Verify the email address
                  PrincipalsTestUtil.assertVerifyEmailSucceeds(nicolaasRestContext, nicolaasMeObject.id, token, () => {
                    // Verify that the update is reflected in the me feed
                    RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                      _verifyUser(
                        error,
                        nicolaasMeObject,
                        'Nicolaas Matthijs',
                        'Nicolaas Matthijs',
                        'nicolaas@my.other.mail.address.com'
                      );

                      // Re-import the users as a tenant admin to verify that the email adress is not reverted
                      // back to the email address provided in the CSV file
                      PrincipalsTestUtil.importUsers(
                        tenantAdminRestContext,
                        null,
                        getDataFileStream('users-with-password-email.csv'),
                        'local',
                        null,
                        (error_) => {
                          assert.notExists(error_);

                          // Verify that the email address has not been reverted
                          RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                            _verifyUser(
                              error,
                              nicolaasMeObject,
                              'Nicolaas Matthijs',
                              'Nicolaas Matthijs',
                              'nicolaas@my.other.mail.address.com'
                            );

                            // Re-import the users using the `forceProfileUpdate` flag to verify that the email address is reverted to
                            // the email address provided in the CSV file
                            PrincipalsTestUtil.importUsers(
                              tenantAdminRestContext,
                              null,
                              getDataFileStream('users-with-password-email.csv'),
                              'local',
                              true,
                              (error_) => {
                                assert.notExists(error_);

                                // Verify that the email address is correctly reverted
                                RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                                  _verifyUser(
                                    error,
                                    nicolaasMeObject,
                                    'Nicolaas Matthijs',
                                    'Nicolaas Matthijs',
                                    'nicolaas@email.test.com'
                                  );
                                  return callback();
                                });
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
          }
        );
      });
    });

    /*!
     * Test that verifies that a CSV user file can be imported using a local authentication strategy and that a user's
     * publicAlias will be overridden with the displayname from the CSV file when the account already exists and the publicAlias is not set
     */
    it('verify import local users and public alias override', (callback) => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = 'alias.import.tests.com';
      TestsUtil.createTenantWithAdmin(tenantAlias, tenantHost, (error, tenant, tenantAdminRestContext) => {
        assert.notExists(error);

        // Import users as a global admin using a local authentication strategy
        PrincipalsTestUtil.importUsers(
          asGlobalAdmin,
          tenantAlias,
          getDataFileStream('users-with-password-alias.csv'),
          'local',
          null,
          (error_) => {
            assert.notExists(error_);

            const nicolaasRestContext = TestsUtil.createTenantRestContext(tenantHost, 'user-zfdHliPLa', 'password1');
            RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
              _verifyUser(
                error,
                nicolaasMeObject,
                'Nicolaas Matthijs',
                'Nicolaas Matthijs',
                'nicolaas@alias.import.tests.com'
              );

              // Empty a user's public alias
              RestAPI.User.updateUser(nicolaasRestContext, nicolaasMeObject.id, { publicAlias: '' }, (error, user) => {
                assert.notExists(error);
                assert.ok(user);
                assert.strictEqual(user.id, nicolaasMeObject.id);
                assert.strictEqual(user.publicAlias, '');

                // Verify that the update is reflected in the me feed
                RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                  _verifyUser(error, nicolaasMeObject, 'Nicolaas Matthijs', '', 'nicolaas@alias.import.tests.com');

                  // Re-import the users to verify that the public alias is reverted back to the display name
                  // provided in the CSV file. This time, the import is attempted as a tenant admin
                  PrincipalsTestUtil.importUsers(
                    tenantAdminRestContext,
                    tenantAlias,
                    getDataFileStream('users-with-password-alias.csv'),
                    'local',
                    null,
                    (error_) => {
                      assert.notExists(error_);

                      // Verify that the public alias is correctly reverted
                      RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                        _verifyUser(
                          error,
                          nicolaasMeObject,
                          'Nicolaas Matthijs',
                          'Nicolaas Matthijs',
                          'nicolaas@alias.import.tests.com'
                        );

                        // Update the user's public alias to a different real one
                        RestAPI.User.updateUser(
                          nicolaasRestContext,
                          nicolaasMeObject.id,
                          { publicAlias: 'Nico' },
                          (error, user) => {
                            assert.notExists(error);
                            assert.ok(user);
                            assert.strictEqual(user.id, nicolaasMeObject.id);
                            assert.strictEqual(user.publicAlias, 'Nico');

                            // Verify that the update is reflected in the me feed
                            RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                              _verifyUser(
                                error,
                                nicolaasMeObject,
                                'Nicolaas Matthijs',
                                'Nico',
                                'nicolaas@alias.import.tests.com'
                              );

                              // Re-import the users as a tenant admin to verify that the public alias is not reverted
                              // back to the display name provided in the CSV file
                              PrincipalsTestUtil.importUsers(
                                tenantAdminRestContext,
                                tenantAlias,
                                getDataFileStream('users-with-password-alias.csv'),
                                'local',
                                null,
                                (error_) => {
                                  assert.notExists(error_);

                                  // Verify that the public alias has not been reverted
                                  RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                                    _verifyUser(
                                      error,
                                      nicolaasMeObject,
                                      'Nicolaas Matthijs',
                                      'Nico',
                                      'nicolaas@alias.import.tests.com'
                                    );

                                    // Re-import the users using the `forceProfileUpdate` flag to verify that the public alias is reverted to
                                    // the display name provided in the CSV file
                                    PrincipalsTestUtil.importUsers(
                                      tenantAdminRestContext,
                                      tenantAlias,
                                      getDataFileStream('users-with-password-alias.csv'),
                                      'local',
                                      true,
                                      (error_) => {
                                        assert.notExists(error_);

                                        // Verify that the public alias is correctly reverted
                                        RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                                          _verifyUser(
                                            error,
                                            nicolaasMeObject,
                                            'Nicolaas Matthijs',
                                            'Nicolaas Matthijs',
                                            'nicolaas@alias.import.tests.com'
                                          );

                                          // Empty the user's public alias
                                          RestAPI.User.updateUser(
                                            nicolaasRestContext,
                                            nicolaasMeObject.id,
                                            { publicAlias: '' },
                                            (error, user) => {
                                              assert.notExists(error);
                                              assert.ok(user);
                                              assert.strictEqual(user.id, nicolaasMeObject.id);
                                              assert.strictEqual(user.publicAlias, '');

                                              // Re-import the users using the `forceProfileUpdate` flag to verify that the public alias is correctly reverted to
                                              // the display name provided in the CSV file when providing the flag
                                              PrincipalsTestUtil.importUsers(
                                                tenantAdminRestContext,
                                                tenantAlias,
                                                getDataFileStream('users-with-password-alias.csv'),
                                                'local',
                                                true,
                                                (error_) => {
                                                  assert.notExists(error_);

                                                  // Verify that the public alias is correctly reverted
                                                  RestAPI.User.getMe(nicolaasRestContext, (error, nicolaasMeObject) => {
                                                    _verifyUser(
                                                      error,
                                                      nicolaasMeObject,
                                                      'Nicolaas Matthijs',
                                                      'Nicolaas Matthijs',
                                                      'nicolaas@alias.import.tests.com'
                                                    );
                                                    return callback();
                                                  });
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
                            });
                          }
                        );
                      });
                    }
                  );
                });
              });
            });
          }
        );
      });
    });

    /*!
     * Test that verifies importing a user by CSV respects the default visibility configured for the tenant
     */
    it('verify import local users respects default user visibility of the tenant', (callback) => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = 'users.default.visibility.import.tests.com';
      TestsUtil.createTenantWithAdmin(tenantAlias, tenantHost, (error, tenant /* , tenantAdminRestContext */) => {
        assert.notExists(error);

        // Do a CSV user import to test that the default user visibility of the tenant starts out as public
        PrincipalsTestUtil.importUsers(
          asGlobalAdmin,
          tenant.alias,
          getDataFileStream('users-default-visibility-test1.csv'),
          'local',
          null,
          (error_) => {
            assert.notExists(error_);

            // Ensure the user was created with public visibility
            const mrvisser1RestContext = TestsUtil.createTenantRestContext(
              tenant.host,
              'userdefaultvisibilitytest1',
              'password'
            );
            RestAPI.User.getMe(mrvisser1RestContext, (error, createdUser) => {
              assert.notExists(error);
              assert.strictEqual(createdUser.visibility, 'public');

              // Change the default user visibility of the tenant to loggedin
              ConfigTestUtil.updateConfigAndWait(
                asGlobalAdmin,
                tenant.alias,
                { 'oae-principals/user/visibility': 'loggedin' },
                (error_) => {
                  assert.notExists(error_);

                  // Do a CSV user import to test that the default user visibility of the tenant has changed to loggedin
                  PrincipalsTestUtil.importUsers(
                    asGlobalAdmin,
                    tenant.alias,
                    getDataFileStream('users-default-visibility-test2.csv'),
                    'local',
                    null,
                    (error_) => {
                      assert.notExists(error_);

                      // Ensure the user was created with loggedin visibility
                      const mrvisser2RestContext = TestsUtil.createTenantRestContext(
                        tenant.host,
                        'userdefaultvisibilitytest2',
                        'password'
                      );
                      RestAPI.User.getMe(mrvisser2RestContext, (error, createdUser) => {
                        assert.notExists(error);
                        assert.strictEqual(createdUser.visibility, 'loggedin');

                        // Reset the default visibility of the tenant to the global default
                        ConfigTestUtil.clearConfigAndWait(
                          asGlobalAdmin,
                          tenant.alias,
                          ['oae-principals/user/visibility'],
                          (error_) => {
                            assert.notExists(error_);
                            return callback();
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

    /*!
     * Test that verifies that a CSV user file can be imported using an external authentication strategy
     */
    it('verify import external users', (callback) => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = 'users.without.passwords.import.tests.com';
      TestsUtil.createTenantWithAdmin(tenantAlias, tenantHost, (error, tenant, tenantAdminRestContext) => {
        assert.notExists(error);

        // Import users as a global admin using the CAS authentication strategy
        PrincipalsTestUtil.importUsers(
          asGlobalAdmin,
          tenant.alias,
          getDataFileStream('users-without-password.csv'),
          'cas',
          null,
          (error_) => {
            assert.notExists(error_);

            // Verify that the users have been created and a CAS login id has been associated to those accounts.
            // We have to use the internal APIs for this as there is no REST endpoint that exposes this
            AuthenticationAPI.getUserIdFromLoginId(tenant.alias, 'cas', 'user-TGdDSdadW', (error, nicolaasUserId) => {
              assert.notExists(error);
              assert.ok(nicolaasUserId);
              // Verify that the external id is not associated to a different authentication strategy
              AuthenticationAPI.getUserIdFromLoginId(tenant.alias, 'ldap', 'user-TGdDSdadW', (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 404);
                // Verify that the user has the appropriate basic profile information
                RestAPI.User.getUser(tenantAdminRestContext, nicolaasUserId, (error, nicolaasUserObject) => {
                  assert.notExists(error);
                  assert.ok(nicolaasUserObject);
                  assert.strictEqual(nicolaasUserObject.displayName, 'Nicolaas Matthijs');
                  assert.strictEqual(nicolaasUserObject.email, 'nicolaas@users.without.passwords.import.tests.com');

                  // User with missing first name
                  AuthenticationAPI.getUserIdFromLoginId(
                    tenant.alias,
                    'cas',
                    'user-PQasQsaWQ',
                    (error, simonUserId) => {
                      assert.notExists(error);
                      assert.ok(simonUserId);
                      // Verify that the external id is not associated to a different authentication strategy
                      AuthenticationAPI.getUserIdFromLoginId(tenant.alias, 'shibboleth', 'user-PQasQsaWQ', (error_) => {
                        assert.ok(error_);
                        assert.strictEqual(error_.code, 404);
                        // Verify that the user has the appropriate basic profile information
                        RestAPI.User.getUser(tenantAdminRestContext, simonUserId, (error, simonUserObject) => {
                          assert.notExists(error);
                          assert.ok(simonUserObject);
                          assert.strictEqual(simonUserObject.displayName, 'Gaeremynck');
                          assert.strictEqual(simonUserObject.email, 'simon@users.without.passwords.import.tests.com');

                          // User with more complex display name
                          AuthenticationAPI.getUserIdFromLoginId(
                            tenant.alias,
                            'cas',
                            'user-CXzsaWasX',
                            (error, stuartUserId) => {
                              assert.notExists(error);
                              assert.ok(nicolaasUserId);
                              // Verify that the external id is not associated to a different authentication strategy
                              AuthenticationAPI.getUserIdFromLoginId(
                                tenant.alias,
                                'facebook',
                                'user-CXzsaWasX',
                                (error_) => {
                                  assert.ok(error_);
                                  assert.strictEqual(error_.code, 404);
                                  // Verify that the user has the appropriate basic profile information
                                  RestAPI.User.getUser(
                                    tenantAdminRestContext,
                                    stuartUserId,
                                    (error, stuartUserObject) => {
                                      assert.notExists(error);
                                      assert.ok(stuartUserObject);
                                      assert.strictEqual(stuartUserObject.displayName, 'Stuart D. Freeman');
                                      assert.strictEqual(
                                        stuartUserObject.email,
                                        'stuart@users.without.passwords.import.tests.com'
                                      );

                                      // Update a user's display name to be the same as its external id
                                      RestAPI.User.updateUser(
                                        tenantAdminRestContext,
                                        nicolaasUserId,
                                        { displayName: 'user-TGdDSdadW' },
                                        (error, user) => {
                                          assert.notExists(error);
                                          assert.ok(user);
                                          assert.strictEqual(user.id, nicolaasUserId);
                                          assert.strictEqual(user.displayName, 'user-TGdDSdadW');

                                          // Verify that the update is reflected when getting the user
                                          RestAPI.User.getUser(
                                            tenantAdminRestContext,
                                            nicolaasUserId,
                                            (error, nicolaasUserObject) => {
                                              assert.notExists(error);
                                              assert.ok(nicolaasUserObject);
                                              assert.strictEqual(nicolaasUserObject.displayName, 'user-TGdDSdadW');
                                              assert.strictEqual(
                                                nicolaasUserObject.email,
                                                'nicolaas@users.without.passwords.import.tests.com'
                                              );

                                              // Re-import the users to verify that the displayName is reverted back to the display name
                                              // provided in the CSV file. This time, the import is attempted as a tenant admin
                                              PrincipalsTestUtil.importUsers(
                                                tenantAdminRestContext,
                                                null,
                                                getDataFileStream('users-without-password.csv'),
                                                'cas',
                                                null,
                                                (error_) => {
                                                  assert.notExists(error_);

                                                  // Verify that the display name is correctly reverted
                                                  RestAPI.User.getUser(
                                                    tenantAdminRestContext,
                                                    nicolaasUserId,
                                                    (error, nicolaasUserObject) => {
                                                      assert.notExists(error);
                                                      assert.ok(nicolaasUserObject);
                                                      assert.strictEqual(
                                                        nicolaasUserObject.displayName,
                                                        'Nicolaas Matthijs'
                                                      );
                                                      assert.strictEqual(
                                                        nicolaasUserObject.email,
                                                        'nicolaas@users.without.passwords.import.tests.com'
                                                      );

                                                      // Update the user's display name to a different real display name
                                                      RestAPI.User.updateUser(
                                                        tenantAdminRestContext,
                                                        nicolaasUserId,
                                                        { displayName: 'N. Matthijs' },
                                                        (error, user) => {
                                                          assert.notExists(error);
                                                          assert.ok(user);
                                                          assert.strictEqual(user.id, nicolaasUserId);
                                                          assert.strictEqual(user.displayName, 'N. Matthijs');

                                                          // Verify that the update is reflected when getting the user
                                                          RestAPI.User.getUser(
                                                            tenantAdminRestContext,
                                                            nicolaasUserId,
                                                            (error, nicolaasUserObject) => {
                                                              assert.notExists(error);
                                                              assert.ok(nicolaasUserObject);
                                                              assert.strictEqual(
                                                                nicolaasUserObject.displayName,
                                                                'N. Matthijs'
                                                              );
                                                              assert.strictEqual(
                                                                nicolaasUserObject.email,
                                                                'nicolaas@users.without.passwords.import.tests.com'
                                                              );

                                                              // Re-import the users as a tenant admin to verify that the displayName is not reverted
                                                              // back to the display name provided in the CSV file
                                                              PrincipalsTestUtil.importUsers(
                                                                tenantAdminRestContext,
                                                                null,
                                                                getDataFileStream('users-without-password.csv'),
                                                                'cas',
                                                                null,
                                                                (error_) => {
                                                                  assert.notExists(error_);

                                                                  // Verify that the display name has not been reverted
                                                                  RestAPI.User.getUser(
                                                                    tenantAdminRestContext,
                                                                    nicolaasUserId,
                                                                    (error, nicolaasUserObject) => {
                                                                      assert.notExists(error);
                                                                      assert.ok(nicolaasUserObject);
                                                                      assert.strictEqual(
                                                                        nicolaasUserObject.displayName,
                                                                        'N. Matthijs'
                                                                      );
                                                                      assert.strictEqual(
                                                                        nicolaasUserObject.email,
                                                                        'nicolaas@users.without.passwords.import.tests.com'
                                                                      );

                                                                      // Re-import the users using the `forceProfileUpdate` flag to verify that the displayName is reverted to
                                                                      // the display name provided in the CSV file
                                                                      PrincipalsTestUtil.importUsers(
                                                                        tenantAdminRestContext,
                                                                        null,
                                                                        getDataFileStream('users-without-password.csv'),
                                                                        'cas',
                                                                        true,
                                                                        (error_) => {
                                                                          assert.notExists(error_);

                                                                          // Verify that the display name is correctly reverted
                                                                          RestAPI.User.getUser(
                                                                            tenantAdminRestContext,
                                                                            nicolaasUserId,
                                                                            (error, nicolaasUserObject) => {
                                                                              assert.notExists(error);
                                                                              assert.ok(nicolaasUserObject);
                                                                              assert.strictEqual(
                                                                                nicolaasUserObject.displayName,
                                                                                'Nicolaas Matthijs'
                                                                              );
                                                                              assert.strictEqual(
                                                                                nicolaasUserObject.email,
                                                                                'nicolaas@users.without.passwords.import.tests.com'
                                                                              );

                                                                              // Update the user's display name to be the same as its external id
                                                                              RestAPI.User.updateUser(
                                                                                tenantAdminRestContext,
                                                                                nicolaasUserId,
                                                                                {
                                                                                  displayName: 'user-TGdDSdadW'
                                                                                },
                                                                                (error, user) => {
                                                                                  assert.notExists(error);
                                                                                  assert.ok(user);
                                                                                  assert.strictEqual(
                                                                                    user.id,
                                                                                    nicolaasUserId
                                                                                  );
                                                                                  assert.strictEqual(
                                                                                    user.displayName,
                                                                                    'user-TGdDSdadW'
                                                                                  );

                                                                                  // Re-import the users using the `forceProfileUpdate` flag to verify that the displayName is correctly reverted to
                                                                                  // the display name provided in the CSV file when providing the flag
                                                                                  PrincipalsTestUtil.importUsers(
                                                                                    tenantAdminRestContext,
                                                                                    null,
                                                                                    getDataFileStream(
                                                                                      'users-without-password.csv'
                                                                                    ),
                                                                                    'cas',
                                                                                    true,
                                                                                    (error_) => {
                                                                                      assert.notExists(error_);

                                                                                      // Verify that the display name is correctly reverted
                                                                                      RestAPI.User.getUser(
                                                                                        tenantAdminRestContext,
                                                                                        nicolaasUserId,
                                                                                        (error, nicolaasUserObject) => {
                                                                                          assert.notExists(error);
                                                                                          assert.ok(nicolaasUserObject);
                                                                                          assert.strictEqual(
                                                                                            nicolaasUserObject.displayName,
                                                                                            'Nicolaas Matthijs'
                                                                                          );
                                                                                          assert.strictEqual(
                                                                                            nicolaasUserObject.email,
                                                                                            'nicolaas@users.without.passwords.import.tests.com'
                                                                                          );
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
                                }
                              );
                            }
                          );
                        });
                      });
                    }
                  );
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that users with an email address that does not match the email domain can be imported
     */
    it('verify users with an email address that does not match the email domain can be imported', (callback) => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = 'users.with.a.specific.email.domain.tests.com';
      TestsUtil.createTenantWithAdmin(tenantAlias, tenantHost, (error, tenant /* , tenantAdminRestContext */) => {
        assert.notExists(error);

        // The global administrator should be able to import users
        PrincipalsTestUtil.importUsers(
          asGlobalAdmin,
          tenant.alias,
          getDataFileStream('users-with-another-email-domain1.csv'),
          'local',
          null,
          (error_) => {
            assert.notExists(error_);

            // Verify the user from the CSV file has been imported even though it has an email
            // that doesn't match the configured email domain
            const userRestContext = TestsUtil.createTenantRestContext(tenantHost, 'username1', 'password');
            RestAPI.User.getMe(userRestContext, (error, me) => {
              assert.notExists(error);
              assert.strictEqual(me.email, 'user1@users.with.another.email.domain.tests.com');

              // The tenant admin should be able to import users
              PrincipalsTestUtil.importUsers(
                asGlobalAdmin,
                tenant.alias,
                getDataFileStream('users-with-another-email-domain2.csv'),
                'local',
                null,
                (error_) => {
                  assert.notExists(error_);

                  // Verify the user from the CSV file has been imported even though it has an email
                  // that doesn't match the configured email domain
                  const userRestContext = TestsUtil.createTenantRestContext(tenantHost, 'username2', 'password');
                  RestAPI.User.getMe(userRestContext, (error, me) => {
                    assert.notExists(error);
                    assert.strictEqual(me.email, 'user2@users.with.another.email.domain.tests.com');

                    return callback();
                  });
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies that parameters are validated appropriately when importing users from a CSV file
     */
    it('verify parameter validation', (callback) => {
      // Verify that an existing tenant alias is required
      PrincipalsTestUtil.importUsers(
        asGlobalAdmin,
        'foobar',
        getDataFileStream('users-without-password.csv'),
        'cas',
        null,
        (error) => {
          assert.ok(error);
          assert.ok(error.code, 400);

          // Verify that an authentication method is required
          PrincipalsTestUtil.importUsers(
            asGlobalAdmin,
            global.oaeTests.tenants.cam.alias,
            getDataFileStream('users-without-password.csv'),
            null,
            null,
            (error) => {
              assert.ok(error);
              assert.ok(error.code, 400);

              // Verify that an existing authentication method is required
              PrincipalsTestUtil.importUsers(
                asGlobalAdmin,
                global.oaeTests.tenants.cam.alias,
                getDataFileStream('users-without-password.csv'),
                'foobar',
                null,
                (error) => {
                  assert.ok(error);
                  assert.ok(error.code, 400);

                  // Verify that a CSV file is required
                  PrincipalsTestUtil.importUsers(
                    asGlobalAdmin,
                    global.oaeTests.tenants.cam.alias,
                    null,
                    'cas',
                    null,
                    (error) => {
                      assert.ok(error);
                      assert.ok(error.code, 400);
                      callback();
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
     * Test that verifies that only global or tenant administrators are able to import users from CSV
     */
    it('verify only admins can import users', (callback) => {
      // Verify that an anonymous user on the global admin tenant cannot import users
      PrincipalsTestUtil.importUsers(
        asGlobalAnonymous,
        global.oaeTests.tenants.cam.alias,
        getDataFileStream('users-without-password.csv'),
        'cas',
        null,
        (error) => {
          assert.ok(error);
          assert.ok(error.code, 401);

          // Verify that an anonymous user on a user tenant cannot import users
          PrincipalsTestUtil.importUsers(
            asCambridgeAnonymousUser,
            null,
            getDataFileStream('users-without-password.csv'),
            'cas',
            null,
            (error) => {
              assert.ok(error);
              assert.ok(error.code, 401);

              // Create a non-admin user on a user tenant
              TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
                assert.notExists(error);
                const { 0: jack } = users;

                // Verify that an authenticated non-admin user on a user tenant cannot import users
                PrincipalsTestUtil.importUsers(
                  jack.restContext,
                  null,
                  getDataFileStream('users-without-password.csv'),
                  'cas',
                  null,
                  (error_) => {
                    assert.ok(error_);
                    assert.ok(error_.code, 401);
                    callback();
                  }
                );
              });
            }
          );
        }
      );
    });
  });

  describe('Get user', () => {
    /**
     * Test that verifies that a user's basic profile can be retrieved
     */
    it('verify get user', (callback) => {
      // Create a test user
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: jack } = users;

        // Get the user on the global admin tenant
        RestAPI.User.getUser(asGlobalAdmin, jack.user.id, (error, retrievedUser) => {
          assert.notExists(error);
          assert.ok(retrievedUser);
          assert.strictEqual(retrievedUser.visibility, jack.user.visibility);
          assert.strictEqual(retrievedUser.displayName, jack.user.displayName);
          assert.strictEqual(retrievedUser.resourceType, 'user');
          assert.strictEqual(
            retrievedUser.profilePath,
            '/user/' + retrievedUser.tenant.alias + '/' + AuthzUtil.getResourceFromId(retrievedUser.id).resourceId
          );
          assert.isObject(retrievedUser.tenant);
          assert.lengthOf(keys(retrievedUser.tenant), 3);
          assert.strictEqual(retrievedUser.tenant.displayName, global.oaeTests.tenants.cam.displayName);
          assert.strictEqual(retrievedUser.tenant.alias, global.oaeTests.tenants.cam.alias);

          // Get the user
          RestAPI.User.getUser(asCambridgeAnonymousUser, jack.user.id, (error, retrievedUser) => {
            assert.notExists(error);
            assert.ok(retrievedUser);
            assert.strictEqual(retrievedUser.visibility, jack.user.visibility);
            assert.strictEqual(retrievedUser.displayName, jack.user.displayName);
            assert.strictEqual(retrievedUser.resourceType, 'user');
            assert.strictEqual(
              retrievedUser.profilePath,
              '/user/' + retrievedUser.tenant.alias + '/' + AuthzUtil.getResourceFromId(retrievedUser.id).resourceId
            );
            assert.isObject(retrievedUser.tenant);
            assert.lengthOf(keys(retrievedUser.tenant), 3);
            assert.strictEqual(retrievedUser.tenant.displayName, global.oaeTests.tenants.cam.displayName);
            assert.strictEqual(retrievedUser.tenant.alias, global.oaeTests.tenants.cam.alias);

            // Upload a profile picture for the user so we can verify its data on the user profile model
            PrincipalsTestUtil.uploadAndCropPicture(
              jack.restContext,
              jack.user.id,
              _getPictureStream,
              { x: 10, y: 10, width: 200 },
              () => {
                // Get the user
                RestAPI.User.getUser(asCambridgeAnonymousUser, jack.user.id, (error, retrievedUser) => {
                  assert.notExists(error);

                  // Ensure the profile picture URL is signed, and back-end URIs are not returned
                  assert.ok(retrievedUser.picture.small);
                  assert.ok(!retrievedUser.picture.smallUri);
                  assert.ok(retrievedUser.picture.medium);
                  assert.ok(!retrievedUser.picture.mediumUri);
                  assert.ok(retrievedUser.picture.large);
                  assert.ok(!retrievedUser.picture.largeUri);

                  // Ensure we can get the user from the global admin tenant
                  RestAPI.User.getUser(asGlobalAdmin, jack.user.id, (error, retrievedUser) => {
                    assert.notExists(error);
                    assert.ok(retrievedUser);
                    assert.strictEqual(retrievedUser.visibility, jack.user.visibility);
                    assert.strictEqual(retrievedUser.displayName, jack.user.displayName);
                    assert.strictEqual(retrievedUser.resourceType, 'user');
                    assert.strictEqual(
                      retrievedUser.profilePath,
                      '/user/' +
                        retrievedUser.tenant.alias +
                        '/' +
                        AuthzUtil.getResourceFromId(retrievedUser.id).resourceId
                    );
                    assert.isObject(retrievedUser.tenant);
                    assert.lengthOf(keys(retrievedUser.tenant), 3);
                    assert.strictEqual(retrievedUser.tenant.displayName, global.oaeTests.tenants.cam.displayName);
                    assert.strictEqual(retrievedUser.tenant.alias, global.oaeTests.tenants.cam.alias);

                    // Ensure the profile picture URL is signed, and back-end URIs are not returned
                    assert.ok(retrievedUser.picture.small);
                    assert.ok(!retrievedUser.picture.smallUri);
                    assert.ok(retrievedUser.picture.medium);
                    assert.ok(!retrievedUser.picture.mediumUri);
                    assert.ok(retrievedUser.picture.large);
                    assert.ok(!retrievedUser.picture.largeUri);

                    return callback();
                  });
                });
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies the tenant data is returned in the me feed.
     */
    it('verify that the me feed returns a tenant object', (callback) => {
      TestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant1, publicTenant2, privateTenant1 /* , privateTenant2 */) => {
          // Verify it for a regular user
          RestAPI.User.getMe(publicTenant1.publicUser.restContext, (error, meData) => {
            assert.notExists(error);
            assert.ok(!meData.anon);
            assert.isObject(meData.tenant);
            assert.lengthOf(keys(meData.tenant), 4);
            assert.strictEqual(meData.tenant.displayName, publicTenant1.tenant.displayName);
            assert.strictEqual(meData.tenant.alias, publicTenant1.tenant.alias);
            assert.strictEqual(meData.tenant.isPrivate, false);
            assert.deepStrictEqual(meData.tenant.emailDomains, publicTenant1.tenant.emailDomains);

            // Verify it for an anonymous user
            RestAPI.User.getMe(publicTenant1.anonymousRestContext, (error, meData) => {
              assert.notExists(error);
              assert.ok(meData.anon);
              assert.isObject(meData.tenant);
              assert.lengthOf(keys(meData.tenant), 4);
              assert.strictEqual(meData.tenant.displayName, publicTenant1.tenant.displayName);
              assert.strictEqual(meData.tenant.alias, publicTenant1.tenant.alias);
              assert.strictEqual(meData.tenant.isPrivate, false);
              assert.deepStrictEqual(meData.tenant.emailDomains, publicTenant1.tenant.emailDomains);

              // Verify it for a user on a private tenant
              RestAPI.User.getMe(privateTenant1.publicUser.restContext, (error, meData) => {
                assert.notExists(error);
                assert.ok(!meData.anon);
                assert.isObject(meData.tenant);
                assert.lengthOf(keys(meData.tenant), 4);
                assert.strictEqual(meData.tenant.displayName, privateTenant1.tenant.displayName);
                assert.strictEqual(meData.tenant.alias, privateTenant1.tenant.alias);
                assert.strictEqual(meData.tenant.isPrivate, true);
                assert.deepStrictEqual(meData.tenant.emailDomains, privateTenant1.tenant.emailDomains);

                // Verify it for an anonymous user on a private tenant
                RestAPI.User.getMe(privateTenant1.anonymousRestContext, (error, meData) => {
                  assert.notExists(error);
                  assert.ok(meData.anon);
                  assert.isObject(meData.tenant);
                  assert.lengthOf(keys(meData.tenant), 4);
                  assert.strictEqual(meData.tenant.displayName, privateTenant1.tenant.displayName);
                  assert.strictEqual(meData.tenant.alias, privateTenant1.tenant.alias);
                  assert.strictEqual(meData.tenant.isPrivate, true);
                  assert.deepStrictEqual(meData.tenant.emailDomains, privateTenant1.tenant.emailDomains);

                  return callback();
                });
              });
            });
          });
        }
      );
    });

    /**
     * Test that verifies when a user is being impostered, the imposter user object
     * is returned in the me feed
     */
    it('verify the imposter user object', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: simon } = users;

        // Make simon a tenant admin and imposter mrvisser with him
        RestAPI.User.setTenantAdmin(asCambridgeTenantAdmin, simon.user.id, true, (error_) => {
          assert.notExists(error_);
          RestAPI.Admin.loginAsUser(
            simon.restContext,
            mrvisser.user.id,
            format('http://%s', global.oaeTests.tenants.localhost.host),
            (error, simonImpersonatingMrvisserRestContext) => {
              assert.notExists(error);

              // Get the me feed of the impersonator to verify the data model
              RestAPI.User.getMe(simonImpersonatingMrvisserRestContext, (error, me) => {
                assert.notExists(error);

                // Verify the top-level me object is that of mrvisser
                assert.ok(me.tenant);
                assert.strictEqual(me.tenant.alias, mrvisser.user.tenant.alias);
                assert.strictEqual(me.tenant.displayName, mrvisser.user.tenant.displayName);
                assert.strictEqual(me.id, mrvisser.user.id);
                assert.strictEqual(me.displayName, mrvisser.user.displayName);
                assert.strictEqual(me.visibility, mrvisser.user.visibility);
                assert.strictEqual(me.email, mrvisser.user.email);
                assert.strictEqual(me.locale, mrvisser.user.locale);
                assert.strictEqual(me.publicAlias, mrvisser.user.publicAlias);
                assert.strictEqual(me.profilePath, mrvisser.user.profilePath);
                assert.strictEqual(me.resourceType, mrvisser.user.resourceType);
                assert.strictEqual(me.acceptedTC, 0);
                assert.ok(!me.isGlobalAdmin);
                assert.ok(!me.isTenantAdmin);

                // Verify the imposter user object is that of simon
                assert.ok(me.imposter);
                assert.ok(me.imposter.tenant);
                assert.strictEqual(me.imposter.tenant.alias, simon.user.tenant.alias);
                assert.strictEqual(me.imposter.tenant.displayName, simon.user.tenant.displayName);
                assert.strictEqual(me.imposter.id, simon.user.id);
                assert.strictEqual(me.imposter.displayName, simon.user.displayName);
                assert.strictEqual(me.imposter.visibility, simon.user.visibility);
                assert.strictEqual(me.imposter.email, simon.user.email);
                assert.strictEqual(me.imposter.locale, simon.user.locale);
                assert.strictEqual(me.imposter.publicAlias, simon.user.publicAlias);
                assert.strictEqual(me.imposter.profilePath, simon.user.profilePath);
                assert.strictEqual(me.imposter.resourceType, simon.user.resourceType);
                assert.strictEqual(me.imposter.acceptedTC, 0);
                return callback();
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies that the name of the authentication strategy is exposed in the me feed
     */
    it('verify the name of the authentication strategy is exposed in the me feed', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simon } = users;

        RestAPI.User.getMe(simon.restContext, (error, me) => {
          assert.notExists(error);
          assert.strictEqual(me.authenticationStrategy, 'local');
          return callback();
        });
      });
    });

    /**
     * Test that verifies that the user's `isGlobalAdmin` and `isTenantAdmin` properties are only visible for
     * global admins and within the tenant admins' scope
     */
    it('verify visibility of isGlobalAdmin and isTenantAdmin properties', (callback) => {
      // Create a Cambridge user
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, camUsers) => {
        assert.notExists(error);
        const { 0: camUser } = camUsers;
        assert.ok(camUser);

        // Create a GT user
        TestsUtil.generateTestUsers(asGeorgiaTechTenantAdmin, 1, (error, gtUsers) => {
          assert.notExists(error);
          const { 0: gtUser } = gtUsers;
          assert.ok(gtUser);

          // Verify the camUser's `isGlobalAdmin` and `isTenantAdmin` properties are visible for the global admin
          RestAPI.User.getUser(asGlobalAdmin, camUser.user.id, (error, user) => {
            assert.notExists(error);
            assert.ok(user);
            assert.strictEqual(user.isGlobalAdmin, false);
            assert.strictEqual(user.isTenantAdmin, false);

            // Verify the gtUsers's `isGlobalAdmin` and `isTenantAdmin` properties are visible for the global admin
            RestAPI.User.getUser(asGlobalAdmin, gtUser.user.id, (error, user) => {
              assert.notExists(error);
              assert.ok(user);
              assert.strictEqual(user.isGlobalAdmin, false);
              assert.strictEqual(user.isTenantAdmin, false);

              // Verify the camAdminUser's `isGlobalAdmin` and `isTenantAdmin` properties are visible for the global admin
              RestAPI.User.getMe(asCambridgeTenantAdmin, (error, camAdminUser) => {
                assert.notExists(error);
                assert.strictEqual(camAdminUser.isGlobalAdmin, false);
                assert.strictEqual(camAdminUser.isTenantAdmin, true);
                RestAPI.User.getUser(asGlobalAdmin, camAdminUser.id, (error, user) => {
                  assert.notExists(error);
                  assert.ok(user);
                  assert.strictEqual(user.isGlobalAdmin, false);
                  assert.strictEqual(user.isTenantAdmin, true);

                  // Verify the globalAdminUser's `isGlobalAdmin` and `isTenantAdmin` properties are visible for the global admin
                  RestAPI.User.getMe(asGlobalAdmin, (error, globalAdminUser) => {
                    assert.notExists(error);
                    assert.strictEqual(globalAdminUser.isGlobalAdmin, true);
                    assert.strictEqual(globalAdminUser.isTenantAdmin, false);
                    RestAPI.User.getUser(asGlobalAdmin, globalAdminUser.id, (error, user) => {
                      assert.notExists(error);
                      assert.ok(user);
                      assert.strictEqual(user.isGlobalAdmin, true);
                      assert.strictEqual(user.isTenantAdmin, false);

                      // Verify the camUser's `isGlobalAdmin` and `isTenantAdmin` properties are visible for the cam admin
                      RestAPI.User.getUser(asCambridgeTenantAdmin, camUser.user.id, (error, user) => {
                        assert.notExists(error);
                        assert.ok(user);
                        assert.strictEqual(user.isGlobalAdmin, false);
                        assert.strictEqual(user.isTenantAdmin, false);

                        // Verify the camUser's `isGlobalAdmin` and `isTenantAdmin` properties are NOT visible for the gt admin
                        RestAPI.User.getUser(asGeorgiaTechTenantAdmin, camUser.user.id, (error, user) => {
                          assert.notExists(error);
                          assert.ok(user);
                          assert.strictEqual(user.isGlobalAdmin, undefined);
                          assert.strictEqual(user.isTenantAdmin, undefined);

                          // Verify the gtUsers's `isGlobalAdmin` and `isTenantAdmin` properties are NOT visible for the cam admin
                          RestAPI.User.getUser(asCambridgeTenantAdmin, gtUser.user.id, (error, user) => {
                            assert.notExists(error);
                            assert.ok(user);
                            assert.strictEqual(user.isGlobalAdmin, undefined);
                            assert.strictEqual(user.isTenantAdmin, undefined);

                            // Verify the gtUsers's `isGlobalAdmin` and `isTenantAdmin` properties are visible for the gt admin
                            RestAPI.User.getUser(asGeorgiaTechTenantAdmin, gtUser.user.id, (error, user) => {
                              assert.notExists(error);
                              assert.ok(user);
                              assert.strictEqual(user.isGlobalAdmin, false);
                              assert.strictEqual(user.isTenantAdmin, false);

                              // Verifty the camUsers's `isGlobalAdmin` and `isTenantAdmin` properties are NOT visible for the GT user
                              RestAPI.User.getUser(camUser.restContext, camUser.user.id, (error, user) => {
                                assert.notExists(error);
                                assert.ok(user);
                                assert.strictEqual(user.isGlobalAdmin, undefined);
                                assert.strictEqual(user.isTenantAdmin, undefined);

                                // Verifty the camUsers's `isGlobalAdmin` and `isTenantAdmin` properties are NOT visible for the anonymous user
                                RestAPI.User.getUser(asCambridgeAnonymousUser, camUser.user.id, (error, user) => {
                                  assert.notExists(error);
                                  assert.ok(user);
                                  assert.strictEqual(user.isGlobalAdmin, undefined);
                                  assert.strictEqual(user.isTenantAdmin, undefined);

                                  // Verifty the camUsers's `isGlobalAdmin` and `isTenantAdmin` properties are NOT visible for the global anonymous user
                                  RestAPI.User.getUser(asGlobalAnonymous, camUser.user.id, (error, user) => {
                                    assert.notExists(error);
                                    assert.ok(user);
                                    assert.strictEqual(user.isGlobalAdmin, undefined);
                                    assert.strictEqual(user.isTenantAdmin, undefined);

                                    // Make camUser a tenant admin
                                    RestAPI.User.setTenantAdmin(asGlobalAdmin, camUser.user.id, true, (error_) => {
                                      assert.notExists(error_);

                                      // Verify the camUser's `isGlobalAdmin` and `isTenantAdmin` properties are visible for the global admin
                                      RestAPI.User.getUser(asGlobalAdmin, camUser.user.id, (error, user) => {
                                        assert.notExists(error);
                                        assert.ok(user);
                                        assert.strictEqual(user.isGlobalAdmin, false);
                                        assert.strictEqual(user.isTenantAdmin, true);

                                        // Verify the camUser's `isGlobalAdmin` and `isTenantAdmin` properties are visible for the cam admin
                                        RestAPI.User.getUser(asCambridgeTenantAdmin, camUser.user.id, (error, user) => {
                                          assert.notExists(error);
                                          assert.ok(user);
                                          assert.strictEqual(user.isGlobalAdmin, false);
                                          assert.strictEqual(user.isTenantAdmin, true);

                                          // Verify the camUser's `isGlobalAdmin` and `isTenantAdmin` properties are NOT visible for the gt admin
                                          RestAPI.User.getUser(
                                            asGeorgiaTechTenantAdmin,
                                            camUser.user.id,
                                            (error, user) => {
                                              assert.notExists(error);
                                              assert.ok(user);
                                              assert.strictEqual(user.isGlobalAdmin, undefined);
                                              assert.strictEqual(user.isTenantAdmin, undefined);

                                              // Verify the camUser's `isGlobalAdmin` and `isTenantAdmin` properties are NOT visible for the gt user
                                              RestAPI.User.getUser(
                                                gtUser.restContext,
                                                camUser.user.id,
                                                (error, user) => {
                                                  assert.notExists(error);
                                                  assert.ok(user);
                                                  assert.strictEqual(user.isGlobalAdmin, undefined);
                                                  assert.strictEqual(user.isTenantAdmin, undefined);
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
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that a user with an ugly username and a UTF-8 username can be retrieved
     */
    it('verify get user by ugly username', (callback) => {
      // Create a test user with an ugly user name
      const userId1 = TestsUtil.generateTestUserId('some.weird@`user\\name');
      const email1 = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      RestAPI.User.createUser(
        asCambridgeTenantAdmin,
        userId1,
        'password',
        'Test User',
        email1,
        { visibility: 'public' },
        (error, userObject1) => {
          assert.notExists(error);
          assert.ok(userObject1);

          // Get the user
          RestAPI.User.getUser(asCambridgeAnonymousUser, userObject1.id, (error, retrievedUser1) => {
            assert.notExists(error);
            assert.ok(retrievedUser1);
            assert.strictEqual(retrievedUser1.visibility, 'public');
            assert.strictEqual(retrievedUser1.displayName, 'Test User');
            assert.strictEqual(retrievedUser1.resourceType, 'user');
            assert.strictEqual(
              retrievedUser1.profilePath,
              '/user/' + retrievedUser1.tenant.alias + '/' + AuthzUtil.getResourceFromId(retrievedUser1.id).resourceId
            );

            // Create a test user with a UTF-8 username
            const userId2 = TestsUtil.generateTestUserId('стремился');
            const email2 = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
            RestAPI.User.createUser(
              asCambridgeTenantAdmin,
              userId2,
              'password',
              'Кругом шумел',
              email2,
              { visibility: 'public' },
              (error, userObject2) => {
                assert.notExists(error);
                assert.ok(userObject2);

                // Get the user
                RestAPI.User.getUser(asCambridgeAnonymousUser, userObject2.id, (error, retrievedUser2) => {
                  assert.notExists(error);
                  assert.ok(retrievedUser2);
                  assert.strictEqual(retrievedUser2.visibility, 'public');
                  assert.strictEqual(retrievedUser2.displayName, 'Кругом шумел');
                  assert.strictEqual(retrievedUser2.resourceType, 'user');
                  assert.strictEqual(
                    retrievedUser2.profilePath,
                    '/user/' +
                      retrievedUser2.tenant.alias +
                      '/' +
                      AuthzUtil.getResourceFromId(retrievedUser2.id).resourceId
                  );
                  return callback();
                });
              }
            );
          });
        }
      );
    });

    /**
     * Test that verifies that a non-existing user cannot be retrieved
     */
    it('verify get a bad userId', (callback) => {
      // Try and get an invalid user id
      RestAPI.User.getUser(asCambridgeAnonymousUser, 'totally-not-a-valid-id', (error, retrievedUser) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        assert.ok(!retrievedUser);

        // Try and get an almost-valid user id
        RestAPI.User.getUser(asCambridgeAnonymousUser, 'u:camtotally-not-a-valid-id', (error, retrievedUser) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.ok(!retrievedUser);

          // Try and get a non-existent user id
          RestAPI.User.getUser(asCambridgeAnonymousUser, 'u:cam:totally-not-existing', (error, retrievedUser) => {
            assert.ok(error);
            assert.strictEqual(error.code, 404);
            assert.ok(!retrievedUser);
            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies that users can be retrieved for a tenant by tenantAlias
     */
    it('verify get users for tenant', (callback) => {
      // Assert users are returned for a tenant
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: user1, 1: user2, 2: user3 } = users;
        RestAPI.Admin.getAllUsersForTenant(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, users) => {
          assert.notExists(error);
          const tenantUserIds = pluck('id', users);
          assert.include(tenantUserIds, user1.user.id);
          assert.include(tenantUserIds, user2.user.id);
          assert.include(tenantUserIds, user3.user.id);
          // Try and get users for a non-existing tenantAlias
          RestAPI.Admin.getAllUsersForTenant(asGlobalAdmin, 'totally-not-a-tenant-alias', (error /* , users */) => {
            assert.ok(error);
            assert.strictEqual(error.code, 404);
            // Try and get users as a non-admin user
            RestAPI.Admin.getAllUsersForTenant(
              asCambridgeAnonymousUser,
              global.oaeTests.tenants.gt.alias,
              (error /* , users */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 401);
                // Try and get users for a tenant with no users
                const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
                const tenantHost = TenantsTestUtil.generateTestTenantHost();
                TenantsTestUtil.createTenantAndWait(
                  asGlobalAdmin,
                  tenantAlias,
                  'Empty tenant',
                  tenantHost,
                  {},
                  (error /* , tenant */) => {
                    assert.notExists(error);
                    RestAPI.Admin.getAllUsersForTenant(asGlobalAdmin, tenantAlias, (error, users) => {
                      assert.notExists(error);
                      assert.ok(users.length === 0);
                      return callback();
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

  describe('Update user', () => {
    /**
     * Test that verifies that it is possible for a user to update its own basic profile, including non standard fields
     */
    it('verify update user', (callback) => {
      // Create a test user
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: jack } = users;

        // Set a profile picture
        PrincipalsTestUtil.uploadAndCropPicture(
          jack.restContext,
          jack.user.id,
          _getPictureStream,
          { x: 10, y: 10, width: 200 },
          () => {
            const timeBeforeUpdate = Date.now();

            // Update the user
            const updateValues = {
              displayName: 'displayname',
              publicAlias: 'publicalias',
              visibility: 'private',
              locale: 'nl_NL'
            };
            PrincipalsTestUtil.assertUpdateUserSucceeds(jack.restContext, jack.user.id, updateValues, (user) => {
              assert.ok(user.lastModified <= Date.now());
              assert.ok(user.lastModified >= timeBeforeUpdate);
              assert.strictEqual(user.resourceType, 'user');
              assert.strictEqual(
                user.profilePath,
                '/user/' + user.tenant.alias + '/' + AuthzUtil.getResourceFromId(user.id).resourceId
              );
              assert.ok(!user.picture.largeUri);
              assert.ok(user.picture.large);
              assert.ok(!user.picture.mediumUri);
              assert.ok(user.picture.medium);
              assert.ok(!user.picture.smallUri);
              assert.ok(user.picture.small);

              // Get the user's me feed
              RestAPI.User.getMe(jack.restContext, (error, me) => {
                assert.notExists(error);
                assert.ok(me);
                assert.strictEqual(me.visibility, 'private');
                assert.strictEqual(me.displayName, 'displayname');
                assert.strictEqual(me.publicAlias, 'publicalias');
                assert.strictEqual(me.locale, 'nl_NL');
                assert.strictEqual(me.resourceType, 'user');
                assert.strictEqual(
                  me.profilePath,
                  '/user/' + me.tenant.alias + '/' + AuthzUtil.getResourceFromId(me.id).resourceId
                );
                assert.strictEqual(me.lastModified, user.lastModified);
                assert.ok(!me.picture.largeUri);
                assert.ok(me.picture.large);
                assert.ok(!me.picture.mediumUri);
                assert.ok(me.picture.medium);
                assert.ok(!me.picture.smallUri);
                assert.ok(me.picture.small);

                return callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that it is possible for an admin user to update another user's basic profile
     */
    it('verify admin update other user', (callback) => {
      // Create a test user
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: jack } = users;
        const timeBeforeUpdate = Date.now();

        // Update the user as a global admin
        let updateValues = {
          displayName: 'displayname',
          publicAlias: 'publicalias',
          visibility: 'private',
          locale: 'nl_NL',
          emailPreference: 'weekly'
        };
        PrincipalsTestUtil.assertUpdateUserSucceeds(asGlobalAdmin, jack.user.id, updateValues, (user) => {
          assert.ok(user.lastModified <= Date.now());
          assert.ok(user.lastModified >= timeBeforeUpdate);
          assert.strictEqual(user.resourceType, 'user');
          assert.strictEqual(
            user.profilePath,
            '/user/' + user.tenant.alias + '/' + AuthzUtil.getResourceFromId(user.id).resourceId
          );

          // Ensure the user's `me` feed contains the updated information
          RestAPI.User.getMe(jack.restContext, (error, meObject) => {
            assert.notExists(error);
            assert.ok(meObject);
            assert.strictEqual(meObject.visibility, 'private');
            assert.strictEqual(meObject.displayName, 'displayname');
            assert.strictEqual(meObject.publicAlias, 'publicalias');
            assert.strictEqual(meObject.locale, 'nl_NL');
            assert.strictEqual(meObject.emailPreference, 'weekly');
            assert.strictEqual(meObject.resourceType, 'user');
            assert.strictEqual(
              meObject.profilePath,
              '/user/' + meObject.tenant.alias + '/' + AuthzUtil.getResourceFromId(meObject.id).resourceId
            );
            assert.strictEqual(meObject.lastModified, user.lastModified);

            // Verify that a tenant admin can also update a user's basic profile
            updateValues = {
              displayName: 'Test User',
              publicAlias: 'updatedalias',
              visibility: 'public',
              locale: 'en_GB',
              emailPreference: 'daily'
            };
            PrincipalsTestUtil.assertUpdateUserSucceeds(asCambridgeTenantAdmin, jack.user.id, updateValues, (user) => {
              assert.ok(user.lastModified <= Date.now());
              assert.ok(user.lastModified >= timeBeforeUpdate);
              assert.strictEqual(user.resourceType, 'user');
              assert.strictEqual(
                user.profilePath,
                '/user/' + user.tenant.alias + '/' + AuthzUtil.getResourceFromId(user.id).resourceId
              );

              // Ensure the user's `me` feed contains the updated information
              RestAPI.User.getMe(jack.restContext, (error, meObject) => {
                assert.notExists(error);
                assert.ok(meObject);
                assert.strictEqual(meObject.visibility, 'public');
                assert.strictEqual(meObject.displayName, 'Test User');
                assert.strictEqual(meObject.publicAlias, 'updatedalias');
                assert.strictEqual(meObject.locale, 'en_GB');
                assert.strictEqual(meObject.emailPreference, 'daily');
                assert.strictEqual(meObject.resourceType, 'user');
                assert.strictEqual(
                  meObject.profilePath,
                  '/user/' + meObject.tenant.alias + '/' + AuthzUtil.getResourceFromId(meObject.id).resourceId
                );
                assert.strictEqual(meObject.lastModified, user.lastModified);

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that it is not possible for a user to be updated with restricted fields being set
     */
    it('verify cannot update user to tenant admin', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: jack } = users;

        // Verify a user cannot promote themselves to a tenant administrator
        PrincipalsTestUtil.assertUpdateUserFails(
          jack.restContext,
          jack.user.id,
          { 'admin:tenant': 'true' },
          400,
          () => {
            // Verify a user cannot promote themselves to a global administrator
            PrincipalsTestUtil.assertUpdateUserFails(
              jack.restContext,
              jack.user.id,
              { 'admin:global': 'true' },
              400,
              () => {
                // Sanity check the user has not been promoted
                PrincipalsAPI.getUser(new Context(global.oaeTests.tenants.cam), jack.user.id, (error, userObject) => {
                  assert.notExists(error);
                  assert.ok(userObject);
                  assert.ok(
                    !userObject.isTenantAdmin(global.oaeTests.tenants.cam.alias),
                    'Expected user to not be update-able to tenant or global admin'
                  );
                  return callback();
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that updating a user fails when:
     *
     *  * no parameters are provided; or
     *  * a user is trying to update a different user's basic profile; or
     *  * an anonymous user tries to update a user's profile; or
     *  * a user tries to update a non-existing user's profile
     */
    it('verify validation of updating a user', (callback) => {
      // Create a test user
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: jack, 1: jane } = users;

        // Ensure the user id must be a valid principal id
        PrincipalsTestUtil.assertUpdateUserFails(
          jack.restContext,
          'notavalidid',
          { displayName: 'Casper, the friendly horse' },
          400,
          () => {
            // Update a non-existing variation of a valid user id (so we know it is a valid id)
            PrincipalsTestUtil.assertUpdateUserFails(
              jack.restContext,
              jack.user.id + 'nonexisting',
              { displayName: 'Casper, the friendly horse' },
              401,
              () => {
                // Try to update the user's profile without parameters
                PrincipalsTestUtil.assertUpdateUserFails(jack.restContext, jack.user.id, {}, 400, () => {
                  // Try to update the user's profile as a different user
                  PrincipalsTestUtil.assertUpdateUserFails(
                    jane.restContext,
                    jack.user.id,
                    { displayName: 'Stinky Jack LOL' },
                    401,
                    () => {
                      // Try to update the user's profile as the anonymous user
                      PrincipalsTestUtil.assertUpdateUserFails(
                        asCambridgeAnonymousUser,
                        jack.user.id,
                        { displayName: 'Stinky Jack LOL' },
                        401,
                        () => {
                          // Create user with displayName that is longer than the maximum allowed size
                          const longDisplayName = TestsUtil.generateRandomText(100);
                          PrincipalsTestUtil.assertUpdateUserFails(
                            jack.restContext,
                            jack.user.id,
                            { displayName: longDisplayName },
                            400,
                            () => {
                              // Create user with an empty displayName
                              PrincipalsTestUtil.assertUpdateUserFails(
                                jack.restContext,
                                jack.user.id,
                                { displayName: '\n' },
                                400,
                                () => {
                                  // Verify an incorrect visibility is invalid
                                  PrincipalsTestUtil.assertUpdateUserFails(
                                    jack.restContext,
                                    jack.user.id,
                                    { visibility: 'so incorrect' },
                                    400,
                                    () => {
                                      // Verify an incorrect email preference is invalid
                                      PrincipalsTestUtil.assertUpdateUserFails(
                                        jack.restContext,
                                        jack.user.id,
                                        { emailPreference: 'so incorrect' },
                                        400,
                                        () => {
                                          // Verify an incorrect email is invalid
                                          PrincipalsTestUtil.assertUpdateUserFails(
                                            jack.restContext,
                                            jack.user.id,
                                            { email: 'so incorrect' },
                                            400,
                                            () => {
                                              // Verify unknown fields aren't allowed
                                              PrincipalsTestUtil.assertUpdateUserFails(
                                                jack.restContext,
                                                jack.user.id,
                                                { wumptiedumpty: true },
                                                400,
                                                () => {
                                                  // Make sure that the user's basic profile is unchanged
                                                  RestAPI.User.getUser(
                                                    jack.restContext,
                                                    jack.user.id,
                                                    (error, userObject) => {
                                                      assert.notExists(error);
                                                      assert.ok(userObject);
                                                      assert.strictEqual(userObject.visibility, jack.user.visibility);
                                                      assert.strictEqual(userObject.displayName, jack.user.displayName);
                                                      assert.strictEqual(userObject.resourceType, 'user');
                                                      assert.strictEqual(
                                                        userObject.profilePath,
                                                        '/user/' +
                                                          userObject.tenant.alias +
                                                          '/' +
                                                          AuthzUtil.getResourceFromId(userObject.id).resourceId
                                                      );
                                                      assert.strictEqual(userObject.email, jack.user.email);
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

    /**
     * Test that verifies that users can update their email address
     */
    it('verify updating a user their email address', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: jack } = users;

        // Jack should be able to use a new email address
        const email = 'Aa' + TestsUtil.generateTestEmailAddress();
        PrincipalsTestUtil.assertUpdateUserSucceeds(jack.restContext, jack.user.id, { email }, (user, token) => {
          // Verify the new email address
          PrincipalsTestUtil.assertVerifyEmailSucceeds(jack.restContext, jack.user.id, token, () => {
            // "Updating" the email address by changing its case
            // should have no effect as the API will lower-case it
            PrincipalsTestUtil.assertUpdateUserSucceeds(
              jack.restContext,
              jack.user.id,
              { email: email.toUpperCase() },
              (user /* , token */) => {
                assert.strictEqual(user.email, email.toLowerCase());

                // Assert there's no need to verify the email address (as it hasn't changed)
                RestAPI.User.getMe(jack.restContext, (error, me) => {
                  assert.notExists(error);
                  assert.strictEqual(me.email, email.toLowerCase());

                  PrincipalsTestUtil.assertUpdateUserSucceeds(
                    jack.restContext,
                    jack.user.id,
                    { email: email.toLowerCase() },
                    (user /* , token */) => {
                      assert.strictEqual(user.email, email.toLowerCase());

                      // Assert there's no need to verify the email address (as it hasn't changed)
                      RestAPI.User.getMe(jack.restContext, (error, me) => {
                        assert.notExists(error);
                        assert.strictEqual(me.email, email.toLowerCase());

                        return callback();
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
  });

  describe('User visibility', () => {
    /*!
     * Verifies the profile permissions of the provided user, according to the given criteria.
     *
     * @param  {RestContext}   restContext             The RestContext to use to fetch the user
     * @param  {String}        userToCheck             The id of the user to check
     * @param  {Boolean}       expectAccess            Whether or not we should expect the context have full access to the user
     * @param  {String}        expectedDisplayName     The expected display name of the user
     * @param  {String}        expectedPublicAlias     The expected public alias of the user
     * @param  {String}        expectedVisibility      The expected visibility of the user, one of 'public', 'loggedin', 'private'
     * @param  {Function}      callback                Standard callback function
     */
    const verifyProfilePermissions = function (
      restContext,
      userToCheck,
      expectAccess,
      expectedDisplayName,
      expectedPublicAlias,
      expectedVisibility,
      callback
    ) {
      // Try to get user 1 as an anonymous user and a logged in user. Both should work
      RestAPI.User.getUser(restContext, userToCheck, (error, userObject) => {
        assert.notExists(error);
        assert.ok(userObject);
        assert.strictEqual(userObject.visibility, expectedVisibility);
        assert.strictEqual(userObject.displayName, expectedDisplayName);
        assert.strictEqual(userObject.publicAlias, expectedPublicAlias);
        assert.strictEqual(userObject.resourceType, 'user');
        // The profile path should only be present if you're allowed to view the user
        if (expectAccess) {
          assert.strictEqual(
            userObject.profilePath,
            '/user/' + userObject.tenant.alias + '/' + AuthzUtil.getResourceFromId(userObject.id).resourceId
          );
        } else {
          assert.strictEqual(userObject.profilePath, undefined);
        }

        callback();
      });
    };

    /**
     * Test that verifies that user visibility settings work as expected. Public users should be visible to everyone. Loggedin users should be
     * visible to all users, other than the anonymous user. Private user should only be visible to the user himself. When a user is not visible,
     * only the display name should be visible
     */
    it('verify user permissions', (callback) => {
      // Create 2 public test users
      const jackUserId = TestsUtil.generateTestUserId();
      const jackEmail = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      const jackOptions = {
        visibility: 'public',
        publicAlias: 'Jack'
      };

      RestAPI.User.createUser(
        asCambridgeTenantAdmin,
        jackUserId,
        'password',
        'Jack Doe',
        jackEmail,
        jackOptions,
        (error, jack) => {
          assert.notExists(error);
          assert.ok(jack);
          const jackRestContext = TestsUtil.createTenantRestContext(
            global.oaeTests.tenants.cam.host,
            jackUserId,
            'password'
          );

          const janeUserId = TestsUtil.generateTestUserId();
          const janeEmail = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
          RestAPI.User.createUser(
            asCambridgeTenantAdmin,
            janeUserId,
            'password',
            'Jane Doe',
            janeEmail,
            { visibility: 'public' },
            (error, jane) => {
              assert.notExists(error);
              assert.ok(jane);
              const janeRestContext = TestsUtil.createTenantRestContext(
                global.oaeTests.tenants.cam.host,
                janeUserId,
                'password'
              );

              // Try to get jack as an anonymous user and a logged in user and the user himself. All should work
              verifyProfilePermissions(asCambridgeAnonymousUser, jack.id, true, 'Jack Doe', undefined, 'public', () => {
                verifyProfilePermissions(janeRestContext, jack.id, true, 'Jack Doe', undefined, 'public', () => {
                  verifyProfilePermissions(jackRestContext, jack.id, true, 'Jack Doe', 'Jack', 'public', () => {
                    // Set jack's visibility to logged in
                    RestAPI.User.updateUser(jackRestContext, jack.id, { visibility: 'loggedin' }, (error_) => {
                      assert.notExists(error_);

                      // Try to get jack as an anonymous user and a logged in user and the user himself. The anonymous user
                      // should only be able to get the display name
                      verifyProfilePermissions(
                        asCambridgeAnonymousUser,
                        jack.id,
                        false,
                        'Jack',
                        undefined,
                        'loggedin',
                        () => {
                          verifyProfilePermissions(
                            janeRestContext,
                            jack.id,
                            true,
                            'Jack Doe',
                            undefined,
                            'loggedin',
                            () => {
                              verifyProfilePermissions(
                                jackRestContext,
                                jack.id,
                                true,
                                'Jack Doe',
                                'Jack',
                                'loggedin',
                                () => {
                                  // Set jack's visibility to private
                                  RestAPI.User.updateUser(
                                    jackRestContext,
                                    jack.id,
                                    { visibility: 'private' },
                                    (error_) => {
                                      assert.notExists(error_);

                                      // Try to get jack as an anonymous user and a logged in user and the user himself. The anonymous user
                                      // and the logged in user should only be able to get the display name
                                      verifyProfilePermissions(
                                        asCambridgeAnonymousUser,
                                        jack.id,
                                        false,
                                        'Jack',
                                        undefined,
                                        'private',
                                        () => {
                                          verifyProfilePermissions(
                                            janeRestContext,
                                            jack.id,
                                            false,
                                            'Jack',
                                            undefined,
                                            'private',
                                            () => {
                                              verifyProfilePermissions(
                                                jackRestContext,
                                                jack.id,
                                                true,
                                                'Jack Doe',
                                                'Jack',
                                                'private',
                                                () => {
                                                  // Set jack's visibility to an invalid option
                                                  RestAPI.User.updateUser(
                                                    jackRestContext,
                                                    jack.id,
                                                    { visibility: 'non-existing' },
                                                    (error_) => {
                                                      assert.ok(error_);

                                                      // Make sure that the jack's visibility has not changed
                                                      verifyProfilePermissions(
                                                        asCambridgeAnonymousUser,
                                                        jack.id,
                                                        false,
                                                        'Jack',
                                                        undefined,
                                                        'private',
                                                        () => {
                                                          verifyProfilePermissions(
                                                            janeRestContext,
                                                            jack.id,
                                                            false,
                                                            'Jack',
                                                            undefined,
                                                            'private',
                                                            () => {
                                                              verifyProfilePermissions(
                                                                jackRestContext,
                                                                jack.id,
                                                                true,
                                                                'Jack Doe',
                                                                'Jack',
                                                                'private',
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
            }
          );
        }
      );
    });

    /**
     * Test that verifies that a public user's profile is fully visible beyond the tenant scope.
     */
    it('verify public user is visible beyond tenant scope', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: jack } = users;
        TestsUtil.generateTestUsers(asGeorgiaTechTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: jane } = users;

          verifyProfilePermissions(
            jane.restContext,
            jack.user.id,
            true,
            jack.user.displayName,
            undefined,
            'public',
            callback
          );
        });
      });
    });

    /**
     * Test that verifies that a user's basic profile is hidden when their visibility is restricted to 'loggedin' users and they are
     * accessed by an authenticated user from a different tenant.
     */
    it('verify loggedin user is hidden beyond tenant scope', (callback) => {
      const usernameA = TestsUtil.generateTestUserId();
      const usernameB = TestsUtil.generateTestUserId();

      // Create user in tenant A
      const loggedInUserOptions = {
        visibility: 'loggedin',
        publicAlias: 'A user.'
      };
      let email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);

      RestAPI.User.createUser(
        asCambridgeTenantAdmin,
        usernameA,
        'password',
        'LoggedIn User',
        email,
        loggedInUserOptions,
        (error, userA) => {
          assert.notExists(error);

          // Create user B in GT tenant
          email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.gt.emailDomains[0]);
          RestAPI.User.createUser(
            asGeorgiaTechTenantAdmin,
            usernameB,
            'password',
            'Private User',
            email,
            {},
            (error /* , userB */) => {
              assert.notExists(error);
              const restCtxB = TestsUtil.createTenantRestContext(
                global.oaeTests.tenants.gt.host,
                usernameB,
                'password'
              );

              verifyProfilePermissions(restCtxB, userA.id, false, 'A user.', undefined, 'loggedin', callback);
            }
          );
        }
      );
    });
  });

  describe('Global and tenant admin', () => {
    /**
     * Test that verifies valid and invalid access to making users global or tenant admins. setGlobalAdmin will use the internal APIs as there
     * is not yet a way in which global admins can be set through the REST endpoints
     */
    it('verify making someone an admin', (callback) => {
      // Create 2 test users
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: jack, 1: jane } = users;
        jack.context = new Context(global.oaeTests.tenants.cam, jack.user);

        // Verify an anonymous user cannot promote someone to global admin
        PrincipalsAPI.setGlobalAdmin(new Context(global.oaeTests.tenants.cam), jack.user.id, true, (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, 401);

          // Verify an anonymous user-tenant user cannot promote someone to tenant admin
          RestAPI.User.setTenantAdmin(asCambridgeAnonymousUser, jack.user.id, true, (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 401);

            // Verify that anonymous admin-tenant users cannot make users tenant-admin
            RestAPI.User.setTenantAdmin(asGlobalAnonymous, jack.user.id, true, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 401);

              // Jack will try to make himself and Jane an admin. Both should fail.
              PrincipalsAPI.setGlobalAdmin(jack.context, jack.user.id, true, (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 401);
                PrincipalsAPI.setGlobalAdmin(jack.context, jane.user.id, true, (error_) => {
                  assert.ok(error_);
                  assert.strictEqual(error_.code, 401);

                  // We make Jack a global admin
                  PrincipalsAPI.setGlobalAdmin(asAnotherGlobalAdmin, jack.user.id, true, (error_) => {
                    assert.notExists(error_);
                    // Verify that Jack is a global admin
                    PrincipalsAPI.getUser(new Context(global.oaeTests.tenants.cam), jack.user.id, (error, user) => {
                      assert.notExists(error);
                      assert.strictEqual(user.isGlobalAdmin(), true);
                      assert.strictEqual(user.isAdmin(global.oaeTests.tenants.cam.alias), true);
                      assert.strictEqual(user.isTenantAdmin(global.oaeTests.tenants.cam.alias), false);
                      jack.context = new Context(global.oaeTests.tenants.cam, user);

                      // Jack will make Jane a global admin
                      PrincipalsAPI.setGlobalAdmin(jack.context, jane.user.id, true, (error_) => {
                        assert.notExists(error_);

                        // Check that Jane is a global admin
                        PrincipalsAPI.getUser(new Context(global.oaeTests.tenants.cam), jane.user.id, (error, user) => {
                          assert.notExists(error);
                          assert.strictEqual(user.isGlobalAdmin(), true);
                          assert.strictEqual(user.isAdmin(global.oaeTests.tenants.cam.alias), true);
                          assert.strictEqual(user.isTenantAdmin(global.oaeTests.tenants.cam.alias), false);

                          // Revoke Jack's global admin rights
                          PrincipalsAPI.setGlobalAdmin(asAnotherGlobalAdmin, jack.user.id, false, (error_) => {
                            assert.notExists(error_);

                            // Check that Jack is no longer an admin
                            PrincipalsAPI.getUser(
                              new Context(global.oaeTests.tenants.cam),
                              jack.user.id,
                              (error, user) => {
                                assert.notExists(error);
                                assert.strictEqual(user.isGlobalAdmin(), false);
                                assert.strictEqual(user.isAdmin(global.oaeTests.tenants.cam.alias), false);
                                assert.strictEqual(user.isTenantAdmin(global.oaeTests.tenants.cam.alias), false);
                                jack.context = new Context(global.oaeTests.tenants.cam, user);

                                // Make sure that Jack can no longer revoke the admin rights of Jane
                                PrincipalsAPI.setGlobalAdmin(jack.context, jane.user.id, false, (error_) => {
                                  assert.ok(error_);
                                  assert.strictEqual(error_.code, 401);

                                  // Make sure that Jane is still an admin
                                  PrincipalsAPI.getUser(
                                    new Context(global.oaeTests.tenants.cam),
                                    jane.user.id,
                                    (error, user) => {
                                      assert.notExists(error);
                                      assert.strictEqual(user.isGlobalAdmin(), true);
                                      assert.strictEqual(user.isAdmin(global.oaeTests.tenants.cam.alias), true);
                                      assert.strictEqual(user.isTenantAdmin(global.oaeTests.tenants.cam.alias), false);
                                      return callback();
                                    }
                                  );
                                });
                              }
                            );
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies the access restrictions for revoking admin access from users.
     */
    it('verify revoking admin rights access restrictions', (callback) => {
      // Create 3 test users
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: jack, 1: jane, 2: sam } = users;

        // Make jane a tenant admin and verify it worked
        RestAPI.User.setTenantAdmin(asGlobalAdmin, jane.user.id, true, (error_) => {
          assert.notExists(error_);

          PrincipalsAPI.getUser(asAnotherGlobalAdmin, jane.user.id, (error, user) => {
            assert.notExists(error);
            assert.ok(user.isTenantAdmin(global.oaeTests.tenants.cam.alias));

            // Make sam a global admin and verify it worked
            PrincipalsAPI.setGlobalAdmin(asAnotherGlobalAdmin, sam.user.id, true, (error_) => {
              assert.notExists(error_);

              PrincipalsAPI.getUser(asAnotherGlobalAdmin, sam.user.id, (error, user) => {
                assert.notExists(error);
                assert.ok(user.isGlobalAdmin());

                // Get jack's API user so we can build an API context later
                PrincipalsAPI.getUser(asAnotherGlobalAdmin, jack.user.id, (error, user) => {
                  assert.notExists(error);
                  jack.context = new Context(global.oaeTests.tenants.cam, user);

                  // Verify an anonymous user (user-tenant or admin-tenant) or auth user cannot revoke jane's tenant-admin rights
                  RestAPI.User.setTenantAdmin(asCambridgeAnonymousUser, jane.user.id, false, (error_) => {
                    assert.ok(error_);
                    assert.strictEqual(error_.code, 401);

                    RestAPI.User.setTenantAdmin(asGlobalAnonymous, jane.user.id, false, (error_) => {
                      assert.ok(error_);
                      assert.strictEqual(error_.code, 401);

                      RestAPI.User.setTenantAdmin(jack.restContext, jane.user.id, false, (error_) => {
                        assert.ok(error_);
                        assert.strictEqual(error_.code, 401);

                        // Verify an anonymous user (user-tenant or admin-tenant) or auth user cannot revoke sam's global-admin rights
                        PrincipalsAPI.setGlobalAdmin(
                          new Context(global.oaeTests.tenants.cam),
                          sam.user.id,
                          false,
                          (error_) => {
                            assert.ok(error_);
                            assert.strictEqual(error_.code, 401);

                            PrincipalsAPI.setGlobalAdmin(
                              new Context(global.oaeTests.tenants.global),
                              sam.user.id,
                              false,
                              (error_) => {
                                assert.ok(error_);
                                assert.strictEqual(error_.code, 401);

                                PrincipalsAPI.setGlobalAdmin(jack.context, sam.user.id, false, (error_) => {
                                  assert.ok(error_);
                                  assert.strictEqual(error_.code, 401);

                                  // Ensure jane and sam have their admin rights
                                  PrincipalsAPI.getUser(asAnotherGlobalAdmin, jane.user.id, (error, user) => {
                                    assert.notExists(error);
                                    assert.ok(user.isTenantAdmin(global.oaeTests.tenants.cam.alias));

                                    PrincipalsAPI.getUser(asAnotherGlobalAdmin, sam.user.id, (error, user) => {
                                      assert.notExists(error);
                                      assert.ok(user.isGlobalAdmin());
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
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that a tenant admin cannot make a user a global admin.
     */
    it('verify tenant admin restrictions', (callback) => {
      // Create a test user
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: jack } = users;

        // We make Jack a tenant admin
        RestAPI.User.setTenantAdmin(asGlobalAdmin, jack.user.id, true, (error_) => {
          assert.notExists(error_);
          // Verify that Jack is a tenant admin
          PrincipalsAPI.getUser(new Context(global.oaeTests.tenants.cam), jack.user.id, (error, user) => {
            assert.notExists(error);
            assert.strictEqual(user.isGlobalAdmin(), false);
            assert.strictEqual(user.isAdmin(global.oaeTests.tenants.cam.alias), true);
            assert.strictEqual(user.isTenantAdmin(global.oaeTests.tenants.cam.alias), true);
            jack.context = new Context(global.oaeTests.tenants.cam, user);

            // Jack will try to make herself a global admin. This should fail
            PrincipalsAPI.setGlobalAdmin(jack.context, jack.user.id, true, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 401);
              // Verify that Jack is not a global admin
              PrincipalsAPI.getUser(new Context(global.oaeTests.tenants.cam), jack.user.id, (error, user) => {
                assert.notExists(error);
                assert.strictEqual(user.isGlobalAdmin(), false);
                assert.strictEqual(user.isAdmin(global.oaeTests.tenants.cam.alias), true);
                assert.strictEqual(user.isTenantAdmin(global.oaeTests.tenants.cam.alias), true);
                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that unknown users and groups cannot be made admins
     */
    it('verify admin parameter validation', (callback) => {
      // Try to make an invalid user an admin
      RestAPI.User.setTenantAdmin(asGlobalAdmin, 'invalid-id', true, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);

        // Try to make a non-existing user an admin
        RestAPI.User.setTenantAdmin(asGlobalAdmin, 'u:cam:non-existing', true, (error) => {
          assert.ok(error);
          assert.strictEqual(error.code, 404);

          // Try to make a group an admin
          RestAPI.User.setTenantAdmin(asGlobalAdmin, 'g:cam:group', true, (error) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);
            callback();
          });
        });
      });
    });

    /**
     * Test that verifies that tenant admins can only update items inside of their own tenant.
     */
    it('verify tenant admin separation', (callback) => {
      // We create 3 users: jack, jane and joe. Jack and Joe are in tenant A, Jane is in tenant B.
      // We promote John to a tenant admin (for A) and try to update the profile info for Jack and Jane.
      // It should only work for Jack.
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: jack, 1: joe } = users;

        TestsUtil.generateTestUsers(asGeorgiaTechTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: jane } = users;

          // Make Jack a tenant admin
          RestAPI.User.setTenantAdmin(asCambridgeTenantAdmin, jack.user.id, true, (error_) => {
            assert.notExists(error_);

            // Verify that Jack is a tenant admin
            PrincipalsAPI.getUser(new Context(global.oaeTests.tenants.cam), jack.user.id, (error, user) => {
              assert.notExists(error);
              assert.strictEqual(user.isGlobalAdmin(), false);
              assert.strictEqual(user.isAdmin(global.oaeTests.tenants.cam.alias), true);
              assert.strictEqual(user.isTenantAdmin(global.oaeTests.tenants.cam.alias), true);

              // Update Joe
              const updateData = {
                locale: 'en_CA',
                displayName: 'Foo Bar'
              };
              RestAPI.User.updateUser(jack.restContext, joe.user.id, updateData, (error_) => {
                assert.notExists(error_);
                // Verify that the update has worked
                RestAPI.User.getMe(joe.restContext, (error, meObject) => {
                  assert.notExists(error);
                  assert.ok(meObject);
                  assert.strictEqual(meObject.displayName, 'Foo Bar');
                  assert.strictEqual(meObject.locale, 'en_CA');
                  assert.strictEqual(meObject.resourceType, 'user');
                  assert.strictEqual(
                    meObject.profilePath,
                    '/user/' + meObject.tenant.alias + '/' + AuthzUtil.getResourceFromId(meObject.id).resourceId
                  );

                  // Try to update Jane
                  RestAPI.User.updateUser(jack.restContext, jane.user.id, updateData, (error_) => {
                    assert.ok(error_);
                    assert.strictEqual(error_.code, 401);

                    // Verify that the update has not happened
                    RestAPI.User.getMe(jane.restContext, (error, meObject) => {
                      assert.notExists(error);
                      assert.ok(meObject);
                      assert.strictEqual(meObject.displayName, jane.user.displayName);
                      assert.strictEqual(meObject.locale, jane.user.locale);
                      assert.strictEqual(meObject.resourceType, 'user');
                      assert.strictEqual(
                        meObject.profilePath,
                        '/user/' + meObject.tenant.alias + '/' + AuthzUtil.getResourceFromId(meObject.id).resourceId
                      );

                      // Disable Jack's admin status
                      RestAPI.User.setTenantAdmin(asCambridgeTenantAdmin, jack.user.id, false, (error_) => {
                        assert.notExists(error_);

                        // Verify he is no longer an admin
                        PrincipalsAPI.getUser(new Context(global.oaeTests.tenants.cam), jack.user.id, (error, user) => {
                          assert.notExists(error);
                          assert.strictEqual(user.isGlobalAdmin(), false);
                          assert.strictEqual(user.isAdmin(global.oaeTests.tenants.cam.alias), false);
                          assert.strictEqual(user.isTenantAdmin(global.oaeTests.tenants.cam.alias), false);
                          return callback();
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
