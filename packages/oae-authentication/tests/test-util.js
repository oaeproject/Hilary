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
import { describe, it } from 'mocha';
import { keys } from 'ramda';
import * as AuthenticationUtil from 'oae-authentication/lib/util';

describe('Authentication - util', () => {
  describe('#setProfileParameter', () => {
    /**
     * Test that verifies the basic functionality of the setProfileParameter function
     */
    it('verify it sets a profile parameter with a dynamic template', callback => {
      const template = '{firstName} {lastName}';
      const data = { firstName: 'John', lastName: 'Doe' };
      const profileParameters = {
        initial: true
      };
      const profileParameterName = 'displayName';
      AuthenticationUtil.setProfileParameter(
        profileParameters,
        profileParameterName,
        template,
        data
      );

      // Assert the displayName was added
      assert.strictEqual(profileParameters.displayName, 'John Doe');

      // Assert that an initial value was not removed
      assert.strictEqual(profileParameters.initial, true);

      // Assert that only one key was added
      assert.lengthOf(keys(profileParameters), 2);

      // Assert that the data object is still intact
      assert.lengthOf(keys(data), 2);
      assert.strictEqual(data.firstName, 'John');
      assert.strictEqual(data.lastName, 'Doe');

      // Assert that the template is still intact
      assert.strictEqual(template, '{firstName} {lastName}');

      return callback();
    });
  });

  describe('#renderTemplate', () => {
    /**
     * Test that verifies you can provide a template without any variables
     */
    it('verify a template without variables can be rendered', callback => {
      const result = AuthenticationUtil.renderTemplate('wicked template', { foo: 'bar' });
      assert.strictEqual(result, 'wicked template');
      return callback();
    });

    /**
     * Test that verifies an empty templates returns an empty string
     */
    it('verify an empty template returns an empty string', callback => {
      // Verify an empty template returns null
      const result = AuthenticationUtil.renderTemplate('', { foo: 'bar' });
      assert.strictEqual(result, '');
      return callback();
    });

    /**
     * Test that verifies that multiple variables can be specified
     */
    it('verify multiple variables can be specified', callback => {
      const template = '{var1}{var2}{var3}';
      const data = {
        var1: 'foo',
        var2: 'bar',
        var3: 'baz'
      };
      const result = AuthenticationUtil.renderTemplate(template, data);
      assert.strictEqual(result, 'foobarbaz');
      return callback();
    });

    /**
     * Test that verifies that a variable can be used more than once
     */
    it('verify a variable can be used more than once', callback => {
      const template = '{var1}{var1}{var1}';
      const data = {
        var1: 'foo',
        var2: 'bar',
        var3: 'baz'
      };
      const result = AuthenticationUtil.renderTemplate(template, data);
      assert.strictEqual(result, 'foofoofoo');
      return callback();
    });

    /**
     * Test that verifies unmatched variables are replaced with an empty string
     */
    it('verify unmatched variables are replaced with an empty string', callback => {
      const template = '{var1}{var2}{var3}';
      const data = {};
      const result = AuthenticationUtil.renderTemplate(template, data);
      assert.strictEqual(result, '');
      return callback();
    });

    /**
     * Test that verifies the data object and template string remain the same
     */
    it('verify the data object and template string remain the same', callback => {
      const data = { var1: 'foo' };
      const template = '{var1}';
      const result = AuthenticationUtil.renderTemplate(template, data);
      assert.strictEqual(result, 'foo');

      assert.lengthOf(keys(data), 1);
      assert.strictEqual(data.var1, 'foo');
      assert.strictEqual(template, '{var1}');
      return callback();
    });
  });
});
