/*
 * Copyright 2017 Apereo Foundation (AF) Licensed under the
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
import util from 'util';
import _ from 'underscore';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

import PrincipalsAPI from 'oae-principals';
import { User } from 'oae-principals/lib/model.user';

describe('LTI tools', () => {
  // Rest context that can be used to perform requests as different types of users
  let anonymousRestContext = null;
  let camAdminRestContext = null;
  let janeRestContext = null;

  /**
   * Function that will create a user that will be used inside of the tests
   */
  before(callback => {
    // Create all the REST contexts before each test
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // Create the REST context for our test user
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, jane) => {
      assert.ok(!err);
      janeRestContext = jane.restContext;

      // Add the full user id onto the REST context for use inside of this test
      janeRestContext.user = jane.user;
      return callback();
    });
  });

  describe('Create LTI tool', () => {
    /**
     * Test that verifies that LTI tool creation is successful when all of the parameters have been provided
     */
    it('verify that LTI tool creation succeeds given a valid request', callback => {
      RestAPI.Group.createGroup(camAdminRestContext, 'This is a group', null, 'public', 'yes', [], [], (err, group) => {
        assert.ok(!err);
        const launchUrl = 'http://lti.launch.url';
        const secret = 'secret';
        const key = '12345';
        RestAPI.LtiTool.createLtiTool(
          camAdminRestContext,
          group.id,
          launchUrl,
          secret,
          key,
          'LTI tool title',
          'LTI tool description',
          (err, ltiTool) => {
            assert.ok(!err);
            assert.strictEqual(ltiTool.groupId, group.id);
            assert.strictEqual(ltiTool.launchUrl, launchUrl);
            assert.strictEqual(ltiTool.displayName, 'LTI tool title');
            assert.strictEqual(ltiTool.description, 'LTI tool description');
            return callback();
          }
        );
      });
    });

    /**
     * Test that verifies that a LTI tool can be created without a description
     */
    it('verify that missing description is accepted', callback => {
      RestAPI.Group.createGroup(camAdminRestContext, 'This is a group', null, 'public', 'yes', [], [], (err, group) => {
        assert.ok(!err);
        const launchUrl = 'http://lti.launch.url';
        const secret = 'secret';
        const key = '12345';
        RestAPI.LtiTool.createLtiTool(
          camAdminRestContext,
          group.id,
          launchUrl,
          secret,
          key,
          'LTI tool title',
          null,
          (err, toolObject) => {
            assert.ok(!err);
            assert.strictEqual(toolObject.description, '');

            // Verify that an empty description is acceptable as well
            RestAPI.LtiTool.createLtiTool(
              camAdminRestContext,
              group.id,
              launchUrl,
              secret,
              key,
              'LTI tool title',
              '',
              (err, toolObject) => {
                assert.ok(!err);
                assert.strictEqual(toolObject.description, '');
                return callback();
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that creating a LTI tool with no launchUrl is not possible
     */
    it('verify that missing launchUrl is not accepted', callback => {
      RestAPI.Group.createGroup(camAdminRestContext, 'This is a group', null, 'public', 'yes', [], [], (err, group) => {
        assert.ok(!err);
        const secret = 'secret';
        const key = '12345';
        RestAPI.LtiTool.createLtiTool(
          camAdminRestContext,
          group.id,
          '',
          secret,
          key,
          'LTI tool title',
          null,
          (err, toolObject) => {
            assert.ok(err);
            assert.strictEqual(err.code, 400);
            assert.strictEqual(err.msg, 'You need to provide a launch URL for this LTI tool');
            return callback();
          }
        );
      });
    });

    /**
     * Test that verifies that creating a LTI tool with no OAUTH secret is not possible
     */
    it('verify that missing OAUTH secret is not accepted', callback => {
      RestAPI.Group.createGroup(camAdminRestContext, 'This is a group', null, 'public', 'yes', [], [], (err, group) => {
        assert.ok(!err);
        const launchUrl = 'http://lti.launch.url';
        const key = '12345';
        RestAPI.LtiTool.createLtiTool(
          camAdminRestContext,
          group.id,
          launchUrl,
          null,
          key,
          'LTI tool title',
          null,
          (err, toolObject) => {
            assert.ok(err);
            assert.strictEqual(err.code, 400);
            assert.strictEqual(err.msg, 'You need to provide an OAUTH secret for this LTI tool');
            return callback();
          }
        );
      });
    });

    /**
     * Test that verifies that creating a LTI tool with no OAUTH consumer key is not possible
     */
    it('verify that missing OAUTH consumer key is not accepted', callback => {
      RestAPI.Group.createGroup(camAdminRestContext, 'This is a group', null, 'public', 'yes', [], [], (err, group) => {
        assert.ok(!err);
        const launchUrl = 'http://lti.launch.url';
        const secret = 'secret';
        RestAPI.LtiTool.createLtiTool(
          camAdminRestContext,
          group.id,
          launchUrl,
          secret,
          null,
          'LTI tool title',
          null,
          (err, toolObject) => {
            assert.ok(err);
            assert.strictEqual(err.code, 400);
            assert.strictEqual(err.msg, 'You need to provide an OAUTH consumer key for this LTI tool');
            return callback();
          }
        );
      });
    });

    /**
     * Test that verifies that a non-manager of a group can not create a LTI tool
     */
    it('verify that a non-manager can not create LTI tool', callback => {
      RestAPI.Group.createGroup(camAdminRestContext, 'This is a group', null, 'public', 'yes', [], [], (err, group) => {
        assert.ok(!err);
        const launchUrl = 'http://lti.launch.url';
        const secret = 'secret';
        const key = '12345';
        RestAPI.LtiTool.createLtiTool(
          anonymousRestContext,
          group.id,
          launchUrl,
          secret,
          key,
          'LTI tool title',
          'LTI tool description',
          (err, toolObject) => {
            assert.ok(err);
            assert.strictEqual(err.code, 401);
            assert.strictEqual(err.msg, 'The current user is not authorized to create an LTI tool');
            return callback();
          }
        );
      });
    });

    /**
     * Test that verifies LTI tools can not be created in deleted groups
     */
    it('verify that a LTI tool can not be created in a deleted group', callback => {
      RestAPI.Group.createGroup(camAdminRestContext, 'This is a group', null, 'public', 'yes', [], [], (err, group) => {
        assert.ok(!err);
        RestAPI.Group.deleteGroup(camAdminRestContext, group.id, err => {
          assert.ok(!err);
          const launchUrl = 'http://lti.launch.url';
          const secret = 'secret';
          const key = '12345';
          RestAPI.LtiTool.createLtiTool(
            camAdminRestContext,
            group.id,
            launchUrl,
            secret,
            key,
            'LTI tool title',
            'LTI tool description',
            (err, toolObject) => {
              assert.ok(err);
              assert.strictEqual(err.code, 404);
              assert.strictEqual(err.msg, "Couldn't find group: " + group.id);
              return callback();
            }
          );
        });
      });
    });
  });

  describe('Get LTI tool', () => {
    /**
     * Test that verifies that an existing LTI tool can be successfully retrieved and launch data
     * created
     */
    it('verify retrieved LTI tool launch data', callback => {
      RestAPI.Group.createGroup(camAdminRestContext, 'This is a group', null, 'public', 'yes', [], [], (err, group) => {
        const launchUrl = 'http://lti.launch.url';
        const secret = 'secret';
        const key = '12345';
        const title = 'LTI tool title';
        const description = 'LTI tool description';
        RestAPI.LtiTool.createLtiTool(
          camAdminRestContext,
          group.id,
          launchUrl,
          secret,
          key,
          title,
          description,
          (err, tool) => {
            assert.ok(!err);
            RestAPI.Group.joinGroup(janeRestContext, group.id, err => {
              assert.ok(!err);
              // Get the LTI tool and verify its model
              RestAPI.LtiTool.getLtiTool(janeRestContext, group.id, tool.id, (err, data) => {
                assert.ok(!err);
                const ltiLaunchData = data.launchParams;
                assert.strictEqual(ltiLaunchData.oauth_consumer_key, key);
                assert.strictEqual(ltiLaunchData.lti_message_type, 'basic-lti-launch-request');
                assert.strictEqual(ltiLaunchData.lti_version, 'LTI-1p0');
                assert.strictEqual(ltiLaunchData.tool_consumer_info_product_family_code, 'OAE');
                assert.strictEqual(ltiLaunchData.resource_link_id, tool.id);
                assert.strictEqual(ltiLaunchData.resource_link_title, title);
                assert.strictEqual(ltiLaunchData.resource_link_description, description);
                assert.strictEqual(ltiLaunchData.user_id, group.id + ':' + janeRestContext.user.id);
                assert.strictEqual(ltiLaunchData.context_id, group.id);
                assert.strictEqual(ltiLaunchData.lis_person_email_primary, janeRestContext.user.email);
                assert.strictEqual(ltiLaunchData.roles, 'Learner');
                return callback();
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that a non-existing LTI tool cannot be retrieved
     */
    it('verify non existing LTI tool can not be retrieved', callback => {
      // Invalid group identifier
      RestAPI.LtiTool.getLtiTool(camAdminRestContext, 'g:camtest:not-exists', '12345', (err, ltiTool) => {
        assert.ok(err);
        assert.strictEqual(err.code, 404);
        assert.ok(!ltiTool);

        RestAPI.Group.createGroup(
          camAdminRestContext,
          'This is a group',
          null,
          'public',
          'yes',
          [],
          [],
          (err, group) => {
            // Non existing tool
            RestAPI.LtiTool.getLtiTool(camAdminRestContext, group.id, 'not-a-tool', (err, ltiTool) => {
              assert.ok(err);
              assert.strictEqual(err.code, 404);
              assert.ok(!ltiTool);
              return callback();
            });
          }
        );
      });
    });
  });

  describe('Get LTI tools for a group', () => {
    /**
     * Test that verifies that all LTI tools linked to a group can be successfully retrieved
     */
    it('verify retrieving LTI tools for a group', callback => {
      RestAPI.Group.createGroup(camAdminRestContext, 'This is a group', null, 'public', 'yes', [], [], (err, group) => {
        const secret = 'secret';
        const title = 'LTI tool title';
        const description = 'LTI tool description';
        RestAPI.LtiTool.createLtiTool(
          camAdminRestContext,
          group.id,
          'http://lti.launch1.url',
          secret,
          '12345',
          title,
          description,
          (err, tool1) => {
            assert.ok(!err);
            RestAPI.LtiTool.createLtiTool(
              camAdminRestContext,
              group.id,
              'http://lti.launch2.url',
              secret,
              '12346',
              title,
              description,
              (err, tool2) => {
                assert.ok(!err);
                // Get the LTI tools for the group
                RestAPI.LtiTool.getLtiTools(camAdminRestContext, group.id, (err, ltiTools) => {
                  assert.ok(!err);
                  assert.strictEqual(ltiTools.results.length, 2);
                  const tool = ltiTools.results[0];
                  assert.strictEqual(tool.groupId, group.id);
                  // Check that OAUTH secret is not included in the returned object
                  assert.ok(!tool.secret);
                  const ids = _.pluck(ltiTools.results, 'id');
                  assert.ok(_.contains(ids, tool1.id));
                  assert.ok(_.contains(ids, tool2.id));
                  return callback();
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that LTI tools are not retrieved for erroneous groups
     */
    it('verify retrieving LTI tools are not retrieved for erroneous groups', callback => {
      // Test that tools are not retrieved for non-existing groups
      const notExists = 'g:camtest:not-exists';
      RestAPI.LtiTool.getLtiTools(camAdminRestContext, notExists, (err, ltiTools) => {
        assert.ok(err);
        assert.strictEqual(err.code, 404);
        assert.strictEqual(err.msg, 'Could not find principal with id ' + notExists);
        // Test that tools are not retrieved for deleted groups
        RestAPI.Group.createGroup(
          camAdminRestContext,
          'This is a group',
          null,
          'public',
          'yes',
          [],
          [],
          (err, group) => {
            const secret = 'secret';
            const title = 'LTI tool title';
            const description = 'LTI tool description';
            RestAPI.LtiTool.createLtiTool(
              camAdminRestContext,
              group.id,
              'http://lti.launch1.url',
              secret,
              '12345',
              title,
              description,
              (err, tool1) => {
                assert.ok(!err);
                RestAPI.LtiTool.createLtiTool(
                  camAdminRestContext,
                  group.id,
                  'http://lti.launch2.url',
                  secret,
                  '12346',
                  title,
                  description,
                  (err, tool2) => {
                    assert.ok(!err);
                    RestAPI.Group.deleteGroup(camAdminRestContext, group.id, err => {
                      assert.ok(!err);
                      RestAPI.LtiTool.getLtiTools(camAdminRestContext, group.id, (err, ltiTools) => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 404);
                        assert.strictEqual(err.msg, "Couldn't find group: " + group.id);
                        // Test that an empty array is returned for a group with no tools
                        RestAPI.Group.createGroup(
                          camAdminRestContext,
                          'This is a group',
                          null,
                          'public',
                          'yes',
                          [],
                          [],
                          (err, group) => {
                            RestAPI.LtiTool.getLtiTools(camAdminRestContext, group.id, (err, ltiTools) => {
                              assert.ok(!err);
                              assert.strictEqual(ltiTools.results.length, 0);
                              return callback();
                            });
                          }
                        );
                      });
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

  describe('Delete LTI tool', () => {
    /**
     * Test that verifies that LTI tools can be deleted
     */
    it('verify that LTI tools can be deleted', callback => {
      RestAPI.Group.createGroup(camAdminRestContext, 'This is a group', null, 'public', 'yes', [], [], (err, group) => {
        assert.ok(!err);
        const launchUrl = 'http://lti.launch.url';
        const secret = 'secret';
        const key = '12345';
        RestAPI.LtiTool.createLtiTool(
          camAdminRestContext,
          group.id,
          launchUrl,
          secret,
          key,
          'LTI tool title',
          'LTI tool description',
          (err, tool) => {
            assert.ok(!err);
            const { id } = tool;
            // Assert the tool exists and can be fetched
            RestAPI.LtiTool.getLtiTool(camAdminRestContext, group.id, id, (err, data) => {
              assert.ok(!err);
              const ltiLaunchData = data.launchParams;
              assert.strictEqual(ltiLaunchData.oauth_consumer_key, key);
              assert.strictEqual(ltiLaunchData.resource_link_id, id);
              RestAPI.LtiTool.deleteLtiTool(camAdminRestContext, group.id, id, err => {
                assert.ok(!err);
                // Assert the tool can no longer be fetched
                RestAPI.LtiTool.getLtiTool(camAdminRestContext, group.id, id, (err, data) => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 404);
                  assert.strictEqual(err.msg, util.format('Could not find LTI tool %s for group %s', id, group.id));
                  return callback();
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that a non-manager of a group can not delete a LTI tool
     */
    it('verify that a non-manager can not delete LTI tool', callback => {
      RestAPI.Group.createGroup(camAdminRestContext, 'This is a group', null, 'public', 'yes', [], [], (err, group) => {
        assert.ok(!err);
        const launchUrl = 'http://lti.launch.url';
        const secret = 'secret';
        const key = '12345';
        RestAPI.LtiTool.createLtiTool(
          camAdminRestContext,
          group.id,
          launchUrl,
          secret,
          key,
          'LTI tool title',
          'LTI tool description',
          (err, tool) => {
            assert.ok(!err);
            RestAPI.LtiTool.deleteLtiTool(anonymousRestContext, group.id, tool.id, err => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);
              assert.strictEqual(err.msg, 'The current user does not have access to manage this resource');
              return callback();
            });
          }
        );
      });
    });

    /**
     * Test that verifies LTI tools can not be deleted in deleted groups
     */
    it('verify that a LTI tool can not be deleted in a deleted group', callback => {
      RestAPI.Group.createGroup(camAdminRestContext, 'This is a group', null, 'public', 'yes', [], [], (err, group) => {
        assert.ok(!err);
        RestAPI.LtiTool.createLtiTool(
          camAdminRestContext,
          group.id,
          'http://lti.launch.url',
          'secret',
          '12345',
          'LTI tool title',
          'LTI tool description',
          (err, tool) => {
            assert.ok(!err);
            RestAPI.Group.deleteGroup(camAdminRestContext, group.id, err => {
              assert.ok(!err);
              RestAPI.LtiTool.deleteLtiTool(camAdminRestContext, group.id, tool.id, err => {
                assert.ok(err);
                assert.strictEqual(err.code, 404);
                assert.strictEqual(err.msg, util.format("Couldn't find group: %s", group.id));
                return callback();
              });
            });
          }
        );
      });
    });
  });
});
