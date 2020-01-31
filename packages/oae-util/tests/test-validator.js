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

import { Context } from 'oae-context';
import { Tenant } from 'oae-tenants/lib/model';
import { User } from 'oae-principals/lib/model.user';
import { Validator as validator } from 'oae-util/lib/validator';

const { isDefined, isShortString, isMediumString, isLongString, isBoolean, isArray, isGlobalAdministratorUser, isHost, isLoggedInUser, isValidTimeZone, isURL, isEmail, isInt, isNotEmpty }= validator;
import * as TestsUtil from 'oae-tests/lib/util';

describe('Utilities', () => {
  describe('Validator', () => {
    it('verify undefined gets checked as empty', callback => {
      assert.strictEqual(isNotEmpty(undefined), false);
      return callback();
    });

    /**
     * Test whether or not the validator used to check for empty strings
     * is working as intended
     */
    it('verify empty validator', callback => {
      assert.strictEqual(isNotEmpty('Non'), true);
      assert.strictEqual(isNotEmpty('Empty'), true);
      assert.strictEqual(isNotEmpty('String'), true);

      assert.strictEqual(isNotEmpty(''), false);
      assert.strictEqual(isNotEmpty(' '), false);
      assert.strictEqual(isNotEmpty('    '), false)

      return callback();
    });

    /**
     * Test whether or not the validator used to check for valid integers
     * is working as intended
     */
    it('verify integer validator', callback => {
      // string numbers succeed
      assert.strictEqual(isInt('0'), true);
      assert.strictEqual(isInt('10'), true);
      assert.strictEqual(isInt('-10'), true);

      // int numbers will throw error (only strings are validated)
      try {
        assert.strictEqual(isInt(0), false);
      } catch (error) {
        assert.ok(error);
      }
      try {
        assert.strictEqual(isInt(10), false);
      } catch (error) {
        assert.ok(error);
      }
      try {
        assert.strictEqual(isInt(-10), false);
      } catch (error) {
        assert.ok(error);
      }

      // Non numeric strings will fail
      assert.strictEqual(isInt('String'), false)
      assert.strictEqual(isInt(''), false);

      // Somewhat numeric strings will fail
      assert.strictEqual(isInt('100%'), false);
      assert.strictEqual(isInt(' 10'), false);
      assert.strictEqual(isInt('-10 '), false);

      return callback();
    });

    /**
     * Test whether or not the validator used to check for valid email addresses
     * is working as intended
     */
    it('verify email validator', callback => {
      assert.strictEqual(isEmail('miguel.laginha@oae.project.org'), true)
      assert.strictEqual(isEmail('miguel_laginha@oae.project.org'), true);
      assert.strictEqual(isEmail('miguel@oae.project'), true);

      assert.strictEqual(isEmail('miguel.laginha@oae.project.'), false);
      assert.strictEqual(isEmail('miguel laginha@oae.project.org'), false);
      assert.strictEqual(isEmail('miguel"laginha@oae.project.org'), false);
      assert.strictEqual(isEmail(' '), false);
      assert.strictEqual(isEmail('String'), false);
      assert.strictEqual(isEmail('miguel laginha@'), false);
      assert.strictEqual(isEmail('@.'), false);
      assert.strictEqual(isEmail('http://www.google.pt'), false);

      return callback();
    });

    /**
     * Test whether or not the validator used to check for valid URLs
     * is working as intended
     * @param  {Object} test     Standard nodeunit test object
     */
    it('verify URL validator', callback => {

      assert.strictEqual(isURL('http://www.oaeproject.org'), true);
      assert.strictEqual(isURL('http://example.com/assert.html'), true);
      assert.strictEqual(isURL('https://oae-widgets.oaeproject.org/sdk'), true);
      assert.strictEqual(isURL('http://support.google.com/docs/bin/answer.py?hl=en&answer=66343'), true);
      assert.strictEqual(isURL('http://www.w3.org/2004/02/skos/core#broader'), true);
      assert.strictEqual(isURL('https://wordpress.org/support/topic/plugin-addthis-odd-url-string?replies=5'), true);
      assert.strictEqual(isURL('https://twimg0-a.akamaihd.net/profile_images/300425859/ls_1278_Nicolaas-website.jpg'), true);

      assert.strictEqual(isURL('String'), false);
      assert.strictEqual(isURL('://www.google.pt'), false);

      return callback();
    });

    /**
     * Test whether or not the validator used to check for a logged in OAE user is working as intended
     */
    it('verify isLoggedInUser correctly validates that the context is authenticated to any tenant', callback => {
      // Valid tenant
      const tenant1 = global.oaeTests.tenants.cam;
      // Invalid tenant
      const tenant2 = new Tenant(null, 'Invalid tenant', 2002);
      // Valid users
      const user1 = new User(tenant1.alias, 'u:camtest:nm417', 'nm417', 'nm417@example.com');
      const user2 = new User(tenant1.alias, 'u:camtest:nm417', 'nm417', 'nm417@example.com');
      const user3 = new User(tenant1.alias, 'u:camtest:nm417', 'nm417', 'nm417@example.com');

      assert.strictEqual(isLoggedInUser(new Context(tenant1, user1)), true)
      assert.strictEqual(isLoggedInUser(new Context(tenant1, user2)), true)
      assert.strictEqual(isLoggedInUser(new Context(tenant1, user3)), true)

      // Empty context
      assert.strictEqual(isLoggedInUser(null), false)

      // Tenant, no user
      assert.strictEqual(isLoggedInUser(new Context(tenant1, null)), false);

      // No tenant, user
      assert.strictEqual(isLoggedInUser(new Context(null, user1)), false);

      // Invalid tenant, user
      assert.strictEqual(isLoggedInUser(new Context(tenant2, user1)), false);
      assert.strictEqual(isLoggedInUser(new Context(tenant2, user2)), false)
      assert.strictEqual(isLoggedInUser(new Context(tenant2, user3)), false)

      return callback();
    });

    /**
     * Test that verifies the isLoggedInUser validator works when determining if a request context is authenticated to a
     * particular tenant
     */
    it('verify isLoggedInUser correctly validates that the request context is authenticated to a particular tenant', callback => {
      // Two mock tenants to validate with
      const camTenant = global.oaeTests.tenants.cam;
      const gtTenant = global.oaeTests.tenants.gt;

      // Test user
      const user1 = new User(camTenant.alias, 'u:camtest:nm417', 'nm417', 'nm417@example.com');

      // Ensure it gives a validation error when not authenticated
      assert.strictEqual(isLoggedInUser(new Context(camTenant), camTenant.alias), false);

      // Ensure it gives a validation error when authenticated to a different tenant
      assert.strictEqual(isLoggedInUser(new Context(gtTenant, user1), camTenant.alias), false);

      // Ensure it succeeds when validator the proper tenant
      assert.strictEqual(isLoggedInUser(new Context(camTenant, user1), camTenant.alias), true);
      assert.strictEqual(isLoggedInUser(new Context(gtTenant, user1), gtTenant.alias), true);

      return callback();
    });

    it('verify timezone validation', callback => {
      const validateTimeZone = (timezone, isValid) => {
        assert.strictEqual(isValidTimeZone(timezone), isValid);
      };

      // We only support timezones of the format
      // foo/bar[/optional]
      validateTimeZone('Asia/Bangkok', true);
      validateTimeZone('Asia/Macao', true);
      validateTimeZone('Asia/Pyongyang', true);
      validateTimeZone('Asia/Seoul', true);
      validateTimeZone('Asia/Shanghai', true);
      validateTimeZone('Australia/Canberra', true);
      validateTimeZone('Australia/Melbourne', true);
      validateTimeZone('Australia/Sydney', true);
      validateTimeZone('Canada/Central', true);
      validateTimeZone('Europe/Amsterdam', true);
      validateTimeZone('Europe/Brussels', true);
      validateTimeZone('Europe/London', true);
      validateTimeZone('Europe/Brussels', true);
      validateTimeZone('US/Pacific', true);
      validateTimeZone('US/Mountain', true);

      // We won't support short hand timezones such as UTC
      validateTimeZone('EST', false);
      validateTimeZone('BST', false);
      validateTimeZone('UTC', false);

      // None of those ogre timezones either
      validateTimeZone('SfajslhfafhjlksahjklafT', false);
      validateTimeZone('Sfajslhfafhj/lksahjklafT', false);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isGlobalAdministratorUser
     */
    it('verify isGlobalAdministratorUser validation', callback => {
      const globalAdminCtx = TestsUtil.createGlobalAdminContext();
      const tenantAdminCtx = TestsUtil.createTenantAdminContext(global.oaeTests.tenants.cam);
      const anonymousCtx = new Context(global.oaeTests.tenants.cam);

      const invalidUserCtx = TestsUtil.createTenantAdminContext(global.oaeTests.tenants.cam);
      delete invalidUserCtx.user().isGlobalAdmin;

      try {
        assert.strictEqual(isGlobalAdministratorUser(undefined), false);
      } catch (error) {
      assert.strictEqual(error.msg, 'An empty context has been passed in');
      }
      
      try {
        assert.strictEqual(isGlobalAdministratorUser(null), false);
      } catch (error) {
        assert.strictEqual(error.msg, 'An empty context has been passed in');
      }
      
      try {
      assert.strictEqual(error.msg, 'The context is not associated to a tenant');
      } catch (error) {
        assert.strictEqual(isGlobalAdministratorUser({}), false);
      }
      
      try {
        assert.strictEqual(isGlobalAdministratorUser(anonymousCtx), false);
      } catch (error) {
        assert.strictEqual(errors[3], 'The user is not logged in');
      }
      
      try {
        assert.strictEqual(isGlobalAdministratorUser(invalidUserCtx), false);
      } catch (error) {
        assert.strictEqual(error.msg, 'The user object is invalid');
      }
      
      try {
        assert.strictEqual(isGlobalAdministratorUser(tenantAdminCtx), false);
      } catch (error) {
        assert.strictEqual(error.msg, 'The user is not a global administrator');
      }
      
      assert.strictEqual(isGlobalAdministratorUser(globalAdminCtx), true);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isArray
     */
    it('verify isArray validation', callback => {
      assert.strictEqual(isArray([1, 2, 3]), true);
      assert.strictEqual(isArray(null), false);
      assert.strictEqual(isArray(undefined), false);
      assert.strictEqual(isArray('a string'), false);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isBoolean
     */
    it('verify isBoolean validation', callback => {
      assert.strictEqual(isBoolean(true), true);
      assert.strictEqual(isBoolean(false), true);
      assert.strictEqual(isBoolean('true'), false);
      assert.strictEqual(isBoolean('false'), false);
      assert.strictEqual(isBoolean(0), false);
      assert.strictEqual(isBoolean(1), false);
      assert.strictEqual(isBoolean({}), false);
      assert.strictEqual(isBoolean([]), false);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isShortString
     */
    it('verify isShortString validation', callback => {
      const bigString = TestsUtil.generateRandomText(1001);
      try {
        assert.strictEqual(isShortString(null), false);
      } catch (error) {
        assert.ok(error);
      }
      assert.strictEqual(isShortString(''), false);
      assert.strictEqual(isShortString('valid'), true);
      assert.strictEqual(isShortString(bigString), false);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isMediumString
     */
    it('verify isMediumString validation', callback => {
      const bigString = TestsUtil.generateRandomText(10001);
      try {
        isMediumString(null);
      } catch (error) {
        assert.ok(error);
      }
      assert.strictEqual(isMediumString(''), false);
      assert.strictEqual(isMediumString('valid'), true);
      assert.strictEqual(isMediumString(bigString), false);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isLongString
     */
    it('verify isLongString validation', callback => {
      const bigString = TestsUtil.generateRandomText(100001);
      try {
        isLongString(null);
      } catch (error) {
        assert.ok(error);
      }
      assert.strictEqual(isLongString(''), false);
      assert.strictEqual(isLongString('valid'), true);
      assert.strictEqual(isLongString(bigString), false);

      return callback();
    });

    /**
     * Test that verifies the isDefined validation properly verifies a value is specified
     */
    it('verify isDefined validation', callback => {
      const err = { code: 400, msg: 'Funny error object, LOL' };

      try {
        isDefined(null);
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, err.msg);
        assert.strictEqual(error.code, err.code);
      }
      try {
        isDefined(undefined);
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, err.msg);
        assert.strictEqual(error.code, err.code);
      }
      try {
        isDefined();
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, err.msg);
        assert.strictEqual(error.code, err.code);
      }

      assert.strictEqual(isDefined(''), true);
      assert.strictEqual(isDefined('proper string'), true);
      assert.strictEqual(isDefined(0), true);
      assert.strictEqual(isDefined({}), true);
      assert.strictEqual(isDefined([]), true);
      assert.strictEqual(isDefined(false), true);
      assert.strictEqual(isDefined(true), true);

      return callback();
    });

    /**
     * Test that verifies the isHost validation properly verifies a value is a host
     */
    it('verify isHost validation', callback => {
      const err = { code: 400, msg: 'Funny error object, LOL' };

      // A set of invalid hosts
      try {
        isHost('not a valid host');
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, err.msg);
        assert.strictEqual(error.code, err.code);
      }
      
      try {
        isHost('invalid,character.com');
      } catch (error) {
          assert.ok(error);
        assert.strictEqual(error.msg, err.msg);
        assert.strictEqual(error.code, err.code); 
      }

      try {
        isHost('almost.but.not.quite com');
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, err.msg);
        assert.strictEqual(error.code, err.code); 
      }

      try {
        isHost('localhost:');
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, err.msg);
        assert.strictEqual(error.code, err.code); 
      }

      try {
        isHost('localhost:2000:');
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, err.msg);
        assert.strictEqual(error.code, err.code); 
      }

      // A set of valid hosts
      isHost('www.google.com');
      isHost('unity.ac');
      isHost('localhost:2000');
      isHost('trailing.dots.are.valid.too.');
      return callback();
    });
  });
});
