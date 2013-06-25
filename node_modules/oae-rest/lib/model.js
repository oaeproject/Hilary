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

/**
 * REST Context object used to represent a tenant on which a REST request is done, as well as
 * the user creditentials of the user performing the action.
 *
 * @param  {String}      host            The URL of the tenant on which the request is done. This should include the protocol (e.g. http://gt.oae.com) and should not have a trailing slash.
 * @param  {String}      username        The username of the user performing the REST request. This should be null if the current user is anonymous.
 * @param  {String}      userPassword    The password of the user performing the REST request. This should be null if the current user is anonymous.
 * @param  {String}      [hostHeader]    The host header that should be sent on the REST request. This can be set to avoid having to set up the actual hosts on a development environment. When this is set, the host should be the direct URL to the tenant express server
 * @param  {String}      [refererHeader] The referer header that should be sent on the REST request. By default it will be set as the target host of the request
 */
var RestContext = module.exports.RestContext = function(host, username, userPassword, hostHeader, refererHeader) {
    var that = {};

    that.host = host;
    that.username = username;
    that.userPassword = userPassword;
    that.hostHeader = hostHeader;
    that.refererHeader = refererHeader;
    that.cookieJar = null;

    return that;
};
