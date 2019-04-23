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

/* eslint-disable unicorn/filename-case */
import _ from 'underscore'
import { types } from "cassandra-driver";

import * as LibraryAPI from 'oae-library'
import * as OaeUtil from 'oae-util/lib/util'
import { logger } from "oae-logger";

import { FoldersConstants } from '../constants'
import * as FoldersDAO from './dao'
const { Long } = types;
const log = logger('oae-folders-contentLibrary');;

/**
 * Get the ids of the folders in the folders library of a specified user or group
 *
 * @param  {User|Group}     principal               The user or group whose folders library to list
 * @param  {String}         visibility              The effective library visibility to list
 * @param  {Object}         [opts]                  Optional arguments for listing the library items
 * @param  {String}         [opts.start]            The token that indicates from where to start listing items
 * @param  {Number}         [opts.limit]            The maximum number of items to list
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {String[]}       callback.folderIds      The folder ids in the specified library
 * @param  {String}         callback.nextToken      The token to use for the `start` parameter for the next invocation to get the next page of results. If `null`, indicates that there are no more items to list
 */
// eslint-disable-next-line no-unused-vars */
const list = function(principal, visibility, opts, callback) {
  LibraryAPI.Index.list(
    FoldersConstants.library.FOLDERS_LIBRARY_INDEX_NAME,
    principal.id,
    visibility,
    { start: opts.start, limit: opts.limit },
    (err, entries, nextToken) => {
      if (err) {
        return callback(err);
      }

      return callback(null, _.pluck(entries, 'resourceId'), nextToken);
    }
  );
};

/**
 * Insert a folder into the libraries of all the provided user and group ids
 *
 * @param  {String[]}       principalIds    The ids of the users and groups whose libraries to insert the provided folder
 * @param  {Folder}         folder          The folder to insert
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
const insert = function(principalIds, folder, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error(
          {
            err,
            principalIds,
            folderId: folder.id
          },
          'Error inserting folder into principal libraries'
        );
      }
    };

  if (_.isEmpty(principalIds)) {
    return callback();
  }

  const entries = _.map(principalIds, principalId => {
    return {
      id: principalId,
      rank: folder.lastModified,
      resource: folder
    };
  });

  LibraryAPI.Index.insert(FoldersConstants.library.FOLDERS_LIBRARY_INDEX_NAME, entries, callback);
};

/**
 * Update the folder in the libraries of all the provided user and group ids
 *
 * @param  {String[]}       principalIds            The ids of the users and groups whose libraries should have the folder updated
 * @param  {Folder}         folder                  The folder to update
 * @param  {Number}         [oldLastModified]       The previous folder last modified time. If this is unspecified, this function will treat the last modified time of the provided folder as the "old last modified", and will update the folder's last modified time itself
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Folder}         callback.folder         The most recent version of the folder. As this function may conditionally update the last modified timestamp of the folder, this parameter will contain the updated version if it did. If it did not update the timestamp, this parameter will be the same folder that was provided in the `folder` parameter
 */
const update = function(principalIds, folder, oldLastModified, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error(
          {
            err,
            principalIds,
            folderId: folder.id
          },
          'Error updating folder for principal libraries'
        );
      }
    };

  // Do not perform a library update for no principals
  if (_.isEmpty(principalIds)) {
    return callback();
  }

  let touchFolder = true;
  if (oldLastModified instanceof Long) {
    // If the old last modified date was provided, we do not touch the folder. We update
    // the libraries using the old last modified and the last modified that is on the provided
    // folder
    touchFolder = false;
  } else {
    // If no old last modified date was provided, we touch the folder to update it and treat
    // the provided folder as the old version
    oldLastModified = folder.lastModified;
  }

  // If the caller specified we should "touch" the folder, we simply update its last modified
  // timestamp before updating the library indices
  OaeUtil.invokeIfNecessary(touchFolder, FoldersDAO.updateFolder, folder, {}, (err, updatedFolder) => {
    if (err) {
      return callback(err);
    }

    folder = updatedFolder || folder;

    const entries = _.map(principalIds, principalId => {
      return {
        id: principalId,
        oldRank: oldLastModified,
        newRank: folder.lastModified,
        resource: folder
      };
    });

    // Update the library entries for the provided principal ids
    LibraryAPI.Index.update(FoldersConstants.library.FOLDERS_LIBRARY_INDEX_NAME, entries, err => {
      if (err) {
        return callback(err);
      }

      return callback(null, folder);
    });
  });
};

/**
 * Remove the folder from the libraries of the provided user and group ids
 *
 * @param  {String[]}       principalIds    The ids of the users and groups whose libraries will have the folder removed
 * @param  {Folder}         folder          The folder to remove from the libraries
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
const remove = function(principalIds, folder, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error(
          {
            err,
            principalIds,
            folderId: folder.id
          },
          'Error removing folder from principal libraries'
        );
      }
    };

  if (_.isEmpty(principalIds) || !folder) {
    return callback();
  }

  const entries = _.map(principalIds, principalId => {
    return {
      id: principalId,
      rank: folder.lastModified,
      resource: folder
    };
  });

  LibraryAPI.Index.remove(FoldersConstants.library.FOLDERS_LIBRARY_INDEX_NAME, entries, callback);
};

export { list, insert, update, remove };
