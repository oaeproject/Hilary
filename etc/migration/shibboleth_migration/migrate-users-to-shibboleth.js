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

/*
 * Map user accounts created with Shibboleth to the earlier ones
 * created with Google auth - Shibboleth EPPN should match email account.
 */

/* eslint-disable */
import * as util from 'util';
import _ from 'underscore';

import * as Cassandra from 'oae-util/lib/cassandra.js';
import * as Logger from 'oae-logger';
const log = Logger.logger('oae-script-main');
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao.js';

let csvStream = {};
let errors = 0;

/**
 * Write errors to a CSV file
 *
 * @param  {Object}     userHash                The existing user
 * @param  {String}     message                 A short message detailing the issue
 * @api private
 */
function _writeErrorRow(userHash, message) {
  csvStream.write({
    // eslint-disable-next-line camelcase
    principal_id: userHash.principalId ? userHash.principalId : '',
    email: userHash.email ? userHash.email : '',
    // eslint-disable-next-line camelcase
    login_id: userHash.loginId ? userHash.loginId : '',
    message: message ? message : ''
  });
  errors++;
}

/**
 * Page through all the users in the system, and filter them by tenant
 *
 * @param  {String}     tenantAlias             The tenant alias to filter by
 * @param  {Function}   callback                Invoked when users have been collected
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object[]}   callback.userHashes     An array of user hashes
 * @api private
 */
const _getAllUsersForTenant = function (tenantAlias, callback) {
  const userHashes = [];

  PrincipalsDAO.iterateAll(
    ['principalId', 'tenantAlias', 'email', 'displayName'],
    100,
    // eslint-disable-next-line no-use-before-define
    _aggregateUsers,
    (err) => {
      if (err) {
        log().error({ err }, 'Failed to iterate all users');
        return callback(err);
      }

      log().info('Found %s users for specified tenant', userHashes.length);

      return callback(null, userHashes);
    }
  );

  /*!
   * Filter users down to those that are part of the specified tenant. Then add them to the `userHashes` array
   *
   * @param  {Object[]}   principalHashes       The principals to filter and aggregate
   * @param  {Function}   callback              Will be invoked when the principals are aggregated
   */
  function _aggregateUsers(principalHashes, callback) {
    log().info('Checking %s principals for tenancy', principalHashes.length);
    _.chain(principalHashes)
      .filter((principalHash) => {
        return principalHash.tenantAlias === tenantAlias && PrincipalsDAO.isUser(principalHash.principalId);
      })

      .each((userHash) => {
        log().info('Adding user %s to tenant users', userHash.displayName);
        userHashes.push(userHash);
      });

    return callback();
  }
};

/**
 * Get the external login ids for all users in a tenancy
 *
 * @param  {Object[]}   userHashes              The users for a tenancy
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object[]}   callback.userHashes     The users for a tenancy with ID
 * @api private
 */
const _getExternalIds = function (userHashes, callback, _userHashes) {
  _userHashes = _userHashes || [];

  if (_.isEmpty(userHashes)) {
    return callback(null, _userHashes);
  }

  // Take the next principal hash from the collection
  const principalHash = userHashes.shift();
  _findExternalId(principalHash, (err, userHash) => {
    if (err) {
      log().error({ err }, "Failed Cassandra query for user %s's loginId", principalHash.principalId);
      return callback(err);
    }

    if (userHash.loginId) {
      // Accumulate the return information we want
      _userHashes.push(userHash);
    } else {
      _writeErrorRow(userHash, 'This user has no Google loginId');
    }

    // Our recursive step inside the callback for _findExternalId
    return _getExternalIds(userHashes, callback, _userHashes);
  });
};

/**
 * Find the external login id for the user and add it to the user hash
 *
 * @param  {Object}     userHash                The user hash object
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {String}     callback.userHash       The user hash object including the external id
 * @api private
 */
function _findExternalId(userHash, callback) {
  const userId = userHash.principalId;
  Cassandra.runQuery('SELECT "loginId" FROM "AuthenticationUserLoginId" WHERE "userId" = ?', [userId], (err, rows) => {
    if (err) {
      return callback(err);
    }

    const loginId = _.chain(rows)
      .map(Cassandra.rowToHash)
      .pluck('loginId')
      .filter((loginId) => {
        // If user has more than one loginId, take the Google one
        return loginId.split(':')[1] === 'google';
      })
      .first()
      .value();

    userHash = loginId ? _.extend(userHash, { loginId }) : userHash;

    return callback(null, userHash);
  });
}

/**
 * Create new Shibboleth login details for existing account
 *
 * @param  {Object}     userHash                The user account we want to keep
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
const _createNewUserLogin = function (userHash, callback) {
  const userId = userHash.principalId;
  const email = userHash.loginId.slice(userHash.loginId.lastIndexOf(':') + 1);
  const newLoginId = util.format('%s:shibboleth:%s', userHash.tenantAlias, email);

  Cassandra.runQuery(
    'INSERT INTO "AuthenticationUserLoginId" ("loginId", "userId", "value") VALUES (?, ?, ?)',
    [newLoginId, userId, '1'],
    (err) => {
      if (err) {
        _notifyOfError('AuthenticationUserLoginId', userHash, err, callback);
      }
      Cassandra.runQuery(
        'INSERT INTO "AuthenticationLoginId" ("loginId", "userId") VALUES (?, ?)',
        [newLoginId, userId],
        (err) => {
          if (err) {
            _notifyOfError('AuthenticationLoginId', userHash, err, callback);
          }
          log().info('Created Shibboleth login record for user %s', userHash.displayName);
          return callback();
        }
      );
    }
  );
};

const _notifyOfError = (table, userHash, err, callback) => {
  log().error({ err }, `Failed to update ${table} table in Cassandra`);
  _writeErrorRow(userHash, `Failed to update ${table} for this user`);
  return callback(err);
};

/**
 * Create new authentication records linked to Shibboleth EPPN for all users within the tenant
 *
 * @param  {Object[]}   userHashes              The users to map
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object[]}   callback.mappedUsers    The Shibboleth users that were mapped to existing users
 * @api private
 */
const _createShibLoginRecords = function (userHashes, callback, _mappedUsers) {
  _mappedUsers = _mappedUsers || [];

  if (_.isEmpty(userHashes)) {
    return callback(null, _mappedUsers);
  }

  const userHash = userHashes.shift();

  log().info('Processing user %s', userHash.displayName);

  // Create a new login record for user
  _createNewUserLogin(userHash, (err) => {
    if (err) {
      return callback(err);
    }

    _mappedUsers.push(userHash);
    _createShibLoginRecords(userHashes, callback, _mappedUsers);
  });
};

/**
 * Create new authentication records linked to Shibboleth EPPN for all users within the tenant
 *
 * @param  {Object[]}   allUsers                The array of all the users for a tenancy
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object[]}   callback.mappedUsers    The Shibboleth users that were mapped to existing users
 * @api private
 */
const _mapUsersToShibLogin = function (allUsers, callback) {
  if (_.isEmpty(allUsers)) {
    log().info('No suitable users found for this tenant');
    return callback();
  }

  _createShibLoginRecords(allUsers, (err, mappedUsers) => {
    if (err) {
      return callback(err);
    }

    return callback(null, mappedUsers);
  });
};

/**
 * Migrate users to Shibboleth login
 *
 * @param  {String}     tenantAlias             The tenant we want to do migration for
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.errorCount     Whether there were errors in the migration
 */
const doMigration = function (tenantAlias, stream, callback) {
  csvStream = stream;
  _getAllUsersForTenant(tenantAlias, (err, userHashes) => {
    if (err) {
      return callback(err);
    }

    _getExternalIds(userHashes, (err, usersWithIds) => {
      if (err) {
        return callback(err);
      }

      _mapUsersToShibLogin(usersWithIds, (err, mappedUsers) => {
        if (err) {
          log().error({ err }, 'Encountered error when migrating %s users to Shibboleth', tenantAlias);
          return callback(err);
        }

        if (_.isEmpty(mappedUsers)) {
          log().info('No users were migrated for tenant %s', tenantAlias);
        } else {
          log().info('%s users were migrated to Shibboleth logins.', mappedUsers.length);
        }

        return callback(null, errors);
      });
    });
  });
};

export { doMigration };
