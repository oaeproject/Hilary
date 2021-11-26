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

import process from 'node:process';
import { callbackify } from 'node:util';
import { createInitialTestConfig, setUpBeforeTests, cleanUpAfterTests } from 'oae-tests/lib/util.js';
import { logger } from 'oae-logger';
import nock from 'nock';
import { flush } from 'oae-util/lib/redis.js';
import * as MQ from 'oae-util/lib/mq.js';
import { pipe, equals, not } from 'ramda';

const log = logger('before-tests');
const isNotFalse = pipe(equals('false'), not);

// Set our bootstrapping log level before loading other modules that will use logging
process.env.OAE_BOOTSTRAP_LOG_LEVEL = 'trace';
process.env.OAE_BOOTSTRAP_LOG_FILE = './tests.log';

/**
 * Determine whether or not we should drop the keyspace before the test. In cases
 * where we want to set up the schema by another means (e.g., to test unit tests
 * over migrations), it is handy to use a schema that was pre-arranged for the test
 */
const dropKeyspaceBeforeTest = isNotFalse(process.env.OAE_TEST_DROP_KEYSPACE_BEFORE);

// First set up the keyspace and all of the column families required for all of the different OAE modules
before((callback) => {
  // Set an env var for running tests. This is being used in `redis.js`
  process.env.OAE_TESTS_RUNNING = 'true';

  // Create the configuration for the test
  callbackify(createInitialTestConfig)((error, config) => {
    if (error) return callback(error);
    setUpBeforeTests(config, dropKeyspaceBeforeTest, () => {
      callbackify(flush)((error) => {
        if (error) {
          log().warn('Not able to flush redis');
        }

        return callback();
      });
    });
  });
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
  cleanUpAfterTests(callback);
});
