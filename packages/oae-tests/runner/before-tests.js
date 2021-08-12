/*!
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

/* eslint-disable no-undef */

import * as TestsUtil from 'oae-tests/lib/util.js';
import { logger } from 'oae-logger';
import nock from 'nock';
import { flush } from 'oae-util/lib/redis.js';
import * as MQ from 'oae-util/lib/mq.js';

const log = logger('before-tests');

let argv;
(async function () {
  const Optimist = await import('optimist');
  argv = Optimist.default
    .usage('Run the Hilary tests.\nUsage: $0')
    .alias('m', 'module')
    .describe('m', 'Only run a specific module. Just specify the module name.').argv;
})();

// Set our bootstrapping log level before loading other modules that will use logging
process.env.OAE_BOOTSTRAP_LOG_LEVEL = 'trace';
process.env.OAE_BOOTSTRAP_LOG_FILE = './tests.log';

// TODO experimental !!!!!!!!!!!!!!!!!!!!!
// Enabling ES6 support and defining global variables
(function (globals) {
  'use strict';
  globals.oaeTests = {};
})((1, eval)('this'));

/**
 * Determine whether or not we should drop the keyspace before the test. In cases
 * where we want to set up the schema by another means (e.g., to test unit tests
 *  over migrations), it is handy to use a schema that was pre-arranged for the test
 */
const dropKeyspaceBeforeTest = process.env.OAE_TEST_DROP_KEYSPACE_BEFORE !== 'false';

// First set up the keyspace and all of the column families required for all of the different OAE modules
before((callback) => {
  // Set an env var for running tests. This is being used in `redis.js`
  process.env.OAE_TESTS_RUNNING = 'true';

  // Create the configuration for the test
  let config;
  (async () => {
    config = await TestsUtil.createInitialTestConfig();

    TestsUtil.setUpBeforeTests(config, dropKeyspaceBeforeTest, () => {
      flush((error) => {
        if (error) {
          log().warn('Not able to flush redis');
        }

        return callback();
      });
    });
  })();
});

beforeEach(function (callback) {
  log().info('Beginning test "%s"', this.currentTest.title);
  MQ.purgeAllBoundQueues(callback);
});

afterEach(function (callback) {
  // Ensure we don't mess with the HTTP stack by accident
  nock.enableNetConnect();

  // Clean up all the mocks
  nock.cleanAll();

  log().info('Finishing test "%s"', this.currentTest.title);
  return callback();
});

/**
 * Executed once all of the tests for all of the different modules have finished running or
 * when one of the tests has caused an error. Drop the keyspace after all the tests are done
 */
after((callback) => {
  // Unset an env var for running tests once they are over
  process.env.OAE_TESTS_RUNNING = '';
  TestsUtil.cleanUpAfterTests(callback);
});
