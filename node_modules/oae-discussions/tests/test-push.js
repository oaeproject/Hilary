/*
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
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
const assert = require('assert');
const fs = require('fs');
const _ = require('underscore');

const { ActivityConstants } = require('oae-activity/lib/constants');
const ActivityTestsUtil = require('oae-activity/lib/test/util');
const RestAPI = require('oae-rest');
const { RestContext } = require('oae-rest/lib/model');
const TestsUtil = require('oae-tests');

const { DiscussionsConstants } = require('oae-discussions/lib/constants');

describe('Discussion Push', () => {
  // Rest contexts that can be used performing rest requests
  let localAdminRestContext = null;

  /**
   * Function that will fill up the tenant admin and anymous rest contexts
   */
  before(callback => {
    localAdminRestContext = TestsUtil.createTenantAdminRestContext(
      global.oaeTests.tenants.localhost.host
    );
    callback();
  });

  describe('Authorization', () => {
    /**
     * Test that verifies registering for a feed goes through the proper authorization checks
     */
    it('verify signatures must be valid', callback => {
      TestsUtil.generateTestUsers(localAdminRestContext, 2, (err, users, simong, branden) => {
        assert.ok(!err);

        RestAPI.User.getMe(simong.restContext, (err, simonFull) => {
          assert.ok(!err);

          const data = {
            authentication: {
              userId: simonFull.id,
              tenantAlias: simonFull.tenant.alias,
              signature: simonFull.signature
            },
            feeds: []
          };

          ActivityTestsUtil.getFullySetupPushClient(data, client => {
            // Create a discussion and get its full profile so we have a signature that we can use to register for push notifications
            RestAPI.Discussions.createDiscussion(
              simong.restContext,
              'displayName',
              'description',
              'public',
              [branden.user.id],
              null,
              (err, discussion) => {
                assert.ok(!err);
                RestAPI.Discussions.getDiscussion(
                  simong.restContext,
                  discussion.id,
                  (err, discussion) => {
                    assert.ok(!err);

                    // Ensure we get a 400 error with an invalid activity stream id
                    client.subscribe(discussion.id, null, discussion.signature, null, err => {
                      assert.strictEqual(err.code, 400);

                      // Ensure we get a 400 error with a missing resource id
                      client.subscribe(null, 'activity', discussion.signature, null, err => {
                        assert.strictEqual(err.code, 400);

                        // Ensure we get a 400 error with an invalid token
                        client.subscribe(
                          discussion.id,
                          'activity',
                          { signature: discussion.signature.signature },
                          null,
                          err => {
                            assert.strictEqual(err.code, 401);
                            client.subscribe(
                              discussion.id,
                              'activity',
                              { expires: discussion.signature.expires },
                              null,
                              err => {
                                assert.strictEqual(err.code, 401);

                                // Ensure we get a 401 error with an incorrect signature
                                client.subscribe(
                                  discussion.id,
                                  'activity',
                                  { expires: Date.now() + 10000, signature: 'foo' },
                                  null,
                                  err => {
                                    assert.strictEqual(err.code, 401);

                                    // Simon should not be able to use a signature that was generated for Branden
                                    RestAPI.Discussions.getDiscussion(
                                      branden.restContext,
                                      discussion.id,
                                      (err, discussionForBranden) => {
                                        assert.ok(!err);
                                        client.subscribe(
                                          discussion.id,
                                          'activity',
                                          discussionForBranden.signature,
                                          null,
                                          err => {
                                            assert.strictEqual(err.code, 401);

                                            // Sanity check that a valid signature works
                                            client.subscribe(
                                              discussion.id,
                                              'activity',
                                              discussion.signature,
                                              null,
                                              err => {
                                                assert.ok(!err);
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
                  }
                );
              }
            );
          });
        });
      });
    });
  });

  describe('Notifications', () => {
    /**
     * Creates 2 users: `Branden` and `Simon` who are both managers of a discussion. A websocket will be created
     * for the `Simon`-user which is both authenticated and registered for push notifications on the discussion.
     *
     * @param  {Function}       callback                Standard callback function
     * @param  {Object}         callback.contexts       An object that holds the context and user info for the created users
     * @param  {Discussion}     callback.discussion     The created discussion
     * @param  {Client}         callback.client         A websocket client that is authenticated for the `Simon`-user and is registered for push notificates on the created discussion
     * @throws {Error}                                  If anything goes wrong, an assertion error will be thrown
     */
    const setupFixture = function(callback) {
      TestsUtil.generateTestUsers(localAdminRestContext, 2, (err, users, branden, simon) => {
        assert.ok(!err);

        const contexts = {
          branden,
          simon
        };

        // Get the full profile so we have a signature to authenticate ourselves on the WS
        RestAPI.User.getMe(contexts.simon.restContext, (err, simonFull) => {
          assert.ok(!err);

          // Create a discussion and get the full discussion profile so we have a signature that we can use to register for push notifications
          RestAPI.Discussions.createDiscussion(
            contexts.simon.restContext,
            'A file',
            'A proper file',
            'private',
            [contexts.branden.user.id],
            [],
            (err, discussion) => {
              assert.ok(!err);
              RestAPI.Discussions.getDiscussion(
                contexts.simon.restContext,
                discussion.id,
                (err, discussion) => {
                  assert.ok(!err);

                  // Route and deliver activities
                  ActivityTestsUtil.collectAndGetActivityStream(
                    contexts.simon.restContext,
                    null,
                    null,
                    () => {
                      // Register for some streams
                      const data = {
                        authentication: {
                          userId: contexts.simon.user.id,
                          tenantAlias: simonFull.tenant.alias,
                          signature: simonFull.signature
                        },
                        streams: [
                          {
                            resourceId: discussion.id,
                            streamType: 'activity',
                            token: discussion.signature
                          },
                          {
                            resourceId: discussion.id,
                            streamType: 'message',
                            token: discussion.signature
                          }
                        ]
                      };

                      ActivityTestsUtil.getFullySetupPushClient(data, client => {
                        callback(contexts, discussion, client);
                      });
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
     * Test that verifies an update gets pushed out
     */
    it('verify updates trigger a push notification', callback => {
      setupFixture((contexts, discussion, client) => {
        // Trigger an update
        RestAPI.Discussions.updateDiscussion(
          contexts.branden.restContext,
          discussion.id,
          { displayName: 'Laaike whatevs' },
          err => {
            assert.ok(!err);
          }
        );

        ActivityTestsUtil.waitForPushActivity(
          client,
          DiscussionsConstants.activity.ACTIVITY_DISCUSSION_UPDATE,
          ActivityConstants.verbs.UPDATE,
          contexts.branden.user.id,
          discussion.id,
          null,
          activity => {
            // Verify the updated display name is present on the activity object
            assert.strictEqual(activity.object.displayName, 'Laaike whatevs');
            return client.close(callback);
          }
        );
      });
    });

    /**
     * Test that verifies a visibility update gets pushed out
     */
    it('verify visibility updates trigger a push notification', callback => {
      setupFixture((contexts, discussion, client) => {
        // Trigger an update
        RestAPI.Discussions.updateDiscussion(
          contexts.branden.restContext,
          discussion.id,
          { visibility: 'loggedin' },
          err => {
            assert.ok(!err);
          }
        );

        ActivityTestsUtil.waitForPushActivity(
          client,
          DiscussionsConstants.activity.ACTIVITY_DISCUSSION_UPDATE_VISIBILITY,
          ActivityConstants.verbs.UPDATE,
          contexts.branden.user.id,
          discussion.id,
          null,
          activity => {
            // Verify the updated visibility setting is present on the activity object
            assert.strictEqual(activity.object.visibility, 'loggedin');
            return client.close(callback);
          }
        );
      });
    });

    /**
     * Test that verifies a new message gets pushed out
     */
    it('verify a new message triggers a push notification', callback => {
      setupFixture((contexts, discussion, client) => {
        let discussionMessage = null;
        let activity = null;

        const _assertAndCallback = _.after(2, () => {
          // Verify that we have access to the message body and createdBy property
          assert.strictEqual(activity.object.body, 'Cup a Soup');
          assert.ok(_.isObject(activity.object.createdBy));
          assert.strictEqual(activity.object.createdBy.id, contexts.branden.user.id);
          return client.close(callback);
        });

        // Create a message
        RestAPI.Discussions.createMessage(
          contexts.branden.restContext,
          discussion.id,
          'Cup a Soup',
          null,
          (err, _discussionMessage) => {
            assert.ok(!err);
            discussionMessage = _discussionMessage;
            return _assertAndCallback();
          }
        );

        ActivityTestsUtil.waitForPushActivity(
          client,
          DiscussionsConstants.activity.ACTIVITY_DISCUSSION_MESSAGE,
          ActivityConstants.verbs.POST,
          contexts.branden.user.id,
          null,
          discussion.id,
          _activity => {
            activity = _activity;
            return _assertAndCallback();
          }
        );
      });
    });

    /**
     * Test that verifies a message author's profile gets scrubbed
     */
    it("verify a message author's profile gets scrubbed", callback => {
      setupFixture((contexts, discussion, client) => {
        RestAPI.User.updateUser(
          contexts.branden.restContext,
          contexts.branden.user.id,
          { visibility: 'private', publicAlias: 'Ma Baker' },
          err => {
            assert.ok(!err);

            let discussionMessage = null;
            let activity = null;

            const _assertAndCallback = _.after(2, () => {
              // Verify that we have access to the message body and createdBy property
              assert.strictEqual(activity.object.body, 'Cup a Soup');
              assert.strictEqual(activity.object.createdBy.visibility, 'private');
              assert.strictEqual(activity.object.createdBy.displayName, 'Ma Baker');
              return client.close(callback);
            });

            // Create a message
            RestAPI.Discussions.createMessage(
              contexts.branden.restContext,
              discussion.id,
              'Cup a Soup',
              null,
              (err, _discussionMessage) => {
                assert.ok(!err);
                discussionMessage = _discussionMessage;
                return _assertAndCallback();
              }
            );

            ActivityTestsUtil.waitForPushActivity(
              client,
              DiscussionsConstants.activity.ACTIVITY_DISCUSSION_MESSAGE,
              ActivityConstants.verbs.POST,
              contexts.branden.user.id,
              null,
              discussion.id,
              _activity => {
                activity = _activity;
                return _assertAndCallback();
              }
            );
          }
        );
      });
    });
  });
});
