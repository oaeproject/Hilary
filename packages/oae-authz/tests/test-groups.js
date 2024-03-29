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
import _ from 'underscore';
import { assoc, propEq, none } from 'ramda';
import shortid from 'shortid';

import AuthzGraph from 'oae-authz/lib/internal/graph.js';
import * as TestsUtil from 'oae-tests/lib/util.js';
import * as AuthzAPI from 'oae-authz';
import * as AuthzTestUtil from 'oae-authz/lib/test/util.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';

describe('Authz Groups', () => {
  /**
   * Verifies that the user does not have any membership in the provided group
   *
   * @param  {String}      groupId    The id of the group to check
   * @param  {String}      memberId   The id of the principal to check
   * @param  {Function}    callback   Standard callback function
   */
  const verifyNoBidirectionalGroupMembership = function (groupId, memberId, callback) {
    AuthzAPI.hasAnyRole(memberId, groupId, (error, hasRole) => {
      assert.notExists(error);
      assert.isNotOk(hasRole);

      AuthzAPI.getAuthzMembers(groupId, undefined, undefined, (error, members) => {
        assert.notExists(error);
        assert.ok(members);
        assert.isTrue(none(propEq('id', memberId), members));
        callback();
      });
    });
  };

  /**
   * Verifies that the user has membership in the provided group both by group memberships and
   * role checks
   *
   * @param  {String}      groupId    The id of the group to check
   * @param  {String}      memberId   The id of the principal to check
   * @param  {Function}    callback   Standard callback function
   */
  const verifyBidirectionalGroupMembership = function (groupId, memberId, role, callback) {
    AuthzAPI.hasRole(memberId, groupId, role, (error, hasRole) => {
      assert.notExists(error);
      assert.ok(hasRole);

      // Also verify from the group membership
      AuthzAPI.getAuthzMembers(groupId, undefined, undefined, (error, members) => {
        assert.notExists(error);
        assert.ok(members);
        assert.ok(
          _.find(members, (member) => {
            if (member.id === memberId) {
              return member.role;
            }
          })
        );
        callback();
      });
    });
  };

  /**
   * Create a reverse membership chain, ensuring that the latest lexical group is closer
   * to the user in membership, and the closest lexical group is the furthest away
   *
   * @param  {Function}   callback            Standard callback function
   * @param  {String}     callback.userId     The user that will create group 5
   * @param  {String}     callback.groupId1   The first (and top-level) group
   * @param  {String}     callback.groupId2   The second group who is a member of group1
   * @param  {String}     callback.groupId3   The third group who is a member of group2
   * @param  {String}     callback.groupId4   The fourth group who is a member of group3
   * @param  {String}     callback.groupId5   The bottom group of which the user is a member
   * @throws {Error}                          An assertion error is thrown if the membership chain could not be setup
   */
  const _setupMembershipChain = function (callback) {
    const groupId1 = AuthzUtil.toId('g', 'ipm-order', '1');
    const groupId2 = AuthzUtil.toId('g', 'ipm-order', '2');
    const groupId3 = AuthzUtil.toId('g', 'ipm-order', '3');
    const groupId4 = AuthzUtil.toId('g', 'ipm-order', '4');
    const groupId5 = AuthzUtil.toId('g', 'ipm-order', '5');
    const userId = AuthzUtil.toId('u', 'ipm-order', 'mrvisser');

    AuthzAPI.updateRoles(groupId5, assoc(userId, 'member', {}), (error) => {
      assert.notExists(error);
      AuthzAPI.updateRoles(groupId4, assoc(groupId5, 'member', {}), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(groupId3, assoc(groupId4, 'member', {}), (error) => {
          assert.notExists(error);
          AuthzAPI.updateRoles(groupId2, assoc(groupId3, 'member', {}), (error) => {
            assert.notExists(error);
            AuthzAPI.updateRoles(groupId1, assoc(groupId2, 'member', {}), (error) => {
              assert.notExists(error);

              return callback(userId, groupId1, groupId2, groupId3, groupId4, groupId5);
            });
          });
        });
      });
    });
  };

  describe('Add group member', () => {
    it('verify invalid group id error', (callback) => {
      AuthzAPI.updateRoles(
        'not a valid id',
        assoc('u:cam:mrvisser', 'member', {}),
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.isNotOk(usersInvalidated);
          return callback();
        }
      );
    });

    it('verify non-group group id error', (callback) => {
      AuthzAPI.updateRoles(
        'u:cam:mrvisser',
        assoc('u:cam:mrvisser', 'member', {}),
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.ok(!usersInvalidated);
          return callback();
        }
      );
    });

    it('verify invalid member id error', (callback) => {
      AuthzAPI.updateRoles(
        'g:oae:oae-team',
        assoc('not a valid id', 'member', {}),
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.isNotOk(usersInvalidated);
          return callback();
        }
      );
    });

    it('verify non-principal member id error', (callback) => {
      AuthzAPI.updateRoles(
        'g:oae:oae-team',
        assoc('c:content:id', 'member', {}),
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.isNotOk(usersInvalidated);
          return callback();
        }
      );
    });

    it('verify null role error', (callback) => {
      AuthzAPI.updateRoles(
        'g:oae:oae-team',
        assoc('u:cam:mrvisser', null, {}),
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.isNotOk(usersInvalidated);
          return callback();
        }
      );
    });

    it('verify undefined role error', (callback) => {
      AuthzAPI.updateRoles(
        'g:oae:oae-team',
        assoc('u:cam:mrvisser', undefined, {}),
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.ok(!usersInvalidated);
          return callback();
        }
      );
    });

    it('verify user gets added to group', (callback) => {
      const groupId = 'g:agm-add-user:oae-team';
      const memberId = 'u:agm-add-user:mrvisser';
      AuthzAPI.updateRoles(groupId, assoc(memberId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.strictEqual(usersInvalidated.length, 1);
        assert.strictEqual(usersInvalidated[0], memberId);
        return verifyBidirectionalGroupMembership(groupId, memberId, 'member', callback);
      });
    });

    it('verify update user membership role', (callback) => {
      const groupId = 'g:agm-update-user:oae-team';
      const memberId = 'u:agm-update-user:mrvisser';
      AuthzAPI.updateRoles(groupId, assoc(memberId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.strictEqual(usersInvalidated.length, 1);
        assert.strictEqual(usersInvalidated[0], memberId);

        verifyBidirectionalGroupMembership(groupId, memberId, 'member', () => {
          AuthzAPI.updateRoles(
            groupId,
            assoc(memberId, 'manager', {}),
            (error, usersInvalidated) => {
              assert.notExists(error);
              assert.strictEqual(usersInvalidated.length, 1);
              assert.strictEqual(usersInvalidated[0], memberId);

              verifyBidirectionalGroupMembership(groupId, memberId, 'manager', () => {
                // Also ensure that the number of members in the group is still 1
                AuthzAPI.getAuthzMembers(groupId, undefined, undefined, (error, members) => {
                  assert.notExists(error);
                  assert.lengthOf(members, 1);
                  return callback();
                });
              });
            }
          );
        });
      });
    });

    it('verify group gets added to group', (callback) => {
      const groupId = 'g:agm-add-group:oae-team';
      const memberId = 'g:agm-add-group:mrvisser';
      AuthzAPI.updateRoles(groupId, assoc(memberId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.strictEqual(usersInvalidated.length, 0);

        // Verify membership exists VIA roles api (bottom-to-top association)
        AuthzAPI.hasRole(memberId, groupId, 'member', (error, hasRole) => {
          assert.notExists(error);
          assert.ok(hasRole);

          // Verify membership exists VIA groups api (top-to-bottom association)
          AuthzAPI.getAuthzMembers(groupId, undefined, undefined, (error, members) => {
            assert.notExists(error);
            assert.lengthOf(members, 1);
            return callback();
          });
        });
      });
    });
  });

  describe('Remove group member', () => {
    it('verify invalid group id error', (callback) => {
      AuthzAPI.updateRoles(
        'not a valid id',
        assoc('u:cam:mrvisser', false, {}),
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.isNotOk(usersInvalidated);
          assert.isNotOk(usersInvalidated);
          return callback();
        }
      );
    });

    it('verify non-group group id error', (callback) => {
      AuthzAPI.updateRoles(
        'u:cam:mrvisser',
        assoc('u:cam:mrvisser', false, {}),
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.isNotOk(usersInvalidated);
          return callback();
        }
      );
    });

    it('verify invalid member id error', (callback) => {
      AuthzAPI.updateRoles(
        'g:oae:oae-team',
        assoc('not a valid id', false, {}),
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.isNotOk(usersInvalidated);
          return callback();
        }
      );
    });

    it('verify non-principal member id error', (callback) => {
      AuthzAPI.updateRoles(
        'g:oae:oae-team',
        assoc('c:content:id', false, {}),
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.isNotOk(usersInvalidated);
          return callback();
        }
      );
    });

    it('verify user gets removed from group', (callback) => {
      const groupId = 'g:rgm-remove-user:oae-team';
      const memberId = 'u:rgm-remove-user:mrvisser';

      // 1. add the user
      AuthzAPI.updateRoles(groupId, assoc(memberId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.strictEqual(usersInvalidated.length, 1);
        assert.strictEqual(usersInvalidated[0], memberId);

        // 2. sanity check the membership
        verifyBidirectionalGroupMembership(groupId, memberId, 'member', () => {
          // 3. remove the user
          AuthzAPI.updateRoles(groupId, assoc(memberId, false, {}), (error, usersInvalidated) => {
            assert.notExists(error);
            assert.strictEqual(usersInvalidated.length, 1);
            assert.strictEqual(usersInvalidated[0], memberId);

            // Verify they are removed
            verifyNoBidirectionalGroupMembership(groupId, memberId, callback);
          });
        });
      });
    });

    it('verify group gets removed from group', (callback) => {
      const groupId = 'g:rgm-remove-user:oae-team';
      const memberId = 'g:rgm-remove-user:mrvisser';

      // 1. add the group
      AuthzAPI.updateRoles(groupId, assoc(memberId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.strictEqual(usersInvalidated.length, 0);

        // 2. sanity check group is added
        verifyBidirectionalGroupMembership(groupId, memberId, 'member', () => {
          // 3. remove the group
          AuthzAPI.updateRoles(groupId, assoc(memberId, false, {}), (error, usersInvalidated) => {
            assert.notExists(error);
            assert.strictEqual(usersInvalidated.length, 0);

            // 4. verify the user is removed
            verifyNoBidirectionalGroupMembership(groupId, memberId, callback);
          });
        });
      });
    });
  });

  describe('#updateAuthzGroupMembers()', () => {
    it('verify invalid group id error', (callback) => {
      AuthzAPI.updateRoles(
        'not a valid id',
        { 'u:cam:mrvisser': 'member' },
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.ok(!usersInvalidated);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    it('verify non-group group id error', (callback) => {
      AuthzAPI.updateRoles(
        'u:cam:mrvisser',
        { 'u:cam:mrvisser': 'member' },
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.ok(!usersInvalidated);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    it('verify invalid member id error', (callback) => {
      AuthzAPI.updateRoles(
        'g:oae:oae-team',
        { 'not a valid id': 'member' },
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.ok(!usersInvalidated);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    it('verify non-principal member id error', (callback) => {
      AuthzAPI.updateRoles(
        'g:oae:oae-team',
        { 'c:oae:mrvisser': 'member' },
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.ok(!usersInvalidated);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    it('verify null role error', (callback) => {
      AuthzAPI.updateRoles(
        'g:oae:oae-team',
        { 'u:cam:mrvisser': null },
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.ok(!usersInvalidated);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    it('verify undefined role error', (callback) => {
      AuthzAPI.updateRoles(
        'g:oae:oae-team',
        { 'u:cam:mrvisser': undefined },
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.ok(!usersInvalidated);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    it('verify blank role error', (callback) => {
      AuthzAPI.updateRoles(
        'g:oae:oae-team',
        { 'u:cam:mrvisser': '  ' },
        (error, usersInvalidated) => {
          assert.ok(error);
          assert.ok(!usersInvalidated);
          assert.strictEqual(error.code, 400);
          return callback();
        }
      );
    });

    it('verify general functionality', (callback) => {
      const groupId = 'g:agmc-general:oae-team';
      const mrvisserId = 'u:agmc-general:mrvisser';
      const simongId = 'u:agmc-general:simong';
      const bertId = 'u:agmc-general:physx';
      const nicoId = 'u:agmc-general:nicolaas';

      const changes = {};
      changes[mrvisserId] = 'member';
      changes[simongId] = 'manager';
      changes[bertId] = 'manager';
      changes[nicoId] = 'member';

      AuthzAPI.updateRoles(groupId, changes, (error, usersInvalidated) => {
        assert.notExists(error);
        assert.strictEqual(usersInvalidated.length, 4);

        verifyBidirectionalGroupMembership(groupId, mrvisserId, 'member', () => {
          verifyBidirectionalGroupMembership(groupId, simongId, 'manager', () => {
            verifyBidirectionalGroupMembership(groupId, bertId, 'manager', () => {
              verifyBidirectionalGroupMembership(groupId, nicoId, 'member', () => {
                // Now inverse the group roles and check
                changes[mrvisserId] = 'manager';
                changes[simongId] = 'member';
                changes[bertId] = 'member';
                changes[nicoId] = 'manager';

                AuthzAPI.updateRoles(groupId, changes, (error, usersInvalidated) => {
                  assert.notExists(error);
                  assert.strictEqual(usersInvalidated.length, 4);

                  verifyBidirectionalGroupMembership(groupId, mrvisserId, 'manager', () => {
                    verifyBidirectionalGroupMembership(groupId, simongId, 'member', () => {
                      verifyBidirectionalGroupMembership(groupId, bertId, 'member', () => {
                        verifyBidirectionalGroupMembership(groupId, nicoId, 'manager', () => {
                          // Now remove mrvisser and nico, while setting bert and simon back to manager
                          changes[mrvisserId] = false;
                          changes[simongId] = 'manager';
                          changes[bertId] = 'manager';
                          changes[nicoId] = false;

                          AuthzAPI.updateRoles(groupId, changes, (error, usersInvalidated) => {
                            assert.notExists(error);
                            assert.strictEqual(usersInvalidated.length, 4);

                            verifyNoBidirectionalGroupMembership(groupId, mrvisserId, () => {
                              verifyNoBidirectionalGroupMembership(groupId, nicoId, () => {
                                verifyBidirectionalGroupMembership(
                                  groupId,
                                  simongId,
                                  'manager',
                                  () => {
                                    verifyBidirectionalGroupMembership(
                                      groupId,
                                      bertId,
                                      'manager',
                                      callback
                                    );
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
        });
      });
    });
  });

  describe('#getAuthzMembers()', () => {
    it('verify invalid group id error', (callback) => {
      AuthzAPI.getAuthzMembers('not a valid id', undefined, undefined, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify non-group group id error', (callback) => {
      AuthzAPI.getAuthzMembers('u:cam:mrvisser', undefined, undefined, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify get user from group', (callback) => {
      const groupId = 'g:ggm-get:oae-team';
      const memberId = 'u:ggm-get:mrvisser';
      AuthzAPI.updateRoles(groupId, assoc(memberId, 'member', {}), (error) => {
        assert.notExists(error);
        AuthzAPI.getAuthzMembers(groupId, undefined, undefined, (error, members) => {
          assert.notExists(error);
          assert.ok(members);
          assert.strictEqual(members.length, 1);
          assert.strictEqual(members[0].id, memberId);
          callback();
        });
      });
    });

    it('verify user paging', (callback) => {
      const groupId = 'g:ggm-paging:oae-team';
      const memberIds = TestsUtil.generateResourceIds(11, 'u', 'ggm-paging');

      const changes = {};
      for (const element of memberIds) {
        changes[element] = 'member';
      }

      AuthzAPI.updateRoles(groupId, changes, (error) => {
        assert.notExists(error);
        AuthzAPI.getAuthzMembers(groupId, undefined, 10, (error, members, nextToken) => {
          assert.notExists(error);
          assert.strictEqual(members.length, 10);
          assert.strictEqual(nextToken, members[9].id);

          AuthzAPI.getAuthzMembers(groupId, members[9].id, 10, (error, members, nextToken) => {
            assert.notExists(error);
            assert.strictEqual(members.length, 1);
            assert.ok(!nextToken);
            callback();
          });
        });
      });
    });
  });

  describe('#getIndirectPrincipalMemberships()', () => {
    /**
     * Retrieve the indirect memberships for a principal and assert they match a given set of group ids
     *
     * @param  {String}         principalId             The principal for which to retrieve the indirect group memberships
     * @param  {String}         start                   Determines the point at which indirect group memberships members are returned for paging purposes.  If not provided, the first x elements will be returned
     * @param  {Number}         limit                   Number of indirect group memberships to return. Will default to 10 if not provided
     * @param  {Function}       callback                Standard callback function
     * @param  {String[]}       callback.groups         An array of group ids representing the indirect groups to which the user belongs
     * @param  {String}         callback.nextToken      The value to provide in the `start` parameter to get the next set of results
     * @throws {Error}                                  An assertion error is thrown if an error occurs or the retrieved groups don't match the expected groups
     */
    const assertIndirectMemberships = function (
      principalId,
      start,
      limit,
      expectedGroups,
      callback
    ) {
      AuthzAPI.getIndirectPrincipalMemberships(
        principalId,
        start,
        limit,
        (error, groupIds, nextToken) => {
          assert.notExists(error);
          assert.deepStrictEqual(groupIds, expectedGroups);
          return callback(groupIds, nextToken);
        }
      );
    };

    /**
     * Test that ensures that the initial request of loading up the authz memberships indirect
     * cache results in a list of ids that are equivalent in lexigraphical order and also return
     * the correct nextToken
     */
    it('verify paging on freshly cached authz memberships indirect cache', (callback) => {
      _setupMembershipChain((userId, groupId1, groupId2, groupId3, groupId4 /* , groupId5 */) => {
        // Get 3 memberships for our user for the first time, ensuring we get the first 3 lexical groups
        assertIndirectMemberships(
          userId,
          null,
          3,
          [groupId1, groupId2, groupId3],
          (groupIds, nextToken) => {
            // Ensure subsequent request gets the last indirect group membership
            assertIndirectMemberships(
              userId,
              nextToken,
              3,
              [groupId4],
              (/* groupIds, nextToken */) => callback()
            );
          }
        );
      });
    });

    /**
     * Test that verifies the indirect membership cache is invalidated on updates
     */
    it('verify cache invalidation', (callback) => {
      _setupMembershipChain((userId, groupId1, groupId2, groupId3, groupId4, groupId5) => {
        // Get the indirect memberships for our user and a group so they get cached
        assertIndirectMemberships(
          userId,
          null,
          null,
          [groupId1, groupId2, groupId3, groupId4],
          (/* groupIds, nextToken */) => {
            assertIndirectMemberships(
              groupId5,
              null,
              null,
              [groupId1, groupId2, groupId3],
              (/* groupIds, nextToken */) => {
                // Remove group4 as a member of group3. This will leave the user with
                // only 1 indirect group membership (group4) and group5 with 0 indirect memberships
                AuthzAPI.updateRoles(
                  groupId3,
                  assoc(groupId4, false, {}),
                  (error, usersInvalidated) => {
                    assert.notExists(error);
                    assert.lengthOf(usersInvalidated, 1);
                    assert.strictEqual(usersInvalidated[0], userId);

                    // Get all the indirect memberships for the user, he should only be an indirect member of group4
                    assertIndirectMemberships(
                      userId,
                      null,
                      null,
                      [groupId4],
                      (/* groupIds, nextToken */) => {
                        // Get all the indirect memberships for group5, it should have no indirect memberships
                        assertIndirectMemberships(
                          groupId5,
                          null,
                          null,
                          [],
                          (/* groupIds, nextToken */) => {
                            // Restore the link between group3 and group4
                            AuthzAPI.updateRoles(
                              groupId3,
                              assoc(groupId4, 'member', {}),
                              (error, usersInvalidated) => {
                                assert.notExists(error);
                                assert.lengthOf(usersInvalidated, 1);
                                assert.strictEqual(usersInvalidated[0], userId);

                                // Get all the indirect memberships for the user, he should be an indirect member of all 4 groups again
                                assertIndirectMemberships(
                                  userId,
                                  null,
                                  null,
                                  [groupId1, groupId2, groupId3, groupId4],
                                  (/* groupIds, nextToken */) => {
                                    // Get all the indrect memberships for group5, it should be an indirect member of group 1, 2 and 3
                                    assertIndirectMemberships(
                                      groupId5,
                                      null,
                                      null,
                                      [groupId1, groupId2, groupId3],
                                      (/* groupIds, nextToken */) => callback()
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
     * Test that verifies invalid principal ids result in a validation error
     */
    it('verify invalid principal id', (callback) => {
      AuthzAPI.getIndirectPrincipalMemberships('not an id', undefined, undefined, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        return callback();
      });
    });

    /**
     * Test that verifies non principal ids result in a validation error
     */
    it('verify non-principal id', (callback) => {
      AuthzAPI.getIndirectPrincipalMemberships('c:cam:Foo.docx', undefined, undefined, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        return callback();
      });
    });

    /**
     * Test that verifies an empty membership is returned as an empty array
     */
    it('verify empty membership is an empty array', (callback) => {
      const userId = AuthzUtil.toId('u', 'ipm-empty', 'mrvisser');
      AuthzAPI.getIndirectPrincipalMemberships(userId, undefined, undefined, (error, groupIds) => {
        assert.notExists(error);
        assert.ok(groupIds);
        assert.strictEqual(groupIds.length, 0);
        return callback();
      });
    });

    /**
     * Test that verifies that only being a direct member of a single that is itself not a member
     * of other groups returns an empty array
     */
    it('verify single group membership results in empty indirect membership', (callback) => {
      const groupId = AuthzUtil.toId('g', 'ipm-single', 'oae-team');
      const userId = AuthzUtil.toId('u', 'ipm-single', 'mrvisser');
      AuthzAPI.updateRoles(groupId, assoc(userId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.strictEqual(usersInvalidated.length, 1);
        assert.strictEqual(usersInvalidated[0], userId);

        // Get the indirect memberships uncached
        AuthzAPI.getIndirectPrincipalMemberships(
          userId,
          undefined,
          undefined,
          (error, groupIds) => {
            assert.notExists(error);
            assert.ok(groupIds);
            assert.strictEqual(groupIds.length, 0);

            // Get the indirect memberships cached
            AuthzAPI.getIndirectPrincipalMemberships(
              userId,
              undefined,
              undefined,
              (error, groupIds) => {
                assert.notExists(error);
                assert.ok(groupIds);
                assert.strictEqual(groupIds.length, 0);
                return callback();
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that being a direct member of groups without a membership returns an empty array
     */
    it('verify two direct group memberships results in empty indirect membership', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'ipm-two', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'ipm-two', 'oae-backend-team');
      const userId = AuthzUtil.toId('u', 'ipm-two', 'mrvisser');
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.strictEqual(usersInvalidated.length, 1);
        assert.strictEqual(usersInvalidated[0], userId);

        AuthzAPI.updateRoles(groupId2, assoc(userId, 'member', {}), (error, usersInvalidated) => {
          assert.notExists(error);
          assert.strictEqual(usersInvalidated.length, 1);
          assert.strictEqual(usersInvalidated[0], userId);

          // Get the memberships uncached
          AuthzAPI.getIndirectPrincipalMemberships(
            userId,
            undefined,
            undefined,
            (error, groupIds) => {
              assert.notExists(error);
              assert.ok(groupIds);
              assert.strictEqual(groupIds.length, 0);

              // Get the memberships cached
              AuthzAPI.getIndirectPrincipalMemberships(
                userId,
                undefined,
                undefined,
                (error, groupIds) => {
                  assert.notExists(error);
                  assert.ok(groupIds);
                  assert.strictEqual(groupIds.length, 0);
                  return callback();
                }
              );
            }
          );
        });
      });
    });

    /**
     * Test that a simple group hierarchy can be resolved and returns the correct indirect membership results
     */
    it('verify simple group hierarchy', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'ipm-hier', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'ipm-hier', 'oae-backend-team');
      const nonMemberGroupId3 = AuthzUtil.toId('g', 'ipm-hier', 'non-member');
      const userId = AuthzUtil.toId('u', 'ipm-hier', 'mrvisser');
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.lengthOf(usersInvalidated, 1);
        assert.strictEqual(usersInvalidated[0], userId);

        AuthzAPI.updateRoles(
          groupId1,
          assoc(nonMemberGroupId3, 'member', {}),
          (error, usersInvalidated) => {
            assert.notExists(error);
            assert.strictEqual(usersInvalidated.length, 0);

            AuthzAPI.updateRoles(
              groupId2,
              assoc(groupId1, 'member', {}),
              (error, usersInvalidated) => {
                assert.notExists(error);
                assert.lengthOf(usersInvalidated, 1);
                assert.strictEqual(usersInvalidated[0], userId);

                // Get the indirect memberships uncached
                AuthzAPI.getIndirectPrincipalMemberships(
                  userId,
                  undefined,
                  undefined,
                  (error, groupIds) => {
                    assert.notExists(error);
                    assert.ok(groupIds);
                    assert.lengthOf(groupIds, 1);
                    assert.strictEqual(groupIds[0], groupId2);

                    // Get the indirect memberships cached
                    AuthzAPI.getIndirectPrincipalMemberships(
                      userId,
                      undefined,
                      undefined,
                      (error, groupIds) => {
                        assert.notExists(error);
                        assert.ok(groupIds);
                        assert.lengthOf(groupIds, 1);
                        assert.strictEqual(groupIds[0], groupId2);
                        return callback();
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
     * Test that verifies that circular group hierarchies can be dealt with
     */
    it('verify circular group hierarchy', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'ipm-circ', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'ipm-circ', 'oae-backend-team');
      const groupId3 = AuthzUtil.toId('g', 'ipm-circ', 'oae-ui-team');
      const userId = AuthzUtil.toId('u', 'ipm-circ', 'mrvisser');
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.strictEqual(usersInvalidated.length, 1);
        assert.strictEqual(usersInvalidated[0], userId);

        AuthzAPI.updateRoles(groupId2, assoc(groupId1, 'member', {}), (error, usersInvalidated) => {
          assert.notExists(error);
          assert.strictEqual(usersInvalidated.length, 1);
          assert.strictEqual(usersInvalidated[0], userId);
          AuthzAPI.updateRoles(
            groupId3,
            assoc(groupId2, 'member', {}),
            (error, usersInvalidated) => {
              assert.notExists(error);
              assert.strictEqual(usersInvalidated.length, 1);
              assert.strictEqual(usersInvalidated[0], userId);
              AuthzAPI.updateRoles(
                groupId1,
                assoc(groupId3, 'member', {}),
                (error, usersInvalidated) => {
                  assert.notExists(error);
                  assert.strictEqual(usersInvalidated.length, 1);
                  assert.strictEqual(usersInvalidated[0], userId);

                  // Get the indirect memberships uncached
                  AuthzAPI.getIndirectPrincipalMemberships(
                    userId,
                    undefined,
                    undefined,
                    (error, groupIds) => {
                      assert.notExists(error);
                      assert.ok(groupIds);

                      // The indirect memberships does not contain groupId1 because, while the user is indirectly
                      // a member VIA circular hierarchy, they are actually directly a member, therefore it is
                      // not part of the strict indirect memberships list
                      assert.strictEqual(groupIds.length, 2);
                      assert.ok(_.contains(groupIds, groupId2));
                      assert.ok(_.contains(groupIds, groupId3));

                      // Get the indirect memberships cached
                      AuthzAPI.getIndirectPrincipalMemberships(
                        userId,
                        undefined,
                        undefined,
                        (error, groupIds) => {
                          assert.notExists(error);
                          assert.ok(groupIds);
                          assert.strictEqual(groupIds.length, 2);
                          assert.ok(_.contains(groupIds, groupId2));
                          assert.ok(_.contains(groupIds, groupId3));
                          return callback();
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
     * Test that verifies that the list of user memberships is properly paged
     */
    it('verify paging', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'ipm-pag', 'oae-group1');
      const groupId2 = AuthzUtil.toId('g', 'ipm-pag', 'oae-group2');
      const groupId3 = AuthzUtil.toId('g', 'ipm-pag', 'oae-group3');
      const groupId4 = AuthzUtil.toId('g', 'ipm-pag', 'oae-group4');
      const groupId5 = AuthzUtil.toId('g', 'ipm-pag', 'oae-group5');
      const groupId6 = AuthzUtil.toId('g', 'ipm-pag', 'oae-group6');
      const groupId7 = AuthzUtil.toId('g', 'ipm-pag', 'oae-group7');
      const userId = AuthzUtil.toId('u', 'ipm-pag', 'mrvisser');

      // Make an indirect membership chain
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(groupId2, assoc(groupId1, 'manager', {}), (error) => {
          assert.notExists(error);
          AuthzAPI.updateRoles(groupId3, assoc(groupId1, 'member', {}), (error) => {
            assert.notExists(error);
            AuthzAPI.updateRoles(groupId4, assoc(groupId1, 'member', {}), (error) => {
              assert.notExists(error);
              AuthzAPI.updateRoles(groupId5, assoc(groupId1, 'manager', {}), (error) => {
                assert.notExists(error);
                AuthzAPI.updateRoles(groupId6, assoc(groupId1, 'member', {}), (error) => {
                  assert.notExists(error);
                  AuthzAPI.updateRoles(groupId7, assoc(groupId1, 'manager', {}), (error) => {
                    assert.notExists(error);

                    // Get the paged indirect memberships uncached
                    AuthzAPI.getIndirectPrincipalMemberships(
                      userId,
                      groupId3,
                      3,
                      (error, groupIds, nextToken) => {
                        assert.notExists(error);
                        assert.ok(groupIds);
                        assert.strictEqual(groupIds.length, 3);
                        assert.ok(_.contains(groupIds, groupId4));
                        assert.ok(_.contains(groupIds, groupId5));
                        assert.ok(_.contains(groupIds, groupId6));
                        assert.strictEqual(nextToken, groupIds[2]);

                        // Get the paged indirect memberships cached
                        AuthzAPI.getIndirectPrincipalMemberships(
                          userId,
                          groupId3,
                          3,
                          (error, groupIds, nextToken) => {
                            assert.notExists(error);
                            assert.ok(groupIds);
                            assert.strictEqual(groupIds.length, 3);
                            assert.ok(_.contains(groupIds, groupId4));
                            assert.ok(_.contains(groupIds, groupId5));
                            assert.ok(_.contains(groupIds, groupId6));
                            assert.strictEqual(nextToken, groupIds[2]);
                            return callback();
                          }
                        );
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

  describe('#getAllIndirectPrincipalMemberships()', () => {
    /**
     * Retrieve the indirect memberships for a principal and assert they match a given set of group ids
     *
     * @param  {String}     principalId             The principal for which to retrieve the indirect group memberships
     * @param  {String[]}   expectedGroupIds        The expected group ids
     * @param  {Function}   callback                Standard callback function
     * @param  {String[]}   callback.groups         An array of group ids representing the indirect groups to which the user belongs
     * @throws {Error}                              An assertion error is thrown if an error occurs or the retrieved groups don't match the expected groups
     */
    const _assertAllIndirectMembershipsEquals = function (principalId, expectedGroupIds, callback) {
      AuthzAPI.getAllIndirectPrincipalMemberships(principalId, (error, groupIds) => {
        assert.notExists(error);
        assert.deepStrictEqual(groupIds.sort(), [...expectedGroupIds].sort());
        return callback();
      });
    };

    /**
     * Test that verifies the indirect membership cache is invalidated on updates
     */
    it('verify cache invalidation', (callback) => {
      _setupMembershipChain((userId, groupId1, groupId2, groupId3, groupId4, groupId5) => {
        // Get the indirect memberships for our user and a group so they get cached
        _assertAllIndirectMembershipsEquals(
          userId,
          [groupId1, groupId2, groupId3, groupId4],
          () => {
            _assertAllIndirectMembershipsEquals(groupId5, [groupId1, groupId2, groupId3], () => {
              // Remove group4 as a member of group3. This will leave the user with only 1
              // indirect group membership (group4) and group5 with 0 indirect memberships
              AuthzAPI.updateRoles(
                groupId3,
                assoc(groupId4, false, {}),
                (error, usersInvalidated) => {
                  assert.notExists(error);
                  assert.strictEqual(usersInvalidated.length, 1);
                  assert.strictEqual(usersInvalidated[0], userId);

                  // Get all the indirect memberships for the user, he should only be an
                  // indirect member of group4
                  _assertAllIndirectMembershipsEquals(userId, [groupId4], () => {
                    // Get all the indirect memberships for group5, it should have no
                    // indirect memberships
                    _assertAllIndirectMembershipsEquals(groupId5, [], () => {
                      // Restore the link between group3 and group4
                      AuthzAPI.updateRoles(
                        groupId3,
                        assoc(groupId4, 'member', {}),
                        (error, usersInvalidated) => {
                          assert.notExists(error);
                          assert.strictEqual(usersInvalidated.length, 1);
                          assert.strictEqual(usersInvalidated[0], userId);

                          // Get all the indirect memberships for the user, he should
                          // be an indirect member of all 4 groups again
                          _assertAllIndirectMembershipsEquals(
                            userId,
                            [groupId1, groupId2, groupId3, groupId4],
                            () => {
                              // Get all the indrect memberships for group5, it should
                              // be an indirect member of group 1, 2 and 3
                              _assertAllIndirectMembershipsEquals(
                                groupId5,
                                [groupId1, groupId2, groupId3],
                                () => callback()
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
          }
        );
      });
    });

    /**
     * Test that verifies invalid principal ids result in a validation error
     */
    it('verify invalid principal id', (callback) => {
      AuthzAPI.getAllIndirectPrincipalMemberships('not an id', (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        return callback();
      });
    });

    /**
     * Test that verifies non principal ids result in a validation error
     */
    it('verify non-principal id', (callback) => {
      AuthzAPI.getAllIndirectPrincipalMemberships('c:cam:Foo.docx', (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        return callback();
      });
    });

    /**
     * Test that verifies an empty membership is returned as an empty array
     */
    it('verify empty membership is an empty array', (callback) => {
      const userId = AuthzUtil.toId('u', 'ipm-empty', 'mrvisser');
      AuthzAPI.getAllIndirectPrincipalMemberships(userId, (error, groupIds) => {
        assert.notExists(error);
        assert.ok(groupIds);
        assert.strictEqual(groupIds.length, 0);
        return callback();
      });
    });

    /**
     * Test that verifies that only being a direct member of a single that is itself not a member
     * of other groups returns an empty array
     */
    it('verify single group membership results in empty indirect membership', (callback) => {
      const groupId = AuthzUtil.toId('g', 'ipm-single', 'oae-team');
      const userId = AuthzUtil.toId('u', 'ipm-single', 'mrvisser');
      AuthzAPI.updateRoles(groupId, assoc(userId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.strictEqual(usersInvalidated.length, 1);
        assert.strictEqual(usersInvalidated[0], userId);

        // Get the indirect memberships uncached
        AuthzAPI.getAllIndirectPrincipalMemberships(userId, (error, groupIds) => {
          assert.notExists(error);
          assert.ok(groupIds);
          assert.strictEqual(groupIds.length, 0);

          // Get the indirect memberships cached
          AuthzAPI.getAllIndirectPrincipalMemberships(userId, (error, groupIds) => {
            assert.notExists(error);
            assert.ok(groupIds);
            assert.strictEqual(groupIds.length, 0);
            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies that being a direct member of groups without a membership returns an empty array
     */
    it('verify two direct group memberships results in empty indirect membership', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'ipm-two', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'ipm-two', 'oae-backend-team');
      const userId = AuthzUtil.toId('u', 'ipm-two', 'mrvisser');
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.strictEqual(usersInvalidated.length, 1);
        assert.strictEqual(usersInvalidated[0], userId);

        AuthzAPI.updateRoles(groupId2, assoc(userId, 'member', {}), (error, usersInvalidated) => {
          assert.notExists(error);
          assert.strictEqual(usersInvalidated.length, 1);
          assert.strictEqual(usersInvalidated[0], userId);

          // Get the memberships uncached
          AuthzAPI.getAllIndirectPrincipalMemberships(userId, (error, groupIds) => {
            assert.notExists(error);
            assert.ok(groupIds);
            assert.strictEqual(groupIds.length, 0);

            // Get the memberships cached
            AuthzAPI.getAllIndirectPrincipalMemberships(userId, (error, groupIds) => {
              assert.notExists(error);
              assert.ok(groupIds);
              assert.strictEqual(groupIds.length, 0);
              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that a simple group hierarchy can be resolved and returns the correct indirect membership results
     */
    it('verify simple group hierarchy', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'ipm-hier', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'ipm-hier', 'oae-backend-team');
      const nonMemberGroupId3 = AuthzUtil.toId('g', 'ipm-hier', 'non-member');
      const userId = AuthzUtil.toId('u', 'ipm-hier', 'mrvisser');
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.lengthOf(usersInvalidated, 1);
        assert.strictEqual(usersInvalidated[0], userId);

        AuthzAPI.updateRoles(
          groupId1,
          assoc(nonMemberGroupId3, 'member', {}),
          (error, usersInvalidated) => {
            assert.notExists(error);
            assert.strictEqual(usersInvalidated.length, 0);

            AuthzAPI.updateRoles(
              groupId2,
              assoc(groupId1, 'member', {}),
              (error, usersInvalidated) => {
                assert.notExists(error);
                assert.lengthOf(usersInvalidated, 1);
                assert.strictEqual(usersInvalidated[0], userId);

                // Get the indirect memberships uncached
                AuthzAPI.getAllIndirectPrincipalMemberships(userId, (error, groupIds) => {
                  assert.notExists(error);
                  assert.ok(groupIds);
                  assert.strictEqual(groupIds.length, 1);
                  assert.strictEqual(groupIds[0], groupId2);

                  // Get the indirect memberships cached
                  AuthzAPI.getAllIndirectPrincipalMemberships(userId, (error, groupIds) => {
                    assert.notExists(error);
                    assert.ok(groupIds);
                    assert.strictEqual(groupIds.length, 1);
                    assert.strictEqual(groupIds[0], groupId2);
                    return callback();
                  });
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that circular group hierarchies can be dealt with
     */
    it('verify circular group hierarchy', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'ipm-circ', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'ipm-circ', 'oae-backend-team');
      const groupId3 = AuthzUtil.toId('g', 'ipm-circ', 'oae-ui-team');
      const userId = AuthzUtil.toId('u', 'ipm-circ', 'mrvisser');
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error, usersInvalidated) => {
        assert.notExists(error);
        assert.strictEqual(usersInvalidated.length, 1);
        assert.strictEqual(usersInvalidated[0], userId);

        AuthzAPI.updateRoles(groupId2, assoc(groupId1, 'member', {}), (error, usersInvalidated) => {
          assert.notExists(error);
          assert.strictEqual(usersInvalidated.length, 1);
          assert.strictEqual(usersInvalidated[0], userId);
          AuthzAPI.updateRoles(
            groupId3,
            assoc(groupId2, 'member', {}),
            (error, usersInvalidated) => {
              assert.notExists(error);
              assert.strictEqual(usersInvalidated.length, 1);
              assert.strictEqual(usersInvalidated[0], userId);
              AuthzAPI.updateRoles(
                groupId1,
                assoc(groupId3, 'member', {}),
                (error, usersInvalidated) => {
                  assert.notExists(error);
                  assert.strictEqual(usersInvalidated.length, 1);
                  assert.strictEqual(usersInvalidated[0], userId);

                  // Get the indirect memberships uncached
                  AuthzAPI.getAllIndirectPrincipalMemberships(userId, (error, groupIds) => {
                    assert.notExists(error);
                    assert.ok(groupIds);

                    // The indirect memberships does not contain groupId1 because, while the user is indirectly
                    // a member VIA circular hierarchy, they are actually directly a member, therefore it is
                    // not part of the strict indirect memberships list
                    assert.strictEqual(groupIds.length, 2);
                    assert.ok(_.contains(groupIds, groupId2));
                    assert.ok(_.contains(groupIds, groupId3));

                    // Get the indirect memberships cached
                    AuthzAPI.getAllIndirectPrincipalMemberships(userId, (error, groupIds) => {
                      assert.notExists(error);
                      assert.ok(groupIds);
                      assert.strictEqual(groupIds.length, 2);
                      assert.ok(_.contains(groupIds, groupId2));
                      assert.ok(_.contains(groupIds, groupId3));
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

    /**
     * Test that verifies that the list of user memberships is properly paged. To do this we
     * have to ensure there are sufficient groups to iterate through (100), so we should provide
     * a fairly large number of memberships
     */
    it('verify paging', (callback) => {
      const userId = AuthzUtil.toId('u', 'aipm-p', shortid.generate());
      const groupIds = _.times(230, () => AuthzUtil.toId('g', 'aipm-p', shortid.generate()));

      const graph = new AuthzGraph();

      // Add all the principal ids as nodes
      graph.addNode(userId);
      _.each(groupIds, (groupId) => {
        graph.addNode(groupId);
      });

      // Add all the memberships as edges
      graph.addEdge(userId, _.last(groupIds));
      _.each(groupIds.slice(1), (groupId, i) => {
        graph.addEdge(groupId, groupIds[i]);
      });

      // Create the membership hierarchy
      AuthzTestUtil.assertCreateMembershipsGraphSucceeds(graph, () => {
        // Ensure the paged indirect memberships give all the groups when the cache hasn't
        // been initialized for the user
        _assertAllIndirectMembershipsEquals(userId, groupIds.slice(0, -1), () => {
          // Ensure the paged indirect memberships give all the groups when the cache has
          // been initialized for the user
          _assertAllIndirectMembershipsEquals(userId, groupIds.slice(0, -1), () => callback());
        });
      });
    });
  });

  describe('#getAuthzMembersGraph()', () => {
    /**
     * Test that verifies that an empty members graph contains just the requested principal
     */
    it('verify group with no members results in single node graph', (callback) => {
      TestsUtil.generateResourceIds(3, 'g', 'oae', (groupId1, groupId2, groupId3) => {
        // Test empty members graph for a single group
        AuthzTestUtil.assertAuthzMembersGraphIdsEqual([groupId1], [[groupId1]], (/* graph */) => {
          // Test empty members graph for multiple groups
          AuthzTestUtil.assertAuthzMembersGraphIdsEqual(
            [groupId3, groupId2, groupId1],
            [[groupId3], [groupId2], [groupId1]],
            (/* graph */) => callback()
          );
        });
      });
    });

    /**
     * Test that verifies that a group with a complex members hierarchy results in the expected
     * members graph
     */
    it('verify group members hierarchy', (callback) => {
      TestsUtil.generateResourceIds(1, 'u', 'oae', (userId) => {
        TestsUtil.generateResourceIds(4, 'g', 'oae', (groupId1, groupId2, groupId3, groupId4) => {
          // The user is a member of Group1 and Group2
          AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error) => {
            assert.notExists(error);
            AuthzAPI.updateRoles(groupId2, assoc(userId, 'manager', {}), (error) => {
              assert.notExists(error);

              // Group1 and Group2 are both members of Group3
              const change = {};
              change[groupId1] = 'manager';
              change[groupId2] = 'member';
              AuthzAPI.updateRoles(groupId3, change, (error) => {
                assert.notExists(error);

                // Group3 is a member of Group4
                AuthzAPI.updateRoles(groupId4, assoc(groupId3, 'member', {}), (error) => {
                  assert.notExists(error);

                  // Verify all the members edges exist and have the expected role for a single group
                  AuthzTestUtil.assertAuthzMembersGraphIdsEqual(
                    [groupId4],
                    [[userId, groupId1, groupId2, groupId3, groupId4]],
                    (graph) => {
                      assert.strictEqual(graph.getEdge(userId, groupId1).role, 'member');
                      assert.strictEqual(graph.getEdge(userId, groupId2).role, 'manager');
                      assert.strictEqual(graph.getEdge(groupId1, groupId3).role, 'manager');
                      assert.strictEqual(graph.getEdge(groupId2, groupId3).role, 'member');
                      assert.strictEqual(graph.getEdge(groupId3, groupId4).role, 'member');

                      // Verify all the members edges exist and have the expected role for multiple groups
                      AuthzTestUtil.assertAuthzMembersGraphIdsEqual(
                        [groupId4, groupId1],
                        [
                          [userId, groupId1, groupId2, groupId3, groupId4],
                          [userId, groupId1]
                        ],
                        (graph) => {
                          assert.strictEqual(graph.getEdge(userId, groupId1).role, 'member');
                          assert.strictEqual(graph.getEdge(userId, groupId2).role, 'manager');
                          assert.strictEqual(graph.getEdge(groupId1, groupId3).role, 'manager');
                          assert.strictEqual(graph.getEdge(groupId2, groupId3).role, 'member');
                          assert.strictEqual(graph.getEdge(groupId3, groupId4).role, 'member');

                          return callback();
                        }
                      );
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

  describe('#getPrincipalMembershipsGraph()', () => {
    /**
     * Test that verifies that a group with no memberships results in graph containing just the
     * group id
     */
    it('verify group with no memberships results in single node graph', (callback) => {
      TestsUtil.generateResourceIds(1, 'g', 'oae', (groupId) => {
        AuthzTestUtil.assertPrincipalMembershipsGraphIdsEqual(groupId, [groupId], (/* graph */) =>
          callback());
      });
    });

    /**
     * Test that verifies that a group with a complex memberships structure results in the
     * expected memberships graph
     */
    it('verify group membership hierarchy', (callback) => {
      TestsUtil.generateResourceIds(1, 'u', 'oae', (userId) => {
        TestsUtil.generateResourceIds(4, 'g', 'oae', (groupId1, groupId2, groupId3, groupId4) => {
          // Group0 is a member of Group1 and Group2
          AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error) => {
            assert.notExists(error);
            AuthzAPI.updateRoles(groupId2, assoc(userId, 'manager', {}), (error) => {
              assert.notExists(error);

              // Group1 and Group2 are both members of Group3
              const change = {};
              change[groupId1] = 'manager';
              change[groupId2] = 'member';
              AuthzAPI.updateRoles(groupId3, change, (error) => {
                assert.notExists(error);

                // Group3 is a member of Group4
                AuthzAPI.updateRoles(groupId4, assoc(groupId3, 'member', {}), (error) => {
                  assert.notExists(error);

                  // Verify all the memberships edges exist and have the expected role. This request rebuilds the memberships graph cache on the fly
                  AuthzTestUtil.assertPrincipalMembershipsGraphIdsEqual(
                    userId,
                    [userId, groupId1, groupId2, groupId3, groupId4],
                    (graph) => {
                      assert.strictEqual(graph.getEdge(userId, groupId1).role, 'member');
                      assert.strictEqual(graph.getEdge(userId, groupId2).role, 'manager');
                      assert.strictEqual(graph.getEdge(groupId1, groupId3).role, 'manager');
                      assert.strictEqual(graph.getEdge(groupId2, groupId3).role, 'member');
                      assert.strictEqual(graph.getEdge(groupId3, groupId4).role, 'member');

                      // Get the memberships graph once more to have it accessed directly from the cache and ensure it is the same
                      AuthzTestUtil.assertPrincipalMembershipsGraphIdsEqual(
                        userId,
                        [userId, groupId1, groupId2, groupId3, groupId4],
                        (graph) => {
                          assert.strictEqual(graph.getEdge(userId, groupId1).role, 'member');
                          assert.strictEqual(graph.getEdge(userId, groupId2).role, 'manager');
                          assert.strictEqual(graph.getEdge(groupId1, groupId3).role, 'manager');
                          assert.strictEqual(graph.getEdge(groupId2, groupId3).role, 'member');
                          assert.strictEqual(graph.getEdge(groupId3, groupId4).role, 'member');

                          return callback();
                        }
                      );
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

  describe('#getPrincipalMemberships()', () => {
    /**
     * Test that ensures that the initial request of loading up the authz memberships cache
     * results in a list of ids that are equivalent in lexigraphical order and also return the
     * correct nextToken
     */
    it('verify paging on freshly cached authz memberships cache', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'gmo-order', 'a');
      const groupId2 = AuthzUtil.toId('g', 'gmo-order', 'b');
      const groupId3 = AuthzUtil.toId('g', 'gmo-order', 'c');
      const groupId4 = AuthzUtil.toId('g', 'gmo-order', 'd');
      const groupId5 = AuthzUtil.toId('g', 'gmo-order', 'e');
      const userId = AuthzUtil.toId('u', 'gmo-order', 'mrvisser');

      const membershipChange = {};
      membershipChange[groupId5] = 'member';
      membershipChange[groupId4] = 'member';
      membershipChange[groupId3] = 'member';

      // Create a reverse membership chain, ensuring that the latest lexical group is closer
      // to the user in membership, and the closest lexical group is the furthest away
      AuthzAPI.updateRoles(groupId5, assoc(userId, 'member', {}), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(groupId4, assoc(groupId5, 'member', {}), (error) => {
          assert.notExists(error);
          AuthzAPI.updateRoles(groupId3, assoc(groupId4, 'member', {}), (error) => {
            assert.notExists(error);
            AuthzAPI.updateRoles(groupId2, assoc(groupId3, 'member', {}), (error) => {
              assert.notExists(error);
              AuthzAPI.updateRoles(groupId1, assoc(groupId2, 'member', {}), (error) => {
                assert.notExists(error);

                // Get 3 membership for mrvisser for the first time, ensuring we get the first 3 lexical groups
                AuthzAPI.getPrincipalMemberships(userId, null, 3, (error, groupIds, nextToken) => {
                  assert.notExists(error);
                  assert.lengthOf(groupIds, 3);
                  assert.strictEqual(groupIds[0], groupId1);
                  assert.strictEqual(groupIds[1], groupId2);
                  assert.strictEqual(groupIds[2], groupId3);

                  // Ensure subsequent request gets the next 2
                  AuthzAPI.getPrincipalMemberships(
                    userId,
                    nextToken,
                    3,
                    (error, groupIds /* , nextToken */) => {
                      assert.notExists(error);
                      assert.lengthOf(groupIds, 2);
                      assert.strictEqual(groupIds[0], groupId4);
                      assert.strictEqual(groupIds[1], groupId5);
                      return callback();
                    }
                  );
                });
              });
            });
          });
        });
      });
    });

    it('verify invalid principal id', (callback) => {
      AuthzAPI.getPrincipalMemberships('not an id', undefined, undefined, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify non-principal id', (callback) => {
      AuthzAPI.getPrincipalMemberships('c:cam:Foo.docx', undefined, undefined, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify empty membership is empty array', (callback) => {
      const userId = AuthzUtil.toId('u', 'gmo-empty', 'mrvisser');
      AuthzAPI.getPrincipalMemberships(userId, undefined, undefined, (error, groupIds) => {
        assert.notExists(error);
        assert.ok(groupIds);
        assert.strictEqual(groupIds.length, 0);
        callback();
      });
    });

    it('verify single group membership', (callback) => {
      const groupId = AuthzUtil.toId('g', 'gmo-single', 'oae-team');
      const userId = AuthzUtil.toId('u', 'gmo-single', 'mrvisser');
      AuthzAPI.updateRoles(groupId, assoc(userId, 'member', {}), (error) => {
        assert.notExists(error);

        // Get the memberships uncached
        AuthzAPI.getPrincipalMemberships(userId, undefined, undefined, (error, groupIds) => {
          assert.notExists(error);
          assert.ok(groupIds);
          assert.strictEqual(groupIds.length, 1);
          assert.strictEqual(groupIds[0], groupId);

          // Get the memberships cached
          AuthzAPI.getPrincipalMemberships(userId, undefined, undefined, (error, groupIds) => {
            assert.notExists(error);
            assert.ok(groupIds);
            assert.strictEqual(groupIds.length, 1);
            assert.strictEqual(groupIds[0], groupId);
            callback();
          });
        });
      });
    });

    it('verify two direct group membership', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'gmo-two', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'gmo-two', 'oae-backend-team');
      const userId = AuthzUtil.toId('u', 'gmo-two', 'mrvisser');
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(groupId2, assoc(userId, 'member', {}), (error) => {
          assert.notExists(error);

          // Get the memberships uncached
          AuthzAPI.getPrincipalMemberships(userId, undefined, undefined, (error, groupIds) => {
            assert.notExists(error);
            assert.ok(groupIds);
            assert.lengthOf(groupIds, 2);
            assert.include(groupIds, groupId1);
            assert.include(groupIds, groupId2);

            // Get the memberships cached
            AuthzAPI.getPrincipalMemberships(userId, undefined, undefined, (error, groupIds) => {
              assert.notExists(error);
              assert.ok(groupIds);
              assert.lengthOf(groupIds, 2);
              assert.include(groupIds, groupId1);
              assert.include(groupIds, groupId2);
              callback();
            });
          });
        });
      });
    });

    it('verify simple group hierarchy', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'gmo-hier', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'gmo-hier', 'oae-backend-team');
      const nonMemberGroupId3 = AuthzUtil.toId('g', 'gmo-hier', 'non-member');
      const userId = AuthzUtil.toId('u', 'gmo-hier', 'mrvisser');
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(groupId1, assoc(nonMemberGroupId3, 'member', {}), (error) => {
          assert.notExists(error);
          AuthzAPI.updateRoles(groupId2, assoc(groupId1, 'member', {}), (error) => {
            assert.notExists(error);

            // Get the memberships uncached
            AuthzAPI.getPrincipalMemberships(userId, undefined, undefined, (error, groupIds) => {
              assert.notExists(error);
              assert.ok(groupIds);
              assert.strictEqual(groupIds.length, 2);
              assert.ok(_.contains(groupIds, groupId1));
              assert.ok(_.contains(groupIds, groupId2));

              // Get the memberships cached
              AuthzAPI.getPrincipalMemberships(userId, undefined, undefined, (error, groupIds) => {
                assert.notExists(error);
                assert.ok(groupIds);
                assert.strictEqual(groupIds.length, 2);
                assert.ok(_.contains(groupIds, groupId1));
                assert.ok(_.contains(groupIds, groupId2));
                callback();
              });
            });
          });
        });
      });
    });

    it('verify circular group hierarchy', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'gmo-circ', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'gmo-circ', 'oae-backend-team');
      const groupId3 = AuthzUtil.toId('g', 'gmo-circ', 'oae-ui-team');
      const userId = AuthzUtil.toId('u', 'gmo-circ', 'mrvisser');
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(groupId2, assoc(groupId1, 'member', {}), (error) => {
          assert.notExists(error);
          AuthzAPI.updateRoles(groupId3, assoc(groupId2, 'member', {}), (error) => {
            assert.notExists(error);
            AuthzAPI.updateRoles(groupId1, assoc(groupId3, 'member', {}), (error) => {
              assert.notExists(error);

              // Get the memberships uncached
              AuthzAPI.getPrincipalMemberships(userId, undefined, undefined, (error, groupIds) => {
                assert.notExists(error);
                assert.ok(groupIds);
                assert.strictEqual(groupIds.length, 3);
                assert.ok(_.contains(groupIds, groupId1));
                assert.ok(_.contains(groupIds, groupId2));
                assert.ok(_.contains(groupIds, groupId3));

                // Get the memberships cached
                AuthzAPI.getPrincipalMemberships(
                  userId,
                  undefined,
                  undefined,
                  (error, groupIds) => {
                    assert.notExists(error);
                    assert.ok(groupIds);
                    assert.strictEqual(groupIds.length, 3);
                    assert.ok(_.contains(groupIds, groupId1));
                    assert.ok(_.contains(groupIds, groupId2));
                    assert.ok(_.contains(groupIds, groupId3));
                    callback();
                  }
                );
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the list of user memberships is properly paged
     */
    it('verify paging', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'gmo-pag', 'oae-group1');
      const groupId2 = AuthzUtil.toId('g', 'gmo-pag', 'oae-group2');
      const groupId3 = AuthzUtil.toId('g', 'gmo-pag', 'oae-group3');
      const groupId4 = AuthzUtil.toId('g', 'gmo-pag', 'oae-group4');
      const groupId5 = AuthzUtil.toId('g', 'gmo-pag', 'oae-group5');
      const groupId6 = AuthzUtil.toId('g', 'gmo-pag', 'oae-group6');
      const groupId7 = AuthzUtil.toId('g', 'gmo-pag', 'oae-group7');
      const userId = AuthzUtil.toId('u', 'gmo-pag', 'mrvisser');

      // Make him a member of all groups
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(groupId2, assoc(userId, 'manager', {}), (error) => {
          assert.notExists(error);
          AuthzAPI.updateRoles(groupId3, assoc(userId, 'member', {}), (error) => {
            assert.notExists(error);
            AuthzAPI.updateRoles(groupId4, assoc(userId, 'member', {}), (error) => {
              assert.notExists(error);
              AuthzAPI.updateRoles(groupId5, assoc(userId, 'manager', {}), (error) => {
                assert.notExists(error);
                AuthzAPI.updateRoles(groupId6, assoc(userId, 'member', {}), (error) => {
                  assert.notExists(error);
                  AuthzAPI.updateRoles(groupId7, assoc(userId, 'manager', {}), (error) => {
                    assert.notExists(error);

                    // Get the paged memberships uncached
                    AuthzAPI.getPrincipalMemberships(
                      userId,
                      groupId3,
                      3,
                      (error, groupIds, nextToken) => {
                        assert.notExists(error);
                        assert.ok(groupIds);
                        assert.strictEqual(groupIds.length, 3);
                        assert.ok(_.contains(groupIds, groupId4));
                        assert.ok(_.contains(groupIds, groupId5));
                        assert.ok(_.contains(groupIds, groupId6));
                        assert.strictEqual(nextToken, groupIds[2]);

                        // Get the paged memberships cached
                        AuthzAPI.getPrincipalMemberships(
                          userId,
                          groupId3,
                          3,
                          (error, groupIds, nextToken) => {
                            assert.notExists(error);
                            assert.ok(groupIds);
                            assert.strictEqual(groupIds.length, 3);
                            assert.ok(_.contains(groupIds, groupId4));
                            assert.ok(_.contains(groupIds, groupId5));
                            assert.ok(_.contains(groupIds, groupId6));
                            assert.strictEqual(nextToken, groupIds[2]);
                            callback();
                          }
                        );
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

  describe('Is Authz group member', () => {
    it('verify invalid principal id', (callback) => {
      AuthzAPI.hasAnyRole('not an id', 'g:oae:mrvisser', (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify non-principal id', (callback) => {
      AuthzAPI.hasAnyRole('c:cam:Foo.docx', 'g:oae:mrvisser', (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify invalid group id error', (callback) => {
      AuthzAPI.hasAnyRole('u:oae:mrvisser', 'not an id', (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify non-group group id error', (callback) => {
      AuthzAPI.hasAnyRole('u:oae:mrvisser', 'u:oae:mrvisser', (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify empty membership', (callback) => {
      const userId = AuthzUtil.toId('u', 'imo-empty', 'mrvisser');
      AuthzAPI.hasAnyRole(userId, 'g:oae:oae-team', (error, hasAnyRole) => {
        assert.notExists(error);
        assert.ok(!hasAnyRole);
        callback();
      });
    });

    it('verify single group membership', (callback) => {
      const groupId = AuthzUtil.toId('g', 'imo-single', 'oae-team');
      const userId = AuthzUtil.toId('u', 'imo-single', 'mrvisser');
      AuthzAPI.updateRoles(groupId, assoc(userId, 'member', {}), (error) => {
        assert.notExists(error);
        AuthzAPI.hasAnyRole(userId, groupId, (error, hasAnyRole) => {
          assert.notExists(error);
          assert.ok(hasAnyRole);
          callback();
        });
      });
    });

    it('verify two direct group membership', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'imo-two', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'imo-two', 'oae-backend-team');
      const userId = AuthzUtil.toId('u', 'imo-two', 'mrvisser');
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(groupId2, assoc(userId, 'member', {}), (error) => {
          assert.notExists(error);
          AuthzAPI.hasAnyRole(userId, groupId1, (error, hasAnyRole) => {
            assert.notExists(error);
            assert.ok(hasAnyRole);
            AuthzAPI.hasAnyRole(userId, groupId2, (error, hasAnyRole) => {
              assert.notExists(error);
              assert.ok(hasAnyRole);
              callback();
            });
          });
        });
      });
    });

    it('verify simple group hierarchy', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'gmo-hier', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'gmo-hier', 'oae-backend-team');
      const nonMemberGroupId3 = AuthzUtil.toId('g', 'gmo-hier', 'non-member');
      const userId = AuthzUtil.toId('u', 'gmo-hier', 'mrvisser');
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(groupId1, assoc(nonMemberGroupId3, 'member', {}), (error) => {
          assert.notExists(error);
          AuthzAPI.updateRoles(groupId2, assoc(groupId1, 'member', {}), (error) => {
            assert.notExists(error);
            AuthzAPI.hasAnyRole(userId, groupId1, (error, hasAnyRole) => {
              assert.notExists(error);
              assert.ok(hasAnyRole);
              AuthzAPI.hasAnyRole(userId, groupId2, (error, hasAnyRole) => {
                assert.notExists(error);
                assert.ok(hasAnyRole);
                AuthzAPI.hasAnyRole(userId, nonMemberGroupId3, (error, hasAnyRole) => {
                  assert.notExists(error);
                  assert.ok(!hasAnyRole);
                  callback();
                });
              });
            });
          });
        });
      });
    });

    it('verify circular group hierarchy', (callback) => {
      const groupId1 = AuthzUtil.toId('g', 'gmo-circ', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'gmo-circ', 'oae-backend-team');
      const groupId3 = AuthzUtil.toId('g', 'gmo-circ', 'oae-ui-team');
      const userId = AuthzUtil.toId('u', 'gmo-circ', 'mrvisser');
      AuthzAPI.updateRoles(groupId1, assoc(userId, 'member', {}), (error) => {
        assert.notExists(error);
        AuthzAPI.updateRoles(groupId2, assoc(groupId1, 'member', {}), (error) => {
          assert.notExists(error);
          AuthzAPI.updateRoles(groupId3, assoc(groupId2, 'member', {}), (error) => {
            assert.notExists(error);
            AuthzAPI.updateRoles(groupId1, assoc(groupId3, 'member', {}), (error) => {
              assert.notExists(error);
              AuthzAPI.hasAnyRole(userId, groupId1, (error, hasAnyRole) => {
                assert.notExists(error);
                assert.ok(hasAnyRole);
                AuthzAPI.hasAnyRole(userId, groupId2, (error, hasAnyRole) => {
                  assert.notExists(error);
                  assert.ok(hasAnyRole);
                  AuthzAPI.hasAnyRole(userId, groupId3, (error, hasAnyRole) => {
                    assert.notExists(error);
                    assert.ok(hasAnyRole);
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

  describe('#computeMemberRolesAfterChanges()', () => {
    /**
     * Test that verifies the functionality of compute member roles after changes when taking
     * into account all operations
     */
    it('verify functionality when taking into account adds, removes and updates', (callback) => {
      const groupId = AuthzUtil.toId('g', 'cmac', 'oae-team');
      const mrvisser = AuthzUtil.toId('u', 'cmac', 'mrvisser');
      const simong = AuthzUtil.toId('u', 'cmac', 'simong');
      const rolesBefore = {};
      rolesBefore[mrvisser] = 'member';
      rolesBefore[simong] = 'member';
      AuthzAPI.updateRoles(groupId, rolesBefore, (error) => {
        assert.notExists(error);

        // Verify adding a principal by adding bert as a member
        const bert = AuthzUtil.toId('u', 'cmac', 'bert');
        const addBertChange = assoc(bert, 'member', {});
        AuthzAPI.computeMemberRolesAfterChanges(
          groupId,
          addBertChange,
          null,
          (error, idChangeInfo) => {
            assert.notExists(error);
            assert.deepStrictEqual(idChangeInfo.changes, addBertChange);
            assert.deepStrictEqual(idChangeInfo.roles.before, rolesBefore);
            assert.deepStrictEqual(
              idChangeInfo.roles.after,
              _.extend({}, rolesBefore, addBertChange)
            );
            assert.deepStrictEqual(idChangeInfo.ids.added, [bert]);
            assert.deepStrictEqual(idChangeInfo.ids.updated, []);
            assert.deepStrictEqual(idChangeInfo.ids.removed, []);

            // Verify a role change by making mrvisser a manager
            const mrvisserManagerChange = assoc(mrvisser, 'manager', {});
            AuthzAPI.computeMemberRolesAfterChanges(
              groupId,
              mrvisserManagerChange,
              null,
              (error, idChangeInfo) => {
                assert.notExists(error);
                assert.deepStrictEqual(idChangeInfo.changes, mrvisserManagerChange);
                assert.deepStrictEqual(idChangeInfo.roles.before, rolesBefore);
                assert.deepStrictEqual(
                  idChangeInfo.roles.after,
                  _.extend({}, rolesBefore, mrvisserManagerChange)
                );
                assert.deepStrictEqual(idChangeInfo.ids.added, []);
                assert.deepStrictEqual(idChangeInfo.ids.updated, [mrvisser]);
                assert.deepStrictEqual(idChangeInfo.ids.removed, []);

                // Verify a non-update by making simong a member (he already is a member)
                const simonMemberChange = assoc(simong, 'member', {});
                AuthzAPI.computeMemberRolesAfterChanges(
                  groupId,
                  simonMemberChange,
                  null,
                  (error, idChangeInfo) => {
                    assert.notExists(error);
                    assert.deepStrictEqual(idChangeInfo.changes, {});
                    assert.deepStrictEqual(idChangeInfo.roles.before, rolesBefore);
                    assert.deepStrictEqual(idChangeInfo.roles.after, rolesBefore);
                    assert.deepStrictEqual(idChangeInfo.ids.added, []);
                    assert.deepStrictEqual(idChangeInfo.ids.updated, []);
                    assert.deepStrictEqual(idChangeInfo.ids.removed, []);

                    // Verify removing a principal by removing simong
                    const simonRemoveChange = assoc(simong, false, {});
                    AuthzAPI.computeMemberRolesAfterChanges(
                      groupId,
                      simonRemoveChange,
                      null,
                      (error, idChangeInfo) => {
                        assert.notExists(error);
                        assert.deepStrictEqual(idChangeInfo.changes, simonRemoveChange);
                        assert.deepStrictEqual(idChangeInfo.roles.before, rolesBefore);
                        assert.deepStrictEqual(
                          idChangeInfo.roles.after,
                          _.omit(rolesBefore, simong)
                        );
                        assert.deepStrictEqual(idChangeInfo.ids.added, []);
                        assert.deepStrictEqual(idChangeInfo.ids.updated, []);
                        assert.deepStrictEqual(idChangeInfo.ids.removed, [simong]);

                        // Trying to remove the membership for a principal that has no permission should result in no change.
                        const unknownUser = AuthzUtil.toId('u', 'cmac', 'unknown');
                        const unknownUserRemoveChange = assoc(unknownUser, false, {});
                        AuthzAPI.computeMemberRolesAfterChanges(
                          groupId,
                          unknownUserRemoveChange,
                          null,
                          (error, idChangeInfo) => {
                            assert.notExists(error);
                            assert.deepStrictEqual(idChangeInfo.changes, {});
                            assert.deepStrictEqual(idChangeInfo.roles.before, rolesBefore);
                            assert.deepStrictEqual(idChangeInfo.roles.after, rolesBefore);
                            assert.deepStrictEqual(idChangeInfo.ids.added, []);
                            assert.deepStrictEqual(idChangeInfo.ids.updated, []);
                            assert.deepStrictEqual(idChangeInfo.ids.removed, []);

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

    /**
     * Test that verifies the functionality of compute member roles after changes when taking
     * into account only add operations
     */
    it('verify functionality when taking into account only promotions', (callback) => {
      const groupId = AuthzUtil.toId('g', 'cmaca', 'oae-team');
      const mrvisser = AuthzUtil.toId('u', 'cmaca', 'mrvisser');
      const simong = AuthzUtil.toId('u', 'cmaca', 'simong');
      const stephen = AuthzUtil.toId('u', 'cmaca', 'stephen');
      const rolesBefore = {};
      rolesBefore[mrvisser] = 'member';
      rolesBefore[simong] = 'member';
      rolesBefore[stephen] = 'editor';
      AuthzAPI.updateRoles(groupId, rolesBefore, (error) => {
        assert.notExists(error);

        // Verify adding a principal by adding bert as a member
        const bert = AuthzUtil.toId('u', 'cmaca', 'bert');
        const addBertChange = assoc(bert, 'member', {});
        AuthzAPI.computeMemberRolesAfterChanges(
          groupId,
          addBertChange,
          { promoteOnly: true },
          (error, idChangeInfo) => {
            assert.notExists(error);
            assert.deepStrictEqual(idChangeInfo.changes, addBertChange);
            assert.deepStrictEqual(idChangeInfo.roles.before, rolesBefore);
            assert.deepStrictEqual(
              idChangeInfo.roles.after,
              _.extend({}, rolesBefore, addBertChange)
            );
            assert.deepStrictEqual(idChangeInfo.ids.added, [bert]);
            assert.deepStrictEqual(idChangeInfo.ids.updated, []);
            assert.deepStrictEqual(idChangeInfo.ids.removed, []);

            // Verify a role change by making mrvisser an editor. It should cause a change
            // because mrvisser is currently a lowly member
            const mrvisserEditorChange = assoc(mrvisser, 'editor', {});
            AuthzAPI.computeMemberRolesAfterChanges(
              groupId,
              mrvisserEditorChange,
              { promoteOnly: true },
              (error, idChangeInfo) => {
                assert.notExists(error);
                assert.deepStrictEqual(idChangeInfo.changes, mrvisserEditorChange);
                assert.deepStrictEqual(idChangeInfo.roles.before, rolesBefore);
                assert.deepStrictEqual(
                  idChangeInfo.roles.after,
                  _.extend({}, rolesBefore, mrvisserEditorChange)
                );
                assert.deepStrictEqual(idChangeInfo.ids.added, []);
                assert.deepStrictEqual(idChangeInfo.ids.updated, [mrvisser]);
                assert.deepStrictEqual(idChangeInfo.ids.removed, []);

                // Verify a role change by demoting stephen to a viewer. It should not
                // result in a change because stephen's editor role is superior
                const stephenViewerChange = assoc(stephen, 'viewer', {});
                AuthzAPI.computeMemberRolesAfterChanges(
                  groupId,
                  stephenViewerChange,
                  { promoteOnly: true },
                  (error, idChangeInfo) => {
                    assert.notExists(error);
                    assert.deepStrictEqual(idChangeInfo.changes, {});
                    assert.deepStrictEqual(idChangeInfo.roles.before, rolesBefore);
                    assert.deepStrictEqual(idChangeInfo.roles.after, rolesBefore);
                    assert.deepStrictEqual(idChangeInfo.ids.added, []);
                    assert.deepStrictEqual(idChangeInfo.ids.updated, []);
                    assert.deepStrictEqual(idChangeInfo.ids.removed, []);

                    // Verify a non-update by making simong a member (he already is a member),
                    // should result in no change
                    const simonMemberChange = assoc(simong, 'member', {});
                    AuthzAPI.computeMemberRolesAfterChanges(
                      groupId,
                      simonMemberChange,
                      { promoteOnly: true },
                      (error, idChangeInfo) => {
                        assert.notExists(error);
                        assert.deepStrictEqual(idChangeInfo.changes, {});
                        assert.deepStrictEqual(idChangeInfo.roles.before, rolesBefore);
                        assert.deepStrictEqual(idChangeInfo.roles.after, rolesBefore);
                        assert.deepStrictEqual(idChangeInfo.ids.added, []);
                        assert.deepStrictEqual(idChangeInfo.ids.updated, []);
                        assert.deepStrictEqual(idChangeInfo.ids.removed, []);

                        // Verify removing a principal by removing simong, should result in no
                        // change
                        const simonRemoveChange = assoc(simong, false, {});
                        AuthzAPI.computeMemberRolesAfterChanges(
                          groupId,
                          simonRemoveChange,
                          { promoteOnly: true },
                          (error, idChangeInfo) => {
                            assert.notExists(error);
                            assert.deepStrictEqual(idChangeInfo.changes, {});
                            assert.deepStrictEqual(idChangeInfo.roles.before, rolesBefore);
                            assert.deepStrictEqual(idChangeInfo.roles.after, rolesBefore);
                            assert.deepStrictEqual(idChangeInfo.ids.added, []);
                            assert.deepStrictEqual(idChangeInfo.ids.updated, []);
                            assert.deepStrictEqual(idChangeInfo.ids.removed, []);

                            // Trying to remove the membership for a principal that has no
                            // permission should result in no change
                            const unknownUser = AuthzUtil.toId('u', 'cmaca', 'unknown');
                            const unknownUserRemoveChange = assoc(unknownUser, false, {});
                            AuthzAPI.computeMemberRolesAfterChanges(
                              groupId,
                              unknownUserRemoveChange,
                              { promoteOnly: true },
                              (error, idChangeInfo) => {
                                assert.notExists(error);
                                assert.deepStrictEqual(idChangeInfo.changes, {});
                                assert.deepStrictEqual(idChangeInfo.roles.before, rolesBefore);
                                assert.deepStrictEqual(idChangeInfo.roles.after, rolesBefore);
                                assert.deepStrictEqual(idChangeInfo.ids.added, []);
                                assert.deepStrictEqual(idChangeInfo.ids.updated, []);
                                assert.deepStrictEqual(idChangeInfo.ids.removed, []);

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
  });
});
