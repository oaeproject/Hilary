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
const _ = require('underscore');
const path = require('path');

const ConfigTestUtil = require('oae-config/lib/test/util');
const ContentDAO = require('oae-content/lib/internal/dao');
const MQTestUtil = require('oae-util/lib/test/mq-util');
const PreviewAPI = require('oae-preview-processor');
const PreviewConstants = require('oae-preview-processor/lib/constants');
const PreviewTestUtil = require('oae-preview-processor/lib/test/util');
const RestAPI = require('oae-rest');
const TestsUtil = require('oae-tests/lib/util');

const MediaCoreDAO = require('oae-mediacore/lib/internal/dao');
const MediaCoreProcessor = require('oae-mediacore/lib/processor');
const MediaCoreTestsUtil = require('oae-mediacore/lib/test/util');

describe('MediaCore API', () => {
  let globalAdminRestContext = null;
  let camAdminRestContext = null;
  let gtAdminRestContext = null;
  let camAnonymousRestContext = null;

  let mediaCoreApp = null;
  let server = null;
  let port = null;

  /*!
     * Set up a mock web server and rest contexts before each test
     */
  beforeEach(callback => {
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    camAnonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);

    // Start the express server
    TestsUtil.createTestServer((_mediaCoreApp, _server, _port) => {
      mediaCoreApp = _mediaCoreApp;
      server = _server;
      port = _port;

      // Enable the MediaCore preview processor and configure it to talk to our new web server
      return MediaCoreTestsUtil.enableMediaCore(
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

  describe('#getEmbedCode', () => {
    /**
     * Test that verifies the authorization and validation of the getEmbedCode method
     */
    it('verify authorization and invalid parameters', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
        assert.ok(!err);
        const user = _.values(users)[0];
        const unauthorizedUser = _.values(users)[1];

        // Create the content item that we'll test with
        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'private',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            // Add a handler for the embed code endpoint that simply returns a 200 and some dummy embed source
            mediaCoreApp.get('/api2/media/:mediaCoreId/embedcode', (req, res) => {
              assert.strictEqual(req.params.mediaCoreId, '12345');
              res.status(200).send({
                html: '<iframe src="http://www.google.ca?test=true"></iframe>'
              });
            });

            // Verify we get 400 when fetching embed code for a non-resource id
            RestAPI.MediaCore.getEmbedCode(user.restContext, 'not-an-id', err => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);

              // Verify we get 404 when fetching embed code for non-existing content item
              RestAPI.MediaCore.getEmbedCode(
                user.restContext,
                'c:camtest:non-existing-content',
                err => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 404);

                  // Verify we get 400 when fetching embed code for content item who doesn't have a mediaCoreId
                  RestAPI.MediaCore.getEmbedCode(user.restContext, content.id, err => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 400);

                    // Get the embed code as anonymous to ensure they cannot
                    RestAPI.MediaCore.getEmbedCode(camAnonymousRestContext, content.id, err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 401);

                      // Get the embed code as another unauthorized user to ensure they cannot
                      RestAPI.MediaCore.getEmbedCode(
                        unauthorizedUser.restContext,
                        content.id,
                        err => {
                          assert.ok(err);
                          assert.strictEqual(err.code, 401);

                          // Set a MediaCore id on the content item
                          ContentDAO.Previews.storeMetadata(
                            content,
                            content.latestRevisionId,
                            'done',
                            null,
                            null,
                            { mediaCoreId: 12345 },
                            {},
                            err => {
                              assert.ok(!err);

                              // Now getting the embed code as the user that created the content item should be successful
                              RestAPI.MediaCore.getEmbedCode(
                                user.restContext,
                                content.id,
                                (err, embedCode) => {
                                  assert.ok(!err);
                                  assert.ok(embedCode);
                                  assert.ok(embedCode.html);
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
            });
          }
        );
      });
    });

    /**
     * Test that verifies tenant-specific MediaCore configuration is honoured when fetching the embed code
     */
    it('verify fetching embed code goes to the configured MediaCore instance in multi-tenant scenario', callback => {
      // Create a MediaCore server to be accessed for files in the gt tenant and configure the gatech tenant to use it
      TestsUtil.createTestServer((gtMediaCoreApp, gtMediaCoreServer, gtMediaCorePort) => {
        MediaCoreTestsUtil.enableMediaCore(
          gtAdminRestContext,
          util.format('http://127.0.0.1:%s', gtMediaCorePort),
          'gtKey',
          'gtSecret',
          67890,
          () => {
            // Create the cambridge and gatech users to create and access files with
            TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
              assert.ok(!err);
              const camUser = _.values(users)[0];
              TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users) => {
                const gtUser = _.values(users)[0];

                // Create the content items for cambridge and gatech that we'll test with, and give them mediaCoreIds
                RestAPI.Content.createFile(
                  camUser.restContext,
                  'test video',
                  null,
                  'public',
                  _getVideoStream,
                  null,
                  null,
                  null,
                  (err, camContent) => {
                    assert.ok(!err);
                    RestAPI.Content.setPreviewItems(
                      camAdminRestContext,
                      camContent.id,
                      camContent.latestRevisionId,
                      'done',
                      {},
                      {},
                      {},
                      { mediaCoreId: 12345 },
                      err => {
                        assert.ok(!err);
                        RestAPI.Content.createFile(
                          gtUser.restContext,
                          'test video',
                          null,
                          'public',
                          _getVideoStream,
                          null,
                          null,
                          null,
                          (err, gtContent) => {
                            assert.ok(!err);
                            RestAPI.Content.setPreviewItems(
                              gtAdminRestContext,
                              gtContent.id,
                              gtContent.latestRevisionId,
                              'done',
                              {},
                              {},
                              {},
                              { mediaCoreId: 67890 },
                              err => {
                                assert.ok(!err);

                                // Set up the embedcode handlers for the cambridge and gatech MediaCore instances
                                mediaCoreApp.get(
                                  '/api2/media/:mediaCoreId/embedcode',
                                  (req, res) => {
                                    assert.strictEqual(req.params.mediaCoreId, '12345');
                                    res.status(200).send({
                                      html: '<iframe src="http://cambridge.mediacore.tv"></iframe>'
                                    });
                                  }
                                );

                                gtMediaCoreApp.get(
                                  '/api2/media/:mediaCoreId/embedcode',
                                  (req, res) => {
                                    assert.strictEqual(req.params.mediaCoreId, '67890');
                                    res.status(200).send({
                                      html: '<iframe src="http://gatech.mediacore.tv"></iframe>'
                                    });
                                  }
                                );

                                // Access the cambridge tenant file with the gatech user to ensure the request still goes to the cambridge MediaCore instance
                                RestAPI.MediaCore.getEmbedCode(
                                  gtUser.restContext,
                                  camContent.id,
                                  (err, embedCode) => {
                                    assert.ok(!err);
                                    assert.strictEqual(
                                      embedCode.html.indexOf(
                                        '<iframe src="http://cambridge.mediacore.tv'
                                      ),
                                      0
                                    );

                                    RestAPI.MediaCore.getEmbedCode(
                                      camUser.restContext,
                                      gtContent.id,
                                      (err, embedCode) => {
                                        assert.ok(!err);
                                        assert.strictEqual(
                                          embedCode.html.indexOf(
                                            '<iframe src="http://gatech.mediacore.tv'
                                          ),
                                          0
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
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies when MediaCore provides invalid JSON in the response body, we return a 500 code to the client
     */
    it('verify invalid JSON response from MediaCore results in internal error to endpoint', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        // Create the content item that we'll test with
        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'private',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            // Set a MediaCore id on the content item
            ContentDAO.Previews.storeMetadata(
              content,
              content.latestRevisionId,
              'done',
              null,
              null,
              { mediaCoreId: 12345 },
              {},
              err => {
                assert.ok(!err);

                // Add a handler for the embed code endpoint that returns 200 but invalid JSON
                mediaCoreApp.get('/api2/media/:mediaCoreId/embedcode', (req, res) => {
                  assert.strictEqual(req.params.mediaCoreId, '12345');
                  res.status(200).send('not valid json');
                });

                // Verify we get 500 because the MediaCore response was not valid JSON
                RestAPI.MediaCore.getEmbedCode(user.restContext, content.id, err => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 500);
                  return callback();
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that if MediaCore is returning 502 errors, they are not relayed directly to the client as that may
     * indicate the app server is in the process of shutting down. This could result in a webserver retrying on other nodes
     * and dropping them out of the cluster one by one.
     */
    it('verify a 502 response code from MediaCore is not relayed to the client', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        // Create the content item that we'll test with
        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'private',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            // Set a MediaCore id on the content item
            ContentDAO.Previews.storeMetadata(
              content,
              content.latestRevisionId,
              'done',
              null,
              null,
              { mediaCoreId: 12345 },
              {},
              err => {
                assert.ok(!err);

                // Add a handler for the embed code endpoint that returns 200 but invalid JSON
                mediaCoreApp.get('/api2/media/:mediaCoreId/embedcode', (req, res) => {
                  assert.strictEqual(req.params.mediaCoreId, '12345');
                  res.status(502).send({ reason: 'you are DOSd' });
                });

                // Verify we get 500 when fetching embed code for a MediaCore server that has gone awry
                RestAPI.MediaCore.getEmbedCode(user.restContext, content.id, err => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 500);
                  return callback();
                });
              }
            );
          }
        );
      });
    });
  });

  describe('#updateThumbnails', () => {
    /**
     * Test that verifies the validation of updating a video item thumbnail
     */
    it('verify validation of updating media item previews', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        // Create the content item that we'll test with
        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'private',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            const mediaCoreId = '23456';

            // Set a MediaCore id on the content item
            ContentDAO.Previews.storeMetadata(
              content,
              content.latestRevisionId,
              'done',
              null,
              null,
              { mediaCoreId },
              {},
              err => {
                assert.ok(!err);

                // Map id 23456 to the content item
                MediaCoreDAO.saveContentRevisionId(
                  mediaCoreId,
                  content.id,
                  content.latestRevisionId,
                  err => {
                    assert.ok(!err);

                    // Ensure an invalid id results in a 400
                    RestAPI.MediaCore.notifyEncodingComplete(user.restContext, 'not-an-id', err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 400);

                      // Ensure a non-existing id results in a 404
                      RestAPI.MediaCore.notifyEncodingComplete(user.restContext, 0, err => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 404);

                        const fetchedThumbnails = false;

                        // Add a handler that listens for the expected thumbnail request returning a successful response
                        mediaCoreApp.get('/api2/media/:mediaCoreId/thumbs', (req, res) => {
                          res.status(200).send({ sizes: {} });
                        });

                        RestAPI.MediaCore.notifyEncodingComplete(
                          user.restContext,
                          mediaCoreId,
                          err => {
                            assert.ok(!err);
                            return callback();
                          }
                        );
                      });
                    });
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that updating the thumbnails actually updates the thumbnails on the content object
     */
    it('verify updating the thumbnails results in the thumbnails on the content item getting updated', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        // Create the content item that we'll test with
        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'private',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            const mediaCoreId = '23457';

            // Set a MediaCore id on the content item
            ContentDAO.Previews.storeMetadata(
              content,
              content.latestRevisionId,
              'done',
              null,
              null,
              { mediaCoreId },
              {},
              err => {
                assert.ok(!err);

                // Map id 23457 to the content item
                MediaCoreDAO.saveContentRevisionId(
                  mediaCoreId,
                  content.id,
                  content.latestRevisionId,
                  err => {
                    assert.ok(!err);

                    // Add a handler that listens for the expected thumbnail request returning a successful response
                    mediaCoreApp.get('/api2/media/:mediaCoreId/thumbs', (req, res) => {
                      res.status(200).send({
                        sizes: {
                          l: 'http://path/to/large/image',
                          '720p': 'http://path/to/720p/image'
                        }
                      });
                    });

                    // Ensure a non-existing id results in a 404
                    RestAPI.MediaCore.notifyEncodingComplete(user.restContext, mediaCoreId, err => {
                      assert.ok(!err);

                      RestAPI.Content.getContent(user.restContext, content.id, (err, content) => {
                        assert.ok(!err);
                        assert.ok(content.previews);

                        // Verify the URIs are not returned in the preview model
                        assert.ok(!content.previews.smallUri);
                        assert.ok(!content.previews.mediumUri);
                        assert.ok(!content.previews.largeUri);
                        assert.ok(!content.previews.wideUri);

                        // Verify the URLs. The "remote" backend simply uses the location part as-is so the url should just be the
                        // direct links to the files
                        assert.strictEqual(content.previews.smallUrl, 'http://path/to/large/image');
                        assert.strictEqual(content.previews.mediumUrl, 'http://path/to/720p/image');
                        assert.strictEqual(content.previews.largeUrl, 'http://path/to/720p/image');
                        assert.strictEqual(content.previews.wideUrl, 'http://path/to/720p/image');

                        return callback();
                      });
                    });
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies when MediaCore response with invalid JSON we return a 500 error to the client
     */
    it('verify invalid JSON from MediaCore results in a 500 error to the client', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        // Create the content item that we'll test with
        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'private',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            const mediaCoreId = '23457';

            // Set a MediaCore id on the content item
            ContentDAO.Previews.storeMetadata(
              content,
              content.latestRevisionId,
              'done',
              null,
              null,
              { mediaCoreId },
              {},
              err => {
                assert.ok(!err);

                // Map id 23457 to the content item
                MediaCoreDAO.saveContentRevisionId(
                  mediaCoreId,
                  content.id,
                  content.latestRevisionId,
                  err => {
                    assert.ok(!err);

                    // Add a handler that listens for the expected thumbnail request returning a successful response
                    mediaCoreApp.get('/api2/media/:mediaCoreId/thumbs', (req, res) => {
                      res.status(200).send('not valid json');
                    });

                    // Cause the thumbnails to be updated
                    RestAPI.MediaCore.notifyEncodingComplete(user.restContext, mediaCoreId, err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 500);
                      return callback();
                    });
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies when MediaCore response with invalid JSON we return a 500 error to the client
     */
    it('verify invalid JSON from MediaCore results in a 500 error to the client', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        // Create the content item that we'll test with
        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'private',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            const mediaCoreId = '23457';

            // Set a MediaCore id on the content item
            ContentDAO.Previews.storeMetadata(
              content,
              content.latestRevisionId,
              'done',
              null,
              null,
              { mediaCoreId },
              {},
              err => {
                assert.ok(!err);

                // Map id 23457 to the content item
                MediaCoreDAO.saveContentRevisionId(
                  mediaCoreId,
                  content.id,
                  content.latestRevisionId,
                  err => {
                    assert.ok(!err);

                    // Add a handler that listens for the expected thumbnail request returning a successful response
                    mediaCoreApp.get('/api2/media/:mediaCoreId/thumbs', (req, res) => {
                      res.status(200).send('not valid json');
                    });

                    // Cause the thumbnails to be updated
                    RestAPI.MediaCore.notifyEncodingComplete(user.restContext, mediaCoreId, err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 500);
                      return callback();
                    });
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies when MediaCore response with invalid JSON we return a 500 error to the client
     */
    it('verify 502 response from MediaCore is not relayed to the client', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        // Create the content item that we'll test with
        RestAPI.Content.createFile(
          user.restContext,
          'test video',
          null,
          'private',
          _getVideoStream,
          null,
          null,
          null,
          (err, content) => {
            assert.ok(!err);

            const mediaCoreId = '23457';

            // Set a MediaCore id on the content item
            ContentDAO.Previews.storeMetadata(
              content,
              content.latestRevisionId,
              'done',
              null,
              null,
              { mediaCoreId },
              {},
              err => {
                assert.ok(!err);

                // Map id 23457 to the content item
                MediaCoreDAO.saveContentRevisionId(
                  mediaCoreId,
                  content.id,
                  content.latestRevisionId,
                  err => {
                    assert.ok(!err);

                    // Add a handler that listens for the expected thumbnail request returning a successful response
                    mediaCoreApp.get('/api2/media/:mediaCoreId/thumbs', (req, res) => {
                      res.status(502).send({ sizes: {} });
                    });

                    // Cause the thumbnails to be updated
                    RestAPI.MediaCore.notifyEncodingComplete(user.restContext, mediaCoreId, err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 500);
                      return callback();
                    });
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
