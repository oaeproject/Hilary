/*
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

var bunyan = require('bunyan');

var config = (module.exports.config = {});

// Configuration for running tests

/**
 * `config.test`
 *
 * Configuration namespace for the OAE tests.
 *
 * @param  {String}    timeout            The mocha timeout that should be used
 * @param  {String}    level              The log level that should be used for testing
 * @param  {String}    path               The log path that should be used for testing
 */
config.test = {
    'timeout': 880000,
    'level': 'info',
    'path': './tests.log'
};
