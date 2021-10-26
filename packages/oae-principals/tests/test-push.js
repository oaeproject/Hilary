/*
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
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

import { assert } from 'chai';
import * as ActivityTestsUtil from 'oae-activity/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

import { ActivityConstants } from 'oae-activity/lib/constants.js';
import { PrincipalsConstants } from 'oae-principals/lib/constants.js';

describe('Group Push', () => {
  // Rest contexts that can be used performing rest requests
  let localAdminRestContext = null;
  let anonymousRestContext = null;

  /**
   * Function that will fill up the tenant admin and anymous rest contexts
   */
  before((callback) => {
    localAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.localhost.host);
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    callback();
  });

  describe('Authorization', () => {
    /**
     * Test that verifies registering for a feed goes through the proper authorization checks
     */
    it('verify signatures must be valid', (callback) => {
      TestsUtil.generateTestUsers(localAdminRestContext, 2, (error, users) => {
        assert.notExists(error);
        const { 0: simong, 1: branden } = users;

        RestAPI.User.getMe(simong.restContext, (error, simonFull) => {
          assert.notExists(error);

          const data = {
            authentication: {
              userId: simonFull.id,
              tenantAlias: simonFull.tenant.alias,
              signature: simonFull.signature
            },
            feeds: []
          };

          ActivityTestsUtil.getFullySetupPushClient(data, (client) => {
            // Create a group and get its full profile so we have a signature that we can use to register for push notifications
            RestAPI.Group.createGroup(
              simong.restContext,
              'displayName',
              'description',
              'public',
              'yes',
              [branden.user.id],
              null,
              (error, group) => {
                assert.notExists(error);
                RestAPI.Group.getGroup(simong.restContext, group.id, (error, group) => {
                  assert.notExists(error);

                  // Ensure we get a 400 error with an invalid activity stream id
                  client.subscribe(group.id, null, group.signature, null, (error_) => {
                    assert.strictEqual(error_.code, 400);

                    // Ensure we get a 400 error with a missing resource id
                    client.subscribe(null, 'activity', group.signature, null, (error_) => {
                      assert.strictEqual(error_.code, 400);

                      // Ensure we get a 401 error with an invalid token
                      client.subscribe(
                        group.id,
                        'activity',
                        { signature: group.signature.signature },
                        null,
                        (error_) => {
                          assert.strictEqual(error_.code, 401);
                          client.subscribe(
                            group.id,
                            'activity',
                            { expires: group.signature.expires },
                            null,
                            (error_) => {
                              assert.strictEqual(error_.code, 401);
                              client.subscribe(
                                group.id,
                                'activity',
                                {
                                  expires: Date.now() + 10_000,
                                  signature: 'foo',
                                  lastModified: Date.now()
                                },
                                null,
                                (error_) => {
                                  assert.strictEqual(error_.code, 401);

                                  // Simon should not be able to use a signature that was generated for Branden
                                  RestAPI.Group.getGroup(branden.restContext, group.id, (error, groupForBranden) => {
                                    assert.notExists(error);
                                    client.subscribe(
                                      group.id,
                                      'activity',
                                      groupForBranden.signature,
                                      null,
                                      (error_) => {
                                        assert.strictEqual(error_.code, 401);

                                        // Sanity check
                                        client.subscribe(
                                          group.id,
                                          'activity',
                                          {
                                            expires: group.signature.expires,
                                            signature: group.signature.signature
                                          },
                                          null,
                                          (error_) => {
                                            assert.notExists(error_);
                                            return callback();
                                          }
                                        );
                                      }
                                    );
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
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies that only group members/managers get to see the signature
     */
    it('verify only members get a signature', (callback) => {
      TestsUtil.generateTestUsers(localAdminRestContext, 2, (error, users) => {
        assert.notExists(error);
        const { 0: simong, 1: branden } = users;
        RestAPI.Group.createGroup(
          simong.restContext,
          'displayName',
          'description',
          'public',
          'yes',
          [],
          null,
          (error, group) => {
            assert.notExists(error);

            // Simon should see the signature, but Branden shouldn't
            RestAPI.Group.getGroup(simong.restContext, group.id, (error, group) => {
              assert.notExists(error);
              assert.ok(group.signature);
              RestAPI.Group.getGroup(branden.restContext, group.id, (error, group) => {
                assert.notExists(error);
                assert.ok(!group.signature);
                RestAPI.Group.getGroup(anonymousRestContext, group.id, (error, group) => {
                  assert.notExists(error);
                  assert.ok(!group.signature);

                  // If we make Branden a member, he should be able to see it
                  const changes = {};
                  changes[branden.user.id] = 'manager';
                  RestAPI.Group.setGroupMembers(simong.restContext, group.id, changes, (error_) => {
                    assert.notExists(error_);
                    RestAPI.Group.getGroup(branden.restContext, group.id, (error, group) => {
                      assert.notExists(error);
                      assert.ok(group.signature);
                      return callback();
                    });
                  });
                });
              });
            });
          }
        );
      });
    });
  });

  describe('Notifications', () => {
    /**
     * Creates 3 users: `branden`, `nico` and `simon` of which Branden and Simon are managers of a group. A websocket will be created
     * for the `Simon`-user which is both authenticated and registered for push notifications on the group.
     *
     * @param  {Function}       callback                Standard callback function
     * @param  {Object}         callback.contexts       An object that holds the context and user info for the created users
     * @param  {Discussion}     callback.group          The created group
     * @param  {Client}         callback.client         A websocket client that is authenticated for the `Simon`-user and is registered for push notificates on the created group
     * @throws {Error}                                  If anything goes wrong, an assertion error will be thrown
     */
    const setupFixture = function (callback) {
      TestsUtil.generateTestUsers(localAdminRestContext, 3, (error, users) => {
        assert.notExists(error);
        const { 0: branden, 1: simon, 2: nico } = users;

        const contexts = {
          branden,
          simon,
          nico
        };

        // Get the full profile so we have a signature to authenticate ourselves on the WS
        RestAPI.User.getMe(contexts.simon.restContext, (error, simonFull) => {
          assert.notExists(error);

          // Create a group and get the full group profile so we have a signature that we can use to register for push notifications
          RestAPI.Group.createGroup(
            contexts.simon.restContext,
            'displayName',
            'description',
            'public',
            'yes',
            [contexts.branden.user.id],
            null,
            (error, group) => {
              assert.notExists(error);
              RestAPI.Group.getGroup(contexts.simon.restContext, group.id, (error, group) => {
                assert.notExists(error);

                // Route and deliver activities
                ActivityTestsUtil.collectAndGetActivityStream(contexts.simon.restContext, null, null, () => {
                  // Register for some streams
                  const data = {
                    authentication: {
                      userId: contexts.simon.user.id,
                      tenantAlias: simonFull.tenant.alias,
                      signature: simonFull.signature
                    },
                    streams: [
                      {
                        resourceId: group.id,
                        streamType: 'activity',
                        token: group.signature
                      }
                    ]
                  };

                  ActivityTestsUtil.getFullySetupPushClient(data, (client) => {
                    setTimeout(() => {
                      callback(contexts, group, client);
                    }, 2000);
                  });
                });
              });
            }
          );
        });
      });
    };

    /**
     * Test that verifies an update gets pushed out
     */
    it('verify updates trigger a push notification', (callback) => {
      setupFixture((contexts, group, client) => {
        // Trigger an update
        RestAPI.Group.updateGroup(
          contexts.branden.restContext,
          group.id,
          { displayName: 'Laaike whatevs' },
          (error) => {
            assert.notExists(error);
          }
        );

        client.on('message', (message) => {
          if (message.resourceId === group.id && message.streamType === 'activity') {
            ActivityTestsUtil.assertActivity(
              message.activities[0],
              PrincipalsConstants.activity.ACTIVITY_GROUP_UPDATE,
              ActivityConstants.verbs.UPDATE,
              contexts.branden.user.id,
              group.id
            );

            // Verify the updated display name is present on the activity object
            assert.strictEqual(message.activities[0].object.displayName, 'Laaike whatevs');

            client.close(callback);
          }
        });
      });
    });

    /**
     * Test that verifies a visibility update gets pushed out
     */
    it('verify visibility updates trigger a push notification', (callback) => {
      setupFixture((contexts, group, client) => {
        // Trigger an update
        RestAPI.Group.updateGroup(contexts.branden.restContext, group.id, { visibility: 'loggedin' }, (error) => {
          assert.notExists(error);
        });

        client.on('message', (message) => {
          ActivityTestsUtil.assertActivity(
            message.activities[0],
            PrincipalsConstants.activity.ACTIVITY_GROUP_UPDATE_VISIBILITY,
            ActivityConstants.verbs.UPDATE,
            contexts.branden.user.id,
            group.id
          );

          // Verify the updated visibility setting is present on the activity object
          assert.strictEqual(message.activities[0].object.visibility, 'loggedin');

          client.close(callback);
        });
      });
    });

    /**
     * Test that verifies adding a user or changing a user's role triggers a push notification
     */
    it("verify adding a user to a group/changing a user's role triggers a push notification", (callback) => {
      setupFixture((contexts, group, client) => {
        let addedActivityReceived = false;
        let roleChangeReceived = false;

        // We should receive 2 messages. One for adding Nico to the group and one for changing his role
        client.on('message', (message) => {
          if (message.activities[0]['oae:activityType'] === PrincipalsConstants.activity.ACTIVITY_GROUP_ADD_MEMBER) {
            ActivityTestsUtil.assertActivity(
              message.activities[0],
              PrincipalsConstants.activity.ACTIVITY_GROUP_ADD_MEMBER,
              ActivityConstants.verbs.ADD,
              contexts.branden.user.id,
              contexts.nico.user.id,
              group.id
            );
            addedActivityReceived = true;
          } else if (
            message.activities[0]['oae:activityType'] === PrincipalsConstants.activity.ACTIVITY_GROUP_UPDATE_MEMBER_ROLE
          ) {
            ActivityTestsUtil.assertActivity(
              message.activities[0],
              PrincipalsConstants.activity.ACTIVITY_GROUP_UPDATE_MEMBER_ROLE,
              ActivityConstants.verbs.UPDATE,
              contexts.branden.user.id,
              contexts.nico.user.id,
              group.id
            );
            roleChangeReceived = true;
          }

          if (addedActivityReceived && roleChangeReceived) {
            client.close(callback);
          }
        });

        // Add nicolaas as a member of the group
        const membersToAdd = {};
        membersToAdd[contexts.nico.user.id] = 'member';
        RestAPI.Group.setGroupMembers(contexts.branden.restContext, group.id, membersToAdd, (error) => {
          assert.notExists(error);

          // Route and deliver activities
          ActivityTestsUtil.collectAndGetActivityStream(contexts.simon.restContext, null, null, () => {
            // Changing nico's role to a manager should result in a message on the socket as well
            membersToAdd[contexts.nico.user.id] = 'manager';
            RestAPI.Group.setGroupMembers(contexts.branden.restContext, group.id, membersToAdd, (error) => {
              assert.notExists(error);

              // Route and deliver activities
              ActivityTestsUtil.collectAndGetActivityStream(contexts.simon.restContext, null, null, () => {});
            });
          });
        });
      });
    });

    /**
     * Test that verifies joining a group results in a push notification
     */
    it('verify joining a group triggers a push notification', (callback) => {
      setupFixture((contexts, group, client) => {
        // Nicolaas joins the group
        RestAPI.Group.joinGroup(contexts.nico.restContext, group.id, (error) => {
          assert.notExists(error);
        });

        client.on('message', (message) => {
          ActivityTestsUtil.assertActivity(
            message.activities[0],
            PrincipalsConstants.activity.ACTIVITY_GROUP_JOIN,
            ActivityConstants.verbs.JOIN,
            contexts.nico.user.id,
            group.id
          );
          client.close(callback);
        });
      });
    });
  });
});
