import assert from 'assert';
import _ from 'underscore';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

describe('Meeting libraries', () => {
  let camAnonymousRestCtx = null;
  let camAdminRestCtx = null;
  let gtAdminRestCtx = null;

  beforeEach(() => {
    camAnonymousRestCtx = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
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
  const createUserAndLibrary = function(restCtx, userVisibility, callback) {
    // Create an user with the proper visibility
    TestsUtil.generateTestUsers(restCtx, 1, (err, users) => {
      const user = _.values(users)[0];
      RestAPI.User.updateUser(user.restContext, user.user.id, { visibility: userVisibility }, err => {
        assert.ok(!err);

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
          (err, privateMeeting) => {
            assert.ok(!err);

            RestAPI.MeetingsJitsi.createMeeting(
              user.restContext,
              'name',
              'description',
              false,
              false,
              'loggedin',
              null,
              null,
              (err, loggedinMeeting) => {
                assert.ok(!err);

                RestAPI.MeetingsJitsi.createMeeting(
                  user.restContext,
                  'name',
                  'description',
                  false,
                  false,
                  'public',
                  null,
                  null,
                  (err, publicMeeting) => {
                    assert.ok(!err);

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
  const createGroupAndLibrary = function(restCtx, groupVisibility, callback) {
    RestAPI.Group.createGroup(restCtx, 'displayName', 'description', groupVisibility, 'no', [], [], (err, group) => {
      assert.ok(!err);

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
        (err, privateMeeting) => {
          assert.ok(!err);

          RestAPI.MeetingsJitsi.createMeeting(
            restCtx,
            'name',
            'description',
            false,
            false,
            'loggedin',
            [group.id],
            null,
            (err, loggedinMeeting) => {
              assert.ok(!err);

              RestAPI.MeetingsJitsi.createMeeting(
                restCtx,
                'name',
                'description',
                false,
                false,
                'public',
                [group.id],
                null,
                (err, publicMeeting) => {
                  assert.ok(!err);

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
  const checkLibrary = function(restCtx, libraryOwnerId, expectAccess, expectedItems, callback) {
    RestAPI.MeetingsJitsi.getMeetingsLibrary(restCtx, libraryOwnerId, (err, items) => {
      if (expectAccess) {
        assert.ok(!err);

        // Make sure only the exptected items are returned
        assert.strictEqual(items.results.length, expectedItems.length);
        _.each(expectedItems, expectedMeeting => {
          assert.ok(
            _.filter(items.results, meeting => {
              return meeting.id === expectedMeeting.id;
            })
          );
        });
      } else {
        assert.strictEqual(err.code, 401);
        assert.ok(!items);
      }

      return callback();
    });
  };

  describe('User libraries', () => {
    const users = {};

    beforeEach(callback => {
      createUserAndLibrary(camAdminRestCtx, 'private', (user, privateMeeting, loggedinMeeting, publicMeeting) => {
        users.private = {
          user,
          privateMeeting,
          loggedinMeeting,
          publicMeeting
        };

        createUserAndLibrary(camAdminRestCtx, 'loggedin', (user, privateMeeting, loggedinMeeting, publicMeeting) => {
          users.loggedin = {
            user,
            privateMeeting,
            loggedinMeeting,
            publicMeeting
          };

          createUserAndLibrary(camAdminRestCtx, 'public', (user, privateMeeting, loggedinMeeting, publicMeeting) => {
            users.public = {
              user,
              privateMeeting,
              loggedinMeeting,
              publicMeeting
            };

            return callback();
          });
        });
      });
    });

    it('should only send the public stream of public users for an anonymous user', callback => {
      checkLibrary(camAnonymousRestCtx, users.public.user.user.id, true, [users.public.publicMeeting], () => {
        checkLibrary(camAnonymousRestCtx, users.loggedin.user.user.id, false, [], () => {
          checkLibrary(camAnonymousRestCtx, users.private.user.user.id, false, [], () => {
            return callback();
          });
        });
      });
    });

    it('should only send the loggedin stream of public and loggedin users for a loggedin user on the same tenant', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, myUsers) => {
        const anotherUser = _.values(myUsers)[0];

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

    it('should only send the public stream of public users for a loggedin user on *another* tenant', callback => {
      TestsUtil.generateTestUsers(gtAdminRestCtx, 1, (err, myUsers) => {
        const otherTenantUser = _.values(myUsers)[0];

        checkLibrary(otherTenantUser.restContext, users.public.user.user.id, true, [users.public.publicMeeting], () => {
          checkLibrary(otherTenantUser.restContext, users.loggedin.user.user.id, false, [], () => {
            checkLibrary(otherTenantUser.restContext, users.private.user.user.id, false, [], () => {
              return callback();
            });
          });
        });
      });
    });

    it('should send all the meeting library items for the owner of the library', callback => {
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

    it('should properly add the meeting to the user meeting library when the user gains access to the meeting', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, users, mrvisser, nicolaas) => {
        assert.ok(!err);

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
          (err, meeting) => {
            assert.ok(!err);

            // Seed mrvisser's and nicolaas's meeting libraries to ensure it does not get built from scratch
            RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, mrvisser.user.id, err => {
              assert.ok(!err);

              RestAPI.MeetingsJitsi.getMeetingsLibrary(nicolaas.restContext, nicolaas.user.id, err => {
                assert.ok(!err);

                // Make nicolaas a member of the meeting
                const updates = {};
                updates[nicolaas.user.id] = 'member';

                RestAPI.MeetingsJitsi.updateMembers(mrvisser.restContext, meeting.id, updates, err => {
                  assert.ok(!err);

                  // Ensure the meeting is still in mrvisser's and nicolaas's meeting libraries
                  RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, mrvisser.user.id, (err, result) => {
                    assert.ok(!err);
                    let libraryEntry = result.results[0];
                    assert.ok(libraryEntry);
                    assert.strictEqual(libraryEntry.id, meeting.id);

                    RestAPI.MeetingsJitsi.getMeetingsLibrary(nicolaas.restContext, nicolaas.user.id, (err, result) => {
                      assert.ok(!err);
                      libraryEntry = result.results[0];
                      assert.ok(libraryEntry);
                      assert.strictEqual(libraryEntry.id, meeting.id);

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
  });

  describe('Group libraries', () => {
    const groups = {};

    beforeEach(callback => {
      createGroupAndLibrary(camAdminRestCtx, 'private', (group, privateMeeting, loggedinMeeting, publicMeeting) => {
        groups.private = {
          group,
          privateMeeting,
          loggedinMeeting,
          publicMeeting
        };

        createGroupAndLibrary(camAdminRestCtx, 'loggedin', (group, privateMeeting, loggedinMeeting, publicMeeting) => {
          groups.loggedin = {
            group,
            privateMeeting,
            loggedinMeeting,
            publicMeeting
          };

          createGroupAndLibrary(camAdminRestCtx, 'public', (group, privateMeeting, loggedinMeeting, publicMeeting) => {
            groups.public = {
              group,
              privateMeeting,
              loggedinMeeting,
              publicMeeting
            };

            return callback();
          });
        });
      });
    });

    it('should only send the public stream of public groups for an anonymous user', callback => {
      checkLibrary(camAnonymousRestCtx, groups.public.group.id, true, [groups.public.publicMeeting], () => {
        checkLibrary(camAnonymousRestCtx, groups.loggedin.group.id, false, [], () => {
          checkLibrary(camAnonymousRestCtx, groups.private.group.id, false, [], () => {
            return callback();
          });
        });
      });
    });

    it('should only send the loggedin stream of public and loggedin groups for a loggedin user on the same tenant', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, users) => {
        assert.ok(!err);

        const anotherUser = _.values(users)[0];
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

    it('should only send the public stream of public groups for a loggedin user on *another* tenant', callback => {
      TestsUtil.generateTestUsers(gtAdminRestCtx, 1, (err, users) => {
        assert.ok(!err);

        const anotherTenantUser = _.values(users)[0];
        checkLibrary(anotherTenantUser.restContext, groups.public.group.id, true, [groups.public.publicMeeting], () => {
          checkLibrary(anotherTenantUser.restContext, groups.loggedin.group.id, false, [], () => {
            checkLibrary(anotherTenantUser.restContext, groups.private.group.id, false, [], () => {
              return callback();
            });
          });
        });
      });
    });

    it('should send all the meeting library items for a member of the group', callback => {
      checkLibrary(
        camAdminRestCtx,
        groups.public.group.id,
        true,
        [groups.public.publicMeeting, groups.public.loggedinMeeting, groups.public.privateMeeting],
        () => {
          checkLibrary(
            camAdminRestCtx,
            groups.loggedin.group.id,
            true,
            [groups.loggedin.publicMeeting, groups.loggedin.loggedinMeeting, groups.loggedin.privateMeeting],
            () => {
              checkLibrary(
                camAdminRestCtx,
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

    it('should add the meeting to the group meeting library when the group has been added to the meeting', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, users, mrvisser) => {
        assert.ok(!err);

        // Create a group to play with
        RestAPI.Group.createGroup(
          mrvisser.restContext,
          'displayName',
          'description',
          'private',
          'no',
          [],
          [],
          (err, group) => {
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
              (err, meeting) => {
                assert.ok(!err);

                // Seed mrvisser's and the group's meeting libraries to ensure it does not get built from scratch
                RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, mrvisser.user.id, err => {
                  assert.ok(!err);

                  RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, group.id, err => {
                    assert.ok(!err);

                    // Make the group a member of the meeting
                    const updates = {};
                    updates[group.id] = 'member';

                    RestAPI.MeetingsJitsi.updateMembers(mrvisser.restContext, meeting.id, updates, err => {
                      assert.ok(!err);

                      // Ensure the meeting is still in mrvisser's and the group's meeting libraries
                      RestAPI.MeetingsJitsi.getMeetingsLibrary(
                        mrvisser.restContext,
                        mrvisser.user.id,
                        (err, result) => {
                          assert.ok(!err);
                          let libraryEntry = result.results[0];
                          assert.ok(libraryEntry);
                          assert.strictEqual(libraryEntry.id, meeting.id);

                          RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, group.id, (err, result) => {
                            assert.ok(!err);
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
