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
import * as ConfigTestUtil from 'oae-config/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import { RestContext } from 'oae-rest/lib/model';

const PUBLIC = 'public';

describe('Terms and Conditions', () => {
  // Rest context that can be used every time we need to make a request as a global admin
  let asGlobalAdmin = null;
  // Rest context that can be used every time we need to make a request as a tenant admin
  let asCambridgeTenantAdmin = null;
  // Rest context that can be used every time we need to make a request as an anonymous user
  let asCambridgeAnonymousUser = null;

  /**
   * Function that will fill up the rest contexts
   */
  before((callback) => {
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    asCambridgeAnonymousUser = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    asGlobalAdmin = TestsUtil.createGlobalAdminRestContext();
    return callback();
  });

  /**
   * Function that will disable and clear the Terms and Conditions after each test
   */
  afterEach((callback) => {
    ConfigTestUtil.clearConfigAndWait(
      asCambridgeTenantAdmin,
      null,
      ['oae-principals/termsAndConditions/enabled'],
      (error) => {
        assert.notExists(error);
        ConfigTestUtil.clearConfigAndWait(
          asCambridgeTenantAdmin,
          null,
          ['oae-principals/termsAndConditions/text'],
          (error) => {
            assert.notExists(error);
            return callback();
          }
        );
      }
    );
  });

  /**
   * Enables the Terms and Conditions and sets the text
   *
   * @param  {RestContext}    ctx             The RestContext to use to try to set the Terms and Conditions
   * @param  {String}         locale          The locale for which to set the text
   * @param  {String}         text            The text to set
   * @param  {Boolean}        expectSuccess   Whether or not it should be expected for the config update to return succesfully
   * @param  {Function}       callback        Standard callback function
   * @throws {Error}                          Assertion error is thrown if the config update does not return as the `expectSuccess` variable declares
   */
  const enableAndSetTC = function (ctx, locale, text, expectSuccess, callback) {
    // Enable the Terms and Conditions
    const update = {};
    update['oae-principals/termsAndConditions/enabled'] = true;
    update['oae-principals/termsAndConditions/text/' + locale] = text;
    ConfigTestUtil.updateConfigAndWait(asCambridgeTenantAdmin, null, update, (error) => {
      if (expectSuccess) {
        assert.notExists(error);
      } else {
        assert.ok(error);
      }

      return callback();
    });
  };

  /**
   * Test that verifies that user need to accept the Terms and Conditions when creating an account
   */
  it('verify users need to accept the Terms and Conditions when creating an account', (callback) => {
    // Disable reCaptcha
    ConfigTestUtil.updateConfigAndWait(
      asCambridgeTenantAdmin,
      null,
      { 'oae-principals/recaptcha/enabled': false },
      (error) => {
        assert.notExists(error);

        // Enable the Terms and Conditions and publish a text
        enableAndSetTC(asCambridgeTenantAdmin, 'default', 'legalese', true, () => {
          // Not passing in acceptedTC: true should result in a 400
          const username = TestsUtil.generateRandomText(5);
          const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
          RestAPI.User.createUser(asCambridgeAnonymousUser, username, 'password', 'Test User', email, {}, (
            error /* , userObj */
          ) => {
            assert.strictEqual(error.code, 400);
            RestAPI.User.createUser(
              asCambridgeAnonymousUser,
              username,
              'password',
              'Test User',
              email,
              { acceptedTC: false },
              (error /* , userObj */) => {
                assert.strictEqual(error.code, 400);
                RestAPI.User.createUser(
                  asCambridgeAnonymousUser,
                  username,
                  'password',
                  'Test User',
                  email,
                  { acceptedTC: 'wrong' },
                  (error /* , userObj */) => {
                    assert.strictEqual(error.code, 400);

                    RestAPI.User.createUser(
                      asCambridgeAnonymousUser,
                      username,
                      'password',
                      'Test User',
                      email,
                      { acceptedTC: true },
                      (error, userObject) => {
                        assert.notExists(error);
                        assert.strictEqual(typeof userObject.acceptedTC, 'number');
                        assert.ok(userObject.acceptedTC <= Date.now());
                        assert.strictEqual(userObject.needsToAcceptTC, false);

                        // Re-enable the reCaptcha checks
                        ConfigTestUtil.updateConfigAndWait(
                          asCambridgeTenantAdmin,
                          null,
                          { 'oae-principals/recaptcha/enabled': true },
                          (error_) => {
                            assert.notExists(error_);
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
        });
      }
    );
  });

  /**
   * Test that verifies that users cannot interact with the system when a Terms and Conditions comes into effect
   */
  it('verify users need to accept the Terms and Conditions before they can interact with the system', (callback) => {
    TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);
      const { 0: mrvisser } = users;

      // Enable the Terms and Conditions and publish a text
      enableAndSetTC(asCambridgeTenantAdmin, 'default', 'legalese', true, () => {
        // When the user tries to *do* anything, he needs to accept the Terms and Conditions
        RestAPI.Content.createLink(
          mrvisser.restContext,
          {
            displayName: 'Yahoo',
            description: 'Yahoo',
            PUBLIC,
            link: 'http://uk.yahoo.com',
            managers: [],
            viewers: [],
            folders: []
          },
          (error, link) => {
            assert.ok(error);
            assert.strictEqual(error.code, 419);
            assert.ok(!link);

            RestAPI.User.getMe(mrvisser.restContext, (error, data) => {
              assert.notExists(error);
              assert.ok(data.needsToAcceptTC);

              // Verify there is nothing in this user's library
              RestAPI.Content.getLibrary(mrvisser.restContext, mrvisser.user.id, null, 10, (error, library) => {
                assert.notExists(error);
                assert.strictEqual(library.results.length, 0);

                // Accept the Terms and Conditions for the cam tenant.
                RestAPI.User.acceptTermsAndConditions(mrvisser.restContext, mrvisser.user.id, (error_) => {
                  assert.notExists(error_);

                  RestAPI.User.getMe(mrvisser.restContext, (error, data) => {
                    assert.notExists(error);
                    assert.ok(!data.needsToAcceptTC);

                    // Verify that it is now possible to perform POST requests
                    RestAPI.Content.createLink(
                      mrvisser.restContext,
                      {
                        displayName: 'Yahoo',
                        description: 'Yahoo',
                        PUBLIC,
                        link: 'http://uk.yahoo.com',
                        managers: [],
                        viewers: [],
                        folders: []
                      },
                      (error, createdLink) => {
                        assert.notExists(error);
                        RestAPI.Content.getLibrary(
                          mrvisser.restContext,
                          mrvisser.user.id,
                          null,
                          10,
                          (error, library) => {
                            assert.notExists(error);
                            assert.strictEqual(library.results.length, 1);

                            // Update the Terms and Conditions, ensuring we wait long enough to get a new timestamp
                            setTimeout(
                              enableAndSetTC,
                              500,
                              asCambridgeTenantAdmin,
                              'default',
                              'new legalese',
                              true,
                              () => {
                                // Mrvisser needs to re-accept the Terms and Conditions before he can continue working on the system
                                RestAPI.User.getMe(mrvisser.restContext, (error, data) => {
                                  assert.notExists(error);
                                  assert.ok(data.needsToAcceptTC);

                                  RestAPI.Content.createLink(
                                    mrvisser.restContext,
                                    {
                                      displayName: 'Yahoo',
                                      description: 'Yahoo',
                                      visibility: PUBLIC,
                                      link: 'http://uk.yahoo.com',
                                      managers: [],
                                      viewers: [],
                                      folders: []
                                    },
                                    (error, link) => {
                                      assert.ok(error);
                                      assert.strictEqual(error.code, 419);
                                      assert.ok(!link);

                                      // DELETEs should not be possible
                                      RestAPI.Content.deleteContent(mrvisser.restContext, createdLink.id, (error_) => {
                                        assert.ok(error_);
                                        assert.strictEqual(error_.code, 419);

                                        // Sanity check that re-accepting it, allows mrvisser to perform POST requests again
                                        setTimeout(
                                          RestAPI.User.acceptTermsAndConditions,
                                          200,
                                          mrvisser.restContext,
                                          mrvisser.user.id,
                                          (error_) => {
                                            assert.notExists(error_);
                                            setTimeout(
                                              RestAPI.User.getMe,
                                              1000,
                                              mrvisser.restContext,
                                              (error, data) => {
                                                assert.notExists(error);
                                                assert.ok(!data.needsToAcceptTC);

                                                // Verify that the user is now able to perform POST requests
                                                RestAPI.Content.createLink(
                                                  mrvisser.restContext,
                                                  {
                                                    displayName: 'Yahoo',
                                                    description: 'Yahoo',
                                                    visibility: PUBLIC,
                                                    link: 'http://uk.yahoo.com',
                                                    managers: [],
                                                    viewers: [],
                                                    folders: []
                                                  },
                                                  (error, link) => {
                                                    assert.notExists(error);
                                                    RestAPI.Content.getLibrary(
                                                      mrvisser.restContext,
                                                      mrvisser.user.id,
                                                      null,
                                                      10,
                                                      (error, library) => {
                                                        assert.notExists(error);
                                                        assert.strictEqual(library.results.length, 2);

                                                        // DELETEs should be possible
                                                        RestAPI.Content.deleteContent(
                                                          mrvisser.restContext,
                                                          link.id,
                                                          (error_) => {
                                                            assert.notExists(error_);
                                                            RestAPI.Content.getLibrary(
                                                              mrvisser.restContext,
                                                              mrvisser.user.id,
                                                              null,
                                                              10,
                                                              (error, library) => {
                                                                assert.notExists(error);
                                                                assert.strictEqual(library.results.length, 1);
                                                                callback();
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
                                });
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
      });
    });
  });

  /**
   * Test that verifies that anonymous users don't need to accept the Terms and Conditions
   */
  it("verify anonymous users don't need to accept the Terms and Conditions", (callback) => {
    RestAPI.User.getMe(asCambridgeAnonymousUser, (error, data) => {
      assert.notExists(error);
      assert.ok(!data.needsToAcceptTC);
      callback();
    });
  });

  /**
   * Test that verifies that admins don't need to accept the Terms and Conditions to
   * interact with the system
   */
  it("verify admins don't need to accept the Terms and Conditions", (callback) => {
    TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);
      const { 0: mrvisser } = users;

      // Enable the Terms and Conditions and publish a text
      enableAndSetTC(asCambridgeTenantAdmin, 'default', 'legalese', true, () => {
        // Make mrvisser a tenantAdmin
        RestAPI.User.setTenantAdmin(asCambridgeTenantAdmin, mrvisser.user.id, true, (error_) => {
          assert.notExists(error_);

          // Verify that mrvisser doesn't need to accept the Terms and Conditions
          RestAPI.User.getMe(mrvisser.restContext, (error, data) => {
            assert.notExists(error);
            assert.ok(!data.needsToAcceptTC);

            // Verify that mrvisser is able to perform POST requests without having accepted the Terms and Conditions
            RestAPI.Content.createLink(
              mrvisser.restContext,
              {
                displayName: 'Yahoo',
                description: 'Yahoo',
                visibility: PUBLIC,
                link: 'http://uk.yahoo.com',
                managers: [],
                viewers: [],
                folders: []
              },
              (error, link) => {
                assert.notExists(error);
                RestAPI.Content.getLibrary(mrvisser.restContext, mrvisser.user.id, null, 10, (error, library) => {
                  assert.notExists(error);
                  assert.strictEqual(library.results.length, 1);

                  // Verify that mrvisser is able to perform DELETE requests without having accepted the Terms and Conditions
                  RestAPI.Content.deleteContent(mrvisser.restContext, link.id, (error_) => {
                    assert.notExists(error_);
                    RestAPI.Content.getLibrary(mrvisser.restContext, mrvisser.user.id, null, 10, (error, library) => {
                      assert.notExists(error);
                      assert.strictEqual(library.results.length, 0);

                      // Demote mrvisser to a normal user
                      RestAPI.User.setTenantAdmin(asCambridgeTenantAdmin, mrvisser.user.id, false, (error_) => {
                        assert.notExists(error_);

                        // Because mrvisser hasn't accepted the Terms and Conditions yet, he cannot interact with the system
                        // When the user tries to *do* anything, he needs to accept the Terms and Conditions
                        RestAPI.User.getMe(mrvisser.restContext, (error, data) => {
                          assert.notExists(error);
                          assert.ok(data.needsToAcceptTC);
                          RestAPI.Content.createLink(
                            mrvisser.restContext,
                            {
                              displayName: 'Yahoo',
                              description: 'Yahoo',
                              visibility: PUBLIC,
                              link: 'http://uk.yahoo.com',
                              managers: [],
                              viewers: [],
                              folders: []
                            },
                            (error, link) => {
                              assert.ok(error);
                              assert.strictEqual(error.code, 419);
                              assert.ok(!link);

                              // Verify nothing extra got added to the library
                              RestAPI.Content.getLibrary(
                                mrvisser.restContext,
                                mrvisser.user.id,
                                null,
                                10,
                                (error, library) => {
                                  assert.notExists(error);
                                  assert.strictEqual(library.results.length, 0);
                                  callback();
                                }
                              );
                            }
                          );
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
  });

  /**
   * Test that verifies some basic validation on the Terms and Conditions endpoint
   */
  it('verify basic validation on the Terms and Conditions endpoint', (callback) => {
    TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
      assert.notExists(error);
      const { 0: mrvisser, 1: nico } = users;

      // Trying to accept the T&C when they are disabled results in an error
      RestAPI.User.acceptTermsAndConditions(mrvisser.restContext, mrvisser.user.id, (error_) => {
        assert.strictEqual(error_.code, 400);

        // Enable the T&C
        enableAndSetTC(asCambridgeTenantAdmin, 'default', 'Default legalese', true, () => {
          // Mrvisser should not be allowed to accept the Terms and Conditions for Nico
          RestAPI.User.acceptTermsAndConditions(mrvisser.restContext, nico.user.id, (error_) => {
            assert.strictEqual(error_.code, 401);

            // Anonymous users can't accept anything
            RestAPI.User.acceptTermsAndConditions(asCambridgeAnonymousUser, mrvisser.user.id, (error_) => {
              assert.strictEqual(error_.code, 401);

              // Some basic validation
              RestAPI.User.acceptTermsAndConditions(mrvisser.restContext, 'not a user id', (error_) => {
                assert.strictEqual(error_.code, 400);
                RestAPI.User.acceptTermsAndConditions(mrvisser.restContext, 'g:camtest:not-a-user-id', (error_) => {
                  assert.strictEqual(error_.code, 400);
                  callback();
                });
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies the Terms and Conditions endpoint takes a locale parameter
   */
  it('verify retrieving the Terms and Conditions can be localized', (callback) => {
    TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);
      const { 0: mrvisser } = users;

      // Mrvisser lives in Canada, apparently
      RestAPI.User.updateUser(mrvisser.restContext, mrvisser.user.id, { locale: 'en_CA' }, (error_) => {
        assert.notExists(error_);

        // Enable the Terms and Conditions and create a couple of localized versions
        enableAndSetTC(asCambridgeTenantAdmin, 'default', 'Default legalese', true, () => {
          enableAndSetTC(asCambridgeTenantAdmin, 'en_GB', 'British English legalese', true, () => {
            enableAndSetTC(asCambridgeTenantAdmin, 'en_CA', 'Canadian English legalese', true, () => {
              // Verify the default locale
              RestAPI.User.getTermsAndConditions(asCambridgeAnonymousUser, null, (error, data) => {
                assert.notExists(error);
                assert.strictEqual(data.text, 'Default legalese');

                // If no locale is specified, the user's locale should be used
                RestAPI.User.getTermsAndConditions(mrvisser.restContext, null, (error, data) => {
                  assert.notExists(error);
                  assert.strictEqual(data.text, 'Canadian English legalese');

                  // If a locale is specified, that should take preference over the user's locale
                  RestAPI.User.getTermsAndConditions(mrvisser.restContext, 'en_GB', (error, data) => {
                    assert.notExists(error);
                    assert.strictEqual(data.text, 'British English legalese');

                    // If a locale is specialized for which no Terms and Conditions is available, the default Terms and Conditions should be returned
                    RestAPI.User.getTermsAndConditions(mrvisser.restContext, 'fr_FR', (error, data) => {
                      assert.notExists(error);
                      assert.strictEqual(data.text, 'Default legalese');

                      // Create an anonymous request context that sends an `Accept-Language: en_CA` header
                      // to verify that is picked up if no other options are present
                      const acceptLanguageRestContext = new RestContext('http://localhost:2001', {
                        hostHeader: global.oaeTests.tenants.cam.host,
                        additionalHeaders: { 'Accept-Language': 'en-gb' }
                      });
                      RestAPI.User.getTermsAndConditions(acceptLanguageRestContext, null, (error, data) => {
                        assert.notExists(error);
                        assert.strictEqual(data.text, 'British English legalese');
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

  /**
   * Test that verifies the lastUpdate changes when the Terms and Conditions are changed
   */
  it('verify the lastUpdate timestamp changes after updating the Terms and Conditions', (callback) => {
    // Set a Terms and Conditions
    enableAndSetTC(asCambridgeTenantAdmin, 'default', 'Default legalese', true, () => {
      // Get the Terms and Conditions
      setTimeout(RestAPI.User.getTermsAndConditions, 200, asCambridgeAnonymousUser, null, (error, firstTC) => {
        assert.notExists(error);
        assert.strictEqual(firstTC.text, 'Default legalese');
        assert.ok(firstTC.lastUpdate);
        assert.ok(firstTC.lastUpdate <= Date.now());
        assert.ok(firstTC.lastUpdate > 0);

        // Update the Terms and Conditions
        enableAndSetTC(asCambridgeTenantAdmin, 'default', 'Other legalese', true, () => {
          setTimeout(RestAPI.User.getTermsAndConditions, 200, asCambridgeAnonymousUser, null, (error, updatedTC) => {
            assert.notExists(error);
            assert.strictEqual(updatedTC.text, 'Other legalese');
            assert.ok(updatedTC.lastUpdate);
            assert.ok(updatedTC.lastUpdate <= Date.now());
            assert.ok(updatedTC.lastUpdate > 0);
            assert.ok(updatedTC.lastUpdate > firstTC.lastUpdate);
            callback();
          });
        });
      });
    });
  });

  /**
   * Test that verifies the Terms and Conditions are suppressed in the config when requested by a regular user
   */
  it('verify the Terms and Conditions are suppressed in the config', (callback) => {
    TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);
      const { 0: homer } = users;

      // Anonymous users should not see it
      RestAPI.Config.getTenantConfig(asCambridgeAnonymousUser, null, (error, config) => {
        assert.notExists(error);
        assert.isNotOk(config['oae-principals'].termsAndConditions.text);

        // Regular users shouldn't see it either
        RestAPI.Config.getTenantConfig(homer.restContext, null, (error, config) => {
          assert.notExists(error);
          assert.isNotOk(config['oae-principals'].termsAndConditions.text);

          // Tenant admins should be able to see it
          RestAPI.Config.getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
            assert.notExists(error);
            assert.isObject(config['oae-principals'].termsAndConditions.text);

            // Global admins should be able to see it
            RestAPI.Config.getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
              assert.notExists(error);
              assert.isObject(config['oae-principals'].termsAndConditions.text);
              return callback();
            });
          });
        });
      });
    });
  });
});
