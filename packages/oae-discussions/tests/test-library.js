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

/* esling-disable no-unused-vars */
import { assert } from 'chai';
import { describe, beforeEach, it } from 'mocha';
import _ from 'underscore';

import * as LibraryAPI from 'oae-library';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as DiscussionsDAO from 'oae-discussions/lib/internal/dao';
import * as DiscussionsTestUtil from 'oae-discussions/lib/test/util';

describe('Discussion libraries', () => {
  /**
   * Checks a principal library.
   *
   * @param  {RestContext}    restCtx         The context to use to do the request
   * @param  {String}         libraryOwnerId  The principal for which to retrieve the library
   * @param  {Boolean}        expectAccess    Whether or not retrieving the library should be successfull
   * @param  {Discussion[]}   expectedItems   The expected discussions that should return
   * @param  {Function}       callback        Standard callback function
   */
  const checkLibrary = function (restCtx, libraryOwnerId, expectAccess, expectedItems, callback) {
    RestAPI.Discussions.getDiscussionsLibrary(restCtx, libraryOwnerId, null, null, (error, items) => {
      if (expectAccess) {
        assert.notExists(error);

        // Make sure only the expected items are returned.
        assert.strictEqual(items.results.length, expectedItems.length);
        _.each(expectedItems, (expectedDiscussion) => {
          assert.ok(
            _.filter(items.results, (discussion) => {
              return discussion.id === expectedDiscussion.id;
            })
          );
        });
      } else {
        assert.strictEqual(error.code, 401);
        assert.ok(!items);
      }

      callback();
    });
  };

  /**
   * Creates a user and fills his library with discussion items.
   *
   * @param  {RestContext}    restCtx                         The context with which to create the user and content
   * @param  {String}         userVisibility                  The visibility for the new user
   * @param  {Function}       callback                        Standard callback function
   * @param  {User}           callback.user                   The created user
   * @param  {Discussion}     callback.privateDiscussion      The private discussion
   * @param  {Discussion}     callback.loggedinDiscussion     The loggedin discussion
   * @param  {Discussion}     callback.publicDiscussion       The public discussion
   */
  const createUserAndLibrary = function (restCtx, userVisibility, callback) {
    // Create a user with the proper visibility
    TestsUtil.generateTestUsers(restCtx, 1, (error, users) => {
      assert.notExists(error);

      const { 0: user } = users;

      RestAPI.User.updateUser(user.restContext, user.user.id, { visibility: userVisibility }, (error_) => {
        assert.notExists(error_);

        // Fill up this user his library with 3 discussion items.
        RestAPI.Discussions.createDiscussion(
          user.restContext,
          'name',
          'description',
          'private',
          null,
          null,
          (error, privateDiscussion) => {
            assert.notExists(error);
            RestAPI.Discussions.createDiscussion(
              user.restContext,
              'name',
              'description',
              'loggedin',
              null,
              null,
              (error, loggedinDiscussion) => {
                assert.notExists(error);
                RestAPI.Discussions.createDiscussion(
                  user.restContext,
                  'name',
                  'description',
                  'public',
                  null,
                  null,
                  (error, publicDiscussion) => {
                    assert.notExists(error);
                    callback(user, privateDiscussion, loggedinDiscussion, publicDiscussion);
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
   * Creates a group with the supplied visibility and fill its library with 3 discussions.
   *
   * @param  {RestContext}    restCtx                         The context with which to create the group and discusion
   * @param  {String}         groupVisibility                 The visibility for the new group
   * @param  {Function}       callback                        Standard callback function
   * @param  {Group}          callback.group                  The created group
   * @param  {Discussion}     callback.privateDiscussion      The private discussion
   * @param  {Discussion}     callback.loggedinDiscussion     The loggedin discussion
   * @param  {Discussion}     callback.publicDiscussion       The public discussion
   */
  const createGroupAndLibrary = function (restCtx, groupVisibility, callback) {
    RestAPI.Group.createGroup(restCtx, 'displayName', 'description', groupVisibility, 'no', [], [], (error, group) => {
      assert.notExists(error);

      // Fill up the group library with 3 discussion items.
      RestAPI.Discussions.createDiscussion(
        restCtx,
        'name',
        'description',
        'private',
        [group.id],
        null,
        (error, privateDiscussion) => {
          assert.notExists(error);
          RestAPI.Discussions.createDiscussion(
            restCtx,
            'name',
            'description',
            'loggedin',
            [group.id],
            null,
            (error, loggedinDiscussion) => {
              assert.notExists(error);
              RestAPI.Discussions.createDiscussion(
                restCtx,
                'name',
                'description',
                'public',
                [group.id],
                null,
                (error, publicDiscussion) => {
                  assert.notExists(error);
                  callback(group, privateDiscussion, loggedinDiscussion, publicDiscussion);
                }
              );
            }
          );
        }
      );
    });
  };

  let camAnonymousRestCtx = null;
  let camAdminRestCtx = null;
  let gtAnonymousRestCtx = null;
  let gtAdminRestCtx = null;

  beforeEach(() => {
    camAnonymousRestCtx = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAnonymousRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    gtAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
  });

  /**
   * A testcase that the correct library stream is returned and the library user's visibility
   * settings are respected.
   */
  it('verify user libraries', (callback) => {
    // We'll create a private, loggedin and public user, each user's library will contain a private, loggedin and public discussion item.
    createUserAndLibrary(
      camAdminRestCtx,
      'private',
      (privateUser, privateUserPrivateDiscussion, privateUserLoggedinDiscussion, privateUserPublicDiscussion) => {
        createUserAndLibrary(
          camAdminRestCtx,
          'loggedin',
          (
            loggedinUser,
            loggedinUserPrivateDiscussion,
            loggedinUserLoggedinDiscussion,
            loggedinUserPublicDiscussion
          ) => {
            createUserAndLibrary(
              camAdminRestCtx,
              'public',
              (publicUser, publicUserPrivateDiscussion, publicUserLoggedinDiscussion, publicUserPublicDiscussion) => {
                // Each user should be able to see all the items in his library.
                checkLibrary(
                  privateUser.restContext,
                  privateUser.user.id,
                  true,
                  [privateUserPublicDiscussion, privateUserLoggedinDiscussion, privateUserPrivateDiscussion],
                  () => {
                    checkLibrary(
                      loggedinUser.restContext,
                      loggedinUser.user.id,
                      true,
                      [loggedinUserPublicDiscussion, loggedinUserLoggedinDiscussion, loggedinUserPrivateDiscussion],
                      () => {
                        checkLibrary(
                          publicUser.restContext,
                          publicUser.user.id,
                          true,
                          [publicUserPublicDiscussion, publicUserLoggedinDiscussion, publicUserPrivateDiscussion],
                          () => {
                            // The anonymous user can only see the public stream of the public user.
                            checkLibrary(
                              camAnonymousRestCtx,
                              publicUser.user.id,
                              true,
                              [publicUserPublicDiscussion],
                              () => {
                                checkLibrary(camAnonymousRestCtx, loggedinUser.user.id, false, [], () => {
                                  checkLibrary(camAnonymousRestCtx, privateUser.user.id, false, [], () => {
                                    checkLibrary(
                                      gtAnonymousRestCtx,
                                      publicUser.user.id,
                                      true,
                                      [publicUserPublicDiscussion],
                                      () => {
                                        checkLibrary(gtAnonymousRestCtx, loggedinUser.user.id, false, [], () => {
                                          checkLibrary(gtAnonymousRestCtx, privateUser.user.id, false, [], () => {
                                            // A loggedin user on the same tenant can see the loggedin stream for the public and loggedin user.
                                            TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
                                              assert.notExists(error);
                                              const { 0: anotherUser } = users;
                                              checkLibrary(
                                                anotherUser.restContext,
                                                publicUser.user.id,
                                                true,
                                                [publicUserPublicDiscussion, publicUserLoggedinDiscussion],
                                                () => {
                                                  checkLibrary(
                                                    anotherUser.restContext,
                                                    loggedinUser.user.id,
                                                    true,
                                                    [loggedinUserPublicDiscussion, loggedinUserLoggedinDiscussion],
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
                                                            (error, users) => {
                                                              assert.notExists(error);

                                                              const { 0: otherTenantUser } = users;
                                                              checkLibrary(
                                                                otherTenantUser.restContext,
                                                                publicUser.user.id,
                                                                true,
                                                                [publicUserPublicDiscussion],
                                                                () => {
                                                                  checkLibrary(
                                                                    otherTenantUser.restContext,
                                                                    loggedinUser.user.id,
                                                                    false,
                                                                    [],
                                                                    () => {
                                                                      checkLibrary(
                                                                        otherTenantUser.restContext,
                                                                        privateUser.user.id,
                                                                        false,
                                                                        [],
                                                                        () => {
                                                                          // The cambridge tenant admin can see all the things.
                                                                          checkLibrary(
                                                                            camAdminRestCtx,
                                                                            publicUser.user.id,
                                                                            true,
                                                                            [
                                                                              publicUserPublicDiscussion,
                                                                              publicUserLoggedinDiscussion,
                                                                              publicUserPrivateDiscussion
                                                                            ],
                                                                            () => {
                                                                              checkLibrary(
                                                                                camAdminRestCtx,
                                                                                loggedinUser.user.id,
                                                                                true,
                                                                                [
                                                                                  loggedinUserPublicDiscussion,
                                                                                  loggedinUserLoggedinDiscussion,
                                                                                  loggedinUserPrivateDiscussion
                                                                                ],
                                                                                () => {
                                                                                  checkLibrary(
                                                                                    camAdminRestCtx,
                                                                                    privateUser.user.id,
                                                                                    true,
                                                                                    [
                                                                                      privateUserPublicDiscussion,
                                                                                      privateUserLoggedinDiscussion,
                                                                                      privateUserPrivateDiscussion
                                                                                    ],
                                                                                    () => {
                                                                                      // The GT tenant admin can only see the public stream for the public user.
                                                                                      checkLibrary(
                                                                                        gtAdminRestCtx,
                                                                                        publicUser.user.id,
                                                                                        true,
                                                                                        [publicUserPublicDiscussion],
                                                                                        () => {
                                                                                          checkLibrary(
                                                                                            gtAdminRestCtx,
                                                                                            loggedinUser.user.id,
                                                                                            false,
                                                                                            [],
                                                                                            () => {
                                                                                              checkLibrary(
                                                                                                gtAdminRestCtx,
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
    TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
      assert.notExists(error);
      const { 0: groupCreator, 1: anotherUser } = users;
      createGroupAndLibrary(groupCreator.restContext, 'private', (
        privateGroup,
        privateGroupPrivateDiscussion,
        privateGroupLoggedinDiscussion /* , privateGroupPublicDiscussion */
      ) => {
        createGroupAndLibrary(
          groupCreator.restContext,
          'loggedin',
          (
            loggedinGroup,
            loggedinGroupPrivateDiscussion,
            loggedinGroupLoggedinDiscussion,
            loggedinGroupPublicDiscussion
          ) => {
            createGroupAndLibrary(
              groupCreator.restContext,
              'public',
              (
                publicGroup,
                publicGroupPrivateDiscussion,
                publicGroupLoggedinDiscussion,
                publicGroupPublicDiscussion
              ) => {
                // An anonymous user can only see the public stream for the public group.
                checkLibrary(camAnonymousRestCtx, publicGroup.id, true, [publicGroupPublicDiscussion], () => {
                  checkLibrary(camAnonymousRestCtx, loggedinGroup.id, false, [], () => {
                    checkLibrary(camAnonymousRestCtx, privateGroup.id, false, [], () => {
                      checkLibrary(gtAnonymousRestCtx, publicGroup.id, true, [publicGroupPublicDiscussion], () => {
                        checkLibrary(gtAnonymousRestCtx, loggedinGroup.id, false, [], () => {
                          checkLibrary(gtAnonymousRestCtx, privateGroup.id, false, [], () => {
                            // A loggedin user on the same tenant can see the loggedin stream for the public and loggedin group.
                            checkLibrary(
                              anotherUser.restContext,
                              publicGroup.id,
                              true,
                              [publicGroupPublicDiscussion, publicGroupLoggedinDiscussion],
                              () => {
                                checkLibrary(
                                  anotherUser.restContext,
                                  loggedinGroup.id,
                                  true,
                                  [loggedinGroupPublicDiscussion, loggedinGroupLoggedinDiscussion],
                                  () => {
                                    checkLibrary(anotherUser.restContext, privateGroup.id, false, [], () => {
                                      // A loggedin user on *another* tenant can only see the public stream for the public user.
                                      TestsUtil.generateTestUsers(gtAdminRestCtx, 1, (error, users) => {
                                        assert.notExists(error);

                                        const { 0: otherTenantUser } = users;
                                        checkLibrary(
                                          otherTenantUser.restContext,
                                          publicGroup.id,
                                          true,
                                          [publicGroupPublicDiscussion],
                                          () => {
                                            checkLibrary(
                                              otherTenantUser.restContext,
                                              loggedinGroup.id,
                                              false,
                                              [],
                                              () => {
                                                checkLibrary(
                                                  otherTenantUser.restContext,
                                                  privateGroup.id,
                                                  false,
                                                  [],
                                                  () => {
                                                    // The cambridge tenant admin can see all the things.
                                                    checkLibrary(
                                                      camAdminRestCtx,
                                                      publicGroup.id,
                                                      true,
                                                      [
                                                        publicGroupPublicDiscussion,
                                                        publicGroupLoggedinDiscussion,
                                                        publicGroupPrivateDiscussion
                                                      ],
                                                      () => {
                                                        checkLibrary(
                                                          camAdminRestCtx,
                                                          loggedinGroup.id,
                                                          true,
                                                          [
                                                            loggedinGroupPublicDiscussion,
                                                            loggedinGroupLoggedinDiscussion,
                                                            loggedinGroupPrivateDiscussion
                                                          ],
                                                          () => {
                                                            checkLibrary(
                                                              camAdminRestCtx,
                                                              privateGroup.id,
                                                              true,
                                                              [
                                                                privateGroupPrivateDiscussion,
                                                                privateGroupLoggedinDiscussion,
                                                                privateGroupPrivateDiscussion
                                                              ],
                                                              () => {
                                                                // The GT tenant admin can only see the public stream for the public user.
                                                                checkLibrary(
                                                                  gtAdminRestCtx,
                                                                  publicGroup.id,
                                                                  true,
                                                                  [publicGroupPublicDiscussion],
                                                                  () => {
                                                                    checkLibrary(
                                                                      gtAdminRestCtx,
                                                                      loggedinGroup.id,
                                                                      false,
                                                                      [],
                                                                      () => {
                                                                        checkLibrary(
                                                                          gtAdminRestCtx,
                                                                          privateGroup.id,
                                                                          false,
                                                                          [],
                                                                          () => {
                                                                            // If we make the cambridge user a member of the private group he should see everything.
                                                                            let changes = {};
                                                                            changes[anotherUser.user.id] = 'member';
                                                                            RestAPI.Group.setGroupMembers(
                                                                              groupCreator.restContext,
                                                                              privateGroup.id,
                                                                              changes,
                                                                              (error_) => {
                                                                                assert.notExists(error_);
                                                                                checkLibrary(
                                                                                  anotherUser.restContext,
                                                                                  privateGroup.id,
                                                                                  true,
                                                                                  [
                                                                                    privateGroupPrivateDiscussion,
                                                                                    privateGroupLoggedinDiscussion,
                                                                                    privateGroupPrivateDiscussion
                                                                                  ],
                                                                                  () => {
                                                                                    // If we make the GT user a member of the private group, he should see everything.
                                                                                    changes = {};
                                                                                    changes[otherTenantUser.user.id] =
                                                                                      'member';
                                                                                    RestAPI.Group.setGroupMembers(
                                                                                      groupCreator.restContext,
                                                                                      privateGroup.id,
                                                                                      changes,
                                                                                      (error_) => {
                                                                                        assert.notExists(error_);
                                                                                        checkLibrary(
                                                                                          otherTenantUser.restContext,
                                                                                          privateGroup.id,
                                                                                          true,
                                                                                          [
                                                                                            privateGroupPrivateDiscussion,
                                                                                            privateGroupLoggedinDiscussion,
                                                                                            privateGroupPrivateDiscussion
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
   * Test that verifies when user permissions are set on a discussion, the discussion is properly added into their library
   */
  it("verify setting permissions of discussion results in discussion showing up in the user's library", (callback) => {
    TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
      assert.notExists(error);

      const { 0: mrvisser, 1: nicolaas } = users;

      // Create a discussion as mrvisser
      RestAPI.Discussions.createDiscussion(
        mrvisser.restContext,
        'name',
        'descr',
        'public',
        null,
        null,
        (error, discussion) => {
          assert.notExists(error);

          // Seed mrvisser's and nicolaas' discussion libraries to ensure it does not get built from scratch
          RestAPI.Discussions.getDiscussionsLibrary(mrvisser.restContext, mrvisser.user.id, null, null, (
            error /* , result */
          ) => {
            assert.notExists(error);
            RestAPI.Discussions.getDiscussionsLibrary(nicolaas.restContext, nicolaas.user.id, null, null, (
              error /* , result */
            ) => {
              assert.notExists(error);

              // Make nicolaas a member of the discussion
              const memberUpdates = {};
              memberUpdates[nicolaas.user.id] = 'member';
              DiscussionsTestUtil.assertUpdateDiscussionMembersSucceeds(
                mrvisser.restContext,
                mrvisser.restContext,
                discussion.id,
                memberUpdates,
                (error_) => {
                  assert.notExists(error_);

                  // Ensure the discussion is still in mrvisser's and nicolaas' discussion libraries
                  RestAPI.Discussions.getDiscussionsLibrary(
                    mrvisser.restContext,
                    mrvisser.user.id,
                    null,
                    null,
                    (error, result) => {
                      assert.notExists(error);
                      const libraryEntry = result.results[0];
                      assert.ok(libraryEntry);
                      assert.strictEqual(libraryEntry.id, discussion.id);

                      RestAPI.Discussions.getDiscussionsLibrary(
                        nicolaas.restContext,
                        nicolaas.user.id,
                        null,
                        null,
                        (error, result) => {
                          assert.notExists(error);
                          const libraryEntry = result.results[0];
                          assert.ok(libraryEntry);
                          assert.strictEqual(libraryEntry.id, discussion.id);
                          return callback();
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

  /**
   * Test that verifies that a library can be rebuilt from a dirty authz table
   */
  it('verify a library can be rebuilt from a dirty authz table', (callback) => {
    createUserAndLibrary(
      camAdminRestCtx,
      'private',
      (simong, privateDiscussion, loggedinDiscussion, publicDiscussion) => {
        // Ensure all the items are in the user's library
        checkLibrary(
          simong.restContext,
          simong.user.id,
          true,
          [privateDiscussion, loggedinDiscussion, publicDiscussion],
          () => {
            // Remove a discussion through the DAO. This will leave a pointer
            // in the Authz table that points to nothing. The library re-indexer
            // should be able to deal with this
            DiscussionsDAO.deleteDiscussion(privateDiscussion.id, (error) => {
              assert.notExists(error);

              // Purge the library so that it has to be rebuild on the next request
              LibraryAPI.Index.purge('discussions:discussions', simong.user.id, (error) => {
                assert.notExists(error);

                // We should be able to rebuild the library on-the-fly. The private
                // discussion item should not be returned as it has been removed
                checkLibrary(
                  simong.restContext,
                  simong.user.id,
                  true,
                  [loggedinDiscussion, publicDiscussion],
                  callback
                );
              });
            });
          }
        );
      }
    );
  });
});
