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

import _ from 'underscore';

import { logger } from 'oae-logger';
import * as Cassandra from 'oae-util/lib/cassandra';

const log = logger('authz-delete');

/**
 * Indicate that the provided `resourceId` has been deleted
 *
 * @param  {String}     resourceId      The id of the resource that has been deleted
 * @param  {Function}   [callback]      Standard callback function
 * @param  {Object}     [callback.err]  An error that occurred, if any
 */
const setDeleted = function(resourceId, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        return log().error({ err, resourceId }, 'An error occurred while trying to set a resource as deleted');
      }
    };

  return Cassandra.runQuery(
    'UPDATE "AuthzDeleted" SET "deleted" = ? WHERE "resourceId" = ?',
    [true, resourceId],
    callback
  );
};

/**
 * Indicate that the provided `resourceId` has been restored
 *
 * @param  {String}     resourceId      The id of the resource that has been restored
 * @param  {Function}   [callback]      Standard callback function
 * @param  {Object}     [callback.err]  An error that occurred, if any
 */
const unsetDeleted = function(resourceId, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        return log().error({ err, resourceId }, 'An error occurred while trying to unset a resource as deleted');
      }
    };

  return Cassandra.runQuery('DELETE FROM "AuthzDeleted" WHERE "resourceId" = ?', [resourceId], callback);
};

/**
 * Check if a set of resource ids have been marked as deleted
 *
 * @param  {String[]}   resourceIds         The ids of the resources to check if they've been deleleted
 * @param  {Functino}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Object}     callback.deleted    A hash keyed by resource id, whose value is `true` if the resource has been deleted
 */
const isDeleted = function(resourceIds, callback) {
  if (_.isEmpty(resourceIds)) {
    return callback(null, {});
  }

  Cassandra.runQuery(
    'SELECT "resourceId", "deleted" FROM "AuthzDeleted" WHERE "resourceId" in ?',
    [resourceIds],
    (err, rows) => {
      if (err) {
        return callback(err);
      }

      const deletedResourceIds = {};
      _.chain(rows)
        .map(Cassandra.rowToHash)
        .filter(row => {
          return row.deleted === true;
        })
        .pluck('resourceId')
        .each(resourceId => {
          deletedResourceIds[resourceId] = true;
        });

      return callback(null, deletedResourceIds);
    }
  );
};

export { setDeleted, unsetDeleted, isDeleted };
