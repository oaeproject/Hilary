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

var _ = require('underscore');
var optimist = require('optimist');
var path = require('path');
var util = require('util');

var Cassandra = require('oae-util/lib/cassandra');
var log = require('oae-logger').logger('delete-etherpad-sessions');
var OAE = require('oae-util/lib/oae');

var argv = optimist
    .usage('Delete the Etherpad session keys\n$0 [--config <path/to/config.js>]')
    .alias('c', 'config')
    .describe('c', 'Specify an alternate config file')
    .default('c', 'config.js')

    .alias('h', 'help')
    .describe('h', 'Show usage information')
    .argv;

if (argv.help) {
    optimist.showHelp();
    return;
}

// Get the config
var configPath = path.resolve(process.cwd(), argv.config);
var config = require(configPath).config;

// Ensure that this application server does NOT start processing any preview images
config.previews.enabled = false;

// Total number of deleted keys
var totalDeletedKeys = 0;

// Initialize the application container
OAE.init(config, function(err) {
    if (err) {
        log().error({'err': err}, 'Unable to spin up the application server');
        process.exit(err.code);
    }


    log().info('Iterating over etherpad keys, depending on the amount of data in Etherpad this could take a while');
    Cassandra.iterateAll(['key'], 'Etherpad', 'key', {'batchSize': 500}, _deleteSessionRows, function(err) {
        if (err) {
            log().error({'err': err}, 'An error occurred whilst deleting Etherpad keys');
            process.exit(1);
        }

        log().info('%d session keys have been deleted', totalDeletedKeys);
        process.exit(0);
    });
});

/**
 * Delete the session rows from the Etherpad column family
 *
 * @param  {Row[]}      rows            A set of rows from the Etherpad column family
 * @param  {Function}   callback        Standard callback function
 * @api private
 */
var _deleteSessionRows = function(rows, callback) {
    // Get the session keys
    var keysToDelete = _.chain(rows)
        .map(function(row) {
            return row.get('key');
        })
        .filter(function(key) {
            return (key.indexOf('session') !== -1);
        })
        .value();

    // If there were no session keys in this batch, we return immediately
    if (_.isEmpty(keysToDelete)) {
        return callback();
    }

    totalDeletedKeys += keysToDelete.length;
    log().info('Deleting %d keys', keysToDelete.length);
    return Cassandra.runQuery('DELETE FROM "Etherpad" WHERE key IN ?', [keysToDelete], callback);
};
