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
import fs from 'fs';
import { format } from 'util';
import path from 'path';

import * as RestAPI from 'oae-rest';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util.js';
import * as TestsUtil from 'oae-tests';

import * as UIAPI from 'oae-ui';
import { UIConstants } from 'oae-ui/lib/constants.js';
import * as UITestUtil from 'oae-ui/lib/test/util.js';

const { getUIDirectory, init, translate } = UIAPI;
const { updateSkinAndWait } = UITestUtil;
const { generateTestTenantAlias, generateTestTenantHost } = TenantsTestUtil;
const {
  createTenantWithAdmin,
  createTenantRestContext,
  createTenantAdminRestContext,
  createGlobalAdminRestContext,
  createGlobalRestContext,
  generateTestUsers
} = TestsUtil;
const { getLogo, getSkinVariables, getSkin, getWidgetManifests, uploadLogo, getStaticBatch } = RestAPI.UI;

import { equals, forEach, nth, keys } from 'ramda';

describe('UI', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user to the cambridge tenant
  let asCambridgeAnonymousUser = null;

  // Rest context that can be used every time we need to make a request as an anonymous user to the gt tenant
  let asGeorgiaTechAnonymousUser = null;

  // Rest context that can be used for anonymous requests on the global tenant
  let asGlobalAnonymous = null;

  // Rest context that can be used for authenticated requests on the global tenant
  let asGlobalAdmin = null;

  // Rest context that can be used every time we need to make a request as an admin user to the cambridge tenant
  let asCambridgeTenantAdmin = null;

  /**
   * Even though the UI uses capitals for color declarations, we have to use lower case
   * here as LESS will convert all RGB codes to lower case.
   */
  const DEFAULT_BODY_BACKGROUND_COLOR = 'eceae5';

  /**
   * Function that will fill up the anonymous tenant and global REST context
   */
  before((callback) => {
    // Fill up anonymous rest contexts
    asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.cam.host);
    asGeorgiaTechAnonymousUser = createTenantRestContext(global.oaeTests.tenants.gt.host);

    // Fill up the anonymous global rest context
    asGlobalAnonymous = createGlobalRestContext();

    // Fill up the authenticated global rest context
    asGlobalAdmin = createGlobalAdminRestContext();

    // Fill up the cambridge administrator rest context
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    callback();
  });

  describe('Widget config aggregation', () => {
    /**
     * Test that verifies that the aggregated widget configs can be retrieved
     */
    it('verify widget configs', (callback) => {
      // Get the widget configs on the global admin server
      getWidgetManifests(asGlobalAnonymous, (error, data) => {
        assert.notExists(error);
        assert.ok(data.topnavigation);
        assert.strictEqual(data.topnavigation.id, 'topnavigation');
        assert.strictEqual(data.topnavigation.path, 'oae-core/topnavigation/');
        assert.ok(data.topnavigation.i18n);

        // Get the widget configs on the tenant server
        getWidgetManifests(asCambridgeAnonymousUser, (error, data) => {
          assert.notExists(error);
          assert.ok(data.topnavigation);
          assert.strictEqual(data.topnavigation.id, 'topnavigation');
          assert.strictEqual(data.topnavigation.path, 'oae-core/topnavigation/');
          assert.ok(data.topnavigation.i18n);

          callback();
        });
      });
    });
  });

  describe('Batch static files', () => {
    /**
     * Test that verifies that static files can be batch requested
     */
    it('verify batch static get', (callback) => {
      let files = ['/ui/index.html', '/node_modules/oae-core/footer/js/footer.js', '/nonexisting'];

      // Get these files on the global admin server
      getStaticBatch(asGlobalAnonymous, files, (error, batch1) => {
        assert.notExists(error);

        const firstFile = nth(0, files);
        const secondFile = nth(1, files);
        const lastFile = nth(2, files);

        assert.lengthOf(keys(batch1), 3);

        // Verify that the /ui/index.html file is present
        assert.ok(batch1[firstFile]);
        assert.isString(batch1[firstFile]);

        // Verify that the /node_modules/oae-core/footer/js/footer.js file is present
        assert.ok(batch1[secondFile]);
        assert.isString(batch1[secondFile]);

        // Verify that the /nonexisting file is not present
        assert.strictEqual(batch1[lastFile], null);

        // Get these files on the tenant server
        getStaticBatch(asCambridgeAnonymousUser, files, (error, batch2) => {
          assert.notExists(error);

          const firstFile = nth(0, files);
          const secondFile = nth(1, files);
          const lastFile = nth(2, files);

          assert.lengthOf(keys(batch2), 3);

          // Verify that the /ui/index.html file is present
          assert.ok(batch2[firstFile]);
          assert.isString(batch2[firstFile]);

          // Verify that the /node_modules/oae-core/footer/js/footer.js file is present
          assert.ok(batch2[secondFile]);
          assert.isString(batch2[secondFile]);

          // Verify that the /nonexisting file is not present
          assert.strictEqual(batch2[lastFile], null);

          // Make sure that the files from batch1 and batch2 are the same
          assert.strictEqual(batch1[firstFile], batch2[firstFile]);
          assert.strictEqual(batch1[secondFile], batch2[secondFile]);

          // Do another set of batch requests with some of the same files, to make sure they are being server from cache
          files = ['/node_modules/oae-core/footer/css/footer.css', '/ui/index.html'];

          // Get these files on the global admin server
          getStaticBatch(asGlobalAnonymous, files, (error, batch3) => {
            assert.notExists(error);

            const firstFile = nth(0, files);
            const secondFile = nth(1, files);

            assert.lengthOf(keys(batch3), 2);

            // Verify that the /ui/index.html file is present
            assert.ok(batch3[firstFile]);
            assert.isString(batch3[firstFile]);

            // Verify that the /node_modules/oae-core/footer/js/footer.js file is present
            assert.ok(batch3[secondFile]);
            assert.isString(batch3[secondFile]);

            // Make sure that /ui/index.html has the same content in both batches
            assert.strictEqual(batch3['/ui/index.html'], batch1['/ui/index.html']);

            // Get these files on the tenant server
            getStaticBatch(asCambridgeAnonymousUser, files, (error, batch4) => {
              assert.notExists(error);

              const firstFile = nth(0, files);
              const secondFile = nth(1, files);

              assert.lengthOf(keys(batch4), 2);

              // Verify that the /ui/index.html file is present
              assert.ok(batch4[firstFile]);
              assert.isString(batch4[firstFile]);

              // Verify that the /node_modules/oae-core/footer/js/footer.js file is present
              assert.ok(batch4[secondFile]);
              assert.isString(batch4[secondFile]);

              // Make sure that /ui/index.html has the same content in both batches
              assert.strictEqual(batch4['/ui/index.html'], batch2['/ui/index.html']);

              callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies that a single file can be retrieved through a batch request
     */
    it('verify batch single file', (callback) => {
      const file = '/ui/index.html';
      // Test this on the global admin server
      getStaticBatch(asGlobalAnonymous, file, (error, data) => {
        assert.notExists(error);

        assert.lengthOf(keys(data), 1);
        assert.ok(data[file]);
        assert.isString(data[file]);

        // Test this on the tenant server
        getStaticBatch(asCambridgeAnonymousUser, file, (error, data) => {
          assert.notExists(error);

          assert.lengthOf(keys(data), 1);
          assert.ok(data[file]);
          assert.isString(data[file]);

          callback();
        });
      });
    });

    /**
     * Test that verifies that requesting an empty set of static files fails
     */
    it('verify validation', (callback) => {
      // Test on the global admin server
      getStaticBatch(asGlobalAnonymous, null, (error, data) => {
        assert.exists(error);

        assert.strictEqual(error.code, 400);
        assert.notExists(data);

        getStaticBatch(asGlobalAnonymous, [], (error, data) => {
          assert.exists(error);

          assert.strictEqual(error.code, 400);
          assert.notExists(data);

          /**
           * Verify that only absolute paths can be used, and no private
           * server files can be retrieved
           */
          const file = '/../Hilary/config.js';
          getStaticBatch(asGlobalAnonymous, file, (error, data) => {
            assert.exists(error);

            assert.strictEqual(error.code, 400);
            assert.notExists(data);

            // Test on the tenant server
            getStaticBatch(asCambridgeAnonymousUser, null, (error, data) => {
              assert.ok(error);

              assert.strictEqual(error.code, 400);
              assert.notExists(data);

              getStaticBatch(asCambridgeAnonymousUser, [], (error, data) => {
                assert.ok(error);

                assert.strictEqual(error.code, 400);
                assert.notExists(data);

                /**
                 * Verify that only absolute paths can be used, and no private
                 * server files can be retrieved
                 */
                getStaticBatch(asGlobalAnonymous, file, (error, data) => {
                  assert.ok(error);

                  assert.strictEqual(error.code, 400);
                  assert.notExists(data);

                  callback();
                });
              });
            });
          });
        });
      });
    });
  });

  describe('Skinning', () => {
    /**
     * Reset any modifications we do to the skin.
     */
    beforeEach((callback) => {
      const skinConfig = {
        'body-background-color': '#' + DEFAULT_BODY_BACKGROUND_COLOR
      };
      updateSkinAndWait(asGlobalAdmin, global.oaeTests.tenants.cam.alias, skinConfig, (error) => {
        assert.notExists(error);

        callback();
      });
    });

    /**
     * Gets the variable value from the output of `RestAPI.UI.getSkinVariables`.
     *
     * @param  {String}    name        The name of the variable to get
     * @param  {Object}    variables   The variables metadata to search for the variable value
     * @return {String}                 The value of the variable. `null` if it could not be found
     */
    const _getSkinVariableValue = (name, variables) => {
      let value = null;
      forEach((section) => {
        forEach((subsection) => {
          forEach((variableMetadata) => {
            if (equals(variableMetadata.name, name)) {
              value = variableMetadata.value || variableMetadata.defaultValue;
            }
          }, subsection.variables);
        }, section.subsections);
      }, variables.results);

      return value;
    };

    /**
     * Checks if the output from the skin api is correct.
     * It verifies:
     *  * a 200
     *  * `text/css; charset=utf-8` header
     *  * minified css
     *  * The value for the body background color
     *
     * @param  {RestContext}    restCtx                 The RestContext to use.
     * @param  {String}         expectedBackgroundColor The background color we expect in the skin file for the body selector.
     * @param  {Function}       callback                Standard callback function
     * @api private
     */
    const checkSkin = function (restCtx, expectedBackgroundColor, callback) {
      getSkin(restCtx, (error, css, response) => {
        assert.notExists(error);

        // We should get back some CSS.
        assert.ok(css);
        assert.strictEqual(response.headers['content-type'], 'text/css; charset=utf-8');

        // The Apereo License header should be returned as-is (including new lines)
        const licenseRegex = /\/\*[^]*?\*\//g;
        assert.ok(css.includes('\n'));
        assert.ok(licenseRegex.test(css));

        // If we remove the license header, there should be no more comments or line breaks
        css = css.replace(licenseRegex, '');
        assert.strictEqual(css.indexOf('\n'), -1);
        assert.strictEqual(css.indexOf('/*'), -1);

        // Check the background color.
        const bodyBackgroundColorRegex = /body{background-color:#([\da-zA-Z]+)}/;
        const match = css.match(bodyBackgroundColorRegex);
        assert.ok(match);
        assert.strictEqual(match[1], expectedBackgroundColor);

        callback();
      });
    };

    /**
     * Updates the skin for the cambridge tenant with the `skinConfig` value and check the skin.
     * The global admin and GT skin will be checked for no changes.
     *
     * @param  {RestContext}    restCtx                     The RestContext to use.
     * @param  {Object}         skinConfig                  The value that should be posted to the admin config.
     * @param  {String}         expectedOldBackgroundColor  The background color we expect in the skin file for the body selector before we do the update.
     * @param  {String}         expectedNewBackgroundColor  The background color we expect in the skin file for the body selector after we do the update.
     * @param  {Function}       callback                    Standard callback function
     * @api private
     */
    const updateSkinAndCheck = function (
      restCtx,
      skinConfig,
      expectedOldBackgroundColor,
      expectedNewBackgroundColor,
      callback
    ) {
      // Sanity-check correct parsing
      checkSkin(asCambridgeAnonymousUser, expectedOldBackgroundColor, () => {
        // Update the cambridge skin.
        updateSkinAndWait(asGlobalAdmin, global.oaeTests.tenants.cam.alias, skinConfig, (error) => {
          assert.notExists(error);

          // Check the skin for the new value.
          checkSkin(asCambridgeAnonymousUser, expectedNewBackgroundColor, () => {
            // Check the global admin skin is unchanged.
            checkSkin(asGlobalAdmin, DEFAULT_BODY_BACKGROUND_COLOR, () => {
              // Check the GT skin is unchanged.
              checkSkin(asGeorgiaTechAnonymousUser, DEFAULT_BODY_BACKGROUND_COLOR, callback);
            });
          });
        });
      });
    };

    /**
     * Gets the skin variables for a tenant and checks the structure.
     *
     * @param  {String}   tenantAlias               The alias of the tenant for which the skin variables should be checked.
     * @param  {String}   expectedBackgroundColor   The expected value for the body background color variable.
     * @param  {Function} callback                  Standard callback function
     * @api private
     */
    const checkVariables = function (tenantAlias, expectedBackgroundColor, callback) {
      getSkinVariables(asGlobalAdmin, tenantAlias, (error, data) => {
        assert.notExists(error);

        const firstResult = data.results[0];
        const secondResult = data.results[1];

        // Verify the sections
        assert.ok(data.results);
        assert.isAbove(data.results.length, 0);
        assert.strictEqual(firstResult.name, 'Branding');
        assert.strictEqual(secondResult.name, 'Text colors');

        // Verify the subsection for the `Branding` section
        assert.ok(firstResult.subsections.length > 0);
        assert.strictEqual(firstResult.subsections[0].name, 'main');

        // Verify the subsection for the `Colors` section, as this should
        // have an additional subsection
        assert.isAbove(secondResult.subsections.length, 0);
        assert.strictEqual(secondResult.subsections[0].name, 'main');
        assert.strictEqual(secondResult.subsections[1].name, 'Link colors');

        // Verify the body background color for the `Branding` section
        assert.isAbove(firstResult.subsections[0].variables.length, 0);
        assert.strictEqual(firstResult.subsections[0].variables[0].type, UIConstants.variables.types.COLOR);
        assert.strictEqual(firstResult.subsections[0].variables[0].value, expectedBackgroundColor);
        callback();
      });
    };

    /*
     * Updating the config should result in a change in the skin.
     */
    it('verify updating the skin', (callback) => {
      updateSkinAndCheck(
        asCambridgeAnonymousUser,
        { 'body-background-color': '#123456' },
        DEFAULT_BODY_BACKGROUND_COLOR,
        '123456',
        callback
      );
    });

    /*
     * Submitting incorrect CSS values should not break the CSS skin generation.
     */
    it('verify that submitting incorrect CSS values does not break skinning', (callback) => {
      updateSkinAndCheck(
        asCambridgeAnonymousUser,
        { 'body-background-color': '}' },
        DEFAULT_BODY_BACKGROUND_COLOR,
        DEFAULT_BODY_BACKGROUND_COLOR,
        callback
      );
    });

    /*
     * When submitting skin values with keys that are not used,
     * this should not break skin generation.
     */
    it('verify that submitting unused key does not break skinning', (callback) => {
      updateSkinAndCheck(
        asCambridgeAnonymousUser,
        { 'not-used': 'foo' },
        DEFAULT_BODY_BACKGROUND_COLOR,
        DEFAULT_BODY_BACKGROUND_COLOR,
        callback
      );
    });

    /*
     * When you update the config with new skin values,
     * these should be returned in the variables endpoint.
     */
    it('verify that variables get updated with values from the config', (callback) => {
      // Sanity check the default value.
      checkVariables(global.oaeTests.tenants.cam.alias, '#eceae5', () => {
        // Update the skin.
        updateSkinAndCheck(
          asCambridgeAnonymousUser,
          { 'body-background-color': '#123456' },
          DEFAULT_BODY_BACKGROUND_COLOR,
          '123456',
          () => {
            // Check if the value is updated in the variables feed.
            checkVariables(global.oaeTests.tenants.cam.alias, '#123456', callback);
          }
        );
      });
    });

    /*
     * Test that verifies that only admininstrators are able to retrieve skin variables
     */
    it('verify only administrators can retrieve skin variabes', (callback) => {
      getSkinVariables(asGlobalAnonymous, global.oaeTests.tenants.cam.alias, (error /* , data */) => {
        assert.strictEqual(error.code, 401);

        getSkinVariables(asCambridgeAnonymousUser, null, (error /* , data */) => {
          assert.strictEqual(error.code, 401);

          getSkinVariables(asGlobalAdmin, global.oaeTests.tenants.cam.alias, (error /* , data */) => {
            assert.ok(!error);

            getSkinVariables(asCambridgeTenantAdmin, null, (error /* , data */) => {
              assert.ok(!error);

              generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
                assert.ok(!error);

                const { 0: someUser } = users;

                getSkinVariables(someUser.restContext, null, (error /* , data */) => {
                  assert.strictEqual(error.code, 401);

                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies when a URL variable is found in a skin, it is replaced by the hash file mapping
     */
    it('verify skin url variables are overridden by hash file mappings', (callback) => {
      // Create a fresh tenant to test against so we can ensure there are no skin variable overrides yet
      const testTenantAlias = generateTestTenantAlias();
      const testTenantHost = generateTestTenantHost();

      createTenantWithAdmin(testTenantAlias, testTenantHost, (error, testTenant, testTenantAdminRestContext) => {
        assert.notExists(error);

        getSkinVariables(asGlobalAdmin, testTenantAlias, (error, variables) => {
          assert.notExists(error);

          // Get the default logo url, parsing out the single quotes
          const defaultLogoUrl = _getSkinVariableValue('institutional-logo-url', variables).slice(1, -1);

          // Create some mock hash mappings to test with
          const hashes = {
            '/test/directory': '/test/target/directory',
            '/test/color': '/test/target/color'
          };

          // Applying a mapping for the default logo url to some optimized path
          hashes[defaultLogoUrl] = '/optimized/logo/path';

          // Configure the optimized path mapping into the UI module
          init(fs.realpathSync(getUIDirectory()), hashes, (error_) => {
            assert.notExists(error_);

            // Verify that if the tenant has NO variable overrides, the default values are run through the optimized path hash
            getSkin(testTenantAdminRestContext, (error, css /* , response */) => {
              assert.notExists(error);

              // Verify that the default logoUrl was replaced
              assert.strictEqual(css.indexOf(defaultLogoUrl), -1, 'Expected the default logo url to be replaced');
              assert.notStrictEqual(
                css.indexOf('/optimized/logo/path'),
                -1,
                'Expected the default logo url to be replaced'
              );

              // Now we update the skin configuration to ensure overridden values get replaced
              let skinConfig = {
                'institutional-logo-url': "'/test/directory'", // This should be replaced as it matches the test directory
                'branding-image-url': "'http://www.google.ca/haha.png'", // This should not be replaced because it doesn't have a mapping
                'body-background-color': "'/test/color'" // This should not be replaced because it is not a url
              };

              // Set the skin configuration so that only the institutional logo should be substituted by the hashed files
              updateSkinAndWait(asGlobalAdmin, testTenantAlias, skinConfig, (error_) => {
                assert.notExists(error_);

                getSkin(testTenantAdminRestContext, (error, css /* , response */) => {
                  assert.notExists(error);

                  // Verify /test/directory was replaced
                  assert.strictEqual(
                    css.indexOf('/test/directory'),
                    -1,
                    'Expected the generated skin to have "/test/directory" replaced by the mapping'
                  );
                  assert.notStrictEqual(
                    css.indexOf('/test/target/directory'),
                    -1,
                    'Expected the generated skin to have "/test/directory" replaced by the mapping'
                  );

                  // Verify google.ca was not replaced
                  assert.notStrictEqual(
                    css.indexOf('http://www.google.ca/haha.png'),
                    -1,
                    'Expected the generated skin to not have "http://www.google.ca/haha.png" replaced by anything'
                  );

                  // Verify /test/color was not replaced
                  assert.notStrictEqual(
                    css.indexOf('/test/color'),
                    -1,
                    'Did not expected the generated skin to replace "/test/color"'
                  );
                  assert.strictEqual(
                    css.indexOf('/test/target/color'),
                    -1,
                    'Did not expected the generated skin to replace "/test/color"'
                  );

                  // Mingle with the spacing to make sure we're somewhat robust for user input
                  skinConfig = { 'institutional-logo-url': "  '  /test/directory  '  " };
                  updateSkinAndWait(asGlobalAdmin, testTenantAlias, skinConfig, (error_) => {
                    assert.notExists(error_);

                    getSkin(testTenantAdminRestContext, (error, css /* , response */) => {
                      assert.notExists(error);

                      // Verify /test/directory was replaced, it is ok if we lost the excessive space
                      assert.strictEqual(
                        css.indexOf('/test/directory'),
                        -1,
                        'Expected the generated skin to have "/test/directory" replaced by the mapping'
                      );
                      assert.notStrictEqual(
                        css.indexOf('/test/target/directory'),
                        -1,
                        'Expected the generated skin to have "/test/directory" replaced by the mapping'
                      );

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

    /**
     * Test that verifies that the institutional logo url can be templated
     * with the tenant alias
     */
    it('verify institutional-logo-url is templated', (callback) => {
      /**
       * Create a fresh tenant to test against so we can ensure there are
       * no skin variable overrides yet
       */
      const testTenantAlias = generateTestTenantAlias();
      const testTenantHost = generateTestTenantHost();

      createTenantWithAdmin(testTenantAlias, testTenantHost, (error, testTenant, testTenantAdminRestContext) => {
        assert.notExists(error);

        // Apply the templated value for institutional logo url
        const skinConfig = {
          // eslint-disable-next-line no-template-curly-in-string
          'institutional-logo-url': "   '/assets/${tenantAlias}/logo/${tenantAlias}.png'     "
        };

        updateSkinAndWait(asGlobalAdmin, testTenantAlias, skinConfig, (error_) => {
          assert.notExists(error_);

          /**
           * Ensure that the base skin values are not rendered with dynamic values
           */
          getSkinVariables(asGlobalAdmin, testTenantAlias, (error, variables) => {
            assert.notExists(error);

            const institutionalLogoUrlValue = _getSkinVariableValue('institutional-logo-url', variables);
            assert.strictEqual(
              institutionalLogoUrlValue,
              // eslint-disable-next-line no-template-curly-in-string
              "'/assets/${tenantAlias}/logo/${tenantAlias}.png'"
            );

            /**
             * Get the rendered skin and ensure the tenant alias is
             * placed in the institutional logo url
             */
            getSkin(testTenantAdminRestContext, (error, css) => {
              assert.notExists(error);

              /**
               * Ensure the `.oae-institutiona-logo` class
               * contains the dynamic value
               */
              const expectedInstitutionalLogoString = format(
                '.oae-institutional-logo{background-image:url(/assets/%s/logo/%s.png)}',
                testTenantAlias,
                testTenantAlias
              );
              assert.notStrictEqual(css.indexOf(expectedInstitutionalLogoString), -1);

              getLogo(testTenantAdminRestContext, (error_, logoURL) => {
                assert.notExists(error_);

                // Ensure the logo we're getting is the same as fetched in the CSS above
                assert.notStrictEqual(expectedInstitutionalLogoString.indexOf(logoURL), -1);

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that a new logo can be uploaded for a tenant and a signed URL is returned
     */
    it('verify logo can be uploaded for a tenant', (callback) => {
      const tenantAlias = global.oaeTests.tenants.cam.alias;
      const filePath = path.join(__dirname, '/data/oae-logo.png');
      let fileStream = fs.createReadStream(filePath);

      // Assert that the global admin can change the logo for a tenant
      uploadLogo(asGlobalAdmin, fileStream, tenantAlias, (error, data) => {
        assert.notExists(error);

        assert.ok(data);
        assert.ok(data.url.includes('signed'));

        fileStream = fs.createReadStream(filePath);

        // Assert that a tenant admin can change the logo for a tenant
        uploadLogo(asCambridgeTenantAdmin, fileStream, tenantAlias, (error, data) => {
          assert.notExists(error);

          assert.ok(data);
          assert.ok(data.url.includes('signed'));

          fileStream = fs.createReadStream(filePath);

          // Assert that a regular anonymous user can not change the logo for a tenant
          uploadLogo(asCambridgeAnonymousUser, fileStream, tenantAlias, (error /* , data */) => {
            assert.ok(error);
            assert.strictEqual(error.code, 401);

            generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
              assert.notExists(error);

              const { 0: someUser } = users;
              const asSomeUser = someUser.restContext;
              fileStream = fs.createReadStream(filePath);

              // Assert that a regular authenticated user can not change the logo for a tenant
              uploadLogo(asSomeUser, fileStream, tenantAlias, (error /* , data */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 401);

                fileStream = fs.createReadStream(path.join(__dirname, '/data/video.mp4'));

                // Assert that a non-image file is rejected
                uploadLogo(asCambridgeTenantAdmin, fileStream, tenantAlias, (error /* , data */) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 500);

                  return callback();
                });
              });
            });
          });
        });
      });
    });
  });

  describe('Translating', () => {
    /**
     * Assert that a given string is properly translated
     *
     * @param  {String}     str             The string to translate
     * @param  {String}     locale          The locale in which to translate the given string
     * @param  {Object}     variables       Dynamic variables that should replace ${variable} placeholder in a translation. The replacements will happen based on the object keys
     * @param  {String}     expectedStr     The expected outcome of the translated string
     * @throws {Error}                      An assertion error is thrown when the translation does not match the expected string
     */
    const verifyTranslation = function (string, locale, variables, expectedString) {
      const translatedString = translate(string, locale, variables);
      assert.strictEqual(translatedString, expectedString);
    };

    /**
     * Test that verifies strings can be succesfully translated
     */
    it('verify strings can be translated', (callback) => {
      // Basic translation using the default locale
      verifyTranslation('__MSG__CHANGE__', 'default', {}, 'Change');

      // Assert that translation is based on the locale
      verifyTranslation('__MSG__CHANGE__', 'fr_FR', {}, 'Changer');

      // Assert that we fall back to the `default` locale if an unknown locale is specified
      verifyTranslation('__MSG__CHANGE__', null, {}, 'Change');
      verifyTranslation('__MSG__CHANGE__', 'foo_BAR', {}, 'Change');

      // Assert that non existing keys are left untouched
      verifyTranslation('__MSG__NON_EXISTING_KEY__', 'default', {}, '__MSG__NON_EXISTING_KEY__');

      // Assert that variables in the i18n values are correctly replaced
      const variables = {
        actor1Link: '<a href="url">Simon</a>',
        verb: 'translate'
      };
      verifyTranslation(
        '__MSG__ACTIVITY_DEFAULT_1__',
        'default',
        variables,
        '<a href="url">Simon</a> performed the action &quot;translate&quot;'
      );

      return callback();
    });
  });
});
