/*
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
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

import fs from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import _ from 'underscore';

import { assert } from 'chai';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as FoldersDAO from 'oae-folders/lib/internal/dao.js';
import * as FoldersTestUtil from 'oae-folders/lib/test/util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PUBLIC = 'public';

describe('Folders', () => {
  let asCambridgeTenantAdmin = null;

  /*!
   * Set up all the REST contexts for admin and anonymous users with which we
   * will invoke requests
   */
  before((done) => {
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    return done();
  });

  describe('Posting messages', () => {
    /**
     * Test that verifies input validation when creating a message
     */
    it('verify message creation validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: user1 } = users;

        // Create a folder to test with
        FoldersTestUtil.assertCreateFolderSucceeds(
          user1.restContext,
          'test displayName',
          'test description',
          PUBLIC,
          [],
          [],
          (folder) => {
            // Test invalid folder id
            FoldersTestUtil.assertCreateMessageFails(user1.restContext, 'not-a-valid-id', 'a body', null, 400, () => {
              // Test not existing folder id
              FoldersTestUtil.assertCreateMessageFails(user1.restContext, 'f:foo:bar', 'a body', null, 404, () => {
                // Test no body
                FoldersTestUtil.assertCreateMessageFails(user1.restContext, folder.id, null, null, 400, () => {
                  // Test invalid reply-to timestamp
                  FoldersTestUtil.assertCreateMessageFails(user1.restContext, folder.id, 'a body', 'NaN', 400, () => {
                    // Test non-existing reply-to timestamp
                    FoldersTestUtil.assertCreateMessageFails(
                      user1.restContext,
                      folder.id,
                      'a body',
                      Date.now(),
                      400,
                      () => {
                        // Test a body that is longer than the maximum allowed size
                        const body = TestsUtil.generateRandomText(10_000);
                        FoldersTestUtil.assertCreateMessageFails(user1.restContext, folder.id, body, null, 400, () => {
                          // Sanity check
                          FoldersTestUtil.assertCreateMessageSucceeds(
                            user1.restContext,
                            folder.id,
                            'a body',
                            null,
                            (message) => {
                              assert.ok(message);
                              return callback();
                            }
                          );
                        });
                      }
                    );
                  });
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies the model of created messages, and permissions of creating messages on different types of folders
     */
    it('verify creating a message, model and permissions', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenant, publicTenant1, privateTenant /* , privateTenant1 */) => {
          // Cannot post message as anonymous user
          FoldersTestUtil.assertCreateMessageFails(
            publicTenant.anonymousRestContext,
            publicTenant.publicFolder.id,
            'a body',
            null,
            401,
            () => {
              // Cannot post to private folder as non-member
              FoldersTestUtil.assertCreateMessageFails(
                publicTenant.privateUser.restContext,
                publicTenant.privateFolder.id,
                'a body',
                null,
                401,
                () => {
                  // Can post as an authenticated user from the same tenant, verify the model
                  FoldersTestUtil.assertCreateMessageSucceeds(
                    publicTenant.publicUser.restContext,
                    publicTenant.publicFolder.id,
                    'Top-level message',
                    null,
                    (message) => {
                      assert.ok(message);

                      // This is the expected messagebox id of the folder
                      const messageBoxId = publicTenant.publicFolder.id;

                      assert.strictEqual(message.id, messageBoxId + '#' + message.created);
                      assert.strictEqual(message.messageBoxId, messageBoxId);
                      assert.strictEqual(message.threadKey, message.created + '|');
                      assert.strictEqual(message.body, 'Top-level message');
                      assert.strictEqual(message.createdBy.id, publicTenant.publicUser.user.id);
                      assert.notStrictEqual(Number.parseInt(message.created, 10), Number.NaN);
                      assert.strictEqual(message.level, 0);
                      assert.ok(!message.replyTo);

                      // Reply to that message and verify the model
                      FoldersTestUtil.assertCreateMessageSucceeds(
                        publicTenant.loggedinUser.restContext,
                        publicTenant.publicFolder.id,
                        'Reply message',
                        message.created,
                        (replyMessage) => {
                          assert.ok(replyMessage);

                          // This is the expected replyMessagebox id of the folder
                          assert.strictEqual(replyMessage.id, messageBoxId + '#' + replyMessage.created);
                          assert.strictEqual(replyMessage.messageBoxId, messageBoxId);
                          assert.strictEqual(
                            replyMessage.threadKey,
                            message.created + '#' + replyMessage.created + '|'
                          );
                          assert.strictEqual(replyMessage.body, 'Reply message');
                          assert.strictEqual(replyMessage.createdBy.id, publicTenant.loggedinUser.user.id);
                          assert.notStrictEqual(Number.parseInt(replyMessage.created, 10), Number.NaN);
                          assert.strictEqual(replyMessage.level, 1);
                          assert.ok(replyMessage.replyTo, message.created);

                          // Cross-tenant user from public tenant can post to a public folder
                          FoldersTestUtil.assertCreateMessageSucceeds(
                            publicTenant1.loggedinUser.restContext,
                            publicTenant.publicFolder.id,
                            'Message from external user',
                            null,
                            (message) => {
                              assert.ok(message);

                              // Cross-tenant user from public tenant cannot post to a loggedin folder
                              FoldersTestUtil.assertCreateMessageFails(
                                publicTenant1.publicUser.restContext,
                                publicTenant.loggedinFolder.id,
                                'Message from external user',
                                null,
                                401,
                                () => {
                                  // Cross-tenant user from private tenant cannot post to a public folder
                                  FoldersTestUtil.assertCreateMessageFails(
                                    privateTenant.publicUser.restContext,
                                    publicTenant.publicFolder.id,
                                    'Message from external user',
                                    null,
                                    401,
                                    () => {
                                      // Cross-tenant admin cannot post to a loggedin folder
                                      FoldersTestUtil.assertCreateMessageFails(
                                        publicTenant1.adminRestContext,
                                        publicTenant.loggedinFolder.id,
                                        'Message from external user',
                                        null,
                                        401,
                                        () => {
                                          // Can post to private folder as a member. Share it, then test creating a message
                                          FoldersTestUtil.assertShareFolderSucceeds(
                                            publicTenant.adminRestContext,
                                            publicTenant.adminRestContext,
                                            publicTenant.privateFolder.id,
                                            [publicTenant.privateUser],
                                            () => {
                                              FoldersTestUtil.assertCreateMessageSucceeds(
                                                publicTenant.privateUser.restContext,
                                                publicTenant.privateFolder.id,
                                                'Message from external user',
                                                null,
                                                (message) => {
                                                  assert.ok(message);

                                                  // Can post to folder as admin
                                                  FoldersTestUtil.assertCreateMessageSucceeds(
                                                    publicTenant.adminRestContext,
                                                    publicTenant.privateFolder.id,
                                                    'Message from tenant admin user',
                                                    null,
                                                    (message) => {
                                                      assert.ok(message);
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

    /**
     * Test that verifies that messages contain user profile pictures
     */
    it('verify messages contain user profile pictures', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: bert, 1: nicolaas } = users;

        /**
         * Return a profile picture stream
         *
         * @return {Stream}     A stream containing an profile picture
         */
        const getPictureStream = () => fs.createReadStream(path.join(__dirname, '/data/profilepic.jpg'));

        // Give one of the users a profile picture
        const cropArea = { x: 0, y: 0, width: 150, height: 150 };
        RestAPI.User.uploadPicture(bert.restContext, bert.user.id, getPictureStream, cropArea, (error_) => {
          assert.notExists(error_);

          // Create a folder and share it with a user that has no profile picture
          FoldersTestUtil.assertCreateFolderSucceeds(
            bert.restContext,
            'test displayName',
            'test description',
            PUBLIC,
            [],
            [nicolaas],
            (folder) => {
              // Add a message to the folder as a user with a profile picture
              FoldersTestUtil.assertCreateMessageSucceeds(
                bert.restContext,
                folder.id,
                'Message body 1',
                null,
                (message) => {
                  // Assert that the picture URLs are present
                  assert.ok(message.createdBy);
                  assert.ok(message.createdBy.picture);
                  assert.ok(message.createdBy.picture.small);
                  assert.ok(message.createdBy.picture.medium);
                  assert.ok(message.createdBy.picture.large);

                  // Assert that this works for replies as well
                  FoldersTestUtil.assertCreateMessageSucceeds(
                    bert.restContext,
                    folder.id,
                    'Message body 2',
                    message.created,
                    (reply) => {
                      // Assert that the picture URLs are present
                      assert.ok(reply.createdBy);
                      assert.ok(reply.createdBy.picture);
                      assert.ok(reply.createdBy.picture.small);
                      assert.ok(reply.createdBy.picture.medium);
                      assert.ok(reply.createdBy.picture.large);

                      // Add a message to the folder as a user with no profile picture
                      FoldersTestUtil.assertCreateMessageSucceeds(
                        nicolaas.restContext,
                        folder.id,
                        'Message body 3',
                        null,
                        (message) => {
                          // Assert that no picture URLs are present
                          assert.ok(message.createdBy);
                          assert.ok(message.createdBy.picture);
                          assert.ok(!message.createdBy.picture.small);
                          assert.ok(!message.createdBy.picture.medium);
                          assert.ok(!message.createdBy.picture.large);

                          // Assert that this works for replies as well
                          FoldersTestUtil.assertCreateMessageSucceeds(
                            nicolaas.restContext,
                            folder.id,
                            'Message body 4',
                            message.created,
                            (reply) => {
                              // Assert that no picture URLs are present
                              assert.ok(reply.createdBy);
                              assert.ok(reply.createdBy.picture);
                              assert.ok(!reply.createdBy.picture.small);
                              assert.ok(!reply.createdBy.picture.medium);
                              assert.ok(!reply.createdBy.picture.large);

                              // Assert the profile picture urls are present when retrieving a list of messages
                              FoldersTestUtil.assertGetMessagesSucceeds(
                                bert.restContext,
                                folder.id,
                                null,
                                10,
                                (messages) => {
                                  assert.strictEqual(messages.results.length, 4);
                                  _.each(messages.results, (message) => {
                                    assert.ok(message.createdBy);
                                    assert.ok(message.createdBy.picture);

                                    // Verify that the messages have a picture for the user that
                                    // has a profile picture
                                    if (message.createdBy.id === bert.user.id) {
                                      assert.ok(message.createdBy.picture.small);
                                      assert.ok(message.createdBy.picture.medium);
                                      assert.ok(message.createdBy.picture.large);

                                      // Verify that the messages don't have a picture for the user
                                      // without a profile picture
                                    } else if (message.createdBy.id === nicolaas.user.id) {
                                      assert.ok(!message.createdBy.picture.small);
                                      assert.ok(!message.createdBy.picture.medium);
                                      assert.ok(!message.createdBy.picture.large);
                                    } else {
                                      assert.fail('Unexpected user in messages');
                                    }
                                  });

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

    /**
     * Test that verifies a folder is updated at most every hour as a result of new message postings
     */
    it('verify folder update threshold with messages', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: simong } = users;

        // Create a folder to test with
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          PUBLIC,
          [],
          [],
          (folder) => {
            const lastModified1 = folder.lastModified;

            // Create a message to test with
            FoldersTestUtil.assertCreateMessageSucceeds(
              simong.restContext,
              folder.id,
              'My message',
              null,
              (/* message */) => {
                // Ensure lastModified didn't change because it is within the one hour threshold
                FoldersTestUtil.assertGetFolderSucceeds(simong.restContext, folder.id, (folder) => {
                  assert.notExists(error);
                  assert.strictEqual(folder.lastModified, lastModified1.toString());

                  // Force a naughty update through the DAO of the lastModified to more than an hour ago (threshold duration)
                  const lastModified0 = lastModified1 - 1 * 60 * 61 * 1000;
                  FoldersDAO.updateFolder(folder, { lastModified: lastModified0 }, (error, folder) => {
                    assert.notExists(error);
                    assert.strictEqual(folder.lastModified, lastModified0);

                    // Message again, this time the lastModified should update
                    FoldersTestUtil.assertCreateMessageSucceeds(
                      simong.restContext,
                      folder.id,
                      'My second message',
                      null,
                      (/* message */) => {
                        // Ensure the new lastModified is greater than the original creation one
                        setTimeout(
                          FoldersTestUtil.assertGetFolderSucceeds,
                          200,
                          simong.restContext,
                          folder.id,
                          (folder) => {
                            assert.ok(Number.parseInt(folder.lastModified, 10) > Number.parseInt(lastModified1, 10));

                            // Note at this time, since the lastModified of the folder updated under the hood without
                            // a library update, the library of user should 2 versions of this folder. Lets see if it
                            // auto-repairs
                            FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                              simong.restContext,
                              simong.user.id,
                              null,
                              null,
                              (items) => {
                                assert.strictEqual(items.results.length, 1);
                                return callback();
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

  describe('Listing messages', () => {
    /**
     * Test that verifies input validation of listing messages from a folder
     */
    it('verify list messages validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: simong } = users;

        // Create a folder to test with
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          PUBLIC,
          [],
          [],
          (folder) => {
            // Validate invalid folder id
            FoldersTestUtil.assertGetMessagesFails(simong.restContext, 'not-a-valid-id', null, null, 400, () => {
              // Non-existing folder
              FoldersTestUtil.assertGetMessagesFails(simong.restContext, 'f:foo:bar', null, null, 404, () => {
                // Sanity-check
                FoldersTestUtil.assertGetMessagesSucceeds(simong.restContext, folder.id, null, null, (messages) => {
                  assert.notExists(error);
                  assert.ok(messages);
                  return callback();
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies the model of messages, and permissions for accessing them
     */
    it('verify listing messages, model and permissions', (callback) => {
      /*!
       * Ensure that the message model is correct between the message to test and the message against which to test.
       *
       * @param  {Message}    messageToTest           The message to test
       * @param  {Message}    messageToTestAgainst    The message against which to test
       * @param  {User}       creatorToTestAgainst    The user data (i.e., `createdBy`) to test against for the message creator
       * @param  {Boolean}    userScrubbed            Whether or not the createdBy field should have scrubbed user data
       * @throws {Error}                              Throws an assertion error if the data fails assertions
       */
      const _assertMessageModel = function (messageToTest, messageToTestAgainst, creatorToTestAgainst, userScrubbed) {
        // Verify message model
        assert.strictEqual(messageToTest.id, messageToTestAgainst.id);
        assert.strictEqual(messageToTest.messageBoxId, messageToTestAgainst.messageBoxId);
        assert.strictEqual(messageToTest.threadKey, messageToTestAgainst.threadKey);
        assert.strictEqual(messageToTest.body, messageToTestAgainst.body);
        assert.strictEqual(messageToTest.created, messageToTestAgainst.created);
        assert.strictEqual(messageToTest.level, messageToTestAgainst.level);
        assert.strictEqual(messageToTest.replyTo, messageToTestAgainst.replyTo);

        // Verify creator model
        assert.ok(messageToTest.createdBy);
        assert.strictEqual(messageToTest.createdBy.tenant.alias, creatorToTestAgainst.tenant.alias);
        assert.strictEqual(messageToTest.createdBy.tenant.displayName, creatorToTestAgainst.tenant.displayName);
        assert.strictEqual(messageToTest.createdBy.visibility, creatorToTestAgainst.visibility);

        // Privacy check
        if (userScrubbed) {
          assert.strictEqual(messageToTest.createdBy.displayName, creatorToTestAgainst.publicAlias);
        } else {
          assert.strictEqual(messageToTest.createdBy.displayName, creatorToTestAgainst.displayName);
        }
      };

      // Set up the tenants for tenant privacy rule checking
      FoldersTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenant /* , publicTenant1, privateTenant, privateTenant1 */) => {
          // Create message structure on the public folder
          FoldersTestUtil.assertCreateMessageSucceeds(
            publicTenant.loggedinUser.restContext,
            publicTenant.publicFolder.id,
            'Message1 parent on public',
            null,
            (publicMessage1) => {
              FoldersTestUtil.assertCreateMessageSucceeds(
                publicTenant.loggedinUser.restContext,
                publicTenant.publicFolder.id,
                'Message1 reply on public',
                publicMessage1.created,
                (replyPublicMessage1) => {
                  FoldersTestUtil.assertCreateMessageSucceeds(
                    publicTenant.loggedinUser.restContext,
                    publicTenant.publicFolder.id,
                    'Message2 parent on public',
                    null,
                    (publicMessage2) => {
                      // Create message on the loggedin folder
                      FoldersTestUtil.assertCreateMessageSucceeds(
                        publicTenant.loggedinUser.restContext,
                        publicTenant.loggedinFolder.id,
                        'Message on loggedin',
                        null,
                        (loggedinMessage) => {
                          // Share and post message on the private folder
                          FoldersTestUtil.assertShareFolderSucceeds(
                            publicTenant.adminRestContext,
                            publicTenant.adminRestContext,
                            publicTenant.privateFolder.id,
                            [publicTenant.privateUser],
                            () => {
                              FoldersTestUtil.assertCreateMessageSucceeds(
                                publicTenant.privateUser.restContext,
                                publicTenant.privateFolder.id,
                                'Message on private',
                                null,
                                (privateMessage) => {
                                  // Anonymous can read on public, but not loggedin or private
                                  FoldersTestUtil.assertGetMessagesSucceeds(
                                    publicTenant.anonymousRestContext,
                                    publicTenant.publicFolder.id,
                                    null,
                                    null,
                                    (messages) => {
                                      assert.ok(messages);
                                      assert.strictEqual(messages.results.length, 3);

                                      // Verify the model of all 3 messages
                                      _assertMessageModel(
                                        messages.results[0],
                                        publicMessage2,
                                        publicTenant.loggedinUser.user,
                                        true
                                      );
                                      _assertMessageModel(
                                        messages.results[1],
                                        publicMessage1,
                                        publicTenant.loggedinUser.user,
                                        true
                                      );
                                      _assertMessageModel(
                                        messages.results[2],
                                        replyPublicMessage1,
                                        publicTenant.loggedinUser.user,
                                        true
                                      );

                                      FoldersTestUtil.assertGetMessagesFails(
                                        publicTenant.anonymousRestContext,
                                        publicTenant.loggedinFolder.id,
                                        null,
                                        null,
                                        401,
                                        (/* messages */) => {
                                          FoldersTestUtil.assertGetMessagesFails(
                                            publicTenant.anonymousRestContext,
                                            publicTenant.privateFolder.id,
                                            null,
                                            null,
                                            401,
                                            (/* messages */) => {
                                              // Authenticated user can read loggedin
                                              FoldersTestUtil.assertGetMessagesSucceeds(
                                                publicTenant.publicUser.restContext,
                                                publicTenant.loggedinFolder.id,
                                                null,
                                                null,
                                                (messages) => {
                                                  assert.ok(messages);
                                                  assert.strictEqual(messages.results.length, 1);

                                                  // Verify the model of the message, the loggedin user should not be scrubbed
                                                  _assertMessageModel(
                                                    messages.results[0],
                                                    loggedinMessage,
                                                    publicTenant.loggedinUser.user,
                                                    false
                                                  );

                                                  // Authenticated user cannot read private
                                                  FoldersTestUtil.assertGetMessagesFails(
                                                    publicTenant.publicUser.restContext,
                                                    publicTenant.privateFolder.id,
                                                    null,
                                                    null,
                                                    401,
                                                    (/* messages */) => {
                                                      // Member user can read private
                                                      FoldersTestUtil.assertGetMessagesSucceeds(
                                                        publicTenant.privateUser.restContext,
                                                        publicTenant.privateFolder.id,
                                                        null,
                                                        null,
                                                        (messages) => {
                                                          assert.ok(messages);
                                                          assert.strictEqual(messages.results.length, 1);

                                                          // Verify the model of the message, the loggedin user should not be scrubbed
                                                          _assertMessageModel(
                                                            messages.results[0],
                                                            privateMessage,
                                                            publicTenant.privateUser.user,
                                                            false
                                                          );

                                                          // Ensure paging of the messages
                                                          FoldersTestUtil.assertGetMessagesSucceeds(
                                                            publicTenant.anonymousRestContext,
                                                            publicTenant.publicFolder.id,
                                                            null,
                                                            2,
                                                            (messages) => {
                                                              assert.ok(messages);
                                                              assert.strictEqual(
                                                                messages.nextToken,
                                                                messages.results[1].threadKey
                                                              );

                                                              assert.strictEqual(messages.results.length, 2);

                                                              // Verify the model and ordering of the messages
                                                              _assertMessageModel(
                                                                messages.results[0],
                                                                publicMessage2,
                                                                publicTenant.loggedinUser.user,
                                                                true
                                                              );
                                                              _assertMessageModel(
                                                                messages.results[1],
                                                                publicMessage1,
                                                                publicTenant.loggedinUser.user,
                                                                true
                                                              );

                                                              // Try and get 2 more. Should only get 1 and it should be the 3rd message
                                                              FoldersTestUtil.assertGetMessagesSucceeds(
                                                                publicTenant.anonymousRestContext,
                                                                publicTenant.publicFolder.id,
                                                                publicMessage1.threadKey,
                                                                2,
                                                                (messages) => {
                                                                  assert.ok(messages);
                                                                  assert.strictEqual(messages.results.length, 1);
                                                                  assert.ok(!messages.nextToken);

                                                                  // Verify the model and ordering of the messages
                                                                  _assertMessageModel(
                                                                    messages.results[0],
                                                                    replyPublicMessage1,
                                                                    publicTenant.loggedinUser.user,
                                                                    true
                                                                  );

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
                }
              );
            }
          );
        }
      );
    });
  });

  describe('Deleting messages', () => {
    /**
     * Test that verifies input validation of deleting messages from a folder
     */
    it('verify delete message validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: simong } = users;

        // Create a folder to test with
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          PUBLIC,
          [],
          [],
          (folder) => {
            // Create message on the folder to delete
            FoldersTestUtil.assertCreateMessageSucceeds(simong.restContext, folder.id, 'a message', null, (message) => {
              // Validate invalid folder id
              FoldersTestUtil.assertDeleteMessageFails(
                simong.restContext,
                'not-a-folder-id',
                message.created,
                400,
                () => {
                  // Unknown folder id
                  FoldersTestUtil.assertDeleteMessageFails(
                    simong.restContext,
                    'f:foo:bar',
                    message.created,
                    404,
                    () => {
                      // Validate invalid timestamp
                      FoldersTestUtil.assertDeleteMessageFails(simong.restContext, folder.id, 'NaN', 400, () => {
                        FoldersTestUtil.assertDeleteMessageFails(
                          simong.restContext,
                          folder.id,
                          'Not a created timestamp',
                          400,
                          () => {
                            // Assert the message was not removed
                            FoldersTestUtil.assertGetMessagesSucceeds(
                              simong.restContext,
                              folder.id,
                              null,
                              2,
                              (messages) => {
                                assert.strictEqual(messages.results.length, 1);
                                return callback();
                              }
                            );
                          }
                        );
                      });
                    }
                  );
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies the logic of deleting messages, and the model and permissions for the operation
     */
    it('verify deleting messages, model and permissions', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenant /* , publicTenant1, privateTenant, privateTenant1 */) => {
          // Add a manager to the folder
          const updates = {};
          updates[publicTenant.privateUser.user.id] = 'manager';
          updates[publicTenant.loggedinUser.user.id] = 'viewer';
          FoldersTestUtil.assertUpdateFolderMembersSucceeds(
            publicTenant.adminRestContext,
            publicTenant.adminRestContext,
            publicTenant.privateFolder.id,
            updates,
            () => {
              // Create message structure on the public folder
              FoldersTestUtil.assertCreateMessageSucceeds(
                publicTenant.loggedinUser.restContext,
                publicTenant.privateFolder.id,
                'Message1 parent on public',
                null,
                (publicMessage1) => {
                  FoldersTestUtil.assertCreateMessageSucceeds(
                    publicTenant.loggedinUser.restContext,
                    publicTenant.privateFolder.id,
                    'Message1 reply on public',
                    publicMessage1.created,
                    (replyPublicMessage1) => {
                      FoldersTestUtil.assertCreateMessageSucceeds(
                        publicTenant.loggedinUser.restContext,
                        publicTenant.privateFolder.id,
                        'Message2 parent on public',
                        null,
                        (publicMessage2) => {
                          // Verify anonymous cannot delete a message
                          FoldersTestUtil.assertDeleteMessageFails(
                            publicTenant.anonymousRestContext,
                            publicTenant.privateFolder.id,
                            publicMessage1.created,
                            401,
                            () => {
                              // Verify non-manager, non-creator user can't delete a message
                              FoldersTestUtil.assertDeleteMessageFails(
                                publicTenant.publicUser.restContext,
                                publicTenant.privateFolder.id,
                                publicMessage1.created,
                                401,
                                () => {
                                  // Verify manager can delete, also verify the parent message is soft-deleted and its model
                                  FoldersTestUtil.assertDeleteMessageSucceeds(
                                    publicTenant.privateUser.restContext,
                                    publicTenant.privateFolder.id,
                                    publicMessage1.created,
                                    (message) => {
                                      // Ensure the deleted message model
                                      assert.strictEqual(message.id, publicMessage1.id);
                                      assert.strictEqual(message.messageBoxId, publicMessage1.messageBoxId);
                                      assert.strictEqual(message.threadKey, publicMessage1.threadKey);
                                      assert.strictEqual(message.created, publicMessage1.created);
                                      assert.strictEqual(message.replyTo, publicMessage1.replyTo);
                                      assert.notStrictEqual(Number.parseInt(message.deleted, 10), Number.NaN);
                                      assert.ok(
                                        Number.parseInt(message.deleted, 10) > Number.parseInt(message.created, 10)
                                      );
                                      assert.strictEqual(message.level, publicMessage1.level);
                                      assert.ok(!message.body);
                                      assert.ok(!message.createdBy);

                                      // Ensure the deleted message is still in the list of messages, but marked as deleted
                                      FoldersTestUtil.assertGetMessagesSucceeds(
                                        publicTenant.privateUser.restContext,
                                        publicTenant.privateFolder.id,
                                        null,
                                        null,
                                        (items) => {
                                          assert.lengthOf(items.results, 3);

                                          const message = items.results[1];
                                          assert.strictEqual(message.id, publicMessage1.id);
                                          assert.strictEqual(message.messageBoxId, publicMessage1.messageBoxId);
                                          assert.strictEqual(message.threadKey, publicMessage1.threadKey);
                                          assert.strictEqual(message.created, publicMessage1.created);
                                          assert.strictEqual(message.replyTo, publicMessage1.replyTo);
                                          assert.notStrictEqual(Number.parseInt(message.deleted, 10), Number.NaN);
                                          assert.ok(
                                            Number.parseInt(message.deleted, 10) > Number.parseInt(message.created, 10)
                                          );
                                          assert.strictEqual(message.level, publicMessage1.level);
                                          assert.isNotOk(message.body);
                                          assert.isNotOk(message.createdBy);

                                          // Delete the rest of the messages to test hard-deletes. This also tests owner can delete
                                          FoldersTestUtil.assertDeleteMessageSucceeds(
                                            publicTenant.loggedinUser.restContext,
                                            publicTenant.privateFolder.id,
                                            replyPublicMessage1.created,
                                            (message) => {
                                              assert.isNotOk(message);

                                              // We re-delete this one, but it should actually do a hard delete this time as there are no children
                                              FoldersTestUtil.assertDeleteMessageSucceeds(
                                                publicTenant.loggedinUser.restContext,
                                                publicTenant.privateFolder.id,
                                                publicMessage1.created,
                                                (message) => {
                                                  assert.isNotOk(message);

                                                  // Perform a hard-delete on this leaf message. This also tests admin can delete
                                                  FoldersTestUtil.assertDeleteMessageSucceeds(
                                                    publicTenant.adminRestContext,
                                                    publicTenant.privateFolder.id,
                                                    publicMessage2.created,
                                                    (message) => {
                                                      assert.isNotOk(message);

                                                      // Should be no more messages in the folder as they should have all been de-indexed by hard deletes
                                                      FoldersTestUtil.assertGetMessagesSucceeds(
                                                        publicTenant.privateUser.restContext,
                                                        publicTenant.privateFolder.id,
                                                        null,
                                                        null,
                                                        (items) => {
                                                          assert.lengthOf(items.results, 0);
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
        }
      );
    });
  });
});
