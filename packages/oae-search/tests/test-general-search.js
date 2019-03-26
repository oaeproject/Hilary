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

/* eslint-disable radix */
const assert = require('assert');
const _ = require('underscore');

const AuthzUtil = require('oae-authz/lib/util');
const ConfigTestUtil = require('oae-config/lib/test/util');
const PrincipalsTestUtil = require('oae-principals/lib/test/util');
const RestAPI = require('oae-rest');
const { RestContext } = require('oae-rest/lib/model');
const TenantsTestUtil = require('oae-tenants/lib/test/util');
const TestsUtil = require('oae-tests');

const SearchTestsUtil = require('oae-search/lib/test/util');

describe('General Search', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let anonymousRestContext = null;
  let anonymousGtRestContext = null;
  // Rest contexts that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;
  let gtAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;
  let globalAdminOnTenantRestContext = null;

  /**
   * Function that will fill up the anonymous and admin REST context.
   *
   * Because we truncate the `Principals` table in one of our tests we need
   * to re-create the rest contexts for each test so we can ensure our admin
   * session will always point to a valid principal record
   */
  beforeEach(callback => {
    // Fill up anonymous rest context
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    anonymousGtRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.gt.host);
    // Fill up tenant admin rest contexts
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    // Fill up global admin rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();

    // Log the global admin into a tenant so we can perform user-tenant requests with a global admin to test their access
    RestAPI.Admin.loginOnTenant(globalAdminRestContext, 'localhost', null, (err, ctx) => {
      assert.ok(!err);
      globalAdminOnTenantRestContext = ctx;
      callback();
    });
  });

  /**
   * Get the document with the specified id from the search results.
   *
   * @param  {SearchResult}  results     The search results object
   * @param  {String}        docId       The id of the document to search
   * @return {Object}                    The search document. `null` if it didn't exist
   */
  const _getDocById = function(results, docId) {
    return _.find(results.results, result => {
      return result.id === docId;
    });
  };

  /**
   * Search for a resource based on the display name of a provided resource
   *
   * @param  {RestContext}    restCtx                 The rest context that should perform the search
   * @param  {String}         scope                   The scope with which to perform the search
   * @param  {Object}         resource                The resource to search for
   * @param  {String}         resource.id             The ID of the resource. This should be the value that is used as the id for a search document
   * @param  {String}         resource.displayName    The ID of the resource. This should be the value that is used as the id for a search document
   * @param  {String}         resource.resourceType   The ID of the resource. This should be the value that is used as the id for a search document
   * @param  {Boolean}        expectInResults         Whether or not you expect the resource to return in the search results
   * @param  {Function}       callback                Standard callback function
   * @throws {Error}                                  If the resource is not in the results when you expected it to, or vice versa
   */
  const searchForResource = function(restCtx, scope, resource, expectInResults, callback) {
    SearchTestsUtil.searchRefreshed(
      restCtx,
      'general',
      null,
      { scope, resourceTypes: resource.resourceType, q: resource.displayName },
      (err, results) => {
        assert.ok(!err);
        const resourceDoc = _getDocById(results, resource.id);
        if (expectInResults) {
          assert.ok(resourceDoc);
        } else {
          assert.ok(!resourceDoc);
        }

        return callback();
      }
    );
  };

  describe('User Indexing', () => {
    /**
     * Test that verifies a created user can be searched.
     */
    it('verify index created user', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        assert.ok(!err);

        // Verify we can search for the user
        const { 0: mrvisser } = _.values(users);
        SearchTestsUtil.searchRefreshed(
          anonymousRestContext,
          'general',
          null,
          { resourceTypes: 'user', q: mrvisser.user.displayName },
          (err, results) => {
            assert.ok(!err);
            assert.ok(_getDocById(results, mrvisser.user.id));
            return callback();
          }
        );
      });
    });

    /**
     * Test that verifies the search index is updated when a user is updated.
     */
    it('verify index updated user', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        assert.ok(!err);

        const { 0: mrvisser } = _.values(users);
        // First check that the user does not match on the term 'Visser'
        SearchTestsUtil.searchRefreshed(
          anonymousRestContext,
          'general',
          null,
          { resourceTypes: 'user', q: 'Visser' },
          (err, results) => {
            assert.ok(!err);
            assert.ok(!_getDocById(results, mrvisser.user.id));

            // Set the display name of the user
            const updateProperties = { displayName: 'Branden Visser' + mrvisser.user.id };

            RestAPI.User.updateUser(mrvisser.restContext, mrvisser.user.id, updateProperties, err => {
              assert.ok(!err);

              // Ensure that the new term matches the user
              SearchTestsUtil.searchRefreshed(
                anonymousRestContext,
                'general',
                null,
                { resourceTypes: 'user', q: updateProperties.displayName },
                (err, results) => {
                  assert.ok(!err);

                  const doc = _getDocById(results, mrvisser.user.id);
                  assert.ok(doc);
                  assert.ok(!doc._extra);

                  // There should not be a doc.extra because there are no extension properties on the user
                  assert.ok(!doc.extra);

                  callback();
                }
              );
            });
          }
        );
      });
    });
  });

  describe('Group Indexing', () => {
    /**
     * Test that verifies a newly created group can be searched.
     */
    it('verify index created group', callback => {
      TestsUtil.generateTestGroups(camAdminRestContext, 1, oaeTeam => {
        SearchTestsUtil.searchRefreshed(
          anonymousRestContext,
          'general',
          null,
          { resourceTypes: 'group', q: oaeTeam.group.displayName },
          (err, results) => {
            assert.ok(!err);
            assert.ok(_getDocById(results, oaeTeam.group.id));
            return callback();
          }
        );
      });
    });

    /**
     * Test that verifies the search index is updated when a group is updated.
     */
    it('verify index updated group', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, doer) => {
        assert.ok(!err);

        TestsUtil.generateTestGroups(doer.restContext, 1, xyzTeam => {
          // Verify that the group does not match on the term 'testverifyindexupdatedgroup', this is to sanity check the search before searching for a valid post-update hit later
          SearchTestsUtil.searchRefreshed(
            doer.restContext,
            'general',
            null,
            { resourceTypes: 'group', q: xyzTeam.group.displayName },
            (err, results) => {
              assert.ok(!err);

              const doc = _getDocById(results, xyzTeam.group.id);
              assert.ok(doc);
              assert.strictEqual(doc.displayName, xyzTeam.group.displayName);
              assert.strictEqual(doc.resourceType, 'group');
              assert.strictEqual(
                doc.profilePath,
                '/group/' + doc.tenant.alias + '/' + AuthzUtil.getResourceFromId(doc.id).resourceId
              );

              // Update name match the term
              const displayName = 'Team testverifyindexupdatedgroup' + xyzTeam.group.id;
              RestAPI.Group.updateGroup(doer.restContext, xyzTeam.group.id, { displayName }, err => {
                assert.ok(!err);

                // Verify that the group now appears with the search term 'testverifyindexupdatedgroup'
                SearchTestsUtil.searchRefreshed(
                  doer.restContext,
                  'general',
                  null,
                  { resourceTypes: 'group', q: displayName },
                  (err, results) => {
                    assert.ok(!err);

                    const doc = _getDocById(results, xyzTeam.group.id);
                    assert.ok(doc);
                    assert.strictEqual(doc.displayName, displayName);
                    assert.strictEqual(doc.resourceType, 'group');
                    assert.strictEqual(
                      doc.profilePath,
                      '/group/' + doc.tenant.alias + '/' + AuthzUtil.getResourceFromId(doc.id).resourceId
                    );
                    return callback();
                  }
                );
              });
            }
          );
        });
      });
    });
  });

  describe('Content Indexing', () => {
    /**
     * Test that verifies that a content item can be searched after it has been created.
     */
    it('verify index created content', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, doer) => {
        assert.ok(!err);

        RestAPI.Content.createLink(
          doer.restContext,
          'Apereo Foundation',
          'Link to Apereo Foundation Website',
          'public',
          'http://www.apereo.org',
          [],
          [],
          [],
          (err, content) => {
            assert.ok(!err);

            // Verify search term Apereo matches the document
            SearchTestsUtil.searchRefreshed(
              doer.restContext,
              'general',
              null,
              { resourceTypes: 'content', q: 'Apereo' },
              (err, results) => {
                assert.ok(!err);
                assert.ok(_getDocById(results, content.id));
                callback();
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies the search index is updated after a content item is updated.
     */
    it('verify index updated content', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, doer) => {
        assert.ok(!err);

        RestAPI.Content.createLink(
          doer.restContext,
          'Apereo Foundation',
          'Link to Apereo Foundation Website',
          'public',
          'http://www.apereo.org',
          [],
          [],
          [],
          (err, content) => {
            assert.ok(!err);

            // Verify search term OAE does not match the content
            SearchTestsUtil.searchRefreshed(
              doer.restContext,
              'general',
              null,
              { resourceTypes: 'content', q: 'OAE' },
              (err, results) => {
                assert.ok(!err);
                assert.ok(!_getDocById(results, content.id));

                // Update the content
                RestAPI.Content.updateContent(doer.restContext, content.id, { displayName: 'OAE Project' }, err => {
                  assert.ok(!err);

                  // Verify OAE now matches the updated content item
                  SearchTestsUtil.searchRefreshed(
                    doer.restContext,
                    'general',
                    null,
                    { resourceTypes: 'content', q: 'OAE' },
                    (err, results) => {
                      assert.ok(!err);
                      assert.ok(_getDocById(results, content.id));
                      callback();
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
     * Test that verifies that a content item can be searched by its comments
     */
    it('verify index content comments', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
        assert.ok(!err);

        const searchTerm = 'zxkdjfhdjghdjrghsfhgjsldkfjghsldkjfgh';

        RestAPI.Content.createLink(
          user.restContext,
          'Apereo Foundation',
          'Link to Apereo Foundation Website',
          'public',
          'http://www.apereo.org',
          [],
          [],
          [],
          (err, content) => {
            assert.ok(!err);

            // Verify the search term does not match the content item we just created
            SearchTestsUtil.searchAll(
              user.restContext,
              'general',
              null,
              { resourceTypes: 'content', q: searchTerm },
              (err, results) => {
                assert.ok(!err);
                assert.ok(!_getDocById(results, content.id));

                // Create a comment on the content item
                RestAPI.Content.createComment(user.restContext, content.id, searchTerm, null, (err, comment) => {
                  assert.ok(!err);

                  // Verify the search term matches the content item we just commented on
                  SearchTestsUtil.searchAll(
                    user.restContext,
                    'general',
                    null,
                    { resourceTypes: 'content', q: searchTerm },
                    (err, results) => {
                      assert.ok(!err);
                      assert.ok(_getDocById(results, content.id));

                      // Now delete the message
                      RestAPI.Content.deleteComment(user.restContext, content.id, comment.created, err => {
                        assert.ok(!err);

                        // Verify the search term no longer matches the content item
                        SearchTestsUtil.searchAll(
                          user.restContext,
                          'general',
                          null,
                          { resourceTypes: 'content', q: searchTerm },
                          (err, results) => {
                            assert.ok(!err);
                            assert.ok(!_getDocById(results, content.id));

                            return callback();
                          }
                        );
                      });
                    }
                  );
                });
              }
            );
          }
        );
      });
    });
  });

  describe('Message Indexing', () => {
    /**
     * Determines if the provided document is in the search results.
     *
     * @param  {SearchResult}   results     The search results object
     * @param  {String}         docId       The id of the document to search
     * @return {Boolean}                    `true` if the document with the id is in the results. `false` otherwise
     */
    const _containsDoc = function(results, docId) {
      return Boolean(_getDocById(results, docId));
    };

    /**
     * Verify that the content item and discussion item either return or do not return (according to `canSearchContent` and `canSearchDiscussion`
     * using different permutations of the `resourceTypes` parameter.
     *
     * @param  {RestContext}    restContext             The request context to use to invoke the search requests
     * @param  {String}         contentId               The id of the content item to search for
     * @param  {String}         discussionId            The id of the discussion to search for
     * @param  {Boolean}        canSearchContent        Whether or not the content item should be searchable with the search term
     * @param  {Boolean}        canSearchDiscussion     Whether or not the discussion should be searchable with the search term
     * @param  {String}         searchTerm              The search term to use in the searches
     * @param  {Function}       callback                Standard callback function
     * @throws {AssertionError}                         Thrown if the search results do not return the expected results
     */
    const _verifySearchResults = function(
      restContext,
      contentId,
      discussionId,
      canSearchContent,
      canSearchDiscussion,
      searchTerm,
      callback
    ) {
      // Verify the specified search state with all permutations of the applicable `resourceTypes` parameters
      SearchTestsUtil.searchAll(
        restContext,
        'general',
        null,
        { resourceTypes: 'discussion', q: searchTerm },
        (err, results) => {
          assert.ok(!err);
          assert.ok(!_getDocById(results, contentId));
          assert.strictEqual(_containsDoc(results, discussionId), canSearchDiscussion);
          SearchTestsUtil.searchAll(
            restContext,
            'general',
            null,
            { resourceTypes: 'content', q: searchTerm },
            (err, results) => {
              assert.ok(!err);
              assert.strictEqual(_containsDoc(results, contentId), canSearchContent);
              assert.ok(!_getDocById(results, discussionId));
              SearchTestsUtil.searchAll(
                restContext,
                'general',
                null,
                { resourceTypes: ['discussion', 'content'], q: searchTerm },
                (err, results) => {
                  assert.ok(!err);
                  assert.strictEqual(_containsDoc(results, contentId), canSearchContent);
                  assert.strictEqual(_containsDoc(results, discussionId), canSearchDiscussion);
                  SearchTestsUtil.searchAll(restContext, 'general', null, { q: searchTerm }, (err, results) => {
                    assert.ok(!err);
                    assert.strictEqual(_containsDoc(results, contentId), canSearchContent);
                    assert.strictEqual(_containsDoc(results, discussionId), canSearchDiscussion);
                    return callback();
                  });
                }
              );
            }
          );
        }
      );
    };

    /**
     * Test that verifies content and discussions are searchable by their messages. Also verifies that messages that are
     * deleted no longer cause the content and discussion items to be returned in search
     */
    it('verify discussion and content items can be searched by messages and comments', callback => {
      // Create the user to test with
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
        assert.ok(!err);

        const searchTerm = 'zxkdjfhdjghdjrghsfhgjsldkfjghsldkjfgh';

        // Create the content item and discussion we will test searching for
        RestAPI.Content.createLink(
          user.restContext,
          'Apereo Foundation',
          'Link to Apereo Foundation Website',
          'public',
          'http://www.apereo.org',
          [],
          [],
          [],
          (err, content) => {
            assert.ok(!err);
            RestAPI.Discussions.createDiscussion(
              user.restContext,
              'How about them Leafs?',
              'Official Toronto Maple Leafs Thread',
              'public',
              [],
              [],
              (err, discussion) => {
                assert.ok(!err);

                // Verify that we do not get the content item or discussion in any of the search resourceTypes permutations
                _verifySearchResults(user.restContext, content.id, discussion.id, false, false, searchTerm, () => {
                  // Create a comment on the content item
                  RestAPI.Content.createComment(user.restContext, content.id, searchTerm, null, (err, comment) => {
                    assert.ok(!err);

                    // Verify that we get the content item but not the discussion item in the applicable search resourceTypes permutations
                    _verifySearchResults(user.restContext, content.id, discussion.id, true, false, searchTerm, () => {
                      // Post a message on the discussion
                      RestAPI.Discussions.createMessage(
                        user.restContext,
                        discussion.id,
                        searchTerm,
                        null,
                        (err, message) => {
                          assert.ok(!err);

                          // Verify that we get both the content item and discussion item in the applicable search resourceTypes permutations
                          _verifySearchResults(
                            user.restContext,
                            content.id,
                            discussion.id,
                            true,
                            true,
                            searchTerm,
                            () => {
                              // Delete the content comment
                              RestAPI.Content.deleteComment(user.restContext, content.id, comment.created, err => {
                                assert.ok(!err);

                                // Verify that we get do not get the content item in the applicable search resourceTypes permutations
                                _verifySearchResults(
                                  user.restContext,
                                  content.id,
                                  discussion.id,
                                  false,
                                  true,
                                  searchTerm,
                                  () => {
                                    // Delete the discussion message
                                    RestAPI.Discussions.deleteMessage(
                                      user.restContext,
                                      discussion.id,
                                      message.created,
                                      err => {
                                        assert.ok(!err);

                                        // Verify that we don't get the content item nor the discussion in any search resourceTypes permutation
                                        return _verifySearchResults(
                                          user.restContext,
                                          content.id,
                                          discussion.id,
                                          false,
                                          false,
                                          searchTerm,
                                          callback
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
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that invoking reindexAll on an empty search index results in content and discussion items to be indexed
     * appropriately with their messages.
     */
    it('verify reindexAll reindexes messages as children of their parent resource items', callback => {
      // Clear all the data in the system to speed up the `reindexAll` operation in this test
      TestsUtil.clearAllData(() => {
        // Create the user to test with
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
          assert.ok(!err);

          const searchTerm = 'zxkdjfhdjghdjrghsfhgjsldkfjghsldkjfgh';

          // Create the content item and discussion we will test searching for
          RestAPI.Content.createLink(
            user.restContext,
            'Apereo Foundation',
            'Link to Apereo Foundation Website',
            'public',
            'http://www.apereo.org',
            [],
            [],
            [],
            (err, content) => {
              assert.ok(!err);
              RestAPI.Discussions.createDiscussion(
                user.restContext,
                'How about them Leafs?',
                'Official Toronto Maple Leafs Thread',
                'public',
                [],
                [],
                (err, discussion) => {
                  assert.ok(!err);

                  // Verify that we do not get the content item or discussion in any of the search resourceTypes permutations
                  _verifySearchResults(user.restContext, content.id, discussion.id, false, false, searchTerm, () => {
                    // Create a comment and message on the content item and discussion
                    RestAPI.Content.createComment(user.restContext, content.id, searchTerm, null, (err, comment) => {
                      assert.ok(!err);
                      RestAPI.Discussions.createMessage(
                        user.restContext,
                        discussion.id,
                        searchTerm,
                        null,
                        (err, message) => {
                          assert.ok(!err);

                          // Ensure both the content item and message are searchable by their messages
                          _verifySearchResults(
                            user.restContext,
                            content.id,
                            discussion.id,
                            true,
                            true,
                            searchTerm,
                            () => {
                              // Delete the search index
                              SearchTestsUtil.deleteAll(() => {
                                // Ensure we can no longer search for either content or discussion item
                                _verifySearchResults(
                                  user.restContext,
                                  content.id,
                                  discussion.id,
                                  false,
                                  false,
                                  searchTerm,
                                  () => {
                                    // Reindex all resources
                                    SearchTestsUtil.reindexAll(TestsUtil.createGlobalAdminRestContext(), () => {
                                      // Ensure we can now search both content and discussion item again by their message bodies
                                      return _verifySearchResults(
                                        user.restContext,
                                        content.id,
                                        discussion.id,
                                        true,
                                        true,
                                        searchTerm,
                                        callback
                                      );
                                    });
                                  }
                                );
                              });
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
        });
      });
    });

    /**
     * Verify deleting a content item and discussion only deletes message documents for the deleted resources
     */
    it('verify deleting resources only deletes its own children documents', callback => {
      // Create the user to test with
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
        assert.ok(!err);

        const searchTerm = 'zxkdjfhdjghdjrghsfhgjsldkfjghsldkjfgh';

        // Create the content items and discussions we will test deleting and searching for
        RestAPI.Content.createLink(
          user.restContext,
          'Apereo Foundation',
          'Link to Apereo Foundation Website',
          'public',
          'http://www.apereo.org',
          [],
          [],
          [],
          (err, content) => {
            assert.ok(!err);
            RestAPI.Content.createLink(
              user.restContext,
              'Apereo Foundation',
              'Link to Apereo Foundation Website',
              'public',
              'http://www.apereo.org',
              [],
              [],
              [],
              (err, content2) => {
                assert.ok(!err);
                RestAPI.Discussions.createDiscussion(
                  user.restContext,
                  'How about them Leafs?',
                  'Official Toronto Maple Leafs Thread',
                  'public',
                  [],
                  [],
                  (err, discussion) => {
                    assert.ok(!err);
                    RestAPI.Discussions.createDiscussion(
                      user.restContext,
                      'How about them Leafs?',
                      'Official Toronto Maple Leafs Thread',
                      'public',
                      [],
                      [],
                      (err, discussion2) => {
                        assert.ok(!err);

                        // Create comments and messages on all the content and discussion items
                        RestAPI.Content.createComment(
                          user.restContext,
                          content.id,
                          searchTerm,
                          null,
                          (err, comment) => {
                            assert.ok(!err);
                            RestAPI.Content.createComment(
                              user.restContext,
                              content2.id,
                              searchTerm,
                              null,
                              (err, comment2) => {
                                assert.ok(!err);
                                RestAPI.Discussions.createMessage(
                                  user.restContext,
                                  discussion.id,
                                  searchTerm,
                                  null,
                                  (err, message) => {
                                    assert.ok(!err);
                                    RestAPI.Discussions.createMessage(
                                      user.restContext,
                                      discussion2.id,
                                      searchTerm,
                                      null,
                                      (err, message2) => {
                                        assert.ok(!err);

                                        // Verify we can search for both content items and discussions using the message search term
                                        _verifySearchResults(
                                          user.restContext,
                                          content.id,
                                          discussion.id,
                                          true,
                                          true,
                                          searchTerm,
                                          () => {
                                            _verifySearchResults(
                                              user.restContext,
                                              content2.id,
                                              discussion2.id,
                                              true,
                                              true,
                                              searchTerm,
                                              () => {
                                                // Delete just the 2nd content item and the 2nd discussion
                                                RestAPI.Content.deleteContent(user.restContext, content2.id, err => {
                                                  assert.ok(!err);
                                                  RestAPI.Discussions.deleteDiscussion(
                                                    user.restContext,
                                                    discussion2.id,
                                                    err => {
                                                      assert.ok(!err);

                                                      // Ensure that the non-deleted content and discussion are searchable, while the 2nd ones are not
                                                      _verifySearchResults(
                                                        user.restContext,
                                                        content.id,
                                                        discussion.id,
                                                        true,
                                                        true,
                                                        searchTerm,
                                                        () => {
                                                          return _verifySearchResults(
                                                            user.restContext,
                                                            content2.id,
                                                            discussion2.id,
                                                            false,
                                                            false,
                                                            searchTerm,
                                                            callback
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
  });

  describe('General Search Parameters', () => {
    /**
     * Verifies empty, null, and valid values for both single and array lookups using the resourceTypes parameter.
     */
    it('verify a variety of valid and invalid values for the resourceTypes parameter', callback => {
      /*!
             * Helper function that verifies that a search result feed has (or doesn't have) results of certain resourceTypes
             *
             * @param  {SearchResult}   results             The search results object
             * @param  {Boolean}        shouldHaveUser      Whether or not the results should contain a user object
             * @param  {Boolean}        shouldHaveGroup     Whether or not the results should contain a group object
             * @param  {Boolean}        shouldHaveContent   Whether or not the results should contain a content object
             * @return {Object}                             The search document. `null` if it didn't exist
             */
      const _verifyHasResourceTypes = function(results, shouldHaveUser, shouldHaveGroup, shouldHaveContent) {
        let hasUser = false;
        let hasGroup = false;
        let hasContent = false;
        _.each(results.results, doc => {
          if (doc.resourceType === 'user') {
            hasUser = true;
          } else if (doc.resourceType === 'group') {
            hasGroup = true;
          } else if (doc.resourceType === 'content') {
            hasContent = true;
          }
        });

        assert.strictEqual(shouldHaveUser, hasUser);
        assert.strictEqual(shouldHaveGroup, hasGroup);
        assert.strictEqual(shouldHaveContent, hasContent);
      };

      // Ensure at least one user, group and content item exists
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        RestAPI.Group.createGroup(
          jack.restContext,
          jack.user.displayName,
          jack.user.displayName,
          'public',
          'no',
          [],
          [],
          (err, group) => {
            assert.ok(!err);

            RestAPI.Content.createLink(
              jack.restContext,
              jack.user.displayName,
              jack.user.displayName,
              'public',
              'http://www.apereo.org',
              [],
              [],
              [],
              (err, content) => {
                assert.ok(!err);

                // Verify unspecified resourceTypes searches all
                SearchTestsUtil.searchRefreshed(
                  jack.restContext,
                  'general',
                  null,
                  { q: jack.user.displayName },
                  (err, results) => {
                    assert.ok(!err);
                    _verifyHasResourceTypes(results, true, true, true);

                    // Verify empty resourceTypes searches all
                    RestAPI.Search.search(
                      jack.restContext,
                      'general',
                      null,
                      { resourceTypes: '', q: jack.user.displayName },
                      (err, results) => {
                        assert.ok(!err);
                        _verifyHasResourceTypes(results, true, true, true);

                        // Verify non-matching single resource type returns nothing
                        RestAPI.Search.search(
                          jack.restContext,
                          'general',
                          null,
                          { resourceTypes: 'not-matching-anything', q: jack.user.displayName },
                          (err, results) => {
                            assert.ok(!err);
                            assert.strictEqual(results.results.length, 0);

                            // Verify each single resourceType searches just that one
                            RestAPI.Search.search(
                              jack.restContext,
                              'general',
                              null,
                              { resourceTypes: 'user', q: jack.user.displayName },
                              (err, results) => {
                                assert.ok(!err);
                                _verifyHasResourceTypes(results, true, false, false);

                                RestAPI.Search.search(
                                  jack.restContext,
                                  'general',
                                  null,
                                  { resourceTypes: 'group', q: jack.user.displayName },
                                  (err, results) => {
                                    assert.ok(!err);
                                    _verifyHasResourceTypes(results, false, true, false);

                                    RestAPI.Search.search(
                                      jack.restContext,
                                      'general',
                                      null,
                                      { resourceTypes: 'content' },
                                      (err, results) => {
                                        assert.ok(!err);
                                        _verifyHasResourceTypes(results, false, false, true);

                                        // Verify searching 2 returns just the 2 types
                                        RestAPI.Search.search(
                                          jack.restContext,
                                          'general',
                                          null,
                                          {
                                            resourceTypes: ['group', 'content'],
                                            q: jack.user.displayName
                                          },
                                          (err, results) => {
                                            assert.ok(!err);
                                            _verifyHasResourceTypes(results, false, true, true);

                                            // Verify searching one with garbage commas returns just the one
                                            RestAPI.Search.search(
                                              jack.restContext,
                                              'general',
                                              null,
                                              {
                                                resourceTypes: ['', '', 'content', ''],
                                                q: jack.user.displayName
                                              },
                                              (err, results) => {
                                                assert.ok(!err);
                                                _verifyHasResourceTypes(results, false, false, true);

                                                // Verify searching two with garbage commas returns just the two
                                                RestAPI.Search.search(
                                                  jack.restContext,
                                                  'general',
                                                  null,
                                                  {
                                                    resourceTypes: ['', '', 'user', 'content', '', ''],
                                                    q: jack.user.displayName
                                                  },
                                                  (err, results) => {
                                                    assert.ok(!err);
                                                    _verifyHasResourceTypes(results, true, false, true);

                                                    // Verify searching with garbage commas and non-matching values still returns by the valid resources types
                                                    RestAPI.Search.search(
                                                      jack.restContext,
                                                      'general',
                                                      null,
                                                      {
                                                        resourceTypes: ['', '', 'non-matching', '', 'group', 'user'],
                                                        q: jack.user.displayName
                                                      },
                                                      (err, results) => {
                                                        assert.ok(!err);
                                                        _verifyHasResourceTypes(results, true, true, false);
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
                  }
                );
              }
            );
          }
        );
      });
    });
  });

  describe('Search Paging', () => {
    /**
     * Test that verifies that the 'start' property properly pages search results
     */
    it('verify search paging', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, doer) => {
        assert.ok(!err);

        // Make sure we have at least 2 content items to page with, their actual information is not important for this test
        RestAPI.Content.createLink(
          doer.restContext,
          'OAE Project',
          'Link to OAE Project Website',
          'public',
          'http://www.oaeproject.org',
          [],
          [],
          [],
          (err, link) => {
            assert.ok(!err);

            RestAPI.Content.createLink(
              doer.restContext,
              'Apereo Foundation',
              'Link to Apereo Foundation Website',
              'public',
              'http://www.apereo.org',
              [],
              [],
              [],
              (err, link) => {
                assert.ok(!err);

                // Search once and grab the first document id
                SearchTestsUtil.searchRefreshed(doer.restContext, 'general', null, { limit: 1 }, (err, results) => {
                  assert.ok(!err);
                  assert.ok(results);
                  assert.ok(results.results);
                  assert.strictEqual(results.results.length, 1);

                  const firstDocId = results.results[0].id;
                  assert.ok(firstDocId);

                  // Perform the same search, but with start=0, and make sure the first document is still the same. Verifies default paging
                  RestAPI.Search.search(doer.restContext, 'general', null, { limit: 1, start: 0 }, (err, results) => {
                    assert.ok(!err);
                    assert.ok(results);
                    assert.ok(results.results);
                    assert.strictEqual(results.results.length, 1);
                    assert.strictEqual(results.results[0].id, firstDocId);

                    // Search again with start=1 and verify the first document id of the previous search is not the same as the first document id of this search
                    RestAPI.Search.search(doer.restContext, 'general', null, { limit: 1, start: 1 }, (err, results) => {
                      assert.ok(!err);
                      assert.ok(results);
                      assert.ok(results.results);
                      assert.strictEqual(results.results.length, 1);

                      const secondDocId = results.results[0].id;
                      assert.ok(secondDocId);

                      assert.notStrictEqual(firstDocId, secondDocId);
                      return callback();
                    });
                  });
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that the total results count stays accurate regardless of paging parameters
     */
    it('verify search total count', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
        assert.ok(!err);

        // Make sure we have at least 2 similar content items
        RestAPI.Content.createLink(
          user.restContext,
          'Apereo OAE',
          'Link to OAE Project Website',
          'public',
          'http://www.oaeproject.org',
          [],
          [],
          [],
          (err, link) => {
            assert.ok(!err);

            RestAPI.Content.createLink(
              user.restContext,
              'Apereo Foundation',
              'Link to Apereo Foundation Website',
              'public',
              'http://www.apereo.org',
              [],
              [],
              [],
              (err, link) => {
                assert.ok(!err);

                // Do a search so we know how many items there are in the index for this search term
                SearchTestsUtil.searchRefreshed(user.restContext, 'general', null, { q: 'Apereo' }, (err, results) => {
                  assert.ok(!err);

                  // When we only select a subset of the results, the count should reflect the total matching items in the index
                  RestAPI.Search.search(
                    user.restContext,
                    'general',
                    null,
                    { q: 'Apereo', start: 0, limit: 1 },
                    (err, startResults) => {
                      assert.ok(!err);
                      assert.strictEqual(results.total, startResults.total);
                      assert.strictEqual(startResults.results.length, 1);

                      // When we search for all the results, the count should reflect the total matching items in the index
                      SearchTestsUtil.searchAll(
                        user.restContext,
                        'general',
                        null,
                        { q: 'Apereo', start: 0, limit: results.total },
                        (err, allResults) => {
                          assert.ok(!err);
                          assert.strictEqual(results.total, allResults.total);
                          assert.strictEqual(allResults.results.length, results.total);

                          // When we do a search with a higher start number than the total number, the count should reflect the total matching items in the index
                          RestAPI.Search.search(
                            user.restContext,
                            'general',
                            null,
                            { q: 'Apereo', start: results.total },
                            (err, emptyResults) => {
                              assert.ok(!err);
                              assert.strictEqual(results.total, emptyResults.total);
                              assert.strictEqual(emptyResults.results.length, 0);
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
          }
        );
      });
    });
  });

  describe('Search Scopes', () => {
    /**
     * Test that verifies that the _all scope searches everything from all tenants
     */
    it('verify "all" search scope searches resources from inside and outside the tenant network (but not private tenants)', callback => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
        // It should search everything in the system when searching as the global administrator
        searchForResource(globalAdminRestContext, '_all', publicTenant0.publicUser.user, true, () => {
          searchForResource(globalAdminRestContext, '_all', publicTenant0.loggedinUser.user, true, () => {
            searchForResource(globalAdminRestContext, '_all', publicTenant0.privateUser.user, true, () => {
              searchForResource(globalAdminRestContext, '_all', privateTenant0.publicUser.user, true, () => {
                searchForResource(globalAdminRestContext, '_all', privateTenant0.loggedinUser.user, true, () => {
                  searchForResource(globalAdminRestContext, '_all', privateTenant0.privateUser.user, true, () => {
                    // It should search public resources from public tenants but not private tenants when searching
                    // as a regular user
                    TestsUtil.setupMultiTenantPrivacyEntities(
                      (publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
                        searchForResource(
                          publicTenant0.publicUser.restContext,
                          '_all',
                          publicTenant0.publicUser.user,
                          true,
                          () => {
                            searchForResource(
                              publicTenant0.publicUser.restContext,
                              '_all',
                              publicTenant0.loggedinUser.user,
                              true,
                              () => {
                                searchForResource(
                                  publicTenant0.publicUser.restContext,
                                  '_all',
                                  publicTenant0.privateUser.user,
                                  false,
                                  () => {
                                    searchForResource(
                                      publicTenant0.publicUser.restContext,
                                      '_all',
                                      privateTenant0.publicUser.user,
                                      false,
                                      () => {
                                        searchForResource(
                                          publicTenant0.publicUser.restContext,
                                          '_all',
                                          privateTenant0.loggedinUser.user,
                                          false,
                                          () => {
                                            searchForResource(
                                              publicTenant0.publicUser.restContext,
                                              '_all',
                                              privateTenant0.privateUser.user,
                                              false,
                                              () => {
                                                // It should search public resources from private tenants when searching as a private tenant user
                                                TestsUtil.setupMultiTenantPrivacyEntities(
                                                  (publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
                                                    searchForResource(
                                                      privateTenant0.publicUser.restContext,
                                                      '_all',
                                                      publicTenant0.publicUser.user,
                                                      false,
                                                      () => {
                                                        searchForResource(
                                                          privateTenant0.publicUser.restContext,
                                                          '_all',
                                                          publicTenant0.loggedinUser.user,
                                                          false,
                                                          () => {
                                                            searchForResource(
                                                              privateTenant0.publicUser.restContext,
                                                              '_all',
                                                              publicTenant0.privateUser.user,
                                                              false,
                                                              () => {
                                                                searchForResource(
                                                                  privateTenant0.publicUser.restContext,
                                                                  '_all',
                                                                  privateTenant0.publicUser.user,
                                                                  true,
                                                                  () => {
                                                                    searchForResource(
                                                                      privateTenant0.publicUser.restContext,
                                                                      '_all',
                                                                      privateTenant0.loggedinUser.user,
                                                                      true,
                                                                      () => {
                                                                        searchForResource(
                                                                          privateTenant0.publicUser.restContext,
                                                                          '_all',
                                                                          privateTenant0.privateUser.user,
                                                                          false,
                                                                          () => {
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
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the _network scope searches resources from inside the current tenant network only
     */
    it('verify the "network" search scope searches resources from inside the current tenant network only', callback => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
        // Public and loggedin items from the current public tenant should be searched
        searchForResource(publicTenant0.publicUser.restContext, '_network', publicTenant0.publicUser.user, true, () => {
          searchForResource(
            publicTenant0.publicUser.restContext,
            '_network',
            publicTenant0.loggedinUser.user,
            true,
            () => {
              searchForResource(
                publicTenant0.publicUser.restContext,
                '_network',
                publicTenant0.privateUser.user,
                false,
                () => {
                  // Only public items from another public tenant should be searched
                  searchForResource(
                    publicTenant0.publicUser.restContext,
                    '_network',
                    publicTenant1.publicUser.user,
                    true,
                    () => {
                      searchForResource(
                        publicTenant0.publicUser.restContext,
                        '_network',
                        publicTenant1.loggedinUser.user,
                        false,
                        () => {
                          searchForResource(
                            publicTenant0.publicUser.restContext,
                            '_network',
                            publicTenant1.privateUser.user,
                            false,
                            () => {
                              // Nothing from an external private tenant should be searched
                              searchForResource(
                                publicTenant0.publicUser.restContext,
                                '_network',
                                privateTenant0.publicUser.user,
                                false,
                                () => {
                                  searchForResource(
                                    publicTenant0.publicUser.restContext,
                                    '_network',
                                    privateTenant0.loggedinUser.user,
                                    false,
                                    () => {
                                      searchForResource(
                                        publicTenant0.publicUser.restContext,
                                        '_network',
                                        privateTenant0.privateUser.user,
                                        false,
                                        () => {
                                          // Public and logged items from the current private tenant should be searched
                                          searchForResource(
                                            privateTenant0.publicUser.restContext,
                                            '_network',
                                            privateTenant0.publicUser.user,
                                            true,
                                            () => {
                                              searchForResource(
                                                privateTenant0.publicUser.restContext,
                                                '_network',
                                                privateTenant0.loggedinUser.user,
                                                true,
                                                () => {
                                                  searchForResource(
                                                    privateTenant0.publicUser.restContext,
                                                    '_network',
                                                    privateTenant0.privateUser.user,
                                                    false,
                                                    () => {
                                                      // Nothing from an external public tenant should be searched when searching from a private tenant
                                                      searchForResource(
                                                        privateTenant0.publicUser.restContext,
                                                        '_network',
                                                        publicTenant0.publicUser.user,
                                                        false,
                                                        () => {
                                                          searchForResource(
                                                            privateTenant0.publicUser.restContext,
                                                            '_network',
                                                            publicTenant0.loggedinUser.user,
                                                            false,
                                                            () => {
                                                              searchForResource(
                                                                privateTenant0.publicUser.restContext,
                                                                '_network',
                                                                publicTenant0.privateUser.user,
                                                                false,
                                                                () => {
                                                                  // Nothing from an external private tenant should be searched when searching from a private tenant
                                                                  searchForResource(
                                                                    privateTenant0.publicUser.restContext,
                                                                    '_network',
                                                                    privateTenant1.publicUser.user,
                                                                    false,
                                                                    () => {
                                                                      searchForResource(
                                                                        privateTenant0.publicUser.restContext,
                                                                        '_network',
                                                                        privateTenant1.loggedinUser.user,
                                                                        false,
                                                                        () => {
                                                                          searchForResource(
                                                                            privateTenant0.publicUser.restContext,
                                                                            '_network',
                                                                            privateTenant1.privateUser.user,
                                                                            false,
                                                                            () => {
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
      });
    });

    /**
     * Test that verifies that the _interact scope searches resources that the user can interact with only
     */
    it('verify the "interact" search scope searches only resources with which the user can interact', callback => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
        // Anonymous users cannot use the _interact scope without a 401 error
        SearchTestsUtil.searchRefreshed(
          publicTenant0.anonymousRestContext,
          'general',
          null,
          { scope: '_interact' },
          (err, results) => {
            assert.ok(err);
            assert.strictEqual(err.code, 401);

            // Public and loggedin items from the current public tenant should be searched
            searchForResource(
              publicTenant0.publicUser.restContext,
              '_interact',
              publicTenant0.publicUser.user,
              true,
              () => {
                searchForResource(
                  publicTenant0.publicUser.restContext,
                  '_interact',
                  publicTenant0.loggedinUser.user,
                  true,
                  () => {
                    searchForResource(
                      publicTenant0.publicUser.restContext,
                      '_interact',
                      publicTenant0.privateUser.user,
                      false,
                      () => {
                        // A private user cannot search themself for interaction
                        searchForResource(
                          publicTenant0.privateUser.restContext,
                          '_interact',
                          publicTenant0.privateUser.user,
                          false,
                          () => {
                            // Private joinable groups from the current tenant should be searched when searched with the tenant admin
                            searchForResource(
                              publicTenant0.adminRestContext,
                              '_interact',
                              publicTenant0.privateJoinableGroup,
                              true,
                              () => {
                                // Private joinable groups from the current tenant should not be searched when searched as a regular user
                                searchForResource(
                                  publicTenant0.publicUser.restContext,
                                  '_interact',
                                  publicTenant0.privateJoinableGroup,
                                  false,
                                  () => {
                                    // Sanity check that under _network search, the private joinable group does get searched when searching as a regular user
                                    searchForResource(
                                      publicTenant0.publicUser.restContext,
                                      '_network',
                                      publicTenant0.privateJoinableGroup,
                                      true,
                                      () => {
                                        // Only public items from another public tenant should be searched
                                        searchForResource(
                                          publicTenant0.publicUser.restContext,
                                          '_interact',
                                          publicTenant1.publicUser.user,
                                          true,
                                          () => {
                                            searchForResource(
                                              publicTenant0.publicUser.restContext,
                                              '_interact',
                                              publicTenant1.loggedinUser.user,
                                              false,
                                              () => {
                                                searchForResource(
                                                  publicTenant0.publicUser.restContext,
                                                  '_interact',
                                                  publicTenant1.privateUser.user,
                                                  false,
                                                  () => {
                                                    // Nothing from an external private tenant should be searched
                                                    searchForResource(
                                                      publicTenant0.publicUser.restContext,
                                                      '_interact',
                                                      privateTenant0.publicUser.user,
                                                      false,
                                                      () => {
                                                        searchForResource(
                                                          publicTenant0.publicUser.restContext,
                                                          '_interact',
                                                          privateTenant0.loggedinUser.user,
                                                          false,
                                                          () => {
                                                            searchForResource(
                                                              publicTenant0.publicUser.restContext,
                                                              '_interact',
                                                              privateTenant0.privateUser.user,
                                                              false,
                                                              () => {
                                                                // Public and logged items from the current private tenant should be searched
                                                                searchForResource(
                                                                  privateTenant0.publicUser.restContext,
                                                                  '_interact',
                                                                  privateTenant0.publicUser.user,
                                                                  true,
                                                                  () => {
                                                                    searchForResource(
                                                                      privateTenant0.publicUser.restContext,
                                                                      '_interact',
                                                                      privateTenant0.loggedinUser.user,
                                                                      true,
                                                                      () => {
                                                                        searchForResource(
                                                                          privateTenant0.publicUser.restContext,
                                                                          '_interact',
                                                                          privateTenant0.privateUser.user,
                                                                          false,
                                                                          () => {
                                                                            // Nothing from an external public tenant should be searched when searching from a private tenant
                                                                            searchForResource(
                                                                              privateTenant0.publicUser.restContext,
                                                                              '_interact',
                                                                              publicTenant0.publicUser.user,
                                                                              false,
                                                                              () => {
                                                                                searchForResource(
                                                                                  privateTenant0.publicUser.restContext,
                                                                                  '_interact',
                                                                                  publicTenant0.loggedinUser.user,
                                                                                  false,
                                                                                  () => {
                                                                                    searchForResource(
                                                                                      privateTenant0.publicUser
                                                                                        .restContext,
                                                                                      '_interact',
                                                                                      publicTenant0.privateUser.user,
                                                                                      false,
                                                                                      () => {
                                                                                        // Nothing from an external private tenant should be searched when searching from a private tenant
                                                                                        searchForResource(
                                                                                          privateTenant0.publicUser
                                                                                            .restContext,
                                                                                          '_interact',
                                                                                          privateTenant1.publicUser
                                                                                            .user,
                                                                                          false,
                                                                                          () => {
                                                                                            searchForResource(
                                                                                              privateTenant0.publicUser
                                                                                                .restContext,
                                                                                              '_interact',
                                                                                              privateTenant1
                                                                                                .loggedinUser.user,
                                                                                              false,
                                                                                              () => {
                                                                                                searchForResource(
                                                                                                  privateTenant0
                                                                                                    .publicUser
                                                                                                    .restContext,
                                                                                                  '_interact',
                                                                                                  privateTenant1
                                                                                                    .privateUser.user,
                                                                                                  false,
                                                                                                  () => {
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

    /**
     * Test that verifies that the _my scope searches resources from inside the current tenant only
     */
    it('verify the _my search scope searches only items to which the current user is explicitly associated', callback => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
        // Make the public user from publicTenant0 a member of a couple of the groups so we
        // can test explicit access
        const memberUpdate = _.oaeObj(publicTenant0.publicUser.user.id, 'member');
        PrincipalsTestUtil.assertSetGroupMembersSucceeds(
          publicTenant1.adminRestContext,
          publicTenant1.adminRestContext,
          publicTenant1.publicGroup.id,
          memberUpdate,
          () => {
            PrincipalsTestUtil.assertSetGroupMembersSucceeds(
              publicTenant0.adminRestContext,
              publicTenant0.adminRestContext,
              publicTenant0.privateNotJoinableGroup.id,
              memberUpdate,
              () => {
                // Items from the current tenant that are not explicitly associated to the current user should not be returned
                searchForResource(
                  publicTenant0.publicUser.restContext,
                  '_my',
                  publicTenant0.publicUser.user,
                  false,
                  () => {
                    searchForResource(
                      publicTenant0.publicUser.restContext,
                      '_my',
                      publicTenant0.loggedinUser.user,
                      false,
                      () => {
                        searchForResource(
                          publicTenant0.publicUser.restContext,
                          '_my',
                          publicTenant0.privateUser.user,
                          false,
                          () => {
                            searchForResource(
                              publicTenant0.publicUser.restContext,
                              '_my',
                              publicTenant0.loggedinNotJoinableGroup,
                              false,
                              () => {
                                searchForResource(
                                  publicTenant0.publicUser.restContext,
                                  '_my',
                                  publicTenant1.publicUser.user,
                                  false,
                                  () => {
                                    searchForResource(
                                      publicTenant0.publicUser.restContext,
                                      '_my',
                                      publicTenant1.loggedinUser.user,
                                      false,
                                      () => {
                                        searchForResource(
                                          publicTenant0.publicUser.restContext,
                                          '_my',
                                          publicTenant1.privateUser.user,
                                          false,
                                          () => {
                                            searchForResource(
                                              publicTenant0.publicUser.restContext,
                                              '_my',
                                              privateTenant0.publicUser.user,
                                              false,
                                              () => {
                                                searchForResource(
                                                  publicTenant0.publicUser.restContext,
                                                  '_my',
                                                  privateTenant0.loggedinUser.user,
                                                  false,
                                                  () => {
                                                    searchForResource(
                                                      publicTenant0.publicUser.restContext,
                                                      '_my',
                                                      privateTenant0.privateUser.user,
                                                      false,
                                                      () => {
                                                        // The external public group and local public, private groups to which the user is associated should be returned
                                                        searchForResource(
                                                          publicTenant0.publicUser.restContext,
                                                          '_my',
                                                          publicTenant0.publicGroup,
                                                          true,
                                                          () => {
                                                            searchForResource(
                                                              publicTenant0.publicUser.restContext,
                                                              '_my',
                                                              publicTenant0.privateNotJoinableGroup,
                                                              true,
                                                              () => {
                                                                searchForResource(
                                                                  publicTenant0.publicUser.restContext,
                                                                  '_my',
                                                                  publicTenant1.publicGroup,
                                                                  true,
                                                                  () => {
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

    /**
     * Test that verifies that scoping by a specific tenant results in only resources from that tenant being searched
     */
    it('verify that scoping general search to a tenant alias only searches resources in that tenant', callback => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
        // Make the public user from publicTenant0 a member of the public group from publicTenant1 so we can test explicit access
        const memberUpdate = {};
        memberUpdate[publicTenant0.publicUser.user.id] = 'member';
        RestAPI.Group.setGroupMembers(
          publicTenant1.adminRestContext,
          publicTenant1.publicGroup.id,
          memberUpdate,
          err => {
            assert.ok(!err);

            // Public and loggedin items from the specified tenant should be returned
            searchForResource(
              publicTenant0.publicUser.restContext,
              publicTenant0.tenant.alias,
              publicTenant0.publicUser.user,
              true,
              () => {
                searchForResource(
                  publicTenant0.publicUser.restContext,
                  publicTenant0.tenant.alias,
                  publicTenant0.loggedinUser.user,
                  true,
                  () => {
                    searchForResource(
                      publicTenant0.publicUser.restContext,
                      publicTenant0.tenant.alias,
                      publicTenant0.privateUser.user,
                      false,
                      () => {
                        // The public group nor other resources from the other public tenant should be returned even when we have explicit access
                        searchForResource(
                          publicTenant0.publicUser.restContext,
                          publicTenant0.tenant.alias,
                          publicTenant1.publicGroup,
                          false,
                          () => {
                            searchForResource(
                              publicTenant0.publicUser.restContext,
                              publicTenant0.tenant.alias,
                              publicTenant1.publicUser.user,
                              false,
                              () => {
                                searchForResource(
                                  publicTenant0.publicUser.restContext,
                                  publicTenant0.tenant.alias,
                                  publicTenant1.loggedinUser.user,
                                  false,
                                  () => {
                                    searchForResource(
                                      publicTenant0.publicUser.restContext,
                                      publicTenant0.tenant.alias,
                                      publicTenant1.privateUser.user,
                                      false,
                                      () => {
                                        // Resources from the current tenant should not be searched when specifying another tenant
                                        searchForResource(
                                          publicTenant0.publicUser.restContext,
                                          publicTenant1.tenant.alias,
                                          publicTenant0.publicUser.user,
                                          false,
                                          () => {
                                            searchForResource(
                                              publicTenant0.publicUser.restContext,
                                              publicTenant1.tenant.alias,
                                              publicTenant0.loggedinUser.user,
                                              false,
                                              () => {
                                                searchForResource(
                                                  publicTenant0.publicUser.restContext,
                                                  publicTenant1.tenant.alias,
                                                  publicTenant0.privateUser.user,
                                                  false,
                                                  () => {
                                                    // Resources from a different specified tenant should be searched when it is specified
                                                    searchForResource(
                                                      publicTenant0.publicUser.restContext,
                                                      publicTenant1.tenant.alias,
                                                      publicTenant1.publicUser.user,
                                                      true,
                                                      () => {
                                                        searchForResource(
                                                          publicTenant0.publicUser.restContext,
                                                          publicTenant1.tenant.alias,
                                                          publicTenant1.loggedinUser.user,
                                                          false,
                                                          () => {
                                                            searchForResource(
                                                              publicTenant0.publicUser.restContext,
                                                              publicTenant1.tenant.alias,
                                                              publicTenant1.privateUser.user,
                                                              false,
                                                              () => {
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

  describe('Content Search', () => {
    /**
     * Test that verifies deleted content is removed from the search index.
     */
    it('verify deleted content is unsearchable', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, doer) => {
        assert.ok(!err);

        const uniqueString = TestsUtil.generateTestUserId('unsearchable-content');
        RestAPI.Content.createLink(
          doer.restContext,
          uniqueString,
          uniqueString,
          'public',
          'http://www.oaeproject.org',
          [],
          [],
          [],
          (err, content) => {
            assert.ok(!err);

            // Verify search term Apereo does not match the content
            SearchTestsUtil.searchRefreshed(
              doer.restContext,
              'general',
              null,
              { resourceTypes: 'content', q: uniqueString },
              (err, results) => {
                assert.ok(!err);
                assert.ok(_getDocById(results, content.id));

                RestAPI.Content.deleteContent(doer.restContext, content.id, err => {
                  assert.ok(!err);

                  SearchTestsUtil.searchRefreshed(
                    doer.restContext,
                    'general',
                    null,
                    { resourceTypes: 'content', q: uniqueString },
                    (err, results) => {
                      assert.ok(!err);
                      assert.ok(!_getDocById(results, content.id));
                      return callback();
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
     * Test that verifies that public content is searchable by all users.
     */
    it('verify public content searchable by everyone', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, doer, jack, jane) => {
        assert.ok(!err);

        TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users, darthVader) => {
          assert.ok(!err);

          TestsUtil.generateTestGroups(doer.restContext, 5, function(...args) {
            const groupIds = _.chain(args)
              .pluck('group')
              .pluck('id')
              .value();

            // Give jack access via group
            TestsUtil.generateGroupHierarchy(doer.restContext, groupIds, 'member', err => {
              assert.ok(!err);

              TestsUtil.generateGroupHierarchy(doer.restContext, [groupIds[4], jack.user.id], 'member', err => {
                assert.ok(!err);

                const uniqueString = TestsUtil.generateTestUserId('public-searchable-content');
                RestAPI.Content.createLink(
                  doer.restContext,
                  uniqueString,
                  'Test content description 1',
                  'public',
                  'http://www.oaeproject.org/',
                  [],
                  [groupIds[0]],
                  [],
                  (err, contentObj) => {
                    assert.ok(!err);

                    // Verify anonymous can see it
                    SearchTestsUtil.searchRefreshed(
                      anonymousRestContext,
                      'general',
                      null,
                      { q: uniqueString },
                      (err, results) => {
                        assert.ok(!err);

                        const contentDoc = _getDocById(results, contentObj.id);
                        assert.ok(contentDoc);
                        assert.strictEqual(contentDoc.resourceSubType, 'link');
                        assert.strictEqual(contentDoc.displayName, contentObj.displayName);
                        assert.strictEqual(contentDoc.tenantAlias, 'camtest');
                        assert.strictEqual(contentDoc.visibility, contentObj.visibility);
                        assert.strictEqual(contentDoc.resourceType, 'content');
                        assert.strictEqual(
                          contentDoc.profilePath,
                          '/content/' +
                            contentObj.tenant.alias +
                            '/' +
                            AuthzUtil.getResourceFromId(contentObj.id).resourceId
                        );
                        assert.strictEqual(contentDoc.id, contentObj.id);
                        assert.strictEqual(contentDoc._extra, undefined);
                        assert.strictEqual(contentDoc._type, undefined);
                        assert.strictEqual(contentDoc.q_high, undefined);
                        assert.strictEqual(contentDoc.q_low, undefined);
                        assert.strictEqual(contentDoc.sort, undefined);

                        // Verify tenant admin can see it
                        SearchTestsUtil.searchRefreshed(
                          camAdminRestContext,
                          'general',
                          null,
                          { q: uniqueString },
                          (err, results) => {
                            assert.ok(!err);

                            const contentDoc = _getDocById(results, contentObj.id);
                            assert.ok(contentDoc);
                            assert.strictEqual(contentDoc.resourceSubType, 'link');
                            assert.strictEqual(contentDoc.displayName, contentObj.displayName);
                            assert.strictEqual(contentDoc.tenantAlias, contentObj.tenant.alias);
                            assert.strictEqual(contentDoc.visibility, contentObj.visibility);
                            assert.strictEqual(contentDoc.resourceType, 'content');
                            assert.strictEqual(
                              contentDoc.profilePath,
                              '/content/' +
                                contentObj.tenant.alias +
                                '/' +
                                AuthzUtil.getResourceFromId(contentObj.id).resourceId
                            );
                            assert.strictEqual(contentDoc.id, contentObj.id);
                            assert.strictEqual(contentDoc._extra, undefined);
                            assert.strictEqual(contentDoc._type, undefined);
                            assert.strictEqual(contentDoc.q_high, undefined);
                            assert.strictEqual(contentDoc.q_low, undefined);
                            assert.strictEqual(contentDoc.sort, undefined);

                            // Verify same-tenant loggedin user can see it
                            SearchTestsUtil.searchRefreshed(
                              jane.restContext,
                              'general',
                              null,
                              { q: uniqueString },
                              (err, results) => {
                                assert.ok(!err);

                                const contentDoc = _getDocById(results, contentObj.id);
                                assert.ok(contentDoc);
                                assert.strictEqual(contentDoc.resourceSubType, 'link');
                                assert.strictEqual(contentDoc.displayName, contentObj.displayName);
                                assert.strictEqual(contentDoc.tenantAlias, contentObj.tenant.alias);
                                assert.strictEqual(contentDoc.visibility, contentObj.visibility);
                                assert.strictEqual(contentDoc.resourceType, 'content');
                                assert.strictEqual(
                                  contentDoc.profilePath,
                                  '/content/' +
                                    contentObj.tenant.alias +
                                    '/' +
                                    AuthzUtil.getResourceFromId(contentObj.id).resourceId
                                );
                                assert.strictEqual(contentDoc.id, contentObj.id);
                                assert.strictEqual(contentDoc._extra, undefined);
                                assert.strictEqual(contentDoc._type, undefined);
                                assert.strictEqual(contentDoc.q_high, undefined);
                                assert.strictEqual(contentDoc.q_low, undefined);
                                assert.strictEqual(contentDoc.sort, undefined);

                                // Verify same-tenant loggedin user can see it
                                SearchTestsUtil.searchRefreshed(
                                  jane.restContext,
                                  'general',
                                  null,
                                  { q: uniqueString },
                                  (err, results) => {
                                    assert.ok(!err);

                                    const contentDoc = _getDocById(results, contentObj.id);
                                    assert.ok(contentDoc);
                                    assert.strictEqual(contentDoc.resourceSubType, 'link');
                                    assert.strictEqual(contentDoc.displayName, contentObj.displayName);
                                    assert.strictEqual(contentDoc.tenantAlias, contentObj.tenant.alias);
                                    assert.strictEqual(contentDoc.visibility, contentObj.visibility);
                                    assert.strictEqual(contentDoc.resourceType, 'content');
                                    assert.strictEqual(
                                      contentDoc.profilePath,
                                      '/content/' +
                                        contentObj.tenant.alias +
                                        '/' +
                                        AuthzUtil.getResourceFromId(contentObj.id).resourceId
                                    );
                                    assert.strictEqual(contentDoc.id, contentObj.id);
                                    assert.strictEqual(contentDoc._extra, undefined);
                                    assert.strictEqual(contentDoc._type, undefined);
                                    assert.strictEqual(contentDoc.q_high, undefined);
                                    assert.strictEqual(contentDoc.q_low, undefined);
                                    assert.strictEqual(contentDoc.sort, undefined);

                                    // Verify permitted user can see it
                                    SearchTestsUtil.searchRefreshed(
                                      jack.restContext,
                                      'general',
                                      null,
                                      { q: uniqueString },
                                      (err, results) => {
                                        assert.ok(!err);

                                        const contentDoc = _getDocById(results, contentObj.id);
                                        assert.ok(contentDoc);
                                        assert.strictEqual(contentDoc.resourceSubType, 'link');
                                        assert.strictEqual(contentDoc.displayName, contentObj.displayName);
                                        assert.strictEqual(contentDoc.tenantAlias, contentObj.tenant.alias);
                                        assert.strictEqual(contentDoc.visibility, contentObj.visibility);
                                        assert.strictEqual(contentDoc.resourceType, 'content');
                                        assert.strictEqual(
                                          contentDoc.profilePath,
                                          '/content/' +
                                            contentObj.tenant.alias +
                                            '/' +
                                            AuthzUtil.getResourceFromId(contentObj.id).resourceId
                                        );
                                        assert.strictEqual(contentDoc.id, contentObj.id);
                                        assert.strictEqual(contentDoc._extra, undefined);
                                        assert.strictEqual(contentDoc._type, undefined);
                                        assert.strictEqual(contentDoc.q_high, undefined);
                                        assert.strictEqual(contentDoc.q_low, undefined);
                                        assert.strictEqual(contentDoc.sort, undefined);

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
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies loggedin content items are only search by users authenticated to the content item's parent tenant.
     */
    it('verify loggedin content search not searchable by anonymous or cross-tenant', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, doer, jack, jane) => {
        assert.ok(!err);

        TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users, darthVader) => {
          assert.ok(!err);

          TestsUtil.generateTestGroups(doer.restContext, 5, function(...args) {
            const groupIds = _.chain(args)
              .pluck('group')
              .pluck('id')
              .value();

            // Give jack access via group
            TestsUtil.generateGroupHierarchy(doer.restContext, groupIds, 'member', err => {
              assert.ok(!err);

              TestsUtil.generateGroupHierarchy(doer.restContext, [groupIds[4], jack.user.id], 'member', err => {
                assert.ok(!err);

                const beforeCreated = Date.now();
                const uniqueString = TestsUtil.generateTestUserId('loggedin-searchable-content');
                RestAPI.Content.createLink(
                  doer.restContext,
                  uniqueString,
                  'Test content description 1',
                  'loggedin',
                  'http://www.oaeproject.org/',
                  [],
                  [groupIds[0]],
                  [],
                  (err, contentObj) => {
                    assert.ok(!err);

                    // Verify anonymous cannot see it
                    SearchTestsUtil.searchRefreshed(
                      anonymousRestContext,
                      'general',
                      null,
                      { q: uniqueString },
                      (err, results) => {
                        assert.ok(!err);
                        assert.ok(!_getDocById(results, contentObj.id));

                        // Verify cross-tenant user cannot see it
                        SearchTestsUtil.searchRefreshed(
                          darthVader.restContext,
                          'general',
                          null,
                          { q: uniqueString, scope: '_network' },
                          (err, results) => {
                            assert.ok(!err);
                            assert.ok(!_getDocById(results, contentObj.id));

                            // Verify tenant admin can see it
                            SearchTestsUtil.searchRefreshed(
                              camAdminRestContext,
                              'general',
                              null,
                              { q: uniqueString },
                              (err, results) => {
                                assert.ok(!err);

                                const contentDoc = _getDocById(results, contentObj.id);
                                assert.ok(contentDoc);
                                assert.strictEqual(contentDoc.resourceSubType, 'link');
                                assert.strictEqual(contentDoc.displayName, contentObj.displayName);
                                assert.strictEqual(contentDoc.tenantAlias, contentObj.tenant.alias);
                                assert.strictEqual(contentDoc.visibility, contentObj.visibility);
                                assert.strictEqual(contentDoc.resourceType, 'content');
                                assert.strictEqual(
                                  contentDoc.profilePath,
                                  '/content/' +
                                    contentObj.tenant.alias +
                                    '/' +
                                    AuthzUtil.getResourceFromId(contentObj.id).resourceId
                                );
                                assert.strictEqual(contentDoc.id, contentObj.id);
                                assert.strictEqual(contentDoc._extra, undefined);
                                assert.strictEqual(contentDoc._type, undefined);
                                assert.strictEqual(contentDoc.q_high, undefined);
                                assert.strictEqual(contentDoc.q_low, undefined);
                                assert.strictEqual(contentDoc.sort, undefined);

                                // Since lastModified time gets updated for more than just profile
                                // updates (e.g., share, library updates, etc...), we should just
                                // sanity check the lastModified in th search doc
                                assert.ok(parseInt(contentDoc.lastModified) >= beforeCreated);

                                // Verify same-tenant loggedin user can see it
                                SearchTestsUtil.searchRefreshed(
                                  jane.restContext,
                                  'general',
                                  null,
                                  { q: uniqueString },
                                  (err, results) => {
                                    assert.ok(!err);

                                    const contentDoc = _getDocById(results, contentObj.id);
                                    assert.ok(contentDoc);
                                    assert.strictEqual(contentDoc.resourceSubType, 'link');
                                    assert.strictEqual(contentDoc.displayName, contentObj.displayName);
                                    assert.strictEqual(contentDoc.tenantAlias, contentObj.tenant.alias);
                                    assert.strictEqual(contentDoc.visibility, contentObj.visibility);
                                    assert.strictEqual(contentDoc.resourceType, 'content');
                                    assert.strictEqual(
                                      contentDoc.profilePath,
                                      '/content/' +
                                        contentObj.tenant.alias +
                                        '/' +
                                        AuthzUtil.getResourceFromId(contentObj.id).resourceId
                                    );
                                    assert.strictEqual(contentDoc.id, contentObj.id);
                                    assert.strictEqual(contentDoc._extra, undefined);
                                    assert.strictEqual(contentDoc._type, undefined);
                                    assert.strictEqual(contentDoc.q_high, undefined);
                                    assert.strictEqual(contentDoc.q_low, undefined);
                                    assert.strictEqual(contentDoc.sort, undefined);

                                    // Since lastModified time gets updated for more than just profile
                                    // updates (e.g., share, library updates, etc...), we should just
                                    // sanity check the lastModified in th search doc
                                    assert.ok(parseInt(contentDoc.lastModified) >= beforeCreated);

                                    // Verify permitted user can see it
                                    SearchTestsUtil.searchRefreshed(
                                      jack.restContext,
                                      'general',
                                      null,
                                      { q: uniqueString },
                                      (err, results) => {
                                        assert.ok(!err);
                                        assert.ok(_getDocById(results, contentObj.id));

                                        const contentDoc = _getDocById(results, contentObj.id);
                                        assert.ok(contentDoc);
                                        assert.strictEqual(contentDoc.resourceSubType, 'link');
                                        assert.strictEqual(contentDoc.displayName, contentObj.displayName);
                                        assert.strictEqual(contentDoc.tenantAlias, contentObj.tenant.alias);
                                        assert.strictEqual(contentDoc.visibility, contentObj.visibility);
                                        assert.strictEqual(contentDoc.resourceType, 'content');
                                        assert.strictEqual(
                                          contentDoc.profilePath,
                                          '/content/' +
                                            contentObj.tenant.alias +
                                            '/' +
                                            AuthzUtil.getResourceFromId(contentObj.id).resourceId
                                        );
                                        assert.strictEqual(contentDoc.id, contentObj.id);
                                        assert.strictEqual(contentDoc._extra, undefined);
                                        assert.strictEqual(contentDoc._type, undefined);
                                        assert.strictEqual(contentDoc.q_high, undefined);
                                        assert.strictEqual(contentDoc.q_low, undefined);
                                        assert.strictEqual(contentDoc.sort, undefined);

                                        // Since lastModified time gets updated for more than just profile
                                        // updates (e.g., share, library updates, etc...), we should just
                                        // sanity check the lastModified in th search doc
                                        assert.ok(parseInt(contentDoc.lastModified) >= beforeCreated);

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
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that private content is not searchable by anyone but admins and members.
     */
    it('verify private content search not searchable by anyone but admin and privileged users', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, doer, jack, jane) => {
        assert.ok(!err);

        TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users, darthVader) => {
          assert.ok(!err);

          TestsUtil.generateTestGroups(doer.restContext, 5, function(...args) {
            const groupIds = _.chain(args)
              .pluck('group')
              .pluck('id')
              .value();

            // Give jack access via group
            TestsUtil.generateGroupHierarchy(doer.restContext, groupIds, 'member', err => {
              assert.ok(!err);

              TestsUtil.generateGroupHierarchy(doer.restContext, [groupIds[4], jack.user.id], 'member', err => {
                assert.ok(!err);

                const beforeCreated = Date.now();
                const uniqueString = TestsUtil.generateTestUserId('private-searchable-content');
                RestAPI.Content.createLink(
                  doer.restContext,
                  uniqueString,
                  'Test content description 1',
                  'private',
                  'http://www.oaeproject.org/',
                  [],
                  [groupIds[0]],
                  [],
                  (err, contentObj) => {
                    assert.ok(!err);

                    // Verify anonymous cannot see it
                    SearchTestsUtil.searchRefreshed(
                      anonymousRestContext,
                      'general',
                      null,
                      { q: uniqueString },
                      (err, results) => {
                        assert.ok(!err);
                        assert.ok(!_getDocById(results, contentObj.id));

                        // Verify cross-tenant user cannot see it
                        SearchTestsUtil.searchRefreshed(
                          darthVader.restContext,
                          'general',
                          null,
                          { q: uniqueString, scope: '_network' },
                          (err, results) => {
                            assert.ok(!err);
                            assert.ok(!_getDocById(results, contentObj.id));

                            // Verify tenant admin can see it
                            SearchTestsUtil.searchRefreshed(
                              camAdminRestContext,
                              'general',
                              null,
                              { q: uniqueString },
                              (err, results) => {
                                assert.ok(!err);

                                const contentDoc = _getDocById(results, contentObj.id);
                                assert.ok(contentDoc);
                                assert.strictEqual(contentDoc.resourceSubType, 'link');
                                assert.strictEqual(contentDoc.displayName, contentObj.displayName);
                                assert.strictEqual(contentDoc.tenantAlias, contentObj.tenant.alias);
                                assert.strictEqual(contentDoc.visibility, contentObj.visibility);
                                assert.strictEqual(contentDoc.resourceType, 'content');
                                assert.strictEqual(
                                  contentDoc.profilePath,
                                  '/content/' +
                                    contentObj.tenant.alias +
                                    '/' +
                                    AuthzUtil.getResourceFromId(contentObj.id).resourceId
                                );
                                assert.strictEqual(contentDoc.id, contentObj.id);
                                assert.strictEqual(contentDoc._extra, undefined);
                                assert.strictEqual(contentDoc._type, undefined);
                                assert.strictEqual(contentDoc.q_high, undefined);
                                assert.strictEqual(contentDoc.q_low, undefined);
                                assert.strictEqual(contentDoc.sort, undefined);

                                // Since lastModified time gets updated for more than just profile
                                // updates (e.g., share, library updates, etc...), we should just
                                // sanity check the lastModified in th search doc
                                assert.ok(parseInt(contentDoc.lastModified) >= beforeCreated);

                                // Verify same-tenant loggedin user cannot see it
                                SearchTestsUtil.searchRefreshed(
                                  jane.restContext,
                                  'general',
                                  null,
                                  { q: uniqueString },
                                  (err, results) => {
                                    assert.ok(!err);
                                    assert.ok(!_getDocById(results, contentObj.id));

                                    // Verify permitted user can see it
                                    SearchTestsUtil.searchRefreshed(
                                      jack.restContext,
                                      'general',
                                      null,
                                      { q: uniqueString },
                                      (err, results) => {
                                        assert.ok(!err);

                                        const contentDoc = _getDocById(results, contentObj.id);
                                        assert.ok(contentDoc);
                                        assert.strictEqual(contentDoc.resourceSubType, 'link');
                                        assert.strictEqual(contentDoc.displayName, contentObj.displayName);
                                        assert.strictEqual(contentDoc.tenantAlias, contentObj.tenant.alias);
                                        assert.strictEqual(contentDoc.visibility, contentObj.visibility);
                                        assert.strictEqual(contentDoc.resourceType, 'content');
                                        assert.strictEqual(
                                          contentDoc.profilePath,
                                          '/content/' +
                                            contentObj.tenant.alias +
                                            '/' +
                                            AuthzUtil.getResourceFromId(contentObj.id).resourceId
                                        );
                                        assert.strictEqual(contentDoc.id, contentObj.id);
                                        assert.strictEqual(contentDoc._extra, undefined);
                                        assert.strictEqual(contentDoc._type, undefined);
                                        assert.strictEqual(contentDoc.q_high, undefined);
                                        assert.strictEqual(contentDoc.q_low, undefined);
                                        assert.strictEqual(contentDoc.sort, undefined);

                                        // Since lastModified time gets updated for more than just profile
                                        // updates (e.g., share, library updates, etc...), we should just
                                        // sanity check the lastModified in th search doc
                                        assert.ok(parseInt(contentDoc.lastModified) >= beforeCreated);

                                        // Verify global admin on a different tenant can see it
                                        SearchTestsUtil.searchRefreshed(
                                          globalAdminOnTenantRestContext,
                                          'general',
                                          null,
                                          { q: uniqueString, scope: '_network' },
                                          (err, results) => {
                                            assert.ok(!err);

                                            const contentDoc = _getDocById(results, contentObj.id);
                                            assert.ok(contentDoc);
                                            assert.strictEqual(contentDoc.resourceSubType, 'link');
                                            assert.strictEqual(contentDoc.displayName, contentObj.displayName);
                                            assert.strictEqual(contentDoc.tenantAlias, contentObj.tenant.alias);
                                            assert.strictEqual(contentDoc.visibility, contentObj.visibility);
                                            assert.strictEqual(contentDoc.resourceType, 'content');
                                            assert.strictEqual(
                                              contentDoc.profilePath,
                                              '/content/' +
                                                contentObj.tenant.alias +
                                                '/' +
                                                AuthzUtil.getResourceFromId(contentObj.id).resourceId
                                            );
                                            assert.strictEqual(contentDoc.id, contentObj.id);
                                            assert.strictEqual(contentDoc._extra, undefined);
                                            assert.strictEqual(contentDoc._type, undefined);
                                            assert.strictEqual(contentDoc.q_high, undefined);
                                            assert.strictEqual(contentDoc.q_low, undefined);
                                            assert.strictEqual(contentDoc.sort, undefined);

                                            // Since lastModified time gets updated for more than just profile
                                            // updates (e.g., share, library updates, etc...), we should just
                                            // sanity check the lastModified in th search doc
                                            assert.ok(parseInt(contentDoc.lastModified) >= beforeCreated);

                                            // Generate a new group, make Jack a member of it, create a piece of content and
                                            // share it with the group. All of this is done so we can check the direct membership
                                            // filter is NOT cached
                                            TestsUtil.generateTestGroups(doer.restContext, 1, anotherGroup => {
                                              const permissions = {};
                                              permissions[jack.user.id] = 'member';
                                              RestAPI.Group.setGroupMembers(
                                                doer.restContext,
                                                anotherGroup.group.id,
                                                permissions,
                                                err => {
                                                  assert.ok(!err);

                                                  RestAPI.Content.createLink(
                                                    doer.restContext,
                                                    uniqueString,
                                                    'Test content description 2',
                                                    'private',
                                                    'http://www.oaeproject.org/',
                                                    [],
                                                    [anotherGroup.group.id],
                                                    [],
                                                    (err, link2) => {
                                                      assert.ok(!err);

                                                      SearchTestsUtil.searchRefreshed(
                                                        jack.restContext,
                                                        'general',
                                                        null,
                                                        { q: uniqueString },
                                                        (err, results) => {
                                                          assert.ok(!err);

                                                          const contentDoc = _getDocById(results, link2.id);
                                                          assert.ok(contentDoc);
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
          });
        });
      });
    });

    /**
     * Test that verifies when a user has access to a content item VIA direct group membership, the content item
     * can be queried in search
     */
    it('verify private content item is searchable when access is granted by direct group membership', callback => {
      const uniqueString = TestsUtil.generateRandomText(5);
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, mrvisser, simong) => {
        assert.ok(!err);
        TestsUtil.generateTestGroups(mrvisser.restContext, 1, group => {
          const update = {};
          update[simong.user.id] = 'member';
          RestAPI.Group.setGroupMembers(mrvisser.restContext, group.group.id, update, err => {
            assert.ok(!err);

            // Create a private content item to which only the group has access
            RestAPI.Content.createLink(
              camAdminRestContext,
              uniqueString,
              'Test content description 1',
              'private',
              'http://www.oaeproject.org/',
              [],
              [group.group.id],
              [],
              (err, content) => {
                assert.ok(!err);

                SearchTestsUtil.searchRefreshed(
                  mrvisser.restContext,
                  'general',
                  null,
                  { q: uniqueString, scope: '_network' },
                  (err, results) => {
                    assert.ok(!err);
                    assert.ok(_getDocById(results, content.id));
                    SearchTestsUtil.searchRefreshed(
                      simong.restContext,
                      'general',
                      null,
                      { q: uniqueString, scope: '_network' },
                      (err, results) => {
                        assert.ok(!err);
                        assert.ok(_getDocById(results, content.id));
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
  });

  describe('User Search Visibility', () => {
    /**
     * Test that verifies public user search results are not hidden from anyone.
     */
    it('verify public user profile visible to everyone', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
        assert.ok(!err);

        TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users, darthVader) => {
          assert.ok(!err);

          const jackOpts = {
            visibility: 'public',
            publicAlias: 'I was hidden'
          };
          RestAPI.User.updateUser(jack.restContext, jack.user.id, jackOpts, (err, jackUser) => {
            assert.ok(!err);
            jack.user = jackUser;

            // Verify hidden for cross-tenant user on internal search
            SearchTestsUtil.searchRefreshed(
              darthVader.restContext,
              'general',
              null,
              {
                resourceTypes: 'user',
                q: jack.user.displayName,
                scope: global.oaeTests.tenants.gt.alias
              },
              (err, results) => {
                assert.ok(!err);
                const jackDoc = _getDocById(results, jack.user.id);
                assert.ok(!jackDoc);

                // Verify visible for cross-tenant user on external search
                SearchTestsUtil.searchRefreshed(
                  darthVader.restContext,
                  'general',
                  null,
                  { resourceTypes: 'user', q: jack.user.displayName, scope: '_network' },
                  (err, results) => {
                    assert.ok(!err);
                    const jackDoc = _getDocById(results, jack.user.id);
                    assert.ok(jackDoc);
                    assert.strictEqual(jackDoc.id, jack.user.id);
                    assert.strictEqual(jackDoc.resourceType, 'user');
                    assert.strictEqual(
                      jackDoc.profilePath,
                      '/user/' + jackDoc.tenant.alias + '/' + AuthzUtil.getResourceFromId(jackDoc.id).resourceId
                    );
                    assert.strictEqual(jackDoc.tenantAlias, jack.user.tenant.alias);
                    assert.strictEqual(jackDoc.displayName, jack.user.displayName);
                    assert.strictEqual(jackDoc.visibility, jack.user.visibility);
                    assert.strictEqual(jackDoc._extra, undefined);
                    assert.strictEqual(jackDoc.extra, undefined);
                    assert.strictEqual(jackDoc.q_high, undefined);
                    assert.strictEqual(jackDoc.q_low, undefined);
                    assert.strictEqual(jackDoc.sort, undefined);
                    assert.strictEqual(jackDoc._type, undefined);

                    // Verify not hidden for anonymous
                    SearchTestsUtil.searchRefreshed(
                      anonymousRestContext,
                      'general',
                      null,
                      { resourceTypes: 'user', q: jack.user.displayName },
                      (err, results) => {
                        assert.ok(!err);
                        const jackDoc = _getDocById(results, jack.user.id);
                        assert.ok(jackDoc);
                        assert.strictEqual(jackDoc.id, jack.user.id);
                        assert.strictEqual(jackDoc.resourceType, 'user');
                        assert.strictEqual(
                          jackDoc.profilePath,
                          '/user/' + jackDoc.tenant.alias + '/' + AuthzUtil.getResourceFromId(jackDoc.id).resourceId
                        );
                        assert.strictEqual(jackDoc.tenantAlias, jack.user.tenant.alias);
                        assert.strictEqual(jackDoc.displayName, jack.user.displayName);
                        assert.strictEqual(jackDoc.visibility, jack.user.visibility);
                        assert.strictEqual(jackDoc._extra, undefined);
                        assert.strictEqual(jackDoc.extra, undefined);
                        assert.strictEqual(jackDoc.q_high, undefined);
                        assert.strictEqual(jackDoc.q_low, undefined);
                        assert.strictEqual(jackDoc.sort, undefined);
                        assert.strictEqual(jackDoc._type, undefined);

                        // Verify not hidden for other in-tenant loggedin user
                        SearchTestsUtil.searchRefreshed(
                          jane.restContext,
                          'general',
                          null,
                          { resourceTypes: 'user', q: jack.user.displayName },
                          (err, results) => {
                            assert.ok(!err);
                            const jackDoc = _getDocById(results, jack.user.id);
                            assert.ok(jackDoc);
                            assert.strictEqual(jackDoc.id, jack.user.id);
                            assert.strictEqual(jackDoc.resourceType, 'user');
                            assert.strictEqual(
                              jackDoc.profilePath,
                              '/user/' + jackDoc.tenant.alias + '/' + AuthzUtil.getResourceFromId(jackDoc.id).resourceId
                            );
                            assert.strictEqual(jackDoc.tenantAlias, jack.user.tenant.alias);
                            assert.strictEqual(jackDoc.displayName, jack.user.displayName);
                            assert.strictEqual(jackDoc.visibility, jack.user.visibility);
                            assert.strictEqual(jackDoc._extra, undefined);
                            assert.strictEqual(jackDoc.extra, undefined);
                            assert.strictEqual(jackDoc.q_high, undefined);
                            assert.strictEqual(jackDoc.q_low, undefined);
                            assert.strictEqual(jackDoc.sort, undefined);
                            assert.strictEqual(jackDoc._type, undefined);

                            // Verify not hidden for admin
                            SearchTestsUtil.searchRefreshed(
                              camAdminRestContext,
                              'general',
                              null,
                              { resourceTypes: 'user', q: jack.user.displayName },
                              (err, results) => {
                                assert.ok(!err);
                                const jackDoc = _getDocById(results, jack.user.id);
                                assert.ok(jackDoc);
                                assert.strictEqual(jackDoc.id, jack.user.id);
                                assert.strictEqual(jackDoc.resourceType, 'user');
                                assert.strictEqual(
                                  jackDoc.profilePath,
                                  '/user/' +
                                    jackDoc.tenant.alias +
                                    '/' +
                                    AuthzUtil.getResourceFromId(jackDoc.id).resourceId
                                );
                                assert.strictEqual(jackDoc.tenantAlias, jack.user.tenant.alias);
                                assert.strictEqual(jackDoc.displayName, jack.user.displayName);
                                assert.strictEqual(jackDoc.visibility, jack.user.visibility);
                                assert.strictEqual(jackDoc._extra, undefined);
                                assert.strictEqual(jackDoc.extra, undefined);
                                assert.strictEqual(jackDoc.q_high, undefined);
                                assert.strictEqual(jackDoc.q_low, undefined);
                                assert.strictEqual(jackDoc.sort, undefined);
                                assert.strictEqual(jackDoc._type, undefined);

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
    });

    /**
     * Test that verifies loggedin user search results are hidden to users who are not authenticated to the user's tenant
     */
    it('verify loggedin user profile not visibile cross-tenant or to anonymous', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
        assert.ok(!err);

        TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users, darthVader) => {
          assert.ok(!err);

          const jackOpts = {
            visibility: 'loggedin',
            publicAlias: 'I was hidden'
          };
          RestAPI.User.updateUser(jack.restContext, jack.user.id, jackOpts, (err, jackUser) => {
            assert.ok(!err);
            jack.user = jackUser;

            // Verify hidden for cross-tenant user on internal search
            SearchTestsUtil.searchRefreshed(
              darthVader.restContext,
              'general',
              null,
              { resourceTypes: 'user', q: jack.user.displayName },
              (err, results) => {
                assert.ok(!err);
                const jackDoc = _getDocById(results, jack.user.id);
                assert.ok(!jackDoc);

                // Verify not visible for cross-tenant user on external search
                SearchTestsUtil.searchRefreshed(
                  darthVader.restContext,
                  'general',
                  null,
                  { resourceTypes: 'user', q: jack.user.displayName, scope: '_network' },
                  (err, results) => {
                    assert.ok(!err);
                    const jackDoc = _getDocById(results, jack.user.id);
                    assert.ok(!jackDoc);

                    // Verify not visible for anonymous
                    SearchTestsUtil.searchRefreshed(
                      anonymousRestContext,
                      'general',
                      null,
                      { resourceTypes: 'user', q: jack.user.displayName },
                      (err, results) => {
                        assert.ok(!err);
                        const jackDoc = _getDocById(results, jack.user.id);
                        assert.ok(!jackDoc);

                        // Verify visible for other in-tenant loggedin user
                        SearchTestsUtil.searchRefreshed(
                          jane.restContext,
                          'general',
                          null,
                          { resourceTypes: 'user', q: jack.user.displayName },
                          (err, results) => {
                            assert.ok(!err);
                            const jackDoc = _getDocById(results, jack.user.id);
                            assert.ok(jackDoc);
                            assert.strictEqual(jackDoc.id, jack.user.id);
                            assert.strictEqual(jackDoc.resourceType, 'user');
                            assert.strictEqual(
                              jackDoc.profilePath,
                              '/user/' + jackDoc.tenant.alias + '/' + AuthzUtil.getResourceFromId(jackDoc.id).resourceId
                            );
                            assert.strictEqual(jackDoc.tenantAlias, jack.user.tenant.alias);
                            assert.strictEqual(jackDoc.displayName, jack.user.displayName);
                            assert.strictEqual(jackDoc.visibility, jack.user.visibility);
                            assert.strictEqual(jackDoc._extra, undefined);
                            assert.strictEqual(jackDoc.extra, undefined);
                            assert.strictEqual(jackDoc.q_high, undefined);
                            assert.strictEqual(jackDoc.q_low, undefined);
                            assert.strictEqual(jackDoc.sort, undefined);
                            assert.strictEqual(jackDoc._type, undefined);

                            // Verify not hidden for admin
                            SearchTestsUtil.searchRefreshed(
                              camAdminRestContext,
                              'general',
                              null,
                              { resourceTypes: 'user', q: jack.user.displayName },
                              (err, results) => {
                                assert.ok(!err);
                                const jackDoc = _getDocById(results, jack.user.id);
                                assert.ok(jackDoc);
                                assert.strictEqual(jackDoc.id, jack.user.id);
                                assert.strictEqual(jackDoc.resourceType, 'user');
                                assert.strictEqual(
                                  jackDoc.profilePath,
                                  '/user/' +
                                    jackDoc.tenant.alias +
                                    '/' +
                                    AuthzUtil.getResourceFromId(jackDoc.id).resourceId
                                );
                                assert.strictEqual(jackDoc.tenantAlias, jack.user.tenant.alias);
                                assert.strictEqual(jackDoc.displayName, jack.user.displayName);
                                assert.strictEqual(jackDoc.visibility, jack.user.visibility);
                                assert.strictEqual(jackDoc._extra, undefined);
                                assert.strictEqual(jackDoc.extra, undefined);
                                assert.strictEqual(jackDoc.q_high, undefined);
                                assert.strictEqual(jackDoc.q_low, undefined);
                                assert.strictEqual(jackDoc.sort, undefined);
                                assert.strictEqual(jackDoc._type, undefined);

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
    });

    /**
     * Test that verifies that private user profiles are hidden from everyone.
     */
    it('verify private user profile not visibile to anyone but admin users and the user themself', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
        assert.ok(!err);

        TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users, darthVader) => {
          assert.ok(!err);

          const jackOpts = {
            visibility: 'private',
            publicAlias: 'I was hidden'
          };
          RestAPI.User.updateUser(jack.restContext, jack.user.id, jackOpts, (err, jackUser) => {
            assert.ok(!err);
            jack.user = jackUser;

            // Verify hidden for cross-tenant user on internal search
            SearchTestsUtil.searchRefreshed(
              darthVader.restContext,
              'general',
              null,
              { resourceTypes: 'user', q: jack.user.displayName },
              (err, results) => {
                assert.ok(!err);
                const jackDoc = _getDocById(results, jack.user.id);
                assert.ok(!jackDoc);

                // Verify not visible for cross-tenant user on external search
                SearchTestsUtil.searchRefreshed(
                  darthVader.restContext,
                  'general',
                  null,
                  { resourceTypes: 'user', q: jack.user.displayName, scope: '_network' },
                  (err, results) => {
                    assert.ok(!err);
                    const jackDoc = _getDocById(results, jack.user.id);
                    assert.ok(!jackDoc);

                    // Verify not visible for anonymous
                    SearchTestsUtil.searchRefreshed(
                      anonymousRestContext,
                      'general',
                      null,
                      { resourceTypes: 'user', q: jack.user.displayName },
                      (err, results) => {
                        assert.ok(!err);
                        const jackDoc = _getDocById(results, jack.user.id);
                        assert.ok(!jackDoc);

                        // Verify not visible for other in-tenant loggedin user
                        SearchTestsUtil.searchRefreshed(
                          jane.restContext,
                          'general',
                          null,
                          { resourceTypes: 'user', q: jack.user.displayName },
                          (err, results) => {
                            assert.ok(!err);
                            const jackDoc = _getDocById(results, jack.user.id);
                            assert.ok(!jackDoc);

                            // Verify not hidden for tenant admin
                            SearchTestsUtil.searchRefreshed(
                              camAdminRestContext,
                              'general',
                              null,
                              { resourceTypes: 'user', q: jack.user.displayName },
                              (err, results) => {
                                assert.ok(!err);

                                const jackDoc = _getDocById(results, jack.user.id);
                                assert.ok(jackDoc);
                                assert.strictEqual(jackDoc.id, jack.user.id);
                                assert.strictEqual(jackDoc.resourceType, 'user');
                                assert.strictEqual(
                                  jackDoc.profilePath,
                                  '/user/' +
                                    jackDoc.tenant.alias +
                                    '/' +
                                    AuthzUtil.getResourceFromId(jackDoc.id).resourceId
                                );
                                assert.strictEqual(jackDoc.tenantAlias, jack.user.tenant.alias);
                                assert.strictEqual(jackDoc.displayName, jack.user.displayName);
                                assert.strictEqual(jackDoc.visibility, jack.user.visibility);
                                assert.strictEqual(jackDoc._extra, undefined);
                                assert.strictEqual(jackDoc.extra, undefined);
                                assert.strictEqual(jackDoc.q_high, undefined);
                                assert.strictEqual(jackDoc.q_low, undefined);
                                assert.strictEqual(jackDoc.sort, undefined);
                                assert.strictEqual(jackDoc._type, undefined);

                                // Verify not hidden for global admin authenticated to a different tenant
                                SearchTestsUtil.searchRefreshed(
                                  globalAdminOnTenantRestContext,
                                  'general',
                                  null,
                                  {
                                    resourceTypes: 'user',
                                    q: jack.user.displayName,
                                    scope: '_network'
                                  },
                                  (err, results) => {
                                    assert.ok(!err);

                                    const jackDoc = _getDocById(results, jack.user.id);
                                    assert.ok(jackDoc);
                                    assert.strictEqual(jackDoc.id, jack.user.id);
                                    assert.strictEqual(jackDoc.resourceType, 'user');
                                    assert.strictEqual(
                                      jackDoc.profilePath,
                                      '/user/' +
                                        jackDoc.tenant.alias +
                                        '/' +
                                        AuthzUtil.getResourceFromId(jackDoc.id).resourceId
                                    );
                                    assert.strictEqual(jackDoc.tenantAlias, jack.user.tenant.alias);
                                    assert.strictEqual(jackDoc.displayName, jack.user.displayName);
                                    assert.strictEqual(jackDoc.visibility, jack.user.visibility);
                                    assert.strictEqual(jackDoc._extra, undefined);
                                    assert.strictEqual(jackDoc.extra, undefined);
                                    assert.strictEqual(jackDoc.q_high, undefined);
                                    assert.strictEqual(jackDoc.q_low, undefined);
                                    assert.strictEqual(jackDoc.sort, undefined);
                                    assert.strictEqual(jackDoc._type, undefined);

                                    callback();
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
      });
    });
  });

  describe('Group Search Visibility', () => {
    /**
     * Test that verifies public groups are searchable by everyone
     */
    it('verify public group is searchable by everyone', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
        assert.ok(!err);

        TestsUtil.generateTestUsers(gtAdminRestContext, 2, (err, users, darthVader, sith) => {
          assert.ok(!err);

          // Create the group, including sith as a user
          const uniqueString = TestsUtil.generateTestUserId('public-group-visibility');
          RestAPI.Group.createGroup(
            jack.restContext,
            uniqueString,
            uniqueString,
            'public',
            'no',
            [],
            [sith.user.id],
            (err, group) => {
              assert.ok(!err);

              // Verify anonymous user search can access it
              SearchTestsUtil.searchRefreshed(
                anonymousRestContext,
                'general',
                null,
                { resourceTypes: 'group', q: uniqueString },
                (err, results) => {
                  assert.ok(!err);
                  const groupDoc = _getDocById(results, group.id);
                  assert.ok(groupDoc);
                  assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                  assert.strictEqual(groupDoc.resourceType, 'group');
                  assert.strictEqual(
                    groupDoc.profilePath,
                    '/group/' + groupDoc.tenant.alias + '/' + AuthzUtil.getResourceFromId(groupDoc.id).resourceId
                  );
                  assert.strictEqual(groupDoc.id, group.id);
                  assert.strictEqual(groupDoc.displayName, group.displayName);
                  assert.strictEqual(groupDoc.visibility, group.visibility);
                  assert.strictEqual(groupDoc._extra, undefined);
                  assert.strictEqual(groupDoc._type, undefined);
                  assert.strictEqual(groupDoc.q_high, undefined);
                  assert.strictEqual(groupDoc.q_low, undefined);
                  assert.strictEqual(groupDoc.sort, undefined);

                  // Verify cross-tenant user can query the group
                  SearchTestsUtil.searchRefreshed(
                    darthVader.restContext,
                    'general',
                    null,
                    { resourceTypes: 'group', q: uniqueString, scope: '_network' },
                    (err, results) => {
                      assert.ok(!err);
                      const groupDoc = _getDocById(results, group.id);
                      assert.ok(groupDoc);
                      assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                      assert.strictEqual(groupDoc.resourceType, 'group');
                      assert.strictEqual(
                        groupDoc.profilePath,
                        '/group/' + groupDoc.tenant.alias + '/' + AuthzUtil.getResourceFromId(groupDoc.id).resourceId
                      );
                      assert.strictEqual(groupDoc.id, group.id);
                      assert.strictEqual(groupDoc.displayName, group.displayName);
                      assert.strictEqual(groupDoc.visibility, group.visibility);
                      assert.strictEqual(groupDoc._extra, undefined);
                      assert.strictEqual(groupDoc._type, undefined);
                      assert.strictEqual(groupDoc.q_high, undefined);
                      assert.strictEqual(groupDoc.q_low, undefined);
                      assert.strictEqual(groupDoc.sort, undefined);

                      // Verify cross-tenant *member* can query the group
                      SearchTestsUtil.searchRefreshed(
                        sith.restContext,
                        'general',
                        null,
                        { resourceTypes: 'group', q: uniqueString, scope: '_tenant' },
                        (err, results) => {
                          assert.ok(!err);
                          const groupDoc = _getDocById(results, group.id);
                          assert.ok(groupDoc);
                          assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                          assert.strictEqual(groupDoc.resourceType, 'group');
                          assert.strictEqual(
                            groupDoc.profilePath,
                            '/group/' +
                              groupDoc.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(groupDoc.id).resourceId
                          );
                          assert.strictEqual(groupDoc.id, group.id);
                          assert.strictEqual(groupDoc.displayName, group.displayName);
                          assert.strictEqual(groupDoc.visibility, group.visibility);
                          assert.strictEqual(groupDoc._extra, undefined);
                          assert.strictEqual(groupDoc._type, undefined);
                          assert.strictEqual(groupDoc.q_high, undefined);
                          assert.strictEqual(groupDoc.q_low, undefined);
                          assert.strictEqual(groupDoc.sort, undefined);

                          // Verify another same-tenant loggedin user can query it
                          SearchTestsUtil.searchRefreshed(
                            jane.restContext,
                            'general',
                            null,
                            { resourceTypes: 'group', q: uniqueString },
                            (err, results) => {
                              assert.ok(!err);
                              const groupDoc = _getDocById(results, group.id);
                              assert.ok(groupDoc);
                              assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                              assert.strictEqual(groupDoc.resourceType, 'group');
                              assert.strictEqual(
                                groupDoc.profilePath,
                                '/group/' +
                                  groupDoc.tenant.alias +
                                  '/' +
                                  AuthzUtil.getResourceFromId(groupDoc.id).resourceId
                              );
                              assert.strictEqual(groupDoc.id, group.id);
                              assert.strictEqual(groupDoc.displayName, group.displayName);
                              assert.strictEqual(groupDoc.visibility, group.visibility);
                              assert.strictEqual(groupDoc._extra, undefined);
                              assert.strictEqual(groupDoc._type, undefined);
                              assert.strictEqual(groupDoc.q_high, undefined);
                              assert.strictEqual(groupDoc.q_low, undefined);
                              assert.strictEqual(groupDoc.sort, undefined);

                              // Verify member user can query it
                              SearchTestsUtil.searchRefreshed(
                                jack.restContext,
                                'general',
                                null,
                                { resourceTypes: 'group', q: uniqueString },
                                (err, results) => {
                                  assert.ok(!err);
                                  const groupDoc = _getDocById(results, group.id);
                                  assert.ok(groupDoc);
                                  assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                                  assert.strictEqual(groupDoc.resourceType, 'group');
                                  assert.strictEqual(
                                    groupDoc.profilePath,
                                    '/group/' +
                                      groupDoc.tenant.alias +
                                      '/' +
                                      AuthzUtil.getResourceFromId(groupDoc.id).resourceId
                                  );
                                  assert.strictEqual(groupDoc.id, group.id);
                                  assert.strictEqual(groupDoc.displayName, group.displayName);
                                  assert.strictEqual(groupDoc.visibility, group.visibility);
                                  assert.strictEqual(groupDoc._extra, undefined);
                                  assert.strictEqual(groupDoc._type, undefined);
                                  assert.strictEqual(groupDoc.q_high, undefined);
                                  assert.strictEqual(groupDoc.q_low, undefined);
                                  assert.strictEqual(groupDoc.sort, undefined);

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
        });
      });
    });

    /**
     * Test that verifies loggedin groups are searchable by only users that are authenticated to the group's tenant, unless they are
     * joinable ('yes' or 'request'), in which case they are also searchable by users from other tenants.
     *
     * Also verifies that joinable groups from private tenants are not returned in queries from authenticated users, because that user
     * will not be able to join the group, so there is no point in showing it in the results.
     */
    it('verify loggedin group search visibility', callback => {
      const privateTenantAlias = TenantsTestUtil.generateTestTenantAlias('privateTenant');
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      const uniqueStringA = TestsUtil.generateTestUserId('loggedin-group-visibility');
      const uniqueStringB = TestsUtil.generateTestUserId('loggedin-group-visibility');
      const uniqueStringC = TestsUtil.generateTestUserId('loggedin-group-visibility-skywalker');

      // Create a private tenant with a user and a loggedin joinable group. These will be used to test searches for cross-tenant private groups where
      // you do not have access to join the group. In those cases, you should not get the group in the search results.
      TestsUtil.createTenantWithAdmin(
        privateTenantAlias,
        tenantHost,
        (err, privateTenant, privateTenantAdminRestContext) => {
          assert.ok(!err);

          ConfigTestUtil.updateConfigAndWait(
            globalAdminRestContext,
            privateTenantAlias,
            { 'oae-tenants/tenantprivacy/tenantprivate': true },
            err => {
              assert.ok(!err);

              TestsUtil.generateTestUsers(privateTenantAdminRestContext, 1, (err, users, lukeSkywalker) => {
                assert.ok(!err);

                RestAPI.Group.createGroup(
                  lukeSkywalker.restContext,
                  uniqueStringC,
                  uniqueStringC,
                  'loggedin',
                  'yes',
                  [],
                  [],
                  (err, privateTenantGroup) => {
                    assert.ok(!err);

                    // Create 2 users from another public tenant tenant (gt), one of which has access to the group, and 2 users from the same tenant
                    TestsUtil.generateTestUsers(gtAdminRestContext, 2, (err, users, darthVader, sith) => {
                      assert.ok(!err);

                      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
                        // Create the group, including sith as a user
                        RestAPI.Group.createGroup(
                          jack.restContext,
                          uniqueStringA,
                          uniqueStringA,
                          'loggedin',
                          'no',
                          [],
                          [sith.user.id],
                          (err, group) => {
                            assert.ok(!err);

                            // Create the joinable group, including sith as a user
                            RestAPI.Group.createGroup(
                              jack.restContext,
                              uniqueStringB,
                              uniqueStringB,
                              'loggedin',
                              'request',
                              [],
                              [sith.user.id],
                              (err, groupJoinable) => {
                                assert.ok(!err);

                                // Verify anonymous user search cannot access either
                                SearchTestsUtil.searchRefreshed(
                                  anonymousRestContext,
                                  'general',
                                  null,
                                  { resourceTypes: 'group', q: uniqueStringA },
                                  (err, results) => {
                                    assert.ok(!err);
                                    const groupDoc = _getDocById(results, group.id);
                                    assert.ok(!groupDoc);

                                    SearchTestsUtil.searchRefreshed(
                                      anonymousRestContext,
                                      'general',
                                      null,
                                      { resourceTypes: 'group', q: uniqueStringB },
                                      (err, results) => {
                                        assert.ok(!err);
                                        const groupDoc = _getDocById(results, groupJoinable.id);
                                        assert.ok(!groupDoc);

                                        // Verify cross-tenant user cannot query the unjoinable group
                                        SearchTestsUtil.searchRefreshed(
                                          darthVader.restContext,
                                          'general',
                                          null,
                                          {
                                            resourceTypes: 'group',
                                            q: uniqueStringA,
                                            scope: '_network'
                                          },
                                          (err, results) => {
                                            assert.ok(!err);
                                            const groupDoc = _getDocById(results, group.id);
                                            assert.ok(!groupDoc);

                                            // Verify cross-tenant user cannot query the joinable group
                                            SearchTestsUtil.searchRefreshed(
                                              darthVader.restContext,
                                              'general',
                                              null,
                                              {
                                                resourceTypes: 'group',
                                                q: uniqueStringB,
                                                scope: '_network'
                                              },
                                              (err, results) => {
                                                assert.ok(!err);
                                                assert.ok(!_getDocById(results, groupJoinable.id));

                                                // Verify cross-tenant member can query the unjoinable group
                                                SearchTestsUtil.searchRefreshed(
                                                  sith.restContext,
                                                  'general',
                                                  null,
                                                  {
                                                    resourceTypes: 'group',
                                                    q: uniqueStringA
                                                  },
                                                  (err, results) => {
                                                    assert.ok(!err);
                                                    const groupDoc = _getDocById(results, group.id);
                                                    assert.ok(groupDoc);
                                                    assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                                                    assert.strictEqual(groupDoc.resourceType, 'group');
                                                    assert.strictEqual(
                                                      groupDoc.profilePath,
                                                      '/group/' +
                                                        groupDoc.tenant.alias +
                                                        '/' +
                                                        AuthzUtil.getResourceFromId(groupDoc.id).resourceId
                                                    );
                                                    assert.strictEqual(groupDoc.id, group.id);
                                                    assert.strictEqual(groupDoc.displayName, group.displayName);
                                                    assert.strictEqual(groupDoc.visibility, group.visibility);
                                                    assert.strictEqual(groupDoc._extra, undefined);
                                                    assert.strictEqual(groupDoc._type, undefined);
                                                    assert.strictEqual(groupDoc.q_high, undefined);
                                                    assert.strictEqual(groupDoc.q_low, undefined);
                                                    assert.strictEqual(groupDoc.sort, undefined);

                                                    // Verify another same-tenant loggedin user can query it
                                                    SearchTestsUtil.searchRefreshed(
                                                      jane.restContext,
                                                      'general',
                                                      null,
                                                      {
                                                        resourceTypes: 'group',
                                                        q: uniqueStringA
                                                      },
                                                      (err, results) => {
                                                        assert.ok(!err);
                                                        const groupDoc = _getDocById(results, group.id);
                                                        assert.ok(groupDoc);
                                                        assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                                                        assert.strictEqual(groupDoc.resourceType, 'group');
                                                        assert.strictEqual(
                                                          groupDoc.profilePath,
                                                          '/group/' +
                                                            groupDoc.tenant.alias +
                                                            '/' +
                                                            AuthzUtil.getResourceFromId(groupDoc.id).resourceId
                                                        );
                                                        assert.strictEqual(groupDoc.id, group.id);
                                                        assert.strictEqual(groupDoc.displayName, group.displayName);
                                                        assert.strictEqual(groupDoc.visibility, group.visibility);
                                                        assert.strictEqual(groupDoc._extra, undefined);
                                                        assert.strictEqual(groupDoc._type, undefined);
                                                        assert.strictEqual(groupDoc.q_high, undefined);
                                                        assert.strictEqual(groupDoc.q_low, undefined);
                                                        assert.strictEqual(groupDoc.sort, undefined);

                                                        // Verify member user can query it
                                                        SearchTestsUtil.searchRefreshed(
                                                          jack.restContext,
                                                          'general',
                                                          null,
                                                          {
                                                            resourceTypes: 'group',
                                                            q: uniqueStringA
                                                          },
                                                          (err, results) => {
                                                            assert.ok(!err);
                                                            const groupDoc = _getDocById(results, group.id);
                                                            assert.ok(groupDoc);
                                                            assert.strictEqual(
                                                              groupDoc.tenantAlias,
                                                              group.tenant.alias
                                                            );
                                                            assert.strictEqual(groupDoc.resourceType, 'group');
                                                            assert.strictEqual(
                                                              groupDoc.profilePath,
                                                              '/group/' +
                                                                groupDoc.tenant.alias +
                                                                '/' +
                                                                AuthzUtil.getResourceFromId(groupDoc.id).resourceId
                                                            );
                                                            assert.strictEqual(groupDoc.id, group.id);
                                                            assert.strictEqual(groupDoc.displayName, group.displayName);
                                                            assert.strictEqual(groupDoc.visibility, group.visibility);
                                                            assert.strictEqual(groupDoc._extra, undefined);
                                                            assert.strictEqual(groupDoc._type, undefined);
                                                            assert.strictEqual(groupDoc.q_high, undefined);
                                                            assert.strictEqual(groupDoc.q_low, undefined);
                                                            assert.strictEqual(groupDoc.sort, undefined);

                                                            // Sanity check luke skywalker's query to own loggedin group
                                                            SearchTestsUtil.searchRefreshed(
                                                              lukeSkywalker.restContext,
                                                              'general',
                                                              null,
                                                              {
                                                                resourceTypes: 'group',
                                                                q: uniqueStringC
                                                              },
                                                              (err, results) => {
                                                                assert.ok(!err);
                                                                const groupDoc = _getDocById(
                                                                  results,
                                                                  privateTenantGroup.id
                                                                );
                                                                assert.ok(groupDoc);
                                                                assert.strictEqual(
                                                                  groupDoc.tenantAlias,
                                                                  privateTenantGroup.tenant.alias
                                                                );
                                                                assert.strictEqual(groupDoc.resourceType, 'group');
                                                                assert.strictEqual(
                                                                  groupDoc.profilePath,
                                                                  '/group/' +
                                                                    groupDoc.tenant.alias +
                                                                    '/' +
                                                                    AuthzUtil.getResourceFromId(groupDoc.id).resourceId
                                                                );
                                                                assert.strictEqual(groupDoc.id, privateTenantGroup.id);
                                                                assert.strictEqual(
                                                                  groupDoc.displayName,
                                                                  privateTenantGroup.displayName
                                                                );
                                                                assert.strictEqual(
                                                                  groupDoc.visibility,
                                                                  privateTenantGroup.visibility
                                                                );
                                                                assert.strictEqual(groupDoc._extra, undefined);
                                                                assert.strictEqual(groupDoc._type, undefined);
                                                                assert.strictEqual(groupDoc.q_high, undefined);
                                                                assert.strictEqual(groupDoc.q_low, undefined);
                                                                assert.strictEqual(groupDoc.sort, undefined);

                                                                // Verify a user from a private tenant cannot query an external loggedin joinable group
                                                                SearchTestsUtil.searchRefreshed(
                                                                  lukeSkywalker.restContext,
                                                                  'general',
                                                                  null,
                                                                  {
                                                                    resourceTypes: 'group',
                                                                    q: uniqueStringB,
                                                                    scope: '_network'
                                                                  },
                                                                  (err, results) => {
                                                                    assert.ok(!err);
                                                                    const groupDoc = _getDocById(
                                                                      results,
                                                                      groupJoinable.id
                                                                    );
                                                                    assert.ok(!groupDoc);

                                                                    // Verify that user from a public tenant cannot query a loggedin joinable group that belongs to a private tenant (luke skywalker's tenant and group)
                                                                    SearchTestsUtil.searchRefreshed(
                                                                      jack.restContext,
                                                                      'general',
                                                                      null,
                                                                      {
                                                                        resourceTypes: 'group',
                                                                        q: uniqueStringC,
                                                                        scope: '_network'
                                                                      },
                                                                      (err, results) => {
                                                                        assert.ok(!err);
                                                                        const groupDoc = _getDocById(
                                                                          results,
                                                                          privateTenantGroup.id
                                                                        );
                                                                        assert.ok(!groupDoc);
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
        }
      );
    });

    /**
     * Test that verifies that unjoinable private groups are only searchable by members. It also verifies that if the group is joinable ('yes' or 'request'),
     * that it is searchable by authenticated users from other tenants so long as the group's tenant *and* the other tenant are both public.
     */
    it('verify private group search visibility', callback => {
      const privateTenantAlias = TenantsTestUtil.generateTestTenantAlias('privateTenant');
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      const uniqueStringA = TestsUtil.generateTestUserId('loggedin-group-visibility');
      const uniqueStringB = TestsUtil.generateTestUserId('loggedin-group-visibility');
      const uniqueStringC = TestsUtil.generateTestUserId('loggedin-group-visibility-skywalker');

      // Create a private tenant with a user and a loggedin joinable group. These will be used to test searches for cross-tenant private groups where
      // you do not have access to join the group. In those cases, you should not get the group in the search results.
      TestsUtil.createTenantWithAdmin(
        privateTenantAlias,
        tenantHost,
        (err, privateTenant, privateTenantAdminRestContext) => {
          assert.ok(!err);

          ConfigTestUtil.updateConfigAndWait(
            globalAdminRestContext,
            privateTenantAlias,
            { 'oae-tenants/tenantprivacy/tenantprivate': true },
            err => {
              assert.ok(!err);

              TestsUtil.generateTestUsers(privateTenantAdminRestContext, 1, (err, users, lukeSkywalker) => {
                assert.ok(!err);

                RestAPI.Group.createGroup(
                  lukeSkywalker.restContext,
                  TestsUtil.generateTestUserId('privateTenantGroup'),
                  'A luke skywalker tenant group',
                  'private',
                  'yes',
                  [],
                  [],
                  (err, privateTenantGroup) => {
                    assert.ok(!err);

                    // Create 2 users from another public tenant tenant (gt), one of which has access to the group, and 2 users from the same tenant
                    TestsUtil.generateTestUsers(gtAdminRestContext, 2, (err, users, darthVader, sith) => {
                      assert.ok(!err);

                      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
                        // Create the group, including sith as a user
                        RestAPI.Group.createGroup(
                          jack.restContext,
                          uniqueStringA,
                          uniqueStringA,
                          'loggedin',
                          'no',
                          [],
                          [sith.user.id],
                          (err, group) => {
                            assert.ok(!err);

                            // Create the joinable group, including sith as a user
                            RestAPI.Group.createGroup(
                              jack.restContext,
                              uniqueStringB,
                              uniqueStringB,
                              'loggedin',
                              'request',
                              [],
                              [sith.user.id],
                              (err, groupJoinable) => {
                                assert.ok(!err);

                                // Create the unjoinable group, including sith as a user
                                RestAPI.Group.createGroup(
                                  jack.restContext,
                                  TestsUtil.generateTestUserId('group'),
                                  'A really awesome group',
                                  'private',
                                  'no',
                                  [],
                                  [sith.user.id],
                                  (err, group) => {
                                    assert.ok(!err);

                                    // Create the joinable group, including sith as a user
                                    RestAPI.Group.createGroup(
                                      jack.restContext,
                                      TestsUtil.generateTestUserId('groupJoinable'),
                                      'A really super joinable group',
                                      'private',
                                      'request',
                                      [],
                                      [sith.user.id],
                                      (err, groupJoinable) => {
                                        assert.ok(!err);

                                        // Verify anonymous user search cannot access either
                                        SearchTestsUtil.searchRefreshed(
                                          anonymousRestContext,
                                          'general',
                                          null,
                                          { resourceTypes: 'group', q: 'awesome' },
                                          (err, results) => {
                                            assert.ok(!err);
                                            const groupDoc = _getDocById(results, group.id);
                                            assert.ok(!groupDoc);

                                            SearchTestsUtil.searchRefreshed(
                                              anonymousRestContext,
                                              'general',
                                              null,
                                              { resourceTypes: 'group', q: 'joinable' },
                                              (err, results) => {
                                                assert.ok(!err);
                                                const groupDoc = _getDocById(results, groupJoinable.id);
                                                assert.ok(!groupDoc);

                                                // Verify cross-tenant user cannot query the unjoinable group
                                                SearchTestsUtil.searchRefreshed(
                                                  darthVader.restContext,
                                                  'general',
                                                  null,
                                                  {
                                                    resourceTypes: 'group',
                                                    q: 'awesome',
                                                    scope: '_network'
                                                  },
                                                  (err, results) => {
                                                    assert.ok(!err);
                                                    const groupDoc = _getDocById(results, group.id);
                                                    assert.ok(!groupDoc);

                                                    // Verify cross-tenant user cannot query the joinable group
                                                    SearchTestsUtil.searchRefreshed(
                                                      darthVader.restContext,
                                                      'general',
                                                      null,
                                                      {
                                                        resourceTypes: 'group',
                                                        q: 'joinable',
                                                        scope: '_network'
                                                      },
                                                      (err, results) => {
                                                        assert.ok(!err);
                                                        assert.ok(!_getDocById(results, groupJoinable.id));

                                                        // Verify cross-tenant member can query the unjoinable group
                                                        SearchTestsUtil.searchRefreshed(
                                                          sith.restContext,
                                                          'general',
                                                          null,
                                                          {
                                                            resourceTypes: 'group',
                                                            q: 'awesome'
                                                          },
                                                          (err, results) => {
                                                            assert.ok(!err);

                                                            const groupDoc = _getDocById(results, group.id);
                                                            assert.ok(groupDoc);
                                                            assert.strictEqual(
                                                              groupDoc.tenantAlias,
                                                              group.tenant.alias
                                                            );
                                                            assert.strictEqual(groupDoc.resourceType, 'group');
                                                            assert.strictEqual(
                                                              groupDoc.profilePath,
                                                              '/group/' +
                                                                groupDoc.tenant.alias +
                                                                '/' +
                                                                AuthzUtil.getResourceFromId(groupDoc.id).resourceId
                                                            );
                                                            assert.strictEqual(groupDoc.id, group.id);
                                                            assert.strictEqual(groupDoc.displayName, group.displayName);
                                                            assert.strictEqual(groupDoc.visibility, group.visibility);
                                                            assert.strictEqual(groupDoc._extra, undefined);
                                                            assert.strictEqual(groupDoc._type, undefined);
                                                            assert.strictEqual(groupDoc.q_high, undefined);
                                                            assert.strictEqual(groupDoc.q_low, undefined);
                                                            assert.strictEqual(groupDoc.sort, undefined);

                                                            // Verify another same-tenant loggedin user cannot query the unjoinable group
                                                            SearchTestsUtil.searchRefreshed(
                                                              jane.restContext,
                                                              'general',
                                                              null,
                                                              {
                                                                resourceTypes: 'group',
                                                                q: 'awesome'
                                                              },
                                                              (err, results) => {
                                                                assert.ok(!err);
                                                                const groupDoc = _getDocById(results, group.id);
                                                                assert.ok(!groupDoc);

                                                                // Verify member user can query the unjoinable group
                                                                SearchTestsUtil.searchRefreshed(
                                                                  jack.restContext,
                                                                  'general',
                                                                  null,
                                                                  {
                                                                    resourceTypes: 'group',
                                                                    q: 'awesome'
                                                                  },
                                                                  (err, results) => {
                                                                    assert.ok(!err);

                                                                    const groupDoc = _getDocById(results, group.id);
                                                                    assert.ok(groupDoc);
                                                                    assert.strictEqual(
                                                                      groupDoc.tenantAlias,
                                                                      group.tenant.alias
                                                                    );
                                                                    assert.strictEqual(groupDoc.resourceType, 'group');
                                                                    assert.strictEqual(
                                                                      groupDoc.profilePath,
                                                                      '/group/' +
                                                                        groupDoc.tenant.alias +
                                                                        '/' +
                                                                        AuthzUtil.getResourceFromId(groupDoc.id)
                                                                          .resourceId
                                                                    );
                                                                    assert.strictEqual(groupDoc.id, group.id);
                                                                    assert.strictEqual(
                                                                      groupDoc.displayName,
                                                                      group.displayName
                                                                    );
                                                                    assert.strictEqual(
                                                                      groupDoc.visibility,
                                                                      group.visibility
                                                                    );
                                                                    assert.strictEqual(groupDoc._extra, undefined);
                                                                    assert.strictEqual(groupDoc._type, undefined);
                                                                    assert.strictEqual(groupDoc.q_high, undefined);
                                                                    assert.strictEqual(groupDoc.q_low, undefined);
                                                                    assert.strictEqual(groupDoc.sort, undefined);

                                                                    // Sanity check luke skywalker's query to own group
                                                                    SearchTestsUtil.searchRefreshed(
                                                                      lukeSkywalker.restContext,
                                                                      'general',
                                                                      null,
                                                                      {
                                                                        resourceTypes: 'group',
                                                                        q: 'skywalker'
                                                                      },
                                                                      (err, results) => {
                                                                        assert.ok(!err);

                                                                        const groupDoc = _getDocById(
                                                                          results,
                                                                          privateTenantGroup.id
                                                                        );
                                                                        assert.ok(groupDoc);
                                                                        assert.strictEqual(
                                                                          groupDoc.tenantAlias,
                                                                          privateTenantGroup.tenant.alias
                                                                        );
                                                                        assert.strictEqual(
                                                                          groupDoc.resourceType,
                                                                          'group'
                                                                        );
                                                                        assert.strictEqual(
                                                                          groupDoc.profilePath,
                                                                          '/group/' +
                                                                            groupDoc.tenant.alias +
                                                                            '/' +
                                                                            AuthzUtil.getResourceFromId(groupDoc.id)
                                                                              .resourceId
                                                                        );
                                                                        assert.strictEqual(
                                                                          groupDoc.id,
                                                                          privateTenantGroup.id
                                                                        );
                                                                        assert.strictEqual(
                                                                          groupDoc.displayName,
                                                                          privateTenantGroup.displayName
                                                                        );
                                                                        assert.strictEqual(
                                                                          groupDoc.visibility,
                                                                          privateTenantGroup.visibility
                                                                        );
                                                                        assert.strictEqual(groupDoc._extra, undefined);
                                                                        assert.strictEqual(groupDoc._type, undefined);
                                                                        assert.strictEqual(groupDoc.q_high, undefined);
                                                                        assert.strictEqual(groupDoc.q_low, undefined);
                                                                        assert.strictEqual(groupDoc.sort, undefined);

                                                                        // Verify a user from a private tenant cannot query an external private joinable group
                                                                        SearchTestsUtil.searchRefreshed(
                                                                          lukeSkywalker.restContext,
                                                                          'general',
                                                                          null,
                                                                          {
                                                                            resourceTypes: 'group',
                                                                            q: 'joinable',
                                                                            scope: '_network'
                                                                          },
                                                                          (err, results) => {
                                                                            assert.ok(!err);
                                                                            const groupDoc = _getDocById(
                                                                              results,
                                                                              groupJoinable.id
                                                                            );
                                                                            assert.ok(!groupDoc);

                                                                            // Verify that user from a public tenant cannot query a private joinable group that belongs to a private tenant (luke skywalker's tenant and group)
                                                                            SearchTestsUtil.searchRefreshed(
                                                                              jack.restContext,
                                                                              'general',
                                                                              null,
                                                                              {
                                                                                resourceTypes: 'group',
                                                                                q: 'skywalker',
                                                                                scope: '_network'
                                                                              },
                                                                              (err, results) => {
                                                                                assert.ok(!err);
                                                                                const groupDoc = _getDocById(
                                                                                  results,
                                                                                  privateTenantGroup.id
                                                                                );
                                                                                assert.ok(!groupDoc);

                                                                                // Verify global admin user authenticated to a different tenant can query the private unjoinable group
                                                                                SearchTestsUtil.searchRefreshed(
                                                                                  globalAdminOnTenantRestContext,
                                                                                  'general',
                                                                                  null,
                                                                                  {
                                                                                    resourceTypes: 'group',
                                                                                    q: 'skywalker',
                                                                                    scope: '_all'
                                                                                  },
                                                                                  (err, results) => {
                                                                                    assert.ok(!err);

                                                                                    const groupDoc = _getDocById(
                                                                                      results,
                                                                                      privateTenantGroup.id
                                                                                    );
                                                                                    assert.ok(groupDoc);
                                                                                    assert.strictEqual(
                                                                                      groupDoc.tenantAlias,
                                                                                      privateTenantGroup.tenant.alias
                                                                                    );
                                                                                    assert.strictEqual(
                                                                                      groupDoc.resourceType,
                                                                                      'group'
                                                                                    );
                                                                                    assert.strictEqual(
                                                                                      groupDoc.profilePath,
                                                                                      '/group/' +
                                                                                        groupDoc.tenant.alias +
                                                                                        '/' +
                                                                                        AuthzUtil.getResourceFromId(
                                                                                          groupDoc.id
                                                                                        ).resourceId
                                                                                    );
                                                                                    assert.strictEqual(
                                                                                      groupDoc.id,
                                                                                      privateTenantGroup.id
                                                                                    );
                                                                                    assert.strictEqual(
                                                                                      groupDoc.displayName,
                                                                                      privateTenantGroup.displayName
                                                                                    );
                                                                                    assert.strictEqual(
                                                                                      groupDoc.visibility,
                                                                                      privateTenantGroup.visibility
                                                                                    );
                                                                                    assert.strictEqual(
                                                                                      groupDoc._extra,
                                                                                      undefined
                                                                                    );
                                                                                    assert.strictEqual(
                                                                                      groupDoc._type,
                                                                                      undefined
                                                                                    );
                                                                                    assert.strictEqual(
                                                                                      groupDoc.q_high,
                                                                                      undefined
                                                                                    );
                                                                                    assert.strictEqual(
                                                                                      groupDoc.q_low,
                                                                                      undefined
                                                                                    );
                                                                                    assert.strictEqual(
                                                                                      groupDoc.sort,
                                                                                      undefined
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
              });
            }
          );
        }
      );
    });
  });

  describe('Search Analysis', () => {
    /**
     * Verifies that the search index has a minimum edgengram of 3, so that autosuggest (show-as-you-type) functionality will work
     * reasonably well.
     */
    it('verify edgengram analyzer of 3 for auto-suggest', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, doer) => {
        assert.ok(!err);

        RestAPI.Content.createLink(
          doer.restContext,
          'Apereo Xyzforedgengram',
          'Link to Apereo Foundation Website',
          'public',
          'http://www.apereo.org',
          [],
          [],
          [],
          (err, content) => {
            assert.ok(!err);

            // Search for just the first 3 characters to ensure it matches "Xyzforedgengram"
            SearchTestsUtil.searchRefreshed(doer.restContext, 'general', null, { q: 'Xyz' }, (err, results) => {
              assert.ok(!err);
              assert.ok(_getDocById(results, content.id));
              callback();
            });
          }
        );
      });
    });

    /**
     * Verifies that the search analyzer is not case-sensitive
     */
    it('verify search indexing is not case-sensitive', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, doer) => {
        assert.ok(!err);

        RestAPI.Content.createLink(
          doer.restContext,
          'Apereo Xyzforedgengram',
          'Link to Apereo Foundation Website',
          'public',
          'http://www.apereo.org',
          [],
          [],
          [],
          (err, content) => {
            assert.ok(!err);

            // Search using a lowercase querystring on an item that was indexed with upper case
            SearchTestsUtil.searchAll(doer.restContext, 'general', null, { q: 'apereo' }, (err, results) => {
              assert.ok(!err);
              assert.ok(_getDocById(results, content.id));
              callback();
            });
          }
        );
      });
    });
  });

  describe('Search Quality', () => {
    /**
     * Verifies that there is a cut-off point which eliminates documents that are only slightly relevant to the search query.
     * Assuming there are documents which are indexed with:
     *  * OAE Team
     *  * Theological reasoning
     *  * Independent workforce
     * When searching for `Team` only the first document should return.
     */
    it('verify results do not match on a single letter', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        assert.ok(!err);
        const restCtx = _.values(users)[0].restContext;

        // Create some content
        RestAPI.Content.createLink(
          restCtx,
          'Theological reasoning',
          null,
          'public',
          'http://www.apereo.org',
          [],
          [],
          [],
          (err, contentA) => {
            assert.ok(!err);
            RestAPI.Content.createLink(
              restCtx,
              'Independent workforce',
              null,
              'public',
              'http://www.apereo.org',
              [],
              [],
              [],
              (err, contentB) => {
                assert.ok(!err);
                const groupDisplayName = 'OAE Team ' + Math.random();
                RestAPI.Group.createGroup(
                  restCtx,
                  groupDisplayName,
                  'A really awesome group',
                  'public',
                  'no',
                  [],
                  [],
                  (err, group) => {
                    assert.ok(!err);

                    // Ensure the group match is more relevant than the content item
                    SearchTestsUtil.searchAll(restCtx, 'general', null, { q: 'Team' }, (err, results) => {
                      assert.ok(!err);
                      assert.ok(_getDocById(results, group.id));
                      assert.ok(!_getDocById(results, contentB.id));

                      // Ensure the group match is more relevant
                      let hadGroup = false;
                      let hadContentA = false;
                      _.each(results.results, result => {
                        if (result.id === group.id) {
                          hadGroup = true;
                          // Ensure we haven't received the content item before the group
                          assert.ok(!hadContentA);
                        } else if (result.id === contentA.id) {
                          hadContentA = true;
                        }
                      });

                      assert.ok(hadGroup);
                      return callback();
                    });
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Get the index of a user in a set of search results
     *
     * @param  {Object}     results     The search results as returend by `RestAPI.Search.search`
     * @param  {String}     id          The user id to get the index for
     * @return {Number}                 The index of the user in the search results array. Defaults to `-1` if the user could not be found
     */
    const indexOfDocument = function(results, id) {
      for (let i = 0; i < results.results.length; i++) {
        if (results.results[i].id === id) {
          return i;
        }
      }
      return -1;
    };

    /**
     * Test that verifies that displayName matches are boosted correctly, even across spaces in the displayName
     */
    it('verify displayName matches are boosted across spaces', callback => {
      let email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      RestAPI.User.createUser(
        camAdminRestContext,
        TestsUtil.generateRandomText(1),
        'password',
        'Simon Gaeremynck',
        email,
        {},
        (err, simonGaeremynck) => {
          assert.ok(!err);
          email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.gt.emailDomains[0]);
          RestAPI.User.createUser(
            gtAdminRestContext,
            TestsUtil.generateRandomText(1),
            'password',
            'Simon The Great',
            email,
            {},
            (err, simonTheGreat) => {
              assert.ok(!err);

              // When searching for 'Simon G', the 'Simon Gaeremynck' user should
              // appear before the 'Simon The Great' user
              SearchTestsUtil.searchRefreshed(
                anonymousRestContext,
                'general',
                null,
                { q: 'Simon G', scope: '_all' },
                (err, results) => {
                  assert.ok(!err);
                  const simonGaeremynckIndex = indexOfDocument(results, simonGaeremynck.id);
                  const simonTheGreatIndex = indexOfDocument(results, simonTheGreat.id);
                  assert.notStrictEqual(simonGaeremynckIndex, -1);
                  assert.notStrictEqual(simonTheGreatIndex, -1);
                  assert.ok(simonGaeremynckIndex < simonTheGreatIndex);
                  return callback();
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies that documents from the same tenant are boosted
     */
    it('verify documents from the same tenant are boosted', callback => {
      // Generate 2 identical users on 2 tenants
      const username = TestsUtil.generateRandomText(1);
      const displayName = TestsUtil.generateRandomText(2);
      let email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      RestAPI.User.createUser(camAdminRestContext, username, 'password', displayName, email, {}, (err, camUser) => {
        assert.ok(!err);
        email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.gt.emailDomains[0]);
        RestAPI.User.createUser(gtAdminRestContext, username, 'password', displayName, email, {}, (err, gtUser) => {
          assert.ok(!err);

          // When searching on the cambridge tenant, the user from the cambridge
          // tenant should appear before the user from the gt tenant
          SearchTestsUtil.searchRefreshed(
            anonymousRestContext,
            'general',
            null,
            { q: displayName, scope: '_all' },
            (err, results) => {
              assert.ok(!err);
              let camDocIndex = indexOfDocument(results, camUser.id);
              let gtDocIndex = indexOfDocument(results, gtUser.id);
              assert.notStrictEqual(camDocIndex, -1);
              assert.notStrictEqual(gtDocIndex, -1);
              assert.ok(camDocIndex < gtDocIndex);

              // When searching on the gt tenant, the user from the gt
              // tenant should appear before the user from the cambridge tenant
              SearchTestsUtil.searchRefreshed(
                anonymousGtRestContext,
                'general',
                null,
                { q: displayName, scope: '_all' },
                (err, results) => {
                  assert.ok(!err);
                  camDocIndex = indexOfDocument(results, camUser.id);
                  gtDocIndex = indexOfDocument(results, gtUser.id);
                  assert.notStrictEqual(camDocIndex, -1);
                  assert.notStrictEqual(gtDocIndex, -1);
                  assert.ok(gtDocIndex < camDocIndex);

                  return callback();
                }
              );
            }
          );
        });
      });
    });
  });

  describe('Search Options', () => {
    /**
     * Test that verifies the resourceType parameter in the general search properly filter results by user, group and content.
     */
    it('verify resourceType scope param', callback => {
      // Ensure a user, group and content item exist in the search index to ensure they are not included in resource-scoped searches
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        RestAPI.Group.createGroup(
          camAdminRestContext,
          TestsUtil.generateTestUserId('group'),
          'A group for ' + jack.user.displayName,
          'public',
          'no',
          [],
          [],
          (err, group) => {
            assert.ok(!err);

            RestAPI.Content.createLink(
              camAdminRestContext,
              'Apereo Foundation',
              'Link to ' + jack.user.displayName,
              'public',
              'http://www.apereo.org',
              [],
              [],
              [],
              (err, content) => {
                assert.ok(!err);

                // Verify we only get users from a user search
                SearchTestsUtil.searchRefreshed(
                  jack.restContext,
                  'general',
                  null,
                  { resourceTypes: 'user', q: jack.user.displayName },
                  (err, results) => {
                    assert.ok(!err);
                    assert.ok(_getDocById(results, jack.user.id));
                    assert.strictEqual(
                      _.filter(results.results, result => {
                        return result.resourceType === 'group';
                      }).length,
                      0
                    );
                    assert.strictEqual(
                      _.filter(results.results, result => {
                        return result.resourceType === 'content';
                      }).length,
                      0
                    );

                    // Verify we only get groups from a group search
                    SearchTestsUtil.searchRefreshed(
                      jack.restContext,
                      'general',
                      null,
                      { resourceTypes: 'group', q: jack.user.displayName },
                      (err, results) => {
                        assert.ok(!err);
                        assert.ok(_getDocById(results, group.id));
                        assert.strictEqual(
                          _.filter(results.results, result => {
                            return result.resourceType === 'user';
                          }).length,
                          0
                        );
                        assert.strictEqual(
                          _.filter(results.results, result => {
                            return result.resourceType === 'content';
                          }).length,
                          0
                        );

                        // Verify we only get content from a content search
                        SearchTestsUtil.searchRefreshed(
                          jack.restContext,
                          'general',
                          null,
                          { resourceTypes: 'content', q: jack.user.displayName },
                          (err, results) => {
                            assert.ok(!err);
                            assert.ok(_getDocById(results, content.id));
                            assert.strictEqual(
                              _.filter(results.results, result => {
                                return result.resourceType === 'user';
                              }).length,
                              0
                            );
                            assert.strictEqual(
                              _.filter(results.results, result => {
                                return result.resourceType === 'group';
                              }).length,
                              0
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
      });
    });

    /**
     * Test that verifies that only a limited number of results that can be retrieved per request
     */
    it('verify limit parameter validation', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 35, (err, users) => {
        assert.ok(!err);
        const jackCtx = _.values(users)[0].restContext;

        // Verify that the limit parameter is respected.
        SearchTestsUtil.searchRefreshed(jackCtx, 'general', null, { limit: 8 }, (err, results) => {
          assert.ok(!err);
          assert.strictEqual(results.results.length, 8);

          // Verify that searches have an upper limit.
          RestAPI.Search.search(jackCtx, 'general', null, { limit: 1000 }, (err, results) => {
            assert.ok(!err);
            assert.strictEqual(results.results.length, 25);

            // Verify that searches have a lower limit.
            RestAPI.Search.search(jackCtx, 'general', null, { limit: -1 }, (err, results) => {
              assert.ok(!err);
              assert.strictEqual(results.results.length, 1);

              // Verify that searches have a lower limit.
              RestAPI.Search.search(jackCtx, 'general', null, { limit: 0 }, (err, results) => {
                assert.ok(!err);
                assert.strictEqual(results.results.length, 1);
                callback();
              });
            });
          });
        });
      });
    });
  });
});
