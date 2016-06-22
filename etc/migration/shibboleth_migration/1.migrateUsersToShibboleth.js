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
 * Map user accounts created with Shibboleth to the earlier ones
 * created with Google auth - Shibboleth EPPN should match email account.
 */

var _ = require('underscore');
var bunyan = require('bunyan');
var csv = require('csv');
var fs = require('fs');
var optimist = require('optimist');
var path = require('path');

var log = require('oae-logger').logger('oae-script-main');
var OAE = require('oae-util/lib/oae');
var ShibbolethMigrator = require('./migrateUsersToShibboleth');

var argv = optimist.usage('$0 [-t cam] [--config <path/to/config.js>]')
    .alias('t', 'tenant')
    .describe('t', 'Specify the tenant alias of the tenant whose users who wish to migrate')

    .alias('c', 'config')
    .describe('c', 'Specify an alternate config file')
    .default('c', 'config.js')

    .alias('h', 'help')
    .describe('h', 'Show usage information')
    .argv;

if (argv.help) {
    optimist.showHelp();
    return process.exit(0);
}

// Get the config
var configPath = path.resolve(process.cwd(), argv.config);
var config = require(configPath).config;

// ...and the tenant
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
    ]
};

// Set up the CSV file for errors
var fileStream = fs.createWriteStream(tenantAlias + '-shibboleth-migration.csv');
fileStream.on('error', function(err) {
    log().error({'err': err}, 'Error occurred when writing to the warnings file');
    process.exit(1);
});
var csvStream = csv.stringify({
    'columns': ['principal_id', 'email', 'display_name', 'login_id', 'message'],
    'header': true,
    'quoted': true
});
csvStream.pipe(fileStream);

// Spin up the application container. This will allow us to re-use existing APIs
OAE.init(config, function(err) {
    if (err) {
        log().error({'err': err}, 'Unable to spin up the application server');
        return _exit(err.code);
    }

    ShibbolethMigrator.doMigration(tenantAlias, csvStream, function(err, errors) {
        if (err) {
            return _exit(err.code);
        }

        if (errors > 0) {
            log().warn('Some users could not be mapped to Shibboleth logins, check the CSV file for more information');

        } else {
            log().info('All users were succesfully migrated to Shibboleth');
        }

        _exit(0);
    });
});

/**
 * Exit the migration script, but wait until the CSV stream has been properly closed down
 *
 * @param  {Number}     code    The exit code that should be used to stop the process with
 */
var _exit = function(code) {
    csvStream.end(function() {
        process.exit(code);
    });
};
