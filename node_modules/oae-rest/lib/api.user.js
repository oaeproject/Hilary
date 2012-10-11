/*
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
 * @param {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                     user credentials. For this function to work, the passed in restCtx should either
 *                                                     be for a global/tenant admin or for an anonymous user with reCaptcha disabled.
 * @param {String}                 username            The username this user can login with.
 * @param {String}                 password            The password for this user.
 * @param {String}                 visibility          This user his visibility setting. This can be public, loggedin or private.
 * @param {String}                 locale              The user his locale
 * @param {String}                 timezone            The user his timezone
 * @param {String}                 firstName           This user his first name.
 * @param {String}                 lastName            This user his last name,
 * @param {String}                 displayName         A display name, if this is left undefined the first and last name will be concatenated.
 * @param {Function(err, resp)}    callback            Standard callback method
 * @param {Object}                 callback.err        Error object containing error code and error message
 * @param {Object}                 callback.response   The parsed server response.
 */
var createUser = module.exports.createUser = function (restCtx, username, password, visibility, locale, timezone, firstName, lastName, displayName, callback) {
    var postData = {
        'username': username,
        'password': password,
        'visibility': visibility,
        'locale': locale,
        'timezone': timezone,
        'firstName': firstName,
        'lastName': lastName,
        'displayName': displayName
    };
    RestUtil.RestRequest(restCtx, '/api/user/create', 'POST', postData, callback);
};