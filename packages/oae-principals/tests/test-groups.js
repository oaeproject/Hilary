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

import fs from 'node:fs';
import { callbackify, format } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import _ from 'underscore';
import { keys, reject, isNil, forEach, map, path, last } from 'ramda';

import { assert } from 'chai';

import * as AuthzAPI from 'oae-authz';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import { runQuery } from 'oae-util/lib/cassandra.js';
import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import * as FoldersTestUtil from 'oae-folders/lib/test/util.js';
import * as LibraryTestUtil from 'oae-library/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util.js';
import * as TestsUtil from 'oae-tests';
import PrincipalsAPI from 'oae-principals';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util.js';

import { AuthzConstants } from 'oae-authz/lib/constants.js';
import { PrincipalsConstants } from 'oae-principals/lib/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PRIVATE = 'private';
const PUBLIC = 'public';

describe('Groups', () => {
  // Rest context that can be used to perform requests as different types of users
  let anonymousRestContext = null;
  let camAdminRestContext = null;
  let gtAdminRestContext = null;
  let johnRestContext = null;
  let globalAdminRestContext = null;
  let globalAdminOnTenantRestContext = null;

  /**
   * @return {Stream} A stream to jpg image
   * @api private
   */
  const _getPictureStream = () => fs.createReadStream(format('%s/data/restroom.jpg', __dirname));

  /**
   * Function that will create a user that will be used inside of the tests
   */
  before((callback) => {
    // Create all the REST contexts before each test
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();

    // Create the REST context for our test user
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
      assert.notExists(error);
      const { 0: john } = users;
      johnRestContext = john.restContext;

      // Add the full user id onto the REST context for use inside of this test
      johnRestContext.user = john.user;

      // Create the REST context for a global admin who is authenticated to a user tenant
      RestAPI.Admin.loginOnTenant(TestsUtil.createGlobalAdminRestContext(), 'localhost', null, (error, ctx) => {
        assert.notExists(error);
        globalAdminOnTenantRestContext = ctx;
        return callback();
      });
    });
  });

  describe('Create group', () => {
    /**
     * Test that verifies that group creation is successful when all of the parameters have been provided
     */
    it('verify that group creation succeeds given a valid request', (callback) => {
      const before = Date.now();
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        'Group description',
        PUBLIC,
        'yes',
        [],
        [],
        (error, groupObject) => {
          assert.notExists(error);

          assert.ok(groupObject.id);
          assert.strictEqual(groupObject.displayName, 'Group title');
          assert.strictEqual(groupObject.description, 'Group description');
          assert.strictEqual(groupObject.visibility, PUBLIC);
          assert.strictEqual(groupObject.joinable, 'yes');
          assert.strictEqual(groupObject.resourceType, 'group');
          assert.strictEqual(
            groupObject.profilePath,
            '/group/' + groupObject.tenant.alias + '/' + AuthzUtil.getResourceFromId(groupObject.id).resourceId
          );
          assert.ok(groupObject.lastModified);
          assert.ok(groupObject.lastModified >= before);
          assert.ok(groupObject.lastModified <= Date.now());
          assert.strictEqual(
            // eslint-disable-next-line radix
            new Date(Number.parseInt(groupObject.lastModified)).toUTCString(),
            groupObject.created
          );
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a group created without a visibility setting creates the group with the default tenant
     * group visibility setting
     */
    it('verify that missing visibility uses tenant default', (callback) => {
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        'Group description',
        undefined,
        'yes',
        [],
        [],
        (error, groupObject) => {
          assert.notExists(error);
          assert.strictEqual(groupObject.visibility, PUBLIC);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a group created without a joinability setting creates the group with the default tenant
     * group joinability setting
     */
    it('verify that missing joinable uses tenant default', (callback) => {
      // The system default is 'no'
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        'Group description',
        PUBLIC,
        undefined,
        [],
        [],
        (error, groupObject) => {
          assert.notExists(error);
          assert.strictEqual(groupObject.joinable, 'no');

          // Change it for the cambridge tenant to 'request.'
          ConfigTestUtil.updateConfigAndWait(
            camAdminRestContext,
            null,
            { 'oae-principals/group/joinable': 'request' },
            (error_) => {
              assert.notExists(error_);
              RestAPI.Group.createGroup(
                johnRestContext,
                'Group title',
                'Group description',
                PUBLIC,
                undefined,
                [],
                [],
                (error, groupObject) => {
                  assert.notExists(error);
                  assert.strictEqual(groupObject.joinable, 'request');

                  // Clear the value and verify it reverted.
                  ConfigTestUtil.clearConfigAndWait(
                    camAdminRestContext,
                    null,
                    ['oae-principals/group/joinable'],
                    (error_) => {
                      assert.notExists(error_);
                      RestAPI.Config.getTenantConfig(camAdminRestContext, null, (error, config) => {
                        assert.notExists(error);
                        assert.ok(config);
                        assert.strictEqual(config['oae-principals'].group.joinable, 'no');
                        return callback();
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

    /**
     * Test that verifies that a group created without a description creates a valid group
     */
    it('verify that missing description is accepted', (callback) => {
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        null,
        PUBLIC,
        undefined,
        [],
        [],
        (error, groupObject) => {
          assert.notExists(error);
          assert.strictEqual(groupObject.description, '');

          // Verify that an empty description is acceptable as well
          RestAPI.Group.createGroup(
            johnRestContext,
            'Group title',
            '',
            PUBLIC,
            undefined,
            [],
            [],
            (error, groupObject) => {
              assert.notExists(error);
              assert.strictEqual(groupObject.description, '');
              return callback();
            }
          );
        }
      );
    });

    /**
     * Test that verifies that creating a group with a displayName that is longer than the maximum allowed size is not possible
     */
    it('verify that long displayNames are not accepted', (callback) => {
      const displayName = TestsUtil.generateRandomText(100);
      RestAPI.Group.createGroup(
        johnRestContext,
        displayName,
        'description',
        PUBLIC,
        undefined,
        [],
        [],
        (error /* , groupObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.ok(error.msg.indexOf('1000') > 0);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that creating a group with a description that is longer than the maximum allowed size is not possible
     */
    it('verify that long descriptions are not accepted', (callback) => {
      const description = TestsUtil.generateRandomText(1000);
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        description,
        PUBLIC,
        undefined,
        [],
        [],
        (error /* , groupObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.ok(error.msg.indexOf('10000') > 0);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a group created with an invalid group manager does not succeed
     */
    it('verify that group creation fails if an invalid userId is specified as manager', (callback) => {
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        'Group description',
        PUBLIC,
        'yes',
        ['totally-invalid'],
        [],
        (error /* , groupObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a group created with an invalid group member does not succeed
     */
    it('verify that group creation fails if an invalid userId is specified as member', (callback) => {
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        'Group description',
        PUBLIC,
        'yes',
        [],
        ['totally-invalid'],
        (error /* , groupObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a group created with a non-existing group manager does not succeed
     */
    it('verify that group creation fails if an unknown user is specified as manager', (callback) => {
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        'Group description',
        PUBLIC,
        'yes',
        ['u:camtest:totally-unknown'],
        [],
        (error /* , groupObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a group created with a non-existing group member does not succeed
     */
    it('verify that group creation fails if an unknown user is specified as member', (callback) => {
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        'Group description',
        PUBLIC,
        'yes',
        [],
        ['u:camtest:totally-unknown'],
        (error /* , groupObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that anonymous users cannot create groups
     */
    it('verify anonymous group creation', (callback) => {
      RestAPI.Group.createGroup(
        anonymousRestContext,
        'Group title',
        'Group description',
        PUBLIC,
        'yes',
        [],
        [],
        (error /* , groupObj */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 401);
          return callback();
        }
      );
    });

    /**
     * Test that verifies that a list of members and meanagers can be passed in during group creation
     */
    it('verify that members can be specified on group creation', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);
        const { 0: jack, 1: jane } = users;

        RestAPI.Group.createGroup(
          johnRestContext,
          'Group title',
          'Group description',
          PUBLIC,
          'yes',
          [jane.user.id],
          [jack.user.id],
          (error, groupObject) => {
            assert.notExists(error);
            assert.ok(groupObject.id);
            assert.strictEqual(groupObject.displayName, 'Group title');
            assert.strictEqual(groupObject.resourceType, 'group');
            assert.strictEqual(
              groupObject.profilePath,
              '/group/' + groupObject.tenant.alias + '/' + AuthzUtil.getResourceFromId(groupObject.id).resourceId
            );

            // Get the members of this group
            RestAPI.Group.getGroupMembers(johnRestContext, groupObject.id, undefined, undefined, (error, members) => {
              assert.notExists(error);
              assert.strictEqual(members.results.length, 3);

              // Morph results to hash for easy access
              const hash = _.groupBy(members.results, (member) => member.profile.id);
              assert.strictEqual(hash[jack.user.id][0].role, 'member');
              assert.strictEqual(hash[jane.user.id][0].role, 'manager');
              assert.strictEqual(hash[johnRestContext.user.id][0].role, 'manager');
              return callback();
            });
          }
        );
      });
    });
  });

  describe('Get group', () => {
    /**
     * Test that verifies that an existing group can be successfully retrieved
     */
    it('verify group properties', (callback) => {
      // Create a group with a profile picture
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        'Group description',
        PRIVATE,
        'request',
        [],
        [],
        (error, createdGroup) => {
          assert.notExists(error);
          PrincipalsTestUtil.uploadAndCropPicture(
            johnRestContext,
            createdGroup.id,
            _getPictureStream,
            { x: 10, y: 10, width: 200 },
            () => {
              // Get the group profile and verify its model
              RestAPI.Group.getGroup(johnRestContext, createdGroup.id, (error, fetchedGroup) => {
                assert.notExists(error);
                assert.ok(fetchedGroup.isMember);
                assert.ok(fetchedGroup.isManager);
                assert.strictEqual(fetchedGroup.displayName, 'Group title');
                assert.strictEqual(fetchedGroup.description, 'Group description');
                assert.strictEqual(fetchedGroup.visibility, PRIVATE);
                assert.strictEqual(fetchedGroup.joinable, 'request');
                assert.strictEqual(fetchedGroup.createdBy.id.slice(0, 10), 'u:camtest:');
                assert.strictEqual(fetchedGroup.createdBy.displayName, johnRestContext.user.displayName);
                assert.ok(fetchedGroup.created);
                assert.strictEqual(fetchedGroup.resourceType, 'group');
                assert.strictEqual(
                  createdGroup.profilePath,
                  '/group/' + createdGroup.tenant.alias + '/' + AuthzUtil.getResourceFromId(createdGroup.id).resourceId
                );
                assert.isObject(createdGroup.tenant);
                assert.lengthOf(keys(fetchedGroup.tenant), 3);
                assert.strictEqual(fetchedGroup.tenant.displayName, global.oaeTests.tenants.cam.displayName);
                assert.strictEqual(fetchedGroup.tenant.alias, global.oaeTests.tenants.cam.alias);
                assert.ok(!fetchedGroup.picture.smallUri);
                assert.ok(!fetchedGroup.picture.mediumUri);
                assert.ok(!fetchedGroup.picture.largeUri);
                assert.ok(fetchedGroup.picture.small);
                assert.ok(fetchedGroup.picture.medium);
                assert.ok(fetchedGroup.picture.large);

                // Delete the group createdBy user and assert the group can still be retrieved
                callbackify(runQuery)(
                  'DELETE "createdBy" from "Principals" WHERE "principalId"=?',
                  [fetchedGroup.id],
                  (error_) => {
                    assert.notExists(error_);

                    // Get the group profile and verify its model
                    RestAPI.Group.getGroup(johnRestContext, createdGroup.id, (error, fetchedGroup) => {
                      assert.notExists(error);
                      assert.ok(fetchedGroup.isMember);
                      assert.ok(fetchedGroup.isManager);
                      assert.strictEqual(fetchedGroup.displayName, 'Group title');
                      assert.strictEqual(fetchedGroup.description, 'Group description');
                      assert.strictEqual(fetchedGroup.visibility, PRIVATE);
                      assert.strictEqual(fetchedGroup.joinable, 'request');
                      assert.ok(!fetchedGroup.createdBy);
                      assert.ok(fetchedGroup.created);
                      assert.strictEqual(fetchedGroup.resourceType, 'group');
                      assert.strictEqual(
                        createdGroup.profilePath,
                        '/group/' +
                          createdGroup.tenant.alias +
                          '/' +
                          AuthzUtil.getResourceFromId(createdGroup.id).resourceId
                      );
                      assert.isObject(createdGroup.tenant);
                      assert.lengthOf(keys(fetchedGroup.tenant), 3);
                      assert.strictEqual(fetchedGroup.tenant.displayName, global.oaeTests.tenants.cam.displayName);
                      assert.strictEqual(fetchedGroup.tenant.alias, global.oaeTests.tenants.cam.alias);
                      assert.ok(!fetchedGroup.picture.smallUri);
                      assert.ok(!fetchedGroup.picture.mediumUri);
                      assert.ok(!fetchedGroup.picture.largeUri);
                      assert.ok(fetchedGroup.picture.small);
                      assert.ok(fetchedGroup.picture.medium);
                      assert.ok(fetchedGroup.picture.large);

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

    /**
     * Test that verifies that a non-existing group cannot be retrieved
     */
    it('verify non existing group', (callback) => {
      // Invalid group identifier
      RestAPI.Group.getGroup(johnRestContext, 'totally-unknown', (error, groupData) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        assert.ok(!groupData);

        // Non existing group
        RestAPI.Group.getGroup(johnRestContext, 'g:camtest:totally-unknown', (error, groupData) => {
          assert.ok(error);
          assert.strictEqual(error.code, 404);
          assert.ok(!groupData);
          return callback();
        });
      });
    });

    /**
     * Test that verifies that the isMember and isManager property is properly set on the
     * group profile in different situations
     */
    it('verify isMember and isManager', (callback) => {
      // Create 3 users. We'll make jane a group manager and jack a group
      // member. Joe won't be a member of the group
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (error, users) => {
        assert.notExists(error);
        const { 0: jack, 1: jane, 2: joe } = users;

        // Create a group in which Jane is a manager and Jack is a member
        RestAPI.Group.createGroup(
          johnRestContext,
          'Group title',
          'Group description',
          PUBLIC,
          'yes',
          [jane.user.id],
          [jack.user.id],
          (error, newGroup) => {
            assert.notExists(error);

            // For each of the users, check the appropriate value of the isMember and isManager property
            RestAPI.Group.getGroup(johnRestContext, newGroup.id, (error, groupData) => {
              assert.notExists(error);
              assert.ok(groupData.isMember);
              assert.ok(groupData.isManager);

              RestAPI.Group.getGroup(jack.restContext, newGroup.id, (error, groupData) => {
                assert.notExists(error);
                assert.ok(groupData.isMember);
                assert.ok(!groupData.isManager);

                RestAPI.Group.getGroup(jane.restContext, newGroup.id, (error, groupData) => {
                  assert.notExists(error);
                  assert.ok(groupData.isMember);
                  assert.ok(groupData.isManager);

                  RestAPI.Group.getGroup(joe.restContext, newGroup.id, (error, groupData) => {
                    assert.notExists(error);
                    assert.ok(!groupData.isMember);
                    assert.ok(!groupData.isManager);

                    // Tenant admins are considered members and managers.
                    RestAPI.Group.getGroup(camAdminRestContext, newGroup.id, (error, groupData) => {
                      assert.notExists(error);
                      assert.ok(groupData.isMember);
                      assert.ok(groupData.isManager);

                      // Verify another tenant admin is not a manager or member.
                      RestAPI.Group.getGroup(gtAdminRestContext, newGroup.id, (error, groupData) => {
                        assert.notExists(error);
                        assert.ok(!groupData.isMember);
                        assert.ok(!groupData.isManager);
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

    /**
     * Test that verifies the different visibility cases of accessing a joinable group
     */
    it('verify different visibility combinations of getting a joinable group', (callback) => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2, privateTenant1) => {
        PrincipalsTestUtil.addUserToAllGroups(
          publicTenant1.publicUser,
          publicTenant1,
          publicTenant2,
          privateTenant1,
          () => {
            // 1. Public group

            // Ensure anonymous can see it
            RestAPI.Group.getGroup(
              publicTenant1.anonymousRestContext,
              publicTenant1.publicGroup.id,
              (error /* , group */) => {
                assert.notExists(error);

                // Ensure user from another tenant can see it
                RestAPI.Group.getGroup(
                  publicTenant2.publicUser.restContext,
                  publicTenant1.publicGroup.id,
                  (error /* , groupObj */) => {
                    assert.notExists(error);

                    // Ensure user from same tenant can see it
                    RestAPI.Group.getGroup(
                      publicTenant1.privateUser.restContext,
                      publicTenant1.publicGroup.id,
                      (error /* , groupObj */) => {
                        assert.notExists(error);

                        // Ensure member user can see it
                        RestAPI.Group.getGroup(
                          publicTenant1.publicUser.restContext,
                          publicTenant1.publicGroup.id,
                          (error /* , groupObj */) => {
                            assert.notExists(error);

                            // Ensure tenant admin can see it
                            RestAPI.Group.getGroup(
                              publicTenant1.adminRestContext,
                              publicTenant1.publicGroup.id,
                              (error /* , groupObj */) => {
                                assert.notExists(error);

                                // Ensure global admin can see it
                                RestAPI.Group.getGroup(
                                  globalAdminOnTenantRestContext,
                                  publicTenant1.publicGroup.id,
                                  (error /* , groupObj */) => {
                                    assert.notExists(error);

                                    // 2. Loggedin group

                                    // Ensure anonymous cannot see it
                                    RestAPI.Group.getGroup(
                                      publicTenant1.anonymousRestContext,
                                      publicTenant1.loggedinJoinableGroup.id,
                                      (error /* , groupObj */) => {
                                        assert.ok(error);
                                        assert.strictEqual(error.code, 401);

                                        // Issue1402: If a group is joinable, whether directly or by request, then the user does not get a 401 otherwise he would not be able to join it
                                        RestAPI.Group.getGroup(
                                          publicTenant2.publicUser.restContext,
                                          publicTenant1.loggedinJoinableGroup.id,
                                          (error /* , groupObj */) => {
                                            assert.notExists(error);

                                            // Ensure user from another private tenant cannot see it
                                            RestAPI.Group.getGroup(
                                              privateTenant1.publicUser.restContext,
                                              publicTenant1.loggedinJoinableGroup.id,
                                              (error /* , groupObj */) => {
                                                assert.ok(error);
                                                assert.strictEqual(error.code, 401);

                                                // Ensure user from same tenant can see it
                                                RestAPI.Group.getGroup(
                                                  publicTenant1.privateUser.restContext,
                                                  publicTenant1.loggedinJoinableGroup.id,
                                                  (error /* , groupObj */) => {
                                                    assert.notExists(error);

                                                    // Ensure member user from another tenant can see it
                                                    RestAPI.Group.getGroup(
                                                      publicTenant1.publicUser.restContext,
                                                      publicTenant2.loggedinJoinableGroup.id,
                                                      (error /* , groupObj */) => {
                                                        assert.notExists(error);

                                                        // Ensure tenant admin can see it
                                                        RestAPI.Group.getGroup(
                                                          publicTenant1.adminRestContext,
                                                          publicTenant1.loggedinJoinableGroup.id,
                                                          (error /* , groupObj */) => {
                                                            assert.notExists(error);

                                                            // Ensure global admin can see it
                                                            RestAPI.Group.getGroup(
                                                              globalAdminOnTenantRestContext,
                                                              publicTenant1.loggedinJoinableGroup.id,
                                                              (error /* , groupObj */) => {
                                                                assert.notExists(error);

                                                                // 3. Private group

                                                                // Ensure anonymous cannot see it
                                                                RestAPI.Group.getGroup(
                                                                  publicTenant1.anonymousRestContext,
                                                                  publicTenant1.privateJoinableGroup.id,
                                                                  (error /* , groupObj */) => {
                                                                    assert.ok(error);
                                                                    assert.strictEqual(error.code, 401);

                                                                    // Ensure user from another public tenant cannot see it
                                                                    RestAPI.Group.getGroup(
                                                                      publicTenant2.publicUser.restContext,
                                                                      publicTenant1.privateJoinableGroup.id,
                                                                      (error /* , groupObj */) => {
                                                                        assert.notExists(error);

                                                                        // Ensure user from another private tenant cannot see it
                                                                        RestAPI.Group.getGroup(
                                                                          privateTenant1.publicUser.restContext,
                                                                          publicTenant1.privateJoinableGroup.id,
                                                                          (error /* , groupObj */) => {
                                                                            assert.ok(error);
                                                                            assert.strictEqual(error.code, 401);

                                                                            // Ensure user from same tenant can see it (since they would be able to join it)
                                                                            RestAPI.Group.getGroup(
                                                                              publicTenant1.privateUser.restContext,
                                                                              publicTenant1.privateJoinableGroup.id,
                                                                              (error /* , groupObj */) => {
                                                                                assert.notExists(error);
                                                                                // Ensure member user from another tenant can see it
                                                                                RestAPI.Group.getGroup(
                                                                                  publicTenant1.publicUser.restContext,
                                                                                  publicTenant2.privateJoinableGroup.id,
                                                                                  (error /* , groupObj */) => {
                                                                                    assert.notExists(error);

                                                                                    // Ensure tenant admin can see it
                                                                                    RestAPI.Group.getGroup(
                                                                                      publicTenant1.adminRestContext,
                                                                                      publicTenant1.privateJoinableGroup
                                                                                        .id,
                                                                                      (error /* , groupObj */) => {
                                                                                        assert.notExists(error);

                                                                                        // Ensure global admin can see it
                                                                                        RestAPI.Group.getGroup(
                                                                                          globalAdminOnTenantRestContext,
                                                                                          publicTenant1
                                                                                            .privateJoinableGroup.id,
                                                                                          (error /* , groupObj */) => {
                                                                                            assert.notExists(error);
                                                                                            RestAPI.Group.getGroup(
                                                                                              globalAdminOnTenantRestContext,
                                                                                              publicTenant1
                                                                                                .privateJoinableGroupByRequest
                                                                                                .id,
                                                                                              (
                                                                                                error /* , groupObj */
                                                                                              ) => {
                                                                                                assert.notExists(error);
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

    it('verify different visibility combinations of getting a joinable group by request', (callback) => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2, privateTenant1) => {
        PrincipalsTestUtil.addUserToAllGroups(
          publicTenant1.publicUser,
          publicTenant1,
          publicTenant2,
          privateTenant1,
          () => {
            // 1. Public group

            // Ensure anonymous can see it
            RestAPI.Group.getGroup(
              publicTenant1.anonymousRestContext,
              publicTenant1.publicGroup.id,
              (error /* , groupObj */) => {
                assert.notExists(error);

                // 2. Loggedin group

                // Ensure anonymous cannot see it
                // Issue1402: If a group is joinable, whether directly or by request, then the user does not get a 401 otherwise he would not be able to join it
                RestAPI.Group.getGroup(
                  publicTenant2.publicUser.restContext,
                  publicTenant1.loggedinJoinableGroupByRequest.id,
                  (error /* , groupObj */) => {
                    assert.notExists(error);

                    // Ensure user from another private tenant cannot see it

                    RestAPI.Group.getGroup(
                      publicTenant1.privateUser.restContext,
                      publicTenant1.loggedinJoinableGroupByRequest.id,
                      (error /* , groupObj */) => {
                        assert.notExists(error);

                        RestAPI.Group.getGroup(
                          publicTenant1.publicUser.restContext,
                          publicTenant2.loggedinJoinableGroupByRequest.id,
                          (error /* , groupObj */) => {
                            assert.notExists(error);

                            // Ensure tenant admin can see it
                            RestAPI.Group.getGroup(
                              publicTenant1.adminRestContext,
                              publicTenant1.loggedinJoinableGroupByRequest.id,
                              (error /* , groupObj */) => {
                                assert.notExists(error);

                                // Ensure global admin can see it
                                RestAPI.Group.getGroup(
                                  globalAdminOnTenantRestContext,
                                  publicTenant1.loggedinJoinableGroupByRequest.id,
                                  (error /* , groupObj */) => {
                                    assert.notExists(error);

                                    // 3. Private group

                                    // Ensure anonymous cannot see it
                                    RestAPI.Group.getGroup(
                                      publicTenant1.anonymousRestContext,
                                      publicTenant1.privateJoinableGroupByRequest.id,
                                      (error /* , groupObj */) => {
                                        assert.ok(error);
                                        assert.strictEqual(error.code, 401);

                                        // Ensure user from another public tenant cannot see it
                                        RestAPI.Group.getGroup(
                                          publicTenant2.publicUser.restContext,
                                          publicTenant1.privateJoinableGroupByRequest.id,
                                          (error /* , groupObj */) => {
                                            assert.notExists(error);

                                            // Ensure user from another private tenant cannot see it
                                            RestAPI.Group.getGroup(
                                              privateTenant1.publicUser.restContext,
                                              publicTenant1.privateJoinableGroupByRequest.id,
                                              (error /* , groupObj */) => {
                                                assert.ok(error);
                                                assert.strictEqual(error.code, 401);

                                                RestAPI.Group.getGroup(
                                                  publicTenant1.privateUser.restContext,
                                                  publicTenant1.privateJoinableGroupByRequest.id,
                                                  (error /* , groupObj */) => {
                                                    assert.notExists(error);

                                                    RestAPI.Group.getGroup(
                                                      publicTenant1.publicUser.restContext,
                                                      publicTenant2.privateJoinableGroupByRequest.id,
                                                      (error /* , groupObj */) => {
                                                        assert.notExists(error);

                                                        RestAPI.Group.getGroup(
                                                          publicTenant1.adminRestContext,
                                                          publicTenant1.privateJoinableGroupByRequest.id,
                                                          (error /* , groupObj */) => {
                                                            assert.notExists(error);

                                                            RestAPI.Group.getGroup(
                                                              globalAdminOnTenantRestContext,
                                                              publicTenant1.privateJoinableGroupByRequest.id,
                                                              (error /* , groupObj */) => {
                                                                assert.notExists(error);
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
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies the different visibility cases of accessing an unjoinable group
     */
    it('verify different visibility combinations of getting an unjoinable group', (callback) => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2, privateTenant1) => {
        // Make all the groups non-joinable
        PrincipalsTestUtil.updateAllGroups(
          publicTenant1,
          publicTenant2,
          privateTenant1,
          { joinable: AuthzConstants.joinable.NO },
          () => {
            // Add the public user from publicTenant1 to all the groups
            PrincipalsTestUtil.addUserToAllGroups(
              publicTenant1.publicUser,
              publicTenant1,
              publicTenant2,
              privateTenant1,
              () => {
                // 1. Public group

                // Ensure anonymous can see it
                RestAPI.Group.getGroup(
                  publicTenant1.anonymousRestContext,
                  publicTenant1.publicGroup.id,
                  (error /* , groupObj */) => {
                    assert.notExists(error);

                    // Ensure user from another tenant can see it
                    RestAPI.Group.getGroup(
                      publicTenant2.publicUser.restContext,
                      publicTenant1.publicGroup.id,
                      (error /* , groupObj */) => {
                        assert.notExists(error);

                        // Ensure user from same tenant can see it
                        RestAPI.Group.getGroup(
                          publicTenant1.privateUser.restContext,
                          publicTenant1.publicGroup.id,
                          (error /* , groupObj */) => {
                            assert.notExists(error);

                            // Ensure member user can see it
                            RestAPI.Group.getGroup(
                              publicTenant1.publicUser.restContext,
                              publicTenant1.publicGroup.id,
                              (error /* , groupObj */) => {
                                assert.notExists(error);

                                // Ensure tenant admin can see it
                                RestAPI.Group.getGroup(
                                  publicTenant1.adminRestContext,
                                  publicTenant1.publicGroup.id,
                                  (error /* , groupObj */) => {
                                    assert.notExists(error);

                                    // Ensure global admin can see it
                                    RestAPI.Group.getGroup(
                                      globalAdminOnTenantRestContext,
                                      publicTenant1.publicGroup.id,
                                      (error /* , groupObj */) => {
                                        assert.notExists(error);

                                        // 2. Loggedin group

                                        // Ensure anonymous cannot see it
                                        RestAPI.Group.getGroup(
                                          publicTenant1.anonymousRestContext,
                                          publicTenant1.loggedinNotJoinableGroup.id,
                                          (error /* , groupObj */) => {
                                            assert.ok(error);
                                            assert.strictEqual(error.code, 401);

                                            // Ensure user from another public tenant cannot see it (since they would not be able to join it as it is not joinable)
                                            RestAPI.Group.getGroup(
                                              publicTenant2.publicUser.restContext,
                                              publicTenant1.loggedinNotJoinableGroup.id,
                                              (error /* , groupObj */) => {
                                                assert.ok(error);
                                                assert.strictEqual(error.code, 401);

                                                // Ensure user from another private tenant cannot see it (since they would not be able to join it)
                                                RestAPI.Group.getGroup(
                                                  privateTenant1.publicUser.restContext,
                                                  publicTenant1.loggedinNotJoinableGroup.id,
                                                  (error /* , groupObj */) => {
                                                    assert.ok(error);
                                                    assert.strictEqual(error.code, 401);

                                                    // Ensure user from same tenant can see it
                                                    RestAPI.Group.getGroup(
                                                      publicTenant1.privateUser.restContext,
                                                      publicTenant1.loggedinNotJoinableGroup.id,
                                                      (error /* , groupObj */) => {
                                                        assert.notExists(error);

                                                        // Ensure member user from another tenant can see it
                                                        RestAPI.Group.getGroup(
                                                          publicTenant1.publicUser.restContext,
                                                          publicTenant2.loggedinNotJoinableGroup.id,
                                                          (error /* , groupObj */) => {
                                                            assert.notExists(error);

                                                            // Ensure tenant admin can see it
                                                            RestAPI.Group.getGroup(
                                                              publicTenant1.adminRestContext,
                                                              publicTenant1.loggedinNotJoinableGroup.id,
                                                              (error /* , groupObj */) => {
                                                                assert.notExists(error);

                                                                // Ensure global admin can see it
                                                                RestAPI.Group.getGroup(
                                                                  globalAdminOnTenantRestContext,
                                                                  publicTenant1.loggedinNotJoinableGroup.id,
                                                                  (error /* , groupObj */) => {
                                                                    assert.notExists(error);

                                                                    // 3. Private group

                                                                    // Ensure anonymous cannot see it
                                                                    RestAPI.Group.getGroup(
                                                                      publicTenant1.anonymousRestContext,
                                                                      publicTenant1.loggedinNotJoinableGroup.id,
                                                                      (error /* , groupObj */) => {
                                                                        assert.ok(error);
                                                                        assert.strictEqual(error.code, 401);

                                                                        // Ensure user from another public tenant cannot see it (since they would not be able to join it as it's unjoinable)
                                                                        RestAPI.Group.getGroup(
                                                                          publicTenant2.publicUser.restContext,
                                                                          publicTenant1.loggedinNotJoinableGroup.id,
                                                                          (error /* , groupObj */) => {
                                                                            assert.ok(error);
                                                                            assert.strictEqual(error.code, 401);

                                                                            // Ensure user from another private tenant cannot see it (since they would not be able to join it)
                                                                            RestAPI.Group.getGroup(
                                                                              privateTenant1.publicUser.restContext,
                                                                              publicTenant1.loggedinNotJoinableGroup.id,
                                                                              (error /* , groupObj */) => {
                                                                                assert.ok(error);
                                                                                assert.strictEqual(error.code, 401);

                                                                                // Ensure user from same tenant can see it (since they would be able to join it)
                                                                                RestAPI.Group.getGroup(
                                                                                  publicTenant1.privateUser.restContext,
                                                                                  publicTenant1.loggedinNotJoinableGroup
                                                                                    .id,
                                                                                  (error /* , groupObj */) => {
                                                                                    assert.notExists(error);

                                                                                    // Ensure member user from another tenant can see it
                                                                                    RestAPI.Group.getGroup(
                                                                                      publicTenant1.publicUser
                                                                                        .restContext,
                                                                                      publicTenant2
                                                                                        .privateNotJoinableGroup.id,
                                                                                      (error /* , groupObj */) => {
                                                                                        assert.notExists(error);

                                                                                        // Ensure tenant admin can see it
                                                                                        RestAPI.Group.getGroup(
                                                                                          publicTenant1.adminRestContext,
                                                                                          publicTenant1
                                                                                            .loggedinNotJoinableGroup
                                                                                            .id,
                                                                                          (error /* , groupObj */) => {
                                                                                            assert.notExists(error);

                                                                                            // Ensure global admin can see it
                                                                                            RestAPI.Group.getGroup(
                                                                                              globalAdminOnTenantRestContext,
                                                                                              publicTenant1
                                                                                                .loggedinNotJoinableGroup
                                                                                                .id,
                                                                                              (
                                                                                                error /* , groupObj */
                                                                                              ) => {
                                                                                                assert.notExists(error);
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
     * Test that verifies that latest visit is updated when a group is visited
     */
    it('verify latest visit to group is recorded and can be fetched', (callback) => {
      // Create our test user and put them in the rest context
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: jane } = users;
        jane.restContext.user = jane.user;
        // Create the test groups
        RestAPI.Group.createGroup(
          johnRestContext,
          'Group title',
          'Group description',
          PUBLIC,
          'yes',
          [],
          [jane.user.id],
          (error, groupOne) => {
            assert.notExists(error);
            RestAPI.Group.createGroup(
              johnRestContext,
              'Other Group title',
              'Other Group description',
              PUBLIC,
              'yes',
              [],
              [jane.user.id],
              (error, groupTwo) => {
                assert.notExists(error);
                // Get the group profile
                RestAPI.Group.getGroup(jane.restContext, groupOne.id, (error, fetchedGroup) => {
                  assert.notExists(error);
                  assert.strictEqual(fetchedGroup.displayName, 'Group title');
                  assert.strictEqual(fetchedGroup.description, 'Group description');
                  // Check that recently visited groups includes the test group
                  RestAPI.User.getRecentlyVisitedGroups(jane.restContext, jane.user.id, (error, recentGroups) => {
                    assert.notExists(error);
                    assert.strictEqual(recentGroups.results[0].id, groupOne.id);
                    // Visit the second group
                    RestAPI.Group.getGroup(jane.restContext, groupTwo.id, (error, fetchedGroup) => {
                      assert.notExists(error);
                      assert.strictEqual(fetchedGroup.displayName, 'Other Group title');
                      assert.strictEqual(fetchedGroup.description, 'Other Group description');
                      // Check that recently visited groups includes the second group as first item and previous group as second item
                      RestAPI.User.getRecentlyVisitedGroups(jane.restContext, jane.user.id, (error, recentGroups) => {
                        assert.notExists(error);
                        assert.strictEqual(recentGroups.results[0].id, groupTwo.id);
                        assert.strictEqual(recentGroups.results[1].id, groupOne.id);
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
  });

  describe('Update group', () => {
    /**
     * Test that verifies that a group can be successfully update with multiple fields
     * at the same time
     */
    it('verify successful update', (callback) => {
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        'Group description',
        PRIVATE,
        'request',
        [],
        [],
        (error, newGroup) => {
          assert.notExists(error);
          const profileFields = {
            displayName: 'new group name',
            description: 'new group description',
            visibility: 'loggedin',
            joinable: 'yes'
          };

          // Give the group a profile picture so we can examine its returned model
          PrincipalsTestUtil.uploadAndCropPicture(
            johnRestContext,
            newGroup.id,
            _getPictureStream,
            { x: 10, y: 10, width: 200 },
            () => {
              // Wait 5ms to update the group to ensure we get a different lastModified time
              setTimeout(
                RestAPI.Group.updateGroup,
                5,
                johnRestContext,
                newGroup.id,
                profileFields,
                (error, updatedGroup) => {
                  assert.notExists(error);
                  assert.strictEqual(updatedGroup.displayName, 'new group name');
                  assert.strictEqual(updatedGroup.description, 'new group description');
                  assert.strictEqual(updatedGroup.visibility, 'loggedin');
                  assert.strictEqual(updatedGroup.joinable, 'yes');
                  assert.ok(updatedGroup.lastModified);
                  assert.ok(updatedGroup.lastModified > newGroup.lastModified);
                  assert.strictEqual(updatedGroup.isManager, true);
                  assert.strictEqual(updatedGroup.isMember, true);
                  assert.strictEqual(updatedGroup.canJoin, false);
                  assert.ok(!updatedGroup.picture.smallUri);
                  assert.ok(!updatedGroup.picture.mediumUri);
                  assert.ok(!updatedGroup.picture.largeUri);
                  assert.ok(updatedGroup.picture.small);
                  assert.ok(updatedGroup.picture.medium);
                  assert.ok(updatedGroup.picture.large);

                  // Get the group and verify the update took place successfully
                  RestAPI.Group.getGroup(johnRestContext, newGroup.id, (error, group) => {
                    assert.notExists(error);
                    assert.strictEqual(group.id, newGroup.id);
                    assert.strictEqual(group.displayName, 'new group name');
                    assert.strictEqual(group.description, 'new group description');
                    assert.strictEqual(group.visibility, 'loggedin');
                    assert.strictEqual(group.joinable, 'yes');
                    assert.strictEqual(group.resourceType, 'group');
                    assert.strictEqual(
                      group.profilePath,
                      '/group/' + group.tenant.alias + '/' + AuthzUtil.getResourceFromId(group.id).resourceId
                    );
                    assert.strictEqual(group.lastModified, updatedGroup.lastModified);
                    assert.strictEqual(group.isMember, true);
                    assert.strictEqual(group.isManager, true);
                    assert.strictEqual(group.canJoin, false);
                    assert.ok(!updatedGroup.picture.smallUri);
                    assert.ok(!updatedGroup.picture.mediumUri);
                    assert.ok(!updatedGroup.picture.largeUri);
                    assert.ok(updatedGroup.picture.small);
                    assert.ok(updatedGroup.picture.medium);
                    assert.ok(updatedGroup.picture.large);
                    return callback();
                  });
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies updating a non-existent group fails
     */
    it('verify update non-existent group fails', (callback) => {
      const groupId = format('g:%s:%s', global.oaeTests.tenants.cam.alias, TestsUtil.generateTestGroupId());
      RestAPI.Group.updateGroup(johnRestContext, groupId, { joinable: 'yes' }, (error, updatedGroup) => {
        assert.strictEqual(error.code, 404);
        assert.ok(!updatedGroup);
        return callback();
      });
    });

    /**
     * Test that verifies that updating a group with no parameters fails
     */
    it('verify updating a group with no parameters fails', (callback) => {
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        'Group description',
        PRIVATE,
        'request',
        [],
        [],
        (error, newGroup) => {
          assert.notExists(error);
          RestAPI.Group.updateGroup(johnRestContext, newGroup.id, {}, (error, updatedGroup) => {
            assert.strictEqual(error.code, 400);
            assert.ok(!updatedGroup);
            return callback();
          });
        }
      );
    });

    /**
     * Test that verifies that an unrecognized joinability option causes the update to fail
     */
    it('verify updating a group with an invalid joinable parameter fails', (callback) => {
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        'Group description',
        PRIVATE,
        'request',
        [],
        [],
        (error, newGroup) => {
          assert.notExists(error);
          RestAPI.Group.updateGroup(johnRestContext, newGroup.id, { joinable: 'invalid' }, (error, updatedGroup) => {
            assert.strictEqual(error.code, 400);
            assert.ok(!updatedGroup);
            return callback();
          });
        }
      );
    });

    /**
     * Test that verifies that an unrecognized visibility option causes the update to fail
     */
    it('verify updating a group with an invalid visibility fails', (callback) => {
      RestAPI.Group.createGroup(
        johnRestContext,
        'Group title',
        'Group description',
        PRIVATE,
        'request',
        [],
        [],
        (error, newGroup) => {
          assert.notExists(error);
          RestAPI.Group.updateGroup(johnRestContext, newGroup.id, { visibility: 'invalid' }, (error, updatedGroup) => {
            assert.strictEqual(error.code, 400);
            assert.ok(!updatedGroup);
            return callback();
          });
        }
      );
    });

    /**
     * Test that verifies that a displayName that is longer than the maximum allowed size causes the update to fail
     */
    it('verify updating a group with an invalid displayName fails', (callback) => {
      const displayName = TestsUtil.generateRandomText(100);
      RestAPI.Group.createGroup(
        johnRestContext,
        'displayName',
        'description',
        PRIVATE,
        'request',
        [],
        [],
        (error, newGroup) => {
          assert.notExists(error);
          RestAPI.Group.updateGroup(johnRestContext, newGroup.id, { displayName }, (error, updatedGroup) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);
            assert.ok(error.msg.indexOf('1000') > 0);
            assert.ok(!updatedGroup);
            return callback();
          });
        }
      );
    });

    /**
     * Test that verifies that a description that is longer than the maximum allowed size causes the update to fail
     */
    it('verify updating a group with an invalid description fails', (callback) => {
      const description = TestsUtil.generateRandomText(1000);
      RestAPI.Group.createGroup(
        johnRestContext,
        'displayName',
        'description',
        PRIVATE,
        'request',
        [],
        [],
        (error, newGroup) => {
          assert.notExists(error);
          RestAPI.Group.updateGroup(johnRestContext, newGroup.id, { description }, (error, updatedGroup) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);
            assert.ok(error.msg.indexOf('10000') > 0);
            assert.ok(!updatedGroup);

            // Verify that an empty description is acceptable
            RestAPI.Group.updateGroup(
              johnRestContext,
              newGroup.id,
              { description: '' },
              (error /* , updatedGroup */) => {
                assert.notExists(error);
                return callback();
              }
            );
          });
        }
      );
    });

    /**
     * Test that verifies that updating the `deleted` flag of a group fails
     */
    it('verify updating a group deleted flag fails', (callback) => {
      // Create a group to test with
      RestAPI.Group.createGroup(
        johnRestContext,
        'displayName',
        'description',
        PRIVATE,
        'request',
        [],
        [],
        (error, createdGroup) => {
          assert.notExists(error);

          // Try and update a 'deleted' flag on the group, ensuring it fails
          RestAPI.Group.updateGroup(johnRestContext, createdGroup.id, { deleted: true }, (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 400);

            // Ensure the 'deleted' field of the group has not changed
            RestAPI.Group.getGroup(johnRestContext, createdGroup.id, (error, afterUpdateGroup) => {
              assert.notExists(error);
              assert.strictEqual(createdGroup.deleted, afterUpdateGroup.deleted);
              return callback();
            });
          });
        }
      );
    });

    /**
     * Test that verifies that a non-manager of a group cannot update the group
     */
    it('verify updating as a non-manager is not allowed', (callback) => {
      // We create 2 users. Jack will be a member, Jane will not be a member
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);
        const { 0: jack, 1: jane } = users;

        // Create the group with Jack as a member
        RestAPI.Group.createGroup(
          johnRestContext,
          'Group title',
          'Group description',
          PRIVATE,
          'request',
          [],
          [jack.user.id],
          (error, newGroup) => {
            assert.notExists(error);

            // Try to update the group as a member
            RestAPI.Group.updateGroup(jack.restContext, newGroup.id, { visibility: PUBLIC }, (error, updatedGroup) => {
              assert.strictEqual(error.code, 401);
              assert.ok(!updatedGroup);
              // Try to update the group as a non-member
              RestAPI.Group.updateGroup(
                jane.restContext,
                newGroup.id,
                { visibility: PUBLIC },
                (error, updatedGroup) => {
                  assert.strictEqual(error.code, 401);
                  assert.ok(!updatedGroup);
                  // Try to update the group as an anonymous user
                  RestAPI.Group.updateGroup(
                    TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host),
                    newGroup.id,
                    { visibility: PUBLIC },
                    (error, updatedGroup) => {
                      assert.strictEqual(error.code, 401);
                      assert.ok(!updatedGroup);
                      return callback();
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

  describe('Set group members', () => {
    /**
     * Test that verifies that users who are not a manager of a group cannot add/remove members to that group
     */
    it('verify simple member adding', (callback) => {
      // Create a first user to use inside of test
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);
        const { 0: branden, 1: nicolaas } = users;

        // Create a group
        RestAPI.Group.createGroup(
          johnRestContext,
          'Test Group',
          'Group',
          PUBLIC,
          'yes',
          [],
          [],
          (error, groupObject) => {
            assert.notExists(error);

            // Try and add a user as a non-member
            let membersToAdd = {};
            membersToAdd[nicolaas.user.id] = 'member';
            RestAPI.Group.setGroupMembers(branden.restContext, groupObject.id, membersToAdd, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 401);

              // Verify that the user has not been added
              RestAPI.Group.getMembershipsLibrary(
                nicolaas.restContext,
                nicolaas.user.id,
                null,
                null,
                (error, groupMemberships) => {
                  assert.notExists(error);
                  assert.strictEqual(groupMemberships.results.length, 0);

                  // Add branden as a member, and make sure that he still cannot add a member
                  membersToAdd = {};
                  membersToAdd[branden.user.id] = 'member';
                  RestAPI.Group.setGroupMembers(johnRestContext, groupObject.id, membersToAdd, (error_) => {
                    assert.notExists(error_);

                    // Try to add nicolaas as a member
                    membersToAdd = {};
                    membersToAdd[nicolaas.user.id] = 'member';
                    RestAPI.Group.setGroupMembers(branden.restContext, groupObject.id, membersToAdd, (error_) => {
                      assert.ok(error_);
                      assert.strictEqual(error_.code, 401);

                      // Verify that the user has not been added
                      RestAPI.Group.getMembershipsLibrary(
                        nicolaas.restContext,
                        nicolaas.user.id,
                        null,
                        null,
                        (error, groupMemberships) => {
                          assert.notExists(error);
                          assert.strictEqual(groupMemberships.results.length, 0);

                          // Add branden a manager, and make sure that he can add a member
                          membersToAdd = {};
                          membersToAdd[branden.user.id] = 'manager';
                          RestAPI.Group.setGroupMembers(johnRestContext, groupObject.id, membersToAdd, (error_) => {
                            assert.notExists(error_);

                            // Try to add nicolaas as a member
                            membersToAdd = {};
                            membersToAdd[nicolaas.user.id] = 'member';
                            RestAPI.Group.setGroupMembers(
                              branden.restContext,
                              groupObject.id,
                              membersToAdd,
                              (error_) => {
                                assert.notExists(error_);

                                // Verify that the user has not been added
                                RestAPI.Group.getMembershipsLibrary(
                                  nicolaas.restContext,
                                  nicolaas.user.id,
                                  null,
                                  null,
                                  (error, groupMemberships) => {
                                    assert.notExists(error);
                                    assert.strictEqual(groupMemberships.results.length, 1);
                                    assert.strictEqual(groupMemberships.results[0].id, groupObject.id);

                                    // Verify that members can be removed
                                    membersToAdd = {};
                                    membersToAdd[nicolaas.user.id] = false;
                                    RestAPI.Group.setGroupMembers(
                                      branden.restContext,
                                      groupObject.id,
                                      membersToAdd,
                                      (error_) => {
                                        assert.notExists(error_);

                                        // Verify that the user has been removed as a member
                                        RestAPI.Group.getMembershipsLibrary(
                                          nicolaas.restContext,
                                          nicolaas.user.id,
                                          null,
                                          null,
                                          (error, groupMemberships) => {
                                            assert.notExists(error);
                                            assert.strictEqual(groupMemberships.results.length, 0);

                                            // Ensure the lastModified date of the group has been updated as a result of these memberships changes
                                            RestAPI.Group.getGroup(
                                              johnRestContext,
                                              groupObject.id,
                                              (error, updatedGroup) => {
                                                assert.notExists(error);
                                                assert.ok(groupObject.lastModified < updatedGroup.lastModified);
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
                }
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies that adding/removing multiple members at the same time is possible
     */
    it('verify combination of roles is possible', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (error, users) => {
        assert.notExists(error);
        const { 0: jack, 1: jane, 2: joe } = users;

        // Create the test group
        RestAPI.Group.createGroup(
          johnRestContext,
          'Group title',
          'Group description',
          PUBLIC,
          'yes',
          [],
          [],
          (error, newGroup) => {
            assert.notExists(error);

            // Add 3 members at the same time, using a combination of roles
            let membersToAdd = {};
            membersToAdd[jack.user.id] = 'member';
            membersToAdd[jane.user.id] = 'manager';
            membersToAdd[joe.user.id] = 'member';
            RestAPI.Group.setGroupMembers(johnRestContext, newGroup.id, membersToAdd, (error_) => {
              assert.notExists(error_);

              // Verify that each member has the correct role
              RestAPI.Group.getGroupMembers(johnRestContext, newGroup.id, null, null, (error, members) => {
                assert.notExists(error);
                assert.strictEqual(members.results.length, 4);
                // Morph results to hash for easy access.
                const hash = _.groupBy(members.results, (member) => member.profile.id);
                assert.strictEqual(hash[johnRestContext.user.id][0].role, 'manager');
                assert.strictEqual(hash[jack.user.id][0].role, 'member');
                assert.strictEqual(hash[jane.user.id][0].role, 'manager');
                assert.strictEqual(hash[joe.user.id][0].role, 'member');

                // Make sure that the group shows up in Joe's membership list
                RestAPI.Group.getMembershipsLibrary(joe.restContext, joe.user.id, null, null, (error, memberships) => {
                  assert.notExists(error);
                  assert.strictEqual(memberships.results.length, 1);
                  assert.strictEqual(memberships.results[0].id, newGroup.id);

                  // Delete Joe and make Jane a member
                  membersToAdd = {};
                  membersToAdd[jane.user.id] = 'member';
                  membersToAdd[joe.user.id] = false;
                  RestAPI.Group.setGroupMembers(johnRestContext, newGroup.id, membersToAdd, (error_) => {
                    assert.notExists(error_);

                    // Make sure that the membership changes have happened
                    RestAPI.Group.getGroupMembers(johnRestContext, newGroup.id, null, null, (error, members) => {
                      assert.notExists(error);
                      assert.strictEqual(members.results.length, 3);
                      // Morph results to hash for easy access.
                      const hash = _.groupBy(members.results, (member) => member.profile.id);
                      assert.strictEqual(hash[johnRestContext.user.id][0].role, 'manager');
                      assert.strictEqual(hash[jack.user.id][0].role, 'member');
                      assert.strictEqual(hash[jane.user.id][0].role, 'member');
                      assert.strictEqual(hash[joe.user.id], undefined);

                      // Make sure that the group does not show up in Joe's membership list
                      RestAPI.Group.getMembershipsLibrary(
                        joe.restContext,
                        joe.user.id,
                        null,
                        null,
                        (error, memberships) => {
                          assert.notExists(error);
                          assert.strictEqual(memberships.results.length, 0);
                          return callback();
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

    /**
     * Test that verifies that it should not be possible to add members as an unprivileged user
     */
    it('verify add members no access', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);
        const { 0: simon, 1: nicolaas } = users;

        // Create a test group
        RestAPI.Group.createGroup(
          johnRestContext,
          'Test Group',
          'Group',
          PUBLIC,
          'yes',
          [],
          [],
          (error, groupObject) => {
            assert.notExists(error);

            // Try and add nicolaas to the group as an unprivileged user
            let membersToAdd = {};
            membersToAdd[nicolaas.user.id] = 'member';
            RestAPI.Group.setGroupMembers(simon.restContext, groupObject.id, membersToAdd, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 401);
              // Verify that nicolaas has not been added to the group
              RestAPI.Group.getMembershipsLibrary(
                nicolaas.restContext,
                nicolaas.user.id,
                null,
                null,
                (error, memberships) => {
                  assert.notExists(error);
                  assert.strictEqual(memberships.results.length, 0);

                  // Add simon as a member of the group
                  membersToAdd = {};
                  membersToAdd[simon.user.id] = 'member';
                  RestAPI.Group.setGroupMembers(johnRestContext, groupObject.id, membersToAdd, (error_) => {
                    assert.notExists(error_);

                    // Make sure that simon still can't add any members
                    membersToAdd = {};
                    membersToAdd[nicolaas.user.id] = 'member';
                    RestAPI.Group.setGroupMembers(simon.restContext, groupObject.id, membersToAdd, (error_) => {
                      assert.ok(error_);
                      // Verify that nicolaas has not been added to the group
                      RestAPI.Group.getMembershipsLibrary(
                        nicolaas.restContext,
                        nicolaas.user.id,
                        null,
                        null,
                        (error, memberships) => {
                          assert.notExists(error);
                          assert.strictEqual(memberships.results.length, 0);

                          // Add simon as a manager of the group
                          membersToAdd = {};
                          membersToAdd[simon.user.id] = 'manager';
                          RestAPI.Group.setGroupMembers(johnRestContext, groupObject.id, membersToAdd, (error_) => {
                            assert.notExists(error_);

                            // Verify that simon can now add members to the group
                            membersToAdd = {};
                            membersToAdd[nicolaas.user.id] = 'member';
                            RestAPI.Group.setGroupMembers(simon.restContext, groupObject.id, membersToAdd, (error_) => {
                              assert.notExists(error_);
                              // Verify that nicolaas has been added to the group
                              RestAPI.Group.getMembershipsLibrary(
                                nicolaas.restContext,
                                nicolaas.user.id,
                                null,
                                null,
                                (error, memberships) => {
                                  assert.notExists(error);
                                  assert.strictEqual(memberships.results.length, 1);
                                  assert.strictEqual(memberships.results[0].id, groupObject.id);
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
          }
        );
      });
    });

    /**
     * Test to verify that it should be possible for an indirect manager to add members
     */
    it('verify add members indirect access', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);
        const { 0: simon, 1: nicolaas } = users;

        // Create the base group
        RestAPI.Group.createGroup(
          johnRestContext,
          'Test Group',
          'Group',
          PUBLIC,
          'yes',
          [],
          [],
          (error, managedByCambridge) => {
            assert.notExists(error);

            // Create the "Cambridge" group that will manage the Managed-by-cambridge group
            RestAPI.Group.createGroup(
              johnRestContext,
              'Test Group',
              'Group',
              PUBLIC,
              'yes',
              [],
              [],
              (error, cambridge) => {
                assert.notExists(error);

                // Make the "Cambridge" group a manager of the Managed-by-cambridge group
                let membersToAdd = {};
                membersToAdd[cambridge.id] = 'manager';
                RestAPI.Group.setGroupMembers(johnRestContext, managedByCambridge.id, membersToAdd, (error_) => {
                  assert.notExists(error_);

                  // Make "simon" a member of the "Cambridge" group, then verify he can manage "Managed-by-cambridge"
                  membersToAdd = {};
                  membersToAdd[simon.user.id] = 'member';
                  RestAPI.Group.setGroupMembers(johnRestContext, cambridge.id, membersToAdd, (error_) => {
                    assert.notExists(error_);

                    // Check if "simon" can manage the "Managed-by-cambridge" group through the internal Authz API
                    AuthzAPI.hasRole(simon.user.id, managedByCambridge.id, 'manager', (error, isAllowed) => {
                      assert.notExists(error);
                      assert.strictEqual(isAllowed, true);

                      // Verify that "simon" can add someone to the "Managed-by-cambridge" group
                      membersToAdd = {};
                      membersToAdd[nicolaas.user.id] = 'member';
                      RestAPI.Group.setGroupMembers(
                        simon.restContext,
                        managedByCambridge.id,
                        membersToAdd,
                        (error_) => {
                          assert.notExists(error_);

                          // Verify that the "nicolaas" has been added to the group
                          RestAPI.Group.getMembershipsLibrary(
                            nicolaas.restContext,
                            nicolaas.user.id,
                            null,
                            null,
                            (error, memberships) => {
                              assert.notExists(error);
                              assert.strictEqual(memberships.results.length, 1);
                              assert.strictEqual(memberships.results[0].id, managedByCambridge.id);
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
          }
        );
      });
    });

    /**
     * Verify that non-existing users and/or groups cannot be added as members to a group
     */
    it('verify that non-existing principals cannot be added to a group', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: branden } = users;

        // Create the group
        RestAPI.Group.createGroup(
          johnRestContext,
          'Public Group',
          'This is a test group',
          PUBLIC,
          'yes',
          [],
          [],
          (error, groupObject) => {
            assert.notExists(error);

            // Try to add an existing and non-existing user
            const membersToAdd = {};
            membersToAdd[branden.user.id] = 'member';
            membersToAdd['u:camtest:non-existing'] = 'member';
            RestAPI.Group.setGroupMembers(johnRestContext, groupObject.id, membersToAdd, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 400);

              // Make sure that the request hasn't gone through
              RestAPI.Group.getGroupMembers(johnRestContext, groupObject.id, null, null, (error, members) => {
                assert.notExists(error);
                assert.strictEqual(members.results.length, 1);
                assert.strictEqual(members.results[0].profile.id, johnRestContext.user.id);
                return callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that it is not possible for a group to be added of a member of itself
     */
    it('verify that a group cannot be made a member of itself', (callback) => {
      RestAPI.Group.createGroup(
        johnRestContext,
        'Public group',
        'This is a test group',
        PUBLIC,
        'yes',
        [],
        {},
        (error, groupObject) => {
          assert.notExists(error);

          // Try to add the group as a member to itself
          const membersToAdd = {};
          membersToAdd[groupObject.id] = 'member';
          RestAPI.Group.setGroupMembers(johnRestContext, groupObject.id, membersToAdd, (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 400);
            return callback();
          });
        }
      );
    });

    /**
     * Test that verifies that it's not possible to remove all the managers of a group.
     */
    it('verify that a group always has at least 1 manager', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 4, (error, users) => {
        assert.notExists(error);
        const { 0: simon, 1: branden, 2: nico, 3: bert } = users;

        // Make Simon & Branden a manager and Bert & Nico members.
        RestAPI.Group.createGroup(
          branden.restContext,
          'Public group',
          'This is a test group',
          PUBLIC,
          'yes',
          [simon.user.id],
          [nico.user.id, bert.user.id],
          (error, groupObject) => {
            assert.notExists(error);

            // Try to make everyone a member.
            const members = {};
            members[simon.user.id] = 'member';
            members[branden.user.id] = 'member';
            members[nico.user.id] = 'member';
            members[bert.user.id] = 'member';
            RestAPI.Group.setGroupMembers(simon.restContext, groupObject.id, members, (error_) => {
              assert.strictEqual(error_.code, 400);

              // Try to remove everyone.
              const members = {};
              members[simon.user.id] = false;
              members[branden.user.id] = false;
              members[nico.user.id] = false;
              members[bert.user.id] = false;
              RestAPI.Group.setGroupMembers(simon.restContext, groupObject.id, members, (error_) => {
                assert.strictEqual(error_.code, 400);

                // Try to remove just the managers.
                const members = {};
                members[simon.user.id] = false;
                members[branden.user.id] = false;
                RestAPI.Group.setGroupMembers(simon.restContext, groupObject.id, members, (error_) => {
                  assert.ok(error_.code, 400);
                  return callback();
                });
              });
            });
          }
        );
      });
    });

    it('verify that a group that is part of a public tenant can add a user member from an external public tenant', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);
        const { 0: userA1, 1: userA2 } = users;

        TestsUtil.generateTestUsers(gtAdminRestContext, 1, (error, users) => {
          assert.notExists(error);

          const { 0: userB } = users;

          // Create a "loggedin" group in tenant A, with userA1 as a member
          const groupNameA = TestsUtil.generateTestUserId();
          RestAPI.Group.createGroup(
            userA1.restContext,
            groupNameA,
            groupNameA,
            'loggedin',
            'no',
            [],
            [],
            (error, groupA) => {
              assert.notExists(error);

              // Ensure user A2 can see userA in the members list
              RestAPI.Group.getGroupMembers(userA2.restContext, groupA.id, null, 10, (error, members) => {
                assert.notExists(error);
                assert.ok(members);
                assert.lengthOf(members.results, 1);
                assert.strictEqual(members.results[0].profile.id, userA1.user.id);

                // Verify userB cannot see userA1 as a member of groupA
                RestAPI.Group.getGroupMembers(userB.restContext, groupA.id, null, 10, (error /* , members */) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 401);
                  return callback();
                });
              });
            }
          );
        });
      });
    });

    it('verify that a group that is part of a public tenant cannot add a user from an external private tenant', (callback) => {
      // Create users in tenant A
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);

        const { 0: userA1, 1: userA2 } = users;

        // Create a "public" group in tenant A, with userA1 as a member
        const groupNameA = TestsUtil.generateTestUserId();
        RestAPI.Group.createGroup(userA1.restContext, groupNameA, groupNameA, PUBLIC, 'no', [], [], (error, groupA) => {
          assert.notExists(error);

          // Ensure user A2 can see userA in the members list
          RestAPI.Group.getGroupMembers(userA2.restContext, groupA.id, null, 10, (error, members) => {
            assert.notExists(error);
            assert.ok(members);
            assert.strictEqual(members.results.length, 1);
            assert.strictEqual(members.results[0].profile.id, userA1.user.id);

            // Create tenant B
            const tenantAliasB = TenantsTestUtil.generateTestTenantAlias();
            const tenantHost = TenantsTestUtil.generateTestTenantHost();
            TestsUtil.createTenantWithAdmin(tenantAliasB, tenantHost, (error, tenantB, adminRestCtxB) => {
              assert.notExists(error);

              // Create user in tenant B
              TestsUtil.generateTestUsers(adminRestCtxB, 1, (error, users) => {
                assert.notExists(error);
                const { 0: userB } = users;

                // Make tenant B private
                ConfigTestUtil.updateConfigAndWait(
                  globalAdminRestContext,
                  tenantAliasB,
                  { 'oae-tenants/tenantprivacy/tenantprivate': true },
                  (error_) => {
                    assert.notExists(error_);

                    // Verify we can't add userB as a member of groupA.
                    const newMemberB = {};
                    newMemberB[userB.user.id] = 'member';
                    RestAPI.Group.setGroupMembers(userA1.restContext, groupA.id, newMemberB, (error_) => {
                      assert.ok(error_);
                      assert.strictEqual(error_.code, 401);

                      // Verify userB is not added to the group
                      RestAPI.Group.getGroupMembers(userB.restContext, groupA.id, null, 10, (error, members) => {
                        assert.notExists(error);
                        assert.strictEqual(members.results.length, 1);
                        assert.strictEqual(members.results[0].profile.id, userA1.user.id);
                        return callback();
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

    it('verify that a group that is part of a private tenant cannot add a user from an external public tenant', (callback) => {
      // Create users in tenant A
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);

        const { 0: userA1 } = users;

        // Create tenant B
        const tenantAliasB = TenantsTestUtil.generateTestTenantAlias();
        const tenantHost = TenantsTestUtil.generateTestTenantHost();
        TestsUtil.createTenantWithAdmin(tenantAliasB, tenantHost, (error, tenantB, adminRestCtxB) => {
          assert.notExists(error);

          // Create user in tenant B
          TestsUtil.generateTestUsers(adminRestCtxB, 1, (error, users) => {
            assert.notExists(error);

            const { 0: userB } = users;

            // Make tenant B private
            ConfigTestUtil.updateConfigAndWait(
              globalAdminRestContext,
              tenantAliasB,
              { 'oae-tenants/tenantprivacy/tenantprivate': true },
              (error_) => {
                assert.notExists(error_);

                // Create a "public" group in tenant B
                const groupNameB = TestsUtil.generateTestUserId();
                RestAPI.Group.createGroup(
                  userB.restContext,
                  groupNameB,
                  groupNameB,
                  PUBLIC,
                  'no',
                  [],
                  [],
                  (error, groupB) => {
                    assert.notExists(error);

                    // Make tenant B private
                    ConfigTestUtil.updateConfigAndWait(
                      globalAdminRestContext,
                      tenantAliasB,
                      { 'oae-tenants/tenantprivacy/tenantprivate': true },
                      (error_) => {
                        assert.notExists(error_);

                        // Verify we can't add userA as a member of groupA.
                        const newMemberA = {};
                        newMemberA[userA1.user.id] = 'member';
                        RestAPI.Group.setGroupMembers(userB.restContext, groupB.id, newMemberA, (error_) => {
                          assert.ok(error_);
                          assert.strictEqual(error_.code, 401);

                          // Verify userB cannot see userA as a member of groupA
                          RestAPI.Group.getGroupMembers(userB.restContext, groupB.id, null, 10, (error, members) => {
                            assert.notExists(error);
                            assert.strictEqual(members.results.length, 1);
                            assert.strictEqual(members.results[0].profile.id, userB.user.id);
                            return callback();
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

    /**
     * Test that verifies validation of leaving a group
     */
    it('verify validation and success of leaving a group', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);

        const { 0: jack, 1: branden } = users;

        // Create a group that is joinable
        RestAPI.Group.createGroup(jack.restContext, 'Test Group', 'Group', PUBLIC, 'yes', [], [], (error, group) => {
          assert.notExists(error);

          // Verify cannot leave group of which I am not a member
          PrincipalsTestUtil.assertLeaveGroupFails(branden.restContext, group.id, 400, () => {
            // Now join the group and ensure it was successful
            PrincipalsTestUtil.assertJoinGroupSucceeds(jack.restContext, branden.restContext, group.id, () => {
              // Get the group state immediately after join so we can ensure the stability of its lastModified time
              RestAPI.Group.getGroup(jack.restContext, group.id, (error, groupAfterJoin) => {
                assert.notExists(error);
                // Verify not a valid id
                PrincipalsTestUtil.assertLeaveGroupFails(branden.restContext, 'not-a-valid-id', 400, () => {
                  // Verify a non-group id
                  PrincipalsTestUtil.assertLeaveGroupFails(branden.restContext, branden.user.id, 400, () => {
                    // Verify anonymous user cannot leave
                    PrincipalsTestUtil.assertLeaveGroupFails(anonymousRestContext, group.id, 401, () => {
                      // Verify branden is still a member
                      RestAPI.Group.getGroupMembers(branden.restContext, group.id, null, 10_000, (error, members) => {
                        assert.notExists(error);
                        assert.strictEqual(members.results.length, 2);

                        // Verify successful leave
                        PrincipalsTestUtil.assertLeaveGroupSucceeds(
                          jack.restContext,
                          branden.restContext,
                          group.id,
                          () => {
                            RestAPI.Group.getGroup(jack.restContext, group.id, (error, groupAfterLeave) => {
                              assert.notExists(error);

                              // Make sure the lastModified has not changed as a result of a leave
                              assert.strictEqual(groupAfterJoin.lastModified, groupAfterLeave.lastModified);

                              // Verify that the last manager can't leave
                              return PrincipalsTestUtil.assertLeaveGroupFails(
                                jack.restContext,
                                group.id,
                                400,
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
        });
      });
    });

    /**
     * Test that verifies validation of joining a group
     */
    it('verify validation and success of joining a group', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);

        const { 0: jack, 1: branden } = users;

        // Create a group that is not joinable
        RestAPI.Group.createGroup(
          jack.restContext,
          'Test Group',
          'Group',
          PUBLIC,
          'request',
          [],
          [],
          (error, group) => {
            assert.notExists(error);

            // Validate invalid group id
            RestAPI.Group.joinGroup(branden.restContext, 'not-a-valid-id', (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 400);

              // Validate invalid group id
              PrincipalsTestUtil.assertJoinGroupFails(branden.restContext, 'not-a-valid-id', 400, () => {
                // Validate non-group group id
                PrincipalsTestUtil.assertJoinGroupFails(branden.restContext, branden.user.id, 400, () => {
                  // Validate non-joinable group
                  PrincipalsTestUtil.assertJoinGroupFails(branden.restContext, group.id, 401, () => {
                    // Make group joinable
                    RestAPI.Group.updateGroup(jack.restContext, group.id, { joinable: 'yes' }, (error_) => {
                      assert.notExists(error_);

                      // Join as anonymous and verify it still fails
                      PrincipalsTestUtil.assertJoinGroupFails(anonymousRestContext, group.id, 401, () => {
                        // Verify we still aren't a member
                        PrincipalsTestUtil.assertGetAllMembersLibrarySucceeds(
                          jack.restContext,
                          group.id,
                          null,
                          (members) => {
                            assert.strictEqual(members.length, 1);

                            // Join as branden, should finally work
                            PrincipalsTestUtil.assertJoinGroupSucceeds(
                              jack.restContext,
                              branden.restContext,
                              group.id,
                              () => {
                                // Verify jack cannot join, he is already manager
                                PrincipalsTestUtil.assertJoinGroupFails(jack.restContext, group.id, 400, () => {
                                  // Verify he was not demoted to member
                                  PrincipalsTestUtil.assertGetAllMembersLibrarySucceeds(
                                    jack.restContext,
                                    group.id,
                                    null,
                                    (members) => {
                                      assert.strictEqual(members.length, 2);

                                      let hadJack = false;
                                      forEach((result) => {
                                        if (result.profile.id === jack.user.id) {
                                          hadJack = true;
                                          assert.strictEqual(result.role, 'manager');
                                        }
                                      }, members);

                                      assert.ok(hadJack);
                                      return callback();
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
          }
        );
      });
    });
  });

  describe('Memberships Library', () => {
    /**
     * Test that verifies that the getMembershipsLibrary function returns all of the groups a user is a member of
     */
    it('verify getMembershipsLibrary', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);

        const { 0: nicolaas, 1: branden } = users;

        // Create 3 groups
        TestsUtil.generateTestGroups(nicolaas.restContext, 3, (...args) => {
          /*
          const groupIds = _.chain(args)
            .pluck('group')
            .pluck('id')
            .value();
            */

          const groupIds = reject(isNil, map(path(['group', 'id']), last(args)));

          // Check that all those groups are part of the memberships
          RestAPI.Group.getMembershipsLibrary(
            nicolaas.restContext,
            nicolaas.user.id,
            null,
            null,
            (error, memberships) => {
              assert.notExists(error);
              assert.strictEqual(memberships.results.length, 3);
              assert.ok(groupIds.includes(memberships.results[0].id));
              assert.ok(groupIds.includes(memberships.results[1].id));
              assert.ok(groupIds.includes(memberships.results[2].id));

              // Verify that the groups are not part of branden's membership list
              RestAPI.Group.getMembershipsLibrary(
                branden.restContext,
                branden.user.id,
                null,
                null,
                (error, memberships) => {
                  assert.notExists(error);
                  assert.strictEqual(memberships.results.length, 0);
                  return callback();
                }
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies that memberships can be paged
     */
    it('verify paging', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: nicolaas } = users;

        // Add Nicolaas to 5 groups
        TestsUtil.generateTestGroups(nicolaas.restContext, 5, (...args) => {
          const groupIds = reject(isNil, map(path(['group', 'id']), last(args)));

          // Generate 5 folders. This is to ensure that the membership library
          // only returns group objects
          FoldersTestUtil.generateTestFolders(nicolaas.restContext, 5, () => {
            // Get the first 2
            RestAPI.Group.getMembershipsLibrary(
              nicolaas.restContext,
              nicolaas.user.id,
              null,
              2,
              (error, memberships) => {
                assert.notExists(error);
                assert.strictEqual(memberships.results.length, 2);

                // Assert we only retrieved groups
                assert.include(groupIds, memberships.results[0].id);
                assert.include(groupIds, memberships.results[1].id);

                // Remember these group IDs
                let seenGroupIds = _.pluck(memberships.results, 'id');

                // Get the next 2
                RestAPI.Group.getMembershipsLibrary(
                  nicolaas.restContext,
                  nicolaas.user.id,
                  memberships.nextToken,
                  2,
                  (error, memberships) => {
                    assert.notExists(error);
                    assert.strictEqual(memberships.results.length, 2);

                    // Assert we only retrieved groups
                    assert.include(groupIds, memberships.results[0].id);
                    assert.include(groupIds, memberships.results[1].id);

                    // Assert that we've not seen these groups before
                    assert.notInclude(seenGroupIds, memberships.results[0].id);
                    assert.notInclude(seenGroupIds, memberships.results[1].id);

                    // Add the retrieved groups to the set of seen groups
                    seenGroupIds = [...seenGroupIds, ..._.pluck(memberships.results, 'id')];

                    // Get the final group
                    RestAPI.Group.getMembershipsLibrary(
                      nicolaas.restContext,
                      nicolaas.user.id,
                      memberships.nextToken,
                      2,
                      (error, memberships) => {
                        assert.notExists(error);
                        assert.strictEqual(memberships.results.length, 1);

                        // Assert we only retrieved groups
                        assert.ok(_.contains(groupIds, memberships.results[0].id));

                        // Assert that we've not seen this group before
                        assert.ok(!_.contains(seenGroupIds, memberships.results[0].id));
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
    });

    /**
     * Test that verifies that getting the list of members of invalid principalIds doesn't work
     */
    it('verify invalid principal in getMembershipsLibrary', (callback) => {
      RestAPI.Group.getMembershipsLibrary(camAdminRestContext, 'aninvalidid', null, null, (error, memberships) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        assert.ok(!memberships);

        // Test empty user against the API as we cannot represent this throught he REST API
        const adminCtx = TestsUtil.createGlobalAdminContext();
        PrincipalsAPI.getMembershipsLibrary(adminCtx, null, null, null, (error, memberships) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.ok(!memberships);
          return callback();
        });
      });
    });

    /**
     * Give a set of `principals` a `role` on a group
     *
     * @param  {String}     groupId         The id of the group to give the principals a role on
     * @param  {String[]}   principals      The principals to add to the group
     * @param  {String}     role            The role to give the principals
     * @param  {Function}   callback        Standard callback function
     */
    const setGroupMembers = function (groupId, principals, role, callback) {
      const updates = {};
      _.each(principals, (principalId) => {
        updates[principalId] = role;
      });
      RestAPI.Group.setGroupMembers(camAdminRestContext, groupId, updates, (error) => {
        assert.notExists(error);
        return callback();
      });
    };

    /**
     * Test that verifies the ordering of membership libraries
     */
    it('verify order', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (error, users) => {
        assert.notExists(error);

        const { 0: simon, 1: nico, 2: stuart } = users;

        /*
         * Create a group tree which looks like:
         *                  top
         *                 /    \
         *   simonParentParent   nicoParentParent
         *               /        \
         *       simonParent      nicoParent
         *             /            \
         *          simon           nico
         */
        TestsUtil.generateTestGroups(camAdminRestContext, 5, (error, groups) => {
          assert.notExists(error);
          const { 0: topGroup, 1: simonParentParent, 2: simonParent, 3: nicoParentParent, 4: nicoParent } = groups;
          setGroupMembers(topGroup.group.id, [simonParentParent.group.id, nicoParentParent.group.id], 'member', () => {
            setGroupMembers(simonParentParent.group.id, [simonParent.group.id], 'member', () => {
              setGroupMembers(nicoParentParent.group.id, [nicoParent.group.id], 'member', () => {
                setGroupMembers(simonParent.group.id, [simon.user.id], 'member', () => {
                  setGroupMembers(nicoParent.group.id, [nico.user.id], 'member', () => {
                    // Simon should see 3 memberships in his library
                    RestAPI.Group.getMembershipsLibrary(
                      simon.restContext,
                      simon.user.id,
                      null,
                      null,
                      (error, memberships) => {
                        assert.notExists(error);
                        assert.strictEqual(memberships.results.length, 3);
                        RestAPI.Group.getMembershipsLibrary(
                          nico.restContext,
                          nico.user.id,
                          null,
                          null,
                          (error, memberships) => {
                            assert.notExists(error);
                            assert.strictEqual(memberships.results.length, 3);

                            // When we add a third user to the top group it should be bumped to the top of the membership libraries
                            setGroupMembers(topGroup.group.id, [stuart.user.id], 'member', () => {
                              RestAPI.Group.getMembershipsLibrary(
                                simon.restContext,
                                simon.user.id,
                                null,
                                null,
                                (error, memberships) => {
                                  assert.notExists(error);
                                  assert.strictEqual(memberships.results.length, 3);
                                  assert.strictEqual(memberships.results[0].id, topGroup.group.id);
                                  RestAPI.Group.getMembershipsLibrary(
                                    nico.restContext,
                                    nico.user.id,
                                    null,
                                    null,
                                    (error, memberships) => {
                                      assert.notExists(error);
                                      assert.strictEqual(memberships.results.length, 3);
                                      assert.strictEqual(memberships.results[0].id, topGroup.group.id);

                                      // When we make the `nicoParent` group a manager of `nicoParentParent` the
                                      // `nicoParentParent` group should move to the top of nico's membership library
                                      setGroupMembers(
                                        nicoParentParent.group.id,
                                        [nicoParent.group.id],
                                        'manager',
                                        () => {
                                          RestAPI.Group.getMembershipsLibrary(
                                            nico.restContext,
                                            nico.user.id,
                                            null,
                                            null,
                                            (error, memberships) => {
                                              assert.notExists(error);
                                              assert.strictEqual(memberships.results.length, 3);
                                              assert.strictEqual(memberships.results[0].id, nicoParentParent.group.id);
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
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  describe('Simple group structure', () => {
    /**
     * Utility function that will create a number of groups and users that will be used inside of the test.
     * @param  {Function(principals)}    callback        Standard callback function executed when all users and groups have been created
     * @param  {Object}                  principals      Object where the keys are identifiers for the created principals and the values are
     *                                                   are the actual group/user rest context object
     */
    const createPrincipals = function (callback) {
      const createdPrincipals = {};

      const createPrincipal = function (type, identifier, metadata) {
        if (type === 'group') {
          RestAPI.Group.createGroup(
            johnRestContext,
            metadata,
            metadata,
            PUBLIC,
            'yes',
            [],
            [],
            (error, groupObject) => {
              assert.notExists(error);
              createdPrincipals[identifier] = groupObject;
              if (_.keys(createdPrincipals).length === 12) {
                return callback(createdPrincipals);
              }
            }
          );
        } else {
          TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
            assert.notExists(error);
            const { 0: user } = users;
            user.restContext.id = user.user.id;
            createdPrincipals[identifier] = user.restContext;
            if (_.keys(createdPrincipals).length === 12) {
              return callback(createdPrincipals);
            }
          });
        }
      };

      /// /////////////////
      // Group creation //
      /// /////////////////

      createPrincipal('group', 'oae-team', 'OAE Team');
      createPrincipal('group', 'backend-team', 'Backend Team');
      createPrincipal('group', 'ui-team', 'UI Team');
      createPrincipal('group', 'canadian', 'Canadian Team');
      createPrincipal('group', 'not-canadian', 'Not Canadian Team');
      createPrincipal('group', 'belgian', 'Belgian Team');
      createPrincipal('group', 'west-flemish', 'West Flemish Team');
      createPrincipal('group', 'east-flemish', 'East Flemish Team');

      /// ////////////////
      // User creation //
      /// ////////////////

      createPrincipal('user', 'bert', 'Bert Pareyn');
      createPrincipal('user', 'branden', 'Branden Visser');
      createPrincipal('user', 'nicolaas', 'Nicolaas Matthijs');
      createPrincipal('user', 'simon', 'Simon Gaeremynck');
    };

    /**
     * Utility function that will be used to create a 4-level deep group structure that will be used
     * inside of the tests. The creation of this structure will not be done in a top-down or bottom-up
     * approach, but will use a random strategy. The membership structure will be the following:
     *
     *                          OAE Team
     *                        /          \
     *           Back-End Team            UI Team
     *           /           \               \
     *       Canadian   Not-Canadian       Belgian
     *          |            |            /       \
     *       Branden       Simon    West Flemish  East Flemish
     *                                   |            |
     *                                 Bert        Nicolaas
     *
     * @param  {Function(principals)}   callback                Standard callback function executed when all checks have finished
     * @param  {Object}                 callback.principals     Object where the keys are identifiers for the created principals and the values are
     *                                                          are the actual group/user rest context object
     */
    const createOAEStructure = function (callback) {
      createPrincipals((createdPrincipals) => {
        // Assert that none of the users are a member of a group. This also has
        // the benefit that their membership libraries will no longer be considered
        // stale. When creating the OAE group structure, the membership libraries
        // will be updated. However, no library should be considered stale
        assertGetMembershipsLibrary(createdPrincipals, 'nicolaas', [], () => {
          assertGetMembershipsLibrary(createdPrincipals, 'bert', [], () => {
            assertGetMembershipsLibrary(createdPrincipals, 'simon', [], () => {
              assertGetMembershipsLibrary(createdPrincipals, 'branden', [], () => {
                // Make Branden a member of the canadian group
                let membersToAdd = {};
                membersToAdd[createdPrincipals.branden.id] = 'member';
                RestAPI.Group.setGroupMembers(johnRestContext, createdPrincipals.canadian.id, membersToAdd, (error) => {
                  assert(!error);

                  // Make Simon a member of the not-canadian group
                  membersToAdd = {};
                  membersToAdd[createdPrincipals.simon.id] = 'member';
                  RestAPI.Group.setGroupMembers(
                    johnRestContext,
                    createdPrincipals['not-canadian'].id,
                    membersToAdd,
                    (error) => {
                      assert(!error);

                      // Make West Flemish and East Flemish members of the Belgian Group
                      membersToAdd = {};
                      membersToAdd[createdPrincipals['west-flemish'].id] = 'member';
                      membersToAdd[createdPrincipals['east-flemish'].id] = 'member';
                      RestAPI.Group.setGroupMembers(
                        johnRestContext,
                        createdPrincipals.belgian.id,
                        membersToAdd,
                        (error) => {
                          assert(!error);

                          // Make Bert a member of the west flemish group
                          membersToAdd = {};
                          membersToAdd[createdPrincipals.bert.id] = 'member';
                          RestAPI.Group.setGroupMembers(
                            johnRestContext,
                            createdPrincipals['west-flemish'].id,
                            membersToAdd,
                            (error) => {
                              assert(!error);

                              // Make Nicolaas a member of the east flemish group
                              membersToAdd = {};
                              membersToAdd[createdPrincipals.nicolaas.id] = 'member';
                              RestAPI.Group.setGroupMembers(
                                johnRestContext,
                                createdPrincipals['east-flemish'].id,
                                membersToAdd,
                                (error) => {
                                  assert(!error);

                                  // Make Back end team and UI dev team a member of the OAE Team group
                                  membersToAdd = {};
                                  membersToAdd[createdPrincipals['backend-team'].id] = 'member';
                                  membersToAdd[createdPrincipals['ui-team'].id] = 'member';
                                  RestAPI.Group.setGroupMembers(
                                    johnRestContext,
                                    createdPrincipals['oae-team'].id,
                                    membersToAdd,
                                    (error) => {
                                      assert(!error);

                                      // Make the Candadian and Not canadian group a member of the Back end Team group
                                      membersToAdd = {};
                                      membersToAdd[createdPrincipals.canadian.id] = 'member';
                                      membersToAdd[createdPrincipals['not-canadian'].id] = 'member';
                                      RestAPI.Group.setGroupMembers(
                                        johnRestContext,
                                        createdPrincipals['backend-team'].id,
                                        membersToAdd,
                                        (error) => {
                                          assert(!error);

                                          // Make the Belgian Team a member of the UI team
                                          membersToAdd = {};
                                          membersToAdd[createdPrincipals.belgian.id] = 'member';
                                          RestAPI.Group.setGroupMembers(
                                            johnRestContext,
                                            createdPrincipals['ui-team'].id,
                                            membersToAdd,
                                            (error) => {
                                              assert(!error);

                                              // Assert that all the group updates didn't make any of the libraries stale
                                              LibraryTestUtil.assertNotStale(
                                                PrincipalsConstants.library.MEMBERSHIPS_INDEX_NAME,
                                                createdPrincipals.nicolaas.id,
                                                PRIVATE,
                                                () => {
                                                  LibraryTestUtil.assertNotStale(
                                                    PrincipalsConstants.library.MEMBERSHIPS_INDEX_NAME,
                                                    createdPrincipals.bert.id,
                                                    PRIVATE,
                                                    () => {
                                                      LibraryTestUtil.assertNotStale(
                                                        PrincipalsConstants.library.MEMBERSHIPS_INDEX_NAME,
                                                        createdPrincipals.simon.id,
                                                        PRIVATE,
                                                        () => {
                                                          LibraryTestUtil.assertNotStale(
                                                            PrincipalsConstants.library.MEMBERSHIPS_INDEX_NAME,
                                                            createdPrincipals.branden.id,
                                                            PRIVATE,
                                                            () => callback(createdPrincipals)
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
          });
        });
      });
    };

    /**
     * Utility function that will make sure that a particular group has the expected
     * set of group members
     *  @param  {Object}           createdPrincipals    Object where the keys are identifiers for the created principals and the values are
     *                                                  are the actual group/user rest context object
     *  @param  {String}           groupIdentifier      Group identifer for the group we want to check the members for. This should correspond
     *                                                  with a created prinicpal in createdPrincipals
     *  @param  {Array<String>}    expectedMembers      Array of user and group identifier ids representing the expected members. These identifiers
     *                                                  should correspond with a created prinicpal in createdPrincipals
     *  @param  {Function}         callback             Standard callback function
     */
    const assertGroupMembers = function (createdPrincipals, groupIdentifier, expectedMembers, callback) {
      RestAPI.Group.getGroupMembers(
        johnRestContext,
        createdPrincipals[groupIdentifier].id,
        null,
        null,
        (error, members) => {
          assert.notExists(error);
          // We also always expect John to come back as a member
          assert.strictEqual(members.results.length, expectedMembers.length + 1);
          // Morph results to hash for easy access.
          const hash = _.groupBy(members.results, (principal) => principal.profile.id);
          for (const element of expectedMembers) {
            assert.strictEqual(hash[createdPrincipals[element].id][0].profile.id, createdPrincipals[element].id);
          }

          return callback();
        }
      );
    };

    /**
     * Utility function that will make sure that a principal is a member of the expected
     * set of groups
     *  @param  {Object}           createdPrincipals    Object where the keys are identifiers for the created principals and the values are
     *                                                  are the actual group/user rest context object
     *  @param  {String}           userIdentifier       User identifer for the user we want to check the membershups for. This should correspond
     *                                                  with a created prinicpal in createdPrincipals
     *  @param  {Array<String>}    expectedGroups       Array of group identifiers representing the expected memberships. These identifiers
     *                                                  should correspond with a created prinicpal in createdPrincipals
     *  @param  {Function}         callback             Standard callback function
     */
    const assertGetMembershipsLibrary = function (createdPrincipals, userIdentifier, expectedGroups, callback) {
      RestAPI.Group.getMembershipsLibrary(
        createdPrincipals[userIdentifier],
        createdPrincipals[userIdentifier].id,
        null,
        null,
        (error, memberships) => {
          assert.notExists(error);
          assert.strictEqual(memberships.results.length, expectedGroups.length);
          // Morph results to hash for easy access
          const hash = _.groupBy(memberships.results, (membership) => membership.id);
          for (const element of expectedGroups) {
            assert.strictEqual(hash[createdPrincipals[element].id][0].id, createdPrincipals[element].id);
          }

          return callback();
        }
      );
    };

    /**
     * Test that verifies that deep-level memberships propogate appropriately
     */
    it('verify simple group structure', (callback) => {
      createOAEStructure((createdPrincipals) => {
        // Check that all of the groups return the correct group members. This should only contain direct members
        assertGroupMembers(createdPrincipals, 'oae-team', ['backend-team', 'ui-team'], () => {
          assertGroupMembers(createdPrincipals, 'backend-team', ['canadian', 'not-canadian'], () => {
            assertGroupMembers(createdPrincipals, 'canadian', ['branden'], () => {
              assertGroupMembers(createdPrincipals, 'not-canadian', ['simon'], () => {
                assertGroupMembers(createdPrincipals, 'belgian', ['east-flemish', 'west-flemish'], () => {
                  assertGroupMembers(createdPrincipals, 'east-flemish', ['nicolaas'], () => {
                    assertGroupMembers(createdPrincipals, 'west-flemish', ['bert'], () => {
                      // Check that all groups are listed in each of the user's memberships list
                      assertGetMembershipsLibrary(
                        createdPrincipals,
                        'nicolaas',
                        ['east-flemish', 'ui-team', 'belgian', 'oae-team'],
                        () => {
                          assertGetMembershipsLibrary(
                            createdPrincipals,
                            'bert',
                            ['west-flemish', 'ui-team', 'belgian', 'oae-team'],
                            () => {
                              assertGetMembershipsLibrary(
                                createdPrincipals,
                                'simon',
                                ['not-canadian', 'backend-team', 'oae-team'],
                                () => {
                                  assertGetMembershipsLibrary(
                                    createdPrincipals,
                                    'branden',
                                    ['canadian', 'backend-team', 'oae-team'],
                                    () => callback()
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
            });
          });
        });
      });
    });
  });

  describe('Group visibility', () => {
    /**
     * Test that verifies that group visibility works as expected. Group information should be retrievable
     * every time, but the members should only be accessible when the group is not private or
     * when the current user is a member
     */
    it('verify group visibility', (callback) => {
      const assertGroupVisibility = function (
        restContext,
        groupObject,
        expectedAccess,
        expectedMembers,
        expectedMemberLength,
        callback
      ) {
        // Check whether the group can be retrieved
        RestAPI.Group.getGroup(restContext, groupObject.id, (error, retrievedGroupObject) => {
          if (expectedAccess) {
            assert.notExists(error);
            assert.strictEqual(retrievedGroupObject.id, groupObject.id);
            assert.strictEqual(retrievedGroupObject.displayName, groupObject.displayName);
          } else {
            assert.ok(error);
            assert.strictEqual(error.code, 401);
          }

          // Check whether the group members can be retrieved
          RestAPI.Group.getGroupMembers(restContext, groupObject.id, null, null, (error, members) => {
            if (expectedMembers) {
              assert.notExists(error);
              assert.strictEqual(members.results.length, expectedMemberLength);
            } else {
              assert.ok(error);
              assert.strictEqual(error.code, 401);
            }

            return callback();
          });
        });
      };

      // Create 2 users to be used inside of the test
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);

        const { 0: nicolaas, 1: branden } = users;

        // Create a user on another tenant
        TestsUtil.generateTestUsers(gtAdminRestContext, 1, (error, users) => {
          assert.notExists(error);

          const { 0: gtUser } = users;

          // Create a group and add nicolaas as a member
          RestAPI.Group.createGroup(
            johnRestContext,
            'Test Group',
            'Group',
            PUBLIC,
            'no',
            [],
            [nicolaas.user.id],
            (error, groupObject) => {
              assert.notExists(error);

              // Check that everyone is able to get the group and its members, including the anonymous user
              assertGroupVisibility(johnRestContext, groupObject, true, true, 2, () => {
                assertGroupVisibility(nicolaas.restContext, groupObject, true, true, 2, () => {
                  assertGroupVisibility(branden.restContext, groupObject, true, true, 2, () => {
                    assertGroupVisibility(anonymousRestContext, groupObject, true, true, 2, () => {
                      assertGroupVisibility(gtUser.restContext, groupObject, true, true, 2, () => {
                        // Make the group visible to loggedin users only
                        RestAPI.Group.updateGroup(
                          johnRestContext,
                          groupObject.id,
                          { visibility: 'loggedin' },
                          (error_) => {
                            assert.notExists(error_);

                            // Check that everyone is able to get the group and its members, except for the anonymous user and
                            // an external user
                            assertGroupVisibility(johnRestContext, groupObject, true, true, 2, () => {
                              assertGroupVisibility(nicolaas.restContext, groupObject, true, true, 2, () => {
                                assertGroupVisibility(branden.restContext, groupObject, true, true, 2, () => {
                                  assertGroupVisibility(anonymousRestContext, groupObject, false, false, null, () => {
                                    assertGroupVisibility(gtUser.restContext, groupObject, false, false, null, () => {
                                      // Make the group private
                                      RestAPI.Group.updateGroup(
                                        johnRestContext,
                                        groupObject.id,
                                        { visibility: PRIVATE },
                                        (error_) => {
                                          assert.notExists(error_);

                                          // Check that only the members can see the group members
                                          assertGroupVisibility(johnRestContext, groupObject, true, true, 2, () => {
                                            assertGroupVisibility(
                                              nicolaas.restContext,
                                              groupObject,
                                              true,
                                              true,
                                              2,
                                              () => {
                                                assertGroupVisibility(
                                                  branden.restContext,
                                                  groupObject,
                                                  false,
                                                  false,
                                                  null,
                                                  () => {
                                                    assertGroupVisibility(
                                                      anonymousRestContext,
                                                      groupObject,
                                                      false,
                                                      false,
                                                      null,
                                                      () => {
                                                        assertGroupVisibility(
                                                          gtUser.restContext,
                                                          groupObject,
                                                          false,
                                                          false,
                                                          null,
                                                          () => {
                                                            // If we make the group joinable, then Branden should now be able to see the group's profile
                                                            // and members. The GT user can as well because they would be able to join it if they were
                                                            // so inclined
                                                            RestAPI.Group.updateGroup(
                                                              johnRestContext,
                                                              groupObject.id,
                                                              { joinable: 'yes' },
                                                              (error_) => {
                                                                assert.notExists(error_);

                                                                assertGroupVisibility(
                                                                  johnRestContext,
                                                                  groupObject,
                                                                  true,
                                                                  true,
                                                                  2,
                                                                  () => {
                                                                    assertGroupVisibility(
                                                                      nicolaas.restContext,
                                                                      groupObject,
                                                                      true,
                                                                      true,
                                                                      2,
                                                                      () => {
                                                                        assertGroupVisibility(
                                                                          branden.restContext,
                                                                          groupObject,
                                                                          true,
                                                                          true,
                                                                          2,
                                                                          () => {
                                                                            assertGroupVisibility(
                                                                              anonymousRestContext,
                                                                              groupObject,
                                                                              false,
                                                                              false,
                                                                              null,
                                                                              () => {
                                                                                assertGroupVisibility(
                                                                                  gtUser.restContext,
                                                                                  groupObject,
                                                                                  true,
                                                                                  true,
                                                                                  2,
                                                                                  () => callback()
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
              });
            }
          );
        });
      });
    });
  });
});
