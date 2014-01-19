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

var RestUtil = require('./util');

// Stopping a server is async, this variable
// holds how long we should wait before returning on start/stop/delete
// of a tenant.
var WAIT_TIME = 100;


/////////////////////
// TENANT NETWORKS //
/////////////////////

/**
 * Create a tenant network.
 *
 * @param  {RestContext}    restCtx                 Standard REST Context object that contains the current tenant URL and the current user credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param  {String}         displayName             The display name of the tenant network
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {TenantNetwork}  callback.tenantNetwork  The tenant network that was created
 */
var createTenantNetwork = module.exports.createTenantNetwork = function(restCtx, displayName, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenantNetwork/create', 'POST', {'displayName': displayName}, callback);
};

/**
 * Fetch all tenant networks and their associated tenants.
 *
 * @param  {RestContext}    restCtx                     Standard REST Context object that contains the current tenant URL and the current user credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object}         callback.tenantNetworks     All tenant networks in the system, keyed by their tenant network id
 */
var getTenantNetworks = module.exports.getTenantNetworks = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenantNetworks', 'GET', null, callback);
};

/**
 * Update a tenant network.
 *
 * @param  {RestContext}    restCtx                 Standard REST Context object that contains the current tenant URL and the current user credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param  {String}         id                      The id of the tenant network being updated
 * @param  {String}         displayName             The updated display name of the tenant network
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {TenantNetwork}  callback.tenantNetwork  The new tenant network, after update
 */
var updateTenantNetwork = module.exports.updateTenantNetwork = function(restCtx, id, displayName, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenantNetwork/' + RestUtil.encodeURIComponent(id), 'POST', {'displayName': displayName}, callback);
};

/**
 * Delete a tenant network.
 *
 * @param  {RestContext}    restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param  {String}         id              The id of the tenant network to delete
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
var deleteTenantNetwork = module.exports.deleteTenantNetwork = function(restCtx, id, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenantNetwork/' + RestUtil.encodeURIComponent(id), 'DELETE', null, callback);
};

/**
 * Add the provided tenant aliases to the specified tenant network.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param  {String}         tenantNetworkId     The id of the tenant network to which to add the provided tenant aliases
 * @param  {String[]}       tenantAlises        The tenant aliases to add to the tenant network
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 */
var addTenantAliases = module.exports.addTenantAliases = function(restCtx, tenantNetworkId, tenantAliases, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenantNetwork/' + RestUtil.encodeURIComponent(tenantNetworkId) + '/addTenants', 'POST', {'alias': tenantAliases}, callback);
};

/**
 * Remove the provided tenant aliases from the specified tenant network.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param  {String}         tenantNetworkId     The id of the tenant network from which to remove the provided tenant aliases
 * @param  {String[]}       tenantAlises        The tenant aliases to remove from the tenant network
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 */
var removeTenantAliases = module.exports.removeTenantAliases = function(restCtx, tenantNetworkId, tenantAliases, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenantNetwork/' + RestUtil.encodeURIComponent(tenantNetworkId) + '/removeTenants', 'POST', {'alias': tenantAliases}, callback);
};

/////////////
// TENANTS //
/////////////

/**
 * Retrieve all available tenants through the REST API.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param  {Function}       callback            Standard callback method takes arguments `err` and `tenants`
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Tenant[]}       callback.tenants    Array containing a tenant object for each of the available tenants
 */
var getTenants = module.exports.getTenants = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenants', 'GET', null, callback);
};

/**
 * Retrieve a tenant through the REST API.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         [alias]             Optional tenant alias of the tenant to get information for. If no tenantAlias is passed in, the current tenant will be used
 * @param  {Function}       callback            Standard callback method takes arguments `err` and `tenant`
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Tenant}         callback.tenant     Tenant object representing the retrieved tenant
 */
var getTenant = module.exports.getTenant = function(restCtx, alias, callback) {
    var url = '/api/tenant';
    if (alias) {
        url += '/' + RestUtil.encodeURIComponent(alias);
    }
    RestUtil.RestRequest(restCtx, url, 'GET', null, callback);
};

/**
 * Create a new tenant through the REST API.
 *
 * @param  {RestContext}      restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param  {String}           alias               The tenant's unique identifier
 * @param  {String}           displayName         The new tenant's displayName
 * @param  {String}           host                The hostname for the newly created tenant (e.g. cambridge.oae.com)
 * @param  {Function}         callback            Standard callback method takes arguments `err` and `tenant`
 * @param  {Object}           callback.err        Error object containing error code and error message
 * @param  {Tenant}           callback.tenant     Tenant object representing the newly created tenant
 */
var createTenant = module.exports.createTenant = function(restCtx, alias, displayName, host, callback) {
    var params = {
        'alias': alias,
        'displayName': displayName,
        'host': host
    };
    RestUtil.RestRequest(restCtx, '/api/tenant/create', 'POST', params, function(err, tenant) {
        if (err) {
            callback(err);
        } else {
            // Give it some time to start up
            setTimeout(callback, WAIT_TIME, err, tenant);
        }
    });
};

/**
 * Update a tenant's metadata through the REST API.
 *
 * @param  {RestContext}      restCtx                         Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}           [alias]                         Optional tenant alias of the tenant that needs to be updated, in case the request is made from the global admin tenant. If no tenantAlias is passed in, the current tenant will be used
 * @param  {Object}           tenantUpdates                   Object where the keys represents the metadata identifiers and the values represent the new metadata values
 * @param  {String}           [tenantUpdates.displayName]     Updated tenant display name
 * @param  {String}           [tenantUpdates.host]            Updated tenant hostname
 * @param  {Function}         callback                        Standard callback function
 * @param  {Object}           callback.err                    Error object containing error code and error message
 */
var updateTenant = module.exports.updateTenant = function(restCtx, alias, tenantUpdates, callback) {
    var url = '/api/tenant';
    if (alias) {
        url += '/' + RestUtil.encodeURIComponent(alias);
    }
    RestUtil.RestRequest(restCtx, url, 'POST', tenantUpdates, function(err) {
        if (err) {
            callback(err);
        } else {
            // Give it some time to update
            setTimeout(callback, WAIT_TIME, err);
        }
    });
};

/**
 * Stop a running tenant through the REST API.
 *
 * @param  {RestContext}      restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param  {String}           alias               The alias of the tenant that needs to be stopped
 * @param  {Function}         callback            Standard callback function
 * @param  {Object}           callback.err        Error object containing error code and error message
 */
var stopTenant = module.exports.stopTenant = function(restCtx, alias, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenant/stop', 'POST', {'aliases': [alias]}, function(err) {
        if (err) {
            callback(err);
        } else {
            // Give it some time to stop
            setTimeout(callback, WAIT_TIME, err);
        }
    });
};

/**
 * Start a stopped tenant through the REST API.
 *
 * @param  {RestContext}      restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param  {String}           tenantAlias         The alias of the tenant that needs to be started
 * @param  {Function}         callback            Standard callback function
 * @param  {Object}           callback.err        Error object containing error code and error message
 */
var startTenant = module.exports.startTenant = function(restCtx, tenantAlias, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenant/start', 'POST', {'aliases': [tenantAlias]}, function(err) {
        if (err) {
            callback(err);
        } else {
            // Give it some time to start
            setTimeout(callback, WAIT_TIME, err);
        }
    });
};

/**
 * Delete a tenant through the REST API.
 *
 * @param  {RestContext}      restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param  {String}           tenantAlias         The alias of the tenant that needs to be deleted
 * @param  {Function}         callback            Standard callback function
 * @param  {Object}           callback.err        Error object containing error code and error message
 */
var deleteTenant = module.exports.deleteTenant = function(restCtx, tenantAlias, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenant/delete', 'POST', {'aliases': [tenantAlias]}, function(err) {
        if (err) {
            callback(err);
        } else {
            // Give it some time to stop
            setTimeout(callback, WAIT_TIME, err);
        }
    });
};
