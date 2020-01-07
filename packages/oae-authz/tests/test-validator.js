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
import { Validator } from 'oae-authz/lib/validator';

describe.skip('Authz-Validator', () => {
  describe('#isResourceId()', () => {
    it('verify general functionality', callback => {
      const v = new Validator();
      v.check(undefined, 'undefined').isResourceId();
      v.check(null, 'null').isResourceId();
      v.check('', 'empty').isResourceId();
      v.check('  ', 'blank').isResourceId();
      v.check('not a valid id', 'malformatted').isResourceId();
      v.check('a:valid:id', 'correct').isResourceId();

      assert.ok(v.hasErrors());
      assert.strictEqual(v.getErrors().length, 5);
      assert.strictEqual(v.getErrors()[0], 'undefined');
      assert.strictEqual(v.getErrors()[1], 'null');
      assert.strictEqual(v.getErrors()[2], 'empty');
      assert.strictEqual(v.getErrors()[3], 'blank');
      assert.strictEqual(v.getErrors()[4], 'malformatted');
      callback();
    });
  });

  describe('#isPrincipalId()', () => {
    it('verify general functionality', callback => {
      const v = new Validator();
      v.check(undefined, 'undefined').isPrincipalId();
      v.check(null, 'null').isPrincipalId();
      v.check('', 'empty').isPrincipalId();
      v.check('  ', 'blank').isPrincipalId();
      v.check('not a valid id', 'malformatted').isPrincipalId();
      v.check('not:a:principal', 'unprincipal').isPrincipalId();
      v.check('u:valid:id', 'correct').isPrincipalId();
      v.check('g:valid:id', 'correct').isPrincipalId();

      assert.ok(v.hasErrors());
      assert.strictEqual(v.getErrors().length, 6);
      assert.strictEqual(v.getErrors()[0], 'undefined');
      assert.strictEqual(v.getErrors()[1], 'null');
      assert.strictEqual(v.getErrors()[2], 'empty');
      assert.strictEqual(v.getErrors()[3], 'blank');
      assert.strictEqual(v.getErrors()[4], 'malformatted');
      assert.strictEqual(v.getErrors()[5], 'unprincipal');
      callback();
    });
  });

  describe('#isGroupId()', () => {
    it('verify general functionality', callback => {
      const v = new Validator();
      v.check(undefined, 'undefined').isGroupId();
      v.check(null, 'null').isGroupId();
      v.check('', 'empty').isGroupId();
      v.check('  ', 'blank').isGroupId();
      v.check('not a valid id', 'malformatted').isGroupId();
      v.check('not:a:principal', 'unprincipal').isGroupId();
      v.check('u:valid:id', 'ungroup').isGroupId();
      v.check('g:valid:id', 'correct').isGroupId();

      assert.ok(v.hasErrors());
      assert.strictEqual(v.getErrors().length, 7);
      assert.strictEqual(v.getErrors()[0], 'undefined');
      assert.strictEqual(v.getErrors()[1], 'null');
      assert.strictEqual(v.getErrors()[2], 'empty');
      assert.strictEqual(v.getErrors()[3], 'blank');
      assert.strictEqual(v.getErrors()[4], 'malformatted');
      assert.strictEqual(v.getErrors()[5], 'unprincipal');
      assert.strictEqual(v.getErrors()[6], 'ungroup');
      callback();
    });
  });

  describe('#isUserId()', () => {
    it('verify general functionality', callback => {
      const v = new Validator();
      v.check(undefined, 'undefined').isUserId();
      v.check(null, 'null').isUserId();
      v.check('', 'empty').isUserId();
      v.check('  ', 'blank').isUserId();
      v.check('not a valid id', 'malformatted').isUserId();
      v.check('not:a:principal', 'unprincipal').isUserId();
      v.check('g:valid:id', 'unuser').isUserId();
      v.check('u:valid:id', 'correct').isUserId();

      assert.ok(v.hasErrors());
      assert.strictEqual(v.getErrors().length, 7);
      assert.strictEqual(v.getErrors()[0], 'undefined');
      assert.strictEqual(v.getErrors()[1], 'null');
      assert.strictEqual(v.getErrors()[2], 'empty');
      assert.strictEqual(v.getErrors()[3], 'blank');
      assert.strictEqual(v.getErrors()[4], 'malformatted');
      assert.strictEqual(v.getErrors()[5], 'unprincipal');
      assert.strictEqual(v.getErrors()[6], 'unuser');
      callback();
    });
  });

  describe('#isNonUserResourceId()', () => {
    it('verify general functionality', callback => {
      const v = new Validator();
      v.check(undefined, 'undefined').isNonUserResourceId();
      v.check(null, 'null').isNonUserResourceId();
      v.check('', 'empty').isNonUserResourceId();
      v.check('  ', 'blank').isNonUserResourceId();
      v.check('not a valid id', 'malformatted').isNonUserResourceId();
      v.check('u:valid:id', 'unresource').isNonUserResourceId();
      v.check('g:valid:id', 'correct').isNonUserResourceId();
      v.check('c:valid:id', 'correct').isNonUserResourceId();

      assert.ok(v.hasErrors());
      assert.strictEqual(v.getErrors().length, 6);
      assert.strictEqual(v.getErrors()[0], 'undefined');
      assert.strictEqual(v.getErrors()[1], 'null');
      assert.strictEqual(v.getErrors()[2], 'empty');
      assert.strictEqual(v.getErrors()[3], 'blank');
      assert.strictEqual(v.getErrors()[4], 'malformatted');
      assert.strictEqual(v.getErrors()[5], 'unresource');
      callback();
    });
  });

  describe('#isValidRole()', () => {
    it('verify general functionality', callback => {
      const v = new Validator();
      v.check(undefined, 'undefined').isValidRole();
      v.check(null, 'null').isValidRole();
      v.check('', 'empty').isValidRole();
      v.check('  ', 'blank').isValidRole();
      v.check(false, 'false').isValidRole();
      v.check('manager', 'valid').isValidRole();

      assert.ok(v.hasErrors());
      assert.strictEqual(v.getErrors().length, 5);
      assert.strictEqual(v.getErrors()[0], 'undefined');
      assert.strictEqual(v.getErrors()[1], 'null');
      assert.strictEqual(v.getErrors()[2], 'empty');
      assert.strictEqual(v.getErrors()[3], 'blank');
      assert.strictEqual(v.getErrors()[4], 'false');
      callback();
    });
  });

  describe('#isValidRoleChange()', () => {
    it('verify general functionality', callback => {
      const v = new Validator();
      v.check(undefined, 'undefined').isValidRoleChange();
      v.check(null, 'null').isValidRoleChange();
      v.check('', 'empty').isValidRoleChange();
      v.check('  ', 'blank').isValidRoleChange();
      // 'false' is valid as a 'role change' value, as it indicates remove the role
      v.check(false, 'false').isValidRoleChange();
      v.check('manager', 'valid').isValidRoleChange();

      assert.ok(v.hasErrors());
      assert.strictEqual(v.getErrors().length, 4);
      assert.strictEqual(v.getErrors()[0], 'undefined');
      assert.strictEqual(v.getErrors()[1], 'null');
      assert.strictEqual(v.getErrors()[2], 'empty');
      assert.strictEqual(v.getErrors()[3], 'blank');
      callback();
    });
  });
});
