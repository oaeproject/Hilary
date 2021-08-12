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
import ShortId from 'shortid';

import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as Cassandra from 'oae-util/lib/cassandra.js';
import { logger } from 'oae-logger';
import * as OaeUtil from 'oae-util/lib/util.js';
import * as TenantsAPI from 'oae-tenants';

import { Discussion } from 'oae-discussions/lib/model.js';

const log = logger('discussions-dao');

/**
 * Create a new discussion.
 *
 * @param  {String}     createdBy           The id of the user creating the discussion
 * @param  {String}     displayName         The display name of the discussion
 * @param  {String}     [description]       A longer description for the discussion
 * @param  {String}     [visibility]        The visibility of the discussion. One of public, loggedin, private. Defaults to the configured tenant default.
 * @param  {Object}     [opts]              Additional optional parameters
 * @param  {Number}     [opts.created]      When the discussion was created. If unspecified, will use the current timestamp
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Discussion} callback.discussion The discussion object that was created
 */
const createDiscussion = function (createdBy, displayName, description, visibility, options, callback) {
  options = options || {};

  let created = options.created || Date.now();
  created = created.toString();

  const { tenantAlias } = AuthzUtil.getPrincipalFromId(createdBy);
  const discussionId = _createDiscussionId(tenantAlias);
  const storageHash = {
    tenantAlias,
    createdBy,
    displayName,
    description,
    visibility,
    created,
    lastModified: created
  };

  const query = Cassandra.constructUpsertCQL('Discussions', 'id', discussionId, storageHash);
  Cassandra.runQuery(query.query, query.parameters, (error) => {
    if (error) {
      return callback(error);
    }

    return callback(null, _storageHashToDiscussion(discussionId, storageHash));
  });
};

/**
 * Update the basic profile of the specified discussion.
 *
 * @param  {Discussion} discussion          The discussion to update
 * @param  {Object}     profileFields       An object whose keys are profile field names, and the value is the value to which you wish the field to change
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Discussion} callback.discussion The updated discussion object
 */
const updateDiscussion = function (discussion, profileFields, callback) {
  const storageHash = _.extend({}, profileFields);
  storageHash.lastModified = storageHash.lastModified || Date.now();
  storageHash.lastModified = storageHash.lastModified.toString();

  const query = Cassandra.constructUpsertCQL('Discussions', 'id', discussion.id, storageHash);
  Cassandra.runQuery(query.query, query.parameters, (error) => {
    if (error) {
      return callback(error);
    }

    return callback(null, _createUpdatedDiscussionFromStorageHash(discussion, storageHash));
  });
};

/**
 * Get a discussion basic profile by its id.
 *
 * @param  {String}     discussionId        The id of the discussion to get
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Discussion} callback.discussion The discussion object requested
 */
const getDiscussion = function (discussionId, callback) {
  getDiscussionsById([discussionId], null, (error, discussions) => {
    if (error) {
      return callback(error);
    }

    return callback(null, discussions[0]);
  });
};

/**
 * Delete a discussion profile by its id.
 * This will *NOT* remove the discussion from the members their libraries.
 *
 * @param  {String}     discussionId        The id of the discussion to delete
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const deleteDiscussion = function (discussionId, callback) {
  log().info({ discussionId }, 'Discussion deleted');
  Cassandra.runQuery('DELETE FROM "Discussions" WHERE "id" = ?', [discussionId], callback);
};

/**
 * Get multiple discussions by their ids
 *
 * @param  {String[]}       discussionIds           The ids of the discussions to get
 * @param  {String[]}       [fields]                The discussion fields to select. If unspecified, selects all of them
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Discussion[]}   callback.discussions    The discussion objects requested, in the same order as the discussion ids
 */
const getDiscussionsById = function (discussionIds, fields, callback) {
  if (_.isEmpty(discussionIds)) {
    return callback(null, []);
  }

  let query = null;
  const parameters = [];

  // If `fields` was specified, we select only the fields specified. Otherwise we select all (i.e., *)
  if (fields) {
    const columns = _.map(fields, (field) => {
      return format('"%s"', field);
    });

    query = format('SELECT %s FROM "Discussions" WHERE "id" IN ?', columns.join(','));
  } else {
    query = 'SELECT * FROM "Discussions" WHERE "id" IN ?';
  }

  parameters.push(discussionIds);

  Cassandra.runQuery(query, parameters, (error, rows) => {
    if (error) {
      return callback(error);
    }

    // Convert the retrieved storage hashes into the Discussion model
    const discussions = {};
    _.chain(rows)
      .map(Cassandra.rowToHash)
      .each((row) => {
        discussions[row.id] = _storageHashToDiscussion(row.id, row);
      });

    // Order the discussions according to the array of discussion ids
    const orderedDiscussions = _.map(discussionIds, (discussionId) => {
      return discussions[discussionId];
    });

    return callback(null, orderedDiscussions);
  });
};

/**
 * Iterate through all the discussions. This will return just the raw discussion properties that are specified in the `properties`
 * parameter, and only `batchSize` discussions at a time. On each iteration of `batchSize` discussions, the `onEach` callback
 * will be invoked, and the next batch will not be fetched until you have invoked the `onEach.done` function parameter. When
 * complete (e.g., there are 0 discussions left to iterate through or an error has occurred), the `callback` parameter will be
 * invoked.
 *
 * @param  {String[]}   [properties]            The names of the discussion properties to return in the discussion objects. If not specified (or is empty array), it returns just the `discussionId`s
 * @param  {Number}     [batchSize]             The number of discussions to fetch at a time. Defaults to 100
 * @param  {Function}   onEach                  Invoked with each batch of discussions that are fetched from storage
 * @param  {Object[]}   onEach.discussionRows   An array of objects holding the raw discussion rows that were fetched from storage
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

  Cassandra.iterateAll(properties, 'Discussions', 'id', { batchSize }, _iterateAllOnEach, callback);
};

/**
 * Create a discussion model object from its id and the storage hash.
 *
 * @param  {String}     discussionId    The id of the discussion
 * @param  {Object}     hash            A simple object that represents the stored discussion object
 * @return {Discussion}                 The discussion model object. Returns `null` if this does not represent an existing discussion
 * @api private
 */
const _storageHashToDiscussion = function (discussionId, hash) {
  return new Discussion(
    TenantsAPI.getTenant(hash.tenantAlias),
    discussionId,
    hash.createdBy,
    hash.displayName,
    hash.description,
    hash.visibility,
    OaeUtil.getNumberParam(hash.created),
    OaeUtil.getNumberParam(hash.lastModified)
  );
};

/**
 * Create an updated discussion object from the provided one, with updates from the provided storage hash
 *
 * @param  {Discussion}     discussion  The discussion object to update
 * @param  {Object}         hash        A simple object that represents stored fields for the discussion
 * @return {Discussion}                 The updated discussion object
 * @api private
 */
const _createUpdatedDiscussionFromStorageHash = function (discussion, hash) {
  return new Discussion(
    discussion.tenant,
    discussion.id,
    discussion.createdBy,
    hash.displayName || discussion.displayName,
    hash.description || discussion.description,
    hash.visibility || discussion.visibility,
    OaeUtil.getNumberParam(discussion.created),
    OaeUtil.getNumberParam(hash.lastModified || discussion.lastModified)
  );
};

/**
 * Generate a new unique discussion id
 *
 * @param  {String}     tenantAlias     The tenant for which to to generate the id
 * @return {String}                     A unique discussion resource id
 * @api private
 */
const _createDiscussionId = function (tenantAlias) {
  return AuthzUtil.toId('d', tenantAlias, ShortId.generate());
};

export { createDiscussion, updateDiscussion, getDiscussion, deleteDiscussion, getDiscussionsById, iterateAll };
