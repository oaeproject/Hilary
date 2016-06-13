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
    'columns': ['shib_principal_id', 'shib_email', 'shib_EPPN', 'old_principal_id', 'old_email', 'message'],
    'header': true,
    'quoted': true
});
csvStream.pipe(fileStream);


// Spin up the application container. This will allow us to re-use existing APIs
OAE.init(config, function(err) {
    if (err) {
        log().error({'err': err}, 'Unable to spin up the application server');
        return _exit(err.code);
    }

    _getAllUsersForTenant(tenantAlias, function(err, users) {
        _mapUsersToShibUsers(users, function(err, mappedUsers) {
            if (err) {
                log().error({'err':err}, 'Encountered error when migrating %s users to Shibboleth', tenantAlias);
                return _exit(1);
            }

            if (errors > 0) {
                log().warn('Some users were not mapped to Shibboleth users, check the CSV file for more information');
            }

            log().info('%s users were migrated to Shibboleth login.', mappedUsers.length);
            return _exit(0);
        });
    });
});

/**
 * Page through all the users in the system, and filter them by tenant
 *
 * @param  {String}     tenantAlias             The tenant alias to filter by
 * @param  {Function}   callback                Invoked when users have been collected
 * @param  {Object}     callback.err            The error that occurred, if any
 * @param  {Object}     callback.userHashes     An array of user hashes
 * @api private
 */
var _getAllUsersForTenant = function(tenantAlias, callback) {
    var userHashes = [];

    // Just get the fields we'll need later
    PrincipalsDAO.iterateAll(['principalId', 'tenantAlias', 'email'], 100, _aggregateUsers, function(err) {
        if (err) {
            log().error({'err': err}, 'Failed to iterate all users for tenant %s', tenantAlias);
            return _exit(1);
        }

        log().info('Found %s users for specified tenant', userHashes.length);

        return callback(null, userHashes);
    });

    /*
     * Filter users down to those that are part of the specified tenant. Then add them to the `userHashes` array
     *
     * @param  {Object[]}   principalHashes     The principals to filter and aggregate
     * @param  {Function}   callback            Will be invoked when the principals are aggregated
     */
    function _aggregateUsers(principalHashes, callback) {
        log().info('Checking %s principals for tenancy', principalHashes.length);

        _.chain(principalHashes)
            .filter(function(principalHash) {
                return principalHash.tenantAlias === tenantAlias && PrincipalsDAO.isUser(principalHash.principalId) && principalHash.email;
            })
            .each(function(userHash) {
                // Add the external ID for each user
                _findExternalId(userHash, function(err, userHash) {
                    if (err) {
                        return callback(err);
                    }

                    log().info('Adding user %s to tenant users', userHash.email);
                    userHashes.push(userHash);
                });
            });

        return callback();
    }
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
            log().error({'err': err}, 'Failed Cassandra query for user %s\'s loginId', userHash.email);
            return callback(err);
        }

        var loginId = _.chain(rows)
            .map(Cassandra.rowToHash)
            .pluck('loginId')
            .first()
            .value();

        return callback(null, _.extend(userHash, {'loginId': loginId}));
    });
}

/**
 * Find all the users with Shibboleth credentials and match them to existing users on EPPN
 *
 * @param  {Array}      allUsers                The array of all the users for a tenancy
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Array}      callback.mappedUsers    The Shibboleth users that were mapped to existing users
 * @api private
 */
var _mapUsersToShibUsers = function(allUsers, callback) {
    var shibbolethUsers = _.filter(allUsers, function(user) {
        return user.loginId && user.loginId.split(':')[1] === 'shibboleth';
    });

    if (shibbolethUsers.length < 1) {
        log().info('No Shibboleth users found for tenant %s', tenantAlias);
        _exit(0);
    }

    log().info('Found %s users with Shibboleth accounts', shibbolethUsers.length);

    var nonShibUsers = _.difference(allUsers, shibbolethUsers);

    var mappedUsers = [];

    _.each(shibbolethUsers, function(userHash) {
        log().info('Processing user %s', userHash.email);

        // Find Shibboleth EPPN for each user (if exists)
        _findShibbolethEppn(userHash.loginId, function(err, eppn) {
            if (!eppn) {
                _writeErrorRow(userHash, null, 'This Shibboleth user has no EPPN');
            }

            // Extend the user object with the EPPN
            var userWithEppn = _.extend(userHash, {'eppn': eppn});

            // Find a non-Shibboleth user account with an email that matches the EPPN
            _getUserMatches(nonShibUsers, userWithEppn, function(err, userMatch) {
                if (err) {
                    log().warn(err);
                }

                // Link the Shibboleth account to the old user account
                _swapUserLogin(userMatch, userWithEppn, function(err) {
                    if (err) {
                        _writeErrorRow(userWithEppn, userMatch, 'Failed to link Shibboleth login to existing user');
                    } else {
                        mappedUsers.push(userMatch);
                    }

                    if ((shibbolethUsers.length -1) === shibbolethUsers.indexOf(userHash)) {
                        _.each(_.difference(nonShibUsers, mappedUsers), function(user) {
                            _writeErrorRow(null, user, util.format('No matching Shibboleth user found for user %s', user.email));
                        });

                        callback(null, mappedUsers);
                    }
                });
            });
        });
    });
};

/**
 * Write errors to a CSV file
 *
 * @param  {Object}     shibUser                The Shibboleth user involved
 * @param  {Object}     oldUser                 The existing user we want to map to
 * @param  {String}     message                 A short message detailing the issue
 * @api private
 */
var _writeErrorRow = function(shibUser, oldUser, message) {
    csvStream.write({
        'shib_principal_id': shibUser && shibUser.principalId ? shibUser.principalId : '',
        'shib_email': shibUser && shibUser.email ? shibUser.email : '',
        'shib_EPPN': shibUser && shibUser.eppn ? shibUser.eppn : '',
        'old_principal_id': oldUser && oldUser.principalId ? oldUser.principalId : '',
        'old_email': oldUser && oldUser.email ? oldUser.email : '',
        'message': message ? message : ''
    });
    errors++;
};

/**
 * Find the Shibboleth EPPN of the user
 *
 * @param  {String}     loginId                 The loginId for the user
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {String}     callback.eppn           The Shibboleth EPPN
 * @api private
 */
function _findShibbolethEppn(loginId, callback) {
    Cassandra.runQuery('SELECT "allAttributes" FROM "ShibbolethMetadata" WHERE "loginId" = ?', [loginId], function(err, rows) {
        if (err) {
            log().error({'err': err}, 'Failed Cassandra query for Shibboleth metadata');
            return callback(err);
        }

        // Get the EPPN value from the Shibboleth metadata (stored as JSON)
        var eppn = _.propertyOf(JSON.parse(rows[0].get('allAttributes').value))('eppn');

        return callback(null, eppn);
    });
}

/**
 * Get the matching user(s) for the Shibboleth user
 *
 * @param  {Array}      nonShibUsers            The users for this tenant without Shibboleth accounts
 * @param  {Object}     userWithEppn            The Shibboleth user that we are matching
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.userMatch      The user that matched the Shibboleth user
 * @api private
 */
function _getUserMatches(nonShibUsers, userWithEppn, callback) {
    var userMatches = _.where(nonShibUsers, {email: userWithEppn.eppn});

    // If there's more than one match, we don't want to select one
    if (userMatches.length > 1) {
        _.each(userMatches, function(user) {
            _writeErrorRow(userWithEppn, user, (userMatches.indexOf(user) + 1) + '. match');
        });

        return callback(util.format('Found several matches for user with EPPN %s', userWithEppn.eppn));
    }

    // If there are no matches, log the Shib user and move on
    if (userMatches.length < 1) {
        _writeErrorRow(userWithEppn, null, util.format('No matches found for user %s', userWithEppn.email));

        return callback(util.format('Found no match for user %s'), userWithEppn.email);
    }

    var userMatch = userMatches[0];
    log().info('Found match %s', userMatch.email);
    return callback(null, userMatch);
}

/**
 * Link the existing account to the Shibboleth login details
 *
 * @param  {Object}     oldUser                 The old user account we want to keep
 * @param  {Object}     shibUser                The Shibboleth account that we want to link
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
var _swapUserLogin = function(oldUser, shibUser, callback) {
    if (!oldUser || !shibUser) {
        callback();
    }

    var shibbolethLoginId = shibUser.loginId;
    var shibbolethUserId = shibUser.principalId;
    var oldUserId = oldUser.principalId;

    Cassandra.runQuery('DELETE FROM "AuthenticationUserLoginId" WHERE "loginId" = ? AND "userId" = ?', [shibbolethLoginId, shibbolethUserId], function(err, results) {
        if (err) {
            log().error({'err': err}, 'Error removing Shibboleth user details from AuthenticationUserLoginId table in Cassandra');
            callback(err);
        }
        Cassandra.runQuery('INSERT INTO "AuthenticationUserLoginId" ("loginId", "userId", "value") VALUES (?, ?, ?)', [shibbolethLoginId, oldUserId, '1'], function(err, results) {
            if (err) {
                log().error({'err': err}, 'Failed to update AuthenticationUserLoginId table in Cassandra');
                callback(err);
            }
            Cassandra.runQuery('UPDATE "AuthenticationLoginId" SET "userId" = ? WHERE "loginId" = ?', [oldUserId, shibbolethLoginId], function(err, results) {
                if (err) {
                    log().error({'err': err}, 'Failed to update AuthenticationLoginId table in Cassandra');
                    callback(err);
                }
                Cassandra.runQuery('DELETE FROM "Principals" WHERE "principalId" = ?', [shibbolethUserId], function(err, results) {
                    if (err) {
                        log().error({'err': err}, 'Failed to delete Shibboleth user from Principals in Cassandra');
                        callback(err);
                    }

                    log().info(util.format('Mapped user %s to user %s', shibUser.email, oldUser.email));
                    callback();
                })
             });
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
