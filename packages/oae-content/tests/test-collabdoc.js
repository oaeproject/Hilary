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

import { format } from 'node:util';
import { assert } from 'chai';
import ShortId from 'shortid';
import { not, keys, equals } from 'ramda';

import * as RestAPI from 'oae-rest';
import * as SearchTestsUtil from 'oae-search/lib/test/util.js';
import * as TestsUtil from 'oae-tests';
import * as ContentTestUtil from 'oae-content/lib/test/util.js';
import * as Etherpad from 'oae-content/lib/internal/etherpad.js';

const { searchAll } = SearchTestsUtil;
const {
  getRevisions,
  getRevision,
  restoreRevision,
  joinCollabDoc,
  createCollabDoc,
  updateContent,
  getContent,
  updateMembers,
  createLink
} = RestAPI.Content;
const { generateTestUsers, generateTestUserId, createTenantAdminRestContext } = TestsUtil;

const NO_VIEWERS = [];
const NO_MANAGERS = [];
const NO_FOLDERS = [];
const NO_EDITORS = [];

const CONTENT = 'content';
const GENERAL = 'general';
const DESCRIPTION = 'description';
const PRIVATE = 'private';
const PUBLIC = 'public';
const EDITOR = 'editor';
const VIEWER = 'viewer';
const MANAGER = 'manager';

describe('Collaborative documents', () => {
  // Rest context that can be used every time we need to make a request as a tenant admin
  let asCambridgeTenantAdmin = null;

  const multipleServers = {
    apikey: '13SirapH8t3kxUh5T5aqWXhXahMzoZRA',
    hosts: [
      {
        host: '127.0.0.1',
        internalPort: 9001
      },
      {
        host: '127.0.0.2',
        internalPort: 9001
      }
    ]
  };

  /**
   * Once the server has started up, get the etherpad configuration and store it in this variable as some tests change the configuration
   */
  let testConfig = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before((callback) => {
    // Fill up tenant admin rest contexts
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    // Get the original test config
    testConfig = Etherpad.getConfig();

    return callback();
  });

  /**
   * Test that verifies the request parameters get validated when joining a collaborative document
   */
  it('verify basic parameter validation when joining a collaborative document', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);

      const { 0: johnDoe } = users;
      const asJohnDoe = johnDoe.restContext;

      // Check that we can't join a content item that's not collaborative
      createLink(
        asJohnDoe,
        {
          displayName: 'Test Content',
          description: 'Test description',
          visibility: PUBLIC,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, link) => {
          assert.notExists(error);

          joinCollabDoc(asJohnDoe, link.id, (error_) => {
            assert.strictEqual(error_.code, 400);

            createCollabDoc(
              asJohnDoe,
              'Test doc',
              DESCRIPTION,
              PRIVATE,
              NO_MANAGERS,
              NO_EDITORS,
              NO_VIEWERS,
              NO_FOLDERS,
              (error, contentObject) => {
                assert.notExists(error);

                joinCollabDoc(asJohnDoe, ' ', (error__) => {
                  assert.strictEqual(error__.code, 400);

                  joinCollabDoc(asJohnDoe, 'invalid-id', (error__) => {
                    assert.strictEqual(error__.code, 400);

                    // Sanity check - make sure we can join a collabdoc
                    joinCollabDoc(asJohnDoe, contentObject.id, (error, data) => {
                      assert.notExists(error);
                      assert.exists(data);

                      callback();
                    });
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
   * Test that verifies that the load is balanced based on the content ID
   */
  it('verify different servers get selected depending on the content ID', () => {
    // Configure Etherpad with 2 servers, rather than the default 1
    Etherpad.refreshConfiguration(multipleServers);

    // Assert load balancing is based on the content id
    const hostA = Etherpad.getPadUrl(
      { id: 'c:cam:abc123', etherpadPadId: 'padId' },
      'userId',
      'sesionId',
      'authorId',
      'language'
    );
    const hostB = Etherpad.getPadUrl(
      { id: 'c:cam:abc1231', etherpadPadId: 'padId' },
      'userId',
      'sesionId',
      'authorId',
      'language'
    );
    assert.notStrictEqual(hostA, hostB);

    const total = 10_000;
    const counts = {};
    for (let i = 0; i < total; i++) {
      const id = format('c:cam:%s', ShortId.generate());
      const contentObjectC = {
        id,
        etherpadPadId: 'padId'
      };
      const etherpadUrl = Etherpad.getPadUrl(contentObjectC, 'userId', 'sesionId', 'authorId', 'language');
      const path = new URL(etherpadUrl, 'http://localhost').pathname;
      if (not(counts[path])) {
        counts[path] = 0;
      }

      counts[path]++;
    }

    // There should only be 2 different base URLs
    const urls = keys(counts);
    assert.lengthOf(urls, 2);

    // The URLs should be evenly spread (allow for a maximum 5% deviation)
    const devA = counts[urls[0]] / (total / 2);
    const devB = counts[urls[1]] / (total / 2);

    assert.isAbove(
      devA,
      0.95,
      'Expected a maximum deviation of 5%, deviation was: ' + Math.round((1 - devA) * 100) + '%'
    );
    assert.isAbove(
      devB,
      0.95,
      'Expected a maximum deviation of 5%, deviation was: ' + Math.round((1 - devB) * 100) + '%'
    );

    // Re-configure Etherpad with the defaults
    Etherpad.refreshConfiguration(testConfig);
  });

  /**
   * Test that verifies that you can only join a collaborative document if you have manager or editor permissions
   */
  it('verify joining a pad respects the content permissions', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
      assert.notExists(error);

      const { 0: homer, 1: marge, 2: bart } = users;
      const asHomer = homer.restContext;
      const asMarge = marge.restContext;
      const asBart = bart.restContext;

      // homer creates a collaborative document that's private
      const name = generateTestUserId();
      createCollabDoc(
        asHomer,
        name,
        DESCRIPTION,
        PRIVATE,
        NO_MANAGERS,
        NO_EDITORS,
        NO_VIEWERS,
        NO_FOLDERS,
        (error, contentObject) => {
          assert.notExists(error);

          joinCollabDoc(asHomer, contentObject.id, (error, data) => {
            assert.notExists(error);
            assert.ok(data);

            // marge has no access yet, so joining should result in a 401
            joinCollabDoc(asMarge, contentObject.id, (error, data) => {
              assert.strictEqual(error.code, 401);
              assert.isNotOk(data);

              // Share it with marge, viewers still can't edit(=join) though
              const members = {};
              members[marge.user.id] = VIEWER;

              updateMembers(asHomer, contentObject.id, members, (error_) => {
                assert.notExists(error_);

                // marge can see the document, but he cannot join in and start editing it
                joinCollabDoc(asMarge, contentObject.id, (error, data) => {
                  assert.strictEqual(error.code, 401);
                  assert.isNotOk(data);

                  // Now that we make marge a manager, he should be able to join
                  members[marge.user.id] = MANAGER;
                  updateMembers(asHomer, contentObject.id, members, (error_) => {
                    assert.notExists(error_);

                    // marge should now be able to access it
                    joinCollabDoc(asMarge, contentObject.id, (error, data) => {
                      assert.notExists(error);
                      assert.ok(data);

                      // Add bart as an editor, he should be able to join
                      members[bart.user.id] = EDITOR;
                      updateMembers(asHomer, contentObject.id, members, (error_) => {
                        assert.notExists(error_);

                        // bart should now be able to access it
                        joinCollabDoc(asBart, contentObject.id, (error, data) => {
                          assert.notExists(error);
                          assert.ok(data);

                          return callback();
                        });
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
   * Set some text in Etherpad.
   *
   * @param  {String}     userId          The ID of the user who wil be changing the text
   * @param  {Content}    contentObj      The content object for which we should update the etherpad text
   * @param  {String}     text            The text to place in the pad
   * @param  {Function}   callback        Standard callback function
   * @param  {Object}     callback.err    An error that occurred, if any
   */
  const setEtherpadText = (userId, contentObject, text, callback) => {
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
  const getEtherpadText = function (contentObject, callback) {
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
  const editAndPublish = function (user, contentObject, texts, callback) {
    let done = 0;

    const doEditAndPublish = () => {
      if (equals(done, texts.length)) {
        return callback();
      }

      // Do some edits in etherpad
      setEtherpadText(user.user.id, contentObject, texts[done], (error) => {
        assert.notExists(error);

        ContentTestUtil.publishCollabDoc(contentObject.id, user.user.id, () => {
          done++;
          doEditAndPublish();
        });
      });
    };

    doEditAndPublish();
  };

  /**
   * Get a piece of content and its latest revision object.
   *
   * @param  {RestContext}    context             The restcontext that should be used to retrieve the content and revision.
   * @param  {String}         contentId           The ID of the piece of content that should be retrieved.
   * @param  {Function}       callback            Standard callback function
   * @param  {Content}        callback.content    The content object.
   * @param  {Content}        callback.revision   The revision object.
   */
  const getContentWithLatestRevision = function (context, contentId, callback) {
    getContent(context, contentId, (error, contentObject) => {
      assert.notExists(error);

      getRevision(context, contentId, contentObject.latestRevisionId, (error, revision) => {
        assert.notExists(error);
        callback(contentObject, revision);
      });
    });
  };

  /**
   * This test verifies that the latest HTML is retrieved when publishing a collaborative document
   * It does this by creating a pad, submitting some text in etherpad, publishing the document, retrieving the new content object
   * from our API and verifying the new text is there.
   * It also performs some more etherpad edits and verifies these do not get streamed to our API.
   */
  it('verify the correct HTML is retrieved when publishing', (callback) => {
    // Create a test user and collaborative document where the user has joined the document
    ContentTestUtil.createCollabDoc(asCambridgeTenantAdmin, 1, 1, (error, collabdocData) => {
      assert.notExists(error);

      const { 0: contentObject, 2: homer } = collabdocData;
      const asHomer = homer.restContext;

      // Verify there is no HTML present yet
      getContentWithLatestRevision(asHomer, contentObject.id, (contentObject, revision) => {
        assert.isNotOk(contentObject.latestRevision.etherpadHtml);
        assert.isNotOk(revision.etherpadHtml);

        // Do some edits in etherpad
        const text =
          'Only two things are infinite, the universe and human stupidity, and I am not sure about the former.';

        editAndPublish(homer, contentObject, [text], () => {
          getContentWithLatestRevision(asHomer, contentObject.id, (updatedContentObject, updatedRevision) => {
            assert.ok(updatedContentObject.latestRevision.etherpadHtml);
            assert.ok(updatedRevision.etherpadHtml);
            assert.notStrictEqual(updatedContentObject.latestRevision.etherpadHtml, revision.etherpadHtml);
            assert.notStrictEqual(updatedRevision.etherpadHtml, revision.etherpadHtml);

            // Remove linebreaks and check if the text is correct
            ContentTestUtil.assertEtherpadContentEquals(updatedRevision.etherpadHtml, text);

            // If we make any further updates in etherpad they shouldn't show up yet from our API
            setEtherpadText(homer.user.id, contentObject, 'There are no facts, only interpretations.', (error_) => {
              assert.notExists(error_);

              getContentWithLatestRevision(asHomer, contentObject.id, (latestContentObject, latestRevision) => {
                assert.ok(latestContentObject.latestRevision.etherpadHtml);
                assert.ok(latestRevision.etherpadHtml);
                assert.strictEqual(
                  latestContentObject.latestRevision.etherpadHtml,
                  updatedContentObject.latestRevision.etherpadHtml
                );
                assert.strictEqual(latestRevision.etherpadHtml, updatedRevision.etherpadHtml);

                return callback();
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies that documents that are published, can be searched on.
   */
  it('verify that published collaborative documents are searchable', (callback) => {
    ContentTestUtil.createCollabDoc(asCambridgeTenantAdmin, 1, 1, (error, collabdocData) => {
      assert.notExists(error);

      const { 0: contentObject, 2: homer } = collabdocData;
      const asHomer = homer.restContext;

      // Do some edits in etherpad
      editAndPublish(
        homer,
        contentObject,
        [
          'Most modern calendars mar the sweet simplicity of our lives by reminding us that each day that passes is the anniversary of some perfectly uninteresting event.'
        ],
        () => {
          /**
           * Search for the document. As we're using a fairly large substring as
           * the search query, the document should appear at the top of the result set
           */
          searchAll(
            asHomer,
            GENERAL,
            null,
            {
              q: 'each day that passes is the anniversary of some perfectly uninteresting event',
              resourceTypes: CONTENT
            },
            (error_, data) => {
              assert.notExists(error_);
              assert.strictEqual(data.results[0].id, contentObject.id);

              return callback();
            }
          );
        }
      );
    });
  });

  /**
   * Test that verifies that published documents can be restored.
   */
  it('verify that published collaborative documents are restorable', (callback) => {
    ContentTestUtil.createCollabDoc(asCambridgeTenantAdmin, 1, 1, (error, collabdocData) => {
      assert.notExists(error);

      const { 0: contentObject, 2: homer } = collabdocData;
      const asHomer = homer.restContext;

      const texts = [
        "Always do sober what you said you'd do drunk. That will teach you to keep your mouth shut.",
        'Bill Gates is a very rich man today... and do you want to know why? The answer is one word: versions.',
        "I don't have to play by these rules or do these things... I can actually have my own kind of version."
      ];

      editAndPublish(homer, contentObject, texts, () => {
        getRevisions(asHomer, contentObject.id, null, null, (error_, revisions) => {
          assert.notExists(error_);

          // We published our document 3 times, this should result in 4 revisions. (1 create + 3 publications)
          assert.lengthOf(revisions.results, 4);

          // Restore the second revision. The html on the content item and
          // in etherpad should be updated
          restoreRevision(asHomer, contentObject.id, revisions.results[1].revisionId, (error__) => {
            assert.notExists(error__);

            getContentWithLatestRevision(asHomer, contentObject.id, (updatedContent, updatedRevision) => {
              // Make sure the revisions feed doesn't have etherpadHtml in it
              assert.isNotOk(revisions.results[1].etherpadHtml);

              // Fetch the individual revision so we can verify the etherpadHtml is correct
              getRevision(
                asHomer,
                revisions.results[1].contentId,
                revisions.results[1].revisionId,
                (error_, fullRev) => {
                  assert.notExists(error_);

                  assert.strictEqual(updatedContent.latestRevision.etherpadHtml, fullRev.etherpadHtml);
                  assert.strictEqual(updatedRevision.etherpadHtml, fullRev.etherpadHtml);

                  getEtherpadText(contentObject, (error, data) => {
                    assert.notExists(error);
                    assert.strictEqual(data.text, texts[1] + '\n\n');

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

  /**
   * Test that verifies that restoring collaborative documents is access scoped
   */
  it('verify that restoring collaborative documents is access scoped', (callback) => {
    ContentTestUtil.createCollabDoc(asCambridgeTenantAdmin, 1, 1, (error, collabdocData) => {
      assert.notExists(error);

      const { 0: contentObject, 2: homer } = collabdocData;
      const asHomer = homer.restContext;

      generateTestUsers(asCambridgeTenantAdmin, 1, (error_, users) => {
        assert.notExists(error_);

        const { 0: marge } = users;
        const asMarge = marge.restContext;

        const texts = ['Any sufficiently advanced technology is indistinguishable from magic.'];
        editAndPublish(homer, contentObject, texts, () => {
          getRevisions(asHomer, contentObject.id, null, null, (error_, revisions) => {
            assert.notExists(error_);
            assert.lengthOf(revisions.results, 2);

            // Marge is not a manager, so he cannot restore anything
            restoreRevision(asMarge, contentObject.id, revisions.results[0].revisionId, (error__) => {
              assert.strictEqual(error__.code, 401);

              // Elevate marge to an editor and verify that he still can't restore old versions
              const permissions = {};
              permissions[marge.user.id] = EDITOR;
              updateMembers(asHomer, contentObject.id, permissions, (error__) => {
                assert.notExists(error__);

                restoreRevision(asMarge, contentObject.id, revisions.results[0].revisionId, (error__) => {
                  assert.strictEqual(error__.code, 401);

                  // Sanity check
                  getRevisions(asHomer, contentObject.id, null, null, (error, revisions) => {
                    assert.notExists(error);
                    assert.lengthOf(revisions.results, 2);

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
   * Test that verifies that etherpad related properties such as `etherpadGroupId`, `etherpadPadId`, .. cannot be set.
   */
  it('verify that etherpad related properties cannot be set on the content object', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);

      const { 0: homer } = users;
      const asHomer = homer.restContext;
      const name = generateTestUserId('collabdoc');

      createCollabDoc(
        asHomer,
        name,
        DESCRIPTION,
        PUBLIC,
        NO_MANAGERS,
        NO_EDITORS,
        NO_VIEWERS,
        NO_FOLDERS,
        (error, contentObject) => {
          assert.notExists(error);

          // Try updating any of the etherpad properties
          updateContent(asHomer, contentObject.id, { etherpadGroupId: 'bleh' }, (error_) => {
            assert.strictEqual(error_.code, 400);

            updateContent(asHomer, contentObject.id, { etherpadPadId: 'bleh' }, (error_) => {
              assert.strictEqual(error_.code, 400);

              // Update a regular property
              updateContent(asHomer, contentObject.id, { displayName: 'bleh' }, (error, updatedContentObject) => {
                assert.notExists(error);
                assert.isNotOk(updatedContentObject.downloadPath);

                // Double-check the the content item didn't change
                getContent(asHomer, contentObject.id, (error, latestContentObject) => {
                  assert.notExists(error);
                  assert.strictEqual(contentObject.etherpadGroupId, latestContentObject.etherpadGroupId);
                  assert.strictEqual(contentObject.etherpadPadId, latestContentObject.etherpadPadId);

                  return callback();
                });
              });
            });
          });
        }
      );
    });
  });

  /**
   * Test that verifies that a collabdoc is created and initialized with no content
   */
  it('verify etherpad document starts with empty document', (callback) => {
    // Create a collaborative document to test with
    ContentTestUtil.createCollabDoc(asCambridgeTenantAdmin, 1, 1, (error, collabdocData) => {
      assert.notExists(error);
      const { 0: content } = collabdocData;

      // Ensure the content of the etherpad starts as empty
      Etherpad.getHTML(content.id, content.etherpadPadId, (error, html) => {
        assert.notExists(error);
        assert.ok(Etherpad.isContentEmpty(html));

        return callback();
      });
    });
  });

  /**
   * Test that verifies that no new revisions are created when an etherpad document is published
   * without change
   */
  it('verify publishing unchanged etherpad document results in no new revisions', (callback) => {
    ContentTestUtil.createCollabDoc(asCambridgeTenantAdmin, 1, 1, (error, collabdocData) => {
      assert.notExists(error);
      const { 0: contentObject, 2: homer } = collabdocData;
      const asHomer = homer.restContext;

      // Publish the document with no changes made to it
      ContentTestUtil.publishCollabDoc(contentObject.id, homer.user.id, () => {
        // Ensure it only has 1 revision, the initial one
        getRevisions(asHomer, contentObject.id, null, null, (error_, revisions) => {
          assert.notExists(error_);

          assert.lengthOf(revisions.results, 1);

          // Generate a new revision with some new text in it
          editAndPublish(homer, contentObject, ['Some text'], () => {
            // Ensure we now have 2 revisions
            getRevisions(asHomer, contentObject.id, null, null, (error_, revisions) => {
              assert.notExists(error_);
              assert.lengthOf(revisions.results, 2);

              // Make the same edit and publish, ensuring that a new revision is not created
              editAndPublish(homer, contentObject, ['Some text'], () => {
                // Ensure we still only have 2 revisions (1 empty, one with "Some Text")
                getRevisions(asHomer, contentObject.id, null, null, (error, revisions) => {
                  assert.notExists(error);
                  assert.lengthOf(revisions.results, 2);

                  return callback();
                });
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies that an empty revision can be restored
   */
  it('verify empty revisions can be restored', (callback) => {
    ContentTestUtil.createCollabDoc(asCambridgeTenantAdmin, 1, 1, (error, collabdocData) => {
      assert.notExists(error);
      const { 0: contentObject, 2: homer } = collabdocData;
      const asHomer = homer.restContext;

      // Generate an empty revision
      ContentTestUtil.publishCollabDoc(contentObject.id, homer.user.id, () => {
        /**
         * Generate a revision with some text in. This is done so we can assert that
         * the pad is made empty when we restore the empty revision further down
         */
        editAndPublish(homer, contentObject, ['Some text'], () => {
          // Sanity-check our 2 revisions exist
          getRevisions(asHomer, contentObject.id, null, null, (error_, revisions) => {
            assert.notExists(error_);
            assert.lengthOf(revisions.results, 2);

            // Try to restore the empty revision
            restoreRevision(asHomer, contentObject.id, revisions.results[1].revisionId, (error__) => {
              assert.notExists(error__);

              // Assert that the pad is made empty
              Etherpad.getHTML(contentObject.id, contentObject.etherpadPadId, (error_, html) => {
                assert.notExists(error_);
                assert.ok(Etherpad.isContentEmpty(html));

                // Assert that this created a third revision
                getRevisions(asHomer, contentObject.id, null, null, (error, revisions) => {
                  assert.notExists(error);
                  assert.lengthOf(revisions.results, 3);

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
