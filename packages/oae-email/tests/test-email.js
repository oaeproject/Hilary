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

import { assert } from 'chai';
import { format } from 'node:util';

import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as EmailAPI from 'oae-email';
import * as EmailTestsUtil from 'oae-email/lib/test/util.js';

import { head, mergeLeft } from 'ramda';

const { clearConfig } = RestAPI.Config;
const { createComment } = RestAPI.Content;
const { collectAndFetchAllEmails } = EmailTestsUtil;
const { createLink } = RestAPI.Content;
const { updateConfigAndWait } = ConfigTestUtil;
const { generateTestUsers, generateTestEmailAddress, createTenantAdminRestContext, createGlobalAdminRestContext } =
  TestsUtil;
const { init } = EmailAPI;
const { sendEmail, clearEmailCollections } = EmailTestsUtil;

const TEST = 'test';
const NO_OPTS = null;
const NO_DATA = null;
const PRIVATE = 'private';
const EMAIL_MODULE = 'oae-email';
const NO_MANAGERS = [];
const NO_FOLDERS = [];

describe('Emails', () => {
  // Rest context that can be used every time we need to make a request as a tenant admin
  let asCambridgeTenantAdmin = null;

  // Keep track of how many mails we've sent across all tests
  let emailsSent = 0;

  /**
   * Generate an object suitable for use to configure the Email API
   *
   * @param  {Object}     overrides   A set of overrides that should go in the config
   * @return {Object}                 Object that can be used to configure the Email API
   */
  const _createDefaultConfig = (overrides) => mergeLeft(overrides, { debug: true });

  /**
   * Generate a unique hash across all tests
   *
   * @return {String}    String that can be used as the hash value for an email
   */
  const generateUniqueHash = () => `oae-emails:tests:${++emailsSent}`;

  /**
   * Function that will fill up the tenant admin and anymous rest context
   */
  before((callback) => {
    // Fill up global admin rest context
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    return callback();
  });

  beforeEach((callback) => {
    init(_createDefaultConfig(), (error) => {
      assert.notExists(error);

      // Flush the pending mails
      clearEmailCollections(callback);
    });
  });

  afterEach((callback) => {
    // Return the email api to its default test configuration
    init(_createDefaultConfig(), callback);
  });

  describe('Templates', () => {
    /**
     * Test that verifies validation of the sendEmail method
     */
    it('verify sendEmail validation', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: johnDoe } = users;
        const johnDoeUser = johnDoe.user;

        // Verify error when there is no email
        delete johnDoe.user.email;

        sendEmail(EMAIL_MODULE, TEST, johnDoeUser, NO_DATA, NO_OPTS, (error /* , message */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);

          johnDoe.user.email = 'blah blah blah';

          // Verify error when there is invalid email
          sendEmail(EMAIL_MODULE, TEST, johnDoeUser, NO_DATA, NO_OPTS, (error /* , message */) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);

            // Verify error when there is no user
            sendEmail(EMAIL_MODULE, TEST, null, NO_DATA, NO_OPTS, (error /* , message */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);

              johnDoe.user.email = 'my.email@my.email.com';

              // Verify error when there is no module
              sendEmail(null, TEST, johnDoeUser, NO_DATA, NO_OPTS, (error /* , message */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 400);

                // Verify error when there is no template id
                sendEmail(EMAIL_MODULE, null, johnDoeUser, NO_DATA, NO_OPTS, (error /* , message */) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 400);

                  // Verify error with non-existent module
                  sendEmail('oae-non-existent', TEST, johnDoeUser, NO_DATA, NO_OPTS, (error /* , message */) => {
                    assert.ok(error);
                    assert.strictEqual(error.code, 500);

                    // Verify error with non-existent template id
                    sendEmail(
                      EMAIL_MODULE,
                      'TemplateDoesNotExist',
                      johnDoeUser,
                      NO_DATA,
                      NO_OPTS,
                      (error /* , message */) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 500);

                        // Sanity check
                        sendEmail(EMAIL_MODULE, TEST, johnDoeUser, NO_DATA, NO_OPTS, (error, message) => {
                          assert.notExists(error);
                          assert.ok(message);

                          return callback();
                        });
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
     * Test that verifies that emails get internationalized
     */
    it('verify email templates are internationalized', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: miguel, 1: rita } = users;
        miguel.user.email = 'miguellaginha@email.address.com';
        miguel.user.locale = 'en_CA';

        rita.user.email = 'oakrita@email.address.com';
        rita.user.locale = 'fr_FR';

        // Verify miguel gets the email
        sendEmail(EMAIL_MODULE, 'test_locale', miguel.user, NO_DATA, NO_OPTS, (error, info) => {
          assert.notExists(error);

          const miguelEmail = JSON.parse(info.message);
          assert.ok(miguelEmail.subject);
          assert.ok(miguelEmail.text);

          // Verify rita gets the email
          sendEmail(EMAIL_MODULE, 'test_locale', rita.user, NO_DATA, NO_OPTS, (error, info) => {
            assert.notExists(error);

            const ritaEmail = JSON.parse(info.message);
            assert.ok(ritaEmail.subject);
            assert.ok(ritaEmail.text);

            // Because of the locale difference, the subject and body of the mails should be different
            assert.notStrictEqual(miguelEmail.subject, ritaEmail.subject);
            assert.notStrictEqual(miguelEmail.text, ritaEmail.text);

            return callback();
          });
        });
      });
    });

    /**
     * Verifies a 500 error is thrown when there is no meta template available for a template, even if there are
     * content templates.
     */
    it('verify error with no meta template', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = users;
        johnDoe.user.email = 'johndoe@email.address.com';

        // Verify error when there is no meta template
        sendEmail(EMAIL_MODULE, 'TestNoMeta', johnDoe.user, NO_DATA, NO_OPTS, (error /* , message */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 500);
          assert.strictEqual(error.msg.indexOf('No email metadata'), 0);

          return callback();
        });
      });
    });

    /**
     * Test that verifies an error is given when a template is chosen that has only metadata and no content.
     */
    it('verify error with no html or txt template', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = users;
        johnDoe.user.email = 'johndoe@email.address.com';

        // Verify error when there is no email
        sendEmail(EMAIL_MODULE, 'test_meta_only', johnDoe.user, NO_DATA, NO_OPTS, (error /* , message */) => {
          assert.ok(error);

          assert.strictEqual(error.code, 500);
          assert.strictEqual(error.msg.indexOf('No email content'), 0);

          return callback();
        });
      });
    });

    /**
     * Verifies the combinations of templates that have only html, only txt and both html and txt.
     */
    it('verify html and txt templates', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = users;
        johnDoe.user.email = 'johndoe@email.address.com';

        // Verify HTML only
        sendEmail(EMAIL_MODULE, 'test_html_only', johnDoe.user, NO_DATA, NO_OPTS, (error, info) => {
          assert.notExists(error);

          const message = JSON.parse(info.message);
          assert.strictEqual(message.from.name, 'Cambridge University Test');
          assert.strictEqual(message.from.address, format('noreply@%s', johnDoe.restContext.hostHeader));
          assert.strictEqual(message.subject, 'test html only');
          assert.strictEqual(message.to[0].address, johnDoe.user.email);
          assert.strictEqual(message.html, '<html><body><b>test html only</b></body></html>');
          assert.strictEqual(message.text, 'test html only');

          // Verify text only
          sendEmail(EMAIL_MODULE, 'test_txt_only', johnDoe.user, NO_DATA, NO_OPTS, (error, info) => {
            assert.notExists(error);

            const message = JSON.parse(info.message);
            assert.strictEqual(message.from.name, 'Cambridge University Test');
            assert.strictEqual(message.from.address, format('noreply@%s', johnDoe.restContext.hostHeader));
            assert.strictEqual(message.subject, 'test txt only');
            assert.strictEqual(message.to[0].address, johnDoe.user.email);
            assert.ok(!message.html);
            assert.strictEqual(message.text, '**test txt only**');

            // Verify contents with both html and text
            sendEmail(EMAIL_MODULE, 'test_html_and_txt', johnDoe.user, NO_DATA, NO_OPTS, (error, info) => {
              assert.notExists(error);

              const message = JSON.parse(info.message);
              assert.strictEqual(message.from.name, 'Cambridge University Test');
              assert.strictEqual(message.from.address, format('noreply@%s', johnDoe.restContext.hostHeader));
              assert.strictEqual(message.subject, 'test html and txt');
              assert.strictEqual(message.to[0].address, johnDoe.user.email);
              assert.strictEqual(message.html, '<html><body><b>test html and text</b></body></html>');
              assert.strictEqual(message.text, '**test html and txt**');

              return callback();
            });
          });
        });
      });
    });

    /**
     * Verifies that there is no &apos; entity being sent in e-mails and that instead we are escaping it to &#39;
     */
    it("verify html doesn't include the HTML5 entity for the apostrophe", (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = users;
        johnDoe.user.email = 'johnDoe@email.address.com';

        // Verify HTML only
        sendEmail(EMAIL_MODULE, 'test_html_with_apostrophes_only', johnDoe.user, NO_DATA, NO_OPTS, (error, info) => {
          assert.notExists(error);

          const message = JSON.parse(info.message);
          assert.strictEqual(
            message.html,
            '<html><body><b>test html with &#39;&#39;apostrophes&#39;&#39; only</b></body></html>'
          );
          assert.strictEqual(message.text, "test html with ''apostrophes'' only");

          return callback();
        });
      });
    });

    /**
     * Test that verifies how errors are handled when templates trigger exceptions:
     *
     *  * When the meta template throws exception, the email fails to send
     *  * When the html template throws exception but there is a text template, the email sends with the text
     *  * When the text template throws exception but there is an html template, the email sends with the html
     *  * When both html and text templates throw exception, the email fails
     */
    it('verify exception handling from template rendering', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = users;
        johnDoe.user.email = 'johnDoe@email.address.com';

        const _mailData = function (throwMeta, throwHtml, throwTxt, throwContent) {
          return {
            throwMeta,
            throwHtml,
            throwTxt,
            throwContent
          };
        };

        // Verify we get an error when exception thrown from meta
        sendEmail(
          EMAIL_MODULE,
          'test_throw_error',
          johnDoe.user,
          _mailData(true, false, false, false),
          null,
          (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 500);
            assert.strictEqual(error_.msg.indexOf('Error parsing email metadata'), 0);

            // Verify if an error is thrown from HTML but we still have a valid text, a message is still sent
            sendEmail(
              EMAIL_MODULE,
              'test_throw_error',
              johnDoe.user,
              _mailData(false, true, false, false),
              null,
              (error, info) => {
                assert.notExists(error);

                const message = JSON.parse(info.message);
                assert.ok(!message.html);
                assert.ok(message.text);
                assert.ok(message.text.includes('OK'));

                // Verify if an error is thrown from HTML but we still have a valid text, a message is still sent
                sendEmail(
                  EMAIL_MODULE,
                  'test_throw_error',
                  johnDoe.user,
                  _mailData(false, false, true, false),
                  null,
                  (error, info) => {
                    assert.notExists(error);

                    const message = JSON.parse(info.message);
                    assert.ok(message.html);
                    assert.ok(message.html.includes('OK'));

                    // The HTML template gets auto-converted to text if it does not exist
                    assert.ok(message.text);
                    assert.ok(message.text.includes('OK'));

                    // Verify we get an error when exception thrown from meta
                    sendEmail(
                      EMAIL_MODULE,
                      'test_throw_error',
                      johnDoe.user,
                      _mailData(false, false, false, true),
                      null,
                      (error /* , info */) => {
                        assert.ok(error);

                        assert.strictEqual(error.code, 500);
                        assert.strictEqual(error.msg.indexOf('Could not parse a suitable content template'), 0);

                        return callback();
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

    /**
     * Test that verifies that shared logic can be used in the email templates
     */
    it('verify shared logic can be used', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = users;
        johnDoe.user.email = 'johndoe@email.address.com';

        sendEmail(EMAIL_MODULE, 'test_shared', johnDoe.user, NO_DATA, NO_OPTS, (error, info) => {
          assert.notExists(error);
          const message = JSON.parse(info.message);
          assert.strictEqual(message.subject, 'foo');
          assert.strictEqual(message.text, 'bar');

          return callback();
        });
      });
    });

    /**
     * Test that verifies that other template files can be included
     */
    it('verify other template files can be included', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe } = users;

        sendEmail(EMAIL_MODULE, 'test_include', johnDoe.user, NO_DATA, NO_OPTS, (error, info) => {
          assert.notExists(error);

          const message = JSON.parse(info.message);
          assert.ok(message.html);
          assert.ok(message.html.includes('<p\n style="background-color: red;">'));

          return callback();
        });
      });
    });
  });

  describe('Email configuration', () => {
    /**
     * A test that verifies the email transport config property gets validated.
     */
    it('verify transport validation', (callback) => {
      init(_createDefaultConfig({ debug: false, transport: 'wrong' }), (error) => {
        assert.strictEqual(error.code, 400);

        // We should be able to check the sendmail transport from the unit tests.
        const mailConfigOverrides = {
          debug: false,
          transport: 'sendmail',
          sendmailTransport: {
            path: '/usr/sbin/sendmail'
          }
        };
        init(_createDefaultConfig(mailConfigOverrides), (error) => {
          assert.notExists(error);

          // Let the after() method take care of resetting the config properly.
          return callback();
        });
      });
    });

    /**
     * A test that verifies that a legit `from` header is constructed if not specified in the tenant configuration
     */
    it('verify noreply from header', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe, 1: janeDoe } = users;
        const asJohnDoe = johnDoe.restContext;
        const asJaneDoe = janeDoe.restContext;

        // Configure the `from` header for the email module
        let config = {
          'oae-email/general/fromName': 'The Cambridge Collaborative system',
          'oae-email/general/fromAddress': 'noreply@blahblahblah.com'
        };

        updateConfigAndWait(asCambridgeTenantAdmin, null, config, (error_) => {
          assert.notExists(error_);

          // Create a new link with the janeDoe user. The johnDoe user will receive an email
          createLink(
            asJaneDoe,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PRIVATE,
              link: 'http://www.google.com',
              managers: NO_MANAGERS,
              viewers: [johnDoe.user.id],
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);
              assert.ok(link);

              // Assert that johnDoe receives an email with `noreply@blahblahblah.com` as the the configured `from` header
              collectAndFetchAllEmails((messages) => {
                assert.ok(messages);
                assert.isNotEmpty(messages);
                assert.strictEqual(messages[0].to[0].address, johnDoe.user.email);
                assert.strictEqual(messages[0].from.name, 'The Cambridge Collaborative system');
                assert.strictEqual(messages[0].from.address, 'noreply@blahblahblah.com');

                // Clear the configuration
                let configToClear = ['oae-email/general/fromAddress', 'oae-email/general/fromName'];

                clearConfig(asCambridgeTenantAdmin, null, configToClear, (error_) => {
                  assert.notExists(error_);

                  // Create a comment with the johnDoe user. The janeDoe user will receive an email
                  createComment(
                    asJohnDoe,
                    link.id,
                    'I have never seen something like this before!',
                    null,
                    (error, comment) => {
                      assert.notExists(error);
                      assert.ok(comment);

                      // Assert that janeDoe receives an email with `"Cambridge University Test" <noreply@cambridge.oae.com>` as the composed `from` header
                      collectAndFetchAllEmails((messages) => {
                        assert.ok(messages);
                        assert.ok(messages.length);
                        assert.strictEqual(messages[0].to[0].address, janeDoe.user.email);
                        assert.strictEqual(messages[0].from.name, global.oaeTests.tenants.cam.displayName);
                        assert.strictEqual(
                          messages[0].from.address,
                          format('noreply@%s', global.oaeTests.tenants.cam.host)
                        );

                        // Configure a name with the `${tenant}` variable
                        config = {
                          // eslint-disable-next-line no-template-curly-in-string
                          'oae-email/general/fromName': 'OAE for ${tenant}'
                        };

                        updateConfigAndWait(asCambridgeTenantAdmin, null, config, (error_) => {
                          assert.notExists(error_);

                          // Create a comment with the johnDoe user. The janeDoe user will receive an email
                          createComment(
                            asJohnDoe,
                            link.id,
                            'I am going to share this with all my friends!',
                            null,
                            (error, comment) => {
                              assert.notExists(error);
                              assert.ok(comment);

                              // Assert that janeDoe receives an email with `"OAE for Cambridge University Test" <noreply@cambridge.oae.com>`
                              collectAndFetchAllEmails((messages) => {
                                assert.ok(messages);
                                assert.ok(messages.length);
                                assert.strictEqual(messages[0].to[0].address, janeDoe.user.email);
                                assert.strictEqual(
                                  messages[0].from.name,
                                  'OAE for ' + global.oaeTests.tenants.cam.displayName
                                );
                                assert.strictEqual(
                                  messages[0].from.address,
                                  format('noreply@%s', global.oaeTests.tenants.cam.host)
                                );

                                // Sanity check that the from header can be configured on a global level
                                configToClear = ['oae-email/general/fromAddress', 'oae-email/general/fromName'];

                                clearConfig(asCambridgeTenantAdmin, null, configToClear, (error_) => {
                                  assert.notExists(error_);
                                  const globalAdminRestContext = createGlobalAdminRestContext();
                                  config = {
                                    'oae-email/general/fromName':
                                      // eslint-disable-next-line no-template-curly-in-string
                                      'The glorious OAE for ${tenant}'
                                  };
                                  updateConfigAndWait(globalAdminRestContext, null, config, (error_) => {
                                    assert.notExists(error_);

                                    // Create a comment with the johnDoe user. The janeDoe user will receive an email
                                    createComment(
                                      asJohnDoe,
                                      link.id,
                                      'I am going to share this with all my friends!',
                                      null,
                                      (error, comment) => {
                                        assert.notExists(error);
                                        assert.ok(comment);

                                        // Assert that janeDoe receives an email with `"The glorious OAE for Cambridge University Test" <noreply@cambridge.oae.com>`
                                        collectAndFetchAllEmails((messages) => {
                                          assert.ok(messages);
                                          assert.ok(messages.length);
                                          assert.strictEqual(messages[0].to[0].address, janeDoe.user.email);
                                          assert.strictEqual(
                                            messages[0].from.name,
                                            'The glorious OAE for ' + global.oaeTests.tenants.cam.displayName
                                          );
                                          assert.strictEqual(
                                            messages[0].from.address,
                                            format('noreply@%s', global.oaeTests.tenants.cam.host)
                                          );

                                          return callback();
                                        });
                                      }
                                    );
                                  });
                                });
                              });
                            }
                          );
                        });
                      });
                    }
                  );
                });
              });
            }
          );
        });
      });
    });
  });

  describe('Spam Prevention', () => {
    /**
     * Test that verifies that the Message-Id of email messages are in a format that SpamAssassin will
     * not score as being spam
     */
    it('verify emails have a trustworthy message id', (callback) => {
      /**
       * Plucking SpamAssassin's host allowance rule from property __MSGID_OK_HOST:
       * http://cpansearch.perl.org/src/FELICITY/Mail-SpamAssassin-3.0.2/rules/20_head_tests.cf
       */
      const MSGID_OK = /@(?:\D{2,}|(?:\d{1,3}\.){3}\d{1,3})/;

      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: johnDoe, 1: janeDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        // Create a content item which should trigger an email to the Gaeremonster
        createLink(
          asJohnDoe,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PRIVATE,
            link: 'http://www.google.com',
            managers: NO_MANAGERS,
            viewers: [janeDoe.user.id],
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);
            assert.ok(link);

            // Ensure the email has an ID that is not fishy to SpamAssassin
            collectAndFetchAllEmails((messages) => {
              assert.ok(messages);
              assert.isNotEmpty(messages);
              assert.ok(head(messages).messageId);
              assert.ok(MSGID_OK.test(head(messages).messageId));

              return callback();
            });
          }
        );
      });
    });

    /**
     * Test that verifies that the userid is part of the the messageid so we can find the source of a message
     */
    it('verify emails have a userid in their message id', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: johnDoe, 1: janeDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        // Create a content item which should trigger an email
        createLink(
          asJohnDoe,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PRIVATE,
            link: 'http://www.google.com',
            managers: NO_MANAGERS,
            viewers: [janeDoe.user.id],
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);
            assert.ok(link);

            // Ensure the email has an ID that contains the userid
            collectAndFetchAllEmails((messages) => {
              assert.ok(messages);
              assert.isNotEmpty(messages);
              assert.ok(head(messages).messageId);

              // `:` can't appear in email headers
              const transformedUserId = janeDoe.user.id.replace(/:/g, '-');
              assert.ok(head(messages).messageId.match(transformedUserId));

              return callback();
            });
          }
        );
      });
    });
  });

  describe('Email de-duplication', () => {
    /**
     * Test that verifies that a provided fingerprint can be used to perform de-duplication
     */
    it('verify a provided hash can be used to perform de-duplication', (callback) => {
      collectAndFetchAllEmails(() => {
        generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: johnDoe } = users;

          // The user needs an email address
          johnDoe.user.email = generateTestEmailAddress();
          const hash = 'u:cam:johndoe#123456';

          // Send out the first e-mail
          sendEmail(EMAIL_MODULE, TEST, johnDoe.user, null, { hash }, (error, message) => {
            assert.notExists(error);
            assert.ok(message);

            // Re-using the same hash should result in test failure
            sendEmail(EMAIL_MODULE, TEST, johnDoe.user, null, { hash }, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 403);

              /**
               * Re-using the same hash, but with the same mail should result in a failure
               * We generate a "different" mail by passing in a data object
               */
              sendEmail(EMAIL_MODULE, TEST, johnDoe.user, { data: TEST }, { hash }, (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 403);

                // Using another hash (but otherwise the same mail) should work
                sendEmail(
                  EMAIL_MODULE,
                  TEST,
                  johnDoe.user,
                  null,
                  { hash: 'u:cam:janeDoe#000000' },
                  (error, message) => {
                    assert.notExists(error);
                    assert.ok(message);

                    return callback();
                  }
                );
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the email info gets used when performing the deduplication
     */
    it('verify omitting the hash uses the email info for de-duplication', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: johnDoe } = users;

        // The user needs an email address
        johnDoe.user.email = generateTestEmailAddress();

        // Send out the first e-mail
        sendEmail(EMAIL_MODULE, TEST, johnDoe.user, NO_DATA, NO_OPTS, (error, message) => {
          assert.notExists(error);
          assert.ok(message);

          // Sending out the same email should result in a failure
          sendEmail(EMAIL_MODULE, TEST, johnDoe.user, NO_DATA, NO_OPTS, (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 403);

            // Sanity check that sending out a different email works
            sendEmail(EMAIL_MODULE, TEST, johnDoe.user, { data: TEST }, NO_OPTS, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 403);

              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the de-duplication interval is configurable
     */
    it('verify de-duplication is limited to a configurable interval', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: johnDoe } = users;

        // The user needs an email address
        johnDoe.user.email = generateTestEmailAddress();

        init(_createDefaultConfig({ deduplicationInterval: 2 }), (error_) => {
          assert.notExists(error_);

          // Send out the first e-mail
          sendEmail(EMAIL_MODULE, TEST, johnDoe.user, NO_DATA, NO_OPTS, (error, message) => {
            assert.notExists(error);
            assert.ok(message);

            // Sending out the same email should result in a failure
            sendEmail(EMAIL_MODULE, TEST, johnDoe.user, NO_DATA, NO_OPTS, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 403);

              // If we wait till the deduplication interval has passed, we should be able to send out the same email again
              setTimeout(() => {
                sendEmail(EMAIL_MODULE, TEST, johnDoe.user, NO_DATA, NO_OPTS, (error_) => {
                  assert.notExists(error_);
                  assert.ok(message);

                  // Sanity-check that sending the same email again is now not allowed
                  sendEmail(EMAIL_MODULE, TEST, johnDoe.user, NO_DATA, NO_OPTS, (error_) => {
                    assert.ok(error_);
                    assert.strictEqual(error_.code, 403);

                    return callback();
                  });
                });
              }, 2500);
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the same email can be sent to multiple users
     */
    it('verify the same email can be sent to multiple users', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: johnDoe, 1: janeDoe } = users;

        // The users need an email address
        johnDoe.user.email = generateTestEmailAddress();
        janeDoe.user.email = generateTestEmailAddress();

        sendEmail(EMAIL_MODULE, TEST, johnDoe.user, NO_DATA, NO_OPTS, (error, message) => {
          assert.notExists(error);
          assert.ok(message);

          sendEmail(EMAIL_MODULE, TEST, janeDoe.user, NO_DATA, NO_OPTS, (error, message) => {
            assert.notExists(error);
            assert.ok(message);

            // Sanity-check we cannot send it twice
            sendEmail(EMAIL_MODULE, TEST, johnDoe.user, NO_DATA, NO_OPTS, (error /* , message */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 403);

              sendEmail(EMAIL_MODULE, TEST, janeDoe.user, NO_DATA, NO_OPTS, (error /* , message */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 403);

                return callback();
              });
            });
          });
        });
      });
    });
  });

  describe('Throttling', () => {
    /**
     * Test that verifies that emails get throttled
     */
    it('verify email throttling', (callback) => {
      /**
       * Throttle when more than 2 mails to the same user are sent in a timespan of 2 seconds. We give 2 seconds because we need
       * at least 2 buckets to cover our interval to avoid interval roll-overs resetting our count and intermittently failing the test
       */
      init(_createDefaultConfig({ throttling: { timespan: 2, count: 2 } }), (error) => {
        assert.notExists(error);

        generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: johnDoe } = users;

          // The user needs an email address
          johnDoe.user.email = generateTestEmailAddress();

          sendEmail(
            EMAIL_MODULE,
            'test',
            johnDoe.user,
            NO_DATA,
            { hash: generateUniqueHash() },
            (error /* , message */) => {
              assert.notExists(error);

              sendEmail(
                EMAIL_MODULE,
                TEST,
                johnDoe.user,
                null,
                { hash: generateUniqueHash() },
                (error /* , message */) => {
                  assert.notExists(error);

                  sendEmail(
                    EMAIL_MODULE,
                    TEST,
                    johnDoe.user,
                    null,
                    { hash: generateUniqueHash() },
                    (error /* , message */) => {
                      assert.ok(error);
                      assert.strictEqual(error.code, 403);

                      // If we wait longer than the throttle timespan, we should be able to send an e-mail to this user
                      setTimeout(() => {
                        sendEmail(
                          EMAIL_MODULE,
                          TEST,
                          johnDoe.user,
                          null,
                          { hash: generateUniqueHash() },
                          (error /* , message */) => {
                            assert.notExists(error);

                            return callback();
                          }
                        );
                      }, 2250);
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
