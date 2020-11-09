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

import { assert } from 'chai';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

import { path } from 'ramda';

const { generateTestUsers, createTenantRestContext, createTenantAdminRestContext } = TestsUtil;
const { getTenantConfig } = RestAPI.Config;
const googleAnalyticsSettings = path(['oae-google-analytics', 'google-analytics']);

describe('Google Analytics', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let asCambridgeAnonymousUser = null;

  // Rest context that can be used every time we need to make a request as a tenant admin
  let asCambridgeTenantAdmin = null;

  /**
   * Function that initializes the REST contexts
   */
  before(callback => {
    // Fill up the rest context for the anonymous user
    asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.cam.host);

    // Fill up the rest context for the admin tenant
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    return callback();
  });

  /**
   * Test that verifies that the Google Analytics config values are returned in the config feed
   */
  it('verify the config feed contains Google Analytics config values', callback => {
    // Create a regular user
    generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
      assert.notExists(err);
      const { 0: johnDoe } = users;

      // Check that the Google Analytics config values are available in the config feed for a regular user
      getTenantConfig(johnDoe.restContext, null, (err, config) => {
        assert.notExists(err);
        assert.exists(config);

        assert.isFalse(googleAnalyticsSettings(config).globalEnabled);
        assert.isEmpty(googleAnalyticsSettings(config).globalTrackingId);
        assert.isFalse(googleAnalyticsSettings(config).tenantEnabled);
        assert.isEmpty(googleAnalyticsSettings(config).tenantTrackingId);

        // Check that the Google Analytics config values are available in the config feed for a tenant admin
        getTenantConfig(asCambridgeTenantAdmin, null, (err, config) => {
          assert.notExists(err);
          assert.exists(config);

          assert.isFalse(googleAnalyticsSettings(config).globalEnabled);
          assert.isEmpty(googleAnalyticsSettings(config).globalTrackingId);
          assert.isFalse(googleAnalyticsSettings(config).tenantEnabled);
          assert.isEmpty(googleAnalyticsSettings(config).tenantTrackingId);

          // Check that the Google Analytics config values are available in the config feed for an anonymous user
          getTenantConfig(asCambridgeAnonymousUser, null, (err, config) => {
            assert.notExists(err);
            assert.exists(config);

            assert.isFalse(googleAnalyticsSettings(config).globalEnabled);
            assert.isEmpty(googleAnalyticsSettings(config).globalTrackingId);
            assert.isFalse(googleAnalyticsSettings(config).tenantEnabled);
            assert.isEmpty(googleAnalyticsSettings(config).tenantTrackingId);

            return callback();
          });
        });
      });
    });
  });
});
