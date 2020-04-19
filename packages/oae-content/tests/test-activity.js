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
import url from 'url';
import util from 'util';
import _ from 'underscore';

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

const PUBLIC = 'public';
const PRIVATE = 'private';
const LOGGED_IN = 'loggedin';

describe('Content Activity', () => {
  // Rest contexts that can be used for performing REST requests
  let anonymousCamRestContext = null;
  let camAdminRestContext = null;
  let anonymousGtRestContext = null;
  let globalAdminRestContext = null;

  let suitableFiles = null;
  let suitableSizes = null;

  /**
   * Function that will fill up the tenant admin and anymous rest context
   */
  before(callback => {
    // Prepare the rest contexts that can be used for performing REST requests
    anonymousGtRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.gt.host);
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();

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
  beforeEach(callback => {
    EmailTestsUtil.clearEmailCollections(callback);
  });

  /**
   * Set up some users and groups. One of the users will follow another user
   *
   * @param  {Function}   callback            Standard callback function
   * @param  {Object}     callback.user1      The first user as returned by `TestsUtil.generateTestUsers`
   * @param  {Object}     callback.user2      The second user as returned by `TestsUtil.generateTestUsers`. This user will follow user1
   * @param  {Object}     callback.user3      The third user as returned by `TestsUtil.generateTestUsers`
   * @param  {Object}     callback.user4      The fourth user as returned by `TestsUtil.generateTestUsers`
   * @param  {Object}     callback.user5      The fifth user as returned by `TestsUtil.generateTestUsers`
   * @param  {Object}     callback.group1     The first group as returned by `TestsUtil.generateTestGroups`
   * @param  {Object}     callback.group2     The second group as returned by `TestsUtil.generateTestGroups`
   */
  const _setup = function(callback) {
    // Generate some users
    TestsUtil.generateTestUsers(
      camAdminRestContext,
      7,
      (err, users, simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB) => {
        assert.ok(!err);

        // Generate some groups
        TestsUtil.generateTestGroups(simong.restContext, 2, (groupA, groupB) => {
          // Add regular members in both groups
          const groupAmembers = {};
          groupAmembers[groupMemberA.user.id] = 'member';
          RestAPI.Group.setGroupMembers(simong.restContext, groupA.group.id, groupAmembers, err => {
            assert.ok(!err);
            const groupBmembers = {};
            groupBmembers[groupMemberB.user.id] = 'member';
            RestAPI.Group.setGroupMembers(simong.restContext, groupB.group.id, groupBmembers, err => {
              assert.ok(!err);

              // Nico follows simong
              RestAPI.Following.follow(nico.restContext, simong.user.id, err => {
                assert.ok(!err);

                return callback(simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB);
              });
            });
          });
        });
      }
    );
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
  const _getActivity = function(activityStream, activityType, entityType, entityOaeId) {
    if (!activityStream) {
      return null;
    }

    return _.find(activityStream.items, activity => {
      return (
        activity['oae:activityType'] === activityType &&
        activity[entityType] &&
        activity[entityType]['oae:id'] === entityOaeId
      );
    });
  };

  /*!
   * Get the email from the email list with the given to address
   *
   * @param  {Object[]}          emails              The emails to search
   * @param  {String}            to                  The email address to which the email should be sent
   * @return {Object}                                The first email from the email list that matches the to address
   */
  const _getEmail = function(emails, to) {
    return _.find(emails, email => {
      return email.to[0].address === to;
    });
  };

  /**
   * Returns a function that will return a stream that points to the specified file.
   * That function can then be passed into those RestAPI methods which need to upload a file
   *
   * @param  {String}     filename    The file in the tests/data directory that should be returned as a stream.
   * @return {Function}               A function that returns a stream when executed.
   */
  const getFunctionThatReturnsFileStream = function(filename) {
    return function() {
      const file = path.join(__dirname, '/data/' + filename);
      return fs.createReadStream(file);
    };
  };

  describe('Routes', () => {
    /**
     * Test that verifies a content resource routes activities to its members when created, updated and shared
     */
    it('verify routing to content members', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, jack, jane, managerGroupMember) => {
        assert.ok(!err);

        // Create the group that will be a viewer of the content
        RestAPI.Group.createGroup(
          camAdminRestContext,
          'Viewer Group displayName',
          'Viewer Group Description',
          'public',
          'no',
          [],
          [],
          (err, viewerGroup) => {
            assert.ok(!err);

            // Create a group that will be a manager of the content
            RestAPI.Group.createGroup(
              camAdminRestContext,
              'Manager Group displayName',
              'Manager Group Description',
              'public',
              'no',
              [],
              [],
              (err, managerGroup) => {
                assert.ok(!err);

                // ManagerGroupMember should be a member of the manager group to verify indirect group member routing
                const membership = {};
                membership[managerGroupMember.user.id] = 'manager';
                RestAPI.Group.setGroupMembers(camAdminRestContext, managerGroup.id, membership, err => {
                  assert.ok(!err);

                  // Create a content item with manager group and viewer group as members.
                  RestAPI.Content.createLink(
                    jack.restContext,
                    {
                      displayName: 'Google',
                      description: 'Google',
                      visibility: PUBLIC,
                      link: 'http://www.google.ca',
                      managers: [managerGroup.id],
                      viewers: [viewerGroup.id],
                      folders: []
                    },
                    (err, link) => {
                      assert.ok(!err);

                      // Share the content item with jane
                      RestAPI.Content.shareContent(jack.restContext, link.id, [jane.user.id], err => {
                        assert.ok(!err);

                        // Update the content item
                        RestAPI.Content.updateContent(
                          jack.restContext,
                          link.id,
                          { description: 'Super awesome link' },
                          err => {
                            assert.ok(!err);

                            // Verify Jack got the create, share and update as he was the actor for all of them
                            ActivityTestsUtil.collectAndGetActivityStream(
                              jack.restContext,
                              jack.user.id,
                              null,
                              (err, activityStream) => {
                                assert.ok(!err);
                                assert.ok(_getActivity(activityStream, 'content-create', 'object', link.id));
                                assert.ok(_getActivity(activityStream, 'content-share', 'target', jane.user.id));
                                assert.ok(_getActivity(activityStream, 'content-update', 'object', link.id));

                                // Verify the manager group received the create, share and update as they are a content member
                                ActivityTestsUtil.collectAndGetActivityStream(
                                  camAdminRestContext,
                                  managerGroup.id,
                                  null,
                                  (err, activityStream) => {
                                    assert.ok(!err);
                                    assert.ok(_getActivity(activityStream, 'content-create', 'object', link.id));
                                    assert.ok(_getActivity(activityStream, 'content-share', 'target', jane.user.id));
                                    assert.ok(_getActivity(activityStream, 'content-update', 'object', link.id));

                                    // Verify the viewer group received only the create and update. only managers care about the sharing of the "object"
                                    ActivityTestsUtil.collectAndGetActivityStream(
                                      camAdminRestContext,
                                      viewerGroup.id,
                                      null,
                                      (err, activityStream) => {
                                        assert.ok(!err);
                                        assert.ok(_getActivity(activityStream, 'content-create', 'object', link.id));
                                        assert.ok(
                                          !_getActivity(activityStream, 'content-share', 'target', jane.user.id)
                                        );
                                        assert.ok(_getActivity(activityStream, 'content-update', 'object', link.id));

                                        // Verify the manager group *member* got the same activities as the manager group, as they are a member
                                        ActivityTestsUtil.collectAndGetActivityStream(
                                          camAdminRestContext,
                                          managerGroupMember.user.id,
                                          null,
                                          (err, activityStream) => {
                                            assert.ok(!err);
                                            assert.ok(
                                              _getActivity(activityStream, 'content-create', 'object', link.id)
                                            );
                                            assert.ok(
                                              _getActivity(activityStream, 'content-share', 'target', jane.user.id)
                                            );
                                            assert.ok(
                                              _getActivity(activityStream, 'content-update', 'object', link.id)
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
    it('verify content propagation to non-route activity feeds', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        // Create a private content item
        RestAPI.Content.createLink(
          camAdminRestContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PRIVATE,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // Share the content item with Jack. Jack will get the activity in his feed because he is the target, but he will not be in
            // the routes of the content item because he is not a manager. Despite this, we need to verify that Jack has the full content
            // item propagated to him as he does have access to it.
            RestAPI.Content.shareContent(camAdminRestContext, link.id, [jack.user.id], err => {
              assert.ok(!err);

              ActivityTestsUtil.collectAndGetActivityStream(
                camAdminRestContext,
                jack.user.id,
                null,
                (err, activityStream) => {
                  assert.ok(!err);
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
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies a comment activity is routed to recent commenters of a content item.
     */
    it('verify comment activity is routed to the recent commenters of a content item', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, simong, mrvisser, bert) => {
        assert.ok(!err);

        // Create a content item to be commented on
        RestAPI.Content.createLink(
          simong.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // Mrvisser is not a member, but he will comment on it
            RestAPI.Content.createComment(
              mrvisser.restContext,
              link.id,
              'This link clearly goes to Google.',
              null,
              (err, mrvisserComment) => {
                assert.ok(!err);

                // Bert retorts!
                RestAPI.Content.createComment(
                  bert.restContext,
                  link.id,
                  "You're wrong and you smell bad!",
                  null,
                  (err, bertComment) => {
                    assert.ok(!err);

                    // Mrvisser should have a notification and an activity about this because he was a recent commenter
                    ActivityTestsUtil.collectAndGetActivityStream(
                      mrvisser.restContext,
                      mrvisser.user.id,
                      null,
                      (err, activityStream) => {
                        assert.ok(!err);

                        // Should have exactly 1 activity, 2 aggregated comments
                        assert.strictEqual(activityStream.items.length, 1);
                        assert.strictEqual(activityStream.items[0].object['oae:collection'].length, 2);
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
     * Test that verifies that a comment activity is not routed to a recent commenter if they no longer have
     * access to the content item (e.g., it becomes private after they commented).
     */
    it('verify a comment activity is not routed to a recent commenter if they no longer have access to the content item', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, simong, mrvisser, bert) => {
        assert.ok(!err);

        // Create a content item to be commented on, bert is a member
        RestAPI.Content.createLink(
          simong.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [bert.user.id],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // Mrvisser is not a member, but he will comment on it
            RestAPI.Content.createComment(
              mrvisser.restContext,
              link.id,
              'This link clearly goes to Google.',
              null,
              (err, mrvisserComment) => {
                assert.ok(!err);

                // Force a collection before the content item goes private
                ActivityTestsUtil.collectAndGetActivityStream(mrvisser.restContext, mrvisser.user.id, null, err => {
                  assert.ok(!err);

                  // Simong has had enough of mrvisser's tom-foolery and makes the content item private
                  RestAPI.Content.updateContent(simong.restContext, link.id, { visibility: 'private' }, err => {
                    assert.ok(!err);

                    // Bert retorts!
                    RestAPI.Content.createComment(
                      bert.restContext,
                      link.id,
                      "You're wrong and you smell bad!",
                      null,
                      (err, bertComment) => {
                        assert.ok(!err);

                        // Mrvisser should only have the activity for the comment he made, not Bert's
                        ActivityTestsUtil.collectAndGetActivityStream(
                          mrvisser.restContext,
                          mrvisser.user.id,
                          null,
                          (err, activityStream) => {
                            assert.ok(!err);
                            assert.strictEqual(activityStream.items.length, 1);
                            assert.strictEqual(activityStream.items[0].object['oae:id'], mrvisserComment.id);
                            callback();
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
    });

    /**
     * Test that verifies that profile picture URLs in the comments in the activity stream are non-expiring.
     */
    it('verify a comment activity has a non-expiring profile picture URL', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, simong, mrvisser) => {
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
        RestAPI.User.uploadPicture(mrvisser.restContext, mrvisser.user.id, getPictureStream, cropArea, err => {
          assert.ok(!err);

          // Create a content item to be commented on
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: [],
              viewers: [],
              folders: []
            },
            (err, link) => {
              assert.ok(!err);

              // Mrvisser is not a member, but he will comment on it
              RestAPI.Content.createComment(
                mrvisser.restContext,
                link.id,
                'This link clearly goes to Google.',
                null,
                (err, mrvisserComment) => {
                  assert.ok(!err);

                  // Mrvisser should have a notification and an activity about this because he was a recent commenter
                  ActivityTestsUtil.collectAndGetActivityStream(
                    mrvisser.restContext,
                    mrvisser.user.id,
                    null,
                    (err, activityStream) => {
                      assert.ok(!err);
                      assert.strictEqual(activityStream.items.length, 1);
                      assert.strictEqual(activityStream.items[0].object['oae:id'], mrvisserComment.id);
                      assert.ok(activityStream.items[0].object.author.image);
                      assert.ok(activityStream.items[0].object.author.image.url);
                      assert.ok(!activityStream.items[0].object.author.image.url.includes('expired'));
                      callback();
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
     * Test that verifies that the "revision HTML" content of a content item
     * does not get persisted in activity streams
     */
    it('verify that collaborative document content is not persisted to cassandra', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, simon, branden, nico) => {
        assert.ok(!err);

        // Create a collaborative document with branden as a manager
        RestAPI.Content.createCollabDoc(
          simon.restContext,
          TestsUtil.generateTestUserId('collabdoc'),
          'description',
          'public',
          [branden.user.id],
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);

            // Branden edits a couple of things and publishes the document
            RestAPI.Content.joinCollabDoc(branden.restContext, contentObj.id, (err, data) => {
              assert.ok(!err);
              const etherpadClient = Etherpad.getClient(contentObj.id);
              const args = {
                padID: contentObj.etherpadPadId,
                text: 'Ehrmagod that document!'
              };
              etherpadClient.setText(args, err => {
                assert.ok(!err);
                ContentTestUtil.publishCollabDoc(contentObj.id, branden.user.id, () => {
                  // Route and aggregate the activity into branden's activity stream
                  ActivityTestsUtil.collectAndGetActivityStream(branden.restContext, branden.user.id, null, err => {
                    assert.ok(!err);

                    // Query branden's activity stream to get the item that was persisted
                    const activityStreamId = util.format('%s#activity', branden.user.id);
                    Cassandra.runQuery(
                      'SELECT * FROM "ActivityStreams" WHERE "activityStreamId" = ?',
                      [activityStreamId],
                      (err, rows) => {
                        assert.ok(!err);
                        assert.strictEqual(rows.length, 2);

                        // Ensure we get the revision activity, and that there is no latest
                        // revision content
                        const hash = Cassandra.rowToHash(rows[1]);
                        const activity = JSON.parse(hash.activity);
                        assert.strictEqual(activity['oae:activityType'], 'content-revision');
                        assert.strictEqual(activity.actor.id, branden.user.id);
                        assert.strictEqual(activity.object['oae:id'], contentObj.id);
                        assert.ok(!activity.object.content.latestRevision);

                        // Comment on the activity, ensuring there is no latest revision content
                        RestAPI.Content.createComment(
                          branden.restContext,
                          contentObj.id,
                          'Comment A',
                          null,
                          (err, commentA) => {
                            assert.ok(!err);
                            ActivityTestsUtil.collectAndGetActivityStream(
                              branden.restContext,
                              branden.user.id,
                              null,
                              err => {
                                Cassandra.runQuery(
                                  'SELECT * FROM "ActivityStreams" WHERE "activityStreamId" = ?',
                                  [activityStreamId],
                                  (err, rows) => {
                                    assert.ok(!err);
                                    assert.strictEqual(rows.length, 3);

                                    // Ensure we get the comment activity, and that there is no latest
                                    // revision content
                                    const hash = Cassandra.rowToHash(rows[2]);
                                    const activity = JSON.parse(hash.activity);
                                    assert.strictEqual(activity['oae:activityType'], 'content-comment');
                                    assert.strictEqual(activity.actor.id, branden.user.id);
                                    assert.strictEqual(activity.target['oae:id'], contentObj.id);
                                    assert.ok(!activity.target.content.latestRevision);

                                    // Share the activity, ensuring there is no latest revision content
                                    RestAPI.Content.shareContent(
                                      branden.restContext,
                                      contentObj.id,
                                      [nico.user.id],
                                      err => {
                                        assert.ok(!err);
                                        ActivityTestsUtil.collectAndGetActivityStream(
                                          branden.restContext,
                                          branden.user.id,
                                          null,
                                          err => {
                                            Cassandra.runQuery(
                                              'SELECT * FROM "ActivityStreams" WHERE "activityStreamId" = ?',
                                              [activityStreamId],
                                              (err, rows) => {
                                                assert.ok(!err);
                                                assert.strictEqual(rows.length, 4);

                                                // Ensure we get the share activity, and that there is no latest
                                                // revision content
                                                const hash = Cassandra.rowToHash(rows[3]);
                                                const activity = JSON.parse(hash.activity);
                                                assert.strictEqual(activity['oae:activityType'], 'content-share');
                                                assert.strictEqual(activity.actor.id, branden.user.id);
                                                assert.strictEqual(activity.object['oae:id'], contentObj.id);
                                                assert.ok(!activity.object.content.latestRevision);

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
    it('verify that publishing a collaborative document generates a notification', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, simon, branden, nico) => {
        assert.ok(!err);

        // Create a collaborative document where both Simon and Branden are managers and Nico as a viewer
        RestAPI.Content.createCollabDoc(
          simon.restContext,
          TestsUtil.generateTestUserId('collabdoc'),
          'description',
          'public',
          [branden.user.id],
          [],
          [nico.user.id],
          [],
          (err, contentObj) => {
            assert.ok(!err);

            RestAPI.Content.joinCollabDoc(branden.restContext, contentObj.id, (err, data) => {
              assert.ok(!err);

              // First clear emails delivered to this point
              EmailTestsUtil.collectAndFetchAllEmails(() => {
                // Branden edits a couple of things and publishes the document
                const etherpadClient = Etherpad.getClient(contentObj.id);
                const args = {
                  padID: contentObj.etherpadPadId,
                  text: 'Ehrmagod that document!'
                };
                etherpadClient.setText(args, err => {
                  assert.ok(!err);

                  // Let Branden publish the document
                  ContentTestUtil.publishCollabDoc(contentObj.id, branden.user.id, () => {
                    // An email should be sent to Simon and Nico
                    EmailTestsUtil.collectAndFetchAllEmails(emails => {
                      assert.strictEqual(emails.length, 2);

                      const simonEmail = _getEmail(emails, simon.user.email);
                      assert.ok(simonEmail);
                      assert.strictEqual(simonEmail.to[0].address, simon.user.email);
                      assert.strictEqual(
                        simonEmail.subject,
                        util.format('%s edited the document "%s"', branden.user.displayName, contentObj.displayName)
                      );
                      assert.notStrictEqual(simonEmail.html.indexOf(contentObj.profilePath), -1);

                      const nicoEmail = _getEmail(emails, nico.user.email);
                      assert.ok(nicoEmail);
                      assert.strictEqual(nicoEmail.to[0].address, nico.user.email);
                      assert.strictEqual(
                        nicoEmail.subject,
                        util.format('%s edited the document "%s"', branden.user.displayName, contentObj.displayName)
                      );
                      assert.notStrictEqual(nicoEmail.html.indexOf(contentObj.profilePath), -1);

                      // No email should have been sent to Branden
                      const brandenEmail = _getEmail(emails, branden.user.email);
                      assert.ok(!brandenEmail);

                      // There should be a notification in Simon's stream as he is a manager
                      ActivityTestsUtil.collectAndGetNotificationStream(simon.restContext, null, (err, data) => {
                        assert.ok(!err);
                        const notificationSimon = _getActivity(data, 'content-revision', 'object', contentObj.id);
                        assert.ok(notificationSimon);
                        assert.strictEqual(notificationSimon['oae:activityType'], 'content-revision');
                        assert.strictEqual(notificationSimon.actor['oae:id'], branden.user.id);
                        assert.strictEqual(notificationSimon.object['oae:id'], contentObj.id);

                        // There should be a notification in Nico's stream as he is a member
                        ActivityTestsUtil.collectAndGetNotificationStream(nico.restContext, null, (err, data) => {
                          assert.ok(!err);
                          const notificationNico = _getActivity(data, 'content-revision', 'object', contentObj.id);
                          assert.ok(notificationNico);
                          assert.strictEqual(notificationNico['oae:activityType'], 'content-revision');
                          assert.strictEqual(notificationNico.actor['oae:id'], branden.user.id);
                          assert.strictEqual(notificationNico.object['oae:id'], contentObj.id);

                          // There should be no notification in Branden's stream as he published the change
                          ActivityTestsUtil.collectAndGetNotificationStream(branden.restContext, null, (err, data) => {
                            assert.ok(!err);
                            const notificatioBranden = _getActivity(data, 'content-revision', 'object', contentObj.id);
                            assert.ok(!notificatioBranden);
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
    it('verify an activity is generated regardless of whether there was an update to a is collaborative document since the last revision', callback => {
      ContentTestUtil.createCollabDoc(camAdminRestContext, 2, 2, (err, collabdocData) => {
        const [contentObj, users, simon, nico] = collabdocData;
        // Set some text in the pad
        const etherpadClient = Etherpad.getClient(contentObj.id);
        const args = {
          padID: contentObj.etherpadPadId,
          text: 'Collaborative editing by Simon and Nico! Oooooh!'
        };
        etherpadClient.setText(args, err => {
          assert.ok(!err);

          // Lets assume that both users are editting the document. First, Simon leaves
          ContentTestUtil.publishCollabDoc(contentObj.id, simon.user.id, () => {
            // Now, Nico leaves WITHOUT making any *extra* edits to the document. But because
            // he made edits earlier, we should still generate an activity
            ContentTestUtil.publishCollabDoc(contentObj.id, nico.user.id, () => {
              // Assert that there is an aggregated activity for an updated document that holds
              // both Simon and Nico as the actors
              ActivityTestsUtil.collectAndGetActivityStream(nico.restContext, nico.user.id, null, (err, data) => {
                assert.ok(!err);
                ActivityTestsUtil.assertActivity(
                  data.items[0],
                  'content-revision',
                  'update',
                  [simon.user.id, nico.user.id],
                  contentObj.id
                );

                // Sanity-check there are 2 revisions, the initial empty one + the one "published" revision
                RestAPI.Content.getRevisions(nico.restContext, contentObj.id, null, null, (err, data) => {
                  assert.ok(!err);
                  assert.strictEqual(data.results.length, 2);

                  // Get the latest revision
                  RestAPI.Content.getRevision(
                    nico.restContext,
                    contentObj.id,
                    data.results[0].revisionId,
                    (err, revision) => {
                      assert.ok(!err);
                      assert.ok(revision);

                      // Assert the text is in the latest revision
                      assert.ok(revision.etherpadHtml.includes(args.text));
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

    /**
     * Verifies that a notification gets sent out to all the managers of a piece of content when restoring an older version.
     */
    it('verify that restoring a piece of content generates a notification', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users) => {
        assert.ok(!err);
        const simonCtx = _.values(users)[0].restContext;
        const brandenCtx = _.values(users)[1].restContext;
        const brandenId = _.keys(users)[1];
        const nicoCtx = _.values(users)[2].restContext;
        const nicoId = _.keys(users)[2];

        // Create a file where both Simon and Branden are managers and Nico as a viewer
        const name = TestsUtil.generateTestUserId('file');
        RestAPI.Content.createFile(
          simonCtx,
          {
            displayName: name,
            description: 'description',
            visibility: 'public',
            file: getFunctionThatReturnsFileStream('oae-video.png'),
            managers: [brandenId],
            viewers: [nicoId],
            folders: []
          },
          (err, content) => {
            assert.ok(!err);

            // Create a new revision
            RestAPI.Content.updateFileBody(
              simonCtx,
              content.id,
              getFunctionThatReturnsFileStream('apereo.jpg'),
              err => {
                assert.ok(!err);

                // Restore the original revision
                RestAPI.Content.restoreRevision(
                  brandenCtx,
                  content.id,
                  content.latestRevisionId,
                  (err, revisionObj) => {
                    assert.ok(!err);

                    // Verify the activity streams. All users should have received an activity
                    ActivityTestsUtil.collectAndGetActivityStream(brandenCtx, null, null, (err, data) => {
                      assert.ok(!err);
                      const activity = _getActivity(data, 'content-restored-revision', 'object', content.id);
                      assert.ok(activity);
                      assert.strictEqual(activity['oae:activityType'], 'content-restored-revision');
                      assert.strictEqual(activity.actor['oae:id'], brandenId);
                      assert.strictEqual(activity.object['oae:id'], content.id);

                      ActivityTestsUtil.collectAndGetActivityStream(simonCtx, null, null, (err, data) => {
                        assert.ok(!err);
                        const activity = _getActivity(data, 'content-restored-revision', 'object', content.id);
                        assert.ok(activity);
                        assert.strictEqual(activity['oae:activityType'], 'content-restored-revision');
                        assert.strictEqual(activity.actor['oae:id'], brandenId);
                        assert.strictEqual(activity.object['oae:id'], content.id);

                        ActivityTestsUtil.collectAndGetActivityStream(nicoCtx, null, null, (err, data) => {
                          assert.ok(!err);
                          const notificationSimon = _getActivity(
                            data,
                            'content-restored-revision',
                            'object',
                            content.id
                          );
                          assert.ok(notificationSimon);
                          assert.strictEqual(notificationSimon['oae:activityType'], 'content-restored-revision');
                          assert.strictEqual(notificationSimon.actor['oae:id'], brandenId);
                          assert.strictEqual(notificationSimon.object['oae:id'], content.id);

                          // There should also be a notification in Simon's stream as he is a manager
                          ActivityTestsUtil.collectAndGetNotificationStream(simonCtx, null, (err, data) => {
                            assert.ok(!err);
                            const notificationSimon = _getActivity(
                              data,
                              'content-restored-revision',
                              'object',
                              content.id
                            );
                            assert.ok(notificationSimon);
                            assert.strictEqual(notificationSimon['oae:activityType'], 'content-restored-revision');
                            assert.strictEqual(notificationSimon.actor['oae:id'], brandenId);
                            assert.strictEqual(notificationSimon.object['oae:id'], content.id);

                            // There should be no notification in Nico's stream as he is not a manager
                            ActivityTestsUtil.collectAndGetNotificationStream(nicoCtx, null, (err, data) => {
                              assert.ok(!err);
                              const notificationNico = _getActivity(
                                data,
                                'content-restored-revision',
                                'object',
                                content.id
                              );
                              assert.ok(!notificationNico);
                              callback();
                            });
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

    /**
     * Test that verifies that content-share or content-add-to-library activities are routed to the content's activity stream
     */
    it('verify content-share or content-add-to-library activities are not routed to the content activity stream', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 4, (err, users, simon, nico, bert, stuart) => {
        assert.ok(!err);

        RestAPI.Content.createLink(
          simon.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, contentObj) => {
            assert.ok(!err);

            // Make Nico a private user and add the file into his library, no activities should be sent
            RestAPI.User.updateUser(nico.restContext, nico.user.id, { visibility: 'private' }, err => {
              assert.ok(!err);
              RestAPI.Content.shareContent(nico.restContext, contentObj.id, [nico.user.id], err => {
                assert.ok(!err);

                // Route and deliver activities
                ActivityTestsUtil.collectAndGetActivityStream(nico.restContext, null, null, err => {
                  assert.ok(!err);

                  // Assert they didn't end up in the content activity stream
                  ActivityDAO.getActivities(contentObj.id + '#activity', null, 25, (err, activities) => {
                    assert.ok(!err);
                    // Assert that we didn't add the `content-add-to-library` activity by asserting the latest activity in the stream is `content-create`
                    assert.strictEqual(activities[0]['oae:activityType'], 'content-create');

                    // Try it with a public user
                    RestAPI.Content.shareContent(bert.restContext, contentObj.id, [bert.user.id], err => {
                      assert.ok(!err);

                      // Route and deliver activities
                      ActivityTestsUtil.collectAndGetActivityStream(bert.restContext, null, null, err => {
                        assert.ok(!err);

                        // Assert they didn't end up in the content activity stream
                        ActivityDAO.getActivities(contentObj.id + '#activity', null, 25, (err, activities) => {
                          assert.ok(!err);
                          // Assert that we didn't add the `content-add-to-library` activity by asserting the latest activity in the stream is `content-create`
                          assert.strictEqual(activities[0]['oae:activityType'], 'content-create');

                          // Assert that content-share activities do not end up on the activity stream
                          RestAPI.Content.shareContent(bert.restContext, contentObj.id, [stuart.user.id], err => {
                            assert.ok(!err);

                            // Route and deliver activities
                            ActivityTestsUtil.collectAndGetActivityStream(stuart.restContext, null, null, err => {
                              assert.ok(!err);

                              // Assert they didn't end up in the content activity stream
                              ActivityDAO.getActivities(contentObj.id + '#activity', null, 25, (err, activities) => {
                                assert.ok(!err);
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
    it('verify comment activity is routed to the managers and recent contributers notification stream of a private content item', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 4, (err, users, simon, nico, bert, stuart) => {
        assert.ok(!err);

        RestAPI.Content.createLink(
          simon.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [nico.user.id],
            viewers: [bert.user.id, stuart.user.id],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            RestAPI.Content.createComment(bert.restContext, link.id, 'Comment A', null, (err, commentA) => {
              assert.ok(!err);

              // Assert that the managers got it
              ActivityTestsUtil.collectAndGetNotificationStream(simon.restContext, null, (err, activityStream) => {
                assert.ok(!err);
                assert.ok(
                  _.find(activityStream.items, activity => {
                    return activity['oae:activityType'] === 'content-comment';
                  })
                );

                ActivityTestsUtil.collectAndGetNotificationStream(nico.restContext, null, (err, activityStream) => {
                  assert.ok(!err);
                  assert.ok(
                    _.find(activityStream.items, activity => {
                      return activity['oae:activityType'] === 'content-comment';
                    })
                  );

                  // Create another comment and assert that both the managers and the recent contributers get a notification
                  RestAPI.Content.createComment(nico.restContext, link.id, 'Comment A', null, (err, commentA) => {
                    assert.ok(!err);

                    // Because Bert made a comment previously, he should get a notification as well
                    ActivityTestsUtil.collectAndGetNotificationStream(bert.restContext, null, (err, activityStream) => {
                      assert.ok(!err);
                      const commentActivities = _.filter(activityStream.items, activity => {
                        return activity['oae:activityType'] === 'content-comment';
                      });
                      assert.ok(commentActivities.length, 2);

                      // Sanity-check that the managers got it as well
                      ActivityTestsUtil.collectAndGetNotificationStream(
                        nico.restContext,
                        null,
                        (err, activityStream) => {
                          assert.ok(!err);
                          const commentActivities = _.filter(activityStream.items, activity => {
                            return activity['oae:activityType'] === 'content-comment';
                          });
                          assert.ok(commentActivities.length, 2);

                          ActivityTestsUtil.collectAndGetNotificationStream(
                            simon.restContext,
                            null,
                            (err, activityStream) => {
                              assert.ok(!err);
                              const commentActivities = _.filter(activityStream.items, activity => {
                                return activity['oae:activityType'] === 'content-comment';
                              });
                              assert.ok(commentActivities.length, 2);

                              return callback();
                            }
                          );
                        }
                      );
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
    // In order to test download url expiry, we need to
    // override the `Date.now` function, After each test
    // ensure it is set to the proper function
    const _originalDateNow = Date.now;
    afterEach(callback => {
      Date.now = _originalDateNow;
      return callback();
    });

    /**
     * Test that verifies the properties of the content entity
     */
    it('verify the content entity model contains the correct content information', callback => {
      /*!
       * Function used to verify the status of the "static" link content item in this test case. This basically means
       * everything except the preview items.
       */
      const _assertStandardLinkModel = function(entity, contentId) {
        const { resourceId } = AuthzUtil.getResourceFromId(contentId);
        assert.strictEqual(entity['oae:visibility'], 'public');
        assert.strictEqual(entity['oae:resourceSubType'], 'link');
        assert.strictEqual(entity['oae:profilePath'], '/content/camtest/' + resourceId);
        assert.strictEqual(entity.displayName, 'Google');
        assert.strictEqual(entity.objectType, 'content');
        assert.strictEqual(entity['oae:id'], contentId);
        assert.strictEqual(entity.url, 'http://' + global.oaeTests.tenants.cam.host + '/content/camtest/' + resourceId);
        assert.ok(entity.id.includes(contentId));
      };

      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        // Generate an activity with the content
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // Verify model with no preview state
            ActivityTestsUtil.collectAndGetActivityStream(
              jack.restContext,
              jack.user.id,
              null,
              (err, activityStream) => {
                assert.ok(!err);
                const entity = activityStream.items[0].object;
                _assertStandardLinkModel(entity, link.id);
                assert.ok(!entity.image);
                assert.ok(!entity['oae:wideImage']);

                // Get the global admin context on the camtest tenant
                RestAPI.Admin.loginOnTenant(
                  globalAdminRestContext,
                  global.oaeTests.tenants.localhost.alias,
                  null,
                  (err, globalTenantAdminRestContext) => {
                    assert.ok(!err);

                    // Get the revision ID
                    RestAPI.Content.getRevisions(globalTenantAdminRestContext, link.id, null, 1, (err, revisions) => {
                      assert.ok(!err);
                      const { revisionId } = revisions.results[0];

                      // Set the preview to error status
                      RestAPI.Content.setPreviewItems(
                        globalTenantAdminRestContext,
                        link.id,
                        revisionId,
                        'error',
                        {},
                        {},
                        {},
                        {},
                        err => {
                          assert.ok(!err);

                          // Verify that the preview does not display
                          ActivityTestsUtil.collectAndGetActivityStream(
                            jack.restContext,
                            jack.user.id,
                            null,
                            (err, activityStream) => {
                              assert.ok(!err);

                              const entity = activityStream.items[0].object;
                              _assertStandardLinkModel(entity, link.id);
                              assert.ok(!entity.image);
                              assert.ok(!entity['oae:wideImage']);

                              // Set the preview to ignored status with no files
                              RestAPI.Content.setPreviewItems(
                                globalTenantAdminRestContext,
                                link.id,
                                revisionId,
                                'ignored',
                                {},
                                {},
                                {},
                                {},
                                err => {
                                  assert.ok(!err);

                                  // Verify that the preview still does not display
                                  ActivityTestsUtil.collectAndGetActivityStream(
                                    jack.restContext,
                                    jack.user.id,
                                    null,
                                    (err, activityStream) => {
                                      assert.ok(!err);

                                      const entity = activityStream.items[0].object;
                                      _assertStandardLinkModel(entity, link.id);
                                      assert.ok(!entity.image);
                                      assert.ok(!entity['oae:wideImage']);

                                      // Set the preview to done status with files
                                      RestAPI.Content.setPreviewItems(
                                        globalTenantAdminRestContext,
                                        link.id,
                                        revisionId,
                                        'done',
                                        suitableFiles,
                                        suitableSizes,
                                        {},
                                        {},
                                        err => {
                                          assert.ok(!err);

                                          // Verify that the previews are returned in the activity
                                          ActivityTestsUtil.collectAndGetActivityStream(
                                            jack.restContext,
                                            jack.user.id,
                                            null,
                                            (err, activityStream) => {
                                              assert.ok(!err);

                                              const entity = activityStream.items[0].object;
                                              _assertStandardLinkModel(entity, link.id);
                                              assert.ok(entity.image);
                                              assert.strictEqual(
                                                entity.image.width,
                                                PreviewConstants.SIZES.IMAGE.THUMBNAIL
                                              );
                                              assert.strictEqual(
                                                entity.image.height,
                                                PreviewConstants.SIZES.IMAGE.THUMBNAIL
                                              );
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
                                              let signedDownloadUrl = new URL(
                                                entity['oae:wideImage'].url,
                                                'http://localhost'
                                              );
                                              RestUtil.performRestRequest(
                                                anonymousGtRestContext,
                                                signedDownloadUrl.pathname,
                                                'GET',
                                                TestsUtil.objectifySearchParams(signedDownloadUrl.searchParams),
                                                (err, body, response) => {
                                                  assert.ok(!err);
                                                  assert.strictEqual(response.statusCode, 204);

                                                  signedDownloadUrl = new URL(entity.image.url, 'http://localhost');
                                                  RestUtil.performRestRequest(
                                                    anonymousGtRestContext,
                                                    signedDownloadUrl.pathname,
                                                    'GET',
                                                    TestsUtil.objectifySearchParams(signedDownloadUrl.searchParams),
                                                    (err, body, response) => {
                                                      assert.ok(!err);
                                                      assert.strictEqual(response.statusCode, 204);

                                                      // Jump ahead in time by 5 years, test-drive a hovercar and check if the signatures still work
                                                      const now = Date.now();
                                                      Date.now = function() {
                                                        return now + 5 * 365 * 24 * 60 * 60 * 1000;
                                                      };

                                                      // Ensure the standard and wide image can still be downloaded 5y in the future by even an anonymous user on another tenant
                                                      signedDownloadUrl = new URL(
                                                        entity['oae:wideImage'].url,
                                                        'http://localhost'
                                                      );
                                                      RestUtil.performRestRequest(
                                                        anonymousGtRestContext,
                                                        signedDownloadUrl.pathname,
                                                        'GET',
                                                        TestsUtil.objectifySearchParams(signedDownloadUrl.searchParams),
                                                        (err, body, response) => {
                                                          assert.ok(!err);
                                                          assert.strictEqual(response.statusCode, 204);

                                                          signedDownloadUrl = new URL(
                                                            entity.image.url,
                                                            'http://localhost'
                                                          );
                                                          RestUtil.performRestRequest(
                                                            anonymousGtRestContext,
                                                            signedDownloadUrl.pathname,
                                                            'GET',
                                                            TestsUtil.objectifySearchParams(
                                                              signedDownloadUrl.searchParams
                                                            ),
                                                            (err, body, response) => {
                                                              assert.ok(!err);
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
      });
    });

    /**
     * Test that verifies the properties of a comment entity
     */
    it('verify the comment entity model contains the correct comment information', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        // Generate an activity with the content
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // Create 3 comments, including one reply. We want to make sure the context is properly aggregated in these comments as their activities are delivered.
            RestAPI.Content.createComment(jack.restContext, link.id, 'Comment A', null, (err, commentA) => {
              assert.ok(!err);

              RestAPI.Content.createComment(jack.restContext, link.id, 'Comment B', null, (err, commentB) => {
                assert.ok(!err);

                RestAPI.Content.createComment(
                  jack.restContext,
                  link.id,
                  'Reply Comment A',
                  commentA.created,
                  (err, replyCommentA) => {
                    if (err) console.log(err);
                    assert.ok(!err);

                    ActivityTestsUtil.collectAndGetActivityStream(
                      jack.restContext,
                      jack.user.id,
                      null,
                      (err, activityStream) => {
                        assert.ok(!err);
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
                        const _validateComment = function(entity, comment, replyToComment) {
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
                        activity.object['oae:collection'].forEach(entity => {
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

  describe('Activity Privacy', () => {
    /**
     * Test that verifies that a public, loggedin and private content activity entities are propagated only to appropriate users
     */
    it('verify a public, loggedin and private content activity entities are propagated only to appropriate users', callback => {
      // Create a mix of public, loggedin, private users and groups from public and private tenants
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
        // Follow the publicTenant0.publicUser with the others
        const followers = [
          publicTenant0.loggedinUser,
          publicTenant0.privateUser,
          publicTenant1.publicUser,
          publicTenant1.loggedinUser,
          publicTenant1.privateUser
        ];

        const publicTenant0PublicUserId = publicTenant0.publicUser.user.id;
        const publicTenant0LoggedinUserId = publicTenant0.loggedinUser.user.id;
        const publicTenant0PrivateUserId = publicTenant0.privateUser.user.id;
        const publicTenant1PublicUserId = publicTenant1.publicUser.user.id;
        const publicTenant1LoggedinUserId = publicTenant1.loggedinUser.user.id;
        const publicTenant1PrivateUserId = publicTenant1.privateUser.user.id;

        FollowingTestsUtil.followByAll(publicTenant0.publicUser.user.id, followers, () => {
          // Create a public, loggedin and private content item to distribute to followers of the actor user
          RestAPI.Content.createLink(
            publicTenant0.publicUser.restContext,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: [],
              viewers: [publicTenant1.publicUser.user.id],
              folders: []
            },
            (err, publicLink) => {
              assert.ok(!err);
              RestAPI.Content.createLink(
                publicTenant0.publicUser.restContext,
                {
                  displayName: 'Google',
                  description: 'Google',
                  visibility: LOGGED_IN,
                  link: 'http://www.google.ca',
                  managers: [],
                  viewers: [publicTenant1.publicUser.user.id],
                  folders: []
                },
                (err, loggedinLink) => {
                  assert.ok(!err);
                  RestAPI.Content.createLink(
                    publicTenant0.publicUser.restContext,
                    {
                      displayName: 'Google',
                      description: 'Google',
                      visibility: PRIVATE,
                      link: 'http://www.google.ca',
                      managers: [],
                      viewers: [publicTenant1.publicUser.user.id],
                      folders: []
                    },
                    (err, privateLink) => {
                      assert.ok(!err);

                      // Ensure the user who created them got all 3 content items aggregated in their feed
                      ActivityTestsUtil.collectAndGetActivityStream(
                        publicTenant0.publicUser.restContext,
                        null,
                        null,
                        (err, result) => {
                          assert.ok(!err);
                          ActivityTestsUtil.assertActivity(
                            result.items[0],
                            'content-create',
                            'create',
                            publicTenant0PublicUserId,
                            [publicLink.id, loggedinLink.id, privateLink.id],
                            publicTenant1.publicUser.user.id
                          );

                          // Ensure the loggedin user of the same tenant gets 2 of the content items in their feed: public and loggedin
                          ActivityTestsUtil.collectAndGetActivityStream(
                            publicTenant0.loggedinUser.restContext,
                            null,
                            null,
                            (err, result) => {
                              assert.ok(!err);
                              ActivityTestsUtil.assertActivity(
                                result.items[0],
                                'content-create',
                                'create',
                                publicTenant0PublicUserId,
                                [publicLink.id, loggedinLink.id],
                                publicTenant1.publicUser.user.id
                              );

                              // Ensure the public user from another tenant gets all 3 of the content items in their feed because they were made a member. This
                              // ensures that even if the tenant propagation fails on the content item, the association propagation still includes them
                              ActivityTestsUtil.collectAndGetActivityStream(
                                publicTenant1.publicUser.restContext,
                                null,
                                null,
                                (err, result) => {
                                  assert.ok(!err);
                                  ActivityTestsUtil.assertActivity(
                                    result.items[0],
                                    'content-create',
                                    'create',
                                    publicTenant0PublicUserId,
                                    [publicLink.id, loggedinLink.id, privateLink.id],
                                    publicTenant1.publicUser.user.id
                                  );

                                  // Ensure the loggedin user from another tenant only gets the public content item since they are not a member and cannot see the loggedin one
                                  ActivityTestsUtil.collectAndGetActivityStream(
                                    publicTenant1.loggedinUser.restContext,
                                    null,
                                    null,
                                    (err, result) => {
                                      assert.ok(!err);
                                      ActivityTestsUtil.assertActivity(
                                        result.items[0],
                                        'content-create',
                                        'create',
                                        publicTenant0PublicUserId,
                                        publicLink.id,
                                        publicTenant1.publicUser.user.id
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
    it('verify content-create and content-update activities are posted when content is created and updated', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        // Generate an activity with the content
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            RestAPI.Content.updateContent(jack.restContext, link.id, { description: 'Super awesome link' }, err => {
              assert.ok(!err);

              ActivityTestsUtil.collectAndGetActivityStream(
                jack.restContext,
                jack.user.id,
                null,
                (err, activityStream) => {
                  assert.ok(!err);
                  const createActivity = _getActivity(activityStream, 'content-create', 'object', link.id);
                  const updateActivity = _getActivity(activityStream, 'content-update', 'object', link.id);
                  assert.ok(createActivity);
                  assert.strictEqual(createActivity.verb, 'create');
                  assert.ok(updateActivity);
                  assert.strictEqual(updateActivity.verb, 'update');
                  return callback();
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test to verify the revision id gets updated in the activity when a new revision is posted
     */
    it('verify content-update activities have updated previews', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        RestAPI.Content.createFile(
          jack.restContext,
          {
            displayName: 'name',
            description: 'description',
            visibility: 'public',
            file: getFunctionThatReturnsFileStream('oae-video.png'),
            managers: [],
            viewers: [],
            folders: []
          },
          (err, content) => {
            assert.ok(!err);

            // Create a new revision
            RestAPI.Content.updateFileBody(
              jack.restContext,
              content.id,
              getFunctionThatReturnsFileStream('apereo.jpg'),
              err => {
                assert.ok(!err);

                ActivityTestsUtil.collectAndGetActivityStream(
                  jack.restContext,
                  jack.user.id,
                  null,
                  (err, activityStream) => {
                    assert.ok(!err);
                    const createActivity = _getActivity(activityStream, 'content-create', 'object', content.id);

                    const updateActivity = _getActivity(activityStream, 'content-revision', 'object', content.id);
                    assert.ok(createActivity);
                    assert.ok(updateActivity);
                    assert.notStrictEqual(
                      createActivity.object['oae:revisionId'],
                      updateActivity.object['oae:revisionId']
                    );
                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that a content-share activity is generated when a content item is shared.
     */
    it('verify a content-share activity is generated when a content item is shared', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        RestAPI.Content.createLink(
          camAdminRestContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // Try and generate a share activity
            RestAPI.Content.shareContent(camAdminRestContext, link.id, [jack.user.id], err => {
              assert.ok(!err);

              ActivityTestsUtil.collectAndGetActivityStream(
                camAdminRestContext,
                jack.user.id,
                null,
                (err, activityStream) => {
                  assert.ok(!err);
                  const shareActivity = _getActivity(activityStream, 'content-share', 'object', link.id);
                  assert.ok(shareActivity);
                  assert.strictEqual(shareActivity.verb, 'share');
                  callback();
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies that when a user's role is updated, a content-update-member-role activity is generated.
     */
    it('verify a content-update-member-role activity is generated when a user role is updated on a content item', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
        assert.ok(!err);

        // Create a link whose member we can promote to manager
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [jane.user.id],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // Update the member's role to manager
            const roleChange = {};
            roleChange[jane.user.id] = 'manager';
            RestAPI.Content.updateMembers(jack.restContext, link.id, roleChange, err => {
              assert.ok(!err);

              // Ensure they have the content-update-member-role activity in their activity feed
              ActivityTestsUtil.collectAndGetActivityStream(
                jack.restContext,
                jack.user.id,
                null,
                (err, activityStream) => {
                  assert.ok(!err);
                  ActivityTestsUtil.assertActivity(
                    activityStream.items[0],
                    'content-update-member-role',
                    'update',
                    jack.user.id,
                    jane.user.id,
                    link.id
                  );
                  return callback();
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies that a content-revision activity is generated when a content item's body has been updated / uploaded.
     */
    it("verify a content-revision activity is generated when a content item's body has been updated", callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        // Create a revisable content item
        RestAPI.Content.createFile(
          jack.restContext,
          {
            displayName: 'Test Content 1',
            descritpion: 'Test content description 1',
            visibility: 'private',
            file: getFunctionThatReturnsFileStream('oae-video.png'),
            managers: [],
            viewers: [],
            folders: []
          },
          (err, content) => {
            assert.ok(!err);
            assert.ok(content);

            // Create a new version
            RestAPI.Content.updateFileBody(
              jack.restContext,
              content.id,
              getFunctionThatReturnsFileStream('apereo.jpg'),
              err => {
                assert.ok(!err);

                // Verify the revision activity was created for jack
                ActivityTestsUtil.collectAndGetActivityStream(
                  camAdminRestContext,
                  jack.user.id,
                  null,
                  (err, activityStream) => {
                    assert.ok(!err);
                    const revisionActivity = _getActivity(activityStream, 'content-revision', 'object', content.id);
                    assert.ok(revisionActivity);
                    assert.strictEqual(revisionActivity.verb, 'update');

                    // Also verify that a content-update activity *doesn't* get generated. no one will want to see both a revision and a meta-data update
                    assert.ok(!_getActivity(activityStream, 'content-update', 'object', content.id));

                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that a content-add-to-library activity is generated when a user adds a content item to their own library
     */
    it('verify a content-add-to-library activity is generated when a user adds a content item to their own library', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        RestAPI.Content.createLink(
          camAdminRestContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // Jack adds the content item to his own library
            RestAPI.Content.shareContent(jack.restContext, link.id, [jack.user.id], err => {
              assert.ok(!err);

              ActivityTestsUtil.collectAndGetActivityStream(
                camAdminRestContext,
                jack.user.id,
                null,
                (err, activityStream) => {
                  assert.ok(!err);
                  const addActivity = _getActivity(activityStream, 'content-add-to-library', 'object', link.id);
                  assert.ok(addActivity);
                  assert.strictEqual(addActivity.verb, 'add');
                  callback();
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies that a content-update-visibility activity is generated when a content's visibility is updated
     */
    it("verify a content-update-visibility activity is generated when a content item's visibility is updated", callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        RestAPI.Content.createLink(
          camAdminRestContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [jack.user.id],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // Jack adds the content item to his own library
            RestAPI.Content.updateContent(camAdminRestContext, link.id, { visibility: 'private' }, err => {
              assert.ok(!err);

              ActivityTestsUtil.collectAndGetActivityStream(
                camAdminRestContext,
                jack.user.id,
                null,
                (err, activityStream) => {
                  assert.ok(!err);
                  const updateVisibilityActivity = _getActivity(
                    activityStream,
                    'content-update-visibility',
                    'object',
                    link.id
                  );
                  assert.ok(updateVisibilityActivity);
                  assert.strictEqual(updateVisibilityActivity.verb, 'update');
                  callback();
                }
              );
            });
          }
        );
      });
    });
  });

  describe('Activity Aggregation', () => {
    /// /////////////////
    // CONTENT CREATE //
    /// /////////////////

    /**
     * Test that verifies that when multiple content-create activities are done by the same actor, the content items get
     * aggregated into a collection.
     */
    it('verify content-create activities are pivoted by actor', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        // Create a google link
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, googleLink) => {
            assert.ok(!err);

            // Create a Yahoo link
            RestAPI.Content.createLink(
              jack.restContext,
              {
                displayName: 'Yahoo!',
                description: 'Yahoo!',
                visibility: PUBLIC,
                link: 'http://www.yahoo.ca',
                managers: [],
                viewers: [],
                folders: []
              },
              (err, yahooLink) => {
                assert.ok(!err);

                // Verify the activities were aggregated into one, pivoted by actor
                ActivityTestsUtil.collectAndGetActivityStream(jack.restContext, null, null, (err, activityStream) => {
                  assert.ok(!err);
                  assert.ok(activityStream);
                  assert.strictEqual(activityStream.items.length, 1);

                  const aggregate = _getActivity(activityStream, 'content-create', 'actor', jack.user.id);
                  assert.ok(aggregate.object);
                  assert.ok(aggregate.object['oae:collection']);
                  assert.strictEqual(aggregate.object['oae:collection'].length, 2);

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
    it('verify when a content-create activity is redelivered, it deletes the previous one', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        // Create a google link
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, googleLink) => {
            assert.ok(!err);

            // Force a collection of activities so that the individual activity is delivered
            ActivityTestsUtil.collectAndGetActivityStream(jack.restContext, null, null, (err, activityStream) => {
              assert.ok(!err);
              assert.ok(activityStream);
              assert.ok(activityStream.items.length, 1);

              // Create a Yahoo link
              RestAPI.Content.createLink(
                jack.restContext,
                {
                  displayName: 'Yahoo!',
                  description: 'Yahoo!',
                  visibility: PUBLIC,
                  link: 'http://www.yahoo.ca',
                  managers: [],
                  viewers: [],
                  folders: []
                },
                (err, yahooLink) => {
                  assert.ok(!err);

                  // Collect again and ensure we still only have one activity
                  ActivityTestsUtil.collectAndGetActivityStream(jack.restContext, null, null, (err, activityStream) => {
                    assert.ok(!err);
                    assert.ok(activityStream);
                    assert.ok(activityStream.items.length, 1);

                    // Rinse and repeat once to ensure that the aggregates are removed properly as well
                    RestAPI.Content.createLink(
                      jack.restContext,
                      {
                        displayName: 'Apereo!',
                        description: 'Apereo!',
                        visibility: PUBLIC,
                        link: 'http://www.apereo.org',
                        managers: [],
                        viewers: [],
                        folders: []
                      },
                      (err, apereoLink) => {
                        assert.ok(!err);

                        // Collect again and ensure we still only have one activity
                        ActivityTestsUtil.collectAndGetActivityStream(
                          jack.restContext,
                          null,
                          null,
                          (err, activityStream) => {
                            assert.ok(!err);
                            assert.ok(activityStream);
                            assert.ok(activityStream.items.length, 1);
                            callback();
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
     * Test that verifies the folder-create activity when there are no extra members
     */
    it('verify no extra members', callback => {
      _setup((simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB) => {
        RestAPI.Content.createLink(
          simong.restContext,
          {
            displayName: 'Apereo!',
            description: 'Apereo!',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // The actor should receive an activity
            ActivityTestsUtil.assertFeedContainsActivity(
              simong.restContext,
              simong.user.id,
              'content-create',
              ActivityConstants.verbs.CREATE,
              simong.user.id,
              link.id,
              null,
              () => {
                // Users who follows the actor receive the activity
                ActivityTestsUtil.assertFeedContainsActivity(
                  nico.restContext,
                  nico.user.id,
                  'content-create',
                  ActivityConstants.verbs.CREATE,
                  simong.user.id,
                  link.id,
                  null,
                  () => {
                    // Everyone else gets nothing
                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                      bert.restContext,
                      bert.user.id,
                      'content-create',
                      () => {
                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                          stuart.restContext,
                          stuart.user.id,
                          'content-create',
                          () => {
                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                              stephen.restContext,
                              stephen.user.id,
                              'content-create',
                              () => {
                                ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                  groupMemberA.restContext,
                                  groupMemberA.user.id,
                                  'content-create',
                                  () => {
                                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                      groupMemberB.restContext,
                                      groupMemberB.user.id,
                                      'content-create',
                                      () => {
                                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                          groupMemberA.restContext,
                                          groupA.group.id,
                                          'content-create',
                                          () => {
                                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                              groupMemberB.restContext,
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
     * Test that verifies the folder-create activity when there is one extra user
     */
    it('verify one extra user', callback => {
      _setup((simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB) => {
        RestAPI.Content.createLink(
          simong.restContext,
          {
            displayName: 'Apereo!',
            description: 'Apereo!',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: [bert.user.id],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // The actor should receive an activity
            ActivityTestsUtil.assertFeedContainsActivity(
              simong.restContext,
              simong.user.id,
              'content-create',
              ActivityConstants.verbs.CREATE,
              simong.user.id,
              link.id,
              bert.user.id,
              () => {
                // Users who follows the actor receive the activity
                ActivityTestsUtil.assertFeedContainsActivity(
                  nico.restContext,
                  nico.user.id,
                  'content-create',
                  ActivityConstants.verbs.CREATE,
                  simong.user.id,
                  link.id,
                  bert.user.id,
                  () => {
                    // The user who was made a member gets an activity
                    ActivityTestsUtil.assertFeedContainsActivity(
                      bert.restContext,
                      bert.user.id,
                      'content-create',
                      ActivityConstants.verbs.CREATE,
                      simong.user.id,
                      link.id,
                      bert.user.id,
                      () => {
                        // Everyone else gets nothing
                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                          stuart.restContext,
                          stuart.user.id,
                          'content-create',
                          () => {
                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                              stephen.restContext,
                              stephen.user.id,
                              'content-create',
                              () => {
                                ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                  groupMemberA.restContext,
                                  groupMemberA.user.id,
                                  'content-create',
                                  () => {
                                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                      groupMemberB.restContext,
                                      groupMemberB.user.id,
                                      'content-create',
                                      () => {
                                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                          groupMemberA.restContext,
                                          groupA.group.id,
                                          'content-create',
                                          () => {
                                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                              groupMemberB.restContext,
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
     * Test that verifies the folder-create activity when there is one extra group
     */
    it('verify one extra group', callback => {
      _setup((simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB) => {
        RestAPI.Content.createLink(
          simong.restContext,
          {
            displayName: 'Apereo!',
            description: 'Apereo!',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: [groupA.group.id],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // The actor should receive an activity
            ActivityTestsUtil.assertFeedContainsActivity(
              simong.restContext,
              simong.user.id,
              'content-create',
              ActivityConstants.verbs.CREATE,
              simong.user.id,
              link.id,
              groupA.group.id,
              () => {
                // Users who follow the actor receive the activity
                ActivityTestsUtil.assertFeedContainsActivity(
                  nico.restContext,
                  nico.user.id,
                  'content-create',
                  ActivityConstants.verbs.CREATE,
                  simong.user.id,
                  link.id,
                  groupA.group.id,
                  () => {
                    // The group who was made a member gets an activity
                    ActivityTestsUtil.assertFeedContainsActivity(
                      groupMemberA.restContext,
                      groupA.group.id,
                      'content-create',
                      ActivityConstants.verbs.CREATE,
                      simong.user.id,
                      link.id,
                      groupA.group.id,
                      () => {
                        // Members of the group get an activity
                        ActivityTestsUtil.assertFeedContainsActivity(
                          groupMemberA.restContext,
                          groupMemberA.user.id,
                          'content-create',
                          ActivityConstants.verbs.CREATE,
                          simong.user.id,
                          link.id,
                          groupA.group.id,
                          () => {
                            // Everyone else gets nothing
                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                              stuart.restContext,
                              stuart.user.id,
                              'content-create',
                              () => {
                                ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                  stephen.restContext,
                                  stephen.user.id,
                                  'content-create',
                                  () => {
                                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                      groupMemberB.restContext,
                                      groupMemberB.user.id,
                                      'content-create',
                                      () => {
                                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                          groupMemberB.restContext,
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
    it('verify more than one extra member', callback => {
      _setup((simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB) => {
        RestAPI.Content.createLink(
          simong.restContext,
          {
            displayName: 'Apereo!',
            description: 'Apereo!',
            visibility: PUBLIC,
            link: 'http://www.apereo.org',
            managers: [bert.user.id, groupA.group.id],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // The actor should receive an activity
            ActivityTestsUtil.assertFeedContainsActivity(
              simong.restContext,
              simong.user.id,
              'content-create',
              ActivityConstants.verbs.CREATE,
              simong.user.id,
              link.id,
              null,
              () => {
                // Users who follow the actor receive the activity
                ActivityTestsUtil.assertFeedContainsActivity(
                  nico.restContext,
                  nico.user.id,
                  'content-create',
                  ActivityConstants.verbs.CREATE,
                  simong.user.id,
                  link.id,
                  null,
                  () => {
                    // The user who was made a member gets an activity
                    ActivityTestsUtil.assertFeedContainsActivity(
                      nico.restContext,
                      nico.user.id,
                      'content-create',
                      ActivityConstants.verbs.CREATE,
                      simong.user.id,
                      link.id,
                      null,
                      () => {
                        // The group who was made a member gets an activity
                        ActivityTestsUtil.assertFeedContainsActivity(
                          groupMemberA.restContext,
                          groupA.group.id,
                          'content-create',
                          ActivityConstants.verbs.CREATE,
                          simong.user.id,
                          link.id,
                          null,
                          () => {
                            // Members of the group get an activity
                            ActivityTestsUtil.assertFeedContainsActivity(
                              groupMemberA.restContext,
                              groupMemberA.user.id,
                              'content-create',
                              ActivityConstants.verbs.CREATE,
                              simong.user.id,
                              link.id,
                              null,
                              () => {
                                // Everyone else gets nothing
                                ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                  stuart.restContext,
                                  stuart.user.id,
                                  'content-create',
                                  () => {
                                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                      stephen.restContext,
                                      stephen.user.id,
                                      'content-create',
                                      () => {
                                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                          groupMemberB.restContext,
                                          groupMemberB.user.id,
                                          'content-create',
                                          () => {
                                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                              groupMemberB.restContext,
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

    /// /////////////////
    // CONTENT UPDATE //
    /// /////////////////

    /**
     * Test that verifies when a content item is updated multiple times, the actors that updated it are aggregated into a collection.
     */
    it('verify content-update activities are pivoted by object', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        // Create a google link
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, googleLink) => {
            assert.ok(!err);

            // Update the content once as jack
            RestAPI.Content.updateContent(jack.restContext, googleLink.id, { displayName: 'The Google' }, err => {
              assert.ok(!err);

              // Update it a second time as jack, we use this to make sure we don't get duplicates in the aggregation
              RestAPI.Content.updateContent(jack.restContext, googleLink.id, { displayName: 'Google' }, err => {
                assert.ok(!err);

                // Update it with a different user, this should be a second entry in the collection
                RestAPI.Content.updateContent(camAdminRestContext, googleLink.id, { displayName: 'Google' }, err => {
                  assert.ok(!err);

                  // Verify we get the 2 actors in the stream
                  ActivityTestsUtil.collectAndGetActivityStream(jack.restContext, null, null, (err, activityStream) => {
                    assert.ok(!err);
                    assert.ok(activityStream);

                    const activity = activityStream.items[0];
                    assert.ok(activity);
                    assert.strictEqual(activity['oae:activityType'], 'content-update');

                    const actors = activity.actor['oae:collection'];
                    assert.ok(actors);
                    assert.strictEqual(actors.length, 2);
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
    it('verify duplicate content-update activities are re-released with a more recent date, with no aggregations', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        // Create a google link
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, googleLink) => {
            assert.ok(!err);

            // Update the content once as jack
            RestAPI.Content.updateContent(jack.restContext, googleLink.id, { displayName: 'The Google' }, err => {
              assert.ok(!err);

              // Add something to the activity feed that happened later than the previous update
              RestAPI.Content.createLink(
                jack.restContext,
                {
                  displayName: 'Yahoo!',
                  description: 'Yahoo!',
                  visibility: PUBLIC,
                  link: 'http://www.yahoo.ca',
                  managers: [],
                  viewers: [],
                  folders: []
                },
                (err, yahooLink) => {
                  assert.ok(!err);

                  // Update it a second time as jack, we use this to make sure we don't get duplicates in the aggregation, and ensure the update jumps ahead of the last create activity in the feed
                  RestAPI.Content.updateContent(jack.restContext, googleLink.id, { displayName: 'Google' }, err => {
                    assert.ok(!err);

                    // Verify that the activity is still a non-aggregated activity, it just jumped to the front of the feed
                    ActivityTestsUtil.collectAndGetActivityStream(
                      jack.restContext,
                      null,
                      null,
                      (err, activityStream) => {
                        assert.ok(!err);
                        assert.ok(activityStream);

                        // One for the "content-create" aggregation, one for the "update content" duplicates
                        assert.ok(activityStream.items.length, 2);

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
                        RestAPI.Content.createLink(
                          jack.restContext,
                          {
                            displayName: 'Apereo',
                            description: 'Apereo',
                            visibility: PUBLIC,
                            link: 'http://www.apereo.org',
                            managers: [],
                            viewers: [],
                            folders: []
                          },
                          (err, apereoLink) => {
                            assert.ok(!err);

                            // Force a collection so that the most recent activity is in the feed
                            ActivityTestsUtil.collectAndGetActivityStream(
                              jack.restContext,
                              null,
                              null,
                              (err, activityStream) => {
                                assert.ok(!err);
                                assert.ok(activityStream);
                                assert.strictEqual(activityStream.items.length, 2);

                                // Jump the update activity to the top again
                                RestAPI.Content.updateContent(
                                  jack.restContext,
                                  googleLink.id,
                                  { displayName: 'Google' },
                                  err => {
                                    assert.ok(!err);

                                    // Verify update activity is at the top and still an individual activity
                                    ActivityTestsUtil.collectAndGetActivityStream(
                                      jack.restContext,
                                      null,
                                      null,
                                      (err, activityStream) => {
                                        assert.ok(activityStream);
                                        assert.strictEqual(activityStream.items.length, 2);

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

    /// ////////////////////////////
    // CONTENT UPDATE VISIBILITY //
    /// ////////////////////////////

    /*
     * The "content-update-visibility" activity demonstrates an activity that has no pivot points, therefore it should be
     * treated as though it pivots on all three entities (actor, object, target) such that duplicate activities within the
     * aggregation period are not posted multiple times. Duplicates are instead pushed to the top of the feed.
     */

    /**
     * Test that verifies when a content-update-visibility activity is posted duplicate times, it does not result in multiple entries in the
     * activity feed. Instead, the activity should be updated and reposted as a recent item.
     */
    it('verify duplicate content-update-visibility activities are not duplicated in the feed', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        // Create a google link
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, googleLink) => {
            assert.ok(!err);

            // Update the content once as jack
            RestAPI.Content.updateContent(jack.restContext, googleLink.id, { visibility: 'loggedin' }, err => {
              assert.ok(!err);

              // Add something to the activity feed that happened later than the previous update
              RestAPI.Content.createLink(
                jack.restContext,
                {
                  displayName: 'Yahoo!',
                  description: 'Yahoo!',
                  visibility: PUBLIC,
                  link: 'http://www.yahoo.ca',
                  managers: [],
                  viewers: [],
                  folders: []
                },
                (err, yahooLink) => {
                  assert.ok(!err);

                  // Update it a second time as jack, we use this to make sure we don't get duplicates in the aggregation, and ensure the update jumps ahead of the last create activity in the feed
                  RestAPI.Content.updateContent(jack.restContext, googleLink.id, { visibility: 'private' }, err => {
                    assert.ok(!err);

                    // Verify that the activity is still a non-aggregated activity, it just jumped to the front of the feed
                    ActivityTestsUtil.collectAndGetActivityStream(
                      jack.restContext,
                      null,
                      null,
                      (err, activityStream) => {
                        assert.ok(!err);
                        assert.ok(activityStream);

                        // One for the "content-create" aggregation, one for the "update content" duplicates
                        assert.ok(activityStream.items.length, 2);

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
                        RestAPI.Content.createLink(
                          jack.restContext,
                          {
                            displayName: 'Apereo',
                            description: 'Apereo',
                            visibility: PUBLIC,
                            link: 'http://www.apereo.org',
                            managers: [],
                            viewers: [],
                            folders: []
                          },
                          (err, apereoLink) => {
                            assert.ok(!err);

                            // Force a collection so that the most recent activity is in the feed
                            ActivityTestsUtil.collectAndGetActivityStream(
                              jack.restContext,
                              null,
                              null,
                              (err, activityStream) => {
                                assert.ok(!err);
                                assert.ok(activityStream);
                                assert.strictEqual(activityStream.items.length, 2);

                                // Jump the update activity to the top again
                                RestAPI.Content.updateContent(
                                  jack.restContext,
                                  googleLink.id,
                                  { visibility: 'public' },
                                  err => {
                                    assert.ok(!err);

                                    // Verify update activity is at the top and still an individual activity
                                    ActivityTestsUtil.collectAndGetActivityStream(
                                      jack.restContext,
                                      null,
                                      null,
                                      (err, activityStream) => {
                                        assert.ok(activityStream);
                                        assert.strictEqual(activityStream.items.length, 2);

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

    /// //////////////////
    // CONTENT-COMMENT //
    /// //////////////////

    /*
     * The content-comment activity demonstrates an activity that has all 3 entities, but only aggregates on 1 of them. This means that
     * 2 of the entity types are aggregated as more activities are generated instead of just one.
     */

    /**
     * Test that verifies that when content-comment activities are aggregated, both actor and object entities are collected into the activity
     * for display.
     */
    it('verify that content-comment activity aggregates both actor and object entities while pivoting on target', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jack) => {
        assert.ok(!err);

        // Create a google link
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // Post a content as jack
            RestAPI.Content.createComment(jack.restContext, link.id, 'Test Comment A', null, err => {
              assert.ok(!err);

              // Post a comment as the cambridge admin, we have now aggregated a 2nd comment posting on the same content item
              RestAPI.Content.createComment(camAdminRestContext, link.id, 'Test Comment B', null, err => {
                assert.ok(!err);

                // Verify that both actors (camadmin and jack) and both objects (both comments) are available in the activity
                ActivityTestsUtil.collectAndGetActivityStream(jack.restContext, null, null, (err, activityStream) => {
                  assert.ok(!err);
                  assert.ok(activityStream);
                  assert.strictEqual(activityStream.items.length, 2);

                  const activity = activityStream.items[0];
                  assert.strictEqual(activity['oae:activityType'], 'content-comment');

                  // Ensure we've aggregated all actors and objects
                  const actors = activity.actor['oae:collection'];
                  const objects = activity.object['oae:collection'];
                  assert.ok(actors);
                  assert.ok(objects);
                  assert.strictEqual(actors.length, 2);
                  assert.strictEqual(objects.length, 2);
                  assert.strictEqual(activity.target['oae:id'], link.id);

                  // Post a 3rd comment as a user who has posted already
                  RestAPI.Content.createComment(jack.restContext, link.id, 'Test Comment C', null, err => {
                    assert.ok(!err);

                    // Verify that the 3rd comment is aggregated into the object collection of the activity, however the actor collection has only the 2 unique actors
                    ActivityTestsUtil.collectAndGetActivityStream(
                      jack.restContext,
                      null,
                      null,
                      (err, activityStream) => {
                        assert.ok(!err);
                        assert.ok(activityStream);
                        assert.strictEqual(activityStream.items.length, 2);

                        const activity = activityStream.items[0];
                        assert.strictEqual(activity['oae:activityType'], 'content-comment');

                        // Ensure we now have one additional object, but we should still only have 2 users because it was the same user that posted the 3rd time
                        const actors = activity.actor['oae:collection'];
                        const objects = activity.object['oae:collection'];
                        assert.ok(actors);
                        assert.ok(objects);
                        assert.strictEqual(actors.length, 2);
                        assert.strictEqual(objects.length, 3);
                        assert.strictEqual(activity.target['oae:id'], link.id);
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

    /// ////////////////
    // CONTENT-SHARE //
    /// ////////////////

    /*
     * The content-share activity demonstrates a case where you have 2 pivots for a single activity.
     *
     * One pivot is actor+object, which enables the aggregation: "Branden Visser shared Mythology with 4 users and groups"
     *
     * The other pivot is actor+target, which enables the aggregation: "Branden Visser shared 5 items with GroupA"
     */

    /**
     * Test that verifies that duplicating an activity that has multiple pivots does not result in redundant data in the
     * activity feed.
     */
    it('verify duplicate content-share activities do not result in redundant activities', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
        assert.ok(!err);

        // Create a google link
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, link) => {
            assert.ok(!err);

            // Share with jack, creates one activity item in cam admin's feed
            RestAPI.Content.shareContent(jack.restContext, link.id, [jane.user.id], err => {
              assert.ok(!err);

              const removeJane = {};
              removeJane[jane.user.id] = false;

              // Remove jane so we can duplicate the content share after
              RestAPI.Content.updateMembers(jack.restContext, link.id, removeJane, err => {
                assert.ok(!err);

                // Create some noise in the feed to ensure that the second share content will jump to the top
                RestAPI.Content.createLink(
                  jack.restContext,
                  {
                    displayName: 'Yahoo',
                    description: 'Yahoo',
                    visibility: PUBLIC,
                    link: 'http://www.google.ca',
                    managers: [],
                    viewers: [],
                    folders: []
                  },
                  (err, yahooLink) => {
                    assert.ok(!err);

                    // Now re-add Jane
                    RestAPI.Content.shareContent(jack.restContext, link.id, [jane.user.id], err => {
                      assert.ok(!err);

                      // Verify that jack only has only one activity in his feed representing the content-share
                      ActivityTestsUtil.collectAndGetActivityStream(
                        jack.restContext,
                        null,
                        null,
                        (err, activityStream) => {
                          assert.ok(!err);
                          assert.ok(activityStream);
                          assert.strictEqual(activityStream.items.length, 2);

                          // The first activity should be the content share, and it should not be an aggregation
                          const activity = activityStream.items[0];
                          assert.strictEqual(activity['oae:activityType'], 'content-share');
                          assert.strictEqual(activity.actor['oae:id'], jack.user.id);
                          assert.strictEqual(
                            activity.actor['oae:profilePath'],
                            '/user/' +
                              jack.user.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(jack.user.id).resourceId
                          );
                          assert.strictEqual(activity.object['oae:id'], link.id);
                          assert.strictEqual(
                            activity.object['oae:profilePath'],
                            '/content/' + link.tenant.alias + '/' + AuthzUtil.getResourceFromId(link.id).resourceId
                          );
                          assert.strictEqual(activity.target['oae:id'], jane.user.id);
                          assert.strictEqual(
                            activity.target['oae:profilePath'],
                            '/user/' +
                              jane.user.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(jane.user.id).resourceId
                          );

                          // Repeat once more to ensure we don't duplicate when the aggregate is already active
                          RestAPI.Content.updateMembers(jack.restContext, link.id, removeJane, err => {
                            assert.ok(!err);

                            // Create some noise in the feed to ensure that the third share content will jump to the top
                            RestAPI.Content.createLink(
                              jack.restContext,
                              {
                                displayName: 'Apereo',
                                description: 'Apereo',
                                visibility: PUBLIC,
                                link: 'http://www.apereo.org',
                                managers: [],
                                viewers: [],
                                folders: []
                              },
                              (err, apereoLink) => {
                                assert.ok(!err);

                                // Re-share with Jane for the 3rd time
                                RestAPI.Content.shareContent(jack.restContext, link.id, [jane.user.id], err => {
                                  assert.ok(!err);

                                  // Verify that jack still has only one activity in his feed representing the content-share
                                  ActivityTestsUtil.collectAndGetActivityStream(
                                    jack.restContext,
                                    null,
                                    null,
                                    (err, activityStream) => {
                                      assert.ok(!err);
                                      assert.ok(activityStream);
                                      assert.strictEqual(activityStream.items.length, 2);

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
          }
        );
      });
    });

    /**
     * Test that verifies an activity with two aggregates will create 2 aggregate activities correctly when collected all at once
     * from the activity bucket.
     */
    it('verify content-share activities aggregate and are branched properly when all collected at once', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, jack, jane, branden) => {
        assert.ok(!err);

        // Create a google link and yahoo link to be shared around
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, googleLink) => {
            assert.ok(!err);

            RestAPI.Content.createLink(
              jack.restContext,
              {
                displayName: 'Yahoo',
                description: 'Yahoo',
                visibility: PUBLIC,
                link: 'http://www.yahoo.ca',
                managers: [],
                viewers: [],
                folders: []
              },
              (err, yahooLink) => {
                assert.ok(!err);

                // Share google link with jane and branden
                RestAPI.Content.shareContent(jack.restContext, googleLink.id, [jane.user.id, branden.user.id], err => {
                  assert.ok(!err);

                  // Share Yahoo link with jane only
                  RestAPI.Content.shareContent(jack.restContext, yahooLink.id, [jane.user.id], err => {
                    assert.ok(!err);

                    // Verify that the share activities aggregated in both pivot points
                    ActivityTestsUtil.collectAndGetActivityStream(
                      jack.restContext,
                      null,
                      null,
                      (err, activityStream) => {
                        assert.ok(!err);
                        assert.ok(activityStream);
                        assert.strictEqual(activityStream.items.length, 3);

                        // 1. actor+target should have jack+(google,yahoo)+jane, and it would be most recent
                        let activity = activityStream.items[0];
                        assert.ok(activity.object['oae:collection']);
                        assert.strictEqual(activity.object['oae:collection'].length, 2);

                        // 2. actor+object aggregate should have: jack+google+(jane,branden)
                        activity = activityStream.items[1];
                        assert.ok(activity.target['oae:collection']);
                        assert.strictEqual(activity.target['oae:collection'].length, 2);

                        return callback();
                      }
                    );
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
    it('verify content-share activities aggregate and are branched properly when collected after first share', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, jack, jane, branden) => {
        assert.ok(!err);

        // Create a google link and yahoo link to be shared around
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, googleLink) => {
            assert.ok(!err);

            RestAPI.Content.createLink(
              jack.restContext,
              {
                displayName: 'Yahoo',
                description: 'Yahoo',
                visibility: PUBLIC,
                link: 'http://www.yahoo.ca',
                managers: [],
                viewers: [],
                folders: []
              },
              (err, yahooLink) => {
                assert.ok(!err);

                // Share google link with jane
                RestAPI.Content.shareContent(jack.restContext, googleLink.id, [jane.user.id], err => {
                  assert.ok(!err);

                  // Perform a collection to activate some aggregates ahead of time
                  ActivityTestsUtil.collectAndGetActivityStream(jack.restContext, null, null, (err, activityStream) => {
                    assert.ok(!err);

                    // Share google now with branden, should aggregate with the previous
                    RestAPI.Content.shareContent(jack.restContext, googleLink.id, [branden.user.id], err => {
                      assert.ok(!err);

                      // Share Yahoo link with jane only
                      RestAPI.Content.shareContent(jack.restContext, yahooLink.id, [jane.user.id], err => {
                        assert.ok(!err);

                        // Verify that the share activities aggregated in both pivot points
                        ActivityTestsUtil.collectAndGetActivityStream(
                          jack.restContext,
                          null,
                          null,
                          (err, activityStream) => {
                            assert.ok(!err);
                            assert.ok(activityStream);
                            assert.strictEqual(activityStream.items.length, 3);

                            // 1. actor+target should have jack+(google,yahoo)+jane, and it would be most recent
                            let activity = activityStream.items[0];
                            assert.ok(activity.object['oae:collection']);
                            assert.strictEqual(activity.object['oae:collection'].length, 2);

                            // 2. actor+object aggregate should have: jack+google+(jane,branden)
                            activity = activityStream.items[1];
                            assert.ok(activity.target['oae:collection']);
                            assert.strictEqual(activity.target['oae:collection'].length, 2);

                            return callback();
                          }
                        );
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
    it('verify content-share activities aggregate and are branched properly when collected before last share', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, jack, jane, branden) => {
        assert.ok(!err);

        // Create a google link and yahoo link to be shared around
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, googleLink) => {
            assert.ok(!err);

            RestAPI.Content.createLink(
              jack.restContext,
              {
                displayName: 'Yahoo',
                description: 'Yahoo',
                visibility: PUBLIC,
                link: 'http://www.yahoo.ca',
                managers: [],
                viewers: [],
                folders: []
              },
              (err, yahooLink) => {
                assert.ok(!err);

                // Share google link with jane and branden
                RestAPI.Content.shareContent(jack.restContext, googleLink.id, [jane.user.id, branden.user.id], err => {
                  assert.ok(!err);

                  // Perform a collection to activate some aggregates ahead of time
                  ActivityTestsUtil.collectAndGetActivityStream(jack.restContext, null, null, (err, activityStream) => {
                    assert.ok(!err);

                    // Share Yahoo link with jane only
                    RestAPI.Content.shareContent(jack.restContext, yahooLink.id, [jane.user.id], err => {
                      assert.ok(!err);

                      // Verify that the share activities aggregated in both pivot points
                      ActivityTestsUtil.collectAndGetActivityStream(
                        jack.restContext,
                        null,
                        null,
                        (err, activityStream) => {
                          assert.ok(!err);
                          assert.ok(activityStream);
                          assert.strictEqual(activityStream.items.length, 3);

                          // 1. actor+target should have jack+(google,yahoo)+jane, and it would be most recent
                          let activity = activityStream.items[0];
                          assert.ok(activity.object['oae:collection']);
                          assert.strictEqual(activity.object['oae:collection'].length, 2);

                          // 2. actor+object aggregate should have: jack+google+(jane,branden)
                          activity = activityStream.items[1];
                          assert.ok(activity.target['oae:collection']);
                          assert.strictEqual(activity.target['oae:collection'].length, 2);

                          return callback();
                        }
                      );
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
    it('verify content-share activities aggregate and are branched properly when collected after each share', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, jack, jane, branden) => {
        assert.ok(!err);

        // Create a google link and yahoo link to be shared around
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (err, googleLink) => {
            assert.ok(!err);

            RestAPI.Content.createLink(
              jack.restContext,
              {
                displayName: 'Yahoo',
                description: 'Yahoo',
                visibility: PUBLIC,
                link: 'http://www.yahoo.ca',
                managers: [],
                viewers: [],
                folders: []
              },
              (err, yahooLink) => {
                assert.ok(!err);

                // Share google link with jane
                RestAPI.Content.shareContent(jack.restContext, googleLink.id, [jane.user.id], err => {
                  assert.ok(!err);

                  // Perform a collection to activate some aggregates ahead of time
                  ActivityTestsUtil.collectAndGetActivityStream(jack.restContext, null, null, (err, activityStream) => {
                    assert.ok(!err);

                    // Share google now with branden, should aggregate with the previous
                    RestAPI.Content.shareContent(jack.restContext, googleLink.id, [branden.user.id], err => {
                      assert.ok(!err);

                      // Perform a collection to activate some aggregates ahead of time
                      ActivityTestsUtil.collectAndGetActivityStream(
                        jack.restContext,
                        null,
                        null,
                        (err, activityStream) => {
                          assert.ok(!err);

                          // Share Yahoo link with jane only
                          RestAPI.Content.shareContent(jack.restContext, yahooLink.id, [jane.user.id], err => {
                            assert.ok(!err);

                            // Verify that the share activities aggregated in both pivot points
                            ActivityTestsUtil.collectAndGetActivityStream(
                              jack.restContext,
                              null,
                              null,
                              (err, activityStream) => {
                                assert.ok(!err);
                                assert.ok(activityStream);
                                assert.strictEqual(activityStream.items.length, 3);

                                // 1. actor+target should have jack+(google,yahoo)+jane, and it would be most recent
                                let activity = activityStream.items[0];
                                assert.ok(activity.object['oae:collection']);
                                assert.strictEqual(activity.object['oae:collection'].length, 2);

                                // 2. actor+object aggregate should have: jack+google+(jane,branden)
                                activity = activityStream.items[1];
                                assert.ok(activity.target['oae:collection']);
                                assert.strictEqual(activity.target['oae:collection'].length, 2);

                                return callback();
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
    it('verify content-comment email and privacy', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, mrvisser, simong, nicolaas) => {
        assert.ok(!err);

        const simongUpdate = {
          visibility: 'private',
          publicAlias: 'swappedFromPublicAlias'
        };
        PrincipalsTestUtil.assertUpdateUserSucceeds(simong.restContext, simong.user.id, simongUpdate, () => {
          RestAPI.Content.createLink(
            mrvisser.restContext,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: [],
              viewers: [],
              folders: []
            },
            (err, link) => {
              assert.ok(!err);

              RestAPI.Content.createComment(
                simong.restContext,
                link.id,
                '<script>Nice link.</script>\n\nWould click again',
                null,
                (err, simongComment) => {
                  assert.ok(!err);

                  EmailTestsUtil.collectAndFetchAllEmails(messages => {
                    // There should be exactly one message, the one sent to mrvisser (manager of content item receives content-comment notification)
                    assert.strictEqual(messages.length, 1);

                    const stringEmail = JSON.stringify(messages[0], null, 2);
                    const message = messages[0];

                    // Sanity check that the message is to mrvisser
                    assert.strictEqual(message.to[0].address, mrvisser.user.email);

                    // Ensure that the subject of the email contains the poster's name
                    assert.notStrictEqual(message.subject.indexOf('swappedFromPublicAlias'), -1);

                    // Ensure some data expected to be in the email is there
                    assert.notStrictEqual(stringEmail.indexOf(link.profilePath), -1);
                    assert.notStrictEqual(stringEmail.indexOf(link.displayName), -1);

                    // Ensure simong's private info is *nowhere* to be found
                    assert.strictEqual(stringEmail.indexOf(simong.user.displayName), -1);
                    assert.strictEqual(stringEmail.indexOf(simong.user.email), -1);
                    assert.strictEqual(stringEmail.indexOf(simong.user.locale), -1);

                    // The message probably contains the public alias, though
                    assert.notStrictEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

                    // The message should have escaped the HTML content in the original message
                    assert.strictEqual(stringEmail.indexOf('<script>Nice link.</script>'), -1);

                    // The new line characters should've been converted into paragraphs
                    assert.notStrictEqual(stringEmail.indexOf('Would click again</p>'), -1);

                    // Post a comment as nicolaas and ensure the recent commenter, simong receives an email about it
                    RestAPI.Content.createComment(
                      nicolaas.restContext,
                      link.id,
                      'It 404d',
                      null,
                      (err, nicolaasComment) => {
                        assert.ok(!err);

                        EmailTestsUtil.collectAndFetchAllEmails(emails => {
                          // There should be 2 emails this time, one to the manager and one to the recent commenter, simong
                          assert.strictEqual(emails.length, 2);

                          const emailAddresses = [emails[0].to[0].address, emails[1].to[0].address];
                          assert.ok(_.contains(emailAddresses, simong.user.email));
                          assert.ok(_.contains(emailAddresses, mrvisser.user.email));
                          return callback();
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
    });

    /**
     * Test that verifies an email is sent to the members when a content item is created, and that private users are
     * appropriately scrubbed.
     */
    it('verify content-create email and privacy', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, mrvisser, simong) => {
        assert.ok(!err);

        // Simon is private and mrvisser is public
        const simongUpdate = {
          visibility: 'private',
          publicAlias: 'swappedFromPublicAlias'
        };
        PrincipalsTestUtil.assertUpdateUserSucceeds(simong.restContext, simong.user.id, simongUpdate, () => {
          // Create the link, sharing it with mrvisser during the creation step. We will ensure he gets an email about it
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: [],
              viewers: [mrvisser.user.id],
              folders: []
            },
            (err, link) => {
              assert.ok(!err);

              // Mrvisser should get an email, with simong's information scrubbed
              EmailTestsUtil.collectAndFetchAllEmails(messages => {
                // There should be exactly one message, the one sent to mrvisser
                assert.strictEqual(messages.length, 1);

                const stringEmail = JSON.stringify(messages[0]);
                const message = messages[0];

                // Sanity check that the message is to mrvisser
                assert.strictEqual(message.to[0].address, mrvisser.user.email);

                // Ensure some data expected to be in the email is there
                assert.notStrictEqual(stringEmail.indexOf(link.profilePath), -1);
                assert.notStrictEqual(stringEmail.indexOf(link.displayName), -1);

                // Ensure simong's private info is *nowhere* to be found
                assert.strictEqual(stringEmail.indexOf(simong.user.displayName), -1);
                assert.strictEqual(stringEmail.indexOf(simong.user.email), -1);
                assert.strictEqual(stringEmail.indexOf(simong.user.locale), -1);

                // The message probably contains the public alias, though
                assert.notStrictEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

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
    it('verify content-share email and privacy', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, mrvisser, simong) => {
        assert.ok(!err);

        // Simon is private and mrvisser is public
        const simongUpdate = {
          visibility: 'private',
          publicAlias: 'swappedFromPublicAlias'
        };
        PrincipalsTestUtil.assertUpdateUserSucceeds(simong.restContext, simong.user.id, simongUpdate, () => {
          // Create the link, then share it with mrvisser. We will ensure that mrvisser gets the email about the share
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: [],
              viewers: [],
              folders: []
            },
            (err, link) => {
              assert.ok(!err);

              // Collect the createLink activity
              EmailTestsUtil.collectAndFetchAllEmails(messages => {
                RestAPI.Content.shareContent(simong.restContext, link.id, [mrvisser.user.id], err => {
                  assert.ok(!err);

                  // Mrvisser should get an email, with simong's information scrubbed
                  EmailTestsUtil.collectAndFetchAllEmails(messages => {
                    // There should be exactly one message, the one sent to mrvisser
                    assert.strictEqual(messages.length, 1);

                    const stringEmail = JSON.stringify(messages[0]);
                    const message = messages[0];

                    // Sanity check that the message is to mrvisser
                    assert.strictEqual(message.to[0].address, mrvisser.user.email);

                    // Ensure some data expected to be in the email is there
                    assert.notStrictEqual(stringEmail.indexOf(link.profilePath), -1);
                    assert.notStrictEqual(stringEmail.indexOf(link.displayName), -1);

                    // Ensure simong's private info is *nowhere* to be found
                    assert.strictEqual(stringEmail.indexOf(simong.user.displayName), -1);
                    assert.strictEqual(stringEmail.indexOf(simong.user.email), -1);
                    assert.strictEqual(stringEmail.indexOf(simong.user.locale), -1);

                    // The message probably contains the public alias, though
                    assert.notStrictEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);
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
