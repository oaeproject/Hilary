/*!
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
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

var url = require('url');

var RestContext = require('./model').RestContext;
var RestUtil = require('./util');

// This file aggregates those REST calls that are only benefitial
// to a global administrator.
// It's expected that the RestContext objects that are passed into these methods
// reflect authenticated users whom are all global administrators.

/**
 * Get a signed token from the global server that can be used to log onto a tenant.
 *
 * @param  {RestContext}    globalRestCtx               Standard REST Context object associated to the global administrator server.
 * @param  {String}         tenantAlias                 The tenant to log on.
 * @param  {Function}       callback                    Standard callback method
 * @param  {Object}         callback.err                Error object containing error code and error message
 * @param  {Token}          callback.token              A token object that contains all the data to sign in.
 */
var getSignedToken = module.exports.getSignedToken = function(globalRestCtx, tenantAlias, callback) {
    var params = {
        'tenant': tenantAlias
    };
    RestUtil.RestRequest(globalRestCtx, '/api/auth/signed', 'GET', params, callback);
};

/**
 * Given a token that was request earlier, this method allows you to log in on a tenant.
 * The passed in RestContext should already be associated with the tenant you wish to login on.
 *
 * @param  {RestContext}    restCtx                         Standard REST Context object associated to the tenant you wish to log onto.
 * @param  {Token}          token                           A token object that contains all the data to sign in.
 * @param  {Function}       callback                        Standard callback method
 * @param  {Object}         callback.err                    Error object containing error code and error message
 * @param  {String}         callback.body                   The body as returned by the endpoint.
 */
var loginWithSignedToken = module.exports.loginWithSignedToken = function(restCtx, token, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/signed', 'POST', token, callback);
};

/**
 * Allows for a global administrator to login on a tenant.
 * This is mostly a utility method around `getSignedToken` and `loginWithSignedToken`.
 *
 * @param  {RestContext}    globalRestCtx   Standard REST Context object associated to the global administrator.
 * @param  {String}         tenantAlias     The tenant to log on.
 * @param  {Function}       callback        Standard callback method
 * @param  {Object}         callback.err    Error object containing error code and error message
 * @param  {RestContext}    callback.ctx    The REST Context object that can be used to execute request too the tenant.
 */
var loginOnTenant = module.exports.loginOnTenant = function(globalRestCtx, tenantAlias, callback) {
    getSignedToken(globalRestCtx, tenantAlias, function(err, token) {
        if (err) {
            return callback(err);
        }

        // Create a new rest context and jar for this tenant.
        // There is no need to pass in a password
        var restCtx = new RestContext(token.protocol + '://' + token.host, null, null, token.host);

        // Perform the actual login.
        loginWithSignedToken(restCtx, token, function(err, body, response) {
            if (err) {
                return callback(err);
            } else if (response.statusCode !== 302) {
                return callback({'code': response.statusCode, 'msg': 'Unexpected response code'});
            } else {
                restCtx.username = globalRestCtx.username;
                callback(null, restCtx);
            }
        });
    });
};
