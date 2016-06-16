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

var _ = require('underscore');
var bunyan = require('bunyan');
var csv = require('csv');
var fs = require('fs');
var optimist = require('optimist');
var path = require('path');
var util = require('util');

var Cassandra = require('oae-util/lib/cassandra');
var log = require('oae-logger').logger('oae-script-main');
var OAE = require('oae-util/lib/oae');
var PrincipalsDAO = require('oae-principals/lib/internal/dao');

var argv = optimist.usage('$0 [-t cam] [--config <path/to/config.js>]')
    .alias('t', 'tenant')
    .describe('t', 'Specify the tenant alias of the tenant whose users who wish to migrate')

    .alias('c', 'config')
    .describe('c', 'Specify an alternate config file')
    .default('c', 'config.js')

    .alias('h', 'help')
    .describe('h', 'Show usage information')
    .argv;

if (argv.help) {
    optimist.showHelp();
    return process.exit(1);
}

var errors = 0;

// Get the config
var configPath = path.resolve(process.cwd(), argv.config);
var config = require(configPath).config;

// ...and the tenant
var tenantAlias = argv.tenant;

// Ensure that this application server does NOT start processing any preview images
config.previews.enabled = false;

// Ensure that we're logging to standard out/err
config.log = {
    'streams': [
        {
            'level': 'info',
            'stream': process.stdout
        }
    ]
};

// Set up the CSV file for errors
var fileStream = fs.createWriteStream(tenantAlias + '-shibboleth-migration.csv');
fileStream.on('error', function(err) {
    log().error({'err': err}, 'Error occurred when writing to the warnings file');
    process.exit(1);
});
var csvStream = csv.stringify({
    'columns': ['principal_id', 'email', 'login_id', 'message'],
    'header': true,
    'quoted': true
});
csvStream.pipe(fileStream);

/**
 * Write errors to a CSV file
 *
 * @param  {Object}     userHash                The existing user
 * @param  {String}     message                 A short message detailing the issue
 * @api private
 */
function _writeErrorRow(userHash, message) {
    csvStream.write({
        'principal_id': userHash.principalId ? userHash.principalId : '',
        'email': userHash.email ? userHash.email : '',
        'login_id': userHash.loginId ? userHash.loginId : '',
        'message': message ? message : ''
    });
    errors++;
}

// Spin up the application container. This will allow us to re-use existing APIs
OAE.init(config, function(err) {
    if (err) {
        log().error({'err': err}, 'Unable to spin up the application server');
        return _exit(err.code);
    }

    _getAllUsersForTenant(tenantAlias, function(userHashes) {    
        _getExternalIds(userHashes, function(usersWithIds) {
            _mapUsersToShibLogin(usersWithIds, function(err, mappedUsers) {
                if (err) {
                    log().error({'err':err}, 'Encountered error when migrating %s users to Shibboleth', tenantAlias);
                    return _exit(1);
                }

                if (_.isEmpty(mappedUsers)) {
                    log().info('No users were migrated for tenant %s', tenantAlias);
                } else {
                    log().info('%s users were migrated to Shibboleth logins.', mappedUsers.length);
                }

                if (errors > 0) {
                    log().warn('Some users could not be mapped to Shibboleth logins, check the CSV file for more information');
                }

                return _exit(0);
            });
        });
    });
});

/**
 * Page through all the users in the system, and filter them by tenant
 *
 * @param  {String}     tenantAlias             The tenant alias to filter by
 * @param  {Function}   callback                Invoked when users have been collected
 * @param  {Object[]}   callback.userHashes     An array of user hashes
 * @api private
 */
var _getAllUsersForTenant = function(tenantAlias, callback) {
    var userHashes = [];

    PrincipalsDAO.iterateAll(['principalId', 'tenantAlias', 'email', 'displayName'], 100, _aggregateUsers, function(err) {
        if (err) {
            log().error({'err': err}, 'Failed to iterate all users');
            return _exit(1);
        }

        log().info('Found %s users for specified tenant', userHashes.length);

        return callback(userHashes);
    });

    /*!
     * Filter users down to those that are part of the specified tenant. Then add them to the `userHashes` array
     *
     * @param  {Object[]}   principalHashes     The principals to filter and aggregate
     * @param  {Function}   callback            Will be invoked when the principals are aggregated
     */
    function _aggregateUsers(principalHashes, callback) {
        log().info('Checking %s principals for tenancy', principalHashes.length);
        _.chain(principalHashes)
            .filter(function(principalHash) {
                return principalHash.tenantAlias === tenantAlias && PrincipalsDAO.isUser(principalHash.principalId);
            })
            .each(function(userHash) {
                log().info('Adding user %s to tenant users', userHash.displayName);
                userHashes.push(userHash);
            });

        return callback();
    }
};

/**
 * Get the external login ids for all users in a tenancy
 *
 * @param  {Object[]}   userHashes            The users for a tenancy
 * @param  {Function}   callback              Standard callback function
 * @param  {Object[]}   callback.userHashes   The users for a tenancy with ID
 * @api private
 */
var _getExternalIds = function(userHashes, callback, _userHashes) {
    _userHashes = _userHashes || [];

    if (_.isEmpty(userHashes)) {
        return callback(_userHashes);
    }

    // Take the next principal hash from the collection
    var principalHash = userHashes.shift();
    _findExternalId(principalHash, function(err, userHash) {
        if (!err && userHash) {
            // Accumulate the return information we want
            _userHashes.push(userHash);
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
    var userId = userHash.principalId;
    Cassandra.runQuery('SELECT "loginId" FROM "AuthenticationUserLoginId" WHERE "userId" = ?', [userId], function(err, rows) {
        if (err) {
            log().error({'err': err}, 'Failed Cassandra query for user %s\'s loginId', userHash.displayName);
            _writeErrorRow(userHash, 'Could not retrieve loginId for this user');
            return callback(err);
        }

        var loginId = _.chain(rows)
            .map(Cassandra.rowToHash)
            .pluck('loginId')
            .filter(function(loginId) {
                // If user has more than one loginId, take the Google one
                return loginId.split(':')[1] === 'google';
            })
            .first()
            .value();

        return callback(null, _.extend(userHash, {'loginId': loginId}));
    });
}

/**
 * Create new authentication records linked to Shibboleth EPPN for all users within the tenant
 *
 * @param  {Object[]}   allUsers                The array of all the users for a tenancy
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object[]}   callback.mappedUsers    The Shibboleth users that were mapped to existing users
 * @api private
 */
var _mapUsersToShibLogin = function(allUsers, callback) {
    // Remove users with duplicate emails or invalid login IDs
    var cleanedUsers = _.chain(allUsers)
        .filter(function(user) {
            var valid = user.loginId;
            if (!valid) {
                // We'll also end up here if they have a non-Google loginId
                _writeErrorRow(user, 'This user has an invalid loginId');
            }
            return valid;
        })
        .compact()
        .value();

    if (_.isEmpty(cleanedUsers)) {
        log().info('No suitable users found for tenant %s', tenantAlias);
        return callback(null, null);
    }

    _createShibLoginRecords(cleanedUsers, function(err, mappedUsers) {
        if (err) {
            return callback(err);
        }

        return callback(null, mappedUsers);
    });
};

/**
 * Create new authentication records linked to Shibboleth EPPN for all users within the tenant
 *
 * @param  {Object[]}   users                   The users to map
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object[]}   callback.mappedUsers    The Shibboleth users that were mapped to existing users
 * @api private
 */
var _createShibLoginRecords = function(users, callback, _mappedUsers) {
    _mappedUsers = _mappedUsers || [];

    if (_.isEmpty(users)) {
        return callback(null, _mappedUsers);
    }

    var userHash = users.shift();

    log().info('Processing user %s', userHash.displayName);

    // Create a new login record for user
    _createNewUserLogin(userHash, function(err) {
        if (err) {
            return callback(err);
        }

        _mappedUsers.push(userHash);
        _createShibLoginRecords(users, callback, _mappedUsers);
    });
};

/**
 * Create new Shibboleth login details for existing account
 *
 * @param  {Object}     userHash                The user account we want to keep
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
var _createNewUserLogin = function(userHash, callback) {
    var userId = userHash.principalId;
    var email = userHash.loginId.slice(userHash.loginId.lastIndexOf(':') + 1);
    var newLoginId = util.format('%s:shibboleth:%s', tenantAlias, email);

    Cassandra.runQuery('INSERT INTO "AuthenticationUserLoginId" ("loginId", "userId", "value") VALUES (?, ?, ?)', [newLoginId, userId, '1'], function(err, results) {
        if (err) {
            log().error({'err': err}, 'Failed to update AuthenticationUserLoginId table in Cassandra');
            _writeErrorRow(userHash, 'Failed to update AuthenticationUserLoginId for this user');
            return callback(err);
        }
        Cassandra.runQuery('INSERT INTO "AuthenticationLoginId" ("loginId", "userId") VALUES (?, ?)', [newLoginId, userId], function(err, results) {
            if (err) {
                log().error({'err': err}, 'Failed to update AuthenticationLoginId table in Cassandra');
                _writeErrorRow(userHash, 'Failed to update AuthenticationLoginId for this user');
                return callback(err);
            }

            log().info('Created Shibboleth login record for user %s', userHash.displayName);
            return callback();
         });
    });
};

/**
 * Exit the migration script, but wait until the CSV stream has been properly closed down
 *
 * @param  {Number}     code    The exit code that should be used to stop the process with
 */
var _exit = function(code) {
    csvStream.end(function() {
        process.exit(code);
    });
};
