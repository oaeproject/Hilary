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
import { describe, it, before, afterEach, beforeEach } from 'mocha';
import fs from 'fs';
import path from 'path';
import { format } from 'util';

import { ActivityConstants } from 'oae-activity/lib/constants';
import * as ActivityTestsUtil from 'oae-activity/lib/test/util';
import * as ActivityDAO from 'oae-activity/lib/internal/dao';
import * as AuthzUtil from 'oae-authz/lib/util';
import * as Cassandra from 'oae-util/lib/cassandra';
import * as EmailTestsUtil from 'oae-email/lib/test/util';
import * as FollowingTestsUtil from 'oae-following/lib/test/util';
import PreviewConstants from 'oae-preview-processor/lib/constants';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as RestUtil from 'oae-rest/lib/util';
import * as TestsUtil from 'oae-tests';

import * as ContentTestUtil from 'oae-content/lib/test/util';
import * as Etherpad from 'oae-content/lib/internal/etherpad';

import { filter, equals, not, find, pathSatisfies } from 'ramda';

const { followByAll } = FollowingTestsUtil;
const { rowToHash, runQuery } = Cassandra;
const { getResourceFromId } = AuthzUtil;
const { getActivities } = ActivityDAO;
const { assertUpdateUserSucceeds } = PrincipalsTestUtil;
const { follow } = RestAPI.Following;
const { setGroupMembers, createGroup } = RestAPI.Group;
const { updateUser, uploadPicture } = RestAPI.User;
const { loginOnTenant } = RestAPI.Admin;
const {
  createFile,
  restoreRevision,
  createLink,
  setPreviewItems,
  joinCollabDoc,
  updateContent,
  getRevision,
  getRevisions,
  createComment,
  shareContent,
  updateFileBody,
  updateMembers,
  createCollabDoc
} = RestAPI.Content;
const { publishCollabDoc } = ContentTestUtil;
const {
  assertFeedDoesNotContainActivity,
  collectAndGetNotificationStream,
  assertActivity,
  assertFeedContainsActivity,
  collectAndGetActivityStream
} = ActivityTestsUtil;

const { collectAndFetchAllEmails } = EmailTestsUtil;

const {
  objectifySearchParams,
  generateTestUsers,
  generateTestUserId,
  generateTestGroups,
  createTenantRestContext,
  createTenantAdminRestContext,
  createGlobalAdminRestContext,
  setupMultiTenantPrivacyEntities
} = TestsUtil;

const NO_FOLDERS = [];
const NOT_JOINABLE = 'no';
const NO_MANAGERS = [];
const NO_MEMBERS = [];
const NO_VIEWERS = [];
const NO_EDITORS = [];
const PUBLIC = 'public';
const PRIVATE = 'private';
const LOGGED_IN = 'loggedin';

describe('Content Activity', () => {
  // Rest contexts that can be used for performing REST requests
  let asCambridgeTenantAdmin = null;
  let asGeorgiaTechAnonymousUser = null;
  let asGlobalAdmin = null;

  let suitableFiles = null;
  let suitableSizes = null;

  /**
   * Function that will fill up the tenant admin and anymous rest context
   */
  before((callback) => {
    // Prepare the rest contexts that can be used for performing REST requests
    asGeorgiaTechAnonymousUser = createTenantRestContext(global.oaeTests.tenants.gt.host);
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    asGlobalAdmin = createGlobalAdminRestContext();

    // An object that adheres to the RestAPI.Content.setPreviewItems.files parameter.
    // We need 4 different files here as request.js mixes up the filenames.
    suitableFiles = {
      'file.small.jpg': getFunctionThatReturnsFileStream('apereo-conference-2013.jpeg'),
      'file.medium.jpg': getFunctionThatReturnsFileStream('apereo.jpg'),
      'thumbnail.png': getFunctionThatReturnsFileStream('oae-logo.png'),
      'wide.png': getFunctionThatReturnsFileStream('oae-video.png')
    };
    suitableSizes = {
      'file.small.jpg': 'small',
      'file.medium.jpg': 'medium',
      'thumbnail.png': 'thumbnail',
      'wide.png': 'wide'
    };

    callback();
  });

  /**
   * Drain the email queue
   */
  beforeEach((callback) => {
    EmailTestsUtil.clearEmailCollections(callback);
  });

  /**
   * Set up some users and groups. One of the users will follow another user
   *
   * @param  {Function}   callback            Standard callback function
   */
  const _setup = function (callback) {
    // Generate some users
    generateTestUsers(asCambridgeTenantAdmin, 7, (error, users) => {
      assert.notExists(error);

      const { 0: homer, 1: marge, 2: bart, 3: lisa, 4: maggie, 5: abraham, 6: apu } = users;
      const asHomer = homer.restContext;
      const asMarge = marge.restContext;

      // Generate some groups
      generateTestGroups(asHomer, 2, (error, groups) => {
        assert.notExists(error);

        const { 0: groupA, 1: groupB } = groups;
        // Add regular members in both groups
        const groupAMembers = {};
        groupAMembers[abraham.user.id] = 'member';

        setGroupMembers(asHomer, groupA.group.id, groupAMembers, (error_) => {
          assert.notExists(error_);

          const groupBMembers = {};
          groupBMembers[apu.user.id] = 'member';

          setGroupMembers(asHomer, groupB.group.id, groupBMembers, (error_) => {
            assert.notExists(error_);

            // Marge follows Homer
            follow(asMarge, homer.user.id, (error_) => {
              assert.notExists(error_);

              return callback(homer, marge, bart, lisa, maggie, abraham, apu, groupA, groupB);
            });
          });
        });
      });
    });
  };

  /*!
   * Get the activity from the stream with the given criteria
   *
   * @param  {ActivityStream}    activityStream      The stream to search
   * @param  {String}            activityType        The type of activity to find
   * @param  {String}            entityType          The type of entity to apply the criteria (one of actor, object or target)
   * @param  {String}            entityOaeId         The oae:id of the entity to search
   * @return {Activity}                              An activity from the stream that matches the provided criteria
   */
  const _getActivity = function (activityStream, activityType, entityType, entityOaeId) {
    if (not(activityStream)) {
      return null;
    }

    return find((activity) => {
      return (
        pathSatisfies(Boolean, [entityType], activity) &&
        pathSatisfies(equals(activityType), ['oae:activityType'], activity) &&
        pathSatisfies(equals(entityOaeId, ['entityType', 'oae:id'], activity))
      );
    }, activityStream.items);
  };

  /*!
   * Get the email from the email list with the given to address
   *
   * @param  {Object[]}          emails              The emails to search
   * @param  {String}            to                  The email address to which the email should be sent
   * @return {Object}                                The first email from the email list that matches the to address
   */
  const _getEmail = (emails, to) => {
    return find((email) => equals(to, email.to[0].address), emails);
  };

  /**
   * Returns a function that will return a stream that points to the specified file.
   * That function can then be passed into those RestAPI methods which need to upload a file
   *
   * @param  {String}     filename    The file in the tests/data directory that should be returned as a stream.
   * @return {Function}               A function that returns a stream when executed.
   */
  const getFunctionThatReturnsFileStream = (filename) => {
    return function () {
      const file = path.join(__dirname, `/data/${filename}`);
      return fs.createReadStream(file);
    };
  };

  describe('Routes', () => {
    /**
     * Test that verifies a content resource routes activities to its members when created, updated and shared
     */
    it('verify routing to content members', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;

        // Create the group that will be a viewer of the content
        createGroup(
          asCambridgeTenantAdmin,
          'Viewer Group displayName',
          'Viewer Group Description',
          PUBLIC,
          NOT_JOINABLE,
          NO_MANAGERS,
          NO_MEMBERS,
          (error, viewerGroup) => {
            assert.notExists(error);

            // Create a group that will be a manager of the content
            createGroup(
              asCambridgeTenantAdmin,
              'Manager Group displayName',
              'Manager Group Description',
              PUBLIC,
              NOT_JOINABLE,
              NO_MANAGERS,
              NO_MEMBERS,
              (error, managerGroup) => {
                assert.notExists(error);

                // Bart (managerGroupMember) should be a member of the manager group to verify indirect group member routing
                const membership = {};
                membership[bart.user.id] = 'manager';

                setGroupMembers(asCambridgeTenantAdmin, managerGroup.id, membership, (error_) => {
                  assert.notExists(error_);

                  // Create a content item with manager group and viewer group as members.
                  createLink(
                    asHomer,
                    {
                      displayName: 'Google',
                      description: 'Google',
                      visibility: PUBLIC,
                      link: 'http://www.google.ca',
                      managers: [managerGroup.id],
                      viewers: [viewerGroup.id],
                      folders: NO_FOLDERS
                    },
                    (error, link) => {
                      assert.notExists(error);

                      // Share the content item with jane
                      shareContent(asHomer, link.id, [marge.user.id], (error_) => {
                        assert.notExists(error_);

                        // Update the content item
                        updateContent(asHomer, link.id, { description: 'Super awesome link' }, (error_) => {
                          assert.notExists(error_);

                          // Verify Jack got the create, share and update as he was the actor for all of them
                          collectAndGetActivityStream(asHomer, homer.user.id, null, (error, activityStream) => {
                            assert.notExists(error);
                            assert.ok(_getActivity(activityStream, 'content-create', 'object', link.id));
                            assert.ok(_getActivity(activityStream, 'content-share', 'target', marge.user.id));
                            assert.ok(_getActivity(activityStream, 'content-update', 'object', link.id));

                            // Verify the manager group received the create, share and update as they are a content member
                            collectAndGetActivityStream(
                              asCambridgeTenantAdmin,
                              managerGroup.id,
                              null,
                              (error, activityStream) => {
                                assert.notExists(error);
                                assert.ok(_getActivity(activityStream, 'content-create', 'object', link.id));
                                assert.ok(_getActivity(activityStream, 'content-share', 'target', marge.user.id));
                                assert.ok(_getActivity(activityStream, 'content-update', 'object', link.id));

                                // Verify the viewer group received only the create and update. only managers care about the sharing of the "object"
                                collectAndGetActivityStream(
                                  asCambridgeTenantAdmin,
                                  viewerGroup.id,
                                  null,
                                  (error, activityStream) => {
                                    assert.notExists(error);
                                    assert.ok(_getActivity(activityStream, 'content-create', 'object', link.id));
                                    assert.isNotOk(
                                      _getActivity(activityStream, 'content-share', 'target', marge.user.id)
                                    );
                                    assert.ok(_getActivity(activityStream, 'content-update', 'object', link.id));

                                    // Verify the manager group *member* got the same activities as the manager group, as they are a member
                                    collectAndGetActivityStream(
                                      asCambridgeTenantAdmin,
                                      bart.user.id,
                                      null,
                                      (error, activityStream) => {
                                        assert.notExists(error);
                                        assert.ok(_getActivity(activityStream, 'content-create', 'object', link.id));
                                        assert.ok(
                                          _getActivity(activityStream, 'content-share', 'target', marge.user.id)
                                        );
                                        assert.ok(_getActivity(activityStream, 'content-update', 'object', link.id));

                                        return callback();
                                      }
                                    );
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
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies when an activity is routed to a user that isn't in the routes of a private content item (e.g., content-share
     * when non-manager), the content item is still propagated to the route appropriately.
     */
    it('verify content propagation to non-route activity feeds', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: homer } = users;

        // Create a private content item
        createLink(
          asCambridgeTenantAdmin,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PRIVATE,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            /** Share the content item with Jack. Jack will get the activity in his feed because he is the target, but he will not be in
             * the routes of the content item because he is not a manager. Despite this, we need to verify that Jack has the full content
             * item propagated to him as he does have access to it.
             */
            shareContent(asCambridgeTenantAdmin, link.id, [homer.user.id], (error_) => {
              assert.notExists(error_);

              collectAndGetActivityStream(asCambridgeTenantAdmin, homer.user.id, null, (error, activityStream) => {
                assert.notExists(error);
                assert.ok(activityStream);

                // Ensure that the sensitive content info is available in jack's feed
                const { object } = activityStream.items[0];
                assert.strictEqual(object['oae:visibility'], 'private');
                assert.strictEqual(object['oae:resourceSubType'], 'link');
                assert.strictEqual(
                  object['oae:profilePath'],
                  '/content/' + link.tenant.alias + '/' + AuthzUtil.getResourceFromId(link.id).resourceId
                );
                assert.strictEqual(object.displayName, 'Google');

                return callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies a comment activity is routed to recent commenters of a content item.
     */
    it('verify comment activity is routed to the recent commenters of a content item', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const asBart = bart.restContext;

        // Create a content item to be commented on
        createLink(
          asHomer,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Marge is not a member, but he will comment on it
            createComment(asMarge, link.id, 'This link clearly goes to Google.', null, (error /* , margeComment */) => {
              assert.notExists(error);

              // Bart retorts!
              createComment(asBart, link.id, "You're wrong and you smell bad!", null, (error /* , bartComment */) => {
                assert.notExists(error);

                // Marge should have a notification and an activity about this because he was a recent commenter
                collectAndGetActivityStream(asMarge, marge.user.id, null, (error, activityStream) => {
                  assert.notExists(error);

                  // Should have exactly 1 activity, 2 aggregated comments
                  assert.lengthOf(activityStream.items, 1);
                  assert.lengthOf(activityStream.items[0].object['oae:collection'], 2);

                  callback();
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that a comment activity is not routed to a recent commenter if they no longer have
     * access to the content item (e.g., it becomes private after they commented).
     */
    it('verify a comment activity is not routed to a recent commenter if they no longer have access to the content item', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const asBart = bart.restContext;

        // Create a content item to be commented on, bert is a member
        createLink(
          asHomer,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: [bart.user.id],
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Marge is not a member, but he will comment on it
            createComment(asMarge, link.id, 'This link clearly goes to Google.', null, (error, margeComment) => {
              assert.notExists(error);

              // Force a collection before the content item goes private
              collectAndGetActivityStream(asMarge, marge.user.id, null, (error_) => {
                assert.notExists(error_);

                // Homer has had enough of marge's tom-foolery and makes the content item private
                updateContent(asHomer, link.id, { visibility: 'private' }, (error_) => {
                  assert.notExists(error_);

                  // Bart retorts!
                  createComment(asBart, link.id, "You're wrong and you smell bad!", null, (
                    error /* , bartComment */
                  ) => {
                    assert.notExists(error);

                    // Marge should only have the activity for the comment he made, not Bert's
                    collectAndGetActivityStream(asMarge, marge.user.id, null, (error, activityStream) => {
                      assert.notExists(error);
                      assert.lengthOf(activityStream.items, 1);
                      assert.strictEqual(activityStream.items[0].object['oae:id'], margeComment.id);

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
     * Test that verifies that profile picture URLs in the comments in the activity stream are non-expiring.
     */
    it('verify a comment activity has a non-expiring profile picture URL', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;

        /**
         * Return a profile picture stream
         *
         * @return {Stream}     A stream containing an profile picture
         */
        const getPictureStream = function () {
          const file = path.join(__dirname, '/data/profilepic.jpg');
          return fs.createReadStream(file);
        };

        // Give one of the users a profile picture
        const cropArea = { x: 0, y: 0, width: 250, height: 250 };

        uploadPicture(asMarge, marge.user.id, getPictureStream, cropArea, (error_) => {
          assert.notExists(error_);

          // Create a content item to be commented on
          createLink(
            asHomer,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              // Marge is not a member, but he will comment on it
              createComment(asMarge, link.id, 'This link clearly goes to Google.', null, (error, margeComment) => {
                assert.notExists(error);

                // marge should have a notification and an activity about this because he was a recent commenter
                collectAndGetActivityStream(asMarge, marge.user.id, null, (error, activityStream) => {
                  assert.notExists(error);

                  assert.lengthOf(activityStream.items, 1);
                  assert.strictEqual(activityStream.items[0].object['oae:id'], margeComment.id);
                  assert.ok(activityStream.items[0].object.author.image);
                  assert.ok(activityStream.items[0].object.author.image.url);
                  assert.isNotOk(activityStream.items[0].object.author.image.url.includes('expired'));

                  callback();
                });
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies that the "revision HTML" content of a content item
     * does not get persisted in activity streams
     */
    it('verify that collaborative document content is not persisted to cassandra', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;

        // Create a collaborative document with branden as a manager
        createCollabDoc(
          asHomer,
          generateTestUserId('collabdoc'),
          'description',
          PUBLIC,
          [marge.user.id],
          NO_EDITORS,
          NO_VIEWERS,
          NO_FOLDERS,
          (error, contentObject) => {
            assert.notExists(error);

            // Branden edits a couple of things and publishes the document
            joinCollabDoc(asMarge, contentObject.id, (error /* , data */) => {
              assert.notExists(error);

              const etherpadClient = Etherpad.getClient(contentObject.id);
              const args = {
                padID: contentObject.etherpadPadId,
                text: 'Ehrmagod that document!'
              };

              etherpadClient.setText(args, (error_) => {
                assert.notExists(error_);

                publishCollabDoc(contentObject.id, marge.user.id, () => {
                  // Route and aggregate the activity into branden's activity stream
                  collectAndGetActivityStream(asMarge, marge.user.id, null, (error_) => {
                    assert.notExists(error_);

                    // Query branden's activity stream to get the item that was persisted
                    const activityStreamId = format('%s#activity', marge.user.id);

                    runQuery(
                      'SELECT * FROM "ActivityStreams" WHERE "activityStreamId" = ?',
                      [activityStreamId],
                      (error, rows) => {
                        assert.notExists(error);
                        assert.lengthOf(rows, 2);

                        /**
                         * Ensure we get the revision activity, and that there is no latest revision content
                         */
                        const hash = rowToHash(rows[1]);
                        const activity = JSON.parse(hash.activity);

                        assert.strictEqual(activity['oae:activityType'], 'content-revision');
                        assert.strictEqual(activity.actor.id, marge.user.id);
                        assert.strictEqual(activity.object['oae:id'], contentObject.id);
                        assert.isNotOk(activity.object.content.latestRevision);

                        // Comment on the activity, ensuring there is no latest revision content
                        createComment(asMarge, contentObject.id, 'Comment A', null, (error /* , commentA */) => {
                          assert.notExists(error);
                          collectAndGetActivityStream(asMarge, marge.user.id, null, (error_) => {
                            assert.notExists(error_);
                            runQuery(
                              'SELECT * FROM "ActivityStreams" WHERE "activityStreamId" = ?',
                              [activityStreamId],
                              (error, rows) => {
                                assert.notExists(error);
                                assert.lengthOf(rows, 3);

                                // Ensure we get the comment activity, and that there is no latest revision content
                                const hash = rowToHash(rows[2]);
                                const activity = JSON.parse(hash.activity);

                                assert.strictEqual(activity['oae:activityType'], 'content-comment');
                                assert.strictEqual(activity.actor.id, marge.user.id);
                                assert.strictEqual(activity.target['oae:id'], contentObject.id);
                                assert.ok(!activity.target.content.latestRevision);

                                // Share the activity, ensuring there is no latest revision content
                                shareContent(asMarge, contentObject.id, [bart.user.id], (error_) => {
                                  assert.notExists(error_);

                                  collectAndGetActivityStream(asMarge, marge.user.id, null, (error_) => {
                                    assert.notExists(error_);

                                    runQuery(
                                      'SELECT * FROM "ActivityStreams" WHERE "activityStreamId" = ?',
                                      [activityStreamId],
                                      (error, rows) => {
                                        assert.notExists(error);
                                        assert.lengthOf(rows, 4);

                                        // Ensure we get the share activity, and that there is no latest revision content
                                        const hash = rowToHash(rows[3]);
                                        const activity = JSON.parse(hash.activity);

                                        assert.strictEqual(activity['oae:activityType'], 'content-share');
                                        assert.strictEqual(activity.actor.id, marge.user.id);
                                        assert.strictEqual(activity.object['oae:id'], contentObject.id);
                                        assert.isNotOk(activity.object.content.latestRevision);

                                        return callback();
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
              });
            });
          }
        );
      });
    });

    /**
     * Verifies that a notification gets sent out to all the managers of a collaborative document.
     */
    it('verify that publishing a collaborative document generates a notification', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const asBart = bart.restContext;

        // Create a collaborative document where both homer and marge are managers and bart as a viewer
        createCollabDoc(
          asHomer,
          generateTestUserId('collabdoc'),
          'description',
          PUBLIC,
          [marge.user.id],
          [],
          [bart.user.id],
          [],
          (error, contentObject) => {
            assert.notExists(error);

            joinCollabDoc(asMarge, contentObject.id, (error /* , data */) => {
              assert.notExists(error);

              // First clear emails delivered to this point
              collectAndFetchAllEmails(() => {
                // Branden edits a couple of things and publishes the document
                const etherpadClient = Etherpad.getClient(contentObject.id);
                const args = {
                  padID: contentObject.etherpadPadId,
                  text: 'Ehrmagod that document!'
                };
                etherpadClient.setText(args, (error_) => {
                  assert.notExists(error_);

                  // Let Branden publish the document
                  publishCollabDoc(contentObject.id, marge.user.id, () => {
                    // An email should be sent to homer and bart
                    collectAndFetchAllEmails((emails) => {
                      assert.strictEqual(emails.length, 2);

                      const homerEmail = _getEmail(emails, homer.user.email);
                      assert.ok(homerEmail);
                      assert.strictEqual(homerEmail.to[0].address, homer.user.email);
                      assert.strictEqual(
                        homerEmail.subject,
                        format('%s edited the document "%s"', marge.user.displayName, contentObject.displayName)
                      );
                      assert.notStrictEqual(homerEmail.html.indexOf(contentObject.profilePath), -1);

                      const bartEmail = _getEmail(emails, bart.user.email);
                      assert.ok(bartEmail);
                      assert.strictEqual(bartEmail.to[0].address, bart.user.email);
                      assert.strictEqual(
                        bartEmail.subject,
                        format('%s edited the document "%s"', marge.user.displayName, contentObject.displayName)
                      );
                      assert.notStrictEqual(bartEmail.html.indexOf(contentObject.profilePath), -1);

                      // No email should have been sent to Branden
                      const brandenEmail = _getEmail(emails, marge.user.email);
                      assert.isNotOk(brandenEmail);

                      // There should be a notification in homer's stream as he is a manager
                      collectAndGetNotificationStream(asHomer, null, (error, data) => {
                        assert.notExists(error);

                        const homerNotification = _getActivity(data, 'content-revision', 'object', contentObject.id);
                        assert.ok(homerNotification);
                        assert.strictEqual(homerNotification['oae:activityType'], 'content-revision');
                        assert.strictEqual(homerNotification.actor['oae:id'], marge.user.id);
                        assert.strictEqual(homerNotification.object['oae:id'], contentObject.id);

                        // There should be a notification in bart's stream as he is a member
                        collectAndGetNotificationStream(asBart, null, (error, data) => {
                          assert.notExists(error);

                          const bartNotification = _getActivity(data, 'content-revision', 'object', contentObject.id);
                          assert.ok(bartNotification);
                          assert.strictEqual(bartNotification['oae:activityType'], 'content-revision');
                          assert.strictEqual(bartNotification.actor['oae:id'], marge.user.id);
                          assert.strictEqual(bartNotification.object['oae:id'], contentObject.id);

                          // There should be no notification in Branden's stream as he published the change
                          collectAndGetNotificationStream(asMarge, null, (error, data) => {
                            assert.notExists(error);

                            const notificationBranden = _getActivity(
                              data,
                              'content-revision',
                              'object',
                              contentObject.id
                            );
                            assert.isNotOk(notificationBranden);

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
     * Test that verifies that an activity is generated regardless of whether there was an update to a is collaborative document since the last revision
     */
    it('verify an activity is generated regardless of whether there was an update to a is collaborative document since the last revision', (callback) => {
      ContentTestUtil.createCollabDoc(asCambridgeTenantAdmin, 2, 2, (error, collabdocData) => {
        assert.notExists(error);

        const { 0: contentObject, 2: homer, 3: marge } = collabdocData;
        const asMarge = marge.restContext;

        // Set some text in the pad
        const etherpadClient = Etherpad.getClient(contentObject.id);
        const args = {
          padID: contentObject.etherpadPadId,
          text: 'Collaborative editing by Homer and Marge! Oooooh!'
        };
        etherpadClient.setText(args, (error_) => {
          assert.notExists(error_);

          // Lets assume that both users are editting the document. First, Homer leaves
          publishCollabDoc(contentObject.id, homer.user.id, () => {
            /**
             * Now, marge leaves WITHOUT making any *extra* edits to the document. But because
             * he made edits earlier, we should still generate an activity
             */
            publishCollabDoc(contentObject.id, marge.user.id, () => {
              /**
               * Assert that there is an aggregated activity for an updated document that holds
               * both Homer and Marge as the actors
               */
              collectAndGetActivityStream(asMarge, marge.user.id, null, (error_, data) => {
                assert.notExists(error_);

                assertActivity(
                  data.items[0],
                  'content-revision',
                  'update',
                  [homer.user.id, marge.user.id],
                  contentObject.id
                );

                // Sanity-check there are 2 revisions, the initial empty one + the one "published" revision
                getRevisions(asMarge, contentObject.id, null, null, (error_, data) => {
                  assert.notExists(error_);
                  assert.lengthOf(data.results, 2);

                  // Get the latest revision
                  getRevision(asMarge, contentObject.id, data.results[0].revisionId, (error, revision) => {
                    assert.notExists(error);
                    assert.ok(revision);

                    // Assert the text is in the latest revision
                    assert.include(revision.etherpadHtml, args.text);

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
     * Verifies that a notification gets sent out to all the managers of a piece of content when restoring an older version.
     */
    it('verify that restoring a piece of content generates a notification', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart } = users;

        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const margeId = marge.user.id;
        const asBart = bart.restContext;
        const bartId = bart.user.id;

        // Create a file where both homer and marge are managers and bart as a viewer
        const name = generateTestUserId('file');
        createFile(
          asHomer,
          {
            displayName: name,
            description: 'description',
            visibility: PUBLIC,
            file: getFunctionThatReturnsFileStream('oae-video.png'),
            managers: [margeId],
            viewers: [bartId],
            folders: NO_FOLDERS
          },
          (error, content) => {
            assert.notExists(error);

            // Create a new revision
            updateFileBody(asHomer, content.id, getFunctionThatReturnsFileStream('apereo.jpg'), (error_) => {
              assert.notExists(error_);

              // Restore the original revision
              restoreRevision(asMarge, content.id, content.latestRevisionId, (error /* , revisionObj */) => {
                assert.notExists(error);

                // Verify the activity streams. All users should have received an activity
                collectAndGetActivityStream(asMarge, null, null, (error, data) => {
                  assert.notExists(error);

                  const activity = _getActivity(data, 'content-restored-revision', 'object', content.id);
                  assert.ok(activity);

                  assert.strictEqual(activity['oae:activityType'], 'content-restored-revision');
                  assert.strictEqual(activity.actor['oae:id'], margeId);
                  assert.strictEqual(activity.object['oae:id'], content.id);

                  collectAndGetActivityStream(asHomer, null, null, (error, data) => {
                    assert.notExists(error);

                    const activity = _getActivity(data, 'content-restored-revision', 'object', content.id);
                    assert.ok(activity);

                    assert.strictEqual(activity['oae:activityType'], 'content-restored-revision');
                    assert.strictEqual(activity.actor['oae:id'], margeId);
                    assert.strictEqual(activity.object['oae:id'], content.id);

                    collectAndGetActivityStream(asBart, null, null, (error, data) => {
                      assert.notExists(error);

                      const homerNotification = _getActivity(data, 'content-restored-revision', 'object', content.id);
                      assert.ok(homerNotification);

                      assert.strictEqual(homerNotification['oae:activityType'], 'content-restored-revision');
                      assert.strictEqual(homerNotification.actor['oae:id'], margeId);
                      assert.strictEqual(homerNotification.object['oae:id'], content.id);

                      // There should also be a notification in homer's stream as he is a manager
                      collectAndGetNotificationStream(asHomer, null, (error, data) => {
                        assert.notExists(error);

                        const homerNotification = _getActivity(data, 'content-restored-revision', 'object', content.id);
                        assert.ok(homerNotification);

                        assert.strictEqual(homerNotification['oae:activityType'], 'content-restored-revision');
                        assert.strictEqual(homerNotification.actor['oae:id'], margeId);
                        assert.strictEqual(homerNotification.object['oae:id'], content.id);

                        // There should be no notification in Bart's stream as he is not a manager
                        collectAndGetNotificationStream(asBart, null, (error, data) => {
                          assert.notExists(error);

                          const bartNotification = _getActivity(
                            data,
                            'content-restored-revision',
                            'object',
                            content.id
                          );
                          assert.isNotOk(bartNotification);

                          callback();
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
     * Test that verifies that content-share or content-add-to-library activities are routed to the content's activity stream
     */
    it('verify content-share or content-add-to-library activities are not routed to the content activity stream', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 4, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart, 3: lisa } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const asBart = bart.restContext;
        const asLisa = lisa.restContext;

        createLink(
          asHomer,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);

            // Make marge a private user and add the file into his library, no activities should be sent
            updateUser(asMarge, marge.user.id, { visibility: 'private' }, (error_) => {
              assert.notExists(error_);

              shareContent(asMarge, contentObject.id, [marge.user.id], (error_) => {
                assert.notExists(error_);

                // Route and deliver activities
                collectAndGetActivityStream(asMarge, null, null, (error_) => {
                  assert.notExists(error_);

                  // Assert they didn't end up in the content activity stream
                  getActivities(contentObject.id + '#activity', null, 25, (error, activities) => {
                    assert.notExists(error);

                    // Assert that we didn't add the `content-add-to-library` activity by asserting the latest activity in the stream is `content-create`
                    assert.strictEqual(activities[0]['oae:activityType'], 'content-create');

                    // Try it with a public user
                    shareContent(asBart, contentObject.id, [bart.user.id], (error_) => {
                      assert.notExists(error_);

                      // Route and deliver activities
                      collectAndGetActivityStream(asBart, null, null, (error_) => {
                        assert.notExists(error_);

                        // Assert they didn't end up in the content activity stream
                        getActivities(contentObject.id + '#activity', null, 25, (error, activities) => {
                          assert.notExists(error);

                          // Assert that we didn't add the `content-add-to-library` activity by asserting the latest activity in the stream is `content-create`
                          assert.strictEqual(activities[0]['oae:activityType'], 'content-create');

                          // Assert that content-share activities do not end up on the activity stream
                          shareContent(asBart, contentObject.id, [lisa.user.id], (error_) => {
                            assert.notExists(error_);

                            // Route and deliver activities
                            collectAndGetActivityStream(asLisa, null, null, (error_) => {
                              assert.notExists(error_);

                              // Assert they didn't end up in the content activity stream
                              getActivities(contentObject.id + '#activity', null, 25, (error, activities) => {
                                assert.notExists(error);

                                // Assert that we didn't add the `content-share` activity by asserting the latest activity in the stream is `content-create`
                                assert.strictEqual(activities[0]['oae:activityType'], 'content-create');

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
          }
        );
      });
    });

    /**
     * Test that verifies that a comment activity is routed to the managers and recent contributers their notification stream of a private content item
     */
    it('verify comment activity is routed to the managers and recent contributors notification stream of a private content item', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 4, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart, 3: lisa } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const asBart = bart.restContext;

        createLink(
          asHomer,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [marge.user.id],
            viewers: [bart.user.id, lisa.user.id],
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            createComment(asBart, link.id, 'Comment A', null, (error /* , commentA */) => {
              assert.notExists(error);

              // Assert that the managers got it
              collectAndGetNotificationStream(asHomer, null, (error, activityStream) => {
                assert.notExists(error);
                assert.ok(
                  find((activity) => equals('content-comment', activity['oae:activityType']), activityStream.items)
                );

                collectAndGetNotificationStream(asMarge, null, (error, activityStream) => {
                  assert.notExists(error);
                  assert.ok(
                    find((activity) => equals(activity['oae:activityType'], 'content-comment'), activityStream.items)
                  );

                  // Create another comment and assert that both the managers and the recent contributors get a notification
                  createComment(asMarge, link.id, 'Comment B', null, (error /* , commentB */) => {
                    assert.notExists(error);

                    // Because Bert made a comment previously, he should get a notification as well
                    collectAndGetNotificationStream(asBart, null, (error, activityStream) => {
                      assert.notExists(error);

                      const commentActivitiesAsBart = filter(
                        (activity) => equals(activity['oae:activityType'], 'content-comment'),
                        activityStream.items
                      );
                      assert.lengthOf(commentActivitiesAsBart, 1);

                      // Sanity-check that the managers got it as well
                      collectAndGetNotificationStream(asMarge, null, (error, activityStream) => {
                        assert.notExists(error);

                        const commentActivitiesAsMarge = filter(
                          (activity) => equals(activity['oae:activityType'], 'content-comment'),
                          activityStream.items
                        );
                        assert.lengthOf(commentActivitiesAsMarge, 1);

                        collectAndGetNotificationStream(asHomer, null, (error, activityStream) => {
                          assert.notExists(error);

                          const commentActivitiesAsHomer = filter(
                            (activity) => equals(activity['oae:activityType'], 'content-comment'),
                            activityStream.items
                          );

                          // Homer sees a single activity because both content-comment activities have been merged into a collection
                          assert.lengthOf(commentActivitiesAsHomer, 1);

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

  describe('Activity Entity Models', () => {
    /**
     * In order to test download url expiry, we need to
     * override the `Date.now` function, After each test
     * ensure it is set to the proper function
     */
    const _originalDateNow = Date.now;
    afterEach((callback) => {
      Date.now = _originalDateNow;
      return callback();
    });

    /**
     * Test that verifies the properties of the content entity
     */
    it('verify the content entity model contains the correct content information', (callback) => {
      /*!
       * Function used to verify the status of the "static" link content item in this test case. This basically means
       * everything except the preview items.
       */
      const _assertStandardLinkModel = function (entity, contentId) {
        const { resourceId } = getResourceFromId(contentId);
        assert.strictEqual(entity['oae:visibility'], 'public');
        assert.strictEqual(entity['oae:resourceSubType'], 'link');
        assert.strictEqual(entity['oae:profilePath'], '/content/camtest/' + resourceId);
        assert.strictEqual(entity.displayName, 'Google');
        assert.strictEqual(entity.objectType, 'content');
        assert.strictEqual(entity['oae:id'], contentId);
        assert.strictEqual(entity.url, 'http://' + global.oaeTests.tenants.cam.host + '/content/camtest/' + resourceId);
        assert.ok(entity.id.includes(contentId));
      };

      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;
        const asJack = jack.restContext;

        // Generate an activity with the content
        createLink(
          asJack,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Verify model with no preview state
            collectAndGetActivityStream(asJack, jack.user.id, null, (error, activityStream) => {
              assert.notExists(error);

              const entity = activityStream.items[0].object;
              _assertStandardLinkModel(entity, link.id);
              assert.isNotOk(entity.image);
              assert.isNotOk(entity['oae:wideImage']);

              // Get the global admin context on the camtest tenant
              loginOnTenant(
                asGlobalAdmin,
                global.oaeTests.tenants.localhost.alias,
                null,
                (error, globalTenantAdminRestContext) => {
                  assert.notExists(error);

                  // Get the revision ID
                  getRevisions(globalTenantAdminRestContext, link.id, null, 1, (error, revisions) => {
                    assert.notExists(error);
                    const { revisionId } = revisions.results[0];

                    // Set the preview to error status
                    setPreviewItems(
                      globalTenantAdminRestContext,
                      link.id,
                      revisionId,
                      'error',
                      {},
                      {},
                      {},
                      {},
                      (error_) => {
                        assert.notExists(error_);

                        // Verify that the preview does not display
                        collectAndGetActivityStream(asJack, jack.user.id, null, (error, activityStream) => {
                          assert.notExists(error);

                          const entity = activityStream.items[0].object;
                          _assertStandardLinkModel(entity, link.id);
                          assert.ok(!entity.image);
                          assert.ok(!entity['oae:wideImage']);

                          // Set the preview to ignored status with no files
                          setPreviewItems(
                            globalTenantAdminRestContext,
                            link.id,
                            revisionId,
                            'ignored',
                            {},
                            {},
                            {},
                            {},
                            (error_) => {
                              assert.notExists(error_);

                              // Verify that the preview still does not display
                              collectAndGetActivityStream(asJack, jack.user.id, null, (error, activityStream) => {
                                assert.notExists(error);

                                const entity = activityStream.items[0].object;
                                _assertStandardLinkModel(entity, link.id);
                                assert.isNotOk(entity.image);
                                assert.isNotOk(entity['oae:wideImage']);

                                // Set the preview to done status with files
                                setPreviewItems(
                                  globalTenantAdminRestContext,
                                  link.id,
                                  revisionId,
                                  'done',
                                  suitableFiles,
                                  suitableSizes,
                                  {},
                                  {},
                                  (error_) => {
                                    assert.notExists(error_);

                                    // Verify that the previews are returned in the activity
                                    collectAndGetActivityStream(asJack, jack.user.id, null, (error, activityStream) => {
                                      assert.notExists(error);

                                      const entity = activityStream.items[0].object;
                                      _assertStandardLinkModel(entity, link.id);
                                      assert.ok(entity.image);
                                      assert.strictEqual(entity.image.width, PreviewConstants.SIZES.IMAGE.THUMBNAIL);
                                      assert.strictEqual(entity.image.height, PreviewConstants.SIZES.IMAGE.THUMBNAIL);
                                      assert.ok(entity.image.url);
                                      assert.ok(entity['oae:wideImage']);
                                      assert.strictEqual(
                                        entity['oae:wideImage'].width,
                                        PreviewConstants.SIZES.IMAGE.WIDE_WIDTH
                                      );
                                      assert.strictEqual(
                                        entity['oae:wideImage'].height,
                                        PreviewConstants.SIZES.IMAGE.WIDE_HEIGHT
                                      );
                                      assert.ok(entity['oae:wideImage'].url);

                                      // Ensure the standard and wide image can be downloaded right now by even an anonymous user on another tenant
                                      let signedDownloadUrl = new URL(entity['oae:wideImage'].url, 'http://localhost');
                                      RestUtil.performRestRequest(
                                        asGeorgiaTechAnonymousUser,
                                        signedDownloadUrl.pathname,
                                        'GET',
                                        objectifySearchParams(signedDownloadUrl.searchParams),
                                        (error, body, response) => {
                                          assert.notExists(error);
                                          assert.strictEqual(response.statusCode, 204);

                                          signedDownloadUrl = new URL(entity.image.url, 'http://localhost');
                                          RestUtil.performRestRequest(
                                            asGeorgiaTechAnonymousUser,
                                            signedDownloadUrl.pathname,
                                            'GET',
                                            objectifySearchParams(signedDownloadUrl.searchParams),
                                            (error, body, response) => {
                                              assert.notExists(error);
                                              assert.strictEqual(response.statusCode, 204);

                                              // Jump ahead in time by 5 years, test-drive a hovercar and check if the signatures still work
                                              const now = Date.now();
                                              Date.now = function () {
                                                return now + 5 * 365 * 24 * 60 * 60 * 1000;
                                              };

                                              // Ensure the standard and wide image can still be downloaded 5y in the future by even an anonymous user on another tenant
                                              signedDownloadUrl = new URL(
                                                entity['oae:wideImage'].url,
                                                'http://localhost'
                                              );
                                              RestUtil.performRestRequest(
                                                asGeorgiaTechAnonymousUser,
                                                signedDownloadUrl.pathname,
                                                'GET',
                                                objectifySearchParams(signedDownloadUrl.searchParams),
                                                (error, body, response) => {
                                                  assert.notExists(error);
                                                  assert.strictEqual(response.statusCode, 204);

                                                  signedDownloadUrl = new URL(entity.image.url, 'http://localhost');
                                                  RestUtil.performRestRequest(
                                                    asGeorgiaTechAnonymousUser,
                                                    signedDownloadUrl.pathname,
                                                    'GET',
                                                    objectifySearchParams(signedDownloadUrl.searchParams),
                                                    (error, body, response) => {
                                                      assert.notExists(error);
                                                      assert.strictEqual(response.statusCode, 204);

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
     * Test that verifies the properties of a comment entity
     */
    it('verify the comment entity model contains the correct comment information', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;
        const asJack = jack.restContext;

        // Generate an activity with the content
        createLink(
          asJack,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Create 3 comments, including one reply. We want to make sure the context is properly aggregated in these comments as their activities are delivered.
            createComment(asJack, link.id, 'Comment A', null, (error, commentA) => {
              assert.notExists(error);

              createComment(asJack, link.id, 'Comment B', null, (error, commentB) => {
                assert.notExists(error);

                createComment(asJack, link.id, 'Reply Comment A', commentA.created, (error, replyCommentA) => {
                  assert.notExists(error);

                  collectAndGetActivityStream(asJack, jack.user.id, null, (error, activityStream) => {
                    assert.notExists(error);
                    assert.ok(activityStream);

                    // The first in the list (most recent) is the aggregated comment activity
                    const activity = activityStream.items[0];
                    let hadCommentA = false;
                    let hadCommentB = false;
                    let hadReplyCommentA = false;

                    assert.ok(activity.object['oae:collection']);
                    assert.strictEqual(activity.object['oae:collection'].length, 3);

                    /*!
                     * Verifies the model of a comment and its context.
                     *
                     * @param  {ActivityEntity}    entity                      The comment entity to verify
                     * @param  {Comment}           comment                     The comment with which to verify the entity
                     * @param  {Comment}           [replyToComment]            Indicates the entity should have this comment as its inReplyTo. If unspecified, the entity should have no parent.
                     */
                    const _validateComment = function (entity, comment, replyToComment) {
                      assert.strictEqual(entity.objectType, 'content-comment');
                      assert.strictEqual(entity.content, comment.body);
                      assert.strictEqual(entity['oae:id'], comment.id);
                      assert.strictEqual(
                        entity.url,
                        '/content/camtest/' + AuthzUtil.getResourceFromId(comment.messageBoxId).resourceId
                      );
                      assert.ok(entity.id.includes('content/' + link.id + '/messages/' + comment.created));
                      assert.strictEqual(entity.published, comment.created);
                      assert.strictEqual(entity['oae:messageBoxId'], comment.messageBoxId);
                      assert.strictEqual(entity['oae:threadKey'], comment.threadKey);

                      assert.ok(entity.author);
                      assert.ok(entity.author.objectType, 'user');
                      assert.strictEqual(entity.author['oae:id'], comment.createdBy.id);

                      if (replyToComment) {
                        _validateComment(entity.inReplyTo, replyToComment);
                      } else {
                        assert.ok(!entity.inReplyTo);
                      }
                    };

                    // Verify that the collection contains all comments, and their models are correct.
                    activity.object['oae:collection'].forEach((entity) => {
                      if (entity.content === 'Comment A') {
                        hadCommentA = true;

                        // Ensures that comment A has correct data, and no parents
                        _validateComment(entity, commentA);
                      } else if (entity.content === 'Comment B') {
                        hadCommentB = true;

                        // Ensures that comment B has correct data, and no parents
                        _validateComment(entity, commentB);
                      } else if (entity.content === 'Reply Comment A') {
                        hadReplyCommentA = true;

                        // Verify that the reply to comment A has the right data and the parent (comment A)
                        _validateComment(entity, replyCommentA, commentA);
                      }
                    });

                    assert.ok(hadCommentA);
                    assert.ok(hadCommentB);
                    assert.ok(hadReplyCommentA);

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

  describe('Activity Privacy', () => {
    /**
     * Test that verifies that a public, loggedin and private content activity entities are propagated only to appropriate users
     */
    it('verify a public, loggedin and private content activity entities are propagated only to appropriate users', (callback) => {
      // Create a mix of public, loggedin, private users and groups from public and private tenants
      setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1 /* , privateTenant0, privateTenant1 */) => {
        // Follow the publicTenant0.publicUser with the others
        const followers = [
          publicTenant0.loggedinUser,
          publicTenant0.privateUser,
          publicTenant1.publicUser,
          publicTenant1.loggedinUser,
          publicTenant1.privateUser
        ];

        const asPublicUserOnPublicTenant0 = publicTenant0.publicUser.restContext;
        const asLoggedinUserOnPublicTenant0 = publicTenant0.loggedinUser.restContext;

        const asPublicUserOnPublicTenant1 = publicTenant1.publicUser.restContext;
        const asLoggedinUserOnPublicTenant1 = publicTenant1.loggedinUser.restContext;

        const publicTenant0PublicUserId = publicTenant0.publicUser.user.id;

        followByAll(publicTenant0.publicUser.user.id, followers, () => {
          // Create a public, loggedin and private content item to distribute to followers of the actor user
          createLink(
            asPublicUserOnPublicTenant0,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: [publicTenant1.publicUser.user.id],
              folders: NO_FOLDERS
            },
            (error, publicLink) => {
              assert.notExists(error);

              createLink(
                asPublicUserOnPublicTenant0,
                {
                  displayName: 'Google',
                  description: 'Google',
                  visibility: LOGGED_IN,
                  link: 'http://www.google.ca',
                  managers: NO_MANAGERS,
                  viewers: [publicTenant1.publicUser.user.id],
                  folders: NO_FOLDERS
                },
                (error, loggedinLink) => {
                  assert.notExists(error);

                  createLink(
                    asPublicUserOnPublicTenant0,
                    {
                      displayName: 'Google',
                      description: 'Google',
                      visibility: PRIVATE,
                      link: 'http://www.google.ca',
                      managers: NO_MANAGERS,
                      viewers: [publicTenant1.publicUser.user.id],
                      folders: NO_FOLDERS
                    },
                    (error, privateLink) => {
                      assert.notExists(error);

                      // Ensure the user who created them got all 3 content items aggregated in their feed
                      collectAndGetActivityStream(asPublicUserOnPublicTenant0, null, null, (error, result) => {
                        assert.notExists(error);
                        assertActivity(
                          result.items[0],
                          'content-create',
                          'create',
                          publicTenant0PublicUserId,
                          [publicLink.id, loggedinLink.id, privateLink.id],
                          publicTenant1.publicUser.user.id
                        );

                        // Ensure the loggedin user of the same tenant gets 2 of the content items in their feed: public and loggedin
                        collectAndGetActivityStream(asLoggedinUserOnPublicTenant0, null, null, (error, result) => {
                          assert.notExists(error);
                          assertActivity(
                            result.items[0],
                            'content-create',
                            'create',
                            publicTenant0PublicUserId,
                            [publicLink.id, loggedinLink.id],
                            publicTenant1.publicUser.user.id
                          );

                          // Ensure the public user from another tenant gets all 3 of the content items in their feed because they were made a member. This
                          // ensures that even if the tenant propagation fails on the content item, the association propagation still includes them
                          collectAndGetActivityStream(asPublicUserOnPublicTenant1, null, null, (error, result) => {
                            assert.notExists(error);
                            assertActivity(
                              result.items[0],
                              'content-create',
                              'create',
                              publicTenant0PublicUserId,
                              [publicLink.id, loggedinLink.id, privateLink.id],
                              publicTenant1.publicUser.user.id
                            );

                            /**
                             * Ensure the loggedin user from another tenant only gets the public content item
                             * since they are not a member and cannot see the loggedin one
                             */
                            collectAndGetActivityStream(asLoggedinUserOnPublicTenant1, null, null, (error, result) => {
                              assert.notExists(error);
                              assertActivity(
                                result.items[0],
                                'content-create',
                                'create',
                                publicTenant0PublicUserId,
                                publicLink.id,
                                publicTenant1.publicUser.user.id
                              );

                              return callback();
                            });
                          });
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
    });
  });

  describe('Posting Activities', () => {
    /**
     * Test that verifies that a content-create and content-update activity are generated when a content item is created and updated.
     */
    it('verify content-create and content-update activities are posted when content is created and updated', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;
        const asJack = jack.restContext;

        // Generate an activity with the content
        createLink(
          asJack,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            updateContent(asJack, link.id, { description: 'Super awesome link' }, (error_) => {
              assert.notExists(error_);

              collectAndGetActivityStream(asJack, jack.user.id, null, (error, activityStream) => {
                assert.notExists(error);

                const createActivity = _getActivity(activityStream, 'content-create', 'object', link.id);
                const updateActivity = _getActivity(activityStream, 'content-update', 'object', link.id);

                assert.ok(createActivity);
                assert.strictEqual(createActivity.verb, 'create');

                assert.ok(updateActivity);
                assert.strictEqual(updateActivity.verb, 'update');

                return callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test to verify the revision id gets updated in the activity when a new revision is posted
     */
    it('verify content-update activities have updated previews', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;
        const asJack = jack.restContext;

        createFile(
          asJack,
          {
            displayName: 'name',
            description: 'description',
            visibility: PUBLIC,
            file: getFunctionThatReturnsFileStream('oae-video.png'),
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, content) => {
            assert.notExists(error);

            // Create a new revision
            updateFileBody(asJack, content.id, getFunctionThatReturnsFileStream('apereo.jpg'), (error_) => {
              assert.notExists(error_);

              collectAndGetActivityStream(asJack, jack.user.id, null, (error, activityStream) => {
                assert.notExists(error);

                const createActivity = _getActivity(activityStream, 'content-create', 'object', content.id);
                const updateActivity = _getActivity(activityStream, 'content-revision', 'object', content.id);

                assert.ok(createActivity);
                assert.ok(updateActivity);
                assert.notStrictEqual(createActivity.object['oae:revisionId'], updateActivity.object['oae:revisionId']);

                return callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that a content-share activity is generated when a content item is shared.
     */
    it('verify a content-share activity is generated when a content item is shared', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;

        createLink(
          asCambridgeTenantAdmin,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Try and generate a share activity
            shareContent(asCambridgeTenantAdmin, link.id, [jack.user.id], (error_) => {
              assert.notExists(error_);

              collectAndGetActivityStream(asCambridgeTenantAdmin, jack.user.id, null, (error, activityStream) => {
                assert.notExists(error);

                const shareActivity = _getActivity(activityStream, 'content-share', 'object', link.id);
                assert.ok(shareActivity);
                assert.strictEqual(shareActivity.verb, 'share');

                callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that when a user's role is updated, a content-update-member-role activity is generated.
     */
    it('verify a content-update-member-role activity is generated when a user role is updated on a content item', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: jack, 1: jane } = users;
        const asJack = jack.restContext;

        // Create a link whose member we can promote to manager
        createLink(
          asJack,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: [jane.user.id],
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Update the member's role to manager
            const roleChange = {};
            roleChange[jane.user.id] = 'manager';

            updateMembers(asJack, link.id, roleChange, (error_) => {
              assert.notExists(error_);

              // Ensure they have the content-update-member-role activity in their activity feed
              collectAndGetActivityStream(asJack, jack.user.id, null, (error, activityStream) => {
                assert.notExists(error);

                assertActivity(
                  activityStream.items[0],
                  'content-update-member-role',
                  'update',
                  jack.user.id,
                  jane.user.id,
                  link.id
                );

                return callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that a content-revision activity is generated when a content item's body has been updated / uploaded.
     */
    it("verify a content-revision activity is generated when a content item's body has been updated", (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;
        const asJack = jack.restContext;

        // Create a revisable content item
        createFile(
          asJack,
          {
            displayName: 'Test Content 1',
            descritpion: 'Test content description 1',
            visibility: 'private',
            file: getFunctionThatReturnsFileStream('oae-video.png'),
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, content) => {
            assert.notExists(error);
            assert.ok(content);

            // Create a new version
            updateFileBody(asJack, content.id, getFunctionThatReturnsFileStream('apereo.jpg'), (error_) => {
              assert.notExists(error_);

              // Verify the revision activity was created for jack
              collectAndGetActivityStream(asCambridgeTenantAdmin, jack.user.id, null, (error, activityStream) => {
                assert.notExists(error);
                const revisionActivity = _getActivity(activityStream, 'content-revision', 'object', content.id);
                assert.ok(revisionActivity);
                assert.strictEqual(revisionActivity.verb, 'update');

                // Also verify that a content-update activity *doesn't* get generated. no one will want to see both a revision and a meta-data update
                assert.ok(!_getActivity(activityStream, 'content-update', 'object', content.id));

                return callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that a content-add-to-library activity is generated when a user adds a content item to their own library
     */
    it('verify a content-add-to-library activity is generated when a user adds a content item to their own library', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;
        const asJack = jack.restContext;

        createLink(
          asCambridgeTenantAdmin,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Jack adds the content item to his own library
            shareContent(asJack, link.id, [jack.user.id], (error_) => {
              assert.notExists(error_);

              collectAndGetActivityStream(asCambridgeTenantAdmin, jack.user.id, null, (error, activityStream) => {
                assert.notExists(error);
                const addActivity = _getActivity(activityStream, 'content-add-to-library', 'object', link.id);
                assert.ok(addActivity);
                assert.strictEqual(addActivity.verb, 'add');
                callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that a content-update-visibility activity is generated when a content's visibility is updated
     */
    it("verify a content-update-visibility activity is generated when a content item's visibility is updated", (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;

        createLink(
          asCambridgeTenantAdmin,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: [jack.user.id],
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Jack adds the content item to his own library
            updateContent(asCambridgeTenantAdmin, link.id, { visibility: 'private' }, (error_) => {
              assert.notExists(error_);

              collectAndGetActivityStream(asCambridgeTenantAdmin, jack.user.id, null, (error, activityStream) => {
                assert.notExists(error);
                const updateVisibilityActivity = _getActivity(
                  activityStream,
                  'content-update-visibility',
                  'object',
                  link.id
                );
                assert.ok(updateVisibilityActivity);
                assert.strictEqual(updateVisibilityActivity.verb, 'update');
                callback();
              });
            });
          }
        );
      });
    });
  });

  describe('Activity Aggregation', () => {
    /**
     * Content create
     */

    /**
     * Test that verifies that when multiple content-create activities are done by the same actor, the content items get
     * aggregated into a collection.
     */
    it('verify content-create activities are pivoted by actor', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;
        const asJack = jack.restContext;

        // Create a google link
        createLink(
          asJack,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, googleLink) => {
            assert.notExists(error);

            // Create a Yahoo link
            createLink(
              asJack,
              {
                displayName: 'Yahoo!',
                description: 'Yahoo!',
                visibility: PUBLIC,
                link: 'http://www.yahoo.ca',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, yahooLink) => {
                assert.notExists(error);

                // Verify the activities were aggregated into one, pivoted by actor
                collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                  assert.notExists(error);

                  assert.ok(activityStream);
                  assert.lengthOf(activityStream.items, 1);

                  const aggregate = _getActivity(activityStream, 'content-create', 'actor', jack.user.id);
                  assert.ok(aggregate.object);
                  assert.ok(aggregate.object['oae:collection']);
                  assert.lengthOf(aggregate.object['oae:collection'], 2);

                  if (
                    aggregate.object['oae:collection'][0]['oae:id'] === googleLink.id &&
                    aggregate.object['oae:collection'][1]['oae:id'] === yahooLink.id
                  ) {
                    // Don't fail, we want one to be google and the other to be yahoo
                  } else if (
                    aggregate.object['oae:collection'][0]['oae:id'] === yahooLink.id &&
                    aggregate.object['oae:collection'][1]['oae:id'] === googleLink.id
                  ) {
                    // Don't fail, we want one to be google and the other to be yahoo
                  } else {
                    assert.fail(
                      'Expected the collection of created content items to be one yahoo link and one google link.'
                    );
                  }

                  callback();
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies when a content create activity is aggregated and re-delivered, the activity that it is replacing is
     * deleted properly
     */
    it('verify when a content-create activity is redelivered, it deletes the previous one', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;
        const asJack = jack.restContext;

        // Create a google link
        createLink(
          asJack,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error /* , googleLink */) => {
            assert.notExists(error);

            // Force a collection of activities so that the individual activity is delivered
            collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
              assert.notExists(error);
              assert.ok(activityStream);
              assert.lengthOf(activityStream.items, 1);

              // Create a Yahoo link
              createLink(
                asJack,
                {
                  displayName: 'Yahoo!',
                  description: 'Yahoo!',
                  visibility: PUBLIC,
                  link: 'http://www.yahoo.ca',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error /* , yahooLink */) => {
                  assert.notExists(error);

                  // Collect again and ensure we still only have one activity
                  collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                    assert.notExists(error);
                    assert.ok(activityStream);
                    assert.lengthOf(activityStream.items, 1);

                    // Rinse and repeat once to ensure that the aggregates are removed properly as well
                    createLink(
                      asJack,
                      {
                        displayName: 'Apereo!',
                        description: 'Apereo!',
                        visibility: PUBLIC,
                        link: 'http://www.apereo.org',
                        managers: NO_MANAGERS,
                        viewers: NO_VIEWERS,
                        folders: NO_FOLDERS
                      },
                      (error /* , apereoLink */) => {
                        assert.notExists(error);

                        // Collect again and ensure we still only have one activity
                        collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                          assert.notExists(error);

                          assert.ok(activityStream);
                          assert.lengthOf(activityStream.items, 1);

                          callback();
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
     * Test that verifies the folder-create activity when there are no extra members
     */
    it('verify no extra members', (callback) => {
      _setup((homer, marge, bart, lisa, maggie, groupMemberA, groupMemberB, groupA, groupB) => {
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const asBart = bart.restContext;
        const asLisa = lisa.restContext;
        const asMaggie = maggie.restContext;

        const asGroupMemberA = groupMemberA.restContext;
        const asGroupMemberB = groupMemberB.restContext;

        createLink(
          asHomer,
          {
            displayName: 'Apereo!',
            description: 'Apereo!',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // The actor should receive an activity
            assertFeedContainsActivity(
              asHomer,
              homer.user.id,
              'content-create',
              ActivityConstants.verbs.CREATE,
              homer.user.id,
              link.id,
              null,
              () => {
                // Users who follows the actor receive the activity
                assertFeedContainsActivity(
                  asMarge,
                  marge.user.id,
                  'content-create',
                  ActivityConstants.verbs.CREATE,
                  homer.user.id,
                  link.id,
                  null,
                  () => {
                    // Everyone else gets nothing
                    assertFeedDoesNotContainActivity(asBart, bart.user.id, 'content-create', () => {
                      assertFeedDoesNotContainActivity(asLisa, lisa.user.id, 'content-create', () => {
                        assertFeedDoesNotContainActivity(asMaggie, maggie.user.id, 'content-create', () => {
                          assertFeedDoesNotContainActivity(
                            asGroupMemberA,
                            groupMemberA.user.id,
                            'content-create',
                            () => {
                              assertFeedDoesNotContainActivity(
                                asGroupMemberB,
                                groupMemberB.user.id,
                                'content-create',
                                () => {
                                  assertFeedDoesNotContainActivity(
                                    asGroupMemberA,
                                    groupA.group.id,
                                    'content-create',
                                    () => {
                                      assertFeedDoesNotContainActivity(
                                        asGroupMemberB,
                                        groupB.group.id,
                                        'content-create',
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
     * Test that verifies the folder-create activity when there is one extra user
     */
    it('verify one extra user', (callback) => {
      _setup((homer, marge, bart, lisa, maggie, groupMemberA, groupMemberB, groupA, groupB) => {
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const asBart = bart.restContext;
        const asLisa = lisa.restContext;
        const asMaggie = maggie.restContext;

        const asGroupMemberA = groupMemberA.restContext;
        const asGroupMemberB = groupMemberB.restContext;

        createLink(
          asHomer,
          {
            displayName: 'Apereo!',
            description: 'Apereo!',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: [bart.user.id],
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // The actor should receive an activity
            assertFeedContainsActivity(
              asHomer,
              homer.user.id,
              'content-create',
              ActivityConstants.verbs.CREATE,
              homer.user.id,
              link.id,
              bart.user.id,
              () => {
                // Users who follows the actor receive the activity
                assertFeedContainsActivity(
                  asMarge,
                  marge.user.id,
                  'content-create',
                  ActivityConstants.verbs.CREATE,
                  homer.user.id,
                  link.id,
                  bart.user.id,
                  () => {
                    // The user who was made a member gets an activity
                    assertFeedContainsActivity(
                      asBart,
                      bart.user.id,
                      'content-create',
                      ActivityConstants.verbs.CREATE,
                      homer.user.id,
                      link.id,
                      bart.user.id,
                      () => {
                        // Everyone else gets nothing
                        assertFeedDoesNotContainActivity(asLisa, lisa.user.id, 'content-create', () => {
                          assertFeedDoesNotContainActivity(asMaggie, maggie.user.id, 'content-create', () => {
                            assertFeedDoesNotContainActivity(
                              asGroupMemberA,
                              groupMemberA.user.id,
                              'content-create',
                              () => {
                                assertFeedDoesNotContainActivity(
                                  asGroupMemberB,
                                  groupMemberB.user.id,
                                  'content-create',
                                  () => {
                                    assertFeedDoesNotContainActivity(
                                      asGroupMemberA,
                                      groupA.group.id,
                                      'content-create',
                                      () => {
                                        assertFeedDoesNotContainActivity(
                                          asGroupMemberB,
                                          groupB.group.id,
                                          'content-create',
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
     * Test that verifies the folder-create activity when there is one extra group
     */
    it('verify one extra group', (callback) => {
      _setup((homer, marge, bart, lisa, maggie, groupMemberA, groupMemberB, groupA, groupB) => {
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const asLisa = lisa.restContext;
        const asMaggie = maggie.restContext;

        const asGroupMemberA = groupMemberA.restContext;
        const asGroupMemberB = groupMemberB.restContext;

        createLink(
          asHomer,
          {
            displayName: 'Apereo!',
            description: 'Apereo!',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: [groupA.group.id],
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // The actor should receive an activity
            assertFeedContainsActivity(
              asHomer,
              homer.user.id,
              'content-create',
              ActivityConstants.verbs.CREATE,
              homer.user.id,
              link.id,
              groupA.group.id,
              () => {
                // Users who follow the actor receive the activity
                assertFeedContainsActivity(
                  asMarge,
                  marge.user.id,
                  'content-create',
                  ActivityConstants.verbs.CREATE,
                  homer.user.id,
                  link.id,
                  groupA.group.id,
                  () => {
                    // The group who was made a member gets an activity
                    assertFeedContainsActivity(
                      asGroupMemberA,
                      groupA.group.id,
                      'content-create',
                      ActivityConstants.verbs.CREATE,
                      homer.user.id,
                      link.id,
                      groupA.group.id,
                      () => {
                        // Members of the group get an activity
                        assertFeedContainsActivity(
                          asGroupMemberA,
                          groupMemberA.user.id,
                          'content-create',
                          ActivityConstants.verbs.CREATE,
                          homer.user.id,
                          link.id,
                          groupA.group.id,
                          () => {
                            // Everyone else gets nothing
                            assertFeedDoesNotContainActivity(asLisa, lisa.user.id, 'content-create', () => {
                              assertFeedDoesNotContainActivity(asMaggie, maggie.user.id, 'content-create', () => {
                                assertFeedDoesNotContainActivity(
                                  asGroupMemberB,
                                  groupMemberB.user.id,
                                  'content-create',
                                  () => {
                                    assertFeedDoesNotContainActivity(
                                      asGroupMemberB,
                                      groupB.group.id,
                                      'content-create',
                                      callback
                                    );
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
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies the folder-create activity when there is more than one extra member
     */
    it('verify more than one extra member', (callback) => {
      _setup((homer, marge, bart, lisa, maggie, groupMemberA, groupMemberB, groupA, groupB) => {
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const asLisa = lisa.restContext;
        const asMaggie = maggie.restContext;

        const asGroupMemberA = groupMemberA.restContext;
        const asGroupMemberB = groupMemberB.restContext;

        createLink(
          asHomer,
          {
            displayName: 'Apereo!',
            description: 'Apereo!',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: [bart.user.id, groupA.group.id],
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // The actor should receive an activity
            assertFeedContainsActivity(
              asHomer,
              homer.user.id,
              'content-create',
              ActivityConstants.verbs.CREATE,
              homer.user.id,
              link.id,
              null,
              () => {
                // Users who follow the actor receive the activity
                assertFeedContainsActivity(
                  asMarge,
                  marge.user.id,
                  'content-create',
                  ActivityConstants.verbs.CREATE,
                  homer.user.id,
                  link.id,
                  null,
                  () => {
                    // The user who was made a member gets an activity
                    assertFeedContainsActivity(
                      asMarge,
                      marge.user.id,
                      'content-create',
                      ActivityConstants.verbs.CREATE,
                      homer.user.id,
                      link.id,
                      null,
                      () => {
                        // The group who was made a member gets an activity
                        assertFeedContainsActivity(
                          asGroupMemberA,
                          groupA.group.id,
                          'content-create',
                          ActivityConstants.verbs.CREATE,
                          homer.user.id,
                          link.id,
                          null,
                          () => {
                            // Members of the group get an activity
                            assertFeedContainsActivity(
                              asGroupMemberA,
                              groupMemberA.user.id,
                              'content-create',
                              ActivityConstants.verbs.CREATE,
                              homer.user.id,
                              link.id,
                              null,
                              () => {
                                // Everyone else gets nothing
                                assertFeedDoesNotContainActivity(asLisa, lisa.user.id, 'content-create', () => {
                                  assertFeedDoesNotContainActivity(asMaggie, maggie.user.id, 'content-create', () => {
                                    assertFeedDoesNotContainActivity(
                                      asGroupMemberB,
                                      groupMemberB.user.id,
                                      'content-create',
                                      () => {
                                        assertFeedDoesNotContainActivity(
                                          asGroupMemberB,
                                          groupB.group.id,
                                          'content-create',
                                          callback
                                        );
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
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * CONTENT UPDATE
     */

    /**
     * Test that verifies when a content item is updated multiple times, the actors that updated it are aggregated into a collection.
     */
    it('verify content-update activities are pivoted by object', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;
        const asJack = jack.restContext;

        // Create a google link
        createLink(
          asJack,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, googleLink) => {
            assert.notExists(error);

            // Update the content once as jack
            updateContent(asJack, googleLink.id, { displayName: 'The Google' }, (error_) => {
              assert.notExists(error_);

              // Update it a second time as jack, we use this to make sure we don't get duplicates in the aggregation
              updateContent(asJack, googleLink.id, { displayName: 'Google' }, (error_) => {
                assert.notExists(error_);

                // Update it with a different user, this should be a second entry in the collection
                updateContent(asCambridgeTenantAdmin, googleLink.id, { displayName: 'Google' }, (error_) => {
                  assert.notExists(error_);

                  // Verify we get the 2 actors in the stream
                  collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                    assert.notExists(error);

                    assert.ok(activityStream);
                    const activity = activityStream.items[0];
                    assert.ok(activity);
                    assert.strictEqual(activity['oae:activityType'], 'content-update');

                    const actors = activity.actor['oae:collection'];
                    assert.ok(actors);
                    assert.lengthOf(actors, 2);
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
     * Test that verifies two duplicate content updates do not result in an aggregation, but simply an activity with an updated
     * timestamp.
     */
    it('verify duplicate content-update activities are re-released with a more recent date, with no aggregations', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;
        const asJack = jack.restContext;

        // Create a google link
        createLink(
          asJack,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, googleLink) => {
            assert.notExists(error);

            // Update the content once as jack
            updateContent(asJack, googleLink.id, { displayName: 'The Google' }, (error_) => {
              assert.notExists(error_);

              // Add something to the activity feed that happened later than the previous update
              createLink(
                asJack,
                {
                  displayName: 'Yahoo!',
                  description: 'Yahoo!',
                  visibility: PUBLIC,
                  link: 'http://www.yahoo.ca',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error /* , yahooLink */) => {
                  assert.notExists(error);

                  /**
                   * Update it a second time as jack, we use this to make sure we don't get duplicates in the aggregation,
                   * and ensure the update jumps ahead of the last create activity in the feed
                   */
                  updateContent(asJack, googleLink.id, { displayName: 'Google' }, (error_) => {
                    assert.notExists(error_);

                    // Verify that the activity is still a non-aggregated activity, it just jumped to the front of the feed
                    collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                      assert.notExists(error);
                      assert.ok(activityStream);

                      // One for the "content-create" aggregation, one for the "update content" duplicates
                      assert.lengthOf(activityStream.items, 2);

                      // Ensures that the actor is not a collection, but still an individual entity
                      const activity = activityStream.items[0];
                      assert.strictEqual(activity['oae:activityType'], 'content-update');
                      assert.ok(activity.actor['oae:id'], jack.user.id);
                      assert.strictEqual(
                        activity.actor['oae:profilePath'],
                        '/user/' + jack.user.tenant.alias + '/' + AuthzUtil.getResourceFromId(jack.user.id).resourceId
                      );
                      assert.ok(activity.object['oae:id'], googleLink.id);
                      assert.strictEqual(
                        activity.object['oae:profilePath'],
                        '/content/' +
                          googleLink.tenant.alias +
                          '/' +
                          AuthzUtil.getResourceFromId(googleLink.id).resourceId
                      );

                      // Send a new activity into the feed so it is the most recent
                      createLink(
                        asJack,
                        {
                          displayName: 'Apereo',
                          description: 'Apereo',
                          visibility: PUBLIC,
                          link: 'http://www.apereo.org',
                          managers: NO_MANAGERS,
                          viewers: NO_VIEWERS,
                          folders: NO_FOLDERS
                        },
                        (error /* , apereoLink */) => {
                          assert.notExists(error);

                          // Force a collection so that the most recent activity is in the feed
                          collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                            assert.notExists(error);
                            assert.ok(activityStream);
                            assert.lengthOf(activityStream.items, 2);

                            // Jump the update activity to the top again
                            updateContent(asJack, googleLink.id, { displayName: 'Google' }, (error_) => {
                              assert.notExists(error_);

                              // Verify update activity is at the top and still an individual activity
                              collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                                assert.notExists(error);

                                assert.ok(activityStream);
                                assert.lengthOf(activityStream.items, 2);

                                // Content-update activity should be the first in the list, it should still be a single activity
                                const activity = activityStream.items[0];
                                assert.strictEqual(activity['oae:activityType'], 'content-update');
                                assert.strictEqual(activity.actor['oae:id'], jack.user.id);
                                assert.strictEqual(
                                  activity.actor['oae:profilePath'],
                                  '/user/' +
                                    jack.user.tenant.alias +
                                    '/' +
                                    AuthzUtil.getResourceFromId(jack.user.id).resourceId
                                );
                                assert.ok(activity.object['oae:id'], googleLink.id);
                                assert.strictEqual(
                                  activity.object['oae:profilePath'],
                                  '/content/' +
                                    googleLink.tenant.alias +
                                    '/' +
                                    AuthzUtil.getResourceFromId(googleLink.id).resourceId
                                );
                                callback();
                              });
                            });
                          });
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
     * Content update visibility
     */

    /*
     * The "content-update-visibility" activity demonstrates an activity that has no pivot points, therefore it should be
     * treated as though it pivots on all three entities (actor, object, target) such that duplicate activities within the
     * aggregation period are not posted multiple times. Duplicates are instead pushed to the top of the feed.
     */

    /**
     * Test that verifies when a content-update-visibility activity is posted duplicate times, it does not result in multiple entries in the
     * activity feed. Instead, the activity should be updated and reposted as a recent item.
     */
    it('verify duplicate content-update-visibility activities are not duplicated in the feed', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;
        const asJack = jack.restContext;

        // Create a google link
        createLink(
          asJack,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, googleLink) => {
            assert.notExists(error);

            // Update the content once as jack
            updateContent(asJack, googleLink.id, { visibility: 'loggedin' }, (error_) => {
              assert.notExists(error_);

              // Add something to the activity feed that happened later than the previous update
              createLink(
                asJack,
                {
                  displayName: 'Yahoo!',
                  description: 'Yahoo!',
                  visibility: PUBLIC,
                  link: 'http://www.yahoo.ca',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error /* , yahooLink */) => {
                  assert.notExists(error);

                  /**
                   * Update it a second time as jack, we use this to make sure we don't get duplicates in the aggregation,
                   * and ensure the update jumps ahead of the last create activity in the feed
                   */
                  updateContent(asJack, googleLink.id, { visibility: 'private' }, (error_) => {
                    assert.notExists(error_);

                    // Verify that the activity is still a non-aggregated activity, it just jumped to the front of the feed
                    collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                      assert.notExists(error);
                      assert.ok(activityStream);

                      // One for the "content-create" aggregation, one for the "update content" duplicates
                      assert.lengthOf(activityStream.items, 2);

                      // Ensures that the actor is not a collection, but still an individual entity
                      const activity = activityStream.items[0];
                      assert.strictEqual(activity['oae:activityType'], 'content-update-visibility');
                      assert.ok(activity.actor['oae:id'], jack.user.id);
                      assert.strictEqual(
                        activity.actor['oae:profilePath'],
                        '/user/' + jack.user.tenant.alias + '/' + AuthzUtil.getResourceFromId(jack.user.id).resourceId
                      );
                      assert.ok(activity.object['oae:id'], googleLink.id);
                      assert.strictEqual(
                        activity.object['oae:profilePath'],
                        '/content/' +
                          googleLink.tenant.alias +
                          '/' +
                          AuthzUtil.getResourceFromId(googleLink.id).resourceId
                      );

                      // Send a new activity into the feed so it is the most recent
                      createLink(
                        asJack,
                        {
                          displayName: 'Apereo',
                          description: 'Apereo',
                          visibility: PUBLIC,
                          link: 'http://www.apereo.org',
                          managers: NO_MANAGERS,
                          viewers: NO_VIEWERS,
                          folders: NO_FOLDERS
                        },
                        (error /* , apereoLink */) => {
                          assert.notExists(error);

                          // Force a collection so that the most recent activity is in the feed
                          collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                            assert.notExists(error);
                            assert.ok(activityStream);
                            assert.lengthOf(activityStream.items, 2);

                            // Jump the update activity to the top again
                            updateContent(asJack, googleLink.id, { visibility: 'public' }, (error_) => {
                              assert.notExists(error_);

                              // Verify update activity is at the top and still an individual activity
                              collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                                assert.notExists(error);
                                assert.ok(activityStream);
                                assert.lengthOf(activityStream.items, 2);

                                // Content-update activity should be the first in the list, it should still be a single activity
                                const activity = activityStream.items[0];
                                assert.strictEqual(activity['oae:activityType'], 'content-update-visibility');
                                assert.strictEqual(activity.actor['oae:id'], jack.user.id);
                                assert.strictEqual(
                                  activity.actor['oae:profilePath'],
                                  '/user/' +
                                    jack.user.tenant.alias +
                                    '/' +
                                    AuthzUtil.getResourceFromId(jack.user.id).resourceId
                                );
                                assert.ok(activity.object['oae:id'], googleLink.id);
                                assert.strictEqual(
                                  activity.object['oae:profilePath'],
                                  '/content/' +
                                    googleLink.tenant.alias +
                                    '/' +
                                    AuthzUtil.getResourceFromId(googleLink.id).resourceId
                                );
                                callback();
                              });
                            });
                          });
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
     * Content comment
     */

    /*
     * The content-comment activity demonstrates an activity that has all 3 entities, but only aggregates on 1 of them. This means that
     * 2 of the entity types are aggregated as more activities are generated instead of just one.
     */

    /**
     * Test that verifies that when content-comment activities are aggregated, both actor and object entities are collected into the activity
     * for display.
     */
    it('verify that content-comment activity aggregates both actor and object entities while pivoting on target', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;
        const asJack = jack.restContext;

        // Create a google link
        createLink(
          asJack,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Post a content as jack
            createComment(asJack, link.id, 'Test Comment A', null, (error_) => {
              assert.notExists(error_);

              // Post a comment as the cambridge admin, we have now aggregated a 2nd comment posting on the same content item
              createComment(asCambridgeTenantAdmin, link.id, 'Test Comment B', null, (error_) => {
                assert.notExists(error_);

                // Verify that both actors (camadmin and jack) and both objects (both comments) are available in the activity
                collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                  assert.notExists(error);
                  assert.ok(activityStream);
                  assert.lengthOf(activityStream.items, 2);

                  const activity = activityStream.items[0];
                  assert.strictEqual(activity['oae:activityType'], 'content-comment');

                  // Ensure we've aggregated all actors and objects
                  const actors = activity.actor['oae:collection'];
                  const objects = activity.object['oae:collection'];

                  assert.ok(actors);
                  assert.ok(objects);
                  assert.lengthOf(actors, 2);
                  assert.lengthOf(objects, 2);
                  assert.strictEqual(activity.target['oae:id'], link.id);

                  // Post a 3rd comment as a user who has posted already
                  createComment(asJack, link.id, 'Test Comment C', null, (error_) => {
                    assert.notExists(error_);

                    // Verify that the 3rd comment is aggregated into the object collection of the activity, however the actor collection has only the 2 unique actors
                    collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                      assert.notExists(error);
                      assert.ok(activityStream);
                      assert.lengthOf(activityStream.items, 2);

                      const activity = activityStream.items[0];
                      assert.strictEqual(activity['oae:activityType'], 'content-comment');

                      // Ensure we now have one additional object, but we should still only have 2 users because it was the same user that posted the 3rd time
                      const actors = activity.actor['oae:collection'];
                      const objects = activity.object['oae:collection'];

                      assert.ok(actors);
                      assert.ok(objects);
                      assert.lengthOf(actors, 2);
                      assert.lengthOf(objects, 3);
                      assert.strictEqual(activity.target['oae:id'], link.id);
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
     * Content-share
     */

    /*
     * The content-share activity demonstrates a case where you have 2 pivots for a single activity.
     *
     * One pivot is actor+object, which enables the aggregation: "Homer Simpson shared Mythology with 4 users and groups"
     *
     * The other pivot is actor+target, which enables the aggregation: "Homer Simpson shared 5 items with GroupA"
     */

    /**
     * Test that verifies that duplicating an activity that has multiple pivots does not result in redundant data in the
     * activity feed.
     */
    it('verify duplicate content-share activities do not result in redundant activities', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: jack, 1: jane } = users;
        const asJack = jack.restContext;

        // Create a google link
        createLink(
          asJack,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Share with jack, creates one activity item in cam admin's feed
            shareContent(asJack, link.id, [jane.user.id], (error_) => {
              assert.notExists(error_);

              const removeJane = {};
              removeJane[jane.user.id] = false;

              // Remove jane so we can duplicate the content share after
              updateMembers(asJack, link.id, removeJane, (error_) => {
                assert.notExists(error_);

                // Create some noise in the feed to ensure that the second share content will jump to the top
                createLink(
                  asJack,
                  {
                    displayName: 'Yahoo',
                    description: 'Yahoo',
                    visibility: PUBLIC,
                    link: 'http://www.google.ca',
                    managers: NO_MANAGERS,
                    viewers: NO_VIEWERS,
                    folders: NO_FOLDERS
                  },
                  (error /* , yahooLink */) => {
                    assert.notExists(error);

                    // Now re-add Jane
                    shareContent(asJack, link.id, [jane.user.id], (error_) => {
                      assert.notExists(error_);

                      // Verify that jack only has only one activity in his feed representing the content-share
                      collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                        assert.notExists(error);

                        assert.ok(activityStream);
                        assert.lengthOf(activityStream.items, 2);

                        // The first activity should be the content share, and it should not be an aggregation
                        const activity = activityStream.items[0];
                        assert.strictEqual(activity['oae:activityType'], 'content-share');
                        assert.strictEqual(activity.actor['oae:id'], jack.user.id);
                        assert.strictEqual(
                          activity.actor['oae:profilePath'],
                          '/user/' + jack.user.tenant.alias + '/' + AuthzUtil.getResourceFromId(jack.user.id).resourceId
                        );
                        assert.strictEqual(activity.object['oae:id'], link.id);
                        assert.strictEqual(
                          activity.object['oae:profilePath'],
                          '/content/' + link.tenant.alias + '/' + AuthzUtil.getResourceFromId(link.id).resourceId
                        );
                        assert.strictEqual(activity.target['oae:id'], jane.user.id);
                        assert.strictEqual(
                          activity.target['oae:profilePath'],
                          '/user/' + jane.user.tenant.alias + '/' + AuthzUtil.getResourceFromId(jane.user.id).resourceId
                        );

                        // Repeat once more to ensure we don't duplicate when the aggregate is already active
                        updateMembers(asJack, link.id, removeJane, (error_) => {
                          assert.notExists(error_);

                          // Create some noise in the feed to ensure that the third share content will jump to the top
                          createLink(
                            asJack,
                            {
                              displayName: 'Apereo',
                              description: 'Apereo',
                              visibility: PUBLIC,
                              link: 'http://www.apereo.org',
                              managers: NO_MANAGERS,
                              viewers: NO_VIEWERS,
                              folders: NO_FOLDERS
                            },
                            (error /* , apereoLink */) => {
                              assert.notExists(error);

                              // Re-share with Jane for the 3rd time
                              shareContent(asJack, link.id, [jane.user.id], (error_) => {
                                assert.notExists(error_);

                                // Verify that jack still has only one activity in his feed representing the content-share
                                collectAndGetActivityStream(asJack, null, null, (error, activityStream) => {
                                  assert.notExists(error);

                                  assert.ok(activityStream);
                                  assert.lengthOf(activityStream.items, 2);

                                  // The first activity should be the content share, and it should still not be an aggregation
                                  const activity = activityStream.items[0];
                                  assert.strictEqual(activity['oae:activityType'], 'content-share');
                                  assert.strictEqual(activity.actor['oae:id'], jack.user.id);
                                  assert.strictEqual(
                                    activity.actor['oae:profilePath'],
                                    '/user/camtest/' + AuthzUtil.getResourceFromId(jack.user.id).resourceId
                                  );
                                  assert.strictEqual(activity.object['oae:id'], link.id);
                                  assert.strictEqual(
                                    activity.object['oae:profilePath'],
                                    '/content/camtest/' + AuthzUtil.getResourceFromId(link.id).resourceId
                                  );
                                  assert.strictEqual(activity.target['oae:id'], jane.user.id);
                                  assert.strictEqual(
                                    activity.target['oae:profilePath'],
                                    '/user/camtest/' + AuthzUtil.getResourceFromId(jane.user.id).resourceId
                                  );
                                  return callback();
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
          }
        );
      });
    });

    /**
     * Test that verifies an activity with two aggregates will create 2 aggregate activities correctly when collected all at once
     * from the activity bucket.
     */
    it('verify content-share activities aggregate and are branched properly when all collected at once', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;

        // Create a google link and yahoo link to be shared around
        createLink(
          asHomer,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, googleLink) => {
            assert.notExists(error);

            createLink(
              asHomer,
              {
                displayName: 'Yahoo',
                description: 'Yahoo',
                visibility: PUBLIC,
                link: 'http://www.yahoo.ca',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, yahooLink) => {
                assert.notExists(error);

                // Share google link with jane and branden
                shareContent(asHomer, googleLink.id, [marge.user.id, bart.user.id], (error_) => {
                  assert.notExists(error_);

                  // Share Yahoo link with jane only
                  shareContent(asHomer, yahooLink.id, [marge.user.id], (error_) => {
                    assert.notExists(error_);

                    // Verify that the share activities aggregated in both pivot points
                    collectAndGetActivityStream(asHomer, null, null, (error, activityStream) => {
                      assert.notExists(error);
                      assert.ok(activityStream);
                      assert.lengthOf(activityStream.items, 3);

                      // 1. actor+target should have jack+(google,yahoo)+jane, and it would be most recent
                      let activity = activityStream.items[0];
                      assert.ok(activity.object['oae:collection']);
                      assert.lengthOf(activity.object['oae:collection'], 2);

                      // 2. actor+object aggregate should have: jack+google+(jane,branden)
                      activity = activityStream.items[1];
                      assert.ok(activity.target['oae:collection']);
                      assert.lengthOf(activity.target['oae:collection'], 2);

                      return callback();
                    });
                  });
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies an activity with two aggregates will create 2 aggregate activities correctly when one single activity
     * currently exists in the activity stream.
     */
    it('verify content-share activities aggregate and are branched properly when collected after first share', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;

        // Create a google link and yahoo link to be shared around
        createLink(
          asHomer,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, googleLink) => {
            assert.notExists(error);

            createLink(
              asHomer,
              {
                displayName: 'Yahoo',
                description: 'Yahoo',
                visibility: PUBLIC,
                link: 'http://www.yahoo.ca',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, yahooLink) => {
                assert.notExists(error);

                // Share google link with jane
                shareContent(asHomer, googleLink.id, [marge.user.id], (error_) => {
                  assert.notExists(error_);

                  // Perform a collection to activate some aggregates ahead of time
                  collectAndGetActivityStream(asHomer, null, null, (error /* , activityStream */) => {
                    assert.notExists(error);

                    // Share google now with branden, should aggregate with the previous
                    shareContent(asHomer, googleLink.id, [bart.user.id], (error_) => {
                      assert.notExists(error_);

                      // Share Yahoo link with jane only
                      shareContent(asHomer, yahooLink.id, [marge.user.id], (error_) => {
                        assert.notExists(error_);

                        // Verify that the share activities aggregated in both pivot points
                        collectAndGetActivityStream(asHomer, null, null, (error, activityStream) => {
                          assert.notExists(error);

                          assert.ok(activityStream);
                          assert.lengthOf(activityStream.items, 3);

                          // 1. actor+target should have jack+(google,yahoo)+jane, and it would be most recent
                          let activity = activityStream.items[0];
                          assert.ok(activity.object['oae:collection']);
                          assert.lengthOf(activity.object['oae:collection'], 2);

                          // 2. actor+object aggregate should have: jack+google+(jane,branden)
                          activity = activityStream.items[1];
                          assert.ok(activity.target['oae:collection']);
                          assert.lengthOf(activity.target['oae:collection'], 2);

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

    /**
     * Test that verifies an activity with two aggregates will create 2 aggregate activities correctly when one aggregate exists
     * in the feed before a third is collected.
     */
    it('verify content-share activities aggregate and are branched properly when collected before last share', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;

        // Create a google link and yahoo link to be shared around
        createLink(
          asHomer,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, googleLink) => {
            assert.notExists(error);

            createLink(
              asHomer,
              {
                displayName: 'Yahoo',
                description: 'Yahoo',
                visibility: PUBLIC,
                link: 'http://www.yahoo.ca',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, yahooLink) => {
                assert.notExists(error);

                // Share google link with jane and branden
                shareContent(asHomer, googleLink.id, [marge.user.id, bart.user.id], (error_) => {
                  assert.notExists(error_);

                  // Perform a collection to activate some aggregates ahead of time
                  collectAndGetActivityStream(asHomer, null, null, (error /* , activityStream */) => {
                    assert.notExists(error);

                    // Share Yahoo link with jane only
                    shareContent(asHomer, yahooLink.id, [marge.user.id], (error_) => {
                      assert.notExists(error_);

                      // Verify that the share activities aggregated in both pivot points
                      collectAndGetActivityStream(asHomer, null, null, (error, activityStream) => {
                        assert.notExists(error);

                        assert.ok(activityStream);
                        assert.lengthOf(activityStream.items, 3);

                        // 1. actor+target should have jack+(google,yahoo)+jane, and it would be most recent
                        let activity = activityStream.items[0];
                        assert.ok(activity.object['oae:collection']);
                        assert.lengthOf(activity.object['oae:collection'], 2);

                        // 2. actor+object aggregate should have: jack+google+(jane,branden)
                        activity = activityStream.items[1];
                        assert.ok(activity.target['oae:collection']);
                        assert.lengthOf(activity.target['oae:collection'], 2);

                        return callback();
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

    /**
     * Test that verifies an activity with two aggregates will create 2 aggregate activities correctly when each activity is collected
     * and delivered to the feed one by one.
     */
    it('verify content-share activities aggregate and are branched properly when collected after each share', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;

        // Create a google link and yahoo link to be shared around
        createLink(
          asHomer,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, googleLink) => {
            assert.notExists(error);

            createLink(
              asHomer,
              {
                displayName: 'Yahoo',
                description: 'Yahoo',
                visibility: PUBLIC,
                link: 'http://www.yahoo.ca',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, yahooLink) => {
                assert.notExists(error);

                // Share google link with jane
                shareContent(asHomer, googleLink.id, [marge.user.id], (error_) => {
                  assert.notExists(error_);

                  // Perform a collection to activate some aggregates ahead of time
                  collectAndGetActivityStream(asHomer, null, null, (error /* , activityStream */) => {
                    assert.notExists(error);

                    // Share google now with branden, should aggregate with the previous
                    shareContent(asHomer, googleLink.id, [bart.user.id], (error_) => {
                      assert.notExists(error_);

                      // Perform a collection to activate some aggregates ahead of time
                      collectAndGetActivityStream(asHomer, null, null, (error /* , activityStream */) => {
                        assert.notExists(error);

                        // Share Yahoo link with jane only
                        shareContent(asHomer, yahooLink.id, [marge.user.id], (error_) => {
                          assert.notExists(error_);

                          // Verify that the share activities aggregated in both pivot points
                          collectAndGetActivityStream(asHomer, null, null, (error, activityStream) => {
                            assert.notExists(error);

                            assert.ok(activityStream);
                            assert.lengthOf(activityStream.items, 3);

                            // 1. actor+target should have jack+(google,yahoo)+jane, and it would be most recent
                            let activity = activityStream.items[0];
                            assert.ok(activity.object['oae:collection']);
                            assert.lengthOf(activity.object['oae:collection'], 2);

                            // 2. actor+object aggregate should have: jack+google+(jane,branden)
                            activity = activityStream.items[1];
                            assert.ok(activity.target['oae:collection']);
                            assert.lengthOf(activity.target['oae:collection'], 2);

                            return callback();
                          });
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

  describe('Email', () => {
    /**
     * Test that verifies an email is sent to the recent commenters, and that private users are appropriately
     * scrubbed.
     */
    it('verify content-comment email and privacy', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge, 2: bart } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;
        const asBart = bart.restContext;

        const margeUpdate = {
          visibility: 'private',
          publicAlias: 'swappedFromPublicAlias'
        };

        assertUpdateUserSucceeds(asMarge, marge.user.id, margeUpdate, () => {
          createLink(
            asHomer,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              createComment(asMarge, link.id, '<script>Nice link.</script>\n\nWould click again', null, (
                error /* , margeUpdate */
              ) => {
                assert.notExists(error);

                collectAndFetchAllEmails((messages) => {
                  // There should be exactly one message, the one sent to homer (manager of content item receives content-comment notification)
                  assert.lengthOf(messages, 1);

                  const stringEmail = JSON.stringify(messages[0], null, 2);
                  const message = messages[0];

                  // Sanity check that the message is to homer
                  assert.strictEqual(message.to[0].address, homer.user.email);

                  // Ensure that the subject of the email contains the poster's name
                  assert.include(message.subject, 'swappedFromPublicAlias');

                  // Ensure some data expected to be in the email is there
                  assert.include(stringEmail, link.profilePath);
                  assert.include(stringEmail, link.displayName);

                  // Ensure marge's private info is *nowhere* to be found
                  assert.notInclude(stringEmail, marge.user.displayName);
                  assert.notInclude(stringEmail, marge.user.email);
                  assert.notInclude(stringEmail, marge.user.locale);

                  // The message probably contains the public alias, though
                  assert.include(stringEmail, 'swappedFromPublicAlias');

                  // The message should have escaped the HTML content in the original message
                  assert.notInclude(stringEmail, '<script>Nice link.</script>');

                  // The new line characters should've been converted into paragraphs
                  assert.include(stringEmail, 'Would click again</p>');

                  // Post a comment as bart and ensure the recent commenter, marge receives an email about it
                  createComment(asBart, link.id, 'It 404d', null, (error /* , bartComment */) => {
                    assert.notExists(error);

                    collectAndFetchAllEmails((emails) => {
                      // There should be 2 emails this time, one to the manager and one to the recent commenter, marge
                      assert.lengthOf(emails, 2);

                      const emailAddresses = [emails[0].to[0].address, emails[1].to[0].address];
                      assert.include(emailAddresses, marge.user.email);
                      assert.include(emailAddresses, homer.user.email);

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

    /**
     * Test that verifies an email is sent to the members when a content item is created, and that private users are
     * appropriately scrubbed.
     */
    it('verify content-create email and privacy', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge } = users;
        const asMarge = marge.restContext;

        // marge is private and homer is public
        const margeUpdate = {
          visibility: 'private',
          publicAlias: 'swappedFromPublicAlias'
        };
        assertUpdateUserSucceeds(asMarge, marge.user.id, margeUpdate, () => {
          // Create the link, sharing it with homer during the creation step. We will ensure he gets an email about it
          createLink(
            asMarge,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: [homer.user.id],
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              // homer should get an email, with marge's information scrubbed
              collectAndFetchAllEmails((messages) => {
                // There should be exactly one message, the one sent to homer
                assert.lengthOf(messages, 1);

                const stringEmail = JSON.stringify(messages[0]);
                const message = messages[0];

                // Sanity check that the message is to homer
                assert.strictEqual(message.to[0].address, homer.user.email);

                // Ensure some data expected to be in the email is there
                assert.include(stringEmail, link.profilePath);
                assert.include(stringEmail, link.displayName);

                // Ensure marge's private info is *nowhere* to be found
                assert.notInclude(stringEmail, marge.user.displayName);
                assert.notInclude(stringEmail, marge.user.email);
                assert.notInclude(stringEmail, marge.user.locale);

                // The message probably contains the public alias, though
                assert.include(stringEmail, 'swappedFromPublicAlias');

                return callback();
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies an email is sent to the target users when content is shared, and that private users are
     * appropriately scrubbed.
     */
    it('verify content-share email and privacy', (callback) => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: johnDoe, 1: janeDoe } = users;
        const asJaneDoe = janeDoe.restContext;

        // jane is private and jack is public
        const janeUpdate = {
          visibility: 'private',
          publicAlias: 'swappedFromPublicAlias'
        };

        assertUpdateUserSucceeds(asJaneDoe, janeDoe.user.id, janeUpdate, () => {
          // Create the link, then share it with jack. We will ensure that jack gets the email about the share
          createLink(
            asJaneDoe,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              // Collect the createLink activity
              collectAndFetchAllEmails((/* messages */) => {
                shareContent(asJaneDoe, link.id, [johnDoe.user.id], (error_) => {
                  assert.notExists(error_);

                  // jack should get an email, with jane's information scrubbed
                  collectAndFetchAllEmails((messages) => {
                    // There should be exactly one message, the one sent to jack
                    assert.lengthOf(messages, 1);

                    const stringEmail = JSON.stringify(messages[0]);
                    const message = messages[0];

                    // Sanity check that the message is to jack
                    assert.strictEqual(message.to[0].address, johnDoe.user.email);

                    // Ensure some data expected to be in the email is there
                    assert.include(stringEmail, link.profilePath);
                    assert.include(stringEmail, link.displayName);

                    // Ensure jane's private info is *nowhere* to be found
                    assert.notInclude(stringEmail, janeDoe.user.displayName);
                    assert.notInclude(stringEmail, janeDoe.user.email);
                    assert.notInclude(stringEmail, janeDoe.user.locale);

                    // The message probably contains the public alias, though
                    assert.include(stringEmail, 'swappedFromPublicAlias');

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
