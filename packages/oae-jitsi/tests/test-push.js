import { assert } from 'chai';
import { describe, before, it } from 'mocha';

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
  before((callback) => {
    localAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.localhost.host);
    return callback();
  });

  describe('Authorization', () => {
    it('verify signatures must be valid', (callback) => {
      TestsUtil.generateTestUsers(localAdminRestContext, 2, (error, users) => {
        assert.notExists(error);
        const { 0: homer, 1: marge } = users;

        RestAPI.User.getMe(homer.restContext, (error, homerProfile) => {
          assert.notExists(error);

          const data = {
            authentication: {
              userId: homerProfile.id,
              tenantAlias: homerProfile.tenant.alias,
              signature: homerProfile.signature
            },
            feeds: []
          };

          ActivityTestsUtil.getFullySetupPushClient(data, (client) => {
            // Create a meeting and gets its full profile so we have a signature that we can use to register for push notifications
            RestAPI.MeetingsJitsi.createMeeting(
              homer.restContext,
              'displayName',
              'description',
              false,
              false,
              'public',
              [marge.user.id],
              null,
              (error, meeting) => {
                assert.notExists(error);

                RestAPI.MeetingsJitsi.getMeeting(homer.restContext, meeting.id, (error, meeting) => {
                  assert.notExists(error);

                  // Ensure we get a 400 error with an invalid activity stream id
                  client.subscribe(meeting.id, null, meeting.signature, null, (error_) => {
                    assert.strictEqual(error_.code, 400);

                    // Ensure we get a 400 error with a missing ressource id
                    client.subscribe(null, 'activity', meeting.signature, null, (error_) => {
                      assert.strictEqual(error_.code, 400);

                      // Ensure we get a 401 error with an invalid token
                      client.subscribe(
                        meeting.id,
                        'activity',
                        { signature: meeting.signature.signature },
                        null,
                        (error_) => {
                          assert.strictEqual(error_.code, 401);

                          client.subscribe(
                            meeting.id,
                            'activity',
                            { expires: meeting.signature.expires },
                            null,
                            (error_) => {
                              assert.strictEqual(error_.code, 401);

                              // Ensure we get a 401 error with an incorrect signature
                              client.subscribe(
                                meeting.id,
                                'activity',
                                { expires: Date.now() + 10000, signature: 'foo' },
                                null,
                                (error_) => {
                                  assert.strictEqual(error_.code, 401);

                                  // Simon should not be able to use a signature that was generated for Branden
                                  RestAPI.MeetingsJitsi.getMeeting(
                                    marge.restContext,
                                    meeting.id,
                                    (error, meetingForBranden) => {
                                      assert.notExists(error);

                                      client.subscribe(
                                        meeting.id,
                                        'activity',
                                        meetingForBranden.signature,
                                        null,
                                        (error_) => {
                                          assert.strictEqual(error_.code, 401);

                                          // Sanity check that a valid signature works
                                          client.subscribe(
                                            meeting.id,
                                            'activity',
                                            meeting.signature,
                                            null,
                                            (error_) => {
                                              assert.notExists(error_);

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
    const setupFixture = function (callback) {
      TestsUtil.generateTestUsers(localAdminRestContext, 2, (error, users) => {
        assert.notExists(error);
        const { 0: branden, 1: simon } = users;

        // Get the full profile so we have a signature to authenticate ourselves on the WS
        RestAPI.User.getMe(simon.restContext, (error, simonFullProfile) => {
          assert.notExists(error);

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
            (error, meeting) => {
              assert.notExists(error);

              RestAPI.MeetingsJitsi.getMeeting(simon.restContext, meeting.id, (error, meeting) => {
                assert.notExists(error);

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

                  ActivityTestsUtil.getFullySetupPushClient(data, (client) => {
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

    it('verify metadata updates trigger a push notification', (callback) => {
      setupFixture((contexts, meeting, client) => {
        // Trigger an update
        RestAPI.MeetingsJitsi.updateMeeting(
          contexts.branden.restContext,
          meeting.id,
          { displayName: 'my-new-display-name' },
          (error) => {
            assert.notExists(error);
          }
        );

        ActivityTestsUtil.waitForPushActivity(
          client,
          MeetingsConstants.activity.ACTIVITY_MEETING_UPDATE,
          ActivityConstants.verbs.UPDATE,
          contexts.branden.user.id,
          meeting.id,
          null,
          (activity) => {
            // Verify the updated meeting display name is present on the activity object
            assert.strictEqual(activity.object.displayName, 'my-new-display-name');
            return client.close(callback);
          }
        );
      });
    });

    it('verify visibility updates trigger a push notification', (callback) => {
      setupFixture((contexts, meeting, client) => {
        // Trigger an update
        RestAPI.MeetingsJitsi.updateMeeting(
          contexts.branden.restContext,
          meeting.id,
          { visibility: 'loggedin' },
          (error) => {
            assert.notExists(error);
          }
        );

        ActivityTestsUtil.waitForPushActivity(
          client,
          MeetingsConstants.activity.ACTIVITY_MEETING_UPDATE_VISIBILITY,
          ActivityConstants.verbs.UPDATE,
          contexts.branden.user.id,
          meeting.id,
          null,
          (activity) => {
            // Verify the updated meeting display name is present on the activity object
            assert.strictEqual(activity.object.visibility, 'loggedin');
            return client.close(callback);
          }
        );
      });
    });

    it('verify a new message triggers a push notification', (callback) => {
      setupFixture((contexts, meeting, client) => {
        // Create a message
        RestAPI.MeetingsJitsi.createComment(contexts.branden.restContext, meeting.id, 'Hello world !', null, (
          error /* , _meetingMessage */
        ) => {
          assert.notExists(error);
        });

        ActivityTestsUtil.waitForPushActivity(
          client,
          MeetingsConstants.activity.ACTIVITY_MEETING_MESSAGE,
          ActivityConstants.verbs.POST,
          contexts.branden.user.id,
          null,
          meeting.id,
          (activity) => {
            // Verify that we have access to the message body and createdBy property
            assert.strictEqual(activity.object.body, 'Hello world !');
            assert.isObject(activity.object.createdBy);
            assert.strictEqual(activity.object.createdBy.id, contexts.branden.user.id);

            return client.close(callback);
          }
        );
      });
    });

    it("verify a message author's profile gets scrubbed", (callback) => {
      setupFixture((contexts, meeting, client) => {
        // Update one user
        RestAPI.User.updateUser(
          contexts.branden.restContext,
          contexts.branden.user.id,
          { visibility: 'private', publicAlias: 'Fifi' },
          (error) => {
            assert.notExists(error);

            // Create a message
            RestAPI.MeetingsJitsi.createComment(contexts.branden.restContext, meeting.id, 'Hello world !', null, (
              error /* , _meetingMessage */
            ) => {
              assert.notExists(error);
            });

            ActivityTestsUtil.waitForPushActivity(
              client,
              MeetingsConstants.activity.ACTIVITY_MEETING_MESSAGE,
              ActivityConstants.verbs.POST,
              contexts.branden.user.id,
              null,
              meeting.id,
              (activity) => {
                // Verify that we have access to the message body and createdBy property
                assert.strictEqual(activity.object.body, 'Hello world !');
                assert.isObject(activity.object.createdBy);
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
