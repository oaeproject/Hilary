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

import util from 'util';
import _ from 'underscore';

import { Validator as validator } from 'oae-util/lib/validator';
import pipe from 'ramda/src/pipe';
import * as TenantNetworksDAO from './internal/dao.networks';
import * as TenantsAPI from './api';

/**
 * Create a tenant network
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         displayName             The display name of the tenant network
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {TenantNetwork}  callback.tenantNetwork  The tenant network that was created
 */
const createTenantNetwork = function(ctx, displayName, callback) {
  pipe(
    validator.isGlobalAdministratorUser,
    validator.generateError({
      code: 401,
      msg: 'Must be a global administrator user to create a tenant networt'
    }),
    validator.finalize(callback)
  )(ctx);

  pipe(
    validator.notEmpty,
    validator.generateError({
      code: 400,
      msg: 'A tenant network must contain a display name'
    }),
    validator.finalize(callback)
  )(displayName);

  return TenantNetworksDAO.createTenantNetwork(displayName, callback);
};

/**
 * Get all tenant networks and their associated tenants
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.tenantNetworks     All tenant networks in the system, keyed by their tenant network id
 */
const getTenantNetworks = function(ctx, callback) {
  pipe(
    validator.isGlobalAdministratorUser,
    validator.generateError({
      code: 401,
      msg: 'Must be a global administrator user to view tenant networks'
    }),
    validator.finalize(callback)
  )(ctx);

  TenantNetworksDAO.getAllTenantNetworks((err, tenantNetworks) => {
    if (err) {
      return callback(err);
    }

    TenantNetworksDAO.getAllTenantNetworkTenantAliases((err, tenantNetworkTenantAliases) => {
      if (err) {
        return callback(err);
      }

      _.each(tenantNetworks, (tenantNetwork, tenantNetworkId) => {
        // Expand the tenant network aliases for each tenant network into full tenant objects
        // and apply them to the tenantNetwork object
        tenantNetwork.tenants = _.chain(tenantNetworkTenantAliases[tenantNetworkId])
          .map(TenantsAPI.getTenant)
          .compact()
          .value();
      });

      return callback(null, tenantNetworks);
    });
  });
};

/**
 * Update a tenant network
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         id                      The id of the tenant network to update
 * @param  {String}         displayName             The new display name of the tenant network
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {TenantNetwork}  callback.tenantNetwork  The updated tenant network
 */
const updateTenantNetwork = function(ctx, id, displayName, callback) {
  pipe(
    validator.isGlobalAdministratorUser,
    validator.generateError({
      code: 401,
      msg: 'Must be a global administrator user to update a tenant network'
    }),
    validator.finalize(callback)
  )(ctx);

  pipe(
    validator.isNotEmpty,
    validator.generateError({
      code: 400,
      msg: 'Must specify a tenant network id'
    }),
    validator.finalize(callback)
  )(id);

  pipe(
    validator.isNotEmpty,
    validator.generateError({
      code: 400,
      msg: 'A tenant network must contain a display name'
    }),
    validator.finalize(callback)
  )(displayName);

  return TenantNetworksDAO.updateTenantNetwork(id, displayName, callback);
};

/**
 * Delete a tenant network
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     id              The id of the tenant network to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const deleteTenantNetwork = function(ctx, id, callback) {
  pipe(
    validator.isGlobalAdministratorUser,
    validator.generateError({
      code: 401,
      msg: 'Must be a global administrator user to delete a tenant network'
    }),
    validator.finalize(callback)
  )(ctx);

  pipe(
    validator.isNotEmpty,
    validator.generateError({
      code: 400,
      msg: 'Must specify a tenant network id'
    }),
    validator.finalize(callback)
  )(id);

  return TenantNetworksDAO.deleteTenantNetwork(id, callback);
};

/**
 * Add the provided tenant(s) to a tenant network
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     tenantNetworkId     The id of the tenant network to which to add the provided tenant aliases
 * @param  {String[]}   tenantAlises        The tenant aliases to add to the tenant network
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const addTenantAliases = function(ctx, tenantNetworkId, tenantAliases, callback) {
  pipe(
    validator.isGlobalAdministratorUser,
    validator.generateError({
      code: 401,
      msg: 'Must be a global administrator user to update a tenant network'
    }),
    validator.finalize(callback)
  )(ctx);

  pipe(
    validator.isNotEmpty,
    validator.generateError({
      code: 400,
      msg: 'Must specify a tenant network id'
    }),
    validator.finalize(callback)
  )(tenantNetworkId);

  pipe(
    validator.isNotNull,
    validator.generateError({
      code: 400,
      msg: 'Must specify a list of tenant aliases to add'
    }),
    validator.finalize(callback)
  )(tenantAliases);

  pipe(
    validator.isNotNull,
    validator.generateError({
      code: 400,
      msg: 'Must specify at least one tenant alias to add'
    }),
    validator.finalize(callback)
  )(tenantAliases.length);

  _.each(tenantAliases, tenantAlias => {
    pipe(
      validator.isNotEmpty,
      validator.generateError({
        code: 400,
        msg: util.format('Tenant with alias "%s" does not exist', tenantAlias)
      }),
      validator.finalize(callback)
    )(TenantsAPI.getTenant(tenantAlias));
  });

  return TenantNetworksDAO.addTenantAliases(tenantNetworkId, tenantAliases, callback);
};

/**
 * Remove the provided tenant(s) from a tenant network
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     tenantNetworkId     The id of the tenant network from which to remove the provided tenant aliases
 * @param  {String[]}   tenantAlises        The tenant alias(es) to remove from the tenant network
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const removeTenantAliases = function(ctx, tenantNetworkId, tenantAliases, callback) {
  validator
    .check(null, {
      code: 401,
      msg: 'Must be a global administrator user to update a tenant network'
    })
    .isGlobalAdministratorUser(ctx);

  pipe(
    validator.isNotEmpty,
    validator.generateError({
      code: 400,
      msg: 'Must specify a tenant network id'
    }),
    validator.finalize(callback)
  )(tenantNetworkId);

  pipe(
    validator.isNotNull,
    validator.generateError({
      code: 400,
      msg: 'Must specify a list of tenant aliases to remove'
    }),
    validator.finalize(callback)
  )(tenantAliases);

  pipe(
    validator.isNotNull,
    validator.generateError({
      code: 400,
      msg: 'Must specify at least one tenant alias to remove'
    }),
    validator.finalize(callback)
  )(tenantAliases.length);

  return TenantNetworksDAO.removeTenantAliases(tenantNetworkId, tenantAliases, callback);
};

export {
  createTenantNetwork,
  getTenantNetworks,
  updateTenantNetwork,
  deleteTenantNetwork,
  addTenantAliases,
  removeTenantAliases
};
