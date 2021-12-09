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

import { promisify, callbackify } from 'node:util';
import ShortId from 'shortid';
import {
  not,
  reject,
  indexBy,
  map,
  pluck,
  mergeAll,
  isEmpty,
  defaultTo,
  pipe,
  prop,
  when,
  of,
  mergeRight
} from 'ramda';

import { getRolesForPrincipalAndResourceType } from 'oae-authz';
import { getPrincipalFromId, toId } from 'oae-authz/lib/util.js';
import {
  constructUpsertCQL,
  runBatchQuery,
  rowToHash,
  iterateAll as iterateResults,
  parsePreviewsFromRow,
  runQuery
} from 'oae-util/lib/cassandra.js';
import * as ContentDAO from 'oae-content/lib/internal/dao.js';
import { createGroupId } from 'oae-principals/lib/util.js';
import { getTenant } from 'oae-tenants';
import { Folder } from 'oae-folders/lib/model.js';

const { getMultipleContentItems } = ContentDAO.Content;

const defaultToEmptyObject = defaultTo({});
const compact = reject(pipe(Boolean, not));

const FOLDER_SYMBOL = 'f';
const CONTENT_SYMBOL = 'c';
const FOLDERS_TABLE = 'Folders';
const FOLDER_ID = 'folderId';
const ID = 'id';
const GROUP_ID = 'groupId';
const FOLDERS_GROUP_ID = 'FoldersGroupId';
const LAST_MODIFIED = 'lastModified';

/**
 * Create a folder
 *
 * @param  {String}         createdBy               The id of the user who is creating the folder
 * @param  {String}         displayName             The display name of the folder
 * @param  {String}         description             The description of the folder
 * @param  {String}         visibility              The visibility of the folder
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Folder}         callback.folder         The folder that was created
 */
const createFolder = function (createdBy, displayName, description, visibility, callback) {
  const { tenantAlias } = getPrincipalFromId(createdBy);
  const folderId = _createFolderId(tenantAlias);
  const groupId = createGroupId(tenantAlias);
  const now = Date.now();

  const storageHash = {
    tenantAlias,
    groupId,
    createdBy,
    displayName,
    description,
    visibility,
    created: now,
    lastModified: now
  };

  // Create the queries to insert both the folder and the record that indexes it with its surrogate group id
  const insertGroupIdIndexQuery = constructUpsertCQL(FOLDERS_GROUP_ID, GROUP_ID, groupId, { folderId });
  const insertFolderQuery = constructUpsertCQL(FOLDERS_TABLE, ID, folderId, storageHash);

  // Insert the surrogate group id index entry
  callbackify(runBatchQuery)([insertGroupIdIndexQuery, insertFolderQuery], (error) => {
    if (error) return callback(error);

    return callback(null, _storageHashToFolder(folderId, storageHash));
  });
};

/**
 * Get a list of folders by their ids
 *
 * @param  {String[]}       folderIds           The ids of the folders to get
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Folder[]}       callback.folders    The folders that are identified by the given ids. The folders will be located in the same order as the given array of ids
 */
const getFoldersByIds = function (folderIds, callback) {
  if (isEmpty(folderIds)) return callback(null, []);

  callbackify(runQuery)('SELECT * FROM "Folders" WHERE "id" IN ?', [folderIds], (error, rows) => {
    if (error) return callback(error);

    // Assemble the folders array, ensuring it is in the same order as the original ids
    const foldersById = pipe(map(_rowToFolder), indexBy(prop(ID)))(rows);
    const folders = pipe(
      map((folderId) => foldersById[folderId]),
      compact
    )(folderIds);

    return callback(null, folders);
  });
};

/**
 * Get a list of folders by their surrogate group ids
 *
 * @param  {String[]}       groupIds                The ids of the groups that identify the folders to get
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Folder[]}       callback.folders        The folders that are identified by the given list of group ids. The folders will be located in the same order as the given array of ids
 */
const getFoldersByGroupIds = function (groupIds, callback) {
  if (isEmpty(groupIds)) return callback(null, []);

  callbackify(runQuery)('SELECT * FROM "FoldersGroupId" WHERE "groupId" IN ?', [groupIds], (error, rows) => {
    if (error) return callback(error);

    // Assemble the folder ids, ensuring the original ordering is maintained
    const folderIdsByGroupIds = pipe(map(rowToHash), indexBy(prop(GROUP_ID)))(rows);
    const folderIds = pipe(
      map((groupId) => folderIdsByGroupIds[groupId]),
      compact,
      pluck(FOLDER_ID)
    )(groupIds);

    return getFoldersByIds(folderIds, callback);
  });
};

/**
 * Get a folder by its id
 *
 * @param  {String}     folderId            The id of the folder to retrieve
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Folder}     callback.folder     The request folder object
 */
const getFolder = function (folderId, callback) {
  getFoldersByIds([folderId], (error, folders) => {
    if (error) return callback(error);

    if (isEmpty(folders)) {
      return callback({
        code: 404,
        msg: `A folder with the id "${folderId}" could not be found`
      });
    }

    return callback(null, folders[0]);
  });
};

/**
 * Delete a folder
 *
 * @param  {String}     folderId            The id of the folder to delete
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const deleteFolder = function (folderId, callback) {
  callbackify(runQuery)('DELETE FROM "Folders" WHERE "id" = ?', [folderId], callback);
};

/**
 * Update the given folder
 *
 * @param  {Folder}     folder              The folder to update
 * @param  {Object}     profileFields       The profile fields and values with which to update the folder
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Folder}     callback.folder     The updated folder
 */
const updateFolder = function (folder, profileFields, callback) {
  const storageHash = mergeAll([{}, profileFields]);
  const defaultToNow = defaultTo(Date.now());

  storageHash.lastModified = pipe(prop(LAST_MODIFIED), defaultToNow)(storageHash);
  const query = constructUpsertCQL(FOLDERS_TABLE, ID, folder.id, storageHash);

  callbackify(runQuery)(query.query, query.parameters, (error) => {
    if (error) return callback(error);

    return callback(null, _createUpdatedFolderFromStorageHash(folder, storageHash));
  });
};

/**
 * Get a list of content items in a specified folder
 *
 * @param  {String}     folderGroupId           The id of the authz group associated to the folder whose content items to list
 * @param  {Object}     [opts]                  Optional arguments
 * @param  {String[]}   [opts.fields]           The list of fields to query for the content item. By default, all fields will be fetched
 * @param  {String}     [opts.start]            The token at which to start listing items for paging
 * @param  {Number}     [opts.limit]            The maximum number of content items to list
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object[]}   callback.contentItems   The content items that were fetched. Only the specified fields will appear on the object if they exist for the content item
 * @param  {String}     callback.nextToken      The value to use for `start` in subsequent requests to page through the items
 */
const getContentItems = function (folderGroupId, options, callback) {
  options = defaultToEmptyObject(options);

  /**
   * Query all the content ids ('c') to which the folder is directly associated in this batch of
   * paged resources. Since the group can be a member of both user groups and folder groups, we
   * filter down to just the folder groups for folder libraries
   */
  getRolesForPrincipalAndResourceType(
    folderGroupId,
    CONTENT_SYMBOL,
    options.start,
    options.limit,
    (error, roles, nextToken) => {
      if (error) return callback(error);

      // Get all the content items that we queried by id
      const ids = pluck(ID, roles);
      getMultipleContentItems(ids, options.fields, (error, contentItems) => {
        if (error) return callback(error);

        return callback(null, contentItems, nextToken);
      });
    }
  );
};

/**
 * Set the previews object for a given folder without updating the `lastModified`
 * timestamp on the folder
 *
 * @param  {Folder}     folder              The folder to update
 * @param  {Object}     previews            The previews object
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Folder}     callback.folder     The updated folder
 */
const setPreviews = function (folder, previews, callback) {
  const query = constructUpsertCQL(FOLDERS_TABLE, ID, folder.id, { previews });
  callbackify(runQuery)(query.query, query.parameters, (error) => {
    if (error) return callback(error);

    return callback(null, _createUpdatedFolderFromStorageHash(folder, { previews }));
  });
};

/**
 * Iterate through all the folders. This will return just the raw folder properties that are
 * specified in the `properties` parameter, and only `batchSize` folders at a time. On each
 * iteration of `batchSize` folders, the `onEach` callback will be invoked and the next batch
 * will not be fetched until you have invoked the `onEach.done` function parameter. When complete
 * (e.g., there are 0 folders left to iterate through or an error has occurred), the
 * `callback` parameter will be invoked
 *
 * @param  {String[]}   [properties]            The names of the folder properties to return in the folder objects. If not specified (or is empty array), it returns just the `id`s
 * @param  {Number}     [batchSize]             The number of folders to fetch at a time. Defaults to 100
 * @param  {Function}   onEach                  Invoked with each batch of folders that are fetched from storage
 * @param  {Object[]}   onEach.folderRow        An array of objects holding the raw folder rows that were fetched from storage
 * @param  {Function}   onEach.done             The function to invoke when processing of the current batch is complete
 * @param  {Object}     onEach.done.err         An error that occurred, if any, while processing the current batch. If you specify this error, iteration will finish and the completion callback will be invoked
 * @param  {Function}   [callback]              Invoked when all rows have been iterated, or an error has occurred
 * @param  {Object}     [callback.err]          An error that occurred, while iterating rows, if any
 * @see Cassandra#iterateAll
 */
const iterateAll = function (properties, batchSize, onEach, callback) {
  properties = when(isEmpty, () => of(ID))(properties);

  /*!
   * Handles each batch from the cassandra iterateAll method
   *
   * @see Cassandra#iterateAll
   */
  const _iterateAllOnEach = function (rows, done) {
    // Convert the rows to a hash and delegate action to the caller onEach method
    return onEach(map(rowToHash, rows), done);
  };

  callbackify(iterateResults)(properties, FOLDERS_TABLE, ID, { batchSize }, promisify(_iterateAllOnEach), callback);
};

/**
 * Given a base folder and an arbitrary key-value pair of updated values, create a version of
 * the folder with the updates applied
 *
 * @param  {Folder}     folder              The base folder to which the updates will be applied
 * @param  {Object}     updatedVersion  The updates to apply to the folder
 * @return {Folder}                         The updated folder
 * @api private
 */
const _createUpdatedFolderFromStorageHash = function (folder, updatedVersion) {
  folder = mergeRight(folder, updatedVersion);

  const { tenant, id, groupId, createdBy, displayName, description, visibility, created, lastModified, previews } =
    folder;

  // displayName = updatedVersion.displayName || folder.displayName;
  // description = updatedVersion.description || folder.description;
  // visibility = updatedVersion.visibility || folder.visibility;
  // lastModified = updatedVersion.lastModified || folder.lastModified;
  // previews = updatedVersion.previews || folder.previews;

  return new Folder(tenant, {
    id,
    groupId,
    createdBy,
    displayName,
    description,
    visibility,
    created,
    lastModified,
    previews
  });
};

/**
 * Convert a Helenus Row into a Folder object
 *
 * @param  {Row}            row     The row that was fetched from Cassandra
 * @return {Folder}                 The folder represented by the row
 * @api private
 */
const _rowToFolder = function (row) {
  const hash = parsePreviewsFromRow(row);
  return _storageHashToFolder(hash.id, hash);
};

/**
 * Given a simple storage hash, convert it into a Folder object with the provided id
 *
 * @param  {String}         id        The id to apply to the created folder object
 * @param  {Object}         storageHash     The simple key-value pair representing the fields of the folder
 * @return {Folder}                         The folder represented by the provided data
 * @api private
 */
const _storageHashToFolder = function (id, storageHash) {
  const { tenantAlias, groupId, createdBy, displayName, description, visibility, created, lastModified, previews } =
    storageHash;

  return new Folder(getTenant(tenantAlias), {
    id,
    groupId,
    createdBy,
    displayName,
    description,
    visibility,
    created,
    lastModified,
    previews
  });
};

/**
 * Generate a folder id for the given tenant alias
 *
 * @param  {String}     tenantAlias     The alias of the tenant for which to generate the folder id
 * @return {String}                     A randomly generated folder id
 * @api private
 */
const _createFolderId = function (tenantAlias) {
  return toId(FOLDER_SYMBOL, tenantAlias, ShortId.generate());
};

export {
  setPreviews,
  iterateAll,
  getContentItems,
  updateFolder,
  deleteFolder,
  getFolder,
  getFoldersByGroupIds,
  getFoldersByIds,
  createFolder
};
