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

const assert = require('assert');
const fs = require('fs');
const util = require('util');
const path = require('path');
const _ = require('underscore');

const RestAPI = require('oae-rest');
const { RestContext } = require('oae-rest/lib/model');
const TenantsTestUtil = require('oae-tenants/lib/test/util');
const TestsUtil = require('oae-tests');

const UIAPI = require('oae-ui');
const { UIConstants } = require('oae-ui/lib/constants');
const UITestUtil = require('oae-ui/lib/test/util');

describe('UI', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user to the cambridge tenant
  let anonymousCamRestContext = null;
  // Rest context that can be used every time we need to make a request as an anonymous user to the gt tenant
  let anonymousGTRestContext = null;
  // Rest context that can be used for anonymous requests on the global tenant
  let anonymousGlobalRestContext = null;
  // Rest context that can be used for authenticated requests on the global tenant
  let globalAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as an admin user to the cambridge tenant
  let camAdminRestContext = null;

  // Even though the UI uses capitals for color declarations, we have to use lower case
  // here as LESS will convert all RGB codes to lower case.
  const DEFAULT_BODY_BACKGROUND_COLOR = 'eceae5';

  /**
   * Function that will fill up the anonymous tenant and global REST context
   */
  before(callback => {
    // Fill up anonymous rest contexts
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    anonymousGTRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.gt.host);
    // Fill up the anonymous global rest context
    anonymousGlobalRestContext = TestsUtil.createGlobalRestContext();
    // Fill up the authenticated global rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    // Fill up the cambridge administrator rest context
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    callback();
  });

  describe('Widget config aggregation', () => {
    /**
     * Test that verifies that the aggregated widget configs can be retrieved
     */
    it('verify widget configs', callback => {
      // Get the widget configs on the global admin server
      RestAPI.UI.getWidgetManifests(anonymousGlobalRestContext, (err, data) => {
        assert.ok(!err);
        assert.ok(data.topnavigation);
        assert.strictEqual(data.topnavigation.id, 'topnavigation');
        assert.strictEqual(data.topnavigation.path, 'oae-core/topnavigation/');
        assert.ok(data.topnavigation.i18n);

        // Get the widget configs on the tenant server
        RestAPI.UI.getWidgetManifests(anonymousCamRestContext, (err, data) => {
          assert.ok(!err);
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
    it('verify batch static get', callback => {
      let files = ['/ui/index.html', '/node_modules/oae-core/footer/js/footer.js', '/nonexisting'];
      // Get these files on the global admin server
      RestAPI.UI.getStaticBatch(anonymousGlobalRestContext, files, (err, batch1) => {
        assert.ok(!err);
        assert.strictEqual(_.keys(batch1).length, 3);
        // Verify that the /ui/index.html file is present
        assert.ok(batch1[files[0]]);
        assert.strictEqual(typeof batch1[files[0]], 'string');
        // Verify that the /node_modules/oae-core/footer/js/footer.js file is present
        assert.ok(batch1[files[1]]);
        assert.strictEqual(typeof batch1[files[1]], 'string');
        // Verify that the /nonexisting file is not present
        assert.strictEqual(batch1[files[2]], null);

        // Get these files on the tenant server
        RestAPI.UI.getStaticBatch(anonymousCamRestContext, files, (err, batch2) => {
          assert.ok(!err);
          assert.strictEqual(_.keys(batch2).length, 3);
          // Verify that the /ui/index.html file is present
          assert.ok(batch2[files[0]]);
          assert.strictEqual(typeof batch2[files[0]], 'string');
          // Verify that the /node_modules/oae-core/footer/js/footer.js file is present
          assert.ok(batch2[files[1]]);
          assert.strictEqual(typeof batch2[files[1]], 'string');
          // Verify that the /nonexisting file is not present
          assert.strictEqual(batch2[files[2]], null);
          // Make sure that the files from batch1 and batch2 are the same
          assert.strictEqual(batch1[files[0]], batch2[files[0]]);
          assert.strictEqual(batch1[files[1]], batch2[files[1]]);

          // Do another set of batch requests with some of the same files, to make sure they are being server from cache
          files = ['/node_modules/oae-core/footer/css/footer.css', '/ui/index.html'];
          // Get these files on the global admin server
          RestAPI.UI.getStaticBatch(anonymousGlobalRestContext, files, (err, batch3) => {
            assert.ok(!err);
            assert.strictEqual(_.keys(batch3).length, 2);
            // Verify that the /ui/index.html file is present
            assert.ok(batch3[files[0]]);
            assert.strictEqual(typeof batch3[files[0]], 'string');
            // Verify that the /node_modules/oae-core/footer/js/footer.js file is present
            assert.ok(batch3[files[1]]);
            assert.strictEqual(typeof batch3[files[1]], 'string');
            // Make sure that /ui/index.html has the same content in both batches
            assert.strictEqual(batch3['/ui/index.html'], batch1['/ui/index.html']);

            // Get these files on the tenant server
            RestAPI.UI.getStaticBatch(anonymousCamRestContext, files, (err, batch4) => {
              assert.ok(!err);
              assert.strictEqual(_.keys(batch4).length, 2);
              // Verify that the /ui/index.html file is present
              assert.ok(batch4[files[0]]);
              assert.strictEqual(typeof batch4[files[0]], 'string');
              // Verify that the /node_modules/oae-core/footer/js/footer.js file is present
              assert.ok(batch4[files[1]]);
              assert.strictEqual(typeof batch4[files[1]], 'string');
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
    it('verify batch single file', callback => {
      const file = '/ui/index.html';
      // Test this on the global admin server
      RestAPI.UI.getStaticBatch(anonymousGlobalRestContext, file, (err, data) => {
        assert.ok(!err);
        assert.strictEqual(_.keys(data).length, 1);
        assert.ok(data[file]);
        assert.strictEqual(typeof data[file], 'string');

        // Test this on the tenant server
        RestAPI.UI.getStaticBatch(anonymousCamRestContext, file, (err, data) => {
          assert.ok(!err);
          assert.strictEqual(_.keys(data).length, 1);
          assert.ok(data[file]);
          assert.strictEqual(typeof data[file], 'string');
          callback();
        });
      });
    });

    /**
     * Test that verifies that requesting an empty set of static files fails
     */
    it('verify validation', callback => {
      // Test on the global admin server
      RestAPI.UI.getStaticBatch(anonymousGlobalRestContext, null, (err, data) => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);
        assert.ok(!data);
        RestAPI.UI.getStaticBatch(anonymousGlobalRestContext, [], (err, data) => {
          assert.ok(err);
          assert.strictEqual(err.code, 400);
          assert.ok(!data);
          // Verify that only absolute paths can be used, and no private
          // server files can be retrieved
          const file = '/../Hilary/config.js';
          RestAPI.UI.getStaticBatch(anonymousGlobalRestContext, file, (err, data) => {
            assert.ok(err);
            assert.strictEqual(err.code, 400);
            assert.ok(!data);

            // Test on the tenant server
            RestAPI.UI.getStaticBatch(anonymousCamRestContext, null, (err, data) => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);
              assert.ok(!data);
              RestAPI.UI.getStaticBatch(anonymousCamRestContext, [], (err, data) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);
                assert.ok(!data);
                // Verify that only absolute paths can be used, and no private
                // server files can be retrieved
                RestAPI.UI.getStaticBatch(anonymousGlobalRestContext, file, (err, data) => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 400);
                  assert.ok(!data);
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
    beforeEach(callback => {
      const skinConfig = {
        'body-background-color': '#' + DEFAULT_BODY_BACKGROUND_COLOR
      };
      UITestUtil.updateSkinAndWait(
        globalAdminRestContext,
        global.oaeTests.tenants.cam.alias,
        skinConfig,
        err => {
          assert.ok(!err);
          callback();
        }
      );
    });

    /**
     * Gets the variable value from the output of `RestAPI.UI.getSkinVariables`.
     *
     * @param  {String}    name        The name of the variable to get
     * @param  {Object}    variables   The variables metadata to search for the variable value
     * @return {String}                 The value of the variable. `null` if it could not be found
     */
    const _getSkinVariableValue = function(name, variables) {
      let value = null;
      _.each(variables.results, section => {
        _.each(section.subsections, subsection => {
          _.each(subsection.variables, variableMetadata => {
            if (variableMetadata.name === name) {
              value = variableMetadata.value || variableMetadata.defaultValue;
            }
          });
        });
      });

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
    const checkSkin = function(restCtx, expectedBackgroundColor, callback) {
      RestAPI.UI.getSkin(restCtx, (err, css, response) => {
        assert.ok(!err);
        // We should get back some CSS.
        assert.ok(css);
        assert.strictEqual(response.headers['content-type'], 'text/css; charset=utf-8');

        // The Apereo License header should be returned as-is (including new lines)
        const licenseRegex = /\/\*[^]*?\*\//g;
        assert.ok(css.indexOf('\n') > -1);
        assert.ok(licenseRegex.test(css));

        // If we remove the license header, there should be no more comments or line breaks
        css = css.replace(licenseRegex, '');
        assert.strictEqual(css.indexOf('\n'), -1);
        assert.strictEqual(css.indexOf('/*'), -1);

        // Check the background color.
        const bodyBackgroundColorRegex = new RegExp('body{background-color:#([0-9a-zA-Z]+)}');
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
    const updateSkinAndCheck = function(
      restCtx,
      skinConfig,
      expectedOldBackgroundColor,
      expectedNewBackgroundColor,
      callback
    ) {
      // Sanity-check correct parsing
      checkSkin(anonymousCamRestContext, expectedOldBackgroundColor, () => {
        // Update the cambridge skin.
        UITestUtil.updateSkinAndWait(
          globalAdminRestContext,
          global.oaeTests.tenants.cam.alias,
          skinConfig,
          err => {
            assert.ok(!err);

            // Check the skin for the new value.
            checkSkin(anonymousCamRestContext, expectedNewBackgroundColor, () => {
              // Check the global admin skin is unchanged.
              checkSkin(globalAdminRestContext, DEFAULT_BODY_BACKGROUND_COLOR, () => {
                // Check the GT skin is unchanged.
                checkSkin(anonymousGTRestContext, DEFAULT_BODY_BACKGROUND_COLOR, callback);
              });
            });
          }
        );
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
    const checkVariables = function(tenantAlias, expectedBackgroundColor, callback) {
      RestAPI.UI.getSkinVariables(globalAdminRestContext, tenantAlias, (err, data) => {
        assert.ok(!err);

        // Verify the sections
        assert.ok(data.results);
        assert.ok(data.results.length > 0);
        assert.strictEqual(data.results[0].name, 'Branding');
        assert.strictEqual(data.results[1].name, 'Text colors');

        // Verify the subsection for the `Branding` section
        assert.ok(data.results[0].subsections.length > 0);
        assert.strictEqual(data.results[0].subsections[0].name, 'main');

        // Verify the subsection for the `Colors` section, as this should
        // have an additional subsection
        assert.ok(data.results[1].subsections.length > 0);
        assert.strictEqual(data.results[1].subsections[0].name, 'main');
        assert.strictEqual(data.results[1].subsections[1].name, 'Link colors');

        // Verify the body background color for the `Branding` section
        assert.ok(data.results[0].subsections[0].variables.length > 0);
        assert.strictEqual(
          data.results[0].subsections[0].variables[0].type,
          UIConstants.variables.types.COLOR
        );
        assert.strictEqual(
          data.results[0].subsections[0].variables[0].value,
          expectedBackgroundColor
        );
        callback();
      });
    };

    /*
         * Updating the config should result in a change in the skin.
         */
    it('verify updating the skin', callback => {
      updateSkinAndCheck(
        anonymousCamRestContext,
        { 'body-background-color': '#123456' },
        DEFAULT_BODY_BACKGROUND_COLOR,
        '123456',
        callback
      );
    });

    /*
         * Submitting incorrect CSS values should not break the CSS skin generation.
         */
    it('verify that submitting incorrect CSS values does not break skinning', callback => {
      updateSkinAndCheck(
        anonymousCamRestContext,
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
    it('verify that submitting unused key does not break skinning', callback => {
      updateSkinAndCheck(
        anonymousCamRestContext,
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
    it('verify that variables get updated with values from the config', callback => {
      // Sanity check the default value.
      checkVariables(global.oaeTests.tenants.cam.alias, '#eceae5', () => {
        // Update the skin.
        updateSkinAndCheck(
          anonymousCamRestContext,
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
    it('verify only administrators can retrieve skin variabes', callback => {
      RestAPI.UI.getSkinVariables(
        anonymousGlobalRestContext,
        global.oaeTests.tenants.cam.alias,
        (err, data) => {
          assert.strictEqual(err.code, 401);
          RestAPI.UI.getSkinVariables(anonymousCamRestContext, null, (err, data) => {
            assert.strictEqual(err.code, 401);
            RestAPI.UI.getSkinVariables(
              globalAdminRestContext,
              global.oaeTests.tenants.cam.alias,
              (err, data) => {
                assert.ok(!err);
                RestAPI.UI.getSkinVariables(camAdminRestContext, null, (err, data) => {
                  assert.ok(!err);
                  TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
                    assert.ok(!err);

                    const user = _.values(users)[0];
                    RestAPI.UI.getSkinVariables(user.restContext, null, (err, data) => {
                      assert.strictEqual(err.code, 401);
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

    /**
     * Test that verifies when a URL variable is found in a skin, it is replaced by the hash file mapping
     */
    it('verify skin url variables are overridden by hash file mappings', callback => {
      // Create a fresh tenant to test against so we can ensure there are no skin variable overrides yet
      const testTenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const testTenantHost = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(
        testTenantAlias,
        testTenantHost,
        (err, testTenant, testTenantAdminRestContext) => {
          assert.ok(!err);

          RestAPI.UI.getSkinVariables(globalAdminRestContext, testTenantAlias, (err, variables) => {
            assert.ok(!err);

            // Get the default logo url, parsing out the single quotes
            const defaultLogoUrl = _getSkinVariableValue('institutional-logo-url', variables).slice(
              1,
              -1
            );

            // Create some mock hash mappings to test with
            const hashes = {
              '/test/directory': '/test/target/directory',
              '/test/color': '/test/target/color'
            };

            // Applying a mapping for the default logo url to some optimized path
            hashes[defaultLogoUrl] = '/optimized/logo/path';

            // Configure the optimized path mapping into the UI module
            UIAPI.init(fs.realpathSync(UIAPI.getUIDirectory()), hashes, err => {
              assert.ok(!err);

              // Verify that if the tenant has NO variable overrides, the default values are run through the optimized path hash
              RestAPI.UI.getSkin(testTenantAdminRestContext, (err, css, response) => {
                assert.ok(!err);

                // Verify that the default logoUrl was replaced
                assert.strictEqual(
                  css.indexOf(defaultLogoUrl),
                  -1,
                  'Expected the default logo url to be replaced'
                );
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
                UITestUtil.updateSkinAndWait(
                  globalAdminRestContext,
                  testTenantAlias,
                  skinConfig,
                  err => {
                    assert.ok(!err);

                    RestAPI.UI.getSkin(testTenantAdminRestContext, (err, css, response) => {
                      assert.ok(!err);

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
                      UITestUtil.updateSkinAndWait(
                        globalAdminRestContext,
                        testTenantAlias,
                        skinConfig,
                        err => {
                          assert.ok(!err);

                          RestAPI.UI.getSkin(testTenantAdminRestContext, (err, css, response) => {
                            assert.ok(!err);

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
     * Test that verifies that the institutional logo url can be templated
     * with the tenant alias
     */
    it('verify institutional-logo-url is templated', callback => {
      // Create a fresh tenant to test against so we can ensure there are
      // no skin variable overrides yet
      const testTenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const testTenantHost = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(
        testTenantAlias,
        testTenantHost,
        (err, testTenant, testTenantAdminRestContext) => {
          assert.ok(!err);

          // Apply the templated value for institutional logo url
          const skinConfig = {
            // eslint-disable-next-line no-template-curly-in-string
            'institutional-logo-url': "   '/assets/${tenantAlias}/logo/${tenantAlias}.png'     "
          };
          UITestUtil.updateSkinAndWait(globalAdminRestContext, testTenantAlias, skinConfig, err => {
            assert.ok(!err);

            // Ensure that the base skin values are not rendered with
            // dynamic values
            RestAPI.UI.getSkinVariables(
              globalAdminRestContext,
              testTenantAlias,
              (err, variables) => {
                assert.ok(!err);

                const institutionalLogoUrlValue = _getSkinVariableValue(
                  'institutional-logo-url',
                  variables
                );
                assert.strictEqual(
                  institutionalLogoUrlValue,
                  // eslint-disable-next-line no-template-curly-in-string
                  "'/assets/${tenantAlias}/logo/${tenantAlias}.png'"
                );

                // Get the rendered skin and ensure the tenant alias is
                // placed in the institutional logo url
                RestAPI.UI.getSkin(testTenantAdminRestContext, (err, css) => {
                  assert.ok(!err);

                  // Ensure the `.oae-institutiona-logo` class
                  // contains the dynamic value
                  const expectedInstitutionalLogoStr = util.format(
                    '.oae-institutional-logo{background-image:url(/assets/%s/logo/%s.png)}',
                    testTenantAlias,
                    testTenantAlias
                  );
                  assert.notStrictEqual(css.indexOf(expectedInstitutionalLogoStr), -1);

                  RestAPI.UI.getLogo(testTenantAdminRestContext, (err, logoURL) => {
                    // Ensure the logo we're getting is the same as fetched in the CSS above
                    assert.notStrictEqual(expectedInstitutionalLogoStr.indexOf(logoURL), -1);
                    return callback();
                  });
                });
              }
            );
          });
        }
      );
    });

    /**
     * Test that verifies that a new logo can be uploaded for a tenant and a signed URL is returned
     */
    it('verify logo can be uploaded for a tenant', callback => {
      const tenantAlias = global.oaeTests.tenants.cam.alias;
      const filePath = path.join(__dirname, '/data/oae-logo.png');
      let fileStream = fs.createReadStream(filePath);

      // Assert that the global admin can change the logo for a tenant
      RestAPI.UI.uploadLogo(globalAdminRestContext, fileStream, tenantAlias, (err, data) => {
        assert.ok(!err);
        assert.ok(data);
        assert.ok(data.url.indexOf('signed') !== -1);

        fileStream = fs.createReadStream(filePath);
        // Assert that a tenant admin can change the logo for a tenant
        RestAPI.UI.uploadLogo(camAdminRestContext, fileStream, tenantAlias, (err, data) => {
          assert.ok(!err);
          assert.ok(data);
          assert.ok(data.url.indexOf('signed') !== -1);

          fileStream = fs.createReadStream(filePath);
          // Assert that a regular anonymous user can not change the logo for a tenant
          RestAPI.UI.uploadLogo(anonymousCamRestContext, fileStream, tenantAlias, (err, data) => {
            assert.ok(err);
            assert.strictEqual(err.code, 401);
            TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
              assert.ok(!err);

              const user = _.values(users)[0];
              fileStream = fs.createReadStream(filePath);
              // Assert that a regular authenticated user can not change the logo for a tenant
              RestAPI.UI.uploadLogo(user.restContext, fileStream, tenantAlias, (err, data) => {
                assert.ok(err);
                assert.strictEqual(err.code, 401);

                fileStream = fs.createReadStream(path.join(__dirname, '/data/video.mp4'));
                // Assert that a non-image file is rejected
                RestAPI.UI.uploadLogo(camAdminRestContext, fileStream, tenantAlias, (err, data) => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 500);

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
    const verifyTranslation = function(str, locale, variables, expectedStr) {
      const translatedStr = UIAPI.translate(str, locale, variables);
      assert.strictEqual(translatedStr, expectedStr);
    };

    /**
     * Test that verifies strings can be succesfully translated
     */
    it('verify strings can be translated', callback => {
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
