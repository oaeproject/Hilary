/*!
 * Copyright 2016 Apereo Foundation (AF) Licensed under the
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

/*!
 * This migration script will make all existing emails in the database lower-
 * case.
 */

var _ = require('underscore');
var optimist = require('optimist');
var path = require('path');

var Cassandra = require('oae-util/lib/cassandra');
var log = require('oae-logger').logger('lower-case-email-migrator');
var LowerCaseEmailsMigrator = require('./lib/lowerCaseEmails');
var OAE = require('oae-util/lib/oae');
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

// Start the application container. This will allow us to re-use existing APIs
OAE.init(config, function(err) {
    if (err) {
        log().error({'err': err}, 'Unable to spin up the application server');
        return process.exit(err.code);
    }

    LowerCaseEmailsMigrator.doMigration(function(err, stats) {
        if (err) {
            log().error({'err': err}, 'An error occurred while migrating emails to lower case');
        } else {
            log().info({'stats': stats}, 'Migration complete');
        }

        return process.exit(0);
    });
});
