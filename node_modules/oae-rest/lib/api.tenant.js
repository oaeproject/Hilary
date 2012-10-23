/*
 * Copyright 2012 Sakai Foundation (SF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://www.osedu.org/licenses/ECL-2.0
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
var WAIT_TIME = 1000;

/**
 * Retrieve all available tenants through the REST API.
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current user
 *                                                      credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param {Function(err, tenants)}  callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 * @param {Array<Tenant>}           callback.tenants    Array containing a tenant object for each of the available tenants
 *                                                          
 */
var getAllTenants = module.exports.getAllTenants = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenants', 'GET', null, callback);
};

/**
 * Retrieve a tenant through the REST API.
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current user
 *                                                      credentials. The tenant information that will be retrieved will be for the current tenant
 * @param {String}                  tenantId            The tenant's unique identifier
 * @param {Function(err, tenant)}   callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 * @param {Tenant}                  callback.tenants    Tenant object representing the retrieved tenant
 */
var getTenant = module.exports.getTenant = function(restCtx, tenantId, callback) {
    var url = '/api/tenant';
    if (tenantId) {
        url += '/' + encodeURIComponent(tenantId);
    }
    RestUtil.RestRequest(restCtx, url, 'GET', null, callback)
};

/**
 * Create a new tenant through the REST API.
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current user
 *                                                      credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param {String}                  tenantId            The tenant's unique identifier
 * @param {Number}                  tenantPort          The port on which the tenant will run
 * @param {String}                  tenantName          The new tenant's name
 * @param {String}                  tenantBaseUrl       The base URL for the newly created tenant. This should include protocol as well (e.g. http://localhost:2001)
 * @param {Function(err, tenant)}   callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 * @param {Tenant}                  callback.tenant     Tenant object representing the newly created tenant
 */
var createTenant = module.exports.createTenant = function(restCtx, tenantId, tenantPort, tenantName, tenantBaseUrl, callback) {
    var params = {
        'id': tenantId,
        'port': tenantPort,
        'name': tenantName,
        'baseurl': tenantBaseUrl
    }
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
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current user
 *                                                      credentials.
 * @param {Number}                  tenantPort          The port on which the tenant that needs to be updated runs
 * @param {String}                  tenantName          The new tenant name
 * @param {Function(err)}           callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 */
var updateTenant = module.exports.updateTenant = function(restCtx, tenantPort, tenantName, callback) {
    var params = {
        'port': tenantPort,
        'name': tenantName
    };
    RestUtil.RestRequest(restCtx, '/api/tenant', 'POST', params, callback);
};

/**
 * Stop a running tenant through the REST API.
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current user
 *                                                      credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param {Number}                  tenantPort          The port on which the tenant that should be stopped is running
 * @param {Function(err)}           callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 */
var stopTenant = module.exports.stopTenant = function(restCtx, tenantPort, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenant/stop', 'POST', {'tenants': [tenantPort]}, function(err) {
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
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current user
 *                                                      credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param {Number}                  tenantPort          The port on which the tenant that should be started has been registered
 * @param {Function(err)}           callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 */
var startTenant = module.exports.startTenant = function(restCtx, tenantPort, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenant/start', 'POST', {'tenants': [tenantPort]}, function(err) {
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
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current user
 *                                                      credentials. In order for this to work, a global admin rest context will need to passed in.
 * @param {Number}                  tenantPort          The port on which the tenant that should be deleted has been registered
 * @param {Function(err)}           callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 */     
var deleteTenant = module.exports.deleteTenant = function(restCtx, tenantPort, callback) {
    RestUtil.RestRequest(restCtx, '/api/tenant/delete', 'POST', {'tenants': [tenantPort]}, function(err) {
        if (err) {
            callback(err);
        } else {
            // Give it some time to stop
            setTimeout(callback, WAIT_TIME, err);
        }
    });
};
