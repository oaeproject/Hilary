/*!
 * Copyright 2017 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the 'License'); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an 'AS IS'
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import { assert } from 'chai';
import fs from 'fs';
import util from 'util';

import { pipe, forEach, filter, equals, contains, pluck, propSatisfies } from 'ramda';

import { addMonths } from 'date-fns';
import * as AuthzAPI from 'oae-authz';
import * as AuthzDeleteAPI from 'oae-authz/lib/delete';
import { setUpConfig } from 'oae-config';
import * as ContentUtil from 'oae-content/lib/internal/util';
import * as FoldersTestUtil from 'oae-folders/lib/test/util';
import * as FollowingTestsUtil from 'oae-following/lib/test/util';
import * as MeetingAPI from 'oae-jitsi/lib/api.meetings';
import { deleteUser as removeUser } from 'oae-principals/lib/api.user';
import * as RestAPI from 'oae-rest';
import { clearAllData, createTenantAdminRestContext, generateTestUsers } from 'oae-tests';
import { eliminateUser } from 'oae-principals/lib/definitive-deletion';
import {
  assertDefinitiveDeletionUsersSucceeds as assertDataIsTransferredToArchiveUser,
  assertDeleteUserFails,
  uploadAndCropPicture,
  generateLinks,
  generateRightContent,
  generateCollabdocs,
  generateFiles,
  generateMeetings,
  generateRightMeeting,
  generateDiscussions,
  generateRightDiscussion,
  generateGroups,
  generateRightsForGroup,
  generateFolders,
  generateRightFolder,
  assertDoesNotFollow,
  assertJoinGroupSucceeds
} from 'oae-principals/lib/test/util';
import {
  getExpiredUser as fetchAllExpiredUsersToDate,
  updateUserArchiveFlag,
  getPrincipalSkipCache,
  getDataFromArchive
} from 'oae-principals/lib/internal/dao';

const PrincipalsConfig = setUpConfig('oae-principals');

const USER = 'user';
const DELETE = 'delete';
const DEFAULT_LOCALE = 'en_GB';
const PRIVATE_VISIBILITY = 'private';
const MANAGER = 'manager';
const VIEWER = 'viewer';
const MEMBER = 'member';
const EDITOR = 'editor';
const TYPE_COLLABDOC = 'collabdoc';
const TYPE_COLLABSHEET = 'collabsheet';

// Avoid the "Error: global leak detected: r", temporal solution
Object.defineProperty(global, 'r', {});

describe('Delete and eliminate users', () => {
  let asCambridgeTenantAdmin = null;

  const reset = callback => {
    clearAllData(err => {
      assert.notExists(err);
      asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
      return callback();
    });
  };

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before(callback => {
    reset(() => {
      return callback();
    });
  });

  /**
   * @return {Stream} A stream to jpg image
   * @api private
   */
  const _getPictureStream = () => {
    return fs.createReadStream(util.format('%s/data/restroom.jpg', __dirname));
  };

  describe('Delete user - Principals', () => {
    /**
     * Test that verifies we get the correct expired users
     */
    it('Verify if the DAO gets the correct expired users', callback => {
      const isUserAmongTheExpired = (expiredUsers, userToDelete) => {
        return pipe(pluck('principalId'), contains(userToDelete.user.id))(expiredUsers);
      };

      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);

        const { 0: userToDelete, 1: userArchive } = users;

        // Delete User - step 1
        assertDataIsTransferredToArchiveUser(
          asCambridgeTenantAdmin,
          userToDelete,
          userArchive,
          (err, resUserArchive) => {
            assert.notExists(err);
            assert.ok(resUserArchive);

            const actualDate = new Date();

            // Get expired principals
            // The deleted user shouldn't appear because the date in the datebase isn't updated yet
            fetchAllExpiredUsersToDate(actualDate, (err, expiredUsers) => {
              assert.notExists(err);
              assert.ok(!isUserAmongTheExpired(expiredUsers, userToDelete));

              const timeUntilDeletionInMonths = PrincipalsConfig.getValue(userArchive.user.tenant.alias, USER, DELETE);
              const deletionDate = addMonths(actualDate, parseInt(timeUntilDeletionInMonths, 10));

              // Get expired principals
              // The deleted user should be considered as an expired user because the date in the database is updated
              fetchAllExpiredUsersToDate(deletionDate, (err, otherExpiredUsers) => {
                assert.notExists(err);
                assert.ok(isUserAmongTheExpired(otherExpiredUsers, userToDelete));

                // Delete User - step 2
                eliminateUser(asCambridgeTenantAdmin, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.notExists(err);

                  // Get expired principals
                  // The deleted user shouldn't appear because the user is already marked has fully deleted
                  fetchAllExpiredUsersToDate(deletionDate, (err, moreExpiredUsers) => {
                    assert.notExists(err);
                    assert.ok(!isUserAmongTheExpired(moreExpiredUsers, userToDelete));
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
     * Test that verifies we can't delete a user archive
     */
    it('Verify if the deletion fails when we try to delete a user archive', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);

        const { 1: userArchive } = users;

        // Turn on the user archive flag, this user will now be considered as a user archive
        updateUserArchiveFlag(userArchive.user.id, err => {
          assert.notExists(err);

          // Delete User - step 1
          assertDeleteUserFails(asCambridgeTenantAdmin, userArchive.user.id, 401, err => {
            assert.notExists(err);

            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies user deleted from data base
     */
    it('Verify if a user is still alive && marked as removed after the deletion', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 2: userToDelete, 3: userArchive } = users;

        asCambridgeTenantAdmin.user = () => {
          return userArchive.user;
        };

        asCambridgeTenantAdmin.tenant = () => {
          return userArchive.user.tenant;
        };

        asCambridgeTenantAdmin.user().isAdmin = () => {
          return true;
        };

        asCambridgeTenantAdmin.locale = () => {
          return DEFAULT_LOCALE;
        };

        // Delete User - step 1
        removeUser(asCambridgeTenantAdmin, userToDelete.user.id, err => {
          assert.notExists(err);

          // Get user
          getPrincipalSkipCache(userToDelete.user.id, (err, user) => {
            assert.notExists(err);
            assert.ok(user);

            // Marked as deleted
            AuthzDeleteAPI.isDeleted([userToDelete.user.id], (err, wasDeleted) => {
              assert.notExists(err);
              const isDeleted = Object.keys(wasDeleted).map(k => wasDeleted[k]);
              assert.strictEqual(Object.keys(wasDeleted)[0], userToDelete.user.id);
              assert.strictEqual(isDeleted[0], true);
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies user deleted from data base (Principals and DataArchive)
     */
    it('Verify that a user is removed from the database after being eliminated', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);

        const { 0: userToDelete, 1: userArchive } = users;

        // Delete User - step 1
        assertDataIsTransferredToArchiveUser(
          asCambridgeTenantAdmin,
          userToDelete,
          userArchive,
          (err, resUserArchive) => {
            assert.notExists(err);
            assert.ok(resUserArchive);

            // Delete User - step 2
            eliminateUser(asCambridgeTenantAdmin, userToDelete.user, resUserArchive.tenantAlias, err => {
              assert.notExists(err);

              // Get principals
              getPrincipalSkipCache(userToDelete.user.id, (err, user) => {
                assert.ok(err);
                assert.ok(!user);

                getDataFromArchive(userArchive.user.id, userToDelete.user.id, (err, user) => {
                  assert.ok(err);
                  assert.ok(!user);
                  assert.strictEqual(err.code, 404);

                  return callback();
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies user profile picture is deleted from file system
     */
    it('Verify that the profile picture has been deleted from the file system after elimination', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);

        const { 0: userToDelete, 1: userArchive } = users;

        // Upload a profile picture for the user so we can verify its data on the user profile model
        uploadAndCropPicture(
          userToDelete.restContext,
          userToDelete.user.id,
          _getPictureStream,
          { x: 10, y: 10, width: 200 },
          () => {
            // Get the user
            getPrincipalSkipCache(userToDelete.user.id, (err, retrievedUser) => {
              assert.notExists(err);

              // Delete User - step 1
              assertDataIsTransferredToArchiveUser(
                asCambridgeTenantAdmin,
                userToDelete,
                userArchive,
                (err, resUserArchive) => {
                  assert.notExists(err);
                  assert.ok(resUserArchive);

                  // Delete User - step 2
                  eliminateUser(asCambridgeTenantAdmin, userToDelete.user, resUserArchive.tenantAlias, err => {
                    assert.notExists(err);

                    // Get files
                    const pathSmallPicture = retrievedUser.picture.smallUri.split(':');
                    const pathMediumPicture = retrievedUser.picture.mediumUri.split(':');
                    const pathLargePicture = retrievedUser.picture.largeUri.split(':');

                    const path = ContentUtil.getStorageBackend(
                      asCambridgeTenantAdmin,
                      retrievedUser.picture.largeUri
                    ).getRootDirectory();

                    fs.readFile(path + '/' + pathSmallPicture[1], (err, data) => {
                      assert.ok(err);
                      assert.isNotOk(data);
                      fs.readFile(path + '/' + pathMediumPicture[1], (err, data) => {
                        assert.ok(err);
                        assert.isNotOk(data);
                        fs.readFile(path + '/' + pathLargePicture[1], (err, data) => {
                          assert.ok(err);
                          assert.isNotOk(data);
                          return callback();
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
  });

  describe('Delete user - step 1 : "mark as deleted"', () => {
    /**
     * Test that verifies definitive delation remove user roles on link
     */
    it('Verify if the user role is removed from the link', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);

        const { 0: user, 1: userToDelete, 2: userArchive } = users;

        // Generate links
        generateLinks(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, links) => {
          assert.notExists(err);
          generateLinks(user.restContext, PRIVATE_VISIBILITY, 1, (err, link) => {
            assert.notExists(err);

            // Generate rights links
            generateRightContent(userToDelete, user, MANAGER, links[0], err => {
              assert.notExists(err);
              generateRightContent(userToDelete, user, VIEWER, links[1], err => {
                assert.notExists(err);
                generateRightContent(user, userToDelete, VIEWER, link[0], err => {
                  assert.notExists(err);

                  // Delete User
                  assertDataIsTransferredToArchiveUser(
                    asCambridgeTenantAdmin,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.notExists(err);
                      assert.ok(userArchive);

                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, links[0].id, (err, hasRole) => {
                        assert.notExists(err);
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, links[0].id, (err, hasRole) => {
                          assert.notExists(err);
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasRole(user.user.id, links[0].id, MANAGER, (err, hasRole) => {
                            assert.notExists(err);
                            assert.strictEqual(hasRole, true);
                            AuthzAPI.hasAnyRole(userToDelete.user.id, links[1].id, (err, hasRole) => {
                              assert.notExists(err);
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(userArchive.archiveId, links[1].id, MANAGER, (err, hasRole) => {
                                assert.notExists(err);
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasRole(user.user.id, links[1].id, VIEWER, (err, hasRole) => {
                                  assert.notExists(err);
                                  assert.strictEqual(hasRole, true);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, links[2].id, (err, hasRole) => {
                                    assert.notExists(err);
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasRole(userArchive.archiveId, links[2].id, MANAGER, (err, hasRole) => {
                                      assert.notExists(err);
                                      assert.strictEqual(hasRole, true);
                                      AuthzAPI.hasRole(user.user.id, link[0].id, MANAGER, (err, hasRole) => {
                                        assert.notExists(err);
                                        assert.strictEqual(hasRole, true);
                                        AuthzAPI.hasAnyRole(userToDelete.user.id, link[0].id, (err, hasRole) => {
                                          assert.notExists(err);
                                          assert.strictEqual(hasRole, false);
                                          AuthzAPI.hasAnyRole(userArchive.archiveId, link[0].id, (err, hasRole) => {
                                            assert.notExists(err);
                                            assert.strictEqual(hasRole, false);
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
     * Test that verifies definitive delation remove user roles on collabdoc
     */
    it('Verify if the user role is removed from the collabdoc', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);

        const { 0: user, 2: userToDelete, 3: userArchive } = users;

        // Generate collabdocs
        generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 4, TYPE_COLLABDOC, (err, collabdocs) => {
          assert.notExists(err);
          generateCollabdocs(user.restContext, PRIVATE_VISIBILITY, 2, TYPE_COLLABDOC, (err, collabdocUser) => {
            assert.notExists(err);

            // Generate rights collabdocs
            generateRightContent(userToDelete, user, MANAGER, collabdocs[0], err => {
              assert.notExists(err);
              generateRightContent(userToDelete, user, EDITOR, collabdocs[1], err => {
                assert.notExists(err);
                generateRightContent(userToDelete, user, VIEWER, collabdocs[2], err => {
                  assert.notExists(err);
                  generateRightContent(user, userToDelete, EDITOR, collabdocUser[0], err => {
                    assert.notExists(err);
                    generateRightContent(user, userToDelete, VIEWER, collabdocUser[1], err => {
                      assert.notExists(err);

                      // Delete User
                      assertDataIsTransferredToArchiveUser(
                        asCambridgeTenantAdmin,
                        userToDelete,
                        userArchive,
                        (err, userArchive) => {
                          assert.notExists(err);
                          assert.ok(userArchive);

                          // Verify roles
                          AuthzAPI.hasAnyRole(userToDelete.user.id, collabdocs[0].id, (err, hasRole) => {
                            assert.notExists(err);
                            assert.strictEqual(hasRole, false);
                            AuthzAPI.hasAnyRole(userArchive.archiveId, collabdocs[0].id, (err, hasRole) => {
                              assert.notExists(err);
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(user.user.id, collabdocs[0].id, MANAGER, (err, hasRole) => {
                                assert.notExists(err);
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasAnyRole(userToDelete.user.id, collabdocs[1].id, (err, hasRole) => {
                                  assert.notExists(err);
                                  assert.strictEqual(hasRole, false);
                                  AuthzAPI.hasRole(userArchive.archiveId, collabdocs[1].id, MANAGER, (err, hasRole) => {
                                    assert.notExists(err);
                                    assert.strictEqual(hasRole, true);
                                    AuthzAPI.hasRole(user.user.id, collabdocs[1].id, EDITOR, (err, hasRole) => {
                                      assert.notExists(err);
                                      assert.strictEqual(hasRole, true);
                                      AuthzAPI.hasAnyRole(userToDelete.user.id, collabdocs[2].id, (err, hasRole) => {
                                        assert.notExists(err);
                                        assert.strictEqual(hasRole, false);
                                        AuthzAPI.hasRole(
                                          userArchive.archiveId,
                                          collabdocs[2].id,
                                          MANAGER,
                                          (err, hasRole) => {
                                            assert.notExists(err);
                                            assert.strictEqual(hasRole, true);
                                            AuthzAPI.hasRole(user.user.id, collabdocs[2].id, VIEWER, (err, hasRole) => {
                                              assert.notExists(err);
                                              assert.strictEqual(hasRole, true);
                                              AuthzAPI.hasAnyRole(
                                                userToDelete.user.id,
                                                collabdocs[3].id,
                                                (err, hasRole) => {
                                                  assert.notExists(err);
                                                  assert.strictEqual(hasRole, false);
                                                  AuthzAPI.hasRole(
                                                    userArchive.archiveId,
                                                    collabdocs[3].id,
                                                    MANAGER,
                                                    (err, hasRole) => {
                                                      assert.notExists(err);
                                                      assert.strictEqual(hasRole, true);
                                                      AuthzAPI.hasAnyRole(
                                                        user.user.id,
                                                        collabdocs[3].id,
                                                        (err, hasRole) => {
                                                          assert.notExists(err);
                                                          assert.strictEqual(hasRole, false);
                                                          AuthzAPI.hasRole(
                                                            user.user.id,
                                                            collabdocUser[0].id,
                                                            MANAGER,
                                                            (err, hasRole) => {
                                                              assert.notExists(err);
                                                              assert.strictEqual(hasRole, true);
                                                              AuthzAPI.hasAnyRole(
                                                                userToDelete.user.id,
                                                                collabdocUser[0].id,
                                                                (err, hasRole) => {
                                                                  assert.notExists(err);
                                                                  assert.strictEqual(hasRole, false);
                                                                  AuthzAPI.hasAnyRole(
                                                                    userArchive.archiveId,
                                                                    collabdocUser[0].id,
                                                                    (err, hasRole) => {
                                                                      assert.notExists(err);
                                                                      assert.strictEqual(hasRole, false);
                                                                      AuthzAPI.hasRole(
                                                                        user.user.id,
                                                                        collabdocUser[1].id,
                                                                        MANAGER,
                                                                        (err, hasRole) => {
                                                                          assert.notExists(err);
                                                                          assert.strictEqual(hasRole, true);
                                                                          AuthzAPI.hasAnyRole(
                                                                            userToDelete.user.id,
                                                                            collabdocUser[1].id,
                                                                            (err, hasRole) => {
                                                                              assert.notExists(err);
                                                                              assert.strictEqual(hasRole, false);
                                                                              AuthzAPI.hasAnyRole(
                                                                                userArchive.archiveId,
                                                                                collabdocUser[1].id,
                                                                                (err, hasRole) => {
                                                                                  assert.notExists(err);
                                                                                  assert.strictEqual(hasRole, false);
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
    /**
     * Test that verifies definitive delation remove user roles on collabdoc
     */
    it('Verify if the user role is removed from the collabsheet', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 2: userToDelete, 3: userArchive } = users;

        // Generate collabdocs
        generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 4, TYPE_COLLABSHEET, (err, collabsheets) => {
          assert.notExists(err);
          generateCollabdocs(user.restContext, PRIVATE_VISIBILITY, 2, TYPE_COLLABSHEET, (err, collabsheetUser) => {
            assert.notExists(err);

            // Generate rights collabdocs
            generateRightContent(userToDelete, user, MANAGER, collabsheets[0], err => {
              assert.notExists(err);
              generateRightContent(userToDelete, user, EDITOR, collabsheets[1], err => {
                assert.notExists(err);
                generateRightContent(userToDelete, user, VIEWER, collabsheets[2], err => {
                  assert.notExists(err);
                  generateRightContent(user, userToDelete, EDITOR, collabsheetUser[0], err => {
                    assert.notExists(err);
                    generateRightContent(user, userToDelete, VIEWER, collabsheetUser[1], err => {
                      assert.notExists(err);

                      // Delete User
                      assertDataIsTransferredToArchiveUser(
                        asCambridgeTenantAdmin,
                        userToDelete,
                        userArchive,
                        (err, userArchive) => {
                          assert.notExists(err);
                          assert.ok(userArchive);

                          // Verify roles
                          AuthzAPI.hasAnyRole(userToDelete.user.id, collabsheets[0].id, (err, hasRole) => {
                            assert.notExists(err);
                            assert.strictEqual(hasRole, false);
                            AuthzAPI.hasAnyRole(userArchive.archiveId, collabsheets[0].id, (err, hasRole) => {
                              assert.notExists(err);
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(user.user.id, collabsheets[0].id, MANAGER, (err, hasRole) => {
                                assert.notExists(err);
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasAnyRole(userToDelete.user.id, collabsheets[1].id, (err, hasRole) => {
                                  assert.notExists(err);
                                  assert.strictEqual(hasRole, false);
                                  AuthzAPI.hasRole(
                                    userArchive.archiveId,
                                    collabsheets[1].id,
                                    MANAGER,
                                    (err, hasRole) => {
                                      assert.notExists(err);
                                      assert.strictEqual(hasRole, true);
                                      AuthzAPI.hasRole(user.user.id, collabsheets[1].id, EDITOR, (err, hasRole) => {
                                        assert.notExists(err);
                                        assert.strictEqual(hasRole, true);
                                        AuthzAPI.hasAnyRole(
                                          userToDelete.user.id,
                                          collabsheets[2].id,
                                          (err, hasRole) => {
                                            assert.notExists(err);
                                            assert.strictEqual(hasRole, false);
                                            AuthzAPI.hasRole(
                                              userArchive.archiveId,
                                              collabsheets[2].id,
                                              MANAGER,
                                              (err, hasRole) => {
                                                assert.notExists(err);
                                                assert.strictEqual(hasRole, true);
                                                AuthzAPI.hasRole(
                                                  user.user.id,
                                                  collabsheets[2].id,
                                                  VIEWER,
                                                  (err, hasRole) => {
                                                    assert.notExists(err);
                                                    assert.strictEqual(hasRole, true);
                                                    AuthzAPI.hasAnyRole(
                                                      userToDelete.user.id,
                                                      collabsheets[3].id,
                                                      (err, hasRole) => {
                                                        assert.notExists(err);
                                                        assert.strictEqual(hasRole, false);
                                                        AuthzAPI.hasRole(
                                                          userArchive.archiveId,
                                                          collabsheets[3].id,
                                                          MANAGER,
                                                          (err, hasRole) => {
                                                            assert.notExists(err);
                                                            assert.strictEqual(hasRole, true);
                                                            AuthzAPI.hasAnyRole(
                                                              user.user.id,
                                                              collabsheets[3].id,
                                                              (err, hasRole) => {
                                                                assert.notExists(err);
                                                                assert.strictEqual(hasRole, false);
                                                                AuthzAPI.hasRole(
                                                                  user.user.id,
                                                                  collabsheetUser[0].id,
                                                                  MANAGER,
                                                                  (err, hasRole) => {
                                                                    assert.notExists(err);
                                                                    assert.strictEqual(hasRole, true);
                                                                    AuthzAPI.hasAnyRole(
                                                                      userToDelete.user.id,
                                                                      collabsheetUser[0].id,
                                                                      (err, hasRole) => {
                                                                        assert.notExists(err);
                                                                        assert.strictEqual(hasRole, false);
                                                                        AuthzAPI.hasAnyRole(
                                                                          userArchive.archiveId,
                                                                          collabsheetUser[0].id,
                                                                          (err, hasRole) => {
                                                                            assert.notExists(err);
                                                                            assert.strictEqual(hasRole, false);
                                                                            AuthzAPI.hasRole(
                                                                              user.user.id,
                                                                              collabsheetUser[1].id,
                                                                              MANAGER,
                                                                              (err, hasRole) => {
                                                                                assert.notExists(err);
                                                                                assert.strictEqual(hasRole, true);
                                                                                AuthzAPI.hasAnyRole(
                                                                                  userToDelete.user.id,
                                                                                  collabsheetUser[1].id,
                                                                                  (err, hasRole) => {
                                                                                    assert.notExists(err);
                                                                                    assert.strictEqual(hasRole, false);
                                                                                    AuthzAPI.hasAnyRole(
                                                                                      userArchive.archiveId,
                                                                                      collabsheetUser[1].id,
                                                                                      (err, hasRole) => {
                                                                                        assert.notExists(err);
                                                                                        assert.strictEqual(
                                                                                          hasRole,
                                                                                          false
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
                                                          }
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

    /**
     * Test that verifies definitive delation remove user roles on file
     */
    it('Verify if the user role is removed from the file', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 2: userToDelete, 3: userArchive } = users;

        // Generate files
        generateFiles(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, files) => {
          assert.notExists(err);
          generateFiles(user.restContext, PRIVATE_VISIBILITY, 1, (err, file) => {
            assert.notExists(err);

            // Generate rights files
            generateRightContent(userToDelete, user, MANAGER, files[0], err => {
              assert.notExists(err);
              generateRightContent(userToDelete, user, VIEWER, files[1], err => {
                assert.notExists(err);
                generateRightContent(user, userToDelete, VIEWER, file[0], err => {
                  assert.notExists(err);

                  // Delete User
                  assertDataIsTransferredToArchiveUser(
                    asCambridgeTenantAdmin,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.notExists(err);
                      assert.ok(userArchive);

                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, files[0].id, (err, hasRole) => {
                        assert.notExists(err);
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, files[0].id, (err, hasRole) => {
                          assert.notExists(err);
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasRole(user.user.id, files[0].id, MANAGER, (err, hasRole) => {
                            assert.notExists(err);
                            assert.strictEqual(hasRole, true);
                            AuthzAPI.hasAnyRole(userToDelete.user.id, files[1].id, (err, hasRole) => {
                              assert.notExists(err);
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(userArchive.archiveId, files[1].id, MANAGER, (err, hasRole) => {
                                assert.notExists(err);
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasRole(user.user.id, files[1].id, VIEWER, (err, hasRole) => {
                                  assert.notExists(err);
                                  assert.strictEqual(hasRole, true);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, files[2].id, (err, hasRole) => {
                                    assert.notExists(err);
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasRole(userArchive.archiveId, files[2].id, MANAGER, (err, hasRole) => {
                                      assert.notExists(err);
                                      assert.strictEqual(hasRole, true);
                                      AuthzAPI.hasAnyRole(user.user.id, files[2].id, (err, hasRole) => {
                                        assert.notExists(err);
                                        assert.strictEqual(hasRole, false);
                                        AuthzAPI.hasRole(user.user.id, file[0].id, MANAGER, (err, hasRole) => {
                                          assert.notExists(err);
                                          assert.strictEqual(hasRole, true);
                                          AuthzAPI.hasAnyRole(userToDelete.user.id, file[0].id, (err, hasRole) => {
                                            assert.notExists(err);
                                            assert.strictEqual(hasRole, false);
                                            AuthzAPI.hasAnyRole(userArchive.archiveId, file[0].id, (err, hasRole) => {
                                              assert.notExists(err);
                                              assert.strictEqual(hasRole, false);
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
     * Test that verifies definitive delation remove user roles on meeting
     */
    it('Verify if the user role is removed from the meeting', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);

        const { 0: user, 2: userToDelete, 3: userArchive } = users;

        // Generate meetings
        generateMeetings(userToDelete.restContext, userToDelete.user, PRIVATE_VISIBILITY, 3, (err, meetings) => {
          assert.notExists(err);
          generateMeetings(user.restContext, user.user, PRIVATE_VISIBILITY, 1, (err, meeting) => {
            assert.notExists(err);
            // Generate rights meetings
            generateRightMeeting(asCambridgeTenantAdmin, userToDelete, user, MANAGER, meetings[0], err => {
              assert.notExists(err);
              generateRightMeeting(asCambridgeTenantAdmin, userToDelete, user, MEMBER, meetings[1], err => {
                assert.notExists(err);
                generateRightMeeting(asCambridgeTenantAdmin, user, userToDelete, MEMBER, meeting[0], err => {
                  assert.notExists(err);

                  // Delete User
                  assertDataIsTransferredToArchiveUser(
                    asCambridgeTenantAdmin,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.notExists(err);
                      assert.ok(userArchive);
                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, meetings[0].id, (err, hasRole) => {
                        assert.notExists(err);
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, meetings[0].id, (err, hasRole) => {
                          assert.notExists(err);
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasRole(user.user.id, meetings[0].id, MANAGER, (err, hasRole) => {
                            assert.notExists(err);
                            assert.strictEqual(hasRole, true);
                            AuthzAPI.hasAnyRole(userToDelete.user.id, meetings[1].id, (err, hasRole) => {
                              assert.notExists(err);
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(userArchive.archiveId, meetings[1].id, MANAGER, (err, hasRole) => {
                                assert.notExists(err);
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasRole(user.user.id, meetings[1].id, MEMBER, (err, hasRole) => {
                                  assert.notExists(err);
                                  assert.strictEqual(hasRole, true);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, meetings[2].id, (err, hasRole) => {
                                    assert.notExists(err);
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasRole(userArchive.archiveId, meetings[2].id, MANAGER, (err, hasRole) => {
                                      assert.notExists(err);
                                      assert.strictEqual(hasRole, true);
                                      AuthzAPI.hasAnyRole(user.user.id, meetings[2].id, (err, hasRole) => {
                                        assert.notExists(err);
                                        assert.strictEqual(hasRole, false);
                                        AuthzAPI.hasRole(user.user.id, meeting[0].id, MANAGER, (err, hasRole) => {
                                          assert.notExists(err);
                                          assert.strictEqual(hasRole, true);
                                          AuthzAPI.hasAnyRole(userToDelete.user.id, meeting[0].id, (err, hasRole) => {
                                            assert.notExists(err);
                                            assert.strictEqual(hasRole, false);
                                            AuthzAPI.hasAnyRole(
                                              userArchive.archiveId,
                                              meeting[0].id,
                                              (err, hasRole) => {
                                                assert.notExists(err);
                                                assert.strictEqual(hasRole, false);
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
      });
    });

    /**
     * Test that verifies definitive delation remove user roles on discussion
     */
    it('Verify if the user role is removed from the discussion', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 2: userToDelete, 3: userArchive } = users;

        // Generate discussions
        generateDiscussions(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, discussions) => {
          assert.notExists(err);
          generateDiscussions(user.restContext, PRIVATE_VISIBILITY, 1, (err, discussion) => {
            assert.notExists(err);

            // Generate rights discussions
            generateRightDiscussion(userToDelete, user, MANAGER, discussions[0], err => {
              assert.notExists(err);
              generateRightDiscussion(userToDelete, user, MEMBER, discussions[1], err => {
                assert.notExists(err);
                generateRightDiscussion(user, userToDelete, MEMBER, discussion[0], err => {
                  assert.notExists(err);

                  // Delete User
                  assertDataIsTransferredToArchiveUser(
                    asCambridgeTenantAdmin,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.notExists(err);
                      assert.ok(userArchive);

                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, discussions[0].id, (err, hasRole) => {
                        assert.notExists(err);
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, discussions[0].id, (err, hasRole) => {
                          assert.notExists(err);
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasRole(user.user.id, discussions[0].id, MANAGER, (err, hasRole) => {
                            assert.notExists(err);
                            assert.strictEqual(hasRole, true);
                            AuthzAPI.hasAnyRole(userToDelete.user.id, discussions[1].id, (err, hasRole) => {
                              assert.notExists(err);
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(userArchive.archiveId, discussions[1].id, MANAGER, (err, hasRole) => {
                                assert.notExists(err);
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasRole(user.user.id, discussions[1].id, MEMBER, (err, hasRole) => {
                                  assert.notExists(err);
                                  assert.strictEqual(hasRole, true);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, discussions[2].id, (err, hasRole) => {
                                    assert.notExists(err);
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasRole(
                                      userArchive.archiveId,
                                      discussions[2].id,
                                      MANAGER,
                                      (err, hasRole) => {
                                        assert.notExists(err);
                                        assert.strictEqual(hasRole, true);
                                        AuthzAPI.hasAnyRole(user.user.id, discussions[2].id, (err, hasRole) => {
                                          assert.notExists(err);
                                          assert.strictEqual(hasRole, false);
                                          AuthzAPI.hasRole(user.user.id, discussion[0].id, MANAGER, (err, hasRole) => {
                                            assert.notExists(err);
                                            assert.strictEqual(hasRole, true);
                                            AuthzAPI.hasAnyRole(
                                              userToDelete.user.id,
                                              discussion[0].id,
                                              (err, hasRole) => {
                                                assert.notExists(err);
                                                assert.strictEqual(hasRole, false);
                                                AuthzAPI.hasAnyRole(
                                                  userArchive.archiveId,
                                                  discussion[0].id,
                                                  (err, hasRole) => {
                                                    assert.notExists(err);
                                                    assert.strictEqual(hasRole, false);
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
      });
    });

    /**
     * Test that verifies definitive delation remove user roles on group
     */
    it('Verify if the user role is removed from the group', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 2: userToDelete, 3: userArchive } = users;

        // Generate groups
        generateGroups(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, groups) => {
          assert.notExists(err);
          generateGroups(user.restContext, PRIVATE_VISIBILITY, 1, (err, group) => {
            assert.notExists(err);

            // Generate rights groups
            generateRightsForGroup(userToDelete, user, MANAGER, groups[0], err => {
              assert.notExists(err);
              generateRightsForGroup(userToDelete, user, MEMBER, groups[1], err => {
                assert.notExists(err);
                generateRightsForGroup(user, userToDelete, MEMBER, group[0], err => {
                  assert.notExists(err);

                  // Delete User
                  assertDataIsTransferredToArchiveUser(
                    asCambridgeTenantAdmin,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.notExists(err);
                      assert.ok(userArchive);

                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, groups[0].id, (err, hasRole) => {
                        assert.notExists(err);
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, groups[0].id, (err, hasRole) => {
                          assert.notExists(err);
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasRole(user.user.id, groups[0].id, MANAGER, (err, hasRole) => {
                            assert.notExists(err);
                            assert.strictEqual(hasRole, true);
                            AuthzAPI.hasAnyRole(userToDelete.user.id, groups[1].id, (err, hasRole) => {
                              assert.notExists(err);
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(userArchive.archiveId, groups[1].id, MANAGER, (err, hasRole) => {
                                assert.notExists(err);
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasRole(user.user.id, groups[1].id, MEMBER, (err, hasRole) => {
                                  assert.notExists(err);
                                  assert.strictEqual(hasRole, true);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, groups[2].id, (err, hasRole) => {
                                    assert.notExists(err);
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasRole(userArchive.archiveId, groups[2].id, MANAGER, (err, hasRole) => {
                                      assert.notExists(err);
                                      assert.strictEqual(hasRole, true);
                                      AuthzAPI.hasAnyRole(user.user.id, groups[2].id, (err, hasRole) => {
                                        assert.notExists(err);
                                        assert.strictEqual(hasRole, false);
                                        AuthzAPI.hasRole(user.user.id, group[0].id, MANAGER, (err, hasRole) => {
                                          assert.notExists(err);
                                          assert.strictEqual(hasRole, true);
                                          AuthzAPI.hasAnyRole(userToDelete.user.id, group[0].id, (err, hasRole) => {
                                            assert.notExists(err);
                                            assert.strictEqual(hasRole, false);
                                            AuthzAPI.hasAnyRole(userArchive.archiveId, group[0].id, (err, hasRole) => {
                                              assert.notExists(err);
                                              assert.strictEqual(hasRole, false);
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
     * Test that verifies definitive delation remove user roles on folder
     */
    it('Verify if the user role is removed from the folder', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 2: userToDelete, 3: userArchive } = users;

        // Generate folders
        generateFolders(userToDelete, PRIVATE_VISIBILITY, 3, (err, folders) => {
          assert.notExists(err);
          generateFolders(user, PRIVATE_VISIBILITY, 1, (err, folder) => {
            assert.notExists(err);

            // Generate rights folders
            generateRightFolder(userToDelete, user, MANAGER, folders[0], err => {
              assert.notExists(err);
              generateRightFolder(userToDelete, user, VIEWER, folders[1], err => {
                assert.notExists(err);
                generateRightFolder(user, userToDelete, VIEWER, folder[0], err => {
                  assert.notExists(err);

                  // Delete User
                  assertDataIsTransferredToArchiveUser(
                    asCambridgeTenantAdmin,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.notExists(err);
                      assert.ok(userArchive);

                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, folders[0].groupId, (err, hasRole) => {
                        assert.notExists(err);
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, folders[0].groupId, (err, hasRole) => {
                          assert.notExists(err);
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasRole(user.user.id, folders[0].groupId, MANAGER, (err, hasRole) => {
                            assert.notExists(err);
                            assert.strictEqual(hasRole, true);
                            AuthzAPI.hasAnyRole(userToDelete.user.id, folders[1].groupId, (err, hasRole) => {
                              assert.notExists(err);
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(userArchive.archiveId, folders[1].groupId, MANAGER, (err, hasRole) => {
                                assert.notExists(err);
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasRole(user.user.id, folders[1].groupId, VIEWER, (err, hasRole) => {
                                  assert.notExists(err);
                                  assert.strictEqual(hasRole, true);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, folders[2].groupId, (err, hasRole) => {
                                    assert.notExists(err);
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasRole(
                                      userArchive.archiveId,
                                      folders[2].groupId,
                                      MANAGER,
                                      (err, hasRole) => {
                                        assert.notExists(err);
                                        assert.strictEqual(hasRole, true);
                                        AuthzAPI.hasAnyRole(user.user.id, folders[2].groupId, (err, hasRole) => {
                                          assert.notExists(err);
                                          assert.strictEqual(hasRole, false);
                                          AuthzAPI.hasRole(user.user.id, folder[0].groupId, MANAGER, (err, hasRole) => {
                                            assert.notExists(err);
                                            assert.strictEqual(hasRole, true);
                                            AuthzAPI.hasAnyRole(
                                              userToDelete.user.id,
                                              folder[0].groupId,
                                              (err, hasRole) => {
                                                assert.notExists(err);
                                                assert.strictEqual(hasRole, false);
                                                AuthzAPI.hasAnyRole(
                                                  userArchive.archiveId,
                                                  folder[0].groupId,
                                                  (err, hasRole) => {
                                                    assert.notExists(err);
                                                    assert.strictEqual(hasRole, false);
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
      });
    });

    /**
     * Test that verifies the data in the table DataArchive
     */
    it('Verify the completeness of the data contained in the DataArchive table', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 2: userToDelete, 3: userArchive } = users;

        // Generate element
        const list = [];
        generateFolders(userToDelete, PRIVATE_VISIBILITY, 1, (err, folder) => {
          assert.notExists(err);
          generateGroups(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, group) => {
            assert.notExists(err);
            generateDiscussions(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, discussion) => {
              assert.notExists(err);
              generateMeetings(userToDelete.restContext, userToDelete.user, PRIVATE_VISIBILITY, 1, (err, meeting) => {
                assert.notExists(err);
                generateFiles(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, file) => {
                  assert.notExists(err);
                  generateLinks(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, link) => {
                    assert.notExists(err);
                    generateCollabdocs(
                      userToDelete.restContext,
                      PRIVATE_VISIBILITY,
                      1,
                      TYPE_COLLABDOC,
                      (err, collabdoc) => {
                        assert.notExists(err);
                        generateCollabdocs(
                          userToDelete.restContext,
                          PRIVATE_VISIBILITY,
                          1,
                          TYPE_COLLABSHEET,
                          (err, collabsheet) => {
                            assert.notExists(err);

                            // Add element to a list
                            list.push(group[0].id);
                            list.push(discussion[0].id);
                            list.push(meeting[0].id);
                            list.push(file[0].id);
                            list.push(link[0].id);
                            list.push(collabdoc[0].id);
                            list.push(collabsheet[0].id);
                            list.push(folder[0].id);

                            // Delete User
                            assertDataIsTransferredToArchiveUser(
                              asCambridgeTenantAdmin,
                              userToDelete,
                              userArchive,
                              (err, userArchive) => {
                                assert.notExists(err);
                                assert.ok(userArchive);

                                // Get Data and compare it with the id list
                                getDataFromArchive(userArchive.archiveId, userToDelete.user.id, (err, elements) => {
                                  const listElementId = [];
                                  elements.resourceId.split(',').forEach(element => {
                                    listElementId.push(element);
                                  });

                                  assert.notExists(err);
                                  assert.deepStrictEqual(list.sort(), listElementId.sort());
                                  return callback();
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
          });
        });
      });
    });

    /**
     * Test that verifies the data in the table DataArchive
     */
    it('Verify if discussions are in the library of userArchive after the deletion of a user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);
        const { 0: userToDelete, 1: userArchive } = users;

        // Generate element
        generateDiscussions(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, discussion) => {
          assert.notExists(err);

          userArchive.archiveId = userArchive.user.id;

          // Delete User
          assertDataIsTransferredToArchiveUser(
            asCambridgeTenantAdmin,
            userToDelete,
            userArchive,
            (err, userArchive) => {
              assert.notExists(err);
              assert.ok(userArchive);

              // Discussion is in library
              checkLibrary(asCambridgeTenantAdmin, userArchive.archiveId, true, [discussion], () => {
                return callback();
              });
            }
          );
        });
      });
    });

    /**
     * Checks a principal library.
     *
     * @param  {RestContext}    restCtx         The context to use to do the request
     * @param  {String}         libraryOwnerId  The principal for which to retrieve the library
     * @param  {Boolean}        expectAccess    Whether or not retrieving the library should be successfull
     * @param  {Discussion[]}   expectedItems   The expected discussions that should return
     * @param  {Function}       callback        Standard callback function
     */
    const checkLibrary = (restCtx, libraryOwnerId, expectAccess, expectedItems, callback) => {
      RestAPI.Discussions.getDiscussionsLibrary(restCtx, libraryOwnerId, null, null, (err, items) => {
        if (expectAccess) {
          assert.notExists(err);

          // Make sure only the expected items are returned.
          assert.strictEqual(items.results.length, expectedItems.length);
          forEach(expectedDiscussion => {
            assert.ok(filter(propSatisfies(equals(expectedDiscussion.id), 'id'), items.results));
          }, expectedItems);
        } else {
          assert.strictEqual(err.code, 401);
          assert.isNotOk(items);
        }

        return callback();
      });
    };

    /**
     * Test that verifies if elements are in the library
     */
    it('Verify if groups are in the library of userArchive after the deletion of a user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);
        const { 0: userToDelete, 1: userArchive } = users;

        // Generate element
        generateGroups(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, group) => {
          assert.notExists(err);

          // Delete User
          assertDataIsTransferredToArchiveUser(
            asCambridgeTenantAdmin,
            userToDelete,
            userArchive,
            (err, userArchive) => {
              assert.notExists(err);
              assert.ok(userArchive);

              // Groups is in library
              RestAPI.Group.getMembershipsLibrary(
                asCambridgeTenantAdmin,
                userArchive.archiveId,
                null,
                group.length,
                (err, data) => {
                  assert.notExists(err);
                  const library = data.results;
                  assert.strictEqual(library.length, group.length);
                  assert.strictEqual(library[0].id, group[0].id);

                  return callback();
                }
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies if elements are in the library
     */
    it('Verify if contents are in the library of userArchive after the deletion of a user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);
        const { 0: userToDelete, 1: userArchive } = users;
        const list = [];

        // Generate element
        generateFiles(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, file) => {
          assert.notExists(err);
          generateLinks(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, link) => {
            assert.notExists(err);
            generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 1, TYPE_COLLABDOC, (err, collabdoc) => {
              assert.notExists(err);
              generateCollabdocs(
                userToDelete.restContext,
                PRIVATE_VISIBILITY,
                1,
                TYPE_COLLABSHEET,
                (err, collabsheet) => {
                  assert.notExists(err);

                  list.push(file[0].id);
                  list.push(link[0].id);
                  list.push(collabdoc[0].id);
                  list.push(collabsheet[0].id);
                  list.sort();

                  // Delete User
                  assertDataIsTransferredToArchiveUser(
                    asCambridgeTenantAdmin,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.notExists(err);
                      assert.ok(userArchive);

                      // Content is in library
                      RestAPI.Content.getLibrary(
                        asCambridgeTenantAdmin,
                        userArchive.archiveId,
                        null,
                        list.length,
                        (err, data) => {
                          assert.notExists(err);
                          const library = [];
                          data.results.forEach(element => {
                            library.push(element.id);
                          });
                          library.sort();
                          assert.deepStrictEqual(library, list);

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
    });

    /**
     * Test that verifies if elements are in the library
     */
    it('Verify if meetings are in the library of userArchive after the deletion of a user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);
        const { 0: userToDelete, 1: userArchive } = users;

        // Generate element
        generateMeetings(userToDelete.restContext, userToDelete.user, PRIVATE_VISIBILITY, 1, (err, meeting) => {
          assert.notExists(err);

          // Delete User
          assertDataIsTransferredToArchiveUser(
            asCambridgeTenantAdmin,
            userToDelete,
            userArchive,
            (err, userArchive) => {
              assert.notExists(err);
              assert.ok(userArchive);

              // Meeting is in library
              MeetingAPI.getMeetingsLibrary(asCambridgeTenantAdmin, userArchive.archiveId, null, null, (err, data) => {
                assert.notExists(err);
                assert.strictEqual(data.length, meeting.length);
                assert.strictEqual(data[0].id, meeting[0].id);

                return callback();
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies if elements are in the library
     */
    it('Verify if folders are in the library of userArchive after the deletion of a user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);
        const { 0: userToDelete, 1: userArchive } = users;

        // Generate element
        generateFolders(userToDelete, PRIVATE_VISIBILITY, 1, (err, folder) => {
          assert.notExists(err);

          // Delete User
          assertDataIsTransferredToArchiveUser(
            asCambridgeTenantAdmin,
            userToDelete,
            userArchive,
            (err, userArchive) => {
              assert.notExists(err);
              assert.ok(userArchive);

              // Folder is in library
              FoldersTestUtil.assertGetAllFoldersLibrarySucceeds(asCambridgeTenantAdmin, userArchive.archiveId, null, (
                library /* , responses */
              ) => {
                assert.strictEqual(library.length, folder.length);
                assert.strictEqual(library[0].id, folder[0].id);

                return callback();
              });
            }
          );
        });
      });
    });
  });

  describe('Delete user - step 2 "elimination"', () => {
    /**
     * Test that verifies removing followers
     */
    it('Verify that elimination removes followers', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
        assert.notExists(err);
        const { 0: userArchive } = users;

        // Create 2 users, one following the other
        FollowingTestsUtil.createFollowerAndFollowed(asCambridgeTenantAdmin, (follower, followed) => {
          // Ensure the follower and following feeds indicate they are indeed following
          FollowingTestsUtil.assertFollows(
            follower.user.id,
            follower.restContext,
            followed.user.id,
            followed.restContext,
            () => {
              assertDataIsTransferredToArchiveUser(
                asCambridgeTenantAdmin,
                followed,
                userArchive,
                (err, userArchive) => {
                  assert.notExists(err);
                  assert.ok(userArchive);

                  // Delete user
                  eliminateUser(asCambridgeTenantAdmin, followed.user, userArchive.tenantAlias, err => {
                    assert.notExists(err);

                    // Ensure the follower and following feeds indicate they are no longer following
                    assertDoesNotFollow(follower.user.id, followed.user.id, callback);
                  });
                }
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies removing following
     */
    it('Verify that elimination removes following', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
        assert.notExists(err);
        const { 0: userArchive } = users;

        // Create 2 users, one following the other
        FollowingTestsUtil.createFollowerAndFollowed(asCambridgeTenantAdmin, (follower, followed) => {
          // Ensure the follower and following feeds indicate they are indeed following
          FollowingTestsUtil.assertFollows(
            follower.user.id,
            follower.restContext,
            followed.user.id,
            followed.restContext,
            () => {
              // Delete user
              assertDataIsTransferredToArchiveUser(
                asCambridgeTenantAdmin,
                follower,
                userArchive,
                (err, userArchive) => {
                  assert.notExists(err);
                  assert.ok(userArchive);

                  // Delete user
                  eliminateUser(asCambridgeTenantAdmin, follower.user, userArchive.tenantAlias, err => {
                    assert.notExists(err);

                    // Ensure the follower and following feeds indicate they are no longer following
                    assertDoesNotFollow(follower.user.id, followed.user.id, callback);
                  });
                }
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies rights of user archive on meeting
     */
    it('Verify if elimination correctly assigns the permissions to the user archive on meeting', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 2: userToDelete, 3: userArchive } = users;

        // Generate element
        generateMeetings(userToDelete.restContext, userToDelete.user, PRIVATE_VISIBILITY, 1, (err, meeting) => {
          assert.notExists(err);

          // Delete User
          assertDataIsTransferredToArchiveUser(
            asCambridgeTenantAdmin,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.notExists(err);
              assert.ok(resUserArchive);

              // Get Data and compare it with the id list
              getDataFromArchive(userArchive.archiveId, userToDelete.user.id, (err, data) => {
                assert.notExists(err);
                assert.deepStrictEqual(data.resourceId, meeting[0].id);

                eliminateUser(asCambridgeTenantAdmin, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.notExists(err);

                  AuthzAPI.hasAnyRole(userToDelete.user.id, meeting[0].id, (err, hasRole) => {
                    assert.notExists(err);
                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, meeting[0].id, (err, hasRole) => {
                      assert.notExists(err);
                      assert.strictEqual(hasRole, false);
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
     * Test that verifies rights of user archive
     */
    it('Verify if elimination correctly assigns the permissions to the user archive on content', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 2: userToDelete, 3: userArchive } = users;

        // Generate element
        generateFiles(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, file) => {
          assert.notExists(err);
          generateLinks(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, link) => {
            assert.notExists(err);
            generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 1, TYPE_COLLABDOC, (err, collabdoc) => {
              assert.notExists(err);
              generateCollabdocs(
                userToDelete.restContext,
                PRIVATE_VISIBILITY,
                1,
                TYPE_COLLABSHEET,
                (err, collabsheet) => {
                  assert.notExists(err);

                  // Delete User
                  assertDataIsTransferredToArchiveUser(
                    asCambridgeTenantAdmin,
                    userToDelete,
                    userArchive,
                    (err, resUserArchive) => {
                      assert.notExists(err);
                      assert.ok(resUserArchive);

                      // Get Data and compare it with the id list
                      getDataFromArchive(userArchive.archiveId, userToDelete.user.id, (err, data) => {
                        assert.notExists(err);
                        const listContentFromArchive = data.resourceId.split(',');
                        const listContent = [link[0].id, file[0].id, collabdoc[0].id, collabsheet[0].id];
                        assert.deepStrictEqual(listContentFromArchive.sort(), listContent.sort());

                        eliminateUser(asCambridgeTenantAdmin, userToDelete.user, resUserArchive.tenantAlias, err => {
                          assert.notExists(err);

                          // Verify roles
                          AuthzAPI.hasAnyRole(userToDelete.user.id, link[0].id, (err, hasRole) => {
                            assert.notExists(err);
                            assert.strictEqual(hasRole, false);
                            AuthzAPI.hasAnyRole(userArchive.archiveId, link[0].id, (err, hasRole) => {
                              assert.notExists(err);
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasAnyRole(userToDelete.user.id, file[0].id, (err, hasRole) => {
                                assert.notExists(err);
                                assert.strictEqual(hasRole, false);
                                AuthzAPI.hasAnyRole(userArchive.archiveId, file[0].id, (err, hasRole) => {
                                  assert.notExists(err);
                                  assert.strictEqual(hasRole, false);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, collabdoc[0].id, (err, hasRole) => {
                                    assert.notExists(err);
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasAnyRole(userToDelete.user.id, collabsheet[0].id, (err, hasRole) => {
                                      assert.notExists(err);
                                      assert.strictEqual(hasRole, false);
                                      AuthzAPI.hasAnyRole(userArchive.archiveId, collabdoc[0].id, (err, hasRole) => {
                                        assert.notExists(err);
                                        assert.strictEqual(hasRole, false);
                                        AuthzAPI.hasAnyRole(
                                          userArchive.archiveId,
                                          collabsheet[0].id,
                                          (err, hasRole) => {
                                            assert.notExists(err);
                                            assert.strictEqual(hasRole, false);
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

    /**
     * Test that verifies rights of user archive on group
     */
    it('Verify if elimination correctly assigns the permissions to the user archive on group', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 2: userToDelete, 3: userArchive } = users;

        // Generate element
        generateGroups(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, group) => {
          assert.notExists(err);

          // Delete User
          assertDataIsTransferredToArchiveUser(
            asCambridgeTenantAdmin,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.notExists(err);
              assert.ok(resUserArchive);

              // Get Data and compare it with the id list
              getDataFromArchive(userArchive.archiveId, userToDelete.user.id, (err, data) => {
                assert.notExists(err);
                assert.deepStrictEqual(data.resourceId, group[0].id);

                eliminateUser(asCambridgeTenantAdmin, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.notExists(err);

                  // Verify roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, group[0].id, (err, hasRole) => {
                    assert.notExists(err);
                    assert.strictEqual(hasRole, false);

                    AuthzAPI.hasAnyRole(userArchive.archiveId, group[0].id, (err, hasRole) => {
                      assert.notExists(err);
                      assert.strictEqual(hasRole, false);
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
     * Test that verifies rights of user archive on discussion
     */
    it('Verify if elimination correctly assigns the permissions to the user archive on discussion', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 2: userToDelete, 3: userArchive } = users;

        // Generate element
        generateDiscussions(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, discussion) => {
          assert.notExists(err);

          // Delete User
          assertDataIsTransferredToArchiveUser(
            asCambridgeTenantAdmin,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.notExists(err);
              assert.ok(resUserArchive);

              // Get Data and compare it with the id list
              getDataFromArchive(userArchive.archiveId, userToDelete.user.id, (err, data) => {
                assert.notExists(err);
                assert.deepStrictEqual(data.resourceId, discussion[0].id);

                eliminateUser(asCambridgeTenantAdmin, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.notExists(err);

                  // Verify roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, discussion[0].id, (err, hasRole) => {
                    assert.notExists(err);

                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, discussion[0].id, (err, hasRole) => {
                      assert.notExists(err);
                      assert.strictEqual(hasRole, false);
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
     * Test that verifies rights of user archive on folder
     */
    it('Verify if elimination correctly assigns the permissions to the user archive on folder', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 2: userToDelete, 3: userArchive } = users;

        // Generate element
        generateFolders(userToDelete, PRIVATE_VISIBILITY, 1, (err, folder) => {
          assert.notExists(err);

          // Delete User
          assertDataIsTransferredToArchiveUser(
            asCambridgeTenantAdmin,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.notExists(err);
              assert.ok(resUserArchive);

              // Get Data and compare it with the id list
              getDataFromArchive(userArchive.archiveId, userToDelete.user.id, (err, data) => {
                assert.notExists(err);
                assert.deepStrictEqual(data.resourceId, folder[0].id);

                eliminateUser(asCambridgeTenantAdmin, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.notExists(err);

                  // Verify roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, folder[0].groupId, (err, hasRole) => {
                    assert.notExists(err);
                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, folder[0].groupId, (err, hasRole) => {
                      assert.notExists(err);
                      assert.strictEqual(hasRole, false);
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
     * Test that verifies rights of user archive on link && file && collabdoc
     */
    it("Verify that elimination doesn't remove the content if a manager has been added to the content", callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 2: userToDelete, 3: userArchive } = users;

        // Generate element
        generateFiles(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, file) => {
          assert.notExists(err);
          generateLinks(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, link) => {
            assert.notExists(err);
            generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 1, TYPE_COLLABDOC, (err, collabdoc) => {
              assert.notExists(err);
              generateCollabdocs(
                userToDelete.restContext,
                PRIVATE_VISIBILITY,
                1,
                TYPE_COLLABSHEET,
                (err, collabsheet) => {
                  assert.notExists(err);

                  // Transfer all permissions on content before elimitating
                  assertDataIsTransferredToArchiveUser(
                    asCambridgeTenantAdmin,
                    userToDelete,
                    userArchive,
                    (err, resUserArchive) => {
                      assert.notExists(err);
                      assert.ok(resUserArchive);

                      // Generate rights
                      generateRightContent(userArchive, user, MANAGER, file[0], err => {
                        assert.notExists(err);
                        generateRightContent(userArchive, user, MANAGER, link[0], err => {
                          assert.notExists(err);
                          generateRightContent(userArchive, user, MANAGER, collabdoc[0], err => {
                            assert.notExists(err);
                            generateRightContent(userArchive, user, MANAGER, collabsheet[0], err => {
                              assert.notExists(err);

                              eliminateUser(
                                asCambridgeTenantAdmin,
                                userToDelete.user,
                                resUserArchive.tenantAlias,
                                err => {
                                  assert.notExists(err);

                                  // Check roles
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, file[0].id, (err, hasRole) => {
                                    assert.notExists(err);
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasAnyRole(userArchive.archiveId, file[0].id, (err, hasRole) => {
                                      assert.notExists(err);
                                      assert.strictEqual(hasRole, false);
                                      AuthzAPI.hasAnyRole(user.user.id, file[0].id, (err, hasRole) => {
                                        assert.notExists(err);
                                        assert.strictEqual(hasRole, true);
                                        AuthzAPI.hasAnyRole(userToDelete.user.id, link[0].id, (err, hasRole) => {
                                          assert.notExists(err);
                                          assert.strictEqual(hasRole, false);
                                          AuthzAPI.hasAnyRole(userArchive.archiveId, link[0].id, (err, hasRole) => {
                                            assert.notExists(err);
                                            assert.strictEqual(hasRole, false);
                                            AuthzAPI.hasAnyRole(user.user.id, link[0].id, (err, hasRole) => {
                                              assert.notExists(err);
                                              assert.strictEqual(hasRole, true);
                                              AuthzAPI.hasAnyRole(userToDelete.user.id, collabdoc[0].id, (
                                                err /* , hasRole */
                                              ) => {
                                                assert.notExists(err);
                                                AuthzAPI.hasAnyRole(
                                                  userToDelete.user.id,
                                                  collabsheet[0].id,
                                                  (err, hasRole) => {
                                                    assert.notExists(err);
                                                    assert.strictEqual(hasRole, false);
                                                    AuthzAPI.hasAnyRole(userArchive.archiveId, collabdoc[0].id, (
                                                      err /* , hasRole */
                                                    ) => {
                                                      assert.notExists(err);
                                                      AuthzAPI.hasAnyRole(
                                                        userArchive.archiveId,
                                                        collabsheet[0].id,
                                                        (err, hasRole) => {
                                                          assert.notExists(err);
                                                          assert.strictEqual(hasRole, false);
                                                          AuthzAPI.hasAnyRole(
                                                            user.user.id,
                                                            collabdoc[0].id,
                                                            (err, hasRole) => {
                                                              assert.notExists(err);
                                                              assert.strictEqual(hasRole, true);
                                                              AuthzAPI.hasAnyRole(
                                                                user.user.id,
                                                                collabsheet[0].id,
                                                                (err, hasRole) => {
                                                                  assert.notExists(err);
                                                                  assert.strictEqual(hasRole, true);
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
     * Test that verifies rights of user archive on meeting
     */
    it("Verify that elimination doesn't remove the content if a manager has been added to the meeting", callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 2: userToDelete, 3: userArchive } = users;

        // Generate element
        generateMeetings(userToDelete.restContext, userToDelete.user, PRIVATE_VISIBILITY, 1, (err, meeting) => {
          assert.notExists(err);

          // Delete User
          assertDataIsTransferredToArchiveUser(
            asCambridgeTenantAdmin,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.notExists(err);
              assert.ok(resUserArchive);

              // Generate rights meetings
              generateRightMeeting(asCambridgeTenantAdmin, userArchive, user, MANAGER, meeting[0], err => {
                assert.notExists(err);

                eliminateUser(asCambridgeTenantAdmin, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.notExists(err);

                  // Check roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, meeting[0].id, (err, hasRole) => {
                    assert.notExists(err);

                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, meeting[0].id, (err, hasRole) => {
                      assert.notExists(err);
                      assert.strictEqual(hasRole, false);
                      AuthzAPI.hasAnyRole(user.user.id, meeting[0].id, (err, hasRole) => {
                        assert.notExists(err);
                        assert.strictEqual(hasRole, true);
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
     * Test that verifies rights of user archive on discussion
     */
    it("Verify that elimination doesn't remove the content if a manager has been added to the discussion", callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 2: userToDelete, 3: userArchive } = users;

        // Generate element
        generateDiscussions(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, discussion) => {
          assert.notExists(err);

          // Delete User
          assertDataIsTransferredToArchiveUser(
            asCambridgeTenantAdmin,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.notExists(err);
              assert.ok(resUserArchive);

              // Generate rights discussion
              generateRightDiscussion(userArchive, user, MANAGER, discussion[0], err => {
                assert.notExists(err);

                eliminateUser(asCambridgeTenantAdmin, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.notExists(err);

                  // Check roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, discussion[0].id, (err, hasRole) => {
                    assert.notExists(err);
                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, discussion[0].id, (err, hasRole) => {
                      assert.notExists(err);
                      assert.strictEqual(hasRole, false);
                      AuthzAPI.hasAnyRole(user.user.id, discussion[0].id, (err, hasRole) => {
                        assert.notExists(err);
                        assert.strictEqual(hasRole, true);
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
     * Test that verifies rights of user archive on group
     */
    it("Verify that elimination doesn't remove the content if a manager has been added to the group", callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 2: userToDelete, 3: userArchive } = users;

        // Generate element
        generateGroups(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, group) => {
          assert.notExists(err);

          // Delete User
          assertDataIsTransferredToArchiveUser(
            asCambridgeTenantAdmin,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.notExists(err);
              assert.ok(resUserArchive);

              // Generate rights group
              assertJoinGroupSucceeds(userArchive.restContext, user.restContext, group[0].id, err => {
                assert.notExists(err);

                eliminateUser(asCambridgeTenantAdmin, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.notExists(err);

                  // Check roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, group[0].id, (err, hasRole) => {
                    assert.notExists(err);

                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, group[0].id, (err, hasRole) => {
                      assert.notExists(err);
                      assert.strictEqual(hasRole, false);
                      AuthzAPI.hasAnyRole(user.user.id, group[0].id, (err, hasRole) => {
                        assert.notExists(err);
                        assert.strictEqual(hasRole, true);
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
     * Test that verifies rights of user archive on folder
     */
    it("Verify that elimination doesn't remove the content if a manager has been added to the folder", callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 2: userToDelete, 3: userArchive } = users;

        // Generate element
        generateFolders(userToDelete, PRIVATE_VISIBILITY, 1, (err, folder) => {
          assert.notExists(err);

          // Delete User
          assertDataIsTransferredToArchiveUser(
            asCambridgeTenantAdmin,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.notExists(err);
              assert.ok(resUserArchive);

              // Generate rights folder
              generateRightFolder(userArchive, user, MANAGER, folder[0], err => {
                assert.notExists(err);

                eliminateUser(asCambridgeTenantAdmin, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.notExists(err);

                  // Check roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, folder[0].groupId, (err, hasRole) => {
                    assert.notExists(err);
                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, folder[0].groupId, (err, hasRole) => {
                      assert.notExists(err);
                      assert.strictEqual(hasRole, false);
                      AuthzAPI.hasAnyRole(user.user.id, folder[0].groupId, (err, hasRole) => {
                        assert.notExists(err);
                        assert.strictEqual(hasRole, true);
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
  });

  describe('Verify that when a user is eliminated the proper emails are sent to users', () => {
    /**
     * Test that verifies definitive delation send one email to each users
     */
    it('Send e-mail to users who shared files with the eliminated user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 1: otherUser, 2: userToDelete, 3: userArchive } = users;

        // Generate files
        generateFiles(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, files) => {
          assert.notExists(err);
          generateFiles(user.restContext, PRIVATE_VISIBILITY, 1, (err, file) => {
            assert.notExists(err);

            // Generate rights files
            generateRightContent(userToDelete, user, MANAGER, files[0], err => {
              assert.notExists(err);
              generateRightContent(userToDelete, user, VIEWER, files[1], err => {
                assert.notExists(err);
                generateRightContent(userToDelete, otherUser, VIEWER, files[1], err => {
                  assert.notExists(err);
                  generateRightContent(user, userToDelete, VIEWER, file[0], err => {
                    assert.notExists(err);
                    generateRightContent(userToDelete, user, VIEWER, files[2], err => {
                      assert.notExists(err);

                      const list = [];
                      list.push(otherUser.user.email);
                      list.push(user.user.email);
                      list.sort();

                      // Delete User
                      assertDataIsTransferredToArchiveUser(
                        asCambridgeTenantAdmin,
                        userToDelete,
                        userArchive,
                        (err, userArchive, listEmail) => {
                          assert.notExists(err);
                          listEmail.sort();
                          // Verify email
                          assert.deepStrictEqual(listEmail, list);
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
      });
    });

    /**
     * Test that verifies definitive delation send one email to each users
     */
    it('Send e-mail to users who shared links with the eliminated user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 1: otherUser, 2: userToDelete, 3: userArchive } = users;

        // Generate links
        generateLinks(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, links) => {
          assert.notExists(err);
          generateLinks(user.restContext, PRIVATE_VISIBILITY, 1, (err, link) => {
            assert.notExists(err);

            // Generate rights links
            generateRightContent(userToDelete, user, MANAGER, links[0], err => {
              assert.notExists(err);
              generateRightContent(userToDelete, user, VIEWER, links[1], err => {
                assert.notExists(err);
                generateRightContent(userToDelete, otherUser, VIEWER, links[1], err => {
                  assert.notExists(err);
                  generateRightContent(user, userToDelete, VIEWER, link[0], err => {
                    assert.notExists(err);
                    generateRightContent(userToDelete, user, VIEWER, links[2], err => {
                      assert.notExists(err);

                      const list = [];
                      list.push(otherUser.user.email);
                      list.push(user.user.email);
                      list.sort();

                      // Delete User
                      assertDataIsTransferredToArchiveUser(
                        asCambridgeTenantAdmin,
                        userToDelete,
                        userArchive,
                        (err, userArchive, listEmail) => {
                          assert.notExists(err);
                          listEmail.sort();

                          // Verify email
                          assert.deepStrictEqual(listEmail, list);
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
      });
    });

    /**
     * Test that verifies definitive delation send one email to each users
     */
    it('Send e-mail to users who shared collabdocs with the eliminated user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 1: otherUser, 2: userToDelete, 3: userArchive } = users;

        // Generate collabdocs
        generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 4, TYPE_COLLABDOC, (err, collabdocs) => {
          assert.notExists(err);
          generateCollabdocs(user.restContext, PRIVATE_VISIBILITY, 1, TYPE_COLLABDOC, (err, collabdocUser) => {
            assert.notExists(err);

            // Generate rights collabdocs
            generateRightContent(userToDelete, user, MANAGER, collabdocs[0], err => {
              assert.notExists(err);
              generateRightContent(userToDelete, user, EDITOR, collabdocs[1], err => {
                assert.notExists(err);
                generateRightContent(userToDelete, user, VIEWER, collabdocs[2], err => {
                  assert.notExists(err);
                  generateRightContent(user, userToDelete, EDITOR, collabdocUser[0], err => {
                    assert.notExists(err);
                    generateRightContent(userToDelete, otherUser, VIEWER, collabdocs[1], err => {
                      assert.notExists(err);
                      generateRightContent(userToDelete, otherUser, VIEWER, collabdocs[2], err => {
                        assert.notExists(err);

                        const list = [];
                        list.push(otherUser.user.email);
                        list.push(user.user.email);
                        list.sort();

                        // Delete User
                        assertDataIsTransferredToArchiveUser(
                          asCambridgeTenantAdmin,
                          userToDelete,
                          userArchive,
                          (err, userArchive, listEmail) => {
                            assert.notExists(err);
                            listEmail.sort();

                            // Verify email
                            assert.deepStrictEqual(listEmail, list);
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
        });
      });
    });

    /**
     * Test that verifies definitive delation send one email to each users
     */
    it('Send e-mail to users who shared collabsheets with the eliminated user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 1: otherUser, 2: userToDelete, 3: userArchive } = users;

        // Generate collabdocs
        generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 4, TYPE_COLLABSHEET, (err, collabsheets) => {
          assert.notExists(err);
          generateCollabdocs(user.restContext, PRIVATE_VISIBILITY, 1, TYPE_COLLABSHEET, (err, collabsheetUser) => {
            assert.notExists(err);

            // Generate rights collabdocs
            generateRightContent(userToDelete, user, MANAGER, collabsheets[0], err => {
              assert.notExists(err);
              generateRightContent(userToDelete, user, EDITOR, collabsheets[1], err => {
                assert.notExists(err);
                generateRightContent(userToDelete, user, VIEWER, collabsheets[2], err => {
                  assert.notExists(err);
                  generateRightContent(user, userToDelete, EDITOR, collabsheetUser[0], err => {
                    assert.notExists(err);
                    generateRightContent(userToDelete, otherUser, VIEWER, collabsheets[1], err => {
                      assert.notExists(err);
                      generateRightContent(userToDelete, otherUser, VIEWER, collabsheets[2], err => {
                        assert.notExists(err);

                        const list = [];
                        list.push(otherUser.user.email);
                        list.push(user.user.email);
                        list.sort();

                        // Delete User
                        assertDataIsTransferredToArchiveUser(
                          asCambridgeTenantAdmin,
                          userToDelete,
                          userArchive,
                          (err, userArchive, listEmail) => {
                            assert.notExists(err);
                            listEmail.sort();

                            // Verify email
                            assert.deepStrictEqual(listEmail, list);
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
        });
      });
    });

    /**
     * Test that verifies definitive delation send one email to each users
     */
    it('Send e-mail to users who shared meetings with the eliminated user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 1: otherUser, 2: userToDelete, 3: userArchive } = users;

        // Generate meetings
        generateMeetings(userToDelete.restContext, userToDelete.user, PRIVATE_VISIBILITY, 3, (err, meetings) => {
          assert.notExists(err);
          generateMeetings(user.restContext, user.user, PRIVATE_VISIBILITY, 1, (err, meeting) => {
            assert.notExists(err);

            // Generate rights links
            generateRightMeeting(asCambridgeTenantAdmin, userToDelete, user, MANAGER, meetings[0], err => {
              assert.notExists(err);
              generateRightMeeting(asCambridgeTenantAdmin, userToDelete, user, MEMBER, meetings[1], err => {
                assert.notExists(err);
                generateRightMeeting(asCambridgeTenantAdmin, userToDelete, otherUser, MEMBER, meetings[0], err => {
                  assert.notExists(err);
                  generateRightMeeting(asCambridgeTenantAdmin, user, userToDelete, MEMBER, meeting[0], err => {
                    assert.notExists(err);
                    generateRightMeeting(asCambridgeTenantAdmin, userToDelete, user, MEMBER, meetings[2], err => {
                      assert.notExists(err);

                      const list = [];
                      list.push(otherUser.user.email);
                      list.push(user.user.email);
                      list.sort();

                      // Delete User
                      assertDataIsTransferredToArchiveUser(
                        asCambridgeTenantAdmin,
                        userToDelete,
                        userArchive,
                        (err, userArchive, listEmail) => {
                          assert.notExists(err);
                          listEmail.sort();

                          // Verify email
                          assert.deepStrictEqual(listEmail, list);
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
      });
    });

    /**
     * Test that verifies definitive delation send one email to each users
     */
    it('Send e-mail to users who shared groups with the eliminated user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 1: otherUser, 2: userToDelete, 3: userArchive } = users;

        // Generate groups
        generateGroups(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, groups) => {
          assert.notExists(err);
          generateGroups(user.restContext, PRIVATE_VISIBILITY, 1, (err, group) => {
            assert.notExists(err);

            // Generate rights groups
            generateRightsForGroup(userToDelete, user, MANAGER, groups[0], err => {
              assert.notExists(err);
              generateRightsForGroup(userToDelete, user, MEMBER, groups[1], err => {
                assert.notExists(err);
                generateRightsForGroup(userToDelete, otherUser, MEMBER, groups[1], err => {
                  assert.notExists(err);
                  generateRightsForGroup(user, userToDelete, MEMBER, group[0], err => {
                    assert.notExists(err);
                    generateRightsForGroup(userToDelete, user, MEMBER, groups[2], err => {
                      assert.notExists(err);

                      const list = [];
                      list.push(otherUser.user.email);
                      list.push(user.user.email);
                      list.sort();

                      // Delete User
                      assertDataIsTransferredToArchiveUser(
                        asCambridgeTenantAdmin,
                        userToDelete,
                        userArchive,
                        (err, userArchive, listEmail) => {
                          assert.notExists(err);
                          listEmail.sort();

                          // Verify email
                          assert.deepStrictEqual(listEmail, list);
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
      });
    });

    /**
     * Test that verifies definitive delation send one email to each users
     */
    it('Send e-mail to users who shared folders with the eliminated user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(asCambridgeTenantAdmin, 4, (err, users) => {
        assert.notExists(err);
        const { 0: user, 1: otherUser, 2: userToDelete, 3: userArchive } = users;

        // Generate folders
        generateFolders(userToDelete, PRIVATE_VISIBILITY, 3, (err, folders) => {
          assert.notExists(err);
          generateFolders(user, PRIVATE_VISIBILITY, 1, (err, folder) => {
            assert.notExists(err);

            // Generate rights folders
            generateRightFolder(userToDelete, user, MANAGER, folders[0], err => {
              assert.notExists(err);
              generateRightFolder(userToDelete, user, VIEWER, folders[1], err => {
                assert.notExists(err);
                generateRightFolder(userToDelete, otherUser, VIEWER, folders[1], err => {
                  assert.notExists(err);
                  generateRightFolder(user, userToDelete, VIEWER, folder[0], err => {
                    assert.notExists(err);
                    generateRightFolder(userToDelete, user, VIEWER, folders[2], err => {
                      assert.notExists(err);

                      const list = [];
                      list.push(otherUser.user.email);
                      list.push(user.user.email);
                      list.sort();

                      // Delete User
                      assertDataIsTransferredToArchiveUser(
                        asCambridgeTenantAdmin,
                        userToDelete,
                        userArchive,
                        (err, userArchive, listEmail) => {
                          assert.notExists(err);
                          listEmail.sort();

                          // Verify email
                          assert.deepStrictEqual(listEmail, list);
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
      });
    });
  });
});
