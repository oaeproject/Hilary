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
const _ = require('underscore');

const RestAPI = require('oae-rest');
const TestsUtil = require('oae-tests');

describe('Docs', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let anonymousCamRestContext = null;

  /**
   * Function that will fill up the global admin, tenant admin and anymous rest context
   */
  before((callback) => {
    // Fill up the anonymous cam rest context
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    callback();
  });

  describe('Get modules', () => {
    /**
     * Test that verifies that it is possible to get a list of all of the available modules
     */
    it('verify get modules', (callback) => {
      // Get the back-end modules
      RestAPI.Doc.getModules(anonymousCamRestContext, 'backend', (err, backendModules) => {
        assert.ok(!err);
        assert.ok(backendModules);
        assert.notStrictEqual(backendModules.indexOf('oae-doc'), -1);

        // Get the front-end modules
        RestAPI.Doc.getModules(anonymousCamRestContext, 'frontend', (err, frontendModules) => {
          assert.ok(!err);
          assert.ok(frontendModules);
          assert.notStrictEqual(_.indexOf(frontendModules, 'oae.api.util.js'), -1);
          // We want to exclude oae.core.js
          assert.strictEqual(_.indexOf(frontendModules, 'oae.core.js'), -1);
          callback();
        });
      });
    });

    /**
     * Test that verifies that validation is done appropriately
     */
    it('verify validation', (callback) => {
      RestAPI.Doc.getModules(anonymousCamRestContext, 'invalid module type', (
        err,
        modules
      ) => {
        assert.strictEqual(err.code, 400);
        assert.ok(!modules);

        return callback();
      });
    });
  });

  describe('Get module documentation', () => {
    /**
     * Test that verifies that the JSDocs for an existing module can be retrieved
     */
    it('verify get module documentation', (callback) => {
      // Get the documentation for a back-end module
      RestAPI.Doc.getModuleDocumentation(anonymousCamRestContext, 'backend', 'oae-doc', (
        err,
        docs
      ) => {
        assert.ok(!err);
        assert.ok(docs);
        assert.ok(_.keys(docs).length);
        assert.ok(_.keys(docs['api.js']).length);

        // Get the documentation for a front-end module
        RestAPI.Doc.getModuleDocumentation(
          anonymousCamRestContext,
          'frontend',
          'oae.api.util.js',
          (err, docs) => {
            assert.ok(!err);
            assert.ok(docs);
            assert.ok(docs.length);
            callback();
          }
        );
      });
    });

    /**
     * Test that verifies that validation is done appropriately
     */
    it('verify validation', (callback) => {
      // Get non-existing back-end module
      RestAPI.Doc.getModuleDocumentation(
        anonymousCamRestContext,
        'backend',
        'oae-non-existing',
        (err, docs) => {
          assert.strictEqual(err.code, 404);
          assert.ok(!docs);
          // Get non-existing back-end module
          RestAPI.Doc.getModuleDocumentation(
            anonymousCamRestContext,
            'backend',
            'oae.api.nonexisting',
            (err, docs) => {
              assert.strictEqual(err.code, 404);
              assert.ok(!docs);

              // Get non-OAE back-end module
              RestAPI.Doc.getModuleDocumentation(
                anonymousCamRestContext,
                'backend',
                'helenus',
                (err, docs) => {
                  assert.strictEqual(err.code, 404);
                  assert.ok(!docs);
                  // Get non-OAE front-end module
                  RestAPI.Doc.getModuleDocumentation(
                    anonymousCamRestContext,
                    'frontend',
                    'test',
                    (err, docs) => {
                      assert.strictEqual(err.code, 404);
                      assert.ok(!docs);

                      // Get an invalid module type
                      RestAPI.Doc.getModuleDocumentation(
                        anonymousCamRestContext,
                        'invalid module type',
                        'oae.api.util.js',
                        (err, docs) => {
                          assert.strictEqual(err.code, 400);
                          assert.ok(!docs);

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
});
