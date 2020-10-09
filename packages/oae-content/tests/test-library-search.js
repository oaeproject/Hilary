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
import _ from 'underscore';
import { of, prop } from 'ramda';

import * as RestAPI from 'oae-rest';
import * as SearchTestsUtil from 'oae-search/lib/test/util';
import * as TestsUtil from 'oae-tests';

const { searchRefreshed, searchAll } = SearchTestsUtil;
const { createComment, createLink } = RestAPI.Content;
const { generateTestUsers, createTenantAdminRestContext, createTenantRestContext } = TestsUtil;
const { createMessage, createDiscussion } = RestAPI.Discussions;
const { search } = RestAPI.Search;
const { shareContent } = RestAPI.Content;

const PUBLIC = 'public';
const PRIVATE = 'private';
const LOGGED_IN = 'loggedin';

const NO_FOLDERS = [];
const NO_MANAGERS = [];
const NO_VIEWERS = [];

const resultsWithin = prop('results');

describe('Library Search', () => {
  // REST contexts we can use to do REST requests
  let asCambridgeAnonymousUser = null;
  let asCambridgeTenantAdmin = null;
  let asGeorgiaTechTenantAdmin = null;

  before(callback => {
    asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.cam.host);
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    asGeorgiaTechTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.gt.host);

    return callback();
  });

  /**
   * Test that verifies that comments are included when searching through libraries
   */
  it('verify comments are included when searching through libraries', callback => {
    generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
      assert.isNotOk(err);

      const { 0: simon } = users;
      const asSimon = simon.restContext;

      // Create content with a comment on it
      createLink(
        asSimon,
        {
          displayName: 'Apereo Website',
          description: 'The website of the Apereo Foundation',
          visibility: PUBLIC,
          link: 'http://www.apereo.org',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (err, content) => {
          assert.isNotOk(err);

          createComment(asSimon, content.id, 'abcdefghi', null, (err, comment) => {
            assert.isNotOk(err);

            /**
             * Keep in mind that messages are analyzed with an edgengram analyzer with its
             * minimum set to 5. As tokenisation is letter based, we can't really generate
             * a test string or use an md5 hash as those are probably not going to contain
             * substrings of 5 characters
             */
            searchAll(asSimon, 'content-library', of(simon.user.id), { q: 'abcdefghijklmn' }, (err, results) => {
              assert.isNotOk(err);

              assert.ok(_.find(results.results, { id: content.id }));

              // Create a discussion with a message on it
              createDiscussion(asSimon, 'A talk', 'about the moon', 'public', [], [], (err, discussion) => {
                assert.isNotOk(err);

                createMessage(asSimon, discussion.id, 'stuvwxyz', null, (err /* , message */) => {
                  assert.isNotOk(err);

                  /**
                   * Keep in mind that messages are analyzed with an edgengram analyzer with its
                   * minimum set to 5. As tokenisation is letter based, we can't really generate
                   * a test string or use an md5 hash as those are probably not going to contain
                   * substrings of 5 characters
                   */
                  searchAll(asSimon, 'discussion-library', [simon.user.id], { q: 'stuvwxyz' }, (err, results) => {
                    assert.isNotOk(err);
                    assert.ok(_.find(results.results, { id: discussion.id }));

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
    it('verify the principal id gets validated', callback => {
      searchAll(asCambridgeTenantAdmin, 'content-library', [''], null, (err, results) => {
        assert.strictEqual(err.code, 400);
        assert.ok(!results);

        searchAll(asCambridgeTenantAdmin, 'content-library', ['invalid-user-id'], null, (err, results) => {
          assert.strictEqual(err.code, 400);
          assert.ok(!results);

          return callback();
        });
      });
    });

    /**
     * Test that verifies all users can search public user library items
     */
    it('verify all users see public user library item', callback => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (err, users) => {
        assert.isNotOk(err);
        const { 0: doer, 1: jack, 2: jane } = users;

        generateTestUsers(asGeorgiaTechTenantAdmin, 1, (err, users) => {
          assert.isNotOk(err);

          const { 0: darthVader } = users;

          createLink(
            doer.restContext,
            {
              displayName: 'Apereo Website',
              description: 'The website of the Apereo Foundation',
              visibility: PUBLIC,
              link: 'http://www.apereofoundation.org',
              managers: [],
              viewers: [],
              folders: []
            },
            (err, content) => {
              assert.ok(!err);

              shareContent(doer.restContext, content.id, [jack.user.id], err => {
                assert.isNotOk(err);

                // Verify anonymous can see the content item
                searchAll(asCambridgeAnonymousUser, 'content-library', [jack.user.id], null, (err, results) => {
                  assert.ok(!err);
                  assert.strictEqual(results.total, 1);
                  assert.strictEqual(results.results[0].id, content.id);

                  // Verify tenant admin can see the content item
                  searchAll(asCambridgeTenantAdmin, 'content-library', [jack.user.id], null, (err, results) => {
                    assert.ok(!err);
                    assert.strictEqual(results.total, 1);
                    assert.strictEqual(results.results[0].id, content.id);

                    // Verify the target user can see the content item
                    searchAll(jack.restContext, 'content-library', [jack.user.id], null, (err, results) => {
                      assert.ok(!err);
                      assert.strictEqual(results.total, 1);
                      assert.strictEqual(results.results[0].id, content.id);

                      // Verify a different loggedin user can see the content item
                      searchAll(jane.restContext, 'content-library', [jack.user.id], null, (err, results) => {
                        assert.ok(!err);
                        assert.strictEqual(results.total, 1);
                        assert.strictEqual(results.results[0].id, content.id);

                        // Verify the cross-tenant user can see the content item
                        SearchTestsUtil.searchAll(
                          darthVader.restContext,
                          'content-library',
                          [jack.user.id],
                          null,
                          (err, results) => {
                            assert.ok(!err);
                            assert.strictEqual(results.total, 1);
                            assert.strictEqual(results.results[0].id, content.id);
                            return callback();
                          }
                        );
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
    it('verify anonymous and cross-tenant user cannot see loggedin user library items', callback => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (err, users) => {
        assert.ok(!err);
        const { 0: doer, 1: jack, 2: jane } = users;

        TestsUtil.generateTestUsers(asGeorgiaTechTenantAdmin, 1, (err, users) => {
          assert.ok(!err);
          const { 0: darthVader } = users;

          // Create the content item as 'loggedin'
          RestAPI.Content.createLink(
            doer.restContext,
            {
              displayName: 'Apereo Website',
              description: 'The website of the Apereo Foundation',
              visibility: LOGGED_IN,
              link: 'http://www.apereofoundation.org',
              managers: [],
              viewers: [],
              folders: []
            },
            (err, content) => {
              assert.ok(!err);

              RestAPI.Content.shareContent(doer.restContext, content.id, [jack.user.id], err => {
                assert.ok(!err);

                // Verify anonymous cannot see it
                SearchTestsUtil.searchAll(
                  asCambridgeAnonymousUser,
                  'content-library',
                  [jack.user.id],
                  null,
                  (err, results) => {
                    assert.ok(!err);
                    assert.strictEqual(results.total, 0);
                    assert.ok(!results.results[0]);

                    // Verify tenant admin can see it
                    SearchTestsUtil.searchAll(
                      asCambridgeTenantAdmin,
                      'content-library',
                      [jack.user.id],
                      null,
                      (err, results) => {
                        assert.ok(!err);
                        assert.strictEqual(results.total, 1);
                        assert.strictEqual(results.results[0].id, content.id);

                        // Verify the target user can see it
                        SearchTestsUtil.searchAll(
                          jack.restContext,
                          'content-library',
                          [jack.user.id],
                          null,
                          (err, results) => {
                            assert.ok(!err);
                            assert.strictEqual(results.total, 1);
                            assert.strictEqual(results.results[0].id, content.id);

                            // Verify another loggedin user can see it
                            SearchTestsUtil.searchAll(
                              jane.restContext,
                              'content-library',
                              [jack.user.id],
                              null,
                              (err, results) => {
                                assert.ok(!err);
                                assert.strictEqual(results.total, 1);
                                assert.strictEqual(results.results[0].id, content.id);

                                // Verify the cross-tenant user cannot see it
                                SearchTestsUtil.searchAll(
                                  darthVader.restContext,
                                  'content-library',
                                  [jack.user.id],
                                  null,
                                  (err, results) => {
                                    assert.ok(!err);
                                    assert.strictEqual(results.total, 0);
                                    assert.ok(!results.results[0]);
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
            }
          );
        });
      });
    });

    /**
     * Test that verifies only admin and the user themselves can search private user library items.
     */
    it('verify only self and admin can see private user library items', callback => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (err, users) => {
        assert.ok(!err);
        const { 0: doer, 1: jack, 2: jane } = users;

        TestsUtil.generateTestUsers(asGeorgiaTechTenantAdmin, 1, (err, users) => {
          assert.ok(!err);
          const { 0: darthVader } = users;

          // Create the private content item
          RestAPI.Content.createLink(
            doer.restContext,
            {
              displayName: 'Apereo Website',
              description: 'The website of the Apereo Foundation',
              visibility: PRIVATE,
              link: 'http://www.apereofoundation.org',
              managers: [],
              viewers: [],
              folders: []
            },
            (err, content) => {
              assert.ok(!err);

              RestAPI.Content.shareContent(doer.restContext, content.id, [jack.user.id], err => {
                assert.ok(!err);

                // Verify anonymous cannot search it
                SearchTestsUtil.searchAll(
                  asCambridgeAnonymousUser,
                  'content-library',
                  [jack.user.id],
                  null,
                  (err, results) => {
                    assert.ok(!err);
                    assert.strictEqual(results.total, 0);
                    assert.ok(!results.results[0]);

                    // Verify tenant admin can search it
                    SearchTestsUtil.searchAll(
                      asCambridgeTenantAdmin,
                      'content-library',
                      [jack.user.id],
                      null,
                      (err, results) => {
                        assert.ok(!err);
                        assert.strictEqual(results.total, 1);
                        assert.strictEqual(results.results[0].id, content.id);

                        // Verify the target user can search it
                        SearchTestsUtil.searchAll(
                          jack.restContext,
                          'content-library',
                          [jack.user.id],
                          null,
                          (err, results) => {
                            assert.ok(!err);
                            assert.strictEqual(results.total, 1);
                            assert.strictEqual(results.results[0].id, content.id);

                            // Verify another loggedin user cannot search it
                            SearchTestsUtil.searchAll(
                              jane.restContext,
                              'content-library',
                              [jack.user.id],
                              null,
                              (err, results) => {
                                assert.ok(!err);
                                assert.strictEqual(results.total, 0);
                                assert.ok(!results.results[0]);

                                // Verify the cross-tenant user cannot search it
                                SearchTestsUtil.searchAll(
                                  darthVader.restContext,
                                  'content-library',
                                  [jack.user.id],
                                  null,
                                  (err, results) => {
                                    assert.ok(!err);
                                    assert.strictEqual(results.total, 0);
                                    assert.ok(!results.results[0]);
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
    it('verify all users see public group library items', callback => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.ok(!err);
        const { 0: doer, 1: jack, 2: jane } = users;

        TestsUtil.generateTestUsers(asGeorgiaTechTenantAdmin, 1, (err, users) => {
          assert.ok(!err);
          const { 0: darthVader } = users;

          RestAPI.Group.createGroup(
            doer.restContext,
            TestsUtil.generateTestUserId('group'),
            TestsUtil.generateTestUserId('group'),
            'public',
            'no',
            [],
            [jack.user.id],
            (err, group) => {
              assert.ok(!err);

              // Create the public content item and share it with the group
              RestAPI.Content.createLink(
                doer.restContext,
                {
                  displayName: 'Apereo Website',
                  description: 'The website of the Apereo Foundation',
                  visibility: PUBLIC,
                  link: 'http://www.apereofoundation.org',
                  managers: [],
                  viewers: [],
                  folders: []
                },
                (err, content) => {
                  assert.ok(!err);

                  RestAPI.Content.shareContent(doer.restContext, content.id, [group.id], err => {
                    assert.ok(!err);

                    // Verify anonymous can see it
                    SearchTestsUtil.searchAll(
                      asCambridgeAnonymousUser,
                      'content-library',
                      [group.id],
                      null,
                      (err, results) => {
                        assert.ok(!err);
                        assert.strictEqual(results.total, 1);
                        assert.strictEqual(results.results[0].id, content.id);

                        // Verify tenant admin can see it
                        SearchTestsUtil.searchAll(
                          asCambridgeTenantAdmin,
                          'content-library',
                          [group.id],
                          null,
                          (err, results) => {
                            assert.ok(!err);
                            assert.strictEqual(results.total, 1);
                            assert.strictEqual(results.results[0].id, content.id);

                            // Verify a member can see it
                            SearchTestsUtil.searchAll(
                              jack.restContext,
                              'content-library',
                              [group.id],
                              null,
                              (err, results) => {
                                assert.ok(!err);
                                assert.strictEqual(results.total, 1);
                                assert.strictEqual(results.results[0].id, content.id);

                                // Verify a loggedin non-member can see it
                                SearchTestsUtil.searchAll(
                                  jane.restContext,
                                  'content-library',
                                  [group.id],
                                  null,
                                  (err, results) => {
                                    assert.ok(!err);
                                    assert.strictEqual(results.total, 1);
                                    assert.strictEqual(results.results[0].id, content.id);

                                    // Verify a cross-tenant user can see it
                                    SearchTestsUtil.searchAll(
                                      darthVader.restContext,
                                      'content-library',
                                      [group.id],
                                      null,
                                      (err, results) => {
                                        assert.ok(!err);
                                        assert.strictEqual(results.total, 1);
                                        assert.strictEqual(results.results[0].id, content.id);
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
    it('verify anonymous and cross-tenant users cannot see loggedin group library items', callback => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.ok(!err);
        const { 0: doer, 1: jack, 2: jane } = users;

        TestsUtil.generateTestUsers(asGeorgiaTechTenantAdmin, 1, (err, users) => {
          assert.ok(!err);
          const { 0: darthVader } = users;

          RestAPI.Group.createGroup(
            doer.restContext,
            TestsUtil.generateTestUserId('group'),
            TestsUtil.generateTestUserId('group'),
            'public',
            'no',
            [],
            [jack.user.id],
            (err, group) => {
              assert.ok(!err);

              // Create the loggedin content item and share it with the group
              RestAPI.Content.createLink(
                doer.restContext,
                {
                  displayName: 'Apereo Website',
                  description: 'The website of the Apereo Foundation',
                  visibility: LOGGED_IN,
                  link: 'http://www.apereofoundation.org',
                  managers: [],
                  viewers: [],
                  folders: []
                },
                (err, content) => {
                  assert.ok(!err);

                  RestAPI.Content.shareContent(doer.restContext, content.id, [group.id], err => {
                    assert.ok(!err);

                    // Verify anonymous cannot see it
                    SearchTestsUtil.searchAll(
                      asCambridgeAnonymousUser,
                      'content-library',
                      [group.id],
                      null,
                      (err, results) => {
                        assert.ok(!err);
                        assert.strictEqual(results.total, 0);
                        assert.ok(!results.results[0]);

                        // Verify tenant admin can see it
                        SearchTestsUtil.searchAll(
                          asCambridgeTenantAdmin,
                          'content-library',
                          [group.id],
                          null,
                          (err, results) => {
                            assert.ok(!err);
                            assert.strictEqual(results.total, 1);
                            assert.strictEqual(results.results[0].id, content.id);

                            // Verify member user can see it
                            SearchTestsUtil.searchAll(
                              jack.restContext,
                              'content-library',
                              [group.id],
                              null,
                              (err, results) => {
                                assert.ok(!err);
                                assert.strictEqual(results.total, 1);
                                assert.strictEqual(results.results[0].id, content.id);

                                // Verify a loggedin non-member can see it
                                SearchTestsUtil.searchAll(
                                  jane.restContext,
                                  'content-library',
                                  [group.id],
                                  null,
                                  (err, results) => {
                                    assert.ok(!err);
                                    assert.strictEqual(results.total, 1);
                                    assert.strictEqual(results.results[0].id, content.id);

                                    // Verify a cross-tenant user cannot see it
                                    SearchTestsUtil.searchAll(
                                      darthVader.restContext,
                                      'content-library',
                                      [group.id],
                                      null,
                                      (err, results) => {
                                        assert.ok(!err);
                                        assert.strictEqual(results.total, 0);
                                        assert.ok(!results.results[0]);
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
    it('verify only member and admin users can see private group library items', callback => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (err, users) => {
        assert.ok(!err);
        const { 0: doer, 1: jack, 2: jane } = users;

        TestsUtil.generateTestUsers(asGeorgiaTechTenantAdmin, 2, (err, users) => {
          assert.ok(!err);

          const { 0: darthVader, 1: sith } = users;

          RestAPI.Group.createGroup(
            doer.restContext,
            TestsUtil.generateTestUserId('group'),
            TestsUtil.generateTestUserId('group'),
            'public',
            'no',
            [],
            [sith.user.id, jack.user.id],
            (err, group) => {
              assert.ok(!err);

              // Create the private content item and share it with the group
              RestAPI.Content.createLink(
                doer.restContext,
                {
                  displayName: 'Apereo Website',
                  description: 'The website of the Apereo Foundation',
                  visibility: PRIVATE,
                  link: 'http://www.apereofoundation.org',
                  managers: [],
                  viewers: [],
                  folders: []
                },
                (err, content) => {
                  assert.ok(!err);

                  RestAPI.Content.shareContent(doer.restContext, content.id, [group.id], err => {
                    assert.ok(!err);

                    // Verify anonymous cannot see the private content item
                    SearchTestsUtil.searchAll(
                      asCambridgeAnonymousUser,
                      'content-library',
                      [group.id],
                      null,
                      (err, results) => {
                        assert.ok(!err);
                        assert.strictEqual(results.total, 0);
                        assert.ok(!results.results[0]);

                        // Verify cam admin can see the private content item
                        SearchTestsUtil.searchAll(
                          asCambridgeTenantAdmin,
                          'content-library',
                          [group.id],
                          null,
                          (err, results) => {
                            assert.ok(!err);
                            assert.strictEqual(results.total, 1);
                            assert.strictEqual(results.results[0].id, content.id);

                            // Verify the same-tenant member can see the private content item
                            SearchTestsUtil.searchAll(
                              jack.restContext,
                              'content-library',
                              [group.id],
                              null,
                              (err, results) => {
                                assert.ok(!err);
                                assert.strictEqual(results.total, 1);
                                assert.strictEqual(results.results[0].id, content.id);

                                // Verify the cross-tenant member can see the private content item
                                SearchTestsUtil.searchAll(
                                  sith.restContext,
                                  'content-library',
                                  [group.id],
                                  null,
                                  (err, results) => {
                                    assert.ok(!err);
                                    assert.strictEqual(results.total, 1);
                                    assert.strictEqual(results.results[0].id, content.id);

                                    // Verify another loggedin user cannot see the private content item
                                    SearchTestsUtil.searchAll(
                                      jane.restContext,
                                      'content-library',
                                      [group.id],
                                      null,
                                      (err, results) => {
                                        assert.ok(!err);
                                        assert.strictEqual(results.total, 0);
                                        assert.ok(!results.results[0]);

                                        // Verify cross-tenant non-member user cannot see the private content item
                                        SearchTestsUtil.searchAll(
                                          darthVader.restContext,
                                          'content-library',
                                          [group.id],
                                          null,
                                          (err, results) => {
                                            assert.ok(!err);
                                            assert.strictEqual(results.total, 0);
                                            assert.ok(!results.results[0]);
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
    it('verify paging the library search feed works correctly', callback => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
        assert.ok(!err);
        const { 0: doer } = users;

        createLink(
          doer.restContext,
          {
            displayName: 'Apereo Website',
            description: 'The website of the Apereo Foundation',
            visibility: PUBLIC,
            link: 'http://www.apereofoundation.org',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, content) => {
            assert.ok(!err);

            createLink(
              doer.restContext,
              {
                displayName: 'Google Website',
                description: 'Google',
                visibility: PUBLIC,
                link: 'http://www.google.ca',
                managers: [],
                viewers: [],
                folders: []
              },
              (err, content) => {
                assert.ok(!err);

                searchRefreshed(
                  doer.restContext,
                  'content-library',
                  [doer.user.id],
                  { limit: 2, start: 0 },
                  (err, results) => {
                    assert.ok(!err);
                    assert.ok(results.results);
                    assert.strictEqual(results.results.length, 2);

                    const firstId = results.results[0].id;
                    const secondId = results.results[1].id;

                    assert.ok(firstId);
                    assert.ok(secondId);

                    /**
                     * Verify the first item comes on the first page.
                     * We don't need to refresh this search because we haven't indexed anything since the previous search
                     */
                    search(
                      doer.restContext,
                      'content-library',
                      [doer.user.id],
                      { limit: 1, start: 0 },
                      (err, results) => {
                        assert.ok(!err);
                        assert.ok(results.results);
                        assert.strictEqual(results.results.length, 1);
                        assert.strictEqual(results.results[0].id, firstId);

                        // Verify the second item comes on the first page.
                        search(
                          doer.restContext,
                          'content-library',
                          [doer.user.id],
                          { limit: 1, start: 1 },
                          (err, results) => {
                            assert.ok(!err);
                            assert.ok(results.results);
                            assert.strictEqual(results.results.length, 1);
                            assert.strictEqual(results.results[0].id, secondId);

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
