const assert = require('assert');
const _ = require('underscore');
const async = require('async');

const RestAPI = require('oae-rest');
const TestsUtil = require('oae-tests');

const MeetingsDAO = require('oae-jitsi/lib/internal/dao');

describe('Meeting Jitsi', () => {
  let camAnonymousRestCtx = null;
  let camAdminRestCtx = null;

  beforeEach(() => {
    camAnonymousRestCtx = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
  });

  describe('Create meeting', () => {
    it('should create successfully the meeting with the proper model and associations', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 3, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];
        const loulou = _.values(user)[2];

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';
        const managers = [riri.user.id];
        const members = [fifi.user.id];

        // Stores how many meetings we currently have in db
        let numMeetingsOrig = 0;
        MeetingsDAO.iterateAll(
          null,
          1000,
          (meetingRows, done) => {
            if (meetingRows) {
              numMeetingsOrig += meetingRows.length;
            }

            return done();
          },
          err => {
            assert.ok(!err);

            // Create one new meeting
            RestAPI.MeetingsJitsi.createMeeting(
              loulou.restContext,
              displayName,
              description,
              chat,
              contactList,
              visibility,
              managers,
              members,
              (err, meeting) => {
                assert.ok(!err);

                assert.strictEqual(meeting.createdBy, loulou.user.id);
                assert.strictEqual(meeting.displayName, displayName);
                assert.strictEqual(meeting.description, description);
                assert.strictEqual(meeting.chat, chat);
                assert.strictEqual(meeting.contactList, contactList);
                assert.strictEqual(meeting.visibility, visibility);
                assert.strictEqual(meeting.resourceType, 'meeting-jitsi');

                // Check the meeting members and their roles
                RestAPI.MeetingsJitsi.getMembers(
                  loulou.restContext,
                  meeting.id,
                  null,
                  1000,
                  (err, members) => {
                    assert.ok(!err);

                    const memberIds = _.pluck(_.pluck(members.results, 'profile'), 'id');

                    assert.strictEqual(memberIds.length, 3);
                    assert.strictEqual(_.contains(memberIds, riri.user.id), true);
                    assert.strictEqual(_.contains(memberIds, fifi.user.id), true);
                    assert.strictEqual(_.contains(memberIds, loulou.user.id), true);

                    const roles = _.pluck(members.results, 'role');

                    assert.strictEqual(roles.length, 3);
                    assert.strictEqual(_.contains(roles, 'manager'), true);
                    assert.strictEqual(_.contains(roles, 'member'), true);

                    // Ensure the new number of meetings in db is numMeetingsOrig + 1
                    let numMeetingAfter = 0;
                    let hasNewMeeting = false;

                    MeetingsDAO.iterateAll(
                      null,
                      1000,
                      (meetingRows, done) => {
                        if (meetingRows) {
                          numMeetingAfter += meetingRows.length;
                          _.each(meetingRows, meetingRow => {
                            if (meetingRow.id === meeting.id) {
                              hasNewMeeting = true;
                            }
                          });
                        }

                        return done();
                      },
                      err => {
                        assert.ok(!err);
                        assert.strictEqual(numMeetingsOrig + 1, numMeetingAfter);
                        assert.ok(hasNewMeeting);

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

    it('should be successfully added to its members and managers library', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 3, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];
        const loulou = _.values(user)[2];

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';
        const managers = [riri.user.id];
        const members = [fifi.user.id];

        RestAPI.MeetingsJitsi.createMeeting(
          loulou.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          managers,
          members,
          (err, meeting) => {
            assert.ok(!err);

            async.series(
              [
                /* eslint-disable-next-line func-names */
                function checkRiri(done) {
                  RestAPI.MeetingsJitsi.getMeetingsLibrary(
                    riri.restContext,
                    riri.user.id,
                    (err, meetings) => {
                      assert.ok(!err);
                      assert.strictEqual(meetings.results.length, 1);
                      assert.strictEqual(meetings.results[0].id, meeting.id);

                      return done();
                    }
                  );
                },
                /* eslint-disable-next-line func-names */
                function checkFifi(done) {
                  RestAPI.MeetingsJitsi.getMeetingsLibrary(
                    riri.restContext,
                    riri.user.id,
                    (err, meetings) => {
                      assert.ok(!err);
                      assert.strictEqual(meetings.results.length, 1);
                      assert.strictEqual(meetings.results[0].id, meeting.id);

                      return done();
                    }
                  );
                },
                /* eslint-disable-next-line func-names */
                function checkLoulou(done) {
                  RestAPI.MeetingsJitsi.getMeetingsLibrary(
                    riri.restContext,
                    riri.user.id,
                    (err, meetings) => {
                      assert.ok(!err);
                      assert.strictEqual(meetings.results.length, 1);
                      assert.strictEqual(meetings.results[0].id, meeting.id);

                      return done();
                    }
                  );
                }
              ],
              callback
            );
          }
        );
      });
    });

    it('should not be successfull with an anonymous user', callback => {
      const displayName = 'test-create-displayName';
      const description = 'test-create-description';
      const chat = true;
      const contactList = false;
      const visibility = 'public';

      RestAPI.MeetingsJitsi.createMeeting(
        camAnonymousRestCtx,
        displayName,
        description,
        chat,
        contactList,
        visibility,
        null,
        null,
        err => {
          assert.ok(err);
          assert.strictEqual(err.code, 401);

          return callback();
        }
      );
    });

    it('should not be successfull with an empty display name', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];

        const displayName = null;
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          err => {
            assert.ok(err);
            assert.strictEqual(err.code, 400);

            return callback();
          }
        );
      });
    });

    it('should not be successfull with a display name longer than the maximum allowed size', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];

        const displayName = TestsUtil.generateRandomText(100);
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          err => {
            assert.ok(err);
            assert.strictEqual(err.code, 400);

            return callback();
          }
        );
      });
    });

    it('should not be successfull with a description longer than the maximum allowed size', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];

        const displayName = 'test-create-displayName';
        const description = TestsUtil.generateRandomText(1000);
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          err => {
            assert.ok(err);
            assert.strictEqual(err.code, 400);

            return callback();
          }
        );
      });
    });

    it('should not be successfull with an invalid visibility', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'not-a-visibility';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          err => {
            assert.ok(err);
            assert.strictEqual(err.code, 400);

            return callback();
          }
        );
      });
    });

    it('should not be successfull with an invalid manager id', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          ['not-an-id'],
          null,
          err => {
            assert.ok(err);
            assert.strictEqual(err.code, 400);

            return callback();
          }
        );
      });
    });

    it('should not be successfull with an invalid member id', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          ['not-an-id'],
          err => {
            assert.ok(err);
            assert.strictEqual(err.code, 400);

            return callback();
          }
        );
      });
    });

    it('should not be successfull with a private user as a member', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, users) => {
        assert.ok(!err);

        const riri = _.values(users)[0];
        const fifi = _.values(users)[1];

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.User.updateUser(fifi.restContext, fifi.user.id, { visibility: 'private' }, err => {
          assert.ok(!err);

          RestAPI.MeetingsJitsi.createMeeting(
            riri.restContext,
            displayName,
            description,
            chat,
            contactList,
            visibility,
            [fifi.user.id],
            [],
            err => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);

              return callback();
            }
          );
        });
      });
    });

    it('should not be successfull with a private group as a member', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, users) => {
        assert.ok(!err);

        const riri = _.values(users)[0];
        const fifi = _.values(users)[1];

        RestAPI.Group.createGroup(
          fifi.restContext,
          'Group title',
          'Group description',
          'private',
          undefined,
          [],
          [],
          (err, groupObj) => {
            assert.ok(!err);

            const displayName = 'test-create-displayName';
            const description = 'test-create-description';
            const chat = true;
            const contactList = false;
            const visibility = 'public';

            RestAPI.MeetingsJitsi.createMeeting(
              riri.restContext,
              displayName,
              description,
              chat,
              contactList,
              visibility,
              [groupObj.id],
              [],
              err => {
                assert.ok(err);
                assert.strictEqual(err.code, 401);

                return callback();
              }
            );
          }
        );
      });
    });
  });

  describe('Update meeting', () => {
    it('should update successfully the meeting', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {
              displayName: 'new-display-name',
              description: 'new-description',
              chat: false,
              contactList: true
            };

            RestAPI.MeetingsJitsi.updateMeeting(
              riri.restContext,
              meeting.id,
              updates,
              (err, meeting) => {
                assert.ok(!err);
                assert.strictEqual(meeting.displayName, updates.displayName);
                assert.strictEqual(meeting.description, updates.description);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an empty display name', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {
              displayName: '',
              description: 'new-description'
            };

            RestAPI.MeetingsJitsi.updateMeeting(
              riri.restContext,
              meeting.id,
              updates,
              (err, meeting) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with a display name longer than the maximum allowed size', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {
              displayName: TestsUtil.generateRandomText(100),
              description: 'new-description'
            };

            RestAPI.MeetingsJitsi.updateMeeting(
              riri.restContext,
              meeting.id,
              updates,
              (err, meeting) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with a description longer than the maximum allowed size', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {
              displayName: 'new-display-name',
              description: TestsUtil.generateRandomText(1000)
            };

            RestAPI.MeetingsJitsi.updateMeeting(
              riri.restContext,
              meeting.id,
              updates,
              (err, meeting) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with no fields to update', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {};

            RestAPI.MeetingsJitsi.updateMeeting(
              riri.restContext,
              meeting.id,
              updates,
              (err, meeting) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an invalid chat value', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {
              displayName: 'new-display-name',
              chat: 'not-an-valid-value'
            };

            RestAPI.MeetingsJitsi.updateMeeting(
              riri.restContext,
              meeting.id,
              updates,
              (err, meeting) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be susccessfull with an invalid contactList value', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {
              displayName: 'new-display-name',
              contactList: 'not-an-valid-value'
            };

            RestAPI.MeetingsJitsi.updateMeeting(
              riri.restContext,
              meeting.id,
              updates,
              (err, meeting) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with a invalid meeting id', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {
              displayName: 'new-display-name',
              description: 'new-description'
            };

            RestAPI.MeetingsJitsi.updateMeeting(
              riri.restContext,
              'not-an-id',
              updates,
              (err, meeting) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an invalid field name', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {
              displayName: 'new-display-name',
              description: 'new-description',
              'not-an-valid-field-name': 'test'
            };

            RestAPI.MeetingsJitsi.updateMeeting(
              riri.restContext,
              meeting.id,
              updates,
              (err, meeting) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull if the user is anonymous', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {
              displayName: 'new-display-name',
              description: 'new-description'
            };

            RestAPI.MeetingsJitsi.updateMeeting(
              camAnonymousRestCtx,
              meeting.id,
              updates,
              (err, meeting) => {
                assert.ok(err);
                assert.strictEqual(err.code, 401);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull if the user is loggedin but not a member ', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {
              displayName: 'new-display-name',
              description: 'new-description'
            };

            RestAPI.MeetingsJitsi.updateMeeting(
              fifi.restContext,
              meeting.id,
              updates,
              (err, meeting) => {
                assert.ok(err);
                assert.strictEqual(err.code, 401);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull if the user is just a member ', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';
        const members = [fifi.user.id];

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          members,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {
              displayName: 'new-display-name',
              description: 'new-description'
            };

            RestAPI.MeetingsJitsi.updateMeeting(
              fifi.restContext,
              meeting.id,
              updates,
              (err, meeting) => {
                assert.ok(err);
                assert.strictEqual(err.code, 401);

                return callback();
              }
            );
          }
        );
      });
    });
  });

  describe('Delete meeting', () => {
    it('should successfully delete the meeting and its members association', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 3, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];
        const loulou = _.values(user)[2];

        const displayName = 'meeting-display-name';
        const description = 'meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';
        const managers = [fifi.user.id];
        const members = [loulou.user.id];

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          managers,
          members,
          (err, meeting) => {
            assert.ok(!err);

            // Delete the meeting
            RestAPI.MeetingsJitsi.deleteMeeting(riri.restContext, meeting.id, err => {
              assert.ok(!err);

              // Check the meeting associtations have been correctly deleted
              async.parallel(
                [
                  /* eslint-disable-next-line func-names */
                  function ririCheck(done) {
                    RestAPI.MeetingsJitsi.getMeeting(riri.restContext, meeting.id, err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 404);

                      return done();
                    });
                  },
                  /* eslint-disable-next-line func-names */
                  function fifiCheck(done) {
                    RestAPI.MeetingsJitsi.getMeeting(fifi.restContext, meeting.id, err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 404);

                      return done();
                    });
                  },
                  /* eslint-disable-next-line func-names */
                  function loulouCheck(done) {
                    RestAPI.MeetingsJitsi.getMeeting(loulou.restContext, meeting.id, err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 404);

                      return done();
                    });
                  }
                ],
                callback
              );
            });
          }
        );
      });
    });

    it('should successfully remove the meeting from its members and managers library', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 3, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];
        const loulou = _.values(user)[2];

        const displayName = 'meeting-display-name';
        const description = 'meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';
        const managers = [fifi.user.id];
        const members = [loulou.user.id];

        // Create two meetings, one is to delete and the other is to sanity check the library can still be rebuilt and contain the undeleted meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          managers,
          members,
          (err, meeting) => {
            assert.ok(!err);

            RestAPI.MeetingsJitsi.createMeeting(
              riri.restContext,
              displayName,
              description,
              chat,
              contactList,
              visibility,
              managers,
              members,
              (err, meeting2) => {
                assert.ok(!err);

                // Delete the meeting
                RestAPI.MeetingsJitsi.deleteMeeting(riri.restContext, meeting.id, err => {
                  assert.ok(!err);

                  // Check the meeting associtations have been correctly deleted
                  async.parallel(
                    [
                      /* eslint-disable-next-line func-names */
                      function ririCheck(done) {
                        RestAPI.MeetingsJitsi.getMeetingsLibrary(
                          riri.restContext,
                          riri.user.id,
                          (err, meetings) => {
                            assert.ok(!err);
                            assert.strictEqual(meetings.results.length, 1);
                            assert.strictEqual(meetings.results[0].id, meeting2.id);

                            return done();
                          }
                        );
                      },
                      /* eslint-disable-next-line func-names */
                      function fifiCheck(done) {
                        RestAPI.MeetingsJitsi.getMeetingsLibrary(
                          fifi.restContext,
                          fifi.user.id,
                          (err, meetings) => {
                            assert.ok(!err);
                            assert.strictEqual(meetings.results.length, 1);
                            assert.strictEqual(meetings.results[0].id, meeting2.id);

                            return done();
                          }
                        );
                      },
                      /* eslint-disable-next-line func-names */
                      function loulouCheck(done) {
                        RestAPI.MeetingsJitsi.getMeetingsLibrary(
                          loulou.restContext,
                          loulou.user.id,
                          (err, meetings) => {
                            assert.ok(!err);
                            assert.strictEqual(meetings.results.length, 1);
                            assert.strictEqual(meetings.results[0].id, meeting2.id);

                            return done();
                          }
                        );
                      }
                    ],
                    callback
                  );
                });
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an invalid meeting id', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'meeting-display-name';
        const description = 'meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            RestAPI.MeetingsJitsi.deleteMeeting(riri.restContext, 'not-a-valid-id', err => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull if a simple member tries to delete the meeting', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];

        const displayName = 'meeting-display-name';
        const description = 'meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';
        const members = [fifi.user.id];

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          members,
          (err, meeting) => {
            assert.ok(!err);

            RestAPI.MeetingsJitsi.deleteMeeting(fifi.restContext, meeting.id, err => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);

              return callback();
            });
          }
        );
      });
    });
  });

  describe('Manage meeting access', () => {
    it('should successfully update the meeting access', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];

        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';
        const managers = [fifi.user.id];

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          managers,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {};
            updates[fifi.user.id] = 'member';

            RestAPI.MeetingsJitsi.updateMembers(riri.restContext, meeting.id, updates, err => {
              assert.ok(!err);

              RestAPI.MeetingsJitsi.getMeeting(fifi.restContext, meeting.id, (err, meeting) => {
                assert.ok(!err);
                assert.ok(!meeting.isManager);

                return callback();
              });
            });
          }
        );
      });
    });

    it('should not be successfull with an invalid meeting id', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];

        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';
        const managers = [fifi.user.id];

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          managers,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {};
            updates[fifi.user.id] = 'member';

            RestAPI.MeetingsJitsi.updateMembers(
              riri.restContext,
              'not-a-valid-id',
              updates,
              err => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an invalid role', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];

        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';
        const managers = [fifi.user.id];

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          managers,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {};
            updates[fifi.user.id] = 'not-a-valid-role';

            RestAPI.MeetingsJitsi.updateMembers(riri.restContext, meeting.id, updates, err => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull with an invalid principal id', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];

        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';
        const managers = [fifi.user.id];

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          managers,
          null,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {};
            updates['not-a-valid-principal-id'] = 'member';

            RestAPI.MeetingsJitsi.updateMembers(riri.restContext, meeting.id, updates, err => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull if the user is not authorized to manage the access of the meeting', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 3, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];
        const loulou = _.values(user)[2];

        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';
        const managers = [fifi.user.id];
        const members = [loulou.user.id];

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          managers,
          members,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {};
            updates[fifi.user.id] = 'member';

            RestAPI.MeetingsJitsi.updateMembers(loulou.restContext, meeting.id, updates, err => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull if the update ends up with no manager for the meeting', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];

        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';
        const members = [fifi.user.id];

        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          members,
          (err, meeting) => {
            assert.ok(!err);

            const updates = {};
            updates[riri.user.id] = 'member';

            RestAPI.MeetingsJitsi.updateMembers(riri.restContext, meeting.id, updates, err => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);

              return callback();
            });
          }
        );
      });
    });
  });

  describe('Comment meeting', () => {
    it('should successfully comment the meeting with the proper model', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (err, comment) => {
                assert.ok(!err);
                assert.strictEqual(comment.createdBy.id, riri.user.id);
                assert.strictEqual(comment.level, 0);
                assert.strictEqual(comment.body, body);
                assert.strictEqual(comment.messageBoxId, meeting.id);
                assert.ok(comment.id);
                assert.ok(comment.created);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should successfully comment the meeting even when it is a response to another comment', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];

        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';
        const members = [fifi.user.id];

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          members,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (err, comment) => {
                assert.ok(!err);

                // Add a response to the previous comment
                RestAPI.MeetingsJitsi.createComment(
                  fifi.restContext,
                  meeting.id,
                  'Hello riri',
                  comment.created,
                  (err, comment) => {
                    assert.ok(!err);

                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an invalid meeting id', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              'not-a-valid-meeting-id',
              body,
              replyTo,
              (err, comment) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an empty body', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = '';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (err, comment) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an non-existing reply-to timestamp', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = 'Hello World';
            const replyTo = 'not-an-existing-reply-to-timestamp';

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (err, comment) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with a body longer thant the maximum allowed size', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = TestsUtil.generateRandomText(10000);
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (err, comment) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an anonymous user', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              camAnonymousRestCtx,
              meeting.id,
              body,
              replyTo,
              (err, comment) => {
                assert.ok(err);
                assert.strictEqual(err.code, 401);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with a non-member user on a private meeting', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];

        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              fifi.restContext,
              meeting.id,
              body,
              replyTo,
              (err, comment) => {
                assert.ok(err);
                assert.strictEqual(err.code, 401);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should be successfull with a non-member user on a public meeting', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];

        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              fifi.restContext,
              meeting.id,
              body,
              replyTo,
              (err, comment) => {
                assert.ok(!err);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should be successfull with a non-member user on a loggedin meeting', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const fifi = _.values(user)[1];

        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'loggedin';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              fifi.restContext,
              meeting.id,
              body,
              replyTo,
              (err, comment) => {
                assert.ok(!err);

                return callback();
              }
            );
          }
        );
      });
    });
  });

  describe('Delete meeting comment', () => {
    it('should successfully delete a comment from a meeting', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (err, comment) => {
                assert.ok(!err);

                RestAPI.MeetingsJitsi.deleteComment(
                  riri.restContext,
                  meeting.id,
                  comment.created,
                  (err, softDeleted) => {
                    assert.ok(!err);

                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    it('should successfully soft delete a comment from a meeting if the comment has replies to it', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (err, comment1) => {
                assert.ok(!err);

                RestAPI.MeetingsJitsi.createComment(
                  riri.restContext,
                  meeting.id,
                  'Hello Riri',
                  comment1.created,
                  (err, comment2) => {
                    assert.ok(!err);

                    RestAPI.MeetingsJitsi.deleteComment(
                      riri.restContext,
                      meeting.id,
                      comment1.created,
                      (err, softDeleted) => {
                        assert.ok(!err);
                        assert.ok(softDeleted.deleted);
                        assert.ok(!softDeleted.body);

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

    it('should not be successfull with an invalid meeting id', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (err, comment) => {
                assert.ok(!err);

                RestAPI.MeetingsJitsi.deleteComment(
                  riri.restContext,
                  'not-a-valid-meeting-id',
                  comment.created,
                  (err, softDeleted) => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 400);

                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an invalid timestamp', callback => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (err, user) => {
        assert.ok(!err);

        const riri = _.values(user)[0];
        const displayName = 'my-meeting-display-name';
        const description = 'my-meeting-description';
        const chat = true;
        const contactList = false;
        const visibility = 'private';

        // Create a meeting
        RestAPI.MeetingsJitsi.createMeeting(
          riri.restContext,
          displayName,
          description,
          chat,
          contactList,
          visibility,
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (err, comment) => {
                assert.ok(!err);

                RestAPI.MeetingsJitsi.deleteComment(
                  riri.restContext,
                  meeting.id,
                  'not-a-valid-comment-timestamp',
                  (err, softDeleted) => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 400);

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
