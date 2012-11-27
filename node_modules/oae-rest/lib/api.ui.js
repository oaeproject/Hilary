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
 * Get a list of all of the available modules through the REST API.
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String[]}     files               An Array of URLs that should be requested.
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 * @param  {String[]}     callback.data       Array containing data file objects for the requests static file URLs.
 */
var getStaticFiles = module.exports.getStaticFiles = function(restCtx, files, callback) {
    if (!Array.isArray(files)) {
        files = [ files ];
    }
    RestUtil.RestRequest(restCtx, '/api/staticfiles', 'GET', {'files': files}, callback);
};

/**
 * Get all the widget configuration files.
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       jsonpCallback       An optional string which if used will ask the server to return jsonp output.
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 * @param  {Object}       callback.configs    The widget configuration files.
 */
var getWidgetConfigs = module.exports.getWidgetConfigs = function(restCtx, jsonpCallback, callback) {
    var url = '/api/widgets';
    if (jsonpCallback) {
        url += '?callback=' + jsonpCallback;
    }
    RestUtil.RestRequest(restCtx, url, 'GET', null, callback);
};
