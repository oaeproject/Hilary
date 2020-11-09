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
import fs from 'fs';
import path from 'path';

import * as Cassandra from 'oae-util/lib/cassandra';
import * as ConfigTestUtil from 'oae-config/lib/test/util';
import * as ElasticSearch from 'oae-search/lib/internal/elasticsearch';
import * as MQTestUtil from 'oae-util/lib/test/mq-util';
import * as PreviewAPI from 'oae-preview-processor/lib/api';
import PreviewConstants from 'oae-preview-processor/lib/constants';
import * as PreviewTestUtil from 'oae-preview-processor/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as SearchAPI from 'oae-search';
import * as SearchTestsUtil from 'oae-search/lib/test/util';
import * as TestsUtil from 'oae-tests';
import { not, propSatisfies, equals, find } from 'ramda';

const GENERAL = 'general';
const RESOURCE = 'resource';
const PUBLIC = 'public';
const DONE = 'done';
const ADMIN = 'admin';
const LOCAL = 'local';
const CONTENT = 'content';
const NO_VIEWERS = [];
const NO_MANAGERS = [];
const NO_FOLDERS = [];

const { postIndexTask } = SearchAPI;
const { runQuery } = Cassandra;
const { deleteAll, reindexAll, searchAll } = SearchTestsUtil;
const { whenTasksEmpty } = MQTestUtil;
const { purgePreviewsQueue, purgeRegeneratePreviewsQueue, purgeFoldersPreviewsQueue } = PreviewTestUtil;
const { generateTestUsers, generateTestUserId, createTenantAdminRestContext, createGlobalAdminRestContext } = TestsUtil;
const { createLink, createFile, getContent } = RestAPI.Content;
const { updateConfigAndWait } = ConfigTestUtil;

describe('Search', () => {
  // REST contexts we can use to do REST requests
  let asCambridgeTenantAdmin = null;
  let asGlobalAdminOnLocalhost = null;
  let asGlobalAdmin = null;

  before(callback => {
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    asGlobalAdminOnLocalhost = createTenantAdminRestContext(global.oaeTests.tenants.localhost.host);
    asGlobalAdmin = createGlobalAdminRestContext();
    return callback();
  });

  after(callback => {
    PreviewAPI.disable(err => {
      assert.notExists(err);

      updateConfigAndWait(asGlobalAdmin, ADMIN, { 'oae-content/storage/backend': LOCAL }, err => {
        assert.notExists(err);
        return callback();
      });
    });
  });

  /**
   * Purge the preview processor queue and enable the Preview Processor
   *
   * @param  {Function}   callback    Standard callback function
   */
  const _purgeAndEnable = callback => {
    // Purge anything that is hanging around in the preview processing queues
    purgePreviewsQueue(() => {
      purgeRegeneratePreviewsQueue(() => {
        purgeFoldersPreviewsQueue(() => {
          // Enable the Preview Processor
          PreviewAPI.enable(err => {
            assert.notExists(err);

            return callback();
          });
        });
      });
    });
  };

  /*!
   * Get the document with the specified id from the search results.
   *
   * @param  {SearchResult}  results     The search results object
   * @param  {String}        docId       The id of the document to search
   * @return {Object}                    The search document. `null` if it didn't exist
   */
  const _findDoc = (results, docId) => find(propSatisfies(equals(docId), 'id'), results.results);

  /*!
   * Creates a file and waits till it has been preview processed.
   *
   * @param  {Stream}      stream     The stream that points to the file that should be uploaded.
   * @param  {Function}    callback   Standard callback method that gets called when the file has previews associated to it.
   */
  const _createContentAndWait = (stream, callback) => {
    // When the queue is empty, we create a piece of content for which we can generate preview items.
    whenTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
      whenTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS_PROCESSING, () => {
        generateTestUsers(asGlobalAdminOnLocalhost, 1, (err, response) => {
          assert.notExists(err);

          const { 0: user } = response;
          const asUser = user.restContext;

          createFile(
            asUser,
            {
              displayName: 'Test Content 1',
              description: 'Test content description 1',
              visibility: PUBLIC,
              file: stream,
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (err, contentObj) => {
              assert.notExists(err);

              // Wait till the PP items have been generated
              whenTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
                whenTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS_PROCESSING, () => {
                  // Ensure the preview items are there
                  getContent(asUser, contentObj.id, (err, updatedContent) => {
                    assert.notExists(err);
                    assert.ok(updatedContent.previews);
                    assert.strictEqual(updatedContent.previews.status, DONE);
                    assert.strictEqual(updatedContent.previews.pageCount, 1);

                    return callback(user, updatedContent);
                  });
                });
              });
            }
          );
        });
      });
    });
  };

  describe('Indexing', () => {
    /**
     * Test that verifies when a content item is indexed with just the content id, it still indexes the content
     * item.
     */
    it('verify indexing without full content item', callback => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
        assert.notExists(err);

        const { 0: user } = users;
        const asUser = user.restContext;

        createLink(
          asUser,
          {
            displayName: 'test-search index-without-full-content-item',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (err, link) => {
            assert.notExists(err);

            // Verify the content item exists
            searchAll(
              asUser,
              GENERAL,
              null,
              { resourceTypes: CONTENT, q: 'index-without-full-content-item' },
              (err, results) => {
                assert.notExists(err);
                const contentDoc = _findDoc(results, link.id);
                assert.ok(contentDoc);

                // Delete the content item from the index under the hood, this is to avoid the automatic index events invalidating the test
                ElasticSearch.del(RESOURCE, link.id, err => {
                  assert.notExists(err);

                  // Verify the content item no longer exists
                  searchAll(
                    asUser,
                    GENERAL,
                    null,
                    { resourceTypes: CONTENT, q: 'index-without-full-content-item' },
                    (err, results) => {
                      assert.notExists(err);
                      const contentDoc = _findDoc(results, link.id);
                      assert.isNotOk(contentDoc);

                      // Fire off an indexing task using just the content id
                      postIndexTask(CONTENT, [{ id: link.id }], { resource: true }, err => {
                        assert.notExists(err);

                        // Ensure that the full content item is now back in the search index
                        searchAll(
                          asUser,
                          GENERAL,
                          null,
                          { resourceTypes: CONTENT, q: 'index-without-full-content-item' },
                          (err, results) => {
                            assert.notExists(err);
                            const contentDoc = _findDoc(results, link.id);
                            assert.ok(contentDoc);

                            // Ensure that the full tenant object is passed back.
                            assert.isObject(contentDoc.tenant);
                            assert.ok(contentDoc.tenant.displayName);
                            assert.ok(contentDoc.tenant.alias);

                            return callback();
                          }
                        );
                      });
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
     * Verify that the mime property only returns on search results of type 'file'.
     */
    it('verify mime type', callback => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
        assert.notExists(err);

        const { 0: user } = users;
        const asUser = user.restContext;

        // Make sure links don't have mime field
        let description = generateTestUserId('mimetype-test');
        createLink(
          asUser,
          {
            displayName: 'Test Content 1',
            description,
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (err, link) => {
            assert.notExists(err);

            searchAll(asUser, GENERAL, null, { resourceTypes: CONTENT, q: description }, (err, results) => {
              assert.notExists(err);
              const contentDoc = _findDoc(results, link.id);
              assert.ok(contentDoc);
              assert.isNotOk(contentDoc.mime);

              // Make sure files do get mime field
              const file = fs.createReadStream(path.join(__dirname, '/data/oae-video.png'));
              description = generateTestUserId('mimetype-test');
              createFile(
                asUser,
                {
                  displayName: 'Test Content 2',
                  description,
                  visiblity: PUBLIC,
                  file,
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (err, contentObj) => {
                  assert.notExists(err);
                  assert.ok(contentObj);
                  assert.strictEqual(contentObj.mime, 'image/png');

                  searchAll(asUser, GENERAL, null, { resourceTypes: CONTENT, q: description }, (err, results) => {
                    assert.notExists(err);
                    const contentDoc = _findDoc(results, contentObj.id);
                    assert.ok(contentDoc);
                    assert.strictEqual(contentDoc.mime, 'image/png');

                    return callback();
                  });
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies that PDF files are indexed
     */
    it('verify full-text indexing of pdf', callback => {
      const arePreviewsDisabled = not(PreviewAPI.getConfiguration().previews.enabled);

      if (arePreviewsDisabled) return callback();

      _purgeAndEnable(() => {
        updateConfigAndWait(asGlobalAdmin, ADMIN, { 'oae-content/storage/backend': 'test' }, err => {
          assert.notExists(err);

          const pdfStream = () => fs.createReadStream(path.join(__dirname, '/data/test.pdf'));

          _createContentAndWait(pdfStream, (user, content) => {
            const asUser = user.restContext;
            // Verify we can find the content from the PDF in general searches
            searchAll(
              asUser,
              GENERAL,
              null,
              { resourceTypes: CONTENT, q: 'b4c3f09e74f58b0aeee34d9c3cd9333a' },
              (err, results) => {
                assert.notExists(err);
                assert.ok(_findDoc(results, content.id));

                // Verify we can find the content from the PDF in library searches
                searchAll(
                  asUser,
                  'content-library',
                  [user.user.id],
                  { q: 'b4c3f09e74f58b0aeee34d9c3cd9333a' },
                  (err, results) => {
                    assert.notExists(err);
                    assert.ok(_findDoc(results, content.id));
                    return callback();
                  }
                );
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies that a revision without a plain.txt file still gets indexed
     */
    it('verify a revision without a plain.txt file still gets indexed', callback => {
      const arePreviewsDisabled = not(PreviewAPI.getConfiguration().previews.enabled);
      if (arePreviewsDisabled) return callback();

      _purgeAndEnable(() => {
        updateConfigAndWait(asGlobalAdmin, ADMIN, { 'oae-content/storage/backend': 'test' }, err => {
          assert.notExists(err);

          const pdfStream = () => fs.createReadStream(path.join(__dirname, '/data/test.pdf'));

          _createContentAndWait(pdfStream, (user, content) => {
            const asUser = user.restContext;

            // Verify we can find the content from the PDF in general searches
            searchAll(
              asUser,
              GENERAL,
              null,
              { resourceTypes: CONTENT, q: 'b4c3f09e74f58b0aeee34d9c3cd9333a' },
              (err, results) => {
                assert.notExists(err);
                assert.ok(_findDoc(results, content.id));

                /**
                 * Now, for whatever reason might not've been able to generate a plain.txt file,
                 * or the record got lost, or .. The search re-index should not get stalled by this fact
                 */
                runQuery('DELETE FROM "PreviewItems" WHERE "revisionId" = ?', [content.latestRevisionId], err => {
                  assert.notExists(err);

                  // Drop all the data
                  deleteAll(() => {
                    // Re-index everything
                    reindexAll(asGlobalAdmin, () => {
                      // Assert we can no longer find the document by its content
                      searchAll(
                        asUser,
                        GENERAL,
                        null,
                        { resourceTypes: CONTENT, q: 'b4c3f09e74f58b0aeee34d9c3cd9333a' },
                        (err, results) => {
                          assert.notExists(err);
                          assert.isNotOk(_findDoc(results, content.id));

                          // Assert we can find it by its name however
                          searchAll(
                            asUser,
                            GENERAL,
                            null,
                            { resourceTypes: CONTENT, q: content.displayName },
                            (err, results) => {
                              assert.notExists(err);
                              assert.ok(_findDoc(results, content.id));

                              return callback();
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
  });
});
