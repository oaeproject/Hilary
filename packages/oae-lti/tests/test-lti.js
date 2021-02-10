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

import { assert } from 'chai';
import { format } from 'util';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

import { contains, pluck, compose, prop } from 'ramda';

const { generateTestUsers, createTenantRestContext, createTenantAdminRestContext } = TestsUtil;
const { createGroup, deleteGroup, joinGroup } = RestAPI.Group;
const { deleteLtiTool, createLtiTool, getLtiTool, getLtiTools } = RestAPI.LtiTool;

const PUBLIC = 'public';
const JOINABLE = 'yes';
const NO_MANAGERS = [];
const NO_MEMBERS = [];

describe('LTI tools', () => {
  // Rest context that can be used to perform requests as different types of users
  let asCambridgeAnonymousUser = null;
  let asCambridgeTenantAdmin = null;
  let asJane = null;

  /**
   * Function that will create a user that will be used inside of the tests
   */
  before((callback) => {
    // Create all the REST contexts before each test
    asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.cam.host);
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // Create the REST context for our test user
    generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);
      const { 0: jane } = users;
      asJane = jane.restContext;

      // Add the full user id onto the REST context for use inside of this test
      asJane.user = jane.user;

      return callback();
    });
  });

  describe('Create LTI tool', () => {
    /**
     * Test that verifies that LTI tool creation is successful when all of the parameters have been provided
     */
    it('verify that LTI tool creation succeeds given a valid request', (callback) => {
      createGroup(
        asCambridgeTenantAdmin,
        'This is a group',
        null,
        PUBLIC,
        JOINABLE,
        NO_MANAGERS,
        NO_MEMBERS,
        (error, group) => {
          assert.notExists(error);

          const launchUrl = 'http://lti.launch.url';
          const secret = 'secret';
          const key = '12345';

          createLtiTool(
            asCambridgeTenantAdmin,
            group.id,
            launchUrl,
            secret,
            key,
            'LTI tool title',
            'LTI tool description',
            (error, ltiTool) => {
              assert.notExists(error);
              assert.strictEqual(ltiTool.groupId, group.id);
              assert.strictEqual(ltiTool.launchUrl, launchUrl);
              assert.strictEqual(ltiTool.displayName, 'LTI tool title');
              assert.strictEqual(ltiTool.description, 'LTI tool description');

              return callback();
            }
          );
        }
      );
    });

    /**
     * Test that verifies that a LTI tool can be created without a description
     */
    it('verify that missing description is accepted', (callback) => {
      createGroup(
        asCambridgeTenantAdmin,
        'This is a group',
        null,
        PUBLIC,
        JOINABLE,
        NO_MANAGERS,
        NO_MEMBERS,
        (error, group) => {
          assert.notExists(error);

          const launchUrl = 'http://lti.launch.url';
          const secret = 'secret';
          const key = '12345';

          createLtiTool(
            asCambridgeTenantAdmin,
            group.id,
            launchUrl,
            secret,
            key,
            'LTI tool title',
            null,
            (error, toolObject) => {
              assert.notExists(error);
              assert.strictEqual(toolObject.description, '');

              // Verify that an empty description is acceptable as well
              createLtiTool(
                asCambridgeTenantAdmin,
                group.id,
                launchUrl,
                secret,
                key,
                'LTI tool title',
                '',
                (error, toolObject) => {
                  assert.notExists(error);
                  assert.strictEqual(toolObject.description, '');

                  return callback();
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies that creating a LTI tool with no launchUrl is not possible
     */
    it('verify that missing launchUrl is not accepted', (callback) => {
      createGroup(
        asCambridgeTenantAdmin,
        'This is a group',
        null,
        PUBLIC,
        JOINABLE,
        NO_MANAGERS,
        NO_MEMBERS,
        (error, group) => {
          assert.notExists(error);

          const secret = 'secret';
          const key = '12345';

          createLtiTool(asCambridgeTenantAdmin, group.id, '', secret, key, 'LTI tool title', null, (
            error /* , toolObject */
          ) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);
            assert.strictEqual(error.msg, 'You need to provide a launch URL for this LTI tool');

            return callback();
          });
        }
      );
    });

    /**
     * Test that verifies that creating a LTI tool with no OAUTH secret is not possible
     */
    it('verify that missing OAUTH secret is not accepted', (callback) => {
      createGroup(
        asCambridgeTenantAdmin,
        'This is a group',
        null,
        PUBLIC,
        JOINABLE,
        NO_MANAGERS,
        NO_MEMBERS,
        (error, group) => {
          assert.notExists(error);

          const launchUrl = 'http://lti.launch.url';
          const key = '12345';

          createLtiTool(asCambridgeTenantAdmin, group.id, launchUrl, null, key, 'LTI tool title', null, (
            error /* , toolObject */
          ) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);
            assert.strictEqual(error.msg, 'You need to provide an OAUTH secret for this LTI tool');

            return callback();
          });
        }
      );
    });

    /**
     * Test that verifies that creating a LTI tool with no OAUTH consumer key is not possible
     */
    it('verify that missing OAUTH consumer key is not accepted', (callback) => {
      createGroup(
        asCambridgeTenantAdmin,
        'This is a group',
        null,
        PUBLIC,
        JOINABLE,
        NO_MANAGERS,
        NO_MEMBERS,
        (error, group) => {
          assert.notExists(error);

          const launchUrl = 'http://lti.launch.url';
          const secret = 'secret';

          createLtiTool(asCambridgeTenantAdmin, group.id, launchUrl, secret, null, 'LTI tool title', null, (
            error /* , toolObject */
          ) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);
            assert.strictEqual(error.msg, 'You need to provide an OAUTH consumer key for this LTI tool');

            return callback();
          });
        }
      );
    });

    /**
     * Test that verifies that a non-manager of a group can not create a LTI tool
     */
    it('verify that a non-manager can not create LTI tool', (callback) => {
      createGroup(
        asCambridgeTenantAdmin,
        'This is a group',
        null,
        PUBLIC,
        JOINABLE,
        NO_MANAGERS,
        NO_MEMBERS,
        (error, group) => {
          assert.notExists(error);

          const launchUrl = 'http://lti.launch.url';
          const secret = 'secret';
          const key = '12345';

          createLtiTool(
            asCambridgeAnonymousUser,
            group.id,
            launchUrl,
            secret,
            key,
            'LTI tool title',
            'LTI tool description',
            (error /* , toolObject */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);
              assert.strictEqual(error.msg, 'The current user is not authorized to create an LTI tool');

              return callback();
            }
          );
        }
      );
    });

    /**
     * Test that verifies LTI tools can not be created in deleted groups
     */
    it('verify that a LTI tool can not be created in a deleted group', (callback) => {
      createGroup(
        asCambridgeTenantAdmin,
        'This is a group',
        null,
        PUBLIC,
        JOINABLE,
        NO_MANAGERS,
        NO_MEMBERS,
        (error, group) => {
          assert.notExists(error);

          deleteGroup(asCambridgeTenantAdmin, group.id, (error_) => {
            assert.notExists(error_);

            const launchUrl = 'http://lti.launch.url';
            const secret = 'secret';
            const key = '12345';

            createLtiTool(
              asCambridgeTenantAdmin,
              group.id,
              launchUrl,
              secret,
              key,
              'LTI tool title',
              'LTI tool description',
              (error /* , toolObject */) => {
                assert.ok(error);
                assert.strictEqual(error.code, 404);
                assert.strictEqual(error.msg, "Couldn't find group: " + group.id);

                return callback();
              }
            );
          });
        }
      );
    });
  });

  describe('Get LTI tool', () => {
    /**
     * Test that verifies that an existing LTI tool can be successfully retrieved and launch data
     * created
     */
    it('verify retrieved LTI tool launch data', (callback) => {
      createGroup(
        asCambridgeTenantAdmin,
        'This is a group',
        null,
        PUBLIC,
        JOINABLE,
        NO_MANAGERS,
        NO_MEMBERS,
        (error, group) => {
          assert.notExists(error);

          const launchUrl = 'http://lti.launch.url';
          const secret = 'secret';
          const key = '12345';
          const title = 'LTI tool title';
          const description = 'LTI tool description';

          createLtiTool(asCambridgeTenantAdmin, group.id, launchUrl, secret, key, title, description, (error, tool) => {
            assert.notExists(error);

            joinGroup(asJane, group.id, (error_) => {
              assert.notExists(error_);

              // Get the LTI tool and verify its model
              getLtiTool(asJane, group.id, tool.id, (error, data) => {
                assert.notExists(error);

                const ltiLaunchData = data.launchParams;
                assert.strictEqual(ltiLaunchData.oauth_consumer_key, key);
                assert.strictEqual(ltiLaunchData.lti_message_type, 'basic-lti-launch-request');
                assert.strictEqual(ltiLaunchData.lti_version, 'LTI-1p0');
                assert.strictEqual(ltiLaunchData.tool_consumer_info_product_family_code, 'OAE');
                assert.strictEqual(ltiLaunchData.resource_link_id, tool.id);
                assert.strictEqual(ltiLaunchData.resource_link_title, title);
                assert.strictEqual(ltiLaunchData.resource_link_description, description);
                assert.strictEqual(ltiLaunchData.user_id, group.id + ':' + asJane.user.id);
                assert.strictEqual(ltiLaunchData.context_id, group.id);
                assert.strictEqual(ltiLaunchData.lis_person_email_primary, asJane.user.email);
                assert.strictEqual(ltiLaunchData.roles, 'Learner');

                return callback();
              });
            });
          });
        }
      );
    });

    /**
     * Test that verifies that a non-existing LTI tool cannot be retrieved
     */
    it('verify non existing LTI tool can not be retrieved', (callback) => {
      // Invalid group identifier
      getLtiTool(asCambridgeTenantAdmin, 'g:camtest:not-exists', '12345', (error, ltiTool) => {
        assert.ok(error);
        assert.strictEqual(error.code, 404);
        assert.notExists(ltiTool);

        createGroup(
          asCambridgeTenantAdmin,
          'This is a group',
          null,
          PUBLIC,
          JOINABLE,
          NO_MANAGERS,
          NO_MEMBERS,
          (error, group) => {
            // Non existing tool
            getLtiTool(asCambridgeTenantAdmin, group.id, 'not-a-tool', (error, ltiTool) => {
              assert.ok(error);
              assert.strictEqual(error.code, 404);
              assert.notExists(ltiTool);

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
    it('verify retrieving LTI tools for a group', (callback) => {
      createGroup(
        asCambridgeTenantAdmin,
        'This is a group',
        null,
        PUBLIC,
        JOINABLE,
        NO_MANAGERS,
        NO_MEMBERS,
        (error, group) => {
          const secret = 'secret';
          const title = 'LTI tool title';
          const description = 'LTI tool description';

          createLtiTool(
            asCambridgeTenantAdmin,
            group.id,
            'http://lti.launch1.url',
            secret,
            '12345',
            title,
            description,
            (error, tool1) => {
              assert.notExists(error);

              createLtiTool(
                asCambridgeTenantAdmin,
                group.id,
                'http://lti.launch2.url',
                secret,
                '12346',
                title,
                description,
                (error, tool2) => {
                  assert.notExists(error);

                  // Get the LTI tools for the group
                  getLtiTools(asCambridgeTenantAdmin, group.id, (error, ltiTools) => {
                    assert.notExists(error);
                    assert.lengthOf(ltiTools.results, 2);
                    const tool = ltiTools.results[0];
                    assert.strictEqual(tool.groupId, group.id);

                    // Check that OAUTH secret is not included in the returned object
                    assert.notExists(tool.secret);
                    const isIdPartOf = (id) => compose(contains(id), pluck('id'), prop('results'))(ltiTools);
                    assert.ok(isIdPartOf(tool1.id));
                    assert.ok(isIdPartOf(tool2.id));

                    return callback();
                  });
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies that LTI tools are not retrieved for erroneous groups
     */
    it('verify retrieving LTI tools are not retrieved for erroneous groups', (callback) => {
      // Test that tools are not retrieved for non-existing groups
      const notExists = 'g:camtest:not-exists';
      getLtiTools(asCambridgeTenantAdmin, notExists, (error /* , ltiTools */) => {
        assert.ok(error);
        assert.strictEqual(error.code, 404);
        assert.strictEqual(error.msg, 'Could not find principal with id ' + notExists);

        // Test that tools are not retrieved for deleted groups
        createGroup(
          asCambridgeTenantAdmin,
          'This is a group',
          null,
          PUBLIC,
          JOINABLE,
          NO_MANAGERS,
          NO_MEMBERS,
          (error, group) => {
            const secret = 'secret';
            const title = 'LTI tool title';
            const description = 'LTI tool description';

            createLtiTool(
              asCambridgeTenantAdmin,
              group.id,
              'http://lti.launch1.url',
              secret,
              '12345',
              title,
              description,
              (error /* , tool1 */) => {
                assert.notExists(error);

                createLtiTool(
                  asCambridgeTenantAdmin,
                  group.id,
                  'http://lti.launch2.url',
                  secret,
                  '12346',
                  title,
                  description,
                  (error /* , tool2 */) => {
                    assert.notExists(error);

                    deleteGroup(asCambridgeTenantAdmin, group.id, (error_) => {
                      assert.notExists(error_);

                      getLtiTools(asCambridgeTenantAdmin, group.id, (error /* , ltiTools */) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 404);
                        assert.strictEqual(error.msg, "Couldn't find group: " + group.id);

                        // Test that an empty array is returned for a group with no tools
                        createGroup(
                          asCambridgeTenantAdmin,
                          'This is a group',
                          null,
                          PUBLIC,
                          JOINABLE,
                          NO_MANAGERS,
                          NO_MEMBERS,
                          (error, group) => {
                            assert.notExists(error);

                            getLtiTools(asCambridgeTenantAdmin, group.id, (error, ltiTools) => {
                              assert.notExists(error);
                              assert.lengthOf(ltiTools.results, 0);

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
    it('verify that LTI tools can be deleted', (callback) => {
      createGroup(
        asCambridgeTenantAdmin,
        'This is a group',
        null,
        PUBLIC,
        JOINABLE,
        NO_MANAGERS,
        NO_MEMBERS,
        (error, group) => {
          assert.notExists(error);

          const launchUrl = 'http://lti.launch.url';
          const secret = 'secret';
          const key = '12345';

          createLtiTool(
            asCambridgeTenantAdmin,
            group.id,
            launchUrl,
            secret,
            key,
            'LTI tool title',
            'LTI tool description',
            (error, tool) => {
              assert.notExists(error);
              const { id } = tool;

              // Assert the tool exists and can be fetched
              getLtiTool(asCambridgeTenantAdmin, group.id, id, (error, data) => {
                assert.notExists(error);
                const ltiLaunchData = data.launchParams;
                assert.strictEqual(ltiLaunchData.oauth_consumer_key, key);
                assert.strictEqual(ltiLaunchData.resource_link_id, id);

                deleteLtiTool(asCambridgeTenantAdmin, group.id, id, (error_) => {
                  assert.notExists(error_);

                  // Assert the tool can no longer be fetched
                  getLtiTool(asCambridgeTenantAdmin, group.id, id, (error /* , data */) => {
                    assert.ok(error);
                    assert.strictEqual(error.code, 404);
                    assert.strictEqual(error.msg, format('Could not find LTI tool %s for group %s', id, group.id));

                    return callback();
                  });
                });
              });
            }
          );
        }
      );
    });

    /**
     * Test that verifies that a non-manager of a group can not delete a LTI tool
     */
    it('verify that a non-manager can not delete LTI tool', (callback) => {
      createGroup(
        asCambridgeTenantAdmin,
        'This is a group',
        null,
        PUBLIC,
        JOINABLE,
        NO_MANAGERS,
        NO_MEMBERS,
        (error, group) => {
          assert.notExists(error);

          const launchUrl = 'http://lti.launch.url';
          const secret = 'secret';
          const key = '12345';

          createLtiTool(
            asCambridgeTenantAdmin,
            group.id,
            launchUrl,
            secret,
            key,
            'LTI tool title',
            'LTI tool description',
            (error, tool) => {
              assert.notExists(error);

              deleteLtiTool(asCambridgeAnonymousUser, group.id, tool.id, (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 401);
                assert.strictEqual(error_.msg, 'The current user does not have access to manage this resource');

                return callback();
              });
            }
          );
        }
      );
    });

    /**
     * Test that verifies LTI tools can not be deleted in deleted groups
     */
    it('verify that a LTI tool can not be deleted in a deleted group', (callback) => {
      createGroup(
        asCambridgeTenantAdmin,
        'This is a group',
        null,
        PUBLIC,
        JOINABLE,
        NO_MANAGERS,
        NO_MEMBERS,
        (error, group) => {
          assert.notExists(error);

          createLtiTool(
            asCambridgeTenantAdmin,
            group.id,
            'http://lti.launch.url',
            'secret',
            '12345',
            'LTI tool title',
            'LTI tool description',
            (error, tool) => {
              assert.notExists(error);

              deleteGroup(asCambridgeTenantAdmin, group.id, (error_) => {
                assert.notExists(error_);

                deleteLtiTool(asCambridgeTenantAdmin, group.id, tool.id, (error_) => {
                  assert.ok(error_);
                  assert.strictEqual(error_.code, 404);
                  assert.strictEqual(error_.msg, format("Couldn't find group: %s", group.id));

                  return callback();
                });
              });
            }
          );
        }
      );
    });
  });
});
