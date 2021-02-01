/*
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the 'License'); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an 'AS IS'
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import { assert } from 'chai';
import { describe, it, before } from 'mocha';
import fs from 'fs';
import path from 'path';

import { pluck, forEach } from 'ramda';

import * as OaeServer from 'oae-util/lib/server';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as RestUtil from 'oae-rest/lib/util';
import * as TestsUtil from 'oae-tests';

describe('OAE Server', () => {
  // Rest context for the cam admin
  let camAdminRestContext = null;

  /*!
   * Function that will set up the user contexts
   */
  before((callback) => {
    // Fill up Cam tenant admin rest context
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    callback();
  });

  describe('CSRF', () => {
    /*!
     * Verifies CSRF validation with invalid hosts and safe paths
     */
    it('verify CSRF validation with invalid hosts and safe paths', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        // Ensure we can authenticate
        RestAPI.User.getMe(user.restContext, (error, me) => {
          assert.notExists(error);
          assert.strictEqual(user.user.id, me.id);

          // Sanity check we can sign out
          RestAPI.Authentication.logout(user.restContext, (error_) => {
            assert.notExists(error_);

            // Verify we are anonymous
            RestAPI.User.getMe(user.restContext, (error, me) => {
              assert.notExists(error);
              assert.isNotOk(me.id);
              assert.ok(me.anon);

              // Spoof the referer to be a relative uri. This should pass CSRF validation
              user.restContext.refererHeader = '/some/path';

              // Log back in
              RestAPI.Authentication.login(
                user.restContext,
                user.restContext.username,
                user.restContext.userPassword,
                (error_) => {
                  assert.notExists(error_);

                  // Verify we are authenticated
                  RestAPI.User.getMe(user.restContext, (error, me) => {
                    assert.notExists(error);
                    assert.strictEqual(user.user.id, me.id);

                    // Spoof the referer
                    user.restContext.refererHeader = 'http://www.google.com';

                    // Verify CSRF validation catches this request
                    RestAPI.Authentication.logout(user.restContext, (error /* , data */) => {
                      assert.ok(error);
                      assert.strictEqual(error.code, 500);
                      assert.strictEqual(error.msg.indexOf('CSRF'), 0);

                      // Spoof the referer to be empty
                      user.restContext.refererHeader = '';

                      // Verify CSRF validation says no dice
                      RestAPI.Authentication.logout(user.restContext, (error /* , data */) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 500);
                        assert.strictEqual(error.msg.indexOf('CSRF'), 0);

                        // Verify we are still authenticated (this is a GET request, CSRF validation will not happen here with our spoofed referer)
                        RestAPI.User.getMe(user.restContext, (error, me) => {
                          assert.notExists(error);
                          assert.strictEqual(user.user.id, me.id);

                          // Make the logout API path safe from CSRF validation
                          OaeServer.addSafePathPrefix('/api/auth/logout');

                          // Sanity check we can now sign out, even with an invalid referer
                          RestAPI.Authentication.logout(user.restContext, (error_) => {
                            assert.notExists(error_);

                            // Verify we are now anonymous
                            RestAPI.User.getMe(user.restContext, (error, me) => {
                              assert.notExists(error);
                              assert.isNotOk(me.id);
                              assert.ok(me.anon);
                              callback();
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
    });
  });

  describe('Multipart Uploads', () => {
    /**
     * Utility method that returns a file stream
     *
     * @return {Stream}     A file stream
     */
    const getFileStream = function () {
      return fs.createReadStream(path.join(__dirname, '/data/banditos.txt'));
    };

    /**
     * Test that verifies multiple files can be uploaded in the same request parameter
     */
    it('verify multiple files can be uploaded in the same request parameter', (callback) => {
      TestsUtil.createTestServer((app, server, port) => {
        app.post('/testUploadFiles', (request, response) => {
          assert.isArray(request.files.testFiles);
          assert.lengthOf(request.files.testFiles, 2);
          assert.strictEqual(request.files.testFiles[0].name, 'banditos.txt');
          assert.strictEqual(request.files.testFiles[1].name, 'banditos.txt');

          response.sendStatus(200);
          server.close(callback);
        });

        const options = { method: 'POST', url: 'http://localhost:' + port + '/testUploadFiles' };
        RestUtil.request(options, { testFiles: [getFileStream, getFileStream] });
      });
    });
  });

  describe('Cookies', () => {
    /**
     * Verify that a fixed cookie name is used
     */
    it('verify a fixed cookie name is used', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;

        // Ensure the user is authenticated
        PrincipalsTestUtil.assertGetMeSucceeds(simong.restContext, (me) => {
          assert.isNotOk(me.anon);

          // Get the cookies from the cookie har
          const cookies = simong.restContext.cookieJar.getCookies('http://localhost');
          const cookieNames = pluck('key', cookies);

          // When setting up the tests, we configured the cookie name to a specific value.
          // Ensure that this value is used. This tests regressions in the cookie-session
          // middleware
          assert.include(cookieNames, TestsUtil.CONFIG_COOKIE_NAME);

          // Rename the cookie to something else
          forEach((cookie) => {
            if (cookie.key === TestsUtil.CONFIG_COOKIE_NAME) {
              cookie.key = 'somethingElse';
            }
          }, cookies);

          // Ensure the user is anonymous
          PrincipalsTestUtil.assertGetMeSucceeds(simong.restContext, (me) => {
            assert.strictEqual(me.anon, true);

            return callback();
          });
        });
      });
    });
  });
});
