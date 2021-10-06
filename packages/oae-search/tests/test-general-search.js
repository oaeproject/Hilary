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

import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import { assertSetGroupMembersSucceeds } from 'oae-principals/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util.js';
import * as TestsUtil from 'oae-tests';
import * as SearchTestsUtil from 'oae-search/lib/test/util.js';
import { buildIndex } from 'oae-search/lib/api.js';

import {
  compose,
  lt,
  concat,
  nth,
  forEach,
  filter,
  prop,
  reject,
  isNil,
  length,
  map,
  last,
  path,
  head,
  find,
  gte,
  findIndex,
  propEq,
  not,
  values,
  equals,
  assoc,
  of,
  pair
} from 'ramda';

const EMPTY_STRING = '';
const PUBLIC = 'public';
const PRIVATE = 'private';
const LOGGED_IN = 'loggedin';
const LOCALHOST = 'localhost';
const NO = 'no';
const targetInternalUrl = null;

const USER = 'user';
const GROUP = 'group';
const GENERAL_SEARCH = 'general';
const CONTENT = 'content';
const MEMBER = 'member';
const DISCUSSION = 'discussion';
const LINK = 'link';
const PASSWORD = 'password';

const JOINABLE = 'yes';
const NOT_JOINABLE = 'no';
const JOINABLE_BY_REQUEST = 'request';
const NO_PARAMS = null;
const NO_FOLDERS = [];
const NO_MANAGERS = [];
const NO_MEMBERS = [];
const NO_VIEWERS = [];
const NO_OPTIONS = {};

const as = prop('restContext');
const publicUser = prop('publicUser');
const privateUser = prop('privateUser');
const asPublicUserOn = compose(as, publicUser);
const asPrivateUserOn = compose(as, privateUser);
const asAdminUserOn = prop('adminRestContext');
const asAnonymousUserOn = prop('anonymousRestContext');

const somePublicUserFrom = path(['publicUser', 'user']);
const somePrivateUserFrom = path(['privateUser', 'user']);
const someLoggedInUserFrom = path(['loggedinUser', 'user']);

const somePrivateJoinableGroupFrom = prop('privateJoinableGroup');
const somePrivateNotJoinableGroupFrom = prop('privateNotJoinableGroup');
const someLoggedinNotJoinableGroup = prop('loggedinNotJoinableGroup');
const somePublicGroupFrom = prop('publicGroup');

const ALL_SCOPE = '_all';
const NETWORK_SCOPE = '_network';
const INTERACT_SCOPE = '_interact';
const TENANT_SCOPE = '_tenant';
const MY_SCOPE = '_my';

const shouldBeAbleToFindIt = true;
const shouldNotBeAbleToFindIt = false;
const shouldNotFindContent = false;
const shouldFindContent = true;
const shouldNotFindDiscussion = false;
const shouldFindDiscussion = true;

const returns401 = compose(equals(401), prop('code'));
const isUser = equals(USER);
const isGroup = equals(GROUP);
const isContent = equals(CONTENT);
const isResourceTypeAGroup = filter(propEq('resourceType', GROUP));
const isResourceTypeAContent = filter(propEq('resourceType', CONTENT));
const isResourceTypeAUser = filter(propEq('resourceType', USER));
const getId = prop('id');
const getTenantAlias = path(['tenant', 'alias']);
const getVisibility = prop('visibility');
const getDisplayName = prop('displayName');
const getResourceType = prop('resourceType');
const getResultsWithin = prop('results');
const getLastModified = compose(parseInt, prop('lastModified'));
const numberOfResults = compose(length, getResultsWithin);

const getGroupIds = compose(reject(isNil), map(path(['group', 'id'])), last);

const { reindexAll, searchAll, deleteAll, searchRefreshed } = SearchTestsUtil;
const {
  createTenantWithAdmin,
  setupMultiTenantPrivacyEntities,
  generateTestEmailAddress,
  generateTestUserId,
  generateRandomText,
  generateGroupHierarchy,
  generateTestGroups,
  generateTestUsers,
  clearAllData,
  createTenantAdminRestContext,
  createGlobalAdminRestContext,
  createTenantRestContext
} = TestsUtil;
const { generateTestTenantHost, generateTestTenantAlias } = TenantsTestUtil;
const { getResourceFromId } = AuthzUtil;
const { updateConfigAndWait } = ConfigTestUtil;

const { loginOnTenant } = RestAPI.Admin;
const { createUser, updateUser } = RestAPI.User;
const { setGroupMembers, createGroup, updateGroup } = RestAPI.Group;
const { createLink, deleteContent, deleteComment, updateContent, createComment } = RestAPI.Content;
const { deleteDiscussion, deleteMessage, createMessage, createDiscussion } = RestAPI.Discussions;
const { search } = RestAPI.Search;

const isWithin = (results, documentId) => gte(findIndex(propEq('id', documentId), getResultsWithin(results)), 0);
const isNotWithin = compose(not, isWithin);
const fetchWithin = (results, documentId) => find(propEq('id', documentId), getResultsWithin(results));
const numberOf = compose(length, prop('results'));
const numberOfGroupsResults = compose(length, isResourceTypeAGroup, getResultsWithin);
const numberOfContentResults = compose(length, isResourceTypeAContent, getResultsWithin);
const numberOfUserResults = compose(length, isResourceTypeAUser, getResultsWithin);

describe('General Search', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let asCambridgeAnonymousUser = null;
  let asGeorgiaAnonymousUser = null;

  // Rest contexts that can be used every time we need to make a request as a tenant admin
  let asCambridgeTenantAdmin = null;
  let asGeorgiaTenantAdmin = null;

  // Rest context that can be used every time we need to make a request as a global admin
  let asGlobalAdmin = null;
  let asGlobalAdminOnTenant = null;

  /**
   * Lets delete the index, recreate it, and create the mappings as a hook to each describe block
   */
  const rebuildSearchIndex = (done) => {
    const destroyItAllEveryTest = true;
    buildIndex(destroyItAllEveryTest, (error) => {
      assert.notExists(error);

      done();
    });
  };

  /**
   * Get the index of a user in a set of search results
   *
   * @param  {Object}     results     The search results as returend by `RestAPI.Search.search`
   * @param  {String}     id          The user id to get the index for
   * @return {Number}                 The index of the user in the search results array. Defaults to `-1` if the user could not be found
   */
  const findIndexWithin = (results, id) => findIndex(propEq('id', id), getResultsWithin(results));

  /**
   * Function that will fill up the anonymous and admin REST context.
   *
   * Because we truncate the `Principals` table in one of our tests we need
   * to re-create the rest contexts for each test so we can ensure our admin
   * session will always point to a valid principal record
   */
  beforeEach((done) => {
    const someTenantHost = global.oaeTests.tenants.cam.host;
    asCambridgeAnonymousUser = createTenantRestContext(someTenantHost);
    asCambridgeTenantAdmin = createTenantAdminRestContext(someTenantHost);

    const otherTenantHost = global.oaeTests.tenants.gt.host;
    asGeorgiaAnonymousUser = createTenantRestContext(otherTenantHost);
    asGeorgiaTenantAdmin = createTenantAdminRestContext(otherTenantHost);

    asGlobalAdmin = createGlobalAdminRestContext();

    /**
     * Log the global admin into a tenant so we can perform user-tenant requests with a
     * global admin to test their access
     */
    loginOnTenant(asGlobalAdmin, LOCALHOST, targetInternalUrl, (error, ctx) => {
      assert.notExists(error);
      asGlobalAdminOnTenant = ctx;

      done();
    });
  });

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
  const searchForResource = function (restCtx, scope, resource, expectedToFind, callback) {
    searchRefreshed(
      restCtx,
      GENERAL_SEARCH,
      NO_PARAMS,
      { scope, resourceTypes: getResourceType(resource), q: getDisplayName(resource) },
      (error, results) => {
        assert.notExists(error);

        const foundResourceDoc = isWithin(results, getId(resource));

        if (expectedToFind) {
          assert.ok(foundResourceDoc);
        } else {
          assert.isNotOk(foundResourceDoc);
        }

        return callback();
      }
    );
  };

  describe('User Indexing', () => {
    before(rebuildSearchIndex);

    /**
     * Test that verifies a created user can be searched.
     */
    it('verify index created user', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = values(users);

        // Verify we can search for the user
        searchRefreshed(
          asCambridgeAnonymousUser,
          GENERAL_SEARCH,
          NO_PARAMS,
          { resourceTypes: USER, q: johnDoe.user.displayName },
          (error, results) => {
            assert.notExists(error);
            assert.ok(isWithin(results, johnDoe.user.id));

            return callback();
          }
        );
      });
    });

    /**
     * Test that verifies the search index is updated when a user is updated.
     */
    it('verify index updated user', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: lopes } = values(users);
        const asLopes = lopes.restContext;
        const lopesId = lopes.user.id;

        // First check that the user does not match on the term 'Visser'
        searchRefreshed(
          asCambridgeAnonymousUser,
          GENERAL_SEARCH,
          NO_PARAMS,
          { resourceTypes: USER, q: 'Barbosa' },
          (error, results) => {
            assert.notExists(error);
            assert.ok(isNotWithin(results, lopesId));

            // Set the display name of the user
            const updateProperties = { displayName: 'Lopes da Silva' + lopesId };

            updateUser(asLopes, lopesId, updateProperties, (error_) => {
              assert.notExists(error_);

              // Ensure that the new term matches the user
              searchRefreshed(
                asCambridgeAnonymousUser,
                GENERAL_SEARCH,
                NO_PARAMS,
                { resourceTypes: USER, q: updateProperties.displayName },
                (error, results) => {
                  assert.notExists(error);

                  const searchedDoc = isWithin(results, lopesId);
                  assert.ok(searchedDoc);
                  assert.notExists(searchedDoc._extra);

                  // There should not be a doc.extra because there are no extension properties on the user
                  assert.notExists(searchedDoc.extra);

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
    before(rebuildSearchIndex);
    /**
     * Test that verifies a newly created group can be searched.
     */
    it('verify index created group', (callback) => {
      generateTestGroups(asCambridgeTenantAdmin, 1, (error, groups) => {
        assert.notExists(error);

        const [oaeTeam] = groups;

        searchRefreshed(
          asCambridgeAnonymousUser,
          GENERAL_SEARCH,
          NO_PARAMS,
          { resourceTypes: GROUP, q: oaeTeam.group.displayName },
          (error, results) => {
            assert.notExists(error);

            assert.ok(isWithin(results, oaeTeam.group.id));
            return callback();
          }
        );
      });
    });

    /**
     * Test that verifies the search index is updated when a group is updated.
     */
    it('verify index updated group', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = values(users);
        const asJohnDoe = johnDoe.restContext;

        generateTestGroups(asJohnDoe, 1, (error, groups) => {
          assert.notExists(error);

          const [amazingTeam] = groups;
          const amazingTeamId = amazingTeam.group.id;
          const amazingTeamName = amazingTeam.group.displayName;

          searchRefreshed(
            asJohnDoe,
            GENERAL_SEARCH,
            NO_PARAMS,
            { resourceTypes: GROUP, q: amazingTeamName },
            (error, results) => {
              assert.notExists(error);

              const searchedDoc = fetchWithin(results, amazingTeamId);
              assert.ok(searchedDoc);
              assert.strictEqual(getDisplayName(searchedDoc), amazingTeamName);
              assert.strictEqual(getResourceType(searchedDoc), GROUP);
              assert.strictEqual(
                searchedDoc.profilePath,
                concat(`/group/${getTenantAlias(searchedDoc)}`, `/${getResourceFromId(getId(searchedDoc)).resourceId}`)
              );

              // Update name match the term to something different to make sure it reindexed properly
              const displayName = 'The Backstreet Boys';

              updateGroup(asJohnDoe, amazingTeamId, { displayName }, (error_) => {
                assert.notExists(error_);

                searchRefreshed(
                  asJohnDoe,
                  GENERAL_SEARCH,
                  NO_PARAMS,
                  { resourceTypes: GROUP, q: displayName },
                  (error, results) => {
                    assert.notExists(error);

                    const searchedDoc = fetchWithin(results, amazingTeamId);
                    assert.ok(searchedDoc);
                    assert.strictEqual(getDisplayName(searchedDoc), displayName);
                    assert.strictEqual(getResourceType(searchedDoc), GROUP);
                    assert.strictEqual(
                      searchedDoc.profilePath,
                      concat(
                        `/group/${getTenantAlias(searchedDoc)}`,
                        `/${getResourceFromId(getId(searchedDoc)).resourceId}`
                      )
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
    before(rebuildSearchIndex);
    /**
     * Test that verifies that a content item can be searched after it has been created.
     */
    it('verify index created content', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, createdUsers) => {
        assert.notExists(error);

        const { 0: barbosa } = createdUsers;
        const asBarbosa = barbosa.restContext;

        createLink(
          asBarbosa,
          {
            displayName: 'Apereo Foundation',
            description: 'Link to Apereo Foundation Website',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, someLink) => {
            assert.notExists(error);

            // Verify search term Apereo matches the document
            searchRefreshed(
              asBarbosa,
              GENERAL_SEARCH,
              NO_PARAMS,
              { resourceTypes: CONTENT, q: 'Apereo' },
              (error, results) => {
                assert.notExists(error);
                assert.ok(isWithin(results, getId(someLink)));
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
    it('verify index updated content', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: fonseca } = users;
        const asFonseca = fonseca.restContext;

        createLink(
          asFonseca,
          {
            displayName: 'Apereo Foundation',
            description: 'Link to Apereo Foundation Website',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, someLink) => {
            assert.notExists(error);

            // Verify search term OAE does not match the content
            searchRefreshed(
              asFonseca,
              GENERAL_SEARCH,
              NO_PARAMS,
              { resourceTypes: CONTENT, q: 'OAE' },
              (error, results) => {
                assert.notExists(error);
                assert.ok(isNotWithin(results, getId(someLink)));

                // Update the content
                updateContent(asFonseca, getId(someLink), { displayName: 'OAE Project' }, (error_) => {
                  assert.notExists(error_);

                  // Verify OAE now matches the updated content item
                  searchRefreshed(
                    asFonseca,
                    GENERAL_SEARCH,
                    NO_PARAMS,
                    { resourceTypes: CONTENT, q: 'OAE' },
                    (error, results) => {
                      assert.notExists(error);
                      assert.ok(isWithin(results, getId(someLink)));
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
    it('verify index content comments', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, createdUsers) => {
        assert.notExists(error);

        const { 0: lopes } = createdUsers;
        const asLopes = lopes.restContext;

        const searchTerm = 'zxkdjfhdjghdjrghsfhgjsldkfjghsldkjfgh';

        createLink(
          asLopes,
          {
            displayName: 'Apereo Foundation',
            description: 'Link to Apereo Foundation Website',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, someLink) => {
            assert.notExists(error);

            // Verify the search term does not match the content item we just created
            searchAll(
              asLopes,
              GENERAL_SEARCH,
              NO_PARAMS,
              { resourceTypes: CONTENT, q: searchTerm },
              (error, results) => {
                assert.notExists(error);
                assert.ok(isNotWithin(results, someLink.id));

                // Create a comment on the content item
                createComment(asLopes, someLink.id, searchTerm, null, (error, someComment) => {
                  assert.notExists(error);

                  // Verify the search term matches the content item we just commented on
                  searchAll(
                    asLopes,
                    GENERAL_SEARCH,
                    NO_PARAMS,
                    { resourceTypes: CONTENT, q: searchTerm },
                    (error, results) => {
                      assert.notExists(error);
                      assert.ok(isWithin(results, getId(someLink)));

                      // Now delete the message
                      deleteComment(asLopes, getId(someLink), someComment.created, (error_) => {
                        assert.notExists(error_);

                        // Verify the search term no longer matches the content item
                        searchAll(
                          asLopes,
                          GENERAL_SEARCH,
                          NO_PARAMS,
                          { resourceTypes: CONTENT, q: searchTerm },
                          (error, results) => {
                            assert.notExists(error);
                            assert.ok(isNotWithin(results, getId(someLink)));

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
    before(rebuildSearchIndex);
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
    const _verifySearchResults = function (
      restContext,
      contentId,
      discussionId,
      shouldFindContent,
      shouldFindDiscussion,
      searchTerm,
      callback
    ) {
      /**
       * Verify the specified search state with all permutations of the
       * applicable `resourceTypes` parameters
       */
      searchAll(restContext, GENERAL_SEARCH, null, { resourceTypes: DISCUSSION, q: searchTerm }, (error, results) => {
        assert.notExists(error);
        assert.ok(isNotWithin(results, contentId));
        assert.strictEqual(isWithin(results, discussionId), shouldFindDiscussion);

        searchAll(restContext, GENERAL_SEARCH, null, { resourceTypes: CONTENT, q: searchTerm }, (error, results) => {
          assert.notExists(error);
          assert.strictEqual(isWithin(results, contentId), shouldFindContent);
          assert.ok(isNotWithin(results, discussionId));

          searchAll(
            restContext,
            GENERAL_SEARCH,
            NO_PARAMS,
            { resourceTypes: [DISCUSSION, CONTENT], q: searchTerm },
            (error, results) => {
              assert.notExists(error);
              assert.strictEqual(isWithin(results, contentId), shouldFindContent);
              assert.strictEqual(isWithin(results, discussionId), shouldFindDiscussion);

              searchAll(restContext, GENERAL_SEARCH, null, { q: searchTerm }, (error, results) => {
                assert.notExists(error);
                assert.strictEqual(isWithin(results, contentId), shouldFindContent);
                assert.strictEqual(isWithin(results, discussionId), shouldFindDiscussion);

                return callback();
              });
            }
          );
        });
      });
    };

    /**
     * Test that verifies content and discussions are searchable by their messages.
     * Also verifies that messages that are
     * deleted no longer cause the content and discussion items to be returned in search
     */
    it('verify discussion and content items can be searched by messages and comments', (callback) => {
      // Create the user to test with
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, createdUsers) => {
        assert.notExists(error);

        const { 0: silva } = createdUsers;
        const asSilva = silva.restContext;

        const searchTerm = 'zxkdjfhdjghdjrghsfhgjsldkfjghsldkjfgh';

        // Create the content item and discussion we will test searching for
        createLink(
          asSilva,
          {
            displayName: 'Apereo Foundation',
            description: 'Link to Apereo Foundation Website',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, someLink) => {
            assert.notExists(error);

            createDiscussion(
              asSilva,
              'How about them Leafs?',
              'Official Toronto Maple Leafs Thread',
              PUBLIC,
              NO_MANAGERS,
              NO_MEMBERS,
              (error, someDiscussion) => {
                assert.notExists(error);

                /**
                 * Verify that we do not get the content item or discussion in
                 * any of the search resourceTypes permutations
                 */
                const cannotSearchContent = false;
                const maySearchContent = true;
                const cannotSearchDiscussion = false;
                const maySearchDiscussion = true;

                _verifySearchResults(
                  asSilva,
                  getId(someLink),
                  getId(someDiscussion),
                  cannotSearchContent,
                  cannotSearchDiscussion,
                  searchTerm,
                  () => {
                    // Create a comment on the content item
                    createComment(asSilva, getId(someLink), searchTerm, null, (error, someComment) => {
                      assert.notExists(error);

                      /**
                       * Verify that we get the content item but not the discussion
                       * item in the applicable search resourceTypes permutations
                       */
                      _verifySearchResults(
                        asSilva,
                        getId(someLink),
                        getId(someDiscussion),
                        maySearchContent,
                        cannotSearchDiscussion,
                        searchTerm,
                        () => {
                          // Post a message on the discussion
                          createMessage(asSilva, getId(someDiscussion), searchTerm, null, (error, someMessage) => {
                            assert.notExists(error);

                            // Verify that we get both the content item and discussion item in the applicable search resourceTypes permutations
                            _verifySearchResults(
                              asSilva,
                              getId(someLink),
                              getId(someDiscussion),
                              maySearchContent,
                              maySearchDiscussion,
                              searchTerm,
                              () => {
                                // Delete the content comment
                                deleteComment(asSilva, getId(someLink), someComment.created, (error_) => {
                                  assert.notExists(error_);

                                  // Verify that we get do not get the content item in the applicable search resourceTypes permutations
                                  _verifySearchResults(
                                    asSilva,
                                    getId(someLink),
                                    getId(someDiscussion),
                                    cannotSearchContent,
                                    maySearchDiscussion,
                                    searchTerm,
                                    () => {
                                      // Delete the discussion message
                                      deleteMessage(asSilva, getId(someDiscussion), someMessage.created, (error_) => {
                                        assert.notExists(error_);

                                        /**
                                         * Verify that we don't get the content item nor the
                                         * discussion in any search resourceTypes permutation
                                         */
                                        return _verifySearchResults(
                                          asSilva,
                                          getId(someLink),
                                          getId(someDiscussion),
                                          cannotSearchContent,
                                          cannotSearchDiscussion,
                                          searchTerm,
                                          callback
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
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that invoking reindexAll on an empty search
     * index results in content and discussion items to be indexed
     * appropriately with their messages.
     */
    it('verify reindexAll reindexes messages as children of their parent resource items', (callback) => {
      // Clear all the data in the system to speed up the `reindexAll` operation in this test
      clearAllData(() => {
        // Create the user to test with
        generateTestUsers(asCambridgeTenantAdmin, 1, (error, createdUsers) => {
          assert.notExists(error);

          const { 0: horacio } = createdUsers;
          const asHoracio = horacio.restContext;

          const searchTerm = 'zxkdjfhdjghdjrghsfhgjsldkfjghsldkjfgh';

          // Create the content item and discussion we will test searching for
          createLink(
            asHoracio,
            {
              displayName: 'Apereo Foundation',
              description: 'Link to Apereo Foundation Website',
              visibility: PUBLIC,
              link: 'http://www.apereo.org',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, someLink) => {
              assert.notExists(error);

              createDiscussion(
                asHoracio,
                'How about them Leafs?',
                'Official Toronto Maple Leafs Thread',
                PUBLIC,
                NO_MANAGERS,
                NO_MEMBERS,
                (error, someDiscussion) => {
                  assert.notExists(error);

                  /**
                   * Verify that we do not get the content item or discussion in
                   * any of the search resourceTypes permutations
                   */
                  _verifySearchResults(
                    asHoracio,
                    getId(someLink),
                    getId(someDiscussion),
                    shouldNotFindContent,
                    shouldNotFindDiscussion,
                    searchTerm,
                    () => {
                      // Create a comment and message on the content item and discussion
                      createComment(asHoracio, getId(someLink), searchTerm, null, (error_) => {
                        assert.notExists(error_);

                        createMessage(asHoracio, getId(someDiscussion), searchTerm, null, (error_) => {
                          assert.notExists(error_);

                          // Ensure both the content item and message are searchable by their messages
                          _verifySearchResults(
                            asHoracio,
                            getId(someLink),
                            getId(someDiscussion),
                            shouldFindContent,
                            shouldFindDiscussion,
                            searchTerm,
                            () => {
                              // Delete the search index
                              deleteAll(() => {
                                // Ensure we can no longer search for either content or discussion item
                                _verifySearchResults(
                                  asHoracio,
                                  getId(someLink),
                                  getId(someDiscussion),
                                  shouldNotFindContent,
                                  shouldNotFindDiscussion,
                                  searchTerm,
                                  () => {
                                    reindexAll(createGlobalAdminRestContext(), () =>
                                      /**
                                       * Ensure we can now search both content and
                                       * discussion item again by their message bodies
                                       */
                                      _verifySearchResults(
                                        asHoracio,
                                        getId(someLink),
                                        getId(someDiscussion),
                                        shouldFindContent,
                                        shouldFindDiscussion,
                                        searchTerm,
                                        callback
                                      )
                                    );
                                  }
                                );
                              });
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
      });
    });

    /**
     * Verify deleting a content item and discussion only deletes message documents for the deleted resources
     */
    it('verify deleting resources only deletes its own children documents', (callback) => {
      // Create the user to test with
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: lopes } = users;
        const asLopes = lopes.restContext;

        const searchTerm = 'zxkdjfhdjghdjrghsfhgjsldkfjghsldkjfgh';

        // Create the content items and discussions we will test deleting and searching for
        createLink(
          asLopes,
          {
            displayName: 'Apereo Foundation',
            description: 'Link to Apereo Foundation Website',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, someLink) => {
            assert.notExists(error);

            createLink(
              asLopes,
              {
                displayName: 'Apereo Foundation',
                description: 'Link to Apereo Foundation Website',
                visibility: PUBLIC,
                link: 'http://www.apereo.org',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, otherLink) => {
                assert.notExists(error);

                createDiscussion(
                  asLopes,
                  'How about them Leafs?',
                  'Official Toronto Maple Leafs Thread',
                  PUBLIC,
                  NO_MANAGERS,
                  NO_MEMBERS,
                  (error, someDiscussion) => {
                    assert.notExists(error);

                    createDiscussion(
                      asLopes,
                      'How about them Leafs?',
                      'Official Toronto Maple Leafs Thread',
                      PUBLIC,
                      NO_MANAGERS,
                      NO_MEMBERS,
                      (error, otherDiscussion) => {
                        assert.notExists(error);

                        // Create comments and messages on all the content and discussion items
                        createComment(asLopes, getId(someLink), searchTerm, null, (error_) => {
                          assert.notExists(error_);

                          createComment(asLopes, getId(otherLink), searchTerm, null, (error_) => {
                            assert.notExists(error_);

                            createMessage(asLopes, getId(someDiscussion), searchTerm, null, (error_) => {
                              assert.notExists(error_);

                              createMessage(asLopes, getId(otherDiscussion), searchTerm, null, (error_) => {
                                assert.notExists(error_);

                                // Verify we can search for both content items and discussions using the message search term
                                _verifySearchResults(
                                  asLopes,
                                  getId(someLink),
                                  getId(someDiscussion),
                                  shouldFindContent,
                                  shouldFindDiscussion,
                                  searchTerm,
                                  () => {
                                    _verifySearchResults(
                                      asLopes,
                                      getId(otherLink),
                                      getId(otherDiscussion),
                                      shouldFindContent,
                                      shouldFindDiscussion,
                                      searchTerm,
                                      () => {
                                        // Delete just the 2nd content item and the 2nd discussion
                                        deleteContent(asLopes, getId(otherLink), (error_) => {
                                          assert.notExists(error_);

                                          deleteDiscussion(asLopes, getId(otherDiscussion), (error_) => {
                                            assert.notExists(error_);

                                            // Ensure that the non-deleted content and discussion are searchable, while the 2nd ones are not
                                            _verifySearchResults(
                                              asLopes,
                                              getId(someLink),
                                              getId(someDiscussion),
                                              shouldFindContent,
                                              shouldFindDiscussion,
                                              searchTerm,
                                              () =>
                                                _verifySearchResults(
                                                  asLopes,
                                                  getId(otherLink),
                                                  getId(otherDiscussion),
                                                  shouldNotFindContent,
                                                  shouldNotFindDiscussion,
                                                  searchTerm,
                                                  callback
                                                )
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

  describe('General Search Parameters', () => {
    before(rebuildSearchIndex);
    /**
     * Verifies empty, null, and valid values for both single and array
     * lookups using the resourceTypes parameter.
     */
    it('verify a variety of valid and invalid values for the resourceTypes parameter', (callback) => {
      /*!
       * Helper function that verifies that a search result feed has (or doesn't have) results of certain resourceTypes
       *
       * @param  {SearchResult}   results             The search results object
       * @param  {Boolean}        shouldHaveUser      Whether or not the results should contain a user object
       * @param  {Boolean}        shouldHaveGroup     Whether or not the results should contain a group object
       * @param  {Boolean}        shouldHaveContent   Whether or not the results should contain a content object
       * @return {Object}                             The search document. `null` if it didn't exist
       */
      const _verifyHasResourceTypes = (results, shouldFindUser, shouldFindGroup, shouldFindContent) => {
        let hasUser = false;
        let hasGroup = false;
        let hasContent = false;

        forEach((eachResult) => {
          if (isUser(getResourceType(eachResult))) {
            hasUser = true;
          } else if (isGroup(getResourceType(eachResult))) {
            hasGroup = true;
          } else if (isContent(getResourceType(eachResult))) {
            hasContent = true;
          }
        }, prop('results', results));

        assert.strictEqual(shouldFindUser, hasUser);
        assert.strictEqual(shouldFindGroup, hasGroup);
        assert.strictEqual(shouldFindContent, hasContent);
      };

      const shouldFindUser = true;
      const shouldNotFindUser = false;
      const shouldFindGroup = true;
      const shouldNotFindGroup = false;
      const shouldFindContent = true;
      const shouldNotFindContent = false;

      // Ensure at least one user, group and content item exists
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = users;
        const asJohnDoe = johnDoe.restContext;
        const johnsName = johnDoe.user.displayName;

        createGroup(asJohnDoe, johnsName, johnsName, PUBLIC, NO, NO_MANAGERS, NO_MEMBERS, (error_) => {
          assert.notExists(error_);

          createLink(
            asJohnDoe,
            {
              displayName: johnsName,
              description: johnsName,
              visibility: PUBLIC,
              link: 'http://www.apereo.org',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error_) => {
              assert.notExists(error_);

              // Verify unspecified resourceTypes searches all
              searchRefreshed(asJohnDoe, GENERAL_SEARCH, NO_PARAMS, { q: johnsName }, (error, results) => {
                assert.notExists(error);

                _verifyHasResourceTypes(results, shouldFindUser, shouldFindGroup, shouldFindContent);

                // Verify empty resourceTypes searches all
                search(
                  asJohnDoe,
                  GENERAL_SEARCH,
                  null,
                  { resourceTypes: EMPTY_STRING, q: johnsName },
                  (error, results) => {
                    assert.notExists(error);

                    _verifyHasResourceTypes(results, shouldFindUser, shouldFindGroup, shouldFindContent);

                    // Verify non-matching single resource type returns nothing
                    search(
                      asJohnDoe,
                      GENERAL_SEARCH,
                      NO_PARAMS,
                      { resourceTypes: 'not-matching-anything', q: johnsName },
                      (error, results) => {
                        assert.notExists(error);
                        assert.strictEqual(results.results.length, 0);

                        // Verify each single resourceType searches just that one
                        search(
                          asJohnDoe,
                          GENERAL_SEARCH,
                          NO_PARAMS,
                          { resourceTypes: USER, q: johnsName },
                          (error, results) => {
                            assert.notExists(error);

                            _verifyHasResourceTypes(results, shouldFindUser, shouldNotFindGroup, shouldNotFindContent);

                            search(
                              asJohnDoe,
                              GENERAL_SEARCH,
                              NO_PARAMS,
                              { resourceTypes: GROUP, q: johnsName },
                              (error, results) => {
                                assert.notExists(error);

                                _verifyHasResourceTypes(
                                  results,
                                  shouldNotFindUser,
                                  shouldFindGroup,
                                  shouldNotFindContent
                                );

                                search(
                                  asJohnDoe,
                                  GENERAL_SEARCH,
                                  NO_PARAMS,
                                  { resourceTypes: CONTENT },
                                  (error, results) => {
                                    assert.notExists(error);

                                    _verifyHasResourceTypes(
                                      results,
                                      shouldNotFindUser,
                                      shouldNotFindGroup,
                                      shouldFindContent
                                    );

                                    // Verify searching 2 returns just the 2 types
                                    search(
                                      asJohnDoe,
                                      GENERAL_SEARCH,
                                      NO_PARAMS,
                                      {
                                        resourceTypes: [GROUP, CONTENT],
                                        q: johnsName
                                      },
                                      (error, results) => {
                                        assert.notExists(error);

                                        _verifyHasResourceTypes(
                                          results,
                                          shouldNotFindUser,
                                          shouldFindGroup,
                                          shouldFindContent
                                        );

                                        // Verify searching one with garbage commas returns just the one
                                        search(
                                          asJohnDoe,
                                          GENERAL_SEARCH,
                                          NO_PARAMS,
                                          {
                                            resourceTypes: [EMPTY_STRING, EMPTY_STRING, CONTENT, EMPTY_STRING],
                                            q: johnsName
                                          },
                                          (error, results) => {
                                            assert.notExists(error);

                                            _verifyHasResourceTypes(
                                              results,
                                              shouldNotFindUser,
                                              shouldNotFindGroup,
                                              shouldFindContent
                                            );

                                            // Verify searching two with garbage commas returns just the two
                                            search(
                                              asJohnDoe,
                                              GENERAL_SEARCH,
                                              NO_PARAMS,
                                              {
                                                resourceTypes: [
                                                  EMPTY_STRING,
                                                  EMPTY_STRING,
                                                  USER,
                                                  CONTENT,
                                                  EMPTY_STRING,
                                                  EMPTY_STRING
                                                ],
                                                q: johnsName
                                              },
                                              (error, results) => {
                                                assert.notExists(error);

                                                _verifyHasResourceTypes(
                                                  results,
                                                  shouldFindUser,
                                                  shouldNotFindGroup,
                                                  shouldFindContent
                                                );

                                                // Verify searching with garbage commas and non-matching values still returns by the valid resources types
                                                search(
                                                  asJohnDoe,
                                                  GENERAL_SEARCH,
                                                  NO_PARAMS,
                                                  {
                                                    resourceTypes: [
                                                      EMPTY_STRING,
                                                      EMPTY_STRING,
                                                      'non-matching',
                                                      EMPTY_STRING,
                                                      GROUP,
                                                      USER
                                                    ],
                                                    q: johnsName
                                                  },
                                                  (error, results) => {
                                                    assert.notExists(error);

                                                    _verifyHasResourceTypes(
                                                      results,
                                                      shouldFindUser,
                                                      shouldFindGroup,
                                                      shouldNotFindContent
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
        });
      });
    });
  });

  describe('Search Paging', () => {
    before(rebuildSearchIndex);
    /**
     * Test that verifies that the 'start' property properly pages search results
     */
    it('verify search paging', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: barbosa } = users;
        const asBarbosa = barbosa.restContext;

        /**
         *  Make sure we have at least 2 content items to page with,
         * their actual information is not important for this test
         */

        createLink(
          asBarbosa,
          {
            displayName: 'OAE Project',
            description: 'Link to OAE Project Website',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error /* , link */) => {
            assert.notExists(error);

            createLink(
              asBarbosa,
              {
                displayName: 'Apereo Foundation',
                description: 'Link to Apereo Foundation Website',
                visibility: PUBLIC,
                link: 'http://www.apereo.org',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error /* , link */) => {
                assert.notExists(error);

                // Search once and grab the first document id
                searchRefreshed(asBarbosa, GENERAL_SEARCH, null, { limit: 1 }, (error, results) => {
                  assert.notExists(error);
                  assert.ok(results);
                  assert.ok(results.results);
                  assert.strictEqual(numberOf(results), 1);

                  const firstFoundDoc = prop('id', head(getResultsWithin(results)));
                  assert.ok(firstFoundDoc);

                  // Perform the same search, but with start=0, and make sure the first document is still the same. Verifies default paging
                  search(asBarbosa, GENERAL_SEARCH, null, { limit: 1, start: 0 }, (error, results) => {
                    assert.notExists(error);
                    assert.ok(results);
                    assert.ok(results.results);
                    assert.strictEqual(numberOf(results), 1);
                    assert.strictEqual(prop('id', head(getResultsWithin(results))), firstFoundDoc);

                    // Search again with start=1 and verify the first document id of the previous search is not the same as the first document id of this search
                    search(asBarbosa, GENERAL_SEARCH, null, { limit: 1, start: 1 }, (error, results) => {
                      assert.notExists(error);
                      assert.ok(results);
                      assert.ok(getResultsWithin(results));
                      assert.strictEqual(numberOf(results), 1);

                      const secondDocId = prop('id', head(getResultsWithin(results)));
                      assert.ok(secondDocId);

                      assert.notStrictEqual(firstFoundDoc, secondDocId);
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
    it('verify search total count', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: silva } = users;
        const asSilva = silva.restContext;

        // Make sure we have at least 2 similar content items
        createLink(
          asSilva,
          {
            displayName: 'Apereo OAE',
            description: 'Link to OAE Project Website',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error_) => {
            assert.notExists(error_);

            createLink(
              asSilva,
              {
                displayName: 'Apereo Foundation',
                description: 'Link to Apereo Foundation Website',
                visibility: PUBLIC,
                link: 'http://www.apereo.org',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error_) => {
                assert.notExists(error_);

                // Do a search so we know how many items there are in the index for this search term
                searchRefreshed(asSilva, GENERAL_SEARCH, null, { q: 'Apereo' }, (error, results) => {
                  assert.notExists(error);

                  /**
                   * When we only select a subset of the results,
                   * the count should reflect the total matching items in the index
                   */
                  search(
                    asSilva,
                    GENERAL_SEARCH,
                    NO_PARAMS,
                    { q: 'Apereo', start: 0, limit: 1 },
                    (error, startResults) => {
                      assert.notExists(error);
                      assert.strictEqual(results.total, startResults.total);
                      assert.strictEqual(numberOf(startResults), 1);

                      /**
                       * When we search for all the results,
                       * the count should reflect the total matching items in the index
                       */
                      searchAll(
                        asSilva,
                        GENERAL_SEARCH,
                        NO_PARAMS,
                        { q: 'Apereo', start: 0, limit: results.total },
                        (error, allResults) => {
                          assert.notExists(error);
                          assert.strictEqual(results.total, allResults.total);
                          assert.strictEqual(numberOf(allResults), results.total);

                          /**
                           * When we do a search with a higher start number than the total number,
                           * the count should reflect the total matching items in the index
                           */
                          search(
                            asSilva,
                            GENERAL_SEARCH,
                            NO_PARAMS,
                            { q: 'Apereo', start: results.total },
                            (error, emptyResults) => {
                              assert.notExists(error);
                              assert.strictEqual(results.total, emptyResults.total);
                              assert.strictEqual(numberOf(emptyResults), 0);

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
    before(rebuildSearchIndex);
    /**
     * Test that verifies that the _all scope searches everything from all tenants
     */
    it('verify "all" search scope searches resources from inside and outside the tenant network (but not private tenants)', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA /* , privateTenantB */) => {
        // It should search everything in the system when searching as the global administrator
        searchForResource(asGlobalAdmin, ALL_SCOPE, somePublicUserFrom(publicTenantA), true, () => {
          searchForResource(asGlobalAdmin, ALL_SCOPE, someLoggedInUserFrom(publicTenantA), true, () => {
            searchForResource(asGlobalAdmin, ALL_SCOPE, somePrivateUserFrom(publicTenantA), true, () => {
              searchForResource(asGlobalAdmin, ALL_SCOPE, somePublicUserFrom(privateTenantA), true, () => {
                searchForResource(asGlobalAdmin, ALL_SCOPE, someLoggedInUserFrom(privateTenantA), true, () => {
                  searchForResource(asGlobalAdmin, ALL_SCOPE, somePrivateUserFrom(privateTenantA), true, () => {
                    /**
                     * It should search public resources from public tenants but not private tenants when searching as a regular user
                     */

                    setupMultiTenantPrivacyEntities(
                      (/* publicTenant0, publicTenant1, privateTenant0, privateTenant1 */) => {
                        searchForResource(
                          asPublicUserOn(publicTenantA),
                          ALL_SCOPE,
                          somePublicUserFrom(publicTenantA),
                          shouldBeAbleToFindIt,
                          () => {
                            searchForResource(
                              asPublicUserOn(publicTenantA),
                              ALL_SCOPE,
                              someLoggedInUserFrom(publicTenantA),
                              shouldBeAbleToFindIt,
                              () => {
                                searchForResource(
                                  asPublicUserOn(publicTenantA),
                                  ALL_SCOPE,
                                  somePrivateUserFrom(publicTenantA),
                                  shouldNotBeAbleToFindIt,
                                  () => {
                                    searchForResource(
                                      asPublicUserOn(publicTenantA),
                                      ALL_SCOPE,
                                      somePublicUserFrom(privateTenantA),
                                      shouldNotBeAbleToFindIt,
                                      () => {
                                        searchForResource(
                                          asPublicUserOn(publicTenantA),
                                          ALL_SCOPE,
                                          someLoggedInUserFrom(privateTenantA),
                                          shouldNotBeAbleToFindIt,
                                          () => {
                                            searchForResource(
                                              asPublicUserOn(publicTenantA),
                                              ALL_SCOPE,
                                              somePrivateUserFrom(privateTenantA),
                                              shouldNotBeAbleToFindIt,
                                              () => {
                                                // It should search public resources from private tenants when searching as a private tenant user
                                                setupMultiTenantPrivacyEntities(
                                                  (
                                                    publicTenantA,
                                                    publicTenant1,
                                                    privateTenantA /* , privateTenant1 */
                                                  ) => {
                                                    searchForResource(
                                                      asPublicUserOn(privateTenantA),
                                                      ALL_SCOPE,
                                                      somePublicUserFrom(publicTenantA),
                                                      shouldNotBeAbleToFindIt,
                                                      () => {
                                                        searchForResource(
                                                          asPublicUserOn(privateTenantA),
                                                          ALL_SCOPE,
                                                          someLoggedInUserFrom(publicTenantA),
                                                          shouldNotBeAbleToFindIt,
                                                          () => {
                                                            searchForResource(
                                                              asPublicUserOn(privateTenantA),
                                                              ALL_SCOPE,
                                                              somePrivateUserFrom(publicTenantA),
                                                              shouldNotBeAbleToFindIt,
                                                              () => {
                                                                searchForResource(
                                                                  asPublicUserOn(privateTenantA),
                                                                  ALL_SCOPE,
                                                                  somePublicUserFrom(privateTenantA),
                                                                  shouldBeAbleToFindIt,
                                                                  () => {
                                                                    searchForResource(
                                                                      asPublicUserOn(privateTenantA),
                                                                      ALL_SCOPE,
                                                                      someLoggedInUserFrom(privateTenantA),
                                                                      shouldBeAbleToFindIt,
                                                                      () => {
                                                                        searchForResource(
                                                                          asPublicUserOn(privateTenantA),
                                                                          ALL_SCOPE,
                                                                          somePrivateUserFrom(privateTenantA),
                                                                          shouldNotBeAbleToFindIt,
                                                                          () => callback()
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
    it('verify the "network" search scope searches resources from inside the current tenant network only', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA, privateTenantB) => {
        // Public and loggedin items from the current public tenant should be searched
        searchForResource(
          asPublicUserOn(publicTenantA),
          NETWORK_SCOPE,
          somePublicUserFrom(publicTenantA),
          shouldBeAbleToFindIt,
          () => {
            searchForResource(
              asPublicUserOn(publicTenantA),
              NETWORK_SCOPE,
              someLoggedInUserFrom(publicTenantA),
              shouldBeAbleToFindIt,
              () => {
                searchForResource(
                  asPublicUserOn(publicTenantA),
                  NETWORK_SCOPE,
                  somePrivateUserFrom(publicTenantA),
                  shouldNotBeAbleToFindIt,
                  () => {
                    // Only public items from another public tenant should be searched
                    searchForResource(
                      asPublicUserOn(publicTenantA),
                      NETWORK_SCOPE,
                      somePublicUserFrom(publicTenantB),
                      shouldBeAbleToFindIt,
                      () => {
                        searchForResource(
                          asPublicUserOn(publicTenantA),
                          NETWORK_SCOPE,
                          someLoggedInUserFrom(publicTenantB),
                          shouldNotBeAbleToFindIt,
                          () => {
                            searchForResource(
                              asPublicUserOn(publicTenantA),
                              NETWORK_SCOPE,
                              somePrivateUserFrom(publicTenantB),
                              shouldNotBeAbleToFindIt,
                              () => {
                                // Nothing from an external private tenant should be searched
                                searchForResource(
                                  asPublicUserOn(publicTenantA),
                                  NETWORK_SCOPE,
                                  somePublicUserFrom(privateTenantA),
                                  shouldNotBeAbleToFindIt,
                                  () => {
                                    searchForResource(
                                      asPublicUserOn(publicTenantA),
                                      NETWORK_SCOPE,
                                      someLoggedInUserFrom(privateTenantA),
                                      shouldNotBeAbleToFindIt,
                                      () => {
                                        searchForResource(
                                          asPublicUserOn(publicTenantA),
                                          NETWORK_SCOPE,
                                          somePrivateUserFrom(privateTenantA),
                                          shouldNotBeAbleToFindIt,
                                          () => {
                                            // Public and logged items from the current private tenant should be searched
                                            searchForResource(
                                              asPublicUserOn(privateTenantA),
                                              NETWORK_SCOPE,
                                              somePublicUserFrom(privateTenantA),
                                              shouldBeAbleToFindIt,
                                              () => {
                                                searchForResource(
                                                  asPublicUserOn(privateTenantA),
                                                  NETWORK_SCOPE,
                                                  someLoggedInUserFrom(privateTenantA),
                                                  shouldBeAbleToFindIt,
                                                  () => {
                                                    searchForResource(
                                                      asPublicUserOn(privateTenantA),
                                                      NETWORK_SCOPE,
                                                      somePrivateUserFrom(privateTenantA),
                                                      shouldNotBeAbleToFindIt,
                                                      () => {
                                                        // Nothing from an external public tenant should be searched when searching from a private tenant
                                                        searchForResource(
                                                          asPublicUserOn(privateTenantA),
                                                          NETWORK_SCOPE,
                                                          somePublicUserFrom(publicTenantA),
                                                          shouldNotBeAbleToFindIt,
                                                          () => {
                                                            searchForResource(
                                                              asPublicUserOn(privateTenantA),
                                                              NETWORK_SCOPE,
                                                              someLoggedInUserFrom(publicTenantA),
                                                              shouldNotBeAbleToFindIt,
                                                              () => {
                                                                searchForResource(
                                                                  asPublicUserOn(privateTenantA),
                                                                  NETWORK_SCOPE,
                                                                  somePrivateUserFrom(publicTenantA),
                                                                  shouldNotBeAbleToFindIt,
                                                                  () => {
                                                                    // Nothing from an external private tenant should be searched when searching from a private tenant
                                                                    searchForResource(
                                                                      asPublicUserOn(privateTenantA),
                                                                      NETWORK_SCOPE,
                                                                      somePublicUserFrom(privateTenantB),
                                                                      shouldNotBeAbleToFindIt,
                                                                      () => {
                                                                        searchForResource(
                                                                          asPublicUserOn(privateTenantA),
                                                                          NETWORK_SCOPE,
                                                                          someLoggedInUserFrom(privateTenantB),
                                                                          shouldNotBeAbleToFindIt,
                                                                          () => {
                                                                            searchForResource(
                                                                              asPublicUserOn(privateTenantA),
                                                                              NETWORK_SCOPE,
                                                                              somePrivateUserFrom(privateTenantB),
                                                                              shouldNotBeAbleToFindIt,
                                                                              () => callback()
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
     * Test that verifies that the _interact scope searches resources that the user can interact with only
     */
    it('verify the "interact" search scope searches only resources with which the user can interact', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA, privateTenantB) => {
        // Anonymous users cannot use the _interact scope without a 401 error
        searchRefreshed(
          asAnonymousUserOn(publicTenantA),
          GENERAL_SEARCH,
          NO_PARAMS,
          { scope: INTERACT_SCOPE },
          (error /* , results */) => {
            assert.ok(error);
            assert.ok(returns401(error));

            // Public and loggedin items from the current public tenant should be searched
            searchForResource(
              asPublicUserOn(publicTenantA),
              INTERACT_SCOPE,
              somePublicUserFrom(publicTenantA),
              shouldBeAbleToFindIt,
              () => {
                searchForResource(
                  asPublicUserOn(publicTenantA),
                  INTERACT_SCOPE,
                  someLoggedInUserFrom(publicTenantA),
                  shouldBeAbleToFindIt,
                  () => {
                    searchForResource(
                      asPublicUserOn(publicTenantA),
                      INTERACT_SCOPE,
                      somePrivateUserFrom(publicTenantA),
                      shouldNotBeAbleToFindIt,
                      () => {
                        // A private user cannot search themself for interaction
                        searchForResource(
                          asPrivateUserOn(publicTenantA),
                          INTERACT_SCOPE,
                          somePrivateUserFrom(publicTenantA),
                          shouldNotBeAbleToFindIt,
                          () => {
                            // Private joinable groups from the current tenant should be searched when searched with the tenant admin
                            searchForResource(
                              asAdminUserOn(publicTenantA),
                              INTERACT_SCOPE,
                              somePrivateJoinableGroupFrom(publicTenantA),
                              shouldBeAbleToFindIt,
                              () => {
                                // Private joinable groups from the current tenant should not be searched when searched as a regular user
                                searchForResource(
                                  asPublicUserOn(publicTenantA),
                                  INTERACT_SCOPE,
                                  somePrivateJoinableGroupFrom(publicTenantA),
                                  shouldNotBeAbleToFindIt,
                                  () => {
                                    // Sanity check that under _network search, the private joinable group does get searched when searching as a regular user
                                    searchForResource(
                                      asPublicUserOn(publicTenantA),
                                      NETWORK_SCOPE,
                                      somePrivateJoinableGroupFrom(publicTenantA),
                                      shouldBeAbleToFindIt,
                                      () => {
                                        // Only public items from another public tenant should be searched
                                        searchForResource(
                                          asPublicUserOn(publicTenantA),
                                          INTERACT_SCOPE,
                                          somePublicUserFrom(publicTenantB),
                                          shouldBeAbleToFindIt,
                                          () => {
                                            searchForResource(
                                              asPublicUserOn(publicTenantA),
                                              INTERACT_SCOPE,
                                              someLoggedInUserFrom(publicTenantB),
                                              shouldNotBeAbleToFindIt,
                                              () => {
                                                searchForResource(
                                                  asPublicUserOn(publicTenantA),
                                                  INTERACT_SCOPE,
                                                  somePrivateUserFrom(publicTenantB),
                                                  shouldNotBeAbleToFindIt,
                                                  () => {
                                                    // Nothing from an external private tenant should be searched
                                                    searchForResource(
                                                      asPublicUserOn(publicTenantA),
                                                      INTERACT_SCOPE,
                                                      somePublicUserFrom(privateTenantA),
                                                      shouldNotBeAbleToFindIt,
                                                      () => {
                                                        searchForResource(
                                                          asPublicUserOn(publicTenantA),
                                                          INTERACT_SCOPE,
                                                          someLoggedInUserFrom(privateTenantA),
                                                          shouldNotBeAbleToFindIt,
                                                          () => {
                                                            searchForResource(
                                                              asPublicUserOn(publicTenantA),
                                                              INTERACT_SCOPE,
                                                              somePrivateUserFrom(privateTenantA),
                                                              shouldNotBeAbleToFindIt,
                                                              () => {
                                                                // Public and logged items from the current private tenant should be searched
                                                                searchForResource(
                                                                  asPublicUserOn(privateTenantA),
                                                                  INTERACT_SCOPE,
                                                                  somePublicUserFrom(privateTenantA),
                                                                  shouldBeAbleToFindIt,
                                                                  () => {
                                                                    searchForResource(
                                                                      asPublicUserOn(privateTenantA),
                                                                      INTERACT_SCOPE,
                                                                      someLoggedInUserFrom(privateTenantA),
                                                                      shouldBeAbleToFindIt,
                                                                      () => {
                                                                        searchForResource(
                                                                          asPublicUserOn(privateTenantA),
                                                                          INTERACT_SCOPE,
                                                                          somePrivateUserFrom(privateTenantA),
                                                                          shouldNotBeAbleToFindIt,
                                                                          () => {
                                                                            // Nothing from an external public tenant should be searched when searching from a private tenant
                                                                            searchForResource(
                                                                              asPublicUserOn(privateTenantA),
                                                                              INTERACT_SCOPE,
                                                                              somePublicUserFrom(publicTenantA),
                                                                              shouldNotBeAbleToFindIt,
                                                                              () => {
                                                                                searchForResource(
                                                                                  asPublicUserOn(privateTenantA),
                                                                                  INTERACT_SCOPE,
                                                                                  someLoggedInUserFrom(publicTenantA),
                                                                                  shouldNotBeAbleToFindIt,
                                                                                  () => {
                                                                                    searchForResource(
                                                                                      asPublicUserOn(privateTenantA),
                                                                                      INTERACT_SCOPE,
                                                                                      somePrivateUserFrom(
                                                                                        publicTenantA
                                                                                      ),
                                                                                      shouldNotBeAbleToFindIt,
                                                                                      () => {
                                                                                        /**
                                                                                         * Nothing from an external private tenant should
                                                                                         * be searched when searching from a private tenant
                                                                                         */
                                                                                        searchForResource(
                                                                                          asPublicUserOn(
                                                                                            privateTenantA
                                                                                          ),
                                                                                          INTERACT_SCOPE,
                                                                                          somePublicUserFrom(
                                                                                            privateTenantB
                                                                                          ),
                                                                                          shouldNotBeAbleToFindIt,
                                                                                          () => {
                                                                                            searchForResource(
                                                                                              asPublicUserOn(
                                                                                                privateTenantA
                                                                                              ),
                                                                                              INTERACT_SCOPE,
                                                                                              someLoggedInUserFrom(
                                                                                                privateTenantB
                                                                                              ),
                                                                                              shouldNotBeAbleToFindIt,
                                                                                              () => {
                                                                                                searchForResource(
                                                                                                  asPublicUserOn(
                                                                                                    privateTenantA
                                                                                                  ),
                                                                                                  INTERACT_SCOPE,
                                                                                                  somePrivateUserFrom(
                                                                                                    privateTenantB
                                                                                                  ),
                                                                                                  shouldNotBeAbleToFindIt,
                                                                                                  () => callback()
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
    it('verify the _my search scope searches only items to which the current user is explicitly associated', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA /* , privateTenantB */) => {
        /**
         * Make the public user from publicTenant0 a member of a couple of the groups so we can test explicit access
         */
        const memberUpdate = assoc(getId(somePublicUserFrom(publicTenantA)), MEMBER, {});

        assertSetGroupMembersSucceeds(
          asAdminUserOn(publicTenantB),
          asAdminUserOn(publicTenantB),
          somePublicGroupFrom(publicTenantB).id,
          memberUpdate,
          () => {
            assertSetGroupMembersSucceeds(
              asAdminUserOn(publicTenantA),
              asAdminUserOn(publicTenantA),
              somePrivateNotJoinableGroupFrom(publicTenantA).id,
              memberUpdate,
              () => {
                /**
                 * Items from the current tenant that are not explicitly associated to
                 * the current user should not be returned
                 */
                searchForResource(
                  asPublicUserOn(publicTenantA),
                  MY_SCOPE,
                  somePublicUserFrom(publicTenantA),
                  shouldNotBeAbleToFindIt,
                  () => {
                    searchForResource(
                      asPublicUserOn(publicTenantA),
                      MY_SCOPE,
                      someLoggedInUserFrom(publicTenantA),
                      shouldNotBeAbleToFindIt,
                      () => {
                        searchForResource(
                          asPublicUserOn(publicTenantA),
                          MY_SCOPE,
                          somePrivateUserFrom(publicTenantA),
                          shouldNotBeAbleToFindIt,
                          () => {
                            searchForResource(
                              asPublicUserOn(publicTenantA),
                              MY_SCOPE,
                              someLoggedinNotJoinableGroup(publicTenantA),
                              shouldNotBeAbleToFindIt,
                              () => {
                                searchForResource(
                                  asPublicUserOn(publicTenantA),
                                  MY_SCOPE,
                                  somePublicUserFrom(publicTenantB),
                                  shouldNotBeAbleToFindIt,
                                  () => {
                                    searchForResource(
                                      asPublicUserOn(publicTenantA),
                                      MY_SCOPE,
                                      someLoggedInUserFrom(publicTenantB),
                                      shouldNotBeAbleToFindIt,
                                      () => {
                                        searchForResource(
                                          asPublicUserOn(publicTenantA),
                                          MY_SCOPE,
                                          somePrivateUserFrom(publicTenantB),
                                          shouldNotBeAbleToFindIt,
                                          () => {
                                            searchForResource(
                                              asPublicUserOn(publicTenantA),
                                              MY_SCOPE,
                                              somePublicUserFrom(privateTenantA),
                                              shouldNotBeAbleToFindIt,
                                              () => {
                                                searchForResource(
                                                  asPublicUserOn(publicTenantA),
                                                  MY_SCOPE,
                                                  someLoggedInUserFrom(privateTenantA),
                                                  shouldNotBeAbleToFindIt,
                                                  () => {
                                                    searchForResource(
                                                      asPublicUserOn(publicTenantA),
                                                      MY_SCOPE,
                                                      somePrivateUserFrom(privateTenantA),
                                                      shouldNotBeAbleToFindIt,
                                                      () => {
                                                        /**
                                                         * The external public group and local public, private groups
                                                         * to which the user is associated should be returned
                                                         */
                                                        searchForResource(
                                                          asPublicUserOn(publicTenantA),
                                                          MY_SCOPE,
                                                          somePublicGroupFrom(publicTenantA),
                                                          shouldBeAbleToFindIt,
                                                          () => {
                                                            searchForResource(
                                                              asPublicUserOn(publicTenantA),
                                                              MY_SCOPE,
                                                              somePrivateNotJoinableGroupFrom(publicTenantA),
                                                              shouldBeAbleToFindIt,
                                                              () => {
                                                                searchForResource(
                                                                  asPublicUserOn(publicTenantA),
                                                                  MY_SCOPE,
                                                                  somePublicGroupFrom(publicTenantB),
                                                                  shouldBeAbleToFindIt,
                                                                  () => callback()
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
    it('verify that scoping general search to a tenant alias only searches resources in that tenant', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB /* , privateTenant0, privateTenant1 */) => {
        /**
         * Make the public user from publicTenantA a member of the public group
         * from publicTenant1 so we can test explicit access
         */
        const memberUpdate = assoc(publicTenantA.publicUser.user.id, MEMBER, {});

        setGroupMembers(
          asAdminUserOn(publicTenantB),
          getId(somePublicGroupFrom(publicTenantB)),
          memberUpdate,
          (error) => {
            assert.notExists(error);

            // Public and loggedin items from the specified tenant should be returned
            searchForResource(
              asPublicUserOn(publicTenantA),
              getTenantAlias(publicTenantA),
              somePublicUserFrom(publicTenantA),
              shouldBeAbleToFindIt,
              () => {
                searchForResource(
                  asPublicUserOn(publicTenantA),
                  getTenantAlias(publicTenantA),
                  someLoggedInUserFrom(publicTenantA),
                  shouldBeAbleToFindIt,
                  () => {
                    searchForResource(
                      asPublicUserOn(publicTenantA),
                      getTenantAlias(publicTenantA),
                      somePrivateUserFrom(publicTenantA),
                      shouldNotBeAbleToFindIt,
                      () => {
                        /**
                         * The public group nor other resources from the other public tenant
                         * should be returned even when we have explicit access
                         */
                        searchForResource(
                          asPublicUserOn(publicTenantA),
                          getTenantAlias(publicTenantA),
                          somePublicGroupFrom(publicTenantB),
                          shouldNotBeAbleToFindIt,
                          () => {
                            searchForResource(
                              asPublicUserOn(publicTenantA),
                              getTenantAlias(publicTenantA),
                              somePublicUserFrom(publicTenantB),
                              shouldNotBeAbleToFindIt,
                              () => {
                                searchForResource(
                                  asPublicUserOn(publicTenantA),
                                  getTenantAlias(publicTenantA),
                                  someLoggedInUserFrom(publicTenantB),
                                  shouldNotBeAbleToFindIt,
                                  () => {
                                    searchForResource(
                                      asPublicUserOn(publicTenantA),
                                      getTenantAlias(publicTenantA),
                                      somePrivateUserFrom(publicTenantB),
                                      shouldNotBeAbleToFindIt,
                                      () => {
                                        // Resources from the current tenant should not be searched when specifying another tenant
                                        searchForResource(
                                          asPublicUserOn(publicTenantA),
                                          getTenantAlias(publicTenantB),
                                          somePublicUserFrom(publicTenantA),
                                          shouldNotBeAbleToFindIt,
                                          () => {
                                            searchForResource(
                                              asPublicUserOn(publicTenantA),
                                              getTenantAlias(publicTenantB),
                                              someLoggedInUserFrom(publicTenantA),
                                              shouldNotBeAbleToFindIt,
                                              () => {
                                                searchForResource(
                                                  asPublicUserOn(publicTenantA),
                                                  getTenantAlias(publicTenantB),
                                                  somePrivateUserFrom(publicTenantA),
                                                  shouldNotBeAbleToFindIt,
                                                  () => {
                                                    // Resources from a different specified tenant should be searched when it is specified
                                                    searchForResource(
                                                      asPublicUserOn(publicTenantA),
                                                      getTenantAlias(publicTenantB),
                                                      somePublicUserFrom(publicTenantB),
                                                      shouldBeAbleToFindIt,
                                                      () => {
                                                        searchForResource(
                                                          asPublicUserOn(publicTenantA),
                                                          getTenantAlias(publicTenantB),
                                                          someLoggedInUserFrom(publicTenantB),
                                                          shouldNotBeAbleToFindIt,
                                                          () => {
                                                            searchForResource(
                                                              asPublicUserOn(publicTenantA),
                                                              getTenantAlias(publicTenantB),
                                                              somePrivateUserFrom(publicTenantB),
                                                              shouldNotBeAbleToFindIt,
                                                              () => callback()
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
    before(rebuildSearchIndex);
    /**
     * Test that verifies deleted content is removed from the search index.
     */
    it('verify deleted content is unsearchable', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: barbosa } = users;
        const asBarbosa = barbosa.restContext;

        const uniqueString = generateTestUserId('unsearchable-content');
        createLink(
          asBarbosa,
          {
            displayName: uniqueString,
            description: uniqueString,
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, content) => {
            assert.notExists(error);

            // Verify search term Apereo does not match the content
            searchRefreshed(
              asBarbosa,
              GENERAL_SEARCH,
              NO_PARAMS,
              { resourceTypes: CONTENT, q: uniqueString },
              (error, results) => {
                assert.notExists(error);
                assert.ok(isWithin(results, content.id));

                deleteContent(asBarbosa, content.id, (error_) => {
                  assert.notExists(error_);

                  searchRefreshed(
                    asBarbosa,
                    GENERAL_SEARCH,
                    NO_PARAMS,
                    { resourceTypes: CONTENT, q: uniqueString },
                    (error, results) => {
                      assert.notExists(error);
                      assert.ok(isNotWithin(results, content.id));

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
    it('verify public content searchable by everyone', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: meireles } = users;
        const asMeireles = meireles.restContext;

        const { 1: lopes } = users;
        const asLopes = lopes.restContext;
        const lopesId = lopes.user.id;

        const { 2: barbosa } = users;
        const asBarbosa = barbosa.restContext;

        generateTestUsers(asGeorgiaTenantAdmin, 1, (error /* , users */) => {
          assert.notExists(error);

          generateTestGroups(asMeireles, 5, (...args) => {
            const groupIds = getGroupIds(args);

            // Give meireles access via group
            generateGroupHierarchy(asMeireles, groupIds, MEMBER, (error_) => {
              assert.notExists(error_);

              generateGroupHierarchy(asMeireles, pair(nth(4, groupIds), lopesId), MEMBER, (error_) => {
                assert.notExists(error_);

                const uniqueString = generateTestUserId('public-searchable-content');
                createLink(
                  asMeireles,
                  {
                    displayName: uniqueString,
                    description: 'Test content description 1',
                    visibility: PUBLIC,
                    link: 'http://www.oaeproject.org/',
                    managers: NO_MANAGERS,
                    viewers: of(head(groupIds)),
                    folders: NO_FOLDERS
                  },
                  (error, contentObject) => {
                    assert.notExists(error);

                    // Verify anonymous can see it
                    searchRefreshed(
                      asCambridgeAnonymousUser,
                      GENERAL_SEARCH,
                      NO_PARAMS,
                      { q: uniqueString },
                      (error, results) => {
                        assert.notExists(error);

                        const searchedDoc = fetchWithin(results, getId(contentObject));
                        assert.ok(searchedDoc);
                        assert.strictEqual(searchedDoc.resourceSubType, LINK);
                        assert.strictEqual(getDisplayName(searchedDoc), getDisplayName(contentObject));
                        assert.strictEqual(searchedDoc.tenantAlias, 'camtest');
                        assert.strictEqual(getVisibility(searchedDoc), getVisibility(contentObject));
                        assert.strictEqual(getResourceType(searchedDoc), CONTENT);
                        assert.strictEqual(
                          searchedDoc.profilePath,
                          concat(
                            `/content/${getTenantAlias(contentObject)}`,
                            `/${AuthzUtil.getResourceFromId(contentObject.id).resourceId}`
                          )
                        );
                        assert.strictEqual(getId(contentObject), getId(searchedDoc));
                        assert.strictEqual(undefined, searchedDoc._extra);
                        assert.strictEqual(undefined, searchedDoc._type);
                        assert.strictEqual(undefined, searchedDoc.q_high);
                        assert.strictEqual(undefined, searchedDoc.q_low);
                        assert.strictEqual(undefined, searchedDoc.sort);

                        // Verify tenant admin can see it
                        searchRefreshed(
                          asCambridgeTenantAdmin,
                          GENERAL_SEARCH,
                          NO_PARAMS,
                          { q: uniqueString },
                          (error, results) => {
                            assert.notExists(error);

                            const searchedDoc = fetchWithin(results, getId(contentObject));
                            assert.ok(searchedDoc);
                            assert.strictEqual(searchedDoc.resourceSubType, LINK);
                            assert.strictEqual(getDisplayName(searchedDoc), getDisplayName(contentObject));
                            assert.strictEqual(searchedDoc.tenantAlias, getTenantAlias(contentObject));
                            assert.strictEqual(getVisibility(searchedDoc), getVisibility(contentObject));
                            assert.strictEqual(getResourceType(searchedDoc), CONTENT);
                            assert.strictEqual(
                              searchedDoc.profilePath,
                              concat(
                                `/content/${getTenantAlias(contentObject)}`,
                                `/${AuthzUtil.getResourceFromId(getId(contentObject)).resourceId}`
                              )
                            );
                            assert.strictEqual(getId(searchedDoc), getId(contentObject));
                            assert.strictEqual(undefined, searchedDoc._extra);
                            assert.strictEqual(undefined, searchedDoc._type);
                            assert.strictEqual(undefined, searchedDoc.q_high);
                            assert.strictEqual(undefined, searchedDoc.q_low);
                            assert.strictEqual(undefined, searchedDoc.sort);

                            // Verify same-tenant loggedin user can see it
                            searchRefreshed(
                              asBarbosa,
                              GENERAL_SEARCH,
                              NO_PARAMS,
                              { q: uniqueString },
                              (error, results) => {
                                assert.notExists(error);

                                const searchedDoc = fetchWithin(results, getId(contentObject));
                                assert.ok(searchedDoc);
                                assert.strictEqual(searchedDoc.resourceSubType, LINK);
                                assert.strictEqual(getDisplayName(searchedDoc), getDisplayName(contentObject));
                                assert.strictEqual(searchedDoc.tenantAlias, getTenantAlias(contentObject));
                                assert.strictEqual(searchedDoc.visibility, contentObject.visibility);
                                assert.strictEqual(getResourceType(searchedDoc), CONTENT);
                                assert.strictEqual(
                                  searchedDoc.profilePath,
                                  concat(
                                    `/content/${getTenantAlias(contentObject)}`,
                                    `/${AuthzUtil.getResourceFromId(getId(contentObject)).resourceId}`
                                  )
                                );
                                assert.strictEqual(getId(searchedDoc), getId(contentObject));
                                assert.strictEqual(undefined, searchedDoc._extra);
                                assert.strictEqual(undefined, searchedDoc._type);
                                assert.strictEqual(undefined, searchedDoc.q_high);
                                assert.strictEqual(undefined, searchedDoc.q_low);
                                assert.strictEqual(undefined, searchedDoc.sort);

                                // Verify same-tenant loggedin user can see it
                                searchRefreshed(
                                  asBarbosa,
                                  GENERAL_SEARCH,
                                  NO_PARAMS,
                                  { q: uniqueString },
                                  (error, results) => {
                                    assert.notExists(error);

                                    const searchedDoc = fetchWithin(results, getId(contentObject));
                                    assert.ok(searchedDoc);
                                    assert.strictEqual(searchedDoc.resourceSubType, LINK);
                                    assert.strictEqual(getDisplayName(searchedDoc), getDisplayName(contentObject));
                                    assert.strictEqual(searchedDoc.tenantAlias, getTenantAlias(contentObject));
                                    assert.strictEqual(getVisibility(searchedDoc), getVisibility(contentObject));
                                    assert.strictEqual(getResourceType(searchedDoc), CONTENT);
                                    assert.strictEqual(
                                      searchedDoc.profilePath,
                                      concat(
                                        `/content/${getTenantAlias(contentObject)}`,
                                        `/${AuthzUtil.getResourceFromId(contentObject.id).resourceId}`
                                      )
                                    );
                                    assert.strictEqual(getId(searchedDoc), getId(contentObject));
                                    assert.strictEqual(undefined, searchedDoc._extra);
                                    assert.strictEqual(undefined, searchedDoc._type);
                                    assert.strictEqual(undefined, searchedDoc.q_high);
                                    assert.strictEqual(undefined, searchedDoc.q_low);
                                    assert.strictEqual(undefined, searchedDoc.sort);

                                    // Verify permitted user can see it
                                    searchRefreshed(
                                      asLopes,
                                      GENERAL_SEARCH,
                                      NO_PARAMS,
                                      { q: uniqueString },
                                      (error, results) => {
                                        assert.notExists(error);

                                        const searchedDoc = fetchWithin(results, getId(contentObject));
                                        assert.ok(searchedDoc);
                                        assert.strictEqual(searchedDoc.resourceSubType, LINK);
                                        assert.strictEqual(getDisplayName(searchedDoc), getDisplayName(contentObject));
                                        assert.strictEqual(searchedDoc.tenantAlias, getTenantAlias(contentObject));
                                        assert.strictEqual(getVisibility(searchedDoc), getVisibility(contentObject));
                                        assert.strictEqual(getResourceType(searchedDoc), CONTENT);
                                        assert.strictEqual(
                                          searchedDoc.profilePath,
                                          concat(
                                            `/content/${getTenantAlias(contentObject)}`,
                                            `/${getResourceFromId(getId(contentObject)).resourceId}`
                                          )
                                        );
                                        assert.strictEqual(getId(searchedDoc), getId(contentObject));
                                        assert.strictEqual(undefined, searchedDoc._extra);
                                        assert.strictEqual(undefined, searchedDoc._type);
                                        assert.strictEqual(undefined, searchedDoc.q_high);
                                        assert.strictEqual(undefined, searchedDoc.q_low);
                                        assert.strictEqual(undefined, searchedDoc.sort);

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
     * Test that verifies loggedin content items are only search by users authenticated
     * to the content item's parent tenant.
     */
    it('verify loggedin content search not searchable by anonymous or cross-tenant', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: lopes } = users;
        const asLopes = lopes.restContext;

        const { 1: barbosa } = users;
        const asBarbosa = barbosa.restContext;
        const barbosaId = barbosa.user.id;

        const { 2: meireles } = users;
        const asMeireles = meireles.restContext;

        generateTestUsers(asGeorgiaTenantAdmin, 1, (error, moreUsers) => {
          assert.notExists(error);

          const { 0: bonifacio } = moreUsers;
          const asBonifacio = bonifacio.restContext;

          generateTestGroups(asLopes, 5, (...args) => {
            const groupIds = getGroupIds(args);

            // Give lopes access via group
            generateGroupHierarchy(asLopes, groupIds, MEMBER, (error_) => {
              assert.notExists(error_);

              generateGroupHierarchy(asLopes, [nth(4, groupIds), barbosaId], MEMBER, (error_) => {
                assert.notExists(error_);

                const beforeCreated = Date.now();
                const uniqueString = generateTestUserId('loggedin-searchable-content');

                createLink(
                  asLopes,
                  {
                    displayName: uniqueString,
                    description: 'Test content description 1',
                    visibility: LOGGED_IN,
                    link: 'http://www.oaeproject.org/',
                    managers: NO_MANAGERS,
                    viewers: of(head(groupIds)),
                    folders: NO_FOLDERS
                  },
                  (error, contentObject) => {
                    assert.notExists(error);

                    // Verify anonymous cannot see it
                    searchRefreshed(
                      asCambridgeAnonymousUser,
                      GENERAL_SEARCH,
                      NO_PARAMS,
                      { q: uniqueString },
                      (error, results) => {
                        assert.notExists(error);
                        assert.ok(isNotWithin(results, contentObject.id));

                        // Verify cross-tenant user cannot see it
                        searchRefreshed(
                          asBonifacio,
                          GENERAL_SEARCH,
                          NO_PARAMS,
                          { q: uniqueString, scope: NETWORK_SCOPE },
                          (error, results) => {
                            assert.notExists(error);
                            assert.ok(isNotWithin(results, contentObject.id));

                            // Verify tenant admin can see it
                            searchRefreshed(
                              asCambridgeTenantAdmin,
                              GENERAL_SEARCH,
                              NO_PARAMS,
                              { q: uniqueString },
                              (error, results) => {
                                assert.notExists(error);

                                const searchedDoc = fetchWithin(results, contentObject.id);
                                assert.ok(searchedDoc);
                                assert.strictEqual(searchedDoc.resourceSubType, LINK);
                                assert.strictEqual(getDisplayName(searchedDoc), getDisplayName(contentObject));
                                assert.strictEqual(searchedDoc.tenantAlias, getTenantAlias(contentObject));
                                assert.strictEqual(getVisibility(searchedDoc), getVisibility(contentObject));
                                assert.strictEqual(getResourceType(searchedDoc), CONTENT);
                                assert.strictEqual(
                                  searchedDoc.profilePath,
                                  concat(
                                    `/content/${getTenantAlias(contentObject)}`,
                                    `/${getResourceFromId(getId(contentObject)).resourceId}`
                                  )
                                );
                                assert.strictEqual(getId(searchedDoc), getId(contentObject));
                                assert.strictEqual(undefined, searchedDoc._extra);
                                assert.strictEqual(undefined, searchedDoc._type);
                                assert.strictEqual(undefined, searchedDoc.q_high);
                                assert.strictEqual(undefined, searchedDoc.q_low);
                                assert.strictEqual(undefined, searchedDoc.sort);

                                /**
                                 * Since lastModified time gets updated for more than just profile
                                 * updates (e.g., share, library updates, etc...), we should just
                                 * sanity check the lastModified in th search doc
                                 */
                                assert.isAtLeast(getLastModified(searchedDoc), beforeCreated);

                                // Verify same-tenant loggedin user can see it
                                searchRefreshed(
                                  asMeireles,
                                  GENERAL_SEARCH,
                                  NO_PARAMS,
                                  { q: uniqueString },
                                  (error, results) => {
                                    assert.notExists(error);

                                    const searchedDoc = fetchWithin(results, contentObject.id);
                                    assert.ok(searchedDoc);
                                    assert.strictEqual(searchedDoc.resourceSubType, LINK);
                                    assert.strictEqual(getDisplayName(searchedDoc), getDisplayName(contentObject));
                                    assert.strictEqual(searchedDoc.tenantAlias, getTenantAlias(contentObject));
                                    assert.strictEqual(getVisibility(searchedDoc), getVisibility(contentObject));
                                    assert.strictEqual(getResourceType(searchedDoc), CONTENT);
                                    assert.strictEqual(
                                      searchedDoc.profilePath,
                                      concat(
                                        `/content/${getTenantAlias(contentObject)}`,
                                        `/${getResourceFromId(getId(contentObject)).resourceId}`
                                      )
                                    );
                                    assert.strictEqual(getId(searchedDoc), getId(contentObject));
                                    assert.strictEqual(undefined, searchedDoc._extra);
                                    assert.strictEqual(undefined, searchedDoc._type);
                                    assert.strictEqual(undefined, searchedDoc.q_high);
                                    assert.strictEqual(undefined, searchedDoc.q_low);
                                    assert.strictEqual(undefined, searchedDoc.sort);

                                    /**
                                     * Since lastModified time gets updated for more than just profile
                                     * updates (e.g., share, library updates, etc...), we should just
                                     * sanity check the lastModified in th search doc
                                     */
                                    assert.isAtLeast(getLastModified(searchedDoc), beforeCreated);

                                    // Verify permitted user can see it
                                    searchRefreshed(
                                      asBarbosa,
                                      GENERAL_SEARCH,
                                      NO_PARAMS,
                                      { q: uniqueString },
                                      (error, results) => {
                                        assert.notExists(error);
                                        assert.ok(isWithin(results, getId(contentObject)));

                                        const searchedDoc = fetchWithin(results, getId(contentObject));
                                        assert.ok(searchedDoc);
                                        assert.strictEqual(searchedDoc.resourceSubType, LINK);
                                        assert.strictEqual(getDisplayName(searchedDoc), getDisplayName(contentObject));
                                        assert.strictEqual(searchedDoc.tenantAlias, getTenantAlias(contentObject));
                                        assert.strictEqual(getVisibility(searchedDoc), getVisibility(contentObject));
                                        assert.strictEqual(getResourceType(searchedDoc), CONTENT);
                                        assert.strictEqual(
                                          searchedDoc.profilePath,
                                          concat(
                                            `/content/${getTenantAlias(contentObject)}`,
                                            `/${getResourceFromId(getId(contentObject)).resourceId}`
                                          )
                                        );
                                        assert.strictEqual(searchedDoc.id, contentObject.id);
                                        assert.strictEqual(searchedDoc._extra, undefined);
                                        assert.strictEqual(searchedDoc._type, undefined);
                                        assert.strictEqual(searchedDoc.q_high, undefined);
                                        assert.strictEqual(searchedDoc.q_low, undefined);
                                        assert.strictEqual(searchedDoc.sort, undefined);

                                        /**
                                         * Since lastModified time gets updated for more than just profile
                                         * updates (e.g., share, library updates, etc...), we should just
                                         * sanity check the lastModified in th search doc
                                         */
                                        assert.isAtLeast(getLastModified(searchedDoc), beforeCreated);

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
    it('verify private content search not searchable by anyone but admin and privileged users', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: theBoss } = users;
        const asTheBoss = theBoss.restContext;

        const { 1: jackson } = users;
        const jacksonId = jackson.user.id;
        const asJackson = jackson.restContext;

        const { 2: elvis } = users;
        const elvisId = elvis.user.id;
        const asElvis = elvis.restContext;

        generateTestUsers(asGeorgiaTenantAdmin, 1, (error, moreUsers) => {
          assert.notExists(error);

          const { 0: pavarotti } = moreUsers;
          const asPavarotti = pavarotti.restContext;

          generateTestGroups(asTheBoss, 5, (...args) => {
            const groupIds = getGroupIds(args);

            // Give jack access via group
            generateGroupHierarchy(asTheBoss, groupIds, MEMBER, (error_) => {
              assert.notExists(error_);

              generateGroupHierarchy(asTheBoss, [nth(4, groupIds), jacksonId], MEMBER, (error_) => {
                assert.notExists(error_);

                const beforeCreated = Date.now();
                const uniqueString = generateTestUserId('private-searchable-content');

                createLink(
                  asTheBoss,
                  {
                    displayName: uniqueString,
                    description: 'Test content description 1',
                    visibility: PRIVATE,
                    link: 'http://www.oaeproject.org/',
                    managers: NO_MANAGERS,
                    viewers: of(head(groupIds)),
                    folders: NO_FOLDERS
                  },
                  (error, contentObject) => {
                    assert.isNotOk(error);

                    // Verify anonymous cannot see it
                    searchRefreshed(
                      asCambridgeAnonymousUser,
                      GENERAL_SEARCH,
                      NO_PARAMS,
                      { q: uniqueString },
                      (error, results) => {
                        assert.notExists(error);
                        assert.ok(isNotWithin(results, getId(contentObject)));

                        // Verify cross-tenant user cannot see it
                        searchRefreshed(
                          asPavarotti,
                          GENERAL_SEARCH,
                          NO_PARAMS,
                          { q: uniqueString, scope: NETWORK_SCOPE },
                          (error, results) => {
                            assert.notExists(error);
                            assert.ok(isNotWithin(results, getId(contentObject)));

                            // Verify tenant admin can see it
                            searchRefreshed(
                              asCambridgeTenantAdmin,
                              GENERAL_SEARCH,
                              NO_PARAMS,
                              { q: uniqueString },
                              (error, results) => {
                                assert.notExists(error);

                                const searchedDoc = fetchWithin(results, getId(contentObject));
                                assert.ok(searchedDoc);
                                assert.strictEqual(searchedDoc.resourceSubType, LINK);
                                assert.strictEqual(getDisplayName(searchedDoc), getDisplayName(contentObject));
                                assert.strictEqual(searchedDoc.tenantAlias, getTenantAlias(contentObject));
                                assert.strictEqual(getVisibility(searchedDoc), getVisibility(contentObject));
                                assert.strictEqual(getResourceType(searchedDoc), CONTENT);
                                assert.strictEqual(
                                  searchedDoc.profilePath,
                                  concat(
                                    `/content/${getTenantAlias(contentObject)}`,
                                    `/${AuthzUtil.getResourceFromId(getId(contentObject)).resourceId}`
                                  )
                                );
                                assert.strictEqual(getId(searchedDoc), getId(contentObject));
                                assert.strictEqual(undefined, searchedDoc._extra);
                                assert.strictEqual(undefined, searchedDoc._type);
                                assert.strictEqual(undefined, searchedDoc.q_high);
                                assert.strictEqual(undefined, searchedDoc.q_low);
                                assert.strictEqual(undefined, searchedDoc.sort);

                                /**
                                 * Since lastModified time gets updated for more than just profile
                                 * updates (e.g., share, library updates, etc...), we should just
                                 * sanity check the lastModified in th search doc
                                 */
                                assert.isAtLeast(getLastModified(searchedDoc), beforeCreated);

                                // Verify same-tenant loggedin user cannot see it
                                searchRefreshed(
                                  asElvis,
                                  GENERAL_SEARCH,
                                  NO_PARAMS,
                                  { q: uniqueString },
                                  (error, results) => {
                                    assert.notExists(error);
                                    assert.ok(isNotWithin(results, getId(contentObject)));

                                    // Verify permitted user can see it
                                    searchRefreshed(
                                      asJackson,
                                      GENERAL_SEARCH,
                                      NO_PARAMS,
                                      { q: uniqueString },
                                      (error, results) => {
                                        assert.notExists(error);

                                        const searchedDoc = fetchWithin(results, getId(contentObject));
                                        assert.ok(searchedDoc);
                                        assert.strictEqual(searchedDoc.resourceSubType, LINK);
                                        assert.strictEqual(getDisplayName(searchedDoc), getDisplayName(contentObject));
                                        assert.strictEqual(searchedDoc.tenantAlias, getTenantAlias(contentObject));
                                        assert.strictEqual(getVisibility(searchedDoc), getVisibility(contentObject));
                                        assert.strictEqual(getResourceType(searchedDoc), CONTENT);
                                        assert.strictEqual(
                                          searchedDoc.profilePath,
                                          concat(
                                            `/content/${getTenantAlias(contentObject)}`,
                                            `/${AuthzUtil.getResourceFromId(getId(contentObject)).resourceId}`
                                          )
                                        );
                                        assert.strictEqual(searchedDoc.id, contentObject.id);
                                        assert.strictEqual(undefined, searchedDoc._extra);
                                        assert.strictEqual(undefined, searchedDoc._type);
                                        assert.strictEqual(undefined, searchedDoc.q_high);
                                        assert.strictEqual(undefined, searchedDoc.q_low);
                                        assert.strictEqual(undefined, searchedDoc.sort);

                                        /**
                                         * Since lastModified time gets updated for more than just profile
                                         * updates (e.g., share, library updates, etc...), we should just
                                         * sanity check the lastModified in th search doc
                                         */
                                        assert.isAtLeast(getLastModified(searchedDoc), beforeCreated);

                                        // Verify global admin on a different tenant can see it
                                        searchRefreshed(
                                          asGlobalAdminOnTenant,
                                          GENERAL_SEARCH,
                                          NO_PARAMS,
                                          { q: uniqueString, scope: NETWORK_SCOPE },
                                          (error, results) => {
                                            assert.notExists(error);

                                            const searchedDoc = fetchWithin(results, getId(contentObject));
                                            assert.ok(searchedDoc);
                                            assert.strictEqual(searchedDoc.resourceSubType, LINK);
                                            assert.strictEqual(
                                              getDisplayName(searchedDoc),
                                              getDisplayName(contentObject)
                                            );
                                            assert.strictEqual(searchedDoc.tenantAlias, getTenantAlias(contentObject));
                                            assert.strictEqual(
                                              getVisibility(searchedDoc),
                                              getVisibility(contentObject)
                                            );
                                            assert.strictEqual(getResourceType(searchedDoc), CONTENT);
                                            assert.strictEqual(
                                              searchedDoc.profilePath,
                                              concat(
                                                `/content/${getTenantAlias(contentObject)}`,
                                                `/${AuthzUtil.getResourceFromId(getId(contentObject)).resourceId}`
                                              )
                                            );
                                            assert.strictEqual(searchedDoc.id, contentObject.id);
                                            assert.strictEqual(undefined, searchedDoc._extra);
                                            assert.strictEqual(undefined, searchedDoc._type);
                                            assert.strictEqual(undefined, searchedDoc.q_high);
                                            assert.strictEqual(undefined, searchedDoc.q_low);
                                            assert.strictEqual(undefined, searchedDoc.sort);

                                            /**
                                             * Since lastModified time gets updated for more than just profile
                                             * updates (e.g., share, library updates, etc...), we should just
                                             * sanity check the lastModified in th search doc
                                             */
                                            assert.isAtLeast(getLastModified(searchedDoc), beforeCreated);

                                            /**
                                             * Generate a new group, make Jack a member of it, create a piece of content and
                                             * share it with the group. All of this is done so we can check the direct membership
                                             * filter is NOT cached
                                             */

                                            generateTestGroups(asTheBoss, 1, (error, moreGroups) => {
                                              assert.notExists(error);

                                              const { 0: anotherGroup } = moreGroups;
                                              const permissions = assoc(elvisId, MEMBER, {});

                                              setGroupMembers(
                                                asTheBoss,
                                                anotherGroup.group.id,
                                                permissions,
                                                (error_) => {
                                                  assert.notExists(error_);

                                                  createLink(
                                                    asTheBoss,
                                                    {
                                                      displayName: uniqueString,
                                                      description: 'Test content description 2',
                                                      visibility: PRIVATE,
                                                      link: 'http://www.oaeproject.org/',
                                                      managers: NO_MANAGERS,
                                                      viewers: of(anotherGroup.group.id),
                                                      folders: NO_FOLDERS
                                                    },
                                                    (error, link2) => {
                                                      assert.notExists(error);

                                                      searchRefreshed(
                                                        asElvis,
                                                        GENERAL_SEARCH,
                                                        NO_PARAMS,
                                                        { q: uniqueString },
                                                        (error, results) => {
                                                          assert.notExists(error);

                                                          const searchedDoc = isWithin(results, link2.id);
                                                          assert.ok(searchedDoc);
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
     * Test that verifies when a user has access to a content item VIA direct group membership,
     * the content item can be queried in search
     */
    it('verify private content item is searchable when access is granted by direct group membership', (callback) => {
      const uniqueString = generateRandomText(5);

      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: meireles, 1: fonseca } = users;
        const asMeireles = meireles.restContext;
        const asFonseca = fonseca.restContext;

        generateTestGroups(asMeireles, 1, (error, groups) => {
          assert.notExists(error);

          const { 0: someGroup } = groups;
          const update = assoc(fonseca.user.id, MEMBER, {});

          setGroupMembers(asMeireles, someGroup.group.id, update, (error_) => {
            assert.notExists(error_);

            // Create a private content item to which only the group has access
            createLink(
              asCambridgeTenantAdmin,
              {
                displayName: uniqueString,
                description: 'Test content description 1',
                visibility: PRIVATE,
                link: 'http://www.oaeproject.org/',
                managers: NO_MANAGERS,
                viewers: of(someGroup.group.id),
                folders: NO_FOLDERS
              },
              (error, content) => {
                assert.notExists(error);

                searchRefreshed(
                  asMeireles,
                  GENERAL_SEARCH,
                  NO_PARAMS,
                  { q: uniqueString, scope: NETWORK_SCOPE },
                  (error, results) => {
                    assert.notExists(error);
                    assert.ok(isWithin(results, content.id));

                    searchRefreshed(
                      asFonseca,
                      GENERAL_SEARCH,
                      NO_PARAMS,
                      { q: uniqueString, scope: NETWORK_SCOPE },
                      (error, results) => {
                        assert.notExists(error);
                        assert.ok(isWithin(results, content.id));

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
    before(rebuildSearchIndex);
    /**
     * Test that verifies public user search results are not hidden from anyone.
     */
    it('verify public user profile visible to everyone', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: meireles, 1: fonseca } = users;
        const asMeireles = meireles.restContext;
        const meirelesId = meireles.user.id;
        const asFonseca = fonseca.restContext;

        generateTestUsers(asGeorgiaTenantAdmin, 1, (error, users) => {
          assert.notExists(error);

          const { 0: barbosa } = users;
          const asBarbosa = barbosa.restContext;

          const meirelesOptions = {
            visibility: 'public',
            publicAlias: 'I was hidden'
          };

          updateUser(asMeireles, meirelesId, meirelesOptions, (error, updatedMeireles) => {
            assert.notExists(error);
            meireles.user = updatedMeireles;

            // Verify hidden for cross-tenant user on internal search
            searchRefreshed(
              asBarbosa,
              GENERAL_SEARCH,
              NO_PARAMS,
              {
                resourceTypes: USER,
                q: meireles.user.displayName,
                scope: global.oaeTests.tenants.gt.alias
              },
              (error, results) => {
                assert.notExists(error);

                const meirelesSearchedDoc = fetchWithin(results, meirelesId);
                assert.ok(not(meirelesSearchedDoc));

                // Verify visible for cross-tenant user on external search
                searchRefreshed(
                  asBarbosa,
                  GENERAL_SEARCH,
                  NO_PARAMS,
                  { resourceTypes: USER, q: meireles.user.displayName, scope: NETWORK_SCOPE },
                  (error, results) => {
                    assert.notExists(error);

                    const meirelesSearchedDoc = fetchWithin(results, meirelesId);
                    assert.ok(meirelesSearchedDoc);
                    assert.strictEqual(meirelesSearchedDoc.id, meirelesId);
                    assert.strictEqual(meirelesSearchedDoc.resourceType, USER);
                    assert.strictEqual(
                      meirelesSearchedDoc.profilePath,
                      concat(
                        `/user/${meirelesSearchedDoc.tenant.alias}`,
                        `/${AuthzUtil.getResourceFromId(meirelesSearchedDoc.id).resourceId}`
                      )
                    );
                    assert.strictEqual(meirelesSearchedDoc.tenantAlias, meireles.user.tenant.alias);
                    assert.strictEqual(meirelesSearchedDoc.displayName, meireles.user.displayName);
                    assert.strictEqual(meirelesSearchedDoc.visibility, meireles.user.visibility);
                    assert.strictEqual(meirelesSearchedDoc._extra, undefined);
                    assert.strictEqual(meirelesSearchedDoc.extra, undefined);
                    assert.strictEqual(meirelesSearchedDoc.q_high, undefined);
                    assert.strictEqual(meirelesSearchedDoc.q_low, undefined);
                    assert.strictEqual(meirelesSearchedDoc.sort, undefined);
                    assert.strictEqual(meirelesSearchedDoc._type, undefined);

                    // Verify not hidden for anonymous
                    searchRefreshed(
                      asCambridgeAnonymousUser,
                      GENERAL_SEARCH,
                      NO_PARAMS,
                      { resourceTypes: USER, q: meireles.user.displayName },
                      (error, results) => {
                        assert.notExists(error);

                        const meirelesSearchedDoc = fetchWithin(results, meirelesId);
                        assert.ok(meirelesSearchedDoc);
                        assert.strictEqual(meirelesSearchedDoc.id, meirelesId);
                        assert.strictEqual(meirelesSearchedDoc.resourceType, USER);
                        assert.strictEqual(
                          meirelesSearchedDoc.profilePath,
                          concat(
                            `/user/${meirelesSearchedDoc.tenant.alias}`,
                            `/${AuthzUtil.getResourceFromId(meirelesSearchedDoc.id).resourceId}`
                          )
                        );
                        assert.strictEqual(meirelesSearchedDoc.tenantAlias, meireles.user.tenant.alias);
                        assert.strictEqual(meirelesSearchedDoc.displayName, meireles.user.displayName);
                        assert.strictEqual(meirelesSearchedDoc.visibility, meireles.user.visibility);
                        assert.strictEqual(meirelesSearchedDoc._extra, undefined);
                        assert.strictEqual(meirelesSearchedDoc.extra, undefined);
                        assert.strictEqual(meirelesSearchedDoc.q_high, undefined);
                        assert.strictEqual(meirelesSearchedDoc.q_low, undefined);
                        assert.strictEqual(meirelesSearchedDoc.sort, undefined);
                        assert.strictEqual(meirelesSearchedDoc._type, undefined);

                        // Verify not hidden for other in-tenant loggedin user
                        searchRefreshed(
                          asFonseca,
                          GENERAL_SEARCH,
                          NO_PARAMS,
                          { resourceTypes: USER, q: meireles.user.displayName },
                          (error, results) => {
                            assert.notExists(error);

                            const searchedDoc = fetchWithin(results, meirelesId);
                            assert.ok(searchedDoc);
                            assert.strictEqual(searchedDoc.id, meirelesId);
                            assert.strictEqual(searchedDoc.resourceType, USER);
                            assert.strictEqual(
                              searchedDoc.profilePath,
                              concat(
                                `/user/${searchedDoc.tenant.alias}`,
                                `/${AuthzUtil.getResourceFromId(searchedDoc.id).resourceId}`
                              )
                            );
                            assert.strictEqual(searchedDoc.tenantAlias, meireles.user.tenant.alias);
                            assert.strictEqual(searchedDoc.displayName, meireles.user.displayName);
                            assert.strictEqual(searchedDoc.visibility, meireles.user.visibility);
                            assert.strictEqual(searchedDoc._extra, undefined);
                            assert.strictEqual(searchedDoc.extra, undefined);
                            assert.strictEqual(searchedDoc.q_high, undefined);
                            assert.strictEqual(searchedDoc.q_low, undefined);
                            assert.strictEqual(searchedDoc.sort, undefined);
                            assert.strictEqual(searchedDoc._type, undefined);

                            // Verify not hidden for admin
                            searchRefreshed(
                              asCambridgeTenantAdmin,
                              GENERAL_SEARCH,
                              NO_PARAMS,
                              { resourceTypes: USER, q: meireles.user.displayName },
                              (error, results) => {
                                assert.notExists(error);

                                const meirelesSearchedDoc = fetchWithin(results, meirelesId);
                                assert.ok(meirelesSearchedDoc);
                                assert.strictEqual(meirelesSearchedDoc.id, meireles.user.id);
                                assert.strictEqual(meirelesSearchedDoc.resourceType, USER);
                                assert.strictEqual(
                                  meirelesSearchedDoc.profilePath,
                                  concat(
                                    `/user/${meirelesSearchedDoc.tenant.alias}`,
                                    `/${AuthzUtil.getResourceFromId(meirelesSearchedDoc.id).resourceId}`
                                  )
                                );
                                assert.strictEqual(meirelesSearchedDoc.tenantAlias, meireles.user.tenant.alias);
                                assert.strictEqual(meirelesSearchedDoc.displayName, meireles.user.displayName);
                                assert.strictEqual(meirelesSearchedDoc.visibility, meireles.user.visibility);
                                assert.strictEqual(meirelesSearchedDoc._extra, undefined);
                                assert.strictEqual(meirelesSearchedDoc.extra, undefined);
                                assert.strictEqual(meirelesSearchedDoc.q_high, undefined);
                                assert.strictEqual(meirelesSearchedDoc.q_low, undefined);
                                assert.strictEqual(meirelesSearchedDoc.sort, undefined);
                                assert.strictEqual(meirelesSearchedDoc._type, undefined);

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
    it('verify loggedin user profile not visibile cross-tenant or to anonymous', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: fonseca, 1: lopes } = users;
        const asFonseca = fonseca.restContext;
        const fonsecaId = fonseca.user.id;

        const asLopes = lopes.restContext;

        generateTestUsers(asGeorgiaTenantAdmin, 1, (error, users) => {
          assert.notExists(error);

          const { 0: silva } = users;
          const asSilva = silva.restContext;

          const fonseca = {
            visibility: 'loggedin',
            publicAlias: 'I was hidden'
          };
          updateUser(asFonseca, fonsecaId, fonseca, (error, updatedFonseca) => {
            assert.notExists(error);
            fonseca.user = updatedFonseca;

            // Verify hidden for cross-tenant user on internal search
            searchRefreshed(
              asSilva,
              GENERAL_SEARCH,
              NO_PARAMS,
              { resourceTypes: USER, q: fonseca.user.displayName },
              (error, results) => {
                assert.notExists(error);

                const searchedDoc = fetchWithin(results, fonsecaId);
                assert.ok(not(searchedDoc));

                // Verify not visible for cross-tenant user on external search
                searchRefreshed(
                  asSilva,
                  GENERAL_SEARCH,
                  NO_PARAMS,
                  { resourceTypes: USER, q: fonseca.user.displayName, scope: NETWORK_SCOPE },
                  (error, results) => {
                    assert.notExists(error);

                    const searchedDoc = fetchWithin(results, fonsecaId);
                    assert.ok(not(searchedDoc));

                    // Verify not visible for anonymous
                    searchRefreshed(
                      asCambridgeAnonymousUser,
                      GENERAL_SEARCH,
                      NO_PARAMS,
                      { resourceTypes: USER, q: fonseca.user.displayName },
                      (error, results) => {
                        assert.notExists(error);

                        const searchedDoc = fetchWithin(results, fonsecaId);
                        assert.ok(not(searchedDoc));

                        // Verify visible for other in-tenant loggedin user
                        searchRefreshed(
                          asLopes,
                          GENERAL_SEARCH,
                          NO_PARAMS,
                          { resourceTypes: USER, q: fonseca.user.displayName },
                          (error, results) => {
                            assert.notExists(error);

                            const searchedDoc = fetchWithin(results, fonsecaId);
                            assert.ok(searchedDoc);
                            assert.strictEqual(searchedDoc.id, fonsecaId);
                            assert.strictEqual(searchedDoc.resourceType, USER);
                            assert.strictEqual(
                              searchedDoc.profilePath,
                              concat(
                                `/user/${searchedDoc.tenant.alias}`,
                                `/${AuthzUtil.getResourceFromId(searchedDoc.id).resourceId}`
                              )
                            );
                            assert.strictEqual(searchedDoc.tenantAlias, fonseca.user.tenant.alias);
                            assert.strictEqual(searchedDoc.displayName, fonseca.user.displayName);
                            assert.strictEqual(searchedDoc.visibility, fonseca.user.visibility);
                            assert.strictEqual(searchedDoc._extra, undefined);
                            assert.strictEqual(searchedDoc.extra, undefined);
                            assert.strictEqual(searchedDoc.q_high, undefined);
                            assert.strictEqual(searchedDoc.q_low, undefined);
                            assert.strictEqual(searchedDoc.sort, undefined);
                            assert.strictEqual(searchedDoc._type, undefined);

                            // Verify not hidden for admin
                            searchRefreshed(
                              asCambridgeTenantAdmin,
                              GENERAL_SEARCH,
                              NO_PARAMS,
                              { resourceTypes: USER, q: fonseca.user.displayName },
                              (error, results) => {
                                assert.notExists(error);

                                const searchedDoc = fetchWithin(results, fonsecaId);
                                assert.ok(searchedDoc);
                                assert.strictEqual(searchedDoc.id, fonsecaId);
                                assert.strictEqual(searchedDoc.resourceType, USER);
                                assert.strictEqual(
                                  searchedDoc.profilePath,
                                  concat(
                                    `/user/${searchedDoc.tenant.alias}`,
                                    `/${AuthzUtil.getResourceFromId(searchedDoc.id).resourceId}`
                                  )
                                );
                                assert.strictEqual(searchedDoc.tenantAlias, fonseca.user.tenant.alias);
                                assert.strictEqual(searchedDoc.displayName, fonseca.user.displayName);
                                assert.strictEqual(searchedDoc.visibility, fonseca.user.visibility);
                                assert.strictEqual(searchedDoc._extra, undefined);
                                assert.strictEqual(searchedDoc.extra, undefined);
                                assert.strictEqual(searchedDoc.q_high, undefined);
                                assert.strictEqual(searchedDoc.q_low, undefined);
                                assert.strictEqual(searchedDoc.sort, undefined);
                                assert.strictEqual(searchedDoc._type, undefined);

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
    it('verify private user profile not visibile to anyone but admin users and the user themself', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: fonseca, 1: lopes } = users;
        const asFonseca = fonseca.restContext;
        const fonsecaId = fonseca.user.id;
        const asLopes = lopes.restContext;

        generateTestUsers(asGeorgiaTenantAdmin, 1, (error, users) => {
          assert.notExists(error);

          const { 0: silva } = users;
          const asSilva = silva.restContext;

          const fonsecaOptions = {
            visibility: 'private',
            publicAlias: 'I was hidden'
          };
          updateUser(asFonseca, fonsecaId, fonsecaOptions, (error, updatedFonseca) => {
            assert.notExists(error);
            fonseca.user = updatedFonseca;

            // Verify hidden for cross-tenant user on internal search
            searchRefreshed(
              asSilva,
              GENERAL_SEARCH,
              NO_PARAMS,
              { resourceTypes: USER, q: fonseca.user.displayName },
              (error, results) => {
                assert.notExists(error);

                const searchedDoc = fetchWithin(results, fonsecaId);
                assert.ok(not(searchedDoc));

                // Verify not visible for cross-tenant user on external search
                searchRefreshed(
                  asSilva,
                  GENERAL_SEARCH,
                  NO_PARAMS,
                  { resourceTypes: USER, q: fonseca.user.displayName, scope: NETWORK_SCOPE },
                  (error, results) => {
                    assert.notExists(error);

                    const searchedDoc = fetchWithin(results, fonsecaId);
                    assert.ok(not(searchedDoc));

                    // Verify not visible for anonymous
                    searchRefreshed(
                      asCambridgeAnonymousUser,
                      GENERAL_SEARCH,
                      NO_PARAMS,
                      { resourceTypes: USER, q: fonseca.user.displayName },
                      (error, results) => {
                        assert.notExists(error);

                        const searchedDoc = fetchWithin(results, fonsecaId);
                        assert.ok(not(searchedDoc));

                        // Verify not visible for other in-tenant loggedin user
                        searchRefreshed(
                          asLopes,
                          GENERAL_SEARCH,
                          NO_PARAMS,
                          { resourceTypes: USER, q: fonseca.user.displayName },
                          (error, results) => {
                            assert.notExists(error);

                            const searchedDoc = fetchWithin(results, fonsecaId);
                            assert.ok(not(searchedDoc));

                            // Verify not hidden for tenant admin
                            searchRefreshed(
                              asCambridgeTenantAdmin,
                              GENERAL_SEARCH,
                              NO_PARAMS,
                              { resourceTypes: USER, q: fonseca.user.displayName },
                              (error, results) => {
                                assert.notExists(error);

                                const searchedDoc = fetchWithin(results, fonsecaId);
                                assert.ok(searchedDoc);
                                assert.strictEqual(searchedDoc.id, fonsecaId);
                                assert.strictEqual(searchedDoc.resourceType, USER);
                                assert.strictEqual(
                                  searchedDoc.profilePath,
                                  concat(
                                    `/user/${searchedDoc.tenant.alias}`,
                                    `/${AuthzUtil.getResourceFromId(searchedDoc.id).resourceId}`
                                  )
                                );
                                assert.strictEqual(searchedDoc.tenantAlias, fonseca.user.tenant.alias);
                                assert.strictEqual(searchedDoc.displayName, fonseca.user.displayName);
                                assert.strictEqual(searchedDoc.visibility, fonseca.user.visibility);
                                assert.strictEqual(searchedDoc._extra, undefined);
                                assert.strictEqual(searchedDoc.extra, undefined);
                                assert.strictEqual(searchedDoc.q_high, undefined);
                                assert.strictEqual(searchedDoc.q_low, undefined);
                                assert.strictEqual(searchedDoc.sort, undefined);
                                assert.strictEqual(searchedDoc._type, undefined);

                                // Verify not hidden for global admin authenticated to a different tenant
                                searchRefreshed(
                                  asGlobalAdminOnTenant,
                                  GENERAL_SEARCH,
                                  NO_PARAMS,
                                  {
                                    resourceTypes: USER,
                                    q: fonseca.user.displayName,
                                    scope: NETWORK_SCOPE
                                  },
                                  (error, results) => {
                                    assert.notExists(error);

                                    const searchedDoc = fetchWithin(results, fonsecaId);
                                    assert.ok(searchedDoc);
                                    assert.strictEqual(searchedDoc.id, fonsecaId);
                                    assert.strictEqual(searchedDoc.resourceType, USER);
                                    assert.strictEqual(
                                      searchedDoc.profilePath,
                                      concat(
                                        `/user/${searchedDoc.tenant.alias}`,
                                        `/${AuthzUtil.getResourceFromId(searchedDoc.id).resourceId}`
                                      )
                                    );
                                    assert.strictEqual(searchedDoc.tenantAlias, fonseca.user.tenant.alias);
                                    assert.strictEqual(searchedDoc.displayName, fonseca.user.displayName);
                                    assert.strictEqual(searchedDoc.visibility, fonseca.user.visibility);
                                    assert.strictEqual(searchedDoc._extra, undefined);
                                    assert.strictEqual(searchedDoc.extra, undefined);
                                    assert.strictEqual(searchedDoc.q_high, undefined);
                                    assert.strictEqual(searchedDoc.q_low, undefined);
                                    assert.strictEqual(searchedDoc.sort, undefined);
                                    assert.strictEqual(searchedDoc._type, undefined);

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
    before(rebuildSearchIndex);
    /**
     * Test that verifies public groups are searchable by everyone
     */
    it('verify public group is searchable by everyone', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: fonseca, 1: lopes } = users;
        const asFonseca = fonseca.restContext;
        const asLopes = lopes.restContext;

        generateTestUsers(asGeorgiaTenantAdmin, 2, (error, users) => {
          assert.notExists(error);

          const { 0: silva, 1: barbosa } = users;
          const asSilva = silva.restContext;
          const asBarbosa = barbosa.restContext;

          // Create the group, including sith as a user
          const uniqueString = generateTestUserId('public-group-visibility');

          createGroup(
            asFonseca,
            uniqueString,
            uniqueString,
            PUBLIC,
            NOT_JOINABLE,
            NO_MANAGERS,
            [barbosa.user.id],
            (error, group) => {
              assert.notExists(error);

              // Verify anonymous user search can access it
              searchRefreshed(
                asCambridgeAnonymousUser,
                GENERAL_SEARCH,
                NO_PARAMS,
                { resourceTypes: GROUP, q: uniqueString },
                (error, results) => {
                  assert.notExists(error);

                  const groupDoc = fetchWithin(results, group.id);
                  assert.ok(groupDoc);
                  assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                  assert.strictEqual(groupDoc.resourceType, GROUP);
                  assert.strictEqual(
                    groupDoc.profilePath,
                    concat(`/group/${groupDoc.tenant.alias}`, `/${AuthzUtil.getResourceFromId(groupDoc.id).resourceId}`)
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
                  searchRefreshed(
                    asSilva,
                    GENERAL_SEARCH,
                    NO_PARAMS,
                    { resourceTypes: GROUP, q: uniqueString, scope: NETWORK_SCOPE },
                    (error, results) => {
                      assert.notExists(error);

                      const groupDoc = fetchWithin(results, group.id);
                      assert.ok(groupDoc);
                      assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                      assert.strictEqual(groupDoc.resourceType, GROUP);
                      assert.strictEqual(
                        groupDoc.profilePath,
                        concat(
                          `/group/${groupDoc.tenant.alias}`,
                          `/${AuthzUtil.getResourceFromId(groupDoc.id).resourceId}`
                        )
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
                      searchRefreshed(
                        asBarbosa,
                        GENERAL_SEARCH,
                        NO_PARAMS,
                        { resourceTypes: GROUP, q: uniqueString, scope: TENANT_SCOPE },
                        (error, results) => {
                          assert.notExists(error);

                          const groupDoc = fetchWithin(results, group.id);
                          assert.ok(groupDoc);
                          assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                          assert.strictEqual(groupDoc.resourceType, GROUP);
                          assert.strictEqual(
                            groupDoc.profilePath,
                            concat(
                              `/group/${groupDoc.tenant.alias}`,
                              `/${AuthzUtil.getResourceFromId(groupDoc.id).resourceId}`
                            )
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
                          searchRefreshed(
                            asLopes,
                            GENERAL_SEARCH,
                            NO_PARAMS,
                            { resourceTypes: GROUP, q: uniqueString },
                            (error, results) => {
                              assert.notExists(error);

                              const groupDoc = fetchWithin(results, group.id);
                              assert.ok(groupDoc);
                              assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                              assert.strictEqual(groupDoc.resourceType, GROUP);
                              assert.strictEqual(
                                groupDoc.profilePath,
                                concat(
                                  `/group/${groupDoc.tenant.alias}`,
                                  `/${AuthzUtil.getResourceFromId(groupDoc.id).resourceId}`
                                )
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
                              searchRefreshed(
                                asFonseca,
                                GENERAL_SEARCH,
                                NO_PARAMS,
                                { resourceTypes: GROUP, q: uniqueString },
                                (error, results) => {
                                  assert.notExists(error);

                                  const groupDoc = fetchWithin(results, group.id);
                                  assert.ok(groupDoc);
                                  assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                                  assert.strictEqual(groupDoc.resourceType, GROUP);
                                  assert.strictEqual(
                                    groupDoc.profilePath,
                                    concat(
                                      `/group/${groupDoc.tenant.alias}`,
                                      `/${AuthzUtil.getResourceFromId(groupDoc.id).resourceId}`
                                    )
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
    it('verify loggedin group search visibility', (callback) => {
      const somePrivateTenantAlias = generateTestTenantAlias('privateTenant');
      const someTenantHost = generateTestTenantHost();
      const uniqueStringA = generateTestUserId('loggedin-group-visibility');
      const uniqueStringB = generateTestUserId('loggedin-group-visibility');
      const uniqueStringC = generateTestUserId('loggedin-group-visibility-skywalker');

      /**
       * Create a private tenant with a user and a loggedin joinable group.
       * These will be used to test searches for cross-tenant private groups where
       * you do not have access to join the group. In those cases, you should not get the group in the search results.
       */
      createTenantWithAdmin(somePrivateTenantAlias, someTenantHost, (error, privateTenant, asAdminOfPrivateTenant) => {
        assert.notExists(error);

        updateConfigAndWait(
          asGlobalAdmin,
          somePrivateTenantAlias,
          { 'oae-tenants/tenantprivacy/tenantprivate': true },
          (error_) => {
            assert.notExists(error_);

            generateTestUsers(asAdminOfPrivateTenant, 1, (error, users) => {
              assert.notExists(error);

              const { 0: elvis } = users;
              const asElvis = elvis.restContext;

              createGroup(
                asElvis,
                uniqueStringC,
                uniqueStringC,
                LOGGED_IN,
                JOINABLE,
                NO_MANAGERS,
                NO_MEMBERS,
                (error, somePrivateTenantGroup) => {
                  assert.notExists(error);

                  // Create 2 users from another public tenant tenant (gt), one of which has access to the group, and 2 users from the same tenant
                  generateTestUsers(asGeorgiaTenantAdmin, 2, (error, users) => {
                    assert.notExists(error);

                    const { 0: jackson, 1: pavarotti } = users;
                    const asJackson = jackson.restContext;
                    const asPavarotti = pavarotti.restContext;

                    generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
                      assert.notExists(error);

                      const { 0: bono, 1: marley } = users;
                      const asBono = bono.restContext;
                      const asMarley = marley.restContext;

                      // Create the group, including sith as a user
                      createGroup(
                        asBono,
                        uniqueStringA,
                        uniqueStringA,
                        LOGGED_IN,
                        NOT_JOINABLE,
                        NO_MANAGERS,
                        [pavarotti.user.id],
                        (error, group) => {
                          assert.notExists(error);

                          // Create the joinable group, including sith as a user
                          createGroup(
                            asBono,
                            uniqueStringB,
                            uniqueStringB,
                            LOGGED_IN,
                            JOINABLE_BY_REQUEST,
                            NO_MANAGERS,
                            [pavarotti.user.id],
                            (error, groupJoinable) => {
                              assert.notExists(error);

                              // Verify anonymous user search cannot access either
                              searchRefreshed(
                                asCambridgeAnonymousUser,
                                GENERAL_SEARCH,
                                NO_PARAMS,
                                { resourceTypes: GROUP, q: uniqueStringA },
                                (error, results) => {
                                  assert.notExists(error);

                                  const groupDoc = fetchWithin(results, group.id);
                                  assert.ok(not(groupDoc));

                                  searchRefreshed(
                                    asCambridgeAnonymousUser,
                                    GENERAL_SEARCH,
                                    NO_PARAMS,
                                    { resourceTypes: GROUP, q: uniqueStringB },
                                    (error, results) => {
                                      assert.notExists(error);

                                      const groupDoc = fetchWithin(results, groupJoinable.id);
                                      assert.ok(not(groupDoc));

                                      // Verify cross-tenant user cannot query the unjoinable group
                                      searchRefreshed(
                                        asJackson,
                                        GENERAL_SEARCH,
                                        NO_PARAMS,
                                        {
                                          resourceTypes: GROUP,
                                          q: uniqueStringA,
                                          scope: NETWORK_SCOPE
                                        },
                                        (error, results) => {
                                          assert.notExists(error);

                                          const groupDoc = fetchWithin(results, group.id);
                                          assert.ok(not(groupDoc));

                                          // Verify cross-tenant user cannot query the joinable group
                                          searchRefreshed(
                                            asJackson,
                                            GENERAL_SEARCH,
                                            NO_PARAMS,
                                            {
                                              resourceTypes: GROUP,
                                              q: uniqueStringB,
                                              scope: NETWORK_SCOPE
                                            },
                                            (error, results) => {
                                              assert.notExists(error);
                                              assert.ok(isNotWithin(results, groupJoinable.id));

                                              // Verify cross-tenant member can query the unjoinable group
                                              searchRefreshed(
                                                asPavarotti,
                                                GENERAL_SEARCH,
                                                NO_PARAMS,
                                                {
                                                  resourceTypes: GROUP,
                                                  q: uniqueStringA
                                                },
                                                (error, results) => {
                                                  assert.notExists(error);

                                                  const groupDoc = fetchWithin(results, group.id);
                                                  assert.ok(groupDoc);
                                                  assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                                                  assert.strictEqual(groupDoc.resourceType, GROUP);
                                                  assert.strictEqual(
                                                    groupDoc.profilePath,
                                                    concat(
                                                      `/group/${groupDoc.tenant.alias}`,
                                                      `/${AuthzUtil.getResourceFromId(groupDoc.id).resourceId}`
                                                    )
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
                                                  searchRefreshed(
                                                    asMarley,
                                                    GENERAL_SEARCH,
                                                    NO_PARAMS,
                                                    {
                                                      resourceTypes: GROUP,
                                                      q: uniqueStringA
                                                    },
                                                    (error, results) => {
                                                      assert.notExists(error);

                                                      const groupDoc = fetchWithin(results, group.id);
                                                      assert.ok(groupDoc);
                                                      assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                                                      assert.strictEqual(groupDoc.resourceType, GROUP);
                                                      assert.strictEqual(
                                                        groupDoc.profilePath,
                                                        concat(
                                                          `/group/${groupDoc.tenant.alias}`,
                                                          `/${AuthzUtil.getResourceFromId(groupDoc.id).resourceId}`
                                                        )
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
                                                      searchRefreshed(
                                                        asBono,
                                                        GENERAL_SEARCH,
                                                        NO_PARAMS,
                                                        {
                                                          resourceTypes: GROUP,
                                                          q: uniqueStringA
                                                        },
                                                        (error, results) => {
                                                          assert.notExists(error);

                                                          const groupDoc = fetchWithin(results, group.id);
                                                          assert.ok(groupDoc);
                                                          assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                                                          assert.strictEqual(groupDoc.resourceType, GROUP);
                                                          assert.strictEqual(
                                                            groupDoc.profilePath,
                                                            concat(
                                                              `/group/${groupDoc.tenant.alias}`,
                                                              `/${AuthzUtil.getResourceFromId(groupDoc.id).resourceId}`
                                                            )
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
                                                          searchRefreshed(
                                                            asElvis,
                                                            GENERAL_SEARCH,
                                                            NO_PARAMS,
                                                            {
                                                              resourceTypes: GROUP,
                                                              q: uniqueStringC
                                                            },
                                                            (error, results) => {
                                                              assert.notExists(error);

                                                              const groupDoc = fetchWithin(
                                                                results,
                                                                somePrivateTenantGroup.id
                                                              );
                                                              assert.ok(groupDoc);
                                                              assert.strictEqual(
                                                                groupDoc.tenantAlias,
                                                                somePrivateTenantGroup.tenant.alias
                                                              );
                                                              assert.strictEqual(groupDoc.resourceType, GROUP);
                                                              assert.strictEqual(
                                                                groupDoc.profilePath,
                                                                concat(
                                                                  `/group/${groupDoc.tenant.alias}`,
                                                                  `/${
                                                                    AuthzUtil.getResourceFromId(groupDoc.id).resourceId
                                                                  }`
                                                                )
                                                              );
                                                              assert.strictEqual(
                                                                groupDoc.id,
                                                                somePrivateTenantGroup.id
                                                              );
                                                              assert.strictEqual(
                                                                groupDoc.displayName,
                                                                somePrivateTenantGroup.displayName
                                                              );
                                                              assert.strictEqual(
                                                                groupDoc.visibility,
                                                                somePrivateTenantGroup.visibility
                                                              );
                                                              assert.strictEqual(groupDoc._extra, undefined);
                                                              assert.strictEqual(groupDoc._type, undefined);
                                                              assert.strictEqual(groupDoc.q_high, undefined);
                                                              assert.strictEqual(groupDoc.q_low, undefined);
                                                              assert.strictEqual(groupDoc.sort, undefined);

                                                              // Verify a user from a private tenant cannot query an external loggedin joinable group
                                                              searchRefreshed(
                                                                asElvis,
                                                                GENERAL_SEARCH,
                                                                NO_PARAMS,
                                                                {
                                                                  resourceTypes: GROUP,
                                                                  q: uniqueStringB,
                                                                  scope: NETWORK_SCOPE
                                                                },
                                                                (error, results) => {
                                                                  assert.notExists(error);

                                                                  const groupDoc = fetchWithin(
                                                                    results,
                                                                    groupJoinable.id
                                                                  );
                                                                  assert.ok(not(groupDoc));

                                                                  /**
                                                                   * Verify that user from a public tenant cannot query a loggedin joinable group
                                                                   * that belongs to a private tenant (luke skywalker's tenant and group)
                                                                   */
                                                                  searchRefreshed(
                                                                    asBono,
                                                                    GENERAL_SEARCH,
                                                                    NO_PARAMS,
                                                                    {
                                                                      resourceTypes: GROUP,
                                                                      q: uniqueStringC,
                                                                      scope: NETWORK_SCOPE
                                                                    },
                                                                    (error, results) => {
                                                                      assert.notExists(error);

                                                                      const groupDoc = fetchWithin(
                                                                        results,
                                                                        somePrivateTenantGroup.id
                                                                      );
                                                                      assert.ok(not(groupDoc));

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
      });
    });

    /**
     * Test that verifies that unjoinable private groups are only searchable by members. It also verifies that if the group is joinable ('yes' or 'request'),
     * that it is searchable by authenticated users from other tenants so long as the group's tenant *and* the other tenant are both public.
     */
    it('verify private group search visibility', (callback) => {
      const somePrivateTenantAlias = generateTestTenantAlias('privateTenant');
      const someTenantHost = generateTestTenantHost();
      const uniqueStringA = generateTestUserId('loggedin-group-visibility');
      const uniqueStringB = generateTestUserId('loggedin-group-visibility');

      /**
       * Create a private tenant with a user and a loggedin joinable group.
       * These will be used to test searches for cross-tenant private groups
       * where you do not have access to join the group.
       * In those cases, you should not get the group in the search results.
       */
      createTenantWithAdmin(somePrivateTenantAlias, someTenantHost, (error, privateTenant, asAdminOfPrivateTenant) => {
        assert.notExists(error);

        updateConfigAndWait(
          asGlobalAdmin,
          somePrivateTenantAlias,
          { 'oae-tenants/tenantprivacy/tenantprivate': true },
          (error_) => {
            assert.notExists(error_);

            generateTestUsers(asAdminOfPrivateTenant, 1, (error, users) => {
              assert.notExists(error);

              const { 0: lukeSkywalker } = users;
              const asLukeSkywalker = lukeSkywalker.restContext;

              createGroup(
                asLukeSkywalker,
                generateTestUserId('privateTenantGroup'),
                'A luke skywalker tenant group',
                PRIVATE,
                JOINABLE,
                NO_MANAGERS,
                NO_MEMBERS,
                (error, somePrivateTenantGroup) => {
                  assert.notExists(error);

                  // Create 2 users from another public tenant tenant (gt), one of which has access to the group, and 2 users from the same tenant
                  generateTestUsers(asGeorgiaTenantAdmin, 2, (error, users) => {
                    assert.notExists(error);

                    const { 0: darthVader, 1: sith } = users;
                    const asDarthVader = darthVader.restContext;
                    const asSith = sith.restContext;

                    generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
                      assert.notExists(error);

                      const { 0: chewbacca, 1: kyloRen } = users;
                      const asChewbacca = chewbacca.restContext;
                      const asKyloRen = kyloRen.restContext;

                      // Create the group, including sith as a user
                      createGroup(
                        asChewbacca,
                        uniqueStringA,
                        uniqueStringA,
                        LOGGED_IN,
                        NOT_JOINABLE,
                        NO_MANAGERS,
                        [sith.user.id],
                        (error /* , group */) => {
                          assert.notExists(error);

                          // Create the joinable group, including sith as a user
                          createGroup(
                            asChewbacca,
                            uniqueStringB,
                            uniqueStringB,
                            LOGGED_IN,
                            JOINABLE_BY_REQUEST,
                            NO_MANAGERS,
                            [sith.user.id],
                            (error /* , groupJoinable */) => {
                              assert.notExists(error);

                              // Create the unjoinable group, including sith as a user
                              createGroup(
                                asChewbacca,
                                generateTestUserId('group'),
                                'A really awesome group',
                                PRIVATE,
                                NOT_JOINABLE,
                                NO_MANAGERS,
                                [sith.user.id],
                                (error, group) => {
                                  assert.notExists(error);

                                  // Create the joinable group, including sith as a user
                                  createGroup(
                                    asChewbacca,
                                    generateTestUserId('groupJoinable'),
                                    'A really super joinable group',
                                    PRIVATE,
                                    JOINABLE_BY_REQUEST,
                                    NO_MANAGERS,
                                    [sith.user.id],
                                    (error, groupJoinable) => {
                                      assert.notExists(error);

                                      // Verify anonymous user search cannot access either
                                      searchRefreshed(
                                        asCambridgeAnonymousUser,
                                        GENERAL_SEARCH,
                                        NO_PARAMS,
                                        { resourceTypes: GROUP, q: 'awesome' },
                                        (error, results) => {
                                          assert.notExists(error);

                                          const groupDoc = fetchWithin(results, group.id);
                                          assert.ok(not(groupDoc));

                                          searchRefreshed(
                                            asCambridgeAnonymousUser,
                                            GENERAL_SEARCH,
                                            NO_PARAMS,
                                            { resourceTypes: GROUP, q: 'joinable' },
                                            (error, results) => {
                                              assert.notExists(error);

                                              const groupDoc = fetchWithin(results, groupJoinable.id);
                                              assert.ok(not(groupDoc));

                                              // Verify cross-tenant user cannot query the unjoinable group
                                              searchRefreshed(
                                                asDarthVader,
                                                GENERAL_SEARCH,
                                                NO_PARAMS,
                                                {
                                                  resourceTypes: GROUP,
                                                  q: 'awesome',
                                                  scope: NETWORK_SCOPE
                                                },
                                                (error, results) => {
                                                  assert.notExists(error);

                                                  const groupDoc = fetchWithin(results, group.id);
                                                  assert.ok(not(groupDoc));

                                                  // Verify cross-tenant user cannot query the joinable group
                                                  searchRefreshed(
                                                    asDarthVader,
                                                    GENERAL_SEARCH,
                                                    NO_PARAMS,
                                                    {
                                                      resourceTypes: GROUP,
                                                      q: 'joinable',
                                                      scope: NETWORK_SCOPE
                                                    },
                                                    (error, results) => {
                                                      assert.notExists(error);
                                                      assert.ok(isNotWithin(results, groupJoinable.id));

                                                      // Verify cross-tenant member can query the unjoinable group
                                                      searchRefreshed(
                                                        asSith,
                                                        GENERAL_SEARCH,
                                                        NO_PARAMS,
                                                        {
                                                          resourceTypes: GROUP,
                                                          q: 'awesome'
                                                        },
                                                        (error, results) => {
                                                          assert.notExists(error);

                                                          const groupDoc = fetchWithin(results, group.id);
                                                          assert.ok(groupDoc);
                                                          assert.strictEqual(groupDoc.tenantAlias, group.tenant.alias);
                                                          assert.strictEqual(groupDoc.resourceType, GROUP);
                                                          assert.strictEqual(
                                                            groupDoc.profilePath,
                                                            concat(
                                                              `/group/${groupDoc.tenant.alias}`,
                                                              `/${AuthzUtil.getResourceFromId(groupDoc.id).resourceId}`
                                                            )
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
                                                          searchRefreshed(
                                                            asKyloRen,
                                                            GENERAL_SEARCH,
                                                            NO_PARAMS,
                                                            {
                                                              resourceTypes: GROUP,
                                                              q: 'awesome'
                                                            },
                                                            (error, results) => {
                                                              assert.notExists(error);

                                                              const groupDoc = fetchWithin(results, group.id);
                                                              assert.ok(not(groupDoc));

                                                              // Verify member user can query the unjoinable group
                                                              searchRefreshed(
                                                                asChewbacca,
                                                                GENERAL_SEARCH,
                                                                NO_PARAMS,
                                                                {
                                                                  resourceTypes: GROUP,
                                                                  q: 'awesome'
                                                                },
                                                                (error, results) => {
                                                                  assert.notExists(error);

                                                                  const groupDoc = fetchWithin(results, group.id);
                                                                  assert.ok(groupDoc);
                                                                  assert.strictEqual(
                                                                    groupDoc.tenantAlias,
                                                                    group.tenant.alias
                                                                  );
                                                                  assert.strictEqual(groupDoc.resourceType, GROUP);
                                                                  assert.strictEqual(
                                                                    groupDoc.profilePath,
                                                                    concat(
                                                                      `/group/${groupDoc.tenant.alias}`,
                                                                      `/${getResourceFromId(groupDoc.id).resourceId}`
                                                                    )
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
                                                                  searchRefreshed(
                                                                    asLukeSkywalker,
                                                                    GENERAL_SEARCH,
                                                                    NO_PARAMS,
                                                                    {
                                                                      resourceTypes: GROUP,
                                                                      q: 'skywalker'
                                                                    },
                                                                    (error, results) => {
                                                                      assert.notExists(error);

                                                                      const groupDoc = fetchWithin(
                                                                        results,
                                                                        somePrivateTenantGroup.id
                                                                      );
                                                                      assert.ok(groupDoc);
                                                                      assert.strictEqual(
                                                                        groupDoc.tenantAlias,
                                                                        somePrivateTenantGroup.tenant.alias
                                                                      );
                                                                      assert.strictEqual(groupDoc.resourceType, GROUP);
                                                                      assert.strictEqual(
                                                                        groupDoc.profilePath,
                                                                        concat(
                                                                          `/group/${groupDoc.tenant.alias}`,
                                                                          `/${
                                                                            getResourceFromId(groupDoc.id).resourceId
                                                                          }`
                                                                        )
                                                                      );
                                                                      assert.strictEqual(
                                                                        groupDoc.id,
                                                                        somePrivateTenantGroup.id
                                                                      );
                                                                      assert.strictEqual(
                                                                        groupDoc.displayName,
                                                                        somePrivateTenantGroup.displayName
                                                                      );
                                                                      assert.strictEqual(
                                                                        groupDoc.visibility,
                                                                        somePrivateTenantGroup.visibility
                                                                      );
                                                                      assert.strictEqual(groupDoc._extra, undefined);
                                                                      assert.strictEqual(groupDoc._type, undefined);
                                                                      assert.strictEqual(groupDoc.q_high, undefined);
                                                                      assert.strictEqual(groupDoc.q_low, undefined);
                                                                      assert.strictEqual(groupDoc.sort, undefined);

                                                                      // Verify a user from a private tenant cannot query an external private joinable group
                                                                      searchRefreshed(
                                                                        asLukeSkywalker,
                                                                        GENERAL_SEARCH,
                                                                        NO_PARAMS,
                                                                        {
                                                                          resourceTypes: GROUP,
                                                                          q: 'joinable',
                                                                          scope: NETWORK_SCOPE
                                                                        },
                                                                        (error, results) => {
                                                                          assert.notExists(error);
                                                                          const groupDoc = fetchWithin(
                                                                            results,
                                                                            getId(groupJoinable)
                                                                          );
                                                                          assert.ok(not(groupDoc));

                                                                          /**
                                                                           * Verify that user from a public tenant cannot query a private joinable group
                                                                           * belongs to a private tenant (luke skywalker's tenant and group)
                                                                           */
                                                                          searchRefreshed(
                                                                            asChewbacca,
                                                                            GENERAL_SEARCH,
                                                                            NO_PARAMS,
                                                                            {
                                                                              resourceTypes: GROUP,
                                                                              q: 'skywalker',
                                                                              scope: NETWORK_SCOPE
                                                                            },
                                                                            (error, results) => {
                                                                              assert.notExists(error);
                                                                              const groupDoc = fetchWithin(
                                                                                results,
                                                                                getId(somePrivateTenantGroup)
                                                                              );
                                                                              assert.ok(not(groupDoc));

                                                                              /**
                                                                               * Verify global admin user authenticated to a different tenant can query
                                                                               * the private unjoinable group
                                                                               */
                                                                              searchRefreshed(
                                                                                asGlobalAdminOnTenant,
                                                                                GENERAL_SEARCH,
                                                                                NO_PARAMS,
                                                                                {
                                                                                  resourceTypes: GROUP,
                                                                                  q: 'skywalker',
                                                                                  scope: ALL_SCOPE
                                                                                },
                                                                                (error, results) => {
                                                                                  assert.notExists(error);

                                                                                  const groupDoc = fetchWithin(
                                                                                    results,
                                                                                    getId(somePrivateTenantGroup)
                                                                                  );
                                                                                  assert.ok(groupDoc);
                                                                                  assert.strictEqual(
                                                                                    getTenantAlias(groupDoc),
                                                                                    getTenantAlias(
                                                                                      somePrivateTenantGroup
                                                                                    )
                                                                                  );
                                                                                  assert.strictEqual(
                                                                                    getResourceType(groupDoc),
                                                                                    GROUP
                                                                                  );
                                                                                  assert.strictEqual(
                                                                                    groupDoc.profilePath,
                                                                                    concat(
                                                                                      `/group/${getTenantAlias(
                                                                                        groupDoc
                                                                                      )}`,
                                                                                      `/${
                                                                                        getResourceFromId(
                                                                                          getId(groupDoc)
                                                                                        ).resourceId
                                                                                      }`
                                                                                    )
                                                                                  );
                                                                                  assert.strictEqual(
                                                                                    getId(groupDoc),
                                                                                    getId(somePrivateTenantGroup)
                                                                                  );
                                                                                  assert.strictEqual(
                                                                                    groupDoc.displayName,
                                                                                    somePrivateTenantGroup.displayName
                                                                                  );
                                                                                  assert.strictEqual(
                                                                                    groupDoc.visibility,
                                                                                    somePrivateTenantGroup.visibility
                                                                                  );

                                                                                  assert.strictEqual(
                                                                                    undefined,
                                                                                    groupDoc._extra
                                                                                  );
                                                                                  assert.strictEqual(
                                                                                    undefined,
                                                                                    groupDoc._type
                                                                                  );
                                                                                  assert.strictEqual(
                                                                                    undefined,
                                                                                    groupDoc.type
                                                                                  );
                                                                                  assert.strictEqual(
                                                                                    undefined,
                                                                                    groupDoc.q_high
                                                                                  );
                                                                                  assert.strictEqual(
                                                                                    undefined,
                                                                                    groupDoc.q_low
                                                                                  );
                                                                                  assert.strictEqual(
                                                                                    undefined,
                                                                                    groupDoc.sort
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
      });
    });
  });

  describe('Search Analysis', () => {
    before(rebuildSearchIndex);
    /**
     * Verifies that the search index has a minimum edgengram of 3, so that autosuggest (show-as-you-type) functionality will work
     * reasonably well.
     */
    it('verify edgengram analyzer of 3 for auto-suggest', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        createLink(
          asJohnDoe,
          {
            displayName: 'Apereo Xyzforedgengram',
            description: 'Link to Apereo Foundation Website',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, content) => {
            assert.notExists(error);

            // Search for just the first 3 characters to ensure it matches "Xyzforedgengram"
            searchRefreshed(asJohnDoe, GENERAL_SEARCH, NO_PARAMS, { q: 'Xyz' }, (error, results) => {
              assert.notExists(error);
              assert.ok(isWithin(results, content.id));

              callback();
            });
          }
        );
      });
    });

    /**
     * Verifies that the search analyzer is not case-sensitive
     */
    it('verify search indexing is not case-sensitive', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        createLink(
          asJohnDoe,
          {
            displayName: 'Apereo Xyzforedgengram',
            description: 'Link to Apereo Foundation Website',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, content) => {
            assert.notExists(error);

            // Search using a lowercase querystring on an item that was indexed with upper case
            searchAll(asJohnDoe, GENERAL_SEARCH, NO_PARAMS, { q: 'apereo' }, (error, results) => {
              assert.notExists(error);
              assert.ok(isWithin(results, content.id));

              callback();
            });
          }
        );
      });
    });
  });

  describe('Search Quality', () => {
    before(rebuildSearchIndex);
    /**
     * Verifies that there is a cut-off point which eliminates documents that are only slightly relevant to the search query.
     * Assuming there are documents which are indexed with:
     *  * OAE Team
     *  * Theological reasoning
     *  * Independent workforce
     * When searching for `Team` only the first document should return.
     */
    it('verify results do not match on a single letter', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: barbosa } = users;
        const asBarbosa = barbosa.restContext;

        // Create some content
        createLink(
          asBarbosa,
          {
            displayName: 'Theological reasoning',
            description: null,
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentA) => {
            assert.notExists(error);

            createLink(
              asBarbosa,
              {
                displayName: 'Independent workforce',
                description: null,
                visibility: PUBLIC,
                link: 'http://www.apereo.org',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, contentB) => {
                assert.notExists(error);

                const groupDisplayName = 'OAE Team ' + Math.random();

                createGroup(
                  asBarbosa,
                  groupDisplayName,
                  'A really awesome group',
                  PUBLIC,
                  NOT_JOINABLE,
                  NO_MANAGERS,
                  NO_MEMBERS,
                  (error, group) => {
                    assert.notExists(error);

                    // Ensure the group match is more relevant than the content item
                    searchAll(asBarbosa, GENERAL_SEARCH, NO_PARAMS, { q: 'Team' }, (error, results) => {
                      assert.notExists(error);
                      assert.ok(isWithin(results, group.id));
                      assert.ok(isNotWithin(results, contentB.id));

                      // Ensure the group match is more relevant
                      let hadGroup = false;
                      let hadContentA = false;

                      const matchingIds = (a, b) => equals(getId(a), getId(b));

                      forEach((eachResult) => {
                        if (matchingIds(eachResult, group)) {
                          hadGroup = true;
                          // Ensure we haven't received the content item before the group
                          assert.ok(not(hadContentA));
                        } else if (matchingIds(eachResult, contentA)) {
                          hadContentA = true;
                        }
                      }, getResultsWithin(results));

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
     * Test that verifies that displayName matches are boosted correctly, even across spaces in the displayName
     */
    it('verify displayName matches are boosted across spaces', (callback) => {
      let email = generateTestEmailAddress(null, head(global.oaeTests.tenants.cam.emailDomains));

      createUser(
        asCambridgeTenantAdmin,
        generateRandomText(1),
        PASSWORD,
        'Luke Skywalker',
        email,
        NO_OPTIONS,
        (error, lukeSkywalker) => {
          assert.notExists(error);
          email = generateTestEmailAddress(null, head(global.oaeTests.tenants.gt.emailDomains));

          createUser(
            asGeorgiaTenantAdmin,
            generateRandomText(1),
            PASSWORD,
            'Lucky the Silly',
            email,
            NO_OPTIONS,
            (error, lukeTheSilly) => {
              assert.notExists(error);

              /**
               * When searching for 'Luke S', the 'Luke Skywalker' user should
               * appear before the 'Luke the Silly' user
               */
              searchRefreshed(
                asCambridgeAnonymousUser,
                GENERAL_SEARCH,
                NO_PARAMS,
                { q: 'Luke S', scope: ALL_SCOPE },
                (error, results) => {
                  assert.notExists(error);
                  const lukeSkywalkerIndex = findIndexWithin(results, lukeSkywalker.id);
                  const lukeTheSillyIndex = findIndexWithin(results, lukeTheSilly.id);

                  assert.notStrictEqual(-1, lukeSkywalkerIndex);
                  assert.notStrictEqual(-1, lukeTheSillyIndex);
                  assert.ok(lt(lukeSkywalkerIndex, lukeTheSillyIndex));

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
    it('verify documents from the same tenant are boosted', (callback) => {
      // Generate 2 identical users on 2 tenants
      const username = generateRandomText(1);
      const displayName = generateRandomText(2);
      let email = generateTestEmailAddress(null, head(global.oaeTests.tenants.cam.emailDomains));

      createUser(
        asCambridgeTenantAdmin,
        username,
        PASSWORD,
        displayName,
        email,
        NO_OPTIONS,
        (error, userFromCambridge) => {
          assert.notExists(error);
          email = generateTestEmailAddress(null, head(global.oaeTests.tenants.gt.emailDomains));

          createUser(
            asGeorgiaTenantAdmin,
            username,
            PASSWORD,
            displayName,
            email,
            NO_OPTIONS,
            (error, userFromGeorgiaTech) => {
              assert.notExists(error);

              /**
               * When searching on the cambridge tenant, the user from the cambridge
               * tenant should appear before the user from the gt tenant
               */
              searchRefreshed(
                asCambridgeAnonymousUser,
                GENERAL_SEARCH,
                NO_PARAMS,
                { q: displayName, scope: ALL_SCOPE },
                (error, results) => {
                  assert.notExists(error);

                  let userFromCambridgeIndex = findIndexWithin(results, userFromCambridge.id);
                  let userFromGeorgiaTechIndex = findIndexWithin(results, userFromGeorgiaTech.id);

                  assert.notStrictEqual(-1, userFromCambridgeIndex);
                  assert.notStrictEqual(-1, userFromGeorgiaTechIndex);
                  assert.isBelow(userFromCambridgeIndex, userFromGeorgiaTechIndex);

                  /**
                   *
                   * When searching on the gt tenant, the user from the gt
                   * tenant should appear before the user from the cambridge tenant
                   */
                  searchRefreshed(
                    asGeorgiaAnonymousUser,
                    GENERAL_SEARCH,
                    NO_PARAMS,
                    { q: displayName, scope: ALL_SCOPE },
                    (error, results) => {
                      assert.notExists(error);

                      userFromCambridgeIndex = findIndexWithin(results, userFromCambridge.id);
                      userFromGeorgiaTechIndex = findIndexWithin(results, userFromGeorgiaTech.id);

                      assert.notStrictEqual(-1, userFromCambridgeIndex);
                      assert.notStrictEqual(-1, userFromGeorgiaTechIndex);
                      assert.isBelow(userFromGeorgiaTechIndex, userFromCambridgeIndex);

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

  describe('Search Options', () => {
    before(rebuildSearchIndex);
    /**
     * Test that verifies the resourceType parameter in the general search
     * properly filter results by user, group and content.
     */
    it('verify resourceType scope param', (callback) => {
      // Ensure a user, group and content item exist in the search index to ensure they are not included in resource-scoped searches
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        createGroup(
          asCambridgeTenantAdmin,
          generateTestUserId(GROUP),
          'A group for ' + johnDoe.user.displayName,
          PUBLIC,
          NOT_JOINABLE,
          NO_MANAGERS,
          NO_MEMBERS,
          (error, group) => {
            assert.notExists(error);

            createLink(
              asCambridgeTenantAdmin,
              {
                displayName: 'Apereo Foundation',
                description: 'Link to ' + johnDoe.user.displayName,
                visibility: PUBLIC,
                link: 'http://www.apereo.org',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, content) => {
                assert.notExists(error);

                // Verify we only get users from a user search
                searchRefreshed(
                  asJohnDoe,
                  GENERAL_SEARCH,
                  NO_PARAMS,
                  { resourceTypes: USER, q: johnDoe.user.displayName },
                  (error, results) => {
                    assert.notExists(error);
                    assert.ok(isWithin(results, johnDoe.user.id));
                    assert.strictEqual(0, numberOfGroupsResults(results));
                    assert.strictEqual(0, numberOfContentResults(results));

                    // Verify we only get groups from a group search
                    searchRefreshed(
                      asJohnDoe,
                      GENERAL_SEARCH,
                      NO_PARAMS,
                      { resourceTypes: GROUP, q: johnDoe.user.displayName },
                      (error, results) => {
                        assert.notExists(error);
                        assert.ok(isWithin(results, group.id));
                        assert.strictEqual(0, numberOfUserResults(results));
                        assert.strictEqual(0, numberOfContentResults(results));

                        // Verify we only get content from a content search
                        searchRefreshed(
                          asJohnDoe,
                          GENERAL_SEARCH,
                          NO_PARAMS,
                          { resourceTypes: CONTENT, q: johnDoe.user.displayName },
                          (error, results) => {
                            assert.notExists(error);
                            assert.ok(isWithin(results, content.id));
                            assert.strictEqual(0, numberOfUserResults(results));
                            assert.strictEqual(0, numberOfGroupsResults(results));
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
    it('verify limit parameter validation', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 35, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        // Verify that the limit parameter is respected.
        searchRefreshed(asJohnDoe, GENERAL_SEARCH, NO_PARAMS, { limit: 8 }, (error, results) => {
          assert.notExists(error);
          assert.strictEqual(8, numberOfResults(results));

          // Verify that searches have an upper limit.
          search(asJohnDoe, GENERAL_SEARCH, NO_PARAMS, { limit: 1000 }, (error, results) => {
            assert.notExists(error);
            assert.strictEqual(25, numberOfResults(results));

            // Verify that searches have a lower limit.
            search(asJohnDoe, GENERAL_SEARCH, NO_PARAMS, { limit: -1 }, (error, results) => {
              assert.notExists(error);
              assert.strictEqual(1, numberOfResults(results));

              // Verify that searches have a lower limit.
              search(asJohnDoe, GENERAL_SEARCH, NO_PARAMS, { limit: 0 }, (error, results) => {
                assert.notExists(error);
                assert.strictEqual(1, numberOfResults(results));

                callback();
              });
            });
          });
        });
      });
    });
  });
});
