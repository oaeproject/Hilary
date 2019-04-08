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
 * visibilitys and limitations under the License.
 */

import assert from 'assert';
import _ from 'underscore';

import * as ConfigTestUtil from 'oae-config/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

import * as ActivityTestsUtil from 'oae-activity/lib/test/util';

describe('TinCanAPI', () => {
  // Will be set as a function that is executed when sending requests to the API
  let onRequest = null;

  // Rest context that can be used every time we need to make a request as a cam tenant admin
  let camAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as a gt tenant admin
  let gtAdminRestContext = null;

  let server = null;

  /**
   * Initializes the admin REST contexts
   */
  before(callback => {
    // Fill up the global admin rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    // Fill up the cam admin rest context
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    // Fill up the gt admin rest context
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);

    // Create a new express application to mock a Learning Record Store
    TestsUtil.createTestServer((_app, _server, _port) => {
      server = _server;
      _app.post('/', (req, res) => {
        onRequest(req);
        res.sendStatus(200);
      });

      // Set the endpoint for the LRS
      ConfigTestUtil.updateConfigAndWait(
        camAdminRestContext,
        null,
        { 'oae-tincanapi/lrs/endpoint': 'http://localhost:' + _port },
        err => {
          assert.ok(!err);
          callback();
        }
      );
    });
  });

  /**
   * Disables the LRS for the tenant after each test
   */
  afterEach(callback => {
    ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, { 'oae-tincanapi/lrs/enabled': false }, err => {
      assert.ok(!err);
      return callback();
    });
  });

  /**
   * Close the tin can api mock LRS
   */
  after(callback => {
    return server.close(callback);
  });

  /**
   * Test that verifies that TinCan API statements are sent to a configurable LRS.
   */
  it('verify post TinCan statements', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);

      const testUser = _.values(users)[0];

      // Collect any existing activities so they will not interfere with this test
      ActivityTestsUtil.collectAndGetActivityStream(testUser.restContext, null, null, (err, activityStream) => {
        assert.ok(!err);

        // Enable sending activities to the LRS as the default value is false
        ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, { 'oae-tincanapi/lrs/enabled': true }, err => {
          assert.ok(!err);

          const testLinks = {};
          let activitiesCollected = false;
          let tincanChecked = false;

          // Define the function that will get executed when our dummy LRS receives a request
          // This should only happen when we trigger an activity collection cycle at the end of the test
          onRequest = function(req) {
            // Check each activity if it matches the original
            _.each(req.body, (val, key) => {
              assert.strictEqual(val.actor.name, testUser.user.displayName);
              setTimeout(() => {
                assert.ok(testLinks[val.object.id]);
                assert.strictEqual(val.object.definition.name['en-US'], testLinks[val.object.id].displayName);
                assert.strictEqual(val.object.definition.description['en-US'], testLinks[val.object.id].description);
              }, 2000);
            });

            tincanChecked = true;

            // Because of the async nature of collecting activities and submitting them to the LRS
            // it's possible that the `collectAndGetActivityStream` callback hasn't been called yet
            if (tincanChecked && activitiesCollected) {
              callback();
            }
          };

          // Create a new link
          RestAPI.Content.createLink(
            testUser.restContext,
            'Link1',
            'The first link',
            'public',
            'http://www.google.be',
            [],
            [],
            [],
            (err, link) => {
              assert.ok(!err);

              // Store the created link
              testLinks[link.id] = link;

              // Create a new link
              RestAPI.Content.createLink(
                testUser.restContext,
                'Link2',
                'The second link',
                'private',
                'http://www.google.fr',
                [],
                [],
                [],
                (err, link) => {
                  assert.ok(!err);

                  // Store the created link
                  testLinks[link.id] = link;

                  // Create a new link
                  RestAPI.Content.createLink(
                    testUser.restContext,
                    'Link3',
                    'The third link',
                    'public',
                    'http://www.google.nl',
                    [],
                    [],
                    [],
                    (err, link) => {
                      assert.ok(!err);

                      // Store the created link
                      testLinks[link.id] = link;

                      // Force an activity collection cycle that will send the activities to our dummy LRS
                      // The test will be ended there
                      ActivityTestsUtil.collectAndGetActivityStream(
                        testUser.restContext,
                        null,
                        null,
                        (err, activityStream) => {
                          assert.ok(!err);
                          activitiesCollected = true;

                          // Because of the async nature of collecting activities and submitting them to the LRS
                          // it's possible that the activities submitted to the LRS haven't been checked for correctness yet
                          if (tincanChecked && activitiesCollected) {
                            callback();
                          }
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
      });
    });
  });

  /**
   * Test that verifies that no statements are posted when the LRS is disabled
   */
  it('verify TinCan integration enabled', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);

      const testUser = _.values(users)[0];

      // Collect any existing activities so they will not interfere with this test
      ActivityTestsUtil.collectAndGetActivityStream(testUser.restContext, null, null, (err, activityStream) => {
        assert.ok(!err);

        onRequest = function(req) {
          assert.fail(null, null, 'No statements should be sent when LRS integration is disabled');
        };

        // Create a new link
        RestAPI.Content.createLink(
          testUser.restContext,
          'Link1',
          'The first link',
          'public',
          'http://www.google.be',
          [],
          [],
          [],
          (err, link) => {
            assert.ok(!err);

            // Force the activities
            ActivityTestsUtil.collectAndGetActivityStream(testUser.restContext, null, null, (err, activityStream) => {
              assert.ok(!err);
              callback();
            });
          }
        );
      });
    });
  });

  /**
   * Test that verifies if statements are (not) sent when activities are received from multiple tenants with different LRS-enabled values
   */
  it('verify permeable tenant TinCan statements', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);

      const camUser = _.values(users)[0];

      // Collect any existing activities so they will not interfere with this test
      ActivityTestsUtil.collectAndGetActivityStream(camUser.restContext, null, null, (err, activityStream) => {
        assert.ok(!err);

        // Enable sending activities to the LRS as the default value is false
        // Note that we only enable it for the Cambridge tenant
        ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, { 'oae-tincanapi/lrs/enabled': true }, err => {
          assert.ok(!err);

          let activitiesCollected = false;
          let tincanChecked = false;
          const tincanSent = false;

          // Define the function that will get executed when our dummy LRS receives a request
          // This should only happen when we trigger an activity collection cycle at the end of the test
          onRequest = function(req) {
            // Check each activity if it matches the original
            _.each(req.body, (val, key) => {
              assert.strictEqual(val.actor.name, camUser.user.displayName);
              assert.strictEqual(val.actor.account.name, camUser.user.publicAlias);
            });

            tincanChecked = true;

            // Because of the async nature of collecting activities and submitting them to the LRS
            // it's possible that the `collectAndGetActivityStream` callback hasn't been called yet
            if (tincanChecked && activitiesCollected) {
              callback();
            }
          };

          // Create a new link on the Cambridge tenant
          RestAPI.Content.createLink(
            camUser.restContext,
            'Link1',
            'The first link',
            'public',
            'http://www.google.be',
            [],
            [],
            [],
            (err, link) => {
              assert.ok(!err);

              // Create a new user on the GT tenant
              TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, gtUsers) => {
                assert.ok(!err);

                // Store the gtUser
                const gtUser = _.values(users)[0];

                // Create a new link on the GT tenant
                RestAPI.Content.createLink(
                  gtUser.restContext,
                  'Link2',
                  'The second link',
                  'private',
                  'http://www.google.nl',
                  [],
                  [],
                  [],
                  (err, link) => {
                    assert.ok(!err);

                    // Force an activity collection cycle. It doesn't really matter which restContext we pass in, as that is only used to retrieve the activity stream
                    ActivityTestsUtil.collectAndGetActivityStream(
                      camUser.restContext,
                      null,
                      null,
                      (err, activityStream) => {
                        assert.ok(!err);
                        activitiesCollected = true;

                        // Because of the async nature of collecting activities and submitting them to the LRS
                        // it's possible that the activities submitted to the LRS haven't been checked for correctness yet
                        if (tincanChecked && activitiesCollected) {
                          callback();
                        }
                      }
                    );
                  }
                );
              });
            }
          );
        });
      });
    });
  });
});
