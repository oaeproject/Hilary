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

/* eslint-disable camelcase */
import { assert } from 'chai';
import fs from 'fs';
import path from 'path';
import util from 'util';
import sharp from 'sharp';
import { keys, equals, find, toUpper, not, compose, head, values, prop } from 'ramda';

import request from 'request';
import nock from 'nock';

import { SearchConstants } from 'oae-search/lib/constants';
import { ActivityConstants } from 'oae-activity/lib/constants';

import * as ActivityTestsUtil from 'oae-activity/lib/test/util';
import * as Cassandra from 'oae-util/lib/cassandra';
import * as ConfigTestUtil from 'oae-config/lib/test/util';
import * as ContentTestUtil from 'oae-content/lib/test/util';
import * as Etherpad from 'oae-content/lib/internal/etherpad';
import * as FoldersPreviews from 'oae-folders/lib/previews';
import * as FoldersTestUtil from 'oae-folders/lib/test/util';
import * as MQ from 'oae-util/lib/mq';
import * as MQTestUtil from 'oae-util/lib/test/mq-util';
import * as RestAPI from 'oae-rest';
import * as RestUtil from 'oae-rest/lib/util';
import * as Tempfile from 'oae-util/lib/tempfile';
import * as TestsUtil from 'oae-tests/lib/util';
import * as PreviewAPI from 'oae-preview-processor/lib/api';
import PreviewConstants from 'oae-preview-processor/lib/constants';
import * as PreviewDefaultLinks from 'oae-preview-processor/lib/processors/link/default';
import * as PreviewFlickr from 'oae-preview-processor/lib/processors/link/flickr';
import * as PreviewOffice from 'oae-preview-processor/lib/processors/file/office';
import * as PreviewPDF from 'oae-preview-processor/lib/processors/file/pdf';
import * as PreviewSlideShare from 'oae-preview-processor/lib/processors/link/slideshare';
import * as PreviewTestUtil from 'oae-preview-processor/lib/test/util';
import { downloadRemoteFile } from 'oae-preview-processor/lib/util';

const PRIVATE = 'private';
const PUBLIC = 'public';

const NO_MANAGERS = [];
const NO_FOLDERS = [];
const NO_VIEWERS = [];

describe('Preview processor', () => {
  // We fill this variable on tests startup with the configuration as specified in the root config.js/beforeTests file.
  let defaultConfig = null;

  // Rest Contexts that can be used for global admin, tenant admin and anonymous users
  let signedAdminRestContext = null;
  let globalAdminRestContext = null;
  let camAdminRestContext = null;
  let anonymousRestContext = null;

  before(callback => {
    signedAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.localhost.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);

    // Configure the SlideShare & Flickr processors.
    // We also switch the storage mechanism to 'test', so the PP can download the actual files.
    const update = {
      'oae-content/storage/backend': 'test',
      'oae-preview-processor/flickr/apikey': '0d7f5c9bd0277161d65dbea380a41ce2',
      'oae-preview-processor/flickr/apisecret': '14a0bda0b8857ae0',
      'oae-preview-processor/slideshare/sharedsecret': 'CI5h3oQk',
      'oae-preview-processor/slideshare/apikey': 'd1ELqsL0',
      'oae-preview-processor/youtube/key': 'youtube-key'
    };
    ConfigTestUtil.updateConfigAndWait(globalAdminRestContext, 'admin', update, err => {
      assert.notExists(err);

      // Log in the admin so his cookie jar is set up appropriately
      RestAPI.User.getMe(signedAdminRestContext, (err /* , meObj */) => {
        assert.notExists(err);
        defaultConfig = PreviewAPI.getConfiguration();

        callback();
      });
    });
  });

  after(callback => {
    // Revert back to local storage.
    const update = { 'oae-content/storage/backend': 'local' };
    ConfigTestUtil.updateConfigAndWait(globalAdminRestContext, 'admin', update, err => {
      assert.notExists(err);
      callback();
    });
  });

  /**
   * @return {Stream} Returns a stream that points to an image
   */
  const getImageStream = () => fs.createReadStream(path.join(__dirname, '/data/image.png'));

  /**
   * @return {Stream} Returns a stream that points to a GIF image
   */
  const getImageGIFStream = () => fs.createReadStream(path.join(__dirname, '/data/image.gif'));

  /**
   * @return {Stream} Returns a stream that points to an Office file.
   */
  const getOfficeStream = () => fs.createReadStream(path.join(__dirname, '/data/word.docx'));

  /**
   * @return {Stream} Returns a stream that points to a PDF file
   */
  const getPDFStream = () => fs.createReadStream(path.join(__dirname, '/data/pdf.pdf'));

  /**
   * @return {Stream} Returns a stream that points to a PDF file with multiple pages in it
   */
  const getMultiplePagesPDFStream = () => fs.createReadStream(path.join(__dirname, '/data/two-pages.pdf'));

  /**
   * @return {Stream} Returns a stream that points to a ZIP file
   */
  const getZipStream = () => fs.createReadStream(path.join(__dirname, '/data/foo.zip'));

  describe('Processor registration', () => {
    /**
     * Test that verifies that the processors are unregistered correctly and that the score as returned from the `test` function is respected
     */
    it('verify that processors can be unregistered', callback => {
      // Register some processors, each with a different test score
      PreviewAPI.registerProcessor('verify-pp-20', {
        testval: 20,
        test(ctx, contentObj, callback) {
          callback(null, 20);
        },
        generatePreviews() {}
      });
      PreviewAPI.registerProcessor('verify-pp-30', {
        testval: 30,
        test(ctx, contentObj, callback) {
          callback(null, 30);
        },
        generatePreviews() {}
      });
      PreviewAPI.registerProcessor('verify-pp--1', {
        testval: -1,
        test(ctx, contentObj, callback) {
          callback(null, -1);
        },
        generatePreviews() {}
      });

      // Create a piece of content as a regular user
      TestsUtil.generateTestUsers(signedAdminRestContext, 1, (err, response) => {
        assert.ok(not(err));
        const restCtx = compose(prop('restContext'), head, values)(response);

        RestAPI.Content.createFile(
          restCtx,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            PRIVATE,
            file: getImageStream,
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (err, contentObj) => {
            assert.notExists(err);

            // Generate a mock preview context
            const mockCtx = {
              content: contentObj,
              revision: {}
            };
            // The processor who returns 30 should be on top
            PreviewAPI.getProcessor(mockCtx, contentObj, (err, processor) => {
              assert.notExists(err);
              assert.strictEqual(processor.testval, 30);

              // Unregister our processors
              PreviewAPI.unregisterProcessor('verify-pp-20');
              PreviewAPI.unregisterProcessor('verify-pp-30');
              PreviewAPI.unregisterProcessor('verify-pp--1');
              callback();
            });
          }
        );
      });
    });

    /**
     * Test that verifies that all required parameters are validated when (un)registering a processor.
     */
    it('verify parameter validation', () => {
      assert.throws(() => PreviewAPI.registerProcessor(null), Error, null, 'A preview processor needs an ID.');
      assert.throws(
        () => PreviewAPI.registerProcessor('test', null),
        Error,
        null,
        'A preview processor needs to specify an object that has a test and generatePreviews method.'
      );
      assert.throws(
        () => PreviewAPI.registerProcessor('test', {}),
        Error,
        null,
        'A preview processor needs to specify an object that has a test and generatePreviews method.'
      );
      assert.throws(
        () => PreviewAPI.registerProcessor('test', { generatePreviews() {} }),
        Error,
        null,
        'A preview processor needs to specify an object that has a test and generatePreviews method.'
      );
      assert.throws(
        () => PreviewAPI.registerProcessor('test', { test() {} }),
        Error,
        null,
        'A preview processor needs to specify an object that has a test and generatePreviews method.'
      );
      assert.throws(
        () => PreviewAPI.unregisterProcessor(null),
        Error,
        null,
        'An ID needs to be specified when unregistering a processor'
      );
    });
  });

  describe('Preview processor initialization', () => {
    /**
     * Test that verifies that the Office PP can detect if it is configured correctly
     */
    it('verify the Office PP can detect if it is configured correctly', callback => {
      const config = {
        binary: 'some-none-existinant-binary',
        timeout: 120000
      };
      PreviewOffice.init(config, err => {
        assert.ok(err);
        assert.strictEqual(err.code, 500);
        return callback();
      });
    });

    /**
     * Test that verifies that the PDF PP can detect if it is configured correctly
     */
    it('verify the PDF PP can detect if it is configured correctly', callback => {
      const config = {
        pdfPreview: {
          /* No viewport defined */
        }
      };
      PreviewPDF.init(config, err => {
        assert.ok(err);
        assert.strictEqual(err.code, 500);
        return callback();
      });
    });
  });

  /*!
   * Create a file and wait until its preview has been processed
   *
   * @param  {String}      resourceSubType    The resourceSubType of the content item that should be created. One of `collabdoc`, `file` or `link`
   * @param  {String}      link               The stream that points to the file that should be uploaded
   * @param  {Stream}      stream             The stream that points to the file that should be uploaded
   * @param  {Function}    callback           Standard callback function
   */
  const _createContentAndWait = function(resourceSubType, link, stream, callback) {
    // When the queue is empty, we create a piece of content for which we can generate preview items
    MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
      TestsUtil.generateTestUsers(signedAdminRestContext, 1, (err, users) => {
        assert.notExists(err);
        const { 0: simon } = users;
        const restCtx = simon.restContext;

        const contentCreated = function(err, contentObj) {
          assert.notExists(err);

          // Wait until the PP items have been generated
          MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
            // Ensure the preview items are there
            RestAPI.Content.getContent(restCtx, contentObj.id, (err, updatedContent) => {
              assert.notExists(err);
              callback(restCtx, updatedContent);
            });
          });
        };

        if (resourceSubType === 'file') {
          RestAPI.Content.createFile(
            restCtx,
            {
              displayName: 'Test Content 1',
              description: 'Test content description 1',
              PUBLIC,
              file: stream,
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            contentCreated
          );
        } else if (resourceSubType === 'link') {
          RestAPI.Content.createLink(
            restCtx,
            {
              displayName: link,
              description: null,
              PRIVATE,
              link,
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            contentCreated
          );
        } else if (resourceSubType === 'collabdoc') {
          RestAPI.Content.createCollabDoc(
            restCtx,
            'Test document',
            'Test document',
            'private',
            [],
            [],
            [],
            [],
            (err, contentObj) => {
              assert.notExists(err);
              RestAPI.Content.joinCollabDoc(restCtx, contentObj.id, (err /* , data */) => {
                assert.notExists(err);

                // Put some text in the document, as we would otherwise ignore the document
                const etherpadClient = Etherpad.getClient(contentObj.id);
                const args = {
                  padID: contentObj.etherpadPadId,
                  text: 'Sweet update'
                };
                etherpadClient.setText(args, err => {
                  assert.notExists(err);

                  // Create a new revision, as the document would otherwise be ignored by the PP
                  ContentTestUtil.publishCollabDoc(contentObj.id, simon.user.id, err => {
                    return contentCreated(err, contentObj);
                  });
                });
              });
            }
          );
        }
      });
    });
  };

  /**
   * Create a content item and add it to a folder
   *
   * @param  {RestContext}    restContext                             The RestContext that should be used to add the content item to the folder
   * @param  {Folder}         folder                                  The folder to add the created content item to
   * @param  {Object}         callback                                Standard callback function
   * @param  {Content}        callback.content                        The created content item
   * @param  {Folder}         callback.folder                         The folder object that includes the new preview images
   * @param  {RestContext}    callback.contentCreatorRestContext      The rest context of the user that created the content items
   */
  const _createContentAndAddToFolder = function(restContext, folder, callback) {
    // Create an image file and let the PP process it
    _createContentAndWait('file', null, getImageStream, (contentCreatorRestContext, content) => {
      assert.strictEqual(content.previews.status, 'done');

      // Add the image to the folder. Do NOT use the FoldersTestUtil method as that purges
      // the folder content library, which could cause intermittent test failures
      RestAPI.Folders.addContentItemsToFolder(restContext, folder.id, [content.id], err => {
        assert.notExists(err);

        // Wait till the folder is processed
        FoldersPreviews.whenPreviewsComplete(() => {
          // Assert the preview images have been generated
          FoldersTestUtil.assertGetFolderSucceeds(restContext, folder.id, folder => {
            assert.ok(folder.previews);
            assert.ok(folder.previews.thumbnailUrl);
            assert.ok(folder.previews.wideUrl);
            return callback(content, folder, contentCreatorRestContext);
          });
        });
      });
    });
  };

  /*!
   * Test that verifies that the `downloadUrl` can in fact be downloaded.
   *
   * @param  {RestContext}    restContext         The RestContext that we should use to download the file
   * @param  {String}         downloadUrl         The signed URL that should be verified
   * @param  {Function}       callback            Standard callback function
   * @param  {String}         callback.body       The full response body
   * @param  {Response}       callback.response   The full response object
   * @throws {Error}                              An assertion error gets thrown if the file could not be downloaded
   */
  const _verifySignedUriDownload = function(restContext, downloadUrl, callback) {
    // Verify we can download it.
    const parsedUrl = new URL(downloadUrl, 'http://localhost');
    RestUtil.performRestRequest(
      restContext,
      '/api/download/signed',
      'GET',
      TestsUtil.objectifySearchParams(parsedUrl.searchParams),
      (err, body, response) => {
        assert.notExists(err);
        assert.strictEqual(response.statusCode, 200);
        assert.ok(body);
        return callback(body, response);
      }
    );
  };

  describe('Preview generation', () => {
    /*!
     * Enable the Preview Processor if the config specifies we can run with it enabled
     */
    beforeEach(callback => {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // Purge anything that is hanging around in the preview processing queues
      PreviewTestUtil.purgePreviewsQueue(() => {
        PreviewTestUtil.purgeRegeneratePreviewsQueue(() => {
          PreviewTestUtil.purgeFoldersPreviewsQueue(() => {
            // Enable the Preview Processor
            PreviewAPI.enable(err => {
              if (err) {
                return callback(new Error(err.msg));
              }

              return callback();
            });
          });
        });
      });
    });

    /*!
     * Disable the Preview Processor in case we enabled it earlier
     */
    afterEach(callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // Disable the API
      PreviewAPI.disable(err => {
        if (err) {
          return callback(new Error(err.msg));
        }

        return callback();
      });
    });

    /**
     * Test that verifies the image processor.
     */
    it('verify image processing works', callback => {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _createContentAndWait('file', null, getImageStream, (restCtx, content) => {
        assert.strictEqual(content.previews.status, 'done');
        // Ensure we have a thumbnail url.
        assert.ok(content.previews.thumbnailUrl);
        assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
        _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
          return callback();
        });
      });
    });

    /**
     * Test that verifies that animated images get converted to single frame images for thumbnail images
     */
    it('verify animated images get converted to single frame images for thumbnail images', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _createContentAndWait('file', null, getImageGIFStream, (restCtx, content) => {
        assert.strictEqual(content.previews.status, 'done');
        // Ensure we have a thumbnail url
        assert.ok(content.previews.thumbnailUrl);
        assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);

        // Download the thumbnail to a temporary file
        const tmpFile = Tempfile.createTempFile();
        const stream = fs.createWriteStream(tmpFile.path);
        request({
          jar: restCtx.cookieJar,
          url: 'http://localhost:2001' + content.previews.thumbnailUrl,
          headers: {
            host: restCtx.hostHeader,
            referer: '/'
          }
        }).pipe(stream);
        stream.on('finish', () => {
          // Verify that this is a JPG image
          sharp(tmpFile.path).metadata((err, info) => {
            assert.notExists(err);
            assert.strictEqual(toUpper(info.format), 'JPEG');

            // Clean up the temp file
            tmpFile.remove(err => {
              assert.notExists(err);
              callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies the office processor.
     */
    it('verify office processing works', function(callback) {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // OpenOffice can sometimes be painfully slow to start up.
      this.timeout(30000);

      _createContentAndWait('file', null, getOfficeStream, (restCtx, content) => {
        assert.strictEqual(content.previews.status, 'done');
        // Ensure we have a thumbnail url.
        assert.ok(content.previews.thumbnailUrl);
        assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
        _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
          // Ensure we have small and medium images.
          assert.ok(content.previews.smallUrl);
          _verifySignedUriDownload(restCtx, content.previews.smallUrl, () => {
            assert.ok(content.previews.mediumUrl);
            _verifySignedUriDownload(restCtx, content.previews.mediumUrl, () => {
              callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies the PDF processor
     */
    it('verify pdf processing works', function(callback) {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // OpenOffice can sometimes be painfully slow to start up
      this.timeout(30000);

      _createContentAndWait('file', null, getPDFStream, (restCtx, content) => {
        assert.strictEqual(content.previews.status, 'done');
        assert.strictEqual(content.previews.pageCount, 1);
        // Ensure we have a thumbnail url
        assert.ok(content.previews.thumbnailUrl);
        assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
        _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
          // Ensure we have small and medium images
          assert.ok(content.previews.smallUrl);
          _verifySignedUriDownload(restCtx, content.previews.smallUrl, () => {
            assert.ok(content.previews.mediumUrl);
            _verifySignedUriDownload(restCtx, content.previews.mediumUrl, () => {
              // Verify we have all our files
              RestAPI.Content.getPreviewItems(restCtx, content.id, content.latestRevisionId, (err, previews) => {
                assert.notExists(err);

                // The PDF has 1 page, there should only be 1 corresponding HTML file
                assert.ok(find(eachFile => equals(eachFile.filename, 'page.1.svg'), previews.files));
                assert.ok(not(find(eachFile => equals(eachFile.filename, 'page.2.svg'), previews.files)));

                // The PDF has 1 page, there should only be 1 corresponding txt file
                assert.ok(find(eachFile => equals(eachFile.filename, 'page.1.svg'), previews.files));
                assert.ok(not(find(eachFile => equals(eachFile.filename, 'page.2.svg'), previews.files)));

                // There should be 1 plain.txt file
                assert.ok(find(file => equals(file.filename, 'plain.txt'), previews.files));

                // There should not be any original individual CSS files
                assert.ok(not(find(eachFile => equals(eachFile.filename, 'base.css'), previews.files)));
                assert.ok(not(find(eachFile => equals(eachFile.filename, 'base.min.css'), previews.files)));
                assert.ok(not(find(eachFile => equals(eachFile.filename, 'fancy.css'), previews.files)));
                assert.ok(not(find(eachFile => equals(eachFile.filename, 'fancy.min.css'), previews.files)));
                assert.ok(not(find(eachFile => equals(eachFile.filename, 'lines.css'), previews.files)));
                assert.ok(not(find(eachFile => equals(eachFile.filename, 'lines.min.css'), previews.files)));
                callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies multiple pages with the PDF processor
     */
    it('verify multiple pages pdf processing works', function(callback) {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // OpenOffice can sometimes be painfully slow to start up
      this.timeout(30000);

      _createContentAndWait('file', null, getMultiplePagesPDFStream, (restCtx, content) => {
        assert.strictEqual(content.previews.status, 'done');
        assert.strictEqual(content.previews.pageCount, 2);
        // Ensure we have a thumbnail url
        assert.ok(content.previews.thumbnailUrl);
        assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);

        _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
          // Ensure we have small and medium images
          assert.ok(content.previews.smallUrl);
          _verifySignedUriDownload(restCtx, content.previews.smallUrl, () => {
            assert.ok(content.previews.mediumUrl);
            _verifySignedUriDownload(restCtx, content.previews.mediumUrl, () => {
              // Verify we have all our files
              RestAPI.Content.getPreviewItems(restCtx, content.id, content.latestRevisionId, (err, previews) => {
                assert.notExists(err);

                // The PDF has 2 pages, there should be 2 corresponding HTML files
                assert.ok(find(file => equals(file.filename, 'page.1.svg'), previews.files));
                assert.ok(find(file => equals(file.filename, 'page.2.svg'), previews.files));

                // There should not be any original individual CSS files
                assert.ok(not(find(file => equals(file.filename, 'base.css'), previews.files)));
                assert.ok(not(find(file => equals(file.filename, 'base.min.css'), previews.files)));
                assert.ok(not(find(file => equals(file.filename, 'fancy.css'), previews.files)));
                assert.ok(not(find(file => equals(file.filename, 'fancy.min.css'), previews.files)));
                assert.ok(not(find(file => equals(file.filename, 'lines.css'), previews.files)));
                assert.ok(not(find(file => equals(file.filename, 'lines.min.css'), previews.files)));
                callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that when a PDF is uploaded as the new version of a piece of content, the old previews metadata is overwritten
     */
    it('verify uploading new pdf revision', function(callback) {
      // Ignore this test if the PP is disabled
      if (not(defaultConfig.previews.enabled)) return callback();

      // OpenOffice can sometimes be painfully slow to start up
      this.timeout(50000);

      _createContentAndWait('file', null, getMultiplePagesPDFStream, (restCtx, content) => {
        assert.strictEqual(content.previews.status, 'done');
        assert.strictEqual(content.previews.pageCount, 2);

        // Verify we have all our files
        RestAPI.Content.getPreviewItems(restCtx, content.id, content.latestRevisionId, (err, previews) => {
          assert.notExists(err);

          // The PDF has 2 pages, there should be 2 corresponding HTML files
          assert.ok(find(file => equals(file.filename, 'page.1.svg'), previews.files));
          assert.ok(find(file => equals(file.filename, 'page.2.svg'), previews.files));

          // Now upload a new revision which only has one page in it
          RestAPI.Content.updateFileBody(restCtx, content.id, getPDFStream, err => {
            assert.notExists(err);

            // Wait till the file has been processed
            MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
              // Verify the previous metadata is gone
              RestAPI.Content.getContent(restCtx, content.id, (err, updatedContentObj) => {
                assert.notExists(err);
                assert.strictEqual(updatedContentObj.previews.status, 'done');
                assert.strictEqual(updatedContentObj.previews.pageCount, 1);

                // Verify the previous preview files are gone
                RestAPI.Content.getPreviewItems(
                  restCtx,
                  content.id,
                  updatedContentObj.latestRevisionId,
                  (err, previews) => {
                    assert.notExists(err);

                    // The PDF has 1 pages, there should only be one corresponding HTML file
                    assert.ok(find(file => equals(file.filename, 'page.1.svg'), previews.files));
                    assert.ok(not(find(file => equals(file.filename, 'page.2.svg'), previews.files)));
                    callback();
                  }
                );
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies the default link processor.
     */
    it('verify default link processing works', callback => {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _createContentAndWait('link', 'http://www.google.com', null, (restCtx, content) => {
        assert.strictEqual(content.previews.status, 'done');
        assert.strictEqual(content.previews.embeddable, false);
        // Ensure we have a thumbnail url.
        assert.ok(content.previews.thumbnailUrl);
        assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
        // Ensure we store the mime type
        assert.strictEqual(content.previews.targetType, 'text/html; charset=UTF-8');
        _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
          // Ensure we have small and medium images.
          assert.ok(content.previews.smallUrl);
          _verifySignedUriDownload(restCtx, content.previews.smallUrl, () => {
            assert.ok(content.previews.mediumUrl);
            _verifySignedUriDownload(restCtx, content.previews.mediumUrl, () => {
              callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies the default link processor checks if the site is embeddable
     */
    it('verify default link processing checks if a url is embeddable in an iframe', callback => {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      TestsUtil.createTestServer((app, server, port) => {
        TestsUtil.createTestServer((app2, server2, port2) => {
          // Determines whether or not we disallow embedding
          let xFrameOptions = null;
          let contentDisposition = null;

          // Add an endpoint to the mocked server that redirects to the second mocked server
          app.get('/redirect', (req, res) => {
            res.redirect('http://localhost:' + port2);
          });

          // Deny iframe embedding for all URLs
          app.use((req, res /* , next */) => {
            if (xFrameOptions) {
              res.set('x-frame-options', xFrameOptions);
            }

            if (contentDisposition) {
              res.set('Content-Disposition', contentDisposition);
            }

            return res.send('This is the best page on the webz');
          });

          // Second mock server will always set X-Frame-Options to SAMEORIGIN
          app2.use((req, res /* , next */) => {
            res.set('x-frame-options', 'SAMEORIGIN');
            return res.send('This is the second best page on the webz');
          });

          // Our mocked server will disallow embedding any page in an iframe
          xFrameOptions = 'DENY';
          _createContentAndWait('link', 'http://localhost:' + port, null, (restCtx, content) => {
            assert.strictEqual(content.previews.status, 'done');
            assert.strictEqual(content.previews.embeddable, false);

            // Ensure we have a thumbnail url
            assert.ok(content.previews.thumbnailUrl);
            assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
            _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
              // Remove the embedding restriction from our mocked server, the site should now be embeddable
              xFrameOptions = null;
              _createContentAndWait('link', 'http://localhost:' + port, null, (restCtx, content) => {
                assert.strictEqual(content.previews.status, 'done');
                assert.strictEqual(content.previews.embeddable, true);

                // Ensure we have a thumbnail url
                assert.ok(content.previews.thumbnailUrl);
                assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
                _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
                  // Create a link to the redirected endpoint, which should not be embeddable
                  _createContentAndWait('link', 'http://localhost:' + port + '/redirect', null, (restCtx, content) => {
                    assert.strictEqual(content.previews.status, 'done');
                    assert.strictEqual(content.previews.embeddable, false);

                    // Ensure we have a thumbnail url
                    assert.ok(content.previews.thumbnailUrl);
                    assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
                    _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
                      // Set Content-Disposition so the link target will be downloaded instead of displayed
                      contentDisposition = 'attachment; filename="best.txt"';
                      _createContentAndWait('link', 'http://localhost:' + port, null, (restCtx, content) => {
                        assert.strictEqual(content.previews.status, 'done');
                        assert.strictEqual(content.previews.embeddable, false);

                        // Downloaded links don't have thumbnails
                        assert.ok(!content.previews.thumbnailUrl);
                        return callback();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies the default link processor checks if the site is available over HTTPS
     */
    it('verify default link processing checks if a url is available over HTTPS', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _createContentAndWait('link', 'http://www.google.com', null, (restCtx, content) => {
        assert.strictEqual(content.previews.status, 'done');
        assert.strictEqual(content.previews.httpsAccessible, true);

        // Ensure we have a thumbnail url
        assert.ok(content.previews.thumbnailUrl);
        assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
        _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
          // Assert that URLs that are not available on HTTPs get marked as such
          _createContentAndWait('link', 'http://localhost:2000', null, (restCtx, content) => {
            assert.strictEqual(content.previews.status, 'done');
            assert.strictEqual(content.previews.httpsAccessible, false);

            // Ensure we have a thumbnail url
            assert.ok(content.previews.thumbnailUrl);
            assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
            _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies the default link processor handles HEAD failures
     */
    it('verify default link processing can handle HEAD failures', callback => {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // Create a new express application to a PP
      TestsUtil.createTestServer((app, server, port) => {
        // Destroy the connection to create an erroneous HEAD request
        app.head('/', (req, res) => {
          res.connection.destroy();
        });

        app.get('/', (req, res) => {
          res.sendStatus(200);
        });

        // Although the HEAD request fails, the preview processing should complete correctly and the link should be marked as non-embeddable
        _createContentAndWait('link', 'http://localhost:' + port, null, (restCtx, content) => {
          assert.strictEqual(content.previews.status, 'done');
          assert.strictEqual(content.previews.embeddable, false);

          // Ensure we have a thumbnail url
          assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);

          _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
            // Ensure we have small and medium images
            assert.ok(content.previews.smallUrl);
            _verifySignedUriDownload(restCtx, content.previews.smallUrl, () => {
              assert.ok(content.previews.mediumUrl);
              _verifySignedUriDownload(restCtx, content.previews.mediumUrl, () => {
                return server.close(callback);
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies the default link processor only handles http urls.
     */
    it('verify default link processing only handles http(s)', callback => {
      const content = { resourceSubType: 'link', link: 'file://localhost/etc/passwd' };
      PreviewDefaultLinks.test(null, content, (err, score) => {
        assert.notExists(err);
        assert.strictEqual(score, -1);

        content.link = 'ftp://localhost:21/etc/passwd';
        PreviewDefaultLinks.test(null, content, (err, score) => {
          assert.notExists(err);
          assert.strictEqual(score, -1);
          callback();
        });
      });
    });

    /**
     * Test that verifies blank thumbnails don't get added for unsupported mime types
     */
    it('verify default link processing does not attach blank thumbnails', callback => {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _createContentAndWait(
        'link',
        'https://github.com/oaeproject/Hilary/archive/master.zip',
        null,
        (restCtx, content) => {
          assert.strictEqual(content.previews.status, 'done');
          assert.strictEqual(content.previews.embeddable, false);
          // Ensure we don't have a thumbnail url.
          assert.ok(!content.previews.thumbnailUrl);
          return callback();
        }
      );
    });

    /**
     *  Mock the YouTube REST API
     *
     * @api private
     */
    const _mockYoutube = function() {
      // Ensure we can still perform regular HTTP requests during our tests
      nock.enableNetConnect();

      // Expect GET requests to:
      // https://www.googleapis.com/youtube/v3/videos?part=snippet&id=...&key=...
      nock('https://www.googleapis.com')
        .get('/youtube/v3/videos?part=snippet&id=lgTQ5I_H4Xk&key=youtube-key')
        .thrice()
        .reply(200, {
          kind: 'youtube#videoListResponse',
          etag: '"tbWC5XrSXxe1WOAx6MK9z4hHSU8/CQhw2t_NZKBaw72WEH7b1hSa6RA"',
          pageInfo: {
            totalResults: 1,
            resultsPerPage: 1
          },
          items: [
            {
              kind: 'youtube#video',
              etag: '"tbWC5XrSXxe1WOAx6MK9z4hHSU8/TScJmbzIomSQvSDFqAgTXGr7Y2U"',
              id: 'lgTQ5I_H4Xk',
              snippet: {
                publishedAt: '2013-05-09T20:54:56.000Z',
                channelId: 'UCzDbnWaP_5kd6HpvDUjoT4Q',
                title: 'How to prounounce "Apereo"',
                description:
                  'Here is Ian Dolphin, the Executive Director of the Apereo Foundation, with the official pronunciation of the word "Apereo".',
                thumbnails: {
                  default: {
                    url: 'https://i.ytimg.com/vi/lgTQ5I_H4Xk/default.jpg',
                    width: 120,
                    height: 90
                  },
                  medium: {
                    url: 'https://i.ytimg.com/vi/lgTQ5I_H4Xk/mqdefault.jpg',
                    width: 320,
                    height: 180
                  },
                  high: {
                    url: 'https://i.ytimg.com/vi/lgTQ5I_H4Xk/hqdefault.jpg',
                    width: 480,
                    height: 360
                  }
                },
                channelTitle: 'Apereo Foundation',
                categoryId: '28',
                liveBroadcastContent: 'none',
                localized: {
                  title: 'How to prounounce "Apereo"',
                  description:
                    'Here is Ian Dolphin, the Executive Director of the Apereo Foundation, with the official pronunciation of the word "Apereo".'
                }
              }
            }
          ]
        });
    };

    /**
     * Test that verifies the youtube processor and assures that metadata is retrieved/set.
     */
    it('verify youtube link processing works', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // Mock the request to the YouTube API
      _mockYoutube();

      // Assert a regular youtube link
      _createContentAndWait('link', 'http://www.youtube.com/watch?v=lgTQ5I_H4Xk', null, (restCtx, content) => {
        assert.strictEqual(content.previews.status, 'done');
        // Verify the displayName and description are set
        assert.strictEqual(content.displayName, 'How to prounounce "Apereo"');
        assert.strictEqual(
          content.description,
          'Here is Ian Dolphin, the Executive Director of the Apereo Foundation, with the official pronunciation of the word "Apereo".'
        );
        // Ensure we have a thumbnail url
        assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
        _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
          // Ensure we have small and medium images
          assert.ok(content.previews.smallUrl);
          _verifySignedUriDownload(restCtx, content.previews.smallUrl, () => {
            assert.ok(content.previews.mediumUrl);
            _verifySignedUriDownload(restCtx, content.previews.mediumUrl, () => {
              // Assert that short youtube links without a query string are processed
              // with the proper display name and description
              _createContentAndWait('link', 'http://youtu.be/lgTQ5I_H4Xk', null, (restCtx, content) => {
                assert.strictEqual(content.previews.status, 'done');
                assert.strictEqual(content.displayName, 'How to prounounce "Apereo"');
                assert.strictEqual(
                  content.description,
                  'Here is Ian Dolphin, the Executive Director of the Apereo Foundation, with the official pronunciation of the word "Apereo".'
                );

                // Ensure we have a thumbnail url
                assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);

                // Assert that short youtube links with a query string are processed
                // with the proper display name and escription
                _createContentAndWait('link', 'http://youtu.be/lgTQ5I_H4Xk?t=130', null, (restCtx, content) => {
                  assert.strictEqual(content.previews.status, 'done');
                  assert.strictEqual(content.displayName, 'How to prounounce "Apereo"');
                  assert.strictEqual(
                    content.description,
                    'Here is Ian Dolphin, the Executive Director of the Apereo Foundation, with the official pronunciation of the word "Apereo".'
                  );

                  // Ensure we have a thumbnail url
                  assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);

                  _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
                    // Ensure we have small and medium images
                    assert.ok(content.previews.smallUrl);
                    _verifySignedUriDownload(restCtx, content.previews.smallUrl, () => {
                      assert.ok(content.previews.mediumUrl);
                      _verifySignedUriDownload(restCtx, content.previews.mediumUrl, () => {
                        return callback();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    /**
     * Mock the SlideShare REST API if the tests are not run as part of an integration test
     *
     * @param  {Function}   serverStartedCallback                       The API is mocked and has been configured with the SlideShare preview processor
     * @param  {Function}   serverStartedCallback.closeServer           Call this function when the unit test is over and the mocked API can be closed
     * @param  {Function}   serverStartedCallback.closeServer.done      This function gets called when the server has been closed
     */
    const _mockSlideShareIfNecessary = function(serverStartedCallback) {
      // If we're running an integration test we don't have to mock the API and can return immediately
      if (TestsUtil.isIntegrationTest()) {
        serverStartedCallback(serverClosedCallback => {
          return serverClosedCallback();
        });
        return;
      }

      _mockSlideShare(false, false, serverStartedCallback);
    };

    /**
     * Mock the SlideShare REST API
     *
     * @param  {Boolean}    returnError                                 When true, the `get_slideshow` endpoint will return a `SlideShareServiceError` in the response
     * @param  {Boolean}    returnBadData                               When true, the `get_slideshow` endpoint will return malformed XML
     * @param  {Function}   serverStartedCallback                       The API is mocked and has been configured with the SlideShare preview processor
     * @param  {Function}   serverStartedCallback.closeServer           Call this function when the unit test is over and the mocked API can be closed
     * @param  {Function}   serverStartedCallback.closeServer.done      This function gets called when the server has been closed
     */
    const _mockSlideShare = function(returnError, returnBadData, serverStartedCallback) {
      TestsUtil.createTestServer((app, server, port) => {
        // Mock the `get_slideshow` REST endpoint
        app.get('/api/2/get_slideshow', (req, res) => {
          let xml = '';

          if (returnError) {
            xml += '<SlideShareServiceError>Something bad happened</SlideShareServiceError>';
          } else if (returnBadData) {
            xml += 'All your XML are belong to us';
          } else {
            xml += '<Slideshow>';
            xml += '    <Title>Apereo OAE - State of the project</Title>';
            xml +=
              '    <Description>The Apereo Open Academic Environment is a platform that focusses on group collaboration between researchers, students and lecturers, and strongly embraces openness, creation, re-use, re-mixing and discovery of content, people and groups. This session provides a summary of the revised goals and their motivation, as well as a full demo of the new implemented functionalities.</Description>';
            xml +=
              '    <ThumbnailURL>//cdn.slidesharecdn.com/ss_thumbnails/apereooae-stateoftheproject-130610122332-phpapp02-thumbnail.jpg?cb=1371114073</ThumbnailURL>';
            xml += '</Slideshow>';
          }

          return res.status(200).send(xml);
        });

        // Configure the SlideShare link processor's API url to our mocked API
        const apiUrl = util.format('http://localhost:%s/api/2/', port);
        PreviewSlideShare.setApiURL(apiUrl);

        // Pass control back so we can continue the unit test
        serverStartedCallback(serverClosedCallback => {
          // Close down our http server
          server.close(serverClosedCallback);
        });
      });
    };

    /**
     * Test that verifies that the SlideShare link processor can correctly retrieve metadata about SlideShare links
     */
    it('verify SlideShare link processing works', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // Mock the slideshare service if we're running integration tests
      _mockSlideShareIfNecessary(closeServer => {
        _createContentAndWait(
          'link',
          'http://www.slideshare.net/nicolaasmatthijs/apereo-oae-state-of-the-project?search_from=3',
          null,
          (restCtx, content) => {
            assert.strictEqual(content.previews.status, 'done');
            // Verify the displayName and description are set
            assert.strictEqual(content.displayName, 'Apereo OAE - State of the project');
            assert.strictEqual(
              content.description,
              'The Apereo Open Academic Environment is a platform that focusses on group collaboration between researchers, students and lecturers, and strongly embraces openness, creation, re-use, re-mixing and discovery of content, people and groups. This session provides a summary of the revised goals and their motivation, as well as a full demo of the new implemented functionalities.'
            );

            // Ensure we have a thumbnail url
            assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
            _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
              // Ensure we have small and medium images
              assert.ok(content.previews.smallUrl);
              _verifySignedUriDownload(restCtx, content.previews.smallUrl, () => {
                assert.ok(content.previews.mediumUrl);
                _verifySignedUriDownload(restCtx, content.previews.mediumUrl, () => {
                  return closeServer(callback);
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that the SlideShare link processor can handle API errors
     */
    it('verify SlideShare link processing can handle API errors', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _mockSlideShare(true, false, closeServer => {
        _createContentAndWait(
          'link',
          'http://www.slideshare.net/nicolaasmatthijs/apereo-oae-state-of-the-project?search_from=3',
          null,
          (restCtx, content) => {
            assert.strictEqual(content.previews.status, 'error');

            return closeServer(callback);
          }
        );
      });
    });

    /**
     * Test that verifies that the SlideShare link processor can handle the API returning bad/malformed data
     */
    it('verify SlideShare link processing can handle bad data', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _mockSlideShare(false, true, closeServer => {
        _createContentAndWait(
          'link',
          'http://www.slideshare.net/nicolaasmatthijs/apereo-oae-state-of-the-project?search_from=3',
          null,
          (restCtx, content) => {
            assert.strictEqual(content.previews.status, 'ignored');

            return closeServer(callback);
          }
        );
      });
    });

    /**
     * Mock the Flickr REST API if the tests are not run as part of an integration test
     *
     * @param  {Function}   serverStartedCallback                               The API is mocked and has been configured with the Flickr preview processor
     * @param  {Object}     serverStartedCallback.expectedResponses             Allows you to configure how the mocked server should respond on the photo or photoset REST endpont
     * @param  {String}     serverStartedCallback.expectedResponses.photo       Determines what to send back for the photo rest endpoint. One of `error`, `bad_status_code`, `bad_json`, `no_photo_object` or `ok`
     * @param  {String}     serverStartedCallback.expectedResponses.photoset    Determines what to send back for the photoset rest endpoint. One of `error`, `bad_status_code`, `bad_json`, `no_photoset_object` or `ok`
     * @param  {Function}   serverStartedCallback.closeServer                   Call this function when the unit test is over and the mocked API can be closed
     * @param  {Function}   serverStartedCallback.closeServer.done              This function gets called when the server has been closed
     */
    const _mockFlickrIfNecessary = function(serverStartedCallback) {
      // If we're running an integration test we don't have to mock the API and can return immediately
      if (TestsUtil.isIntegrationTest()) {
        serverStartedCallback({}, serverClosedCallback => {
          return serverClosedCallback();
        });
        return;
      }

      _mockFlickr(serverStartedCallback);
    };

    /**
     * Mock the Flickr REST API
     *
     * @param  {Function}   serverStartedCallback                               The API is mocked and has been configured with the Flickr preview processor
     * @param  {Object}     serverStartedCallback.expectedResponses             Allows you to configure how the mocked server should respond on the photo or photoset REST endpont
     * @param  {String}     serverStartedCallback.expectedResponses.photo       Determines what to send back for the photo rest endpoint. One of `error`, `bad_status_code`, `bad_json`, `no_photo_object` or `ok`
     * @param  {String}     serverStartedCallback.expectedResponses.photoset    Determines what to send back for the photoset rest endpoint. One of `error`, `bad_status_code`, `bad_json`, `no_photoset_object` or `ok`
     * @param  {Function}   serverStartedCallback.closeServer                   Call this function when the unit test is over and the mocked API can be closed
     * @param  {Function}   serverStartedCallback.closeServer.done              This function gets called when the server has been closed
     */
    const _mockFlickr = function(serverStartedCallback) {
      TestsUtil.createTestServer((app, server, port) => {
        // Can be modified by the `serverStartedCallback`
        const expectedResponses = {
          photo: 'ok',
          photoset: 'ok',
          image: 'ok'
        };

        app.get('/image', (req, res) => {
          if (expectedResponses.image.error) {
            res.connection.destroy();
          } else {
            res.sendFile(path.join(__dirname, '/data/image.png'));
          }
        });

        // Mock the `get_slideshow` REST endpoint
        app.get('/services/rest/', (req, res) => {
          // Regardless of the method, an api_key needs to be present
          assert.ok(req.query.api_key);

          // We only deal with json
          assert.strictEqual(req.query.format, 'json');

          if (req.query.method === 'flickr.photos.getInfo') {
            // A photo_id needs to be present
            assert.ok(req.query.photo_id);

            if (expectedResponses.photo === 'error') {
              res.connection.destroy();
            } else if (expectedResponses.photo === 'bad_status_code') {
              res.sendStatus(404);
            } else if (expectedResponses.photo === 'bad_json') {
              res.send('This is not JSON');
            } else if (expectedResponses.photo === 'no_photo_object') {
              res.send({ foo: 'bar' });
            } else {
              res.send({
                photo: {
                  id: '8949876197',
                  server: '3736',
                  secret: '42',
                  farm: 4,
                  dateuploaded: '1370367237',
                  isfavorite: 0,
                  license: '2',
                  safety_level: '0',
                  rotation: 0,
                  originalsecret: '367286f7ab',
                  originalformat: 'jpg',
                  owner: {},
                  title: { _content: 'Apereo Sakai/Jasig Fellows' },
                  description: { _content: '' }
                }
              });
            }
          } else if (req.query.method === 'flickr.photosets.getInfo') {
            // A photo_id needs to be present
            assert.ok(req.query.photoset_id);

            if (expectedResponses.photoset === 'error') {
              res.connection.destroy();
            } else if (expectedResponses.photoset === 'bad_status_code') {
              res.sendStatus(404);
            } else if (expectedResponses.photoset === 'bad_json') {
              res.send('This is not JSON');
            } else if (expectedResponses.photoset === 'no_photoset_object') {
              res.send({ foo: 'bar' });
            } else {
              res.send({
                photoset: {
                  id: '72057594140880342',
                  primary: '150332756',
                  secret: 'a96f53dc7e',
                  server: '47',
                  farm: 1,
                  photos: 5,
                  count_views: '118',
                  count_comments: '0',
                  count_photos: '5',
                  count_videos: 0,
                  title: { _content: 'JA-SIG Denver 03' },
                  description: { _content: '' },
                  can_comment: 0,
                  date_create: '1148217744',
                  date_update: '1356369692',
                  coverphoto_server: '0',
                  coverphoto_farm: 0
                }
              });
            }
          }
        });

        // Configure the Flickr link processor's API url to our mocked API
        const apiUrl = util.format('http://localhost:%s/services/rest/', port);
        let imageUrl = util.format('http://localhost:%s/image', port);
        imageUrl += '?farm=%s&server=%s&id=%s&secret=%s';
        PreviewFlickr.setApiUrl(apiUrl);
        PreviewFlickr.setImageUrl(imageUrl);

        // Pass control back so we can continue the unit test
        serverStartedCallback(expectedResponses, serverClosedCallback => {
          // Close down our http server
          server.close(serverClosedCallback);
        });
      });
    };

    /**
     * Test that verifies the flickr photo processor and assures that metadata is retrieved/set.
     */
    it('verify flickr photo link processing works', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _mockFlickrIfNecessary((expectedResponses, closeServer) => {
        _createContentAndWait(
          'link',
          'http://www.flickr.com/photos/johnalewis/8949876197',
          null,
          (restCtx, content) => {
            assert.strictEqual(content.previews.status, 'done');
            // Verify the displayName and description are set
            assert.strictEqual(content.displayName, 'Apereo Sakai/Jasig Fellows');
            assert.strictEqual(content.description, '');
            // Ensure we have a thumbnail url
            assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
            _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
              // Ensure we have small and medium images
              assert.ok(content.previews.smallUrl);
              _verifySignedUriDownload(restCtx, content.previews.smallUrl, () => {
                assert.ok(content.previews.mediumUrl);
                _verifySignedUriDownload(restCtx, content.previews.mediumUrl, () => {
                  // Verify short URLs can be processed
                  _createContentAndWait('link', 'https://flic.kr/p/eCSsoi', null, (restCtx, content) => {
                    assert.strictEqual(content.previews.status, 'done');
                    // Verify the displayName and description are set
                    assert.strictEqual(content.displayName, 'Apereo Sakai/Jasig Fellows');
                    assert.strictEqual(content.description, '');
                    // Ensure we have a thumbnail url
                    assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
                    _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
                      // Ensure we have small and medium images
                      assert.ok(content.previews.smallUrl);
                      _verifySignedUriDownload(restCtx, content.previews.smallUrl, () => {
                        assert.ok(content.previews.mediumUrl);
                        _verifySignedUriDownload(restCtx, content.previews.mediumUrl, () => {
                          return closeServer(callback);
                        });
                      });
                    });
                  });
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies the flickr set processor and assures that metadata is retrieved/set.
     */
    it('verify flickr set link processing works', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _mockFlickrIfNecessary((expectedResponses, closeServer) => {
        _createContentAndWait(
          'link',
          'https://www.flickr.com/photos/143977767@N03/sets/72157687786698466',
          null,
          (restCtx, content) => {
            assert.strictEqual(content.previews.status, 'done');
            // Verify the displayName and description are set
            assert.strictEqual(content.displayName, 'This is an album for testing');
            assert.strictEqual(content.description, '');
            // Ensure we have a thumbnail url
            assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
            _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
              // Ensure we have small and medium images
              assert.ok(content.previews.smallUrl);
              _verifySignedUriDownload(restCtx, content.previews.smallUrl, () => {
                assert.ok(content.previews.mediumUrl);
                _verifySignedUriDownload(restCtx, content.previews.mediumUrl, () => {
                  return closeServer(callback);
                });
              });
            });
          }
        );
      });
    });

    it('verify flickr link processing can handle API errors', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _mockFlickr((expectedResponses, closeServer) => {
        // Error on photo
        expectedResponses.photo = 'error';
        _createContentAndWait(
          'link',
          'https://www.flickr.com/photos/143977767@N03/36708444695',
          null,
          (restCtx, content) => {
            assert.strictEqual(content.previews.status, 'error');
            expectedResponses.photo = 'bad_status_code';
            _createContentAndWait(
              'link',
              'https://www.flickr.com/photos/143977767@N03/36708444695',
              null,
              (restCtx, content) => {
                assert.strictEqual(content.previews.status, 'error');
                expectedResponses.photo = 'bad_json';
                _createContentAndWait(
                  'link',
                  'https://www.flickr.com/photos/143977767@N03/36708444695',
                  null,
                  (restCtx, content) => {
                    assert.strictEqual(content.previews.status, 'error');
                    expectedResponses.photo = 'no_photo_object';
                    _createContentAndWait(
                      'link',
                      'https://www.flickr.com/photos/143977767@N03/36708444695',
                      null,
                      (restCtx, content) => {
                        assert.strictEqual(content.previews.status, 'ignored');

                        // Error on photo sets
                        expectedResponses.photoset = 'error';
                        _createContentAndWait(
                          'link',
                          'https://www.flickr.com/photos/143977767@N03/sets/72157687786698466',
                          null,
                          (restCtx, content) => {
                            assert.strictEqual(content.previews.status, 'error');
                            expectedResponses.photoset = 'bad_status_code';
                            _createContentAndWait(
                              'link',
                              'https://www.flickr.com/photos/143977767@N03/sets/72157687786698466',
                              null,
                              (restCtx, content) => {
                                assert.strictEqual(content.previews.status, 'error');
                                expectedResponses.photoset = 'bad_json';
                                _createContentAndWait(
                                  'link',
                                  'https://www.flickr.com/photos/143977767@N03/sets/72157687786698466',
                                  null,
                                  (restCtx, content) => {
                                    assert.strictEqual(content.previews.status, 'error');
                                    expectedResponses.photoset = 'no_photoset_object';
                                    _createContentAndWait(
                                      'link',
                                      'https://www.flickr.com/photos/143977767@N03/sets/72157687786698466',
                                      null,
                                      (restCtx, content) => {
                                        assert.strictEqual(content.previews.status, 'ignored');

                                        // Sanity checks
                                        expectedResponses.photo = 'ok';
                                        expectedResponses.photoset = 'ok';
                                        _createContentAndWait(
                                          'link',
                                          'https://www.flickr.com/photos/143977767@N03/36708444695',
                                          null,
                                          (restCtx, content) => {
                                            assert.strictEqual(content.previews.status, 'done');
                                            _createContentAndWait(
                                              'link',
                                              'https://www.flickr.com/photos/143977767@N03/sets/72157687786698466',
                                              null,
                                              (restCtx, content) => {
                                                assert.strictEqual(content.previews.status, 'done');

                                                return closeServer(callback);
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

    /**
     * Test that verifies the vimeo processor and assures that metadata is retrieved/set.
     */
    it('verify vimeo link processing works', callback => {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _createContentAndWait('link', 'https://vimeo.com/187081215', null, (restCtx, content) => {
        assert.strictEqual(content.previews.status, 'done');
        // Verify the displayName and description are set.
        assert.strictEqual(content.displayName, 'Frasonismo');
        assert.strictEqual(
          content.description,
          'Referência a "frasonismo" no "the big picture" da RTP1 a 12 de Outubro de 2016'
        );
        // Ensure we have a thumbnail url.
        assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
        _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
          // Ensure we have small and medium images.
          assert.ok(content.previews.smallUrl);
          _verifySignedUriDownload(restCtx, content.previews.smallUrl, () => {
            assert.ok(content.previews.mediumUrl);
            _verifySignedUriDownload(restCtx, content.previews.mediumUrl, () => {
              callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies the collaborative document processor works.
     */
    it('verify collaborative document processing works', callback => {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _createContentAndWait('collabdoc', null, null, (restCtx, content) => {
        setTimeout(() => {
          assert.strictEqual(content.previews.status, 'done');
          // Ensure we have a thumbnail url.
          assert.strictEqual(content.previews.thumbnailUrl.indexOf('/api/download/signed'), 0);
          _verifySignedUriDownload(restCtx, content.previews.thumbnailUrl, () => {
            callback();
          });
        }, 2000);
      });
    });

    /**
     * Test that verifies the collaborative document processor works.
     */
    it('verify unpublished collaborative documents are ignored', callback => {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      TestsUtil.generateTestUsers(signedAdminRestContext, 1, (err, response) => {
        assert.notExists(err);
        const restCtx = compose(prop('restContext'), head, values)(response);

        RestAPI.Content.createCollabDoc(
          restCtx,
          'Test document',
          'Test document',
          'private',
          [],
          [],
          [],
          [],
          (err, contentObj) => {
            assert.notExists(err);

            // Wait till it has been processed.
            MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
              // Ensure the preview items are there.
              RestAPI.Content.getContent(restCtx, contentObj.id, (err, updatedContent) => {
                assert.notExists(err);
                assert.strictEqual(updatedContent.previews.status, 'ignored');
                assert.ok(!updatedContent.previews.thumbnailUrl);
                callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that the preview status of a piece of content is set to ignored if no PP can handle it.
     */
    it('verify zip files get ignored', callback => {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      _createContentAndWait('file', null, getZipStream, (restCtx, content) => {
        assert.strictEqual(content.previews.status, 'ignored');
        assert.ok(!content.previews.thumbnailUrl);
        callback();
      });
    });

    /**
     * Test that verifies that the PP looks at the mime type of the revision rather than looking at the mime type that sits
     * on the content object. This is an important distinction as `content.mime` points to the mimetype of the *latest*
     * revision, which is not necessarily the revision the PP might be processing.
     */
    it('verify content with multiple revisions of different mime types', callback => {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // Disable the PP first, so we can generate 2 revisions without the PP starting at the first one
      PreviewAPI.disable(err => {
        assert.notExists(err);

        // Create a piece of content with 2 separate mime types
        MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
          TestsUtil.generateTestUsers(signedAdminRestContext, 1, (err, response) => {
            assert.notExists(err);
            const restCtx = compose(prop('restContext'), head, values)(response);

            // Create the initial revision as a zip file. ZIP is used as this gets ignored by the
            // PP so the unit test can end within the test timeout time.
            RestAPI.Content.createFile(
              restCtx,
              {
                displayName: 'Test Content 1',
                description: 'Test content description 1',
                PRIVATE,
                file: getZipStream,
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (err, contentObj) => {
                assert.notExists(err);

                // Create the second revision as an image file.
                RestAPI.Content.updateFileBody(restCtx, contentObj.id, getImageStream, (err, updatedContentObj) => {
                  assert.notExists(err);

                  // Purge the pending previews from the queue
                  PreviewTestUtil.purgePreviewsQueue(err => {
                    assert.notExists(err);

                    // Enable previews so we can handle the reprocessing
                    PreviewAPI.enable(err => {
                      assert.notExists(err);

                      // Re-process the revisions
                      RestAPI.Previews.reprocessPreview(
                        signedAdminRestContext,
                        contentObj.id,
                        contentObj.latestRevisionId,
                        err => {
                          assert.notExists(err);
                          setTimeout(() => {
                            RestAPI.Previews.reprocessPreview(
                              signedAdminRestContext,
                              contentObj.id,
                              updatedContentObj.latestRevisionId,
                              err => {
                                assert.notExists(err);
                                MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
                                  // The revisions should have been processed, fetch their metadata.
                                  RestAPI.Content.getRevision(
                                    restCtx,
                                    contentObj.id,
                                    contentObj.latestRevisionId,
                                    (err, revision) => {
                                      assert.notExists(err);
                                      assert.strictEqual(revision.previews.status, 'ignored');

                                      RestAPI.Content.getRevision(
                                        restCtx,
                                        contentObj.id,
                                        updatedContentObj.latestRevisionId,
                                        (err, revision) => {
                                          assert.notExists(err);
                                          assert.strictEqual(revision.previews.status, 'done');
                                          callback();
                                        }
                                      );
                                    }
                                  );
                                });
                              }
                            );
                          }, 2000);
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

    /**
     * Test that verifies that previews for folders can be generated
     */
    it('verify folder processing', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        assert.notExists(err);

        const { 0: simong } = users;

        // Create a folder to test with
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [],
          [],
          folder => {
            // Upload an image and add it to the folder
            _createContentAndAddToFolder(simong.restContext, folder, (content1, folder) => {
              assert.ok(folder.previews);
              assert.ok(folder.previews.thumbnailUrl);
              assert.ok(folder.previews.wideUrl);
              // Assert the previews can be downloaded
              _verifySignedUriDownload(simong.restContext, folder.previews.thumbnailUrl, thumbnail1 => {
                _verifySignedUriDownload(simong.restContext, folder.previews.thumbnailUrl, wide1 => {
                  // Upload another image
                  _createContentAndAddToFolder(simong.restContext, folder, (content2, folder) => {
                    assert.ok(folder.previews);
                    assert.ok(folder.previews.thumbnailUrl);
                    assert.ok(folder.previews.wideUrl);

                    // Assert the new previews can be downloaded
                    _verifySignedUriDownload(simong.restContext, folder.previews.thumbnailUrl, thumbnail2 => {
                      _verifySignedUriDownload(simong.restContext, folder.previews.thumbnailUrl, wide2 => {
                        // Assert these preview images are different
                        assert.notStrictEqual(thumbnail1, thumbnail2);
                        assert.notStrictEqual(wide1, wide2);

                        // When a file is removed the preview images should be different
                        FoldersTestUtil.assertRemoveContentItemsFromFolderSucceeds(
                          simong.restContext,
                          folder.id,
                          [content2.id],
                          () => {
                            // Wait until the folder is processed
                            FoldersPreviews.whenPreviewsComplete(() => {
                              FoldersTestUtil.assertGetFolderSucceeds(simong.restContext, folder.id, folder => {
                                assert.ok(folder.previews);
                                assert.ok(folder.previews.thumbnailUrl);
                                assert.ok(folder.previews.wideUrl);

                                // Assert the previews can be downloaded
                                _verifySignedUriDownload(
                                  simong.restContext,
                                  folder.previews.thumbnailUrl,
                                  (/* thumbnail3 */) => {
                                    _verifySignedUriDownload(
                                      simong.restContext,
                                      folder.previews.thumbnailUrl,
                                      (/* wide3 */) => {
                                        // Assert these preview images are different
                                        assert.notStrictEqual(thumbnail1, thumbnail2);
                                        assert.notStrictEqual(wide1, wide2);

                                        // When all files are removed, the folder should have no preview images
                                        FoldersTestUtil.assertRemoveContentItemsFromFolderSucceeds(
                                          simong.restContext,
                                          folder.id,
                                          [content1.id],
                                          () => {
                                            // Wait until the folder is processed
                                            FoldersPreviews.whenPreviewsComplete(() => {
                                              FoldersTestUtil.assertGetFolderSucceeds(
                                                simong.restContext,
                                                folder.id,
                                                folder => {
                                                  assert.ok(folder.previews);
                                                  assert.ok(!folder.previews.thumbnailUrl);
                                                  assert.ok(!folder.previews.wideUrl);

                                                  return callback();
                                                }
                                              );
                                            });
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
                      });
                    });
                  });
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that folders are reprocessed when their visibility changes
     */
    it('verify folders are reprocessed when their visibility changes', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // Upload a public image
      _createContentAndWait('file', null, getImageStream, (restCtxPublic, publicContent) => {
        // Upload another image and make it private
        _createContentAndWait('file', null, getImageStream, (restCtxPrivate, privateContent) => {
          RestAPI.Content.updateContent(restCtxPrivate, privateContent.id, { visibility: 'private' }, err => {
            assert.notExists(err);

            // Create a folder to test with
            FoldersTestUtil.assertCreateFolderSucceeds(
              restCtxPrivate,
              'test displayName',
              'test description',
              'private',
              [],
              [],
              folder => {
                // Add the content items. Do NOT use the FoldersTestUtil method as that purges
                // the folder content library, which could cause intermittent test failures
                RestAPI.Folders.addContentItemsToFolder(
                  restCtxPrivate,
                  folder.id,
                  [publicContent.id, privateContent.id],
                  err => {
                    assert.notExists(err);

                    // Wait until the folder has been processed
                    FoldersPreviews.whenPreviewsComplete(() => {
                      // At this point, the folder should use both content items their thumbnails
                      FoldersTestUtil.assertGetFolderSucceeds(restCtxPrivate, folder.id, folder => {
                        assert.ok(folder.previews);
                        assert.ok(folder.previews.thumbnailUrl);
                        assert.ok(folder.previews.wideUrl);

                        // Make the folder public
                        RestAPI.Folders.updateFolder(restCtxPrivate, folder.id, { visibility: 'public' }, err => {
                          assert.notExists(err);

                          // Wait until the folder has been reprocessed
                          FoldersPreviews.whenPreviewsComplete(() => {
                            // Get the updated folder metadata
                            FoldersTestUtil.assertGetFolderSucceeds(restCtxPrivate, folder.id, updatedFolder => {
                              /**
                               * Because the folder has been made public, the private content item's thumbnail cannot be used.
                               * This should cause the thumbnail url to be different
                               */
                              assert.ok(updatedFolder.previews);
                              assert.notStrictEqual(folder.previews.thumbnailUrl, updatedFolder.previews.thumbnailUrl);
                              assert.notStrictEqual(folder.previews.wideUrl, updatedFolder.previews.wideUrl);

                              return callback();
                            });
                          });
                        });
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

    /**
     * Test that verifies that folders are reprocessed when the visibility of one of its content items changes
     */
    it('verify folders are reprocessed when the visibility of one of its content items changes', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        assert.notExists(err);

        const { 0: simong } = users;

        // Create a folder to test with
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [],
          [],
          folder => {
            // Upload an image and add it to the folder
            _createContentAndAddToFolder(simong.restContext, folder, (content, folder, contentCreatorRestContext) => {
              assert.ok(folder.previews);
              assert.ok(folder.previews.thumbnailUrl);
              assert.ok(folder.previews.wideUrl);

              // Make the content item private
              RestAPI.Content.updateContent(contentCreatorRestContext, content.id, { visibility: 'private' }, err => {
                assert.notExists(err);

                // Wait until the folder has been processed
                FoldersPreviews.whenPreviewsComplete(() => {
                  // Get the updated folder metadata
                  FoldersTestUtil.assertGetFolderSucceeds(simong.restContext, folder.id, folder => {
                    assert.ok(folder.previews);

                    // Because the content item has been made private, we cannot use it for the folder's preview images
                    assert.ok(!folder.previews.thumbnailUrl);
                    assert.ok(!folder.previews.wideUrl);
                    return callback();
                  });
                });
              });
            });
          }
        );
      });
    });
  });

  describe('Preview Reprocessing', () => {
    /*!
     * Sets up the environment to quickly reprocess content by trashing all the content in the system and purging the previews queue.
     * It will also set up a user who creates two pieces of content (one file and one link) to allow for easy testing
     *
     * @param  {Boolean}    enableProcessor     Whether or not the processor should be enabled before handing control over to the callback
     * @param  {User}       callback.user       The user who created a piece of content
     * @param  {Content}    callback.file       The created file
     * @param  {Content}    callback.link       The created link
     */
    const _setupForReprocessing = function(enableProcessor, callback) {
      // Disable preview processing so we don't immediately process our piece of content
      PreviewAPI.disable(err => {
        assert.notExists(err);

        // Purge all task queues
        MQ.purgeAllBoundQueues(err => {
          assert.notExists(err);

          // Make sure all tasks are done
          MQTestUtil.whenTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS_PROCESSING, () => {
            MQTestUtil.whenTasksEmpty(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS_PROCESSING, () => {
              MQTestUtil.whenTasksEmpty(SearchConstants.mq.TASK_INDEX_DOCUMENT_PROCESSING, () => {
                MQTestUtil.whenTasksEmpty(ActivityConstants.mq.TASK_ACTIVITY_PROCESSING, () => {
                  // Trash all the content items
                  Cassandra.runQuery('TRUNCATE "Content"', [], err => {
                    assert.notExists(err);

                    // Create a piece of content that we can reprocess
                    TestsUtil.generateTestUsers(signedAdminRestContext, 1, (err, users) => {
                      assert.notExists(err);

                      const { 0: user } = users;

                      RestAPI.Content.createFile(
                        user.restContext,
                        {
                          displayName: 'Test Content',
                          description: 'Test content description',
                          PUBLIC,
                          file: getImageStream,
                          managers: NO_MANAGERS,
                          viewers: NO_VIEWERS,
                          folders: NO_FOLDERS
                        },
                        (err, content) => {
                          assert.notExists(err);

                          // Create a link, we'll use it as a sanity check to ensure only file types got reprocessed
                          RestAPI.Content.createLink(
                            user.restContext,
                            {
                              displayName: 'Google',
                              description: 'Google',
                              PUBLIC,
                              link: 'http://www.google.com',
                              managers: NO_MANAGERS,
                              viewers: NO_VIEWERS,
                              folders: NO_FOLDERS
                            },
                            (err, link) => {
                              assert.notExists(err);

                              // Purge everything with a delay to ensure the 2 files have been submit for processing
                              setTimeout(PreviewTestUtil.purgePreviewsQueue, 1000, err => {
                                assert.notExists(err);

                                // Enable the preview processor if so desired
                                if (enableProcessor) {
                                  PreviewAPI.enable(err => {
                                    assert.notExists(err);
                                    return callback(user, content, link);
                                  });
                                } else {
                                  return callback(user, content, link);
                                }
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
          });
        });
      });
    };

    /*!
     * Utility function to bind a listener to the preview reprocessing queue and let a
     * consumer handle the data of the resulting message.
     *
     * @param  {RestContext}    restCtx         The rest context with which to invoke the reprocess request. Should be bound to the global admin interface.
     * @param  {Object}         [filters]       The filter parameter of the reprocessing request
     * @param  {Function}       handler         The handler to handle the MQ data
     * @param  {Object}         handler.data    The arbitrary MQ data
     * @param  {Function}       [callback]      Invoked after the reprocessing rest request has been executed
     * @param  {Object}         [callback.err]  An error that occurred invokeing the reprocess previews rest request, if any
     */
    const _reprocessWithHandler = function(restCtx, filters, handler, callback) {
      callback =
        callback ||
        function(err) {
          assert.notExists(err);
        };

      /*!
       * A convenience handler that takes care of invoking the MQ callback to let it acknowledge
       * the request.
       *
       * @param  {Object}     data            The MQ data for the message
       * @param  {Function}   mqCallback      The function to invoke to acknowledge handling the message
       */
      const _handler = function(data, mqCallback) {
        mqCallback();
        return handler(data);
      };

      // Unbind and rebind a process-all handler
      MQ.unsubscribe(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, err => {
        assert.notExists(err);

        MQ.subscribe(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, _handler, err => {
          assert.notExists(err);

          RestAPI.Previews.reprocessPreviews(restCtx, filters, callback);
        });
      });
    };

    /**
     * Verify that a single content item and revision can be reprocessed
     */
    it('verify reprocess previews validation and authorization', callback => {
      // This can run, even if previews are disabled

      // Verify anonymous, regular users and tenant admins from other tenants cannot reprocess previews
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        assert.notExists(err);
        const { 0: user } = values(users);
        RestAPI.Previews.reprocessPreview(
          user.restContext,
          'c:camtest:someContent',
          'rev:camtest:someRevision',
          err => {
            assert.ok(err);
            assert.strictEqual(err.code, 401);

            RestAPI.Previews.reprocessPreview(
              anonymousRestContext,
              'c:camtest:someContent',
              'rev:camtest:someRevision',
              err => {
                assert.ok(err);
                assert.strictEqual(err.code, 401);

                RestAPI.Previews.reprocessPreview(
                  camAdminRestContext,
                  'c:other:someContent',
                  'rev:other:someRevision',
                  err => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 401);

                    // Verify validation of content and revision ids
                    RestAPI.Previews.reprocessPreview(
                      camAdminRestContext,
                      'notAContentId',
                      'rev:camtest:someRevision',
                      err => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 400);

                        RestAPI.Previews.reprocessPreview(
                          camAdminRestContext,
                          'c:camtest:someContent',
                          'notARevisionId',
                          err => {
                            assert.ok(err);
                            assert.strictEqual(err.code, 400);

                            // Sanity check the validation and authorization
                            RestAPI.Previews.reprocessPreview(
                              camAdminRestContext,
                              'c:camtest:someContent',
                              'rev:camtest:someRevision',
                              err => {
                                assert.notExists(err);
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

    /**
     * Verify forcing a reprocessing of a preview results in the preview being reprocessed
     */
    it('verify reprocessing a preview processes the revision preview', callback => {
      // Ignore this test if the PP is disabled.
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // Set ourselves up for quick reprocessing
      _setupForReprocessing(true, (user, content) => {
        // Force the previews to generate
        RestAPI.Previews.reprocessPreview(signedAdminRestContext, content.id, content.latestRevisionId, err => {
          assert.notExists(err);

          // Wait for the preview to finish generating
          MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
            RestAPI.Content.getContent(user.restContext, content.id, (err, content) => {
              assert.notExists(err);

              assert.ok(content.previews);
              assert.strictEqual(content.previews.status, 'done');
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies when previews are reprocessed through the REST endpoint, a task is triggered.
     */
    it('verify reprocessing previews triggers an mq task', callback => {
      // this timeout allows us to wait for disconnection to come into effect before subscribe again
      const TIMEOUT = 500;
      // Verify sending a single filter with a single value
      let filters = { content_previewsStatus: 'error' };
      _reprocessWithHandler(globalAdminRestContext, filters, data => {
        assert.ok(data);
        assert.ok(data.filters);
        assert.ok(data.filters.content);
        assert.strictEqual(data.filters.content.previewsStatus, 'error');

        // Verify sending a single filter with multiple values
        filters = { content_previewsStatus: ['error', 'done', 'pending'] };
        setTimeout(_reprocessWithHandler, TIMEOUT, globalAdminRestContext, filters, data => {
          assert.ok(data);
          assert.ok(data.filters);
          assert.ok(data.filters.content);
          assert.ok(data.filters.content.previewsStatus.length, 3);
          assert.strictEqual(data.filters.content.previewsStatus[0], 'error');
          assert.strictEqual(data.filters.content.previewsStatus[1], 'done');
          assert.strictEqual(data.filters.content.previewsStatus[2], 'pending');

          // Verify sending multiple filters
          filters = {
            content_previewsStatus: ['error', 'done', 'pending'],
            content_resourceSubType: ['file', 'link']
          };
          setTimeout(_reprocessWithHandler, TIMEOUT, globalAdminRestContext, filters, data => {
            assert.ok(data);
            assert.ok(data.filters);
            assert.ok(data.filters.content);
            assert.ok(data.filters.content.previewsStatus.length, 3);
            assert.strictEqual(data.filters.content.previewsStatus[0], 'error');
            assert.strictEqual(data.filters.content.previewsStatus[1], 'done');
            assert.strictEqual(data.filters.content.previewsStatus[2], 'pending');
            assert.ok(data.filters.content.resourceSubType.length, 2);
            assert.strictEqual(data.filters.content.resourceSubType[0], 'file');
            assert.strictEqual(data.filters.content.resourceSubType[1], 'link');

            // Verify sending mixed multiple filters
            filters = {
              content_previewsStatus: ['error', 'done', 'pending'],
              content_resourceSubType: ['file', 'link'],
              revision_mime: ['application/pdf', 'application/msword']
            };
            setTimeout(_reprocessWithHandler, TIMEOUT, globalAdminRestContext, filters, data => {
              assert.ok(data);
              assert.ok(data.filters);
              assert.ok(data.filters.content);
              assert.ok(data.filters.content.previewsStatus.length, 3);
              assert.strictEqual(data.filters.content.previewsStatus[0], 'error');
              assert.strictEqual(data.filters.content.previewsStatus[1], 'done');
              assert.strictEqual(data.filters.content.previewsStatus[2], 'pending');
              assert.ok(data.filters.content.resourceSubType.length, 2);
              assert.strictEqual(data.filters.content.resourceSubType[0], 'file');
              assert.strictEqual(data.filters.content.resourceSubType[1], 'link');
              assert.ok(data.filters.revision.mime.length, 2);
              assert.strictEqual(data.filters.revision.mime[0], 'application/pdf');
              assert.strictEqual(data.filters.revision.mime[1], 'application/msword');
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies only global admin users can reprocess previews
     */
    it('verify non-global admin users cannot reprocess previews', callback => {
      /*!
       * Task handler that will fail the test if invoked.
       *
       * @see MQ#bind
       */
      const _handleTaskFail = function(/* data */) {
        assert.fail('Did not expect the task to be invoked.');
      };

      // Generate a normal user with which to try and reprocess previews
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        assert.notExists(err);

        const userRestCtx = users[head(keys(users))].restContext;

        // Verify that an anonymous user-tenant user cannot reprocess previews
        _reprocessWithHandler(anonymousRestContext, null, _handleTaskFail, err => {
          assert.ok(err);

          // Verify that an anonymous global-tenant user cannot reprocess previews
          RestAPI.Previews.reprocessPreviews(
            TestsUtil.createGlobalRestContext(),
            { content_resourceSubType: 'file' },
            err => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);

              // Verify that a regular user cannot generate a task
              RestAPI.Previews.reprocessPreviews(userRestCtx, null, err => {
                assert.ok(err);

                // Verify that a tenant admin cannot generate a task
                RestAPI.Previews.reprocessPreviews(camAdminRestContext, null, err => {
                  assert.ok(err);

                  // Unbind our handler, so we don't trip over the next test
                  MQ.unsubscribe(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, err => {
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

    /**
     * Test that verifies the filters are validated for correctness
     */
    it('verify parameter validation for reprocessing previews requests', callback => {
      /*!
       * Task handler that will fail the test if invoked.
       *
       * @see MQ#bind
       */
      const _handleTaskFail = (/* data */) => {
        assert.fail('Did not expect the task to be invoked.');
      };

      // Providing no filters must be an oversight and is invalid
      _reprocessWithHandler(globalAdminRestContext, null, _handleTaskFail, err => {
        assert.strictEqual(err.code, 400);

        // Providing unknown filters is totally unacceptable
        RestAPI.Previews.reprocessPreviews(globalAdminRestContext, { foo: 'bar' }, err => {
          assert.strictEqual(err.code, 400);
          RestAPI.Previews.reprocessPreviews(globalAdminRestContext, { content_foo: 'bar' }, err => {
            assert.strictEqual(err.code, 400);
            RestAPI.Previews.reprocessPreviews(globalAdminRestContext, { revision_foo: 'bar' }, err => {
              assert.strictEqual(err.code, 400);

              // Unbind our handler, so we don't trip over the next test
              MQ.unsubscribe(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, err => {
                assert.notExists(err);
                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that all content is reprocessed
     */
    it('verify validation of reprocessing previews tasks', callback => {
      // Purge everything
      PreviewTestUtil.purgePreviewsQueue(err => {
        assert.notExists(err);
        // Enable previews so we can handle the reprocessing
        PreviewAPI.enable(err => {
          assert.notExists(err);

          // Unbind the PP first, so we can listen for incoming generate previews task
          MQ.unsubscribe(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, err => {
            assert.notExists(err);

            // It's possible the PP started processing on old item, wait till it's done so it doesn't mess up this test
            MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
              // Bind our own listener that will keep track of content that needs reprocessing (it should always be empty)
              const contentToBeReprocessed = [];
              const reprocessTracker = function(data, callback) {
                contentToBeReprocessed.push(data);
                callback();
              };

              MQ.subscribe(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, reprocessTracker, err => {
                assert.notExists(err);

                // Missing filters is invalid
                MQ.submit(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, JSON.stringify({}), () => {
                  MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, () => {
                    MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
                      assert.strictEqual(contentToBeReprocessed.length, 0);

                      // Unknown content filter is invalid
                      MQ.submit(
                        PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS,
                        JSON.stringify({ filters: { content: { foo: 'bar' } } }),
                        () => {
                          MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, () => {
                            MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
                              assert.strictEqual(contentToBeReprocessed.length, 0);

                              // Unknown revision filter is invalid
                              MQ.submit(
                                PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS,
                                JSON.stringify({ filters: { revision: { foo: 'bar' } } }),
                                () => {
                                  MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, () => {
                                    MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
                                      assert.strictEqual(contentToBeReprocessed.length, 0);
                                      return callback();
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
            });
          });
        });
      });
    });

    /**
     * Test that verifies that a push notification is sent out on preview generation completion
     */
    it('verify a push notification is sent out on preview generation completion', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      PreviewTestUtil.purgePreviewsQueue(err => {
        assert.notExists(err);

        TestsUtil.generateTestUsers(signedAdminRestContext, 1, (err, users) => {
          assert.notExists(err);

          const { 0: mrvisser } = users;

          RestAPI.User.getMe(mrvisser.restContext, (err, mrvisserFullMeData) => {
            assert.notExists(err);
            // Re-enable the processor so the file can be processed
            PreviewAPI.enable(err => {
              assert.notExists(err);

              // Create a file that we can process
              RestAPI.Content.createFile(
                mrvisser.restContext,
                {
                  displayName: 'Test Content 1',
                  description: 'Test content description 1',
                  PRIVATE,
                  file: getImageStream,
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (err, contentObj) => {
                  assert.notExists(err);

                  // Setup a client that listens to the content's activity stream
                  RestAPI.Content.getContent(mrvisser.restContext, contentObj.id, (err, contentObj) => {
                    assert.notExists(err);
                    const data = {
                      authentication: {
                        userId: mrvisserFullMeData.id,
                        tenantAlias: mrvisserFullMeData.tenant.alias,
                        signature: mrvisserFullMeData.signature
                      },
                      streams: [
                        {
                          resourceId: contentObj.id,
                          streamType: 'activity',
                          token: contentObj.signature,
                          transformer: 'internal'
                        }
                      ]
                    };
                    ActivityTestsUtil.getFullySetupPushClient(data, client => {
                      client.on('message', message => {
                        if (
                          message.activities[0] &&
                          message.activities[0]['oae:activityType'] === 'previews-finished'
                        ) {
                          assert.strictEqual(message.activities[0].object.previews.status, 'done');

                          // Ensure that the full previews object is returned
                          assert.strictEqual(message.activities[0].object.previews.total, 4);
                          assert.ok(message.activities[0].object.previews.largeUrl);
                          assert.ok(message.activities[0].object.previews.mediumUrl);
                          assert.ok(message.activities[0].object.previews.smallUrl);
                          assert.ok(message.activities[0].object.previews.thumbnailUrl);
                          return callback();
                        }
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

    /**
     * Test that verifies that previews can be reprocessed by passing in a content filter
     */
    it('verify reprocessing previews with a content filter', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // Set ourselves up for quick reprocessing
      _setupForReprocessing(true, (user, content, link) => {
        // Reprocess all content items that are files
        RestAPI.Previews.reprocessPreviews(globalAdminRestContext, { content_resourceSubType: 'file' }, err => {
          assert.notExists(err);
          MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, () => {
            MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
              // Assert that we reprocessed the file content object
              RestAPI.Content.getContent(user.restContext, content.id, (err, content) => {
                assert.notExists(err);
                assert.strictEqual(content.previews.status, 'done');

                // Assert that we did not reprocess the link object
                RestAPI.Content.getContent(user.restContext, link.id, (err, link) => {
                  assert.notExists(err);
                  assert.strictEqual(link.previews.status, 'pending');
                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that previews can be reprocessed by passing in a revision filter
     */
    it('verify reprocessing previews with a revision filter', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // Set ourselves up for quick reprocessing but don't start processing just yet
      _setupForReprocessing(false, (user, content) => {
        // Wait at least 10ms before creating the new revision so we don't accidentally create a second revision at the exact same time as the original one
        setTimeout(() => {
          // Create a new revision
          RestAPI.Content.updateFileBody(user.restContext, content.id, getImageGIFStream, (err, updatedContent) => {
            assert.notExists(err);
            const secondRevisionCreated = updatedContent.created;

            // Avoid processing the new revision just yet as we want the reprocessPreviews to handle that
            PreviewTestUtil.purgePreviewsQueue(err => {
              assert.notExists(err);

              // Re-enable the preview processor with an empty preview queue
              PreviewAPI.enable(err => {
                assert.notExists(err);

                // Wait for any potential previews to finish as a sanity-check. There shouldn't be, though
                MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
                  // Ensure that no previews have been processed yet
                  RestAPI.Content.getRevisions(user.restContext, content.id, null, null, (err, data) => {
                    assert.notExists(err);

                    assert.isNotOk(data.results[0].previews);
                    assert.isNotOk(data.results[1].previews);

                    // Reprocess only the second revision by filtering by revision date
                    RestAPI.Previews.reprocessPreviews(
                      globalAdminRestContext,
                      { revision_createdAfter: secondRevisionCreated - 1 },
                      err => {
                        assert.notExists(err);
                        // Give all preview tasks a chance to complete
                        MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, () => {
                          MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
                            // Assert that we only reprocessed the last revision
                            RestAPI.Content.getRevisions(user.restContext, content.id, null, null, (err, data) => {
                              assert.notExists(err);

                              // The latest revision (first in the list) should have previews associated to it
                              assert.ok(data.results[0].previews);
                              assert.strictEqual(data.results[0].previews.status, 'done');

                              // The initial revision (second in the list) should not have any previews
                              assert.isNotOk(data.results[1].previews);
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
        }, 10);
      });
    });

    /**
     * Test that verifies that folders are reprocessed when one of the content items it contains is reprocessed
     */
    it('verify folders are reprocessed when one of the content items it contains is processed', callback => {
      // Ignore this test if the PP is disabled
      if (!defaultConfig.previews.enabled) {
        return callback();
      }

      // Set ourselves up for quick reprocessing but don't start processing just yet
      _setupForReprocessing(false, (user, content) => {
        // Create a folder to test with
        FoldersTestUtil.assertCreateFolderSucceeds(
          user.restContext,
          'test displayName',
          'test description',
          'public',
          [],
          [],
          folder => {
            /**
             * Add the content item to the folder.
             * Do NOT use the FoldersTestUtil method as that purges the folder content library,
             * which could cause intermittent test failures
             */
            RestAPI.Folders.addContentItemsToFolder(user.restContext, folder.id, [content.id], err => {
              assert.notExists(err);

              // Purge all queues
              PreviewTestUtil.purgePreviewsQueue(err => {
                assert.notExists(err);
                PreviewTestUtil.purgeFoldersPreviewsQueue(err => {
                  assert.notExists(err);

                  // Enable the PP
                  PreviewAPI.enable(err => {
                    assert.notExists(err);

                    // Reprocess all content items that are files
                    RestAPI.Previews.reprocessPreviews(
                      globalAdminRestContext,
                      { content_resourceSubType: 'file' },
                      err => {
                        assert.notExists(err);
                        MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, () => {
                          MQTestUtil.whenBothTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
                            // Assert that we reprocessed the file content object
                            RestAPI.Content.getContent(user.restContext, content.id, (err, content) => {
                              assert.notExists(err);
                              assert.strictEqual(content.previews.status, 'done');

                              // Wait until the folder has been processed
                              FoldersPreviews.whenPreviewsComplete(() => {
                                // Get the updated folder metadata
                                FoldersTestUtil.assertGetFolderSucceeds(user.restContext, folder.id, folder => {
                                  assert.ok(folder.previews);
                                  assert.ok(folder.previews.thumbnailUrl);
                                  assert.ok(folder.previews.wideUrl);

                                  // Assert the previews can be downloaded
                                  _verifySignedUriDownload(user.restContext, folder.previews.thumbnailUrl, () => {
                                    _verifySignedUriDownload(user.restContext, folder.previews.thumbnailUrl, () => {
                                      return callback();
                                    });
                                  });
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
          }
        );
      });
    });
  });

  describe('Preview util', () => {
    describe('#downloadRemoteFile', () => {
      /**
       * Test that verifies remote files can be downloaded
       */
      it('verify remote files can be downloaded', callback => {
        const tmpFile = Tempfile.createTempFile();
        downloadRemoteFile('http://localhost:2000/api/me', tmpFile.path, (err, path) => {
          assert.notExists(err);
          fs.readFile(path, 'utf8', (err, data) => {
            assert.notExists(err);

            // Verify there is some data there.
            assert.ok(data);

            // Verify we don't leak the global session into the download fetcher.
            data = JSON.parse(data);
            assert.ok(data.anon);

            // Remove the temporary file
            tmpFile.remove(err => {
              assert.notExists(err);
              callback();
            });
          });
        });
      });
    });
  });
});
