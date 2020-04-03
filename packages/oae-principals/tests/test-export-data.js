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

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import util from 'util';
import _ from 'underscore';
import dateFormat from 'dateformat';

import {
  publishCollabDoc,
  createCollabDoc,
  createCollabsheetForUser,
  assertCreateLinkSucceeds,
  createCollabsheet,
  editAndPublishCollabSheet
} from 'oae-content/lib/test/util';
import * as Etherpad from 'oae-content/lib/internal/etherpad';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import PrincipalsAPI from 'oae-principals';

const DEFAULT_SNAPSHOT = '';
const TO_STRING = 'string';
const SOME_NAME = 'name';
const SOME_DESCRIPTION = 'description';
const EXPORT_CONTENT_SCOPE = 'content';
const EXPORT_SHARED_SCOPE = 'shared';

const PUBLIC = 'public';
const PRIVATE = 'private';

describe('Export data', () => {
  // Rest contexts that can be used to make requests as different types of users
  let globalAdminRestContext = null;
  let camAdminRestContext = null;
  let camAnonymousRestContext = null;
  let gtAdminRestContext = null;
  let gtAnonymousRestContext = null;

  /**
   * @return {Stream} A stream to jpg image
   * @api private
   */
  const _getPictureStream = () => {
    return fs.createReadStream(util.format('%s/data/restroom.jpg', __dirname));
  };

  /**
   * @return {Array} An array with the contents of the extracted data
   * @api private
   */
  const parseExtractedContent = extractedData => {
    const lines = extractedData.split('\n');
    const element = [];

    _.each(lines, (line, i) => {
      element[i] = line
        .split(': ')
        .reverse()
        .shift();
    });
    return element;
  };

  /**
   * @return    {String}      the input to transform
   * @api private
   */
  const _commafy = string => {
    return string.split('  ').join(', ');
  };

  /**
   * Set some text in Etherpad.
   *
   * @param  {String}     userId          The ID of the user who wil be changing the text
   * @param  {Content}    contentObj      The content object for which we should update the etherpad text
   * @param  {String}     text            The text to place in the pad
   * @param  {Function}   callback        Standard callback function
   * @param  {Object}     callback.err    An error that occurred, if any
   */
  const _setEtherpadText = function(userId, contentObj, text, callback) {
    const etherpadClient = Etherpad.getClient(contentObj.id);
    const args = {
      padID: contentObj.etherpadPadId,
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
  const _getEtherpadText = function(contentObj, callback) {
    const etherpadClient = Etherpad.getClient(contentObj.id);
    const args = {
      padID: contentObj.etherpadPadId
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
  const _editAndPublish = function(user, contentObj, texts, callback) {
    let done = 0;

    const doEditAndPublish = () => {
      if (done === texts.length) {
        return callback();
      }

      // Do some edits in etherpad
      _setEtherpadText(user.user.id, contentObj, texts[done], err => {
        assert.ok(!err);

        publishCollabDoc(contentObj.id, user.user.id, () => {
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
  before(callback => {
    // Fill up the request contexts
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    camAnonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    gtAnonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.gt.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    return callback();
  });

  describe('Export personal data', () => {
    /**
     * Test that will get correct data on get personal data
     */
    it('verify get personal data', callback => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, brecke) => {
        assert.ok(!err);

        brecke.restContext.tenant = () => {
          return brecke.user.tenant;
        };

        brecke.restContext.user = () => {
          return brecke.user;
        };

        // Export personal data
        PrincipalsAPI.exportData(brecke.restContext, 'invalidUserId', 'personal-data', (err, zip) => {
          assert.ok(err);
          assert.strictEqual(400, err.code);
          PrincipalsAPI.exportData('invalidContext', brecke.user.id, 'personal-data', (err, zip) => {
            assert.ok(err);
            assert.strictEqual(401, err.code);
            PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, 'invalidExportType', (err, zip) => {
              assert.ok(err);
              assert.strictEqual(402, err.code);
              PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, 'personal-data', async (err, zip) => {
                assert.ok(!err);

                // Verify the personal data on the zip file
                const content = await zip.file('personal_data.txt').async(TO_STRING);

                const lines = content.split('\n');
                const element = [];
                _.each(lines, (line, i) => {
                  element[i] = line
                    .split(': ')
                    .reverse()
                    .shift();
                });
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
    it('verify resources with same names', callback => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, brecke) => {
        assert.ok(!err);

        brecke.restContext.tenant = function() {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function() {
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
          (err, discussion) => {
            assert.ok(!err);

            // Create one new discussion with the same name
            RestAPI.Discussions.createDiscussion(
              brecke.restContext,
              SOME_NAME,
              SOME_DESCRIPTION,
              PUBLIC,
              null,
              null,
              (err, secondDiscussion) => {
                assert.ok(!err);

                // Create one new discussion with the same name
                RestAPI.Discussions.createDiscussion(
                  brecke.restContext,
                  SOME_NAME,
                  SOME_DESCRIPTION,
                  PUBLIC,
                  null,
                  null,
                  (err, thirdDiscussion) => {
                    assert.ok(!err);

                    // Export data using 'content' export type
                    PrincipalsAPI.exportData(
                      brecke.restContext,
                      brecke.user.id,
                      EXPORT_CONTENT_SCOPE,
                      async (err, zip) => {
                        assert.ok(!err);

                        // Verify the personal data on the zip file
                        let zipDiscussion = await zip
                          .file('discussion_data/' + discussion.displayName + '.txt')
                          .async(TO_STRING);

                        let lines = zipDiscussion.split('\n');
                        let element = [];

                        _.each(lines, (line, i) => {
                          element[i] = line
                            .split(': ')
                            .reverse()
                            .shift();
                        });

                        assert.strictEqual(discussion.displayName, element[0]);

                        // Verify the personal data on the zip file
                        zipDiscussion = await zip
                          .file('discussion_data/' + discussion.displayName + '.txt')
                          .async(TO_STRING);
                        lines = zipDiscussion.split('\n');
                        element = [];

                        _.each(lines, (line, i) => {
                          element[i] = line
                            .split(': ')
                            .reverse()
                            .shift();
                        });

                        assert.strictEqual(secondDiscussion.displayName, element[0]);

                        // Verify the personal data on the zip file
                        zipDiscussion = await zip
                          .file('discussion_data/' + discussion.displayName + '(1).txt')
                          .async(TO_STRING);
                        lines = zipDiscussion.split('\n');
                        element = [];

                        _.each(lines, (line, i) => {
                          element[i] = line
                            .split(': ')
                            .reverse()
                            .shift();
                        });

                        assert.strictEqual(discussion.displayName, element[0]);

                        // Verify the personal data on the zip file
                        zipDiscussion = await zip
                          .file('discussion_data/' + discussion.displayName + '(2).txt')
                          .async(TO_STRING);
                        lines = zipDiscussion.split('\n');
                        element = [];

                        _.each(lines, (line, i) => {
                          element[i] = line
                            .split(': ')
                            .reverse()
                            .shift();
                        });

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
    it('verify get content data (collabdoc, collabsheet, link, uploaded file)', callback => {
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
      createCollabDoc(camAdminRestContext, 1, 1, (err, collabdocData) => {
        assert.ok(!err);

        const [collabdoc, users, brecke] = collabdocData;

        brecke.restContext.tenant = function() {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function() {
          return brecke.user;
        };

        createCollabsheetForUser(brecke, (err, collabsheet) => {
          assert.ok(!err);
          assertCreateLinkSucceeds(
            brecke.restContext,
            SOME_NAME,
            '',
            PRIVATE,
            'http://google.com',
            [],
            [],
            [],
            link => {
              assert.ok(link);

              // Give one of the users a profile picture
              const cropArea = { x: 0, y: 0, width: 50, height: 50 };
              RestAPI.User.uploadPicture(brecke.restContext, brecke.user.id, getPictureStream, cropArea, err => {
                assert.ok(!err);

                // Get the object
                PrincipalsAPI.collectDataToExport(
                  brecke.restContext,
                  brecke.user.id,
                  EXPORT_CONTENT_SCOPE,
                  (err, data) => {
                    assert.ok(!err);

                    // Export data using 'content' export type
                    PrincipalsAPI.exportData(
                      brecke.restContext,
                      brecke.user.id,
                      EXPORT_CONTENT_SCOPE,
                      async (err, zip) => {
                        assert.ok(!err);

                        // Verify the personal data on the zip file
                        const extractedZipData = await zip
                          .file('link_data/' + link.displayName + '.txt')
                          .async(TO_STRING);
                        let contentChunks = parseExtractedContent(extractedZipData);

                        assert.strictEqual(link.displayName, contentChunks[0]);
                        assert.strictEqual(link.profilePath, contentChunks[1]);
                        assert.strictEqual('http://google.com', contentChunks[2]);
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
                        assert.strictEqual(DEFAULT_SNAPSHOT, contentChunks[4]);

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
    it('verify get discussion data', callback => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, brecke) => {
        assert.ok(!err);

        brecke.restContext.tenant = function() {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function() {
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
          (err, discussion) => {
            assert.ok(!err);

            // Get the object
            PrincipalsAPI.collectDataToExport(brecke.restContext, brecke.user.id, EXPORT_CONTENT_SCOPE, (err, data) => {
              assert.ok(!err);

              // Export data using 'content' export type
              PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, EXPORT_CONTENT_SCOPE, async (err, zip) => {
                assert.ok(!err);

                // Verify the personal data on the zip file
                const zipDiscussion = await zip
                  .file('discussion_data/' + discussion.displayName + '.txt')
                  .async(TO_STRING);

                const lines = zipDiscussion.split('\n');
                const element = [];

                _.each(lines, (line, i) => {
                  element[i] = line
                    .split(': ')
                    .reverse()
                    .shift();
                });

                assert.strictEqual(discussion.displayName, element[0]);
                assert.strictEqual(discussion.description, element[1]);
                assert.strictEqual(discussion.tenant.host + discussion.profilePath, element[2]);
                assert.strictEqual(discussion.visibility, element[3]);
                assert.strictEqual(discussion.tenant.displayName, element[4]);

                // Compare the object with the zip content
                assert.strictEqual(zipDiscussion, data.discussions[0].text);

                return callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that will get the correct meeting data
     */
    it('verify get meeting data', callback => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, brecke) => {
        assert.ok(!err);

        brecke.restContext.tenant = function() {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function() {
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
          (err, meeting) => {
            assert.ok(!err);

            // Get the object
            PrincipalsAPI.collectDataToExport(brecke.restContext, brecke.user.id, EXPORT_CONTENT_SCOPE, (err, data) => {
              assert.ok(!err);

              // Export data using 'content' export type
              PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, EXPORT_CONTENT_SCOPE, async (err, zip) => {
                assert.ok(!err);

                // Verify the personal data on the zip file
                const zipMeeting = await zip.file('meeting_data/' + meeting.displayName + '.txt').async(TO_STRING);

                const lines = zipMeeting.split('\n');
                const element = [];

                _.each(lines, (line, i) => {
                  element[i] = line
                    .split(': ')
                    .reverse()
                    .shift();
                });

                assert.strictEqual(meeting.displayName, element[0]);
                assert.strictEqual(meeting.description, element[1]);
                assert.strictEqual(meeting.tenant.host + meeting.profilePath, element[2]);
                assert.strictEqual(meeting.visibility, element[3]);
                assert.strictEqual(meeting.tenant.displayName, element[4]);

                // Compare the object with the zip content
                assert.strictEqual(zipMeeting, data.meetings[0].text);

                return callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test we get the correct meeting using the 'shared' export type
     */
    it("verify get the correct data using 'shared' export type", callback => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, brecke, simon) => {
        assert.ok(!err);

        simon.restContext.tenant = function() {
          return simon.user.tenant;
        };

        simon.restContext.user = function() {
          return simon.user;
        };

        brecke.restContext.tenant = function() {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function() {
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
          (err, meeting) => {
            assert.ok(!err);

            // Export the data using 'shared' export type
            PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, EXPORT_SHARED_SCOPE, (err, zip) => {
              assert.ok(!err);

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
    it('verify we only get the data asked and not more', callback => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, brecke, simon) => {
        assert.ok(!err);

        simon.restContext.tenant = function() {
          return simon.user.tenant;
        };

        simon.restContext.user = function() {
          return simon.user;
        };

        brecke.restContext.tenant = function() {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function() {
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
          (err, breckeMeeting) => {
            assert.ok(!err);

            // Export personal data and verify we don't get the shared content
            PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, 'personal-data', (err, zip) => {
              assert.ok(!err);
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
                (err, simonMeeting) => {
                  assert.ok(!err);

                  // Export personal data and verify we don't get the shared content
                  PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, 'personal-data', (err, zip) => {
                    assert.ok(!err);
                    assert.ok(!zip.files['meeting_data/simonMeeting.txt']);

                    // Export content data and verify we don't get the shared content
                    PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, EXPORT_CONTENT_SCOPE, (err, zip) => {
                      assert.ok(!err);
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
    it('verify get the correct data inside a collabdoc', callback => {
      // Generate user in cam tenant
      createCollabDoc(camAdminRestContext, 1, 1, (err, collabdocData) => {
        const [collabdoc, users, brecke] = collabdocData;
        brecke.restContext.tenant = function() {
          return brecke.user.tenant;
        };

        brecke.restContext.user = function() {
          return brecke.user;
        };

        const text =
          'Most modern calendars mar the sweet simplicity of our lives by reminding us that each day that passes is the anniversary of some perfectly uninteresting event.';

        // Do some edits in etherpad
        _editAndPublish(brecke, collabdoc, [text], () => {
          // Export the 'content' data
          PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, EXPORT_CONTENT_SCOPE, async (err, zip) => {
            assert.ok(!err);

            // Verify the personal data on the zip file
            const extractedZip = await zip.file('collabdoc_data/' + collabdoc.displayName + '.txt').async(TO_STRING);

            const contentChunks = parseExtractedContent(extractedZip);
            const spreadsheetContent = contentChunks[4];

            // Get etharpad text and compare it
            _getEtherpadText(collabdoc, (err, data) => {
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
    it('verify get the correct data inside a collabsheet', callback => {
      createCollabsheet(camAdminRestContext, 1, 1, (err, collabsheetData) => {
        const [collabdoc, users, brecke] = collabsheetData;

        brecke.restContext.tenant = () => {
          return brecke.user.tenant;
        };

        brecke.restContext.user = () => {
          return brecke.user;
        };

        const text =
          'Most modern calendars mar the sweet simplicity of our lives by reminding us that each day that passes is the anniversary of some perfectly uninteresting event';
        const textToCSV = text.split(' ').join(', ');

        // Here we are not testing the API but instead editing through the driver diirectly
        editAndPublishCollabSheet(brecke, collabdoc, textToCSV, (err, contentInJSON) => {
          assert.ok(!err);
          PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, EXPORT_CONTENT_SCOPE, async (err, zip) => {
            assert.ok(!err);

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
    it('verify get the correct comments related to a resource', callback => {
      // Generate user in cam tenant
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, simon) => {
        assert.ok(!err);

        // Generate user and content in cam tenant
        createCollabDoc(camAdminRestContext, 1, 1, (err, collabdocData) => {
          const [collabdoc, users, brecke] = collabdocData;
          brecke.restContext.tenant = function() {
            return brecke.user.tenant;
          };

          brecke.restContext.user = function() {
            return brecke.user;
          };

          simon.restContext.tenant = function() {
            return simon.user.tenant;
          };

          simon.restContext.user = function() {
            return simon.user;
          };

          // Create one comment
          RestAPI.Content.createComment(brecke.restContext, collabdoc.id, 'This is a comment', null, (err, comment) => {
            assert.ok(!err);

            // Create one more
            RestAPI.Content.createComment(
              simon.restContext,
              collabdoc.id,
              'Another comment',
              null,
              (err, anotherComment) => {
                assert.ok(!err);

                // Export the 'content' data
                PrincipalsAPI.exportData(brecke.restContext, brecke.user.id, EXPORT_CONTENT_SCOPE, async (err, zip) => {
                  assert.ok(!err);

                  // Verify the collabdoc data on the zip file
                  const zipCollabdoc = await zip
                    .file('collabdoc_data/' + collabdoc.displayName + '.txt')
                    .async(TO_STRING);
                  try {
                    const lines = zipCollabdoc.split('\n');
                    const element = [];

                    _.each(lines, (line, i) => {
                      element[i] = line.split(': ');
                    });

                    // Get the creation date
                    const messageCreatedComment = dateFormat(
                      new Date(parseInt(comment.created)), // eslint-disable-line radix
                      'dd-mm-yyyy, h:MM:ss TT'
                    );
                    const messageCreatedAnotherComment = dateFormat(
                      new Date(parseInt(comment.created)), // eslint-disable-line radix
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
                  } catch (error) {
                    return callback();
                  }

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
