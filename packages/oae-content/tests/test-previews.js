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
import { flush } from 'oae-util/lib/redis';

import { find, filter, equals, propSatisfies, pathSatisfies } from 'ramda';

import * as ActivityTestsUtil from 'oae-activity/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as RestUtil from 'oae-rest/lib/util';
import * as SearchTestsUtil from 'oae-search/lib/test/util';
import * as TestsUtil from 'oae-tests';

const { searchAll } = SearchTestsUtil;
const {
  generateTestUsers,
  generateRandomText,
  createGlobalAdminRestContext,
  createTenantRestContext,
  createTenantAdminRestContext,
  objectifySearchParams
} = TestsUtil;
const { loginOnTenant } = RestAPI.Admin;
const { getMe } = RestAPI.User;
const {
  restoreRevision,
  shareContent,
  createLink,
  updateContent,
  getRevision,
  getRevisions,
  createFile,
  updateFileBody,
  downloadPreviewItem,
  getContent,
  getPreviewItems,
  setPreviewItems
} = RestAPI.Content;

const MEDIUM = 'medium';
const SMALL = 'small';
const PENDING = 'pending';
const IGNORED = 'ignored';
const ERROR = 'error';
const DONE = 'done';
const GENERAL = 'general';
const CONTENT = 'content';

const PUBLIC = 'public';
const PRIVATE = 'private';

const NO_FOLDERS = [];
const NO_MANAGERS = [];
const NO_VIEWERS = [];

describe('File previews', () => {
  // Rest context that can be used every time we need to make a request as a global admin
  let asGlobalAdmin = null;
  // Rest context that can be used every time we need to make a request as a global admin on the created tenant
  let asGlobalAdminOnTenant = null;
  // Rest context that can be used every time we need to make a request as an anonymous user on the created tenant
  let asCambridgeAnonymousUser = null;
  // Rest context that can be used every time we need to make a request as a tenant admin on the cambridge tenant
  let asCambridgeTenantAdmin = null;

  let suitable_files = null;
  let suitable_sizes = null;

  /**
   * Fill up the contexts
   */
  before(callback => {
    // Fill up global admin rest context
    asGlobalAdmin = createGlobalAdminRestContext();
    // Fill up the anonymous context
    asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.localhost.host);
    // Cambridge tenant admin context
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // An object that adheres to the setPreviewItems.files parameter.
    suitable_files = {
      'file.small.jpg': getFileStream,
      'file.medium.jpg': getOAELogoStream,
      'thumbnail.png': getFileStream
    };
    suitable_sizes = {
      'file.small.jpg': SMALL,
      'file.medium.jpg': MEDIUM,
      'thumbnail.png': 'thumbnail'
    };

    // Login on the camtest tenant
    loginOnTenant(asGlobalAdmin, 'localhost', null, (err, ctx) => {
      assert.notExists(err);
      asGlobalAdminOnTenant = ctx;

      getMe(asGlobalAdminOnTenant, (err, user) => {
        assert.notExists(err);
        assert.isNotOk(user.anon);
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
  const getFileStream = () => fs.createReadStream(path.join(__dirname, '/data/oae-video.png'));

  /**
   * Utility method that returns a stream that points to the OAE logo.
   *
   * @return {Stream}     A stream that points to the OAE logo that can be uploaded.
   */
  const getOAELogoStream = () => fs.createReadStream(path.join(__dirname, '/data/oae-logo.png'));

  /**
   * Creates a file and adds 2 preview items
   *
   * @param  {Function}    callback                Standard callback function
   * @param  {Object}      callback.contexts       contexts object.
   * @param  {Object}      callback.content        Content object as returned by `RestAPI.ContentcreateFile`.
   * @param  {Object}      callback.previews       Previews object as returned by `RestAPI.ContentgetPreviewItems`.
   */
  const createPreviews = callback => {
    generateTestUsers(asGlobalAdminOnTenant, 2, (err, users) => {
      assert.notExists(err);

      const { 0: homer, 1: marge } = users;
      const asHomer = homer.restContext;
      const contexts = { homer, marge };

      createFile(
        asHomer,
        {
          displayName: 'Test Content 2',
          description: 'Test content description 2',
          visibility: PRIVATE,
          file: getFileStream,
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (err, contentObj) => {
          assert.notExists(err);
          assert.ok(contentObj.id);
          assert.strictEqual(contentObj.previews.status, PENDING);

          // Add some preview items.
          setPreviewItems(
            asGlobalAdminOnTenant,
            contentObj.id,
            contentObj.latestRevisionId,
            DONE,
            suitable_files,
            suitable_sizes,
            {},
            {},
            err => {
              assert.notExists(err);

              // Get a list of preview items.
              getPreviewItems(asHomer, contentObj.id, contentObj.latestRevisionId, (err, previews) => {
                assert.notExists(err);
                assert.lengthOf(previews.files, 2);

                // Ensure that the thumbnail and status parameters are set
                getContent(asHomer, contentObj.id, (err, updatedContent) => {
                  assert.notExists(err);
                  assert.isNotOk(updatedContent.previews.thumbnailUri);
                  assert.ok(updatedContent.previews.thumbnailUrl);
                  assert.strictEqual(updatedContent.previews.status, DONE);
                  assert.isNotOk(updatedContent.previews.smallUri);
                  assert.ok(updatedContent.previews.smallUrl);
                  assert.isNotOk(updatedContent.previews.mediumUri);
                  assert.ok(updatedContent.previews.mediumUrl);

                  return callback(contexts, updatedContent, previews);
                });
              });
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
      const { homer, marge } = contexts;
      const asHomer = homer.restContext;
      const asMarge = marge.restContext;

      // Only global admins should be allowed to create previews.
      setPreviewItems(
        asCambridgeAnonymousUser,
        contentObj.id,
        contentObj.latestRevisionId,
        DONE,
        suitable_files,
        suitable_sizes,
        {},
        {},
        err => {
          assert.ok(err);
          assert.strictEqual(err.code, 401);

          // Download one.
          downloadPreviewItem(
            asHomer,
            contentObj.id,
            contentObj.latestRevisionId,
            previews.files[0].filename,
            previews.signature,
            (err, body, response) => {
              assert.notExists(err);
              assert.isNotOk(body); // Nginx streams the actual file body, the app server just returns a 204.
              assert.strictEqual(response.statusCode, 204);
              assert.ok(response.headers['x-accel-redirect']);

              // Make sure that nobody else can see a private item, even if they have the signature.
              downloadPreviewItem(
                asMarge,
                contentObj.id,
                contentObj.latestRevisionId,
                previews.files[0].filename,
                previews.signature,
                (err, body /* , response */) => {
                  assert.strictEqual(err.code, 401);
                  assert.isNotOk(body);

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
    createPreviews((contexts, content /* , previews */) => {
      const { homer } = contexts;
      const asHomer = homer.restContext;

      const firstRevisionId = content.latestRevisionId;

      // Get the previews of the first revision. We will ensure that the restored revision are the same
      getPreviewItems(asHomer, content.id, firstRevisionId, (err, firstRevisionPreviews) => {
        assert.notExists(err);

        // Update the file body, creating a new revision
        updateFileBody(asHomer, content.id, getFileStream, (err, content) => {
          assert.notExists(err);

          // Finish processing the previews for the new revision
          setPreviewItems(
            asGlobalAdminOnTenant,
            content.id,
            content.latestRevisionId,
            DONE,
            suitable_files,
            suitable_sizes,
            {},
            {},
            err => {
              assert.notExists(err);

              // Restore to the first revision
              restoreRevision(asHomer, content.id, firstRevisionId, (err, revision3) => {
                assert.notExists(err);

                // Get the preview items of the 3rd revision (restored from first), and verify that the model is the same
                getPreviewItems(asHomer, content.id, revision3.revisionId, (err, thirdRevisionPreviews) => {
                  assert.notExists(err);
                  assert.strictEqual(firstRevisionPreviews.files.length, thirdRevisionPreviews.files.length);

                  // Get the medium picture of the first and third revisions
                  const firstRevisionMediumPicture = filter(
                    propSatisfies(equals(MEDIUM), 'size'),
                    firstRevisionPreviews.files
                  )[0];
                  const thirdRevisionMediumPicture = filter(
                    propSatisfies(equals(MEDIUM), 'size'),
                    thirdRevisionPreviews.files
                  )[0];

                  assert.ok(firstRevisionMediumPicture);
                  assert.ok(thirdRevisionMediumPicture);
                  assert.strictEqual(firstRevisionMediumPicture.filename, thirdRevisionMediumPicture.filename);
                  assert.strictEqual(firstRevisionMediumPicture.uri, thirdRevisionMediumPicture.uri);

                  // Verify that we can download the preview pictures of the new revision
                  downloadPreviewItem(
                    asHomer,
                    content.id,
                    revision3.revisionId,
                    thirdRevisionMediumPicture.filename,
                    thirdRevisionPreviews.signature,
                    (err, body, response) => {
                      assert.notExists(err);
                      assert.strictEqual(response.statusCode, 204);
                      assert.ok(response.headers['x-accel-redirect']);

                      // Nginx streams the file body, so there will be no body to this response here
                      assert.isNotOk(body);

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

  /**
   * Downloading a preview item that doesn't exist, should result in a 404.
   */
  it('verify download non-existing previews is handled correctly', callback => {
    generateTestUsers(asGlobalAdminOnTenant, 1, (err, users) => {
      assert.notExists(err);

      const { 0: marge } = users;
      const asMarge = marge.restContext;

      createFile(
        asMarge,
        {
          displayName: 'Test Content 2',
          description: 'Test content description 2',
          visibility: PRIVATE,
          file: getFileStream,
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (err, contentObj) => {
          assert.notExists(err);
          assert.ok(contentObj.id);
          assert.strictEqual(contentObj.previews.status, PENDING);

          // Get a list of preview items.
          getPreviewItems(asMarge, contentObj.id, contentObj.latestRevisionId, (err, previews) => {
            assert.notExists(err);
            assert.isEmpty(previews.files, 0);

            // Downloading a preview item that doesn't exist, should result in a 404.
            downloadPreviewItem(
              asMarge,
              contentObj.id,
              contentObj.latestRevisionId,
              'does-not-exist.png',
              previews.signature,
              (err, body /* , response */) => {
                assert.strictEqual(err.code, 404);
                assert.isNotOk(body);

                callback();
              }
            );
          });
        }
      );
    });
  });

  /**
   * Verify that the request parameters of adding preview items are validated.
   */
  it('verify uploading preview parameter validation', callback => {
    generateTestUsers(asGlobalAdminOnTenant, 1, (err, users) => {
      assert.notExists(err);

      const { 0: marge } = users;
      const asMarge = marge.restContext;

      createFile(
        asMarge,
        {
          displayName: 'Test Content',
          description: 'Test content description',
          visibility: PRIVATE,
          file: getFileStream,
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (err, contentObj) => {
          assert.notExists(err);
          assert.ok(contentObj.id);
          assert.strictEqual(contentObj.previews.status, PENDING);

          getRevisions(asMarge, contentObj.id, null, 1, (err, revisions) => {
            assert.notExists(err);
            const { revisionId } = revisions.results[0];

            // A valid call as a sanity check.
            setPreviewItems(asGlobalAdminOnTenant, contentObj.id, revisionId, DONE, {}, {}, {}, {}, err => {
              assert.notExists(err);

              // Invalid contentId.
              setPreviewItems(asGlobalAdminOnTenant, 'blah', revisionId, 'foo', {}, {}, {}, {}, err => {
                assert.strictEqual(err.code, 400);

                // Bad status parameter.
                setPreviewItems(asGlobalAdminOnTenant, contentObj.id, revisionId, 'foo', {}, {}, {}, {}, err => {
                  assert.strictEqual(err.code, 400);

                  // Non existing piece of content.
                  setPreviewItems(asGlobalAdminOnTenant, 'c:foo:bar', revisionId, DONE, {}, {}, {}, {}, err => {
                    assert.strictEqual(err.code, 404);

                    // Missing revision
                    setPreviewItems(asGlobalAdminOnTenant, 'c:foo:bar', null, DONE, {}, {}, {}, {}, err => {
                      assert.strictEqual(err.code, 404);

                      callback();
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
   * Verify that setting the preview status gets propaged to the content objects.
   */
  it('verify setting preview status', callback => {
    generateTestUsers(asGlobalAdminOnTenant, 1, (err, users) => {
      assert.notExists(err);

      const { 0: lisa } = users;
      const asLisa = lisa.restContext;

      createFile(
        asLisa,
        {
          displayName: 'Test Content',
          description: 'Test content description',
          visibility: PRIVATE,
          file: getFileStream,
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (err, contentObj) => {
          assert.notExists(err);
          assert.ok(contentObj.id);
          assert.strictEqual(contentObj.previews.status, PENDING);

          getRevisions(asGlobalAdminOnTenant, contentObj.id, null, 1, (err, revisions) => {
            assert.notExists(err);
            const { revisionId } = revisions.results[0];

            setPreviewItems(asGlobalAdminOnTenant, contentObj.id, revisionId, IGNORED, {}, {}, {}, {}, err => {
              assert.notExists(err);

              getContent(asLisa, contentObj.id, (err, updatedContentObj) => {
                assert.notExists(err);
                assert.strictEqual(updatedContentObj.previews.status, IGNORED);

                callback();
              });
            });
          });
        }
      );
    });
  });

  /**
   * Verify that only setting the preview status removes older preview items
   */
  it('verify setting preview status removes older preview items', callback => {
    createPreviews((contexts, contentObj /* , previews */) => {
      const { homer } = contexts;
      const asHomer = homer.restContext;

      setPreviewItems(asGlobalAdminOnTenant, contentObj.id, contentObj.latestRevisionId, ERROR, {}, {}, {}, {}, err => {
        assert.notExists(err);

        // Get a list of preview items, there should be none.
        getPreviewItems(asHomer, contentObj.id, contentObj.latestRevisionId, (err, previews) => {
          assert.notExists(err);
          assert.isEmpty(previews.files);

          getContent(asHomer, contentObj.id, (err, content) => {
            assert.notExists(err);
            assert.strictEqual(content.previews.total, 0);
            assert.strictEqual(content.previews.status, ERROR);
            assert.isNotOk(content.previews.thumbnailUri);
            assert.isNotOk(content.previews.thumbnailUrl);

            callback();
          });
        });
      });
    });
  });

  /**
   * Verify that uploading new preview items removes the old ones.
   */
  it('verify uploading new preview items removes older preview items and the thumbnailUrl', callback => {
    createPreviews((contexts, contentObj /* , previews */) => {
      const { homer } = contexts;
      const asHomer = homer.restContext;

      const files = { 'new_file.small.jpg': getFileStream };
      const sizes = { 'new_file.small.jpg': SMALL };

      setPreviewItems(
        asGlobalAdminOnTenant,
        contentObj.id,
        contentObj.latestRevisionId,
        DONE,
        files,
        sizes,
        {},
        {},
        err => {
          assert.notExists(err);

          // Get a list of preview items, there should only be one
          getPreviewItems(asHomer, contentObj.id, contentObj.latestRevisionId, (err, previews) => {
            assert.notExists(err);
            assert.lengthOf(previews.files, 1);

            getContent(asHomer, contentObj.id, (err, content) => {
              assert.notExists(err);
              assert.strictEqual(content.previews.total, 1);
              assert.isNotOk(content.previews.thumbnailUri);
              assert.isNotOk(content.previews.thumbnailUrl);
              assert.isNotOk(content.previews.smallUri);
              assert.ok(content.previews.smallUrl);

              return callback();
            });
          });
        }
      );
    });
  });

  /**
   * A test that verifies that link updates result in a resetted previews object
   */
  it('verify updating a link resets the previews object', callback => {
    generateTestUsers(asGlobalAdminOnTenant, 1, (err, users) => {
      assert.notExists(err);

      const { 0: homer } = users;
      const asHomer = homer.restContext;

      createLink(
        asHomer,
        {
          displayName: 'Test Content 1',
          description: 'Test content description 1',
          visibility: PUBLIC,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (err, contentObj) => {
          assert.notExists(err);

          // Verify that a new link results in an empty previews object
          updateContent(asHomer, contentObj.id, { link: 'http://www.google.com' }, err => {
            assert.notExists(err);
            getContent(asHomer, contentObj.id, (err, contentObj) => {
              assert.notExists(err);
              assert.strictEqual(contentObj.previews.status, PENDING);

              /**
               * Verify that an update with the same link doesn't change the previews object
               * First, set the status to done manually so we can verify a no-change on a non-update
               */
              setPreviewItems(
                asGlobalAdminOnTenant,
                contentObj.id,
                contentObj.latestRevisionId,
                DONE,
                {},
                {},
                {},
                {},
                err => {
                  assert.notExists(err);
                  updateContent(asHomer, contentObj.id, { link: 'http://www.google.com' }, err => {
                    assert.notExists(err);

                    getContent(asHomer, contentObj.id, (err, contentObj) => {
                      assert.notExists(err);
                      assert.strictEqual(contentObj.previews.status, DONE);

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

  /**
   * Verifies that the request parameters when downloading a preview are validated.
   */
  it('verify preview download parameter validation', callback => {
    createPreviews((contexts, contentObj, previews) => {
      const { homer } = contexts;
      const asHomer = homer.restContext;

      // Ensure that the file can be downloaded.
      downloadPreviewItem(
        asHomer,
        contentObj.id,
        contentObj.latestRevisionId,
        previews.files[0].filename,
        previews.signature,
        (err, body, response) => {
          assert.notExists(err);
          assert.strictEqual(response.statusCode, 204);

          // Missing parameters
          downloadPreviewItem(
            asHomer,
            contentObj.id,
            contentObj.latestRevisionId,
            previews.files[0].filename,
            { signature: previews.signature.signature },
            (err, body /* , response */) => {
              assert.strictEqual(err.code, 401);
              assert.isNotOk(body);

              downloadPreviewItem(
                asHomer,
                contentObj.id,
                contentObj.latestRevisionId,
                previews.files[0].filename,
                { expires: previews.signature.expires },
                (err, body /* , response */) => {
                  assert.strictEqual(err.code, 401);
                  assert.isNotOk(body);

                  // Wrong signature
                  downloadPreviewItem(
                    asHomer,
                    contentObj.id,
                    contentObj.latestRevisionId,
                    previews.files[0].filename,
                    { signature: 'wrong', expires: previews.signature.expires },
                    (err, body /* , response */) => {
                      assert.ok(err.code, 401);
                      assert.isNotOk(body);

                      // Malformed IDs
                      downloadPreviewItem(
                        asHomer,
                        'invalid content id',
                        contentObj.latestRevisionId,
                        previews.files[0].filename,
                        previews.signature,
                        (err, body /* , response */) => {
                          assert.strictEqual(err.code, 400);
                          assert.isNotOk(body);

                          downloadPreviewItem(
                            asHomer,
                            contentObj.id,
                            'invalid revision id',
                            previews.files[0].filename,
                            previews.signature,
                            (err, body /* , response */) => {
                              assert.strictEqual(err.code, 400);
                              assert.isNotOk(body);

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
      objectifySearchParams(parsedUrl.searchParams),
      (err, body, response) => {
        assert.notExists(err);
        assert.strictEqual(response.statusCode, 204);

        return callback();
      }
    );
  };

  /**
   * A test that verifies that thumbnail originating from another tenant can be downloaded
   */
  it('verify previews are downloadable from another tenant', callback => {
    /**
     * Create a tenant on the localhost tenant. We need to create it on the localhost tenant
     * as that's the only one we can verify the actual downloading of images works during unit tests
     */
    createPreviews((contexts, contentObj /* , previews */) => {
      const { homer } = contexts;
      const asHomer = homer.restContext;

      // Share the item with Lisa, who is a user in the Cambridge tenant
      generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
        assert.notExists(err);

        const { 0: lisa } = users;
        const asLisa = lisa.restContext;

        shareContent(asHomer, contentObj.id, [lisa.user.id], err => {
          assert.notExists(err);

          // Lisa should receive an activity that Homer shared a piece of content with him
          setTimeout(
            ActivityTestsUtil.collectAndGetActivityStream,
            2000,
            asLisa,
            lisa.user.id,
            null,
            (err, activityStream) => {
              assert.notExists(err);

              const activity = find(pathSatisfies(equals(contentObj.id), ['object', 'oae:id']), activityStream.items);
              assert.ok(activity);

              // Verify the activity
              _verifySignedDownloadUrl(asLisa, activity.object.image.url, () => {
                // Verify the thumbnailUrl is on the content profile, but not the back-end uri
                getContent(asLisa, contentObj.id, (err, contentObjOnCamTenant) => {
                  assert.notExists(err);
                  assert.isNotOk(contentObjOnCamTenant.previews.thumbnailUri);
                  assert.ok(contentObjOnCamTenant.previews.thumbnailUrl);

                  _verifySignedDownloadUrl(asLisa, contentObjOnCamTenant.previews.thumbnailUrl, () => {
                    // Verify the thumbnailUrl in search results
                    const randomText = generateRandomText(5);
                    updateContent(asHomer, contentObj.id, { displayName: randomText }, (
                      err /* , updatedContentObj */
                    ) => {
                      assert.notExists(err);

                      searchAll(asLisa, GENERAL, null, { resourceTypes: CONTENT, q: randomText }, (err, results) => {
                        assert.notExists(err);
                        const doc = find(propSatisfies(equals(contentObj.id), 'id'), results.results);
                        assert.ok(doc);

                        return _verifySignedDownloadUrl(asLisa, doc.thumbnailUrl, callback);
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

  /**
   * A test that verifies whether or not thumbnail URLs are present on a revision object
   */
  it('verify thumbnail and medium URLs are present on the revision object', callback => {
    createPreviews((contexts, content /* , previews */) => {
      const { homer } = contexts;
      const asHomer = homer.restContext;

      // Verify a list of revisions
      getRevisions(asHomer, content.id, null, null, (err, revisions) => {
        assert.notExists(err);
        assert.isNotOk(revisions.results[0].thumbnailUri);
        assert.ok(revisions.results[0].thumbnailUrl);
        assert.isNotOk(revisions.results[0].mediumUri);
        assert.ok(revisions.results[0].mediumUrl);

        _verifySignedDownloadUrl(asHomer, revisions.results[0].thumbnailUrl, () => {
          _verifySignedDownloadUrl(asHomer, revisions.results[0].mediumUrl, () => {
            // Verify a single revision
            getRevision(asHomer, content.id, revisions.results[0].revisionId, (err, revision) => {
              assert.notExists(err);
              assert.isNotOk(revision.thumbnailUri);
              assert.ok(revision.thumbnailUrl);
              assert.isNotOk(revision.mediumUri);
              assert.ok(revision.mediumUrl);

              // Verify the URLs can resolve to a successful response
              _verifySignedDownloadUrl(asHomer, revision.thumbnailUrl, () => {
                _verifySignedDownloadUrl(asHomer, revision.mediumUrl, () => {
                  // Restore the revision
                  restoreRevision(asHomer, content.id, revisions.results[0].revisionId, (err, restoredRevision) => {
                    assert.notExists(err);

                    // Make sure the restored revision contains all the image urls and not the back-end uris
                    assert.ok(restoredRevision);
                    assert.isNotOk(restoredRevision.thumbnailUri);
                    assert.ok(restoredRevision.thumbnailUrl);
                    assert.isNotOk(restoredRevision.mediumUri);
                    assert.ok(restoredRevision.mediumUrl);
                    assert.strictEqual(restoredRevision.previews.status, DONE);

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

  /**
   * Test that verifies that when a revision is restored, the content item is reindexed
   */
  it('verify restoring a revision results in an updated thumbnail url for the search document', callback => {
    createPreviews((contexts, contentObj /* , previews */) => {
      const { homer } = contexts;
      const asHomer = homer.restContext;

      updateFileBody(asHomer, contentObj.id, getOAELogoStream, (err, contentObj) => {
        assert.notExists(err);

        // Set the preview items for the second revision
        setPreviewItems(
          asGlobalAdminOnTenant,
          contentObj.id,
          contentObj.latestRevisionId,
          DONE,
          suitable_files,
          suitable_sizes,
          {},
          {},
          err => {
            assert.notExists(err);

            // Do a search and assert that we have a thumbnail
            searchAll(asHomer, GENERAL, null, { resourceTypes: CONTENT, q: contentObj.description }, (err, results) => {
              assert.notExists(err);
              const contentDocA = find(propSatisfies(equals(contentObj.id), 'id'), results.results);
              assert.ok(contentDocA);
              assert.ok(contentDocA.thumbnailUrl);

              // Get the revisions so we can restore the first one
              getRevisions(asHomer, contentObj.id, null, null, (err, revisions) => {
                assert.notExists(err);
                restoreRevision(asHomer, contentObj.id, revisions.results[1].revisionId, (err /* , revisionObj */) => {
                  assert.notExists(err);

                  // Do a search and assert that a different thumbnail URL is returend
                  searchAll(
                    asHomer,
                    GENERAL,
                    null,
                    { resourceTypes: CONTENT, q: contentObj.description },
                    (err, results) => {
                      assert.notExists(err);
                      const contentDocB = find(propSatisfies(equals(contentObj.id), 'id'), results.results);
                      assert.ok(contentDocB);
                      assert.ok(contentDocB.thumbnailUrl);
                      assert.notStrictEqual(contentDocA.thumbnailUrl, contentDocB.thumbnailUrl);

                      return callback();
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
