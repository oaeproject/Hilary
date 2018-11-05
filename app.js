#!/usr/bin/env node

/*
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

/* eslint-disable security/detect-non-literal-require */
const path = require('path');
const repl = require('repl');
const PrettyStream = require('bunyan-prettystream');
const optimist = require('optimist');
const _ = require('underscore');

const { argv } = optimist
  .usage('$0 [--config <path/to/config.js>]')
  .alias('c', 'config')
  .describe('c', 'Specify an alternate config file')
  .default('c', path.join(__dirname, '/config.js'))

  .alias('h', 'help')
  .describe('h', 'Show usage information')

  .alias('i', 'interactive')
  .describe('i', 'Start an interactive shell, implies --pretty')

  .alias('p', 'pretty')
  .describe('p', 'Pretty print the logs');

const OAE = require('oae-util/lib/oae');
const log = require('oae-logger').logger();

if (argv.help) {
  optimist.showHelp();
  process.exit(0);
}

// If a relative path that starts with `./` has been provided,
// we turn it into an absolute path based on the current working directory
if (argv.config.match(/^\.\//)) {
  argv.config = process.cwd() + argv.config.substring(1);
  // If a different non-absolute path has been provided, we turn
  // it into an absolute path based on the current working directory
} else if (!argv.config.match(/^\//)) {
  argv.config = process.cwd() + '/' + argv.config;
}

const configPath = argv.config;
let { config } = require(configPath);

const envConfigPath = `${process.cwd()}/${process.env.NODE_ENV || 'local'}`;
const envConfig = require(envConfigPath).config;
config = _.extend({}, config, envConfig);

// If the user asked for pretty output change the log stream
if (argv.pretty || argv.interactive) {
  const prettyStdOut = new PrettyStream();
  prettyStdOut.pipe(process.stdout);

  config.log.streams[0].stream = prettyStdOut;
}

// Start the server and all of its tenants
OAE.init(config, err => {
  if (err) {
    log().error({ err }, 'Error initializing server.');
  }
  log().info('Initialization all done ... Firing up tenants ... Enjoy!');

  // If the user asked for an interactive shell start the node REPL and pass in the OAE and log objects
  if (argv.interactive) {
    const replServer = repl.start({
      prompt: 'oae > '
    });
    replServer.context.OAE = OAE;
    replServer.context.log = log;
  }
});
