/*!
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

import { assert } from 'chai';
import util from 'util';
import ShortId from 'shortid';

import * as TenantsTestUtil from 'oae-tenants/lib/test/util';
import * as TestsUtil from 'oae-tests/lib/util';
import * as MessageBoxAPI from 'oae-messagebox';

import { isNil, prop, find, equals, not, forEachObjIndexed } from 'ramda';

const { createTenantWithAdmin } = TestsUtil;
const { generateTestTenantAlias } = TenantsTestUtil;
const { deleteMessage, updateMessageBody, createMessage, getMessagesFromMessageBox } = MessageBoxAPI;

const NO_OPTS = {};
const NO_BODY = null;
const NO_START = null;
const NO_LIMIT = null;
const BODY = 'body';

describe('Messagebox', () => {
  /**
   * Verifies that the message with `id` is present in the messages list.
   *
   * @param  {String}     id          The id of the message to look for.
   * @param  {String}     body        The body of the message to match.
   * @param  {Number}     replyTo     The timestamp this message is a reply to, leave null if the message is not a reply to another message.
   * @param  {Message[]}  messages    An array of messages that should contain the message with the specified `id`.
   * @return {Message}                Returns the found message. If the message is not found, an exception will be thrown by assert.
   */
  const verifyMessage = function(id, body, replyTo, messages) {
    const message = find(message => equals(prop('id', message), id), messages);
    assert.ok(message);
    assert.strictEqual(isNil(message.body), isNil(body));
    assert.strictEqual(message.replyTo, replyTo);

    return message;
  };

  /**
   * Creates a tree of messages:
   * - A1
   *    - A2
   *       - A3
   *    - A4
   * - B1
   * - C1
   *
   * @param  {Function}   callback                Standard callback function
   * @param  {String}     callback.messageBoxId   The messageBoxId for all the messages.
   * @param  {Object}     callback.tree           Object that holds the messages. The tree is represented as a flat object.
   */
  const setupMessages = callback => {
    const messageBoxId = util.format('msg-box-test-%s', ShortId.generate());

    createMessage(messageBoxId, 'u:camtest:foo', 'A1', NO_OPTS, (err, a1Message) => {
      assert.notExists(err);
      setTimeout(
        createMessage,
        10,
        messageBoxId,
        'u:camtest:foo',
        'A2',
        { replyToCreated: a1Message.created },
        (err, a2Message) => {
          assert.notExists(err);

          setTimeout(createMessage, 10, messageBoxId, 'u:camtest:foo', 'B1', NO_OPTS, (err, b1Message) => {
            assert.notExists(err);

            setTimeout(createMessage, 10, messageBoxId, 'u:camtest:foo', 'C1', NO_OPTS, (err, c1Message) => {
              assert.notExists(err);

              setTimeout(
                createMessage,
                10,
                messageBoxId,
                'u:camtest:foo',
                'A3',
                { replyToCreated: a2Message.created },
                (err, a3Message) => {
                  assert.notExists(err);

                  setTimeout(
                    createMessage,
                    10,
                    messageBoxId,
                    'u:camtest:foo',
                    'A4',
                    { replyToCreated: a1Message.created },
                    (err, a4Message) => {
                      assert.notExists(err);
                      const tree = {
                        a1: a1Message,
                        a2: a2Message,
                        a3: a3Message,
                        a4: a4Message,
                        b1: b1Message,
                        c1: c1Message
                      };

                      // Ensuring that all the created timestamps are different.
                      const createdTimestamps = {};
                      forEachObjIndexed((message, name) => {
                        // Check the created timestamp has not been set yet.
                        assert.ok(not(createdTimestamps[message.created]), JSON.stringify(tree, null, 4));

                        // Remember this timestamp.
                        createdTimestamps[message.created] = name;
                      }, tree);

                      callback(messageBoxId, tree);
                    }
                  );
                }
              );
            });
          });
        }
      );
    });
  };

  describe('#createMessage', () => {
    /**
     * Verifies that the parameters for the `createMessage` function get validated.
     */
    it('verify parameter validation', callback => {
      // Missing messagebox.
      createMessage(null, 'u:camtest:foo', BODY, NO_OPTS, (err, message) => {
        assert.strictEqual(err.code, 400);
        assert.notExists(message);

        createMessage('boxId', null, BODY, NO_OPTS, (err, message) => {
          assert.strictEqual(err.code, 400);
          assert.notExists(message);

          createMessage('boxId', 'not a principal id', BODY, NO_OPTS, (err, message) => {
            assert.strictEqual(err.code, 400);
            assert.notExists(message);
            // Messages come from users, not groups

            createMessage('boxId', 'g:camtest:bleh', BODY, NO_OPTS, (err, message) => {
              assert.strictEqual(err.code, 400);
              assert.notExists(message);

              // Missing body
              createMessage('boxId', 'g:camtest:bleh', NO_BODY, NO_OPTS, (err, message) => {
                assert.strictEqual(err.code, 400);
                assert.notExists(message);

                // If we add a reply, it should be a timestamp.
                createMessage('boxId', 'g:camtest:bleh', NO_BODY, { replyToCreated: null }, (err, message) => {
                  assert.strictEqual(err.code, 400);
                  assert.notExists(message);

                  createMessage('boxId', 'g:camtest:bleh', NO_BODY, { replyToCreated: 'no int' }, (err, message) => {
                    assert.strictEqual(err.code, 400);
                    assert.notExists(message);

                    createMessage(
                      'boxId',
                      'g:camtest:bleh',
                      NO_BODY,
                      { replyToCreated: Date.now() + 3000 },
                      (err, message) => {
                        assert.strictEqual(err.code, 400);
                        assert.notExists(message);

                        return callback();
                      }
                    );
                  });
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that a message can be created and and retrieved
     */
    it('verify creating a message', callback => {
      const messageBoxId = util.format('msg-box-test-%s', ShortId.generate());

      createMessage(messageBoxId, 'u:camtest:foo', BODY, NO_OPTS, (err, message) => {
        assert.notExists(err);

        // Sanity check: retrieve it back
        getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
          assert.notExists(err);
          verifyMessage(message.id, BODY, null, messages);

          return callback();
        });
      });
    });

    /**
     * Test that verifies absolute link replacement in created messages
     */
    it('verify replacing bare, absolute OAE links in new message', callback => {
      /**
       * Test with a tenant that contains every letter in the alphabet in the host
       * @see https://github.com/oaeproject/3akai-ux/issues/4086
       */
      const newTenantAlias = generateTestTenantAlias();
      const tenantHost = 'abcdefghijklmnop.qrstuvw.xyz';

      createTenantWithAdmin(newTenantAlias, tenantHost, (err /* , tenant, tenantAdminRestContext */) => {
        assert.notExists(err);

        const path = '/path/-Z9+&@#%=~_|!:,.;/file?query=parameter#hash';
        const httpUrl = util.format('http://%s%s', tenantHost, path);
        const httpsUrl = util.format('https://%s%s', tenantHost, path);
        const markdownPath = util.format('[%s](%s)', path, path);
        const markdownHttpUrl = util.format('[%s](%s)', httpUrl, httpUrl);

        const messageBoxId = util.format('msg-box-test-%s', ShortId.generate());

        createMessage(messageBoxId, 'u:camtest:foo', util.format('URL: %s more', httpUrl), NO_OPTS, (
          err /* , message */
        ) => {
          assert.notExists(err);

          // Verify the link was replaced
          getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
            assert.notExists(err);
            verifyMessage(messages[0].id, util.format('URL: %s more', markdownPath), null, messages);

            // Verify multiple links
            createMessage(messageBoxId, 'u:camtest:foo', util.format('URLs: %s %s', httpUrl, httpUrl), NO_OPTS, (
              err /* , message */
            ) => {
              assert.notExists(err);

              // Verify the link was replaced
              getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
                assert.notExists(err);
                verifyMessage(messages[0].id, util.format('URLs: %s %s', markdownPath, markdownPath), null, messages);

                // Verify multiple markdown links
                createMessage(
                  messageBoxId,
                  'u:camtest:foo',
                  util.format('URLs: %s%s', markdownHttpUrl, markdownHttpUrl),
                  NO_OPTS,
                  (err /* , message */) => {
                    assert.notExists(err);

                    // Verify the link was replaced
                    getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
                      assert.notExists(err);
                      verifyMessage(
                        messages[0].id,
                        util.format('URLs: %s%s', markdownPath, markdownPath),
                        null,
                        messages
                      );

                      // Verify that quoted links aren't replaced
                      const quotedMarkdown = util.format(
                        '`%s` ` text %s`\n    %s\n\n    %s\n    text %s',
                        httpsUrl,
                        httpsUrl,
                        httpsUrl,
                        httpsUrl,
                        httpsUrl
                      );

                      createMessage(messageBoxId, 'u:camtest:foo', quotedMarkdown, NO_OPTS, (err /* , message */) => {
                        assert.notExists(err);
                        getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
                          assert.notExists(err);
                          const quotedExpected = util.format(
                            '`%s` ` text %s`\n    %s\n\n    %s\n    text %s',
                            httpsUrl,
                            httpsUrl,
                            markdownPath,
                            httpsUrl,
                            httpsUrl
                          );
                          verifyMessage(messages[0].id, quotedExpected, null, messages);

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
    });

    /**
     * Test that verifies absolute link replacement within markdown in created messages.
     */
    it('verify replacing markdown-embedded absolute OAE links in new message', callback => {
      const url = '/path/-Z9+&@#%=~_|!:,.;/file?query=parameter#hash';
      const messageBoxId = util.format('msg-box-test-%s', ShortId.generate());

      createMessage(messageBoxId, 'u:camtest:foo', '[URL](http://cambridge.oae.com' + url + ') more text', NO_OPTS, (
        err /* , message */
      ) => {
        assert.notExists(err);

        // Verify the link was replaced
        getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
          assert.notExists(err);
          verifyMessage(messages[0].id, '[URL](' + url + ') more text', null, messages);

          // Verify a link of the form [http://cambridge.oae.com/foo/bar](http://cambridge.oae.com/foo/bar)
          createMessage(
            messageBoxId,
            'u:camtest:foo',
            'URL: [http://cambridge.oae.com' + url + '](http://cambridge.oae.com' + url + ') more text',
            NO_OPTS,
            (err /* , message */) => {
              assert.notExists(err);

              // Verify the link was replaced
              getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
                assert.notExists(err);
                verifyMessage(messages[0].id, 'URL: [' + url + '](' + url + ') more text', null, messages);

                // Verify a link of the form [http://cambridge.oae.com/foo/bar](/foo/bar)
                createMessage(
                  messageBoxId,
                  'u:camtest:foo',
                  'URL: [http://cambridge.oae.com' + url + '](' + url + ') more text',
                  NO_OPTS,
                  (err /* , message */) => {
                    assert.notExists(err);

                    // Verify the link was replaced
                    getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
                      assert.notExists(err);
                      verifyMessage(messages[0].id, 'URL: [' + url + '](' + url + ') more text', null, messages);

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

    /**
     * Test that verifies the replying mechanism
     */
    it('verify replying on a message', callback => {
      const messageBoxId = util.format('msg-box-test-%s', ShortId.generate());

      // First check that you cannot reply to a non-existant message.
      createMessage(messageBoxId, 'u:camtest:foo', BODY, { replyToCreated: Date.now() - 1000 }, (
        err /* , message */
      ) => {
        assert.strictEqual(err.code, 400);

        setTimeout(createMessage, 10, messageBoxId, 'u:camtest:foo', BODY, {}, (err, message) => {
          assert.notExists(err);
          assert.ok(message);

          setTimeout(
            createMessage,
            10,
            messageBoxId,
            'u:camtest:foo',
            BODY,
            { replyToCreated: message.created },
            (err, reply) => {
              assert.notExists(err);
              assert.ok(reply);
              assert.strictEqual(reply.replyTo, message.created);

              // Sanity check: retrieve them back
              getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
                assert.notExists(err);
                verifyMessage(message.id, BODY, null, messages);
                verifyMessage(reply.id, BODY, message.created, messages);

                return callback();
              });
            }
          );
        });
      });
    });
  });

  describe('#updateMessageBody', () => {
    /**
     * Verifies that the parameters of the `updateMessageBody` function get validated.
     */
    it('verify parameter validation', callback => {
      const messageBoxId = util.format('msg-box-test-%s', ShortId.generate());
      updateMessageBody(null, Date.now() - 1000, 'newBody', err => {
        assert.strictEqual(err.code, 400);

        // Created timestamp
        updateMessageBody(messageBoxId, null, 'newBody', err => {
          assert.strictEqual(err.code, 400);
          updateMessageBody(messageBoxId, 'Not a timestamp', 'newBody', err => {
            assert.strictEqual(err.code, 400);
            updateMessageBody(messageBoxId, Date.now() + 1000, 'newBody', err => {
              assert.strictEqual(err.code, 400);

              // The body
              updateMessageBody(messageBoxId, Date.now() - 1000, null, err => {
                assert.strictEqual(err.code, 400);

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * A test that updates a message.
     */
    it('verify updating a message', callback => {
      const messageBoxId = util.format('msg-box-test-%s', ShortId.generate());

      createMessage(messageBoxId, 'u:camtest:foo', 'alfa', NO_OPTS, (err, message) => {
        assert.notExists(err);
        assert.ok(message);

        // Sanity check
        getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
          assert.notExists(err);
          verifyMessage(message.id, 'alfa', null, messages);

          // Update the message.
          updateMessageBody(messageBoxId, message.created, 'beta', err => {
            assert.notExists(err);

            getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
              assert.notExists(err);
              // There should still only be 1 message.
              assert.lengthOf(messages, 1);
              // Verify the body has changed.
              verifyMessage(message.id, 'beta', null, messages);

              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies absolute link replacement in updated messages
     */
    it('verify replacing absolute links in updated message', callback => {
      const url = '/path/-Z9+&@#%=~_|!:,.;/file?query=parameter#hash';
      const messageBoxId = util.format('msg-box-test-%s', ShortId.generate());

      createMessage(messageBoxId, 'u:camtest:foo', 'alfa', NO_OPTS, (err, message) => {
        assert.notExists(err);
        assert.ok(message);

        // Sanity check
        getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
          assert.notExists(err);
          verifyMessage(message.id, 'alfa', null, messages);

          // Update the message
          updateMessageBody(messageBoxId, message.created, 'URL: http://cambridge.oae.com' + url, err => {
            assert.notExists(err);

            getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
              assert.notExists(err);
              // Verify the body has changed
              verifyMessage(message.id, 'URL: [' + url + '](' + url + ')', null, messages);

              return callback();
            });
          });
        });
      });
    });
  });

  describe('#getMessagesFromMessageBox', () => {
    /**
     * Simple parameter validation test case.
     */
    it('verify parameter validation', callback => {
      // No messageboxId should result in a 400
      getMessagesFromMessageBox(null, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
        assert.strictEqual(err.code, 400);
        assert.notExists(messages);

        return callback();
      });
    });

    /**
     * Simple test that creates a couple of messages and then retrieves them.
     */
    it('verify retrieving messages', callback => {
      const messageBoxId = util.format('msg-box-test-%s', ShortId.generate());
      // If there are no messages in a box, `getMessagesFromMessageBox` should return an empty array.
      getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
        assert.notExists(err);
        assert.lengthOf(messages, 0);

        // Create some messages and verify they end up in the box.
        createMessage(messageBoxId, 'u:camtest:foo', 'alfa', NO_OPTS, (err, message1) => {
          assert.notExists(err);
          assert.ok(message1);

          createMessage(messageBoxId, 'u:camtest:foo', 'alfa', NO_OPTS, (err, message2) => {
            assert.notExists(err);
            assert.ok(message2);

            getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
              assert.notExists(err);
              verifyMessage(message1.id, 'alfa', null, messages);
              verifyMessage(message2.id, 'alfa', null, messages);

              return callback();
            });
          });
        });
      });
    });

    /**
     * Verifies that the optional `scrubDeleted` parameter actually scrubs 'soft' deleted messages.
     */
    it('verify deleted messages can be scrubbed', callback => {
      const messageBoxId = util.format('msg-box-test-%s', ShortId.generate());

      // Create three messages and delete the middle one.
      createMessage(messageBoxId, 'u:camtest:foo', 'alfa', NO_OPTS, (err, message1) => {
        assert.notExists(err);
        assert.ok(message1);

        setTimeout(createMessage, 10, messageBoxId, 'u:camtest:foo', 'beta', NO_OPTS, (err, message2) => {
          assert.notExists(err);
          assert.ok(message2);

          setTimeout(createMessage, 10, messageBoxId, 'u:camtest:foo', 'charly', NO_OPTS, (err, message3) => {
            assert.notExists(err);
            assert.ok(message3);

            // Sanity check that the three messages are there
            getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
              assert.notExists(err);

              verifyMessage(message1.id, 'alfa', null, messages);
              verifyMessage(message2.id, 'beta', null, messages);
              verifyMessage(message3.id, 'charly', null, messages);

              // Soft delete message2, this should remove the body
              deleteMessage(
                messageBoxId,
                message2.created,
                { deleteType: 'soft' },
                (err, deleteType, deletedMessage) => {
                  assert.notExists(err);

                  assert.strictEqual(deleteType, 'soft');
                  assert.ok(deletedMessage.deleted);
                  assert.notExists(deletedMessage.body);

                  getMessagesFromMessageBox(
                    messageBoxId,
                    NO_START,
                    NO_LIMIT,
                    { scrubDeleted: true },
                    (err, messages) => {
                      assert.notExists(err);

                      // DeletedMessage's body should be null and it's deleted flag should be set to true.
                      const idsMatch = (a, b) => equals(prop('id', a), prop('id', b));
                      const deletedMessage = find(message => idsMatch(message, message2), messages);
                      assert.ok(deletedMessage.deleted);
                      assert.notExists(deletedMessage.body);

                      // The other messages should still be there though.
                      verifyMessage(message1.id, 'alfa', null, messages);
                      verifyMessage(message3.id, 'charly', null, messages);

                      // Sanity check that using no scrubDeleted flag returns the message.
                      getMessagesFromMessageBox(
                        messageBoxId,
                        NO_START,
                        NO_LIMIT,
                        { scrubDeleted: false },
                        (err, messages) => {
                          assert.notExists(err);

                          verifyMessage(message1.id, 'alfa', null, messages);
                          verifyMessage(message2.id, 'beta', null, messages);
                          verifyMessage(message3.id, 'charly', null, messages);

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
    });
  });

  describe('#deleteMessage', () => {
    /**
     * Verifies that the parameters for the `deleteMessage` function get validated.
     */
    it('verify parameter validation', callback => {
      const messageBoxId = util.format('msg-box-test-%s', ShortId.generate());

      // Missing messagebox.
      deleteMessage(null, Date.now() - 1000, NO_OPTS, (err, deleteType, message) => {
        assert.strictEqual(err.code, 400);
        assert.notExists(message);

        // Invalid timestamps
        deleteMessage(messageBoxId, null, NO_OPTS, (err, deleteType, message) => {
          assert.strictEqual(err.code, 400);
          assert.notExists(message);
          deleteMessage(messageBoxId, 'not a timestamp', NO_OPTS, (err, deleteType, message) => {
            assert.strictEqual(err.code, 400);
            assert.notExists(message);
            deleteMessage(messageBoxId, Date.now() + 1000, NO_OPTS, (err, deleteType, message) => {
              assert.strictEqual(err.code, 400);
              assert.notExists(message);

              // Invalid delete type.
              deleteMessage(messageBoxId, null, { deleteType: 'invalid' }, (err, deleteType, message) => {
                assert.strictEqual(err.code, 400);
                assert.notExists(message);

                // Non-existing message.
                deleteMessage(messageBoxId, Date.now() - 1000, NO_OPTS, (err, deleteType, message) => {
                  assert.strictEqual(err.code, 404, JSON.stringify(err, null, 4));
                  assert.notExists(message);

                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Verifies that "leaf deleting" a leaf message performs a hard delete and
     * removes it from the messagebox.
     */
    it('verify leaf delete on a leaf node hard deletes the message', callback => {
      setupMessages((messageBoxId, tree) => {
        // Deleting A3 should result in a hard delete.
        deleteMessage(messageBoxId, tree.a3.created, { deleteType: 'leaf' }, (err, deleteType, message) => {
          assert.notExists(err);

          // This should result in a hard delete and thus not return the message.
          assert.strictEqual(deleteType, 'hard');
          assert.notExists(message);

          getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
            assert.notExists(err);

            // The tree originally has 6 messages, after hard deleting a leaf, it should have 5.
            assert.lengthOf(messages, 5);

            // Make sure the correct message was deleted.
            const a3Message = find(message => equals(message.body, 'A3'), messages);
            assert.notExists(a3Message);

            return callback();
          });
        });
      });
    });

    /**
     * Verifies that "leaf deleting" a non-leaf message performs a soft delete, does not
     * remove it from the messagebox but just scrubs it.
     */
    it('verify leaf delete on a non-leaf node soft deletes the message', callback => {
      setupMessages((messageBoxId, tree) => {
        // Deleting A2 should result in a soft delete.
        deleteMessage(messageBoxId, tree.a2.created, { deleteType: 'leaf' }, (err, deleteType, message) => {
          assert.notExists(err);

          // This should result in a soft delete and thus return the message.
          assert.strictEqual(deleteType, 'soft');
          assert.ok(message);
          assert.notExists(message.body);
          assert.notExists(message.createdBy);

          getMessagesFromMessageBox(messageBoxId, NO_START, NO_LIMIT, NO_OPTS, (err, messages) => {
            assert.notExists(err);

            // The tree originally has 6 messages, after soft deleting a leaf, it should still have 6.
            assert.lengthOf(messages, 6);

            // Make sure the correct message was deleted.
            verifyMessage(tree.a2.id, null, tree.a1.created, messages);

            return callback();
          });
        });
      });
    });
  });
});
