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

import { callbackify } from 'node:util';
import _ from 'underscore';

import { runQuery, rowToHash, constructUpsertCQL, runBatchQuery } from 'oae-util/lib/cassandra.js';
import { Validator as validator } from 'oae-util/lib/validator.js';

const { unless, isResourceId } = validator;

/// ////////////
// Retrieval //
/// ////////////

/**
 * Get an array of preview items.
 *
 * @param  {String}     revisionId          The ID of a revision for which the preview items should be retrieved.
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Object[]}   callback.previews   The preview objects.
 */
const getContentPreviews = function (revisionId, callback) {
  callbackify(runQuery)(
    'SELECT "name", "value" FROM "PreviewItems" WHERE "revisionId" = ?',
    [revisionId],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      const previews = _.map(rows, (row) => {
        row = rowToHash(row);
        row.value = row.value.split('#');
        return {
          size: row.value[0],
          uri: row.value[1],
          filename: row.name
        };
      });

      return callback(null, previews);
    }
  );
};

/**
 * Get a specific content preview.
 *
 * @param  {String}     revisionId          The ID of a revision for which a preview item should be retrieved.
 * @param  {String}     previewItem         The name of the preview item that should be retrieved.
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Object}     callback.preview    The preview object.
 */
const getContentPreview = function (revisionId, previewItem, callback) {
  callbackify(runQuery)(
    'SELECT "value" FROM "PreviewItems" WHERE "revisionId" = ? AND "name" = ?',
    [revisionId, previewItem],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      if (_.isEmpty(rows)) {
        return callback({
          code: 404,
          msg: "Couldn't find item " + previewItem + ' for revisionId: ' + revisionId
        });
      }

      const data = rows[0].get('value').split('#');
      callback(null, {
        size: data[0],
        uri: data[1]
      });
    }
  );
};

/**
 * Gets the preview Uris for a set of revision IDs.
 *
 * @param  {String[]} revisionIds           The revision IDs
 * @param  {Function} callback              Standard callback function
 * @param  {Object}   callback.err          An error that occurred, if any
 * @param  {Object}   callback.previews     Object where each key is a revision id and the value is another object with the thumbnailUri and wideUri.
 */
const getPreviewUris = function (revisionIds, callback) {
  revisionIds = _.uniq(revisionIds);
  if (_.isEmpty(revisionIds)) {
    return callback(null, {});
  }

  callbackify(runQuery)(
    'SELECT "revisionId", "thumbnailUri", "wideUri" FROM "Revisions" WHERE "revisionId" IN ?',
    [revisionIds],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      const previews = {};
      for (const row of rows) {
        const revisionId = row.get('revisionId');
        previews[revisionId] = {};

        const thumbnailUri = row.get('thumbnailUri');
        if (thumbnailUri) {
          previews[revisionId].thumbnailUri = thumbnailUri;
        }

        const wideUri = row.get('wideUri');
        if (wideUri) {
          previews[revisionId].wideUri = wideUri;
        }
      }

      return callback(null, previews);
    }
  );
};

/// ////////////
// Modifiers //
/// ////////////

/**
 * Stores preview metadata on the Content object in Cassandra with the following process:
 *
 *  1. Remove old preview items associated to the piece of content (if any)
 *  2. Store the new preview URIs (if any)
 *  3. Update the previews object in the Content CF
 *  4. Update the previews object in the Revisions CF
 *
 * @param  {Content}     contentObj      The content object whose preview data should be set
 * @param  {String}      revisionId      The revision ID of the piece of content for which we need to update the preview metadata
 * @param  {String}      status          The result of the preview processing operation. It should be one of the values of ContentConstants.previews
 * @param  {String}      thumbnailUri    The uri of a thumbnail
 * @param  {Object}      metadata        Each key corresponds to a string value that should be stored on the content object
 * @param  {Object}      fileData        Each key corresponds to a filename, the value is of the form 'size#uri'
 * @param  {Function}    callback        Standard callback function
 * @param  {Object}      callback.err    An error that occurred, if any
 */
const storeMetadata = function (
  contentObject,
  revisionId,
  status,
  thumbnailUri,
  contentMetadata,
  previewMetadata,
  fileData,
  callback
) {
  let deleteQuery = null;
  const queries = [];

  // 1. Remove the old previews
  if (contentObject.previews.total && contentObject.previews.total > 0) {
    deleteQuery = {
      query: 'DELETE FROM "PreviewItems" WHERE "revisionId" = ?',
      parameters: [revisionId]
    };
  }

  // 2. Add in the new preview items, if any
  _.each(fileData, (value, name) => {
    // The keys of the file data are the second part of a compound key. This ensures they are ordered properly. This is to support
    // ALPHABETICAL ordering for paging cases such as page001.html, page002.html, page003.html etc...
    queries.push({
      query: 'INSERT INTO "PreviewItems" ("revisionId", "name", "value") VALUES (?, ?, ?)',
      parameters: [revisionId, name, value]
    });
  });

  // 3. Store the previews object
  const data = { status, total: _.keys(fileData).length };

  // Set the thumbnail URI if we have one
  if (thumbnailUri) {
    data.thumbnailUri = thumbnailUri;
  }

  // Pass in data second, in case previewMetadata contains a status or thumbnailUri key
  let previews = _.extend({}, previewMetadata, data);
  contentObject.previews = previews;

  previews = JSON.stringify(previews);
  const contentUpdate = _.extend({}, contentMetadata, { previews });
  queries.push(constructUpsertCQL('Content', 'contentId', contentObject.id, contentUpdate));

  // 4. Store the previews object on the revision
  const revisionUpdate = {
    status,
    previews
  };
  if (thumbnailUri) {
    revisionUpdate.thumbnailUri = thumbnailUri;
  }

  // We save the wide and medium URIs on the revision object as well
  if (previewMetadata.wideUri) {
    revisionUpdate.wideUri = previewMetadata.wideUri;
  }

  if (previewMetadata.mediumUri) {
    revisionUpdate.mediumUri = previewMetadata.mediumUri;
  }

  queries.push(constructUpsertCQL('Revisions', 'revisionId', revisionId, revisionUpdate));

  // First delete the existing previews
  _runQueryIfSpecified(deleteQuery, (error) => {
    if (error) return callback(error);

    // Add the specified preview items
    callbackify(runBatchQuery)(queries, callback);
  });
};

/**
 * Copy the preview item metadata from the source revision to the destination revision.
 *
 * @param  {String}     fromRevisionId      The id of the revision from which to copy the preview items
 * @param  {String}     toRevisionId        The id of the destination revision, where the preview items will be copied
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @api private
 */
const copyPreviewItems = function (fromRevisionId, toRevisionId, callback) {
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'Must specify a valid resource id for "fromRevisionId"'
    })(fromRevisionId);

    unless(isResourceId, {
      code: 400,
      msg: 'Must specify a valid resource id for "toRevisionId"'
    })(toRevisionId);
  } catch (error) {
    return callback(error);
  }

  /**
   *  Select all the rows from the source revision preview items,
   * then insert them into the destination revision preview items
   */
  callbackify(runQuery)('SELECT * FROM "PreviewItems" WHERE "revisionId" = ?', [fromRevisionId], (error, rows) => {
    if (error) {
      return callback(error);
    }

    if (_.isEmpty(rows)) {
      return callback();
    }

    // Copy the content over to the target revision id
    const queries = _.map(rows, (row) => {
      row = rowToHash(row);
      return {
        query: 'INSERT INTO "PreviewItems" ("revisionId", "name", "value") VALUES (?, ?, ?)',
        parameters: [toRevisionId, row.name, row.value]
      };
    });

    return callbackify(runBatchQuery)(queries, callback);
  });
};

/**
 * Run the given query only if it has been specified
 *
 * @param  {Object}     [query]         The query to run. If not specified, this method effectively does nothing
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _runQueryIfSpecified = function (query, callback) {
  if (!query) {
    return callback();
  }

  callbackify(runQuery)(query.query, query.parameters, callback);
};

/**
 * Returns the URI for a file of a given size.
 * If the file could not be found, null will be returned
 *
 * @param  {Object} fileData Each key corresponds to a filename, the value is of the form 'size#uri'.
 * @param  {String} size     The size of the image for which we need to find the URI.
 * @return {String}          The URI for the stored file (or null).
 * @api private
 */
// eslint-disable-next-line no-unused-vars
const _getUriInFileData = function (fileData, size) {
  // eslint-disable-next-line no-unused-vars
  const file = _.find(fileData, (value, filename) => value.indexOf(size + '#') === 0);
  if (file) {
    // Get the uri out of the wide file data string.
    // file data is of the form '<size>#<uri>'.
    // Rather than doing file.split('#')[1], slice of the name and return the rest of string
    // to prevent not getting the full URI if it would ever contain a '#'.
    return file.split('#').slice(1).join('#');
  }

  return null;
};

export { getContentPreviews, getContentPreview, getPreviewUris, storeMetadata, copyPreviewItems };
