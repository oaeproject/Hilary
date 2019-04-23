/*!
 * Copyright 2018 Apereo Foundation (AF) Licensed under the
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
import * as Redis from 'oae-util/lib/redis';
import { logger } from 'oae-logger';

const log = logger('oae-ethercalc');

/**
 * Check whether a particular user has edited an Ethercalc spreadsheet
 *
 * @param  {String}     contentId           The ID of the OAE content item that may have been edited
 * @param  {String}     userId              The ID of the OAE user who may have edited the room
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.edit       Has this OAE user made edits to this content item?
 */
const hasUserEditedSpreadsheet = function(contentId, userId, callback) {
  const key = _getEditMappingKey(contentId);
  const client = Redis.getClient();
  client.exists(key, function(err, exists) {
    if (err) {
      log().error({ err, contentId, userId }, 'Failed to check whether user has edited Ethercalc spreadsheet');
      return callback({
        code: 500,
        msg: 'Failed to check whether user has edited Ethercalc spreadsheet'
      });
    }

    if (exists) {
      client.lrange(key, 0, -1, function(err, replies) {
        if (err) {
          log().error({ err, contentId, userId }, 'Failed to fetch editors for Ethercalc spreadsheet');
          return callback({
            code: 500,
            msg: 'Failed to fetch editors for Ethercalc spreadsheet'
          });
        }

        if (_.contains(replies, userId)) {
          // Let's take out the references to this user's edits since we're sending out a notification
          client.lrem(key, 0, userId, function(err) {
            if (err) {
              log().error(
                {
                  err,
                  contentId,
                  userId
                },
                'Failed purge cache of user edits to Ethercalc spreadsheet'
              );
              return callback({
                code: 500,
                msg: 'Failed purge cache of user edits to Ethercalc spreadsheet'
              });
            }

            // This user has edited the document
            return callback(null, true);
          });
        }

        // There are edits, but not from this user
        return callback(null, false);
      });
    }

    // There are no edits recorded for this document
    return callback(null, false);
  });
};

/**
 * Store information about which user edited an Ethercalc spreadsheet
 *
 * @param  {String}     contentId           The ID of the OAE content item that was edited
 * @param  {String}     userId              The ID of the OAE user who edited the room
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const setEditedBy = function(contentId, userId, callback) {
  const key = _getEditMappingKey(contentId);
  Redis.getClient().rpush(key, userId, function(err) {
    if (err) {
      log().error({ err, contentId, userId }, 'Failed to store Ethercalc user edits');
      return callback({
        code: 500,
        msg: 'Failed to store Ethercalc user edits'
      });
    }

    return callback();
  });
};

/**
 * Get the Redis key used to map OAE user IDs to editors of content item

 * @param  {String}     contentId           The ID of the OAE content item that was edited
 * @return {String}                         The Redis key used to map the Ethercalc author to the corresponding OAE user ID
 * @api private
 */
const _getEditMappingKey = function(contentId) {
  return `ethercalc:edits:${contentId}`;
};

export { hasUserEditedSpreadsheet, setEditedBy };
