import { assert } from 'chai';
import { describe, beforeEach, it } from 'mocha';
import { forEach, filter, propSatisfies, equals } from 'ramda';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

describe('Meeting libraries', () => {
  let asCambridgeAnonymousUser = null;
  let asCambridgeTenantAdmin = null;
  let asGeorgiaTenantAdmin = null;

  beforeEach(() => {
    asCambridgeAnonymousUser = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    asGeorgiaTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
  });

  /**
   * Creates an user and fills his library with meeting items.
   *
   * @param  {RestContext}    restCtx                         The context with which to create the user and content
   * @param  {String}         userVisibility                  The visibility for the new user
   * @param  {Function}       callback                        Standard callback function
   * @param  {User}           callback.user                   The created user
   * @param  {Meeting}        callback.privateMeeting         The private meeting
   * @param  {Meeting}        callback.loggedinMeeting        The loggedin meeting
   * @param  {Meeting}        callback.publicMeeting          The public meeting
   */
  const createUserAndLibrary = function (restCtx, userVisibility, callback) {
    // Create an user with the proper visibility
    TestsUtil.generateTestUsers(restCtx, 1, (error, users) => {
      assert.notExists(error);
      const { 0: user } = users;
      RestAPI.User.updateUser(user.restContext, user.user.id, { visibility: userVisibility }, (error_) => {
        assert.notExists(error_);

        // Fill up the user library with 3 meeting items
        RestAPI.MeetingsJitsi.createMeeting(
          user.restContext,
          'name',
          'description',
          false,
          false,
          'private',
          null,
          null,
          (error, privateMeeting) => {
            assert.notExists(error);

            RestAPI.MeetingsJitsi.createMeeting(
              user.restContext,
              'name',
              'description',
              false,
              false,
              'loggedin',
              null,
              null,
              (error, loggedinMeeting) => {
                assert.notExists(error);

                RestAPI.MeetingsJitsi.createMeeting(
                  user.restContext,
                  'name',
                  'description',
                  false,
                  false,
                  'public',
                  null,
                  null,
                  (error, publicMeeting) => {
                    assert.notExists(error);

                    return callback(user, privateMeeting, loggedinMeeting, publicMeeting);
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
   * Creates a group and fills its library with meeting items.
   *
   * @param  {RestContext}    restCtx                         The context with which to create the user and content
   * @param  {String}         groupLibrary                    The visibility for the new group
   * @param  {Function}       callback                        Standard callback function
   * @param  {User}           callback.user                   The created user
   * @param  {Meeting}        callback.privateMeeting         The private meeting
   * @param  {Meeting}        callback.loggedinMeeting        The loggedin meeting
   * @param  {Meeting}        callback.publicMeeting          The public meeting
   */
  const createGroupAndLibrary = function (restCtx, groupVisibility, callback) {
    RestAPI.Group.createGroup(restCtx, 'displayName', 'description', groupVisibility, 'no', [], [], (error, group) => {
      assert.notExists(error);

      // Fill up the group library with 3 meeting items
      RestAPI.MeetingsJitsi.createMeeting(
        restCtx,
        'name',
        'description',
        false,
        false,
        'private',
        [group.id],
        null,
        (error, privateMeeting) => {
          assert.notExists(error);

          RestAPI.MeetingsJitsi.createMeeting(
            restCtx,
            'name',
            'description',
            false,
            false,
            'loggedin',
            [group.id],
            null,
            (error, loggedinMeeting) => {
              assert.notExists(error);

              RestAPI.MeetingsJitsi.createMeeting(
                restCtx,
                'name',
                'description',
                false,
                false,
                'public',
                [group.id],
                null,
                (error, publicMeeting) => {
                  assert.notExists(error);

                  return callback(group, privateMeeting, loggedinMeeting, publicMeeting);
                }
              );
            }
          );
        }
      );
    });
  };

  /**
   * Checks a principal library.
   *
   * @param  {RestContext}    restCtx             The context to use to do the request
   * @param  {String}         libraryOwnerId      The principal for which to retrieve the library
   * @param  {Boolean}        expectAccess        Whether or not retrieving the library should be successfull
   * @param  {Meeting[]}      expectedItems       The expected meetings that should return
   * @param  {Function}       callback            Standard callback function
   */
  const checkLibrary = function (restCtx, libraryOwnerId, expectAccess, expectedItems, callback) {
    RestAPI.MeetingsJitsi.getMeetingsLibrary(restCtx, libraryOwnerId, (error, items) => {
      if (expectAccess) {
        assert.notExists(error);

        // Make sure only the exptected items are returned
        assert.strictEqual(items.results.length, expectedItems.length);
        forEach((expectedMeeting) => {
          assert.ok(filter(propSatisfies(equals(expectedMeeting.id), 'id'), items.results));
        }, expectedItems);
      } else {
        assert.strictEqual(error.code, 401);
        assert.ok(!items);
      }

      return callback();
    });
  };

  describe('User libraries', () => {
    const users = {};

    beforeEach((callback) => {
      createUserAndLibrary(
        asCambridgeTenantAdmin,
        'private',
        (user, privateMeeting, loggedinMeeting, publicMeeting) => {
          users.private = {
            user,
            privateMeeting,
            loggedinMeeting,
            publicMeeting
          };

          createUserAndLibrary(
            asCambridgeTenantAdmin,
            'loggedin',
            (user, privateMeeting, loggedinMeeting, publicMeeting) => {
              users.loggedin = {
                user,
                privateMeeting,
                loggedinMeeting,
                publicMeeting
              };

              createUserAndLibrary(
                asCambridgeTenantAdmin,
                'public',
                (user, privateMeeting, loggedinMeeting, publicMeeting) => {
                  users.public = {
                    user,
                    privateMeeting,
                    loggedinMeeting,
                    publicMeeting
                  };

                  return callback();
                }
              );
            }
          );
        }
      );
    });

    it('should only send the public stream of public users for an anonymous user', (callback) => {
      checkLibrary(asCambridgeAnonymousUser, users.public.user.user.id, true, [users.public.publicMeeting], () => {
        checkLibrary(asCambridgeAnonymousUser, users.loggedin.user.user.id, false, [], () => {
          checkLibrary(asCambridgeAnonymousUser, users.private.user.user.id, false, [], () => {
            return callback();
          });
        });
      });
    });

    it('should only send the loggedin stream of public and loggedin users for a loggedin user on the same tenant', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, myUsers) => {
        assert.notExists(error);
        const { 0: anotherUser } = myUsers;

        checkLibrary(
          anotherUser.restContext,
          users.public.user.user.id,
          true,
          [users.public.publicMeeting, users.public.loggedinMeeting],
          () => {
            checkLibrary(
              anotherUser.restContext,
              users.loggedin.user.user.id,
              true,
              [users.loggedin.publicMeeting, users.loggedin.loggedinMeeting],
              () => {
                checkLibrary(anotherUser.restContext, users.private.user.user.id, false, [], () => {
                  return callback();
                });
              }
            );
          }
        );
      });
    });

    it('should only send the public stream of public users for a loggedin user on *another* tenant', (callback) => {
      TestsUtil.generateTestUsers(asGeorgiaTenantAdmin, 1, (error, myUsers) => {
        assert.notExists(error);
        const { 0: otherTenantUser } = myUsers;

        checkLibrary(otherTenantUser.restContext, users.public.user.user.id, true, [users.public.publicMeeting], () => {
          checkLibrary(otherTenantUser.restContext, users.loggedin.user.user.id, false, [], () => {
            checkLibrary(otherTenantUser.restContext, users.private.user.user.id, false, [], () => {
              return callback();
            });
          });
        });
      });
    });

    it('should send all the meeting library items for the owner of the library', (callback) => {
      checkLibrary(
        users.private.user.restContext,
        users.private.user.user.id,
        true,
        [users.private.privateMeeting, users.private.loggedinMeeting, users.private.publicMeeting],
        () => {
          checkLibrary(
            users.loggedin.user.restContext,
            users.loggedin.user.user.id,
            true,
            [users.loggedin.privateMeeting, users.loggedin.loggedinMeeting, users.loggedin.publicMeeting],
            () => {
              checkLibrary(
                users.public.user.restContext,
                users.public.user.user.id,
                true,
                [users.public.privateMeeting, users.public.loggedinMeeting, users.public.publicMeeting],
                () => {
                  return callback();
                }
              );
            }
          );
        }
      );
    });

    it('should properly add the meeting to the user meeting library when the user gains access to the meeting', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: nicolaas } = users;

        // Create a meeting as mrvisser
        RestAPI.MeetingsJitsi.createMeeting(
          mrvisser.restContext,
          'name',
          'descr',
          false,
          false,
          'public',
          null,
          null,
          (error, meeting) => {
            assert.notExists(error);

            // Seed mrvisser's and nicolaas's meeting libraries to ensure it does not get built from scratch
            RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, mrvisser.user.id, (error_) => {
              assert.notExists(error_);

              RestAPI.MeetingsJitsi.getMeetingsLibrary(nicolaas.restContext, nicolaas.user.id, (error_) => {
                assert.notExists(error_);

                // Make nicolaas a member of the meeting
                const updates = {};
                updates[nicolaas.user.id] = 'member';

                RestAPI.MeetingsJitsi.updateMembers(mrvisser.restContext, meeting.id, updates, (error_) => {
                  assert.notExists(error_);

                  // Ensure the meeting is still in mrvisser's and nicolaas's meeting libraries
                  RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, mrvisser.user.id, (error, result) => {
                    assert.notExists(error);
                    let libraryEntry = result.results[0];
                    assert.ok(libraryEntry);
                    assert.strictEqual(libraryEntry.id, meeting.id);

                    RestAPI.MeetingsJitsi.getMeetingsLibrary(
                      nicolaas.restContext,
                      nicolaas.user.id,
                      (error, result) => {
                        assert.notExists(error);
                        libraryEntry = result.results[0];
                        assert.ok(libraryEntry);
                        assert.strictEqual(libraryEntry.id, meeting.id);

                        return callback();
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

  describe('Group libraries', () => {
    const groups = {};

    beforeEach((callback) => {
      createGroupAndLibrary(
        asCambridgeTenantAdmin,
        'private',
        (group, privateMeeting, loggedinMeeting, publicMeeting) => {
          groups.private = {
            group,
            privateMeeting,
            loggedinMeeting,
            publicMeeting
          };

          createGroupAndLibrary(
            asCambridgeTenantAdmin,
            'loggedin',
            (group, privateMeeting, loggedinMeeting, publicMeeting) => {
              groups.loggedin = {
                group,
                privateMeeting,
                loggedinMeeting,
                publicMeeting
              };

              createGroupAndLibrary(
                asCambridgeTenantAdmin,
                'public',
                (group, privateMeeting, loggedinMeeting, publicMeeting) => {
                  groups.public = {
                    group,
                    privateMeeting,
                    loggedinMeeting,
                    publicMeeting
                  };

                  return callback();
                }
              );
            }
          );
        }
      );
    });

    it('should only send the public stream of public groups for an anonymous user', (callback) => {
      checkLibrary(asCambridgeAnonymousUser, groups.public.group.id, true, [groups.public.publicMeeting], () => {
        checkLibrary(asCambridgeAnonymousUser, groups.loggedin.group.id, false, [], () => {
          checkLibrary(asCambridgeAnonymousUser, groups.private.group.id, false, [], () => {
            return callback();
          });
        });
      });
    });

    it('should only send the loggedin stream of public and loggedin groups for a loggedin user on the same tenant', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: anotherUser } = users;

        checkLibrary(
          anotherUser.restContext,
          groups.public.group.id,
          true,
          [groups.public.publicMeeting, groups.public.loggedinMeeting],
          () => {
            checkLibrary(
              anotherUser.restContext,
              groups.loggedin.group.id,
              true,
              [groups.loggedin.publicMeeting, groups.loggedin.loggedinMeeting],
              () => {
                checkLibrary(anotherUser.restContext, groups.private.group.id, false, [], () => {
                  return callback();
                });
              }
            );
          }
        );
      });
    });

    it('should only send the public stream of public groups for a loggedin user on *another* tenant', (callback) => {
      TestsUtil.generateTestUsers(asGeorgiaTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: anotherTenantUser } = users;

        checkLibrary(anotherTenantUser.restContext, groups.public.group.id, true, [groups.public.publicMeeting], () => {
          checkLibrary(anotherTenantUser.restContext, groups.loggedin.group.id, false, [], () => {
            checkLibrary(anotherTenantUser.restContext, groups.private.group.id, false, [], () => {
              return callback();
            });
          });
        });
      });
    });

    it('should send all the meeting library items for a member of the group', (callback) => {
      checkLibrary(
        asCambridgeTenantAdmin,
        groups.public.group.id,
        true,
        [groups.public.publicMeeting, groups.public.loggedinMeeting, groups.public.privateMeeting],
        () => {
          checkLibrary(
            asCambridgeTenantAdmin,
            groups.loggedin.group.id,
            true,
            [groups.loggedin.publicMeeting, groups.loggedin.loggedinMeeting, groups.loggedin.privateMeeting],
            () => {
              checkLibrary(
                asCambridgeTenantAdmin,
                groups.private.group.id,
                true,
                [groups.private.publicMeeting, groups.private.loggedinMeeting, groups.private.privateMeeting],
                () => {
                  return callback();
                }
              );
            }
          );
        }
      );
    });

    it('should add the meeting to the group meeting library when the group has been added to the meeting', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        // Create a group to play with
        RestAPI.Group.createGroup(
          mrvisser.restContext,
          'displayName',
          'description',
          'private',
          'no',
          [],
          [],
          (error, group) => {
            assert.notExists(error);
            // Create a meeting as mrvisser
            RestAPI.MeetingsJitsi.createMeeting(
              mrvisser.restContext,
              'name',
              'descr',
              false,
              false,
              'public',
              null,
              null,
              (error, meeting) => {
                assert.notExists(error);

                // Seed mrvisser's and the group's meeting libraries to ensure it does not get built from scratch
                RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, mrvisser.user.id, (error_) => {
                  assert.notExists(error_);

                  RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, group.id, (error_) => {
                    assert.notExists(error_);

                    // Make the group a member of the meeting
                    const updates = {};
                    updates[group.id] = 'member';

                    RestAPI.MeetingsJitsi.updateMembers(mrvisser.restContext, meeting.id, updates, (error_) => {
                      assert.notExists(error_);

                      // Ensure the meeting is still in mrvisser's and the group's meeting libraries
                      RestAPI.MeetingsJitsi.getMeetingsLibrary(
                        mrvisser.restContext,
                        mrvisser.user.id,
                        (error, result) => {
                          assert.notExists(error);
                          let libraryEntry = result.results[0];
                          assert.ok(libraryEntry);
                          assert.strictEqual(libraryEntry.id, meeting.id);

                          RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, group.id, (error, result) => {
                            assert.notExists(error);
                            libraryEntry = result.results[0];
                            assert.ok(libraryEntry);
                            assert.strictEqual(libraryEntry.id, meeting.id);

                            return callback();
                          });
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
  });
});
