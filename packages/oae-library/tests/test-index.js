/*!
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
import { not } from 'ramda';

import * as TestsUtil from 'oae-tests/lib/util.js';
import * as LibraryAPI from 'oae-library';

const { generateRandomText } = TestsUtil;
const testName = generateRandomText();

const { purge, list, registerLibraryIndex, isStale } = LibraryAPI.Index;

const PUBLIC = 'public';
const LOGGEDIN = 'loggedin';
const PRIVATE = 'private';
const SOME_LIBRARY = 'somelibrary';

describe('Library Indexing', () => {
  describe('#registerLibraryIndex', () => {
    /**
     * Test that verifies we cannot register two library indexes of the same name
     */
    it('verify cannot register two library indexes of the same name', (callback) => {
      registerLibraryIndex(testName, { pageResources() {} });

      assert.throws(() => {
        registerLibraryIndex(testName, { pageResources() {} });
      });

      return callback();
    });

    /**
     * Test that verifies we cannot register a library with no pageResources function
     */
    it('verify cannot register a library index that has no ability to page resources', (callback) => {
      assert.throws(() => {
        registerLibraryIndex(generateRandomText(), {});
      });

      return callback();
    });
  });

  describe('#purge', () => {
    /**
     * Test that verifies purging a library index results in it being rebuilt
     */
    it('verify a library index is cleared when purged and then rebuilt when queried', (callback) => {
      /*!
       * Convenience function to create a light-weight resource with just an id, tenant alias
       * and visibility
       *
       * @param  {String}     id              The id fo the resource to create
       * @param  {String}     tenantAlias     The tenant alias of the resource
       * @param  {String}     visibility      The visibility of the resource
       * @return {Object}                     The light weight resource object
       */
      const _resource = function (id, tenantAlias, visibility) {
        return {
          id,
          tenant: {
            alias: tenantAlias
          },
          visibility
        };
      };

      const testName = generateRandomText();

      registerLibraryIndex(testName, {
        pageResources(libraryId, start, limit, callback) {
          // Just return a static set of resources
          let resources = null;
          if (not(start)) {
            resources = [
              {
                rank: 1,
                resource: _resource('a', 'oae', PRIVATE),
                value: 1
              },
              {
                rank: 2,
                resource: _resource('b', 'oae', LOGGEDIN),
                value: ['a', 'b', 'c']
              },
              {
                rank: 3,
                resource: _resource('c', 'oae', PUBLIC)
              }
            ];
          }

          return callback(null, resources, null);
        }
      });

      // Ensure that some arbitrary library in this index is currently stale
      isStale(testName, SOME_LIBRARY, PRIVATE, (error, isItStale) => {
        assert.notExists(error);
        assert.strictEqual(isItStale, true);

        isStale(testName, SOME_LIBRARY, LOGGEDIN, (error, isItStale) => {
          assert.notExists(error);
          assert.strictEqual(isItStale, true);

          isStale(testName, SOME_LIBRARY, PUBLIC, (error, isItStale) => {
            assert.notExists(error);
            assert.strictEqual(isItStale, true);

            // Query the index and make sure we get the items
            list(testName, SOME_LIBRARY, PRIVATE, { limit: 10 }, (error, entries) => {
              assert.notExists(error);

              assert.lengthOf(entries, 3);
              assert.deepStrictEqual(entries[0], { resourceId: 'c', value: 1 });
              assert.deepStrictEqual(entries[1], { resourceId: 'b', value: ['a', 'b', 'c'] });
              assert.deepStrictEqual(entries[2], { resourceId: 'a', value: 1 });

              // Ensure that each library index list is no longer stale
              isStale(testName, SOME_LIBRARY, PRIVATE, (error, isItStale) => {
                assert.notExists(error);
                assert.strictEqual(isItStale, false);

                isStale(testName, SOME_LIBRARY, LOGGEDIN, (error, isItStale) => {
                  assert.notExists(error);
                  assert.strictEqual(isItStale, false);

                  isStale(testName, SOME_LIBRARY, PUBLIC, (error, isItStale) => {
                    assert.notExists(error);
                    assert.strictEqual(isItStale, false);

                    // Purge the full library
                    purge(testName, SOME_LIBRARY, (error_) => {
                      assert.notExists(error_);

                      // Ensure that each library index list is stale once again
                      isStale(testName, SOME_LIBRARY, PRIVATE, (error, isItStale) => {
                        assert.notExists(error);
                        assert.strictEqual(isItStale, true);

                        isStale(testName, SOME_LIBRARY, LOGGEDIN, (error, isItStale) => {
                          assert.notExists(error);
                          assert.strictEqual(isItStale, true);

                          isStale(testName, SOME_LIBRARY, PUBLIC, (error, isItStale) => {
                            assert.notExists(error);
                            assert.strictEqual(isItStale, true);

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
      });
    });
  });
});
