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

/*
 * This migration script will copy each row's `emailDomain` value to `emailDomains`
 */

/* eslint-disable */
const path = require('path');
const _ = require('underscore');
const optimist = require('optimist');

const Cassandra = require('oae-util/lib/cassandra');
const log = require('oae-logger').logger('tenants-email-domains-migrator');
const OAE = require('oae-util/lib/oae');

const { argv } = optimist
  .usage('$0 [--config <path/to/config.js>] [--warnings <path/to/warnings.csv>]')
  .alias('c', 'config')
  .describe('c', 'Specify an alternate config file')
  .default('c', 'config.js')

  .alias('w', 'warnings')
  .describe('w', 'Specify the path to the file where unmappable users should be dumped to')
  .default('w', 'email-migration.csv')

  .alias('h', 'help')
  .describe('h', 'Show usage information');

if (argv.help) {
  optimist.showHelp();
}

// Get the config
const configPath = path.resolve(process.cwd(), argv.config);
const { config } = require(configPath);

// Ensure that this application server does NOT start processing any preview images
config.previews.enabled = false;

// Ensure that we're logging to standard out/err
config.log = {
  streams: [
    {
      level: 'info',
      stream: process.stdout
    }
  ]
};

function returnOnError(err, callback) {
  if (err) {
    return callback(err);
  }
}

/**
 * Update a set of tenants their email domains
 *
 * @param  {Object[]}   tenants         Each object represent a tenant that needs to be updated. The `alias` and `emailDomain` keys should be present
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
function _updateTenants(tenants, callback) {
  if (_.isEmpty(tenants)) {
    return callback();
  }

  // Update tenants in batches
  const numberOfTenants = 250;
  const tenantsToUpdate = tenants.splice(0, numberOfTenants);
  const queries = _.map(tenantsToUpdate, tenant => {
    return Cassandra.constructUpsertCQL('Tenant', 'alias', tenant.alias, {
      emailDomains: tenant.emailDomain
    });
  });
  Cassandra.runBatchQuery(queries, err => {
    returnOnError(err, callback);
    log().info('Updated %d tenants their email domains', tenantsToUpdate.length);
    return _updateTenants(tenants, callback);
  });
}

function exitIfError(err, message) {
  if (err) {
    log().error({ err }, message);
    return process.exit(err.code);
  }
}

// Spin up the application container. This will allow us to re-use existing APIs
OAE.init(config, err => {
  exitIfError(err, 'Unable to spin up the application server');

  // Get all the tenants
  Cassandra.runQuery('SELECT "alias", "emailDomain" FROM "Tenant"', [], (err, rows) => {
    exitIfError(err, 'Unable to get all the tenants from the database');

    // Iterate through all the tenants and copy the emailDomain
    const tenantsToUpdate = _.chain(rows)
      .map(Cassandra.rowToHash)
      .filter(hash => {
        return hash.emailDomain;
      })
      .value();

    // Update all the tenants
    _updateTenants(tenantsToUpdate, err => {
      exitIfError(err, 'Unable to copy the emailDomain value');
      log().info('Updated all tenants');
      process.exit(0);
    });
  });
});
