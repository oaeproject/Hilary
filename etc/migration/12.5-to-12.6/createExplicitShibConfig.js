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

var _ = require('underscore');
var optimist = require('optimist');
var path = require('path');

var Cassandra = require('oae-util/lib/cassandra');
var ConfigAPI = require('oae-config/lib/api');
var log = require('oae-logger').logger('tenants-shib-config-migrator');
var OAE = require('oae-util/lib/oae');
var PrincipalsDAO = require('oae-principals/lib/internal/dao');
var TenantsAPI = require('oae-tenants');

var argv = optimist.usage('$0 [--config <path/to/config.js>]')
    .alias('c', 'config')
    .describe('c', 'Specify an alternate config file')
    .default('c', 'config.js')

    .alias('h', 'help')
    .describe('h', 'Show usage information')
    .argv;

if (argv.help) {
    optimist.showHelp();
    process.exit(0);
}

// Get the config
var configPath = path.resolve(process.cwd(), argv.config);
var config = require(configPath).config;

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

// Shibboleth attribute config field
var configKey = 'oae-authentication/shibboleth/externalIdAttributes';

// Current default attribute order
var currentDefault = 'eppn persistent-id targeted-id';

// Spin up the application container. This will allow us to re-use existing APIs
OAE.init(config, function(err) {
    if (err) {
        log().error({'err': err}, 'Unable to spin up the application server');
        return process.exit(err.code);
    }

    // Get all the tenants that are not disabled
    var tenants = TenantsAPI.getTenants(true);

    _filterTenants(tenants, function(err, tenantsToUpdate) {
        if (err) {
            log().error({'err': err}, 'Failed to filter out tenants with no users or Shibboleth');
            return process.exit(err.code);
        }

        // Update all the tenants
        _updateTenants(tenantsToUpdate, function(err) {
            if (err) {
                log().error({'err': err}, 'Unable to create explicit Shibboleth configs');
                return process.exit(err.code);
            }

            log().info('Updated all tenants');
            process.exit(0);
        });
    });
});

function _filterTenants(tenants, callback) {
    var AuthenticationConfig = ConfigAPI.config('oae-authentication');
    var tenantsWithShibEnabled = [];

    // We only want the tenancies with Shibboleth enabled...
    _.each(tenants, function(tenant) {
        if (AuthenticationConfig.getValue(tenant.alias, 'shibboleth', 'enabled')) {
            log().info('Adding tenant %s to tenant with Shibboleth enabled', tenant.alias);
            tenantsWithShibEnabled.push(tenant.alias);
        }
    });
    log().info('Found %s tenants with Shibboleth enabled', tenantsWithShibEnabled.length);

    // ...that have at least one user
    _getTenantsWithPrincipals(tenants, function(err, tenantsWithPrincipals) {
        if (err) {
            log().error({'err': err}, 'Failed to find tenancies with at least one user');
            return callback(err);
        }

        var tenantsWithShibAndUsers = _.intersection(tenantsWithShibEnabled, tenantsWithPrincipals);
        log().info('Found %s tenants with users and Shibboleth enabled', tenantsWithShibAndUsers.length);
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
    var tenantsWithPrincipals = [];
    PrincipalsDAO.iterateAll(['principalId','tenantAlias'], 100, _addToTenantsWithPrincipals, function(err) {
        if (err) {
            log().error({'err': err}, 'Failed to iterate all users');
            return callback(err);
        }

        tenantsWithPrincipals = _.uniq(tenantsWithPrincipals);
        log().info('Found %s tenants with at least one user', tenantsWithPrincipals.length);

        return callback(null, tenantsWithPrincipals);
    });

    /*!
     * Add each user's `tenantAlias` to `tenantsWithPrincipals` array.
     *
     * @param  {Object[]}   principalHashes       The principals to filter and aggregate
     * @param  {Function}   callback              Will be invoked when the principals are aggregated
     */
    function _addToTenantsWithPrincipals(rows, callback) {
        _.each(rows, function(principalHash) {
            var tenantAlias = principalHash.tenantAlias;
            if (!_.contains(tenantsWithPrincipals, tenantAlias) && PrincipalsDAO.isUser(principalHash.principalId)) {
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
    var numberOfTenants = 100;
    var tenantsToUpdate = tenants.splice(0, numberOfTenants);
    var queries = _.map(tenantsToUpdate, function(tenant) {
        return Cassandra.constructUpsertCQL('Config', ['tenantAlias', 'configKey'], [tenant, configKey], {'value': currentDefault});
    });
    Cassandra.runBatchQuery(queries, function(err) {
        if (err) {
            return callback(err);
        }

        log().info('Updated %d tenants to explicit Shibboleth config', tenantsToUpdate.length);
        return _updateTenants(tenants, callback);
    });
}
