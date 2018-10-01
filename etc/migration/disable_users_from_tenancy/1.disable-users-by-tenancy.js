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
 * Disable users belonging to a disabled tenancy
 * Github issue #1304
 */

const path = require('path');
const optimist = require('optimist');

const log = require('oae-logger').logger('oae-script-main');
const OAE = require('oae-util/lib/oae');

const DisableUsersMigration = require('./lib/disable-users-by-tenancy');

/**
 * $ node 1.disable-users-by-tenancy.js -t rp | bunyan
 */
const { argv } = optimist
  .usage('$0 -t cam [--config <path/to/config.js>]')
  .demand('t')
  .alias('t', 'tenant')
  .describe('t', 'Specify the tenant alias of the tenant whose users who wish to migrate')
  .alias('c', 'config')
  .describe('c', 'Specify an alternate config file')
  .default('c', 'config.js')
  .alias('h', 'help')
  .describe('h', 'Show usage information');

if (argv.help) {
  optimist.showHelp();
}

// Get the config
const configPath = path.resolve(process.cwd(), argv.config);
const { config } = require(configPath);

// Get the tenant
const tenantAlias = argv.tenant;
if (!tenantAlias) {
  log().error('You need to specify the tenant alias');
}

// Ensure that this application server does NOT start processing any preview
// images
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

// Spin up the application container. This will allow us to re-use existing APIs
OAE.init(config, err => {
  if (err) {
    log().error(
      {
        err
      },
      'Unable to spin up the application server'
    );
    process.exit(err.code);
  }

  DisableUsersMigration.doMigration(null, tenantAlias, true, (err, users) => {
    if (err) {
      log().warn('Migration not completed successfully.');
      process.exit(err.code);
    }

    log().info('Finished migration for ' + users.length + ' users.');

    // Nothing left to do, exiting.
    process.exit(0);
  });
});
