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
import { Validator } from 'oae-util/lib/validator';

import * as TestsUtil from 'oae-tests/lib/util';

describe.skip('Utilities', () => {
  describe('Validator', () => {
    it('verify undefined gets checked as empty', callback => {
      const validator = new Validator();
      validator.check(undefined, 'foo').notEmpty();
      assert.ok(validator.hasErrors());

      return callback();
    });

    /**
     * Test whether or not the validator used to check for empty strings
     * is working as intended
     */
    it('verify empty validator', callback => {
      // Single test successful
      let validator = new Validator();
      validator.check('Non-empty string').notEmpty();
      assert.ok(!validator.hasErrors());
      assert.ok(!validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 0);

      // Single test failed
      validator = new Validator();
      validator.check('').notEmpty();
      assert.ok(validator.hasErrors());
      assert.ok(validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 1);

      validator = new Validator();
      validator.check(' ').notEmpty();
      assert.ok(validator.hasErrors());
      assert.ok(validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 1);

      // Multiple success
      validator = new Validator();
      validator.check('Non').notEmpty();
      validator.check('Empty').notEmpty();
      validator.check('String').notEmpty();
      assert.ok(!validator.hasErrors());
      assert.ok(!validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 0);

      // Multiple fail
      validator = new Validator();
      validator.check('').notEmpty();
      validator.check(' ').notEmpty();
      validator.check('   ').notEmpty();
      validator.check('String').notEmpty();
      assert.ok(validator.hasErrors());
      assert.strictEqual(validator.getErrors().length, 3);
      assert.strictEqual(validator.getErrorCount(), 3);

      return callback();
    });

    /**
     * Test whether or not the validator used to check for valid integers
     * is working as intended
     */
    it('verify integer validator', callback => {
      // Single test successful
      let validator = new Validator();
      validator.check(10).isInt();
      assert.ok(!validator.hasErrors());
      assert.ok(!validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 0);

      validator = new Validator();
      validator.check('20').isInt();
      assert.ok(!validator.hasErrors());
      assert.ok(!validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 0);

      // Single test failed
      validator = new Validator();
      validator.check('String').isInt();
      assert.ok(validator.hasErrors());
      assert.ok(validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 1);

      // Multiple success
      validator = new Validator();
      validator.check(0).isInt();
      validator.check(1).isInt();
      validator.check(100).isInt();
      validator.check(-100).isInt();
      assert.ok(!validator.hasErrors());
      assert.ok(!validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 0);

      // Multiple fail
      validator = new Validator();
      validator.check('').isInt();
      validator.check('10').isInt();
      validator.check('String').isInt();
      validator.check(100).isInt();
      assert.ok(validator.hasErrors());
      assert.strictEqual(validator.getErrors().length, 2);
      assert.strictEqual(validator.getErrorCount(), 2);

      return callback();
    });

    /**
     * Test whether or not the validator used to check for valid email addresses
     * is working as intended
     */
    it('verify email validator', callback => {
      // Single test successful
      let validator = new Validator();
      validator.check('nicolaas.matthijs@caret.cam.ac.uk').isEmail();
      assert.ok(!validator.hasErrors());
      assert.ok(!validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 0);

      // Single test failed
      validator = new Validator();
      validator.check('nicolaas matthijs@caret.cam.ac.uk').isEmail();
      assert.ok(validator.hasErrors());
      assert.ok(validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 1);

      validator = new Validator();
      validator.check('http://www.google.co.uk').isEmail();
      assert.ok(validator.hasErrors());
      assert.ok(validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 1);

      // Multiple success
      validator = new Validator();
      validator.check('nicolaas.matthijs@caret.cam.ac.uk').isEmail();
      validator.check('bertpareyn@gmail.com').isEmail();
      validator.check('sfmorgan@btinternet.com').isEmail();
      validator.check('sally.phillips+unique_reference@gmail.com').isEmail();
      assert.ok(!validator.hasErrors());
      assert.ok(!validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 0);

      // Multiple fail
      validator = new Validator();
      validator.check('').isEmail();
      validator.check('String').isEmail();
      validator.check('nicolaas matthijs@caret.cam.ac.uk').isEmail();
      validator.check('nicolaas.matthijs@caret.cam.ac.uk').isEmail();
      assert.ok(validator.hasErrors());
      assert.strictEqual(validator.getErrors().length, 3);
      assert.strictEqual(validator.getErrorCount(), 3);

      return callback();
    });

    /**
     * Test whether or not the validator used to check for valid URLs
     * is working as intended
     * @param  {Object} test     Standard nodeunit test object
     */
    it('verify URL validator', callback => {
      // Single test successful
      let validator = new Validator();
      validator.check('http://www.oaeproject.org').isUrl();
      assert.ok(!validator.hasErrors());
      assert.ok(!validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 0);

      validator = new Validator();
      validator.check('http://example.com/assert.html').isUrl();
      assert.ok(!validator.hasErrors());
      assert.ok(!validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 0);

      // Single test failed
      validator = new Validator();
      validator.check('String').isUrl();
      assert.ok(validator.hasErrors());
      assert.ok(validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 1);

      validator = new Validator();
      validator.check('://www.google.co.uk').isUrl();
      assert.ok(validator.hasErrors());
      assert.ok(validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 1);

      // Multiple success
      validator = new Validator();
      validator.check('https://oae-widgets.oaeproject.org/sdk').isUrl();
      validator.check('http://support.google.com/docs/bin/answer.py?hl=en&answer=66343').isUrl();
      validator.check('http://www.w3.org/2004/02/skos/core#broader').isUrl();
      validator.check('https://wordpress.org/support/topic/plugin-addthis-odd-url-string?replies=5').isUrl();
      assert.ok(!validator.hasErrors());
      assert.ok(!validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 0);

      // Multiple fail
      validator = new Validator();
      validator.check('').isUrl();
      validator.check('String').isUrl();
      validator.check('www.example.com').isUrl();
      validator.check('https://twimg0-a.akamaihd.net/profile_images/300425859/ls_1278_Nicolaas-website.jpg').isUrl();
      assert.ok(validator.hasErrors());
      assert.strictEqual(validator.getErrors().length, 2);
      assert.strictEqual(validator.getErrorCount(), 2);

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

      /// /////////////////////////
      // Single test successful //
      /// /////////////////////////

      let validator = new Validator();
      validator.check().isLoggedInUser(new Context(tenant1, user1));
      assert.ok(!validator.hasErrors());
      assert.ok(!validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 0);

      /// /////////////////////
      // Single test failed //
      /// /////////////////////

      // Empty context
      validator = new Validator();
      validator.check().isLoggedInUser(null);
      assert.ok(validator.hasErrors());
      assert.ok(validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 1);

      // Tenant, no user
      validator = new Validator();
      validator.check().isLoggedInUser(new Context(tenant1, null));
      assert.ok(validator.hasErrors());
      assert.ok(validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 1);

      // No tenant, user
      validator = new Validator();
      validator.check().isLoggedInUser(new Context(null, user1));
      assert.ok(validator.hasErrors());
      assert.ok(validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 1);

      // Invalid tenant, user
      validator = new Validator();
      validator.check().isLoggedInUser(new Context(tenant2, user1));
      assert.ok(validator.hasErrors());
      assert.ok(validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 1);

      /// ///////////////////
      // Multiple success //
      /// ///////////////////

      validator = new Validator();
      validator.check().isLoggedInUser(new Context(tenant1, user1));
      validator.check().isLoggedInUser(new Context(tenant1, user2));
      validator.check().isLoggedInUser(new Context(tenant1, user3));
      assert.ok(!validator.hasErrors());
      assert.ok(!validator.getErrors());
      assert.strictEqual(validator.getErrorCount(), 0);

      // Multiple fail
      validator = new Validator();
      validator.check().isLoggedInUser(new Context(tenant1, null));
      validator.check().isLoggedInUser(new Context(tenant2, user1));
      validator.check().isLoggedInUser(new Context(tenant2, user2));
      validator.check().isLoggedInUser(new Context(tenant1, user1));
      validator.check().isLoggedInUser(new Context(tenant1, user2));
      validator.check().isLoggedInUser(new Context(tenant1, user3));
      assert.ok(validator.hasErrors());
      assert.strictEqual(validator.getErrors().length, 3);
      assert.strictEqual(validator.getErrorCount(), 3);

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
      const validator = new Validator();
      validator.check().isLoggedInUser(new Context(camTenant), camTenant.alias);
      assert.strictEqual(validator.getErrors().length, 1);

      // Ensure it gives a validation error when authenticated to a different tenant
      validator.check().isLoggedInUser(new Context(gtTenant, user1), camTenant.alias);
      assert.strictEqual(validator.getErrors().length, 2);

      // Ensure it succeeds when validator the proper tenant
      validator.check().isLoggedInUser(new Context(camTenant, user1), camTenant.alias);
      validator.check().isLoggedInUser(new Context(gtTenant, user1), gtTenant.alias);
      assert.strictEqual(validator.getErrors().length, 2);

      return callback();
    });

    it('verify timezone validation', callback => {
      const validateTimeZone = function(timeZone, isValid) {
        const validator = new Validator();
        validator.check(timeZone).isValidTimeZone();
        assert.strictEqual(validator.hasErrors(), !isValid);
        assert.strictEqual(validator.getErrorCount(), isValid ? 0 : 1);
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

      const validator = new Validator();
      validator.check().isGlobalAdministratorUser(undefined);
      validator.check().isGlobalAdministratorUser(null);
      validator.check().isGlobalAdministratorUser({});
      validator.check().isGlobalAdministratorUser(anonymousCtx);
      validator.check().isGlobalAdministratorUser(invalidUserCtx);
      validator.check().isGlobalAdministratorUser(tenantAdminCtx);
      validator.check().isGlobalAdministratorUser(globalAdminCtx);

      // 7 checks, only 1 was valid
      const errors = validator.getErrors();
      assert.strictEqual(errors.length, 6);
      assert.strictEqual(errors[0], 'An empty context has been passed in');
      assert.strictEqual(errors[1], 'An empty context has been passed in');
      assert.strictEqual(errors[2], 'The context is not associated to a tenant');
      assert.strictEqual(errors[3], 'The user is not logged in');
      assert.strictEqual(errors[4], 'The user object is invalid');
      assert.strictEqual(errors[5], 'The user is not a global administrator');

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isArray
     */
    it('verify isArray validation', callback => {
      const validator = new Validator();
      validator.check().isArray([1, 2, 3]);
      validator.check().isArray(null);
      validator.check().isArray(undefined);
      validator.check().isArray('a string');
      assert.strictEqual(validator.getErrors().length, 3);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isBoolean
     */
    it('verify isBoolean validation', callback => {
      const validator = new Validator();
      validator.check().isBoolean(true);
      validator.check().isBoolean(false);
      validator.check().isBoolean('true');
      validator.check().isBoolean('false');
      validator.check().isBoolean(0);
      validator.check().isBoolean(1);
      validator.check().isBoolean({});
      validator.check().isBoolean([]);
      assert.strictEqual(validator.getErrors().length, 6);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isShortString
     */
    it('verify isShortString validation', callback => {
      const bigString = TestsUtil.generateRandomText(100);
      const validator = new Validator();
      validator.check(null).isShortString();
      validator.check('').isShortString();
      validator.check('valid').isShortString();
      validator.check(bigString).isShortString();
      assert.strictEqual(validator.getErrorCount(), 3);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isMediumString
     */
    it('verify isMediumString validation', callback => {
      const bigString = TestsUtil.generateRandomText(1000);
      const validator = new Validator();
      validator.check(null).isMediumString();
      validator.check('').isMediumString();
      validator.check('valid').isMediumString();
      validator.check(bigString).isMediumString();
      assert.strictEqual(validator.getErrorCount(), 3);

      return callback();
    });

    /**
     * Test that verifies validation results for a variety of inputs to validator.isLongString
     */
    it('verify isLongString validation', callback => {
      const bigString = TestsUtil.generateRandomText(10000);
      const validator = new Validator();
      validator.check(null).isLongString();
      validator.check('').isLongString();
      validator.check('valid').isLongString();
      validator.check(bigString).isLongString();
      assert.strictEqual(validator.getErrorCount(), 3);

      return callback();
    });

    /**
     * Test that verifies the isDefined validation properly verifies a value is specified
     */
    it('verify isDefined validation', callback => {
      const err = { code: 400, msg: 'Funny error object, LOL' };

      const validator = new Validator();
      validator.check(null, err).isDefined(null);
      validator.check(null, err).isDefined(undefined);
      validator.check(null, err).isDefined();
      assert.strictEqual(validator.getErrorCount(), 3);

      validator.check(null, err).isDefined('');
      validator.check(null, err).isDefined('proper string');
      validator.check(null, err).isDefined(0);
      validator.check(null, err).isDefined({});
      validator.check(null, err).isDefined([]);
      validator.check(null, err).isDefined(false);
      validator.check(null, err).isDefined(true);
      assert.strictEqual(validator.getErrorCount(), 3);

      return callback();
    });

    /**
     * Test that verifies the isHost validation properly verifies a value is a host
     */
    it('verify isHost validation', callback => {
      const err = { code: 400, msg: 'Funny error object, LOL' };

      const validator = new Validator();
      // A set of invalid hosts
      validator.check('not a valid host', err).isHost();
      validator.check('invalid,character.com', err).isHost();
      validator.check('almost.but.not.quite com', err).isHost();
      validator.check('localhost:', err).isHost();
      validator.check('localhost:2000:', err).isHost();
      assert.strictEqual(validator.getErrorCount(), 5);

      // A set of valid hosts
      validator.check('www.google.com', err).isHost();
      validator.check('unity.ac', err).isHost();
      validator.check('localhost:2000', err).isHost();
      validator.check('trailing.dots.are.valid.too.', err).isHost();
      assert.strictEqual(validator.getErrorCount(), 5);
      return callback();
    });
  });
});
