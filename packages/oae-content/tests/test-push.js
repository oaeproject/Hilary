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

import { assert } from 'chai';
import fs from 'fs';
import path from 'path';

import { ActivityConstants } from 'oae-activity/lib/constants';
import * as ActivityTestsUtil from 'oae-activity/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

import { equals } from 'ramda';
import { ContentConstants } from 'oae-content/lib/constants';

const PRIVATE = 'private';
const ACTIVITY = 'activity';
const MESSAGE = 'message';
const LOGGEDIN = 'loggedin';
const NO_VIEWERS = [];
const NO_FOLDERS = [];

const { waitForPushActivity, collectAndGetActivityStream, getFullySetupPushClient } = ActivityTestsUtil;
const { createTenantAdminRestContext, generateTestUsers } = TestsUtil;
const { updateUser, getMe } = RestAPI.User;
const {
  createComment,
  restoreRevision,
  updateFileBody,
  createLink,
  createFile,
  updateContent,
  getContent
} = RestAPI.Content;

describe('Content Push', () => {
  // Rest contexts that can be used performing rest requests
  let localAdminRestContext = null;

  /**
   * Function that will fill up the tenant admin and anymous rest contexts
   */
  before(callback => {
    localAdminRestContext = createTenantAdminRestContext(global.oaeTests.tenants.localhost.host);
    callback();
  });

  describe('Authorization', () => {
    /**
     * Test that verifies registering for a feed goes through the proper authorization checks
     */
    it('verify signatures must be valid', callback => {
      generateTestUsers(localAdminRestContext, 2, (err, users) => {
        assert.notExists(err);

        const { 0: homer, 1: marge } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;

        getMe(asHomer, (err, homerInfo) => {
          assert.notExists(err);

          const data = {
            authentication: {
              userId: homerInfo.id,
              tenantAlias: homerInfo.tenant.alias,
              signature: homerInfo.signature
            }
          };

          getFullySetupPushClient(data, client => {
            // Create a content item and get its full profile so we have a signature that we can use to register for push notifications
            createLink(
              asHomer,
              {
                displayName: 'content',
                description: 'A piece of content',
                visibility: PRIVATE,
                link: 'http://www.google.com',
                managers: [marge.user.id],
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (err, contentObj) => {
                assert.notExists(err);
                getContent(asHomer, contentObj.id, (err, contentObj) => {
                  assert.notExists(err);

                  // Ensure we get a 400 error with an invalid activity stream id
                  client.subscribe(contentObj.id, null, contentObj.signature, null, err => {
                    assert.strictEqual(err.code, 400);

                    // Ensure we get a 400 error with a missing resource id
                    client.subscribe(null, ACTIVITY, contentObj.signature, null, err => {
                      assert.strictEqual(err.code, 400);

                      // Ensure we get a 400 error with an invalid token
                      client.subscribe(contentObj.id, ACTIVITY, { signature: 'foo' }, null, err => {
                        assert.strictEqual(err.code, 401);
                        client.subscribe(contentObj.id, ACTIVITY, { expires: Date.now() + 10000 }, null, err => {
                          assert.strictEqual(err.code, 401);

                          // Ensure we get a 401 error with an incorrect signature
                          client.subscribe(
                            contentObj.id,
                            ACTIVITY,
                            { expires: Date.now() + 10000, signature: 'foo' },
                            null,
                            err => {
                              assert.strictEqual(err.code, 401);

                              // Homer should not be able to use a signature that was generated for Marge
                              getContent(asMarge, contentObj.id, (err, contentForMarge) => {
                                assert.notExists(err);
                                client.subscribe(contentObj.id, ACTIVITY, contentForMarge.signature, null, err => {
                                  assert.strictEqual(err.code, 401);

                                  // Sanity check a valid signature works
                                  client.subscribe(contentObj.id, ACTIVITY, contentObj.signature, null, err => {
                                    assert.notExists(err);
                                    return callback();
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
    const getFileStream = () => fs.createReadStream(path.join(__dirname, '/data/oae-video.png'));

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
      generateTestUsers(localAdminRestContext, 2, (err, users) => {
        assert.notExists(err);

        const { 1: homer, 0: marge } = users;
        const asHomer = homer.restContext;

        // Get the full profile so we have a signature to authenticate ourselves on the WS
        getMe(asHomer, (err, homerInfo) => {
          assert.notExists(err);

          // Create a piece of content and get the full content profile so we have a signature that we can use to register for push notifications
          createFile(
            asHomer,
            {
              displayName: 'A file',
              description: 'A proper file',
              visibility: PRIVATE,
              file: getFileStream,
              managers: [marge.user.id],
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (err, contentObj) => {
              assert.notExists(err);
              getContent(asHomer, contentObj.id, (err, contentObj) => {
                assert.notExists(err);

                // Route and deliver activities
                collectAndGetActivityStream(asHomer, null, null, (err /* , activities */) => {
                  assert.notExists(err);

                  // Register for some streams
                  const data = {
                    authentication: {
                      userId: homer.user.id,
                      tenantAlias: homerInfo.tenant.alias,
                      signature: homerInfo.signature
                    },
                    streams: [
                      {
                        resourceId: contentObj.id,
                        streamType: ACTIVITY,
                        token: contentObj.signature
                      },
                      {
                        resourceId: contentObj.id,
                        streamType: MESSAGE,
                        token: contentObj.signature
                      }
                    ]
                  };

                  getFullySetupPushClient(data, client => {
                    callback({ marge, homer }, contentObj, client);
                  });
                });
              });
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
        const { marge } = contexts;
        const asMarge = marge.restContext;

        // Trigger an update
        updateContent(asMarge, contentObj.id, { displayName: 'Laaike whatevs' }, err => {
          assert.notExists(err);
        });

        waitForPushActivity(
          client,
          ContentConstants.activity.ACTIVITY_CONTENT_UPDATE,
          ActivityConstants.verbs.UPDATE,
          marge.user.id,
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
        const { marge } = contexts;
        const asMarge = marge.restContext;

        // Trigger an update
        updateContent(asMarge, contentObj.id, { visibility: LOGGEDIN }, err => {
          assert.notExists(err);
        });

        waitForPushActivity(
          client,
          ContentConstants.activity.ACTIVITY_CONTENT_UPDATE_VISIBILITY,
          ActivityConstants.verbs.UPDATE,
          marge.user.id,
          contentObj.id,
          null,
          activity => {
            // Verify the updated visibility setting is present on the activity object
            assert.strictEqual(activity.object.visibility, LOGGEDIN);
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
        const { marge } = contexts;
        const asMarge = marge.restContext;

        // Upload a new revision
        updateFileBody(asMarge, contentObj.id, getFileStream, err => {
          assert.notExists(err);
        });

        waitForPushActivity(
          client,
          ContentConstants.activity.ACTIVITY_CONTENT_REVISION,
          ActivityConstants.verbs.UPDATE,
          marge.user.id,
          contentObj.id,
          null,
          activity => {
            // Verify we have the latest revision id available for reloading of any links/images
            getContent(asMarge, contentObj.id, (err, contentObj) => {
              assert.notExists(err);
              assert.strictEqual(activity.object.latestRevisionId, contentObj.latestRevisionId);
              return client.close(callback);
            });
          }
        );
      });
    });

    /**
     * Test that verifies restoring a revision gets pushed out
     */
    it('verify restoring a revision triggers a push notification', callback => {
      setupFixture((contexts, contentObj, client) => {
        const { marge } = contexts;
        const asMarge = marge.restContext;
        const initialRevisionId = contentObj.latestRevisionId;

        // Upload a new revision
        updateFileBody(asMarge, contentObj.id, getFileStream, err => {
          assert.notExists(err);

          // Restore the previous revision
          restoreRevision(asMarge, contentObj.id, initialRevisionId, (err /* , revisionObj */) => {
            assert.notExists(err);
          });

          waitForPushActivity(
            client,
            ContentConstants.activity.ACTIVITY_CONTENT_RESTORED_REVISION,
            ActivityConstants.verbs.UPDATE,
            marge.user.id,
            contentObj.id,
            null,
            activity => {
              // Verify we have the latest revision id available for reloading of any links/images
              getContent(asMarge, contentObj.id, (err, contentObj) => {
                assert.notExists(err);
                assert.strictEqual(activity.object.latestRevisionId, contentObj.latestRevisionId);
                return client.close(callback);
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies a new comment gets pushed out
     */
    it('verify a new comment triggers a push notification', callback => {
      setupFixture((contexts, contentObj, client) => {
        const { marge } = contexts;
        const asMarge = marge.restContext;

        let comment = null;
        let activity = null;
        let commentsCreated = 0;
        const theresTwoOf = equals(2);

        /*!
         * Perform the assertions between the activity and comment and finish the test
         */
        const _assertAndCallback = () => {
          commentsCreated++;

          if (theresTwoOf(commentsCreated)) {
            // Verify that we have access to the message body and createdBy property
            assert.strictEqual(activity.object[ActivityConstants.properties.OAE_ID], comment.id);
            assert.strictEqual(activity.object.body, 'Cup a Soup');
            assert.isObject(activity.object.createdBy);
            assert.strictEqual(activity.object.createdBy.id, marge.user.id);
            return client.close(callback);
          }
        };

        // Create a message
        createComment(asMarge, contentObj.id, 'Cup a Soup', null, (err, _comment) => {
          assert.notExists(err);
          comment = _comment;
          return _assertAndCallback();
        });

        waitForPushActivity(
          client,
          ContentConstants.activity.ACTIVITY_CONTENT_COMMENT,
          ActivityConstants.verbs.POST,
          marge.user.id,
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
        const { marge } = contexts;
        const asMarge = marge.restContext;
        let commentsCreated = 0;
        const theresTwoOf = equals(2);

        updateUser(asMarge, marge.user.id, { visibility: PRIVATE, publicAlias: 'Ma Baker' }, err => {
          assert.notExists(err);
          let comment = null;
          let activity = null;

          /*!
           * Perform the assertions between the activity and comment and finish the test
           */
          const _assertAndCallback = () => {
            commentsCreated++;
            if (theresTwoOf(commentsCreated)) {
              // Verify that we have access to the message body and createdBy property
              assert.strictEqual(activity.object[ActivityConstants.properties.OAE_ID], comment.id);
              assert.strictEqual(activity.object.body, 'Cup a Soup');
              assert.strictEqual(activity.object.createdBy.visibility, PRIVATE);
              assert.strictEqual(activity.object.createdBy.displayName, 'Ma Baker');
              return client.close(callback);
            }
          };

          // Create a message
          createComment(asMarge, contentObj.id, 'Cup a Soup', null, (err, _comment) => {
            assert.notExists(err);
            comment = _comment;
            return _assertAndCallback();
          });

          // Wait for the target activity to be fired in the client
          waitForPushActivity(
            client,
            ContentConstants.activity.ACTIVITY_CONTENT_COMMENT,
            ActivityConstants.verbs.POST,
            marge.user.id,
            null,
            contentObj.id,
            _activity => {
              activity = _activity;
              return _assertAndCallback();
            }
          );
        });
      });
    });
  });
});
