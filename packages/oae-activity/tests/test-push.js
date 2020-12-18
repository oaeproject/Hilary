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

import { assert } from 'chai';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

import * as ActivityTestUtil from 'oae-activity/lib/test/util';

import { and, contains, forEachObjIndexed } from 'ramda';
import { EventEmitter } from 'oae-emitter';

const { getGroup, createGroup } = RestAPI.Group;
const { createLink } = RestAPI.Content;
const { getContent, updateContent } = RestAPI.Content;
const { createDiscussion } = RestAPI.Discussions;
const { markNotificationsRead } = RestAPI.Activity;

const {
  collectAndGetNotificationStream,
  collectAndGetActivityStream,
  getPushClient,
  getFullySetupPushClient
} = ActivityTestUtil;
const { getMe } = RestAPI.User;
const { createTenantAdminRestContext, generateTestUsers } = TestsUtil;

const NO_VIEWERS = [];
const NO_MANAGERS = [];
const NO_FOLDERS = [];
const PUBLIC = 'public';

describe('Activity push', () => {
  // Rest context that can be used every time we need to make a request as a tenant admin
  let asCambridgeTenantAdmin = null;

  /**
   * Function that will fill up the tenant admin and anymous rest context
   */
  before(callback => {
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    return callback();
  });

  describe('Protocol', () => {
    /**
     * Test that verifies that messages that are sent by a client need to have an ID
     */
    it('verify missing id results in an immediate disconnect', callback => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
        assert.notExists(err);

        const { 0: johnDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        getMe(asJohnDoe, (err, meData) => {
          assert.notExists(err);

          const data = {
            authentication: {
              userId: meData.id,
              tenantAlias: meData.tenant.alias,
              signature: meData.signature
            }
          };
          getFullySetupPushClient(data, client => {
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
            socket.send('{}');
          });
        });
      });
    });

    /**
     * Test that verifies that non JSON messages get rejected
     */
    it('verify a malformed message results in an immediate disconnect', callback => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
        assert.notExists(err);

        const { 0: johnDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        getMe(asJohnDoe, (err, meData) => {
          assert.notExists(err);

          const data = {
            authentication: {
              userId: meData.id,
              tenantAlias: meData.tenant.alias,
              signature: meData.signature
            }
          };
          getFullySetupPushClient(data, client => {
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
            socket.send('NO JSON');
          });
        });
      });
    });

    /**
     * Test that verifies the sockets gets closed when the client does not provide their authentication credentials within a reasonable timeframe
     */
    it('verify authentication timeout', callback => {
      getPushClient(client => {
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
      getPushClient(client => {
        client.sendMessage('foo', {}, (err /* , msg */) => {
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
      getPushClient(client => {
        let receivedResponse = false;

        // Sending an invalid authentication frame should fail
        client.sendMessage('authentication', { userId: 'not-a-user-id', signature: {} }, (
          err /* , data */
        ) => {
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
     * Test that verifies that an invalid signature results in an error
     */
    it('verify a missing signature results in a error', callback => {
      getPushClient(client => {
        let receivedResponse = false;

        // Sending an invalid authentication frame should fail
        client.sendMessage('authentication', { userId: 'u:camtest:foobar' }, (err /* , data */) => {
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
      generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
        assert.notExists(err);

        const { 0: johnDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        getMe(asJohnDoe, (err, meData) => {
          assert.notExists(err);

          getPushClient(client => {
            /**
             * The first message should always be the authentication message
             * If not, the backend should close the socket.
             */
            client.authenticate(meData.id, meData.tenant.alias, meData.signature, (
              err /* , data */
            ) => {
              assert.notExists(err);

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
      generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
        assert.notExists(err);

        const { 0: johnDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        getMe(asJohnDoe, (err, johnDoeData) => {
          assert.notExists(err);

          const data = {
            authentication: {
              userId: johnDoeData.id,
              tenantAlias: johnDoeData.tenant.alias,
              signature: johnDoeData.signature
            }
          };

          getFullySetupPushClient(data, client => {
            // Registering on an unknown feed should result in an error
            client.subscribe(johnDoe.user.id, 'unknown', { some: 'token' }, null, (
              err /* , msg */
            ) => {
              assert.strictEqual(err.code, 400);

              // Specifying an unknown format should result in a validation error
              client.subscribe(johnDoe.user.id, 'activity', { some: 'token' }, 'unknown format', (
                err /* , msg */
              ) => {
                assert.strictEqual(err.code, 400);

                client.close(callback);
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies subscribing and authorization on activity streams
     */
    it('verify subscribing and authorization on activity streams', callback => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);

        const { 0: johnDoe, 1: janeDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        getMe(asJohnDoe, (err, johnDoeData) => {
          assert.notExists(err);

          const data = {
            authentication: {
              userId: johnDoeData.id,
              tenantAlias: johnDoeData.tenant.alias,
              signature: johnDoeData.signature
            }
          };

          getFullySetupPushClient(data, client => {
            // johnDoe cannot subscribe on jane's feed
            client.subscribe(janeDoe.user.id, 'activity', johnDoeData.signature, null, (
              err /* , msg */
            ) => {
              assert.strictEqual(err.code, 401);

              // He can register for his own feed without a token since he's authenticated on the socket
              client.subscribe(johnDoe.user.id, 'activity', null, null, (err /* , msg */) => {
                assert.notExists(err);

                // He can register on a group feed
                createGroup(
                  asJohnDoe,
                  'Group title',
                  'Group description',
                  'public',
                  'yes',
                  [],
                  [],
                  (err, group) => {
                    assert.notExists(err);

                    getGroup(asJohnDoe, group.id, (err, group) => {
                      assert.notExists(err);

                      client.subscribe(group.id, 'activity', group.signature, null, (
                        err /* , msg */
                      ) => {
                        assert.notExists(err);

                        client.close(callback);
                      });
                    });
                  }
                );
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies subscribing and authorization on notification streams
     */
    it('verify subscribing and authorization on notification streams', callback => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);

        const { 0: johnDoe, 1: janeDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        getMe(asJohnDoe, (err, johnDoeData) => {
          assert.notExists(err);

          const data = {
            authentication: {
              userId: johnDoeData.id,
              tenantAlias: johnDoeData.tenant.alias,
              signature: johnDoeData.signature
            }
          };

          getFullySetupPushClient(data, client => {
            // johnDoe cannot subscribe on Jane's feed
            client.subscribe(janeDoe.user.id, 'notification', johnDoeData.signature, null, (
              err /* , msg */
            ) => {
              assert.strictEqual(err.code, 401);

              // Groups don't have notification feeds
              createGroup(
                asJohnDoe,
                'Group title',
                'Group description',
                'public',
                'yes',
                [],
                [],
                (err, group) => {
                  assert.notExists(err);

                  getGroup(asJohnDoe, group.id, (err, group) => {
                    assert.notExists(err);

                    client.subscribe(group.id, 'notification', group.signature, null, (
                      err /* , msg */
                    ) => {
                      assert.strictEqual(err.code, 400);

                      // He can register for his own feed without a token since he's authenticated on the socket
                      client.subscribe(johnDoe.user.id, 'notification', null, null, (
                        err /* , msg */
                      ) => {
                        assert.notExists(err);

                        client.close(callback);
                      });
                    });
                  });
                }
              );
            });
          });
        });
      });
    });

    /**
     * Test that verifies that you only get activities that occur on the subscribed resources
     */
    it('verify segregation', callback => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
        assert.notExists(err);

        const { 0: johnDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        getMe(asJohnDoe, (err, johnDoeData) => {
          assert.notExists(err);

          createLink(
            asJohnDoe,
            {
              displayName: 'Yahoo',
              description: 'Yahoo',
              visibility: PUBLIC,
              link: 'http://www.yahoo.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (err, yahooLink) => {
              assert.notExists(err);

              getContent(asJohnDoe, yahooLink.id, (err, yahooLink) => {
                assert.notExists(err);

                createLink(
                  asJohnDoe,
                  {
                    displayName: 'Google',
                    description: 'Google',
                    visibility: PUBLIC,
                    link: 'http://www.google.ca',
                    managers: NO_MANAGERS,
                    viewers: NO_VIEWERS,
                    folders: NO_FOLDERS
                  },
                  (err, googleLink) => {
                    assert.notExists(err);

                    getContent(asJohnDoe, googleLink.id, (err, googleLink) => {
                      assert.notExists(err);

                      // Route and deliver activities
                      collectAndGetActivityStream(asJohnDoe, null, null, err => {
                        assert.notExists(err);

                        // Subscribe on the Yahoo link
                        const data = {
                          authentication: {
                            userId: johnDoeData.id,
                            tenantAlias: johnDoeData.tenant.alias,
                            signature: johnDoeData.signature
                          },
                          streams: [
                            {
                              resourceId: yahooLink.id,
                              streamType: 'activity',
                              token: yahooLink.signature
                            }
                          ]
                        };

                        getFullySetupPushClient(data, client => {
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
                            updateContent(
                              asJohnDoe,
                              googleLink.id,
                              { displayName: 'Google woo' },
                              err => {
                                assert.notExists(err);

                                // Route and deliver activities
                                collectAndGetActivityStream(asJohnDoe, null, null, err => {
                                  assert.notExists(err);

                                  client.close(callback);
                                });
                              }
                            );
                          }, 1000);
                        });
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

    /**
     * Test that verifies that multiple clients can listen on the same feed
     */
    it('verify multiple clients on same feed', callback => {
      generateTestUsers(asCambridgeTenantAdmin, 1, (err, users) => {
        assert.notExists(err);

        const { 0: johnDoe } = users;
        const asJohnDoe = johnDoe.restContext;

        getMe(asJohnDoe, (err, johnDoeData) => {
          assert.notExists(err);

          // Get 2 clients
          const data = {
            authentication: {
              userId: johnDoeData.id,
              tenantAlias: johnDoeData.tenant.alias,
              signature: johnDoeData.signature
            },
            streams: [
              {
                resourceId: johnDoeData.id,
                streamType: 'activity',
                token: johnDoeData.signature
              },
              {
                resourceId: johnDoeData.id,
                streamType: 'notification',
                token: johnDoeData.signature
              }
            ]
          };

          collectAndGetActivityStream(asJohnDoe, null, null, err => {
            assert.notExists(err);

            // Setup the clients
            getFullySetupPushClient(data, clientA => {
              getFullySetupPushClient(data, clientB => {
                // Do something that ends up in the `activity`  activitystream
                createLink(
                  asJohnDoe,
                  {
                    displayName: 'Yahoo',
                    description: 'Yahoo',
                    visibility: PUBLIC,
                    link: 'http://www.yahoo.ca',
                    managers: NO_MANAGERS,
                    viewers: NO_VIEWERS,
                    folders: NO_FOLDERS
                  },
                  (err /* , link */) => {
                    assert.notExists(err);
                  }
                );

                let clientAReceived = false;
                let clientBReceived = false;

                clientA.once('message', message => {
                  assert.notExists(message.error);
                  clientAReceived = true;
                  if (and(clientAReceived, clientBReceived)) {
                    bothReceived();
                  }
                });
                clientB.once('message', message => {
                  assert.notExists(message.error);
                  clientBReceived = true;
                  if (and(clientAReceived, clientBReceived)) {
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
                    createLink(
                      asJohnDoe,
                      {
                        displayName: 'Yahoo',
                        description: 'Yahoo',
                        visibility: PUBLIC,
                        link: 'http://www.yahoo.ca',
                        managers: NO_MANAGERS,
                        viewers: NO_VIEWERS,
                        folders: NO_FOLDERS
                      },
                      (err /* , link */) => {
                        assert.notExists(err);
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
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);

        const { 0: homer, 1: marge } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;

        RestAPI.User.getMe(asHomer, (err, homerInfo) => {
          assert.notExists(err);

          /**
           * Register a push client for homer who is subscribed to his activitystream
           * with the regular format and his notification stream with the internal format
           */
          const data = {
            authentication: {
              userId: homerInfo.id,
              tenantAlias: homerInfo.tenant.alias,
              signature: homerInfo.signature
            },
            streams: [
              {
                resourceId: homerInfo.id,
                streamType: 'activity',
                token: homerInfo.signature,
                format: 'activitystreams'
              },
              {
                resourceId: homerInfo.id,
                streamType: 'notification',
                token: homerInfo.signature,
                format: 'internal'
              }
            ]
          };

          const discussionEmitter = new EventEmitter();

          // Setup the client
          ActivityTestUtil.getFullySetupPushClient(data, client => {
            /**
             * marge will now create a discussion and share it with homer,
             * this will trigger an activity that gets delivered on both streams
             * To ensure proper scrubbing of data, simon will have a private profile
             */
            RestAPI.User.updateUser(
              asMarge,
              marge.user.id,
              { visibility: 'private' },
              (err, updatedUser) => {
                assert.notExists(err);
                marge.user = updatedUser;
                let discussion = null;

                client.on('setUpListener', () => {
                  let activitiesReceived = 0;
                  const dealWithMessage = message => {
                    activitiesReceived++;

                    assert.ok(message.activities);
                    assert.lengthOf(message.activities, 1);
                    const activity = message.activities[0];
                    assert.ok(activity);

                    let allowedActorProperties = null;
                    let allowedObjectProperties = null;

                    if (message.streamType === 'notification') {
                      // Assert that the activity entities are internally formatted
                      assert.strictEqual(message.format, 'internal');

                      // Assert that the actor entity is a user object augmented with an oae:id and objectType
                      assert.ok(activity.actor);
                      assert.strictEqual(activity.actor['oae:id'], marge.user.id);
                      assert.strictEqual(activity.actor.id, marge.user.id);
                      assert.strictEqual(activity.actor.displayName, marge.user.publicAlias);
                      assert.strictEqual(activity.actor.lastModified, marge.user.lastModified);
                      assert.strictEqual(activity.actor.visibility, 'private');
                      assert.isObject(activity.actor.picture);
                      assert.strictEqual(activity.actor.resourceType, 'user');
                      assert.strictEqual(activity.actor.objectType, 'user');
                      assert.isObject(activity.actor.tenant);

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
                      forEachObjIndexed((value, key) => {
                        assert.ok(
                          contains(key, allowedActorProperties),
                          key + ' is not allowed on an internally formatted activity entity'
                        );
                      }, activity.actor);

                      discussionEmitter.when('discussionReady', discussion => {
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
                        assert.isObject(activity.object.tenant);

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
                        forEachObjIndexed((value, key) => {
                          assert.ok(
                            contains(key, allowedObjectProperties),
                            key + ' is not allowed on an internally formatted activity entity'
                          );
                        }, activity.object);
                      });
                    } else {
                      // Assert that the activity entities are activitystrea.ms formatted
                      assert.strictEqual(message.format, 'activitystreams');

                      // Assert that the actor entity is in the proper activitystreams format
                      assert.ok(activity.actor);
                      assert.strictEqual(activity.actor['oae:id'], marge.user.id);
                      assert.strictEqual(activity.actor['oae:visibility'], marge.user.visibility);
                      assert.strictEqual(activity.actor.displayName, marge.user.publicAlias);
                      assert.strictEqual(activity.actor.objectType, 'user');
                      assert.strictEqual(
                        activity.actor.id,
                        'http://' + global.oaeTests.tenants.cam.host + '/api/user/' + marge.user.id
                      );
                      assert.isObject(activity.actor['oae:tenant']);

                      allowedActorProperties = [
                        'oae:id',
                        'oae:visibility',
                        'displayName',
                        'objectType',
                        'id',
                        'oae:tenant'
                      ];
                      forEachObjIndexed((value, key) => {
                        assert.ok(
                          contains(key, allowedActorProperties),
                          key +
                            ' is not allowed on an ActivityStrea.ms compliant formatted activity entity'
                        );
                      }, activity.actor);

                      discussionEmitter.when('discussionReady', discussion => {
                        // Assert that the object entity is in the proper activitystreams format
                        assert.ok(activity.object);
                        assert.strictEqual(activity.object['oae:id'], discussion.id);
                        assert.strictEqual(
                          activity.object['oae:visibility'],
                          discussion.visibility
                        );
                        assert.strictEqual(
                          activity.object['oae:profilePath'],
                          discussion.profilePath
                        );
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
                        assert.isObject(activity.object['oae:tenant']);

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
                        forEachObjIndexed((value, key) => {
                          assert.ok(
                            contains(key, allowedObjectProperties),
                            key +
                              ' is not allowed on an ActivityStrea.ms compliant formatted activity entity'
                          );
                        }, activity.object);
                      });
                    }

                    if (activitiesReceived === 2) {
                      return callback();
                    }
                  };

                  client.on('message', message => {
                    dealWithMessage(message);
                  });

                  discussionEmitter.emit('listenerSetUp');
                });
                discussionEmitter.emit('setUpListener');

                /**
                 * We need to signal that the variable now holds the discussion data
                 * but we wait a bit for the event listener to be ready
                 */
                discussionEmitter.when('listenerSetUp', () => {
                  RestAPI.Discussions.createDiscussion(
                    asMarge,
                    'Test discussion',
                    'Test discussion description',
                    'public',
                    [],
                    [homer.user.id],
                    (err, _discussion) => {
                      assert.notExists(err);

                      discussion = _discussion;

                      discussionEmitter.emit('discussionReady', discussion);

                      // Force a collection cycle as notifications only get delivered upon aggregation
                      ActivityTestUtil.collectAndGetActivityStream(asHomer, null, null, err => {
                        assert.notExists(err);
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
     * Test that verifies a socket can subscribe for the same activity stream twice but with a different format
     */
    it('verify a subscription can be made to the same activity stream with a different format', callback => {
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);

        const { 0: johnDoe, 1: janeDoe } = users;
        const asJohnDoe = johnDoe.restContext;
        const asJaneDoe = janeDoe.restContext;

        getMe(asJohnDoe, (err, johnDoeData) => {
          assert.notExists(err);

          /*
           * Register a push client for mrvisser who is subscribed to:
           *  * `activity`-stream with the `activitystream` format
           *  * `activity`-stream with the `internal` format
           *  * `notification`-stream with the `internal` format
           */
          const data = {
            authentication: {
              userId: johnDoeData.id,
              tenantAlias: johnDoeData.tenant.alias,
              signature: johnDoeData.signature
            },
            streams: [
              {
                resourceId: johnDoeData.id,
                streamType: 'activity',
                token: johnDoeData.signature,
                format: 'activitystreams'
              },
              {
                resourceId: johnDoeData.id,
                streamType: 'activity',
                token: johnDoeData.signature,
                format: 'internal'
              },
              {
                resourceId: johnDoeData.id,
                streamType: 'notification',
                token: johnDoeData.signature,
                format: 'internal'
              }
            ]
          };

          // Setup the client
          getFullySetupPushClient(data, client => {
            // Create/share a discussion with mrvisser
            createDiscussion(
              asJaneDoe,
              'Test discussion',
              'Test discussion description',
              'public',
              [],
              [johnDoe.user.id],
              (err /* , discussion */) => {
                assert.notExists(err);

                // Force a collection cycle as notifications are sent out on aggregation
                collectAndGetNotificationStream(asJohnDoe, null, (err /* , activityStream */) => {
                  assert.notExists(err);
                });

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
      generateTestUsers(asCambridgeTenantAdmin, 2, (err, users) => {
        assert.notExists(err);

        const { 0: johnDoe, 1: janeDoe } = users;
        const asJohnDoe = johnDoe.restContext;
        const asJaneDoe = janeDoe.restContext;

        getMe(asJohnDoe, (err, johnDoeData) => {
          assert.notExists(err);

          /*
           * Register a push client for mrvisser who is subscribed to:
           *  * `activity`-stream with the `activitystream` format
           *  * `activity`-stream with the `internal` format
           *  * `notification`-stream with the `internal` format
           */
          const data = {
            authentication: {
              userId: johnDoeData.id,
              tenantAlias: johnDoeData.tenant.alias,
              signature: johnDoeData.signature
            },
            streams: [
              {
                resourceId: johnDoeData.id,
                streamType: 'notification',
                token: johnDoeData.signature,
                format: 'internal'
              }
            ]
          };

          // Setup the client
          getFullySetupPushClient(data, client => {
            // Create/share a discussion with mrvisser
            createDiscussion(
              asJaneDoe,
              'Test discussion',
              'Test discussion description',
              'public',
              [],
              [johnDoe.user.id],
              (err /* , discussion */) => {
                assert.notExists(err);

                // We need to force a collection cycle as the notifiation stream gets pushed out after the aggregation phase
                collectAndGetNotificationStream(asJohnDoe, null, (err /* , activityStream */) => {
                  assert.notExists(err);
                });

                // As this is the first discussion_created activity in mrvisser's notification stream it
                // can't aggregate with any other activities. That should be indicated on the push message
                client.once('message', message => {
                  assert.ok(message);
                  assert.strictEqual(message.numNewActivities, 1);

                  // When we generate another discussion_created activity it will aggregate with the previous
                  // activity. This should be reflected on the push message
                  createDiscussion(
                    asJaneDoe,
                    'Test discussion',
                    'Test discussion description',
                    'public',
                    [],
                    [johnDoe.user.id],
                    (err /* , discussion */) => {
                      assert.notExists(err);
                      // We need to force a collection cycle as the notifiation
                      // stream gets pushed out after the aggregation phase
                      collectAndGetNotificationStream(asJohnDoe, null, (
                        err /* , activityStream */
                      ) => {
                        assert.notExists(err);
                      });
                      client.once('message', message => {
                        assert.ok(message);
                        assert.strictEqual(message.numNewActivities, 0);

                        // Mark the notifications as read. Because we marked the notifications as read,
                        // this will reset the aggregator for that stream. Any new discussion_created activities
                        // should result in a "new activity". However, if 2 activities aggregate in-memory in the
                        // aggregation phase, they should be counted as 1
                        RestAPI.Activity.markNotificationsRead(asJohnDoe, err => {
                          assert.notExists(err);
                          createDiscussion(
                            asJaneDoe,
                            'Test discussion',
                            'Test discussion description',
                            'public',
                            [],
                            [johnDoe.user.id],
                            (err /* , discussion */) => {
                              assert.notExists(err);
                              createDiscussion(
                                asJaneDoe,
                                'Test discussion',
                                'Test discussion description',
                                'public',
                                [],
                                [johnDoe.user.id],
                                (err /* , discussion */) => {
                                  assert.notExists(err);
                                  collectAndGetNotificationStream(asJohnDoe, null, (
                                    err /* , activityStream */
                                  ) => {
                                    assert.notExists(err);
                                  });

                                  client.once('message', message => {
                                    assert.ok(message);
                                    assert.strictEqual(message.numNewActivities, 1);

                                    // If 2 disjoint activities get delivered to the notification stream, the
                                    // number of new activities should be 2
                                    markNotificationsRead(asJohnDoe, err => {
                                      assert.notExists(err);
                                      createDiscussion(
                                        asJaneDoe,
                                        'Test discussion',
                                        'Test discussion description',
                                        'public',
                                        [],
                                        [johnDoe.user.id],
                                        (err /* , discussion */) => {
                                          assert.notExists(err);
                                          createLink(
                                            asJaneDoe,
                                            {
                                              displayName: 'Test link',
                                              description: 'Test link',
                                              visibility: PUBLIC,
                                              link: 'https://google.com',
                                              managers: [],
                                              viewers: [johnDoe.user.id],
                                              folders: []
                                            },
                                            (err /* , discussion */) => {
                                              assert.notExists(err);
                                              collectAndGetNotificationStream(asJohnDoe, null, (
                                                err /* , activityStream */
                                              ) => {
                                                assert.notExists(err);
                                              });

                                              client.once('message', message => {
                                                assert.ok(message);
                                                assert.strictEqual(message.numNewActivities, 2);
                                                assert.lengthOf(message.activities, 2);

                                                return callback();
                                              });
                                            }
                                          );
                                        }
                                      );
                                    });
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
