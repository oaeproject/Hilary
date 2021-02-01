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
import clone from 'clone';
import ShortId from 'shortid';

import { logger } from 'oae-logger';

import * as Cassandra from 'oae-util/lib/cassandra';
import * as EmitterAPI from 'oae-emitter';
import * as Pubsub from 'oae-util/lib/pubsub';

import { TenantNetwork } from '../model';

const log = logger('oae-tenants');

// A cache that holds all tenant networks keyed by tenantNetworkId
let _cacheTenantNetworks = null;

// An cache that holds all tenantAliases that belong to each tenant network, keyed by tenant network id
let _cacheTenantAliasesByTenantNetworkId = null;

// An cache that holds all network ids a tenant belongs to, keyed by tenant alias (inverse
// of _tenantAliasesByTenantNetworkId)
let _cacheTenantNetworkIdsByTenantAlias = null;

// Emit events when the cache was successfully invalidated
const emitter = new EmitterAPI.EventEmitter();

/**
 * Initialize the Tenant Networks DAO.
 */
const init = function () {
  // When an invalidate pubsub message comes in for tenant networks, clear
  // the local tenant networks caches
  Pubsub.emitter.on('oae-tenant-networks', (message) => {
    if (message === 'invalidate') {
      _invalidateLocalCache();
    }
  });
};

/// ////////////////////////////////
// OPERATIONS ON TENANT NETWORKS //
/// ////////////////////////////////

/**
 * Create a tenant network in the system.
 *
 * @param  {String}         displayName             The display name of the tenant network
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {TenantNetwork}  callback.tenantNetwork  The tenant network that was created
 */
const createTenantNetwork = function (displayName, callback) {
  const tenantNetwork = new TenantNetwork(ShortId.generate(), displayName);

  // Create a query that can be used to create the tenant network
  const tenantNetworkQuery = Cassandra.constructUpsertCQL(
    'TenantNetwork',
    'id',
    tenantNetwork.id,
    _.omit(tenantNetwork, 'id')
  );
  if (!tenantNetworkQuery) {
    log().error(
      {
        err: new Error('Error creating a query to create a tenant network'),
        tenantNetwork
      },
      'Error creating a tenant network'
    );
    return callback({
      code: 500,
      msg: 'An unexpected error occurred while creating the tenant network'
    });
  }

  // Execute the create query
  Cassandra.runQuery(tenantNetworkQuery.query, tenantNetworkQuery.parameters, (error) => {
    if (error) {
      return callback(error);
    }

    _invalidateAllCaches();
    return callback(null, tenantNetwork);
  });
};

/**
 * Fetch all tenant networks from the system.
 *
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.tenantNetworks     All tenant networks in the system, keyed by their tenant network id
 */
const getAllTenantNetworks = function (callback) {
  // Verify the cache is populated
  _ensureCache((error) => {
    if (error) {
      return callback(error);
    }

    return callback(null, clone(_cacheTenantNetworks));
  });
};

/**
 * Get a tenant network.
 *
 * @param  {String}         id                      The id of the tenant network to fetch
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {TenantNetwork}  callback.tenantNetwork  The tenant network with the provided id
 */
const getTenantNetwork = function (id, callback) {
  _ensureCache((error) => {
    if (error) {
      return callback(error);
    }

    if (!_cacheTenantNetworks[id]) {
      return callback({
        code: 404,
        msg: util.format('Attempted to access non-existing tenant network: "%s"', id)
      });
    }

    return callback(null, clone(_cacheTenantNetworks[id]));
  });
};

/**
 * Update a tenant network.
 *
 * @param  {String}         id                      The id of the tenant network being updated
 * @param  {String}         displayName             The updated display name of the tenant network
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {TenantNetwork}  callback.tenantNetwork  The new tenant network, after update
 */
const updateTenantNetwork = function (id, displayName, callback) {
  // Ensure the tenant network we're updating exists
  getTenantNetwork(id, (error, tenantNetwork) => {
    if (error) {
      return callback(error);
    }

    const query = Cassandra.constructUpsertCQL('TenantNetwork', 'id', id, { displayName });
    Cassandra.runQuery(query.query, query.parameters, (error_) => {
      if (error_) {
        return callback(error_);
      }

      _invalidateAllCaches();

      // Return the tenant network with the updates applied as a new object
      return callback(null, _.extend({}, tenantNetwork, { displayName }));
    });
  });
};

/**
 * Delete a tenant network from the system.
 *
 * @param  {String}     id              The id of the tenant network to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const deleteTenantNetwork = function (id, callback) {
  // Ensure the tenant network exists
  // eslint-disable-next-line no-unused-vars
  getTenantNetwork(id, (error, tenantNetwork) => {
    if (error) {
      return callback(error);
    }

    // Delete the tenant network and the associations to the child tenants
    const deleteQueries = [
      {
        query: 'DELETE FROM "TenantNetwork" WHERE "id" = ?',
        parameters: [id]
      },
      {
        query: 'DELETE FROM "TenantNetworkTenants" WHERE "tenantNetworkId" = ?',
        parameters: [id]
      }
    ];

    Cassandra.runBatchQuery(deleteQueries, (error_) => {
      if (error_) {
        return callback(error_);
      }

      _invalidateAllCaches();
      return callback();
    });
  });
};

/// ///////////////////////////////////////////////
// OPERATIONS ON TENANT NETWORK TENANTS ALIASES //
/// ///////////////////////////////////////////////

/**
 * Add the provided tenant aliases to the specified tenant network.
 *
 * @param  {String}     tenantNetworkId         The id of the tenant network to which to add the provided tenant aliases
 * @param  {String[]}   tenantAlises            The tenant aliases to add to the tenant network
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 */
const addTenantAliases = function (tenantNetworkId, tenantAliases, callback) {
  // Ensure the tenant network exists
  // eslint-disable-next-line no-unused-vars
  getTenantNetwork(tenantNetworkId, (error, tenantNetwork) => {
    if (error) {
      return callback(error);
    }

    if (_.isEmpty(tenantAliases)) {
      return callback();
    }

    // Map all tenant aliases into the queries necessary to insert them all into the tenant network tenants table
    const queries = _.map(tenantAliases, (tenantAlias) => {
      return Cassandra.constructUpsertCQL(
        'TenantNetworkTenants',
        ['tenantNetworkId', 'tenantAlias'],
        [tenantNetworkId, tenantAlias],
        { value: '1' }
      );
    });

    Cassandra.runBatchQuery(queries, (error_) => {
      if (error_) {
        return callback(error_);
      }

      _invalidateAllCaches();
      return callback();
    });
  });
};

/**
 * Get all tenant network ids along with all the tenant aliases that belong to the network.
 *
 * @param  {Function}   callback                                Standard callback function
 * @param  {Object}     callback.err                            An error that occurred, if any
 * @param  {Object}     callback.tenantNetworkTenantAliases     An object keyed by tenant network id whose value is the array of tenant aliases that belong to the tenant network
 */
const getAllTenantNetworkTenantAliases = function (callback) {
  _ensureCache((error) => {
    if (error) {
      return callback(error);
    }

    return callback(null, clone(_cacheTenantAliasesByTenantNetworkId));
  });
};

/**
 * Remove the provided tenant aliases from the specified tenant network.
 *
 * @param  {String}     tenantNetworkId     The id of the tenant network from which to remove the provided tenant aliases
 * @param  {String[]}   tenantAlises        The tenant aliases to remove from the tenant network
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const removeTenantAliases = function (tenantNetworkId, tenantAliases, callback) {
  // Ensure the tenant network exists
  // eslint-disable-next-line no-unused-vars
  getTenantNetwork(tenantNetworkId, (error, tenantNetwork) => {
    if (error) {
      return callback(error);
    }

    if (_.isEmpty(tenantAliases)) {
      return callback();
    }

    // Create and execute the delete queries
    const queries = _.map(tenantAliases, (tenantAlias) => {
      return {
        query: 'DELETE FROM "TenantNetworkTenants" WHERE "tenantNetworkId" = ? AND "tenantAlias" = ?',
        parameters: [tenantNetworkId, tenantAlias]
      };
    });
    Cassandra.runBatchQuery(queries, (error_) => {
      if (error_) {
        return callback(error_);
      }

      _invalidateAllCaches();
      return callback();
    });
  });
};

/**
 * Fetch all tenant networks from Cassandra, ignoring the cache.
 *
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.tenantNetworks     All tenant networks in cassandra keyed by their id
 * @api private
 */
const _getAllTenantNetworksFromCassandra = function (callback) {
  Cassandra.runQuery('SELECT * FROM "TenantNetwork"', null, (error, rows) => {
    if (error) {
      return callback(error);
    }

    // Convert all rows into tenant networks
    const tenantNetworks = _.chain(rows).map(_rowToTenantNetwork).compact().indexBy('id').value();
    return callback(null, tenantNetworks);
  });
};

/**
 * Fetch tenant network tenant alias associations from Cassandra for all provided tenant network ids, ignoring the cache.
 *
 * @param  {String[]}   tenantNetworkIds                The ids of the tenant networks whose tenant alias associations to fetch
 * @param  {Object}     callback.err                    An error that occurred, if any
 * @param  {Object}     callback.tenantNetworkAliases   An object keyed by tenant network id whose values are the arrays of tenant aliases that belong to the network
 * @api private
 */
const _getAllTenantNetworkTenantAliasesFromCassandra = function (tenantNetworkIds, callback) {
  if (_.isEmpty(tenantNetworkIds)) {
    return callback(null, {});
  }

  // Fetch all of the tenant aliases associated to the specified tenant network from Cassandra
  Cassandra.runQuery(
    'SELECT "tenantNetworkId", "tenantAlias" FROM "TenantNetworkTenants" WHERE "tenantNetworkId" IN ?',
    [tenantNetworkIds],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      // Collect all tenant network aliases for each tenant network
      const tenantNetworkAliases = {};
      _.chain(rows)
        .map(Cassandra.rowToHash)
        .each((rowHash) => {
          tenantNetworkAliases[rowHash.tenantNetworkId] = tenantNetworkAliases[rowHash.tenantNetworkId] || [];
          tenantNetworkAliases[rowHash.tenantNetworkId].push(rowHash.tenantAlias);
        });

      return callback(null, tenantNetworkAliases);
    }
  );
};

/**
 * Convert a Cassandra row into a tenant network.
 *
 * @param  {Row}            row     A Cassandra row that was queried from TenantNetwork
 * @return {TenantNetwork}          The tenant network that is represented by the row of data
 * @api private
 */
const _rowToTenantNetwork = function (row) {
  row = Cassandra.rowToHash(row);
  if (!row.displayName) {
    return null;
  }

  return new TenantNetwork(row.id, row.displayName);
};

/**
 * Ensure the tenant networks caches are populated.
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _ensureCache = function (callback) {
  if (_cacheTenantNetworks) {
    return callback();
  }

  // Load all known tenant networks from Cassandra
  _getAllTenantNetworksFromCassandra((error, tenantNetworks) => {
    if (error) {
      return callback(error);
    }

    // Load all known tenant network tenant associations from Cassandra
    _getAllTenantNetworkTenantAliasesFromCassandra(_.keys(tenantNetworks), (error, tenantNetworkTenantAliases) => {
      if (error) {
        return callback(error);
      }

      // Reset the caches
      _cacheTenantNetworks = tenantNetworks;
      _cacheTenantAliasesByTenantNetworkId = tenantNetworkTenantAliases;
      _cacheTenantNetworkIdsByTenantAlias = {};

      // Build the inverted TenantAlias->TenantNetworkIds cache
      _.each(_cacheTenantAliasesByTenantNetworkId, (tenantAliases, tenantNetworkId) => {
        _.each(tenantAliases, (tenantAlias) => {
          _cacheTenantNetworkIdsByTenantAlias[tenantAlias] = _cacheTenantNetworkIdsByTenantAlias[tenantAlias] || [];
          _cacheTenantNetworkIdsByTenantAlias[tenantAlias].push(tenantNetworkId);
        });
      });

      emitter.emit('revalidate');
      return callback();
    });
  });
};

/**
 * Invalidate all tenant network caches of all nodes in the cluster. The cache of this node will be cleared
 * by the end of this invocation.
 *
 * @api private
 */
const _invalidateAllCaches = function () {
  _invalidateLocalCache();
  Pubsub.publish('oae-tenant-networks', 'invalidate');
};

/**
 * Invalidate all local tenant network caches so that they may be repopulated at the next request.
 *
 * @api private
 */
const _invalidateLocalCache = function () {
  _cacheTenantNetworks = null;
  _cacheTenantAliasesByTenantNetworkId = null;
  _cacheTenantNetworkIdsByTenantAlias = null;
  emitter.emit('invalidate');
};

export {
  emitter,
  init,
  createTenantNetwork,
  getAllTenantNetworks,
  getTenantNetwork,
  updateTenantNetwork,
  deleteTenantNetwork,
  addTenantAliases,
  getAllTenantNetworkTenantAliases,
  removeTenantAliases
};
