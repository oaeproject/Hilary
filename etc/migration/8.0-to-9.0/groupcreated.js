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

var _ = require('underscore');

var Cassandra = require('oae-util/lib/cassandra');

var config = require('../../../config').config;

// Connect to cassandra and start the migration
Cassandra.init(config.cassandra, function(err) {
    if (err) {
        console.error(err.msg);
        process.exit(err.code);
    }

    startProcessing();
});

/**
 * Notify the user that the migration is complete
 */
var _done = function(err) {
    if (err) {
        console.error(err.msg);
        process.exit(err.code);
    }
    console.log('Migration complete');
    process.exit();
};

/**
 * Migrate a set of rows by adding a `created` timestamp to each (the timestamp will be when the row was
 * last written)
 *
 * @param  {Row[]}      rows        An array of cassandra rows to update
 * @param  {Function}   callback    A standard callback function
 */
var _migrateRows = function(rows, callback) {
    var queries = [];

    _.each(rows, function(row) {
        var created = Math.floor(row.get('wt').value / 1000);
        var principalId = row.get('principalId').value;
        var query = Cassandra.constructUpsertCQL('Principals', 'principalId', principalId, {'created': created});
        queries.push(query);
    });

    // Add the created timestamp and move on to the next page
    return Cassandra.runBatchQuery(queries, callback);
};

/**
 * Start the migration
 */
var startProcessing = function() {
    Cassandra.runQuery('ALTER TABLE "Principals" ADD "created" timestamp', null, function() {
        Cassandra.runQuery('ALTER TABLE "Principals" ADD "createdBy" text', null, function() {
            return Cassandra.iterateAll(['principalId', 'WRITETIME("tenantAlias") AS wt'], 'Principals', 'principalId', {'batchSize': 30}, _migrateRows, _done);
        });
    });
};
