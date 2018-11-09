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

const assert = require('assert');
const _ = require('underscore');

const ConfigTestUtil = require('oae-config/lib/test/util');
const RestAPI = require('oae-rest');
const TestsUtil = require('oae-tests');

const UservoiceProfile = require('oae-uservoice/lib/internal/profile');
const UservoiceTestUtil = require('oae-uservoice/lib/test/util');

describe('UserVoice', () => {
  // REST contexts that are used to execute requests as a variety of different users in different tenants
  let globalAdminRestContext = null;
  let camAdminRestContext = null;
  let anonymousRestContext = null;

  /*!
     * Before the tests start, prepare all the REST contexts
     */
  before(callback => {
    // Initialize the REST contexts
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);

    // Do not follow redirects for any of the rest contexts
    globalAdminRestContext.followRedirect = false;
    camAdminRestContext.followRedirect = false;
    anonymousRestContext.followRedirect = false;

    return callback();
  });

  /*!
     * Before each test, ensure that the configuration has all the UserVoice SSO features enabled
     */
  beforeEach(callback => {
    // Enable UserVoice while configuring the base URL, subdomain and ssoKey
    return UservoiceTestUtil.setConfig(
      globalAdminRestContext,
      true,
      'https://testuservoice.uservoice.com',
      'testuservoice',
      'abc123',
      callback
    );
  });

  /*!
     * After each test, ensure the default language for the Cambridge tenant is reset to the system default
     */
  afterEach(callback => {
    // Ensure the cambridge tenant default language is cleared back to the default
    ConfigTestUtil.clearConfigAndWait(
      camAdminRestContext,
      null,
      ['oae-principals/user/defaultLanguage'],
      err => {
        assert.ok(!err);
        return callback();
      }
    );
  });

  describe('Redirect', () => {
    /**
     * Test that verifies the anonymous user redirects to UserVoice anonymously
     */
    it('verify it redirects the anonymous user to UserVoice anonymously', callback => {
      return UservoiceTestUtil.assertRedirect(
        anonymousRestContext,
        'https://testuservoice.uservoice.com',
        false,
        callback
      );
    });

    /**
     * Test that verifies a tenant admin redirects to UserVoice with an auth token
     */
    it('verify it redirects a tenant admin to UserVoice with an auth token', callback => {
      return UservoiceTestUtil.assertRedirect(
        camAdminRestContext,
        'https://testuservoice.uservoice.com',
        true,
        callback
      );
    });

    /**
     * Test that verifies an authenticated user redirects to UserVoice with an auth token
     */
    it('verify it redirects an authenticated user to UserVoice with an auth token', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, mrvisser) => {
        assert.ok(!err);
        mrvisser.restContext.followRedirect = false;
        return UservoiceTestUtil.assertRedirect(
          camAdminRestContext,
          'https://testuservoice.uservoice.com',
          true,
          callback
        );
      });
    });

    /**
     * Test that verifies redirecting to UserVoice gives an error when a subdomain is not configured in the tenant
     */
    it('verify it gives an error when subdomain is not properly configured for the tenant', callback => {
      // Clear UserVoice subdomain configuration
      UservoiceTestUtil.setConfig(globalAdminRestContext, null, null, '', null, () => {
        // Ensure redirect gives a 400 error
        UservoiceTestUtil.assertRedirectHasError(camAdminRestContext, 400, () => {
          // Make the UserVoice subdomain configuration nothing but whitespace
          UservoiceTestUtil.setConfig(globalAdminRestContext, null, null, '  ', null, () => {
            // Ensure redirect gives a 400 error
            return UservoiceTestUtil.assertRedirectHasError(camAdminRestContext, 400, callback);
          });
        });
      });
    });

    /**
     * Test that verifies the user is redirected without an auth token when there is no SSO key configured for the tenant
     */
    it('verify it redirects anonymously when there is no SSO key configured for the tenant', callback => {
      // Clear the UserVoice SSO key configuration
      UservoiceTestUtil.setConfig(globalAdminRestContext, null, null, null, '', () => {
        return UservoiceTestUtil.assertRedirect(
          camAdminRestContext,
          'https://testuservoice.uservoice.com',
          false,
          callback
        );
      });
    });

    /**
     * Test that verifies the user is redirected to a custom base URL when configured
     */
    it('verify it redirects to a custom base URL that is configured for a tenant', callback => {
      // Change to a custom insecure base URL
      UservoiceTestUtil.setConfig(
        globalAdminRestContext,
        null,
        'http://custom.baseurl.com',
        null,
        null,
        () => {
          return UservoiceTestUtil.assertRedirect(
            anonymousRestContext,
            'http://custom.baseurl.com',
            false,
            callback
          );
        }
      );
    });
  });

  describe('Profiles', () => {
    /**
     * Test that verifies no private information is sent to the UserVoice site for a user profile
     */
    it('verify it does not transfer private or loggedin user information', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, mrvisser, nico, bert) => {
        assert.ok(!err);

        // Apply privacy and public alias' to a couple of the users
        mrvisser.visibility = 'public';
        nico.visibility = 'loggedin';
        bert.visibility = 'private';

        mrvisser.publicAlias = 'mrvisser';
        nico.publicAlias = 'nico';
        bert.publicAlias = 'bert';

        const publicUser = mrvisser.user;
        const loggedinUser = nico.user;
        const privateUser = bert.user;

        // Ensure public user data ends up on UserVoice profile
        const publicProfile = UservoiceProfile.createUservoiceProfile(publicUser);
        assert.strictEqual(publicProfile.guid, publicUser.id);
        assert.strictEqual(publicProfile.display_name, publicUser.displayName);
        assert.strictEqual(publicProfile.locale, 'en');

        const loggedinProfile = UservoiceProfile.createUservoiceProfile(loggedinUser);
        assert.strictEqual(loggedinProfile.guid, loggedinUser.id);
        assert.strictEqual(loggedinProfile.display_name, loggedinUser.publicAlias);
        assert.strictEqual(loggedinProfile.locale, 'en');

        const privateProfile = UservoiceProfile.createUservoiceProfile(privateUser);
        assert.strictEqual(privateProfile.guid, privateUser.id);
        assert.strictEqual(privateProfile.display_name, privateUser.publicAlias);
        assert.strictEqual(privateProfile.locale, 'en');

        return callback();
      });
    });

    /**
     * Test that verifies the proper UserVoice-suported locale is sent to UserVoice for the user's profile
     */
    it('verify it properly maps the user locale to either a UserVoice-supported locale or nothing', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, mrvisser) => {
        assert.ok(!err);
        mrvisser = mrvisser.user;

        // Ensure the local is correctly converted into UserVoice supported locale
        mrvisser.locale = 'nl-NL';
        assert.strictEqual(UservoiceProfile.createUservoiceProfile(mrvisser).locale, 'nl');
        mrvisser.locale = 'nl_NL';
        assert.strictEqual(UservoiceProfile.createUservoiceProfile(mrvisser).locale, 'nl');

        // Ensure an alternative locale mapping is used for the inconsistent representations in UserVoice
        mrvisser.locale = 'fr-CA';
        assert.strictEqual(UservoiceProfile.createUservoiceProfile(mrvisser).locale, 'fr-CA');
        mrvisser.locale = 'fr_CA';
        assert.strictEqual(UservoiceProfile.createUservoiceProfile(mrvisser).locale, 'fr-CA');

        // Ensure a completely unsupported locale or no locale results in the tenant default being used
        delete mrvisser.locale;
        assert.strictEqual(UservoiceProfile.createUservoiceProfile(mrvisser).locale, 'en');
        mrvisser.locale = 'af_ZA';
        assert.strictEqual(UservoiceProfile.createUservoiceProfile(mrvisser).locale, 'en');

        // Set the tenant default to an unsupported language
        ConfigTestUtil.updateConfigAndWait(
          camAdminRestContext,
          null,
          { 'oae-principals/user/defaultLanguage': 'af_ZA' },
          err => {
            assert.ok(!err);

            // Ensure when mrvisser has the af_ZA locale, no locale is provided for the profile
            mrvisser.locale = 'af_ZA';
            assert.ok(
              !_.chain(UservoiceProfile.createUservoiceProfile(mrvisser))
                .keys()
                .contains('locale')
                .value()
            );

            // Ensure when mrvisser clears their locale, there is still no default
            delete mrvisser.locale;
            assert.ok(
              !_.chain(UservoiceProfile.createUservoiceProfile(mrvisser))
                .keys()
                .contains('locale')
                .value()
            );

            return callback();
          }
        );
      });
    });
  });
});
