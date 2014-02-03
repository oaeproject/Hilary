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

var url = require('url');

var RestContext = require('./model').RestContext;
var RestUtil = require('./util');

// This file aggregates those REST calls that are only beneficial to a global and/or tenant administrators.
// It's expected that the RestContext objects that are passed into these methods reflect authenticated users whom are all administrators

/**
 * Get a signed token from the global server that can be used to log onto a tenant.
 *
 * @param  {RestContext}    globalRestCtx               Standard REST Context object associated to the global administrator server
 * @param  {String}         tenantAlias                 The tenant to log onto
 * @param  {Function}       callback                    Standard callback method
 * @param  {Object}         callback.err                Error object containing error code and error message
 * @param  {Token}          callback.token              A token object that contains all the data to sign in
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
 * @param  {RestContext}    restCtx                         Standard REST Context object associated to the tenant you wish to log onto
 * @param  {Token}          token                           A token object that contains all the data to sign in
 * @param  {Function}       callback                        Standard callback method
 * @param  {Object}         callback.err                    Error object containing error code and error message
 * @param  {String}         callback.body                   The body as returned by the endpoint
 */
var loginWithSignedToken = module.exports.loginWithSignedToken = function(restCtx, token, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/signed', 'POST', token, callback);
};

/**
 * Allows for a global administrator to login on a tenant.
 * This is mostly a utility method around `getSignedToken` and `loginWithSignedToken`.
 *
 * @param  {RestContext}    globalRestCtx   Standard REST Context object associated to the global administrator
 * @param  {String}         tenantAlias     The tenant to log on
 * @param  {Function}       callback        Standard callback method
 * @param  {Object}         callback.err    Error object containing error code and error message
 * @param  {RestContext}    callback.ctx    The REST Context object that can be used to execute request too the tenant
 */
var loginOnTenant = module.exports.loginOnTenant = function(globalRestCtx, tenantAlias, callback) {
    getSignedToken(globalRestCtx, tenantAlias, function(err, token) {
        if (err) {
            return callback(err);
        }

        // Create a new rest context and jar for this tenant. There is no need to pass in a password as we aren't using local authentication
        var restCtx = new RestContext(token.protocol + '://' + token.host, {'hostHeader': token.host, 'strictSSL': globalRestCtx.strictSSL});

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

/**
 * Import a batch of users from a CSV file. The CSV file should be formatted in the following way:
 *
 *  `externalId, lastName, firstName, email`
 *
 * When importing a set of users using the local authentication strategy, the CSV format should be the following:
 *
 *  `externalId, password, lastName, firstName, email`
 *
 * When an external id for the provided authentication strategy cannot be found, a new user will be created. When that
 * user can be found, no new user will be created.
 *
 * @param  {RestContext}    restCtx                 Standard REST Context object associated to a global or tenant administrator
 * @param  {String}         [tenantAlias]           The alias of the tenant on which the users should be loaded
 * @param  {Function}       csvGenerator            A function that returns a stream which points to a CSV file body
 * @param  {String}         authenticationStrategy  The authentication strategy with which the provided external ids should be associated
 * @param  {Boolean}        [forceProfileUpdate]    Whether or not the user's display name should be updated with the value specified in the CSV file, even when the display name is different than the external id. By default, this will be set to `false`
 * @param  {Function}       callback                Standard callback method takes arguments `err`
 * @param  {Object}         callback.err            Error object containing error code and error message
 */
var importUsers = module.exports.importUsers = function(restCtx, tenantAlias, csvGenerator, authenticationStrategy, forceProfileUpdate, callback) {
    var params = {
        'tenantAlias': tenantAlias,
        'authenticationStrategy': authenticationStrategy,
        'forceProfileUpdate': forceProfileUpdate,
        'file': csvGenerator
    };
    RestUtil.RestRequest(restCtx, '/api/user/import', 'POST', params, callback);
};
