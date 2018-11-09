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

const _ = require('underscore');

const Cassandra = require('oae-util/lib/cassandra');

const { AccessToken } = require('../model');

/**
 * Creates an access token
 *
 * @param  {String}         token                   The randomly generated string, this will be the primary identifier for the access token
 * @param  {String}         userId                  The ID of the user for who this access token will work
 * @param  {String}         clientId                The ID of the client to which this access token is associated
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {AccessToken}    callback.accessToken    The created access token
 */
const createAccessToken = function(token, userId, clientId, callback) {
  // Insert the token and its association to the client and user
  const queries = [
    Cassandra.constructUpsertCQL('OAuthAccessToken', 'token', token, {
      userId,
      clientId
    }),
    Cassandra.constructUpsertCQL(
      'OAuthAccessTokenByUser',
      ['userId', 'clientId'],
      [userId, clientId],
      { token }
    )
  ];

  Cassandra.runBatchQuery(queries, err => {
    if (err) {
      return callback(err);
    }

    return callback(null, new AccessToken(token, userId, clientId));
  });
};

/**
 * Get a full access token object
 *
 * @param  {String}         token                   The randomly generated string
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {AccessToken}    callback.accessToken    The access token object which contains the user for which the token can be used
 */
const getAccessToken = function(token, callback) {
  // TODO: As this gets called on every OAuth authenticated call, it might not be a bad idea to cache this in Redis
  Cassandra.runQuery('SELECT * FROM "OAuthAccessToken" WHERE "token" = ?', [token], (err, rows) => {
    if (err) {
      return callback(err);
    }
    if (_.isEmpty(rows)) {
      return callback(null, null);
    }

    const hash = Cassandra.rowToHash(rows[0]);
    const accessToken = new AccessToken(hash.token, hash.userId, hash.clientId);
    return callback(null, accessToken);
  });
};

/**
 * Given a user and a client, gets the access token for that combination
 *
 * @param  {String}         userId                  The user who allowed access to his data to the client
 * @param  {String}         clientId                The client for which the access token was granted
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {AccessToken}    callback.accessToken    The access token object which contains the user for which the token can be used
 */
const getAccessTokenForUserAndClient = function(userId, clientId, callback) {
  // TODO: As this gets called on every OAuth authenticated call, it might not be a bad idea to cache this in Redis
  Cassandra.runQuery(
    'SELECT "token" FROM "OAuthAccessTokenByUser" WHERE "userId" = ? AND "clientId" = ?',
    [userId, clientId],
    (err, rows) => {
      if (err) {
        return callback(err);
      }
      if (_.isEmpty(rows)) {
        return callback(null, null);
      }

      const hash = Cassandra.rowToHash(rows[0]);
      const accessToken = new AccessToken(hash.token, userId, clientId);
      return callback(null, accessToken);
    }
  );
};

module.exports = {
  createAccessToken,
  getAccessToken,
  getAccessTokenForUserAndClient
};
