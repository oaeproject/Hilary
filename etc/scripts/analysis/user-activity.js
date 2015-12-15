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

/**
 * An analysis script designed to determine how active user accounts are for a tenant.
 */

var _ = require('underscore');
var bunyan = require('bunyan');
var csv = require('csv');
var fs = require('fs');
var optimist = require('optimist');
var path = require('path');
var util = require('util');

var ActivityDAO = require('oae-activity/lib/internal/dao');
var AuthzUtil = require('oae-authz/lib/util');
var Cassandra = require('oae-util/lib/cassandra');
var log = require('oae-logger').logger('oae-script-main');
var OAE = require('oae-util/lib/oae');
var PrincipalsDAO = require('oae-principals/lib/internal/dao');
var Validator = require('oae-util/lib/validator').Validator;

var argv = optimist.usage('$0 [-t cam] [--config <path/to/config.js>]')
    .alias('t', 'tenant')
    .describe('t', 'Specify the tenant alias of the tenant whose users activity to analyze. By default, analyze all tenants')

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

// Get the config
var configPath = path.resolve(process.cwd(), argv.config);
var config = require(configPath).config;
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
    ],
    'serializers': {
        'err': bunyan.stdSerializers.err,
        'req': bunyan.stdSerializers.req,
        'res': bunyan.stdSerializers.res
    }
};

var start = Date.now();
var streamInfo = _createCsvStream();
var csvStream = streamInfo.csv;
var fileStream = streamInfo.file;
var filePath = streamInfo.filePath;

// Spin up the application container. This will allow us to re-use existing APIs
OAE.init(config, function(err) {
    if (err) {
        log().error({'err': err}, 'Unable to spin up the application server');
        return process.exit(err.code);
    }

    _groupUsersByEmail(tenantAlias, function(usersByEmail) {
        var batches = _.chain(usersByEmail)
            // Only keep profiles that have duplicate emails
            .filter(function(userHashes) { return (userHashes.length > 1); })
            .flatten()
            .tap(function(userHashes) {
                log().info('Preparing to write a total of %s users who have duplicate emails', userHashes.length);
            })

            // Re-group things into sane concurrent batches
            .groupBy(function(userHash, i) { return Math.floor(i / 5); })
            .values()
            .value();

        log().info('Begin writing %s batches of user activity to CSV', batches.length);

        return _writeUserRows(batches);
    });
});

/**
 * Build and write all user rows concurrently for the given batches of user hashes
 *
 * @param  {Object[][]}     userHashBatches     A collection of batches for which to generate user rows and write them to the csv file
 * @api private
 */
function _writeUserRows(userHashBatches) {
    if (_.isEmpty(userHashBatches)) {
        log().info('Processing complete');
        return _exit(0);
    }

    log().info('There are %d batches remaining to process', userHashBatches.length);

    // Process the next batch
    var userHashBatch = userHashBatches.shift();
    var _done = _.after(userHashBatch.length, function() {
        log().info('Successfully completed batch of %d users', userHashBatch.length);
        return _writeUserRows(userHashBatches);
    });

    _.each(userHashBatch, function(userHash) {
        _createUserRow(userHash, function(err, row) {
            if (err) {
                log().warn({'err': err, 'user': userHash}, 'Failed to create row from a user hash');
                return _done();
            }

            return csvStream.write(row, _done);
        });
    });
}

/**
 * Page through all the users in the system, filtering by tenant and those that have email
 * addresses, and group them by their email address
 *
 * @param  {String}     tenantAlias             The tenant alias to filter by
 * @param  {Function}   callback                Invoked when users have been grouped by email address
 * @param  {Object}     usersByEmail            An object keyed by email, whose value is an array of user hashes
 * @api private
 */
function _groupUsersByEmail(tenantAlias, callback) {
    var userHashes = [];

    PrincipalsDAO.iterateAll(['principalId', 'tenantAlias', 'displayName', 'email', 'visibility', 'lastModified', 'notificationsLastRead'], 100, _aggregateUsers, function(err) {
        if (err) {
            log().error({'err': err}, 'Failed to iterate all users');
            return process.exit(1);
        }

        log().info('Finished indexing %s users by email', userHashes.length);

        return callback(_.groupBy(userHashes, 'email'));
    });

    /*!
     * Given a paged result set of principal hashes, filter them down to those with email addresses
     * and those that are part of the specified tenant. Then add them to the shared `userHashes`
     * array
     *
     * @param  {Object[]}   principalHashes     The principals to filter and aggregate
     * @param  {Function}   callback            Will be invoked when the principals are aggregated
     */
    function _aggregateUsers(principalHashes, callback) {
        log().info('Analyzing %s principals to index by email', principalHashes.length);
        _.chain(principalHashes)
            .filter(function(principalHash) {
                return principalHash.email && (!tenantAlias || principalHash.tenantAlias === tenantAlias);
            })
            .tap(function(userHashes) {
                log().info('Indexing %d users with emails for the specified tenant (if any)', userHashes.length);
            })
            .each(function(userHash) {
                userHashes.push(userHash);
            });

        return callback();
    }
}

/**
 * Create a row for the user described by the given storage hash
 *
 * @param  {Object}     userHash        The user hash object for which to create a row
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Object}     callback.row    The data row for the specified user
 * @api private
 */
function _createUserRow(userHash, callback) {
    // Seed the row with the basic profile information
    var row = {
        'tenant_alias': userHash.tenantAlias,
        'user_id': userHash.principalId,
        'display_name': userHash.displayName,
        'email': userHash.email,
        'visibility': userHash.visibility,
        'last_modified': userHash.lastModified || 0,
        'notifications_last_read': userHash.notificationsLastRead || 0
    };

    // Get the user's external id to help administrative identification
    _findExternalId(userHash, function(err, externalId) {
        if (err) {
            return callback(err);
        }

        // Get the latest publish date for an activity in which the user is an actor
        _findLatestActedActivityMillis(userHash, function(err, latestActedActivityMillis) {
            if (err) {
                return callback(err);
            }

            // Get the number of items in the user's activity feed
            _findActivityStreamCount(userHash, function(err, activityStreamCount) {
                if (err) {
                    return callback(err);
                }

                // Find the last updated time of the most recent content item in the user's content library
                _findLatestContentInLibraryMillis(userHash, function(err, latestContentInLibraryMillis) {
                    if (err) {
                        return callback(err);
                    }

                    // Find the number of items in the user's content library
                    _findContentLibraryCount(userHash, function(err, contentLibraryCount) {
                        if (err) {
                            return callback(err);
                        }

                        // Find how many members are in the user's memberships
                        // cache, which is only an estimate since the cache may
                        // not have been populated yet
                        _findAuthzMembershipsCacheCount(userHash, function(err, authzMembershipsCacheCount) {

                            // Find how many memberships to which the user
                            // belongs directly
                            _findResourceMembershipsCount(userHash, function(err, resourceMembershipsCount) {
                                if (err) {
                                    return callback(err);
                                }

                                // Add the activity-related information to the row. Library estimates are
                                // not guaranteed to be correct because there are 2 slug columns (why we
                                // reduce by 2), but also because they may not be seeded at all (0 items)
                                _.extend(row, {
                                    'activities': activityStreamCount || 0,
                                    'activity_latest': latestActedActivityMillis || 0,
                                    'content_items_estimate': (contentLibraryCount-2) || 0,
                                    'content_item_latest_estimate': latestContentInLibraryMillis || 0,
                                    'external_id': externalId || '',
                                    'group_memberships_estimate': authzMembershipsCacheCount || 0,
                                    'resource_memberships': resourceMembershipsCount || 0
                                });

                                return callback(null, row);
                            });
                        });
                    });
                });
            });
        });
    });
}

/**
 * Find the external login id of the user
 *
 * @param  {Object}     userHash                The user hash object
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {String}     callback.externalId     The external id associated to the user
 * @api private
 */
function _findExternalId(userHash, callback) {
    var userId = userHash.principalId;
    Cassandra.runQuery('SELECT "loginId" FROM "AuthenticationUserLoginId" WHERE "userId" = ?', [userId], function(err, rows) {
        if (err) {
            return callback(err);
        }

        var loginId = _.chain(rows)
            .map(Cassandra.rowToHash)
            .pluck('loginId')
            .first()
            .value();

        var externalId = '';
        if (loginId) {
            // If the login id is marist:cas:123456@marist.edu, we take just
            // 123456@marist.edu by splitting by :, taking away the first two
            // parts, and re-joining by : in-case the login id portion has :'s
            externalId = loginId
                .split(':')
                .slice(2)
                .join(':');
        }

        return callback(null, externalId);
    });
}

/**
 * Find the published date of the latest activity in the user's feed that they themself performed
 *
 * @param  {Object}     userHash            The user hash object
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Number}     callback.millis     The millis of the published date of the latest activity in the user's feed that they themself performed
 * @api private
 */
function _findLatestActedActivityMillis(userHash, callback, _nextToken) {
    var userId = userHash.principalId;
    ActivityDAO.getActivities(util.format('%s#activity', userId), _nextToken, 30, function(err, activities, nextToken) {
        if (err) {
            return callback(err);
        } else if (!nextToken) {
            // There are no items left and we have exhausted activities
            return callback();
        }

        var activity = _.find(activities, function(activity) {
            return (JSON.stringify(activity.actor).indexOf(userId) !== -1);
        });

        if (activity) {
            return callback(null, activity.published);
        } else {
            return _findLatestActedActivityMillis(userHash, callback, nextToken);
        }
    });
}

/**
 * Find the number of activities in the user's activity feed
 *
 * @param  {Object}     userHash        The user hash object
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Number}     callback.count  The number of activities in the user's activity feed
 * @api private
 */
function _findActivityStreamCount(userHash, callback) {
    var userId = userHash.principalId;
    Cassandra.runQuery('SELECT COUNT(*) FROM "ActivityStreams" WHERE "activityStreamId" = ?', [util.format('%s#activity', userId)], _rowToCount(callback));
}

/**
 * Find the last modified date of the latest content item in the user's content library
 *
 * @param  {Object}     userHash            The user hash object
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Number}     callback.millis     The millis of the last modified date of the latest content item in the user's content library
 * @api private
 */
function _findLatestContentInLibraryMillis(userHash, callback) {
    var userId = userHash.principalId;
    var bucketKey = util.format('content:content#%s#private', userId);
    Cassandra.runPagedQuery('LibraryIndex', 'bucketKey', bucketKey, 'rankedResourceId', null, 2, {'reversed': true}, function(err, rows, nextToken) {
        if (err) {
            return callback(err);
        } else if (_.isEmpty(rows)) {
            return callback();
        }

        var latestTimestamp = _.chain(rows)
            .map(Cassandra.rowToHash)
            .pluck('rankedResourceId')
            .filter(function(rankedResourceId) {
                return (rankedResourceId !== '|');
            })
            .first()
            .value();

        if (latestTimestamp) {
            latestTimestamp = latestTimestamp.split('#')[0];
        }

        return callback(null, latestTimestamp);
    });
}

/**
 * Find the number of content items in the user's content library
 *
 * @param  {Object}     userHash        The user hash object
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Number}     callback.count  The number of content items in the user's content library
 * @api private
 */
function _findContentLibraryCount(userHash, callback) {
    var userId = userHash.principalId;
    var bucketKey = util.format('content:content#%s#private', userId);
    Cassandra.runQuery('SELECT COUNT(*) FROM "LibraryIndex" WHERE "bucketKey" = ?', [bucketKey], _rowToCount(callback));
}

/**
 * Find the number of memberships for the user in the authz memberships cache
 *
 * @param  {Object}     userHash        The user hash object
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Number}     callback.count  The number of memberships in the authz memberships cache
 * @api private
 */
function _findAuthzMembershipsCacheCount(userHash, callback) {
    var userId = userHash.principalId;
    Cassandra.runQuery('SELECT COUNT(*) FROM "AuthzMembershipsCache" WHERE "principalId" = ?', [userId], _rowToCount(callback));
}


/**
 * Find the number of memberships for the user across all resource types
 *
 * @param  {Object}     userHash        The user hash object
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Number}     callback.count  The number of memberships for the user across all resource types
 * @api private
 */
function _findResourceMembershipsCount(userHash, callback) {
    var userId = userHash.principalId;
    Cassandra.runQuery('SELECT COUNT(*) FROM "AuthzRoles" WHERE "principalId" = ?', [userId], _rowToCount(callback));
}

/**
 * Creates a function that can convert a standard `COUNT(*)` query result row into the count value
 * and return it in the standard callback
 *
 * @param  {Function}   callback        Standard callback function, indicating what the consumer wishes to invoke with the count
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Number}     callback.count  The count that was found in the cassandra row
 * @return {Function}                   Standard callback function that takes an error object and an array of Cassandra rows. It will extract the count from the row and pass it into the consumer callback
 * @api private
 */
function _rowToCount(callback) {
    return function(err, rows) {
        if (err) {
            return callback(err);
        }

        var count = _.chain(rows)
            .map(Cassandra.rowToHash)
            .pluck('count')
            .first()
            .value();

        return callback(null, count);
    };
}

/**
 * Create a CSV file stream to the specified CSV file
 *
 * @param  {String}     [csvFileName]       The filename of the file to which to output the CSV. Default: user_activity.csv
 * @return {Object}     result              A result object
 * @return {Stream}     result.csv          A stream that accepts CSV object output and outputs it to the CSV file
 * @return {Stream}     result.file         A stream to the CSV file that will be written
 * @return {String}     result.filePath     The path to the CSV file
 * @api private
 */
function _createCsvStream(csvFileName) {
    csvFileName = csvFileName || 'user_activity.csv';

    // Keep track of the total number of users and the number of users that were mapped
    var totalUsers = 0;
    var mappedUsers = 0;

    // Set up the CSV file
    var fileStream = fs.createWriteStream(csvFileName, {'flags': 'w'});
    fileStream.on('error', function(err) {
        log().error({'err': err}, 'Error occurred when writing to the CSV file');
        process.exit(1);
    });
    var csvStream = csv.stringify({
        'columns': ['tenant_alias', 'user_id', 'external_id', 'display_name', 'email', 'visibility', 'last_modified', 'notifications_last_read', 'activities', 'activity_latest', 'content_items_estimate', 'content_item_latest', 'group_memberships_estimate', 'resource_memberships'],
        'header': true,
        'quoted': true
    });
    csvStream.pipe(fileStream);

    return {'csv': csvStream, 'file': fileStream, 'filePath': path.resolve(process.cwd(), csvFileName)};
}

/**
 * Exit the process, ensuring we wait for both the CSV stream and file stream to be cleaned and
 * flushed properly
 *
 * @param  {Number}     [code]  The process exit code to use
 * @api private
 */
function _exit(code) {
    csvStream.end(function() {
        fileStream.on('finish', function() {
            process.exit(code);
        });
    });
}
