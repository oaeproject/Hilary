/*!
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

/**
 * Get the global config schema through the REST API. This should only return for a global or tenant admin.
 * 
 * @param  {RestContext}   restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Function}      callback            Standard callback method
 * @param  {Object}        callback.err        Error object containing error code and error message
 * @param  {Object}        callback.schema     JSON object representing the global config schema
 */
var getSchema = module.exports.getSchema = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/config/schema', 'GET', null, callback);
};

/**
 * Get the global or tenant config through the REST API.
 * 
 * @param  {RestContext}   restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}        [tenantAlias]       Optional tenant alias of the tenant to get configuration of. If no tenantAlias is passed in, the current tenant will be used.
 * @param  {Function}      callback            Standard callback method
 * @param  {Object}        callback.err        Error object containing error code and error message
 * @param  {Object}        callback.config     JSON object representing the global/tenant config values
 */
var getTenantConfig = module.exports.getTenantConfig = function(restCtx, tenantAlias, callback) {
    var url = '/api/config';
    if (tenantAlias) {
        url += '/' + RestUtil.encodeURIComponent(tenantAlias);
    }
    RestUtil.RestRequest(restCtx, url, 'GET', null, callback);
};

/**
 * Update a configuration values for a specific tenant
 * 
 * @param  {RestContext}   restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials. In order for this to work, a global/tenant admin context will need to be passed in.
 * @param  {String}        [tenantAlias]   Optional tenant alias of the tenant to get configuration of. If no tenantAlias is passed in, the current tenant will be used.
 * @param  {String}        configField     The identifier of the config value that needs to be set/updated (e.g. oae-authentication/twitter/enabled)
 * @param  {String}        configValue     The value of the config value that is being changed
 * @param  {Function}      callback        Standard callback method
 * @param  {Object}        callback.err    Error object containing error code and error message
 */
var updateConfig = module.exports.updateConfig = function(restCtx, tenantAlias, configField, configValue, callback) {
    var params = {};
    params[configField] = configValue;
    var url = '/api/config';
    if (tenantAlias) {
        url += '/' + RestUtil.encodeURIComponent(tenantAlias);
    }
    RestUtil.RestRequest(restCtx, url, 'POST', params, callback);
};
