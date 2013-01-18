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

var url = require('url');

var RestContext = require('./model').RestContext;
var RestUtil = require('./util');

/**
 * Log a user in through the REST API.
 * 
 * @param  {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. For this function to work, the passed in restCtx should be an anonymous REST context
 * @param  {String}                 username            Username for the user logging in. This should not be the globally unique userid (e.g. u:cam:nm417), but the login id a user would actually use (e.g. nm417)
 * @param  {String}                 password            The user's password
 * @param  {Function}               callback            Standard callback method takes argument `err`
 * @param  {Object}                 callback.err        Error object containing error code and error message                        
 */
var login = module.exports.login = function(restCtx, username, password, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/login', 'POST', {'username': username, 'password': password}, callback);
};

/**
 * Log a user out through the REST API.
 * 
 * @param  {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. This is the user that will be logged out
 * @param  {Function}               callback            Standard callback method takes argument `err`
 * @param  {Object}                 callback.err        Error object containing error code and error message   
 */
var logout = module.exports.logout = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/logout', 'POST', null, callback);
};

/**
 * Change a user's password through the REST API.
 * 
 * @param  {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}                 userId              The user id for which we want to update the password
 * @param  {String}                 oldPassword         The user's current password
 * @param  {String}                 newPassword         The user's new password
 * @param  {Function}               callback            Standard callback method takes argument `err`
 * @param  {Object}                 callback.err        Error object containing error code and error message
 */
var changePassword = module.exports.changePassword = function(restCtx, userId, oldPassword, newPassword, callback) {
    var params = {
        'oldPassword': oldPassword,
        'newPassword': newPassword
    };
    RestUtil.RestRequest(restCtx, '/api/user/' + RestUtil.encodeURIComponent(userId) + '/password', 'POST', params, callback);
};

/**
 * Check whether or not a login id exists
 * 
 * @param  {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}                 username            Username we're checking existence. This should not be the globally unique userid (e.g. u:cam:nm417), but the login id a user would actually use (e.g. nm417) to log in.
 * @param  {Function}               callback            Standard callback method takes argument `err`
 * @param  {Object}                 callback.err        Error object containing error code and error message
 */
var exists = module.exports.exists = function(restCtx, username, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/exists/' + RestUtil.encodeURIComponent(username), 'GET', null, callback);
};

/**
 * Get a signed token from the global server that can be used to log onto a tenant.
 *
 * @param  {RestContext}    globalRestCtx               Standard REST Context object associated to the global administrator server.
 * @param  {String}         tenantAlias                 The tenant to log on.
 * @param  {Function}       callback                    Standard callback method
 * @param  {Object}         callback.err                Error object containing error code and error message
 * @param  {RestContext}    callback.token              A token object that contains all the data to sign in.
 * @param  {RestContext}    callback.token.expires      Timestamp (in ms since epoch) when the signature expires.
 * @param  {RestContext}    callback.token.host         The tenant host for which the signature is valid
 * @param  {RestContext}    callback.token.signature    A signature that's valid for this host, userId and tenant.
 * @param  {RestContext}    callback.token.userId       The userId that needs to be passed to the tenant endpoint; this is the user that will be logged in.
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
 * @param  {RestContext}    token                           A token object that contains all the data to sign in.
 * @param  {RestContext}    token.expires                   Timestamp (in ms since epoch) when the signature expires.
 * @param  {RestContext}    token.host                      The tenant host for which the signature is valid
 * @param  {RestContext}    token.signature                 A signature that's valid for this host, userId and tenant.
 * @param  {RestContext}    token.userId                    The userId that needs to be passed to the tenant endpoint; this is the user that will be logged in.
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
        var restCtx = new RestContext('http://' + token.host, globalRestCtx.userId, null, token.host);
        RestUtil.setupEmptyJar(restCtx);

        // Perform the actual login.
        loginWithSignedToken(restCtx, token, function(err, body, response) {
            if (err) {
                return callback(err);
            } else if (response.statusCode !== 302) {
                return callback({'code': response.statusCode, 'msg': 'Unexpected response code'});
            } else {
                callback(null, restCtx);
            }
        });
    });
};
