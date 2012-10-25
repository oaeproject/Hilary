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
 * Creates a user through the REST API.
 * Optional arguments will only be added if they are defined and will be sent as is.
 *
 * @param  {RestContext}    restCtx                       Standard REST Context object that contains the current tenant URL and the current user credentials. For this function to work, the passed in restCtx should either be for a global/tenant admin or for an anonymous user with reCaptcha disabled.
 * @param  {String}         username                      The username this user can login with.
 * @param  {String}         password                      The password for this user.
 * @param  {String}         displayName                   A display name, if this is left undefined the first and last name will be concatenated.
 * @param  {Object}         additionalOptions             Additional optional parameters that need to be passed.
 * @param  {String}         additionalOptions.visibility  The user's visibility setting. This can be public, loggedin or private.
 * @param  {String}         additionalOptions.locale      The user's locale
 * @param  {String}         additionalOptions.timezone    The user's timezone
 * @param  {Function}       callback                      Standard callback method takes arguments `err` and `resp`
 * @param  {Object}         callback.err                  Error object containing error code and error message
 * @param  {User}           callback.response             A User object representing the created user
 */
var createUser = module.exports.createUser = function(restCtx, username, password, displayName, additionalOptions, callback) {
    additionalOptions = additionalOptions || {};
    var postData = {
        'username': username,
        'password': password,
        'visibility': additionalOptions.visibility,
        'locale': additionalOptions.locale,
        'timezone': additionalOptions.timezone,
        'firstName': 'FirstName',
        'lastName': 'LastName',
        'displayName': displayName
    };
    RestUtil.RestRequest(restCtx, '/api/user/create', 'POST', postData, callback);
};

/**
 * Gets a user's me feed through the REST API.
 * @param  {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Function}               callback            Standard callback method takes arguments `err` and `resp`
 * @param  {Object}                 callback.err        Error object containing error code and error message
 * @param  {Object}                 callback.response   The user's me feed
 */
var getMe = module.exports.getMe = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/me', 'GET', null, callback);
};

/**
 * Get a user basic profile through the REST API.
 * @param  {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}                 userId              User id of the profile you wish to retrieve
 * @param  {Function}               callback            Standard callback method takes arguments `err` and `resp`
 * @param  {Object}                 callback.err        Error object containing error code and error message
 * @param  {Object}                 callback.response   The user's basic profile
 */
var getUser = module.exports.getUser = function(restCtx, userId, callback) {
    RestUtil.RestRequest(restCtx, '/api/user/' + encodeURIComponent(userId), 'GET', null, callback);
};


/**
 * Update a user's basic profile through the REST API.
 * @param  {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}                 userId              The user id of the user we're trying to update
 * @param  {Object}                 params              Object representing the profile fields that need to be updated. The keys are the profile fields, the values are the profile field values
 * @param  {Function}               callback            Standard callback method takes argument `err`
 * @param  {Object}                 callback.err        Error object containing error code and error message
 */
var updateUser = module.exports.updateUser = function(restCtx, userId, params, callback) {
    RestUtil.RestRequest(restCtx, '/api/user/' + encodeURIComponent(userId), 'POST', params, callback);
};

/**
 * Change a user's password through the REST API.
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
    RestUtil.RestRequest(restCtx, '/api/user/' + encodeURIComponent(userId) + '/password', 'POST', params, callback);
};
