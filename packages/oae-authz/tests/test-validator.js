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
import { Validator as v } from 'oae-authz/lib/validator';

describe('Authz-Validator', () => {
  describe('#isResourceId()', () => {
    it('verify general functionality', callback => {
      assert.strictEqual(v.isResourceId(undefined), false);
      assert.strictEqual(v.isResourceId(null), false);
      assert.strictEqual(v.isResourceId(''), false);
      assert.strictEqual(v.isResourceId('  '), false);
      assert.strictEqual(v.isResourceId('not a valid id'), false);
      assert.strictEqual(v.isResourceId('a:valid:id'), true);

      callback();
    });
  });

  describe('#isPrincipalId()', () => {
    it('verify general functionality', callback => {
      assert.strictEqual(v.isPrincipalId(undefined), false);
      assert.strictEqual(v.isPrincipalId(null), false);
      assert.strictEqual(v.isPrincipalId(''), false);
      assert.strictEqual(v.isPrincipalId('  '), false);
      assert.strictEqual(v.isPrincipalId('not a valid id'), false);
      assert.strictEqual(v.isPrincipalId('not:a:principal'), false);
      assert.strictEqual(v.isPrincipalId('u:valid:id'), true);
      assert.strictEqual(v.isPrincipalId('g:valid:id'), true);
      callback();
    });
  });

  describe('#isGroupId()', () => {
    it('verify general functionality', callback => {
      assert.strictEqual(v.isGroupId(undefined), false);
      assert.strictEqual(v.isGroupId(null), false);
      assert.strictEqual(v.isGroupId(''), false);
      assert.strictEqual(v.isGroupId('  '), false);
      assert.strictEqual(v.isGroupId('not a valid id'), false);
      assert.strictEqual(v.isGroupId('not:a:principal'), false);
      assert.strictEqual(v.isGroupId('u:valid:id'), false);
      assert.strictEqual(v.isGroupId('g:valid:id'), true);

      callback();
    });
  });

  describe('#isUserId()', () => {
    it('verify general functionality', callback => {
      assert.strictEqual(v.isUserId(undefined), false);
      assert.strictEqual(v.isUserId(null), false);
      assert.strictEqual(v.isUserId(''), false);
      assert.strictEqual(v.isUserId('  '), false);
      assert.strictEqual(v.isUserId('not a valid id'), false);
      assert.strictEqual(v.isUserId('not:a:principal'), false);
      assert.strictEqual(v.isUserId('g:valid:id'), false);
      assert.strictEqual(v.isUserId('u:valid:id'), true);

      callback();
    });
  });

  describe('#isNonUserResourceId()', () => {
    it('verify general functionality', callback => {
      assert.strictEqual(v.isNonUserResourceId(undefined), false);
      assert.strictEqual(v.isNonUserResourceId(null), false);
      assert.strictEqual(v.isNonUserResourceId(''), false);
      assert.strictEqual(v.isNonUserResourceId('  '), false);
      assert.strictEqual(v.isNonUserResourceId('not a valid id'), false);
      assert.strictEqual(v.isNonUserResourceId('u:valid:id'), false);
      assert.strictEqual(v.isNonUserResourceId('g:valid:id'), true);
      assert.strictEqual(v.isNonUserResourceId('c:valid:id'), true);

      callback();
    });
  });

  describe('#isValidRole()', () => {
    it('verify general functionality', callback => {
      assert.strictEqual(v.isValidRole(undefined), false);
      assert.strictEqual(v.isValidRole(null), false);
      assert.strictEqual(v.isValidRole(''), false);
      assert.strictEqual(v.isValidRole('  '), false);
      assert.strictEqual(v.isValidRole(false), false);
      assert.strictEqual(v.isValidRole('manager'), true);

      callback();
    });
  });

  describe('#isValidRoleChange()', () => {
    it('verify general functionality', callback => {
      assert.strictEqual(v.isValidRoleChange(undefined), false);
      assert.strictEqual(v.isValidRoleChange(null), false);
      assert.strictEqual(v.isValidRoleChange(''), false);
      assert.strictEqual(v.isValidRoleChange('  '), false);
      // 'false' is valid as a 'role change' value, as it indicates remove the role
      assert.strictEqual(v.isValidRoleChange(false), true);
      assert.strictEqual(v.isValidRoleChange('manager'), true);

      callback();
    });
  });
});
