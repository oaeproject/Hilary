#!/usr/bin/env node

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
 * This migration script will create explicit Shibboleth configuration for all tenants
 * that have users and Shibboleth enabled
 */

const path = require('path');
const _ = require('underscore');
const optimist = require('optimist');

const Cassandra = require('oae-util/lib/cassandra');
const ConfigAPI = require('oae-config/lib/api');
const log = require('oae-logger').logger('tenants-shib-config-migrator');
const OAE = require('oae-util/lib/oae');
const PrincipalsDAO = require('oae-principals/lib/internal/dao');
const TenantsAPI = require('oae-tenants');

const { argv } = optimist
  .usage('$0 [--config <path/to/config.js>]')
  .alias('c', 'config')
  .describe('c', 'Specify an alternate config file')
  .default('c', 'config.js')

  .alias('h', 'help')
  .describe('h', 'Show usage information');

if (argv.help) {
  optimist.showHelp();
  process.exit(0);
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

// Shibboleth attribute config field
const configKey = 'oae-authentication/shibboleth/externalIdAttributes';

// Current default attribute order
const currentDefault = 'eppn persistent-id targeted-id';

// Spin up the application container. This will allow us to re-use existing APIs
OAE.init(config, err => {
  if (err) {
    log().error({ err }, 'Unable to spin up the application server');
    return process.exit(err.code);
  }

  // Get all the tenants that are not disabled
  const tenants = TenantsAPI.getTenants(true);

  _filterTenants(tenants, (err, tenantsToUpdate) => {
    if (err) {
      log().error({ err }, 'Failed to filter out tenants with no users or Shibboleth');
      return process.exit(err.code);
    }

    // Update all the tenants
    _updateTenants(tenantsToUpdate, err => {
      if (err) {
        log().error({ err }, 'Unable to create explicit Shibboleth configs');
        return process.exit(err.code);
      }

      log().info('Updated all tenants');
      process.exit(0);
    });
  });
});

function _filterTenants(tenants, callback) {
  const AuthenticationConfig = ConfigAPI.config('oae-authentication');
  const tenantsWithShibEnabled = [];

  // We only want the tenancies with Shibboleth enabled...
  _.each(tenants, tenant => {
    if (AuthenticationConfig.getValue(tenant.alias, 'shibboleth', 'enabled')) {
      log().info('Adding tenant %s to tenant with Shibboleth enabled', tenant.alias);
      tenantsWithShibEnabled.push(tenant.alias);
    }
  });
  log().info('Found %s tenants with Shibboleth enabled', tenantsWithShibEnabled.length);

  // ...that have at least one user
  _getTenantsWithPrincipals(tenants, (err, tenantsWithPrincipals) => {
    if (err) {
      log().error({ err }, 'Failed to find tenancies with at least one user');
      return callback(err);
    }

    const tenantsWithShibAndUsers = _.intersection(tenantsWithShibEnabled, tenantsWithPrincipals);
    log().info(
      'Found %s tenants with users and Shibboleth enabled',
      tenantsWithShibAndUsers.length
    );
    return callback(null, tenantsWithShibAndUsers);
  });
}

/**
 * Page through all the users in the system and find tenancies with users
 *
 * @param  {String}     tenants                             The list of tenants to filter
 * @param  {Function}   callback                            Invoked when users have been collected
 * @param  {Object}     callback.err                        An error that occurred, if any
 * @param  {Object[]}   callback.tenantsWithPrincipals      An array of tenant aliases
 * @api private
 */
function _getTenantsWithPrincipals(tenants, callback) {
  let tenantsWithPrincipals = [];
  PrincipalsDAO.iterateAll(
    ['principalId', 'tenantAlias'],
    100,
    _addToTenantsWithPrincipals,
    err => {
      if (err) {
        log().error({ err }, 'Failed to iterate all users');
        return callback(err);
      }

      tenantsWithPrincipals = _.uniq(tenantsWithPrincipals);
      log().info('Found %s tenants with at least one user', tenantsWithPrincipals.length);

      return callback(null, tenantsWithPrincipals);
    }
  );

  /*!
     * Add each user's `tenantAlias` to `tenantsWithPrincipals` array.
     *
     * @param  {Object[]}   principalHashes       The principals to filter and aggregate
     * @param  {Function}   callback              Will be invoked when the principals are aggregated
     */
  function _addToTenantsWithPrincipals(rows, callback) {
    _.each(rows, principalHash => {
      const { tenantAlias } = principalHash;
      if (
        !_.contains(tenantsWithPrincipals, tenantAlias) &&
        PrincipalsDAO.isUser(principalHash.principalId)
      ) {
        log().info('Adding tenant %s to tenants with users', tenantAlias);
        tenantsWithPrincipals.push(tenantAlias);
      }
    });

    return callback();
  }
}

/**
 * Update Shibboleth config for a set of tenants
 *
 * @param  {Object[]}   tenants         Each object represent a tenant that needs to be updated.
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
function _updateTenants(tenants, callback) {
  if (_.isEmpty(tenants)) {
    return callback();
  }

  // Update tenants in batches
  const numberOfTenants = 100;
  const tenantsToUpdate = tenants.splice(0, numberOfTenants);
  const queries = _.map(tenantsToUpdate, tenant => {
    return Cassandra.constructUpsertCQL(
      'Config',
      ['tenantAlias', 'configKey'],
      [tenant, configKey],
      { value: currentDefault }
    );
  });

  Cassandra.runBatchQuery(queries, err => {
    if (err) {
      return callback(err);
    }

    log().info('Updated %d tenants to explicit Shibboleth config', tenantsToUpdate.length);
    return _updateTenants(tenants, callback);
  });
}
