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

import process from 'node:process';
import { assert } from 'chai';

import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util.js';
import * as TestsUtil from 'oae-tests';

import * as ConfigAPI from 'oae-config';

import { filter, equals, forEach, keys } from 'ramda';

const { clearConfigAndWait, updateConfigAndWait } = ConfigTestUtil;
const { getSchema, getTenantConfig } = RestAPI.Config;

const { setUpConfig } = ConfigAPI;
const { generateTestTenantAlias, generateTestTenantHost } = TenantsTestUtil;
const {
  createTenantWithAdmin,
  generateTestUsers,
  createGlobalAdminRestContext,
  createTenantAdminRestContext,
  createGlobalRestContext,
  createTenantRestContext
} = TestsUtil;

const { RECAPTCHA_KEY } = process.env;

describe('Configuration', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user on the Cambridge tenant
  let asCambridgeAnonymousUser = null;

  // Rest context that can be used every time we need to make a request as an anonymous user on the global admin tenant
  let asGlobalAnonymousUser = null;

  // Rest context that can be used every time we need to make a request as a tenant admin
  let asCambridgeTenantAdmin = null;

  // Rest context that can be used every time we need to make a request as a global admin
  let asGlobalAdmin = null;

  // Rest context for a user that will be used inside of the tests
  let asJohn = null;

  /*!
   * Function that will fill up the global admin, tenant admin and anymous rest context
   */
  before((callback) => {
    // Fill up the anonymous cam rest context
    asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.cam.host);

    // Fill up the anonymous global rest context
    asGlobalAnonymousUser = createGlobalRestContext();

    // Fill up tenant admin rest context
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // Fill up the global admin rest context
    asGlobalAdmin = createGlobalAdminRestContext();

    // Fill up the rest context for our test user
    generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);
      const { 0: john } = users;
      asJohn = john.restContext;

      return callback();
    });
  });

  /*!
   * Clear the configuration values that are changed during tests
   */
  afterEach((callback) => {
    // An update object to apply that will clear the values for the global admin
    const globalClearValues = [
      'oae-authentication/twitter/enabled',
      'oae-content/storage/amazons3-access-key',
      'oae-content/storage/backend',
      'oae-email/general/fromAddress',
      'oae-email/general/fromName',
      'oae-google-analytics/googleAnalytics/globalEnabled',
      'oae-principals/group/visibility',
      'oae-principals/recaptcha/privateKey',
      'oae-principals/recaptcha/publicKey',
      'oae-principals/termsAndConditions/text'
    ];

    // An array of values to clear on the tenant admin
    const tenantClearValues = [
      'oae-authentication/twitter/enabled',
      'oae-email/general/fromAddress',
      'oae-email/general/fromName',
      'oae-principals/group/visibility',
      'oae-principals/recaptcha/publicKey',
      'oae-principals/termsAndConditions/text'
    ];

    // Reset the global admin values by setting them to the empty string
    clearConfigAndWait(asGlobalAdmin, null, globalClearValues, (error) => {
      assert.notExists(error);

      // Reset the tenant values by using the tenant admin clear config
      clearConfigAndWait(asCambridgeTenantAdmin, null, tenantClearValues, (error) => {
        assert.notExists(error);
        return callback();
      });
    });
  });

  describe('Schema', () => {
    /**
     * Test that verifies that the configuration schema can be retrieved on the global admin server
     */
    it('verify get schema global', (callback) => {
      getSchema(asGlobalAdmin, (error, schema) => {
        assert.notExists(error);
        assert.ok(schema);
        assert.ok(schema['oae-authentication'].title);
        assert.strictEqual(schema['oae-authentication'].twitter.elements.enabled.defaultValue, true);

        // Verify that the anonymous users can't retrieve the schema
        getSchema(asGlobalAnonymousUser, (error, schema) => {
          assert.ok(error);
          assert.strictEqual(error.code, 401);
          assert.notExists(schema);

          return callback();
        });
      });
    });

    /**
     * Test that verifies that the configuration schema can be retrieved on the tenant server
     */
    it('verify get schema tenant', (callback) => {
      getSchema(asCambridgeTenantAdmin, (error, schema) => {
        assert.notExists(error);
        assert.ok(schema);
        assert.ok(schema['oae-authentication'].title);
        assert.strictEqual(schema['oae-authentication'].twitter.elements.enabled.defaultValue, true);

        // Verify that regular tenant users can't retrieve the schema
        getSchema(asJohn, (error, schema) => {
          assert.ok(error);
          assert.strictEqual(error.code, 401);
          assert.notExists(schema);

          // Verify that only anonymous users can't retrieve the schema
          getSchema(asCambridgeAnonymousUser, (error, schema) => {
            assert.ok(error);
            assert.strictEqual(error.code, 401);
            assert.notExists(schema);

            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies that the configuration schema for a global admin has `globalAdminOnly` values and
     * that the schema for a tenant admin excludes `globalAdminOnly` values.
     */
    it('verify globalAdminOnly', (callback) => {
      getSchema(asGlobalAdmin, (error, schema) => {
        assert.notExists(error);
        assert.ok(schema);
        assert.ok(schema['oae-content'].title);
        assert.strictEqual(schema['oae-content'].storage.elements['amazons3-access-key'].defaultValue, '<access-key>');

        getSchema(asCambridgeTenantAdmin, (error, schema) => {
          assert.notExists(error);
          assert.ok(schema);
          assert.ok(schema['oae-content'].title);
          assert.strictEqual(schema['oae-content'].storage.elements['amazons3-access-key'], undefined);

          return callback();
        });
      });
    });

    /**
     * Test that verifies that a `defaultValue` always returns in the schema, even when it's not provided
     * in the configuration file
     */
    it('verify defaultValue always returns', (callback) => {
      getSchema(asGlobalAdmin, (error, schema) => {
        assert.notExists(error);
        assert.strictEqual(schema['oae-email'].general.elements.fromAddress.defaultValue, '');

        return callback();
      });
    });
  });

  describe('Internal Configuration API', () => {
    /**
     * Test that verifies that a single configuration value can be retrieved from the cached configuration
     */
    it('verify get single config value', (callback) => {
      const AuthenticationConfig = ConfigAPI.setUpConfig('oae-authentication');
      const PrincipalsConfig = ConfigAPI.setUpConfig('oae-principals');

      // Retrieve a non-existing value
      assert.strictEqual(AuthenticationConfig.getValue(global.oaeTests.tenants.cam.alias, 'sso', 'enabled'), null);

      // Retrieve a boolean value
      assert.strictEqual(AuthenticationConfig.getValue(global.oaeTests.tenants.cam.alias, 'twitter', 'enabled'), true);

      // Retrieve a string value
      assert.strictEqual(
        PrincipalsConfig.getValue(global.oaeTests.tenants.cam.alias, 'user', 'defaultLanguage'),
        'en_GB'
      );

      // Retrieve a suppressed value
      assert.strictEqual(
        PrincipalsConfig.getValue(global.oaeTests.tenants.cam.alias, 'recaptcha', 'privateKey'),
        RECAPTCHA_KEY
      );

      return callback();
    });

    /**
     * Test that verifies the validation for retrieving a config value from the cached configuration
     */
    it('verify validation', (callback) => {
      // Verify that initializing a config factory needs a module name. This should throw an error
      assert.throws(() => {
        ConfigAPI.setUpConfig();
      });

      // Verify that a feature needs to be provided when getting a config value
      const AuthenticationConfig = ConfigAPI.setUpConfig('oae-authentication');

      assert.strictEqual(AuthenticationConfig.getValue(global.oaeTests.tenants.cam.alias), null);
      // Verify that an element needs to be provided when getting a config value
      assert.strictEqual(AuthenticationConfig.getValue(global.oaeTests.tenants.cam.alias, 'twitter'), null);

      return callback();
    });

    /**
     * Test that verifies the last updated timestamp is reflected when a value gets updated
     */
    it('verify the last updated timestamp increases when updated', (callback) => {
      const PrincipalsConfig = ConfigAPI.setUpConfig('oae-principals');

      // Not passing in any of the `tenantAlias`, `feature` or `element` parameters should result in the epoch date being returned
      assert.strictEqual(PrincipalsConfig.getLastUpdated().getTime(), 0);
      assert.strictEqual(PrincipalsConfig.getLastUpdated(global.oaeTests.tenants.cam.alias).getTime(), 0);
      assert.strictEqual(PrincipalsConfig.getLastUpdated(global.oaeTests.tenants.cam.alias, 'recaptcha').getTime(), 0);

      // Passing in an unknown element should result in the epoch date
      assert.strictEqual(
        PrincipalsConfig.getLastUpdated(global.oaeTests.tenants.cam.alias, 'careful', 'now').getTime(),
        0
      );

      /**
       * The createTenantWithAdmin test utility will set the recaptcha value to disabled when the tenant has been created.
       * This should be reflected in the last updated timestamp
       */
      const tenantAlias = generateTestTenantAlias();
      const host = generateTestTenantHost();

      createTenantWithAdmin(tenantAlias, host, (error, tenant, tenantAdminRestContext) => {
        assert.notExists(error);

        // Record the current value of the recaptcha config update timestamp
        const recaptchaUpdateTime = PrincipalsConfig.getLastUpdated(tenantAlias, 'recaptcha', 'enabled').getTime();
        assert.isAbove(recaptchaUpdateTime, 0);

        // Enable recaptcha on the tenant
        updateConfigAndWait(tenantAdminRestContext, null, { 'oae-principals/recaptcha/enabled': true }, (error_) => {
          assert.notExists(error_);

          // Ensure the config value update time is larger than it was before
          assert.ok(
            PrincipalsConfig.getLastUpdated(tenantAlias, 'recaptcha', 'enabled').getTime() > recaptchaUpdateTime
          );

          return callback();
        });
      });
    });

    /**
     * Test that verifies the last updated timestamp does not get updated when the value does not change
     */
    it('verify the last updated timestamp does not change when the config value did not change', (callback) => {
      const PrincipalsConfig = setUpConfig('oae-principals');
      const { getLastUpdated } = PrincipalsConfig;
      const tenantAlias = generateTestTenantAlias();
      const host = generateTestTenantHost();

      createTenantWithAdmin(tenantAlias, host, (error, tenant, tenantAdminRestContext) => {
        assert.notExists(error);

        // Record the current value of the recaptcha config update timestamp
        const recaptchaUpdateTime = getLastUpdated(tenantAlias, 'recaptcha', 'enabled').getTime();
        assert.isAbove(recaptchaUpdateTime, 0);

        // Update a different configuration field. Let's enable the twitter!
        updateConfigAndWait(tenantAdminRestContext, null, { 'oae-authentication/twitter/enabled': true }, (error_) => {
          assert.notExists(error_);

          // Ensure the recaptcha config update timestamp has not updated
          assert.strictEqual(
            PrincipalsConfig.getLastUpdated(tenantAlias, 'recaptcha', 'enabled').getTime(),
            recaptchaUpdateTime
          );

          return callback();
        });
      });
    });
  });

  describe('REST Configuration API', () => {
    /**
     * Test that verifies that the configuration can be retrieved on the global server
     */
    it('verify get global config', (callback) => {
      // Get the config as an admin user
      getTenantConfig(asGlobalAdmin, null, (error, config) => {
        assert.notExists(error);
        assert.ok(config);

        // Verify that a public value is present
        assert.strictEqual(config['oae-authentication'].twitter.enabled, true);
        // Verify that a suppressed value is present
        assert.strictEqual(config['oae-principals'].recaptcha.privateKey, RECAPTCHA_KEY);
        // Verify that a globalAdminOnly value is present
        assert.strictEqual(config['oae-content'].storage['amazons3-access-key'], '<access-key>');

        // Get the config as an anonymous user
        getTenantConfig(asGlobalAnonymousUser, null, (error, config) => {
          assert.notExists(error);
          assert.ok(config);

          // Verify that a public value is present
          assert.strictEqual(config['oae-authentication'].twitter.enabled, true);
          // Verify that a suppressed value is not present
          assert.strictEqual(config['oae-principals'].recaptcha.privateKey, undefined);
          // Verify that a globalAdminOnly value is not present
          assert.notExists(config['oae-content'].storage);

          return callback();
        });
      });
    });

    /**
     * Test that verifies that the configuration can be retrieved on the tenant server
     */
    it('verify get tenant config', (callback) => {
      // Get the config as an admin user
      getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
        assert.notExists(error);
        assert.ok(config);

        // Verify that a public value is present
        assert.strictEqual(config['oae-authentication'].twitter.enabled, true);
        // Verify that a suppressed value is present
        assert.strictEqual(config['oae-principals'].recaptcha.privateKey, RECAPTCHA_KEY);
        // Verify that a globalAdminOnly values are not present
        assert.notExists(config['oae-content'].storage);

        // Get the config as a logged in user
        getTenantConfig(asJohn, null, (error, config) => {
          assert.notExists(error);
          assert.ok(config);

          // Verify that a public value is present
          assert.strictEqual(config['oae-authentication'].twitter.enabled, true);
          // Verify that a suppressed value is not present
          assert.strictEqual(config['oae-principals'].recaptcha.privateKey, undefined);
          // Verify that a globalAdminOnly value is not present
          assert.ok(!config['oae-content'].storage);

          // Get the config as an anonymous user
          getTenantConfig(asCambridgeAnonymousUser, null, (error, config) => {
            assert.notExists(error);
            assert.ok(config);

            // Verify that a public value is present
            assert.strictEqual(config['oae-authentication'].twitter.enabled, true);
            // Verify that a suppressed value is not present
            assert.strictEqual(config['oae-principals'].recaptcha.privateKey, undefined);
            // Verify that a globalAdminOnly value is not present
            assert.notExists(config['oae-content'].storage);

            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies config fields on admin can be cleared
     */
    it('verify clear global config', (callback) => {
      // Start with an overriden configuration value
      updateConfigAndWait(asGlobalAdmin, null, { 'oae-authentication/twitter/enabled': false }, (error) => {
        assert.notExists(error);

        // Validate that the change has been made
        getTenantConfig(asGlobalAdmin, null, (error, config) => {
          assert.notExists(error);
          assert.ok(config);
          assert.strictEqual(config['oae-authentication'].twitter.enabled, false);

          // Validate that the change is reflected in the tenant configuration
          getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
            assert.notExists(error);
            assert.ok(config);
            assert.strictEqual(config['oae-authentication'].twitter.enabled, false);

            // Clear the global admin value
            clearConfigAndWait(asGlobalAdmin, null, ['oae-authentication/twitter/enabled'], (error_) => {
              assert.ok(!error_);

              // Validate that the global config value has reverted to the default
              getTenantConfig(asGlobalAdmin, null, (error, config) => {
                assert.notExists(error);
                assert.ok(config);
                assert.strictEqual(config['oae-authentication'].twitter.enabled, true);

                // Validate that the tenant config value has reverted to the default
                getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
                  assert.notExists(error);
                  assert.ok(config);
                  assert.strictEqual(config['oae-authentication'].twitter.enabled, true);

                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies clearing config fields
     */
    it('verify clear tenant config', (callback) => {
      updateConfigAndWait(asCambridgeTenantAdmin, null, { 'oae-authentication/twitter/enabled': false }, (error) => {
        assert.notExists(error);

        // Validate that the change has been made and has overriden the global config
        getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
          assert.notExists(error);
          assert.ok(config);
          assert.strictEqual(config['oae-authentication'].twitter.enabled, false);

          // Validate that the global admin still has the old values
          getTenantConfig(asGlobalAdmin, null, (error, config) => {
            assert.notExists(error);
            assert.ok(config);
            assert.strictEqual(config['oae-authentication'].twitter.enabled, true);

            // Clear the override
            clearConfigAndWait(asCambridgeTenantAdmin, null, ['oae-authentication/twitter/enabled'], (error_) => {
              assert.notExists(error_);

              // Verify that the value reverts to the default
              getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
                assert.notExists(error);
                assert.ok(config);
                assert.strictEqual(config['oae-authentication'].twitter.enabled, true);

                // Validate passing the element name as a string rather than an array works as well
                updateConfigAndWait(
                  asCambridgeTenantAdmin,
                  null,
                  { 'oae-authentication/twitter/enabled': false },
                  (error_) => {
                    assert.notExists(error_);

                    // Validate that the change has been made and has overriden the global config
                    getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
                      assert.notExists(error);
                      assert.ok(config);
                      assert.strictEqual(config['oae-authentication'].twitter.enabled, false);

                      // Clear the config
                      clearConfigAndWait(
                        asCambridgeTenantAdmin,
                        null,
                        'oae-authentication/twitter/enabled',
                        (error_) => {
                          assert.notExists(error_);

                          // Verify that the value reverts to the default
                          getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
                            assert.notExists(error);
                            assert.ok(config);
                            assert.strictEqual(config['oae-authentication'].twitter.enabled, true);

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
    });

    /**
     * Test that verifies that clearing both an element and one of its optional keys at the same time is not allowed
     */
    it('verify clearing both an element and one of its optional keys at the same time is not allowed', (callback) => {
      const configUpdate = {
        'oae-principals/termsAndConditions/text/en_CA': 'Canadian English',
        'oae-principals/termsAndConditions/text/en_GB': 'British English',
        'oae-principals/termsAndConditions/text/en_US': 'American English',
        'oae-principals/termsAndConditions/text/fr_BE': 'Belgian French',
        'oae-principals/termsAndConditions/text/fr_FR': 'French French'
      };
      updateConfigAndWait(asCambridgeTenantAdmin, null, configUpdate, (error) => {
        assert.notExists(error);

        // Clearing both en_GB and the entire text element should result in an error
        clearConfigAndWait(
          asCambridgeTenantAdmin,
          null,
          ['oae-principals/termsAndConditions/text/en_GB', 'oae-principals/termsAndConditions/text'],
          (error) => {
            assert.strictEqual(error.code, 400);

            // The order should not matter
            clearConfigAndWait(
              asCambridgeTenantAdmin,
              null,
              ['oae-principals/termsAndConditions/text', 'oae-principals/termsAndConditions/text/en_GB'],
              (error) => {
                assert.strictEqual(error.code, 400);

                // Assert all the values are still there
                getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
                  assert.notExists(error);
                  assert.isObject(config['oae-principals'].termsAndConditions.text);
                  assert.lengthOf(keys(config['oae-principals'].termsAndConditions.text), 6);
                  assert.strictEqual(config['oae-principals'].termsAndConditions.text.default, '');
                  assert.strictEqual(config['oae-principals'].termsAndConditions.text.en_CA, 'Canadian English');
                  assert.strictEqual(config['oae-principals'].termsAndConditions.text.en_GB, 'British English');
                  assert.strictEqual(config['oae-principals'].termsAndConditions.text.en_US, 'American English');
                  assert.strictEqual(config['oae-principals'].termsAndConditions.text.fr_BE, 'Belgian French');
                  assert.strictEqual(config['oae-principals'].termsAndConditions.text.fr_FR, 'French French');

                  return callback();
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that optional keys can be cleared from a config element
     */
    it('verify clear config when using optional keys', (callback) => {
      const configUpdate = {
        'oae-principals/termsAndConditions/text/en_CA': 'Canadian English',
        'oae-principals/termsAndConditions/text/en_GB': 'British English',
        'oae-principals/termsAndConditions/text/en_US': 'American English',
        'oae-principals/termsAndConditions/text/fr_BE': 'Belgian French',
        'oae-principals/termsAndConditions/text/fr_FR': 'French French'
      };
      updateConfigAndWait(asCambridgeTenantAdmin, null, configUpdate, (error) => {
        assert.notExists(error);

        // Verify all the values are present
        getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
          assert.notExists(error);
          assert.isObject(config['oae-principals'].termsAndConditions.text);
          assert.lengthOf(keys(config['oae-principals'].termsAndConditions.text), 6);
          assert.strictEqual(config['oae-principals'].termsAndConditions.text.default, '');
          assert.strictEqual(config['oae-principals'].termsAndConditions.text.en_CA, 'Canadian English');
          assert.strictEqual(config['oae-principals'].termsAndConditions.text.en_GB, 'British English');
          assert.strictEqual(config['oae-principals'].termsAndConditions.text.en_US, 'American English');
          assert.strictEqual(config['oae-principals'].termsAndConditions.text.fr_BE, 'Belgian French');
          assert.strictEqual(config['oae-principals'].termsAndConditions.text.fr_FR, 'French French');

          // Clearing just the British English value should not affect the other values
          clearConfigAndWait(
            asCambridgeTenantAdmin,
            null,
            ['oae-principals/termsAndConditions/text/en_GB'],
            (error_) => {
              assert.notExists(error_);

              // Verify the other values are unaffected
              getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
                assert.notExists(error);
                assert.isObject(config['oae-principals'].termsAndConditions.text);
                assert.lengthOf(keys(config['oae-principals'].termsAndConditions.text), 5);
                assert.notExists(config['oae-principals'].termsAndConditions.text.en_GB);
                assert.strictEqual(config['oae-principals'].termsAndConditions.text.default, '');
                assert.strictEqual(config['oae-principals'].termsAndConditions.text.en_CA, 'Canadian English');
                assert.strictEqual(config['oae-principals'].termsAndConditions.text.en_US, 'American English');
                assert.strictEqual(config['oae-principals'].termsAndConditions.text.fr_BE, 'Belgian French');
                assert.strictEqual(config['oae-principals'].termsAndConditions.text.fr_FR, 'French French');

                // Try clearing multiple keys
                clearConfigAndWait(
                  asCambridgeTenantAdmin,
                  null,
                  ['oae-principals/termsAndConditions/text/fr_BE', 'oae-principals/termsAndConditions/text/fr_FR'],
                  (error_) => {
                    assert.notExists(error_);

                    // Verify the other values are unaffected
                    getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
                      assert.notExists(error);
                      assert.isObject(config['oae-principals'].termsAndConditions.text);
                      assert.lengthOf(keys(config['oae-principals'].termsAndConditions.text), 3);
                      assert.notExists(config['oae-principals'].termsAndConditions.text.en_GB);
                      assert.notExists(config['oae-principals'].termsAndConditions.text.fr_FR);
                      assert.notExists(config['oae-principals'].termsAndConditions.text.fr_BE);
                      assert.strictEqual(config['oae-principals'].termsAndConditions.text.default, '');
                      assert.strictEqual(config['oae-principals'].termsAndConditions.text.en_CA, 'Canadian English');
                      assert.strictEqual(config['oae-principals'].termsAndConditions.text.en_US, 'American English');

                      // Reset the T&C field in its entirety
                      clearConfigAndWait(
                        asCambridgeTenantAdmin,
                        null,
                        ['oae-principals/termsAndConditions/text'],
                        (error_) => {
                          assert.notExists(error_);

                          // Only the default key should be present
                          getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
                            assert.notExists(error);
                            assert.isObject(config['oae-principals'].termsAndConditions.text);
                            assert.lengthOf(keys(config['oae-principals'].termsAndConditions.text), 1);
                            assert.strictEqual(config['oae-principals'].termsAndConditions.text.default, '');

                            // Check that we can still set a value
                            const configUpdate = {
                              'oae-principals/termsAndConditions/text/en_CA': 'Canadian English',
                              'oae-principals/termsAndConditions/text/en_GB': 'British English',
                              'oae-principals/termsAndConditions/text/en_US': 'American English',
                              'oae-principals/termsAndConditions/text/fr_BE': 'Belgian French',
                              'oae-principals/termsAndConditions/text/fr_FR': 'French French'
                            };
                            updateConfigAndWait(asCambridgeTenantAdmin, null, configUpdate, (error_) => {
                              assert.notExists(error_);

                              // Verify the update
                              getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
                                assert.notExists(error);
                                assert.isObject(config['oae-principals'].termsAndConditions.text);
                                assert.lengthOf(keys(config['oae-principals'].termsAndConditions.text), 6);
                                assert.strictEqual(config['oae-principals'].termsAndConditions.text.default, '');
                                assert.strictEqual(
                                  config['oae-principals'].termsAndConditions.text.en_CA,
                                  'Canadian English'
                                );
                                assert.strictEqual(
                                  config['oae-principals'].termsAndConditions.text.en_GB,
                                  'British English'
                                );
                                assert.strictEqual(
                                  config['oae-principals'].termsAndConditions.text.en_US,
                                  'American English'
                                );
                                assert.strictEqual(
                                  config['oae-principals'].termsAndConditions.text.fr_BE,
                                  'Belgian French'
                                );
                                assert.strictEqual(
                                  config['oae-principals'].termsAndConditions.text.fr_FR,
                                  'French French'
                                );

                                return callback();
                              });
                            });
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

    /**
     * Test that verifies that the configuration can be retrieved for the tenant server through the global admin
     */
    it('verify get tenant config through global tenant', (callback) => {
      // Get the config as an admin user
      getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
        assert.notExists(error);
        assert.ok(config);

        // Verify that a public value is present
        assert.strictEqual(config['oae-authentication'].twitter.enabled, true);

        // Verify that a suppressed value is present
        assert.strictEqual(config['oae-principals'].recaptcha.privateKey, RECAPTCHA_KEY);

        // Verify that a globalAdminOnly value is present
        assert.strictEqual(config['oae-content'].storage['amazons3-access-key'], '<access-key>');

        // Get the config as an anonymous user
        getTenantConfig(asGlobalAnonymousUser, global.oaeTests.tenants.cam.alias, (error, config) => {
          assert.notExists(error);
          assert.ok(config);

          // Verify that a public value is present
          assert.strictEqual(config['oae-authentication'].twitter.enabled, true);

          // Verify that a suppressed value is not present
          assert.strictEqual(config['oae-principals'].recaptcha.privateKey, undefined);

          // Verify that a globalAdminOnly value is not present
          assert.notExists(config['oae-content'].storage);

          callback();
        });
      });
    });

    /**
     * Test that verifies that a global configuration value can be persisted
     */
    it('verify set config value global', (callback) => {
      updateConfigAndWait(asGlobalAdmin, null, { 'oae-authentication/twitter/enabled': false }, (error) => {
        assert.notExists(error);

        // Validate that the change has been made
        getTenantConfig(asGlobalAdmin, null, (error, config) => {
          assert.notExists(error);
          assert.ok(config);
          assert.strictEqual(config['oae-authentication'].twitter.enabled, false);

          // Validate that the tenant admin can see this as well
          getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
            assert.notExists(error);
            assert.ok(config);
            assert.strictEqual(config['oae-authentication'].twitter.enabled, false);

            // Set a new value for a suppressed config value
            updateConfigAndWait(asGlobalAdmin, null, { 'oae-principals/recaptcha/privateKey': 'newKey' }, (error_) => {
              assert.notExists(error_);

              // Validate that the change has been made
              getTenantConfig(asGlobalAdmin, null, (error, config) => {
                assert.notExists(error);
                assert.ok(config);
                assert.strictEqual(config['oae-principals'].recaptcha.privateKey, 'newKey');

                // Validate that the tenant admin can see this as well
                getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
                  assert.notExists(error);
                  assert.ok(config);
                  assert.strictEqual(config['oae-principals'].recaptcha.privateKey, 'newKey');

                  // Validate that a non-admin user can still not see this
                  getTenantConfig(asJohn, null, (error, config) => {
                    assert.notExists(error);
                    assert.ok(config);
                    assert.strictEqual(config['oae-principals'].recaptcha.privateKey, undefined);

                    return callback();
                  });
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that a tenant configuration value can be persisted
     */
    it('verify set tenant config value', (callback) => {
      updateConfigAndWait(asCambridgeTenantAdmin, null, { 'oae-authentication/twitter/enabled': false }, (error) => {
        assert.notExists(error);

        // Validate that the change has been made and has overriden the global config
        getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
          assert.notExists(error);
          assert.ok(config);
          assert.strictEqual(config['oae-authentication'].twitter.enabled, false);

          // Validate that the new value can be retrieved through the global admin
          getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
            assert.notExists(error);
            assert.ok(config);
            assert.strictEqual(config['oae-authentication'].twitter.enabled, false);

            // Set a new value for a suppressed config value
            updateConfigAndWait(
              asCambridgeTenantAdmin,
              null,
              { 'oae-principals/recaptcha/privateKey': 'newTenantKey' },
              (error_) => {
                assert.notExists(error_);

                // Validate that the tenant admin can see this as well
                getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
                  assert.notExists(error);
                  assert.ok(config);
                  assert.strictEqual(config['oae-principals'].recaptcha.privateKey, 'newTenantKey');

                  // Validate that a non-admin user can still not see this
                  getTenantConfig(asJohn, null, (error, config) => {
                    assert.notExists(error);
                    assert.ok(config);
                    assert.strictEqual(config['oae-principals'].recaptcha.privateKey, undefined);

                    // Validate that the global admin still has the old values
                    getTenantConfig(asGlobalAdmin, null, (error, config) => {
                      assert.notExists(error);
                      assert.ok(config);
                      assert.strictEqual(config['oae-authentication'].twitter.enabled, true);
                      assert.strictEqual(config['oae-principals'].recaptcha.privateKey, RECAPTCHA_KEY);

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

    /**
     * Test that verifies that a tenant configuration value can be persisted through the global server
     */
    it('verify set tenant config value from global tenant', (callback) => {
      updateConfigAndWait(
        asGlobalAdmin,
        global.oaeTests.tenants.cam.alias,
        { 'oae-authentication/twitter/enabled': false },
        (error) => {
          assert.notExists(error);

          // Validate that the change has been made from the global admin
          getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
            assert.notExists(error);
            assert.ok(config);
            assert.strictEqual(config['oae-authentication'].twitter.enabled, false);

            // Validate that the change has been made from the tenant admin
            getTenantConfig(asCambridgeTenantAdmin, null, (error, config) => {
              assert.notExists(error);
              assert.ok(config);
              assert.strictEqual(config['oae-authentication'].twitter.enabled, false);

              return callback();
            });
          });
        }
      );
    });

    /**
     * Test that boolean and non-boolean values are coerced correctly
     */
    it('verify config value coercion', (callback) => {
      // Get Boolean config value that's supposed to be `true`
      getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
        assert.notExists(error);
        assert.ok(config);
        assert.strictEqual(config['oae-authentication'].local.enabled, true);

        // Change the value to false using '0', which would be used by checkboxes
        updateConfigAndWait(
          asGlobalAdmin,
          global.oaeTests.tenants.cam.alias,
          { 'oae-authentication/local/enabled': '0' },
          (error_) => {
            assert.notExists(error_);

            getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
              assert.notExists(error);
              assert.ok(config);
              assert.strictEqual(config['oae-authentication'].local.enabled, false);

              // Change the value to true using '1', which would be used by checkboxes
              updateConfigAndWait(
                asGlobalAdmin,
                global.oaeTests.tenants.cam.alias,
                { 'oae-authentication/local/enabled': '1' },
                (error_) => {
                  assert.notExists(error_);

                  getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
                    assert.notExists(error);
                    assert.ok(config);
                    assert.strictEqual(config['oae-authentication'].local.enabled, true);

                    // Change the value to false using the 'false' string
                    updateConfigAndWait(
                      asGlobalAdmin,
                      global.oaeTests.tenants.cam.alias,
                      { 'oae-authentication/local/enabled': 'false' },
                      (error_) => {
                        assert.notExists(error_);

                        getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
                          assert.notExists(error);
                          assert.ok(config);
                          assert.strictEqual(config['oae-authentication'].local.enabled, false);

                          // Change the value back to true using the 'true' string
                          updateConfigAndWait(
                            asGlobalAdmin,
                            global.oaeTests.tenants.cam.alias,
                            { 'oae-authentication/local/enabled': 'true' },
                            (error_) => {
                              assert.notExists(error_);

                              getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
                                assert.notExists(error);
                                assert.ok(config);
                                assert.strictEqual(config['oae-authentication'].local.enabled, true);

                                // Get non-Boolean config value
                                getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
                                  assert.notExists(error);
                                  assert.ok(config);

                                  // Change the value to '1' and ensure it isn't coerced to a boolean
                                  updateConfigAndWait(
                                    asGlobalAdmin,
                                    global.oaeTests.tenants.cam.alias,
                                    { 'oae-email/general/fromName': '1' },
                                    (error_) => {
                                      assert.notExists(error_);

                                      getTenantConfig(
                                        asGlobalAdmin,
                                        global.oaeTests.tenants.cam.alias,
                                        (error, config) => {
                                          assert.notExists(error);
                                          assert.ok(config);
                                          assert.strictEqual(config['oae-email'].general.fromName, '1');

                                          // Change the value to '0' and ensure it isn't coerced to a boolean
                                          updateConfigAndWait(
                                            asGlobalAdmin,
                                            global.oaeTests.tenants.cam.alias,
                                            { 'oae-email/general/fromName': '0' },
                                            (error_) => {
                                              assert.notExists(error_);

                                              getTenantConfig(
                                                asGlobalAdmin,
                                                global.oaeTests.tenants.cam.alias,
                                                (error, config) => {
                                                  assert.notExists(error);
                                                  assert.ok(config);
                                                  assert.strictEqual(config['oae-email'].general.fromName, '0');

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

    /**
     * Test that verifies validation on setting and retrieving config
     */
    it('verify configuration validation', (callback) => {
      // Missing configField
      updateConfigAndWait(asGlobalAdmin, null, { null: false }, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 404);

        // Missing configValue
        updateConfigAndWait(asGlobalAdmin, null, { 'oae-authentication/twitter/enabled': null }, (error) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);

          // Try changing the config with an invalid tenant id
          updateConfigAndWait(asGlobalAdmin, ' ', { 'oae-authentication/twitter/enabled': false }, (error) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);

            // Ensure the value did not change
            getTenantConfig(asGlobalAdmin, null, (error, config) => {
              assert.notExists(error);
              assert.strictEqual(config['oae-authentication'].twitter.enabled, true);

              // Try updating a non-existing configuration option
              updateConfigAndWait(asGlobalAdmin, null, { 'oae-non/existing/options': 'moops' }, (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 404);

                // Set the amazon s3 access key to a non-empty string so we can later verify we can set it to the empty string
                updateConfigAndWait(
                  asGlobalAdmin,
                  null,
                  { 'oae-content/storage/amazons3-access-key': 'blahblahblah' },
                  (error_) => {
                    assert.notExists(error_);

                    // Verify the value changed to the string we set
                    getTenantConfig(asGlobalAdmin, null, (error, testSetEmptyStringConfig) => {
                      assert.notExists(error);
                      assert.strictEqual(
                        testSetEmptyStringConfig['oae-content'].storage['amazons3-access-key'],
                        'blahblahblah'
                      );

                      // Ensure a text configuration option can be set to the empty string
                      updateConfigAndWait(
                        asGlobalAdmin,
                        null,
                        { 'oae-content/storage/amazons3-access-key': '' },
                        (error_) => {
                          assert.notExists(error_);

                          // Verify the value became the empty string
                          getTenantConfig(asGlobalAdmin, null, (error, testSetEmptyStringConfig) => {
                            assert.notExists(error);
                            assert.strictEqual(
                              testSetEmptyStringConfig['oae-content'].storage['amazons3-access-key'],
                              ''
                            );

                            // Try changing the tenant config as a regular user (non-admin)
                            updateConfigAndWait(
                              asJohn,
                              null,
                              { 'oae-authentication/twitter/enabled': false },
                              (error_) => {
                                assert.ok(error_);
                                assert.strictEqual(error_.code, 401);

                                // Try changing the tenant config as an anonymous user
                                updateConfigAndWait(
                                  asCambridgeAnonymousUser,
                                  null,
                                  { 'oae-authentication/twitter/enabled': false },
                                  (error_) => {
                                    assert.ok(error_);
                                    assert.strictEqual(error_.code, 401);

                                    // Try changing the global config as an anonymous user
                                    updateConfigAndWait(
                                      asGlobalAnonymousUser,
                                      null,
                                      { 'oae-authentication/twitter/enabled': false },
                                      (error_) => {
                                        assert.ok(error_);
                                        assert.strictEqual(error_.code, 401);

                                        // Ensure Cambridge configuration of twitter did not change
                                        getTenantConfig(asJohn, null, (error, config) => {
                                          assert.notExists(error);
                                          assert.strictEqual(config['oae-authentication'].twitter.enabled, true);

                                          // Ensure global configuration of twitter did not change
                                          getTenantConfig(asGlobalAdmin, null, (error, config) => {
                                            assert.notExists(error);
                                            assert.strictEqual(config['oae-authentication'].twitter.enabled, true);

                                            // Try changing the global config as a regular user (non-admin)
                                            updateConfigAndWait(
                                              asJohn,
                                              null,
                                              {
                                                'oae-content/storage/amazons3-access-key': 'moops'
                                              },
                                              (error_) => {
                                                assert.ok(error_);
                                                assert.strictEqual(error_.code, 401);

                                                // Ensure the amazons3 access key value did not change from the empty string
                                                getTenantConfig(
                                                  asGlobalAdmin,
                                                  global.oaeTests.tenants.cam.alias,
                                                  (error, config) => {
                                                    assert.notExists(error);
                                                    assert.strictEqual(
                                                      config['oae-content'].storage['amazons3-access-key'],
                                                      ''
                                                    );

                                                    // Try changing a config option that is not editable by a tenant (tenantOverride=false) as a tenant admin
                                                    updateConfigAndWait(
                                                      asCambridgeTenantAdmin,
                                                      null,
                                                      {
                                                        'oae-google-analytics/googleAnalytics/globalEnabled': '1'
                                                      },
                                                      (error_) => {
                                                        assert.ok(error_);
                                                        assert.strictEqual(error_.code, 401);

                                                        // Ensure the value did not change
                                                        getTenantConfig(
                                                          asCambridgeTenantAdmin,
                                                          null,
                                                          (error, config) => {
                                                            assert.notExists(error);
                                                            assert.strictEqual(
                                                              config['oae-google-analytics'].googleAnalytics
                                                                .globalEnabled,
                                                              false
                                                            );

                                                            // Verify that a global administrator can update `tenantOverride=false` configuration options
                                                            updateConfigAndWait(
                                                              asGlobalAdmin,
                                                              null,
                                                              {
                                                                'oae-google-analytics/googleAnalytics/globalEnabled':
                                                                  '1'
                                                              },
                                                              (error_) => {
                                                                assert.notExists(error_);

                                                                // Ensure the value changed
                                                                getTenantConfig(
                                                                  asCambridgeTenantAdmin,
                                                                  null,
                                                                  (error, config) => {
                                                                    assert.notExists(error);
                                                                    assert.strictEqual(
                                                                      config['oae-google-analytics'].googleAnalytics
                                                                        .globalEnabled,
                                                                      true
                                                                    );

                                                                    // Verify getting tenant configuration through the global server needs a valid ID
                                                                    getTenantConfig(
                                                                      asGlobalAdmin,
                                                                      ' ',
                                                                      (error__ /* , config */) => {
                                                                        assert.ok(error__);
                                                                        assert.strictEqual(error__.code, 400);

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
                                          });
                                        });
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
            });
          });
        });
      });
    });

    /**
     * Test that verifies the functionality of an internationalizable text config field
     */
    it('verify internationalizable field', (callback) => {
      // Verify there is a default key
      getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
        assert.notExists(error);
        assert.isObject(config['oae-principals'].termsAndConditions.text);
        assert.lengthOf(keys(config['oae-principals'].termsAndConditions.text), 1);
        assert.strictEqual(config['oae-principals'].termsAndConditions.text.default, '');

        // Set some American English text
        updateConfigAndWait(
          asGlobalAdmin,
          global.oaeTests.tenants.cam.alias,
          { 'oae-principals/termsAndConditions/text/en_US': 'Some legalese in American English' },
          (error_) => {
            assert.notExists(error_);
            getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
              assert.notExists(error);
              assert.isObject(config['oae-principals'].termsAndConditions.text);
              assert.lengthOf(keys(config['oae-principals'].termsAndConditions.text), 2);
              assert.strictEqual(config['oae-principals'].termsAndConditions.text.default, '');
              assert.strictEqual(
                config['oae-principals'].termsAndConditions.text.en_US,
                'Some legalese in American English'
              );

              // Set some Dutch text
              updateConfigAndWait(
                asGlobalAdmin,
                global.oaeTests.tenants.cam.alias,
                {
                  'oae-principals/termsAndConditions/text/nl_BE': 'Een waterdicht legaal contract'
                },
                (error_) => {
                  assert.notExists(error_);
                  getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
                    assert.notExists(error);
                    assert.isObject(config['oae-principals'].termsAndConditions.text);
                    assert.lengthOf(keys(config['oae-principals'].termsAndConditions.text), 3);
                    assert.strictEqual(config['oae-principals'].termsAndConditions.text.default, '');
                    assert.strictEqual(
                      config['oae-principals'].termsAndConditions.text.en_US,
                      'Some legalese in American English'
                    );
                    assert.strictEqual(
                      config['oae-principals'].termsAndConditions.text.nl_BE,
                      'Een waterdicht legaal contract'
                    );

                    // Verify that updating the American English text doesn't change the other languages
                    updateConfigAndWait(
                      asGlobalAdmin,
                      global.oaeTests.tenants.cam.alias,
                      {
                        'oae-principals/termsAndConditions/text/en_US': 'Some updated legalese in American English'
                      },
                      (error_) => {
                        assert.notExists(error_);
                        getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
                          assert.notExists(error);
                          assert.isObject(config['oae-principals'].termsAndConditions.text);
                          assert.lengthOf(keys(config['oae-principals'].termsAndConditions.text), 3);
                          assert.strictEqual(config['oae-principals'].termsAndConditions.text.default, '');
                          assert.strictEqual(
                            config['oae-principals'].termsAndConditions.text.en_US,
                            'Some updated legalese in American English'
                          );
                          assert.strictEqual(
                            config['oae-principals'].termsAndConditions.text.nl_BE,
                            'Een waterdicht legaal contract'
                          );

                          // Verify that updating multiple keys does not affect the keys that should not be updated
                          const update = {
                            'oae-principals/termsAndConditions/text/en_US': 'en us text',
                            'oae-principals/termsAndConditions/text/fr_FR': 'fr fr text'
                          };

                          updateConfigAndWait(asGlobalAdmin, global.oaeTests.tenants.cam.alias, update, (error_) => {
                            assert.notExists(error_);

                            getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
                              assert.notExists(error);
                              assert.isObject(config['oae-principals'].termsAndConditions.text);
                              assert.lengthOf(keys(config['oae-principals'].termsAndConditions.text), 4);
                              assert.strictEqual(config['oae-principals'].termsAndConditions.text.default, '');
                              assert.strictEqual(config['oae-principals'].termsAndConditions.text.en_US, 'en us text');
                              assert.strictEqual(
                                config['oae-principals'].termsAndConditions.text.nl_BE,
                                'Een waterdicht legaal contract'
                              );
                              assert.strictEqual(config['oae-principals'].termsAndConditions.text.fr_FR, 'fr fr text');

                              return callback();
                            });
                          });
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

    /**
     * Test that verifies text config values get trimmed
     */
    it('verify text field gets trimmed', (callback) => {
      // Set the recaptcha public key to a value that needs trimming on the global tenant
      updateConfigAndWait(
        asGlobalAdmin,
        null,
        { 'oae-principals/recaptcha/publicKey': ' untrimmed value ' },
        (error) => {
          assert.notExists(error);

          // Ensure the recaptcha public key is trimmed
          getTenantConfig(asGlobalAdmin, null, (error, config) => {
            assert.notExists(error);
            assert.strictEqual(config['oae-principals'].recaptcha.publicKey, 'untrimmed value');

            // Set the recaptcha public key to only whitespace and ensure it is treated like the empty string
            updateConfigAndWait(asGlobalAdmin, null, { 'oae-principals/recaptcha/publicKey': ' ' }, (error_) => {
              assert.notExists(error_);

              // It should have become the empty string
              getTenantConfig(asGlobalAdmin, null, (error, config) => {
                assert.notExists(error);
                assert.strictEqual(config['oae-principals'].recaptcha.publicKey, '');

                // Set the recaptcha public key to a value that needs trimming on a user tenant
                updateConfigAndWait(
                  asGlobalAdmin,
                  global.oaeTests.tenants.cam.alias,
                  { 'oae-principals/recaptcha/publicKey': ' untrimmed value ' },
                  (error_) => {
                    assert.notExists(error_);

                    // Ensure the recaptcha public key is trimmed
                    getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
                      assert.notExists(error);
                      assert.strictEqual(config['oae-principals'].recaptcha.publicKey, 'untrimmed value');

                      // Set the recaptcha public key to only whitespace and ensure it is treated like the empty string
                      updateConfigAndWait(
                        asGlobalAdmin,
                        global.oaeTests.tenants.cam.alias,
                        { 'oae-principals/recaptcha/publicKey': ' ' },
                        (error_) => {
                          assert.notExists(error_);

                          // Ensure the recaptcha public key became the empty string
                          getTenantConfig(asGlobalAdmin, null, (error, config) => {
                            assert.notExists(error);
                            assert.strictEqual(config['oae-principals'].recaptcha.publicKey, '');

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
        }
      );
    });

    /**
     * Test that verifies the functionality of the list config field
     */
    it('verify list field', (callback) => {
      // Verify the `list` property is returned in the schema and that it contains the correct objects
      RestAPI.Config.getSchema(asGlobalAdmin, (error, schema) => {
        assert.notExists(error);
        assert.isArray(schema['oae-principals'].group.elements.visibility.list);
        forEach((listOption) => {
          assert.ok(listOption.name);
          assert.ok(listOption.value);
        }, schema['oae-principals'].group.elements.visibility.list);

        // Assert that there is a value 'private' in the list
        const privateValues = filter(
          (option) => equals(option.value, 'private'),
          schema['oae-principals'].group.elements.visibility.list
        );
        assert.lengthOf(privateValues, 1);

        // Set a value for a list config field
        updateConfigAndWait(
          asGlobalAdmin,
          global.oaeTests.tenants.cam.alias,
          { 'oae-principals/group/visibility': 'private' },
          (error_) => {
            assert.notExists(error_);

            getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
              assert.notExists(error);
              assert.strictEqual(config['oae-principals'].group.visibility, 'private');

              // Clear the config and ensure it goes back to the default
              clearConfigAndWait(
                asGlobalAdmin,
                global.oaeTests.tenants.cam.alias,
                ['oae-principals/group/visibility'],
                (error_) => {
                  assert.notExists(error_);

                  getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
                    assert.notExists(error);
                    assert.strictEqual(config['oae-principals'].group.visibility, 'public');

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
     * Test that verifies the functionality of the radio config field
     */
    it('verify radio field', (callback) => {
      // Verify the `group` property is returned in the schema and that it contains the correct objects
      getSchema(asGlobalAdmin, (error, schema) => {
        assert.notExists(error);
        assert.isArray(schema['oae-content'].storage.elements.backend.group);
        forEach((listOption) => {
          assert.ok(listOption.name);
          assert.ok(listOption.value);
        }, schema['oae-content'].storage.elements.backend.group);

        // Assert that there is a value 'amazons3' in the set
        const amazons3Values = filter(
          (option) => equals(option.value, 'amazons3'),
          schema['oae-content'].storage.elements.backend.group
        );
        assert.lengthOf(amazons3Values, 1);

        // Update one of the values
        updateConfigAndWait(
          asGlobalAdmin,
          global.oaeTests.tenants.cam.alias,
          { 'oae-content/storage/backend': 'amazons3' },
          (error_) => {
            assert.notExists(error_);

            getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
              assert.notExists(error);
              assert.strictEqual(config['oae-content'].storage.backend, 'amazons3');

              // Clear the config and ensure it goes back to the default
              clearConfigAndWait(
                asGlobalAdmin,
                global.oaeTests.tenants.cam.alias,
                ['oae-content/storage/backend'],
                (error_) => {
                  assert.notExists(error_);

                  getTenantConfig(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error, config) => {
                    assert.notExists(error);
                    assert.strictEqual(config['oae-content'].storage.backend, 'local');

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
