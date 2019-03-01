/*
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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

const assert = require('assert');
const _ = require('underscore');

const AuthzAPI = require('oae-authz');
const AuthzUtil = require('oae-authz/lib/util');
const FollowingTestUtil = require('oae-following/lib/test/util');
const Redis = require('oae-util/lib/redis');
const RestAPI = require('oae-rest');
const SearchTestUtil = require('oae-search/lib/test/util');
const TestsUtil = require('oae-tests');

const PrincipalsDelete = require('oae-principals/lib/delete');
const PrincipalsTestUtil = require('oae-principals/lib/test/util');
const DisableUsersMigration = require('../../../etc/migration/disable_users_from_tenancy/lib/disable-users-by-tenancy');

describe('Principals Delete and Restore', () => {
  // Rest context that can be used to perform requests as different types of users
  let anonymousRestContext = null;
  let camAdminRestContext = null;
  let gtAdminRestContext = null;
  let globalAdminRestContext = null;
  let globalAdminOnTenantRestContext = null;

  /**
   * Function that will create a user that will be used inside of the tests
   */
  before(callback => {
    // Create all the REST contexts before each test
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();

    // Log the global admin into a tenant so we can perform user-tenant requests with a global admin to test their access
    RestAPI.Admin.loginOnTenant(globalAdminRestContext, 'localhost', null, (err, ctx) => {
      assert.ok(!err);
      globalAdminOnTenantRestContext = ctx;
      return callback();
    });
  });

  describe('Registration', () => {
    /**
     * Test that verifies that delete and restore handle names must be unique
     */
    it('verify registering multiple delete and restore handlers with the same name results in an exception', callback => {
      // Register one of each, these should be fine
      PrincipalsDelete.registerGroupDeleteHandler(
        'test-throws-duplicate',
        (group, membershipsGraph, membersGraph, callback) => {
          return callback();
        }
      );
      PrincipalsDelete.registerGroupRestoreHandler(
        'test-throws-duplicate',
        (group, membershipsGraph, membersGraph, callback) => {
          return callback();
        }
      );

      assert.throws(() => {
        PrincipalsDelete.registerGroupDeleteHandler(
          'test-throws-duplicate',
          (group, membershipsGraph, membersGraph, callback) => {
            return callback();
          }
        );
      });

      assert.throws(() => {
        PrincipalsDelete.registerGroupRestoreHandler(
          'test-throws-duplicate',
          (group, membershipsGraph, membersGraph, callback) => {
            return callback();
          }
        );
      });

      return callback();
    });

    /**
     * Test that verifies that only functions can be registered to handle deletes and restores
     */
    it('verify registering non-function delete and restore handlers fails', callback => {
      assert.throws(() => {
        PrincipalsDelete.registerGroupDeleteHandler('test-throws-nonfunction');
      });
      assert.throws(() => {
        PrincipalsDelete.registerGroupDeleteHandler('test-throws-nonfunction', 'not-a-function');
      });
      assert.throws(() => {
        PrincipalsDelete.registerGroupRestoreHandler('test-throws-nonfunction');
      });
      assert.throws(() => {
        PrincipalsDelete.registerGroupRestoreHandler('test-throws-nonfunction', 'not-a-function');
      });
      return callback();
    });
  });

  describe('Validation', () => {
    /**
     * Test that verifies validation of deleting a group
     */
    it('verify validation of deleting a group', callback => {
      // Create a user and a group with which we'll test
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, manager) => {
        TestsUtil.generateTestGroups(manager.restContext, 1, group => {
          // Ensure combinations of invalid group ids result in a 400
          PrincipalsTestUtil.assertDeleteGroupFails(manager.restContext, 'not-an-id', 400, () => {
            PrincipalsTestUtil.assertDeleteGroupFails(
              manager.restContext,
              'u:oae:not-a-group-id',
              400,
              () => {
                // Ensure we can't delete a non-existing group
                PrincipalsTestUtil.assertDeleteGroupFails(
                  manager.restContext,
                  'g:cam:non-existing-group',
                  404,
                  () => {
                    // Sanity check that we can delete a group
                    return PrincipalsTestUtil.assertDeleteGroupSucceeds(
                      camAdminRestContext,
                      manager.restContext,
                      group.group.id,
                      callback
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
     * Test that verifies validation of restoring a group
     */
    it('verify validation of restoring a group', callback => {
      // Create a user and a delteed group with which we'll test
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, manager) => {
        TestsUtil.generateTestGroups(manager.restContext, 1, group => {
          PrincipalsTestUtil.assertDeleteGroupSucceeds(
            camAdminRestContext,
            manager.restContext,
            group.group.id,
            () => {
              // Ensure combinations of invalid group ids result in a 400
              PrincipalsTestUtil.assertRestoreGroupFails(
                camAdminRestContext,
                'not-an-id',
                400,
                () => {
                  PrincipalsTestUtil.assertRestoreGroupFails(
                    camAdminRestContext,
                    'u:oae:not-a-group-id',
                    400,
                    () => {
                      // Ensure we can't restore a group that never existed
                      PrincipalsTestUtil.assertRestoreGroupFails(
                        camAdminRestContext,
                        'g:cam:non-existing-group',
                        404,
                        () => {
                          // Sanity check that we can restore the group with the administrator
                          return PrincipalsTestUtil.assertRestoreGroupSucceeds(
                            camAdminRestContext,
                            camAdminRestContext,
                            group.group.id,
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
     * Test that verifies validation of deleting a user
     */
    it('verify validation of deleting a user', callback => {
      // Create a user with which we'll test
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
        // Ensure combinations of invalid user ids result in a 400
        PrincipalsTestUtil.assertDeleteUserFails(user.restContext, 'not-an-id', 400, () => {
          PrincipalsTestUtil.assertDeleteUserFails(
            user.restContext,
            'g:oae:not-a-user-id',
            400,
            () => {
              // Ensure we can't delete a non-existing user
              PrincipalsTestUtil.assertDeleteUserFails(
                user.restContext,
                'u:cam:non-existing-user',
                404,
                () => {
                  // Sanity check that we can delete a user
                  return PrincipalsTestUtil.assertDeleteUserSucceeds(
                    camAdminRestContext,
                    user.restContext,
                    user.user.id,
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
     * Test that verifies validation of restoring a group
     */
    it('verify validation of restoring a user', callback => {
      // Create a deleted user with which we'll test
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
        PrincipalsTestUtil.assertDeleteUserSucceeds(
          camAdminRestContext,
          camAdminRestContext,
          user.user.id,
          () => {
            // Ensure combinations of invalid user ids result in a 400
            PrincipalsTestUtil.assertRestoreUserFails(camAdminRestContext, 'not-an-id', 400, () => {
              PrincipalsTestUtil.assertRestoreUserFails(
                camAdminRestContext,
                'g:oae:not-a-user-id',
                400,
                () => {
                  // Ensure we can't restore a user that never existed
                  PrincipalsTestUtil.assertRestoreUserFails(
                    camAdminRestContext,
                    'u:cam:non-existing-user',
                    404,
                    () => {
                      // Sanity check that we can restore the user with the administrator
                      PrincipalsTestUtil.assertRestoreUserSucceeds(
                        camAdminRestContext,
                        user.user.id,
                        () => {
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

  describe('Permissions', () => {
    /**
     * Test that verifies that only managers and admins can delete a group
     */
    it('verify only manager and admins can delete a group', callback => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2) => {
        // Currently only the tenant admin is a manager on any of the groups. So, ensure
        // that no regular users can delete the group. Note that publicUser is a member
        // of publicGroup
        PrincipalsTestUtil.assertDeleteGroupFails(
          publicTenant1.anonymousRestContext,
          publicTenant1.publicGroup.id,
          401,
          () => {
            PrincipalsTestUtil.assertDeleteGroupFails(
              publicTenant1.publicUser.restContext,
              publicTenant1.publicGroup.id,
              401,
              () => {
                PrincipalsTestUtil.assertDeleteGroupFails(
                  publicTenant1.loggedinUser.restContext,
                  publicTenant1.publicGroup.id,
                  401,
                  () => {
                    PrincipalsTestUtil.assertDeleteGroupFails(
                      publicTenant1.privateUser.restContext,
                      publicTenant1.publicGroup.id,
                      401,
                      () => {
                        // Ensure tenant admin of another tenant cannot delete the group
                        PrincipalsTestUtil.assertDeleteGroupFails(
                          publicTenant2.adminRestContext,
                          publicTenant1.publicGroup.id,
                          401,
                          () => {
                            // Release 'manage' access from the tenant admin to users of the tenant. This is important because it ensures
                            // the "tenant admin can delete groups" check doesn't succeed by virtue of the tenant admin also being a
                            // manager of the group
                            const permissionChanges = {};
                            permissionChanges[publicTenant1.adminUser.user.id] = false;
                            permissionChanges[publicTenant1.publicUser.user.id] = 'manager';
                            RestAPI.Group.setGroupMembers(
                              publicTenant1.adminRestContext,
                              publicTenant1.publicGroup.id,
                              permissionChanges,
                              err => {
                                assert.ok(!err);
                                RestAPI.Group.setGroupMembers(
                                  publicTenant1.adminRestContext,
                                  publicTenant1.loggedinJoinableGroup.id,
                                  permissionChanges,
                                  err => {
                                    assert.ok(!err);
                                    RestAPI.Group.setGroupMembers(
                                      publicTenant1.adminRestContext,
                                      publicTenant1.privateJoinableGroup.id,
                                      permissionChanges,
                                      err => {
                                        assert.ok(!err);

                                        // Sanity check that manager, tenant admin and global admin can delete groups
                                        PrincipalsTestUtil.assertDeleteGroupSucceeds(
                                          publicTenant1.adminRestContext,
                                          publicTenant1.publicUser.restContext,
                                          publicTenant1.publicGroup.id,
                                          () => {
                                            PrincipalsTestUtil.assertDeleteGroupSucceeds(
                                              publicTenant1.adminRestContext,
                                              publicTenant1.adminRestContext,
                                              publicTenant1.loggedinJoinableGroup.id,
                                              () => {
                                                return PrincipalsTestUtil.assertDeleteGroupSucceeds(
                                                  publicTenant1.adminRestContext,
                                                  globalAdminOnTenantRestContext,
                                                  publicTenant1.privateJoinableGroup.id,
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
     * Test that verifies that only administrators can restore a group
     */
    it('verify only administrators can restore a group', callback => {
      // Create a user and a group with which we'll test
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, manager) => {
        TestsUtil.generateTestGroups(manager.restContext, 1, group => {
          // Delete the group
          PrincipalsTestUtil.assertDeleteGroupSucceeds(
            camAdminRestContext,
            manager.restContext,
            group.group.id,
            () => {
              // Ensure restoring as the manager, tenant admin of another tenant, and anonymous user all fail with 401
              PrincipalsTestUtil.assertRestoreGroupFails(
                manager.restContext,
                group.group.id,
                401,
                () => {
                  PrincipalsTestUtil.assertRestoreGroupFails(
                    gtAdminRestContext,
                    group.group.id,
                    401,
                    () => {
                      PrincipalsTestUtil.assertRestoreGroupFails(
                        anonymousRestContext,
                        group.group.id,
                        401,
                        () => {
                          // Ensure restoring as tenant admin succeeds
                          PrincipalsTestUtil.assertRestoreGroupSucceeds(
                            camAdminRestContext,
                            camAdminRestContext,
                            group.group.id,
                            () => {
                              // Delete the group again and ensure global admin can restore the group
                              PrincipalsTestUtil.assertDeleteGroupSucceeds(
                                camAdminRestContext,
                                manager.restContext,
                                group.group.id,
                                () => {
                                  return PrincipalsTestUtil.assertRestoreGroupSucceeds(
                                    camAdminRestContext,
                                    globalAdminOnTenantRestContext,
                                    group.group.id,
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
     * Test that verifies authorization of deleting a user
     */
    it('verify authorization of deleting a user', callback => {
      // Create a user with which we'll test
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, user1, user2, user3) => {
        // Anonymous, regular user and admin from another tenant cannot delete this user
        PrincipalsTestUtil.assertDeleteUserFails(anonymousRestContext, user1.user.id, 401, () => {
          PrincipalsTestUtil.assertDeleteUserFails(user2.restContext, user1.user.id, 401, () => {
            PrincipalsTestUtil.assertDeleteUserFails(gtAdminRestContext, user1.user.id, 401, () => {
              // Ensure user1 still exists and is not marked deleted
              PrincipalsTestUtil.assertGetUserSucceeds(
                user1.restContext,
                user1.user.id,
                user1AfterFailedDeletes => {
                  assert.strictEqual(user1AfterFailedDeletes.id, user1.user.id);
                  assert.ok(!user1AfterFailedDeletes.deleted);

                  // An admin and the user themself can delete the user
                  PrincipalsTestUtil.assertDeleteUserSucceeds(
                    camAdminRestContext,
                    globalAdminRestContext,
                    user1.user.id,
                    () => {
                      PrincipalsTestUtil.assertDeleteUserSucceeds(
                        camAdminRestContext,
                        camAdminRestContext,
                        user2.user.id,
                        () => {
                          PrincipalsTestUtil.assertDeleteUserSucceeds(
                            camAdminRestContext,
                            user3.restContext,
                            user3.user.id,
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
        });
      });
    });

    /**
     * Test that verifies authorization of restoring a user
     */
    it('verify authorization of restoring a user', callback => {
      // Create 2 deleted users with which we'll test
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, user1, user2) => {
        PrincipalsTestUtil.assertDeleteUserSucceeds(
          camAdminRestContext,
          camAdminRestContext,
          user1.user.id,
          () => {
            PrincipalsTestUtil.assertDeleteUserSucceeds(
              camAdminRestContext,
              camAdminRestContext,
              user2.user.id,
              () => {
                // Anonymous, the user themself, another user and admin from another tenant cannot restore this user
                PrincipalsTestUtil.assertRestoreUserFails(
                  anonymousRestContext,
                  user1.user.id,
                  401,
                  () => {
                    PrincipalsTestUtil.assertRestoreUserFails(
                      user1.restContext,
                      user1.user.id,
                      401,
                      () => {
                        PrincipalsTestUtil.assertRestoreUserFails(
                          user2.restContext,
                          user1.user.id,
                          401,
                          () => {
                            PrincipalsTestUtil.assertRestoreUserFails(
                              gtAdminRestContext,
                              user1.user.id,
                              401,
                              () => {
                                // Ensure the global admin and admin of the same tenant can restore the user
                                PrincipalsTestUtil.assertRestoreUserSucceeds(
                                  globalAdminRestContext,
                                  user1.user.id,
                                  () => {
                                    PrincipalsTestUtil.assertRestoreUserSucceeds(
                                      camAdminRestContext,
                                      user2.user.id,
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
      });
    });
  });

  describe('Profile', () => {
    /**
     * Test that verifies that deleting and restoring groups both removes and restores access to
     * its full group profile
     */
    it('verify deleting and restoring groups removes and restores access to its full group profile', callback => {
      // Create a user and group that will be deleted and restored
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, manager) => {
        TestsUtil.generateTestGroups(manager.restContext, 1, group => {
          // Delete the group, ensuring the side-effects (including 404 on group profile) succeeds
          PrincipalsTestUtil.assertDeleteGroupSucceeds(
            camAdminRestContext,
            manager.restContext,
            group.group.id,
            () => {
              // Restore the group, ensuring the side-effects (including successful access of group profile) succeeds
              PrincipalsTestUtil.assertRestoreGroupSucceeds(
                camAdminRestContext,
                camAdminRestContext,
                group.group.id,
                () => {
                  // Ensure the manager user can still access the group as well, and many of the profile fields
                  // are retained
                  const expectedFields = _.pick(
                    group.group,
                    'id',
                    'visibility',
                    'displayName',
                    'description',
                    'joinable',
                    'created'
                  );
                  PrincipalsTestUtil.assertGetGroupSucceeds(
                    manager.restContext,
                    group.group.id,
                    expectedFields,
                    restoredGroup => {
                      assert.strictEqual(group.group.createdBy.id, restoredGroup.createdBy.id);
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

    /**
     * Test that verifies that deleting and restoring groups multiple times re-invokes its
     * associated handler logic
     */
    it('verify deleting and restoring multiple times re-invokes handler logic', callback => {
      /*!
             * Create a group delete handler that maintains the count of times it has been invoked
             */
      let deleteHandlerCount = 0;
      PrincipalsDelete.registerGroupDeleteHandler(
        'test-group-reinvoke',
        (group, membershipsGraph, membersGraph, callback) => {
          deleteHandlerCount++;
          return callback();
        }
      );

      /*!
             * Create a group restore handler that maintains the count of times it has been invoked
             */
      let restoreHandlerCount = 0;
      PrincipalsDelete.registerGroupRestoreHandler(
        'test-group-reinvoke',
        (group, membershipsGraph, membersGraph, callback) => {
          restoreHandlerCount++;
          return callback();
        }
      );

      // Create a user and group that will be deleted and restored
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, manager) => {
        TestsUtil.generateTestGroups(manager.restContext, 1, group => {
          // Delete the group
          PrincipalsTestUtil.assertDeleteGroupSucceeds(
            camAdminRestContext,
            manager.restContext,
            group.group.id,
            () => {
              // Invoke the delete again, ensuring we re-invoke the handlers
              RestAPI.Group.deleteGroup(camAdminRestContext, group.group.id, err => {
                assert.ok(!err);
                PrincipalsDelete.whenDeletesComplete(() => {
                  assert.strictEqual(deleteHandlerCount, 2);
                  assert.strictEqual(restoreHandlerCount, 0);

                  // Restore the group
                  PrincipalsTestUtil.assertRestoreGroupSucceeds(
                    camAdminRestContext,
                    camAdminRestContext,
                    group.group.id,
                    () => {
                      RestAPI.Group.restoreGroup(camAdminRestContext, group.group.id, err => {
                        assert.ok(!err);
                        PrincipalsDelete.whenDeletesComplete(() => {
                          assert.strictEqual(deleteHandlerCount, 2);
                          assert.strictEqual(restoreHandlerCount, 2);
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
    });

    /**
     * Test that verifies that deleting and restoring groups both removes and restores access
     * to its members list
     */
    it('verify deleting and restoring groups removes and restores access to its members list', callback => {
      // Create a user and a deleted group to test with
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, manager) => {
        TestsUtil.generateTestGroups(manager.restContext, 1, group => {
          PrincipalsTestUtil.assertDeleteGroupSucceeds(
            camAdminRestContext,
            manager.restContext,
            group.group.id,
            () => {
              // Ensure getting the group members fails with a 404
              PrincipalsTestUtil.assertGetMembersLibraryFails(
                camAdminRestContext,
                group.group.id,
                null,
                null,
                404,
                () => {
                  PrincipalsTestUtil.assertGetMembersLibraryFails(
                    manager.restContext,
                    group.group.id,
                    null,
                    null,
                    404,
                    () => {
                      // Restore the group
                      PrincipalsTestUtil.assertRestoreGroupSucceeds(
                        camAdminRestContext,
                        camAdminRestContext,
                        group.group.id,
                        () => {
                          // Ensure the members list is as expected from before it was deleted
                          PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                            manager.restContext,
                            group.group.id,
                            [manager.user.id],
                            members => {
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
      });
    });

    /**
     * Test that verifies that deleting and restoring groups both removes and restores access to
     * update its profile
     */
    it('verify deleting and restoring groups removes and restores access to updates', callback => {
      // Create a user and a deleted group to test with
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, manager) => {
        TestsUtil.generateTestGroups(manager.restContext, 1, group => {
          PrincipalsTestUtil.assertDeleteGroupSucceeds(
            camAdminRestContext,
            manager.restContext,
            group.group.id,
            () => {
              // Ensure updating the group fails with a 404
              PrincipalsTestUtil.assertUpdateGroupFails(
                camAdminRestContext,
                group.group.id,
                { displayName: 'Another Display Name' },
                404,
                () => {
                  PrincipalsTestUtil.assertUpdateGroupFails(
                    manager.restContext,
                    group.group.id,
                    { displayName: 'Another Display Name' },
                    404,
                    () => {
                      // Restore the group
                      PrincipalsTestUtil.assertRestoreGroupSucceeds(
                        camAdminRestContext,
                        camAdminRestContext,
                        group.group.id,
                        () => {
                          // Ensure the group can now be updated
                          PrincipalsTestUtil.assertUpdateGroupSucceeds(
                            manager.restContext,
                            group.group.id,
                            { displayName: 'Another Display Name' },
                            group => {
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
      });
    });

    /**
     * Test that verifies that deleting and restoring groups both removes and restores access to
     * its memberships library
     */
    it('verify deleting and restoring groups removes and restores access to its memberships library', callback => {
      // Create a deleted group (childGroup) who has one group in its memberships library to
      // test with
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, manager) => {
        TestsUtil.generateTestGroups(manager.restContext, 2, (childGroup, parentGroup) => {
          TestsUtil.generateGroupHierarchy(
            manager.restContext,
            [parentGroup.group.id, childGroup.group.id],
            'member',
            () => {
              PrincipalsTestUtil.assertDeleteGroupSucceeds(
                camAdminRestContext,
                manager.restContext,
                childGroup.group.id,
                () => {
                  // Ensure getting the group memberships list fails
                  PrincipalsTestUtil.assertGetMembershipsLibraryFails(
                    camAdminRestContext,
                    childGroup.group.id,
                    null,
                    null,
                    404,
                    () => {
                      PrincipalsTestUtil.assertGetMembershipsLibraryFails(
                        manager.restContext,
                        childGroup.group.id,
                        null,
                        null,
                        404,
                        () => {
                          // Restore the group
                          PrincipalsTestUtil.assertRestoreGroupSucceeds(
                            camAdminRestContext,
                            camAdminRestContext,
                            childGroup.group.id,
                            () => {
                              // Ensure the memberships library is restored to its expected result
                              return PrincipalsTestUtil.assertMembershipsLibraryEquals(
                                manager.restContext,
                                childGroup.group.id,
                                [parentGroup.group.id],
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
     * Test that verifies that deleting and restoring groups both removes and restores access to
     * updating its members
     */
    it('verify deleting and restoring groups removes and restores access to updating group members', callback => {
      // Create a deleted group (parentGroup) who has one group in its memberships library to
      // test with
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, manager, member) => {
        TestsUtil.generateTestGroups(manager.restContext, 2, (childGroup, parentGroup) => {
          // Add a group and a user as members of the parentGroup
          const permissionChanges = {};
          permissionChanges[member.user.id] = 'manager';
          permissionChanges[childGroup.group.id] = 'member';
          PrincipalsTestUtil.assertSetGroupMembersSucceeds(
            manager.restContext,
            manager.restContext,
            parentGroup.group.id,
            permissionChanges,
            () => {
              // Delete the group so we can ensure updates to members no longer succeed
              PrincipalsTestUtil.assertDeleteGroupSucceeds(
                camAdminRestContext,
                manager.restContext,
                parentGroup.group.id,
                () => {
                  // Alter the permission changes to be different than what the group currently has
                  permissionChanges[member.user.id] = false;
                  permissionChanges[childGroup.group.id] = 'manager';

                  // Ensure setting the group members fails
                  PrincipalsTestUtil.assertSetGroupMembersFails(
                    manager.restContext,
                    camAdminRestContext,
                    parentGroup.group.id,
                    permissionChanges,
                    404,
                    () => {
                      PrincipalsTestUtil.assertSetGroupMembersFails(
                        manager.restContext,
                        manager.restContext,
                        parentGroup.group.id,
                        permissionChanges,
                        404,
                        () => {
                          // Restore the group
                          PrincipalsTestUtil.assertRestoreGroupSucceeds(
                            camAdminRestContext,
                            camAdminRestContext,
                            parentGroup.group.id,
                            () => {
                              // Ensure we can now update the members list
                              PrincipalsTestUtil.assertSetGroupMembersSucceeds(
                                manager.restContext,
                                manager.restContext,
                                parentGroup.group.id,
                                permissionChanges,
                                members => {
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
    });

    /**
     * Test that verifies that deleting and restoring groups both removes and restores access to
     * leaving it
     */
    it('verify deleting and restoring groups removes and restores access to leaving the group', callback => {
      // Create a deleted group who has one user in its memberships library to test with
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, manager, member) => {
        TestsUtil.generateTestGroups(manager.restContext, 1, group => {
          TestsUtil.generateGroupHierarchy(
            manager.restContext,
            [group.group.id, member.user.id],
            'member',
            () => {
              // Delete the group
              PrincipalsTestUtil.assertDeleteGroupSucceeds(
                camAdminRestContext,
                manager.restContext,
                group.group.id,
                () => {
                  // Ensure trying to leave the group results in a 404
                  PrincipalsTestUtil.assertLeaveGroupFails(
                    member.restContext,
                    group.group.id,
                    404,
                    () => {
                      // Restore the group
                      PrincipalsTestUtil.assertRestoreGroupSucceeds(
                        camAdminRestContext,
                        camAdminRestContext,
                        group.group.id,
                        () => {
                          // Ensure the user can now leave the group
                          return PrincipalsTestUtil.assertLeaveGroupSucceeds(
                            manager.restContext,
                            member.restContext,
                            group.group.id,
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
     * Test that verifies that deleting and restoring groups both removes and restores access to
     * joining it
     */
    it('verify deleting and restoring groups removes and restores access to joining the group', callback => {
      // Create a deleted, joinable group to test with
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, manager, member) => {
        TestsUtil.generateTestGroups(manager.restContext, 1, group => {
          PrincipalsTestUtil.assertUpdateGroupSucceeds(
            manager.restContext,
            group.group.id,
            { joinable: 'yes' },
            () => {
              PrincipalsTestUtil.assertDeleteGroupSucceeds(
                camAdminRestContext,
                manager.restContext,
                group.group.id,
                () => {
                  // Ensure trying to join the group results in a 404
                  PrincipalsTestUtil.assertJoinGroupFails(
                    member.restContext,
                    group.group.id,
                    404,
                    () => {
                      // Restore the group
                      PrincipalsTestUtil.assertRestoreGroupSucceeds(
                        camAdminRestContext,
                        camAdminRestContext,
                        group.group.id,
                        () => {
                          // Ensure the user can now join the group
                          return PrincipalsTestUtil.assertJoinGroupSucceeds(
                            manager.restContext,
                            member.restContext,
                            group.group.id,
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
     * Test that verifies that deleting and restoring users both removes and restores access to
     * its full user profile and me feed
     */
    it('verify deleting and restoring users removes and restores access to its full user profile and me feed', callback => {
      // Create a user and group that will be deleted and restored
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, user1, user2) => {
        // Delete the user as admin, ensuring it results in a 404 on the profile
        PrincipalsTestUtil.assertDeleteUserSucceeds(
          camAdminRestContext,
          camAdminRestContext,
          user1.user.id,
          () => {
            // Delete the user as the user themself, ensuring it results in a 404 and a lost session
            PrincipalsTestUtil.assertDeleteUserSucceeds(
              camAdminRestContext,
              user2.restContext,
              user2.user.id,
              () => {
                // Restore both users, ensuring their profiles become accessible
                PrincipalsTestUtil.assertRestoreUserSucceeds(
                  camAdminRestContext,
                  user1.user.id,
                  user1AfterRestore => {
                    PrincipalsTestUtil.assertRestoreUserSucceeds(
                      camAdminRestContext,
                      user2.user.id,
                      user2AfterRestore => {
                        // Ensure their sessions and me feeds reactivate
                        PrincipalsTestUtil.assertGetMeSucceeds(user1.restContext, me => {
                          assert.ok(!me.anon);
                          assert.strictEqual(me.id, user1.user.id);

                          // Re-authenticate user2's session, ensuring it is restored. Note that we have to do this with
                          // user2 because they made a request while they were deleted, so express cleared their
                          // session. We didn't have to do that as user1 because they never made a request as a deleted
                          // user
                          const { host } = global.oaeTests.tenants.cam;
                          const { username } = user2.restContext;
                          const password = user2.restContext.userPassword;
                          const user2RestContext = TestsUtil.createTenantRestContext(
                            host,
                            username,
                            password
                          );
                          PrincipalsTestUtil.assertGetMeSucceeds(user2RestContext, me => {
                            assert.ok(!me.anon);
                            assert.strictEqual(me.id, user2.user.id);
                            return callback();
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
  });

  describe('Members', () => {
    /**
     * Test that verifies deleting and restoring a user leaves them in members lists but marked
     * "deleted"
     */
    it('verify deleting and restoring a user leaves them in members lists but marked as deleted', callback => {
      // Generate users and a group to test with
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, user1, user2) => {
        assert.ok(!err);
        TestsUtil.generateTestGroups(camAdminRestContext, 1, group => {
          // Change user1's publicAlias
          RestAPI.User.updateUser(
            user1.restContext,
            user1.user.id,
            { publicAlias: 'Clark Kent' },
            (err, user) => {
              assert.ok(!err);

              // Add the user to the group members library
              const roleChanges = {};
              roleChanges[user1.user.id] = 'member';
              PrincipalsTestUtil.assertSetGroupMembersSucceeds(
                camAdminRestContext,
                camAdminRestContext,
                group.group.id,
                roleChanges,
                () => {
                  // Delete the user
                  PrincipalsTestUtil.assertDeleteUserSucceeds(
                    camAdminRestContext,
                    user1.restContext,
                    user1.user.id,
                    () => {
                      // Get the members library for the group, ensuring the user is still there and marked as deleted
                      PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                        camAdminRestContext,
                        group.group.id,
                        null,
                        null,
                        result => {
                          result = _.pluck(result.results, 'profile');
                          const userEntry = _.findWhere(result, { id: user1.user.id });
                          assert.ok(userEntry);
                          assert.ok(_.isNumber(userEntry.deleted));

                          // Get the members as a non-admin to verify the profile is masked
                          PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                            user2.restContext,
                            group.group.id,
                            null,
                            null,
                            result => {
                              result = _.pluck(result.results, 'profile');
                              const userEntry = _.findWhere(result, { id: user1.user.id });
                              assert.ok(userEntry);
                              assert.ok(!userEntry.profilePath);
                              assert.strictEqual('Clark Kent', userEntry.displayName);
                              assert.ok(_.isNumber(userEntry.deleted));

                              // Restore the user
                              PrincipalsTestUtil.assertRestoreUserSucceeds(
                                camAdminRestContext,
                                user1.user.id,
                                () => {
                                  // Get the members library for the group, ensuring the user is still there and no longer marked as deleted
                                  PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                                    camAdminRestContext,
                                    group.group.id,
                                    null,
                                    null,
                                    result => {
                                      result = _.pluck(result.results, 'profile');
                                      const userEntry = _.findWhere(result, { id: user1.user.id });
                                      assert.ok(userEntry);
                                      assert.ok(!userEntry.deleted);
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

  describe('Memberships', () => {
    /**
     * Test that verifies deleting and restoring a user removes and restores access to its
     * memberships feed
     */
    it('verify deleting and restoring a user removes and restores access to its memberships feed', callback => {
      // Generate a deleted user to test with
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, user, userToDelete) => {
        assert.ok(!err);

        PrincipalsTestUtil.assertDeleteUserSucceeds(
          camAdminRestContext,
          camAdminRestContext,
          userToDelete.user.id,
          () => {
            // Ensure that the memberships library of the user cannot be accessed
            PrincipalsTestUtil.assertGetMembershipsLibraryFails(
              camAdminRestContext,
              userToDelete.user.id,
              null,
              null,
              404,
              () => {
                // Restore the user, ensuring access to their memberships library is restored
                PrincipalsTestUtil.assertRestoreUserSucceeds(
                  camAdminRestContext,
                  userToDelete.user.id,
                  () => {
                    // Ensure access to the user's membership library is restored
                    PrincipalsTestUtil.assertGetMembershipsLibrarySucceeds(
                      user.restContext,
                      userToDelete.user.id,
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
      });
    });

    /**
     * Test that verifies that deleting and restoring groups both removes and restores indirect
     * memberships associations from memberships libraries
     */
    it('verify deleting and restoring a group removes and restores indirect memberships from memberships libraries', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
        assert.ok(!err);

        TestsUtil.generateTestGroups(camAdminRestContext, 4, (...args) => {
          const groups = Array.prototype.slice.call(args);
          const groupIds = _.chain(groups)
            .pluck('group')
            .pluck('id')
            .value();
          const principalIds = groupIds.concat(user.user.id);

          // Create the group hierarchy and ensure it is as expected
          TestsUtil.generateGroupHierarchy(camAdminRestContext, principalIds, 'member', () => {
            PrincipalsTestUtil.assertMembershipsLibraryEquals(
              user.restContext,
              user.user.id,
              groupIds,
              () => {
                // Delete the group that is directly the parent of the user. This should erase the user's
                // entire memberships library, not just the direct group itself
                PrincipalsTestUtil.assertDeleteGroupSucceeds(
                  camAdminRestContext,
                  _.last(groups).restContext,
                  _.last(groupIds),
                  () => {
                    // Ensure that the memberships library of the user is now completely empty
                    PrincipalsTestUtil.assertMembershipsLibraryEquals(
                      user.restContext,
                      user.user.id,
                      [],
                      () => {
                        // Restore the group, and ensure the entire hierarchy is restored into the user's
                        // memberships library
                        PrincipalsTestUtil.assertRestoreGroupSucceeds(
                          camAdminRestContext,
                          camAdminRestContext,
                          _.last(groupIds),
                          () => {
                            // Ensure the user's memberships library now has all original groups we created
                            return PrincipalsTestUtil.assertMembershipsLibraryEquals(
                              user.restContext,
                              user.user.id,
                              groupIds,
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
    });

    /**
     * Test that verifies that deleted groups still show in a group members feed
     */
    it('verify a deleted group can show in a group members feed', callback => {
      // Create a group that has a deleted group as a member
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, manager) => {
        TestsUtil.generateTestGroups(manager.restContext, 2, (childGroup, parentGroup) => {
          TestsUtil.generateGroupHierarchy(
            manager.restContext,
            [parentGroup.group.id, childGroup.group.id],
            'member',
            () => {
              PrincipalsTestUtil.assertDeleteGroupSucceeds(
                camAdminRestContext,
                manager.restContext,
                childGroup.group.id,
                () => {
                  // Verify the members list of the parent still has the group with an
                  // indication that it is deleted and no profile path
                  PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                    manager.restContext,
                    parentGroup.group.id,
                    [manager.user.id, childGroup.group.id],
                    members => {
                      const childGroupEntry = _.find(members, memberEntry => {
                        return memberEntry.profile.id === childGroup.group.id;
                      });

                      assert.ok(_.isNumber(childGroupEntry.profile.deleted));
                      assert.ok(
                        !_.chain(childGroupEntry.profile)
                          .keys()
                          .contains('profilePath')
                          .value()
                      );

                      // Restore the group and ensure it appears without the deleted flag
                      // in the group members list
                      PrincipalsTestUtil.assertRestoreGroupSucceeds(
                        camAdminRestContext,
                        camAdminRestContext,
                        childGroup.group.id,
                        () => {
                          // Ensure the group is still there in the members list, but now
                          // doesn't have a deleted flag and the profile path is restored
                          PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                            manager.restContext,
                            parentGroup.group.id,
                            [manager.user.id, childGroup.group.id],
                            members => {
                              const childGroupEntry = _.find(members, memberEntry => {
                                return memberEntry.profile.id === childGroup.group.id;
                              });

                              assert.ok(
                                !_.chain(childGroupEntry.profile)
                                  .keys()
                                  .contains('deleted')
                                  .value()
                              );
                              assert.ok(childGroupEntry.profile.profilePath);
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
      });
    });
  });

  describe('Following', () => {
    /**
     * Test that verifies that deleting and restoring a user removes and restores access to
     * their following and followers lists
     */
    it('verify deleting and restoring a user removes and restores access to their following and followers lists', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, user, userToDelete) => {
        // Delete the user
        PrincipalsTestUtil.assertDeleteUserSucceeds(
          camAdminRestContext,
          camAdminRestContext,
          userToDelete.user.id,
          () => {
            // Ensure there is no access to their following or followers feed
            FollowingTestUtil.assertNoFollowFeedAccess(
              user.restContext,
              [userToDelete.user.id],
              404,
              () => {
                // Restore the user
                PrincipalsTestUtil.assertRestoreUserSucceeds(
                  camAdminRestContext,
                  userToDelete.user.id,
                  () => {
                    // Ensure access is restored to the following and followers feed
                    FollowingTestUtil.assertHasFollowFeedAccess(
                      user.restContext,
                      [userToDelete.user.id],
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
     * Test that verifies deleting and restoring a user removes and restores them in followers
     * lists
     */
    it('verify deleting and restoring a user removes and restores them in followers lists', callback => {
      // Create a user (userToFollow) that is followed by a bunch of other users
      TestsUtil.generateTestUsers(
        camAdminRestContext,
        10,
        (err, users, userToFollow, userToDelete0, userToDelete1) => {
          const followerUserInfos = [userToDelete0, userToDelete1];
          FollowingTestUtil.followByAll(userToFollow.user.id, followerUserInfos, () => {
            // Ensure that all users appear in the userToFollow's followers list
            const followerUserIds = _.chain(followerUserInfos)
              .pluck('user')
              .pluck('id')
              .value();
            const followerUserIdsAfterDelete = _.without(
              followerUserIds,
              userToDelete0.user.id,
              userToDelete1.user.id
            );
            FollowingTestUtil.assertGetAllFollowersEquals(
              userToFollow.restContext,
              userToFollow.user.id,
              { batchSize: 1 },
              followerUserIds,
              () => {
                // Delete 2 of the users, ensuring they are no longer in the userToFollow's followers list
                PrincipalsTestUtil.assertDeleteUserSucceeds(
                  camAdminRestContext,
                  camAdminRestContext,
                  userToDelete0.user.id,
                  () => {
                    PrincipalsTestUtil.assertDeleteUserSucceeds(
                      camAdminRestContext,
                      camAdminRestContext,
                      userToDelete1.user.id,
                      () => {
                        FollowingTestUtil.assertGetAllFollowersEquals(
                          userToFollow.restContext,
                          userToFollow.user.id,
                          { batchSize: 1 },
                          followerUserIdsAfterDelete,
                          () => {
                            // Restore the 2 users, ensuring the re-appear in the userToFollow's followers list
                            PrincipalsTestUtil.assertRestoreUserSucceeds(
                              camAdminRestContext,
                              userToDelete0.user.id,
                              () => {
                                PrincipalsTestUtil.assertRestoreUserSucceeds(
                                  camAdminRestContext,
                                  userToDelete1.user.id,
                                  () => {
                                    FollowingTestUtil.assertGetAllFollowersEquals(
                                      userToFollow.restContext,
                                      userToFollow.user.id,
                                      { batchSize: 1 },
                                      followerUserIds,
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
          });
        }
      );
    });

    /**
     * Test that verifies deleting and restoring a user removes and restores them in following
     * lists
     */
    it('verify deleting and restoring a user removes and restores them in following lists', callback => {
      // Create a user (userFollowing) that follows a bunch of other users
      TestsUtil.generateTestUsers(
        camAdminRestContext,
        10,
        (err, users, userFollowing, userToDelete0, userToDelete1) => {
          const followingUserInfos = [userToDelete0, userToDelete1];
          const followingUserIds = _.chain(followingUserInfos)
            .pluck('user')
            .pluck('id')
            .value();
          const followingUserIdsAfterDelete = _.without(
            followingUserIds,
            userToDelete0.user.id,
            userToDelete1.user.id
          );
          FollowingTestUtil.followAll(userFollowing.restContext, followingUserIds, () => {
            // Ensure the userFollowing sees all the user they follow in their following list
            FollowingTestUtil.assertGetAllFollowingEquals(
              userFollowing.restContext,
              userFollowing.user.id,
              { batchSize: 1 },
              followingUserIds,
              () => {
                // Delete 2 of the users, ensuring they are no longer in the userFollowing's following list
                PrincipalsTestUtil.assertDeleteUserSucceeds(
                  camAdminRestContext,
                  camAdminRestContext,
                  userToDelete0.user.id,
                  () => {
                    PrincipalsTestUtil.assertDeleteUserSucceeds(
                      camAdminRestContext,
                      camAdminRestContext,
                      userToDelete1.user.id,
                      () => {
                        FollowingTestUtil.assertGetAllFollowingEquals(
                          userFollowing.restContext,
                          userFollowing.user.id,
                          { batchSize: 1 },
                          followingUserIdsAfterDelete,
                          () => {
                            // Restore the 2 users, ensuring they re-appear in the userFollowing's following list
                            PrincipalsTestUtil.assertRestoreUserSucceeds(
                              camAdminRestContext,
                              userToDelete0.user.id,
                              () => {
                                PrincipalsTestUtil.assertRestoreUserSucceeds(
                                  camAdminRestContext,
                                  userToDelete1.user.id,
                                  () => {
                                    FollowingTestUtil.assertGetAllFollowingEquals(
                                      userFollowing.restContext,
                                      userFollowing.user.id,
                                      { batchSize: 1 },
                                      followingUserIds,
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
          });
        }
      );
    });
  });

  describe('Search', () => {
    describe('General', () => {
      /**
       * Test that verifies that deleting and restoring groups both removes and restores it in
       * general search
       */
      it('verify deleting and restoring a group removes it and adds it back in general search', callback => {
        // Create a group to test with
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, manager) => {
          TestsUtil.generateTestGroups(manager.restContext, 1, group => {
            // Ensure we can search for it
            SearchTestUtil.assertSearchContains(
              manager.restContext,
              'general',
              null,
              { q: group.group.displayName },
              [group.group.id],
              response => {
                // Delete the group
                PrincipalsTestUtil.assertDeleteGroupSucceeds(
                  camAdminRestContext,
                  manager.restContext,
                  group.group.id,
                  () => {
                    // Ensure we now cannot search for it
                    SearchTestUtil.assertSearchNotContains(
                      manager.restContext,
                      'general',
                      null,
                      { q: group.group.displayName },
                      [group.group.id],
                      response => {
                        // Restore the group
                        PrincipalsTestUtil.assertRestoreGroupSucceeds(
                          camAdminRestContext,
                          camAdminRestContext,
                          group.group.id,
                          () => {
                            // Ensure we can search for it again
                            SearchTestUtil.assertSearchContains(
                              manager.restContext,
                              'general',
                              null,
                              { q: group.group.displayName },
                              [group.group.id],
                              response => {
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
        });
      });

      /**
       * Test that verifies that deleting and restoring groups both removes and restores it in
       * general search
       */
      it('verify deleting and restoring a user removes them and adds them back in general search', callback => {
        // Create a group to test with
        TestsUtil.generateTestUsers(
          camAdminRestContext,
          2,
          (err, users, userSearcher, userDeleted) => {
            // Ensure we can search for it
            SearchTestUtil.assertSearchContains(
              userSearcher.restContext,
              'general',
              null,
              { q: userDeleted.displayName },
              [userDeleted.user.id],
              response => {
                // Delete the group
                PrincipalsTestUtil.assertDeleteUserSucceeds(
                  camAdminRestContext,
                  userDeleted.restContext,
                  userDeleted.user.id,
                  () => {
                    // Ensure we now cannot search for it
                    SearchTestUtil.assertSearchNotContains(
                      userSearcher.restContext,
                      'general',
                      null,
                      { q: userDeleted.user.displayName },
                      [userDeleted.user.id],
                      response => {
                        // Restore the group
                        PrincipalsTestUtil.assertRestoreUserSucceeds(
                          camAdminRestContext,
                          userDeleted.user.id,
                          () => {
                            // Ensure we can search for it again
                            SearchTestUtil.assertSearchContains(
                              userSearcher.restContext,
                              'general',
                              null,
                              { q: userDeleted.user.displayName },
                              [userDeleted.user.id],
                              response => {
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

    describe('Memberships', () => {
      /**
       * Test that verifies that deleting and restoring groups both removes and restores
       * access to memberships search
       */
      it('verify deleting and restoring a group removes and adds access to its memberships search', callback => {
        // Create a user and group to test with
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, manager) => {
          TestsUtil.generateTestGroups(manager.restContext, 1, group => {
            // Ensure the memberships library can be searched
            SearchTestUtil.assertSearchSucceeds(
              manager.restContext,
              'memberships-library',
              [group.group.id],
              null,
              response => {
                // Delete the group
                PrincipalsTestUtil.assertDeleteGroupSucceeds(
                  camAdminRestContext,
                  manager.restContext,
                  group.group.id,
                  () => {
                    // Ensure the memberships search now results in a 404
                    SearchTestUtil.assertSearchFails(
                      manager.restContext,
                      'memberships-library',
                      [group.group.id],
                      null,
                      404,
                      () => {
                        // Restore the group
                        PrincipalsTestUtil.assertRestoreGroupSucceeds(
                          camAdminRestContext,
                          camAdminRestContext,
                          group.group.id,
                          () => {
                            // Ensure the memberships search succeeds again
                            SearchTestUtil.assertSearchSucceeds(
                              manager.restContext,
                              'memberships-library',
                              [group.group.id],
                              null,
                              response => {
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
        });
      });

      /**
       * Test that verifies that deleting and restoring users both removes and restores access
       * to memberships search
       */
      it('verify deleting and restoring a user removes and adds access to its memberships search', callback => {
        // Create a user to test with
        TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, user, userToDelete) => {
          // Delete the user
          PrincipalsTestUtil.assertDeleteUserSucceeds(
            camAdminRestContext,
            userToDelete.restContext,
            userToDelete.user.id,
            () => {
              // Ensure the memberships search results in a 404
              SearchTestUtil.assertSearchFails(
                user.restContext,
                'memberships-library',
                [userToDelete.user.id],
                null,
                404,
                () => {
                  // Restore the user
                  PrincipalsTestUtil.assertRestoreUserSucceeds(
                    camAdminRestContext,
                    userToDelete.user.id,
                    () => {
                      // Ensure the memberships search now succeeds
                      SearchTestUtil.assertSearchSucceeds(
                        user.restContext,
                        'memberships-library',
                        [userToDelete.user.id],
                        null,
                        response => {
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
       * Test that verifies that deleting and restoring groups both removes and restores
       * indirect memberships associations in memberships search
       */
      it('verify deleting and restoring a group removes and adds indirect groups in memberships search', callback => {
        // Create a group memberships hierarchy to test with
        TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, manager, member) => {
          TestsUtil.generateTestGroups(manager.restContext, 4, function(...groups) {
            let [group1, group2, group3, group4] = groups;
            const groupIds = _.chain(groups)
              .pluck('group')
              .pluck('id')
              .value();
            TestsUtil.generateGroupHierarchy(
              manager.restContext,
              groupIds.concat(member.user.id),
              'member',
              () => {
                // Ensure our member user can find all the groups in their memberships
                // library search
                SearchTestUtil.assertSearchContains(
                  member.restContext,
                  'memberships-library',
                  [member.user.id],
                  null,
                  groupIds,
                  () => {
                    // Delete the group that is a direct parent of the user (group4)
                    PrincipalsTestUtil.assertDeleteGroupSucceeds(
                      camAdminRestContext,
                      manager.restContext,
                      group4.group.id,
                      () => {
                        // Ensure the member cannot find any of the groups in their memberships search
                        SearchTestUtil.assertSearchNotContains(
                          member.restContext,
                          'memberships-library',
                          [member.user.id],
                          null,
                          groupIds,
                          () => {
                            // Restore the group and ensure they find them all again
                            PrincipalsTestUtil.assertRestoreGroupSucceeds(
                              camAdminRestContext,
                              camAdminRestContext,
                              group4.group.id,
                              () => {
                                SearchTestUtil.assertSearchContains(
                                  member.restContext,
                                  'memberships-library',
                                  [member.user.id],
                                  null,
                                  groupIds,
                                  () => {
                                    // Delete an intermediary group (group2) and ensure group3 and group4 show up, but not group1
                                    PrincipalsTestUtil.assertDeleteGroupSucceeds(
                                      camAdminRestContext,
                                      manager.restContext,
                                      group2.group.id,
                                      () => {
                                        SearchTestUtil.assertSearchNotContains(
                                          member.restContext,
                                          'memberships-library',
                                          [member.user.id],
                                          null,
                                          groupIds.slice(0, 2),
                                          () => {
                                            SearchTestUtil.assertSearchContains(
                                              member.restContext,
                                              'memberships-library',
                                              [member.user.id],
                                              null,
                                              groupIds.slice(2),
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
          });
        });
      });

      /**
       * Test that verifies that deleting and restoring groups both removes and restores
       * access to its members search
       */
      it('verify deleting and restoring a group removes and adds access to its members search', callback => {
        // Create a user and group to test with
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, manager) => {
          TestsUtil.generateTestGroups(manager.restContext, 1, group => {
            // Ensure the memberships library can be searched
            SearchTestUtil.assertSearchContains(
              manager.restContext,
              'members-library',
              [group.group.id],
              null,
              [manager.user.id],
              response => {
                // Delete the group
                PrincipalsTestUtil.assertDeleteGroupSucceeds(
                  camAdminRestContext,
                  manager.restContext,
                  group.group.id,
                  () => {
                    // Ensure the memberships search now results in a 404
                    SearchTestUtil.assertSearchFails(
                      manager.restContext,
                      'members-library',
                      [group.group.id],
                      null,
                      404,
                      () => {
                        // Restore the group
                        PrincipalsTestUtil.assertRestoreGroupSucceeds(
                          camAdminRestContext,
                          camAdminRestContext,
                          group.group.id,
                          () => {
                            // Ensure the memberships search succeeds again
                            SearchTestUtil.assertSearchContains(
                              manager.restContext,
                              'members-library',
                              [group.group.id],
                              null,
                              [manager.user.id],
                              response => {
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
        });
      });

      /**
       * Test that verifies that deleting and restoring groups results in groups still showing
       * up in members search with a deletion indication
       */
      it('verify deleting and restoring a group results in it still showing up in members search with a deletion indication', callback => {
        // Create a group memberships hierarchy to test with
        TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, manager, member) => {
          TestsUtil.generateTestGroups(manager.restContext, 4, function(...groups) {
            let [parentGroup, childGroup1, childGroup2, childGroup3] = groups;
            const memberIds = _.chain(groups)
              .pluck('group')
              .pluck('id')
              .value()
              .slice(1)
              .concat(member.user.id);

            // Add all members to the parent group
            const roleChanges = {};
            _.each(memberIds, memberId => {
              roleChanges[memberId] = 'member';
            });
            PrincipalsTestUtil.assertSetGroupMembersSucceeds(
              manager.restContext,
              manager.restContext,
              parentGroup.group.id,
              roleChanges,
              () => {
                // Ensure we see all the groups in members search
                SearchTestUtil.assertSearchContains(
                  manager.restContext,
                  'members-library',
                  [parentGroup.group.id],
                  null,
                  memberIds,
                  response => {
                    // Delete the first child group and ensure it can still be found in the members search
                    PrincipalsTestUtil.assertDeleteGroupSucceeds(
                      camAdminRestContext,
                      manager.restContext,
                      childGroup1.group.id,
                      () => {
                        SearchTestUtil.assertSearchContains(
                          manager.restContext,
                          'members-library',
                          [parentGroup.group.id],
                          null,
                          memberIds,
                          response => {
                            // Ensure the document that represents the deleted group indicates it is deleted with
                            // no profile path
                            const childGroup1Document = _.findWhere(response.results, {
                              id: childGroup1.group.id
                            });
                            assert.ok(childGroup1Document);
                            assert.ok(_.isNumber(childGroup1Document.deleted));
                            assert.ok(
                              !_.chain(childGroup1Document)
                                .keys()
                                .contains('profilePath')
                                .value()
                            );

                            // Restore the first child group and ensure it is still in the members search with the deleted indicator removed and its
                            // `profilePath` property restored
                            PrincipalsTestUtil.assertRestoreGroupSucceeds(
                              camAdminRestContext,
                              camAdminRestContext,
                              childGroup1.group.id,
                              () => {
                                SearchTestUtil.assertSearchContains(
                                  manager.restContext,
                                  'members-library',
                                  [parentGroup.group.id],
                                  null,
                                  memberIds,
                                  response => {
                                    // Ensure the document that represents the restored group indicates it is not deleted
                                    // with a profile path
                                    const childGroup1Document = _.findWhere(response.results, {
                                      id: childGroup1.group.id
                                    });
                                    assert.ok(childGroup1Document);
                                    assert.ok(
                                      !_.chain(childGroup1Document)
                                        .keys()
                                        .contains('deleted')
                                        .value()
                                    );
                                    assert.ok(childGroup1Document.profilePath);
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
      });
    });

    describe('Following', () => {
      /**
       * Test that verifies deleting and restoring a user removes and restores access to their
       * following and followers search
       */
      it('verify deleting and restoring a user removes and restores access to their following and followers search', callback => {
        TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, user, userToDelete) => {
          // Delete the user
          PrincipalsTestUtil.assertDeleteUserSucceeds(
            camAdminRestContext,
            camAdminRestContext,
            userToDelete.user.id,
            () => {
              // Ensure there is no access to their following or followers feed
              FollowingTestUtil.assertNoSearchFeedAccess(
                user.restContext,
                [userToDelete.user.id],
                404,
                () => {
                  // Restore the user
                  PrincipalsTestUtil.assertRestoreUserSucceeds(
                    camAdminRestContext,
                    userToDelete.user.id,
                    () => {
                      // Ensure access is restored to the following and followers feed
                      FollowingTestUtil.assertHasSearchFeedAccess(
                        user.restContext,
                        [userToDelete.user.id],
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
       * Test that verifies deleting and restoring a user removes and restores them in
       * followers search
       */
      it('verify deleting and restoring a user removes and restores them in followers search', callback => {
        // Create a user (userToFollow) that is followed by a bunch of other users
        TestsUtil.generateTestUsers(
          camAdminRestContext,
          10,
          (err, users, userToFollow, userToDelete0, userToDelete1) => {
            const followerUserInfos = [userToDelete0, userToDelete1];
            FollowingTestUtil.followByAll(userToFollow.user.id, followerUserInfos, () => {
              // Ensure that all users appear in the userToFollow's followers list
              const followerUserIds = _.chain(followerUserInfos)
                .pluck('user')
                .pluck('id')
                .value();
              const followerUserIdsAfterDelete = _.without(
                followerUserIds,
                userToDelete0.user.id,
                userToDelete1.user.id
              );
              SearchTestUtil.assertSearchEquals(
                userToFollow.restContext,
                'followers',
                [userToFollow.user.id],
                null,
                followerUserIds,
                () => {
                  // Delete 2 of the users, ensuring they are no longer in the userToFollow's followers list
                  PrincipalsTestUtil.assertDeleteUserSucceeds(
                    camAdminRestContext,
                    camAdminRestContext,
                    userToDelete0.user.id,
                    () => {
                      PrincipalsTestUtil.assertDeleteUserSucceeds(
                        camAdminRestContext,
                        camAdminRestContext,
                        userToDelete1.user.id,
                        () => {
                          SearchTestUtil.assertSearchEquals(
                            userToFollow.restContext,
                            'followers',
                            [userToFollow.user.id],
                            null,
                            followerUserIdsAfterDelete,
                            () => {
                              // Restore the 2 users, ensuring the re-appear in the userToFollow's followers list
                              PrincipalsTestUtil.assertRestoreUserSucceeds(
                                camAdminRestContext,
                                userToDelete0.user.id,
                                () => {
                                  PrincipalsTestUtil.assertRestoreUserSucceeds(
                                    camAdminRestContext,
                                    userToDelete1.user.id,
                                    () => {
                                      SearchTestUtil.assertSearchEquals(
                                        userToFollow.restContext,
                                        'followers',
                                        [userToFollow.user.id],
                                        null,
                                        followerUserIds,
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
            });
          }
        );
      });

      /**
       * Test that verifies deleting and restoring a user removes and restores them in
       * followings search
       */
      it('verify deleting and restoring a user removes and restores them in following search', callback => {
        // Create a user (userFollowing) that follows a bunch of other users
        TestsUtil.generateTestUsers(
          camAdminRestContext,
          10,
          (err, users, userFollowing, userToDelete0, userToDelete1) => {
            const followingUserInfos = [userToDelete0, userToDelete1];
            const followingUserIds = _.chain(followingUserInfos)
              .pluck('user')
              .pluck('id')
              .value();
            const followingUserIdsAfterDelete = _.without(
              followingUserIds,
              userToDelete0.user.id,
              userToDelete1.user.id
            );
            FollowingTestUtil.followAll(userFollowing.restContext, followingUserIds, () => {
              // Ensure the userFollowing sees all the user they follow in their following list
              SearchTestUtil.assertSearchEquals(
                userFollowing.restContext,
                'following',
                [userFollowing.user.id],
                null,
                followingUserIds,
                () => {
                  // Delete 2 of the users, ensuring they are no longer in the userFollowing's following list
                  PrincipalsTestUtil.assertDeleteUserSucceeds(
                    camAdminRestContext,
                    camAdminRestContext,
                    userToDelete0.user.id,
                    () => {
                      PrincipalsTestUtil.assertDeleteUserSucceeds(
                        camAdminRestContext,
                        camAdminRestContext,
                        userToDelete1.user.id,
                        () => {
                          SearchTestUtil.assertSearchEquals(
                            userFollowing.restContext,
                            'following',
                            [userFollowing.user.id],
                            null,
                            followingUserIdsAfterDelete,
                            () => {
                              // Restore the 2 users, ensuring they re-appear in the userFollowing's following list
                              PrincipalsTestUtil.assertRestoreUserSucceeds(
                                camAdminRestContext,
                                userToDelete0.user.id,
                                () => {
                                  PrincipalsTestUtil.assertRestoreUserSucceeds(
                                    camAdminRestContext,
                                    userToDelete1.user.id,
                                    () => {
                                      SearchTestUtil.assertSearchEquals(
                                        userFollowing.restContext,
                                        'following',
                                        [userFollowing.user.id],
                                        null,
                                        followingUserIds,
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
            });
          }
        );
      });
    });

    describe('Deleted', () => {
      /**
       * Test that verifies authorization of the deleted search
       */
      it('verify authorization of deleted search', callback => {
        TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2) => {
          // Ensure non-admin users cannot search deleted items
          SearchTestUtil.assertSearchFails(
            publicTenant1.anonymousRestContext,
            'deleted',
            null,
            null,
            401,
            () => {
              SearchTestUtil.assertSearchFails(
                publicTenant1.publicUser.restContext,
                'deleted',
                null,
                null,
                401,
                () => {
                  // Ensure admin users can search deleted items
                  SearchTestUtil.assertSearchSucceeds(
                    publicTenant1.adminRestContext,
                    'deleted',
                    null,
                    null,
                    response => {
                      SearchTestUtil.assertSearchSucceeds(
                        globalAdminRestContext,
                        'deleted',
                        null,
                        null,
                        response => {
                          SearchTestUtil.assertSearchSucceeds(
                            globalAdminRestContext,
                            'deleted',
                            null,
                            null,
                            response => {
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
      });

      /**
       * Test that verifies scope resolution of the deleted search for global admin
       */
      it('verify scope resolution of deleted search for global admin', callback => {
        const description = TestsUtil.generateRandomText(16);
        TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2) => {
          const tenant1Groups = [
            publicTenant1.publicGroup,
            publicTenant1.loggedinJoinableGroup,
            publicTenant1.privateJoinableGroup
          ];
          const tenant2Groups = [
            publicTenant2.publicGroup,
            publicTenant2.loggedinJoinableGroup,
            publicTenant2.privateJoinableGroup
          ];
          const tenant1Users = [
            publicTenant1.publicUser,
            publicTenant1.loggedinUser,
            publicTenant1.privateUser
          ];
          const tenant2Users = [
            publicTenant2.publicUser,
            publicTenant2.loggedinUser,
            publicTenant2.privateUser
          ];
          const tenant1GroupIds = _.chain(tenant1Groups)
            .pluck('id')
            .value();
          const tenant2GroupIds = _.chain(tenant2Groups)
            .pluck('id')
            .value();
          const tenant1UserIds = _.chain(tenant1Users)
            .pluck('user')
            .pluck('id')
            .value();
          const tenant2UserIds = _.chain(tenant2Users)
            .pluck('user')
            .pluck('id')
            .value();
          const allGroupIds = _.union(tenant1GroupIds, tenant2GroupIds);
          const allUserIds = _.union(tenant1UserIds, tenant2UserIds);

          // Update all users and groups groups to have a description that we can search on
          PrincipalsTestUtil.assertUpdateGroupsSucceeds(
            publicTenant1.adminRestContext,
            tenant1GroupIds,
            { description },
            tenant1GroupsUpdated => {
              PrincipalsTestUtil.assertUpdateGroupsSucceeds(
                publicTenant2.adminRestContext,
                tenant2GroupIds,
                { description },
                tenant2GroupsUpdated => {
                  PrincipalsTestUtil.assertUpdateUsersSucceeds(
                    publicTenant1.adminRestContext,
                    tenant1UserIds,
                    { displayName: description },
                    tenant1UsersUpdated => {
                      PrincipalsTestUtil.assertUpdateUsersSucceeds(
                        publicTenant2.adminRestContext,
                        tenant2UserIds,
                        { displayName: description },
                        tenant2UsersUpdated => {
                          // Delete the groups and users in both of our tenants, LOL!!!
                          PrincipalsTestUtil.assertDeleteGroupsSucceeds(
                            publicTenant1.adminRestContext,
                            publicTenant1.adminRestContext,
                            tenant1GroupIds,
                            () => {
                              PrincipalsTestUtil.assertDeleteGroupsSucceeds(
                                publicTenant2.adminRestContext,
                                publicTenant2.adminRestContext,
                                tenant2GroupIds,
                                () => {
                                  PrincipalsTestUtil.assertDeleteUsersSucceeds(
                                    publicTenant1.adminRestContext,
                                    publicTenant1.adminRestContext,
                                    tenant1UserIds,
                                    () => {
                                      PrincipalsTestUtil.assertDeleteUsersSucceeds(
                                        publicTenant2.adminRestContext,
                                        publicTenant2.adminRestContext,
                                        tenant2UserIds,
                                        () => {
                                          // Ensure global admin can search all tenant users and groups together with _all/default scope
                                          SearchTestUtil.assertSearchContains(
                                            globalAdminRestContext,
                                            'deleted',
                                            null,
                                            { q: description },
                                            allGroupIds,
                                            () => {
                                              SearchTestUtil.assertSearchContains(
                                                globalAdminRestContext,
                                                'deleted',
                                                null,
                                                { q: description, scope: '_all' },
                                                allGroupIds,
                                                () => {
                                                  SearchTestUtil.assertSearchContains(
                                                    globalAdminRestContext,
                                                    'deleted',
                                                    null,
                                                    { q: description },
                                                    allUserIds,
                                                    () => {
                                                      SearchTestUtil.assertSearchContains(
                                                        globalAdminRestContext,
                                                        'deleted',
                                                        null,
                                                        { q: description, scope: '_all' },
                                                        allUserIds,
                                                        () => {
                                                          // Ensure global admin can search groups and users in tenant1 and tenant2 alone using scope
                                                          SearchTestUtil.assertSearchContains(
                                                            globalAdminRestContext,
                                                            'deleted',
                                                            null,
                                                            {
                                                              q: description,
                                                              scope: publicTenant1.tenant.alias
                                                            },
                                                            tenant1GroupIds,
                                                            () => {
                                                              SearchTestUtil.assertSearchNotContains(
                                                                globalAdminRestContext,
                                                                'deleted',
                                                                null,
                                                                {
                                                                  q: description,
                                                                  scope: publicTenant1.tenant.alias
                                                                },
                                                                tenant2GroupIds,
                                                                () => {
                                                                  SearchTestUtil.assertSearchContains(
                                                                    globalAdminRestContext,
                                                                    'deleted',
                                                                    null,
                                                                    {
                                                                      q: description,
                                                                      scope:
                                                                        publicTenant2.tenant.alias
                                                                    },
                                                                    tenant2GroupIds,
                                                                    () => {
                                                                      SearchTestUtil.assertSearchNotContains(
                                                                        globalAdminRestContext,
                                                                        'deleted',
                                                                        null,
                                                                        {
                                                                          q: description,
                                                                          scope:
                                                                            publicTenant2.tenant
                                                                              .alias
                                                                        },
                                                                        tenant1GroupIds,
                                                                        () => {
                                                                          SearchTestUtil.assertSearchContains(
                                                                            globalAdminRestContext,
                                                                            'deleted',
                                                                            null,
                                                                            {
                                                                              q: description,
                                                                              scope:
                                                                                publicTenant1.tenant
                                                                                  .alias
                                                                            },
                                                                            tenant1UserIds,
                                                                            () => {
                                                                              SearchTestUtil.assertSearchNotContains(
                                                                                globalAdminRestContext,
                                                                                'deleted',
                                                                                null,
                                                                                {
                                                                                  q: description,
                                                                                  scope:
                                                                                    publicTenant1
                                                                                      .tenant.alias
                                                                                },
                                                                                tenant2UserIds,
                                                                                () => {
                                                                                  SearchTestUtil.assertSearchContains(
                                                                                    globalAdminRestContext,
                                                                                    'deleted',
                                                                                    null,
                                                                                    {
                                                                                      q: description,
                                                                                      scope:
                                                                                        publicTenant2
                                                                                          .tenant
                                                                                          .alias
                                                                                    },
                                                                                    tenant2UserIds,
                                                                                    () => {
                                                                                      SearchTestUtil.assertSearchNotContains(
                                                                                        globalAdminRestContext,
                                                                                        'deleted',
                                                                                        null,
                                                                                        {
                                                                                          q: description,
                                                                                          scope:
                                                                                            publicTenant2
                                                                                              .tenant
                                                                                              .alias
                                                                                        },
                                                                                        tenant1UserIds,
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
        });
      });

      /**
       * Test that verifies the scope specification is ignored in deleted search for tenant
       * admins
       */
      it('verify scope is ignored for tenant admin in deleted search', callback => {
        const description = TestsUtil.generateRandomText(16);
        TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2) => {
          const tenant1Groups = [
            publicTenant1.publicGroup,
            publicTenant1.loggedinJoinableGroup,
            publicTenant1.privateJoinableGroup
          ];
          const tenant2Groups = [
            publicTenant2.publicGroup,
            publicTenant2.loggedinJoinableGroup,
            publicTenant2.privateJoinableGroup
          ];
          const tenant1Users = [
            publicTenant1.publicUser,
            publicTenant1.loggedinUser,
            publicTenant1.privateUser
          ];
          const tenant2Users = [
            publicTenant2.publicUser,
            publicTenant2.loggedinUser,
            publicTenant2.privateUser
          ];
          const tenant1GroupIds = _.chain(tenant1Groups)
            .pluck('id')
            .value();
          const tenant2GroupIds = _.chain(tenant2Groups)
            .pluck('id')
            .value();
          const tenant1UserIds = _.chain(tenant1Users)
            .pluck('user')
            .pluck('id')
            .value();
          const tenant2UserIds = _.chain(tenant2Users)
            .pluck('user')
            .pluck('id')
            .value();
          const allGroupIds = _.union(tenant1GroupIds, tenant2GroupIds);
          const allUserIds = _.union(tenant1UserIds, tenant2UserIds);

          // Update all groups to have a description that we can search on
          PrincipalsTestUtil.assertUpdateGroupsSucceeds(
            publicTenant1.adminRestContext,
            tenant1GroupIds,
            { description },
            tenant1GroupsUpdated => {
              PrincipalsTestUtil.assertUpdateGroupsSucceeds(
                publicTenant2.adminRestContext,
                tenant2GroupIds,
                { description },
                tenant2GroupsUpdated => {
                  PrincipalsTestUtil.assertUpdateUsersSucceeds(
                    publicTenant1.adminRestContext,
                    tenant1UserIds,
                    { displayName: description },
                    tenant1UsersUpdated => {
                      PrincipalsTestUtil.assertUpdateUsersSucceeds(
                        publicTenant2.adminRestContext,
                        tenant2UserIds,
                        { displayName: description },
                        tenant2UsersUpdated => {
                          // Delete the groups and users in both of our tenants, LOL!!!
                          PrincipalsTestUtil.assertDeleteGroupsSucceeds(
                            publicTenant1.adminRestContext,
                            publicTenant1.adminRestContext,
                            tenant1GroupIds,
                            () => {
                              PrincipalsTestUtil.assertDeleteGroupsSucceeds(
                                publicTenant2.adminRestContext,
                                publicTenant2.adminRestContext,
                                tenant2GroupIds,
                                () => {
                                  PrincipalsTestUtil.assertDeleteUsersSucceeds(
                                    publicTenant1.adminRestContext,
                                    publicTenant1.adminRestContext,
                                    tenant1UserIds,
                                    () => {
                                      PrincipalsTestUtil.assertDeleteUsersSucceeds(
                                        publicTenant2.adminRestContext,
                                        publicTenant2.adminRestContext,
                                        tenant2UserIds,
                                        () => {
                                          // Ensure that scope is ignored for tenant1 admin, they can only search deleted groups and users for tenant1
                                          SearchTestUtil.assertSearchContains(
                                            publicTenant1.adminRestContext,
                                            'deleted',
                                            null,
                                            { q: description },
                                            _.union(tenant1GroupIds, tenant1UserIds),
                                            () => {
                                              SearchTestUtil.assertSearchNotContains(
                                                publicTenant1.adminRestContext,
                                                'deleted',
                                                null,
                                                { q: description },
                                                _.union(tenant2GroupIds, tenant2UserIds),
                                                () => {
                                                  SearchTestUtil.assertSearchContains(
                                                    publicTenant1.adminRestContext,
                                                    'deleted',
                                                    null,
                                                    { q: description, scope: '_all' },
                                                    _.union(tenant1GroupIds, tenant1UserIds),
                                                    () => {
                                                      SearchTestUtil.assertSearchNotContains(
                                                        publicTenant1.adminRestContext,
                                                        'deleted',
                                                        null,
                                                        { q: description, scope: '_all' },
                                                        _.union(tenant2GroupIds, tenant2UserIds),
                                                        () => {
                                                          SearchTestUtil.assertSearchContains(
                                                            publicTenant1.adminRestContext,
                                                            'deleted',
                                                            null,
                                                            {
                                                              q: description,
                                                              scope: publicTenant2.tenant.alias
                                                            },
                                                            _.union(
                                                              tenant1GroupIds,
                                                              tenant1UserIds
                                                            ),
                                                            () => {
                                                              SearchTestUtil.assertSearchNotContains(
                                                                publicTenant1.adminRestContext,
                                                                'deleted',
                                                                null,
                                                                {
                                                                  q: description,
                                                                  scope: publicTenant2.tenant.alias
                                                                },
                                                                _.union(
                                                                  tenant2GroupIds,
                                                                  tenant2UserIds
                                                                ),
                                                                () => {
                                                                  // Ensure that scope is ignored for tenant2 admin, they can only search deleted resources for tenant2
                                                                  SearchTestUtil.assertSearchContains(
                                                                    publicTenant2.adminRestContext,
                                                                    'deleted',
                                                                    null,
                                                                    { q: description },
                                                                    _.union(
                                                                      tenant2GroupIds,
                                                                      tenant2UserIds
                                                                    ),
                                                                    () => {
                                                                      SearchTestUtil.assertSearchNotContains(
                                                                        publicTenant2.adminRestContext,
                                                                        'deleted',
                                                                        null,
                                                                        { q: description },
                                                                        _.union(
                                                                          tenant1GroupIds,
                                                                          tenant1UserIds
                                                                        ),
                                                                        () => {
                                                                          SearchTestUtil.assertSearchContains(
                                                                            publicTenant2.adminRestContext,
                                                                            'deleted',
                                                                            null,
                                                                            {
                                                                              q: description,
                                                                              scope: '_all'
                                                                            },
                                                                            _.union(
                                                                              tenant2GroupIds,
                                                                              tenant2UserIds
                                                                            ),
                                                                            () => {
                                                                              SearchTestUtil.assertSearchNotContains(
                                                                                publicTenant2.adminRestContext,
                                                                                'deleted',
                                                                                null,
                                                                                {
                                                                                  q: description,
                                                                                  scope: '_all'
                                                                                },
                                                                                _.union(
                                                                                  tenant1GroupIds,
                                                                                  tenant1UserIds
                                                                                ),
                                                                                () => {
                                                                                  SearchTestUtil.assertSearchContains(
                                                                                    publicTenant2.adminRestContext,
                                                                                    'deleted',
                                                                                    null,
                                                                                    {
                                                                                      q: description,
                                                                                      scope:
                                                                                        publicTenant1
                                                                                          .tenant
                                                                                          .alias
                                                                                    },
                                                                                    _.union(
                                                                                      tenant2GroupIds,
                                                                                      tenant2UserIds
                                                                                    ),
                                                                                    () => {
                                                                                      SearchTestUtil.assertSearchNotContains(
                                                                                        publicTenant2.adminRestContext,
                                                                                        'deleted',
                                                                                        null,
                                                                                        {
                                                                                          q: description,
                                                                                          scope:
                                                                                            publicTenant1
                                                                                              .tenant
                                                                                              .alias
                                                                                        },
                                                                                        _.union(
                                                                                          tenant1GroupIds,
                                                                                          tenant1UserIds
                                                                                        ),
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
        });
      });
    });
  });

  describe('Migrations', () => {
    /**
     * Verifies that the disable users by tenant migration works
     */
    it('verify deleting users by tenancy', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, user1, user2, user3) => {
        assert.ok(!err);
        PrincipalsTestUtil.assertGetUserSucceeds(user1.restContext, user1.user.id, () => {
          PrincipalsTestUtil.assertGetUserSucceeds(user2.restContext, user2.user.id, () => {
            PrincipalsTestUtil.assertGetUserSucceeds(user3.restContext, user3.user.id, () => {
              const globalAdminContext = TestsUtil.createGlobalAdminContext();
              DisableUsersMigration.doMigration(
                globalAdminContext,
                global.oaeTests.tenants.cam.alias,
                true,
                (err, affectedUsers) => {
                  assert.ok(!err);
                  // Update redis and search since we updated outside the scope of the API
                  Redis.flush(err => {
                    assert.ok(!err);
                    PrincipalsTestUtil.assertGetUserFails(
                      user1.restContext,
                      user1.user.id,
                      404,
                      () => {
                        PrincipalsTestUtil.assertGetUserFails(
                          user2.restContext,
                          user2.user.id,
                          404,
                          () => {
                            PrincipalsTestUtil.assertGetUserFails(
                              user3.restContext,
                              user3.user.id,
                              404,
                              () => {
                                DisableUsersMigration.doMigration(
                                  globalAdminContext,
                                  global.oaeTests.tenants.cam.alias,
                                  false,
                                  (err, affectedUsers) => {
                                    assert.ok(!err);
                                    Redis.flush(err => {
                                      assert.ok(!err);
                                      PrincipalsTestUtil.assertGetUserSucceeds(
                                        user1.restContext,
                                        user1.user.id,
                                        () => {
                                          PrincipalsTestUtil.assertGetUserSucceeds(
                                            user2.restContext,
                                            user2.user.id,
                                            () => {
                                              PrincipalsTestUtil.assertGetUserSucceeds(
                                                user3.restContext,
                                                user3.user.id,
                                                () => {
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
