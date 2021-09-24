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
import fs from 'fs';
import path from 'path';
import dateFormat from 'dateformat';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { map, head, reverse, compose, split, join } from 'ramda';

import {
  publishCollabDoc,
  createCollabDoc,
  createCollabsheetForUser,
  assertCreateLinkSucceeds,
  createCollabsheet,
  editAndPublishCollabSheet
} from 'oae-content/lib/test/util.js';
import * as Etherpad from 'oae-content/lib/internal/etherpad.js';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import PrincipalsAPI from 'oae-principals';
import { getDefaultSnapshot } from 'oae-content/lib/internal/ethercalc.js';

const TO_STRING = 'string';
const SOME_NAME = 'name';
const SOME_DESCRIPTION = 'description';
const EXPORT_CONTENT_SCOPE = 'content';
const EXPORT_SHARED_SCOPE = 'shared';

const PUBLIC = 'public';
const PRIVATE = 'private';

describe('Export data', () => {
  // Rest contexts that can be used to make requests as different types of users
  let asCambridgeTenantAdmin = null;

  /**
   * @return {Array} An array with the contents of the extracted data
   * @api private
   */
  const parseExtractedContent = (extractedData) => map(compose(head, reverse, split(': ')), split('\n', extractedData));

  /**
   * @return    {String}      the input to transform
   * @api private
   */
  const _commafy = compose(join(', '), split('  '));

  /**
   * Set some text in Etherpad.
   *
   * @param  {String}     userId          The ID of the user who wil be changing the text
   * @param  {Content}    contentObj      The content object for which we should update the etherpad text
   * @param  {String}     text            The text to place in the pad
   * @param  {Function}   callback        Standard callback function
   * @param  {Object}     callback.err    An error that occurred, if any
   */
  const _setEtherpadText = function (userId, contentObject, text, callback) {
    const etherpadClient = Etherpad.getClient(contentObject.id);
    const args = {
      padID: contentObject.etherpadPadId,
      text
    };
    etherpadClient.setText(args, callback);
  };

  /**
   * Get the text that is stored in Etherpad.
   *
   * @param  {Content}    contentObj          The content object for which we should retrieve the etherpad text.
   * @param  {Function}   callback            Standard callback function
   * @param  {Object}     callback.err        An error that occurred, if any
   * @param  {Object}     callback.data       Standard Etherpad API response object.
   * @param  {String}     callback.data.text  The actual string of text that is stored in the pad.
   */
  const _getEtherpadText = function (contentObject, callback) {
    const etherpadClient = Etherpad.getClient(contentObject.id);
    const args = {
      padID: contentObject.etherpadPadId
    };
    etherpadClient.getText(args, callback);
  };

  /**
   * Changes the text in the etherpad pad and publishes the document.
   * The amount of edit/publish cycles depends on how many strings there are in the `texts` array.
   * Each string will be placed in the pad and result in a document publish.
   *
   * @param  {Object}     user        An object containing the `user` and `restContext` that will be performing the edit and publish
   * @param  {Content}    contentObj  The content object to publish
   * @param  {String[]}   texts       An array of texts that should be placed in the pad. The document will be published for each string in this array.
   * @param  {Function}   callback    Standard callback function
   */
  const _editAndPublish = function (user, contentObject, texts, callback) {
    let done = 0;

    const doEditAndPublish = () => {
      if (done === texts.length) {
        return callback();
      }

      // Do some edits in etherpad
      _setEtherpadText(user.user.id, contentObject, texts[done], (error) => {
        assert.notExists(error);

        publishCollabDoc(contentObject.id, user.user.id, () => {
          done++;
          doEditAndPublish();
        });
      });
    };

    doEditAndPublish();
  };

  /**
   * Function that will fill up the REST and admin contexts
   */
  before((callback) => {
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    return callback();
  });

  describe('Export personal data', () => {
    /**
     * Test that will get correct data on get personal data
     */
    it('verify get personal data', (callback) => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: brecke } = users;

        brecke.restContext.tenant = () => {
          return brecke.user.tenant;
        };

        brecke.restContext.user = () => {
          return brecke.user;
        };

        // Export personal data
        PrincipalsAPI.exportData(brecke.restContext, 'invalidUserId', 'personal-data', (error /* , zip */) => {
          assert.ok(error);
          assert.strictEqual(400, error.code);
          PrincipalsAPI.exportData('invalidContext', brecke.user.id, 'personal-data', (error /* , zip */) => {
            assert.ok(error);
            assert.strictEqual(401, error.code);
            PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, 'invalidExportType', (error /* , zip */) => {
              assert.ok(error);
              assert.strictEqual(402, error.code);
              PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, 'personal-data', async (error, zip) => {
                assert.notExists(error);

                // Verify the personal data on the zip file
                const content = await zip.file('personal_data.txt').async(TO_STRING);
                const element = map(compose(head, reverse, split(': ')), split('\n', content));

                assert.strictEqual(brecke.user.id, element[0]);
                assert.strictEqual(brecke.user.displayName, element[1]);
                assert.strictEqual(brecke.user.email, element[2]);

                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verify if there is 2 resources with the same name, they will have different names
     */
    it('verify resources with same names', (callback) => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: brecke } = users;

        brecke.restContext.tenant = function () {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function () {
          return brecke.user;
        };

        // Create one new discussion
        RestAPI.Discussions.createDiscussion(
          brecke.restContext,
          SOME_NAME,
          SOME_DESCRIPTION,
          PUBLIC,
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);

            // Create one new discussion with the same name
            RestAPI.Discussions.createDiscussion(
              brecke.restContext,
              SOME_NAME,
              SOME_DESCRIPTION,
              PUBLIC,
              null,
              null,
              (error, secondDiscussion) => {
                assert.notExists(error);

                // Create one new discussion with the same name
                RestAPI.Discussions.createDiscussion(
                  brecke.restContext,
                  SOME_NAME,
                  SOME_DESCRIPTION,
                  PUBLIC,
                  null,
                  null,
                  (error, thirdDiscussion) => {
                    assert.notExists(error);

                    // Export data using 'content' export type
                    PrincipalsAPI.exportData(
                      brecke.restContext,
                      brecke.user.id,
                      EXPORT_CONTENT_SCOPE,
                      async (error, zip) => {
                        assert.notExists(error);

                        // Verify the personal data on the zip file
                        let zipDiscussion = await zip
                          .file('discussion_data/' + discussion.displayName + '.txt')
                          .async(TO_STRING);
                        let element = map(compose(head, reverse, split(': ')), split('\n', zipDiscussion));
                        assert.strictEqual(discussion.displayName, element[0]);

                        // Verify the personal data on the zip file
                        zipDiscussion = await zip
                          .file('discussion_data/' + discussion.displayName + '.txt')
                          .async(TO_STRING);
                        element = map(compose(head, reverse, split(': ')), split('\n', zipDiscussion));
                        assert.strictEqual(secondDiscussion.displayName, element[0]);

                        // Verify the personal data on the zip file
                        zipDiscussion = await zip
                          .file('discussion_data/' + discussion.displayName + '(1).txt')
                          .async(TO_STRING);
                        element = map(compose(head, reverse, split(': ')), split('\n', zipDiscussion));
                        assert.strictEqual(discussion.displayName, element[0]);

                        // Verify the personal data on the zip file
                        zipDiscussion = await zip
                          .file('discussion_data/' + discussion.displayName + '(2).txt')
                          .async(TO_STRING);
                        element = map(compose(head, reverse, split(': ')), split('\n', zipDiscussion));
                        assert.strictEqual(thirdDiscussion.displayName, element[0]);

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
     * Test that will get the correct content data (collabdoc, link, uploaded file)
     */
    it('verify get content data (collabdoc, collabsheet, link, uploaded file)', (callback) => {
      /**
       * Return a profile picture stream
       *
       * @return {Stream}     A stream containing an profile picture
       */
      const getPictureStream = () => {
        const file = path.join(__dirname, '/data/restroom.jpg');
        return fs.createReadStream(file);
      };

      // Generate user in cam tenant
      createCollabDoc(asCambridgeTenantAdmin, 1, 1, (error, collabdocData) => {
        assert.notExists(error);

        const { 0: collabdoc, 2: brecke } = collabdocData;

        brecke.restContext.tenant = function () {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function () {
          return brecke.user;
        };

        createCollabsheetForUser(brecke, (error, collabsheet) => {
          assert.notExists(error);
          assertCreateLinkSucceeds(
            brecke.restContext,
            SOME_NAME,
            '',
            PRIVATE,
            'https://www.google.co.uk',
            [],
            [],
            [],
            (link) => {
              assert.ok(link);

              // Give one of the users a profile picture
              const cropArea = { x: 0, y: 0, width: 50, height: 50 };
              RestAPI.User.uploadPicture(brecke.restContext, brecke.user.id, getPictureStream, cropArea, (error_) => {
                assert.notExists(error_);

                // Get the object
                PrincipalsAPI.collectDataToExport(
                  brecke.restContext,
                  brecke.user.id,
                  EXPORT_CONTENT_SCOPE,
                  (error, data) => {
                    assert.notExists(error);

                    // Export data using 'content' export type
                    PrincipalsAPI.exportData(
                      brecke.restContext,
                      brecke.user.id,
                      EXPORT_CONTENT_SCOPE,
                      async (error, zip) => {
                        assert.notExists(error);

                        // Verify the personal data on the zip file
                        const extractedZipData = await zip
                          .file('link_data/' + link.displayName + '.txt')
                          .async(TO_STRING);
                        let contentChunks = parseExtractedContent(extractedZipData);

                        assert.strictEqual(link.displayName, contentChunks[0]);
                        assert.strictEqual(link.profilePath, contentChunks[1]);
                        assert.strictEqual('https://www.google.co.uk', contentChunks[2]);
                        assert.strictEqual(link.visibility, contentChunks[3]);
                        assert.strictEqual(link.tenant.displayName, contentChunks[4]);

                        // Verify the collabdoc data on the zip file
                        let extractedZip = await zip
                          .file('collabdoc_data/' + collabdoc.displayName + '.txt')
                          .async(TO_STRING);
                        contentChunks = parseExtractedContent(extractedZip);

                        assert.strictEqual(extractedZip, data.collabdocs[0].text);
                        assert.strictEqual(collabdoc.displayName, contentChunks[0]);
                        assert.strictEqual(collabdoc.profilePath, contentChunks[1]);
                        assert.strictEqual(collabdoc.visibility, contentChunks[2]);
                        assert.strictEqual(collabdoc.tenant.displayName, contentChunks[3]);
                        assert.strictEqual('undefined', contentChunks[4]);

                        // Verify the collabsheet data on the zip file
                        extractedZip = await zip
                          .file('collabsheet_data/' + collabsheet.displayName + '.txt')
                          .async(TO_STRING);
                        contentChunks = parseExtractedContent(extractedZip);

                        assert.strictEqual(extractedZip, data.collabsheets[0].text);
                        assert.strictEqual(collabsheet.displayName, contentChunks[0]);
                        assert.strictEqual(collabsheet.profilePath, contentChunks[1]);
                        assert.strictEqual(collabsheet.visibility, contentChunks[2]);
                        assert.strictEqual(collabsheet.tenant.displayName, contentChunks[3]);
                        assert.strictEqual(getDefaultSnapshot(), contentChunks[4]);

                        // Verify the personal data on the zip file
                        const zipPicture = await zip.file('large.jpg').async('uint8array');
                        assert.ok(zipPicture);

                        // Compare the object with the zip content
                        assert.strictEqual(extractedZipData, data.links[0].text);

                        return callback();
                      }
                    );
                  }
                );
              });
            }
          );
        });
      });
    });

    /**
     * Test that will get the correct discussion data
     */
    it('verify get discussion data', (callback) => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: brecke } = users;

        brecke.restContext.tenant = function () {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function () {
          return brecke.user;
        };

        // Create one new discussion
        RestAPI.Discussions.createDiscussion(
          brecke.restContext,
          SOME_NAME,
          SOME_DESCRIPTION,
          PUBLIC,
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);

            // Get the object
            PrincipalsAPI.collectDataToExport(
              brecke.restContext,
              brecke.user.id,
              EXPORT_CONTENT_SCOPE,
              (error, data) => {
                assert.notExists(error);

                // Export data using 'content' export type
                PrincipalsAPI.exportData(
                  brecke.restContext,
                  brecke.user.id,
                  EXPORT_CONTENT_SCOPE,
                  async (error, zip) => {
                    assert.notExists(error);

                    // Verify the personal data on the zip file
                    const zipDiscussion = await zip
                      .file('discussion_data/' + discussion.displayName + '.txt')
                      .async(TO_STRING);

                    const element = map(compose(head, reverse, split(': ')), split('\n', zipDiscussion));

                    assert.strictEqual(discussion.displayName, element[0]);
                    assert.strictEqual(discussion.description, element[1]);
                    assert.strictEqual(discussion.tenant.host + discussion.profilePath, element[2]);
                    assert.strictEqual(discussion.visibility, element[3]);
                    assert.strictEqual(discussion.tenant.displayName, element[4]);

                    // Compare the object with the zip content
                    assert.strictEqual(zipDiscussion, data.discussions[0].text);

                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that will get the correct meeting data
     */
    it('verify get meeting data', (callback) => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: brecke } = users;

        brecke.restContext.tenant = function () {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function () {
          return brecke.user;
        };

        // Create one new meeting
        RestAPI.MeetingsJitsi.createMeeting(
          brecke.restContext,
          SOME_NAME,
          SOME_DESCRIPTION,
          false,
          false,
          'public',
          [],
          [],
          (error, meeting) => {
            assert.notExists(error);

            // Get the object
            PrincipalsAPI.collectDataToExport(
              brecke.restContext,
              brecke.user.id,
              EXPORT_CONTENT_SCOPE,
              (error, data) => {
                assert.notExists(error);

                // Export data using 'content' export type
                PrincipalsAPI.exportData(
                  brecke.restContext,
                  brecke.user.id,
                  EXPORT_CONTENT_SCOPE,
                  async (error, zip) => {
                    assert.notExists(error);

                    // Verify the personal data on the zip file
                    const zipMeeting = await zip.file('meeting_data/' + meeting.displayName + '.txt').async(TO_STRING);
                    const element = map(compose(head, reverse, split(': ')), split('\n', zipMeeting));

                    assert.strictEqual(meeting.displayName, element[0]);
                    assert.strictEqual(meeting.description, element[1]);
                    assert.strictEqual(meeting.tenant.host + meeting.profilePath, element[2]);
                    assert.strictEqual(meeting.visibility, element[3]);
                    assert.strictEqual(meeting.tenant.displayName, element[4]);

                    // Compare the object with the zip content
                    assert.strictEqual(zipMeeting, data.meetings[0].text);

                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test we get the correct meeting using the 'shared' export type
     */
    it("verify get the correct data using 'shared' export type", (callback) => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: brecke, 1: simon } = users;

        simon.restContext.tenant = function () {
          return simon.user.tenant;
        };

        simon.restContext.user = function () {
          return simon.user;
        };

        brecke.restContext.tenant = function () {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function () {
          return brecke.user;
        };

        // Create one new meeting
        RestAPI.MeetingsJitsi.createMeeting(
          simon.restContext,
          SOME_NAME,
          SOME_DESCRIPTION,
          false,
          false,
          PUBLIC,
          [],
          [brecke.user.id],
          (error, meeting) => {
            assert.notExists(error);

            // Export the data using 'shared' export type
            PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, EXPORT_SHARED_SCOPE, (error, zip) => {
              assert.notExists(error);

              // Verify the personal data on the zip file
              assert.ok(zip.files['meeting_data/' + meeting.displayName + '.txt']);

              return callback();
            });
          }
        );
      });
    });

    /**
     * Test that verify we get only personal data with the 'personal-data' export type
     * and that we get only created data with the 'content' export type
     */
    it('verify we only get the data asked and not more', (callback) => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: brecke, 1: simon } = users;

        simon.restContext.tenant = function () {
          return simon.user.tenant;
        };

        simon.restContext.user = function () {
          return simon.user;
        };

        brecke.restContext.tenant = function () {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function () {
          return brecke.user;
        };

        // Create one new meeting
        RestAPI.MeetingsJitsi.createMeeting(
          brecke.restContext,
          'breckeMeeting',
          SOME_DESCRIPTION,
          false,
          false,
          PUBLIC,
          [],
          [],
          (error /* , breckeMeeting */) => {
            assert.notExists(error);

            // Export personal data and verify we don't get the shared content
            PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, 'personal-data', (error, zip) => {
              assert.notExists(error);
              assert.ok(!zip.files['meeting_data/breckeMeeting.txt']);

              // Create one new meeting
              RestAPI.MeetingsJitsi.createMeeting(
                simon.restContext,
                'simonMeeting',
                'description',
                false,
                false,
                PUBLIC,
                [],
                [brecke.user.id],
                (error /* , simonMeeting */) => {
                  assert.notExists(error);

                  // Export personal data and verify we don't get the shared content
                  PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, 'personal-data', (error, zip) => {
                    assert.notExists(error);
                    assert.ok(!zip.files['meeting_data/simonMeeting.txt']);

                    // Export content data and verify we don't get the shared content
                    PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, EXPORT_CONTENT_SCOPE, (error, zip) => {
                      assert.notExists(error);
                      assert.ok(!zip.files['meeting_data/SimonMeeting.txt']);

                      return callback();
                    });
                  });
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verify we get the text inside a collabdoc file
     */
    it('verify get the correct data inside a collabdoc', (callback) => {
      // Generate user in cam tenant
      createCollabDoc(asCambridgeTenantAdmin, 1, 1, (error, collabdocData) => {
        assert.notExists(error);
        const { 0: collabdoc, 2: brecke } = collabdocData;
        brecke.restContext.tenant = () => brecke.user.tenant;
        brecke.restContext.user = () => brecke.user;

        const text =
          'Most modern calendars mar the sweet simplicity of our lives by reminding us that each day that passes is the anniversary of some perfectly uninteresting event.';

        // Do some edits in etherpad
        _editAndPublish(brecke, collabdoc, [text], () => {
          // Export the 'content' data
          PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, EXPORT_CONTENT_SCOPE, async (error, zip) => {
            assert.notExists(error);

            // Verify the personal data on the zip file
            const extractedZip = await zip.file('collabdoc_data/' + collabdoc.displayName + '.txt').async(TO_STRING);

            const contentChunks = parseExtractedContent(extractedZip);
            const spreadsheetContent = contentChunks[4];

            // Get etharpad text and compare it
            _getEtherpadText(collabdoc, (error /* , data */) => {
              assert.notExists(error);

              assert.ok(spreadsheetContent.includes(text));
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verify we get the text inside a collabsheet file
     */
    it('verify get the correct data inside a collabsheet', (callback) => {
      createCollabsheet(asCambridgeTenantAdmin, 1, 1, (error, collabsheetData) => {
        assert.notExists(error);
        const { 0: collabdoc, 2: brecke } = collabsheetData;

        brecke.restContext.tenant = () => brecke.user.tenant;
        brecke.restContext.user = () => brecke.user;

        const text =
          'Most modern calendars mar the sweet simplicity of our lives by reminding us that each day that passes is the anniversary of some perfectly uninteresting event';
        const textToCSV = text.split(' ').join(', ');

        // Here we are not testing the API but instead editing through the driver diirectly
        editAndPublishCollabSheet(brecke, collabdoc, textToCSV, (error, contentInJSON) => {
          assert.notExists(error);
          PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, EXPORT_CONTENT_SCOPE, async (error, zip) => {
            assert.notExists(error);

            const extractedZip = await zip.file('collabsheet_data/' + collabdoc.displayName + '.txt').async(TO_STRING);

            const contentChunks = parseExtractedContent(extractedZip);
            const spreadsheetContent = contentChunks[4];

            // Get ethercalc text and compare it
            assert.strictEqual(contentInJSON[0].join(), _commafy(spreadsheetContent));
            assert.strictEqual(textToCSV, _commafy(spreadsheetContent));
            assert.strictEqual(textToCSV, contentInJSON[0].join());
            return callback();
          });
        });
      });
    });

    /**
     * Test that verify we get all the comments related to a resource
     */
    it('verify get the correct comments related to a resource', (callback) => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simon } = users;

        // Generate user and content in cam tenant
        createCollabDoc(asCambridgeTenantAdmin, 1, 1, (error, collabdocData) => {
          assert.notExists(error);
          const { 0: collabdoc, 2: brecke } = collabdocData;
          brecke.restContext.tenant = function () {
            return brecke.user.tenant;
          };

          brecke.restContext.user = function () {
            return brecke.user;
          };

          simon.restContext.tenant = function () {
            return simon.user.tenant;
          };

          simon.restContext.user = function () {
            return simon.user;
          };

          // Create one comment
          RestAPI.Content.createComment(
            brecke.restContext,
            collabdoc.id,
            'This is a comment',
            null,
            (error, comment) => {
              assert.notExists(error);

              // Create one more
              RestAPI.Content.createComment(
                simon.restContext,
                collabdoc.id,
                'Another comment',
                null,
                (error, anotherComment) => {
                  assert.notExists(error);

                  // Export the 'content' data
                  PrincipalsAPI.exportData(
                    brecke.restContext,
                    brecke.user.id,
                    EXPORT_CONTENT_SCOPE,
                    async (error, zip) => {
                      assert.notExists(error);

                      // Verify the collabdoc data on the zip file
                      const zipCollabdoc = await zip
                        .file('collabdoc_data/' + collabdoc.displayName + '.txt')
                        .async(TO_STRING);
                      try {
                        const element = map(split(': '), split('\n', zipCollabdoc));

                        // Get the creation date
                        const messageCreatedComment = dateFormat(
                          new Date(Number.parseInt(comment.created)), // eslint-disable-line radix
                          'dd-mm-yyyy, h:MM:ss TT'
                        );
                        const messageCreatedAnotherComment = dateFormat(
                          new Date(Number.parseInt(comment.created)), // eslint-disable-line radix
                          'dd-mm-yyyy, h:MM:ss TT'
                        );

                        // Get the message level
                        const levelComment = element[8][1].split(' ');
                        const levelAnotherComment = element[7][1].split(' ');

                        // Verify if the comment and the author of the comment are the same
                        assert.strictEqual(element[8][3], comment.body);
                        assert.ok(element[8][2].includes(comment.createdBy.publicAlias));
                        assert.strictEqual(levelComment[1], comment.level.toString());
                        assert.ok(element[8][0].includes(messageCreatedComment));

                        // Verify if the comment and the author of the comment are the same
                        assert.strictEqual(element[7][3], anotherComment.body);
                        assert.ok(element[7][2].includes(anotherComment.createdBy.publicAlias));
                        assert.strictEqual(levelAnotherComment[1], anotherComment.level.toString());
                        assert.ok(element[7][0].includes(messageCreatedAnotherComment));
                      } catch {
                        return callback();
                      }

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
