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

/**
 * Create an OAuth Client
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         userId              The ID of the user for whom to create the OAuth client
 * @param  {String}         displayName         The name for this client
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        Standard error object, if any
 * @param  {Client}         callback.client     The created OAuth client
 */
var createClient = module.exports.createClient = function(restCtx, userId, displayName, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/oauth/clients/' + RestUtil.encodeURIComponent(userId), 'POST', {'displayName': displayName}, callback);
};

/**
 * Get all the clients for a user
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         userId              The ID of the user for whom to retrieve the OAuth clients
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        Standard error object, if any
 * @param  {Client}         callback.clients    The retrieved OAuth clients
 */
var getClients = module.exports.getClients = function(restCtx, userId, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/oauth/clients/' + RestUtil.encodeURIComponent(userId), 'GET', null, callback);
};

/**
 * Update a client for a user
 *
 * @param  {RestContext}    restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         userId          The ID of the user for whom to retrieve the OAuth clients
 * @param  {String}         clientId        The ID of the client to delete
 * @param  {String}         [displayName]   The new display name for this client
 * @param  {String}         [secret]        The new secret for this client
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    Standard error object, if any
 */
var updateClient = module.exports.updateClient = function(restCtx, userId, clientId, displayName, secret, callback) {
    var url = '/api/auth/oauth/clients/' + RestUtil.encodeURIComponent(userId) + '/' + RestUtil.encodeURIComponent(clientId);
    var params = {
        'displayName': displayName,
        'secret': secret
    };
    RestUtil.RestRequest(restCtx, url, 'POST', params, callback);
};

/**
 * Delete a client for a user
 *
 * @param  {RestContext}    restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         userId          The ID of the user for whom to retrieve the OAuth clients
 * @param  {String}         clientId        The ID of the client to delete
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    Standard error object, if any
 */
var deleteClient = module.exports.deleteClient = function(restCtx, userId, clientId, callback) {
    var url = '/api/auth/oauth/clients/' + RestUtil.encodeURIComponent(userId) + '/' + RestUtil.encodeURIComponent(clientId);
    RestUtil.RestRequest(restCtx, url, 'DELETE', null, callback);
};
