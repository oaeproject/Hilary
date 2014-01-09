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

var CropAPI = require('./api.crop');
var RestUtil = require('./util');

/**
 * Creates a user through the REST API.
 * Optional arguments will only be added if they are defined and will be sent as is.
 *
 * @param  {RestContext}    restCtx                         Standard REST Context object that contains the current tenant URL and the current user credentials. For this function to work, the passed in restCtx should either be for a global/tenant admin or for an anonymous user with reCaptcha disabled.
 * @param  {String}         username                        The username this user can login with.
 * @param  {String}         password                        The password for this user.
 * @param  {String}         displayName                     The display name for the user
 * @param  {Object}         [additionalOptions]             Additional optional parameters that need to be passed.
 * @param  {String}         [additionalOptions.visibility]  The user's visibility setting. This can be public, loggedin or private.
 * @param  {String}         [additionalOptions.locale]      The user's locale
 * @param  {String}         [additionalOptions.timezone]    The user's timezone
 * @param  {String}         [additionalOptions.publicAlias] The publically-available alias for users to see when the user's display name is protected
 * @param  {Boolean}        [additionalOptions.acceptedTC]  Whether or not the user accepts the Terms and Conditions
 * @param  {Function}       callback                        Standard callback method takes arguments `err` and `resp`
 * @param  {Object}         callback.err                    Error object containing error code and error message
 * @param  {User}           callback.response               A User object representing the created user
 */
var createUser = module.exports.createUser = function(restCtx, username, password, displayName, additionalOptions, callback) {
    additionalOptions = additionalOptions || {};
    var params = {
        'username': username,
        'password': password,
        'displayName': displayName,
        'email': additionalOptions.email,
        'visibility': additionalOptions.visibility,
        'locale': additionalOptions.locale,
        'timezone': additionalOptions.timezone,
        'publicAlias': additionalOptions.publicAlias,
        'acceptedTC': additionalOptions.acceptedTC
    };
    RestUtil.RestRequest(restCtx, '/api/user/create', 'POST', params, callback);
};

/**
 * Gets a user's me feed through the REST API.
 *
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
 *
 * @param  {RestContext}     restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}          userId              User id of the profile you wish to retrieve
 * @param  {Function}        callback            Standard callback method takes arguments `err` and `resp`
 * @param  {Object}          callback.err        Error object containing error code and error message
 * @param  {User}            callback.response   The user's basic profile
 */
var getUser = module.exports.getUser = function(restCtx, userId, callback) {
    RestUtil.RestRequest(restCtx, '/api/user/' + RestUtil.encodeURIComponent(userId), 'GET', null, callback);
};

/**
 * Update a user's basic profile through the REST API.
 *
 * @param  {RestContext}     restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}          userId              The user id of the user we're trying to update
 * @param  {Object}          params              Object representing the profile fields that need to be updated. The keys are the profile fields, the values are the profile field values
 * @param  {Function}        callback            Standard callback method takes argument `err`
 * @param  {Object}          callback.err        Error object containing error code and error message
 */
var updateUser = module.exports.updateUser = function(restCtx, userId, params, callback) {
    RestUtil.RestRequest(restCtx, '/api/user/' + RestUtil.encodeURIComponent(userId), 'POST', params, callback);
};

/**
 * Uploads a new profile picture for a user and optionally resize it.
 *
 * @param  {RestContext}     restCtx                 Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}          userId                  The user id of the user we're trying to upload a new image for.
 * @param  {Function}        fileGenerator           A method that returns an open stream to a file.
 * @param  {Object}          [selectedArea]          If specified, this will crop the picture to the required rectangle and generate the 2 sizes.
 * @param  {Number}          [selectedArea.x]        The top left x coordinate.
 * @param  {Number}          [selectedArea.y]        The top left y coordinate.
 * @param  {Number}          [selectedArea.width]    The width of the rectangle
 * @param  {Number}          [selectedArea.height]   The height of the rectangle
 * @param  {Function}        callback                Standard callback method takes argument `err`
 * @param  {Object}          callback.err            Error object containing error code and error message
 * @param  {Object}          callback.principal      The updated principal object.
 */
var uploadPicture = module.exports.uploadPicture = function(restCtx, userId, file, selectedArea, callback) {
    var params = {
        'file': file
    };
    if (!selectedArea) {
        RestUtil.RestRequest(restCtx, '/api/user/' + RestUtil.encodeURIComponent(userId) + '/picture', 'POST', params, callback);
    } else {
        RestUtil.RestRequest(restCtx, '/api/user/' + RestUtil.encodeURIComponent(userId) + '/picture', 'POST', params, function(err){
            if (err) {
                return callback(err);
            }
            CropAPI.cropPicture(restCtx, userId, selectedArea, callback);
        });
    }
};

/**
 * Download a user's picture. Returns a 404 if the user has no picture.
 * This will only return the image when it's run against the nginx server, as it's nginx who sends the picture stream.
 *
 * @param  {RestContext}     restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}          userId              The ID of the user we're trying to download a picture from.
 * @param  {String}          size                The picture size. One of `small`, `medium` or `large`.
 * @param  {Function}        callback            Standard callback method takes argument `err`
 * @param  {Object}          callback.err        Error object containing error code and error message
 * @param  {Object}          callback.picture    The raw picture for this group.
 */
var downloadPicture = module.exports.downloadPicture = function(restCtx, userId, size, callback) {
    if (!size) {
        return callback({'code': 400, 'msg': 'Missing size parameter'});
    }
    getUser(restCtx, userId, function(err, user) {
        if (err) {
            return callback(err);
        }
        if (!user.picture[size]) {
            return callback({'code': 404, 'msg': 'This user has no picture.'});
        }
        var url = user.picture[size];
        RestUtil.RestRequest(restCtx, url, 'GET', null, callback);
    });
};

/**
 * Set or unset a user as a tenant admin.
 *
 * @param  {RestContext}   restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}        userId          The user id of the user we're going to update
 * @param  {Boolean}       value           Whether or not the user should be tenant admin. `true` if they should, any other value if they should be unset
 * @param  {Function}      callback        Standard callback method takes argument `err`
 * @param  {Object}        callback.err    Error object containing error code and error message
 */
var setTenantAdmin = module.exports.setTenantAdmin = function(restCtx, userId, value, callback) {
    RestUtil.RestRequest(restCtx, '/api/user/' + RestUtil.encodeURIComponent(userId) + '/admin', 'POST', {'admin': (value === true)}, callback);
};

/**
 * Get available timezones and offsets from UTC
 *
 * @param  {RestContext}   restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Function}      callback        Standard callback method takes argument `err`
 * @param  {Object}        callback.err    Error object containing error code and error message
 */
var getTimezones = module.exports.getTimezones = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/timezones', 'GET', null, callback);
};

/**
 * Gets the Terms and Conditions for a tenant.
 * If the Terms and Conditions for a given locale cannot be found, the default Terms and Conditions will be returned.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         locale              The locale in which the Terms and Conditions should be retrieved. It the Terms and Conditions are not available in that locale, the default Terms and Conditions will be returned
 * @param  {Function}       callback            Standard callback method takes argument `err`
 * @param  {Object}         callback.err        Error object containing error code and error message
 */
var getTermsAndConditions = module.exports.getTermsAndConditions = function(restCtx, locale, callback) {
    RestUtil.RestRequest(restCtx, '/api/user/termsAndConditions', 'GET', {'locale': locale}, callback);
};

/**
 * Accepts the Terms and Conditions for a user
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         userId              The id of the user that accepts the Terms and Conditions
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        Standard error object, if any
 * @param  {User}           callback.user       The updated user object
 */
var acceptTermsAndConditions = module.exports.acceptTermsAndConditions = function(restCtx, userId, callback) {
    var url = '/api/user/' + RestUtil.encodeURIComponent(userId) + '/termsAndConditions';
    RestUtil.RestRequest(restCtx, url, 'POST', {}, callback);
};
