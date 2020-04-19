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
import _ from 'underscore';

import { ActivityConstants } from 'oae-activity/lib/constants';
import * as ActivityTestsUtil from 'oae-activity/lib/test/util';
import * as AuthzUtil from 'oae-authz/lib/util';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

import { FoldersConstants } from 'oae-folders/lib/constants';
import * as FoldersDAO from 'oae-folders/lib/internal/dao';
import * as FoldersTestUtil from 'oae-folders/lib/test/util';

const PUBLIC = 'public';

describe('Folders - Activity', () => {
  let camAdminRestContext = null;

  /*!
   * Set up an admin REST context before the tests
   */
  before(callback => {
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    return callback();
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

  describe('Create permutations', () => {
    /**
     * Test that verifies the folder-create activity when there are no extra members
     */
    it('verify no extra members', callback => {
      _setup((simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB) => {
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [],
          [],
          folder => {
            // The actor should receive an activity
            ActivityTestsUtil.assertFeedContainsActivity(
              simong.restContext,
              simong.user.id,
              FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
              ActivityConstants.verbs.CREATE,
              simong.user.id,
              folder.id,
              null,
              () => {
                // Users who follows the actor receive the activity
                ActivityTestsUtil.assertFeedContainsActivity(
                  nico.restContext,
                  nico.user.id,
                  FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                  ActivityConstants.verbs.CREATE,
                  simong.user.id,
                  folder.id,
                  null,
                  () => {
                    // Everyone else gets nothing
                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                      bert.restContext,
                      bert.user.id,
                      FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                      () => {
                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                          stuart.restContext,
                          stuart.user.id,
                          FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                          () => {
                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                              stephen.restContext,
                              stephen.user.id,
                              FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                              () => {
                                ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                  groupMemberA.restContext,
                                  groupMemberA.user.id,
                                  FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                                  () => {
                                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                      groupMemberB.restContext,
                                      groupMemberB.user.id,
                                      FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                                      () => {
                                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                          groupMemberA.restContext,
                                          groupA.group.id,
                                          FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                                          () => {
                                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                              groupMemberB.restContext,
                                              groupB.group.id,
                                              FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
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
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [bert],
          [],
          folder => {
            // The actor should receive an activity
            ActivityTestsUtil.assertFeedContainsActivity(
              simong.restContext,
              simong.user.id,
              FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
              ActivityConstants.verbs.CREATE,
              simong.user.id,
              folder.id,
              bert.user.id,
              () => {
                // Users who follows the actor receive the activity
                ActivityTestsUtil.assertFeedContainsActivity(
                  nico.restContext,
                  nico.user.id,
                  FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                  ActivityConstants.verbs.CREATE,
                  simong.user.id,
                  folder.id,
                  bert.user.id,
                  () => {
                    // The user who was made a member gets an activity
                    ActivityTestsUtil.assertFeedContainsActivity(
                      bert.restContext,
                      bert.user.id,
                      FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                      ActivityConstants.verbs.CREATE,
                      simong.user.id,
                      folder.id,
                      bert.user.id,
                      () => {
                        // Everyone else gets nothing
                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                          stuart.restContext,
                          stuart.user.id,
                          FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                          () => {
                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                              stephen.restContext,
                              stephen.user.id,
                              FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                              () => {
                                ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                  groupMemberA.restContext,
                                  groupMemberA.user.id,
                                  FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                                  () => {
                                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                      groupMemberB.restContext,
                                      groupMemberB.user.id,
                                      FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                                      () => {
                                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                          groupMemberA.restContext,
                                          groupA.group.id,
                                          FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                                          () => {
                                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                              groupMemberB.restContext,
                                              groupB.group.id,
                                              FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
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
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [groupA],
          [],
          folder => {
            // The actor should receive an activity
            ActivityTestsUtil.assertFeedContainsActivity(
              simong.restContext,
              simong.user.id,
              FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
              ActivityConstants.verbs.CREATE,
              simong.user.id,
              folder.id,
              groupA.group.id,
              () => {
                // Users who follow the actor receive the activity
                ActivityTestsUtil.assertFeedContainsActivity(
                  nico.restContext,
                  nico.user.id,
                  FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                  ActivityConstants.verbs.CREATE,
                  simong.user.id,
                  folder.id,
                  groupA.group.id,
                  () => {
                    // The group who was made a member gets an activity
                    ActivityTestsUtil.assertFeedContainsActivity(
                      groupMemberA.restContext,
                      groupA.group.id,
                      FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                      ActivityConstants.verbs.CREATE,
                      simong.user.id,
                      folder.id,
                      groupA.group.id,
                      () => {
                        // Members of the group get an activity
                        ActivityTestsUtil.assertFeedContainsActivity(
                          groupMemberA.restContext,
                          groupMemberA.user.id,
                          FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                          ActivityConstants.verbs.CREATE,
                          simong.user.id,
                          folder.id,
                          groupA.group.id,
                          () => {
                            // Everyone else gets nothing
                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                              stuart.restContext,
                              stuart.user.id,
                              FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                              () => {
                                ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                  stephen.restContext,
                                  stephen.user.id,
                                  FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                                  () => {
                                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                      groupMemberB.restContext,
                                      groupMemberB.user.id,
                                      FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                                      () => {
                                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                          groupMemberB.restContext,
                                          groupB.group.id,
                                          FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
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
        FoldersTestUtil.assertCreateFolderSucceeds(
          simong.restContext,
          'test displayName',
          'test description',
          'public',
          [bert, groupA],
          [],
          folder => {
            // The actor should receive an activity
            ActivityTestsUtil.assertFeedContainsActivity(
              simong.restContext,
              simong.user.id,
              FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
              ActivityConstants.verbs.CREATE,
              simong.user.id,
              folder.id,
              null,
              () => {
                // Users who follow the actor receive the activity
                ActivityTestsUtil.assertFeedContainsActivity(
                  nico.restContext,
                  nico.user.id,
                  FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                  ActivityConstants.verbs.CREATE,
                  simong.user.id,
                  folder.id,
                  null,
                  () => {
                    // The user who was made a member gets an activity
                    ActivityTestsUtil.assertFeedContainsActivity(
                      nico.restContext,
                      nico.user.id,
                      FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                      ActivityConstants.verbs.CREATE,
                      simong.user.id,
                      folder.id,
                      null,
                      () => {
                        // The group who was made a member gets an activity
                        ActivityTestsUtil.assertFeedContainsActivity(
                          groupMemberA.restContext,
                          groupA.group.id,
                          FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                          ActivityConstants.verbs.CREATE,
                          simong.user.id,
                          folder.id,
                          null,
                          () => {
                            // Members of the group get an activity
                            ActivityTestsUtil.assertFeedContainsActivity(
                              groupMemberA.restContext,
                              groupMemberA.user.id,
                              FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                              ActivityConstants.verbs.CREATE,
                              simong.user.id,
                              folder.id,
                              null,
                              () => {
                                // Everyone else gets nothing
                                ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                  stuart.restContext,
                                  stuart.user.id,
                                  FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                                  () => {
                                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                      stephen.restContext,
                                      stephen.user.id,
                                      FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                                      () => {
                                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                          groupMemberB.restContext,
                                          groupMemberB.user.id,
                                          FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
                                          () => {
                                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                              groupMemberB.restContext,
                                              groupB.group.id,
                                              FoldersConstants.activity.ACTIVITY_FOLDER_CREATE,
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

  /**
   * Test that verifies the update activity is generated and propagated to the correct users
   */
  it('verify the update activity', callback => {
    _setup((simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB) => {
      // Simon creates a folder that Bert co-manages and Stuart and groupA can view
      FoldersTestUtil.assertCreateFolderSucceeds(
        simong.restContext,
        'test displayName',
        'test description',
        'public',
        [bert],
        [stuart, groupA],
        folder => {
          // Simon updates the folder's name
          const updates = { displayName: 'blabla' };
          RestAPI.Folders.updateFolder(simong.restContext, folder.id, updates, (err, data) => {
            assert.ok(!err);

            // Simon, Nico, Bert, Stuart and groupA should've received a folder update activity
            ActivityTestsUtil.assertFeedContainsActivity(
              simong.restContext,
              simong.user.id,
              FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE,
              ActivityConstants.verbs.UPDATE,
              simong.user.id,
              folder.id,
              null,
              () => {
                ActivityTestsUtil.assertFeedContainsActivity(
                  bert.restContext,
                  bert.user.id,
                  FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE,
                  ActivityConstants.verbs.UPDATE,
                  simong.user.id,
                  folder.id,
                  null,
                  () => {
                    ActivityTestsUtil.assertFeedContainsActivity(
                      stuart.restContext,
                      stuart.user.id,
                      FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE,
                      ActivityConstants.verbs.UPDATE,
                      simong.user.id,
                      folder.id,
                      null,
                      () => {
                        ActivityTestsUtil.assertFeedContainsActivity(
                          groupMemberA.restContext,
                          groupA.group.id,
                          FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE,
                          ActivityConstants.verbs.UPDATE,
                          simong.user.id,
                          folder.id,
                          null,
                          () => {
                            // Assert the remaining users and/or groups did not get the activity
                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                              nico.restContext,
                              nico.user.id,
                              FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE,
                              () => {
                                ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                  stephen.restContext,
                                  stephen.user.id,
                                  FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE,
                                  () => {
                                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                      groupMemberB.restContext,
                                      groupB.group.id,
                                      FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE,
                                      () => {
                                        // Only managers should receive a notification
                                        ActivityTestsUtil.assertNotificationStreamContainsActivity(
                                          bert.restContext,
                                          FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE,
                                          ActivityConstants.verbs.UPDATE,
                                          simong.user.id,
                                          folder.id,
                                          null,
                                          () => {
                                            // Non members get nothing
                                            ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                              nico.restContext,
                                              FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE,
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
        }
      );
    });
  });

  /**
   * Test that verifies the update-visibility activity is generated and propagated to the correct users
   */
  it('verify the update visibility activity', callback => {
    _setup((simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB) => {
      // Simon creates a folder that Bert co-manages and Stuart and groupA can view
      FoldersTestUtil.assertCreateFolderSucceeds(
        simong.restContext,
        'test displayName',
        'test description',
        'public',
        [bert],
        [stuart, groupA],
        folder => {
          // Simon updates the folder's visibility
          const updates = { visibility: 'loggedin' };
          RestAPI.Folders.updateFolder(simong.restContext, folder.id, updates, (err, data) => {
            assert.ok(!err);

            // Simon, Nico, Bert, Stuart and groupA should've received a folder update activity
            ActivityTestsUtil.assertFeedContainsActivity(
              simong.restContext,
              simong.user.id,
              FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_VISIBILITY,
              ActivityConstants.verbs.UPDATE,
              simong.user.id,
              folder.id,
              null,
              () => {
                ActivityTestsUtil.assertFeedContainsActivity(
                  bert.restContext,
                  bert.user.id,
                  FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_VISIBILITY,
                  ActivityConstants.verbs.UPDATE,
                  simong.user.id,
                  folder.id,
                  null,
                  () => {
                    ActivityTestsUtil.assertFeedContainsActivity(
                      stuart.restContext,
                      stuart.user.id,
                      FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_VISIBILITY,
                      ActivityConstants.verbs.UPDATE,
                      simong.user.id,
                      folder.id,
                      null,
                      () => {
                        ActivityTestsUtil.assertFeedContainsActivity(
                          groupMemberA.restContext,
                          groupA.group.id,
                          FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_VISIBILITY,
                          ActivityConstants.verbs.UPDATE,
                          simong.user.id,
                          folder.id,
                          null,
                          () => {
                            // Assert the remaining users and/or groups did not get the activity
                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                              nico.restContext,
                              nico.user.id,
                              FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_VISIBILITY,
                              () => {
                                ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                  stephen.restContext,
                                  stephen.user.id,
                                  FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_VISIBILITY,
                                  () => {
                                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                      groupMemberB.restContext,
                                      groupB.group.id,
                                      FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_VISIBILITY,
                                      () => {
                                        // Only managers should receive a notification
                                        ActivityTestsUtil.assertNotificationStreamContainsActivity(
                                          bert.restContext,
                                          FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_VISIBILITY,
                                          ActivityConstants.verbs.UPDATE,
                                          simong.user.id,
                                          folder.id,
                                          null,
                                          () => {
                                            // Non members get nothing
                                            ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                              nico.restContext,
                                              FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_VISIBILITY,
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
        }
      );
    });
  });

  /**
   * Test that verifies the share and add-to-library activities are generated and propagated to the correct users
   */
  it('verify the share and add-to-library activity', callback => {
    _setup((simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB) => {
      // Stephen creates a folder
      FoldersTestUtil.assertCreateFolderSucceeds(
        stephen.restContext,
        'test displayName',
        'test description',
        'public',
        [],
        [],
        folder => {
          // Simon shares it with himself and Bert
          FoldersTestUtil.assertShareFolderSucceeds(
            stephen.restContext,
            simong.restContext,
            folder.id,
            [simong.user.id, bert.user.id, groupA.group.id],
            () => {
              // Simon should have an `add-to-library` activity
              ActivityTestsUtil.assertFeedContainsActivity(
                simong.restContext,
                simong.user.id,
                FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_LIBRARY,
                ActivityConstants.verbs.ADD,
                simong.user.id,
                folder.id,
                null,
                () => {
                  // Folder managers get an aggregated share
                  ActivityTestsUtil.assertFeedContainsActivity(
                    stephen.restContext,
                    stephen.user.id,
                    FoldersConstants.activity.ACTIVITY_FOLDER_SHARE,
                    ActivityConstants.verbs.SHARE,
                    simong.user.id,
                    folder.id,
                    [bert.user.id, groupA.group.id],
                    () => {
                      // Bert should have a share activity
                      ActivityTestsUtil.assertFeedContainsActivity(
                        bert.restContext,
                        bert.user.id,
                        FoldersConstants.activity.ACTIVITY_FOLDER_SHARE,
                        ActivityConstants.verbs.SHARE,
                        simong.user.id,
                        folder.id,
                        bert.user.id,
                        () => {
                          // Nico should have a share activity as he follows Simon
                          ActivityTestsUtil.assertFeedContainsActivity(
                            nico.restContext,
                            nico.user.id,
                            FoldersConstants.activity.ACTIVITY_FOLDER_SHARE,
                            ActivityConstants.verbs.SHARE,
                            simong.user.id,
                            folder.id,
                            [bert.user.id, groupA.group.id],
                            () => {
                              // Only the users with who the folder was shared with get a notification
                              ActivityTestsUtil.assertNotificationStreamContainsActivity(
                                bert.restContext,
                                FoldersConstants.activity.ACTIVITY_FOLDER_SHARE,
                                ActivityConstants.verbs.SHARE,
                                simong.user.id,
                                folder.id,
                                bert.user.id,
                                () => {
                                  // Noone else should have a notification
                                  ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                    simong.restContext,
                                    FoldersConstants.activity.ACTIVITY_FOLDER_SHARE,
                                    () => {
                                      ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                        stuart.restContext,
                                        FoldersConstants.activity.ACTIVITY_FOLDER_SHARE,
                                        () => {
                                          ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                            stephen.restContext,
                                            FoldersConstants.activity.ACTIVITY_FOLDER_SHARE,
                                            () => {
                                              // Assert nobody got a role update activity
                                              ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                                simong.restContext,
                                                simong.user.id,
                                                FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
                                                () => {
                                                  ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                                    bert.restContext,
                                                    bert.user.id,
                                                    FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
                                                    () => {
                                                      ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                                        groupMemberA.restContext,
                                                        groupA.group.id,
                                                        FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
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
  });

  /**
   * Test that verifies the update-member-role activities are generated and propagated to the correct users
   */
  it('verify the update-member-role activity', callback => {
    _setup((simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB) => {
      // Simon creates a folder, makes Nico a manager and Bert a member
      FoldersTestUtil.assertCreateFolderSucceeds(
        simong.restContext,
        'test displayName',
        'test description',
        'public',
        [nico],
        [bert, groupA],
        folder => {
          // Simon makes Bert and groupA managers
          const updates = {};
          updates[bert.user.id] = _.extend({}, bert, { role: 'manager' });
          updates[groupA.group.id] = _.extend({}, groupA, { role: 'manager' });
          FoldersTestUtil.assertUpdateFolderMembersSucceeds(
            simong.restContext,
            simong.restContext,
            folder.id,
            updates,
            () => {
              // Simon should have an update-member-role activity
              ActivityTestsUtil.assertFeedContainsActivity(
                simong.restContext,
                simong.user.id,
                FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
                ActivityConstants.verbs.UPDATE,
                simong.user.id,
                [bert.user.id, groupA.group.id],
                folder.id,
                () => {
                  // Bert should have an update-member-role activity
                  ActivityTestsUtil.assertFeedContainsActivity(
                    bert.restContext,
                    bert.user.id,
                    FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
                    ActivityConstants.verbs.UPDATE,
                    simong.user.id,
                    [bert.user.id, groupA.group.id],
                    folder.id,
                    () => {
                      // Managers get an update-member-role activity
                      ActivityTestsUtil.assertFeedContainsActivity(
                        nico.restContext,
                        nico.user.id,
                        FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
                        ActivityConstants.verbs.UPDATE,
                        simong.user.id,
                        [bert.user.id, groupA.group.id],
                        folder.id,
                        () => {
                          // GroupA should have an update-member-role activitiy
                          ActivityTestsUtil.assertFeedContainsActivity(
                            groupMemberA.restContext,
                            groupA.group.id,
                            FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
                            ActivityConstants.verbs.UPDATE,
                            simong.user.id,
                            [bert.user.id, groupA.group.id],
                            folder.id,
                            () => {
                              // Noone gets a notification for this activity
                              ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                simong.restContext,
                                FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
                                () => {
                                  ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                    nico.restContext,
                                    FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
                                    () => {
                                      ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                        bert.restContext,
                                        FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
                                        () => {
                                          ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                            stuart.restContext,
                                            FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
                                            () => {
                                              ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                                stephen.restContext,
                                                FoldersConstants.activity.ACTIVITY_FOLDER_UPDATE_MEMBER_ROLE,
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
   * Test that verifies the folder-comment activities are generated and propagated to the correct users
   */
  it('verify the folder-comment activity', callback => {
    _setup((simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB) => {
      // Simon creates a folder
      FoldersTestUtil.assertCreateFolderSucceeds(
        simong.restContext,
        'test displayName',
        'test description',
        'public',
        [],
        [],
        folder => {
          // Stuart comments on the folder
          FoldersTestUtil.assertCreateMessageSucceeds(stuart.restContext, folder.id, 'Message body', null, message => {
            assert.ok(message);

            // Stuart should have a folder-comment activity
            ActivityTestsUtil.assertFeedContainsActivity(
              stuart.restContext,
              stuart.user.id,
              FoldersConstants.activity.ACTIVITY_FOLDER_COMMENT,
              ActivityConstants.verbs.POST,
              stuart.user.id,
              message.id,
              folder.id,
              () => {
                // Simon should see the activity
                ActivityTestsUtil.assertFeedContainsActivity(
                  simong.restContext,
                  simong.user.id,
                  FoldersConstants.activity.ACTIVITY_FOLDER_COMMENT,
                  ActivityConstants.verbs.POST,
                  stuart.user.id,
                  message.id,
                  folder.id,
                  () => {
                    // Unrelated users don't see it
                    ActivityTestsUtil.assertFeedDoesNotContainActivity(
                      bert.restContext,
                      bert.user.id,
                      FoldersConstants.activity.ACTIVITY_FOLDER_COMMENT,
                      () => {
                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                          stephen.restContext,
                          stephen.user.id,
                          FoldersConstants.activity.ACTIVITY_FOLDER_COMMENT,
                          () => {
                            // When Simon makes a comment, stuart should see it as he's considered to be a recent contributor
                            FoldersTestUtil.assertCreateMessageSucceeds(
                              simong.restContext,
                              folder.id,
                              'Message body',
                              null,
                              message2 => {
                                ActivityTestsUtil.assertFeedContainsActivity(
                                  stuart.restContext,
                                  stuart.user.id,
                                  FoldersConstants.activity.ACTIVITY_FOLDER_COMMENT,
                                  ActivityConstants.verbs.POST,
                                  [stuart.user.id, simong.user.id],
                                  [message.id, message2.id],
                                  folder.id,
                                  () => {
                                    // Simon should see the activity
                                    ActivityTestsUtil.assertFeedContainsActivity(
                                      simong.restContext,
                                      simong.user.id,
                                      FoldersConstants.activity.ACTIVITY_FOLDER_COMMENT,
                                      ActivityConstants.verbs.POST,
                                      [stuart.user.id, simong.user.id],
                                      [message.id, message2.id],
                                      folder.id,
                                      () => {
                                        // Unrelated users don't see it
                                        ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                          bert.restContext,
                                          bert.user.id,
                                          FoldersConstants.activity.ACTIVITY_FOLDER_COMMENT,
                                          () => {
                                            ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                              stephen.restContext,
                                              stephen.user.id,
                                              FoldersConstants.activity.ACTIVITY_FOLDER_COMMENT,
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
        }
      );
    });
  });

  /**
   * Test that verifies the properties of a folder comment
   */
  it('verify the folder-comment message entity model contains the correct information', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simong, nico) => {
      FoldersTestUtil.assertCreateFolderSucceeds(
        simong.restContext,
        'test displayName',
        'test description',
        'public',
        [],
        [],
        folder => {
          FoldersTestUtil.assertCreateMessageSucceeds(simong.restContext, folder.id, 'Message body', null, message => {
            assert.ok(message);

            ActivityTestsUtil.collectAndGetActivityStream(
              simong.restContext,
              simong.user.id,
              null,
              (err, activityStream) => {
                assert.ok(!err);
                const entity = activityStream.items[0];

                // Assert the correct entities are all present
                ActivityTestsUtil.assertActivity(
                  entity,
                  'folder-comment',
                  'post',
                  simong.user.id,
                  message.id,
                  folder.id
                );

                // Assert the folder information is available on the target
                assert.strictEqual(entity.target.displayName, folder.displayName);
                assert.strictEqual(entity.target['oae:profilePath'], folder.profilePath);

                // Assert the comment information is available on the object
                assert.strictEqual(entity.object['oae:messageBoxId'], message.messageBoxId);
                assert.strictEqual(entity.object['oae:threadKey'], message.threadKey);
                assert.strictEqual(entity.object.content, message.body);
                assert.strictEqual(entity.object.published, message.created);
                assert.strictEqual(entity.object.objectType, 'folder-comment');
                assert.strictEqual(
                  entity.object.id,
                  'http://' +
                    global.oaeTests.tenants.cam.host +
                    '/api/folder/' +
                    folder.id +
                    '/messages/' +
                    message.created
                );

                // Nico replies
                FoldersTestUtil.assertCreateMessageSucceeds(
                  nico.restContext,
                  folder.id,
                  'A reply',
                  message.created,
                  nicosMessage => {
                    assert.ok(nicosMessage);

                    ActivityTestsUtil.collectAndGetActivityStream(
                      simong.restContext,
                      simong.user.id,
                      null,
                      (err, activityStream) => {
                        assert.ok(!err);
                        const entity = activityStream.items[0];

                        // Assert the correct entities are all present. The first item should be
                        // an aggregated `folder-comment` activity. The object and actor will now
                        // be collections rather than a single message/person
                        ActivityTestsUtil.assertActivity(
                          entity,
                          'folder-comment',
                          'post',
                          [simong.user.id, nico.user.id],
                          [message.id, nicosMessage.id],
                          folder.id
                        );

                        // The object should be an oae:collection containing 2 messages (the original message and the reply)
                        assert.strictEqual(entity.object.objectType, 'collection');
                        assert.ok(entity.object['oae:collection']);
                        assert.strictEqual(entity.object['oae:collection'].length, 2);
                        const originalMessage = _.find(entity.object['oae:collection'], activityMessage => {
                          return activityMessage['oae:id'] === message.id;
                        });
                        assert.ok(originalMessage);
                        assert.strictEqual(originalMessage['oae:id'], message.id);
                        assert.strictEqual(originalMessage.content, message.body);
                        assert.strictEqual(originalMessage.author['oae:id'], simong.user.id);
                        assert.strictEqual(originalMessage['oae:tenant'].alias, global.oaeTests.tenants.cam.alias);

                        // Assert the reply contains all the correct information
                        const reply = _.find(entity.object['oae:collection'], activityMessage => {
                          return activityMessage['oae:id'] === nicosMessage.id;
                        });
                        assert.ok(reply);
                        assert.strictEqual(reply['oae:id'], nicosMessage.id);
                        assert.strictEqual(reply['oae:messageBoxId'], nicosMessage.messageBoxId);
                        assert.strictEqual(reply['oae:threadKey'], nicosMessage.threadKey);
                        assert.strictEqual(reply['oae:tenant'].alias, global.oaeTests.tenants.cam.alias);
                        assert.strictEqual(reply.content, nicosMessage.body);
                        assert.strictEqual(reply.published, nicosMessage.created);
                        assert.strictEqual(reply.author['oae:id'], nico.user.id);
                        assert.ok(reply.inReplyTo);
                        assert.strictEqual(reply.inReplyTo['oae:id'], message.id);

                        // Verify both actors are present
                        assert.strictEqual(entity.actor.objectType, 'collection');
                        const simonEntity = _.find(entity.actor['oae:collection'], userEntity => {
                          return userEntity['oae:id'] === simong.user.id;
                        });
                        assert.ok(simonEntity);
                        assert.strictEqual(simonEntity['oae:id'], simong.user.id);
                        assert.strictEqual(
                          simonEntity['oae:profilePath'],
                          '/user/' +
                            simong.user.tenant.alias +
                            '/' +
                            AuthzUtil.getResourceFromId(simong.user.id).resourceId
                        );

                        const nicoEntity = _.find(entity.actor['oae:collection'], userEntity => {
                          return userEntity['oae:id'] === nico.user.id;
                        });
                        assert.ok(nicoEntity);
                        assert.strictEqual(nicoEntity['oae:id'], nico.user.id);
                        assert.strictEqual(
                          nicoEntity['oae:profilePath'],
                          '/user/' + nico.user.tenant.alias + '/' + AuthzUtil.getResourceFromId(nico.user.id).resourceId
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
    });
  });

  /**
   * Test that verifies the add-to-folder activities are generated and propagated to the correct users
   */
  it('verify the add-to-folder activity', callback => {
    _setup((simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB) => {
      // Simon creates a folder and makes Bert a member
      FoldersTestUtil.assertCreateFolderSucceeds(
        simong.restContext,
        'test displayName',
        'test description',
        'public',
        [],
        [bert],
        folder => {
          // Stephen creates 2 files
          RestAPI.Content.createLink(
            stephen.restContext,
            {
              displayName: 'test',
              description: 'test',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: null,
              viewers: null,
              folders: []
            },
            (err, link1) => {
              assert.ok(!err);
              RestAPI.Content.createLink(
                stephen.restContext,
                {
                  displayName: 'test',
                  description: 'test',
                  visibility: PUBLIC,
                  link: 'http://www.google.ca',
                  managers: null,
                  viewers: null,
                  folders: []
                },
                (err, link2) => {
                  assert.ok(!err);

                  // Simon adds the two items to the folder
                  FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                    simong.restContext,
                    folder.id,
                    [link1.id, link2.id],
                    () => {
                      // Simon should have an add-to-folder activity
                      ActivityTestsUtil.assertFeedContainsActivity(
                        simong.restContext,
                        simong.user.id,
                        FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER,
                        ActivityConstants.verbs.ADD,
                        simong.user.id,
                        [link1.id, link2.id],
                        folder.id,
                        () => {
                          // Nico follows Simon and should see the activity
                          ActivityTestsUtil.assertFeedContainsActivity(
                            nico.restContext,
                            nico.user.id,
                            FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER,
                            ActivityConstants.verbs.ADD,
                            simong.user.id,
                            [link1.id, link2.id],
                            folder.id,
                            () => {
                              // Members of the folder should see the activity
                              ActivityTestsUtil.assertFeedContainsActivity(
                                bert.restContext,
                                bert.user.id,
                                FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER,
                                ActivityConstants.verbs.ADD,
                                simong.user.id,
                                [link1.id, link2.id],
                                folder.id,
                                () => {
                                  // Managers of the content should see the activity
                                  ActivityTestsUtil.assertFeedContainsActivity(
                                    stephen.restContext,
                                    stephen.user.id,
                                    FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER,
                                    ActivityConstants.verbs.ADD,
                                    simong.user.id,
                                    [link1.id, link2.id],
                                    folder.id,
                                    () => {
                                      // Unrelated users don't see it
                                      ActivityTestsUtil.assertFeedDoesNotContainActivity(
                                        stuart.restContext,
                                        stuart.user.id,
                                        FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER,
                                        () => {
                                          // Members of the folder should've received a notification
                                          ActivityTestsUtil.assertNotificationStreamContainsActivity(
                                            bert.restContext,
                                            FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER,
                                            ActivityConstants.verbs.ADD,
                                            simong.user.id,
                                            [link1.id, link2.id],
                                            folder.id,
                                            () => {
                                              // Others shouldn't receive a notification
                                              ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                                nico.restContext,
                                                FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER,
                                                () => {
                                                  ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                                    stephen.restContext,
                                                    FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER,
                                                    () => {
                                                      ActivityTestsUtil.assertNotificationStreamDoesNotContainActivity(
                                                        stuart.restContext,
                                                        FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER,
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
  });

  /**
   * Test that verifies that the add-to-folder activities aggregate on the folder
   */
  it('verify the add-to-folder aggregation rules', callback => {
    _setup((simong, nico, bert, stuart, stephen, groupMemberA, groupMemberB, groupA, groupB) => {
      // Simon creates 2 folders
      FoldersTestUtil.assertCreateFolderSucceeds(
        simong.restContext,
        'test displayName',
        'test description',
        'public',
        [],
        [],
        folderA => {
          FoldersTestUtil.assertCreateFolderSucceeds(
            simong.restContext,
            'test displayName',
            'test description',
            'public',
            [],
            [],
            folderB => {
              // Stephen creates 2 files
              RestAPI.Content.createLink(
                stephen.restContext,
                {
                  displayName: 'test',
                  description: 'test',
                  visibility: PUBLIC,
                  link: 'http://www.google.ca',
                  managers: null,
                  viewers: null,
                  folders: []
                },
                (err, link1) => {
                  assert.ok(!err);
                  RestAPI.Content.createLink(
                    stephen.restContext,
                    {
                      displayName: 'test',
                      description: 'test',
                      visibility: PUBLIC,
                      link: 'http://www.google.ca',
                      managers: null,
                      viewers: null,
                      folders: []
                    },
                    (err, link2) => {
                      assert.ok(!err);

                      // Simon adds both files to both of his folders. This should
                      // result in 2 separate activities
                      FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                        simong.restContext,
                        folderA.id,
                        [link1.id, link2.id],
                        () => {
                          FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                            simong.restContext,
                            folderB.id,
                            [link1.id, link2.id],
                            () => {
                              ActivityTestsUtil.collectAndGetActivityStream(
                                simong.restContext,
                                simong.user.id,
                                null,
                                (err, data) => {
                                  assert.ok(!err);

                                  // Get the add-to-folder activities
                                  const addToFolderActivities = _.filter(data.items, activity => {
                                    return (
                                      activity['oae:activityType'] ===
                                      FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_FOLDER
                                    );
                                  });

                                  // We should have 2 activities as we added content to 2 folders
                                  assert.strictEqual(addToFolderActivities.length, 2);

                                  // Sanity-check we have an activity for each folder
                                  assert.strictEqual(addToFolderActivities[0].target['oae:id'], folderB.id);
                                  assert.strictEqual(addToFolderActivities[1].target['oae:id'], folderA.id);
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
   * Test that verifies that previews are added to the folder entities when they are available
   */
  it('verify previews are added when available', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, simong) => {
      assert.ok(!err);

      // Simon creates a folder and makes Bert a member
      FoldersTestUtil.assertCreateFolderSucceeds(
        simong.restContext,
        'test displayName',
        'test description',
        'public',
        [],
        [],
        folder => {
          // Fake some previews for the folder
          const previews = {
            thumbnailUri: 'local:f/camtest/ab/cd/ef/gh/thumbnail.jpg',
            wideUri: 'local:f/camtest/ab/cd/ef/gh/wide.jpg'
          };
          FoldersDAO.setPreviews(folder, previews, (err, folder) => {
            assert.ok(!err);

            // Get the activities
            ActivityTestsUtil.collectAndGetActivityStream(simong.restContext, simong.user.id, null, (err, response) => {
              assert.ok(!err);

              // Assert the activity is present
              const createdFolderActivity = _.findWhere(response.items, {
                'oae:activityType': FoldersConstants.activity.ACTIVITY_FOLDER_CREATE
              });
              assert.ok(createdFolderActivity);

              // Assert the folder has a thumbnail and wide image
              assert.ok(createdFolderActivity.object);
              assert.ok(createdFolderActivity.object.image);
              assert.ok(createdFolderActivity.object.image.url);
              assert.ok(createdFolderActivity.object['oae:wideImage']);
              assert.ok(createdFolderActivity.object['oae:wideImage'].url);

              return callback();
            });
          });
        }
      );
    });
  });

  /**
   * Test that verifies that adding content to a folder upon creation does not result in an add-to-folder activity
   */
  it('verify adding content to a folder upon content creation does not result in an add-to-folder activity', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, simong) => {
      assert.ok(!err);

      FoldersTestUtil.assertCreateFolderSucceeds(
        simong.restContext,
        'test displayName',
        'test description',
        'public',
        [],
        [],
        folder => {
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'test',
              description: 'test',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: null,
              viewers: null,
              folders: [folder.id]
            },
            (err, link1) => {
              assert.ok(!err);

              ActivityTestsUtil.collectAndGetActivityStream(
                simong.restContext,
                simong.user.id,
                null,
                (err, response) => {
                  assert.ok(!err);

                  // Assert the add-to-folder activity is not present
                  const addToLibraryActivity = _.findWhere(response.items, {
                    'oae:activityType': FoldersConstants.activity.ACTIVITY_FOLDER_ADD_TO_LIBRARY
                  });
                  assert.ok(!addToLibraryActivity);

                  // Assert the content-create activity is present
                  const contentCreateActivity = _.findWhere(response.items, {
                    'oae:activityType': 'content-create'
                  });
                  assert.ok(contentCreateActivity);

                  // Assert the content-create activity contains the folder as a target
                  assert.strictEqual(contentCreateActivity.target['oae:id'], folder.id);
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
   * Test that verifies that content-create activities their targets can contain folders and the activities
   * are routed to the correct activity stream
   */
  it('verify content-create activities are routed to the correct activity streams and contain the correct target information', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 4, (err, users, simong, nico, bert, stuart) => {
      assert.ok(!err);

      TestsUtil.generateTestGroups(nico.restContext, 2, (nicosGroup1, nicosGroup2) => {
        TestsUtil.generateTestGroups(bert.restContext, 1, bertsGroup => {
          FoldersTestUtil.assertCreateFolderSucceeds(
            simong.restContext,
            'test displayName',
            'test description',
            'public',
            [nicosGroup1, bertsGroup, stuart],
            [],
            folder1 => {
              FoldersTestUtil.assertCreateFolderSucceeds(
                simong.restContext,
                'test displayName',
                'test description',
                'public',
                [nicosGroup2],
                [],
                folder2 => {
                  RestAPI.Content.createLink(
                    simong.restContext,
                    {
                      displayName: 'test',
                      description: 'test',
                      visibility: PUBLIC,
                      link: 'http://www.google.ca',
                      managers: null,
                      viewers: null,
                      folders: [folder1.id, folder2.id]
                    },
                    (err, link) => {
                      assert.ok(!err);

                      // Simon sees both folders
                      ActivityTestsUtil.assertFeedContainsActivity(
                        simong.restContext,
                        simong.user.id,
                        'content-create',
                        ActivityConstants.verbs.CREATE,
                        simong.user.id,
                        link.id,
                        null,
                        () => {
                          // Nico sees both folders in his personal stream and each one
                          // distinctly in his two groups
                          ActivityTestsUtil.assertFeedContainsActivity(
                            nico.restContext,
                            nico.user.id,
                            'content-create',
                            ActivityConstants.verbs.CREATE,
                            simong.user.id,
                            link.id,
                            null,
                            () => {
                              ActivityTestsUtil.assertFeedContainsActivity(
                                nico.restContext,
                                nicosGroup1.group.id,
                                'content-create',
                                ActivityConstants.verbs.CREATE,
                                simong.user.id,
                                link.id,
                                null,
                                () => {
                                  ActivityTestsUtil.assertFeedContainsActivity(
                                    nico.restContext,
                                    nicosGroup2.group.id,
                                    'content-create',
                                    ActivityConstants.verbs.CREATE,
                                    simong.user.id,
                                    link.id,
                                    null,
                                    () => {
                                      // Bert only sees folder1 in his personal stream and in his group's stream
                                      ActivityTestsUtil.assertFeedContainsActivity(
                                        bert.restContext,
                                        bert.user.id,
                                        'content-create',
                                        ActivityConstants.verbs.CREATE,
                                        simong.user.id,
                                        link.id,
                                        null,
                                        () => {
                                          ActivityTestsUtil.assertFeedContainsActivity(
                                            bert.restContext,
                                            bertsGroup.group.id,
                                            'content-create',
                                            ActivityConstants.verbs.CREATE,
                                            simong.user.id,
                                            link.id,
                                            null,
                                            () => {
                                              // Stuart only sees the first folder
                                              ActivityTestsUtil.assertFeedContainsActivity(
                                                stuart.restContext,
                                                stuart.user.id,
                                                'content-create',
                                                ActivityConstants.verbs.CREATE,
                                                simong.user.id,
                                                link.id,
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
        });
      });
    });
  });
});
