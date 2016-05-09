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

/**
 * REST Context object used to represent a tenant on which a REST request is done, as well as
 * the user creditentials of the user performing the action.
 *
 * @param  {String}     host                    The URL of the tenant on which the request is done. This should include the protocol (e.g. http://gt.oae.com) and should not have a trailing slash.
 * @param  {Object}     [opts]                  Optional parameters for the request
 * @param  {String}     [opts.username]         The username of the user performing the REST request. This should be null if the current user is anonymous
 * @param  {String}     [opts.userPassword]     The password of the user performing the REST request. This should be null if the current user is anonymous
 * @param  {String}     [opts.hostHeader]       The host header that should be sent on the REST request. This can be set to avoid having to set up the actual hosts on a development environment. When this is set, the host should be the direct URL to the tenant express server
 * @param  {String}     [opts.refererHeader]    The referer header that should be sent on the REST request. By default it will be set as the target host of the request
 * @param  {Boolean}    [opts.strictSSL]        Whether or not the server is using a valid SSL certificate. If `true`, any attempts to connect to the REST endpoints using an invalid certificate should result in an error and not be ignored. If `false`, a valid certificate will not be required. By default, this will be set to `true`
 * @param  {Boolean}    [opts.followRedirect]  Whether or not redirects should be followed automatically. Default: `true`
 */
var RestContext = module.exports.RestContext = function(host, opts) {
    var that = {};

    opts = opts || {};

    that.host = host;
    that.username = opts.username;
    that.userPassword = opts.userPassword;
    that.hostHeader = opts.hostHeader;
    that.refererHeader = opts.refererHeader;
    that.additionalHeaders = opts.additionalHeaders;
    that.cookieJar = null;
    that.strictSSL = (opts.strictSSL !== false);
    that.followRedirect = (opts.followRedirect !== false);

    return that;
};
