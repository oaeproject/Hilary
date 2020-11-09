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

import path from 'path';
import { assert } from 'chai';
import fs from 'fs';
import util from 'util';
import _ from 'underscore';
import request from 'request';

import * as ConfigTestUtil from 'oae-config/lib/test/util';
import { Cookie } from 'tough-cookie';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util';
import * as TestsUtil from 'oae-tests';

import * as AuthenticationAPI from 'oae-authentication';
import { AuthenticationConstants } from 'oae-authentication/lib/constants';
import * as AuthenticationTestUtil from 'oae-authentication/lib/test/util';
import { setUpConfig } from 'oae-config/lib/api';
import * as ShibbolethAPI from 'oae-authentication/lib/strategies/shibboleth/api';

const DUMMY_BASE = 'http://localhost';
const Config = setUpConfig('oae-authentication');

describe('Authentication', () => {
  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;

  /**
   * Function that will fill up the global admin rest context
   */
  before(() => {
    // Fill up global admin rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
  });

  /**
   * Test util function to enable an authentication strategy
   *
   * @param  {String}     strategyName            The name of the authentication strategy to enable
   * @param  {Function}   enabledCallback         Standard function that will be invoked when the strategy is enabled
   * @param  {Function}   enabledCallback.done    Standard function that you will have to invoke once you're done with the strategy and it can be reset again
   * @param  {Function}   resetCallback           Standard function that will be invoked when the strategy has been reset
   */
  const _enableStrategy = function(strategyName, enabledCallback, resetCallback) {
    const strategyStatus = Config.getValue(
      global.oaeTests.tenants.global.alias,
      strategyName,
      'enabled'
    );

    // Enable strategy
    const configUpdate = {};
    configUpdate['oae-authentication/' + strategyName + '/enabled'] = true;
    AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
      globalAdminRestContext,
      global.oaeTests.tenants.localhost.alias,
      configUpdate,
      () => {
        // The strategy has been enabled, perform some assertions
        enabledCallback(() => {
          // Reset strategy to cached status
          configUpdate['oae-authentication/' + strategyName + '/enabled'] = strategyStatus;
          return AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
            globalAdminRestContext,
            global.oaeTests.tenants.localhost.alias,
            configUpdate,
            resetCallback
          );
        });
      }
    );
  };

  /**
   * Disables an external authentication strategy and verifies the endpoint no longer responds to
   * authentication requests.
   *
   * @param  {String}     strategyName    The strategy to disable. e.g., `twitter`, `facebook`, ..
   * @param  {String}     method          The HTTP method to use for the callback URL. Some strategies (e.g., `SAML2`) require a POST callback
   * @param  {Function}   callback        Standard callback function
   */
  const verifyEndpointIsDisabled = function(strategyName, method, callback) {
    _enableStrategy(
      strategyName,
      done => {
        const options = {
          uri: 'http://' + global.oaeTests.tenants.localhost.host + '/api/auth/' + strategyName,
          headers: {
            host: global.oaeTests.tenants.localhost.host,
            referer: '/'
          },
          method: 'POST',
          followRedirect: false
        };
        request(options, (err, response /* , body */) => {
          assert.notExists(err);
          assert.strictEqual(response.statusCode, 302);

          // Now disable it
          const configUpdate = {};
          configUpdate['oae-authentication/' + strategyName + '/enabled'] = false;
          AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
            globalAdminRestContext,
            global.oaeTests.tenants.localhost.alias,
            configUpdate,
            () => {
              // A disabled endpoint should return a 401.
              request(options, (err, response /* , body */) => {
                assert.notExists(err);
                assert.strictEqual(response.statusCode, 302);
                assert.strictEqual(response.headers.location, '/?authentication=disabled');
                options.uri =
                  'http://' +
                  global.oaeTests.tenants.localhost.host +
                  '/api/auth/' +
                  strategyName +
                  '/callback';
                options.method = method;

                request(options, (err, response /* , body */) => {
                  assert.notExists(err);
                  assert.strictEqual(response.statusCode, 302);
                  assert.strictEqual(response.headers.location, '/?authentication=disabled');

                  // Reset the strategy
                  done();
                });
              });
            }
          );
        });
      },
      callback
    );
  };

  /**
   * Verifies that the given strategy forwards the client to the given host
   *
   * @param  {String}   strategyName      The name of the authentication strategy to use
   * @param  {String}   host              The host that the strategy is expected to forward the user to
   * @param  {Function} callback          Standard callback function
   */
  const verifyForward = function(strategyName, host, callback) {
    _enableStrategy(
      strategyName,
      done => {
        const options = {
          uri: 'http://' + global.oaeTests.tenants.localhost.host + '/api/auth/' + strategyName,
          headers: {
            host: global.oaeTests.tenants.localhost.host,
            referer: '/'
          },
          method: 'POST',
          followRedirect: false
        };
        request(options, (err, res /* , body */) => {
          assert.notExists(err);
          assert.strictEqual(res.statusCode, 302);
          assert.strictEqual(new URL(res.headers.location).hostname, host);

          return done();
        });
      },
      callback
    );
  };

  /**
   * Verifies that an authentication strategy can deal with parameter tampering
   *
   * @param  {String}     strategyName    The name of the authentication strategy to test
   * @param  {String}     method          The HTTP method to use
   * @param  {Object}     parameters      The parameters (either querystring or POST parameters) to send in the request
   * @param  {Function}   callback        Standard callback function
   */
  const verifyCallbackTampering = function(strategyName, method, parameters, callback) {
    _enableStrategy(
      strategyName,
      done => {
        const options = {
          uri:
            'http://' +
            global.oaeTests.tenants.localhost.host +
            '/api/auth/' +
            strategyName +
            '/callback',
          headers: {
            host: global.oaeTests.tenants.localhost.host
          },
          method,
          followRedirect: false
        };
        if (method === 'GET') {
          options.qs = parameters;
        } else {
          options.form = parameters;
        }

        request(options, (err, response /* , body */) => {
          assert.notExists(err);
          assert.strictEqual(response.statusCode, 302);
          assert.strictEqual(response.headers.location, '/?authentication=error');
          return done();
        });
      },
      callback
    );
  };

  describe('External authentication', () => {
    /**
     * Revert the localhost tenant's hostname to its old value
     */
    afterEach(callback => {
      callback = _.once(callback);

      const tenantUpdate = { host: global.oaeTests.tenants.localhost.host };
      RestAPI.Tenants.updateTenant(
        globalAdminRestContext,
        global.oaeTests.tenants.localhost.alias,
        tenantUpdate,
        err => {
          if (err) {
            if (err.msg === 'The hostname has already been taken') {
              // This means the test did not change the localhost tenant's hostname
              // so we can ignore this error and immediately move on to the next test
              return callback();
            }

            let msg = 'Did not expect an error message when reverting the localhost hostname.';
            msg += 'This might cause failures further down the line.';
            assert.fail(err.msg, '', msg);
          }
        }
      );

      // When we did update the test we need to wait untill the authentication strategies have been refreshed
      AuthenticationAPI.emitter.once(
        AuthenticationConstants.events.REFRESHED_STRATEGIES,
        (/* tenant */) => {
          return callback();
        }
      );
    });

    /**
     * Verifies that /api/auth/google sends the client to google
     */
    it('verify forward to google', callback => {
      verifyForward('google', 'accounts.google.com', callback);
    });

    /**
     * Verifies that /api/auth/facebook sends the client to facebook
     */
    it('verify forward to facebook', callback => {
      verifyForward('facebook', 'www.facebook.com', callback);
    });

    /**
     * Verifies that /api/auth/twitter sends the client to twitter
     */
    it('verify forward to twitter', callback => {
      verifyForward('twitter', 'api.twitter.com', callback);
    });

    /**
     * Verifies that disabling the CAS authentication mechanism in the Config
     * disabled the authentication logic in the REST endpoints.
     */
    it('verify disabling the CAS strategy', callback => {
      verifyEndpointIsDisabled('cas', 'GET', callback);
    });

    /**
     * Verifies that disabling the Facebook authentication mechanism in the Config
     * disabled the authentication logic in the REST endpoints.
     */
    it('verify disabling the Facebook strategy', callback => {
      verifyEndpointIsDisabled('facebook', 'GET', callback);
    });

    /**
     * Verifies that disabling the Google authentication mechanism in the Config
     * disabled the authentication logic in the REST endpoints.
     */
    it('verify disabling the Google strategy', callback => {
      verifyEndpointIsDisabled('google', 'GET', callback);
    });

    /**
     * Verifies that disabling the Shibboleth authentication mechanism in the Config
     * disabled the authentication logic in the REST endpoints.
     */
    it('verify disabling the Shibboleth strategy', callback => {
      verifyEndpointIsDisabled('shibboleth', 'GET', callback);
    });

    /**
     * Verifies that disabling the Twitter authentication mechanism in the Config
     * disabled the authentication logic in the REST endpoints.
     */
    it('verify disabling the Twitter strategy', callback => {
      verifyEndpointIsDisabled('twitter', 'GET', callback);
    });

    /**
     * Test that verifies that the Twitter authentication mechanism can deal with URL tampering
     */
    it('verify the Twitter callback endpoint can deal with URL tampering', callback => {
      // eslint-disable-next-line camelcase
      verifyCallbackTampering('twitter', 'GET', { oauth_token: 'not-valid' }, callback);
    });

    /**
     * Test that verifies that the Google authentication mechanism can deal with URL tampering
     */
    it('verify the Google callback endpoint can deal with URL tampering', callback => {
      verifyCallbackTampering('google', 'GET', { code: 'not-valid' }, callback);
    });

    /**
     * Test that verifies that the Facebook authentication mechanism can deal with URL tampering
     */
    it('verify the Facebook callback endpoint can deal with URL tampering', callback => {
      verifyCallbackTampering('facebook', 'GET', { code: 'not-valid' }, callback);
    });

    /**
     * Test that verifies that the authentication strategies are refreshed when a tenant is updated
     */
    it('verify the authentication strategies are refreshed when a tenant is updated', callback => {
      _enableStrategy(
        'google',
        done => {
          // Sanity check that Google is requesting authentication for localhost:2001
          let restContext = TestsUtil.createTenantRestContext(
            global.oaeTests.tenants.localhost.host
          );
          restContext.followRedirect = false;
          RestAPI.Authentication.googleRedirect(restContext, (err, body, response) => {
            assert.notExists(err);

            // Assert a redirect
            assert.strictEqual(response.statusCode, 302);

            // Assert we're redirecting with the localhost:2001 hostname
            let redirectUri = util.format(
              'http://%s/api/auth/google/callback',
              global.oaeTests.tenants.localhost.host
            );
            let parsedUrl = new URL(response.headers.location);
            assert.strictEqual(parsedUrl.searchParams.get('redirect_uri'), redirectUri);

            // Update the localhost tenant (and ensure that it's truly different, otherwise this test is useless)
            const tenantUpdate = { host: '127.0.0.1:2001' };
            assert.notStrictEqual(tenantUpdate.host, global.oaeTests.tenants.localhost.host);
            RestAPI.Tenants.updateTenant(
              globalAdminRestContext,
              global.oaeTests.tenants.localhost.alias,
              tenantUpdate,
              err => {
                assert.notExists(err);
              }
            );

            // Wait until the authentication api has finished refreshing its strategies
            AuthenticationAPI.emitter.once(
              AuthenticationConstants.events.REFRESHED_STRATEGIES,
              tenant => {
                // Assert we refreshed the strategies for the localhost tenant
                assert.strictEqual(tenant.alias, global.oaeTests.tenants.localhost.alias);
                assert.strictEqual(tenant.host, tenantUpdate.host);

                // Verify the authentication strategies are using the new tenant hostname
                restContext = TestsUtil.createTenantRestContext(tenantUpdate.host);
                restContext.followRedirect = false;
                RestAPI.Authentication.googleRedirect(restContext, (err, body, response) => {
                  assert.notExists(err);

                  // Assert a redirect
                  assert.strictEqual(response.statusCode, 302);

                  // Assert we're redirecting with the new hostname
                  redirectUri = util.format(
                    'http://%s/api/auth/google/callback',
                    tenantUpdate.host
                  );
                  parsedUrl = new URL(response.headers.location);
                  assert.strictEqual(parsedUrl.searchParams.get('redirect_uri'), redirectUri);
                  return done();
                });
              }
            );
          });
        },
        callback
      );
    });

    /**
     * Test that verifies that non-authoritative strategies cannot create user accounts
     * with an email address that does not match the configured tenant email domain
     */
    it('verify non-authoritative strategies cannot create user accounts with an email address that does not match the configured email domain', callback => {
      // Create a tenant and enable the external authentication strategies
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(
        tenantAlias,
        tenantHost,
        (err, tenant, tenantAdminRestContext) => {
          assert.notExists(err);
          const config = {
            'oae-authentication/facebook/enabled': true,
            'oae-authentication/google/enabled': true
          };
          AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
            tenantAdminRestContext,
            null,
            config,
            () => {
              // Signing in without providing an email should fail
              AuthenticationTestUtil.assertFacebookLoginFails(
                tenant.host,
                null,
                'email_missing',
                () => {
                  // Signing in with an email address that does not belong to the configured
                  // email domain should fail
                  let email = TestsUtil.generateTestEmailAddress();
                  AuthenticationTestUtil.assertFacebookLoginFails(
                    tenant.host,
                    email,
                    'email_domain_mismatch',
                    () => {
                      // Signing in with an email address that does belong to the configured
                      // email domain should succeed
                      email = TestsUtil.generateTestEmailAddress(
                        null,
                        tenant.emailDomains[0]
                      ).toLowerCase();
                      AuthenticationTestUtil.assertFacebookLoginSucceeds(
                        tenant.host,
                        { email },
                        (restCtx, me) => {
                          assert.strictEqual(me.email, email);

                          // Similarly, signing in through Google with an email address that does not match
                          // the configured email domain should result in an authentication failure
                          email = TestsUtil.generateTestEmailAddress();
                          AuthenticationTestUtil.assertGoogleLoginFails(
                            tenant.host,
                            email,
                            'email_domain_mismatch',
                            () => {
                              // Signing in with an email address that does belong to the configured
                              // email domain should succeed
                              email = TestsUtil.generateTestEmailAddress(
                                null,
                                tenant.emailDomains[0]
                              ).toLowerCase();
                              AuthenticationTestUtil.assertGoogleLoginSucceeds(
                                tenant.host,
                                email,
                                (/* restCtx, me */) => {
                                  return callback();
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });

  describe('CAS authentication', () => {
    // Our mocked CAS server variables
    let app = null;
    let server = null;
    let port = null;

    // A string that can be used with our mocked CAS server that will return a succesfull response
    let validTicket = null;
    let externalId = null;
    let email = null;

    /**
     * Function that will start up a mocked CAS server. The url will be configured for the `localhost` tenant
     */
    beforeEach(callback => {
      TestsUtil.createTestServer((_app, _server, _port) => {
        app = _app;
        server = _server;
        port = _port;

        validTicket = 'ticket-' + _.random(0, 10000);
        externalId = 'sg555@' + _.random(0, 10000);
        email = TestsUtil.generateTestEmailAddress();
        app.get('/cas/serviceValidate', (req, res) => {
          if (req.query.ticket === validTicket) {
            let successXml = '<cas:serviceResponse>';
            successXml += '<cas:authenticationSuccess>';
            successXml += '<cas:user>' + externalId + '</cas:user>';
            successXml += '<cas:attributes>';
            successXml += '  <cas:displayName>Simon</cas:displayName>';
            successXml += '  <cas:email>' + email + '</cas:email>';
            successXml += '</cas:attributes>';
            successXml += '</cas:authenticationSuccess>';
            successXml += '</cas:serviceResponse>';
            res.status(200).send(successXml);
          } else {
            res
              .status(401)
              .send(
                '<cas:serviceResponse><cas:authenticationFailure>true</cas:authenticationFailure></cas:serviceResponse>'
              );
          }
        });

        // Setup the CAS strategy (but do not enable it just yet)
        const configUpdate = {};
        configUpdate['oae-authentication/cas/url'] = 'http://localhost:' + _port + '/cas';
        configUpdate['oae-authentication/cas/loginPath'] = '/login';
        configUpdate['oae-authentication/cas/mapDisplayName'] = '{displayName}';
        configUpdate['oae-authentication/cas/mapEmail'] = '{email}';
        return AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
          globalAdminRestContext,
          global.oaeTests.tenants.localhost.alias,
          configUpdate,
          callback
        );
      });
    });

    /**
     * Function that will close the mocked CAS server and clear the config values
     */
    afterEach(callback => {
      server.close(err => {
        assert.notExists(err);
        const keysToClear = [
          'oae-authentication/cas/url',
          'oae-authentication/cas/loginPath',
          'oae-authentication/cas/mapDisplayName',
          'oae-authentication/cas/mapEmail'
        ];

        ConfigTestUtil.clearConfigAndWait(
          globalAdminRestContext,
          global.oaeTests.tenants.localhost.alias,
          keysToClear,
          err => {
            assert.notExists(err);
          }
        );

        AuthenticationAPI.emitter.once(
          AuthenticationConstants.events.REFRESHED_STRATEGIES,
          (/* tenant */) => {
            // Clear the email domain
            TenantsTestUtil.updateTenantAndWait(
              globalAdminRestContext,
              global.oaeTests.tenants.localhost.alias,
              { emailDomains: '' },
              err => {
                assert.notExists(err);
                return callback();
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies the user gets forwarded to the CAS server
     */
    it('verify forward to cas', callback => {
      _enableStrategy('cas', (/* done */) => {
        const restContext = TestsUtil.createTenantRestContext(
          global.oaeTests.tenants.localhost.host
        );
        restContext.followRedirect = false;
        RestAPI.Authentication.casRedirect(restContext, (err, body, response) => {
          assert.notExists(err);
          assert.strictEqual(response.statusCode, 302);

          // Assert we're redirected to the proper CAS endpoint
          const casLocation = new URL(response.headers.location);
          assert.strictEqual(casLocation.hostname, 'localhost');
          assert.strictEqual(parseInt(casLocation.port, 10), port);
          assert.strictEqual(casLocation.pathname, '/cas/login');
          assert.ok(casLocation.search);
          assert.strictEqual(
            casLocation.searchParams.get('service'),
            'http://localhost:2001/api/auth/cas/callback'
          );

          // Configure the login path
          const configUpdate = { 'oae-authentication/cas/loginPath': '/login/something/foo' };
          AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
            globalAdminRestContext,
            global.oaeTests.tenants.localhost.alias,
            configUpdate,
            () => {
              // The CAS redirect should now redirect to the new login url
              RestAPI.Authentication.casRedirect(restContext, (err, body, response) => {
                assert.notExists(err);
                assert.strictEqual(response.statusCode, 302);

                // Assert we're redirected to the proper CAS endpoint
                const casLocation = new URL(response.headers.location);
                assert.strictEqual(casLocation.hostname, 'localhost');
                assert.strictEqual(parseInt(casLocation.port, 10), port);
                assert.strictEqual(casLocation.pathname, '/cas/login/something/foo');
                assert.ok(casLocation.search);
                assert.strictEqual(
                  casLocation.searchParams.get('service'),
                  'http://localhost:2001/api/auth/cas/callback'
                );
                return callback();
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies the ticket gets validated
     */
    it('verify ticket validation', callback => {
      _enableStrategy(
        'cas',
        done => {
          const restContext = TestsUtil.createTenantRestContext(
            global.oaeTests.tenants.localhost.host
          );
          restContext.followRedirect = false;
          RestAPI.Authentication.casCallback(
            restContext,
            { ticket: 'invalid-ticket' },
            (err, body, response) => {
              assert.notExists(err);
              assert.strictEqual(response.statusCode, 302);
              assert.strictEqual(response.headers.location, '/?authentication=error');

              // Try with a valid ticket
              RestAPI.Authentication.casCallback(
                restContext,
                { ticket: validTicket },
                (err, body, response) => {
                  assert.notExists(err);
                  assert.strictEqual(response.statusCode, 302);
                  assert.strictEqual(response.headers.location, '/');
                  return done();
                }
              );
            }
          );
        },
        callback
      );
    });

    /**
     * Test that verifies the CAS strategy can deal with an error from the CAS server
     */
    it('verify ticket error handling', callback => {
      // By configuring the CAS url to something non existant, we will trigger an error in the validation step
      const configUpdate = {};
      configUpdate['oae-authentication/cas/url'] = 'http://nothing.here.local';
      AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
        globalAdminRestContext,
        global.oaeTests.tenants.localhost.alias,
        configUpdate,
        () => {
          _enableStrategy(
            'cas',
            done => {
              // Trigger a ticket validation error by attempting to log in
              const restContext = TestsUtil.createTenantRestContext(
                global.oaeTests.tenants.localhost.host
              );
              restContext.followRedirect = false;
              RestAPI.Authentication.casCallback(
                restContext,
                { ticket: 'Someticket' },
                (err, body, response) => {
                  assert.notExists(err);
                  assert.strictEqual(response.statusCode, 302);
                  assert.strictEqual(
                    response.headers.location,
                    '/?authentication=failed&reason=tampering'
                  );
                  return done();
                }
              );
            },
            callback
          );
        }
      );
    });

    /**
     * Test that verifies the ticket gets validated
     */
    it('verify CAS attribute mapping', callback => {
      _enableStrategy(
        'cas',
        done => {
          // Log in with our CAS server
          const restContext = TestsUtil.createTenantRestContext(
            global.oaeTests.tenants.localhost.host
          );
          restContext.followRedirect = false;
          RestAPI.Authentication.casCallback(
            restContext,
            { ticket: validTicket },
            (err, body, response) => {
              assert.notExists(err);
              assert.strictEqual(response.statusCode, 302);
              assert.strictEqual(response.headers.location, '/');

              // Check that the attributes were parsed correctly
              RestAPI.User.getMe(restContext, (err, me) => {
                assert.notExists(err);
                assert.ok(!me.anon);
                assert.strictEqual(me.displayName, 'Simon');
                assert.strictEqual(me.email, email.toLowerCase());
                assert.strictEqual(me.authenticationStrategy, 'cas');

                return done();
              });
            }
          );
        },
        callback
      );
    });

    /**
     * Test that verifies that accounts with an invalid email address can still be created
     */
    it('verify accounts with an invalid email address get created', callback => {
      _enableStrategy(
        'cas',
        done => {
          email = 'an invalid email address';

          // Log in with our CAS server
          const restContext = TestsUtil.createTenantRestContext(
            global.oaeTests.tenants.localhost.host
          );
          restContext.followRedirect = false;
          RestAPI.Authentication.casCallback(
            restContext,
            { ticket: validTicket },
            (err, body, response) => {
              assert.notExists(err);
              assert.strictEqual(response.statusCode, 302);
              assert.strictEqual(response.headers.location, '/');

              // Check that the attributes were parsed correctly
              RestAPI.User.getMe(restContext, (err, me) => {
                assert.notExists(err);
                assert.ok(!me.anon);
                assert.strictEqual(me.displayName, 'Simon');
                assert.strictEqual(me.authenticationStrategy, 'cas');
                assert.ok(!me.email);

                return done();
              });
            }
          );
        },
        callback
      );
    });

    /**
     * Test that verifies that misconfigured attributes doe not break the authentication flow
     */
    it('verify misconfigured attribute mapping does not break the authentication flow', callback => {
      _enableStrategy(
        'cas',
        done => {
          // Misconfigure some attributes
          const configUpdate = {};
          configUpdate['oae-authentication/cas/mapDisplayName'] = '}displayname{';
          AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
            globalAdminRestContext,
            global.oaeTests.tenants.localhost.alias,
            configUpdate,
            () => {
              // Log in with our CAS server, authentication should succeed
              const restContext = TestsUtil.createTenantRestContext(
                global.oaeTests.tenants.localhost.host
              );
              restContext.followRedirect = false;
              RestAPI.Authentication.casCallback(
                restContext,
                { ticket: validTicket },
                (err, body, response) => {
                  assert.notExists(err);
                  assert.strictEqual(response.statusCode, 302);
                  assert.strictEqual(response.headers.location, '/');

                  // Check that the attributes were parsed correctly
                  RestAPI.User.getMe(restContext, (err, me) => {
                    assert.notExists(err);
                    assert.ok(!me.anon);
                    assert.strictEqual(me.authenticationStrategy, 'cas');

                    // Nothing can be replaced from the attribute template, so we use it as-is
                    assert.strictEqual(me.displayName, '}displayname{');

                    return done();
                  });
                }
              );
            }
          );
        },
        callback
      );
    });

    /**
     * Test that verifies that the user is sent to the proper logout url on the CAS server
     * when the user logs out of OAE
     */
    it('verify CAS logout', callback => {
      const configUpdate = {};
      configUpdate['oae-authentication/cas/logoutUrl'] = 'http://localhost:' + port + '/cas/logout';
      AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
        globalAdminRestContext,
        global.oaeTests.tenants.localhost.alias,
        configUpdate,
        () => {
          _enableStrategy(
            'cas',
            done => {
              // Log in with our CAS server
              const restContext = TestsUtil.createTenantRestContext(
                global.oaeTests.tenants.localhost.host
              );
              restContext.followRedirect = false;
              RestAPI.Authentication.casCallback(
                restContext,
                { ticket: validTicket },
                (err, body, response) => {
                  assert.notExists(err);
                  assert.strictEqual(response.statusCode, 302);
                  assert.strictEqual(response.headers.location, '/');

                  // Sanity check we're logged in
                  RestAPI.User.getMe(restContext, (err, me) => {
                    assert.notExists(err);
                    assert.ok(!me.anon);
                    assert.strictEqual(me.authenticationStrategy, 'cas');

                    // Log out
                    RestAPI.Authentication.logout(restContext, (err, data, response) => {
                      assert.notExists(err);

                      // The user should be redirected to the CAS server
                      assert.strictEqual(response.statusCode, 302);
                      assert.ok(response.headers.location);
                      assert.strictEqual(
                        response.headers.location,
                        'http://localhost:' + port + '/cas/logout'
                      );

                      // Sanity-check we're logged out
                      RestAPI.User.getMe(restContext, (err, me) => {
                        assert.notExists(err);
                        assert.ok(me.anon);
                        return done();
                      });
                    });
                  });
                }
              );
            },
            callback
          );
        }
      );
    });

    /**
     * Test that verifies that accounts with an email address that does not match the tenant
     * configured email domain can be created
     */
    it('verify accounts with an email address that does not match the tenant configured email domain can be created', callback => {
      _enableStrategy(
        'cas',
        done => {
          // Configure an email domain
          const emailDomain = TenantsTestUtil.generateTestTenantHost();
          TenantsTestUtil.updateTenantAndWait(
            globalAdminRestContext,
            global.oaeTests.tenants.localhost.alias,
            { emailDomains: [emailDomain] },
            err => {
              assert.notExists(err);

              // Log in through CAS with an email address that definitely does not belong to
              // the tenant's configured email domain
              const otherEmailDomain = TenantsTestUtil.generateTestTenantHost();
              assert.notStrictEqual(emailDomain, otherEmailDomain);
              email = TestsUtil.generateTestEmailAddress(null, otherEmailDomain);

              const restContext = TestsUtil.createTenantRestContext(
                global.oaeTests.tenants.localhost.host
              );
              restContext.followRedirect = false;
              RestAPI.Authentication.casCallback(
                restContext,
                { ticket: validTicket },
                (err, body, response) => {
                  assert.notExists(err);
                  assert.strictEqual(response.statusCode, 302);
                  assert.strictEqual(response.headers.location, '/');

                  // Check that the attributes were parsed correctly
                  RestAPI.User.getMe(restContext, (err, me) => {
                    assert.notExists(err);
                    assert.ok(!me.anon);
                    assert.strictEqual(me.displayName, 'Simon');
                    assert.strictEqual(me.email, email.toLowerCase());
                    assert.strictEqual(me.authenticationStrategy, 'cas');

                    return done();
                  });
                }
              );
            }
          );
        },
        callback
      );
    });
  });

  describe('Shibboleth authentication', () => {
    /**
     * Function that will configure the shibboleth authentication strategy
     */
    beforeEach(callback => {
      // Setup the Shibboleth strategy (but do not enable it just yet)
      const configUpdate = {};
      configUpdate['oae-authentication/shibboleth/idpEntityID'] =
        'https://idp.example.com/shibboleth';
      return AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
        globalAdminRestContext,
        global.oaeTests.tenants.localhost.alias,
        configUpdate,
        callback
      );
    });

    /**
     * Function that will clear the config values
     */
    afterEach(callback => {
      const keysToClear = ['oae-authentication/shibboleth/idpEntityID'];

      ConfigTestUtil.clearConfigAndWait(
        globalAdminRestContext,
        global.oaeTests.tenants.localhost.alias,
        keysToClear,
        err => {
          assert.notExists(err);
        }
      );

      AuthenticationAPI.emitter.once(
        AuthenticationConstants.events.REFRESHED_STRATEGIES,
        (/* tenant */) => {
          // Clear the email domain
          TenantsTestUtil.updateTenantAndWait(
            globalAdminRestContext,
            global.oaeTests.tenants.localhost.alias,
            { emailDomains: '' },
            err => {
              assert.notExists(err);
              return callback();
            }
          );
        }
      );
    });

    /**
     * Perform the inital steps of the Shibboleth authentication flow:
     *   1.  Declare that you want to log in with Shibboleth on the localhost tenant
     *   2.  Hit the SP endpoint and verify that the user is redirect to the Shibboleth login handlers
     *
     * @param  {String}         [redirectUrl]                   The URL where the user should be redirected to once authenticated in the system
     * @param  {Function}       callback                        Standard callback function
     * @param  {RestContext}    callback.tenantRestContext      The rest context that can be used on the tenant on which you want to sign in
     * @param  {RestContext}    callback.spRestContext          The rest context that can be used on the service provider "tenant"
     */
    const _initiateShibbolethAuthFlow = function(redirectUrl, callback) {
      const tenantRestContext = TestsUtil.createTenantRestContext(
        global.oaeTests.tenants.localhost.host
      );
      tenantRestContext.followRedirect = false;
      // TenantRestContext.followAllRedirects = false;
      // tenantRestContext.followOriginalHttpMethod = false;
      RestAPI.Authentication.shibbolethTenantRedirect(
        tenantRestContext,
        redirectUrl,
        (err, body, response) => {
          assert.notExists(err);
          assert.strictEqual(response.statusCode, 302);

          // Assert we're redirected to the SP host
          const spHost = ShibbolethAPI.getSPHost();
          const location = new URL(response.headers.location);
          assert.strictEqual(location.host, spHost);
          assert.strictEqual(location.pathname, '/api/auth/shibboleth/sp');

          // Assert that we pass in the correct parameters
          assert.ok(location.search);
          assert.strictEqual(
            location.searchParams.get('tenantAlias'),
            global.oaeTests.tenants.localhost.alias
          );
          assert.ok(location.searchParams.get('signature'));
          assert.ok(location.searchParams.get('expires'));

          // Assert we can use this parameters with our SP and that it redirects us to the login handler
          const spRestContext = TestsUtil.createTenantRestContext(spHost);
          spRestContext.followRedirect = false;
          // SpRestContext.followAllRedirects = false;
          // spRestContext.followOriginalHttpMethod = false;

          RestAPI.Authentication.shibbolethSPRedirect(
            spRestContext,
            TestsUtil.objectifySearchParams(location.searchParams),
            (err, body, response) => {
              assert.notExists(err);
              assert.strictEqual(response.statusCode, 302);

              // Assert we're redirected to the proper Shibboleth handler
              const location = new URL(response.headers.location, DUMMY_BASE);
              assert.strictEqual(location.pathname, '/Shibboleth.sso/Login');

              // Assert that we pass in the entity ID of the IdP and a target where the user should be redirected back to
              assert.ok(location.search);
              assert.strictEqual(
                location.searchParams.get('entityID'),
                'https://idp.example.com/shibboleth'
              );
              assert.strictEqual(
                location.searchParams.get('target'),
                '/api/auth/shibboleth/sp/returned'
              );

              return callback(tenantRestContext, spRestContext);
            }
          );
        }
      );
    };

    /**
     * Perform the callback steps of the Shibboleth authentication flow
     *
     * @param  {RestContext}    tenantRestContext           The rest context that can be used on the tenant on which you want to sign in
     * @param  {RestContext}    spRestContext               The rest context that can be used on the service provider "tenant"
     * @param  {Object}         attributes                  The attributes that mod_shib is supposed to pass into the SP callback endpoint
     * @param  {String}         [expectedRedirectUrl]       The URL where the user should be redirected to once he arrives on the tenant. Defaults to `/`
     * @param  {Function}       callback                    Standard callback function
     */
    const _callbackShibbolethAuthFlow = function(
      tenantRestContext,
      spRestContext,
      attributes,
      expectedRedirectUrl,
      callback
    ) {
      expectedRedirectUrl = expectedRedirectUrl || '/';

      // The user returns from the Shibboleth IdP and arrives on our SP
      RestAPI.Authentication.shibbolethSPCallback(
        spRestContext,
        attributes,
        (err, body, response) => {
          assert.notExists(err);
          assert.strictEqual(response.statusCode, 302);

          // Assert that we're redirected back to the tenant
          const location = new URL(response.headers.location);
          assert.strictEqual(location.host, global.oaeTests.tenants.localhost.host);
          assert.strictEqual(location.pathname, '/api/auth/shibboleth/callback');

          // Assert that the user id of the created user is present
          assert.ok(location.search);
          assert.ok(location.searchParams.get('userId'));
          assert.ok(location.searchParams.get('signature'));
          assert.ok(location.searchParams.get('expires'));

          // We arrive back at our tenant
          RestAPI.Authentication.shibbolethTenantCallback(
            tenantRestContext,
            TestsUtil.objectifySearchParams(location.searchParams),
            (err, body, response) => {
              assert.notExists(err);

              // We should be redirected to the specified redirect URL
              assert.strictEqual(response.statusCode, 302);
              assert.strictEqual(response.headers.location, expectedRedirectUrl);

              return callback();
            }
          );
        }
      );
    };

    /**
     * Get a stream that points towards a CSV file
     *
     * @return {Stream}     A readable stream pointing to a CSV file
     */
    const getShibbolethCSVfile = function() {
      return fs.createReadStream(path.join(__dirname, '/data/shibboleth.csv'));
    };

    /**
     * Test that verifies the user gets forwarded to our SP endpoint
     */
    it('verify redirection flow', callback => {
      _enableStrategy(
        'shibboleth',
        done => {
          // Initiate the Shibboleth auth flow
          _initiateShibbolethAuthFlow('/content/bla', (tenantRestContext, spRestContext) => {
            const email = TestsUtil.generateTestEmailAddress();
            const attributes = {
              // Fake a session ID to log in
              'shib-session-id': Math.random(),

              // Fake some data about the IdP
              'persistent-id':
                'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' +
                Math.random(),
              identityProvider: 'https://idp.example.com/shibboleth',
              affiliation: 'Digital Services',
              unscopedAffiliation: 'OAE Team',

              // Generate an external id
              // eslint-disable-next-line camelcase
              remote_user: 'simon' + Math.random(),

              // Pass along some attributes
              displayname: 'Simon',
              email,
              locale: 'en_UK'
            };

            // Perform the callback part of the authentication flow
            _callbackShibbolethAuthFlow(
              tenantRestContext,
              spRestContext,
              attributes,
              '/content/bla',
              () => {
                // Assert we're logged in and the attributes were correctly persisted
                RestAPI.User.getMe(tenantRestContext, (err, me) => {
                  assert.notExists(err);
                  assert.ok(!me.anon);
                  assert.strictEqual(me.authenticationStrategy, 'shibboleth');
                  assert.strictEqual(me.displayName, 'Simon');
                  assert.strictEqual(me.email, email.toLowerCase());
                  assert.strictEqual(me.locale, 'en_UK');
                  return done();
                });
              }
            );
          });
        },
        callback
      );
    });

    /**
     * Test that verifies that the remote_user attribute is used when no displayName attributes are specified
     */
    it('verify the remote_user attribute is used when no displayName attributes are specified', callback => {
      _enableStrategy(
        'shibboleth',
        done => {
          // Initiate the Shibboleth auth flow
          _initiateShibbolethAuthFlow('/content/bla', (tenantRestContext, spRestContext) => {
            const email = TestsUtil.generateTestEmailAddress();
            const attributes = {
              // Fake a session ID to log in
              'shib-session-id': Math.random(),

              // Fake some data about the IdP
              'persistent-id':
                'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' +
                Math.random(),
              identityProvider: 'https://idp.example.com/shibboleth',
              affiliation: 'Digital Services',
              unscopedAffiliation: 'OAE Team',

              // Generate an external id
              // eslint-disable-next-line camelcase
              remote_user: 'simon' + Math.random(),

              // Pass along some attributes, but don't specify a display name attribute
              email,
              locale: 'en_UK'
            };

            // Perform the callback part of the authentication flow
            _callbackShibbolethAuthFlow(
              tenantRestContext,
              spRestContext,
              attributes,
              '/content/bla',
              () => {
                // Assert we're logged in and the attributes were correctly persisted
                RestAPI.User.getMe(tenantRestContext, (err, me) => {
                  assert.notExists(err);
                  assert.ok(!me.anon);
                  assert.strictEqual(me.authenticationStrategy, 'shibboleth');
                  assert.strictEqual(me.displayName, attributes.remote_user);
                  assert.strictEqual(me.email, email.toLowerCase());
                  assert.strictEqual(me.locale, 'en_UK');
                  return done();
                });
              }
            );
          });
        },
        callback
      );
    });

    /**
     * Test utility for verifying that the user visibility will be set to private when remote_user is used to populate
     * display name and resembles a shibboleth identifier
     *
     * @param  {String}         remoteUser           The remote_user attribute we want to use to populate display name
     * @param  {Function}       callback             Standard callback function
     */
    const verifyInvalidDisplayNameMakesProfilePrivate = function(remoteUser, callback) {
      // Initiate the Shibboleth auth flow
      _initiateShibbolethAuthFlow('/content/bla', (tenantRestContext, spRestContext) => {
        const email = TestsUtil.generateTestEmailAddress();
        const attributes = {
          // Fake a session ID to log in
          'shib-session-id': Math.random(),

          // Fake some data about the IdP
          'persistent-id':
            'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' + Math.random(),
          identityProvider: 'https://idp.example.com/shibboleth',
          affiliation: 'Digital Services',
          unscopedAffiliation: 'OAE Team',

          // Set the remote user value which will be used as the display name
          // eslint-disable-next-line camelcase
          remote_user: remoteUser,

          // Pass along some attributes, but don't specify a display name attribute
          email,
          locale: 'en_UK'
        };

        // Perform the callback part of the authentication flow
        _callbackShibbolethAuthFlow(
          tenantRestContext,
          spRestContext,
          attributes,
          '/content/bla',
          () => {
            // Assert we're logged in and the attributes were correctly persisted
            RestAPI.User.getMe(tenantRestContext, (err, me) => {
              assert.notExists(err);
              assert.ok(!me.anon);
              assert.strictEqual(me.authenticationStrategy, 'shibboleth');
              assert.strictEqual(me.displayName, attributes.remote_user);
              assert.strictEqual(me.visibility, 'private');
              callback();
            });
          }
        );
      });
    };

    /**
     * Test that verifies that the user visibility will be set to private if displayName resembles a shibboleth identifier,
     * URL or email address
     */
    it('verify the user will be private if displayName resembles a Shibboleth identifier, URL or email address', callback => {
      _enableStrategy(
        'shibboleth',
        done => {
          // Profile should be made private if display name looks like a shibboleth identifier
          verifyInvalidDisplayNameMakesProfilePrivate('shibboleth!' + Math.random, () => {
            // Profile should be made private if display name is an email address
            verifyInvalidDisplayNameMakesProfilePrivate(
              TestsUtil.generateTestEmailAddress(),
              () => {
                // Profile should be made private if display name is a URL starting with https...
                verifyInvalidDisplayNameMakesProfilePrivate(
                  'https://idp.example.com/shibboleth',
                  () => {
                    // ...or http.
                    verifyInvalidDisplayNameMakesProfilePrivate(
                      'http://example.tenant.com/profile',
                      () => {
                        return done();
                      }
                    );
                  }
                );
              }
            );
          });
        },
        callback
      );
    });

    /**
     * Test that verifies the parameters are validated when redirecting a user from a tenant to our SP
     */
    it('verify SP redirect', callback => {
      _enableStrategy(
        'shibboleth',
        done => {
          // The tenant we try to authenticate on
          const tenantAlias = global.oaeTests.tenants.localhost.alias;

          // The rest context for our SP "tenant"
          const spHost = ShibbolethAPI.getSPHost();
          const spRestContext = TestsUtil.createTenantRestContext(spHost);
          spRestContext.followRedirect = false;

          // Missing or invalid parameters
          RestAPI.Authentication.shibbolethSPRedirect(
            spRestContext,
            { tenantAlias: null, signature: null, expires: null },
            (err /* , body, response */) => {
              assert.strictEqual(err.code, 400);
              RestAPI.Authentication.shibbolethSPRedirect(
                spRestContext,
                { tenantAlias, signature: null, expires: null },
                (err /* , body, response */) => {
                  assert.strictEqual(err.code, 400);
                  RestAPI.Authentication.shibbolethSPRedirect(
                    spRestContext,
                    { tenantAlias, signature: 'sign', expires: null },
                    (err /* , body, response */) => {
                      assert.strictEqual(err.code, 400);
                      RestAPI.Authentication.shibbolethSPRedirect(
                        spRestContext,
                        { tenantAlias, signature: 'sign', expires: 'not a number' },
                        (err /* , body, response */) => {
                          assert.strictEqual(err.code, 400);
                          RestAPI.Authentication.shibbolethSPRedirect(
                            spRestContext,
                            {
                              tenantAlias,
                              signature: 'sign',
                              expires: Date.now() - 1000
                            },
                            (err /* , body, response */) => {
                              assert.strictEqual(err.code, 400);

                              // Invalid signature
                              RestAPI.Authentication.shibbolethSPRedirect(
                                spRestContext,
                                {
                                  tenantAlias,
                                  signature: 'sign',
                                  expires: Date.now() + 10000
                                },
                                (err /* , body, response */) => {
                                  assert.strictEqual(err.code, 401);

                                  // The SP Redirect endpoint should not be functioning on a regular tenant
                                  const tenantRestContext = TestsUtil.createTenantRestContext(
                                    global.oaeTests.tenants.cam.host
                                  );
                                  RestAPI.Authentication.shibbolethSPRedirect(
                                    tenantRestContext,
                                    {},
                                    (err /* , body, response */) => {
                                      assert.strictEqual(err.code, 501);

                                      return done();
                                    }
                                  );
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        },
        callback
      );
    });

    /**
     * Test that verifies the parameters are validated when redirecting a user from our SP to the tenant callback endpoint
     */
    it('verify the tenant callback endpoint validates its parameters', callback => {
      _enableStrategy(
        'shibboleth',
        done => {
          const restContext = TestsUtil.createTenantRestContext(
            global.oaeTests.tenants.localhost.host
          );
          restContext.followRedirect = false;

          // Missing or invalid parameters
          RestAPI.Authentication.shibbolethTenantCallback(
            restContext,
            { userId: null, signature: null, expires: null },
            (err /* , body, response */) => {
              assert.strictEqual(err.code, 400);
              RestAPI.Authentication.shibbolethTenantCallback(
                restContext,
                { userId: 'u:foo:bar', signature: null, expires: null },
                (err /* , body, response */) => {
                  assert.strictEqual(err.code, 400);
                  RestAPI.Authentication.shibbolethTenantCallback(
                    restContext,
                    { userId: 'u:foo:bar', signature: 'sign', expires: null },
                    (err /* , body, response */) => {
                      assert.strictEqual(err.code, 400);
                      RestAPI.Authentication.shibbolethTenantCallback(
                        restContext,
                        { userId: 'u:foo:bar', signature: 'sign', expires: 'expires' },
                        (err /* , body, response */) => {
                          assert.strictEqual(err.code, 400);
                          RestAPI.Authentication.shibbolethTenantCallback(
                            restContext,
                            { userId: 'u:foo:bar', signature: 'sign', expires: Date.now() - 1000 },
                            (err /* , body, response */) => {
                              assert.strictEqual(err.code, 400);

                              // Invalid signature
                              RestAPI.Authentication.shibbolethTenantCallback(
                                restContext,
                                {
                                  userId: 'u:foo:bar',
                                  signature: 'sign',
                                  expires: Date.now() + 10000
                                },
                                (err /* , body, response */) => {
                                  assert.strictEqual(err.code, 401);

                                  return done();
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        },
        callback
      );
    });

    /**
     * Test that verifies that the SP callback endpoint verifies the cookie hasn't been tampered with
     * and that it can't be called from regular tenants
     */
    it('verify the SP callback endpoint spoofing', callback => {
      _enableStrategy(
        'shibboleth',
        done => {
          // Initiate the Shibboleth auth flow
          _initiateShibbolethAuthFlow('/', (tenantRestContext, spRestContext) => {
            // The user returns from the Shibboleth IdP and arrives on our SP
            // but he somehow managed to fake his cookie and changes the tenant alias
            const fakeCookie = new Cookie({
              key: 'shibboleth',
              value: 's:camtest.fakedsignature'
            });
            spRestContext.cookieJar.setCookie(fakeCookie.toString(), 'http://localhost:2000/');
            const attributes = {};
            RestAPI.Authentication.shibbolethSPCallback(spRestContext, attributes, (
              err /* , body, response */
            ) => {
              assert.strictEqual(err.code, 400);

              // The SP callback endpoint should not be exposed on regular tenants
              RestAPI.Authentication.shibbolethSPCallback(tenantRestContext, {}, err => {
                assert.strictEqual(err.code, 501);
                return done();
              });
            });
          });
        },
        callback
      );
    });

    /**
     * Test that verifies that provisioned users can log in with Shibboleth
     */
    it('verify provisioned users can log in with Shibboleth', callback => {
      _enableStrategy('shibboleth', (/* done */) => {
        // Import users as a global admin using the Shibboleth authentication strategy
        PrincipalsTestUtil.importUsers(
          globalAdminRestContext,
          global.oaeTests.tenants.localhost.alias,
          getShibbolethCSVfile,
          'shibboleth',
          null,
          err => {
            assert.notExists(err);

            // Configure the attribute priority list so it tries an `employee-numer`
            const configUpdate = {};
            configUpdate['oae-authentication/shibboleth/externalIdAttributes'] =
              'irrelevant-attribute employee-number eppn persistent-id targeted-id';
            AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
              globalAdminRestContext,
              global.oaeTests.tenants.localhost.alias,
              configUpdate,
              () => {
                // Initiate the Shibboleth auth flow
                _initiateShibbolethAuthFlow('/content/bla', (tenantRestContext, spRestContext) => {
                  const attributes = {
                    // Fake a session ID to log in
                    'shib-session-id': Math.random(),

                    // Fake some data about the IdP
                    'persistent-id':
                      'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' +
                      Math.random(),
                    identityProvider: 'https://idp.example.com/shibboleth',

                    // Generate an external id
                    // eslint-disable-next-line camelcase
                    remote_user: 'viggo' + Math.random(),

                    // Pass along some attributes
                    displayname: 'Aron Viggo with some extra data',
                    eppn: 'aron+extra-bits@institution.edu',
                    locale: 'en_UK',

                    // Specify the same employee number as the one from the CSV file
                    'employee-number': 'em0005'
                  };

                  // Perform the callback part of the authentication flow
                  _callbackShibbolethAuthFlow(
                    tenantRestContext,
                    spRestContext,
                    attributes,
                    '/content/bla',
                    () => {
                      // Because the user was already created in the system,
                      // we should NOT have created a new account. We can verify
                      // this by checking if the user's profile is unchanged
                      RestAPI.User.getMe(tenantRestContext, (err, me) => {
                        assert.notExists(err);
                        assert.strictEqual(me.displayName, 'Aron Viggo');
                        assert.strictEqual(me.email, 'aron@institution.edu');
                        return callback();
                      });
                    }
                  );
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that the displayName field can be configured as a priority list
     */
    it('verify the displayName field can be configured as a priority list', callback => {
      _enableStrategy(
        'shibboleth',
        done => {
          // Verify the display name attribute with the highest priority is selected
          _initiateShibbolethAuthFlow('/content/bla', (tenantRestContext, spRestContext) => {
            const attributes = {
              'shib-session-id': _.random(100000),
              'persistent-id':
                'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' +
                Math.random(),
              identityProvider: 'https://idp.example.com/shibboleth',
              affiliation: 'Digital Services',
              unscopedAffiliation: 'OAE Team',
              // eslint-disable-next-line camelcase
              remote_user: 'simon' + _.random(100000),

              // Supply both `displayName` and `cn`. `displayName` has the highest priority
              displayname: 'Simon via displayname',
              cn: 'Simon via cn',
              email: TestsUtil.generateTestEmailAddress(),
              locale: 'en_UK'
            };
            _callbackShibbolethAuthFlow(
              tenantRestContext,
              spRestContext,
              attributes,
              '/content/bla',
              () => {
                RestAPI.User.getMe(tenantRestContext, (err, me) => {
                  assert.notExists(err);
                  assert.ok(!me.anon);
                  assert.strictEqual(me.authenticationStrategy, 'shibboleth');
                  assert.strictEqual(me.displayName, 'Simon via displayname');
                  assert.strictEqual(me.email, attributes.email.toLowerCase());
                  assert.strictEqual(me.locale, 'en_UK');

                  // Verify that lower priority attributes are used when highest priority
                  // atrribute is not present
                  _initiateShibbolethAuthFlow(
                    '/content/bla',
                    (tenantRestContext, spRestContext) => {
                      const attributes = {
                        'shib-session-id': _.random(100000),
                        'persistent-id':
                          'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' +
                          Math.random(),
                        identityProvider: 'https://idp.example.com/shibboleth',
                        affiliation: 'Digital Services',
                        unscopedAffiliation: 'OAE Team',
                        // eslint-disable-next-line camelcase
                        remote_user: 'nico' + _.random(100000),

                        // Supply `cn`, which has a lower priority than `displayName`.
                        // Because `displayName` is not provided, `cn` will be used
                        cn: 'Nico via cn',
                        email: TestsUtil.generateTestEmailAddress(),
                        locale: 'en_UK'
                      };
                      _callbackShibbolethAuthFlow(
                        tenantRestContext,
                        spRestContext,
                        attributes,
                        '/content/bla',
                        () => {
                          RestAPI.User.getMe(tenantRestContext, (err, me) => {
                            assert.notExists(err);
                            assert.ok(!me.anon);
                            assert.strictEqual(me.authenticationStrategy, 'shibboleth');
                            assert.strictEqual(me.displayName, 'Nico via cn');
                            assert.strictEqual(me.email, attributes.email.toLowerCase());
                            assert.strictEqual(me.locale, 'en_UK');
                            return done();
                          });
                        }
                      );
                    }
                  );
                });
              }
            );
          });
        },
        callback
      );
    });

    /**
     * Test that verifies that the email field can be configured as a priority list
     */
    it('verify the email field can be configured as a priority list', callback => {
      _enableStrategy(
        'shibboleth',
        done => {
          // Verify the email attribute with the highest priority is selected
          _initiateShibbolethAuthFlow('/content/bla', (tenantRestContext, spRestContext) => {
            const attributes = {
              'shib-session-id': _.random(100000),
              'persistent-id':
                'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' +
                Math.random(),
              identityProvider: 'https://idp.example.com/shibboleth',
              affiliation: 'Digital Services',
              unscopedAffiliation: 'OAE Team',
              // eslint-disable-next-line camelcase
              remote_user: 'simon' + _.random(100000),

              // Supply both `email` and `eppn`. `email` has the highest priority
              displayname: 'Simon',
              email: TestsUtil.generateTestEmailAddress(),
              eppn: TestsUtil.generateTestEmailAddress(),
              locale: 'en_UK'
            };
            _callbackShibbolethAuthFlow(
              tenantRestContext,
              spRestContext,
              attributes,
              '/content/bla',
              () => {
                RestAPI.User.getMe(tenantRestContext, (err, me) => {
                  assert.notExists(err);
                  assert.ok(!me.anon);
                  assert.strictEqual(me.authenticationStrategy, 'shibboleth');
                  assert.strictEqual(me.displayName, 'Simon');
                  assert.strictEqual(me.email, attributes.email.toLowerCase());
                  assert.strictEqual(me.locale, 'en_UK');

                  // Verify that lower priority attributes are used when highest priority
                  // atrribute is not present
                  _initiateShibbolethAuthFlow(
                    '/content/bla',
                    (tenantRestContext, spRestContext) => {
                      const attributes = {
                        'shib-session-id': _.random(100000),
                        'persistent-id':
                          'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' +
                          Math.random(),
                        identityProvider: 'https://idp.example.com/shibboleth',
                        affiliation: 'Digital Services',
                        unscopedAffiliation: 'OAE Team',
                        // eslint-disable-next-line camelcase
                        remote_user: 'simon' + _.random(100000),

                        // Supply `eppn`, which has a lower priority than `email`.
                        // Because `email` is not provided, `eppn` will be used
                        displayname: 'Simon',
                        eppn: TestsUtil.generateTestEmailAddress(),
                        locale: 'en_UK'
                      };
                      _callbackShibbolethAuthFlow(
                        tenantRestContext,
                        spRestContext,
                        attributes,
                        '/content/bla',
                        () => {
                          RestAPI.User.getMe(tenantRestContext, (err, me) => {
                            assert.notExists(err);
                            assert.ok(!me.anon);
                            assert.strictEqual(me.authenticationStrategy, 'shibboleth');
                            assert.strictEqual(me.displayName, 'Simon');
                            assert.strictEqual(me.email, attributes.eppn.toLowerCase());
                            assert.strictEqual(me.locale, 'en_UK');
                            return done();
                          });
                        }
                      );
                    }
                  );
                });
              }
            );
          });
        },
        callback
      );
    });

    /**
     * Test that verifies that the locale field can be configured as a priority list
     */
    it('verify the locale field can be configured as a priority list', callback => {
      _enableStrategy(
        'shibboleth',
        done => {
          // Verify the locale attribute with the highest priority is selected
          _initiateShibbolethAuthFlow('/content/bla', (tenantRestContext, spRestContext) => {
            const attributes = {
              'shib-session-id': _.random(100000),
              'persistent-id':
                'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' +
                Math.random(),
              identityProvider: 'https://idp.example.com/shibboleth',
              affiliation: 'Digital Services',
              unscopedAffiliation: 'OAE Team',
              // eslint-disable-next-line camelcase
              remote_user: 'simon' + _.random(100000),

              // Supply both `locality` and `locale`. `locality` has the highest priority
              displayname: 'Simon',
              email: TestsUtil.generateTestEmailAddress(),
              locality: 'en_UK',
              locale: 'nl_BE'
            };
            _callbackShibbolethAuthFlow(
              tenantRestContext,
              spRestContext,
              attributes,
              '/content/bla',
              () => {
                RestAPI.User.getMe(tenantRestContext, (err, me) => {
                  assert.notExists(err);
                  assert.ok(!me.anon);
                  assert.strictEqual(me.authenticationStrategy, 'shibboleth');
                  assert.strictEqual(me.displayName, 'Simon');
                  assert.strictEqual(me.email, attributes.email.toLowerCase());
                  assert.strictEqual(me.locale, attributes.locality);

                  // Verify that lower priority attributes are used when highest priority
                  // atrribute is not present
                  _initiateShibbolethAuthFlow(
                    '/content/bla',
                    (tenantRestContext, spRestContext) => {
                      const attributes = {
                        'shib-session-id': _.random(100000),
                        'persistent-id':
                          'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' +
                          Math.random(),
                        identityProvider: 'https://idp.example.com/shibboleth',
                        affiliation: 'Digital Services',
                        unscopedAffiliation: 'OAE Team',
                        // eslint-disable-next-line camelcase
                        remote_user: 'simon' + _.random(100000),

                        // Supply `locale`, which has a lower priority than `locality`.
                        // Because `locality` is not provided, `locale` will be used
                        displayname: 'Simon',
                        eppn: TestsUtil.generateTestEmailAddress(),
                        locale: 'en_UK'
                      };
                      _callbackShibbolethAuthFlow(
                        tenantRestContext,
                        spRestContext,
                        attributes,
                        '/content/bla',
                        () => {
                          RestAPI.User.getMe(tenantRestContext, (err, me) => {
                            assert.notExists(err);
                            assert.ok(!me.anon);
                            assert.strictEqual(me.authenticationStrategy, 'shibboleth');
                            assert.strictEqual(me.displayName, 'Simon');
                            assert.strictEqual(me.email, attributes.eppn.toLowerCase());
                            assert.strictEqual(me.locale, attributes.locale);
                            return done();
                          });
                        }
                      );
                    }
                  );
                });
              }
            );
          });
        },
        callback
      );
    });

    /**
     * Test that verifies that an invalid locale attribute is not used as a user's locale
     */
    it("verify an invalid locale attribute is not used as a user's locale", callback => {
      _enableStrategy(
        'shibboleth',
        done => {
          _initiateShibbolethAuthFlow('/content/bla', (tenantRestContext, spRestContext) => {
            const attributes = {
              'shib-session-id': _.random(10000),
              'persistent-id':
                'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' +
                Math.random(),
              identityProvider: 'https://idp.example.com/shibboleth',
              affiliation: 'Digital Services',
              unscopedAffiliation: 'OAE Team',
              // eslint-disable-next-line camelcase
              remote_user: 'simon' + _.random(10000),

              // Use an invalid locale. This should not be stored against the user
              displayname: 'Simon',
              email: TestsUtil.generateTestEmailAddress(),
              locale: 'Ohmygosh, I am like, totally, too_COOL'
            };
            _callbackShibbolethAuthFlow(
              tenantRestContext,
              spRestContext,
              attributes,
              '/content/bla',
              () => {
                RestAPI.User.getMe(tenantRestContext, (err, me) => {
                  assert.notExists(err);
                  assert.ok(!me.anon);
                  assert.strictEqual(me.authenticationStrategy, 'shibboleth');
                  assert.strictEqual(me.displayName, 'Simon');
                  assert.strictEqual(me.email, attributes.email.toLowerCase());
                  assert.notStrictEqual(me.locale, attributes.locale);

                  // Verify the user's locale defaulted to the tenant's default locale
                  RestAPI.Config.getTenantConfig(tenantRestContext, null, (err, config) => {
                    assert.notExists(err);
                    assert.strictEqual(me.locale, config['oae-principals'].user.defaultLanguage);
                    return done();
                  });
                });
              }
            );
          });
        },
        callback
      );
    });

    /**
     * Test that verifies that accounts with an invalid email address can still be created
     */
    it('verify accounts with an invalid email address get created', callback => {
      _enableStrategy('shibboleth', (/* done */) => {
        _initiateShibbolethAuthFlow('/content/bla', (tenantRestContext, spRestContext) => {
          const attributes = {
            'shib-session-id': _.random(10000),
            'persistent-id':
              'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' +
              Math.random(),
            identityProvider: 'https://idp.example.com/shibboleth',
            affiliation: 'Digital Services',
            unscopedAffiliation: 'OAE Team',
            // eslint-disable-next-line camelcase
            remote_user: 'simon' + _.random(10000),

            // Use an invalid email. This should not be stored against the user
            displayname: 'Simon',
            email: 'not a valid email address'
          };
          _callbackShibbolethAuthFlow(
            tenantRestContext,
            spRestContext,
            attributes,
            '/content/bla',
            () => {
              RestAPI.User.getMe(tenantRestContext, (err, me) => {
                assert.notExists(err);
                assert.ok(!me.anon);
                assert.strictEqual(me.authenticationStrategy, 'shibboleth');
                assert.strictEqual(me.displayName, 'Simon');
                assert.ok(!me.email);
                return callback();
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies that accounts with an email address that does not match the tenant
     * configured email domain can be created
     */
    it('verify accounts with an email address that does not match the tenant configured email domain can be created', callback => {
      _enableStrategy(
        'shibboleth',
        done => {
          // Configure an email domain
          const emailDomain = TenantsTestUtil.generateTestTenantHost();
          TenantsTestUtil.updateTenantAndWait(
            globalAdminRestContext,
            global.oaeTests.tenants.localhost.alias,
            { emailDomains: emailDomain },
            err => {
              assert.notExists(err);

              // Log in through Shibboleth with an email address that definitely does not
              // belong to the tenant's configured email domain
              const otherEmailDomain = TenantsTestUtil.generateTestTenantHost();
              assert.notStrictEqual(emailDomain, otherEmailDomain);
              const email = TestsUtil.generateTestEmailAddress(null, otherEmailDomain);

              _initiateShibbolethAuthFlow('/content/bla', (tenantRestContext, spRestContext) => {
                const attributes = {
                  'shib-session-id': _.random(10000),
                  'persistent-id':
                    'https://idp.example.com/shibboleth#https://sp.example.com/shibboleth#' +
                    Math.random(),
                  identityProvider: 'https://idp.example.com/shibboleth',
                  affiliation: 'Digital Services',
                  unscopedAffiliation: 'OAE Team',
                  // eslint-disable-next-line camelcase
                  remote_user: 'simon' + _.random(10000),
                  displayname: 'Simon',
                  email
                };
                _callbackShibbolethAuthFlow(
                  tenantRestContext,
                  spRestContext,
                  attributes,
                  '/content/bla',
                  () => {
                    RestAPI.User.getMe(tenantRestContext, (err, me) => {
                      assert.notExists(err);
                      assert.ok(!me.anon);
                      assert.strictEqual(me.authenticationStrategy, 'shibboleth');
                      assert.strictEqual(me.displayName, 'Simon');
                      assert.strictEqual(me.email, attributes.email.toLowerCase());

                      return done();
                    });
                  }
                );
              });
            }
          );
        },
        callback
      );
    });
  });

  describe('Google authentication', () => {
    /**
     * Configure a set of allowed domains with the `localhost` tenant's google authentication
     *
     * @param  {String}         domains     The comma-separated list of allowed domains
     * @param  {Function}       callback    Standard callback function
     */
    const _setGoogleDomains = function(domains, callback) {
      const config = {
        'oae-authentication/google/domains': domains
      };
      return AuthenticationTestUtil.assertUpdateAuthConfigSucceeds(
        globalAdminRestContext,
        global.oaeTests.tenants.localhost.alias,
        config,
        callback
      );
    };

    /**
     * Test that verifies that authentication can be scoped to a set of domains
     */
    it('verify authentication can be scoped to a set of domains', callback => {
      _enableStrategy(
        'google',
        done => {
          // Try with no domains
          _setGoogleDomains('', () => {
            AuthenticationTestUtil.assertGoogleLoginSucceeds(
              global.oaeTests.tenants.localhost.host,
              'simon@foo.com',
              () => {
                AuthenticationTestUtil.assertGoogleLoginSucceeds(
                  global.oaeTests.tenants.localhost.host,
                  'simon@bar.com',
                  () => {
                    AuthenticationTestUtil.assertGoogleLoginSucceeds(
                      global.oaeTests.tenants.localhost.host,
                      'simon@baz.com',
                      () => {
                        // Try with a single domain
                        _setGoogleDomains('foo.com', () => {
                          AuthenticationTestUtil.assertGoogleLoginSucceeds(
                            global.oaeTests.tenants.localhost.host,
                            'simon@foo.com',
                            () => {
                              AuthenticationTestUtil.assertGoogleLoginFails(
                                global.oaeTests.tenants.localhost.host,
                                'simon@bar.com',
                                'domain_not_allowed',
                                () => {
                                  AuthenticationTestUtil.assertGoogleLoginFails(
                                    global.oaeTests.tenants.localhost.host,
                                    'simon@baz.com',
                                    'domain_not_allowed',
                                    () => {
                                      // Try with multiple domains
                                      _setGoogleDomains('foo.com,bar.com', () => {
                                        AuthenticationTestUtil.assertGoogleLoginSucceeds(
                                          global.oaeTests.tenants.localhost.host,
                                          'simon@foo.com',
                                          () => {
                                            AuthenticationTestUtil.assertGoogleLoginSucceeds(
                                              global.oaeTests.tenants.localhost.host,
                                              'simon@bar.com',
                                              () => {
                                                AuthenticationTestUtil.assertGoogleLoginFails(
                                                  global.oaeTests.tenants.localhost.host,
                                                  'simon@baz.com',
                                                  'domain_not_allowed',
                                                  () => {
                                                    // Try with multiple domains, trailing spaces and mixed capitals
                                                    _setGoogleDomains('foo.com, BAR.com', () => {
                                                      AuthenticationTestUtil.assertGoogleLoginSucceeds(
                                                        global.oaeTests.tenants.localhost.host,
                                                        'simon@foo.com',
                                                        () => {
                                                          AuthenticationTestUtil.assertGoogleLoginSucceeds(
                                                            global.oaeTests.tenants.localhost.host,
                                                            'simon@bar.com',
                                                            () => {
                                                              AuthenticationTestUtil.assertGoogleLoginFails(
                                                                global.oaeTests.tenants.localhost
                                                                  .host,
                                                                'simon@baz.com',
                                                                'domain_not_allowed',
                                                                () => {
                                                                  return done();
                                                                }
                                                              );
                                                            }
                                                          );
                                                        }
                                                      );
                                                    });
                                                  }
                                                );
                                              }
                                            );
                                          }
                                        );
                                      });
                                    }
                                  );
                                }
                              );
                            }
                          );
                        });
                      }
                    );
                  }
                );
              }
            );
          });
        },
        callback
      );
    });
  });
});
