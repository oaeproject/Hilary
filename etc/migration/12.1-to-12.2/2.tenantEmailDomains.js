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

var _ = require('underscore');
var optimist = require('optimist');
var path = require('path');

var Cassandra = require('oae-util/lib/cassandra');
var log = require('oae-logger').logger('tenants-email-domains-migrator');
var OAE = require('oae-util/lib/oae');
var TenantsAPI = require('oae-tenants');

var argv = optimist.usage('$0 [--config <path/to/config.js>] [--warnings <path/to/warnings.csv>]')
    .alias('c', 'config')
    .describe('c', 'Specify an alternate config file')
    .default('c', 'config.js')

    .alias('w', 'warnings')
    .describe('w', 'Specify the path to the file where unmappable users should be dumped to')
    .default('w', 'email-migration.csv')

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

// Spin up the application container. This will allow us to re-use existing APIs
OAE.init(config, function(err) {
    if (err) {
        log().error({'err': err}, 'Unable to spin up the application server');
        return process.exit(err.code);
    }

    // Get all the tenants
    Cassandra.runQuery('SELECT "alias", "emailDomain" FROM "Tenant"', [], function(err, rows) {
        if (err) {
            log().error({'err': err}, 'Unable to get all the tenants from the database');
            return process.exit(err.code);
        }

        // Iterate through all the tenants and copy the emailDomain
        var tenantsToUpdate = _.chain(rows)
            .map(Cassandra.rowToHash)
            .filter(function(hash) {
                return (hash.emailDomain);
            })
            .value();

        // Update all the tenants
        _updateTenants(tenantsToUpdate, function(err) {
            if (err) {
                log().error({'err': err}, 'Unable to copy the emailDomain value');
                return process.exit(err.code);
            }

            log().info('Updated all tenants');
            process.exit(0);
        });
    });
});

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
    var numberOfTenants = 250;
    var tenantsToUpdate = tenants.splice(0, numberOfTenants);
    var queries = _.map(tenantsToUpdate, function(tenant) {
        return Cassandra.constructUpsertCQL('Tenant', 'alias', tenant.alias, {'emailDomains': tenant.emailDomain});
    });
    Cassandra.runBatchQuery(queries, function(err) {
        if (err) {
            return callback(err);
        }

        log().info('Updated %d tenants their email domains', tenantsToUpdate.length);
        return _updateTenants(tenants, callback);
    });
}
