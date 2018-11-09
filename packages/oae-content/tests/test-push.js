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

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const _ = require('underscore');

const { ActivityConstants } = require('oae-activity/lib/constants');
const ActivityTestsUtil = require('oae-activity/lib/test/util');
const RestAPI = require('oae-rest');
const { RestContext } = require('oae-rest/lib/model');
const TestsUtil = require('oae-tests');

const { ContentConstants } = require('oae-content/lib/constants');

describe('Content Push', () => {
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
            }
          };

          ActivityTestsUtil.getFullySetupPushClient(data, client => {
            // Create a content item and get its full profile so we have a signature that we can use to register for push notifications
            RestAPI.Content.createLink(
              simong.restContext,
              'content',
              'A piece of content',
              'private',
              'http://www.google.com',
              [branden.user.id],
              [],
              [],
              (err, contentObj) => {
                assert.ok(!err);
                RestAPI.Content.getContent(simong.restContext, contentObj.id, (err, contentObj) => {
                  assert.ok(!err);

                  // Ensure we get a 400 error with an invalid activity stream id
                  client.subscribe(contentObj.id, null, contentObj.signature, null, err => {
                    assert.strictEqual(err.code, 400);

                    // Ensure we get a 400 error with a missing resource id
                    client.subscribe(null, 'activity', contentObj.signature, null, err => {
                      assert.strictEqual(err.code, 400);

                      // Ensure we get a 400 error with an invalid token
                      client.subscribe(
                        contentObj.id,
                        'activity',
                        { signature: 'foo' },
                        null,
                        err => {
                          assert.strictEqual(err.code, 401);
                          client.subscribe(
                            contentObj.id,
                            'activity',
                            { expires: Date.now() + 10000 },
                            null,
                            err => {
                              assert.strictEqual(err.code, 401);

                              // Ensure we get a 401 error with an incorrect signature
                              client.subscribe(
                                contentObj.id,
                                'activity',
                                { expires: Date.now() + 10000, signature: 'foo' },
                                null,
                                err => {
                                  assert.strictEqual(err.code, 401);

                                  // Simon should not be able to use a signature that was generated for Branden
                                  RestAPI.Content.getContent(
                                    branden.restContext,
                                    contentObj.id,
                                    (err, contentObjForBranden) => {
                                      assert.ok(!err);
                                      client.subscribe(
                                        contentObj.id,
                                        'activity',
                                        contentObjForBranden.signature,
                                        null,
                                        err => {
                                          assert.strictEqual(err.code, 401);

                                          // Sanity check a valid signature works
                                          client.subscribe(
                                            contentObj.id,
                                            'activity',
                                            contentObj.signature,
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
     * Utility method that returns a stream that points to an OAE animation thumbnail.
     *
     * @return {Stream}     A stream that points to an OAE animation thumbnail that can be uploaded.
     */
    const getFileStream = function() {
      const file = path.join(__dirname, '/data/oae-video.png');
      return fs.createReadStream(file);
    };

    /**
     * Creates 2 users: `Branden` and `Simon` who are both managers of a file. A websocket will be created
     * for the `Simon`-user which is both authenticated and registered for push notifications on the file.
     *
     * @param  {Function}   callback            Standard callback function
     * @param  {Object}     callback.contexts   An object that holds the context and user info for the created users
     * @param  {Content}    callback.content    The created piece of content
     * @param  {Client}     callback.client     A websocket client that is authenticated for the `Simon`-user and is registered for push notificates on the created piece of content
     * @throws {Error}                          If anything goes wrong, an assertion error will be thrown
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

          // Create a piece of content and get the full content profile so we have a signature that we can use to register for push notifications
          RestAPI.Content.createFile(
            contexts.simon.restContext,
            'A file',
            'A proper file',
            'private',
            getFileStream,
            [contexts.branden.user.id],
            [],
            [],
            (err, contentObj) => {
              assert.ok(!err);
              RestAPI.Content.getContent(
                contexts.simon.restContext,
                contentObj.id,
                (err, contentObj) => {
                  assert.ok(!err);

                  // Route and deliver activities
                  ActivityTestsUtil.collectAndGetActivityStream(
                    contexts.simon.restContext,
                    null,
                    null,
                    (err, activities) => {
                      assert.ok(!err);

                      // Register for some streams
                      const data = {
                        authentication: {
                          userId: contexts.simon.user.id,
                          tenantAlias: simonFull.tenant.alias,
                          signature: simonFull.signature
                        },
                        streams: [
                          {
                            resourceId: contentObj.id,
                            streamType: 'activity',
                            token: contentObj.signature
                          },
                          {
                            resourceId: contentObj.id,
                            streamType: 'message',
                            token: contentObj.signature
                          }
                        ]
                      };

                      ActivityTestsUtil.getFullySetupPushClient(data, client => {
                        callback(contexts, contentObj, client);
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
     * Test that verifies a content update gets pushed out
     */
    it('verify content updates trigger a push notification', callback => {
      setupFixture((contexts, contentObj, client) => {
        // Trigger an update
        RestAPI.Content.updateContent(
          contexts.branden.restContext,
          contentObj.id,
          { displayName: 'Laaike whatevs' },
          err => {
            assert.ok(!err);
          }
        );

        ActivityTestsUtil.waitForPushActivity(
          client,
          ContentConstants.activity.ACTIVITY_CONTENT_UPDATE,
          ActivityConstants.verbs.UPDATE,
          contexts.branden.user.id,
          contentObj.id,
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
     * Test that verifies a content visibility update gets pushed out
     */
    it('verify content visibility updates trigger a push notification', callback => {
      setupFixture((contexts, contentObj, client) => {
        // Trigger an update
        RestAPI.Content.updateContent(
          contexts.branden.restContext,
          contentObj.id,
          { visibility: 'loggedin' },
          err => {
            assert.ok(!err);
          }
        );

        ActivityTestsUtil.waitForPushActivity(
          client,
          ContentConstants.activity.ACTIVITY_CONTENT_UPDATE_VISIBILITY,
          ActivityConstants.verbs.UPDATE,
          contexts.branden.user.id,
          contentObj.id,
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
     * Test that verifies a new revision gets pushed out
     */
    it('verify a new revision triggers a push notification', callback => {
      setupFixture((contexts, contentObj, client) => {
        // Upload a new revision
        RestAPI.Content.updateFileBody(
          contexts.branden.restContext,
          contentObj.id,
          getFileStream,
          err => {
            assert.ok(!err);
          }
        );

        ActivityTestsUtil.waitForPushActivity(
          client,
          ContentConstants.activity.ACTIVITY_CONTENT_REVISION,
          ActivityConstants.verbs.UPDATE,
          contexts.branden.user.id,
          contentObj.id,
          null,
          activity => {
            // Verify we have the latest revision id available for reloading of any links/images
            RestAPI.Content.getContent(
              contexts.branden.restContext,
              contentObj.id,
              (err, contentObj) => {
                assert.ok(!err);
                assert.strictEqual(activity.object.latestRevisionId, contentObj.latestRevisionId);
                return client.close(callback);
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies restoring a revision gets pushed out
     */
    it('verify restoring a revision triggers a push notification', callback => {
      setupFixture((contexts, contentObj, client) => {
        const initialRevisionId = contentObj.latestRevisionId;

        // Upload a new revision
        RestAPI.Content.updateFileBody(
          contexts.branden.restContext,
          contentObj.id,
          getFileStream,
          err => {
            assert.ok(!err);

            // Restore the previous revision
            RestAPI.Content.restoreRevision(
              contexts.branden.restContext,
              contentObj.id,
              initialRevisionId,
              (err, revisionObj) => {
                assert.ok(!err);
              }
            );

            ActivityTestsUtil.waitForPushActivity(
              client,
              ContentConstants.activity.ACTIVITY_CONTENT_RESTORED_REVISION,
              ActivityConstants.verbs.UPDATE,
              contexts.branden.user.id,
              contentObj.id,
              null,
              activity => {
                // Verify we have the latest revision id available for reloading of any links/images
                RestAPI.Content.getContent(
                  contexts.branden.restContext,
                  contentObj.id,
                  (err, contentObj) => {
                    assert.ok(!err);
                    assert.strictEqual(
                      activity.object.latestRevisionId,
                      contentObj.latestRevisionId
                    );
                    return client.close(callback);
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies a new comment gets pushed out
     */
    it('verify a new comment triggers a push notification', callback => {
      setupFixture((contexts, contentObj, client) => {
        let comment = null;
        let activity = null;

        /*!
                 * Perform the assertions between the activity and comment and finish the test
                 */
        const _assertAndCallback = _.after(2, () => {
          // Verify that we have access to the message body and createdBy property
          assert.strictEqual(activity.object[ActivityConstants.properties.OAE_ID], comment.id);
          assert.strictEqual(activity.object.body, 'Cup a Soup');
          assert.ok(_.isObject(activity.object.createdBy));
          assert.strictEqual(activity.object.createdBy.id, contexts.branden.user.id);
          return client.close(callback);
        });

        // Create a message
        RestAPI.Content.createComment(
          contexts.branden.restContext,
          contentObj.id,
          'Cup a Soup',
          null,
          (err, _comment) => {
            assert.ok(!err);
            comment = _comment;
            return _assertAndCallback();
          }
        );

        ActivityTestsUtil.waitForPushActivity(
          client,
          ContentConstants.activity.ACTIVITY_CONTENT_COMMENT,
          ActivityConstants.verbs.POST,
          contexts.branden.user.id,
          null,
          contentObj.id,
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
    it("verify a comment author's profile gets scrubbed", callback => {
      setupFixture((contexts, contentObj, client) => {
        RestAPI.User.updateUser(
          contexts.branden.restContext,
          contexts.branden.user.id,
          { visibility: 'private', publicAlias: 'Ma Baker' },
          err => {
            assert.ok(!err);
            let comment = null;
            let activity = null;

            /*!
                     * Perform the assertions between the activity and comment and finish the test
                     */
            const _assertAndCallback = _.after(2, () => {
              // Verify that we have access to the message body and createdBy property
              assert.strictEqual(activity.object[ActivityConstants.properties.OAE_ID], comment.id);
              assert.strictEqual(activity.object.body, 'Cup a Soup');
              assert.strictEqual(activity.object.createdBy.visibility, 'private');
              assert.strictEqual(activity.object.createdBy.displayName, 'Ma Baker');
              return client.close(callback);
            });

            // Create a message
            RestAPI.Content.createComment(
              contexts.branden.restContext,
              contentObj.id,
              'Cup a Soup',
              null,
              (err, _comment) => {
                assert.ok(!err);
                comment = _comment;
                return _assertAndCallback();
              }
            );

            // Wait for the target activity to be fired in the client
            ActivityTestsUtil.waitForPushActivity(
              client,
              ContentConstants.activity.ACTIVITY_CONTENT_COMMENT,
              ActivityConstants.verbs.POST,
              contexts.branden.user.id,
              null,
              contentObj.id,
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
