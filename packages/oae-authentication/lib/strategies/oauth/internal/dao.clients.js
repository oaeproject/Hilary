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
import _ from 'underscore';

import * as Cassandra from 'oae-util/lib/cassandra.js';

import { Client } from '../model.js';

/**
 * Creates a client.
 * The id and secret for the client will be generated and returned to you as part of
 * the client object in the callback.
 *
 * @param  {String}     id                  The id for this client
 * @param  {String}     displayName         A descriptive name for this client
 * @param  {String}     secret              The secret token for this client
 * @param  {String}     userId              The ID of the user who owns this client
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Client}     callback.client     The created client
 */
const createClient = function (id, displayName, secret, userId, callback) {
  // Insert the OAuth client and its association to the user
  const queries = [
    Cassandra.constructUpsertCQL('OAuthClient', 'id', id, {
      displayName,
      secret,
      userId
    }),
    Cassandra.constructUpsertCQL('OAuthClientsByUser', ['userId', 'clientId'], [userId, id], {
      value: '1'
    })
  ];

  Cassandra.runBatchQuery(queries, (error) => {
    if (error) {
      return callback(error);
    }

    return callback(null, new Client(id, displayName, secret, userId));
  });
};

/**
 * Updates an existing client.
 * At least one of `displayName` or `secret` has to be specified
 *
 * @param  {String}     id                  The client ID
 * @param  {String}     [displayName]       The new name of the client
 * @param  {String}     [secret]            The new secret of the client
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const updateClient = function (id, displayName, secret, callback) {
  const query = Cassandra.constructUpsertCQL('OAuthClient', 'id', id, {
    displayName,
    secret
  });
  Cassandra.runQuery(query.query, query.parameters, callback);
};

/**
 * Delete a client
 *
 * @param  {String}     id              The ID of the client to remove
 * @param  {String}     userId          The ID of the user who owns this client
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const deleteClient = function (id, userId, callback) {
  const queries = [
    { query: 'DELETE FROM "OAuthClient" WHERE "id" = ?', parameters: [id] },
    {
      query: 'DELETE FROM "OAuthClientsByUser" WHERE "userId" = ? AND "clientId" = ?',
      parameters: [userId, id]
    }
  ];
  Cassandra.runBatchQuery(queries, callback);
};

/**
 * Retrieve a client by its id
 *
 * @param  {String}     id                The ID of the client to retrieve
 * @param  {Function}   callback          Standard callback function
 * @param  {Object}     callback.err      An error that occurred, if any
 * @param  {Client}     callback.client   The retrieved client or null if it could not be found
 */
const getClientById = function (id, callback) {
  // TODO: As this gets called on every OAuth authenticated call, it might not be a bad idea to cache this in Redis
  _getClientsByIds([id], (error, clients) => {
    if (error) {
      return callback(error);
    }

    if (_.isEmpty(clients)) {
      return callback();
    }

    return callback(null, clients[0]);
  });
};

/**
 * Get the list of clients for a user
 *
 * @param  {String}     userId              The ID of the user for whom the retrieve the client
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Client[]}   callback.clients    The set of clients that are registered for this user
 */
const getClientsByUser = function (userId, callback) {
  Cassandra.runQuery(
    'SELECT "clientId" FROM "OAuthClientsByUser" WHERE "userId" = ?',
    [userId],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      const clientIds = _.map(rows, (row) => {
        return row.get('clientId');
      });

      _getClientsByIds(clientIds, callback);
    }
  );
};

/**
 * Get a set of clients by their IDs
 *
 * @param  {String}     clientIds           The IDs of the client that need to be retrieved
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Client[]}   callback.clients    The set of clients
 * @api private
 */
const _getClientsByIds = function (clientIds, callback) {
  if (_.isEmpty(clientIds)) {
    return callback(null, []);
  }

  Cassandra.runQuery('SELECT * FROM "OAuthClient" WHERE "id" IN ?', [clientIds], (error, rows) => {
    if (error) {
      return callback(error);
    }

    const clients = _.chain(rows)
      .map(Cassandra.rowToHash)
      .map((hash) => {
        return new Client(hash.id, hash.displayName, hash.secret, hash.userId);
      })
      .value();

    return callback(null, clients);
  });
};

export { createClient, updateClient, deleteClient, getClientById, getClientsByUser };
