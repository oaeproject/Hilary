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
 * Log a user in through the REST API.
 * @param  {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. For this function to work, the passed in restCtx should be an anonymous REST context
 * @param  {String}                 userId              User id for the user logging in. This should not be the globally unique userid (e.g. u:cam:nm417), but the login id a user would actually use (e.g. nm417)
 * @param  {String}                 password            The user's password
 * @param  {Function}               callback            Standard callback method takes argument `err`
 * @param  {Object}                 callback.err        Error object containing error code and error message                        
 */
var login = module.exports.login = function(restCtx, userId, password, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/login', 'POST', {'username': userId, 'password': password}, callback);
};

/**
 * Log a user out through the REST API.
 * @param  {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials. This is the user that will be logged out
 * @param  {Function}               callback            Standard callback method takes argument `err`
 * @param  {Object}                 callback.err        Error object containing error code and error message   
 */
var logout = module.exports.logout = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/auth/logout', 'POST', null, callback);
};
