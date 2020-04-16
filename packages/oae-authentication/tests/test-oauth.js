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
import OAuth from 'oauth';

import * as ConfigTestUtil from 'oae-config/lib/test/util';
import * as RestAPI from 'oae-rest';
import { RestContext } from 'oae-rest/lib/model';
import * as TestsUtil from 'oae-tests';

const PUBLIC = 'public';

describe('Authentication', () => {
  // Rest context that can be used for anonymous requests on the localhost tenant
  let anonymousLocalRestContext = null;
  // Rest context that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;
  let localAdminRestContext = null;
  let globalAdminRestContext = null;

  /**
   * Function that will fill up the tenant admin and anymous rest context
   */
  before(callback => {
    // Fill up cam admin rest context
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    // Fill up global admin rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    // Fill up anonymous localhost cam rest context
    anonymousLocalRestContext = TestsUtil.createTenantRestContext(
      global.oaeTests.tenants.localhost.host
    );
    // Fill up localhost tenant admin rest context
    RestAPI.Admin.loginOnTenant(globalAdminRestContext, 'localhost', null, (err, restContext) => {
      assert.ok(!err);
      localAdminRestContext = restContext;
      return callback();
    });
  });

  describe('OAuth', () => {
    /**
     * Creates a user, gives him an OAuth client, retrieves an access token and sets the user up with an OAuth RestContext
     *
     * @param  {Function}           callback                        Standard callback function
     * @param  {Object}             callback.user                   Standard test user object as returned by `TestsUtil.generateTestUsers` plus an extra rest context that is authenticated via OAuth
     * @param  {RestContext}        callback.user.oauthRestContext  Standard REST Context object that contains the `localhost` tenant URL and is authenticated via the OAuth strategy
     * @param  {Client}             callback.client                 The created OAuth client
     * @param  {String}             callback.accessToken            An accessToken that was generated via the "Client Credentials Grant"
     * @throws {AssertionError}                                     Thrown when there is an error setting up OAuth
     */
    const _setupOAuth = function(callback) {
      TestsUtil.generateTestUsers(localAdminRestContext, 1, (err, users, simong) => {
        assert.ok(!err);

        // Give simong an OAuth client
        const clientDisplayName = TestsUtil.generateRandomText(1);
        RestAPI.OAuth.createClient(
          localAdminRestContext,
          simong.user.id,
          clientDisplayName,
          (err, client) => {
            assert.ok(!err);
            assert.strictEqual(client.displayName, clientDisplayName);

            // Setup an OAuth instance with which we can make oauth authenticated http calls
            const oauth = new OAuth.OAuth2(
              client.id,
              client.secret,
              'http://' + global.oaeTests.tenants.localhost.host,
              null,
              '/api/auth/oauth/v2/token',
              null
            );
            oauth.getOAuthAccessToken(
              '',

              // eslint-disable-next-line camelcase
              { grant_type: 'client_credentials' },
              (err, accessToken, refreshToken, results) => {
                assert.ok(!err);

                // Assert we retrieved an access token
                assert.ok(accessToken);

                // Assert we're not doing token expiration just yet
                assert.ok(!refreshToken);

                // Ensure we're outputting OAuth compliant data
                assert.ok(results.access_token);
                assert.strictEqual(results.access_token, accessToken);

                // Generate a rest context that authenticates simong via OAuth
                simong.oauthRestContext = _generateOAuthRestContext(
                  global.oaeTests.tenants.localhost.host,
                  accessToken
                );

                return callback(simong, client, accessToken);
              }
            );
          }
        );
      });
    };

    /**
     * Generate a RestContext wherein a user is authenticated by an access token.
     *
     * @param  {String}         host            The host for which the RestContext will be used
     * @param  {String}         accessToken     The OAuth access token that is unique to this user
     * @return {RestContext}                    The RestContext that can be used to make API calls authenticated as a user
     */
    const _generateOAuthRestContext = function(host, accessToken) {
      return new RestContext('http://' + host, {
        hostHeader: host,
        cookieJar: {},
        additionalHeaders: {
          Authorization: 'Bearer ' + accessToken
        }
      });
    };

    describe('Authentication', () => {
      /**
       * Test that verifies that a valid access token needs to be passed in
       */
      it('verify access token check', callback => {
        const oauthRestContext = _generateOAuthRestContext(
          global.oaeTests.tenants.localhost.host,
          'InvalidAccessToken'
        );
        RestAPI.User.getMe(oauthRestContext, (err, data) => {
          assert.strictEqual(err.code, 401);

          return callback();
        });
      });

      /**
       * Test that verifies a tenant admin retains his status when authenticated via OAuth
       */
      it('verify tenant admin privileges can be used when using OAuth', callback => {
        _setupOAuth((simong, client, accessToken) => {
          // Make Simon a tenant administrator
          RestAPI.User.setTenantAdmin(globalAdminRestContext, simong.user.id, true, err => {
            assert.ok(!err);

            // Assert that we're acting as a tenant admin
            RestAPI.User.getMe(simong.oauthRestContext, (err, data) => {
              assert.ok(!err);
              assert.ok(data);
              assert.ok(data.isTenantAdmin);
              assert.strictEqual(data.authenticationStrategy, 'oauth');

              // Assert that we can do tenant admin things (such as change a config value)
              ConfigTestUtil.updateConfigAndWait(
                simong.oauthRestContext,
                null,
                { 'oae-authentication/shibboleth/enabled': true },
                err => {
                  assert.ok(!err);

                  // Sanity check that the config has been updated
                  RestAPI.Config.getTenantConfig(localAdminRestContext, null, (err, config) => {
                    assert.ok(!err);
                    assert.strictEqual(config['oae-authentication'].shibboleth.enabled, true);

                    return callback();
                  });
                }
              );
            });
          });
        });
      });
    });

    describe('Client Credentials Grant', () => {
      /**
       * Test that verifies the client credentials grant
       */
      it('verify grant flow', callback => {
        _setupOAuth((simong, client, accessToken) => {
          // Assert that we're authenticated over OAuth
          RestAPI.User.getMe(simong.oauthRestContext, (err, data) => {
            assert.ok(!err);
            assert.strictEqual(data.id, simong.user.id);
            assert.strictEqual(data.displayName, simong.user.displayName);
            assert.strictEqual(data.authenticationStrategy, 'oauth');

            // Assert that the CSRF middleware isn't blocking us
            simong.oauthRestContext.refererHeader = 'http://my.app.com';
            RestAPI.Content.createLink(
              simong.oauthRestContext,
              {
                displayName: 'Google',
                description: 'Google',
                visibility: PUBLIC,
                link: 'http://www.google.com',
                managers: [],
                viewers: [],
                folders: []
              },
              (err, link) => {
                assert.ok(!err);

                // Sanity check the piece of content has actually beenc reated
                RestAPI.Content.getLibrary(
                  simong.oauthRestContext,
                  simong.user.id,
                  null,
                  null,
                  (err, data) => {
                    assert.ok(!err);
                    assert.strictEqual(data.results.length, 1);
                    assert.strictEqual(data.results[0].id, link.id);
                    return callback();
                  }
                );
              }
            );
          });
        });
      });

      /**
       * Test that verifies we don't hand out new access tokens every single time
       */
      it('verify the same access token gets issued when requesting an access token', callback => {
        _setupOAuth((simong, client, firstAccessToken) => {
          // When we request a new access token it should be the same as the first one
          const oauth = new OAuth.OAuth2(
            client.id,
            client.secret,
            'http://' + global.oaeTests.tenants.localhost.host,
            null,
            '/api/auth/oauth/v2/token',
            null
          );
          oauth.getOAuthAccessToken(
            '',
            // eslint-disable-next-line camelcase
            { grant_type: 'client_credentials' },
            (err, newAccessToken, refreshToken, results) => {
              assert.ok(!err);

              // Assert we retrieved an access token
              assert.ok(newAccessToken);

              // Assert that it's the same as the original one
              assert.strictEqual(firstAccessToken, newAccessToken);

              return callback();
            }
          );
        });
      });

      /**
       * Test that verifies you need both the client id and secret to get an access token
       */
      it('verify the client credentials are verified when requesting an access token', callback => {
        TestsUtil.generateTestUsers(localAdminRestContext, 1, (err, users, simong) => {
          assert.ok(!err);

          // Assert that using a random Client ID/Secret combination is not sufficient
          let oauth = new OAuth.OAuth2(
            'Fake ID',
            'Fake secret',
            'http://' + global.oaeTests.tenants.localhost.host,
            null,
            '/api/auth/oauth/v2/token',
            null
          );
          oauth.getOAuthAccessToken(
            '',
            // eslint-disable-next-line camelcase
            { grant_type: 'client_credentials' },
            (err, accessToken, refreshToken, results) => {
              assert.strictEqual(err.statusCode, 401);
              assert.ok(!accessToken);

              const clientDisplayName = TestsUtil.generateRandomText(1);
              RestAPI.OAuth.createClient(
                localAdminRestContext,
                simong.user.id,
                clientDisplayName,
                (err, client) => {
                  assert.ok(!err);
                  assert.ok(!accessToken);

                  // Assert that just the ID is not sufficient
                  oauth = new OAuth.OAuth2(
                    client.id,
                    'Fake secret',
                    'http://' + global.oaeTests.tenants.localhost.host,
                    null,
                    '/api/auth/oauth/v2/token',
                    null
                  );
                  oauth.getOAuthAccessToken(
                    '',
                    // eslint-disable-next-line camelcase
                    { grant_type: 'client_credentials' },
                    (err, accessToken, refreshToken, results) => {
                      assert.strictEqual(err.statusCode, 401);
                      assert.ok(!accessToken);

                      // Assert that just the secret is not sufficient
                      oauth = new OAuth.OAuth2(
                        'Fake ID',
                        client.secret,
                        'http://' + global.oaeTests.tenants.localhost.host,
                        null,
                        '/api/auth/oauth/v2/token',
                        null
                      );
                      oauth.getOAuthAccessToken(
                        '',
                        // eslint-disable-next-line camelcase
                        { grant_type: 'client_credentials' },
                        (err, accessToken, refreshToken, results) => {
                          assert.strictEqual(err.statusCode, 401);
                          assert.ok(!accessToken);

                          return callback();
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
    });

    describe('Clients', () => {
      describe('#createClient()', () => {
        /**
         * Test that verifies the parameters are validated when creating a client
         */
        it('verify validation', callback => {
          TestsUtil.generateTestUsers(localAdminRestContext, 1, (err, users, simong) => {
            assert.ok(!err);

            // Invalid userId
            RestAPI.OAuth.createClient(
              localAdminRestContext,
              'invalid user',
              'By admin',
              (err, client) => {
                assert.strictEqual(err.code, 400);

                // Missing displayName
                RestAPI.OAuth.createClient(
                  localAdminRestContext,
                  simong.user.id,
                  null,
                  (err, client) => {
                    assert.strictEqual(err.code, 400);

                    // Sanity check
                    RestAPI.OAuth.createClient(
                      localAdminRestContext,
                      simong.user.id,
                      'Test app',
                      (err, client) => {
                        assert.ok(!err);

                        return callback();
                      }
                    );
                  }
                );
              }
            );
          });
        });

        /**
         * Test that verifies that only global or tenant admins can create OAuth clients
         */
        it('verify authorization', callback => {
          TestsUtil.generateTestUsers(localAdminRestContext, 2, (err, users, simong, nico) => {
            assert.ok(!err);

            // Assert that anonymous users can't create clients
            RestAPI.OAuth.createClient(
              anonymousLocalRestContext,
              simong.user.id,
              'By anon',
              (err, client) => {
                assert.strictEqual(err.code, 401);
                assert.ok(!client);

                // Assert that non-admins cannot create clients
                RestAPI.OAuth.createClient(
                  simong.restContext,
                  simong.user.id,
                  'By simong',
                  (err, client) => {
                    assert.strictEqual(err.code, 401);
                    assert.ok(!client);

                    // Make Nico a tenant admin on the `localhost` tenant
                    // We can't use the localAdminRestContext as that is really the global admin on the localhost tenant
                    RestAPI.User.setTenantAdmin(globalAdminRestContext, nico.user.id, true, err => {
                      assert.ok(!err);

                      // As Nico is not a tenant on the `camtest` tenant we cannot create an OAuth application for that user
                      RestAPI.OAuth.createClient(
                        nico.restContext,
                        'u:camtest:foo',
                        'By admin',
                        (err, client) => {
                          assert.strictEqual(err.code, 401);

                          // Assert that tenant admins can create a client
                          RestAPI.OAuth.createClient(
                            localAdminRestContext,
                            simong.user.id,
                            'By admin',
                            (err, client) => {
                              assert.ok(!err);
                              assert.ok(client);

                              // Sanity check the client was associated with simong
                              RestAPI.OAuth.getClients(
                                simong.restContext,
                                simong.user.id,
                                (err, data) => {
                                  assert.ok(!err);
                                  assert.strictEqual(data.results.length, 1);
                                  assert.strictEqual(data.results[0].displayName, 'By admin');

                                  return callback();
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
          });
        });
      });

      describe('#getClients()', () => {
        /**
         * Test that verifies the parameters are validated when retrieving a user's clients
         */
        it('verify validation', callback => {
          _setupOAuth((simong, client, accessToken) => {
            // Invalid user id
            RestAPI.OAuth.getClients(simong.restContext, 'not a user id', (err, data) => {
              assert.strictEqual(err.code, 400);

              // Sanity check
              RestAPI.OAuth.getClients(simong.restContext, simong.user.id, (err, data) => {
                assert.ok(!err);
                assert.strictEqual(data.results.length, 1);
                assert.strictEqual(data.results[0].id, client.id);
                assert.strictEqual(data.results[0].displayName, client.displayName);
                assert.strictEqual(data.results[0].secret, client.secret);

                return callback();
              });
            });
          });
        });

        /**
         * Test that verifies that regular users can only view their own clients and tenant admins can view all clients
         * created by users on their tenant
         */
        it('verify authorization', callback => {
          _setupOAuth((simong, client, accessToken) => {
            TestsUtil.generateTestUsers(localAdminRestContext, 1, (err, users, nico) => {
              assert.ok(!err);

              // Verify you cannot get another user their clients
              RestAPI.OAuth.getClients(simong.restContext, nico.user.id, (err, data) => {
                assert.strictEqual(err.code, 401);

                // Verify that a tenant admin cannot get the clients for a user that is not from his tenant
                RestAPI.OAuth.getClients(camAdminRestContext, nico.user.id, (err, data) => {
                  assert.strictEqual(err.code, 401);

                  // Sanity checks
                  // Verify a user can fetch his own clients
                  RestAPI.OAuth.getClients(simong.restContext, simong.user.id, (err, data) => {
                    assert.ok(!err);
                    assert.strictEqual(data.results.length, 1);
                    assert.strictEqual(data.results[0].id, client.id);
                    assert.strictEqual(data.results[0].displayName, client.displayName);
                    assert.strictEqual(data.results[0].secret, client.secret);

                    // Verify a tenant admin can fetch the clients of a user on his tenant
                    RestAPI.OAuth.getClients(localAdminRestContext, simong.user.id, (err, data) => {
                      assert.ok(!err);
                      assert.strictEqual(data.results.length, 1);
                      assert.strictEqual(data.results[0].id, client.id);
                      assert.strictEqual(data.results[0].displayName, client.displayName);
                      assert.strictEqual(data.results[0].secret, client.secret);

                      return callback();
                    });
                  });
                });
              });
            });
          });
        });
      });

      describe('#updateClient()', () => {
        /**
         * Test that verifies the parameters when updating an OAuth client
         */
        it('verify validation', callback => {
          _setupOAuth((simong, client, accessToken) => {
            // Try updating an unknown client
            RestAPI.OAuth.updateClient(
              simong.restContext,
              simong.user.id,
              'unknown client id',
              'name 1',
              'secret 1',
              (err, updateClient) => {
                assert.strictEqual(err.code, 404);

                // Assert that both the display name and secret need to be specified
                RestAPI.OAuth.updateClient(
                  simong.restContext,
                  simong.user.id,
                  client.id,
                  null,
                  null,
                  (err, updateClient) => {
                    assert.strictEqual(err.code, 400);
                    assert.ok(!updateClient);

                    // Sanity check that nothing has changed
                    RestAPI.OAuth.getClients(localAdminRestContext, simong.user.id, (err, data) => {
                      assert.ok(!err);
                      assert.strictEqual(data.results.length, 1);
                      assert.strictEqual(data.results[0].id, client.id);
                      assert.strictEqual(data.results[0].displayName, client.displayName);
                      assert.strictEqual(data.results[0].secret, client.secret);

                      return callback();
                    });
                  }
                );
              }
            );
          });
        });

        /**
         * Test that verifies that regular users can only update their own clients and tenant admins can only
         * update clients from users that originate on their tenant
         */
        it('verify authorization', callback => {
          _setupOAuth((simong, client, accessToken) => {
            TestsUtil.generateTestUsers(localAdminRestContext, 1, (err, users, nico) => {
              assert.ok(!err);

              // Verify an anonymous user cannot update a client
              RestAPI.OAuth.updateClient(
                anonymousLocalRestContext,
                simong.user.id,
                client.id,
                'New name',
                'secret',
                (err, updateClient) => {
                  assert.strictEqual(err.code, 401);
                  assert.ok(!updateClient);

                  // Verify you cannot update another user their client
                  RestAPI.OAuth.updateClient(
                    nico.restContext,
                    simong.user.id,
                    client.id,
                    'New name',
                    'secret',
                    (err, updateClient) => {
                      assert.strictEqual(err.code, 401);
                      assert.ok(!updateClient);

                      // Verify that a tenant admin cannot update a client for a user that is not from his tenant
                      RestAPI.OAuth.updateClient(
                        camAdminRestContext,
                        simong.user.id,
                        client.id,
                        'New name',
                        'secret',
                        (err, updateClient) => {
                          assert.strictEqual(err.code, 401);
                          assert.ok(!updateClient);

                          // Sanity check the client hasn't been updated
                          RestAPI.OAuth.getClients(
                            localAdminRestContext,
                            simong.user.id,
                            (err, data) => {
                              assert.ok(!err);
                              assert.strictEqual(data.results.length, 1);
                              assert.strictEqual(data.results[0].id, client.id);
                              assert.strictEqual(data.results[0].displayName, client.displayName);
                              assert.strictEqual(data.results[0].secret, client.secret);

                              // Update the client
                              RestAPI.OAuth.updateClient(
                                simong.restContext,
                                simong.user.id,
                                client.id,
                                'New name by user',
                                'New secret by user',
                                (err, updateClient) => {
                                  assert.ok(!err);
                                  assert.strictEqual(updateClient.id, client.id);
                                  assert.strictEqual(updateClient.displayName, 'New name by user');
                                  assert.strictEqual(updateClient.secret, 'New secret by user');

                                  // Verify that it's been updated
                                  RestAPI.OAuth.getClients(
                                    simong.restContext,
                                    simong.user.id,
                                    (err, data) => {
                                      assert.ok(!err);
                                      assert.strictEqual(data.results.length, 1);
                                      assert.strictEqual(data.results[0].id, client.id);
                                      assert.strictEqual(
                                        data.results[0].displayName,
                                        'New name by user'
                                      );
                                      assert.strictEqual(
                                        data.results[0].secret,
                                        'New secret by user'
                                      );

                                      // Verify that a tenant admin can update a client for a user local to his tenant
                                      RestAPI.OAuth.updateClient(
                                        localAdminRestContext,
                                        simong.user.id,
                                        client.id,
                                        'New name by admin',
                                        'New secret by admin',
                                        (err, updateClient) => {
                                          assert.ok(!err);
                                          assert.strictEqual(updateClient.id, client.id);
                                          assert.strictEqual(
                                            updateClient.displayName,
                                            'New name by admin'
                                          );
                                          assert.strictEqual(
                                            updateClient.secret,
                                            'New secret by admin'
                                          );

                                          // Verify that it's been updated
                                          RestAPI.OAuth.getClients(
                                            simong.restContext,
                                            simong.user.id,
                                            (err, data) => {
                                              assert.ok(!err);
                                              assert.strictEqual(data.results.length, 1);
                                              assert.strictEqual(data.results[0].id, client.id);
                                              assert.strictEqual(
                                                data.results[0].displayName,
                                                'New name by admin'
                                              );
                                              assert.strictEqual(
                                                data.results[0].secret,
                                                'New secret by admin'
                                              );

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
                }
              );
            });
          });
        });
      });

      describe('#deleteClient()', () => {
        /**
         * Test that verifies the parameters when deleting an OAuth client
         */
        it('verify validation', callback => {
          _setupOAuth((simong, client, accessToken) => {
            // Try deleting an unknown client
            RestAPI.OAuth.deleteClient(
              simong.restContext,
              simong.user.id,
              'unknown client id',
              (err, data) => {
                assert.strictEqual(err.code, 404);

                return callback();
              }
            );
          });
        });

        /**
         * Test that verifies that regular users can only delete their own clients and tenant admins can only
         * delete clients from users that originate on their tenant
         */
        it('verify authorization', callback => {
          _setupOAuth((simong, client, accessToken) => {
            TestsUtil.generateTestUsers(localAdminRestContext, 1, (err, users, nico) => {
              assert.ok(!err);

              // Verify an anonymous user cannot delete a client
              RestAPI.OAuth.deleteClient(
                anonymousLocalRestContext,
                simong.user.id,
                client.id,
                (err, data) => {
                  assert.strictEqual(err.code, 401);

                  // Verify you cannot delete another user their client
                  RestAPI.OAuth.deleteClient(
                    nico.restContext,
                    simong.user.id,
                    client.id,
                    (err, data) => {
                      assert.strictEqual(err.code, 401);

                      // Verify that a tenant admin cannot delete a client for a user that is not from his tenant
                      RestAPI.OAuth.deleteClient(
                        camAdminRestContext,
                        simong.user.id,
                        client.id,
                        (err, data) => {
                          assert.strictEqual(err.code, 401);

                          // Sanity check the client is still there
                          RestAPI.OAuth.getClients(
                            localAdminRestContext,
                            simong.user.id,
                            (err, data) => {
                              assert.ok(!err);
                              assert.strictEqual(data.results.length, 1);
                              assert.strictEqual(data.results[0].id, client.id);
                              assert.strictEqual(data.results[0].displayName, client.displayName);
                              assert.strictEqual(data.results[0].secret, client.secret);

                              // Delete the client
                              RestAPI.OAuth.deleteClient(
                                simong.restContext,
                                simong.user.id,
                                client.id,
                                (err, data) => {
                                  assert.ok(!err);

                                  // Verify that it's been removed
                                  RestAPI.OAuth.getClients(
                                    simong.restContext,
                                    simong.user.id,
                                    (err, data) => {
                                      assert.ok(!err);
                                      assert.strictEqual(data.results.length, 0);

                                      // Create another client and try to delete it as the tenant admin
                                      const clientDisplayName = TestsUtil.generateRandomText(1);
                                      RestAPI.OAuth.createClient(
                                        localAdminRestContext,
                                        simong.user.id,
                                        clientDisplayName,
                                        (err, client) => {
                                          assert.ok(!err);
                                          assert.strictEqual(client.displayName, clientDisplayName);
                                          RestAPI.OAuth.deleteClient(
                                            localAdminRestContext,
                                            simong.user.id,
                                            client.id,
                                            (err, data) => {
                                              assert.ok(!err);

                                              // Verify that it's been removed
                                              RestAPI.OAuth.getClients(
                                                simong.restContext,
                                                simong.user.id,
                                                (err, data) => {
                                                  assert.ok(!err);
                                                  assert.strictEqual(data.results.length, 0);

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
                    }
                  );
                }
              );
            });
          });
        });
      });
    });
  });
});
