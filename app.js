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

var optimist = require('optimist');
var argv = optimist.usage('$0 [--config <path/to/config.js>]')
    .alias('c', 'config')
    .describe('c', 'Specify an alternate config file')
    .default('c', __dirname + '/config.js')

    .alias('h', 'help')
    .describe('h', 'Show usage information')
    .argv;

var OAE = require('oae-util/lib/oae');
var log = require('oae-logger').logger();

if (argv.help) {
    optimist.showHelp();
    return;
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

var config = require(argv.config).config;

// Start the server and all of its tenants
OAE.init(config, function(err) {
    if (err) {
        log().error({err: err}, 'Error initializing server.');
    }
    log().info("Initialization all done ... Firing up tenants ... Enjoy!");
});
