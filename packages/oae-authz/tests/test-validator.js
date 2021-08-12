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
import { Validator as v } from 'oae-authz/lib/validator.js';

describe('Authz-Validator', () => {
  describe('#isResourceId()', () => {
    it('verify general functionality', (callback) => {
      assert.isFalse(v.isResourceId(undefined));
      assert.isFalse(v.isResourceId(null));
      assert.isFalse(v.isResourceId(''));
      assert.isFalse(v.isResourceId('  '));
      assert.isFalse(v.isResourceId('not a valid id'));
      assert.isTrue(v.isResourceId('a:valid:id'));

      callback();
    });
  });

  describe('#isPrincipalId()', () => {
    it('verify general functionality', (callback) => {
      assert.isFalse(v.isPrincipalId(undefined));
      assert.isFalse(v.isPrincipalId(null));
      assert.isFalse(v.isPrincipalId(''));
      assert.isFalse(v.isPrincipalId('  '));
      assert.isFalse(v.isPrincipalId('not a valid id'));
      assert.isFalse(v.isPrincipalId('not:a:principal'));
      assert.isTrue(v.isPrincipalId('u:valid:id'));
      assert.isTrue(v.isPrincipalId('g:valid:id'));
      callback();
    });
  });

  describe('#isGroupId()', () => {
    it('verify general functionality', (callback) => {
      assert.isFalse(v.isGroupId(undefined));
      assert.isFalse(v.isGroupId(null));
      assert.isFalse(v.isGroupId(''));
      assert.isFalse(v.isGroupId('  '));
      assert.isFalse(v.isGroupId('not a valid id'));
      assert.isFalse(v.isGroupId('not:a:principal'));
      assert.isFalse(v.isGroupId('u:valid:id'));
      assert.isTrue(v.isGroupId('g:valid:id'));

      callback();
    });
  });

  describe('#isUserId()', () => {
    it('verify general functionality', (callback) => {
      assert.isFalse(v.isUserId(undefined));
      assert.isFalse(v.isUserId(null));
      assert.isFalse(v.isUserId(''));
      assert.isFalse(v.isUserId('  '));
      assert.isFalse(v.isUserId('not a valid id'));
      assert.isFalse(v.isUserId('not:a:principal'));
      assert.isFalse(v.isUserId('g:valid:id'));
      assert.isTrue(v.isUserId('u:valid:id'));

      callback();
    });
  });

  describe('#isNonUserResourceId()', () => {
    it('verify general functionality', (callback) => {
      assert.isFalse(v.isNonUserResourceId(undefined));
      assert.isFalse(v.isNonUserResourceId(null));
      assert.isFalse(v.isNonUserResourceId(''));
      assert.isFalse(v.isNonUserResourceId('  '));
      assert.isFalse(v.isNonUserResourceId('not a valid id'));
      assert.isFalse(v.isNonUserResourceId('u:valid:id'));
      assert.isTrue(v.isNonUserResourceId('g:valid:id'));
      assert.isTrue(v.isNonUserResourceId('c:valid:id'));

      callback();
    });
  });

  describe('#isValidRole()', () => {
    it('verify general functionality', (callback) => {
      assert.isFalse(v.isValidRole(undefined));
      assert.isFalse(v.isValidRole(null));
      assert.isFalse(v.isValidRole(''));
      assert.isFalse(v.isValidRole('  '));
      assert.isFalse(v.isValidRole(false));
      assert.isTrue(v.isValidRole('manager'));

      callback();
    });
  });

  describe('#isValidRoleChange()', () => {
    it('verify general functionality', (callback) => {
      assert.isFalse(v.isValidRoleChange(undefined));
      assert.isFalse(v.isValidRoleChange(null));
      assert.isFalse(v.isValidRoleChange(''));
      assert.isFalse(v.isValidRoleChange('  '));
      // 'false' is valid as a 'role change' value, as it indicates remove the role
      assert.isTrue(v.isValidRoleChange(false));
      assert.isTrue(v.isValidRoleChange('manager'));

      callback();
    });
  });
});
