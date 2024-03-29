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

import assert from 'node:assert';
import { format } from 'node:util';
import ShortId from 'shortid';
import Counter from 'oae-util/lib/counter.js';
import { generateRandomText } from 'oae-tests';
import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import { emitter } from 'oae-tenants/lib/api.js';

// Keep track of the asynchronous operations that are still pending in the Tenants API
const asyncOperationsCounter = new Counter();
emitter.on('preCache', asyncOperationsCounter.incr);
emitter.on('cached', asyncOperationsCounter.decr);

/**
 * Execute `callback` once a tenant change has propagated through the system. This is useful to
 * synchronize with the asynchronous nature of creating/updating tenants so you can continue
 * tests after everything is in sync.
 *
 * @param  {Function}   callback    Standard callback function
 */
const whenTenantChangePropagated = function (callback) {
  // The tenant needs to be cached with the TenantsAPI before returning to the caller
  asyncOperationsCounter.whenZero(callback);
};

/**
 * Create test tenants
 *
 * @param  {RestContext}    globalAdminRestCtx      The global admin rest context with which to create the tenants
 * @param  {Number}         numToCreate             How many tenants to create
 * @param  {Function}       callback                Standard callback function
 * @param  {TenantNetwork}  callback.tenant0        The first tenant  that was created
 * @param  {TenantNetwork}  [callback.tenant...]    All tenants that were created as new callback arguments
 * @throws {AssertionError}                         Thrown if there is an error creating any of the tenants
 */
const generateTestTenants = function (globalAdminRestCtx, numberToCreate, callback, _created) {
  _created = _created || [];
  if (_created.length === numberToCreate) {
    // Invoke the callback with all the tenants created
    return callback.apply(callback, _created);
  }

  // Create a tenant with random data
  const alias = generateTestTenantAlias();
  const description = generateRandomText();
  const host = generateTestTenantHost(null, generateRandomText());
  createTenantAndWait(globalAdminRestCtx, alias, description, host, { emailDomains: host }, (error, tenant) => {
    assert.ok(!error);
    _created.push(tenant);
    return generateTestTenants(globalAdminRestCtx, numberToCreate, callback, _created);
  });
};

/**
 * Create a tenant and wait for the event that indicates that the configuration has finished loading
 *
 * For method parameter descriptions, @see RestAPI.Tenant#createTenant
 */
const createTenantAndWait = function (globalAdminRestCtx, alias, displayName, host, options, callback) {
  RestAPI.Tenants.createTenant(globalAdminRestCtx, alias, displayName, host, options, (error, tenant) => {
    if (error) return callback(error);

    // Wait until all current config events have fired until calling back
    whenTenantChangePropagated(() => callback(null, tenant));
  });
};

/**
 * Update a tenant and wait until the change propagated through the system
 *
 * For method parameter descriptions, @see RestAPI.Tenant#updateTenant
 */
const updateTenantAndWait = function (restContext, tenantAlias, update, callback) {
  RestAPI.Tenants.updateTenant(restContext, tenantAlias, update, (error) => {
    assert.ok(!error);

    // Wait until the tenant change propagated through the entire system
    whenTenantChangePropagated(callback);
  });
};

/**
 * Stop a tenant and wait until the change propagated through the system
 *
 * For method parameter descriptions, @see RestAPI.Tenant#stopTenant
 */
const stopTenantAndWait = function (restContext, tenantAlias, callback) {
  RestAPI.Tenants.stopTenant(restContext, tenantAlias, (error) => {
    assert.ok(!error);

    // Wait until the tenant change propagated through the entire system
    whenTenantChangePropagated(callback);
  });
};

/**
 * Start a tenant and wait until the change propagated through the system
 *
 * For method parameter descriptions, @see RestAPI.Tenant#startTenant
 */
const startTenantAndWait = function (restContext, tenantAlias, callback) {
  RestAPI.Tenants.startTenant(restContext, tenantAlias, (error) => {
    assert.ok(!error);

    // Wait until the tenant change propagated through the entire system
    whenTenantChangePropagated(callback);
  });
};

/**
 * Create test tenant networks
 *
 * @param  {RestContext}    globalAdminRestCtx              The global admin rest context with which to create the tenant networks
 * @param  {Number}         numToCreate                     How many tenant networks to create
 * @param  {Function}       callback                        Standard callback function
 * @param  {TenantNetwork}  callback.tenantNetwork0         The first tenant network that was created
 * @param  {TenantNetwork}  [callback.tenantNetwork...]     All tenant networks that were created as new callback arguments
 * @throws {AssertionError}                                 Thrown if there is an error creating any of the tenant networks
 */
const generateTestTenantNetworks = function (globalAdminRestCtx, numberToCreate, callback, _created) {
  _created = _created || [];
  if (_created.length === numberToCreate) {
    // Invoke the callback with all the tenant networks created
    return callback.apply(callback, _created);
  }

  // Create a tenant network with a random displayName
  RestAPI.Tenants.createTenantNetwork(globalAdminRestCtx, ShortId.generate(), (error, tenantNetwork) => {
    assert.ok(!error);
    _created.push(tenantNetwork);
    return generateTestTenantNetworks(globalAdminRestCtx, numberToCreate, callback, _created);
  });
};

/**
 * Ensure one tenant is equal to another
 *
 * @param  {Tenant}         actual      The tenant to test
 * @param  {Tenant}         expected    The expected tenant object
 * @throws {AssertionError}             Thrown if the actual tenant does not match the expected model
 */
const assertTenantsEqual = function (actual, expected) {
  assert.strictEqual(actual.alias, expected.alias);
  assert.strictEqual(actual.displayName, expected.displayName);
  assert.strictEqual(actual.host, expected.host);
  assert.strictEqual(actual.active, expected.active);
  assert.strictEqual(actual.isGlobalAdminServer, expected.isGlobalAdminServer);
};

/**
 * Generate a random unique tenant alias that can be used inside of tests
 *
 * @param  {String}     [seed]  String that should be used as the first part of the generated alias. Defaults to "tenant"
 * @return {String}             The generated tenant alias
 */
const generateTestTenantAlias = function (seed = 'tenant') {
  return format('%s-%s', seed, ShortId.generate()).toLowerCase();
};

/**
 * Generate a random unique tenant host name that can be used inside of tests
 *
 * @param  {String}     [seed]  String that should be used as the first part of the generated host name. Defaults to "host"
 * @return {String}             The generated tenant host
 */
const generateTestTenantHost = function (seed, randomText) {
  seed = seed || 'host';
  // This is so wrong
  randomText = randomText || generateRandomText();
  return format('%s-%s.local', seed, randomText);
};

/**
 * Clear all the blocks from a tenant landing page
 *
 * @param  {RestContext}    adminRestContext    The rest context of a tenant admin whose tenant's landing page to clear
 * @param  {Function}       callback            Standard callback function
 * @throws {AssertionError}                     Thrown if any assertions failed
 */
const clearTenantLandingPage = function (adminRestContext, callback) {
  const config = {};
  for (let i = 1; i <= 12; i++) {
    const blockName = format('block_%d', i);
    config['oae-tenants/' + blockName + '/type'] = 'empty';
  }

  ConfigTestUtil.updateConfigAndWait(adminRestContext, null, config, (error) => {
    assert.ok(!error);
    return callback();
  });
};

export {
  whenTenantChangePropagated,
  generateTestTenants,
  createTenantAndWait,
  updateTenantAndWait,
  stopTenantAndWait,
  startTenantAndWait,
  generateTestTenantNetworks,
  assertTenantsEqual,
  generateTestTenantAlias,
  generateTestTenantHost,
  clearTenantLandingPage
};
