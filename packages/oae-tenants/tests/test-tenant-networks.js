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
import { describe, before, it } from 'mocha';

import { head, find, equals, propSatisfies } from 'ramda';
import * as Cassandra from 'oae-util/lib/cassandra';
import * as Pubsub from 'oae-util/lib/pubsub';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as TenantNetworksAPI from 'oae-tenants/lib/api.networks';
import * as TenantNetworksDAO from 'oae-tenants/lib/internal/dao.networks';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util';

describe('Tenant Networks', () => {
  // Standard REST contexts to use to execute requests as different types of users
  let anonymousCamRestContext = null;
  let anonymousGlobalRestContext = null;
  let camAdminRestContext = null;
  let globalAdminRestContext = null;

  /**
   * Function that will fill up the anonymous and the tenant admin context
   */
  before((callback) => {
    // Create the standard REST contexts
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    anonymousGlobalRestContext = TestsUtil.createGlobalRestContext();
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    callback();
  });

  /**
   * Test that verifies the correctness of the "get tenant networks" authorization
   */
  it('verify get tenant networks authorization', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
      assert.notExists(error);
      const { 0: mrvisser } = users;

      // Ensure accessing as anonymous user-tenant user results in a 404 (because the endpoint is not bound to the user tenant server)
      RestAPI.Tenants.getTenantNetworks(anonymousCamRestContext, (error, tenantNetwork) => {
        assert.ok(error);
        assert.strictEqual(error.code, 404);
        assert.ok(!tenantNetwork);

        // Ensure accessing as loggedin user-tenant user results in a 404 (because the endpoint is not bound to the user tenant server)
        RestAPI.Tenants.getTenantNetworks(mrvisser.restContext, (error, tenantNetwork) => {
          assert.ok(error);
          assert.strictEqual(error.code, 404);
          assert.ok(!tenantNetwork);

          // Ensure accessing as tenant administrator user results in a 404 (because the endpoint is not bound to the user tenant server)
          RestAPI.Tenants.getTenantNetworks(camAdminRestContext, (error, tenantNetwork) => {
            assert.ok(error);
            assert.strictEqual(error.code, 404);
            assert.ok(!tenantNetwork);

            // Ensure accessing as anonymous global-admin user results in a 401
            RestAPI.Tenants.getTenantNetworks(anonymousGlobalRestContext, (error, tenantNetwork) => {
              assert.ok(error);
              assert.strictEqual(error.code, 401);
              assert.ok(!tenantNetwork);

              // Sanity check that accessing as global admin user succeeds
              RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetwork) => {
                assert.notExists(error);
                assert.isObject(tenantNetwork);
                return callback();
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies getting all tenant workers, the associated tenants and their models in the response
   */
  it('verify get tenant networks fetches all tenant networks with associated tenants expanded into their full model', (callback) => {
    TenantsTestUtil.generateTestTenantNetworks(
      globalAdminRestContext,
      3,
      (tenantNetwork0, tenantNetwork1, tenantNetwork2) => {
        // Add a couple tenants to one of the test tenant networks
        RestAPI.Tenants.addTenantAliases(
          globalAdminRestContext,
          tenantNetwork0.id,
          [global.oaeTests.tenants.cam.alias, global.oaeTests.tenants.gt.alias],
          (error) => {
            assert.notExists(error);

            // Get all the tenant networks
            RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
              assert.notExists(error);

              // Ensure all tenant networks are present
              assert.ok(tenantNetworks[tenantNetwork0.id]);
              assert.ok(tenantNetworks[tenantNetwork1.id]);
              assert.ok(tenantNetworks[tenantNetwork2.id]);

              // Get the cam and gt tenant from the tenant networks response
              const camTenant = find(
                propSatisfies(equals(global.oaeTests.tenants.cam.alias), 'alias'),
                tenantNetworks[tenantNetwork0.id].tenants
              );
              const gtTenant = find(
                propSatisfies(equals(global.oaeTests.tenants.gt.alias), 'alias'),
                tenantNetworks[tenantNetwork0.id].tenants
              );

              // Ensure both tenants were in the response for the first tenant network
              assert.ok(camTenant);
              assert.ok(gtTenant);

              // Ensure the contents of each tenant model
              TenantsTestUtil.assertTenantsEqual(camTenant, global.oaeTests.tenants.cam);
              TenantsTestUtil.assertTenantsEqual(gtTenant, global.oaeTests.tenants.gt);

              // Ensure the other two tenants have an empty array for tenants
              assert.isArray(tenantNetworks[tenantNetwork1.id].tenants);
              assert.isEmpty(tenantNetworks[tenantNetwork1.id].tenants);
              assert.isArray(tenantNetworks[tenantNetwork2.id].tenants);
              assert.isEmpty(tenantNetworks[tenantNetwork2.id].tenants);

              return callback();
            });
          }
        );
      }
    );
  });

  /**
   * Test that verifies the request is properly validated when creating a tenant network
   */
  it('verify create tenant network validation', (callback) => {
    // Ensure a displayName is required when creating a tenant network
    RestAPI.Tenants.createTenantNetwork(globalAdminRestContext, null, (error, tenantNetwork) => {
      assert.ok(error);
      assert.strictEqual(error.code, 400);
      assert.ok(!tenantNetwork);

      // Ensure a displayName cannot be all whitespace when creating a tenant network
      RestAPI.Tenants.createTenantNetwork(globalAdminRestContext, '    ', (error, tenantNetwork) => {
        assert.ok(error);
        assert.strictEqual(error.code, 400);
        assert.ok(!tenantNetwork);

        // Sanity check creating a tenant network
        RestAPI.Tenants.createTenantNetwork(
          globalAdminRestContext,
          'verifies create tenant network validation',
          (error, tenantNetwork) => {
            assert.notExists(error);
            assert.strictEqual(tenantNetwork.displayName, 'verifies create tenant network validation');
            return callback();
          }
        );
      });
    });
  });

  /**
   * Test that verifies the request is properly authorized when creating a tenant network
   */
  it('verify create tenant network authorization', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
      assert.notExists(error);
      const { 0: mrvisser } = users;

      // Ensure creating as anonymous user-tenant user results in a 404 (because the endpoint is not bound to the user tenant server)
      RestAPI.Tenants.createTenantNetwork(
        anonymousCamRestContext,
        'verifies create tenant network authorization',
        (error, tenantNetwork) => {
          assert.ok(error);
          assert.strictEqual(error.code, 404);
          assert.ok(!tenantNetwork);

          // Ensure creating as loggedin user-tenant user results in a 404 (because the endpoint is not bound to the user tenant server)
          RestAPI.Tenants.createTenantNetwork(
            mrvisser.restContext,
            'verifies create tenant network authorization',
            (error, tenantNetwork) => {
              assert.ok(error);
              assert.strictEqual(error.code, 404);
              assert.ok(!tenantNetwork);

              // Ensure creating as tenant administrator user results in a 404 (because the endpoint is not bound to the user tenant server)
              RestAPI.Tenants.createTenantNetwork(
                camAdminRestContext,
                'verifies create tenant network authorization',
                (error, tenantNetwork) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 404);
                  assert.ok(!tenantNetwork);

                  // Ensure creating as anonymous global-admin user results in a 401
                  RestAPI.Tenants.createTenantNetwork(
                    anonymousGlobalRestContext,
                    'verifies create tenant network authorization',
                    (error, tenantNetwork) => {
                      assert.ok(error);
                      assert.strictEqual(error.code, 401);
                      assert.ok(!tenantNetwork);

                      // Sanity check that creating as global admin user succeeds
                      RestAPI.Tenants.createTenantNetwork(
                        globalAdminRestContext,
                        'verifies create tenant network authorization',
                        (error, tenantNetwork) => {
                          assert.notExists(error);
                          assert.isObject(tenantNetwork);
                          assert.strictEqual(tenantNetwork.displayName, 'verifies create tenant network authorization');
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
    });
  });

  /**
   * Test that verifies the request is properly validated when updating a tenant network
   */
  it('verify update tenant network validation', (callback) => {
    TenantsTestUtil.generateTestTenantNetworks(globalAdminRestContext, 1, (originalTenantNetwork) => {
      // Ensure a tenant network id is required when updating a tenant network (we test a 404 because the id is part of the resource path)
      RestAPI.Tenants.updateTenantNetwork(
        globalAdminRestContext,
        null,
        'verifies update tenant network validation',
        (error, tenantNetwork) => {
          assert.ok(error);
          assert.strictEqual(error.code, 404);
          assert.ok(!tenantNetwork);

          // Ensure a tenant network id is required when updating directly against the API
          TenantNetworksAPI.updateTenantNetwork(
            TestsUtil.createGlobalAdminContext(),
            null,
            'verifies update tenant network validation',
            (error, tenantNetwork) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);
              assert.ok(!tenantNetwork);

              // Ensure a tenant network id cannot be all whitespace when updating a tenant network
              RestAPI.Tenants.updateTenantNetwork(
                globalAdminRestContext,
                '   ',
                'verifies update tenant network validation',
                (error, tenantNetwork) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 400);
                  assert.ok(!tenantNetwork);

                  // Ensure updating a non-existing tenant network results in a 404
                  RestAPI.Tenants.updateTenantNetwork(
                    globalAdminRestContext,
                    'non-existing-tenant-network-id',
                    'verifies update tenant network validation',
                    (error, tenantNetwork) => {
                      assert.ok(error);
                      assert.strictEqual(error.code, 404);
                      assert.ok(!tenantNetwork);

                      // Ensure updating a tenant network without a displayName results in a 400
                      RestAPI.Tenants.updateTenantNetwork(
                        globalAdminRestContext,
                        originalTenantNetwork.id,
                        null,
                        (error, tenantNetwork) => {
                          assert.ok(error);
                          assert.strictEqual(error.code, 400);
                          assert.ok(!tenantNetwork);

                          // Ensure the tenant network displayName hasn't been updated somehow
                          RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                            assert.notExists(error);
                            assert.ok(tenantNetworks[originalTenantNetwork.id]);
                            assert.strictEqual(
                              tenantNetworks[originalTenantNetwork.id].displayName,
                              originalTenantNetwork.displayName
                            );

                            // Sanity check updating the tenant network's display name
                            RestAPI.Tenants.updateTenantNetwork(
                              globalAdminRestContext,
                              originalTenantNetwork.id,
                              'verifies update tenant network validation',
                              (error, tenantNetwork) => {
                                assert.notExists(error);
                                assert.ok(tenantNetwork);
                                assert.strictEqual(tenantNetwork.id, originalTenantNetwork.id);
                                assert.strictEqual(
                                  tenantNetwork.displayName,
                                  'verifies update tenant network validation'
                                );

                                // Ensure the displayName has changed when fetching
                                RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                                  assert.notExists(error);
                                  assert.ok(tenantNetworks[tenantNetwork.id]);
                                  assert.strictEqual(
                                    tenantNetworks[tenantNetwork.id].displayName,
                                    'verifies update tenant network validation'
                                  );

                                  return callback();
                                });
                              }
                            );
                          });
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

  /**
   * Test that verifies the request is properly authorized when updating a tenant network
   */
  it('verify update tenant network authorization', (callback) => {
    TenantsTestUtil.generateTestTenantNetworks(globalAdminRestContext, 1, (originalTenantNetwork) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        // Ensure updating as anonymous user-tenant user results in a 404 (because the endpoint is not bound to the user tenant server)
        RestAPI.Tenants.updateTenantNetwork(
          anonymousCamRestContext,
          originalTenantNetwork.id,
          'verifies update tenant network authorization',
          (error, tenantNetwork) => {
            assert.ok(error);
            assert.strictEqual(error.code, 404);
            assert.ok(!tenantNetwork);

            // Ensure updating as loggedin user-tenant user results in a 404 (because the endpoint is not bound to the user tenant server)
            RestAPI.Tenants.updateTenantNetwork(
              mrvisser.restContext,
              originalTenantNetwork.id,
              'verifies update tenant network authorization',
              (error, tenantNetwork) => {
                assert.ok(error);
                assert.strictEqual(error.code, 404);
                assert.ok(!tenantNetwork);

                // Ensure updating as tenant administrator user results in a 404 (because the endpoint is not bound to the user tenant server)
                RestAPI.Tenants.updateTenantNetwork(
                  camAdminRestContext,
                  originalTenantNetwork.id,
                  'verifies update tenant network authorization',
                  (error, tenantNetwork) => {
                    assert.ok(error);
                    assert.strictEqual(error.code, 404);
                    assert.ok(!tenantNetwork);

                    // Ensure updating as anonymous global-admin user results in a 401
                    RestAPI.Tenants.updateTenantNetwork(
                      anonymousGlobalRestContext,
                      originalTenantNetwork.id,
                      'verifies update tenant network authorization',
                      (error, tenantNetwork) => {
                        assert.ok(error);
                        assert.strictEqual(error.code, 401);
                        assert.ok(!tenantNetwork);

                        // Ensure the tenant network displayName has not changed
                        RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                          assert.notExists(error);
                          assert.ok(tenantNetworks);
                          assert.ok(tenantNetworks[originalTenantNetwork.id]);
                          assert.strictEqual(
                            tenantNetworks[originalTenantNetwork.id].displayName,
                            originalTenantNetwork.displayName
                          );

                          // Sanity check that updating as global admin user succeeds
                          RestAPI.Tenants.updateTenantNetwork(
                            globalAdminRestContext,
                            originalTenantNetwork.id,
                            'verifies update tenant network authorization',
                            (error, tenantNetwork) => {
                              assert.notExists(error);
                              assert.isObject(tenantNetwork);
                              assert.strictEqual(
                                tenantNetwork.displayName,
                                'verifies update tenant network authorization'
                              );
                              return callback();
                            }
                          );
                        });
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

  /**
   * Test that verifies the request is properly validated when deleting a tenant network
   */
  it('verify delete tenant network validation', (callback) => {
    TenantsTestUtil.generateTestTenantNetworks(globalAdminRestContext, 1, (originalTenantNetwork) => {
      // Ensure a tenant network id is required when deleting a tenant network (we test a 404 because the id is part of the resource path)
      RestAPI.Tenants.deleteTenantNetwork(globalAdminRestContext, null, (error) => {
        assert.ok(error);
        assert.ok(error.code, 404);

        // Ensure a tenant network id is required when deleting directly against the API
        TenantNetworksAPI.deleteTenantNetwork(TestsUtil.createGlobalAdminContext(), null, (error) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);

          // Ensure a tenant network id cannot be all whitespace when deleting a tenant network
          RestAPI.Tenants.deleteTenantNetwork(globalAdminRestContext, '   ', (error) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);

            // Ensure deleting a non-existing tenant network results in a 404
            RestAPI.Tenants.deleteTenantNetwork(globalAdminRestContext, 'non-existing-tenant-network-id', (error) => {
              assert.ok(error);
              assert.ok(error.code, 404);

              // Ensure the tenant network still exists
              RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                assert.notExists(error);
                assert.ok(tenantNetworks);
                assert.ok(tenantNetworks[originalTenantNetwork.id]);
                assert.strictEqual(
                  tenantNetworks[originalTenantNetwork.id].displayName,
                  originalTenantNetwork.displayName
                );

                // Sanity check a true tenant network delete
                RestAPI.Tenants.deleteTenantNetwork(globalAdminRestContext, originalTenantNetwork.id, (error_) => {
                  assert.notExists(error_);

                  // Ensure the tenant network no longer exists
                  RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                    assert.notExists(error);
                    assert.ok(tenantNetworks);
                    assert.ok(!tenantNetworks[originalTenantNetwork.id]);
                    return callback();
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies the request is properly authorized when deleting a tenant network
   */
  it('verify delete tenant network authorization', (callback) => {
    TenantsTestUtil.generateTestTenantNetworks(globalAdminRestContext, 1, (originalTenantNetwork) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        // Ensure deleting as anonymous user-tenant user results in a 404 (because the endpoint is not bound to the user tenant server)
        RestAPI.Tenants.deleteTenantNetwork(anonymousCamRestContext, originalTenantNetwork.id, (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, 404);

          // Ensure deleting as loggedin user-tenant user results in a 404 (because the endpoint is not bound to the user tenant server)
          RestAPI.Tenants.deleteTenantNetwork(mrvisser.restContext, originalTenantNetwork.id, (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 404);

            // Ensure deleting as tenant administrator user results in a 404 (because the endpoint is not bound to the user tenant server)
            RestAPI.Tenants.deleteTenantNetwork(camAdminRestContext, originalTenantNetwork.id, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 404);

              // Ensure deleting as anonymous global-admin user results in a 401
              RestAPI.Tenants.deleteTenantNetwork(anonymousGlobalRestContext, originalTenantNetwork.id, (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 401);

                // Ensure the tenant network is still there
                RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                  assert.notExists(error);
                  assert.ok(tenantNetworks);
                  assert.ok(tenantNetworks[originalTenantNetwork.id]);
                  assert.strictEqual(
                    tenantNetworks[originalTenantNetwork.id].displayName,
                    originalTenantNetwork.displayName
                  );

                  // Sanity check that deleting as global admin user succeeds
                  RestAPI.Tenants.deleteTenantNetwork(globalAdminRestContext, originalTenantNetwork.id, (error_) => {
                    assert.notExists(error_);

                    // Ensure the tenant network is gone
                    RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                      assert.notExists(error);
                      assert.ok(tenantNetworks);
                      assert.ok(!tenantNetworks[originalTenantNetwork.id]);
                      return callback();
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies deleting a tenant network cascade deletes its tenant associations index
   */
  it('verify delete tenant cascade deletes associated tenant aliases', (callback) => {
    TenantsTestUtil.generateTestTenantNetworks(globalAdminRestContext, 1, (tenantNetwork) => {
      // Add a tenant to the new network
      RestAPI.Tenants.addTenantAliases(
        globalAdminRestContext,
        tenantNetwork.id,
        [global.oaeTests.tenants.cam.alias],
        (error) => {
          assert.notExists(error);

          // Ensure we can get the tenant alias from Cassandra using the association
          Cassandra.runQuery(
            'SELECT "tenantAlias" FROM "TenantNetworkTenants" WHERE "tenantNetworkId" = ?',
            [tenantNetwork.id],
            (error, rows) => {
              assert.notExists(error);
              assert.strictEqual(rows[0].get('tenantAlias'), global.oaeTests.tenants.cam.alias);

              // Delete the tenant network
              RestAPI.Tenants.deleteTenantNetwork(globalAdminRestContext, tenantNetwork.id, (error_) => {
                assert.notExists(error_);

                // Ensure we no longer have the tenant alias associations in Cassandra
                Cassandra.runQuery(
                  'SELECT "tenantAlias" FROM "TenantNetworkTenants" WHERE "tenantNetworkId" = ?',
                  [tenantNetwork.id],
                  (error, rows) => {
                    assert.notExists(error);
                    assert.isEmpty(rows);
                    return callback();
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
   * Test that verifies the request is properly validated when adding tenant aliases to a tenant network
   */
  it('verify add tenant alias validation', (callback) => {
    TenantsTestUtil.generateTestTenantNetworks(globalAdminRestContext, 1, (tenantNetwork) => {
      // Ensure a tenant network id is required when adding a tenant to a tenant network (we test a 404 because the id is part of the resource path)
      RestAPI.Tenants.addTenantAliases(globalAdminRestContext, null, [global.oaeTests.tenants.cam.alias], (error) => {
        assert.ok(error);
        assert.ok(error.code, 404);

        // Ensure a tenant network id is required when adding a tenant to a tenant network directly against the API
        TenantNetworksAPI.addTenantAliases(
          TestsUtil.createGlobalAdminContext(),
          null,
          [global.oaeTests.tenants.cam.alias],
          (error) => {
            assert.ok(error);
            assert.strictEqual(error.code, 400);

            // Ensure a tenant network id cannot be all whitespace when adding a tenant to a tenant network
            RestAPI.Tenants.addTenantAliases(
              globalAdminRestContext,
              '   ',
              [global.oaeTests.tenants.cam.alias],
              (error) => {
                assert.ok(error);
                assert.strictEqual(error.code, 400);

                // Ensure adding tenants to a non-existing tenant network results in a 404
                RestAPI.Tenants.addTenantAliases(
                  globalAdminRestContext,
                  'non-existing-tenant-network-id',
                  [global.oaeTests.tenants.cam.alias],
                  (error) => {
                    assert.ok(error);
                    assert.ok(error.code, 404);

                    // Ensure a list of tenant aliases is required when adding tenants to a tenant network
                    RestAPI.Tenants.addTenantAliases(globalAdminRestContext, tenantNetwork.id, null, (error) => {
                      assert.ok(error);
                      assert.ok(error.code, 400);

                      // Ensure at least one tenant alias must be specified when adding tenants to a tenant network
                      RestAPI.Tenants.addTenantAliases(globalAdminRestContext, tenantNetwork.id, [], (error) => {
                        assert.ok(error);
                        assert.ok(error.code, 400);

                        // Ensure all tenants must exist when adding tenants to a tenant network
                        RestAPI.Tenants.addTenantAliases(
                          globalAdminRestContext,
                          tenantNetwork.id,
                          ['non-existing-tenant-alias', global.oaeTests.tenants.cam.alias],
                          (error) => {
                            assert.ok(error);
                            assert.ok(error.code, 400);

                            // Ensure no tenants have been added to the tenant network
                            RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                              assert.notExists(error);
                              assert.ok(tenantNetworks);
                              assert.ok(tenantNetworks[tenantNetwork.id]);
                              assert.isArray(tenantNetworks[tenantNetwork.id].tenants);
                              assert.isEmpty(tenantNetworks[tenantNetwork.id].tenants);

                              // Sanity check adding a valid tenant alias to the tenant network
                              RestAPI.Tenants.addTenantAliases(
                                globalAdminRestContext,
                                tenantNetwork.id,
                                [global.oaeTests.tenants.cam.alias],
                                (error_) => {
                                  assert.notExists(error_);

                                  // Ensure the tenant is now found in the tenant network response
                                  RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                                    assert.notExists(error);
                                    assert.ok(tenantNetworks);
                                    assert.ok(tenantNetworks[tenantNetwork.id]);
                                    assert.isArray(tenantNetworks[tenantNetwork.id].tenants);
                                    assert.strictEqual(tenantNetworks[tenantNetwork.id].tenants.length, 1);

                                    return callback();
                                  });
                                }
                              );
                            });
                          }
                        );
                      });
                    });
                  }
                );
              }
            );
          }
        );
      });
    });
  });

  /**
   * Test that verifies the request is properly authorized when adding tenant aliases to a tenant network
   */
  it('verify add tenant alias authorization', (callback) => {
    TenantsTestUtil.generateTestTenantNetworks(globalAdminRestContext, 1, (originalTenantNetwork) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        // Ensure adding a tenant as anonymous user-tenant user results in a 404 (because the endpoint is not bound to the user tenant server)
        RestAPI.Tenants.addTenantAliases(
          anonymousCamRestContext,
          originalTenantNetwork.id,
          [global.oaeTests.tenants.cam.alias],
          (error_) => {
            assert.ok(error_);
            assert.strictEqual(error_.code, 404);

            // Ensure adding a tenant as loggedin user-tenant user results in a 404 (because the endpoint is not bound to the user tenant server)
            RestAPI.Tenants.addTenantAliases(
              mrvisser.restContext,
              originalTenantNetwork.id,
              [global.oaeTests.tenants.cam.alias],
              (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 404);

                // Ensure adding a tenant as tenant administrator user results in a 404 (because the endpoint is not bound to the user tenant server)
                RestAPI.Tenants.addTenantAliases(
                  camAdminRestContext,
                  originalTenantNetwork.id,
                  [global.oaeTests.tenants.cam.alias],
                  (error_) => {
                    assert.ok(error_);
                    assert.strictEqual(error_.code, 404);

                    // Ensure adding a tenant as anonymous global-admin user results in a 401
                    RestAPI.Tenants.addTenantAliases(
                      anonymousGlobalRestContext,
                      originalTenantNetwork.id,
                      [global.oaeTests.tenants.cam.alias],
                      (error_) => {
                        assert.ok(error_);
                        assert.strictEqual(error_.code, 401);

                        // Ensure the tenant network still has no tenants associated to it
                        RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                          assert.notExists(error);
                          assert.ok(tenantNetworks);
                          assert.ok(tenantNetworks[originalTenantNetwork.id]);
                          assert.isArray(tenantNetworks[originalTenantNetwork.id].tenants);
                          assert.isEmpty(tenantNetworks[originalTenantNetwork.id].tenants);

                          // Sanity check that adding a tenant as global admin user succeeds
                          RestAPI.Tenants.addTenantAliases(
                            globalAdminRestContext,
                            originalTenantNetwork.id,
                            [global.oaeTests.tenants.cam.alias],
                            (error_) => {
                              assert.notExists(error_);

                              // Ensure the tenant network is gone
                              RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                                assert.notExists(error);
                                assert.ok(tenantNetworks);
                                assert.ok(tenantNetworks[originalTenantNetwork.id]);
                                assert.isArray(tenantNetworks[originalTenantNetwork.id].tenants);
                                assert.strictEqual(tenantNetworks[originalTenantNetwork.id].tenants.length, 1);
                                return callback();
                              });
                            }
                          );
                        });
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

  /**
   * Test that verifies the request is properly validated when removing tenant aliases from a tenant network
   */
  it('verify remove tenant alias validation', (callback) => {
    TenantsTestUtil.generateTestTenantNetworks(globalAdminRestContext, 1, (tenantNetwork) => {
      RestAPI.Tenants.addTenantAliases(
        globalAdminRestContext,
        tenantNetwork.id,
        [global.oaeTests.tenants.cam.alias],
        (error) => {
          assert.notExists(error);

          // Ensure a tenant network id is required when removing a tenant from a tenant network (we test a 404 because the id is part of the resource path)
          RestAPI.Tenants.removeTenantAliases(
            globalAdminRestContext,
            null,
            [global.oaeTests.tenants.cam.alias],
            (error) => {
              assert.ok(error);
              assert.ok(error.code, 404);

              // Ensure a tenant network id is required when removing a tenant from a tenant network directly against the API
              TenantNetworksAPI.removeTenantAliases(
                TestsUtil.createGlobalAdminContext(),
                null,
                [global.oaeTests.tenants.cam.alias],
                (error) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 400);

                  // Ensure a tenant network id cannot be all whitespace when removing a tenant from a tenant network
                  RestAPI.Tenants.removeTenantAliases(
                    globalAdminRestContext,
                    '   ',
                    [global.oaeTests.tenants.cam.alias],
                    (error) => {
                      assert.ok(error);
                      assert.strictEqual(error.code, 400);

                      // Ensure removing tenants from a non-existing tenant network results in a 404
                      RestAPI.Tenants.removeTenantAliases(
                        globalAdminRestContext,
                        'non-existing-tenant-network-id',
                        [global.oaeTests.tenants.cam.alias],
                        (error) => {
                          assert.ok(error);
                          assert.ok(error.code, 404);

                          // Ensure a list of tenant aliases is required when removing tenants from a tenant network
                          RestAPI.Tenants.removeTenantAliases(
                            globalAdminRestContext,
                            tenantNetwork.id,
                            null,
                            (error) => {
                              assert.ok(error);
                              assert.ok(error.code, 400);

                              // Ensure at least one tenant alias must be specified when removing tenants from a tenant network
                              RestAPI.Tenants.removeTenantAliases(
                                globalAdminRestContext,
                                tenantNetwork.id,
                                [],
                                (error) => {
                                  assert.ok(error);
                                  assert.ok(error.code, 400);

                                  // Ensure no tenants have been removed from the tenant network
                                  RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                                    assert.notExists(error);
                                    assert.ok(tenantNetworks);
                                    assert.ok(tenantNetworks[tenantNetwork.id]);
                                    assert.isArray(tenantNetworks[tenantNetwork.id].tenants);
                                    assert.strictEqual(tenantNetworks[tenantNetwork.id].tenants.length, 1);

                                    // Sanity check removing a valid tenant alias from the tenant network, also non-existing tenants in the array do not result in a validation error
                                    RestAPI.Tenants.removeTenantAliases(
                                      globalAdminRestContext,
                                      tenantNetwork.id,
                                      ['non-existing-tenant-alias', global.oaeTests.tenants.cam.alias],
                                      (error_) => {
                                        assert.notExists(error_);

                                        // Ensure the tenant is no longer found in the tenant network response
                                        RestAPI.Tenants.getTenantNetworks(
                                          globalAdminRestContext,
                                          (error, tenantNetworks) => {
                                            assert.notExists(error);
                                            assert.ok(tenantNetworks);
                                            assert.ok(tenantNetworks[tenantNetwork.id]);
                                            assert.isArray(tenantNetworks[tenantNetwork.id].tenants);
                                            assert.isEmpty(tenantNetworks[tenantNetwork.id].tenants);

                                            return callback();
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

  /**
   * Test that verifies the request is properly authorized when removing tenant aliases from a tenant network
   */
  it('verify remove tenant alias authorization', (callback) => {
    TenantsTestUtil.generateTestTenantNetworks(globalAdminRestContext, 1, (tenantNetwork) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: mrvisser } = users;

        // Add a tenant to the tenant network to try and remove it
        RestAPI.Tenants.addTenantAliases(
          globalAdminRestContext,
          tenantNetwork.id,
          [global.oaeTests.tenants.cam.alias],
          (error_) => {
            assert.notExists(error_);

            // Ensure removing a tenant as anonymous user-tenant user results in a 404 (because the endpoint is not bound to the user tenant server)
            RestAPI.Tenants.removeTenantAliases(
              anonymousCamRestContext,
              tenantNetwork.id,
              [global.oaeTests.tenants.cam.alias],
              (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 404);

                // Ensure removing a tenant as loggedin user-tenant user results in a 404 (because the endpoint is not bound to the user tenant server)
                RestAPI.Tenants.removeTenantAliases(
                  mrvisser.restContext,
                  tenantNetwork.id,
                  [global.oaeTests.tenants.cam.alias],
                  (error_) => {
                    assert.ok(error_);
                    assert.strictEqual(error_.code, 404);

                    // Ensure removing a tenant as tenant administrator user results in a 404 (because the endpoint is not bound to the user tenant server)
                    RestAPI.Tenants.removeTenantAliases(
                      camAdminRestContext,
                      tenantNetwork.id,
                      [global.oaeTests.tenants.cam.alias],
                      (error_) => {
                        assert.ok(error_);
                        assert.strictEqual(error_.code, 404);

                        // Ensure removing a tenant as anonymous global-admin user results in a 401
                        RestAPI.Tenants.removeTenantAliases(
                          anonymousGlobalRestContext,
                          tenantNetwork.id,
                          [global.oaeTests.tenants.cam.alias],
                          (error_) => {
                            assert.ok(error_);
                            assert.strictEqual(error_.code, 401);

                            // Ensure the tenant network still has the tenant associated to it
                            RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                              assert.notExists(error);
                              assert.ok(tenantNetworks);
                              assert.ok(tenantNetworks[tenantNetwork.id]);
                              assert.isArray(tenantNetworks[tenantNetwork.id].tenants);
                              assert.strictEqual(tenantNetworks[tenantNetwork.id].tenants.length, 1);

                              // Sanity check that removing a tenant as global admin user succeeds
                              RestAPI.Tenants.removeTenantAliases(
                                globalAdminRestContext,
                                tenantNetwork.id,
                                [global.oaeTests.tenants.cam.alias],
                                (error_) => {
                                  assert.notExists(error_);

                                  // Ensure the tenant network is gone
                                  RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error, tenantNetworks) => {
                                    assert.notExists(error);
                                    assert.ok(tenantNetworks);
                                    assert.ok(tenantNetworks[tenantNetwork.id]);
                                    assert.isArray(tenantNetworks[tenantNetwork.id].tenants);
                                    assert.isEmpty(tenantNetworks[tenantNetwork.id].tenants);

                                    return callback();
                                  });
                                }
                              );
                            });
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

  /**
   * Test that verifies tenant network mutation operations result in cache invalidation events
   */
  it('verify tenant network mutation operations all result in cluster cache invalidation event', (callback) => {
    /*!
     * Convenience method that invokes a method and then waits for a pubsub oae-tenant-networks invalidation event. The
     * callback is only invoked once both the method request and the invalidation event has been fired. This method will
     * hang if one of the cases never happen.
     *
     * When complete, the callback at the end of the arguments list will be invoked with the callback parameters of the provided
     * method that was completed.
     *
     * @param  {Function}       method      The method to invoke
     * @param  {Arguments...}   arguments   The arguments with which to invoke the method. The last argument should be a callback
     */
    const _invokeAndWaitForInvalidate = function (...args) {
      const method = head(args);
      let callbackReturned = false;
      let invalidateOccurred = false;
      let callbackArguments = null;

      // Extract the method, methodArgs, and methodCallback out of the arguments as separate variables
      // const args = Array.prototype.slice.call(args);
      const methodCallback = args.pop();
      const methodArgs = args.slice(1);

      // Push in a replacement callback that only calls the methodCallback if the invalidate has also
      // happened
      methodArgs.push(function (...args) {
        // Record what the arguments were of the method callback, and log the fact that the method
        // has called back
        callbackArguments = args;
        callbackReturned = true;

        // Invoke the method callback only if we have also invalidated the cache
        if (callbackReturned && invalidateOccurred) {
          return methodCallback.apply(methodCallback, callbackArguments);
        }
      });

      // Invoke the method with the new args
      method.apply(method, methodArgs);

      // When the invalidate occurs, invoke the callback if the provided method completed execution
      Pubsub.emitter.once('oae-tenant-networks', (message) => {
        assert.strictEqual(message, 'invalidate');
        invalidateOccurred = true;

        // Invoke the method callback only if the method has finished execution
        if (callbackReturned && invalidateOccurred) {
          return methodCallback.apply(methodCallback, callbackArguments);
        }
      });
    };

    // Create a tenant network. This will only continue if an "invalidate" message was successfully published
    _invokeAndWaitForInvalidate(
      RestAPI.Tenants.createTenantNetwork,
      globalAdminRestContext,
      'verifies creating a tenant network results in a cache invalidation event',
      (error, tenantNetwork) => {
        assert.notExists(error);

        // Update the displayName. This will only continue if an "invalidate" message was successfully published
        _invokeAndWaitForInvalidate(
          RestAPI.Tenants.updateTenantNetwork,
          globalAdminRestContext,
          tenantNetwork.id,
          'verifies creating a tenant network results in a cache invalidation event 2',
          (error, tenantNetwork) => {
            assert.notExists(error);

            // Add a tenant to the tenant network. This will only continue if an "invalidate" message was successfully published
            _invokeAndWaitForInvalidate(
              RestAPI.Tenants.addTenantAliases,
              globalAdminRestContext,
              tenantNetwork.id,
              [global.oaeTests.tenants.cam.alias],
              (error_) => {
                assert.notExists(error_);

                // Remove the tenant from the tenant network. This will only continue if an "invalidate" message was successfully published
                _invokeAndWaitForInvalidate(
                  RestAPI.Tenants.removeTenantAliases,
                  globalAdminRestContext,
                  tenantNetwork.id,
                  [global.oaeTests.tenants.cam.alias],
                  (error_) => {
                    assert.notExists(error_);

                    // Delete the tenant network. This will only continue if an "invalidate" message was successfully published
                    _invokeAndWaitForInvalidate(
                      RestAPI.Tenants.deleteTenantNetwork,
                      globalAdminRestContext,
                      tenantNetwork.id,
                      (error_) => {
                        assert.notExists(error_);
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
  });

  /**
   * Test that verifies the tenant networks cache is invalidated when it receives an "invalidate" message on redis
   */
  it('verify the tenant networks cache is invalidated based on an "invalidate" message', (callback) => {
    // Create a tenant network
    RestAPI.Tenants.createTenantNetwork(
      globalAdminRestContext,
      'verifies the tenant networks cache is invalidated based on an "invalidate" message',
      (error /* , tenantNetwork */) => {
        assert.notExists(error);

        // Get the tenant networks to ensure we have filled the cache
        RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error /* , tenantNetworks */) => {
          assert.notExists(error);

          // Send a manual cache invalidation signal
          Pubsub.publish('oae-tenant-networks', 'invalidate', (error_) => {
            assert.notExists(error_);
          });

          // Continue based on the expected local "invalidate" event
          TenantNetworksDAO.emitter.once('invalidate', () => {
            // Get the tenant networks, while listening for the "revalidate" event
            RestAPI.Tenants.getTenantNetworks(globalAdminRestContext, (error /* , tenantNetworks */) => {
              assert.notExists(error);
            });

            TenantNetworksDAO.emitter.once('revalidate', () => {
              // The cache was revalidated. Good!
              return callback();
            });
          });
        });
      }
    );
  });
});
