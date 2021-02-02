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
import { format } from 'util';
import _ from 'underscore';

import * as Cassandra from 'oae-util/lib/cassandra';
import * as OaeUtil from 'oae-util/lib/util';

import { Revision } from 'oae-content/lib/model';
import * as ContentPreviewsDAO from './dao.previews';

/// ////////////
// Retrieval //
/// ////////////

/**
 * Get a set of revisions
 *
 * @param  {String}         contentId           The id of the object for which we want to get the revisions
 * @param  {Number}         [start]             Determines the point at which revisions are returned for paging purposes. If not provided, the first `limit` elements will be returned. The `created` value from the last retrieved revision should be used here.
 * @param  {Number}         [limit]             Number of revisions to return. Will default to 10 if not provided
 * @param  {Object}         [opts]              Additional options
 * @param  {String[]}       [opts.fields]       Columns to fetch from cassandra if none are specified all will be fetched
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Revision[]}     callback.revisions  Array that contains an object for each revision.
 * @param  {String}         callback.nextToken  The value to provide in the `start` parameter to get the next set of results
 */
const getRevisions = function (contentId, start, limit, options, callback) {
  limit = OaeUtil.getNumberParam(limit, 10);
  start = start || '';

  Cassandra.runPagedQuery(
    'RevisionByContent',
    'contentId',
    contentId,
    'created',
    start,
    limit,
    { reversed: true },
    (error, rows, nextToken) => {
      if (error) {
        return callback(error);
      }

      if (_.isEmpty(rows)) {
        return callback(null, []);
      }

      // Extract the revision ids to retrieve and the nextToken, if any
      const revisionsToRetrieve = _.chain(rows).map(Cassandra.rowToHash).pluck('revisionId').value();

      // Get the full revisions and return
      getMultipleRevisions(revisionsToRetrieve, options, (error, revisions) => {
        if (error) {
          return callback(error);
        }

        return callback(null, revisions, nextToken);
      });
    }
  );
};

/**
 * Retrieve multiple revisions
 *
 * @param  {String[]}       revisionIds         An array of revision IDs that should be retrieved
 * @param  {Object}         [opts]              Additional options
 * @param  {String[]}       [opts.fields]       Columns to get from cassandra if not specified all will be fetched
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Revision[]}     callback.revisions  Array that contains an object for each revision
 */
const getMultipleRevisions = function (revisionIds, options, callback) {
  let columns = '*';

  // If specific fields were specified, convert it into the string: "field0","field1","field2",...
  if (options && options.fields) {
    // Ensure opts.fields is a proper array
    options.fields = OaeUtil.toArray(options.fields);

    // Always fetch the revisionId
    options.fields = _.union(options.fields, ['revisionId']);
    columns = format('"%s"', options.fields.join('","'));
  }

  Cassandra.runQuery(
    format('SELECT %s FROM "Revisions" WHERE "revisionId" IN ?', columns),
    [revisionIds],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      // Generate the Revision objects
      let revisions = _.map(rows, _rowToRevision);

      // The above query doesn't respect the order of revisionIds, hence this DESC sort
      revisions = _.sortBy(revisions, (eachRevision) => {
        return eachRevision.created * -1;
      });
      return callback(null, revisions);
    }
  );
};

/**
 * Get all revisions for the specified content IDs
 *
 * @param  {String[]}   contentIds          An array of content IDs
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Object}     callback.revisions  An object where arrays of revisions are keyed by their content ID
 */
const getAllRevisionsForContent = function (contentIds, callback) {
  Cassandra.runQuery(
    'SELECT "contentId", "revisionId" FROM "RevisionByContent" WHERE "contentId" IN ?',
    [contentIds],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      if (_.isEmpty(rows)) {
        return callback(null, {});
      }

      // Get the revision IDs
      const revisionIds = [];
      const contentByRevisions = {};
      _.chain(rows)
        .map(Cassandra.rowToHash)
        .each((row) => {
          revisionIds.push(row.revisionId);
          contentByRevisions[row.revisionId] = row.contentId;
        });

      // Get the revision objects
      getMultipleRevisions(revisionIds, null, (error, revisions) => {
        if (error) {
          return callback(error);
        }

        const revisionsByContent = {};
        _.each(revisions, (revision) => {
          const contentId = contentByRevisions[revision.revisionId];
          revisionsByContent[contentId] = revisionsByContent[contentId] || [];
          revisionsByContent[contentId].push(revision);
        });

        return callback(null, revisionsByContent);
      });
    }
  );
};

/**
 * Get a specific revision
 *
 * @param  {String}     revisionId          The ID of the revision to retrieve
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Revision}   callback.revision   The retrieved revision
 */
const getRevision = function (revisionId, callback) {
  Cassandra.runQuery('SELECT * FROM "Revisions" WHERE "revisionId" = ?', [revisionId], (error, rows) => {
    if (error) {
      return callback(error);
    }

    if (_.isEmpty(rows)) {
      return callback({ code: 404, msg: "Couldn't find revision: " + revisionId });
    }

    return callback(null, _rowToRevision(rows[0]));
  });
};

/// ////////////
// Modifiers //
/// ////////////

/**
 * Create a new revision in the database.
 *
 * @param  {String}     revisionId              The id to assign to the revision
 * @param  {String}     contentId               The contentId this revision is for
 * @param  {String}     createdBy               The ID of the user who created this revision
 * @param  {Revision}   [revision]              Properties to apply to the revision that is created. All standard Revision object properties can be persisted except `downloadPath` which will be omitted from persistence
 * @param  {Function}   [callback]              An optional callback method
 * @param  {Object}     [callback.err]          An error object (if any)
 * @param  {Revision}   [callback.revision]     A revision object
 */
const createRevision = function (revisionId, contentId, createdBy, revisionProperties, callback) {
  // Copy all the revision properties to persist. The `downloadPath` property is transient so we do not persist it, and the
  // `revisionId` will be updated to the provided `revisionId` parameter, so we ensure that is not persisted as well
  const values = _.omit(revisionProperties, 'revisionId', 'downloadPath');

  // Override some new values for the new revision
  values.contentId = contentId;
  values.created = Date.now().toString();
  values.createdBy = createdBy;
  values.previewsId = revisionProperties.previewsId || revisionId;

  // Copy the preview item metadata from the source to the destination
  _copyPreviewItemsIfNecessary(revisionProperties.revisionId, revisionId, (error) => {
    if (error) {
      return callback(error);
    }

    const q = Cassandra.constructUpsertCQL('Revisions', 'revisionId', revisionId, values);
    Cassandra.runQuery(q.query, q.parameters, (error) => {
      if (error) {
        return callback(error);
      }

      // Add the revision to the revisions listing for the content item
      Cassandra.runQuery(
        'INSERT INTO "RevisionByContent" ("contentId", "created", "revisionId") VALUES (?, ?, ?)',
        [contentId, values.created, revisionId],
        (error) => {
          if (error) {
            return callback(error);
          }

          return callback(null, new Revision(contentId, revisionId, values.createdBy, values.created, values));
        }
      );
    });
  });
};

/// ////////////////////
// Utility functions //
/// ////////////////////

/**
 * Copy the preview items from the source revision to the destination revision, only if the source revision is specified. This
 * will fail silently if the source revision was not specified
 *
 * @param  {String}     [fromRevisionId]    The id of the revision from which to copy the preview items
 * @param  {String}     toRevisionId        The id of the destination revision, where the preview items will be copied
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @api private
 */
const _copyPreviewItemsIfNecessary = function (fromRevisionId, toRevisionId, callback) {
  if (!fromRevisionId) {
    // There is no source (i.e., there is no revision from which to copy), so simply do nothing and return ok
    return callback();
  }

  ContentPreviewsDAO.copyPreviewItems(fromRevisionId, toRevisionId, callback);
};

/**
 * Convert a Cassandra Row to a Revision object
 *
 * @param  {Row}        row     A Helenus Row
 * @return {Revision}           A revision object or null if the column could not be converted
 * @api private
 */
const _rowToRevision = function (row) {
  const hash = Cassandra.parsePreviewsFromRow(row);
  return new Revision(hash.contentId, hash.revisionId, hash.createdBy, hash.created, hash);
};

export { getRevisions, getMultipleRevisions, getAllRevisionsForContent, getRevision, createRevision };
