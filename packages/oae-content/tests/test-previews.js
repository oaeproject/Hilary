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

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import _ from 'underscore';
import { flush } from 'oae-util/lib/redis';

import * as ActivityTestsUtil from 'oae-activity/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as RestUtil from 'oae-rest/lib/util';
import * as SearchTestsUtil from 'oae-search/lib/test/util';
import * as TestsUtil from 'oae-tests';
import { isPrivate } from 'oae-tenants/lib/util';

const PUBLIC = 'public';
const PRIVATE = 'private';

describe('File previews', () => {
  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as a global admin on the created tenant
  let globalAdminOnTenantRestContext = null;
  // Rest context that can be used every time we need to make a request as an anonymous user on the created tenant
  let anonymousRestContext = null;
  // Rest context that can be used every time we need to make a request as a tenant admin on the cambridge tenant
  let camAdminRestContext = null;

  let suitable_files = null;
  let suitable_sizes = null;

  /**
   * Fill up the contexts
   */
  before(callback => {
    // Fill up global admin rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    // Fill up the anonymous context
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.localhost.host);
    // Cambridge tenant admin context
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // An object that adheres to the RestAPI.Content.setPreviewItems.files parameter.
    suitable_files = {
      'file.small.jpg': getFileStream,
      'file.medium.jpg': getOAELogoStream,
      'thumbnail.png': getFileStream
    };
    suitable_sizes = {
      'file.small.jpg': 'small',
      'file.medium.jpg': 'medium',
      'thumbnail.png': 'thumbnail'
    };

    // Login on the camtest tenant
    RestAPI.Admin.loginOnTenant(globalAdminRestContext, 'localhost', null, (err, ctx) => {
      assert.ok(!err);
      globalAdminOnTenantRestContext = ctx;

      RestAPI.User.getMe(globalAdminOnTenantRestContext, (err, user) => {
        assert.ok(!err);
        assert.ok(!user.anon);
        flush(callback);
      });
    });
  });

  beforeEach(done => {
    flush(done);
  });

  /**
   * Utility method that returns a stream that points to an OAE animation thumbnail.
   *
   * @return {Stream}     A stream that points to an OAE animation thumbnail that can be uploaded.
   */
  const getFileStream = function() {
    const file = path.join(__dirname, '/data/oae-video.png');
    return fs.createReadStream(file);
  };

  /**
   * Utility method that returns a stream that points to the OAE logo.
   *
   * @return {Stream}     A stream that points to the OAE logo that can be uploaded.
   */
  const getOAELogoStream = function() {
    const file = path.join(__dirname, '/data/oae-logo.png');
    return fs.createReadStream(file);
  };

  /**
   * Creates a file and adds 2 preview items
   *
   * @param  {Function}    callback                Standard callback function
   * @param  {Object}      callback.contexts       contexts object.
   * @param  {Object}      callback.content        Content object as returned by `RestAPI.ContentcreateFile`.
   * @param  {Object}      callback.previews       Previews object as returned by `RestAPI.ContentgetPreviewItems`.
   */
  const createPreviews = function(callback) {
    TestsUtil.generateTestUsers(globalAdminOnTenantRestContext, 2, (err, users) => {
      assert.ok(!err);

      const contexts = {};
      const keys = Object.keys(users);
      contexts.nicolaas = users[keys[0]];
      contexts.simon = users[keys[1]];

      RestAPI.Content.createFile(
        contexts.nicolaas.restContext,
        {
          displayName: 'Test Content 2',
          description: 'Test content description 2',
          visibility: PRIVATE,
          file: getFileStream,
          managers: [],
          viewers: [],
          folders: []
        },
        (err, contentObj) => {
          assert.ok(!err);
          assert.ok(contentObj.id);
          assert.strictEqual(contentObj.previews.status, 'pending');

          // Add some preview items.
          RestAPI.Content.setPreviewItems(
            globalAdminOnTenantRestContext,
            contentObj.id,
            contentObj.latestRevisionId,
            'done',
            suitable_files,
            suitable_sizes,
            {},
            {},
            err => {
              assert.ok(!err);

              // Get a list of preview items.
              RestAPI.Content.getPreviewItems(
                contexts.nicolaas.restContext,
                contentObj.id,
                contentObj.latestRevisionId,
                (err, previews) => {
                  assert.ok(!err);
                  assert.strictEqual(previews.files.length, 2);

                  // Ensure that the thumbnail and status parameters are set
                  RestAPI.Content.getContent(contexts.nicolaas.restContext, contentObj.id, (err, updatedContent) => {
                    assert.ok(!err);
                    assert.ok(!updatedContent.previews.thumbnailUri);
                    assert.ok(updatedContent.previews.thumbnailUrl);
                    assert.strictEqual(updatedContent.previews.status, 'done');
                    assert.ok(!updatedContent.previews.smallUri);
                    assert.ok(updatedContent.previews.smallUrl);
                    assert.ok(!updatedContent.previews.mediumUri);
                    assert.ok(updatedContent.previews.mediumUrl);
                    return callback(contexts, updatedContent, previews);
                  });
                }
              );
            }
          );
        }
      );
    });
  };

  /**
   * Verify that only the global admin can upload a preview item and
   * that the preview links are tied to the context of the user
   * who requested the link.
   */
  it('verify uploading a preview', callback => {
    createPreviews((contexts, contentObj, previews) => {
      // Only global admins should be allowed to create previews.
      RestAPI.Content.setPreviewItems(
        anonymousRestContext,
        contentObj.id,
        contentObj.latestRevisionId,
        'done',
        suitable_files,
        suitable_sizes,
        {},
        {},
        err => {
          assert.ok(err);
          assert.strictEqual(err.code, 401);

          // Download one.
          RestAPI.Content.downloadPreviewItem(
            contexts.nicolaas.restContext,
            contentObj.id,
            contentObj.latestRevisionId,
            previews.files[0].filename,
            previews.signature,
            (err, body, response) => {
              assert.ok(!err);
              assert.ok(!body); // Nginx streams the actual file body, the app server just returns a 204.
              assert.strictEqual(response.statusCode, 204);
              assert.ok(response.headers['x-accel-redirect']);

              // Make sure that nobody else can see a private item, even if they have the signature.
              RestAPI.Content.downloadPreviewItem(
                contexts.simon.restContext,
                contentObj.id,
                contentObj.latestRevisionId,
                previews.files[0].filename,
                previews.signature,
                (err, body, response) => {
                  assert.strictEqual(err.code, 401);
                  assert.ok(!body);
                  callback();
                }
              );
            }
          );
        }
      );
    });
  });

  /**
   * Test that verifies that when a revision is restored, the previews are properly carried over from the source revision, and are accessible by the user
   */
  it('verify downloading preview of a restored revision', callback => {
    createPreviews((contexts, content, previews) => {
      const firstRevisionId = content.latestRevisionId;

      // Get the previews of the first revision. We will ensure that the restored revision are the same
      RestAPI.Content.getPreviewItems(
        contexts.nicolaas.restContext,
        content.id,
        firstRevisionId,
        (err, firstRevisionPreviews) => {
          assert.ok(!err);

          // Update the file body, creating a new revision
          RestAPI.Content.updateFileBody(contexts.nicolaas.restContext, content.id, getFileStream, (err, content) => {
            assert.ok(!err);

            // Finish processing the previews for the new revision
            RestAPI.Content.setPreviewItems(
              globalAdminOnTenantRestContext,
              content.id,
              content.latestRevisionId,
              'done',
              suitable_files,
              suitable_sizes,
              {},
              {},
              err => {
                assert.ok(!err);

                // Restore to the first revision
                RestAPI.Content.restoreRevision(
                  contexts.nicolaas.restContext,
                  content.id,
                  firstRevisionId,
                  (err, revision3) => {
                    assert.ok(!err);

                    // Get the preview items of the 3rd revision (restored from first), and verify that the model is the same
                    RestAPI.Content.getPreviewItems(
                      contexts.nicolaas.restContext,
                      content.id,
                      revision3.revisionId,
                      (err, thirdRevisionPreviews) => {
                        assert.ok(!err);
                        assert.strictEqual(firstRevisionPreviews.files.length, thirdRevisionPreviews.files.length);

                        // Get the medium picture of the first and third revisions
                        const firstRevisionMediumPicture = _.filter(firstRevisionPreviews.files, file => {
                          return file.size === 'medium';
                        })[0];
                        const thirdRevisionMediumPicture = _.filter(thirdRevisionPreviews.files, file => {
                          return file.size === 'medium';
                        })[0];

                        assert.ok(firstRevisionMediumPicture);
                        assert.ok(thirdRevisionMediumPicture);
                        assert.strictEqual(firstRevisionMediumPicture.filename, thirdRevisionMediumPicture.filename);
                        assert.strictEqual(firstRevisionMediumPicture.uri, thirdRevisionMediumPicture.uri);

                        // Verify that we can download the preview pictures of the new revision
                        RestAPI.Content.downloadPreviewItem(
                          contexts.nicolaas.restContext,
                          content.id,
                          revision3.revisionId,
                          thirdRevisionMediumPicture.filename,
                          thirdRevisionPreviews.signature,
                          (err, body, response) => {
                            assert.ok(!err);
                            assert.strictEqual(response.statusCode, 204);
                            assert.ok(response.headers['x-accel-redirect']);

                            // Nginx streams the file body, so there will be no body to this response here
                            assert.ok(!body);
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
        }
      );
    });
  });

  /**
   * Downloading a preview item that doesn't exist, should result in a 404.
   */
  it('verify download non-existing previews is handled correctly', callback => {
    TestsUtil.generateTestUsers(globalAdminOnTenantRestContext, 1, (err, users) => {
      assert.ok(!err);

      const simon = _.values(users)[0];
      RestAPI.Content.createFile(
        simon.restContext,
        {
          displayName: 'Test Content 2',
          description: 'Test content description 2',
          visibility: PRIVATE,
          file: getFileStream,
          managers: [],
          viewers: [],
          folders: []
        },
        (err, contentObj) => {
          assert.ok(!err);
          assert.ok(contentObj.id);
          assert.strictEqual(contentObj.previews.status, 'pending');

          // Get a list of preview items.
          RestAPI.Content.getPreviewItems(
            simon.restContext,
            contentObj.id,
            contentObj.latestRevisionId,
            (err, previews) => {
              assert.ok(!err);
              assert.strictEqual(previews.files.length, 0);

              // Downloading a preview item that doesn't exist, should result in a 404.
              RestAPI.Content.downloadPreviewItem(
                simon.restContext,
                contentObj.id,
                contentObj.latestRevisionId,
                'does-not-exist.png',
                previews.signature,
                (err, body, response) => {
                  assert.strictEqual(err.code, 404);
                  assert.ok(!body);
                  callback();
                }
              );
            }
          );
        }
      );
    });
  });

  /**
   * Verify that the request parameters of adding preview items are validated.
   */
  it('verify uploading preview parameter validation', callback => {
    TestsUtil.generateTestUsers(globalAdminOnTenantRestContext, 1, (err, users) => {
      const simon = _.values(users)[0];
      assert.ok(!err);

      RestAPI.Content.createFile(
        simon.restContext,
        {
          displayName: 'Test Content',
          description: 'Test content description',
          visibility: PRIVATE,
          file: getFileStream,
          managers: [],
          viewers: [],
          folders: []
        },
        (err, contentObj) => {
          assert.ok(!err);
          assert.ok(contentObj.id);
          assert.strictEqual(contentObj.previews.status, 'pending');

          RestAPI.Content.getRevisions(simon.restContext, contentObj.id, null, 1, (err, revisions) => {
            assert.ok(!err);
            const { revisionId } = revisions.results[0];

            // A valid call as a sanity check.
            RestAPI.Content.setPreviewItems(
              globalAdminOnTenantRestContext,
              contentObj.id,
              revisionId,
              'done',
              {},
              {},
              {},
              {},
              err => {
                assert.ok(!err);

                // Invalid contentId.
                RestAPI.Content.setPreviewItems(
                  globalAdminOnTenantRestContext,
                  'blah',
                  revisionId,
                  'foo',
                  {},
                  {},
                  {},
                  {},
                  err => {
                    assert.strictEqual(err.code, 400);

                    // Bad status parameter.
                    RestAPI.Content.setPreviewItems(
                      globalAdminOnTenantRestContext,
                      contentObj.id,
                      revisionId,
                      'foo',
                      {},
                      {},
                      {},
                      {},
                      err => {
                        assert.strictEqual(err.code, 400);

                        // Non existing piece of content.
                        RestAPI.Content.setPreviewItems(
                          globalAdminOnTenantRestContext,
                          'c:foo:bar',
                          revisionId,
                          'done',
                          {},
                          {},
                          {},
                          {},
                          err => {
                            assert.strictEqual(err.code, 404);

                            // Missing revision
                            RestAPI.Content.setPreviewItems(
                              globalAdminOnTenantRestContext,
                              'c:foo:bar',
                              null,
                              'done',
                              {},
                              {},
                              {},
                              {},
                              err => {
                                assert.strictEqual(err.code, 404);
                                callback();
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
        }
      );
    });
  });

  /**
   * Verify that setting the preview status gets propaged to the content objects.
   */
  it('verify setting preview status', callback => {
    TestsUtil.generateTestUsers(globalAdminOnTenantRestContext, 1, (err, users) => {
      const simon = _.values(users)[0];
      assert.ok(!err);

      RestAPI.Content.createFile(
        simon.restContext,
        {
          displayName: 'Test Content',
          description: 'Test content description',
          visibility: PRIVATE,
          file: getFileStream,
          managers: [],
          viewers: [],
          folders: []
        },
        (err, contentObj) => {
          assert.ok(!err);
          assert.ok(contentObj.id);
          assert.strictEqual(contentObj.previews.status, 'pending');

          RestAPI.Content.getRevisions(globalAdminOnTenantRestContext, contentObj.id, null, 1, (err, revisions) => {
            assert.ok(!err);
            const { revisionId } = revisions.results[0];

            RestAPI.Content.setPreviewItems(
              globalAdminOnTenantRestContext,
              contentObj.id,
              revisionId,
              'ignored',
              {},
              {},
              {},
              {},
              err => {
                assert.ok(!err);

                RestAPI.Content.getContent(simon.restContext, contentObj.id, (err, updatedContentObj) => {
                  assert.ok(!err);
                  assert.strictEqual(updatedContentObj.previews.status, 'ignored');
                  callback();
                });
              }
            );
          });
        }
      );
    });
  });

  /**
   * Verify that only setting the preview status removes older preview items
   */
  it('verify setting preview status removes older preview items', callback => {
    createPreviews((contexts, contentObj, previews) => {
      RestAPI.Content.setPreviewItems(
        globalAdminOnTenantRestContext,
        contentObj.id,
        contentObj.latestRevisionId,
        'error',
        {},
        {},
        {},
        {},
        err => {
          assert.ok(!err);

          // Get a list of preview items,
          // there should be none.
          RestAPI.Content.getPreviewItems(
            contexts.nicolaas.restContext,
            contentObj.id,
            contentObj.latestRevisionId,
            (err, previews) => {
              assert.ok(!err);
              assert.strictEqual(previews.files.length, 0);

              RestAPI.Content.getContent(contexts.nicolaas.restContext, contentObj.id, (err, content) => {
                assert.ok(!err);
                assert.strictEqual(content.previews.total, 0);
                assert.strictEqual(content.previews.status, 'error');
                assert.ok(!content.previews.thumbnailUri);
                assert.ok(!content.previews.thumbnailUrl);
                callback();
              });
            }
          );
        }
      );
    });
  });

  /**
   * Verify that uploading new preview items removes the old ones.
   */
  it('verify uploading new preview items removes older preview items and the thumbnailUrl', callback => {
    createPreviews((contexts, contentObj, previews) => {
      const files = { 'new_file.small.jpg': getFileStream };
      const sizes = { 'new_file.small.jpg': 'small' };
      RestAPI.Content.setPreviewItems(
        globalAdminOnTenantRestContext,
        contentObj.id,
        contentObj.latestRevisionId,
        'done',
        files,
        sizes,
        {},
        {},
        err => {
          assert.ok(!err);

          // Get a list of preview items, there should only be one
          RestAPI.Content.getPreviewItems(
            contexts.nicolaas.restContext,
            contentObj.id,
            contentObj.latestRevisionId,
            (err, previews) => {
              assert.ok(!err);
              assert.strictEqual(previews.files.length, 1);

              RestAPI.Content.getContent(contexts.nicolaas.restContext, contentObj.id, (err, content) => {
                assert.ok(!err);
                assert.strictEqual(content.previews.total, 1);
                assert.ok(!content.previews.thumbnailUri);
                assert.ok(!content.previews.thumbnailUrl);
                assert.ok(!content.previews.smallUri);
                assert.ok(content.previews.smallUrl);
                return callback();
              });
            }
          );
        }
      );
    });
  });

  /**
   * A test that verifies that link updates result in a resetted previews object
   */
  it('verify updating a link resets the previews object', callback => {
    TestsUtil.generateTestUsers(globalAdminOnTenantRestContext, 1, (err, users) => {
      assert.ok(!err);

      const contexts = {};
      const keys = Object.keys(users);
      contexts.nicolaas = users[keys[0]];

      RestAPI.Content.createLink(
        contexts.nicolaas.restContext,
        {
          displayName: 'Test Content 1',
          description: 'Test content description 1',
          visibility: PUBLIC,
          link: 'http://www.oaeproject.org/',
          managers: [],
          viewers: [],
          folders: []
        },
        (err, contentObj) => {
          assert.ok(!err);

          // Verify that a new link results in an empty previews object
          RestAPI.Content.updateContent(
            contexts.nicolaas.restContext,
            contentObj.id,
            { link: 'http://www.google.com' },
            err => {
              assert.ok(!err);
              RestAPI.Content.getContent(contexts.nicolaas.restContext, contentObj.id, (err, contentObj) => {
                assert.ok(!err);
                assert.strictEqual(contentObj.previews.status, 'pending');

                // Verify that an update with the same link doesn't change the previews object
                // First, set the status to done manually so we can verify a no-change on a non-update
                RestAPI.Content.setPreviewItems(
                  globalAdminOnTenantRestContext,
                  contentObj.id,
                  contentObj.latestRevisionId,
                  'done',
                  {},
                  {},
                  {},
                  {},
                  err => {
                    assert.ok(!err);
                    RestAPI.Content.updateContent(
                      contexts.nicolaas.restContext,
                      contentObj.id,
                      { link: 'http://www.google.com' },
                      err => {
                        assert.ok(!err);
                        RestAPI.Content.getContent(contexts.nicolaas.restContext, contentObj.id, (err, contentObj) => {
                          assert.ok(!err);
                          assert.strictEqual(contentObj.previews.status, 'done');
                          return callback();
                        });
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
  });

  /**
   * Verifies that the request parameters when downloading a preview are validated.
   */
  it('verify preview download parameter validation', callback => {
    createPreviews((contexts, contentObj, previews) => {
      // Ensure that the file can be downloaded.
      RestAPI.Content.downloadPreviewItem(
        contexts.nicolaas.restContext,
        contentObj.id,
        contentObj.latestRevisionId,
        previews.files[0].filename,
        previews.signature,
        (err, body, response) => {
          assert.ok(!err);
          assert.strictEqual(response.statusCode, 204);

          // Missing parameters
          RestAPI.Content.downloadPreviewItem(
            contexts.nicolaas.restContext,
            contentObj.id,
            contentObj.latestRevisionId,
            previews.files[0].filename,
            { signature: previews.signature.signature },
            (err, body, response) => {
              assert.strictEqual(err.code, 401);
              assert.ok(!body);

              RestAPI.Content.downloadPreviewItem(
                contexts.nicolaas.restContext,
                contentObj.id,
                contentObj.latestRevisionId,
                previews.files[0].filename,
                { expires: previews.signature.expires },
                (err, body, response) => {
                  assert.strictEqual(err.code, 401);
                  assert.ok(!body);

                  // Wrong signature
                  RestAPI.Content.downloadPreviewItem(
                    contexts.nicolaas.restContext,
                    contentObj.id,
                    contentObj.latestRevisionId,
                    previews.files[0].filename,
                    { signature: 'wrong', expires: previews.signature.expires },
                    (err, body, response) => {
                      assert.ok(err.code, 401);
                      assert.ok(!body);

                      // Malformed IDs
                      RestAPI.Content.downloadPreviewItem(
                        contexts.nicolaas.restContext,
                        'invalid content id',
                        contentObj.latestRevisionId,
                        previews.files[0].filename,
                        previews.signature,
                        (err, body, response) => {
                          assert.strictEqual(err.code, 400);
                          assert.ok(!body);

                          RestAPI.Content.downloadPreviewItem(
                            contexts.nicolaas.restContext,
                            contentObj.id,
                            'invalid revision id',
                            previews.files[0].filename,
                            previews.signature,
                            (err, body, response) => {
                              assert.strictEqual(err.code, 400);
                              assert.ok(!body);
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

  /*!
   * Verifies that the `downloadUrl` can in fact be downloaded
   *
   * @param  {RestContext}    restContext     The RestContext that we should use to download the file
   * @param  {String}         downloadUrl     The signed URL that should be verified
   * @param  {Function}       callback        Standard callback function
   */
  const _verifySignedDownloadUrl = function(restContext, downloadUrl, callback) {
    // Verify we can download it
    const parsedUrl = new URL(downloadUrl, 'http://localhost');
    RestUtil.performRestRequest(
      restContext,
      '/api/download/signed',
      'GET',
      TestsUtil.objectifySearchParams(parsedUrl.searchParams),
      (err, body, response) => {
        assert.ok(!err);
        assert.strictEqual(response.statusCode, 204);
        return callback();
      }
    );
  };

  /**
   * A test that verifies that thumbnail originating from another tenant can be downloaded
   */
  it('verify previews are downloadable from another tenant', callback => {
    // Create a tenant on the localhost tenant. We need to create it on the localhost tenant as that's the only one
    // we can verify the actual downloading of images works during unit tests
    createPreviews((contexts, contentObj, previews) => {
      // Share the item with Bert, who is a user in the Cambridge tenant
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        assert.ok(!err);
        const bert = _.values(users)[0];
        RestAPI.Content.shareContent(contexts.nicolaas.restContext, contentObj.id, [bert.user.id], err => {
          assert.ok(!err);

          // Bert should receive an activity that Nicolaas shared a piece of content with him
          setTimeout(
            ActivityTestsUtil.collectAndGetActivityStream,
            5000,
            bert.restContext,
            bert.user.id,
            null,
            (err, activityStream) => {
              assert.ok(!err);

              const activity = _.find(activityStream.items, activity => {
                return activity.object['oae:id'] === contentObj.id;
              });
              assert.ok(activity);

              // Verify the activity
              _verifySignedDownloadUrl(bert.restContext, activity.object.image.url, () => {
                // Verify the thumbnailUrl is on the content profile, but not the back-end uri
                RestAPI.Content.getContent(bert.restContext, contentObj.id, (err, contentObjOnCamTenant) => {
                  assert.ok(!err);
                  assert.ok(!contentObjOnCamTenant.previews.thumbnailUri);
                  assert.ok(contentObjOnCamTenant.previews.thumbnailUrl);

                  _verifySignedDownloadUrl(bert.restContext, contentObjOnCamTenant.previews.thumbnailUrl, () => {
                    // Verify the thumbnailUrl in search results
                    const randomText = TestsUtil.generateRandomText(5);
                    RestAPI.Content.updateContent(
                      contexts.nicolaas.restContext,
                      contentObj.id,
                      { displayName: randomText },
                      (err, updatedContentObj) => {
                        assert.ok(!err);
                        SearchTestsUtil.searchAll(
                          bert.restContext,
                          'general',
                          null,
                          { resourceTypes: 'content', q: randomText },
                          (err, results) => {
                            assert.ok(!err);
                            const doc = _.find(results.results, doc => {
                              return doc.id === contentObj.id;
                            });
                            assert.ok(doc);

                            return _verifySignedDownloadUrl(bert.restContext, doc.thumbnailUrl, callback);
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

  /**
   * A test that verifies whether or not thumbnail URLs are present on a revision object
   */
  it('verify thumbnail and medium URLs are present on the revision object', callback => {
    createPreviews((contexts, content, previews) => {
      // Verify a list of revisions
      RestAPI.Content.getRevisions(contexts.nicolaas.restContext, content.id, null, null, (err, revisions) => {
        assert.ok(!err);
        assert.ok(!revisions.results[0].thumbnailUri);
        assert.ok(revisions.results[0].thumbnailUrl);
        assert.ok(!revisions.results[0].mediumUri);
        assert.ok(revisions.results[0].mediumUrl);

        _verifySignedDownloadUrl(contexts.nicolaas.restContext, revisions.results[0].thumbnailUrl, () => {
          _verifySignedDownloadUrl(contexts.nicolaas.restContext, revisions.results[0].mediumUrl, () => {
            // Verify a single revision
            RestAPI.Content.getRevision(
              contexts.nicolaas.restContext,
              content.id,
              revisions.results[0].revisionId,
              (err, revision) => {
                assert.ok(!err);
                assert.ok(!revision.thumbnailUri);
                assert.ok(revision.thumbnailUrl);
                assert.ok(!revision.mediumUri);
                assert.ok(revision.mediumUrl);

                // Verify the URLs can resolve to a successful response
                _verifySignedDownloadUrl(contexts.nicolaas.restContext, revision.thumbnailUrl, () => {
                  _verifySignedDownloadUrl(contexts.nicolaas.restContext, revision.mediumUrl, () => {
                    // Restore the revision
                    RestAPI.Content.restoreRevision(
                      contexts.nicolaas.restContext,
                      content.id,
                      revisions.results[0].revisionId,
                      (err, restoredRevision) => {
                        assert.ok(!err);

                        // Make sure the restored revision contains all the image urls and not the back-end uris
                        assert.ok(restoredRevision);
                        assert.ok(!restoredRevision.thumbnailUri);
                        assert.ok(restoredRevision.thumbnailUrl);
                        assert.ok(!restoredRevision.mediumUri);
                        assert.ok(restoredRevision.mediumUrl);
                        assert.strictEqual(restoredRevision.previews.status, 'done');
                        return callback();
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

  /**
   * Test that verifies that when a revision is restored, the content item is reindexed
   */
  it('verify restoring a revision results in an updated thumbnail url for the search document', callback => {
    createPreviews((contexts, contentObj, previews) => {
      RestAPI.Content.updateFileBody(
        contexts.nicolaas.restContext,
        contentObj.id,
        getOAELogoStream,
        (err, contentObj) => {
          assert.ok(!err);

          // Set the preview items for the second revision
          RestAPI.Content.setPreviewItems(
            globalAdminOnTenantRestContext,
            contentObj.id,
            contentObj.latestRevisionId,
            'done',
            suitable_files,
            suitable_sizes,
            {},
            {},
            err => {
              assert.ok(!err);

              // Do a search and assert that we have a thumbnail
              SearchTestsUtil.searchAll(
                contexts.nicolaas.restContext,
                'general',
                null,
                { resourceTypes: 'content', q: contentObj.description },
                (err, results) => {
                  assert.ok(!err);
                  const contentDocA = _.find(results.results, result => {
                    return result.id === contentObj.id;
                  });
                  assert.ok(contentDocA);
                  assert.ok(contentDocA.thumbnailUrl);

                  // Get the revisions so we can restore the first one
                  RestAPI.Content.getRevisions(
                    contexts.nicolaas.restContext,
                    contentObj.id,
                    null,
                    null,
                    (err, revisions) => {
                      assert.ok(!err);
                      RestAPI.Content.restoreRevision(
                        contexts.nicolaas.restContext,
                        contentObj.id,
                        revisions.results[1].revisionId,
                        (err, revisionObj) => {
                          assert.ok(!err);

                          // Do a search and assert that a different thumbnail URL is returend
                          SearchTestsUtil.searchAll(
                            contexts.nicolaas.restContext,
                            'general',
                            null,
                            { resourceTypes: 'content', q: contentObj.description },
                            (err, results) => {
                              assert.ok(!err);
                              const contentDocB = _.find(results.results, result => {
                                return result.id === contentObj.id;
                              });
                              assert.ok(contentDocB);
                              assert.ok(contentDocB.thumbnailUrl);
                              assert.notStrictEqual(contentDocA.thumbnailUrl, contentDocB.thumbnailUrl);
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
