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

import assert from 'assert';
import fs from 'fs';
import util from 'util';
import _ from 'underscore';

import * as AuthzAPI from 'oae-authz';
import * as AuthzDeleteAPI from 'oae-authz/lib/delete';
import { setUpConfig } from 'oae-config';
import * as ContentUtil from 'oae-content/lib/internal/util';
import * as FoldersTestUtil from 'oae-folders/lib/test/util';
import * as FollowingTestsUtil from 'oae-following/lib/test/util';
import * as MeetingAPI from 'oae-jitsi/lib/api.meetings';
import { deleteUser as removeUser } from 'oae-principals/lib/api.user';
import * as RestAPI from 'oae-rest';
import {
  clearAllData,
  createTenantAdminRestContext,
  createTenantRestContext,
  createGlobalAdminRestContext,
  generateTestUsers
} from 'oae-tests';
import { deleteUser as eliminateUser } from 'oae-principals/lib/definitive-deletion';
import {
  assertDefinitiveDeletionUsersSucceeds,
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
  getExpiredUser,
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
const DEFAULT_MONTH = 2;

// Avoid the "Error: global leak detected: r", temporal solution
Object.defineProperty(global, 'r', {});

describe('Delete and eliminate users', () => {
  let globalAdminRestContext = null;
  let camAdminRestContext = null;
  let camAnonymousRestContext = null;
  let gtAdminRestContext = null;
  let gtAnonymousRestContext = null;

  const reset = callback => {
    clearAllData(err => {
      camAdminRestContext = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
      camAnonymousRestContext = createTenantRestContext(global.oaeTests.tenants.cam.host);
      gtAdminRestContext = createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
      gtAnonymousRestContext = createTenantRestContext(global.oaeTests.tenants.gt.host);
      globalAdminRestContext = createGlobalAdminRestContext();
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
      // Generate a deleted user to test with
      generateTestUsers(camAdminRestContext, 2, (err, users, userToDelete, userArchive) => {
        assert.ok(!err);

        // Delete User - step 1
        assertDefinitiveDeletionUsersSucceeds(camAdminRestContext, userToDelete, userArchive, (err, resUserArchive) => {
          assert.ok(!err);
          assert.ok(resUserArchive);

          const actualDate = new Date();

          // Get expired principals
          // The deleted user shouldn't appear because the date in the datebase isn't outdated
          getExpiredUser(actualDate, (err, expiredUsers) => {
            assert.ok(!err);
            assert.ok(
              !_.find(expiredUsers, expiredUser => {
                return expiredUser.principalId === userToDelete.user.id;
              })
            );

            const months = PrincipalsConfig.getValue(userArchive.user.tenant.alias, USER, DELETE);

            if (months) {
              actualDate.setMonth(actualDate.getMonth() + parseInt(months, 10) + 1);
              actualDate.setYear(
                actualDate.getFullYear() + Math.trunc((actualDate.getMonth() + parseInt(months, 10) + 1) / 12)
              );
            } else {
              actualDate.setMonth(actualDate.getMonth() + DEFAULT_MONTH + 1);
              actualDate.setYear(
                actualDate.getFullYear() + Math.trunc((actualDate.getMonth() + DEFAULT_MONTH + 1) / 12)
              );
            }

            // Get expired principals
            // The deleted user should be considered as an expired user because the date in the database is outdated
            getExpiredUser(actualDate, (err, otherExpiredUsers) => {
              assert.ok(!err);
              assert.ok(
                _.find(otherExpiredUsers, otherExpiredUser => {
                  return otherExpiredUser.principalId === userToDelete.user.id;
                })
              );

              // Delete User - step 2
              eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
                assert.ok(!err);

                // Get expired principals
                // The deleted user shouldn't appear because the user is already marked has fully deleted
                getExpiredUser(actualDate, (err, moreExpiredUsers) => {
                  assert.ok(!err);
                  assert.ok(
                    !_.find(moreExpiredUsers, moreExpiredUser => {
                      return moreExpiredUser.principalId === userToDelete.user.id;
                    })
                  );
                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies we can't delete a user archive
     */
    it('Verify if the deletion fails when we try to delete a user archive', callback => {
      // Generate a deleted user to test with
      generateTestUsers(camAdminRestContext, 2, (err, users, userToDelete, userArchive) => {
        assert.ok(!err);

        // Turn on the user archive flag, this user will now be considered as a user archive
        updateUserArchiveFlag(userArchive.user.id, err => {
          assert.ok(!err);

          // Delete User - step 1
          assertDeleteUserFails(camAdminRestContext, userArchive.user.id, 401, err => {
            assert.ok(!err);

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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        camAdminRestContext.user = () => {
          return userArchive.user;
        };

        camAdminRestContext.tenant = () => {
          return userArchive.user.tenant;
        };

        camAdminRestContext.user().isAdmin = () => {
          return true;
        };

        camAdminRestContext.locale = () => {
          return DEFAULT_LOCALE;
        };

        // Delete User - step 1
        removeUser(camAdminRestContext, userToDelete.user.id, err => {
          assert.ok(!err);

          // Get user
          getPrincipalSkipCache(userToDelete.user.id, (err, user) => {
            assert.ok(!err);
            assert.ok(user);

            // Marked as deleted
            AuthzDeleteAPI.isDeleted([userToDelete.user.id], (err, wasDeleted) => {
              assert.ok(!err);
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
      generateTestUsers(camAdminRestContext, 2, (err, users, userToDelete, userArchive) => {
        assert.ok(!err);

        // Delete User - step 1
        assertDefinitiveDeletionUsersSucceeds(camAdminRestContext, userToDelete, userArchive, (err, resUserArchive) => {
          assert.ok(!err);
          assert.ok(resUserArchive);

          // Delete User - step 2
          eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
            assert.ok(!err);

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
        });
      });
    });

    /**
     * Test that verifies user profile picture is deleted from file system
     */
    it('Verify that the profile picture has been deleted from the file system after elimination', callback => {
      // Generate a deleted user to test with
      generateTestUsers(camAdminRestContext, 2, (err, users, userToDelete, userArchive) => {
        assert.ok(!err);

        // Upload a profile picture for the user so we can verify its data on the user profile model
        uploadAndCropPicture(
          userToDelete.restContext,
          userToDelete.user.id,
          _getPictureStream,
          { x: 10, y: 10, width: 200 },
          () => {
            // Get the user
            getPrincipalSkipCache(userToDelete.user.id, (err, retrievedUser) => {
              assert.ok(!err);

              // Delete User - step 1
              assertDefinitiveDeletionUsersSucceeds(
                camAdminRestContext,
                userToDelete,
                userArchive,
                (err, resUserArchive) => {
                  assert.ok(!err);
                  assert.ok(resUserArchive);

                  // Delete User - step 2
                  eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
                    // Get files
                    const pathSmallPicture = retrievedUser.picture.smallUri.split(':');
                    const pathMediumPicture = retrievedUser.picture.mediumUri.split(':');
                    const pathLargePicture = retrievedUser.picture.largeUri.split(':');

                    const path = ContentUtil.getStorageBackend(
                      camAdminRestContext,
                      retrievedUser.picture.largeUri
                    ).getRootDirectory();

                    fs.readFile(path + '/' + pathSmallPicture[1], (err, data) => {
                      assert.ok(err);
                      assert.ok(!data);
                      fs.readFile(path + '/' + pathMediumPicture[1], (err, data) => {
                        assert.ok(err);
                        assert.ok(!data);
                        fs.readFile(path + '/' + pathLargePicture[1], (err, data) => {
                          assert.ok(err);
                          assert.ok(!data);
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate links
        generateLinks(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, links) => {
          assert.ok(!err);
          generateLinks(user.restContext, PRIVATE_VISIBILITY, 1, (err, link) => {
            assert.ok(!err);

            // Generate rights links
            generateRightContent(userToDelete, user, MANAGER, links[0], err => {
              assert.ok(!err);
              generateRightContent(userToDelete, user, VIEWER, links[1], err => {
                assert.ok(!err);
                generateRightContent(user, userToDelete, VIEWER, link[0], err => {
                  assert.ok(!err);

                  // Delete User
                  assertDefinitiveDeletionUsersSucceeds(
                    camAdminRestContext,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.ok(!err);
                      assert.ok(userArchive);

                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, links[0].id, (err, hasRole) => {
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, links[0].id, (err, hasRole) => {
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasRole(user.user.id, links[0].id, MANAGER, (err, hasRole) => {
                            assert.strictEqual(hasRole, true);
                            AuthzAPI.hasAnyRole(userToDelete.user.id, links[1].id, (err, hasRole) => {
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(userArchive.archiveId, links[1].id, MANAGER, (err, hasRole) => {
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasRole(user.user.id, links[1].id, VIEWER, (err, hasRole) => {
                                  assert.strictEqual(hasRole, true);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, links[2].id, (err, hasRole) => {
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasRole(userArchive.archiveId, links[2].id, MANAGER, (err, hasRole) => {
                                      assert.strictEqual(hasRole, true);
                                      AuthzAPI.hasRole(user.user.id, link[0].id, MANAGER, (err, hasRole) => {
                                        assert.strictEqual(hasRole, true);
                                        AuthzAPI.hasAnyRole(userToDelete.user.id, link[0].id, (err, hasRole) => {
                                          assert.strictEqual(hasRole, false);
                                          AuthzAPI.hasAnyRole(userArchive.archiveId, link[0].id, (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate collabdocs
        generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 4, (err, collabdocs) => {
          assert.ok(!err);
          generateCollabdocs(user.restContext, PRIVATE_VISIBILITY, 2, (err, collabdocUser) => {
            assert.ok(!err);

            // Generate rights collabdocs
            generateRightContent(userToDelete, user, MANAGER, collabdocs[0], err => {
              assert.ok(!err);
              generateRightContent(userToDelete, user, EDITOR, collabdocs[1], err => {
                assert.ok(!err);
                generateRightContent(userToDelete, user, VIEWER, collabdocs[2], err => {
                  assert.ok(!err);
                  generateRightContent(user, userToDelete, EDITOR, collabdocUser[0], err => {
                    assert.ok(!err);
                    generateRightContent(user, userToDelete, VIEWER, collabdocUser[1], err => {
                      assert.ok(!err);

                      // Delete User
                      assertDefinitiveDeletionUsersSucceeds(
                        camAdminRestContext,
                        userToDelete,
                        userArchive,
                        (err, userArchive) => {
                          assert.ok(!err);
                          assert.ok(userArchive);

                          // Verify roles
                          AuthzAPI.hasAnyRole(userToDelete.user.id, collabdocs[0].id, (err, hasRole) => {
                            assert.strictEqual(hasRole, false);
                            AuthzAPI.hasAnyRole(userArchive.archiveId, collabdocs[0].id, (err, hasRole) => {
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(user.user.id, collabdocs[0].id, MANAGER, (err, hasRole) => {
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasAnyRole(userToDelete.user.id, collabdocs[1].id, (err, hasRole) => {
                                  assert.strictEqual(hasRole, false);
                                  AuthzAPI.hasRole(userArchive.archiveId, collabdocs[1].id, MANAGER, (err, hasRole) => {
                                    assert.strictEqual(hasRole, true);
                                    AuthzAPI.hasRole(user.user.id, collabdocs[1].id, EDITOR, (err, hasRole) => {
                                      assert.strictEqual(hasRole, true);
                                      AuthzAPI.hasAnyRole(userToDelete.user.id, collabdocs[2].id, (err, hasRole) => {
                                        assert.strictEqual(hasRole, false);
                                        AuthzAPI.hasRole(
                                          userArchive.archiveId,
                                          collabdocs[2].id,
                                          MANAGER,
                                          (err, hasRole) => {
                                            assert.strictEqual(hasRole, true);
                                            AuthzAPI.hasRole(user.user.id, collabdocs[2].id, VIEWER, (err, hasRole) => {
                                              assert.strictEqual(hasRole, true);
                                              AuthzAPI.hasAnyRole(
                                                userToDelete.user.id,
                                                collabdocs[3].id,
                                                (err, hasRole) => {
                                                  assert.strictEqual(hasRole, false);
                                                  AuthzAPI.hasRole(
                                                    userArchive.archiveId,
                                                    collabdocs[3].id,
                                                    MANAGER,
                                                    (err, hasRole) => {
                                                      assert.strictEqual(hasRole, true);
                                                      AuthzAPI.hasAnyRole(
                                                        user.user.id,
                                                        collabdocs[3].id,
                                                        (err, hasRole) => {
                                                          assert.strictEqual(hasRole, false);
                                                          AuthzAPI.hasRole(
                                                            user.user.id,
                                                            collabdocUser[0].id,
                                                            MANAGER,
                                                            (err, hasRole) => {
                                                              assert.strictEqual(hasRole, true);
                                                              AuthzAPI.hasAnyRole(
                                                                userToDelete.user.id,
                                                                collabdocUser[0].id,
                                                                (err, hasRole) => {
                                                                  assert.strictEqual(hasRole, false);
                                                                  AuthzAPI.hasAnyRole(
                                                                    userArchive.archiveId,
                                                                    collabdocUser[0].id,
                                                                    (err, hasRole) => {
                                                                      assert.strictEqual(hasRole, false);
                                                                      AuthzAPI.hasRole(
                                                                        user.user.id,
                                                                        collabdocUser[1].id,
                                                                        MANAGER,
                                                                        (err, hasRole) => {
                                                                          assert.strictEqual(hasRole, true);
                                                                          AuthzAPI.hasAnyRole(
                                                                            userToDelete.user.id,
                                                                            collabdocUser[1].id,
                                                                            (err, hasRole) => {
                                                                              assert.strictEqual(hasRole, false);
                                                                              AuthzAPI.hasAnyRole(
                                                                                userArchive.archiveId,
                                                                                collabdocUser[1].id,
                                                                                (err, hasRole) => {
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
     * Test that verifies definitive delation remove user roles on file
     */
    it('Verify if the user role is removed from the file', callback => {
      // Generate a deleted user to test with
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate files
        generateFiles(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, files) => {
          assert.ok(!err);
          generateFiles(user.restContext, PRIVATE_VISIBILITY, 1, (err, file) => {
            assert.ok(!err);

            // Generate rights files
            generateRightContent(userToDelete, user, MANAGER, files[0], err => {
              assert.ok(!err);
              generateRightContent(userToDelete, user, VIEWER, files[1], err => {
                assert.ok(!err);
                generateRightContent(user, userToDelete, VIEWER, file[0], err => {
                  assert.ok(!err);

                  // Delete User
                  assertDefinitiveDeletionUsersSucceeds(
                    camAdminRestContext,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.ok(!err);
                      assert.ok(userArchive);

                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, files[0].id, (err, hasRole) => {
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, files[0].id, (err, hasRole) => {
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasRole(user.user.id, files[0].id, MANAGER, (err, hasRole) => {
                            assert.strictEqual(hasRole, true);
                            AuthzAPI.hasAnyRole(userToDelete.user.id, files[1].id, (err, hasRole) => {
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(userArchive.archiveId, files[1].id, MANAGER, (err, hasRole) => {
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasRole(user.user.id, files[1].id, VIEWER, (err, hasRole) => {
                                  assert.strictEqual(hasRole, true);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, files[2].id, (err, hasRole) => {
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasRole(userArchive.archiveId, files[2].id, MANAGER, (err, hasRole) => {
                                      assert.strictEqual(hasRole, true);
                                      AuthzAPI.hasAnyRole(user.user.id, files[2].id, (err, hasRole) => {
                                        assert.strictEqual(hasRole, false);
                                        AuthzAPI.hasRole(user.user.id, file[0].id, MANAGER, (err, hasRole) => {
                                          assert.strictEqual(hasRole, true);
                                          AuthzAPI.hasAnyRole(userToDelete.user.id, file[0].id, (err, hasRole) => {
                                            assert.strictEqual(hasRole, false);
                                            AuthzAPI.hasAnyRole(userArchive.archiveId, file[0].id, (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate meetings
        generateMeetings(userToDelete.restContext, userToDelete.user, PRIVATE_VISIBILITY, 3, (err, meetings) => {
          assert.ok(!err);
          generateMeetings(user.restContext, user.user, PRIVATE_VISIBILITY, 1, (err, meeting) => {
            assert.ok(!err);
            // Generate rights meetings
            generateRightMeeting(camAdminRestContext, userToDelete, user, MANAGER, meetings[0], err => {
              assert.ok(!err);
              generateRightMeeting(camAdminRestContext, userToDelete, user, MEMBER, meetings[1], err => {
                assert.ok(!err);
                generateRightMeeting(camAdminRestContext, user, userToDelete, MEMBER, meeting[0], err => {
                  assert.ok(!err);

                  // Delete User
                  assertDefinitiveDeletionUsersSucceeds(
                    camAdminRestContext,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.ok(!err);
                      assert.ok(userArchive);
                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, meetings[0].id, (err, hasRole) => {
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, meetings[0].id, (err, hasRole) => {
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasRole(user.user.id, meetings[0].id, MANAGER, (err, hasRole) => {
                            assert.strictEqual(hasRole, true);
                            AuthzAPI.hasAnyRole(userToDelete.user.id, meetings[1].id, (err, hasRole) => {
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(userArchive.archiveId, meetings[1].id, MANAGER, (err, hasRole) => {
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasRole(user.user.id, meetings[1].id, MEMBER, (err, hasRole) => {
                                  assert.strictEqual(hasRole, true);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, meetings[2].id, (err, hasRole) => {
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasRole(userArchive.archiveId, meetings[2].id, MANAGER, (err, hasRole) => {
                                      assert.strictEqual(hasRole, true);
                                      AuthzAPI.hasAnyRole(user.user.id, meetings[2].id, (err, hasRole) => {
                                        assert.strictEqual(hasRole, false);
                                        AuthzAPI.hasRole(user.user.id, meeting[0].id, MANAGER, (err, hasRole) => {
                                          assert.strictEqual(hasRole, true);
                                          AuthzAPI.hasAnyRole(userToDelete.user.id, meeting[0].id, (err, hasRole) => {
                                            assert.strictEqual(hasRole, false);
                                            AuthzAPI.hasAnyRole(
                                              userArchive.archiveId,
                                              meeting[0].id,
                                              (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate discussions
        generateDiscussions(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, discussions) => {
          assert.ok(!err);
          generateDiscussions(user.restContext, PRIVATE_VISIBILITY, 1, (err, discussion) => {
            assert.ok(!err);

            // Generate rights discussions
            generateRightDiscussion(userToDelete, user, MANAGER, discussions[0], err => {
              assert.ok(!err);
              generateRightDiscussion(userToDelete, user, MEMBER, discussions[1], err => {
                assert.ok(!err);
                generateRightDiscussion(user, userToDelete, MEMBER, discussion[0], err => {
                  assert.ok(!err);

                  // Delete User
                  assertDefinitiveDeletionUsersSucceeds(
                    camAdminRestContext,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.ok(!err);
                      assert.ok(userArchive);

                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, discussions[0].id, (err, hasRole) => {
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, discussions[0].id, (err, hasRole) => {
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasRole(user.user.id, discussions[0].id, MANAGER, (err, hasRole) => {
                            assert.strictEqual(hasRole, true);
                            AuthzAPI.hasAnyRole(userToDelete.user.id, discussions[1].id, (err, hasRole) => {
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(userArchive.archiveId, discussions[1].id, MANAGER, (err, hasRole) => {
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasRole(user.user.id, discussions[1].id, MEMBER, (err, hasRole) => {
                                  assert.strictEqual(hasRole, true);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, discussions[2].id, (err, hasRole) => {
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasRole(
                                      userArchive.archiveId,
                                      discussions[2].id,
                                      MANAGER,
                                      (err, hasRole) => {
                                        assert.strictEqual(hasRole, true);
                                        AuthzAPI.hasAnyRole(user.user.id, discussions[2].id, (err, hasRole) => {
                                          assert.strictEqual(hasRole, false);
                                          AuthzAPI.hasRole(user.user.id, discussion[0].id, MANAGER, (err, hasRole) => {
                                            assert.strictEqual(hasRole, true);
                                            AuthzAPI.hasAnyRole(
                                              userToDelete.user.id,
                                              discussion[0].id,
                                              (err, hasRole) => {
                                                assert.strictEqual(hasRole, false);
                                                AuthzAPI.hasAnyRole(
                                                  userArchive.archiveId,
                                                  discussion[0].id,
                                                  (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate groups
        generateGroups(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, groups) => {
          assert.ok(!err);
          generateGroups(user.restContext, PRIVATE_VISIBILITY, 1, (err, group) => {
            assert.ok(!err);

            // Generate rights groups
            generateRightsForGroup(userToDelete, user, MANAGER, groups[0], err => {
              assert.ok(!err);
              generateRightsForGroup(userToDelete, user, MEMBER, groups[1], err => {
                assert.ok(!err);
                generateRightsForGroup(user, userToDelete, MEMBER, group[0], err => {
                  assert.ok(!err);

                  // Delete User
                  assertDefinitiveDeletionUsersSucceeds(
                    camAdminRestContext,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.ok(!err);
                      assert.ok(userArchive);

                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, groups[0].id, (err, hasRole) => {
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, groups[0].id, (err, hasRole) => {
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasRole(user.user.id, groups[0].id, MANAGER, (err, hasRole) => {
                            assert.strictEqual(hasRole, true);
                            AuthzAPI.hasAnyRole(userToDelete.user.id, groups[1].id, (err, hasRole) => {
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(userArchive.archiveId, groups[1].id, MANAGER, (err, hasRole) => {
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasRole(user.user.id, groups[1].id, MEMBER, (err, hasRole) => {
                                  assert.strictEqual(hasRole, true);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, groups[2].id, (err, hasRole) => {
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasRole(userArchive.archiveId, groups[2].id, MANAGER, (err, hasRole) => {
                                      assert.strictEqual(hasRole, true);
                                      AuthzAPI.hasAnyRole(user.user.id, groups[2].id, (err, hasRole) => {
                                        assert.strictEqual(hasRole, false);
                                        AuthzAPI.hasRole(user.user.id, group[0].id, MANAGER, (err, hasRole) => {
                                          assert.strictEqual(hasRole, true);
                                          AuthzAPI.hasAnyRole(userToDelete.user.id, group[0].id, (err, hasRole) => {
                                            assert.strictEqual(hasRole, false);
                                            AuthzAPI.hasAnyRole(userArchive.archiveId, group[0].id, (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate folders
        generateFolders(userToDelete, PRIVATE_VISIBILITY, 3, (err, folders) => {
          assert.ok(!err);
          generateFolders(user, PRIVATE_VISIBILITY, 1, (err, folder) => {
            assert.ok(!err);

            // Generate rights folders
            generateRightFolder(userToDelete, user, MANAGER, folders[0], err => {
              assert.ok(!err);
              generateRightFolder(userToDelete, user, VIEWER, folders[1], err => {
                assert.ok(!err);
                generateRightFolder(user, userToDelete, VIEWER, folder[0], err => {
                  assert.ok(!err);

                  // Delete User
                  assertDefinitiveDeletionUsersSucceeds(
                    camAdminRestContext,
                    userToDelete,
                    userArchive,
                    (err, userArchive) => {
                      assert.ok(!err);
                      assert.ok(userArchive);

                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, folders[0].groupId, (err, hasRole) => {
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, folders[0].groupId, (err, hasRole) => {
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasRole(user.user.id, folders[0].groupId, MANAGER, (err, hasRole) => {
                            assert.strictEqual(hasRole, true);
                            AuthzAPI.hasAnyRole(userToDelete.user.id, folders[1].groupId, (err, hasRole) => {
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasRole(userArchive.archiveId, folders[1].groupId, MANAGER, (err, hasRole) => {
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasRole(user.user.id, folders[1].groupId, VIEWER, (err, hasRole) => {
                                  assert.strictEqual(hasRole, true);
                                  AuthzAPI.hasAnyRole(userToDelete.user.id, folders[2].groupId, (err, hasRole) => {
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasRole(
                                      userArchive.archiveId,
                                      folders[2].groupId,
                                      MANAGER,
                                      (err, hasRole) => {
                                        assert.strictEqual(hasRole, true);
                                        AuthzAPI.hasAnyRole(user.user.id, folders[2].groupId, (err, hasRole) => {
                                          assert.strictEqual(hasRole, false);
                                          AuthzAPI.hasRole(user.user.id, folder[0].groupId, MANAGER, (err, hasRole) => {
                                            assert.strictEqual(hasRole, true);
                                            AuthzAPI.hasAnyRole(
                                              userToDelete.user.id,
                                              folder[0].groupId,
                                              (err, hasRole) => {
                                                assert.strictEqual(hasRole, false);
                                                AuthzAPI.hasAnyRole(
                                                  userArchive.archiveId,
                                                  folder[0].groupId,
                                                  (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        const list = [];
        generateFolders(userToDelete, PRIVATE_VISIBILITY, 1, (err, folder) => {
          assert.ok(!err);
          generateGroups(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, group) => {
            assert.ok(!err);
            generateDiscussions(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, discussion) => {
              assert.ok(!err);
              generateMeetings(userToDelete.restContext, userToDelete.user, PRIVATE_VISIBILITY, 1, (err, meeting) => {
                assert.ok(!err);
                generateFiles(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, file) => {
                  assert.ok(!err);
                  generateLinks(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, link) => {
                    assert.ok(!err);
                    generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, collabdoc) => {
                      assert.ok(!err);

                      // Add element to a list
                      list.push(group[0].id);
                      list.push(discussion[0].id);
                      list.push(meeting[0].id);
                      list.push(file[0].id);
                      list.push(link[0].id);
                      list.push(collabdoc[0].id);
                      list.push(folder[0].id);

                      // Delete User
                      assertDefinitiveDeletionUsersSucceeds(
                        camAdminRestContext,
                        userToDelete,
                        userArchive,
                        (err, userArchive) => {
                          assert.ok(!err);
                          assert.ok(userArchive);

                          // Get Data and compare it with the id list
                          getDataFromArchive(userArchive.archiveId, userToDelete.user.id, (err, elements) => {
                            const listElementId = [];
                            elements.resourceId.split(',').forEach(element => {
                              listElementId.push(element);
                            });

                            assert.ok(!err);
                            assert.deepStrictEqual(list.sort(), listElementId.sort());
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
        });
      });
    });

    /**
     * Test that verifies the data in the table DataArchive
     */
    it('Verify if discussions are in the library of userArchive after the deletion of a user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(camAdminRestContext, 2, (err, users, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateDiscussions(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, discussion) => {
          assert.ok(!err);

          userArchive.archiveId = userArchive.user.id;

          // Delete User
          assertDefinitiveDeletionUsersSucceeds(camAdminRestContext, userToDelete, userArchive, (err, userArchive) => {
            assert.ok(!err);
            assert.ok(userArchive);

            // Discussion is in library
            checkLibrary(camAdminRestContext, userArchive.archiveId, true, [discussion], () => {
              return callback();
            });
          });
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
          assert.ok(!err);

          // Make sure only the expected items are returned.
          assert.strictEqual(items.results.length, expectedItems.length);
          _.each(expectedItems, expectedDiscussion => {
            assert.ok(
              _.filter(items.results, discussion => {
                return discussion.id === expectedDiscussion.id;
              })
            );
          });
        } else {
          assert.strictEqual(err.code, 401);
          assert.ok(!items);
        }

        return callback();
      });
    };

    /**
     * Test that verifies if elements are in the library
     */
    it('Verify if groups are in the library of userArchive after the deletion of a user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(camAdminRestContext, 2, (err, users, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateGroups(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, group) => {
          assert.ok(!err);

          // Delete User
          assertDefinitiveDeletionUsersSucceeds(camAdminRestContext, userToDelete, userArchive, (err, userArchive) => {
            assert.ok(!err);
            assert.ok(userArchive);

            // Groups is in library
            RestAPI.Group.getMembershipsLibrary(
              camAdminRestContext,
              userArchive.archiveId,
              null,
              group.length,
              (err, data) => {
                assert.ok(!err);
                const library = data.results;
                assert.strictEqual(library.length, group.length);
                assert.strictEqual(library[0].id, group[0].id);

                return callback();
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies if elements are in the library
     */
    it('Verify if contents are in the library of userArchive after the deletion of a user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(camAdminRestContext, 2, (err, users, userToDelete, userArchive) => {
        assert.ok(!err);
        const list = [];

        // Generate element
        generateFiles(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, file) => {
          assert.ok(!err);
          generateLinks(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, link) => {
            assert.ok(!err);
            generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, collabdoc) => {
              assert.ok(!err);

              list.push(file[0].id);
              list.push(link[0].id);
              list.push(collabdoc[0].id);
              list.sort();

              // Delete User
              assertDefinitiveDeletionUsersSucceeds(
                camAdminRestContext,
                userToDelete,
                userArchive,
                (err, userArchive) => {
                  assert.ok(!err);
                  assert.ok(userArchive);

                  // Content is in library
                  RestAPI.Content.getLibrary(
                    camAdminRestContext,
                    userArchive.archiveId,
                    null,
                    list.length,
                    (err, data) => {
                      assert.ok(!err);
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
      generateTestUsers(camAdminRestContext, 2, (err, users, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateMeetings(userToDelete.restContext, userToDelete.user, PRIVATE_VISIBILITY, 1, (err, meeting) => {
          assert.ok(!err);

          // Delete User
          assertDefinitiveDeletionUsersSucceeds(camAdminRestContext, userToDelete, userArchive, (err, userArchive) => {
            assert.ok(!err);
            assert.ok(userArchive);

            // Meeting is in library
            MeetingAPI.getMeetingsLibrary(camAdminRestContext, userArchive.archiveId, null, null, (err, data) => {
              assert.ok(!err);
              assert.strictEqual(data.length, meeting.length);
              assert.strictEqual(data[0].id, meeting[0].id);

              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies if elements are in the library
     */
    it('Verify if folders are in the library of userArchive after the deletion of a user', callback => {
      // Generate a deleted user to test with
      generateTestUsers(camAdminRestContext, 2, (err, users, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateFolders(userToDelete, PRIVATE_VISIBILITY, 1, (err, folder) => {
          assert.ok(!err);

          // Delete User
          assertDefinitiveDeletionUsersSucceeds(camAdminRestContext, userToDelete, userArchive, (err, userArchive) => {
            assert.ok(!err);
            assert.ok(userArchive);

            // Folder is in library
            FoldersTestUtil.assertGetAllFoldersLibrarySucceeds(
              camAdminRestContext,
              userArchive.archiveId,
              null,
              (library, responses) => {
                assert.strictEqual(library.length, folder.length);
                assert.strictEqual(library[0].id, folder[0].id);

                return callback();
              }
            );
          });
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
      generateTestUsers(camAdminRestContext, 1, (err, users, userArchive) => {
        assert.ok(!err);

        // Create 2 users, one following the other
        FollowingTestsUtil.createFollowerAndFollowed(camAdminRestContext, (follower, followed) => {
          // Ensure the follower and following feeds indicate they are indeed following
          FollowingTestsUtil.assertFollows(
            follower.user.id,
            follower.restContext,
            followed.user.id,
            followed.restContext,
            () => {
              assertDefinitiveDeletionUsersSucceeds(camAdminRestContext, followed, userArchive, (err, userArchive) => {
                assert.ok(!err);
                assert.ok(userArchive);

                // Delete user
                eliminateUser(camAdminRestContext, followed.user, userArchive.tenantAlias, err => {
                  assert.ok(!err);

                  // Ensure the follower and following feeds indicate they are no longer following
                  assertDoesNotFollow(follower.user.id, followed.user.id, callback);
                });
              });
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
      generateTestUsers(camAdminRestContext, 1, (err, users, userArchive) => {
        assert.ok(!err);

        // Create 2 users, one following the other
        FollowingTestsUtil.createFollowerAndFollowed(camAdminRestContext, (follower, followed) => {
          // Ensure the follower and following feeds indicate they are indeed following
          FollowingTestsUtil.assertFollows(
            follower.user.id,
            follower.restContext,
            followed.user.id,
            followed.restContext,
            () => {
              // Delete user
              assertDefinitiveDeletionUsersSucceeds(camAdminRestContext, follower, userArchive, (err, userArchive) => {
                assert.ok(!err);
                assert.ok(userArchive);

                // Delete user
                eliminateUser(camAdminRestContext, follower.user, userArchive.tenantAlias, err => {
                  assert.ok(!err);

                  // Ensure the follower and following feeds indicate they are no longer following
                  assertDoesNotFollow(follower.user.id, followed.user.id, callback);
                });
              });
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateMeetings(userToDelete.restContext, userToDelete.user, PRIVATE_VISIBILITY, 1, (err, meeting) => {
          assert.ok(!err);

          // Delete User
          assertDefinitiveDeletionUsersSucceeds(
            camAdminRestContext,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.ok(!err);
              assert.ok(resUserArchive);

              // Get Data and compare it with the id list
              getDataFromArchive(userArchive.archiveId, userToDelete.user.id, (err, data) => {
                assert.ok(!err);
                assert.deepStrictEqual(data.resourceId, meeting[0].id);

                eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.ok(!err);

                  AuthzAPI.hasAnyRole(userToDelete.user.id, meeting[0].id, (err, hasRole) => {
                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, meeting[0].id, (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateFiles(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, file) => {
          assert.ok(!err);
          generateLinks(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, link) => {
            assert.ok(!err);
            generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, collabdoc) => {
              assert.ok(!err);

              // Delete User
              assertDefinitiveDeletionUsersSucceeds(
                camAdminRestContext,
                userToDelete,
                userArchive,
                (err, resUserArchive) => {
                  assert.ok(!err);
                  assert.ok(resUserArchive);

                  // Get Data and compare it with the id list
                  getDataFromArchive(userArchive.archiveId, userToDelete.user.id, (err, data) => {
                    assert.ok(!err);
                    const listContentFromArchive = data.resourceId.split(',');
                    const listContent = [link[0].id, file[0].id, collabdoc[0].id];
                    assert.deepStrictEqual(listContentFromArchive.sort(), listContent.sort());

                    eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
                      assert.ok(!err);

                      // Verify roles
                      AuthzAPI.hasAnyRole(userToDelete.user.id, link[0].id, (err, hasRole) => {
                        assert.strictEqual(hasRole, false);
                        AuthzAPI.hasAnyRole(userArchive.archiveId, link[0].id, (err, hasRole) => {
                          assert.strictEqual(hasRole, false);
                          AuthzAPI.hasAnyRole(userToDelete.user.id, file[0].id, (err, hasRole) => {
                            assert.strictEqual(hasRole, false);
                            AuthzAPI.hasAnyRole(userArchive.archiveId, file[0].id, (err, hasRole) => {
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasAnyRole(userToDelete.user.id, collabdoc[0].id, (err, hasRole) => {
                                assert.strictEqual(hasRole, false);
                                AuthzAPI.hasAnyRole(userArchive.archiveId, collabdoc[0].id, (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateGroups(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, group) => {
          assert.ok(!err);

          // Delete User
          assertDefinitiveDeletionUsersSucceeds(
            camAdminRestContext,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.ok(!err);
              assert.ok(resUserArchive);

              // Get Data and compare it with the id list
              getDataFromArchive(userArchive.archiveId, userToDelete.user.id, (err, data) => {
                assert.ok(!err);
                assert.deepStrictEqual(data.resourceId, group[0].id);

                eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.ok(!err);

                  // Verify roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, group[0].id, (err, hasRole) => {
                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, group[0].id, (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateDiscussions(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, discussion) => {
          assert.ok(!err);

          // Delete User
          assertDefinitiveDeletionUsersSucceeds(
            camAdminRestContext,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.ok(!err);
              assert.ok(resUserArchive);

              // Get Data and compare it with the id list
              getDataFromArchive(userArchive.archiveId, userToDelete.user.id, (err, data) => {
                assert.ok(!err);
                assert.deepStrictEqual(data.resourceId, discussion[0].id);

                eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.ok(!err);

                  // Verify roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, discussion[0].id, (err, hasRole) => {
                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, discussion[0].id, (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateFolders(userToDelete, PRIVATE_VISIBILITY, 1, (err, folder) => {
          assert.ok(!err);

          // Delete User
          assertDefinitiveDeletionUsersSucceeds(
            camAdminRestContext,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.ok(!err);
              assert.ok(resUserArchive);

              // Get Data and compare it with the id list
              getDataFromArchive(userArchive.archiveId, userToDelete.user.id, (err, data) => {
                assert.ok(!err);
                assert.deepStrictEqual(data.resourceId, folder[0].id);

                eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.ok(!err);

                  // Verify roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, folder[0].groupId, (err, hasRole) => {
                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, folder[0].groupId, (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateFiles(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, file) => {
          assert.ok(!err);
          generateLinks(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, link) => {
            assert.ok(!err);
            generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, collabdoc) => {
              assert.ok(!err);

              // Delete User
              assertDefinitiveDeletionUsersSucceeds(
                camAdminRestContext,
                userToDelete,
                userArchive,
                (err, resUserArchive) => {
                  assert.ok(!err);
                  assert.ok(resUserArchive);

                  // Generate rights
                  generateRightContent(userArchive, user, MANAGER, file[0], err => {
                    assert.ok(!err);
                    generateRightContent(userArchive, user, MANAGER, link[0], err => {
                      assert.ok(!err);
                      generateRightContent(userArchive, user, MANAGER, collabdoc[0], err => {
                        assert.ok(!err);

                        eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
                          assert.ok(!err);

                          // Check roles
                          AuthzAPI.hasAnyRole(userToDelete.user.id, file[0].id, (err, hasRole) => {
                            assert.strictEqual(hasRole, false);
                            AuthzAPI.hasAnyRole(userArchive.archiveId, file[0].id, (err, hasRole) => {
                              assert.strictEqual(hasRole, false);
                              AuthzAPI.hasAnyRole(user.user.id, file[0].id, (err, hasRole) => {
                                assert.strictEqual(hasRole, true);
                                AuthzAPI.hasAnyRole(userToDelete.user.id, link[0].id, (err, hasRole) => {
                                  assert.strictEqual(hasRole, false);
                                  AuthzAPI.hasAnyRole(userArchive.archiveId, link[0].id, (err, hasRole) => {
                                    assert.strictEqual(hasRole, false);
                                    AuthzAPI.hasAnyRole(user.user.id, link[0].id, (err, hasRole) => {
                                      assert.strictEqual(hasRole, true);
                                      AuthzAPI.hasAnyRole(userToDelete.user.id, collabdoc[0].id, (err, hasRole) => {
                                        assert.strictEqual(hasRole, false);
                                        AuthzAPI.hasAnyRole(userArchive.archiveId, collabdoc[0].id, (err, hasRole) => {
                                          assert.strictEqual(hasRole, false);
                                          AuthzAPI.hasAnyRole(user.user.id, collabdoc[0].id, (err, hasRole) => {
                                            assert.strictEqual(hasRole, true);
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
                  });
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateMeetings(userToDelete.restContext, userToDelete.user, PRIVATE_VISIBILITY, 1, (err, meeting) => {
          assert.ok(!err);

          // Delete User
          assertDefinitiveDeletionUsersSucceeds(
            camAdminRestContext,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.ok(!err);
              assert.ok(resUserArchive);

              // Generate rights meetings
              generateRightMeeting(camAdminRestContext, userArchive, user, MANAGER, meeting[0], err => {
                assert.ok(!err);

                eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.ok(!err);

                  // Check roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, meeting[0].id, (err, hasRole) => {
                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, meeting[0].id, (err, hasRole) => {
                      assert.strictEqual(hasRole, false);
                      AuthzAPI.hasAnyRole(user.user.id, meeting[0].id, (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateDiscussions(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, discussion) => {
          assert.ok(!err);

          // Delete User
          assertDefinitiveDeletionUsersSucceeds(
            camAdminRestContext,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.ok(!err);
              assert.ok(resUserArchive);

              // Generate rights discussion
              generateRightDiscussion(userArchive, user, MANAGER, discussion[0], err => {
                assert.ok(!err);

                eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.ok(!err);

                  // Check roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, discussion[0].id, (err, hasRole) => {
                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, discussion[0].id, (err, hasRole) => {
                      assert.strictEqual(hasRole, false);
                      AuthzAPI.hasAnyRole(user.user.id, discussion[0].id, (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateGroups(userToDelete.restContext, PRIVATE_VISIBILITY, 1, (err, group) => {
          assert.ok(!err);

          // Delete User
          assertDefinitiveDeletionUsersSucceeds(
            camAdminRestContext,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.ok(!err);
              assert.ok(resUserArchive);

              // Generate rights group
              assertJoinGroupSucceeds(userArchive.restContext, user.restContext, group[0].id, err => {
                assert.ok(!err);

                eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.ok(!err);

                  // Check roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, group[0].id, (err, hasRole) => {
                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, group[0].id, (err, hasRole) => {
                      assert.strictEqual(hasRole, false);
                      AuthzAPI.hasAnyRole(user.user.id, group[0].id, (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate element
        generateFolders(userToDelete, PRIVATE_VISIBILITY, 1, (err, folder) => {
          assert.ok(!err);

          // Delete User
          assertDefinitiveDeletionUsersSucceeds(
            camAdminRestContext,
            userToDelete,
            userArchive,
            (err, resUserArchive) => {
              assert.ok(!err);
              assert.ok(resUserArchive);

              // Generate rights folder
              generateRightFolder(userArchive, user, MANAGER, folder[0], err => {
                assert.ok(!err);

                eliminateUser(camAdminRestContext, userToDelete.user, resUserArchive.tenantAlias, err => {
                  assert.ok(!err);

                  // Check roles
                  AuthzAPI.hasAnyRole(userToDelete.user.id, folder[0].groupId, (err, hasRole) => {
                    assert.strictEqual(hasRole, false);
                    AuthzAPI.hasAnyRole(userArchive.archiveId, folder[0].groupId, (err, hasRole) => {
                      assert.strictEqual(hasRole, false);
                      AuthzAPI.hasAnyRole(user.user.id, folder[0].groupId, (err, hasRole) => {
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate files
        generateFiles(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, files) => {
          assert.ok(!err);
          generateFiles(user.restContext, PRIVATE_VISIBILITY, 1, (err, file) => {
            assert.ok(!err);

            // Generate rights files
            generateRightContent(userToDelete, user, MANAGER, files[0], err => {
              assert.ok(!err);
              generateRightContent(userToDelete, user, VIEWER, files[1], err => {
                assert.ok(!err);
                generateRightContent(userToDelete, otherUser, VIEWER, files[1], err => {
                  assert.ok(!err);
                  generateRightContent(user, userToDelete, VIEWER, file[0], err => {
                    assert.ok(!err);
                    generateRightContent(userToDelete, user, VIEWER, files[2], err => {
                      assert.ok(!err);

                      const list = [];
                      list.push(otherUser.user.email);
                      list.push(user.user.email);
                      list.sort();

                      // Delete User
                      assertDefinitiveDeletionUsersSucceeds(
                        camAdminRestContext,
                        userToDelete,
                        userArchive,
                        (err, userArchive, listEmail) => {
                          assert.ok(!err);
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate links
        generateLinks(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, links) => {
          assert.ok(!err);
          generateLinks(user.restContext, PRIVATE_VISIBILITY, 1, (err, link) => {
            assert.ok(!err);

            // Generate rights links
            generateRightContent(userToDelete, user, MANAGER, links[0], err => {
              assert.ok(!err);
              generateRightContent(userToDelete, user, VIEWER, links[1], err => {
                assert.ok(!err);
                generateRightContent(userToDelete, otherUser, VIEWER, links[1], err => {
                  assert.ok(!err);
                  generateRightContent(user, userToDelete, VIEWER, link[0], err => {
                    assert.ok(!err);
                    generateRightContent(userToDelete, user, VIEWER, links[2], err => {
                      assert.ok(!err);

                      const list = [];
                      list.push(otherUser.user.email);
                      list.push(user.user.email);
                      list.sort();

                      // Delete User
                      assertDefinitiveDeletionUsersSucceeds(
                        camAdminRestContext,
                        userToDelete,
                        userArchive,
                        (err, userArchive, listEmail) => {
                          assert.ok(!err);
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate collabdocs
        generateCollabdocs(userToDelete.restContext, PRIVATE_VISIBILITY, 4, (err, collabdocs) => {
          assert.ok(!err);
          generateCollabdocs(user.restContext, PRIVATE_VISIBILITY, 1, (err, collabdocUser) => {
            assert.ok(!err);

            // Generate rights collabdocs
            generateRightContent(userToDelete, user, MANAGER, collabdocs[0], err => {
              assert.ok(!err);
              generateRightContent(userToDelete, user, EDITOR, collabdocs[1], err => {
                assert.ok(!err);
                generateRightContent(userToDelete, user, VIEWER, collabdocs[2], err => {
                  assert.ok(!err);
                  generateRightContent(user, userToDelete, EDITOR, collabdocUser[0], err => {
                    assert.ok(!err);
                    generateRightContent(userToDelete, otherUser, VIEWER, collabdocs[1], err => {
                      assert.ok(!err);
                      generateRightContent(userToDelete, otherUser, VIEWER, collabdocs[2], err => {
                        assert.ok(!err);

                        const list = [];
                        list.push(otherUser.user.email);
                        list.push(user.user.email);
                        list.sort();

                        // Delete User
                        assertDefinitiveDeletionUsersSucceeds(
                          camAdminRestContext,
                          userToDelete,
                          userArchive,
                          (err, userArchive, listEmail) => {
                            assert.ok(!err);
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate meetings
        generateMeetings(userToDelete.restContext, userToDelete.user, PRIVATE_VISIBILITY, 3, (err, meetings) => {
          assert.ok(!err);
          generateMeetings(user.restContext, user.user, PRIVATE_VISIBILITY, 1, (err, meeting) => {
            assert.ok(!err);

            // Generate rights links
            generateRightMeeting(camAdminRestContext, userToDelete, user, MANAGER, meetings[0], err => {
              assert.ok(!err);
              generateRightMeeting(camAdminRestContext, userToDelete, user, MEMBER, meetings[1], err => {
                assert.ok(!err);
                generateRightMeeting(camAdminRestContext, userToDelete, otherUser, MEMBER, meetings[0], err => {
                  assert.ok(!err);
                  generateRightMeeting(camAdminRestContext, user, userToDelete, MEMBER, meeting[0], err => {
                    assert.ok(!err);
                    generateRightMeeting(camAdminRestContext, userToDelete, user, MEMBER, meetings[2], err => {
                      assert.ok(!err);

                      const list = [];
                      list.push(otherUser.user.email);
                      list.push(user.user.email);
                      list.sort();

                      // Delete User
                      assertDefinitiveDeletionUsersSucceeds(
                        camAdminRestContext,
                        userToDelete,
                        userArchive,
                        (err, userArchive, listEmail) => {
                          assert.ok(!err);
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate groups
        generateGroups(userToDelete.restContext, PRIVATE_VISIBILITY, 3, (err, groups) => {
          assert.ok(!err);
          generateGroups(user.restContext, PRIVATE_VISIBILITY, 1, (err, group) => {
            assert.ok(!err);

            // Generate rights groups
            generateRightsForGroup(userToDelete, user, MANAGER, groups[0], err => {
              assert.ok(!err);
              generateRightsForGroup(userToDelete, user, MEMBER, groups[1], err => {
                assert.ok(!err);
                generateRightsForGroup(userToDelete, otherUser, MEMBER, groups[1], err => {
                  assert.ok(!err);
                  generateRightsForGroup(user, userToDelete, MEMBER, group[0], err => {
                    assert.ok(!err);
                    generateRightsForGroup(userToDelete, user, MEMBER, groups[2], err => {
                      assert.ok(!err);

                      const list = [];
                      list.push(otherUser.user.email);
                      list.push(user.user.email);
                      list.sort();

                      // Delete User
                      assertDefinitiveDeletionUsersSucceeds(
                        camAdminRestContext,
                        userToDelete,
                        userArchive,
                        (err, userArchive, listEmail) => {
                          assert.ok(!err);
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
      generateTestUsers(camAdminRestContext, 4, (err, users, user, otherUser, userToDelete, userArchive) => {
        assert.ok(!err);

        // Generate folders
        generateFolders(userToDelete, PRIVATE_VISIBILITY, 3, (err, folders) => {
          assert.ok(!err);
          generateFolders(user, PRIVATE_VISIBILITY, 1, (err, folder) => {
            assert.ok(!err);

            // Generate rights folders
            generateRightFolder(userToDelete, user, MANAGER, folders[0], err => {
              assert.ok(!err);
              generateRightFolder(userToDelete, user, VIEWER, folders[1], err => {
                assert.ok(!err);
                generateRightFolder(userToDelete, otherUser, VIEWER, folders[1], err => {
                  assert.ok(!err);
                  generateRightFolder(user, userToDelete, VIEWER, folder[0], err => {
                    assert.ok(!err);
                    generateRightFolder(userToDelete, user, VIEWER, folders[2], err => {
                      assert.ok(!err);

                      const list = [];
                      list.push(otherUser.user.email);
                      list.push(user.user.email);
                      list.sort();

                      // Delete User
                      assertDefinitiveDeletionUsersSucceeds(
                        camAdminRestContext,
                        userToDelete,
                        userArchive,
                        (err, userArchive, listEmail) => {
                          assert.ok(!err);
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
