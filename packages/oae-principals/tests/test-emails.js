/*
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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
import fs from 'fs';
import { format } from 'util';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { mergeRight } from 'ramda';
import * as AuthenticationTestUtil from 'oae-authentication/lib/test/util.js';
import * as AuthzInvitationsDAO from 'oae-authz/lib/invitations/dao.js';
import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import * as EmailTestsUtil from 'oae-email/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util.js';
import * as TestsUtil from 'oae-tests';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util.js';

const NO_MANAGERS = [];
const NO_FOLDERS = [];
const PUBLIC = 'public';

describe('User emails', () => {
  // REST contexts we can use to do REST requests
  let asCambridgeTenantAdmin = null;
  let asGeorgiaTechTenantAdmin = null;
  let asCambridgeAnonymousUser = null;
  let asGlobalAdmin = null;

  beforeEach((callback) => {
    asCambridgeAnonymousUser = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    asGeorgiaTechTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    asGlobalAdmin = TestsUtil.createGlobalAdminRestContext();

    // Disable reCaptcha so anonymous users can create accounts
    ConfigTestUtil.updateConfigAndWait(
      asCambridgeTenantAdmin,
      null,
      { 'oae-principals/recaptcha/enabled': false },
      (error) => {
        assert.notExists(error);

        // Drain the email queue
        return EmailTestsUtil.clearEmailCollections(callback);
      }
    );
  });

  after((callback) => {
    // Re-enable reCaptcha
    ConfigTestUtil.updateConfigAndWait(
      asCambridgeTenantAdmin,
      null,
      { 'oae-principals/recaptcha/enabled': true },
      (error) => {
        assert.notExists(error);
        return callback();
      }
    );
  });

  describe('Verification', () => {
    /**
     * Test that verifies validation when verifying an email address
     */
    it('verify validation when verifying an email address', (callback) => {
      // We can't use TestsUtil.generateTestUsers as that would do the verification process for us
      const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      const parameters = {
        username: TestsUtil.generateTestUserId(),
        password: 'password',
        displayName: TestsUtil.generateRandomText(1),
        email
      };
      const restContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
      PrincipalsTestUtil.assertCreateUserSucceeds(restContext, parameters, (user, token) => {
        AuthenticationTestUtil.assertLocalLoginSucceeds(restContext, parameters.username, parameters.password, () => {
          // Invalid user id
          PrincipalsTestUtil.assertVerifyEmailFails(restContext, 'not a user id', token, 400, () => {
            // Missing token
            PrincipalsTestUtil.assertVerifyEmailFails(restContext, user.id, null, 400, () => {
              // Invalid token
              PrincipalsTestUtil.assertVerifyEmailFails(
                restContext,
                user.id,
                'more than [7-14] characters',
                400,
                () => {
                  // Incorrect token
                  PrincipalsTestUtil.assertVerifyEmailFails(restContext, user.id, '123456789', 401, () => {
                    // Sanity-check
                    PrincipalsTestUtil.assertVerifyEmailSucceeds(restContext, user.id, token, () => {
                      // A token can only be verified once
                      PrincipalsTestUtil.assertVerifyEmailFails(restContext, user.id, token, 404, () => {
                        return callback();
                      });
                    });
                  });
                }
              );
            });
          });
        });
      });
    });

    /**
     * Test that verifies authorization when verifying an email address
     */
    it('verify authorization when verifying an email address', (callback) => {
      // We can't use TestsUtil.generateTestUsers as that would do the verification process for us
      const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      const parameters = {
        username: TestsUtil.generateTestUserId(),
        password: 'password',
        displayName: TestsUtil.generateRandomText(1),
        email
      };
      const restContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
      PrincipalsTestUtil.assertCreateUserSucceeds(restContext, parameters, (user, token) => {
        // Anonymous users cannot verify an email address
        PrincipalsTestUtil.assertVerifyEmailFails(asCambridgeAnonymousUser, user.id, token, 401, () => {
          // Other users cannot verify an email address
          TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
            assert.notExists(error);
            const { 0: badGuy } = users;
            PrincipalsTestUtil.assertVerifyEmailFails(badGuy.restContext, user.id, token, 401, () => {
              // Tenant admins from other tenants cannot verify an email address
              PrincipalsTestUtil.assertVerifyEmailFails(asGeorgiaTechTenantAdmin, user.id, token, 401, () => {
                // The user can verify their email address if they've signed in
                AuthenticationTestUtil.assertLocalLoginSucceeds(
                  restContext,
                  parameters.username,
                  parameters.password,
                  () => {
                    PrincipalsTestUtil.assertVerifyEmailSucceeds(restContext, user.id, token, () => {
                      return callback();
                    });
                  }
                );
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that a token from another user cannot be used
     */
    it('verify a token from another user cannot be used', (callback) => {
      // We can't use TestsUtil.generateTestUsers as that would do the verification process for us
      const parametersUser1 = {
        username: TestsUtil.generateTestUserId(),
        password: 'password',
        displayName: TestsUtil.generateRandomText(1),
        email: TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0])
      };
      const restContextUser1 = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
      PrincipalsTestUtil.assertCreateUserSucceeds(restContextUser1, parametersUser1, (user1, tokenUser1) => {
        AuthenticationTestUtil.assertLocalLoginSucceeds(restContextUser1, parametersUser1.username, 'password', () => {
          const parametersUser2 = {
            username: TestsUtil.generateTestUserId(),
            password: 'password',
            displayName: TestsUtil.generateRandomText(1),
            email: TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0])
          };
          const restContextUser2 = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
          PrincipalsTestUtil.assertCreateUserSucceeds(restContextUser2, parametersUser2, (user2 /* , tokenUser2 */) => {
            AuthenticationTestUtil.assertLocalLoginSucceeds(
              restContextUser2,
              parametersUser2.username,
              'password',
              () => {
                // Assert we cannot user the token from the first user
                PrincipalsTestUtil.assertVerifyEmailFails(restContextUser2, user2.id, tokenUser1, 401, () => {
                  return callback();
                });
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies that an email address can be re-used by other users
     */
    it('verify an email address can be re-used by other users', (callback) => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(
        tenantAlias,
        tenantHost,
        (error, tenant, tenantAdminRestContext /* , tenantAdmin */) => {
          assert.notExists(error);

          // Disable reCaptcha for this tenant
          ConfigTestUtil.updateConfigAndWait(
            asGlobalAdmin,
            tenantAlias,
            { 'oae-principals/recaptcha/enabled': false },
            (error_) => {
              assert.notExists(error_);

              const email = TestsUtil.generateTestEmailAddress(null, tenantHost);
              const parametersUser1 = {
                displayName: 'Test user 1',
                email,
                password: 'password',
                username: TestsUtil.generateTestUserId()
              };
              const parametersUser2 = {
                displayName: 'Test user 2',
                email,
                password: 'password',
                username: TestsUtil.generateTestUserId()
              };

              // Create the first user as a tenant admin so the email address is considered verified
              PrincipalsTestUtil.assertCreateUserSucceeds(tenantAdminRestContext, parametersUser1, (user1) => {
                // Verify there's a mapping for the first user
                PrincipalsTestUtil.assertUserEmailMappingEquals(email, [user1.id], () => {
                  // Create the second user as an anonymous user so the email address is not verified
                  const restContext = TestsUtil.createTenantRestContext(tenantHost);
                  PrincipalsTestUtil.assertCreateUserSucceeds(restContext, parametersUser2, (user2, token) => {
                    // Verify there's no mapping yet for the second user as the email address
                    // hasn't been verified yet
                    PrincipalsTestUtil.assertUserEmailMappingEquals(email, [user1.id], () => {
                      // Verify the email address
                      AuthenticationTestUtil.assertLocalLoginSucceeds(
                        restContext,
                        parametersUser2.username,
                        parametersUser2.password,
                        () => {
                          PrincipalsTestUtil.assertVerifyEmailSucceeds(restContext, user2.id, token, () => {
                            // The second user should now also be mapped to the email address
                            PrincipalsTestUtil.assertUserEmailMappingEquals(email, [user1.id, user2.id], () => {
                              return callback();
                            });
                          });
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
     * Test that verifies that local accounts need to verify their email address
     */
    it('verify local user accounts need to verify their email address', (callback) => {
      // We can't use TestsUtil.generateTestUsers as that would do the verification process for us
      const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      const parameters = {
        username: TestsUtil.generateTestUserId(),
        password: 'password',
        displayName: TestsUtil.generateRandomText(1),
        email
      };
      PrincipalsTestUtil.assertCreateUserSucceeds(asCambridgeAnonymousUser, parameters, (user, token) => {
        // Sanity check the user has no `email` property yet
        RestAPI.User.getUser(asCambridgeTenantAdmin, user.id, (error, user) => {
          assert.notExists(error);
          assert.ok(!user.email);

          // Assert that there's no mapping yet for the email address
          PrincipalsTestUtil.assertUserEmailMappingEquals(email, [], () => {
            // Verify the email address
            const restContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
            AuthenticationTestUtil.assertLocalLoginSucceeds(
              restContext,
              parameters.username,
              parameters.password,
              () => {
                PrincipalsTestUtil.assertVerifyEmailSucceeds(restContext, user.id, token, () => {
                  // Assert the mapping has been created
                  PrincipalsTestUtil.assertUserEmailMappingEquals(email, [user.id], () => {
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
     * Test that verifies that activity emails are not sent to unverified email addresses
     */
    it('verify activity emails are not sent to unverified email addresses', (callback) => {
      // We can't use TestsUtil.generateTestUsers as that would do the verification process for us
      const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      const parameters = {
        username: TestsUtil.generateTestUserId(),
        password: 'password',
        displayName: TestsUtil.generateRandomText(1),
        email
      };
      PrincipalsTestUtil.assertCreateUserSucceeds(asCambridgeAnonymousUser, parameters, (user /* , token */) => {
        // Generate some more users who will be part of the activity
        TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
          assert.notExists(error);
          const { 0: simong, 1: mrvisser } = users;

          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'Google',
              description: 'Google',
              PUBLIC,
              link: 'https://www.google.it',
              managers: NO_MANAGERS,
              viewers: [user.id, mrvisser.user.id],
              folders: NO_FOLDERS
            },
            (error /* , link */) => {
              assert.notExists(error);

              // Mrvisser should've received an email, but not the user with the unverified email address
              EmailTestsUtil.collectAndFetchAllEmails((messages) => {
                assert.lengthOf(messages, 1);
                assert.lengthOf(messages[0].to, 1);
                assert.strictEqual(messages[0].to[0].address, mrvisser.user.email);
                return callback();
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies that local users accounts created by a tenant administrator do not need to verify their email address
     */
    it('verify local user accounts created by a tenant administrator do not need to verify their email address', (callback) => {
      // We can't use TestsUtil.generateTestUsers as that would do the verification process for us
      const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      const parameters = {
        username: TestsUtil.generateTestUserId(),
        password: 'password',
        displayName: TestsUtil.generateRandomText(1),
        email
      };
      PrincipalsTestUtil.assertCreateUserSucceeds(asCambridgeTenantAdmin, parameters, (user) => {
        // Verify the user doesn't need to verify their email address
        RestAPI.User.getUser(asCambridgeTenantAdmin, user.id, (error, user) => {
          assert.notExists(error);
          assert.strictEqual(user.email, email.toLowerCase());

          // Assert that there's a mapping for the email address
          PrincipalsTestUtil.assertUserEmailMappingEquals(email, [user.id], () => {
            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies when a user follows an invitation into creating
     * an external account, where the external provider does not provide an
     * email address (e.g., Facebook), that they receive the email associated
     * with the invitation as a pre-verified email
     */
    it('verify user accounts created following invitation with external login do not require email verification', (callback) => {
      // Create a tenant and enable Facebook authentication on it
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(tenantAlias, tenantHost, (error, tenant, tenantAdminRestContext) => {
        assert.notExists(error);
        AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
          tenantAdminRestContext,
          null,
          { 'oae-authentication/facebook/enabled': true },
          () => {
            // Remove the tenant's email domain so we can sign in through Facebook
            TenantsTestUtil.updateTenantAndWait(asGlobalAdmin, tenant.alias, { emailDomains: '' }, () => {
              // First make sure authenticating without email and no
              // invitation results in a user without an email
              AuthenticationTestUtil.assertFacebookLoginSucceeds(tenant.host, null, (restContext, me) => {
                assert.ok(!me.email);

                // Create an invitation
                let email = TestsUtil.generateTestEmailAddress(null, tenant.emailDomains[0]);
                PrincipalsTestUtil.assertCreateGroupSucceeds(
                  tenantAdminRestContext,
                  'My Group',
                  'My description',
                  'public',
                  'yes',
                  [email],
                  null,
                  (/* group */) => {
                    email = email.toLowerCase();

                    // Get the invitation info so we can make a redirect url
                    AuthzInvitationsDAO.getTokensByEmails([email], (error, tokensByEmail) => {
                      assert.notExists(error);
                      const token = tokensByEmail[email];

                      // Authenticate without an email while following the redirect url
                      const redirectUrl = format(
                        '/signup?invitationToken=%s&invitationEmail=%s',
                        encodeURIComponent(token),
                        encodeURIComponent(email)
                      );
                      AuthenticationTestUtil.assertFacebookLoginSucceeds(
                        tenant.host,
                        { redirectUrl },
                        (restContext, me) => {
                          assert.strictEqual(me.email, email);
                          return callback();
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

    /**
     * Test that verifies that user accounts created through trusted external SSO sources do not need to verify their email address
     */
    it('verify user accounts created through trusted external SSO sources do not need to verify their email address', (callback) => {
      // Create a tenant and enable google authentication on it
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(tenantAlias, tenantHost, (error, tenant, tenantAdminRestContext) => {
        assert.notExists(error);
        AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
          tenantAdminRestContext,
          null,
          { 'oae-authentication/google/enabled': true },
          () => {
            // Sign in through google
            const email = TestsUtil.generateTestEmailAddress(null, tenant.emailDomains[0]);
            AuthenticationTestUtil.assertGoogleLoginSucceeds(tenant.host, email, (restContext /* , response */) => {
              // As google is considered an authoritative source, the user shouldn't have
              // to verify their email address
              RestAPI.User.getMe(restContext, (error, me) => {
                assert.notExists(error);
                assert.isNotOk(me.anon);
                assert.strictEqual(me.email, email.toLowerCase());

                // Assert that there's a mapping for the email address
                PrincipalsTestUtil.assertUserEmailMappingEquals(email, [me.id], () => {
                  return callback();
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that user accounts created with a valid invitation token whose email
     * matches the specified email do not need to verify their email address
     */
    it('verify user accounts created with a valid invitation token are automatically verified', (callback) => {
      // Create a tenant in which to create a user, and ensure there are no pending emails
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(tenantAlias, tenantHost, (error, tenant /* , tenantAdminRestContext */) => {
        assert.notExists(error);

        // Create 2 email addresses that have tokens associated to them
        const email1 = TestsUtil.generateTestEmailAddress(null, tenant.emailDomains[0]);
        const email2 = TestsUtil.generateTestEmailAddress(null, tenant.emailDomains[0]);
        AuthzInvitationsDAO.getOrCreateTokensByEmails([email1, email2], (error, emailTokens) => {
          assert.notExists(error);

          // Try to create a profile with email1, using email2's token. It should work, but it shouldn't auto-verify the email address
          let profile = {
            username: TestsUtil.generateTestUserId(),
            password: 'password',
            displayName: TestsUtil.generateRandomText(),
            email: email1,
            invitationToken: emailTokens[email2]
          };

          // Ensure we get a user with an unverified email, as well as one email which is a verification email for email1
          EmailTestsUtil.startCollectingEmail((stopCollectingEmail) => {
            PrincipalsTestUtil.assertCreateUserSucceeds(
              TestsUtil.createTenantRestContext(tenantHost),
              profile,
              (user) => {
                assert.isNotOk(user.email);

                stopCollectingEmail((messages) => {
                  assert.lengthOf(messages, 1);

                  /**
                   * Now create a profile with the matching email1 token and ensure
                   * email is automatically verified
                   */
                  profile = mergeRight(profile, {
                    username: TestsUtil.generateTestUserId(),
                    invitationToken: emailTokens[email1]
                  });

                  EmailTestsUtil.startCollectingEmail((stopCollectingEmail) => {
                    // We should get a profile with a verified email and no verification email
                    PrincipalsTestUtil.assertCreateUserSucceeds(
                      TestsUtil.createTenantRestContext(tenantHost),
                      profile,
                      (user) => {
                        assert.strictEqual(user.email, email1.toLowerCase());
                        stopCollectingEmail((messages) => {
                          assert.isEmpty(messages);
                          return callback();
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
    });

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
     * Test that verifies that user accounts created or updated through a CSV import do not need to verify their email address
     */
    it('verify user accounts created or updated through a CSV import do not need to verify their email address', (callback) => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = 'users.emails.com';
      TestsUtil.createTenantWithAdmin(tenantAlias, tenantHost, (error, tenant /* , tenantAdminRestContext */) => {
        assert.notExists(error);

        // Import users as a global admin using a local authentication strategy
        PrincipalsTestUtil.importUsers(
          asGlobalAdmin,
          tenant.alias,
          getDataFileStream('users-emails.csv'),
          'local',
          null,
          (error_) => {
            assert.notExists(error_);

            // Verify the user's email address is verified
            const restContext = TestsUtil.createTenantRestContext(tenant.host, 'users-emails-abc123', 'password');
            setTimeout(RestAPI.User.getMe, 15000, restContext, (error, user) => {
              assert.notExists(error);
              assert.strictEqual(user.email, 'foo@users.emails.com');

              // Assert there's a mapping for the email address
              PrincipalsTestUtil.assertUserEmailMappingEquals('foo@users.emails.com', [user.id], () => {
                // Update the email address through a CSV import
                PrincipalsTestUtil.importUsers(
                  asGlobalAdmin,
                  tenant.alias,
                  getDataFileStream('users-emails-updated.csv'),
                  'local',
                  true,
                  (error_) => {
                    assert.notExists(error_);

                    RestAPI.User.getMe(restContext, (error, user) => {
                      assert.notExists(error);
                      assert.strictEqual(user.email, 'bar@users.emails.com');

                      // Assert there's a mapping for the new email address
                      PrincipalsTestUtil.assertUserEmailMappingEquals('bar@users.emails.com', [user.id], () => {
                        // Assert there's no mapping for the old email address
                        PrincipalsTestUtil.assertUserEmailMappingEquals('foo@users.emails.com', [], () => {
                          return callback();
                        });
                      });
                    });
                  }
                );
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that users updating their email address need to verify it
     */
    it('verify users updating their email address need to verify it', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;
        const oldEmailAddress = simong.user.email;

        // Sanity-check the email address is verified
        RestAPI.User.getMe(simong.restContext, (error, me) => {
          assert.notExists(error);
          assert.strictEqual(me.email, oldEmailAddress);

          // Sanity-check there's a mapping for it
          PrincipalsTestUtil.assertUserEmailMappingEquals(me.email, [me.id], () => {
            // Update the email address
            const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
            PrincipalsTestUtil.assertUpdateUserSucceeds(
              simong.restContext,
              simong.user.id,
              { email },
              (user, token) => {
                // Assert the old mapping is still in place
                PrincipalsTestUtil.assertUserEmailMappingEquals(oldEmailAddress, [me.id], () => {
                  // Assert there's no mapping for the new email address as it hasn't been verified yet
                  PrincipalsTestUtil.assertUserEmailMappingEquals(email, [], () => {
                    // The old email address should still be in place as the new one hasn't been verified yet
                    RestAPI.User.getMe(simong.restContext, (error, me) => {
                      assert.notExists(error);
                      assert.strictEqual(me.email, oldEmailAddress);

                      // Assert we can verify the email address
                      PrincipalsTestUtil.assertVerifyEmailSucceeds(simong.restContext, simong.user.id, token, () => {
                        // Assert the old mapping is gone
                        PrincipalsTestUtil.assertUserEmailMappingEquals(oldEmailAddress, [], () => {
                          // Assert the new mapping is there
                          PrincipalsTestUtil.assertUserEmailMappingEquals(email, [me.id], () => {
                            // The new email address should be confirmed
                            RestAPI.User.getMe(simong.restContext, (error, me) => {
                              assert.notExists(error);
                              assert.strictEqual(me.email, email.toLowerCase());
                              return callback();
                            });
                          });
                        });
                      });
                    });
                  });
                });
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies that admin updates to a user's email address trigger a different email message
     */
    it("verify admin updates to a user's email address trigger a different email message", (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;
        const oldEmailAddress = simong.user.email;

        // Let an administrator update the email address
        const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
        PrincipalsTestUtil.assertUpdateUserSucceeds(
          asCambridgeTenantAdmin,
          simong.user.id,
          { email },
          (user /* , token */) => {
            // The email address still has to be verified
            assert.strictEqual(user.email, oldEmailAddress);
            return callback();
          }
        );
      });
    });

    /**
     * Test that verifies that users can only verify their last updated email address
     */
    it('verify users can only verify their last updated email address', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;
        const oldEmailAddress = simong.user.email;

        // Update the email address for the first time
        const email1 = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
        PrincipalsTestUtil.assertUpdateUserSucceeds(
          simong.restContext,
          simong.user.id,
          { email: email1 },
          (user, token1) => {
            // Update the email address again (with a second email address)
            const email2 = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
            PrincipalsTestUtil.assertUpdateUserSucceeds(
              simong.restContext,
              simong.user.id,
              { email: email2 },
              (user, token2) => {
                // Using the first token to verify the email address should fail
                PrincipalsTestUtil.assertVerifyEmailFails(simong.restContext, simong.user.id, token1, 401, () => {
                  // Using the second token we can verify the email address
                  PrincipalsTestUtil.assertVerifyEmailSucceeds(simong.restContext, simong.user.id, token2, () => {
                    // Assert the old mapping is gone
                    PrincipalsTestUtil.assertUserEmailMappingEquals(oldEmailAddress, [], () => {
                      // Assert no mapping was created for the first email address
                      PrincipalsTestUtil.assertUserEmailMappingEquals(email1, [], () => {
                        // Assert a mapping for the second email address is created
                        PrincipalsTestUtil.assertUserEmailMappingEquals(email2, [simong.user.id], () => {
                          // The second email address should be confirmed
                          RestAPI.User.getMe(simong.restContext, (error, me) => {
                            assert.notExists(error);
                            assert.strictEqual(me.email, email2.toLowerCase());
                            return callback();
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
    });
  });

  describe('Resending an email verification token', () => {
    /**
     * Test that verifies that an email verification token can be resent
     */
    it('verify an email verification token can be resent', (callback) => {
      // We can't use TestsUtil.generateTestUsers as that would do the verification process for us
      const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      const parameters = {
        username: TestsUtil.generateTestUserId(),
        password: 'password',
        displayName: TestsUtil.generateRandomText(1),
        email
      };
      const restContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
      PrincipalsTestUtil.assertCreateUserSucceeds(restContext, parameters, (user, token) => {
        RestAPI.Authentication.login(restContext, parameters.username, 'password', (error) => {
          assert.notExists(error);

          // Verify we can resend the email verification token
          PrincipalsTestUtil.assertResendEmailTokenSucceeds(restContext, user.id, (newToken) => {
            // Assert we've sent the same token
            assert.strictEqual(newToken, token);

            // Sanity-check we can use this new token to verify the email address
            PrincipalsTestUtil.assertVerifyEmailSucceeds(restContext, user.id, newToken, () => {
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies validation when resending an email verification token
     */
    it('verify validation when resending an email verification token', (callback) => {
      // We can't use TestsUtil.generateTestUsers as that would do the verification process for us
      const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      const parameters = {
        username: TestsUtil.generateTestUserId(),
        password: 'password',
        displayName: TestsUtil.generateRandomText(1),
        email
      };
      const restContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
      PrincipalsTestUtil.assertCreateUserSucceeds(restContext, parameters, (/* user, token */) => {
        RestAPI.Authentication.login(restContext, parameters.username, 'password', (error) => {
          assert.notExists(error);

          // Invalid user id
          PrincipalsTestUtil.assertResendEmailTokenFails(restContext, 'not a user id', 400, () => {
            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies authorization when resending an email verification token
     */
    it('verify authorization when resending an email verification token', (callback) => {
      // We can't use TestsUtil.generateTestUsers as that would do the verification process for us
      const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      const parameters = {
        username: TestsUtil.generateTestUserId(),
        password: 'password',
        displayName: TestsUtil.generateRandomText(1),
        email
      };
      const restContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
      PrincipalsTestUtil.assertCreateUserSucceeds(restContext, parameters, (user /* , token */) => {
        RestAPI.Authentication.login(restContext, parameters.username, 'password', (error) => {
          assert.notExists(error);

          // Anonymous users can't resend a token
          PrincipalsTestUtil.assertResendEmailTokenFails(asCambridgeAnonymousUser, user.id, 401, () => {
            // Users cannot resend a token for someone else
            TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
              assert.notExists(error);
              const { 0: otherUser } = users;
              PrincipalsTestUtil.assertResendEmailTokenFails(otherUser.restContext, user.id, 401, () => {
                // Tenant administrators from another tenant cannot resend a token
                PrincipalsTestUtil.assertResendEmailTokenFails(asGeorgiaTechTenantAdmin, user.id, 401, () => {
                  // Tenant administrators from the same tenant as the user can resend a token
                  PrincipalsTestUtil.assertResendEmailTokenSucceeds(
                    asCambridgeTenantAdmin,
                    user.id,
                    (/* newToken */) => {
                      // Global administrators can resend a token
                      PrincipalsTestUtil.assertResendEmailTokenSucceeds(asGlobalAdmin, user.id, (/* newToken */) => {
                        return callback();
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

    /**
     * Test that verifies that a token can only be resent when there is a pending verification
     */
    it('verify that a token can only be resent when there is a pending verification', (callback) => {
      // Create a user who has no pending email verification token
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;

        // Resending a token should fail as there is no token to resend
        PrincipalsTestUtil.assertResendEmailTokenFails(simong.restContext, simong.user.id, 404, () => {
          // Update the email address so we get a token
          const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
          PrincipalsTestUtil.assertUpdateUserSucceeds(
            simong.restContext,
            simong.user.id,
            { email },
            (/* user, token */) => {
              // Resending a token now should be OK
              PrincipalsTestUtil.assertResendEmailTokenSucceeds(simong.restContext, simong.user.id, (newToken) => {
                // Use the token to verify the new email address
                PrincipalsTestUtil.assertVerifyEmailSucceeds(simong.restContext, simong.user.id, newToken, () => {
                  // Resending a token should now fail as the token has been used and should be removed
                  PrincipalsTestUtil.assertResendEmailTokenFails(simong.restContext, simong.user.id, 404, () => {
                    return callback();
                  });
                });
              });
            }
          );
        });
      });
    });
  });

  describe('Has pending email verification token', () => {
    /**
     * Test that verifies the has pending email verification token functionality
     */
    it('verify has pending email verification token functionality', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;

        // Verify no email is returned when the user has no pending verification
        PrincipalsTestUtil.assertGetEmailTokenSucceeds(simong.restContext, simong.user.id, (email) => {
          assert.ok(!email);

          // Update the user's email address
          email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
          PrincipalsTestUtil.assertUpdateUserSucceeds(simong.restContext, simong.user.id, { email }, () => {
            // Verify the user as a token
            PrincipalsTestUtil.assertGetEmailTokenSucceeds(simong.restContext, simong.user.id, (emailForToken) => {
              assert.strictEqual(emailForToken, email.toLowerCase());

              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies validation when checking for a pending email verification token
     */
    it('verify validation when checking for a pending email verification token', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;

        // Invalid user id
        PrincipalsTestUtil.assertGetEmailTokenFails(simong.restContext, 'not a user id', 400, () => {
          PrincipalsTestUtil.assertGetEmailTokenFails(simong.restContext, 'g:camtest:1234234', 400, () => {
            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies authorization when checking for a pending email verification token
     */
    it('verify authorization when checking for a pending email verification token', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: simong, 1: mrvisser } = users;

        // Update simon's email address so he has a verification token
        const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
        PrincipalsTestUtil.assertUpdateUserSucceeds(simong.restContext, simong.user.id, { email }, () => {
          // Anonymous users cannot check anything
          PrincipalsTestUtil.assertGetEmailTokenFails(asCambridgeAnonymousUser, simong.user.id, 401, () => {
            // Users cannot check other users their email tokens
            PrincipalsTestUtil.assertGetEmailTokenFails(mrvisser.restContext, simong.user.id, 401, () => {
              // Tenant administrator cannot check users from another tenant their email token
              PrincipalsTestUtil.assertGetEmailTokenFails(asGeorgiaTechTenantAdmin, simong.user.id, 401, () => {
                // A user can check his own pending email verification token
                PrincipalsTestUtil.assertGetEmailTokenSucceeds(
                  simong.restContext,
                  simong.user.id,
                  (/* emailForToken */) => {
                    // A tenant admin can check the pending email verification token for users of their tenant
                    PrincipalsTestUtil.assertGetEmailTokenSucceeds(
                      asCambridgeTenantAdmin,
                      simong.user.id,
                      (/* emailForToken */) => {
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

  describe('Delete an email verification token', () => {
    /**
     * Test that verifies the delete email verification functionality
     */
    it('verify delete email verification token functionality', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;

        // Update the email address
        const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
        PrincipalsTestUtil.assertUpdateUserSucceeds(simong.restContext, simong.user.id, { email }, () => {
          // Delete the token
          PrincipalsTestUtil.assertDeleteEmailTokenSucceeds(simong.restContext, simong.user.id, () => {
            // Verify a token can't be deleted twice
            PrincipalsTestUtil.assertDeleteEmailTokenFails(simong.restContext, simong.user.id, 404, () => {
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies validation when deleting a pending email verification token
     */
    it('verify validation when deleting a pending email verification token', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;

        // Invalid user id
        PrincipalsTestUtil.assertDeleteEmailTokenFails(simong.restContext, 'not a user id', 400, () => {
          PrincipalsTestUtil.assertDeleteEmailTokenFails(simong.restContext, 'g:camtest:1234234', 400, () => {
            // No token should return a 404
            PrincipalsTestUtil.assertDeleteEmailTokenFails(simong.restContext, simong.user.id, 404, () => {
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies authorization when deleting a pending email verification token
     */
    it('verify authorization when deleting a pending email verification token', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: simong, 1: mrvisser } = users;

        // Update simon's email address so he has a verification token
        let email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
        PrincipalsTestUtil.assertUpdateUserSucceeds(simong.restContext, simong.user.id, { email }, () => {
          // Anonymous users cannot delete anything
          PrincipalsTestUtil.assertDeleteEmailTokenFails(asCambridgeAnonymousUser, simong.user.id, 401, () => {
            // Users cannot delete other users their email tokens
            PrincipalsTestUtil.assertDeleteEmailTokenFails(mrvisser.restContext, simong.user.id, 401, () => {
              // Tenant administrator cannot delete users from another tenant their email token
              PrincipalsTestUtil.assertDeleteEmailTokenFails(asGeorgiaTechTenantAdmin, simong.user.id, 401, () => {
                // A user can delete his own pending email verification token
                PrincipalsTestUtil.assertDeleteEmailTokenSucceeds(
                  simong.restContext,
                  simong.user.id,
                  (/* emailForToken */) => {
                    email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
                    PrincipalsTestUtil.assertUpdateUserSucceeds(simong.restContext, simong.user.id, { email }, () => {
                      // A tenant admin can delete the pending email verification token for users of their tenant
                      PrincipalsTestUtil.assertDeleteEmailTokenSucceeds(
                        asCambridgeTenantAdmin,
                        simong.user.id,
                        (/* emailForToken */) => {
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
