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

import { assert } from 'chai';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as PrincipalsUtil from 'oae-principals/lib/util.js';

import { Context } from 'oae-context';
import { User } from 'oae-principals/lib/model.js';

import { equals, length, keys } from 'ramda';

describe('Principals', () => {
  // Rest context that can be used every time we need to make a request as a global admin
  let asCambridgeTenantAdmin = null;
  // Rest context for a user that will be used inside of the tests
  let asJonhFromCambridge = null;

  /**
   * Function that will fill up the anonymous and the tenant admin context
   */
  before((callback) => {
    // Fill up global admin rest context
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // Fill up the rest context for our test user
    TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);
      const { 0: john } = users;
      asJonhFromCambridge = john.restContext;
      RestAPI.User.getMe(asJonhFromCambridge, (error_) => {
        assert.notExists(error_);
        return callback();
      });
    });
  });

  describe('Utilities', () => {
    /**
     * Create a number of users and groups that will be used inside of the tests
     * @param  {Function(principals)}   callback                Standard callback function
     * @param  {Object}                 callback.principals     Object where the keys are identifiers for the created principals and the values are
     *                                                          are the actual group/user context objects
     */
    const createUsersAndGroup = function (callback) {
      const createdPrincipals = {};

      const createPrincipal = function (type, identifier, metadata) {
        const principalId = TestsUtil.generateTestUserId(identifier);
        if (type === 'group') {
          RestAPI.Group.createGroup(
            asJonhFromCambridge,
            metadata,
            metadata,
            'public',
            'yes',
            [],
            [],
            (error, groupObject) => {
              assert.notExists(error);
              createdPrincipals[identifier] = groupObject;
              if (equals(7, length(keys(createdPrincipals)))) {
                callback(createdPrincipals);
              }
            }
          );
        } else {
          const email = TestsUtil.generateTestEmailAddress(null, global.oaeTests.tenants.cam.emailDomains[0]);
          RestAPI.User.createUser(
            asCambridgeTenantAdmin,
            principalId,
            'password',
            metadata,
            email,
            {},
            (error, userObject) => {
              assert.notExists(error);
              const userContext = new Context(global.oaeTests.tenants.cam, userObject);
              createdPrincipals[identifier] = userContext;
              if (equals(7, length(keys(createdPrincipals)))) {
                callback(createdPrincipals);
              }
            }
          );
        }
      };

      // Create 4 users
      createPrincipal('user', 'nicolaas', 'Nicolaas Matthijs');
      createPrincipal('user', 'simon', 'Simon Gaeremynck');
      createPrincipal('user', 'bert', 'Bert Pareyn');
      createPrincipal('user', 'branden', 'Branden Visser');

      // Create 3 groups
      createPrincipal('group', 'oae-team', 'OAE Team');
      createPrincipal('group', 'backend-team', 'Back-end Team');
      createPrincipal('group', 'ui-team', 'UI Team');
    };

    /**
     * Test that verifies the working of the getPrincipal utility function
     */
    it('verify get principal', (callback) => {
      createUsersAndGroup((createdPrincipals) => {
        // Get an existing user
        PrincipalsUtil.getPrincipal(createdPrincipals.nicolaas, createdPrincipals.nicolaas.user().id, (error, user) => {
          assert.notExists(error);
          assert.ok(user);
          assert.strictEqual(user.id, createdPrincipals.nicolaas.user().id);
          assert.strictEqual(user.displayName, 'Nicolaas Matthijs');
          assert.strictEqual(user.resourceType, 'user');
          assert.strictEqual(
            user.profilePath,
            '/user/' + user.tenant.alias + '/' + AuthzUtil.getResourceFromId(user.id).resourceId
          );

          // Get a non-existing user
          PrincipalsUtil.getPrincipal(createdPrincipals.nicolaas, 'non-existing-user', (error, user) => {
            assert.ok(error);
            assert.ok(!user);

            // Get an existing group
            PrincipalsUtil.getPrincipal(
              createdPrincipals.nicolaas,
              createdPrincipals['oae-team'].id,
              (error, group) => {
                assert.notExists(error);
                assert.ok(group);
                assert.strictEqual(group.id, createdPrincipals['oae-team'].id);
                assert.strictEqual(group.displayName, 'OAE Team');
                assert.strictEqual(group.resourceType, 'group');
                assert.strictEqual(
                  group.profilePath,
                  '/group/' + group.tenant.alias + '/' + AuthzUtil.getResourceFromId(group.id).resourceId
                );

                // Get a non-existing group
                PrincipalsUtil.getPrincipal(createdPrincipals.nicolaas, 'non-existing-group', (error, group) => {
                  assert.ok(error);
                  assert.ok(!group);
                  callback();
                });
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies the working of the getPrincipals utility function, allowing the retrieval of
     * multiple principals at once
     */
    it('verify get principals', (callback) => {
      createUsersAndGroup((createdPrincipals) => {
        // Get existing users
        PrincipalsUtil.getPrincipals(
          createdPrincipals.nicolaas,
          [createdPrincipals.nicolaas.user().id, createdPrincipals.simon.user().id, createdPrincipals.bert.user().id],
          (error, users) => {
            assert.notExists(error);
            assert.ok(users);
            assert.lengthOf(keys(users), 3);
            assert.strictEqual(users[createdPrincipals.nicolaas.user().id].id, createdPrincipals.nicolaas.user().id);
            assert.strictEqual(users[createdPrincipals.simon.user().id].id, createdPrincipals.simon.user().id);
            assert.strictEqual(users[createdPrincipals.bert.user().id].id, createdPrincipals.bert.user().id);

            // Get existing groups
            PrincipalsUtil.getPrincipals(
              createdPrincipals.nicolaas,
              [createdPrincipals['oae-team'].id, createdPrincipals['backend-team'].id],
              (error, groups) => {
                assert.notExists(error);
                assert.ok(groups);
                assert.lengthOf(keys(groups), 2);
                assert.strictEqual(groups[createdPrincipals['oae-team'].id].id, createdPrincipals['oae-team'].id);
                assert.strictEqual(
                  groups[createdPrincipals['backend-team'].id].id,
                  createdPrincipals['backend-team'].id
                );

                // Get existing users and groups
                PrincipalsUtil.getPrincipals(
                  createdPrincipals.nicolaas,
                  [
                    createdPrincipals['oae-team'].id,
                    createdPrincipals.nicolaas.user().id,
                    createdPrincipals.simon.user().id,
                    createdPrincipals['backend-team'].id,
                    createdPrincipals.branden.user().id
                  ],
                  (error, principals) => {
                    assert.notExists(error);
                    assert.ok(principals);
                    assert.lengthOf(keys(principals), 5);
                    assert.strictEqual(
                      principals[createdPrincipals.nicolaas.user().id].id,
                      createdPrincipals.nicolaas.user().id
                    );
                    assert.strictEqual(
                      principals[createdPrincipals.simon.user().id].id,
                      createdPrincipals.simon.user().id
                    );
                    assert.strictEqual(
                      principals[createdPrincipals['oae-team'].id].id,
                      createdPrincipals['oae-team'].id
                    );
                    assert.strictEqual(
                      principals[createdPrincipals['backend-team'].id].id,
                      createdPrincipals['backend-team'].id
                    );
                    assert.strictEqual(
                      principals[createdPrincipals.branden.user().id].id,
                      createdPrincipals.branden.user().id
                    );

                    // Get existing users, of which some don't exist
                    PrincipalsUtil.getPrincipals(
                      createdPrincipals.nicolaas,
                      [
                        createdPrincipals.nicolaas.user().id,
                        'u:cam:non-existing-user',
                        createdPrincipals.simon.user().id
                      ],
                      (error, users) => {
                        assert.notExists(error);
                        assert.lengthOf(keys(users), 2);

                        // Get existing groups, of which some don't exist
                        PrincipalsUtil.getPrincipals(
                          createdPrincipals.nicolaas,
                          [createdPrincipals['oae-team'].id, 'u:cam:non-existing-group'],
                          (error, groups) => {
                            assert.notExists(error);
                            assert.lengthOf(keys(groups), 1);

                            // Get existing users/groups, of which some don't exist
                            PrincipalsUtil.getPrincipals(
                              createdPrincipals.nicolaas,
                              [
                                createdPrincipals['oae-team'].id,
                                createdPrincipals.nicolaas.user().id,
                                'u:cam:non-existing-user',
                                createdPrincipals.simon.user().id,
                                'u:cam:non-existing-group'
                              ],
                              (error, principals) => {
                                assert.notExists(error);
                                assert.lengthOf(keys(principals), 3);
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
      });
    });

    /**
     * Test that verifies the function that's used to create a cross-tenant unique principal id
     */
    it('verify principal identifiers', () => {
      let id = AuthzUtil.toId('g', 'cam', 'oae-team');
      assert.ok(PrincipalsUtil.isGroup(id));

      id = AuthzUtil.toId('u', 'cam', 'simong');
      assert.ok(PrincipalsUtil.isUser(id));

      id = AuthzUtil.toId('c', 'cam', 'foo.doc');
      assert.ok(!PrincipalsUtil.isUser(id));
      assert.ok(!PrincipalsUtil.isUser(id));
    });

    /**
     * Test that verifies the createUpdatedUser function
     */
    it('verify createUpdatedUser', () => {
      const source = new User('camtest', 'u:camtest:sourceId', 'sourceDisplayName', 'sourceEmail', {
        visibility: 'sourceVisibility',
        locale: 'sourceLocale',
        publicAlias: 'sourcePublicAlias'
      });

      // Verify tenant doesn't change
      let destUpdates = { tenant: 'destTenant' };
      let dest = PrincipalsUtil.createUpdatedUser(source, destUpdates);
      assert.strictEqual(dest.tenant.alias, 'camtest');

      // Verify id doesn't change
      destUpdates = { id: 'dest' };
      dest = PrincipalsUtil.createUpdatedUser(source, destUpdates);
      assert.strictEqual(dest.id, 'u:camtest:sourceId');

      // Verify displayName changes
      destUpdates = { displayName: 'dest' };
      dest = PrincipalsUtil.createUpdatedUser(source, destUpdates);
      assert.strictEqual(dest.displayName, 'dest');

      // Verify visibility changes
      destUpdates = { visibility: 'dest' };
      dest = PrincipalsUtil.createUpdatedUser(source, destUpdates);
      assert.strictEqual(dest.visibility, 'dest');

      // Verify locale changes
      destUpdates = { locale: 'dest' };
      dest = PrincipalsUtil.createUpdatedUser(source, destUpdates);
      assert.strictEqual(dest.locale, 'dest');

      // Verify publicAlias changes
      destUpdates = { publicAlias: 'dest' };
      dest = PrincipalsUtil.createUpdatedUser(source, destUpdates);
      assert.strictEqual(dest.publicAlias, 'dest');

      // Verify admin status for tenant and global are immutable
      destUpdates = { isGlobalAdmin: true };
      dest = PrincipalsUtil.createUpdatedUser(source, destUpdates);
      assert.ok(!dest.isGlobalAdmin());

      destUpdates = { isTenantAdmin: true };
      dest = PrincipalsUtil.createUpdatedUser(source, destUpdates);
      assert.ok(!dest.isTenantAdmin(source.tenant));

      destUpdates = { 'admin:global': true };
      dest = PrincipalsUtil.createUpdatedUser(source, destUpdates);
      assert.ok(!dest.isGlobalAdmin());

      destUpdates = { 'admin:tenant': true };
      dest = PrincipalsUtil.createUpdatedUser(source, destUpdates);
      assert.ok(!dest.isTenantAdmin(source.tenant));
    });
  });
});
