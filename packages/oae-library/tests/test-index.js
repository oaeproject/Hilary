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

const assert = require('assert');

const TestsUtil = require('oae-tests/lib/util');

const LibraryAPI = require('oae-library');

describe('Library Indexing', () => {
  describe('#registerLibraryIndex', () => {
    /**
     * Test that verifies we cannot register two library indexes of the same name
     */
    it('verify cannot register two library indexes of the same name', callback => {
      const testName = TestsUtil.generateRandomText();
      LibraryAPI.Index.registerLibraryIndex(testName, { pageResources() {} });

      assert.throws(() => {
        LibraryAPI.Index.registerLibraryIndex(testName, { pageResources() {} });
      });

      return callback();
    });

    /**
     * Test that verifies we cannot register a library with no pageResources function
     */
    it('verify cannot register a library index that has no ability to page resources', callback => {
      assert.throws(() => {
        LibraryAPI.Index.registerLibraryIndex(TestsUtil.generateRandomText(), {});
      });

      return callback();
    });
  });

  describe('#purge', () => {
    /**
     * Test that verifies purging a library index results in it being rebuilt
     */
    it('verify a library index is cleared when purged and then rebuilt when queried', callback => {
      /*!
             * Convenience function to create a light-weight resource with just an id, tenant alias
             * and visibility
             *
             * @param  {String}     id              The id fo the resource to create
             * @param  {String}     tenantAlias     The tenant alias of the resource
             * @param  {String}     visibility      The visibility of the resource
             * @return {Object}                     The light weight resource object
             */
      const _resource = function(id, tenantAlias, visibility) {
        return {
          id,
          tenant: {
            alias: tenantAlias
          },
          visibility
        };
      };

      const testName = TestsUtil.generateRandomText();
      LibraryAPI.Index.registerLibraryIndex(testName, {
        pageResources(libraryId, start, limit, callback) {
          // Just return a static set of resources
          let resources = null;
          if (!start) {
            resources = [
              {
                rank: 1,
                resource: _resource('a', 'oae', 'private'),
                value: 1
              },
              {
                rank: 2,
                resource: _resource('b', 'oae', 'loggedin'),
                value: ['a', 'b', 'c']
              },
              {
                rank: 3,
                resource: _resource('c', 'oae', 'public')
              }
            ];
          }

          return callback(null, resources, null);
        }
      });

      // Ensure that some arbitrary library in this index is currently stale
      LibraryAPI.Index.isStale(testName, 'somelibrary', 'private', (err, isStale) => {
        assert.ok(!err);
        assert.strictEqual(isStale, true);
        LibraryAPI.Index.isStale(testName, 'somelibrary', 'loggedin', (err, isStale) => {
          assert.ok(!err);
          assert.strictEqual(isStale, true);
          LibraryAPI.Index.isStale(testName, 'somelibrary', 'public', (err, isStale) => {
            assert.ok(!err);
            assert.strictEqual(isStale, true);

            // Query the index and make sure we get the items
            LibraryAPI.Index.list(
              testName,
              'somelibrary',
              'private',
              { limit: 10 },
              (err, entries) => {
                assert.ok(!err);
                assert.strictEqual(entries.length, 3);
                assert.deepStrictEqual(entries[0], { resourceId: 'c', value: 1 });
                assert.deepStrictEqual(entries[1], { resourceId: 'b', value: ['a', 'b', 'c'] });
                assert.deepStrictEqual(entries[2], { resourceId: 'a', value: 1 });

                // Ensure that each library index list is no longer stale
                LibraryAPI.Index.isStale(testName, 'somelibrary', 'private', (err, isStale) => {
                  assert.ok(!err);
                  assert.strictEqual(isStale, false);
                  LibraryAPI.Index.isStale(testName, 'somelibrary', 'loggedin', (err, isStale) => {
                    assert.ok(!err);
                    assert.strictEqual(isStale, false);
                    LibraryAPI.Index.isStale(testName, 'somelibrary', 'public', (err, isStale) => {
                      assert.ok(!err);
                      assert.strictEqual(isStale, false);

                      // Purge the full library
                      LibraryAPI.Index.purge(testName, 'somelibrary', err => {
                        assert.ok(!err);

                        // Ensure that each library index list is stale once again
                        LibraryAPI.Index.isStale(
                          testName,
                          'somelibrary',
                          'private',
                          (err, isStale) => {
                            assert.ok(!err);
                            assert.strictEqual(isStale, true);
                            LibraryAPI.Index.isStale(
                              testName,
                              'somelibrary',
                              'loggedin',
                              (err, isStale) => {
                                assert.ok(!err);
                                assert.strictEqual(isStale, true);
                                LibraryAPI.Index.isStale(
                                  testName,
                                  'somelibrary',
                                  'public',
                                  (err, isStale) => {
                                    assert.ok(!err);
                                    assert.strictEqual(isStale, true);

                                    return callback();
                                  }
                                );
                              }
                            );
                          }
                        );
                      });
                    });
                  });
                });
              }
            );
          });
        });
      });
    });
  });
});
