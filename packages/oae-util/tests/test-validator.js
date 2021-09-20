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

import { Context } from 'oae-context';
import { Tenant } from 'oae-tenants/lib/model';
import { User } from 'oae-principals/lib/model.user';
import { Validator as validator } from 'oae-util/lib/validator';

const {
  isDefined,
  isShortString,
  isMediumString,
  isLongString,
  isBoolean,
  isArray,
  isGlobalAdministratorUser,
  isHost,
  isLoggedInUser,
  isValidTimeZone,
  isURL,
  isEmail,
  isInt,
  isEmpty,
  isDifferent,
  isOneOrGreater,
  isZeroOrGreater,
  toInt,
  notContains,
  dateIsIntoTheFuture,
  dateIsInThePast,
  isRoleValid,
  unless,
  isNotNull,
  validateInCase,
  getNestedObject,
  isIso3166Country,
  isObject,
  isModule,
  isANumber,
  isString,
  isArrayEmpty,
  isArrayNotEmpty,
  defaultToEmptyArray,
  defaultToEmptyObject,
  isNotEmpty
} = validator;
import * as TestsUtil from 'oae-tests/lib/util.js';

describe('Utilities', () => {
  describe('Validator', () => {
    it('verify undefined gets checked as empty', (callback) => {
      assert.isFalse(isEmpty(undefined));
      assert.isFalse(isEmpty(null));
      assert.isTrue(isEmpty(''));
      assert.isTrue(isEmpty([]));
      assert.isTrue(isEmpty({}));
      return callback();
    });

    /**
     * Test whether or not the validator used to check for empty strings
     * is working as intended
     */
    it('verify empty validator', (callback) => {
      assert.strictEqual(isNotEmpty('Non'), true);
      assert.strictEqual(isNotEmpty('Empty'), true);
      assert.strictEqual(isNotEmpty('String'), true);

      assert.strictEqual(isNotEmpty(''), false);
      assert.strictEqual(isNotEmpty(' '), false);
      assert.strictEqual(isNotEmpty('    '), false);

      return callback();
    });

    /**
     * Test whether or not the validator used to check for valid integers
     * is working as intended
     */
    it('verify integer validator', (callback) => {
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
      assert.strictEqual(isInt('String'), false);
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
    it('verify email validator', (callback) => {
      assert.strictEqual(isEmail('miguel.laginha@oae.project.org'), true);
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
    it('verify URL validator', (callback) => {
      assert.strictEqual(isURL('http://www.oaeproject.org'), true);
      assert.strictEqual(isURL('http://example.com/assert.html'), true);
      assert.strictEqual(isURL('https://oae-widgets.oaeproject.org/sdk'), true);
      assert.strictEqual(isURL('http://support.google.com/docs/bin/answer.py?hl=en&answer=66343'), true);
      assert.strictEqual(isURL('http://www.w3.org/2004/02/skos/core#broader'), true);
      assert.strictEqual(isURL('https://wordpress.org/support/topic/plugin-addthis-odd-url-string?replies=5'), true);
      assert.strictEqual(
        isURL('https://twimg0-a.akamaihd.net/profile_images/300425859/ls_1278_Nicolaas-website.jpg'),
        true
      );

      assert.strictEqual(isURL('String'), false);
      assert.strictEqual(isURL('://www.google.pt'), false);

      return callback();
    });

    /**
     * Test whether or not the validator used to check for a logged in OAE user is working as intended
     */
    it('verify isLoggedInUser correctly validates that the context is authenticated to any tenant', (callback) => {
      // Valid tenant
      const tenant1 = global.oaeTests.tenants.cam;
      // Invalid tenant
      const tenant2 = new Tenant(null, 'Invalid tenant', 2002);
      // Valid users
      const user1 = new User(tenant1.alias, 'u:camtest:nm417', 'nm417', 'nm417@example.com');
      const user2 = new User(tenant1.alias, 'u:camtest:nm417', 'nm417', 'nm417@example.com');
      const user3 = new User(tenant1.alias, 'u:camtest:nm417', 'nm417', 'nm417@example.com');

      assert.strictEqual(isLoggedInUser(new Context(tenant1, user1)), true);
      assert.strictEqual(isLoggedInUser(new Context(tenant1, user2)), true);
      assert.strictEqual(isLoggedInUser(new Context(tenant1, user3)), true);

      // Empty context
      assert.strictEqual(isLoggedInUser(null), false);

      // Tenant, no user
      assert.strictEqual(isLoggedInUser(new Context(tenant1, null)), false);

      // No tenant, user
      assert.strictEqual(isLoggedInUser(new Context(null, user1)), false);

      // Invalid tenant, user
      assert.strictEqual(isLoggedInUser(new Context(tenant2, user1)), false);
      assert.strictEqual(isLoggedInUser(new Context(tenant2, user2)), false);
      assert.strictEqual(isLoggedInUser(new Context(tenant2, user3)), false);

      return callback();
    });

    /**
     * Test that verifies the isLoggedInUser validator works when determining if a request context is authenticated to a
     * particular tenant
     */
    it('verify isLoggedInUser correctly validates that the request context is authenticated to a particular tenant', (callback) => {
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

    it('verify timezone validation', (callback) => {
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

      // None of invalid timezones either
      validateTimeZone('', false);
      validateTimeZone(undefined, false);
      validateTimeZone(null, false);
      validateTimeZone(Number.NaN, false);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isGlobalAdministratorUser
     */
    it('verify isGlobalAdministratorUser validation', (callback) => {
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
        assert.strictEqual(isGlobalAdministratorUser({}), false);
      } catch (error) {
        assert.strictEqual(error.msg, 'The context is not associated to a tenant');
      }

      try {
        assert.strictEqual(isGlobalAdministratorUser(anonymousCtx), false);
      } catch (error) {
        assert.strictEqual(error.msg, 'The user is not logged in');
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
    it('verify isArray validation', (callback) => {
      assert.strictEqual(isArray([1, 2, 3]), true);
      assert.strictEqual(isArray(), false);
      assert.strictEqual(isArray(undefined), false);
      assert.strictEqual(isArray(Number.NaN), false);
      assert.strictEqual(isArray(null), false);
      assert.strictEqual(isArray(undefined), false);
      assert.strictEqual(isArray('a string'), false);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isBoolean
     */
    it('verify isBoolean validation', (callback) => {
      assert.strictEqual(isBoolean(true), true);
      assert.strictEqual(isBoolean(false), true);
      assert.strictEqual(isBoolean('true'), false);
      assert.strictEqual(isBoolean('false'), false);
      assert.strictEqual(isBoolean(), false);
      assert.strictEqual(isBoolean(undefined), false);
      assert.strictEqual(isBoolean(Number.NaN), false);
      assert.strictEqual(isBoolean(0), false);
      assert.strictEqual(isBoolean(1), false);
      assert.strictEqual(isBoolean({}), false);
      assert.strictEqual(isBoolean([]), false);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isShortString
     */
    it('verify isShortString validation', (callback) => {
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
    it('verify isMediumString validation', (callback) => {
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
    it('verify isLongString validation', (callback) => {
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
    it('verify isDefined validation', (callback) => {
      const error_ = { code: 400, msg: 'Funny error object, LOL' };

      try {
        isDefined(null);
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, error_.msg);
        assert.strictEqual(error.code, error_.code);
      }

      try {
        isDefined(undefined);
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, error_.msg);
        assert.strictEqual(error.code, error_.code);
      }

      try {
        isDefined(Number.NaN);
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, error_.msg);
        assert.strictEqual(error.code, error_.code);
      }

      try {
        isDefined();
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, error_.msg);
        assert.strictEqual(error.code, error_.code);
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
    it('verify isHost validation', (callback) => {
      const error_ = { code: 400, msg: 'Funny error object, LOL' };

      // A set of invalid hosts
      try {
        isHost('not a valid host');
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, error_.msg);
        assert.strictEqual(error.code, error_.code);
      }

      try {
        isHost('invalid,character.com');
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, error_.msg);
        assert.strictEqual(error.code, error_.code);
      }

      try {
        isHost('almost.but.not.quite com');
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, error_.msg);
        assert.strictEqual(error.code, error_.code);
      }

      try {
        isHost('localhost:');
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, error_.msg);
        assert.strictEqual(error.code, error_.code);
      }

      try {
        isHost('localhost:2000:');
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(error.msg, error_.msg);
        assert.strictEqual(error.code, error_.code);
      }

      // A set of valid hosts
      isHost('www.google.com');
      isHost('unity.ac');
      isHost('localhost:2000');
      isHost('trailing.dots.are.valid.too.');
      return callback();
    });

    /**
     *
     */
    it('verify isDifferent validation', () => {
      assert.strictEqual(isDifferent('', ' '), true);
      assert.strictEqual(isDifferent(true, false), true);
      assert.strictEqual(isDifferent(false, 'false'), true);
      assert.strictEqual(isDifferent(true, 'true'), true);
      assert.strictEqual(isDifferent('a', ' '), true);
      assert.strictEqual(isDifferent(null, undefined), true);
      assert.strictEqual(isDifferent(undefined, 'undefined'), true);
      assert.strictEqual(isDifferent(null, 'null'), true);
      assert.strictEqual(isDifferent([], {}), true);
    });

    /**
     *
     */
    it('verify isOneOrGreater validation', () => {
      assert.strictEqual(isOneOrGreater(0), false);
      assert.strictEqual(isOneOrGreater(1), true);
      assert.strictEqual(isOneOrGreater(10), true);
      assert.strictEqual(isOneOrGreater(-1), false);
    });

    it('verify isZeroOrGreater validation', () => {
      assert.strictEqual(isZeroOrGreater(0), true);
      assert.strictEqual(isZeroOrGreater(1), true);
      assert.strictEqual(isZeroOrGreater(10), true);
      assert.strictEqual(isZeroOrGreater(-1), false);
    });

    it('verify toInt validation', () => {
      assert.strictEqual(toInt('1'), 1);
      assert.strictEqual(toInt('-1'), -1);
      assert.strictEqual(toInt('0'), 0);
      assert.strictEqual(toInt('10'), 10);
    });

    it('verify notContains validation', () => {
      assert.strictEqual(notContains('abcde', ' '), true);
      assert.strictEqual(notContains('abcde', 'cc'), true);
      assert.strictEqual(notContains('abcde', 'f'), true);
      assert.strictEqual(notContains('abcdef', 'a'), false);
      assert.strictEqual(notContains('abcdef', 'c'), false);
      assert.strictEqual(notContains('abcdef', 'f'), false);

      assert.strictEqual(notContains(' abcde ', ' a'), false);
      assert.strictEqual(notContains(' abcde ', 'e '), false);
    });

    it('verify dateIsIntoTheFuture validation', () => {
      const now = Date.now();
      const futureNow = now + 10;
      const pastNow = now - 10;

      assert.strictEqual(dateIsIntoTheFuture(futureNow), true);
      assert.strictEqual(dateIsIntoTheFuture(pastNow), false);
      assert.strictEqual(dateIsIntoTheFuture(String(futureNow)), true);
      assert.strictEqual(dateIsIntoTheFuture(String(pastNow)), false);
    });

    it('verify dateIsInThePast validation', () => {
      const now = Date.now();
      const futureNow = now + 10;
      const pastNow = now - 10;

      assert.strictEqual(dateIsInThePast(futureNow), false);
      assert.strictEqual(dateIsInThePast(pastNow), true);
      assert.strictEqual(dateIsInThePast(String(futureNow)), false);
      assert.strictEqual(dateIsInThePast(String(pastNow)), true);
    });

    it('verify isRoleValid validation', () => {
      assert.strictEqual(isRoleValid('false'), true);
      assert.strictEqual(isRoleValid('true'), true);
      assert.strictEqual(isRoleValid(false), false);
      assert.strictEqual(isRoleValid(true), true);
      assert.strictEqual(isRoleValid(null), true);
      assert.strictEqual(isRoleValid(Number.NaN), true);
      assert.strictEqual(isRoleValid(undefined), true);
    });

    it('verify isNotNull validation', () => {
      // notNull means that it must be defined but also not empty (strings, arrays, etc)

      assert.strictEqual(isNotNull(null), false);
      assert.strictEqual(isNotNull(undefined), false);
      assert.strictEqual(isNotNull(''), false);
      assert.strictEqual(isNotNull([]), false);
      assert.strictEqual(isNotNull({}), false);

      assert.strictEqual(isNotNull('null'), true);
      assert.strictEqual(isNotNull(Number.NaN), true);
      assert.strictEqual(isNotNull(true), true);
      assert.strictEqual(isNotNull(false), true);
    });

    it('verify isNotEmpty validation', () => {
      assert.strictEqual(isNotEmpty(''), false);
      assert.strictEqual(isNotEmpty(' '), false);
      assert.strictEqual(isNotEmpty(null), false);
      assert.strictEqual(isNotEmpty(undefined), false);
      assert.strictEqual(isNotEmpty(Number.NaN), false);

      assert.strictEqual(isNotEmpty('something'), true);
    });

    it('verify unless validation', () => {
      const error = new Error('surprise!');
      unless(isANumber, error)(1);
      unless(isANumber, error)(10);
      unless(isANumber, error)(0);
      unless(isANumber, error)(-1);

      try {
        unless(isANumber, error)('1');
      } catch (error) {
        assert.strictEqual(error, error);
      }

      try {
        unless(isANumber, error)('0');
      } catch (error) {
        assert.strictEqual(error, error);
      }

      try {
        unless(isANumber, error)(null);
      } catch (error) {
        assert.strictEqual(error, error);
      }

      try {
        unless(isANumber, error)([]);
      } catch (error) {
        assert.strictEqual(error, error);
      }

      try {
        unless(isANumber, error)({});
      } catch (error) {
        assert.strictEqual(error, error);
      }

      try {
        unless(isANumber, error)(false);
      } catch (error) {
        assert.strictEqual(error, error);
      }

      try {
        unless(isANumber, error)(undefined);
      } catch (error) {
        assert.strictEqual(error, error);
      }

      try {
        unless(isANumber, error)(Number.NaN);
      } catch (error) {
        assert.strictEqual(error, error);
      }
    });

    it('verify validateInCase validation', () => {
      assert.strictEqual(validateInCase(true, isANumber)(1), true);
      assert.strictEqual(validateInCase(true, isANumber)(10), true);
      assert.strictEqual(validateInCase(true, isANumber)(0), true);
      assert.strictEqual(validateInCase(true, isANumber)(-1), true);
      assert.strictEqual(validateInCase(true, isANumber)(-10), true);

      assert.strictEqual(validateInCase(false, isANumber)(1), true);
      assert.strictEqual(validateInCase(false, isANumber)(10), true);
      assert.strictEqual(validateInCase(false, isANumber)(0), true);
      assert.strictEqual(validateInCase(false, isANumber)(-1), true);
      assert.strictEqual(validateInCase(false, isANumber)(-10), true);

      assert.strictEqual(validateInCase(true, isANumber)('1'), false);
      assert.strictEqual(validateInCase(true, isANumber)('10'), false);
      assert.strictEqual(validateInCase(true, isANumber)('0'), false);
      assert.strictEqual(validateInCase(true, isANumber)('-1'), false);
      assert.strictEqual(validateInCase(true, isANumber)('-10'), false);

      assert.strictEqual(validateInCase(false, isANumber)('1'), true);
      assert.strictEqual(validateInCase(false, isANumber)('10'), true);
      assert.strictEqual(validateInCase(false, isANumber)('0'), true);
      assert.strictEqual(validateInCase(false, isANumber)('-1'), true);
      assert.strictEqual(validateInCase(false, isANumber)('-10'), true);
    });

    it('verify getNestedObject validation', () => {
      const complexObject = {
        name: 'grandma',
        age: 86,
        descendents: { name: 'mama', age: 56, descendents: { name: 'me', age: 26 } }
      };
      const getAttribute = getNestedObject(complexObject);
      assert.strictEqual(getAttribute(['name']), 'grandma');
      assert.strictEqual(getAttribute(['age']), 86);
      assert.strictEqual(getAttribute(['bloodType']), undefined);
      assert.strictEqual(isObject(getAttribute(['descendents'])), true);

      assert.strictEqual(getAttribute(['descendents', 'name']), 'mama');
      assert.strictEqual(getAttribute(['descendents', 'age']), 56);
      assert.strictEqual(getAttribute(['descendents', 'bloodType']), undefined);
      assert.strictEqual(isObject(getAttribute(['descendents', 'descendents'])), true);

      assert.strictEqual(getAttribute(['descendents', 'descendents', 'name']), 'me');
      assert.strictEqual(getAttribute(['descendents', 'descendents', 'age']), 26);
      assert.strictEqual(getAttribute(['descendents', 'descendents', 'bloodType']), undefined);
      assert.strictEqual(getAttribute(['descendents', 'descendents', 'descendents']), undefined);
    });

    it('verify isIso3166Country validation', () => {
      assert.strictEqual(isIso3166Country('Portugal'), false);
      assert.strictEqual(isIso3166Country('PT_pt'), false);
      assert.strictEqual(isIso3166Country('PT'), true);
      assert.strictEqual(isIso3166Country('EU'), false);
      assert.strictEqual(isIso3166Country('UK'), false);
      assert.strictEqual(isIso3166Country('PT/Lisbon'), false);
      assert.strictEqual(isIso3166Country('PT/pt'), false);
      assert.strictEqual(isIso3166Country(''), false);
      assert.strictEqual(isIso3166Country(null), false);
      assert.strictEqual(isIso3166Country(undefined), false);
      assert.strictEqual(isIso3166Country(false), false);
      assert.strictEqual(isIso3166Country([]), false);
      assert.strictEqual(isIso3166Country({}), false);
      assert.strictEqual(isIso3166Country(Number.NaN), false);
    });

    it('verify isObject validation', () => {
      assert.strictEqual(isObject({}), true);
      assert.strictEqual(isObject({ a: 1, b: 2, c: 3 }), true);
      assert.strictEqual(isObject([]), true);
      assert.strictEqual(isObject([1, 2, 3]), true);
      assert.strictEqual(isObject([]), true);
      assert.strictEqual(isObject({}), true);

      assert.strictEqual(isObject(''), false);
      assert.strictEqual(isObject(null), false);
      assert.strictEqual(isObject(Number.NaN), false);
      assert.strictEqual(isObject(undefined), false);
      assert.strictEqual(isObject(false), false);
    });

    it('verify isModule validation', () => {
      assert.strictEqual(isModule(TestsUtil), true);
      assert.strictEqual(isModule({}), true);
      assert.strictEqual(isModule({ a: 1, b: 2, c: 3 }), true);
      assert.strictEqual(isModule([]), true);
      assert.strictEqual(isModule([1, 2, 3]), true);
      assert.strictEqual(isModule([]), true);
      assert.strictEqual(isModule({}), true);

      assert.strictEqual(isModule(''), false);
      assert.strictEqual(isModule(null), false);
      assert.strictEqual(isModule(Number.NaN), false);
      assert.strictEqual(isModule(undefined), false);
      assert.strictEqual(isModule(false), false);
    });

    it('verify isANumber validation', () => {
      assert.strictEqual(isANumber(1), true);
      assert.strictEqual(isANumber(-1), true);
      assert.strictEqual(isANumber(10), true);
      assert.strictEqual(isANumber(-10), true);
      assert.strictEqual(isANumber(0), true);
      assert.strictEqual(isANumber(Number.NaN), true);

      assert.strictEqual(isANumber(''), false);
      assert.strictEqual(isANumber(' '), false);
      assert.strictEqual(isANumber('1'), false);
      assert.strictEqual(isANumber('-1'), false);
      assert.strictEqual(isANumber(null), false);
      assert.strictEqual(isANumber(undefined), false);
      assert.strictEqual(isANumber(true), false);
      assert.strictEqual(isANumber({}), false);
      assert.strictEqual(isANumber([]), false);
    });

    it('verify isString validation', () => {
      assert.strictEqual(isString(1), false);
      assert.strictEqual(isString(-1), false);
      assert.strictEqual(isString(10), false);
      assert.strictEqual(isString(-10), false);
      assert.strictEqual(isString(0), false);
      assert.strictEqual(isString(Number.NaN), false);

      assert.strictEqual(isString(''), true);
      assert.strictEqual(isString(' '), true);
      assert.strictEqual(isString('1'), true);
      assert.strictEqual(isString('-1'), true);

      assert.strictEqual(isString(null), false);
      assert.strictEqual(isString(undefined), false);
      assert.strictEqual(isString(true), false);
      assert.strictEqual(isString({}), false);
      assert.strictEqual(isString([]), false);
    });

    it('verify isArrayEmpty validation', () => {
      assert.strictEqual(isArrayEmpty([]), true);

      assert.strictEqual(isArrayEmpty([1, 2, 3, 4, 5]), false);
      assert.strictEqual(isArrayEmpty({}), false);
      assert.strictEqual(isArrayEmpty(''), false);
      assert.strictEqual(isArrayEmpty(null), false);
      assert.strictEqual(isArrayEmpty(undefined), false);
      assert.strictEqual(isArrayEmpty(false), false);
      assert.strictEqual(isArrayEmpty(Number.NaN), false);
    });

    it('verify isArrayNotEmpty validation', () => {
      assert.strictEqual(isArrayNotEmpty([1, 2, 3, 4, 5]), true);

      assert.strictEqual(isArrayNotEmpty([]), false);
      assert.strictEqual(isArrayNotEmpty({}), false);
      assert.strictEqual(isArrayNotEmpty(''), false);
      assert.strictEqual(isArrayNotEmpty(null), false);
      assert.strictEqual(isArrayNotEmpty(undefined), false);
      assert.strictEqual(isArrayNotEmpty(false), false);
      assert.strictEqual(isArrayNotEmpty(Number.NaN), false);
    });

    it('verify defaultToEmptyArray validation', () => {
      assert.notStrictEqual(defaultToEmptyArray([1, 2, 3, 4, 5]), [1, 2, 3, 4, 5]);
      assert.strictEqual(defaultToEmptyArray(true), true);
      assert.strictEqual(defaultToEmptyArray('abc'), 'abc');
      assert.notStrictEqual(defaultToEmptyArray({ a: 1, b: 2, c: 3 }), { a: 1, b: 2, c: 3 });

      assert.notStrictEqual(defaultToEmptyArray(null), []);
      assert.notStrictEqual(defaultToEmptyArray(undefined), []);
      assert.notStrictEqual(defaultToEmptyArray(Number.NaN), []);
      assert.notStrictEqual(defaultToEmptyArray(''), []);
    });

    it('verify defaultToEmptyObject validation', () => {
      assert.notStrictEqual(defaultToEmptyObject([1, 2, 3, 4, 5]), [1, 2, 3, 4, 5]);
      assert.strictEqual(defaultToEmptyObject(true), true);
      assert.strictEqual(defaultToEmptyObject('abc'), 'abc');
      assert.notStrictEqual(defaultToEmptyObject({ a: 1, b: 2, c: 3 }), { a: 1, b: 2, c: 3 });

      assert.notStrictEqual(defaultToEmptyObject(null), {});
      assert.notStrictEqual(defaultToEmptyObject(undefined), {});
      assert.notStrictEqual(defaultToEmptyObject(Number.NaN), {});
      assert.notStrictEqual(defaultToEmptyObject(''), {});
    });
  });
});
