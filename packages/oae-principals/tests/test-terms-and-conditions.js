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

import assert from 'assert';
import _ from 'underscore';

import * as ConfigTestUtil from 'oae-config/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import { RestContext } from 'oae-rest/lib/model';

describe('Terms and Conditions', () => {
  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as an anonymous user
  let anonymousCamRestContext = null;

  /**
   * Function that will fill up the rest contexts
   */
  before(callback => {
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    return callback();
  });

  /**
   * Function that will disable and clear the Terms and Conditions after each test
   */
  afterEach(callback => {
    ConfigTestUtil.clearConfigAndWait(camAdminRestContext, null, ['oae-principals/termsAndConditions/enabled'], err => {
      assert.ok(!err);
      ConfigTestUtil.clearConfigAndWait(camAdminRestContext, null, ['oae-principals/termsAndConditions/text'], err => {
        assert.ok(!err);
        return callback();
      });
    });
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
  const enableAndSetTC = function(ctx, locale, text, expectSuccess, callback) {
    // Enable the Terms and Conditions
    const update = {};
    update['oae-principals/termsAndConditions/enabled'] = true;
    update['oae-principals/termsAndConditions/text/' + locale] = text;
    ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, update, err => {
      if (expectSuccess) {
        assert.ok(!err);
      } else {
        assert.ok(err);
      }

      return callback();
    });
  };

  /**
   * Test that verifies that user need to accept the Terms and Conditions when creating an account
   */
  it('verify users need to accept the Terms and Conditions when creating an account', callback => {
    // Disable reCaptcha
    ConfigTestUtil.updateConfigAndWait(
      camAdminRestContext,
      null,
      { 'oae-principals/recaptcha/enabled': false },
      err => {
        assert.ok(!err);

        // Enable the Terms and Conditions and publish a text
        enableAndSetTC(camAdminRestContext, 'default', 'legalese', true, () => {
          // Not passing in acceptedTC: true should result in a 400
          const username = TestsUtil.generateRandomText(5);
          const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
          RestAPI.User.createUser(
            anonymousCamRestContext,
            username,
            'password',
            'Test User',
            email,
            {},
            (err, userObj) => {
              assert.strictEqual(err.code, 400);
              RestAPI.User.createUser(
                anonymousCamRestContext,
                username,
                'password',
                'Test User',
                email,
                { acceptedTC: false },
                (err, userObj) => {
                  assert.strictEqual(err.code, 400);
                  RestAPI.User.createUser(
                    anonymousCamRestContext,
                    username,
                    'password',
                    'Test User',
                    email,
                    { acceptedTC: 'wrong' },
                    (err, userObj) => {
                      assert.strictEqual(err.code, 400);

                      RestAPI.User.createUser(
                        anonymousCamRestContext,
                        username,
                        'password',
                        'Test User',
                        email,
                        { acceptedTC: true },
                        (err, userObj) => {
                          assert.ok(!err);
                          assert.strictEqual(typeof userObj.acceptedTC, 'number');
                          assert.ok(userObj.acceptedTC <= Date.now());
                          assert.strictEqual(userObj.needsToAcceptTC, false);

                          // Re-enable the reCaptcha checks
                          ConfigTestUtil.updateConfigAndWait(
                            camAdminRestContext,
                            null,
                            { 'oae-principals/recaptcha/enabled': true },
                            err => {
                              assert.ok(!err);
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
        });
      }
    );
  });

  /**
   * Test that verifies that users cannot interact with the system when a Terms and Conditions comes into effect
   */
  it('verify users need to accept the Terms and Conditions before they can interact with the system', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);
      const mrvisser = _.values(users)[0];

      // Enable the Terms and Conditions and publish a text
      enableAndSetTC(camAdminRestContext, 'default', 'legalese', true, () => {
        // When the user tries to *do* anything, he needs to accept the Terms and Conditions
        RestAPI.Content.createLink(
          mrvisser.restContext,
          'Yahoo',
          'Yahoo',
          'public',
          'http://uk.yahoo.com',
          [],
          [],
          [],
          (err, link) => {
            assert.ok(err);
            assert.strictEqual(err.code, 419);
            assert.ok(!link);

            RestAPI.User.getMe(mrvisser.restContext, (err, data) => {
              assert.ok(!err);
              assert.ok(data.needsToAcceptTC);

              // Verify there is nothing in this user's library
              RestAPI.Content.getLibrary(mrvisser.restContext, mrvisser.user.id, null, 10, (err, library) => {
                assert.ok(!err);
                assert.strictEqual(library.results.length, 0);

                // Accept the Terms and Conditions for the cam tenant.
                RestAPI.User.acceptTermsAndConditions(mrvisser.restContext, mrvisser.user.id, err => {
                  assert.ok(!err);

                  RestAPI.User.getMe(mrvisser.restContext, (err, data) => {
                    assert.ok(!err);
                    assert.ok(!data.needsToAcceptTC);

                    // Verify that it is now possible to perform POST requests
                    RestAPI.Content.createLink(
                      mrvisser.restContext,
                      'Yahoo',
                      'Yahoo',
                      'public',
                      'http://uk.yahoo.com',
                      [],
                      [],
                      [],
                      (err, createdLink) => {
                        assert.ok(!err);
                        RestAPI.Content.getLibrary(mrvisser.restContext, mrvisser.user.id, null, 10, (err, library) => {
                          assert.ok(!err);
                          assert.strictEqual(library.results.length, 1);

                          // Update the Terms and Conditions, ensuring we wait long enough to get a new timestamp
                          setTimeout(enableAndSetTC, 500, camAdminRestContext, 'default', 'new legalese', true, () => {
                            // Mrvisser needs to re-accept the Terms and Conditions before he can continue working on the system
                            RestAPI.User.getMe(mrvisser.restContext, (err, data) => {
                              assert.ok(!err);
                              assert.ok(data.needsToAcceptTC);

                              RestAPI.Content.createLink(
                                mrvisser.restContext,
                                'Yahoo',
                                'Yahoo',
                                'public',
                                'http://uk.yahoo.com',
                                [],
                                [],
                                [],
                                (err, link) => {
                                  assert.ok(err);
                                  assert.strictEqual(err.code, 419);
                                  assert.ok(!link);

                                  // DELETEs should not be possible
                                  RestAPI.Content.deleteContent(mrvisser.restContext, createdLink.id, err => {
                                    assert.ok(err);
                                    assert.strictEqual(err.code, 419);

                                    // Sanity check that re-accepting it, allows mrvisser to perform POST requests again
                                    setTimeout(
                                      RestAPI.User.acceptTermsAndConditions,
                                      200,
                                      mrvisser.restContext,
                                      mrvisser.user.id,
                                      err => {
                                        assert.ok(!err);
                                        setTimeout(RestAPI.User.getMe, 1000, mrvisser.restContext, (err, data) => {
                                          assert.ok(!err);
                                          assert.ok(!data.needsToAcceptTC);

                                          // Verify that the user is now able to perform POST requests
                                          RestAPI.Content.createLink(
                                            mrvisser.restContext,
                                            'Yahoo',
                                            'Yahoo',
                                            'public',
                                            'http://uk.yahoo.com',
                                            [],
                                            [],
                                            [],
                                            (err, link) => {
                                              assert.ok(!err);
                                              RestAPI.Content.getLibrary(
                                                mrvisser.restContext,
                                                mrvisser.user.id,
                                                null,
                                                10,
                                                (err, library) => {
                                                  assert.ok(!err);
                                                  assert.strictEqual(library.results.length, 2);

                                                  // DELETEs should be possible
                                                  RestAPI.Content.deleteContent(mrvisser.restContext, link.id, err => {
                                                    assert.ok(!err);
                                                    RestAPI.Content.getLibrary(
                                                      mrvisser.restContext,
                                                      mrvisser.user.id,
                                                      null,
                                                      10,
                                                      (err, library) => {
                                                        assert.ok(!err);
                                                        assert.strictEqual(library.results.length, 1);
                                                        callback();
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
                                }
                              );
                            });
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
      });
    });
  });

  /**
   * Test that verifies that anonymous users don't need to accept the Terms and Conditions
   */
  it("verify anonymous users don't need to accept the Terms and Conditions", callback => {
    RestAPI.User.getMe(anonymousCamRestContext, (err, data) => {
      assert.ok(!err);
      assert.ok(!data.needsToAcceptTC);
      callback();
    });
  });

  /**
   * Test that verifies that admins don't need to accept the Terms and Conditions to
   * interact with the system
   */
  it("verify admins don't need to accept the Terms and Conditions", callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);
      const mrvisser = _.values(users)[0];

      // Enable the Terms and Conditions and publish a text
      enableAndSetTC(camAdminRestContext, 'default', 'legalese', true, () => {
        // Make mrvisser a tenantAdmin
        RestAPI.User.setTenantAdmin(camAdminRestContext, mrvisser.user.id, true, err => {
          assert.ok(!err);

          // Verify that mrvisser doesn't need to accept the Terms and Conditions
          RestAPI.User.getMe(mrvisser.restContext, (err, data) => {
            assert.ok(!err);
            assert.ok(!data.needsToAcceptTC);

            // Verify that mrvisser is able to perform POST requests without having accepted the Terms and Conditions
            RestAPI.Content.createLink(
              mrvisser.restContext,
              'Yahoo',
              'Yahoo',
              'public',
              'http://uk.yahoo.com',
              [],
              [],
              [],
              (err, link) => {
                assert.ok(!err);
                RestAPI.Content.getLibrary(mrvisser.restContext, mrvisser.user.id, null, 10, (err, library) => {
                  assert.ok(!err);
                  assert.strictEqual(library.results.length, 1);

                  // Verify that mrvisser is able to perform DELETE requests without having accepted the Terms and Conditions
                  RestAPI.Content.deleteContent(mrvisser.restContext, link.id, err => {
                    assert.ok(!err);
                    RestAPI.Content.getLibrary(mrvisser.restContext, mrvisser.user.id, null, 10, (err, library) => {
                      assert.ok(!err);
                      assert.strictEqual(library.results.length, 0);

                      // Demote mrvisser to a normal user
                      RestAPI.User.setTenantAdmin(camAdminRestContext, mrvisser.user.id, false, err => {
                        assert.ok(!err);

                        // Because mrvisser hasn't accepted the Terms and Conditions yet, he cannot interact with the system
                        // When the user tries to *do* anything, he needs to accept the Terms and Conditions
                        RestAPI.User.getMe(mrvisser.restContext, (err, data) => {
                          assert.ok(!err);
                          assert.ok(data.needsToAcceptTC);
                          RestAPI.Content.createLink(
                            mrvisser.restContext,
                            'Yahoo',
                            'Yahoo',
                            'public',
                            'http://uk.yahoo.com',
                            [],
                            [],
                            [],
                            (err, link) => {
                              assert.ok(err);
                              assert.strictEqual(err.code, 419);
                              assert.ok(!link);

                              // Verify nothing extra got added to the library
                              RestAPI.Content.getLibrary(
                                mrvisser.restContext,
                                mrvisser.user.id,
                                null,
                                10,
                                (err, library) => {
                                  assert.ok(!err);
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
  it('verify basic validation on the Terms and Conditions endpoint', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
      const mrvisser = _.values(users)[0];
      const nico = _.values(users)[1];

      // Trying to accept the T&C when they are disabled results in an error
      RestAPI.User.acceptTermsAndConditions(mrvisser.restContext, mrvisser.user.id, err => {
        assert.strictEqual(err.code, 400);

        // Enable the T&C
        enableAndSetTC(camAdminRestContext, 'default', 'Default legalese', true, () => {
          // Mrvisser should not be allowed to accept the Terms and Conditions for Nico
          RestAPI.User.acceptTermsAndConditions(mrvisser.restContext, nico.user.id, err => {
            assert.strictEqual(err.code, 401);

            // Anonymous users can't accept anything
            RestAPI.User.acceptTermsAndConditions(anonymousCamRestContext, mrvisser.user.id, err => {
              assert.strictEqual(err.code, 401);

              // Some basic validation
              RestAPI.User.acceptTermsAndConditions(mrvisser.restContext, 'not a user id', err => {
                assert.strictEqual(err.code, 400);
                RestAPI.User.acceptTermsAndConditions(mrvisser.restContext, 'g:camtest:not-a-user-id', err => {
                  assert.strictEqual(err.code, 400);
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
  it('verify retrieving the Terms and Conditions can be localized', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);
      const mrvisser = _.values(users)[0];

      // Mrvisser lives in Canada, apparently
      RestAPI.User.updateUser(mrvisser.restContext, mrvisser.user.id, { locale: 'en_CA' }, err => {
        assert.ok(!err);

        // Enable the Terms and Conditions and create a couple of localized versions
        enableAndSetTC(camAdminRestContext, 'default', 'Default legalese', true, () => {
          enableAndSetTC(camAdminRestContext, 'en_GB', 'British English legalese', true, () => {
            enableAndSetTC(camAdminRestContext, 'en_CA', 'Canadian English legalese', true, () => {
              // Verify the default locale
              RestAPI.User.getTermsAndConditions(anonymousCamRestContext, null, (err, data) => {
                assert.ok(!err);
                assert.strictEqual(data.text, 'Default legalese');

                // If no locale is specified, the user's locale should be used
                RestAPI.User.getTermsAndConditions(mrvisser.restContext, null, (err, data) => {
                  assert.ok(!err);
                  assert.strictEqual(data.text, 'Canadian English legalese');

                  // If a locale is specified, that should take preference over the user's locale
                  RestAPI.User.getTermsAndConditions(mrvisser.restContext, 'en_GB', (err, data) => {
                    assert.ok(!err);
                    assert.strictEqual(data.text, 'British English legalese');

                    // If a locale is specialized for which no Terms and Conditions is available, the default Terms and Conditions should be returned
                    RestAPI.User.getTermsAndConditions(mrvisser.restContext, 'fr_FR', (err, data) => {
                      assert.ok(!err);
                      assert.strictEqual(data.text, 'Default legalese');

                      // Create an anonymous request context that sends an `Accept-Language: en_CA` header
                      // to verify that is picked up if no other options are present
                      const acceptLanguageRestContext = new RestContext('http://localhost:2001', {
                        hostHeader: global.oaeTests.tenants.cam.host,
                        additionalHeaders: { 'Accept-Language': 'en-gb' }
                      });
                      RestAPI.User.getTermsAndConditions(acceptLanguageRestContext, null, (err, data) => {
                        assert.ok(!err);
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
  it('verify the lastUpdate timestamp changes after updating the Terms and Conditions', callback => {
    // Set a Terms and Conditions
    enableAndSetTC(camAdminRestContext, 'default', 'Default legalese', true, () => {
      // Get the Terms and Conditions
      setTimeout(RestAPI.User.getTermsAndConditions, 200, anonymousCamRestContext, null, (err, firstTC) => {
        assert.ok(!err);
        assert.strictEqual(firstTC.text, 'Default legalese');
        assert.ok(firstTC.lastUpdate);
        assert.ok(firstTC.lastUpdate <= Date.now());
        assert.ok(firstTC.lastUpdate > 0);

        // Update the Terms and Conditions
        enableAndSetTC(camAdminRestContext, 'default', 'Other legalese', true, () => {
          setTimeout(RestAPI.User.getTermsAndConditions, 200, anonymousCamRestContext, null, (err, updatedTC) => {
            assert.ok(!err);
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
  it('verify the Terms and Conditions are suppressed in the config', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);
      const mrvisser = _.values(users)[0];

      // Anonymous users should not see it
      RestAPI.Config.getTenantConfig(anonymousCamRestContext, null, (err, config) => {
        assert.ok(!err);
        assert.ok(!config['oae-principals'].termsAndConditions.text);

        // Regular users shouldn't see it either
        RestAPI.Config.getTenantConfig(mrvisser.restContext, null, (err, config) => {
          assert.ok(!err);
          assert.ok(!config['oae-principals'].termsAndConditions.text);

          // Tenant admins should be able to see it
          RestAPI.Config.getTenantConfig(camAdminRestContext, null, (err, config) => {
            assert.ok(!err);
            assert.ok(_.isObject(config['oae-principals'].termsAndConditions.text));

            // Global admins should be able to see it
            RestAPI.Config.getTenantConfig(globalAdminRestContext, global.oaeTests.tenants.cam.alias, (err, config) => {
              assert.ok(!err);
              assert.ok(_.isObject(config['oae-principals'].termsAndConditions.text));
              return callback();
            });
          });
        });
      });
    });
  });
});
