#!/usr/bin/env node

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

/* eslint-disable */
const _ = require('underscore');
const Cassandra = require('oae-util/lib/cassandra');
const { config } = require('../../../config');

/**
 * Notify the user that the migration is complete
 */
const _done = function(err) {
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
const _migrateRows = function(rows, callback) {
  const queries = [];

  _.each(rows, row => {
    const created = Math.floor(row.get('wt') / 1000);
    const principalId = row.get('principalId');
    const query = Cassandra.constructUpsertCQL('Principals', 'principalId', principalId, {
      created
    });
    queries.push(query);
  });

  // Add the created timestamp and move on to the next page
  return Cassandra.runBatchQuery(queries, callback);
};

/**
 * Start the migration
 */
const startProcessing = function() {
  Cassandra.runQuery('ALTER TABLE "Principals" ADD "created" timestamp', null, () => {
    Cassandra.runQuery('ALTER TABLE "Principals" ADD "createdBy" text', null, () => {
      return Cassandra.iterateAll(
        ['principalId', 'WRITETIME("tenantAlias") AS wt'],
        'Principals',
        'principalId',
        { batchSize: 30 },
        _migrateRows,
        _done
      );
    });
  });
};

// Connect to cassandra and start the migration
Cassandra.init(config.cassandra, err => {
  if (err) {
    console.error(err.msg);
    process.exit(err.code);
  }

  startProcessing();
});
