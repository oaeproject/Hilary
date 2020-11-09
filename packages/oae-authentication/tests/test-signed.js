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
import util from 'util';
import _ from 'underscore';

import * as RestAPI from 'oae-rest';
import { RestContext } from 'oae-rest/lib/model';
import * as TestsUtil from 'oae-tests';

const _originalDateNow = Date.now;

describe('Authentication', () => {
  // Rest contexts that can be used to perform requests
  let anonymousGlobalRestContext = null;
  let globalAdminRestContext = null;
  let camAdminRestContext = null;
  let gtAdminRestContext = null;
  let anonymousCamRestContext = null;

  /**
   * Function that will fill up the tenant admin and anymous rest context
   */
  before(() => {
    // Instantiate the rest contexts we'll use for these tests
    anonymousGlobalRestContext = TestsUtil.createGlobalRestContext();
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
  });

  /**
   * After each test, ensure the Date.now function is restored since we
   * change it sometimes.
   */
  afterEach(() => {
    Date.now = _originalDateNow;
  });

  describe('Signed Authentication', () => {
    /*!
     * Tries to login to the signed authentication endpoint by using the provided parameters.
     *
     * @param  {String}     requestInfoUrl      The url from the request info object granted by an authentication grant endpoint
     * @param  {Object}     body                The signed body to use to authenticate to the signed authentication endpoint
     * @param  {Boolean}    isLoggedIn          Whether or not the user should be logged in
     * @param  {Function}   callback            Standard callback function
     */
    const _performSignedAuthenticationRequest = function(
      requestInfoUrl,
      body,
      isLoggedIn,
      callback
    ) {
      const parsedUrl = new URL(requestInfoUrl, 'http://localhost');
      const restCtx = new RestContext('http://' + global.oaeTests.tenants.localhost.host, {
        hostHeader: parsedUrl.host
      });
      RestAPI.Admin.doSignedAuthentication(restCtx, body, err => {
        assert.notExists(err);

        RestAPI.User.getMe(restCtx, (err, me) => {
          assert.notExists(err);

          if (isLoggedIn) {
            assert.ok(!me.anon);
            assert.strictEqual(me.authenticationStrategy, 'signed');

            if (body.becomeUserId) {
              assert.ok(me.id, body.becomeUserId);
              assert.ok(me.imposter);
              assert.strictEqual(me.imposter.id, body.userId);
            }
          } else {
            assert.ok(me.anon);
          }

          return callback();
        });
      });
    };

    describe('Get Signed Tenant Authentication Request', () => {
      /**
       * Test that verifies only global administrators can request a signed tenant authentication
       */
      it('verify only global administrators can request a signed tenant authentication', callback => {
        // Generate a regular user we'll use to try and get a signed tenant authentication request
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
          assert.notExists(err);
          const { 0: mrvisser } = users;

          // Verify anonymous cannot request signed authentication
          RestAPI.Admin.getSignedTenantAuthenticationRequestInfo(
            anonymousGlobalRestContext,
            'localhost',
            (err, requestInfo) => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);
              assert.ok(!requestInfo);

              // Verify a tenant admin cannot request signed authentication to another tenant
              RestAPI.Admin.getSignedTenantAuthenticationRequestInfo(
                camAdminRestContext,
                'localhost',
                (err, requestInfo) => {
                  assert.ok(err);

                  // This actually throws 404 because these endpoints are not hooked up to the tenant servers
                  assert.strictEqual(err.code, 404);
                  assert.ok(!requestInfo);

                  // Verify a regular user cannot request signed authentication to another tenant
                  RestAPI.Admin.getSignedTenantAuthenticationRequestInfo(
                    mrvisser.restContext,
                    'localhost',
                    (err, requestInfo) => {
                      assert.ok(err);

                      // This actually throws 404 because these endpoints are not hooked up to the tenant servers
                      assert.strictEqual(err.code, 404);
                      assert.ok(!requestInfo);

                      // Sanity check that global admin is granted the signed authentication request
                      RestAPI.Admin.getSignedTenantAuthenticationRequestInfo(
                        globalAdminRestContext,
                        'localhost',
                        (err, requestInfo) => {
                          assert.notExists(err);
                          assert.ok(requestInfo);
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
       * Test that verifies that no signatures are generated when a parameter is missing or invalid
       */
      it('verify parameter validation', callback => {
        // Ensure wen cannot get a signed request with no tenant alias
        RestAPI.Admin.getSignedTenantAuthenticationRequestInfo(
          globalAdminRestContext,
          null,
          (err, requestInfo) => {
            assert.ok(err);
            assert.strictEqual(err.code, 400);
            assert.ok(!requestInfo);

            // Ensure we cannot get a signed request with a non-existing tenant alias
            RestAPI.Admin.getSignedTenantAuthenticationRequestInfo(
              globalAdminRestContext,
              'some non existing tenant alias',
              (err, requestInfo) => {
                assert.ok(err);
                assert.strictEqual(err.code, 404);
                assert.ok(!requestInfo);

                // Sanity check that we can get a signed request with an existing tenant alias
                RestAPI.Admin.getSignedTenantAuthenticationRequestInfo(
                  globalAdminRestContext,
                  'localhost',
                  (err, requestInfo) => {
                    assert.notExists(err);
                    assert.ok(requestInfo);
                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    describe('Get Signed Become User Authentication Request', () => {
      /**
       * Test that verifies users can only become users from tenants on which they are administrators
       */
      it('verify users can only become users from tenants on which they are administrators', callback => {
        // Generate a regular user we'll impersonate, and one that will try and impersonate someone
        TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
          assert.notExists(err);
          const { 0: mrvisser, 1: nico } = users;

          // Verify anonymous global user cannot request signed authentication for mrvisser
          RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
            anonymousGlobalRestContext,
            mrvisser.user.id,
            (err, requestInfo) => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);
              assert.ok(!requestInfo);

              // Verify anonymous user on the cam tenant cannot request signed authentication for mrvisser
              RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
                anonymousCamRestContext,
                mrvisser.user.id,
                (err, requestInfo) => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 401);
                  assert.ok(!requestInfo);

                  // Verify regular tenant user cannot request signed authentication for mrvisser
                  RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
                    nico.restContext,
                    mrvisser.user.id,
                    (err, requestInfo) => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 401);
                      assert.ok(!requestInfo);

                      // Verify tenant administrator from another tenant cannot request signed authentication for mrvisser
                      RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
                        gtAdminRestContext,
                        mrvisser.user.id,
                        (err, requestInfo) => {
                          assert.ok(err);
                          assert.strictEqual(err.code, 401);
                          assert.ok(!requestInfo);

                          // Make nico a tenant administrator for the cam tenant
                          RestAPI.User.setTenantAdmin(
                            camAdminRestContext,
                            nico.user.id,
                            true,
                            err => {
                              assert.notExists(err);

                              // Verify a tenant administrator cannot impersonate another tenant administrator
                              RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
                                camAdminRestContext,
                                nico.user.id,
                                (err, requestInfo) => {
                                  assert.ok(err);
                                  assert.strictEqual(err.code, 401);
                                  assert.ok(!requestInfo);

                                  // Verify a global administrator can impersonate a tenant administrator
                                  RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
                                    globalAdminRestContext,
                                    nico.user.id,
                                    (err, requestInfo) => {
                                      assert.notExists(err);
                                      assert.ok(requestInfo);
                                      assert.strictEqual(
                                        requestInfo.body.becomeUserId,
                                        nico.user.id
                                      );

                                      // Verify a global administrator can impersonate a regular user
                                      RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
                                        globalAdminRestContext,
                                        mrvisser.user.id,
                                        (err, requestInfo) => {
                                          assert.notExists(err);
                                          assert.ok(requestInfo);
                                          assert.strictEqual(
                                            requestInfo.body.becomeUserId,
                                            mrvisser.user.id
                                          );

                                          // Verify a tenant administrator can impersonate a regular user (nico was made a tenant administrator earlier in the test)
                                          RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
                                            nico.restContext,
                                            mrvisser.user.id,
                                            (err, requestInfo) => {
                                              assert.notExists(err);
                                              assert.ok(requestInfo);
                                              assert.strictEqual(
                                                requestInfo.body.becomeUserId,
                                                mrvisser.user.id
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
        });
      });

      /**
       * Test that verifies that no signatures are generated when a parameter is missing or invalid
       */
      it('verify parameter validation', callback => {
        // Generate a test user to sanity check getting a become user authentication request
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
          assert.notExists(err);
          const { 0: mrvisser } = users;

          // Ensure `becomeUserId` is required
          RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
            globalAdminRestContext,
            null,
            (err, requestInfo) => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);
              assert.ok(!requestInfo);

              // Ensure `becomeUserId` must be a valid user id
              RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
                globalAdminRestContext,
                'invalid user id',
                (err, requestInfo) => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 400);
                  assert.ok(!requestInfo);
                  RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
                    globalAdminRestContext,
                    'g:cam:notauserid',
                    (err, requestInfo) => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 400);
                      assert.ok(!requestInfo);

                      // Ensure `becomeUserId` must be a user id of a user that exists
                      RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
                        globalAdminRestContext,
                        'u:cam:doesnotexist',
                        (err, requestInfo) => {
                          assert.ok(err);
                          assert.strictEqual(err.code, 404);
                          assert.ok(!requestInfo);

                          // Sanity check an existing user id
                          RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
                            globalAdminRestContext,
                            mrvisser.user.id,
                            (err, requestInfo) => {
                              assert.notExists(err);
                              assert.ok(requestInfo);
                              assert.strictEqual(requestInfo.body.becomeUserId, mrvisser.user.id);
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
       * Test that verifies an impostering user cannot further get another become user signature
       */
      it('verify imposter cannot get another signed become user request', callback => {
        // Generate a test user to try and become
        TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
          assert.notExists(err);
          const { 0: mrvisser, 1: simon } = users;

          // Make simon a tenant administrator so he can become mrvisser
          RestAPI.User.setTenantAdmin(camAdminRestContext, simon.user.id, true, err => {
            assert.notExists(err);

            // Sanity check that simon can get a signed request to become mrvisser
            RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
              simon.restContext,
              mrvisser.user.id,
              (err, requestInfo) => {
                assert.notExists(err);
                assert.ok(requestInfo);

                // Imposter simon as a the global admin
                RestAPI.Admin.loginAsUser(
                  globalAdminRestContext,
                  simon.user.id,
                  'http://' + global.oaeTests.tenants.localhost.host,
                  (err, globalAdminImposteringSimonRestContext) => {
                    assert.notExists(err);

                    // Ensure it is indeed an impostering context
                    RestAPI.User.getMe(globalAdminImposteringSimonRestContext, (err, me) => {
                      assert.notExists(err);
                      assert.ok(me);
                      assert.strictEqual(me.id, simon.user.id);
                      assert.ok(me.imposter);

                      // Ensure the simon imposter cannot get a signed authentication request to become mrvisser
                      RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
                        globalAdminImposteringSimonRestContext,
                        mrvisser.user.id,
                        (err, requestInfo) => {
                          assert.ok(err);
                          assert.strictEqual(err.code, 401);
                          assert.ok(!requestInfo);
                          return callback();
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

    describe('Signed Tenant Login', () => {
      /**
       * Verifies that you can actually log in to a tenant.
       */
      it('verify login on tenant works', callback => {
        RestAPI.Admin.loginOnTenant(globalAdminRestContext, 'localhost', null, (err, restCtx) => {
          assert.notExists(err);

          RestAPI.User.getMe(restCtx, (err, user) => {
            assert.notExists(err);
            assert.ok(!user.anon);
            assert.ok(user.isGlobalAdmin, 'The user should still be a global administrator');
            return callback();
          });
        });
      });

      /**
       * Verifies that the login request fails if there are invalid body parameters
       */
      it('verify parameter validation', callback => {
        RestAPI.Admin.getSignedTenantAuthenticationRequestInfo(
          globalAdminRestContext,
          'localhost',
          (err, requestInfo) => {
            assert.notExists(err);

            // Ensure that authentication with this request data works
            _performSignedAuthenticationRequest(requestInfo.url, requestInfo.body, true, () => {
              // Permutations of missing parameters
              _performSignedAuthenticationRequest(
                requestInfo.url,
                _.omit(requestInfo.body, 'userId'),
                false,
                () => {
                  _performSignedAuthenticationRequest(
                    requestInfo.url,
                    _.omit(requestInfo.body, 'expires'),
                    false,
                    () => {
                      _performSignedAuthenticationRequest(
                        requestInfo.url,
                        _.omit(requestInfo.body, 'signature'),
                        false,
                        () => {
                          // All parameters are present, but some are invalid
                          _performSignedAuthenticationRequest(
                            requestInfo.url,
                            _.extend({}, requestInfo.body, { userId: 'u:admin:badid' }),
                            false,
                            () => {
                              _performSignedAuthenticationRequest(
                                requestInfo.url,
                                _.extend({}, requestInfo.body, { expires: 1234567890 }),
                                false,
                                () => {
                                  return _performSignedAuthenticationRequest(
                                    requestInfo.url,
                                    _.extend({}, requestInfo.body, {
                                      signature: 'bad signature'
                                    }),
                                    false,
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
            });
          }
        );
      });

      /**
       * Test that verifies the signed authentication request expires after 5 minutes
       */
      it('verify signed tenant login request expires', callback => {
        RestAPI.Admin.getSignedTenantAuthenticationRequestInfo(
          globalAdminRestContext,
          'localhost',
          (err, requestInfo) => {
            assert.notExists(err);

            // Skip the time ahead by 5 minutes to ensure the token is no longer valid
            const now = Date.now();
            Date.now = function() {
              return now + 5 * 60 * 1000;
            };

            return _performSignedAuthenticationRequest(
              requestInfo.url,
              requestInfo.body,
              false,
              callback
            );
          }
        );
      });
    });

    describe('Signed Become User Login', () => {
      /**
       * Verify that loggin in as a user actually works
       */
      it('verify login as user creates an impersonating request context', callback => {
        // Generate a test user to imposter
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
          assert.notExists(err);
          const { 0: mrvisser } = users;

          // Cam admin will imposter mrvisser
          RestAPI.Admin.loginAsUser(
            camAdminRestContext,
            mrvisser.user.id,
            util.format('http://%s', global.oaeTests.tenants.localhost.host),
            (err, impersonatingMrvisserRestCtx) => {
              assert.notExists(err);

              // Ensure we are authenticated as mrvisser and impostering
              RestAPI.User.getMe(impersonatingMrvisserRestCtx, (err, me) => {
                assert.notExists(err);
                assert.ok(me);
                assert.strictEqual(me.id, mrvisser.user.id);
                assert.ok(me.imposter);
                return callback();
              });
            }
          );
        });
      });

      /**
       * Verifies that the become user parameters are validated properly
       */
      it('verify parameter validation', callback => {
        // Generate a test user to try and imposter
        TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
          assert.notExists(err);
          const { 0: mrvisser, 1: simon } = users;

          // Generate a signed request to become mrvisser
          RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
            camAdminRestContext,
            mrvisser.user.id,
            (err, requestInfo) => {
              assert.notExists(err);

              // Ensure the request data can be used to authentication when the body is untampered with
              _performSignedAuthenticationRequest(requestInfo.url, requestInfo.body, true, () => {
                // Permutations of missing parameters
                _performSignedAuthenticationRequest(
                  requestInfo.url,
                  _.omit(requestInfo.body, 'userId'),
                  false,
                  () => {
                    _performSignedAuthenticationRequest(
                      requestInfo.url,
                      _.omit(requestInfo.body, 'expires'),
                      false,
                      () => {
                        _performSignedAuthenticationRequest(
                          requestInfo.url,
                          _.omit(requestInfo.body, 'signature'),
                          false,
                          () => {
                            _performSignedAuthenticationRequest(
                              requestInfo.url,
                              _.omit(requestInfo.body, 'becomeUserId'),
                              false,
                              () => {
                                // Permutations of tampered data
                                _performSignedAuthenticationRequest(
                                  requestInfo.url,
                                  _.extend(requestInfo.body, { userId: simon.user.id }),
                                  false,
                                  () => {
                                    _performSignedAuthenticationRequest(
                                      requestInfo.url,
                                      _.extend(requestInfo.body, { expires: 1234567890 }),
                                      false,
                                      () => {
                                        _performSignedAuthenticationRequest(
                                          requestInfo.url,
                                          _.extend(requestInfo.body, { signature: 'different' }),
                                          false,
                                          () => {
                                            return _performSignedAuthenticationRequest(
                                              requestInfo.url,
                                              _.extend(requestInfo.body, {
                                                becomeUserId: simon.user.id
                                              }),
                                              false,
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
              });
            }
          );
        });
      });

      /**
       * Test that verifies the signed authentication request expires after 5 minutes
       */
      it('verify signed become user login request expires', callback => {
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
          assert.notExists(err);
          const { 0: mrvisser } = users;

          RestAPI.Admin.getSignedBecomeUserAuthenticationRequestInfo(
            camAdminRestContext,
            mrvisser.user.id,
            (err, requestInfo) => {
              assert.notExists(err);

              // Skip the time ahead by 5 minutes to ensure the token is no longer valid
              const now = Date.now();
              Date.now = function() {
                return now + 5 * 60 * 1000;
              };

              return _performSignedAuthenticationRequest(
                requestInfo.url,
                requestInfo.body,
                false,
                callback
              );
            }
          );
        });
      });
    });
  });
});
