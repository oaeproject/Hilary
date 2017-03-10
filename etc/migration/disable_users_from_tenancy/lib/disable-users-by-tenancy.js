/*!
* Copyright 2017 Apereo Foundation (AF) Licensed under the
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
* Disable users belonging to a disabled tenancy
* Github issue #1304
*/

var _ = require('underscore');
var bunyan = require('bunyan');
var async = require('async');
var Cassandra = require('oae-util/lib/cassandra');
var log = require('oae-logger').logger('oae-script-main');
var PrincipalsDAO = require('oae-principals/lib/internal/dao');

/**
 * Disable users from the system by updating the deleted flag
 * 
 * @function doMigration
 * @param  {type} tenantAlias {description}
 * @param  {type} callback    {description}
 * @return {type} {description}
 */
var doMigration = function (tenantAlias, callback) {
    _getAllUsersForTenant(tenantAlias, function(error, users) {
        if (error) {
            log().error({
                'err': err
            }, 'Unable to get all users from a tenant');
            process.exit(error.code);
        }

        _deletePrincipals(users, function(error, users) {
            if (error) {
                log().error({
                    'err': err
                }, 'Unable to delete principals from tenant');
                process.exit(error.code);
            }

            log().info("Exiting...");
            callback(null, users);
        });
    });
};

/**
 * Page through all the users in the system, and filter them by tenant
 *
 * @param  {String}     tenantAlias             The tenant alias to filter by
 * @param  {Function}   callback                Invoked when users have been collected
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object[]}   callback.userHashes     An array of user hashes
 * @api private
 */
var _getAllUsersForTenant = function (tenantAlias, callback) {
    var userHashes = [];

    PrincipalsDAO.iterateAll([
        'principalId', 'tenantAlias', 'email', 'displayName', 'deleted'
    ], 100, _aggregateUsers, function (err) {
        if (err) {
            log().error({
                'err': err
            }, 'Failed to iterate all users');
            return callback(err);
        }

        log().info('Found %s users for specified tenant', userHashes.length);

        return callback(null, userHashes);
    });

    /**
     * Filter users down to those that are part of the specified tenant. Then add them to the `userHashes` array
     *
     * @param  {Object[]}   principalHashes       The principals to filter and aggregate
     * @param  {Function}   callback              Will be invoked when the principals are aggregated
     */
    function _aggregateUsers(principalHashes, callback) {
        log().info('Checking %s principals and filtering...', principalHashes.length);
        _
            .chain(principalHashes)
            .filter(function (principalHash) {
                return principalHash.tenantAlias === tenantAlias && PrincipalsDAO.isUser(principalHash.principalId);
            })
            .each(function (userHash) {
                log().info('Adding user %s to tenant users', userHash.displayName);
                userHashes.push(userHash);
            });

        return callback();
    }
};

/**
 * Deletes users from the database, one by one
 *
 * @function _deletePrincipals
 * @param  {Object[]} usersToDelete Array of users which will be deleted
 * @param  {Function} afterDeleted  Invoked when all users haven been deleted
 * @api private
 */
function _deletePrincipals(usersToDelete, afterDeleted) {
    async
        .map(usersToDelete, function(eachUser, transformed) {
            PrincipalsDAO.deletePrincipal(eachUser.principalId, function(err) {
                log().info("Deleted user " + eachUser.displayName + " (" + eachUser.principalId + ")");

                transformed(null, eachUser);
            });

        }, function (err, results) {
            afterDeleted(null, results);
        });
}

module.exports = {
    "doMigration": doMigration
};
