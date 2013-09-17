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

var RestUtil = require('./util');

/**
 * Gets the terms and conditions for a tenant.
 * If the T&C for a given locale cannot be found, the default T&C will be returned.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         locale              The locale you wish to retrieve the T&C in. If it could not be found, the default T&C will be used
 * @param  {Function}       callback            Standard callback method takes argument `err`
 * @param  {Object}         callback.err        Error object containing error code and error message
 */
var getTermsAndConditions = module.exports.getTermsAndConditions = function(restCtx, locale, callback) {
    RestUtil.RestRequest(restCtx, '/api/termsAndConditions', 'GET', {'locale': locale}, callback);
};
