import { assert } from 'chai';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as EmailTestsUtil from 'oae-email/lib/test/util.js';
import * as ActivityTestsUtil from 'oae-activity/lib/test/util.js';

const PRIVATE = 'private';

describe('Meeting Activity', () => {
  let asCambridgeTenantAdmin = null;

  before((callback) => {
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    return callback();
  });

  /**
   * Drain the email queue
   */
  beforeEach((callback) => {
    EmailTestsUtil.clearEmailCollections(callback);
  });

  describe('Meeting activities', () => {
    it('verify creating a meeting results in an activity being generated', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: homer } = users;
        const asHomer = homer.restContext;

        // Create a meeting
        const randomText = TestsUtil.generateRandomText(25);
        RestAPI.MeetingsJitsi.createMeeting(
          asHomer,
          randomText,
          randomText,
          false,
          false,
          PRIVATE,
          null,
          null,
          (error, meeting) => {
            assert.notExists(error);

            // Collect the activities
            ActivityTestsUtil.collectAndGetActivityStream(asHomer, homer.user.id, null, (error, activityStream) => {
              assert.notExists(error);

              // Verify the meeting-jitsi-create activity
              const activity = activityStream.items[0];
              assert.ok(activity);
              assert.strictEqual(activity['oae:activityType'], 'meeting-jitsi-create');
              assert.strictEqual(activity.actor['oae:id'], homer.user.id);
              assert.strictEqual(activity.object['oae:id'], meeting.id);

              return callback();
            });
          }
        );
      });
    });

    it('verify updating a meeting results in an activity being generated', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simon } = users;

        // Create a meeting
        const randomText = TestsUtil.generateRandomText(25);
        RestAPI.MeetingsJitsi.createMeeting(
          simon.restContext,
          randomText,
          randomText,
          false,
          false,
          PRIVATE,
          null,
          null,
          (error, meeting) => {
            assert.notExists(error);

            // Update the meeting
            RestAPI.MeetingsJitsi.updateMeeting(
              simon.restContext,
              meeting.id,
              { displayName: 'Ravens' },
              (error, meetingProfile) => {
                assert.notExists(error);
                assert.ok(meetingProfile);

                // Collect the activities
                ActivityTestsUtil.collectAndGetActivityStream(
                  simon.restContext,
                  simon.user.id,
                  null,
                  (error, activityStream) => {
                    assert.notExists(error);

                    // Verify the meeting-jitsi-update activity
                    const activity = activityStream.items[0];
                    assert.ok(activity);
                    assert.strictEqual(activity['oae:activityType'], 'meeting-jitsi-update');
                    assert.strictEqual(activity.actor['oae:id'], simon.user.id);
                    assert.strictEqual(activity.object['oae:id'], meeting.id);

                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    it('verify sharing a meeting results in an activity being generated', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: homer, 1: marge } = users;

        // Create a meeting
        const randomText = TestsUtil.generateRandomText(25);
        RestAPI.MeetingsJitsi.createMeeting(
          homer.restContext,
          randomText,
          randomText,
          false,
          false,
          PRIVATE,
          null,
          null,
          (error, meeting) => {
            assert.notExists(error);

            // Share the meeting
            const updates = {};
            updates[marge.user.id] = 'member';
            RestAPI.MeetingsJitsi.updateMembers(homer.restContext, meeting.id, updates, (error_) => {
              assert.notExists(error_);

              // Collect the activities
              ActivityTestsUtil.collectAndGetActivityStream(
                homer.restContext,
                homer.user.id,
                null,
                (error, activityStream) => {
                  assert.notExists(error);

                  // Verify the meeting-jitsi-share activity
                  const activity = activityStream.items[0];
                  assert.ok(activity);
                  assert.strictEqual(activity['oae:activityType'], 'meeting-jitsi-share');
                  assert.strictEqual(activity.actor['oae:id'], homer.user.id);
                  assert.strictEqual(activity.object['oae:id'], meeting.id);
                  assert.strictEqual(activity.target['oae:id'], marge.user.id);

                  return callback();
                }
              );
            });
          }
        );
      });
    });

    it('verify updating user role of a meeting results in an activity being generated', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 12, (error, users) => {
        assert.notExists(error);
        const { 0: homer, 1: marge } = users;

        // Create a meeting
        const randomText = TestsUtil.generateRandomText(25);
        RestAPI.MeetingsJitsi.createMeeting(
          homer.restContext,
          randomText,
          randomText,
          false,
          false,
          PRIVATE,
          null,
          [marge.user.id],
          (error, meeting) => {
            assert.notExists(error);

            // Update one user role in the meeting
            const updates = {};
            updates[marge.user.id] = 'manager';
            RestAPI.MeetingsJitsi.updateMembers(homer.restContext, meeting.id, updates, (error_) => {
              assert.notExists(error_);

              // Collect the activities
              ActivityTestsUtil.collectAndGetActivityStream(
                homer.restContext,
                homer.user.id,
                null,
                (error, activityStream) => {
                  assert.notExists(error);

                  // Verify the meeting-jitsi-share activity
                  const activity = activityStream.items[0];
                  assert.ok(activity);
                  assert.strictEqual(activity['oae:activityType'], 'meeting-jitsi-update-member-role');
                  assert.strictEqual(activity.actor['oae:id'], homer.user.id);
                  assert.strictEqual(activity.object['oae:id'], marge.user.id);
                  assert.strictEqual(activity.target['oae:id'], meeting.id);

                  return callback();
                }
              );
            });
          }
        );
      });
    });

    it('verify posting a message in a meeting results in an activity being generated', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: simon } = users;

        // Create the meeting
        const randomText = TestsUtil.generateRandomText(25);
        RestAPI.MeetingsJitsi.createMeeting(
          simon.restContext,
          randomText,
          randomText,
          false,
          false,
          PRIVATE,
          null,
          null,
          (error, meeting) => {
            assert.notExists(error);

            // Send a message
            RestAPI.MeetingsJitsi.createComment(
              simon.restContext,
              meeting.id,
              '<b>Nice meeting.</b>',
              null,
              (error /* , simonMessage */) => {
                assert.notExists(error);

                // Collect the activities
                ActivityTestsUtil.collectAndGetActivityStream(
                  simon.restContext,
                  simon.user.id,
                  null,
                  (error, activityStream) => {
                    assert.notExists(error);

                    // Verify the meeting-jitsi-message activity
                    const activity = activityStream.items[0];
                    assert.ok(activity);
                    assert.strictEqual(activity['oae:activityType'], 'meeting-jitsi-message');
                    assert.strictEqual(activity.actor['oae:id'], simon.user.id);
                    assert.strictEqual(activity.object['oae:id'], meeting.id + '#' + activity.object.published);

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

  describe('Meeting emails', () => {
    /**
     * Create one public and one private user
     *
     * @param  {RestContext}    restCtx                         The context with which to create the user and content
     * @param  {Function}       callback                        Standard callback function
     * @param  {User}           callback.privateUser            The created private user
     * @param  {Meeting}        callback.publicUser             The created public user
     */
    const createPrivateAndPublicUsers = function (restCtx, callback) {
      TestsUtil.generateTestUsers(restCtx, 2, (error, users) => {
        assert.notExists(error);
        const { 0: simon, 1: nico } = users;

        // Simon is private and nico is public
        const nicoUpdate = { email: nico.user.email };
        const simonUpdate = {
          email: simon.user.email,
          visibility: PRIVATE,
          publicAlias: 'swappedFromPublicAlias'
        };

        // Update the users
        RestAPI.User.updateUser(nico.restContext, nico.user.id, nicoUpdate, (error_) => {
          assert.notExists(error_);

          RestAPI.User.updateUser(simon.restContext, simon.user.id, simonUpdate, (error_) => {
            assert.notExists(error_);

            return callback(simon, nico);
          });
        });
      });
    };

    it('verify an email is sent to the members when a meeting is created and privacy is respected', (callback) => {
      // Create one private and one public user
      createPrivateAndPublicUsers(asCambridgeTenantAdmin, (privateUser, publicUser) => {
        // Create a meeting
        const randomText = TestsUtil.generateRandomText(5);
        RestAPI.MeetingsJitsi.createMeeting(
          privateUser.restContext,
          randomText,
          randomText,
          false,
          false,
          PRIVATE,
          null,
          [publicUser.user.id],
          (error, meeting) => {
            assert.notExists(error);

            // Collect the email queue
            EmailTestsUtil.collectAndFetchAllEmails((emails) => {
              // There should be exactly one email
              assert.strictEqual(emails.length, 1);

              const stringEmail = JSON.stringify(emails[0]);
              const email = emails[0];

              // Sanity check that the email is to the invated member
              assert.strictEqual(email.to[0].address, publicUser.user.email);

              // Ensure some data expected to be in the email is there
              assert.notStrictEqual(stringEmail.indexOf(privateUser.restContext.hostHeader), -1);
              assert.notStrictEqual(stringEmail.indexOf(meeting.profilePath), -1);
              assert.notStrictEqual(stringEmail.indexOf(meeting.displayName), -1);

              // Ensure private data is nowhere to be found
              assert.strictEqual(stringEmail.indexOf(privateUser.user.displayName), -1);
              assert.strictEqual(stringEmail.indexOf(privateUser.user.email), -1);
              assert.strictEqual(stringEmail.indexOf(privateUser.user.locale), -1);

              // Ensure the public alias of the private user is present
              assert.notStrictEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

              return callback();
            });
          }
        );
      });
    });

    it('verify an email is sent to the target users when a meeting is shared and privacy is respected', (callback) => {
      createPrivateAndPublicUsers(asCambridgeTenantAdmin, (privateUser, publicUser) => {
        // Create a meeting
        const randomText = TestsUtil.generateRandomText(5);
        RestAPI.MeetingsJitsi.createMeeting(
          privateUser.restContext,
          randomText,
          randomText,
          false,
          false,
          PRIVATE,
          null,
          null,
          (error, meeting) => {
            assert.notExists(error);

            // Collect a first time the email queue to empty it
            EmailTestsUtil.collectAndFetchAllEmails((/* emails */) => {
              // Share the meeting
              const updates = {};
              updates[publicUser.user.id] = 'member';
              RestAPI.MeetingsJitsi.updateMembers(privateUser.restContext, meeting.id, updates, (error_) => {
                assert.notExists(error_);

                // Collect a second time the email queue
                EmailTestsUtil.collectAndFetchAllEmails((emails) => {
                  // There should be exactly one email
                  assert.strictEqual(emails.length, 1);

                  const stringEmail = JSON.stringify(emails[0]);
                  const email = emails[0];

                  // Sanity check that the email is to the shared target
                  assert.strictEqual(email.to[0].address, publicUser.user.email);

                  // Ensure some data expected to be in the email is there
                  assert.notStrictEqual(stringEmail.indexOf(privateUser.restContext.hostHeader), -1);
                  assert.notStrictEqual(stringEmail.indexOf(meeting.profilePath), -1);
                  assert.notStrictEqual(stringEmail.indexOf(meeting.displayName), -1);

                  // Ensure private data is nowhere to be found
                  assert.strictEqual(stringEmail.indexOf(privateUser.user.displayName), -1);
                  assert.strictEqual(stringEmail.indexOf(privateUser.user.email), -1);
                  assert.strictEqual(stringEmail.indexOf(privateUser.user.locale), -1);

                  // Ensure the public alias of the private user is present
                  assert.notStrictEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

                  return callback();
                });
              });
            });
          }
        );
      });
    });

    it("verify an email is sent to the meeting managers when the meeting's metadata are updated and privacy is respected", (callback) => {
      createPrivateAndPublicUsers(asCambridgeTenantAdmin, (privateUser, publicUser) => {
        TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: randomUser } = users;

          // Create a meeting
          const randomText = TestsUtil.generateRandomText(5);
          RestAPI.MeetingsJitsi.createMeeting(
            privateUser.restContext,
            randomText,
            randomText,
            false,
            false,
            PRIVATE,
            [publicUser.user.id],
            [randomUser.user.id],
            (error, meeting) => {
              assert.notExists(error);

              // Collect a first time the email queue to empty it
              EmailTestsUtil.collectAndFetchAllEmails((/* emails */) => {
                // Update the meeting's metadata
                const updates = { displayName: 'new-display-name' };
                RestAPI.MeetingsJitsi.updateMeeting(privateUser.restContext, meeting.id, updates, (error, meeting) => {
                  assert.notExists(error);

                  // Collect a second time the email queue
                  EmailTestsUtil.collectAndFetchAllEmails((emails) => {
                    // There should be exactly one email
                    assert.strictEqual(emails.length, 1);

                    const stringEmail = JSON.stringify(emails[0]);
                    const email = emails[0];

                    // Sanity check that the email is to the shared target
                    assert.strictEqual(email.to[0].address, publicUser.user.email);

                    // Ensure some data expected to be in the email is there
                    assert.notStrictEqual(stringEmail.indexOf(privateUser.restContext.hostHeader), -1);
                    assert.notStrictEqual(stringEmail.indexOf(meeting.profilePath), -1);
                    assert.notStrictEqual(stringEmail.indexOf(meeting.displayName), -1);

                    // Ensure private data is nowhere to be found
                    assert.strictEqual(stringEmail.indexOf(privateUser.user.displayName), -1);
                    assert.strictEqual(stringEmail.indexOf(privateUser.user.email), -1);
                    assert.strictEqual(stringEmail.indexOf(privateUser.user.locale), -1);

                    // Ensure the public alias of the private user is present
                    assert.notStrictEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

                    return callback();
                  });
                });
              });
            }
          );
        });
      });
    });

    it('verify an email is sent to the meeting members when someone posts a message and privacy is respected', (callback) => {
      createPrivateAndPublicUsers(asCambridgeTenantAdmin, (privateUser, publicUser) => {
        // Create a meeting
        const randomText = TestsUtil.generateRandomText(5);
        RestAPI.MeetingsJitsi.createMeeting(
          privateUser.restContext,
          randomText,
          randomText,
          false,
          false,
          PRIVATE,
          [publicUser.user.id],
          null,
          (error, meeting) => {
            assert.notExists(error);

            // Collect a first time the email queue to empty it
            EmailTestsUtil.collectAndFetchAllEmails((/* emails */) => {
              // Post a comment
              RestAPI.MeetingsJitsi.createComment(
                privateUser.restContext,
                meeting.id,
                'Hello world !',
                null,
                (error_) => {
                  assert.notExists(error_);

                  // Collect a second time the email queue
                  EmailTestsUtil.collectAndFetchAllEmails((emails) => {
                    // There should be exactly one email
                    assert.strictEqual(emails.length, 1);

                    const stringEmail = JSON.stringify(emails[0]);
                    const email = emails[0];

                    // Sanity check that the email is to the shared target
                    assert.strictEqual(email.to[0].address, publicUser.user.email);

                    // Ensure some data expected to be in the email is there
                    assert.notStrictEqual(stringEmail.indexOf(privateUser.restContext.hostHeader), -1);
                    assert.notStrictEqual(stringEmail.indexOf(meeting.profilePath), -1);
                    assert.notStrictEqual(stringEmail.indexOf(meeting.displayName), -1);

                    // Ensure private data is nowhere to be found
                    assert.strictEqual(stringEmail.indexOf(privateUser.user.displayName), -1);
                    assert.strictEqual(stringEmail.indexOf(privateUser.user.email), -1);
                    assert.strictEqual(stringEmail.indexOf(privateUser.user.locale), -1);

                    // Ensure the public alias of the private user is present
                    assert.notStrictEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

                    return callback();
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
