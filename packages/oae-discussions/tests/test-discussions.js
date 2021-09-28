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

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { compose, not, values, filter, equals, pluck, contains, forEach, pathSatisfies } from 'ramda';

import * as ConfigTestsUtil from 'oae-config/lib/test/util.js';
import * as LibraryAPI from 'oae-library';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as DiscussionsDAO from 'oae-discussions/lib/internal/dao.js';
import * as DiscussionsTestsUtil from 'oae-discussions/lib/test/util.js';

describe('Discussions', () => {
  let asCambridgeAnonymousUser = null;
  let asCambridgeTenantAdmin = null;

  beforeEach(() => {
    asCambridgeAnonymousUser = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
  });

  describe('Iterating all Discussions', () => {
    /**
     * Test that verifies created discussions appear in DiscussionsDAO.iterateAll
     */
    it('verify newly created discussion is returned in iterateAll', (callback) => {
      // Create a user to test with
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const visibility = 'public';

        // Stores how many discussions were in the database before we created a new one
        let numberDiscussionsOrig = 0;

        // Count how many discussions we currently have in the database
        DiscussionsDAO.iterateAll(
          null,
          1000,
          (discussionRows, done) => {
            if (discussionRows) {
              numberDiscussionsOrig += discussionRows.length;
            }

            return done();
          },
          (error_) => {
            assert.notExists(error_);

            // Create one new one, and ensure the new number of discussions is numDiscussionsOrig + 1
            RestAPI.Discussions.createDiscussion(
              user.restContext,
              displayName,
              description,
              visibility,
              null,
              null,
              (error_, discussion) => {
                assert.notExists(error_);

                let numberDiscussionsAfter = 0;
                let hasNewDiscussion = false;

                // Count the discussions we have now, and ensure we iterate over the new discussion
                DiscussionsDAO.iterateAll(
                  null,
                  1000,
                  (discussionRows, done) => {
                    if (discussionRows) {
                      numberDiscussionsAfter += discussionRows.length;
                      forEach((discussionRow) => {
                        if (discussionRow.id === discussion.id) {
                          hasNewDiscussion = true;
                        }
                      }, discussionRows);
                    }

                    return done();
                  },
                  (error__) => {
                    assert.notExists(error__);
                    assert.strictEqual(numberDiscussionsOrig + 1, numberDiscussionsAfter);
                    assert.ok(hasNewDiscussion);
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

  describe('Creating Discussions', () => {
    /**
     * Test that verifies miscellaneous validation input when creating a discussion
     */
    it('verify create discussion validation', (callback) => {
      // Create a user to test with
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const visibility = 'public';

        // Verify cannot create discussion anonymously
        RestAPI.Discussions.createDiscussion(
          asCambridgeAnonymousUser,
          displayName,
          description,
          visibility,
          null,
          null,
          (error /* , discussion */) => {
            assert.ok(error);
            assert.strictEqual(error.code, 401);

            // Verify cannot create discussion with null displayName
            RestAPI.Discussions.createDiscussion(
              user.restContext,
              null,
              description,
              visibility,
              null,
              null,
              (error /* , discussion */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 400);

                // Verify with a displayName that is longer than the maximum allowed size
                const longDisplayName = TestsUtil.generateRandomText(100);
                RestAPI.Discussions.createDiscussion(
                  user.restContext,
                  longDisplayName,
                  description,
                  visibility,
                  null,
                  null,
                  (error /* , discussion */) => {
                    assert.ok(error);
                    assert.strictEqual(error.code, 400);
                    assert.ok(error.msg.indexOf('1000') > 0);

                    // Verify with a description that is longer than the maximum allowed size
                    const longDescription = TestsUtil.generateRandomText(1000);
                    RestAPI.Discussions.createDiscussion(
                      user.restContext,
                      displayName,
                      longDescription,
                      visibility,
                      null,
                      null,
                      (error /* , discussion */) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 400);
                        assert.ok(error.msg.indexOf('10000') > 0);

                        // Verify cannot create discussion with an empty description
                        RestAPI.Discussions.createDiscussion(
                          user.restContext,
                          displayName,
                          '',
                          visibility,
                          null,
                          null,
                          (error /* , discussion */) => {
                            assert.ok(error);
                            assert.strictEqual(error.code, 400);

                            // Verify cannot create discussion with invalid visibility
                            RestAPI.Discussions.createDiscussion(
                              user.restContext,
                              displayName,
                              description,
                              'not-a-visibility',
                              null,
                              null,
                              (error /* , discussion */) => {
                                assert.ok(error);
                                assert.strictEqual(error.code, 400);

                                // Verify cannot create discussion with an invalid manager id
                                RestAPI.Discussions.createDiscussion(
                                  user.restContext,
                                  displayName,
                                  description,
                                  visibility,
                                  ['not-an-id'],
                                  null,
                                  (error /* , discussion */) => {
                                    assert.ok(error);
                                    assert.strictEqual(error.code, 400);

                                    // Verify cannot create discussion with multiple invalid manager ids
                                    RestAPI.Discussions.createDiscussion(
                                      user.restContext,
                                      displayName,
                                      description,
                                      visibility,
                                      ['not-an-id', 'another-one'],
                                      null,
                                      (error /* , discussion */) => {
                                        assert.ok(error);
                                        assert.strictEqual(error.code, 400);

                                        // Verify cannot create discussion with an invalid member id
                                        RestAPI.Discussions.createDiscussion(
                                          user.restContext,
                                          displayName,
                                          description,
                                          visibility,
                                          null,
                                          ['not-an-id'],
                                          (error /* , discussion */) => {
                                            assert.ok(error);
                                            assert.strictEqual(error.code, 400);

                                            // Verify cannot create discussion with multiple invalid member ids
                                            RestAPI.Discussions.createDiscussion(
                                              user.restContext,
                                              displayName,
                                              description,
                                              visibility,
                                              null,
                                              ['not-an-id', 'another-one'],
                                              (error /* , discussion */) => {
                                                assert.ok(error);
                                                assert.strictEqual(error.code, 400);

                                                // Verify that a valid discussion can be created
                                                RestAPI.Discussions.createDiscussion(
                                                  user.restContext,
                                                  displayName,
                                                  description,
                                                  visibility,
                                                  null,
                                                  null,
                                                  (error, discussion) => {
                                                    assert.notExists(error);
                                                    assert.ok(discussion);
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
      });
    });

    /**
     * Test that verifies a discussion is successfully created, with the proper discussion model and members model
     */
    it('verify successful discussion creation and model', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities((publicTenant) => {
        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const visibility = 'public';
        const managers = [publicTenant.publicUser.user.id];
        const members = [publicTenant.loggedinUser.user.id];

        // Create the discussion whose model to verify
        RestAPI.Discussions.createDiscussion(
          publicTenant.privateUser.restContext,
          displayName,
          description,
          visibility,
          managers,
          members,
          (error, discussion) => {
            assert.notExists(error);
            assert.ok(discussion.id);
            assert.ok(discussion.createdBy, publicTenant.privateUser.user.id);
            assert.strictEqual(discussion.displayName, displayName);
            assert.strictEqual(discussion.description, description);
            assert.strictEqual(discussion.visibility, visibility);
            assert.ok(discussion.created);
            assert.ok(discussion.lastModified);
            assert.ok(discussion.tenant);
            assert.strictEqual(discussion.tenant.alias, publicTenant.tenant.alias);
            assert.strictEqual(discussion.tenant.displayName, publicTenant.tenant.displayName);
            return callback();
          }
        );
      });
    });

    /**
     * Test that verifies that you cannot create a discussion when trying to add a private user as a member
     */
    it('verify create discussion with a private user as another member', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: nico, 1: bert } = users;

        RestAPI.User.updateUser(bert.restContext, bert.user.id, { visibility: 'private' }, (error_) => {
          assert.notExists(error_);

          RestAPI.Discussions.createDiscussion(
            nico.restContext,
            'Test discussion',
            'Test discussion description',
            'public',
            [bert.user.id],
            [],
            (error /* , discussion */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);
              callback();
            }
          );
        });
      });
    });

    /**
     * Test that verifies that you cannot create a discussion when trying to add a private group as a member
     */
    it('verify create discussion with a private group as another member', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: nico, 1: bert } = users;

        RestAPI.Group.createGroup(
          bert.restContext,
          'Group title',
          'Group description',
          'private',
          undefined,
          [],
          [],
          (error, groupObject) => {
            assert.notExists(error);

            RestAPI.Discussions.createDiscussion(
              nico.restContext,
              'Test discussion',
              'Test discussion description',
              'public',
              [groupObject.id],
              [],
              (error /* , discussion */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 401);
                callback();
              }
            );
          }
        );
      });
    });
  });

  describe('Updating Discussions', () => {
    /**
     * Test that verifies miscellaneous validation of update discussion inputs
     */
    it('verify update discussion validation', (callback) => {
      const displayName = 'test-update-displayName';
      const description = 'test-update-description';
      const visibility = 'public';

      const updates = {
        displayName: 'new-display-name',
        description: 'new-description'
      };

      // Create a user to test with
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: user } = users;

        // Create a discussion that we'll try and update
        RestAPI.Discussions.createDiscussion(
          user.restContext,
          displayName,
          description,
          visibility,
          null,
          null,
          (error, createdDiscussion) => {
            assert.notExists(error);

            // Verify not a valid discussion id
            RestAPI.Discussions.updateDiscussion(user.restContext, 'not-a-valid-id', updates, (error, discussion) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);
              assert.ok(!discussion);

              // Verify no fields to update
              RestAPI.Discussions.updateDiscussion(user.restContext, createdDiscussion.id, {}, (error, discussion) => {
                assert.ok(error);
                assert.strictEqual(error.code, 400);
                assert.ok(!discussion);

                // Verify invalid visibility value
                RestAPI.Discussions.updateDiscussion(
                  user.restContext,
                  createdDiscussion.id,
                  { visibility: 'not-a-visibility' },
                  (error, discussion) => {
                    assert.ok(error);
                    assert.strictEqual(error.code, 400);
                    assert.ok(!discussion);

                    // Verify an invalid field name
                    RestAPI.Discussions.updateDiscussion(
                      user.restContext,
                      createdDiscussion.id,
                      { 'not-a-valid-field': 'loggedin' },
                      (error, discussion) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 400);
                        assert.ok(!discussion);

                        // Verify with a displayName that is longer than the maximum allowed size
                        const longDisplayName = TestsUtil.generateRandomText(100);
                        RestAPI.Discussions.updateDiscussion(
                          user.restContext,
                          createdDiscussion.id,
                          { displayName: longDisplayName },
                          (error, discussion) => {
                            assert.ok(error);
                            assert.strictEqual(error.code, 400);
                            assert.ok(error.msg.indexOf('1000') > 0);
                            assert.ok(!discussion);

                            // Verify with a description that is longer than the maximum allowed size
                            const longDescription = TestsUtil.generateRandomText(1000);
                            RestAPI.Discussions.updateDiscussion(
                              user.restContext,
                              createdDiscussion.id,
                              { description: longDescription },
                              (error /* , discussion */) => {
                                assert.ok(error);
                                assert.strictEqual(error.code, 400);
                                assert.ok(error.msg.indexOf('10000') > 0);

                                // Verify with an empty description
                                RestAPI.Discussions.updateDiscussion(
                                  user.restContext,
                                  createdDiscussion.id,
                                  { description: '' },
                                  (error /* , discussion */) => {
                                    assert.ok(error);
                                    assert.strictEqual(error.code, 400);

                                    // Verify the discussion has not changed
                                    RestAPI.Discussions.getDiscussion(
                                      user.restContext,
                                      createdDiscussion.id,
                                      (error, discussionProfile) => {
                                        assert.notExists(error);
                                        assert.strictEqual(discussionProfile.displayName, displayName);
                                        assert.strictEqual(discussionProfile.description, description);
                                        assert.strictEqual(discussionProfile.visibility, visibility);
                                        assert.strictEqual(discussionProfile.created, discussionProfile.lastModified);

                                        // Now do a real update as a sanity check
                                        RestAPI.Discussions.updateDiscussion(
                                          user.restContext,
                                          createdDiscussion.id,
                                          updates,
                                          (error, discussion) => {
                                            assert.notExists(error);
                                            assert.strictEqual(discussion.displayName, updates.displayName);
                                            assert.strictEqual(discussion.description, updates.description);
                                            assert.ok(discussion.canShare);
                                            assert.ok(discussion.canPost);
                                            assert.ok(discussion.isManager);
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
          }
        );
      });
    });

    /**
     * Test that verifies a discussion can be updated and its model data
     */
    it('verify discussion update and model', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities((publicTenant) => {
        const displayName = 'test-update-displayName';
        const description = 'test-update-description';
        const visibility = 'public';
        const managers = [publicTenant.publicUser.user.id];
        const members = [publicTenant.loggedinUser.user.id];

        // Create the discussion whose model to verify
        RestAPI.Discussions.createDiscussion(
          publicTenant.adminRestContext,
          displayName,
          description,
          visibility,
          managers,
          members,
          (error, discussion) => {
            assert.notExists(error);

            // Update the discussion displayName, description and visibility with the manager user
            const updates = {
              displayName: 'new-display-name',
              description: 'new-description'
            };

            // Verify the returned discussion model with a partial update.
            RestAPI.Discussions.updateDiscussion(
              publicTenant.publicUser.restContext,
              discussion.id,
              updates,
              (error, discussion) => {
                assert.notExists(error);
                assert.ok(discussion.id);
                assert.strictEqual(discussion.displayName, updates.displayName);
                assert.strictEqual(discussion.description, updates.description);
                assert.strictEqual(discussion.visibility, 'public');
                assert.ok(Number.parseInt(discussion.created, 10) < Number.parseInt(discussion.lastModified, 10));
                assert.ok(discussion.created);
                assert.ok(discussion.lastModified);
                assert.ok(discussion.tenant);
                assert.strictEqual(discussion.tenant.alias, publicTenant.tenant.alias);
                assert.strictEqual(discussion.tenant.displayName, publicTenant.tenant.displayName);

                // Verify updating just the visibility
                RestAPI.Discussions.updateDiscussion(
                  publicTenant.publicUser.restContext,
                  discussion.id,
                  { visibility: 'private' },
                  (error, discussion) => {
                    assert.notExists(error);
                    assert.ok(discussion.id);
                    assert.strictEqual(discussion.displayName, updates.displayName);
                    assert.strictEqual(discussion.description, updates.description);
                    assert.strictEqual(discussion.visibility, 'private');
                    assert.ok(Number.parseInt(discussion.created, 10) < Number.parseInt(discussion.lastModified, 10));
                    assert.ok(discussion.created);
                    assert.ok(discussion.lastModified);
                    assert.ok(discussion.tenant);
                    assert.strictEqual(discussion.tenant.alias, publicTenant.tenant.alias);
                    assert.strictEqual(discussion.tenant.displayName, publicTenant.tenant.displayName);
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
     * Test that verifies the permissions restrictions on updating discussions
     */
    it('verify unauthorized users cannot update discussions', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities((publicTenant) => {
        const updates = {
          displayName: 'new-display-name',
          description: 'new-description',
          visibility: 'private'
        };

        // Verify anonymous user cannot update
        RestAPI.Discussions.updateDiscussion(
          publicTenant.anonymousRestContext,
          publicTenant.publicDiscussion.id,
          updates,
          (error, discussion) => {
            assert.ok(error);
            assert.strictEqual(error.code, 401);
            assert.ok(!discussion);

            // Verify loggedin non-member cannot update
            RestAPI.Discussions.updateDiscussion(
              publicTenant.publicUser.restContext,
              publicTenant.publicDiscussion.id,
              updates,
              (error, discussion) => {
                assert.ok(error);
                assert.strictEqual(error.code, 401);
                assert.ok(!discussion);

                // Verify member cannot update
                RestAPI.Discussions.shareDiscussion(
                  publicTenant.adminRestContext,
                  publicTenant.publicDiscussion.id,
                  [publicTenant.publicUser.user.id],
                  (error_) => {
                    assert.notExists(error_);

                    RestAPI.Discussions.updateDiscussion(
                      publicTenant.publicUser.restContext,
                      publicTenant.publicDiscussion.id,
                      updates,
                      (error, discussion) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 401);
                        assert.ok(!discussion);

                        // Verify the discussion is still the same
                        RestAPI.Discussions.getDiscussion(
                          publicTenant.publicUser.restContext,
                          publicTenant.publicDiscussion.id,
                          (error, discussion) => {
                            assert.notExists(error);
                            assert.strictEqual(discussion.displayName, publicTenant.publicDiscussion.displayName);
                            assert.strictEqual(discussion.description, publicTenant.publicDiscussion.description);
                            assert.strictEqual(discussion.visibility, publicTenant.publicDiscussion.visibility);

                            // Verify the manager can update
                            const permissionChange = {};
                            permissionChange[publicTenant.publicUser.user.id] = 'manager';
                            RestAPI.Discussions.updateDiscussionMembers(
                              publicTenant.adminRestContext,
                              publicTenant.publicDiscussion.id,
                              permissionChange,
                              (error_) => {
                                assert.notExists(error_);

                                RestAPI.Discussions.updateDiscussion(
                                  publicTenant.publicUser.restContext,
                                  publicTenant.publicDiscussion.id,
                                  updates,
                                  (error, discussion) => {
                                    assert.notExists(error);
                                    assert.ok(discussion);

                                    // Verify the discussion update took
                                    RestAPI.Discussions.getDiscussion(
                                      publicTenant.publicUser.restContext,
                                      publicTenant.publicDiscussion.id,
                                      (error, discussion) => {
                                        assert.notExists(error);
                                        assert.strictEqual(discussion.displayName, updates.displayName);
                                        assert.strictEqual(discussion.description, updates.description);
                                        assert.strictEqual(discussion.visibility, updates.visibility);
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

  describe('Deleting Discussions', () => {
    /**
     * Test that verifies deleting a discussion properly cleans up library and authz
     * associations
     */
    it('verify deleting a discussion properly cleans up associations', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: branden } = users;

        // Add two discussions. One is to delete and the other is to sanity check the library can still be rebuilt and contain the undeleted discussion
        RestAPI.Discussions.createDiscussion(
          branden.restContext,
          'name',
          'descr',
          'public',
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);
            RestAPI.Discussions.createDiscussion(
              branden.restContext,
              'name2',
              'descr2',
              'public',
              null,
              null,
              (error, discussion2) => {
                assert.notExists(error);
                // First, do a sanity check that the discussion is in Branden's library
                RestAPI.Discussions.getDiscussionsLibrary(
                  branden.restContext,
                  branden.user.id,
                  null,
                  null,
                  (error, items) => {
                    assert.notExists(error);
                    assert.strictEqual(items.results.length, 2);

                    const itemIds = pluck('id', items.results);
                    assert.ok(contains(discussion.id, itemIds));
                    assert.ok(contains(discussion2.id, itemIds));

                    // Purge Branden's library and ensure they're both still there
                    LibraryAPI.Index.purge('discussions:discussions', branden.user.id, (error_) => {
                      assert.notExists(error_);
                      RestAPI.Discussions.getDiscussionsLibrary(
                        branden.restContext,
                        branden.user.id,
                        null,
                        null,
                        (error, items) => {
                          assert.notExists(error);
                          assert.strictEqual(items.results.length, 2);

                          // Delete one of the discussions
                          RestAPI.Discussions.deleteDiscussion(branden.restContext, discussion.id, (error_) => {
                            assert.notExists(error_);

                            // Ensure the discussion is removed from Branden's library
                            RestAPI.Discussions.getDiscussionsLibrary(
                              branden.restContext,
                              branden.user.id,
                              null,
                              null,
                              (error, items) => {
                                assert.notExists(error);
                                assert.strictEqual(items.results.length, 1);
                                assert.strictEqual(items.results[0].id, discussion2.id);

                                // Purge Branden's library and ensure the deleted one is not there. This ensures
                                // the authz association does not have inconsistent association data
                                LibraryAPI.Index.purge('discussions:discussions', branden.user.id, (error_) => {
                                  assert.notExists(error_);
                                  RestAPI.Discussions.getDiscussionsLibrary(
                                    branden.restContext,
                                    branden.user.id,
                                    null,
                                    null,
                                    (error, items) => {
                                      assert.notExists(error);
                                      assert.strictEqual(items.results.length, 1);
                                      assert.strictEqual(items.results[0].id, discussion2.id);

                                      // Sanity check the discussion is actually deleted
                                      RestAPI.Discussions.getDiscussion(
                                        branden.restContext,
                                        discussion.id,
                                        (error, discussion) => {
                                          assert.strictEqual(error.code, 404);
                                          assert.ok(!discussion);
                                          return callback();
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
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that only managers can delete a discussion
     */
    it('verify deleting a discussion', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: branden, 1: simon } = users;

        // Add a discussion to try and delete
        RestAPI.Discussions.createDiscussion(
          branden.restContext,
          'name',
          'descr',
          'public',
          null,
          [simon.user.id],
          (error, discussion) => {
            assert.notExists(error);

            // Ensure the discussion can be fetched
            RestAPI.Discussions.getDiscussion(branden.restContext, discussion.id, (error, fetchedDiscussion) => {
              assert.notExists(error);
              assert.ok(discussion);
              assert.strictEqual(fetchedDiscussion.id, discussion.id);

              // Verify Simon cannot delete the discussion (as he's not the manager)
              RestAPI.Discussions.deleteDiscussion(simon.restContext, discussion.id, (error_) => {
                assert.strictEqual(error_.code, 401);

                // Ensure the discussion can still be fetched
                RestAPI.Discussions.getDiscussion(branden.restContext, discussion.id, (error, fetchedDiscussion) => {
                  assert.notExists(error);
                  assert.ok(discussion);
                  assert.strictEqual(fetchedDiscussion.id, discussion.id);

                  // Ensure Branden can delete it
                  RestAPI.Discussions.deleteDiscussion(branden.restContext, discussion.id, (error_) => {
                    assert.notExists(error_);

                    // Ensure the discussion can no longer be fetched
                    RestAPI.Discussions.getDiscussion(branden.restContext, discussion.id, (error, discussion) => {
                      assert.strictEqual(error.code, 404);
                      assert.ok(!discussion);
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

    /**
     * Test that verifies some basic parameter validation when deleting a discussion.
     */
    it('verify deleting discussion validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: branden } = users;

        // An invalid discussion id, should result in a  400.
        RestAPI.Discussions.deleteDiscussion(branden.restContext, 'invalid id', (error_) => {
          assert.strictEqual(error_.code, 400);

          // A non-existing discussion should result in a 404
          RestAPI.Discussions.deleteDiscussion(branden.restContext, 'd:camtest:bleh', (error_) => {
            assert.strictEqual(error_.code, 404);
            callback();
          });
        });
      });
    });
  });

  describe('Discussions Model', () => {
    /**
     * Test that verifies the full profile model of a discussion, and the privacy rules for its access.
     */
    it('verify discussion full profile model, privacy and validation', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant, publicTenant1, privateTenant, privateTenant1) => {
          /**
           * Anonymous same-tenant user
           */

          // Ensure getDiscussion validation
          RestAPI.Discussions.getDiscussion(publicTenant.anonymousRestContext, 'not-a-valid-id', (error) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);

            // Ensure anonymous user cannot see the full profile of loggedin and private
            RestAPI.Discussions.getDiscussion(
              publicTenant.anonymousRestContext,
              publicTenant.privateDiscussion.id,
              (error) => {
                assert.ok(error);
                assert.strictEqual(error.code, 401);

                RestAPI.Discussions.getDiscussion(
                  publicTenant.anonymousRestContext,
                  publicTenant.loggedinDiscussion.id,
                  (error) => {
                    assert.ok(error);
                    assert.strictEqual(error.code, 401);

                    // Verify they can see public
                    RestAPI.Discussions.getDiscussion(
                      publicTenant.anonymousRestContext,
                      publicTenant.publicDiscussion.id,
                      (error, discussion) => {
                        assert.notExists(error);

                        // Basic info
                        assert.strictEqual(discussion.id, discussion.id);
                        assert.strictEqual(discussion.displayName, discussion.displayName);
                        assert.strictEqual(discussion.description, discussion.description);
                        assert.strictEqual(discussion.visibility, discussion.visibility);
                        assert.strictEqual(discussion.created, discussion.lastModified);
                        assert.strictEqual(discussion.created, discussion.created);
                        assert.ok(discussion.tenant);
                        assert.strictEqual(discussion.tenant.alias, publicTenant.tenant.alias);
                        assert.strictEqual(discussion.tenant.displayName, publicTenant.tenant.displayName);

                        // Access info
                        assert.ok(!discussion.isManager);
                        assert.ok(!discussion.canPost);
                        assert.ok(!discussion.canShare);

                        /// ////////////////////////////
                        // LOGGEDIN SAME-TENANT USER //
                        /// ////////////////////////////

                        // Ensure loggedin user cannot see the full profile of private
                        RestAPI.Discussions.getDiscussion(
                          publicTenant.publicUser.restContext,
                          publicTenant.privateDiscussion.id,
                          (error_) => {
                            assert.ok(error_);
                            assert.strictEqual(error_.code, 401);

                            // Loggedin user can see the profile of logged, and they can post and share on it
                            RestAPI.Discussions.getDiscussion(
                              publicTenant.publicUser.restContext,
                              publicTenant.loggedinDiscussion.id,
                              (error, discussion) => {
                                assert.notExists(error);

                                // Basic info
                                assert.strictEqual(discussion.id, discussion.id);
                                assert.strictEqual(discussion.displayName, discussion.displayName);
                                assert.strictEqual(discussion.description, discussion.description);
                                assert.strictEqual(discussion.visibility, discussion.visibility);
                                assert.strictEqual(discussion.created, discussion.lastModified);
                                assert.strictEqual(discussion.created, discussion.created);
                                assert.ok(discussion.tenant);
                                assert.strictEqual(discussion.tenant.alias, publicTenant.tenant.alias);
                                assert.strictEqual(discussion.tenant.displayName, publicTenant.tenant.displayName);

                                // Access info
                                assert.ok(!discussion.isManager);
                                assert.ok(discussion.canPost);
                                assert.ok(discussion.canShare);

                                // Verify they can see, share, post on public
                                RestAPI.Discussions.getDiscussion(
                                  publicTenant.publicUser.restContext,
                                  publicTenant.publicDiscussion.id,
                                  (error, discussion) => {
                                    assert.notExists(error);

                                    // Basic info
                                    assert.strictEqual(discussion.id, discussion.id);
                                    assert.strictEqual(discussion.displayName, discussion.displayName);
                                    assert.strictEqual(discussion.description, discussion.description);
                                    assert.strictEqual(discussion.visibility, discussion.visibility);
                                    assert.strictEqual(discussion.created, discussion.lastModified);
                                    assert.strictEqual(discussion.created, discussion.created);
                                    assert.ok(discussion.tenant);
                                    assert.strictEqual(discussion.tenant.alias, publicTenant.tenant.alias);
                                    assert.strictEqual(discussion.tenant.displayName, publicTenant.tenant.displayName);

                                    // Access info
                                    assert.ok(!discussion.isManager);
                                    assert.ok(discussion.canPost);
                                    assert.ok(discussion.canShare);

                                    /// /////////////////////
                                    // MEMBER SAME-TENANT //
                                    /// /////////////////////

                                    // Share private discussion with the loggedin user
                                    RestAPI.Discussions.shareDiscussion(
                                      publicTenant.adminRestContext,
                                      publicTenant.privateDiscussion.id,
                                      [publicTenant.loggedinUser.user.id],
                                      (error_) => {
                                        assert.notExists(error_);

                                        // Loggedin user can now view, and post on discussion, but still cannot share
                                        RestAPI.Discussions.getDiscussion(
                                          publicTenant.loggedinUser.restContext,
                                          publicTenant.privateDiscussion.id,
                                          (error, discussion) => {
                                            assert.notExists(error);

                                            // Basic info
                                            assert.strictEqual(discussion.id, discussion.id);
                                            assert.strictEqual(discussion.displayName, discussion.displayName);
                                            assert.strictEqual(discussion.description, discussion.description);
                                            assert.strictEqual(discussion.visibility, discussion.visibility);
                                            assert.strictEqual(discussion.created, discussion.lastModified);
                                            assert.strictEqual(discussion.created, discussion.created);
                                            assert.ok(discussion.tenant);
                                            assert.strictEqual(discussion.tenant.alias, publicTenant.tenant.alias);
                                            assert.strictEqual(
                                              discussion.tenant.displayName,
                                              publicTenant.tenant.displayName
                                            );

                                            // Access info
                                            assert.ok(!discussion.isManager);
                                            assert.ok(discussion.canPost);
                                            assert.ok(!discussion.canShare);

                                            /// //////////////////////
                                            // MANAGER SAME-TENANT //
                                            /// //////////////////////

                                            // Make public user manager
                                            const permissionChanges = {};
                                            permissionChanges[publicTenant.loggedinUser.user.id] = 'manager';
                                            RestAPI.Discussions.updateDiscussionMembers(
                                              publicTenant.adminRestContext,
                                              publicTenant.privateDiscussion.id,
                                              permissionChanges,
                                              (error_) => {
                                                assert.notExists(error_);

                                                // Loggedin user can now view, share, and post on private discussion
                                                RestAPI.Discussions.getDiscussion(
                                                  publicTenant.loggedinUser.restContext,
                                                  publicTenant.privateDiscussion.id,
                                                  (error, discussion) => {
                                                    assert.notExists(error);

                                                    // Basic info
                                                    assert.strictEqual(discussion.id, discussion.id);
                                                    assert.strictEqual(discussion.displayName, discussion.displayName);
                                                    assert.strictEqual(discussion.description, discussion.description);
                                                    assert.strictEqual(discussion.visibility, discussion.visibility);
                                                    assert.strictEqual(discussion.created, discussion.lastModified);
                                                    assert.strictEqual(discussion.created, discussion.created);
                                                    assert.ok(discussion.tenant);
                                                    assert.strictEqual(
                                                      discussion.tenant.alias,
                                                      publicTenant.tenant.alias
                                                    );
                                                    assert.strictEqual(
                                                      discussion.tenant.displayName,
                                                      publicTenant.tenant.displayName
                                                    );

                                                    // Access info
                                                    assert.ok(discussion.isManager);
                                                    assert.ok(discussion.canPost);
                                                    assert.ok(discussion.canShare);

                                                    /// /////////////////////////////////////////
                                                    // ADMIN USER FROM EXTERNAL PUBLIC TENANT //
                                                    /// /////////////////////////////////////////

                                                    // Ensure cross-tenant user cannot see the full profile of loggedin and private
                                                    RestAPI.Discussions.getDiscussion(
                                                      publicTenant1.adminRestContext,
                                                      publicTenant.privateDiscussion.id,
                                                      (error_) => {
                                                        assert.ok(error_);
                                                        assert.strictEqual(error_.code, 401);

                                                        RestAPI.Discussions.getDiscussion(
                                                          publicTenant1.adminRestContext,
                                                          publicTenant.loggedinDiscussion.id,
                                                          (error_) => {
                                                            assert.ok(error_);
                                                            assert.strictEqual(error_.code, 401);

                                                            // Verify they can see, share and post on public discussions (both are public tenants)
                                                            RestAPI.Discussions.getDiscussion(
                                                              publicTenant1.adminRestContext,
                                                              publicTenant.publicDiscussion.id,
                                                              (error, discussion) => {
                                                                assert.notExists(error);

                                                                // Basic info
                                                                assert.strictEqual(discussion.id, discussion.id);
                                                                assert.strictEqual(
                                                                  discussion.displayName,
                                                                  discussion.displayName
                                                                );
                                                                assert.strictEqual(
                                                                  discussion.description,
                                                                  discussion.description
                                                                );
                                                                assert.strictEqual(
                                                                  discussion.visibility,
                                                                  discussion.visibility
                                                                );
                                                                assert.strictEqual(
                                                                  discussion.created,
                                                                  discussion.lastModified
                                                                );
                                                                assert.strictEqual(
                                                                  discussion.created,
                                                                  discussion.created
                                                                );
                                                                assert.ok(discussion.tenant);
                                                                assert.strictEqual(
                                                                  discussion.tenant.alias,
                                                                  publicTenant.tenant.alias
                                                                );
                                                                assert.strictEqual(
                                                                  discussion.tenant.displayName,
                                                                  publicTenant.tenant.displayName
                                                                );

                                                                // Access info
                                                                assert.ok(!discussion.isManager);
                                                                assert.ok(discussion.canPost);
                                                                assert.ok(discussion.canShare);

                                                                /// //////////////////////////////////////////
                                                                // ADMIN USER FROM EXTERNAL PRIVATE TENANT //
                                                                /// //////////////////////////////////////////

                                                                // Ensure cross-tenant user cannot see the full profile of loggedin and private
                                                                RestAPI.Discussions.getDiscussion(
                                                                  privateTenant1.adminRestContext,
                                                                  publicTenant.privateDiscussion.id,
                                                                  (error_) => {
                                                                    assert.ok(error_);
                                                                    assert.strictEqual(error_.code, 401);

                                                                    RestAPI.Discussions.getDiscussion(
                                                                      privateTenant1.adminRestContext,
                                                                      publicTenant.loggedinDiscussion.id,
                                                                      (error_) => {
                                                                        assert.ok(error_);
                                                                        assert.strictEqual(error_.code, 401);

                                                                        // Verify they can see the public discussion, but cannot post or share because the tenant is private
                                                                        RestAPI.Discussions.getDiscussion(
                                                                          privateTenant1.adminRestContext,
                                                                          publicTenant.publicDiscussion.id,
                                                                          (error, discussion) => {
                                                                            assert.notExists(error);

                                                                            // Basic info
                                                                            assert.strictEqual(
                                                                              discussion.id,
                                                                              discussion.id
                                                                            );
                                                                            assert.strictEqual(
                                                                              discussion.displayName,
                                                                              discussion.displayName
                                                                            );
                                                                            assert.strictEqual(
                                                                              discussion.description,
                                                                              discussion.description
                                                                            );
                                                                            assert.strictEqual(
                                                                              discussion.visibility,
                                                                              discussion.visibility
                                                                            );
                                                                            assert.strictEqual(
                                                                              discussion.created,
                                                                              discussion.lastModified
                                                                            );
                                                                            assert.strictEqual(
                                                                              discussion.created,
                                                                              discussion.created
                                                                            );
                                                                            assert.ok(discussion.tenant);
                                                                            assert.strictEqual(
                                                                              discussion.tenant.alias,
                                                                              publicTenant.tenant.alias
                                                                            );
                                                                            assert.strictEqual(
                                                                              discussion.tenant.displayName,
                                                                              publicTenant.tenant.displayName
                                                                            );

                                                                            // Access info
                                                                            assert.ok(!discussion.isManager);
                                                                            assert.ok(!discussion.canPost);
                                                                            assert.ok(!discussion.canShare);

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
          });
        }
      );
    });

    /**
     * Test that verifies just the `createdBy` field of the full discussion profile. Verifies it gets scrubbed appropriately due to user profile
     * visibility restrictions.
     */
    it('verify discussion full profile createdBy model and privacy', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant /* , publicTenant1, privateTenant, privateTenant1 */) => {
          const displayName = 'test-createdBy-displayName';
          const description = 'test-createdBy-description';
          const visibility = 'public';

          // Create the discussion whose createdBy model to verify
          RestAPI.Discussions.createDiscussion(
            publicTenant.loggedinUser.restContext,
            displayName,
            description,
            visibility,
            null,
            null,
            (error, discussion) => {
              assert.notExists(error);

              // Verify anonymous user gets a scrubbed createdBy object
              RestAPI.Discussions.getDiscussion(
                publicTenant.anonymousRestContext,
                discussion.id,
                (error, discussion) => {
                  assert.notExists(error);

                  // Display name should have been swapped out for the publicAlias
                  assert.ok(discussion.createdBy);
                  assert.strictEqual(discussion.createdBy.id, publicTenant.loggedinUser.user.id);
                  assert.strictEqual(discussion.createdBy.displayName, publicTenant.loggedinUser.user.publicAlias);

                  // Verify authenticated user gets a full createdBy object
                  RestAPI.Discussions.getDiscussion(
                    publicTenant.publicUser.restContext,
                    discussion.id,
                    (error, discussion) => {
                      assert.notExists(error);

                      assert.ok(discussion.createdBy);
                      assert.strictEqual(discussion.createdBy.id, publicTenant.loggedinUser.user.id);
                      assert.strictEqual(discussion.createdBy.tenant.alias, publicTenant.tenant.alias);
                      assert.strictEqual(discussion.createdBy.tenant.displayName, publicTenant.tenant.displayName);
                      assert.strictEqual(discussion.createdBy.displayName, publicTenant.loggedinUser.user.displayName);
                      assert.ok(!discussion.createdBy.publicAlias);
                      assert.strictEqual(discussion.createdBy.visibility, publicTenant.loggedinUser.user.visibility);
                      assert.strictEqual(discussion.createdBy.resourceType, 'user');
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

  describe('Discussions Members', () => {
    /**
     * Verify the model of the discussions member listing, and the privacy rules associated to its access, and the access of
     * data associated to users and groups inside of it.
     */
    it('verify discussion members list model, privacy and validation', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant /* , publicTenant1, privateTenant, privateTenant1 */) => {
          // Share public discussion with loggedin and private user
          const members = [publicTenant.loggedinUser.user.id, publicTenant.privateUser.user.id];
          RestAPI.Discussions.shareDiscussion(
            publicTenant.adminRestContext,
            publicTenant.publicDiscussion.id,
            members,
            (error) => {
              assert.notExists(error);

              // Verify validation getting discussion members
              RestAPI.Discussions.getDiscussionMembers(
                publicTenant.anonymousRestContext,
                'not-a-valid-id',
                null,
                null,
                (error /* , members */) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 400);

                  // Verify anonymous user gets a scrubbed member for loggedin and private member
                  RestAPI.Discussions.getDiscussionMembers(
                    publicTenant.anonymousRestContext,
                    publicTenant.publicDiscussion.id,
                    null,
                    null,
                    (error, members) => {
                      assert.notExists(error);
                      assert.strictEqual(members.results.length, 3);

                      // Verify the members model
                      forEach((member) => {
                        if (member.profile.id === publicTenant.loggedinUser.user.id) {
                          assert.strictEqual(member.role, 'member');
                          assert.strictEqual(member.profile.tenant.alias, publicTenant.tenant.alias);
                          assert.strictEqual(member.profile.tenant.displayName, publicTenant.tenant.displayName);
                          assert.strictEqual(member.profile.displayName, publicTenant.loggedinUser.user.publicAlias);
                          assert.strictEqual(member.profile.visibility, publicTenant.loggedinUser.user.visibility);
                          assert.ok(!member.profile.profilePath);
                          assert.ok(!member.profile.publicAlias);
                          assert.strictEqual(member.profile.resourceType, 'user');
                        } else if (member.profile.id === publicTenant.privateUser.user.id) {
                          assert.strictEqual(member.role, 'member');
                          assert.strictEqual(member.profile.tenant.alias, publicTenant.tenant.alias);
                          assert.strictEqual(member.profile.tenant.displayName, publicTenant.tenant.displayName);
                          assert.strictEqual(member.profile.displayName, publicTenant.privateUser.user.publicAlias);
                          assert.strictEqual(member.profile.visibility, publicTenant.privateUser.user.visibility);
                          assert.ok(!member.profile.profilePath);
                          assert.ok(!member.profile.publicAlias);
                          assert.strictEqual(member.profile.resourceType, 'user');
                        } else {
                          // Admin user
                          assert.strictEqual(member.role, 'manager');
                        }
                      }, members.results);

                      // Verify authenticated user gets a scrubbed member for private member, but full loggedin user profile
                      RestAPI.Discussions.getDiscussionMembers(
                        publicTenant.publicUser.restContext,
                        publicTenant.publicDiscussion.id,
                        null,
                        null,
                        (error, members) => {
                          assert.notExists(error);
                          assert.strictEqual(members.results.length, 3);

                          // Verify the members model
                          forEach((member) => {
                            if (member.profile.id === publicTenant.loggedinUser.user.id) {
                              assert.strictEqual(member.role, 'member');
                              assert.strictEqual(member.profile.tenant.alias, publicTenant.tenant.alias);
                              assert.strictEqual(member.profile.tenant.displayName, publicTenant.tenant.displayName);
                              assert.strictEqual(
                                member.profile.displayName,
                                publicTenant.loggedinUser.user.displayName
                              );
                              assert.strictEqual(member.profile.visibility, publicTenant.loggedinUser.user.visibility);
                              assert.ok(member.profile.profilePath);
                              assert.ok(!member.profile.publicAlias);
                              assert.strictEqual(member.profile.resourceType, 'user');
                            } else if (member.profile.id === publicTenant.privateUser.user.id) {
                              assert.strictEqual(member.role, 'member');
                              assert.strictEqual(member.profile.tenant.alias, publicTenant.tenant.alias);
                              assert.strictEqual(member.profile.tenant.displayName, publicTenant.tenant.displayName);
                              assert.strictEqual(member.profile.displayName, publicTenant.privateUser.user.publicAlias);
                              assert.strictEqual(member.profile.visibility, publicTenant.privateUser.user.visibility);
                              assert.ok(!member.profile.profilePath);
                              assert.ok(!member.profile.publicAlias);
                              assert.strictEqual(member.profile.resourceType, 'user');
                            } else {
                              // Admin user
                              assert.strictEqual(member.role, 'manager');
                            }
                          }, members.results);

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

    /**
     * Test that verifies discussion members can be paged
     */
    it('verify paging discussion members', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 10, (error, users) => {
        assert.notExists(error);

        const { 0: simon } = users;

        // Get the user ids for the users we'll add as members
        const members = filter(pathSatisfies(compose(not, equals(simon.user.id)), ['user', 'id']), values(users));

        const memberIds = [];
        forEach((user) => {
          memberIds.push(user.user.id);
        }, members);

        RestAPI.Discussions.createDiscussion(
          simon.restContext,
          'displayName',
          'description',
          'public',
          null,
          memberIds,
          (error, discussion) => {
            assert.notExists(error);

            // Get the first 3 members
            RestAPI.Discussions.getDiscussionMembers(simon.restContext, discussion.id, null, 3, (error, members) => {
              assert.notExists(error);
              assert.strictEqual(members.results.length, 3);
              assert.ok(members.nextToken);

              const seenMembers = [];
              forEach((member) => {
                seenMembers.push(member.profile.id);
              }, members.results);

              // Get the next 3 members
              RestAPI.Discussions.getDiscussionMembers(
                simon.restContext,
                discussion.id,
                members.nextToken,
                3,
                (error, members) => {
                  assert.notExists(error);
                  assert.strictEqual(members.results.length, 3);
                  assert.ok(members.nextToken);

                  // Verify we haven't seen any of these members
                  forEach((member) => {
                    assert.isNotOk(contains(member.profile.id, seenMembers));
                  }, members.results);

                  // Add these set of members to the 'seen' members list
                  forEach((member) => {
                    seenMembers.push(member.profile.id);
                  }, members.results);

                  // Get another page of members
                  RestAPI.Discussions.getDiscussionMembers(
                    simon.restContext,
                    discussion.id,
                    members.nextToken,
                    3,
                    (error, members) => {
                      assert.notExists(error);
                      assert.strictEqual(members.results.length, 3);
                      assert.ok(members.nextToken);

                      // Verify we haven't seen any of these members
                      forEach((member) => {
                        assert.isNotOk(contains(member.profile.id, seenMembers));
                      }, members.results);

                      // Add these set of members to the 'seen' members list
                      forEach((member) => {
                        seenMembers.push(member.profile.id);
                      }, members.results);

                      // Get the last member
                      RestAPI.Discussions.getDiscussionMembers(
                        simon.restContext,
                        discussion.id,
                        members.nextToken,
                        3,
                        (error, members) => {
                          assert.notExists(error);
                          assert.strictEqual(members.results.length, 1);

                          // There are no further results, nextToken should be null
                          assert.ok(!members.nextToken);
                          callback();
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
     * Test that verifies that you cannot add a private user as a member
     */
    it('verify adding a private user as a member is not possible', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: nico, 1: bert } = users;

        RestAPI.User.updateUser(bert.restContext, bert.user.id, { visibility: 'private' }, (error_) => {
          assert.notExists(error_);

          RestAPI.Discussions.createDiscussion(
            nico.restContext,
            'Test discussion',
            'Test discussion description',
            'public',
            [],
            [],
            (error, discussion) => {
              assert.notExists(error);

              const update = {};
              update[bert.user.id] = 'manager';
              RestAPI.Discussions.updateDiscussionMembers(nico.restContext, discussion.id, update, (error_) => {
                assert.strictEqual(error_.code, 401);
                callback();
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies that you cannot add a private group as a member
     */
    it('verify adding a private group as a member is not possible', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: nico, 1: bert } = users;

        RestAPI.Group.createGroup(
          bert.restContext,
          'Group title',
          'Group description',
          'private',
          undefined,
          [],
          [],
          (error, groupObject) => {
            assert.notExists(error);

            RestAPI.Discussions.createDiscussion(
              nico.restContext,
              'Test discussion',
              'Test discussion description',
              'public',
              [],
              [],
              (error, discussion) => {
                assert.notExists(error);

                const update = {};
                update[groupObject.id] = 'manager';
                RestAPI.Discussions.updateDiscussionMembers(nico.restContext, discussion.id, update, (error_) => {
                  assert.strictEqual(error_.code, 401);
                  callback();
                });
              }
            );
          }
        );
      });
    });
  });

  describe('Discussions Library', () => {
    /*!
     * Verify that the set of discussion library results has the item with id `id`
     *
     * @param  {Message[]}  results         The array of messages to check
     * @param  {String}     id              The id to search for in the messages
     * @throws {Error}                      Throws an assertion error if the id is not in the list of messages
     */
    const _assertContainsItem = (results, id) => {
      let hasItem = false;
      forEach((item) => {
        if (item.id === id) {
          hasItem = true;
        }
      }, results);

      assert.ok(hasItem);
    };

    /*!
     * Verify that the set of discussion library results does not have the item with id `id`
     *
     * @param  {Message[]}  results         The array of messages to check
     * @param  {String}     id              The id to search for in the messages
     * @throws {Error}                      Throws an assertion error if the id is in the list of messages
     */
    const _assertDoesNotContainItem = (results, id) => {
      forEach((item) => {
        assert.notStrictEqual(item.id, id);
      }, results);
    };

    /**
     * Test that verifies the validation of listing a discussion library
     */
    it('verify validation when listing discussion library', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        RestAPI.Discussions.getDiscussionsLibrary(
          user.restContext,
          'not-a-valid-id',
          null,
          null,
          (error /* , items */) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);

            RestAPI.Discussions.getDiscussionsLibrary(
              user.restContext,
              user.user.id,
              null,
              null,
              (error /* , items */) => {
                assert.notExists(error);
                return callback();
              }
            );
          }
        );
      });
    });

    /**
     * Verify the model of discussions that appear in the discussion libraries
     */
    it('verify discussion library model', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant /* , publicTenant1, privateTenant, privateTenant1 */) => {
          // Share an item with the public user
          RestAPI.Discussions.shareDiscussion(
            publicTenant.adminRestContext,
            publicTenant.publicDiscussion.id,
            [publicTenant.publicUser.user.id],
            (error) => {
              assert.notExists(error);

              // Get and verify the model in the public user's library
              RestAPI.Discussions.getDiscussionsLibrary(
                publicTenant.publicUser.restContext,
                publicTenant.publicUser.user.id,
                null,
                null,
                (error, items) => {
                  assert.notExists(error);
                  assert.strictEqual(items.results.length, 1);
                  assert.ok(!items.nextToken);

                  const discussion = items.results[0];
                  assert.strictEqual(discussion.tenant.alias, publicTenant.tenant.alias);
                  assert.strictEqual(discussion.tenant.displayName, publicTenant.tenant.displayName);
                  assert.strictEqual(discussion.id, publicTenant.publicDiscussion.id);
                  assert.strictEqual(discussion.createdBy, publicTenant.publicDiscussion.createdBy);
                  assert.strictEqual(discussion.displayName, publicTenant.publicDiscussion.displayName);
                  assert.strictEqual(discussion.description, publicTenant.publicDiscussion.description);
                  assert.strictEqual(discussion.visibility, publicTenant.publicDiscussion.visibility);
                  assert.strictEqual(discussion.created, publicTenant.publicDiscussion.created);
                  assert.ok(discussion.lastModified);
                  return callback();
                }
              );
            }
          );
        }
      );
    });

    /**
     * Verify the access privacy of discussions inside a discussion user library. Ensures discussions in libraries do not leak to users viewing
     * other user libraries.
     */
    it('verify discussion user library privacy', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant, publicTenant1 /* , privateTenant, privateTenant1 */) => {
          // Make public user manager of the public discussion so it goes in their library
          const updatePermissions = {};
          updatePermissions[publicTenant.publicUser.user.id] = 'manager';
          DiscussionsTestsUtil.assertUpdateDiscussionMembersSucceeds(
            publicTenant.adminRestContext,
            publicTenant.adminRestContext,
            publicTenant.publicDiscussion.id,
            updatePermissions,
            () => {
              /// ///////////////////////////////////////////////////
              // VERIFY PUBLIC DISCUSSION VISIBILITY IN LIBRARIES //
              /// ///////////////////////////////////////////////////

              // Verify anonymous user can see it
              RestAPI.Discussions.getDiscussionsLibrary(
                publicTenant.anonymousRestContext,
                publicTenant.publicUser.user.id,
                null,
                null,
                (error, items) => {
                  assert.notExists(error);
                  _assertContainsItem(items.results, publicTenant.publicDiscussion.id);

                  // Verify authenticated user can see it
                  RestAPI.Discussions.getDiscussionsLibrary(
                    publicTenant.loggedinUser.restContext,
                    publicTenant.publicUser.user.id,
                    null,
                    null,
                    (error, items) => {
                      assert.notExists(error);
                      _assertContainsItem(items.results, publicTenant.publicDiscussion.id);

                      // Verify own user can see it
                      RestAPI.Discussions.getDiscussionsLibrary(
                        publicTenant.publicUser.restContext,
                        publicTenant.publicUser.user.id,
                        null,
                        null,
                        (error, items) => {
                          assert.notExists(error);
                          _assertContainsItem(items.results, publicTenant.publicDiscussion.id);

                          // Verify cross-tenant user can see it
                          RestAPI.Discussions.getDiscussionsLibrary(
                            publicTenant1.publicUser.restContext,
                            publicTenant.publicUser.user.id,
                            null,
                            null,
                            (error, items) => {
                              assert.notExists(error);
                              _assertContainsItem(items.results, publicTenant.publicDiscussion.id);

                              // Verify cross-tenant anonymous can see it
                              RestAPI.Discussions.getDiscussionsLibrary(
                                publicTenant1.anonymousRestContext,
                                publicTenant.publicUser.user.id,
                                null,
                                null,
                                (error, items) => {
                                  assert.notExists(error);
                                  _assertContainsItem(items.results, publicTenant.publicDiscussion.id);

                                  // Verify cross-tenant admin can see it
                                  RestAPI.Discussions.getDiscussionsLibrary(
                                    publicTenant1.adminRestContext,
                                    publicTenant.publicUser.user.id,
                                    null,
                                    null,
                                    (error, items) => {
                                      assert.notExists(error);
                                      _assertContainsItem(items.results, publicTenant.publicDiscussion.id);

                                      /// /////////////////////////////////////////////////////
                                      // VERIFY LOGGEDIN DISCUSSION VISIBILITY IN LIBRARIES //
                                      /// /////////////////////////////////////////////////////

                                      DiscussionsTestsUtil.assertUpdateDiscussionSucceeds(
                                        publicTenant.publicUser.restContext,
                                        publicTenant.publicDiscussion.id,
                                        { visibility: 'loggedin' },
                                        () => {
                                          // Verify anonymous user cannot see it
                                          RestAPI.Discussions.getDiscussionsLibrary(
                                            publicTenant.anonymousRestContext,
                                            publicTenant.publicUser.user.id,
                                            null,
                                            null,
                                            (error, items) => {
                                              assert.notExists(error);
                                              _assertDoesNotContainItem(
                                                items.results,
                                                publicTenant.publicDiscussion.id
                                              );

                                              // Verify authenticated user can see it
                                              RestAPI.Discussions.getDiscussionsLibrary(
                                                publicTenant.loggedinUser.restContext,
                                                publicTenant.publicUser.user.id,
                                                null,
                                                null,
                                                (error, items) => {
                                                  assert.notExists(error);
                                                  _assertContainsItem(items.results, publicTenant.publicDiscussion.id);

                                                  // Verify own user can see it
                                                  RestAPI.Discussions.getDiscussionsLibrary(
                                                    publicTenant.publicUser.restContext,
                                                    publicTenant.publicUser.user.id,
                                                    null,
                                                    null,
                                                    (error, items) => {
                                                      assert.notExists(error);
                                                      _assertContainsItem(
                                                        items.results,
                                                        publicTenant.publicDiscussion.id
                                                      );

                                                      // Verify cross-tenant user cannot see it
                                                      RestAPI.Discussions.getDiscussionsLibrary(
                                                        publicTenant1.publicUser.restContext,
                                                        publicTenant.publicUser.user.id,
                                                        null,
                                                        null,
                                                        (error, items) => {
                                                          assert.notExists(error);
                                                          _assertDoesNotContainItem(
                                                            items.results,
                                                            publicTenant.publicDiscussion.id
                                                          );

                                                          // Verify cross-tenant anonymous cannot see it
                                                          RestAPI.Discussions.getDiscussionsLibrary(
                                                            publicTenant1.anonymousRestContext,
                                                            publicTenant.publicUser.user.id,
                                                            null,
                                                            null,
                                                            (error, items) => {
                                                              assert.notExists(error);
                                                              _assertDoesNotContainItem(
                                                                items.results,
                                                                publicTenant.publicDiscussion.id
                                                              );

                                                              // Verify cross-tenant admin cannot see it
                                                              RestAPI.Discussions.getDiscussionsLibrary(
                                                                publicTenant1.adminRestContext,
                                                                publicTenant.publicUser.user.id,
                                                                null,
                                                                null,
                                                                (error, items) => {
                                                                  assert.notExists(error);
                                                                  _assertDoesNotContainItem(
                                                                    items.results,
                                                                    publicTenant.publicDiscussion.id
                                                                  );

                                                                  /// ////////////////////////////////////////////////////
                                                                  // VERIFY PRIVATE DISCUSSION VISIBILITY IN LIBRARIES //
                                                                  /// ////////////////////////////////////////////////////

                                                                  DiscussionsTestsUtil.assertUpdateDiscussionSucceeds(
                                                                    publicTenant.publicUser.restContext,
                                                                    publicTenant.publicDiscussion.id,
                                                                    { visibility: 'private' },
                                                                    () => {
                                                                      assert.notExists(error);

                                                                      // Verify anonymous user cannot see it
                                                                      RestAPI.Discussions.getDiscussionsLibrary(
                                                                        publicTenant.anonymousRestContext,
                                                                        publicTenant.publicUser.user.id,
                                                                        null,
                                                                        null,
                                                                        (error, items) => {
                                                                          assert.notExists(error);
                                                                          _assertDoesNotContainItem(
                                                                            items.results,
                                                                            publicTenant.publicDiscussion.id
                                                                          );
                                                                          // Verify authenticated user cannot see it
                                                                          RestAPI.Discussions.getDiscussionsLibrary(
                                                                            publicTenant.loggedinUser.restContext,
                                                                            publicTenant.publicUser.user.id,
                                                                            null,
                                                                            null,
                                                                            (error, items) => {
                                                                              assert.notExists(error);
                                                                              _assertDoesNotContainItem(
                                                                                items.results,
                                                                                publicTenant.publicDiscussion.id
                                                                              );

                                                                              // Verify own user can see it
                                                                              RestAPI.Discussions.getDiscussionsLibrary(
                                                                                publicTenant.publicUser.restContext,
                                                                                publicTenant.publicUser.user.id,
                                                                                null,
                                                                                null,
                                                                                (error, items) => {
                                                                                  assert.notExists(error);
                                                                                  _assertContainsItem(
                                                                                    items.results,
                                                                                    publicTenant.publicDiscussion.id
                                                                                  );
                                                                                  // Verify cross-tenant user cannot see it
                                                                                  RestAPI.Discussions.getDiscussionsLibrary(
                                                                                    publicTenant1.publicUser
                                                                                      .restContext,
                                                                                    publicTenant.publicUser.user.id,
                                                                                    null,
                                                                                    null,
                                                                                    (error, items) => {
                                                                                      assert.notExists(error);
                                                                                      _assertDoesNotContainItem(
                                                                                        items.results,
                                                                                        publicTenant.publicDiscussion.id
                                                                                      );

                                                                                      // Verify cross-tenant anonymous cannot see it
                                                                                      RestAPI.Discussions.getDiscussionsLibrary(
                                                                                        publicTenant1.anonymousRestContext,
                                                                                        publicTenant.publicUser.user.id,
                                                                                        null,
                                                                                        null,
                                                                                        (error, items) => {
                                                                                          assert.notExists(error);
                                                                                          _assertDoesNotContainItem(
                                                                                            items.results,
                                                                                            publicTenant
                                                                                              .publicDiscussion.id
                                                                                          );

                                                                                          // Verify cross-tenant admin cannot see it
                                                                                          RestAPI.Discussions.getDiscussionsLibrary(
                                                                                            publicTenant1.adminRestContext,
                                                                                            publicTenant.publicUser.user
                                                                                              .id,
                                                                                            null,
                                                                                            null,
                                                                                            (error, items) => {
                                                                                              assert.notExists(error);
                                                                                              _assertDoesNotContainItem(
                                                                                                items.results,
                                                                                                publicTenant
                                                                                                  .publicDiscussion.id
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
                                            }
                                          );
                                        }
                                      );
                                    }
                                  );
                                }
                              );
                            }
                          );
                        }
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
     * Verify the access privacy of discussions inside a discussion user library. Ensures discussions in libraries do not leak to users viewing
     * other user libraries.
     */
    it('verify discussion group library privacy', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant /* , publicTenant1, privateTenant, privateTenant1 */) => {
          const randomId = TestsUtil.generateTestGroupId();
          RestAPI.Group.createGroup(
            publicTenant.loggedinUser.restContext,
            randomId,
            randomId,
            'public',
            'no',
            [],
            [publicTenant.publicUser.user.id],
            (error, group) => {
              assert.notExists(error);

              // Share private, loggedin and public discussion with the group
              RestAPI.Discussions.shareDiscussion(
                publicTenant.adminRestContext,
                publicTenant.publicDiscussion.id,
                [group.id],
                (error_) => {
                  assert.notExists(error_);

                  RestAPI.Discussions.shareDiscussion(
                    publicTenant.adminRestContext,
                    publicTenant.loggedinDiscussion.id,
                    [group.id],
                    (error_) => {
                      assert.notExists(error_);

                      RestAPI.Discussions.shareDiscussion(
                        publicTenant.adminRestContext,
                        publicTenant.privateDiscussion.id,
                        [group.id],
                        (error_) => {
                          assert.notExists(error_);

                          // Verify anonymous gets public library
                          RestAPI.Discussions.getDiscussionsLibrary(
                            publicTenant.anonymousRestContext,
                            group.id,
                            null,
                            null,
                            (error, items) => {
                              assert.notExists(error);
                              assert.strictEqual(items.results.length, 1);
                              _assertContainsItem(items.results, publicTenant.publicDiscussion.id);

                              // Verify authenticated same-tenant user gets loggedin library
                              RestAPI.Discussions.getDiscussionsLibrary(
                                publicTenant.privateUser.restContext,
                                group.id,
                                null,
                                null,
                                (error, items) => {
                                  assert.notExists(error);
                                  assert.strictEqual(items.results.length, 2);
                                  _assertContainsItem(items.results, publicTenant.publicDiscussion.id);
                                  _assertContainsItem(items.results, publicTenant.loggedinDiscussion.id);

                                  // Verify member gets private library
                                  RestAPI.Discussions.getDiscussionsLibrary(
                                    publicTenant.publicUser.restContext,
                                    group.id,
                                    null,
                                    null,
                                    (error, items) => {
                                      assert.notExists(error);
                                      assert.strictEqual(items.results.length, 3);
                                      _assertContainsItem(items.results, publicTenant.publicDiscussion.id);
                                      _assertContainsItem(items.results, publicTenant.loggedinDiscussion.id);
                                      _assertContainsItem(items.results, publicTenant.privateDiscussion.id);

                                      // Verify authenticated cross-tenant user gets public library
                                      RestAPI.Discussions.getDiscussionsLibrary(
                                        publicTenant.anonymousRestContext,
                                        group.id,
                                        null,
                                        null,
                                        (error, items) => {
                                          assert.notExists(error);
                                          assert.strictEqual(items.results.length, 1);
                                          _assertContainsItem(items.results, publicTenant.publicDiscussion.id);

                                          // Verify admin gets private library
                                          RestAPI.Discussions.getDiscussionsLibrary(
                                            publicTenant.adminRestContext,
                                            group.id,
                                            null,
                                            null,
                                            (error, items) => {
                                              assert.notExists(error);
                                              assert.strictEqual(items.results.length, 3);
                                              _assertContainsItem(items.results, publicTenant.publicDiscussion.id);
                                              _assertContainsItem(items.results, publicTenant.loggedinDiscussion.id);
                                              _assertContainsItem(items.results, publicTenant.privateDiscussion.id);

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

    /**
     * Test that verifies validation logic for sharing discussions
     */
    it('verify discussion share validation', (callback) => {
      // Create users to test with
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: user1, 1: user2 } = users;

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const visibility = 'public';

        // Create discussion to test with
        RestAPI.Discussions.createDiscussion(
          user1.restContext,
          displayName,
          description,
          visibility,
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);

            // Verify cannot share with invalid discussion id
            RestAPI.Discussions.shareDiscussion(user1.restContext, 'not-a-valid-id', [user2.user.id], (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 400);

              // Verify cannoy share with no target users
              RestAPI.Discussions.shareDiscussion(user1.restContext, discussion.id, [], (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 400);

                RestAPI.Discussions.shareDiscussion(user1.restContext, discussion.id, null, (error_) => {
                  assert.ok(error_);
                  assert.strictEqual(error_.code, 400);

                  // Verify cannot share with invalid target
                  RestAPI.Discussions.shareDiscussion(
                    user1.restContext,
                    discussion.id,
                    ['not-a-valid-id'],
                    (error_) => {
                      assert.ok(error_);
                      assert.strictEqual(error_.code, 400);

                      // Sanity check
                      RestAPI.Discussions.shareDiscussion(
                        user1.restContext,
                        discussion.id,
                        [user2.user.id],
                        (error_) => {
                          assert.notExists(error_);
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

    /**
     * Verify a share cannot demote a manager
     */
    it('verify sharing a discussion cannot result in a demotion of a manager', (callback) => {
      // Create users to test with
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 3, (error, users) => {
        assert.notExists(error);
        const { 0: user1, 1: user2, 2: user3 } = users;

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const visibility = 'public';

        // Create discussion to test with
        RestAPI.Discussions.createDiscussion(
          user1.restContext,
          displayName,
          description,
          visibility,
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);

            // User2 will share with user1 who is a manager
            RestAPI.Discussions.shareDiscussion(
              user2.restContext,
              discussion.id,
              [user1.user.id, user3.user.id],
              (error_) => {
                assert.notExists(error_);

                // Ensure user1 can still update the discussion
                RestAPI.Discussions.updateDiscussion(
                  user1.restContext,
                  discussion.id,
                  { visibility: 'private' },
                  (error, discussion) => {
                    assert.notExists(error);

                    // Get the discussion members and make sure it says the user1 role is manager
                    RestAPI.Discussions.getDiscussionMembers(
                      user1.restContext,
                      discussion.id,
                      null,
                      null,
                      (error, members) => {
                        assert.notExists(error);

                        let hasUser1 = false;
                        forEach((result) => {
                          if (result.profile.id === user1.user.id) {
                            hasUser1 = true;
                            assert.strictEqual(result.role, 'manager');
                          }
                        }, members.results);

                        assert.ok(hasUser1);

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
     * Test that verifies share permissions
     */
    it('verify discussion share permissions', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant, publicTenant1, privateTenant, privateTenant1) => {
          // 1. Verify anonymous user cannot share public discussion
          RestAPI.Discussions.shareDiscussion(
            publicTenant.anonymousRestContext,
            publicTenant.publicDiscussion.id,
            [publicTenant.publicUser.user.id],
            (error) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);

              // 2. Verify authenticated user cannot share private discussion
              RestAPI.Discussions.shareDiscussion(
                publicTenant.publicUser.restContext,
                publicTenant.privateDiscussion.id,
                [publicTenant.loggedinUser.user.id],
                (error) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 401);

                  // 3. Verify authenticated user can share loggedin discussion
                  RestAPI.Discussions.shareDiscussion(
                    publicTenant.publicUser.restContext,
                    publicTenant.loggedinDiscussion.id,
                    [publicTenant.loggedinUser.user.id],
                    (error) => {
                      assert.notExists(error);

                      // 3.1 Verify it went into loggedinUser's library
                      RestAPI.Discussions.getDiscussionsLibrary(
                        publicTenant.loggedinUser.restContext,
                        publicTenant.loggedinUser.user.id,
                        null,
                        null,
                        (error, items) => {
                          assert.notExists(error);
                          assert.strictEqual(items.results.length, 1);
                          _assertContainsItem(items.results, publicTenant.loggedinDiscussion.id);

                          // 3.2 Verify loggedin user from another tenant cannot see the library from a loggedin user from another tenant
                          RestAPI.Discussions.getDiscussionsLibrary(
                            publicTenant1.loggedinUser.restContext,
                            publicTenant.loggedinUser.user.id,
                            null,
                            null,
                            (error /* , items */) => {
                              assert.strictEqual(error.code, 401);

                              // 4. Verify authenticated user cannot share loggedin discussion with public external tenant user
                              RestAPI.Discussions.shareDiscussion(
                                publicTenant.publicUser.restContext,
                                publicTenant.loggedinDiscussion.id,
                                [publicTenant1.publicUser.user.id],
                                (error_) => {
                                  assert.ok(error_);
                                  assert.strictEqual(error_.code, 401);

                                  // 4.2 Verify a user from the external tenant (publicTenant1) cannot see the loggedin item in the shared user's library, because it is loggedin from another tenant
                                  RestAPI.Discussions.getDiscussionsLibrary(
                                    publicTenant1.loggedinUser.restContext,
                                    publicTenant1.publicUser.user.id,
                                    null,
                                    null,
                                    (error, items) => {
                                      assert.notExists(error);
                                      assert.strictEqual(items.results.length, 0);

                                      // 5. Verify authenticated user cannot share loggedin discussion with private external tenant user
                                      RestAPI.Discussions.shareDiscussion(
                                        publicTenant.publicUser.restContext,
                                        publicTenant.loggedinDiscussion.id,
                                        [privateTenant.publicUser.user.id],
                                        (error_) => {
                                          assert.ok(error_);
                                          assert.strictEqual(error_.code, 401);

                                          // 6. Verify authenticated user cannot share external loggedin discussion
                                          RestAPI.Discussions.shareDiscussion(
                                            publicTenant.publicUser.restContext,
                                            publicTenant1.loggedinDiscussion.id,
                                            [publicTenant.loggedinUser.user.id],
                                            (error_) => {
                                              assert.ok(error_);
                                              assert.strictEqual(error_.code, 401);

                                              // 7. Verify authenticated user can share external public discussion
                                              RestAPI.Discussions.shareDiscussion(
                                                publicTenant.publicUser.restContext,
                                                publicTenant1.publicDiscussion.id,
                                                [publicTenant.loggedinUser.user.id],
                                                (error_) => {
                                                  assert.notExists(error_);

                                                  // 7.1 Verify it went into the user's library
                                                  RestAPI.Discussions.getDiscussionsLibrary(
                                                    publicTenant.loggedinUser.restContext,
                                                    publicTenant.loggedinUser.user.id,
                                                    null,
                                                    null,
                                                    (error, items) => {
                                                      assert.notExists(error);
                                                      assert.strictEqual(items.results.length, 2);
                                                      _assertContainsItem(
                                                        items.results,
                                                        publicTenant1.publicDiscussion.id
                                                      );

                                                      // 7.2 Verify public user from the same tenant can see the public external item in the library -- because it is public.
                                                      RestAPI.Discussions.getDiscussionsLibrary(
                                                        publicTenant.publicUser.restContext,
                                                        publicTenant.loggedinUser.user.id,
                                                        null,
                                                        null,
                                                        (error, items) => {
                                                          assert.notExists(error);
                                                          assert.strictEqual(items.results.length, 2);
                                                          _assertContainsItem(
                                                            items.results,
                                                            publicTenant.loggedinDiscussion.id
                                                          );
                                                          _assertContainsItem(
                                                            items.results,
                                                            publicTenant1.publicDiscussion.id
                                                          );

                                                          // 8. Verify authenticated user cannot share external public discussion with external public user from private tenant
                                                          RestAPI.Discussions.shareDiscussion(
                                                            publicTenant.publicUser.restContext,
                                                            privateTenant1.publicDiscussion.id,
                                                            [privateTenant1.publicUser.user.id],
                                                            (error_) => {
                                                              assert.ok(error_);
                                                              assert.strictEqual(error_.code, 401);

                                                              // 9. Verify authenticated user cannot share external public discussion from private tenant with user from their own tenant
                                                              RestAPI.Discussions.shareDiscussion(
                                                                publicTenant.publicUser.restContext,
                                                                privateTenant1.publicDiscussion.id,
                                                                [publicTenant.publicUser.user.id],
                                                                (error_) => {
                                                                  assert.ok(error_);
                                                                  assert.strictEqual(error_.code, 401);
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
    });

    /**
     * Verify input validation logic for the update members method
     */
    it('verify discussion update members validation', (callback) => {
      // Create users to test with
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: user1, 1: user2 } = users;

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const visibility = 'public';

        const user2Update = {};
        user2Update[user2.user.id] = 'member';

        // Create discussion to test with
        RestAPI.Discussions.createDiscussion(
          user1.restContext,
          displayName,
          description,
          visibility,
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);

            // Verify invalid discussion id
            RestAPI.Discussions.updateDiscussionMembers(user1.restContext, 'not-a-valid-id', user2Update, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 400);

              // Verify null update
              RestAPI.Discussions.updateDiscussionMembers(user1.restContext, discussion.id, null, (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 400);

                // Verify no updates
                RestAPI.Discussions.updateDiscussionMembers(user1.restContext, discussion.id, {}, (error_) => {
                  assert.ok(error_);
                  assert.strictEqual(error_.code, 400);

                  // Verify invalid member id
                  RestAPI.Discussions.updateDiscussionMembers(
                    user1.restContext,
                    discussion.id,
                    { 'not-a-valid-id': 'member' },
                    (error_) => {
                      assert.ok(error_);
                      assert.strictEqual(error_.code, 400);

                      // Verify invalid role
                      user2Update[user2.user.id] = 'not-a-valid-role';
                      RestAPI.Discussions.updateDiscussionMembers(
                        user1.restContext,
                        discussion.id,
                        user2Update,
                        (error_) => {
                          assert.ok(error_);
                          assert.strictEqual(error_.code, 400);

                          // Verify the user is not a member
                          user2Update[user2.user.id] = 'member';
                          RestAPI.Discussions.getDiscussionMembers(
                            user1.restContext,
                            discussion.id,
                            null,
                            null,
                            (error, members) => {
                              assert.notExists(error);
                              assert.strictEqual(members.results.length, 1);

                              // Sanity check the inputs for success
                              RestAPI.Discussions.updateDiscussionMembers(
                                user1.restContext,
                                discussion.id,
                                user2Update,
                                (error_) => {
                                  assert.notExists(error_);
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
          }
        );
      });
    });

    /**
     * Test that verifies permission rules for updating discussion permissions
     */
    it('verify discussion update members and permissions', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant, publicTenant1, privateTenant /* , privateTenant1 */) => {
          const setLoggedinUserMember = {};
          setLoggedinUserMember[publicTenant.loggedinUser.user.id] = 'member';

          const setPublicUserMember = {};
          setPublicUserMember[publicTenant.publicUser.user.id] = 'member';

          const setPublicUserManager = {};
          setPublicUserManager[publicTenant.publicUser.user.id] = 'manager';

          // 1. Verify anonymous user cannot update members
          RestAPI.Discussions.updateDiscussionMembers(
            publicTenant.anonymousRestContext,
            publicTenant.publicDiscussion.id,
            setLoggedinUserMember,
            (error) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);

              // 2. Verify loggedin non-member user cannot update members
              RestAPI.Discussions.updateDiscussionMembers(
                publicTenant.publicUser.restContext,
                publicTenant.publicDiscussion.id,
                setLoggedinUserMember,
                (error) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 401);

                  // 3. Verify member user cannot update members
                  RestAPI.Discussions.updateDiscussionMembers(
                    publicTenant.adminRestContext,
                    publicTenant.publicDiscussion.id,
                    setPublicUserMember,
                    (error) => {
                      assert.notExists(error);

                      RestAPI.Discussions.updateDiscussionMembers(
                        publicTenant.publicUser.restContext,
                        publicTenant.publicDiscussion.id,
                        setLoggedinUserMember,
                        (error) => {
                          assert.ok(error);
                          assert.strictEqual(error.code, 401);

                          // 4. Verify cannot set access across to private tenant
                          const setExternalPrivateUserMember = {};
                          setExternalPrivateUserMember[privateTenant.publicUser.id] = 'member';
                          RestAPI.Discussions.updateDiscussionMembers(
                            publicTenant.adminRestContext,
                            publicTenant.publicDiscussion.id,
                            setExternalPrivateUserMember,
                            (error) => {
                              assert.ok(error);
                              assert.strictEqual(error.code, 400);

                              // 5. Ensure the access hasn't changed
                              RestAPI.Discussions.getDiscussionMembers(
                                publicTenant.adminRestContext,
                                publicTenant.publicDiscussion.id,
                                null,
                                null,
                                (error, items) => {
                                  assert.notExists(error);
                                  assert.strictEqual(items.results.length, 2);

                                  let hadPublicUser = false;
                                  forEach((result) => {
                                    if (result.profile.id === publicTenant.publicUser.user.id) {
                                      // Ensure the public user is a member
                                      hadPublicUser = true;
                                      assert.strictEqual(result.role, 'member');
                                    }
                                  }, items.results);

                                  assert.ok(hadPublicUser);

                                  // 6. Verify manager user can update members
                                  RestAPI.Discussions.updateDiscussionMembers(
                                    publicTenant.adminRestContext,
                                    publicTenant.publicDiscussion.id,
                                    setPublicUserManager,
                                    (error_) => {
                                      assert.notExists(error_);

                                      RestAPI.Discussions.updateDiscussionMembers(
                                        publicTenant.publicUser.restContext,
                                        publicTenant.publicDiscussion.id,
                                        setLoggedinUserMember,
                                        (error_) => {
                                          assert.notExists(error_);

                                          // 7. Ensure the access has now changed
                                          RestAPI.Discussions.getDiscussionMembers(
                                            publicTenant.adminRestContext,
                                            publicTenant.publicDiscussion.id,
                                            null,
                                            null,
                                            (error, items) => {
                                              assert.notExists(error);
                                              // Tenant admin and public user are the only ones
                                              assert.strictEqual(items.results.length, 3);

                                              let hadPublicUser = false;
                                              let hadLoggedinUser = false;
                                              forEach((result) => {
                                                if (result.profile.id === publicTenant.publicUser.user.id) {
                                                  // Ensure the public user is now a manager
                                                  hadPublicUser = true;
                                                  assert.strictEqual(result.role, 'manager');
                                                } else if (result.profile.id === publicTenant.loggedinUser.user.id) {
                                                  // Ensure the loggedin user is just a member
                                                  hadLoggedinUser = true;
                                                  assert.strictEqual(result.role, 'member');
                                                }
                                              }, items.results);

                                              assert.ok(hadPublicUser);
                                              assert.ok(hadLoggedinUser);
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

    /**
     * Test that verifies logic of removing discussions from libraries, and the awkward permissions cases for the operation
     */
    it('verify discussion remove from library and permissions', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant, publicTenant1 /* , privateTenant, privateTenant1 */) => {
          // 1. Verify member can remove private discussion from their library
          RestAPI.Discussions.shareDiscussion(
            publicTenant.publicUser.restContext,
            publicTenant.loggedinDiscussion.id,
            [publicTenant.loggedinUser.user.id],
            (error) => {
              assert.notExists(error);

              // 1.1 Remove it
              RestAPI.Discussions.removeDiscussionFromLibrary(
                publicTenant.loggedinUser.restContext,
                publicTenant.loggedinUser.user.id,
                publicTenant.loggedinDiscussion.id,
                (error) => {
                  assert.notExists(error);

                  // 1.2 Make sure it isn't there
                  RestAPI.Discussions.getDiscussionsLibrary(
                    publicTenant.loggedinUser.restContext,
                    publicTenant.loggedinUser.user.id,
                    null,
                    null,
                    (error, items) => {
                      assert.notExists(error);
                      assert.strictEqual(items.results.length, 0);

                      // 2. Verify user can remove item from their library across tenant boundaries

                      // 2.1 Share an item from an external public tenant
                      RestAPI.Discussions.shareDiscussion(
                        publicTenant.publicUser.restContext,
                        publicTenant1.publicDiscussion.id,
                        [publicTenant.loggedinUser.user.id],
                        (error_) => {
                          assert.notExists(error_);

                          // 2.1 Make that tenant private
                          ConfigTestsUtil.updateConfigAndWait(
                            TestsUtil.createGlobalAdminRestContext(),
                            publicTenant1.tenant.alias,
                            { 'oae-tenants/tenantprivacy/tenantprivate': true },
                            (error_) => {
                              assert.notExists(error_);

                              // 2.2 Removes it from the library, should be able to even though the discussion's tenant has become private
                              RestAPI.Discussions.removeDiscussionFromLibrary(
                                publicTenant.loggedinUser.restContext,
                                publicTenant.loggedinUser.user.id,
                                publicTenant1.publicDiscussion.id,
                                (error_) => {
                                  assert.notExists(error_);

                                  // 2.3 Make sure it isn't there
                                  RestAPI.Discussions.getDiscussionsLibrary(
                                    publicTenant.loggedinUser.restContext,
                                    publicTenant.loggedinUser.user.id,
                                    null,
                                    null,
                                    (error, items) => {
                                      assert.notExists(error);
                                      assert.strictEqual(items.results.length, 0);

                                      // 3. Verify user cannot remove a discussion from another user's library
                                      RestAPI.Discussions.shareDiscussion(
                                        publicTenant.publicUser.restContext,
                                        publicTenant.loggedinDiscussion.id,
                                        [publicTenant.loggedinUser.user.id],
                                        (error_) => {
                                          assert.notExists(error_);

                                          // 3.1 Try and remove it with another user
                                          RestAPI.Discussions.removeDiscussionFromLibrary(
                                            publicTenant.publicUser.restContext,
                                            publicTenant.loggedinUser.user.id,
                                            publicTenant.loggedinDiscussion.id,
                                            (error_) => {
                                              assert.ok(error_);
                                              assert.strictEqual(error_.code, 401, JSON.stringify(error_));

                                              // 3.2 Make sure it is still there
                                              RestAPI.Discussions.getDiscussionsLibrary(
                                                publicTenant.loggedinUser.restContext,
                                                publicTenant.loggedinUser.user.id,
                                                null,
                                                null,
                                                (error, items) => {
                                                  assert.notExists(error);
                                                  assert.strictEqual(items.results.length, 1);
                                                  _assertContainsItem(
                                                    items.results,
                                                    publicTenant.loggedinDiscussion.id
                                                  );

                                                  const randomId = TestsUtil.generateTestGroupId();
                                                  RestAPI.Group.createGroup(
                                                    publicTenant.loggedinUser.restContext,
                                                    randomId,
                                                    randomId,
                                                    'public',
                                                    'no',
                                                    [],
                                                    [publicTenant.publicUser.user.id],
                                                    (error, group) => {
                                                      assert.notExists(error);

                                                      // Share an item with the group
                                                      RestAPI.Discussions.shareDiscussion(
                                                        publicTenant.publicUser.restContext,
                                                        publicTenant.loggedinDiscussion.id,
                                                        [group.id],
                                                        (error_) => {
                                                          assert.notExists(error_);

                                                          // Try and remove it with a member user, should fail because only managers can remove from library
                                                          RestAPI.Discussions.removeDiscussionFromLibrary(
                                                            publicTenant.publicUser.restContext,
                                                            group.id,
                                                            publicTenant.loggedinDiscussion.id,
                                                            (error_) => {
                                                              assert.ok(error_);
                                                              assert.strictEqual(error_.code, 401);

                                                              // Try and remove it with a manager user. Should succeed
                                                              RestAPI.Discussions.removeDiscussionFromLibrary(
                                                                publicTenant.loggedinUser.restContext,
                                                                group.id,
                                                                publicTenant.loggedinDiscussion.id,
                                                                (error_) => {
                                                                  assert.notExists(error_);

                                                                  // Share an item with the group again
                                                                  RestAPI.Discussions.shareDiscussion(
                                                                    publicTenant.publicUser.restContext,
                                                                    publicTenant.loggedinDiscussion.id,
                                                                    [group.id],
                                                                    (error_) => {
                                                                      assert.notExists(error_);

                                                                      // Try and remove it with a tenant admin. Should succeed again
                                                                      RestAPI.Discussions.removeDiscussionFromLibrary(
                                                                        publicTenant.adminRestContext,
                                                                        group.id,
                                                                        publicTenant.loggedinDiscussion.id,
                                                                        (error_) => {
                                                                          assert.notExists(error_);

                                                                          // Verify it complains when a user tries to remove a discussion from their library that isn't in it
                                                                          RestAPI.Discussions.removeDiscussionFromLibrary(
                                                                            publicTenant.adminRestContext,
                                                                            group.id,
                                                                            publicTenant.loggedinDiscussion.id,
                                                                            (error_) => {
                                                                              assert.ok(error_);
                                                                              assert.ok(error_.code, 400);
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

    /**
     * Test that verifies a discussion cannot be reduced to 0 manager members
     */
    it('verify discussion does not end up with 0 managers', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: user1, 1: user2 } = users;

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const visibility = 'public';

        // User1 becomes manager of discussion
        RestAPI.Discussions.createDiscussion(
          user1.restContext,
          displayName,
          description,
          visibility,
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);

            // Try and make user1 remove it from their library, they shouldn't as they are only manager
            RestAPI.Discussions.removeDiscussionFromLibrary(
              user1.restContext,
              user1.user.id,
              discussion.id,
              (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 400);

                // Try and demote user1 to member when they are the only manager
                const makeUserMember = {};
                makeUserMember[user1.user.id] = 'member';
                RestAPI.Discussions.updateDiscussionMembers(
                  asCambridgeTenantAdmin,
                  discussion.id,
                  makeUserMember,
                  (error_) => {
                    assert.ok(error_);
                    assert.strictEqual(error_.code, 400);

                    // Make user2 manager so we can test demoting user1 now
                    const makeUser2Manager = {};
                    makeUser2Manager[user2.user.id] = 'manager';
                    RestAPI.Discussions.updateDiscussionMembers(
                      user1.restContext,
                      discussion.id,
                      makeUser2Manager,
                      (error_) => {
                        assert.notExists(error_);

                        // Admin should now be able to demote user1 since there is another manager
                        RestAPI.Discussions.updateDiscussionMembers(
                          asCambridgeTenantAdmin,
                          discussion.id,
                          makeUserMember,
                          (error_) => {
                            assert.notExists(error_);
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
     * Test that verifies validation of inputs for removing a discussion from a library
     */
    it('verify remove from library validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: user } = users;

        RestAPI.Discussions.removeDiscussionFromLibrary(user.restContext, user.user.id, 'not-a-valid-id', (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, 400, JSON.stringify(error_, null, 4));

          RestAPI.Discussions.removeDiscussionFromLibrary(
            user.restContext,
            'not-a-valid-id',
            'd:cam:somenonexistent',
            (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 400);

              RestAPI.Discussions.removeDiscussionFromLibrary(
                user.restContext,
                user.user.id,
                'd:cam:somenonexistent',
                (error_) => {
                  assert.ok(error_);
                  assert.strictEqual(error_.code, 404);
                  return callback();
                }
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies library feeds are automatically repaired when there are duplicate items in the feed
     */
    it('verify library auto-repair on duplicate items', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: user } = users;

        const displayName = 'test';
        const description = 'test';
        const visibility = 'public';

        // Create 2 library items to test with
        RestAPI.Discussions.createDiscussion(
          user.restContext,
          displayName,
          description,
          visibility,
          null,
          null,
          (error, discussion1) => {
            assert.notExists(error);

            RestAPI.Discussions.createDiscussion(
              user.restContext,
              displayName,
              description,
              visibility,
              null,
              null,
              (error, discussion2) => {
                assert.notExists(error);

                // List the feed to seed the library with the given data
                RestAPI.Discussions.getDiscussionsLibrary(
                  user.restContext,
                  user.user.id,
                  null,
                  null,
                  (error, items) => {
                    assert.notExists(error);
                    assert.strictEqual(items.results.length, 2);

                    // Revert the discussion2 lastModified to over an hour ago so we can induce a duplicate
                    const oldLastModified = discussion2.lastModified - 1 * 60 * 61 * 1000;
                    DiscussionsDAO.updateDiscussion(
                      discussion2,
                      { lastModified: oldLastModified },
                      (error, discussion2) => {
                        assert.notExists(error);

                        // Post a message to force it to update the lastModified. This will cause a duplicate because we tampered with the lastModified
                        RestAPI.Discussions.createMessage(
                          user.restContext,
                          discussion2.id,
                          'My message',
                          null,
                          (error /* , message */) => {
                            assert.notExists(error);
                            LibraryAPI.Index.whenUpdatesComplete(() => {
                              /**
                               * At this point we will have 3 items in our library index. 2 for discussion2 and one for discussion1.
                               * Now we page to observe the auto-repair.
                               * Since the library update happens asynchronously to the message,
                               * we need to try several times to jam it through.
                               */

                              /*!
                               * Continue checking the library feed until the tries run out. When the feed reaches a state where it is inconsistent
                               * (i.e., a fetch of 2 items only returns 1, and there are more to fetch), then we proceed to fetch the feed until it
                               * has become consistent again (i.e., the fetch of 2 items once again returns exactly 2 items)
                               *
                               * If this fails, it means the feed has not become inconsistent. What gives?
                               *
                               * @param  {Number}     triesLeft   The number of tries to perform
                               */
                              const _checkDuplicatedFeed = function (triesLeft) {
                                if (triesLeft === 0) {
                                  // Fail if we have run out of tries
                                  assert.fail('The library did not incur a duplicate within a certain amount of tries');
                                }

                                // The first time, we set a limit 2, we should end up with only 1. Because the one duplicate was filtered out
                                RestAPI.Discussions.getDiscussionsLibrary(
                                  user.restContext,
                                  user.user.id,
                                  null,
                                  2,
                                  (error, items) => {
                                    assert.notExists(error);

                                    try {
                                      assert.strictEqual(items.results.length, 1);
                                      _assertContainsItem(items.results, discussion2.id);

                                      // NextToken should be there because there was still 1 item to page through (discussion1)
                                      assert.ok(items.nextToken);

                                      // We fetch an inconsistent feed, this is good. This fetch, since it was inconsistent should have
                                      // triggered a repair. Now check the feed until it has been repaired
                                      return _checkRepairedFeed(10);
                                    } catch {
                                      return setTimeout(_checkDuplicatedFeed, 50, triesLeft - 1);
                                    }
                                  }
                                );
                              };

                              /*!
                               * Continue checking the library feed until it comes consistent.
                               *
                               * If this fails, it means the feed never returned to be consistent. What gives?
                               *
                               * @param  {Number}     triesLeft   The number of tries to perform
                               */
                              const _checkRepairedFeed = function (triesLeft) {
                                if (triesLeft === 0) {
                                  assert.fail(
                                    'The library feed was not auto-repaired within a certain amount of tries.'
                                  );
                                }

                                triesLeft--;

                                RestAPI.Discussions.getDiscussionsLibrary(
                                  user.restContext,
                                  user.user.id,
                                  null,
                                  2,
                                  (error, items) => {
                                    assert.notExists(error);

                                    try {
                                      assert.strictEqual(items.results.length, 2);
                                      _assertContainsItem(items.results, discussion2.id);
                                      _assertContainsItem(items.results, discussion1.id);

                                      // Everything checked out, continue on with the tests!
                                      return callback();
                                    } catch {
                                      // Not in the right state yet. Try again
                                      return _checkRepairedFeed(triesLeft);
                                    }
                                  }
                                );
                              };

                              // Start the check for an inconsistent feed
                              _checkDuplicatedFeed(100);
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
  });

  describe('Messages', () => {
    /**
     * Test that verifies input validation when creating a message
     */
    it('verify message creation validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: user1 } = users;

        const displayName = 'test-create-displayName';
        const description = 'test-create-description';
        const visibility = 'public';

        // Create discussion to test with
        RestAPI.Discussions.createDiscussion(
          user1.restContext,
          displayName,
          description,
          visibility,
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);

            // Test invalid discussion id
            RestAPI.Discussions.createMessage(
              user1.restContext,
              'not-a-valid-id',
              'This should result in a 400',
              null,
              (error, message) => {
                assert.ok(error);
                assert.strictEqual(error.code, 400);
                assert.ok(!message);

                // Test no body
                RestAPI.Discussions.createMessage(user1.restContext, discussion.id, null, null, (error, message) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 400);
                  assert.ok(!message);

                  // Test invalid reply-to timestamp
                  RestAPI.Discussions.createMessage(
                    user1.restContext,
                    discussion.id,
                    'This should result in a 400',
                    'NaN',
                    (error, message) => {
                      assert.ok(error);
                      assert.strictEqual(error.code, 400);
                      assert.ok(!message);

                      // Test non-existing reply-to timestamp
                      RestAPI.Discussions.createMessage(
                        user1.restContext,
                        discussion.id,
                        'This should result in a 400',
                        Date.now(),
                        (error, message) => {
                          assert.ok(error);
                          assert.strictEqual(error.code, 400);
                          assert.ok(!message);

                          // Test a body that is longer than the maximum allowed size
                          const body = TestsUtil.generateRandomText(10000);
                          RestAPI.Discussions.createMessage(
                            user1.restContext,
                            discussion.id,
                            body,
                            null,
                            (error, message) => {
                              assert.ok(error);
                              assert.strictEqual(error.code, 400);
                              assert.ok(!message);

                              // Sanity check
                              RestAPI.Discussions.createMessage(
                                user1.restContext,
                                discussion.id,
                                'This should be ok',
                                null,
                                (error, message) => {
                                  assert.notExists(error);
                                  assert.ok(message);
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

    /**
     * Test that verifies the model of created messages, and permissions of creating messages on different types of discussions
     */
    it('verify creating a message, model and permissions', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant, publicTenant1, privateTenant /* , privateTenant1 */) => {
          // Cannot post message as anonymous user
          RestAPI.Discussions.createMessage(
            publicTenant.anonymousRestContext,
            publicTenant.publicDiscussion.id,
            'This should result in a 401',
            null,
            (error, message) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);
              assert.ok(!message);

              // Cannot post to private discussion as non-member
              RestAPI.Discussions.createMessage(
                publicTenant.privateUser.restContext,
                publicTenant.privateDiscussion.id,
                'This should result in a 401',
                null,
                (error, message) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 401);
                  assert.ok(!message);

                  // Can post as an authenticated user from the same tenant, verify the model
                  RestAPI.Discussions.createMessage(
                    publicTenant.publicUser.restContext,
                    publicTenant.publicDiscussion.id,
                    'Top-level message',
                    null,
                    (error, message) => {
                      assert.notExists(error);
                      assert.ok(message);

                      // This is the expected messagebox id of the discussion
                      const messageBoxId = publicTenant.publicDiscussion.id;

                      assert.strictEqual(message.id, messageBoxId + '#' + message.created);
                      assert.strictEqual(message.messageBoxId, messageBoxId);
                      assert.strictEqual(message.threadKey, message.created + '|');
                      assert.strictEqual(message.body, 'Top-level message');
                      assert.strictEqual(message.createdBy.id, publicTenant.publicUser.user.id);
                      assert.notStrictEqual(Number.parseInt(message.created, 10), Number.NaN);
                      assert.strictEqual(message.level, 0);
                      assert.ok(!message.replyTo);

                      // Reply to that message and verify the model
                      RestAPI.Discussions.createMessage(
                        publicTenant.loggedinUser.restContext,
                        publicTenant.publicDiscussion.id,
                        'Reply message',
                        message.created,
                        (error, replyMessage) => {
                          assert.notExists(error);
                          assert.ok(replyMessage);

                          // This is the expected replyMessagebox id of the discussion
                          assert.strictEqual(replyMessage.id, messageBoxId + '#' + replyMessage.created);
                          assert.strictEqual(replyMessage.messageBoxId, messageBoxId);
                          assert.strictEqual(
                            replyMessage.threadKey,
                            message.created + '#' + replyMessage.created + '|'
                          );
                          assert.strictEqual(replyMessage.body, 'Reply message');
                          assert.strictEqual(replyMessage.createdBy.id, publicTenant.loggedinUser.user.id);
                          assert.notStrictEqual(Number.parseInt(replyMessage.created, 10), Number.NaN);
                          assert.strictEqual(replyMessage.level, 1);
                          assert.ok(replyMessage.replyTo, message.created);

                          // Cross-tenant user from public tenant can post to a public discussion
                          RestAPI.Discussions.createMessage(
                            publicTenant1.publicUser.restContext,
                            publicTenant.publicDiscussion.id,
                            'Message from external user',
                            null,
                            (error, message) => {
                              assert.notExists(error);
                              assert.ok(message);

                              // Cross-tenant user from public tenant cannot post to a loggedin discussion
                              RestAPI.Discussions.createMessage(
                                publicTenant1.publicUser.restContext,
                                publicTenant.loggedinDiscussion.id,
                                'Message from external user',
                                null,
                                (error, message) => {
                                  assert.ok(error);
                                  assert.ok(error.code, 401);
                                  assert.ok(!message);

                                  // Cross-tenant user from private tenant cannot post to a public discussion
                                  RestAPI.Discussions.createMessage(
                                    privateTenant.publicUser.restContext,
                                    publicTenant.publicDiscussion.id,
                                    'Message from external user',
                                    null,
                                    (error, message) => {
                                      assert.ok(error);
                                      assert.ok(error.code, 401);
                                      assert.ok(!message);

                                      // Cross-tenant admin cannot post to a loggedin discussion
                                      RestAPI.Discussions.createMessage(
                                        publicTenant1.adminRestContext,
                                        publicTenant.loggedinDiscussion.id,
                                        'Message from external user',
                                        null,
                                        (error, message) => {
                                          assert.ok(error);
                                          assert.ok(error.code, 401);
                                          assert.ok(!message);

                                          // Can post to private discussion as a member. Share it, then test creating a message
                                          RestAPI.Discussions.shareDiscussion(
                                            publicTenant.adminRestContext,
                                            publicTenant.privateDiscussion.id,
                                            [publicTenant.privateUser.user.id],
                                            (error_) => {
                                              assert.notExists(error_);

                                              RestAPI.Discussions.createMessage(
                                                publicTenant.privateUser.restContext,
                                                publicTenant.privateDiscussion.id,
                                                'Message from member',
                                                null,
                                                (error, message) => {
                                                  assert.notExists(error);
                                                  assert.ok(message);

                                                  // Can post to discussion as admin
                                                  RestAPI.Discussions.createMessage(
                                                    publicTenant.adminRestContext,
                                                    publicTenant.privateDiscussion.id,
                                                    'Message from admin',
                                                    null,
                                                    (error, message) => {
                                                      assert.notExists(error);
                                                      assert.ok(message);
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

    /**
     * Test that verifies that messages contain user profile pictures
     */
    it('verify messages contain user profile pictures', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: bert, 1: nicolaas } = users;

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
        RestAPI.User.uploadPicture(bert.restContext, bert.user.id, getPictureStream, cropArea, (error_) => {
          assert.notExists(error_);

          // Create a discussion and share it with a user that has no profile picture
          RestAPI.Discussions.createDiscussion(
            bert.restContext,
            'displayName',
            'description',
            'public',
            null,
            [nicolaas.user.id],
            (error, discussion) => {
              assert.notExists(error);

              // Add a message to the discussion as a user with a profile picture
              RestAPI.Discussions.createMessage(
                bert.restContext,
                discussion.id,
                'Message body 1',
                null,
                (error, message) => {
                  assert.notExists(error);

                  // Assert that the picture URLs are present
                  assert.ok(message.createdBy);
                  assert.ok(message.createdBy.picture);
                  assert.ok(message.createdBy.picture.small);
                  assert.ok(message.createdBy.picture.medium);
                  assert.ok(message.createdBy.picture.large);

                  // Assert that this works for replies as well
                  RestAPI.Discussions.createMessage(
                    bert.restContext,
                    discussion.id,
                    'Message body 2',
                    message.created,
                    (error, reply) => {
                      assert.notExists(error);

                      // Assert that no picture URLs are present
                      assert.ok(reply.createdBy);
                      assert.ok(reply.createdBy.picture);
                      assert.ok(reply.createdBy.picture.small);
                      assert.ok(reply.createdBy.picture.medium);
                      assert.ok(reply.createdBy.picture.large);

                      // Add a message to the discussion as a user with no profile picture
                      RestAPI.Discussions.createMessage(
                        nicolaas.restContext,
                        discussion.id,
                        'Message body 3',
                        null,
                        (error, message) => {
                          assert.notExists(error);

                          // Assert that no picture URLs are present
                          assert.ok(message.createdBy);
                          assert.ok(message.createdBy.picture);
                          assert.ok(!message.createdBy.picture.small);
                          assert.ok(!message.createdBy.picture.medium);
                          assert.ok(!message.createdBy.picture.large);

                          // Assert that this works for replies as well
                          RestAPI.Discussions.createMessage(
                            nicolaas.restContext,
                            discussion.id,
                            'Message body 4',
                            message.created,
                            (error, reply) => {
                              assert.notExists(error);

                              // Assert that no picture URLs are present
                              assert.ok(reply.createdBy);
                              assert.ok(reply.createdBy.picture);
                              assert.ok(!reply.createdBy.picture.small);
                              assert.ok(!reply.createdBy.picture.medium);
                              assert.ok(!reply.createdBy.picture.large);

                              // Assert the profile picture urls are present when retrieving a list of messages
                              RestAPI.Discussions.getMessages(
                                bert.restContext,
                                discussion.id,
                                null,
                                10,
                                (error, messages) => {
                                  assert.notExists(error);
                                  assert.strictEqual(messages.results.length, 4);
                                  forEach((message) => {
                                    assert.ok(message.createdBy);
                                    assert.ok(message.createdBy.picture);
                                    // Verify that the messages have a picture for the user that has a profile picture
                                    if (message.createdBy.id === bert.user.id) {
                                      assert.ok(message.createdBy.picture.small);
                                      assert.ok(message.createdBy.picture.medium);
                                      assert.ok(message.createdBy.picture.large);
                                      // Verify that the messages don't have a picture for the user without a profile picture
                                    } else if (message.createdBy.id === nicolaas.user.id) {
                                      assert.ok(!message.createdBy.picture.small);
                                      assert.ok(!message.createdBy.picture.medium);
                                      assert.ok(!message.createdBy.picture.large);
                                    } else {
                                      assert.fail('Unexpected user in messages');
                                    }
                                  }, messages.results);
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
     * Test that verifies a discussion is updated at most every hour as a result of new message postings
     */
    it('verify discussion update threshold with messages', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: user } = users;

        const displayName = 'test';
        const description = 'test';
        const visibility = 'public';

        // Create a discussion to test with
        RestAPI.Discussions.createDiscussion(
          user.restContext,
          displayName,
          description,
          visibility,
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);

            const lastModified1 = discussion.lastModified;

            // Create a discussion to test with
            RestAPI.Discussions.createMessage(
              user.restContext,
              discussion.id,
              'My message',
              null,
              (error /* , message */) => {
                assert.notExists(error);

                // Ensure lastModified didn't change because it is within the one hour threshold (hopefully)
                RestAPI.Discussions.getDiscussion(user.restContext, discussion.id, (error, discussion) => {
                  assert.notExists(error);
                  assert.strictEqual(discussion.lastModified, lastModified1);

                  // Force a naughty update through the DAO of the lastModified to more than an hour ago (threshold duration)
                  const lastModified0 = lastModified1 - 1 * 60 * 61 * 1000;
                  DiscussionsDAO.updateDiscussion(discussion, { lastModified: lastModified0 }, (error, discussion) => {
                    assert.notExists(error);
                    assert.strictEqual(discussion.lastModified, lastModified0);

                    // Message again, this time the lastModified should update
                    RestAPI.Discussions.createMessage(
                      user.restContext,
                      discussion.id,
                      'My message',
                      null,
                      (error /* , message */) => {
                        assert.notExists(error);

                        // Ensure the new lastModified is greater than the original creation one
                        setTimeout(
                          RestAPI.Discussions.getDiscussion,
                          200,
                          user.restContext,
                          discussion.id,
                          (error, discussion) => {
                            assert.notExists(error);
                            assert.ok(
                              Number.parseInt(discussion.lastModified, 10) > Number.parseInt(lastModified1, 10)
                            );

                            // Note at this time, since the lastModified of the discussion updated under the hood without
                            // a library update, the library of user should 2 versions of this discussion. Lets see if it
                            // auto-repairs

                            // Make sure the library does not have a duplicate
                            RestAPI.Discussions.getDiscussionsLibrary(
                              user.restContext,
                              user.user.id,
                              null,
                              null,
                              (error, items) => {
                                assert.notExists(error);
                                assert.strictEqual(items.results.length, 1);
                                return callback();
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
      });
    });

    /**
     * Test that verifies input validation of listing messages from a discussion
     */
    it('verify list messages validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: user } = users;

        const displayName = 'test';
        const description = 'test';
        const visibility = 'public';

        // Create a discussion to test with
        RestAPI.Discussions.createDiscussion(
          user.restContext,
          displayName,
          description,
          visibility,
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);

            // Validate invalid discussion id
            RestAPI.Discussions.getMessages(
              user.restContext,
              'not-a-valid-id',
              null,
              null,
              (error /* , messages */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 400);

                // Validate invalid limit
                // It should default to 10 messages
                RestAPI.Discussions.getMessages(
                  user.restContext,
                  discussion.id,
                  null,
                  'not-a-valid-limit',
                  (error, messages) => {
                    assert.notExists(error);
                    assert.ok(messages);

                    // Sanity check
                    RestAPI.Discussions.getMessages(user.restContext, discussion.id, null, null, (error, messages) => {
                      assert.notExists(error);
                      assert.ok(messages);
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

    /**
     * Test that verifies the model of messages, and permissions for accessing them
     */
    it('verify listing messages, model and permissions', (callback) => {
      /*!
       * Ensure that the message model is correct between the message to test and the message against which to test.
       *
       * @param  {Message}    messageToTest           The message to test
       * @param  {Message}    messageToTestAgainst    The message against which to test
       * @param  {User}       creatorToTestAgainst    The user data (i.e., `createdBy`) to test against for the message creator
       * @param  {Boolean}    userScrubbed            Whether or not the createdBy field should have scrubbed user data
       * @throws {Error}                              Throws an assertion error if the data fails assertions
       */
      const _assertMessageModel = function (messageToTest, messageToTestAgainst, creatorToTestAgainst, userScrubbed) {
        // Verify message model
        assert.strictEqual(messageToTest.id, messageToTestAgainst.id);
        assert.strictEqual(messageToTest.messageBoxId, messageToTestAgainst.messageBoxId);
        assert.strictEqual(messageToTest.threadKey, messageToTestAgainst.threadKey);
        assert.strictEqual(messageToTest.body, messageToTestAgainst.body);
        assert.strictEqual(messageToTest.created, messageToTestAgainst.created);
        assert.strictEqual(messageToTest.level, messageToTestAgainst.level);
        assert.strictEqual(messageToTest.replyTo, messageToTestAgainst.replyTo);

        // Verify creator model
        assert.ok(messageToTest.createdBy);
        assert.strictEqual(messageToTest.createdBy.tenant.alias, creatorToTestAgainst.tenant.alias);
        assert.strictEqual(messageToTest.createdBy.tenant.displayName, creatorToTestAgainst.tenant.displayName);
        assert.strictEqual(messageToTest.createdBy.visibility, creatorToTestAgainst.visibility);

        // Privacy check
        if (userScrubbed) {
          assert.strictEqual(messageToTest.createdBy.displayName, creatorToTestAgainst.publicAlias);
        } else {
          assert.strictEqual(messageToTest.createdBy.displayName, creatorToTestAgainst.displayName);
        }
      };

      // Set up the tenants for tenant privacy rule checking
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant /* , publicTenant1, privateTenant, privateTenant1 */) => {
          // Create message structure on the public discussion
          RestAPI.Discussions.createMessage(
            publicTenant.loggedinUser.restContext,
            publicTenant.publicDiscussion.id,
            'Message1 parent on public',
            null,
            (error, publicMessage1) => {
              assert.notExists(error);

              RestAPI.Discussions.createMessage(
                publicTenant.loggedinUser.restContext,
                publicTenant.publicDiscussion.id,
                'Message1 reply on public',
                publicMessage1.created,
                (error, replyPublicMessage1) => {
                  assert.notExists(error);

                  RestAPI.Discussions.createMessage(
                    publicTenant.loggedinUser.restContext,
                    publicTenant.publicDiscussion.id,
                    'Message2 parent on public',
                    null,
                    (error, publicMessage2) => {
                      assert.notExists(error);

                      // Create message on the loggedin discussion
                      RestAPI.Discussions.createMessage(
                        publicTenant.loggedinUser.restContext,
                        publicTenant.loggedinDiscussion.id,
                        'Message on loggedin',
                        null,
                        (error, loggedinMessage) => {
                          assert.notExists(error);

                          // Share and post message on the private discussion
                          RestAPI.Discussions.shareDiscussion(
                            publicTenant.adminRestContext,
                            publicTenant.privateDiscussion.id,
                            [publicTenant.privateUser.user.id],
                            (error_) => {
                              assert.notExists(error_);

                              RestAPI.Discussions.createMessage(
                                publicTenant.privateUser.restContext,
                                publicTenant.privateDiscussion.id,
                                'Message on private',
                                null,
                                (error, privateMessage) => {
                                  assert.notExists(error);

                                  // Anonymous can read on public, but not loggedin or private
                                  RestAPI.Discussions.getMessages(
                                    publicTenant.anonymousRestContext,
                                    publicTenant.publicDiscussion.id,
                                    null,
                                    null,
                                    (error, messages) => {
                                      assert.notExists(error);
                                      assert.ok(messages);
                                      assert.strictEqual(messages.results.length, 3);

                                      // Verify the model of all 3 messages
                                      _assertMessageModel(
                                        messages.results[0],
                                        publicMessage2,
                                        publicTenant.loggedinUser.user,
                                        true
                                      );
                                      _assertMessageModel(
                                        messages.results[1],
                                        publicMessage1,
                                        publicTenant.loggedinUser.user,
                                        true
                                      );
                                      _assertMessageModel(
                                        messages.results[2],
                                        replyPublicMessage1,
                                        publicTenant.loggedinUser.user,
                                        true
                                      );

                                      RestAPI.Discussions.getMessages(
                                        publicTenant.anonymousRestContext,
                                        publicTenant.loggedinDiscussion.id,
                                        null,
                                        null,
                                        (error, messages) => {
                                          assert.ok(error);
                                          assert.ok(error.code, 401);
                                          assert.ok(!messages);

                                          RestAPI.Discussions.getMessages(
                                            publicTenant.anonymousRestContext,
                                            publicTenant.privateDiscussion.id,
                                            null,
                                            null,
                                            (error, messages) => {
                                              assert.ok(error);
                                              assert.ok(error.code, 401);
                                              assert.ok(!messages);

                                              // Authenticated user can read loggedin
                                              RestAPI.Discussions.getMessages(
                                                publicTenant.publicUser.restContext,
                                                publicTenant.loggedinDiscussion.id,
                                                null,
                                                null,
                                                (error, messages) => {
                                                  assert.notExists(error);
                                                  assert.ok(messages);
                                                  assert.strictEqual(messages.results.length, 1);

                                                  // Verify the model of the message, the loggedin user should not be scrubbed
                                                  _assertMessageModel(
                                                    messages.results[0],
                                                    loggedinMessage,
                                                    publicTenant.loggedinUser.user,
                                                    false
                                                  );

                                                  // Authenticated user cannot read private
                                                  RestAPI.Discussions.getMessages(
                                                    publicTenant.publicUser.restContext,
                                                    publicTenant.privateDiscussion.id,
                                                    null,
                                                    null,
                                                    (error, messages) => {
                                                      assert.ok(error);
                                                      assert.ok(error.code, 401);
                                                      assert.ok(!messages);

                                                      // Member user can read private
                                                      RestAPI.Discussions.getMessages(
                                                        publicTenant.privateUser.restContext,
                                                        publicTenant.privateDiscussion.id,
                                                        null,
                                                        null,
                                                        (error, messages) => {
                                                          assert.notExists(error);
                                                          assert.ok(messages);
                                                          assert.strictEqual(messages.results.length, 1);

                                                          // Verify the model of the message, the loggedin user should not be scrubbed
                                                          _assertMessageModel(
                                                            messages.results[0],
                                                            privateMessage,
                                                            publicTenant.privateUser.user,
                                                            false
                                                          );

                                                          // Ensure paging of the messages

                                                          // Get the first two only
                                                          RestAPI.Discussions.getMessages(
                                                            publicTenant.anonymousRestContext,
                                                            publicTenant.publicDiscussion.id,
                                                            null,
                                                            2,
                                                            (error, messages) => {
                                                              assert.notExists(error);
                                                              assert.ok(messages);
                                                              assert.strictEqual(
                                                                messages.nextToken,
                                                                messages.results[1].threadKey
                                                              );

                                                              assert.strictEqual(messages.results.length, 2);

                                                              // Verify the model and ordering of the messages
                                                              _assertMessageModel(
                                                                messages.results[0],
                                                                publicMessage2,
                                                                publicTenant.loggedinUser.user,
                                                                true
                                                              );
                                                              _assertMessageModel(
                                                                messages.results[1],
                                                                publicMessage1,
                                                                publicTenant.loggedinUser.user,
                                                                true
                                                              );

                                                              // Try and get 2 more. Should only get 1 and it should be the 3rd message
                                                              RestAPI.Discussions.getMessages(
                                                                publicTenant.anonymousRestContext,
                                                                publicTenant.publicDiscussion.id,
                                                                publicMessage1.threadKey,
                                                                2,
                                                                (error, messages) => {
                                                                  assert.notExists(error);
                                                                  assert.ok(messages);
                                                                  assert.strictEqual(messages.results.length, 1);
                                                                  assert.ok(!messages.nextToken);

                                                                  // Verify the model and ordering of the messages
                                                                  _assertMessageModel(
                                                                    messages.results[0],
                                                                    replyPublicMessage1,
                                                                    publicTenant.loggedinUser.user,
                                                                    true
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
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies input validation of deleting messages from a discussion
     */
    it('verify delete message validation', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: user } = users;

        const displayName = 'test';
        const description = 'test';
        const visibility = 'public';

        // Create a discussion to test with
        RestAPI.Discussions.createDiscussion(
          user.restContext,
          displayName,
          description,
          visibility,
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);

            // Create message on the discussion to delete
            RestAPI.Discussions.createMessage(user.restContext, discussion.id, 'a message', null, (error, message) => {
              assert.notExists(error);

              // Validate invalid discussion id
              RestAPI.Discussions.deleteMessage(user.restContext, 'not-an-id', message.created, (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 400);

                // Validate invalid timestamp
                RestAPI.Discussions.deleteMessage(user.restContext, discussion.id, 'invalid-created', (error_) => {
                  assert.ok(error_);
                  assert.strictEqual(error_.code, 400);

                  // Sanity check input
                  RestAPI.Discussions.deleteMessage(user.restContext, discussion.id, message.created, (error_) => {
                    assert.notExists(error_);
                    return callback();
                  });
                });
              });
            });
          }
        );
      });
    });

    /*!
     * Ensure that deleting messages works as expected with the given tenant, users and discussion
     *
     * @param  {Object}         tenant          The tenant info object for the tenant under which the test occurs
     * @param  {Object}         managerUser     The user info object (as per DiscussionsTestsUtil#setupMultiTenantPrivacyEntities) for the user who will act as the manager of the discussion
     * @param  {Object}         memberUser      The user info object (as per DiscussionsTestsUtil#setupMultiTenantPrivacyEntities) for the user who will act as the member of the discussion
     * @param  {Object}         nonMemberUser   The user info object (as per DiscussionsTestsUtil#setupMultiTenantPrivacyEntities) for the user who will not be explicitly associated to the discussion, but will be authenticated to the tenant
     * @param  {Discussion}     discussion      The discussion against which to create and delete messages, verifying the expected outcomes
     * @param  {Function}       callback        Invoked when all assertions have passed
     * @throws {AssertionError}                 Thrown if any of the assertions failed while creating and deleting messages
     */
    const _assertDeleteMessagePermissions = function (
      tenant,
      managerUser,
      memberUser,
      nonMemberUser,
      discussion,
      callback
    ) {
      // Add the manager and member users to the discussion
      const updates = {};
      updates[managerUser.user.id] = 'manager';
      updates[memberUser.user.id] = 'member';
      RestAPI.Discussions.updateDiscussionMembers(tenant.adminRestContext, discussion.id, updates, (error) => {
        assert.notExists(error);

        // Create a message structure on the discussion
        RestAPI.Discussions.createMessage(
          memberUser.restContext,
          discussion.id,
          'Message1 parent on public',
          null,
          (error, message1) => {
            assert.notExists(error);

            RestAPI.Discussions.createMessage(
              memberUser.restContext,
              discussion.id,
              'Message1 reply on public',
              message1.created,
              (error, replyMessage1) => {
                assert.notExists(error);

                RestAPI.Discussions.createMessage(
                  memberUser.restContext,
                  discussion.id,
                  'Message2 parent on public',
                  null,
                  (error, message2) => {
                    assert.notExists(error);

                    // Verify that anonymous cannot delete a message
                    RestAPI.Discussions.deleteMessage(
                      tenant.anonymousRestContext,
                      discussion.id,
                      message1.created,
                      (error, message) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 401);
                        assert.ok(!message);

                        // Verify that a non-manager and non-creator user can't delete a message
                        RestAPI.Discussions.deleteMessage(
                          nonMemberUser.restContext,
                          discussion.id,
                          message1.created,
                          (error, message) => {
                            assert.ok(error);
                            assert.strictEqual(error.code, 401);
                            assert.ok(!message);

                            // Verify that a manager can delete the message, also verify that the parent message is soft-deleted and its resulting model
                            RestAPI.Discussions.deleteMessage(
                              managerUser.restContext,
                              discussion.id,
                              message1.created,
                              (error, message) => {
                                assert.notExists(error);
                                assert.ok(message);

                                // Ensure the deleted message model
                                assert.strictEqual(message.id, message1.id);
                                assert.strictEqual(message.messageBoxId, message1.messageBoxId);
                                assert.strictEqual(message.threadKey, message1.threadKey);
                                assert.strictEqual(message.created, message1.created);
                                assert.strictEqual(message.replyTo, message1.replyTo);
                                assert.notStrictEqual(Number.parseInt(message.deleted, 10), Number.NaN);
                                assert.ok(Number.parseInt(message.deleted, 10) > Number.parseInt(message.created, 10));
                                assert.strictEqual(message.level, message1.level);
                                assert.ok(!message.body);
                                assert.ok(!message.createdBy);

                                // Ensure the deleted message is in the list of messages still, but deleted
                                RestAPI.Discussions.getMessages(
                                  managerUser.restContext,
                                  discussion.id,
                                  null,
                                  null,
                                  (error, items) => {
                                    assert.notExists(error);
                                    assert.ok(items.results.length, 3);

                                    const message = items.results[1];
                                    assert.strictEqual(message.id, message1.id);
                                    assert.strictEqual(message.messageBoxId, message1.messageBoxId);
                                    assert.strictEqual(message.threadKey, message1.threadKey);
                                    assert.strictEqual(message.created, message1.created);
                                    assert.strictEqual(message.replyTo, message1.replyTo);
                                    assert.notStrictEqual(Number.parseInt(message.deleted, 10), Number.NaN);
                                    assert.ok(
                                      Number.parseInt(message.deleted, 10) > Number.parseInt(message.created, 10)
                                    );
                                    assert.strictEqual(message.level, message1.level);
                                    assert.ok(!message.body);
                                    assert.ok(!message.createdBy);

                                    // Delete the rest of the messages to test hard-deletes. This also tests owner can delete
                                    RestAPI.Discussions.deleteMessage(
                                      memberUser.restContext,
                                      discussion.id,
                                      replyMessage1.created,
                                      (error, message) => {
                                        assert.notExists(error);
                                        assert.ok(!message);

                                        // We re-delete this one, but it should actually do a hard delete this time as there are no children
                                        RestAPI.Discussions.deleteMessage(
                                          memberUser.restContext,
                                          discussion.id,
                                          message1.created,
                                          (error, message) => {
                                            assert.notExists(error);
                                            assert.ok(!message);

                                            // Perform a hard-delete on this leaf message. This also tests admins can delete
                                            RestAPI.Discussions.deleteMessage(
                                              tenant.adminRestContext,
                                              discussion.id,
                                              message2.created,
                                              (error, message) => {
                                                assert.notExists(error);
                                                assert.ok(!message);

                                                // There should be no more messages in the discussion as they should have all been de-indexed by hard deletes
                                                RestAPI.Discussions.getMessages(
                                                  managerUser.restContext,
                                                  discussion.id,
                                                  null,
                                                  null,
                                                  (error, items) => {
                                                    assert.notExists(error);
                                                    assert.ok(items);
                                                    assert.strictEqual(items.results.length, 0);
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
      });
    };

    /**
     * Test that verifies the logic of deleting messages, and the model and permissions for the operation
     */
    it('verify deleting discussion messages, model and permissions', (callback) => {
      DiscussionsTestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant /* , publicTenant1, privateTenant, privateTenant1 */) => {
          // Ensure permissions for deleting a message of a public discussion
          _assertDeleteMessagePermissions(
            publicTenant,
            publicTenant.privateUser,
            publicTenant.loggedinUser,
            publicTenant.publicUser,
            publicTenant.publicDiscussion,
            () => {
              // Ensure permissions for deleting a message of a loggedin discussion
              _assertDeleteMessagePermissions(
                publicTenant,
                publicTenant.privateUser,
                publicTenant.loggedinUser,
                publicTenant.publicUser,
                publicTenant.loggedinDiscussion,
                () => {
                  // Ensure permissions for deleting a message of a private discussion
                  return _assertDeleteMessagePermissions(
                    publicTenant,
                    publicTenant.privateUser,
                    publicTenant.loggedinUser,
                    publicTenant.publicUser,
                    publicTenant.privateDiscussion,
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
