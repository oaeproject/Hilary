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
 * visibilitys and limitations under the License.
 */

const assert = require('assert');

const RestAPI = require('oae-rest');
const TestsUtil = require('oae-tests');

describe('Google Analytics', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let anonymousRestContext = null;
  // Rest context that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;

  /**
   * Function that initializes the REST contexts
   */
  before(callback => {
    // Fill up the rest context for the anonymous user
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    // Fill up the rest context for the admin tenant
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    callback();
  });

  /**
   * Test that verifies that the Google Analytics config values are returned in the config feed
   */
  it('verify the config feed contains Google Analytics config values', callback => {
    // Create a regular user
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, john) => {
      assert.ok(!err);

      // Check that the Google Analytics config values are available in the config feed for a regular user
      RestAPI.Config.getTenantConfig(john.restContext, null, (err, config) => {
        assert.ok(!err);
        assert.ok(config);
        assert.strictEqual(config['oae-google-analytics']['google-analytics'].globalEnabled, false);
        assert.strictEqual(config['oae-google-analytics']['google-analytics'].globalTrackingId, '');
        assert.strictEqual(config['oae-google-analytics']['google-analytics'].tenantEnabled, false);
        assert.strictEqual(config['oae-google-analytics']['google-analytics'].tenantTrackingId, '');

        // Check that the Google Analytics config values are available in the config feed for a tenant admin
        RestAPI.Config.getTenantConfig(camAdminRestContext, null, (err, config) => {
          assert.ok(!err);
          assert.ok(config);
          assert.strictEqual(
            config['oae-google-analytics']['google-analytics'].globalEnabled,
            false
          );
          assert.strictEqual(
            config['oae-google-analytics']['google-analytics'].globalTrackingId,
            ''
          );
          assert.strictEqual(
            config['oae-google-analytics']['google-analytics'].tenantEnabled,
            false
          );
          assert.strictEqual(
            config['oae-google-analytics']['google-analytics'].tenantTrackingId,
            ''
          );

          // Check that the Google Analytics config values are available in the config feed for an anonymous user
          RestAPI.Config.getTenantConfig(anonymousRestContext, null, (err, config) => {
            assert.ok(!err);
            assert.ok(config);
            assert.strictEqual(
              config['oae-google-analytics']['google-analytics'].globalEnabled,
              false
            );
            assert.strictEqual(
              config['oae-google-analytics']['google-analytics'].globalTrackingId,
              ''
            );
            assert.strictEqual(
              config['oae-google-analytics']['google-analytics'].tenantEnabled,
              false
            );
            assert.strictEqual(
              config['oae-google-analytics']['google-analytics'].tenantTrackingId,
              ''
            );
            callback();
          });
        });
      });
    });
  });
});
