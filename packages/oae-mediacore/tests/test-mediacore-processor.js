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

const assert = require('assert');
const fs = require('fs');
const util = require('util');
const path = require('path');
const _ = require('underscore');

const ConfigTestUtil = require('oae-config/lib/test/util');
const MQTestUtil = require('oae-util/lib/test/mq-util');
const PreviewAPI = require('oae-preview-processor');
const PreviewConstants = require('oae-preview-processor/lib/constants');
const PreviewTestUtil = require('oae-preview-processor/lib/test/util');
const RestAPI = require('oae-rest');
const TestsUtil = require('oae-tests/lib/util');

const MediaCoreProcessor = require('oae-mediacore/lib/processor');
const MediaCoreTestsUtil = require('oae-mediacore/lib/test/util');

describe('MediaCore Processor', () => {
  let globalAdminRestContext = null;
  let camAdminRestContext = null;
  let gtAdminRestContext = null;

  let app = null;
  let server = null;
  let port = null;

  /*!
     * Set up a mock web server and rest contexts before each test
     */
  beforeEach(callback => {
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);

    // Start the express server
    TestsUtil.createTestServer((_app, _server, _port) => {
      app = _app;
      server = _server;
      port = _port;

      // Enable the MediaCore preview processor and configure it to talk to our new web server
      MediaCoreTestsUtil.enableMediaCore(
        camAdminRestContext,
        util.format('http://127.0.0.1:%s', port),
        'camKey',
        'camSecret',
        12345,
        callback
      );
    });
  });

  /*!
     * Shut down the mock web server after each test
     */
  afterEach(callback => {
    server.close(callback);
  });

  /*!
     * @return a stream to a video file
     */
  const _getVideoStream = function() {
    return fs.createReadStream(path.join(__dirname, '/data/video.mp4'));
  };

  /*!
     * @return a stream to an audio file
     */
  const _getAudioStream = function() {
    return fs.createReadStream(path.join(__dirname, '/data/music.mp3'));
  };

  describe('#test', () => {
    /**
     * Test that verifies the MediaCore processor will claim an mp4 file
     */
    it('verify the MediaCore processor will pick up an mp4 file', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'public',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            RestAPI.Content.getRevision(
              user.restContext,
              content.id,
              content.latestRevisionId,
              (err, revision) => {
                assert.ok(!err);

                const mockPreviewContext = {
                  content,
                  revisionId: revision.id,
                  revision
                };

                MediaCoreProcessor.test(mockPreviewContext, content, (err, rank) => {
                  assert.strictEqual(rank, 20);
                  return callback();
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies the MediaCore processor will claim an mp3 file
     */
    it('verify the MediaCore processor will pick up an mp3 file', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        RestAPI.Content.createFile(
          user.restContext,
          'test song',
          null,
          'public',
          _getAudioStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            RestAPI.Content.getRevision(
              user.restContext,
              content.id,
              content.latestRevisionId,
              (err, revision) => {
                assert.ok(!err);

                const mockPreviewContext = {
                  content,
                  revisionId: revision.id,
                  revision
                };

                MediaCoreProcessor.test(mockPreviewContext, content, (err, rank) => {
                  assert.strictEqual(rank, 20);
                  return callback();
                });
              }
            );
          }
        );
      });
    });
  });

  describe('#generatePreviews', () => {
    /*!
         * Test that verifies that the MediaCore video processor executes the necessary web requests to MediaCore without the
         * post-process url
         */
    it('verify video file is posted properly to MediaCore', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        let createdMediaItem = false;
        let createdFile = false;
        let publishedFile = false;
        let uploadedFile = false;
        let gotThumbnails = false;

        // Endpoint for creating a media item. Respond with a mock media id
        app.post('/api2/media', (req, res) => {
          createdMediaItem = true;
          res.status(200).send({ id: 67890 });
        });

        // Handle the request to create the file stub on the MediaCore server
        app.post('/api2/media/:mediaId/files', (req, res) => {
          createdFile = true;
          assert.strictEqual(req.params.mediaId, '67890');
          // Return this mock structure to validate
          res.status(200).send({
            upload: {
              protocols: {
                // eslint-disable-next-line camelcase
                form_data: {
                  // The subsequent upload request will go to this url
                  // eslint-disable-next-line camelcase
                  upload_url: 'http://localhost:' + port + '/api2/media/67890/upload',

                  // The upload request should contain these post params
                  // eslint-disable-next-line camelcase
                  upload_post_params: {
                    key: 'value'
                  }
                }
              }
            }
          });
        });

        // Handle the request to publish the upload
        app.post('/api2/media/:mediaId/publish', (req, res) => {
          publishedFile = true;
          assert.strictEqual(req.params.mediaId, '67890');
          res.status(200).send({});
        });

        // Handle the request to upload the file body
        app.post('/api2/media/:mediaId/upload', (req, res) => {
          uploadedFile = true;
          assert.strictEqual(req.params.mediaId, '67890');
          assert.strictEqual(req.body.key, 'value');
          res.sendStatus(200);
        });

        // Handle the request to fetch the thumbnails
        app.get('/api2/media/:mediaId/thumbs', (req, res) => {
          gotThumbnails = true;
          assert.strictEqual(req.params.mediaId, '67890');
          res.status(200).send({
            sizes: {
              l: 'http://path/to/large/image',
              '720p': 'http://path/to/720p/image'
            }
          });
        });

        // Create a video item and wait for the preview processor to invoke all our endpoints
        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'public',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            let numLargePreviews = 0;
            let num720pPreviews = 0;
            let hadMediaCoreIdPreview = false;

            const mockPreviewContext = {
              contentId: content.id,
              revisionId: content.latestRevisionId,
              revision: { previews: {} },
              download(callback) {
                // We'll give a reference to the file, but we're not actually going to use it
                return callback(null, path.join(__dirname, '/data/video.mp4'));
              },
              addPreview(name, value) {
                // Ensure the preview references apply to the proper preview sizes
                if (name === 'http://path/to/large/image') {
                  numLargePreviews++;
                  assert.ok(_.contains(['thumbnail', 'small'], value));
                } else if (name === 'http://path/to/720p/image') {
                  num720pPreviews++;
                  assert.ok(_.contains(['medium', 'large', 'wide'], value));
                }
              },
              addPreviewMetadata(name, value) {
                // Ensure the mediaCoreId that gets set is correct
                if (name === 'mediaCoreId') {
                  hadMediaCoreIdPreview = true;
                  assert.strictEqual(value, 67890);
                }
              }
            };

            // Generate the previews to invoke the mock endpoints and assert the data set on the mock preview context
            MediaCoreProcessor.generatePreviews(mockPreviewContext, content, err => {
              assert.ok(!err);
              assert.ok(createdMediaItem);
              assert.ok(createdFile);
              assert.ok(publishedFile);
              assert.ok(uploadedFile);
              assert.ok(gotThumbnails);

              assert.ok(hadMediaCoreIdPreview);
              assert.strictEqual(numLargePreviews, 2);
              assert.strictEqual(num720pPreviews, 3);

              return callback();
            });
          }
        );
      });
    });

    /*!
         * Test that verifies that the MediaCore video processor only uploads to MediaCore once
         */
    it('verify video file is not uploaded to MediaCore if it already has a media id', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        let gotThumbnails = false;

        // Endpoint for creating a media item. Respond with a mock media id
        app.post('/api2/media', (req, res) => {
          assert.fail('Should not have tried to create a media item');
        });

        // Handle the request to create the file stub on the MediaCore server
        app.post('/api2/media/:mediaId/files', (req, res) => {
          assert.fail('Should not have tried to create a media file');
        });

        // Handle the request to publish the upload
        app.post('/api2/media/:mediaId/publish', (req, res) => {
          assert.fail('Should not have tried to publish a media item');
        });

        // Handle the request to upload the file body
        app.post('/api2/media/:mediaId/upload', (req, res) => {
          assert.fail('Should not have tried to upload a file');
        });

        // Handle the request to fetch the thumbnails
        app.get('/api2/media/:mediaId/thumbs', (req, res) => {
          gotThumbnails = true;
          assert.strictEqual(req.params.mediaId, '12345');
          res.status(200).send({
            sizes: {
              l: 'http://path/to/large/image',
              '720p': 'http://path/to/720p/image'
            }
          });
        });

        // Create a video item and wait for the preview processor to invoke all our endpoints
        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'public',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            let numLargePreviews = 0;
            let num720pPreviews = 0;
            let hadMediaCoreIdPreview = false;

            const mockPreviewContext = {
              contentId: content.id,
              revisionId: content.latestRevisionId,
              revision: { previews: { mediaCoreId: 12345 } },
              download(callback) {
                // We should not download the file body because our revision has a mediaCoreId already
                assert.fail('Should not have tried to download the video file to the PP');
              },
              addPreview(name, value) {
                // Ensure the preview references apply to the proper preview sizes
                if (name === 'http://path/to/large/image') {
                  numLargePreviews++;
                  assert.ok(_.contains(['thumbnail', 'small'], value));
                } else if (name === 'http://path/to/720p/image') {
                  num720pPreviews++;
                  assert.ok(_.contains(['medium', 'large', 'wide'], value));
                }
              },
              addPreviewMetadata(name, value) {
                // Ensure the mediaCoreId that gets set is correct
                if (name === 'mediaCoreId') {
                  hadMediaCoreIdPreview = true;
                  assert.strictEqual(value, 12345);
                }
              }
            };

            // Generate the previews to invoke the test and ensure we only fetch the existing thumbnails
            MediaCoreProcessor.generatePreviews(mockPreviewContext, content, err => {
              assert.ok(!err);
              assert.ok(gotThumbnails);

              assert.ok(hadMediaCoreIdPreview);
              assert.strictEqual(numLargePreviews, 2);
              assert.strictEqual(num720pPreviews, 3);

              return callback();
            });
          }
        );
      });
    });

    /*!
         * Test that verifies that the MediaCore video processor executes the necessary web requests to MediaCore with a
         * post-process url
         */
    it('verify video file is posted properly with post-process url', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        let createdMediaItem = false;
        let createdFile = false;
        let publishedFile = false;
        let uploadedFile = false;
        let postProcessed = false;
        let gotThumbnails = false;

        // Endpoint for creating a media item. Respond with a mock media id
        app.post('/api2/media', (req, res) => {
          createdMediaItem = true;
          res.status(200).send({ id: 67890 });
        });

        // Handle the request to create the file stub on the MediaCore server
        app.post('/api2/media/:mediaId/files', (req, res) => {
          createdFile = true;
          assert.strictEqual(req.params.mediaId, '67890');
          // Return this mock structure to validate
          res.status(200).send({
            upload: {
              protocols: {
                // eslint-disable-next-line camelcase
                form_data: {
                  // The subsequent upload request will go to this url
                  // eslint-disable-next-line camelcase
                  upload_url: 'http://localhost:' + port + '/api2/media/67890/upload',

                  // Add a post-process url so we can ensure it gets invoked
                  // eslint-disable-next-line camelcase
                  postprocess_url: '/api2/media/67890/postProcess',

                  // The upload request should contain these post params
                  // eslint-disable-next-line camelcase
                  upload_post_params: {
                    key: 'value'
                  }
                }
              }
            }
          });
        });

        // Handle the request to publish the upload
        app.post('/api2/media/:mediaId/publish', (req, res) => {
          publishedFile = true;
          assert.strictEqual(req.params.mediaId, '67890');
          res.status(200).send({});
        });

        // Handle the request to upload the file body
        app.post('/api2/media/:mediaId/upload', (req, res) => {
          uploadedFile = true;
          assert.strictEqual(req.params.mediaId, '67890');
          assert.strictEqual(req.body.key, 'value');
          res.sendStatus(200);
        });

        // Handle the request to fetch the thumbnails
        app.get('/api2/media/:mediaId/thumbs', (req, res) => {
          gotThumbnails = true;
          assert.strictEqual(req.params.mediaId, '67890');
          res.status(200).send({
            sizes: {
              l: 'http://path/to/large/image',
              '720p': 'http://path/to/720p/image'
            }
          });
        });

        // Handle the request to fetch the thumbnails
        app.post('/api2/media/:mediaId/postProcess', (req, res) => {
          postProcessed = true;
          assert.strictEqual(req.params.mediaId, '67890');
          res.status(200).send({});
        });

        // Create a video item and wait for the preview processor to invoke all our endpoints
        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'public',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            let numLargePreviews = 0;
            let num720pPreviews = 0;
            let hadMediaCoreIdPreview = false;

            const mockPreviewContext = {
              contentId: content.id,
              revisionId: content.latestRevisionId,
              revision: { previews: {} },
              download(callback) {
                // We'll give a reference to the file, but we're not actually going to use it
                return callback(null, path.join(__dirname, '/data/video.mp4'));
              },
              addPreview(name, value) {
                // Ensure the preview references apply to the proper preview sizes
                if (name === 'http://path/to/large/image') {
                  numLargePreviews++;
                  assert.ok(_.contains(['thumbnail', 'small'], value));
                } else if (name === 'http://path/to/720p/image') {
                  num720pPreviews++;
                  assert.ok(_.contains(['medium', 'large', 'wide'], value));
                }
              },
              addPreviewMetadata(name, value) {
                // Ensure the mediaCoreId that gets set is correct
                if (name === 'mediaCoreId') {
                  hadMediaCoreIdPreview = true;
                  assert.strictEqual(value, 67890);
                }
              }
            };

            // Generate the previews to invoke the mock endpoints and assert the data set on the mock preview context
            MediaCoreProcessor.generatePreviews(mockPreviewContext, content, err => {
              assert.ok(!err);
              assert.ok(createdMediaItem);
              assert.ok(createdFile);
              assert.ok(publishedFile);
              assert.ok(uploadedFile);
              assert.ok(gotThumbnails);
              assert.ok(postProcessed);

              assert.ok(hadMediaCoreIdPreview);
              assert.strictEqual(numLargePreviews, 2);
              assert.strictEqual(num720pPreviews, 3);

              return callback();
            });
          }
        );
      });
    });

    /*!
         * Test that verifies that the revision data and filename is sent to MediaCore for the upload file instead of content data and displayName
         */
    it('verify revision data and filename are sent to MediaCore instead of content data and display name', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        // Used to assert the data passed for the media items in the MediaCore requests
        const mediaAssertions = {
          displayName: null,
          fileName: null,
          size: null
        };

        // Endpoint for creating a media item. Respond with a mock media id
        app.post('/api2/media', (req, res) => {
          assert.strictEqual(req.body.collection_id, '12345');
          assert.strictEqual(req.body.title, mediaAssertions.displayName);
          assert.strictEqual(req.body.byline, user.user.displayName);
          res.status(200).send({ id: 67890 });
        });

        // Handle the request to create the file stub on the MediaCore server
        app.post('/api2/media/:mediaId/files', (req, res) => {
          const createdFile = true;
          assert.strictEqual(req.params.mediaId, '67890');
          assert.strictEqual(req.body.upload_name, mediaAssertions.fileName);
          assert.strictEqual(req.body.upload_size, mediaAssertions.size);

          // Return this mock structure to validate
          res.status(200).send({
            upload: {
              protocols: {
                // eslint-disable-next-line camelcase
                form_data: {
                  // The subsequent upload request will go to this url
                  // eslint-disable-next-line camelcase
                  upload_url: 'http://localhost:' + port + '/api2/media/67890/upload',
                  // eslint-disable-next-line camelcase
                  upload_post_params: {}
                }
              }
            }
          });
        });

        // Handle the request to publish the upload
        app.post('/api2/media/:mediaId/publish', (req, res) => {
          res.status(200).send({});
        });

        // Handle the request to upload the file body
        app.post('/api2/media/:mediaId/upload', (req, res) => {
          res.sendStatus(200);
        });

        // Handle the request to fetch the thumbnails
        app.get('/api2/media/:mediaId/thumbs', (req, res) => {
          res.status(200).send({
            sizes: {
              l: 'http://path/to/large/image',
              '720p': 'http://path/to/720p/image'
            }
          });
        });

        // Create a video item and wait for the preview processor to invoke all our endpoints
        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'public',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            // Get the full content profile so that createdBy is set to the full user who created it
            RestAPI.Content.getContent(user.restContext, content.id, (err, content) => {
              assert.ok(!err);

              // Get the revision so we can perform assertions against it
              RestAPI.Content.getRevision(
                user.restContext,
                content.id,
                content.latestRevisionId,
                (err, revision) => {
                  assert.ok(!err);

                  // Create a mock previewcontext that we can use to fire the generate previews operation of the MediaCore
                  // preview processor
                  const mockPreviewContext = {
                    contentId: content.id,
                    revisionId: revision.id,
                    revision,
                    download(callback) {
                      // We'll give a reference to the file, but we're not actually going to use it
                      return callback(null, path.join(__dirname, '/data/video.mp4'));
                    },
                    addPreview(name, value) {},
                    addPreviewMetadata(name, value) {}
                  };

                  // We expect the filename of the video stream and its size
                  mediaAssertions.displayName = content.displayName;
                  mediaAssertions.fileName = revision.filename;
                  mediaAssertions.size = revision.size;

                  // Generate the previews to invoke the mock endpoints and assert the data set on the mock preview context
                  MediaCoreProcessor.generatePreviews(mockPreviewContext, content, err => {
                    assert.ok(!err);

                    // Update the content item now with a file of a different name and size
                    RestAPI.Content.updateFileBody(
                      user.restContext,
                      content.id,
                      _getAudioStream,
                      (err, content) => {
                        assert.ok(!err);

                        // Get the new revision so we can assert its file data
                        RestAPI.Content.getRevision(
                          user.restContext,
                          content.id,
                          content.latestRevisionId,
                          (err, revision) => {
                            assert.ok(!err);

                            // Prepare the mock preview context for the next test with the newest revision data
                            mockPreviewContext.revisionId = revision.id;
                            mockPreviewContext.revision = revision;

                            // Set our new upload file expectations based on revision data
                            mediaAssertions.fileName = revision.filename;
                            mediaAssertions.size = revision.size;

                            // Generate the previews to invoke the mock endpoints and assert the file data
                            MediaCoreProcessor.generatePreviews(
                              mockPreviewContext,
                              content,
                              err => {
                                assert.ok(!err);
                                return callback();
                              }
                            );
                          }
                        );
                      }
                    );
                  });
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies tenant-specific MediaCore configuration is honoured
     */
    it('verify video uploads from different tenants honour tenant-specific configuration', callback => {
      // Cambridge has a test server setup to some random port, we'll start up another for gatech to ensure the separate URL configuration is honoured
      TestsUtil.createTestServer((gtMediaCoreApp, gtMediaCoreServer, gtMediaCorePort) => {
        const gtMediaCoreUrl = util.format('http://127.0.0.1:%s', gtMediaCorePort);

        // Setup the gatech tenant to use the 2nd MediaCore server
        MediaCoreTestsUtil.enableMediaCore(
          gtAdminRestContext,
          gtMediaCoreUrl,
          'gtKey',
          'gtSecret',
          67890,
          err => {
            assert.ok(!err);

            // Tracks whether or not publish requests were received by the cam and gt tenants
            let camRequestReceived = false;
            let gtRequestReceived = false;

            /**
             * Ensure we exit when we receive a MediaCore upload for each uploaded file
             */
            const _finishMediaCoreRequest = function() {
              if (camRequestReceived && gtRequestReceived) {
                // The test was successful, we expected one from each tenant. If we do not receive each request, this test will time out and that
                // is what indicates the error
                return callback();
              }
            };

            // Apply routes to the cam and gt MediaCore servers to verify the incoming config information
            app.post('/api2/media', (req, res) => {
              camRequestReceived = true;
              assert.strictEqual(req.body.collection_id, '12345');
              assert.strictEqual(req.body.title, 'File from cam tenant');
              res.status(400).send({});
              return _finishMediaCoreRequest();
            });

            gtMediaCoreApp.post('/api2/media', (req, res) => {
              gtRequestReceived = true;
              assert.strictEqual(req.body.collection_id, '67890');
              assert.strictEqual(req.body.title, 'File from gt tenant');
              res.status(400).send({});
              return _finishMediaCoreRequest();
            });

            // Generate our test users with which to create files
            TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, camUser) => {
              assert.ok(!err);
              camUser = _.values(camUser)[0];
              TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, gtUser) => {
                assert.ok(!err);
                gtUser = _.values(gtUser)[0];

                // Create a video file for each tenant
                RestAPI.Content.createFile(
                  camUser.restContext,
                  'File from cam tenant',
                  null,
                  'public',
                  _getVideoStream,
                  null,
                  null,
                  null,
                  (err, camContent) => {
                    assert.ok(!err);
                    RestAPI.Content.createFile(
                      gtUser.restContext,
                      'File from gt tenant',
                      null,
                      'public',
                      _getVideoStream,
                      null,
                      null,
                      null,
                      (err, gtContent) => {
                        assert.ok(!err);

                        // Get the revisions that we can use for the mock preview contexts
                        RestAPI.Content.getRevision(
                          camUser.restContext,
                          camContent.id,
                          camContent.latestRevisionId,
                          (err, camRevision) => {
                            assert.ok(!err);
                            RestAPI.Content.getRevision(
                              gtUser.restContext,
                              gtContent.id,
                              gtContent.latestRevisionId,
                              (err, gtRevision) => {
                                assert.ok(!err);

                                // Create the mock preview contexts we can use to invoke the MediaCore preview processor
                                const camMockPreviewContext = {
                                  contentId: camContent.id,
                                  revisionId: camRevision.revisionId,
                                  revision: camRevision,
                                  download(callback) {
                                    return callback(null, path.join(__dirname, '/data/video.mp4'));
                                  },
                                  addPreview(name, value) {},
                                  addPreviewMetadata(name, value) {}
                                };

                                const gtMockPreviewContext = {
                                  contentId: gtContent.id,
                                  revisionId: gtRevision.revisionId,
                                  revision: gtRevision,
                                  download(callback) {
                                    return callback(null, path.join(__dirname, '/data/video.mp4'));
                                  },
                                  addPreview(name, value) {},
                                  addPreviewMetadata(name, value) {}
                                };

                                // Invoke the processors, letting the mock MediaCore servers and routes we set up earlier handle the remaining assertions
                                MediaCoreProcessor.generatePreviews(
                                  camMockPreviewContext,
                                  camContent,
                                  err => {
                                    assert.ok(err);
                                    MediaCoreProcessor.generatePreviews(
                                      gtMockPreviewContext,
                                      gtContent,
                                      err => {
                                        assert.ok(err);
                                        // Don't callback here, we're expecting the `_finishMediaCoreRequest` function to eventually call back
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
      });
    });
  });
});
