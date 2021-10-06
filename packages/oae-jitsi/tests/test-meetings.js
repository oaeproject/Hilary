import { assert } from 'chai';
import async from 'async';
import { forEach, pipe, pluck } from 'ramda';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as MeetingsDAO from 'oae-jitsi/lib/internal/dao.js';

describe('Meeting Jitsi', () => {
  let camAnonymousRestCtx = null;
  let camAdminRestCtx = null;

  beforeEach(() => {
    camAnonymousRestCtx = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
  });

  describe('Create meeting', () => {
    it('should create successfully the meeting with the proper model and associations', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 3, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi, 2: loulou } = users;

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';
        const managers = [riri.user.id];
        const members = [fifi.user.id];

        // Stores how many meetings we currently have in db
        let numberMeetingsOrig = 0;
        MeetingsDAO.iterateAll(
          null,
          1000,
          (meetingRows, done) => {
            if (meetingRows) {
              numberMeetingsOrig += meetingRows.length;
            }

            return done();
          },
          (error_) => {
            assert.notExists(error_);

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
              (error_, meeting) => {
                assert.notExists(error_);

                assert.strictEqual(meeting.createdBy, loulou.user.id);
                assert.strictEqual(meeting.displayName, displayName);
                assert.strictEqual(meeting.description, description);
                assert.strictEqual(meeting.chat, chat);
                assert.strictEqual(meeting.contactList, contactList);
                assert.strictEqual(meeting.visibility, visibility);
                assert.strictEqual(meeting.resourceType, 'meeting-jitsi');

                // Check the meeting members and their roles
                RestAPI.MeetingsJitsi.getMembers(loulou.restContext, meeting.id, null, 1000, (error_, members) => {
                  assert.notExists(error_);

                  const memberIds = pipe(pluck('profile'), pluck('id'))(members.results);

                  assert.lengthOf(memberIds, 3);
                  assert.include(memberIds, riri.user.id, true);
                  assert.include(memberIds, fifi.user.id, true);
                  assert.include(memberIds, loulou.user.id, true);

                  const roles = pluck('role', members.results);

                  assert.lengthOf(roles, 3);
                  assert.include(roles, 'manager', true);
                  assert.include(roles, 'member', true);

                  // Ensure the new number of meetings in db is numMeetingsOrig + 1
                  let numberMeetingAfter = 0;
                  let hasNewMeeting = false;

                  MeetingsDAO.iterateAll(
                    null,
                    1000,
                    (meetingRows, done) => {
                      if (meetingRows) {
                        numberMeetingAfter += meetingRows.length;
                        forEach((meetingRow) => {
                          if (meetingRow.id === meeting.id) {
                            hasNewMeeting = true;
                          }
                        }, meetingRows);
                      }

                      return done();
                    },
                    (error__) => {
                      assert.notExists(error__);
                      assert.strictEqual(numberMeetingsOrig + 1, numberMeetingAfter);
                      assert.ok(hasNewMeeting);

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

    it('should be successfully added to its members and managers library', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 3, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi, 2: loulou } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            async.series(
              [
                /* eslint-disable-next-line func-names */
                function checkRiri(done) {
                  RestAPI.MeetingsJitsi.getMeetingsLibrary(riri.restContext, riri.user.id, (error, meetings) => {
                    assert.notExists(error);
                    assert.strictEqual(meetings.results.length, 1);
                    assert.strictEqual(meetings.results[0].id, meeting.id);

                    return done();
                  });
                },
                /* eslint-disable-next-line func-names */
                function checkFifi(done) {
                  RestAPI.MeetingsJitsi.getMeetingsLibrary(riri.restContext, riri.user.id, (error, meetings) => {
                    assert.notExists(error);
                    assert.strictEqual(meetings.results.length, 1);
                    assert.strictEqual(meetings.results[0].id, meeting.id);

                    return done();
                  });
                },
                /* eslint-disable-next-line func-names */
                function checkLoulou(done) {
                  RestAPI.MeetingsJitsi.getMeetingsLibrary(riri.restContext, riri.user.id, (error, meetings) => {
                    assert.notExists(error);
                    assert.strictEqual(meetings.results.length, 1);
                    assert.strictEqual(meetings.results[0].id, meeting.id);

                    return done();
                  });
                }
              ],
              callback
            );
          }
        );
      });
    });

    it('should not be successfull with an anonymous user', (callback) => {
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
        (error) => {
          assert.ok(error);
          assert.strictEqual(error.code, 401);

          return callback();
        }
      );
    });

    it('should not be successfull with an empty display name', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 400);

            return callback();
          }
        );
      });
    });

    it('should not be successfull with a display name longer than the maximum allowed size', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 400);

            return callback();
          }
        );
      });
    });

    it('should not be successfull with a description longer than the maximum allowed size', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 400);

            return callback();
          }
        );
      });
    });

    it('should not be successfull with an invalid visibility', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);
        const { 0: riri } = users;

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
          (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 400);

            return callback();
          }
        );
      });
    });

    it('should not be successfull with an invalid manager id', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 400);

            return callback();
          }
        );
      });
    });

    it('should not be successfull with an invalid member id', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 400);

            return callback();
          }
        );
      });
    });

    it('should not be successfull with a private user as a member', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const chat = true;
        const contactList = false;
        const visibility = 'public';

        RestAPI.User.updateUser(fifi.restContext, fifi.user.id, { visibility: 'private' }, (error_) => {
          assert.notExists(error_);

          RestAPI.MeetingsJitsi.createMeeting(
            riri.restContext,
            displayName,
            description,
            chat,
            contactList,
            visibility,
            [fifi.user.id],
            [],
            (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 401);

              return callback();
            }
          );
        });
      });
    });

    it('should not be successfull with a private group as a member', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

        RestAPI.Group.createGroup(
          fifi.restContext,
          'Group title',
          'Group description',
          'private',
          undefined,
          [],
          [],
          (error, groupObject) => {
            assert.notExists(error);

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
              [groupObject.id],
              [],
              (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 401);

                return callback();
              }
            );
          }
        );
      });
    });
  });

  describe('Update meeting', () => {
    it('should update successfully the meeting', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;
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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {
              displayName: 'new-display-name',
              description: 'new-description',
              chat: false,
              contactList: true
            };

            RestAPI.MeetingsJitsi.updateMeeting(riri.restContext, meeting.id, updates, (error, meeting) => {
              assert.notExists(error);
              assert.strictEqual(meeting.displayName, updates.displayName);
              assert.strictEqual(meeting.description, updates.description);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull with an empty display name', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;
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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {
              displayName: '',
              description: 'new-description'
            };

            RestAPI.MeetingsJitsi.updateMeeting(riri.restContext, meeting.id, updates, (error /* , meeting */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull with a display name longer than the maximum allowed size', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {
              displayName: TestsUtil.generateRandomText(100),
              description: 'new-description'
            };

            RestAPI.MeetingsJitsi.updateMeeting(riri.restContext, meeting.id, updates, (error /* , meeting */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull with a description longer than the maximum allowed size', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {
              displayName: 'new-display-name',
              description: TestsUtil.generateRandomText(1000)
            };

            RestAPI.MeetingsJitsi.updateMeeting(riri.restContext, meeting.id, updates, (error /* , meeting */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull with no fields to update', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {};

            RestAPI.MeetingsJitsi.updateMeeting(riri.restContext, meeting.id, updates, (error /* , meeting */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull with an invalid chat value', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {
              displayName: 'new-display-name',
              chat: 'not-an-valid-value'
            };

            RestAPI.MeetingsJitsi.updateMeeting(riri.restContext, meeting.id, updates, (error /* , meeting */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be susccessfull with an invalid contactList value', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {
              displayName: 'new-display-name',
              contactList: 'not-an-valid-value'
            };

            RestAPI.MeetingsJitsi.updateMeeting(riri.restContext, meeting.id, updates, (error /* , meeting */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull with a invalid meeting id', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error /* , meeting */) => {
            assert.notExists(error);

            const updates = {
              displayName: 'new-display-name',
              description: 'new-description'
            };

            RestAPI.MeetingsJitsi.updateMeeting(riri.restContext, 'not-an-id', updates, (error /* , meeting */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull with an invalid field name', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {
              displayName: 'new-display-name',
              description: 'new-description',
              'not-an-valid-field-name': 'test'
            };

            RestAPI.MeetingsJitsi.updateMeeting(riri.restContext, meeting.id, updates, (error /* , meeting */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull if the user is anonymous', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {
              displayName: 'new-display-name',
              description: 'new-description'
            };

            RestAPI.MeetingsJitsi.updateMeeting(camAnonymousRestCtx, meeting.id, updates, (error /* , meeting */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull if the user is loggedin but not a member', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {
              displayName: 'new-display-name',
              description: 'new-description'
            };

            RestAPI.MeetingsJitsi.updateMeeting(fifi.restContext, meeting.id, updates, (error /* , meeting */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull if the user is just a member', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {
              displayName: 'new-display-name',
              description: 'new-description'
            };

            RestAPI.MeetingsJitsi.updateMeeting(fifi.restContext, meeting.id, updates, (error /* , meeting */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);

              return callback();
            });
          }
        );
      });
    });
  });

  describe('Delete meeting', () => {
    it('should successfully delete the meeting and its members association', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 3, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi, 2: loulou } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            // Delete the meeting
            RestAPI.MeetingsJitsi.deleteMeeting(riri.restContext, meeting.id, (error_) => {
              assert.notExists(error_);

              // Check the meeting associtations have been correctly deleted
              async.parallel(
                [
                  /* eslint-disable-next-line func-names */
                  function ririCheck(done) {
                    RestAPI.MeetingsJitsi.getMeeting(riri.restContext, meeting.id, (error_) => {
                      assert.ok(error_);
                      assert.strictEqual(error_.code, 404);

                      return done();
                    });
                  },
                  /* eslint-disable-next-line func-names */
                  function fifiCheck(done) {
                    RestAPI.MeetingsJitsi.getMeeting(fifi.restContext, meeting.id, (error_) => {
                      assert.ok(error_);
                      assert.strictEqual(error_.code, 404);

                      return done();
                    });
                  },
                  /* eslint-disable-next-line func-names */
                  function loulouCheck(done) {
                    RestAPI.MeetingsJitsi.getMeeting(loulou.restContext, meeting.id, (error_) => {
                      assert.ok(error_);
                      assert.strictEqual(error_.code, 404);

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

    it('should successfully remove the meeting from its members and managers library', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 3, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi, 2: loulou } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            RestAPI.MeetingsJitsi.createMeeting(
              riri.restContext,
              displayName,
              description,
              chat,
              contactList,
              visibility,
              managers,
              members,
              (error, meeting2) => {
                assert.notExists(error);

                // Delete the meeting
                RestAPI.MeetingsJitsi.deleteMeeting(riri.restContext, meeting.id, (error_) => {
                  assert.notExists(error_);

                  // Check the meeting associtations have been correctly deleted
                  async.parallel(
                    [
                      /* eslint-disable-next-line func-names */
                      function ririCheck(done) {
                        RestAPI.MeetingsJitsi.getMeetingsLibrary(riri.restContext, riri.user.id, (error, meetings) => {
                          assert.notExists(error);
                          assert.strictEqual(meetings.results.length, 1);
                          assert.strictEqual(meetings.results[0].id, meeting2.id);

                          return done();
                        });
                      },
                      /* eslint-disable-next-line func-names */
                      function fifiCheck(done) {
                        RestAPI.MeetingsJitsi.getMeetingsLibrary(fifi.restContext, fifi.user.id, (error, meetings) => {
                          assert.notExists(error);
                          assert.strictEqual(meetings.results.length, 1);
                          assert.strictEqual(meetings.results[0].id, meeting2.id);

                          return done();
                        });
                      },
                      /* eslint-disable-next-line func-names */
                      function loulouCheck(done) {
                        RestAPI.MeetingsJitsi.getMeetingsLibrary(
                          loulou.restContext,
                          loulou.user.id,
                          (error, meetings) => {
                            assert.notExists(error);
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

    it('should not be successfull with an invalid meeting id', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;
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
          (error /* , meeting */) => {
            assert.notExists(error);

            RestAPI.MeetingsJitsi.deleteMeeting(riri.restContext, 'not-a-valid-id', (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull if a simple member tries to delete the meeting', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            RestAPI.MeetingsJitsi.deleteMeeting(fifi.restContext, meeting.id, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 401);

              return callback();
            });
          }
        );
      });
    });
  });

  describe('Manage meeting access', () => {
    it('should successfully update the meeting access', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {};
            updates[fifi.user.id] = 'member';

            RestAPI.MeetingsJitsi.updateMembers(riri.restContext, meeting.id, updates, (error_) => {
              assert.notExists(error_);

              RestAPI.MeetingsJitsi.getMeeting(fifi.restContext, meeting.id, (error, meeting) => {
                assert.notExists(error);
                assert.ok(!meeting.isManager);

                return callback();
              });
            });
          }
        );
      });
    });

    it('should not be successfull with an invalid meeting id', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

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
          (error /* , meeting */) => {
            assert.notExists(error);

            const updates = {};
            updates[fifi.user.id] = 'member';

            RestAPI.MeetingsJitsi.updateMembers(riri.restContext, 'not-a-valid-id', updates, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull with an invalid role', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {};
            updates[fifi.user.id] = 'not-a-valid-role';

            RestAPI.MeetingsJitsi.updateMembers(riri.restContext, meeting.id, updates, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull with an invalid principal id', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {};
            updates['not-a-valid-principal-id'] = 'member';

            RestAPI.MeetingsJitsi.updateMembers(riri.restContext, meeting.id, updates, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 400);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull if the user is not authorized to manage the access of the meeting', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 3, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi, 2: loulou } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {};
            updates[fifi.user.id] = 'member';

            RestAPI.MeetingsJitsi.updateMembers(loulou.restContext, meeting.id, updates, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 401);

              return callback();
            });
          }
        );
      });
    });

    it('should not be successfull if the update ends up with no manager for the meeting', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            const updates = {};
            updates[riri.user.id] = 'member';

            RestAPI.MeetingsJitsi.updateMembers(riri.restContext, meeting.id, updates, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 400);

              return callback();
            });
          }
        );
      });
    });
  });

  describe('Comment meeting', () => {
    it('should successfully comment the meeting with the proper model', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;
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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(riri.restContext, meeting.id, body, replyTo, (error, comment) => {
              assert.notExists(error);
              assert.strictEqual(comment.createdBy.id, riri.user.id);
              assert.strictEqual(comment.level, 0);
              assert.strictEqual(comment.body, body);
              assert.strictEqual(comment.messageBoxId, meeting.id);
              assert.ok(comment.id);
              assert.ok(comment.created);

              return callback();
            });
          }
        );
      });
    });

    it('should successfully comment the meeting even when it is a response to another comment', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(riri.restContext, meeting.id, body, replyTo, (error, comment) => {
              assert.notExists(error);

              // Add a response to the previous comment
              RestAPI.MeetingsJitsi.createComment(
                fifi.restContext,
                meeting.id,
                'Hello riri',
                comment.created,
                (error /* , comment */) => {
                  assert.notExists(error);

                  return callback();
                }
              );
            });
          }
        );
      });
    });

    it('should not be successfull with an invalid meeting id', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;
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
          (error /* , meeting */) => {
            assert.notExists(error);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              'not-a-valid-meeting-id',
              body,
              replyTo,
              (error /* , comment */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an empty body', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;
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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = '';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (error /* , comment */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an non-existing reply-to timestamp', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;
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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = 'Hello World';
            const replyTo = 'not-an-existing-reply-to-timestamp';

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (error /* , comment */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with a body longer thant the maximum allowed size', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;
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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = TestsUtil.generateRandomText(10_000);
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (error /* , comment */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 400);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with an anonymous user', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;
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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              camAnonymousRestCtx,
              meeting.id,
              body,
              replyTo,
              (error /* , comment */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 401);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should not be successfull with a non-member user on a private meeting', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              fifi.restContext,
              meeting.id,
              body,
              replyTo,
              (error /* , comment */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 401);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should be successfull with a non-member user on a public meeting', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              fifi.restContext,
              meeting.id,
              body,
              replyTo,
              (error /* , comment */) => {
                assert.notExists(error);

                return callback();
              }
            );
          }
        );
      });
    });

    it('should be successfull with a non-member user on a loggedin meeting', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 2, (error, users) => {
        assert.notExists(error);

        const { 0: riri, 1: fifi } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              fifi.restContext,
              meeting.id,
              body,
              replyTo,
              (error /* , comment */) => {
                assert.notExists(error);

                return callback();
              }
            );
          }
        );
      });
    });
  });

  describe('Delete meeting comment', () => {
    it('should successfully delete a comment from a meeting', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(riri.restContext, meeting.id, body, replyTo, (error, comment) => {
              assert.notExists(error);

              RestAPI.MeetingsJitsi.deleteComment(
                riri.restContext,
                meeting.id,
                comment.created,
                (error /* , softDeleted */) => {
                  assert.notExists(error);

                  return callback();
                }
              );
            });
          }
        );
      });
    });

    it('should successfully soft delete a comment from a meeting if the comment has replies to it', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(riri.restContext, meeting.id, body, replyTo, (error, comment1) => {
              assert.notExists(error);

              RestAPI.MeetingsJitsi.createComment(
                riri.restContext,
                meeting.id,
                'Hello Riri',
                comment1.created,
                (error /* , comment2 */) => {
                  assert.notExists(error);

                  RestAPI.MeetingsJitsi.deleteComment(
                    riri.restContext,
                    meeting.id,
                    comment1.created,
                    (error, softDeleted) => {
                      assert.notExists(error);
                      assert.ok(softDeleted.deleted);
                      assert.ok(!softDeleted.body);

                      return callback();
                    }
                  );
                }
              );
            });
          }
        );
      });
    });

    it('should not be successfull with an invalid meeting id', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(riri.restContext, meeting.id, body, replyTo, (error, comment) => {
              assert.notExists(error);

              RestAPI.MeetingsJitsi.deleteComment(
                riri.restContext,
                'not-a-valid-meeting-id',
                comment.created,
                (error /* , softDeleted */) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 400);

                  return callback();
                }
              );
            });
          }
        );
      });
    });

    it('should not be successfull with an invalid timestamp', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestCtx, 1, (error, users) => {
        assert.notExists(error);

        const { 0: riri } = users;

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
          (error, meeting) => {
            assert.notExists(error);

            // Add a comment
            const body = 'Hello world';
            const replyTo = null;

            RestAPI.MeetingsJitsi.createComment(
              riri.restContext,
              meeting.id,
              body,
              replyTo,
              (error /* , comment */) => {
                assert.notExists(error);

                RestAPI.MeetingsJitsi.deleteComment(
                  riri.restContext,
                  meeting.id,
                  'not-a-valid-comment-timestamp',
                  (error /* , softDeleted */) => {
                    assert.ok(error);
                    assert.strictEqual(error.code, 400);

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
