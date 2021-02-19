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

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

describe('Authentication', () => {
  // Rest context that can be used for anonymous requests on the cambridge tenant
  let anonymousCamRestContext = null;
  // Rest context that can be used for anonymous requests on the global admin tenant
  let anonymousGlobalRestContext = null;
  // Rest context that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as a tenant admin
  let gtAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;

  /**
   * Function that will fill up the tenant admin and anymous rest context
   */
  before((callback) => {
    // Prepare the contexts with which we'll perform requests
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    anonymousGlobalRestContext = TestsUtil.createGlobalRestContext();
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();

    return callback();
  });

  /**
   * Test that verifies that a user's login ids can be requested
   */
  it("verify that only authorized admins can request a user's login ids", (callback) => {
    // Generate a user id
    const username = TestsUtil.generateTestUserId();
    const email = TestsUtil.generateTestEmailAddress(
      null,
      global.oaeTests.tenants.cam.emailDomains[0]
    );

    // Verify that an error is thrown when a malformed id was specified
    RestAPI.Authentication.getUserLoginIds(globalAdminRestContext, 'not an id', (
      error /* , loginIds */
    ) => {
      assert.ok(error);
      assert.strictEqual(error.code, 400);

      // Verify that an error is thrown when a non-user id is specified
      RestAPI.Authentication.getUserLoginIds(globalAdminRestContext, 'g:not:a-user-id', (
        error /* , loginIds */
      ) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);

        // Verify that an error is thrown when an non existing user id was specified
        RestAPI.Authentication.getUserLoginIds(globalAdminRestContext, 'u:camtest:abcdefghij', (
          error /* , loginIds */
        ) => {
          assert.ok(error);
          assert.strictEqual(error.code, 404);

          // Create a test user
          RestAPI.User.createUser(
            camAdminRestContext,
            username,
            'password',
            'Test User',
            email,
            null,
            (error, createdUser) => {
              assert.notExists(error);

              // Verify that an error is thrown when an anonymous user on the global admin router requests the login ids for the test user
              RestAPI.Authentication.getUserLoginIds(anonymousGlobalRestContext, createdUser.id, (
                error /* , loginIds */
              ) => {
                assert.ok(error);
                assert.strictEqual(error.code, 401);

                // Verify that an error is thrown when an anonymous user on the tenant router requests the login ids for the test user
                RestAPI.Authentication.getUserLoginIds(anonymousCamRestContext, createdUser.id, (
                  error /* , loginIds */
                ) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 401);

                  // Verify that an error is thrown when an unauthorized tenant admin requests the login ids for the test user
                  RestAPI.Authentication.getUserLoginIds(gtAdminRestContext, createdUser.id, (
                    error /* , loginIds */
                  ) => {
                    assert.ok(error);
                    assert.strictEqual(error.code, 401);

                    // Verify that a tenant admin can request the login ids for the test user
                    RestAPI.Authentication.getUserLoginIds(
                      camAdminRestContext,
                      createdUser.id,
                      (error, loginIds) => {
                        assert.notExists(error);
                        assert.ok(loginIds);

                        // Verify that a global admin can request the login ids for the test user
                        RestAPI.Authentication.getUserLoginIds(
                          globalAdminRestContext,
                          createdUser.id,
                          (error, loginIds) => {
                            assert.notExists(error);
                            assert.ok(loginIds);

                            return callback();
                          }
                        );
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

  /**
   * Verify that a user's login ids can be successfully returned
   */
  it("verify that a user's login ids can be successfully returned", (callback) => {
    // Generate a user id
    const username = TestsUtil.generateTestUserId();
    const email = TestsUtil.generateTestEmailAddress(
      null,
      global.oaeTests.tenants.cam.emailDomains[0]
    );

    // Create a test user
    RestAPI.User.createUser(
      camAdminRestContext,
      username,
      'password',
      'Test User',
      email,
      null,
      (error, createdUser) => {
        assert.notExists(error);

        // Verify that a global admin can request the login ids for the test user
        RestAPI.Authentication.getUserLoginIds(
          globalAdminRestContext,
          createdUser.id,
          (error, loginIds) => {
            assert.notExists(error);
            assert.ok(loginIds);
            assert.ok(loginIds.local);
            assert.strictEqual(loginIds.local, username.toLowerCase());

            return callback();
          }
        );
      }
    );
  });
});
