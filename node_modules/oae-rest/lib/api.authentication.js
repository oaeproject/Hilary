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
 * Log a user in through the REST API.
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
 * Log a user out through the REST API.
 *
 * @param  {RestContext}    restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials. This is the user that will be logged out
 * @param  {Function}       callback        Standard callback method takes argument `err`
 * @param  {Object}         callback.err    Error object containing error code and error message
 */
var logout = module.exports.logout = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/logout', 'POST', null, callback);
};

/**
 * Create a global administrator user with mapped local authentication credentials in the system.
 *
 * @param  {RestContext}    restCtx         Standard REST Context object that should be authenticated to the global admin tenant as a global administrator
 * @param  {String}         username        The username the user should use to log into the global administrator tenant
 * @param  {String}         password        The password the user should use to log into the global administrator tenant
 * @param  {String}         displayName     The display name of the administrator user
 * @param  {Function}       callback        Standard callback method
 * @param  {Object}         callback.err    An error that occurred, if any
 * @param  {User}           callback.user   The user object that was created
 */
var createGlobalAdminUser = module.exports.createGlobalAdminUser = function(restCtx, username, password, displayName, callback) {
    var opts = {
        'username': username,
        'password': password,
        'displayName': displayName
    };

    RestUtil.RestRequest(restCtx, '/api/auth/createGlobalAdminUser', 'POST', opts, callback);
};

/**
 * Change a user's password through the REST API.
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
