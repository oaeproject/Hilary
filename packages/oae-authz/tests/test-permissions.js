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

import assert from 'assert';
import * as AuthzAPI from 'oae-authz';
import * as AuthzUtil from 'oae-authz/lib/util';

describe('Authz-Permissions', () => {
  /**
   * Make a single membership or role change object to apply to a group membership or resource role.
   *
   * @param  {String} principalId   The principalId whose role to change
   * @param  {String} role          The role to change to
   * @return {Object}               The change JSON Object to apply
   */
  const makeChange = function(principalId, role) {
    const change = {};
    change[principalId] = role;
    return change;
  };

  describe('#hasRole()', () => {
    it('verify invalid principal id error', callback => {
      AuthzAPI.hasRole('not a id', 'c:cam:Foo.docx', 'member', (err, hasRole) => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);
        assert.ok(!hasRole);
        callback();
      });
    });

    it('verify non-principal member id error', callback => {
      AuthzAPI.hasRole('c:cam:mrvisser', 'c:cam:Foo.docx', 'member', (err, hasRole) => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);
        assert.ok(!hasRole);
        callback();
      });
    });

    it('verify null role error', callback => {
      AuthzAPI.hasRole('u:cam:mrvisser', 'c:cam:Foo.docx', null, (err, hasRole) => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);
        assert.ok(!hasRole);
        callback();
      });
    });

    it('verify undefined role error', callback => {
      AuthzAPI.hasRole('u:cam:mrvisser', 'c:cam:Foo.docx', undefined, (err, hasRole) => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);
        assert.ok(!hasRole);
        callback();
      });
    });

    it('verify false role error', callback => {
      AuthzAPI.hasRole('u:cam:mrvisser', 'c:cam:Foo.docx', false, (err, hasRole) => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);
        assert.ok(!hasRole);
        callback();
      });
    });

    it('verify invalid resource id error', callback => {
      AuthzAPI.hasRole('u:cam:mrvisser', 'not a id', 'member', (err, hasRole) => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);
        assert.ok(!hasRole);
        callback();
      });
    });

    it('verify empty data', callback => {
      const userId = AuthzUtil.toId('u', 'hr-empty', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'hr-empty', 'SomeContent');
      AuthzAPI.hasRole(userId, resourceId, 'member', (err, hasRole) => {
        assert.ok(!err);
        assert.ok(!hasRole);
        callback();
      });
    });

    it('verify direct permission', callback => {
      const userId = AuthzUtil.toId('u', 'hr-direct', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'hr-direct', 'SomeContent');
      AuthzAPI.updateRoles(resourceId, makeChange(userId, 'viewer'), err => {
        assert.ok(!err);
        AuthzAPI.hasRole(userId, resourceId, 'viewer', (err, hasRole) => {
          assert.ok(!err);
          assert.ok(hasRole);
          callback();
        });
      });
    });

    it('verify no direct permission', callback => {
      const userId = AuthzUtil.toId('u', 'hr-no-direct', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'hr-no-direct', 'SomeContent');
      AuthzAPI.hasRole(userId, resourceId, 'viewer', (err, hasRole) => {
        assert.ok(!err);
        assert.ok(!hasRole);
        callback();
      });
    });

    it('verify direct single group permission', callback => {
      const groupId = AuthzUtil.toId('g', 'hr-single', 'oae-team');
      const userId = AuthzUtil.toId('u', 'hr-single', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'hr-single', 'SomeContent');

      AuthzAPI.updateRoles(groupId, makeChange(userId, 'member'), err => {
        assert.ok(!err);
        AuthzAPI.updateRoles(resourceId, makeChange(groupId, 'viewer'), err => {
          assert.ok(!err);
          AuthzAPI.hasRole(userId, resourceId, 'viewer', (err, hasRole) => {
            assert.ok(!err);
            assert.ok(hasRole);
            callback();
          });
        });
      });
    });

    it('verify no direct single group permission', callback => {
      const groupId = AuthzUtil.toId('g', 'hr-no-single', 'oae-team');
      const userId = AuthzUtil.toId('u', 'hr-no-single', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'hr-no-single', 'SomeContent');

      AuthzAPI.updateRoles(groupId, makeChange(userId, 'member'), err => {
        assert.ok(!err);
        AuthzAPI.hasRole(userId, resourceId, 'viewer', (err, hasRole) => {
          assert.ok(!err);
          assert.ok(!hasRole);
          callback();
        });
      });
    });

    it('verify direct multi group permission', callback => {
      const groupId1 = AuthzUtil.toId('g', 'hr-multi', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'hr-multi', 'oae-backend-team');
      const userId = AuthzUtil.toId('u', 'hr-multi', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'hr-multi', 'SomeContent');

      AuthzAPI.updateRoles(groupId1, makeChange(userId, 'member'), err => {
        assert.ok(!err);
        AuthzAPI.updateRoles(groupId2, makeChange(userId, 'member'), err => {
          assert.ok(!err);
          AuthzAPI.updateRoles(resourceId, makeChange(groupId1, 'viewer'), err => {
            assert.ok(!err);
            AuthzAPI.updateRoles(resourceId, makeChange(groupId2, 'manager'), err => {
              assert.ok(!err);
              AuthzAPI.hasRole(userId, resourceId, 'viewer', (err, hasRole) => {
                assert.ok(!err);
                assert.ok(hasRole);
                AuthzAPI.hasRole(userId, resourceId, 'manager', (err, hasRole) => {
                  assert.ok(!err);
                  assert.ok(hasRole);
                  callback();
                });
              });
            });
          });
        });
      });
    });

    it('verify no direct multi group permission', callback => {
      const groupId1 = AuthzUtil.toId('g', 'hr-no-multi', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'hr-no-multi', 'oae-backend-team');
      const userId = AuthzUtil.toId('u', 'hr-no-multi', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'hr-no-multi', 'SomeContent');

      AuthzAPI.updateRoles(resourceId, makeChange(groupId1, 'viewer'), err => {
        assert.ok(!err);
        AuthzAPI.updateRoles(resourceId, makeChange(groupId2, 'manager'), err => {
          assert.ok(!err);
          AuthzAPI.hasRole(userId, resourceId, 'viewer', (err, hasRole) => {
            assert.ok(!err);
            assert.ok(!hasRole);
            AuthzAPI.hasRole(userId, resourceId, 'manager', (err, hasRole) => {
              assert.ok(!err);
              assert.ok(!hasRole);
              callback();
            });
          });
        });
      });
    });

    it('verify multi group hierarchy permission', callback => {
      const groupId1 = AuthzUtil.toId('g', 'hr-hier', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'hr-hier', 'oae-backend-team');
      const userId = AuthzUtil.toId('u', 'hr-hier', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'hr-hier', 'SomeContent');

      AuthzAPI.updateRoles(groupId1, makeChange(groupId2, 'member'), err => {
        assert.ok(!err);
        AuthzAPI.updateRoles(groupId2, makeChange(userId, 'member'), err => {
          assert.ok(!err);
          AuthzAPI.updateRoles(resourceId, makeChange(groupId1, 'viewer'), err => {
            assert.ok(!err);
            AuthzAPI.hasRole(userId, resourceId, 'viewer', (err, hasRole) => {
              assert.ok(!err);
              assert.ok(hasRole);
              AuthzAPI.hasRole(userId, resourceId, 'manager', (err, hasRole) => {
                assert.ok(!err);
                assert.ok(!hasRole);
                AuthzAPI.updateRoles(resourceId, makeChange(groupId2, 'manager'), err => {
                  assert.ok(!err);
                  AuthzAPI.hasRole(userId, resourceId, 'viewer', (err, hasRole) => {
                    assert.ok(!err);
                    assert.ok(hasRole);
                    AuthzAPI.hasRole(userId, resourceId, 'manager', (err, hasRole) => {
                      assert.ok(!err);
                      assert.ok(hasRole);
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

    it('verify circular group hierarchy permission', callback => {
      const groupId1 = AuthzUtil.toId('g', 'hr-circ', 'oae-team');
      const groupId2 = AuthzUtil.toId('g', 'hr-circ', 'oae-backend-team');
      const groupId3 = AuthzUtil.toId('g', 'hr-circ', 'oae-ui-team');
      const userId = AuthzUtil.toId('u', 'hr-circ', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'hr-circ', 'SomeContent');

      AuthzAPI.updateRoles(groupId1, makeChange(userId, 'member'), err => {
        assert.ok(!err);
        AuthzAPI.updateRoles(groupId2, makeChange(groupId1, 'member'), err => {
          assert.ok(!err);
          AuthzAPI.updateRoles(groupId3, makeChange(groupId2, 'member'), err => {
            assert.ok(!err);
            AuthzAPI.updateRoles(groupId1, makeChange(groupId3, 'member'), err => {
              assert.ok(!err);
              AuthzAPI.updateRoles(resourceId, makeChange(groupId1, 'viewer'), err => {
                assert.ok(!err);
                AuthzAPI.updateRoles(resourceId, makeChange(groupId2, 'manager'), err => {
                  assert.ok(!err);
                  AuthzAPI.updateRoles(resourceId, makeChange(groupId3, 'editor'), err => {
                    assert.ok(!err);
                    AuthzAPI.hasRole(userId, resourceId, 'viewer', (err, hasRole) => {
                      assert.ok(!err);
                      assert.ok(hasRole);
                      AuthzAPI.hasRole(userId, resourceId, 'manager', (err, hasRole) => {
                        assert.ok(!err);
                        assert.ok(hasRole);
                        AuthzAPI.hasRole(userId, resourceId, 'editor', (err, hasRole) => {
                          assert.ok(!err);
                          assert.ok(hasRole);
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
      });
    });
  });

  describe('#hasAnyRole()', () => {
    it('verify invalid principal id error', callback => {
      AuthzAPI.hasAnyRole('not a id', 'c:cam:Foo.docx', (err, hasAnyRole) => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);
        assert.ok(!hasAnyRole);
        callback();
      });
    });

    it('verify non-principal id error', callback => {
      AuthzAPI.hasAnyRole('c:cam:mrvisser', 'c:cam:Foo.docx', (err, hasAnyRole) => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);
        assert.ok(!hasAnyRole);
        callback();
      });
    });

    it('verify invalid resource id error', callback => {
      AuthzAPI.hasAnyRole('u:cam:mrvisser', 'not a id', (err, hasAnyRole) => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);
        assert.ok(!hasAnyRole);
        callback();
      });
    });

    it('verify empty data', callback => {
      const userId = AuthzUtil.toId('u', 'har-empty', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'har-empty', 'SomeContent');
      AuthzAPI.hasAnyRole(userId, resourceId, (err, hasAnyRole) => {
        assert.ok(!err);
        assert.ok(!hasAnyRole);
        callback();
      });
    });

    it('verify direct permission', callback => {
      const userId = AuthzUtil.toId('u', 'har-direct', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'har-direct', 'SomeContent');
      AuthzAPI.updateRoles(resourceId, makeChange(userId, 'viewer'), err => {
        assert.ok(!err);
        AuthzAPI.hasAnyRole(userId, resourceId, (err, hasAnyRole) => {
          assert.ok(!err);
          assert.ok(hasAnyRole);
          callback();
        });
      });
    });

    it('verify no direct permission', callback => {
      const userId = AuthzUtil.toId('u', 'har-no-direct', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'har-no-direct', 'SomeContent');
      AuthzAPI.hasAnyRole(userId, resourceId, (err, hasAnyRole) => {
        assert.ok(!err);
        assert.ok(!hasAnyRole);
        callback();
      });
    });

    it('verify direct single group permission', callback => {
      const groupId = AuthzUtil.toId('g', 'har-single', 'oae-team');
      const userId = AuthzUtil.toId('u', 'har-single', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'har-single', 'SomeContent');

      AuthzAPI.updateRoles(groupId, makeChange(userId, 'member'), err => {
        assert.ok(!err);
        AuthzAPI.updateRoles(resourceId, makeChange(groupId, 'viewer'), err => {
          assert.ok(!err);
          AuthzAPI.hasAnyRole(userId, resourceId, (err, hasAnyRole) => {
            assert.ok(!err);
            assert.ok(hasAnyRole);
            callback();
          });
        });
      });
    });

    it('verify no direct single group permission', callback => {
      const groupId = AuthzUtil.toId('g', 'har-no-single', 'oae-team');
      const userId = AuthzUtil.toId('u', 'har-no-single', 'mrvisser');
      const resourceId = AuthzUtil.toId('c', 'har-no-single', 'SomeContent');

      AuthzAPI.updateRoles(resourceId, makeChange(groupId, 'viewer'), err => {
        assert.ok(!err);
        AuthzAPI.hasAnyRole(userId, resourceId, (err, hasAnyRole) => {
          assert.ok(!err);
          assert.ok(!hasAnyRole);
          callback();
        });
      });
    });
  });
});
