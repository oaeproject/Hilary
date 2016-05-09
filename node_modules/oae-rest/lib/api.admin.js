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
var util = require('util');

var RestContext = require('./model').RestContext;
var RestUtil = require('./util');

// This file aggregates those REST calls that are only beneficial to a global and/or tenant administrators.
// It's expected that the RestContext objects that are passed into these methods reflect authenticated users whom are all administrators

/**
 * Get the request info required for a global administrator to log in to a user tenant
 *
 * @param  {RestContext}    globalAdminRestCtx      Standard REST Context object associated to the global administrator server
 * @param  {String}         tenantAlias             The tenant to log onto
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Object}         callback.requestInfo    The request info object containing the `url` and signed POST `body` to use to authenticate to the specified tenant
 */
var getSignedTenantAuthenticationRequestInfo = module.exports.getSignedTenantAuthenticationRequestInfo = function(globalAdminRestCtx, tenantAlias, callback) {
    RestUtil.RestRequest(globalAdminRestCtx, '/api/auth/signed/tenant', 'GET', {'tenant': tenantAlias}, callback);
};

/**
 * Get the request info required for an administrator to log in as a specified user
 *
 * @param  {RestContext}    adminRestCtx            Standard REST Context object associated to an administrator user
 * @param  {String}         becomeUserId            The id of the user the administrator in context wishes to become
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Object}         callback.requestInfo    The request info object containing the `url` and signed POST `body` to use to authenticate and become the specified user
 */
var getSignedBecomeUserAuthenticationRequestInfo = module.exports.getSignedBecomeUserAuthenticationRequestInfo = function(adminRestCtx, becomeUserId, callback) {
    RestUtil.RestRequest(adminRestCtx, '/api/auth/signed/become', 'GET', {'becomeUserId': becomeUserId}, callback);
};

/**
 * Given a signed request body that was acquired using one of the `getSigned*AuthenticationRequestInfo` endpoints, perform a signed
 * authentication request in order to perform the desired authentication.
 *
 * The outcome of this method is that the provided `restCtx` becomes authenticated in the way the signed authentication body specifies (e.g.,
 * as impersonating a user if the signed authentication body was granted using `getSignedBecomeUserAuthenticationRequestInfo`).
 *
 * @param  {RestContext}    restCtx         Standard REST context object that will be authenticated if the authentication request is successful
 * @param  {Object}         body            The signed request body to use to perform the signed authentication
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
var doSignedAuthentication = module.exports.doSignedAuthentication = function(restCtx, body, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/signed', 'POST', body, function(err, body, response) {
        if (err) {
            return callback(err);
        } else if (response.statusCode !== 302) {
            return callback({'code': response.statusCode, 'msg': 'Unexpected response code'});
        }

        return callback();
    });
};

/**
 * Convenience method to request a signed "become user" authentication request and invoke it against the target tenant
 *
 * @param  {RestContext}    adminRestCtx            Standard REST context object of the admin user who is trying to become another user
 * @param  {String}         becomeUserId            The id of the user the admin wishes to become
 * @param  {String}         targetInternalBaseUrl   The reachable base url to use (protocol, host, port) to connect to the server instead of the target tenant host. This is useful if the real host name of the tenant is not actually reachable (e.g., it was mocked in unit tests)
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {RestContext}    callback.restCtx        The authenticated request context that is impostering the specified `becomeUserId`
 */
var loginAsUser = module.exports.loginAsUser = function(adminRestCtx, becomeUserId, targetInternalBaseUrl, callback) {
    getSignedBecomeUserAuthenticationRequestInfo(adminRestCtx, becomeUserId, function(err, requestInfo) {
        if (err) {
            return callback(err);
        }

        return _doSignedAuthenticationWithRequestInfo(requestInfo, targetInternalBaseUrl, adminRestCtx.strictSSL, callback);
    });
};

/**
 * Convenience method to request a signed tenant authentication request and invoke it against the target tenant
 *
 * @param  {RestContext}    globalAdminRestCtx      Standard REST Context object associated to the global administrator
 * @param  {String}         tenantAlias             The tenant on which to login
 * @param  {String}         targetInternalBaseUrl   The reachable base url to use (protocol, host, port) to connect to the server instead of the target tenant host. This is useful if the real host name of the tenant is not actually reachable (e.g., it was mocked in unit tests)
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {RestContext}    callback.restCtx        A REST Context for the global administrator that is authenticated to the specified tenant
 */
var loginOnTenant = module.exports.loginOnTenant = function(globalAdminRestCtx, tenantAlias, targetInternalBaseUrl, callback) {
    getSignedTenantAuthenticationRequestInfo(globalAdminRestCtx, tenantAlias, function(err, requestInfo) {
        if (err) {
            return callback(err);
        }

        return _doSignedAuthenticationWithRequestInfo(requestInfo, targetInternalBaseUrl, globalAdminRestCtx.strictSSL, callback);
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

/**
 * Perform the signed authentication request as described by the request info object
 *
 * @param  {Object}         requestInfo         The request info object that was granted by one of the `getSigned*AuthenticationRequestInfo` methods
 * @param  {String}         requestInfo.url     The url that should be POSTed to in order to complete the authentication
 * @param  {Object}         requestInfo.body    The signed body to use in the POST request to complete the authentication
 * @param  {String}         internalBaseUrl     The reachable base url to use (protocol, host, port) to connect to the server instead of the target tenant host. This is useful if the real host name of the tenant is not actually reachable (e.g., it was mocked in unit tests)
 * @param  {Boolean}        strictSSL           Whether or not we should use strict SSL validation
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {RestContext}    callback.restCtx    A REST context that is authenticated using the signed request info
 * @api private
 */
var _doSignedAuthenticationWithRequestInfo = function(requestInfo, internalBaseUrl, strictSSL, callback) {
    var parsedUrl = url.parse(requestInfo.url);

    var baseUrl = internalBaseUrl || util.format('%s//%s', parsedUrl.protocol, parsedUrl.host);
    var authenticatingRestCtx = new RestContext(baseUrl, {'hostHeader': parsedUrl.host, 'strictSSL': strictSSL});
    doSignedAuthentication(authenticatingRestCtx, requestInfo.body, function(err) {
        if (err) {
            return callback(err);
        }

        return callback(null, authenticatingRestCtx);
    });
};