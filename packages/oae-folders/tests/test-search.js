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

import * as RestAPI from 'oae-rest';
import * as SearchTestsUtil from 'oae-search/lib/test/util';
import * as TestsUtil from 'oae-tests';
import * as FoldersAPI from 'oae-folders';
import * as FoldersDAO from 'oae-folders/lib/internal/dao';
import * as FoldersTestUtil from 'oae-folders/lib/test/util';
import { FoldersConstants } from 'oae-folders/lib/constants';

const PUBLIC = 'public';
const PRIVATE = 'private';
const LOGGED_IN = 'loggedin';

describe('Folders', () => {
  let camAdminRestContext = null;
  let camAnonymousRestContext = null;
  let globalAdminRestContext = null;
  let gtAdminRestContext = null;
  let gtAnonymousRestContext = null;

  /*!
   * Set up all the REST contexts for admin and anonymous users with which we
   * will invoke requests
   */
  before(callback => {
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    camAnonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    gtAnonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.gt.host);
    return callback();
  });

  /**
   * Set up some tenants, users and content. The created content
   * will be placed in a new folder with the given visibility.
   *
   * @param  {String}             visibility                  The visibility of the created folder
   * @param  {Function}           callback                    Standard callback function
   * @param  {Object}             callback.simong             A user object who created the folder and content items as returned by `TestsUtil.generateTestUsers`
   * @param  {Folder}             callback.folder             The created folder
   * @param  {Content}            callback.publicContent      A public content item
   * @param  {Content}            callback.loggedinContent    A loggedin content item
   * @param  {Content}            callback.privateContent     A private content item
   * @param  {Tenant}             callback.publicTenant1      Tenant object as returned by `foldersTestUtil.setupMultiTenantPrivacyEntities`
   * @param  {Tenant}             callback.publicTenant2      Tenant object as returned by `foldersTestUtil.setupMultiTenantPrivacyEntities`
   * @param  {Tenant}             callback.privateTenant      Tenant object as returned by `foldersTestUtil.setupMultiTenantPrivacyEntities`
   * @param  {Tenant}             callback.privateTenant1     Tenant object as returned by `foldersTestUtil.setupMultiTenantPrivacyEntities`
   * @param  {Object}             callback.user               A user as returned by `TestsUtil.generateTestUsers` who will create the folder
   * @throws {AssertionError}                                 Throws an error if anything unexpected happens when setting up the entities
   */
  const _setup = function(visibility, callback) {
    FoldersTestUtil.setupMultiTenantPrivacyEntities((publicTenant1, publicTenant2, privateTenant, privateTenant1) => {
      // Create a test user who will generate a test folder
      TestsUtil.generateTestUsers(publicTenant1.adminRestContext, 1, (err, users, simong) => {
        assert.ok(!err);
        FoldersTestUtil.generateTestFoldersWithVisibility(simong.restContext, 1, visibility, folder => {
          // Create 3 content items
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'public',
              description: 'public',
              visibility: PUBLIC,
              link: 'http://www.google.com',
              managers: null,
              viewers: [],
              folders: []
            },
            (err, publicContent) => {
              assert.ok(!err);
              RestAPI.Content.createLink(
                simong.restContext,
                {
                  displayName: 'loggedin',
                  description: 'loggedin',
                  visibility: LOGGED_IN,
                  link: 'http://www.google.com',
                  managers: null,
                  viewers: [],
                  folders: []
                },
                (err, loggedinContent) => {
                  assert.ok(!err);
                  RestAPI.Content.createLink(
                    simong.restContext,
                    {
                      displayName: 'private',
                      description: 'private',
                      visibility: PRIVATE,
                      link: 'http://www.google.com',
                      managers: null,
                      viewers: [],
                      folders: []
                    },
                    (err, privateContent) => {
                      assert.ok(!err);

                      // Add them to the folder
                      FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                        simong.restContext,
                        folder.id,
                        [publicContent.id, loggedinContent.id, privateContent.id],
                        () => {
                          return callback(
                            simong,
                            folder,
                            publicContent,
                            loggedinContent,
                            privateContent,
                            publicTenant1,
                            publicTenant2,
                            privateTenant,
                            privateTenant1
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
  };

  describe('Searching in folders', () => {
    /**
     * Test that verifies that folders can be searched through
     */
    it('verify folders are searchable', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, simong) => {
        assert.ok(!err);

        // Generate 2 test folders
        FoldersTestUtil.generateTestFolders(simong.restContext, 2, (folder1, folder2) => {
          // Both folders should be empty
          FoldersTestUtil.assertFolderSearchEquals(simong.restContext, folder1.id, null, [], () => {
            FoldersTestUtil.assertFolderSearchEquals(simong.restContext, folder2.id, null, [], () => {
              // Create some content items and add them to the first folder
              RestAPI.Content.createLink(
                camAdminRestContext,
                {
                  displayName: 'test',
                  description: 'test',
                  visibility: PUBLIC,
                  link: 'http://www.google.com',
                  managers: null,
                  viewers: [],
                  folders: []
                },
                (err, google) => {
                  assert.ok(!err);
                  RestAPI.Content.createLink(
                    camAdminRestContext,
                    {
                      displayName: 'marsupilamisausage',
                      description: 'marsupilamisausage',
                      visibility: PUBLIC,
                      link: 'http://www.marsupilamisausage.com',
                      managers: null,
                      viewers: [],
                      folders: []
                    },
                    (err, mars) => {
                      assert.ok(!err);
                      FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                        simong.restContext,
                        folder1.id,
                        [google.id, mars.id],
                        () => {
                          // Searching through the first folder should give the
                          // first 2 links. The other folder should still be empty
                          FoldersTestUtil.assertFolderSearchEquals(
                            simong.restContext,
                            folder1.id,
                            null,
                            [google, mars],
                            () => {
                              FoldersTestUtil.assertFolderSearchEquals(simong.restContext, folder2.id, null, [], () => {
                                // Assert that folders can be searched through
                                FoldersTestUtil.assertFolderSearchEquals(
                                  simong.restContext,
                                  folder1.id,
                                  'marsupilamisausage',
                                  [mars],
                                  () => {
                                    return callback();
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
      });
    });

    /**
     * Test that verifies that all users can search public folders
     */
    it('verify public folder', callback => {
      _setup(
        'public',
        (
          simong,
          folder,
          publicContent,
          loggedinContent,
          privateContent,
          publicTenant1,
          publicTenant2,
          privateTenant,
          privateTenant1
        ) => {
          // Anonymous users only see the public content
          FoldersTestUtil.assertFolderSearchEquals(
            publicTenant1.anonymousRestContext,
            folder.id,
            null,
            [publicContent],
            () => {
              // A user from another tenant only sees the public content
              FoldersTestUtil.assertFolderSearchEquals(
                publicTenant2.publicUser.restContext,
                folder.id,
                null,
                [publicContent],
                () => {
                  // A user from the same tenant sees both public and loggedin content
                  FoldersTestUtil.assertFolderSearchEquals(
                    publicTenant1.publicUser.restContext,
                    folder.id,
                    null,
                    [publicContent, loggedinContent],
                    () => {
                      // A tenant admin sees everything
                      FoldersTestUtil.assertFolderSearchEquals(
                        publicTenant1.adminRestContext,
                        folder.id,
                        null,
                        [publicContent, loggedinContent, privateContent],
                        () => {
                          // A tenant admin from another tenant only sees the public content
                          FoldersTestUtil.assertFolderSearchEquals(
                            publicTenant2.adminRestContext,
                            folder.id,
                            null,
                            [publicContent],
                            () => {
                              // A manager sees everything
                              FoldersTestUtil.assertFolderSearchEquals(
                                simong.restContext,
                                folder.id,
                                null,
                                [publicContent, loggedinContent, privateContent],
                                () => {
                                  // A global admin sees everything
                                  FoldersTestUtil.assertFolderSearchEquals(
                                    globalAdminRestContext,
                                    folder.id,
                                    null,
                                    [publicContent, loggedinContent, privateContent],
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

    /**
     * Test that verifies anonymous and cross-tenant users cannot search loggedin folders
     */
    it('verify loggedin folder', callback => {
      _setup(
        'loggedin',
        (
          simong,
          folder,
          publicContent,
          loggedinContent,
          privateContent,
          publicTenant1,
          publicTenant2,
          privateTenant,
          privateTenant1
        ) => {
          // Anonymous users cannot search this folder
          FoldersTestUtil.assertFolderSearchFails(publicTenant1.anonymousRestContext, folder.id, 401, () => {
            // A user from another tenant cannot search this folder
            FoldersTestUtil.assertFolderSearchFails(publicTenant2.publicUser.restContext, folder.id, 401, () => {
              // A user from the same tenant sees both public and loggedin content
              FoldersTestUtil.assertFolderSearchEquals(
                publicTenant1.publicUser.restContext,
                folder.id,
                null,
                [publicContent, loggedinContent],
                () => {
                  // A tenant admin sees everything
                  FoldersTestUtil.assertFolderSearchEquals(
                    publicTenant1.adminRestContext,
                    folder.id,
                    null,
                    [publicContent, loggedinContent, privateContent],
                    () => {
                      // A tenant admin from another tenant cannot search in this folder
                      FoldersTestUtil.assertFolderSearchFails(publicTenant2.adminRestContext, folder.id, 401, () => {
                        // A manager sees everything
                        FoldersTestUtil.assertFolderSearchEquals(
                          simong.restContext,
                          folder.id,
                          null,
                          [publicContent, loggedinContent, privateContent],
                          () => {
                            // A global admin sees everything
                            FoldersTestUtil.assertFolderSearchEquals(
                              globalAdminRestContext,
                              folder.id,
                              null,
                              [publicContent, loggedinContent, privateContent],
                              () => {
                                return callback();
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
        }
      );
    });

    /**
     * Test that verifies only admin and the user themselves can search private folders
     */
    it('verify private folder', callback => {
      _setup(
        'private',
        (
          simong,
          folder,
          publicContent,
          loggedinContent,
          privateContent,
          publicTenant1,
          publicTenant2,
          privateTenant,
          privateTenant1
        ) => {
          // Anonymous users cannot search this folder
          FoldersTestUtil.assertFolderSearchFails(publicTenant1.anonymousRestContext, folder.id, 401, () => {
            // A user from another tenant cannot search this folder
            FoldersTestUtil.assertFolderSearchFails(publicTenant2.publicUser.restContext, folder.id, 401, () => {
              // A user from the same tenant cannot search this folder
              FoldersTestUtil.assertFolderSearchFails(publicTenant1.publicUser.restContext, folder.id, 401, () => {
                // A tenant admin sees everything
                FoldersTestUtil.assertFolderSearchEquals(
                  publicTenant1.adminRestContext,
                  folder.id,
                  null,
                  [publicContent, loggedinContent, privateContent],
                  () => {
                    // A tenant admin from another tenant cannot search in this folder
                    FoldersTestUtil.assertFolderSearchFails(publicTenant2.adminRestContext, folder.id, 401, () => {
                      // A manager sees everything
                      FoldersTestUtil.assertFolderSearchEquals(
                        simong.restContext,
                        folder.id,
                        null,
                        [publicContent, loggedinContent, privateContent],
                        () => {
                          // A global admin sees everything
                          FoldersTestUtil.assertFolderSearchEquals(
                            globalAdminRestContext,
                            folder.id,
                            null,
                            [publicContent, loggedinContent, privateContent],
                            () => {
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
        }
      );
    });
  });

  describe('Searching for folders', () => {
    /**
     * Test that verifies that folders can be searched
     */
    it('verify folders can be searched for', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, simong) => {
        assert.ok(!err);

        // Setup a folder
        RestAPI.Folders.createFolder(simong.restContext, 'aaaaaa', null, null, null, null, (err, folderA) => {
          assert.ok(!err);
          RestAPI.Folders.createFolder(simong.restContext, 'bbbbbb', null, null, null, null, (err, folderB) => {
            assert.ok(!err);

            // Search for it
            FoldersTestUtil.assertGeneralFolderSearchEquals(simong.restContext, null, [folderA, folderB], [], () => {
              // Search on the display name
              FoldersTestUtil.assertGeneralFolderSearchEquals(
                simong.restContext,
                folderA.displayName,
                [folderA],
                [folderB],
                callback
              );
            });
          });
        });
      });
    });

    /**
     * Test that verifies that folder search results can contain a thumbnail
     */
    it('verify folder search results can contain a thumbnail', callback => {
      _setup(
        'public',
        (
          simong,
          folder,
          publicContent,
          loggedinContent,
          privateContent,
          publicTenant1,
          publicTenant2,
          privateTenant,
          privateTenant1
        ) => {
          // Mock some previews on the folder
          FoldersDAO.setPreviews(
            folder,
            { thumbnailUri: 'local:f/cam/bla/thumbnail.png', wideUri: 'local:f/cam/bla/wideUri' },
            (err, folder) => {
              assert.ok(!err);

              FoldersAPI.emitter.emit(FoldersConstants.events.UPDATED_FOLDER_PREVIEWS, folder);

              // When we search for the folder it should contain our thumbnail
              FoldersTestUtil.assertGeneralFolderSearchEquals(simong.restContext, null, [folder], [], () => {
                // When we remove the thumbnail, it should be removed from the search result
                FoldersDAO.setPreviews(folder, {}, (err, folder) => {
                  assert.ok(!err);

                  FoldersAPI.emitter.emit(FoldersConstants.events.UPDATED_FOLDER_PREVIEWS, folder);

                  // When we search for the folder it should contain our thumbnail
                  FoldersTestUtil.assertGeneralFolderSearchEquals(simong.restContext, null, [folder], [], callback);
                });
              });
            }
          );
        }
      );
    });

    /**
     * Test that verifies that the visibility of folders is taken into account when searching for folders
     */
    it('verify folder visibility is taken into account', callback => {
      _setup(
        'public',
        (
          simong,
          folder,
          publicContent,
          loggedinContent,
          privateContent,
          publicTenant1,
          publicTenant2,
          privateTenant,
          privateTenant1
        ) => {
          // Setup a public, loggedin and private folder
          FoldersTestUtil.generateTestFoldersWithVisibility(
            publicTenant1.publicUser.restContext,
            1,
            'public',
            publicFolder => {
              FoldersTestUtil.generateTestFoldersWithVisibility(
                publicTenant1.publicUser.restContext,
                1,
                'loggedin',
                loggedinFolder => {
                  FoldersTestUtil.generateTestFoldersWithVisibility(
                    publicTenant1.publicUser.restContext,
                    1,
                    'private',
                    privateFolder => {
                      // Anonymous users can only see the public folder
                      FoldersTestUtil.assertGeneralFolderSearchEquals(
                        publicTenant1.anonymousRestContext,
                        'disp',
                        [publicFolder],
                        [loggedinFolder, privateFolder],
                        () => {
                          FoldersTestUtil.assertGeneralFolderSearchEquals(
                            publicTenant2.anonymousRestContext,
                            'disp',
                            [publicFolder],
                            [loggedinFolder, privateFolder],
                            () => {
                              // Users from other tenants can only see the public folder
                              FoldersTestUtil.assertGeneralFolderSearchEquals(
                                publicTenant2.publicUser.restContext,
                                'disp',
                                [publicFolder],
                                [loggedinFolder, privateFolder],
                                () => {
                                  // Authenticated users from the same tenant can see the public and logged in folders
                                  FoldersTestUtil.assertGeneralFolderSearchEquals(
                                    publicTenant1.privateUser.restContext,
                                    'disp',
                                    [publicFolder, loggedinFolder],
                                    [privateFolder],
                                    () => {
                                      // Managers can see private folders they created. Keep in mind that
                                      // we need to search for some term as the endpoint would otherwise
                                      // only return implicit results (and not filtered by access)
                                      FoldersTestUtil.assertGeneralFolderSearchEquals(
                                        publicTenant1.publicUser.restContext,
                                        'disp',
                                        [publicFolder, loggedinFolder, privateFolder],
                                        [],
                                        () => {
                                          // Tenant administrators can see everything
                                          FoldersTestUtil.assertGeneralFolderSearchEquals(
                                            publicTenant1.adminRestContext,
                                            'disp',
                                            [publicFolder, loggedinFolder, privateFolder],
                                            [],
                                            () => {
                                              // Tenant administrators from other tenants can only see public folders
                                              FoldersTestUtil.assertGeneralFolderSearchEquals(
                                                publicTenant2.adminRestContext,
                                                'disp',
                                                [publicFolder],
                                                [loggedinFolder, privateFolder],
                                                () => {
                                                  // Global administrators can see everything
                                                  FoldersTestUtil.assertGeneralFolderSearchEquals(
                                                    globalAdminRestContext,
                                                    'disp',
                                                    [publicFolder, loggedinFolder, privateFolder],
                                                    [],
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
    });

    /**
     * Test that verifies folders are searchable by their messages. Also verifies that
     * messages that are deleted no longer cause the folders to be returned in search
     */
    it('verify folders can be searched by messages', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, simong) => {
        assert.ok(!err);

        const searchTerm = TestsUtil.generateRandomText(5);

        // Create some folders we will test searching for
        FoldersTestUtil.generateTestFolders(simong.restContext, 20, (folder1, folder2) => {
          // Verify that none of the folders return in the search results
          FoldersTestUtil.assertGeneralFolderSearchEquals(
            simong.restContext,
            searchTerm,
            [],
            [folder1, folder2],
            () => {
              // Create a message on the first folder
              FoldersTestUtil.assertCreateMessageSucceeds(simong.restContext, folder1.id, searchTerm, null, message => {
                // Verify that the first folder returns in the search result but not the second folder
                FoldersTestUtil.assertGeneralFolderSearchEquals(
                  simong.restContext,
                  searchTerm,
                  [folder1],
                  [folder2],
                  () => {
                    // Delete the message
                    FoldersTestUtil.assertDeleteMessageSucceeds(
                      simong.restContext,
                      folder1.id,
                      message.created,
                      message => {
                        // Verify that none of the folders return in the search results
                        FoldersTestUtil.assertGeneralFolderSearchEquals(
                          simong.restContext,
                          searchTerm,
                          [],
                          [folder1, folder2],
                          callback
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

  describe('Searching for folders owned by a principal', () => {
    /**
     * Test that verifies only valid principal ids return results
     */
    it('verify the principal id gets validated', callback => {
      SearchTestsUtil.searchAll(camAdminRestContext, 'folder-library', [''], null, (err, results) => {
        assert.strictEqual(err.code, 400);
        assert.ok(!results);

        SearchTestsUtil.searchAll(camAdminRestContext, 'folder-library', ['invalid-user-id'], null, (err, results) => {
          assert.strictEqual(err.code, 400);
          assert.ok(!results);

          return callback();
        });
      });
    });

    /**
     * Test that verifies that the visibility of folders is taken into account when searching for folders
     * in a principal's library
     */
    it('verify folder visibility is taken into account', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simong, nico) => {
        assert.ok(!err);
        TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users, stuartf) => {
          assert.ok(!err);

          // Setup a public, loggedin and private folder
          FoldersTestUtil.generateTestFoldersWithVisibility(simong.restContext, 1, 'public', publicFolder => {
            FoldersTestUtil.generateTestFoldersWithVisibility(simong.restContext, 1, 'loggedin', loggedinFolder => {
              FoldersTestUtil.generateTestFoldersWithVisibility(simong.restContext, 1, 'private', privateFolder => {
                // Anonymous users can only see the public folder
                FoldersTestUtil.assertFolderLibrarySearch(
                  camAnonymousRestContext,
                  simong.user.id,
                  'disp',
                  [publicFolder],
                  [loggedinFolder, privateFolder],
                  () => {
                    // Anonymous users from other tenants can only see the public folder
                    FoldersTestUtil.assertFolderLibrarySearch(
                      gtAnonymousRestContext,
                      simong.user.id,
                      'disp',
                      [publicFolder],
                      [loggedinFolder, privateFolder],
                      () => {
                        // Users from other tenants can only see the public folder
                        FoldersTestUtil.assertFolderLibrarySearch(
                          stuartf.restContext,
                          simong.user.id,
                          'disp',
                          [publicFolder],
                          [loggedinFolder, privateFolder],
                          () => {
                            // Authenticated users can only see the public and logged in folders
                            FoldersTestUtil.assertFolderLibrarySearch(
                              nico.restContext,
                              simong.user.id,
                              'disp',
                              [publicFolder, loggedinFolder],
                              [privateFolder],
                              () => {
                                // Simong can see all folders as he created them. Keep in mind that
                                // we need to search for some term as the endpoint would otherwise
                                // only return implicit results (and not filtered by access)
                                FoldersTestUtil.assertFolderLibrarySearch(
                                  simong.restContext,
                                  simong.user.id,
                                  'disp',
                                  [publicFolder, loggedinFolder, privateFolder],
                                  [],
                                  () => {
                                    // Tenant administrators can see everything
                                    FoldersTestUtil.assertFolderLibrarySearch(
                                      camAdminRestContext,
                                      simong.user.id,
                                      'disp',
                                      [publicFolder, loggedinFolder, privateFolder],
                                      [],
                                      () => {
                                        // Tenant administrators from other tenants can only see the public folder
                                        FoldersTestUtil.assertFolderLibrarySearch(
                                          gtAdminRestContext,
                                          simong.user.id,
                                          'disp',
                                          [publicFolder],
                                          [loggedinFolder, privateFolder],
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
        });
      });
    });
  });

  describe('Indexing', () => {
    /**
     * Test that verifies that folders can be reindexed
     */
    it('verify folders can be reindexed', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, simong) => {
        assert.ok(!err);

        // Setup a public folder with some content
        FoldersTestUtil.generateTestFoldersWithVisibility(simong.restContext, 1, 'public', folder => {
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'public',
              description: 'public',
              visibility: PUBLIC,
              link: 'http://www.google.com',
              managers: null,
              viewers: [],
              folders: []
            },
            (err, link) => {
              assert.ok(!err);

              FoldersTestUtil.assertAddContentItemsToFolderSucceeds(simong.restContext, folder.id, [link.id], () => {
                // Sanity-check that folder can be found in a general search
                FoldersTestUtil.assertGeneralFolderSearchEquals(simong.restContext, 'disp', [folder], [], () => {
                  // Sanity-check we can search in the folder
                  FoldersTestUtil.assertFolderSearchEquals(simong.restContext, folder.id, null, [link], () => {
                    // Delete all the things
                    SearchTestsUtil.deleteAll(() => {
                      // Check that we can no longer find the folder
                      FoldersTestUtil.assertGeneralFolderSearchEquals(simong.restContext, 'disp', [], [folder], () => {
                        // Sanity check that searching in the folder returns 0 results
                        FoldersTestUtil.assertFolderSearchEquals(simong.restContext, folder.id, null, [], () => {
                          // Reindex all the things
                          SearchTestsUtil.reindexAll(globalAdminRestContext, () => {
                            // Check that we can now find the folder again
                            FoldersTestUtil.assertGeneralFolderSearchEquals(
                              simong.restContext,
                              'disp',
                              [folder],
                              [],
                              () => {
                                // Check that we can search in the folder again
                                FoldersTestUtil.assertFolderSearchEquals(
                                  simong.restContext,
                                  folder.id,
                                  null,
                                  [link],
                                  callback
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
            }
          );
        });
      });
    });

    /**
     * Test that verifies that updating a folder triggers a reindex for that folder
     */
    it('verify updating a folder triggers a reindex', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, simong) => {
        assert.ok(!err);

        // Setup a public folder
        FoldersTestUtil.generateTestFoldersWithVisibility(simong.restContext, 1, 'public', folder => {
          // Sanity-check that it can be found
          FoldersTestUtil.assertGeneralFolderSearchEquals(simong.restContext, 'disp', [folder], [], () => {
            // Update the folder's name and visibility
            const updates = { displayName: 'New displayName', visibility: 'private' };
            RestAPI.Folders.updateFolder(simong.restContext, folder.id, updates, (err, updatedFolder) => {
              assert.ok(!err);

              // Assert that the folder's metadata has changed
              FoldersTestUtil.assertGeneralFolderSearchEquals(
                simong.restContext,
                'display',
                [updatedFolder],
                [],
                callback
              );
            });
          });
        });
      });
    });

    /**
     * Test that verifies that updating a folder's visibility (and containing content) triggers updates in the search index
     */
    it("verify updating a folder's visibility affects the content that can be searched on", callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simong, nico) => {
        assert.ok(!err);

        // Setup a public folder
        FoldersTestUtil.generateTestFoldersWithVisibility(simong.restContext, 1, 'public', folder => {
          // Add some public content
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'displayName',
              description: 'description',
              visibility: PUBLIC,
              link: 'http://www.google.com',
              managers: null,
              viewers: [],
              folders: []
            },
            (err, link) => {
              assert.ok(!err);

              FoldersTestUtil.assertAddContentItemsToFolderSucceeds(simong.restContext, folder.id, [link.id], () => {
                // Sanity-check that the content item can be found by Nico
                SearchTestsUtil.searchAll(
                  nico.restContext,
                  'general',
                  null,
                  { resourceTypes: 'content', q: 'displayName' },
                  (err, results) => {
                    assert.ok(!err);
                    assert.ok(_.findWhere(results.results, { id: link.id }));

                    // Make the folder and all content in it private
                    const updates = { visibility: 'private' };
                    RestAPI.Folders.updateFolder(simong.restContext, folder.id, updates, (err, data) => {
                      assert.ok(!err);
                      RestAPI.Folders.updateFolderContentVisibility(
                        simong.restContext,
                        folder.id,
                        'private',
                        (err, data) => {
                          assert.ok(!err);

                          // Nico should no longer be able to see the content item
                          SearchTestsUtil.searchAll(
                            nico.restContext,
                            'general',
                            null,
                            { resourceTypes: 'content', q: 'displayName' },
                            (err, results) => {
                              assert.ok(!err);
                              assert.ok(!_.findWhere(results.results, { id: link.id }));

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
      });
    });

    /**
     * Test that verifies that updating a folder's members updates the index
     */
    it("verify updating a folder's members updates the index", callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simong, nico) => {
        assert.ok(!err);

        // Setup a private folder
        FoldersTestUtil.generateTestFoldersWithVisibility(simong.restContext, 1, 'private', folder => {
          // Sanity-check that the folder cannot be found by Nico
          SearchTestsUtil.searchAll(
            nico.restContext,
            'general',
            null,
            { resourceTypes: 'folder', q: 'displayName' },
            (err, results) => {
              assert.ok(!err);
              assert.ok(!_.findWhere(results.results, { id: folder.id }));

              // Make Nico a viewer
              const memberUpdate = {};
              memberUpdate[nico.user.id] = 'viewer';
              FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                simong.restContext,
                simong.restContext,
                folder.id,
                memberUpdate,
                () => {
                  // Nico should now be able to search for the folder
                  SearchTestsUtil.searchAll(
                    nico.restContext,
                    'general',
                    null,
                    { resourceTypes: 'folder', q: 'displayName' },
                    (err, results) => {
                      assert.ok(!err);
                      assert.ok(_.findWhere(results.results, { id: folder.id }));

                      // Make Nico a manager
                      memberUpdate[nico.user.id] = 'manager';
                      FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                        simong.restContext,
                        simong.restContext,
                        folder.id,
                        memberUpdate,
                        () => {
                          // Nico should still be able to search for the folder
                          SearchTestsUtil.searchAll(
                            nico.restContext,
                            'general',
                            null,
                            { resourceTypes: 'folder', q: 'displayName' },
                            (err, results) => {
                              assert.ok(!err);
                              assert.ok(_.findWhere(results.results, { id: folder.id }));

                              // Removing Nico's membership
                              memberUpdate[nico.user.id] = false;
                              FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                                simong.restContext,
                                simong.restContext,
                                folder.id,
                                memberUpdate,
                                () => {
                                  // Nico should no longer see the folder in the search results
                                  SearchTestsUtil.searchAll(
                                    nico.restContext,
                                    'general',
                                    null,
                                    { resourceTypes: 'folder', q: 'displayName' },
                                    (err, results) => {
                                      assert.ok(!err);
                                      assert.ok(!_.findWhere(results.results, { id: folder.id }));

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

    /**
     * Test that verifies that updating a folder's members updates those members their membership documents
     */
    it("verify updating a folder's members updates those members their membership documents", callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simong, nico) => {
        assert.ok(!err);

        // Setup a private folder
        FoldersTestUtil.generateTestFoldersWithVisibility(simong.restContext, 1, 'private', folder => {
          // Create a private content item
          const uniqueString = TestsUtil.generateRandomText(5);
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: uniqueString,
              description: 'description',
              visibility: PRIVATE,
              link: 'http://www.google.com',
              managers: null,
              viewers: [],
              folders: []
            },
            (err, link) => {
              assert.ok(!err);

              // Add the content item to the folder
              FoldersTestUtil.assertAddContentItemsToFolderSucceeds(simong.restContext, folder.id, [link.id], () => {
                // Sanity-check that the content item cannot be found by Nico
                SearchTestsUtil.searchAll(
                  nico.restContext,
                  'general',
                  null,
                  { resourceTypes: 'content', q: uniqueString },
                  (err, results) => {
                    assert.ok(!err);
                    assert.ok(!_.findWhere(results.results, { id: link.id }));

                    // Make Nico a viewer
                    const memberUpdate = {};
                    memberUpdate[nico.user.id] = 'viewer';
                    FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                      simong.restContext,
                      simong.restContext,
                      folder.id,
                      memberUpdate,
                      () => {
                        // Nico should now be able to search for the content item
                        SearchTestsUtil.searchAll(
                          nico.restContext,
                          'general',
                          null,
                          { q: uniqueString, scope: '_network' },
                          (err, results) => {
                            assert.ok(!err);
                            assert.ok(_.findWhere(results.results, { id: link.id }));

                            // Make Nico a manager
                            memberUpdate[nico.user.id] = 'manager';
                            FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                              simong.restContext,
                              simong.restContext,
                              folder.id,
                              memberUpdate,
                              () => {
                                // Nico should still be able to search for the content item
                                SearchTestsUtil.searchAll(
                                  nico.restContext,
                                  'general',
                                  null,
                                  { resourceTypes: 'content', q: uniqueString },
                                  (err, results) => {
                                    assert.ok(!err);
                                    assert.ok(_.findWhere(results.results, { id: link.id }));

                                    // Removing Nico's membership
                                    memberUpdate[nico.user.id] = false;
                                    FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                                      simong.restContext,
                                      simong.restContext,
                                      folder.id,
                                      memberUpdate,
                                      () => {
                                        // Nico should no longer see the content item in the search results
                                        SearchTestsUtil.searchAll(
                                          nico.restContext,
                                          'general',
                                          null,
                                          { resourceTypes: 'content', q: uniqueString },
                                          (err, results) => {
                                            assert.ok(!err);
                                            assert.ok(!_.findWhere(results.results, { id: link.id }));

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
    });

    /**
     * Test that verifies that when a folder gets deleted it gets removed from the search index
     */
    it('verify deleting a folder removes it from the index', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, simong) => {
        assert.ok(!err);

        // Setup a public folder
        FoldersTestUtil.generateTestFoldersWithVisibility(simong.restContext, 1, 'public', folder => {
          // Sanity-check that it can be found
          FoldersTestUtil.assertGeneralFolderSearchEquals(simong.restContext, 'disp', [folder], [], () => {
            // Delete the folder
            FoldersTestUtil.assertDeleteFolderSucceeds(simong.restContext, folder.id, false, () => {
              // Assert that the folder's metadata cannot be found
              FoldersTestUtil.assertGeneralFolderSearchEquals(simong.restContext, 'disp', [], [folder], () => {
                // Reindex everything
                SearchTestsUtil.reindexAll(globalAdminRestContext, () => {
                  // We still should not be able to find the folder
                  FoldersTestUtil.assertGeneralFolderSearchEquals(simong.restContext, 'disp', [], [folder], callback);
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that users can find private content through search when its in a folder they are a member of
     */
    it("verify adding private content to a folder makes it searchable for the folder's members", callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simong, nico) => {
        assert.ok(!err);

        // Setup a folder
        FoldersTestUtil.generateTestFoldersWithVisibility(simong.restContext, 1, 'private', folder => {
          // Add some private content to the folder. We add it in two different ways
          // to ensure that both mechanismes get properly indexed
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'private',
              description: 'private',
              visibility: PRIVATE,
              link: 'http://www.google.com',
              managers: null,
              viewers: [],
              folders: [folder.id]
            },
            (err, link1) => {
              assert.ok(!err);

              RestAPI.Content.createLink(
                simong.restContext,
                {
                  displayName: 'private',
                  description: 'private',
                  visibility: PRIVATE,
                  link: 'http://www.google.com',
                  managers: null,
                  viewers: [],
                  folders: []
                },
                (err, link2) => {
                  assert.ok(!err);
                  FoldersTestUtil.assertAddContentItemsToFolderSucceeds(
                    simong.restContext,
                    folder.id,
                    [link2.id],
                    () => {
                      // Assert that Nico can't find the items through search yet
                      SearchTestsUtil.searchAll(
                        nico.restContext,
                        'general',
                        null,
                        { resourceTypes: 'content', q: 'private' },
                        (err, results) => {
                          assert.ok(!err);
                          assert.ok(!_.findWhere(results.results, { id: link1.id }));
                          assert.ok(!_.findWhere(results.results, { id: link2.id }));

                          // Make Nico a member
                          const memberUpdate = {};
                          memberUpdate[nico.user.id] = 'viewer';
                          FoldersTestUtil.assertUpdateFolderMembersSucceeds(
                            simong.restContext,
                            simong.restContext,
                            folder.id,
                            memberUpdate,
                            () => {
                              // Now Nico should be able to see the items
                              SearchTestsUtil.searchAll(
                                nico.restContext,
                                'general',
                                null,
                                { resourceTypes: 'content', q: 'private' },
                                (err, results) => {
                                  assert.ok(!err);
                                  assert.ok(_.findWhere(results.results, { id: link1.id }));
                                  assert.ok(_.findWhere(results.results, { id: link2.id }));
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
});
