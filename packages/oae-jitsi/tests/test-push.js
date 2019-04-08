import assert from 'assert';
import _ from 'underscore';

import * as ActivityTestsUtil from 'oae-activity/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

import { ActivityConstants } from 'oae-activity/lib/constants';
import { MeetingsConstants } from 'oae-jitsi/lib/constants';

describe('Meeting Push', () => {
  let localAdminRestContext = null;

  /**
   * Function that will fill up the tenant admin and anymous rest contexts
   */
  before(callback => {
    localAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.localhost.host);
    return callback();
  });

  describe('Authorization', () => {
    it('verify signatures must be valid', callback => {
      TestsUtil.generateTestUsers(localAdminRestContext, 2, (err, users, simon, branden) => {
        assert.ok(!err);

        RestAPI.User.getMe(simon.restContext, (err, simonFullProfile) => {
          assert.ok(!err);

          const data = {
            authentication: {
              userId: simonFullProfile.id,
              tenantAlias: simonFullProfile.tenant.alias,
              signature: simonFullProfile.signature
            },
            feeds: []
          };

          ActivityTestsUtil.getFullySetupPushClient(data, client => {
            // Create a meeting and gets its full profile so we have a signature that we can use to register for push notifications
            RestAPI.MeetingsJitsi.createMeeting(
              simon.restContext,
              'displayName',
              'description',
              false,
              false,
              'public',
              [branden.user.id],
              null,
              (err, meeting) => {
                assert.ok(!err);

                RestAPI.MeetingsJitsi.getMeeting(simon.restContext, meeting.id, (err, meeting) => {
                  assert.ok(!err);

                  // Ensure we get a 400 error with an invalid activity stream id
                  client.subscribe(meeting.id, null, meeting.signature, null, err => {
                    assert.strictEqual(err.code, 400);

                    // Ensure we get a 400 error with a missing ressource id
                    client.subscribe(null, 'activity', meeting.signature, null, err => {
                      assert.strictEqual(err.code, 400);

                      // Ensure we get a 401 error with an invalid token
                      client.subscribe(
                        meeting.id,
                        'activity',
                        { signature: meeting.signature.signature },
                        null,
                        err => {
                          assert.strictEqual(err.code, 401);

                          client.subscribe(
                            meeting.id,
                            'activity',
                            { expires: meeting.signature.expires },
                            null,
                            err => {
                              assert.strictEqual(err.code, 401);

                              // Ensure we get a 401 error with an incorrect signature
                              client.subscribe(
                                meeting.id,
                                'activity',
                                { expires: Date.now() + 10000, signature: 'foo' },
                                null,
                                err => {
                                  assert.strictEqual(err.code, 401);

                                  // Simon should not be able to use a signature that was generated for Branden
                                  RestAPI.MeetingsJitsi.getMeeting(
                                    branden.restContext,
                                    meeting.id,
                                    (err, meetingForBranden) => {
                                      assert.ok(!err);

                                      client.subscribe(
                                        meeting.id,
                                        'activity',
                                        meetingForBranden.signature,
                                        null,
                                        err => {
                                          assert.strictEqual(err.code, 401);

                                          // Sanity check that a valid signature works
                                          client.subscribe(meeting.id, 'activity', meeting.signature, null, err => {
                                            assert.ok(!err);

                                            return callback();
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

  describe('Notifications', () => {
    /**
     * Creates 2 users: `Branden` and `Simon` who are both managers of a meeting. A websocket will be created
     * for the `Simon`-user which is both authenticated and registered for push notifications on the meeting.
     *
     * @param  {Function}       callback                Standard callback function
     * @param  {Object}         callback.contexts       An object that holds the context and user info for the created users
     * @param  {Meeting}        callback.meeting        The created meeting
     * @param  {Client}         callback.client         A websocket client that is authenticated for the `Simon`-user and is registered for push notificates on the created meeting
     * @throws {Error}                                  If anything goes wrong, an assertion error will be thrown
     */
    const setupFixture = function(callback) {
      TestsUtil.generateTestUsers(localAdminRestContext, 2, (err, users, branden, simon) => {
        assert.ok(!err);

        // Get the full profile so we have a signature to authenticate ourselves on the WS
        RestAPI.User.getMe(simon.restContext, (err, simonFullProfile) => {
          assert.ok(!err);

          // Create a meeting and get the full profile so we have a signature that we can use to register for push notifications
          RestAPI.MeetingsJitsi.createMeeting(
            simon.restContext,
            'My meeting',
            'My meeting description',
            false,
            false,
            'private',
            [branden.user.id],
            null,
            (err, meeting) => {
              assert.ok(!err);

              RestAPI.MeetingsJitsi.getMeeting(simon.restContext, meeting.id, (err, meeting) => {
                assert.ok(!err);

                // Route and deliver activities
                ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, null, null, () => {
                  // Register for some streams
                  const data = {
                    authentication: {
                      userId: simon.user.id,
                      tenantAlias: simonFullProfile.tenant.alias,
                      signature: simonFullProfile.signature
                    },
                    streams: [
                      {
                        resourceId: meeting.id,
                        streamType: 'activity',
                        token: meeting.signature
                      },
                      {
                        resourceId: meeting.id,
                        streamType: 'message',
                        token: meeting.signature
                      }
                    ]
                  };

                  ActivityTestsUtil.getFullySetupPushClient(data, client => {
                    const contexts = {
                      branden,
                      simon
                    };

                    return callback(contexts, meeting, client);
                  });
                });
              });
            }
          );
        });
      });
    };

    it('verify metadata updates trigger a push notification', callback => {
      setupFixture((contexts, meeting, client) => {
        // Trigger an update
        RestAPI.MeetingsJitsi.updateMeeting(
          contexts.branden.restContext,
          meeting.id,
          { displayName: 'my-new-display-name' },
          err => {
            assert.ok(!err);
          }
        );

        ActivityTestsUtil.waitForPushActivity(
          client,
          MeetingsConstants.activity.ACTIVITY_MEETING_UPDATE,
          ActivityConstants.verbs.UPDATE,
          contexts.branden.user.id,
          meeting.id,
          null,
          activity => {
            // Verify the updated meeting display name is present on the activity object
            assert.strictEqual(activity.object.displayName, 'my-new-display-name');
            return client.close(callback);
          }
        );
      });
    });

    it('verify visibility updates trigger a push notification', callback => {
      setupFixture((contexts, meeting, client) => {
        // Trigger an update
        RestAPI.MeetingsJitsi.updateMeeting(
          contexts.branden.restContext,
          meeting.id,
          { visibility: 'loggedin' },
          err => {
            assert.ok(!err);
          }
        );

        ActivityTestsUtil.waitForPushActivity(
          client,
          MeetingsConstants.activity.ACTIVITY_MEETING_UPDATE_VISIBILITY,
          ActivityConstants.verbs.UPDATE,
          contexts.branden.user.id,
          meeting.id,
          null,
          activity => {
            // Verify the updated meeting display name is present on the activity object
            assert.strictEqual(activity.object.visibility, 'loggedin');
            return client.close(callback);
          }
        );
      });
    });

    it('verify a new message triggers a push notification', callback => {
      setupFixture((contexts, meeting, client) => {
        // Create a message
        RestAPI.MeetingsJitsi.createComment(
          contexts.branden.restContext,
          meeting.id,
          'Hello world !',
          null,
          (err, _meetingMessage) => {
            assert.ok(!err);
          }
        );

        ActivityTestsUtil.waitForPushActivity(
          client,
          MeetingsConstants.activity.ACTIVITY_MEETING_MESSAGE,
          ActivityConstants.verbs.POST,
          contexts.branden.user.id,
          null,
          meeting.id,
          activity => {
            // Verify that we have access to the message body and createdBy property
            assert.strictEqual(activity.object.body, 'Hello world !');
            assert.ok(_.isObject(activity.object.createdBy));
            assert.strictEqual(activity.object.createdBy.id, contexts.branden.user.id);

            return client.close(callback);
          }
        );
      });
    });

    it("verify a message author's profile gets scrubbed", callback => {
      setupFixture((contexts, meeting, client) => {
        // Update one user
        RestAPI.User.updateUser(
          contexts.branden.restContext,
          contexts.branden.user.id,
          { visibility: 'private', publicAlias: 'Fifi' },
          err => {
            assert.ok(!err);

            // Create a message
            RestAPI.MeetingsJitsi.createComment(
              contexts.branden.restContext,
              meeting.id,
              'Hello world !',
              null,
              (err, _meetingMessage) => {
                assert.ok(!err);
              }
            );

            ActivityTestsUtil.waitForPushActivity(
              client,
              MeetingsConstants.activity.ACTIVITY_MEETING_MESSAGE,
              ActivityConstants.verbs.POST,
              contexts.branden.user.id,
              null,
              meeting.id,
              activity => {
                // Verify that we have access to the message body and createdBy property
                assert.strictEqual(activity.object.body, 'Hello world !');
                assert.ok(_.isObject(activity.object.createdBy));
                assert.strictEqual(activity.object.createdBy.id, contexts.branden.user.id);
                assert.strictEqual(activity.object.createdBy.visibility, 'private');
                assert.strictEqual(activity.object.createdBy.displayName, 'Fifi');

                return client.close(callback);
              }
            );
          }
        );
      });
    });
  });
});
