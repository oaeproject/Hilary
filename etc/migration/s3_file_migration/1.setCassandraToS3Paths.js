/*!
 * Copyright 2018 Apereo Foundation (AF) Licensed under the
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
 * Update all the fields that hold a storage type for an instance of OAE in Cassandra.
 * Usage: node 1.setCassandraToS3Paths.js --config <path-to-config> -t <new-storage-type> | bunyan
 */

const _ = require('underscore');
const bunyan = require('bunyan');
const csv = require('csv');
const fs = require('fs');
const optimist = require('optimist');
const path = require('path');

const log = require('oae-logger').logger('oae-script-main');
const OAE = require('oae-util/lib/oae');
const S3Migrator = require('./setCassandraToS3Paths');

const argv = optimist.usage('$0 [-t amazons3] [--config <path/to/config.js>]')
    .alias('c', 'config')
    .describe('c', 'Specify an alternate config file')
    .default('c', '../../../config.js')

    .alias('t', 'type')
    .describe('t', 'The type of storage you wish to migrate to. Should be either "amazons3" or "local".')
    .default('t', 'amazons3')

    .alias('h', 'help')
    .describe('h', 'Show usage information')
    .argv;

if (argv.help) {
    optimist.showHelp();
    return process.exit(0);
}

// Get the config
const configPath = path.resolve(process.cwd(), argv.config);
const config = require(configPath).config;

// Get the type of storage we wish to migrate to
const type = argv.type;

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
const fileStream = fs.createWriteStream('s3-migration.csv');
fileStream.on('error', function(err) {
    log().error({'err': err}, 'Error occurred when writing to the warnings file');
    process.exit(1);
});
const csvStream = csv.stringify({
    'columns': ['table', 'field', 'value',  'message'],
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

    S3Migrator.doMigration(csvStream, type, function(err, errors) {
        if (err) {
            return _exit(err.code);
        }

        if (errors > 0) {
            log().warn('There were errors when changing paths to S3 in Cassandra, check the CSV file for more information');

        } else {
            log().info('All paths in Cassandra were successfully migrated to S3');
        }

        _exit(0);
    });
});

/**
 * Exit the migration script, but wait until the CSV stream has been properly closed down
 *
 * @param  {Number}     code    The exit code that should be used to stop the process with
 */
const _exit = function(code) {
    csvStream.end(function() {
        process.exit(code);
    });
};
