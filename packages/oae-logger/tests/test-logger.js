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

import { format } from 'util';

import { assert } from 'chai';
import { describe, before, after, it } from 'mocha';
import { logger } from 'oae-logger';

import * as RestAPI from 'oae-rest';
import * as TelemetryAPI from 'oae-telemetry';
import * as TestsUtil from 'oae-tests/lib/util';

const { getTelemetryData } = RestAPI.Telemetry;
const { generateRandomText, createGlobalAdminRestContext } = TestsUtil;
const { init } = TelemetryAPI;

describe('Logger', () => {
  // Rest context that can be used every time we need to make a request as a global admin
  let asGlobalAdmin = null;

  /**
   * Function that will fill up the global admin rest context and enable the API
   */
  before((callback) => {
    // Fill up the global admin rest context
    asGlobalAdmin = createGlobalAdminRestContext();

    // Enable the telemetry API
    init({ enabled: true }, (error) => {
      assert.notExists(error);

      return callback();
    });
  });

  /**
   * Function that will disable the telemetry API
   */
  after((callback) => {
    init({ enabled: false }, (error) => {
      assert.notExists(error);

      return callback();
    });
  });

  /**
   * Test that verifies that error counts are counted through the telemetry API
   */
  it('verify that error logs are counted through the telemetry API', (callback) => {
    // Construct a logger specificly for this test
    const loggerName = generateRandomText();
    const log = logger(loggerName);

    // Get the initial count
    getTelemetryData(asGlobalAdmin, (error, initialTelemetryData) => {
      assert.notExists(error);

      // Generate some error logs by using a variation of parameter values
      log().error('Simple error log');
      log().error({ err: new Error('error object') });
      log().error({ err: new Error('error object') }, 'With a message');
      log().error({ err: { foo: 'bar' } });
      log().error({ foo: 'bar' });
      log().error({ foo: 'bar' }, 'With a message');

      // Get the new telemetry daya
      getTelemetryData(asGlobalAdmin, (error, newTelemetryData) => {
        assert.notExists(error);

        // Get the initial total error count
        let initialTotalCount = 0;
        if (initialTelemetryData.logger && initialTelemetryData.logger['error.count']) {
          initialTotalCount = initialTelemetryData.logger['error.count'];
        }

        // The total error count should've increased with 6
        assert.strictEqual(newTelemetryData.logger['error.count'], initialTotalCount + 6);

        // The error count for this specific logger should be 6
        const telemetryName = format('error.%s.count', loggerName);
        assert.strictEqual(newTelemetryData.logger[telemetryName], 6);

        return callback();
      });
    });
  });
});
