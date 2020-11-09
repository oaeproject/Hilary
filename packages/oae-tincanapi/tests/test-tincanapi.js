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

import { assert } from 'chai';

import * as ConfigTestUtil from 'oae-config/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

import * as ActivityTestsUtil from 'oae-activity/lib/test/util';

import { and, forEachObjIndexed } from 'ramda';

const PUBLIC = 'public';
const PRIVATE = 'private';
const NO_VIEWERS = [];
const NO_FOLDERS = [];
const NO_MANAGERS = [];

const { collectAndGetActivityStream } = ActivityTestsUtil;
const { createLink } = RestAPI.Content;
const { generateTestUsers } = TestsUtil;
const { createTestServer } = TestsUtil;
const { updateConfigAndWait } = ConfigTestUtil;

describe('TinCanAPI', () => {
  // Will be set as a function that is executed when sending requests to the API
  let onRequest = null;

  // Rest context that can be used every time we need to make a request as a cam tenant admin
  let asCambridgeTenantAdmin = null;
  // Rest context that can be used every time we need to make a request as a gt tenant admin
  let asGeorgiaTechTenantAdmin = null;

  let server = null;

  /**
   * Initializes the admin REST contexts
   */
  before(callback => {
    // Fill up the cam admin rest context
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // Fill up the gt admin rest context
    asGeorgiaTechTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);

    // Create a new express application to mock a Learning Record Store
    createTestServer((_app, _server, _port) => {
      server = _server;
      _app.post('/', (req, res) => {
        onRequest(req);
        res.sendStatus(200);
      });

      // Set the endpoint for the LRS
      updateConfigAndWait(
        asCambridgeTenantAdmin,
        null,
        { 'oae-tincanapi/lrs/endpoint': `http://localhost:${_port}` },
        err => {
          assert.notExists(err);
          callback();
        }
      );
    });
  });

  /**
   * Disables the LRS for the tenant after each test
   */
  afterEach(callback => {
    updateConfigAndWait(asCambridgeTenantAdmin, null, { 'oae-tincanapi/lrs/enabled': false }, err => {
      assert.notExists(err);
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
    generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
      assert.notExists(err);

      const { 0: someUser } = users;
      const asSomeUser = someUser.restContext;

      // Collect any existing activities so they will not interfere with this test
      collectAndGetActivityStream(asSomeUser, null, null, (err /* , activityStream */) => {
        assert.notExists(err);

        // Enable sending activities to the LRS as the default value is false
        updateConfigAndWait(asCambridgeTenantAdmin, null, { 'oae-tincanapi/lrs/enabled': true }, err => {
          assert.notExists(err);

          const testLinks = {};
          let activitiesCollected = false;
          let tincanChecked = false;

          /**
           * Define the function that will get executed when our dummy LRS receives a request
           * This should only happen when we trigger an activity collection cycle at the end of the test
           */
          onRequest = req => {
            // Check each activity if it matches the original
            forEachObjIndexed(val => {
              assert.strictEqual(val.actor.name, someUser.user.displayName);
              setTimeout(() => {
                assert.ok(testLinks[val.object.id]);
                assert.strictEqual(val.object.definition.name['en-US'], testLinks[val.object.id].displayName);
                assert.strictEqual(val.object.definition.description['en-US'], testLinks[val.object.id].description);
              }, 2000);
            }, req.body);

            tincanChecked = true;

            /**
             * Because of the async nature of collecting activities and submitting them to the LRS
             * it's possible that the `collectAndGetActivityStream` callback hasn't been called yet
             */
            if (and(tincanChecked, activitiesCollected)) {
              callback();
            }
          };

          // Create a new link
          createLink(
            asSomeUser,
            {
              displayName: 'Link1',
              description: 'The first link',
              PUBLIC,
              link: 'http://www.google.be',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (err, link) => {
              assert.notExists(err);

              // Store the created link
              testLinks[link.id] = link;

              // Create a new link
              createLink(
                asSomeUser,
                {
                  displayName: 'Link2',
                  description: 'The second link',
                  visibility: PRIVATE,
                  link: 'http://www.google.fr',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (err, link) => {
                  assert.notExists(err);

                  // Store the created link
                  testLinks[link.id] = link;

                  // Create a new link
                  createLink(
                    asSomeUser,
                    {
                      displayName: 'Link3',
                      description: 'The third link',
                      PUBLIC,
                      link: 'http://www.google.nl',
                      managers: NO_MANAGERS,
                      viewers: NO_VIEWERS,
                      folders: NO_FOLDERS
                    },
                    (err, link) => {
                      assert.notExists(err);

                      // Store the created link
                      testLinks[link.id] = link;

                      /**
                       * Force an activity collection cycle that will send the activities to our dummy LRS
                       * The test will be ended there
                       */
                      collectAndGetActivityStream(asSomeUser, null, null, (err /* , activityStream */) => {
                        assert.notExists(err);
                        activitiesCollected = true;

                        /**
                         * Because of the async nature of collecting activities and submitting them to the LRS
                         * it's possible that the activities submitted to the LRS haven't been checked for correctness yet
                         */
                        if (and(tincanChecked, activitiesCollected)) {
                          callback();
                        }
                      });
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
    generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
      assert.notExists(err);

      const { 0: someUser } = users;
      const asSomeUser = someUser.restContext;

      // Collect any existing activities so they will not interfere with this test
      collectAndGetActivityStream(asSomeUser, null, null, (err /* , activityStream */) => {
        assert.notExists(err);

        onRequest = (/* req */) => {
          assert.fail(null, null, 'No statements should be sent when LRS integration is disabled');
        };

        // Create a new link
        createLink(
          asSomeUser,
          {
            displayName: 'Link1',
            description: 'The first link',
            visibility: PUBLIC,
            link: 'http://www.google.be',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (err /* , link */) => {
            assert.notExists(err);

            // Force the activities
            collectAndGetActivityStream(asSomeUser, null, null, (err /* , activityStream */) => {
              assert.notExists(err);
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
    generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
      assert.notExists(err);

      const { 0: someUser } = users;
      const asSomeUser = someUser.restContext;

      // Collect any existing activities so they will not interfere with this test
      collectAndGetActivityStream(asSomeUser, null, null, (err /* , activityStream */) => {
        assert.notExists(err);

        /**
         * Enable sending activities to the LRS as the default value is false
         * Note that we only enable it for the Cambridge tenant
         */
        updateConfigAndWait(asCambridgeTenantAdmin, null, { 'oae-tincanapi/lrs/enabled': true }, err => {
          assert.notExists(err);

          let activitiesCollected = false;
          let tincanChecked = false;

          /**
           * Define the function that will get executed when our dummy LRS receives a request
           * This should only happen when we trigger an activity collection cycle at the end of the test
           */
          onRequest = function(req) {
            // Check each activity if it matches the original
            forEachObjIndexed(val => {
              assert.strictEqual(val.actor.name, someUser.user.displayName);
              assert.strictEqual(val.actor.account.name, someUser.user.publicAlias);
            }, req.body);

            tincanChecked = true;

            /**
             * Because of the async nature of collecting activities and submitting them to the LRS
             * it's possible that the `collectAndGetActivityStream` callback hasn't been called yet
             */
            if (and(tincanChecked, activitiesCollected)) {
              callback();
            }
          };

          // Create a new link on the Cambridge tenant
          createLink(
            asSomeUser,
            {
              displayName: 'Link1',
              description: 'The first link',
              PUBLIC,
              link: 'http://www.google.be',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (err /* , link */) => {
              assert.notExists(err);

              // Create a new user on the GT tenant
              generateTestUsers(asGeorgiaTechTenantAdmin, 1, (err, users) => {
                assert.notExists(err);

                // Store the gtUser
                const { 0: someUserFromGeorgiaTech } = users;
                const asSomeUserFromGT = someUserFromGeorgiaTech.restContext;

                // Create a new link on the GT tenant
                createLink(
                  asSomeUserFromGT,
                  {
                    displayName: 'Link2',
                    description: 'The second link',
                    PRIVATE,
                    link: 'http://www.google.nl',
                    managers: NO_MANAGERS,
                    viewers: NO_VIEWERS,
                    folders: NO_FOLDERS
                  },
                  (err /* , link */) => {
                    assert.notExists(err);

                    /**
                     * Force an activity collection cycle. It doesn't really matter which restContext we pass in,
                     * as that is only used to retrieve the activity stream
                     */
                    collectAndGetActivityStream(asSomeUser, null, null, (err /* , activityStream */) => {
                      assert.notExists(err);

                      activitiesCollected = true;

                      /**
                       * Because of the async nature of collecting activities and submitting them to the LRS
                       * it's possible that the activities submitted to the LRS haven't been checked for correctness yet
                       */
                      if (and(tincanChecked, activitiesCollected)) {
                        callback();
                      }
                    });
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
