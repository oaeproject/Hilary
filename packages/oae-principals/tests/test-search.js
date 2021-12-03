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
import { callbackify } from 'node:util';
import { assert } from 'chai';
import _ from 'underscore';

import { keys, find, propSatisfies, equals } from 'ramda';

import * as ElasticSearch from 'oae-search/lib/internal/elasticsearch.js';
import * as RestAPI from 'oae-rest';
import * as SearchAPI from 'oae-search';
import * as SearchTestsUtil from 'oae-search/lib/test/util.js';
import * as TestsUtil from 'oae-tests';

describe('Search', () => {
  // REST contexts we can use to do REST requests
  let asCambribgeTenantAdmin = null;

  /**
   * Because we truncate the `Principals` table in one of our tests we need
   * to re-create the rest contexts for each test so we can ensure our admin
   * session will always point to a valid principal record
   */
  beforeEach((callback) => {
    asCambribgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    return callback();
  });

  /*!
   * Get the document with the specified id from the search results.
   *
   * @param  {SearchResult}  results     The search results object
   * @param  {String}        docId       The id of the document to search
   * @return {Object}                    The search document. `null` if it didn't exist
   */
  const _getDocById = (results, docId) => find(propSatisfies(equals(docId), 'id'), results.results);

  describe('Indexing', () => {
    /**
     * Test that verifies when a content item is indexed with just the content id,
     * it still indexes the content item.
     */
    it('verify indexing without full user item', (callback) => {
      TestsUtil.generateTestUsers(asCambribgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: doer, 1: jack } = users;

        // Verify the content item exists
        SearchTestsUtil.searchAll(
          doer.restContext,
          'general',
          null,
          { resourceTypes: 'user', q: jack.user.displayName },
          (error, results) => {
            assert.notExists(error);
            const userDoc = _getDocById(results, jack.user.id);
            assert.ok(userDoc);

            // Delete the content item from the index under the hood, this is to avoid the automatic index events invalidating the test
            callbackify(ElasticSearch.del)('resource', jack.user.id, (error_) => {
              assert.notExists(error_);

              // Verify the content item no longer exists
              SearchTestsUtil.searchAll(
                doer.restContext,
                'general',
                null,
                { resourceTypes: 'user', q: jack.user.displayName },
                (error, results) => {
                  assert.notExists(error);
                  const userDoc = _getDocById(results, jack.user.id);
                  assert.ok(!userDoc);

                  // Fire off an indexing task using just the user id
                  SearchAPI.postIndexTask('user', [{ id: jack.user.id }], { resource: true }, (error_) => {
                    assert.notExists(error_);

                    // Ensure that the full content item is now back in the search index
                    SearchTestsUtil.searchAll(
                      doer.restContext,
                      'general',
                      null,
                      { resourceTypes: 'user', q: jack.user.displayName },
                      (error, results) => {
                        assert.notExists(error);
                        const userDoc = _getDocById(results, jack.user.id);
                        assert.ok(userDoc);
                        assert.ok(_.isObject(userDoc.tenant));
                        assert.lengthOf(keys(userDoc.tenant), 3);
                        assert.strictEqual(userDoc.tenant.displayName, global.oaeTests.tenants.cam.displayName);
                        assert.strictEqual(userDoc.tenant.alias, global.oaeTests.tenants.cam.alias);
                        return callback();
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
     * Test that verifies when a content item is indexed with just the content id, it still indexes the content
     * item.
     */
    it('verify indexing without full group item', (callback) => {
      TestsUtil.generateTestUsers(asCambribgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: doer } = users;

        // Create the group we will test with
        const groupText = TestsUtil.generateTestUserId('group');
        RestAPI.Group.createGroup(doer.restContext, groupText, groupText, 'public', 'no', [], [], (error, group) => {
          assert.notExists(error);

          // Verify the content item exists
          SearchTestsUtil.searchAll(
            doer.restContext,
            'general',
            null,
            { resourceTypes: 'group', q: groupText },
            (error, results) => {
              assert.notExists(error);
              const groupDoc = _getDocById(results, group.id);
              assert.ok(groupDoc);

              // Delete the content item from the index under the hood, this is to avoid the automatic index events invalidating the test
              callbackify(ElasticSearch.del)('resource', group.id, (error_) => {
                assert.notExists(error_);

                // Verify the content item no longer exists
                SearchTestsUtil.searchAll(
                  doer.restContext,
                  'general',
                  null,
                  { resourceTypes: 'group', q: groupText },
                  (error, results) => {
                    assert.notExists(error);
                    const groupDoc = _getDocById(results, group.id);
                    assert.ok(!groupDoc);

                    // Fire off an indexing task using just the group id
                    SearchAPI.postIndexTask('group', [{ id: group.id }], { resource: true }, (error_) => {
                      assert.notExists(error_);
                      // Ensure that the full content item is now back in the search index
                      SearchTestsUtil.searchAll(
                        doer.restContext,
                        'general',
                        null,
                        { resourceTypes: 'group', q: groupText },
                        (error, results) => {
                          assert.notExists(error);
                          const groupDoc = _getDocById(results, group.id);
                          assert.ok(groupDoc);
                          assert.ok(_.isObject(groupDoc.tenant));
                          assert.strictEqual(_.keys(groupDoc.tenant).length, 3);
                          assert.strictEqual(groupDoc.tenant.displayName, global.oaeTests.tenants.cam.displayName);
                          assert.strictEqual(groupDoc.tenant.alias, global.oaeTests.tenants.cam.alias);
                          callback();
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
     * Test that verifies that users, groups, members and memberships documents are all reindexed when the search index is built with reindexAll
     */
    it('verify users and groups reindex with reindex all', (callback) => {
      // Clear all the data in the system to speed up the `reindexAll` operation in this test
      TestsUtil.clearAllData(() => {
        // Clear the search index to ensure we don't have search documents hanging around
        // for resources that have been deleted
        SearchTestsUtil.deleteAll(() => {
          TestsUtil.generateTestUsers(asCambribgeTenantAdmin, 1, (error, users) => {
            assert.notExists(error);
            const { 0: user } = users;

            TestsUtil.generateTestGroups(user.restContext, 1, (error, groups) => {
              assert.notExists(error);
              let { 0: group } = groups;
              group = group.group;

              // Sanity check we can search all 4 documents (user, group, member, membership)
              SearchTestsUtil.searchAll(
                user.restContext,
                'general',
                null,
                { resourceTypes: 'user', q: user.user.displayName },
                (error, results) => {
                  assert.notExists(error);
                  assert.ok(_getDocById(results, user.user.id));

                  SearchTestsUtil.searchAll(
                    user.restContext,
                    'general',
                    null,
                    { resourceTypes: 'group', q: group.displayName },
                    (error, results) => {
                      assert.notExists(error);
                      assert.ok(_getDocById(results, group.id));

                      SearchTestsUtil.searchAll(
                        user.restContext,
                        'memberships-library',
                        [user.user.id],
                        null,
                        (error, results) => {
                          assert.notExists(error);
                          assert.ok(_getDocById(results, group.id));

                          SearchTestsUtil.searchAll(
                            user.restContext,
                            'members-library',
                            [group.id],
                            null,
                            (error, results) => {
                              assert.notExists(error);
                              assert.ok(_getDocById(results, user.user.id));

                              // Completely delete the search index
                              SearchTestsUtil.deleteAll(() => {
                                // Ensure the user, group, members, memberships can no longer be found in search
                                SearchTestsUtil.searchAll(
                                  user.restContext,
                                  'general',
                                  null,
                                  { resourceTypes: 'user', q: user.user.displayName },
                                  (error, results) => {
                                    assert.notExists(error);
                                    assert.ok(!_getDocById(results, user.user.id));

                                    SearchTestsUtil.searchAll(
                                      user.restContext,
                                      'general',
                                      null,
                                      { resourceTypes: 'group', q: group.displayName },
                                      (error, results) => {
                                        assert.notExists(error);
                                        assert.ok(!_getDocById(results, group.id));

                                        SearchTestsUtil.searchAll(
                                          user.restContext,
                                          'memberships-library',
                                          [user.user.id],
                                          null,
                                          (error, results) => {
                                            assert.notExists(error);
                                            assert.ok(!_getDocById(results, group.id));

                                            SearchTestsUtil.searchAll(
                                              user.restContext,
                                              'members-library',
                                              [group.id],
                                              null,
                                              (error, results) => {
                                                assert.notExists(error);
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
                                                      (error, results) => {
                                                        assert.notExists(error);
                                                        assert.ok(_getDocById(results, user.user.id));

                                                        SearchTestsUtil.searchAll(
                                                          user.restContext,
                                                          'general',
                                                          null,
                                                          {
                                                            resourceTypes: 'group',
                                                            q: group.displayName
                                                          },
                                                          (error, results) => {
                                                            assert.notExists(error);
                                                            assert.ok(_getDocById(results, group.id));

                                                            SearchTestsUtil.searchAll(
                                                              user.restContext,
                                                              'memberships-library',
                                                              [user.user.id],
                                                              null,
                                                              (error, results) => {
                                                                assert.notExists(error);
                                                                assert.ok(_getDocById(results, group.id));

                                                                SearchTestsUtil.searchAll(
                                                                  user.restContext,
                                                                  'members-library',
                                                                  [group.id],
                                                                  null,
                                                                  (error, results) => {
                                                                    assert.notExists(error);
                                                                    assert.ok(_getDocById(results, user.user.id));

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
