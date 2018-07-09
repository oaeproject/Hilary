/*!
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

/* eslint-disable no-unused-vars */
/* eslint-disable max-nested-callbacks */
const assert = require('assert');
const _ = require('underscore');

const RestAPI = require('oae-rest');
const TestsUtil = require('oae-tests');

const ActivityTestUtil = require('oae-activity/lib/test/util');

describe('Activity push', () => {
  // Rest context that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;

  /**
   * Function that will fill up the tenant admin and anymous rest context
   */
  before(callback => {
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    return callback();
  });

  describe('Protocol', () => {
    /**
     * Test that verifies that messages that are sent by a client need to have an ID
     */
    it('verify missing id results in an immediate disconnect', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, mrvisser) => {
        RestAPI.User.getMe(mrvisser.restContext, (err, meData) => {
          assert.ok(!err);

          const data = {
            authentication: {
              userId: meData.id,
              tenantAlias: meData.tenant.alias,
              signature: meData.signature
            }
          };
          ActivityTestUtil.getFullySetupPushClient(data, client => {
            const socket = client.getRawSocket();

            let receivedMessages = 0;

            // The socket should close
            client.on('close', () => {
              // We need to have received a message first
              assert.strictEqual(receivedMessages, 1);
              callback();
            });

            client.on('message', message => {
              // Ensure we only get one message
              assert.strictEqual(receivedMessages, 0);
              assert.strictEqual(message.error.code, 400);
              receivedMessages++;
            });

            // Send a message that contains no ID
            socket.write('{}');
          });
        });
      });
    });

    /**
     * Test that verifies that non JSON messages get rejected
     */
    it('verify a malformed message results in an immediate disconnect', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, mrvisser) => {
        RestAPI.User.getMe(mrvisser.restContext, (err, meData) => {
          assert.ok(!err);

          const data = {
            authentication: {
              userId: meData.id,
              tenantAlias: meData.tenant.alias,
              signature: meData.signature
            }
          };
          ActivityTestUtil.getFullySetupPushClient(data, client => {
            const socket = client.getRawSocket();

            let receivedMessages = 0;

            // The socket should close because we're not authenticated
            client.on('close', () => {
              // We need to have received a message first
              assert.strictEqual(receivedMessages, 1);
              callback();
            });

            client.on('message', message => {
              // Ensure we only get one message
              assert.strictEqual(receivedMessages, 0);
              assert.strictEqual(message.error.code, 400);
              receivedMessages++;
            });

            // Send a malformed message
            socket.write('NO JSON');
          });
        });
      });
    });

    /**
     * Test that verifies the sockets gets closed when the client does not provide their authentication credentials within a reasonable timeframe
     */
    it('verify authentication timeout', callback => {
      ActivityTestUtil.getPushClient(client => {
        client.on('close', () => {
          return callback();
        });
      });
    });
  });

  describe('Authentication', () => {
    /**
     * Test that verifies that the very first frame that gets sent has to be an authentication frame
     */
    it('verify no authentication frame results in a disconnect', callback => {
      ActivityTestUtil.getPushClient(client => {
        client.sendMessage('foo', {}, (err, msg) => {
          assert.ok(err);
          assert.strictEqual(err.code, 401);
        });

        const timeoutID = setTimeout(() => {
          assert.fail('Expected the socket to be closed by now');
        }, 7000);

        client.on('close', () => {
          clearTimeout(timeoutID);
          callback();
        });
      });
    });

    /**
     * Test that verifies that an invalid user id results in an error
     */
    it('verify an invalid user id results in a error', callback => {
      ActivityTestUtil.getPushClient(client => {
        let receivedResponse = false;

        // Sending an invalid authentication frame should fail
        client.sendMessage(
          'authentication',
          { userId: 'not-a-user-id', signature: {} },
          (err, data) => {
            assert.strictEqual(err.code, 400);
            receivedResponse = true;
          }
        );

        client.on('close', () => {
          assert.ok(receivedResponse, 'Expected to receive a message before closing the socket');
          callback();
        });
      });
    });

    /**
     * Test that verifies that an invalid signature results in an error
     */
    it('verify a missing signature results in a error', callback => {
      ActivityTestUtil.getPushClient(client => {
        let receivedResponse = false;

        // Sending an invalid authentication frame should fail
        client.sendMessage('authentication', { userId: 'u:camtest:foobar' }, (err, data) => {
          assert.strictEqual(err.code, 400);
          receivedResponse = true;
        });

        client.on('close', () => {
          assert.ok(receivedResponse, 'Expected to receive a message before closing the socket');
          callback();
        });
      });
    });

    /**
     * Test that verifies that clients can authenticate themselves on the socket
     */
    it('verify authentication', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, mrvisser) => {
        RestAPI.User.getMe(mrvisser.restContext, (err, meData) => {
          assert.ok(!err);

          ActivityTestUtil.getPushClient(client => {
            // The first message should always be the authentication message
            // If not, the backend should close the socket.
            client.authenticate(meData.id, meData.tenant.alias, meData.signature, (err, data) => {
              assert.ok(!err);
              client.close(callback);
            });
          });
        });
      });
    });
  });

  describe('Subscribing', () => {
    /**
     * Test that verifies the subscription validation
     */
    it('verify validation', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, mrvisser) => {
        RestAPI.User.getMe(mrvisser.restContext, (err, mrvisserMeData) => {
          assert.ok(!err);

          const data = {
            authentication: {
              userId: mrvisserMeData.id,
              tenantAlias: mrvisserMeData.tenant.alias,
              signature: mrvisserMeData.signature
            }
          };
          ActivityTestUtil.getFullySetupPushClient(data, client => {
            // Registering on an unknown feed should result in an error
            client.subscribe(mrvisser.user.id, 'unknown', { some: 'token' }, null, (err, msg) => {
              assert.strictEqual(err.code, 400);

              // Specifying an unknown format should result in a validation error
              client.subscribe(
                mrvisser.user.id,
                'activity',
                { some: 'token' },
                'unknown format',
                (err, msg) => {
                  assert.strictEqual(err.code, 400);

                  client.close(callback);
                }
              );
            });
          });
        });
      });
    });

    /**
     * Test that verifies subscribing and authorization on activity streams
     */
    it('verify subscribing and authorization on activity streams', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, mrvisser, simon) => {
        RestAPI.User.getMe(mrvisser.restContext, (err, mrvisserMeData) => {
          assert.ok(!err);

          const data = {
            authentication: {
              userId: mrvisserMeData.id,
              tenantAlias: mrvisserMeData.tenant.alias,
              signature: mrvisserMeData.signature
            }
          };
          ActivityTestUtil.getFullySetupPushClient(data, client => {
            // Mrvisser cannot subscribe on Simon's feed
            client.subscribe(
              simon.user.id,
              'activity',
              mrvisserMeData.signature,
              null,
              (err, msg) => {
                assert.strictEqual(err.code, 401);

                // He can register for his own feed without a token since he's authenticated on the socket
                client.subscribe(mrvisser.user.id, 'activity', null, null, (err, msg) => {
                  assert.ok(!err);

                  // He can register on a group feed
                  RestAPI.Group.createGroup(
                    mrvisser.restContext,
                    'Group title',
                    'Group description',
                    'public',
                    'yes',
                    [],
                    [],
                    (err, group) => {
                      assert.ok(!err);
                      RestAPI.Group.getGroup(mrvisser.restContext, group.id, (err, group) => {
                        assert.ok(!err);
                        client.subscribe(
                          group.id,
                          'activity',
                          group.signature,
                          null,
                          (err, msg) => {
                            assert.ok(!err);

                            client.close(callback);
                          }
                        );
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

    /**
     * Test that verifies subscribing and authorization on notification streams
     */
    it('verify subscribing and authorization on notification streams', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, mrvisser, simon) => {
        assert.ok(!err);

        RestAPI.User.getMe(mrvisser.restContext, (err, mrvisserMeData) => {
          assert.ok(!err);

          const data = {
            authentication: {
              userId: mrvisserMeData.id,
              tenantAlias: mrvisserMeData.tenant.alias,
              signature: mrvisserMeData.signature
            }
          };
          ActivityTestUtil.getFullySetupPushClient(data, client => {
            // Mrvisser cannot subscribe on Simon's feed
            client.subscribe(
              simon.user.id,
              'notification',
              mrvisserMeData.signature,
              null,
              (err, msg) => {
                assert.strictEqual(err.code, 401);

                // Groups don't have notification feeds
                RestAPI.Group.createGroup(
                  mrvisser.restContext,
                  'Group title',
                  'Group description',
                  'public',
                  'yes',
                  [],
                  [],
                  (err, group) => {
                    assert.ok(!err);
                    RestAPI.Group.getGroup(mrvisser.restContext, group.id, (err, group) => {
                      assert.ok(!err);
                      client.subscribe(
                        group.id,
                        'notification',
                        group.signature,
                        null,
                        (err, msg) => {
                          assert.strictEqual(err.code, 400);

                          // He can register for his own feed without a token since he's authenticated on the socket
                          client.subscribe(
                            mrvisser.user.id,
                            'notification',
                            null,
                            null,
                            (err, msg) => {
                              assert.ok(!err);

                              client.close(callback);
                            }
                          );
                        }
                      );
                    });
                  }
                );
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies that you only get activities that occur on the subscribed resources
     */
    it('verify segregation', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, mrvisser) => {
        RestAPI.User.getMe(mrvisser.restContext, (err, mrvisserMeData) => {
          assert.ok(!err);

          RestAPI.Content.createLink(
            mrvisser.restContext,
            'Yahoo',
            'Yahoo',
            'public',
            'http://www.yahoo.ca',
            [],
            [],
            [],
            (err, yahooLink) => {
              assert.ok(!err);
              RestAPI.Content.getContent(mrvisser.restContext, yahooLink.id, (err, yahooLink) => {
                assert.ok(!err);
                RestAPI.Content.createLink(
                  mrvisser.restContext,
                  'Google',
                  'Google',
                  'public',
                  'http://www.google.ca',
                  [],
                  [],
                  [],
                  (err, googleLink) => {
                    assert.ok(!err);
                    RestAPI.Content.getContent(
                      mrvisser.restContext,
                      googleLink.id,
                      (err, googleLink) => {
                        assert.ok(!err);

                        // Route and deliver activities
                        ActivityTestUtil.collectAndGetActivityStream(
                          mrvisser.restContext,
                          null,
                          null,
                          err => {
                            assert.ok(!err);

                            // Subscribe on the Yahoo link
                            const data = {
                              authentication: {
                                userId: mrvisserMeData.id,
                                tenantAlias: mrvisserMeData.tenant.alias,
                                signature: mrvisserMeData.signature
                              },
                              streams: [
                                {
                                  resourceId: yahooLink.id,
                                  streamType: 'activity',
                                  token: yahooLink.signature
                                }
                              ]
                            };
                            ActivityTestUtil.getFullySetupPushClient(data, client => {
                              // Wait for a bit so the content create notification is sent
                              setTimeout(() => {
                                client.on('message', message => {
                                  if (message) {
                                    assert.fail(
                                      'No activities should be pushed to this stream as nothing happened on the "yahoo" link'
                                    );
                                  }
                                });

                                // Trigger an update on the google item, we should not get an activity on the websocket for that content item
                                RestAPI.Content.updateContent(
                                  mrvisser.restContext,
                                  googleLink.id,
                                  { displayName: 'Google woo' },
                                  err => {
                                    assert.ok(!err);

                                    // Route and deliver activities
                                    ActivityTestUtil.collectAndGetActivityStream(
                                      mrvisser.restContext,
                                      null,
                                      null,
                                      err => {
                                        assert.ok(!err);

                                        client.close(callback);
                                      }
                                    );
                                  }
                                );
                              }, 1000);
                            });
                          }
                        );
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

    /**
     * Test that verifies that multiple clients can listen on the same feed
     */
    it('verify multiple clients on same feed', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, mrvisser) => {
        RestAPI.User.getMe(mrvisser.restContext, (err, mrvisserMeData) => {
          assert.ok(!err);

          // Get 2 clients
          const data = {
            authentication: {
              userId: mrvisserMeData.id,
              tenantAlias: mrvisserMeData.tenant.alias,
              signature: mrvisserMeData.signature
            },
            streams: [
              {
                resourceId: mrvisserMeData.id,
                streamType: 'activity',
                token: mrvisserMeData.signature
              },
              {
                resourceId: mrvisserMeData.id,
                streamType: 'notification',
                token: mrvisserMeData.signature
              }
            ]
          };
          ActivityTestUtil.collectAndGetActivityStream(mrvisser.restContext, null, null, err => {
            assert.ok(!err);

            // Setup the clients
            ActivityTestUtil.getFullySetupPushClient(data, clientA => {
              ActivityTestUtil.getFullySetupPushClient(data, clientB => {
                // Do something that ends up in the `activity`  activitystream
                RestAPI.Content.createLink(
                  mrvisser.restContext,
                  'Yahoo',
                  'Yahoo',
                  'public',
                  'http://www.yahoo.ca',
                  [],
                  [],
                  [],
                  (err, link) => {
                    assert.ok(!err);
                  }
                );

                let clientAReceived = false;
                let clientBReceived = false;

                clientA.once('message', message => {
                  assert.ok(!message.error);
                  clientAReceived = true;
                  if (clientAReceived && clientBReceived) {
                    bothReceived();
                  }
                });
                clientB.once('message', message => {
                  assert.ok(!message.error);
                  clientBReceived = true;
                  if (clientAReceived && clientBReceived) {
                    bothReceived();
                  }
                });

                /**
                 * Gets executed when both client A and B have received their message
                 */
                const bothReceived = function() {
                  // If we close client B, only A should receive a message
                  clientB.close(() => {
                    clientB.on('message', () => {
                      assert.fail(
                        'The socket on client B has been closed, this socket should not receive any more messages'
                      );
                    });

                    // Do something that ends up in the `activity`  activitystream
                    RestAPI.Content.createLink(
                      mrvisser.restContext,
                      'Yahoo',
                      'Yahoo',
                      'public',
                      'http://www.yahoo.ca',
                      [],
                      [],
                      [],
                      (err, link) => {
                        assert.ok(!err);
                      }
                    );

                    clientA.once('message', message => {
                      assert.ok(!message.error);
                      clientA.close(callback);
                    });
                  });
                };
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the format for activity entities can be specified
     */
    it('verify the activity entities format can be specified', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, mrvisser, simong) => {
        RestAPI.User.getMe(mrvisser.restContext, (err, mrvisserMeData) => {
          assert.ok(!err);

          // Register a push client for mrvisser who is subscribed to his activitystream with the regular format and his notification stream with the internal format
          const data = {
            authentication: {
              userId: mrvisserMeData.id,
              tenantAlias: mrvisserMeData.tenant.alias,
              signature: mrvisserMeData.signature
            },
            streams: [
              {
                resourceId: mrvisserMeData.id,
                streamType: 'activity',
                token: mrvisserMeData.signature,
                format: 'activitystreams'
              },
              {
                resourceId: mrvisserMeData.id,
                streamType: 'notification',
                token: mrvisserMeData.signature,
                format: 'internal'
              }
            ]
          };

          // Setup the client
          ActivityTestUtil.getFullySetupPushClient(data, client => {
            // Simon will now create a discussion and share it with mrvisser, this will trigger an activity that gets delivered on both streams
            // To ensure proper scrubbing of data, simon will have a private profile
            RestAPI.User.updateUser(
              simong.restContext,
              simong.user.id,
              { visibility: 'private' },
              (err, updatedUser) => {
                assert.ok(!err);
                simong.user = updatedUser;
                let discussion = null;

                RestAPI.Discussions.createDiscussion(
                  simong.restContext,
                  'Test discussion',
                  'Test discussion description',
                  'public',
                  [],
                  [mrvisser.user.id],
                  (err, _discussion) => {
                    assert.ok(!err);
                    discussion = _discussion;

                    // Force a collection cycle as notifications only get delivered upon aggregation
                    ActivityTestUtil.collectAndGetActivityStream(
                      mrvisser.restContext,
                      null,
                      null,
                      err => {
                        assert.ok(!err);
                      }
                    );
                  }
                );

                let activitiesReceived = 0;
                client.on('message', message => {
                  activitiesReceived++;

                  assert.ok(message.activities);
                  assert.strictEqual(message.activities.length, 1);
                  const activity = message.activities[0];
                  assert.ok(activity);

                  let allowedActorProperties = null;
                  let allowedObjectProperties = null;

                  if (message.streamType === 'notification') {
                    // Assert that the activity entities are internally formatted
                    assert.strictEqual(message.format, 'internal');

                    // Assert that the actor entity is a user object augmented with an oae:id and objectType
                    assert.ok(activity.actor);
                    assert.strictEqual(activity.actor['oae:id'], simong.user.id);
                    assert.strictEqual(activity.actor.id, simong.user.id);
                    assert.strictEqual(activity.actor.displayName, simong.user.publicAlias);
                    assert.strictEqual(activity.actor.lastModified, simong.user.lastModified);
                    assert.strictEqual(activity.actor.visibility, 'private');
                    assert.ok(_.isObject(activity.actor.picture));
                    assert.strictEqual(activity.actor.resourceType, 'user');
                    assert.strictEqual(activity.actor.objectType, 'user');
                    assert.ok(_.isObject(activity.actor.tenant));

                    // Ensure only these properties are present
                    allowedActorProperties = [
                      'oae:id',
                      'id',
                      'displayName',
                      'visibility',
                      'picture',
                      'resourceType',
                      'objectType',
                      'tenant',
                      'lastModified'
                    ];
                    _.each(activity.actor, (value, key) => {
                      assert.ok(
                        _.contains(allowedActorProperties, key),
                        key + ' is not allowed on an internally formatted activity entity'
                      );
                    });

                    // Assert that the object entity is a discussion object augmented with an oae:id and objectType
                    assert.ok(activity.object);
                    assert.strictEqual(activity.object['oae:id'], discussion.id);
                    assert.strictEqual(activity.object.id, discussion.id);
                    assert.strictEqual(activity.object.visibility, discussion.visibility);
                    assert.strictEqual(activity.object.displayName, discussion.displayName);
                    assert.strictEqual(activity.object.description, discussion.description);
                    assert.strictEqual(activity.object.createdBy, discussion.createdBy);
                    assert.strictEqual(activity.object.created, discussion.created);
                    assert.strictEqual(activity.object.lastModified, discussion.lastModified);
                    assert.strictEqual(activity.object.profilePath, discussion.profilePath);
                    assert.strictEqual(activity.object.resourceType, discussion.resourceType);
                    assert.strictEqual(activity.object.objectType, 'discussion');
                    assert.ok(_.isObject(activity.object.tenant));

                    allowedObjectProperties = [
                      'tenant',
                      'id',
                      'visibility',
                      'displayName',
                      'description',
                      'resourceSubType',
                      'createdBy',
                      'created',
                      'lastModified',
                      'profilePath',
                      'resourceType',
                      'latestRevisionId',
                      'previews',
                      'signature',
                      'objectType',
                      'oae:id'
                    ];
                    _.each(activity.object, (value, key) => {
                      assert.ok(
                        _.contains(allowedObjectProperties, key),
                        key + ' is not allowed on an internally formatted activity entity'
                      );
                    });
                  } else {
                    // Assert that the activity entities are activitystrea.ms formatted
                    assert.strictEqual(message.format, 'activitystreams');

                    // Assert that the actor entity is in the proper activitystreams format
                    assert.ok(activity.actor);
                    assert.strictEqual(activity.actor['oae:id'], simong.user.id);
                    assert.strictEqual(activity.actor['oae:visibility'], simong.user.visibility);
                    assert.strictEqual(activity.actor.displayName, simong.user.publicAlias);
                    assert.strictEqual(activity.actor.objectType, 'user');
                    assert.strictEqual(
                      activity.actor.id,
                      'http://' + global.oaeTests.tenants.cam.host + '/api/user/' + simong.user.id
                    );
                    assert.ok(_.isObject(activity.actor['oae:tenant']));

                    allowedActorProperties = [
                      'oae:id',
                      'oae:visibility',
                      'displayName',
                      'objectType',
                      'id',
                      'oae:tenant'
                    ];
                    _.each(activity.actor, (value, key) => {
                      assert.ok(
                        _.contains(allowedActorProperties, key),
                        key +
                          ' is not allowed on an ActivityStrea.ms compliant formatted activity entity'
                      );
                    });

                    // Assert that the object entity is in the proper activitystreams format
                    assert.ok(activity.object);
                    assert.strictEqual(activity.object['oae:id'], discussion.id);
                    assert.strictEqual(activity.object['oae:visibility'], discussion.visibility);
                    assert.strictEqual(activity.object['oae:profilePath'], discussion.profilePath);
                    assert.strictEqual(
                      activity.object['oae:resourceSubType'],
                      discussion.resourceSubType
                    );
                    assert.strictEqual(activity.object.displayName, discussion.displayName);
                    assert.strictEqual(
                      activity.object.url,
                      'http://' +
                        global.oaeTests.tenants.cam.host +
                        '/discussion/camtest/' +
                        discussion.id.split(':')[2]
                    );
                    assert.strictEqual(activity.object.objectType, 'discussion');
                    assert.strictEqual(
                      activity.object.id,
                      'http://' +
                        global.oaeTests.tenants.cam.host +
                        '/api/discussion/' +
                        discussion.id
                    );
                    assert.ok(_.isObject(activity.object['oae:tenant']));

                    allowedObjectProperties = [
                      'oae:id',
                      'oae:visibility',
                      'oae:profilePath',
                      'displayName',
                      'url',
                      'objectType',
                      'id',
                      'oae:tenant'
                    ];
                    _.each(activity.object, (value, key) => {
                      assert.ok(
                        _.contains(allowedObjectProperties, key),
                        key +
                          ' is not allowed on an ActivityStrea.ms compliant formatted activity entity'
                      );
                    });
                  }

                  if (activitiesReceived === 2) {
                    return callback();
                  }
                });
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies a socket can subscribe for the same activity stream twice but with a different format
     */
    it('verify a subscription can be made to the same activity stream with a different format', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, mrvisser, simong) => {
        RestAPI.User.getMe(mrvisser.restContext, (err, mrvisserMeData) => {
          assert.ok(!err);

          /*
                     * Register a push client for mrvisser who is subscribed to:
                     *  * `activity`-stream with the `activitystream` format
                     *  * `activity`-stream with the `internal` format
                     *  * `notification`-stream with the `internal` format
                     */
          const data = {
            authentication: {
              userId: mrvisserMeData.id,
              tenantAlias: mrvisserMeData.tenant.alias,
              signature: mrvisserMeData.signature
            },
            streams: [
              {
                resourceId: mrvisserMeData.id,
                streamType: 'activity',
                token: mrvisserMeData.signature,
                format: 'activitystreams'
              },
              {
                resourceId: mrvisserMeData.id,
                streamType: 'activity',
                token: mrvisserMeData.signature,
                format: 'internal'
              },
              {
                resourceId: mrvisserMeData.id,
                streamType: 'notification',
                token: mrvisserMeData.signature,
                format: 'internal'
              }
            ]
          };

          // Setup the client
          ActivityTestUtil.getFullySetupPushClient(data, client => {
            // Create/share a discussion with mrvisser
            RestAPI.Discussions.createDiscussion(
              simong.restContext,
              'Test discussion',
              'Test discussion description',
              'public',
              [],
              [mrvisser.user.id],
              (err, discussion) => {
                assert.ok(!err);

                // Force a collection cycle as notifications are sent out on aggregation
                ActivityTestUtil.collectAndGetNotificationStream(
                  mrvisser.restContext,
                  null,
                  (err, activityStream) => {
                    assert.ok(!err);
                  }
                );

                let activitiesReceived = 0;
                const formatReceived = {
                  internal: 0,
                  activitystreams: 0
                };
                client.on('message', message => {
                  activitiesReceived++;
                  formatReceived[message.format]++;

                  if (activitiesReceived === 3) {
                    assert.strictEqual(formatReceived.internal, 2);
                    assert.strictEqual(formatReceived.activitystreams, 1);

                    return callback();
                  }
                });
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies that messages sent after the aggregation phase indicate whether they aggregated with an older activity
     */
    it('verify aggregation phase messages indicate whether the activity agregated with an older activity', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, mrvisser, simong) => {
        RestAPI.User.getMe(mrvisser.restContext, (err, mrvisserMeData) => {
          assert.ok(!err);

          /*
                     * Register a push client for mrvisser who is subscribed to:
                     *  * `activity`-stream with the `activitystream` format
                     *  * `activity`-stream with the `internal` format
                     *  * `notification`-stream with the `internal` format
                     */
          const data = {
            authentication: {
              userId: mrvisserMeData.id,
              tenantAlias: mrvisserMeData.tenant.alias,
              signature: mrvisserMeData.signature
            },
            streams: [
              {
                resourceId: mrvisserMeData.id,
                streamType: 'notification',
                token: mrvisserMeData.signature,
                format: 'internal'
              }
            ]
          };

          // Setup the client
          ActivityTestUtil.getFullySetupPushClient(data, client => {
            // Create/share a discussion with mrvisser
            RestAPI.Discussions.createDiscussion(
              simong.restContext,
              'Test discussion',
              'Test discussion description',
              'public',
              [],
              [mrvisser.user.id],
              (err, discussion) => {
                assert.ok(!err);
                // We need to force a collection cycle as the notifiation stream gets pushed out after the aggregation phase
                ActivityTestUtil.collectAndGetNotificationStream(
                  mrvisser.restContext,
                  null,
                  (err, activityStream) => {
                    assert.ok(!err);
                  }
                );

                // As this is the first discussion_created activity in mrvisser's notification stream it
                // can't aggregate with any other activities. That should be indicated on the push message
                client.once('message', message => {
                  assert.ok(message);
                  assert.strictEqual(message.numNewActivities, 1);

                  // When we generate another discussion_created activity it will aggregate with the previous
                  // activity. This should be reflected on the push message
                  RestAPI.Discussions.createDiscussion(
                    simong.restContext,
                    'Test discussion',
                    'Test discussion description',
                    'public',
                    [],
                    [mrvisser.user.id],
                    (err, discussion) => {
                      assert.ok(!err);
                      // We need to force a collection cycle as the notifiation
                      // stream gets pushed out after the aggregation phase
                      ActivityTestUtil.collectAndGetNotificationStream(
                        mrvisser.restContext,
                        null,
                        (err, activityStream) => {
                          assert.ok(!err);
                        }
                      );
                      client.once('message', message => {
                        assert.ok(message);
                        assert.strictEqual(message.numNewActivities, 0);

                        // Mark the notifications as read. Because we marked the notifications as read,
                        // this will reset the aggregator for that stream. Any new discussion_created activities
                        // should result in a "new activity". However, if 2 activities aggregate in-memory in the
                        // aggregation phase, they should be counted as 1
                        RestAPI.Activity.markNotificationsRead(mrvisser.restContext, err => {
                          assert.ok(!err);
                          RestAPI.Discussions.createDiscussion(
                            simong.restContext,
                            'Test discussion',
                            'Test discussion description',
                            'public',
                            [],
                            [mrvisser.user.id],
                            (err, discussion) => {
                              assert.ok(!err);
                              RestAPI.Discussions.createDiscussion(
                                simong.restContext,
                                'Test discussion',
                                'Test discussion description',
                                'public',
                                [],
                                [mrvisser.user.id],
                                (err, discussion) => {
                                  assert.ok(!err);
                                  ActivityTestUtil.collectAndGetNotificationStream(
                                    mrvisser.restContext,
                                    null,
                                    (err, activityStream) => {
                                      assert.ok(!err);
                                    }
                                  );

                                  client.once('message', message => {
                                    assert.ok(message);
                                    assert.strictEqual(message.numNewActivities, 1);

                                    // If 2 disjoint activities get delivered to the notification stream, the
                                    // number of new activities should be 2
                                    RestAPI.Activity.markNotificationsRead(
                                      mrvisser.restContext,
                                      err => {
                                        assert.ok(!err);
                                        RestAPI.Discussions.createDiscussion(
                                          simong.restContext,
                                          'Test discussion',
                                          'Test discussion description',
                                          'public',
                                          [],
                                          [mrvisser.user.id],
                                          (err, discussion) => {
                                            assert.ok(!err);
                                            RestAPI.Content.createLink(
                                              simong.restContext,
                                              'Test link',
                                              'Test link',
                                              'public',
                                              'https://google.com',
                                              [],
                                              [mrvisser.user.id],
                                              [],
                                              (err, discussion) => {
                                                assert.ok(!err);
                                                ActivityTestUtil.collectAndGetNotificationStream(
                                                  mrvisser.restContext,
                                                  null,
                                                  (err, activityStream) => {
                                                    assert.ok(!err);
                                                  }
                                                );

                                                client.once('message', message => {
                                                  assert.ok(message);
                                                  assert.strictEqual(message.numNewActivities, 2);
                                                  assert.strictEqual(message.activities.length, 2);

                                                  return callback();
                                                });
                                              }
                                            );
                                          }
                                        );
                                      }
                                    );
                                  });
                                }
                              );
                            }
                          );
                        });
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
});
