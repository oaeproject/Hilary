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

const assert = require('assert');
const util = require('util');
const _ = require('underscore');

const ConfigAPI = require('oae-config');
const ConfigTestUtil = require('oae-config/lib/test/util');
const PrincipalsDAO = require('oae-principals/lib/internal/dao');
const PrincipalsTestUtil = require('oae-principals/lib/test/util');
const RestAPI = require('oae-rest');
const { RestContext } = require('oae-rest/lib/model');
const ShibbolethAPI = require('oae-authentication/lib/strategies/shibboleth/api');
const TestsUtil = require('oae-tests');

const TenantsAPI = require('oae-tenants');
const TenantsEmailDomainIndex = require('oae-tenants/lib/internal/emailDomainIndex');
const TenantsUtil = require('oae-tenants/lib/util');
const TenantsTestUtil = require('oae-tenants/lib/test/util');

describe('Tenants', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let anonymousCamRestContext = null;
  // Rest context that can be used for anonymous requests on the global tenant
  let anonymousGlobalRestContext = null;
  // Rest context that can be used every time we need to make a request as a Cambridge tenant admin
  let camAdminRestContext = null;
  // Rest context that can be used every time we need to use a request as a global admin
  let globalAdminRestContext = null;

  /**
   * Function that will fill up the anonymous and the tenant admin context
   */
  before(callback => {
    // Fill up anonymous rest context
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    // Fill up the anonymous global rest context
    anonymousGlobalRestContext = TestsUtil.createGlobalRestContext();
    // Fill up Cam tenant admin rest context
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    // Fill up the global admin rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    callback();
  });

  describe('Email Domain Index', () => {
    // A variety of entries to use for a standard test index
    const _entries = [
      // Cambridge tenants
      {
        alias: 'cam-caret',
        domain: 'Caret.Cam.Ac.Uk'
      },
      {
        alias: 'cam-uis',
        domain: 'Uis.cam.ac.uk'
      },
      {
        alias: 'cam-library',
        domain: 'library.Cam.Ac.Uk'
      },

      // Oxford tenants
      {
        alias: 'ox-caret',
        domain: 'caret.ox.ac.uk'
      },
      {
        alias: 'ox-uis',
        domain: 'uis.ox.ac.uk'
      },
      {
        alias: 'ox-library',
        domain: 'library.ox.ac.uk'
      },

      // Georgia Tech tenants
      {
        alias: 'gatech-caret',
        domain: 'caret.gatech.edu'
      },
      {
        alias: 'gatech-uis',
        domain: 'uis.gatech.edu'
      },
      {
        alias: 'gatech-library',
        domain: 'library.gatech.edu'
      }
    ];

    /*!
         * Ensure that the `index.match` function works as expected assuming all the standard
         * entries that are inserted using `_createIndex()`
         *
         * @param  {TenantEmailDomainIndex}     index   The index to test
         * @throws {AssertionError}                     Thrown if any of the assertions fail
         */
    const _assertAllStandardMatches = function(index) {
      // Domain prefixes to test. Tenant aliases are being set to ensure we don't wind up with
      // issues with tenant aliases being the string leaf keys of the index
      const prefixes = [
        '',
        'something',
        'Something',
        'something.else',
        'SOMETHING.else',
        'cam-caret',
        'Cam-Caret',
        'cam-uis',
        'cam-library',
        'ox-caret',
        'ox-uis',
        'ox-library',
        'gatech-caret',
        'gatech-uis',
        'gatech-library'
      ];

      const matchingSuffixes = _.chain(_entries)
        .indexBy('domain')
        .mapObject(entry => {
          return entry.alias;
        })
        .tap(obj => {
          // In addition to the aliases, use upper-case versions of
          // them as well to match
          _.each(obj, (alias, domain) => {
            obj[domain.toUpperCase()] = alias;
          });
        })
        .value();

      const nonMatchingSuffixes = [
        'com',
        'Com',
        'COM',
        'something.com',
        'Something.Com',
        '*',
        '',
        'uk',
        'ac.uk',
        'cam.ac.uk',
        'ox.ac.uk',
        'edu',
        'gatech.edu'
      ];

      // Ensure each matching suffix indeed matches the expected tenant alias
      _.each(matchingSuffixes, (alias, suffix) => {
        _.each(prefixes, prefix => {
          const domain = prefix ? util.format('%s.%s', prefix, suffix) : suffix;
          const match = index.match(domain);
          assert.strictEqual(match, alias);
        });
      });

      // Ensure each non-matching suffix does not match at all
      _.each(nonMatchingSuffixes, suffix => {
        _.each(prefixes, prefix => {
          const domain = prefix ? util.format('%s.%s', prefix, suffix) : suffix;
          assert.ok(!index.match(domain));
        });
      });
    };

    /*!
         * Ensure that the `index.conflict` function works as expected assuming all the standard
         * entries that are inserted using `_createIndex()`
         *
         * @param  {TenantEmailDomainIndex}     index   The index to test
         * @throws {AssertionError}                     Thrown if any of the assertions fail
         */
    const _assertAllStandardConflicts = function(index) {
      // Domain prefixes to test. Tenant aliases are being set to ensure we don't wind up with
      // issues with tenant aliases being the string leaf keys of the index
      const prefixes = [
        '',
        'something',
        'something.else',
        'cam-caret',
        'cam-uis',
        'cam-library',
        'ox-caret',
        'ox-uis',
        'ox-library',
        'gatech-caret',
        'gatech-uis',
        'gatech-library'
      ];

      const conflictingDomains = _.chain(_entries)
        .pluck('domain')
        .map(domain => {
          return _.map(prefixes, prefix => {
            return prefix ? util.format('%s.%s', prefix, domain) : domain;
          });
        })
        .flatten()
        .union(['uk', 'ac.uk', 'cam.ac.uk', 'ox.ac.uk', 'edu', 'gatech.edu'])
        .value();

      const nonConflictingDomains = [
        'something.cam.ac.uk',
        'something.ox.ac.uk',
        'something.ac.uk',
        'something.uk',
        'something.gatech.edu',
        'something.edu',
        'com',
        'something.com'
      ];

      _.each(conflictingDomains, domain => {
        assert.ok(index.conflict(null, domain));
        assert.ok(index.conflict('nonexistingalias', domain));
      });

      _.each(nonConflictingDomains, domain => {
        assert.ok(!index.conflict(null, domain));
        assert.ok(!index.conflict('nonexistingalias', domain));
      });
    };

    /*!
         * Create a test email domain index using the standard test entries
         *
         * @return {TenantEmailDomainIndex}     The email domain index
         */
    const _createIndex = function() {
      const index = new TenantsEmailDomainIndex();

      _.each(_entries, entry => {
        index.update(entry.alias, entry.domain);
      });

      _assertAllStandardMatches(index);
      _assertAllStandardConflicts(index);

      return index;
    };

    /**
     * Test that verifies the email domain index can detect conflicts as expected
     */
    it('verify it detects conflicts as expected', callback => {
      const index = _createIndex();

      // Add a single alias that is found in a descent search from 'newtld'
      index.update('new', 'new.newtld');

      // Sanity check that what we're going to test has conflicts without the tenant alias
      assert.strictEqual(index.conflict(null, 'newtld'), 'new');
      assert.ok(index.conflict(null, 'ac.uk'));
      assert.strictEqual(index.conflict(null, 'caret.cam.ac.uk'), 'cam-caret');

      // Check that domains that match a unique tenant alias bypass conflict when the proper
      // alias is specified
      assert.ok(!index.conflict('new', 'newtld'));
      assert.ok(!index.conflict('cam-caret', 'caret.cam.ac.uk'));

      // Check that domains that match multiple domains still report a conflict even if we
      // have specified one matching alias
      assert.ok(index.conflict('cam-caret', 'ac.uk'));

      callback();
    });

    /**
     * Test that verifies the email domain index is updated or fails to update when expected
     */
    it('verify it updates domains as expected', callback => {
      const index = _createIndex();

      // Attempt to make a few conflicting updates
      index.update('cam-caret', 'uk');
      index.update('cam-caret', 'library.cam.ac.uk');
      index.update(null, 'blah.library.cam.ac.uk');

      _assertAllStandardMatches(index);
      _assertAllStandardConflicts(index);

      // Update a domain to conflict with its value, ensuring the update is successful
      index.update('cam-caret', 'blah.caret.cam.ac.uk', 'caret.cam.ac.uk');
      assert.strictEqual(index.match('blah.caret.cam.ac.uk'), 'cam-caret');

      // Create a new tenant at the previous domain, ensuring it fails
      index.update('cam-caret2', 'caret.cam.ac.uk');
      assert.strictEqual(index.match('blah.caret.cam.ac.uk'), 'cam-caret');
      assert.ok(!index.match('caret.cam.ac.uk'));

      // Move cam-caret's domain from blah.caret.cam.ac.uk back to caret.cam.ac.uk, ensuring
      // the standard index is restored
      index.update('cam-caret', 'something.else', 'blah.caret.cam.ac.uk');
      assert.ok(!index.match('caret.cam.ac.uk'));
      assert.ok(!index.match('blah.caret.cam.ac.uk'));

      // Now reset cam-caret to be caret.cam.ac.uk
      index.update('cam-caret', 'caret.cam.ac.uk', 'blah.caret.cam.ac.uk');

      _assertAllStandardMatches(index);
      _assertAllStandardConflicts(index);

      callback();
    });

    /**
     * Test that verifies that the email domain index can map multiple email domains to an alias
     */
    it('verify it supports multiple tenants', callback => {
      const index = _createIndex();

      index.update('sussex', 'sussex.ac.uk');
      index.update('sussex', 'susx.ac.uk');

      assert.strictEqual(index.match('sussex.ac.uk'), 'sussex');
      assert.strictEqual(index.match('susx.ac.uk'), 'sussex');

      callback();
    });
  });

  describe('Guest tenant', () => {
    /**
     * Test that verifies the guest tenant exists and accepts updates just like any other
     * tenant
     */
    it('verify guest tenant can be accessed and updated', callback => {
      RestAPI.Tenants.getTenants(globalAdminRestContext, (err, tenants) => {
        assert.ok(!err);

        const guestTenant0 = _.findWhere(tenants, { alias: 'guest' });
        assert.ok(guestTenant0);
        assert.strictEqual(guestTenant0.displayName, 'Guest tenant');
        assert.strictEqual(guestTenant0.host, 'guest.oae.com');
        assert.ok(_.isEmpty(guestTenant0.emailDomains));
        assert.strictEqual(guestTenant0.active, true);
        assert.strictEqual(guestTenant0.isGlobalAdminServer, false);
        assert.strictEqual(guestTenant0.isGuestTenant, true);

        // Get the guest tenant by alias
        RestAPI.Tenants.getTenant(globalAdminRestContext, 'guest', (err, guestTenant1) => {
          assert.ok(!err);
          assert.deepStrictEqual(guestTenant1, guestTenant0);

          // Update the display name of the guest tenant
          const newDisplayName = TestsUtil.generateRandomText(1);
          TenantsTestUtil.updateTenantAndWait(
            globalAdminRestContext,
            'guest',
            { displayName: newDisplayName },
            err => {
              assert.ok(!err);

              // Get the guest tenant again and ensure it has the updates
              const expectedUpdatedGuestTenant = _.extend({}, guestTenant0, {
                displayName: newDisplayName
              });
              RestAPI.Tenants.getTenant(
                globalAdminRestContext,
                'guest',
                (err, updatedGuestTenant1) => {
                  assert.ok(!err);
                  assert.deepStrictEqual(updatedGuestTenant1, expectedUpdatedGuestTenant);
                  return callback();
                }
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies the guest tenant is flagged in the me feed of
     * users on the guest tenant
     */
    it('verify guest tenant is flagged in the me feed', callback => {
      // Ensure it is set to true on the me feed of the guest tenant
      const guestRestContext = TestsUtil.createTenantRestContext('guest.oae.com');
      PrincipalsTestUtil.assertGetMeSucceeds(guestRestContext, me => {
        assert.strictEqual(me.tenant.isGuestTenant, true);

        // Ensure the isGuestTenant key does not exist when it is not
        // the guest tenant
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
          assert.ok(!err);
          PrincipalsTestUtil.assertGetMeSucceeds(user.restContext, me => {
            assert.ok(_.isUndefined(me.tenant.isGuestTenant));
            return callback();
          });
        });
      });
    });
  });

  describe('Get tenants by an email address', () => {
    /**
     * Test that verifies validation
     */
    it('verify validation', callback => {
      RestAPI.Tenants.getTenantsByEmailAddress(camAdminRestContext, [], (err, tenants) => {
        assert.strictEqual(err.code, 400);

        return callback();
      });
    });

    /**
     * Test that verifies that tenants can be looked up through an email address
     */
    it('verify tenants can be looked up through an email address', callback => {
      // Create tenants with a configured email domain
      TestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
          // Both tenants should be returned
          let emails = [
            publicTenant0.privateUser.user.email,
            privateTenant1.privateUser.user.email
          ];
          RestAPI.Tenants.getTenantsByEmailAddress(
            publicTenant0.publicUser.restContext,
            emails,
            (err, tenants) => {
              assert.ok(!err);
              assert.strictEqual(
                tenants[publicTenant0.privateUser.user.email].alias,
                publicTenant0.tenant.alias
              );
              assert.strictEqual(
                tenants[privateTenant1.privateUser.user.email].alias,
                privateTenant1.tenant.alias
              );

              // An email that ends up on the guest tenant should
              // return the guest tenancy
              emails = ['an.email.ending.up@on.the.guest.tenancy'];
              RestAPI.Tenants.getTenantsByEmailAddress(
                publicTenant0.publicUser.restContext,
                emails,
                (err, tenants) => {
                  assert.ok(!err);
                  assert.ok(tenants[emails[0]].isGuestTenant);

                  // A combination of both
                  emails = [
                    'an.email.ending.up@on.the.guest.tenancy',
                    publicTenant0.publicUser.user.email
                  ];
                  RestAPI.Tenants.getTenantsByEmailAddress(
                    publicTenant0.publicUser.restContext,
                    emails,
                    (err, tenants) => {
                      assert.ok(!err);
                      assert.ok(tenants[emails[0]].isGuestTenant);
                      assert.strictEqual(
                        tenants[publicTenant0.publicUser.user.email].alias,
                        publicTenant0.tenant.alias
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
    });
  });

  describe('Get tenant', () => {
    /**
     * Test that verifies that all tenants can be retrieved
     */
    it('verify get all tenants', callback => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantDescription = TestsUtil.generateRandomText();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      const tenantEmailDomain = TenantsTestUtil.generateTestTenantHost();

      // Get all tenants, check that our cam and gt tenants are there
      RestAPI.Tenants.getTenants(globalAdminRestContext, (err, tenants) => {
        assert.ok(!err);
        assert.ok(tenants);
        assert.ok(tenants.camtest);
        assert.strictEqual(tenants.camtest.host, 'cambridge.oae.com');
        assert.ok(tenants.gttest);
        assert.strictEqual(tenants.gttest.host, 'gt.oae.com');

        const numTenants = _.keys(tenants).length;

        // Create a new tenant
        TenantsTestUtil.createTenantAndWait(
          globalAdminRestContext,
          tenantAlias,
          tenantDescription,
          tenantHost,
          { emailDomains: [tenantEmailDomain] },
          err => {
            assert.ok(!err);

            // Get all tenants, check that there is one more
            RestAPI.Tenants.getTenants(globalAdminRestContext, (err, tenants) => {
              assert.ok(tenants);
              assert.ok(tenants.gttest);
              assert.ok(tenants.camtest);
              assert.strictEqual(tenants.gttest.host, 'gt.oae.com');
              assert.strictEqual(tenants.camtest.host, 'cambridge.oae.com');
              assert.ok(tenants[tenantAlias]);
              assert.strictEqual(tenants[tenantAlias].host, tenantHost.toLowerCase());
              assert.strictEqual(
                tenants[tenantAlias].emailDomains[0],
                tenantEmailDomain.toLowerCase()
              );
              assert.strictEqual(_.keys(tenants).length, numTenants + 1);

              // Verify that the global admin tenant is not included
              assert.ok(!tenants.admin);

              return callback();
            });
          }
        );
      });
    });

    /**
     * Test that verifies that the current tenant's information can be retrieved
     */
    it('verify get tenant', callback => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantDescription = TestsUtil.generateRandomText();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      const tenantEmailDomain = TenantsTestUtil.generateTestTenantHost();

      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        tenantAlias,
        tenantDescription,
        tenantHost,
        { emailDomains: [tenantEmailDomain] },
        (err, createdTenant) => {
          const anonymousRestContext = TestsUtil.createTenantRestContext(tenantHost);

          RestAPI.Tenants.getTenant(anonymousRestContext, null, (err, tenant) => {
            assert.ok(!err);
            assert.strictEqual(tenant.alias, tenantAlias);
            assert.strictEqual(tenant.host, tenantHost.toLowerCase());
            assert.strictEqual(tenant.emailDomains[0], tenantEmailDomain.toLowerCase());

            // Verify that the tenant information is available through the global tenant
            RestAPI.Tenants.getTenant(globalAdminRestContext, tenantAlias, (err, tenant) => {
              assert.ok(!err);
              assert.strictEqual(tenant.alias, tenantAlias);
              assert.strictEqual(tenant.host, tenantHost.toLowerCase());
              assert.strictEqual(tenant.emailDomains[0], tenantEmailDomain.toLowerCase());

              // Get the tenant by host name
              const tenantByHost = TenantsAPI.getTenantByHost(tenantHost);
              assert.strictEqual(tenantByHost.alias, tenantAlias);
              assert.strictEqual(tenantByHost.host, tenantHost.toLowerCase());
              assert.strictEqual(tenantByHost.emailDomains[0], tenantEmailDomain.toLowerCase());

              // Get the tenant by email domain
              const tenantByEmailDomain = TenantsAPI.getTenantByEmail(tenantEmailDomain);
              assert.strictEqual(tenantByEmailDomain.alias, tenantAlias);
              assert.strictEqual(tenantByEmailDomain.host, tenantHost.toLowerCase());
              assert.strictEqual(
                tenantByEmailDomain.emailDomains[0],
                tenantEmailDomain.toLowerCase()
              );

              return callback();
            });
          });
        }
      );
    });

    /**
     *  Test that verifies that getting the global tenant succeeds
     */
    it('verify get global tenant', callback => {
      RestAPI.Tenants.getTenant(globalAdminRestContext, null, (err, tenant) => {
        assert.ok(!err);
        assert.ok(tenant);
        assert.strictEqual(tenant.isGlobalAdminServer, true);
        assert.strictEqual(tenant.alias, 'admin');

        // Get the global admin tenant by host name
        const globalAdminTenant = TenantsAPI.getTenantByHost('localhost:2000');
        assert.ok(globalAdminTenant);
        assert.strictEqual(globalAdminTenant.isGlobalAdminServer, true);
        assert.strictEqual(globalAdminTenant.alias, 'admin');
        callback();
      });
    });

    /**
     * Test that verifies that getting the tenant information through the global server requires a valid alias
     */
    it('verify get tenant validation', callback => {
      RestAPI.Tenants.getTenant(globalAdminRestContext, ' ', (err, tenant) => {
        assert.ok(err);
        assert.strictEqual(err.code, 404);
        callback();
      });
    });

    /**
     * Test that verifies that a tenant can be retrieved by its mapped alias through the internal API.
     */
    it('verify get tenant by alias', callback => {
      // Get the Cambridge tenant
      let tenant = TenantsAPI.getTenant('camtest');
      assert.ok(tenant);
      assert.strictEqual(tenant.alias, 'camtest');
      assert.strictEqual(tenant.displayName, 'Cambridge University Test');
      assert.strictEqual(tenant.host, 'cambridge.oae.com');

      // Get the GT tenant
      tenant = TenantsAPI.getTenant('gttest');
      assert.ok(tenant);
      assert.strictEqual(tenant.alias, 'gttest');
      assert.strictEqual(tenant.displayName, 'Georgia Tech Test');
      assert.strictEqual(tenant.host, 'gt.oae.com');

      // Get the global admin tenant
      tenant = TenantsAPI.getTenant('admin');
      assert.ok(tenant);
      assert.strictEqual(tenant.alias, 'admin');
      assert.strictEqual(tenant.displayName, 'Global admin server');
      assert.strictEqual(tenant.host, 'localhost:2000');
      assert.strictEqual(tenant.isGlobalAdminServer, true);

      // Get non-existing tenant
      tenant = TenantsAPI.getTenant('non-existing');
      assert.ok(!tenant);
      callback();
    });

    /**
     * Test that verifies that a tenant can be retrieved by its mapped host name. This uses the internal
     * API as there is no REST feed available that offers this functionality.
     */
    it('verify get tenant by host', callback => {
      // Get the Cambridge tenant
      let tenant = TenantsAPI.getTenantByHost('cambridge.oae.com');
      assert.ok(tenant);
      assert.strictEqual(tenant.alias, 'camtest');
      assert.strictEqual(tenant.displayName, 'Cambridge University Test');
      assert.strictEqual(tenant.host, 'cambridge.oae.com');

      // Get the GT tenant
      tenant = TenantsAPI.getTenantByHost('gt.oae.com');
      assert.ok(tenant);
      assert.strictEqual(tenant.alias, 'gttest');
      assert.strictEqual(tenant.displayName, 'Georgia Tech Test');
      assert.strictEqual(tenant.host, 'gt.oae.com');

      // Get the global admin tenant
      tenant = TenantsAPI.getTenantByHost('localhost:2000');
      assert.ok(tenant);
      assert.strictEqual(tenant.alias, 'admin');
      assert.strictEqual(tenant.displayName, 'Global admin server');
      assert.strictEqual(tenant.host, 'localhost:2000');
      assert.strictEqual(tenant.isGlobalAdminServer, true);

      // Get non-existing tenant
      tenant = TenantsAPI.getTenantByHost('nonexisting.oae.com');
      assert.ok(!tenant);
      callback();
    });

    /**
     * Test that verifies a tenant can be looked up by an email domain match
     */
    it('verify get tenant by email domain', callback => {
      const commonTld = TenantsTestUtil.generateTestTenantHost();

      // Create two tenants that share a common TLD, however they have subdomains "a" and "aa"
      // that are very close to matching

      // Intialize tenant information for a tenant whose email domain suffix is "a" followed
      // by a host
      const tenant1Alias = TenantsTestUtil.generateTestTenantAlias();
      const tenant1Description = TestsUtil.generateRandomText();
      const tenant1Host = util.format('a.%s', commonTld);
      const tenant1Opts = { emailDomains: [tenant1Host] };

      // Initialize tenant information for a tenant whose email domain suffix is "aa" followed
      // by the same host
      const tenant2Alias = TenantsTestUtil.generateTestTenantAlias();
      const tenant2Description = TestsUtil.generateRandomText();
      const tenant2Host = util.format('aa.%s', commonTld);
      const tenant2Opts = { emailDomains: [tenant2Host] };

      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        tenant1Alias,
        tenant1Description,
        tenant1Host,
        tenant1Opts,
        (err, tenant1) => {
          assert.ok(!err);
          TenantsTestUtil.createTenantAndWait(
            globalAdminRestContext,
            tenant2Alias,
            tenant2Description,
            tenant2Host,
            tenant2Opts,
            (err, tenant2) => {
              assert.ok(!err);

              // Ensure we can get tenant 1 by an exact match
              let gotTenant1 = TenantsAPI.getTenantByEmail(tenant1Opts.emailDomains[0]);
              assert.ok(gotTenant1);
              assert.strictEqual(gotTenant1.alias, tenant1Alias);
              assert.strictEqual(gotTenant1.host, tenant1Host.toLowerCase());
              assert.strictEqual(
                gotTenant1.emailDomains[0],
                tenant1Opts.emailDomains[0].toLowerCase()
              );

              // Ensure we can get tenant 1 with an email address by an exact match
              gotTenant1 = TenantsAPI.getTenantByEmail(
                util.format('mrvisser@%s', tenant1Opts.emailDomains)
              );
              assert.ok(gotTenant1);
              assert.strictEqual(gotTenant1.alias, tenant1Alias);
              assert.strictEqual(gotTenant1.host, tenant1Host.toLowerCase());
              assert.strictEqual(
                gotTenant1.emailDomains[0],
                tenant1Opts.emailDomains[0].toLowerCase()
              );

              // Ensure we can get tenant 1 by a valid host suffix
              gotTenant1 = TenantsAPI.getTenantByEmail(
                util.format('prefix.%s', tenant1Opts.emailDomains)
              );
              assert.ok(gotTenant1);
              assert.strictEqual(gotTenant1.alias, tenant1Alias);
              assert.strictEqual(gotTenant1.host, tenant1Host.toLowerCase());
              assert.strictEqual(
                gotTenant1.emailDomains[0],
                tenant1Opts.emailDomains[0].toLowerCase()
              );

              // Ensure we can get tenant 1 by a valid host suffix in an email address
              gotTenant1 = TenantsAPI.getTenantByEmail(
                util.format('mrvisser@prefix.%s', tenant1Opts.emailDomains)
              );
              assert.ok(gotTenant1);
              assert.strictEqual(gotTenant1.alias, tenant1Alias);
              assert.strictEqual(gotTenant1.host, tenant1Host.toLowerCase());
              assert.strictEqual(
                gotTenant1.emailDomains[0],
                tenant1Opts.emailDomains[0].toLowerCase()
              );

              // Ensure we can get tenant 2 by an exact match
              let gotTenant2 = TenantsAPI.getTenantByEmail(tenant2Opts.emailDomains[0]);
              assert.ok(tenant2);
              assert.strictEqual(gotTenant2.alias, tenant2Alias);
              assert.strictEqual(gotTenant2.host, tenant2Host.toLowerCase());
              assert.strictEqual(
                gotTenant2.emailDomains[0],
                tenant2Opts.emailDomains[0].toLowerCase()
              );

              // Ensure we can get tenant 2 by an email address domain exact match
              gotTenant2 = TenantsAPI.getTenantByEmail(
                util.format('mrvisser@%s', tenant2Opts.emailDomains[0])
              );
              assert.ok(tenant2);
              assert.strictEqual(gotTenant2.alias, tenant2Alias);
              assert.strictEqual(gotTenant2.host, tenant2Host.toLowerCase());
              assert.strictEqual(
                gotTenant2.emailDomains[0],
                tenant2Opts.emailDomains[0].toLowerCase()
              );

              // Ensure we can get tenant 2 by a valid host suffix
              gotTenant2 = TenantsAPI.getTenantByEmail(
                util.format('prefix.%s', tenant2Opts.emailDomains[0])
              );
              assert.ok(tenant2);
              assert.strictEqual(gotTenant2.alias, tenant2Alias);
              assert.strictEqual(gotTenant2.host, tenant2Host.toLowerCase());
              assert.strictEqual(
                gotTenant2.emailDomains[0],
                tenant2Opts.emailDomains[0].toLowerCase()
              );

              // Ensure we can get tenant 2 by an email address with a valid host suffix
              gotTenant2 = TenantsAPI.getTenantByEmail(
                util.format('mrvisser@prefix.%s', tenant2Opts.emailDomains[0])
              );
              assert.ok(tenant2);
              assert.strictEqual(gotTenant2.alias, tenant2Alias);
              assert.strictEqual(gotTenant2.host, tenant2Host.toLowerCase());
              assert.strictEqual(
                gotTenant2.emailDomains[0],
                tenant2Opts.emailDomains[0].toLowerCase()
              );

              // Some subtle things that should fall back to the guest tenant:
              const shouldBeGuest = [
                // Use "aaa" as the 3rd level domain part and verify it doesn't match (i.e.,
                // "aaa.some.random.host" does not match "aa.some.random.host")
                util.format('aaa.%s', commonTld),

                // Ensure just the TLD itself doesn't match either one
                commonTld,

                // Ensure missing the last character doesn't match (e.g., "cam.ac.u")
                tenant1Opts.emailDomains[0].slice(0, -1),

                // Ensure missing the last character with the triple-"a" domain doesn't
                // match either (i.e., same length as a valid match, but subtle difference)
                util.format('aaa.%s', commonTld).slice(0, -1)
              ];

              const shouldBeGuestEmailAddresses = _.map(shouldBeGuest, domain => {
                return util.format('%s@%s', TestsUtil.generateTestUserId(), domain);
              });

              // Apply the tests
              _.chain(shouldBeGuest)
                .union(shouldBeGuestEmailAddresses)
                .map(TenantsAPI.getTenantByEmail)
                .pluck('alias')
                .each(alias => {
                  assert.strictEqual(alias, 'guest');
                })
                .value();

              // Some real-world cases with the cambridge tenant:
              const expectedTenantAlias = global.oaeTests.tenants.cam.alias;
              const shouldMatchCambridge = [
                'cam.ac.uk',
                'admin.cam.ac.uk',
                'sports.cam.ac.uk',
                'uis.cam.ac.uk'
              ];

              const shouldMatchCambridgeEmailAddresses = _.map(shouldMatchCambridge, domain => {
                return util.format('%s@%s', TestsUtil.generateTestUserId(), domain);
              });

              // Ensure all the cambridge email domains match the cambridge tenant
              _.chain(shouldMatchCambridge)
                .union(shouldMatchCambridgeEmailAddresses)
                .map(TenantsAPI.getTenantByEmail)
                .pluck('alias')
                .each(actualTenantAlias => {
                  assert.strictEqual(actualTenantAlias, expectedTenantAlias);
                })
                .value();

              return callback();
            }
          );
        }
      );
    });

    /**
     * Test that ensures a 418 HTTP response code when accessing the me feed from a non-existing tenant
     */
    it('verify accessing an endpoint from a non-existing tenant results in a 418 HTTP response code', callback => {
      // Get the me feed on an existing tenant
      RestAPI.User.getMe(anonymousCamRestContext, (err, meObj) => {
        assert.ok(!err);
        assert.strictEqual(meObj.anon, true);

        // Get the me feed on a non-existing tenant
        const anonymousNonExistingRestContext = TestsUtil.createTenantRestContext(
          'harvard.oae.com'
        );
        RestAPI.User.getMe(anonymousNonExistingRestContext, (err, meObj) => {
          assert.ok(err);
          assert.strictEqual(err.code, 418);
          callback();
        });
      });
    });

    /**
     * Test that verifies the non-interacting tenants cache gets updated appropriately when
     * tenant status updates
     */
    it('verify get non-interacting tenants', callback => {
      // There should always at least be the admin tenant
      assert.ok(_.findWhere(TenantsAPI.getNonInteractingTenants(), { alias: 'admin' }));

      // Ensure every tenant is either inactive, deleted, configured as "private" or the
      // global admin tenant
      _.each(TenantsAPI.getNonInteractingTenants(), tenant => {
        assert.ok(
          tenant.isGlobalAdminServer ||
            !tenant.active ||
            tenant.deleted ||
            TenantsUtil.isPrivate(tenant.alias)
        );
      });

      // Create a public tenant, ensuring it does not get grouped as non-interacting
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantDescription = TestsUtil.generateRandomText();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        tenantAlias,
        tenantDescription,
        tenantHost,
        null,
        err => {
          assert.ok(!err);
          assert.ok(!_.findWhere(TenantsAPI.getNonInteractingTenants(), { alias: tenantAlias }));

          // Make the tenant private
          const makePrivateUpdate = { 'oae-tenants/tenantprivacy/tenantprivate': true };
          ConfigTestUtil.updateConfigAndWait(
            globalAdminRestContext,
            tenantAlias,
            makePrivateUpdate,
            err => {
              assert.ok(!err);
            }
          );

          TenantsAPI.emitter.once('cached', () => {
            // After the tenants have been recached, ensure the tenant now appears in the
            // non-interacting tenants list
            assert.ok(_.findWhere(TenantsAPI.getNonInteractingTenants(), { alias: tenantAlias }));

            // Make the tenant public again, ensure it gets removed from the list
            const makePublicUpdate = { 'oae-tenants/tenantprivacy/tenantprivate': false };
            ConfigTestUtil.updateConfigAndWait(
              globalAdminRestContext,
              tenantAlias,
              makePublicUpdate,
              err => {
                assert.ok(!err);
              }
            );

            TenantsAPI.emitter.once('cached', () => {
              // After the tenants have been recached, ensure the tenant no longer appears
              // in the private tenants list
              assert.ok(
                !_.findWhere(TenantsAPI.getNonInteractingTenants(), { alias: tenantAlias })
              );

              // Disable the tenant and ensure it goes into the list of non-interacting
              // tenants
              TenantsTestUtil.stopTenantAndWait(globalAdminRestContext, tenantAlias, err => {
                assert.ok(!err);
                assert.ok(
                  _.findWhere(TenantsAPI.getNonInteractingTenants(), { alias: tenantAlias })
                );

                // Enable the tenant and ensure it comes back out of the list
                TenantsTestUtil.startTenantAndWait(globalAdminRestContext, tenantAlias, err => {
                  assert.ok(!err);
                  assert.ok(
                    !_.findWhere(TenantsAPI.getNonInteractingTenants(), { alias: tenantAlias })
                  );
                  return callback();
                });
              });
            });
          });
        }
      );
    });
  });

  describe('Tenant actions', () => {
    /**
     * Test that verifies that a tenant can not be created by an anonymous user
     */
    it('verify create tenant as anonymous user fails', callback => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantDescription = TestsUtil.generateRandomText();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      const tenantEmailDomain = TenantsTestUtil.generateTestTenantHost();

      // Try to create a tenant as an anonymous user
      TenantsTestUtil.createTenantAndWait(
        anonymousGlobalRestContext,
        tenantAlias,
        tenantDescription,
        tenantHost,
        null,
        err => {
          assert.ok(err);
          assert.strictEqual(err.code, 401);
          callback();
        }
      );
    });

    /**
     * Test that verifies that it is possible to create a new tenant
     */
    it('verify create tenant', callback => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantDescription = TestsUtil.generateRandomText();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();

      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        tenantAlias,
        tenantDescription,
        tenantHost,
        { countryCode: 'ca' },
        (err, tenant) => {
          assert.ok(!err);
          assert.ok(tenant);
          assert.strictEqual(tenant.alias, tenantAlias);
          assert.strictEqual(tenant.host, tenantHost.toLowerCase());
          assert.ok(_.isEmpty(tenant.emailDomains));
          assert.strictEqual(tenant.countryCode, 'CA');

          // Get the tenant
          const restContext = TestsUtil.createTenantRestContext(tenantHost);
          RestAPI.Tenants.getTenant(restContext, null, (err, tenant) => {
            assert.ok(!err);
            assert.ok(tenant);
            assert.strictEqual(tenant.alias, tenantAlias);
            assert.strictEqual(tenant.host, tenantHost.toLowerCase());
            assert.ok(_.isEmpty(tenant.emailDomains));
            assert.strictEqual(tenant.countryCode, 'CA');

            // Get the tenant by host
            tenant = TenantsAPI.getTenantByHost(tenantHost);
            assert.ok(tenant);
            assert.strictEqual(tenant.alias, tenantAlias);
            assert.strictEqual(tenant.host, tenantHost.toLowerCase());
            assert.ok(_.isEmpty(tenant.emailDomains));
            assert.strictEqual(tenant.countryCode, 'CA');
            return callback();
          });
        }
      );
    });

    /**
     * Test that verifies that creating a tenant needs an alias, a displayName and a host specified
     */
    it('verify create tenant validation', callback => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();

      // Try creating a tenant with no alias
      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        null,
        'AAR',
        tenantHost,
        null,
        err => {
          assert.ok(err);
          assert.strictEqual(err.code, 400);

          // Try creating a tenant with an invalid alias, using spaces in the alias
          TenantsTestUtil.createTenantAndWait(
            globalAdminRestContext,
            'American Academic of Religion',
            'AAR',
            tenantHost,
            null,
            err => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);

              // Try creating a tenant with an invalid alias, using a colon in the alias
              TenantsTestUtil.createTenantAndWait(
                globalAdminRestContext,
                'aar:test',
                'AAR',
                tenantHost,
                null,
                err => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 400);

                  // Try creating a tenant with an alias that's already taken
                  TenantsTestUtil.createTenantAndWait(
                    globalAdminRestContext,
                    'camtest',
                    'Cambridge University',
                    tenantHost,
                    null,
                    err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 400);

                      // Try creating a tenant with no displayName
                      TenantsTestUtil.createTenantAndWait(
                        globalAdminRestContext,
                        tenantAlias,
                        null,
                        tenantHost,
                        null,
                        err => {
                          assert.ok(err);
                          assert.strictEqual(err.code, 400);

                          // Try creating a tenant with no base URL
                          TenantsTestUtil.createTenantAndWait(
                            globalAdminRestContext,
                            tenantAlias,
                            'AAR',
                            null,
                            null,
                            err => {
                              assert.ok(err);
                              assert.strictEqual(err.code, 400);

                              // Try creating a tenant with an invalid hostname
                              TenantsTestUtil.createTenantAndWait(
                                globalAdminRestContext,
                                tenantAlias,
                                'Cambridge University',
                                'not a valid hostname',
                                null,
                                err => {
                                  assert.ok(err);
                                  assert.strictEqual(err.code, 400);

                                  // Try creating a tenant with a host name that's already taken
                                  TenantsTestUtil.createTenantAndWait(
                                    globalAdminRestContext,
                                    tenantAlias,
                                    'Cambridge University',
                                    'cambridge.oae.com',
                                    null,
                                    err => {
                                      assert.ok(err);
                                      assert.strictEqual(err.code, 400);

                                      // Try creating a tenant with an invalid country code
                                      TenantsTestUtil.createTenantAndWait(
                                        globalAdminRestContext,
                                        tenantAlias,
                                        'Cambridge University',
                                        tenantHost,
                                        { countryCode: 'ZZ' },
                                        err => {
                                          assert.ok(err);
                                          assert.strictEqual(err.code, 400);

                                          // Verify that the tenant does not exist
                                          const tenantRestContext = TestsUtil.createTenantRestContext(
                                            tenantHost
                                          );
                                          RestAPI.Tenants.getTenant(
                                            tenantRestContext,
                                            null,
                                            (err, tenant) => {
                                              assert.ok(err);
                                              assert.strictEqual(err.code, 418);
                                              assert.ok(!tenant);

                                              // Sanity check creating the tenant with our generated values and ensure the tenant exists after
                                              TenantsTestUtil.createTenantAndWait(
                                                globalAdminRestContext,
                                                tenantAlias,
                                                'Cambridge University',
                                                tenantHost,
                                                { countryCode: 'CA' },
                                                err => {
                                                  assert.ok(!err);
                                                  RestAPI.Tenants.getTenant(
                                                    tenantRestContext,
                                                    null,
                                                    (err, tenant) => {
                                                      assert.ok(!err);
                                                      assert.ok(tenant);

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
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies a tenant cannot be creating with an email domain expression that
     * conflicts with an existing email domain
     */
    it('verify cannot create tenant with conflicting email domain', callback => {
      const alias1 = TenantsTestUtil.generateTestTenantAlias();
      const host1 = TenantsTestUtil.generateTestTenantHost();
      const commonTld = TenantsTestUtil.generateTestTenantHost();
      const emailDomain1 = util.format('third.second.%s', commonTld);
      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        alias1,
        alias1,
        host1,
        { emailDomains: [emailDomain1] },
        err => {
          assert.ok(!err);

          // Conflicting domain that exactly matches an existing email domain
          const emailDomain1ExactConflict = emailDomain1;

          // Conflicting domain that is a suffix of an existing email domain
          const emailDomain1SuffixConflict1 = util.format('second.%s', commonTld);

          // Conflicting domain where there is an existing suffix
          const emailDomain1SuffixConflict2 = util.format('a.%s', emailDomain1);

          // Ensure exact match domain can't fall under the scope of the suffix
          const alias2 = TenantsTestUtil.generateTestTenantAlias();
          const host2 = TenantsTestUtil.generateTestTenantHost();
          TenantsTestUtil.createTenantAndWait(
            globalAdminRestContext,
            alias2,
            alias2,
            host2,
            { emailDomains: [emailDomain1ExactConflict] },
            err => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);
              TenantsTestUtil.createTenantAndWait(
                globalAdminRestContext,
                alias2,
                alias2,
                host2,
                { emailDomains: [emailDomain1SuffixConflict1] },
                err => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 400);
                  TenantsTestUtil.createTenantAndWait(
                    globalAdminRestContext,
                    alias2,
                    alias2,
                    host2,
                    { emailDomains: [emailDomain1SuffixConflict2] },
                    err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 400);

                      // Sanity check we can create a tenant with these values
                      TenantsTestUtil.createTenantAndWait(
                        globalAdminRestContext,
                        alias2,
                        alias2,
                        host2,
                        { emailDomains: [host2] },
                        err => {
                          assert.ok(!err);

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
     * Test that verifies a tenant cannot be created with one or more email domain expressions
     * that conflict with another tenant's existing email domain expressions
     */
    it('verify cannot create tenant with one or more conflicting email domains', callback => {
      const alias1 = TenantsTestUtil.generateTestTenantAlias();
      const host1 = TenantsTestUtil.generateTestTenantHost();
      const commonTld = TenantsTestUtil.generateTestTenantHost();
      const emailDomain1 = util.format('one.%s', commonTld);
      const emailDomain2 = util.format('two.%s', commonTld);
      const emailDomain3 = util.format('three.%s', commonTld);
      const emailDomain4 = util.format('four.%s', commonTld);
      const emailDomain5 = util.format('five.%s', commonTld);
      let opts = {
        emailDomains: [emailDomain1, emailDomain2, emailDomain3]
      };
      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        alias1,
        alias1,
        host1,
        opts,
        err => {
          assert.ok(!err);

          // Creating a tenant where 1 email domain conflicts should fail
          const alias2 = TenantsTestUtil.generateTestTenantAlias();
          const host2 = TenantsTestUtil.generateTestTenantHost();
          opts = {
            emailDomains: [emailDomain3, emailDomain4, emailDomain5]
          };
          TenantsTestUtil.createTenantAndWait(
            globalAdminRestContext,
            alias2,
            alias2,
            host2,
            opts,
            err => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);

              // Creating a tenant where multiple email domains conflict should fail
              opts = {
                emailDomains: [emailDomain2, emailDomain3, emailDomain5]
              };
              TenantsTestUtil.createTenantAndWait(
                globalAdminRestContext,
                alias2,
                alias2,
                host2,
                opts,
                err => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 400);

                  // Creating a tenant where 1 email domain suffix conflicts should fail
                  opts = {
                    emailDomains: [emailDomain4, emailDomain5, commonTld]
                  };
                  TenantsTestUtil.createTenantAndWait(
                    globalAdminRestContext,
                    alias2,
                    alias2,
                    host2,
                    opts,
                    err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 400);

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

    /**
     * Test that verifies that an uppercase host and email domain for a
     * tenant is lowercased and a tenant can be retrieved using an uppercase
     * host name or email domain
     */
    it('verify create and update tenant uppercase host and email domain', callback => {
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantDescription = TestsUtil.generateRandomText();
      const tenantHost = TestsUtil.generateRandomText().toUpperCase();
      const tenantHost2 = TestsUtil.generateRandomText().toUpperCase();

      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        tenantAlias,
        tenantDescription,
        tenantHost,
        { emailDomains: [tenantHost] },
        err => {
          assert.ok(!err);

          // Verify that the existing tenant is still running
          let uppercaseRestContext = TestsUtil.createTenantRestContext(tenantHost);
          RestAPI.Tenants.getTenant(uppercaseRestContext, null, (err, tenant) => {
            assert.ok(!err);
            assert.ok(tenant);
            assert.strictEqual(tenant.alias, tenantAlias);
            assert.strictEqual(tenant.host, tenantHost.toLowerCase());
            assert.strictEqual(tenant.emailDomains[0], tenantHost.toLowerCase());

            // Verify we can get the tenant by email match
            let tenantByEmailMatch = TenantsAPI.getTenantByEmail(tenantHost);
            assert.ok(tenantByEmailMatch);
            assert.strictEqual(tenantByEmailMatch.alias, tenantAlias);
            assert.strictEqual(tenantByEmailMatch.host, tenantHost.toLowerCase());
            assert.strictEqual(tenantByEmailMatch.emailDomains[0], tenantHost.toLowerCase());

            // Update the tenant, ensuring that the host and email
            // domain remain lower case
            TenantsTestUtil.updateTenantAndWait(
              globalAdminRestContext,
              tenantAlias,
              { host: tenantHost2, emailDomains: [tenantHost2] },
              (err, updatedTenant) => {
                assert.ok(!err);

                uppercaseRestContext = TestsUtil.createTenantRestContext(tenantHost2);
                RestAPI.Tenants.getTenant(uppercaseRestContext, null, (err, tenant2) => {
                  assert.ok(!err);
                  assert.ok(tenant2);
                  assert.strictEqual(tenant2.alias, tenantAlias);
                  assert.strictEqual(tenant2.host, tenantHost2.toLowerCase());
                  assert.strictEqual(tenant2.emailDomains[0], tenantHost2.toLowerCase());

                  // Verify we can still get the tenant by email domain
                  // match
                  tenantByEmailMatch = TenantsAPI.getTenantByEmail(tenantHost2);
                  assert.ok(tenantByEmailMatch);
                  assert.strictEqual(tenantByEmailMatch.alias, tenantAlias);
                  assert.strictEqual(tenantByEmailMatch.host, tenantHost2.toLowerCase());
                  assert.strictEqual(tenantByEmailMatch.emailDomains[0], tenantHost2.toLowerCase());

                  tenantByEmailMatch = TenantsAPI.getTenantByEmail(tenantHost2.toLowerCase());
                  assert.ok(tenantByEmailMatch);
                  assert.strictEqual(tenantByEmailMatch.alias, tenantAlias);
                  assert.strictEqual(tenantByEmailMatch.host, tenantHost2.toLowerCase());
                  assert.strictEqual(tenantByEmailMatch.emailDomains[0], tenantHost2.toLowerCase());

                  return callback();
                });
              }
            );
          });
        }
      );
    });

    /**
     * Test that verifies that an uppercase alias for a tenant is lowercased
     */
    it('verify create tenant uppercase alias', callback => {
      const tenantAlias = TestsUtil.generateRandomText().toUpperCase();
      const tenantDescription = TestsUtil.generateRandomText();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();

      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        tenantAlias,
        tenantDescription,
        tenantHost,
        null,
        err => {
          assert.ok(!err);

          const uppercaseRestContext = TestsUtil.createTenantRestContext(tenantHost);
          RestAPI.Tenants.getTenant(uppercaseRestContext, null, (err, tenant) => {
            assert.ok(!err);
            assert.ok(tenant);
            assert.strictEqual(tenant.alias, tenantAlias.toLowerCase());
            assert.strictEqual(tenant.host, tenantHost.toLowerCase());
            callback();
          });
        }
      );
    });

    /**
     * Test that verifies that a tenant cannot be created with a duplicate alias
     */
    it('verify create tenant duplicate alias', callback => {
      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        'camtest',
        'AAR',
        'camtest.oae.com',
        null,
        err => {
          assert.ok(err);
          assert.strictEqual(err.code, 400);

          // Verify that the existing tenant is still running
          RestAPI.Tenants.getTenant(anonymousCamRestContext, null, (err, tenant) => {
            assert.ok(!err);
            assert.ok(tenant);
            assert.strictEqual(tenant.alias, 'camtest');
            assert.strictEqual(tenant.host, 'cambridge.oae.com');
            callback();
          });
        }
      );
    });

    /**
     * Test that verifies that a tenant cannot be created with a duplicate host
     */
    it('verify create tenant duplicate host', callback => {
      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        'angliaruskin',
        'Anglia Ruskin University',
        'cambridge.oae.com',
        null,
        err => {
          assert.ok(err);
          assert.strictEqual(err.code, 400);

          // Verify that the tenant with that hostname is still running
          RestAPI.Tenants.getTenant(anonymousCamRestContext, null, (err, tenant) => {
            assert.ok(!err);
            assert.ok(tenant);
            assert.strictEqual(tenant.alias, 'camtest');
            assert.strictEqual(tenant.host, 'cambridge.oae.com');
            callback();
          });
        }
      );
    });

    /**
     * Test that verifies that creating a tenant with the same hostname as the configured Shibboleth SP host is not allowed
     */
    it('verify creating a tenant with the Shibboleth SP host as hostname is not allowed', callback => {
      const spHost = ShibbolethAPI.getSPHost();
      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        Math.random(),
        'bladiebla',
        spHost,
        null,
        err => {
          assert.ok(err);
          assert.strictEqual(err.code, 400);
          TenantsTestUtil.createTenantAndWait(
            globalAdminRestContext,
            Math.random(),
            'bladiebla',
            spHost.toUpperCase(),
            null,
            err => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);
              return callback();
            }
          );
        }
      );
    });

    /**
     * Test that verifies that creating a tenant with an alias that contains a dash does not
     * break the authentication strategy data of the `me` feed. This is a regression test for
     * https://github.com/oaeproject/Hilary/issues/1172
     */
    it('verify creating a tenant with a dash in the alias does not break authentication strategy', callback => {
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      const tenantAlias = 'test-with-dash';
      TestsUtil.createTenantWithAdmin(
        'alias-with-dash',
        tenantHost,
        (err, tenant, tenantAdminRestContext) => {
          assert.ok(!err);
          TestsUtil.generateTestUsers(tenantAdminRestContext, 1, (err, users, mrvisser) => {
            // Ensure the tenant admin's me object properly represents the authentication
            // strategy
            RestAPI.User.getMe(tenantAdminRestContext, (err, me) => {
              assert.ok(!err);
              assert.strictEqual(me.isTenantAdmin, true);
              assert.strictEqual(me.authenticationStrategy, 'local');

              // Ensure the regular user's me object properly represents the
              // authentication strategy
              RestAPI.User.getMe(mrvisser.restContext, (err, me) => {
                assert.ok(!err);
                assert.ok(!me.anon);
                assert.strictEqual(me.authenticationStrategy, 'local');
                return callback();
              });
            });
          });
        }
      );
    });

    /**
     * Test that verifies that a tenant can be stopped
     */
    it('verify stop tenant', callback => {
      // Create a new tenant
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      TestsUtil.createTenantWithAdmin(
        tenantAlias,
        tenantHost,
        (err, testTenant, tenantAdminRestContext) => {
          const restContext = TestsUtil.createTenantRestContext(testTenant.host);

          // Verify that the tenant is running
          RestAPI.Tenants.getTenant(restContext, null, (err, tenant) => {
            assert.ok(!err);
            assert.ok(tenant);
            assert.strictEqual(tenant.alias, testTenant.alias);

            // Verify it's in the list of running tenant aliases
            assert.ok(TenantsAPI.getTenants(true)[testTenant.alias]);

            // Create users so we can verify they get disabled too
            TestsUtil.generateTestUsers(
              tenantAdminRestContext,
              3,
              (err, users, user1, user2, user3) => {
                assert.ok(!err);

                // Stop the tenant
                TenantsTestUtil.stopTenantAndWait(globalAdminRestContext, testTenant.alias, err => {
                  assert.ok(!err);

                  // Verify that the tenant is no longer running
                  RestAPI.Tenants.getTenant(restContext, null, (err, tenant) => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 503);
                    assert.ok(!tenant);

                    // Verify it is no longer in the list of running tenant aliases
                    assert.ok(!TenantsAPI.getTenants(true)[testTenant.alias]);
                    // Verify it is in the list of disabled tenant aliases
                    assert.ok(TenantsAPI.getTenants()[testTenant.alias]);
                    assert.strictEqual(TenantsAPI.getTenants()[testTenant.alias].active, false);

                    // Verify that it's still part of the all tenants feed
                    RestAPI.Tenants.getTenants(globalAdminRestContext, (err, tenants) => {
                      assert.ok(!err);
                      assert.ok(tenants);
                      assert.ok(tenants[testTenant.alias]);
                      assert.strictEqual(tenants[testTenant.alias].host, testTenant.host);
                      assert.strictEqual(tenants[testTenant.alias].active, false);

                      // Verify the users got disabled too
                      PrincipalsDAO.getPrincipal(user1.user.id, (err, principal1) => {
                        assert.ok(!err);
                        assert.ok(!_.isUndefined(principal1.deleted));
                        assert.ok(principal1.deleted > 0);

                        PrincipalsDAO.getPrincipal(user2.user.id, (err, principal2) => {
                          assert.ok(!err);
                          assert.ok(!_.isUndefined(principal2.deleted));
                          assert.ok(principal2.deleted > 0);

                          PrincipalsDAO.getPrincipal(user3.user.id, (err, principal3) => {
                            assert.ok(!err);
                            assert.ok(!_.isUndefined(principal3.deleted));
                            assert.ok(principal3.deleted > 0);

                            return callback();
                          });
                        });
                      });
                    });
                  });
                });
              }
            );
          });
        }
      );
    });

    /**
     * Test that verifies that a tenant can not be stopped by an anonymous user
     */
    it('verify stop tenant as anonymous user fails', callback => {
      // Create a tenant to try and stop
      TenantsTestUtil.generateTestTenants(globalAdminRestContext, 1, testTenant => {
        // Try to stop the tenant as an anonymous user
        RestAPI.Tenants.stopTenant(anonymousGlobalRestContext, testTenant.alias, err => {
          assert.ok(err);
          assert.strictEqual(err.code, 401);

          // Sanity check that global admin can stop the tenant
          TenantsTestUtil.stopTenantAndWait(globalAdminRestContext, testTenant.alias, err => {
            assert.ok(!err);
            return callback();
          });
        });
      });
    });

    /**
     * Test that verifes that a non-existing tenant cannot be stopped
     */
    it('verify stop non-existing tenant', callback => {
      // Stop tenant with no alias
      RestAPI.Tenants.stopTenant(globalAdminRestContext, null, err => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);

        // Stop tenant with non-existing alias
        RestAPI.Tenants.stopTenant(globalAdminRestContext, TestsUtil.generateRandomText(), err => {
          assert.ok(err);
          assert.strictEqual(err.code, 404);

          return callback();
        });
      });
    });

    /**
     * Test that verifies that a stopped tenant can be started
     */
    it('verify start tenant', callback => {
      // Generate a tenant to stop and start
      // TenantsTestUtil.generateTestTenants(globalAdminRestContext, 1, function(testTenant) {
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      TestsUtil.createTenantWithAdmin(
        tenantAlias,
        tenantHost,
        (err, testTenant, tenantAdminRestContext) => {
          // Create users so we can verify they get disabled and then re-enabled too
          TestsUtil.generateTestUsers(
            tenantAdminRestContext,
            3,
            (err, users, user1, user2, user3) => {
              assert.ok(!err);

              // Stop the tenant
              TenantsTestUtil.stopTenantAndWait(globalAdminRestContext, testTenant.alias, err => {
                assert.ok(!err);

                // Verify that the tenant has indeed stopped
                const restContext = TestsUtil.createTenantRestContext(testTenant.host);
                RestAPI.Tenants.getTenant(restContext, null, (err, tenant) => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 503);

                  // Now start the tenant
                  TenantsTestUtil.startTenantAndWait(
                    globalAdminRestContext,
                    testTenant.alias,
                    err => {
                      assert.ok(!err);

                      // Verify that the tenant has indeed been started
                      RestAPI.Tenants.getTenant(restContext, null, (err, tenant) => {
                        assert.ok(!err);
                        assert.strictEqual(tenant.alias, testTenant.alias);
                        assert.strictEqual(tenant.active, true);

                        // Verify the users got re-enabled too
                        PrincipalsDAO.getPrincipal(user1.user.id, (err, principal1) => {
                          assert.ok(!err);
                          assert.ok(_.isUndefined(principal1.deleted));

                          PrincipalsDAO.getPrincipal(user2.user.id, (err, principal2) => {
                            assert.ok(!err);
                            assert.ok(_.isUndefined(principal2.deleted));

                            PrincipalsDAO.getPrincipal(user3.user.id, (err, principal3) => {
                              assert.ok(!err);
                              assert.ok(_.isUndefined(principal3.deleted));

                              return callback();
                            });
                          });
                        });
                      });
                    }
                  );
                });
              });
            }
          );
        }
      );
    });

    /**
     * Test that verifies that a tenant can not be started by an anonymous user
     */
    it('verify start tenant as anonymous user fails', callback => {
      TenantsTestUtil.generateTestTenants(globalAdminRestContext, 1, testTenant => {
        // Stop the tenant
        TenantsTestUtil.stopTenantAndWait(globalAdminRestContext, testTenant.alias, err => {
          assert.ok(!err);

          // Try to start the tenant as an anonymous user
          RestAPI.Tenants.startTenant(anonymousGlobalRestContext, testTenant.alias, err => {
            assert.ok(err);
            assert.strictEqual(err.code, 401);

            // Ensure the tenant is still stopped
            RestAPI.Tenants.getTenant(globalAdminRestContext, testTenant.alias, (err, tenant) => {
              assert.ok(!err);
              assert.strictEqual(tenant.alias, testTenant.alias);
              assert.strictEqual(tenant.active, false);

              // Sanity check that global admin can start the tenant
              TenantsTestUtil.startTenantAndWait(globalAdminRestContext, testTenant.alias, err => {
                assert.ok(!err);
                return callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifes that a non-existing tenant cannot be started
     */
    it('verify start non-existing tenant', callback => {
      // Start tenant with no alias
      RestAPI.Tenants.startTenant(globalAdminRestContext, null, err => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);

        // Start tenant with non-existing alias
        RestAPI.Tenants.startTenant(globalAdminRestContext, TestsUtil.generateRandomText(), err => {
          assert.ok(err);
          assert.strictEqual(err.code, 404);
          return callback();
        });
      });
    });
  });

  describe('Update tenant', () => {
    /**
     * Test that verifies that a tenant's displayName can not be updated by an anonymous user or non-admin user
     */
    it('verify update tenant as non-admin user', callback => {
      // Try to update the tenant's display name as an anonymous user on the global admin tenant
      RestAPI.Tenants.updateTenant(
        anonymousGlobalRestContext,
        'camtest',
        { displayName: 'Anglia Ruskin University' },
        err => {
          assert.ok(err);
          assert.strictEqual(err.code, 401);

          // Try to update the tenant's host as an anonymous user on the global admin tenant
          RestAPI.Tenants.updateTenant(
            anonymousGlobalRestContext,
            'camtest',
            { host: 'newcamtest.oae.com' },
            err => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);

              // Try to update tenant's display name and host as an anonymous user on the global admin tenant
              RestAPI.Tenants.updateTenant(
                anonymousGlobalRestContext,
                'camtest',
                { displayName: 'Anglia Ruskin University', host: 'newcamtest.oae.com' },
                err => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 401);

                  // Try to update the tenant's display name as an anonymous user on a user tenant
                  RestAPI.Tenants.updateTenant(
                    anonymousCamRestContext,
                    null,
                    { displayName: 'Anglia Ruskin University' },
                    err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 401);

                      // Try to update the tenant's host as an anonymous user on a user tenant
                      RestAPI.Tenants.updateTenant(
                        anonymousCamRestContext,
                        null,
                        { host: 'newcamtest.oae.com' },
                        err => {
                          assert.ok(err);
                          assert.strictEqual(err.code, 401);

                          // Try to update tenant's display name and host as an anonymous user on a user tenant
                          RestAPI.Tenants.updateTenant(
                            anonymousCamRestContext,
                            null,
                            { displayName: 'Anglia Ruskin University', host: 'newcamtest.oae.com' },
                            err => {
                              assert.ok(err);
                              assert.strictEqual(err.code, 401);

                              // Create a regular non-admin user
                              TestsUtil.generateTestUsers(
                                camAdminRestContext,
                                1,
                                (err, users, john) => {
                                  assert.ok(!err);

                                  // Try to update the tenant's display name as a non-admin user on a user tenant
                                  RestAPI.Tenants.updateTenant(
                                    john.restContext,
                                    null,
                                    { displayName: 'Anglia Ruskin University' },
                                    err => {
                                      assert.ok(err);
                                      assert.strictEqual(err.code, 401);

                                      // Try to update the tenant's host as a non-admin user on a user tenant
                                      RestAPI.Tenants.updateTenant(
                                        john.restContext,
                                        null,
                                        { host: 'newcamtest.oae.com' },
                                        err => {
                                          assert.ok(err);
                                          assert.strictEqual(err.code, 401);

                                          // Try to update tenant's display name and host as a non-admin user on a user tenant
                                          RestAPI.Tenants.updateTenant(
                                            john.restContext,
                                            null,
                                            {
                                              displayName: 'Anglia Ruskin University',
                                              host: 'newcamtest.oae.com'
                                            },
                                            err => {
                                              assert.ok(err);
                                              assert.strictEqual(err.code, 401);
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
        }
      );
    });

    /**
     * Test that verifies that a tenant can only be updated when at least 1 correct update value has been supplied
     */
    it('verify update tenant validation', callback => {
      // Verify through the global admin tenant
      RestAPI.Tenants.updateTenant(globalAdminRestContext, 'camtest', null, err => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);
        // Verify update with an invalid property
        RestAPI.Tenants.updateTenant(
          globalAdminRestContext,
          'camtest',
          { alias: 'foobar' },
          err => {
            assert.ok(err);
            assert.strictEqual(err.code, 400);

            // Verify through a user tenant
            RestAPI.Tenants.updateTenant(camAdminRestContext, null, null, err => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);
              // Verify update with an invalid property
              RestAPI.Tenants.updateTenant(camAdminRestContext, null, { alias: 'foobar' }, err => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);

                // Verify updating to host that's already used
                RestAPI.Tenants.updateTenant(
                  camAdminRestContext,
                  null,
                  { host: 'caMBriDGe.oae.com' },
                  err => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 400);

                    // Verify updating with an invalid host
                    RestAPI.Tenants.updateTenant(
                      globalAdminRestContext,
                      'camtest',
                      { host: 'an invalid hostname' },
                      err => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 400);

                        // Verify updating with an invalid email domains
                        RestAPI.Tenants.updateTenant(
                          globalAdminRestContext,
                          'camtest',
                          { emailDomains: ['an invalid email domain'] },
                          err => {
                            assert.ok(err);
                            assert.strictEqual(err.code, 400);

                            // Verify updating with a set of badly serialized email domains
                            RestAPI.Tenants.updateTenant(
                              globalAdminRestContext,
                              'camtest',
                              { emailDomains: ['foo.test.com,bar.test.com'] },
                              err => {
                                assert.ok(err);
                                assert.strictEqual(err.code, 400);

                                // Verify updating a non-existing tenant fails
                                RestAPI.Tenants.updateTenant(
                                  globalAdminRestContext,
                                  TestsUtil.generateRandomText(),
                                  { displayName: "I'm totally legit..." },
                                  err => {
                                    assert.ok(err);
                                    assert.strictEqual(err.code, 404);

                                    // Verify updating country code to an invalid value
                                    RestAPI.Tenants.updateTenant(
                                      camAdminRestContext,
                                      null,
                                      { countryCode: 'ZZ' },
                                      err => {
                                        assert.ok(err);
                                        assert.strictEqual(err.code, 400);

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
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that updating a tenant's email domain updates the email domain index accordingly
     */
    it('verify updating email domains', callback => {
      const commonTld = TenantsTestUtil.generateTestTenantHost();
      const emailDomain1 = util.format('one.%s', commonTld).toLowerCase();
      const emailDomain2 = util.format('two.%s', commonTld).toLowerCase();
      const emailDomain3 = util.format('three.%s', commonTld).toLowerCase();
      const emailDomain4 = util.format('four.%s', commonTld).toLowerCase();
      const emailDomain5 = util.format('five.%s', commonTld).toLowerCase();

      const alias1 = TenantsTestUtil.generateTestTenantAlias();
      const host1 = TenantsTestUtil.generateTestTenantHost();

      // Create a tenant
      TestsUtil.createTenantWithAdmin(alias1, host1, (err, tenant, tenantAdminRestContext) => {
        assert.ok(!err);

        // Set multiple email domains
        let update = {
          emailDomains: [emailDomain1, emailDomain2, emailDomain3].sort()
        };
        TenantsTestUtil.updateTenantAndWait(globalAdminRestContext, tenant.alias, update, err => {
          assert.ok(!err);
          RestAPI.Tenants.getTenant(globalAdminRestContext, tenant.alias, (err, tenant) => {
            assert.ok(!err);
            assert.deepStrictEqual(tenant.emailDomains.sort(), update.emailDomains);

            // Set 1 email domain
            update = {
              emailDomains: [emailDomain1]
            };
            TenantsTestUtil.updateTenantAndWait(
              globalAdminRestContext,
              tenant.alias,
              update,
              err => {
                assert.ok(!err);
                RestAPI.Tenants.getTenant(globalAdminRestContext, tenant.alias, (err, tenant) => {
                  assert.ok(!err);
                  assert.deepStrictEqual(tenant.emailDomains, update.emailDomains);

                  // Ensure the other email domains can now be used to create a second tenant
                  const alias2 = TenantsTestUtil.generateTestTenantAlias();
                  const host2 = TenantsTestUtil.generateTestTenantHost();
                  const opts = {
                    emailDomains: [emailDomain2, emailDomain3].sort()
                  };
                  TenantsTestUtil.createTenantAndWait(
                    globalAdminRestContext,
                    alias2,
                    alias2,
                    host2,
                    opts,
                    (err, secondTenant) => {
                      assert.ok(!err);
                      assert.deepStrictEqual(secondTenant.emailDomains.sort(), opts.emailDomains);

                      // Unset the email domains
                      update = {
                        emailDomains: ''
                      };
                      TenantsTestUtil.updateTenantAndWait(
                        globalAdminRestContext,
                        tenant.alias,
                        update,
                        err => {
                          assert.ok(!err);
                          RestAPI.Tenants.getTenant(
                            globalAdminRestContext,
                            tenant.alias,
                            (err, tenant) => {
                              assert.ok(!err);
                              assert.strictEqual(tenant.emailDomains.length, 0);

                              // The unset email domain can now be added to another tenant
                              update = {
                                emailDomains: [emailDomain1, emailDomain2, emailDomain3].sort()
                              };
                              TenantsTestUtil.updateTenantAndWait(
                                globalAdminRestContext,
                                secondTenant.alias,
                                update,
                                err => {
                                  assert.ok(!err);
                                  RestAPI.Tenants.getTenant(
                                    globalAdminRestContext,
                                    secondTenant.alias,
                                    (err, secondTenant) => {
                                      assert.ok(!err);
                                      assert.deepStrictEqual(
                                        secondTenant.emailDomains.sort(),
                                        update.emailDomains
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
                });
              }
            );
          });
        });
      });
    });

    /**
     * Test that verifies updating email domains associated to a tenant
     */
    it('verify update email domains validation', callback => {
      const commonTld = TenantsTestUtil.generateTestTenantHost();
      const emailDomain1 = util.format('third.second.%s', commonTld);
      const emailDomain2 = util.format('anotherthird.anothersecond.%s', commonTld);

      const alias1 = TenantsTestUtil.generateTestTenantAlias();
      const host1 = TenantsTestUtil.generateTestTenantHost();
      const alias2 = TenantsTestUtil.generateTestTenantAlias();
      const host2 = TenantsTestUtil.generateTestTenantHost();

      // Create 2 tenants that we can use to conflict with one another's email domains
      TestsUtil.createTenantWithAdmin(alias1, host1, (err, tenant, tenantAdminRestContext) => {
        assert.ok(!err);
        TestsUtil.createTenantWithAdmin(alias2, host2, err => {
          assert.ok(!err);

          // Conflicting email domain where the exact match equals existing emailDomain1
          const emailDomain1ExactConflict = emailDomain1;

          // Conflicting email domain that is a suffix of existing emailDomain1
          const emailDomain1SuffixConflict1 = util.format('second.%s', commonTld);

          // Conflicting email domain that is suffixed by an existing emailDomain1
          const emailDomain1SuffixConflict2 = util.format('a.%s', emailDomain1);

          // Conflicting email domain that is a suffix of existing emailDomain2
          const emailDomain2SuffixConflict1 = util.format('anothersecond.%s', commonTld);

          // Conflicting email domain that is suffixed by an existing emailDomain2
          const emailDomain2SuffixConflict2 = util.format('a.%s', emailDomain2);

          // Ensure only global admin can update email domain
          RestAPI.Tenants.updateTenant(
            tenantAdminRestContext,
            null,
            { emailDomains: [emailDomain1] },
            err => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);
              TenantsTestUtil.updateTenantAndWait(
                globalAdminRestContext,
                alias1,
                { emailDomains: [emailDomain1] },
                err => {
                  assert.ok(!err);

                  // Ensure we can't set an email domain for tenant 2 that conflicts with tenant1
                  RestAPI.Tenants.updateTenant(
                    globalAdminRestContext,
                    alias2,
                    { emailDomains: [emailDomain1ExactConflict] },
                    err => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 400);
                      RestAPI.Tenants.updateTenant(
                        globalAdminRestContext,
                        alias2,
                        { emailDomains: [emailDomain1SuffixConflict1] },
                        err => {
                          assert.ok(err);
                          assert.strictEqual(err.code, 400);
                          RestAPI.Tenants.updateTenant(
                            globalAdminRestContext,
                            alias2,
                            { emailDomains: [emailDomain1SuffixConflict2] },
                            err => {
                              assert.ok(err);
                              assert.strictEqual(err.code, 400);

                              // Update tenant 2 to an email domain that doesn't conflict
                              TenantsTestUtil.updateTenantAndWait(
                                globalAdminRestContext,
                                alias2,
                                { emailDomains: [emailDomain2] },
                                err => {
                                  assert.ok(!err);

                                  // Ensure we can update tenant 1's email domain to conflict with itself
                                  TenantsTestUtil.updateTenantAndWait(
                                    globalAdminRestContext,
                                    alias1,
                                    { emailDomains: [emailDomain1SuffixConflict1] },
                                    err => {
                                      assert.ok(!err);

                                      // Ensure we can't update tenant1's email domain to conflict with tenant 2's
                                      RestAPI.Tenants.updateTenant(
                                        globalAdminRestContext,
                                        alias1,
                                        { emailDomains: [emailDomain2SuffixConflict1] },
                                        err => {
                                          assert.ok(err);
                                          assert.strictEqual(err.code, 400);
                                          RestAPI.Tenants.updateTenant(
                                            globalAdminRestContext,
                                            alias1,
                                            { emailDomains: [emailDomain2SuffixConflict2] },
                                            err => {
                                              assert.ok(err);
                                              assert.strictEqual(err.code, 400);

                                              // Sanity check that the email domains are now set to what we would expect
                                              RestAPI.Tenants.getTenant(
                                                tenantAdminRestContext,
                                                null,
                                                (err, tenant) => {
                                                  assert.ok(!err);
                                                  assert.strictEqual(
                                                    tenant.emailDomains[0],
                                                    emailDomain1SuffixConflict1.toLowerCase()
                                                  );
                                                  RestAPI.Tenants.getTenant(
                                                    globalAdminRestContext,
                                                    alias2,
                                                    (err, tenant) => {
                                                      assert.ok(!err);
                                                      assert.strictEqual(
                                                        tenant.emailDomains[0],
                                                        emailDomain2.toLowerCase()
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
     * Test that verifies that a tenant displayName can be updated
     */
    it('verify update tenant', callback => {
      const tenant1Alias = TenantsTestUtil.generateTestTenantAlias();
      const tenant1Host = TenantsTestUtil.generateTestTenantHost();
      const tenant2Host = TenantsTestUtil.generateTestTenantHost();
      const tenant3Host = TenantsTestUtil.generateTestTenantHost();
      const tenant4Host = TenantsTestUtil.generateTestTenantHost();
      const tenant4Description = TestsUtil.generateRandomText();

      // Update the tenant display name as the global admin
      TenantsTestUtil.updateTenantAndWait(
        globalAdminRestContext,
        'camtest',
        { displayName: 'Anglia Ruskin University' },
        err => {
          assert.ok(!err);

          // Check if the update was successful
          RestAPI.Tenants.getTenant(camAdminRestContext, null, (err, tenant) => {
            assert.ok(!err);
            assert.ok(tenant);
            assert.strictEqual(tenant.alias, 'camtest');
            assert.strictEqual(tenant.host, 'cambridge.oae.com');
            assert.strictEqual(tenant.displayName, 'Anglia Ruskin University');

            // Update the tenant display name as the tenant admin
            TenantsTestUtil.updateTenantAndWait(
              camAdminRestContext,
              null,
              { displayName: 'Queens College' },
              err => {
                assert.ok(!err);

                // Check if the update was successful
                RestAPI.Tenants.getTenant(camAdminRestContext, null, (err, tenant) => {
                  assert.ok(!err);
                  assert.ok(tenant);
                  assert.strictEqual(tenant.alias, 'camtest');
                  assert.strictEqual(tenant.host, 'cambridge.oae.com');
                  assert.strictEqual(tenant.displayName, 'Queens College');

                  // Update the tenant host as the global admin
                  TenantsTestUtil.updateTenantAndWait(
                    globalAdminRestContext,
                    'camtest',
                    { host: tenant1Host },
                    err => {
                      assert.ok(!err);

                      // Check if the update was successful.
                      // The old host name should no longer be accepting requests
                      RestAPI.Tenants.getTenant(camAdminRestContext, null, (err, tenant) => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 418);

                        // The new host name should now be responding to requests
                        const tenant1AdminRestContext = TestsUtil.createTenantAdminRestContext(
                          tenant1Host
                        );
                        RestAPI.Tenants.getTenant(tenant1AdminRestContext, null, (err, tenant) => {
                          assert.ok(!err);
                          assert.ok(tenant);
                          assert.strictEqual(tenant.alias, 'camtest');
                          assert.strictEqual(tenant.host, tenant1Host.toLowerCase());
                          assert.strictEqual(tenant.displayName, 'Queens College');

                          // Update the tenant host to have uppercase characters
                          TenantsTestUtil.updateTenantAndWait(
                            globalAdminRestContext,
                            'camtest',
                            { host: tenant2Host.toUpperCase() },
                            err => {
                              assert.ok(!err);

                              // Check if the update was successful
                              // The host name should come back changed but lowercased
                              const tenant2UpperCaseAdminRestContext = TestsUtil.createTenantAdminRestContext(
                                tenant2Host.toUpperCase()
                              );
                              RestAPI.Tenants.getTenant(
                                tenant2UpperCaseAdminRestContext,
                                null,
                                (err, tenant) => {
                                  assert.ok(!err);
                                  assert.ok(tenant);
                                  assert.strictEqual(tenant.alias, 'camtest');
                                  assert.strictEqual(tenant.host, tenant2Host.toLowerCase());
                                  assert.strictEqual(tenant.displayName, 'Queens College');

                                  // Update the tenant host as the tenant admin
                                  TenantsTestUtil.updateTenantAndWait(
                                    tenant2UpperCaseAdminRestContext,
                                    null,
                                    { host: tenant3Host },
                                    err => {
                                      assert.ok(!err);

                                      // Check if the update was successful.
                                      // The old host name should no longer be accepting requests
                                      RestAPI.Tenants.getTenant(
                                        tenant2UpperCaseAdminRestContext,
                                        null,
                                        (err, tenant) => {
                                          assert.ok(err);
                                          assert.strictEqual(err.code, 418);
                                          // The new host name should now be responding to requests
                                          const tenant3AdminRestContext = TestsUtil.createTenantAdminRestContext(
                                            tenant3Host
                                          );
                                          RestAPI.Tenants.getTenant(
                                            tenant3AdminRestContext,
                                            null,
                                            (err, tenant) => {
                                              assert.ok(!err);
                                              assert.ok(tenant);
                                              assert.strictEqual(tenant.alias, 'camtest');
                                              assert.strictEqual(
                                                tenant.host,
                                                tenant3Host.toLowerCase()
                                              );
                                              assert.strictEqual(
                                                tenant.displayName,
                                                'Queens College'
                                              );

                                              // Update the tenant display name and host as the tenant admin
                                              TenantsTestUtil.updateTenantAndWait(
                                                tenant3AdminRestContext,
                                                null,
                                                {
                                                  displayName: tenant4Description,
                                                  host: tenant4Host
                                                },
                                                err => {
                                                  assert.ok(!err);

                                                  // Check if the update was successful.
                                                  // The old host name should no longer be accepting requests
                                                  RestAPI.Tenants.getTenant(
                                                    tenant3AdminRestContext,
                                                    null,
                                                    (err, tenant) => {
                                                      assert.ok(err);
                                                      assert.strictEqual(err.code, 418);
                                                      // The new host name should now be responding to requests
                                                      const tenant4AdminRestContext = TestsUtil.createTenantAdminRestContext(
                                                        tenant4Host
                                                      );
                                                      RestAPI.Tenants.getTenant(
                                                        tenant4AdminRestContext,
                                                        null,
                                                        (err, tenant) => {
                                                          assert.ok(!err);
                                                          assert.ok(tenant);
                                                          assert.strictEqual(
                                                            tenant.alias,
                                                            'camtest'
                                                          );
                                                          assert.strictEqual(
                                                            tenant.host,
                                                            tenant4Host.toLowerCase()
                                                          );
                                                          assert.strictEqual(
                                                            tenant.displayName,
                                                            tenant4Description
                                                          );

                                                          // Update the tenant display name and host as the tenant admin
                                                          TenantsTestUtil.updateTenantAndWait(
                                                            tenant4AdminRestContext,
                                                            null,
                                                            {
                                                              displayName:
                                                                'Cambridge University Test',
                                                              host: 'cambridge.oae.com'
                                                            },
                                                            err => {
                                                              assert.ok(!err);

                                                              // Check if the update was successful
                                                              // The old host name should no longer be accepting requests
                                                              RestAPI.Tenants.getTenant(
                                                                tenant4AdminRestContext,
                                                                null,
                                                                (err, tenant) => {
                                                                  assert.ok(err);
                                                                  assert.strictEqual(err.code, 418);

                                                                  // The new host name should now be responding to requests
                                                                  RestAPI.Tenants.getTenant(
                                                                    camAdminRestContext,
                                                                    null,
                                                                    (err, tenant) => {
                                                                      assert.ok(!err);
                                                                      assert.ok(tenant);
                                                                      assert.strictEqual(
                                                                        tenant.alias,
                                                                        'camtest'
                                                                      );
                                                                      assert.strictEqual(
                                                                        tenant.host,
                                                                        'cambridge.oae.com'
                                                                      );
                                                                      assert.strictEqual(
                                                                        tenant.displayName,
                                                                        'Cambridge University Test'
                                                                      );

                                                                      // Update the country code, ensuring it changed
                                                                      TenantsTestUtil.updateTenantAndWait(
                                                                        camAdminRestContext,
                                                                        null,
                                                                        { countryCode: 'ca' },
                                                                        err => {
                                                                          RestAPI.Tenants.getTenant(
                                                                            camAdminRestContext,
                                                                            null,
                                                                            (err, tenant) => {
                                                                              assert.ok(!err);
                                                                              assert.strictEqual(
                                                                                tenant.countryCode,
                                                                                'CA'
                                                                              );

                                                                              // Unset the country code, ensuring it changed
                                                                              TenantsTestUtil.updateTenantAndWait(
                                                                                camAdminRestContext,
                                                                                null,
                                                                                { countryCode: '' },
                                                                                err => {
                                                                                  RestAPI.Tenants.getTenant(
                                                                                    camAdminRestContext,
                                                                                    null,
                                                                                    (
                                                                                      err,
                                                                                      tenant
                                                                                    ) => {
                                                                                      assert.ok(
                                                                                        !err
                                                                                      );
                                                                                      assert.ok(
                                                                                        !tenant.countryCode
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
                    }
                  );
                });
              }
            );
          });
        }
      );
    });

    /**
     * Test that verifies that updating a tenant's hostname to the Shibboleth SP host is not allowed
     */
    it("verify updating a tenant's hostname to the Shibboleth SP host is not allowed", callback => {
      // Create a tenant
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantDescription = TestsUtil.generateRandomText();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        tenantAlias,
        tenantDescription,
        tenantHost,
        null,
        err => {
          assert.ok(!err);

          // Updating the hostname to the SP hostname should fail
          const spHost = ShibbolethAPI.getSPHost();
          RestAPI.Tenants.updateTenant(
            globalAdminRestContext,
            tenantAlias,
            { host: spHost },
            err => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);

              // Updating the hostname to any case of the SP hostname should fail
              RestAPI.Tenants.updateTenant(
                globalAdminRestContext,
                tenantAlias,
                { host: spHost.toUpperCase() },
                err => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 400);
                  return callback();
                }
              );
            }
          );
        }
      );
    });
  });
});
