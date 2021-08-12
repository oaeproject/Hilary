/*!
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

/* eslint-disable no-unused-vars */
/* eslint-disable unicorn/no-array-callback-reference */

import { assert } from 'chai';
import { format } from 'util';
import _ from 'underscore';
import shortid from 'shortid';

import * as AuthzTestUtil from 'oae-authz/lib/test/util.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as ContentTestUtil from 'oae-content/lib/test/util.js';
import * as LibraryAPI from 'oae-library';
import * as LibraryTestUtil from 'oae-library/lib/test/util.js';
import * as MQTestUtil from 'oae-util/lib/test/mq-util.js';
import PreviewConstants from 'oae-preview-processor/lib/constants.js';
import PrincipalsAPI from 'oae-principals';
import * as RestAPI from 'oae-rest';
import * as SearchTestUtil from 'oae-search/lib/test/util.js';
import * as FoldersLibrary from 'oae-folders/lib/library.js';

import { Context } from 'oae-context';
import { User } from 'oae-principals/lib/model.js';
import * as FoldersDAO from '../internal/dao.js';
import { FoldersConstants } from '../constants.js';

const TIMEOUT = 1000;

/**
 * Generate a number of folders for use in testing
 *
 * @param  {RestContext}    restContext             The REST context to use for making requests
 * @param  {Number}         numFolders              How many folders to generate
 * @param  {Function}       callback                Standard callback function
 * @param  {Folder}         callback.folder...      All folders that were generated as separate callback parameters
 * @throws {AssertionError}                         Thrown if an error occurred generating the folders
 */
const generateTestFolders = function (restContext, numberFolders, callback, _folders) {
  _folders = _folders || [];
  if (numberFolders === 0) {
    LibraryAPI.Index.whenUpdatesComplete(() => {
      SearchTestUtil.whenIndexingComplete(function () {
        return callback.apply(this, _folders);
      });
    });
    return;
  }

  RestAPI.Folders.createFolder(
    restContext,
    format('displayName-%s', shortid.generate()),
    null,
    null,
    null,
    null,
    (error, createdFolder) => {
      assert.notExists(error);
      _folders.push(createdFolder);
      return generateTestFolders(restContext, numberFolders - 1, callback, _folders);
    }
  );
};

/**
 * Generate a number of folders with the provided visibility for use in testing
 *
 * @param  {RestContext}    restContext             The REST context to use for making requests
 * @param  {Number}         numFolders              How many folders to generate
 * @param  {String}         visibility              The visibility to apply to each folder. One of the options enumerated by `Authz.visibility`
 * @param  {Function}       callback                Standard callback function
 * @param  {Folder}         callback.folder...      All folders that were generated as separate callback parameters
 * @throws {AssertionError}                         Thrown if an error occurred generating the folders
 */
const generateTestFoldersWithVisibility = function (restContext, numberFolders, visibility, callback, _folders) {
  _folders = _folders || [];
  if (numberFolders === 0) {
    LibraryAPI.Index.whenUpdatesComplete(() => {
      SearchTestUtil.whenIndexingComplete(function () {
        return callback.apply(this, _folders);
      });
    });
    return;
  }

  RestAPI.Folders.createFolder(
    restContext,
    format('displayName-%s', shortid.generate()),
    null,
    visibility,
    null,
    null,
    (error, createdFolder) => {
      assert.notExists(error);
      _folders.push(createdFolder);
      return generateTestFoldersWithVisibility(restContext, numberFolders - 1, visibility, callback, _folders);
    }
  );
};

/**
 * Set up 2 public tenants and 2 private tenants, each with a public, loggedin, private set of
 * users, groups, content and folders. The resulting model looks like this:
 *
 * ```
 *  {
 *      "publicTenant": {
 *          "tenant": <Tenant>,
 *          "anonymousRestContext": <RestContext>,
 *          "adminRestContext": <RestContext>,
 *          "publicGroup": <Group>,
 *          "loggedinGroup": <Group>,
 *          "privateGroup": <Group>,
 *          "publicContent": <Content>,
 *          "loggedinContent": <Content>,
 *          "privateContent": <Content>,
 *          "publicUser": {
 *              "user": <User>,
 *              "restContext": <RestContext>
 *          },
 *          "loggedinUser": { ... }
 *          "privateUser": { ... }
 *      },
 *      "publicTenant1": { ... },
 *      "privateTenant": { ... },
 *      "privateTenant1": { ... }
 *  }
 * ```
 *
 * @param  {Function}   Invoked when all the entities are set up
 * @throws {Error}      An assertion error is thrown if something does not get created properly
 */
const setupMultiTenantPrivacyEntities = function (callback) {
  // Base the folders privacy setup on content. We then create folders to go along with them
  ContentTestUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1, privateTenant, privateTenant1) => {
    // Create the folders
    _setupTenant(publicTenant, () => {
      _setupTenant(publicTenant1, () => {
        _setupTenant(privateTenant, () => {
          _setupTenant(privateTenant1, () => {
            return callback(publicTenant, publicTenant1, privateTenant, privateTenant1);
          });
        });
      });
    });
  });
};

/**
 * Add a set of content items to a folder, ensuring that all items have been added succesfully
 *
 * @param  {RestContext}        restContext     The REST context to use when adding the content items to the folder
 * @param  {String}             folderId        The id of the folder on which to add the content items
 * @param  {String[]}           contentIds      The ids of the content items to add
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the content items are not successfully added
 */
const assertAddContentItemsToFolderSucceeds = function (restContext, folderId, contentIds, callback) {
  // First ensure the folder's content library is not stale
  getAllFolderContentItems(restContext, folderId, null, () => {
    // Add the content items to the folder
    RestAPI.Folders.addContentItemsToFolder(restContext, folderId, contentIds, (error) => {
      assert.notExists(error);

      // Ensure that the items we just added to the folder are in fact there
      getAllFolderContentItems(restContext, folderId, null, (contentItems, responses) => {
        _.each(contentIds, (contentId) => {
          assert.ok(_.findWhere(contentItems, { id: contentId }));
        });

        // Purge the folder's content library so we can rebuild it from scratch
        _purgeFolderContentLibrary(folderId, () => {
          // Ensure once again that all content items are in the folder
          getAllFolderContentItems(restContext, folderId, null, (contentItems, responses) => {
            _.each(contentIds, (contentId) => {
              assert.ok(_.findWhere(contentItems, { id: contentId }));
            });

            return callback();
          });
        });
      });
    });
  });
};

/**
 * Try to add a set of content items to a folder, and ensure it fails in a specified way
 *
 * @param  {RestContext}        restContext     The REST context to use when adding the content items to the folder
 * @param  {String}             folderId        The id of the folder on which to try and add the content items
 * @param  {String[]}           contentIds      The content ids to try and add to the folder
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertAddContentItemsToFolderFails = function (restContext, folderId, contentIds, httpCode, callback) {
  RestAPI.Folders.addContentItemsToFolder(restContext, folderId, contentIds, (error) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    return callback();
  });
};

/**
 * Add a content item to all the provided folders, ensuring that all items have been added successfully
 *
 * @param  {RestContext}        restContext     The REST context to use when adding the content item to the folders
 * @param  {String[]}           folderIds       The ids of the folders on which to add the content item
 * @param  {String}             contentId       The id of the content item to add to the folders
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the content item is not successfully added to all the folders
 */
const assertAddContentItemToFoldersSucceeds = function (restContext, folderIds, contentId, callback) {
  if (_.isEmpty(folderIds)) {
    return callback();
  }

  // Add the content item to the next folder in the list
  folderIds = folderIds.slice();
  const folderId = folderIds.shift();
  assertAddContentItemsToFolderSucceeds(restContext, folderId, [contentId], () => {
    // Recursively add the content item to the next folder
    return assertAddContentItemToFoldersSucceeds(restContext, folderIds, contentId, callback);
  });
};

/**
 * Remove a set of content items from a folder, ensuring that all items have been removed succesfully
 *
 * @param  {RestContext}        restContext     The REST context to use when removing the content items from the folder
 * @param  {String}             folderId        The id of the folder from which to remove the content items
 * @param  {String[]}           contentIds      The ids of the content items to remove
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the content items are not successfully removed
 */
const assertRemoveContentItemsFromFolderSucceeds = function (restContext, folderId, contentIds, callback) {
  // First ensure the folder's content library is not stale
  getAllFolderContentItems(restContext, folderId, null, (contentItems, responses) => {
    // Ensure the items are there in the first place
    _.each(contentIds, (contentId) => {
      assert.ok(_.findWhere(contentItems, { id: contentId }));
    });

    // Remove the content items from the folder
    RestAPI.Folders.removeContentItemsFromFolder(restContext, folderId, contentIds, (error) => {
      assert.notExists(error);

      LibraryAPI.Index.whenUpdatesComplete(() => {
        // Ensure that the items we just removed from the folder are in fact removed
        getAllFolderContentItems(restContext, folderId, null, (contentItems, responses) => {
          _.each(contentIds, (contentId) => {
            assert.ok(!_.findWhere(contentItems, { id: contentId }));
          });

          // Purge the folder's content library so we can rebuild it from scratch
          _purgeFolderContentLibrary(folderId, () => {
            // Ensure once again that all content items are no longer in the folder
            getAllFolderContentItems(restContext, folderId, null, (contentItems, responses) => {
              _.each(contentIds, (contentId) => {
                assert.ok(!_.findWhere(contentItems, { id: contentId }));
              });

              return callback();
            });
          });
        });
      });
    });
  });
};

/**
 * Try to remove a set of content items from a folder, and ensure it fails in a specified way
 *
 * @param  {RestContext}        restContext     The REST context to use when removing the content items from the folder
 * @param  {String}             folderId        The id of the folder from which to try and remove the content items
 * @param  {String[]}           contentIds      The content ids to try and remove from the folder
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertRemoveContentItemsFromFolderFails = function (restContext, folderId, contentIds, httpCode, callback) {
  RestAPI.Folders.removeContentItemsFromFolder(restContext, folderId, contentIds, (error) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    return callback();
  });
};

/**
 * Try to create a folder, ensuring it fails in a specified way
 *
 * @param  {RestContext}        restContext     The REST context to use when creating the folder
 * @param  {String}             displayName     The display name of the folder
 * @param  {String}             description     The description of the folder
 * @param  {String}             visibility      The visibility of the folder
 * @param  {String[]}           managers        The manager principal ids for the folder
 * @param  {String[]}           viewers         The viewer principal ids for the folder
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertCreateFolderFails = function (
  restContext,
  displayName,
  description,
  visibility,
  managers,
  viewers,
  httpCode,
  callback
) {
  RestAPI.Folders.createFolder(
    restContext,
    displayName,
    description,
    visibility,
    managers,
    viewers,
    (error, createdFolder) => {
      assert.ok(error);
      assert.strictEqual(error.code, httpCode);
      assert.ok(!createdFolder);
      return callback();
    }
  );
};

/**
 * Create a folder, ensuring that it is successfully created with the provided properties
 *
 * @param  {RestContext}        restContext             The REST context to use when creating the folder
 * @param  {String}             displayName             The display name of the folder
 * @param  {String}             description             The description of the folder
 * @param  {String}             visibility              The visibility of the folder
 * @param  {Object[]}           managers                The manager principal infos for the folder
 * @param  {Object[]}           viewers                 The viewer principal infos for the folder
 * @param  {Function}           callback                Standard callback function
 * @param  {Folder}             callback.folder         The created folder
 * @throws {AssertionError}                             Thrown if the folder was not successfully created
 */
const assertCreateFolderSucceeds = function (
  restContext,
  displayName,
  description,
  visibility,
  managerInfos,
  viewerInfos,
  callback
) {
  const managerIds = [];
  const viewerIds = [];
  const allMemberInfos = [];

  // Generalize the potential user and group info objects so that they have a `profile` key
  // instead of `user` or `group`, then collect the parameters needed to create a folder
  _.chain(managerInfos)
    .map(_generalizePrincipalInfoModel)
    .each((managerInfo) => {
      if (_.isObject(managerInfo)) {
        managerIds.push(managerInfo.profile.id);
        allMemberInfos.push(managerInfo);
      } else {
        managerIds.push(managerInfo);
      }
    });

  _.chain(viewerInfos)
    .map(_generalizePrincipalInfoModel)
    .each((viewerInfo) => {
      if (_.isObject(viewerInfo)) {
        viewerIds.push(viewerInfo.profile.id);
        allMemberInfos.push(viewerInfo);
      } else {
        viewerIds.push(viewerInfo);
      }
    });

  // Get all the folders libraries to ensure that the library index is populated for all users
  _getAllFoldersInLibraries(allMemberInfos, (principalFoldersLibrariesBeforeCreate) => {
    // Create the folder
    RestAPI.Folders.createFolder(
      restContext,
      displayName,
      description,
      visibility,
      managerIds,
      viewerIds,
      (error, createdFolder) => {
        assert.notExists(error);
        assert.ok(createdFolder);
        assert.ok(createdFolder.id);
        assert.ok(createdFolder.groupId);
        assert.ok(createdFolder.createdBy);
        assert.strictEqual(createdFolder.displayName, displayName);
        assert.strictEqual(createdFolder.description, description);
        assert.strictEqual(createdFolder.visibility, visibility);
        assert.ok(_.isNumber(createdFolder.created));
        assert.strictEqual(createdFolder.created, createdFolder.lastModified);
        assert.strictEqual(createdFolder.profilePath.indexOf('/folder/'), 0);
        assert.notStrictEqual(createdFolder.profilePath.indexOf(createdFolder.id.split(':').pop()), -1);
        assert.strictEqual(createdFolder.resourceType, 'folder');

        // Determine what the full membership should be, including the current user who created
        // the folder
        RestAPI.User.getMe(restContext, (error, me) => {
          assert.notExists(error);

          const expectedMemberRoles = _.extend(
            AuthzTestUtil.createRoleChange(viewerIds, 'viewer'),
            AuthzTestUtil.createRoleChange(managerIds, 'manager')
          );

          // The current user is only made a manager if he can't manage any other managers
          const user = new User(me.tenant.alias, me.id, me.displayName, me.email, me);
          const ctx = new Context(me.tenant, user);
          PrincipalsAPI.canManageAny(ctx, managerIds, (error, canManage) => {
            assert.notExists(error);
            if (!canManage) {
              expectedMemberRoles[me.id] = 'manager';
              // Add the current user member info to ensure the folder gets added to their library
              allMemberInfos.push({
                restContext,
                profile: me
              });
            }

            // Ensure members and invitation roles are what we expect
            getAllFolderMembers(restContext, createdFolder.id, null, (membersAfterCreate) => {
              AuthzTestUtil.assertMemberRolesEquals(
                {},
                expectedMemberRoles,
                AuthzTestUtil.getMemberRolesFromResults(membersAfterCreate)
              );

              AuthzTestUtil.assertGetInvitationsSucceeds(restContext, 'folder', createdFolder.id, (result) => {
                AuthzTestUtil.assertEmailRolesEquals(
                  {},
                  expectedMemberRoles,
                  AuthzTestUtil.getEmailRolesFromResults(result.results)
                );

                // Get the folders libraries after it was created and ensure that the folder is in the libraries
                _getAllFoldersInLibraries(allMemberInfos, (principalFoldersLibrariesAfterCreate) => {
                  _.each(allMemberInfos, (memberInfo) => {
                    assert.ok(
                      _.chain(principalFoldersLibrariesAfterCreate[memberInfo.profile.id])
                        .pluck('id')
                        .contains(createdFolder.id)
                        .value()
                    );
                  });

                  const allMemberInfoIds = _.chain(allMemberInfos).pluck('profile').pluck('id').value();

                  // Purge the member folder libraries and check again to ensure they update properly both on-the-fly and when built from scratch
                  _purgeFoldersLibraries(allMemberInfoIds, () => {
                    _getAllFoldersInLibraries(allMemberInfos, (principalFoldersLibrariesAfterCreate) => {
                      _.each(allMemberInfos, (memberInfo) => {
                        assert.ok(
                          _.chain(principalFoldersLibrariesAfterCreate[memberInfo.profile.id])
                            .pluck('id')
                            .contains(createdFolder.id)
                            .value()
                        );
                      });

                      return callback(createdFolder);
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
};

/**
 * Get a folder, ensuring that it fails in a specified way
 *
 * @param  {RestContext}        restContext     The REST context to use when getting the folder
 * @param  {String}             folderId        The id of the folder to get
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertGetFolderFails = function (restContext, folderId, httpCode, callback) {
  RestAPI.Folders.getFolder(restContext, folderId, (error, folder) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    assert.ok(!folder);
    return callback();
  });
};

/**
 * Get a folder, ensuring that the request is successful
 *
 * @param  {RestContext}        restContext     The REST context to use when getting the folder
 * @param  {String}             folderId        The id of the folder to get
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not succeed
 */
const assertGetFolderSucceeds = function (restContext, folderId, callback) {
  RestAPI.Folders.getFolder(restContext, folderId, (error, folder) => {
    assert.notExists(error);
    assert.ok(folder);
    assert.strictEqual(folder.id, folderId);
    return callback(folder);
  });
};

/**
 * Update a folder, ensuring that it succeeds
 *
 * @param  {RestContext}        restContext         The REST context to use when updating the folder
 * @param  {String}             folderId            The id of the folder to update
 * @param  {Object}             updates             The updates that should be made on the folder
 * @param  {Function}           callback            Invoked when the folder is successfully updated
 * @param  {Folder}             callback.folder     The updated folder
 * @throws {AssertionError}                         Thrown if the request did not fail in the expected manner
 */
const assertUpdateFolderSucceeds = function (restContext, folderId, updates, callback) {
  RestAPI.Folders.updateFolder(restContext, folderId, updates, (error, folder) => {
    assert.notExists(error);

    // Wait for library and search to be udpated before continuing
    LibraryAPI.Index.whenUpdatesComplete(() => {
      SearchTestUtil.whenIndexingComplete(() => {
        return callback(folder);
      });
    });
  });
};

/**
 * Update a folder, ensuring that it fails in a specified way
 *
 * @param  {RestContext}        restContext     The REST context to use when updating the folder
 * @param  {String}             folderId        The id of the folder to update
 * @param  {Object}             updates         The updates that should be made on the folder
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertUpdateFolderFails = function (restContext, folderId, updates, httpCode, callback) {
  RestAPI.Folders.updateFolder(restContext, folderId, updates, (error, folder) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    assert.ok(!folder);
    return callback();
  });
};

/**
 * Update the visibility folder's content items, ensuring that it fails in a specified way
 *
 * @param  {RestContext}        restContext     The REST context to use when updating the folder
 * @param  {String}             folderId        The id of the folder to update
 * @param  {Object}             updates         The updates that should be made on the folder
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertUpdateFolderContentVisibilityFails = function (restContext, folderId, visibility, httpCode, callback) {
  RestAPI.Folders.updateFolderContentVisibility(restContext, folderId, visibility, (error, folder) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    assert.ok(!folder);
    return callback();
  });
};

/**
 * Delete a folder, ensuring that it fails in a specified way
 *
 * @param  {RestContext}        restContext     The REST context to use when deleting the folder
 * @param  {String}             folderId        The id of the folder to delete
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertDeleteFolderFails = function (restContext, folderId, httpCode, callback) {
  RestAPI.Folders.deleteFolder(restContext, folderId, false, (error) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    return callback();
  });
};

/**
 * Delete a folder, ensuring that the request is successful
 *
 * @param  {RestContext}        restContext     The REST context to use when deleting the folder
 * @param  {String}             folderId        The id of the folder to delete
 * @param  {Boolean}            deleteContent   whether or not to delete the content in the folder as well
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request failed
 */
const assertDeleteFolderSucceeds = function (restContext, folderId, deleteContent, callback) {
  RestAPI.Folders.deleteFolder(restContext, folderId, deleteContent, (error) => {
    assert.notExists(error);

    // Wait for library and search to be updated before continuing
    LibraryAPI.Index.whenUpdatesComplete(() => {
      SearchTestUtil.whenIndexingComplete(() => {
        return FoldersLibrary.whenAllPurged(callback);
      });
    });
  });
};

/**
 * Get the content library of a folder, ensuring that it fails in the specified manner
 *
 * @param  {RestContext}        restContext     The REST context to use when getting the content library
 * @param  {String}             folderId        The id of the folder whose content library to get
 * @param  {String}             start           The starting point from where to list folders in the library
 * @param  {Number}             limit           The maximum number of content items to fetch
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertGetFolderContentLibraryFails = function (restContext, folderId, start, limit, httpCode, callback) {
  RestAPI.Folders.getFolderContentLibrary(restContext, folderId, start, limit, (error, result) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    assert.ok(!result);
    return callback();
  });
};

/**
 * Get the content library of a folder, ensuring that it succeeds
 *
 * @param  {RestContext}        restContext         The REST context to use when getting the content library
 * @param  {String}             folderId            The id of the folder whose content library to get
 * @param  {String}             start               The starting point from where to list folders in the library
 * @param  {Number}             limit               The maximum number of content items to fetch
 * @param  {Function}           callback            Standard callback function
 * @param  {Object}             callback.result     The result object, as per `RestAPI.Folders.getFolderContentLibrary`
 * @throws {AssertionError}                         Thrown if the request did not succeed
 */
const assertGetFolderContentLibrarySucceeds = function (restContext, folderId, start, limit, callback) {
  RestAPI.Folders.getFolderContentLibrary(restContext, folderId, start, limit, (error, result) => {
    assert.notExists(error);
    assert.ok(_.isArray(result.results));
    assert.ok(_.isString(result.nextToken) || _.isNull(result.nextToken));

    // If a valid limit was specified (valid meaning above 0 and less than the maximum amount of
    // 25), ensure the `nextToken` is shown if there were less than the expected amount of
    // results
    if (_.isNumber(limit) && limit > 0 && result.results.length < limit && limit <= 25) {
      assert.strictEqual(result.nextToken, null);
    }

    // Ensure each result has an id
    _.each(result.results, (result) => {
      assert.ok(result.id);
    });

    return callback(result);
  });
};

/**
 * Assert that a folder contains all the expected content items
 *
 * @param  {RestContext}        restContext     The REST context to use when getting the folder library
 * @param  {String}             folderId        The id of the folder to get the content items for
 * @param  {String[]}           contentIds      The content item ids that should be in the folder. Can be empty
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the folder contained the wrong or is missing content items
 */
const assertFolderEquals = function (restContext, folderId, contentIds, callback) {
  getAllFolderContentItems(restContext, folderId, null, (contentItems) => {
    assert.strictEqual(contentItems.length, contentIds.length);

    _.each(contentIds, (contentId) => {
      assert.ok(_.findWhere(contentItems, { id: contentId }));
    });
    return callback();
  });
};

/**
 * Try and get the members of a folder, ensuring that the request fails
 *
 * @param  {RestContext}        restContext     The REST context to use when getting the folder members
 * @param  {String}             folderId        The id of the folder whose members to get
 * @param  {String}             start           The starting point from where to list members of the folder
 * @param  {Number}             limit           The maximum number of members to fetch
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertGetFolderMembersFails = function (restContext, folderId, start, limit, httpCode, callback) {
  RestAPI.Folders.getFolderMembers(restContext, folderId, start, limit, (error, result) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    assert.ok(!result);
    return callback();
  });
};

const assertGetAllFolderMembersSucceeds = function (
  restContext,
  folderId,
  options,
  callback,
  _members,
  _responses,
  _nextToken
) {
  _members = _members || [];
  _responses = _responses || [];
  if (_nextToken === null) {
    return callback(_members, _responses);
  }

  options = options || {};
  options.batchSize = options.batchSize || 25;
  assertGetFolderMembersSucceeds(restContext, folderId, _nextToken, options.batchSize, (result) => {
    _responses.push(result);
    return assertGetAllFolderMembersSucceeds(
      restContext,
      folderId,
      options,
      callback,
      _.union(_members, result.results),
      _responses,
      result.nextToken
    );
  });
};

/**
 * Get the members of a folder, ensuring that the request succeeds
 *
 * @param  {RestContext}        restContext         The REST context to use when getting the folder members
 * @param  {String}             folderId            The id of the folder whose members to get
 * @param  {String}             start               The starting point from where to list members of the folder
 * @param  {Number}             limit               The maximum number of members to fetch
 * @param  {Function}           callback            Standard callback function
 * @param  {Object}             callback.result     The result object, as per `RestAPI.Folders.getFolderMembers`
 * @throws {AssertionError}                         Thrown if the request did not succeed
 */
const assertGetFolderMembersSucceeds = function (restContext, folderId, start, limit, callback) {
  RestAPI.Folders.getFolderMembers(restContext, folderId, start, limit, (error, result) => {
    assert.notExists(error);
    assert.ok(result);
    assert.ok(_.isArray(result.results));
    assert.ok(_.isString(result.nextToken) || _.isNull(result.nextToken));

    // If we specified a valid limit and the result set was smaller, we must have no items left
    if (_.isNumber(limit) && limit > 0 && result.results.length < limit) {
      assert.strictEqual(result.nextToken, null);
    }

    // Ensure each result has a profile and a valid role
    _.each(result.results, (result) => {
      assert.ok(result);
      assert.ok(result.profile);
      assert.ok(result.profile.id);
      assert.ok(_.contains(['manager', 'viewer'], result.role));
    });

    return callback(result);
  });
};

const assertGetAllFoldersLibrarySucceeds = function (
  restContext,
  principalId,
  options,
  callback,
  _folders,
  _responses,
  _nextToken
) {
  _folders = _folders || [];
  _responses = _responses || [];
  if (_nextToken === null) {
    return callback(_folders, _responses);
  }

  options = options || {};
  options.batchSize = options.batchSize || 25;
  assertGetFoldersLibrarySucceeds(restContext, principalId, _nextToken, options.batchSize, (result) => {
    _responses.push(result);
    return assertGetAllFoldersLibrarySucceeds(
      restContext,
      principalId,
      options,
      callback,
      _.union(_folders, result.results),
      _responses,
      result.nextToken
    );
  });
};

/**
 * Get the folders library of a specified user or group, ensuring that the request succeeds
 *
 * @param  {RestContext}        restContext         The REST context to use when getting the folders library
 * @param  {String}             principalId         The principal id for which to remove the folder from the library
 * @param  {String}             start               The starting point from where to list folders in the library
 * @param  {Number}             limit               The maximum number of folders to fetch
 * @param  {Function}           callback            Standard callback function
 * @param  {Object}             callback.result     The result object, as per `RestAPI.Folders.getFoldersLibrary`
 * @throws {AssertionError}                         Thrown if the request did not succeed
 */
const assertGetFoldersLibrarySucceeds = function (restContext, principalId, start, limit, callback) {
  RestAPI.Folders.getFoldersLibrary(restContext, principalId, start, limit, (error, result) => {
    assert.notExists(error);
    assert.ok(result);
    assert.ok(_.isArray(result.results));
    assert.ok(_.isString(result.nextToken) || _.isNull(result.nextToken));

    // If a valid limit was specified (valid meaning above 0 and below the maximum amount of
    // 25), ensure the `nextToken` is shown if there were less than the expected amount of
    // results
    if (_.isNumber(limit) && limit > 0 && result.results.length < limit && limit <= 25) {
      assert.strictEqual(result.nextToken, null);
    }

    // Ensure each result has an id
    _.each(result.results, (result) => {
      assert.ok(result);
      assert.ok(result.id);
    });

    return callback(result);
  });
};

/**
 * Try to get the folders library of a specified user or group, ensuring that the request fails
 * in the specified manner
 *
 * @param  {RestContext}        restContext         The REST context to use when getting the folders library
 * @param  {String}             principalId         The id of the user or group whose folders library to get
 * @param  {String}             start               The starting point from where to list folders in the library
 * @param  {Number}             limit               The maximum number of folders to fetch
 * @param  {Number}             httpCode            The expected failure HTTP code of the request
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Thrown if the request did not fail in the expected manner
 */
const assertGetFoldersLibraryFails = function (restContext, principalId, start, limit, httpCode, callback) {
  RestAPI.Folders.getFoldersLibrary(restContext, principalId, start, limit, (error, result) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    assert.ok(!result);
    return callback();
  });
};

/**
 * Try to remove a folder from a principal's library, ensuring that the request fails
 * in the specified manner
 *
 * @param  {RestContext}        restContext         The REST context to use when removing the folder from the principal library
 * @param  {String}             principalId         The principal id for which to remove the folder from the library
 * @param  {String}             folderId            The id of the folder that should be removed
 * @param  {Number}             httpCode            The expected failure HTTP code of the request
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Thrown if the request did not fail in the expected manner
 */
const assertRemoveFolderFromLibraryFails = function (restContext, principalId, folderId, httpCode, callback) {
  RestAPI.Folders.removeFolderFromLibrary(restContext, principalId, folderId, (error, result) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    assert.ok(!result);
    return callback();
  });
};

/**
 * Remove a folder from a principal's library, ensuring that the folder has been removed
 *
 * @param  {RestContext}        restContext         The REST context to use when removing the folder from the principal library
 * @param  {String}             principalId         The principal id for which to remove the folder from the library
 * @param  {String}             folderId            The id of the folder that should be removed
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Thrown if the request failed
 */
const assertRemoveFolderFromLibrarySucceeds = function (restContext, principalId, folderId, callback) {
  RestAPI.Folders.removeFolderFromLibrary(restContext, principalId, folderId, (error, result) => {
    assert.notExists(error);

    // Assert that the folder really was removed
    assertGetFoldersLibrarySucceeds(restContext, principalId, null, null, (folders) => {
      const folder = _.findWhere(folders, { id: folderId });
      assert.ok(!folder);
      return callback();
    });
  });
};

/**
 * Share a folder with a set of users and groups, ensuring that the request succeeds. The list
 * of viewers provided is a mixed array of strings (target principal ids) or objects:
 *
 *  * String:   If the viewer is a plain string, it should be a simple id of the target principal to
 *              share with. When a string is used, no assertions will be done on the library of the
 *              target principal after the share has completed, as we do not know how to reliably
 *              access the libraries
 *
 *  * Object:   If the viewer is an object, it is assumed to represent either a user or a group,
 *              containing both the profile and rest context with which we can access the
 *              principal's private libraries (e.g., the user themself, or the manager of the
 *              group). Given an object, the assertion will also verify that the library of the
 *              target principal was updated as expected
 *
 * @param  {RestContext}        restContext     The REST context to use when sharing the folder
 * @param  {String}             folderId        The id of the folder to share
 * @param  {Object[]}           viewers         A mixed array of strings and objects. See summary for more info
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not succeed
 */
const assertShareFolderSucceeds = function (managerRestContext, actorRestContext, folderId, viewers, callback) {
  const viewersSplit = _.partition(viewers, (viewer) => {
    return _.isString(viewer);
  });

  // Get the viewer infos from the input while making the object more agnostic to the principal
  // type by changing the "user" / "group" key to just "profile"
  const viewerInfos = _.chain(viewersSplit).last().map(_generalizePrincipalInfoModel).value();
  const viewerInfoIds = _.chain(viewerInfos).pluck('profile').pluck('id').value();

  // Get all the viewer ids, including those extracted from the viewer info objects
  const viewerIds = _.chain(viewersSplit).first().union(viewerInfoIds).value();

  // First get all the folder members so we can ensure the library is fresh and compare the
  // membership before and after the operation
  getAllFolderMembers(managerRestContext, folderId, null, (results) => {
    const memberRolesBefore = AuthzTestUtil.getMemberRolesFromResults(results);

    AuthzTestUtil.assertGetInvitationsSucceeds(managerRestContext, 'folder', folderId, (result) => {
      const emailRolesBefore = AuthzTestUtil.getEmailRolesFromResults(result.results);

      // Determine what role changes should be applied in the share operation
      const roleChanges = {};
      _.each(viewerIds, (viewerId) => {
        if (!memberRolesBefore[viewerId] && !emailRolesBefore[viewerId]) {
          roleChanges[viewerId] = 'viewer';
        }
      });

      // Get the folders libraries of all principals before adding them as members to ensure
      // they have been built and will be updated on the fly
      _getAllFoldersInLibraries(viewerInfos, (principalFoldersLibrariesBeforeShare) => {
        // Share the folder with all the principals and wait for the library updates to complete
        RestAPI.Folders.shareFolder(actorRestContext, folderId, viewerIds, (error) => {
          assert.notExists(error);
          LibraryAPI.Index.whenUpdatesComplete(() => {
            // Ensure the invitations and members of the folder were udpated as we would expect
            AuthzTestUtil.assertGetInvitationsSucceeds(managerRestContext, 'folder', folderId, (result) => {
              AuthzTestUtil.assertEmailRolesEquals(
                emailRolesBefore,
                roleChanges,
                AuthzTestUtil.getEmailRolesFromResults(result.results)
              );

              getAllFolderMembers(managerRestContext, folderId, null, (results) => {
                AuthzTestUtil.assertMemberRolesEquals(
                  memberRolesBefore,
                  roleChanges,
                  AuthzTestUtil.getMemberRolesFromResults(results)
                );

                // Ensure the folder libraries of all the principals we shared with contain the folder
                _getAllFoldersInLibraries(viewerInfos, (principalFoldersLibrariesAfterShare) => {
                  _.each(principalFoldersLibrariesAfterShare, (foldersLibrary, principalId) => {
                    assert.ok(_.chain(foldersLibrary).pluck('id').contains(foldersLibrary, folderId));
                  });

                  // Purge the folder libraries of all users to ensure a rebuild will
                  // still contain the shared folder
                  _purgeFoldersLibraries(viewerInfoIds, () => {
                    // Ensure the rebuilt libraries of all the principals we shared with contain the folder
                    _getAllFoldersInLibraries(viewerInfos, (principalFoldersLibrariesAfterShare) => {
                      _.each(principalFoldersLibrariesAfterShare, (foldersLibrary, principalId) => {
                        assert.ok(_.chain(foldersLibrary).pluck('id').contains(foldersLibrary, folderId));
                      });

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
};

/**
 * Try to share a folder with a set of users and groups, ensuring that the request fails in the
 * specified manner
 *
 * @param  {RestContext}        restContext     The REST context to use when sharing the folder
 * @param  {String}             folderId        The id of the folder to share
 * @param  {String[]}           viewerIds       The ids of the users and groups with which to share
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertShareFolderFails = function (
  managerRestContext,
  actorRestContext,
  folderId,
  viewerIds,
  httpCode,
  callback
) {
  RestAPI.Folders.shareFolder(actorRestContext, folderId, viewerIds, (error) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    return callback();
  });
};

/**
 * Try to update the members of a folder, ensuring that the request fails in the specified
 * manner
 *
 * @param  {RestContext}        restContext     The REST context to use when updating the folder members
 * @param  {String}             folderId        The id of the folder whose members to udpate
 * @param  {Object}             memberUpdates   The member update object, keyed by principal id whose value is a role to apply to a principal, or `false` if the principal should be removed
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertUpdateFolderMembersFails = function (
  managerRestContext,
  actorRestContext,
  folderId,
  memberUpdates,
  httpCode,
  callback
) {
  RestAPI.Folders.updateFolderMembers(actorRestContext, folderId, memberUpdates, (error) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    return callback();
  });
};

/**
 * Update the members of a folder, ensuring that the request succeeds. The provided member
 * update info is keyed by the principal id whose role should change, and the value should be one
 * of the following:
 *
 *  * String:   A string indicates that it is simply the role to give to the user. In this case, the
 *              principal's library cannot be verified after the operation as we do not have a rest
 *              context to use to request their library
 *
 *  * Boolean:  Only `false` is valid, indicates that the user membership should be removed
 *
 *  * Object:   If an object, it should be the standard principal info object containing the
 *              `restContext` key (A REST context that can be used to have "manager"
 *              access to the user or group's feeds) and either a `user` or `group` key, containing
 *              the profile of the principal, dependent on if it is a user or a group, respectively.
 *              Additionally, there should be a `role` key that is either a String or Boolean,
 *              indicating how to change the principal's membership on the folder. If provided,
 *              further assertions will be performed on the libraries of the target principals using
 *              the provided REST context
 *
 * @param  {RestContext}        restContext         The REST context to use when updating the folder members
 * @param  {String}             folderId            The id of the folder whose members to udpate
 * @param  {Object}             memberUpdateInfos   The member update object. See summary for more information
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Thrown if the request did not succeed
 */
const assertUpdateFolderMembersSucceeds = function (
  managerRestContext,
  actorRestContext,
  folderId,
  memberUpdateInfos,
  callback
) {
  // Determine the roles to actually apply, and those that are the memberInfo objects so we can
  // perform additional assertions on them
  const roleChange = {};
  const memberInfos = [];
  _.each(memberUpdateInfos, (memberUpdateInfo, principalId) => {
    memberUpdateInfo = _generalizePrincipalInfoModel(memberUpdateInfo);
    if (_.isObject(memberUpdateInfo)) {
      // Normalize the member info object to have a generic `profile` key instead of a `user`
      // or `group` key
      memberInfos.push(memberUpdateInfo);
      roleChange[principalId] = memberUpdateInfo.role;
    } else {
      roleChange[principalId] = memberUpdateInfo;
    }
  });

  getAllFolderMembers(managerRestContext, folderId, null, (results) => {
    const memberRolesBefore = AuthzTestUtil.getMemberRolesFromResults(results);

    AuthzTestUtil.assertGetInvitationsSucceeds(managerRestContext, 'folder', folderId, (result) => {
      const emailRolesBefore = AuthzTestUtil.getEmailRolesFromResults(result.results);

      // Get the folder libraries to ensure they are not stale and will be updated on the fly
      _getAllFoldersInLibraries(memberInfos, (principalFoldersLibrariesBeforeUpdate) => {
        RestAPI.Folders.updateFolderMembers(actorRestContext, folderId, roleChange, (error) => {
          assert.notExists(error);

          // Ensure the member and email roles are as we expect given the change made
          AuthzTestUtil.assertGetInvitationsSucceeds(managerRestContext, 'folder', folderId, (result) => {
            AuthzTestUtil.assertEmailRolesEquals(
              emailRolesBefore,
              roleChange,
              AuthzTestUtil.getEmailRolesFromResults(result.results)
            );
            getAllFolderMembers(managerRestContext, folderId, null, (results) => {
              AuthzTestUtil.assertMemberRolesEquals(
                memberRolesBefore,
                roleChange,
                AuthzTestUtil.getMemberRolesFromResults(results)
              );

              // For all the members we had a rest context for, ensure their libraries are updated
              // appropriately to contain (or not contain) this folder
              _getAllFoldersInLibraries(memberInfos, (principalFoldersLibrariesAfterUpdate) => {
                _.each(roleChange, (change, memberId) => {
                  const foldersLibrary = principalFoldersLibrariesAfterUpdate[memberId];
                  if (foldersLibrary) {
                    const containsFolder = _.chain(foldersLibrary).pluck('id').contains(folderId).value();
                    if (change === false) {
                      assert.ok(!containsFolder);
                    } else {
                      assert.ok(containsFolder);
                    }
                  }
                });

                return callback();
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Ensure the folders library of the provided user or group strictly contains just the specified
 * folder ids, and optionally in the same order
 *
 * @param  {RestContext}    restContext             The REST context to use when getting the folders library
 * @param  {String}         principalId             The id of the user or group whose folders library to test
 * @param  {String[]}       expectedFolderIds       The folder ids to ensure are present in the library
 * @param  {Boolean}        ensureOrder             When `true`, ensures that the order of items in the folder library matches the order of folder ids in `expectedFolderIds`
 * @param  {Function}       callback                Standard callback function
 * @throws {AssertionError}                         Thrown if any assertions failed
 */
const assertFullFoldersLibraryEquals = function (restContext, principalId, expectedFolderIds, ensureOrder, callback) {
  getAllFoldersInLibrary(restContext, principalId, null, (folders) => {
    const actualFolderIds = _.pluck(folders, 'id');

    // If we aren't ensuring they are in the correct order, simply force-sort the arrays of ids
    if (!ensureOrder) {
      expectedFolderIds.sort();
      actualFolderIds.sort();
    }

    // Ensure the sets of folder ids are identical
    assert.deepStrictEqual(actualFolderIds, expectedFolderIds);

    return callback();
  });
};

/**
 * Ensure that searching through a folder results in the expected content items
 *
 * @param  {RestContext}        restContext         The REST context to use when searching through the folder
 * @param  {String}             folderId            The id of the folder to search through
 * @param  {String}             q                   The term to search on
 * @param  {Content[]}          expectedContent     The set of content items to be returned
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Thrown if any assertions failed
 */
const assertFolderSearchEquals = function (restContext, folderId, q, expectedContent, callback) {
  SearchTestUtil.searchAll(restContext, 'folder-content', [folderId], { q, scope: '_network' }, (error, results) => {
    assert.notExists(error);

    // Assert we've got the exact number of results that we expected (in case we want 0 results)
    setTimeout(assert.strictEqual, TIMEOUT, results.results.length, expectedContent.length);

    // Assert that the results that came back are the ones we expected
    _.each(expectedContent, (content) => {
      assert.ok(_.findWhere(results.results, { id: content.id }));
    });

    return callback();
  });
};

/**
 * Ensure that searching for folders results in the expected folders
 *
 * @param  {RestContext}        restContext         The REST context to use when searching for folders
 * @param  {String}             q                   The term to search on
 * @param  {Folder[]}           expectedFolders     The set of folders that are supposed to come back
 * @param  {Folder[]}           missingFolders      Folders that should not be included in the result set
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Thrown if any assertions failed
 */
const assertGeneralFolderSearchEquals = function (restContext, q, expectedFolders, missingFolders, callback) {
  SearchTestUtil.searchAll(
    restContext,
    'general',
    null,
    { resourceTypes: 'folder', q, scope: '_network' },
    (error, results) => {
      assert.notExists(error);
      setTimeout(
        () => {
          _assertSearchResults();
          return callback();
        },
        TIMEOUT,
        results,
        expectedFolders,
        missingFolders
      );
    }
  );
};

/**
 * Ensure that searching for folders inside of a folder library results in the expected folders
 *
 * @param  {RestContext}        restContext         The REST context to use when searching for folders
 * @param  {String}             principalId         The principal id for which to search through the folder library
 * @param  {String}             q                   The term to search on
 * @param  {Folder[]}           expectedFolders     The set of folders that are supposed to come back
 * @param  {Folder[]}           missingFolders      Folders that should not be included in the result set
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Thrown if any assertions failed
 */
const assertFolderLibrarySearch = function (restContext, principalId, q, expectedFolders, missingFolders, callback) {
  SearchTestUtil.searchAll(restContext, 'folder-library', [principalId], { q }, (error, results) => {
    assert.notExists(error);
    _assertSearchResults(results, expectedFolders, missingFolders);
    return callback();
  });
};

/**
 * Assert a set of search results contains the expected items
 *
 * @param  {Object}             results             The search results as returned by the search endpoints
 * @param  {Folder[]}           expectedFolders     A set of folders that should be returned in the search results
 * @param  {Folder[]}           missingFolders      A set of folders that should not be returned in the search results
 * @throws {AssertionError}                         Thrown if any assertions failed
 * @api private
 */
const _assertSearchResults = function (results, expectedFolders, missingFolders) {
  // Assert that the results that came back are the ones we expected
  _.each(expectedFolders, (folder) => {
    const searchResult = _.findWhere(results.results, { id: folder.id });
    assert.ok(searchResult);

    // Assert all the expected properties are returned
    assert.strictEqual(searchResult.displayName, folder.displayName);
    assert.strictEqual(searchResult.description, folder.description);
    assert.strictEqual(searchResult.visibility, folder.visibility);
    const tenantAlias = folder.tenant.alias;
    const { resourceId } = AuthzUtil.getResourceFromId(folder.id);
    assert.strictEqual(searchResult.profilePath, format('/folder/%s/%s', tenantAlias, resourceId));

    // If the folder has a thumbnail, we assert the search result has it as well
    if (folder.previews && folder.previews.thumbnailUri) {
      assert.ok(searchResult.thumbnailUrl);

      // If the folder has no thumbnail, the search result shouldn't have one either
    } else {
      assert.ok(!searchResult.thumbnailUrl);
    }
  });

  // Assert some folders are NOT included in the result set
  _.each(missingFolders, (folder) => {
    assert.ok(!_.findWhere(results.results, { id: folder.id }));
  });
};

/**
 * Ensure that searching through a folder results in an error
 *
 * @param  {RestContext}        restContext         The REST context to use when searching through the folder
 * @param  {String}             folderId            The id of the folder to search through
 * @param  {Number}             httpCode            The HTTP error code that should be returned
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Thrown if any assertions failed
 */
const assertFolderSearchFails = function (restContext, folderId, httpCode, callback) {
  SearchTestUtil.searchAll(restContext, 'folder-content', [folderId], null, (error, results) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    return callback();
  });
};

/**
 * Ensure the members of a specified folder is strictly equal to the provided set of expected
 * members and their roles
 *
 * @param  {RestContext}        restContext             The REST context to use when getting the folder members
 * @param  {String}             folderId                The id of the folder whose members to test
 * @param  {Object}             expectedMemberRoles     An object keyed by principal id whose values are their expected role, indicating the expected members of the folder
 * @param  {Function}           callback                Standard callback function
 * @throws {AssertionError}                             Thrown if any assertions failed
 */
const assertFullFolderMembersEquals = function (restContext, folderId, expectedMemberRoles, callback) {
  // Remove any roles that contain a role of `false` as they would have been removed
  expectedMemberRoles = _.extend({}, expectedMemberRoles);
  _.each(expectedMemberRoles, (role, userId) => {
    if (role === false) {
      delete expectedMemberRoles[userId];
    }
  });

  // Get the full members set to compare against
  getAllFolderMembers(restContext, folderId, null, (actualMembers) => {
    const actualMemberRoles = {};
    _.each(actualMembers, (member) => {
      actualMemberRoles[member.profile.id] = member.role;
    });

    assert.deepStrictEqual(actualMemberRoles, expectedMemberRoles);

    return callback();
  });
};

/**
 * Page through all the folders in a user or group's folder library and return all
 * folders that were fetched
 *
 * @param  {RestContext}    restContext             The REST context to use when getting the folders library
 * @param  {String}         principalId             The id of the user or group whose folders library to get
 * @param  {Object}         [opts]                  Optional arguments for getting the folders library
 * @param  {Number}         [opts.batchSize]        The size of the batch to use to fetch the folders in the library. Default: 25
 * @param  {Function}       callback                Standard callback function
 * @param  {Folder[]}       callback.folders        A list of all folders in the library
 * @param  {Object[]}       callback.responses      All the raw web responses that were received for each page request
 */
const getAllFoldersInLibrary = function (
  restContext,
  principalId,
  options,
  callback,
  _nextToken,
  _folders,
  _responses
) {
  options = options || {};
  options.batchSize = options.batchSize || 25;
  _folders = _folders || [];
  _responses = _responses || [];
  if (_nextToken === null) {
    return callback(_folders, _responses);
  }

  assertGetFoldersLibrarySucceeds(restContext, principalId, _nextToken, options.batchSize, (result) => {
    _responses.push(result);
    return getAllFoldersInLibrary(
      restContext,
      principalId,
      options,
      callback,
      result.nextToken,
      _.union(_folders, result.results),
      _responses
    );
  });
};

/**
 * Page through all the content items in a folder's content library and return all content items
 * that were fetched
 *
 * @param  {RestContext}    restContext             The REST context to use when getting the content library
 * @param  {String}         folderId                The id of the folder whose content library to get
 * @param  {Object}         [opts]                  Optional arguments for getting the content library
 * @param  {Number}         [opts.batchSize]        The size of the batch to use to fetch the content in the library. Default: 25
 * @param  {Function}       callback                Standard callback function
 * @param  {Folder[]}       callback.contentItems   A list of all content items in the library
 * @param  {Object[]}       callback.responses      All the raw web responses that were received for each page request
 */
const getAllFolderContentItems = function (
  restContext,
  folderId,
  options,
  callback,
  _nextToken,
  _contentItems,
  _responses
) {
  options = options || {};
  options.batchSize = options.batchSize || 25;
  _contentItems = _contentItems || [];
  _responses = _responses || [];
  if (_nextToken === null) {
    return callback(_contentItems, _responses);
  }

  assertGetFolderContentLibrarySucceeds(restContext, folderId, _nextToken, options.batchSize, (result) => {
    _responses.push(result);
    return getAllFolderContentItems(
      restContext,
      folderId,
      options,
      callback,
      result.nextToken,
      _.union(_contentItems, result.results),
      _responses
    );
  });
};

/**
 * Page through all the members of a folder and return all users and groups that were fetched
 *
 * @param  {RestContext}    restContext             The REST context to use when getting the folder members
 * @param  {String}         folderId                The id of the folder whose members to get
 * @param  {Object}         [opts]                  Optional arguments for getting the folder members
 * @param  {Number}         [opts.batchSize]        The size of the batch to use to fetch the members of the folder. Default: 25
 * @param  {Function}       callback                Standard callback function
 * @param  {Principal[]}    callback.members        A list of all users and groups who are members of the folder
 * @param  {Object[]}       callback.responses      All the raw web responses that were received for each page request
 */
const getAllFolderMembers = function (restContext, folderId, options, callback, _nextToken, _members, _responses) {
  options = options || {};
  options.batchSize = options.batchSize || 25;
  _members = _members || [];
  _responses = _responses || [];
  if (_nextToken === null) {
    return callback(_members, _responses);
  }

  assertGetFolderMembersSucceeds(restContext, folderId, _nextToken, options.batchSize, (result) => {
    _responses.push(result);
    return getAllFolderMembers(
      restContext,
      folderId,
      options,
      callback,
      result.nextToken,
      _.union(_members, result.results),
      _responses
    );
  });
};

/**
 * Try to create a new message on a folder, and ensure it fails in a specified way
 *
 * @param  {RestContext}        restContext     The REST context to use when creating the message
 * @param  {String}             folderId        The id of the folder on which to try and create the message
 * @param  {String}             body            The body of the message to post
 * @param  {String|Number}      [replyTo]       The created time of the message on which this is a reply, if applicable
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertCreateMessageFails = function (restContext, folderId, body, replyTo, httpCode, callback) {
  RestAPI.Folders.createMessage(restContext, folderId, body, replyTo, (error) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    return callback();
  });
};

/**
 * Try to create a new message on a folder, and ensure it does not fail
 *
 * @param  {RestContext}        restContext             The REST context to use when creating the message
 * @param  {String}             folderId                The id of the folder on which to try and create the message
 * @param  {String}             body                    The body of the message to post
 * @param  {String|Number}      [replyTo]               The created time of the message on which this is a reply, if applicable
 * @param  {Function}           callback                Standard callback function
 * @param  {Message}            callback.message        The created message
 * @throws {AssertionError}                             Thrown if the request failed
 */
const assertCreateMessageSucceeds = function (restContext, folderId, body, replyTo, callback) {
  RestAPI.Folders.createMessage(restContext, folderId, body, replyTo, (error, message) => {
    assert.notExists(error);
    return callback(message);
  });
};

/**
 * Try to get the messages for a folder, and ensure the request fails in a specified way
 *
 * @param  {RestContext}        restContext     The REST context to use when getting the messages
 * @param  {String}             folderId        The id of the folder for which to get the messages
 * @param  {String}             [start]         The starting point from where to list messages on the folder
 * @param  {Number}             [limit]         The number of messages that should be retrieved
 * @param  {Number}             httpCode        The expected failure HTTP code of the request
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request did not fail in the expected manner
 */
const assertGetMessagesFails = function (restContext, folderId, start, limit, httpCode, callback) {
  RestAPI.Folders.getMessages(restContext, folderId, start, limit, (error, result) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    return callback();
  });
};

/**
 * Try to get the messages for a folder, and ensure the request doesn't fail
 *
 * @param  {RestContext}        restContext     The REST context to use when getting the messages
 * @param  {String}             folderId        The id of the folder for which to get the messages
 * @param  {String}             [start]         The starting point from where to list messages on the folder
 * @param  {Number}             [limit]         The number of messages that should be retrieved
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if the request failed
 */
const assertGetMessagesSucceeds = function (restContext, folderId, start, limit, callback) {
  RestAPI.Folders.getMessages(restContext, folderId, start, limit, (error, result) => {
    assert.notExists(error);
    return callback(result);
  });
};

/**
 * Try to delete a message from a folder, and ensure the request fails in a specified way
 *
 * @param  {RestContext}        restContext         The REST context to use when deleting a message
 * @param  {String}             folderId            The id of the folder for which to delete a message
 * @param  {String}             messageCreated      The timestamp of the message to delete
 * @param  {Number}             httpCode            The expected failure HTTP code of the request
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Thrown if the request did not fail in the expected manner
 */
const assertDeleteMessageFails = function (restContext, folderId, messageCreated, httpCode, callback) {
  RestAPI.Folders.deleteMessage(restContext, folderId, messageCreated, (error, result) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    return callback();
  });
};

/**
 * Try to delete a message from a folder, and ensure it doesn't fail
 *
 * @param  {RestContext}        restContext         The REST context to use when deleting a message
 * @param  {String}             folderId            The id of the folder for which to delete a message
 * @param  {String}             messageCreated      The timestamp of the message to delete
 * @param  {Function}           callback            Standard callback function
 * @param  {Message}            callback.message    If the deleted message had children, the deleted message will be returned
 * @throws {AssertionError}                         Thrown if the request failed
 */
const assertDeleteMessageSucceeds = function (restContext, folderId, messageCreated, callback) {
  RestAPI.Folders.deleteMessage(restContext, folderId, messageCreated, (error, result) => {
    assert.notExists(error);
    return callback(result);
  });
};

/**
 * Set up a provided tenant to have a public, loggedin and private folder
 *
 * @param  {Tenant}     tenant      The tenant to set up
 * @param  {Function}   callback    Standard callback function
 * @api private
 */
const _setupTenant = function (tenant, callback) {
  _createMultiPrivacyFolders(tenant.adminRestContext, (publicFolder, loggedinFolder, privateFolder) => {
    tenant.publicFolder = publicFolder;
    tenant.loggedinFolder = loggedinFolder;
    tenant.privateFolder = privateFolder;
    return callback();
  });
};

/**
 * Create a public, loggedin and private folder using the given REST context
 *
 * @param  {RestContext}    restContext     The REST context to use to create the folders
 * @param  {Function}       callback        Standard callback function
 * @api private
 */
const _createMultiPrivacyFolders = function (restContext, callback) {
  _createFolderWithVisibility(restContext, 'public', (publicFolder) => {
    _createFolderWithVisibility(restContext, 'loggedin', (loggedinFolder) => {
      _createFolderWithVisibility(restContext, 'private', (privateFolder) => {
        return callback(publicFolder, loggedinFolder, privateFolder);
      });
    });
  });
};

/**
 * Create a folder with the provided visibility
 *
 * @param  {RestContext}    restContext     The REST context to use to create the folder
 * @param  {String}         visibility      The visibility that should be applied to the folder
 * @param  {Function}       callback        Standard callback function
 * @api private
 */
const _createFolderWithVisibility = function (restContext, visibility, callback) {
  const randomId = format('%s-%s', visibility, shortid.generate());
  const randomDisplayName = format('displayName-%s', randomId);
  const randomDescription = format('description-%s', randomId);
  RestAPI.Folders.createFolder(
    restContext,
    randomDisplayName,
    randomDescription,
    visibility,
    null,
    null,
    (error, folder) => {
      assert.notExists(error);
      return callback(folder);
    }
  );
};

/**
 * Get all the folders in all the libraries using the provided principal infos
 *
 * @param  {Object[]}   principalInfos                          An array of principal infos, containing the rest context of the user whose folder library to get
 * @param  {Function}   callback                                Standard callback function
 * @param  {Object}     callback.principalFolderLibraries       An object keyed by principal id, whose value is the array of all folders in that principal's folders library
 * @throws {AssertionError}                                     Thrown if there is an error getting all the folder libraries
 * @api private
 */
const _getAllFoldersInLibraries = function (principalInfos, callback, _principalIdFolders) {
  _principalIdFolders = _principalIdFolders || {};
  if (_.isEmpty(principalInfos)) {
    return callback(_principalIdFolders);
  }

  // Copy the input array so we don't destroy it during recursion
  principalInfos = principalInfos.slice();

  // Get the next principal and gather their folders
  const principalInfo = principalInfos.pop();
  getAllFoldersInLibrary(principalInfo.restContext, principalInfo.profile.id, null, (folders) => {
    // Add the folders to the array and recursively continue to the next
    _principalIdFolders[principalInfo.profile.id] = folders;
    return _getAllFoldersInLibraries(principalInfos, callback, _principalIdFolders);
  });
};

/**
 * Purge the folders libraries for the provided principals. @see LibraryTestUtil.assertPurgeFreshLibraries
 * for more information
 *
 * @param  {String[]}           principalIds    The ids of the principals whose folders libraries to purge
 * @param  {Function}           callback        Standard callback function
 * @throws {AssertionError}                     Thrown if there is an error purging the libraries
 * @api private
 */
const _purgeFoldersLibraries = function (principalIds, callback) {
  LibraryTestUtil.assertPurgeFreshLibraries(
    FoldersConstants.library.FOLDERS_LIBRARY_INDEX_NAME,
    principalIds,
    callback
  );
};

/**
 * Purge the folder content library for the specified folder. @see LibraryTestUtil.assertPurgeFreshLibraries
 * for more information
 *
 * @param  {String}             folderGroupId       The authz group id of the folder whose content library to purge
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Thrown if there is an error purging the library
 * @api private
 */
const _purgeFolderContentLibrary = function (folderId, callback) {
  // Before proceeding, we wait till the folder has been processed by the preview processor. We do this as the PP
  // needs the folder's content library to generate a thumbnail and we clear it out a few lines lower. If we weren't
  // to wait here, the PP might try to generate a thumbnail for a (temporarily) empty folder library. Note that this
  // shouldn't result in slower (non-PP) tests as the PP won't be bound to the folder generate queue thus
  // `whenTasksEmpty` will return immediately
  MQTestUtil.whenTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_FOLDER_PREVIEWS, () => {
    MQTestUtil.whenTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_FOLDER_PREVIEWS_PROCESSING, () => {
      FoldersDAO.getFoldersByIds([folderId], (error, folders) => {
        assert.notExists(error);
        return LibraryTestUtil.assertPurgeFreshLibraries(
          FoldersConstants.library.CONTENT_LIBRARY_INDEX_NAME,
          [_.first(folders).groupId],
          callback
        );
      });
    });
  });
};

/**
 * Convert the standard principal info object model into something more generic to work with. This
 * basically entails converting the `user` or `group` key which points to the user or group profile
 * (depending on the type of principal) to the key name `profile`
 *
 * TODO: We should change the result of both `generateTestGroups` and `generateTestUsers` to return
 * this generic model always, rather than a `user` and `group` key which is difficult to work with.
 * This has been deferred from the folders PR as the impact on the code base would be too big
 *
 * @param  {Object}     principalInfo   The principal info object to convert
 * @return {Object}                     A principal info object with a generic `profile` key instead of `user` or `group` key
 * @api private
 */
const _generalizePrincipalInfoModel = function (principalInfo) {
  if (!_.isObject(principalInfo)) {
    return principalInfo;
  }

  principalInfo = _.clone(principalInfo);

  if (principalInfo.user) {
    principalInfo.profile = principalInfo.user;
    delete principalInfo.user;
  } else if (principalInfo.group) {
    principalInfo.profile = principalInfo.group;
    delete principalInfo.group;
  }

  return principalInfo;
};

export {
  generateTestFolders,
  generateTestFoldersWithVisibility,
  setupMultiTenantPrivacyEntities,
  assertAddContentItemsToFolderSucceeds,
  assertAddContentItemsToFolderFails,
  assertAddContentItemToFoldersSucceeds,
  assertRemoveContentItemsFromFolderSucceeds,
  assertRemoveContentItemsFromFolderFails,
  assertCreateFolderFails,
  assertCreateFolderSucceeds,
  assertGetFolderFails,
  assertGetFolderSucceeds,
  assertUpdateFolderSucceeds,
  assertUpdateFolderFails,
  assertUpdateFolderContentVisibilityFails,
  assertDeleteFolderFails,
  assertDeleteFolderSucceeds,
  assertGetFolderContentLibraryFails,
  assertGetFolderContentLibrarySucceeds,
  assertFolderEquals,
  assertGetFolderMembersFails,
  assertGetAllFolderMembersSucceeds,
  assertGetFolderMembersSucceeds,
  assertGetAllFoldersLibrarySucceeds,
  assertGetFoldersLibrarySucceeds,
  assertGetFoldersLibraryFails,
  assertRemoveFolderFromLibraryFails,
  assertRemoveFolderFromLibrarySucceeds,
  assertShareFolderSucceeds,
  assertShareFolderFails,
  assertUpdateFolderMembersFails,
  assertUpdateFolderMembersSucceeds,
  assertFullFoldersLibraryEquals,
  assertFolderSearchEquals,
  assertGeneralFolderSearchEquals,
  assertFolderLibrarySearch,
  assertFolderSearchFails,
  assertFullFolderMembersEquals,
  getAllFoldersInLibrary,
  getAllFolderContentItems,
  getAllFolderMembers,
  assertCreateMessageFails,
  assertCreateMessageSucceeds,
  assertGetMessagesFails,
  assertGetMessagesSucceeds,
  assertDeleteMessageFails,
  assertDeleteMessageSucceeds
};
