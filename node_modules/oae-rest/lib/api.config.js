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
 * TODO: Remove this function once the global admin UI is no longer hosted through express
 *
 * Get the global admin UI through the REST API.
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                     user credentials. For this function to work, the passed in restCtx should be the global
 *                                                     admin REST context
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message 
 * @param  {String}       callback.adminui    HTML representing the global admin UI
 */
var getGlobalAdminUI = module.exports.getGlobalAdminUI = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/admin.html', 'GET', null, callback);
};

/**
 * TODO: Remove this function once the global admin UI is no longer hosted through express
 * Get the tenant admin UI through the REST API.
 * @param  {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                     user credentials
 * @param  {String}    tenantAlias         Alias of the tenant we're trying to get the admin UI for
 * @param  {Function}  callback            Standard callback method
 * @param  {Object}    callback.err        Error object containing error code and error message 
 * @param  {String}    callback.adminui    HTML representing the tenant admin UI
 */
var getTenantAdminUI = module.exports.getTenantAdminUI = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/admin', 'GET', null, callback);
};

/**
 * Get the global or tenant config through the REST API.
 * @param  {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                     user credentials
 * @param  {Function}  callback            Standard callback method
 * @param  {Object}    callback.err        Error object containing error code and error message 
 * @param  {Object}    callback.config     JSON object representing the global/tenant config values
 */
var getConfig = module.exports.getConfig = function(restCtx, tenantId, callback) {
    var url = '/api/config';
    if (tenantId) {
        url += '/' + encodeURIComponent(tenantId);
    }
    RestUtil.RestRequest(restCtx, url, 'GET', null, callback);
};

/**
 * @param  {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                     user credentials. In order for this to work, a global/tenant admin context will
 *                                                     need to be passed in.
 * @param  {String}    configField         The identifier of the config value that needs to be set/updated (e.g. oae-authentication/twitter/enabled)
 * @param  {String}    configValue         The value of the config value that is being changed
 * @param  {Function}  callback            Standard callback method
 * @param  {Object}    callback.err        Error object containing error code and error message 
 */
var setConfig = module.exports.setConfig = function(restCtx, tenantId, configField, configValue, callback) {
    var params = {};
    params[configField] = configValue;
    var url = '/api/config';
    if (tenantId) {
        url += '/' + encodeURIComponent(tenantId);
    }
    RestUtil.RestRequest(restCtx, url, 'POST', params, function(err) {
        // Give it a second to propogate to the app servers
        setTimeout(callback, 1000, err);
    });
};
