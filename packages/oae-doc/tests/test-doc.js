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
import { describe, it, before } from 'mocha';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import { keys, indexOf } from 'ramda';

const { getModuleDocumentation, getModules } = RestAPI.Doc;
const { createTenantRestContext } = TestsUtil;

const TEST = 'test';
const BACKEND = 'backend';
const FRONTEND = 'frontend';

describe('Docs', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let asCambridgeAnonymousUser = null;

  /**
   * Function that will fill up the global admin, tenant admin and anymous rest context
   */
  before((callback) => {
    // Fill up the anonymous cam rest context
    asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.cam.host);

    callback();
  });

  describe('Get modules', () => {
    /**
     * Test that verifies that it is possible to get a list of all of the available modules
     */
    it('verify get modules', (callback) => {
      // Get the back-end modules
      getModules(asCambridgeAnonymousUser, BACKEND, (error, backendModules) => {
        assert.notExists(error);
        assert.ok(backendModules);
        assert.notStrictEqual(backendModules.indexOf('oae-doc'), -1);

        // Get the front-end modules
        getModules(asCambridgeAnonymousUser, FRONTEND, (error, frontendModules) => {
          assert.notExists(error);
          assert.ok(frontendModules);
          assert.notStrictEqual(indexOf('oae.api.util.js', frontendModules), -1);

          // We want to exclude oae.core.js
          assert.strictEqual(indexOf('oae.core.js', frontendModules), -1);

          return callback();
        });
      });
    });

    /**
     * Test that verifies that validation is done appropriately
     */
    it('verify validation', (callback) => {
      getModules(asCambridgeAnonymousUser, 'invalid module type', (error, modules) => {
        assert.strictEqual(error.code, 400);
        assert.notExists(modules);

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
      getModuleDocumentation(asCambridgeAnonymousUser, BACKEND, 'oae-doc', (error, docs) => {
        assert.notExists(error);
        assert.ok(docs);
        assert.ok(keys(docs));
        assert.ok(keys(docs['api.js']));

        // Get the documentation for a front-end module
        getModuleDocumentation(asCambridgeAnonymousUser, FRONTEND, 'oae.api.util.js', (error, docs) => {
          assert.notExists(error);
          assert.ok(docs);
          assert.ok(docs.length);

          return callback();
        });
      });
    });

    /**
     * Test that verifies that validation is done appropriately
     */
    it('verify validation', (callback) => {
      // Get non-existing back-end module
      getModuleDocumentation(asCambridgeAnonymousUser, BACKEND, 'oae-non-existing', (error, docs) => {
        assert.strictEqual(error.code, 404);
        assert.notExists(docs);

        // Get non-existing back-end module
        getModuleDocumentation(asCambridgeAnonymousUser, BACKEND, 'oae.api.nonexisting', (error, docs) => {
          assert.strictEqual(error.code, 404);
          assert.notExists(docs);

          // Get non-OAE back-end module
          getModuleDocumentation(asCambridgeAnonymousUser, BACKEND, 'helenus', (error, docs) => {
            assert.strictEqual(error.code, 404);
            assert.ok(!docs);

            // Get non-OAE front-end module
            getModuleDocumentation(asCambridgeAnonymousUser, FRONTEND, TEST, (error, docs) => {
              assert.strictEqual(error.code, 404);
              assert.notExists(docs);

              // Get an invalid module type
              getModuleDocumentation(
                asCambridgeAnonymousUser,
                'invalid module type',
                'oae.api.util.js',
                (error, docs) => {
                  assert.strictEqual(error.code, 400);
                  assert.notExists(docs);

                  return callback();
                }
              );
            });
          });
        });
      });
    });
  });
});
