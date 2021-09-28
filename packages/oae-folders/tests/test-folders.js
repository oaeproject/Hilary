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
import { format } from 'util';
import Path from 'path';
import _ from 'underscore';
import { find, head, path, forEach, values, reject, isNil, map, last } from 'ramda';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import * as AuthzAPI from 'oae-authz';
import * as AuthzTestUtil from 'oae-authz/lib/test/util.js';
import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import * as ContentTestUtil from 'oae-content/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as FoldersContentLibrary from 'oae-folders/lib/internal/contentLibrary.js';
import * as FoldersFolderLibrary from 'oae-folders/lib/internal/foldersLibrary.js';
import * as FoldersLibrary from 'oae-folders/lib/library.js';
import * as FoldersTestUtil from 'oae-folders/lib/test/util.js';

const PUBLIC = 'public';
const PRIVATE = 'private';

const NO_MANAGERS = [];
const NO_VIEWERS = [];
const NO_FOLDERS = [];

describe('Folders', () => {
  let asGlobalAdmin = null;
  let asCambridgeTenantAdmin = null;
  let asCambridgeAnonymousUser = null;
  let asGeorgiaTenantAdmin = null;

  /*!
   * Set up all the REST contexts for admin and anonymous users with which we
   * will invoke requests
   */
  before((done) => {
    asGlobalAdmin = TestsUtil.createGlobalAdminRestContext();
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    asCambridgeAnonymousUser = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    asGeorgiaTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    done();
  });

  /*!
   * After each test, ensure the default folder visibility is the default value
   */
  afterEach((callback) => {
    // Ensure the default folder visibility always starts fresh
    ConfigTestUtil.clearConfigAndWait(asGlobalAdmin, null, ['oae-folders/visibility/folder'], (error) => {
      assert.notExists(error);
      return callback();
    });
  });

  /*!
   * Create a member update object whose key is the provided principal id and the value is the
   * role change. This is simply a convenience for performing individual role updates on
   * folders
   *
   * @param  {String|Object}      principalInfo   The id of the principal whose role to change, or a principalInfo object. If an object, the `role` key will be added so it can be used in assert test utilities for updating membership
   * @param  {String|Boolean}     roleChange      The change to make to the principal's role. Should either be a role (`manager` or `viewer`, or `false` to remove them)
   */
  const _memberUpdate = function (principalInfo, roleChange) {
    roleChange = _.isUndefined(roleChange) ? 'viewer' : roleChange;

    const memberUpdate = {};
    if (_.isObject(principalInfo)) {
      // If the principal info is an object, then it contains the restContext and the profile,
      // and we extend the info object with the role change
      const profile = principalInfo.user || principalInfo.group;
      memberUpdate[profile.id] = _.extend({}, principalInfo, { role: roleChange });
    } else {
      // If the principal info is not an object, it should be a string, representing the
      // id of the principal whose role to change
      memberUpdate[principalInfo] = roleChange;
    }

    return memberUpdate;
  };

  /**
   * Utility method that returns a stream that points to a text file
   *
   * @return {Stream}     A stream that points to a text file that can be uploaded
   */
  const _getFileStream = () => fs.createReadStream(Path.join(__dirname, '/data/file.txt'));

  describe('Create Folder', () => {
    /**
     * Test that verifies creation of a folder
     */
    it('verify folder creation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: stuartf, 2: sathomas } = users;

        FoldersTestUtil.assertCreateFolderSucceeds(
          mrvisser.restContext,
          'test displayName',
          'test description',
          'private',
          [stuartf],
          [sathomas],
          (createdFolder) => {
            // Ensure the returned folder model is accurate
            assert.ok(createdFolder);
            assert.ok(createdFolder.tenant);
            assert.strictEqual(createdFolder.tenant.alias, global.oaeTests.tenants.cam.alias);
            assert.strictEqual(createdFolder.tenant.displayName, global.oaeTests.tenants.cam.displayName);
            assert.ok(createdFolder.id);
            assert.ok(createdFolder.groupId);
            assert.strictEqual(createdFolder.displayName, 'test displayName');
            assert.strictEqual(createdFolder.description, 'test description');
            assert.strictEqual(createdFolder.visibility, 'private');
            assert.ok(createdFolder.created);
            assert.strictEqual(createdFolder.lastModified, createdFolder.created);
            assert.strictEqual(
              createdFolder.profilePath,
              format('/folder/%s/%s', global.oaeTests.tenants.cam.alias, createdFolder.id.split(':').pop())
            );
            assert.strictEqual(createdFolder.resourceType, 'folder');

            // Sanity check that the folder was created
            FoldersTestUtil.assertGetFolderSucceeds(mrvisser.restContext, createdFolder.id, (fetchedFolder) => {
              // Ensure the fetched folder model is consistent with the created one
              assert.ok(fetchedFolder);
              assert.ok(fetchedFolder.tenant);
              assert.strictEqual(fetchedFolder.tenant.alias, createdFolder.tenant.alias);
              assert.strictEqual(fetchedFolder.tenant.displayName, createdFolder.tenant.displayName);
              assert.strictEqual(fetchedFolder.id, createdFolder.id);
              assert.strictEqual(fetchedFolder.groupId, createdFolder.groupId);
              assert.strictEqual(fetchedFolder.displayName, createdFolder.displayName);
              assert.strictEqual(fetchedFolder.description, createdFolder.description);
              assert.strictEqual(fetchedFolder.visibility, createdFolder.visibility);
              assert.strictEqual(fetchedFolder.created, createdFolder.created.toString());
              assert.strictEqual(fetchedFolder.lastModified, createdFolder.lastModified.toString());
              assert.strictEqual(fetchedFolder.profilePath, createdFolder.profilePath);
              assert.strictEqual(fetchedFolder.resourceType, createdFolder.resourceType);

              // Ensure createdBy user model is consistent with the user who created it
              assert.ok(fetchedFolder.createdBy);
              assert.strictEqual(fetchedFolder.createdBy.tenant.alias, mrvisser.user.tenant.alias);
              assert.strictEqual(fetchedFolder.createdBy.tenant.displayName, mrvisser.user.tenant.displayName);
              assert.strictEqual(fetchedFolder.createdBy.id, mrvisser.user.id);
              assert.strictEqual(fetchedFolder.createdBy.displayName, mrvisser.user.displayName);
              assert.strictEqual(fetchedFolder.createdBy.visibility, mrvisser.user.visibility);
              assert.strictEqual(fetchedFolder.createdBy.email, mrvisser.user.email);
              assert.strictEqual(fetchedFolder.createdBy.locale, mrvisser.user.locale);
              assert.strictEqual(fetchedFolder.createdBy.timezone, mrvisser.user.timezone);
              assert.strictEqual(fetchedFolder.createdBy.publicAlias, mrvisser.user.publicAlias);
              assert.strictEqual(fetchedFolder.createdBy.profilePath, mrvisser.user.profilePath);
              assert.strictEqual(fetchedFolder.createdBy.resourceType, mrvisser.user.resourceType);
              assert.strictEqual(fetchedFolder.createdBy.acceptedTC, mrvisser.user.acceptedTC);

              // Ensure the initial roles are accurate, including the creator being a manager
              const expectedRoles = {};
              expectedRoles[stuartf.user.id] = 'manager';
              expectedRoles[sathomas.user.id] = 'viewer';
              expectedRoles[mrvisser.user.id] = 'manager';
              return FoldersTestUtil.assertFullFolderMembersEquals(
                mrvisser.restContext,
                createdFolder.id,
                expectedRoles,
                callback
              );
            });
          }
        );
      });
    });

    /**
     * Test that verifies the validation of creating a folder
     */
    it('verify folder creation validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: stuartf, 2: sathomas } = users;

        // Ensure displayName is required
        FoldersTestUtil.assertCreateFolderFails(
          mrvisser.restContext,
          '',
          'test description',
          'private',
          [stuartf.user.id],
          [sathomas.user.id],
          400,
          () => {
            const longDisplayName = TestsUtil.generateRandomText(83);
            assert.ok(longDisplayName.length > 1000);

            // Ensure displayName must be less than 1000 characters
            FoldersTestUtil.assertCreateFolderFails(
              mrvisser.restContext,
              longDisplayName,
              'test description',
              'private',
              [stuartf.user.id],
              [sathomas.user.id],
              400,
              () => {
                const longDescription = TestsUtil.generateRandomText(833);
                assert.ok(longDescription.length > 10000);

                // Ensure description must be less than 10000 characters
                FoldersTestUtil.assertCreateFolderFails(
                  mrvisser.restContext,
                  'test displayName',
                  longDescription,
                  'private',
                  [stuartf.user.id],
                  [sathomas.user.id],
                  400,
                  () => {
                    // Ensure visibility must be valid
                    FoldersTestUtil.assertCreateFolderFails(
                      mrvisser.restContext,
                      'test displayName',
                      'test description',
                      'notvalid',
                      [stuartf.user.id],
                      [sathomas.user.id],
                      400,
                      () => {
                        // Ensure manager id must be a valid resource id
                        FoldersTestUtil.assertCreateFolderFails(
                          mrvisser.restContext,
                          'test displayName',
                          'test description',
                          'private',
                          ['notaresourceid'],
                          [sathomas.user.id],
                          400,
                          () => {
                            // Ensure manager id must be a principal id
                            FoldersTestUtil.assertCreateFolderFails(
                              mrvisser.restContext,
                              'test displayName',
                              'test description',
                              'private',
                              ['c:oaetest:contentid'],
                              [sathomas.user.id],
                              400,
                              () => {
                                // Ensure manager id must be an existing principal id
                                FoldersTestUtil.assertCreateFolderFails(
                                  mrvisser.restContext,
                                  'test displayName',
                                  'test description',
                                  'private',
                                  ['u:oaetest:nonexistinguserid'],
                                  [sathomas.user.id],
                                  400,
                                  () => {
                                    FoldersTestUtil.assertCreateFolderFails(
                                      mrvisser.restContext,
                                      'test displayName',
                                      'test description',
                                      'private',
                                      ['g:oaetest:nonexistinggroupid'],
                                      [sathomas.user.id],
                                      400,
                                      () => {
                                        // Ensure viewer id must be a valid resource id
                                        FoldersTestUtil.assertCreateFolderFails(
                                          mrvisser.restContext,
                                          'test displayName',
                                          'test description',
                                          'private',
                                          [stuartf.user.id],
                                          ['notaresourceid'],
                                          400,
                                          () => {
                                            // Ensure viewer id must be a principal id
                                            FoldersTestUtil.assertCreateFolderFails(
                                              mrvisser.restContext,
                                              'test displayName',
                                              'test description',
                                              'private',
                                              [stuartf.user.id],
                                              ['c:oaetest:contentid'],
                                              400,
                                              () => {
                                                // Ensure viewer id must be an existing principal id
                                                FoldersTestUtil.assertCreateFolderFails(
                                                  mrvisser.restContext,
                                                  'test displayName',
                                                  'test description',
                                                  'private',
                                                  [stuartf.user.id],
                                                  ['u:oaetest:nonexistinguserid'],
                                                  400,
                                                  () => {
                                                    FoldersTestUtil.assertCreateFolderFails(
                                                      mrvisser.restContext,
                                                      'test displayName',
                                                      'test description',
                                                      'private',
                                                      [stuartf.user.id],
                                                      ['g:oaetest:nonexistinggroupid'],
                                                      400,
                                                      () => {
                                                        // Sanity check that creating a folder works with base input
                                                        FoldersTestUtil.assertCreateFolderSucceeds(
                                                          mrvisser.restContext,
                                                          'test displayName',
                                                          'test description',
                                                          'private',
                                                          [stuartf],
                                                          [sathomas],
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
     * Test that verifies the authorization of creating a folder and associating it with users
     */
    it('verify folder creation authorization', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenant, publicTenant1, privateTenant /* , privateTenant1 */) => {
          // Ensure an anonymous user cannot create a folder
          FoldersTestUtil.assertCreateFolderFails(
            asCambridgeAnonymousUser,
            'test',
            'test',
            'private',
            null,
            null,
            401,
            () => {
              // Ensure a user cannot create a folder with a private user from the same tenant as a viewer
              FoldersTestUtil.assertCreateFolderSucceeds(
                publicTenant.loggedinUser.restContext,
                'test',
                'test',
                'private',
                [publicTenant.publicUser],
                null,
                () => {
                  FoldersTestUtil.assertCreateFolderSucceeds(
                    publicTenant.publicUser.restContext,
                    'test',
                    'test',
                    'private',
                    [publicTenant.loggedinUser],
                    null,
                    () => {
                      FoldersTestUtil.assertCreateFolderFails(
                        publicTenant.publicUser.restContext,
                        'test',
                        'test',
                        'private',
                        [publicTenant.privateUser.user.id],
                        null,
                        401,
                        () => {
                          // Ensure a user cannot create a folder with a loggedin or private user from another tenant as a viewer
                          FoldersTestUtil.assertCreateFolderSucceeds(
                            publicTenant.publicUser.restContext,
                            'test',
                            'test',
                            'private',
                            [publicTenant1.publicUser],
                            null,
                            () => {
                              FoldersTestUtil.assertCreateFolderFails(
                                publicTenant.publicUser.restContext,
                                'test',
                                'test',
                                'private',
                                [publicTenant1.loggedinUser.user.id],
                                null,
                                401,
                                () => {
                                  FoldersTestUtil.assertCreateFolderFails(
                                    publicTenant.publicUser.restContext,
                                    'test',
                                    'test',
                                    'private',
                                    [publicTenant1.privateUser.user.id],
                                    null,
                                    401,
                                    () => {
                                      // Ensure a user cannot create a folder with any user from a private tenant as a viewer
                                      FoldersTestUtil.assertCreateFolderFails(
                                        publicTenant.publicUser.restContext,
                                        'test',
                                        'test',
                                        'private',
                                        [privateTenant.publicUser.user.id],
                                        null,
                                        401,
                                        () => {
                                          FoldersTestUtil.assertCreateFolderFails(
                                            publicTenant.publicUser.restContext,
                                            'test',
                                            'test',
                                            'private',
                                            [privateTenant.loggedinUser.user.id],
                                            null,
                                            401,
                                            () => {
                                              FoldersTestUtil.assertCreateFolderFails(
                                                publicTenant.publicUser.restContext,
                                                'test',
                                                'test',
                                                'private',
                                                [privateTenant.privateUser.user.id],
                                                null,
                                                401,
                                                () => {
                                                  // Ensure a user from a private tenant cannot create a folder with any outside user
                                                  FoldersTestUtil.assertCreateFolderFails(
                                                    privateTenant.publicUser.restContext,
                                                    'test',
                                                    'test',
                                                    'private',
                                                    [publicTenant.publicUser.user.id],
                                                    null,
                                                    401,
                                                    () => {
                                                      FoldersTestUtil.assertCreateFolderFails(
                                                        privateTenant.publicUser.restContext,
                                                        'test',
                                                        'test',
                                                        'private',
                                                        [publicTenant.loggedinUser.user.id],
                                                        null,
                                                        401,
                                                        () => {
                                                          FoldersTestUtil.assertCreateFolderFails(
                                                            privateTenant.publicUser.restContext,
                                                            'test',
                                                            'test',
                                                            'private',
                                                            [publicTenant.privateUser.user.id],
                                                            null,
                                                            401,
                                                            () => {
                                                              // Ensure an admin can create a folder with a private user from the same tenant as a viewer
                                                              FoldersTestUtil.assertCreateFolderSucceeds(
                                                                publicTenant.adminRestContext,
                                                                'test',
                                                                'test',
                                                                'private',
                                                                [publicTenant.publicUser],
                                                                null,
                                                                () => {
                                                                  FoldersTestUtil.assertCreateFolderSucceeds(
                                                                    publicTenant.adminRestContext,
                                                                    'test',
                                                                    'test',
                                                                    'private',
                                                                    [publicTenant.loggedinUser],
                                                                    null,
                                                                    () => {
                                                                      FoldersTestUtil.assertCreateFolderSucceeds(
                                                                        publicTenant.adminRestContext,
                                                                        'test',
                                                                        'test',
                                                                        'private',
                                                                        [publicTenant.privateUser],
                                                                        null,
                                                                        () => {
                                                                          // Ensure an admin cannot create a folder with a loggedin or private user from another tenant as a viewer
                                                                          FoldersTestUtil.assertCreateFolderSucceeds(
                                                                            publicTenant.adminRestContext,
                                                                            'test',
                                                                            'test',
                                                                            'private',
                                                                            [publicTenant1.publicUser],
                                                                            null,
                                                                            () => {
                                                                              FoldersTestUtil.assertCreateFolderFails(
                                                                                publicTenant.adminRestContext,
                                                                                'test',
                                                                                'test',
                                                                                'private',
                                                                                [publicTenant1.loggedinUser.user.id],
                                                                                null,
                                                                                401,
                                                                                () => {
                                                                                  FoldersTestUtil.assertCreateFolderFails(
                                                                                    publicTenant.adminRestContext,
                                                                                    'test',
                                                                                    'test',
                                                                                    'private',
                                                                                    [publicTenant1.privateUser.user.id],
                                                                                    null,
                                                                                    401,
                                                                                    () => {
                                                                                      // Ensure an admin cannot create a folder with any user from a private tenant as a viewer
                                                                                      FoldersTestUtil.assertCreateFolderFails(
                                                                                        publicTenant.adminRestContext,
                                                                                        'test',
                                                                                        'test',
                                                                                        'private',
                                                                                        [
                                                                                          privateTenant.publicUser.user
                                                                                            .id
                                                                                        ],
                                                                                        null,
                                                                                        401,
                                                                                        () => {
                                                                                          FoldersTestUtil.assertCreateFolderFails(
                                                                                            publicTenant.adminRestContext,
                                                                                            'test',
                                                                                            'test',
                                                                                            'private',
                                                                                            [
                                                                                              privateTenant.loggedinUser
                                                                                                .user.id
                                                                                            ],
                                                                                            null,
                                                                                            401,
                                                                                            () => {
                                                                                              FoldersTestUtil.assertCreateFolderFails(
                                                                                                publicTenant.adminRestContext,
                                                                                                'test',
                                                                                                'test',
                                                                                                'private',
                                                                                                [
                                                                                                  privateTenant
                                                                                                    .privateUser.user.id
                                                                                                ],
                                                                                                null,
                                                                                                401,
                                                                                                () => {
                                                                                                  // Ensure an admin from a private tenant cannot create a folder with any outside user
                                                                                                  FoldersTestUtil.assertCreateFolderFails(
                                                                                                    privateTenant.adminRestContext,
                                                                                                    'test',
                                                                                                    'test',
                                                                                                    'private',
                                                                                                    [
                                                                                                      publicTenant
                                                                                                        .publicUser.user
                                                                                                        .id
                                                                                                    ],
                                                                                                    null,
                                                                                                    401,
                                                                                                    () => {
                                                                                                      FoldersTestUtil.assertCreateFolderFails(
                                                                                                        privateTenant.adminRestContext,
                                                                                                        'test',
                                                                                                        'test',
                                                                                                        'private',
                                                                                                        [
                                                                                                          publicTenant
                                                                                                            .loggedinUser
                                                                                                            .user.id
                                                                                                        ],
                                                                                                        null,
                                                                                                        401,
                                                                                                        () => {
                                                                                                          return FoldersTestUtil.assertCreateFolderFails(
                                                                                                            privateTenant.adminRestContext,
                                                                                                            'test',
                                                                                                            'test',
                                                                                                            'private',
                                                                                                            [
                                                                                                              publicTenant
                                                                                                                .privateUser
                                                                                                                .user.id
                                                                                                            ],
                                                                                                            null,
                                                                                                            401,
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
        }
      );
    });

    /**
     * Test that verifies the visibility of a folder defaults to the tenant configuration
     */
    it('verify folder visibility defaults to the configured tenant default', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: mrvisser } = users;

        // Ensure a folder created without a visibility defaults to public
        RestAPI.Folders.createFolder(mrvisser.restContext, 'test', 'test', null, null, null, (error, createdFolder) => {
          assert.notExists(error);
          assert.strictEqual(createdFolder.visibility, 'public');

          // Set the default privacy to private
          ConfigTestUtil.updateConfigAndWait(
            asGlobalAdmin,
            null,
            { 'oae-folders/visibility/folder': 'private' },
            (error_) => {
              assert.notExists(error_);

              // Ensure a folder created without a visibility now defaults to private
              RestAPI.Folders.createFolder(
                mrvisser.restContext,
                'test',
                'test',
                null,
                null,
                null,
                (error, createdFolder) => {
                  assert.notExists(error);
                  assert.strictEqual(createdFolder.visibility, 'private');
                  return callback();
                }
              );
            }
          );
        });
      });
    });

    /**
     * Create a folder with a given set of managers and viewers. Then check if
     * the user who created the folder was given explicit manager rights.
     *
     * @param  {Object}         user                The user who should create the folder
     * @param  {String[]}       managers            The ids of the principals who should be managers
     * @param  {String[]}       viewers             The ids of the principals who should be viewers
     * @param  {Boolean}        expectedManager     Whether or not the folder creator should be an explicit manager
     * @param  {Function}       callback            Standard callback function
     */
    const createAndVerifyManager = function (user, managers, viewers, expectedManager, callback) {
      RestAPI.Folders.createFolder(user.restContext, 'test', 'test', null, managers, viewers, (error, folder) => {
        assert.notExists(error);

        FoldersTestUtil.getAllFolderMembers(user.restContext, folder.id, null, (members) => {
          if (expectedManager) {
            const member = _.find(members, (member) => {
              return member.profile.id === user.user.id && member.role === 'manager';
            });
            assert.ok(member);
          }

          return callback();
        });
      });
    };

    /**
     * Test that verifies that the folder creator is only made an explicit manager if he cannot manage the folder indirectly
     */
    it('verify the creator is only made a manager when he cannot manage indirectly', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: simong, 1: nico, 2: stuart } = users;

        TestsUtil.generateTestGroups(simong.restContext, 1, (error, groups) => {
          assert.notExists(error);

          const { 0: simongGroup } = groups;

          TestsUtil.generateTestGroups(nico.restContext, 6, (error, groups) => {
            assert.notExists(error);

            const { 0: nicoGroup1, 1: nicoGroup2, 2: nicoGroup3, 3: nicoGroup4, 4: nicoGroup5, 5: nicoGroup6 } = groups;

            TestsUtil.generateGroupHierarchy(
              nico.restContext,
              [nicoGroup1.group.id, nicoGroup2.group.id, nicoGroup3.group.id],
              'member',
              () => {
                TestsUtil.generateGroupHierarchy(
                  nico.restContext,
                  [nicoGroup4.group.id, nicoGroup5.group.id, nicoGroup6.group.id],
                  'manager',
                  () => {
                    const roleChange = AuthzTestUtil.createRoleChange([stuart.user.id], 'member');
                    RestAPI.Group.setGroupMembers(nico.restContext, nicoGroup3.group.id, roleChange, (error_) => {
                      assert.notExists(error_);
                      const roleChange = AuthzTestUtil.createRoleChange([stuart.user.id], 'manager');
                      RestAPI.Group.setGroupMembers(nico.restContext, nicoGroup6.group.id, roleChange, (error_) => {
                        assert.notExists(error_);

                        createAndVerifyManager(simong, null, null, true, () => {
                          createAndVerifyManager(simong, [nico.user.id], null, true, () => {
                            createAndVerifyManager(simong, null, [simongGroup.group.id], true, () => {
                              createAndVerifyManager(simong, [simongGroup.group.id], null, false, () => {
                                createAndVerifyManager(
                                  simong,
                                  [simongGroup.group.id, nicoGroup1.group.id],
                                  null,
                                  false,
                                  () => {
                                    // Verify a mix of users and groups that Simon can't manage
                                    createAndVerifyManager(
                                      simong,
                                      [nico.user.id, simongGroup.group.id, nicoGroup1.group.id],
                                      null,
                                      false,
                                      () => {
                                        // Stuart is an indirect member of group 1, he should be
                                        // made a manager of the folder as he cannot manage nicoGroup1
                                        createAndVerifyManager(stuart, [nicoGroup1.group.id], null, true, () => {
                                          // Stuart is an indirect manager of group 4, he should not be made
                                          // a manager of the folder as he can manage nicoGroup4 (indirectly)
                                          createAndVerifyManager(stuart, [nicoGroup4.group.id], null, false, () => {
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
    });
  });

  describe('Update Folder', () => {
    /**
     * Test that verifies the parameters are validated
     */
    it('verify parameter validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: simong } = users;

        // Create a folder
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [],
          [],
          (folder) => {
            // Invalid folder id
            FoldersTestUtil.assertUpdateFolderFails(
              simong.restContext,
              'not a folder id',
              { displayName: 'new' },
              400,
              () => {
                // Missing folder
                FoldersTestUtil.assertUpdateFolderFails(
                  simong.restContext,
                  'f:camtest:no',
                  { displayName: 'new' },
                  404,
                  () => {
                    // Missing update values
                    FoldersTestUtil.assertUpdateFolderFails(simong.restContext, folder.id, null, 400, () => {
                      // Unused update values
                      FoldersTestUtil.assertUpdateFolderFails(
                        simong.restContext,
                        folder.id,
                        { not: 'right' },
                        400,
                        () => {
                          // Invalid displayName
                          const longDisplayName = TestsUtil.generateRandomText(83);
                          FoldersTestUtil.assertUpdateFolderFails(
                            simong.restContext,
                            folder.id,
                            { displayName: longDisplayName },
                            400,
                            () => {
                              // Invalid description
                              const longDescription = TestsUtil.generateRandomText(833);
                              FoldersTestUtil.assertUpdateFolderFails(
                                simong.restContext,
                                folder.id,
                                { description: longDescription },
                                400,
                                () => {
                                  // Invalid visibility
                                  FoldersTestUtil.assertUpdateFolderFails(
                                    simong.restContext,
                                    folder.id,
                                    { visibility: 'noowpe' },
                                    400,
                                    () => {
                                      // Sanity check nothing changed
                                      FoldersTestUtil.assertGetFolderSucceeds(
                                        simong.restContext,
                                        folder.id,
                                        (checkFolder) => {
                                          assert.strictEqual(checkFolder.displayName, folder.displayName);
                                          assert.strictEqual(checkFolder.description, folder.description);
                                          assert.strictEqual(checkFolder.visibility, folder.visibility);
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

    /**
     * Test that verifies only managers can update a folder
     */
    it('verify update folder authorization', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: simong, 1: nico, 2: bert } = users;

        // Create a folder and make Nico a member of it
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [],
          [nico],
          (folder) => {
            // Anonymous users cannot update folders
            FoldersTestUtil.assertUpdateFolderFails(
              asCambridgeAnonymousUser,
              folder.id,
              { visibility: 'private' },
              401,
              () => {
                // Unrelated users cannot update folders
                FoldersTestUtil.assertUpdateFolderFails(
                  bert.restContext,
                  folder.id,
                  { visibility: 'private' },
                  401,
                  () => {
                    // Members cannot update folders
                    FoldersTestUtil.assertUpdateFolderFails(
                      nico.restContext,
                      folder.id,
                      { visibility: 'private' },
                      401,
                      () => {
                        // Tenant admins from other tenants cannot update the folder
                        FoldersTestUtil.assertUpdateFolderFails(
                          asGeorgiaTenantAdmin,
                          folder.id,
                          { visibility: 'private' },
                          401,
                          () => {
                            // Sanity check the folder was not updated
                            FoldersTestUtil.assertGetFolderSucceeds(simong.restContext, folder.id, (checkFolder) => {
                              assert.strictEqual(folder.visibility, checkFolder.visibility);
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
          }
        );
      });
    });

    /**
     * Test that verifies only managers can update a folder
     */
    it('verify update folder content visibility authorization', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);

        const { 0: simong, 1: nico, 2: bert } = users;

        // Create a folder and make Nico a member of it
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [],
          [nico],
          (folder) => {
            // Anonymous users cannot update folders
            FoldersTestUtil.assertUpdateFolderContentVisibilityFails(
              asCambridgeAnonymousUser,
              folder.id,
              'private',
              401,
              () => {
                // Unrelated users cannot update folders
                FoldersTestUtil.assertUpdateFolderContentVisibilityFails(
                  bert.restContext,
                  folder.id,
                  'private',
                  401,
                  () => {
                    // Members cannot update folders
                    FoldersTestUtil.assertUpdateFolderContentVisibilityFails(
                      nico.restContext,
                      folder.id,
                      'private',
                      401,
                      () => {
                        // Tenant admins from other tenants cannot update the folder
                        FoldersTestUtil.assertUpdateFolderContentVisibilityFails(
                          asGeorgiaTenantAdmin,
                          folder.id,
                          'private',
                          401,
                          () => {
                            // Sanity check the folder was not updated
                            FoldersTestUtil.assertGetFolderSucceeds(simong.restContext, folder.id, (checkFolder) => {
                              assert.strictEqual(folder.visibility, checkFolder.visibility);
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
          }
        );
      });
    });

    /**
     * Test that verifies that updating a folder's visibility updates the member folder libraries
     */
    it("verify updating a folder's visibility updates the folder libraries", (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: simong, 1: bert } = users;

        // Create a folder
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [],
          [],
          (folder) => {
            // When Bert lists the folder library for Simon, he can see the folder
            FoldersTestUtil.assertGetFoldersLibrarySucceeds(
              asCambridgeAnonymousUser,
              simong.user.id,
              null,
              null,
              (result) => {
                assert.strictEqual(result.results.length, 1);
                FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                  bert.restContext,
                  simong.user.id,
                  null,
                  null,
                  (result) => {
                    assert.strictEqual(result.results.length, 1);
                    FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                      simong.restContext,
                      simong.user.id,
                      null,
                      null,
                      (result) => {
                        assert.strictEqual(result.results.length, 1);

                        // Make the folder loggedin only
                        FoldersTestUtil.assertUpdateFolderSucceeds(
                          simong.restContext,
                          folder.id,
                          { visibility: 'loggedin' },
                          (folder) => {
                            // Anonymous users cannot see the folder anymore
                            FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                              asCambridgeAnonymousUser,
                              simong.user.id,
                              null,
                              null,
                              (result) => {
                                assert.strictEqual(result.results.length, 0);
                                FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                                  bert.restContext,
                                  simong.user.id,
                                  null,
                                  null,
                                  (result) => {
                                    assert.strictEqual(result.results.length, 1);
                                    FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                                      simong.restContext,
                                      simong.user.id,
                                      null,
                                      null,
                                      (result) => {
                                        assert.strictEqual(result.results.length, 1);

                                        // Make the folder private
                                        FoldersTestUtil.assertUpdateFolderSucceeds(
                                          simong.restContext,
                                          folder.id,
                                          { visibility: 'private' },
                                          (/* folder */) => {
                                            // Bert can no longer see the folder
                                            FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                                              asCambridgeAnonymousUser,
                                              simong.user.id,
                                              null,
                                              null,
                                              (result) => {
                                                assert.strictEqual(result.results.length, 0);
                                                FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                                                  bert.restContext,
                                                  simong.user.id,
                                                  null,
                                                  null,
                                                  (result) => {
                                                    assert.strictEqual(result.results.length, 0);
                                                    FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                                                      simong.restContext,
                                                      simong.user.id,
                                                      null,
                                                      null,
                                                      (result) => {
                                                        assert.strictEqual(result.results.length, 1);

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
      });
    });

    /**
     * Test that verifies authorization of updating a folder
     */
    it("verify a folder's metadata can be updated", (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: simong } = users;

        // Create a folder
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [],
          [],
          (folder) => {
            // Update the folder's metadata
            const updates = {
              displayName: 'wowzors',
              description: 'mega',
              visibility: 'private'
            };
            RestAPI.Folders.updateFolder(simong.restContext, folder.id, updates, (error, folder) => {
              assert.notExists(error);
              assert.ok(folder);
              assert.strictEqual(folder.displayName, updates.displayName);
              assert.strictEqual(folder.description, updates.description);
              assert.strictEqual(folder.visibility, updates.visibility);

              // Sanity-check the full folder profile was returned
              assert.strictEqual(folder.canShare, true);
              assert.strictEqual(folder.canManage, true);
              assert.strictEqual(folder.canAddItem, true);
              assert.ok(_.isObject(folder.createdBy));
              assert.strictEqual(folder.createdBy.id, simong.user.id);

              // Sanity check the updates are persisted
              FoldersTestUtil.assertGetFolderSucceeds(simong.restContext, folder.id, (newFolder) => {
                assert.strictEqual(newFolder.displayName, updates.displayName);
                assert.strictEqual(newFolder.description, updates.description);
                assert.strictEqual(newFolder.visibility, updates.visibility);
                return callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that updating a folder's visibility can update the content inside the folder
     */
    it("verify updating a folder's content items", (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: simong, 1: nico } = users;

        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [],
          [],
          (folder) => {
            // Both users create a content item
            RestAPI.Content.createLink(
              simong.restContext,
              {
                displayName: 'test',
                description: 'test',
                visibility: PUBLIC,
                link: 'http://www.google.ca',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error, simonsLink) => {
                assert.notExists(error);
                RestAPI.Content.createLink(
                  nico.restContext,
                  {
                    displayName: 'test',
                    description: 'test',
                    visibility: PUBLIC,
                    link: 'http://www.google.ca',
                    managers: NO_MANAGERS,
                    viewers: NO_VIEWERS,
                    folders: NO_FOLDERS
                  },
                  (error, nicosLink) => {
                    assert.notExists(error);

                    // Simon adds the two items to the folder
                    FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                      simong.restContext,
                      folder.id,
                      [simonsLink.id, nicosLink.id],
                      () => {
                        // Change the visibility of the folder to loggedin AND change the content items
                        const updates = { visibility: 'loggedin' };
                        RestAPI.Folders.updateFolder(simong.restContext, folder.id, updates, (error, folder) => {
                          assert.notExists(error);
                          assert.ok(folder);

                          // Sanity-check the full folder profile was returned
                          assert.strictEqual(folder.canShare, true);
                          assert.strictEqual(folder.canManage, true);
                          assert.strictEqual(folder.canAddItem, true);
                          assert.ok(_.isObject(folder.createdBy));
                          assert.strictEqual(folder.createdBy.id, simong.user.id);

                          // Update the content items in the folder
                          RestAPI.Folders.updateFolderContentVisibility(
                            simong.restContext,
                            folder.id,
                            'loggedin',
                            (error, data) => {
                              assert.notExists(error);

                              // Only 1 item should've failed
                              assert.strictEqual(data.failedContent.length, 1);
                              assert.strictEqual(data.failedContent[0].id, nicosLink.id);

                              // The failed content items should have a signature
                              assert.ok(data.failedContent[0].signature);

                              // Assert that simonsLink's visibility changed
                              RestAPI.Content.getContent(simong.restContext, simonsLink.id, (error, content) => {
                                assert.notExists(error);
                                assert.strictEqual(content.visibility, 'loggedin');

                                // Assert that nicosLink's visibility did not change
                                RestAPI.Content.getContent(simong.restContext, nicosLink.id, (error, content) => {
                                  assert.notExists(error);
                                  assert.strictEqual(content.visibility, 'public');

                                  FoldersTestUtil.assertFolderEquals(
                                    nico.restContext,
                                    folder.id,
                                    [simonsLink.id, nicosLink.id],
                                    () => {
                                      return callback();
                                    }
                                  );
                                });
                              });
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
    });
  });

  describe('Get Folder', () => {
    /**
     * Test that verifies validation of getting a folder
     */
    it('verify get folder validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: mrvisser } = users;

        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          // Ensure fetching using an invalid id results in an error
          FoldersTestUtil.assertGetFolderFails(mrvisser.restContext, 'invalidid', 400, () => {
            // Ensure fetching using a non-existing id results in a 404
            FoldersTestUtil.assertGetFolderFails(mrvisser.restContext, 'x:oaetest:nonexistingid', 404, () => {
              // Sanity check getting an existing folder
              FoldersTestUtil.assertGetFolderSucceeds(mrvisser.restContext, folder.id, () => {
                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies authorization of getting a folder
     */
    it('verify get folder authorization', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1) => {
        // Make the private user from a tenant a member of the private folder
        FoldersTestUtil.assertShareFolderSucceeds(
          publicTenant.adminRestContext,
          publicTenant.adminRestContext,
          publicTenant.privateFolder.id,
          [publicTenant.privateUser],
          (error) => {
            assert.notExists(error);
            // Make the public user from a different tenant a member of a loggedin and private folder
            FoldersTestUtil.assertShareFolderSucceeds(
              publicTenant1.adminRestContext,
              publicTenant1.adminRestContext,
              publicTenant1.loggedinFolder.id,
              [publicTenant.publicUser],
              (error) => {
                assert.notExists(error);
                FoldersTestUtil.assertShareFolderSucceeds(
                  publicTenant1.adminRestContext,
                  publicTenant1.adminRestContext,
                  publicTenant1.privateFolder.id,
                  [publicTenant.publicUser],
                  (error) => {
                    assert.notExists(error);
                    // Ensure user from same tenant can see public, loggedin but only private folders to which they have explicit access
                    FoldersTestUtil.assertGetFolderSucceeds(
                      publicTenant.publicUser.restContext,
                      publicTenant.publicFolder.id,
                      () => {
                        FoldersTestUtil.assertGetFolderSucceeds(
                          publicTenant.publicUser.restContext,
                          publicTenant.loggedinFolder.id,
                          () => {
                            FoldersTestUtil.assertGetFolderFails(
                              publicTenant.publicUser.restContext,
                              publicTenant.privateFolder.id,
                              401,
                              () => {
                                FoldersTestUtil.assertGetFolderSucceeds(
                                  publicTenant.privateUser.restContext,
                                  publicTenant.privateFolder.id,
                                  () => {
                                    // Ensure user from different tenant can see public, but only loggedin and private to which they have explicit access
                                    FoldersTestUtil.assertGetFolderSucceeds(
                                      publicTenant.loggedinUser.restContext,
                                      publicTenant1.publicFolder.id,
                                      () => {
                                        FoldersTestUtil.assertGetFolderFails(
                                          publicTenant.loggedinUser.restContext,
                                          publicTenant1.loggedinFolder.id,
                                          401,
                                          () => {
                                            FoldersTestUtil.assertGetFolderFails(
                                              publicTenant.loggedinUser.restContext,
                                              publicTenant1.privateFolder.id,
                                              401,
                                              () => {
                                                FoldersTestUtil.assertGetFolderSucceeds(
                                                  publicTenant.publicUser.restContext,
                                                  publicTenant1.loggedinFolder.id,
                                                  () => {
                                                    FoldersTestUtil.assertGetFolderSucceeds(
                                                      publicTenant.publicUser.restContext,
                                                      publicTenant1.privateFolder.id,
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
     * Test that verifies getting a full folder profile will scrub the creator of the folder appropriately
     */
    it('verify get folder scrubs creator user', (callback) => {
      // Setup multi-tenant privacy entities without folders or content. We only need
      // multi-tenant privacy users for this test
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant /* , publicTenant1 */) => {
        // Create a public folder as the private user
        FoldersTestUtil.assertCreateFolderSucceeds(
          publicTenant.privateUser.restContext,
          'test',
          'test',
          'public',
          null,
          null,
          (createdFolder) => {
            // Ensure the user themself gets the full creator profile when they get the folder
            FoldersTestUtil.assertGetFolderSucceeds(
              publicTenant.privateUser.restContext,
              createdFolder.id,
              (fetchedFolder) => {
                assert.ok(fetchedFolder.createdBy);
                assert.strictEqual(fetchedFolder.createdBy.tenant.alias, publicTenant.privateUser.user.tenant.alias);
                assert.strictEqual(
                  fetchedFolder.createdBy.tenant.displayName,
                  publicTenant.privateUser.user.tenant.displayName
                );
                assert.strictEqual(fetchedFolder.createdBy.id, publicTenant.privateUser.user.id);
                assert.strictEqual(fetchedFolder.createdBy.displayName, publicTenant.privateUser.user.displayName);
                assert.strictEqual(fetchedFolder.createdBy.visibility, publicTenant.privateUser.user.visibility);
                assert.strictEqual(fetchedFolder.createdBy.email, publicTenant.privateUser.user.email);
                assert.strictEqual(fetchedFolder.createdBy.locale, publicTenant.privateUser.user.locale);
                assert.strictEqual(fetchedFolder.createdBy.timezone, publicTenant.privateUser.user.timezone);
                assert.strictEqual(fetchedFolder.createdBy.publicAlias, publicTenant.privateUser.user.publicAlias);
                assert.strictEqual(fetchedFolder.createdBy.profilePath, publicTenant.privateUser.user.profilePath);
                assert.strictEqual(fetchedFolder.createdBy.resourceType, publicTenant.privateUser.user.resourceType);
                assert.strictEqual(fetchedFolder.createdBy.acceptedTC, publicTenant.privateUser.user.acceptedTC);

                // Ensure an admin user gets the full creator profile when they get the folder
                FoldersTestUtil.assertGetFolderSucceeds(
                  publicTenant.adminRestContext,
                  createdFolder.id,
                  (fetchedFolder) => {
                    assert.ok(fetchedFolder.createdBy);
                    assert.strictEqual(
                      fetchedFolder.createdBy.tenant.alias,
                      publicTenant.privateUser.user.tenant.alias
                    );
                    assert.strictEqual(
                      fetchedFolder.createdBy.tenant.displayName,
                      publicTenant.privateUser.user.tenant.displayName
                    );
                    assert.strictEqual(fetchedFolder.createdBy.id, publicTenant.privateUser.user.id);
                    assert.strictEqual(fetchedFolder.createdBy.displayName, publicTenant.privateUser.user.displayName);
                    assert.strictEqual(fetchedFolder.createdBy.visibility, publicTenant.privateUser.user.visibility);
                    assert.strictEqual(fetchedFolder.createdBy.email, publicTenant.privateUser.user.email);
                    assert.strictEqual(fetchedFolder.createdBy.locale, publicTenant.privateUser.user.locale);
                    assert.strictEqual(fetchedFolder.createdBy.timezone, publicTenant.privateUser.user.timezone);
                    assert.strictEqual(fetchedFolder.createdBy.publicAlias, publicTenant.privateUser.user.publicAlias);
                    assert.strictEqual(fetchedFolder.createdBy.profilePath, publicTenant.privateUser.user.profilePath);
                    assert.strictEqual(
                      fetchedFolder.createdBy.resourceType,
                      publicTenant.privateUser.user.resourceType
                    );
                    assert.strictEqual(fetchedFolder.createdBy.acceptedTC, publicTenant.privateUser.user.acceptedTC);

                    // Ensure another user from the tenant gets a scrubbed creator profile when they get the folder
                    FoldersTestUtil.assertGetFolderSucceeds(
                      publicTenant.loggedinUser.restContext,
                      createdFolder.id,
                      (fetchedFolder) => {
                        assert.ok(fetchedFolder.createdBy);
                        assert.strictEqual(
                          fetchedFolder.createdBy.tenant.alias,
                          publicTenant.privateUser.user.tenant.alias
                        );
                        assert.strictEqual(
                          fetchedFolder.createdBy.tenant.displayName,
                          publicTenant.privateUser.user.tenant.displayName
                        );
                        assert.strictEqual(fetchedFolder.createdBy.id, publicTenant.privateUser.user.id);
                        assert.strictEqual(
                          fetchedFolder.createdBy.displayName,
                          publicTenant.privateUser.user.publicAlias
                        );
                        assert.strictEqual(
                          fetchedFolder.createdBy.visibility,
                          publicTenant.privateUser.user.visibility
                        );
                        assert.ok(!fetchedFolder.createdBy.email);
                        assert.ok(!fetchedFolder.createdBy.locale);
                        assert.ok(!fetchedFolder.createdBy.timezone);
                        assert.ok(!fetchedFolder.createdBy.publicAlias);
                        assert.ok(!fetchedFolder.createdBy.profilePath);
                        assert.strictEqual(
                          fetchedFolder.createdBy.resourceType,
                          publicTenant.privateUser.user.resourceType
                        );
                        assert.strictEqual(fetchedFolder.createdBy.acceptedTC, undefined);
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
     * Test that verifies the permission flags (e.g., `canShare`, `canAddItem`) of a full folder profile
     */
    it('verify get folder profile permission flags', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1, privateTenant) => {
        // Create one more folder as the public user
        FoldersTestUtil.generateTestFolders(publicTenant.publicUser.restContext, 1, (createdFolder) => {
          // Ensure permission flags for admin
          FoldersTestUtil.assertGetFolderSucceeds(
            publicTenant.adminRestContext,
            publicTenant.publicFolder.id,
            (fetchedFolder) => {
              assert.strictEqual(fetchedFolder.canManage, true);
              assert.strictEqual(fetchedFolder.canShare, true);
              assert.strictEqual(fetchedFolder.canAddItem, true);

              // Ensure permission flags for manager of a folder
              FoldersTestUtil.assertGetFolderSucceeds(
                publicTenant.publicUser.restContext,
                createdFolder.id,
                (fetchedFolder) => {
                  assert.strictEqual(fetchedFolder.canManage, true);
                  assert.strictEqual(fetchedFolder.canShare, true);
                  assert.strictEqual(fetchedFolder.canAddItem, true);

                  // Ensure permission flags for non-manager user on non-private folder
                  FoldersTestUtil.assertGetFolderSucceeds(
                    publicTenant.publicUser.restContext,
                    publicTenant.loggedinFolder.id,
                    (fetchedFolder) => {
                      assert.strictEqual(fetchedFolder.canManage, false);
                      assert.strictEqual(fetchedFolder.canShare, true);
                      assert.strictEqual(fetchedFolder.canAddItem, false);

                      // Ensure permission flags for non-manager user on private folder
                      FoldersTestUtil.assertShareFolderSucceeds(
                        publicTenant.adminRestContext,
                        publicTenant.adminRestContext,
                        publicTenant.privateFolder.id,
                        [publicTenant.publicUser],
                        () => {
                          FoldersTestUtil.assertGetFolderSucceeds(
                            publicTenant.publicUser.restContext,
                            publicTenant.privateFolder.id,
                            (fetchedFolder) => {
                              assert.strictEqual(fetchedFolder.canManage, false);
                              assert.strictEqual(fetchedFolder.canShare, false);
                              assert.strictEqual(fetchedFolder.canAddItem, false);

                              // Ensure permission flags for non-manager user in another public tenant
                              FoldersTestUtil.assertGetFolderSucceeds(
                                publicTenant1.publicUser.restContext,
                                publicTenant.publicFolder.id,
                                (fetchedFolder) => {
                                  assert.strictEqual(fetchedFolder.canManage, false);
                                  assert.strictEqual(fetchedFolder.canShare, true);
                                  assert.strictEqual(fetchedFolder.canAddItem, false);

                                  // Ensure permission flags for non-manager user in another private tenant
                                  FoldersTestUtil.assertGetFolderSucceeds(
                                    privateTenant.publicUser.restContext,
                                    publicTenant.publicFolder.id,
                                    (fetchedFolder) => {
                                      assert.strictEqual(fetchedFolder.canManage, false);
                                      assert.strictEqual(fetchedFolder.canShare, false);
                                      assert.strictEqual(fetchedFolder.canAddItem, false);
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

  describe('Delete Folder', () => {
    /**
     * Test that verifies validation of deleting a folder
     */
    it('verify delete folder validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;
        FoldersTestUtil.generateTestFolders(simong.restContext, 1, (/* folder */) => {
          // Ensure deleting using an invalid id results in an error
          FoldersTestUtil.assertDeleteFolderFails(simong.restContext, 'invalidid', 400, () => {
            // Ensure deleting using a non-existing id results in a 404
            FoldersTestUtil.assertDeleteFolderFails(simong.restContext, 'f:oaetest:nonexistingid', 404, () => {
              // Sanity-check it was not removed
              FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                simong.restContext,
                simong.user.id,
                null,
                null,
                (result) => {
                  assert.strictEqual(result.results.length, 1);
                  return callback();
                }
              );
            });
          });
        });
      });
    });

    /**
     * Test that verifies authorization of deleting a folder
     */
    it('verify delete folder authorization', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: simong, 1: nico, 2: bert } = users;

        // Create a folder and make Nico a member of it
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [],
          [nico],
          (folder) => {
            // Anonymous users cannot delete folders
            FoldersTestUtil.assertDeleteFolderFails(asCambridgeAnonymousUser, folder.id, 401, () => {
              // Unrelated users cannot delete folders
              FoldersTestUtil.assertDeleteFolderFails(bert.restContext, folder.id, 401, () => {
                // Members cannot delete folders
                FoldersTestUtil.assertDeleteFolderFails(nico.restContext, folder.id, 401, () => {
                  // Tenant admins from other tenants cannot delete the folder
                  FoldersTestUtil.assertDeleteFolderFails(asGeorgiaTenantAdmin, folder.id, 401, () => {
                    // Sanity-check it was not removed
                    FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                      simong.restContext,
                      simong.user.id,
                      null,
                      null,
                      (result) => {
                        assert.strictEqual(result.results.length, 1);

                        // Sanity-check a manager can delete it
                        FoldersTestUtil.assertDeleteFolderSucceeds(simong.restContext, folder.id, false, () => {
                          // Sanity-check it was not removed
                          FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                            simong.restContext,
                            simong.user.id,
                            null,
                            null,
                            (result) => {
                              assert.strictEqual(result.results.length, 0);
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

    /**
     * Check if the members for a set of content items are set correctly
     *
     * @param  {String[]}       contentIds          The ids of the content items to check
     * @param  {String[]}       expectedMembers     The ids of the principals that are expected to have a role on each content item
     * @param  {Function}       callback            Standard callback function
     */
    const checkContentMembers = function (contentIds, expectedMembers, callback) {
      const done = _.after(contentIds.length, callback);
      _.each(contentIds, (contentId) => {
        AuthzAPI.getAuthzMembers(contentId, null, 10, (error, members) => {
          assert.notExists(error);
          const principalIds = _.pluck(members, 'id');
          assert.strictEqual(principalIds.length, expectedMembers.length);
          _.each(principalIds, (principalId) => {
            assert.ok(_.contains(expectedMembers, principalId));
          });

          done();
        });
      });
    };

    /**
     * Test that verifies that when a folder gets deleted the authz membership on all the content items gets adjusted
     */
    it('verify delete folder removes the folder authz group from the content items', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;

        // Generate a test folder
        FoldersTestUtil.generateTestFolders(simong.restContext, 1, (folder) => {
          // Generate 15 links that can be added to the folder
          ContentTestUtil.generateTestLinks(simong.restContext, 15, function (...args) {
            const contentIds = _.pluck(args, 'id');

            // Add the content to the folder
            FoldersTestUtil.assertAddContentItemsToFolderSucceeds(simong.restContext, folder.id, contentIds, () => {
              // Sanity-check each folder is an authz member of the content item
              checkContentMembers(contentIds, [simong.user.id, folder.groupId], () => {
                // Delete the folder
                FoldersTestUtil.assertDeleteFolderSucceeds(simong.restContext, folder.id, false, () => {
                  // The folder should no longer be an authz member of the content items
                  checkContentMembers(contentIds, [simong.user.id], callback);
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the delete folder operation can remove content items
     */
    it('verify delete folder can remove content items', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: simong, 1: nico } = users;

        // Generate a test folder
        FoldersTestUtil.generateTestFolders(simong.restContext, 1, (folder) => {
          // Both users generate some content
          ContentTestUtil.generateTestLinks(simong.restContext, 15, function (...args) {
            const simonsContentIds = _.pluck(args, 'id');
            ContentTestUtil.generateTestLinks(nico.restContext, 15, function (...args) {
              const nicosContentIds = _.pluck(args, 'id');

              // Add all the content items to the folder
              const allContentIds = simonsContentIds.concat(nicosContentIds);
              FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                simong.restContext,
                folder.id,
                allContentIds,
                () => {
                  // Delete the folder and the content in it
                  RestAPI.Folders.deleteFolder(simong.restContext, folder.id, true, (error, data) => {
                    assert.notExists(error);

                    // All failed content should be Nico's
                    assert.strictEqual(data.failedContent.length, nicosContentIds.length);
                    _.each(data.failedContent, (contentItem) => {
                      assert.ok(_.contains(nicosContentIds, contentItem.id));

                      // Each failed content item should have a signature
                      assert.ok(contentItem.signature);
                    });

                    // All of Simon's items should be removed
                    const done = _.after(simonsContentIds.length, callback);
                    _.each(simonsContentIds, (contentId) => {
                      RestAPI.Content.getContent(simong.restContext, contentId, (error_) => {
                        assert.strictEqual(error_.code, 404);
                        done();
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

  describe('Share Folder', () => {
    /**
     * Test that verifies sharing with multiple users gives all users access to the folder
     */
    it('verify sharing with multiple users gives all access to a folder', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant) => {
        const userInfosToShare = [publicTenant.publicUser, publicTenant.loggedinUser, publicTenant.privateUser];

        // Give access to the private folder to a user
        FoldersTestUtil.assertShareFolderSucceeds(
          publicTenant.adminRestContext,
          publicTenant.adminRestContext,
          publicTenant.privateFolder.id,
          userInfosToShare,
          () => {
            // Ensure the users can access the private folder
            FoldersTestUtil.assertGetFolderSucceeds(
              publicTenant.publicUser.restContext,
              publicTenant.privateFolder.id,
              () => {
                FoldersTestUtil.assertGetFolderSucceeds(
                  publicTenant.loggedinUser.restContext,
                  publicTenant.privateFolder.id,
                  () => {
                    FoldersTestUtil.assertGetFolderSucceeds(
                      publicTenant.privateUser.restContext,
                      publicTenant.privateFolder.id,
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
     * Test that verifies sharing a folder with a manager does not demote them to viewer
     */
    it('verify sharing does not demote a member from manager to viewer', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: mrvisser, 1: simong } = users;

        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          // Simon shares the folder with a manager
          FoldersTestUtil.assertShareFolderSucceeds(
            mrvisser.restContext,
            simong.restContext,
            folder.id,
            [mrvisser],
            () => {
              // Ensure mrvisser is still a manager
              FoldersTestUtil.assertGetFolderSucceeds(mrvisser.restContext, folder.id, (folder) => {
                assert.strictEqual(folder.canManage, true);
                return callback();
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies validation of sharing a folder
     */
    it('verify sharing validation', (callback) => {
      // Generate a user and a folder to test sharing with
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        FoldersTestUtil.generateTestFolders(asCambridgeTenantAdmin, 1, (folder) => {
          // Ensure a valid folder id must be provided
          FoldersTestUtil.assertShareFolderFails(
            asCambridgeTenantAdmin,
            asCambridgeTenantAdmin,
            'notavalidid',
            [mrvisser.user.id],
            400,
            () => {
              // Ensure an existing folder id must be provided
              FoldersTestUtil.assertShareFolderFails(
                asCambridgeTenantAdmin,
                asCambridgeTenantAdmin,
                'x:oaetest:nonexistingid',
                [mrvisser.user.id],
                404,
                () => {
                  // Ensure a valid target principal id must be provided
                  FoldersTestUtil.assertShareFolderFails(
                    asCambridgeTenantAdmin,
                    asCambridgeTenantAdmin,
                    folder.id,
                    ['notavalidid'],
                    400,
                    () => {
                      FoldersTestUtil.assertShareFolderFails(
                        asCambridgeTenantAdmin,
                        asCambridgeTenantAdmin,
                        folder.id,
                        ['c:oaetest:notaprincipalid'],
                        400,
                        () => {
                          // Ensure an existing target principal id must be provided
                          FoldersTestUtil.assertShareFolderFails(
                            asCambridgeTenantAdmin,
                            asCambridgeTenantAdmin,
                            folder.id,
                            ['u:oaetest:nonexistingid'],
                            400,
                            () => {
                              FoldersTestUtil.assertShareFolderFails(
                                asCambridgeTenantAdmin,
                                asCambridgeTenantAdmin,
                                folder.id,
                                ['g:oaetest:nonexistingid'],
                                400,
                                () => {
                                  // Sanity check we can share with the base input
                                  return FoldersTestUtil.assertShareFolderSucceeds(
                                    asCambridgeTenantAdmin,
                                    asCambridgeTenantAdmin,
                                    folder.id,
                                    [mrvisser],
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
        });
      });
    });

    /**
     * Test that verifies an anonymous user cannot share a folder
     */
    it('verify anonymous user cannot share', (callback) => {
      // Generate a user and folder to test with
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: simong } = users;

        FoldersTestUtil.generateTestFolders(asCambridgeTenantAdmin, 1, (folder) => {
          // Ensure anonymous cannot share with Simong
          FoldersTestUtil.assertShareFolderFails(
            asCambridgeTenantAdmin,
            asCambridgeAnonymousUser,
            folder.id,
            [simong.user.id],
            401,
            () => {
              // Sanity check mrvisser can share with Simong
              return FoldersTestUtil.assertShareFolderSucceeds(
                asCambridgeTenantAdmin,
                mrvisser.restContext,
                folder.id,
                [simong],
                callback
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies authorization of sharing a folder for a regular (non-member) user of the same tenant
     */
    it('verify sharing authorization for a regular user', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1, privateTenant) => {
        // Ensure regular user can only share public and loggedin folders
        FoldersTestUtil.assertShareFolderSucceeds(
          publicTenant.adminRestContext,
          publicTenant.publicUser.restContext,
          publicTenant.publicFolder.id,
          [publicTenant.loggedinUser],
          () => {
            FoldersTestUtil.assertShareFolderSucceeds(
              publicTenant.adminRestContext,
              publicTenant.publicUser.restContext,
              publicTenant.loggedinFolder.id,
              [publicTenant.loggedinUser],
              () => {
                FoldersTestUtil.assertShareFolderFails(
                  publicTenant.adminRestContext,
                  publicTenant.publicUser.restContext,
                  publicTenant.privateFolder.id,
                  [publicTenant.loggedinUser.user.id],
                  401,
                  () => {
                    // Ensure regular user cannot share with user profiles with which they cannot interact
                    FoldersTestUtil.assertShareFolderFails(
                      publicTenant.adminRestContext,
                      publicTenant.publicUser.restContext,
                      publicTenant.loggedinFolder.id,
                      [publicTenant.privateUser.user.id],
                      401,
                      () => {
                        FoldersTestUtil.assertShareFolderFails(
                          publicTenant.adminRestContext,
                          publicTenant.publicUser.restContext,
                          publicTenant.loggedinFolder.id,
                          [publicTenant1.publicUser.user.id],
                          401,
                          () => {
                            FoldersTestUtil.assertShareFolderFails(
                              publicTenant.adminRestContext,
                              publicTenant.publicUser.restContext,
                              publicTenant.loggedinFolder.id,
                              [publicTenant1.loggedinUser.user.id],
                              401,
                              () => {
                                FoldersTestUtil.assertShareFolderFails(
                                  publicTenant.adminRestContext,
                                  publicTenant.publicUser.restContext,
                                  publicTenant.loggedinFolder.id,
                                  [publicTenant1.privateUser.user.id],
                                  401,
                                  () => {
                                    FoldersTestUtil.assertShareFolderFails(
                                      publicTenant.adminRestContext,
                                      publicTenant.publicUser.restContext,
                                      publicTenant.loggedinFolder.id,
                                      [privateTenant.publicUser.user.id],
                                      401,
                                      () => {
                                        FoldersTestUtil.assertShareFolderFails(
                                          publicTenant.adminRestContext,
                                          publicTenant.publicUser.restContext,
                                          publicTenant.loggedinFolder.id,
                                          [privateTenant.loggedinUser.user.id],
                                          401,
                                          () => {
                                            return FoldersTestUtil.assertShareFolderFails(
                                              publicTenant.adminRestContext,
                                              publicTenant.publicUser.restContext,
                                              publicTenant.loggedinFolder.id,
                                              [privateTenant.privateUser.user.id],
                                              401,
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
     * Test that verifies authorization of sharing a folder for a regular (non-member) user of a different tenant
     */
    it('verify sharing authorization for a cross-tenant user', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1 /* , privateTenant */) => {
        // Ensure regular cross-tenant user can only share public folders of another tenant
        FoldersTestUtil.assertShareFolderSucceeds(
          publicTenant.adminRestContext,
          publicTenant1.publicUser.restContext,
          publicTenant.publicFolder.id,
          [publicTenant.publicUser],
          () => {
            FoldersTestUtil.assertShareFolderFails(
              publicTenant.adminRestContext,
              publicTenant1.publicUser.restContext,
              publicTenant.loggedinFolder.id,
              [publicTenant.publicUser.user.id],
              401,
              () => {
                return FoldersTestUtil.assertShareFolderFails(
                  publicTenant.adminRestContext,
                  publicTenant1.publicUser.restContext,
                  publicTenant.privateFolder.id,
                  [publicTenant.publicUser.user.id],
                  401,
                  callback
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies authorization of sharing a folder for a manager user
     */
    it('verify sharing authorization for a manager user', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1, privateTenant) => {
        // Make the public user a manager of the private folder
        FoldersTestUtil.assertUpdateFolderMembersSucceeds(
          publicTenant.adminRestContext,
          publicTenant.adminRestContext,
          publicTenant.privateFolder.id,
          _memberUpdate(publicTenant.publicUser, 'manager'),
          () => {
            // Ensure manager user can share all items in own tenant
            FoldersTestUtil.assertShareFolderSucceeds(
              publicTenant.adminRestContext,
              publicTenant.publicUser.restContext,
              publicTenant.publicFolder.id,
              [publicTenant.loggedinUser],
              () => {
                FoldersTestUtil.assertShareFolderSucceeds(
                  publicTenant.adminRestContext,
                  publicTenant.publicUser.restContext,
                  publicTenant.loggedinFolder.id,
                  [publicTenant.loggedinUser],
                  () => {
                    FoldersTestUtil.assertShareFolderSucceeds(
                      publicTenant.adminRestContext,
                      publicTenant.publicUser.restContext,
                      publicTenant.privateFolder.id,
                      [publicTenant.loggedinUser],
                      () => {
                        // Ensure manager user cannot share with user profiles to which they cannot interact
                        FoldersTestUtil.assertShareFolderFails(
                          publicTenant.adminRestContext,
                          publicTenant.publicUser.restContext,
                          publicTenant.privateFolder.id,
                          [publicTenant.privateUser.user.id],
                          401,
                          () => {
                            FoldersTestUtil.assertShareFolderSucceeds(
                              publicTenant.adminRestContext,
                              publicTenant.publicUser.restContext,
                              publicTenant.privateFolder.id,
                              [publicTenant1.publicUser],
                              () => {
                                FoldersTestUtil.assertShareFolderFails(
                                  publicTenant.adminRestContext,
                                  publicTenant.publicUser.restContext,
                                  publicTenant.privateFolder.id,
                                  [publicTenant1.loggedinUser.user.id],
                                  401,
                                  () => {
                                    FoldersTestUtil.assertShareFolderFails(
                                      publicTenant.adminRestContext,
                                      publicTenant.publicUser.restContext,
                                      publicTenant.privateFolder.id,
                                      [publicTenant1.privateUser.user.id],
                                      401,
                                      () => {
                                        FoldersTestUtil.assertShareFolderFails(
                                          publicTenant.adminRestContext,
                                          publicTenant.publicUser.restContext,
                                          publicTenant.privateFolder.id,
                                          [privateTenant.publicUser.user.id],
                                          401,
                                          () => {
                                            FoldersTestUtil.assertShareFolderFails(
                                              publicTenant.adminRestContext,
                                              publicTenant.publicUser.restContext,
                                              publicTenant.privateFolder.id,
                                              [privateTenant.loggedinUser.user.id],
                                              401,
                                              () => {
                                                return FoldersTestUtil.assertShareFolderFails(
                                                  publicTenant.adminRestContext,
                                                  publicTenant.publicUser.restContext,
                                                  publicTenant.privateFolder.id,
                                                  [privateTenant.privateUser.user.id],
                                                  401,
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
      });
    });

    /**
     * Test that verifies authorization of sharing a folder for an administrative user
     */
    it('verify sharing authorization for an admin user', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1, privateTenant) => {
        // Ensure admin user can share all items in own tenant
        FoldersTestUtil.assertShareFolderSucceeds(
          publicTenant.adminRestContext,
          publicTenant.adminRestContext,
          publicTenant.publicFolder.id,
          [publicTenant.loggedinUser],
          () => {
            FoldersTestUtil.assertShareFolderSucceeds(
              publicTenant.adminRestContext,
              publicTenant.adminRestContext,
              publicTenant.loggedinFolder.id,
              [publicTenant.loggedinUser],
              () => {
                FoldersTestUtil.assertShareFolderSucceeds(
                  publicTenant.adminRestContext,
                  publicTenant.adminRestContext,
                  publicTenant.privateFolder.id,
                  [publicTenant.loggedinUser],
                  () => {
                    // Ensure admin user cannot share with user profiles to which they cannot interact
                    FoldersTestUtil.assertShareFolderSucceeds(
                      publicTenant.adminRestContext,
                      publicTenant.adminRestContext,
                      publicTenant.privateFolder.id,
                      [publicTenant.privateUser],
                      () => {
                        FoldersTestUtil.assertShareFolderSucceeds(
                          publicTenant.adminRestContext,
                          publicTenant.adminRestContext,
                          publicTenant.privateFolder.id,
                          [publicTenant1.publicUser],
                          () => {
                            FoldersTestUtil.assertShareFolderFails(
                              publicTenant.adminRestContext,
                              publicTenant.adminRestContext,
                              publicTenant.privateFolder.id,
                              [publicTenant1.loggedinUser.user.id],
                              401,
                              () => {
                                FoldersTestUtil.assertShareFolderFails(
                                  publicTenant.adminRestContext,
                                  publicTenant.adminRestContext,
                                  publicTenant.privateFolder.id,
                                  [publicTenant1.privateUser.user.id],
                                  401,
                                  () => {
                                    FoldersTestUtil.assertShareFolderFails(
                                      publicTenant.adminRestContext,
                                      publicTenant.adminRestContext,
                                      publicTenant.privateFolder.id,
                                      [privateTenant.publicUser.user.id],
                                      401,
                                      () => {
                                        FoldersTestUtil.assertShareFolderFails(
                                          publicTenant.adminRestContext,
                                          publicTenant.adminRestContext,
                                          publicTenant.privateFolder.id,
                                          [privateTenant.loggedinUser.user.id],
                                          401,
                                          () => {
                                            return FoldersTestUtil.assertShareFolderFails(
                                              publicTenant.adminRestContext,
                                              publicTenant.adminRestContext,
                                              publicTenant.privateFolder.id,
                                              [privateTenant.privateUser.user.id],
                                              401,
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
  });

  describe('Get Folder Members', () => {
    /**
     * Test that verifies getting the members of a folder will return all viewers and managers of the folder
     */
    it('verify get folder members gets all viewers and managers', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 16, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          users = values(users);

          const managerUsers = users.slice(0, 8);
          const memberUpdates = {};
          const expectedMembership = {};
          forEach((managerUser) => {
            expectedMembership[managerUser.user.id] = 'manager';
            memberUpdates[managerUser.user.id] = _.extend({}, managerUser, { role: 'manager' });
          }, managerUsers);

          // Apply the roles
          FoldersTestUtil.assertUpdateFolderMembersSucceeds(
            asCambridgeTenantAdmin,
            asCambridgeTenantAdmin,
            folder.id,
            memberUpdates,
            () => {
              // Ensure all the users have been set
              return FoldersTestUtil.assertFullFolderMembersEquals(
                mrvisser.restContext,
                folder.id,
                expectedMembership,
                callback
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies validation of getting folder members
     */
    it('verify get folder members validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 16, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        FoldersTestUtil.generateTestFolders(asCambridgeTenantAdmin, 1, (folder) => {
          const memberUpdates = {};
          _.each(users, (eachUser) => {
            memberUpdates[eachUser.user.id] = _.extend({}, eachUser, { role: 'viewer' });
          });

          FoldersTestUtil.assertUpdateFolderMembersSucceeds(
            asCambridgeTenantAdmin,
            asCambridgeTenantAdmin,
            folder.id,
            memberUpdates,
            () => {
              // Ensure the folder id must be a valid resource id
              FoldersTestUtil.assertGetFolderMembersFails(mrvisser.restContext, 'notavalidid', null, null, 400, () => {
                // Ensure the folder must exist
                FoldersTestUtil.assertGetFolderMembersFails(
                  mrvisser.restContext,
                  'x:oaetest:nonexistingid',
                  null,
                  null,
                  404,
                  () => {
                    // Ensure limit has a minimum of 1
                    FoldersTestUtil.assertGetFolderMembersSucceeds(
                      mrvisser.restContext,
                      folder.id,
                      null,
                      0,
                      (result) => {
                        assert.strictEqual(result.results.length, 1);

                        // Ensure limit defaults to 10
                        FoldersTestUtil.assertGetFolderMembersSucceeds(
                          mrvisser.restContext,
                          folder.id,
                          null,
                          null,
                          (result) => {
                            assert.strictEqual(result.results.length, 10);

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
        });
      });
    });

    /**
     * Test that verifies authorization of getting folder members
     */
    it('verify get folder members authorization', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1) => {
        // Ensure access for anonymous user
        FoldersTestUtil.assertGetFolderMembersSucceeds(
          publicTenant.anonymousRestContext,
          publicTenant.publicFolder.id,
          null,
          null,
          () => {
            FoldersTestUtil.assertGetFolderMembersFails(
              publicTenant.anonymousRestContext,
              publicTenant.loggedinFolder.id,
              null,
              null,
              401,
              () => {
                FoldersTestUtil.assertGetFolderMembersFails(
                  publicTenant.anonymousRestContext,
                  publicTenant.privateFolder.id,
                  null,
                  null,
                  401,
                  () => {
                    // Ensure access for authenticated user
                    FoldersTestUtil.assertGetFolderMembersSucceeds(
                      publicTenant.publicUser.restContext,
                      publicTenant.publicFolder.id,
                      null,
                      null,
                      () => {
                        FoldersTestUtil.assertGetFolderMembersSucceeds(
                          publicTenant.publicUser.restContext,
                          publicTenant.loggedinFolder.id,
                          null,
                          null,
                          () => {
                            FoldersTestUtil.assertGetFolderMembersFails(
                              publicTenant.publicUser.restContext,
                              publicTenant.privateFolder.id,
                              null,
                              null,
                              401,
                              () => {
                                // Ensure access for admin user
                                FoldersTestUtil.assertGetFolderMembersSucceeds(
                                  publicTenant.adminRestContext,
                                  publicTenant.publicFolder.id,
                                  null,
                                  null,
                                  () => {
                                    FoldersTestUtil.assertGetFolderMembersSucceeds(
                                      publicTenant.adminRestContext,
                                      publicTenant.loggedinFolder.id,
                                      null,
                                      null,
                                      () => {
                                        FoldersTestUtil.assertGetFolderMembersSucceeds(
                                          publicTenant.adminRestContext,
                                          publicTenant.privateFolder.id,
                                          null,
                                          null,
                                          () => {
                                            // Ensure access for cross-tenant user
                                            FoldersTestUtil.assertGetFolderMembersSucceeds(
                                              publicTenant1.publicUser.restContext,
                                              publicTenant.publicFolder.id,
                                              null,
                                              null,
                                              () => {
                                                FoldersTestUtil.assertGetFolderMembersFails(
                                                  publicTenant1.publicUser.restContext,
                                                  publicTenant.loggedinFolder.id,
                                                  null,
                                                  null,
                                                  401,
                                                  () => {
                                                    FoldersTestUtil.assertGetFolderMembersFails(
                                                      publicTenant1.publicUser.restContext,
                                                      publicTenant.privateFolder.id,
                                                      null,
                                                      null,
                                                      401,
                                                      () => {
                                                        // Ensure access for cross-tenant admin user
                                                        FoldersTestUtil.assertGetFolderMembersSucceeds(
                                                          publicTenant1.adminRestContext,
                                                          publicTenant.publicFolder.id,
                                                          null,
                                                          null,
                                                          () => {
                                                            FoldersTestUtil.assertGetFolderMembersFails(
                                                              publicTenant1.adminRestContext,
                                                              publicTenant.loggedinFolder.id,
                                                              null,
                                                              null,
                                                              401,
                                                              () => {
                                                                FoldersTestUtil.assertGetFolderMembersFails(
                                                                  publicTenant1.adminRestContext,
                                                                  publicTenant.privateFolder.id,
                                                                  null,
                                                                  null,
                                                                  401,
                                                                  () => {
                                                                    // Give a same-tenant user access to the private folder
                                                                    FoldersTestUtil.assertShareFolderSucceeds(
                                                                      publicTenant.adminRestContext,
                                                                      publicTenant.adminRestContext,
                                                                      publicTenant.privateFolder.id,
                                                                      [publicTenant.publicUser],
                                                                      () => {
                                                                        // Ensure same-tenant user with access can now view the private folder members
                                                                        FoldersTestUtil.assertGetFolderMembersSucceeds(
                                                                          publicTenant.publicUser.restContext,
                                                                          publicTenant.privateFolder.id,
                                                                          null,
                                                                          null,
                                                                          () => {
                                                                            // Give a cross-tenant user access to the loggedin and private folders
                                                                            FoldersTestUtil.assertShareFolderSucceeds(
                                                                              publicTenant.adminRestContext,
                                                                              publicTenant.adminRestContext,
                                                                              publicTenant.loggedinFolder.id,
                                                                              [publicTenant1.publicUser],
                                                                              () => {
                                                                                FoldersTestUtil.assertShareFolderSucceeds(
                                                                                  publicTenant.adminRestContext,
                                                                                  publicTenant.adminRestContext,
                                                                                  publicTenant.privateFolder.id,
                                                                                  [publicTenant1.publicUser],
                                                                                  () => {
                                                                                    // Ensure the cross-tenant user can now see the loggedin and private folders with explicit access
                                                                                    FoldersTestUtil.assertGetFolderMembersSucceeds(
                                                                                      publicTenant1.publicUser
                                                                                        .restContext,
                                                                                      publicTenant.loggedinFolder.id,
                                                                                      null,
                                                                                      null,
                                                                                      () => {
                                                                                        FoldersTestUtil.assertGetFolderMembersSucceeds(
                                                                                          publicTenant1.publicUser
                                                                                            .restContext,
                                                                                          publicTenant.privateFolder.id,
                                                                                          null,
                                                                                          null,
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
     * Test that verififes paging through the list of folder members
     */
    it('verify get folder members paging', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 16, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          // Make all 16 users (except mrvisser, of course) a viewer
          const memberUpdates = {};
          _.each(users, (eachUser) => {
            if (eachUser.user.id !== mrvisser.user.id) {
              memberUpdates[eachUser.user.id] = _.extend({}, eachUser, { role: 'viewer' });
            }
          });

          FoldersTestUtil.assertUpdateFolderMembersSucceeds(
            mrvisser.restContext,
            mrvisser.restContext,
            folder.id,
            memberUpdates,
            () => {
              // Fetch batches of 1 and ensure we get them all
              FoldersTestUtil.getAllFolderMembers(
                mrvisser.restContext,
                folder.id,
                { batchSize: 1 },
                (members, responses) => {
                  assert.strictEqual(members.length, 16);

                  // Ensure all members came from the users folder and that they all have the proper role
                  _.each(members, (member) => {
                    assert.ok(find((eachUser) => eachUser.user.id === member.profile.id, users));
                    if (member.profile.id === mrvisser.user.id) {
                      assert.strictEqual(member.role, 'manager');
                    } else {
                      assert.strictEqual(member.role, 'viewer');
                    }
                  });

                  // Ensure we made 17 requests to get the users and they all had exactly 1 member (the 17th request
                  // is an empty one since `nextToken` does not use any look-ahead)
                  assert.strictEqual(responses.length, 17);
                  _.each(responses.slice(0, -1), (response) => {
                    assert.strictEqual(response.results.length, 1);
                  });
                  assert.strictEqual(_.last(responses).results.length, 0);
                  assert.strictEqual(_.last(responses).nextToken, null);

                  // Fetch batches of 3 and ensure we get them all
                  FoldersTestUtil.getAllFolderMembers(
                    mrvisser.restContext,
                    folder.id,
                    { batchSize: 3 },
                    (members, responses) => {
                      assert.strictEqual(members.length, 16);

                      // Ensure all members came from the users folder and that they all have the proper role
                      _.each(members, (member) => {
                        assert.ok(find((eachUser) => eachUser.user.id === member.profile.id, users));
                        if (member.profile.id === mrvisser.user.id) {
                          assert.strictEqual(member.role, 'manager');
                        } else {
                          assert.strictEqual(member.role, 'viewer');
                        }
                      });

                      // Ensure we made 6 requests to get the users and they all had the proper amount
                      // of users
                      assert.strictEqual(responses.length, 6);

                      // All but the last have 3
                      _.each(responses.slice(0, -1), (response) => {
                        assert.strictEqual(response.results.length, 3);
                      });

                      // The last has 1 member and a null `nextToken`
                      assert.strictEqual(_.last(responses).results.length, 1);
                      assert.strictEqual(_.last(responses).nextToken, null);

                      // Fetch a batch of 16 and ensure we get them all
                      FoldersTestUtil.getAllFolderMembers(
                        mrvisser.restContext,
                        folder.id,
                        { batchSize: 16 },
                        (members, responses) => {
                          assert.strictEqual(members.length, 16);

                          // Ensure all members came from the users folder and that they all have the proper role
                          _.each(members, (member) => {
                            assert.ok(find((eachUser) => eachUser.user.id === member.profile.id, users));
                            if (member.profile.id === mrvisser.user.id) {
                              assert.strictEqual(member.role, 'manager');
                            } else {
                              assert.strictEqual(member.role, 'viewer');
                            }
                          });

                          // Ensure we made 1 request to get the users and it had 16. The second request is an empty
                          // one since `nextToken` does not use any look-ahead
                          assert.strictEqual(responses.length, 2);
                          assert.strictEqual(responses[0].results.length, 16);
                          assert.strictEqual(responses[1].results.length, 0);
                          assert.strictEqual(responses[1].nextToken, null);
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

    /**
     * Test that verifies private user profiles are scrubbed in content members lists
     */
    it('verify folder members are scrubbed in the members list', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant) => {
        // Put a private user in the members list of a folder
        FoldersTestUtil.assertShareFolderSucceeds(
          publicTenant.adminRestContext,
          publicTenant.adminRestContext,
          publicTenant.publicFolder.id,
          [publicTenant.privateUser, publicTenant.publicUser],
          () => {
            // The public user now looks at the members list of the public folder
            FoldersTestUtil.getAllFolderMembers(
              publicTenant.publicUser.restContext,
              publicTenant.publicFolder.id,
              null,
              (members) => {
                // There should be 2 members, get the private user and ensure the profile is scrubbed
                const privateMember = _.chain(members).pluck('profile').findWhere({ visibility: 'private' }).value();

                assert.strictEqual(privateMember.displayName, publicTenant.privateUser.user.publicAlias);
                assert.ok(publicTenant.privateUser.user.profilePath);
                assert.ok(!privateMember.profilePath);
                return callback();
              }
            );
          }
        );
      });
    });
  });

  describe('Set Folder Members', () => {
    /**
     * Test that verifies viewers and managers can be set on and removed from a folder
     */
    it('verify viewers and managers can be set on and removed from a folder', (callback) => {
      // Create test users and a folder to test with
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: bert } = users;

        FoldersTestUtil.assertCreateFolderSucceeds(
          mrvisser.restContext,
          'test',
          'test',
          'private',
          null,
          null,
          (folder) => {
            // Ensure Bert can be made a viewer
            FoldersTestUtil.assertUpdateFolderMembersSucceeds(
              mrvisser.restContext,
              mrvisser.restContext,
              folder.id,
              _memberUpdate(bert),
              () => {
                // Ensure Bert can view the folder
                FoldersTestUtil.assertGetFolderSucceeds(bert.restContext, folder.id, () => {
                  // Ensure Bert can be removed from the members list
                  FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                    mrvisser.restContext,
                    mrvisser.restContext,
                    folder.id,
                    _memberUpdate(bert, false),
                    () => {
                      // Ensure Bert can no longer view the folder
                      FoldersTestUtil.assertGetFolderFails(bert.restContext, folder.id, 401, () => {
                        // Ensure Bert can be made a manager
                        FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                          mrvisser.restContext,
                          mrvisser.restContext,
                          folder.id,
                          _memberUpdate(bert, 'manager'),
                          () => {
                            // Ensure Bert can view the folder once again
                            FoldersTestUtil.assertGetFolderSucceeds(bert.restContext, folder.id, () => {
                              // Ensure Bert can now demote mrvisser to viewer, O noez!
                              FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                                bert.restContext,
                                bert.restContext,
                                folder.id,
                                _memberUpdate(mrvisser),
                                () => {
                                  // Ensure mrvisser can no longer update the permissions
                                  return FoldersTestUtil.assertUpdateFolderMembersFails(
                                    bert.restContext,
                                    mrvisser.restContext,
                                    folder.id,
                                    _memberUpdate(bert.user.id, 'manager'),
                                    401,
                                    callback
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
          }
        );
      });
    });

    /**
     * Test that verifies a folder cannot be left without a manager
     */
    it('verify a folder cannot be left with no managers', (callback) => {
      // Create test users and a folder to test with
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 5, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: bert } = users;

        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          // Try and make all the users viewer, including the creator mrvisser
          const memberUpdates = {};
          _.each(users, (eachUser) => {
            memberUpdates[eachUser.user.id] = 'viewer';
          });

          FoldersTestUtil.assertUpdateFolderMembersFails(
            mrvisser.restContext,
            mrvisser.restContext,
            folder.id,
            memberUpdates,
            400,
            () => {
              memberUpdates[bert.user.id] = 'manager';

              // Build an update that sets bert as manager and mrvisser as viewer
              const memberUpdateInfos = {};
              _.each(users, (eachUser) => {
                memberUpdateInfos[eachUser.user.id] = _.extend({}, eachUser, { role: 'viewer' });
              });
              memberUpdateInfos[bert.user.id].role = 'manager';

              // Ensure mrvisser can still update the members, and changing bert to manager while demoting himself is fair game
              FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                asCambridgeTenantAdmin,
                mrvisser.restContext,
                folder.id,
                memberUpdateInfos,
                () => {
                  // Ensure bert cannot remove himself as that would now result in no manager
                  return FoldersTestUtil.assertUpdateFolderMembersFails(
                    bert.restContext,
                    bert.restContext,
                    folder.id,
                    _memberUpdate(bert.user.id, false),
                    400,
                    callback
                  );
                }
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies a viewer cannot promote themselves to manager
     */
    it('verify a viewer cannot promote themselves to manager', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: bert } = users;

        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          // Make Bert a member
          FoldersTestUtil.assertUpdateFolderMembersSucceeds(
            mrvisser.restContext,
            mrvisser.restContext,
            folder.id,
            _memberUpdate(bert),
            () => {
              // Ensure Bert can't promote himself to manager
              return FoldersTestUtil.assertUpdateFolderMembersFails(
                mrvisser.restContext,
                bert.restContext,
                folder.id,
                _memberUpdate(bert.user.id, 'manager'),
                401,
                callback
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies validation of setting folder members
     */
    it('verify set folder members validation', (callback) => {
      // Generate a test user and folder for testing validation
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: bert } = users;

        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          // Ensure folder id must be a valid resource id
          FoldersTestUtil.assertUpdateFolderMembersFails(
            mrvisser.restContext,
            mrvisser.restContext,
            'notavalidid',
            _memberUpdate(bert.user.id),
            400,
            () => {
              // Ensure folder id must exist
              FoldersTestUtil.assertUpdateFolderMembersFails(
                mrvisser.restContext,
                mrvisser.restContext,
                'x:oaetest:nonexistingid',
                _memberUpdate(bert.user.id),
                404,
                () => {
                  // Ensure one member update must be specified
                  FoldersTestUtil.assertUpdateFolderMembersFails(
                    mrvisser.restContext,
                    mrvisser.restContext,
                    folder.id,
                    {},
                    400,
                    () => {
                      // Ensure members must be valid principal ids
                      FoldersTestUtil.assertUpdateFolderMembersFails(
                        mrvisser.restContext,
                        mrvisser.restContext,
                        folder.id,
                        { notavalidid: 'viewer' },
                        400,
                        () => {
                          FoldersTestUtil.assertUpdateFolderMembersFails(
                            mrvisser.restContext,
                            mrvisser.restContext,
                            folder.id,
                            { 'c:oaetest:notaprincipalid': 'viewer' },
                            400,
                            () => {
                              // Ensure members must be existing principal ids
                              FoldersTestUtil.assertUpdateFolderMembersFails(
                                mrvisser.restContext,
                                mrvisser.restContext,
                                folder.id,
                                { 'u:oaetest:nonexistingid': 'viewer' },
                                400,
                                () => {
                                  FoldersTestUtil.assertUpdateFolderMembersFails(
                                    mrvisser.restContext,
                                    mrvisser.restContext,
                                    folder.id,
                                    { 'g:oaetest:nonexistingid': 'viewer' },
                                    400,
                                    () => {
                                      // Sanity check the base input works
                                      return FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                                        mrvisser.restContext,
                                        mrvisser.restContext,
                                        folder.id,
                                        _memberUpdate(bert),
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
      });
    });

    /**
     * Test that verifies anonymous users cannot set members on a folder
     */
    it('verify an anonymous user cannot set folder members', (callback) => {
      // Generate a test user and folder to test with
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: bert } = users;

        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          // Ensure anonymous cannot set the members
          FoldersTestUtil.assertUpdateFolderMembersFails(
            mrvisser.restContext,
            asCambridgeAnonymousUser,
            folder.id,
            _memberUpdate(bert.user.id),
            401,
            () => {
              // Sanity check mrvisser can perform the same share
              return FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                mrvisser.restContext,
                mrvisser.restContext,
                folder.id,
                _memberUpdate(bert),
                callback
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies authorization of setting folder members as an administrative user
     */
    it('verify set folder members authorization for an admin user', (callback) => {
      // Setup folders and users for different visibilities and tenants
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1, privateTenant) => {
        // Create an extra folder that is not managed by an admin user
        FoldersTestUtil.generateTestFolders(publicTenant.publicUser.restContext, 1, (folder) => {
          // Ensure admin can set members a folder they don't explicitly manage
          FoldersTestUtil.assertUpdateFolderMembersSucceeds(
            publicTenant.publicUser.restContext,
            publicTenant.adminRestContext,
            folder.id,
            _memberUpdate(publicTenant.loggedinUser, 'manager'),
            () => {
              // Ensure admin cannot set members for user profiles with which they cannot interact
              FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                publicTenant.adminRestContext,
                publicTenant.adminRestContext,
                publicTenant.loggedinFolder.id,
                _memberUpdate(publicTenant.privateUser),
                () => {
                  FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                    publicTenant.adminRestContext,
                    publicTenant.adminRestContext,
                    publicTenant.loggedinFolder.id,
                    _memberUpdate(publicTenant1.publicUser),
                    () => {
                      FoldersTestUtil.assertUpdateFolderMembersFails(
                        publicTenant.adminRestContext,
                        publicTenant.adminRestContext,
                        publicTenant.loggedinFolder.id,
                        _memberUpdate(publicTenant1.loggedinUser.user.id),
                        401,
                        () => {
                          FoldersTestUtil.assertUpdateFolderMembersFails(
                            publicTenant.adminRestContext,
                            publicTenant.adminRestContext,
                            publicTenant.loggedinFolder.id,
                            _memberUpdate(publicTenant1.privateUser.user.id),
                            401,
                            () => {
                              FoldersTestUtil.assertUpdateFolderMembersFails(
                                publicTenant.adminRestContext,
                                publicTenant.adminRestContext,
                                publicTenant.loggedinFolder.id,
                                _memberUpdate(privateTenant.publicUser.user.id),
                                401,
                                () => {
                                  FoldersTestUtil.assertUpdateFolderMembersFails(
                                    publicTenant.adminRestContext,
                                    publicTenant.adminRestContext,
                                    publicTenant.loggedinFolder.id,
                                    _memberUpdate(privateTenant.loggedinUser.user.id),
                                    401,
                                    () => {
                                      return FoldersTestUtil.assertUpdateFolderMembersFails(
                                        publicTenant.adminRestContext,
                                        publicTenant.adminRestContext,
                                        publicTenant.loggedinFolder.id,
                                        _memberUpdate(privateTenant.privateUser.user.id),
                                        401,
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
      });
    });

    /**
     * Test that verifies authorization of setting members on a folder as a regular user
     */
    it('verify set folder members authorization for a regular user', (callback) => {
      // Setup folders and users for different visibilities and tenants
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1, privateTenant) => {
        // Ensure the user cannot set members a folder they don't explicitly manage
        FoldersTestUtil.assertUpdateFolderMembersFails(
          publicTenant.adminRestContext,
          publicTenant.publicUser.restContext,
          publicTenant.publicFolder.id,
          _memberUpdate(publicTenant.loggedinUser.user.id),
          401,
          () => {
            // Make the user a viewer and ensure they still can't set permissions
            FoldersTestUtil.assertUpdateFolderMembersSucceeds(
              publicTenant.adminRestContext,
              publicTenant.adminRestContext,
              publicTenant.publicFolder.id,
              _memberUpdate(publicTenant.publicUser),
              () => {
                FoldersTestUtil.assertUpdateFolderMembersFails(
                  publicTenant.adminRestContext,
                  publicTenant.publicUser.restContext,
                  publicTenant.publicFolder.id,
                  _memberUpdate(publicTenant.loggedinUser.user.id),
                  401,
                  () => {
                    // Make the user a manager so they can update permissions
                    FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                      publicTenant.adminRestContext,
                      publicTenant.adminRestContext,
                      publicTenant.publicFolder.id,
                      _memberUpdate(publicTenant.publicUser, 'manager'),
                      () => {
                        // Ensure the manager user cannot set members for user profiles with which they cannot interact
                        FoldersTestUtil.assertUpdateFolderMembersFails(
                          publicTenant.publicUser.restContext,
                          publicTenant.publicUser.restContext,
                          publicTenant.publicFolder.id,
                          _memberUpdate(publicTenant.privateUser.user.id),
                          401,
                          () => {
                            FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                              publicTenant.publicUser.restContext,
                              publicTenant.publicUser.restContext,
                              publicTenant.publicFolder.id,
                              _memberUpdate(publicTenant1.publicUser),
                              () => {
                                FoldersTestUtil.assertUpdateFolderMembersFails(
                                  publicTenant.publicUser.restContext,
                                  publicTenant.publicUser.restContext,
                                  publicTenant.publicFolder.id,
                                  _memberUpdate(publicTenant1.loggedinUser.user.id),
                                  401,
                                  () => {
                                    FoldersTestUtil.assertUpdateFolderMembersFails(
                                      publicTenant.publicUser.restContext,
                                      publicTenant.publicUser.restContext,
                                      publicTenant.publicFolder.id,
                                      _memberUpdate(publicTenant1.privateUser.user.id),
                                      401,
                                      () => {
                                        FoldersTestUtil.assertUpdateFolderMembersFails(
                                          publicTenant.publicUser.restContext,
                                          publicTenant.publicUser.restContext,
                                          publicTenant.publicFolder.id,
                                          _memberUpdate(privateTenant.publicUser.user.id),
                                          401,
                                          () => {
                                            FoldersTestUtil.assertUpdateFolderMembersFails(
                                              publicTenant.publicUser.restContext,
                                              publicTenant.publicUser.restContext,
                                              publicTenant.publicFolder.id,
                                              _memberUpdate(privateTenant.loggedinUser.user.id),
                                              401,
                                              () => {
                                                return FoldersTestUtil.assertUpdateFolderMembersFails(
                                                  publicTenant.publicUser.restContext,
                                                  publicTenant.publicUser.restContext,
                                                  publicTenant.publicFolder.id,
                                                  _memberUpdate(privateTenant.privateUser.user.id),
                                                  401,
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
      });
    });
  });

  describe('Get Folders Library', () => {
    /**
     * Test that verifies getting a folders library returns the proper library visibility
     */
    it('verify users get the appropriate folders library visibility', (callback) => {
      // Generate users from a variety of tenants, as well as a library of public, loggedin and private folders for a user
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1) => {
        FoldersTestUtil.generateTestFoldersWithVisibility(
          publicTenant.publicUser.restContext,
          3,
          'public',
          (publicFolder1, publicFolder2, publicFolder3) => {
            FoldersTestUtil.generateTestFoldersWithVisibility(
              publicTenant.publicUser.restContext,
              3,
              'loggedin',
              (loggedinFolder1, loggedinFolder2, loggedinFolder3) => {
                FoldersTestUtil.generateTestFoldersWithVisibility(
                  publicTenant.publicUser.restContext,
                  3,
                  'private',
                  (privateFolder1, privateFolder2, privateFolder3) => {
                    const publicFolderIds = _.pluck([publicFolder1, publicFolder2, publicFolder3], 'id');
                    const loggedinFolderIds = _.pluck([loggedinFolder1, loggedinFolder2, loggedinFolder3], 'id');
                    const privateFolderIds = _.pluck([privateFolder1, privateFolder2, privateFolder3], 'id');

                    const expectedPublicFoldersLibraryIds = publicFolderIds.slice();
                    const expectedLoggedinFoldersLibraryIds = _.union(publicFolderIds, loggedinFolderIds);
                    const expectedPrivateFoldersLibraryIds = _.chain(publicFolderIds)
                      .union(loggedinFolderIds)
                      .union(privateFolderIds)
                      .value();

                    // Ensure the user themself gets the private library
                    FoldersTestUtil.assertFullFoldersLibraryEquals(
                      publicTenant.publicUser.restContext,
                      publicTenant.publicUser.user.id,
                      expectedPrivateFoldersLibraryIds,
                      false,
                      () => {
                        // Ensure admin gets the private library as well
                        FoldersTestUtil.assertFullFoldersLibraryEquals(
                          publicTenant.adminRestContext,
                          publicTenant.publicUser.user.id,
                          expectedPrivateFoldersLibraryIds,
                          false,
                          () => {
                            // Ensure authenticated user gets the loggedin library
                            FoldersTestUtil.assertFullFoldersLibraryEquals(
                              publicTenant.loggedinUser.restContext,
                              publicTenant.publicUser.user.id,
                              expectedLoggedinFoldersLibraryIds,
                              false,
                              () => {
                                // Ensure admin from another tenant gets the public library
                                FoldersTestUtil.assertFullFoldersLibraryEquals(
                                  publicTenant1.adminRestContext,
                                  publicTenant.publicUser.user.id,
                                  expectedPublicFoldersLibraryIds,
                                  false,
                                  () => {
                                    // Ensure authenticated user from another tenant gets the public library
                                    FoldersTestUtil.assertFullFoldersLibraryEquals(
                                      publicTenant1.publicUser.restContext,
                                      publicTenant.publicUser.user.id,
                                      expectedPublicFoldersLibraryIds,
                                      false,
                                      () => {
                                        // Ensure anonymous user gets the public library
                                        return FoldersTestUtil.assertFullFoldersLibraryEquals(
                                          publicTenant.anonymousRestContext,
                                          publicTenant.publicUser.user.id,
                                          expectedPublicFoldersLibraryIds,
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
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies authorization of getting a public user library
     */
    it('verify get folders library authorization for public user library', (callback) => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1) => {
        // Ensure authorization of public user library
        FoldersTestUtil.assertGetFoldersLibrarySucceeds(
          publicTenant.anonymousRestContext,
          publicTenant.publicUser.user.id,
          null,
          null,
          () => {
            FoldersTestUtil.assertGetFoldersLibrarySucceeds(
              publicTenant.adminRestContext,
              publicTenant.publicUser.user.id,
              null,
              null,
              () => {
                FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                  publicTenant.publicUser.restContext,
                  publicTenant.publicUser.user.id,
                  null,
                  null,
                  () => {
                    FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                      publicTenant.loggedinUser.restContext,
                      publicTenant.publicUser.user.id,
                      null,
                      null,
                      () => {
                        FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                          publicTenant1.publicUser.restContext,
                          publicTenant.publicUser.user.id,
                          null,
                          null,
                          () => {
                            FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                              publicTenant1.adminRestContext,
                              publicTenant.publicUser.user.id,
                              null,
                              null,
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
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies authorization of getting a loggedin user library
     */
    it('verify get folders library authorization for loggedin user library', (callback) => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1) => {
        // Ensure authorization of public user library
        FoldersTestUtil.assertGetFoldersLibraryFails(
          publicTenant.anonymousRestContext,
          publicTenant.loggedinUser.user.id,
          null,
          null,
          401,
          () => {
            FoldersTestUtil.assertGetFoldersLibrarySucceeds(
              publicTenant.adminRestContext,
              publicTenant.loggedinUser.user.id,
              null,
              null,
              () => {
                FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                  publicTenant.publicUser.restContext,
                  publicTenant.loggedinUser.user.id,
                  null,
                  null,
                  () => {
                    FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                      publicTenant.loggedinUser.restContext,
                      publicTenant.loggedinUser.user.id,
                      null,
                      null,
                      () => {
                        FoldersTestUtil.assertGetFoldersLibraryFails(
                          publicTenant1.publicUser.restContext,
                          publicTenant.loggedinUser.user.id,
                          null,
                          null,
                          401,
                          () => {
                            FoldersTestUtil.assertGetFoldersLibraryFails(
                              publicTenant1.adminRestContext,
                              publicTenant.loggedinUser.user.id,
                              null,
                              null,
                              401,
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
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies authorization of getting a private user library
     */
    it('verify get folders library authorization for private user library', (callback) => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1) => {
        // Ensure authorization of public user library
        FoldersTestUtil.assertGetFoldersLibraryFails(
          publicTenant.anonymousRestContext,
          publicTenant.privateUser.user.id,
          null,
          null,
          401,
          () => {
            FoldersTestUtil.assertGetFoldersLibrarySucceeds(
              publicTenant.adminRestContext,
              publicTenant.privateUser.user.id,
              null,
              null,
              () => {
                FoldersTestUtil.assertGetFoldersLibraryFails(
                  publicTenant.publicUser.restContext,
                  publicTenant.privateUser.user.id,
                  null,
                  null,
                  401,
                  () => {
                    FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                      publicTenant.privateUser.restContext,
                      publicTenant.privateUser.user.id,
                      null,
                      null,
                      () => {
                        FoldersTestUtil.assertGetFoldersLibraryFails(
                          publicTenant1.publicUser.restContext,
                          publicTenant.privateUser.user.id,
                          null,
                          null,
                          401,
                          () => {
                            FoldersTestUtil.assertGetFoldersLibraryFails(
                              publicTenant1.adminRestContext,
                              publicTenant.privateUser.user.id,
                              null,
                              null,
                              401,
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
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies validation of getting a folders library
     */
    it('verify get folders library validation', (callback) => {
      // Generate a user and give them more than 25 folders in their folders library
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;
        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 30, () => {
          // Ensure we must provide a valid and existing principal id
          FoldersTestUtil.assertGetFoldersLibraryFails(mrvisser.restContext, 'notavalidid', null, 15, 400, () => {
            FoldersTestUtil.assertGetFoldersLibraryFails(
              mrvisser.restContext,
              'c:oaetest:notaprincipalid',
              null,
              15,
              400,
              () => {
                FoldersTestUtil.assertGetFoldersLibraryFails(
                  mrvisser.restContext,
                  'g:oaetest:nonexistingid',
                  null,
                  15,
                  404,
                  () => {
                    FoldersTestUtil.assertGetFoldersLibraryFails(
                      mrvisser.restContext,
                      'u:oaetest:nonexistingid',
                      null,
                      15,
                      404,
                      () => {
                        // Ensure limit is greater than or equal to 1, less than or equal to 25, and defaults to 10
                        FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                          mrvisser.restContext,
                          mrvisser.user.id,
                          null,
                          0,
                          (result) => {
                            assert.strictEqual(result.results.length, 1);
                            FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                              mrvisser.restContext,
                              mrvisser.user.id,
                              null,
                              null,
                              (result) => {
                                assert.strictEqual(result.results.length, 12);
                                FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                                  mrvisser.restContext,
                                  mrvisser.user.id,
                                  null,
                                  100,
                                  (result) => {
                                    assert.strictEqual(result.results.length, 25);

                                    // Ensure the base input provides the expected results
                                    FoldersTestUtil.assertGetFoldersLibrarySucceeds(
                                      mrvisser.restContext,
                                      mrvisser.user.id,
                                      null,
                                      15,
                                      (result) => {
                                        assert.strictEqual(result.results.length, 15);
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

    /**
     * Test that verifies paging of the folders library
     */
    it('verify get folders library paging', (callback) => {
      // Generate a user and give them enough folders in their library to page through
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;
        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 16, () => {
          // Page items by 1 and ensure we get them all with the correct number of requests
          FoldersTestUtil.getAllFoldersInLibrary(
            mrvisser.restContext,
            mrvisser.user.id,
            { batchSize: 1 },
            (folders, responses) => {
              assert.strictEqual(folders.length, 16);

              // Ensure there are 16 responses for each request, plus 1 empty one to
              // indicate that the library items are exhausted
              assert.strictEqual(responses.length, 17);
              assert.strictEqual(_.last(responses).results.length, 0);
              assert.strictEqual(_.last(responses).nextToken, null);

              // Page items by 3 and ensure we get them all with the correct number of requests
              FoldersTestUtil.getAllFoldersInLibrary(
                mrvisser.restContext,
                mrvisser.user.id,
                { batchSize: 3 },
                (folders, responses) => {
                  assert.strictEqual(folders.length, 16);

                  // Ensure there are 6 responses for each request, where the final one
                  // has only 1 element and indicates the list is exhausted
                  assert.strictEqual(responses.length, 6);
                  assert.strictEqual(_.last(responses).results.length, 1);
                  assert.strictEqual(_.last(responses).nextToken, null);

                  // Page items by the full amount and ensure we get them all with the correct number of requests
                  FoldersTestUtil.getAllFoldersInLibrary(
                    mrvisser.restContext,
                    mrvisser.user.id,
                    { batchSize: 16 },
                    (folders, responses) => {
                      assert.strictEqual(folders.length, 16);

                      // Ensure there is 1 response for the request to get all, plus 1
                      // empty one that indicates the list is exhausted
                      assert.strictEqual(responses.length, 2);
                      assert.strictEqual(_.last(responses).results.length, 0);
                      assert.strictEqual(_.last(responses).nextToken, null);

                      // Page items by greater than the full amount and ensure we get them all with the correct number of requests
                      FoldersTestUtil.getAllFoldersInLibrary(
                        mrvisser.restContext,
                        mrvisser.user.id,
                        { batchSize: 17 },
                        (folders, responses) => {
                          assert.strictEqual(folders.length, 16);

                          // Ensure there is 1 response with all the folders
                          assert.strictEqual(responses.length, 1);
                          assert.strictEqual(_.last(responses).results.length, 16);
                          assert.strictEqual(_.last(responses).nextToken, null);
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

    /**
     * This test manually triggers an update for folder libraries as that codepath
     * does not get triggered due to timeconstraints in the tests
     */
    it('verify updating folder libraries', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: simong, 1: nico } = users;

        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'private',
          [nico],
          [],
          (folder) => {
            // Page items by 1 and ensure we get them all with the correct number of requests
            FoldersTestUtil.getAllFoldersInLibrary(simong.restContext, simong.user.id, { batchSize: 1 }, (folders) => {
              assert.strictEqual(folders.length, 1);
              assert.strictEqual(folders[0].id, folder.id);
              FoldersTestUtil.getAllFoldersInLibrary(nico.restContext, nico.user.id, { batchSize: 1 }, (folders) => {
                assert.strictEqual(folders.length, 1);
                assert.strictEqual(folders[0].id, folder.id);

                // Trigger a manual update
                FoldersFolderLibrary.update([simong.user.id, nico.user.id], folder, null, (error, newFolder) => {
                  assert.notExists(error);
                  assert.notStrictEqual(folder.lastModified, newFolder.lastModified);

                  // Assert the folders are still in the libraries
                  FoldersTestUtil.getAllFoldersInLibrary(
                    simong.restContext,
                    simong.user.id,
                    { batchSize: 1 },
                    (folders) => {
                      assert.strictEqual(folders.length, 1);
                      assert.strictEqual(folders[0].id, folder.id);
                      assert.strictEqual(folders[0].lastModified, newFolder.lastModified.toString());
                      FoldersTestUtil.getAllFoldersInLibrary(
                        nico.restContext,
                        nico.user.id,
                        { batchSize: 1 },
                        (folders) => {
                          assert.strictEqual(folders.length, 1);
                          assert.strictEqual(folders[0].id, folder.id);
                          assert.strictEqual(folders[0].lastModified, newFolder.lastModified.toString());

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

  describe('Get Managed Folders', () => {
    /**
     * Test that verifies that the folder the current user manages can be retrieved
     */
    it('verify get managed folders', (callback) => {
      // Generate 2 test users who each have a set of folders
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: simong, 1: nico } = users;

        FoldersTestUtil.generateTestFolders(simong.restContext, 1, (simonsFolder) => {
          FoldersTestUtil.generateTestFolders(nico.restContext, 1, (nicosFolder) => {
            // Nico makes Simon a viewer on his folder
            FoldersTestUtil.assertUpdateFolderMembersSucceeds(
              nico.restContext,
              nico.restContext,
              nicosFolder.id,
              _memberUpdate(simong),
              () => {
                // Only Simon's own folder should be returned as that's the only one he can manage
                RestAPI.Folders.getManagedFolders(simong.restContext, (error, folders) => {
                  assert.notExists(error);
                  assert.strictEqual(folders.results.length, 1);
                  assert.strictEqual(folders.results[0].id, simonsFolder.id);

                  // Nico makes Simon a manager
                  FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                    nico.restContext,
                    nico.restContext,
                    nicosFolder.id,
                    _memberUpdate(simong, 'manager'),
                    () => {
                      // Simon is now a manager of both folders
                      RestAPI.Folders.getManagedFolders(simong.restContext, (error, folders) => {
                        assert.notExists(error);
                        assert.strictEqual(folders.results.length, 2);
                        assert.ok(_.findWhere(folders.results, { id: simonsFolder.id }));
                        assert.ok(_.findWhere(folders.results, { id: nicosFolder.id }));

                        // Deleting the folder will cause it to remove from the managed folders list
                        FoldersTestUtil.assertDeleteFolderSucceeds(simong.restContext, simonsFolder.id, false, () => {
                          // Only Nico's folder should remain
                          RestAPI.Folders.getManagedFolders(simong.restContext, (error, folders) => {
                            assert.notExists(error);
                            assert.strictEqual(folders.results.length, 1);
                            assert.strictEqual(folders.results[0].id, nicosFolder.id);
                            return callback();
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
      });
    });

    /**
     * Test that verifies that validation for the managed folders endpoint
     */
    it('verify get managed folders validation', (callback) => {
      // Anonymous users cannot list their managed folders
      RestAPI.Folders.getManagedFolders(asCambridgeAnonymousUser, (error /* , folders */) => {
        assert.ok(error);
        assert.strictEqual(error.code, 401);
        return callback();
      });
    });
  });

  describe('Remove folder from library', () => {
    /**
     * Test that verifies that the parameters are validated when removing a folder from a library
     */
    it('verify remove folder from library validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;
        FoldersTestUtil.generateTestFolders(simong.restContext, 1, (folder) => {
          // Invalid principal id
          FoldersTestUtil.assertRemoveFolderFromLibraryFails(
            simong.restContext,
            'not a principal id',
            folder.id,
            400,
            () => {
              FoldersTestUtil.assertRemoveFolderFromLibraryFails(
                simong.restContext,
                'c:cam:bleh',
                folder.id,
                400,
                () => {
                  // Invalid folder id
                  FoldersTestUtil.assertRemoveFolderFromLibraryFails(
                    simong.restContext,
                    simong.user.id,
                    'not a folder id',
                    400,
                    () => {
                      FoldersTestUtil.assertRemoveFolderFromLibraryFails(
                        simong.restContext,
                        simong.user.id,
                        'f:cam:doesnotexist',
                        404,
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

    /**
     * Test that verifies the authorization of removing a folder from a principal's library
     */
    it('verify remove folder from library authorization', (callback) => {
      // Create some test users and a group
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: simong, 1: nico, 2: bert } = users;

        TestsUtil.generateTestGroups(simong.restContext, 1, (error, groups) => {
          assert.notExists(error);

          let { 0: group } = groups;
          group = group.group;
          const groupUpdates = {};
          groupUpdates[bert.user.id] = 'member';
          RestAPI.Group.setGroupMembers(simong.restContext, group.id, groupUpdates, (error_) => {
            assert.notExists(error_);

            // Greate a test folder that both simon and the group manage
            FoldersTestUtil.generateTestFolders(simong.restContext, 1, (folder) => {
              const memberUpdate = {};
              memberUpdate[group.id] = 'manager';
              FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                simong.restContext,
                simong.restContext,
                folder.id,
                memberUpdate,
                () => {
                  // Anonymous users cannot remove anything
                  FoldersTestUtil.assertRemoveFolderFromLibraryFails(
                    nico.restContext,
                    simong.user.id,
                    folder.id,
                    401,
                    () => {
                      FoldersTestUtil.assertRemoveFolderFromLibraryFails(
                        nico.restContext,
                        group.id,
                        folder.id,
                        401,
                        () => {
                          // An unrelated user should not be able to remove another user's or group's folder
                          FoldersTestUtil.assertRemoveFolderFromLibraryFails(
                            nico.restContext,
                            simong.user.id,
                            folder.id,
                            401,
                            () => {
                              FoldersTestUtil.assertRemoveFolderFromLibraryFails(
                                nico.restContext,
                                group.id,
                                folder.id,
                                401,
                                () => {
                                  // Although bert is a manager of the folder by virtue of being a member of the group,
                                  // he cannot remove the folder from Simon's library
                                  FoldersTestUtil.assertRemoveFolderFromLibraryFails(
                                    bert.restContext,
                                    simong.user.id,
                                    folder.id,
                                    401,
                                    () => {
                                      // He can also *not* remove the folder from the group's library as he is only a member of the group
                                      FoldersTestUtil.assertRemoveFolderFromLibraryFails(
                                        nico.restContext,
                                        group.id,
                                        folder.id,
                                        401,
                                        () => {
                                          // Tenant admins from other tenants cannot remove the folder from the principals their library
                                          FoldersTestUtil.assertRemoveFolderFromLibraryFails(
                                            asGeorgiaTenantAdmin,
                                            simong.user.id,
                                            folder.id,
                                            401,
                                            () => {
                                              FoldersTestUtil.assertRemoveFolderFromLibraryFails(
                                                asGeorgiaTenantAdmin,
                                                group.id,
                                                folder.id,
                                                401,
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
        });
      });
    });

    /**
     * Test that removing a folder from a library revokes access to all the content that was inside the folder
     */
    it('verify removing a folder from a library revokes access to all the content that was inside the folder', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: simong, 1: nico } = users;

        // Generate a test folder that both Simon and Nico manage
        FoldersTestUtil.generateTestFolders(simong.restContext, 1, (folder) => {
          const memberUpdate = {};
          memberUpdate[nico.user.id] = 'manager';
          FoldersTestUtil.assertUpdateFolderMembersSucceeds(
            simong.restContext,
            simong.restContext,
            folder.id,
            memberUpdate,
            () => {
              // Nico creates a private item and sticks it in the folder
              RestAPI.Content.createLink(
                nico.restContext,
                {
                  displayName: 'test',
                  description: 'test',
                  visibility: PRIVATE,
                  link: 'http://www.google.ca',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error, link) => {
                  assert.notExists(error);
                  FoldersTestUtil.assertAddContentItemsToFolderSucceeds(nico.restContext, folder.id, [link.id], () => {
                    // Simon should now be able to access the private item
                    RestAPI.Content.getContent(simong.restContext, link.id, (error, content) => {
                      assert.notExists(error);
                      assert.strictEqual(content.id, link.id);

                      // Simon removes the folder from his library
                      FoldersTestUtil.assertRemoveFolderFromLibrarySucceeds(
                        simong.restContext,
                        simong.user.id,
                        folder.id,
                        () => {
                          // Simon should no longer be able to access the private content item
                          RestAPI.Content.getContent(simong.restContext, link.id, (error /* , content */) => {
                            assert.strictEqual(error.code, 401);
                            return callback();
                          });
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
    });

    /**
     * Test that verifies that a folder cannot end up with 0 managers
     */
    it('verify a folder cannot end up with 0 managers', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;

        // Generate a test folder that only Simon manages
        FoldersTestUtil.generateTestFolders(simong.restContext, 1, (folder) => {
          // Simon cannot remove the folder from his library as that would leave it manager-less
          FoldersTestUtil.assertRemoveFolderFromLibraryFails(
            simong.restContext,
            simong.user.id,
            folder.id,
            400,
            callback
          );
        });
      });
    });
  });

  describe('Add Items to Folder', () => {
    /**
     * Test that verifies adding a single item to a folder succeeds
     */
    it('verify adding a single item to a folder', (callback) => {
      // Generate a user and give them a folder
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;
        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          // Create a content item that mrvisser will add to his folder
          RestAPI.Content.createLink(
            asCambridgeTenantAdmin,
            {
              displayName: 'test',
              description: 'test',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              // Ensure Mrvisser can add the item to his folder
              return FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                mrvisser.restContext,
                folder.id,
                [link.id],
                callback
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies adding multiple content items to a folder succeeds
     */
    it('verify adding multiple items to a folder', (callback) => {
      // Generate a user and give them a folder
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;
        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          // Create 5 content items to add to the folder
          RestAPI.Content.createLink(
            asCambridgeTenantAdmin,
            {
              displayName: 'test',
              description: 'test',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link1) => {
              assert.notExists(error);
              RestAPI.Content.createLink(
                asCambridgeTenantAdmin,
                {
                  displayName: 'test',
                  description: 'test',
                  visibility: PUBLIC,
                  link: 'http://www.google.ca',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error, link2) => {
                  assert.notExists(error);
                  RestAPI.Content.createLink(
                    asCambridgeTenantAdmin,
                    {
                      displayName: 'test',
                      description: 'test',
                      visibility: PUBLIC,
                      link: 'http://www.google.ca',
                      managers: NO_MANAGERS,
                      viewers: NO_VIEWERS,
                      folders: NO_FOLDERS
                    },
                    (error, link3) => {
                      assert.notExists(error);
                      RestAPI.Content.createLink(
                        asCambridgeTenantAdmin,
                        {
                          displayName: 'test',
                          description: 'test',
                          visibility: PUBLIC,
                          link: 'http://www.google.ca',
                          managers: NO_MANAGERS,
                          viewers: NO_VIEWERS,
                          folders: NO_FOLDERS
                        },
                        (error, link4) => {
                          assert.notExists(error);
                          RestAPI.Content.createLink(
                            asCambridgeTenantAdmin,
                            {
                              displayName: 'test',
                              description: 'test',
                              visibility: PUBLIC,
                              link: 'http://www.google.ca',
                              managers: NO_MANAGERS,
                              viewers: NO_VIEWERS,
                              folders: NO_FOLDERS
                            },
                            (error, link5) => {
                              assert.notExists(error);

                              // Ensure Mrvisser can add all the items to his folder
                              return FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                mrvisser.restContext,
                                folder.id,
                                [link1.id, link2.id, link3.id, link4.id, link5.id],
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
    });

    /**
     * Test that verifies both managers and administrators can add content items to a folder
     */
    it('verify only administrators and managers of folders can add content items to them', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1) => {
        RestAPI.User.getMe(publicTenant.adminRestContext, (error, publicTenantAdminMe) => {
          assert.notExists(error);

          // Ensure anonymous, regular user, admin from another tenant all cannot add a content item to the folder
          FoldersTestUtil.assertAddContentItemsToFolderFails(
            publicTenant.anonymousRestContext,
            publicTenant.publicFolder.id,
            [publicTenant.publicContent.id],
            401,
            () => {
              FoldersTestUtil.assertAddContentItemsToFolderFails(
                publicTenant.publicUser.restContext,
                publicTenant.publicFolder.id,
                [publicTenant.publicContent.id],
                401,
                () => {
                  FoldersTestUtil.assertAddContentItemsToFolderFails(
                    publicTenant1.adminRestContext,
                    publicTenant.publicFolder.id,
                    [publicTenant.publicContent.id],
                    401,
                    () => {
                      // Ensure the folder still has no items
                      FoldersTestUtil.getAllFolderContentItems(
                        publicTenant.adminRestContext,
                        publicTenant.publicFolder.id,
                        null,
                        (contentItems) => {
                          assert.ok(_.isEmpty(contentItems));

                          // Add public user as a manager of the folder and remove admin as a manager
                          const memberUpdates = _memberUpdate(publicTenant.publicUser, 'manager');
                          memberUpdates[publicTenantAdminMe.id] = false;
                          FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                            publicTenant.adminRestContext,
                            publicTenant.adminRestContext,
                            publicTenant.publicFolder.id,
                            memberUpdates,
                            () => {
                              // Ensure public user and admin can both add an item to the folder
                              FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                publicTenant.publicUser.restContext,
                                publicTenant.publicFolder.id,
                                [publicTenant.publicContent.id],
                                () => {
                                  FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                    publicTenant.adminRestContext,
                                    publicTenant.publicFolder.id,
                                    [publicTenant.loggedinContent.id],
                                    () => {
                                      // Ensure the folder now has 2 items
                                      FoldersTestUtil.getAllFolderContentItems(
                                        publicTenant.publicUser.restContext,
                                        publicTenant.publicFolder.id,
                                        null,
                                        (contentItems) => {
                                          assert.strictEqual(contentItems.length, 2);
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
        });
      });
    });

    /**
     * Test that verifies authorization for an administrator adding a content item to a folder
     */
    it('verify add items to folder authorization for an administrator', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1, privateTenant) => {
        RestAPI.User.getMe(publicTenant.adminRestContext, (error, publicTenantAdminMe) => {
          assert.notExists(error);

          // Admin removes themself from managing each folder while adding a user. This is
          // to ensure the test is accurate by admin having no explicit manage access
          const memberUpdates = _memberUpdate(publicTenant.publicUser, 'manager');
          memberUpdates[publicTenantAdminMe.id] = false;
          FoldersTestUtil.assertUpdateFolderMembersSucceeds(
            publicTenant.adminRestContext,
            publicTenant.adminRestContext,
            publicTenant.publicFolder.id,
            memberUpdates,
            () => {
              FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                publicTenant.adminRestContext,
                publicTenant.adminRestContext,
                publicTenant.loggedinFolder.id,
                memberUpdates,
                () => {
                  FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                    publicTenant.adminRestContext,
                    publicTenant.adminRestContext,
                    publicTenant.privateFolder.id,
                    memberUpdates,
                    () => {
                      // Ensure admin can add the public, loggedin and private content items of their tenant to all the folders in their tenant
                      FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                        publicTenant.adminRestContext,
                        publicTenant.publicFolder.id,
                        [publicTenant.publicContent.id],
                        () => {
                          FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                            publicTenant.adminRestContext,
                            publicTenant.publicFolder.id,
                            [publicTenant.loggedinContent.id],
                            () => {
                              FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                publicTenant.adminRestContext,
                                publicTenant.publicFolder.id,
                                [publicTenant.privateContent.id],
                                () => {
                                  FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                    publicTenant.adminRestContext,
                                    publicTenant.loggedinFolder.id,
                                    [publicTenant.publicContent.id],
                                    () => {
                                      FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                        publicTenant.adminRestContext,
                                        publicTenant.loggedinFolder.id,
                                        [publicTenant.loggedinContent.id],
                                        () => {
                                          FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                            publicTenant.adminRestContext,
                                            publicTenant.loggedinFolder.id,
                                            [publicTenant.privateContent.id],
                                            () => {
                                              FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                                publicTenant.adminRestContext,
                                                publicTenant.privateFolder.id,
                                                [publicTenant.publicContent.id],
                                                () => {
                                                  FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                                    publicTenant.adminRestContext,
                                                    publicTenant.privateFolder.id,
                                                    [publicTenant.loggedinContent.id],
                                                    () => {
                                                      FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                                        publicTenant.adminRestContext,
                                                        publicTenant.privateFolder.id,
                                                        [publicTenant.privateContent.id],
                                                        () => {
                                                          // Ensure admin can add only the public content item from another public tenant to a folder
                                                          FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                                            publicTenant.adminRestContext,
                                                            publicTenant.publicFolder.id,
                                                            [publicTenant1.publicContent.id],
                                                            () => {
                                                              FoldersTestUtil.assertAddContentItemsToFolderFails(
                                                                publicTenant.adminRestContext,
                                                                publicTenant.publicFolder.id,
                                                                [publicTenant1.loggedinContent.id],
                                                                401,
                                                                () => {
                                                                  FoldersTestUtil.assertAddContentItemsToFolderFails(
                                                                    publicTenant.adminRestContext,
                                                                    publicTenant.publicFolder.id,
                                                                    [publicTenant1.privateContent.id],
                                                                    401,
                                                                    () => {
                                                                      // Ensure admin cannot add any content item from another private tenant to a folder
                                                                      FoldersTestUtil.assertAddContentItemsToFolderFails(
                                                                        publicTenant.adminRestContext,
                                                                        publicTenant.publicFolder.id,
                                                                        [privateTenant.publicContent.id],
                                                                        401,
                                                                        () => {
                                                                          FoldersTestUtil.assertAddContentItemsToFolderFails(
                                                                            publicTenant.adminRestContext,
                                                                            publicTenant.publicFolder.id,
                                                                            [privateTenant.loggedinContent.id],
                                                                            401,
                                                                            () => {
                                                                              FoldersTestUtil.assertAddContentItemsToFolderFails(
                                                                                publicTenant.adminRestContext,
                                                                                publicTenant.publicFolder.id,
                                                                                [privateTenant.privateContent.id],
                                                                                401,
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
    });

    /**
     * Test that verifies authorization for an authenticated user adding a content item to a folder
     */
    it('verify add items to folder authorization for an authenticated user', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1, privateTenant) => {
        // Make the public user a manager of each folder so he can add items to them
        const memberUpdates = _memberUpdate(publicTenant.publicUser, 'manager');
        FoldersTestUtil.assertUpdateFolderMembersSucceeds(
          publicTenant.adminRestContext,
          publicTenant.adminRestContext,
          publicTenant.publicFolder.id,
          memberUpdates,
          () => {
            FoldersTestUtil.assertUpdateFolderMembersSucceeds(
              publicTenant.adminRestContext,
              publicTenant.adminRestContext,
              publicTenant.loggedinFolder.id,
              memberUpdates,
              () => {
                FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                  publicTenant.adminRestContext,
                  publicTenant.adminRestContext,
                  publicTenant.privateFolder.id,
                  memberUpdates,
                  () => {
                    // Ensure a user can add the public and loggedin content items of their tenant to the folder
                    FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                      publicTenant.publicUser.restContext,
                      publicTenant.publicFolder.id,
                      [publicTenant.publicContent.id],
                      () => {
                        FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                          publicTenant.publicUser.restContext,
                          publicTenant.publicFolder.id,
                          [publicTenant.loggedinContent.id],
                          () => {
                            FoldersTestUtil.assertAddContentItemsToFolderFails(
                              publicTenant.publicUser.restContext,
                              publicTenant.publicFolder.id,
                              [publicTenant.privateContent.id],
                              401,
                              () => {
                                FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                  publicTenant.publicUser.restContext,
                                  publicTenant.loggedinFolder.id,
                                  [publicTenant.publicContent.id],
                                  () => {
                                    FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                      publicTenant.publicUser.restContext,
                                      publicTenant.loggedinFolder.id,
                                      [publicTenant.loggedinContent.id],
                                      () => {
                                        FoldersTestUtil.assertAddContentItemsToFolderFails(
                                          publicTenant.publicUser.restContext,
                                          publicTenant.loggedinFolder.id,
                                          [publicTenant.privateContent.id],
                                          401,
                                          () => {
                                            FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                              publicTenant.publicUser.restContext,
                                              publicTenant.privateFolder.id,
                                              [publicTenant.publicContent.id],
                                              () => {
                                                FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                                  publicTenant.publicUser.restContext,
                                                  publicTenant.privateFolder.id,
                                                  [publicTenant.loggedinContent.id],
                                                  () => {
                                                    FoldersTestUtil.assertAddContentItemsToFolderFails(
                                                      publicTenant.publicUser.restContext,
                                                      publicTenant.privateFolder.id,
                                                      [publicTenant.privateContent.id],
                                                      401,
                                                      () => {
                                                        // Once a user has viewer rights, he should be able to add content to any folder he can manage
                                                        const contentMemberUpdate = _memberUpdate(
                                                          publicTenant.publicUser.user.id
                                                        );
                                                        RestAPI.Content.updateMembers(
                                                          publicTenant.adminRestContext,
                                                          publicTenant.privateContent.id,
                                                          contentMemberUpdate,
                                                          (error) => {
                                                            assert.notExists(error);
                                                            FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                                              publicTenant.publicUser.restContext,
                                                              publicTenant.publicFolder.id,
                                                              [publicTenant.privateContent.id],
                                                              () => {
                                                                FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                                                  publicTenant.publicUser.restContext,
                                                                  publicTenant.loggedinFolder.id,
                                                                  [publicTenant.privateContent.id],
                                                                  () => {
                                                                    FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                                                      publicTenant.publicUser.restContext,
                                                                      publicTenant.privateFolder.id,
                                                                      [publicTenant.privateContent.id],
                                                                      () => {
                                                                        // Ensure a user can add only the public content item from another public tenant to a folder
                                                                        FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                                                          publicTenant.publicUser.restContext,
                                                                          publicTenant.publicFolder.id,
                                                                          [publicTenant1.publicContent.id],
                                                                          () => {
                                                                            FoldersTestUtil.assertAddContentItemsToFolderFails(
                                                                              publicTenant.publicUser.restContext,
                                                                              publicTenant.publicFolder.id,
                                                                              [publicTenant1.loggedinContent.id],
                                                                              401,
                                                                              () => {
                                                                                FoldersTestUtil.assertAddContentItemsToFolderFails(
                                                                                  publicTenant.publicUser.restContext,
                                                                                  publicTenant.publicFolder.id,
                                                                                  [publicTenant1.privateContent.id],
                                                                                  401,
                                                                                  () => {
                                                                                    // Ensure a user cannot add any content item from another private tenant to a folder
                                                                                    FoldersTestUtil.assertAddContentItemsToFolderFails(
                                                                                      publicTenant.publicUser
                                                                                        .restContext,
                                                                                      publicTenant.publicFolder.id,
                                                                                      [privateTenant.publicContent.id],
                                                                                      401,
                                                                                      () => {
                                                                                        FoldersTestUtil.assertAddContentItemsToFolderFails(
                                                                                          publicTenant.publicUser
                                                                                            .restContext,
                                                                                          publicTenant.publicFolder.id,
                                                                                          [
                                                                                            privateTenant
                                                                                              .loggedinContent.id
                                                                                          ],
                                                                                          401,
                                                                                          () => {
                                                                                            FoldersTestUtil.assertAddContentItemsToFolderFails(
                                                                                              publicTenant.publicUser
                                                                                                .restContext,
                                                                                              publicTenant.publicFolder
                                                                                                .id,
                                                                                              [
                                                                                                privateTenant
                                                                                                  .privateContent.id
                                                                                              ],
                                                                                              401,
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
     * Test that verifies adding a content item to a folder allows permissions to propagate to the content
     * item from the folder's members
     */
    it('verify folders propagate user permission to content items that belong to them', (callback) => {
      // Create mrvisser, a folder that he manages, and a private content item that he does not have access to
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;
        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          RestAPI.Content.createLink(
            asCambridgeTenantAdmin,
            {
              displayName: 'test',
              description: 'test',
              visibility: PRIVATE,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              // Sanity check that mrvisser has no access to the content item
              RestAPI.Content.getContent(mrvisser.restContext, link.id, (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 401);

                // Add the link to the folder
                FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                  asCambridgeTenantAdmin,
                  folder.id,
                  [link.id],
                  () => {
                    // Ensure that Mrvisser now has access to view the link
                    RestAPI.Content.getContent(mrvisser.restContext, link.id, (error_) => {
                      assert.notExists(error_);

                      // Remove the content item from the folder
                      FoldersTestUtil.assertRemoveContentItemsFromFolderSucceeds(
                        asCambridgeTenantAdmin,
                        folder.id,
                        [link.id],
                        () => {
                          // Ensure that Mrvisser lost his access to view the link
                          RestAPI.Content.getContent(mrvisser.restContext, link.id, (error_) => {
                            assert.ok(error_);
                            assert.strictEqual(error_.code, 401);

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
     * Test that verifies folders propagate group permission to content items that belong to them
     */
    it('verify folders propagate group permission to content items that belong to them', (callback) => {
      // Generate 2 test users and folder. mrvisser will be given access to the private link via a group and folder permissions chain
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser, 1: simong } = users;
        FoldersTestUtil.generateTestFolders(asCambridgeTenantAdmin, 1, (folder) => {
          // Create the private link to which will give mrvisser access VIA group and folder permissions chain
          RestAPI.Content.createLink(
            asCambridgeTenantAdmin,
            {
              displayName: 'test',
              description: 'test',
              visibility: PRIVATE,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              // Generate an hierarchy of groups through which access will be propagated down to the user
              TestsUtil.generateTestGroups(asCambridgeTenantAdmin, 3, (error, groups) => {
                assert.notExists(error);
                const { 0: group1, 1: group2, 2: group3 } = groups;

                TestsUtil.generateGroupHierarchy(
                  asCambridgeTenantAdmin,
                  [group1.group.id, group2.group.id, group3.group.id, mrvisser.user.id],
                  'member',
                  (error_) => {
                    assert.notExists(error_);

                    // Add simong to the parent group to sanity check permissions will not propagate the wrong way through groups
                    RestAPI.Group.setGroupMembers(
                      asCambridgeTenantAdmin,
                      group1.group.id,
                      _memberUpdate(simong.user.id, 'member'),
                      (error_) => {
                        assert.notExists(error_);

                        // Add group2 as a member of the folder. This implies that group1 and it's members (the parent of group2) will not receive
                        // access when the link is added to the folder
                        FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                          asCambridgeTenantAdmin,
                          asCambridgeTenantAdmin,
                          folder.id,
                          _memberUpdate(group2),
                          () => {
                            // Sanity check that mrvisser and simong both have no access to the content item because it has not yet been added to the
                            // folder to complete the permission chain
                            RestAPI.Content.getContent(mrvisser.restContext, link.id, (error_) => {
                              assert.ok(error_);
                              assert.strictEqual(error_.code, 401);
                              RestAPI.Content.getContent(simong.restContext, link.id, (error_) => {
                                assert.ok(error_);
                                assert.strictEqual(error_.code, 401);

                                // Finally add the link to the folder
                                FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                  asCambridgeTenantAdmin,
                                  folder.id,
                                  [link.id],
                                  () => {
                                    // Ensure mrvisser now has access by permission chain: link -> folder -> group1 -> group2 -> group3 -> mrvisser
                                    RestAPI.Content.getContent(mrvisser.restContext, link.id, (error_) => {
                                      assert.notExists(error_);

                                      // Sanity check that the reverse chain did not propagate access to simong
                                      RestAPI.Content.getContent(simong.restContext, link.id, (error_) => {
                                        assert.ok(error_);
                                        assert.strictEqual(error_.code, 401);

                                        // Remove the link from the folder
                                        FoldersTestUtil.assertRemoveContentItemsFromFolderSucceeds(
                                          asCambridgeTenantAdmin,
                                          folder.id,
                                          [link.id],
                                          () => {
                                            // Ensure that Mrvisser lost his access to view the link
                                            RestAPI.Content.getContent(mrvisser.restContext, link.id, (error_) => {
                                              assert.ok(error_);
                                              assert.strictEqual(error_.code, 401);

                                              return callback();
                                            });
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

  describe('Remove Items from Folder', () => {
    /**
     * Test that verifies removing a single item from a folder succeeds
     */
    it('verify removing a single item from a folder', (callback) => {
      // Generate a user and give them a folder
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          // Create a content item that mrvisser will add to his folder
          RestAPI.Content.createLink(
            asCambridgeTenantAdmin,
            {
              displayName: 'test',
              description: 'test',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              // Ensure Mrvisser can add the item to his folder
              FoldersTestUtil.assertAddContentItemsToFolderSucceeds(mrvisser.restContext, folder.id, [link.id], () => {
                // Ensure Mrvisser can remove the item from his folder
                return FoldersTestUtil.assertRemoveContentItemsFromFolderSucceeds(
                  mrvisser.restContext,
                  folder.id,
                  [link.id],
                  callback
                );
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies removing multiple content items from a folder succeeds
     */
    it('verify removing multiple items from a folder', (callback) => {
      // Generate a user and give them a folder
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 1, (folder) => {
          // Create 5 content items to add to the folder
          RestAPI.Content.createLink(
            asCambridgeTenantAdmin,
            {
              displayName: 'test1',
              description: 'test',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link1) => {
              assert.notExists(error);
              RestAPI.Content.createLink(
                asCambridgeTenantAdmin,
                {
                  displayName: 'test2',
                  description: 'test',
                  visibility: PUBLIC,
                  link: 'http://www.google.ca',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error, link2) => {
                  assert.notExists(error);
                  RestAPI.Content.createLink(
                    asCambridgeTenantAdmin,
                    {
                      displayName: 'test3',
                      description: 'test',
                      visibility: PUBLIC,
                      link: 'http://www.google.ca',
                      managers: NO_MANAGERS,
                      viewers: NO_VIEWERS,
                      folders: NO_FOLDERS
                    },
                    (error, link3) => {
                      assert.notExists(error);
                      RestAPI.Content.createLink(
                        asCambridgeTenantAdmin,
                        {
                          displayName: 'test4',
                          description: 'test',
                          visibility: PUBLIC,
                          link: 'http://www.google.ca',
                          managers: NO_MANAGERS,
                          viewers: NO_VIEWERS,
                          folders: NO_FOLDERS
                        },
                        (error, link4) => {
                          assert.notExists(error);
                          RestAPI.Content.createLink(
                            asCambridgeTenantAdmin,
                            {
                              displayName: 'test5',
                              description: 'test',
                              visibility: PUBLIC,
                              link: 'http://www.google.ca',
                              managers: NO_MANAGERS,
                              viewers: NO_VIEWERS,
                              folders: NO_FOLDERS
                            },
                            (error, link5) => {
                              assert.notExists(error);

                              // Ensure Mrvisser can add all the items to his folder
                              FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                                mrvisser.restContext,
                                folder.id,
                                [link1.id, link2.id, link3.id, link4.id, link5.id],
                                () => {
                                  // Remove the first 2 content items
                                  FoldersTestUtil.assertRemoveContentItemsFromFolderSucceeds(
                                    mrvisser.restContext,
                                    folder.id,
                                    [link1.id, link2.id],
                                    () => {
                                      // Ensure that the other 3 items are still there
                                      FoldersTestUtil.getAllFolderContentItems(
                                        mrvisser.restContext,
                                        folder.id,
                                        null,
                                        (contentItems /* , responses */) => {
                                          assert.lengthOf(contentItems, 3);
                                          assert.ok(_.findWhere(contentItems, { id: link3.id }));
                                          assert.ok(_.findWhere(contentItems, { id: link4.id }));
                                          assert.ok(_.findWhere(contentItems, { id: link5.id }));
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
        });
      });
    });

    /**
     * Test that verifies both managers and administrators can remove content items from a folder
     */
    it('verify only administrators and managers of folders can remove content items from a folder', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1) => {
        RestAPI.User.getMe(publicTenant.adminRestContext, (error, publicTenantAdminMe) => {
          assert.notExists(error);

          // Stick the all the content items from the public tenant in the private folder
          FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
            publicTenant.adminRestContext,
            publicTenant.publicFolder.id,
            [publicTenant.publicContent.id, publicTenant.loggedinContent.id, publicTenant.privateContent.id],
            () => {
              // Ensure anonymous, regular user, regular user from another tenant, admin from another tenant all cannot add a content item to the folder
              FoldersTestUtil.assertRemoveContentItemsFromFolderFails(
                publicTenant.anonymousRestContext,
                publicTenant.publicFolder.id,
                [publicTenant.publicContent.id],
                401,
                () => {
                  FoldersTestUtil.assertRemoveContentItemsFromFolderFails(
                    publicTenant.publicUser.restContext,
                    publicTenant.publicFolder.id,
                    [publicTenant.publicContent.id],
                    401,
                    () => {
                      FoldersTestUtil.assertRemoveContentItemsFromFolderFails(
                        publicTenant1.publicUser.restContext,
                        publicTenant.publicFolder.id,
                        [publicTenant.publicContent.id],
                        401,
                        () => {
                          FoldersTestUtil.assertRemoveContentItemsFromFolderFails(
                            publicTenant1.adminRestContext,
                            publicTenant.publicFolder.id,
                            [publicTenant.publicContent.id],
                            401,
                            () => {
                              // Ensure the folder still has all its content
                              FoldersTestUtil.getAllFolderContentItems(
                                publicTenant.adminRestContext,
                                publicTenant.publicFolder.id,
                                null,
                                (contentItems) => {
                                  assert.strictEqual(contentItems.length, 3);

                                  // Add public user as a manager of the folder and remove admin as a manager
                                  const memberUpdates = _memberUpdate(publicTenant.publicUser, 'manager');
                                  memberUpdates[publicTenantAdminMe.id] = false;
                                  FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                                    publicTenant.adminRestContext,
                                    publicTenant.adminRestContext,
                                    publicTenant.publicFolder.id,
                                    memberUpdates,
                                    () => {
                                      // Ensure public user and admin can both delete an item to the folder
                                      FoldersTestUtil.assertRemoveContentItemsFromFolderSucceeds(
                                        publicTenant.publicUser.restContext,
                                        publicTenant.publicFolder.id,
                                        [publicTenant.publicContent.id],
                                        () => {
                                          FoldersTestUtil.assertRemoveContentItemsFromFolderSucceeds(
                                            publicTenant.adminRestContext,
                                            publicTenant.publicFolder.id,
                                            [publicTenant.loggedinContent.id],
                                            () => {
                                              // Ensure the folder now has 1 item
                                              FoldersTestUtil.getAllFolderContentItems(
                                                publicTenant.publicUser.restContext,
                                                publicTenant.publicFolder.id,
                                                null,
                                                (contentItems) => {
                                                  assert.strictEqual(contentItems.length, 1);
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
      });
    });
  });

  describe('Get Folder Content Library', () => {
    /**
         Test that verifies the authorization of listing a folder's content library
         */
    it('verify get folder content library authorization', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: simong, 1: nico } = users;

        FoldersTestUtil.generateTestFoldersWithVisibility(simong.restContext, 1, 'private', (folder) => {
          // Create some content and add it to the folder
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'test',
              description: 'test',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: [folder.id]
            },
            (error, link1) => {
              assert.notExists(error);
              RestAPI.Content.createLink(
                simong.restContext,
                {
                  displayName: 'test',
                  description: 'test',
                  visibility: PUBLIC,
                  link: 'http://www.google.ca',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: [folder.id]
                },
                (error, link2) => {
                  assert.notExists(error);
                  RestAPI.Content.createLink(
                    simong.restContext,
                    {
                      displayName: 'test',
                      description: 'test',
                      visibility: PUBLIC,
                      link: 'http://www.google.ca',
                      managers: NO_MANAGERS,
                      viewers: NO_VIEWERS,
                      folders: [folder.id]
                    },
                    (error, link3) => {
                      assert.notExists(error);

                      // Only Simon and the cambridge tenant admin should be able to view the folder's content library
                      FoldersTestUtil.assertGetFolderContentLibraryFails(
                        asCambridgeAnonymousUser,
                        folder.id,
                        null,
                        null,
                        401,
                        () => {
                          FoldersTestUtil.assertGetFolderContentLibraryFails(
                            nico.restContext,
                            folder.id,
                            null,
                            null,
                            401,
                            () => {
                              FoldersTestUtil.assertGetFolderContentLibraryFails(
                                asGeorgiaTenantAdmin,
                                folder.id,
                                null,
                                null,
                                401,
                                () => {
                                  FoldersTestUtil.assertFolderEquals(
                                    simong.restContext,
                                    folder.id,
                                    [link1.id, link2.id, link3.id],
                                    () => {
                                      FoldersTestUtil.assertFolderEquals(
                                        asCambridgeTenantAdmin,
                                        folder.id,
                                        [link1.id, link2.id, link3.id],
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
      });
    });

    /**
     * Test that verifies that validation for the folder content endpoint
     */
    it('verify get folder content validation', (callback) => {
      FoldersTestUtil.assertGetFolderContentLibraryFails(
        asCambridgeAnonymousUser,
        'not a folder id',
        null,
        null,
        400,
        () => {
          FoldersTestUtil.assertGetFolderContentLibraryFails(
            asCambridgeAnonymousUser,
            'f:camtest:notexisting',
            null,
            null,
            404,
            () => {
              return callback();
            }
          );
        }
      );
    });
  });

  describe('Content Integration', () => {
    /**
     * Test that verifies that folder ids can be specified when creating content
     */
    it('verify folder ids can be specified when creating content', (callback) => {
      // Create a test user with which to do stuff
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;

        // Create a few folders to which we'll add some content items
        FoldersTestUtil.generateTestFolders(simong.restContext, 3, (folder1, folder2, folder3) => {
          const folderIds = [folder1.id, folder2.id, folder3.id];

          // Create some content and add it to the folders
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'test',
              description: 'test',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: folderIds
            },
            (error, link) => {
              assert.notExists(error);
              RestAPI.Content.createCollabDoc(
                simong.restContext,
                'test',
                'test',
                PUBLIC,
                null,
                [],
                [],
                folderIds,
                (error, collabDoc) => {
                  assert.notExists(error);
                  RestAPI.Content.createFile(
                    simong.restContext,
                    {
                      displayName: 'test',
                      description: 'test',
                      PUBLIC,
                      file: _getFileStream,
                      managers: NO_MANAGERS,
                      viewers: NO_VIEWERS,
                      folders: folderIds
                    },
                    (error, file) => {
                      assert.notExists(error);

                      // Assert that each folder contains all the content items
                      const contentIds = [link.id, collabDoc.id, file.id];
                      FoldersTestUtil.assertFolderEquals(simong.restContext, folder1.id, contentIds, () => {
                        FoldersTestUtil.assertFolderEquals(simong.restContext, folder2.id, contentIds, () => {
                          FoldersTestUtil.assertFolderEquals(simong.restContext, folder3.id, contentIds, callback);
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
     * Test that verifies that a content item that belongs to folders and has groups as members can list their members
     */
    it('verify a content item that belongs to folders and has groups as members can list their members', (callback) => {
      // Create a test user with which to do stuff
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        // Create a few folders that a content item will be added to
        FoldersTestUtil.generateTestFolders(mrvisser.restContext, 3, function (...args) {
          const folderIds = _.pluck(args, 'id');

          // Create a few groups that will be added as a member of the content item
          TestsUtil.generateTestGroups(mrvisser.restContext, 3, function (...args) {
            assert.ok(!head(args));

            const groupIds = reject(isNil, map(path(['group', 'id']), last(args)));

            // Create a content item to add to the folders
            RestAPI.Content.createLink(
              asCambridgeTenantAdmin,
              {
                displayName: 'test',
                description: 'test',
                visibility: PUBLIC,
                link: 'http://www.google.ca',
                managers: NO_MANAGERS,
                viewers: groupIds,
                folders: NO_FOLDERS
              },
              (error, link) => {
                assert.notExists(error);

                FoldersTestUtil.assertAddContentItemToFoldersSucceeds(mrvisser.restContext, folderIds, link.id, () => {
                  // Ensure we can get the members of the content item
                  RestAPI.Content.getMembers(mrvisser.restContext, link.id, null, null, (error /* , result */) => {
                    assert.notExists(error);
                    return callback();
                  });
                });
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies that content visibility updates affect the folder libraries
     */
    it('verify content visibility updates rebuild folder libraries', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1) => {
        TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: simong } = users;

          // Create a content item to add to the folder
          RestAPI.Content.createLink(
            publicTenant.adminRestContext,
            {
              displayName: 'test',
              description: 'test',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              // Add simon as member to the collection
              const memberUpdates = {};
              memberUpdates[simong.user.id] = 'viewer';
              RestAPI.Folders.updateFolderMembers(
                publicTenant.adminRestContext,
                publicTenant.publicFolder.id,
                memberUpdates,
                (error_) => {
                  assert.notExists(error_);
                  // Add the link to the public folder
                  FoldersTestUtil.assertAddContentItemToFoldersSucceeds(
                    publicTenant.adminRestContext,
                    [publicTenant.publicFolder.id],
                    link.id,
                    () => {
                      // Everyone should be able to see the link in the folder
                      FoldersTestUtil.assertFolderEquals(
                        publicTenant.publicUser.restContext,
                        publicTenant.publicFolder.id,
                        [link.id],
                        () => {
                          FoldersTestUtil.assertFolderEquals(
                            publicTenant1.publicUser.restContext,
                            publicTenant.publicFolder.id,
                            [link.id],
                            () => {
                              FoldersTestUtil.assertFolderEquals(
                                asCambridgeAnonymousUser,
                                publicTenant.publicFolder.id,
                                [link.id],
                                () => {
                                  FoldersTestUtil.assertFolderEquals(
                                    simong.restContext,
                                    publicTenant.publicFolder.id,
                                    [link.id],
                                    () => {
                                      // Update the visibility of the content item to loggedin
                                      RestAPI.Content.updateContent(
                                        publicTenant.adminRestContext,
                                        link.id,
                                        { visibility: 'loggedin' },
                                        (error_) => {
                                          assert.notExists(error_);
                                          FoldersLibrary.whenAllPurged(() => {
                                            // The users from the other tenant can no longer see the content item
                                            FoldersTestUtil.assertFolderEquals(
                                              publicTenant.publicUser.restContext,
                                              publicTenant.publicFolder.id,
                                              [link.id],
                                              () => {
                                                FoldersTestUtil.assertFolderEquals(
                                                  publicTenant1.publicUser.restContext,
                                                  publicTenant.publicFolder.id,
                                                  [],
                                                  () => {
                                                    FoldersTestUtil.assertFolderEquals(
                                                      asCambridgeAnonymousUser,
                                                      publicTenant.publicFolder.id,
                                                      [],
                                                      () => {
                                                        FoldersTestUtil.assertFolderEquals(
                                                          simong.restContext,
                                                          publicTenant.publicFolder.id,
                                                          [link.id],
                                                          () => {
                                                            // Update the visiblity of the content item to private
                                                            RestAPI.Content.updateContent(
                                                              publicTenant.adminRestContext,
                                                              link.id,
                                                              { visibility: 'private' },
                                                              (error_) => {
                                                                assert.notExists(error_);
                                                                FoldersLibrary.whenAllPurged(() => {
                                                                  // Only members of the folder can see the link in the folder
                                                                  FoldersTestUtil.assertFolderEquals(
                                                                    publicTenant.publicUser.restContext,
                                                                    publicTenant.publicFolder.id,
                                                                    [],
                                                                    () => {
                                                                      FoldersTestUtil.assertFolderEquals(
                                                                        publicTenant1.publicUser.restContext,
                                                                        publicTenant.publicFolder.id,
                                                                        [],
                                                                        () => {
                                                                          FoldersTestUtil.assertFolderEquals(
                                                                            asCambridgeAnonymousUser,
                                                                            publicTenant.publicFolder.id,
                                                                            [],
                                                                            () => {
                                                                              FoldersTestUtil.assertFolderEquals(
                                                                                simong.restContext,
                                                                                publicTenant.publicFolder.id,
                                                                                [link.id],
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
            }
          );
        });
      });
    });

    /**
     * Test that verifies that when a content item is removed from the system it's also removed
     * from the folders it was placed in
     */
    it('verify removing a content item from the system removes it from the folders', (callback) => {
      FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1) => {
        TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: simong } = users;

          // Create a content item to add to the folder
          RestAPI.Content.createLink(
            publicTenant.adminRestContext,
            {
              displayName: 'test',
              description: 'test',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              // Add simon as member to the collection
              const memberUpdates = {};
              memberUpdates[simong.user.id] = 'viewer';
              RestAPI.Folders.updateFolderMembers(
                publicTenant.adminRestContext,
                publicTenant.publicFolder.id,
                memberUpdates,
                (error_) => {
                  assert.notExists(error_);
                  // Add the link to the public folder
                  FoldersTestUtil.assertAddContentItemToFoldersSucceeds(
                    publicTenant.adminRestContext,
                    [publicTenant.publicFolder.id],
                    link.id,
                    () => {
                      // Everyone should be able to see the link in the folder
                      FoldersTestUtil.assertFolderEquals(
                        publicTenant.publicUser.restContext,
                        publicTenant.publicFolder.id,
                        [link.id],
                        () => {
                          FoldersTestUtil.assertFolderEquals(
                            publicTenant1.publicUser.restContext,
                            publicTenant.publicFolder.id,
                            [link.id],
                            () => {
                              FoldersTestUtil.assertFolderEquals(
                                asCambridgeAnonymousUser,
                                publicTenant.publicFolder.id,
                                [link.id],
                                () => {
                                  FoldersTestUtil.assertFolderEquals(
                                    simong.restContext,
                                    publicTenant.publicFolder.id,
                                    [link.id],
                                    () => {
                                      // Delete the link
                                      RestAPI.Content.deleteContent(
                                        publicTenant.adminRestContext,
                                        link.id,
                                        (error_) => {
                                          assert.notExists(error_);

                                          FoldersLibrary.whenAllPurged(() => {
                                            // It should be removed from all the libraries
                                            FoldersTestUtil.assertFolderEquals(
                                              publicTenant.publicUser.restContext,
                                              publicTenant.publicFolder.id,
                                              [],
                                              () => {
                                                FoldersTestUtil.assertFolderEquals(
                                                  publicTenant1.publicUser.restContext,
                                                  publicTenant.publicFolder.id,
                                                  [],
                                                  () => {
                                                    FoldersTestUtil.assertFolderEquals(
                                                      asCambridgeAnonymousUser,
                                                      publicTenant.publicFolder.id,
                                                      [],
                                                      () => {
                                                        FoldersTestUtil.assertFolderEquals(
                                                          simong.restContext,
                                                          publicTenant.publicFolder.id,
                                                          [],
                                                          () => {
                                                            // Sanity-check it's been removed through the Library API as the REST API does it's own filtering
                                                            FoldersContentLibrary.list(
                                                              publicTenant.publicFolder,
                                                              'public',
                                                              {},
                                                              (error, contentIds, nextToken) => {
                                                                assert.notExists(error);
                                                                assert.strictEqual(contentIds.length, 0);
                                                                assert.ok(!nextToken);
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
