/*
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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
import { format } from 'util';
import _ from 'underscore';

import nock from 'nock';
import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import { Cookie } from 'tough-cookie';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests/lib/util.js';

import * as AuthenticationAPI from 'oae-authentication';
import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';

/**
 * Assert that the authentication config can be updated and the authentication strategies get refreshed
 *
 * For method parameter descriptions, @see RestAPI.Config#updateConfig
 */
const assertUpdateAuthConfigSucceeds = function (restContext, tenantAlias, configUpdate, callback) {
  // Update the config
  ConfigTestUtil.updateConfigAndWait(restContext, tenantAlias, configUpdate, (error) => {
    assert.ok(!error);
  });

  // Wait until the authentication API has finished refreshing its strategies
  AuthenticationAPI.emitter.once(AuthenticationConstants.events.REFRESHED_STRATEGIES, () => {
    // Verify that the changes were persisted correctly
    RestAPI.Config.getTenantConfig(restContext, tenantAlias, (error, config) => {
      assert.ok(!error);

      _.each(configUpdate, (value, key) => {
        const parts = key.split('/');
        assert.strictEqual(config[parts[0]][parts[1]][parts[2]], value);
      });

      return callback();
    });
  });
};

/**
 * Assert that a user can log in using the local authentication strategy
 *
 * @param  {RestContext}    restContext     The REST context with which to attempt to log in
 * @param  {String}         username        The username to log in with
 * @param  {String}         password        The password to log in with
 * @param  {Function}       callback        Invoked when the user has been logged in
 * @throws {Error}                          Thrown if the operation fails in an unexpected way
 */
const assertLocalLoginSucceeds = function (restContext, username, password, callback) {
  RestAPI.Authentication.login(restContext, username, password, (error) => {
    assert.ok(!error);

    // Assert the user is logged in
    RestAPI.User.getMe(restContext, (error, me) => {
      assert.ok(!error);
      assert.ok(!me.anon);

      return callback();
    });
  });
};

/**
 * Assert that a user can log in using the google authentication strategy
 *
 * @param  {String}         tenantHost              The host of the tenant on which to log in through google
 * @param  {String}         [email]                 The email address of the user that will sign in. If null, no email will be returned in the mocked response
 * @param  {Function}       callback                Invoked when it's been verified the user has logged in through google
 * @param  {RestContext}    callback.restContext    The rest context that was used to sign in through google
 * @param  {Response}       callback.response       The response that came back from the google callback endpoint
 */
const assertGoogleLoginSucceeds = function (tenantHost, email, callback) {
  _mockGoogleResponse(email);

  // A user returns from Google sign-in and hits our API
  const restContext = TestsUtil.createTenantRestContext(tenantHost);
  restContext.followRedirect = false;
  RestAPI.Authentication.googleCallback(restContext, { code: 'foo' }, (error, body, response) => {
    assert.ok(!error);
    assert.strictEqual(response.headers.location, '/');

    // Assert we were signed in successfully
    RestAPI.User.getMe(restContext, (error, me) => {
      assert.ok(!error);
      assert.ok(!me.anon);
      assert.strictEqual(me.email, email.toLowerCase());
      assert.strictEqual(me.authenticationStrategy, 'google');

      return callback(restContext, response);
    });
  });
};

/**
 * Assert that a user can not log in using the google authentication strategy
 *
 * @param  {String}         tenantHost              The host of the tenant on which to log in through google
 * @param  {String}         [email]                 The email address of the user that will sign in. If null, no email will be returned in the mocked response
 * @param  {String}         reason                  The expected authentication failure's reason
 * @param  {Function}       callback                Invoked when it's been verified the user was not able to sign in through google
 * @param  {RestContext}    callback.restContext    The rest context that was used to attempt to sign in through google
 * @param  {Response}       callback.response       The response that came back from the google callback endpoint
 */
const assertGoogleLoginFails = function (tenantHost, email, reason, callback) {
  _mockGoogleResponse(email);

  // A user returns from the Google sign-in page and hits our API
  const restContext = TestsUtil.createTenantRestContext(tenantHost);
  restContext.followRedirect = false;
  RestAPI.Authentication.googleCallback(restContext, { code: 'foo' }, (error, body, response) => {
    assert.ok(!error);
    assert.strictEqual(response.headers.location, '/?authentication=failed&reason=' + reason);

    // Assert we are still anonymous
    RestAPI.User.getMe(restContext, (error, me) => {
      assert.ok(!error);
      assert.ok(me.anon);

      return callback(restContext, response);
    });
  });
};

/**
 * Assert that a user can log in using the facebook authentication strategy
 *
 * @param  {String}         tenantHost              The tenant host to which to authenticate
 * @param  {Object}         [opts]                  Optional arguments
 * @param  {String}         [opts.email]            The email that should be returned from the Facebook profile
 * @param  {String}         [opts.redirectUrl]      The redirect url to send the user after successful login
 * @param  {Function}       callback                Invoked when login succeeds
 * @param  {RestContext}    callback.restContext    The authenticated REST context of the user that authenticated
 * @param  {Me}             callback.me             The `me` object of the authenticated user
 * @param  {Response}       callback.response       The raw response of the authentication request (e.g., the redirect to the activity page)
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertFacebookLoginSucceeds = function (tenantHost, options, callback) {
  options = options || {};

  _mockFacebookResponse({ email: options.email });

  // A user returns from Facebook sign-in and hits our API
  const restContext = TestsUtil.createTenantRestContext(tenantHost);
  restContext.followRedirect = false;

  // Initialize the cookie jar of the rest context before we try and set
  // any cookies
  RestAPI.User.getMe(restContext, (error) => {
    assert.ok(!error);

    let cookie = null;
    if (options.redirectUrl) {
      cookie = new Cookie({
        key: 'redirectUrl',
        value: encodeURIComponent(options.redirectUrl)
      });
      restContext.cookieJar.setCookie(cookie.toString(), 'http://localhost:2000/');
    }

    RestAPI.Authentication.facebookCallback(
      restContext,
      { code: 'foo' },
      (error, body, response) => {
        if (options.redirectUrl) {
          assert.strictEqual(response.headers.location, options.redirectUrl);
        } else {
          assert.strictEqual(response.headers.location, '/');
        }

        RestAPI.User.getMe(restContext, (error, me) => {
          assert.ok(!error);
          assert.ok(!me.anon);
          return callback(restContext, me, response);
        });
      }
    );
  });
};

/**
 * Assert that a user can not log in using the Facebook authentication strategy
 *
 * @param  {String}         tenantHost              The host of the tenant on which to log in through Facebook
 * @param  {String}         [email]                 The email address of the user that will sign in. If null, no email will be returned in the mocked response
 * @param  {String}         reason                  The expected authentication failure's reason
 * @param  {Function}       callback                Invoked when it's been verified the user was not able to sign in through Facebook
 * @param  {RestContext}    callback.restContext    The rest context that was used to attempt to sign in through Facebook
 * @param  {Response}       callback.response       The response that came back from the Facebook callback endpoint
 */
const assertFacebookLoginFails = function (tenantHost, email, reason, callback) {
  _mockFacebookResponse({ email });

  // A user returns from the Facebook sign-in page and hits our API
  const restContext = TestsUtil.createTenantRestContext(tenantHost);
  restContext.followRedirect = false;
  RestAPI.Authentication.facebookCallback(restContext, { code: 'foo' }, (error, body, response) => {
    assert.ok(!error);
    assert.strictEqual(response.headers.location, '/?authentication=failed&reason=' + reason);

    // Assert we are still anonymous
    RestAPI.User.getMe(restContext, (error, me) => {
      assert.ok(!error);
      assert.ok(me.anon);

      return callback(restContext, response);
    });
  });
};

/**
 * Get a nock instance
 *
 * @return {Nock}   The nock utility
 * @api private
 */
const _nock = function () {
  // Ensure we can still perform regular HTTP requests
  nock.enableNetConnect();

  return nock;
};

/**
 * Mock the facebook responses for requests the facebook passport strategy will
 * make
 *
 * @param  {Object}     [opts]          Optional arguments
 * @param  {String}     [opts.email]    The email of the facebook user profile, if any
 * @api private
 */
const _mockFacebookResponse = function (options) {
  options = options || {};

  const nock = _nock();

  nock('https://graph.facebook.com').post('/v2.0/oauth/access_token').reply(200);

  nock('https://graph.facebook.com')
    .get('/v2.0/me')
    .query({ fields: 'id,name,picture,email' })
    .reply(200, {
      id: _.random(100000),
      name: 'I am super great',
      email: options.email
    });
};

/**
 * Mock the google responses for requests the google passport strategy will make
 *
 * @param  {String}         [email]                 The email address of the user that will sign in. If null, no email will be returned in the mocked response
 * @api private
 */
const _mockGoogleResponse = function (email) {
  const nock = _nock();

  // Mock the "get access token" request in the OAuth2 cycle
  const accessToken = format('google_%s', _.random(10000));
  nock('https://www.googleapis.com').post('/oauth2/v4/token').reply(200, {
    // eslint-disable-next-line camelcase
    access_token: accessToken,
    // eslint-disable-next-line camelcase
    refresh_token: 'foo'
  });

  // Mock the "get user profile" request
  const mockedResponse = {
    kind: 'plus#person',
    etag: 'RqKWnRU4WW46-6W3rWhLR9',
    gender: 'male',
    emails: [],
    urls: [{ value: 'http://www.youtube.com/user/abc123', type: 'otherProfile', label: 'ABC 123' }],
    objectType: 'person',
    id: _.random(100000),
    displayName: 'Foo Bar',
    name: {
      familyName: 'Bar',
      givenName: 'Foo'
    },
    url: 'https://plus.google.com/' + _.random(10000000),
    image: {
      url: 'https://lh5.googleusercontent.com/-wfVubfsOBV0/AAAAAAAAAAI/AAAAAAAAAGQ/rEb5FmsQuiA/photo.jpg?sz=50',
      isDefault: false
    },
    isPlusUser: true,
    language: 'en',
    verified: false
  };
  if (email) {
    mockedResponse.emails.push({ value: email, type: 'account' });
  }

  nock('https://www.googleapis.com')
    .get('/plus/v1/people/me?access_token=' + accessToken)
    .reply(200, mockedResponse);
};

export {
  assertUpdateAuthConfigSucceeds,
  assertLocalLoginSucceeds,
  assertGoogleLoginSucceeds,
  assertGoogleLoginFails,
  assertFacebookLoginSucceeds,
  assertFacebookLoginFails
};
