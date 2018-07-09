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

/* eslint-disable no-unused-vars */
const assert = require('assert');
const _ = require('underscore');

const AuthzUtil = require('oae-authz/lib/util');
const PreviewConstants = require('oae-preview-processor/lib/constants');
const PrincipalsTestUtil = require('oae-principals/lib/test/util');
const RestAPI = require('oae-rest');
const { RestContext } = require('oae-rest/lib/model');
const Sanitization = require('oae-util/lib/sanitization');
const TestsUtil = require('oae-tests');

const ActivityTestsUtil = require('oae-activity/lib/test/util');
const EmailTestsUtil = require('oae-email/lib/test/util');

describe('Discussion Activity', () => {
  // Rest contexts that can be used performing rest requests
  let anonymousCamRestContext = null;
  let camAdminRestContext = null;
  let globalAdminRestContext = null;

  const suitableFiles = null;
  const suitableSizes = null;

  /**
   * Function that will fill up the tenant admin and anymous rest context
   */
  before(callback => {
    // Fill up the anonymous cam rest context
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    // Fill up global admin rest context
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    callback();
  });

  /**
   * Drain the email queue
   */
  beforeEach(callback => {
    EmailTestsUtil.clearEmailCollections(callback);
  });

  describe('Activity Entity Models', () => {
    describe('Discussions', () => {
      /**
       * Test that verifies the properties of the discussion entity
       */
      it('verify the discussion entity model contains the correct information', callback => {
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, simon) => {
          RestAPI.Discussions.createDiscussion(
            simon.restContext,
            'Goats',
            'Start discussing this sweet topic',
            'loggedin',
            null,
            null,
            (err, discussion) => {
              assert.ok(!err);
              assert.ok(discussion);

              // Simon should've received a discussion activity in his stream
              ActivityTestsUtil.collectAndGetActivityStream(
                simon.restContext,
                simon.user.id,
                null,
                (err, activityStream) => {
                  assert.ok(!err);
                  const entity = activityStream.items[0];
                  assert.strictEqual(entity['oae:activityType'], 'discussion-create');
                  assert.strictEqual(entity.verb, 'create');

                  // Assert Simon is the actor.
                  assert.strictEqual(entity.actor['oae:id'], simon.user.id);

                  // Assert the discussion is the object.
                  assert.strictEqual(entity.object['oae:id'], discussion.id);
                  assert.strictEqual(entity.object['oae:visibility'], discussion.visibility);
                  assert.strictEqual(entity.object['oae:profilePath'], discussion.profilePath);
                  assert.strictEqual(entity.object.displayName, discussion.displayName);
                  callback();
                }
              );
            }
          );
        });
      });

      /**
       * Test that verifies the properties of the discussion entity when updating.
       */
      it('verify the discussion entity model contains the correct information when updating a discussion', callback => {
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, simon) => {
          RestAPI.Discussions.createDiscussion(
            simon.restContext,
            'Bonobos',
            'Start discussing this sweet topic',
            'loggedin',
            null,
            null,
            (err, discussion) => {
              assert.ok(!err);
              assert.ok(discussion);

              RestAPI.Discussions.updateDiscussion(
                simon.restContext,
                discussion.id,
                { displayName: 'Not bonobos' },
                (err, updatedDiscussion) => {
                  assert.ok(!err);

                  // Simon should've received two entries in his stream (1 create and 1 update)
                  ActivityTestsUtil.collectAndGetActivityStream(
                    simon.restContext,
                    simon.user.id,
                    null,
                    (err, activityStream) => {
                      assert.ok(!err);
                      const entity = activityStream.items[0];
                      assert.strictEqual(entity['oae:activityType'], 'discussion-update');
                      assert.strictEqual(entity.verb, 'update');

                      // Assert Simon is the actor.
                      assert.strictEqual(entity.actor['oae:id'], simon.user.id);

                      // Assert the discussion is the object.
                      assert.strictEqual(entity.object['oae:id'], discussion.id);
                      assert.strictEqual(entity.object.displayName, 'Not bonobos');
                      assert.strictEqual(entity.object['oae:profilePath'], discussion.profilePath);

                      RestAPI.Discussions.updateDiscussion(
                        simon.restContext,
                        discussion.id,
                        { visibility: 'public' },
                        (err, updatedDiscussion) => {
                          assert.ok(!err);

                          ActivityTestsUtil.collectAndGetActivityStream(
                            simon.restContext,
                            simon.user.id,
                            null,
                            (err, activityStream) => {
                              assert.ok(!err);
                              const entity = activityStream.items[0];
                              assert.strictEqual(
                                entity['oae:activityType'],
                                'discussion-update-visibility'
                              );
                              assert.strictEqual(entity.verb, 'update');
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

    describe('Discussion messages', () => {
      /**
       * Test that verifies the properties of a discussion message
       */
      it('verify the discussion message entity model contains the correct information', callback => {
        TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simon, nico) => {
          RestAPI.Discussions.createDiscussion(
            simon.restContext,
            'Something something discussworthy',
            'Start discussing this sweet topic',
            'loggedin',
            null,
            null,
            (err, discussion) => {
              assert.ok(!err);
              assert.ok(discussion);

              RestAPI.Discussions.createMessage(
                simon.restContext,
                discussion.id,
                'My message',
                null,
                (err, message) => {
                  assert.ok(!err);
                  ActivityTestsUtil.collectAndGetActivityStream(
                    simon.restContext,
                    simon.user.id,
                    null,
                    (err, activityStream) => {
                      assert.ok(!err);
                      const entity = activityStream.items[0];
                      assert.strictEqual(entity['oae:activityType'], 'discussion-message');
                      assert.strictEqual(entity.verb, 'post');
                      // Assert Simon is the actor
                      assert.strictEqual(entity.actor['oae:id'], simon.user.id);

                      // Assert the discussion is the target
                      assert.strictEqual(entity.target['oae:id'], discussion.id);
                      assert.strictEqual(entity.target.displayName, discussion.displayName);
                      assert.strictEqual(entity.target['oae:profilePath'], discussion.profilePath);

                      // Assert the message is the object
                      assert.strictEqual(entity.object['oae:id'], message.id);
                      assert.strictEqual(entity.object['oae:messageBoxId'], message.messageBoxId);
                      assert.strictEqual(entity.object['oae:threadKey'], message.threadKey);
                      assert.strictEqual(entity.object.content, message.body);
                      assert.strictEqual(entity.object.published, message.created);
                      assert.strictEqual(entity.object.objectType, 'discussion-message');
                      assert.strictEqual(
                        entity.object.id,
                        'http://' +
                          global.oaeTests.tenants.cam.host +
                          '/api/discussion/' +
                          discussion.id +
                          '/messages/' +
                          message.created
                      );

                      // Nico replies
                      RestAPI.Discussions.createMessage(
                        nico.restContext,
                        discussion.id,
                        'A reply',
                        message.created,
                        (err, nicosMessage) => {
                          assert.ok(!err);

                          ActivityTestsUtil.collectAndGetActivityStream(
                            simon.restContext,
                            simon.user.id,
                            null,
                            (err, activityStream) => {
                              assert.ok(!err);

                              // The first item should still be a discussion-message.
                              // The object and actor will now be collections rather than a single message/person
                              const entity = activityStream.items[0];
                              assert.strictEqual(entity['oae:activityType'], 'discussion-message');

                              // The object should be an oae:collection containing 2 messages (the original message and the reply)
                              assert.strictEqual(entity.object.objectType, 'collection');
                              assert.ok(entity.object['oae:collection']);
                              assert.strictEqual(entity.object['oae:collection'].length, 2);
                              const originalMessage = _.find(
                                entity.object['oae:collection'],
                                activityMessage => {
                                  return activityMessage['oae:id'] === message.id;
                                }
                              );
                              assert.ok(originalMessage);
                              assert.strictEqual(originalMessage['oae:id'], message.id);
                              assert.strictEqual(originalMessage.content, message.body);
                              assert.strictEqual(originalMessage.author['oae:id'], simon.user.id);
                              assert.strictEqual(
                                originalMessage['oae:tenant'].alias,
                                global.oaeTests.tenants.cam.alias
                              );

                              const reply = _.find(
                                entity.object['oae:collection'],
                                activityMessage => {
                                  return activityMessage['oae:id'] === nicosMessage.id;
                                }
                              );
                              assert.ok(reply);
                              assert.strictEqual(reply['oae:id'], nicosMessage.id);
                              assert.strictEqual(
                                reply['oae:messageBoxId'],
                                nicosMessage.messageBoxId
                              );
                              assert.strictEqual(reply['oae:threadKey'], nicosMessage.threadKey);
                              assert.strictEqual(
                                reply['oae:tenant'].alias,
                                global.oaeTests.tenants.cam.alias
                              );
                              assert.strictEqual(reply.content, nicosMessage.body);
                              assert.strictEqual(reply.published, nicosMessage.created);
                              assert.strictEqual(reply.author['oae:id'], nico.user.id);
                              assert.ok(reply.inReplyTo);
                              assert.strictEqual(reply.inReplyTo['oae:id'], message.id);

                              // Verify both actors are present
                              assert.strictEqual(entity.actor.objectType, 'collection');
                              const simonEntity = _.find(
                                entity.actor['oae:collection'],
                                userEntity => {
                                  return userEntity['oae:id'] === simon.user.id;
                                }
                              );
                              assert.ok(simonEntity);
                              assert.strictEqual(simonEntity['oae:id'], simon.user.id);
                              assert.strictEqual(
                                simonEntity['oae:profilePath'],
                                '/user/' +
                                  simon.user.tenant.alias +
                                  '/' +
                                  AuthzUtil.getResourceFromId(simon.user.id).resourceId
                              );

                              const nicoEntity = _.find(
                                entity.actor['oae:collection'],
                                userEntity => {
                                  return userEntity['oae:id'] === nico.user.id;
                                }
                              );
                              assert.ok(nicoEntity);
                              assert.strictEqual(nicoEntity['oae:id'], nico.user.id);
                              assert.strictEqual(
                                nicoEntity['oae:profilePath'],
                                '/user/' +
                                  nico.user.tenant.alias +
                                  '/' +
                                  AuthzUtil.getResourceFromId(nico.user.id).resourceId
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
      });
    });
  });

  describe('Activity Routing', () => {
    /**
     * Test that verifies that a message activity is routed to the managers and recent contributers their notification stream of a private discussion item
     */
    it('verify message activity is routed to the managers and recent contributers notification stream of a private discussion', callback => {
      TestsUtil.generateTestUsers(
        camAdminRestContext,
        4,
        (err, users, simon, nico, bert, stuart) => {
          assert.ok(!err);

          RestAPI.Discussions.createDiscussion(
            simon.restContext,
            'Something something discussworthy',
            'Start discussing this sweet topic',
            'private',
            [nico.user.id],
            [bert.user.id, stuart.user.id],
            (err, discussion) => {
              assert.ok(!err);

              RestAPI.Discussions.createMessage(
                bert.restContext,
                discussion.id,
                'Message A',
                null,
                (err, message) => {
                  assert.ok(!err);

                  // Assert that the managers got it
                  ActivityTestsUtil.collectAndGetNotificationStream(
                    simon.restContext,
                    null,
                    (err, activityStream) => {
                      assert.ok(!err);
                      assert.ok(
                        _.find(activityStream.items, activity => {
                          return activity['oae:activityType'] === 'discussion-message';
                        })
                      );

                      ActivityTestsUtil.collectAndGetNotificationStream(
                        nico.restContext,
                        null,
                        (err, activityStream) => {
                          assert.ok(!err);
                          assert.ok(
                            _.find(activityStream.items, activity => {
                              return activity['oae:activityType'] === 'discussion-message';
                            })
                          );

                          // Create another message and assert that both the managers and the recent contributers get a notification
                          RestAPI.Discussions.createMessage(
                            nico.restContext,
                            discussion.id,
                            'Message A',
                            null,
                            (err, message) => {
                              assert.ok(!err);

                              // Because Bert made a message previously, he should get a notification as well
                              ActivityTestsUtil.collectAndGetNotificationStream(
                                bert.restContext,
                                null,
                                (err, activityStream) => {
                                  assert.ok(!err);
                                  const messageActivities = _.filter(
                                    activityStream.items,
                                    activity => {
                                      return activity['oae:activityType'] === 'discussion-message';
                                    }
                                  );
                                  assert.ok(messageActivities.length, 2);

                                  // Sanity-check that the managers got it as well
                                  ActivityTestsUtil.collectAndGetNotificationStream(
                                    nico.restContext,
                                    null,
                                    (err, activityStream) => {
                                      assert.ok(!err);
                                      const messageActivities = _.filter(
                                        activityStream.items,
                                        activity => {
                                          return (
                                            activity['oae:activityType'] === 'discussion-message'
                                          );
                                        }
                                      );
                                      assert.ok(messageActivities.length, 2);

                                      ActivityTestsUtil.collectAndGetNotificationStream(
                                        simon.restContext,
                                        null,
                                        (err, activityStream) => {
                                          assert.ok(!err);
                                          const messageActivities = _.filter(
                                            activityStream.items,
                                            activity => {
                                              return (
                                                activity['oae:activityType'] ===
                                                'discussion-message'
                                              );
                                            }
                                          );
                                          assert.ok(messageActivities.length, 2);

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

  describe('Discussion Activities', () => {
    /**
     * Test that verifies when a discussion is updated, an activity is generated for the action
     */
    it('verify updating a discussion results in an activity being generated', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        const simon = _.values(users)[0];

        // Create a discussion to share
        RestAPI.Discussions.createDiscussion(
          simon.restContext,
          'Something something discussworthy',
          'Start discussing this sweet topic',
          'loggedin',
          null,
          null,
          (err, discussion) => {
            assert.ok(!err);
            assert.ok(discussion);

            RestAPI.Discussions.updateDiscussion(
              simon.restContext,
              discussion.id,
              { displayName: 'Blah!' },
              (err, discussionProfile) => {
                assert.ok(!err);
                assert.ok(discussionProfile);

                // Collect the activities
                ActivityTestsUtil.collectAndGetActivityStream(
                  simon.restContext,
                  simon.user.id,
                  null,
                  (err, activityStream) => {
                    assert.ok(!err);

                    // Verify the discussion-share activity is the newest one in the feed
                    const activity = activityStream.items[0];
                    assert.ok(activity);
                    assert.strictEqual(activity['oae:activityType'], 'discussion-update');
                    assert.strictEqual(activity.actor['oae:id'], simon.user.id);
                    assert.strictEqual(activity.object['oae:id'], discussion.id);

                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies when a discussion is shared, an activity is generated for the action
     */
    it('verify sharing a discussion results in an activity being generated', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
        const simon = _.values(users)[0];
        const nico = _.values(users)[1];

        // Create a discussion to share
        RestAPI.Discussions.createDiscussion(
          simon.restContext,
          'Something something discussworthy',
          'Start discussing this sweet topic',
          'loggedin',
          null,
          null,
          (err, discussion) => {
            assert.ok(!err);
            assert.ok(discussion);

            // Simon shares the discussion with nicolaas
            RestAPI.Discussions.shareDiscussion(
              simon.restContext,
              discussion.id,
              [nico.user.id],
              err => {
                assert.ok(!err);

                // Collect the activities
                ActivityTestsUtil.collectAndGetActivityStream(
                  simon.restContext,
                  simon.user.id,
                  null,
                  (err, activityStream) => {
                    assert.ok(!err);

                    // Verify the discussion-share activity is the newest one in the feed
                    const activity = activityStream.items[0];
                    assert.ok(activity);
                    assert.strictEqual(activity['oae:activityType'], 'discussion-share');
                    assert.strictEqual(activity.actor['oae:id'], simon.user.id);
                    assert.strictEqual(activity.object['oae:id'], discussion.id);
                    assert.strictEqual(activity.target['oae:id'], nico.user.id);

                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies when a user is added as a manager to a discussion, a share activity is generated
     */
    it('verify adding user by updating permissions of a discussion results in a share activity being generated', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simon, branden) => {
        assert.ok(!err);

        // Create a discussion to share
        RestAPI.Discussions.createDiscussion(
          simon.restContext,
          'Something something discussworthy',
          'Start discussing this sweet topic',
          'loggedin',
          null,
          null,
          (err, discussion) => {
            assert.ok(!err);
            assert.ok(discussion);

            const memberUpdates = {};
            memberUpdates[branden.user.id] = 'member';

            // Simon shares the discussion with Branden
            RestAPI.Discussions.updateDiscussionMembers(
              simon.restContext,
              discussion.id,
              memberUpdates,
              err => {
                assert.ok(!err);

                // Collect the activities
                ActivityTestsUtil.collectAndGetActivityStream(
                  simon.restContext,
                  simon.user.id,
                  null,
                  (err, activityStream) => {
                    assert.ok(!err);

                    // Verify the discussion-share activity is the newest one in the feed
                    const activity = activityStream.items[0];
                    assert.ok(activity);
                    assert.strictEqual(activity['oae:activityType'], 'discussion-share');
                    assert.strictEqual(activity.actor['oae:id'], simon.user.id);
                    assert.strictEqual(activity.object['oae:id'], discussion.id);
                    assert.strictEqual(activity.target['oae:id'], branden.user.id);

                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies when a user is being promoted to a manager in to a discussion, a discussion-update-member-role activity is generated
     */
    it('verify updating user role of a discussion results in a discussion-update-member-role activity being generated', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simon, branden) => {
        assert.ok(!err);

        // Create a discussion with a member
        RestAPI.Discussions.createDiscussion(
          simon.restContext,
          'Something something discussworthy',
          'Start discussing this sweet topic',
          'loggedin',
          null,
          [branden.user.id],
          (err, discussion) => {
            assert.ok(!err);
            assert.ok(discussion);

            // Simon promotes Branden to manager
            const memberUpdates = {};
            memberUpdates[branden.user.id] = 'manager';
            RestAPI.Discussions.updateDiscussionMembers(
              simon.restContext,
              discussion.id,
              memberUpdates,
              err => {
                assert.ok(!err);

                // Verify the discussion-update-member-role activity is present
                ActivityTestsUtil.collectAndGetActivityStream(
                  simon.restContext,
                  simon.user.id,
                  null,
                  (err, activityStream) => {
                    assert.ok(!err);
                    ActivityTestsUtil.assertActivity(
                      activityStream.items[0],
                      'discussion-update-member-role',
                      'update',
                      simon.user.id,
                      branden.user.id,
                      discussion.id
                    );
                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies when a user adds a discussion to their library, an activity is generated
     */
    it('verify adding a discussion to your library results in an discussion-ad-to-library activity being generated', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
        const simon = _.values(users)[0];
        const nico = _.values(users)[1];

        // Create a discussion to share
        RestAPI.Discussions.createDiscussion(
          simon.restContext,
          'Something something discussworthy',
          'Start discussing this sweet topic',
          'loggedin',
          null,
          null,
          (err, discussion) => {
            assert.ok(!err);
            assert.ok(discussion);

            // Nicolaas adds the discussion to his library
            RestAPI.Discussions.shareDiscussion(
              nico.restContext,
              discussion.id,
              [nico.user.id],
              err => {
                assert.ok(!err);

                // Collect the activities
                ActivityTestsUtil.collectAndGetActivityStream(
                  nico.restContext,
                  nico.user.id,
                  null,
                  (err, activityStream) => {
                    assert.ok(!err);

                    // Verify the discussion-share activity is the newest one in the feed
                    const activity = activityStream.items[0];
                    assert.ok(activity);
                    assert.strictEqual(activity['oae:activityType'], 'discussion-add-to-library');
                    assert.strictEqual(activity.actor['oae:id'], nico.user.id);
                    assert.strictEqual(activity.object['oae:id'], discussion.id);

                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });
  });

  describe('Email', () => {
    /**
     * Test that verifies an email is sent to the discussion managers when someone posts a message, and that private users
     * are appropriately scrubbed.
     */
    it('verify discussion message email and privacy', callback => {
      TestsUtil.generateTestUsers(
        camAdminRestContext,
        3,
        (err, users, mrvisser, simong, nicolaas) => {
          assert.ok(!err);

          // Simon is private and mrvisser is public
          const simongUpdate = {
            visibility: 'private',
            publicAlias: 'swappedFromPublicAlias'
          };

          // Update Simon
          PrincipalsTestUtil.assertUpdateUserSucceeds(
            simong.restContext,
            simong.user.id,
            simongUpdate,
            () => {
              // Create the discussion
              RestAPI.Discussions.createDiscussion(
                mrvisser.restContext,
                'A talk',
                'about computers',
                'public',
                [],
                [],
                (err, discussion) => {
                  assert.ok(!err);

                  // Post a new message
                  RestAPI.Discussions.createMessage(
                    simong.restContext,
                    discussion.id,
                    '<script>Nice discussion.</script>\n\nWould read again',
                    null,
                    (err, simongMessage) => {
                      assert.ok(!err);

                      EmailTestsUtil.collectAndFetchAllEmails(emails => {
                        // There should be exactly one email, the one sent to mrvisser (manager of discussion receives discussion-message notification)
                        assert.strictEqual(emails.length, 1);

                        const stringEmail = JSON.stringify(emails[0]);
                        const email = emails[0];

                        // Sanity check that the email is to mrvisser
                        assert.strictEqual(email.to[0].address, mrvisser.user.email);

                        // Ensure that the subject of the email contains the poster's name
                        assert.notStrictEqual(email.subject.indexOf('swappedFromPublicAlias'), -1);

                        // Ensure some data expected to be in the email is there
                        assert.notStrictEqual(
                          stringEmail.indexOf(simong.restContext.hostHeader),
                          -1
                        );
                        assert.notStrictEqual(stringEmail.indexOf(discussion.profilePath), -1);
                        assert.notStrictEqual(stringEmail.indexOf(discussion.displayName), -1);

                        // Ensure simong's private info is nowhere to be found
                        assert.strictEqual(stringEmail.indexOf(simong.user.displayName), -1);
                        assert.strictEqual(stringEmail.indexOf(simong.user.email), -1);
                        assert.strictEqual(stringEmail.indexOf(simong.user.locale), -1);

                        // The email should contain the public alias
                        assert.notStrictEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

                        // The message should have escaped the HTML content in the original message
                        assert.strictEqual(
                          stringEmail.indexOf('<script>Nice discussion.</script>'),
                          -1
                        );

                        // The new line characters should've been converted into paragraphs
                        assert.notStrictEqual(stringEmail.indexOf('Would read again</p>'), -1);

                        // Send a message as nicolaas and ensure the recent commenter, simong receives an email about it
                        RestAPI.Discussions.createMessage(
                          nicolaas.restContext,
                          discussion.id,
                          'I have a computer, too',
                          null,
                          (err, nicolaasMessage) => {
                            assert.ok(!err);

                            EmailTestsUtil.collectAndFetchAllEmails(emails => {
                              // There should be 2 emails this time, one to the manager and one to the recent commenter, simong
                              assert.strictEqual(emails.length, 2);

                              const emailAddresses = [
                                emails[0].to[0].address,
                                emails[1].to[0].address
                              ];
                              assert.ok(_.contains(emailAddresses, simong.user.email));
                              assert.ok(_.contains(emailAddresses, mrvisser.user.email));
                              return callback();
                            });
                          }
                        );
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies an email is sent to the members when a discussion is created, and that private users are
     * appropriately scrubbed.
     */
    it('verify discussion-create email and privacy', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, mrvisser, simong) => {
        assert.ok(!err);

        // Simon is private and mrvisser is public
        const simongUpdate = {
          visibility: 'private',
          publicAlias: 'swappedFromPublicAlias'
        };

        // Update Simon
        PrincipalsTestUtil.assertUpdateUserSucceeds(
          simong.restContext,
          simong.user.id,
          simongUpdate,
          () => {
            // Create the link, sharing it with mrvisser during the creation step. We will ensure he gets an email about it
            RestAPI.Discussions.createDiscussion(
              simong.restContext,
              'A talk',
              'not about computers',
              'public',
              [],
              [mrvisser.user.id],
              (err, discussion) => {
                assert.ok(!err);

                // Mrvisser should get an email, with simong's information scrubbed
                EmailTestsUtil.collectAndFetchAllEmails(emails => {
                  // There should be exactly one email, the one sent to mrvisser
                  assert.strictEqual(emails.length, 1);

                  const stringEmail = JSON.stringify(emails[0]);
                  const email = emails[0];

                  // Sanity check that the email is to mrvisser
                  assert.strictEqual(email.to[0].address, mrvisser.user.email);

                  // Ensure some data expected to be in the email is there
                  assert.notStrictEqual(stringEmail.indexOf(simong.restContext.hostHeader), -1);
                  assert.notStrictEqual(stringEmail.indexOf(discussion.profilePath), -1);
                  assert.notStrictEqual(stringEmail.indexOf(discussion.displayName), -1);

                  // Ensure simong's private info is nowhere to be found
                  assert.strictEqual(stringEmail.indexOf(simong.user.displayName), -1);
                  assert.strictEqual(stringEmail.indexOf(simong.user.email), -1);
                  assert.strictEqual(stringEmail.indexOf(simong.user.locale), -1);

                  // The email should contain the public alias
                  assert.notStrictEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

                  return callback();
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies an email is sent to the target users when a discussion is shared, and that private users are
     * appropriately scrubbed.
     */
    it('verify discussion-share email and privacy', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, mrvisser, simong) => {
        assert.ok(!err);

        // Simon is private and mrvisser is public
        const simongUpdate = {
          visibility: 'private',
          publicAlias: 'swappedFromPublicAlias'
        };

        // Update Simon
        PrincipalsTestUtil.assertUpdateUserSucceeds(
          simong.restContext,
          simong.user.id,
          simongUpdate,
          () => {
            // Create the link, then share it with mrvisser. We will ensure that mrvisser gets the email about the share
            RestAPI.Discussions.createDiscussion(
              simong.restContext,
              'A talk',
              'about the moon',
              'public',
              [],
              [],
              (err, discussion) => {
                assert.ok(!err);

                // Collect the createLink activity
                EmailTestsUtil.collectAndFetchAllEmails(emails => {
                  RestAPI.Discussions.shareDiscussion(
                    simong.restContext,
                    discussion.id,
                    [mrvisser.user.id],
                    err => {
                      assert.ok(!err);

                      // Mrvisser should get an email, with simong's information scrubbed
                      EmailTestsUtil.collectAndFetchAllEmails(emails => {
                        // There should be exactly one email, the one sent to mrvisser
                        assert.strictEqual(emails.length, 1);

                        const stringEmail = JSON.stringify(emails[0]);
                        const email = emails[0];

                        // Sanity check that the email is to mrvisser
                        assert.strictEqual(email.to[0].address, mrvisser.user.email);

                        // Ensure some data expected to be in the email is there
                        assert.notStrictEqual(
                          stringEmail.indexOf(simong.restContext.hostHeader),
                          -1
                        );
                        assert.notStrictEqual(stringEmail.indexOf(discussion.profilePath), -1);
                        assert.notStrictEqual(stringEmail.indexOf(discussion.displayName), -1);

                        // Ensure simong's private info is nowhere to be found
                        assert.strictEqual(stringEmail.indexOf(simong.user.displayName), -1);
                        assert.strictEqual(stringEmail.indexOf(simong.user.email), -1);
                        assert.strictEqual(stringEmail.indexOf(simong.user.locale), -1);

                        // The email should contain the public alias
                        assert.notStrictEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);
                        return callback();
                      });
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
