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

import assert from 'assert';
import _ from 'underscore';

import * as RestAPI from 'oae-rest';
import * as TelemetryAPI from 'oae-telemetry';
import * as TestsUtil from 'oae-tests';

describe('Telemetry', () => {
  /*!
   * Create an enabled telemetry configuration from the given configuration
   *
   * @param  {Object}     config  The configuration object with which to create an enabled telemetry config
   */
  const _createConfig = function(config) {
    return _.extend({ enabled: true }, config);
  };

  let Telemetry = null;

  // Rest context that can be used every time we need to make a request as an anonymous user on the Cambridge tenant
  let anonymousCamRestContext = null;
  // Rest context that can be used every time we need to make a request as an anonymous user on the global admin tenant
  let anonymousGlobalRestContext = null;
  // Rest context that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;

  /**
   * Function that will fill up the global admin, tenant admin and anymous rest context
   */
  before(callback => {
    // Fill up the anonymous cam rest context
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    // Fill up the anonymous global rest context
    anonymousGlobalRestContext = TestsUtil.createGlobalRestContext();
    // Fill up tenant admin rest context
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    // Fill up the global admin rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    return callback();
  });

  /**
   * Function that initializes the Telemetry API before each test
   */
  beforeEach(callback => {
    // Reset the telemetry configuration before each telemetry test
    TelemetryAPI.init(_createConfig(), () => {
      // *Force* a reset of all telemetry values, even if it is not time to do so
      TelemetryAPI.reset(err => {
        assert.ok(!err);
        Telemetry = TelemetryAPI.telemetry('tests');
        return callback();
      });
    });
  });

  describe('Publish and Reset', () => {
    /**
     * Test that verifies that when the publisher is invoked, it publishes the set of data that is available, and that when reset is invoked,
     * it resets the data for the next publishing cycle.
     */
    it('verify publish interval publishes the proper data while reset clears the data', callback => {
      // Configure the telemetry API such that on the first second we get a publish, then in the second second we
      // get a reset, then in the 3rd we get another publish
      TelemetryAPI.init(_createConfig({ publishInterval: 1, resetInterval: 2 }), err => {
        assert.ok(!err);

        // Note that if this takes longer than one second our test fails intermittently :( I'm not sure we can avoid this
        // without disrupting the test
        Telemetry.incr('incr', 10);
        Telemetry.append('append', 50);
        Telemetry.append('append', 30);

        // Wait 1s for the publish event to verify the published data
        TelemetryAPI.emitter.once('publish', data => {
          assert.strictEqual(data.tests.incr, 10);
          assert.strictEqual(data.tests.append.length, 2);
          assert.strictEqual(data.tests.append[0], 50);
          assert.strictEqual(data.tests.append[1], 30);

          // Once we get our reset, wait for the next publish to ensure our counts are reset
          TelemetryAPI.emitter.once('reset', () => {
            TelemetryAPI.emitter.once('publish', data => {
              // Either the top-level tests module object should be gone, or the incr key should either be 0 or falsey
              assert.ok(!data.tests || !data.tests.incr);

              // Either the top-level tests module object should be gone, or the append key histograms should be either falsey or empty
              assert.ok(!data.tests || !data.tests.append || !data.tests.append.length);

              return callback();
            });
          });
        });
      });
    });
  });

  describe('#incr()', () => {
    /**
     * Test the verifies Telemetry.incr will increase by 1
     */
    it('verify it increases by one', callback => {
      Telemetry.incr('incr', 1);
      TelemetryAPI.getTelemetryData((err, data) => {
        assert.ok(!err);
        assert.strictEqual(data.tests.incr, 1);
        return callback();
      });
    });

    /**
     * Test that verifies Telemetry.incr of 10 will increase by 10
     */
    it('verify multiple increases', callback => {
      Telemetry.incr('incr', 10);
      TelemetryAPI.getTelemetryData((err, data) => {
        assert.ok(!err);
        assert.strictEqual(data.tests.incr, 10);
        return callback();
      });
    });
  });

  describe('#append()', () => {
    /**
     * Test that verifies appending data to a telemetry stat will properly hold the data
     */
    it('verify it appends data to a list', callback => {
      Telemetry.append('append', 10);

      TelemetryAPI.getTelemetryData((err, data) => {
        assert.ok(!err);
        assert.strictEqual(data.tests.append.length, 1);
        assert.strictEqual(data.tests.append[0], 10);

        Telemetry.append('append', 5);
        TelemetryAPI.getTelemetryData((err, data) => {
          assert.strictEqual(data.tests.append.length, 2);
          assert.strictEqual(data.tests.append[0], 10);
          assert.strictEqual(data.tests.append[1], 5);
          return callback();
        });
      });
    });
  });

  describe('REST endpoint', () => {
    /**
     * Test that verifies that only a global admin can request the telemetry data
     */
    it('verify that only a global admin can request the telemetry data', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, john) => {
        assert.ok(!err);

        // Request the telemetry data using an anonymous tenant user
        RestAPI.Telemetry.getTelemetryData(anonymousCamRestContext, (err, res) => {
          assert.ok(err);
          assert.strictEqual(err.code, 404);

          // Request the telemetry data using an anonymous global user
          RestAPI.Telemetry.getTelemetryData(anonymousGlobalRestContext, (err, res) => {
            assert.ok(err);
            assert.strictEqual(err.code, 401);
            assert.strictEqual(err.msg, 'Only global administrators are allowed to retrieve telemetry data');

            // Request the telemetry data using a tenant user
            RestAPI.Telemetry.getTelemetryData(john.restContext, (err, res) => {
              assert.ok(err);
              assert.strictEqual(err.code, 404);

              // Request the telemetry data using a tenant admin
              RestAPI.Telemetry.getTelemetryData(camAdminRestContext, (err, res) => {
                assert.ok(err);
                assert.strictEqual(err.code, 404);

                // Request the telemetry data using a global admin
                RestAPI.Telemetry.getTelemetryData(globalAdminRestContext, (err, res) => {
                  assert.ok(!err);
                  return callback();
                });
              });
            });
          });
        });
      });
    });
  });
});
