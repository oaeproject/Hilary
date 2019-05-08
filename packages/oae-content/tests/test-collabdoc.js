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
import url from 'url';
import util from 'util';
import ShortId from 'shortid';
import _ from 'underscore';

import * as RestAPI from 'oae-rest';
import * as SearchTestsUtil from 'oae-search/lib/test/util';
import * as TestsUtil from 'oae-tests';
import * as ContentTestUtil from 'oae-content/lib/test/util';
import * as Etherpad from 'oae-content/lib/internal/etherpad';

describe('Collaborative documents', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let anonymousRestContext = null;
  // Rest context that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;

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

  // Once the server has started up, get the etherpad configuration and store it in this variable
  // as some tests change the configuration
  let testConfig = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before(callback => {
    // Fill up anonymous rest context
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    // Fill up tenant admin rest contexts
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    // Get the original test config
    testConfig = Etherpad.getConfig();
    return callback();
  });

  /**
   * Test that verifies the request parameters get validated when joining a collaborative document
   */
  it('verify basic parameter validation when joining a collaborative document', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);
      const ctx = _.values(users)[0].restContext;

      // Check that we can't join a content item that's not collaborative
      RestAPI.Content.createLink(
        ctx,
        'Test Content',
        'Test description',
        'public',
        'http://www.oaeproject.org/',
        [],
        [],
        [],
        (err, link) => {
          assert.ok(!err);

          RestAPI.Content.joinCollabDoc(ctx, link.id, err => {
            assert.strictEqual(err.code, 400);

            RestAPI.Content.createCollabDoc(
              ctx,
              'Test doc',
              'description',
              'private',
              [],
              [],
              [],
              [],
              (err, contentObj) => {
                assert.ok(!err);

                RestAPI.Content.joinCollabDoc(ctx, ' ', err => {
                  assert.strictEqual(err.code, 400);

                  RestAPI.Content.joinCollabDoc(ctx, 'invalid-id', err => {
                    assert.strictEqual(err.code, 400);

                    // Sanity check - make sure we can join a collabdoc
                    RestAPI.Content.joinCollabDoc(ctx, contentObj.id, (err, data) => {
                      assert.ok(!err);
                      assert.ok(data);
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

    const total = 10000;
    const counts = {};
    for (let i = 0; i < total; i++) {
      const id = util.format('c:cam:%s', ShortId.generate());
      const contentObjC = {
        id,
        etherpadPadId: 'padId'
      };
      const etherpadUrl = Etherpad.getPadUrl(contentObjC, 'userId', 'sesionId', 'authorId', 'language');
      const path = url.parse(etherpadUrl).pathname;
      if (!counts[path]) {
        counts[path] = 0;
      }

      counts[path]++;
    }

    // There should only be 2 different base URLs
    const urls = _.keys(counts);
    assert.strictEqual(urls.length, 2);

    // The URLs should be evenly spread (allow for a maximum 5% deviation)
    const devA = counts[urls[0]] / (total / 2);
    const devB = counts[urls[1]] / (total / 2);
    assert.ok(devA > 0.95, 'Expected a maximum deviation of 5%, deviation was: ' + Math.round((1 - devA) * 100) + '%');
    assert.ok(devB > 0.95, 'Expected a maximum deviation of 5%, deviation was: ' + Math.round((1 - devB) * 100) + '%');

    // Re-configure Etherpad with the defaults
    Etherpad.refreshConfiguration(testConfig);
  });

  /**
   * Test that verifies that you can only join a collaborative document if you have manager or editor permissions
   */
  it('verify joining a pad respects the content permissions', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users) => {
      assert.ok(!err);
      const simonCtx = _.values(users)[0].restContext;
      const brandenCtx = _.values(users)[1].restContext;
      const stuartCtx = _.values(users)[2].restContext;

      // Simon creates a collaborative document that's private
      const name = TestsUtil.generateTestUserId();
      RestAPI.Content.createCollabDoc(simonCtx, name, 'description', 'private', [], [], [], [], (err, contentObj) => {
        assert.ok(!err);

        RestAPI.Content.joinCollabDoc(simonCtx, contentObj.id, (err, data) => {
          assert.ok(!err);
          assert.ok(data);

          // Branden has no access yet, so joining should result in a 401
          RestAPI.Content.joinCollabDoc(brandenCtx, contentObj.id, (err, data) => {
            assert.strictEqual(err.code, 401);
            assert.ok(!data);

            // Share it with branden, viewers still can't edit(=join) though
            const members = {};
            members[_.keys(users)[1]] = 'viewer';
            RestAPI.Content.updateMembers(simonCtx, contentObj.id, members, err => {
              assert.ok(!err);

              // Branden can see the document, but he cannot join in and start editing it
              RestAPI.Content.joinCollabDoc(brandenCtx, contentObj.id, (err, data) => {
                assert.strictEqual(err.code, 401);
                assert.ok(!data);

                // Now that we make Branden a manager, he should be able to join
                members[_.keys(users)[1]] = 'manager';
                RestAPI.Content.updateMembers(simonCtx, contentObj.id, members, err => {
                  assert.ok(!err);

                  // Branden should now be able to access it
                  RestAPI.Content.joinCollabDoc(brandenCtx, contentObj.id, (err, data) => {
                    assert.ok(!err);
                    assert.ok(data);

                    // Add Stuart as an editor, he should be able to join
                    members[_.keys(users)[2]] = 'editor';
                    RestAPI.Content.updateMembers(simonCtx, contentObj.id, members, err => {
                      assert.ok(!err);

                      // Stuart should now be able to access it
                      RestAPI.Content.joinCollabDoc(stuartCtx, contentObj.id, (err, data) => {
                        assert.ok(!err);
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
      });
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
  const setEtherpadText = function(userId, contentObj, text, callback) {
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
  const getEtherpadText = function(contentObj, callback) {
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
  const editAndPublish = function(user, contentObj, texts, callback) {
    let done = 0;

    const doEditAndPublish = function() {
      if (done === texts.length) {
        return callback();
      }

      // Do some edits in etherpad
      setEtherpadText(user.user.id, contentObj, texts[done], err => {
        assert.ok(!err);

        ContentTestUtil.publishCollabDoc(contentObj.id, user.user.id, () => {
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
  const getContentWithLatestRevision = function(context, contentId, callback) {
    RestAPI.Content.getContent(context, contentId, (err, contentObj) => {
      assert.ok(!err);

      RestAPI.Content.getRevision(context, contentId, contentObj.latestRevisionId, (err, revision) => {
        assert.ok(!err);
        callback(contentObj, revision);
      });
    });
  };

  /**
   * This test verifies that the latest HTML is retrieved when publishing a collaborative document
   * It does this by creating a pad, submitting some text in etherpad, publishing the document, retrieving the new content object
   * from our API and verifying the new text is there.
   * It also performs some more etherpad edits and verifies these do not get streamed to our API.
   */
  it('verify the correct HTML is retrieved when publishing', callback => {
    // Create a test user and collaborative document where the user has joined the document
    ContentTestUtil.createCollabDoc(camAdminRestContext, 1, 1, (err, collabdocData) => {
      const [contentObj, users, simon] = collabdocData;
      // Verify there is no HTML present yet
      getContentWithLatestRevision(simon.restContext, contentObj.id, (contentObj, revision) => {
        assert.ok(!contentObj.latestRevision.etherpadHtml);
        assert.ok(!revision.etherpadHtml);

        // Do some edits in etherpad
        const text =
          'Only two things are infinite, the universe and human stupidity, and I am not sure about the former.';
        editAndPublish(simon, contentObj, [text], () => {
          getContentWithLatestRevision(simon.restContext, contentObj.id, (updatedContentObj, updatedRevision) => {
            assert.ok(updatedContentObj.latestRevision.etherpadHtml);
            assert.ok(updatedRevision.etherpadHtml);
            assert.notStrictEqual(updatedContentObj.latestRevision.etherpadHtml, revision.etherpadHtml);
            assert.notStrictEqual(updatedRevision.etherpadHtml, revision.etherpadHtml);

            // Remove linebreaks and check if the text is correct
            ContentTestUtil.assertEtherpadContentEquals(updatedRevision.etherpadHtml, text);

            // If we make any further updates in etherpad they shouldn't show up yet from our API
            setEtherpadText(simon.user.id, contentObj, 'There are no facts, only interpretations.', err => {
              assert.ok(!err);

              getContentWithLatestRevision(simon.restContext, contentObj.id, (latestContentObj, latestRevision) => {
                assert.ok(latestContentObj.latestRevision.etherpadHtml);
                assert.ok(latestRevision.etherpadHtml);
                assert.strictEqual(
                  latestContentObj.latestRevision.etherpadHtml,
                  updatedContentObj.latestRevision.etherpadHtml
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
  it('verify that published collaborative documents are searchable', callback => {
    ContentTestUtil.createCollabDoc(camAdminRestContext, 1, 1, (err, collabdocData) => {
      const [contentObj, users, simon] = collabdocData;
      // Do some edits in etherpad
      editAndPublish(
        simon,
        contentObj,
        [
          'Most modern calendars mar the sweet simplicity of our lives by reminding us that each day that passes is the anniversary of some perfectly uninteresting event.'
        ],
        () => {
          // Search for the document. As we're using a fairly large substring as
          // the search query, the document should appear at the top of the result set
          SearchTestsUtil.searchAll(
            simon.restContext,
            'general',
            null,
            {
              q: 'each day that passes is the anniversary of some perfectly uninteresting event',
              resourceTypes: 'content'
            },
            (err, data) => {
              assert.ok(!err);
              assert.strictEqual(data.results[0].id, contentObj.id);
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
  it('verify that published collaborative documents are restorable', callback => {
    ContentTestUtil.createCollabDoc(camAdminRestContext, 1, 1, (err, collabdocData) => {
      const [contentObj, users, simon] = collabdocData;
      const texts = [
        "Always do sober what you said you'd do drunk. That will teach you to keep your mouth shut.",
        'Bill Gates is a very rich man today... and do you want to know why? The answer is one word: versions.',
        "I don't have to play by these rules or do these things... I can actually have my own kind of version."
      ];
      editAndPublish(simon, contentObj, texts, () => {
        RestAPI.Content.getRevisions(simon.restContext, contentObj.id, null, null, (err, revisions) => {
          assert.ok(!err);

          // We published our document 3 times, this should result in 4 revisions. (1 create + 3 publications)
          assert.strictEqual(revisions.results.length, 4);

          // Restore the second revision. The html on the content item and
          // in etherpad should be updated
          RestAPI.Content.restoreRevision(simon.restContext, contentObj.id, revisions.results[1].revisionId, err => {
            assert.ok(!err);

            getContentWithLatestRevision(simon.restContext, contentObj.id, (updatedContent, updatedRevision) => {
              // Make sure the revisions feed doesn't have etherpadHtml in it
              assert.ok(!revisions.results[1].etherpadHtml);
              // Fetch the individual revision so we can verify the etherpadHtml is correct
              RestAPI.Content.getRevision(
                simon.restContext,
                revisions.results[1].contentId,
                revisions.results[1].revisionId,
                (err, fullRev) => {
                  assert.strictEqual(updatedContent.latestRevision.etherpadHtml, fullRev.etherpadHtml);
                  assert.strictEqual(updatedRevision.etherpadHtml, fullRev.etherpadHtml);

                  getEtherpadText(contentObj, (err, data) => {
                    assert.ok(!err);
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
  it('verify that restoring collaborative documents is access scoped', callback => {
    ContentTestUtil.createCollabDoc(camAdminRestContext, 1, 1, (err, collabdocData) => {
      const [contentObj, users, simon] = collabdocData;
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, branden) => {
        assert.ok(!err);

        const texts = ['Any sufficiently advanced technology is indistinguishable from magic.'];
        editAndPublish(simon, contentObj, texts, () => {
          RestAPI.Content.getRevisions(simon.restContext, contentObj.id, null, null, (err, revisions) => {
            assert.ok(!err);
            assert.strictEqual(revisions.results.length, 2);

            // Branden is not a manager, so he cannot restore anything
            RestAPI.Content.restoreRevision(
              branden.restContext,
              contentObj.id,
              revisions.results[0].revisionId,
              err => {
                assert.strictEqual(err.code, 401);

                // Elevate Branden to an editor and verify that he still can't restore old versions
                const permissions = {};
                permissions[branden.user.id] = 'editor';
                RestAPI.Content.updateMembers(simon.restContext, contentObj.id, permissions, err => {
                  assert.ok(!err);

                  RestAPI.Content.restoreRevision(
                    branden.restContext,
                    contentObj.id,
                    revisions.results[0].revisionId,
                    err => {
                      assert.strictEqual(err.code, 401);

                      // Sanity check
                      RestAPI.Content.getRevisions(simon.restContext, contentObj.id, null, null, (err, revisions) => {
                        assert.ok(!err);
                        assert.strictEqual(revisions.results.length, 2);
                        return callback();
                      });
                    }
                  );
                });
              }
            );
          });
        });
      });
    });
  });

  /**
   * Test that verifies that etherpad related properties such as `etherpadGroupId`, `etherpadPadId`, .. cannot be set.
   */
  it('verify that etherpad related properties cannot be set on the content object', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);
      const simonCtx = _.values(users)[0].restContext;

      const name = TestsUtil.generateTestUserId('collabdoc');
      RestAPI.Content.createCollabDoc(simonCtx, name, 'description', 'public', [], [], [], [], (err, contentObj) => {
        assert.ok(!err);

        // Try updating any of the etherpad properties
        RestAPI.Content.updateContent(simonCtx, contentObj.id, { etherpadGroupId: 'bleh' }, err => {
          assert.strictEqual(err.code, 400);
          RestAPI.Content.updateContent(simonCtx, contentObj.id, { etherpadPadId: 'bleh' }, err => {
            assert.strictEqual(err.code, 400);
            // Update a regular property
            RestAPI.Content.updateContent(
              simonCtx,
              contentObj.id,
              { displayName: 'bleh' },
              (err, updatedContentObj) => {
                assert.ok(!err);
                assert.ok(!updatedContentObj.downloadPath);

                // Double-check the the content item didn't change
                RestAPI.Content.getContent(simonCtx, contentObj.id, (err, latestContentObj) => {
                  assert.ok(!err);
                  assert.strictEqual(contentObj.etherpadGroupId, latestContentObj.etherpadGroupId);
                  assert.strictEqual(contentObj.etherpadPadId, latestContentObj.etherpadPadId);
                  return callback();
                });
              }
            );
          });
        });
      });
    });
  });

  /**
   * Test that verifies that a collabdoc is created and initialized with no content
   */
  it('verify etherpad document starts with empty document', callback => {
    // Create a collaborative document to test with
    ContentTestUtil.createCollabDoc(camAdminRestContext, 1, 1, (err, collabdocData) => {
      const [content, users, simon] = collabdocData;

      // Ensure the content of the etherpad starts as empty
      Etherpad.getHTML(content.id, content.etherpadPadId, (err, html) => {
        assert.ok(!err);
        assert.ok(Etherpad.isContentEmpty(html));
        return callback();
      });
    });
  });

  /**
   * Test that verifies that no new revisions are created when an etherpad document is published
   * without change
   */
  it('verify publishing unchanged etherpad document results in no new revisions', callback => {
    ContentTestUtil.createCollabDoc(camAdminRestContext, 1, 1, (err, collabdocData) => {
      const [contentObj, users, simon] = collabdocData;

      // Publish the document with no changes made to it
      ContentTestUtil.publishCollabDoc(contentObj.id, simon.user.id, () => {
        // Ensure it only has 1 revision, the initial one
        RestAPI.Content.getRevisions(simon.restContext, contentObj.id, null, null, (err, revisions) => {
          assert.ok(!err);
          assert.strictEqual(revisions.results.length, 1);

          // Generate a new revision with some new text in it
          editAndPublish(simon, contentObj, ['Some text'], () => {
            // Ensure we now have 2 revisions
            RestAPI.Content.getRevisions(simon.restContext, contentObj.id, null, null, (err, revisions) => {
              assert.ok(!err);
              assert.strictEqual(revisions.results.length, 2);

              // Make the same edit and publish, ensuring that a new revision is not
              // created
              editAndPublish(simon, contentObj, ['Some text'], () => {
                // Ensure we still only have 2 revisions (1 empty, one with "Some
                // Text")
                RestAPI.Content.getRevisions(simon.restContext, contentObj.id, null, null, (err, revisions) => {
                  assert.ok(!err);
                  assert.strictEqual(revisions.results.length, 2);
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
  it('verify empty revisions can be restored', callback => {
    ContentTestUtil.createCollabDoc(camAdminRestContext, 1, 1, (err, collabdocData) => {
      const [contentObj, users, simon] = collabdocData;

      // Generate an empty revision
      ContentTestUtil.publishCollabDoc(contentObj.id, simon.user.id, () => {
        // Generate a revision with some text in. This is done so we can assert that
        // the pad is made empty when we restore the empty revision further down
        editAndPublish(simon, contentObj, ['Some text'], () => {
          // Sanity-check our 2 revisions exist
          RestAPI.Content.getRevisions(simon.restContext, contentObj.id, null, null, (err, revisions) => {
            assert.ok(!err);
            assert.strictEqual(revisions.results.length, 2);

            // Try to restore the empty revision
            RestAPI.Content.restoreRevision(simon.restContext, contentObj.id, revisions.results[1].revisionId, err => {
              assert.ok(!err);

              // Assert that the pad is made empty
              Etherpad.getHTML(contentObj.id, contentObj.etherpadPadId, (err, html) => {
                assert.ok(!err);
                assert.ok(Etherpad.isContentEmpty(html));

                // Assert that this created a third revision
                RestAPI.Content.getRevisions(simon.restContext, contentObj.id, null, null, (err, revisions) => {
                  assert.ok(!err);
                  assert.strictEqual(revisions.results.length, 3);
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
