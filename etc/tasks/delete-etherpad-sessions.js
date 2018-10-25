#!/usr/bin/env node

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

const path = require('path');
const _ = require('underscore');
const optimist = require('optimist');

const Cassandra = require('oae-util/lib/cassandra');
const log = require('oae-logger').logger('delete-etherpad-sessions');
const OAE = require('oae-util/lib/oae');

const { argv } = optimist
  .usage('Delete the Etherpad session keys\n$0 [--config <path/to/config.js>]')
  .alias('c', 'config')
  .describe('c', 'Specify an alternate config file')
  .default('c', 'config.js')

  .alias('h', 'help')
  .describe('h', 'Show usage information');

if (argv.help) {
  optimist.showHelp();
}

// Get the config
const { config } = require(path.resolve(process.cwd(), argv.config));

// Ensure that this application server does NOT start processing any preview images
config.previews.enabled = false;

// Total number of deleted keys
let totalDeletedKeys = 0;

/**
 * Delete the session rows from the Etherpad column family
 *
 * @param  {Row[]}      rows            A set of rows from the Etherpad column family
 * @param  {Function}   callback        Standard callback function
 * @api private
 */
const _deleteSessionRows = function(rows, callback) {
  // Get the session keys
  const keysToDelete = _.chain(rows)
    .map(row => {
      return row.get('key');
    })
    .filter(key => {
      return key.indexOf('session') !== -1;
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

// Initialize the application container
OAE.init(config, err => {
  if (err) {
    log().error({ err }, 'Unable to spin up the application server');
    process.exit(err.code);
  }

  log().info(
    'Iterating over etherpad keys, depending on the amount of data in Etherpad this could take a while'
  );
  Cassandra.iterateAll(['key'], 'Etherpad', 'key', { batchSize: 500 }, _deleteSessionRows, err => {
    if (err) {
      log().error({ err }, 'An error occurred whilst deleting Etherpad keys');
      process.exit(1);
    }

    log().info('%d session keys have been deleted', totalDeletedKeys);
    process.exit(0);
  });
});
