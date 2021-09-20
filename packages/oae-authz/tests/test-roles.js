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
import * as AuthzAPI from 'oae-authz';
import * as AuthzUtil from 'oae-authz/lib/util.js';

import { forEach, keys } from 'ramda';

describe('Authz-Roles', () => {
  const PrincipalTypes = { USER: 'u', GROUP: 'g' };
  const ResourceTypes = { CONTENT: 'c', GROUP: 'g' };

  /**
   * Load roles for a number of generated content items.
   *
   * @param  {String}      principalId         The principal id to assign the role
   * @param  {String}      baseContentId       The base content id of the content to generate
   * @param  {String}      resourceType        The resource type associated to the content
   * @param  {Number}      numContentItems     The number of content items to generate and assign roles for
   * @param  {String}      role                The role to assign to the principal on the generated content
   * @param  {Function()}  callback            The function invoked when the process is complete
   */
  const loadContentRoles = function (
    principalId,
    baseContentId,
    resourceType,
    numberContentItems,
    role,
    callback
  ) {
    if (numberContentItems === 0) {
      callback();
      return;
    }

    const { tenantAlias } = AuthzUtil.getPrincipalFromId(principalId);
    const resourceId = AuthzUtil.toId(
      resourceType,
      tenantAlias,
      baseContentId + '-' + numberContentItems
    );
    AuthzAPI.updateRoles(resourceId, makeChange(principalId, role), (error) => {
      if (error) {
        throw error;
      }

      loadContentRoles(
        principalId,
        baseContentId,
        resourceType,
        numberContentItems - 1,
        role,
        callback
      );
    });
  };

  /**
   * Make a single membership change object to apply to a group membership.
   *
   * @param  {String} principalId     The principal id whose membership to change
   * @param  {String} role            The role to change to
   * @return {Object}                 The change JSON Object to apply to the group
   */
  const makeChange = function (principalId, role) {
    const change = {};
    change[principalId] = role;
    return change;
  };

  describe('#getAllRoles()', () => {
    it('verify invalid principal id error', (callback) => {
      AuthzAPI.getAllRoles('not an id', 'c:cam:Foo.docx', (error /* , roles */) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify non-principal id error', (callback) => {
      AuthzAPI.getAllRoles('c:cam:mrvisser', 'c:cam:Foo.docx', (error /* , roles */) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify invalid resource id error', (callback) => {
      AuthzAPI.getAllRoles('u:cam:mrvisser', 'not an id', (error /* , roles */) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify empty data', (callback) => {
      const userId = AuthzUtil.toId('u', 'gar-empty', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'gar-empty', 'SomeContent');
      AuthzAPI.getAllRoles(userId, resourceId, (error, roles) => {
        assert.notExists(error);
        assert.strictEqual(roles.length, 0);
        callback();
      });
    });

    it('verify direct single role association', (callback) => {
      const userId = AuthzUtil.toId('u', 'gar-direct', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'gar-direct', 'SomeContent');
      AuthzAPI.updateRoles(resourceId, makeChange(userId, 'viewer'), (error) => {
        assert.notExists(error);
        AuthzAPI.getAllRoles(userId, resourceId, (error, roles) => {
          assert.notExists(error);
          assert.strictEqual(roles.length, 1);
          assert.strictEqual(roles[0], 'viewer');
          callback();
        });
      });
    });

    it('verify indirect single role association', (callback) => {
      const groupId = AuthzUtil.toId('g', 'gar-indirect-one', 'oae-team');
      const userId = AuthzUtil.toId('u', 'gar-indirect-one', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'gar-indirect-one', 'SomeContent');

      AuthzAPI.updateRoles(groupId, makeChange(userId, 'member'), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(resourceId, makeChange(groupId, 'viewer'), (error) => {
          assert.notExists(error);
          AuthzAPI.getAllRoles(userId, resourceId, (error, roles) => {
            assert.notExists(error);
            assert.strictEqual(roles.length, 1);
            assert.strictEqual(roles[0], 'viewer');
            callback();
          });
        });
      });
    });

    it('verify indirect two role association', (callback) => {
      const groupId = AuthzUtil.toId('g', 'gar-indirect-one', 'oae-team');
      const userId = AuthzUtil.toId('u', 'gar-indirect-one', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'gar-indirect-one', 'SomeContent');

      AuthzAPI.updateRoles(groupId, makeChange(userId, 'member'), (error) => {
        assert.notExists(error);
        const changes = {};
        changes[groupId] = 'viewer';
        changes[userId] = 'editor';
        AuthzAPI.updateRoles(resourceId, changes, (error) => {
          assert.notExists(error);
          AuthzAPI.getAllRoles(userId, resourceId, (error, roles) => {
            assert.notExists(error);
            assert.strictEqual(roles.length, 2);
            assert.ok(roles.includes('viewer'));
            assert.ok(roles.includes('editor'));
            callback();
          });
        });
      });
    });

    it('verify multi-indirect two role association', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'ia-multi', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'ia-multi', 'oae-backend-team');
      const userId = AuthzUtil.toId('u', 'ia-multi', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'ia-multi', 'SomeContent');

      AuthzAPI.updateRoles(groupId1, makeChange(userId, 'member'), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(groupId2, makeChange(userId, 'member'), (error) => {
          assert.notExists(error);
          AuthzAPI.updateRoles(resourceId, makeChange(groupId1, 'viewer'), (error) => {
            assert.notExists(error);
            AuthzAPI.updateRoles(resourceId, makeChange(groupId2, 'manager'), (error) => {
              assert.notExists(error);
              AuthzAPI.getAllRoles(userId, resourceId, (error, roles) => {
                assert.notExists(error);
                assert.strictEqual(roles.length, 2);
                assert.ok(roles.includes('viewer'));
                assert.ok(roles.includes('manager'));
                callback();
              });
            });
          });
        });
      });
    });

    it('verify circular group hierarchy three role association', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'ia-circ', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'ia-circ', 'oae-backend-team');
      const groupId3 = AuthzUtil.toId('g', 'ia-circ', 'oae-ui-team');
      const userId = AuthzUtil.toId('u', 'ia-circ', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'ia-circ', 'SomeContent');
      AuthzAPI.updateRoles(groupId1, makeChange(userId, 'member'), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(groupId2, makeChange(groupId1, 'member'), (error) => {
          assert.notExists(error);
          AuthzAPI.updateRoles(groupId3, makeChange(groupId2, 'member'), (error) => {
            assert.notExists(error);
            AuthzAPI.updateRoles(groupId1, makeChange(groupId3, 'member'), (error) => {
              assert.notExists(error);
              AuthzAPI.updateRoles(resourceId, makeChange(groupId1, 'viewer'), (error) => {
                assert.notExists(error);
                AuthzAPI.updateRoles(resourceId, makeChange(groupId2, 'manager'), (error) => {
                  assert.notExists(error);
                  AuthzAPI.updateRoles(resourceId, makeChange(groupId3, 'editor'), (error) => {
                    assert.notExists(error);
                    AuthzAPI.getAllRoles(userId, resourceId, (error, roles) => {
                      assert.notExists(error);
                      assert.strictEqual(roles.length, 3);
                      assert.ok(roles.includes('viewer'));
                      assert.ok(roles.includes('manager'));
                      assert.ok(roles.includes('editor'));
                      callback();
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    it('verify role separation between tenants', (callback) => {
      const principalIdA = AuthzUtil.toId(PrincipalTypes.USER, 'testTenantSeparationA', 'mrvisser');
      const principalIdB = AuthzUtil.toId(PrincipalTypes.USER, 'testTenantSeparationB', 'mrvisser');
      const resourceId = AuthzUtil.toId(
        ResourceTypes.CONTENT,
        'cam',
        'testTenantSeparationContent'
      );

      AuthzAPI.updateRoles(resourceId, makeChange(principalIdA, 'manager'), (error) => {
        assert.notExists(error);

        // Verify tenant B user does not have a direct or indirect role on that content
        AuthzAPI.getAllRoles(principalIdB, resourceId, (error, roles) => {
          assert.notExists(error);
          assert.strictEqual(roles.length, 0);

          // Add 'viewer' for security context B
          AuthzAPI.updateRoles(resourceId, makeChange(principalIdB, 'viewer'), (error_) => {
            assert.notExists(error_);

            // Ensure user from tenant A is still manager, not viewer
            AuthzAPI.hasRole(principalIdA, resourceId, 'manager', (error, hasRole) => {
              assert.notExists(error);
              assert.ok(hasRole);

              // Ensure user from context B is a viewer, not manager
              AuthzAPI.hasRole(principalIdB, resourceId, 'viewer', (error, hasRole) => {
                assert.notExists(error);
                assert.ok(hasRole);
                callback();
              });
            });
          });
        });
      });
    });
  });

  describe('#hasRole()', () => {
    it('verify negative check without any roles', (callback) => {
      const principalId = AuthzUtil.toId(PrincipalTypes.USER, 'testHasRoleWithout', 'mrvisser');
      AuthzAPI.hasRole(principalId, 'c:cam:nonExistent', 'manager', (error, hasRole) => {
        assert.notExists(error);
        assert.isNotOk(hasRole);
        callback();
      });
    });

    it('verify positive check with a role', (callback) => {
      const principalId = AuthzUtil.toId(PrincipalTypes.USER, 'testHasRole', 'mrvisser');
      const resourceId = AuthzUtil.toId(ResourceTypes.CONTENT, 'testHasRole', 'testHasRoleContent');

      // Add the 'manager' role
      AuthzAPI.updateRoles(resourceId, makeChange(principalId, 'manager'), (error) => {
        assert.notExists(error);

        // Verify that hasRole reports that the user has the manager role
        AuthzAPI.hasRole(principalId, resourceId, 'manager', (error, hasRole) => {
          assert.notExists(error);
          assert.ok(hasRole);
          callback();
        });
      });
    });

    it('verify negative check when role has been removed', (callback) => {
      const principalId = AuthzUtil.toId(PrincipalTypes.USER, 'testHasRole', 'mrvisser');
      const resourceId = AuthzUtil.toId(ResourceTypes.CONTENT, 'testHasRole', 'testHasRoleContent');
      // Add the 'manager' role
      AuthzAPI.updateRoles(resourceId, makeChange(principalId, 'manager'), (error) => {
        assert.notExists(error);

        // Verify that hasRole reports that the user has the manager role
        AuthzAPI.hasRole(principalId, resourceId, 'manager', (error, hasRole) => {
          assert.notExists(error);
          assert.ok(hasRole);

          // Remove the role from the user
          AuthzAPI.updateRoles(resourceId, makeChange(principalId, false), (error_) => {
            assert.notExists(error_);

            // Verify that the user no longer has the role
            AuthzAPI.hasRole(principalId, resourceId, 'manager', (error, hasRole) => {
              assert.notExists(error);
              assert.isNotOk(hasRole);
              callback();
            });
          });
        });
      });
    });
  });

  describe('#applyRoleChanges()', () => {
    it('verify update existing role', (callback) => {
      const principalId = AuthzUtil.toId(PrincipalTypes.USER, 'testUpdateRole', 'mrvisser');
      const resourceId = AuthzUtil.toId(ResourceTypes.CONTENT, 'testUpdateRole', 'Foo.docx');

      // 1. set role to viewer and sanity check
      AuthzAPI.updateRoles(resourceId, makeChange(principalId, 'viewer'), (error) => {
        assert.notExists(error);
        AuthzAPI.hasRole(principalId, resourceId, 'viewer', (error, hasRole) => {
          assert.notExists(error);
          assert.ok(hasRole);
          AuthzAPI.updateRoles(resourceId, makeChange(principalId, 'manager'), (error_) => {
            assert.notExists(error_);
            AuthzAPI.hasRole(principalId, resourceId, 'manager', (error, hasRole) => {
              assert.notExists(error);
              assert.ok(hasRole);
              callback();
            });
          });
        });
      });
    });

    it('verify general functionality', (callback) => {
      const principalId1 = AuthzUtil.toId(PrincipalTypes.USER, 'testHasRole', 'mrvisser');
      const principalId2 = AuthzUtil.toId(PrincipalTypes.USER, 'testHasRole', 'nm417');
      const principalId3 = AuthzUtil.toId(PrincipalTypes.USER, 'testHasRole', 'simong');
      const principalId4 = AuthzUtil.toId(PrincipalTypes.USER, 'testHasRole', 'PhysX');
      const resourceId1 = AuthzUtil.toId(
        ResourceTypes.CONTENT,
        'testHasRole',
        'testHasRoleContent1'
      );
      const resourceId2 = AuthzUtil.toId(
        ResourceTypes.CONTENT,
        'testHasRole',
        'testHasRoleContent2'
      );
      const resourceId3 = AuthzUtil.toId(
        ResourceTypes.CONTENT,
        'testHasRole',
        'testHasRoleContent3'
      );

      // Make 1 user a manager
      let roles = {};
      roles[principalId1] = 'manager';
      AuthzAPI.updateRoles(resourceId1, roles, (error) => {
        assert.notExists(error);
        AuthzAPI.hasRole(principalId1, resourceId1, 'manager', (error, hasRole) => {
          assert.notExists(error);
          assert.ok(hasRole);
          AuthzAPI.hasRole(principalId2, resourceId1, 'manager', (error, hasRole) => {
            assert.notExists(error);
            assert.isNotOk(hasRole);

            // Make 2 users a manager
            roles = {};
            roles[principalId1] = 'manager';
            roles[principalId2] = 'manager';
            AuthzAPI.updateRoles(resourceId2, roles, (error_) => {
              assert.notExists(error_);
              AuthzAPI.hasRole(principalId1, resourceId2, 'manager', (error, hasRole) => {
                assert.notExists(error);
                assert.ok(hasRole);
                AuthzAPI.hasRole(principalId2, resourceId2, 'manager', (error, hasRole) => {
                  assert.notExists(error);
                  assert.ok(hasRole);

                  // Make 2 users a manager, 1 a member
                  roles = {};
                  roles[principalId1] = 'manager';
                  roles[principalId2] = 'manager';
                  roles[principalId3] = 'member';
                  AuthzAPI.updateRoles(resourceId3, roles, (error_) => {
                    assert.notExists(error_);
                    AuthzAPI.hasRole(principalId1, resourceId3, 'manager', (error, hasRole) => {
                      assert.notExists(error);
                      assert.ok(hasRole);
                      AuthzAPI.hasRole(principalId2, resourceId3, 'manager', (error, hasRole) => {
                        assert.notExists(error);
                        assert.ok(hasRole);
                        AuthzAPI.hasRole(principalId3, resourceId3, 'member', (error, hasRole) => {
                          assert.notExists(error);
                          assert.ok(hasRole);
                          AuthzAPI.hasRole(
                            principalId4,
                            resourceId3,
                            'member',
                            (error, hasRole) => {
                              assert.notExists(error);
                              assert.isNotOk(hasRole);

                              // Try to remove 1 role
                              roles = {};
                              roles[principalId3] = false;
                              AuthzAPI.updateRoles(resourceId3, roles, (error_) => {
                                assert.notExists(error_);
                                AuthzAPI.hasRole(
                                  principalId1,
                                  resourceId3,
                                  'manager',
                                  (error, hasRole) => {
                                    assert.notExists(error);
                                    assert.ok(hasRole);
                                    AuthzAPI.hasRole(
                                      principalId3,
                                      resourceId3,
                                      'member',
                                      (error, hasRole) => {
                                        assert.notExists(error);
                                        assert.isNotOk(hasRole);

                                        // Try to remove 2 roles and add 1 at the same time
                                        roles = {};
                                        roles[principalId1] = false;
                                        roles[principalId2] = false;
                                        roles[principalId3] = 'manager';
                                        AuthzAPI.updateRoles(resourceId3, roles, (error_) => {
                                          assert.notExists(error_);
                                          AuthzAPI.hasRole(
                                            principalId1,
                                            resourceId3,
                                            'manager',
                                            (error, hasRole) => {
                                              assert.notExists(error);
                                              assert.isNotOk(hasRole);
                                              AuthzAPI.hasRole(
                                                principalId2,
                                                resourceId3,
                                                'member',
                                                (error, hasRole) => {
                                                  assert.notExists(error);
                                                  assert.isNotOk(hasRole);
                                                  AuthzAPI.hasRole(
                                                    principalId3,
                                                    resourceId3,
                                                    'manager',
                                                    (error, hasRole) => {
                                                      assert.notExists(error);
                                                      assert.ok(hasRole);
                                                      callback();
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
                            }
                          );
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    it('verify validation', (callback) => {
      const principalId1 = AuthzUtil.toId(PrincipalTypes.USER, 'testHasRole', 'mrvisser');
      const principalId2 = AuthzUtil.toId(PrincipalTypes.USER, 'testHasRole', 'nm417');
      const resourceId1 = AuthzUtil.toId(
        ResourceTypes.CONTENT,
        'testHasRole',
        'testHasRoleContent1'
      );

      const roles = {};
      roles[principalId1] = 'manager';
      roles[principalId2] = 'manager';
      // Try applyRoleChanges without resourceId
      AuthzAPI.updateRoles(undefined, roles, (error) => {
        assert.ok(error);
        // Try applyRolesChanges with empty roles
        AuthzAPI.updateRoles(resourceId1, {}, (error) => {
          assert.ok(error);
          return callback();
        });
      });
    });
  });

  describe('#getRolesForPrincipalsAndResourceType()', () => {
    it('verify general functionality', (callback) => {
      const baseViewerContentId = 'contentIView';
      const baseManagerContentId = 'contentIManage';
      const principalId1 = AuthzUtil.toId(
        PrincipalTypes.USER,
        'testGetRolesForPrincipalsAndResourceType',
        'mrvisser'
      );
      const principalId2 = AuthzUtil.toId(
        PrincipalTypes.GROUP,
        'testGetRolesForPrincipalsAndResourceType',
        'simong'
      );

      // Mrvisser has 'viewer' role on a bunch of groups
      loadContentRoles(
        principalId1,
        baseViewerContentId,
        ResourceTypes.CONTENT,
        300,
        'viewer',
        () => {
          // Simong has 'manager' role on some of the groups that mrvisser has 'viewer' on. this is to test aggregation of roles
          loadContentRoles(
            principalId2,
            baseViewerContentId,
            ResourceTypes.CONTENT,
            50,
            'manager',
            () => {
              // Simong has 'manager' role on a bunch of groups
              loadContentRoles(
                principalId2,
                baseManagerContentId,
                ResourceTypes.CONTENT,
                300,
                'manager',
                () => {
                  // Make sure they work together
                  AuthzAPI.getRolesForPrincipalsAndResourceType(
                    [principalId1, principalId2],
                    ResourceTypes.CONTENT,
                    (error, entries) => {
                      assert.notExists(error);

                      /**
                       * Simong is a member of 350, mrvisser is a member of 300,
                       * but 50 of those overlap, so should be 600 unique entries
                       */
                      assert.lengthOf(keys(entries), 2);
                      assert.lengthOf(keys(entries[principalId1]), 300);
                      assert.lengthOf(keys(entries[principalId2]), 350);

                      /**
                       * Verify that mrvisser is a viewer of all items, and that simong is a
                       * manager of all items
                       */
                      forEach((role /* , resourceId */) => {
                        assert.strictEqual(role, 'viewer');
                      }, entries[principalId1]);

                      forEach((role /* , resourceId */) => {
                        assert.strictEqual(role, 'manager');
                      }, entries[principalId2]);

                      // Make sure they work individually
                      AuthzAPI.getRolesForPrincipalsAndResourceType(
                        [principalId1],
                        ResourceTypes.CONTENT,
                        (error, entries) => {
                          assert.notExists(error);
                          assert.lengthOf(keys(entries), 1);
                          assert.lengthOf(keys(entries[principalId1]), 300);

                          AuthzAPI.getRolesForPrincipalsAndResourceType(
                            [principalId2],
                            ResourceTypes.CONTENT,
                            (error, entries) => {
                              assert.notExists(error);
                              assert.lengthOf(keys(entries), 1);
                              assert.lengthOf(keys(entries[principalId2]), 350);

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

    it('verify validation', (callback) => {
      const principalId1 = AuthzUtil.toId(
        PrincipalTypes.USER,
        'testGetRolesForPrincipalsAndResourceType',
        'mrvisser'
      );
      // Try it with no provided principals
      AuthzAPI.getRolesForPrincipalsAndResourceType(
        undefined,
        ResourceTypes.CONTENT,
        (error, entries) => {
          assert.ok(error);
          assert.isNotOk(entries);
          // Try it with no resource type
          AuthzAPI.getRolesForPrincipalsAndResourceType(
            [principalId1],
            undefined,
            (error, entries) => {
              assert.ok(error);
              assert.isNotOk(entries);
              callback();
            }
          );
        }
      );
    });
  });
});
