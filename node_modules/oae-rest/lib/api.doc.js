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
 * Get a list of all of the available modules through the REST API.
 * @param {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                     user credentials
 * @param {Function(err, modules)} callback            Standard callback method
 * @param {Object}                 callback.err        Error object containing error code and error message 
 * @param {Array<String>}          callback.modules    Array containing the names of all of the available modules
 */
var getModules = module.exports.getModules = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/doc/modules', 'GET', null, callback);
};

/**
 * Get the documentation of a particular module through the REST API.
 * @param {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                     user credentials
 * @param {Function(err, doc)}     callback            Standard callback method
 * @param {Object}                 callback.err        Error object containing error code and error message 
 * @param {Dox}                    callback.doc        Dox object containing the JSDoc information for the requested module
 */
var getDoc = module.exports.getDoc = function(restCtx, moduleId, callback) {
    RestUtil.RestRequest(restCtx, '/api/doc/module/' + encodeURIComponent(moduleId), 'GET', null, callback);
};