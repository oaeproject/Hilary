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
import { describe, it, before } from 'mocha';
import { compose, prop, head, of, equals, find, propSatisfies } from 'ramda';

import * as RestAPI from 'oae-rest';
import * as SearchTestsUtil from 'oae-search/lib/test/util';
import * as TestsUtil from 'oae-tests';

const { createGroup } = RestAPI.Group;
const { searchRefreshed, searchAll } = SearchTestsUtil;
const { createComment, createLink } = RestAPI.Content;
const { generateTestUserId, generateTestUsers, createTenantAdminRestContext, createTenantRestContext } = TestsUtil;
const { createMessage, createDiscussion } = RestAPI.Discussions;
const { search } = RestAPI.Search;
const { shareContent } = RestAPI.Content;

const PUBLIC = 'public';
const PRIVATE = 'private';
const LOGGED_IN = 'loggedin';
const CONTENT_LIBRARY = 'content-library';
const DISCUSSION_LIBRARY = 'discussion-library';
const NOT_JOINABLE = 'no';

const NO_FOLDERS = [];
const NO_MANAGERS = [];
const NO_VIEWERS = [];

const justTheOneResult = (results) => propSatisfies(equals(1), 'total', results);
const noResults = (results) => propSatisfies(equals(0), 'total', results);
const topResult = compose(prop('id'), head, prop('results'));

describe('Library Search', () => {
  // REST contexts we can use to do REST requests
  let asCambridgeAnonymousUser = null;
  let asCambridgeTenantAdmin = null;
  let asGeorgiaTechTenantAdmin = null;

  before((callback) => {
    asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.cam.host);
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    asGeorgiaTechTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.gt.host);

    return callback();
  });

  /**
   * Test that verifies that comments are included when searching through libraries
   */
  it('verify comments are included when searching through libraries', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.isNotOk(error);

      const { 0: homer } = users;
      const asHomer = homer.restContext;

      // Create content with a comment on it
      createLink(
        asHomer,
        {
          displayName: 'Apereo Website',
          description: 'The website of the Apereo Foundation',
          visibility: PUBLIC,
          link: 'http://www.apereo.org',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, content) => {
          assert.isNotOk(error);

          createComment(asHomer, content.id, 'abcdefghi', null, (error /* , comment */) => {
            assert.isNotOk(error);

            /**
             * Keep in mind that messages are analyzed with an edgengram analyzer with its
             * minimum set to 5. As tokenisation is letter based, we can't really generate
             * a test string or use an md5 hash as those are probably not going to contain
             * substrings of 5 characters
             */
            searchAll(asHomer, CONTENT_LIBRARY, of(homer.user.id), { q: 'abcdefghijklmn' }, (error, results) => {
              assert.isNotOk(error);

              assert.ok(find(propSatisfies(equals(content.id), 'id'), results.results));

              // Create a discussion with a message on it
              createDiscussion(asHomer, 'A talk', 'about the moon', PUBLIC, [], [], (error, discussion) => {
                assert.isNotOk(error);

                createMessage(asHomer, discussion.id, 'stuvwxyz', null, (error /* , message */) => {
                  assert.isNotOk(error);

                  /**
                   * Keep in mind that messages are analyzed with an edgengram analyzer with its
                   * minimum set to 5. As tokenisation is letter based, we can't really generate
                   * a test string or use an md5 hash as those are probably not going to contain
                   * substrings of 5 characters
                   */
                  searchAll(asHomer, DISCUSSION_LIBRARY, [homer.user.id], { q: 'stuvwxyz' }, (error, results) => {
                    assert.isNotOk(error);
                    assert.ok(find(propSatisfies(equals(discussion.id), 'id'), results.results));

                    return callback();
                  });
                });
              });
            });
          });
        }
      );
    });
  });

  describe('User Libraries', () => {
    /**
     * Test that verifies only valid principal ids return results
     */
    it('verify the principal id gets validated', (callback) => {
      searchAll(asCambridgeTenantAdmin, CONTENT_LIBRARY, [''], null, (error, results) => {
        assert.strictEqual(error.code, 400);
        assert.notExists(results);

        searchAll(asCambridgeTenantAdmin, CONTENT_LIBRARY, ['invalid-user-id'], null, (error, results) => {
          assert.strictEqual(error.code, 400);
          assert.notExists(results);

          return callback();
        });
      });
    });

    /**
     * Test that verifies all users can search public user library items
     */
    it('verify all users see public user library item', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.isNotOk(error);
        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;
        const asBart = bart.restContext;
        const asMarge = marge.restContext;

        generateTestUsers(asGeorgiaTechTenantAdmin, 1, (error, users) => {
          assert.isNotOk(error);

          const { 0: lisa } = users;

          createLink(
            asHomer,
            {
              displayName: 'Apereo Website',
              description: 'The website of the Apereo Foundation',
              visibility: PUBLIC,
              link: 'http://www.apereofoundation.org',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, content) => {
              assert.notExists(error);
              const sameAsLink = equals(content.id);

              shareContent(asHomer, content.id, [marge.user.id], (error_) => {
                assert.isNotOk(error_);

                // Verify anonymous can see the content item
                searchAll(asCambridgeAnonymousUser, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                  assert.notExists(error);
                  assert.ok(justTheOneResult(results));
                  assert.isTrue(sameAsLink(topResult(results)));

                  // Verify tenant admin can see the content item
                  searchAll(asCambridgeTenantAdmin, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                    assert.notExists(error);
                    assert.ok(justTheOneResult(results));
                    assert.isTrue(sameAsLink(topResult(results)));

                    // Verify the target user can see the content item
                    searchAll(asMarge, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                      assert.notExists(error);
                      assert.ok(justTheOneResult(results));
                      assert.isTrue(sameAsLink(topResult(results)));

                      // Verify a different loggedin user can see the content item
                      searchAll(asBart, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                        assert.notExists(error);
                        assert.ok(justTheOneResult(results));
                        assert.isTrue(sameAsLink(topResult(results)));

                        // Verify the cross-tenant user can see the content item
                        searchAll(lisa.restContext, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                          assert.notExists(error);
                          assert.ok(justTheOneResult(results));
                          assert.isTrue(sameAsLink(topResult(results)));

                          return callback();
                        });
                      });
                    });
                  });
                });
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies that anonymous and cross-tenant users cannot search loggedin user library items.
     */
    it('verify anonymous and cross-tenant user cannot see loggedin user library items', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: homer, 1: marge, 2: bart } = users;

        generateTestUsers(asGeorgiaTechTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: lisa } = users;

          // Create the content item as 'loggedin'
          createLink(
            homer.restContext,
            {
              displayName: 'Apereo Website',
              description: 'The website of the Apereo Foundation',
              visibility: LOGGED_IN,
              link: 'http://www.apereofoundation.org',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, content) => {
              assert.notExists(error);

              const sameAsLink = equals(content.id);

              shareContent(homer.restContext, content.id, [marge.user.id], (error_) => {
                assert.notExists(error_);

                // Verify anonymous cannot see it
                searchAll(asCambridgeAnonymousUser, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                  assert.notExists(error);
                  assert.ok(noResults(results));
                  assert.isNotOk(topResult(results));

                  // Verify tenant admin can see it
                  searchAll(asCambridgeTenantAdmin, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                    assert.notExists(error);
                    assert.ok(justTheOneResult(results));
                    assert.isTrue(sameAsLink(topResult(results)));

                    // Verify the target user can see it
                    searchAll(marge.restContext, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                      assert.notExists(error);
                      assert.ok(justTheOneResult(results));
                      assert.isTrue(sameAsLink(topResult(results)));

                      // Verify another loggedin user can see it
                      searchAll(bart.restContext, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                        assert.notExists(error);
                        assert.ok(justTheOneResult(results));
                        assert.isTrue(sameAsLink(topResult(results)));

                        // Verify the cross-tenant user cannot see it
                        searchAll(lisa.restContext, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                          assert.notExists(error);
                          assert.ok(noResults(results));
                          assert.isNotOk(topResult(results));

                          return callback();
                        });
                      });
                    });
                  });
                });
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies only admin and the user themselves can search private user library items.
     */
    it('verify only self and admin can see private user library items', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;

        generateTestUsers(asGeorgiaTechTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: lisa } = users;

          // Create the private content item
          createLink(
            asHomer,
            {
              displayName: 'Apereo Website',
              description: 'The website of the Apereo Foundation',
              visibility: PRIVATE,
              link: 'http://www.apereofoundation.org',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, content) => {
              assert.notExists(error);

              const sameAsLink = equals(content.id);

              shareContent(asHomer, content.id, [marge.user.id], (error_) => {
                assert.notExists(error_);

                // Verify anonymous cannot search it
                searchAll(asCambridgeAnonymousUser, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                  assert.notExists(error);
                  assert.ok(noResults(results));
                  assert.isNotOk(topResult(results));

                  // Verify tenant admin can search it
                  searchAll(asCambridgeTenantAdmin, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                    assert.notExists(error);
                    assert.ok(justTheOneResult(results));
                    assert.isTrue(sameAsLink(topResult(results)));

                    // Verify the target user can search it
                    searchAll(asMarge, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                      assert.notExists(error);
                      assert.ok(justTheOneResult(results));
                      assert.isTrue(sameAsLink(topResult(results)));

                      // Verify another loggedin user cannot search it
                      searchAll(bart.restContext, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                        assert.notExists(error);
                        assert.ok(noResults(results));
                        assert.isNotOk(topResult(results));

                        // Verify the cross-tenant user cannot search it
                        searchAll(lisa.restContext, CONTENT_LIBRARY, [marge.user.id], null, (error, results) => {
                          assert.notExists(error);
                          assert.ok(noResults(results));
                          assert.isNotOk(topResult(results));

                          return callback();
                        });
                      });
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

  describe('Group Libraries', () => {
    /**
     * Test that verifies all users can see public group library items.
     */
    it('verify all users see public group library items', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 4, (error, users) => {
        assert.notExists(error);
        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const asBart = bart.restContext;

        generateTestUsers(asGeorgiaTechTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: lisa } = users;
          const asLisa = lisa.restContext;

          createGroup(
            asHomer,
            generateTestUserId('group'),
            generateTestUserId('group'),
            PUBLIC,
            NOT_JOINABLE,
            NO_MANAGERS,
            [marge.user.id],
            (error, group) => {
              assert.notExists(error);

              // Create the public content item and share it with the group
              createLink(
                asHomer,
                {
                  displayName: 'Apereo Website',
                  description: 'The website of the Apereo Foundation',
                  visibility: PUBLIC,
                  link: 'http://www.apereofoundation.org',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error, content) => {
                  assert.notExists(error);

                  const sameAsLink = equals(content.id);

                  shareContent(asHomer, content.id, [group.id], (error_) => {
                    assert.notExists(error_);

                    // Verify anonymous can see it
                    searchAll(asCambridgeAnonymousUser, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                      assert.notExists(error);
                      assert.ok(justTheOneResult(results));
                      assert.isTrue(sameAsLink(topResult(results)));

                      // Verify tenant admin can see it
                      searchAll(asCambridgeTenantAdmin, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                        assert.notExists(error);
                        assert.ok(justTheOneResult(results));
                        assert.isTrue(sameAsLink(topResult(results)));

                        // Verify a member can see it
                        searchAll(asMarge, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                          assert.notExists(error);
                          assert.ok(justTheOneResult(results));
                          assert.isTrue(sameAsLink(topResult(results)));

                          // Verify a loggedin non-member can see it
                          searchAll(asBart, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                            assert.notExists(error);
                            assert.ok(justTheOneResult(results));
                            assert.isTrue(sameAsLink(topResult(results)));

                            // Verify a cross-tenant user can see it
                            searchAll(asLisa, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                              assert.notExists(error);
                              assert.ok(justTheOneResult(results));
                              assert.isTrue(sameAsLink(topResult(results)));

                              return callback();
                            });
                          });
                        });
                      });
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
     * Test that verifies that anonymous and cross-tenant users cannot search loggedin group library items.
     */
    it('verify anonymous and cross-tenant users cannot see loggedin group library items', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 4, (error, users) => {
        assert.notExists(error);
        const { 0: homer, 1: marge, 2: lisa } = users;

        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const asLisa = lisa.restContext;

        generateTestUsers(asGeorgiaTechTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: bart } = users;
          const asBart = bart.restContext;

          createGroup(
            asHomer,
            generateTestUserId('group'),
            generateTestUserId('group'),
            PUBLIC,
            NOT_JOINABLE,
            [],
            [marge.user.id],
            (error, group) => {
              assert.notExists(error);

              // Create the loggedin content item and share it with the group
              createLink(
                asHomer,
                {
                  displayName: 'Apereo Website',
                  description: 'The website of the Apereo Foundation',
                  visibility: LOGGED_IN,
                  link: 'http://www.apereofoundation.org',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error, content) => {
                  assert.notExists(error);

                  const sameAsLink = equals(content.id);

                  shareContent(asHomer, content.id, [group.id], (error_) => {
                    assert.notExists(error_);

                    // Verify anonymous cannot see it
                    searchAll(asCambridgeAnonymousUser, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                      assert.notExists(error);
                      assert.strictEqual(results.total, 0);
                      assert.isNotOk(topResult(results));

                      // Verify tenant admin can see it
                      searchAll(asCambridgeTenantAdmin, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                        assert.notExists(error);
                        assert.strictEqual(results.total, 1);
                        assert.isTrue(sameAsLink(topResult(results)));

                        // Verify member user can see it
                        searchAll(asMarge, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                          assert.notExists(error);
                          assert.strictEqual(results.total, 1);
                          assert.isTrue(sameAsLink(topResult(results)));

                          // Verify a loggedin non-member can see it
                          searchAll(asLisa, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                            assert.notExists(error);
                            assert.strictEqual(results.total, 1);
                            assert.isTrue(sameAsLink(topResult(results)));

                            // Verify a cross-tenant user cannot see it
                            searchAll(asBart, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                              assert.notExists(error);
                              assert.strictEqual(results.total, 0);
                              assert.isNotOk(topResult(results));

                              return callback();
                            });
                          });
                        });
                      });
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
     * Test that verifies only members and admin users can search private group library items. This includes members of the group that
     * belong to a different tenant.
     */
    it('verify only member and admin users can see private group library items', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;
        const asBart = bart.restContext;
        const asMarge = marge.restContext;

        generateTestUsers(asGeorgiaTechTenantAdmin, 2, (error, users) => {
          assert.notExists(error);

          const { 0: lisa, 1: maggie } = users;
          const asLisa = lisa.restContext;
          const asMaggie = maggie.restContext;

          createGroup(
            asHomer,
            generateTestUserId('group'),
            generateTestUserId('group'),
            PUBLIC,
            NOT_JOINABLE,
            [],
            [maggie.user.id, marge.user.id],
            (error, group) => {
              assert.notExists(error);

              // Create the private content item and share it with the group
              createLink(
                asHomer,
                {
                  displayName: 'Apereo Website',
                  description: 'The website of the Apereo Foundation',
                  visibility: PRIVATE,
                  link: 'http://www.apereofoundation.org',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error, content) => {
                  assert.notExists(error);

                  const sameAsLink = equals(content.id);

                  shareContent(asHomer, content.id, [group.id], (error_) => {
                    assert.notExists(error_);

                    // Verify anonymous cannot see the private content item
                    searchAll(asCambridgeAnonymousUser, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                      assert.notExists(error);
                      assert.ok(noResults(results));
                      assert.isNotOk(topResult(results));

                      // Verify cam admin can see the private content item
                      searchAll(asCambridgeTenantAdmin, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                        assert.notExists(error);
                        assert.ok(justTheOneResult(results));
                        assert.isTrue(sameAsLink(topResult(results)));

                        // Verify the same-tenant member can see the private content item
                        searchAll(asMarge, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                          assert.notExists(error);
                          assert.ok(justTheOneResult(results));
                          assert.isTrue(sameAsLink(topResult(results)));

                          // Verify the cross-tenant member can see the private content item
                          searchAll(asMaggie, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                            assert.notExists(error);
                            assert.ok(justTheOneResult(results));
                            assert.isTrue(sameAsLink(topResult(results)));

                            // Verify another loggedin user cannot see the private content item
                            searchAll(asBart, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                              assert.notExists(error);
                              assert.ok(noResults(results));
                              assert.isNotOk(topResult(results));

                              // Verify cross-tenant non-member user cannot see the private content item
                              searchAll(asLisa, CONTENT_LIBRARY, [group.id], null, (error, results) => {
                                assert.notExists(error);
                                assert.ok(noResults(results));
                                assert.isNotOk(topResult(results));

                                return callback();
                              });
                            });
                          });
                        });
                      });
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

  describe('Library Paging', () => {
    /**
     * Test that verifies paging of library search works correctly
     */
    it('verify paging the library search feed works correctly', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: homer } = users;
        const asHomer = homer.restContext;

        createLink(
          asHomer,
          {
            displayName: 'Apereo Website',
            description: 'The website of the Apereo Foundation',
            visibility: PUBLIC,
            link: 'http://www.apereofoundation.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, content) => {
            assert.notExists(error);
            const sameAsFirstLink = equals(content.id);

            createLink(
              asHomer,
              {
                displayName: 'Google Website',
                description: 'Google',
                visibility: PUBLIC,
                link: 'http://www.google.ca',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, content) => {
                assert.notExists(error);

                const sameAsSecondLink = equals(content.id);

                searchRefreshed(asHomer, CONTENT_LIBRARY, [homer.user.id], { limit: 2, start: 0 }, (error, results) => {
                  assert.notExists(error);
                  assert.ok(results.results);
                  assert.lengthOf(results.results, 2);

                  const firstId = results.results[0].id;
                  assert.ok(firstId);

                  const secondId = results.results[1].id;
                  assert.ok(secondId);

                  /**
                   * Verify the first item comes on the first page.
                   * We don't need to refresh this search because we haven't indexed anything since the previous search
                   */
                  search(asHomer, CONTENT_LIBRARY, [homer.user.id], { limit: 1, start: 0 }, (error, results) => {
                    assert.notExists(error);
                    assert.ok(results.results);
                    assert.lengthOf(results.results, 1);
                    assert.isTrue(sameAsFirstLink(topResult(results)));

                    // Verify the second item comes on the first page.
                    search(asHomer, CONTENT_LIBRARY, [homer.user.id], { limit: 1, start: 1 }, (error, results) => {
                      assert.notExists(error);
                      assert.ok(results.results);
                      assert.lengthOf(results.results, 1);
                      assert.isTrue(sameAsSecondLink(topResult(results)));

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
  });
});
