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
import temp from 'temp';
import _ from 'underscore';

import * as AuthzAPI from 'oae-authz';
import * as AuthzTestUtil from 'oae-authz/lib/test/util';
import * as AuthzUtil from 'oae-authz/lib/util';
import { Context } from 'oae-context';
import PreviewConstants from 'oae-preview-processor/lib/constants';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util';
import * as RestAPI from 'oae-rest';
import { RestContext } from 'oae-rest/lib/model';
import * as RestUtil from 'oae-rest/lib/util';
import * as TenantsAPI from 'oae-tenants/lib/api';
import * as MQ from 'oae-util/lib/mq';
import * as TestsUtil from 'oae-tests';
import * as ContentAPI from 'oae-content';
import * as ContentTestUtil from 'oae-content/lib/test/util';
import * as ContentUtil from 'oae-content/lib/internal/util';

const PUBLIC = 'public';
const PRIVATE = 'private';
const LOGGEDIN = 'loggedin';

describe('Content', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let anonymousRestContext = null;
  // Rest contexts that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;
  let gtAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before(callback => {
    // Fill up anonymous rest context
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    // Fill up tenant admin rest contexts
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    // Fill up global admin rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();

    // Log in the tenant admin so his cookie jar is set up appropriately. This is because TestsUtil.generateTestUsers
    // will concurrently try and create users, which causes race conditions when trying to authenticate the rest
    // context.
    RestAPI.User.getMe(camAdminRestContext, (err, meObj) => {
      assert.ok(!err);

      // Unbind the current handler, if any
      MQ.unsubscribe(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, err => {
        assert.ok(!err);

        /*!
         * Task handler that will just drain the queue.
         *
         * @see MQ#bind
         */
        const _handleTaskDrain = function(data, mqCallback) {
          // Simply callback, which acknowledges the message without doing anything.
          mqCallback();
        };

        // Drain the queue
        MQ.subscribe(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, _handleTaskDrain, err => {
          assert.ok(!err);
          callback();
        });
      });
    });
  });

  /**
   * Function that will clean up any files that we have lingering around.
   */
  after(done => {
    temp.track(true);
    temp.cleanup(done);
  });

  /**
   * Create a number of users that will be used inside of a test
   * @param  {Function(contexts)}  callback           Standard callback function
   * @param  {Object}              callback.contexts  Object where the keys are identifiers for the created users and the values are an
   *                                                  object with a user key containing the user object for the created user and a restContext key
   *                                                  containing the REST Context for that user
   */
  const setUpUsers = function(callback) {
    const contexts = {};
    const createUser = function(identifier, visibility, displayName) {
      const userId = TestsUtil.generateTestUserId(identifier);
      const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
      RestAPI.User.createUser(
        camAdminRestContext,
        userId,
        'password',
        displayName,
        email,
        { visibility },
        (err, createdUser) => {
          if (err) {
            assert.fail('Could not create test user');
          }

          contexts[identifier] = {
            user: createdUser,
            restContext: TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host, userId, 'password')
          };
          if (_.keys(contexts).length === 7) {
            callback(contexts);
          }
        }
      );
    };

    createUser('nicolaas', PUBLIC, 'Nicolaas Matthijs');
    createUser('simon', LOGGEDIN, 'Simon Gaeremynck');
    createUser('bert', PRIVATE, 'Bert Pareyn');
    createUser('branden', PRIVATE, 'Branden Visser');
    createUser('anthony', PUBLIC, 'Anthony Whyte');
    createUser('stuart', PUBLIC, 'Stuart Freeman');
    createUser('ian', PUBLIC, 'Ian Dolphin');
  };

  /**
   * Create a number of groups that will be used inside of a test
   *
   * @param  {Array<Context>}      contexts           Array of contexts that represent the users that will be used in the test
   * @param  {Function(groups)}    callback           Standard callback function
   * @param  {Object}              callback.groups    JSON Object where the keys are the group identifiers and the values are the
   *                                                  actual group object
   */
  const setUpGroups = function(contexts, callback) {
    const groups = {};
    // Create UI Dev Group
    // Make Bert a member
    RestAPI.Group.createGroup(
      contexts.bert.restContext,
      'UI Dev Team',
      'UI Dev Group',
      PUBLIC,
      'yes',
      [],
      [contexts.nicolaas.user.id],
      (err, groupObj) => {
        assert.ok(!err);
        groups['ui-team'] = groupObj;
        // Create Back-end Dev Group
        // Make Simon a member
        let simonMember = {};
        simonMember = 'member';
        RestAPI.Group.createGroup(
          contexts.branden.restContext,
          'Back-end Dev Team',
          'Back-end Dev Group',
          PUBLIC,
          'yes',
          [],
          [contexts.simon.user.id],
          (err, groupObj) => {
            assert.ok(!err);
            groups['backend-team'] = groupObj;

            // Create OAE Team Group
            // Make Stuart, UI Dev Group and Back-end Dev Group all members
            RestAPI.Group.createGroup(
              contexts.anthony.restContext,
              'OAE Team',
              'OAE Team Group',
              PUBLIC,
              'yes',
              [],
              [groups['ui-team'].id, groups['backend-team'].id, contexts.stuart.user.id],
              (err, groupObj) => {
                assert.ok(!err);
                groups['oae-team'] = groupObj;
                return callback(groups);
              }
            );
          }
        );
      }
    );
  };

  /**
   * Run a number of asserts on a piece of content. This function checks whether a user has access to the content and
   * whether or not it can be seen in the library of the creator
   * @param  {RestContext}        restCtx             Standard REST Context object that contains the current tenant URL and the current
   *                                                  user credentials
   * @param  {String}             libraryToCheck      The user id (creator) for which we want to check the library
   * @param  {Content}            contentObj          The content object we'll be running checks for
   * @param  {Boolean}            expectAccess        Whether or not we expect the current user to have access to the piece of content
   * @param  {Boolean}            expectManager       Whether or not we expect the current user to be able to manage the piece of content
   * @param  {Boolean}            expectInLibrary     Whether or not we expect the current user to see the item in the creator's library
   * @param  {Boolean}            expectCanShare      Whether or not we expect the current user to be allowed to share the content
   * @param  {Function}           callback            Standard callback function
   */
  const checkPieceOfContent = function(
    restCtx,
    libraryToCheck,
    contentObj,
    expectAccess,
    expectManager,
    expectInLibrary,
    expectCanShare,
    callback
  ) {
    // Check whether the content can be retrieved
    RestAPI.Content.getContent(restCtx, contentObj.id, (err, retrievedContent) => {
      if (expectAccess) {
        assert.ok(!err);
        assert.ok(retrievedContent.id);
        assert.ok(_.isObject(contentObj.tenant));
        assert.strictEqual(_.keys(retrievedContent.tenant).length, 3);
        assert.strictEqual(retrievedContent.tenant.alias, contentObj.tenant.alias);
        assert.strictEqual(retrievedContent.tenant.displayName, contentObj.tenant.displayName);
        assert.strictEqual(retrievedContent.visibility, contentObj.visibility);
        assert.strictEqual(retrievedContent.displayName, contentObj.displayName);
        assert.strictEqual(retrievedContent.description, contentObj.description);
        assert.strictEqual(retrievedContent.resourceSubType, contentObj.resourceSubType);
        assert.strictEqual(retrievedContent.createdBy.id, contentObj.createdBy);
        assert.strictEqual(retrievedContent.created, contentObj.created);
        assert.ok(retrievedContent.lastModified);
        assert.strictEqual(retrievedContent.resourceType, 'content');
        assert.strictEqual(
          retrievedContent.profilePath,
          '/content/' + contentObj.tenant.alias + '/' + AuthzUtil.getResourceFromId(contentObj.id).resourceId
        );
        // Check if the canManage check is appropriate
        assert.strictEqual(retrievedContent.isManager, expectManager);
        assert.strictEqual(retrievedContent.canShare, expectCanShare);
      } else {
        assert.ok(err);
        assert.ok(!retrievedContent);
      }

      // Check if the item comes back in the library
      RestAPI.Content.getLibrary(restCtx, libraryToCheck, null, 10, (err, contentItems) => {
        // If no logged in user is provided, we expect an error
        if (libraryToCheck) {
          assert.ok(!err);
          if (expectInLibrary) {
            assert.strictEqual(contentItems.results.length, 1);
            assert.strictEqual(contentItems.results[0].id, contentObj.id);
          } else {
            assert.strictEqual(contentItems.results.length, 0);
          }
        } else {
          assert.ok(err);
        }

        callback();
      });
    });
  };

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

  describe('Get content', () => {
    /**
     * Test that will create a piece of content and try to get it in an invalid
     * and valid way
     */
    it('verify get content', callback => {
      setUpUsers(contexts => {
        // Create a piece of content
        RestAPI.Content.createLink(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);

            // Try with a missing ID (send a space as otherwise it won't even hit the endpoint)
            RestAPI.Content.getContent(contexts.nicolaas.restContext, ' ', (err, retrievedContentObj) => {
              assert.strictEqual(err.code, 400);
              assert.ok(!retrievedContentObj);

              // Try with an invalid ID.
              RestAPI.Content.getContent(contexts.nicolaas.restContext, 'invalid-id', (err, retrievedContentObj) => {
                assert.strictEqual(err.code, 400);
                assert.ok(!retrievedContentObj);

                // Get the created piece of content
                RestAPI.Content.getContent(contexts.nicolaas.restContext, contentObj.id, (err, retrievedContentObj) => {
                  assert.ok(!err);
                  assert.strictEqual(retrievedContentObj.id, contentObj.id);

                  // Call the ContentAPI directly to trigger some validation errors
                  ContentAPI.getContent(null, null, err => {
                    assert.strictEqual(err.code, 400);
                    ContentAPI.getContent(null, 'invalid-id', err => {
                      assert.strictEqual(err.code, 400);
                      callback();
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

  describe('Download content', () => {
    // In order to test download URL expiry, sometimes we overload
    // `Date.now`. This method ensures after each test it gets reset
    // to the proper function
    const originalDateNow = Date.now;
    afterEach(callback => {
      Date.now = originalDateNow;
      return callback();
    });

    /**
     * Test that will create a piece of content and try to download it in an invalid
     * and valid way.
     */
    it('verify download content', callback => {
      setUpUsers(contexts => {
        // Create a piece of content
        RestAPI.Content.createFile(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PRIVATE,
          getFileStream,
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);

            // Verify that the download link gets added to a content object.
            RestAPI.Content.getContent(contexts.nicolaas.restContext, contentObj.id, (err, contentObj) => {
              assert.ok(!err);
              assert.strictEqual(
                contentObj.downloadPath,
                '/api/content/' + contentObj.id + '/download/' + contentObj.latestRevisionId
              );

              // Download it
              // The App servers don't really stream anything
              // In the tests we're using local storage, so this should result in a 204 (empty body) with the link in the x-accel-redirect header
              let path = temp.path();
              RestAPI.Content.download(contexts.nicolaas.restContext, contentObj.id, null, path, (err, response) => {
                assert.ok(!err);
                const headerKeys = _.keys(response.headers);
                assert.ok(headerKeys.includes('x-accel-redirect'));
                assert.ok(headerKeys.includes('x-sendfile'));
                assert.ok(headerKeys.includes('x-lighttpd-send-file'));

                // Try downloading it as Simon
                RestAPI.Content.download(contexts.simon.restContext, contentObj.id, null, path, (err, body) => {
                  assert.strictEqual(err.code, 401);

                  // Share it.
                  RestAPI.Content.shareContent(
                    contexts.nicolaas.restContext,
                    contentObj.id,
                    [contexts.simon.user.id],
                    err => {
                      assert.ok(!err);

                      // Simon should now be able to fetch it
                      path = temp.path();
                      RestAPI.Content.download(
                        contexts.simon.restContext,
                        contentObj.id,
                        null,
                        path,
                        (err, response) => {
                          assert.ok(!err);
                          const headerKeys = _.keys(response.headers);
                          assert.ok(headerKeys.includes('x-accel-redirect'));
                          assert.ok(headerKeys.includes('x-sendfile'));
                          assert.ok(headerKeys.includes('x-lighttpd-send-file'));

                          callback();
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

    /**
     * Test that will create different versions piece of content and try to download it in an invalid
     * and valid way.
     */
    it('verify versioned download content', callback => {
      setUpUsers(contexts => {
        // Create a piece of content
        RestAPI.Content.createFile(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PRIVATE,
          getFileStream,
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);

            // Create a new version
            RestAPI.Content.updateFileBody(contexts.nicolaas.restContext, contentObj.id, getOAELogoStream, err => {
              assert.ok(!err);

              RestAPI.Content.getRevisions(
                contexts.nicolaas.restContext,
                contentObj.id,
                null,
                null,
                (err, revisions) => {
                  assert.ok(!err);
                  assert.strictEqual(revisions.results.length, 2);

                  // Download the latest version
                  let path = temp.path();
                  RestAPI.Content.download(
                    contexts.nicolaas.restContext,
                    contentObj.id,
                    null,
                    path,
                    (err, response) => {
                      assert.ok(!err);
                      assert.strictEqual(response.statusCode, 204);
                      const url = response.headers['x-accel-redirect'];

                      // Download the oldest version
                      path = temp.path();
                      RestAPI.Content.download(
                        contexts.nicolaas.restContext,
                        contentObj.id,
                        revisions.results[1].revisionId,
                        path,
                        (err, response) => {
                          assert.ok(!err);
                          assert.strictEqual(response.statusCode, 204);
                          const oldUrl = response.headers['x-accel-redirect'];
                          assert.notStrictEqual(url, oldUrl);
                          callback();
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
     * Simple test that verifies the uri does not contain any invalid characters
     */
    it('verify uri contains no invalid characters', callback => {
      setUpUsers(contexts => {
        // Create a piece of content
        RestAPI.Content.createFile(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PRIVATE,
          getFileStream,
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);

            RestAPI.Content.getRevisions(contexts.nicolaas.restContext, contentObj.id, null, null, (err, revisions) => {
              assert.ok(!err);
              assert.strictEqual(revisions.results.length, 1);

              // The uri that sits on the revision looks like:
              // local:c/camtest/eJ/kG/Lh/-z/eJkGLh-z/rev-camtest-eygkzIhWz/oae-video.png
              // We only need to test the part after the (first colon)
              const uri = revisions.results[0].uri
                .split(':')
                .slice(1)
                .join(':');
              assert.ok(!/[^-_0-9A-Za-z/.]/.test(uri));
              callback();
            });
          }
        );
      });
    });

    /*
     * Test that will verify the validation of signed urls.
     */
    it('verify validation of signed urls', callback => {
      setUpUsers(contexts => {
        // Generate a signed download url for Branden
        const tenant = TenantsAPI.getTenant(contexts.branden.user.tenant.alias);
        const signedDownloadUrl = ContentUtil.getSignedDownloadUrl(
          new Context(tenant, contexts.branden.user),
          'local:2012/12/06/file.doc'
        );
        const parsedUrl = new URL(signedDownloadUrl, 'http://localhost');

        // Branden should be able to download it because he is super awesome and important (In this case, downloading = 204)
        RestUtil.performRestRequest(
          contexts.branden.restContext,
          '/api/download/signed',
          'GET',
          TestsUtil.objectifySearchParams(parsedUrl.searchParams),
          (err, body, response) => {
            assert.ok(!err);
            assert.strictEqual(response.statusCode, 204);

            // Simon should be able to download the content item using the same signature
            RestUtil.performRestRequest(
              contexts.simon.restContext,
              '/api/download/signed',
              'GET',
              TestsUtil.objectifySearchParams(parsedUrl.searchParams),
              (err, body, response) => {
                assert.ok(!err);

                // Global admin should be able to download the content item using the same signature
                RestUtil.performRestRequest(
                  globalAdminRestContext,
                  '/api/download/signed',
                  'GET',
                  TestsUtil.objectifySearchParams(parsedUrl.searchParams),
                  (err, body, response) => {
                    assert.ok(!err);

                    // An anonymous user can download it using the same signature as well
                    RestUtil.performRestRequest(
                      anonymousRestContext,
                      '/api/download/signed',
                      'GET',
                      TestsUtil.objectifySearchParams(parsedUrl.searchParams),
                      (err, body, response) => {
                        assert.ok(!err);

                        // Missing uri
                        RestUtil.performRestRequest(
                          contexts.branden.restContext,
                          '/api/download/signed',
                          'GET',
                          _.omit(TestsUtil.objectifySearchParams(parsedUrl.searchParams), 'uri'),
                          (err, body, request) => {
                            assert.strictEqual(err.code, 401);

                            // Different uri has an invalid signature
                            RestUtil.performRestRequest(
                              contexts.branden.restContext,
                              '/api/download/signed',
                              'GET',
                              _.extend({}, TestsUtil.objectifySearchParams(parsedUrl.searchParams), {
                                uri: 'blahblahblah'
                              }),
                              (err, body, request) => {
                                assert.strictEqual(err.code, 401);

                                // Missing signature parameter
                                RestUtil.performRestRequest(
                                  contexts.branden.restContext,
                                  '/api/download/signed',
                                  'GET',
                                  _.omit(TestsUtil.objectifySearchParams(parsedUrl.searchParams), 'signature'),
                                  (err, body, request) => {
                                    assert.strictEqual(err.code, 401);

                                    // Different signature should fail assertion
                                    RestUtil.performRestRequest(
                                      contexts.branden.restContext,
                                      '/api/download/signed',
                                      'GET',
                                      _.extend({}, TestsUtil.objectifySearchParams(parsedUrl.searchParams), {
                                        signature: 'ATTACK LOL!!'
                                      }),
                                      (err, body, request) => {
                                        assert.strictEqual(err.code, 401);

                                        // Missing expires parameter
                                        RestUtil.performRestRequest(
                                          contexts.branden.restContext,
                                          '/api/download/signed',
                                          'GET',
                                          _.omit(TestsUtil.objectifySearchParams(parsedUrl.searchParams), 'expires'),
                                          (err, body, request) => {
                                            assert.strictEqual(err.code, 401);

                                            // Missing signature parameter
                                            RestUtil.performRestRequest(
                                              contexts.branden.restContext,
                                              '/api/download/signed',
                                              'GET',
                                              _.extend({}, TestsUtil.objectifySearchParams(parsedUrl.searchParams), {
                                                expires: 2345678901
                                              }),
                                              (err, body, request) => {
                                                assert.strictEqual(err.code, 401);

                                                // Jump into a time machine to see if the signature is valid in 15d. It should have expired
                                                const now = Date.now();
                                                Date.now = function() {
                                                  return now + 15 * 24 * 60 * 60 * 1000;
                                                };

                                                RestUtil.performRestRequest(
                                                  contexts.branden.restContext,
                                                  '/api/download/signed',
                                                  'GET',
                                                  TestsUtil.objectifySearchParams(parsedUrl.searchParams),
                                                  (err, body, response) => {
                                                    assert.strictEqual(err.code, 401);
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

  describe('Content comments', () => {
    /**
     * Posts a given number of comments on a content item. A random commenter and comment are picked for each comment.
     *
     * @param  {Object}    contexts       Object containing REST Contexts
     * @param  {String}    contentId      The ID of the content to comment on
     * @param  {Number}    numComments    Number of comments to place on the content item
     * @param  {String}    [replyTo]      The timestamp (millis since the epoch) that the comment we're replying to (if any) was created
     * @param  {Function}  callback       Standard callback function
     */
    const createComments = function(contexts, contentId, numComments, replyTo, callback) {
      let done = 0;
      contexts = _.toArray(contexts);

      /**
       * Returns a random user REST Context from the contexts passed in to `createComments`
       * @return {RestContext}    REST Context object for a user
       */
      const getRandomCommenter = function() {
        return contexts[Math.floor(Math.random() * contexts.length)].restContext;
      };

      /**
       * Verifies that the comment was created successfully and triggers the creation of another comment if necessary.
       * @param  {Object}   err   Error object indicating that the comment was successfully created or not.
       */
      const commentCreated = function(err, comment) {
        assert.ok(!err);
        assert.ok(comment);
        if (done === numComments) {
          callback();
        } else {
          done++;
          createComment();
        }
      };

      /**
       * Posts a comment on a specified contentId and uses a random commenter and comment
       */
      const createComment = function() {
        RestAPI.Content.createComment(
          getRandomCommenter(),
          contentId,
          util.format('Comment #%s', done),
          replyTo,
          commentCreated
        );
      };

      done++;
      createComment();
    };

    /**
     * Test that will create a comment on content
     */
    it('verify create comment', callback => {
      setUpUsers(contexts => {
        // Create a piece of content
        RestAPI.Content.createLink(
          contexts.bert.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);

            // Get the created piece of content
            RestAPI.Content.getContent(contexts.bert.restContext, contentObj.id, (err, retrievedContentObj) => {
              assert.ok(!err);
              assert.strictEqual(retrievedContentObj.id, contentObj.id);

              // Create 10 comments
              createComments(contexts, contentObj.id, 10, null, () => {
                // Create one more and verify that it comes back as the first comment in the list
                RestAPI.Content.createComment(
                  contexts.bert.restContext,
                  contentObj.id,
                  'This comment should be on top of the list',
                  null,
                  (err, comment) => {
                    assert.ok(!err);
                    assert.strictEqual(comment.createdBy.publicAlias, 'Bert Pareyn');
                    assert.strictEqual(comment.level, 0);
                    assert.strictEqual(comment.body, 'This comment should be on top of the list');
                    assert.strictEqual(comment.messageBoxId, contentObj.id);
                    assert.strictEqual(comment.threadKey, comment.created + '|');
                    assert.ok(comment.id);
                    assert.ok(comment.created);

                    // Make sure there is NOT an error if "" is sent instead of undefined
                    RestAPI.Content.createComment(
                      contexts.bert.restContext,
                      contentObj.id,
                      'This comment should be on top of the list',
                      '',
                      (err, comment) => {
                        assert.ok(!err);

                        // Get the comments and verify that the item on top of the list is the correct one
                        RestAPI.Content.getComments(
                          contexts.bert.restContext,
                          contentObj.id,
                          null,
                          10,
                          (err, comments) => {
                            assert.ok(!err);

                            assert.strictEqual(comments.results.length, 10);
                            assert.strictEqual(comments.results[0].createdBy.publicAlias, 'Bert Pareyn');
                            assert.strictEqual(comments.results[0].level, 0);
                            assert.strictEqual(comments.results[0].body, 'This comment should be on top of the list');
                            assert.strictEqual(comment.messageBoxId, contentObj.id);
                            assert.strictEqual(comment.threadKey, comment.created + '|');
                            assert.ok(comment.id);
                            assert.ok(comment.created);
                            callback();
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
     * Test that verifies that comments contain user profile pictures
     */
    it('verify comments contain user profile pictures', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, bert, nicolaas) => {
        assert.ok(!err);

        /**
         * Return a profile picture stream
         *
         * @return {Stream}     A stream containing an profile picture
         */
        const getPictureStream = function() {
          const file = path.join(__dirname, '/data/profilepic.jpg');
          return fs.createReadStream(file);
        };

        // Give one of the users a profile picture
        const cropArea = { x: 0, y: 0, width: 250, height: 250 };
        RestAPI.User.uploadPicture(bert.restContext, bert.user.id, getPictureStream, cropArea, err => {
          assert.ok(!err);

          // Create a piece of content that we can comment on and share it with a user that has no profile picture
          RestAPI.Content.createLink(
            bert.restContext,
            'displayName',
            'description',
            PUBLIC,
            'http://www.oaeproject.org',
            [],
            [nicolaas.user.id],
            [],
            (err, contentObj) => {
              assert.ok(!err);

              // Add a comment to the piece of content as a user with a profile picture
              RestAPI.Content.createComment(bert.restContext, contentObj.id, 'Bleh', null, (err, comment) => {
                assert.ok(!err);

                // Assert that the picture URLs are present
                assert.ok(comment.createdBy);
                assert.ok(comment.createdBy.picture);
                assert.ok(comment.createdBy.picture.small);
                assert.ok(comment.createdBy.picture.medium);
                assert.ok(comment.createdBy.picture.large);

                // Assert that this works for replies as well
                RestAPI.Content.createComment(
                  bert.restContext,
                  contentObj.id,
                  'Blah',
                  comment.created,
                  (err, reply) => {
                    assert.ok(!err);

                    // Assert that the picture URLs are present
                    assert.ok(reply.createdBy);
                    assert.ok(reply.createdBy.picture);
                    assert.ok(reply.createdBy.picture.small);
                    assert.ok(reply.createdBy.picture.medium);
                    assert.ok(reply.createdBy.picture.large);

                    // Add a comment to the piece of content as a user with no profile picture
                    RestAPI.Content.createComment(nicolaas.restContext, contentObj.id, 'Blih', null, (err, comment) => {
                      assert.ok(!err);

                      // Assert that no picture URLs are present
                      assert.ok(comment.createdBy);
                      assert.ok(comment.createdBy.picture);
                      assert.ok(!comment.createdBy.picture.small);
                      assert.ok(!comment.createdBy.picture.medium);
                      assert.ok(!comment.createdBy.picture.large);

                      // Assert that this works for replies as well
                      RestAPI.Content.createComment(
                        nicolaas.restContext,
                        contentObj.id,
                        'Bluh',
                        comment.created,
                        (err, reply) => {
                          assert.ok(!err);

                          // Assert that no picture URLs are present
                          assert.ok(reply.createdBy);
                          assert.ok(reply.createdBy.picture);
                          assert.ok(!reply.createdBy.picture.small);
                          assert.ok(!reply.createdBy.picture.medium);
                          assert.ok(!reply.createdBy.picture.large);

                          // Assert the profile picture urls are present when retrieven a list of comments
                          RestAPI.Content.getComments(bert.restContext, contentObj.id, null, 10, (err, comments) => {
                            assert.ok(!err);
                            assert.strictEqual(comments.results.length, 4);
                            _.each(comments.results, comment => {
                              assert.ok(comment.createdBy);
                              assert.ok(comment.createdBy.picture);
                              // Verify that the comments have a picture for the user that
                              // has a profile picture
                              if (comment.createdBy.id === bert.user.id) {
                                assert.ok(comment.createdBy.picture.small);
                                assert.ok(comment.createdBy.picture.medium);
                                assert.ok(comment.createdBy.picture.large);
                                // Verify that the comments don't have a picture for the user
                                // without a profile picture
                              } else if (comment.createdBy.id === nicolaas.user.id) {
                                assert.ok(!comment.createdBy.picture.small);
                                assert.ok(!comment.createdBy.picture.medium);
                                assert.ok(!comment.createdBy.picture.large);
                              } else {
                                assert.fail('Unexpected user in comments');
                              }
                            });
                            return callback();
                          });
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
    });

    /**
     * Test that will create a reply to a comment on content (thread)
     */
    it('verify reply to comment (threaded)', callback => {
      setUpUsers(contexts => {
        // Create a piece of content
        RestAPI.Content.createLink(
          contexts.bert.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);

            // Get the created piece of content
            RestAPI.Content.getContent(contexts.bert.restContext, contentObj.id, (err, retrievedContentObj) => {
              assert.ok(!err);
              assert.strictEqual(retrievedContentObj.id, contentObj.id);

              // Create a comment on the content item
              RestAPI.Content.createComment(
                contexts.bert.restContext,
                contentObj.id,
                'This comment should be second in the list',
                null,
                (err, comment0) => {
                  assert.ok(!err);
                  assert.ok(comment0);

                  const secondInListCreated = comment0.created;

                  // Get the comments to verify that it's been placed correctly
                  RestAPI.Content.getComments(contexts.bert.restContext, contentObj.id, null, 10, (err, comments) => {
                    assert.ok(!err);
                    assert.strictEqual(comments.results.length, 1);
                    assert.strictEqual(comments.results[0].createdBy.publicAlias, 'Bert Pareyn');

                    // Add a reply to the comment
                    RestAPI.Content.createComment(
                      contexts.bert.restContext,
                      contentObj.id,
                      'Reply to second comment in the list',
                      comments.results[0].created,
                      (err, comment1) => {
                        assert.ok(!err);
                        assert.strictEqual(comment1.createdBy.publicAlias, 'Bert Pareyn');
                        assert.strictEqual(comment1.level, 1);
                        assert.strictEqual(comment1.body, 'Reply to second comment in the list');
                        assert.strictEqual(comment1.messageBoxId, contentObj.id);
                        assert.strictEqual(comment1.threadKey, secondInListCreated + '#' + comment1.created + '|');
                        assert.ok(comment1.id);
                        assert.ok(comment1.created);

                        RestAPI.Content.getComments(
                          contexts.bert.restContext,
                          contentObj.id,
                          null,
                          10,
                          (err, comments) => {
                            assert.ok(!err);
                            assert.strictEqual(comments.results[0].level, 0);
                            assert.strictEqual(comments.results[1].level, 1);

                            // Add a reply to the first reply
                            RestAPI.Content.createComment(
                              contexts.bert.restContext,
                              contentObj.id,
                              'A reply to the reply on the second comment in the list',
                              comments.results[1].created,
                              (err, comment2) => {
                                assert.ok(!err);
                                assert.ok(comment2);

                                // Add a second comment to the content item
                                RestAPI.Content.createComment(
                                  contexts.bert.restContext,
                                  contentObj.id,
                                  'This comment should be first in the list',
                                  null,
                                  (err, comment3) => {
                                    assert.ok(!err);
                                    assert.ok(comment3);

                                    RestAPI.Content.getComments(
                                      contexts.bert.restContext,
                                      contentObj.id,
                                      null,
                                      10,
                                      (err, comments) => {
                                        assert.ok(!err);

                                        // Check level of the replies
                                        assert.strictEqual(comments.results[0].level, 0); // Last level 0 comment made
                                        assert.strictEqual(comments.results[0].id, comment3.id);
                                        assert.strictEqual(comments.results[1].level, 0); // First level 0 comment made
                                        assert.strictEqual(comments.results[1].id, comment0.id);
                                        assert.strictEqual(comments.results[2].level, 1); // First reply to first comment made
                                        assert.strictEqual(comments.results[2].id, comment1.id);
                                        assert.strictEqual(comments.results[3].level, 2); // Reply to the reply
                                        assert.strictEqual(comments.results[3].id, comment2.id);

                                        // Check that replies to a comment reference the correct comment
                                        assert.strictEqual(comments.results[1].created, comments.results[2].replyTo);
                                        assert.strictEqual(comments.results[2].created, comments.results[3].replyTo);

                                        // Try to post a reply without a content ID
                                        RestAPI.Content.createComment(
                                          contexts.bert.restContext,
                                          null,
                                          'This is an updated comment',
                                          '1231654351',
                                          (err, comment) => {
                                            assert.ok(err);
                                            assert.ok(!comment);

                                            // Verify that paging results the order of threaded comments
                                            RestAPI.Content.createLink(
                                              contexts.bert.restContext,
                                              'Test Content',
                                              'Test content description',
                                              PUBLIC,
                                              'http://www.oaeproject.org/',
                                              [],
                                              [],
                                              [],
                                              (err, contentObj) => {
                                                assert.ok(!err);
                                                assert.ok(contentObj.id);

                                                // Create 10 top-level (level === 0) comments
                                                createComments(contexts, contentObj.id, 10, null, () => {
                                                  RestAPI.Content.getComments(
                                                    contexts.bert.restContext,
                                                    contentObj.id,
                                                    null,
                                                    10,
                                                    (err, comments) => {
                                                      assert.ok(!err);
                                                      assert.strictEqual(comments.results.length, 10);

                                                      // Create 10 replies to the 6th comment returned in the previous comments
                                                      createComments(
                                                        contexts,
                                                        contentObj.id,
                                                        10,
                                                        comments.results[5].created,
                                                        () => {
                                                          // Verify the depth/level of the first set of 10 comments
                                                          RestAPI.Content.getComments(
                                                            contexts.bert.restContext,
                                                            contentObj.id,
                                                            null,
                                                            10,
                                                            (err, comments) => {
                                                              assert.ok(!err);
                                                              assert.strictEqual(comments.results.length, 10);

                                                              // First 6 comments are level 0 comments
                                                              assert.strictEqual(comments.results[0].level, 0);
                                                              assert.strictEqual(comments.results[1].level, 0);
                                                              assert.strictEqual(comments.results[2].level, 0);
                                                              assert.strictEqual(comments.results[3].level, 0);
                                                              assert.strictEqual(comments.results[4].level, 0);
                                                              assert.strictEqual(comments.results[5].level, 0);

                                                              // 7, 8 and 9 are level-1 replies (as they are replies to comments.results[5])
                                                              assert.strictEqual(comments.results[6].level, 1);
                                                              assert.strictEqual(comments.results[7].level, 1);
                                                              assert.strictEqual(comments.results[8].level, 1);
                                                              assert.strictEqual(comments.results[9].level, 1);

                                                              // Verify the depth/level of the second set of 10 comments
                                                              RestAPI.Content.getComments(
                                                                contexts.bert.restContext,
                                                                contentObj.id,
                                                                comments.nextToken,
                                                                10,
                                                                (err, comments) => {
                                                                  assert.ok(!err);
                                                                  assert.strictEqual(comments.results.length, 10);

                                                                  // Comments 0-5 in the list should all be level 1 (replies to the previous comment)
                                                                  assert.strictEqual(comments.results[0].level, 1);
                                                                  assert.strictEqual(comments.results[1].level, 1);
                                                                  assert.strictEqual(comments.results[2].level, 1);
                                                                  assert.strictEqual(comments.results[3].level, 1);
                                                                  assert.strictEqual(comments.results[4].level, 1);
                                                                  assert.strictEqual(comments.results[5].level, 1);

                                                                  // Original level 0 comments continue from here on
                                                                  assert.strictEqual(comments.results[6].level, 0);
                                                                  assert.strictEqual(comments.results[7].level, 0);
                                                                  assert.strictEqual(comments.results[8].level, 0);
                                                                  assert.strictEqual(comments.results[9].level, 0);

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
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that will retrieve comments
     */
    it('verify retrieve comments', callback => {
      setUpUsers(contexts => {
        // Create a piece of content
        RestAPI.Content.createLink(
          contexts.bert.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);

            // Get the created piece of content
            RestAPI.Content.getContent(contexts.bert.restContext, contentObj.id, (err, retrievedContentObj) => {
              assert.ok(!err);
              assert.strictEqual(retrievedContentObj.id, contentObj.id);

              // Create one more and verify that it comes back as the first comment in the list
              RestAPI.Content.createComment(
                contexts.bert.restContext,
                contentObj.id,
                'This comment should be on top of the list',
                null,
                (err, comment) => {
                  assert.ok(!err);
                  assert.ok(comment);

                  // Get the comments and verify that the item on top of the list is the correct one
                  RestAPI.Content.getComments(contexts.bert.restContext, contentObj.id, null, 10, (err, comments) => {
                    assert.ok(!err);
                    assert.strictEqual(comments.results.length, 1);
                    assert.strictEqual(comments.results[0].createdBy.publicAlias, 'Bert Pareyn');

                    // Try to get the comments for a content item without specifying the content ID
                    RestAPI.Content.getComments(contexts.bert.restContext, null, null, 10, (err, comments) => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 404);

                      RestAPI.Content.getComments(contexts.bert.restContext, ' ', null, 10, (err, comments) => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 400);
                        RestAPI.Content.getComments(
                          contexts.bert.restContext,
                          'invalid-id',
                          null,
                          10,
                          (err, comments) => {
                            assert.ok(err);
                            assert.strictEqual(err.code, 400);
                            callback();
                          }
                        );
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
     * Test that verifies that comments can be paged through
     */
    it('verify retrieve comments paging', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        const ctx = _.values(users)[0].restContext;

        RestAPI.Content.createLink(
          ctx,
          'Test Content',
          'Test content description',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);

            // Create 8 comments
            createComments(_.values(users), contentObj.id, 8, null, () => {
              // Get the first 3 comments
              RestAPI.Content.getComments(ctx, contentObj.id, null, 3, (err, comments) => {
                assert.ok(!err);
                assert.strictEqual(comments.nextToken, comments.results[2].threadKey);
                assert.strictEqual(comments.results.length, 3);

                // Get the next 3 comments
                RestAPI.Content.getComments(ctx, contentObj.id, comments.nextToken, 3, (err, comments) => {
                  assert.ok(!err);
                  assert.strictEqual(comments.nextToken, comments.results[2].threadKey);
                  assert.strictEqual(comments.results.length, 3);

                  // Get the last 2 comments
                  RestAPI.Content.getComments(ctx, contentObj.id, comments.nextToken, 3, (err, comments) => {
                    assert.ok(!err);
                    assert.ok(!comments.nextToken);
                    assert.strictEqual(comments.results.length, 2);
                    callback();
                  });
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that will delete a comment from content
     */
    it('verify delete comment', callback => {
      setUpUsers(contexts => {
        // Create a piece of content
        RestAPI.Content.createLink(
          contexts.bert.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);

            // Get the created piece of content
            RestAPI.Content.getContent(contexts.bert.restContext, contentObj.id, (err, retrievedContentObj) => {
              assert.ok(!err);
              assert.strictEqual(retrievedContentObj.id, contentObj.id);

              // Create a comment
              RestAPI.Content.createComment(
                contexts.bert.restContext,
                contentObj.id,
                'This comment will be deleted.',
                null,
                (err, comment) => {
                  assert.ok(!err);
                  assert.ok(comment);

                  // Get the comments and verify that the new comment was created
                  RestAPI.Content.getComments(contexts.bert.restContext, contentObj.id, null, 10, (err, comments) => {
                    assert.ok(!err);
                    assert.strictEqual(comments.results.length, 1);
                    assert.strictEqual(comments.results[0].createdBy.publicAlias, 'Bert Pareyn');

                    RestAPI.Content.createComment(
                      contexts.bert.restContext,
                      contentObj.id,
                      'This is a reply on the comment that will be deleted.',
                      comments.results[0].created,
                      (err, comment) => {
                        assert.ok(!err);
                        assert.ok(comment);

                        // Delete the comment
                        RestAPI.Content.deleteComment(
                          contexts.bert.restContext,
                          contentObj.id,
                          comments.results[0].created,
                          (err, softDeleted) => {
                            assert.ok(!err);
                            assert.ok(softDeleted.deleted);
                            assert.ok(!softDeleted.body);

                            // Check that the first comment was not deleted because there was a reply, instead it's marked as deleted
                            RestAPI.Content.getComments(
                              contexts.bert.restContext,
                              contentObj.id,
                              null,
                              10,
                              (err, comments) => {
                                assert.ok(!err);
                                assert.strictEqual(comments.results.length, 2);
                                assert.ok(comments.results[0].deleted);

                                // Create a reply on the reply
                                RestAPI.Content.createComment(
                                  contexts.bert.restContext,
                                  contentObj.id,
                                  'This is a reply on the reply on a comment that will be deleted.',
                                  comments.results[1].created,
                                  (err, comment) => {
                                    assert.ok(!err);
                                    assert.ok(comment);

                                    // Delete reply on comment
                                    RestAPI.Content.deleteComment(
                                      contexts.bert.restContext,
                                      contentObj.id,
                                      comments.results[1].created,
                                      (err, softDeleted) => {
                                        assert.ok(!err);
                                        assert.ok(softDeleted.deleted);
                                        assert.ok(!softDeleted.body);

                                        // Check that the first reply was not deleted because there was a reply, instead it's marked as deleted
                                        RestAPI.Content.getComments(
                                          contexts.bert.restContext,
                                          contentObj.id,
                                          null,
                                          10,
                                          (err, comments) => {
                                            assert.ok(!err);
                                            assert.strictEqual(comments.results.length, 3);
                                            assert.ok(comments.results[1].deleted);
                                            assert.strictEqual(comments.results[1].contentId, undefined);
                                            assert.strictEqual(comments.results[1].createdBy, undefined);
                                            assert.ok(comments.results[1].created);
                                            assert.strictEqual(comments.results[1].body, undefined);
                                            assert.strictEqual(comments.results[1].level, 1);
                                            assert.strictEqual(comments.results[1].id, comments.results[1].id);

                                            // Delete reply on reply
                                            RestAPI.Content.deleteComment(
                                              contexts.bert.restContext,
                                              contentObj.id,
                                              comments.results[2].created,
                                              (err, softDeleted) => {
                                                assert.ok(!err);
                                                assert.ok(!softDeleted);

                                                // Delete reply on comment
                                                RestAPI.Content.deleteComment(
                                                  contexts.bert.restContext,
                                                  contentObj.id,
                                                  comments.results[1].created,
                                                  (err, softDeleted) => {
                                                    assert.ok(!err);
                                                    assert.ok(!softDeleted);

                                                    // Delete original comment
                                                    RestAPI.Content.deleteComment(
                                                      contexts.bert.restContext,
                                                      contentObj.id,
                                                      comments.results[0].created,
                                                      (err, softDeleted) => {
                                                        assert.ok(!err);
                                                        assert.ok(!softDeleted);

                                                        // Verify that all comments were deleted
                                                        RestAPI.Content.getComments(
                                                          contexts.bert.restContext,
                                                          contentObj.id,
                                                          null,
                                                          10,
                                                          (err, comments) => {
                                                            assert.ok(!err);
                                                            assert.strictEqual(comments.results.length, 0);
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
          }
        );
      });
    });

    /**
     * Test that will verify permissions when deleting comments
     */
    it('verify delete comment permissions', callback => {
      setUpUsers(contexts => {
        // Create a first piece of content where simon has full access
        RestAPI.Content.createLink(
          contexts.simon.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, publicContentObj) => {
            assert.ok(!err);
            assert.ok(publicContentObj);
            // Create a second piece of content where simon is a member
            RestAPI.Content.createLink(
              contexts.nicolaas.restContext,
              'Test Content 2',
              'Test content description 2',
              PRIVATE,
              'http://www.oaeproject.org/',
              [],
              [contexts.simon.user.id],
              [],
              (err, privateContentObj) => {
                assert.ok(!err);
                assert.ok(privateContentObj);
                // Create 2 comments as simon on the private link
                RestAPI.Content.createComment(
                  contexts.simon.restContext,
                  privateContentObj.id,
                  'This is a first comment.',
                  null,
                  (err, comment) => {
                    assert.ok(!err);
                    assert.ok(comment);

                    RestAPI.Content.createComment(
                      contexts.simon.restContext,
                      privateContentObj.id,
                      'This is a second comment.',
                      null,
                      (err, comment) => {
                        assert.ok(!err);
                        assert.ok(comment);

                        // Get the comments to verify they were created successfully
                        RestAPI.Content.getComments(
                          contexts.simon.restContext,
                          privateContentObj.id,
                          null,
                          10,
                          (err, comments) => {
                            assert.ok(!err);
                            assert.strictEqual(comments.results.length, 2);

                            const comment1 = comments.results[1];
                            const comment2 = comments.results[0];

                            assert.strictEqual(comment2.createdBy.id, contexts.simon.user.id);
                            assert.strictEqual(comment2.body, 'This is a second comment.');
                            assert.strictEqual(comment1.createdBy.id, contexts.simon.user.id);
                            assert.strictEqual(comment1.body, 'This is a first comment.');

                            // Try to delete a comment
                            RestAPI.Content.deleteComment(
                              contexts.simon.restContext,
                              privateContentObj.id,
                              comment2.created,
                              (err, softDeleted) => {
                                assert.ok(!err);
                                assert.ok(!softDeleted);

                                // Verify that the comment has been deleted
                                RestAPI.Content.getComments(
                                  contexts.simon.restContext,
                                  privateContentObj.id,
                                  null,
                                  10,
                                  (err, comments) => {
                                    assert.ok(!err);
                                    assert.strictEqual(comments.results.length, 1);
                                    assert.strictEqual(comments.results[0].id, comment1.id);

                                    // Remove simon as a member from the private content
                                    const permissions = {};
                                    permissions[contexts.simon.user.id] = false;
                                    RestAPI.Content.updateMembers(
                                      contexts.nicolaas.restContext,
                                      privateContentObj.id,
                                      permissions,
                                      err => {
                                        assert.ok(!err);

                                        // Try to delete the comment on the private content item
                                        RestAPI.Content.deleteComment(
                                          contexts.simon.restContext,
                                          publicContentObj.id,
                                          comment1.created,
                                          (err, softDeleted) => {
                                            assert.ok(err);
                                            assert.strictEqual(err.code, 404);
                                            assert.ok(!softDeleted);

                                            // Get the comment to verify that it wasn't deleted
                                            RestAPI.Content.getComments(
                                              contexts.nicolaas.restContext,
                                              privateContentObj.id,
                                              null,
                                              10,
                                              (err, comments) => {
                                                assert.ok(!err);
                                                assert.strictEqual(comments.results.length, 1);
                                                assert.strictEqual(comments.results[0].id, comment1.id);
                                                assert.strictEqual(
                                                  comments.results[0].createdBy.id,
                                                  contexts.simon.user.id
                                                );
                                                assert.strictEqual(
                                                  comments.results[0].body,
                                                  'This is a first comment.'
                                                );

                                                // Try to reply to the comment on the private content item
                                                RestAPI.Content.createComment(
                                                  contexts.simon.restContext,
                                                  publicContentObj.id,
                                                  "This reply on the comment shouldn't be accepted",
                                                  comment1.created,
                                                  (err, comment) => {
                                                    assert.ok(err);
                                                    assert.strictEqual(err.code, 400);
                                                    assert.ok(!comment);

                                                    // Get the comment to verify that it wasn't created
                                                    RestAPI.Content.getComments(
                                                      contexts.nicolaas.restContext,
                                                      privateContentObj.id,
                                                      null,
                                                      10,
                                                      (err, comments) => {
                                                        assert.ok(!err);
                                                        assert.strictEqual(comments.results.length, 1);
                                                        assert.strictEqual(comments.results[0].id, comment1.id);
                                                        assert.strictEqual(
                                                          comments.results[0].createdBy.id,
                                                          contexts.simon.user.id
                                                        );
                                                        assert.strictEqual(
                                                          comments.results[0].body,
                                                          'This is a first comment.'
                                                        );

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
     * Test that will verify delete comment validation
     */
    it('verify delete comment validation', callback => {
      setUpUsers(contexts => {
        // Create a public piece of content
        RestAPI.Content.createLink(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);
            // Create a comment as bert
            RestAPI.Content.createComment(
              contexts.bert.restContext,
              contentObj.id,
              'This is a comment.',
              null,
              (err, comment) => {
                assert.ok(!err);
                assert.ok(comment);
                // Get the comment verify that it was created successfully
                RestAPI.Content.getComments(contexts.bert.restContext, contentObj.id, null, 10, (err, comments) => {
                  assert.ok(!err);
                  assert.strictEqual(comments.results.length, 1);
                  assert.strictEqual(comments.results[0].createdBy.id, contexts.bert.user.id);
                  assert.strictEqual(comments.results[0].body, 'This is a comment.');
                  const commentId = comments.results[0].id;
                  callback();
                });
              }
            );
          }
        );
      });
    });

    /**
     * Will test if users are able to delete comments from content.
     *
     * @param  {Object}    contexts         An object containing generated users
     * @param  {String}    visibility       The visibility setting for the content to be created. Can be `private`, `loggedin` or `public`
     * @param  {Boolean}   expectedDelete   If it is expected that content can be deleted
     * @param  {Function}  callback         Standard callback function
     * @param  {function}  callback.err     Error object coming out of the tests
     */
    const testDeleteCommentPermissions = function(contexts, visibility, expectedDelete, callback) {
      const { bert, nicolaas, simon } = contexts;

      /**
       * Function that creates a piece of content, comments on the content, verifies that the comment exists and deletes the comment before executing a callback.
       *
       * @param  {RestContext}   linkContext       The RestContext object of a user to create the content item with
       * @param  {RestContext}   commentContext    The RestContext object of a user to comment on the content item with
       * @param  {RestContext}   deleteContext     The RestContext object of a user to delete the comment with
       * @param  {String}        visibility        The visibility of the content item that will be created (PUBLIC, LOGGEDIN or PRIVATE)
       * @param  {String[]}      managers          An array of user IDs that will be added as managers to the newly created content
       * @param  {String[]}      members           An array of user IDs that will be added as members (viewers) to the newly created content
       * @param  {Function}      callback          Standard callback function
       * @param  {Object}        callback.err      An error that occurred, if any
       * @api private
       */
      const _canDelete = function(
        linkContext,
        commentContext,
        deleteContext,
        visibility,
        managers,
        members,
        expectedDelete,
        callback
      ) {
        RestAPI.Content.createLink(
          linkContext.restContext,
          'Test Content',
          'Test content description',
          visibility,
          'http://www.oaeproject.org/',
          [],
          members,
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            RestAPI.Content.createComment(
              commentContext.restContext,
              contentObj.id,
              'Comment to check access',
              null,
              (err, comment) => {
                if (expectedDelete) {
                  assert.ok(!err);
                  assert.ok(comment);
                } else {
                  assert.ok(err);
                  assert.ok(!comment);
                  return callback(err);
                }

                RestAPI.Content.getComments(linkContext.restContext, contentObj.id, null, 10, (err, comments) => {
                  assert.ok(!err);
                  assert.strictEqual(comments.results[0].level, 0);
                  assert.strictEqual(comments.results[0].body, 'Comment to check access');
                  assert.strictEqual(comments.results[0].createdBy.id, commentContext.user.id);

                  RestAPI.Content.deleteComment(
                    deleteContext.restContext || deleteContext,
                    contentObj.id,
                    comments.results[0].created,
                    callback
                  );
                });
              }
            );
          }
        );
      };

      // Delete own comment as manager on piece of content (--> success)
      _canDelete(bert, bert, bert, visibility, [], [], true, err => {
        assert.ok(!err);
        // Delete other's comment as manager on piece of content (--> success)
        _canDelete(bert, simon, bert, visibility, [], [contexts.simon.user.id], true, (err, softDeleted) => {
          assert.ok(!err);
          assert.ok(!softDeleted);
          // Delete own comment as member on piece of content (--> success)
          _canDelete(bert, simon, simon, visibility, [], [contexts.simon.user.id], true, (err, softDeleted) => {
            assert.ok(!err);
            assert.ok(!softDeleted);
            // Delete other's comment as member on piece of content (--> fail)
            _canDelete(bert, bert, simon, visibility, [], [contexts.simon.user.id], true, (err, softDeleted) => {
              assert.ok(err);
              assert.ok(!softDeleted);
              // Delete own comment as logged in on piece of content (--> success)
              _canDelete(bert, simon, simon, visibility, [], [], expectedDelete, (err, softDeleted) => {
                if (expectedDelete) {
                  assert.ok(!err);
                  assert.ok(!softDeleted, true);
                } else {
                  assert.ok(err);
                  assert.ok(!softDeleted);
                }

                // Delete comment as anonymous on piece of content (--> fail)
                _canDelete(bert, bert, anonymousRestContext, visibility, [], [], true, (err, softDeleted) => {
                  assert.ok(err);
                  assert.ok(!softDeleted);
                  callback();
                });
              });
            });
          });
        });
      });
    };

    /**
     * Test that will verify delete permissions for comments on public content
     */
    it('verify delete comment permissions public', callback => {
      setUpUsers(contexts => {
        testDeleteCommentPermissions(contexts, PUBLIC, true, callback);
      });
    });

    /**
     * Test that will verify delete permissions for comments on loggedin content
     */
    it('verify delete comment permissions loggedin', callback => {
      setUpUsers(contexts => {
        testDeleteCommentPermissions(contexts, LOGGEDIN, true, callback);
      });
    });

    /**
     * Test that will verify delete permissions for comments on private content
     */
    it('verify delete comment permissions private', callback => {
      setUpUsers(contexts => {
        testDeleteCommentPermissions(contexts, PRIVATE, false, callback);
      });
    });

    /**
     * Test that will verify comment creation validation
     */
    it('verify create comment validation', callback => {
      setUpUsers(contexts => {
        // Create a piece of content
        RestAPI.Content.createLink(
          contexts.bert.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);

            // Try to create a comment without a contentId
            RestAPI.Content.createComment(
              contexts.bert.restContext,
              null,
              'This comment should be on top of the list',
              null,
              (err, comment) => {
                assert.ok(err);
                assert.strictEqual(err.code, 404);
                assert.ok(!comment);

                // Verify that the comment wasn't created
                RestAPI.Content.getComments(contexts.bert.restContext, contentObj.id, null, 10, (err, comments) => {
                  assert.ok(!err);
                  assert.strictEqual(comments.results.length, 0);

                  // Try to create a comment without a comment
                  RestAPI.Content.createComment(
                    contexts.bert.restContext,
                    contentObj.id,
                    null,
                    null,
                    (err, comment) => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 400);
                      assert.ok(!comment);

                      // Verify that the comment wasn't created
                      RestAPI.Content.getComments(
                        contexts.bert.restContext,
                        contentObj.id,
                        null,
                        10,
                        (err, comments) => {
                          assert.ok(!err);
                          assert.strictEqual(comments.results.length, 0);

                          // Try to create a comment without a valid replyTo
                          RestAPI.Content.createComment(
                            contexts.bert.restContext,
                            contentObj.id,
                            'This comment should be on top of the list',
                            'NotAnInteger',
                            (err, comment) => {
                              assert.ok(err); // Invalid reply-to timestamp provided
                              assert.strictEqual(err.code, 400);
                              assert.ok(!comment);

                              // Verify that the comment wasn't created
                              RestAPI.Content.getComments(
                                contexts.bert.restContext,
                                contentObj.id,
                                null,
                                10,
                                (err, comments) => {
                                  assert.ok(!err);
                                  assert.strictEqual(comments.results.length, 0);

                                  // Try to create a comment as an anonymous user
                                  RestAPI.Content.createComment(
                                    anonymousRestContext,
                                    contentObj.id,
                                    'This comment should be on top of the list',
                                    null,
                                    (err, comment) => {
                                      assert.ok(err);
                                      assert.strictEqual(err.code, 401);
                                      assert.ok(!comment);
                                      // Verify that the comment wasn't created
                                      RestAPI.Content.getComments(
                                        contexts.bert.restContext,
                                        contentObj.id,
                                        null,
                                        10,
                                        (err, comments) => {
                                          assert.ok(!err);
                                          assert.strictEqual(comments.results.length, 0);

                                          // Create a comment that is larger than the allowed maximum size
                                          const commentBody = TestsUtil.generateRandomText(10000);
                                          RestAPI.Content.createComment(
                                            contexts.bert.restContext,
                                            contentObj.id,
                                            commentBody,
                                            null,
                                            (err, comment) => {
                                              assert.ok(err);
                                              assert.strictEqual(err.code, 400);
                                              assert.ok(!comment);
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
     * Tests the permissions for creating comments on content
     *
     * @param  {Object}      contexts                 Object containing REST Contexts for users
     * @param  {String}      visibility               The permissions to apply to the content item (`public`, `loggedin` or `private`)
     * @param  {Boolean}     expectLoggedInComment    Indicates if it's expected that a comment will be successfully placed on content using the content permissions provided in `visibility`
     * @param  {Function}    callback                 Standard callback function
     */
    const testCommentPermissions = function(contexts, visibility, expectLoggedInComment, callback) {
      // Create content with specified visibility
      RestAPI.Content.createLink(
        contexts.bert.restContext,
        'Test Content 1',
        'Test content description 1',
        visibility,
        'http://www.oaeproject.org/',
        [],
        [contexts.nicolaas.user.id],
        [],
        (err, contentObj) => {
          assert.ok(!err);
          assert.ok(contentObj.id);

          // Try to comment as manager
          RestAPI.Content.createComment(
            contexts.bert.restContext,
            contentObj.id,
            'Try to comment as manager',
            null,
            (err, comment) => {
              assert.ok(!err);
              assert.ok(comment);
              // Verify that the comment was placed as a manager
              RestAPI.Content.getComments(contexts.bert.restContext, contentObj.id, null, 1, (err, comments) => {
                assert.ok(!err);
                assert.strictEqual(comments.results[0].body, 'Try to comment as manager');

                // Try to comment as member
                RestAPI.Content.createComment(
                  contexts.nicolaas.restContext,
                  contentObj.id,
                  'Try to comment as member',
                  null,
                  (err, comment) => {
                    assert.ok(!err);
                    assert.ok(comment);
                    // Verify that the comment was placed as a member
                    RestAPI.Content.getComments(
                      contexts.nicolaas.restContext,
                      contentObj.id,
                      null,
                      1,
                      (err, comments) => {
                        assert.ok(!err);
                        assert.strictEqual(comments.results[0].body, 'Try to comment as member');

                        // Try to comment as logged in user
                        RestAPI.Content.createComment(
                          contexts.simon.restContext,
                          contentObj.id,
                          'Try to comment as logged in user',
                          null,
                          (err, comment) => {
                            if (expectLoggedInComment) {
                              assert.ok(!err);
                              assert.ok(comment);
                            } else {
                              assert.ok(err);
                              assert.ok(!comment);
                            }

                            // Verify that the comment was placed as a logged in user
                            RestAPI.Content.getComments(
                              contexts.simon.restContext,
                              contentObj.id,
                              null,
                              1,
                              (err, comments) => {
                                if (expectLoggedInComment) {
                                  assert.ok(!err);
                                  assert.strictEqual(comments.results[0].body, 'Try to comment as logged in user');
                                } else {
                                  assert.ok(err);
                                }

                                // Try to comment as anonymous user
                                RestAPI.Content.createComment(
                                  anonymousRestContext,
                                  contentObj.id,
                                  'Try to comment as an anonymous user',
                                  null,
                                  (err, comment) => {
                                    assert.ok(err);
                                    assert.ok(!comment);
                                    // Verify that the comment was placed as an anonymous
                                    RestAPI.Content.getComments(
                                      contexts.bert.restContext,
                                      contentObj.id,
                                      null,
                                      1,
                                      (err, comments) => {
                                        assert.ok(!err);
                                        assert.notStrictEqual(
                                          comments.results[0].body,
                                          'Try to comment as an anonymous user'
                                        );
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
                  }
                );
              });
            }
          );
        }
      );
    };

    /**
     * Test that will check permissions for placing comments on public content
     */
    it('verify create comment permissions public', callback => {
      setUpUsers(contexts => {
        testCommentPermissions(contexts, PUBLIC, true, callback);
      });
    });

    /**
     * Test that will check permissions for placing comments on loggedin only content
     */
    it('verify create comment permissions loggedin', callback => {
      setUpUsers(contexts => {
        testCommentPermissions(contexts, LOGGEDIN, true, callback);
      });
    });

    /**
     * Test that will check permissions for placing comments on private content
     */
    it('verify create comment permissions private', callback => {
      setUpUsers(contexts => {
        testCommentPermissions(contexts, PRIVATE, false, callback);
      });
    });
  });

  describe('Create content', () => {
    /**
     * Test that verifies we can't create content of an unknown resourceSubType
     */
    it('verify cannot create content of unknown resourceSubType', callback => {
      // There is no oae-rest method we can call that allows us to create content of a non-standard
      // resourceSubType. We can use the rest utility to do REST requests directly.
      RestUtil.performRestRequest(
        camAdminRestContext,
        '/api/content/create',
        'POST',
        { resourceSubType: 'unicorns' },
        err => {
          assert.strictEqual(err.code, 400);
          callback();
        }
      );
    });

    /**
     * Test that will attempt to create new links with various parameter combinations
     */
    it('verify create link', callback => {
      setUpUsers(contexts => {
        // Create one as anon user
        RestAPI.Content.createLink(
          anonymousRestContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(err);
            assert.ok(!contentObj);

            // Create one with all required fields
            RestAPI.Content.createLink(
              contexts.nicolaas.restContext,
              'Test Content 2',
              'Test content description 2',
              PUBLIC,
              'http://www.oaeproject.org/',
              [],
              [],
              [],
              (err, contentObj, response) => {
                assert.ok(!err);
                assert.ok(contentObj.id);

                // Verify the backend is returning appliation/json
                assert.ok(response.headers['content-type'].startsWith('application/json'));

                // Create one without description
                RestAPI.Content.createLink(
                  contexts.nicolaas.restContext,
                  'Test Content 3',
                  null,
                  PUBLIC,
                  'http://www.oaeproject.org/',
                  [],
                  [],
                  [],
                  (err, contentObj) => {
                    assert.ok(!err);
                    assert.ok(contentObj.id);

                    // Create one with description that's longer than the allowed maximum size
                    const longDescription = TestsUtil.generateRandomText(1000);
                    RestAPI.Content.createLink(
                      contexts.nicolaas.restContext,
                      'Test Content 4',
                      longDescription,
                      PUBLIC,
                      null,
                      [],
                      [],
                      [],
                      (err, contentObj) => {
                        assert.ok(err);
                        assert.ok(!contentObj);

                        // Create one without URL
                        RestAPI.Content.createLink(
                          contexts.nicolaas.restContext,
                          'Test Content 4',
                          'Test content description 4',
                          PUBLIC,
                          null,
                          [],
                          [],
                          [],
                          (err, contentObj) => {
                            assert.ok(err);
                            assert.ok(!contentObj);

                            // Create one without a valid URL
                            RestAPI.Content.createLink(
                              contexts.nicolaas.restContext,
                              'Test Content 5',
                              'Test content description 5',
                              PUBLIC,
                              'Just a string',
                              [],
                              [],
                              [],
                              (err, contentObj) => {
                                assert.ok(err);
                                assert.ok(!contentObj);

                                // Create one with a URL that's longer than the allowed maximum size
                                let longUrl = 'http://www.oaeproject.org/';
                                for (let i = 0; i < 2500; i++) {
                                  longUrl += 'a';
                                }

                                RestAPI.Content.createLink(
                                  contexts.nicolaas.restContext,
                                  'Test Content 5',
                                  'Test content description 5',
                                  PUBLIC,
                                  longUrl,
                                  [],
                                  [],
                                  [],
                                  (err, contentObj) => {
                                    assert.ok(err);
                                    assert.strictEqual(err.code, 400);
                                    assert.ok(!contentObj);

                                    // Create one without displayName
                                    RestAPI.Content.createLink(
                                      contexts.nicolaas.restContext,
                                      null,
                                      'Test content description 6',
                                      PUBLIC,
                                      'http://www.oaeproject.org/',
                                      [],
                                      [],
                                      [],
                                      (err, contentObj) => {
                                        assert.ok(err);
                                        assert.ok(!contentObj);

                                        // Create one with an displayName that's longer than the allowed maximum size
                                        const longDisplayName = TestsUtil.generateRandomText(100);
                                        RestAPI.Content.createLink(
                                          contexts.nicolaas.restContext,
                                          longDisplayName,
                                          'Test content description 6',
                                          PUBLIC,
                                          'http://www.oaeproject.org/',
                                          [],
                                          [],
                                          [],
                                          (err, contentObj) => {
                                            assert.ok(err);
                                            assert.strictEqual(err.code, 400);
                                            assert.ok(err.msg.indexOf('1000') > 0);
                                            assert.ok(!contentObj);

                                            // Create one without visibility
                                            RestAPI.Content.createLink(
                                              contexts.nicolaas.restContext,
                                              'Test Content 7',
                                              'Test content description 7',
                                              null,
                                              'http://www.oaeproject.org/',
                                              [],
                                              [],
                                              [],
                                              (err, contentObj) => {
                                                assert.ok(!err);
                                                assert.ok(contentObj.id);

                                                // Check if the visibility has been set to public (default)
                                                RestAPI.Content.getContent(
                                                  contexts.nicolaas.restContext,
                                                  contentObj.id,
                                                  (err, contentObj) => {
                                                    assert.ok(!err);
                                                    assert.strictEqual(contentObj.visibility, PUBLIC);
                                                    assert.ok(!contentObj.downloadPath);

                                                    // Verify that an empty description is allowed
                                                    RestAPI.Content.createLink(
                                                      contexts.nicolaas.restContext,
                                                      'Test Content 7',
                                                      '',
                                                      null,
                                                      'http://www.oaeproject.org/',
                                                      [],
                                                      [],
                                                      [],
                                                      (err, contentObj) => {
                                                        assert.ok(!err);
                                                        assert.ok(contentObj.id);

                                                        // Verify that a protocol is added if missing
                                                        RestAPI.Content.createLink(
                                                          contexts.nicolaas.restContext,
                                                          'Test Content 8',
                                                          'Test content description 8',
                                                          PUBLIC,
                                                          'www.oaeproject.org',
                                                          [],
                                                          [],
                                                          [],
                                                          (err, contentObj, response) => {
                                                            assert.ok(!err);
                                                            assert.ok(contentObj.id);
                                                            RestAPI.Content.getContent(
                                                              contexts.nicolaas.restContext,
                                                              contentObj.id,
                                                              (err, contentObj) => {
                                                                assert.ok(!err);
                                                                assert.strictEqual(
                                                                  contentObj.link,
                                                                  'http://www.oaeproject.org'
                                                                );
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
     * Test that will attempt to create new files with various parameter combinations
     */
    it('verify create file', callback => {
      setUpUsers(contexts => {
        // Create one as anon user
        RestAPI.Content.createFile(
          anonymousRestContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          getFileStream,
          [],
          [],
          [],
          (err, contentObj) => {
            assert.strictEqual(err.code, 401);
            assert.ok(!contentObj);

            // Create one with all required fields
            RestAPI.Content.createFile(
              contexts.nicolaas.restContext,
              'Test Content 2',
              'Test content description 2',
              PUBLIC,
              getFileStream,
              [],
              [],
              [],
              (err, contentObj, response) => {
                assert.ok(!err);
                assert.ok(contentObj.id);
                assert.strictEqual(contentObj.filename, 'oae-video.png');
                assert.strictEqual(contentObj.mime, 'image/png');

                // Verify the backend is returning text/plain as IE9 doesn't support application/json on upload
                assert.strictEqual(response.headers['content-type'], 'text/plain; charset=utf-8');

                // Create one without description
                RestAPI.Content.createFile(
                  contexts.nicolaas.restContext,
                  'Test Content 3',
                  null,
                  PUBLIC,
                  getFileStream,
                  [],
                  [],
                  [],
                  (err, contentObj) => {
                    assert.ok(!err);
                    assert.ok(contentObj.id);

                    // Create one with a description that's longer than the allowed maximum size
                    const longDescription = TestsUtil.generateRandomText(1000);
                    RestAPI.Content.createFile(
                      contexts.nicolaas.restContext,
                      'Test content',
                      longDescription,
                      PUBLIC,
                      getFileStream,
                      [],
                      [],
                      [],
                      (err, contentObj) => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 400);
                        assert.ok(err.msg.indexOf('10000') > 0);
                        assert.ok(!contentObj);

                        // Create one without title
                        RestAPI.Content.createFile(
                          contexts.nicolaas.restContext,
                          null,
                          'Test content description 4',
                          PUBLIC,
                          getFileStream,
                          [],
                          [],
                          [],
                          (err, contentObj) => {
                            assert.strictEqual(err.code, 400);
                            assert.ok(!contentObj);

                            // Create one with a displayName that's longer than the allowed maximum size
                            const longDisplayName = TestsUtil.generateRandomText(100);
                            RestAPI.Content.createFile(
                              contexts.nicolaas.restContext,
                              longDisplayName,
                              'Test content description 4',
                              PUBLIC,
                              getFileStream,
                              [],
                              [],
                              [],
                              (err, contentObj) => {
                                assert.ok(err);
                                assert.strictEqual(err.code, 400);
                                assert.ok(err.msg.indexOf('1000') > 0);
                                assert.ok(!contentObj);

                                // Create one without a file body.
                                RestAPI.Content.createFile(
                                  contexts.nicolaas.restContext,
                                  'Test Content 4',
                                  'Test content description 4',
                                  PUBLIC,
                                  null,
                                  [],
                                  [],
                                  [],
                                  (err, contentObj) => {
                                    assert.strictEqual(err.code, 400);
                                    assert.ok(!contentObj);

                                    // Create one without visibility
                                    RestAPI.Content.createFile(
                                      contexts.nicolaas.restContext,
                                      'Test Content 5',
                                      'Test content description 6',
                                      null,
                                      getFileStream,
                                      [],
                                      [],
                                      [],
                                      (err, contentObj) => {
                                        assert.ok(!err);
                                        assert.ok(contentObj.id);
                                        // Check if the visibility has been set to public (default)
                                        RestAPI.Content.getContent(
                                          contexts.nicolaas.restContext,
                                          contentObj.id,
                                          (err, contentObj) => {
                                            assert.ok(!err);
                                            assert.strictEqual(contentObj.visibility, PUBLIC);
                                            assert.strictEqual(
                                              contentObj.downloadPath,
                                              '/api/content/' +
                                                contentObj.id +
                                                '/download/' +
                                                contentObj.latestRevisionId
                                            );

                                            // Verify that an empty description is accepted
                                            RestAPI.Content.createFile(
                                              contexts.nicolaas.restContext,
                                              'Test Content 5',
                                              '',
                                              PUBLIC,
                                              getFileStream,
                                              [],
                                              [],
                                              [],
                                              (err, contentObj) => {
                                                assert.ok(!err);
                                                assert.ok(contentObj.id);
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
     * Test that will attempt to create new collaborative documents with various parameter combinations
     */
    it('verify create collaborative document', callback => {
      setUpUsers(contexts => {
        // Create one as anon user
        RestAPI.Content.createCollabDoc(
          anonymousRestContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          [],
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(err);
            assert.ok(!contentObj);

            // Create one with all required fields
            RestAPI.Content.createCollabDoc(
              contexts.nicolaas.restContext,
              'Test Content 2',
              'Test content description 2',
              PUBLIC,
              [],
              [],
              [],
              [],
              (err, contentObj, response) => {
                assert.ok(!err);
                assert.ok(contentObj.id);

                // Verify the backend is returning appliation/json
                assert.ok(response.headers['content-type'].startsWith('application/json'));

                // Create one without description
                RestAPI.Content.createCollabDoc(
                  contexts.nicolaas.restContext,
                  'Test Content 3',
                  null,
                  PUBLIC,
                  [],
                  [],
                  [],
                  [],
                  (err, contentObj) => {
                    assert.ok(!err);
                    assert.ok(contentObj.id);

                    // Create one with a description that's longer than the allowed maximum size
                    const longDescription = TestsUtil.generateRandomText(1000);
                    RestAPI.Content.createCollabDoc(
                      contexts.nicolaas.restContext,
                      'Test content',
                      longDescription,
                      PUBLIC,
                      [],
                      [],
                      [],
                      [],
                      (err, contentObj) => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 400);
                        assert.ok(err.msg.indexOf('10000') > 0);
                        assert.ok(!contentObj);

                        // Create one without title
                        RestAPI.Content.createCollabDoc(
                          contexts.nicolaas.restContext,
                          null,
                          'Test content description 4',
                          PUBLIC,
                          [],
                          [],
                          [],
                          [],
                          (err, contentObj) => {
                            assert.ok(err);
                            assert.ok(!contentObj);

                            // Create one with a displayName that's longer than the allowed maximum size
                            const longDisplayName = TestsUtil.generateRandomText(100);
                            RestAPI.Content.createCollabDoc(
                              contexts.nicolaas.restContext,
                              longDisplayName,
                              'descripton',
                              PUBLIC,
                              [],
                              [],
                              [],
                              [],
                              (err, contentObj) => {
                                assert.ok(err);
                                assert.strictEqual(err.code, 400);
                                assert.ok(err.msg.indexOf('1000') > 0);
                                assert.ok(!contentObj);

                                // Create one without permission
                                RestAPI.Content.createCollabDoc(
                                  contexts.nicolaas.restContext,
                                  'Test Content 5',
                                  'Test content description 5',
                                  null,
                                  [],
                                  [],
                                  [],
                                  [],
                                  (err, contentObj) => {
                                    assert.ok(!err);
                                    assert.ok(contentObj.id);
                                    // Check if the permission has been set to private (default)
                                    RestAPI.Content.getContent(
                                      contexts.nicolaas.restContext,
                                      contentObj.id,
                                      (err, contentObj) => {
                                        assert.ok(!err);
                                        assert.strictEqual(contentObj.visibility, PRIVATE);
                                        assert.ok(!contentObj.downloadPath);

                                        // Verify that an empty description is accepted
                                        RestAPI.Content.createCollabDoc(
                                          contexts.nicolaas.restContext,
                                          'Test Content 5',
                                          '',
                                          PUBLIC,
                                          [],
                                          [],
                                          [],
                                          [],
                                          (err, contentObj) => {
                                            assert.ok(!err);
                                            assert.ok(contentObj.id);
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
     * Test that will attempt to create a public content item and will verify direct and library access
     * for various people
     */
    it('verify create public content item', callback => {
      setUpUsers(contexts => {
        // Create a public content item
        RestAPI.Content.createLink(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            // Get the piece of content as the person who created the content
            checkPieceOfContent(
              contexts.nicolaas.restContext,
              contexts.nicolaas.user.id,
              contentObj,
              true,
              true,
              true,
              true,
              () => {
                // Get the piece of content as a different logged in user
                checkPieceOfContent(
                  contexts.simon.restContext,
                  contexts.nicolaas.user.id,
                  contentObj,
                  true,
                  false,
                  true,
                  true,
                  () => {
                    // Get the piece of content as an anonymous user
                    checkPieceOfContent(
                      anonymousRestContext,
                      contexts.nicolaas.user.id,
                      contentObj,
                      true,
                      false,
                      true,
                      false,
                      callback
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
     * Test that will attempt to create a loggedin content item and will verify direct and library access
     * for various people
     */
    it('verify create logged in content item', callback => {
      setUpUsers(contexts => {
        // Create a logged in content item
        RestAPI.Content.createLink(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          LOGGEDIN,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            // Get the piece of content as the person who created the content
            checkPieceOfContent(
              contexts.nicolaas.restContext,
              contexts.nicolaas.user.id,
              contentObj,
              true,
              true,
              true,
              true,
              () => {
                // Get the piece of content as a different logged in user
                checkPieceOfContent(
                  contexts.simon.restContext,
                  contexts.nicolaas.user.id,
                  contentObj,
                  true,
                  false,
                  true,
                  true,
                  () => {
                    // Get the piece of content as an anonymous user
                    checkPieceOfContent(
                      anonymousRestContext,
                      contexts.nicolaas.user.id,
                      contentObj,
                      false,
                      false,
                      false,
                      false,
                      callback
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
     * Test that will attempt to create a private content item and will verify direct and library access
     * for various people
     */
    it('verify create private content item', callback => {
      setUpUsers(contexts => {
        // Create a private content item
        RestAPI.Content.createLink(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PRIVATE,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            // Get the piece of content as the person who created the content
            checkPieceOfContent(
              contexts.nicolaas.restContext,
              contexts.nicolaas.user.id,
              contentObj,
              true,
              true,
              true,
              true,
              () => {
                // Get the piece of content as a different logged in user
                checkPieceOfContent(
                  contexts.simon.restContext,
                  contexts.nicolaas.user.id,
                  contentObj,
                  false,
                  false,
                  false,
                  false,
                  () => {
                    // Get the piece of content as an anonymous user
                    checkPieceOfContent(
                      anonymousRestContext,
                      contexts.nicolaas.user.id,
                      contentObj,
                      false,
                      false,
                      false,
                      false,
                      callback
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
     * Test whether or not passing in viewers and managers to be added to the content upon link creation works as expected. This test will
     * create a private piece of content that will have 1 additional manager and 1 viewer. We will fetch the content as those people
     * to verify access, and then get the content as a logged in user and an anonymous user to verify they don't have access
     */
    it('verify create content with default members link', callback => {
      setUpUsers(contexts => {
        // Create a private content item and share with 2 people
        RestAPI.Content.createLink(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PRIVATE,
          'http://www.oaeproject.org/',
          [contexts.simon.user.id],
          [contexts.stuart.user.id],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            // Get the piece of content as the person who created the content
            checkPieceOfContent(
              contexts.nicolaas.restContext,
              contexts.nicolaas.user.id,
              contentObj,
              true,
              true,
              true,
              true,
              () => {
                // Get the piece of content as another manager
                checkPieceOfContent(
                  contexts.simon.restContext,
                  contexts.simon.user.id,
                  contentObj,
                  true,
                  true,
                  true,
                  true,
                  () => {
                    // Get the piece of content as a viewer
                    checkPieceOfContent(
                      contexts.stuart.restContext,
                      contexts.stuart.user.id,
                      contentObj,
                      true,
                      false,
                      true,
                      false,
                      () => {
                        // Get the piece of content as a non-member
                        checkPieceOfContent(
                          contexts.bert.restContext,
                          contexts.bert.user.id,
                          contentObj,
                          false,
                          false,
                          false,
                          false,
                          () => {
                            // Get the piece of content as an anonymous user
                            checkPieceOfContent(
                              anonymousRestContext,
                              contexts.nicolaas.user.id,
                              contentObj,
                              false,
                              false,
                              false,
                              false,
                              callback
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
     * Test whether or not passing in viewers and managers to be added to the content upon file creation works as expected. This test will
     * create a private piece of content that will have 1 additional manager and 1 viewer. We will fetch the content as those people
     * to verify access, and then get the content as a logged in user and an anonymous user to verify they don't have access
     */
    it('verify create content with default members file', callback => {
      setUpUsers(contexts => {
        // Create a private content item and share with 2 people
        RestAPI.Content.createFile(
          contexts.nicolaas.restContext,
          'Test Content 2',
          'Test content description 2',
          PRIVATE,
          getFileStream,
          [contexts.simon.user.id],
          [contexts.stuart.user.id],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            // Get the piece of content as the person who created the content
            checkPieceOfContent(
              contexts.nicolaas.restContext,
              contexts.nicolaas.user.id,
              contentObj,
              true,
              true,
              true,
              true,
              () => {
                // Get the piece of content as another manager
                checkPieceOfContent(
                  contexts.simon.restContext,
                  contexts.simon.user.id,
                  contentObj,
                  true,
                  true,
                  true,
                  true,
                  () => {
                    // Get the piece of content as a viewer
                    checkPieceOfContent(
                      contexts.stuart.restContext,
                      contexts.stuart.user.id,
                      contentObj,
                      true,
                      false,
                      true,
                      false,
                      () => {
                        // Get the piece of content as a non-member
                        checkPieceOfContent(
                          contexts.branden.restContext,
                          contexts.branden.user.id,
                          contentObj,
                          false,
                          false,
                          false,
                          false,
                          () => {
                            // Get the piece of content as an anonymous user
                            checkPieceOfContent(
                              anonymousRestContext,
                              contexts.nicolaas.user.id,
                              contentObj,
                              false,
                              false,
                              false,
                              false,
                              callback
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
     * Test whether or not passing in viewers and managers to be added to the content upon document creation works as expected. This test will
     * create a private piece of content that will have 1 additional manager and 1 viewer. We will fetch the content as those people
     * to verify access, and then get the content as a logged in user and an anonymous user to verify they don't have access
     */
    it('verify create content with default members collaborative document', callback => {
      setUpUsers(contexts => {
        // Create a private content item and share with 2 people
        RestAPI.Content.createCollabDoc(
          contexts.nicolaas.restContext,
          'Test Content 2',
          'Test content description 2',
          PRIVATE,
          [contexts.simon.user.id],
          [],
          [contexts.stuart.user.id],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            // Get the piece of content as the person who created the content
            checkPieceOfContent(
              contexts.nicolaas.restContext,
              contexts.nicolaas.user.id,
              contentObj,
              true,
              true,
              true,
              true,
              () => {
                // Get the piece of content as another manager
                checkPieceOfContent(
                  contexts.simon.restContext,
                  contexts.simon.user.id,
                  contentObj,
                  true,
                  true,
                  true,
                  true,
                  () => {
                    // Get the piece of content as a viewer
                    checkPieceOfContent(
                      contexts.stuart.restContext,
                      contexts.stuart.user.id,
                      contentObj,
                      true,
                      false,
                      true,
                      false,
                      () => {
                        // Get the piece of content as a non-member
                        checkPieceOfContent(
                          contexts.branden.restContext,
                          contexts.branden.user.id,
                          contentObj,
                          false,
                          false,
                          false,
                          false,
                          () => {
                            // Get the piece of content as an anonymous user
                            checkPieceOfContent(
                              anonymousRestContext,
                              contexts.nicolaas.user.id,
                              contentObj,
                              false,
                              false,
                              false,
                              false,
                              callback
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
     * Test that verifies that you cannot create a piece of content when trying to add a private user as a member
     */
    it('verify create content with a private user as another member', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
        assert.ok(!err);
        const nico = _.values(users)[0];
        const bert = _.values(users)[1];

        RestAPI.User.updateUser(bert.restContext, bert.user.id, { visibility: PRIVATE }, err => {
          assert.ok(!err);

          RestAPI.Content.createLink(
            nico.restContext,
            'Test Content',
            'Test content description',
            PUBLIC,
            'http://www.oaeproject.org/',
            [bert.user.id],
            [],
            [],
            (err, contentObj) => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);
              callback();
            }
          );
        });
      });
    });

    /**
     * Test that verifies that you cannot create a piece of content when trying to add a private group as a member
     */
    it('verify create content with a private group as another member', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
        assert.ok(!err);
        const nico = _.values(users)[0];
        const bert = _.values(users)[1];

        RestAPI.Group.createGroup(
          bert.restContext,
          'Group title',
          'Group description',
          PRIVATE,
          undefined,
          [],
          [],
          (err, groupObj) => {
            assert.ok(!err);

            RestAPI.Content.createLink(
              nico.restContext,
              'Test Content',
              'Test content description',
              PUBLIC,
              'http://www.oaeproject.org/',
              [groupObj.id],
              [],
              [],
              (err, contentObj) => {
                assert.ok(err);
                assert.strictEqual(err.code, 401);
                callback();
              }
            );
          }
        );
      });
    });
  });

  describe('Update content', () => {
    /**
     * Utitility function for the update content profile test, that will check whether or not the name and description of a piece
     * of content are as expected for 2 different users.
     * @param  {Object}             contexts            Object where the keys are identifiers for the created users and the values are an
     *                                                  object with a user key containing the user object for the created user and a restContext key
     *                                                  containing the REST Context for that user
     * @param  {String}             contentId           Content id of the content for which the name and description are checked
     * @param  {String}             expectedName        The name the content is supposed to have
     * @param  {String}             expectedDescription The description the content is supposed to have
     * @param  {Function}           callback            Standard callback function
     */
    const checkNameAndDescription = function(contexts, contentId, expectedName, expectedDescription, callback) {
      // Check as user 0
      RestAPI.Content.getContent(contexts.nicolaas.restContext, contentId, (err, contentObj) => {
        assert.ok(!err);
        assert.strictEqual(contentObj.id, contentId);
        assert.strictEqual(contentObj.displayName, expectedName);
        assert.strictEqual(contentObj.description, expectedDescription);
        assert.strictEqual(contentObj.resourceType, 'content');
        assert.strictEqual(
          contentObj.profilePath,
          '/content/' + contentObj.tenant.alias + '/' + AuthzUtil.getResourceFromId(contentId).resourceId
        );
        // Check as user 1
        RestAPI.Content.getContent(contexts.simon.restContext, contentId, (err, contentObj) => {
          assert.ok(!err);
          assert.strictEqual(contentObj.id, contentId);
          assert.strictEqual(contentObj.displayName, expectedName);
          assert.strictEqual(contentObj.description, expectedDescription);
          assert.strictEqual(contentObj.resourceType, 'content');
          assert.strictEqual(
            contentObj.profilePath,
            '/content/' + contentObj.tenant.alias + '/' + AuthzUtil.getResourceFromId(contentId).resourceId
          );
          callback();
        });
      });
    };

    /**
     * Test that will exercise the name and description part of the updateContent profile function. A piece of content will be
     * updated with invalid parameters, then the name will be updated, the description will be updated, both name and description
     * will be updated at the same time, and we will attempt to update the profile as a non-manager. After all of these, we'll
     * check if the correct metadata is still on the content.
     */
    it('verify update content profile', callback => {
      // Create a piece of content
      setUpUsers(contexts => {
        RestAPI.Content.createLink(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);
            // Share it with someone
            RestAPI.Content.shareContent(
              contexts.nicolaas.restContext,
              contentObj.id,
              [contexts.simon.user.id],
              err => {
                assert.ok(!err);

                // Invalid content metadata update (empty)
                RestAPI.Content.updateContent(contexts.nicolaas.restContext, contentObj.id, {}, err => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 400);

                  // Invalid content metadata update (unexisting field)
                  RestAPI.Content.updateContent(
                    contexts.nicolaas.restContext,
                    contentObj.id,
                    { displayName: 'New Test Content 1', nonExisting: 'Non-existing field' },
                    err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 400);

                      // Check name and description are still correct
                      checkNameAndDescription(
                        contexts,
                        contentObj.id,
                        'Test Content 1',
                        'Test content description 1',
                        () => {
                          // Change the name
                          RestAPI.Content.updateContent(
                            contexts.nicolaas.restContext,
                            contentObj.id,
                            { displayName: 'New Test Content 1' },
                            (err, updatedContentObj) => {
                              assert.ok(!err);
                              assert.strictEqual(updatedContentObj.displayName, 'New Test Content 1');
                              assert.ok(updatedContentObj.isManager);
                              assert.strictEqual(updatedContentObj.createdBy.id, contexts.nicolaas.user.id);
                              assert.ok(!updatedContentObj.downloadPath);
                              // Check the new name comes back
                              checkNameAndDescription(
                                contexts,
                                contentObj.id,
                                'New Test Content 1',
                                'Test content description 1',
                                () => {
                                  // Change the description
                                  RestAPI.Content.updateContent(
                                    contexts.nicolaas.restContext,
                                    contentObj.id,
                                    { description: 'New test content description 1' },
                                    (err, updatedContentObj) => {
                                      assert.ok(!err);
                                      assert.strictEqual(
                                        updatedContentObj.description,
                                        'New test content description 1'
                                      );
                                      assert.ok(updatedContentObj.isManager);
                                      assert.strictEqual(updatedContentObj.createdBy.id, contexts.nicolaas.user.id);
                                      assert.ok(!updatedContentObj.downloadPath);
                                      // Check the new description comes back
                                      checkNameAndDescription(
                                        contexts,
                                        contentObj.id,
                                        'New Test Content 1',
                                        'New test content description 1',
                                        () => {
                                          // Change both at same time
                                          RestAPI.Content.updateContent(
                                            contexts.nicolaas.restContext,
                                            contentObj.id,
                                            {
                                              displayName: 'New Test Content 2',
                                              description: 'New test content description 2'
                                            },
                                            (err, updatedContentObj) => {
                                              assert.ok(!err);
                                              assert.strictEqual(updatedContentObj.displayName, 'New Test Content 2');
                                              assert.strictEqual(
                                                updatedContentObj.description,
                                                'New test content description 2'
                                              );
                                              assert.ok(updatedContentObj.isManager);
                                              assert.strictEqual(
                                                updatedContentObj.createdBy.id,
                                                contexts.nicolaas.user.id
                                              );
                                              assert.ok(!updatedContentObj.downloadPath);
                                              // Check the new name and description come back
                                              checkNameAndDescription(
                                                contexts,
                                                contentObj.id,
                                                'New Test Content 2',
                                                'New test content description 2',
                                                () => {
                                                  // Try updating it as non-manager of the content
                                                  RestAPI.Content.updateContent(
                                                    contexts.simon.restContext,
                                                    contentObj.id,
                                                    { displayName: 'New Test Content 3' },
                                                    err => {
                                                      assert.ok(err);
                                                      assert.strictEqual(err.code, 401);

                                                      // Check that the old values are still in place
                                                      checkNameAndDescription(
                                                        contexts,
                                                        contentObj.id,
                                                        'New Test Content 2',
                                                        'New test content description 2',
                                                        () => {
                                                          // Try updating it with a displayName that's longer than the allowed maximum size
                                                          const longDisplayName = TestsUtil.generateRandomText(100);
                                                          RestAPI.Content.updateContent(
                                                            contexts.nicolaas.restContext,
                                                            contentObj.id,
                                                            { displayName: longDisplayName },
                                                            err => {
                                                              assert.ok(err);
                                                              assert.strictEqual(err.code, 400);
                                                              assert.ok(err.msg.indexOf('1000') > 0);

                                                              // Try updating it with a description that's longer than the allowed maximum size
                                                              const longDescription = TestsUtil.generateRandomText(
                                                                1000
                                                              );
                                                              RestAPI.Content.updateContent(
                                                                contexts.nicolaas.restContext,
                                                                contentObj.id,
                                                                { description: longDescription },
                                                                err => {
                                                                  assert.ok(err);
                                                                  assert.strictEqual(err.code, 400);
                                                                  assert.ok(err.msg.indexOf('10000') > 0);

                                                                  // Verify that an empty description is accepted
                                                                  RestAPI.Content.updateContent(
                                                                    contexts.nicolaas.restContext,
                                                                    contentObj.id,
                                                                    { description: '' },
                                                                    err => {
                                                                      assert.ok(!err);

                                                                      checkNameAndDescription(
                                                                        contexts,
                                                                        contentObj.id,
                                                                        'New Test Content 2',
                                                                        '',
                                                                        callback
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
          }
        );
      });
    });

    /**
     * Utility function that will check for content access and library presence for a content manager,
     * a content viewer, a logged in user and the anonymous user
     * @param  {Array<Context>}     contexts                Array of context objects that represent a request cycle and contain
     * @param  {String}             contentId               Content id of the content for which we expect in the access and library checks
     * @param  {Boolean}            expectLoggedInAccess    Whether or not the logged in user is expected to have access to the content
     * @param  {Boolean}            expectAnonAccess        Whether or not the anonymous user is expected to have access to the content
     * @param  {Function}           callback                Standard callback function
     */
    const checkAccessAndLibrary = function(contexts, contentId, expectLoggedInAccess, expectAnonAccess, callback) {
      // Check for the content manager
      RestAPI.Content.getContent(contexts.nicolaas.restContext, contentId, (err, contentObj) => {
        assert.ok(!err);
        assert.ok(contentObj);
        // Check that it's part of the content manager's library
        RestAPI.Content.getLibrary(contexts.nicolaas.restContext, contexts.nicolaas.user.id, null, 10, (err, items) => {
          assert.ok(!err);
          assert.strictEqual(items.results.length, 1);
          assert.strictEqual(items.results[0].id, contentId);

          // Check for the content viewer
          RestAPI.Content.getContent(contexts.simon.restContext, contentId, (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);
            // Check that it is part of his library
            RestAPI.Content.getLibrary(contexts.simon.restContext, contexts.simon.user.id, null, 10, (err, items) => {
              assert.ok(!err);
              assert.strictEqual(items.results.length, 1);
              assert.strictEqual(items.results[0].id, contentId);
              // Check that it is visible in the manager's library
              RestAPI.Content.getLibrary(
                contexts.simon.restContext,
                contexts.nicolaas.user.id,
                null,
                10,
                (err, items) => {
                  assert.ok(!err);
                  if (expectLoggedInAccess) {
                    assert.strictEqual(items.results.length, 1);
                    assert.strictEqual(items.results[0].id, contentId);
                  } else {
                    assert.strictEqual(items.results.length, 0);
                  }

                  // Check for the logged in user that's not a viewer
                  RestAPI.Content.getContent(contexts.bert.restContext, contentId, (err, contentObj) => {
                    if (expectLoggedInAccess) {
                      assert.ok(!err);
                      assert.ok(contentObj);
                    } else {
                      assert.ok(err);
                      assert.ok(!contentObj);
                    }

                    // Check that it isn't part of his library
                    RestAPI.Content.getLibrary(
                      contexts.bert.restContext,
                      contexts.bert.user.id,
                      null,
                      10,
                      (err, items) => {
                        assert.ok(!err);
                        assert.strictEqual(items.results.length, 0);
                        // Check that it is visible in the manager's library
                        RestAPI.Content.getLibrary(
                          contexts.bert.restContext,
                          contexts.nicolaas.user.id,
                          null,
                          10,
                          (err, items) => {
                            assert.ok(!err);
                            if (expectLoggedInAccess) {
                              assert.strictEqual(items.results.length, 1);
                              assert.strictEqual(items.results[0].id, contentId);
                            } else {
                              assert.strictEqual(items.results.length, 0);
                            }

                            // Check for the anonymous user
                            RestAPI.Content.getContent(anonymousRestContext, contentId, (err, contentObj) => {
                              if (expectAnonAccess) {
                                assert.ok(!err);
                                assert.ok(contentObj);
                              } else {
                                assert.ok(err);
                                assert.ok(!contentObj);
                              }

                              // Check that it is visible in the manager's library
                              RestAPI.Content.getLibrary(
                                anonymousRestContext,
                                contexts.nicolaas.user.id,
                                null,
                                10,
                                (err, items) => {
                                  assert.ok(!err);
                                  if (expectAnonAccess) {
                                    assert.strictEqual(items.results.length, 1);
                                    assert.strictEqual(items.results[0].id, contentId);
                                  } else {
                                    assert.strictEqual(items.results.length, 0);
                                  }

                                  callback();
                                }
                              );
                            });
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
      });
    };

    /**
     * Test that will exercise the visibility part of the updateContentMetadata function for content. This test will create a public
     * content item, try to give it a non-existing visibility, then make it visible to logged in users, then make it private and
     * then try to change the visibility as a non-manager. After all of those, we check if the manager, viewer, logged in user and
     * anonymous user have access as expected.
     */
    it('verify update content visibility', callback => {
      // Create a piece of content
      setUpUsers(contexts => {
        RestAPI.Content.createLink(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);
            // Share the content with one viewer
            RestAPI.Content.shareContent(
              contexts.nicolaas.restContext,
              contentObj.id,
              [contexts.simon.user.id],
              err => {
                assert.ok(!err);

                // Check that all of these can get the content as expected, check library presence as expected
                checkAccessAndLibrary(contexts, contentObj.id, true, true, () => {
                  // Try an invalid update
                  RestAPI.Content.updateContent(
                    contexts.nicolaas.restContext,
                    contentObj.id,
                    { visibility: null },
                    err => {
                      assert.ok(err);

                      // Check that the access remains unchanged
                      checkAccessAndLibrary(contexts, contentObj.id, true, true, () => {
                        // Try an unknown visibility update
                        RestAPI.Content.updateContent(
                          contexts.nicolaas.restContext,
                          contentObj.id,
                          { visibility: 'unknown-option' },
                          err => {
                            assert.ok(err);

                            // Check that the access remains unchanged
                            checkAccessAndLibrary(contexts, contentObj.id, true, true, () => {
                              // Make the content logged in only
                              RestAPI.Content.updateContent(
                                contexts.nicolaas.restContext,
                                contentObj.id,
                                { visibility: LOGGEDIN },
                                err => {
                                  assert.ok(!err);

                                  // Check that everyone can get the content as expected, check library presence as expected
                                  checkAccessAndLibrary(contexts, contentObj.id, true, false, () => {
                                    // Make the content private
                                    RestAPI.Content.updateContent(
                                      contexts.nicolaas.restContext,
                                      contentObj.id,
                                      { visibility: PRIVATE },
                                      err => {
                                        assert.ok(!err);

                                        // Check that everyone can get the content as expected, check library presence as expected
                                        checkAccessAndLibrary(contexts, contentObj.id, false, false, () => {
                                          // Try update as non-manager
                                          RestAPI.Content.updateContent(
                                            contexts.simon.restContext,
                                            contentObj.id,
                                            { visibility: PUBLIC },
                                            err => {
                                              assert.ok(err);

                                              // Check that everyone can get the content as expected, check library presence as expected
                                              checkAccessAndLibrary(contexts, contentObj.id, false, false, callback);
                                            }
                                          );
                                        });
                                      }
                                    );
                                  });
                                }
                              );
                            });
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
     * Test that verifies that links can be successfully updated
     */
    it('verify link update validation', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        const nicolaas = _.values(users)[0];

        RestAPI.Content.createLink(
          nicolaas.restContext,
          'display name',
          'description',
          PUBLIC,
          'http://www.oaeproject.org',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            // Sanity check updates
            const newLink = 'http://www.google.com';
            RestAPI.Content.updateContent(
              nicolaas.restContext,
              contentObj.id,
              { link: newLink },
              (err, updatedContentObj) => {
                assert.ok(!err);
                assert.strictEqual(updatedContentObj.link, newLink);

                // Test invalid links
                RestAPI.Content.updateContent(
                  nicolaas.restContext,
                  contentObj.id,
                  { link: 'invalid link' },
                  (err, updatedContentObj) => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 400);

                    // Empty link
                    RestAPI.Content.updateContent(
                      nicolaas.restContext,
                      contentObj.id,
                      { link: '' },
                      (err, updatedContentObj) => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 400);

                        // Super long link
                        let longUrl = 'http://www.oaeproject.org/';
                        for (let i = 0; i < 2500; i++) {
                          longUrl += 'a';
                        }

                        RestAPI.Content.updateContent(
                          nicolaas.restContext,
                          contentObj.id,
                          { link: longUrl },
                          (err, updatedContentObj) => {
                            assert.ok(err);
                            assert.strictEqual(err.code, 400);

                            // Sanity check that it's still pointing to google
                            RestAPI.Content.getContent(
                              nicolaas.restContext,
                              contentObj.id,
                              (err, retrievedContentObj) => {
                                assert.ok(!err);
                                assert.strictEqual(retrievedContentObj.link, newLink);
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
          }
        );
      });
    });

    /**
     * Test that verifies you cannot update the link property on non-link content items
     */
    it('verify the link property cannot be updated on non-link content items', callback => {
      setUpUsers(contexts => {
        RestAPI.Content.createFile(
          contexts.nicolaas.restContext,
          'Test Content 2',
          'Test content description 2',
          PUBLIC,
          getFileStream,
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);
            RestAPI.Content.updateContent(
              contexts.nicolaas.restContext,
              contentObj.id,
              { link: 'http://www.google.com' },
              (err, updatedContentObj) => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                RestAPI.Content.createCollabDoc(
                  contexts.nicolaas.restContext,
                  'Test Content 1',
                  'Test content description 1',
                  PUBLIC,
                  [],
                  [],
                  [],
                  [],
                  (err, contentObj) => {
                    assert.ok(!err);
                    assert.ok(contentObj);
                    RestAPI.Content.updateContent(
                      contexts.nicolaas.restContext,
                      contentObj.id,
                      { link: 'http://www.google.com' },
                      (err, updatedContentObj) => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 400);
                        callback();
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
     * Test that validates validation for file updates
     */
    it('verify file update validation', callback => {
      setUpUsers(contexts => {
        RestAPI.Content.createLink(
          contexts.nicolaas.restContext,
          'Test Content 2',
          'Test content description 2',
          PUBLIC,
          'http://www.oaeproject.org',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            RestAPI.Content.updateFileBody(contexts.nicolaas.restContext, contentObj.id, getOAELogoStream, err => {
              assert.strictEqual(err.code, 400);

              RestAPI.Content.createFile(
                contexts.nicolaas.restContext,
                'Test Content 2',
                'Test content description 2',
                PUBLIC,
                getFileStream,
                [],
                [],
                [],
                (err, contentObj) => {
                  assert.ok(!err);
                  assert.ok(contentObj.id);

                  // Try to update without uploading anything
                  RestAPI.Content.updateFileBody(
                    contexts.nicolaas.restContext,
                    contentObj.id,
                    null,
                    (err, revision) => {
                      assert.strictEqual(err.code, 400);
                      assert.ok(!revision);

                      // Try to update by passing a string
                      RestAPI.Content.updateFileBody(
                        contexts.nicolaas.restContext,
                        contentObj.id,
                        'haha, no actual file body',
                        err => {
                          assert.strictEqual(err.code, 400);

                          // Try to update something with an invalid ID
                          RestAPI.Content.updateFileBody(
                            contexts.nicolaas.restContext,
                            'invalid-id',
                            getOAELogoStream,
                            err => {
                              assert.strictEqual(err.code, 400);

                              // Try updating as a non-related person
                              RestAPI.Content.updateFileBody(
                                contexts.simon.restContext,
                                contentObj.id,
                                getOAELogoStream,
                                err => {
                                  assert.strictEqual(err.code, 401);

                                  RestAPI.Content.shareContent(
                                    contexts.nicolaas.restContext,
                                    contentObj.id,
                                    [contexts.simon.user.id],
                                    err => {
                                      assert.ok(!err);

                                      // Try updating as a non-manager
                                      RestAPI.Content.updateFileBody(
                                        contexts.simon.restContext,
                                        contentObj.id,
                                        getOAELogoStream,
                                        err => {
                                          assert.strictEqual(err.code, 401);

                                          // Make Simon a manager
                                          const permissions = {};
                                          permissions[contexts.simon.user.id] = 'manager';
                                          RestAPI.Content.updateMembers(
                                            contexts.nicolaas.restContext,
                                            contentObj.id,
                                            permissions,
                                            err => {
                                              assert.ok(!err);

                                              // Ensure that the original owner can still update
                                              RestAPI.Content.updateFileBody(
                                                contexts.nicolaas.restContext,
                                                contentObj.id,
                                                getOAELogoStream,
                                                err => {
                                                  assert.ok(!err);
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
     * Test that verifies that files can be successfully updated
     */
    it('verify file update', callback => {
      setUpUsers(contexts => {
        RestAPI.Content.createFile(
          contexts.nicolaas.restContext,
          'Test Content 2',
          'Test content description 2',
          PUBLIC,
          getFileStream,
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            // Get all the revisions
            RestAPI.Content.getRevisions(contexts.nicolaas.restContext, contentObj.id, null, null, (err, revisions) => {
              assert.ok(!err);
              assert.ok(Array.isArray(revisions.results));
              assert.strictEqual(revisions.results.length, 1);

              // Verify the revision object
              assert.strictEqual(revisions.results[0].createdBy.displayName, 'Nicolaas Matthijs');
              assert.strictEqual(revisions.results[0].createdBy.resourceType, 'user');
              assert.strictEqual(
                revisions.results[0].createdBy.profilePath,
                '/user/' +
                  revisions.results[0].createdBy.tenant.alias +
                  '/' +
                  AuthzUtil.getResourceFromId(revisions.results[0].createdBy.id).resourceId
              );
              RestAPI.Content.getRevision(
                contexts.nicolaas.restContext,
                contentObj.id,
                revisions.results[0].revisionId,
                (err, revision) => {
                  assert.ok(!err);

                  assert.strictEqual(revision.filename, 'oae-video.png');
                  assert.strictEqual(revision.mime, 'image/png');

                  // Upload a new version
                  RestAPI.Content.updateFileBody(
                    contexts.nicolaas.restContext,
                    contentObj.id,
                    getOAELogoStream,
                    (err, updatedContentObj, response) => {
                      assert.ok(!err);
                      assert.ok(updatedContentObj);

                      // Verify the previews object has been reset
                      assert.strictEqual(updatedContentObj.previews.status, 'pending');
                      assert.strictEqual(_.keys(updatedContentObj.previews).length, 1);

                      // Verify the file information has changed
                      assert.notStrictEqual(contentObj.size, updatedContentObj.size);
                      assert.notStrictEqual(contentObj.filename, updatedContentObj.filename);
                      assert.notStrictEqual(contentObj.uri, updatedContentObj.uri);
                      assert.notStrictEqual(contentObj.downloadPath, updatedContentObj.downloadPath);
                      assert.notStrictEqual(contentObj.latestRevisionId, updatedContentObj.latestRevisionId);
                      assert.notStrictEqual(contentObj.lastModified, updatedContentObj.lastModified);

                      // Verify the backend is returning text/plain as IE9 doesn't support application/json on upload
                      assert.strictEqual(response.headers['content-type'], 'text/plain; charset=utf-8');

                      // Verify we're returning a full content profile
                      assert.ok(updatedContentObj.isManager);
                      assert.strictEqual(updatedContentObj.createdBy.id, contexts.nicolaas.user.id);
                      assert.strictEqual(updatedContentObj.createdBy.displayName, contexts.nicolaas.user.displayName);
                      assert.strictEqual(updatedContentObj.createdBy.profilePath, contexts.nicolaas.user.profilePath);

                      // Get all the revisions
                      RestAPI.Content.getRevisions(
                        contexts.nicolaas.restContext,
                        contentObj.id,
                        null,
                        null,
                        (err, revisions) => {
                          assert.ok(!err);
                          assert.ok(Array.isArray(revisions.results));
                          assert.strictEqual(revisions.results.length, 2);

                          // Revisions should be sorted as the most recent one first
                          RestAPI.Content.getRevision(
                            contexts.nicolaas.restContext,
                            contentObj.id,
                            revisions.results[0].revisionId,
                            (err, revision) => {
                              assert.ok(!err);
                              assert.strictEqual(revision.revisionId, updatedContentObj.latestRevisionId);
                              assert.strictEqual(revision.filename, 'oae-logo.png');
                              assert.strictEqual(revision.mime, 'image/png');
                              assert.strictEqual(revision.downloadPath, updatedContentObj.downloadPath);

                              // Get the profile for a content item and ensure the most recent file properties are present
                              RestAPI.Content.getContent(
                                contexts.nicolaas.restContext,
                                contentObj.id,
                                (err, contentObj) => {
                                  assert.ok(!err);
                                  assert.strictEqual(contentObj.filename, 'oae-logo.png');
                                  assert.strictEqual(contentObj.mime, 'image/png');

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
            });
          }
        );
      });
    });
  });

  describe('Revisions', () => {
    /**
     * Test that verifies that being able to see revisions requires access to the content.
     */
    it('verify revision permissions', callback => {
      setUpUsers(contexts => {
        // Create some content with a couple of revisions
        RestAPI.Content.createFile(
          contexts.simon.restContext,
          'Test Content 1',
          'Test content description 1',
          PRIVATE,
          getFileStream,
          [],
          [],
          [],
          (err, contentSimon) => {
            assert.ok(!err);
            assert.ok(contentSimon);

            RestAPI.Content.updateFileBody(contexts.simon.restContext, contentSimon.id, getOAELogoStream, err => {
              assert.ok(!err);

              RestAPI.Content.getRevisions(
                contexts.simon.restContext,
                contentSimon.id,
                null,
                null,
                (err, revisionsSimon) => {
                  assert.ok(!err);
                  assert.strictEqual(revisionsSimon.results.length, 2);

                  // First of all, Nico shouldn't be able to see the revisions
                  RestAPI.Content.getRevisions(
                    contexts.nicolaas.restContext,
                    contentSimon.id,
                    null,
                    null,
                    (err, revisions) => {
                      assert.strictEqual(err.code, 401);
                      assert.ok(!revisions);

                      // He also can't download them
                      let path = temp.path();
                      RestAPI.Content.download(
                        contexts.nicolaas.restContext,
                        contentSimon.id,
                        revisionsSimon.results[1].revisionId,
                        path,
                        (err, body) => {
                          assert.strictEqual(err.code, 401);
                          assert.ok(!body);

                          // Nico creates a piece of content
                          RestAPI.Content.createLink(
                            contexts.nicolaas.restContext,
                            'Apereo Foundation',
                            'The Apereo Foundation',
                            PRIVATE,
                            'http://www.apereo.org/',
                            [],
                            [],
                            [],
                            (err, contentNico) => {
                              assert.ok(!err);

                              // Nico should not be able to download a revision of Simon's file
                              // by using one of his own content ID's and one of simon's revision ID he got (somehow)
                              path = temp.path();
                              RestAPI.Content.download(
                                contexts.nicolaas.restContext,
                                contentNico.id,
                                revisionsSimon.results[1].revisionId,
                                path,
                                (err, body) => {
                                  assert.strictEqual(err.code, 400);
                                  assert.ok(!body);
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
     * Test that verifies validation for revsions
     */
    it('verify revision parameter validation', callback => {
      setUpUsers(contexts => {
        // Create some content with a couple of revisions
        RestAPI.Content.createFile(
          contexts.simon.restContext,
          'Test Content 1',
          'Test content description 1',
          PRIVATE,
          getFileStream,
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);

            RestAPI.Content.updateFileBody(contexts.simon.restContext, contentObj.id, getOAELogoStream, err => {
              assert.ok(!err);

              // Try to get the revisions with a faulty contentId
              RestAPI.Content.getRevisions(contexts.simon.restContext, 'not-a-content-id', null, null, err => {
                assert.strictEqual(err.code, 400);

                // Get them and try downloading with a faulty revisionId.
                RestAPI.Content.getRevisions(
                  contexts.simon.restContext,
                  contentObj.id,
                  null,
                  null,
                  (err, revisions) => {
                    assert.ok(!err);

                    const path = temp.path();
                    RestAPI.Content.download(
                      contexts.simon.restContext,
                      contentObj.id,
                      'not-a-revision-id',
                      path,
                      (err, response) => {
                        assert.strictEqual(err.code, 400);
                        callback();
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
     * Test that verifies that only a limited set of revisions can be retrieved per request.
     */
    it('verify limiting revisions retrievals', callback => {
      setUpUsers(contexts => {
        // Create some content with a couple of revisions
        RestAPI.Content.createFile(
          contexts.simon.restContext,
          'Test Content',
          'Test content description',
          PRIVATE,
          getFileStream,
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);

            // Create 30 revisions
            const createdRevisions = [];
            const createRevisions = function(callback) {
              RestAPI.Content.updateFileBody(
                contexts.simon.restContext,
                contentObj.id,
                getOAELogoStream,
                (err, revision) => {
                  assert.ok(!err);
                  createdRevisions.push(revision);
                  if (createdRevisions.length === 30) {
                    return callback(createdRevisions);
                  }

                  createRevisions(callback);
                }
              );
            };

            createRevisions(createdRevisions => {
              // Try to get a negative amount of revisions, it should return 1 item
              RestAPI.Content.getRevisions(contexts.simon.restContext, contentObj.id, null, -100, (err, revisions) => {
                assert.ok(!err);
                assert.strictEqual(revisions.results.length, 1);

                // Fetching a 100 revisions should result in an upper bound of 25
                RestAPI.Content.getRevisions(contexts.simon.restContext, contentObj.id, null, 100, (err, revisions) => {
                  assert.ok(!err);
                  assert.strictEqual(revisions.results.length, 25);

                  // Assert paging.
                  RestAPI.Content.getRevisions(contexts.simon.restContext, contentObj.id, null, 5, (err, firstPage) => {
                    assert.ok(!err);
                    assert.strictEqual(firstPage.results.length, 5);
                    assert.strictEqual(firstPage.nextToken, firstPage.results[4].created);

                    RestAPI.Content.getRevisions(
                      contexts.simon.restContext,
                      contentObj.id,
                      firstPage.nextToken,
                      5,
                      (err, secondPage) => {
                        assert.ok(!err);
                        assert.strictEqual(secondPage.results.length, 5);

                        // Ensure that there are no duplicates in the revision pages.
                        _.each(secondPage.results, secondPageRevision => {
                          _.each(firstPage.results, firstPageRevision => {
                            assert.notStrictEqual(firstPageRevision.revisionId, secondPageRevision.revisionId);
                          });
                        });
                        callback();
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

    /**
     * Verifies that an older file can be restored.
     */
    it('verify revision restoration', callback => {
      setUpUsers(contexts => {
        // Create some content with a couple of revisions
        RestAPI.Content.createFile(
          contexts.simon.restContext,
          'Test Content 1',
          'Test content description 1',
          PRIVATE,
          getFileStream,
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj);

            RestAPI.Content.updateFileBody(contexts.simon.restContext, contentObj.id, getOAELogoStream, err => {
              assert.ok(!err);

              // Get the revisions and restore the first one.
              RestAPI.Content.getRevisions(contexts.simon.restContext, contentObj.id, null, null, (err, revisions) => {
                assert.ok(!err);

                // Get the url for the 'latest' version of the file
                const path = temp.path();
                RestAPI.Content.download(contexts.simon.restContext, contentObj.id, null, path, (err, response) => {
                  assert.ok(!err);
                  assert.strictEqual(response.statusCode, 204);
                  const url = response.headers['x-accel-redirect'];

                  // Now restore the original file.
                  RestAPI.Content.restoreRevision(
                    contexts.simon.restContext,
                    contentObj.id,
                    revisions.results[1].revisionId,
                    (err, revisionObj) => {
                      assert.ok(!err);
                      assert.ok(revisionObj);

                      // Get the url for the 'new latest' version of the file.
                      RestAPI.Content.download(
                        contexts.simon.restContext,
                        contentObj.id,
                        null,
                        path,
                        (err, response) => {
                          assert.ok(!err);
                          assert.strictEqual(response.statusCode, 204);
                          const latestUrl = response.headers['x-accel-redirect'];
                          assert.notStrictEqual(url, latestUrl);
                          callback();
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

  describe('Delete content', () => {
    /**
     * Utitility function for the content delete assert. This function will create a piece of content, add a manager and a viewer using the setPermissions function,
     * share the content with an additional user. After each of these, the expected access will be checked. After that, the test will attempt to delete the content
     * as an anonymous user, a logged in user, a content member and a content manager. After that, the tests check if each of those can still access the content,
     * whether or not all roles have deleted, whether or not all libraries have been updated and whether or not the content members list is no longer available
     * @param  {Array<Context>}     contexts            Array of context objects that represent a request cycle and contain
     *                                                  the current user and the current tenant
     * @param  {User}               privacy             Privacy setting for the piece of content. Can be public, loggedin or private
     * @param  {Function(content)}  callback            Standard callback function
     */
    const prepareDelete = function(contexts, privacy, callback) {
      // Create a content item
      RestAPI.Content.createLink(
        contexts.nicolaas.restContext,
        'Test Content 1',
        'Test content description 1',
        privacy,
        'http://www.oaeproject.org/',
        [],
        [],
        [],
        (err, contentObj) => {
          assert.ok(!err);
          assert.ok(contentObj.id);
          // Get the piece of content as the creator
          checkPieceOfContent(
            contexts.nicolaas.restContext,
            contexts.nicolaas.user.id,
            contentObj,
            true,
            true,
            true,
            true,
            () => {
              // Make a user a manager and make a user a member
              const permissions = {};
              permissions[contexts.simon.user.id] = 'manager';
              permissions[contexts.ian.user.id] = 'viewer';
              RestAPI.Content.updateMembers(contexts.nicolaas.restContext, contentObj.id, permissions, err => {
                assert.ok(!err);
                checkPieceOfContent(
                  contexts.simon.restContext,
                  contexts.simon.user.id,
                  contentObj,
                  true,
                  true,
                  true,
                  true,
                  () => {
                    checkPieceOfContent(
                      contexts.ian.restContext,
                      contexts.ian.user.id,
                      contentObj,
                      true,
                      false,
                      true,
                      privacy !== PRIVATE,
                      () => {
                        // Share the content with another user
                        RestAPI.Content.shareContent(
                          contexts.simon.restContext,
                          contentObj.id,
                          [contexts.stuart.user.id],
                          err => {
                            assert.ok(!err);
                            checkPieceOfContent(
                              contexts.stuart.restContext,
                              contexts.stuart.user.id,
                              contentObj,
                              true,
                              false,
                              true,
                              privacy !== PRIVATE,
                              () => {
                                // Try to delete the content as an anonymous user
                                RestAPI.Content.deleteContent(anonymousRestContext, contentObj.id, err => {
                                  assert.ok(err);
                                  // Check that it is still around
                                  checkPieceOfContent(
                                    contexts.nicolaas.restContext,
                                    contexts.nicolaas.user.id,
                                    contentObj,
                                    true,
                                    true,
                                    true,
                                    true,
                                    () => {
                                      // Try to delete the content as a logged in user
                                      RestAPI.Content.deleteContent(
                                        contexts.anthony.restContext,
                                        contentObj.id,
                                        err => {
                                          assert.ok(err);
                                          // Check that it is still around
                                          checkPieceOfContent(
                                            contexts.nicolaas.restContext,
                                            contexts.nicolaas.user.id,
                                            contentObj,
                                            true,
                                            true,
                                            true,
                                            true,
                                            () => {
                                              // Try to delete the content as a content member
                                              RestAPI.Content.deleteContent(
                                                contexts.stuart.restContext,
                                                contentObj.id,
                                                err => {
                                                  assert.ok(err);
                                                  // Check that it is still around
                                                  checkPieceOfContent(
                                                    contexts.nicolaas.restContext,
                                                    contexts.nicolaas.user.id,
                                                    contentObj,
                                                    true,
                                                    true,
                                                    true,
                                                    true,
                                                    () => {
                                                      // Try to delete the content as a content manager
                                                      RestAPI.Content.deleteContent(
                                                        contexts.nicolaas.restContext,
                                                        contentObj.id,
                                                        err => {
                                                          assert.ok(!err);
                                                          // Check to see if the manager, a member, a logged in user and the anonymous user still have access
                                                          checkPieceOfContent(
                                                            contexts.nicolaas.restContext,
                                                            contexts.nicolaas.user.id,
                                                            contentObj,
                                                            false,
                                                            false,
                                                            false,
                                                            false,
                                                            () => {
                                                              checkPieceOfContent(
                                                                contexts.ian.restContext,
                                                                contexts.ian.user.id,
                                                                contentObj,
                                                                false,
                                                                false,
                                                                false,
                                                                false,
                                                                () => {
                                                                  checkPieceOfContent(
                                                                    contexts.anthony.restContext,
                                                                    contexts.anthony.user.id,
                                                                    contentObj,
                                                                    false,
                                                                    false,
                                                                    false,
                                                                    false,
                                                                    () => {
                                                                      checkPieceOfContent(
                                                                        anonymousRestContext,
                                                                        contexts.nicolaas.user.id,
                                                                        contentObj,
                                                                        false,
                                                                        false,
                                                                        false,
                                                                        false,
                                                                        () => {
                                                                          // Check roles api for the role on the content for a manager, a member and a logged in user
                                                                          AuthzAPI.getAllRoles(
                                                                            contexts.nicolaas.user.id,
                                                                            contentObj.id,
                                                                            (err, roles) => {
                                                                              assert.strictEqual(roles.length, 0);
                                                                              AuthzAPI.getAllRoles(
                                                                                contexts.ian.user.id,
                                                                                contentObj.id,
                                                                                (err, roles) => {
                                                                                  assert.strictEqual(roles.length, 0);
                                                                                  AuthzAPI.getAllRoles(
                                                                                    contexts.anthony.user.id,
                                                                                    contentObj.id,
                                                                                    (err, roles) => {
                                                                                      assert.strictEqual(
                                                                                        roles.length,
                                                                                        0
                                                                                      );

                                                                                      // Ensure list of members is no longer accessible
                                                                                      return ContentTestUtil.assertGetContentMembersFails(
                                                                                        contexts.nicolaas.restContext,
                                                                                        contentObj.id,
                                                                                        null,
                                                                                        null,
                                                                                        404,
                                                                                        callback
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
                          }
                        );
                      }
                    );
                  }
                );
              });
            }
          );
        }
      );
    };

    /**
     * Test that will attempt to create a public piece of content and delete it
     */
    it('verify public delete', callback => {
      setUpUsers(contexts => {
        prepareDelete(contexts, PUBLIC, callback);
      });
    });

    /**
     * Test that will attempt to create a logged in piece of content and delete it
     */
    it('verify logged in delete', callback => {
      setUpUsers(contexts => {
        prepareDelete(contexts, LOGGEDIN, callback);
      });
    });

    /**
     * Test that will attempt to create a private piece of content and delete it
     */
    it('verify private delete', callback => {
      setUpUsers(contexts => {
        prepareDelete(contexts, PRIVATE, callback);
      });
    });

    /**
     * Verify file deletion
     */
    it('verify file delete', callback => {
      setUpUsers(contexts => {
        RestAPI.Content.createFile(
          contexts.nicolaas.restContext,
          'Test Content 2',
          'Test content description 2',
          PUBLIC,
          getFileStream,
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            // Get the last revision.
            RestAPI.Content.getRevisions(contexts.nicolaas.restContext, contentObj.id, null, 1000, (err, revisions) => {
              assert.ok(!err);

              RestAPI.Content.deleteContent(contexts.nicolaas.restContext, contentObj.id, err => {
                assert.ok(!err);

                // Get the last revision.
                RestAPI.Content.getRevisions(
                  contexts.nicolaas.restContext,
                  contentObj.id,
                  null,
                  1000,
                  (err, revisions) => {
                    assert.strictEqual(err.code, 404);
                    callback();
                  }
                );
              });
            });
          }
        );
      });
    });
  });

  /**
   * Verify collabdoc or collabsheet editors can't delete
   */
  it("verify collabdoc or collabsheet editors can't delete", callback => {
    setUpUsers(contexts => {
      RestAPI.Content.createCollabDoc(
        contexts.nicolaas.restContext,
        'Test CollabDoc',
        'Doc description',
        PUBLIC,
        [],
        [contexts.stuart.user.id],
        [],
        [],
        (err, contentObj) => {
          assert.ok(!err);
          RestAPI.Content.deleteContent(contexts.stuart.restContext, contentObj.id, err => {
            assert.strictEqual(err.code, 401);

            RestAPI.Content.deleteContent(contexts.nicolaas.restContext, contentObj.id, err => {
              assert.ok(!err);
              RestAPI.Content.createCollabsheet(
                contexts.nicolaas.restContext,
                'Test collabsheet',
                'Description',
                PUBLIC,
                [],
                [contexts.stuart.user.id],
                [],
                [],
                function(err, contentObj) {
                  assert.ok(!err);
                  RestAPI.Content.deleteContent(contexts.stuart.restContext, contentObj.id, function(err) {
                    assert.strictEqual(err.code, 401);

                    RestAPI.Content.deleteContent(contexts.nicolaas.restContext, contentObj.id, function(err) {
                      assert.ok(!err);
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

  describe('Content permissions', () => {
    /**
     * Utility function that creates a piece of content, make a user a manager, make a user a viewer and test access for all of these as
     * well as library content and the membership list of the content
     * @param  {Object}             contexts            Object where the keys are identifiers for the created users and the values are an
     *                                                  object with a user key containing the user object for the created user and a restContext key
     *                                                  containing the REST Context for that user
     * @param  {User}               privacy             Privacy setting for the piece of content. Can be public, loggedin or private
     * @param  {Function(content)}  callback            Standard callback function
     * @param  {Content}            callback.content    Content object that has been created as part of this test
     */
    const setUpContentPermissions = function(contexts, privacy, callback) {
      // Create a public content item
      RestAPI.Content.createLink(
        contexts.nicolaas.restContext,
        'Test Content 1',
        'Test content description 1',
        privacy,
        'http://www.oaeproject.org/',
        [],
        [],
        [],
        (err, contentObj) => {
          assert.ok(!err);
          assert.ok(contentObj.id);

          // Get the piece of content as the person who created the content
          checkPieceOfContent(
            contexts.nicolaas.restContext,
            contexts.nicolaas.user.id,
            contentObj,
            true,
            true,
            true,
            true,
            () => {
              // Make another user viewer of the content
              const permissions = {};
              permissions[contexts.stuart.user.id] = 'viewer';
              return ContentTestUtil.assertUpdateContentMembersSucceeds(
                contexts.nicolaas.restContext,
                contexts.nicolaas.restContext,
                contentObj.id,
                permissions,
                () => {
                  return callback(contentObj);
                }
              );
            }
          );
        }
      );
    };

    /**
     * Test that will attempt to set permissions on a public piece of content
     */
    it('verify public content permissions', callback => {
      setUpUsers(contexts => {
        setUpContentPermissions(contexts, PUBLIC, contentObj => {
          // Get the piece of content as a non-associated user
          checkPieceOfContent(
            contexts.branden.restContext,
            contexts.branden.user.id,
            contentObj,
            true,
            false,
            false,
            true,
            () => {
              // Get the piece of content as an anonymous user
              checkPieceOfContent(
                anonymousRestContext,
                contexts.nicolaas.user.id,
                contentObj,
                true,
                false,
                true,
                false,
                callback
              );
            }
          );
        });
      });
    });

    /**
     * Test that will attempt to set permissions on a loggedin piece of content
     */
    it('verify logged in content permissions', callback => {
      setUpUsers(contexts => {
        setUpContentPermissions(contexts, LOGGEDIN, contentObj => {
          // Get the piece of content as a non-associated user
          checkPieceOfContent(
            contexts.branden.restContext,
            contexts.branden.user.id,
            contentObj,
            true,
            false,
            false,
            true,
            () => {
              // Get the piece of content as an anonymous user
              checkPieceOfContent(
                anonymousRestContext,
                contexts.nicolaas.user.id,
                contentObj,
                false,
                false,
                false,
                false,
                callback
              );
            }
          );
        });
      });
    });

    /**
     * Test that will attempt to set permissions on a private piece of content
     */
    it('verify private content permissions', callback => {
      setUpUsers(contexts => {
        setUpContentPermissions(contexts, PRIVATE, contentObj => {
          // Get the piece of content as a non-associated user
          checkPieceOfContent(
            contexts.branden.restContext,
            contexts.branden.user.id,
            contentObj,
            false,
            false,
            false,
            false,
            () => {
              // Get the piece of content as an anonymous user
              checkPieceOfContent(
                anonymousRestContext,
                contexts.nicolaas.user.id,
                contentObj,
                false,
                false,
                false,
                false,
                callback
              );
            }
          );
        });
      });
    });

    /**
     * Test that will attempt to set permissions on multiple principals at once. It will add permissions and
     * remove permissions on sets of principals that have all valid principals and some with non-valid principals
     */
    it('verify multiple content permissions', callback => {
      setUpUsers(contexts => {
        // Create a content item
        RestAPI.Content.createLink(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            // Set permission on multiple people at the same time (managers and members)
            let permissions = {};
            permissions[contexts.simon.user.id] = 'manager';
            permissions[contexts.stuart.user.id] = 'viewer';
            permissions[contexts.ian.user.id] = 'viewer';
            ContentTestUtil.assertUpdateContentMembersSucceeds(
              contexts.nicolaas.restContext,
              contexts.nicolaas.restContext,
              contentObj.id,
              permissions,
              () => {
                // Set permission on multiple people at same time, some remove role
                permissions = {};
                permissions[contexts.simon.user.id] = false;
                permissions[contexts.stuart.user.id] = false;
                permissions[contexts.anthony.user.id] = 'viewer';
                ContentTestUtil.assertUpdateContentMembersSucceeds(
                  contexts.nicolaas.restContext,
                  contexts.nicolaas.restContext,
                  contentObj.id,
                  permissions,
                  () => {
                    // Set permission on multiple people at same time (managers and members), some invalid
                    permissions = {};
                    permissions[contexts.simon.user.id] = 'manager';
                    permissions[contexts.stuart.user.id] = 'viewer';
                    permissions['u:cam:non-existing-user'] = 'viewer';
                    ContentTestUtil.assertUpdateContentMembersFails(
                      contexts.nicolaas.restContext,
                      contexts.nicolaas.restContext,
                      contentObj.id,
                      permissions,
                      400,
                      () => {
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
     * Verifies that you cannot create ghost entities by removing all the managers of a content item.
     */
    it('verify removal of all managers is not possible', callback => {
      setUpUsers(contexts => {
        // Create a content item
        RestAPI.Content.createLink(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            assert.ok(contentObj.id);

            // Set permission on multiple people at the same time (managers and members)
            let permissions = {};
            permissions[contexts.simon.user.id] = 'manager';
            permissions[contexts.stuart.user.id] = 'viewer';
            permissions[contexts.ian.user.id] = 'viewer';
            RestAPI.Content.updateMembers(contexts.nicolaas.restContext, contentObj.id, permissions, err => {
              assert.ok(!err);

              // Removing all the managers should not be allowed
              permissions = {};
              permissions[contexts.simon.user.id] = false;
              permissions[contexts.nicolaas.user.id] = false;
              RestAPI.Content.updateMembers(contexts.nicolaas.restContext, contentObj.id, permissions, err => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                // Making both of them viewer should not work either.
                permissions = {};
                permissions[contexts.simon.user.id] = 'viewer';
                permissions[contexts.nicolaas.user.id] = 'viewer';
                RestAPI.Content.updateMembers(contexts.nicolaas.restContext, contentObj.id, permissions, err => {
                  assert.strictEqual(err.code, 400);

                  // Removing everyone should not be possible
                  permissions = {};
                  permissions[contexts.simon.user.id] = false;
                  permissions[contexts.nicolaas.user.id] = false;
                  permissions[contexts.stuart.user.id] = false;
                  permissions[contexts.ian.user.id] = false;
                  RestAPI.Content.updateMembers(contexts.nicolaas.restContext, contentObj.id, permissions, err => {
                    assert.strictEqual(err.code, 400);

                    permissions = {};
                    permissions[contexts.simon.user.id] = 'viewer';
                    permissions[contexts.nicolaas.user.id] = false;
                    RestAPI.Content.updateMembers(contexts.nicolaas.restContext, contentObj.id, permissions, err => {
                      assert.strictEqual(err.code, 400);
                      callback();
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
     * Simple test that performs some basic validation mechanismes
     * when setting permissions on a piece of content.
     */
    it('verify validation on setting content permissions', callback => {
      setUpUsers(contexts => {
        // Create a content item
        RestAPI.Content.createLink(
          contexts.nicolaas.restContext,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);

            const validPermissions = AuthzTestUtil.createRoleChange([contexts.simon.user.id], 'manager');

            // Invalid content id
            RestAPI.Content.updateMembers(contexts.nicolaas.restContext, 'invalidContentId', validPermissions, err => {
              assert.strictEqual(err.code, 400);

              // Missing role changes
              RestAPI.Content.updateMembers(contexts.nicolaas.restContext, contentObj.id, {}, err => {
                assert.strictEqual(err.code, 400);

                // Invalid principal
                RestAPI.Content.updateMembers(
                  contexts.nicolaas.restContext,
                  contentObj.id,
                  { 'invalid-id': 'manager' },
                  err => {
                    assert.strictEqual(err.code, 400);

                    // Invalid role change
                    let permissions = AuthzTestUtil.createRoleChange([contexts.simon.user.id], 'totally-wrong-role');
                    RestAPI.Content.updateMembers(contexts.nicolaas.restContext, contentObj.id, permissions, err => {
                      assert.strictEqual(err.code, 400);

                      // The value `true` is not a valid role change either
                      permissions = AuthzTestUtil.createRoleChange([contexts.simon.user.id], true);
                      RestAPI.Content.updateMembers(contexts.nicolaas.restContext, contentObj.id, permissions, err => {
                        assert.strictEqual(err.code, 400);

                        // The value `editor` is only valid on collabdocs
                        permissions = AuthzTestUtil.createRoleChange([contexts.simon.user.id], 'editor');
                        RestAPI.Content.updateMembers(
                          contexts.nicolaas.restContext,
                          contentObj.id,
                          permissions,
                          err => {
                            assert.strictEqual(err.code, 400);

                            // Sanity check
                            RestAPI.Content.updateMembers(
                              contexts.nicolaas.restContext,
                              contentObj.id,
                              validPermissions,
                              err => {
                                assert.ok(!err);
                                RestAPI.Content.updateContent(
                                  contexts.simon.restContext,
                                  contentObj.id,
                                  { displayName: 'Sweet stuff' },
                                  (err, updatedContentObj) => {
                                    assert.ok(!err);
                                    assert.strictEqual(updatedContentObj.displayName, 'Sweet stuff');
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
            });
          }
        );
      });
    });

    /**
     * Test that verifies that you cannot add a private user as a member
     */
    it('verify adding a private user as a member is not possible', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
        assert.ok(!err);
        const nico = _.values(users)[0];
        const bert = _.values(users)[1];

        RestAPI.User.updateUser(bert.restContext, bert.user.id, { visibility: PRIVATE }, err => {
          assert.ok(!err);

          RestAPI.Content.createLink(
            nico.restContext,
            'Test Content',
            'Test content description',
            PUBLIC,
            'http://www.google.com',
            [],
            [],
            [],
            (err, contentObj) => {
              assert.ok(!err);

              const update = {};
              update[bert.user.id] = 'manager';
              RestAPI.Content.updateMembers(nico.restContext, contentObj.id, update, err => {
                assert.strictEqual(err.code, 401);
                callback();
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies that you cannot add a private group as a member
     */
    it('verify adding a private group as a member is not possible', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
        assert.ok(!err);
        const nico = _.values(users)[0];
        const bert = _.values(users)[1];

        RestAPI.Group.createGroup(
          bert.restContext,
          'Group title',
          'Group description',
          PRIVATE,
          undefined,
          [],
          [],
          (err, groupObj) => {
            assert.ok(!err);

            RestAPI.Content.createLink(
              nico.restContext,
              'Test Content',
              'Test content description',
              PUBLIC,
              'http://www.google.com',
              [],
              [],
              [],
              (err, contentObj) => {
                assert.ok(!err);

                const update = {};
                update[groupObj.id] = 'manager';
                RestAPI.Content.updateMembers(nico.restContext, contentObj.id, update, err => {
                  assert.strictEqual(err.code, 401);
                  callback();
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that content members can be removed/updated even if their visibility setting is private
     */
    it('verify private users can be updated/removed as content members', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
        assert.ok(!err);
        const nico = _.values(users)[0];
        const bert = _.values(users)[1];

        RestAPI.Content.createLink(
          nico.restContext,
          'Test Content',
          'Test content description',
          PUBLIC,
          'http://www.google.com',
          [],
          [bert.user.id],
          [],
          (err, contentObj) => {
            assert.ok(!err);

            RestAPI.User.updateUser(bert.restContext, bert.user.id, { visibility: PRIVATE }, err => {
              assert.ok(!err);

              // Changing the role of a private user (that was already a member) should work
              const update = {};
              update[bert.user.id] = 'manager';
              ContentTestUtil.assertUpdateContentMembersSucceeds(
                nico.restContext,
                nico.restContext,
                contentObj.id,
                update,
                () => {
                  // Removing a private user (that was already a member) should work
                  update[bert.user.id] = false;
                  return ContentTestUtil.assertUpdateContentMembersSucceeds(
                    nico.restContext,
                    nico.restContext,
                    contentObj.id,
                    update,
                    callback
                  );
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies that content member listings can be paged
     */
    it('verify getting content members paging', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 10, (err, users) => {
        assert.ok(!err);
        const simon = _.values(users)[0];

        // Get the user ids for the users we'll add as members
        const members = _.filter(_.values(users), user => {
          return user.user.id !== simon.user.id;
        });
        const memberIds = [];
        _.each(members, user => {
          memberIds.push(user.user.id);
        });

        // Create a piece of content with 10 members (including the content creator)
        RestAPI.Content.createLink(
          simon.restContext,
          'Test Content',
          'Test content description',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          memberIds,
          [],
          (err, contentObj) => {
            assert.ok(!err);

            // Ensure paging by 3 results in 4 requests, totalling 10 total members
            ContentTestUtil.getAllContentMembers(
              simon.restContext,
              contentObj.id,
              { batchSize: 3 },
              (members, responses) => {
                assert.strictEqual(members.length, 10);
                assert.strictEqual(responses.length, 4);
                assert.strictEqual(responses[0].results.length, 3);
                assert.strictEqual(responses[1].results.length, 3);
                assert.strictEqual(responses[2].results.length, 3);
                assert.strictEqual(responses[3].results.length, 1);
                return callback();
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that request parameters get validated when retrieving the members on a piece of content
     */
    it('verify getting content members validation', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        assert.ok(!err);
        const ctx = _.values(users)[0].restContext;

        RestAPI.Content.createLink(
          ctx,
          'Test Content',
          'Test content description',
          PUBLIC,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);

            // Ensure invalid content ids result in 400 response
            ContentTestUtil.assertGetContentMembersFails(ctx, ' ', null, null, 400, () => {
              ContentTestUtil.assertGetContentMembersFails(ctx, 'invalid-id', null, null, 400, () => {
                // Sanity check the base parameters results in success
                ContentTestUtil.assertGetContentMembersSucceeds(ctx, contentObj.id, null, null, members => {
                  assert.strictEqual(members.results.length, 1);
                  return callback();
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies collabdoc or collabsheets editors can't change permissions, but can share
     */
    it("verify collabdoc or collabsheets editors can't change permissions", callback => {
      setUpUsers(contexts => {
        RestAPI.Content.createCollabDoc(
          contexts.nicolaas.restContext,
          'Test CollabDoc',
          'Doc description',
          PUBLIC,
          [],
          [contexts.stuart.user.id],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            const members = {};
            members[contexts.anthony.user.id] = 'viewer';
            // Editor can't add new members
            ContentTestUtil.assertUpdateContentMembersFails(
              contexts.nicolaas.restContext,
              contexts.stuart.restContext,
              contentObj.id,
              members,
              401,
              () => {
                ContentTestUtil.assertShareContentSucceeds(
                  contexts.nicolaas.restContext,
                  contexts.stuart.restContext,
                  contentObj.id,
                  _.keys(members),
                  function() {
                    // Make sure same is true for collaborative spreadsheets
                    RestAPI.Content.createCollabsheet(
                      contexts.stuart.restContext,
                      'Test collabsheet',
                      'Sheet description',
                      PUBLIC,
                      [],
                      [contexts.nicolaas.user.id],
                      [],
                      [],
                      function(err, contentObj) {
                        assert.ok(!err);
                        const members = {};
                        members[contexts.anthony.user.id] = 'viewer';
                        ContentTestUtil.assertUpdateContentMembersFails(
                          contexts.stuart.restContext,
                          contexts.nicolaas.restContext,
                          contentObj.id,
                          members,
                          401,
                          function() {
                            ContentTestUtil.assertShareContentSucceeds(
                              contexts.stuart.restContext,
                              contexts.nicolaas.restContext,
                              contentObj.id,
                              _.keys(members),
                              callback
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
     * Test that verifies setting permissions for a userId+email combination will add the user
     * as a member
     */
    it('verify setting permissions with validated user id adds it to their library', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, creatingUserInfo, targetUserInfo) => {
        assert.ok(!err);

        // Create a content item on which to set roles
        const randomString = TestsUtil.generateRandomText(1);
        ContentTestUtil.assertCreateLinkSucceeds(
          creatingUserInfo.restContext,
          randomString,
          randomString,
          PUBLIC,
          'http://www.oaeproject.org',
          [],
          [],
          [],
          content => {
            // Set the roles of the content item
            const roleChanges = _.object([
              [util.format('%s:%s', targetUserInfo.user.email, targetUserInfo.user.id), 'manager']
            ]);
            ContentTestUtil.assertUpdateContentMembersSucceeds(
              creatingUserInfo.restContext,
              creatingUserInfo.restContext,
              content.id,
              roleChanges,
              () => {
                return callback();
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies setting permissions with an email associated to a unique email account
     * adds it to their library
     */
    it('verify setting permissions with an email associated to a unique email account adds it to their library', callback => {
      TestsUtil.generateTestUsers(
        camAdminRestContext,
        4,
        (err, users, creatingUserInfo, targetUserInfoA, targetUserInfoB1, targetUserInfoB2) => {
          assert.ok(!err);

          // Create a content item on which to set roles
          const randomString = TestsUtil.generateRandomText(1);
          ContentTestUtil.assertCreateLinkSucceeds(
            creatingUserInfo.restContext,
            randomString,
            randomString,
            PUBLIC,
            'http://www.oaeproject.org',
            [],
            [],
            [],
            content => {
              // Set the roles of the content item
              let roleChanges = _.object([[targetUserInfoA.user.email, 'manager']]);
              // RestCtx, contentId, updatedMembers, callback
              RestAPI.Content.updateMembers(creatingUserInfo.restContext, content.id, roleChanges, err => {
                assert.ok(!err);

                // Ensure the invitations list is empty
                AuthzTestUtil.assertGetInvitationsSucceeds(
                  creatingUserInfo.restContext,
                  'content',
                  content.id,
                  result => {
                    assert.ok(result);
                    assert.ok(_.isArray(result.results));
                    assert.ok(_.isEmpty(result.results));

                    // Ensure the members library of the content item contains the target user
                    ContentTestUtil.getAllContentMembers(creatingUserInfo.restContext, content.id, null, members => {
                      const targetMember = _.find(members, member => {
                        return member.profile.id === targetUserInfoA.user.id;
                      });
                      assert.ok(targetMember);

                      // Ensure the target user's content library contains the content item
                      ContentTestUtil.assertGetAllContentLibrarySucceeds(
                        targetUserInfoA.restContext,
                        targetUserInfoA.user.id,
                        null,
                        contentItems => {
                          assert.ok(_.findWhere(contentItems, { id: content.id }));

                          // Update the B target users to have the same emails
                          PrincipalsTestUtil.assertUpdateUserSucceeds(
                            targetUserInfoB2.restContext,
                            targetUserInfoB2.user.id,
                            { email: targetUserInfoB1.user.email },
                            (updatedUser, token) => {
                              PrincipalsTestUtil.assertVerifyEmailSucceeds(
                                targetUserInfoB2.restContext,
                                targetUserInfoB2.user.id,
                                token,
                                () => {
                                  // Perform a regular email invitation with the same email,
                                  // ensuring it is the invitations list that updates, not the
                                  // members
                                  roleChanges = _.object([[targetUserInfoB1.user.email, 'manager']]);
                                  ContentTestUtil.assertUpdateContentMembersSucceeds(
                                    creatingUserInfo.restContext,
                                    creatingUserInfo.restContext,
                                    content.id,
                                    roleChanges,
                                    () => {
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
            }
          );
        }
      );
    });
  });

  describe('Content sharing', () => {
    /**
     * Utility function for the sharing tests that will create a new content item, check for successful creation and check that
     * the right set of content members are retrieved
     * @param  {Object}             contexts            Object where the keys are identifiers for the created users and the values are an
     *                                                  object with a user key containing the user object for the created user and a restContext key
     *                                                  containing the REST Context for that user
     * @param  {User}               privacy             Privacy setting for the piece of content. Can be public, loggedin or private
     * @param  {Function(content)}  callback            Standard callback function
     * @param  {Content}            callback.content    Content object that has been created as part of this test
     */
    const prepareSharing = function(contexts, privacy, callback) {
      // Create a content item
      RestAPI.Content.createLink(
        contexts.nicolaas.restContext,
        'Test Content 1',
        'Test content description 1',
        privacy,
        'http://www.oaeproject.org/',
        [],
        [],
        [],
        (err, contentObj) => {
          assert.ok(!err);
          assert.ok(contentObj.id);
          // Get the piece of content as the creator
          checkPieceOfContent(
            contexts.nicolaas.restContext,
            contexts.nicolaas.user.id,
            contentObj,
            true,
            true,
            true,
            true,
            () => {
              return callback(contentObj);
            }
          );
        }
      );
    };

    /**
     * Utility function for the sharing tests that will try to share content, will then check for access to the content by the person
     * the content was shared with. Then the test will check whether that person can see the content's membership list and sees the
     * correct list of members in there
     * @param  {Content}        contentObj          Content object that will be shared
     * @param  {Object}         sharer              Object representing the user that will share the content. The object will have a user key containing the user's basic profile and a restContext key containing the user's Rest Context
     * @param  {Object}         shareWith           Object representing the user that the content will be shared with. The object will have a user key containing the user's basic profile and a restContext key containing the user's Rest Context. Content access, library presence and membership checks will be run on this user
     * @param  {Boolean}        expectShare         Whether or not we expect that user 1 will be able to share the content with user 2
     * @param  {Boolean}        expectAccess        Whether or not we expect that user 2 will have access to the content after it's been shared with him
     * @param  {Boolean}        expectManager       Whether or not we expect that user 2 will be able to manage the content after it's been shared with him
     * @param  {Boolean}        expectInLibrary     Whether or not we expect user 2 to be able to see the content in his library after it's been shared with him
     * @param  {Object}         expectedMembers     JSON object representing the members that are expected to be on the content item after sharing. The keys represent the member ids and the values represent the role they should have.
     * @param  {Boolean}         expectCanShare      Whether or not we expect user 2 to be able to share the content with further users
     * @param  {Function}       callback            Standard callback function
     */
    const testSharing = function(
      contentObj,
      sharer,
      shareWith,
      expectShare,
      expectAccess,
      expectManager,
      expectInLibrary,
      expectedMembers,
      expectCanShare,
      callback
    ) {
      RestAPI.Content.shareContent(sharer.restContext, contentObj.id, [shareWith.user.id], err => {
        if (expectShare) {
          assert.ok(!err);
        } else {
          assert.ok(err);
        }

        checkPieceOfContent(
          shareWith.restContext,
          shareWith.user ? shareWith.user.id : null,
          contentObj,
          expectAccess,
          expectManager,
          expectInLibrary,
          expectCanShare,
          () => {
            RestAPI.Content.getMembers(shareWith.restContext, contentObj.id, null, null, (err, members) => {
              if (expectedMembers) {
                assert.ok(!err);
                assert.strictEqual(members.results.length, _.keys(expectedMembers).length);
                for (let m = 0; m < members.results.length; m++) {
                  assert.strictEqual(members.results[m].role, expectedMembers[members.results[m].profile.id]);
                }
              } else {
                assert.ok(err);
              }

              callback();
            });
          }
        );
      });
    };

    /**
     * Test that will attempt to create a public piece of content, share it as the manager, share it as a member, share it
     * as a non-related user and share it as an anonymous user. For each of those, it will check for content access, library
     * presence and the correct content membership list
     */
    it('verify public sharing', callback => {
      setUpUsers(contexts => {
        // Create a public content item
        prepareSharing(contexts, PUBLIC, contentObj => {
          // Share as content owner
          const expectedMembers = {};
          expectedMembers[contexts.nicolaas.user.id] = 'manager';
          expectedMembers[contexts.simon.user.id] = 'viewer';
          testSharing(
            contentObj,
            contexts.nicolaas,
            contexts.simon,
            true,
            true,
            false,
            true,
            expectedMembers,
            true,
            () => {
              // Share as content member
              expectedMembers[contexts.anthony.user.id] = 'viewer';
              testSharing(
                contentObj,
                contexts.simon,
                contexts.anthony,
                true,
                true,
                false,
                true,
                expectedMembers,
                true,
                () => {
                  // Share as other user, add to own library
                  expectedMembers[contexts.stuart.user.id] = 'viewer';
                  testSharing(
                    contentObj,
                    contexts.anthony,
                    contexts.stuart,
                    true,
                    true,
                    false,
                    true,
                    expectedMembers,
                    true,
                    () => {
                      // Share with the content manager, making sure that he's still the content manager after sharing
                      testSharing(
                        contentObj,
                        contexts.stuart,
                        contexts.nicolaas,
                        true,
                        true,
                        true,
                        true,
                        expectedMembers,
                        true,
                        () => {
                          // Share as anonymous
                          testSharing(
                            contentObj,
                            { restContext: anonymousRestContext },
                            contexts.ian,
                            false,
                            true,
                            false,
                            false,
                            expectedMembers,
                            true,
                            callback
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

    /**
     * Test that will attempt to create a loggedin piece of content, share it as the manager, share it as a member, share it
     * as a non-related user and share it as an anonymous user. For each of those, it will check for content access, library
     * presence and the correct content membership list
     */
    it('verify logged in sharing', callback => {
      setUpUsers(contexts => {
        // Create a loggedin content item
        prepareSharing(contexts, LOGGEDIN, contentObj => {
          // Share as content owner
          const expectedMembers = {};
          expectedMembers[contexts.nicolaas.user.id] = 'manager';
          expectedMembers[contexts.simon.user.id] = 'viewer';
          testSharing(
            contentObj,
            contexts.nicolaas,
            contexts.simon,
            true,
            true,
            false,
            true,
            expectedMembers,
            true,
            () => {
              // Share as content member
              expectedMembers[contexts.anthony.user.id] = 'viewer';
              testSharing(
                contentObj,
                contexts.simon,
                contexts.anthony,
                true,
                true,
                false,
                true,
                expectedMembers,
                true,
                () => {
                  // Share as other user, add to own library
                  expectedMembers[contexts.stuart.user.id] = 'viewer';
                  testSharing(
                    contentObj,
                    contexts.stuart,
                    contexts.stuart,
                    true,
                    true,
                    false,
                    true,
                    expectedMembers,
                    true,
                    () => {
                      // Share with the content manager, making sure that he's still the content manager after sharing
                      testSharing(
                        contentObj,
                        contexts.stuart,
                        contexts.nicolaas,
                        true,
                        true,
                        true,
                        true,
                        expectedMembers,
                        true,
                        () => {
                          // Share as anonymous
                          testSharing(
                            contentObj,
                            { restContext: anonymousRestContext },
                            contexts.ian,
                            false,
                            true,
                            false,
                            false,
                            expectedMembers,
                            true,
                            callback
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

    /**
     * Test that will attempt to create a private piece of content, share it as the manager, share it as a member, share it
     * as a non-related user and share it as an anonymous user. For each of those, it will check for content access, library
     * presence and the correct content membership list
     */
    it('verify private sharing', callback => {
      setUpUsers(contexts => {
        // Create a private content item
        prepareSharing(contexts, PRIVATE, contentObj => {
          // Share as content owner
          const expectedMembers = {};
          expectedMembers[contexts.nicolaas.user.id] = 'manager';
          expectedMembers[contexts.simon.user.id] = 'viewer';
          testSharing(
            contentObj,
            contexts.nicolaas,
            contexts.simon,
            true,
            true,
            false,
            true,
            expectedMembers,
            false,
            () => {
              // Share as content member
              testSharing(contentObj, contexts.simon, contexts.anthony, false, false, false, false, null, false, () => {
                // Share as other user, add to own library
                testSharing(
                  contentObj,
                  contexts.stuart,
                  contexts.stuart,
                  false,
                  false,
                  false,
                  false,
                  null,
                  false,
                  () => {
                    // Share with the content manager, making sure that he's still the content manager after sharing
                    testSharing(
                      contentObj,
                      contexts.simon,
                      contexts.nicolaas,
                      false,
                      true,
                      true,
                      true,
                      expectedMembers,
                      true,
                      () => {
                        // Share as anonymous
                        testSharing(
                          contentObj,
                          { restContext: anonymousRestContext },
                          contexts.ian,
                          false,
                          false,
                          false,
                          false,
                          null,
                          false,
                          callback
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
    });

    /**
     * Test that will attempt to use the shareContent function with multiple people and/or groups at the same time. Invalid
     * principal ids will be added in as well.
     */
    it('verify multiple sharing', callback => {
      setUpUsers(contexts => {
        // Create a piece of content
        prepareSharing(contexts, PRIVATE, contentObj => {
          // Share with multiple people at the same time
          let toShare = [contexts.simon.user.id, contexts.ian.user.id, contexts.stuart.user.id];
          RestAPI.Content.shareContent(contexts.nicolaas.restContext, contentObj.id, toShare, err => {
            assert.ok(!err);

            // Check that these people have access
            checkPieceOfContent(
              contexts.simon.restContext,
              contexts.simon.user.id,
              contentObj,
              true,
              false,
              true,
              false,
              () => {
                checkPieceOfContent(
                  contexts.ian.restContext,
                  contexts.ian.user.id,
                  contentObj,
                  true,
                  false,
                  true,
                  false,
                  () => {
                    checkPieceOfContent(
                      contexts.stuart.restContext,
                      contexts.stuart.user.id,
                      contentObj,
                      true,
                      false,
                      true,
                      false,
                      () => {
                        checkPieceOfContent(
                          contexts.anthony.restContext,
                          contexts.anthony.user.id,
                          contentObj,
                          false,
                          false,
                          false,
                          false,
                          () => {
                            // Share with multiple people, of which some are invalid users
                            toShare = [contexts.anthony.user.id, 'u:cam:nonExistingUser'];
                            RestAPI.Content.shareContent(contexts.nicolaas.restContext, contentObj.id, toShare, err => {
                              assert.ok(err);
                              checkPieceOfContent(
                                contexts.anthony.restContext,
                                contexts.anthony.user.id,
                                contentObj,
                                false,
                                false,
                                false,
                                false,
                                callback
                              );
                            });
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
    });

    /**
     * Test that verifies sharing a content item results in a user being added to the content
     * members library both on-the-fly and when the library is rebuilt from scratch
     */
    it('verify sharing adds users to content members library', callback => {
      // Create users to test with
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users) => {
        users = _.values(users);
        const actor = users[0];
        const memberIds = _.chain(users)
          .pluck('user')
          .pluck('id')
          .value()
          .slice(1);

        // Create a content item to share
        RestAPI.Content.createLink(
          actor.restContext,
          'Test Content 1',
          'Test content description 1',
          PRIVATE,
          'http://www.oaeproject.org/',
          [],
          [],
          [],
          (err, link) => {
            assert.ok(!err);

            // Ensure sharing the content item is successful
            return ContentTestUtil.assertShareContentSucceeds(
              actor.restContext,
              actor.restContext,
              link.id,
              memberIds,
              callback
            );
          }
        );
      });
    });
  });

  describe('Group related content access', () => {
    /**
     * Utility function for the for group-related content access. The following situation is assumed:
     * 1) UI Dev Group has 2 members, Bert is a manager, Nicolaas is a member
     * 2) Back-end Dev Group has 2 members, Branden is a manager, Simon is a member
     * 3) OAE Team Group has 4 members, Anthony is a manager, Stuart is a member
     *    UI Dev Group is a member and Back-end Dev Group is a member
     *
     * The following steps will be taken:
     * 1) A content item is created with the specified visibility
     * 2) Permissions are set on the content
     *  2.1) The UI Dev Group is made a viewer
     *  2.2) Simon is made a viewer
     *  2.3) We check that the content is part of the UI Dev Group's library
     *  2.4) We verify that Simon has access to content
     *  2.5) We verify that Bert and Nico have access to the content through the UI Dev Group membership
     *  2.6) We verify that the content doesn't show in the library of OAE Team and the Back-end team
     *  2.7) We verify that Stuart and Branden don't have access to the content
     * 3) The content is shared with the OAE Team Group
     *  3.1) We verify that Stuart and Branden now have access to the content
     *  3.2) We verify that the content shows in OAE Team and UI Dev team's library and not in the Back-end Team's library
     * 4) The Back-end Team Group is made a manager of the content
     *  4.1) We verify that Simon and Branden are now a manager
     *  4.2) We verify that Stuart is not a manager
     * 5) The permissions for OAE Team Group and Back-end Team Group are removed from the content
     *  5.1) We verify that Branden no longer has access to the content
     *  5.2) We verify that Simon and Nicolaas still have access to the content
     * @param  {Array<Context>}     contexts            Array of context objects that represent a request cycle and contain
     *                                                  the current user and the current tenant
     * @param  {Array<Group>}       groups              Array of group objects that will be used as part of this test
     * @param  {User}               privacy             Privacy setting for the piece of content. Can be public, loggedin or private
     * @param  {Function}           callback            Standard callback function
     */
    const testGroupAccess = function(contexts, groups, privacy, callback) {
      // Anthony creates a content item
      RestAPI.Content.createLink(
        contexts.anthony.restContext,
        'Test Content 1',
        'Test content description 1',
        privacy,
        'http://www.oaeproject.org/',
        [],
        [],
        [],
        (err, contentObj) => {
          assert.ok(!err);
          assert.ok(contentObj.id);

          // Set permissions on content --> Make UI dev team member, make Simon a member
          let permissions = {};
          permissions[groups['ui-team'].id] = 'viewer';
          permissions[contexts.simon.user.id] = 'viewer';
          RestAPI.Content.updateMembers(contexts.anthony.restContext, contentObj.id, permissions, err => {
            assert.ok(!err);
            // Check that UI Dev Team, Bert, Nico and Simon have member access
            checkPieceOfContent(
              contexts.bert.restContext,
              groups['ui-team'].id,
              contentObj,
              true,
              false,
              true,
              privacy !== PRIVATE,
              () => {
                checkPieceOfContent(
                  contexts.nicolaas.restContext,
                  contexts.nicolaas.user.id,
                  contentObj,
                  true,
                  false,
                  false,
                  privacy !== PRIVATE,
                  () => {
                    checkPieceOfContent(
                      contexts.bert.restContext,
                      contexts.bert.user.id,
                      contentObj,
                      true,
                      false,
                      false,
                      privacy !== PRIVATE,
                      () => {
                        // Check that it shows in UI Dev Team's library
                        RestAPI.Content.getLibrary(
                          contexts.nicolaas.restContext,
                          groups['ui-team'].id,
                          null,
                          10,
                          (err, contentItems) => {
                            assert.ok(!err);
                            assert.strictEqual(contentItems.results.length, 1);
                            assert.strictEqual(contentItems.results[0].id, contentObj.id);
                            // Check that it shows in Simon's library
                            RestAPI.Content.getLibrary(
                              contexts.simon.restContext,
                              contexts.simon.user.id,
                              null,
                              10,
                              (err, contentItems) => {
                                assert.ok(!err);
                                assert.strictEqual(contentItems.results.length, 1);
                                assert.strictEqual(contentItems.results[0].id, contentObj.id);
                                // Check that it doesn't show in Nico's library
                                RestAPI.Content.getLibrary(
                                  contexts.nicolaas.restContext,
                                  contexts.nicolaas.user.id,
                                  null,
                                  10,
                                  (err, contentItems) => {
                                    assert.ok(!err);
                                    assert.strictEqual(contentItems.results.length, 0);
                                    // Check that it doesn't show in Bert's library
                                    RestAPI.Content.getLibrary(
                                      contexts.bert.restContext,
                                      contexts.bert.user.id,
                                      null,
                                      10,
                                      (err, contentItems) => {
                                        assert.ok(!err);
                                        assert.strictEqual(contentItems.results.length, 0);
                                        // Check that it doesn't show in OAE Team's and Back-end team's library
                                        RestAPI.Content.getLibrary(
                                          contexts.anthony.restContext,
                                          groups['backend-team'].id,
                                          null,
                                          10,
                                          (err, contentItems) => {
                                            assert.ok(!err);
                                            assert.strictEqual(contentItems.results.length, 0);
                                            RestAPI.Content.getLibrary(
                                              contexts.anthony.restContext,
                                              groups['oae-team'].id,
                                              null,
                                              10,
                                              (err, contentItems) => {
                                                assert.ok(!err);
                                                assert.strictEqual(contentItems.results.length, 0);
                                                // Check that Stuart doesn't have access
                                                checkPieceOfContent(
                                                  contexts.stuart.restContext,
                                                  contexts.stuart.user.id,
                                                  contentObj,
                                                  privacy !== PRIVATE,
                                                  false,
                                                  false,
                                                  privacy !== PRIVATE,
                                                  () => {
                                                    // Check that Branden doesn't have access
                                                    checkPieceOfContent(
                                                      contexts.branden.restContext,
                                                      contexts.branden.user.id,
                                                      contentObj,
                                                      privacy !== PRIVATE,
                                                      false,
                                                      false,
                                                      privacy !== PRIVATE,
                                                      () => {
                                                        // Share with the OAE Team group
                                                        RestAPI.Content.shareContent(
                                                          contexts.anthony.restContext,
                                                          contentObj.id,
                                                          [groups['oae-team'].id],
                                                          err => {
                                                            // Check that Stuart has access
                                                            checkPieceOfContent(
                                                              contexts.stuart.restContext,
                                                              contexts.stuart.user.id,
                                                              contentObj,
                                                              true,
                                                              false,
                                                              false,
                                                              privacy !== PRIVATE,
                                                              () => {
                                                                // Check that Branden has access
                                                                checkPieceOfContent(
                                                                  contexts.branden.restContext,
                                                                  contexts.branden.user.id,
                                                                  contentObj,
                                                                  true,
                                                                  false,
                                                                  false,
                                                                  privacy !== PRIVATE,
                                                                  () => {
                                                                    // Check that it shows in OAE Team and UI Dev team's library and not in the Back-End Team's library
                                                                    RestAPI.Content.getLibrary(
                                                                      contexts.anthony.restContext,
                                                                      groups['oae-team'].id,
                                                                      null,
                                                                      10,
                                                                      (err, contentItems) => {
                                                                        assert.ok(!err);
                                                                        assert.strictEqual(
                                                                          contentItems.results.length,
                                                                          1
                                                                        );
                                                                        assert.strictEqual(
                                                                          contentItems.results[0].id,
                                                                          contentObj.id
                                                                        );
                                                                        RestAPI.Content.getLibrary(
                                                                          contexts.nicolaas.restContext,
                                                                          groups['ui-team'].id,
                                                                          null,
                                                                          10,
                                                                          (err, contentItems) => {
                                                                            assert.ok(!err);
                                                                            assert.strictEqual(
                                                                              contentItems.results.length,
                                                                              1
                                                                            );
                                                                            assert.strictEqual(
                                                                              contentItems.results[0].id,
                                                                              contentObj.id
                                                                            );
                                                                            RestAPI.Content.getLibrary(
                                                                              contexts.simon.restContext,
                                                                              groups['backend-team'].id,
                                                                              null,
                                                                              10,
                                                                              (err, contentItems) => {
                                                                                assert.ok(!err);
                                                                                assert.strictEqual(
                                                                                  contentItems.results.length,
                                                                                  0
                                                                                );

                                                                                // Make Back-end team manager
                                                                                permissions = {};
                                                                                permissions[groups['backend-team'].id] =
                                                                                  'manager';
                                                                                RestAPI.Content.updateMembers(
                                                                                  contexts.anthony.restContext,
                                                                                  contentObj.id,
                                                                                  permissions,
                                                                                  err => {
                                                                                    assert.ok(!err);
                                                                                    // Check that Simon and Branden are manager, check that Stuart is not a manager
                                                                                    checkPieceOfContent(
                                                                                      contexts.simon.restContext,
                                                                                      contexts.simon.user.id,
                                                                                      contentObj,
                                                                                      true,
                                                                                      true,
                                                                                      true,
                                                                                      true,
                                                                                      () => {
                                                                                        checkPieceOfContent(
                                                                                          contexts.branden.restContext,
                                                                                          contexts.branden.user.id,
                                                                                          contentObj,
                                                                                          true,
                                                                                          true,
                                                                                          false,
                                                                                          true,
                                                                                          () => {
                                                                                            checkPieceOfContent(
                                                                                              contexts.stuart
                                                                                                .restContext,
                                                                                              contexts.stuart.user.id,
                                                                                              contentObj,
                                                                                              true,
                                                                                              false,
                                                                                              false,
                                                                                              privacy !== PRIVATE,
                                                                                              () => {
                                                                                                // Remove permission for Back-end team manager and OAE Team
                                                                                                permissions = {};
                                                                                                permissions[
                                                                                                  groups[
                                                                                                    'backend-team'
                                                                                                  ].id
                                                                                                ] = false;
                                                                                                permissions[
                                                                                                  groups['oae-team'].id
                                                                                                ] = false;
                                                                                                RestAPI.Content.updateMembers(
                                                                                                  contexts.anthony
                                                                                                    .restContext,
                                                                                                  contentObj.id,
                                                                                                  permissions,
                                                                                                  err => {
                                                                                                    assert.ok(!err);
                                                                                                    // Check that Branden no longer has access, but Simon and Nico still do
                                                                                                    checkPieceOfContent(
                                                                                                      contexts.nicolaas
                                                                                                        .restContext,
                                                                                                      contexts.nicolaas
                                                                                                        .user.id,
                                                                                                      contentObj,
                                                                                                      true,
                                                                                                      false,
                                                                                                      false,
                                                                                                      privacy !==
                                                                                                        PRIVATE,
                                                                                                      () => {
                                                                                                        checkPieceOfContent(
                                                                                                          contexts.simon
                                                                                                            .restContext,
                                                                                                          contexts.simon
                                                                                                            .user.id,
                                                                                                          contentObj,
                                                                                                          true,
                                                                                                          false,
                                                                                                          true,
                                                                                                          privacy !==
                                                                                                            PRIVATE,
                                                                                                          () => {
                                                                                                            checkPieceOfContent(
                                                                                                              contexts
                                                                                                                .branden
                                                                                                                .restContext,
                                                                                                              contexts
                                                                                                                .branden
                                                                                                                .user
                                                                                                                .id,
                                                                                                              contentObj,
                                                                                                              privacy !==
                                                                                                                PRIVATE,
                                                                                                              false,
                                                                                                              false,
                                                                                                              privacy !==
                                                                                                                PRIVATE,
                                                                                                              callback
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
    };

    /**
     * Test that will verify group-related access for public content
     */
    it('verify public content group access', callback => {
      setUpUsers(contexts => {
        setUpGroups(contexts, groups => {
          testGroupAccess(contexts, groups, PUBLIC, callback);
        });
      });
    });

    /**
     * Test that will verify group-related access for logged in content
     */
    it('verify logged in content group access', callback => {
      setUpUsers(contexts => {
        setUpGroups(contexts, groups => {
          testGroupAccess(contexts, groups, LOGGEDIN, callback);
        });
      });
    });

    /**
     * Test that will verify group-related access for private content
     */
    it('verify private content group access', callback => {
      setUpUsers(contexts => {
        setUpGroups(contexts, groups => {
          testGroupAccess(contexts, groups, PRIVATE, callback);
        });
      });
    });
  });
});
