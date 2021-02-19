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

import { assert } from 'chai';

import { ActivityConstants } from 'oae-activity/lib/constants';
import { PrincipalsConstants } from 'oae-principals/lib/constants';
import { ContentConstants } from 'oae-content/lib/constants';
import { DiscussionsConstants } from 'oae-discussions/lib/constants';
import { FollowingConstants } from 'oae-following/lib/constants';

import {
  assertActivity,
  collectAndGetActivityStream,
  collectAndGetNotificationStream
} from 'oae-activity/lib/test/util';
import * as EmailTestsUtil from 'oae-email/lib/test/util';
import * as RestAPI from 'oae-rest';
import { generateTestUsers, createTenantAdminRestContext } from 'oae-tests/lib/util';
import * as FollowingTestsUtil from 'oae-following/lib/test/util';

const PUBLIC = 'public';

describe('Following Activity', () => {
  let camAdminRestContext = null;
  let gtAdminRestContext = null;

  /**
   * Function that will fill up the anonymous and admin REST context
   */
  before((callback) => {
    camAdminRestContext = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    return callback();
  });

  /*!
   * Clear any pending/collected emails so they don't impact the following tests
   */
  beforeEach(EmailTestsUtil.clearEmailCollections);

  /*!
   * Verify the contents of the follow activity
   *
   * @param  {Activity}   followActivity      The activity whose content to verify
   * @param  {String}     actorUserId         The id of the user that should be the actor
   * @param  {String}     objectUserId        The id of the user that should be the object
   */
  const _assertFollowActivity = function (followActivity, actorUserId, objectUserId) {
    assertActivity(
      followActivity,
      FollowingConstants.activity.ACTIVITY_FOLLOW,
      ActivityConstants.verbs.FOLLOW,
      actorUserId,
      objectUserId
    );
  };

  /**
   * Test that verifies following a user results in both the follower and following users receiving the follow activity
   */
  it('verify following user and followed user get a follow activity', (callback) => {
    // Create 2 users, one following the other
    FollowingTestsUtil.createFollowerAndFollowed(camAdminRestContext, (follower, followed) => {
      // Get the follower's activity stream and ensure the activity is there
      collectAndGetActivityStream(follower.restContext, follower.user.id, null, (error, response) => {
        assert.notExists(error);
        _assertFollowActivity(response.items[0], follower.user.id, followed.user.id);

        // Get the followed user's activity stream and ensure the activity is there
        collectAndGetActivityStream(followed.restContext, followed.user.id, null, (error, response) => {
          assert.notExists(error);
          _assertFollowActivity(response.items[0], follower.user.id, followed.user.id);
          return callback();
        });
      });
    });
  });

  /**
   * Test that verifies if someone is following another user, no activity is generated when they try and re-follow
   */
  it('verify no activity is generated when user follows user they already follow', (callback) => {
    // Create 2 users, one following the other
    FollowingTestsUtil.createFollowerAndFollowed(camAdminRestContext, (follower, followed) => {
      // Create a group with the followed user and make sure the follower gets it
      RestAPI.Group.createGroup(
        followed.restContext,
        'Im being followed',
        null,
        'public',
        'yes',
        [],
        [],
        (error, group) => {
          assert.notExists(error);

          // Ensure the follower user got the activity
          collectAndGetActivityStream(follower.restContext, follower.user.id, null, (error, response) => {
            assert.notExists(error);
            assertActivity(
              response.items[0],
              PrincipalsConstants.activity.ACTIVITY_GROUP_CREATE,
              ActivityConstants.verbs.CREATE,
              followed.user.id,
              group.id
            );

            // Attempt to follow the followed user
            RestAPI.Following.follow(follower.restContext, followed.user.id, (error_) => {
              assert.notExists(error_);

              // Ensure the follower's latest activity is still the group create one
              collectAndGetActivityStream(follower.restContext, follower.user.id, null, (error, response) => {
                assert.notExists(error);
                assertActivity(
                  response.items[0],
                  PrincipalsConstants.activity.ACTIVITY_GROUP_CREATE,
                  ActivityConstants.verbs.CREATE,
                  followed.user.id,
                  group.id
                );
                return callback();
              });
            });
          });
        }
      );
    });
  });

  /**
   * Test that verifies when a followed user performs a "create" action (create content, create discussion, create
   * group), the activities are delivered to users that follow the user. Those activities are identified as:
   *
   *  * Create content item
   *  * Create group
   *  * Create discussion
   */
  it('verify followers get create activities performed by the followed user', (callback) => {
    // Create 2 users, one following the other
    FollowingTestsUtil.createFollowerAndFollowed(camAdminRestContext, (follower, followed) => {
      // Create a group with the followed user and make sure the follower gets it
      RestAPI.Group.createGroup(
        followed.restContext,
        'Im being followed',
        null,
        'public',
        'yes',
        [],
        [],
        (error, group) => {
          assert.notExists(error);

          // Ensure the follower user got the activity
          collectAndGetActivityStream(follower.restContext, follower.user.id, null, (error, response) => {
            assert.notExists(error);
            assertActivity(
              response.items[0],
              PrincipalsConstants.activity.ACTIVITY_GROUP_CREATE,
              ActivityConstants.verbs.CREATE,
              followed.user.id,
              group.id
            );

            // Create a content item with the followed user and make sure the follower gets it
            RestAPI.Content.createLink(
              followed.restContext,
              {
                displayName: 'Im being followed',
                description: null,
                visibility: PUBLIC,
                link: 'http://www.google.ca',
                managers: [],
                viewers: [],
                folders: []
              },
              (error, link) => {
                assert.notExists(error);

                // Ensure the follower user got the activity
                collectAndGetActivityStream(follower.restContext, follower.user.id, null, (error, response) => {
                  assert.notExists(error);
                  assertActivity(
                    response.items[0],
                    ContentConstants.activity.ACTIVITY_CONTENT_CREATE,
                    ActivityConstants.verbs.CREATE,
                    followed.user.id,
                    link.id
                  );

                  // Create a discussion with the followed user and make sure the follower gets it
                  RestAPI.Discussions.createDiscussion(
                    followed.restContext,
                    'Im being followed',
                    'no seriously',
                    'public',
                    [],
                    [],
                    (error, discussion) => {
                      assert.notExists(error);

                      // Ensure the follower user got the activity
                      collectAndGetActivityStream(follower.restContext, follower.user.id, null, (error, response) => {
                        assert.notExists(error);
                        assertActivity(
                          response.items[0],
                          DiscussionsConstants.activity.ACTIVITY_DISCUSSION_CREATE,
                          ActivityConstants.verbs.CREATE,
                          followed.user.id,
                          discussion.id
                        );
                        return callback();
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
   * Test that verifies when a followed user performs a "share" or "add to group" action, the followers receive
   * an activity for it. Those activities are identified as:
   *
   *  * Share content item (if the followed user is either the actor or the target)
   *  * Share discussion (if the followed user is either the actor or the target)
   *  * Add member to group (if the followed user is either the actor or the target)
   */
  it('verify followers get share/add activities destined for the followed user', (callback) => {
    // Create 2 users, one following the other, as well as 2 more that will be used for sharing
    FollowingTestsUtil.createFollowerAndFollowed(camAdminRestContext, (follower, followed) => {
      generateTestUsers(camAdminRestContext, 1, (error, testUsers) => {
        assert.notExists(error);
        const { 0: nico } = testUsers;

        // Create 2 groups, one to which the followed user will add a member, one to which the followed user will be added as a member
        RestAPI.Group.createGroup(
          followed.restContext,
          'test group 0',
          null,
          'public',
          'yes',
          [],
          [],
          (error, group0) => {
            assert.notExists(error);
            RestAPI.Group.createGroup(
              nico.restContext,
              'test group 1',
              null,
              'public',
              'yes',
              [],
              [],
              (error, group1) => {
                assert.notExists(error);

                // Create 2 content items, one the followed user will share, one the followed user will have shared with them
                RestAPI.Content.createLink(
                  followed.restContext,
                  {
                    displayName: 'test content 0',
                    description: null,
                    visibility: PUBLIC,
                    link: 'http://www.google.ca',
                    managers: [],
                    viewers: [],
                    folders: []
                  },
                  (error, link0) => {
                    assert.notExists(error);
                    RestAPI.Content.createLink(
                      nico.restContext,
                      {
                        displayName: 'test content 1',
                        description: null,
                        visibility: PUBLIC,
                        link: 'http://www.yahoo.ca',
                        managers: [],
                        viewers: [],
                        folders: []
                      },
                      (error, link1) => {
                        assert.notExists(error);

                        // Create 2 discussions, one the followed user will share, one the followed user will have shared with them
                        RestAPI.Discussions.createDiscussion(
                          followed.restContext,
                          'test discussion 0',
                          'test discussion 0',
                          'public',
                          [],
                          [],
                          (error, discussion0) => {
                            assert.notExists(error);
                            RestAPI.Discussions.createDiscussion(
                              nico.restContext,
                              'test discussion 1',
                              'test discussion 1',
                              'public',
                              [],
                              [],
                              (error, discussion1) => {
                                assert.notExists(error);

                                // Followed user adds nico to the first group
                                let updateMembers = {};
                                updateMembers[nico.user.id] = 'member';
                                RestAPI.Group.setGroupMembers(
                                  followed.restContext,
                                  group0.id,
                                  updateMembers,
                                  (error_) => {
                                    assert.notExists(error_);

                                    // Ensure the following user **does not** get this activity. To do this, we ensure the latest activity is still the discussion they created earlier
                                    collectAndGetActivityStream(
                                      follower.restContext,
                                      follower.user.id,
                                      null,
                                      (error, response) => {
                                        assert.notExists(error);
                                        assertActivity(
                                          response.items[0],
                                          DiscussionsConstants.activity.ACTIVITY_DISCUSSION_CREATE,
                                          ActivityConstants.verbs.CREATE,
                                          followed.user.id,
                                          discussion0.id
                                        );

                                        // Nico adds the followed user to the second group
                                        updateMembers = {};
                                        updateMembers[followed.user.id] = 'member';
                                        RestAPI.Group.setGroupMembers(
                                          nico.restContext,
                                          group1.id,
                                          updateMembers,
                                          (error_) => {
                                            assert.notExists(error_);

                                            // Ensure the following user got this activity
                                            collectAndGetActivityStream(
                                              follower.restContext,
                                              follower.user.id,
                                              null,
                                              (error, response) => {
                                                assert.notExists(error);
                                                assertActivity(
                                                  response.items[0],
                                                  PrincipalsConstants.activity.ACTIVITY_GROUP_ADD_MEMBER,
                                                  ActivityConstants.verbs.ADD,
                                                  nico.user.id,
                                                  followed.user.id,
                                                  group1.id
                                                );

                                                // Followed user shares the first link with nico
                                                RestAPI.Content.shareContent(
                                                  followed.restContext,
                                                  link0.id,
                                                  [nico.user.id],
                                                  (error_) => {
                                                    assert.notExists(error_);

                                                    // Ensure the follower **does not** get this activity in their feed. To do this, we ensure the latest activity is still the add group member activity from before
                                                    collectAndGetActivityStream(
                                                      follower.restContext,
                                                      follower.user.id,
                                                      null,
                                                      (error, response) => {
                                                        assert.notExists(error);
                                                        assertActivity(
                                                          response.items[0],
                                                          PrincipalsConstants.activity.ACTIVITY_GROUP_ADD_MEMBER,
                                                          ActivityConstants.verbs.ADD,
                                                          nico.user.id,
                                                          followed.user.id,
                                                          group1.id
                                                        );

                                                        // Nico shares the second link with the followed user
                                                        RestAPI.Content.shareContent(
                                                          nico.restContext,
                                                          link1.id,
                                                          [followed.user.id],
                                                          (error_) => {
                                                            assert.notExists(error_);

                                                            // Ensure the follower gets this activity in their feed
                                                            collectAndGetActivityStream(
                                                              follower.restContext,
                                                              follower.user.id,
                                                              null,
                                                              (error, response) => {
                                                                assert.notExists(error);
                                                                assertActivity(
                                                                  response.items[0],
                                                                  ContentConstants.activity.ACTIVITY_CONTENT_SHARE,
                                                                  ActivityConstants.verbs.SHARE,
                                                                  nico.user.id,
                                                                  link1.id,
                                                                  followed.user.id
                                                                );

                                                                // Followed user shares the first discussion with nico
                                                                RestAPI.Discussions.shareDiscussion(
                                                                  followed.restContext,
                                                                  discussion0.id,
                                                                  [nico.user.id],
                                                                  (error_) => {
                                                                    assert.notExists(error_);

                                                                    // Ensure the follower **does not** get this activity in their feed. To do this, we ensure the latest activity is still the content share activity from before
                                                                    collectAndGetActivityStream(
                                                                      follower.restContext,
                                                                      follower.user.id,
                                                                      null,
                                                                      (error, response) => {
                                                                        assert.notExists(error);
                                                                        assertActivity(
                                                                          response.items[0],
                                                                          ContentConstants.activity
                                                                            .ACTIVITY_CONTENT_SHARE,
                                                                          ActivityConstants.verbs.SHARE,
                                                                          nico.user.id,
                                                                          link1.id,
                                                                          followed.user.id
                                                                        );

                                                                        // Nico shares the second discussion with the followed user
                                                                        RestAPI.Discussions.shareDiscussion(
                                                                          nico.restContext,
                                                                          discussion1.id,
                                                                          [followed.user.id],
                                                                          (error_) => {
                                                                            assert.notExists(error_);

                                                                            // Ensure the follower gets this activity in their feed
                                                                            collectAndGetActivityStream(
                                                                              follower.restContext,
                                                                              follower.user.id,
                                                                              null,
                                                                              (error, response) => {
                                                                                assert.notExists(error);
                                                                                assertActivity(
                                                                                  response.items[0],
                                                                                  DiscussionsConstants.activity
                                                                                    .ACTIVITY_DISCUSSION_SHARE,
                                                                                  ActivityConstants.verbs.SHARE,
                                                                                  nico.user.id,
                                                                                  discussion1.id,
                                                                                  followed.user.id
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

  /**
   * Test that verifies if a followed user becomes loggedin, activity is no longer routed to followers from other tenants
   */
  it('verify followers from external tenants no longer receive activity for users who become loggedin', (callback) => {
    generateTestUsers(camAdminRestContext, 1, (error, users) => {
      assert.notExists(error);
      const { 0: camUser } = users;

      generateTestUsers(gtAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: gtUser } = users;

        // GT user will follow the public user
        RestAPI.Following.follow(gtUser.restContext, camUser.user.id, (error_) => {
          assert.notExists(error_);

          // Afterward, Cam user sets their visibility to loggedin
          RestAPI.User.updateUser(camUser.restContext, camUser.user.id, { visibility: 'loggedin' }, (error_) => {
            assert.notExists(error_);

            // Then, Cam user creates a content item, which will create an activity that would have been sent to GT user if their privacy wasn't
            // changed to loggedin
            RestAPI.Content.createLink(
              camUser.restContext,
              {
                displayName: 'Google',
                description: 'Google',
                visibility: PUBLIC,
                link: 'http://www.google.ca',
                managers: [],
                viewers: [],
                folders: []
              },
              (error /* , link */) => {
                assert.notExists(error);

                // Verify that GT user did not receive the content creation activity
                collectAndGetActivityStream(gtUser.restContext, null, null, (error, response) => {
                  assert.notExists(error);

                  // Ensure the GT user did not get the activity by ensuring their latest activity is the follow activity they performed
                  assertActivity(
                    response.items[0],
                    FollowingConstants.activity.ACTIVITY_FOLLOW,
                    ActivityConstants.verbs.FOLLOW,
                    gtUser.user.id,
                    camUser.user.id
                  );
                  return callback();
                });
              }
            );
          });
        });
      });
    });
  });

  /**
   * Test that verifies if a followed user becomes private, activity is no longer routed to followers
   */
  it('verify followers from external tenants no longer receive activity for users who become private', (callback) => {
    FollowingTestsUtil.createFollowerAndFollowed(camAdminRestContext, (follower, followed) => {
      // Afterward, camUser sets their visibility to loggedin
      RestAPI.User.updateUser(followed.restContext, followed.user.id, { visibility: 'private' }, (error) => {
        assert.notExists(error);

        // Then, followed user creates a content item, which will create an activity that would have been sent to the follower if their
        // privacy wasn't changed to private
        RestAPI.Content.createLink(
          followed.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: [],
            viewers: [],
            folders: []
          },
          (error /* , link */) => {
            assert.notExists(error);

            // Verify that follower user did not receive the content creation activity
            collectAndGetActivityStream(follower.restContext, null, null, (error, response) => {
              assert.notExists(error);

              // Ensure the gtUser did not get the activity by ensuring their latest activity is the follow activity they performed
              assertActivity(
                response.items[0],
                FollowingConstants.activity.ACTIVITY_FOLLOW,
                ActivityConstants.verbs.FOLLOW,
                follower.user.id,
                followed.user.id
              );
              return callback();
            });
          }
        );
      });
    });
  });

  /**
   * Test that verifies following notification and emails
   */
  it('verify user gets notification and email when a user follows them', (callback) => {
    generateTestUsers(camAdminRestContext, 3, (error, users) => {
      assert.notExists(error);
      const { 0: followed, 1: follower, 2: otherFollower } = users;

      // Follow the user
      RestAPI.Following.follow(follower.restContext, followed.user.id, (error_) => {
        assert.notExists(error_);

        // Fetch the emails and ensure the followed user got one
        EmailTestsUtil.collectAndFetchAllEmails((messages) => {
          assert.strictEqual(messages.length, 1);
          assert.strictEqual(messages[0].to[0].address, followed.user.email);
          assert.notStrictEqual(messages[0].html.indexOf(follower.user.profilePath), -1);

          collectAndGetNotificationStream(followed.restContext, null, (error, response) => {
            assert.notExists(error);

            // Only the follow activity should be in the stream
            assert.strictEqual(response.items.length, 1);
            assertActivity(response.items[0], 'following-follow', 'follow', follower.user.id, followed.user.id);

            // Ensure the unread notification count was set to 1
            RestAPI.User.getMe(followed.restContext, (error, me) => {
              assert.notExists(error);
              assert.strictEqual(me.notificationsUnread, 1);

              // Another user follows our user
              RestAPI.Following.follow(otherFollower.restContext, followed.user.id, (error_) => {
                assert.notExists(error_);

                // Get the notifications for the followed user
                collectAndGetNotificationStream(followed.restContext, null, (error, response) => {
                  assert.notExists(error);

                  // There should be only 1 (aggregated) following-follow activity in the notification stream
                  assert.strictEqual(response.items.length, 1);
                  assertActivity(
                    response.items[0],
                    'following-follow',
                    'follow',
                    [follower.user.id, otherFollower.user.id],
                    followed.user.id
                  );

                  // Ensure the unread notification count is still 1
                  RestAPI.User.getMe(followed.restContext, (error, me) => {
                    assert.notExists(error);
                    assert.strictEqual(me.notificationsUnread, 1);
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

  /**
   * Test that verifies that users get a single aggregated activity in their email when multiple users follow them
   */
  it('verify users get a single aggregated activity in their email when 1 or multiple users follow them', (callback) => {
    generateTestUsers(camAdminRestContext, 4, (error, users) => {
      assert.notExists(error);
      const { 0: simon, 1: branden, 2: nico, 3: bert } = users;

      // Both Branden and Nico will follow Simon
      RestAPI.Following.follow(branden.restContext, simon.user.id, (error_) => {
        assert.notExists(error_);
        RestAPI.Following.follow(nico.restContext, simon.user.id, (error_) => {
          assert.notExists(error_);

          // Fetch the emails and ensure Simon got a single email with a single activity
          EmailTestsUtil.collectAndFetchAllEmails((messages) => {
            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0].to[0].address, simon.user.email);
            assert.strictEqual(messages[0].html.match(/data-activity-id/g).length, 1);

            // Assert both Branden and Nico are mentioned in the email
            assert.ok(messages[0].html.indexOf(branden.user.profilePath) > 0);
            assert.ok(messages[0].html.indexOf(nico.user.profilePath) > 0);

            // Sanity check that with a single user a single activity is received
            RestAPI.Following.follow(bert.restContext, simon.user.id, (error_) => {
              assert.notExists(error_);

              // Fetch the emails and ensure Simon got a single email with a single activity
              EmailTestsUtil.collectAndFetchAllEmails((messages) => {
                assert.strictEqual(messages.length, 1);
                assert.strictEqual(messages[0].to[0].address, simon.user.email);
                assert.strictEqual(messages[0].html.match(/data-activity-id/g).length, 1);

                // Assert both Branden and Nico are not mentioned in the email
                assert.strictEqual(messages[0].html.indexOf(branden.user.profilePath), -1);
                assert.strictEqual(messages[0].html.indexOf(nico.user.profilePath), -1);

                // Assert Bert is mentioned in the email
                assert.ok(messages[0].html.indexOf(bert.user.profilePath) > 0);
                return callback();
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies an "orphaned" following activity does not get re-delivered into an activity feed as a redundant single activity when a
   * multi-aggregate already exists for it
   */
  it('verify following a user, following another, then refollowing the first results in only 1 activity in the activity stream', (callback) => {
    generateTestUsers(camAdminRestContext, 3, (error, users) => {
      assert.notExists(error);

      const { 0: simon, 1: branden, 2: bert } = users;

      /*!
       * Following has 2 "groupBy" specifications that can aggregate activities. One grouping by actor and one grouping by object. This
       * results in the following groups eventually being created for the following test:
       *
       *  Group #1:   Simon   followed       *
       *  Group #2:     *     followed    Branden
       *  Group #3:     *     followed      Bert
       */

      /*!
       * Simon follows Branden. This activity becomes 2 aggregates, one for Group #1 and one for Group #2, but since the activities are
       * identical, only one activity is delivered that is referenced by both:
       *
       * Aggregate State:
       *
       *  Group #1: Simon followed (Branden)      [references Activity #1]
       *  Group #2: (Simon) followed Branden      [references Activity #1]
       *
       * Activity Feed State:
       *
       *  Activity #1: Simon followed Branden
       */
      RestAPI.Following.follow(simon.restContext, branden.user.id, (error_) => {
        assert.notExists(error_);

        collectAndGetActivityStream(simon.restContext, simon.user.id, null, (error /* , response */) => {
          assert.notExists(error);

          /*!
           * Simon follows Bert. This activity joins the Group #1 aggregate, and "orphans" the Group #2 aggregate (i.e., Group #2
           * aggregate no longer references any activity since that activity gets deleted and replaced with an updated one). The new
           * states should be:
           *
           * Aggregate State:
           *
           *  Group #1: Simon followed (Branden,Bert) [references Activity #2]
           *  Group #2: (Simon) followed Branden      [references Activity #1 (deleted)]
           *  Group #3: (Simon) followed Bert         [(no reference since Group #3 "claimed" the activity)]
           *
           * Activity Feed State:
           *
           *  Activity #2: Simon followed Branden and Bert
           */
          RestAPI.Following.follow(simon.restContext, bert.user.id, (error_) => {
            assert.notExists(error_);

            collectAndGetActivityStream(simon.restContext, simon.user.id, null, (error /* , response */) => {
              assert.notExists(error);

              /*!
               * Simon follows Bert, again. The point of this test is to ensure that this activity doesn't rejoin with Group #2,
               * thus resulting a new "Simon followed Branden" being delivered, as it is a redundant activity that is already
               * represented by the activity being tracked by Group #1.
               *
               * Aggregate State:
               *
               *  Group #1: Simon followed (Branden,Bert)     [references Activity #3]
               *  Group #2: (Simon) followed Branden          [references Activity #1 (deleted)]
               *
               * Activity Feed State:
               *
               * Activity #3: Simon followed Branden and Bert
               *
               * Therefore we should assert that Simon's activity feed contains only 1 single activity
               */
              RestAPI.Following.follow(simon.restContext, branden.user.id, (error_) => {
                assert.notExists(error_);

                collectAndGetActivityStream(simon.restContext, simon.user.id, null, (error, response) => {
                  assert.notExists(error);
                  assert.strictEqual(response.items.length, 1);
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
