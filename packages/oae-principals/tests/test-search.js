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
const _ = require('underscore');

const ElasticSearch = require('oae-search/lib/internal/elasticsearch');
const RestAPI = require('oae-rest');
const SearchAPI = require('oae-search');
const { SearchConstants } = require('oae-search/lib/constants');
const SearchTestsUtil = require('oae-search/lib/test/util');
const TestsUtil = require('oae-tests');

describe('Search', () => {
  // REST contexts we can use to do REST requests
  let anonymousRestContext = null;
  let camAdminRestContext = null;
  let gtAdminRestContext = null;

  /**
   * Because we truncate the `Principals` table in one of our tests we need
   * to re-create the rest contexts for each test so we can ensure our admin
   * session will always point to a valid principal record
   */
  beforeEach(callback => {
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    return callback();
  });

  /*!
     * Get the document with the specified id from the search results.
     *
     * @param  {SearchResult}  results     The search results object
     * @param  {String}        docId       The id of the document to search
     * @return {Object}                    The search document. `null` if it didn't exist
     */
  const _getDocById = function(results, docId) {
    for (let i = 0; i < results.results.length; i++) {
      const doc = results.results[i];
      if (doc.id === docId) {
        return doc;
      }
    }
    return null;
  };

  describe('Indexing', () => {
    /**
     * Test that verifies when a content item is indexed with just the content id, it still indexes the content
     * item.
     */
    it('verify indexing without full user item', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, doer, jack) => {
        assert.ok(!err);

        // Verify the content item exists
        SearchTestsUtil.searchAll(
          doer.restContext,
          'general',
          null,
          { resourceTypes: 'user', q: jack.user.displayName },
          (err, results) => {
            assert.ok(!err);
            const userDoc = _getDocById(results, jack.user.id);
            assert.ok(userDoc);

            // Delete the content item from the index under the hood, this is to avoid the automatic index events invalidating the test
            ElasticSearch.del('resource', jack.user.id, err => {
              assert.ok(!err);

              // Verify the content item no longer exists
              SearchTestsUtil.searchAll(
                doer.restContext,
                'general',
                null,
                { resourceTypes: 'user', q: jack.user.displayName },
                (err, results) => {
                  assert.ok(!err);
                  const userDoc = _getDocById(results, jack.user.id);
                  assert.ok(!userDoc);

                  // Fire off an indexing task using just the user id
                  SearchAPI.postIndexTask(
                    'user',
                    [{ id: jack.user.id }],
                    { resource: true },
                    err => {
                      assert.ok(!err);

                      // Ensure that the full content item is now back in the search index
                      SearchTestsUtil.searchAll(
                        doer.restContext,
                        'general',
                        null,
                        { resourceTypes: 'user', q: jack.user.displayName },
                        (err, results) => {
                          assert.ok(!err);
                          const userDoc = _getDocById(results, jack.user.id);
                          assert.ok(userDoc);
                          assert.ok(_.isObject(userDoc.tenant));
                          assert.strictEqual(_.keys(userDoc.tenant).length, 3);
                          assert.strictEqual(
                            userDoc.tenant.displayName,
                            global.oaeTests.tenants.cam.displayName
                          );
                          assert.strictEqual(
                            userDoc.tenant.alias,
                            global.oaeTests.tenants.cam.alias
                          );
                          return callback();
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
    });

    /**
     * Test that verifies when a content item is indexed with just the content id, it still indexes the content
     * item.
     */
    it('verify indexing without full group item', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, doer) => {
        assert.ok(!err);

        // Create the group we will test with
        const groupText = TestsUtil.generateTestUserId('group');
        RestAPI.Group.createGroup(
          doer.restContext,
          groupText,
          groupText,
          'public',
          'no',
          [],
          [],
          (err, group) => {
            assert.ok(!err);

            // Verify the content item exists
            SearchTestsUtil.searchAll(
              doer.restContext,
              'general',
              null,
              { resourceTypes: 'group', q: groupText },
              (err, results) => {
                assert.ok(!err);
                const groupDoc = _getDocById(results, group.id);
                assert.ok(groupDoc);

                // Delete the content item from the index under the hood, this is to avoid the automatic index events invalidating the test
                ElasticSearch.del('resource', group.id, err => {
                  assert.ok(!err);

                  // Verify the content item no longer exists
                  SearchTestsUtil.searchAll(
                    doer.restContext,
                    'general',
                    null,
                    { resourceTypes: 'group', q: groupText },
                    (err, results) => {
                      assert.ok(!err);
                      const groupDoc = _getDocById(results, group.id);
                      assert.ok(!groupDoc);

                      // Fire off an indexing task using just the group id
                      SearchAPI.postIndexTask(
                        'group',
                        [{ id: group.id }],
                        { resource: true },
                        err => {
                          // Ensure that the full content item is now back in the search index
                          SearchTestsUtil.searchAll(
                            doer.restContext,
                            'general',
                            null,
                            { resourceTypes: 'group', q: groupText },
                            (err, results) => {
                              assert.ok(!err);
                              const groupDoc = _getDocById(results, group.id);
                              assert.ok(groupDoc);
                              assert.ok(_.isObject(groupDoc.tenant));
                              assert.strictEqual(_.keys(groupDoc.tenant).length, 3);
                              assert.strictEqual(
                                groupDoc.tenant.displayName,
                                global.oaeTests.tenants.cam.displayName
                              );
                              assert.strictEqual(
                                groupDoc.tenant.alias,
                                global.oaeTests.tenants.cam.alias
                              );
                              callback();
                            }
                          );
                        }
                      );
                    }
                  );
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that users, groups, members and memberships documents are all reindexed when the search index is built with reindexAll
     */
    it('verify users and groups reindex with reindex all', callback => {
      // Clear all the data in the system to speed up the `reindexAll` operation in this test
      TestsUtil.clearAllData(() => {
        // Clear the search index to ensure we don't have search documents hanging around
        // for resources that have been deleted
        SearchTestsUtil.deleteAll(() => {
          TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
            assert.ok(!err);

            TestsUtil.generateTestGroups(user.restContext, 1, group => {
              group = group.group;

              // Sanity check we can search all 4 documents (user, group, member, membership)
              SearchTestsUtil.searchAll(
                user.restContext,
                'general',
                null,
                { resourceTypes: 'user', q: user.user.displayName },
                (err, results) => {
                  assert.ok(!err);
                  assert.ok(_getDocById(results, user.user.id));

                  SearchTestsUtil.searchAll(
                    user.restContext,
                    'general',
                    null,
                    { resourceTypes: 'group', q: group.displayName },
                    (err, results) => {
                      assert.ok(!err);
                      assert.ok(_getDocById(results, group.id));

                      SearchTestsUtil.searchAll(
                        user.restContext,
                        'memberships-library',
                        [user.user.id],
                        null,
                        (err, results) => {
                          assert.ok(!err);
                          assert.ok(_getDocById(results, group.id));

                          SearchTestsUtil.searchAll(
                            user.restContext,
                            'members-library',
                            [group.id],
                            null,
                            (err, results) => {
                              assert.ok(!err);
                              assert.ok(_getDocById(results, user.user.id));

                              // Completely delete the search index
                              SearchTestsUtil.deleteAll(() => {
                                // Ensure the user, group, members, memberships can no longer be found in search
                                SearchTestsUtil.searchAll(
                                  user.restContext,
                                  'general',
                                  null,
                                  { resourceTypes: 'user', q: user.user.displayName },
                                  (err, results) => {
                                    assert.ok(!err);
                                    assert.ok(!_getDocById(results, user.user.id));

                                    SearchTestsUtil.searchAll(
                                      user.restContext,
                                      'general',
                                      null,
                                      { resourceTypes: 'group', q: group.displayName },
                                      (err, results) => {
                                        assert.ok(!err);
                                        assert.ok(!_getDocById(results, group.id));

                                        SearchTestsUtil.searchAll(
                                          user.restContext,
                                          'memberships-library',
                                          [user.user.id],
                                          null,
                                          (err, results) => {
                                            assert.ok(!err);
                                            assert.ok(!_getDocById(results, group.id));

                                            SearchTestsUtil.searchAll(
                                              user.restContext,
                                              'members-library',
                                              [group.id],
                                              null,
                                              (err, results) => {
                                                assert.ok(!err);
                                                assert.ok(!_getDocById(results, user.user.id));

                                                // Reindex the whole search index
                                                SearchTestsUtil.reindexAll(
                                                  TestsUtil.createGlobalAdminRestContext(),
                                                  () => {
                                                    // Ensure all 4 document types are searchable again (user, group, member, membership)
                                                    SearchTestsUtil.searchAll(
                                                      user.restContext,
                                                      'general',
                                                      null,
                                                      {
                                                        resourceTypes: 'user',
                                                        q: user.user.displayName
                                                      },
                                                      (err, results) => {
                                                        assert.ok(!err);
                                                        assert.ok(
                                                          _getDocById(results, user.user.id)
                                                        );

                                                        SearchTestsUtil.searchAll(
                                                          user.restContext,
                                                          'general',
                                                          null,
                                                          {
                                                            resourceTypes: 'group',
                                                            q: group.displayName
                                                          },
                                                          (err, results) => {
                                                            assert.ok(!err);
                                                            assert.ok(
                                                              _getDocById(results, group.id)
                                                            );

                                                            SearchTestsUtil.searchAll(
                                                              user.restContext,
                                                              'memberships-library',
                                                              [user.user.id],
                                                              null,
                                                              (err, results) => {
                                                                assert.ok(!err);
                                                                assert.ok(
                                                                  _getDocById(results, group.id)
                                                                );

                                                                SearchTestsUtil.searchAll(
                                                                  user.restContext,
                                                                  'members-library',
                                                                  [group.id],
                                                                  null,
                                                                  (err, results) => {
                                                                    assert.ok(!err);
                                                                    assert.ok(
                                                                      _getDocById(
                                                                        results,
                                                                        user.user.id
                                                                      )
                                                                    );

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
                                      }
                                    );
                                  }
                                );
                              });
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
      });
    });
  });
});
