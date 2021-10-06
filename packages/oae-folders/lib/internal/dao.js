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

/* eslint-disable unicorn/no-array-callback-reference */
import { format } from 'node:util';
import _ from 'underscore';
import ShortId from 'shortid';

import * as AuthzAPI from 'oae-authz';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as Cassandra from 'oae-util/lib/cassandra.js';
import * as ContentDAO from 'oae-content/lib/internal/dao.js';
import * as PrincipalsUtil from 'oae-principals/lib/util.js';
import * as TenantsAPI from 'oae-tenants';

import { Folder } from 'oae-folders/lib/model.js';

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
  const { tenantAlias } = AuthzUtil.getPrincipalFromId(createdBy);
  const folderId = _createFolderId(tenantAlias);
  const groupId = PrincipalsUtil.createGroupId(tenantAlias);
  const created = Date.now();
  const storageHash = {
    tenantAlias,
    groupId,
    createdBy,
    displayName,
    description,
    visibility,
    created,
    lastModified: created
  };

  // Create the queries to insert both the folder and the record that indexes it with its surrogate group id
  const insertGroupIdIndexQuery = Cassandra.constructUpsertCQL('FoldersGroupId', 'groupId', groupId, { folderId });
  const insertFolderQuery = Cassandra.constructUpsertCQL('Folders', 'id', folderId, storageHash);

  // Insert the surrogate group id index entry
  Cassandra.runBatchQuery([insertGroupIdIndexQuery, insertFolderQuery], (error) => {
    if (error) {
      return callback(error);
    }

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
  if (_.isEmpty(folderIds)) {
    return callback(null, []);
  }

  Cassandra.runQuery('SELECT * FROM "Folders" WHERE "id" IN ?', [folderIds], (error, rows) => {
    if (error) {
      return callback(error);
    }

    // Assemble the folders array, ensuring it is in the same order as the original ids
    const foldersById = _.chain(rows).map(_rowToFolder).indexBy('id').value();
    const folders = _.chain(folderIds)
      .map((folderId) => foldersById[folderId])
      .compact()
      .value();

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
  if (_.isEmpty(groupIds)) {
    return callback(null, []);
  }

  Cassandra.runQuery('SELECT * FROM "FoldersGroupId" WHERE "groupId" IN ?', [groupIds], (error, rows) => {
    if (error) {
      return callback(error);
    }

    // Assemble the folder ids, ensuring the original ordering is maintained
    const folderIdsByGroupIds = _.chain(rows).map(Cassandra.rowToHash).indexBy('groupId').value();
    const folderIds = _.chain(groupIds)
      .map((groupId) => folderIdsByGroupIds[groupId])
      .compact()
      .pluck('folderId')
      .value();

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
    if (error) {
      return callback(error);
    }

    if (_.isEmpty(folders)) {
      return callback({
        code: 404,
        msg: format('A folder with the id "%s" could not be found', folderId)
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
  Cassandra.runQuery('DELETE FROM "Folders" WHERE "id" = ?', [folderId], callback);
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
  const storageHash = _.extend({}, profileFields);
  storageHash.lastModified = storageHash.lastModified || Date.now();

  const query = Cassandra.constructUpsertCQL('Folders', 'id', folder.id, storageHash);
  Cassandra.runQuery(query.query, query.parameters, (error) => {
    if (error) {
      return callback(error);
    }

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
  options = options || {};

  // Query all the content ids ('c') to which the folder is directly associated in this batch of
  // paged resources. Since the group can be a member of both user groups and folder groups, we
  // filter down to just the folder groups for folder libraries
  AuthzAPI.getRolesForPrincipalAndResourceType(
    folderGroupId,
    'c',
    options.start,
    options.limit,
    (error, roles, nextToken) => {
      if (error) {
        return callback(error);
      }

      // Get all the content items that we queried by id
      const ids = _.pluck(roles, 'id');
      ContentDAO.Content.getMultipleContentItems(ids, options.fields, (error, contentItems) => {
        if (error) {
          return callback(error);
        }

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
  const query = Cassandra.constructUpsertCQL('Folders', 'id', folder.id, { previews });
  Cassandra.runQuery(query.query, query.parameters, (error) => {
    if (error) {
      return callback(error);
    }

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
  if (_.isEmpty(properties)) {
    properties = ['id'];
  }

  /*!
   * Handles each batch from the cassandra iterateAll method
   *
   * @see Cassandra#iterateAll
   */
  const _iterateAllOnEach = function (rows, done) {
    // Convert the rows to a hash and delegate action to the caller onEach method
    return onEach(_.map(rows, Cassandra.rowToHash), done);
  };

  Cassandra.iterateAll(properties, 'Folders', 'id', { batchSize }, _iterateAllOnEach, callback);
};

/**
 * Given a base folder and an arbitrary key-value pair of updated values, create a version of
 * the folder with the updates applied
 *
 * @param  {Folder}     folder              The base folder to which the updates will be applied
 * @param  {Object}     updatedStorageHash  The updates to apply to the folder
 * @return {Folder}                         The updated folder
 * @api private
 */
const _createUpdatedFolderFromStorageHash = function (folder, updatedStorageHash) {
  return new Folder(
    folder.tenant,
    folder.id,
    folder.groupId,
    folder.createdBy,
    updatedStorageHash.displayName || folder.displayName,
    updatedStorageHash.description || folder.description,
    updatedStorageHash.visibility || folder.visibility,
    folder.created,
    updatedStorageHash.lastModified || folder.lastModified,
    updatedStorageHash.previews || folder.previews
  );
};

/**
 * Convert a Helenus Row into a Folder object
 *
 * @param  {Row}            row     The row that was fetched from Cassandra
 * @return {Folder}                 The folder represented by the row
 * @api private
 */
const _rowToFolder = function (row) {
  const hash = Cassandra.parsePreviewsFromRow(row);
  return _storageHashToFolder(hash.id, hash);
};

/**
 * Given a simple storage hash, convert it into a Folder object with the provided id
 *
 * @param  {String}         folderId        The id to apply to the created folder object
 * @param  {Object}         storageHash     The simple key-value pair representing the fields of the folder
 * @return {Folder}                         The folder represented by the provided data
 * @api private
 */
const _storageHashToFolder = function (folderId, storageHash) {
  return new Folder(
    TenantsAPI.getTenant(storageHash.tenantAlias),
    folderId,
    storageHash.groupId,
    storageHash.createdBy,
    storageHash.displayName,
    storageHash.description,
    storageHash.visibility,
    storageHash.created,
    storageHash.lastModified,
    storageHash.previews
  );
};

/**
 * Generate a folder id for the given tenant alias
 *
 * @param  {String}     tenantAlias     The alias of the tenant for which to generate the folder id
 * @return {String}                     A randomly generated folder id
 * @api private
 */
const _createFolderId = function (tenantAlias) {
  return AuthzUtil.toId('f', tenantAlias, ShortId.generate());
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
