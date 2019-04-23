/*!
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

import assert from 'assert';
import _ from 'underscore';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util';

describe('Members Library', () => {
  // REST contexts we can use to do REST requests
  let globalAdminOnTenantRestContext = null;
  let camAdminRestContext = null;
  let anonymousRestContext = null;

  before(callback => {
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // Authenticate the global admin into a tenant so we can perform user-tenant requests with a global admin to test their access
    RestAPI.Admin.loginOnTenant(TestsUtil.createGlobalAdminRestContext(), 'localhost', null, (err, ctx) => {
      assert.ok(!err);
      globalAdminOnTenantRestContext = ctx;
      return callback();
    });
  });

  describe('Feed', () => {
    describe('Validation', () => {
      /**
       * Test that verifies the validation of the members library feed
       */
      it('verify validation of members library feed', callback => {
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
          assert.ok(!err);
          TestsUtil.generateTestGroups(user.restContext, 1, group => {
            // Ensure it fails with a variety of bogus group ids
            PrincipalsTestUtil.assertGetMembersLibraryFails(user.restContext, 'not-a-valid-id', null, null, 400, () => {
              PrincipalsTestUtil.assertGetMembersLibraryFails(
                user.restContext,
                'c:oae:not-a-group-id',
                null,
                null,
                400,
                () => {
                  PrincipalsTestUtil.assertGetMembersLibraryFails(
                    user.restContext,
                    'g:oae:non-existing-group-id',
                    null,
                    null,
                    404,
                    () => {
                      // Sanity check we can get a successful response with our setup
                      PrincipalsTestUtil.assertGetMembersLibraryFails(
                        user.restContext,
                        group.id,
                        null,
                        null,
                        400,
                        () => {
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

    describe('Authorization', () => {
      /**
       * Test that verifies the authorization of the public group members library feed
       */
      it('verify authorization of public group members library feed', callback => {
        TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2, privateTenant1, privateTenant2) => {
          // Ensure all users can see a public group's members library
          PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
            publicTenant1.anonymousRestContext,
            publicTenant1.publicGroup.id,
            null,
            null,
            () => {
              PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                publicTenant1.adminRestContext,
                publicTenant1.publicGroup.id,
                null,
                null,
                () => {
                  PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                    publicTenant1.publicUser.restContext,
                    publicTenant1.publicGroup.id,
                    null,
                    null,
                    () => {
                      PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                        publicTenant2.publicUser.restContext,
                        publicTenant1.publicGroup.id,
                        null,
                        null,
                        () => {
                          PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                            publicTenant2.adminRestContext,
                            publicTenant1.publicGroup.id,
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
        });
      });

      /**
       * Test that verifies the authorization of the loggedin group members library feed
       */
      it('verify authorization of loggedin joinable group members library feed', callback => {
        TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2, privateTenant1, privateTenant2) => {
          // Ensure all users can see a public group's members library
          PrincipalsTestUtil.assertGetMembersLibraryFails(
            publicTenant1.anonymousRestContext,
            publicTenant1.loggedinJoinableGroup.id,
            null,
            null,
            401,
            () => {
              PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                publicTenant1.adminRestContext,
                publicTenant1.loggedinJoinableGroup.id,
                null,
                null,
                () => {
                  PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                    publicTenant1.publicUser.restContext,
                    publicTenant1.loggedinJoinableGroup.id,
                    null,
                    null,
                    () => {
                      PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                        publicTenant2.publicUser.restContext,
                        publicTenant1.loggedinJoinableGroup.id,
                        null,
                        null,
                        () => {
                          PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                            publicTenant2.adminRestContext,
                            publicTenant1.loggedinJoinableGroup.id,
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
        });
      });

      it('verify authorization of loggedin non joinable group members library feed', callback => {
        TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2, privateTenant1, privateTenant2) => {
          // Ensure all users can see a public group's members library
          PrincipalsTestUtil.assertGetMembersLibraryFails(
            publicTenant1.anonymousRestContext,
            publicTenant1.loggedinNotJoinableGroup.id,
            null,
            null,
            401,
            () => {
              PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                publicTenant1.adminRestContext,
                publicTenant1.loggedinNotJoinableGroup.id,
                null,
                null,
                () => {
                  PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                    publicTenant1.publicUser.restContext,
                    publicTenant1.loggedinNotJoinableGroup.id,
                    null,
                    null,
                    () => {
                      PrincipalsTestUtil.assertGetMembersLibraryFails(
                        publicTenant2.publicUser.restContext,
                        publicTenant1.loggedinNotJoinableGroup.id,
                        null,
                        null,
                        401,
                        () => {
                          PrincipalsTestUtil.assertGetMembersLibraryFails(
                            publicTenant2.adminRestContext,
                            publicTenant1.loggedinNotJoinableGroup.id,
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
        });
      });

      it('verify authorization of loggedin joinable group (by request) members library feed', callback => {
        TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2, privateTenant1, privateTenant2) => {
          // Ensure all users can see a public group's members library
          PrincipalsTestUtil.assertGetMembersLibraryFails(
            publicTenant1.anonymousRestContext,
            publicTenant1.loggedinJoinableGroupByRequest.id,
            null,
            null,
            401,
            () => {
              PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                publicTenant1.adminRestContext,
                publicTenant1.loggedinJoinableGroupByRequest.id,
                null,
                null,
                () => {
                  PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                    publicTenant1.publicUser.restContext,
                    publicTenant1.loggedinJoinableGroupByRequest.id,
                    null,
                    null,
                    () => {
                      PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                        publicTenant2.publicUser.restContext,
                        publicTenant1.loggedinJoinableGroupByRequest.id,
                        null,
                        null,
                        () => {
                          PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                            publicTenant2.adminRestContext,
                            publicTenant1.loggedinJoinableGroupByRequest.id,
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
        });
      });

      /**
       * Test that verifies the authorization of the private group members library feed
       */
      it('verify authorization of private joinable group members library feed', callback => {
        TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2, privateTenant1, privateTenant2) => {
          // Ensure all users can see a public group's members library
          PrincipalsTestUtil.assertGetMembersLibraryFails(
            publicTenant1.anonymousRestContext,
            publicTenant1.privateJoinableGroup.id,
            null,
            null,
            401,
            () => {
              PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                publicTenant1.adminRestContext,
                publicTenant1.privateJoinableGroup.id,
                null,
                null,
                () => {
                  // Issue1402: since the group is joinable, a user is able to access its public items, including the member list
                  PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                    publicTenant1.publicUser.restContext,
                    publicTenant1.privateJoinableGroup.id,
                    null,
                    null,
                    () => {
                      PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                        publicTenant2.publicUser.restContext,
                        publicTenant1.privateJoinableGroup.id,
                        null,
                        null,
                        () => {
                          // Issue1402: since the group is joinable, a user is able to access its public items, including the member list
                          PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                            publicTenant2.adminRestContext,
                            publicTenant1.privateJoinableGroup.id,
                            null,
                            null,
                            () => {
                              // Give the group a member and verify it succeeds
                              const change = {};
                              change[publicTenant1.publicUser.user.id] = 'member';
                              PrincipalsTestUtil.assertSetGroupMembersSucceeds(
                                publicTenant1.adminRestContext,
                                publicTenant1.adminRestContext,
                                publicTenant1.privateJoinableGroup.id,
                                change,
                                () => {
                                  PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                                    publicTenant1.publicUser.restContext,
                                    publicTenant1.privateJoinableGroup.id,
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
        });
      });

      it('verify authorization of private not joinable group members library feed', callback => {
        TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2, privateTenant1, privateTenant2) => {
          // Ensure all users can see a public group's members library
          PrincipalsTestUtil.assertGetMembersLibraryFails(
            publicTenant1.anonymousRestContext,
            publicTenant1.privateNotJoinableGroup.id,
            null,
            null,
            401,
            () => {
              PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                publicTenant1.adminRestContext,
                publicTenant1.privateNotJoinableGroup.id,
                null,
                null,
                () => {
                  PrincipalsTestUtil.assertGetMembersLibraryFails(
                    publicTenant1.publicUser.restContext,
                    publicTenant1.privateNotJoinableGroup.id,
                    null,
                    null,
                    401,
                    () => {
                      PrincipalsTestUtil.assertGetMembersLibraryFails(
                        publicTenant2.publicUser.restContext,
                        publicTenant1.privateNotJoinableGroup.id,
                        null,
                        null,
                        401,
                        () => {
                          PrincipalsTestUtil.assertGetMembersLibraryFails(
                            publicTenant2.adminRestContext,
                            publicTenant1.privateNotJoinableGroup.id,
                            null,
                            null,
                            401,
                            () => {
                              // Give the group a member and verify it succeeds
                              const change = {};
                              change[publicTenant1.publicUser.user.id] = 'member';
                              PrincipalsTestUtil.assertSetGroupMembersSucceeds(
                                publicTenant1.adminRestContext,
                                publicTenant1.adminRestContext,
                                publicTenant1.privateNotJoinableGroup.id,
                                change,
                                () => {
                                  PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                                    publicTenant1.publicUser.restContext,
                                    publicTenant1.privateNotJoinableGroup.id,
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
        });
      });

      it('verify authorization of private joinable group (by request) members library feed', callback => {
        TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2, privateTenant1, privateTenant2) => {
          // Ensure all users can see a public group's members library
          PrincipalsTestUtil.assertGetMembersLibraryFails(
            publicTenant1.anonymousRestContext,
            publicTenant1.privateJoinableGroupByRequest.id,
            null,
            null,
            401,
            () => {
              PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                publicTenant1.adminRestContext,
                publicTenant1.privateJoinableGroupByRequest.id,
                null,
                null,
                () => {
                  // Issue1402: since the group is joinable, a user is able to access its public items, including the member list
                  PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                    publicTenant1.publicUser.restContext,
                    publicTenant1.privateJoinableGroupByRequest.id,
                    null,
                    null,
                    () => {
                      PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                        publicTenant2.publicUser.restContext,
                        publicTenant1.privateJoinableGroupByRequest.id,
                        null,
                        null,
                        () => {
                          // Issue1402: since the group is joinable, a user is able to access its public items, including the member list
                          PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                            publicTenant2.adminRestContext,
                            publicTenant1.privateJoinableGroupByRequest.id,
                            null,
                            null,
                            () => {
                              // Give the group a member and verify it succeeds
                              const change = {};
                              change[publicTenant1.publicUser.user.id] = 'member';
                              PrincipalsTestUtil.assertSetGroupMembersSucceeds(
                                publicTenant1.adminRestContext,
                                publicTenant1.adminRestContext,
                                publicTenant1.privateJoinableGroupByRequest.id,
                                change,
                                () => {
                                  PrincipalsTestUtil.assertGetMembersLibrarySucceeds(
                                    publicTenant1.publicUser.restContext,
                                    publicTenant1.privateJoinableGroupByRequest.id,
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
        });
      });

      /**
       * Test that verifies that the group members library feed offers only public, loggedin
       * and private items when appropriate
       */
      it('verify only the appropriate members are seen from the group members library feed', callback => {
        TestsUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2, privateTenant1, privateTenant2) => {
          TestsUtil.generateTestUsers(publicTenant1.adminRestContext, 1, (err, users, publicTenant1ExtraUser) => {
            assert.ok(!err);

            // These are the expected public, loggedin, private library contents
            const publicItems = [publicTenant1.publicUser.user.id];
            const loggedinItems = publicItems.concat(publicTenant1.loggedinUser.user.id);
            const privateItems = loggedinItems.concat(publicTenant1.privateUser.user.id);

            // Add users to the public group
            const change = {};
            change[publicTenant1.adminUser.user.id] = false;
            change[publicTenant1.publicUser.user.id] = 'member';
            change[publicTenant1.loggedinUser.user.id] = 'member';
            change[publicTenant1.privateUser.user.id] = 'manager';
            PrincipalsTestUtil.assertSetGroupMembersSucceeds(
              publicTenant1.adminRestContext,
              publicTenant1.adminRestContext,
              publicTenant1.publicGroup.id,
              change,
              () => {
                // Ensure public members library is given for non-authenticated users
                PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                  publicTenant1.anonymousRestContext,
                  publicTenant1.publicGroup.id,
                  publicItems,
                  () => {
                    PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                      publicTenant2.publicUser.restContext,
                      publicTenant1.publicGroup.id,
                      publicItems,
                      () => {
                        PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                          publicTenant2.adminRestContext,
                          publicTenant1.publicGroup.id,
                          publicItems,
                          () => {
                            // Ensure loggedin members library is given for authenticated users
                            PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                              publicTenant1ExtraUser.restContext,
                              publicTenant1.publicGroup.id,
                              loggedinItems,
                              () => {
                                // Ensure private members library is given for a member user
                                PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                                  publicTenant1.publicUser.restContext,
                                  publicTenant1.publicGroup.id,
                                  privateItems,
                                  members => {
                                    // Ensure the private user is obfuscated for the public user
                                    const privateUserResult = _.find(members, member => {
                                      return member.profile.visibility === 'private';
                                    });

                                    assert.ok(privateUserResult);
                                    assert.ok(!privateUserResult.profile.profilePath);
                                    assert.ok(!privateUserResult.profile.publicAlias);

                                    // Ensure private members library is given for an admin user
                                    PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                                      publicTenant1.adminRestContext,
                                      publicTenant1.publicGroup.id,
                                      privateItems,
                                      members => {
                                        // Ensure the private user is obfuscated
                                        const privateUserResult = _.find(members, member => {
                                          return member.profile.visibility === 'private';
                                        });

                                        assert.ok(privateUserResult);
                                        assert.strictEqual(
                                          privateUserResult.profile.profilePath,
                                          publicTenant1.privateUser.user.profilePath
                                        );
                                        assert.strictEqual(
                                          privateUserResult.profile.publicAlias,
                                          publicTenant1.privateUser.user.publicAlias
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

    describe('Updates', () => {
      /**
       * Test that verifies that setting the group members results in an appropriately updated
       * group members library feed
       */
      it('verify setting group members updates the group members library', callback => {
        TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, user1) => {
          assert.ok(!err);
          TestsUtil.generateTestGroups(user1.restContext, 2, (group, group2) => {
            // Get the group members library to seed it
            PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
              user1.restContext,
              group.group.id,
              [user1.user.id],
              () => {
                // Add a member, ensuring the first user in the list is the manager,
                // because they are ranked higher in the library
                const change = {};
                change[group2.group.id] = 'member';
                PrincipalsTestUtil.assertSetGroupMembersSucceeds(
                  user1.restContext,
                  user1.restContext,
                  group.group.id,
                  change,
                  members => {
                    assert.strictEqual(members[0].profile.id, user1.user.id);

                    // Swap the roles and ensure that the group is now the first item in
                    // the members list
                    change[user1.user.id] = 'member';
                    change[group2.group.id] = 'manager';
                    PrincipalsTestUtil.assertSetGroupMembersSucceeds(
                      user1.restContext,
                      user1.restContext,
                      group.group.id,
                      change,
                      members => {
                        assert.strictEqual(members[0].profile.id, group2.group.id);
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
       * Test that verifies that a user joining and leaving a group properly updates the
       * group members library feed
       */
      it('verify joining and leaving group updates the group members library', callback => {
        TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, user1, user2) => {
          assert.ok(!err);
          TestsUtil.generateTestGroups(user1.restContext, 1, group => {
            PrincipalsTestUtil.assertUpdateGroupSucceeds(user1.restContext, group.group.id, { joinable: 'yes' }, () => {
              // Get the group members library to seed it
              PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                user1.restContext,
                group.group.id,
                [user1.user.id],
                () => {
                  // Join the group as user2, which ensures the members library is appropriately updated
                  PrincipalsTestUtil.assertJoinGroupSucceeds(
                    user1.restContext,
                    user2.restContext,
                    group.group.id,
                    () => {
                      // Leave the group as user2, which ensures the members library is appropriately updated
                      return PrincipalsTestUtil.assertLeaveGroupSucceeds(
                        user1.restContext,
                        user2.restContext,
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
       * Test that verifies that when a user or group updates their group profile, the members
       * library feed gets updated to indicate the new user ranking
       */
      it('verify user and group setting profile picture updates the group members library', callback => {
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user1) => {
          assert.ok(!err);
          TestsUtil.generateTestGroups(user1.restContext, 2, (group, group2) => {
            const change = {};
            change[group2.group.id] = 'member';
            PrincipalsTestUtil.assertSetGroupMembersSucceeds(
              user1.restContext,
              user1.restContext,
              group.group.id,
              change,
              members => {
                // Ensure the manager shows up before the member, because they both have
                // no profile picture and the manager gets prioritized before members
                assert.deepStrictEqual(
                  _.chain(members)
                    .pluck('profile')
                    .pluck('id')
                    .value(),
                  [user1.user.id, group2.group.id]
                );

                // The member user will add a profile picture to the group, which should
                // prioritize it higher than manager
                PrincipalsTestUtil.assertUploadGroupPictureSucceeds(user1.restContext, group2.group.id, null, () => {
                  // Ensure group2 now has precedence with its picture
                  PrincipalsTestUtil.assertGetAllMembersLibrarySucceeds(
                    user1.restContext,
                    group.group.id,
                    null,
                    members => {
                      assert.deepStrictEqual(
                        _.chain(members)
                          .pluck('profile')
                          .pluck('id')
                          .value(),
                        [group2.group.id, user1.user.id]
                      );

                      // Now the manager user uploads one, they should re-take precedence in the library
                      PrincipalsTestUtil.assertUploadUserPictureSucceeds(user1.restContext, user1.user.id, null, () => {
                        PrincipalsTestUtil.assertGetAllMembersLibrarySucceeds(
                          user1.restContext,
                          group.group.id,
                          null,
                          members => {
                            assert.deepStrictEqual(
                              _.chain(members)
                                .pluck('profile')
                                .pluck('id')
                                .value(),
                              [user1.user.id, group2.group.id]
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
        });
      });

      /**
       * Test that verifies that when a user or group visibility is updated, the members
       * library feed gets updated appropriately
       */
      it('verify visibility updates to a user and group also updates a group members library', callback => {
        TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, user1) => {
          assert.ok(!err);
          TestsUtil.generateTestGroups(user1.restContext, 2, (group, group2) => {
            const change = {};
            change[group2.group.id] = 'member';
            PrincipalsTestUtil.assertSetGroupMembersSucceeds(
              user1.restContext,
              user1.restContext,
              group.group.id,
              change,
              members => {
                // Ensure the anonymous user can see both the manager user and group in the library because they are public
                PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                  anonymousRestContext,
                  group.group.id,
                  [user1.user.id, group2.group.id],
                  () => {
                    // Update user1's visibility to loggedin and ensure the anonymous user can only see the public group
                    PrincipalsTestUtil.assertUpdateUserSucceeds(
                      user1.restContext,
                      user1.user.id,
                      { visibility: 'loggedin' },
                      () => {
                        PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                          anonymousRestContext,
                          group.group.id,
                          [group2.group.id],
                          () => {
                            // Update the group's visibility to loggedin and ensure the anonymous user can't see anyone
                            PrincipalsTestUtil.assertUpdateGroupSucceeds(
                              user1.restContext,
                              group2.group.id,
                              { visibility: 'loggedin' },
                              () => {
                                PrincipalsTestUtil.assertGetAllMembersLibraryEquals(
                                  anonymousRestContext,
                                  group.group.id,
                                  [],
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
      });
    });

    describe('Ranking', () => {
      /**
       * Test that verifies that ranking gives library ranking precedence to:
       *
       *  1. Picture visibility
       *  2. Profile visibility
       *  3. Group role
       */
      it('verify that ranking gives precedence to picture visibility, profile visibility and role, respectively', callback => {
        TestsUtil.setupMultiTenantPrivacyEntities((tenant1, tenant2) => {
          PrincipalsTestUtil.assertUpdateGroupSucceeds(
            tenant1.adminRestContext,
            tenant1.publicGroup.id,
            { joinable: 'yes' },
            () => {
              TestsUtil.generateTestUsers(
                tenant1.adminRestContext,
                3,
                (err, users, publicWithPicture, loggedinWithPicture, privateWithPicture) => {
                  assert.ok(!err);

                  // Update the visibility of our non-public users
                  PrincipalsTestUtil.assertUpdateUserSucceeds(
                    tenant1.adminRestContext,
                    loggedinWithPicture.user.id,
                    { visibility: 'loggedin' },
                    () => {
                      PrincipalsTestUtil.assertUpdateUserSucceeds(
                        tenant1.adminRestContext,
                        privateWithPicture.user.id,
                        { visibility: 'private' },
                        () => {
                          // Give profile pictures to those who should have them
                          const userIdsWithPicture = [
                            publicWithPicture.user.id,
                            loggedinWithPicture.user.id,
                            privateWithPicture.user.id
                          ];
                          PrincipalsTestUtil.assertUploadUserPicturesSucceeds(
                            tenant1.adminRestContext,
                            userIdsWithPicture,
                            null,
                            () => {
                              // Finally, make all users a member of the group
                              const changes = {};
                              changes[tenant1.publicUser.user.id] = 'member';
                              changes[tenant1.loggedinUser.user.id] = 'member';
                              changes[tenant1.privateUser.user.id] = 'member';
                              changes[publicWithPicture.user.id] = 'member';
                              changes[loggedinWithPicture.user.id] = 'member';
                              changes[privateWithPicture.user.id] = 'member';
                              PrincipalsTestUtil.assertSetGroupMembersSucceeds(
                                tenant1.adminRestContext,
                                tenant1.adminRestContext,
                                tenant1.publicGroup.id,
                                changes,
                                () => {
                                  // Good visibility with picture wins, secondary is good visibility without picture,
                                  // tertiary is the role in the group
                                  const expectedOrder1 = _.flatten([
                                    publicWithPicture.user.id,
                                    loggedinWithPicture.user.id,
                                    tenant1.adminUser.user.id,
                                    tenant1.publicUser.user.id,
                                    tenant1.loggedinUser.user.id,

                                    // These items have same ranking because they are both private and both
                                    // members. Ensure they are listed in reverse order of their id, which
                                    // is arbitrary ordering
                                    [tenant1.privateUser.user.id, privateWithPicture.user.id].sort().reverse()
                                  ]);

                                  // Ensure we get our expected order
                                  PrincipalsTestUtil.assertGetAllMembersLibrarySucceeds(
                                    tenant1.adminRestContext,
                                    tenant1.publicGroup.id,
                                    null,
                                    members => {
                                      assert.deepStrictEqual(
                                        _.chain(members)
                                          .pluck('profile')
                                          .pluck('id')
                                          .value(),
                                        expectedOrder1
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
});
