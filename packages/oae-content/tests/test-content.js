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

import { assert } from 'chai';
import fs from 'fs';
import path from 'path';
import { format } from 'util';
import temp from 'temp';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import * as AuthzAPI from 'oae-authz';
import * as AuthzTestUtil from 'oae-authz/lib/test/util.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import { Context } from 'oae-context';
import PreviewConstants from 'oae-preview-processor/lib/constants.js';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as RestUtil from 'oae-rest/lib/util.js';
import * as TenantsAPI from 'oae-tenants/lib/api.js';
import * as MQ from 'oae-util/lib/mq.js';
import * as TestsUtil from 'oae-tests';
import * as ContentAPI from 'oae-content';
import * as ContentTestUtil from 'oae-content/lib/test/util.js';
import * as ContentUtil from 'oae-content/lib/internal/util.js';
import {
  filter,
  omit,
  map,
  find,
  path as getPath,
  not,
  compose,
  equals,
  assoc,
  values,
  forEach,
  prop,
  nth,
  length,
  keys,
  fromPairs,
  mergeAll
} from 'ramda';

const {
  createTenantRestContext,
  generateRandomText,
  createTenantAdminRestContext,
  createGlobalAdminRestContext,
  generateTestUserId,
  generateTestEmailAddress,
  generateTestUsers,
  objectifySearchParams
} = TestsUtil;

const {
  assertUpdateContentMembersFails,
  assertGetContentMembersFails,
  assertGetContentMembersSucceeds,
  assertShareContentSucceeds,
  assertCreateLinkSucceeds,
  assertUpdateContentMembersSucceeds,
  getAllContentMembers,
  assertGetAllContentLibrarySucceeds
} = ContentTestUtil;
const { assertVerifyEmailSucceeds, assertUpdateUserSucceeds } = PrincipalsTestUtil;
const { performRestRequest } = RestUtil;
const { getSignedDownloadUrl } = ContentUtil;
const { getTenant } = TenantsAPI;
const { getMe, createUser, updateUser, uploadPicture } = RestAPI.User;
const { getAllRoles } = AuthzAPI;
const { createRoleChange, assertGetInvitationsSucceeds } = AuthzTestUtil;

const {
  getContent,
  createFile,
  getLibrary,
  deleteComment,
  createCollabDoc,
  createCollabsheet,
  updateMembers,
  download,
  shareContent,
  updateContent,
  getComments,
  updateFileBody,
  getRevisions,
  getRevision,
  restoreRevision,
  createComment,
  deleteContent,
  createLink
} = RestAPI.Content;
const { createGroup } = RestAPI.Group;
const { unsubscribe, subscribe } = MQ;

const NO_MANAGERS = [];
const NO_EDITORS = [];
const NO_FOLDERS = [];
const NO_VIEWERS = [];
const NO_MEMBERS = [];
const PUBLIC = 'public';
const PRIVATE = 'private';
const LOGGEDIN = 'loggedin';
const PASSWORD = 'password';
const JOINABLE = 'yes';
const CONTENT = 'content';
const VIEWER = 'viewer';
const MANAGER = 'manager';

const OAE_TEAM = 'oae-team';
const UI_TEAM = 'ui-team';
const BACKEND_TEAM = 'backend-team';

describe('Content', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let asCambridgeAnonymousUser = null;
  // Rest contexts that can be used every time we need to make a request as a tenant admin

  let asCambridgeTenantAdmin = null;
  // Rest context that can be used every time we need to make a request as a global admin

  let asGlobalAdmin = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before((callback) => {
    // Fill up anonymous rest context
    asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.cam.host);

    // Fill up tenant admin rest contexts
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // Fill up global admin rest context
    asGlobalAdmin = createGlobalAdminRestContext();

    /**
     * Log in the tenant admin so his cookie jar is set up appropriately. This is because generateTestUsers
     * will concurrently try and create users, which causes race conditions when trying to authenticate the rest
     * context.
     */
    getMe(asCambridgeTenantAdmin, (error /* , me */) => {
      assert.notExists(error);

      // Unbind the current handler, if any
      unsubscribe(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, (error_) => {
        assert.notExists(error_);

        /*!
         * Task handler that will just drain the queue.
         *
         * @see MQ#bind
         */
        const _handleTaskDrain = (data, mqCallback) => {
          // Simply callback, which acknowledges the message without doing anything.
          mqCallback();
        };

        // Drain the queue
        subscribe(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, _handleTaskDrain, (error_) => {
          assert.notExists(error_);
          callback();
        });
      });
    });
  });

  /**
   * Function that will clean up any files that we have lingering around.
   */
  after((done) => {
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
  const setUpUsers = function (callback) {
    const contexts = {};

    const _createUser = function (identifier, visibility, displayName) {
      const userId = generateTestUserId(identifier);
      const email = generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);

      createUser(asCambridgeTenantAdmin, userId, PASSWORD, displayName, email, { visibility }, (error, createdUser) => {
        if (error) {
          assert.fail('Could not create test user');
        }

        contexts[identifier] = {
          user: createdUser,
          restContext: createTenantRestContext(global.oaeTests.tenants.cam.host, userId, PASSWORD)
        };

        const allSet = compose(equals(7), length, keys)(contexts);
        if (allSet) {
          callback(contexts);
        }
      });
    };

    _createUser('nicolaas', PUBLIC, 'Nicolaas Matthijs');
    _createUser('simon', LOGGEDIN, 'Simon Gaeremynck');
    _createUser('bert', PRIVATE, 'Bert Pareyn');
    _createUser('branden', PRIVATE, 'Branden Visser');
    _createUser('anthony', PUBLIC, 'Anthony Whyte');
    _createUser('stuart', PUBLIC, 'Stuart Freeman');
    _createUser('ian', PUBLIC, 'Ian Dolphin');
  };

  /**
   * Create a number of groups that will be used inside of a test
   *
   * @param  {Array<Context>}      contexts           Array of contexts that represent the users that will be used in the test
   * @param  {Function(groups)}    callback           Standard callback function
   * @param  {Object}              callback.groups    JSON Object where the keys are the group identifiers and the values are the
   *                                                  actual group object
   */
  const setUpGroups = (contexts, callback) => {
    const asBert = contexts.bert.restContext;
    const asBranden = contexts.branden.restContext;
    const asAnthony = contexts.anthony.restContext;
    const { simon, nicolaas, stuart } = contexts;

    // Create UI Dev Group and make Bert a member
    createGroup(
      asBert,
      'UI Dev Team',
      'UI Dev Group',
      PUBLIC,
      JOINABLE,
      NO_MANAGERS,
      [nicolaas.user.id],
      (error, designTeam) => {
        assert.notExists(error);

        // Create Back-end Dev Group and make Simon a member
        createGroup(
          asBranden,
          'Back-end Dev Team',
          'Back-end Dev Group',
          PUBLIC,
          JOINABLE,
          NO_MANAGERS,
          [simon.user.id],
          (error, backendTeam) => {
            assert.notExists(error);

            // Create OAE Team Group and make Stuart, UI Dev Group and Back-end Dev Group all members
            createGroup(
              asAnthony,
              'OAE Team',
              'OAE Team Group',
              PUBLIC,
              JOINABLE,
              NO_MANAGERS,
              [designTeam.id, backendTeam.id, stuart.user.id],
              (error, projectTeam) => {
                assert.notExists(error);

                const addProjectTeam = assoc(OAE_TEAM, projectTeam);
                const addDesignTeam = assoc(UI_TEAM, designTeam);
                const addBackendTeam = assoc(BACKEND_TEAM, backendTeam);
                const groups = compose(addProjectTeam, addDesignTeam, addBackendTeam)({});

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
  const checkPieceOfContent = function (
    restCtx,
    libraryToCheck,
    contentObject,
    expectAccess,
    expectManager,
    expectInLibrary,
    expectCanShare,
    callback
  ) {
    // Check whether the content can be retrieved
    getContent(restCtx, contentObject.id, (error, retrievedContent) => {
      if (expectAccess) {
        assert.notExists(error);
        assert.ok(retrievedContent.id);
        assert.isObject(contentObject.tenant);
        assert.lengthOf(keys(retrievedContent.tenant), 3);
        assert.strictEqual(retrievedContent.tenant.alias, contentObject.tenant.alias);
        assert.strictEqual(retrievedContent.tenant.displayName, contentObject.tenant.displayName);
        assert.strictEqual(retrievedContent.visibility, contentObject.visibility);
        assert.strictEqual(retrievedContent.displayName, contentObject.displayName);
        assert.strictEqual(retrievedContent.description, contentObject.description);
        assert.strictEqual(retrievedContent.resourceSubType, contentObject.resourceSubType);
        assert.strictEqual(retrievedContent.createdBy.id, contentObject.createdBy);
        assert.strictEqual(retrievedContent.created, contentObject.created);
        assert.ok(retrievedContent.lastModified);
        assert.strictEqual(retrievedContent.resourceType, CONTENT);
        assert.strictEqual(
          retrievedContent.profilePath,
          `/content/${contentObject.tenant.alias}/${AuthzUtil.getResourceFromId(contentObject.id).resourceId}`
        );
        // Check if the canManage check is appropriate
        assert.strictEqual(retrievedContent.isManager, expectManager);
        assert.strictEqual(retrievedContent.canShare, expectCanShare);
      } else {
        assert.exists(error);
        assert.isNotOk(retrievedContent);
      }

      // Check if the item comes back in the library
      getLibrary(restCtx, libraryToCheck, null, 10, (error, contentItems) => {
        // If no logged in user is provided, we expect an error
        if (libraryToCheck) {
          assert.notExists(error);
          if (expectInLibrary) {
            assert.lengthOf(contentItems.results, 1);
            assert.strictEqual(contentItems.results[0].id, contentObject.id);
          } else {
            assert.lengthOf(contentItems.results, 0);
          }
        } else {
          assert.exists(error);
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
  const getFileStream = () => fs.createReadStream(path.join(__dirname, '/data/oae-video.png'));

  /**
   * Utility method that returns a stream that points to the OAE logo.
   *
   * @return {Stream}     A stream that points to the OAE logo that can be uploaded.
   */
  const getOAELogoStream = () => fs.createReadStream(path.join(__dirname, '/data/oae-logo.png'));

  describe('Get content', () => {
    /**
     * Test that will create a piece of content and try to get it in an invalid
     * and valid way
     */
    it('verify get content', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas } = contexts;
        const asNico = nicolaas.restContext;

        // Create a piece of content
        createLink(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.exists(contentObject);

            // Try with a missing ID (send a space as otherwise it won't even hit the endpoint)
            getContent(asNico, ' ', (error, retrievedContentObject) => {
              assert.strictEqual(error.code, 400);
              assert.isNotOk(retrievedContentObject);

              // Try with an invalid ID.
              getContent(asNico, 'invalid-id', (error, retrievedContentObject) => {
                assert.strictEqual(error.code, 400);
                assert.isNotOk(retrievedContentObject);

                // Get the created piece of content
                getContent(asNico, contentObject.id, (error, retrievedContentObject) => {
                  assert.notExists(error);
                  assert.strictEqual(retrievedContentObject.id, contentObject.id);

                  // Call the ContentAPI directly to trigger some validation errors
                  ContentAPI.getContent(null, null, (error_) => {
                    assert.strictEqual(error_.code, 400);

                    ContentAPI.getContent(null, 'invalid-id', (error_) => {
                      assert.strictEqual(error_.code, 400);
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
    /**
     * In order to test download URL expiry, sometimes we overload
     * `Date.now`. This method ensures after each test it gets reset
     * to the proper function
     */
    const originalDateNow = Date.now;
    afterEach((callback) => {
      Date.now = originalDateNow;
      return callback();
    });

    /**
     * Test that will create a piece of content and try to download it in an invalid
     * and valid way.
     */
    it('verify download content', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, simon } = contexts;
        const asNico = nicolaas.restContext;
        const asSimon = simon.restContext;

        // Create a piece of content
        createFile(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PRIVATE,
            file: getFileStream,
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.exists(contentObject);

            // Verify that the download link gets added to a content object.
            getContent(asNico, contentObject.id, (error, contentObject) => {
              assert.notExists(error);
              assert.strictEqual(
                contentObject.downloadPath,
                `/api/content/${contentObject.id}/download/${contentObject.latestRevisionId}`
              );

              /**
               * Download it
               * The App servers don't really stream anything
               * In the tests we're using local storage, so this should result in a 204 (empty body) with the link in the x-accel-redirect header
               */
              let path = temp.path();
              download(asNico, contentObject.id, null, path, (error, response) => {
                assert.notExists(error);

                const headerKeys = keys(response.headers);
                assert.exists(headerKeys.includes('x-accel-redirect'));
                assert.exists(headerKeys.includes('x-sendfile'));
                assert.exists(headerKeys.includes('x-lighttpd-send-file'));

                // Try downloading it as Simon
                download(asSimon, contentObject.id, null, path, (error /* , body */) => {
                  assert.strictEqual(error.code, 401);

                  // Share it.
                  shareContent(asNico, contentObject.id, [contexts.simon.user.id], (error_) => {
                    assert.notExists(error_);

                    // Simon should now be able to fetch it
                    path = temp.path();
                    download(asSimon, contentObject.id, null, path, (error, response) => {
                      assert.notExists(error);

                      const headerKeys = keys(response.headers);
                      assert.exists(headerKeys.includes('x-accel-redirect'));
                      assert.exists(headerKeys.includes('x-sendfile'));
                      assert.exists(headerKeys.includes('x-lighttpd-send-file'));

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
     * Test that will create different versions piece of content and try to download it in an invalid
     * and valid way.
     */
    it('verify versioned download content', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas } = contexts;
        const asNico = nicolaas.restContext;

        // Create a piece of content
        createFile(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PRIVATE,
            file: getFileStream,
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.exists(contentObject);

            // Create a new version
            updateFileBody(asNico, contentObject.id, getOAELogoStream, (error_) => {
              assert.notExists(error_);

              getRevisions(asNico, contentObject.id, null, null, (error, revisions) => {
                assert.notExists(error);
                assert.lengthOf(revisions.results, 2);

                // Download the latest version
                let path = temp.path();
                download(asNico, contentObject.id, null, path, (error, response) => {
                  assert.notExists(error);

                  assert.strictEqual(response.statusCode, 204);
                  const url = response.headers['x-accel-redirect'];

                  // Download the oldest version
                  path = temp.path();
                  download(asNico, contentObject.id, revisions.results[1].revisionId, path, (error, response) => {
                    assert.notExists(error);

                    assert.strictEqual(response.statusCode, 204);
                    const oldUrl = response.headers['x-accel-redirect'];
                    assert.notStrictEqual(url, oldUrl);
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
     * Simple test that verifies the uri does not contain any invalid characters
     */
    it('verify uri contains no invalid characters', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas } = contexts;
        const asNico = nicolaas.restContext;

        // Create a piece of content
        createFile(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PRIVATE,
            file: getFileStream,
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.exists(contentObject);

            getRevisions(asNico, contentObject.id, null, null, (error, revisions) => {
              assert.notExists(error);
              assert.lengthOf(revisions.results, 1);

              /**
               * The uri that sits on the revision looks like:
               * local:c/camtest/eJ/kG/Lh/-z/eJkGLh-z/rev-camtest-eygkzIhWz/oae-video.png
               * We only need to test the part after the (first colon)
               */
              const uri = revisions.results[0].uri.split(':').slice(1).join(':');
              assert.isNotOk(/[^-\w/.]/.test(uri));
              callback();
            });
          }
        );
      });
    });

    /*
     * Test that will verify the validation of signed urls.
     */
    it('verify validation of signed urls', (callback) => {
      setUpUsers((contexts) => {
        const { simon, branden } = contexts;
        const asBranden = branden.restContext;
        const asSimon = simon.restContext;

        // Generate a signed download url for Branden
        const tenant = getTenant(contexts.branden.user.tenant.alias);
        const signedDownloadUrl = getSignedDownloadUrl(
          new Context(tenant, contexts.branden.user),
          'local:2012/12/06/file.doc'
        );
        const parsedUrl = new URL(signedDownloadUrl, 'http://localhost');

        // Branden should be able to download it because he is super awesome and important (In this case, downloading = 204)
        performRestRequest(
          asBranden,
          '/api/download/signed',
          'GET',
          objectifySearchParams(parsedUrl.searchParams),
          (error, body, response) => {
            assert.notExists(error);
            assert.strictEqual(response.statusCode, 204);

            // Simon should be able to download the content item using the same signature
            performRestRequest(
              asSimon,
              '/api/download/signed',
              'GET',
              TestsUtil.objectifySearchParams(parsedUrl.searchParams),
              (error /* , body, response */) => {
                assert.notExists(error);

                // Global admin should be able to download the content item using the same signature
                performRestRequest(
                  asGlobalAdmin,
                  '/api/download/signed',
                  'GET',
                  objectifySearchParams(parsedUrl.searchParams),
                  (error /* , body, response */) => {
                    assert.notExists(error);

                    // An anonymous user can download it using the same signature as well
                    performRestRequest(
                      asCambridgeAnonymousUser,
                      '/api/download/signed',
                      'GET',
                      objectifySearchParams(parsedUrl.searchParams),
                      (error /* , body, response */) => {
                        assert.notExists(error);

                        // Missing uri
                        performRestRequest(
                          asBranden,
                          '/api/download/signed',
                          'GET',
                          omit(['uri'], objectifySearchParams(parsedUrl.searchParams)),
                          (error /* , body, request */) => {
                            assert.strictEqual(error.code, 401);

                            // Different uri has an invalid signature
                            performRestRequest(
                              asBranden,
                              '/api/download/signed',
                              'GET',
                              mergeAll([
                                objectifySearchParams(parsedUrl.searchParams),
                                {
                                  uri: 'blahblahblah'
                                }
                              ]),
                              (error /* , body, request */) => {
                                assert.strictEqual(error.code, 401);

                                // Missing signature parameter
                                performRestRequest(
                                  asBranden,
                                  '/api/download/signed',
                                  'GET',
                                  omit(['signature'], objectifySearchParams(parsedUrl.searchParams)),
                                  (error /* , body, request */) => {
                                    assert.strictEqual(error.code, 401);

                                    // Different signature should fail assertion
                                    performRestRequest(
                                      asBranden,
                                      '/api/download/signed',
                                      'GET',
                                      mergeAll([
                                        objectifySearchParams(parsedUrl.searchParams),
                                        {
                                          signature: 'ATTACK LOL!!'
                                        }
                                      ]),
                                      (error /* , body, request */) => {
                                        assert.strictEqual(error.code, 401);

                                        // Missing expires parameter
                                        performRestRequest(
                                          asBranden,
                                          '/api/download/signed',
                                          'GET',
                                          omit(['expires'], objectifySearchParams(parsedUrl.searchParams)),
                                          (error /* , body, request */) => {
                                            assert.strictEqual(error.code, 401);

                                            // Missing signature parameter
                                            performRestRequest(
                                              asBranden,
                                              '/api/download/signed',
                                              'GET',
                                              mergeAll([
                                                objectifySearchParams(parsedUrl.searchParams),
                                                {
                                                  expires: 2345678901
                                                }
                                              ]),
                                              (error /* , body, request */) => {
                                                assert.strictEqual(error.code, 401);

                                                // Jump into a time machine to see if the signature is valid in 15d. It should have expired
                                                const now = Date.now();
                                                Date.now = () => now + 15 * 24 * 60 * 60 * 1000;

                                                performRestRequest(
                                                  asBranden,
                                                  '/api/download/signed',
                                                  'GET',
                                                  objectifySearchParams(parsedUrl.searchParams),
                                                  (error /* , body, response * */) => {
                                                    assert.strictEqual(error.code, 401);
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
    const createComments = function (contexts, contentId, numberComments, replyTo, callback) {
      let done = 0;
      const contextValues = values(contexts);

      /**
       * Returns a random user REST Context from the contexts passed in to `createComments`
       * @return {RestContext}    REST Context object for a user
       */
      const asRandomCommenter = () => contextValues[Math.floor(Math.random() * length(contextValues))].restContext;

      /**
       * Verifies that the comment was created successfully and triggers the creation of another comment if necessary.
       * @param  {Object}   err   Error object indicating that the comment was successfully created or not.
       */
      const commentCreated = function (error, comment) {
        assert.notExists(error);
        assert.exists(comment);

        const enoughCommentsCreated = equals(done, numberComments);
        if (enoughCommentsCreated) {
          callback();
        } else {
          done++;
          _createComment();
        }
      };

      /**
       * Posts a comment on a specified contentId and uses a random commenter and comment
       */
      const _createComment = () =>
        createComment(asRandomCommenter(), contentId, format('Comment #%s', done), replyTo, commentCreated);

      done++;
      _createComment();
    };

    /**
     * Test that will create a comment on content
     */
    it('verify create comment', (callback) => {
      setUpUsers((contexts) => {
        const { bert } = contexts;
        const asBert = bert.restContext;

        // Create a piece of content
        createLink(
          asBert,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.exists(contentObject);

            // Get the created piece of content
            getContent(asBert, contentObject.id, (error, retrievedContentObject) => {
              assert.notExists(error);
              assert.strictEqual(retrievedContentObject.id, contentObject.id);

              // Create 10 comments
              createComments(contexts, contentObject.id, 10, null, () => {
                // Create one more and verify that it comes back as the first comment in the list
                createComment(
                  asBert,
                  contentObject.id,
                  'This comment should be on top of the list',
                  null,
                  (error, comment) => {
                    assert.notExists(error);
                    assert.strictEqual(comment.createdBy.publicAlias, 'Bert Pareyn');
                    assert.strictEqual(comment.level, 0);
                    assert.strictEqual(comment.body, 'This comment should be on top of the list');
                    assert.strictEqual(comment.messageBoxId, contentObject.id);
                    assert.strictEqual(comment.threadKey, comment.created + '|');
                    assert.ok(comment.id);
                    assert.ok(comment.created);

                    // Make sure there is NOT an error if "" is sent instead of undefined
                    createComment(
                      asBert,
                      contentObject.id,
                      'This comment should be on top of the list',
                      '',
                      (error, comment) => {
                        assert.notExists(error);

                        // Get the comments and verify that the item on top of the list is the correct one
                        getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                          assert.notExists(error);

                          assert.lengthOf(comments.results, 10);
                          assert.strictEqual(comments.results[0].createdBy.publicAlias, 'Bert Pareyn');
                          assert.strictEqual(comments.results[0].level, 0);
                          assert.strictEqual(comments.results[0].body, 'This comment should be on top of the list');
                          assert.strictEqual(comment.messageBoxId, contentObject.id);
                          assert.strictEqual(comment.threadKey, comment.created + '|');
                          assert.ok(comment.id);
                          assert.ok(comment.created);

                          callback();
                        });
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
    it('verify comments contain user profile pictures', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: bert, 1: nicolaas } = users;
        const asBert = bert.restContext;
        const asNico = nicolaas.restContext;

        /**
         * Return a profile picture stream
         *
         * @return {Stream}     A stream containing an profile picture
         */
        const getPictureStream = () => fs.createReadStream(path.join(__dirname, '/data/profilepic.jpg'));

        // Give one of the users a profile picture
        const cropArea = { x: 0, y: 0, width: 250, height: 250 };
        uploadPicture(asBert, bert.user.id, getPictureStream, cropArea, (error_) => {
          assert.notExists(error_);

          // Create a piece of content that we can comment on and share it with a user that has no profile picture
          createLink(
            asBert,
            {
              displayName: 'displayName',
              description: 'description',
              visibility: PUBLIC,
              link: 'http://www.oaeproject.org',
              managers: NO_MANAGERS,
              viewers: [nicolaas.user.id],
              folders: NO_FOLDERS
            },
            (error, contentObject) => {
              assert.notExists(error);

              // Add a comment to the piece of content as a user with a profile picture
              createComment(asBert, contentObject.id, 'Bleh', null, (error, comment) => {
                assert.notExists(error);

                // Assert that the picture URLs are present
                assert.ok(comment.createdBy);
                assert.ok(comment.createdBy.picture);
                assert.ok(comment.createdBy.picture.small);
                assert.ok(comment.createdBy.picture.medium);
                assert.ok(comment.createdBy.picture.large);

                // Assert that this works for replies as well
                createComment(asBert, contentObject.id, 'Blah', comment.created, (error, reply) => {
                  assert.notExists(error);

                  // Assert that the picture URLs are present
                  assert.ok(reply.createdBy);
                  assert.ok(reply.createdBy.picture);
                  assert.ok(reply.createdBy.picture.small);
                  assert.ok(reply.createdBy.picture.medium);
                  assert.ok(reply.createdBy.picture.large);

                  // Add a comment to the piece of content as a user with no profile picture
                  createComment(asNico, contentObject.id, 'Blih', null, (error, comment) => {
                    assert.notExists(error);

                    // Assert that no picture URLs are present
                    assert.ok(comment.createdBy);
                    assert.ok(comment.createdBy.picture);
                    assert.isNotOk(comment.createdBy.picture.small);
                    assert.isNotOk(comment.createdBy.picture.medium);
                    assert.isNotOk(comment.createdBy.picture.large);

                    // Assert that this works for replies as well
                    createComment(asNico, contentObject.id, 'Bluh', comment.created, (error, reply) => {
                      assert.notExists(error);

                      // Assert that no picture URLs are present
                      assert.ok(reply.createdBy);
                      assert.ok(reply.createdBy.picture);
                      assert.isNotOk(reply.createdBy.picture.small);
                      assert.isNotOk(reply.createdBy.picture.medium);
                      assert.isNotOk(reply.createdBy.picture.large);

                      // Assert the profile picture urls are present when retrieven a list of comments
                      getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                        assert.notExists(error);
                        assert.lengthOf(comments.results, 4);

                        forEach((comment) => {
                          assert.ok(comment.createdBy);
                          assert.ok(comment.createdBy.picture);

                          // Verify that the comments have a picture for the user that has a profile picture
                          const bertCommented = equals(comment.createdBy.id, bert.user.id);
                          const nicoCommented = equals(comment.createdBy.id, nicolaas.user.id);

                          if (bertCommented) {
                            assert.ok(comment.createdBy.picture.small);
                            assert.ok(comment.createdBy.picture.medium);
                            assert.ok(comment.createdBy.picture.large);
                            // Verify that the comments don't have a picture for the user without a profile picture
                          } else if (nicoCommented) {
                            assert.isNotOk(comment.createdBy.picture.small);
                            assert.isNotOk(comment.createdBy.picture.medium);
                            assert.isNotOk(comment.createdBy.picture.large);
                          } else {
                            assert.fail('Unexpected user in comments');
                          }
                        }, comments.results);

                        return callback();
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

    /**
     * Test that will create a reply to a comment on content (thread)
     */
    it('verify reply to comment (threaded)', (callback) => {
      const getLevel = (comments, x) => compose(prop('level'), nth(x), prop('results'))(comments);

      setUpUsers((contexts) => {
        const { bert } = contexts;
        const asBert = bert.restContext;

        // Create a piece of content
        createLink(
          asBert,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject);

            // Get the created piece of content
            getContent(asBert, contentObject.id, (error, retrievedContentObject) => {
              assert.notExists(error);
              assert.strictEqual(retrievedContentObject.id, contentObject.id);

              // Create a comment on the content item
              createComment(
                asBert,
                contentObject.id,
                'This comment should be second in the list',
                null,
                (error, comment0) => {
                  assert.notExists(error);
                  assert.ok(comment0);

                  const secondInListCreated = comment0.created;

                  // Get the comments to verify that it's been placed correctly
                  getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                    assert.notExists(error);
                    assert.lengthOf(comments.results, 1);

                    assert.strictEqual(comments.results[0].createdBy.publicAlias, 'Bert Pareyn');

                    // Add a reply to the comment
                    createComment(
                      asBert,
                      contentObject.id,
                      'Reply to second comment in the list',
                      comments.results[0].created,
                      (error, comment1) => {
                        assert.notExists(error);
                        assert.strictEqual(comment1.createdBy.publicAlias, 'Bert Pareyn');
                        assert.strictEqual(comment1.level, 1);
                        assert.strictEqual(comment1.body, 'Reply to second comment in the list');
                        assert.strictEqual(comment1.messageBoxId, contentObject.id);
                        assert.strictEqual(comment1.threadKey, secondInListCreated + '#' + comment1.created + '|');
                        assert.ok(comment1.id);
                        assert.ok(comment1.created);

                        getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                          assert.notExists(error);

                          assert.strictEqual(getLevel(comments, 0), 0);
                          assert.strictEqual(getLevel(comments, 1), 1);

                          // Add a reply to the first reply
                          createComment(
                            asBert,
                            contentObject.id,
                            'A reply to the reply on the second comment in the list',
                            comments.results[1].created,
                            (error, comment2) => {
                              assert.notExists(error);
                              assert.ok(comment2);

                              // Add a second comment to the content item
                              createComment(
                                asBert,
                                contentObject.id,
                                'This comment should be first in the list',
                                null,
                                (error, comment3) => {
                                  assert.notExists(error);
                                  assert.ok(comment3);

                                  getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                                    assert.notExists(error);

                                    // Check level of the replies
                                    assert.strictEqual(getLevel(comments, 0), 0); // Last level 0 comment made
                                    assert.strictEqual(comments.results[0].id, comment3.id);

                                    assert.strictEqual(getLevel(comments, 1), 0); // First level 0 comment made
                                    assert.strictEqual(comments.results[1].id, comment0.id);

                                    assert.strictEqual(getLevel(comments, 2), 1); // First reply to first comment made
                                    assert.strictEqual(comments.results[2].id, comment1.id);

                                    assert.strictEqual(getLevel(comments, 3), 2); // Reply to the reply
                                    assert.strictEqual(comments.results[3].id, comment2.id);

                                    // Check that replies to a comment reference the correct comment
                                    assert.strictEqual(comments.results[1].created, comments.results[2].replyTo);
                                    assert.strictEqual(comments.results[2].created, comments.results[3].replyTo);

                                    // Try to post a reply without a content ID
                                    createComment(
                                      asBert,
                                      null,
                                      'This is an updated comment',
                                      '1231654351',
                                      (error, comment) => {
                                        assert.ok(error);
                                        assert.isNotOk(comment);

                                        // Verify that paging results the order of threaded comments
                                        createLink(
                                          asBert,
                                          {
                                            displayName: 'Test Content',
                                            description: 'Test content description',
                                            visibility: PUBLIC,
                                            link: 'http://www.oaeproject.org/',
                                            managers: NO_MANAGERS,
                                            viewers: NO_VIEWERS,
                                            folders: NO_FOLDERS
                                          },
                                          (error, contentObject) => {
                                            assert.notExists(error);
                                            assert.ok(contentObject.id);

                                            // Create 10 top-level (level === 0) comments
                                            createComments(contexts, contentObject.id, 10, null, () => {
                                              getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                                                assert.notExists(error);
                                                assert.lengthOf(comments.results, 10);

                                                // Create 10 replies to the 6th comment returned in the previous comments
                                                createComments(
                                                  contexts,
                                                  contentObject.id,
                                                  10,
                                                  comments.results[5].created,
                                                  () => {
                                                    // Verify the depth/level of the first set of 10 comments
                                                    getComments(
                                                      asBert,
                                                      contentObject.id,
                                                      null,
                                                      10,
                                                      (error, comments) => {
                                                        assert.notExists(error);

                                                        const getLevel = (x) =>
                                                          compose(prop('level'), nth(x), prop('results'))(comments);

                                                        assert.lengthOf(comments.results, 10);

                                                        // First 6 comments are level 0 comments
                                                        assert.strictEqual(getLevel(0), 0);
                                                        assert.strictEqual(getLevel(1), 0);
                                                        assert.strictEqual(getLevel(2), 0);
                                                        assert.strictEqual(getLevel(3), 0);
                                                        assert.strictEqual(getLevel(4), 0);
                                                        assert.strictEqual(getLevel(5), 0);

                                                        // 7, 8 and 9 are level-1 replies (as they are replies to comments.results[5])
                                                        assert.strictEqual(getLevel(6), 1);
                                                        assert.strictEqual(getLevel(7), 1);
                                                        assert.strictEqual(getLevel(8), 1);
                                                        assert.strictEqual(getLevel(9), 1);

                                                        // Verify the depth/level of the second set of 10 comments
                                                        getComments(
                                                          asBert,
                                                          contentObject.id,
                                                          comments.nextToken,
                                                          10,
                                                          (error, comments) => {
                                                            assert.notExists(error);

                                                            const getLevel = (x) =>
                                                              compose(prop('level'), nth(x), prop('results'))(comments);
                                                            assert.lengthOf(comments.results, 10);

                                                            // Comments 0-5 in the list should all be level 1 (replies to the previous comment)
                                                            assert.strictEqual(getLevel(0), 1);
                                                            assert.strictEqual(getLevel(1), 1);
                                                            assert.strictEqual(getLevel(2), 1);
                                                            assert.strictEqual(getLevel(3), 1);
                                                            assert.strictEqual(getLevel(4), 1);
                                                            assert.strictEqual(getLevel(5), 1);

                                                            // Original level 0 comments continue from here on
                                                            assert.strictEqual(getLevel(6), 0);
                                                            assert.strictEqual(getLevel(7), 0);
                                                            assert.strictEqual(getLevel(8), 0);
                                                            assert.strictEqual(getLevel(9), 0);

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
    it('verify retrieve comments', (callback) => {
      setUpUsers((contexts) => {
        const { bert } = contexts;
        const asBert = bert.restContext;

        // Create a piece of content
        createLink(
          asBert,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.exists(contentObject);

            // Get the created piece of content
            getContent(asBert, contentObject.id, (error, retrievedContentObject) => {
              assert.notExists(error);
              assert.strictEqual(retrievedContentObject.id, contentObject.id);

              // Create one more and verify that it comes back as the first comment in the list
              createComment(
                asBert,
                contentObject.id,
                'This comment should be on top of the list',
                null,
                (error, comment) => {
                  assert.notExists(error);
                  assert.exists(comment);

                  // Get the comments and verify that the item on top of the list is the correct one
                  getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                    assert.notExists(error);

                    assert.lengthOf(comments.results, 1);
                    assert.strictEqual(comments.results[0].createdBy.publicAlias, 'Bert Pareyn');

                    // Try to get the comments for a content item without specifying the content ID
                    getComments(asBert, null, null, 10, (error /* , comments */) => {
                      assert.ok(error);
                      assert.strictEqual(error.code, 404);

                      getComments(asBert, ' ', null, 10, (error /* , comments */) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 400);

                        getComments(asBert, 'invalid-id', null, 10, (error /* , comments */) => {
                          assert.ok(error);
                          assert.strictEqual(error.code, 400);

                          callback();
                        });
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
    it('verify retrieve comments paging', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: someUser } = users;
        const asSomeUser = someUser.restContext;

        createLink(
          asSomeUser,
          {
            displayName: 'Test Content',
            description: 'Test content description',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);

            // Create 8 comments
            createComments(values(users), contentObject.id, 8, null, () => {
              // Get the first 3 comments
              getComments(asSomeUser, contentObject.id, null, 3, (error, comments) => {
                assert.notExists(error);

                assert.strictEqual(comments.nextToken, comments.results[2].threadKey);
                assert.lengthOf(comments.results, 3);

                // Get the next 3 comments
                getComments(asSomeUser, contentObject.id, comments.nextToken, 3, (error, comments) => {
                  assert.notExists(error);

                  assert.strictEqual(comments.nextToken, comments.results[2].threadKey);
                  assert.lengthOf(comments.results, 3);

                  // Get the last 2 comments
                  getComments(asSomeUser, contentObject.id, comments.nextToken, 3, (error, comments) => {
                    assert.notExists(error);

                    assert.isNotOk(comments.nextToken);
                    assert.lengthOf(comments.results, 2);
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
    it('verify delete comment', (callback) => {
      setUpUsers((contexts) => {
        const { bert } = contexts;
        const asBert = bert.restContext;

        // Create a piece of content
        createLink(
          asBert,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject);

            // Get the created piece of content
            getContent(asBert, contentObject.id, (error, retrievedContentObject) => {
              assert.notExists(error);
              assert.strictEqual(retrievedContentObject.id, contentObject.id);

              // Create a comment
              createComment(asBert, contentObject.id, 'This comment will be deleted.', null, (error, comment) => {
                assert.notExists(error);
                assert.exists(comment);

                // Get the comments and verify that the new comment was created
                getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                  assert.notExists(error);

                  assert.lengthOf(comments.results, 1);
                  assert.strictEqual(comments.results[0].createdBy.publicAlias, 'Bert Pareyn');

                  createComment(
                    asBert,
                    contentObject.id,
                    'This is a reply on the comment that will be deleted.',
                    comments.results[0].created,
                    (error, comment) => {
                      assert.notExists(error);
                      assert.ok(comment);

                      // Delete the comment
                      deleteComment(asBert, contentObject.id, comments.results[0].created, (error, softDeleted) => {
                        assert.notExists(error);
                        assert.ok(softDeleted.deleted);
                        assert.isNotOk(softDeleted.body);

                        // Check that the first comment was not deleted because there was a reply, instead it's marked as deleted
                        getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                          assert.notExists(error);

                          assert.lengthOf(comments.results, 2);
                          assert.ok(comments.results[0].deleted);

                          // Create a reply on the reply
                          createComment(
                            asBert,
                            contentObject.id,
                            'This is a reply on the reply on a comment that will be deleted.',
                            comments.results[1].created,
                            (error, comment) => {
                              assert.notExists(error);
                              assert.ok(comment);

                              // Delete reply on comment
                              deleteComment(
                                asBert,
                                contentObject.id,
                                comments.results[1].created,
                                (error, softDeleted) => {
                                  assert.notExists(error);
                                  assert.ok(softDeleted.deleted);
                                  assert.isNotOk(softDeleted.body);

                                  // Check that the first reply was not deleted because there was a reply, instead it's marked as deleted
                                  getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                                    assert.notExists(error);
                                    assert.lengthOf(comments.results, 3);

                                    assert.ok(comments.results[1].deleted);
                                    assert.strictEqual(comments.results[1].contentId, undefined);
                                    assert.strictEqual(comments.results[1].createdBy, undefined);
                                    assert.ok(comments.results[1].created);
                                    assert.strictEqual(comments.results[1].body, undefined);
                                    assert.strictEqual(comments.results[1].level, 1);
                                    assert.strictEqual(comments.results[1].id, comments.results[1].id);

                                    // Delete reply on reply
                                    deleteComment(
                                      asBert,
                                      contentObject.id,
                                      comments.results[2].created,
                                      (error, softDeleted) => {
                                        assert.notExists(error);
                                        assert.isNotOk(softDeleted);

                                        // Delete reply on comment
                                        deleteComment(
                                          asBert,
                                          contentObject.id,
                                          comments.results[1].created,
                                          (error, softDeleted) => {
                                            assert.notExists(error);
                                            assert.isNotOk(softDeleted);

                                            // Delete original comment
                                            deleteComment(
                                              asBert,
                                              contentObject.id,
                                              comments.results[0].created,
                                              (error, softDeleted) => {
                                                assert.notExists(error);
                                                assert.isNotOk(softDeleted);

                                                // Verify that all comments were deleted
                                                getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                                                  assert.notExists(error);
                                                  assert.lengthOf(comments.results, 0);

                                                  callback();
                                                });
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
     * Test that will verify permissions when deleting comments
     */
    it('verify delete comment permissions', (callback) => {
      setUpUsers((contexts) => {
        const { simon, nicolaas } = contexts;
        const asSimon = simon.restContext;
        const asNico = nicolaas.restContext;

        // Create a first piece of content where simon has full access
        createLink(
          asSimon,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, publicContentObject) => {
            assert.notExists(error);
            assert.ok(publicContentObject);

            // Create a second piece of content where simon is a member
            createLink(
              asNico,
              {
                displayName: 'Test Content 2',
                description: 'Test content description 2',
                visibility: PRIVATE,
                link: 'http://www.oaeproject.org/',
                managers: NO_MANAGERS,
                viewers: [contexts.simon.user.id],
                folders: NO_FOLDERS
              },
              (error, privateContentObject) => {
                assert.notExists(error);
                assert.ok(privateContentObject);

                // Create 2 comments as simon on the private link
                createComment(asSimon, privateContentObject.id, 'This is a first comment.', null, (error, comment) => {
                  assert.notExists(error);
                  assert.ok(comment);

                  createComment(
                    asSimon,
                    privateContentObject.id,
                    'This is a second comment.',
                    null,
                    (error, comment) => {
                      assert.notExists(error);
                      assert.ok(comment);

                      // Get the comments to verify they were created successfully
                      getComments(asSimon, privateContentObject.id, null, 10, (error, comments) => {
                        assert.notExists(error);
                        assert.lengthOf(comments.results, 2);

                        const comment1 = comments.results[1];
                        const comment2 = comments.results[0];

                        assert.strictEqual(comment2.createdBy.id, simon.user.id);
                        assert.strictEqual(comment2.body, 'This is a second comment.');
                        assert.strictEqual(comment1.createdBy.id, simon.user.id);
                        assert.strictEqual(comment1.body, 'This is a first comment.');

                        // Try to delete a comment
                        deleteComment(asSimon, privateContentObject.id, comment2.created, (error, softDeleted) => {
                          assert.notExists(error);
                          assert.isNotOk(softDeleted);

                          // Verify that the comment has been deleted
                          getComments(asSimon, privateContentObject.id, null, 10, (error, comments) => {
                            assert.notExists(error);
                            assert.lengthOf(comments.results, 1);
                            assert.strictEqual(comments.results[0].id, comment1.id);

                            // Remove simon as a member from the private content
                            const permissions = {};
                            permissions[simon.user.id] = false;

                            updateMembers(asNico, privateContentObject.id, permissions, (error_) => {
                              assert.notExists(error_);

                              // Try to delete the comment on the private content item
                              deleteComment(asSimon, publicContentObject.id, comment1.created, (error, softDeleted) => {
                                assert.ok(error);
                                assert.strictEqual(error.code, 404);
                                assert.isNotOk(softDeleted);

                                // Get the comment to verify that it wasn't deleted
                                getComments(asNico, privateContentObject.id, null, 10, (error, comments) => {
                                  assert.notExists(error);
                                  assert.lengthOf(comments.results, 1);
                                  assert.strictEqual(comments.results[0].id, comment1.id);
                                  assert.strictEqual(comments.results[0].createdBy.id, simon.user.id);
                                  assert.strictEqual(comments.results[0].body, 'This is a first comment.');

                                  // Try to reply to the comment on the private content item
                                  createComment(
                                    asSimon,
                                    publicContentObject.id,
                                    "This reply on the comment shouldn't be accepted",
                                    comment1.created,
                                    (error, comment) => {
                                      assert.ok(error);
                                      assert.strictEqual(error.code, 400);
                                      assert.isNotOk(comment);

                                      // Get the comment to verify that it wasn't created
                                      getComments(asNico, privateContentObject.id, null, 10, (error, comments) => {
                                        assert.notExists(error);
                                        assert.lengthOf(comments.results, 1);
                                        assert.strictEqual(comments.results[0].id, comment1.id);
                                        assert.strictEqual(comments.results[0].createdBy.id, simon.user.id);
                                        assert.strictEqual(comments.results[0].body, 'This is a first comment.');

                                        callback();
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
              }
            );
          }
        );
      });
    });

    /**
     * Test that will verify delete comment validation
     */
    it('verify delete comment validation', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, bert } = contexts;
        const asBert = bert.restContext;
        const asNico = nicolaas.restContext;

        // Create a public piece of content
        createLink(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject);

            // Create a comment as bert
            createComment(asBert, contentObject.id, 'This is a comment.', null, (error, comment) => {
              assert.notExists(error);
              assert.ok(comment);

              // Get the comment verify that it was created successfully
              getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                assert.notExists(error);

                assert.lengthOf(comments.results, 1);
                assert.strictEqual(comments.results[0].createdBy.id, contexts.bert.user.id);
                assert.strictEqual(comments.results[0].body, 'This is a comment.');
                assert.exists(comments.results[0].id);

                callback();
              });
            });
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
    const testDeleteCommentPermissions = function (contexts, visibility, expectedDelete, callback) {
      const { bert, simon } = contexts;

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
      const _canDelete = function (
        linkContext,
        commentContext,
        deleteContext,
        visibility,
        managers,
        members,
        expectedDelete,
        callback
      ) {
        const asUserWhoCreatesLink = linkContext.restContext;
        const asUserWhoComments = commentContext.restContext;
        const asUserWhoDeletes = deleteContext.restContext;
        createLink(
          asUserWhoCreatesLink,
          {
            displayName: 'Test Content',
            description: 'Test content description',
            visibility,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: members,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            createComment(asUserWhoComments, contentObject.id, 'Comment to check access', null, (error, comment) => {
              if (expectedDelete) {
                assert.notExists(error);
                assert.ok(comment);
              } else {
                assert.ok(error);
                assert.isNotOk(comment);
                return callback(error);
              }

              getComments(asUserWhoCreatesLink, contentObject.id, null, 10, (error, comments) => {
                assert.notExists(error);
                assert.strictEqual(comments.results[0].level, 0);
                assert.strictEqual(comments.results[0].body, 'Comment to check access');
                assert.strictEqual(comments.results[0].createdBy.id, commentContext.user.id);

                deleteComment(
                  asUserWhoDeletes || deleteContext,
                  contentObject.id,
                  comments.results[0].created,
                  callback
                );
              });
            });
          }
        );
      };

      // Delete own comment as manager on piece of content (--> success)
      _canDelete(bert, bert, bert, visibility, NO_MANAGERS, NO_MEMBERS, true, (error) => {
        assert.notExists(error);
        // Delete other's comment as manager on piece of content (--> success)
        _canDelete(bert, simon, bert, visibility, NO_MANAGERS, [contexts.simon.user.id], true, (error, softDeleted) => {
          assert.notExists(error);
          assert.isNotOk(softDeleted);
          // Delete own comment as member on piece of content (--> success)
          _canDelete(
            bert,
            simon,
            simon,
            visibility,
            NO_MANAGERS,
            [contexts.simon.user.id],
            true,
            (error, softDeleted) => {
              assert.notExists(error);
              assert.isNotOk(softDeleted);
              // Delete other's comment as member on piece of content (--> fail)
              _canDelete(
                bert,
                bert,
                simon,
                visibility,
                NO_MANAGERS,
                [contexts.simon.user.id],
                true,
                (error, softDeleted) => {
                  assert.ok(error);
                  assert.isNotOk(softDeleted);
                  // Delete own comment as logged in on piece of content (--> success)
                  _canDelete(
                    bert,
                    simon,
                    simon,
                    visibility,
                    NO_MANAGERS,
                    NO_MEMBERS,
                    expectedDelete,
                    (error, softDeleted) => {
                      if (expectedDelete) {
                        assert.notExists(error);
                      } else {
                        assert.ok(error);
                      }

                      assert.isNotOk(softDeleted);

                      // Delete comment as anonymous on piece of content (--> fail)
                      _canDelete(
                        bert,
                        bert,
                        asCambridgeAnonymousUser,
                        visibility,
                        NO_MANAGERS,
                        NO_MEMBERS,
                        true,
                        (error, softDeleted) => {
                          assert.ok(error);
                          assert.isNotOk(softDeleted);
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
    };

    /**
     * Test that will verify delete permissions for comments on public content
     */
    it('verify delete comment permissions public', (callback) => {
      setUpUsers((contexts) => {
        testDeleteCommentPermissions(contexts, PUBLIC, true, callback);
      });
    });

    /**
     * Test that will verify delete permissions for comments on loggedin content
     */
    it('verify delete comment permissions loggedin', (callback) => {
      setUpUsers((contexts) => {
        testDeleteCommentPermissions(contexts, LOGGEDIN, true, callback);
      });
    });

    /**
     * Test that will verify delete permissions for comments on private content
     */
    it('verify delete comment permissions private', (callback) => {
      setUpUsers((contexts) => {
        testDeleteCommentPermissions(contexts, PRIVATE, false, callback);
      });
    });

    /**
     * Test that will verify comment creation validation
     */
    it('verify create comment validation', (callback) => {
      setUpUsers((contexts) => {
        const { bert } = contexts;
        const asBert = bert.restContext;

        // Create a piece of content
        createLink(
          asBert,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject);

            // Try to create a comment without a contentId
            createComment(asBert, null, 'This comment should be on top of the list', null, (error, comment) => {
              assert.ok(error);
              assert.strictEqual(error.code, 404);
              assert.isNotOk(comment);

              // Verify that the comment wasn't created
              getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                assert.notExists(error);
                assert.isEmpty(comments.results);

                // Try to create a comment without a comment
                createComment(asBert, contentObject.id, null, null, (error, comment) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 400);
                  assert.isNotOk(comment);

                  // Verify that the comment wasn't created
                  getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                    assert.notExists(error);
                    assert.isEmpty(comments.results);

                    // Try to create a comment without a valid replyTo
                    createComment(
                      asBert,
                      contentObject.id,
                      'This comment should be on top of the list',
                      'NotAnInteger',
                      (error, comment) => {
                        assert.ok(error); // Invalid reply-to timestamp provided
                        assert.strictEqual(error.code, 400);
                        assert.isNotOk(comment);

                        // Verify that the comment wasn't created
                        getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                          assert.notExists(error);
                          assert.isEmpty(comments.results);

                          // Try to create a comment as an anonymous user
                          createComment(
                            asCambridgeAnonymousUser,
                            contentObject.id,
                            'This comment should be on top of the list',
                            null,
                            (error, comment) => {
                              assert.ok(error);
                              assert.strictEqual(error.code, 401);
                              assert.isNotOk(comment);

                              // Verify that the comment wasn't created
                              getComments(asBert, contentObject.id, null, 10, (error, comments) => {
                                assert.notExists(error);
                                assert.isEmpty(comments.results);

                                // Create a comment that is larger than the allowed maximum size
                                const commentBody = generateRandomText(10000);
                                createComment(asBert, contentObject.id, commentBody, null, (error, comment) => {
                                  assert.ok(error);
                                  assert.strictEqual(error.code, 400);
                                  assert.isNotOk(comment);
                                  callback();
                                });
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
    const testCommentPermissions = function (contexts, visibility, expectLoggedInComment, callback) {
      const { bert, nicolaas, simon } = contexts;
      const asBert = bert.restContext;
      const asSimon = simon.restContext;
      const asNico = nicolaas.restContext;

      // Create content with specified visibility
      createLink(
        asBert,
        {
          displayName: 'Test Content 1',
          description: 'Test content description 1',
          visibility,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: [contexts.nicolaas.user.id],
          folders: NO_FOLDERS
        },
        (error, contentObject) => {
          assert.notExists(error);
          assert.ok(contentObject.id);

          // Try to comment as manager
          createComment(asBert, contentObject.id, 'Try to comment as manager', null, (error, comment) => {
            assert.notExists(error);
            assert.ok(comment);

            // Verify that the comment was placed as a manager
            getComments(asBert, contentObject.id, null, 1, (error, comments) => {
              assert.notExists(error);
              assert.strictEqual(comments.results[0].body, 'Try to comment as manager');

              // Try to comment as member
              createComment(asNico, contentObject.id, 'Try to comment as member', null, (error, comment) => {
                assert.notExists(error);
                assert.ok(comment);

                // Verify that the comment was placed as a member
                getComments(asNico, contentObject.id, null, 1, (error, comments) => {
                  assert.notExists(error);
                  assert.strictEqual(comments.results[0].body, 'Try to comment as member');

                  // Try to comment as logged in user
                  createComment(
                    asSimon,
                    contentObject.id,
                    'Try to comment as logged in user',
                    null,
                    (error, comment) => {
                      if (expectLoggedInComment) {
                        assert.notExists(error);
                        assert.ok(comment);
                      } else {
                        assert.ok(error);
                        assert.isNotOk(comment);
                      }

                      // Verify that the comment was placed as a logged in user
                      getComments(asSimon, contentObject.id, null, 1, (error, comments) => {
                        if (expectLoggedInComment) {
                          assert.notExists(error);
                          assert.strictEqual(comments.results[0].body, 'Try to comment as logged in user');
                        } else {
                          assert.ok(error);
                        }

                        // Try to comment as anonymous user
                        createComment(
                          asCambridgeAnonymousUser,
                          contentObject.id,
                          'Try to comment as an anonymous user',
                          null,
                          (error, comment) => {
                            assert.ok(error);
                            assert.isNotOk(comment);

                            // Verify that the comment was placed as an anonymous
                            getComments(asBert, contentObject.id, null, 1, (error, comments) => {
                              assert.notExists(error);
                              assert.notStrictEqual(comments.results[0].body, 'Try to comment as an anonymous user');

                              callback();
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
        }
      );
    };

    /**
     * Test that will check permissions for placing comments on public content
     */
    it('verify create comment permissions public', (callback) => {
      setUpUsers((contexts) => {
        testCommentPermissions(contexts, PUBLIC, true, callback);
      });
    });

    /**
     * Test that will check permissions for placing comments on loggedin only content
     */
    it('verify create comment permissions loggedin', (callback) => {
      setUpUsers((contexts) => {
        testCommentPermissions(contexts, LOGGEDIN, true, callback);
      });
    });

    /**
     * Test that will check permissions for placing comments on private content
     */
    it('verify create comment permissions private', (callback) => {
      setUpUsers((contexts) => {
        testCommentPermissions(contexts, PRIVATE, false, callback);
      });
    });
  });

  describe('Create content', () => {
    /**
     * Test that verifies we can't create content of an unknown resourceSubType
     */
    it('verify cannot create content of unknown resourceSubType', (callback) => {
      /**
       * There is no oae-rest method we can call that allows us to create content of a non-standard
       * resourceSubType. We can use the rest utility to do REST requests directly.
       */
      performRestRequest(
        asCambridgeTenantAdmin,
        '/api/content/create',
        'POST',
        { resourceSubType: 'unicorns' },
        (error) => {
          assert.strictEqual(error.code, 400);
          callback();
        }
      );
    });

    /**
     * Test that will attempt to create new links with various parameter combinations
     */
    it('verify create link', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas } = contexts;
        const asNico = nicolaas.restContext;

        // Create one as anon user
        createLink(
          asCambridgeAnonymousUser,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.ok(error);
            assert.isNotOk(contentObject);

            // Create one with all required fields
            createLink(
              asNico,
              {
                displayName: 'Test Content 2',
                description: 'Test content description 2',
                visibility: PUBLIC,
                link: 'http://www.oaeproject.org/',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, contentObject, response) => {
                assert.notExists(error);
                assert.ok(contentObject.id);

                // Verify the backend is returning appliation/json
                assert.ok(response.headers['content-type'].startsWith('application/json'));

                // Create one without description
                createLink(
                  asNico,
                  {
                    displayName: 'Test Content 3',
                    description: null,
                    visibility: PUBLIC,
                    link: 'http://www.oaeproject.org/',
                    managers: NO_MANAGERS,
                    viewers: NO_VIEWERS,
                    folders: NO_FOLDERS
                  },
                  (error, contentObject) => {
                    assert.notExists(error);
                    assert.ok(contentObject.id);

                    // Create one with description that's longer than the allowed maximum size
                    const longDescription = generateRandomText(1000);
                    createLink(
                      asNico,
                      {
                        displayName: 'Test Content 4',
                        description: longDescription,
                        visibility: PUBLIC,
                        link: null,
                        managers: NO_MANAGERS,
                        viewers: NO_VIEWERS,
                        folders: NO_FOLDERS
                      },
                      (error, contentObject) => {
                        assert.ok(error);
                        assert.isNotOk(contentObject);

                        // Create one without URL
                        createLink(
                          asNico,
                          {
                            displayName: 'Test Content 4',
                            description: 'Test content description 4',
                            visibility: PUBLIC,
                            link: null,
                            managers: NO_MANAGERS,
                            viewers: NO_VIEWERS,
                            folders: NO_FOLDERS
                          },
                          (error, contentObject) => {
                            assert.ok(error);
                            assert.isNotOk(contentObject);

                            // Create one without a valid URL
                            createLink(
                              asNico,
                              {
                                displayName: 'Test Content 5',
                                description: 'Test content description 5',
                                visibility: PUBLIC,
                                link: 'Just a string',
                                managers: NO_MANAGERS,
                                viewers: NO_VIEWERS,
                                folders: NO_FOLDERS
                              },
                              (error, contentObject) => {
                                assert.ok(error);
                                assert.isNotOk(contentObject);

                                // Create one with a URL that's longer than the allowed maximum size
                                let longUrl = 'http://www.oaeproject.org/';
                                for (let i = 0; i < 2500; i++) {
                                  longUrl += 'a';
                                }

                                createLink(
                                  asNico,
                                  {
                                    displayName: 'Test Content 5',
                                    description: 'Test content description 5',
                                    visibility: PUBLIC,
                                    link: longUrl,
                                    managers: NO_MANAGERS,
                                    viewers: NO_VIEWERS,
                                    folders: NO_FOLDERS
                                  },
                                  (error, contentObject) => {
                                    assert.ok(error);
                                    assert.strictEqual(error.code, 400);
                                    assert.isNotOk(contentObject);

                                    // Create one without displayName
                                    createLink(
                                      asNico,
                                      {
                                        displayName: null,
                                        description: 'Test content description 6',
                                        visibility: PUBLIC,
                                        link: 'http://www.oaeproject.org/',
                                        managers: NO_MANAGERS,
                                        viewers: NO_VIEWERS,
                                        folders: NO_FOLDERS
                                      },
                                      (error, contentObject) => {
                                        assert.ok(error);
                                        assert.isNotOk(contentObject);

                                        // Create one with an displayName that's longer than the allowed maximum size
                                        const longDisplayName = generateRandomText(100);
                                        createLink(
                                          asNico,
                                          {
                                            displayName: longDisplayName,
                                            description: 'Test content description 6',
                                            visibility: PUBLIC,
                                            link: 'http://www.oaeproject.org/',
                                            managers: NO_MANAGERS,
                                            viewers: NO_VIEWERS,
                                            folders: NO_FOLDERS
                                          },
                                          (error, contentObject) => {
                                            assert.ok(error);
                                            assert.strictEqual(error.code, 400);
                                            assert.include(error.msg, '1000');
                                            assert.isNotOk(contentObject);

                                            // Create one without visibility
                                            createLink(
                                              asNico,
                                              {
                                                displayName: 'Test Content 7',
                                                description: 'Test content description 7',
                                                visibility: null,
                                                link: 'http://www.oaeproject.org/',
                                                managers: NO_MANAGERS,
                                                viewers: NO_VIEWERS,
                                                folders: NO_FOLDERS
                                              },
                                              (error, contentObject) => {
                                                assert.notExists(error);
                                                assert.ok(contentObject.id);

                                                // Check if the visibility has been set to public (default)
                                                getContent(asNico, contentObject.id, (error, contentObject) => {
                                                  assert.notExists(error);
                                                  assert.strictEqual(contentObject.visibility, PUBLIC);
                                                  assert.isNotOk(contentObject.downloadPath);

                                                  // Verify that an empty description is allowed
                                                  createLink(
                                                    asNico,
                                                    {
                                                      displayName: 'Test Content 7',
                                                      description: '',
                                                      visibility: null,
                                                      link: 'http://www.oaeproject.org/',
                                                      managers: NO_MANAGERS,
                                                      viewers: NO_VIEWERS,
                                                      folders: NO_FOLDERS
                                                    },
                                                    (error, contentObject) => {
                                                      assert.notExists(error);
                                                      assert.ok(contentObject.id);

                                                      // Verify that a protocol is added if missing
                                                      createLink(
                                                        asNico,
                                                        {
                                                          displayName: 'Test Content 8',
                                                          description: 'Test content description 8',
                                                          visibility: PUBLIC,
                                                          link: 'www.oaeproject.org',
                                                          managers: NO_MANAGERS,
                                                          viewers: NO_VIEWERS,
                                                          folders: NO_FOLDERS
                                                        },
                                                        (error, contentObject /* , response */) => {
                                                          assert.notExists(error);
                                                          assert.ok(contentObject.id);

                                                          getContent(
                                                            asNico,
                                                            contentObject.id,
                                                            (error, contentObject) => {
                                                              assert.notExists(error);
                                                              assert.strictEqual(
                                                                contentObject.link,
                                                                'http://www.oaeproject.org'
                                                              );
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
    it('verify create file', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas } = contexts;
        const asNico = nicolaas.restContext;

        // Create one as anon user
        createFile(
          asCambridgeAnonymousUser,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            file: getFileStream,
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.strictEqual(error.code, 401);
            assert.isNotOk(contentObject);

            // Create one with all required fields
            createFile(
              asNico,
              {
                displayName: 'Test Content 2',
                description: 'Test content description 2',
                visibility: PUBLIC,
                file: getFileStream,
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, contentObject, response) => {
                assert.notExists(error);
                assert.ok(contentObject.id);
                assert.strictEqual(contentObject.filename, 'oae-video.png');
                assert.strictEqual(contentObject.mime, 'image/png');

                // Verify the backend is returning text/plain as IE9 doesn't support application/json on upload
                assert.strictEqual(response.headers['content-type'], 'text/plain; charset=utf-8');

                // Create one without description
                createFile(
                  asNico,
                  {
                    displayName: 'Test Content 3',
                    description: null,
                    visibility: PUBLIC,
                    file: getFileStream,
                    managers: NO_MANAGERS,
                    viewers: NO_VIEWERS,
                    folders: NO_FOLDERS
                  },
                  (error, contentObject) => {
                    assert.notExists(error);
                    assert.ok(contentObject.id);

                    // Create one with a description that's longer than the allowed maximum size
                    const longDescription = generateRandomText(1000);
                    createFile(
                      asNico,
                      {
                        displayName: 'Test content',
                        description: longDescription,
                        visibility: PUBLIC,
                        file: getFileStream,
                        managers: NO_MANAGERS,
                        viewers: NO_VIEWERS,
                        folders: NO_FOLDERS
                      },
                      (error, contentObject) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 400);
                        assert.include(error.msg, '10000');
                        assert.isNotOk(contentObject);

                        // Create one without title
                        createFile(
                          asNico,
                          {
                            displayName: null,
                            description: 'Test content description 4',
                            visibility: PUBLIC,
                            file: getFileStream,
                            managers: NO_MANAGERS,
                            viewers: NO_VIEWERS,
                            folders: NO_FOLDERS
                          },
                          (error, contentObject) => {
                            assert.strictEqual(error.code, 400);
                            assert.isNotOk(contentObject);

                            // Create one with a displayName that's longer than the allowed maximum size
                            const longDisplayName = generateRandomText(100);
                            createFile(
                              asNico,
                              {
                                displayName: longDisplayName,
                                description: 'Test content description 4',
                                visibility: PUBLIC,
                                file: getFileStream,
                                managers: NO_MANAGERS,
                                viewers: NO_VIEWERS,
                                folders: NO_FOLDERS
                              },
                              (error, contentObject) => {
                                assert.ok(error);
                                assert.strictEqual(error.code, 400);
                                assert.include(error.msg, '1000');
                                assert.isNotOk(contentObject);

                                // Create one without a file body.
                                createFile(
                                  asNico,
                                  {
                                    displayName: 'Test Content 4',
                                    description: 'Test content description 4',
                                    visibility: PUBLIC,
                                    file: null,
                                    managers: NO_MANAGERS,
                                    viewers: NO_VIEWERS,
                                    folders: NO_FOLDERS
                                  },
                                  (error, contentObject) => {
                                    assert.strictEqual(error.code, 400);
                                    assert.isNotOk(contentObject);

                                    // Create one without visibility
                                    createFile(
                                      asNico,
                                      {
                                        displayName: 'Test Content 5',
                                        description: 'Test content description 6',
                                        visibility: null,
                                        file: getFileStream,
                                        managers: NO_MANAGERS,
                                        viewers: NO_VIEWERS,
                                        folders: NO_FOLDERS
                                      },
                                      (error, contentObject) => {
                                        assert.notExists(error);
                                        assert.ok(contentObject.id);

                                        // Check if the visibility has been set to public (default)
                                        getContent(asNico, contentObject.id, (error, contentObject) => {
                                          assert.notExists(error);
                                          assert.strictEqual(contentObject.visibility, PUBLIC);
                                          assert.strictEqual(
                                            contentObject.downloadPath,
                                            `/api/content/${contentObject.id}/download/${contentObject.latestRevisionId}`
                                          );

                                          // Verify that an empty description is accepted
                                          createFile(
                                            asNico,
                                            {
                                              displayName: 'Test Content 5',
                                              description: '',
                                              visibility: PUBLIC,
                                              file: getFileStream,
                                              managers: NO_MANAGERS,
                                              viewers: NO_VIEWERS,
                                              folders: NO_FOLDERS
                                            },
                                            (error, contentObject) => {
                                              assert.notExists(error);
                                              assert.ok(contentObject.id);

                                              callback();
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
          }
        );
      });
    });

    /**
     * Test that will attempt to create new collaborative documents with various parameter combinations
     */
    it('verify create collaborative document', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas } = contexts;
        const asNico = nicolaas.restContext;

        // Create one as anon user
        createCollabDoc(
          asCambridgeAnonymousUser,
          'Test Content 1',
          'Test content description 1',
          PUBLIC,
          NO_MANAGERS,
          NO_EDITORS,
          NO_VIEWERS,
          NO_FOLDERS,
          (error, contentObject) => {
            assert.ok(error);
            assert.isNotOk(contentObject);

            // Create one with all required fields
            createCollabDoc(
              asNico,
              'Test Content 2',
              'Test content description 2',
              PUBLIC,
              NO_MANAGERS,
              NO_EDITORS,
              NO_VIEWERS,
              NO_FOLDERS,
              (error, contentObject, response) => {
                assert.notExists(error);
                assert.ok(contentObject.id);

                // Verify the backend is returning appliation/json
                assert.ok(response.headers['content-type'].startsWith('application/json'));

                // Create one without description
                createCollabDoc(
                  asNico,
                  'Test Content 3',
                  null,
                  PUBLIC,
                  NO_MANAGERS,
                  NO_EDITORS,
                  NO_VIEWERS,
                  NO_FOLDERS,
                  (error, contentObject) => {
                    assert.notExists(error);
                    assert.ok(contentObject.id);

                    // Create one with a description that's longer than the allowed maximum size
                    const longDescription = generateRandomText(1000);
                    createCollabDoc(
                      asNico,
                      'Test content',
                      longDescription,
                      PUBLIC,
                      NO_MANAGERS,
                      NO_EDITORS,
                      NO_VIEWERS,
                      NO_FOLDERS,
                      (error, contentObject) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 400);
                        assert.include(error.msg, '10000');
                        assert.isNotOk(contentObject);

                        // Create one without title
                        createCollabDoc(
                          asNico,
                          null,
                          'Test content description 4',
                          PUBLIC,
                          NO_MANAGERS,
                          NO_EDITORS,
                          NO_VIEWERS,
                          NO_FOLDERS,
                          (error, contentObject) => {
                            assert.ok(error);
                            assert.isNotOk(contentObject);

                            // Create one with a displayName that's longer than the allowed maximum size
                            const longDisplayName = generateRandomText(100);
                            createCollabDoc(
                              asNico,
                              longDisplayName,
                              'descripton',
                              PUBLIC,
                              NO_MANAGERS,
                              NO_EDITORS,
                              NO_VIEWERS,
                              NO_FOLDERS,
                              (error, contentObject) => {
                                assert.ok(error);
                                assert.strictEqual(error.code, 400);
                                assert.include(error.msg, '1000');
                                assert.isNotOk(contentObject);

                                // Create one without permission
                                createCollabDoc(
                                  asNico,
                                  'Test Content 5',
                                  'Test content description 5',
                                  null,
                                  NO_MANAGERS,
                                  NO_EDITORS,
                                  NO_VIEWERS,
                                  NO_FOLDERS,
                                  (error, contentObject) => {
                                    assert.notExists(error);
                                    assert.ok(contentObject.id);

                                    // Check if the permission has been set to private (default)
                                    getContent(asNico, contentObject.id, (error, contentObject) => {
                                      assert.notExists(error);
                                      assert.strictEqual(contentObject.visibility, PRIVATE);
                                      assert.isNotOk(contentObject.downloadPath);

                                      // Verify that an empty description is accepted
                                      createCollabDoc(
                                        asNico,
                                        'Test Content 5',
                                        '',
                                        PUBLIC,
                                        NO_MANAGERS,
                                        NO_EDITORS,
                                        NO_VIEWERS,
                                        NO_FOLDERS,
                                        (error, contentObject) => {
                                          assert.notExists(error);
                                          assert.ok(contentObject.id);
                                          callback();
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
    });

    /**
     * Test that will attempt to create a public content item and will verify direct and library access
     * for various people
     */
    it('verify create public content item', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, simon } = contexts;
        const asNico = nicolaas.restContext;
        const asSimon = simon.restContext;

        // Create a public content item
        createLink(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Get the piece of content as the person who created the content
            checkPieceOfContent(asNico, nicolaas.user.id, contentObject, true, true, true, true, () => {
              // Get the piece of content as a different logged in user
              checkPieceOfContent(asSimon, nicolaas.user.id, contentObject, true, false, true, true, () => {
                // Get the piece of content as an anonymous user
                checkPieceOfContent(
                  asCambridgeAnonymousUser,
                  nicolaas.user.id,
                  contentObject,
                  true,
                  false,
                  true,
                  false,
                  callback
                );
              });
            });
          }
        );
      });
    });

    /**
     * Test that will attempt to create a loggedin content item and will verify direct and library access
     * for various people
     */
    it('verify create logged in content item', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, simon } = contexts;
        const asNico = nicolaas.restContext;
        const asSimon = simon.restContext;

        // Create a logged in content item
        createLink(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: LOGGEDIN,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Get the piece of content as the person who created the content
            checkPieceOfContent(asNico, nicolaas.user.id, contentObject, true, true, true, true, () => {
              // Get the piece of content as a different logged in user
              checkPieceOfContent(asSimon, nicolaas.user.id, contentObject, true, false, true, true, () => {
                // Get the piece of content as an anonymous user
                checkPieceOfContent(
                  asCambridgeAnonymousUser,
                  nicolaas.user.id,
                  contentObject,
                  false,
                  false,
                  false,
                  false,
                  callback
                );
              });
            });
          }
        );
      });
    });

    /**
     * Test that will attempt to create a private content item and will verify direct and library access
     * for various people
     */
    it('verify create private content item', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, simon } = contexts;
        const asNico = nicolaas.restContext;
        const asSimon = simon.restContext;

        // Create a private content item
        createLink(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PRIVATE,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Get the piece of content as the person who created the content
            checkPieceOfContent(asNico, nicolaas.user.id, contentObject, true, true, true, true, () => {
              // Get the piece of content as a different logged in user
              checkPieceOfContent(asSimon, nicolaas.user.id, contentObject, false, false, false, false, () => {
                // Get the piece of content as an anonymous user
                checkPieceOfContent(
                  asCambridgeAnonymousUser,
                  nicolaas.user.id,
                  contentObject,
                  false,
                  false,
                  false,
                  false,
                  callback
                );
              });
            });
          }
        );
      });
    });

    /**
     * Test whether or not passing in viewers and managers to be added to the content upon link creation works as expected. This test will
     * create a private piece of content that will have 1 additional manager and 1 viewer. We will fetch the content as those people
     * to verify access, and then get the content as a logged in user and an anonymous user to verify they don't have access
     */
    it('verify create content with default members link', (callback) => {
      setUpUsers((contexts) => {
        const { bert, stuart, nicolaas, simon } = contexts;
        const asNico = nicolaas.restContext;
        const asSimon = simon.restContext;
        const asStuart = stuart.restContext;
        const asBert = bert.restContext;

        // Create a private content item and share with 2 people
        createLink(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PRIVATE,
            link: 'http://www.oaeproject.org/',
            managers: [simon.user.id],
            viewers: [stuart.user.id],
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Get the piece of content as the person who created the content
            checkPieceOfContent(asNico, nicolaas.user.id, contentObject, true, true, true, true, () => {
              // Get the piece of content as another manager
              checkPieceOfContent(asSimon, simon.user.id, contentObject, true, true, true, true, () => {
                // Get the piece of content as a viewer
                checkPieceOfContent(asStuart, stuart.user.id, contentObject, true, false, true, false, () => {
                  // Get the piece of content as a non-member
                  checkPieceOfContent(asBert, bert.user.id, contentObject, false, false, false, false, () => {
                    // Get the piece of content as an anonymous user
                    checkPieceOfContent(
                      asCambridgeAnonymousUser,
                      nicolaas.user.id,
                      contentObject,
                      false,
                      false,
                      false,
                      false,
                      callback
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
     * Test whether or not passing in viewers and managers to be added to the content upon file creation works as expected. This test will
     * create a private piece of content that will have 1 additional manager and 1 viewer. We will fetch the content as those people
     * to verify access, and then get the content as a logged in user and an anonymous user to verify they don't have access
     */
    it('verify create content with default members file', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, branden, stuart, simon } = contexts;
        const asNico = nicolaas.restContext;
        const asSimon = simon.restContext;
        const asBranden = branden.restContext;
        const asStuart = stuart.restContext;

        // Create a private content item and share with 2 people
        createFile(
          asNico,
          {
            displayName: 'Test Content 2',
            description: 'Test content description 2',
            visibility: PRIVATE,
            file: getFileStream,
            managers: [simon.user.id],
            viewers: [stuart.user.id],
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Get the piece of content as the person who created the content
            checkPieceOfContent(asNico, nicolaas.user.id, contentObject, true, true, true, true, () => {
              // Get the piece of content as another manager
              checkPieceOfContent(asSimon, simon.user.id, contentObject, true, true, true, true, () => {
                // Get the piece of content as a viewer
                checkPieceOfContent(asStuart, stuart.user.id, contentObject, true, false, true, false, () => {
                  // Get the piece of content as a non-member
                  checkPieceOfContent(asBranden, branden.user.id, contentObject, false, false, false, false, () => {
                    // Get the piece of content as an anonymous user
                    checkPieceOfContent(
                      asCambridgeAnonymousUser,
                      nicolaas.user.id,
                      contentObject,
                      false,
                      false,
                      false,
                      false,
                      callback
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
     * Test whether or not passing in viewers and managers to be added to the content upon document creation works as expected. This test will
     * create a private piece of content that will have 1 additional manager and 1 viewer. We will fetch the content as those people
     * to verify access, and then get the content as a logged in user and an anonymous user to verify they don't have access
     */
    it('verify create content with default members collaborative document', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, branden, stuart, simon } = contexts;
        const asNico = nicolaas.restContext;
        const asSimon = simon.restContext;
        const asBranden = branden.restContext;
        const asStuart = stuart.restContext;

        // Create a private content item and share with 2 people
        createCollabDoc(
          asNico,
          'Test Content 2',
          'Test content description 2',
          PRIVATE,
          [simon.user.id],
          NO_EDITORS,
          [stuart.user.id],
          NO_FOLDERS,
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Get the piece of content as the person who created the content
            checkPieceOfContent(asNico, nicolaas.user.id, contentObject, true, true, true, true, () => {
              // Get the piece of content as another manager
              checkPieceOfContent(asSimon, simon.user.id, contentObject, true, true, true, true, () => {
                // Get the piece of content as a viewer
                checkPieceOfContent(asStuart, stuart.user.id, contentObject, true, false, true, false, () => {
                  // Get the piece of content as a non-member
                  checkPieceOfContent(asBranden, branden.user.id, contentObject, false, false, false, false, () => {
                    // Get the piece of content as an anonymous user
                    checkPieceOfContent(
                      asCambridgeAnonymousUser,
                      nicolaas.user.id,
                      contentObject,
                      false,
                      false,
                      false,
                      false,
                      callback
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
     * Test that verifies that you cannot create a piece of content when trying to add a private user as a member
     */
    it('verify create content with a private user as another member', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;

        updateUser(asMarge, marge.user.id, { visibility: PRIVATE }, (error_) => {
          assert.notExists(error_);

          createLink(
            asHomer,
            {
              displayName: 'Test Content',
              description: 'Test content description',
              visibility: PUBLIC,
              link: 'http://www.oaeproject.org/',
              managers: [marge.user.id],
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error /* , contentObj */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);
              callback();
            }
          );
        });
      });
    });

    /**
     * Test that verifies that you cannot create a piece of content when trying to add a private group as a member
     */
    it('verify create content with a private group as another member', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: homer, 1: marge } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;

        createGroup(
          asMarge,
          'Group title',
          'Group description',
          PRIVATE,
          undefined,
          NO_MANAGERS,
          NO_MEMBERS,
          (error, groupObject) => {
            assert.notExists(error);

            createLink(
              asHomer,
              {
                displayName: 'Test Content',
                description: 'Test content description',
                visibility: PUBLIC,
                link: 'http://www.oaeproject.org/',
                managers: [groupObject.id],
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error /* , contentObj */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 401);
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
    const checkNameAndDescription = function (contexts, contentId, expectedName, expectedDescription, callback) {
      const { nicolaas, simon } = contexts;
      const asNico = nicolaas.restContext;
      const asSimon = simon.restContext;

      // Check as user 0
      getContent(asNico, contentId, (error, contentObject) => {
        assert.notExists(error);
        assert.strictEqual(contentObject.id, contentId);
        assert.strictEqual(contentObject.displayName, expectedName);
        assert.strictEqual(contentObject.description, expectedDescription);
        assert.strictEqual(contentObject.resourceType, CONTENT);
        assert.strictEqual(
          contentObject.profilePath,
          `/content/${contentObject.tenant.alias}/${AuthzUtil.getResourceFromId(contentId).resourceId}`
        );
        // Check as user 1
        getContent(asSimon, contentId, (error, contentObject) => {
          assert.notExists(error);
          assert.strictEqual(contentObject.id, contentId);
          assert.strictEqual(contentObject.displayName, expectedName);
          assert.strictEqual(contentObject.description, expectedDescription);
          assert.strictEqual(contentObject.resourceType, CONTENT);
          assert.strictEqual(
            contentObject.profilePath,
            '/content/' + contentObject.tenant.alias + '/' + AuthzUtil.getResourceFromId(contentId).resourceId
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
    it('verify update content profile', (callback) => {
      // Create a piece of content
      setUpUsers((contexts) => {
        const { nicolaas, simon } = contexts;
        const asNico = nicolaas.restContext;
        const asSimon = simon.restContext;

        createLink(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Share it with someone
            shareContent(asNico, contentObject.id, [contexts.simon.user.id], (error_) => {
              assert.notExists(error_);

              // Invalid content metadata update (empty)
              updateContent(asNico, contentObject.id, {}, (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 400);

                // Invalid content metadata update (unexisting field)
                updateContent(
                  asNico,
                  contentObject.id,
                  { displayName: 'New Test Content 1', nonExisting: 'Non-existing field' },
                  (error_) => {
                    assert.ok(error_);
                    assert.strictEqual(error_.code, 400);

                    // Check name and description are still correct
                    checkNameAndDescription(
                      contexts,
                      contentObject.id,
                      'Test Content 1',
                      'Test content description 1',
                      () => {
                        // Change the name
                        updateContent(
                          asNico,
                          contentObject.id,
                          { displayName: 'New Test Content 1' },
                          (error, updatedContentObject) => {
                            assert.notExists(error);
                            assert.strictEqual(updatedContentObject.displayName, 'New Test Content 1');
                            assert.ok(updatedContentObject.isManager);
                            assert.strictEqual(updatedContentObject.createdBy.id, contexts.nicolaas.user.id);
                            assert.isNotOk(updatedContentObject.downloadPath);

                            // Check the new name comes back
                            checkNameAndDescription(
                              contexts,
                              contentObject.id,
                              'New Test Content 1',
                              'Test content description 1',
                              () => {
                                // Change the description
                                updateContent(
                                  asNico,
                                  contentObject.id,
                                  { description: 'New test content description 1' },
                                  (error, updatedContentObject) => {
                                    assert.notExists(error);
                                    assert.strictEqual(
                                      updatedContentObject.description,
                                      'New test content description 1'
                                    );
                                    assert.ok(updatedContentObject.isManager);
                                    assert.strictEqual(updatedContentObject.createdBy.id, contexts.nicolaas.user.id);
                                    assert.isNotOk(updatedContentObject.downloadPath);

                                    // Check the new description comes back
                                    checkNameAndDescription(
                                      contexts,
                                      contentObject.id,
                                      'New Test Content 1',
                                      'New test content description 1',
                                      () => {
                                        // Change both at same time
                                        updateContent(
                                          asNico,
                                          contentObject.id,
                                          {
                                            displayName: 'New Test Content 2',
                                            description: 'New test content description 2'
                                          },
                                          (error, updatedContentObject) => {
                                            assert.notExists(error);
                                            assert.strictEqual(updatedContentObject.displayName, 'New Test Content 2');
                                            assert.strictEqual(
                                              updatedContentObject.description,
                                              'New test content description 2'
                                            );
                                            assert.ok(updatedContentObject.isManager);
                                            assert.strictEqual(
                                              updatedContentObject.createdBy.id,
                                              contexts.nicolaas.user.id
                                            );
                                            assert.isNotOk(updatedContentObject.downloadPath);

                                            // Check the new name and description come back
                                            checkNameAndDescription(
                                              contexts,
                                              contentObject.id,
                                              'New Test Content 2',
                                              'New test content description 2',
                                              () => {
                                                // Try updating it as non-manager of the content
                                                updateContent(
                                                  asSimon,
                                                  contentObject.id,
                                                  { displayName: 'New Test Content 3' },
                                                  (error_) => {
                                                    assert.ok(error_);
                                                    assert.strictEqual(error_.code, 401);

                                                    // Check that the old values are still in place
                                                    checkNameAndDescription(
                                                      contexts,
                                                      contentObject.id,
                                                      'New Test Content 2',
                                                      'New test content description 2',
                                                      () => {
                                                        // Try updating it with a displayName that's longer than the allowed maximum size
                                                        const longDisplayName = generateRandomText(100);
                                                        updateContent(
                                                          asNico,
                                                          contentObject.id,
                                                          { displayName: longDisplayName },
                                                          (error_) => {
                                                            assert.ok(error_);
                                                            assert.strictEqual(error_.code, 400);
                                                            assert.include(error_.msg, '1000');

                                                            // Try updating it with a description that's longer than the allowed maximum size
                                                            const longDescription = generateRandomText(1000);
                                                            updateContent(
                                                              asNico,
                                                              contentObject.id,
                                                              { description: longDescription },
                                                              (error_) => {
                                                                assert.ok(error_);
                                                                assert.strictEqual(error_.code, 400);
                                                                assert.include(error_.msg, '10000');

                                                                // Verify that an empty description is accepted
                                                                updateContent(
                                                                  asNico,
                                                                  contentObject.id,
                                                                  { description: '' },
                                                                  (error_) => {
                                                                    assert.notExists(error_);

                                                                    checkNameAndDescription(
                                                                      contexts,
                                                                      contentObject.id,
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
            });
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
    const checkAccessAndLibrary = function (contexts, contentId, expectLoggedInAccess, expectAnonAccess, callback) {
      const { nicolaas, bert, simon } = contexts;
      const asNico = nicolaas.restContext;
      const asSimon = simon.restContext;
      const asBert = bert.restContext;

      // Check for the content manager
      getContent(asNico, contentId, (error, contentObject) => {
        assert.notExists(error);
        assert.ok(contentObject);

        // Check that it's part of the content manager's library
        getLibrary(asNico, nicolaas.user.id, null, 10, (error, items) => {
          assert.notExists(error);
          assert.lengthOf(items.results, 1);
          assert.strictEqual(items.results[0].id, contentId);

          // Check for the content viewer
          getContent(asSimon, contentId, (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject);

            // Check that it is part of his library
            getLibrary(asSimon, simon.user.id, null, 10, (error, items) => {
              assert.notExists(error);
              assert.lengthOf(items.results, 1);
              assert.strictEqual(items.results[0].id, contentId);

              // Check that it is visible in the manager's library
              getLibrary(asSimon, nicolaas.user.id, null, 10, (error, items) => {
                assert.notExists(error);

                if (expectLoggedInAccess) {
                  assert.lengthOf(items.results, 1);
                  assert.strictEqual(items.results[0].id, contentId);
                } else {
                  assert.lengthOf(items.results, 0);
                }

                // Check for the logged in user that's not a viewer
                getContent(asBert, contentId, (error, contentObject) => {
                  if (expectLoggedInAccess) {
                    assert.notExists(error);
                    assert.ok(contentObject);
                  } else {
                    assert.ok(error);
                    assert.isNotOk(contentObject);
                  }

                  // Check that it isn't part of his library
                  getLibrary(asBert, bert.user.id, null, 10, (error, items) => {
                    assert.notExists(error);
                    assert.lengthOf(items.results, 0);

                    // Check that it is visible in the manager's library
                    getLibrary(asBert, nicolaas.user.id, null, 10, (error, items) => {
                      assert.notExists(error);
                      if (expectLoggedInAccess) {
                        assert.lengthOf(items.results, 1);
                        assert.strictEqual(items.results[0].id, contentId);
                      } else {
                        assert.lengthOf(items.results, 0);
                      }

                      // Check for the anonymous user
                      getContent(asCambridgeAnonymousUser, contentId, (error, contentObject) => {
                        if (expectAnonAccess) {
                          assert.notExists(error);
                          assert.ok(contentObject);
                        } else {
                          assert.ok(error);
                          assert.isNotOk(contentObject);
                        }

                        // Check that it is visible in the manager's library
                        getLibrary(asCambridgeAnonymousUser, nicolaas.user.id, null, 10, (error, items) => {
                          assert.notExists(error);
                          if (expectAnonAccess) {
                            assert.lengthOf(items.results, 1);
                            assert.strictEqual(items.results[0].id, contentId);
                          } else {
                            assert.lengthOf(items.results, 0);
                          }

                          callback();
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
    };

    /**
     * Test that will exercise the visibility part of the updateContentMetadata function for content. This test will create a public
     * content item, try to give it a non-existing visibility, then make it visible to logged in users, then make it private and
     * then try to change the visibility as a non-manager. After all of those, we check if the manager, viewer, logged in user and
     * anonymous user have access as expected.
     */
    it('verify update content visibility', (callback) => {
      // Create a piece of content
      setUpUsers((contexts) => {
        const { nicolaas, simon } = contexts;
        const asNico = nicolaas.restContext;
        const asSimon = simon.restContext;

        createLink(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Share the content with one viewer
            shareContent(asNico, contentObject.id, [simon.user.id], (error_) => {
              assert.notExists(error_);

              // Check that all of these can get the content as expected, check library presence as expected
              checkAccessAndLibrary(contexts, contentObject.id, true, true, () => {
                // Try an invalid update
                updateContent(asNico, contentObject.id, { visibility: null }, (error_) => {
                  assert.ok(error_);

                  // Check that the access remains unchanged
                  checkAccessAndLibrary(contexts, contentObject.id, true, true, () => {
                    // Try an unknown visibility update
                    updateContent(asNico, contentObject.id, { visibility: 'unknown-option' }, (error_) => {
                      assert.ok(error_);

                      // Check that the access remains unchanged
                      checkAccessAndLibrary(contexts, contentObject.id, true, true, () => {
                        // Make the content logged in only
                        updateContent(asNico, contentObject.id, { visibility: LOGGEDIN }, (error_) => {
                          assert.notExists(error_);

                          // Check that everyone can get the content as expected, check library presence as expected
                          checkAccessAndLibrary(contexts, contentObject.id, true, false, () => {
                            // Make the content private
                            updateContent(asNico, contentObject.id, { visibility: PRIVATE }, (error_) => {
                              assert.notExists(error_);

                              // Check that everyone can get the content as expected, check library presence as expected
                              checkAccessAndLibrary(contexts, contentObject.id, false, false, () => {
                                // Try update as non-manager
                                updateContent(asSimon, contentObject.id, { visibility: PUBLIC }, (error_) => {
                                  assert.ok(error_);

                                  // Check that everyone can get the content as expected, check library presence as expected
                                  checkAccessAndLibrary(contexts, contentObject.id, false, false, callback);
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
          }
        );
      });
    });

    /**
     * Test that verifies that links can be successfully updated
     */
    it('verify link update validation', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: homer } = users;
        const asHomer = homer.restContext;

        createLink(
          asHomer,
          {
            displayName: 'display name',
            description: 'description',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Sanity check updates
            const newLink = 'http://www.google.com';
            updateContent(asHomer, contentObject.id, { link: newLink }, (error, updatedContentObject) => {
              assert.notExists(error);
              assert.strictEqual(updatedContentObject.link, newLink);

              // Test invalid links
              updateContent(asHomer, contentObject.id, { link: 'invalid link' }, (error /* , updatedContentObj */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 400);

                // Empty link
                updateContent(asHomer, contentObject.id, { link: '' }, (error /* , updatedContentObj */) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 400);

                  // Super long link
                  let longUrl = 'http://www.oaeproject.org/';
                  for (let i = 0; i < 2500; i++) {
                    longUrl += 'a';
                  }

                  updateContent(asHomer, contentObject.id, { link: longUrl }, (error /* , updatedContentObj */) => {
                    assert.ok(error);
                    assert.strictEqual(error.code, 400);

                    // Sanity check that it's still pointing to google
                    getContent(asHomer, contentObject.id, (error, retrievedContentObject) => {
                      assert.notExists(error);
                      assert.strictEqual(retrievedContentObject.link, newLink);

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
     * Test that verifies you cannot update the link property on non-link content items
     */
    it('verify the link property cannot be updated on non-link content items', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas: homer } = contexts;
        const asHomer = homer.restContext;

        createFile(
          asHomer,
          {
            displayName: 'Test Content 2',
            description: 'Test content description 2',
            visibility: PUBLIC,
            file: getFileStream,
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            updateContent(
              asHomer,
              contentObject.id,
              { link: 'http://www.google.com' },
              (error /* , updatedContentObj */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 400);

                createCollabDoc(
                  asHomer,
                  'Test Content 1',
                  'Test content description 1',
                  PUBLIC,
                  NO_MANAGERS,
                  NO_EDITORS,
                  NO_VIEWERS,
                  NO_FOLDERS,
                  (error, contentObject) => {
                    assert.notExists(error);
                    assert.ok(contentObject);

                    updateContent(
                      asHomer,
                      contentObject.id,
                      { link: 'http://www.google.com' },
                      (error /* , updatedContentObj */) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 400);

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
    it('verify file update validation', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, simon } = contexts;
        const asNico = nicolaas.restContext;
        const asSimon = simon.restContext;

        createLink(
          asNico,
          {
            displayName: 'Test Content 2',
            description: 'Test content description 2',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            updateFileBody(asNico, contentObject.id, getOAELogoStream, (error_) => {
              assert.strictEqual(error_.code, 400);

              createFile(
                asNico,
                {
                  displayName: 'Test Content 2',
                  description: 'Test content description 2',
                  visibility: PUBLIC,
                  file: getFileStream,
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error, contentObject) => {
                  assert.notExists(error);
                  assert.ok(contentObject.id);

                  // Try to update without uploading anything
                  updateFileBody(asNico, contentObject.id, null, (error, revision) => {
                    assert.strictEqual(error.code, 400);
                    assert.isNotOk(revision);

                    // Try to update by passing a string
                    updateFileBody(asNico, contentObject.id, 'haha, no actual file body', (error__) => {
                      assert.strictEqual(error__.code, 400);

                      // Try to update something with an invalid ID
                      updateFileBody(asNico, 'invalid-id', getOAELogoStream, (error__) => {
                        assert.strictEqual(error__.code, 400);

                        // Try updating as a non-related person
                        updateFileBody(asSimon, contentObject.id, getOAELogoStream, (error__) => {
                          assert.strictEqual(error__.code, 401);

                          shareContent(asNico, contentObject.id, [simon.user.id], (error__) => {
                            assert.notExists(error__);

                            // Try updating as a non-manager
                            updateFileBody(asSimon, contentObject.id, getOAELogoStream, (error__) => {
                              assert.strictEqual(error__.code, 401);

                              // Make Simon a manager
                              const permissions = {};
                              permissions[simon.user.id] = MANAGER;
                              updateMembers(asNico, contentObject.id, permissions, (error__) => {
                                assert.notExists(error__);

                                // Ensure that the original owner can still update
                                updateFileBody(asNico, contentObject.id, getOAELogoStream, (error_) => {
                                  assert.notExists(error_);
                                  callback();
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
          }
        );
      });
    });

    /**
     * Test that verifies that files can be successfully updated
     */
    it('verify file update', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas } = contexts;
        const asNico = nicolaas.restContext;

        createFile(
          asNico,
          {
            displayName: 'Test Content 2',
            description: 'Test content description 2',
            visibility: PUBLIC,
            file: getFileStream,
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Get all the revisions
            getRevisions(asNico, contentObject.id, null, null, (error, revisions) => {
              assert.notExists(error);
              assert.isArray(revisions.results);
              assert.lengthOf(revisions.results, 1);

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
              getRevision(asNico, contentObject.id, revisions.results[0].revisionId, (error, revision) => {
                assert.notExists(error);

                assert.strictEqual(revision.filename, 'oae-video.png');
                assert.strictEqual(revision.mime, 'image/png');

                // Upload a new version
                updateFileBody(asNico, contentObject.id, getOAELogoStream, (error, updatedContentObject, response) => {
                  assert.notExists(error);
                  assert.ok(updatedContentObject);

                  // Verify the previews object has been reset
                  assert.strictEqual(updatedContentObject.previews.status, 'pending');
                  assert.lengthOf(keys(updatedContentObject.previews), 1);

                  // Verify the file information has changed
                  assert.notStrictEqual(contentObject.size, updatedContentObject.size);
                  assert.notStrictEqual(contentObject.filename, updatedContentObject.filename);
                  assert.notStrictEqual(contentObject.uri, updatedContentObject.uri);
                  assert.notStrictEqual(contentObject.downloadPath, updatedContentObject.downloadPath);
                  assert.notStrictEqual(contentObject.latestRevisionId, updatedContentObject.latestRevisionId);
                  assert.notStrictEqual(contentObject.lastModified, updatedContentObject.lastModified);

                  // Verify the backend is returning text/plain as IE9 doesn't support application/json on upload
                  assert.strictEqual(response.headers['content-type'], 'text/plain; charset=utf-8');

                  // Verify we're returning a full content profile
                  assert.ok(updatedContentObject.isManager);
                  assert.strictEqual(updatedContentObject.createdBy.id, contexts.nicolaas.user.id);
                  assert.strictEqual(updatedContentObject.createdBy.displayName, contexts.nicolaas.user.displayName);
                  assert.strictEqual(updatedContentObject.createdBy.profilePath, contexts.nicolaas.user.profilePath);

                  // Get all the revisions
                  getRevisions(asNico, contentObject.id, null, null, (error, revisions) => {
                    assert.notExists(error);
                    assert.isArray(revisions.results);
                    assert.lengthOf(revisions.results, 2);

                    // Revisions should be sorted as the most recent one first
                    getRevision(asNico, contentObject.id, revisions.results[0].revisionId, (error, revision) => {
                      assert.notExists(error);
                      assert.strictEqual(revision.revisionId, updatedContentObject.latestRevisionId);
                      assert.strictEqual(revision.filename, 'oae-logo.png');
                      assert.strictEqual(revision.mime, 'image/png');
                      assert.strictEqual(revision.downloadPath, updatedContentObject.downloadPath);

                      // Get the profile for a content item and ensure the most recent file properties are present
                      getContent(asNico, contentObject.id, (error, contentObject) => {
                        assert.notExists(error);
                        assert.strictEqual(contentObject.filename, 'oae-logo.png');
                        assert.strictEqual(contentObject.mime, 'image/png');

                        return callback();
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

  describe('Revisions', () => {
    /**
     * Test that verifies that being able to see revisions requires access to the content.
     */
    it('verify revision permissions', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, simon } = contexts;
        const asNico = nicolaas.restContext;
        const asSimon = simon.restContext;

        // Create some content with a couple of revisions
        createFile(
          asSimon,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PRIVATE,
            file: getFileStream,
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentSimon) => {
            assert.notExists(error);
            assert.ok(contentSimon);

            updateFileBody(asSimon, contentSimon.id, getOAELogoStream, (error_) => {
              assert.notExists(error_);

              getRevisions(asSimon, contentSimon.id, null, null, (error, revisionsSimon) => {
                assert.notExists(error);
                assert.lengthOf(revisionsSimon.results, 2);

                // First of all, Nico shouldn't be able to see the revisions
                getRevisions(asNico, contentSimon.id, null, null, (error, revisions) => {
                  assert.strictEqual(error.code, 401);
                  assert.isNotOk(revisions);

                  // He also can't download them
                  let path = temp.path();
                  download(asNico, contentSimon.id, revisionsSimon.results[1].revisionId, path, (error, body) => {
                    assert.strictEqual(error.code, 401);
                    assert.isNotOk(body);

                    // Nico creates a piece of content
                    createLink(
                      asNico,
                      {
                        displayName: 'Apereo Foundation',
                        description: 'The Apereo Foundation',
                        visibility: PRIVATE,
                        link: 'http://www.apereo.org/',
                        managers: NO_MANAGERS,
                        viewers: NO_VIEWERS,
                        folders: NO_FOLDERS
                      },
                      (error, contentNico) => {
                        assert.notExists(error);

                        /**
                         *  Nico should not be able to download a revision of Simon's file
                         *  by using one of his own content ID's and one of simon's revision ID he got (somehow)
                         */
                        path = temp.path();
                        download(asNico, contentNico.id, revisionsSimon.results[1].revisionId, path, (error, body) => {
                          assert.strictEqual(error.code, 400);
                          assert.isNotOk(body);
                          callback();
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

    /**
     * Test that verifies validation for revsions
     */
    it('verify revision parameter validation', (callback) => {
      setUpUsers((contexts) => {
        const { simon } = contexts;
        const asSimon = simon.restContext;

        // Create some content with a couple of revisions
        createFile(
          asSimon,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PRIVATE,
            file: getFileStream,
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject);

            updateFileBody(asSimon, contentObject.id, getOAELogoStream, (error_) => {
              assert.notExists(error_);

              // Try to get the revisions with a faulty contentId
              getRevisions(asSimon, 'not-a-content-id', null, null, (error_) => {
                assert.strictEqual(error_.code, 400);

                // Get them and try downloading with a faulty revisionId.
                getRevisions(asSimon, contentObject.id, null, null, (error /* , revisions */) => {
                  assert.notExists(error);

                  const path = temp.path();
                  download(asSimon, contentObject.id, 'not-a-revision-id', path, (error /* , response */) => {
                    assert.strictEqual(error.code, 400);
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
     * Test that verifies that only a limited set of revisions can be retrieved per request.
     */
    it('verify limiting revisions retrievals', (callback) => {
      setUpUsers((contexts) => {
        const { simon } = contexts;
        const asSimon = simon.restContext;

        // Create some content with a couple of revisions
        createFile(
          asSimon,
          {
            displayName: 'Test Content',
            description: 'Test content description',
            visibility: PRIVATE,
            file: getFileStream,
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject);

            // Create 30 revisions
            const createdRevisions = [];
            const createRevisions = (callback) => {
              updateFileBody(asSimon, contentObject.id, getOAELogoStream, (error, revision) => {
                assert.notExists(error);
                createdRevisions.push(revision);

                const areThere30Revisions = compose(equals(30), length)(createdRevisions);
                if (areThere30Revisions) {
                  return callback(createdRevisions);
                }

                createRevisions(callback);
              });
            };

            createRevisions((/* createdRevisions */) => {
              // Try to get a negative amount of revisions, it should return 1 item
              getRevisions(asSimon, contentObject.id, null, -100, (error, revisions) => {
                assert.notExists(error);
                assert.lengthOf(revisions.results, 1);

                // Fetching a 100 revisions should result in an upper bound of 25
                getRevisions(asSimon, contentObject.id, null, 100, (error, revisions) => {
                  assert.notExists(error);
                  assert.lengthOf(revisions.results, 25);

                  // Assert paging.
                  getRevisions(asSimon, contentObject.id, null, 5, (error, firstPage) => {
                    assert.notExists(error);
                    assert.lengthOf(firstPage.results, 5);
                    assert.strictEqual(firstPage.nextToken, firstPage.results[4].created);

                    getRevisions(asSimon, contentObject.id, firstPage.nextToken, 5, (error, secondPage) => {
                      assert.notExists(error);
                      assert.lengthOf(secondPage.results, 5);

                      // Ensure that there are no duplicates in the revision pages.
                      forEach((secondPageRevision) => {
                        forEach((firstPageRevision) => {
                          assert.notStrictEqual(firstPageRevision.revisionId, secondPageRevision.revisionId);
                        }, firstPage.results);
                      }, secondPage.results);
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
     * Verifies that an older file can be restored.
     */
    it('verify revision restoration', (callback) => {
      setUpUsers((contexts) => {
        const { simon } = contexts;
        const asSimon = simon.restContext;

        // Create some content with a couple of revisions
        createFile(
          asSimon,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PRIVATE,
            file: getFileStream,
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject);

            updateFileBody(asSimon, contentObject.id, getOAELogoStream, (error_) => {
              assert.notExists(error_);

              // Get the revisions and restore the first one.
              getRevisions(asSimon, contentObject.id, null, null, (error, revisions) => {
                assert.notExists(error);

                // Get the url for the 'latest' version of the file
                const path = temp.path();
                download(asSimon, contentObject.id, null, path, (error, response) => {
                  assert.notExists(error);
                  assert.strictEqual(response.statusCode, 204);
                  const url = response.headers['x-accel-redirect'];

                  // Now restore the original file.
                  restoreRevision(
                    asSimon,
                    contentObject.id,
                    revisions.results[1].revisionId,
                    (error, revisionObject) => {
                      assert.notExists(error);
                      assert.ok(revisionObject);

                      // Get the url for the 'new latest' version of the file.
                      download(asSimon, contentObject.id, null, path, (error, response) => {
                        assert.notExists(error);
                        assert.strictEqual(response.statusCode, 204);
                        const latestUrl = response.headers['x-accel-redirect'];
                        assert.notStrictEqual(url, latestUrl);

                        callback();
                      });
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
    const prepareDelete = function (contexts, privacy, callback) {
      const { nicolaas, ian, anthony, stuart, simon } = contexts;
      const asNico = nicolaas.restContext;
      const asIan = ian.restContext;
      const asAnthony = anthony.restContext;

      const asSimon = simon.restContext;
      const asStuart = stuart.restContext;

      // Create a content item
      createLink(
        asNico,
        {
          displayName: 'Test Content 1',
          description: 'Test content description 1',
          visibility: privacy,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, contentObject) => {
          assert.notExists(error);
          assert.ok(contentObject.id);

          // Get the piece of content as the creator
          checkPieceOfContent(asNico, nicolaas.user.id, contentObject, true, true, true, true, () => {
            // Make a user a manager and make a user a member
            const permissions = {};
            permissions[simon.user.id] = MANAGER;
            permissions[ian.user.id] = VIEWER;
            updateMembers(asNico, contentObject.id, permissions, (error_) => {
              assert.notExists(error_);
              checkPieceOfContent(asSimon, simon.user.id, contentObject, true, true, true, true, () => {
                checkPieceOfContent(asIan, ian.user.id, contentObject, true, false, true, privacy !== PRIVATE, () => {
                  // Share the content with another user
                  shareContent(asSimon, contentObject.id, [stuart.user.id], (error_) => {
                    assert.notExists(error_);
                    checkPieceOfContent(
                      asStuart,
                      stuart.user.id,
                      contentObject,
                      true,
                      false,
                      true,
                      privacy !== PRIVATE,
                      () => {
                        // Try to delete the content as an anonymous user
                        deleteContent(asCambridgeAnonymousUser, contentObject.id, (error_) => {
                          assert.ok(error_);
                          // Check that it is still around
                          checkPieceOfContent(asNico, nicolaas.user.id, contentObject, true, true, true, true, () => {
                            // Try to delete the content as a logged in user
                            deleteContent(asAnthony, contentObject.id, (error_) => {
                              assert.ok(error_);
                              // Check that it is still around
                              checkPieceOfContent(
                                asNico,
                                nicolaas.user.id,
                                contentObject,
                                true,
                                true,
                                true,
                                true,
                                () => {
                                  // Try to delete the content as a content member
                                  deleteContent(asStuart, contentObject.id, (error_) => {
                                    assert.ok(error_);
                                    // Check that it is still around
                                    checkPieceOfContent(
                                      asNico,
                                      nicolaas.user.id,
                                      contentObject,
                                      true,
                                      true,
                                      true,
                                      true,
                                      () => {
                                        // Try to delete the content as a content manager
                                        deleteContent(asNico, contentObject.id, (error_) => {
                                          assert.notExists(error_);
                                          // Check to see if the manager, a member, a logged in user and the anonymous user still have access
                                          checkPieceOfContent(
                                            asNico,
                                            nicolaas.user.id,
                                            contentObject,
                                            false,
                                            false,
                                            false,
                                            false,
                                            () => {
                                              checkPieceOfContent(
                                                asIan,
                                                ian.user.id,
                                                contentObject,
                                                false,
                                                false,
                                                false,
                                                false,
                                                () => {
                                                  checkPieceOfContent(
                                                    asAnthony,
                                                    anthony.user.id,
                                                    contentObject,
                                                    false,
                                                    false,
                                                    false,
                                                    false,
                                                    () => {
                                                      checkPieceOfContent(
                                                        asCambridgeAnonymousUser,
                                                        nicolaas.user.id,
                                                        contentObject,
                                                        false,
                                                        false,
                                                        false,
                                                        false,
                                                        () => {
                                                          // Check roles api for the role on the content for a manager, a member and a logged in user
                                                          getAllRoles(
                                                            nicolaas.user.id,
                                                            contentObject.id,
                                                            (error, roles) => {
                                                              assert.notExists(error);
                                                              assert.isEmpty(roles);

                                                              getAllRoles(
                                                                ian.user.id,
                                                                contentObject.id,
                                                                (error, roles) => {
                                                                  assert.notExists(error);
                                                                  assert.isEmpty(roles);

                                                                  getAllRoles(
                                                                    anthony.user.id,
                                                                    contentObject.id,
                                                                    (error, roles) => {
                                                                      assert.notExists(error);
                                                                      assert.isEmpty(roles);

                                                                      // Ensure list of members is no longer accessible
                                                                      return ContentTestUtil.assertGetContentMembersFails(
                                                                        asNico,
                                                                        contentObject.id,
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
                                        });
                                      }
                                    );
                                  });
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
        }
      );
    };

    /**
     * Test that will attempt to create a public piece of content and delete it
     */
    it('verify public delete', (callback) => {
      setUpUsers((contexts) => {
        prepareDelete(contexts, PUBLIC, callback);
      });
    });

    /**
     * Test that will attempt to create a logged in piece of content and delete it
     */
    it('verify logged in delete', (callback) => {
      setUpUsers((contexts) => {
        prepareDelete(contexts, LOGGEDIN, callback);
      });
    });

    /**
     * Test that will attempt to create a private piece of content and delete it
     */
    it('verify private delete', (callback) => {
      setUpUsers((contexts) => {
        prepareDelete(contexts, PRIVATE, callback);
      });
    });

    /**
     * Verify file deletion
     */
    it('verify file delete', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas } = contexts;
        const asNico = nicolaas.restContext;

        createFile(
          asNico,
          {
            displayName: 'Test Content 2',
            description: 'Test content description 2',
            visibility: PUBLIC,
            file: getFileStream,
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Get the last revision.
            getRevisions(asNico, contentObject.id, null, 1000, (error /* , revisions */) => {
              assert.notExists(error);

              deleteContent(asNico, contentObject.id, (error_) => {
                assert.notExists(error_);

                // Get the last revision.
                getRevisions(asNico, contentObject.id, null, 1000, (error /* , revisions */) => {
                  assert.strictEqual(error.code, 404);

                  callback();
                });
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
  it("verify collabdoc or collabsheet editors can't delete", (callback) => {
    setUpUsers((contexts) => {
      const { nicolaas, stuart } = contexts;
      const asNico = nicolaas.restContext;
      const asStuart = stuart.restContext;

      createCollabDoc(
        asNico,
        'Test CollabDoc',
        'Doc description',
        PUBLIC,
        NO_MANAGERS,
        [stuart.user.id],
        NO_VIEWERS,
        NO_FOLDERS,
        (error, contentObject) => {
          assert.notExists(error);
          deleteContent(asStuart, contentObject.id, (error_) => {
            assert.strictEqual(error_.code, 401);

            deleteContent(asNico, contentObject.id, (error_) => {
              assert.notExists(error_);

              createCollabsheet(
                asNico,
                'Test collabsheet',
                'Description',
                PUBLIC,
                NO_MANAGERS,
                [contexts.stuart.user.id],
                NO_VIEWERS,
                NO_FOLDERS,
                (error, contentObject) => {
                  assert.notExists(error);
                  deleteContent(asStuart, contentObject.id, (error__) => {
                    assert.strictEqual(error__.code, 401);

                    deleteContent(asNico, contentObject.id, (error_) => {
                      assert.notExists(error_);
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
    const setUpContentPermissions = function (contexts, privacy, callback) {
      const { nicolaas, stuart } = contexts;
      const asNico = nicolaas.restContext;

      // Create a public content item
      createLink(
        asNico,
        {
          displayName: 'Test Content 1',
          description: 'Test content description 1',
          visibility: privacy,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, contentObject) => {
          assert.notExists(error);
          assert.ok(contentObject.id);

          // Get the piece of content as the person who created the content
          checkPieceOfContent(asNico, nicolaas.user.id, contentObject, true, true, true, true, () => {
            // Make another user viewer of the content
            const permissions = {};
            permissions[stuart.user.id] = VIEWER;

            return assertUpdateContentMembersSucceeds(asNico, asNico, contentObject.id, permissions, () => {
              return callback(contentObject);
            });
          });
        }
      );
    };

    /**
     * Test that will attempt to set permissions on a public piece of content
     */
    it('verify public content permissions', (callback) => {
      setUpUsers((contexts) => {
        const { branden, nicolaas } = contexts;
        const asBranden = branden.restContext;

        setUpContentPermissions(contexts, PUBLIC, (contentObject) => {
          // Get the piece of content as a non-associated user
          checkPieceOfContent(asBranden, branden.user.id, contentObject, true, false, false, true, () => {
            // Get the piece of content as an anonymous user
            checkPieceOfContent(
              asCambridgeAnonymousUser,
              nicolaas.user.id,
              contentObject,
              true,
              false,
              true,
              false,
              callback
            );
          });
        });
      });
    });

    /**
     * Test that will attempt to set permissions on a loggedin piece of content
     */
    it('verify logged in content permissions', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, branden } = contexts;
        const asBranden = branden.restContext;

        setUpContentPermissions(contexts, LOGGEDIN, (contentObject) => {
          // Get the piece of content as a non-associated user
          checkPieceOfContent(asBranden, branden.user.id, contentObject, true, false, false, true, () => {
            // Get the piece of content as an anonymous user
            checkPieceOfContent(
              asCambridgeAnonymousUser,
              nicolaas.user.id,
              contentObject,
              false,
              false,
              false,
              false,
              callback
            );
          });
        });
      });
    });

    /**
     * Test that will attempt to set permissions on a private piece of content
     */
    it('verify private content permissions', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, branden } = contexts;
        const asBranden = branden.restContext;

        setUpContentPermissions(contexts, PRIVATE, (contentObject) => {
          // Get the piece of content as a non-associated user
          checkPieceOfContent(asBranden, branden.user.id, contentObject, false, false, false, false, () => {
            // Get the piece of content as an anonymous user
            checkPieceOfContent(
              asCambridgeAnonymousUser,
              nicolaas.user.id,
              contentObject,
              false,
              false,
              false,
              false,
              callback
            );
          });
        });
      });
    });

    /**
     * Test that will attempt to set permissions on multiple principals at once. It will add permissions and
     * remove permissions on sets of principals that have all valid principals and some with non-valid principals
     */
    it('verify multiple content permissions', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, ian, anthony, stuart, simon } = contexts;
        const asNico = nicolaas.restContext;

        // Create a content item
        createLink(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Set permission on multiple people at the same time (managers and members)
            let permissions = {};
            permissions[simon.user.id] = MANAGER;
            permissions[stuart.user.id] = VIEWER;
            permissions[ian.user.id] = VIEWER;

            assertUpdateContentMembersSucceeds(asNico, asNico, contentObject.id, permissions, () => {
              // Set permission on multiple people at same time, some remove role
              permissions = {};
              permissions[simon.user.id] = false;
              permissions[stuart.user.id] = false;
              permissions[anthony.user.id] = VIEWER;

              assertUpdateContentMembersSucceeds(asNico, asNico, contentObject.id, permissions, () => {
                // Set permission on multiple people at same time (managers and members), some invalid
                permissions = {};
                permissions[simon.user.id] = MANAGER;
                permissions[stuart.user.id] = VIEWER;
                permissions['u:cam:non-existing-user'] = VIEWER;

                assertUpdateContentMembersFails(asNico, asNico, contentObject.id, permissions, 400, () => {
                  return callback();
                });
              });
            });
          }
        );
      });
    });

    /**
     * Verifies that you cannot create ghost entities by removing all the managers of a content item.
     */
    it('verify removal of all managers is not possible', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, ian, stuart, simon } = contexts;
        const asNico = nicolaas.restContext;

        // Create a content item
        createLink(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);
            assert.ok(contentObject.id);

            // Set permission on multiple people at the same time (managers and members)
            let permissions = {};
            permissions[simon.user.id] = MANAGER;
            permissions[stuart.user.id] = VIEWER;
            permissions[ian.user.id] = VIEWER;

            updateMembers(asNico, contentObject.id, permissions, (error_) => {
              assert.notExists(error_);

              // Removing all the managers should not be allowed
              permissions = {};
              permissions[simon.user.id] = false;
              permissions[nicolaas.user.id] = false;
              updateMembers(asNico, contentObject.id, permissions, (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 400);

                // Making both of them viewer should not work either.
                permissions = {};
                permissions[simon.user.id] = VIEWER;
                permissions[nicolaas.user.id] = VIEWER;
                updateMembers(asNico, contentObject.id, permissions, (error_) => {
                  assert.strictEqual(error_.code, 400);

                  // Removing everyone should not be possible
                  permissions = {};
                  permissions[simon.user.id] = false;
                  permissions[nicolaas.user.id] = false;
                  permissions[stuart.user.id] = false;
                  permissions[ian.user.id] = false;
                  updateMembers(asNico, contentObject.id, permissions, (error_) => {
                    assert.strictEqual(error_.code, 400);

                    permissions = {};
                    permissions[simon.user.id] = VIEWER;
                    permissions[nicolaas.user.id] = false;
                    updateMembers(asNico, contentObject.id, permissions, (error_) => {
                      assert.strictEqual(error_.code, 400);
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
    it('verify validation on setting content permissions', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, simon } = contexts;
        const asNico = nicolaas.restContext;
        const asSimon = simon.restContext;

        // Create a content item
        createLink(
          asNico,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);

            const validPermissions = createRoleChange([simon.user.id], MANAGER);

            // Invalid content id
            updateMembers(asNico, 'invalidContentId', validPermissions, (error_) => {
              assert.strictEqual(error_.code, 400);

              // Missing role changes
              updateMembers(asNico, contentObject.id, {}, (error_) => {
                assert.strictEqual(error_.code, 400);

                // Invalid principal
                updateMembers(asNico, contentObject.id, { 'invalid-id': MANAGER }, (error_) => {
                  assert.strictEqual(error_.code, 400);

                  // Invalid role change
                  let permissions = createRoleChange([simon.user.id], 'totally-wrong-role');
                  updateMembers(asNico, contentObject.id, permissions, (error_) => {
                    assert.strictEqual(error_.code, 400);

                    // The value `true` is not a valid role change either
                    permissions = createRoleChange([simon.user.id], true);
                    updateMembers(asNico, contentObject.id, permissions, (error_) => {
                      assert.strictEqual(error_.code, 400);

                      // The value `editor` is only valid on collabdocs
                      permissions = createRoleChange([simon.user.id], 'editor');
                      updateMembers(asNico, contentObject.id, permissions, (error_) => {
                        assert.strictEqual(error_.code, 400);

                        // Sanity check
                        updateMembers(asNico, contentObject.id, validPermissions, (error_) => {
                          assert.notExists(error_);
                          updateContent(
                            asSimon,
                            contentObject.id,
                            { displayName: 'Sweet stuff' },
                            (error, updatedContentObject) => {
                              assert.notExists(error);
                              assert.strictEqual(updatedContentObject.displayName, 'Sweet stuff');
                              return callback();
                            }
                          );
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
     * Test that verifies that you cannot add a private user as a member
     */
    it('verify adding a private user as a member is not possible', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;

        updateUser(asMarge, marge.user.id, { visibility: PRIVATE }, (error_) => {
          assert.notExists(error_);

          createLink(
            asHomer,
            {
              displayName: 'Test Content',
              description: 'Test content description',
              visibility: PUBLIC,
              link: 'http://www.google.com',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, contentObject) => {
              assert.notExists(error);

              const update = {};
              update[marge.user.id] = MANAGER;
              updateMembers(asHomer, contentObject.id, update, (error_) => {
                assert.strictEqual(error_.code, 401);
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
    it('verify adding a private group as a member is not possible', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: nico, 1: bert } = users;
        const asBert = bert.restContext;
        const asNico = nico.restContext;

        createGroup(
          asBert,
          'Group title',
          'Group description',
          PRIVATE,
          undefined,
          NO_MANAGERS,
          NO_MEMBERS,
          (error, groupObject) => {
            assert.notExists(error);

            createLink(
              asNico,
              {
                displayName: 'Test Content',
                description: 'Test content description',
                visibility: PUBLIC,
                link: 'http://www.google.com',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, contentObject) => {
                assert.notExists(error);

                const update = {};
                update[groupObject.id] = MANAGER;
                updateMembers(asNico, contentObject.id, update, (error_) => {
                  assert.strictEqual(error_.code, 401);
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
    it('verify private users can be updated/removed as content members', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: nico, 1: bert } = users;
        const asNico = nico.restContext;
        const asBert = bert.restContext;

        createLink(
          asNico,
          {
            displayName: 'Test Content',
            description: 'Test content description',
            visibility: PUBLIC,
            link: 'http://www.google.com',
            managers: NO_MANAGERS,
            viewers: [bert.user.id],
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);

            updateUser(asBert, bert.user.id, { visibility: PRIVATE }, (error_) => {
              assert.notExists(error_);

              // Changing the role of a private user (that was already a member) should work
              const update = {};
              update[bert.user.id] = MANAGER;

              assertUpdateContentMembersSucceeds(asNico, asNico, contentObject.id, update, () => {
                // Removing a private user (that was already a member) should work
                update[bert.user.id] = false;
                return assertUpdateContentMembersSucceeds(asNico, asNico, contentObject.id, update, callback);
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that content member listings can be paged
     */
    it('verify getting content members paging', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 10, (error, users) => {
        assert.notExists(error);

        const { 0: simon } = users;
        const asSimon = simon.restContext;

        // Get the user ids for the users we'll add as members
        const members = filter(
          (user) => compose(not, equals(user.user.id), getPath(['user', 'id']))(simon),
          values(users)
        );

        const viewers = map(getPath(['user', 'id']), members);

        // Create a piece of content with 10 members (including the content creator)
        createLink(
          asSimon,
          {
            displayName: 'Test Content',
            description: 'Test content description',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);

            // Ensure paging by 3 results in 4 requests, totalling 10 total members
            ContentTestUtil.getAllContentMembers(asSimon, contentObject.id, { batchSize: 3 }, (members, responses) => {
              assert.lengthOf(members, 10);
              assert.lengthOf(responses, 4);
              assert.lengthOf(responses[0].results, 3);
              assert.lengthOf(responses[1].results, 3);
              assert.lengthOf(responses[2].results, 3);
              assert.lengthOf(responses[3].results, 1);

              return callback();
            });
          }
        );
      });
    });

    /**
     * Test that verifies that request parameters get validated when retrieving the members on a piece of content
     */
    it('verify getting content members validation', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: someUser } = users;
        const asSomeUser = someUser.restContext;

        createLink(
          asSomeUser,
          {
            displayName: 'Test Content',
            description: 'Test content description',
            visibility: PUBLIC,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);

            // Ensure invalid content ids result in 400 response
            assertGetContentMembersFails(asSomeUser, ' ', null, null, 400, () => {
              assertGetContentMembersFails(asSomeUser, 'invalid-id', null, null, 400, () => {
                // Sanity check the base parameters results in success
                assertGetContentMembersSucceeds(asSomeUser, contentObject.id, null, null, (members) => {
                  assert.lengthOf(members.results, 1);
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
    it("verify collabdoc or collabsheets editors can't change permissions", (callback) => {
      setUpUsers((contexts) => {
        const { anthony, nicolaas, stuart } = contexts;
        const asNico = nicolaas.restContext;
        const asStuart = stuart.restContext;

        createCollabDoc(
          asNico,
          'Test CollabDoc',
          'Doc description',
          PUBLIC,
          NO_MANAGERS,
          [contexts.stuart.user.id],
          NO_VIEWERS,
          NO_FOLDERS,
          (error, contentObject) => {
            assert.notExists(error);
            const members = {};
            members[anthony.user.id] = VIEWER;
            // Editor can't add new members
            assertUpdateContentMembersFails(asNico, asStuart, contentObject.id, members, 401, () => {
              assertShareContentSucceeds(asNico, asStuart, contentObject.id, keys(members), () => {
                // Make sure same is true for collaborative spreadsheets
                createCollabsheet(
                  asStuart,
                  'Test collabsheet',
                  'Sheet description',
                  PUBLIC,
                  NO_MANAGERS,
                  [contexts.nicolaas.user.id],
                  NO_VIEWERS,
                  NO_FOLDERS,
                  (error, contentObject) => {
                    assert.notExists(error);
                    const members = {};
                    members[anthony.user.id] = VIEWER;

                    assertUpdateContentMembersFails(asStuart, asNico, contentObject.id, members, 401, () => {
                      assertShareContentSucceeds(asStuart, asNico, contentObject.id, keys(members), callback);
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
     * Test that verifies setting permissions for a userId+email combination will add the user
     * as a member
     */
    it('verify setting permissions with validated user id adds it to their library', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: creatingUser, 1: targetUser } = users;
        const asCreatingUser = creatingUser.restContext;

        // Create a content item on which to set roles
        const randomString = generateRandomText(1);
        assertCreateLinkSucceeds(
          asCreatingUser,
          randomString,
          randomString,
          PUBLIC,
          'http://www.oaeproject.org',
          NO_MANAGERS,
          NO_VIEWERS,
          NO_FOLDERS,
          (content) => {
            // Set the roles of the content item
            const roleChanges = fromPairs([[format('%s:%s', targetUser.user.email, targetUser.user.id), MANAGER]]);
            assertUpdateContentMembersSucceeds(asCreatingUser, asCreatingUser, content.id, roleChanges, () => {
              return callback();
            });
          }
        );
      });
    });

    /**
     * Test that verifies setting permissions with an email associated to a unique email account
     * adds it to their library
     */
    it('verify setting permissions with an email associated to a unique email account adds it to their library', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 4, (error, users) => {
        assert.notExists(error);

        const { 0: creatingUser, 1: targetUserA, 2: targetUserB1, 3: targetUserB2 } = users;
        const asCreatingUser = creatingUser.restContext;
        const asTargetUserA = targetUserA.restContext;
        const asTargetUserB2 = targetUserB2.restContext;

        // Create a content item on which to set roles
        const randomString = generateRandomText(1);
        assertCreateLinkSucceeds(
          asCreatingUser,
          randomString,
          randomString,
          PUBLIC,
          'http://www.oaeproject.org',
          NO_MANAGERS,
          NO_VIEWERS,
          NO_FOLDERS,
          (content) => {
            // Set the roles of the content item
            let roleChanges = fromPairs([[targetUserA.user.email, MANAGER]]);
            // RestCtx, contentId, updatedMembers, callback
            updateMembers(asCreatingUser, content.id, roleChanges, (error_) => {
              assert.notExists(error_);

              // Ensure the invitations list is empty
              assertGetInvitationsSucceeds(asCreatingUser, CONTENT, content.id, (result) => {
                assert.ok(result);
                assert.isArray(result.results);
                assert.isEmpty(result.results);

                // Ensure the members library of the content item contains the target user
                getAllContentMembers(asCreatingUser, content.id, null, (members) => {
                  const targetMember = find((member) => equals(member.profile.id, targetUserA.user.id), members);
                  assert.ok(targetMember);

                  // Ensure the target user's content library contains the content item
                  assertGetAllContentLibrarySucceeds(asTargetUserA, targetUserA.user.id, null, (contentItems) => {
                    assert.ok(find(compose(equals(content.id), prop('id')), contentItems));

                    // Update the B target users to have the same emails
                    assertUpdateUserSucceeds(
                      asTargetUserB2,
                      targetUserB2.user.id,
                      { email: targetUserB1.user.email },
                      (updatedUser, token) => {
                        assertVerifyEmailSucceeds(asTargetUserB2, targetUserB2.user.id, token, () => {
                          /**
                           * Perform a regular email invitation with the same email,
                           *  ensuring it is the invitations list that updates, not the members
                           */
                          roleChanges = fromPairs([[targetUserB1.user.email, MANAGER]]);
                          assertUpdateContentMembersSucceeds(
                            asCreatingUser,
                            asCreatingUser,
                            content.id,
                            roleChanges,
                            () => {
                              return callback();
                            }
                          );
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
    const prepareSharing = function (contexts, privacy, callback) {
      // Create a content item
      createLink(
        contexts.nicolaas.restContext,
        {
          displayName: 'Test Content 1',
          description: 'Test content description 1',
          visibility: privacy,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, contentObject) => {
          assert.notExists(error);
          assert.ok(contentObject.id);
          // Get the piece of content as the creator
          checkPieceOfContent(
            contexts.nicolaas.restContext,
            contexts.nicolaas.user.id,
            contentObject,
            true,
            true,
            true,
            true,
            () => {
              return callback(contentObject);
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
    const testSharing = function (
      contentObject,
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
      shareContent(sharer.restContext, contentObject.id, [shareWith.user.id], (error) => {
        if (expectShare) {
          assert.notExists(error);
        } else {
          assert.ok(error);
        }

        checkPieceOfContent(
          shareWith.restContext,
          shareWith.user ? shareWith.user.id : null,
          contentObject,
          expectAccess,
          expectManager,
          expectInLibrary,
          expectCanShare,
          () => {
            RestAPI.Content.getMembers(shareWith.restContext, contentObject.id, null, null, (error, members) => {
              if (expectedMembers) {
                assert.notExists(error);
                assert.strictEqual(members.results.length, keys(expectedMembers).length);
                for (let m = 0; m < members.results.length; m++) {
                  assert.strictEqual(members.results[m].role, expectedMembers[members.results[m].profile.id]);
                }
              } else {
                assert.ok(error);
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
    it('verify public sharing', (callback) => {
      setUpUsers((contexts) => {
        // Create a public content item
        prepareSharing(contexts, PUBLIC, (contentObject) => {
          // Share as content owner
          const expectedMembers = {};
          expectedMembers[contexts.nicolaas.user.id] = MANAGER;
          expectedMembers[contexts.simon.user.id] = VIEWER;
          testSharing(
            contentObject,
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
              expectedMembers[contexts.anthony.user.id] = VIEWER;
              testSharing(
                contentObject,
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
                  expectedMembers[contexts.stuart.user.id] = VIEWER;
                  testSharing(
                    contentObject,
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
                        contentObject,
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
                            contentObject,
                            { restContext: asCambridgeAnonymousUser },
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
    it('verify logged in sharing', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, stuart, simon, anthony, ian } = contexts;

        // Create a loggedin content item
        prepareSharing(contexts, LOGGEDIN, (contentObject) => {
          // Share as content owner
          const expectedMembers = {};
          expectedMembers[nicolaas.user.id] = MANAGER;
          expectedMembers[simon.user.id] = VIEWER;
          testSharing(contentObject, nicolaas, simon, true, true, false, true, expectedMembers, true, () => {
            // Share as content member
            expectedMembers[anthony.user.id] = VIEWER;
            testSharing(contentObject, simon, anthony, true, true, false, true, expectedMembers, true, () => {
              // Share as other user, add to own library
              expectedMembers[stuart.user.id] = VIEWER;
              testSharing(contentObject, stuart, stuart, true, true, false, true, expectedMembers, true, () => {
                // Share with the content manager, making sure that he's still the content manager after sharing
                testSharing(contentObject, stuart, nicolaas, true, true, true, true, expectedMembers, true, () => {
                  // Share as anonymous
                  testSharing(
                    contentObject,
                    { restContext: asCambridgeAnonymousUser },
                    ian,
                    false,
                    true,
                    false,
                    false,
                    expectedMembers,
                    true,
                    callback
                  );
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that will attempt to create a private piece of content, share it as the manager, share it as a member, share it
     * as a non-related user and share it as an anonymous user. For each of those, it will check for content access, library
     * presence and the correct content membership list
     */
    it('verify private sharing', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, simon, anthony, ian, stuart } = contexts;

        // Create a private content item
        prepareSharing(contexts, PRIVATE, (contentObject) => {
          // Share as content owner
          const expectedMembers = {};
          expectedMembers[nicolaas.user.id] = MANAGER;
          expectedMembers[simon.user.id] = VIEWER;
          testSharing(contentObject, nicolaas, simon, true, true, false, true, expectedMembers, false, () => {
            // Share as content member
            testSharing(contentObject, simon, anthony, false, false, false, false, null, false, () => {
              // Share as other user, add to own library
              testSharing(contentObject, stuart, stuart, false, false, false, false, null, false, () => {
                // Share with the content manager, making sure that he's still the content manager after sharing
                testSharing(contentObject, simon, nicolaas, false, true, true, true, expectedMembers, true, () => {
                  // Share as anonymous
                  testSharing(
                    contentObject,
                    { restContext: asCambridgeAnonymousUser },
                    ian,
                    false,
                    false,
                    false,
                    false,
                    null,
                    false,
                    callback
                  );
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that will attempt to use the shareContent function with multiple people and/or groups at the same time. Invalid
     * principal ids will be added in as well.
     */
    it('verify multiple sharing', (callback) => {
      setUpUsers((contexts) => {
        const { nicolaas, simon, anthony, stuart, ian } = contexts;
        const asSimon = simon.restContext;
        const asIan = ian.restContext;
        const asStuart = stuart.restContext;
        const asAnthony = anthony.restContext;

        // Create a piece of content
        prepareSharing(contexts, PRIVATE, (contentObject) => {
          // Share with multiple people at the same time
          let toShare = [simon.user.id, ian.user.id, stuart.user.id];
          shareContent(nicolaas.restContext, contentObject.id, toShare, (error) => {
            assert.notExists(error);

            // Check that these people have access
            checkPieceOfContent(asSimon, simon.user.id, contentObject, true, false, true, false, () => {
              checkPieceOfContent(asIan, ian.user.id, contentObject, true, false, true, false, () => {
                checkPieceOfContent(asStuart, stuart.user.id, contentObject, true, false, true, false, () => {
                  checkPieceOfContent(
                    asAnthony,
                    contexts.anthony.user.id,
                    contentObject,
                    false,
                    false,
                    false,
                    false,
                    () => {
                      // Share with multiple people, of which some are invalid users
                      toShare = [contexts.anthony.user.id, 'u:cam:nonExistingUser'];
                      shareContent(contexts.nicolaas.restContext, contentObject.id, toShare, (error) => {
                        assert.ok(error);
                        checkPieceOfContent(
                          contexts.anthony.restContext,
                          contexts.anthony.user.id,
                          contentObject,
                          false,
                          false,
                          false,
                          false,
                          callback
                        );
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

    /**
     * Test that verifies sharing a content item results in a user being added to the content
     * members library both on-the-fly and when the library is rebuilt from scratch
     */
    it('verify sharing adds users to content members library', (callback) => {
      // Create users to test with
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: actor } = users;
        const asActor = actor.restContext;
        const memberIds = map(getPath(['user', 'id']), values(users)).slice(1);

        // Create a content item to share
        createLink(
          asActor,
          {
            displayName: 'Test Content 1',
            description: 'Test content description 1',
            visibility: PRIVATE,
            link: 'http://www.oaeproject.org/',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Ensure sharing the content item is successful
            return assertShareContentSucceeds(asActor, asActor, link.id, memberIds, callback);
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
    const testGroupAccess = function (contexts, groups, privacy, callback) {
      const { anthony, nicolaas, bert, stuart, branden, simon } = contexts;
      const asAnthony = anthony.restContext;
      const asBert = bert.restContext;
      const asNico = nicolaas.restContext;
      const asSimon = simon.restContext;
      const asStuart = stuart.restContext;
      const asBranden = branden.restContext;

      const aintPrivate = compose(not, equals(PRIVATE))(privacy);

      // Anthony creates a content item
      createLink(
        asAnthony,
        {
          displayName: 'Test Content 1',
          description: 'Test content description 1',
          visibility: privacy,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, contentObject) => {
          assert.notExists(error);
          assert.ok(contentObject.id);

          // Set permissions on content --> Make UI dev team member, make Simon a member
          let permissions = {};
          permissions[groups[UI_TEAM].id] = VIEWER;
          permissions[simon.user.id] = VIEWER;
          updateMembers(asAnthony, contentObject.id, permissions, (error_) => {
            assert.notExists(error_);
            // Check that UI Dev Team, Bert, Nico and Simon have member access
            checkPieceOfContent(asBert, groups[UI_TEAM].id, contentObject, true, false, true, aintPrivate, () => {
              checkPieceOfContent(asNico, nicolaas.user.id, contentObject, true, false, false, aintPrivate, () => {
                checkPieceOfContent(asBert, bert.user.id, contentObject, true, false, false, aintPrivate, () => {
                  // Check that it shows in UI Dev Team's library
                  getLibrary(asNico, groups[UI_TEAM].id, null, 10, (error, contentItems) => {
                    assert.notExists(error);
                    assert.lengthOf(contentItems.results, 1);
                    assert.strictEqual(contentItems.results[0].id, contentObject.id);
                    // Check that it shows in Simon's library
                    getLibrary(asSimon, simon.user.id, null, 10, (error, contentItems) => {
                      assert.notExists(error);
                      assert.lengthOf(contentItems.results, 1);
                      assert.strictEqual(contentItems.results[0].id, contentObject.id);
                      // Check that it doesn't show in Nico's library
                      getLibrary(asNico, nicolaas.user.id, null, 10, (error, contentItems) => {
                        assert.notExists(error);
                        assert.isEmpty(contentItems.results);
                        // Check that it doesn't show in Bert's library
                        getLibrary(asBert, bert.user.id, null, 10, (error, contentItems) => {
                          assert.notExists(error);
                          assert.isEmpty(contentItems.results);
                          // Check that it doesn't show in OAE Team's and Back-end team's library
                          getLibrary(asAnthony, groups[BACKEND_TEAM].id, null, 10, (error, contentItems) => {
                            assert.notExists(error);
                            assert.isEmpty(contentItems.results);
                            getLibrary(asAnthony, groups[OAE_TEAM].id, null, 10, (error, contentItems) => {
                              assert.notExists(error);
                              assert.isEmpty(contentItems.results);
                              // Check that Stuart doesn't have access
                              checkPieceOfContent(
                                asStuart,
                                stuart.user.id,
                                contentObject,
                                aintPrivate,
                                false,
                                false,
                                aintPrivate,
                                () => {
                                  // Check that Branden doesn't have access
                                  checkPieceOfContent(
                                    asBranden,
                                    branden.user.id,
                                    contentObject,
                                    aintPrivate,
                                    false,
                                    false,
                                    aintPrivate,
                                    () => {
                                      // Share with the OAE Team group
                                      shareContent(asAnthony, contentObject.id, [groups[OAE_TEAM].id], (error_) => {
                                        assert.notExists(error_);
                                        // Check that Stuart has access
                                        checkPieceOfContent(
                                          asStuart,
                                          stuart.user.id,
                                          contentObject,
                                          true,
                                          false,
                                          false,
                                          aintPrivate,
                                          () => {
                                            // Check that Branden has access
                                            checkPieceOfContent(
                                              asBranden,
                                              branden.user.id,
                                              contentObject,
                                              true,
                                              false,
                                              false,
                                              aintPrivate,
                                              () => {
                                                // Check that it shows in OAE Team and UI Dev team's library and not in the Back-End Team's library
                                                getLibrary(
                                                  asAnthony,
                                                  groups[OAE_TEAM].id,
                                                  null,
                                                  10,
                                                  (error, contentItems) => {
                                                    assert.notExists(error);
                                                    assert.lengthOf(contentItems.results, 1);
                                                    assert.strictEqual(contentItems.results[0].id, contentObject.id);
                                                    getLibrary(
                                                      asNico,
                                                      groups[UI_TEAM].id,
                                                      null,
                                                      10,
                                                      (error, contentItems) => {
                                                        assert.notExists(error);
                                                        assert.lengthOf(contentItems.results, 1);
                                                        assert.strictEqual(
                                                          contentItems.results[0].id,
                                                          contentObject.id
                                                        );
                                                        getLibrary(
                                                          asSimon,
                                                          groups[BACKEND_TEAM].id,
                                                          null,
                                                          10,
                                                          (error, contentItems) => {
                                                            assert.notExists(error);
                                                            assert.isEmpty(contentItems.results);

                                                            // Make Back-end team manager
                                                            permissions = {};
                                                            permissions[groups[BACKEND_TEAM].id] = MANAGER;
                                                            updateMembers(
                                                              asAnthony,
                                                              contentObject.id,
                                                              permissions,
                                                              (error_) => {
                                                                assert.notExists(error_);
                                                                // Check that Simon and Branden are manager, check that Stuart is not a manager
                                                                checkPieceOfContent(
                                                                  asSimon,
                                                                  simon.user.id,
                                                                  contentObject,
                                                                  true,
                                                                  true,
                                                                  true,
                                                                  true,
                                                                  () => {
                                                                    checkPieceOfContent(
                                                                      asBranden,
                                                                      branden.user.id,
                                                                      contentObject,
                                                                      true,
                                                                      true,
                                                                      false,
                                                                      true,
                                                                      () => {
                                                                        checkPieceOfContent(
                                                                          asStuart,
                                                                          stuart.user.id,
                                                                          contentObject,
                                                                          true,
                                                                          false,
                                                                          false,
                                                                          aintPrivate,
                                                                          () => {
                                                                            // Remove permission for Back-end team manager and OAE Team
                                                                            permissions = {};
                                                                            permissions[
                                                                              groups[BACKEND_TEAM].id
                                                                            ] = false;
                                                                            permissions[groups[OAE_TEAM].id] = false;
                                                                            updateMembers(
                                                                              asAnthony,
                                                                              contentObject.id,
                                                                              permissions,
                                                                              (error_) => {
                                                                                assert.notExists(error_);
                                                                                // Check that Branden no longer has access, but Simon and Nico still do
                                                                                checkPieceOfContent(
                                                                                  asNico,
                                                                                  nicolaas.user.id,
                                                                                  contentObject,
                                                                                  true,
                                                                                  false,
                                                                                  false,
                                                                                  aintPrivate,
                                                                                  () => {
                                                                                    checkPieceOfContent(
                                                                                      asSimon,
                                                                                      simon.user.id,
                                                                                      contentObject,
                                                                                      true,
                                                                                      false,
                                                                                      true,
                                                                                      aintPrivate,
                                                                                      () => {
                                                                                        checkPieceOfContent(
                                                                                          asBranden,
                                                                                          branden.user.id,
                                                                                          contentObject,
                                                                                          aintPrivate,
                                                                                          false,
                                                                                          false,
                                                                                          aintPrivate,
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
            });
          });
        }
      );
    };

    /**
     * Test that will verify group-related access for public content
     */
    it('verify public content group access', (callback) => {
      setUpUsers((contexts) => {
        setUpGroups(contexts, (groups) => {
          testGroupAccess(contexts, groups, PUBLIC, callback);
        });
      });
    });

    /**
     * Test that will verify group-related access for logged in content
     */
    it('verify logged in content group access', (callback) => {
      setUpUsers((contexts) => {
        setUpGroups(contexts, (groups) => {
          testGroupAccess(contexts, groups, LOGGEDIN, callback);
        });
      });
    });

    /**
     * Test that will verify group-related access for private content
     */
    it('verify private content group access', (callback) => {
      setUpUsers((contexts) => {
        setUpGroups(contexts, (groups) => {
          testGroupAccess(contexts, groups, PRIVATE, callback);
        });
      });
    });
  });
});
