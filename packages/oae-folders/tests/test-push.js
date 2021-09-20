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
import _ from 'underscore';

import { ActivityConstants } from 'oae-activity/lib/constants.js';
import * as ActivityTestsUtil from 'oae-activity/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

import { FoldersConstants } from 'oae-folders/lib/constants.js';
import * as FoldersTestUtil from 'oae-folders/lib/test/util';

const PUBLIC = 'public';
const PRIVATE = 'private';

describe('Folders - Push', () => {
  // Rest contexts that can be used performing rest requests
  let asLocalhostTenantAdmin = null;

  /**
   * Function that will fill up the tenant admin and anymous rest contexts
   */
  before((done) => {
    asLocalhostTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.localhost.host);
    done();
  });

  describe('Authorization', () => {
    /**
     * Test that verifies registering for a feed goes through the proper authorization checks
     */
    it('verify signatures must be valid', (callback) => {
      TestsUtil.generateTestUsers(asLocalhostTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge } = users;

        RestAPI.User.getMe(homer.restContext, (error, homerInfo) => {
          assert.notExists(error);

          const data = {
            authentication: {
              userId: homerInfo.id,
              tenantAlias: homerInfo.tenant.alias,
              signature: homerInfo.signature
            },
            feeds: []
          };

          ActivityTestsUtil.getFullySetupPushClient(data, (client) => {
            // Create a folder and get its full profile so we have a signature that we can use to register for push notifications
            FoldersTestUtil.assertCreateFolderSucceeds(
              homer.restContext,
              'test displayName',
              'test description',
              PRIVATE,
              [marge],
              [],
              (folder) => {
                FoldersTestUtil.assertGetFolderSucceeds(homer.restContext, folder.id, (folder) => {
                  // Ensure we get a 400 error with an invalid activity stream id
                  client.subscribe(folder.id, null, folder.signature, null, (error_) => {
                    assert.strictEqual(error_.code, 400);

                    // Ensure we get a 400 error with a missing resource id
                    client.subscribe(null, 'activity', folder.signature, null, (error_) => {
                      assert.strictEqual(error_.code, 400);

                      // Ensure we get a 400 error with an invalid token
                      client.subscribe(
                        folder.id,
                        'activity',
                        { signature: folder.signature.signature },
                        null,
                        (error_) => {
                          assert.strictEqual(error_.code, 401);
                          client.subscribe(
                            folder.id,
                            'activity',
                            { expires: folder.signature.expires },
                            null,
                            (error_) => {
                              assert.strictEqual(error_.code, 401);

                              // Ensure we get a 401 error with an incorrect signature
                              client.subscribe(
                                folder.id,
                                'activity',
                                { expires: Date.now() + 10000, signature: 'foo' },
                                null,
                                (error_) => {
                                  assert.strictEqual(error_.code, 401);

                                  // Simon should not be able to use a signature that was generated for Branden
                                  FoldersTestUtil.assertGetFolderSucceeds(
                                    marge.restContext,
                                    folder.id,
                                    (folderForBranden) => {
                                      client.subscribe(
                                        folder.id,
                                        'activity',
                                        folderForBranden.signature,
                                        null,
                                        (error_) => {
                                          assert.strictEqual(error_.code, 401);

                                          // Sanity check that a valid signature works
                                          client.subscribe(folder.id, 'activity', folder.signature, null, (error_) => {
                                            assert.notExists(error_);
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
     * Creates 2 users: `Branden` and `Simon` who are both managers of a folder. A websocket will be created
     * for the `Simon`-user which is both authenticated and registered for push notifications on the folder.
     *
     * @param  {Function}       callback                Standard callback function
     * @param  {Object}         callback.contexts       An object that holds the context and user info for the created users
     * @param  {Folder}         callback.folder         The created folder
     * @param  {Client}         callback.client         A websocket client that is authenticated for the `Simon`-user and is registered for push notificates on the created folder
     * @throws {Error}                                  If anything goes wrong, an assertion error will be thrown
     */
    const setupFixture = function (callback) {
      TestsUtil.generateTestUsers(asLocalhostTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: branden, 1: simon } = users;

        const contexts = {
          branden,
          simon
        };

        // Get the full profile so we have a signature to authenticate ourselves on the WS
        RestAPI.User.getMe(simon.restContext, (error, simonFull) => {
          assert.notExists(error);

          // Create a folder and get the full folder profile so we have a signature that we can use to register for push notifications
          FoldersTestUtil.assertCreateFolderSucceeds(
            simon.restContext,
            'test displayName',
            'test description',
            PRIVATE,
            [branden],
            [],
            (folder) => {
              FoldersTestUtil.assertGetFolderSucceeds(simon.restContext, folder.id, (folder) => {
                // Route and deliver activities
                ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, null, null, () => {
                  // Register for some streams
                  const data = {
                    authentication: {
                      userId: simon.user.id,
                      tenantAlias: simonFull.tenant.alias,
                      signature: simonFull.signature
                    },
                    streams: [
                      {
                        resourceId: folder.id,
                        streamType: 'activity',
                        token: folder.signature
                      },
                      {
                        resourceId: folder.id,
                        streamType: 'message',
                        token: folder.signature
                      }
                    ]
                  };

                  ActivityTestsUtil.getFullySetupPushClient(data, (client) => {
                    callback(contexts, folder, client);
                  });
                });
              });
            }
          );
        });
      });
    };

    const isMessageFromFolderCreation = (message) => {
      return _.last(message.activities).verb === 'create';
    };

    /**
     * Test that verifies an update gets pushed out
     */
    it('verify updates trigger a push notification', (callback) => {
      setupFixture((contexts, folder, client) => {
        // Trigger an update
        RestAPI.Folders.updateFolder(
          contexts.branden.restContext,
          folder.id,
          { displayName: 'Laaike whatevs' },
          (error /* , data */) => {
            assert.notExists(error);
          }
        );

        client.on('message', (message) => {
          ActivityTestsUtil.assertActivity(
            message.activities[0],
            FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE,
            ActivityConstants.verbs.UPDATE,
            contexts.branden.user.id,
            folder.id
          );

          // Verify the updated display name is present on the activity object
          assert.strictEqual(message.activities[0].object.displayName, 'Laaike whatevs');

          client.close(callback);
        });
      });
    });

    /**
     * Test that verifies a visibility update gets pushed out
     */
    it('verify visibility updates trigger a push notification', (callback) => {
      setupFixture((contexts, folder, client) => {
        // Trigger an update
        RestAPI.Folders.updateFolder(contexts.branden.restContext, folder.id, { visibility: 'loggedin' }, (error) => {
          assert.notExists(error);
        });

        client.on('message', (message) => {
          if (isMessageFromFolderCreation(message)) {
            return;
          }

          ActivityTestsUtil.assertActivity(
            message.activities[0],
            FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_VISIBILITY,
            ActivityConstants.verbs.UPDATE,
            contexts.branden.user.id,
            folder.id
          );

          // Verify the updated visibility setting is present on the activity object
          assert.strictEqual(message.activities[0].object['oae:visibility'], 'loggedin');

          client.close(callback);
        });
      });
    });

    /**
     * Test that verifies a comment gets pushed out
     */
    it('verify comments trigger a push notification', (callback) => {
      setupFixture((contexts, folder, client) => {
        let seenFirstComment = false;
        let initialComment = null;
        let reply = null;

        // Create a comment
        FoldersTestUtil.assertCreateMessageSucceeds(
          contexts.branden.restContext,
          folder.id,
          'Message body',
          null,
          (_initialComment) => {
            initialComment = _initialComment;
          }
        );

        client.on('message', (message) => {
          if (isMessageFromFolderCreation(message)) {
            return;
          }

          if (seenFirstComment) {
            // This should be the reply message. Because comments are delivered to websockets
            // on routing, this message will not aggregate with the previous activity. It should
            // however contain the id of the comment on which this message is a reply
            ActivityTestsUtil.assertActivity(
              message.activities[0],
              FoldersConstants.activity.ACTIVITY_FOLDER_COMMENT,
              ActivityConstants.verbs.POST,
              contexts.branden.user.id,
              reply.id,
              folder.id
            );

            // Verify the message is present on the activity object
            assert.strictEqual(message.activities[0].object.body, reply.body);
            assert.strictEqual(message.activities[0].object.created, reply.created);
            assert.strictEqual(message.activities[0].object.replyTo, initialComment.created);
            client.close(callback);
          } else {
            seenFirstComment = true;

            // Assert the push message contains all the correct entities
            ActivityTestsUtil.assertActivity(
              message.activities[0],
              FoldersConstants.activity.ACTIVITY_FOLDER_COMMENT,
              ActivityConstants.verbs.POST,
              contexts.branden.user.id,
              initialComment.id,
              folder.id
            );

            // Verify the comment properties are present on the activity object
            assert.strictEqual(message.activities[0].object.body, initialComment.body);
            assert.strictEqual(message.activities[0].object.created, initialComment.created);

            // Reply on the original message to test whether replies are correctly routed
            FoldersTestUtil.assertCreateMessageSucceeds(
              contexts.branden.restContext,
              folder.id,
              'Message body',
              initialComment.created,
              (_reply) => {
                reply = _reply;
              }
            );
          }
        });
      });
    });

    /**
     * Test that verifies add-to-folder activities do not get pushed out via push notifications
     */
    it('verify add-to-folder activities do not trigger a push notification', (callback) => {
      setupFixture((contexts, folder, client) => {
        // Add an item to a folder
        RestAPI.Content.createLink(
          contexts.simon.restContext,
          {
            displayName: 'test',
            description: 'test',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: null,
            viewers: null,
            folders: [folder.id]
          },
          (error /* , someLink */) => {
            assert.notExists(error);
          }
        );

        client.on('message', (message) => {
          assert.notStrictEqual(
            message.activities[0]['oae:activityType'],
            FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER
          );
        });

        // This timeout is not ideal, but we need to give the activity router some time to let it do its thing
        setTimeout(() => {
          client.close(callback);
        }, 300);
      });
    });
  });
});
