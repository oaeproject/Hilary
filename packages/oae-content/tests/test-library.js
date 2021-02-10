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

import * as Cassandra from 'oae-util/lib/cassandra';
import * as ConfigTestUtil from 'oae-config/lib/test/util';
import * as LibraryAPI from 'oae-library';
import * as RestAPI from 'oae-rest';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util';
import * as TestsUtil from 'oae-tests';

import { filter, forEach, prop, equals, compose, head, map, path } from 'ramda';

const { runQuery } = Cassandra;
const {
  getLibrary,
  shareContent,
  updateContent,
  removeContentFromLibrary,
  deleteContent,
  createLink
} = RestAPI.Content;
const { setGroupMembers, createGroup } = RestAPI.Group;
const { updateUser } = RestAPI.User;
const { generateTestTenantHost, generateTestTenantAlias } = TenantsTestUtil;
const {
  createTenantRestContext,
  createTenantWithAdmin,
  createTenantAdminRestContext,
  createGlobalAdminRestContext,
  generateTestUsers,
  generateTestGroups,
  generateGroupHierarchy
} = TestsUtil;

const PUBLIC = 'public';
const PRIVATE = 'private';
const LOGGED_IN = 'loggedin';
const NO_MANAGERS = [];
const NO_FOLDERS = [];
const NO_VIEWERS = [];
const NOT_JOINABLE = 'no';
const MEMBER = 'member';
const MANAGER = 'manager';
const NAME = 'name';
const DESCRIPTION = 'description';

const getTopItemId = compose(prop('id'), head);

describe('Content Libraries', () => {
  let asCambridgeAnonymousUser = null;
  let asCambridgeTenantAdmin = null;
  let asGTAnonymousUser = null;
  let asGTTenantAdmin = null;
  let asGlobalAdmin = null;

  beforeEach(() => {
    asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.cam.host);
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    asGTAnonymousUser = createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    asGTTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    asGlobalAdmin = createGlobalAdminRestContext();
  });

  /**
   * Test that will verify if the returned items from the library are sorted by their last modified date.
   */
  it('verify library is sorted on last modified', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);
      const { 0: homer } = users;
      const asHomer = homer.restContext;

      const items = [];
      createLink(
        asHomer,
        {
          displayName: 'Test Content',
          description: 'Test content description',
          visibility: PUBLIC,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, contentObject) => {
          assert.notExists(error);
          items.push(contentObject.id);

          createLink(
            asHomer,
            {
              displayName: 'Test Content',
              description: 'Test content description',
              visibility: PUBLIC,
              link: 'http://www.oaeproject.org/',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, contentObject) => {
              assert.notExists(error);
              items.push(contentObject.id);

              createLink(
                asHomer,
                {
                  displayName: 'Test Content',
                  description: 'Test content description',
                  visibility: PUBLIC,
                  link: 'http://www.oaeproject.org/',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error, contentObject) => {
                  assert.notExists(error);
                  items.push(contentObject.id);

                  // Get the 2 most recent items.
                  getLibrary(asHomer, homer.user.id, null, 2, (error, data) => {
                    assert.notExists(error);
                    const library = data.results;
                    assert.lengthOf(library, 2);
                    assert.strictEqual(library[0].id, items[2]);
                    assert.strictEqual(library[1].id, items[1]);

                    // Modify the oldest one.
                    updateContent(asHomer, items[0], { description: 'lalila' }, (error_) => {
                      assert.notExists(error_);

                      // When we retrieve the library the just modified one, should be on-top.
                      getLibrary(asHomer, homer.user.id, null, 2, (error, data) => {
                        assert.notExists(error);
                        const library = data.results;
                        assert.lengthOf(library, 2);
                        assert.strictEqual(library[0].id, items[0]);
                        assert.strictEqual(library[1].id, items[2]);

                        callback();
                      });
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

  /**
   * Test that verifies the parameters on the `getContentLibraryItems` method
   */
  it('verify getLibrary parameter validation', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);

      const { 0: homer } = users;
      const asHomer = homer.restContext;

      getLibrary(asHomer, ' ', null, null, (error /* , data */) => {
        assert.strictEqual(error.code, 400);

        getLibrary(asHomer, 'invalid-user-id', null, null, (error /* , data */) => {
          assert.strictEqual(error.code, 400);

          getLibrary(asHomer, 'c:cam:bleh', null, null, (error /* , data */) => {
            assert.strictEqual(error.code, 400);

            getLibrary(asHomer, 'u:cam:bleh', null, null, (error /* , data */) => {
              assert.strictEqual(error.code, 404);
              callback();
            });
          });
        });
      });
    });
  });

  /*
   * Verifies the parameters on the `removeContentFromLibrary` method.
   */
  it('verify removeContentFromLibrary parameter validation', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);
      const { 0: homer } = users;
      const asHomer = homer.restContext;

      createLink(
        asHomer,
        {
          displayName: 'Test Content',
          description: 'Test content description',
          visibility: PUBLIC,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, contentObject) => {
          assert.notExists(error);

          removeContentFromLibrary(asCambridgeAnonymousUser, homer.user.id, contentObject.id, (error_) => {
            assert.strictEqual(error_.code, 401);

            removeContentFromLibrary(asHomer, 'invalid-user-id', contentObject.id, (error_) => {
              assert.strictEqual(error_.code, 400);

              removeContentFromLibrary(asHomer, homer.user.id, 'invalid-content-id', (error_) => {
                assert.strictEqual(error_.code, 400);

                removeContentFromLibrary(asHomer, homer.user.id, 'c:camtest:nonexisting', (error_) => {
                  assert.strictEqual(error_.code, 404);
                  callback();
                });
              });
            });
          });
        }
      );
    });
  });

  /**
   * Test that will verify if an item can be removed from a user library.
   */
  it('verify deleting an item removes it from the library', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);
      const { 0: homer } = users;
      const asHomer = homer.restContext;

      createLink(
        asHomer,
        {
          displayName: 'Test Content',
          description: 'Test content description',
          visibility: PUBLIC,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, contentObject) => {
          assert.notExists(error);

          deleteContent(asHomer, contentObject.id, (error_) => {
            assert.notExists(error_);

            getLibrary(asHomer, homer.user.id, null, null, (error, data) => {
              assert.notExists(error);
              const library = data.results;
              assert.isEmpty(library);
              callback();
            });
          });
        }
      );
    });
  });

  /**
   * Test that will verify if an item can be removed from a user library if the user only holds a viewer permission.
   */
  it('verify a content viewer can remove the content item from his library', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
      assert.notExists(error);
      const { 0: homer, 1: marge } = users;
      const asHomer = homer.restContext;
      const asMarge = marge.restContext;

      createLink(
        asHomer,
        {
          displayName: 'Test Content',
          description: 'Test content description',
          visibility: PUBLIC,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, link) => {
          assert.notExists(error);
          const sameAsLink = equals(link.id);

          shareContent(asHomer, link.id, [marge.user.id], (error_) => {
            assert.notExists(error_);

            // Sanity check that Simon has the item
            getLibrary(asMarge, marge.user.id, null, null, (error, data) => {
              assert.notExists(error);
              const library = data.results;
              assert.lengthOf(library, 1);
              assert.isTrue(sameAsLink(getTopItemId(library)));

              removeContentFromLibrary(asMarge, marge.user.id, link.id, (error_) => {
                assert.notExists(error_);
                getLibrary(asMarge, marge.user.id, null, null, (error, data) => {
                  assert.notExists(error);
                  const library = data.results;
                  assert.isEmpty(library);
                  callback();
                });
              });
            });
          });
        }
      );
    });
  });

  /**
   * Test that will verify that removing a piece of content from a library won't leave
   * the content item unmanaged.
   */
  it('verify a piece of content cannot be left managerless by removing it from the library', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);
      const { 0: homer } = users;
      const asHomer = homer.restContext;

      createLink(
        asHomer,
        {
          displayName: 'Test Content',
          description: 'Test content description',
          visibility: PUBLIC,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, contentObject) => {
          assert.notExists(error);

          // Homer can't remove the content from his library as he is the only manager for it.
          removeContentFromLibrary(asHomer, homer.user.id, contentObject.id, (error_) => {
            assert.strictEqual(error_.code, 400);
            callback();
          });
        }
      );
    });
  });

  /**
   * Consider the following situation:
   * 2 public tenants: A and B
   * 2 users: userA in tenant A and userB in tenant B
   *
   * User A creates a piece of content and shares it with user B.
   * Tenant A becomes private
   * User B should still be able to remove it from his library
   */
  it('verify a piece of content can be removed after a tenant becomes private', (callback) => {
    // We'll create two new tenants.
    const tenantAliasA = generateTestTenantAlias();
    const tenantAliasB = generateTestTenantAlias();
    const tenantHostA = generateTestTenantHost();
    const tenantHostB = generateTestTenantHost();
    createTenantWithAdmin(tenantAliasA, tenantHostA, (error, tenantA, adminRestCtxA) => {
      assert.notExists(error);
      createTenantWithAdmin(tenantAliasB, tenantHostB, (error, tenantB, adminRestCtxB) => {
        assert.notExists(error);

        generateTestUsers(adminRestCtxA, 1, (error, users) => {
          assert.notExists(error);
          const { 0: homer } = users;
          const asHomer = homer.restContext;

          generateTestUsers(adminRestCtxB, 1, (error, users) => {
            assert.notExists(error);
            const { 0: marge } = users;
            const asMarge = marge.restContext;

            createLink(
              asHomer,
              {
                displayName: 'Test Content',
                description: 'Test content description',
                visibility: PUBLIC,
                link: 'http://www.oaeproject.org/',
                managers: NO_MANAGERS,
                viewers: [marge.user.id],
                folders: NO_FOLDERS
              },
              (error, contentObject) => {
                assert.notExists(error);

                // Sanity check that userB has the item in his library
                getLibrary(marge.restContext, marge.user.id, null, null, (error, data) => {
                  assert.notExists(error);
                  const library = data.results;
                  assert.lengthOf(library, 1);
                  assert.strictEqual(library[0].id, contentObject.id);

                  // Now make tenantA private.
                  ConfigTestUtil.updateConfigAndWait(
                    asGlobalAdmin,
                    tenantAliasA,
                    { 'oae-tenants/tenantprivacy/tenantprivate': true },
                    (error_) => {
                      assert.notExists(error_);

                      removeContentFromLibrary(asMarge, marge.user.id, contentObject.id, (error_) => {
                        assert.notExists(error_);
                        getLibrary(asMarge, marge.user.id, null, null, (error, data) => {
                          assert.notExists(error);
                          const library = data.results;
                          assert.isEmpty(library);
                          callback();
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
    });
  });

  /**
   * Verifies a user cannot remove content from another user his library.
   */
  it('verify a user can only remove content from libraries he owns', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
      assert.notExists(error);

      const { 0: homer, 1: marge } = users;
      const asHomer = homer.restContext;
      const asMarge = marge.restContext;

      createLink(
        asHomer,
        {
          displayName: 'Test Content',
          description: 'Test content description',
          visibility: PUBLIC,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, link) => {
          assert.notExists(error);

          const sameAsLink = equals(link.id);

          // This should fail as Marge can't manage Homer his library.
          removeContentFromLibrary(asMarge, homer.user.id, link.id, (error_) => {
            assert.strictEqual(error_.code, 401);

            // Sanity check Homer his library to ensure nothing got removed.
            getLibrary(asHomer, homer.user.id, null, null, (error, data) => {
              assert.notExists(error);

              const library = data.results;
              assert.lengthOf(library, 1);
              assert.isTrue(sameAsLink(getTopItemId(library)));

              callback();
            });
          });
        }
      );
    });
  });

  /**
   * Test that will verify a user can remove content from a group library by virtue of his group ancestry.
   */
  it('verify a user can remove content from a group library by virtue of his group ancestry', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
      assert.notExists(error);

      const { 0: homer, 1: marge, 2: bart } = users;
      const asHomer = homer.restContext;
      const asMarge = marge.restContext;
      const asBart = bart.restContext;

      // Create three nested, groups.
      generateTestGroups(asHomer, 3, (error, groups) => {
        assert.notExists(error);

        const { 1: grandParent, 2: group } = groups;
        const groupIds = map(path(['group', 'id']), groups);

        generateGroupHierarchy(asHomer, groupIds, MANAGER, () => {
          /**
           * Make Marge a manager of the 'group' group (ie: the farthest one down)
           * That should make him a manager of all the groups above this one as well.
           */
          const permissions = {};
          permissions[marge.user.id] = MANAGER;
          setGroupMembers(asHomer, group.group.id, permissions, (error_) => {
            assert.notExists(error_);

            // Bart shares some content with the top group
            createLink(
              asBart,
              {
                displayName: 'Test Content',
                description: 'Test content description',
                visibility: PUBLIC,
                link: 'http://www.google.com/',
                managers: NO_MANAGERS,
                viewers: [grandParent.group.id],
                folders: NO_FOLDERS
              },
              (error, someLink) => {
                assert.notExists(error);

                const sameAsLink = equals(someLink.id);

                // Sanity check it's there.
                getLibrary(asHomer, grandParent.group.id, null, null, (error, data) => {
                  assert.notExists(error);
                  assert.lengthOf(data.results, 1);

                  assert.isTrue(sameAsLink(getTopItemId(data.results)));

                  // Simon decides the content isn't all that great and removes it.
                  removeContentFromLibrary(asMarge, grandParent.group.id, someLink.id, (error_) => {
                    assert.notExists(error_);

                    // Sanity check that it's gone.
                    getLibrary(asHomer, grandParent.group.id, null, null, (error, data) => {
                      assert.notExists(error);
                      assert.isEmpty(data.results);

                      return callback();
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

  /**
   * Checks a principal library.
   *
   * @param  {RestContext}    restCtx         The context to use to do the request
   * @param  {String}         libraryOwnerId  The principal for which to retrieve the library
   * @param  {Boolean}        expectAccess    Whether or not retrieving the library should be successfull
   * @param  {Content[]}      expectedItems   The expected content item that should return
   * @param  {Function}       callback        Standard callback function
   */
  const checkLibrary = function (restCtx, libraryOwnerId, expectAccess, expectedItems, callback) {
    getLibrary(restCtx, libraryOwnerId, null, null, (error, items) => {
      if (expectAccess) {
        assert.notExists(error);

        // Make sure only the expected items are returned.
        assert.strictEqual(items.results.length, expectedItems.length);

        const filterExpectedItems = (item) => compose(equals(item.id), prop('id'));
        forEach((eachItem) => {
          assert.ok(filter(filterExpectedItems(eachItem), items.results));
        }, expectedItems);
      } else {
        assert.strictEqual(error.code, 401);
        assert.isNotOk(items);
      }

      callback();
    });
  };

  /**
   * Creates a user and fills his library with content items.
   *
   * @param  {RestContext}    restCtx                     The context with which to create the user and content
   * @param  {String}         userVisibility              The visibility for the new user
   * @param  {Function}       callback                    Standard callback function
   * @param  {User}           callback.user               The created user
   * @param  {Content}        callback.privateContent     The private piece of content
   * @param  {Content}        callback.loggedinContent    The loggedin piece of content
   * @param  {Content}        callback.publicContent      The public piece of content
   */
  const createUserAndLibrary = function (restCtx, userVisibility, callback) {
    // Create a user with the proper visibility
    generateTestUsers(restCtx, 1, (error, users) => {
      assert.notExists(error);

      const { 0: homer } = users;
      const asHomer = homer.restContext;

      updateUser(asHomer, homer.user.id, { visibility: userVisibility }, (error_) => {
        assert.notExists(error_);

        // Fill up this user his library with 3 content items.
        createLink(
          asHomer,
          {
            displayName: NAME,
            description: DESCRIPTION,
            visibility: PRIVATE,
            link: 'http://www.oaeproject.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, privateContent) => {
            assert.notExists(error);
            createLink(
              asHomer,
              {
                displayName: NAME,
                description: DESCRIPTION,
                visibility: LOGGED_IN,
                link: 'http://www.oaeproject.org',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, loggedinContent) => {
                assert.notExists(error);
                createLink(
                  asHomer,
                  {
                    displayName: NAME,
                    description: DESCRIPTION,
                    visibility: PUBLIC,
                    link: 'http://www.oaeproject.org',
                    managers: NO_MANAGERS,
                    viewers: NO_VIEWERS,
                    folders: NO_FOLDERS
                  },
                  (error, publicContent) => {
                    assert.notExists(error);
                    callback(homer, privateContent, loggedinContent, publicContent);
                  }
                );
              }
            );
          }
        );
      });
    });
  };

  /**
   * Creates a group with the supplied visibility and fill its library with 3 content items.
   *
   * @param  {RestContext}    restCtx                     The context with which to create the group and content
   * @param  {String}         groupVisibility             The visibility for the new group
   * @param  {Function}       callback                    Standard callback function
   * @param  {Group}          callback.group              The created group
   * @param  {Content}        callback.privateContent     The private piece of content
   * @param  {Content}        callback.loggedinContent    The loggedin piece of content
   * @param  {Content}        callback.publicContent      The public piece of content
   */
  const createGroupAndLibrary = function (asSomebody, groupVisibility, callback) {
    createGroup(asSomebody, 'displayName', DESCRIPTION, groupVisibility, NOT_JOINABLE, [], [], (error, group) => {
      assert.notExists(error);

      // Fill up the group library with 3 content items.
      createLink(
        asSomebody,
        {
          displayName: NAME,
          description: DESCRIPTION,
          visibility: PRIVATE,
          link: 'http://www.oaeproject.org',
          managers: [group.id],
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, privateContent) => {
          assert.notExists(error);
          createLink(
            asSomebody,
            {
              displayName: NAME,
              description: DESCRIPTION,
              visibility: LOGGED_IN,
              link: 'http://www.oaeproject.org',
              managers: [group.id],
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, loggedinContent) => {
              assert.notExists(error);
              createLink(
                asSomebody,
                {
                  displayName: NAME,
                  description: DESCRIPTION,
                  visibility: PUBLIC,
                  link: 'http://www.oaeproject.org',
                  managers: [group.id],
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error, publicContent) => {
                  assert.notExists(error);
                  callback(group, privateContent, loggedinContent, publicContent);
                }
              );
            }
          );
        }
      );
    });
  };

  /**
   * A testcase that the correct library stream is returned and the library user's visibility
   * settings are respected.
   */
  it('verify user libraries', (callback) => {
    // We'll create a private, loggedin and public user, each user's library will contain a private, loggedin and public content item.
    createUserAndLibrary(
      asCambridgeTenantAdmin,
      PRIVATE,
      (privateUser, privateUserPrivateContent, privateUserLoggedinContent, privateUserPublicContent) => {
        const asPrivateUser = privateUser.restContext;

        createUserAndLibrary(
          asCambridgeTenantAdmin,
          LOGGED_IN,
          (loggedinUser, loggedinUserPrivateContent, loggedinUserLoggedinContent, loggedinUserPublicContent) => {
            const asLoggedinUser = loggedinUser.restContext;

            createUserAndLibrary(
              asCambridgeTenantAdmin,
              PUBLIC,
              (publicUser, publicUserPrivateContent, publicUserLoggedinContent, publicUserPublicContent) => {
                const asPublicUser = publicUser.restContext;

                // Each user should be able to see all the items in his library.
                checkLibrary(
                  asPrivateUser,
                  privateUser.user.id,
                  true,
                  [privateUserPublicContent, privateUserLoggedinContent, privateUserPrivateContent],
                  () => {
                    checkLibrary(
                      asLoggedinUser,
                      loggedinUser.user.id,
                      true,
                      [loggedinUserPublicContent, loggedinUserLoggedinContent, loggedinUserPrivateContent],
                      () => {
                        checkLibrary(
                          asPublicUser,
                          publicUser.user.id,
                          true,
                          [publicUserPublicContent, publicUserLoggedinContent, publicUserPrivateContent],
                          () => {
                            // The anonymous user can only see the public stream of the public user.
                            checkLibrary(
                              asCambridgeAnonymousUser,
                              publicUser.user.id,
                              true,
                              [publicUserPublicContent],
                              () => {
                                checkLibrary(asCambridgeAnonymousUser, loggedinUser.user.id, false, [], () => {
                                  checkLibrary(asCambridgeAnonymousUser, privateUser.user.id, false, [], () => {
                                    checkLibrary(
                                      asGTAnonymousUser,
                                      publicUser.user.id,
                                      true,
                                      [publicUserPublicContent],
                                      () => {
                                        checkLibrary(asGTAnonymousUser, loggedinUser.user.id, false, [], () => {
                                          checkLibrary(asGTAnonymousUser, privateUser.user.id, false, [], () => {
                                            // A loggedin user on the same tenant can see the loggedin stream for the public and loggedin user.
                                            generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
                                              assert.notExists(error);
                                              const { 0: anotherUser } = users;
                                              const asAnotherUser = anotherUser.restContext;

                                              checkLibrary(
                                                asAnotherUser,
                                                publicUser.user.id,
                                                true,
                                                [publicUserPublicContent, publicUserLoggedinContent],
                                                () => {
                                                  checkLibrary(
                                                    asAnotherUser,
                                                    loggedinUser.user.id,
                                                    true,
                                                    [loggedinUserPublicContent, loggedinUserLoggedinContent],
                                                    () => {
                                                      checkLibrary(
                                                        asAnotherUser,
                                                        privateUser.user.id,
                                                        false,
                                                        [],
                                                        () => {
                                                          // A loggedin user on *another* tenant can only see the public stream for the public user.
                                                          generateTestUsers(asGTTenantAdmin, 1, (error, users) => {
                                                            assert.notExists(error);

                                                            const { 0: otherTenantUser } = users;
                                                            const asOtherTenantUser = otherTenantUser.restContext;

                                                            checkLibrary(
                                                              asOtherTenantUser,
                                                              publicUser.user.id,
                                                              true,
                                                              [publicUserPublicContent],
                                                              () => {
                                                                checkLibrary(
                                                                  asOtherTenantUser,
                                                                  loggedinUser.user.id,
                                                                  false,
                                                                  [],
                                                                  () => {
                                                                    checkLibrary(
                                                                      asOtherTenantUser,
                                                                      privateUser.user.id,
                                                                      false,
                                                                      [],
                                                                      () => {
                                                                        // The cambridge tenant admin can see all the things.
                                                                        checkLibrary(
                                                                          asCambridgeTenantAdmin,
                                                                          publicUser.user.id,
                                                                          true,
                                                                          [
                                                                            publicUserPublicContent,
                                                                            publicUserLoggedinContent,
                                                                            publicUserPrivateContent
                                                                          ],
                                                                          () => {
                                                                            checkLibrary(
                                                                              asCambridgeTenantAdmin,
                                                                              loggedinUser.user.id,
                                                                              true,
                                                                              [
                                                                                loggedinUserPublicContent,
                                                                                loggedinUserLoggedinContent,
                                                                                loggedinUserPrivateContent
                                                                              ],
                                                                              () => {
                                                                                checkLibrary(
                                                                                  asCambridgeTenantAdmin,
                                                                                  privateUser.user.id,
                                                                                  true,
                                                                                  [
                                                                                    privateUserPublicContent,
                                                                                    privateUserLoggedinContent,
                                                                                    privateUserPrivateContent
                                                                                  ],
                                                                                  () => {
                                                                                    // The GT tenant admin can only see the public stream for the public user.
                                                                                    checkLibrary(
                                                                                      asGTTenantAdmin,
                                                                                      publicUser.user.id,
                                                                                      true,
                                                                                      [publicUserPublicContent],
                                                                                      () => {
                                                                                        checkLibrary(
                                                                                          asGTTenantAdmin,
                                                                                          loggedinUser.user.id,
                                                                                          false,
                                                                                          [],
                                                                                          () => {
                                                                                            checkLibrary(
                                                                                              asGTTenantAdmin,
                                                                                              privateUser.user.id,
                                                                                              false,
                                                                                              [],
                                                                                              callback
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
                                            });
                                          });
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
                  }
                );
              }
            );
          }
        );
      }
    );
  });

  /**
   * A testcase that the correct library stream is returned for a group.
   */
  it('verify group libraries', (callback) => {
    // Create three groups: private, loggedin, public
    generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
      assert.notExists(error);

      const { 0: groupCreator, 1: anotherUser } = users;
      const asGroupCreator = groupCreator.restContext;
      const asAnotherUser = anotherUser.restContext;

      createGroupAndLibrary(asGroupCreator, PRIVATE, (
        privateGroup,
        privateGroupPrivateContent,
        privateGroupLoggedinContent /* , privateGroupPublicContent */
      ) => {
        createGroupAndLibrary(
          asGroupCreator,
          LOGGED_IN,
          (loggedinGroup, loggedinGroupPrivateContent, loggedinGroupLoggedinContent, loggedinGroupPublicContent) => {
            createGroupAndLibrary(
              asGroupCreator,
              PUBLIC,
              (publicGroup, publicGroupPrivateContent, publicGroupLoggedinContent, publicGroupPublicContent) => {
                // An anonymous user can only see the public stream for the public group.
                checkLibrary(asCambridgeAnonymousUser, publicGroup.id, true, [publicGroupPublicContent], () => {
                  checkLibrary(asCambridgeAnonymousUser, loggedinGroup.id, false, [], () => {
                    checkLibrary(asCambridgeAnonymousUser, privateGroup.id, false, [], () => {
                      checkLibrary(asGTAnonymousUser, publicGroup.id, true, [publicGroupPublicContent], () => {
                        checkLibrary(asGTAnonymousUser, loggedinGroup.id, false, [], () => {
                          checkLibrary(asGTAnonymousUser, privateGroup.id, false, [], () => {
                            // A loggedin user on the same tenant can see the loggedin stream for the public and loggedin group.
                            checkLibrary(
                              asAnotherUser,
                              publicGroup.id,
                              true,
                              [publicGroupPublicContent, publicGroupLoggedinContent],
                              () => {
                                checkLibrary(
                                  asAnotherUser,
                                  loggedinGroup.id,
                                  true,
                                  [loggedinGroupPublicContent, loggedinGroupLoggedinContent],
                                  () => {
                                    checkLibrary(asAnotherUser, privateGroup.id, false, [], () => {
                                      // A loggedin user on *another* tenant can only see the public stream for the public group.
                                      generateTestUsers(asGTTenantAdmin, 1, (error, users) => {
                                        assert.notExists(error);

                                        const { 0: otherTenantUser } = users;
                                        const asOtherTenantUser = otherTenantUser.restContext;

                                        checkLibrary(
                                          asOtherTenantUser,
                                          publicGroup.id,
                                          true,
                                          [publicGroupPublicContent],
                                          () => {
                                            checkLibrary(asOtherTenantUser, loggedinGroup.id, false, [], () => {
                                              checkLibrary(asOtherTenantUser, privateGroup.id, false, [], () => {
                                                // The cambridge tenant admin can see all the things.
                                                checkLibrary(
                                                  asCambridgeTenantAdmin,
                                                  publicGroup.id,
                                                  true,
                                                  [
                                                    publicGroupPublicContent,
                                                    publicGroupLoggedinContent,
                                                    publicGroupPrivateContent
                                                  ],
                                                  () => {
                                                    checkLibrary(
                                                      asCambridgeTenantAdmin,
                                                      loggedinGroup.id,
                                                      true,
                                                      [
                                                        loggedinGroupPublicContent,
                                                        loggedinGroupLoggedinContent,
                                                        loggedinGroupPrivateContent
                                                      ],
                                                      () => {
                                                        checkLibrary(
                                                          asCambridgeTenantAdmin,
                                                          privateGroup.id,
                                                          true,
                                                          [
                                                            privateGroupPrivateContent,
                                                            privateGroupLoggedinContent,
                                                            privateGroupPrivateContent
                                                          ],
                                                          () => {
                                                            // The GT tenant admin can only see the public stream for the public group.
                                                            checkLibrary(
                                                              asGTTenantAdmin,
                                                              publicGroup.id,
                                                              true,
                                                              [publicGroupPublicContent],
                                                              () => {
                                                                checkLibrary(
                                                                  asGTTenantAdmin,
                                                                  loggedinGroup.id,
                                                                  false,
                                                                  [],
                                                                  () => {
                                                                    checkLibrary(
                                                                      asGTTenantAdmin,
                                                                      privateGroup.id,
                                                                      false,
                                                                      [],
                                                                      () => {
                                                                        // If we make the cambridge user a member of the private group he should see everything.
                                                                        let changes = {};
                                                                        changes[anotherUser.user.id] = MEMBER;
                                                                        setGroupMembers(
                                                                          asGroupCreator,
                                                                          privateGroup.id,
                                                                          changes,
                                                                          (error_) => {
                                                                            assert.notExists(error_);
                                                                            checkLibrary(
                                                                              asAnotherUser,
                                                                              privateGroup.id,
                                                                              true,
                                                                              [
                                                                                privateGroupPrivateContent,
                                                                                privateGroupLoggedinContent,
                                                                                privateGroupPrivateContent
                                                                              ],
                                                                              () => {
                                                                                // If we make the GT user a member of the private group, he should see everything.
                                                                                changes = {};
                                                                                changes[
                                                                                  otherTenantUser.user.id
                                                                                ] = MEMBER;
                                                                                setGroupMembers(
                                                                                  asGroupCreator,
                                                                                  privateGroup.id,
                                                                                  changes,
                                                                                  (error_) => {
                                                                                    assert.notExists(error_);
                                                                                    checkLibrary(
                                                                                      asOtherTenantUser,
                                                                                      privateGroup.id,
                                                                                      true,
                                                                                      [
                                                                                        privateGroupPrivateContent,
                                                                                        privateGroupLoggedinContent,
                                                                                        privateGroupPrivateContent
                                                                                      ],
                                                                                      callback
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
                                    });
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
              }
            );
          }
        );
      });
    });
  });

  /**
   * Test that verifies that a library can be rebuilt from a dirty authz table
   */
  it('verify a library can be rebuilt from a dirty authz table', (callback) => {
    createUserAndLibrary(asCambridgeTenantAdmin, PRIVATE, (homer, privateContent, loggedinContent, publicContent) => {
      const asHomer = homer.restContext;
      // Ensure all the items are in the user's library
      checkLibrary(asHomer, homer.user.id, true, [privateContent, loggedinContent, publicContent], () => {
        /**
         * Remove a content item directly in Cassandra. This will leave a pointer
         * in the Authz table that points to nothing. The library re-indexer should
         * be able to deal with this. Note that we go straight to Cassandra, as the
         * ContentDAO also takes care of removing the item from the appropriate libraries
         */
        runQuery('DELETE FROM "Content" WHERE "contentId" = ?', [privateContent.id], (error) => {
          assert.notExists(error);

          // Purge the library so that it has to be rebuild on the next request
          LibraryAPI.Index.purge('content:content', homer.user.id, (error) => {
            assert.notExists(error);

            // We should be able to rebuild the library on-the-fly. The private
            // content item should not be returned as it has been removed
            checkLibrary(asHomer, homer.user.id, true, [loggedinContent, publicContent], callback);
          });
        });
      });
    });
  });
});
