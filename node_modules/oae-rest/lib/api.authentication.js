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

/**
 * Log a user in through the REST API
 *
 * @param  {RestContext}    restCtx         Standard REST Context object that contains the current tenant URL. For this function to work, the passed in restCtx should be an anonymous REST context
 * @param  {String}         username        Username for the user logging in. This should not be the globally unique userid (e.g. u:cam:nm417), but the login id a user would actually use (e.g. nm417)
 * @param  {String}         password        The user's password
 * @param  {Function}       callback        Standard callback method takes argument `err`
 * @param  {Object}         callback.err    Error object containing error code and error message
 */
var login = module.exports.login = function(restCtx, username, password, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/login', 'POST', {'username': username, 'password': password}, callback);
};

/**
 * Log a user out through the REST API
 *
 * @param  {RestContext}    restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials. This is the user that will be logged out
 * @param  {Function}       callback        Standard callback method takes argument `err`
 * @param  {Object}         callback.err    Error object containing error code and error message
 */
var logout = module.exports.logout = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/logout', 'POST', null, callback);
};

/**
 * Change a user's password through the REST API
 *
 * @param  {RestContext}    restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         userId          The user id for which we want to update the password
 * @param  {String}         oldPassword     The user's current password
 * @param  {String}         newPassword     The user's new password
 * @param  {Function}       callback        Standard callback method takes argument `err`
 * @param  {Object}         callback.err    Error object containing error code and error message
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
 * @param  {RestContext}    restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         username        Username we're checking existence. This should not be the globally unique userid (e.g. u:cam:nm417), but the login id a user would actually use (e.g. nm417) to log in.
 * @param  {Function}       callback        Standard callback method takes argument `err`
 * @param  {Object}         callback.err    Error object containing error code and error message
 */
var exists = module.exports.exists = function(restCtx, username, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/exists/' + RestUtil.encodeURIComponent(username), 'GET', null, callback);
};

/**
 * Check whether or not a login id exists on a specified tenant. Only global administrators can check this
 *
 * @param  {RestContext}    restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         tenantAlias     The alias of the tenant to check for the existence of the user ID
 * @param  {String}         username        Username we're checking existence. This should not be the globally unique userid (e.g. u:cam:nm417), but the login id a user would actually use (e.g. nm417) to log in
 * @param  {Function}       callback        Standard callback method takes argument `err`
 * @param  {Object}         callback.err    Error object containing error code and error message
 */
var existsOnTenant = module.exports.existsOnTenant = function(restCtx, tenantAlias, username, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/' + RestUtil.encodeURIComponent(tenantAlias) + '/exists/' + RestUtil.encodeURIComponent(username), 'GET', null, callback);
};

/**
 * Return the login ids for a user
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         userId              The user id for which we want to return the login ids
 * @param  {Function}       callback            Standard callback method takes argument `err`
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Object}         callback.loginIds   Object containing the login ids for a user
 */
var getUserLoginIds = module.exports.getUserLoginIds = function(restCtx, userId, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/loginIds/' + RestUtil.encodeURIComponent(userId), 'GET', null, callback);
};

////////////////////////////////////////
// External authentication strategies //
////////////////////////////////////////

/**
 * Initiate the three-legged OAuth authorization steps for Twitter authentication
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        An error object, if any
 * @param  {String}         callback.body       The response body
 * @param  {Object}         callback.response   The HTTP response object
 */
var twitterRedirect = module.exports.twitterRedirect = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/twitter', 'POST', null, callback);
};

/**
 * Send a request to the callback endpoint for Twitter authentication
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL
 * @param  {Object}         params              Any OAuth parameters you wish to include in the request
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        An error object, if any
 * @param  {String}         callback.body       The response body
 * @param  {Object}         callback.response   The HTTP response object
 */
var twitterCallback = module.exports.twitterCallback = function(restCtx, params, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/twitter/callback', 'GET', params, callback);
};

/**
 * Initiate the three-legged OAuth authorization steps for Facbeook authentication
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        An error object, if any
 * @param  {String}         callback.body       The response body
 * @param  {Object}         callback.response   The HTTP response object
 */
var facebookRedirect = module.exports.facebookRedirect = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/facebook', 'POST', null, callback);
};

/**
 * Send a request to the callback endpoint for Facebook authentication
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL
 * @param  {Object}         params              Any OAuth parameters you wish to include in the request
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        An error object, if any
 * @param  {String}         callback.body       The response body
 * @param  {Object}         callback.response   The HTTP response object
 */
var facebookCallback = module.exports.facebookCallback = function(restCtx, params, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/facebook/callback', 'GET', params, callback);
};

/**
 * Initiate the three-legged OAuth authorization steps for Google authentication
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        An error object, if any
 * @param  {String}         callback.body       The response body
 * @param  {Object}         callback.response   The HTTP response object
 */
var googleRedirect = module.exports.googleRedirect = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/google', 'POST', null, callback);
};

/**
 * Send a request to the callback endpoint for Google authentication
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL
 * @param  {Object}         params              Any OAuth parameters you wish to include in the request
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        An error object, if any
 * @param  {String}         callback.body       The response body
 * @param  {Object}         callback.response   The HTTP response object
 */
var googleCallback = module.exports.googleCallback = function(restCtx, params, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/google/callback', 'GET', params, callback);
};

/**
 * Initiate authentication with a CAS server
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        An error object, if any
 * @param  {String}         callback.body       The response body
 * @param  {Object}         callback.response   The HTTP response object
 */
var casRedirect = module.exports.casRedirect = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/cas', 'POST', null, callback);
};

/**
 * Send a request to the callback endpoint for CAS authentication
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL
 * @param  {Object}         params              Extra query string parameters that should be sent along
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        An error object, if any
 * @param  {String}         callback.body       The response body
 * @param  {Object}         callback.response   The HTTP response object
 */
var casCallback = module.exports.casCallback = function(restCtx, params, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/cas/callback', 'GET', params, callback);
};

/**
 * Redirect a user from a tenant to the SP
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL
 * @param  {String}         redirectUrl         The URL where the user should be redirect to once he succesfully authenticates
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        An error object, if any
 * @param  {String}         callback.body       The response body
 * @param  {Object}         callback.response   The HTTP response object
 */
var shibbolethTenantRedirect = module.exports.shibbolethTenantRedirect = function(restCtx, redirectUrl, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/shibboleth', 'POST', {'redirectUrl': redirectUrl}, callback);
};

/**
 * Redirect a user from the SP to the IdP
 *
 * @param  {RestContext}    restCtx                 Standard REST Context object that contains the current tenant URL
 * @param  {Object}         params                  The query string parameters for this endpoint
 * @param  {String}         params.tenantAlias      The alias of the tenant on which the user wants to authenticate sign on
 * @param  {String}         params.signature        The signature for the tenant alias
 * @param  {Number}         params.expires          The time in ms since epoch when the signature expires
 * @param  {Function}       callback                Standard callback method
 * @param  {Object}         callback.err            An error object, if any
 * @param  {String}         callback.body           The response body
 * @param  {Object}         callback.response       The HTTP response object
 */
var shibbolethSPRedirect = module.exports.shibbolethSPRedirect = function(restCtx, params, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/shibboleth/sp', 'GET', params, callback);
};

/**
 * The request Apache's mod_shib would make to our app server once a user authenticates
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL
 * @param  {Object}         attributes          The attributes that should be sent to the app server
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        An error object, if any
 * @param  {String}         callback.body       The response body
 * @param  {Object}         callback.response   The HTTP response object
 */
var shibbolethSPCallback = module.exports.shibbolethSPCallback = function(restCtx, attributes, callback) {
    restCtx.additionalHeaders = attributes;
    RestUtil.RestRequest(restCtx, '/api/auth/shibboleth/sp/callback', 'GET', null, function() {
        delete restCtx.additionalHeaders;
        return callback.apply(this, arguments);
    });
};

/**
 * Send a request to the tenant callback endpoint for Shibboleth authentication
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL
 * @param  {Object}         params              The query string parameters for this endpoint
 * @param  {String}         params.userId       The id of the user that will be signing in
 * @param  {String}         params.signature    A signature for the user id
 * @param  {Number}         params.expires      The time in ms since epoch when the signature expires
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        An error object, if any
 * @param  {String}         callback.body       The response body
 * @param  {Object}         callback.response   The HTTP response object
 */
var shibbolethTenantCallback = module.exports.shibbolethTenantCallback = function(restCtx, params, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/shibboleth/callback', 'GET', params, callback);
};

/**
 * Log a user in with LDAP credentials through the REST API
 *
 * @param  {RestContext}    restCtx         Standard REST Context object that contains the current tenant URL
 * @param  {String}         username        The username that identifies a user in LDAP
 * @param  {String}         password        The corresponding password
 * @param  {Function}       callback        Standard callback method
 * @param  {Object}         callback.err    An error that occurred, if any
 */
var ldapLogin = module.exports.ldapLogin = function(restCtx, username, password, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/ldap', 'POST', {'username': username, 'password': password}, callback);
};
