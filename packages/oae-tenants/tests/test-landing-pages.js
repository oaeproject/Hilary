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

import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util.js';

describe('Tenant Landing Pages', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let anonymousCamRestContext = null;
  // Rest context that can be used every time we need to use a request as a global admin
  let globalAdminRestContext = null;

  /**
   * Function that will fill up the anonymous and the tenant admin context
   */
  before((callback) => {
    // Fill up anonymous rest context
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    // Fill up the global admin rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    return callback();
  });

  /**
   * Test that verifies that attributes are returned
   */
  it('verify the attributes are returned', (callback) => {
    TestsUtil.setupMultiTenantPrivacyEntities((tenant) => {
      // Clear the default landing page
      TenantsTestUtil.clearTenantLandingPage(tenant.adminRestContext, () => {
        // Configure all the attributes for the first block
        const configUpdate = {};
        configUpdate['oae-tenants/block_1/type'] = 'text';
        configUpdate['oae-tenants/block_1/text/default'] = 'some text';
        configUpdate['oae-tenants/block_1/xs'] = '100%';
        configUpdate['oae-tenants/block_1/sm'] = '100%';
        configUpdate['oae-tenants/block_1/md'] = '100%';
        configUpdate['oae-tenants/block_1/lg'] = '100%';
        configUpdate['oae-tenants/block_1/minHeight'] = '100';
        configUpdate['oae-tenants/block_1/horizontalAlign'] = 'left';
        configUpdate['oae-tenants/block_1/verticalAlign'] = 'top';
        configUpdate['oae-tenants/block_1/bgColor'] = 'red';
        configUpdate['oae-tenants/block_1/titleColor'] = 'green';
        configUpdate['oae-tenants/block_1/textColor'] = 'blue';
        configUpdate['oae-tenants/block_1/icon'] = 'https://foo.com/icon.png';
        configUpdate['oae-tenants/block_1/imgUrl'] = 'https://foo.com/img.png';
        configUpdate['oae-tenants/block_1/videoUrl'] = 'https://foo.com/video.wav';
        configUpdate['oae-tenants/block_1/videoPlaceholder'] = 'https://foo.com/video.placeholder.png';
        ConfigTestUtil.updateConfigAndWait(globalAdminRestContext, tenant.tenant.alias, configUpdate, () => {
          // Get the landing page information
          const anonymousRestContext = TestsUtil.createTenantRestContext(tenant.tenant.host);
          RestAPI.Tenants.getLandingPage(anonymousRestContext, (error, landingPage) => {
            assert.notExists(error);

            // Only 1 block has been configured
            assert.lengthOf(landingPage, 1);

            const firstBlock = landingPage[0];
            // Verify all attributes are returned
            assert.strictEqual(firstBlock.type, 'text');
            assert.strictEqual(firstBlock.text, 'some text');
            assert.strictEqual(firstBlock.xs, '100%');
            assert.strictEqual(firstBlock.sm, '100%');
            assert.strictEqual(firstBlock.md, '100%');
            assert.strictEqual(firstBlock.lg, '100%');
            assert.strictEqual(firstBlock.minHeight, '100');
            assert.strictEqual(firstBlock.horizontalAlign, 'left');
            assert.strictEqual(firstBlock.verticalAlign, 'top');
            assert.strictEqual(firstBlock.bgColor, 'red');
            assert.strictEqual(firstBlock.titleColor, 'green');
            assert.strictEqual(firstBlock.textColor, 'blue');
            assert.strictEqual(firstBlock.icon, 'https://foo.com/icon.png');
            assert.strictEqual(firstBlock.imgUrl, 'https://foo.com/img.png');
            assert.strictEqual(firstBlock.videoUrl, 'https://foo.com/video.wav');
            assert.strictEqual(firstBlock.videoPlaceholder, 'https://foo.com/video.placeholder.png');

            return callback();
          });
        });
      });
    });
  });

  /**
   * Test that verifies that only non-empty blocks are returned
   */
  it('verify empty blocks are not returned', (callback) => {
    TestsUtil.setupMultiTenantPrivacyEntities((tenant) => {
      // Clear the default landing page
      TenantsTestUtil.clearTenantLandingPage(tenant.adminRestContext, () => {
        // Configure 1 block on the the tenant's landing page
        const configUpdate = {};
        configUpdate['oae-tenants/block_1/type'] = 'text';
        configUpdate['oae-tenants/block_1/text/default'] = 'some text';
        ConfigTestUtil.updateConfigAndWait(globalAdminRestContext, tenant.tenant.alias, configUpdate, () => {
          // Get the landing page information
          const anonymousRestContext = TestsUtil.createTenantRestContext(tenant.tenant.host);
          RestAPI.Tenants.getLandingPage(anonymousRestContext, (error, landingPage) => {
            assert.notExists(error);

            // Only 1 block has been configured
            assert.strictEqual(landingPage.length, 1);

            return callback();
          });
        });
      });
    });
  });

  /**
   * Test that verifies that text attributes are internationalizable
   */
  it('verify that text attributes are internationalizable', (callback) => {
    TestsUtil.setupMultiTenantPrivacyEntities((tenant) => {
      // Configure the tenant's landing page
      const configUpdate = {};
      configUpdate['oae-tenants/block_1/type'] = 'text';
      configUpdate['oae-tenants/block_1/text/default'] = 'default text';
      configUpdate['oae-tenants/block_1/text/fr_FR'] = 'French text';
      ConfigTestUtil.updateConfigAndWait(globalAdminRestContext, tenant.tenant.alias, configUpdate, () => {
        const anonymousRestContext = TestsUtil.createTenantRestContext(tenant.tenant.host);
        RestAPI.Tenants.getLandingPage(anonymousRestContext, (error, landingPage) => {
          assert.notExists(error);

          // Verify the default text was returned
          assert.strictEqual(landingPage[0].text, 'default text');

          // Generate some test users
          TestsUtil.generateTestUsers(tenant.adminRestContext, 3, (error, users) => {
            assert.notExists(error);
            const { 0: frenchUser, 1: defaultUser, 2: hindiUser } = users;
            // Set a user's locale to French
            RestAPI.User.updateUser(frenchUser.restContext, frenchUser.user.id, { locale: 'fr_FR' }, (error_) => {
              assert.notExists(error_);

              // Get the landing page information with the French user
              RestAPI.Tenants.getLandingPage(frenchUser.restContext, (error, landingPage) => {
                assert.notExists(error);

                // Verify the French text was returned
                assert.strictEqual(landingPage[0].text, 'French text');

                // Get the landing page information with a user who has no configured locale
                RestAPI.Tenants.getLandingPage(defaultUser.restContext, (error, landingPage) => {
                  assert.notExists(error);

                  // Verify the default text was returned
                  assert.strictEqual(landingPage[0].text, 'default text');

                  // Set a user's locale to Hindi
                  RestAPI.User.updateUser(hindiUser.restContext, hindiUser.user.id, { locale: 'hi_IN' }, (error_) => {
                    assert.notExists(error_);

                    // Get the landing page information with the Hindi user
                    RestAPI.Tenants.getLandingPage(hindiUser.restContext, function (error, landingPage) {
                      assert.notExists(error);

                      // Verify the default text was returned
                      assert.strictEqual(landingPage[0].text, 'default text');
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

  /**
   * Test that verifies that blocks are not returned in the config
   */
  it('verify that blocks are not returned in the config', (callback) => {
    RestAPI.Config.getTenantConfig(anonymousCamRestContext, null, (error, config) => {
      assert.notExists(error);
      for (let i = 1; i <= 12; i++) {
        assert.ok(!config['oae-tenants']['block_' + i]);
      }

      return callback();
    });
  });
});
