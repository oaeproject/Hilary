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

import * as ActivityTestsUtil from 'oae-activity/lib/test/util.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as EmailTestsUtil from 'oae-email/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as RestUtil from 'oae-rest/lib/util.js';
import * as TestsUtil from 'oae-tests';

import * as PrincipalsTestUtil from 'oae-principals/lib/test/util.js';

import { testingContext } from 'oae-tests/lib/context.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { forEach, not, and } from 'ramda';

const NO_VIEWERS = [];
const NO_FOLDERS = [];

const PUBLIC = 'public';

describe('Principals Activity', () => {
  let asGeorgiaTechAnonymousUser = null;
  let asCambridgeTenantAdmin = null;

  /**
   * Function that will fill up the tenant admin and anymous rest context
   */
  before((callback) => {
    // Fill up the anonymous gt rest context
    asGeorgiaTechAnonymousUser = TestsUtil.createTenantRestContext(global.oaeTests.tenants.gt.host);

    // Fill up global admin rest context
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    return callback();
  });

  /**
   * Drain the email queue
   */
  beforeEach((callback) => {
    EmailTestsUtil.clearEmailCollections(callback);
  });

  /*!
   * Get the activity from the stream with the given criteria.
   *
   * @param  {ActivityStream}    activityStream      The stream to search
   * @param  {String}            activityType        The type of activity to find
   * @param  {String}            entityType          The type of entity to apply the criteria (one of actor, object or target)
   * @param  {String}            entityOaeId         The oae:id of the entity to search
   * @return {Activity}                              An activity from the stream that matches the provided criteria
   */
  const _getActivity = function (activityStream, activityType, entityType, entityOaeId) {
    if (not(and(activityStream, activityStream.items))) {
      return null;
    }

    for (let i = 0; i < activityStream.items.length; i++) {
      const activity = activityStream.items[i];
      if (
        activity['oae:activityType'] === activityType &&
        activity[entityType] &&
        activity[entityType]['oae:id'] === entityOaeId
      ) {
        return activity;
      }
    }

    return null;
  };

  /*!
   * Make a single membership or role change object to apply to a group membership or resource role.
   *
   * @param  {String} principalId   The principalId whose role to change
   * @param  {String} role          The role to change to
   * @return {Object}               The change JSON Object to apply
   */
  const _makeChange = function (principalId, role) {
    const change = {};
    change[principalId] = role;
    return change;
  };

  describe('Routes', () => {
    it('verify cyclic group memberships terminate while routing an activity', (callback) => {
      const group1Alias = TestsUtil.generateTestUserId('group1');
      const group2Alias = TestsUtil.generateTestUserId('group2');
      const group3Alias = TestsUtil.generateTestUserId('group3');
      const group4Alias = TestsUtil.generateTestUserId('group4');

      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: doer, 1: jack } = users;

        // Create the 4 groups that will form a cyclema
        RestAPI.Group.createGroup(doer.restContext, group1Alias, group1Alias, PUBLIC, 'no', [], [], (error, group1) => {
          assert.notExists(error);

          RestAPI.Group.createGroup(
            doer.restContext,
            group2Alias,
            group2Alias,
            PUBLIC,
            'no',
            [group1.id],
            [],
            (error, group2) => {
              assert.notExists(error);

              // Group 3 will be joinable, so Jack can join it to trigger an activity
              RestAPI.Group.createGroup(
                doer.restContext,
                group3Alias,
                group3Alias,
                PUBLIC,
                'yes',
                [group2.id],
                [],
                (error, group3) => {
                  assert.notExists(error);

                  RestAPI.Group.createGroup(
                    doer.restContext,
                    group4Alias,
                    group4Alias,
                    PUBLIC,
                    'no',
                    [group3.id],
                    [],
                    (error, group4) => {
                      assert.notExists(error);

                      // Add group4 as manager to group1 to complete the cycle
                      const cycleChange = {};
                      cycleChange[group4.id] = 'manager';
                      RestAPI.Group.setGroupMembers(doer.restContext, group1.id, cycleChange, (error_) => {
                        assert.notExists(error_);

                        RestAPI.Group.joinGroup(jack.restContext, group3.id, (error_) => {
                          assert.notExists(error_);

                          // Verify that each group now has this as its most recent activity
                          ActivityTestsUtil.collectAndGetActivityStream(
                            jack.restContext,
                            group1.id,
                            null,
                            (error, activityStream) => {
                              assert.notExists(error);
                              assert.strictEqual(activityStream.items[0]['oae:activityType'], 'group-join');
                              assert.strictEqual(activityStream.items[0].object['oae:id'], group3.id);

                              ActivityTestsUtil.collectAndGetActivityStream(
                                jack.restContext,
                                group2.id,
                                null,
                                (error, activityStream) => {
                                  assert.notExists(error);
                                  assert.strictEqual(activityStream.items[0]['oae:activityType'], 'group-join');
                                  assert.strictEqual(activityStream.items[0].object['oae:id'], group3.id);

                                  ActivityTestsUtil.collectAndGetActivityStream(
                                    jack.restContext,
                                    group3.id,
                                    null,
                                    (error, activityStream) => {
                                      assert.notExists(error);
                                      assert.strictEqual(activityStream.items[0]['oae:activityType'], 'group-join');
                                      assert.strictEqual(activityStream.items[0].object['oae:id'], group3.id);

                                      ActivityTestsUtil.collectAndGetActivityStream(
                                        jack.restContext,
                                        group4.id,
                                        null,
                                        (error, activityStream) => {
                                          assert.notExists(error);
                                          assert.strictEqual(activityStream.items[0]['oae:activityType'], 'group-join');
                                          assert.strictEqual(activityStream.items[0].object['oae:id'], group3.id);
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
     * Test that verifies that activities are routed to indirect group member descendants. This exercises a "membership" operation which should
     * only be routed to managers, as well as a regular update operation which should get routed to all members.
     */
    it('verify group activities are routed to group member descendants', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: doer, 1: jack, 2: managerGroupMember } = users;

        // Create the member group, which will be member to the group that gets updated and has a user added. This group should not receive the "user added" activity
        RestAPI.Group.createGroup(
          doer.restContext,
          TestsUtil.generateTestUserId('memberGroup'),
          TestsUtil.generateTestUserId('memberGroup'),
          PUBLIC,
          'no',
          [],
          [],
          (error, memberGroup) => {
            assert.notExists(error);

            // Create the manager group, which should receive both update and "user added" activities
            RestAPI.Group.createGroup(
              doer.restContext,
              TestsUtil.generateTestUserId('managerGroup'),
              TestsUtil.generateTestUserId('managerGroup'),
              PUBLIC,
              'no',
              [],
              [],
              (error, managerGroup) => {
                assert.notExists(error);

                // ManagerGroupMember should be a member of the manager group to verify indirect group member routing
                const membership = {};
                membership[managerGroupMember.user.id] = 'manager';
                RestAPI.Group.setGroupMembers(doer.restContext, managerGroup.id, membership, (error_) => {
                  assert.notExists(error_);

                  // Create the target group, manager group and member group are members
                  RestAPI.Group.createGroup(
                    doer.restContext,
                    TestsUtil.generateTestUserId('targetGroup'),
                    TestsUtil.generateTestUserId('targetGroup'),
                    PUBLIC,
                    'yes',
                    [managerGroup.id],
                    [memberGroup.id],
                    (error, targetGroup) => {
                      assert.notExists(error);

                      RestAPI.Group.joinGroup(jack.restContext, targetGroup.id, (error_) => {
                        assert.notExists(error_);

                        // Update the group to propagate an activity
                        RestAPI.Group.updateGroup(
                          doer.restContext,
                          targetGroup.id,
                          { displayName: 'Ha ha I make change' },
                          (error_) => {
                            assert.notExists(error_);

                            // Ensure manager group received both update and join activities
                            ActivityTestsUtil.collectAndGetActivityStream(
                              doer.restContext,
                              managerGroup.id,
                              null,
                              (error, activityStream) => {
                                assert.notExists(error);
                                assert.ok(_getActivity(activityStream, 'group-update', 'object', targetGroup.id));
                                assert.ok(_getActivity(activityStream, 'group-join', 'object', targetGroup.id));

                                // Ensure the member group received update, but not join
                                ActivityTestsUtil.collectAndGetActivityStream(
                                  doer.restContext,
                                  memberGroup.id,
                                  null,
                                  (error, activityStream) => {
                                    assert.notExists(error);
                                    assert.ok(_getActivity(activityStream, 'group-update', 'object', targetGroup.id));
                                    assert.ok(!_getActivity(activityStream, 'group-join', 'object', targetGroup.id));

                                    // Ensure member of the manager group got both update and join
                                    ActivityTestsUtil.collectAndGetActivityStream(
                                      managerGroupMember.restContext,
                                      managerGroupMember.user.id,
                                      null,
                                      (error, activityStream) => {
                                        assert.notExists(error);
                                        assert.ok(
                                          _getActivity(activityStream, 'group-update', 'object', targetGroup.id)
                                        );
                                        assert.ok(_getActivity(activityStream, 'group-join', 'object', targetGroup.id));
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
  });

  describe('Activity Entity Model', () => {
    // In order to test download url expiry, we need to
    // override the `Date.now` function, After each test
    // ensure it is set to the proper function
    const _originalDateNow = Date.now;
    afterEach((callback) => {
      Date.now = _originalDateNow;
      return callback();
    });

    /**
     * Returns a stream to a jpg image
     *
     * @return {Stream} A stream to jpg image.
     */
    const _getPictureStream = function () {
      const file = path.join(__dirname, '/data/restroom.jpg');
      return fs.createReadStream(file);
    };

    /**
     * Test that verifies the contents of the full group and user activity entity models.
     */
    it.skip('verify the user and group activity entity model', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: publicUser, 1: privateUser } = users;

        RestAPI.User.updateUser(privateUser.restContext, privateUser.user.id, { visibility: 'private' }, (error_) => {
          assert.notExists(error_);

          const sizes = {
            x: 0,
            y: 0,
            width: 35,
            height: 35
          };

          // Give the users a profile picture so we can verify it is on the entity model
          RestAPI.User.uploadPicture(publicUser.restContext, publicUser.user.id, _getPictureStream, sizes, (error_) => {
            assert.notExists(error_);

            // Add a profile picture to the private user so we can verify it gets hidden
            RestAPI.User.uploadPicture(
              privateUser.restContext,
              privateUser.user.id,
              _getPictureStream,
              sizes,
              (error_) => {
                assert.notExists(error_);

                // Create a group
                RestAPI.Group.createGroup(
                  asCambridgeTenantAdmin,
                  TestsUtil.generateTestGroupId('group'),
                  TestsUtil.generateTestGroupId('group'),
                  PUBLIC,
                  'no',
                  [],
                  [],
                  (error, group) => {
                    assert.notExists(error);

                    // Give the group a profile picture
                    RestAPI.Group.uploadPicture(
                      asCambridgeTenantAdmin,
                      group.id,
                      _getPictureStream,
                      sizes,
                      (error_) => {
                        assert.notExists(error_);

                        // Add both the public and private users to the group. They should receive eachother's user entities in the feeds
                        const permissionChanges = {};
                        permissionChanges[publicUser.user.id] = 'manager';
                        permissionChanges[privateUser.user.id] = 'manager';

                        RestAPI.Group.setGroupMembers(asCambridgeTenantAdmin, group.id, permissionChanges, (error_) => {
                          assert.notExists(error_);

                          // Verify the publicUser and group model in the public user group-add-member activity
                          ActivityTestsUtil.collectAndGetActivityStream(
                            publicUser.restContext,
                            publicUser.user.id,
                            null,
                            (error, activityStream) => {
                              assert.notExists(error);

                              // Pluck the group-add-member activity from the user's feed
                              const activity = activityStream.items[0];
                              assert.ok(activity);

                              const { actor, object, target } = activity; // Public user, private user, group
                              assert.ok(actor);
                              assert.ok(object);
                              assert.ok(target);

                              assert.strictEqual(object.objectType, 'collection');
                              assert.strictEqual(object['oae:collection'].length, 2);

                              let publicUserActivityEntity = null;
                              let privateUserActivityEnity = null;
                              forEach((user) => {
                                const { resourceId } = AuthzUtil.getResourceFromId(user['oae:id']);
                                if (user['oae:id'] === publicUser.user.id) {
                                  publicUserActivityEntity = user;

                                  // Verify the public user model
                                  assert.ok(user.id.includes(publicUser.user.id));
                                  assert.strictEqual(user.displayName, publicUser.user.displayName);
                                  assert.strictEqual(user.objectType, 'user');
                                  assert.strictEqual(user['oae:id'], publicUser.user.id);
                                  assert.strictEqual(user['oae:profilePath'], publicUser.user.profilePath);
                                  assert.strictEqual(user['oae:visibility'], PUBLIC);
                                  assert.strictEqual(
                                    user.url,
                                    'http://' + global.oaeTests.tenants.cam.host + '/user/camtest/' + resourceId
                                  );
                                  assert.ok(user.image);
                                } else if (user['oae:id'] === privateUser.user.id) {
                                  privateUserActivityEnity = user;

                                  // Verify the private user model
                                  assert.ok(user.id.includes(privateUser.user.id));
                                  assert.strictEqual(user.displayName, privateUser.user.publicAlias);
                                  assert.strictEqual(user.objectType, 'user');
                                  assert.strictEqual(user['oae:id'], privateUser.user.id);
                                  assert.strictEqual(user['oae:profilePath'], undefined);
                                  assert.strictEqual(user['oae:visibility'], 'private');

                                  // Url and image are not defined for unprivileged users in feeds
                                  assert.isNotOk(user.url);
                                  assert.isNotOk(user.image);
                                }
                              }, object['oae:collection']);

                              assert.ok(publicUserActivityEntity);
                              assert.ok(privateUserActivityEnity);

                              // Verify the group model
                              const { resourceId } = AuthzUtil.getResourceFromId(group.id);
                              assert.ok(target.id.includes(group.id));
                              assert.strictEqual(target.displayName, group.displayName);
                              assert.strictEqual(target.objectType, 'group');
                              assert.strictEqual(target['oae:id'], group.id);
                              assert.strictEqual(target['oae:profilePath'], group.profilePath);
                              assert.strictEqual(target['oae:visibility'], group.visibility);
                              assert.strictEqual(
                                target.url,
                                'http://' + global.oaeTests.tenants.cam.host + '/group/camtest/' + resourceId
                              );
                              assert.ok(target.image);

                              // Ensure the standard image for the public user and group can be downloaded right now by even an anonymous user on another tenant
                              const DUMMY_BASE = 'http://localhost';
                              let signedDownloadUrl = new URL(publicUserActivityEntity.image.url, DUMMY_BASE);

                              RestUtil.performRestRequest(
                                asGeorgiaTechAnonymousUser,
                                signedDownloadUrl.pathname,
                                'GET',
                                TestsUtil.objectifySearchParams(signedDownloadUrl.searchParams),
                                (error, body, response) => {
                                  assert.notExists(error);
                                  assert.strictEqual(response.statusCode, 204);

                                  signedDownloadUrl = new URL(target.image.url, DUMMY_BASE);
                                  RestUtil.performRestRequest(
                                    asGeorgiaTechAnonymousUser,
                                    signedDownloadUrl.pathname,
                                    'GET',
                                    TestsUtil.objectifySearchParams(signedDownloadUrl.searchParams),
                                    (error, body, response) => {
                                      assert.notExists(error);
                                      assert.strictEqual(response.statusCode, 204);

                                      // Jump ahead in time by 5 years, test-drive a hovercar and check if the signatures still work
                                      const now = Date.now();
                                      Date.now = function () {
                                        return now + 5 * 365 * 24 * 60 * 60 * 1000;
                                      };

                                      // Ensure the standard image for the public user and group can still be downloaded by even an anonymous user on another tenant
                                      signedDownloadUrl = new URL(publicUserActivityEntity.image.url, DUMMY_BASE);
                                      RestUtil.performRestRequest(
                                        asGeorgiaTechAnonymousUser,
                                        signedDownloadUrl.pathname,
                                        'GET',
                                        TestsUtil.objectifySearchParams(signedDownloadUrl.searchParams),
                                        (error, body, response) => {
                                          assert.notExists(error);
                                          assert.strictEqual(response.statusCode, 204);

                                          signedDownloadUrl = new URL(target.image.url, DUMMY_BASE);
                                          RestUtil.performRestRequest(
                                            asGeorgiaTechAnonymousUser,
                                            signedDownloadUrl.pathname,
                                            'GET',
                                            TestsUtil.objectifySearchParams(signedDownloadUrl.searchParams),
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
      });
    });

    /**
     * Test that verifies private unjoinable groups are not delivered to unauthorized users' activity feeds for a group-add-member activity
     */
    it('verify private unjoinable group is not propagated to non-member users for a group-add-member activity', (callback) => {
      // Create a user with which to create a group, then ensure the user gets the activity
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: simon, 2: bert } = users;

        // Simon follows bert because he's a pretty cool guy
        RestAPI.Following.follow(simon.restContext, bert.user.id, (error_) => {
          assert.notExists(error_);

          // The Vissmeister creates a joinable and unjoinable private group
          RestAPI.Group.createGroup(
            mrvisser.restContext,
            TestsUtil.generateTestGroupId('group'),
            TestsUtil.generateTestGroupId('group'),
            'private',
            'yes',
            [],
            [],
            (error, groupJoinable) => {
              assert.notExists(error);
              RestAPI.Group.createGroup(
                mrvisser.restContext,
                TestsUtil.generateTestGroupId('group'),
                TestsUtil.generateTestGroupId('group'),
                'private',
                'no',
                [],
                [],
                (error, groupUnjoinable) => {
                  assert.notExists(error);

                  // Mrvisser adds bert as a member to the joinable group
                  const membersUpdate = {};
                  membersUpdate[bert.user.id] = 'member';
                  RestAPI.Group.setGroupMembers(mrvisser.restContext, groupJoinable.id, membersUpdate, (error_) => {
                    assert.notExists(error_);

                    // Ensure simon gets the activity because he follows bert and the group is joinable so he is allowed to see it
                    ActivityTestsUtil.collectAndGetActivityStream(
                      simon.restContext,
                      null,
                      null,
                      (error, activityStream) => {
                        assert.notExists(error);
                        assert.ok(_getActivity(activityStream, 'group-add-member', 'target', groupJoinable.id));

                        // Mrvisser now adds bert to the unjoinable group
                        RestAPI.Group.setGroupMembers(
                          mrvisser.restContext,
                          groupUnjoinable.id,
                          membersUpdate,
                          (error_) => {
                            assert.notExists(error_);

                            // Ensure simon does not get the second activity. Although he follows bert, the group propagation should forbid it
                            ActivityTestsUtil.collectAndGetActivityStream(
                              simon.restContext,
                              null,
                              null,
                              (error, activityStream) => {
                                assert.notExists(error);
                                assert.ok(
                                  !_getActivity(activityStream, 'group-add-member', 'target', groupUnjoinable.id)
                                );
                                return callback();
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

    /**
     * Test that verifies private unjoinable groups are not delivered to unauthorized users' activity feeds for a group-create activity
     */
    it('verify that a private unjoinable group is not delivered to a non-member user feed for a group-create activity', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: branden, 1: nico } = users;

        // Branden and Nico follow each other
        RestAPI.Following.follow(branden.restContext, nico.user.id, (error_) => {
          assert.notExists(error_);

          RestAPI.Following.follow(nico.restContext, branden.user.id, (error_) => {
            assert.notExists(error_);

            // The Vissmeister creates a private group
            RestAPI.Group.createGroup(
              branden.restContext,
              'Private Group',
              null,
              'private',
              'no',
              [],
              [],
              (error /* , privateGroup */) => {
                assert.notExists(error);

                // Ensure only the 2 following activities are in Nico's feed as he does not have access to the private group
                ActivityTestsUtil.collectAndGetActivityStream(
                  nico.restContext,
                  nico.user.id,
                  null,
                  (error, response) => {
                    assert.notExists(error);
                    assert.strictEqual(response.items.length, 2);
                    assert.strictEqual(response.items[0]['oae:activityType'], 'following-follow');
                    assert.strictEqual(response.items[1]['oae:activityType'], 'following-follow');

                    // The Vissmeister creates a public group
                    RestAPI.Group.createGroup(
                      branden.restContext,
                      'Public Group',
                      null,
                      PUBLIC,
                      'no',
                      [],
                      [],
                      (error, publicGroup) => {
                        assert.notExists(error);

                        // Ensure the group creation activity has been delivered
                        ActivityTestsUtil.collectAndGetActivityStream(
                          nico.restContext,
                          nico.user.id,
                          null,
                          (error, response) => {
                            assert.notExists(error);
                            assert.strictEqual(response.items.length, 3);
                            assert.strictEqual(response.items[0]['oae:activityType'], 'group-create');
                            assert.strictEqual(response.items[0].object['oae:id'], publicGroup.id);

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
      });
    });

    /**
     * Test that verifies private unjoinable groups are delivered to managers of content with which they are shared
     */
    it('verify private unjoinable group is propagated to content managers', (callback) => {
      // Create a user with which to create a group, then ensure the user gets the activity
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: simon } = users;

        // Simon creates a public content item, he's totally a manager as well as mrvisser
        RestAPI.Content.createLink(
          simon.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'https://www.google.com.br',
            managers: [mrvisser.user.id],
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Mrvisser creates a private unjoinable group
            setTimeout(
              RestAPI.Group.createGroup,
              1000,
              mrvisser.restContext,
              TestsUtil.generateTestGroupId('group'),
              TestsUtil.generateTestGroupId('group'),
              'private',
              'no',
              [],
              [],
              (error, groupUnjoinable) => {
                assert.notExists(error);

                // Mrvisser shares Simon's content item with his private unjoinable group
                RestAPI.Content.shareContent(mrvisser.restContext, link.id, [groupUnjoinable.id], (error_) => {
                  assert.notExists(error_);

                  // Ensure that Simon gets the activity, even though he doesn't really have access to the group
                  ActivityTestsUtil.collectAndGetActivityStream(
                    simon.restContext,
                    null,
                    null,
                    (error, activityStream) => {
                      assert.notExists(error);
                      assert.ok(_getActivity(activityStream, 'content-share', 'target', groupUnjoinable.id));

                      // Mrvisser promotes the group to be a manager of the content item
                      const membersUpdate = {};
                      membersUpdate[groupUnjoinable.id] = 'manager';
                      RestAPI.Content.updateMembers(mrvisser.restContext, link.id, membersUpdate, (error_) => {
                        assert.notExists(error_);

                        // Ensure that Simon gets this activity as well since he is manager and should know
                        ActivityTestsUtil.collectAndGetActivityStream(
                          simon.restContext,
                          null,
                          null,
                          (error, activityStream) => {
                            assert.notExists(error);
                            assert.ok(
                              _getActivity(activityStream, 'content-update-member-role', 'object', groupUnjoinable.id)
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
          }
        );
      });
    });
  });

  describe('Posting Activities', () => {
    /**
     * Test that verifies the group-create, group-update and group-update-visibility activities gets generated
     */
    it('verify group-create, group-update, group-update-visibility activities are delivered', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: jack } = users;

        RestAPI.Group.createGroup(
          asCambridgeTenantAdmin,
          TestsUtil.generateTestGroupId('group'),
          TestsUtil.generateTestGroupId('group'),
          PUBLIC,
          'no',
          [jack.user.id],
          [],
          (error, group) => {
            assert.notExists(error);

            RestAPI.Group.updateGroup(asCambridgeTenantAdmin, group.id, { visibility: 'loggedin' }, (error_) => {
              assert.notExists(error_);

              RestAPI.Group.updateGroup(asCambridgeTenantAdmin, group.id, { displayName: 'har har har' }, (error_) => {
                assert.notExists(error_);

                ActivityTestsUtil.collectAndGetActivityStream(
                  asCambridgeTenantAdmin,
                  jack.user.id,
                  null,
                  (error, activityStream) => {
                    assert.notExists(error);
                    assert.ok(_getActivity(activityStream, 'group-create', 'object', group.id));
                    assert.ok(_getActivity(activityStream, 'group-update', 'object', group.id));
                    assert.ok(_getActivity(activityStream, 'group-update-visibility', 'object', group.id));
                    return callback();
                  }
                );
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies the group-join activity gets fired
     */
    it('verify group-join activity is delivered', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: doer, 1: jack } = users;

        RestAPI.Group.createGroup(
          doer.restContext,
          TestsUtil.generateTestGroupId('group'),
          TestsUtil.generateTestGroupId('group'),
          PUBLIC,
          'yes',
          [],
          [],
          (error, group) => {
            assert.notExists(error);

            RestAPI.Group.joinGroup(jack.restContext, group.id, (error_) => {
              assert.notExists(error_);

              ActivityTestsUtil.collectAndGetActivityStream(
                jack.restContext,
                jack.user.id,
                null,
                (error, activityStream) => {
                  assert.notExists(error);
                  assert.ok(_getActivity(activityStream, 'group-join', 'object', group.id));
                  return callback();
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies group managers receive a notification when a user joins that group
     */
    it('verify group-join notifications are delivered', (callback) => {
      // Generate one user to create a group and one to join the group
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: simong } = users;

        // Create the group that will be joined
        RestAPI.Group.createGroup(
          mrvisser.restContext,
          TestsUtil.generateTestGroupId('group'),
          TestsUtil.generateTestGroupId('group'),
          PUBLIC,
          'yes',
          [],
          [],
          (error, group) => {
            assert.notExists(error);

            // Join the group
            RestAPI.Group.joinGroup(simong.restContext, group.id, (error_) => {
              assert.notExists(error_);

              // Ensure that the manager of the group (mrvisser) receives the notification
              ActivityTestsUtil.collectAndGetNotificationStream(
                mrvisser.restContext,
                null,
                (error, notificationStream) => {
                  assert.notExists(error);
                  assert.ok(_getActivity(notificationStream, 'group-join', 'object', group.id));

                  return callback();
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies the group-add-member activity gets generated
     */
    it('verify group-add-member activity gets generated', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: jack } = users;

        RestAPI.Group.createGroup(
          asCambridgeTenantAdmin,
          TestsUtil.generateTestGroupId('group'),
          TestsUtil.generateTestGroupId('group'),
          PUBLIC,
          'yes',
          [],
          [],
          (error, group) => {
            assert.notExists(error);

            const memberships = {};
            memberships[jack.user.id] = 'member';
            RestAPI.Group.setGroupMembers(asCambridgeTenantAdmin, group.id, memberships, (error_) => {
              assert.notExists(error_);

              ActivityTestsUtil.collectAndGetActivityStream(
                asCambridgeTenantAdmin,
                jack.user.id,
                null,
                (error, activityStream) => {
                  assert.notExists(error);
                  assert.ok(_getActivity(activityStream, 'group-add-member', 'target', group.id));

                  return callback();
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies the group-update-member-role activity gets generated
     */
    it('verify group-update-member-role activity gets generated', (callback) => {
      // Generate 2 users
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: john, 1: jane } = users;

        // Create a new group with John as manager and jane as a member
        RestAPI.Group.createGroup(
          john.restContext,
          TestsUtil.generateTestGroupId('group'),
          TestsUtil.generateTestGroupId('group'),
          PUBLIC,
          'yes',
          [],
          [jane.user.id],
          (error, group) => {
            assert.notExists(error);

            // Change Jane's role from member to manager
            RestAPI.Group.setGroupMembers(
              john.restContext,
              group.id,
              _makeChange(jane.user.id, 'manager'),
              (error_) => {
                assert.notExists(error_);

                // Verify that John's activity stream received a 'group-update-member-role' activity
                ActivityTestsUtil.collectAndGetActivityStream(john.restContext, null, null, (error, activityStream) => {
                  assert.notExists(error);
                  ActivityTestsUtil.assertActivity(
                    activityStream.items[0],
                    'group-update-member-role',
                    'update',
                    john.user.id,
                    jane.user.id,
                    group.id
                  );

                  // Verify that Jane's activity stream received a 'group-update-member-role' activity
                  RestAPI.Activity.getCurrentUserActivityStream(jane.restContext, null, (error, activityStream) => {
                    assert.notExists(error);
                    ActivityTestsUtil.assertActivity(
                      activityStream.items[0],
                      'group-update-member-role',
                      'update',
                      john.user.id,
                      jane.user.id,
                      group.id
                    );
                    return callback();
                  });
                });
              }
            );
          }
        );
      });
    });
  });

  describe('Activity Aggregation', () => {
    /**
     * Test that verifies group-join activities aggregate.
     */
    it('verify group-join activities aggregation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: jack, 1: jane, 2: branden } = users;

        RestAPI.Group.createGroup(
          jack.restContext,
          TestsUtil.generateTestGroupId('group'),
          TestsUtil.generateTestGroupId('group'),
          PUBLIC,
          'yes',
          [],
          [],
          (error, group) => {
            assert.notExists(error);

            // Join as jane
            RestAPI.Group.joinGroup(jane.restContext, group.id, (error_) => {
              assert.notExists(error_);

              // Join as branden
              RestAPI.Group.joinGroup(branden.restContext, group.id, (error_) => {
                assert.notExists(error_);

                // Get jack's own feed
                ActivityTestsUtil.collectAndGetActivityStream(jack.restContext, null, null, (error, activityStream) => {
                  assert.notExists(error);

                  // Verify 1 for the group create, plus 1 for the aggregated group-join activities
                  assert.strictEqual(activityStream.items.length, 2);

                  // Verify the first is the group join, with a collection of 2 actor entities (jane and branden)
                  const entity = activityStream.items[0].actor;
                  assert.ok(entity['oae:collection']);
                  assert.strictEqual(entity['oae:collection'].length, 2);
                  return callback();
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies group-add-member activities aggregate.
     */
    it('verify group-add-member activities aggregation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: jack, 1: jane, 2: branden } = users;

        RestAPI.Group.createGroup(
          jack.restContext,
          TestsUtil.generateTestGroupId('group'),
          TestsUtil.generateTestGroupId('group'),
          PUBLIC,
          'yes',
          [],
          [],
          (error, group) => {
            assert.notExists(error);

            // Join as jane
            let membership = {};
            membership[jane.user.id] = 'member';

            RestAPI.Group.setGroupMembers(jack.restContext, group.id, membership, (error_) => {
              assert.notExists(error_);

              // Join as branden
              membership = {};
              membership[branden.user.id] = 'member';

              RestAPI.Group.setGroupMembers(jack.restContext, group.id, membership, (error_) => {
                assert.notExists(error_);

                ActivityTestsUtil.collectAndGetActivityStream(jack.restContext, null, null, (error, activityStream) => {
                  assert.notExists(error);

                  // Verify 1 for the group create, plus 1 for the aggregated group-add-member activities
                  assert.strictEqual(activityStream.items.length, 2);

                  // Verify the first is the group join, with a collection of 2 actor entities (jane and branden)
                  const entity = activityStream.items[0].object;
                  assert.ok(entity['oae:collection']);
                  assert.strictEqual(entity['oae:collection'].length, 2);

                  return callback();
                });
              });
            });
          }
        );
      });
    });
  });

  describe('Emails', () => {
    /**
     * Verify that when a user is added to a group at the time a group is created,
     * they receive an email. Also verifies that private user information is
     * appropriately scrubbed from the email.
     */
    it('verify group-create email and privacy', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: simong } = users;

        // Simon is private and mrvisser is public
        const simongUpdate = {
          visibility: 'private',
          publicAlias: 'swappedFromPublicAlias'
        };
        PrincipalsTestUtil.assertUpdateUserSucceeds(simong.restContext, simong.user.id, simongUpdate, () => {
          // Create the group with a user. We will ensure that user receives an email
          RestAPI.Group.createGroup(
            simong.restContext,
            'emailGroupCreate',
            'emailGroupCreate',
            PUBLIC,
            'yes',
            [],
            [mrvisser.user.id],
            (error, group) => {
              assert.notExists(error);

              // Mrvisser should get an email, with simong's information scrubbed
              EmailTestsUtil.collectAndFetchAllEmails((messages) => {
                // There should be exactly one message, the one sent to mrvisser
                assert.strictEqual(messages.length, 1);

                const stringMessage = JSON.stringify(messages[0]);
                const message = messages[0];

                // Sanity check that the message is to mrvisser
                assert.strictEqual(message.to[0].address, mrvisser.user.email);

                // Ensure some data expected to be in the email is there
                assert.notStrictEqual(stringMessage.indexOf(simong.restContext.hostHeader), -1);
                assert.notStrictEqual(stringMessage.indexOf(group.profilePath), -1);
                assert.notStrictEqual(stringMessage.indexOf(group.displayName), -1);

                // Ensure simong's private info is *nowhere* to be found
                assert.strictEqual(stringMessage.indexOf(simong.user.displayName), -1);
                assert.strictEqual(stringMessage.indexOf(simong.user.email), -1);
                assert.strictEqual(stringMessage.indexOf(simong.user.locale), -1);

                // The message probably contains the public alias, though
                assert.notStrictEqual(stringMessage.indexOf('swappedFromPublicAlias'), -1);

                return callback();
              });
            }
          );
        });
      });
    });

    /**
     * Verify that group managers receive an email when someone joins that group.
     * Also verifies that private user information is appropriately scrubbed from the email.
     */
    it('verify group-join email and privacy', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 4, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: simong, 2: bert, 3: stuart } = users;

        // Simon is private, Bert is loggedin, mrvisser and stuart are both public
        const simongUpdate = {
          visibility: 'private',
          publicAlias: 'swappedFromPublicAlias'
        };

        const bertUpdate = {
          visibility: 'loggedin',
          publicAlias: 'swappedFromPublicAlias'
        };

        // Make Bert loggedin
        PrincipalsTestUtil.assertUpdateUserSucceeds(bert.restContext, bert.user.id, bertUpdate, () => {
          // Make Simon private
          PrincipalsTestUtil.assertUpdateUserSucceeds(simong.restContext, simong.user.id, simongUpdate, () => {
            // Create the group and then share it after. We will verify the share triggered an email
            RestAPI.Group.createGroup(
              mrvisser.restContext,
              'emailGroupAddMember',
              'emailGroupAddMember',
              PUBLIC,
              'yes',
              [],
              [],
              (error, group) => {
                assert.notExists(error);

                // Collect the createGroup activity and emails before adding a member
                EmailTestsUtil.collectAndFetchAllEmails((/* messages */) => {
                  // Join the group as simong to trigger an email with a private user
                  RestAPI.Group.joinGroup(simong.restContext, group.id, (error_) => {
                    assert.notExists(error_);

                    // Mrvisser should get an email, with simong's information scrubbed
                    EmailTestsUtil.collectAndFetchAllEmails((messages) => {
                      // There should be exactly one message, the one sent to mrvisser
                      assert.lengthOf(messages, 1);

                      const stringMessage = JSON.stringify(messages[0]);
                      const message = messages[0];

                      // Sanity check that the message is to mrvisser
                      assert.strictEqual(message.to[0].address, mrvisser.user.email);

                      // Ensure some data expected to be in the email is there
                      assert.notStrictEqual(stringMessage.indexOf(simong.restContext.hostHeader), -1);
                      assert.notStrictEqual(stringMessage.indexOf(group.profilePath), -1);
                      assert.notStrictEqual(stringMessage.indexOf(group.displayName), -1);

                      // Ensure simong's private info is *nowhere* to be found
                      assert.strictEqual(stringMessage.indexOf(simong.user.displayName), -1);
                      assert.strictEqual(stringMessage.indexOf(simong.user.email), -1);
                      assert.strictEqual(stringMessage.indexOf(simong.user.locale), -1);

                      // The message probably contains the public alias, though
                      assert.notStrictEqual(stringMessage.indexOf('swappedFromPublicAlias'), -1);

                      // Join the group as bert to trigger another email with a loggedin user
                      RestAPI.Group.joinGroup(bert.restContext, group.id, (error_) => {
                        assert.notExists(error_);

                        // Mrvisser should get an email, with Bert's information present
                        EmailTestsUtil.collectAndFetchAllEmails((messages) => {
                          // There should be exactly one message, the one sent to mrvisser
                          assert.strictEqual(messages.length, 1);

                          const stringMessage = JSON.stringify(messages[0]);
                          const message = messages[0];

                          // Sanity check that the message is to mrvisser
                          assert.strictEqual(message.to[0].address, mrvisser.user.email);

                          // Ensure some data expected to be in the email is there
                          assert.notStrictEqual(stringMessage.indexOf(bert.restContext.hostHeader), -1);
                          assert.notStrictEqual(stringMessage.indexOf(group.profilePath), -1);
                          assert.notStrictEqual(stringMessage.indexOf(group.displayName), -1);

                          // Ensure bert's displayName is not scrubbed
                          assert.notStrictEqual(stringMessage.indexOf(bert.user.displayName), -1);
                          assert.strictEqual(stringMessage.indexOf('swappedFromPublicAlias'), -1);

                          // The rest of bert's sensitive information should be scrubbed
                          assert.strictEqual(stringMessage.indexOf(bert.user.email), -1);
                          assert.strictEqual(stringMessage.indexOf(bert.user.locale), -1);

                          // Join the group as stuart to trigger another email with a public user
                          RestAPI.Group.joinGroup(stuart.restContext, group.id, (error_) => {
                            assert.notExists(error_);

                            // Mrvisser should get an email, with Stuart's information present
                            EmailTestsUtil.collectAndFetchAllEmails((messages) => {
                              // There should be exactly one message, the one sent to mrvisser
                              assert.lengthOf(messages, 1);

                              const stringMessage = JSON.stringify(messages[0]);
                              const message = messages[0];

                              // Sanity check that the message is to mrvisser
                              assert.strictEqual(message.to[0].address, mrvisser.user.email);

                              // Ensure some data expected to be in the email is there
                              assert.notStrictEqual(stringMessage.indexOf(stuart.restContext.hostHeader), -1);
                              assert.notStrictEqual(stringMessage.indexOf(group.profilePath), -1);
                              assert.notStrictEqual(stringMessage.indexOf(group.displayName), -1);

                              // Ensure stuart's displayName is not scrubbed
                              assert.notStrictEqual(stringMessage.indexOf(stuart.user.displayName), -1);
                              assert.strictEqual(stringMessage.indexOf('swappedFromPublicAlias'), -1);

                              // The rest of stuart's sensitive information should be scrubbed
                              assert.strictEqual(stringMessage.indexOf(stuart.user.email), -1);
                              assert.strictEqual(stringMessage.indexOf(stuart.user.locale), -1);

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
    });

    /**
     * Verify that when a user is added to a group, they receive an email. Also verifies that private user information
     * is appropriately scrubbed from the email.
     */
    it('verify group-add-member email and privacy', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: simong } = users;

        // Simon is private and mrvisser is public
        const simongUpdate = {
          visibility: 'private',
          publicAlias: 'swappedFromPublicAlias'
        };
        PrincipalsTestUtil.assertUpdateUserSucceeds(simong.restContext, simong.user.id, simongUpdate, () => {
          // Create the group and then share it after. We will verify the share triggered an email
          RestAPI.Group.createGroup(
            simong.restContext,
            'emailGroupAddMember',
            'emailGroupAddMember',
            PUBLIC,
            'yes',
            [],
            [],
            (error, group) => {
              assert.notExists(error);

              // Collect the createGroup activity and emails before adding a member
              EmailTestsUtil.collectAndFetchAllEmails((/* messages */) => {
                const roleChanges = {};
                roleChanges[mrvisser.user.id] = 'member';

                RestAPI.Group.setGroupMembers(simong.restContext, group.id, roleChanges, (error_) => {
                  assert.notExists(error_);

                  // Mrvisser should get an email, with simong's information scrubbed
                  EmailTestsUtil.collectAndFetchAllEmails((messages) => {
                    // There should be exactly one message, the one sent to mrvisser
                    assert.lengthOf(messages, 1);

                    const stringMessage = JSON.stringify(messages[0]);
                    const message = messages[0];

                    // Sanity check that the message is to mrvisser
                    assert.strictEqual(message.to[0].address, mrvisser.user.email);

                    // Ensure some data expected to be in the email is there
                    assert.notInclude(simong.restContext.hostHeader, stringMessage);
                    assert.notInclude(group.profilePath, stringMessage);
                    assert.notInclude(group.displayName, stringMessage);

                    // Ensure simong's private info is *nowhere* to be found
                    assert.notInclude(simong.user.displayName, stringMessage);
                    assert.notInclude(simong.user.email, stringMessage);
                    assert.notInclude(simong.user.locale, stringMessage);

                    // The message probably contains the public alias, though
                    assert.notStrictEqual(stringMessage.indexOf('swappedFromPublicAlias'), -1);

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
