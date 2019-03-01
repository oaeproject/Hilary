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

const Cassandra = require('oae-util/lib/cassandra');
const ConfigTestUtil = require('oae-config/lib/test/util');
const LibraryAPI = require('oae-library');
const RestAPI = require('oae-rest');
const TenantsTestUtil = require('oae-tenants/lib/test/util');
const TestsUtil = require('oae-tests');

describe('Content Libraries', () => {
  let camAnonymousRestCtx = null;
  let camAdminRestCtx = null;
  let gtAnonymousRestCtx = null;
  let gtAdminRestCtx = null;
  let globalAdminRestContext = null;

  beforeEach(() => {
    camAnonymousRestCtx = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAnonymousRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    gtAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
  });

  /**
   * Test that will verify if the returned items from the library are sorted by their last modified date.
   */
  it('verify library is sorted on last modified', callback => {
    TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, users) => {
      assert.ok(!err);
      const { 0: nicolaas } = _.values(users);

      const items = [];
      RestAPI.Content.createLink(
        nicolaas.restContext,
        'Test Content',
        'Test content description',
        'public',
        'http://www.oaeproject.org/',
        [],
        [],
        [],
        (err, contentObj) => {
          assert.ok(!err);
          items.push(contentObj.id);

          RestAPI.Content.createLink(
            nicolaas.restContext,
            'Test Content',
            'Test content description',
            'public',
            'http://www.oaeproject.org/',
            [],
            [],
            [],
            (err, contentObj) => {
              assert.ok(!err);
              items.push(contentObj.id);

              RestAPI.Content.createLink(
                nicolaas.restContext,
                'Test Content',
                'Test content description',
                'public',
                'http://www.oaeproject.org/',
                [],
                [],
                [],
                (err, contentObj) => {
                  assert.ok(!err);
                  items.push(contentObj.id);

                  // Get the 2 most recent items.
                  RestAPI.Content.getLibrary(
                    nicolaas.restContext,
                    nicolaas.user.id,
                    null,
                    2,
                    (err, data) => {
                      assert.ok(!err);
                      const library = data.results;
                      assert.strictEqual(library.length, 2);
                      assert.strictEqual(library[0].id, items[2]);
                      assert.strictEqual(library[1].id, items[1]);

                      // Modify the oldest one.
                      RestAPI.Content.updateContent(
                        nicolaas.restContext,
                        items[0],
                        { description: 'lalila' },
                        err => {
                          assert.ok(!err);

                          // When we retrieve the library the just modified one, should be on-top.
                          RestAPI.Content.getLibrary(
                            nicolaas.restContext,
                            nicolaas.user.id,
                            null,
                            2,
                            (err, data) => {
                              assert.ok(!err);
                              const library = data.results;
                              assert.strictEqual(library.length, 2);
                              assert.strictEqual(library[0].id, items[0]);
                              assert.strictEqual(library[1].id, items[2]);

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

  /**
   * Test that verifies the parameters on the `getContentLibraryItems` method
   */
  it('verify getLibrary parameter validation', callback => {
    TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, users) => {
      assert.ok(!err);
      const { 0: simon } = _.values(users);

      RestAPI.Content.getLibrary(simon.restContext, ' ', null, null, (err, data) => {
        assert.strictEqual(err.code, 400);

        RestAPI.Content.getLibrary(
          simon.restContext,
          'invalid-user-id',
          null,
          null,
          (err, data) => {
            assert.strictEqual(err.code, 400);

            RestAPI.Content.getLibrary(simon.restContext, 'c:cam:bleh', null, null, (err, data) => {
              assert.strictEqual(err.code, 400);

              RestAPI.Content.getLibrary(
                simon.restContext,
                'u:cam:bleh',
                null,
                null,
                (err, data) => {
                  assert.strictEqual(err.code, 404);
                  callback();
                }
              );
            });
          }
        );
      });
    });
  });

  /**
   * Verifies the parameters on the `removeContentFromLibrary` method.
   */
  it('verify removeContentFromLibrary parameter validation', callback => {
    TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, users) => {
      assert.ok(!err);
      const { 0: simon } = _.values(users);

      RestAPI.Content.createLink(
        simon.restContext,
        'Test Content',
        'Test content description',
        'public',
        'http://www.oaeproject.org/',
        [],
        [],
        [],
        (err, contentObj) => {
          assert.ok(!err);

          RestAPI.Content.removeContentFromLibrary(
            camAnonymousRestCtx,
            simon.user.id,
            contentObj.id,
            err => {
              assert.strictEqual(err.code, 401);

              RestAPI.Content.removeContentFromLibrary(
                simon.restContext,
                'invalid-user-id',
                contentObj.id,
                err => {
                  assert.strictEqual(err.code, 400);

                  RestAPI.Content.removeContentFromLibrary(
                    simon.restContext,
                    simon.user.id,
                    'invalid-content-id',
                    err => {
                      assert.strictEqual(err.code, 400);

                      RestAPI.Content.removeContentFromLibrary(
                        simon.restContext,
                        simon.user.id,
                        'c:camtest:nonexisting',
                        err => {
                          assert.strictEqual(err.code, 404);
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
    });
  });

  /**
   * Test that will verify if an item can be removed from a user library.
   */
  it('verify deleting an item removes it from the library', callback => {
    TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, users) => {
      assert.ok(!err);
      const { 0: nicolaas } = _.values(users);

      RestAPI.Content.createLink(
        nicolaas.restContext,
        'Test Content',
        'Test content description',
        'public',
        'http://www.oaeproject.org/',
        [],
        [],
        [],
        (err, contentObj) => {
          assert.ok(!err);

          RestAPI.Content.deleteContent(nicolaas.restContext, contentObj.id, err => {
            assert.ok(!err);

            RestAPI.Content.getLibrary(
              nicolaas.restContext,
              nicolaas.user.id,
              null,
              null,
              (err, data) => {
                assert.ok(!err);
                const library = data.results;
                assert.strictEqual(library.length, 0);
                callback();
              }
            );
          });
        }
      );
    });
  });

  /**
   * Test that will verify if an item can be removed from a user library if the user only holds a viewer permission.
   */
  it('verify a content viewer can remove the content item from his library', callback => {
    TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, users) => {
      assert.ok(!err);
      const { 0: nicolaas } = _.values(users);
      const { 1: simon } = _.values(users);

      RestAPI.Content.createLink(
        nicolaas.restContext,
        'Test Content',
        'Test content description',
        'public',
        'http://www.oaeproject.org/',
        [],
        [],
        [],
        (err, contentObj) => {
          assert.ok(!err);

          RestAPI.Content.shareContent(
            nicolaas.restContext,
            contentObj.id,
            [simon.user.id],
            err => {
              assert.ok(!err);

              // Sanity check that Simon has the item
              RestAPI.Content.getLibrary(
                simon.restContext,
                simon.user.id,
                null,
                null,
                (err, data) => {
                  assert.ok(!err);
                  const library = data.results;
                  assert.strictEqual(library.length, 1);
                  assert.strictEqual(library[0].id, contentObj.id);

                  RestAPI.Content.removeContentFromLibrary(
                    simon.restContext,
                    simon.user.id,
                    contentObj.id,
                    err => {
                      assert.ok(!err);
                      RestAPI.Content.getLibrary(
                        simon.restContext,
                        simon.user.id,
                        null,
                        null,
                        (err, data) => {
                          assert.ok(!err);
                          const library = data.results;
                          assert.strictEqual(library.length, 0);
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
    });
  });

  /**
   * Test that will verify that removing a piece of content from a library won't leave
   * the content item unmanaged.
   */
  it('verify a piece of content cannot be left managerless by removing it from the library', callback => {
    TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, users) => {
      assert.ok(!err);
      const { 0: nicolaas } = _.values(users);

      RestAPI.Content.createLink(
        nicolaas.restContext,
        'Test Content',
        'Test content description',
        'public',
        'http://www.oaeproject.org/',
        [],
        [],
        [],
        (err, contentObj) => {
          assert.ok(!err);

          // Nicolaas can't remove the content from his library
          // as he is the only manager for it.
          RestAPI.Content.removeContentFromLibrary(
            nicolaas.restContext,
            nicolaas.user.id,
            contentObj.id,
            err => {
              assert.strictEqual(err.code, 400);
              callback();
            }
          );
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
  it('verify a piece of content can be removed after a tenant becomes private', callback => {
    // We'll create two new tenants.
    const tenantAliasA = TenantsTestUtil.generateTestTenantAlias();
    const tenantAliasB = TenantsTestUtil.generateTestTenantAlias();
    const tenantHostA = TenantsTestUtil.generateTestTenantHost();
    const tenantHostB = TenantsTestUtil.generateTestTenantHost();
    TestsUtil.createTenantWithAdmin(tenantAliasA, tenantHostA, (err, tenantA, adminRestCtxA) => {
      assert.ok(!err);
      TestsUtil.createTenantWithAdmin(tenantAliasB, tenantHostB, (err, tenantB, adminRestCtxB) => {
        assert.ok(!err);

        TestsUtil.generateTestUsers(adminRestCtxA, 1, (err, users) => {
          assert.ok(!err);
          const { 0: userA } = _.values(users);
          TestsUtil.generateTestUsers(adminRestCtxB, 1, (err, users) => {
            assert.ok(!err);
            const { 0: userB } = _.values(users);

            RestAPI.Content.createLink(
              userA.restContext,
              'Test Content',
              'Test content description',
              'public',
              'http://www.oaeproject.org/',
              [],
              [userB.user.id],
              [],
              (err, contentObj) => {
                assert.ok(!err);

                // Sanity check that userB has the item in his library
                RestAPI.Content.getLibrary(
                  userB.restContext,
                  userB.user.id,
                  null,
                  null,
                  (err, data) => {
                    assert.ok(!err);
                    const library = data.results;
                    assert.strictEqual(library.length, 1);
                    assert.strictEqual(library[0].id, contentObj.id);

                    // Now make tenantA private.
                    ConfigTestUtil.updateConfigAndWait(
                      globalAdminRestContext,
                      tenantAliasA,
                      { 'oae-tenants/tenantprivacy/tenantprivate': true },
                      err => {
                        assert.ok(!err);

                        RestAPI.Content.removeContentFromLibrary(
                          userB.restContext,
                          userB.user.id,
                          contentObj.id,
                          err => {
                            assert.ok(!err);
                            RestAPI.Content.getLibrary(
                              userB.restContext,
                              userB.user.id,
                              null,
                              null,
                              (err, data) => {
                                assert.ok(!err);
                                const library = data.results;
                                assert.strictEqual(library.length, 0);
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
          });
        });
      });
    });
  });

  /**
   * Verifies a user cannot remove content from another user his library.
   */
  it('verify a user can only remove content from libraries he owns', callback => {
    TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, users) => {
      assert.ok(!err);
      const { 0: nicolaas } = _.values(users);
      const { 1: simon } = _.values(users);

      RestAPI.Content.createLink(
        nicolaas.restContext,
        'Test Content',
        'Test content description',
        'public',
        'http://www.oaeproject.org/',
        [],
        [],
        [],
        (err, contentObj) => {
          assert.ok(!err);

          // This should fail as Simon can't manage Nicolaas his library.
          RestAPI.Content.removeContentFromLibrary(
            simon.restContext,
            nicolaas.user.id,
            contentObj.id,
            err => {
              assert.strictEqual(err.code, 401);

              // Sanity check Nicolaas his library to ensure nothing got removed.
              RestAPI.Content.getLibrary(
                nicolaas.restContext,
                nicolaas.user.id,
                null,
                null,
                (err, data) => {
                  assert.ok(!err);
                  const library = data.results;
                  assert.strictEqual(library.length, 1);
                  assert.strictEqual(library[0].id, contentObj.id);
                  callback();
                }
              );
            }
          );
        }
      );
    });
  });

  /**
   * Test that will verify a user can remove content from a group library by virtue of his group ancestry.
   */
  it('verify a user can remove content from a group library by virtue of his group ancestry', callback => {
    TestsUtil.generateTestUsers(camAdminRestCtx, 3, (err, users) => {
      assert.ok(!err);
      const { 0: nicolaas } = _.values(users);
      const { 1: simon } = _.values(users);
      const { 2: bert } = _.values(users);

      // Create three nested, groups.
      TestsUtil.generateTestGroups(nicolaas.restContext, 3, (group, parent, grandParent) => {
        const groupIds = [grandParent.group.id, parent.group.id, group.group.id];
        TestsUtil.generateGroupHierarchy(nicolaas.restContext, groupIds, 'manager', () => {
          // Make Simon a manager of the 'group' group (ie: the farthest one down)
          // That should make him a manager of all the groups above this one as well.
          const permissions = {};
          permissions[simon.user.id] = 'manager';
          RestAPI.Group.setGroupMembers(nicolaas.restContext, group.group.id, permissions, err => {
            assert.ok(!err);

            // Bert shares some content with the top group
            RestAPI.Content.createLink(
              bert.restContext,
              'Test Content',
              'Test content description',
              'public',
              'http://www.google.com/',
              [],
              [grandParent.group.id],
              [],
              (err, contentObj) => {
                assert.ok(!err);

                // Sanity check it's there.
                RestAPI.Content.getLibrary(
                  nicolaas.restContext,
                  grandParent.group.id,
                  null,
                  null,
                  (err, data) => {
                    assert.ok(!err);
                    const library = data.results;
                    assert.strictEqual(library.length, 1);
                    assert.strictEqual(library[0].id, contentObj.id);

                    // Simon decides the content isn't all that great and removes it.
                    RestAPI.Content.removeContentFromLibrary(
                      simon.restContext,
                      grandParent.group.id,
                      contentObj.id,
                      err => {
                        assert.ok(!err);

                        // Sanity check that it's gone.
                        RestAPI.Content.getLibrary(
                          nicolaas.restContext,
                          grandParent.group.id,
                          null,
                          null,
                          (err, data) => {
                            assert.ok(!err);
                            const library = data.results;
                            assert.strictEqual(library.length, 0);
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
  const checkLibrary = function(restCtx, libraryOwnerId, expectAccess, expectedItems, callback) {
    RestAPI.Content.getLibrary(restCtx, libraryOwnerId, null, null, (err, items) => {
      if (expectAccess) {
        assert.ok(!err);

        // Make sure only the expected items are returned.
        assert.strictEqual(items.results.length, expectedItems.length);
        _.each(expectedItems, expectedContentItem => {
          assert.ok(
            _.filter(items.results, content => {
              return content.id === expectedContentItem.id;
            })
          );
        });
      } else {
        assert.strictEqual(err.code, 401);
        assert.ok(!items);
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
  const createUserAndLibrary = function(restCtx, userVisibility, callback) {
    // Create a user with the proper visibility
    TestsUtil.generateTestUsers(restCtx, 1, (err, users) => {
      const { 0: user } = _.values(users);
      RestAPI.User.updateUser(
        user.restContext,
        user.user.id,
        { visibility: userVisibility },
        err => {
          assert.ok(!err);

          // Fill up this user his library with 3 content items.
          RestAPI.Content.createLink(
            user.restContext,
            'name',
            'description',
            'private',
            'http://www.oaeproject.org',
            null,
            null,
            [],
            (err, privateContent) => {
              assert.ok(!err);
              RestAPI.Content.createLink(
                user.restContext,
                'name',
                'description',
                'loggedin',
                'http://www.oaeproject.org',
                null,
                null,
                [],
                (err, loggedinContent) => {
                  assert.ok(!err);
                  RestAPI.Content.createLink(
                    user.restContext,
                    'name',
                    'description',
                    'public',
                    'http://www.oaeproject.org',
                    null,
                    null,
                    [],
                    (err, publicContent) => {
                      assert.ok(!err);
                      callback(user, privateContent, loggedinContent, publicContent);
                    }
                  );
                }
              );
            }
          );
        }
      );
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
  const createGroupAndLibrary = function(restCtx, groupVisibility, callback) {
    RestAPI.Group.createGroup(
      restCtx,
      'displayName',
      'description',
      groupVisibility,
      'no',
      [],
      [],
      (err, group) => {
        assert.ok(!err);

        // Fill up the group library with 3 content items.
        RestAPI.Content.createLink(
          restCtx,
          'name',
          'description',
          'private',
          'http://www.oaeproject.org',
          [group.id],
          null,
          [],
          (err, privateContent) => {
            assert.ok(!err);
            RestAPI.Content.createLink(
              restCtx,
              'name',
              'description',
              'loggedin',
              'http://www.oaeproject.org',
              [group.id],
              null,
              [],
              (err, loggedinContent) => {
                assert.ok(!err);
                RestAPI.Content.createLink(
                  restCtx,
                  'name',
                  'description',
                  'public',
                  'http://www.oaeproject.org',
                  [group.id],
                  null,
                  [],
                  (err, publicContent) => {
                    assert.ok(!err);
                    callback(group, privateContent, loggedinContent, publicContent);
                  }
                );
              }
            );
          }
        );
      }
    );
  };

  /**
   * A testcase that the correct library stream is returned and the library user's visibility
   * settings are respected.
   */
  it('verify user libraries', callback => {
    // We'll create a private, loggedin and public user, each user's library will contain a private, loggedin and public content item.
    createUserAndLibrary(
      camAdminRestCtx,
      'private',
      (
        privateUser,
        privateUserPrivateContent,
        privateUserLoggedinContent,
        privateUserPublicContent
      ) => {
        createUserAndLibrary(
          camAdminRestCtx,
          'loggedin',
          (
            loggedinUser,
            loggedinUserPrivateContent,
            loggedinUserLoggedinContent,
            loggedinUserPublicContent
          ) => {
            createUserAndLibrary(
              camAdminRestCtx,
              'public',
              (
                publicUser,
                publicUserPrivateContent,
                publicUserLoggedinContent,
                publicUserPublicContent
              ) => {
                // Each user should be able to see all the items in his library.
                checkLibrary(
                  privateUser.restContext,
                  privateUser.user.id,
                  true,
                  [privateUserPublicContent, privateUserLoggedinContent, privateUserPrivateContent],
                  () => {
                    checkLibrary(
                      loggedinUser.restContext,
                      loggedinUser.user.id,
                      true,
                      [
                        loggedinUserPublicContent,
                        loggedinUserLoggedinContent,
                        loggedinUserPrivateContent
                      ],
                      () => {
                        checkLibrary(
                          publicUser.restContext,
                          publicUser.user.id,
                          true,
                          [
                            publicUserPublicContent,
                            publicUserLoggedinContent,
                            publicUserPrivateContent
                          ],
                          () => {
                            // The anonymous user can only see the public stream of the public user.
                            checkLibrary(
                              camAnonymousRestCtx,
                              publicUser.user.id,
                              true,
                              [publicUserPublicContent],
                              () => {
                                checkLibrary(
                                  camAnonymousRestCtx,
                                  loggedinUser.user.id,
                                  false,
                                  [],
                                  () => {
                                    checkLibrary(
                                      camAnonymousRestCtx,
                                      privateUser.user.id,
                                      false,
                                      [],
                                      () => {
                                        checkLibrary(
                                          gtAnonymousRestCtx,
                                          publicUser.user.id,
                                          true,
                                          [publicUserPublicContent],
                                          () => {
                                            checkLibrary(
                                              gtAnonymousRestCtx,
                                              loggedinUser.user.id,
                                              false,
                                              [],
                                              () => {
                                                checkLibrary(
                                                  gtAnonymousRestCtx,
                                                  privateUser.user.id,
                                                  false,
                                                  [],
                                                  () => {
                                                    // A loggedin user on the same tenant can see the loggedin stream for the public and loggedin user.
                                                    TestsUtil.generateTestUsers(
                                                      camAdminRestCtx,
                                                      1,
                                                      (err, users) => {
                                                        const { 0: anotherUser } = _.values(users);
                                                        checkLibrary(
                                                          anotherUser.restContext,
                                                          publicUser.user.id,
                                                          true,
                                                          [
                                                            publicUserPublicContent,
                                                            publicUserLoggedinContent
                                                          ],
                                                          () => {
                                                            checkLibrary(
                                                              anotherUser.restContext,
                                                              loggedinUser.user.id,
                                                              true,
                                                              [
                                                                loggedinUserPublicContent,
                                                                loggedinUserLoggedinContent
                                                              ],
                                                              () => {
                                                                checkLibrary(
                                                                  anotherUser.restContext,
                                                                  privateUser.user.id,
                                                                  false,
                                                                  [],
                                                                  () => {
                                                                    // A loggedin user on *another* tenant can only see the public stream for the public user.
                                                                    TestsUtil.generateTestUsers(
                                                                      gtAdminRestCtx,
                                                                      1,
                                                                      (err, users) => {
                                                                        const {
                                                                          0: otherTenantUser
                                                                        } = _.values(users);
                                                                        checkLibrary(
                                                                          otherTenantUser.restContext,
                                                                          publicUser.user.id,
                                                                          true,
                                                                          [publicUserPublicContent],
                                                                          () => {
                                                                            checkLibrary(
                                                                              otherTenantUser.restContext,
                                                                              loggedinUser.user.id,
                                                                              false,
                                                                              [],
                                                                              () => {
                                                                                checkLibrary(
                                                                                  otherTenantUser.restContext,
                                                                                  privateUser.user
                                                                                    .id,
                                                                                  false,
                                                                                  [],
                                                                                  () => {
                                                                                    // The cambridge tenant admin can see all the things.
                                                                                    checkLibrary(
                                                                                      camAdminRestCtx,
                                                                                      publicUser
                                                                                        .user.id,
                                                                                      true,
                                                                                      [
                                                                                        publicUserPublicContent,
                                                                                        publicUserLoggedinContent,
                                                                                        publicUserPrivateContent
                                                                                      ],
                                                                                      () => {
                                                                                        checkLibrary(
                                                                                          camAdminRestCtx,
                                                                                          loggedinUser
                                                                                            .user
                                                                                            .id,
                                                                                          true,
                                                                                          [
                                                                                            loggedinUserPublicContent,
                                                                                            loggedinUserLoggedinContent,
                                                                                            loggedinUserPrivateContent
                                                                                          ],
                                                                                          () => {
                                                                                            checkLibrary(
                                                                                              camAdminRestCtx,
                                                                                              privateUser
                                                                                                .user
                                                                                                .id,
                                                                                              true,
                                                                                              [
                                                                                                privateUserPublicContent,
                                                                                                privateUserLoggedinContent,
                                                                                                privateUserPrivateContent
                                                                                              ],
                                                                                              () => {
                                                                                                // The GT tenant admin can only see the public stream for the public user.
                                                                                                checkLibrary(
                                                                                                  gtAdminRestCtx,
                                                                                                  publicUser
                                                                                                    .user
                                                                                                    .id,
                                                                                                  true,
                                                                                                  [
                                                                                                    publicUserPublicContent
                                                                                                  ],
                                                                                                  () => {
                                                                                                    checkLibrary(
                                                                                                      gtAdminRestCtx,
                                                                                                      loggedinUser
                                                                                                        .user
                                                                                                        .id,
                                                                                                      false,
                                                                                                      [],
                                                                                                      () => {
                                                                                                        checkLibrary(
                                                                                                          gtAdminRestCtx,
                                                                                                          privateUser
                                                                                                            .user
                                                                                                            .id,
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

  /**
   * A testcase that the correct library stream is returned for a group.
   */
  it('verify group libraries', callback => {
    // Create three groups: private, loggedin, public
    TestsUtil.generateTestUsers(camAdminRestCtx, 3, (err, users) => {
      assert.ok(!err);
      const { 0: groupCreator } = _.values(users);
      const { 1: anotherUser } = _.values(users);
      createGroupAndLibrary(
        groupCreator.restContext,
        'private',
        (
          privateJoinableGroup,
          privateGroupPrivateContent,
          privateGroupLoggedinContent,
          privateGroupPublicContent
        ) => {
          createGroupAndLibrary(
            groupCreator.restContext,
            'loggedin',
            (
              loggedinJoinableGroup,
              loggedinGroupPrivateContent,
              loggedinGroupLoggedinContent,
              loggedinGroupPublicContent
            ) => {
              createGroupAndLibrary(
                groupCreator.restContext,
                'public',
                (
                  publicGroup,
                  publicGroupPrivateContent,
                  publicGroupLoggedinContent,
                  publicGroupPublicContent
                ) => {
                  // An anonymous user can only see the public stream for the public group.
                  checkLibrary(
                    camAnonymousRestCtx,
                    publicGroup.id,
                    true,
                    [publicGroupPublicContent],
                    () => {
                      checkLibrary(camAnonymousRestCtx, loggedinJoinableGroup.id, false, [], () => {
                        checkLibrary(
                          camAnonymousRestCtx,
                          privateJoinableGroup.id,
                          false,
                          [],
                          () => {
                            checkLibrary(
                              gtAnonymousRestCtx,
                              publicGroup.id,
                              true,
                              [publicGroupPublicContent],
                              () => {
                                checkLibrary(
                                  gtAnonymousRestCtx,
                                  loggedinJoinableGroup.id,
                                  false,
                                  [],
                                  () => {
                                    checkLibrary(
                                      gtAnonymousRestCtx,
                                      privateJoinableGroup.id,
                                      false,
                                      [],
                                      () => {
                                        // A loggedin user on the same tenant can see the loggedin stream for the public and loggedin group.
                                        checkLibrary(
                                          anotherUser.restContext,
                                          publicGroup.id,
                                          true,
                                          [publicGroupPublicContent, publicGroupLoggedinContent],
                                          () => {
                                            checkLibrary(
                                              anotherUser.restContext,
                                              loggedinJoinableGroup.id,
                                              true,
                                              [
                                                loggedinGroupPublicContent,
                                                loggedinGroupLoggedinContent
                                              ],
                                              () => {
                                                checkLibrary(
                                                  anotherUser.restContext,
                                                  privateJoinableGroup.id,
                                                  false,
                                                  [],
                                                  () => {
                                                    // A loggedin user on *another* tenant can only see the public stream for the public group.
                                                    TestsUtil.generateTestUsers(
                                                      gtAdminRestCtx,
                                                      1,
                                                      (err, users) => {
                                                        const { 0: otherTenantUser } = _.values(
                                                          users
                                                        );
                                                        checkLibrary(
                                                          otherTenantUser.restContext,
                                                          publicGroup.id,
                                                          true,
                                                          [publicGroupPublicContent],
                                                          () => {
                                                            checkLibrary(
                                                              otherTenantUser.restContext,
                                                              loggedinJoinableGroup.id,
                                                              false,
                                                              [],
                                                              () => {
                                                                checkLibrary(
                                                                  otherTenantUser.restContext,
                                                                  privateJoinableGroup.id,
                                                                  false,
                                                                  [],
                                                                  () => {
                                                                    // The cambridge tenant admin can see all the things.
                                                                    checkLibrary(
                                                                      camAdminRestCtx,
                                                                      publicGroup.id,
                                                                      true,
                                                                      [
                                                                        publicGroupPublicContent,
                                                                        publicGroupLoggedinContent,
                                                                        publicGroupPrivateContent
                                                                      ],
                                                                      () => {
                                                                        checkLibrary(
                                                                          camAdminRestCtx,
                                                                          loggedinJoinableGroup.id,
                                                                          true,
                                                                          [
                                                                            loggedinGroupPublicContent,
                                                                            loggedinGroupLoggedinContent,
                                                                            loggedinGroupPrivateContent
                                                                          ],
                                                                          () => {
                                                                            checkLibrary(
                                                                              camAdminRestCtx,
                                                                              privateJoinableGroup.id,
                                                                              true,
                                                                              [
                                                                                privateGroupPrivateContent,
                                                                                privateGroupLoggedinContent,
                                                                                privateGroupPrivateContent
                                                                              ],
                                                                              () => {
                                                                                // The GT tenant admin can only see the public stream for the public group.
                                                                                checkLibrary(
                                                                                  gtAdminRestCtx,
                                                                                  publicGroup.id,
                                                                                  true,
                                                                                  [
                                                                                    publicGroupPublicContent
                                                                                  ],
                                                                                  () => {
                                                                                    checkLibrary(
                                                                                      gtAdminRestCtx,
                                                                                      loggedinJoinableGroup.id,
                                                                                      false,
                                                                                      [],
                                                                                      () => {
                                                                                        checkLibrary(
                                                                                          gtAdminRestCtx,
                                                                                          privateJoinableGroup.id,
                                                                                          false,
                                                                                          [],
                                                                                          () => {
                                                                                            // If we make the cambridge user a member of the private group he should see everything.
                                                                                            let changes = {};
                                                                                            changes[
                                                                                              anotherUser.user.id
                                                                                            ] =
                                                                                              'member';
                                                                                            RestAPI.Group.setGroupMembers(
                                                                                              groupCreator.restContext,
                                                                                              privateJoinableGroup.id,
                                                                                              changes,
                                                                                              err => {
                                                                                                assert.ok(
                                                                                                  !err
                                                                                                );
                                                                                                checkLibrary(
                                                                                                  anotherUser.restContext,
                                                                                                  privateJoinableGroup.id,
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
                                                                                                    ] =
                                                                                                      'member';
                                                                                                    RestAPI.Group.setGroupMembers(
                                                                                                      groupCreator.restContext,
                                                                                                      privateJoinableGroup.id,
                                                                                                      changes,
                                                                                                      err => {
                                                                                                        assert.ok(
                                                                                                          !err
                                                                                                        );
                                                                                                        checkLibrary(
                                                                                                          otherTenantUser.restContext,
                                                                                                          privateJoinableGroup.id,
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
   * Test that verifies that a library can be rebuilt from a dirty authz table
   */
  it('verify a library can be rebuilt from a dirty authz table', callback => {
    createUserAndLibrary(
      camAdminRestCtx,
      'private',
      (simong, privateContent, loggedinContent, publicContent) => {
        // Ensure all the items are in the user's library
        checkLibrary(
          simong.restContext,
          simong.user.id,
          true,
          [privateContent, loggedinContent, publicContent],
          () => {
            // Remove a content item directly in Cassandra. This will leave a pointer
            // in the Authz table that points to nothing. The library re-indexer should
            // be able to deal with this. Note that we go straight to Cassandra, as the
            // ContentDAO also takes care of removing the item from the appropriate libraries
            Cassandra.runQuery(
              'DELETE FROM "Content" WHERE "contentId" = ?',
              [privateContent.id],
              err => {
                assert.ok(!err);

                // Purge the library so that it has to be rebuild on the next request
                LibraryAPI.Index.purge('content:content', simong.user.id, err => {
                  assert.ok(!err);

                  // We should be able to rebuild the library on-the-fly. The private
                  // content item should not be returned as it has been removed
                  checkLibrary(
                    simong.restContext,
                    simong.user.id,
                    true,
                    [loggedinContent, publicContent],
                    callback
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
