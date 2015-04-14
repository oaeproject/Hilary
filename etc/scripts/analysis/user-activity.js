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

var argv = optimist.usage('$0 -t cam [--config <path/to/config.js>]')
    .demand('t')
    .alias('t', 'tenant')
    .describe('t', 'Specify the tenant alias of the tenant whose users activity to analyze')

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
var rows = [];

// Spin up the application container. This will allow us to re-use existing APIs
OAE.init(config, function(err) {
    if (err) {
        log().error({'err': err}, 'Unable to spin up the application server');
        return process.exit(err.code);
    }

    PrincipalsDAO.iterateAll(['principalId', 'tenantAlias', 'displayName', 'email', 'visibility', 'lastModified', 'notificationsLastRead'], 30, _processPrincipals, function(err) {
        if (err) {
            log().error({'err': err}, 'Failed to iterate all users');
            return process.exit(1);
        }

        var rowsByEmail = _.chain(rows)
            .filter(function(row) {
                return row.email;
            })
            .groupBy('email')
            .value();

        // Write all rows
        var _done = _.after(rows.length, function() {
            log().info('Finished writing %d rows to %s', rows.length, filePath);
            return _exit(0);
        });

        _.each(rows, function(row) {
            // Additional aggregation values
            row.email_count = _.size(rowsByEmail[row.email]) || 0;
            return csvStream.write(row, _done);
        });
    });
});

/**
 * Process the set of principal rows, filtering them down to users of the specified tenant and
 * aggregating all CSV rows to the global `rows` array
 *
 * @param  {Object[]}   principalHashes     An array of principal row objects to process
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error object, if any
 * @api private
 */
function _processPrincipals(principalHashes, callback) {
    // Limit to only users from the specified tenant that have emails
    var userHashes = _.chain(principalHashes)
        .filter(function(principalHash) {
            return (principalHash.principalId.indexOf('u') === 0);
        })
        .where({'tenantAlias': tenantAlias})
        .value();

    if (_.isEmpty(userHashes)) {
        return callback();
    }

    log().info(util.format('Processing activity for %d users', userHashes.length));

    var _done = _.after(userHashes.length, callback);
    _.each(userHashes, function(userHash) {
        _createUserRow(userHash, function(err, row) {
            if (err) {
                log().warn({'err': err, 'userHash': userHash}, 'An error occurred trying to get user activity');
                return _done();
            }

            rows.push(row);
            return _done();
        });
    });
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

                    // Add the activity-related information to the row
                    _.extend(row, {
                        'activities': activityStreamCount || 0,
                        'activity_latest': latestActedActivityMillis || 0,
                        'content_items': contentLibraryCount || 0,
                        'content_item_latest': latestContentInLibraryMillis || 0
                    });

                    return callback(null, row);
                });
            });
        });
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
            return (JSON.stringify(activity.actor).indexOf(userId) !== -1)
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
        'columns': ['tenant_alias', 'user_id', 'display_name', 'email', 'visibility', 'last_modified', 'notifications_last_read', 'activities', 'activity_latest', 'content_items', 'content_item_latest', 'email_count'],
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
