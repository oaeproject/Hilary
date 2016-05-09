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
 * Get a list of all of the available modules of a certain type through the REST API.
 *
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       type                The type of modules being listed. Accepted values are `backend` or `frontend`.
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 * @param  {String[]}     callback.modules    Array containing the names of all of the available modules
 */
var getModules = module.exports.getModules = function(restCtx, type, callback) {
    RestUtil.RestRequest(restCtx, '/api/doc/' + RestUtil.encodeURIComponent(type), 'GET', null, callback);
};

/**
 * Get the documentation of a particular module through the REST API.
 *
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       type                The type of module to get documentation for. Accepted values are `backend` or `frontend`.
 * @param  {String}       moduleId            The module to get the documentation for
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 * @param  {Dox}          callback.doc        Dox object containing the JSDoc information for the requested module
 */
var getModuleDocumentation = module.exports.getModuleDocumentation = function(restCtx, type, moduleId, callback) {
    RestUtil.RestRequest(restCtx, '/api/doc/' + RestUtil.encodeURIComponent(type) + '/' + RestUtil.encodeURIComponent(moduleId), 'GET', null, callback);
};

/**
 * Get the api resources that are documented with swagger.
 *
 * @param  {RestContext}    restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Function}       callback        Standard callback method
 * @param  {Object}         callback.err    An error that occurred, if any
 * @param  {Object}         callback.info   The swagger root information
 */
var getSwaggerResources = module.exports.getSwaggerResources = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/swagger', 'GET', null, callback);
};

/**
 * Get the swagger documentation for a specific api.
 *
 * @param  {RestContext}    restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Function}       callback        Standard callback method
 * @param  {Object}         callback.err    An error that occurred, if any
 * @param  {Object}         callback.info   The swagger information for the given api
 */
var getSwaggerApi = module.exports.getSwaggerApi = function(restCtx, id, callback) {
    RestUtil.RestRequest(restCtx, '/api/swagger/' + id, 'GET', null, callback);
};
