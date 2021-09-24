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

/* eslint-disable no-import-assign */
import { assert } from 'chai';
import { callbackify, format } from 'util';
import * as ConfigTestsUtil from 'oae-config/lib/test/util.js';
import { Context } from 'oae-context/lib/api.js';
import * as FollowingTestsUtil from 'oae-following/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as ActivityAggregator from 'oae-activity/lib/internal/aggregator.js';
import * as ActivityAPI from 'oae-activity/lib/api.js';
import * as ActivityDAO from 'oae-activity/lib/internal/dao.js';
import * as ActivityRegistry from 'oae-activity/lib/internal/registry.js';
import { ActivitySeed, ActivitySeedResource, AssociationsSession } from 'oae-activity/lib/model.js';

import * as ActivityTestUtil from 'oae-activity/lib/test/util.js';
import * as ActivityUtil from 'oae-activity/lib/util.js';
import {
  mergeRight,
  isEmpty,
  propEq,
  compose,
  intersection,
  flatten,
  keys,
  contains,
  pluck,
  sortBy,
  find,
  uniq,
  pipe,
  forEach,
  filter,
  equals,
  propSatisfies,
  forEachObjIndexed,
  indexOf
} from 'ramda';

const NO_MANAGERS = [];
const NO_VIEWERS = [];
const NO_FOLDERS = [];
const PUBLIC = 'public';

/**
 * Keep a safe reference to the get aggregate status function as we will
 * patch it in some of these tests
 */
const activityDaoGetAggregateStatusFn = ActivityDAO.getAggregateStatus;

describe('Activity', () => {
  // Rest context that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;

  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;

  // API context that can be used to execute anonymous API calls on the cambridge tenant
  let anonymousCamApiContext = null;

  /**
   * Function that will fill up the tenant admin and anonymous rest context
   */
  before((callback) => {
    ActivityTestUtil.refreshConfiguration({ processActivityJobs: true }, () => {
      camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
      globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
      anonymousCamApiContext = new Context(global.oaeTests.tenants.cam);

      return callback();
    });
  });

  after((callback) => {
    // Always restore the getAggregateStatus function
    process.env.TEST_ALTERNATE_AGGREGATION = 'false';

    // Ensure activities are set back to enabled in case of test failures
    ConfigTestsUtil.updateConfigAndWait(
      globalAdminRestContext,
      null,
      { 'oae-activity/activity/enabled': true },
      (error) => {
        assert.notExists(error);
        ActivityTestUtil.refreshConfiguration({ mail: { gracePeriod: 0 } }, (error) => {
          assert.notExists(error);
          return callback();
        });
      }
    );
  });

  /**
   * Create a public, loggedin and private discussion and share it with the `target` principal
   *
   * @param  {RestContext}        actorRestContext        The rest context that will create the discussions
   * @param  {String}             target                  The id of the principal with whom the discussions should be shared with
   * @param  {Function}           callback                Standard callback function
   */
  const _createDiscussion = function (actorRestContext, target, callback) {
    // Generate the discussions
    RestAPI.Discussions.createDiscussion(
      actorRestContext,
      'title',
      'description',
      'public',
      null,
      null,
      (error, publicDiscussion) => {
        assert.notExists(error);
        RestAPI.Discussions.createDiscussion(
          actorRestContext,
          'title',
          'description',
          'loggedin',
          null,
          null,
          (error, loggedinDiscussion) => {
            assert.notExists(error);
            RestAPI.Discussions.createDiscussion(
              actorRestContext,
              'title',
              'description',
              'private',
              null,
              null,
              (error, privateDiscussion) => {
                assert.notExists(error);

                // Generate a share activity (as that has three entities)
                RestAPI.Discussions.shareDiscussion(actorRestContext, publicDiscussion.id, [target], (error_) => {
                  assert.notExists(error_);
                  RestAPI.Discussions.shareDiscussion(actorRestContext, loggedinDiscussion.id, [target], (error_) => {
                    assert.notExists(error_);
                    RestAPI.Discussions.shareDiscussion(actorRestContext, privateDiscussion.id, [target], (error_) => {
                      assert.notExists(error_);
                      return callback(publicDiscussion, loggedinDiscussion, privateDiscussion);
                    });
                  });
                });
              }
            );
          }
        );
      }
    );
  };

  /**
   * Get the entities of an activity
   *
   * @param  {Activity}           activity    The activity from which to get the entities
   * @param  {String}             entity      One of `actor`, `object` or `target`
   * @return {ActivityEntity[]}               The entities of the activity. Is always an array
   */
  const _getEntities = function (activity, entity) {
    // No entity
    if (!activity[entity]) {
      return [];

      // A single entity
    }

    if (activity[entity]['oae:id']) {
      return [activity[entity]];

      // A collection of entities
    }

    return activity[entity]['oae:collection'];
  };

  /**
   * Assert that an activity stream contains the expected share activities
   *
   * @param  {RestContext}    restContext             The rest context of the user who should fetch the activity stream
   * @param  {String}         resourceId              The id of the resource for which to get the activity stream
   * @param  {Number}         nrOfShareActivities     The number of `discussion-share` activities that should be in the activity stream
   * @param  {String[]}       objectEntities          The discussion ids that should be used as an object in the `discussion-share` activities
   * @param  {String[]}       targetEntities          The principal ids that should be used as a target in the `discussion-share` activities
   * @param  {Function}       callback                Standard callback function
   * @throws {AssertionError}                         Thrown if the request did not succeed
   */
  const _assertStream = function (
    restContext,
    resourceId,
    nrOfShareActivities,
    objectEntities,
    targetEntities,
    callback
  ) {
    ActivityTestUtil.collectAndGetActivityStream(restContext, resourceId, null, (error, result) => {
      assert.notExists(error);

      const shareActivities = filter(propSatisfies(equals('discussion-share'), 'oae:activityType'), result.items);
      assert.strictEqual(shareActivities.length, nrOfShareActivities);

      // Get all the activity entities
      let retrievedObjectEntities = [];
      let retrievedTargetEntities = [];
      forEach((activity) => {
        retrievedObjectEntities = retrievedObjectEntities.concat(_getEntities(activity, 'object'));
        retrievedTargetEntities = retrievedTargetEntities.concat(_getEntities(activity, 'target'));
      }, shareActivities);

      // Only retain the unique entity ids and sort them for easier comparison
      retrievedObjectEntities = pipe(
        pluck('oae:id'),
        uniq,
        sortBy((x) => x)
      )(retrievedObjectEntities);

      retrievedTargetEntities = pipe(
        pluck('oae:id'),
        uniq,
        sortBy((x) => x)
      )(retrievedTargetEntities);

      // Sort the input entity ids for easier comparison
      objectEntities = objectEntities.sort();
      targetEntities = targetEntities.sort();

      // Ensure the retrieved entities are what we expected
      assert.deepStrictEqual(retrievedObjectEntities, objectEntities);
      assert.deepStrictEqual(retrievedTargetEntities, targetEntities);
      return callback();
    });
  };

  /**
   * Creates 2 tenants with a set of users, groups and discussions. The first
   * tenant will contain an extra public user that will be used to share discussions
   * with
   *
   * @param  {Function}       callback                    Standard callback function
   * @param  {Object}         callback.publicTenant0      The tenant containing the extra user and discussions
   * @param  {Object}         callback.publicTenant1      The other tenant
   */
  const _setupUsersAndDiscussions = function (callback) {
    TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1) => {
      /**
       * Generate an extra public user so the public user can interact with a user
       * that results in activies that can be routed to his public activity stream
       */
      TestsUtil.generateTestUsers(publicTenant0.adminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: extraPublicUser } = users;
        publicTenant0.extraPublicUser = extraPublicUser;

        // Ensure the user is public
        RestAPI.User.updateUser(
          publicTenant0.extraPublicUser.restContext,
          publicTenant0.extraPublicUser.user.id,
          { visibility: 'public' },
          (error_) => {
            assert.notExists(error_);

            publicTenant0.discussions = {};

            // Generate activities for all the possible object/target permutations
            // between the users from the publicTenant0 tenant
            _createDiscussion(
              publicTenant0.publicUser.restContext,
              publicTenant0.extraPublicUser.user.id,
              (publicDiscussion, loggedinDiscussion, privateDiscussion) => {
                publicTenant0.discussions.public2Extra = {
                  public: publicDiscussion,
                  loggedin: loggedinDiscussion,
                  private: privateDiscussion
                };
                _createDiscussion(
                  publicTenant0.publicUser.restContext,
                  publicTenant0.loggedinUser.user.id,
                  (publicDiscussion, loggedinDiscussion, privateDiscussion) => {
                    publicTenant0.discussions.public2Loggedin = {
                      public: publicDiscussion,
                      loggedin: loggedinDiscussion,
                      private: privateDiscussion
                    };
                    _createDiscussion(
                      publicTenant0.loggedinUser.restContext,
                      publicTenant0.publicUser.user.id,
                      (publicDiscussion, loggedinDiscussion, privateDiscussion) => {
                        publicTenant0.discussions.loggedin2Public = {
                          public: publicDiscussion,
                          loggedin: loggedinDiscussion,
                          private: privateDiscussion
                        };
                        _createDiscussion(
                          publicTenant0.loggedinUser.restContext,
                          publicTenant0.extraPublicUser.user.id,
                          (publicDiscussion, loggedinDiscussion, privateDiscussion) => {
                            publicTenant0.discussions.loggedin2Extra = {
                              public: publicDiscussion,
                              loggedin: loggedinDiscussion,
                              private: privateDiscussion
                            };
                            _createDiscussion(
                              publicTenant0.privateUser.restContext,
                              publicTenant0.publicUser.user.id,
                              (publicDiscussion, loggedinDiscussion, privateDiscussion) => {
                                publicTenant0.discussions.private2Public = {
                                  public: publicDiscussion,
                                  loggedin: loggedinDiscussion,
                                  private: privateDiscussion
                                };
                                _createDiscussion(
                                  publicTenant0.privateUser.restContext,
                                  publicTenant0.loggedinUser.user.id,
                                  (publicDiscussion, loggedinDiscussion, privateDiscussion) => {
                                    publicTenant0.discussions.private2Loggedin = {
                                      public: publicDiscussion,
                                      loggedin: loggedinDiscussion,
                                      private: privateDiscussion
                                    };
                                    _createDiscussion(
                                      publicTenant0.privateUser.restContext,
                                      publicTenant0.extraPublicUser.user.id,
                                      (publicDiscussion, loggedinDiscussion, privateDiscussion) => {
                                        publicTenant0.discussions.private2Extra = {
                                          public: publicDiscussion,
                                          loggedin: loggedinDiscussion,
                                          private: privateDiscussion
                                        };
                                        return callback(publicTenant0, publicTenant1);
                                      }
                                    );
                                  }
                                );
                              }
                            );
                          }
                        );
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
  };

  /**
   * Setup 2 tenants with some users, groups and discussions
   *
   * @param  {Function}       callback                    Standard callback function
   * @param  {Object}         callback.publicTenant0      The tenant containing the extra user and discussions
   * @param  {Object}         callback.publicTenant1      The other tenant
   */
  const _setupGroupsAndDiscussions = function (callback) {
    TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1) => {
      _createDiscussion(
        publicTenant0.adminRestContext,
        publicTenant0.publicGroup.id,
        (publicDiscussion, loggedinDiscussion, privateDiscussion) => {
          publicTenant0.publicGroup.discussions = {
            public: publicDiscussion,
            loggedin: loggedinDiscussion,
            private: privateDiscussion
          };
          _createDiscussion(
            publicTenant0.adminRestContext,
            publicTenant0.loggedinNotJoinableGroup.id,
            (publicDiscussion, loggedinDiscussion, privateDiscussion) => {
              publicTenant0.loggedinNotJoinableGroup.discussions = {
                public: publicDiscussion,
                loggedin: loggedinDiscussion,
                private: privateDiscussion
              };
              _createDiscussion(
                publicTenant0.adminRestContext,
                publicTenant0.loggedinJoinableGroup.id,
                (publicDiscussion, loggedinDiscussion, privateDiscussion) => {
                  publicTenant0.loggedinJoinableGroup.discussions = {
                    public: publicDiscussion,
                    loggedin: loggedinDiscussion,
                    private: privateDiscussion
                  };
                  _createDiscussion(
                    publicTenant0.adminRestContext,
                    publicTenant0.privateNotJoinableGroup.id,
                    (publicDiscussion, loggedinDiscussion, privateDiscussion) => {
                      publicTenant0.privateNotJoinableGroup.discussions = {
                        public: publicDiscussion,
                        loggedin: loggedinDiscussion,
                        private: privateDiscussion
                      };
                      _createDiscussion(
                        publicTenant0.adminRestContext,
                        publicTenant0.privateJoinableGroup.id,
                        (publicDiscussion, loggedinDiscussion, privateDiscussion) => {
                          publicTenant0.privateJoinableGroup.discussions = {
                            public: publicDiscussion,
                            loggedin: loggedinDiscussion,
                            private: privateDiscussion
                          };
                          return callback(publicTenant0, publicTenant1);
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  };

  describe('Activity API', () => {
    describe('#refreshConfiguration()', () => {
      /**
       * Test that verifies that refreshing configuration to disable activities works properly. This test assumes that an activity is
       * generated when a content item is created.
       */
      it('verify disabling and enabling activity worker', (callback) => {
        // First disable the activity worker and ensure no activities are processed
        ActivityTestUtil.refreshConfiguration({ processActivityJobs: false }, (error) => {
          assert.notExists(error);

          // Create the user we will use as the activity stream
          TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
            assert.notExists(error);

            const { 0: jack } = users;

            // Try to generate an activity for Jack's feed
            RestAPI.Content.createLink(
              jack.restContext,
              {
                displayName: 'Google',
                description: 'Google',
                visibility: PUBLIC,
                link: 'http://www.google.ca',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error_) => {
                assert.notExists(error_);

                // Verify no activity is generated, because we don't have any bound workers
                ActivityTestUtil.collectAndGetActivityStream(jack.restContext, null, null, (error, activityStream) => {
                  assert.notExists(error);
                  assert.ok(activityStream);
                  assert.ok(activityStream.items);
                  assert.strictEqual(activityStream.items.length, 0);

                  // Re-enable the worker
                  ActivityTestUtil.refreshConfiguration(null, (error_) => {
                    assert.notExists(error_);

                    // Generate a 2nd activity for Jack's feed
                    RestAPI.Content.createLink(
                      jack.restContext,
                      {
                        displayName: 'Google',
                        description: 'Google',
                        visibility: PUBLIC,
                        link: 'http://www.google.ca',
                        managers: NO_MANAGERS,
                        viewers: NO_VIEWERS,
                        folders: NO_FOLDERS
                      },
                      (error_) => {
                        assert.notExists(error_);

                        // Verify that only the 2nd is collected into the stream, as the first just wasn't queued because the worker was disabled. And this is much simpler this way. The worker is supposed to be enabled all the time anyway.
                        ActivityTestUtil.collectAndGetActivityStream(
                          jack.restContext,
                          null,
                          null,
                          (error, activityStream) => {
                            assert.notExists(error);
                            assert.ok(activityStream);
                            assert.ok(activityStream.items);
                            assert.strictEqual(activityStream.items.length, 1);

                            // Re-enable the worker (again) and verify activities are still being routed
                            ActivityTestUtil.refreshConfiguration(null, (error_) => {
                              assert.notExists(error_);

                              // Create a 3rd activity to verify routing
                              RestAPI.Content.createLink(
                                jack.restContext,
                                {
                                  displayName: 'Google',
                                  description: 'Google',
                                  visibility: PUBLIC,
                                  link: 'http://www.google.ca',
                                  managers: NO_MANAGERS,
                                  viewers: NO_VIEWERS,
                                  folders: NO_FOLDERS
                                },
                                (error_) => {
                                  assert.notExists(error_);

                                  // Verify it was routed: now we should have 2 activities aggregated
                                  ActivityTestUtil.collectAndGetActivityStream(
                                    jack.restContext,
                                    null,
                                    null,
                                    (error, activityStream) => {
                                      assert.notExists(error);
                                      assert.ok(activityStream);
                                      assert.ok(activityStream.items);
                                      assert.strictEqual(activityStream.items.length, 1);
                                      assert.strictEqual(activityStream.items[0].object['oae:collection'].length, 2);
                                      callback();
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
        });
      });

      /**
       * Test that verifies that activities delivered to activity feeds disappear after the configured `activityTtl` time has
       * expired.
       */
      it('verify activity ttl deletes an activity after the expiry time', (callback) => {
        // Set expiry to the smallest possible, 1 second
        ActivityTestUtil.refreshConfiguration({ activityTtl: 2 }, (error) => {
          assert.notExists(error);

          TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
            assert.notExists(error);

            const { 0: jack } = users;

            // Try to generate an activity for Jack's feed
            RestAPI.Content.createLink(
              jack.restContext,
              {
                displayName: 'Google',
                description: 'Google',
                visibility: PUBLIC,
                link: 'http://www.google.ca',
                managers: NO_MANAGERS,
                viewers: NO_VIEWERS,
                folders: NO_FOLDERS
              },
              (error_) => {
                assert.notExists(error_);

                // Verify the activity is generated immediately
                ActivityTestUtil.collectAndGetActivityStream(jack.restContext, null, null, (error, activityStream) => {
                  assert.notExists(error);
                  assert.ok(activityStream);
                  assert.ok(activityStream.items);
                  assert.strictEqual(activityStream.items.length, 1);

                  // Now wait for the expiry and verify it has disappeared
                  setTimeout(
                    ActivityTestUtil.collectAndGetActivityStream,
                    2100,
                    jack.restContext,
                    null,
                    null,
                    (error, activityStream) => {
                      assert.notExists(error);
                      assert.ok(activityStream);
                      assert.ok(activityStream.items);
                      assert.strictEqual(activityStream.items.length, 0);
                      return callback();
                    }
                  );
                });
              }
            );
          });
        });
      });
    });

    describe('#registerActivityEntityType()', () => {
      /**
       * Test that verifies you cannot register duplicate activity object producers
       */
      it('verify registering duplicate activity entity types results in an error', (callback) => {
        const testId = TestsUtil.generateTestUserId();
        ActivityAPI.registerActivityEntityType(testId, {});
        assert.throws(() => {
          ActivityAPI.registerActivityEntityType(testId, {});
        });
        return callback();
      });

      /**
       * Test that verifies that when an seed resource with no associated producer is posted, the resourceData is used as the
       * persistent entity.
       */
      it('verify default producer persists just the activity seed resource data', (callback) => {
        const testActivityType = TestsUtil.generateTestUserId();
        const testResourceType = TestsUtil.generateTestUserId();
        const testResourceId = TestsUtil.generateTestUserId();
        const testResourceId2 = TestsUtil.generateTestUserId();
        const testResourceId3 = TestsUtil.generateTestUserId();

        let hadActor = false;
        let hadObject = false;
        let hadTarget = false;

        // Actor and target resource should not have any data. Will verify that no resourceData does not through a wrench into routing
        const actorResource = new ActivitySeedResource(testResourceType, testResourceId);
        const objectResource = new ActivitySeedResource(testResourceType, testResourceId2, {
          testData: 'Testing'
        });
        const targetResource = new ActivitySeedResource(testResourceType, testResourceId3);
        const seed = new ActivitySeed(
          testActivityType,
          Date.now(),
          'whistle',
          actorResource,
          objectResource,
          targetResource
        );

        let continued = false;

        // We need to register a stream that will result in routes for this activity type
        // as the router would otherwise short-circuit the routing and the propagation logic
        // would not be executed
        ActivityAPI.registerActivityType(testActivityType, {
          streams: {
            activity: {
              router: {
                actor: ['self'],
                object: ['self'],
                target: ['self']
              }
            }
          }
        });

        // Register a propagation for our unknown type. The persistent entity is given to the propagator, so we can verify it there
        ActivityAPI.registerActivityEntityType(testResourceType, {
          propagation(associationsCtx, persistentEntity, propagationCallback) {
            assert.ok(persistentEntity);

            // Verify the resourceId and resourceType have been stripped away as they are specific to the seed
            assert.ok(!persistentEntity.resourceId);
            assert.ok(!persistentEntity.resourceType);

            // Verify the oae:id and objectType have been added in their place
            const persistentEntityId = persistentEntity['oae:id'];
            assert.strictEqual(persistentEntity.objectType, testResourceType);

            if (persistentEntityId === testResourceId) {
              hadActor = true;
              assert.strictEqual(persistentEntity['oae:id'], testResourceId);
              assert.lengthOf(keys(persistentEntity), 2);
            } else if (persistentEntityId === testResourceId2) {
              hadObject = true;
              assert.strictEqual(persistentEntity['oae:id'], testResourceId2);
              assert.lengthOf(keys(persistentEntity), 3);
              assert.strictEqual(persistentEntity.testData, 'Testing');
            } else if (persistentEntityId === testResourceId3) {
              hadTarget = true;
              assert.strictEqual(persistentEntity['oae:id'], testResourceId3);
              assert.lengthOf(keys(persistentEntity), 2);
            }

            propagationCallback(null, [{ type: 'all' }]);

            if (!continued && hadActor && hadObject && hadTarget) {
              continued = true;
              return callback();
            }
          }
        });

        // Simply trigger the activity
        ActivityAPI.postActivity(anonymousCamApiContext, seed);
      });

      /**
       * Test that verifies that the default activity transformer will return just the oae:id, oae:tenant and objectType of an entity
       */
      it('verify default activity transformer returns objectType, oae:tenant and oae:id', (callback) => {
        const testActivityType = TestsUtil.generateTestUserId();
        const testResourceType = TestsUtil.generateTestUserId();
        const testResourceId = 'foo:camtest:' + TestsUtil.generateTestUserId();

        TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
          assert.notExists(error);

          const { 0: jack } = users;

          const actorResource = new ActivitySeedResource('user', jack.user.id);
          const objectResource = new ActivitySeedResource(testResourceType, testResourceId, {
            secret: 'My secret data!'
          });
          const seed = new ActivitySeed(testActivityType, Date.now(), 'whistle', actorResource, objectResource);

          // Register the activity such that the actor will receive it in their feed
          ActivityAPI.registerActivityType(testActivityType, {
            streams: {
              activity: {
                router: {
                  actor: ['self']
                }
              }
            }
          });

          // Post the activity and handle the result through the router.
          ActivityAPI.postActivity(anonymousCamApiContext, seed);

          ActivityAPI.registerActivityEntityType(testResourceType, {
            propagation(associationsCtx, persistentEntity, propagationCallback) {
              // Sanity check the post to ensure that we received the secret parameter to be persisted
              assert.ok(persistentEntity);
              assert.strictEqual(persistentEntity['oae:id'], testResourceId);
              assert.strictEqual(persistentEntity.secret, 'My secret data!');

              // Continue the activity posting process now. We ensure we can route to jack by specifying propagation of 'all'
              propagationCallback(null, [{ type: 'all' }]);

              // Collect the persisted activity, and make sure its transformation contains the id and type, but not the secret
              ActivityTestUtil.collectAndGetActivityStream(
                jack.restContext,
                jack.user.id,
                null,
                (error, activityStream) => {
                  assert.notExists(error);
                  assert.strictEqual(activityStream.items.length, 1);
                  assert.ok(activityStream.items[0].object);
                  assert.strictEqual(activityStream.items[0].object.objectType, testResourceType);
                  assert.strictEqual(activityStream.items[0].object['oae:id'], testResourceId);
                  assert.ok(activityStream.items[0].object['oae:tenant']);
                  assert.strictEqual(
                    activityStream.items[0].object['oae:tenant'].alias,
                    global.oaeTests.tenants.cam.alias
                  );
                  assert.strictEqual(
                    activityStream.items[0].object['oae:tenant'].displayName,
                    global.oaeTests.tenants.cam.displayName
                  );

                  return callback();
                }
              );
            }
          });
        });
      });
    });

    describe('#registerActivityStreamType()', () => {
      /**
       * Test that verifies you cannot register duplicate activity stream types
       */
      it('verify registering duplicate activity types results in an error', (callback) => {
        const streamType = TestsUtil.generateTestUserId();
        ActivityAPI.registerActivityStreamType(streamType, {
          transient: false,
          authorizationHandler(ctx, resourceId, token, callback) {
            return callback();
          }
        });
        assert.throws(() => {
          ActivityAPI.registerActivityStreamType(streamType, {
            transient: false,
            authorizationHandler(ctx, resourceId, token, callback) {
              return callback();
            }
          });
        });

        return callback();
      });
    });

    describe('#registerActivityType()', () => {
      /**
       * Test that verifies you cannot register duplicate activity types
       */
      it('verify registering duplicate activity types results in an error', (callback) => {
        const testId = TestsUtil.generateTestUserId();
        ActivityAPI.registerActivityType(testId, {
          streams: { activity: { router: { actor: ['self'] } } }
        });
        assert.throws(() => {
          ActivityAPI.registerActivityType(testId, {
            streams: { activity: { router: { actor: ['self'] } } }
          });
        });

        return callback();
      });

      /**
       * Test that verifies you cannot register an activity type without specifying at least 1 stream
       */
      it('verify registering activity types without specifying a stream results in an error', (callback) => {
        const testId = TestsUtil.generateTestUserId();
        assert.throws(() => {
          ActivityAPI.registerActivityType(testId, {});
        });

        assert.throws(() => {
          ActivityAPI.registerActivityType(testId, {
            streams: undefined
          });
        });

        assert.throws(() => {
          ActivityAPI.registerActivityType(testId, {
            streams: {}
          });
        });

        assert.throws(() => {
          ActivityAPI.registerActivityType(testId, {
            streams: []
          });
        });

        return callback();
      });

      /**
       * Test that verifies you cannot register an activity type without specifying at least 1 proper router per straem
       */
      it('verify registering activity types without specifying routers for a stream results in an error', (callback) => {
        const testId = TestsUtil.generateTestUserId();
        assert.throws(() => {
          ActivityAPI.registerActivityType(testId, {
            streams: {
              activity: {}
            }
          });
        });
        assert.throws(() => {
          ActivityAPI.registerActivityType(testId, {
            streams: {
              activity: {
                router: undefined
              }
            }
          });
        });
        assert.throws(() => {
          ActivityAPI.registerActivityType(testId, {
            streams: {
              activity: {
                router: {}
              }
            }
          });
        });
        assert.throws(() => {
          ActivityAPI.registerActivityType(testId, {
            streams: {
              activity: {
                router: {
                  actor: undefined
                }
              }
            }
          });
        });
        assert.throws(() => {
          ActivityAPI.registerActivityType(testId, {
            streams: {
              activity: {
                router: {
                  actor: []
                }
              }
            }
          });
        });
        assert.throws(() => {
          ActivityAPI.registerActivityType(testId, {
            streams: {
              activity: {
                router: {
                  actor: ['self']
                }
              },
              notification: {
                router: {
                  actor: []
                }
              }
            }
          });
        });

        return callback();
      });
    });

    describe('#registerActivityEntityAssociation()', () => {
      /**
       * Test that verifies you cannot register duplicate activity entity associations
       */
      it('verify registering duplicate activity entity association results in an error', (callback) => {
        const testId = TestsUtil.generateTestUserId();
        ActivityAPI.registerActivityEntityAssociation(testId, testId, () => {});
        assert.throws(() => {
          ActivityAPI.registerActivityEntityAssociation(testId, testId, () => {});
        });

        return callback();
      });
    });

    describe('#postActivity()', () => {
      /**
       * Test that postActivity validates input properly
       */
      it('verify postActivity validation', (callback) => {
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
          assert.notExists(error);

          const { 0: jack } = users;

          // Generate an activity for Jack's feed
          RestAPI.Content.createLink(
            jack.restContext,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              /*!
               * @return a valid activity seed that can be overlayed with invalid values for testing.
               */
              const _createActivitySeed = function (seedOverlay, actorOverlay, objectOverlay, targetOverlay) {
                if (!seedOverlay) {
                  return null;
                }

                let seed = {
                  activityType: 'content-share',
                  verb: 'share',
                  published: Date.now()
                };
                const actor = { resourceType: 'user', resourceId: jack.user.id };
                const object = { resourceType: 'content', resourceId: link.id };
                const target = { resourceType: 'user', resourceId: jack.user.id };

                seed = mergeRight(seed, seedOverlay);

                if (actorOverlay) {
                  seed.actorResource = mergeRight(actor, actorOverlay);
                }

                if (objectOverlay) {
                  seed.objectResource = mergeRight(object, objectOverlay);
                }

                if (targetOverlay) {
                  seed.targetResource = mergeRight(target, targetOverlay);
                }

                return seed;
              };

              // Verify no seed
              ActivityAPI.postActivity(anonymousCamApiContext, _createActivitySeed(), (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 400);

                // Verify no activity type
                ActivityAPI.postActivity(
                  anonymousCamApiContext,
                  _createActivitySeed({ activityType: '' }),
                  (error_) => {
                    assert.ok(error_);
                    assert.strictEqual(error_.code, 400);

                    // Verify no verb
                    ActivityAPI.postActivity(anonymousCamApiContext, _createActivitySeed({ verb: '' }), (error_) => {
                      assert.ok(error_);
                      assert.strictEqual(error_.code, 400);

                      // Verify no publish date
                      ActivityAPI.postActivity(
                        anonymousCamApiContext,
                        _createActivitySeed({ published: '' }),
                        (error_) => {
                          assert.ok(error_);
                          assert.strictEqual(error_.code, 400);

                          // Verify no actor
                          ActivityAPI.postActivity(anonymousCamApiContext, _createActivitySeed({}), (error_) => {
                            assert.ok(error_);
                            assert.strictEqual(error_.code, 400);

                            // Verify no actor resource type
                            ActivityAPI.postActivity(
                              anonymousCamApiContext,
                              _createActivitySeed({}, { resourceType: '' }),
                              (error_) => {
                                assert.ok(error_);
                                assert.strictEqual(error_.code, 400);

                                // Verify no actor resource id
                                ActivityAPI.postActivity(
                                  anonymousCamApiContext,
                                  _createActivitySeed({}, { resourceId: '' }),
                                  (error_) => {
                                    assert.ok(error_);
                                    assert.strictEqual(error_.code, 400);

                                    // Verify object with no resource type
                                    ActivityAPI.postActivity(
                                      anonymousCamApiContext,
                                      _createActivitySeed({}, {}, { resourceType: '' }),
                                      (error_) => {
                                        assert.ok(error_);
                                        assert.strictEqual(error_.code, 400);

                                        // Verify object with no resource id
                                        ActivityAPI.postActivity(
                                          anonymousCamApiContext,
                                          _createActivitySeed({}, {}, { resourceId: '' }),
                                          (error_) => {
                                            assert.ok(error_);
                                            assert.strictEqual(error_.code, 400);

                                            // Verify target with no resource type
                                            ActivityAPI.postActivity(
                                              anonymousCamApiContext,
                                              _createActivitySeed({}, {}, {}, { resourceType: '' }),
                                              (error_) => {
                                                assert.ok(error_);
                                                assert.strictEqual(error_.code, 400);

                                                // Verify target with no resource id
                                                ActivityAPI.postActivity(
                                                  anonymousCamApiContext,
                                                  _createActivitySeed({}, {}, {}, { resourceId: '' }),
                                                  (error_) => {
                                                    assert.ok(error_);
                                                    assert.strictEqual(error_.code, 400);

                                                    // Sanity check successfull post
                                                    ActivityAPI.postActivity(
                                                      anonymousCamApiContext,
                                                      _createActivitySeed({}, {}, {}, {}),
                                                      (error_) => {
                                                        assert.notExists(error_);
                                                        return callback();
                                                      }
                                                    );
                                                  }
                                                );
                                              }
                                            );
                                          }
                                        );
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
                  }
                );
              });
            }
          );
        });
      });

      /**
       * Test that verifies activities stop being posted when it is disabled in the admin console.
       */
      it('verify disabling activity posting', (callback) => {
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
          assert.notExists(error);

          const { 0: jack } = users;

          // Generate an activity for Jack's feed
          RestAPI.Content.createLink(
            jack.restContext,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              // Disable activity posting
              ConfigTestsUtil.updateConfigAndWait(
                globalAdminRestContext,
                null,
                { 'oae-activity/activity/enabled': false },
                (error_) => {
                  assert.notExists(error_);

                  // Try and generate an activity, but this should actually not be posted
                  RestAPI.Content.createLink(
                    jack.restContext,
                    {
                      displayName: 'Yahoo',
                      description: 'Yahoo',
                      visibility: PUBLIC,
                      link: 'http://www.yahoo.ca',
                      managers: NO_MANAGERS,
                      viewers: NO_VIEWERS,
                      folders: NO_FOLDERS
                    },
                    (error_) => {
                      assert.notExists(error_);

                      ConfigTestsUtil.updateConfigAndWait(
                        globalAdminRestContext,
                        null,
                        { 'oae-activity/activity/enabled': true },
                        (error_) => {
                          assert.notExists(error_);

                          ActivityTestUtil.collectAndGetActivityStream(
                            jack.restContext,
                            null,
                            null,
                            (error, activityStream) => {
                              assert.notExists(error);

                              // Verify only one activity and it is not an aggregation
                              assert.strictEqual(activityStream.items.length, 1);
                              assert.strictEqual(activityStream.items[0].object.objectType, 'content');
                              assert.strictEqual(activityStream.items[0].object['oae:id'], link.id);
                              callback();
                            }
                          );
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

  describe('Activity Routing', () => {
    /**
     * Test that verifies activity associations are cached
     */
    it('verify activity association caching', (callback) => {
      // Create a content item whose associations we can test for caching
      RestAPI.Content.createLink(
        camAdminRestContext,
        {
          displayName: 'Google',
          description: 'Google',
          visibility: PUBLIC,
          link: 'http://www.google.ca',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, link) => {
          assert.notExists(error);

          const activityResource = { content: link };
          activityResource.objectType = 'content';
          activityResource['oae:id'] = link.id;

          const associationsSession = new AssociationsSession(
            ActivityRegistry.getRegisteredActivityEntityAssociations(),
            activityResource
          );
          const associationsCtx = associationsSession.createAssociationsContext('content', link.id);

          // Get the associations while determining if it happened in the same process tick. If it happens in the same process tick, it is
          // fetched directly from cache without IO, in which case it is synchronous. To determine asynchrony, we have the statement
          // `firstWasAsynchronous = true;` after the get method. If `firstWasAsynchronous = true` is invoked first, then the method was
          // in a new process tick. If it is still false, then we fetched directly from a cache.
          let firstWasAsynchronous = false;
          associationsCtx.get('members', (error, members) => {
            assert.notExists(error);
            assert.ok(members);
            assert.strictEqual(members.length, 1);
            assert.ok(firstWasAsynchronous);

            const { 0: firstUserId } = members;

            // Now the next access should be synchronous
            let secondWasAsynchronous = false;
            associationsCtx.get('members', (error, members) => {
              assert.notExists(error);
              assert.ok(members);
              assert.strictEqual(members.length, 1);
              assert.ok(!secondWasAsynchronous);
              assert.strictEqual(firstUserId, members[0]);
              return callback();
            });
            secondWasAsynchronous = true;
          });
          firstWasAsynchronous = true;
        }
      );
    });

    /**
     * Test that verifies activity associations cache is cloned and cannot be modified in-memory
     */
    it('verify activity association cache entries cannot be updated in-memory', (callback) => {
      // Create a content item whose associations we can test for caching
      RestAPI.Content.createLink(
        camAdminRestContext,
        {
          displayName: 'Google',
          description: 'Google',
          visibility: PUBLIC,
          link: 'http://www.google.ca',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, link) => {
          assert.notExists(error);

          const activityResource = { content: link };
          activityResource.objectType = 'content';
          activityResource['oae:id'] = link.id;

          const associationsSession = new AssociationsSession(
            ActivityRegistry.getRegisteredActivityEntityAssociations(),
            activityResource
          );
          const associationsCtx = associationsSession.createAssociationsContext('content', link.id);

          associationsCtx.get('members', (error, members) => {
            assert.notExists(error);
            assert.ok(members);
            assert.strictEqual(members.length, 1);

            // Shift a user off the array
            members.shift();

            associationsCtx.get('members', (error, members) => {
              assert.notExists(error);
              assert.ok(members);

              // Ensure the user is still there in the next cached version
              assert.strictEqual(members.length, 1);

              // Shift once more to test that the cached version is cloned as well
              members.shift();

              associationsCtx.get('members', (error, members) => {
                assert.notExists(error);
                assert.ok(members);
                assert.strictEqual(members.length, 1);
                return callback();
              });
            });
          });
        }
      );
    });

    /**
     * Test that verifies the standard resource propagation when a joinable resource is passed in
     */
    it('verify standard resource propagation for joinable resources', (callback) => {
      // Mock a resource type that can be joinable to verify its routing behaviour
      const testEntityType = TestsUtil.generateTestUserId();
      ActivityAPI.registerActivityEntityType(testEntityType, {
        propagation(associationsCtx, persistentEntity, propagationCallback) {
          // Defer to the standard resource propagation. This is what we're testing
          ActivityUtil.getStandardResourcePropagation(
            persistentEntity.visibility,
            persistentEntity.joinable,
            propagationCallback
          );
        }
      });

      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
        // Make privateTenant1 public for now so we can get a follower going
        ConfigTestsUtil.updateConfigAndWait(
          TestsUtil.createGlobalAdminRestContext(),
          privateTenant1.tenant.alias,
          { 'oae-tenants/tenantprivacy/tenantprivate': false },
          () => {
            // Follow the publicTenant0.publicUser with the others
            const followers = [
              publicTenant0.loggedinUser,
              publicTenant0.privateUser,
              publicTenant1.publicUser,
              publicTenant1.loggedinUser,
              publicTenant1.privateUser,
              privateTenant1.publicUser
            ];

            // Follow the public tenant0 user with all the users
            FollowingTestsUtil.followByAll(publicTenant0.publicUser.user.id, followers, (error) => {
              assert.notExists(error);

              // Make privateTenant1 private now that the association has been made. This sets up a tenant that is non-interactable which will
              // let us verify the "interacting tenants" propagation later
              ConfigTestsUtil.updateConfigAndWait(
                TestsUtil.createGlobalAdminRestContext(),
                privateTenant1.tenant.alias,
                { 'oae-tenants/tenantprivacy/tenantprivate': true },
                (error) => {
                  assert.notExists(error);

                  // This is an id for the mocked resource type we created at the start of this test. We will simply give it a resource id prefix
                  // of "a", but it is really quite arbitrary
                  const testId = format('a:%s:%s', publicTenant0.tenant.alias, TestsUtil.generateTestUserId());

                  // Fabricate an activity with a resource that will invoke the "interacting_tenants" propagation. To do this, we will use a
                  // content create activity with our mocked resource that is "joinable". The propagation on the `testEntityType` resource
                  // will then indicate that only "interacting tenants" (and "member" association) can see it. Since we have setup the
                  // followers of `publicTenant0.publicUser` to be some that do not belong to interacting tenants, we can ensure VIA the
                  // followers routes that those users do not receive this activity
                  const actorResource = new ActivitySeedResource('user', publicTenant0.publicUser.user.id);
                  const objectResource = new ActivitySeedResource(testEntityType, testId, {
                    visibility: 'private',
                    joinable: 'yes'
                  });
                  const activitySeed = new ActivitySeed(
                    'content-create',
                    Date.now(),
                    'create',
                    actorResource,
                    objectResource
                  );
                  ActivityAPI.postActivity(new Context(publicTenant0.tenant), activitySeed);

                  // Ensure the user themself got it
                  ActivityTestUtil.collectAndGetActivityStream(
                    publicTenant0.publicUser.restContext,
                    null,
                    null,
                    (error, response) => {
                      assert.notExists(error);
                      ActivityTestUtil.assertActivity(
                        response.items[0],
                        'content-create',
                        'create',
                        publicTenant0.publicUser.user.id,
                        testId
                      );

                      // Ensure a user from the same tenant who isn't a member got it
                      ActivityTestUtil.collectAndGetActivityStream(
                        publicTenant0.privateUser.restContext,
                        null,
                        null,
                        (error, response) => {
                          assert.notExists(error);
                          ActivityTestUtil.assertActivity(
                            response.items[0],
                            'content-create',
                            'create',
                            publicTenant0.publicUser.user.id,
                            testId
                          );

                          // Ensure a user from another public tenant did not get it since they don't have access to the private object
                          ActivityTestUtil.collectAndGetActivityStream(
                            publicTenant1.privateUser.restContext,
                            null,
                            null,
                            (error, response) => {
                              assert.notExists(error);

                              // The last activity in their feed should be the follow activity from when they followed the publicTenant0 public user
                              ActivityTestUtil.assertActivity(
                                response.items[0],
                                'following-follow',
                                'follow',
                                publicTenant1.privateUser.user.id,
                                publicTenant0.publicUser.user.id
                              );

                              // Ensure the user from the private tenant did not get it either
                              ActivityTestUtil.collectAndGetActivityStream(
                                privateTenant1.publicUser.restContext,
                                null,
                                null,
                                (error, response) => {
                                  assert.notExists(error);

                                  // The last activity in their feed should be the follow activity from when they followed the publicTenant0 public user
                                  ActivityTestUtil.assertActivity(
                                    response.items[0],
                                    'following-follow',
                                    'follow',
                                    privateTenant1.publicUser.user.id,
                                    publicTenant0.publicUser.user.id
                                  );
                                  return callback();
                                }
                              );
                            }
                          );
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

    /**
     * Test that verifies the "routes" propagation, and that it is chosen by default if there is no entity registration
     */
    it('verify default resource propagation of "routes"', (callback) => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1) => {
        const testEntityType = TestsUtil.generateTestUserId();

        // Mock an association for this entity type that will provide "members", which can drive the routes for our fake content-create activity
        ActivityAPI.registerActivityEntityAssociation(
          testEntityType,
          'members',
          (associationsCtx, entity, associationsCallback) => {
            // Hardcode the public member as an association. This means that the default propagation will only recognize that member as a
            // recipient that has access, therefore the content-create activity invoked with an entity of this type should go to only them
            return associationsCallback(null, [publicTenant0.publicUser.user.id]);
          }
        );

        const followers = [publicTenant0.privateUser, publicTenant1.publicUser];

        // Follow the public tenant0 user with all the users
        FollowingTestsUtil.followByAll(publicTenant0.publicUser.user.id, followers, (error) => {
          assert.notExists(error);

          const testId = format('a:%s:%s', publicTenant0.tenant.alias, TestsUtil.generateTestUserId());

          // Fabricate an activity with a resource that will invoke the default "routes" propagation. To do this, we will use a content
          // create activity. The propagation on the `testEntityType` resource will indicate that only routes ('member' association) can
          // see it, whereas the routing for the actor will attempt to route to all followers
          const actorResource = new ActivitySeedResource('user', publicTenant0.publicUser.user.id);
          const objectResource = new ActivitySeedResource(testEntityType, testId);
          const activitySeed = new ActivitySeed('content-create', Date.now(), 'create', actorResource, objectResource);
          ActivityAPI.postActivity(new Context(publicTenant0.tenant), activitySeed);

          // Ensure that the publicTenant0 public user got it. The propagation of the test entity is the "routes", which we hard-coded to include
          // this user, therefore this user is allowed to receive this activity in their feed
          ActivityTestUtil.collectAndGetActivityStream(
            publicTenant0.publicUser.restContext,
            null,
            null,
            (error, response) => {
              assert.notExists(error);

              const contentCreateActivity = find(propEq('oae:activityType', 'content-create'), response.items);
              assert.ok(contentCreateActivity);
              ActivityTestUtil.assertActivity(
                contentCreateActivity,
                'content-create',
                'create',
                publicTenant0.publicUser.user.id,
                testId
              );

              // Ensure the `publicTenant0.privateUser` *does not* receive the activity. The routing will attempt to route `publicTenant0.privateUser`
              // this activity because they are a follower of `publicTenant0.publicUser` and the content-create activity will route to the followers of
              // the actor. However, propagation will reject the activity from the user's feed because the test entity type only allows propagation to
              // its routes, and this user is not part of its routes, as hard-coded in the association registration at the start of the test
              ActivityTestUtil.collectAndGetActivityStream(
                publicTenant0.privateUser.restContext,
                null,
                null,
                (error, response) => {
                  assert.notExists(error);
                  assert.isNotOk(find(propEq('oae:activityType', 'content-create'), response.items));

                  const followActivity = find(propEq('oae:activityType', 'following-follow'), response.items);
                  ActivityTestUtil.assertActivity(
                    followActivity,
                    'following-follow',
                    'follow',
                    publicTenant0.privateUser.user.id,
                    publicTenant0.publicUser.user.id
                  );
                  return callback();
                }
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies that activity associations can be specified that exclude routes
     */
    it('verify activity association exclusion', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (error, users) => {
        assert.notExists(error);

        const { 0: nico, 1: branden, 2: simon } = users;

        // Register a couple of associations for a fake entity type that produces simple routes
        const testEntityType = TestsUtil.generateTestUserId();
        ActivityAPI.registerActivityEntityAssociation(testEntityType, 'all', (associationsCtx, entity, callback) => {
          return callback(null, [nico.user.id, branden.user.id, simon.user.id]);
        });
        ActivityAPI.registerActivityEntityAssociation(
          testEntityType,
          'branden',
          (associationsCtx, entity, callback) => {
            return callback(null, [branden.user.id]);
          }
        );
        ActivityAPI.registerActivityEntityAssociation(testEntityType, 'simon', (associationsCtx, entity, callback) => {
          return callback(null, [simon.user.id]);
        });

        // Register a fake activity that should route to all users except for Branden
        // `^simon` has been added first in the set of associations to assert that exclusions are processed
        // in left-to-right order. As there is no set to exclude him, before that association, he will not be dropped
        const testActivityType = TestsUtil.generateTestUserId();
        ActivityAPI.registerActivityType(testActivityType, {
          streams: {
            activity: {
              router: {
                object: ['^simon', 'all', '^branden']
              }
            }
          }
        });

        // Fabricate an activity with a resource that will route the activity to all users except for branden
        const testId = TestsUtil.generateTestUserId();
        const actorResource = new ActivitySeedResource('user', nico.user.id);
        const objectResource = new ActivitySeedResource(testEntityType, testId);
        const activitySeed = new ActivitySeed(testActivityType, Date.now(), 'create', actorResource, objectResource);
        ActivityAPI.postActivity(new Context(global.oaeTests.tenants.cam), activitySeed);

        // Assert Branden didn't get the activity
        ActivityTestUtil.collectAndGetActivityStream(branden.restContext, null, null, (error, activityStream) => {
          assert.notExists(error);
          assert.strictEqual(activityStream.items.length, 0);

          // Assert Nico got the activity
          ActivityTestUtil.collectAndGetActivityStream(nico.restContext, null, null, (error, activityStream) => {
            assert.notExists(error);
            assert.strictEqual(activityStream.items.length, 1);
            assert.strictEqual(activityStream.items[0].object['oae:id'], testId);

            // Because Simon is excluded from the *empty set* (and NOT from the `all` set) he should have received an activity as well
            ActivityTestUtil.collectAndGetActivityStream(simon.restContext, null, null, (error, activityStream) => {
              assert.notExists(error);
              assert.strictEqual(activityStream.items.length, 1);
              assert.strictEqual(activityStream.items[0].object['oae:id'], testId);

              return callback();
            });
          });
        });
      });
    });
  });

  describe('Activity Stream Permissions and Validation', () => {
    /**
     * Test that verifies getting an activity stream is validated properly.
     */
    it('verify getActivityStream validation', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;

        // Try empty id
        ActivityTestUtil.assertGetActivityStreamFails(jack.restContext, ' ', null, 400, () => {
          // Try invalid principal id
          ActivityTestUtil.assertGetActivityStreamFails(jack.restContext, 'c:cam:someContent', null, 400, () => {
            // Try an invalid activity transformer
            ActivityTestUtil.assertGetActivityStreamFails(
              jack.restContext,
              jack.user.id,
              { format: 'non-existing' },
              400,
              () => {
                // Sanity-check valid query
                ActivityTestUtil.collectAndGetActivityStream(jack.restContext, jack.user.id, null, (error_) => {
                  assert.notExists(error_);
                  return callback();
                });
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies the permissions on a public user's activity stream
     */
    it('verify public user activity stream', (callback) => {
      _setupUsersAndDiscussions((publicTenant0, publicTenant1) => {
        // The public user's activity feed will contain 1 discussion-share activity
        // that involves the public user, the extra public user and the public discussion
        // This feed should be returned to all anonymous users and users from other tenants
        _assertStream(
          publicTenant0.anonymousRestContext,
          publicTenant0.publicUser.user.id,
          1,
          [publicTenant0.discussions.public2Extra.public.id],
          [publicTenant0.extraPublicUser.user.id],
          () => {
            _assertStream(
              publicTenant1.anonymousRestContext,
              publicTenant0.publicUser.user.id,
              1,
              [publicTenant0.discussions.public2Extra.public.id],
              [publicTenant0.extraPublicUser.user.id],
              () => {
                _assertStream(
                  publicTenant1.publicUser.restContext,
                  publicTenant0.publicUser.user.id,
                  1,
                  [publicTenant0.discussions.public2Extra.public.id],
                  [publicTenant0.extraPublicUser.user.id],
                  () => {
                    _assertStream(
                      publicTenant1.loggedinUser.restContext,
                      publicTenant0.publicUser.user.id,
                      1,
                      [publicTenant0.discussions.public2Extra.public.id],
                      [publicTenant0.extraPublicUser.user.id],
                      () => {
                        _assertStream(
                          publicTenant1.privateUser.restContext,
                          publicTenant0.publicUser.user.id,
                          1,
                          [publicTenant0.discussions.public2Extra.public.id],
                          [publicTenant0.extraPublicUser.user.id],
                          () => {
                            _assertStream(
                              publicTenant1.adminRestContext,
                              publicTenant0.publicUser.user.id,
                              1,
                              [publicTenant0.discussions.public2Extra.public.id],
                              [publicTenant0.extraPublicUser.user.id],
                              () => {
                                // Authenticated users from the same tenant will receive the
                                // loggedin activity stream. This stream will contain the actities
                                // between the public user and the extra public and loggedin users
                                // Both the public and loggedin discussions will be included
                                _assertStream(
                                  publicTenant0.loggedinUser.restContext,
                                  publicTenant0.publicUser.user.id,
                                  2,
                                  [
                                    publicTenant0.discussions.public2Extra.public.id,
                                    publicTenant0.discussions.public2Extra.loggedin.id,
                                    publicTenant0.discussions.public2Loggedin.public.id,
                                    publicTenant0.discussions.public2Loggedin.loggedin.id
                                  ],
                                  [publicTenant0.extraPublicUser.user.id, publicTenant0.loggedinUser.user.id],
                                  () => {
                                    _assertStream(
                                      publicTenant0.privateUser.restContext,
                                      publicTenant0.publicUser.user.id,
                                      2,
                                      [
                                        publicTenant0.discussions.public2Extra.public.id,
                                        publicTenant0.discussions.public2Extra.loggedin.id,
                                        publicTenant0.discussions.public2Loggedin.public.id,
                                        publicTenant0.discussions.public2Loggedin.loggedin.id
                                      ],
                                      [publicTenant0.extraPublicUser.user.id, publicTenant0.loggedinUser.user.id],
                                      () => {
                                        // The user who owns the activity stream gets the "private"
                                        // activity stream which includes all the activities. This
                                        // includes activities in which the user is not the actor.
                                        // The tenant administrator also has access to this stream
                                        const objectEntities = [
                                          publicTenant0.discussions.public2Extra.public.id,
                                          publicTenant0.discussions.public2Extra.loggedin.id,
                                          publicTenant0.discussions.public2Extra.private.id,
                                          publicTenant0.discussions.public2Loggedin.public.id,
                                          publicTenant0.discussions.public2Loggedin.loggedin.id,
                                          publicTenant0.discussions.public2Loggedin.private.id,
                                          publicTenant0.discussions.loggedin2Public.public.id,
                                          publicTenant0.discussions.loggedin2Public.loggedin.id,
                                          publicTenant0.discussions.loggedin2Public.private.id,
                                          publicTenant0.discussions.private2Public.public.id,
                                          publicTenant0.discussions.private2Public.loggedin.id,
                                          publicTenant0.discussions.private2Public.private.id
                                        ];
                                        _assertStream(
                                          publicTenant0.publicUser.restContext,
                                          publicTenant0.publicUser.user.id,
                                          4,
                                          objectEntities,
                                          [
                                            publicTenant0.extraPublicUser.user.id,
                                            publicTenant0.loggedinUser.user.id,
                                            publicTenant0.publicUser.user.id
                                          ],
                                          () => {
                                            _assertStream(
                                              publicTenant0.adminRestContext,
                                              publicTenant0.publicUser.user.id,
                                              4,
                                              objectEntities,
                                              [
                                                publicTenant0.extraPublicUser.user.id,
                                                publicTenant0.loggedinUser.user.id,
                                                publicTenant0.publicUser.user.id
                                              ],
                                              () => {
                                                return callback();
                                              }
                                            );
                                          }
                                        );
                                      }
                                    );
                                  }
                                );
                              }
                            );
                          }
                        );
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

    /**
     * Test that verifies the permissions on a loggedin user's activity stream
     */
    it('verify loggedin user activity stream', (callback) => {
      _setupUsersAndDiscussions((publicTenant0, publicTenant1) => {
        // A loggedin user's activity feed is not accessible
        // by anonymous users or users from another tenant
        ActivityTestUtil.assertGetActivityStreamFails(
          publicTenant0.anonymousRestContext,
          publicTenant0.loggedinUser.user.id,
          null,
          401,
          () => {
            ActivityTestUtil.assertGetActivityStreamFails(
              publicTenant1.anonymousRestContext,
              publicTenant0.loggedinUser.user.id,
              null,
              401,
              () => {
                ActivityTestUtil.assertGetActivityStreamFails(
                  publicTenant1.publicUser.restContext,
                  publicTenant0.loggedinUser.user.id,
                  null,
                  401,
                  () => {
                    ActivityTestUtil.assertGetActivityStreamFails(
                      publicTenant1.loggedinUser.restContext,
                      publicTenant0.loggedinUser.user.id,
                      null,
                      401,
                      () => {
                        ActivityTestUtil.assertGetActivityStreamFails(
                          publicTenant1.privateUser.restContext,
                          publicTenant0.loggedinUser.user.id,
                          null,
                          401,
                          () => {
                            ActivityTestUtil.assertGetActivityStreamFails(
                              publicTenant1.adminRestContext,
                              publicTenant0.loggedinUser.user.id,
                              null,
                              401,
                              () => {
                                // Users from the same tenant will be given the logged in activity stream
                                let objectEntities = [
                                  publicTenant0.discussions.loggedin2Public.public.id,
                                  publicTenant0.discussions.loggedin2Public.loggedin.id,
                                  publicTenant0.discussions.loggedin2Extra.public.id,
                                  publicTenant0.discussions.loggedin2Extra.loggedin.id
                                ];
                                _assertStream(
                                  publicTenant0.publicUser.restContext,
                                  publicTenant0.loggedinUser.user.id,
                                  2,
                                  objectEntities,
                                  [publicTenant0.extraPublicUser.user.id, publicTenant0.publicUser.user.id],
                                  () => {
                                    _assertStream(
                                      publicTenant0.privateUser.restContext,
                                      publicTenant0.loggedinUser.user.id,
                                      2,
                                      objectEntities,
                                      [publicTenant0.extraPublicUser.user.id, publicTenant0.publicUser.user.id],
                                      () => {
                                        // The user who owns the activity stream gets the "private"
                                        // activity stream which includes all the activities (including)
                                        // those where he is not an actor. The tenant administrator
                                        // for this user can also see this private activity stream
                                        objectEntities = [
                                          publicTenant0.discussions.loggedin2Public.public.id,
                                          publicTenant0.discussions.loggedin2Public.loggedin.id,
                                          publicTenant0.discussions.loggedin2Public.private.id,
                                          publicTenant0.discussions.loggedin2Extra.public.id,
                                          publicTenant0.discussions.loggedin2Extra.loggedin.id,
                                          publicTenant0.discussions.loggedin2Extra.private.id,
                                          publicTenant0.discussions.public2Loggedin.public.id,
                                          publicTenant0.discussions.public2Loggedin.loggedin.id,
                                          publicTenant0.discussions.public2Loggedin.private.id,
                                          publicTenant0.discussions.private2Loggedin.public.id,
                                          publicTenant0.discussions.private2Loggedin.loggedin.id,
                                          publicTenant0.discussions.private2Loggedin.private.id
                                        ];
                                        _assertStream(
                                          publicTenant0.loggedinUser.restContext,
                                          publicTenant0.loggedinUser.user.id,
                                          4,
                                          objectEntities,
                                          [
                                            publicTenant0.extraPublicUser.user.id,
                                            publicTenant0.publicUser.user.id,
                                            publicTenant0.loggedinUser.user.id
                                          ],
                                          () => {
                                            _assertStream(
                                              publicTenant0.loggedinUser.restContext,
                                              publicTenant0.loggedinUser.user.id,
                                              4,
                                              objectEntities,
                                              [
                                                publicTenant0.extraPublicUser.user.id,
                                                publicTenant0.publicUser.user.id,
                                                publicTenant0.loggedinUser.user.id
                                              ],
                                              () => {
                                                return callback();
                                              }
                                            );
                                          }
                                        );
                                      }
                                    );
                                  }
                                );
                              }
                            );
                          }
                        );
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

    /**
     * Test that verifies the permissions on a private user's activity stream
     */
    it('verify private user activity stream', (callback) => {
      _setupUsersAndDiscussions((publicTenant0, publicTenant1) => {
        // A private user's activity feed is only accessible by the user themselve
        // or by a tenant administrator
        ActivityTestUtil.assertGetActivityStreamFails(
          publicTenant0.anonymousRestContext,
          publicTenant0.privateUser.user.id,
          null,
          401,
          () => {
            ActivityTestUtil.assertGetActivityStreamFails(
              publicTenant1.anonymousRestContext,
              publicTenant0.privateUser.user.id,
              null,
              401,
              () => {
                ActivityTestUtil.assertGetActivityStreamFails(
                  publicTenant1.publicUser.restContext,
                  publicTenant0.privateUser.user.id,
                  null,
                  401,
                  () => {
                    ActivityTestUtil.assertGetActivityStreamFails(
                      publicTenant1.loggedinUser.restContext,
                      publicTenant0.privateUser.user.id,
                      null,
                      401,
                      () => {
                        ActivityTestUtil.assertGetActivityStreamFails(
                          publicTenant1.privateUser.restContext,
                          publicTenant0.privateUser.user.id,
                          null,
                          401,
                          () => {
                            ActivityTestUtil.assertGetActivityStreamFails(
                              publicTenant1.adminRestContext,
                              publicTenant0.privateUser.user.id,
                              null,
                              401,
                              () => {
                                ActivityTestUtil.assertGetActivityStreamFails(
                                  publicTenant0.publicUser.restContext,
                                  publicTenant0.privateUser.user.id,
                                  null,
                                  401,
                                  () => {
                                    ActivityTestUtil.assertGetActivityStreamFails(
                                      publicTenant0.loggedinUser.restContext,
                                      publicTenant0.privateUser.user.id,
                                      null,
                                      401,
                                      () => {
                                        // The user who owns the activity stream gets the "private"
                                        // activity stream which includes all the activities (including)
                                        // those where he is not an actor. The tenant administrator
                                        // for this user can also see this private activity stream
                                        const objectEntities = [
                                          publicTenant0.discussions.private2Public.public.id,
                                          publicTenant0.discussions.private2Public.loggedin.id,
                                          publicTenant0.discussions.private2Public.private.id,
                                          publicTenant0.discussions.private2Loggedin.public.id,
                                          publicTenant0.discussions.private2Loggedin.loggedin.id,
                                          publicTenant0.discussions.private2Loggedin.private.id,
                                          publicTenant0.discussions.private2Extra.public.id,
                                          publicTenant0.discussions.private2Extra.loggedin.id,
                                          publicTenant0.discussions.private2Extra.private.id
                                        ];
                                        _assertStream(
                                          publicTenant0.privateUser.restContext,
                                          publicTenant0.privateUser.user.id,
                                          3,
                                          objectEntities,
                                          [
                                            publicTenant0.extraPublicUser.user.id,
                                            publicTenant0.publicUser.user.id,
                                            publicTenant0.loggedinUser.user.id
                                          ],
                                          () => {
                                            return callback();
                                          }
                                        );
                                      }
                                    );
                                  }
                                );
                              }
                            );
                          }
                        );
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

    /**
     * Test that verifies the permissions on a public group's activity stream
     */
    it('verify public group activity stream', (callback) => {
      _setupGroupsAndDiscussions((publicTenant0, publicTenant1) => {
        // Anonymous users and authenticated users from other tenants will receive
        // the public activity stream for a public group
        _assertStream(
          publicTenant0.anonymousRestContext,
          publicTenant0.publicGroup.id,
          1,
          [publicTenant0.publicGroup.discussions.public.id],
          [publicTenant0.publicGroup.id],
          () => {
            _assertStream(
              publicTenant1.anonymousRestContext,
              publicTenant0.publicGroup.id,
              1,
              [publicTenant0.publicGroup.discussions.public.id],
              [publicTenant0.publicGroup.id],
              () => {
                _assertStream(
                  publicTenant1.publicUser.restContext,
                  publicTenant0.publicGroup.id,
                  1,
                  [publicTenant0.publicGroup.discussions.public.id],
                  [publicTenant0.publicGroup.id],
                  () => {
                    _assertStream(
                      publicTenant1.loggedinUser.restContext,
                      publicTenant0.publicGroup.id,
                      1,
                      [publicTenant0.publicGroup.discussions.public.id],
                      [publicTenant0.publicGroup.id],
                      () => {
                        _assertStream(
                          publicTenant1.privateUser.restContext,
                          publicTenant0.publicGroup.id,
                          1,
                          [publicTenant0.publicGroup.discussions.public.id],
                          [publicTenant0.publicGroup.id],
                          () => {
                            _assertStream(
                              publicTenant1.adminRestContext,
                              publicTenant0.publicGroup.id,
                              1,
                              [publicTenant0.publicGroup.discussions.public.id],
                              [publicTenant0.publicGroup.id],
                              () => {
                                // Authenticated users on the same tenant will receive
                                // the loggedin activity stream for a public group
                                _assertStream(
                                  publicTenant0.loggedinUser.restContext,
                                  publicTenant0.publicGroup.id,
                                  1,
                                  [
                                    publicTenant0.publicGroup.discussions.public.id,
                                    publicTenant0.publicGroup.discussions.loggedin.id
                                  ],
                                  [publicTenant0.publicGroup.id],
                                  () => {
                                    _assertStream(
                                      publicTenant0.privateUser.restContext,
                                      publicTenant0.publicGroup.id,
                                      1,
                                      [
                                        publicTenant0.publicGroup.discussions.public.id,
                                        publicTenant0.publicGroup.discussions.loggedin.id
                                      ],
                                      [publicTenant0.publicGroup.id],
                                      () => {
                                        // Members and tenant administrators will receive
                                        // the private activity stream for a public group
                                        _assertStream(
                                          publicTenant0.publicUser.restContext,
                                          publicTenant0.publicGroup.id,
                                          1,
                                          [
                                            publicTenant0.publicGroup.discussions.public.id,
                                            publicTenant0.publicGroup.discussions.loggedin.id,
                                            publicTenant0.publicGroup.discussions.private.id
                                          ],
                                          [publicTenant0.publicGroup.id],
                                          () => {
                                            _assertStream(
                                              publicTenant0.adminRestContext,
                                              publicTenant0.publicGroup.id,
                                              1,
                                              [
                                                publicTenant0.publicGroup.discussions.public.id,
                                                publicTenant0.publicGroup.discussions.loggedin.id,
                                                publicTenant0.publicGroup.discussions.private.id
                                              ],
                                              [publicTenant0.publicGroup.id],
                                              () => {
                                                return callback();
                                              }
                                            );
                                          }
                                        );
                                      }
                                    );
                                  }
                                );
                              }
                            );
                          }
                        );
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

    /**
     * Test that verifies the permissions on a loggedin group's activity stream
     */
    it('verify loggedin group activity stream', (callback) => {
      _setupGroupsAndDiscussions((publicTenant0, publicTenant1) => {
        // Anonymous users and authenticated users from other tenants
        // cannot access the activity stream of a loggedin group
        ActivityTestUtil.assertGetActivityStreamFails(
          publicTenant0.anonymousRestContext,
          publicTenant0.loggedinJoinableGroup.id,
          null,
          401,
          () => {
            ActivityTestUtil.assertGetActivityStreamFails(
              publicTenant0.anonymousRestContext,
              publicTenant0.loggedinNotJoinableGroup.id,
              null,
              401,
              () => {
                ActivityTestUtil.assertGetActivityStreamFails(
                  publicTenant1.anonymousRestContext,
                  publicTenant0.loggedinJoinableGroup.id,
                  null,
                  401,
                  () => {
                    ActivityTestUtil.assertGetActivityStreamFails(
                      publicTenant1.anonymousRestContext,
                      publicTenant0.loggedinNotJoinableGroup.id,
                      null,
                      401,
                      () => {
                        // Issue-1402 if the group was joinable,
                        // it would be able to see public items on the activity feed
                        ActivityTestUtil.assertGetActivityStreamFails(
                          publicTenant1.publicUser.restContext,
                          publicTenant0.loggedinNotJoinableGroup.id,
                          null,
                          401,
                          () => {
                            // Issue-1402 if the group was joinable,
                            // it would be able to see public items on the activity feed
                            ActivityTestUtil.assertGetActivityStreamFails(
                              publicTenant1.loggedinUser.restContext,
                              publicTenant0.loggedinNotJoinableGroup.id,
                              null,
                              401,
                              () => {
                                // Issue-1402 if the group was joinable,
                                // it would be able to see public items on the activity feed
                                ActivityTestUtil.assertGetActivityStreamFails(
                                  publicTenant1.privateUser.restContext,
                                  publicTenant0.loggedinNotJoinableGroup.id,
                                  null,
                                  401,
                                  () => {
                                    ActivityTestUtil.assertGetActivityStreamFails(
                                      publicTenant1.adminRestContext,
                                      publicTenant0.loggedinNotJoinableGroup.id,
                                      null,
                                      401,
                                      () => {
                                        // Authenticated users on the same tenant will receive
                                        // the loggedin activity stream for a loggedin group
                                        _assertStream(
                                          publicTenant0.publicUser.restContext,
                                          publicTenant0.loggedinJoinableGroup.id,
                                          1,
                                          [
                                            publicTenant0.loggedinJoinableGroup.discussions.public.id,
                                            publicTenant0.loggedinJoinableGroup.discussions.loggedin.id
                                          ],
                                          [publicTenant0.loggedinJoinableGroup.id],
                                          () => {
                                            _assertStream(
                                              publicTenant0.publicUser.restContext,
                                              publicTenant0.loggedinNotJoinableGroup.id,
                                              1,
                                              [
                                                publicTenant0.loggedinNotJoinableGroup.discussions.public.id,
                                                publicTenant0.loggedinNotJoinableGroup.discussions.loggedin.id
                                              ],
                                              [publicTenant0.loggedinNotJoinableGroup.id],
                                              () => {
                                                _assertStream(
                                                  publicTenant0.privateUser.restContext,
                                                  publicTenant0.loggedinNotJoinableGroup.id,
                                                  1,
                                                  [
                                                    publicTenant0.loggedinNotJoinableGroup.discussions.public.id,
                                                    publicTenant0.loggedinNotJoinableGroup.discussions.loggedin.id
                                                  ],
                                                  [publicTenant0.loggedinNotJoinableGroup.id],
                                                  () => {
                                                    _assertStream(
                                                      publicTenant0.privateUser.restContext,
                                                      publicTenant0.loggedinJoinableGroup.id,
                                                      1,
                                                      [
                                                        publicTenant0.loggedinJoinableGroup.discussions.public.id,
                                                        publicTenant0.loggedinJoinableGroup.discussions.loggedin.id
                                                      ],
                                                      [publicTenant0.loggedinJoinableGroup.id],
                                                      () => {
                                                        // Members and tenant administrators will receive
                                                        // the private activity stream for a loggedin group
                                                        _assertStream(
                                                          publicTenant0.loggedinUser.restContext,
                                                          publicTenant0.loggedinNotJoinableGroup.id,
                                                          1,
                                                          [
                                                            publicTenant0.loggedinNotJoinableGroup.discussions.public
                                                              .id,
                                                            publicTenant0.loggedinNotJoinableGroup.discussions.loggedin
                                                              .id,
                                                            publicTenant0.loggedinNotJoinableGroup.discussions.private
                                                              .id
                                                          ],
                                                          [publicTenant0.loggedinNotJoinableGroup.id],
                                                          () => {
                                                            _assertStream(
                                                              publicTenant0.loggedinUser.restContext,
                                                              publicTenant0.loggedinJoinableGroup.id,
                                                              1,
                                                              [
                                                                publicTenant0.loggedinJoinableGroup.discussions.public
                                                                  .id,
                                                                publicTenant0.loggedinJoinableGroup.discussions.loggedin
                                                                  .id,
                                                                publicTenant0.loggedinJoinableGroup.discussions.private
                                                                  .id
                                                              ],
                                                              [publicTenant0.loggedinJoinableGroup.id],
                                                              () => {
                                                                _assertStream(
                                                                  publicTenant0.adminRestContext,
                                                                  publicTenant0.loggedinNotJoinableGroup.id,
                                                                  1,
                                                                  [
                                                                    publicTenant0.loggedinNotJoinableGroup.discussions
                                                                      .public.id,
                                                                    publicTenant0.loggedinNotJoinableGroup.discussions
                                                                      .loggedin.id,
                                                                    publicTenant0.loggedinNotJoinableGroup.discussions
                                                                      .private.id
                                                                  ],
                                                                  [publicTenant0.loggedinNotJoinableGroup.id],
                                                                  () => {
                                                                    _assertStream(
                                                                      publicTenant0.adminRestContext,
                                                                      publicTenant0.loggedinJoinableGroup.id,
                                                                      1,
                                                                      [
                                                                        publicTenant0.loggedinJoinableGroup.discussions
                                                                          .public.id,
                                                                        publicTenant0.loggedinJoinableGroup.discussions
                                                                          .loggedin.id,
                                                                        publicTenant0.loggedinJoinableGroup.discussions
                                                                          .private.id
                                                                      ],
                                                                      [publicTenant0.loggedinJoinableGroup.id],
                                                                      () => {
                                                                        return callback();
                                                                      }
                                                                    );
                                                                  }
                                                                );
                                                              }
                                                            );
                                                          }
                                                        );
                                                      }
                                                    );
                                                  }
                                                );
                                              }
                                            );
                                          }
                                        );
                                      }
                                    );
                                  }
                                );
                              }
                            );
                          }
                        );
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

    /**
     * Test that verifies the permissions on a private group's activity stream
     */
    it('verify private group activity stream', (callback) => {
      _setupGroupsAndDiscussions((publicTenant0, publicTenant1) => {
        // A private group's activity feed is only accessible by members or by a tenant administrator
        ActivityTestUtil.assertGetActivityStreamFails(
          publicTenant0.anonymousRestContext,
          publicTenant0.privateNotJoinableGroup.id,
          null,
          401,
          () => {
            ActivityTestUtil.assertGetActivityStreamFails(
              publicTenant0.anonymousRestContext,
              publicTenant0.privateJoinableGroup.id,
              null,
              401,
              () => {
                ActivityTestUtil.assertGetActivityStreamFails(
                  publicTenant1.anonymousRestContext,
                  publicTenant0.privateNotJoinableGroup.id,
                  null,
                  401,
                  () => {
                    ActivityTestUtil.assertGetActivityStreamFails(
                      publicTenant1.anonymousRestContext,
                      publicTenant0.privateJoinableGroup.id,
                      null,
                      401,
                      () => {
                        // Issue-1402 if joinable, then public items are accessible
                        ActivityTestUtil.assertGetActivityStreamFails(
                          publicTenant1.publicUser.restContext,
                          publicTenant0.privateNotJoinableGroup.id,
                          null,
                          401,
                          () => {
                            // Issue-1402 if joinable, then public items are accessible
                            ActivityTestUtil.assertGetActivityStreamFails(
                              publicTenant1.loggedinUser.restContext,
                              publicTenant0.privateNotJoinableGroup.id,
                              null,
                              401,
                              () => {
                                // Issue-1402 if joinable, then public items are accessible
                                ActivityTestUtil.assertGetActivityStreamFails(
                                  publicTenant1.privateUser.restContext,
                                  publicTenant0.privateNotJoinableGroup.id,
                                  null,
                                  401,
                                  () => {
                                    // Issue-1402 if joinable, then public items are accessible
                                    ActivityTestUtil.assertGetActivityStreamFails(
                                      publicTenant1.adminRestContext,
                                      publicTenant0.privateNotJoinableGroup.id,
                                      null,
                                      401,
                                      () => {
                                        // Issue-1402 if joinable, then public items are accessible
                                        ActivityTestUtil.assertGetActivityStreamFails(
                                          publicTenant0.publicUser.restContext,
                                          publicTenant0.privateNotJoinableGroup.id,
                                          null,
                                          401,
                                          () => {
                                            // Issue-1402 if joinable, then public items are accessible
                                            ActivityTestUtil.assertGetActivityStreamFails(
                                              publicTenant0.loggedinUser.restContext,
                                              publicTenant0.privateNotJoinableGroup.id,
                                              null,
                                              401,
                                              () => {
                                                // Members and tenant administrators will receive
                                                // the private activity stream for a private group
                                                _assertStream(
                                                  publicTenant0.privateUser.restContext,
                                                  publicTenant0.privateJoinableGroup.id,
                                                  1,
                                                  [
                                                    publicTenant0.privateJoinableGroup.discussions.public.id,
                                                    publicTenant0.privateJoinableGroup.discussions.loggedin.id,
                                                    publicTenant0.privateJoinableGroup.discussions.private.id
                                                  ],
                                                  [publicTenant0.privateJoinableGroup.id],
                                                  () => {
                                                    _assertStream(
                                                      publicTenant0.privateUser.restContext,
                                                      publicTenant0.privateJoinableGroup.id,
                                                      1,
                                                      [
                                                        publicTenant0.privateJoinableGroup.discussions.public.id,
                                                        publicTenant0.privateJoinableGroup.discussions.loggedin.id,
                                                        publicTenant0.privateJoinableGroup.discussions.private.id
                                                      ],
                                                      [publicTenant0.privateJoinableGroup.id],
                                                      () => {
                                                        _assertStream(
                                                          publicTenant0.adminRestContext,
                                                          publicTenant0.privateJoinableGroup.id,
                                                          1,
                                                          [
                                                            publicTenant0.privateJoinableGroup.discussions.public.id,
                                                            publicTenant0.privateJoinableGroup.discussions.loggedin.id,
                                                            publicTenant0.privateJoinableGroup.discussions.private.id
                                                          ],
                                                          [publicTenant0.privateJoinableGroup.id],
                                                          () => {
                                                            _assertStream(
                                                              publicTenant0.adminRestContext,
                                                              publicTenant0.privateNotJoinableGroup.id,
                                                              1,
                                                              [
                                                                publicTenant0.privateNotJoinableGroup.discussions.public
                                                                  .id,
                                                                publicTenant0.privateNotJoinableGroup.discussions
                                                                  .loggedin.id,
                                                                publicTenant0.privateNotJoinableGroup.discussions
                                                                  .private.id
                                                              ],
                                                              [publicTenant0.privateNotJoinableGroup.id],
                                                              () => {
                                                                return callback();
                                                              }
                                                            );
                                                          }
                                                        );
                                                      }
                                                    );
                                                  }
                                                );
                                              }
                                            );
                                          }
                                        );
                                      }
                                    );
                                  }
                                );
                              }
                            );
                          }
                        );
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

  describe('Getting Activity Stream', () => {
    /**
     * Test that verifies the tenant information gets associated with each activity entity.
     */
    it('verify activities have tenant information', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);

        const { 0: jack, 1: jane } = users;

        // Jack creates a link and shares it with Jane.
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.com',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);
            RestAPI.Content.shareContent(jack.restContext, link.id, [jane.user.id], (error_) => {
              assert.notExists(error_);

              ActivityTestUtil.collectAndGetActivityStream(jack.restContext, null, null, (error, activityStream) => {
                assert.notExists(error);
                assert.ok(activityStream.items.length > 0);

                /**
                 * Verifies that the oae:tenant object is present on the activity entity.
                 *
                 * @param  {ActivityEntity} entity The activity entity
                 */
                const assertActivityEntity = function (entity) {
                  assert.ok(entity['oae:tenant']);
                  assert.strictEqual(entity['oae:tenant'].alias, global.oaeTests.tenants.cam.alias);
                  assert.strictEqual(entity['oae:tenant'].displayName, global.oaeTests.tenants.cam.displayName);
                };

                // Make sure that both the actor, object and target (if one is available) have an oae:tenant object.
                forEach((activity) => {
                  assertActivityEntity(activity.actor);
                  assertActivityEntity(activity.object);
                  if (activity['oae:activityType'] === 'content-share') {
                    assertActivityEntity(activity.target);
                  }
                }, activityStream.items);
                callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies the tenant information gets associated with each activity entity when they appear in collections.
     */
    it('verify activities with collections have tenant information', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (error, users) => {
        assert.notExists(error);

        const { 0: jack, 1: jane, 2: jill } = users;

        // Jack creates a link and shares it with Jane and Jill.
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.com',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);
            RestAPI.Content.shareContent(jack.restContext, link.id, [jane.user.id, jill.user.id], (error_) => {
              assert.notExists(error_);

              ActivityTestUtil.collectAndGetActivityStream(jack.restContext, null, null, (error, activityStream) => {
                assert.notExists(error);
                assert.ok(activityStream.items.length > 0);

                /**
                 * Verifies that the oae:tenant object is present on the activity entity.
                 *
                 * @param  {ActivityEntity} entity The activity entity
                 */
                const assertActivityEntity = function (entity) {
                  assert.ok(entity['oae:tenant']);
                  assert.strictEqual(entity['oae:tenant'].alias, global.oaeTests.tenants.cam.alias);
                  assert.strictEqual(entity['oae:tenant'].displayName, global.oaeTests.tenants.cam.displayName);
                };

                // Make sure that both the actor, object and target (if one is available) have an oae:tenant object.
                forEach((activity) => {
                  assertActivityEntity(activity.actor);
                  assertActivityEntity(activity.object);
                  if (activity['oae:activityType'] === 'content-share') {
                    forEach((entity) => {
                      assertActivityEntity(entity);
                    }, activity.target['oae:collection']);
                  }
                }, activityStream.items);
                callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies paging of activity feeds
     */
    it('verify paging of activity feeds', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);

        const { 0: jack, 1: jane } = users;

        // Generate 2 activities for jack's feed
        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'A',
            description: 'A',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            RestAPI.Content.shareContent(jack.restContext, link.id, [jane.user.id], (error_) => {
              assert.notExists(error_);

              // Get the items, ensure there are 2
              ActivityTestUtil.collectAndGetActivityStream(jack.restContext, null, null, (error, activityStream) => {
                assert.notExists(error);
                assert.strictEqual(activityStream.items.length, 2);

                const firstId = activityStream.items[0]['oae:activityId'];
                const secondId = activityStream.items[1]['oae:activityId'];

                // Verify when you query with limit=1, you get the first and only the first activity
                ActivityTestUtil.collectAndGetActivityStream(
                  jack.restContext,
                  null,
                  { limit: 1 },
                  (error, activityStream) => {
                    assert.notExists(error);
                    assert.strictEqual(activityStream.items.length, 1);
                    assert.strictEqual(activityStream.items[0]['oae:activityId'], firstId);
                    assert.strictEqual(activityStream.nextToken, firstId);

                    // Verify when you query with the firstId as the start point, you get just the second activity
                    ActivityTestUtil.collectAndGetActivityStream(
                      jack.restContext,
                      null,
                      { start: firstId },
                      (error, activityStream) => {
                        assert.notExists(error);
                        assert.strictEqual(activityStream.items.length, 1);
                        assert.strictEqual(activityStream.items[0]['oae:activityId'], secondId);
                        assert.ok(!activityStream.nextToken);
                        return callback();
                      }
                    );
                  }
                );
              });
            });
          }
        );
      });
    });

    /**
     * Verify the activity transformer can be specified when requesting the activities from the REST API
     */
    it('verify the transformer can be specified', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);

        const { 0: jack } = users;

        RestAPI.Content.createLink(
          jack.restContext,
          {
            displayName: 'A',
            description: 'A',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, link) => {
            assert.notExists(error);

            // Assert that it defaults to the activitystrea.ms spec
            ActivityTestUtil.collectAndGetActivityStream(jack.restContext, null, null, (error, activityStream) => {
              assert.notExists(error);

              // The activity entities will have extra properties and will be formatted slightly differently
              const { 0: activity } = activityStream.items;
              assert.ok(activity);

              assert.ok(activity.actor);
              assert.strictEqual(activity.actor['oae:id'], jack.user.id);
              assert.strictEqual(activity.actor['oae:visibility'], jack.user.visibility);
              assert.strictEqual(activity.actor['oae:profilePath'], jack.user.profilePath);
              assert.strictEqual(activity.actor.displayName, jack.user.displayName);
              assert.strictEqual(
                activity.actor.url,
                'http://' + global.oaeTests.tenants.cam.host + '/user/camtest/' + jack.user.id.split(':')[2]
              );
              assert.strictEqual(activity.actor.objectType, 'user');
              assert.strictEqual(
                activity.actor.id,
                'http://' + global.oaeTests.tenants.cam.host + '/api/user/' + jack.user.id
              );
              assert.isObject(activity.actor['oae:tenant']);

              let allowedActorProperties = [
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
                  contains(key, allowedActorProperties),
                  key + ' is not allowed on an ActivityStrea.ms compliant formatted activity entity'
                );
              }, activity.actor);

              assert.ok(activity.object);
              assert.strictEqual(activity.object['oae:id'], link.id);
              assert.strictEqual(activity.object['oae:visibility'], link.visibility);
              assert.strictEqual(activity.object['oae:profilePath'], link.profilePath);
              assert.strictEqual(activity.object['oae:resourceSubType'], link.resourceSubType);
              assert.strictEqual(activity.object['oae:revisionId'], link.latestRevisionId);
              assert.strictEqual(activity.object.displayName, link.displayName);
              assert.strictEqual(
                activity.object.url,
                'http://' + global.oaeTests.tenants.cam.host + '/content/camtest/' + link.id.split(':')[2]
              );
              assert.strictEqual(activity.object.objectType, 'content');
              assert.strictEqual(
                activity.object.id,
                'http://' + global.oaeTests.tenants.cam.host + '/api/content/' + link.id
              );
              assert.isObject(activity.object['oae:tenant']);

              let allowedObjectProperties = [
                'oae:id',
                'oae:visibility',
                'oae:profilePath',
                'oae:resourceSubType',
                'oae:revisionId',
                'displayName',
                'url',
                'objectType',
                'id',
                'oae:tenant'
              ];
              forEachObjIndexed((value, key) => {
                assert.ok(
                  contains(key, allowedObjectProperties),
                  key + ' is not allowed on an ActivityStrea.ms compliant formatted activity entity'
                );
              }, activity.object);

              // Assert that the format can be specified
              RestAPI.Activity.getActivityStream(
                jack.restContext,
                jack.user.id,
                { format: 'internal' },
                (error, activityStream) => {
                  assert.notExists(error);

                  const { 0: activity } = activityStream.items;
                  assert.ok(activity);

                  // Assert that the actor entity is a user object augmented with an oae:id and objectType
                  assert.ok(activity.actor);
                  assert.strictEqual(activity.actor['oae:id'], jack.user.id);
                  assert.strictEqual(activity.actor.id, jack.user.id);
                  assert.strictEqual(activity.actor.displayName, jack.user.displayName);
                  assert.strictEqual(activity.actor.visibility, jack.user.visibility);
                  assert.strictEqual(activity.actor.locale, 'en_GB');
                  assert.strictEqual(activity.actor.publicAlias, jack.user.publicAlias);
                  assert.isObject(activity.actor.picture);
                  assert.strictEqual(activity.actor.profilePath, jack.user.profilePath);
                  assert.strictEqual(activity.actor.resourceType, 'user');
                  assert.strictEqual(activity.actor.acceptedTC, 0);
                  assert.strictEqual(activity.actor.objectType, 'user');
                  assert.isObject(activity.actor.tenant);

                  // Ensure only these properties are present
                  allowedActorProperties = [
                    'oae:id',
                    'id',
                    'displayName',
                    'visibility',
                    'locale',
                    'publicAlias',
                    'picture',
                    'profilePath',
                    'resourceType',
                    'acceptedTC',
                    'objectType',
                    'tenant',
                    'email',
                    'emailPreference'
                  ];
                  forEachObjIndexed((value, key) => {
                    assert.ok(
                      contains(key, allowedActorProperties),
                      key + ' is not allowed on an internally formatted activity entity'
                    );
                  }, activity.actor);

                  // Assert that the object entity is a content object augmented with an oae:id and objectType
                  assert.ok(activity.object);
                  assert.strictEqual(activity.object['oae:id'], link.id);
                  assert.strictEqual(activity.object.id, link.id);
                  assert.strictEqual(activity.object.visibility, link.visibility);
                  assert.strictEqual(activity.object.displayName, link.displayName);
                  assert.strictEqual(activity.object.description, link.description);
                  assert.strictEqual(activity.object.resourceSubType, link.resourceSubType);
                  assert.strictEqual(activity.object.createdBy, link.createdBy);
                  assert.strictEqual(activity.object.created, link.created);
                  assert.strictEqual(activity.object.lastModified, link.lastModified);
                  assert.strictEqual(activity.object.profilePath, link.profilePath);
                  assert.strictEqual(activity.object.resourceType, link.resourceType);
                  assert.strictEqual(activity.object.latestRevisionId, link.latestRevisionId);
                  assert.isObject(activity.object.previews);
                  assert.isObject(activity.object.signature);
                  assert.strictEqual(activity.object.objectType, 'content');
                  assert.isObject(activity.object.tenant);

                  // Ensure only these properties are present
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

                  return callback();
                }
              );
            });
          }
        );
      });
    });
  });

  describe('Activity Stream Aggregation', () => {
    /**
     * Test that verifies that an erroneous routed activity does not cause
     * the routed activity bucket to be irrecoverably damaged
     */
    it('verify an error in routed activity data does not permanently damage an aggregation bucket', (callback) => {
      // Start with empty collection buckets
      ActivityAggregator.collectAllBuckets((error) => {
        assert.notExists(error);

        // Create jack and add a legitimate activity to his feed
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
          assert.notExists(error);

          const { 0: jack } = users;

          // Mock an error each time a content-create activity is attempted to be delivered for jack's feed
          process.env.TEST_ALTERNATE_AGGREGATION = 'true';
          global.alternateAggregateStatus = function (allAggregateKeys, callback) {
            const brokenAggregateKeyPrefix = format('content-create#%s#activity', jack.user.id);
            const brokenAggregateKeys = filter(compose(equals(0), indexOf(brokenAggregateKeyPrefix)), allAggregateKeys);

            // Let's avoid the infinite loop by resetting the env variable
            process.env.TEST_ALTERNATE_AGGREGATION = 'false';

            if (isEmpty(brokenAggregateKeys)) {
              // If there is no broken aggregate key in this set, simply pass up to the regular function
              return activityDaoGetAggregateStatusFn(allAggregateKeys, callback);
            }

            // There is an aggregate key we've flagged as broken, mock an error
            return callback({ code: 500, msg: 'Forced error for test' });
          };

          // Create a link, ensuring no activity can be delivered because the activity is broken for jack
          RestAPI.Content.createLink(
            jack.restContext,
            {
              displayName: 'A',
              description: 'A',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, linkA) => {
              assert.notExists(error);
              ActivityTestUtil.collectAndGetActivityStream(jack.restContext, null, null, (error, activityStream) => {
                assert.notExists(error);
                assert.strictEqual(activityStream.items.length, 0);
                assert.strictEqual(activityStream.nextToken, null);

                // Comment on the link, ensuring it can be delivered because it's not broken, and having one failed
                // routed activity should not permanently damage the queue
                RestAPI.Content.createComment(jack.restContext, linkA.id, 'Comment Comment', null, (error_) => {
                  assert.notExists(error_);
                  ActivityTestUtil.collectAndGetActivityStream(
                    jack.restContext,
                    null,
                    null,
                    (error, activityStream) => {
                      assert.notExists(error);
                      assert.strictEqual(activityStream.items.length, 1);
                      assert.strictEqual(activityStream.nextToken, null);

                      const { 0: activity } = activityStream.items;
                      assert.strictEqual(activity['oae:activityType'], 'content-comment');
                      assert.strictEqual(activity.actor['oae:id'], jack.user.id);
                      assert.strictEqual(activity.target['oae:id'], linkA.id);
                      return callback();
                    }
                  );
                });
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies when the aggregation expiry time has exceeded, a new activity will be created when it matches a pivot
     * rather than continuing to aggregate in the previous activity.
     */
    it('verify aggregation idle expiry time', (callback) => {
      // Set the aggregate expiry time to 1 second. This should give us enough time to aggregate 2 activities, wait for expiry, then create a 3rd to verify it does not aggregate.
      ActivityTestUtil.refreshConfiguration({ aggregateIdleExpiry: 1 }, (error) => {
        assert.notExists(error);

        TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
          assert.notExists(error);

          const { 0: jack } = users;

          RestAPI.Content.createLink(
            jack.restContext,
            {
              displayName: 'A',
              description: 'A',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, linkA) => {
              assert.notExists(error);

              RestAPI.Content.createLink(
                jack.restContext,
                {
                  displayName: 'B',
                  description: 'B',
                  visibility: PUBLIC,
                  link: 'http://www.google.ca',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error, linkB) => {
                  assert.notExists(error);

                  ActivityTestUtil.collectAndGetActivityStream(
                    jack.restContext,
                    null,
                    null,
                    (error, activityStream) => {
                      assert.notExists(error);

                      // Verify both creates are aggregated into 1 activity
                      assert.strictEqual(activityStream.items.length, 1);

                      let hasA = false;
                      let hasB = false;

                      let entity = activityStream.items[0].object;
                      assert.ok(entity['oae:collection']);
                      forEach((collectedEntity) => {
                        if (collectedEntity['oae:id'] === linkA.id) {
                          hasA = true;
                        } else if (collectedEntity['oae:id'] === linkB.id) {
                          hasB = true;
                        }
                      }, entity['oae:collection']);

                      assert.ok(hasA);
                      assert.ok(hasB);

                      // Let the aggregation timeout expire and create a new link
                      setTimeout(
                        RestAPI.Content.createLink,
                        1100,
                        jack.restContext,
                        {
                          displayName: 'C',
                          description: 'C',
                          visibility: PUBLIC,
                          link: 'http://www.google.ca',
                          managers: NO_MANAGERS,
                          viewers: NO_VIEWERS,
                          folders: NO_FOLDERS
                        },
                        (error, linkC) => {
                          assert.notExists(error);

                          // Re-collect and verify that the aggregate expired, thus making the link a new activity, not an aggregate
                          ActivityTestUtil.collectAndGetActivityStream(
                            jack.restContext,
                            null,
                            null,
                            (error, activityStream) => {
                              assert.notExists(error);

                              // Now validate the activity stream contents
                              assert.strictEqual(activityStream.items.length, 2);

                              entity = activityStream.items[0].object;
                              assert.strictEqual(entity['oae:id'], linkC.id);

                              hasA = false;
                              hasB = false;

                              entity = activityStream.items[1].object;
                              assert.ok(entity['oae:collection']);
                              forEach((collectedEntity) => {
                                if (collectedEntity['oae:id'] === linkA.id) {
                                  hasA = true;
                                } else if (collectedEntity['oae:id'] === linkB.id) {
                                  hasB = true;
                                }
                              }, entity['oae:collection']);

                              assert.ok(hasA);
                              assert.ok(hasB);

                              return callback();
                            }
                          );
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

    /**
     * Test that verifies that the maximum aggregate expiry time will cause a new aggregate to be created even if the aggregate
     * does not fall idle.
     */
    it('verify aggregation max expiry time', (callback) => {
      // Set the aggregate max time to 1s and the idle time higher to 5s, this is to rule out the possibility of idle expiry messing up this test
      ActivityTestUtil.refreshConfiguration({ aggregateIdleExpiry: 5, aggregateMaxExpiry: 1 }, (error) => {
        assert.notExists(error);

        TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
          assert.notExists(error);

          const { 0: jack } = users;

          // This is when the createLink aggregate is born
          RestAPI.Content.createLink(
            jack.restContext,
            {
              displayName: 'A',
              description: 'A',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, linkA) => {
              assert.notExists(error);

              // Drop an aggregate in. The when collected the aggregate is 600ms old
              setTimeout(
                RestAPI.Content.createLink,
                600,
                jack.restContext,
                {
                  displayName: 'B',
                  description: 'B',
                  visibility: PUBLIC,
                  link: 'http://www.google.ca',
                  managers: NO_MANAGERS,
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error, linkB) => {
                  assert.notExists(error);

                  // Collect, then wait for expiry
                  ActivityTestUtil.collectAndGetActivityStream(jack.restContext, null, null, (error_) => {
                    assert.notExists(error_);

                    // When this content item is created, it should have crossed max expiry, causing this content create activity to be delivered individually
                    setTimeout(
                      RestAPI.Content.createLink,
                      1500,
                      jack.restContext,
                      {
                        displayName: 'C',
                        description: 'C',
                        visibility: PUBLIC,
                        link: 'http://www.google.ca',
                        managers: NO_MANAGERS,
                        viewers: NO_VIEWERS,
                        folders: NO_FOLDERS
                      },
                      (error, linkC) => {
                        assert.notExists(error);

                        ActivityTestUtil.collectAndGetActivityStream(
                          jack.restContext,
                          null,
                          null,
                          (error, activityStream) => {
                            assert.notExists(error);

                            // Now validate the activity stream contents
                            assert.strictEqual(activityStream.items.length, 2);

                            // The most recent is the individual content-create entity activity
                            let entity = activityStream.items[0].object;
                            assert.strictEqual(entity['oae:id'], linkC.id);

                            // The next oldest is the aggregated with a and b in it
                            let hasA = false;
                            let hasB = false;
                            entity = activityStream.items[1].object;
                            assert.ok(entity['oae:collection']);
                            entity['oae:collection'].forEach((collectedEntity) => {
                              if (collectedEntity['oae:id'] === linkA.id) {
                                hasA = true;
                              } else if (collectedEntity['oae:id'] === linkB.id) {
                                hasB = true;
                              }
                            });

                            assert.ok(hasA);
                            assert.ok(hasB);

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
        });
      });
    });

    /**
     * Test that verifies that when the aggregateIdleExpiry expires, the aggregate data disappears from storage.
     */
    it('verify aggregated data is automatically deleted after the idle expiry time', (callback) => {
      // Set the aggregate max time to 1s, if we add aggregate data then wait this period of time, queries to the DAO should show that this data has
      // been automatically cleaned out
      ActivityTestUtil.refreshConfiguration({ aggregateIdleExpiry: 1, aggregateMaxExpiry: 5 }, (error) => {
        assert.notExists(error);

        TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
          assert.notExists(error);

          const { 0: jack } = users;

          // Create a link then collect, which creates the aggregates
          RestAPI.Content.createLink(
            jack.restContext,
            {
              displayName: 'A',
              description: 'A',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.notExists(error);

              // Drop an aggregate in. This is when the aggregate should be initially persisted, so should expire 1s from this time
              const timePersisted = Date.now();
              ActivityTestUtil.collectAndGetActivityStream(jack.restContext, null, null, (error_) => {
                assert.notExists(error_);

                // Verify that the DAO reports the aggregate status is indeed there
                const aggregateKey = format('content-create#%s#activity#user:%s##__null__', jack.user.id, jack.user.id);

                ActivityDAO.getAggregateStatus([aggregateKey], (error, aggregateStatus) => {
                  assert.notExists(error);
                  assert.ok(aggregateStatus[aggregateKey]);
                  assert.ok(aggregateStatus[aggregateKey].lastActivity);

                  // Verify that the DAO reports the aggregated entity is indeed there at this time
                  ActivityDAO.getAggregatedEntities([aggregateKey], (error, aggregatedEntities) => {
                    const timeSincePersisted = Date.now() - timePersisted;
                    assert.notExists(error);
                    assert.ok(
                      aggregatedEntities[aggregateKey],
                      format(
                        'Expected to find aggregate entity with key: %s. Duration since persistence: %s',
                        aggregateKey,
                        timeSincePersisted
                      )
                    );
                    assert.ok(aggregatedEntities[aggregateKey].actors['user:' + jack.user.id]);
                    assert.ok(aggregatedEntities[aggregateKey].objects['content:' + link.id]);

                    // Wait the max expiry (1s) to let them disappear and verify there is no status
                    setTimeout(ActivityDAO.getAggregateStatus, 1100, [aggregateKey], (error, aggregateStatus) => {
                      assert.notExists(error);
                      assert.isEmpty(aggregateStatus);

                      // Verify the entities disappeared
                      ActivityDAO.getAggregatedEntities([aggregateKey], (error, aggregatedEntities) => {
                        assert.notExists(error);
                        assert.isUndefined(aggregatedEntities.actors);
                        assert.isUndefined(aggregatedEntities.objects);
                        assert.isUndefined(aggregatedEntities.targets);

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

    /**
     * Test that verifies that activity aggregation can be reset
     */
    it('verify aggregation can be reset', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);

        const { 0: simong, 1: mrvisser } = users;

        // Create a file as simong and share it with mrvisser. mrvisser should get an activity
        RestAPI.Content.createLink(
          simong.restContext,
          {
            displayName: 'First item',
            description: 'A',
            visibility: PUBLIC,
            link: 'http://www.google.be',
            managers: NO_MANAGERS,
            viewers: [mrvisser.user.id],
            folders: NO_FOLDERS
          },
          (error, firstContentObject) => {
            assert.notExists(error);
            ActivityTestUtil.collectAndGetActivityStream(mrvisser.restContext, null, null, (error, activityStream) => {
              assert.notExists(error);
              // Sanity check that the create content activity is in mrvisser's activity stream
              ActivityTestUtil.assertActivity(
                activityStream.items[0],
                'content-create',
                'create',
                simong.user.id,
                firstContentObject.id,
                mrvisser.user.id
              );

              // Reset the aggregator for mrvisser his activity stream
              // The next content-create activity should *NOT* aggregate with the previous one
              ActivityAggregator.resetAggregationForActivityStreams([mrvisser.user.id + '#activity'], (error_) => {
                assert.notExists(error_);
                RestAPI.Content.createLink(
                  simong.restContext,
                  {
                    displayName: 'Second item',
                    description: 'A',
                    visibility: PUBLIC,
                    link: 'http://www.google.be',
                    managers: NO_MANAGERS,
                    viewers: [mrvisser.user.id],
                    folders: NO_FOLDERS
                  },
                  (error, secondContentObject) => {
                    assert.notExists(error);
                    ActivityTestUtil.collectAndGetActivityStream(
                      mrvisser.restContext,
                      null,
                      null,
                      (error, activityStream) => {
                        assert.notExists(error);

                        // As we have reset aggregation for mrvisser's activity stream, we should have 2 distinct activities for the same activity type
                        assert.strictEqual(activityStream.items.length, 2);
                        ActivityTestUtil.assertActivity(
                          activityStream.items[0],
                          'content-create',
                          'create',
                          simong.user.id,
                          secondContentObject.id,
                          mrvisser.user.id
                        );
                        ActivityTestUtil.assertActivity(
                          activityStream.items[1],
                          'content-create',
                          'create',
                          simong.user.id,
                          firstContentObject.id,
                          mrvisser.user.id
                        );

                        // Sanity check that creating another piece of content does aggregate with the latest activity
                        RestAPI.Content.createLink(
                          simong.restContext,
                          {
                            displayName: 'Third item',
                            description: 'A',
                            visibility: PUBLIC,
                            link: 'http://www.google.be',
                            managers: NO_MANAGERS,
                            viewers: [mrvisser.user.id],
                            folders: NO_FOLDERS
                          },
                          (error, thirdContentObject) => {
                            assert.notExists(error);
                            ActivityTestUtil.collectAndGetActivityStream(
                              mrvisser.restContext,
                              null,
                              null,
                              (error, activityStream) => {
                                assert.notExists(error);
                                assert.strictEqual(activityStream.items.length, 2);
                                ActivityTestUtil.assertActivity(
                                  activityStream.items[0],
                                  'content-create',
                                  'create',
                                  simong.user.id,
                                  [secondContentObject.id, thirdContentObject.id],
                                  mrvisser.user.id
                                );
                                ActivityTestUtil.assertActivity(
                                  activityStream.items[1],
                                  'content-create',
                                  'create',
                                  simong.user.id,
                                  firstContentObject.id,
                                  mrvisser.user.id
                                );

                                // Assert that the notification stream was not impacted and that all three activities aggregated
                                ActivityTestUtil.collectAndGetNotificationStream(
                                  mrvisser.restContext,
                                  null,
                                  (error, notificationStream) => {
                                    assert.notExists(error);
                                    assert.strictEqual(notificationStream.items.length, 1);
                                    ActivityTestUtil.assertActivity(
                                      notificationStream.items[0],
                                      'content-create',
                                      'create',
                                      simong.user.id,
                                      [firstContentObject.id, secondContentObject.id, thirdContentObject.id],
                                      mrvisser.user.id
                                    );

                                    // Reset mrvisser's "notification" activity stream and generate another notification
                                    // That way we can verify that resetting aggregation for a stream that contains previously aggregates activities works correctly
                                    ActivityAggregator.resetAggregationForActivityStreams(
                                      [mrvisser.user.id + '#notification'],
                                      (error__) => {
                                        assert.notExists(error__);
                                        RestAPI.Content.createLink(
                                          simong.restContext,
                                          {
                                            displayName: 'Fourth item',
                                            description: 'A',
                                            visibility: PUBLIC,
                                            link: 'http://www.google.be',
                                            managers: NO_MANAGERS,
                                            viewers: [mrvisser.user.id],
                                            folders: NO_FOLDERS
                                          },
                                          (error, fourthContentObject) => {
                                            assert.notExists(error);
                                            ActivityTestUtil.collectAndGetNotificationStream(
                                              mrvisser.restContext,
                                              null,
                                              (error, notificationStream) => {
                                                assert.notExists(error);
                                                assert.strictEqual(notificationStream.items.length, 2);
                                                ActivityTestUtil.assertActivity(
                                                  notificationStream.items[0],
                                                  'content-create',
                                                  'create',
                                                  simong.user.id,
                                                  fourthContentObject.id,
                                                  mrvisser.user.id
                                                );
                                                ActivityTestUtil.assertActivity(
                                                  notificationStream.items[1],
                                                  'content-create',
                                                  'create',
                                                  simong.user.id,
                                                  [
                                                    firstContentObject.id,
                                                    secondContentObject.id,
                                                    thirdContentObject.id
                                                  ],
                                                  mrvisser.user.id
                                                );
                                                return callback();
                                              }
                                            );
                                          }
                                        );
                                      }
                                    );
                                  }
                                );
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
          }
        );
      });
    });

    /**
     * Test that verifies that when you reset aggregation for a stream, the active aggregate keys are removed
     */
    it('verify resetting aggregation for a stream removes the correct active aggregate keys', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);

        const { 0: simong, 1: mrvisser } = users;

        // Generate an activity that ends up in two activity streams for Simon
        // That way we can verify that resetting aggregation for a specific stream doesn't impact another
        RestAPI.Content.createLink(
          mrvisser.restContext,
          {
            displayName: 'A',
            description: 'A',
            visibility: PUBLIC,
            link: 'http://www.google.be',
            managers: NO_MANAGERS,
            viewers: [simong.user.id],
            folders: NO_FOLDERS
          },
          (error_) => {
            assert.notExists(error_);
            ActivityTestUtil.collectAndGetActivityStream(simong.restContext, null, null, (error_) => {
              assert.notExists(error_);

              // Since we've performed and collected activities, there should be a key in the set of active aggregate keys
              ActivityDAO.getActiveAggregateKeysForActivityStreams(
                [simong.user.id + '#activity'],
                (error, activeAggregateKeysForActivityStream) => {
                  assert.notExists(error);
                  assert.strictEqual(activeAggregateKeysForActivityStream[0].length, 2);
                  assert.isNotEmpty(activeAggregateKeysForActivityStream[0][1]);

                  // Verify that the notification stream has a set of keys as well
                  ActivityDAO.getActiveAggregateKeysForActivityStreams(
                    [simong.user.id + '#notification'],
                    (error, activeAggregateKeysForNotificationStream) => {
                      assert.notExists(error);
                      assert.strictEqual(activeAggregateKeysForNotificationStream[0].length, 2);
                      assert.isNotEmpty(activeAggregateKeysForNotificationStream[0][1]);

                      // Assert that the aggregate keys for a notification stream are different than those of an activity stream
                      const allActivityKeys = flatten(activeAggregateKeysForActivityStream[0][1]);
                      const allNotificationKeys = flatten(activeAggregateKeysForNotificationStream[0][1]);
                      assert.isEmpty(intersection(allActivityKeys, allNotificationKeys));

                      // Reset simon's "activity" activity stream
                      ActivityAggregator.resetAggregationForActivityStreams(
                        [simong.user.id + '#activity'],
                        (error_) => {
                          assert.notExists(error_);

                          // Since we've reset the aggregation process for simon's stream, he should no longer have any active aggregate keys
                          ActivityDAO.getActiveAggregateKeysForActivityStreams(
                            [simong.user.id + '#activity'],
                            (error, activeAggregateKeysForActivityStream) => {
                              assert.notExists(error);
                              assert.strictEqual(activeAggregateKeysForActivityStream.length, 1);
                              assert.isEmpty(activeAggregateKeysForActivityStream[0][1]);

                              // Assert that we did not impact the "notification" activity stream
                              ActivityDAO.getActiveAggregateKeysForActivityStreams(
                                [simong.user.id + '#notification'],
                                (error, activeAggregateKeysForNotificationStream) => {
                                  assert.notExists(error);
                                  assert.strictEqual(activeAggregateKeysForNotificationStream[0].length, 2);
                                  assert.isNotEmpty(activeAggregateKeysForNotificationStream[0][1]);
                                  return callback();
                                }
                              );
                            }
                          );
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

  describe('Activity Stream Transience', () => {
    /**
     * Test that verifies that transient streams are not persisted
     */
    it('verify transient streams are not persisted', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: simong } = users;

        RestAPI.Content.createLink(
          simong.restContext,
          {
            displayName: 'A',
            description: 'A',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: NO_VIEWERS,
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);

            RestAPI.Content.createComment(
              simong.restContext,
              contentObject.id,
              'Comment Comment',
              null,
              (error, comment) => {
                assert.notExists(error);

                ActivityTestUtil.collectAndGetActivityStream(
                  simong.restContext,
                  null,
                  null,
                  (error, activityStream) => {
                    assert.notExists(error);

                    // Sanity check that the comment is in our activity stream
                    ActivityTestUtil.assertActivity(
                      activityStream.items[0],
                      'content-comment',
                      'post',
                      simong.user.id,
                      comment.id,
                      contentObject.id
                    );

                    // The `message` stream is transient and should NOT result in any persisted activities
                    ActivityDAO.getActivities(contentObject.id + '#message', null, 20, (error, activities) => {
                      assert.notExists(error);
                      assert.strictEqual(activities.length, 0);
                      return callback();
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
