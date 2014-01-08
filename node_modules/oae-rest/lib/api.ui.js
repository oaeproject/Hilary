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

var RestUtil = require('./util');

/**
 * Get all of the widget manifest files through the REST API.
 *
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 * @param  {Object}       callback.manifests  The aggregated widget manifest files where the keys represent the widget ids and the values contain the widget manifest.
 */
var getWidgetManifests = module.exports.getWidgetManifests = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/ui/widgets', 'GET', null, callback);
};

/**
 * Get the file content for a number of static files through the REST API.
 *
 * @param  {RestContext}        restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String|String[]}    files               A path or array of paths relative to the 3akai-ux folder that need to be retrieved.
 * @param  {Function}           callback            Standard callback method
 * @param  {Object}             callback.err        Error object containing error code and error message
 * @param  {String[]}           callback.data       Array containing the file content for the requested static files.
 */
var getStaticBatch = module.exports.getStaticBatch = function(restCtx, files, callback) {
    if (!Array.isArray(files)) {
        files = [files];
    }
    RestUtil.RestRequest(restCtx, '/api/ui/staticbatch', 'GET', {'files': files}, callback);
};

/**
 * Get the file content for a number of static files through the REST API.
 *
 * @param  {RestContext}        restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String|String[]}    files               A path or array of paths relative to the 3akai-ux folder that need to be retrieved.
 * @param  {Function}           callback            Standard callback method
 * @param  {Object}             callback.err        Error object containing error code and error message
 * @param  {String[]}           callback.data       Array containing the file content for the requested static files.
 */
var getStaticBatch = module.exports.getStaticBatch = function(restCtx, files, callback) {
    if (!Array.isArray(files)) {
        files = [files];
    }
    RestUtil.RestRequest(restCtx, '/api/ui/staticbatch', 'GET', {'files': files}, callback);
};

/**
 * Retrieve the CSS for a specific tenant.
 *
 * @param  {RestContext}        restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Function}           callback            Standard callback method
 * @param  {Object}             callback.err        Error object containing error code and error message
 * @param  {String}             callback.css        The skin file for this tenant (in CSS).
 */
var getSkin = module.exports.getSkin = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/ui/skin', 'GET', null, callback);
};

/**
 * Get the skin variables that are defined in the UI's skin file.
 *
 * @param  {RestContext}    restCtx                 Standard REST Context object associated to an administrator.
 * @param  {String}         tenantAlias             The alias of the tenant for which the variables should be retrieved.
 * @param  {Function}       callback                Standard callback method
 * @param  {Object}         callback.err            Error object containing error code and error message
 * @param  {Object}         callback.variables      The variables grouped by their respective groups.
 */
var getSkinVariables = module.exports.getSkinVariables = function(restCtx, tenantAlias, callback) {
    RestUtil.RestRequest(restCtx, '/api/ui/skin/variables', 'GET', {'tenant': tenantAlias}, callback);
};