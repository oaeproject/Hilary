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
 * Gets the embed code for a mediacore media item.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           The id of the content item whose embed code to fetch
 * @param  {Function}       callback            Standard callback method takes arguments `err` and `resp`
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Object}         callback.response   An object with property `html` that holds the embed HTML source that can be used to embed the video
 */
var getEmbedCode = module.exports.getEmbedCode = function(restCtx, contentId, callback) {
    RestUtil.RestRequest(restCtx, '/api/mediacore/embed/' + RestUtil.encodeURIComponent(contentId), 'GET', null, callback);
};

/**
 * Notify the server that encoding for a particular media item has completed.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         mediaCoreId         The id of the mediacore item whose encoding has just completed
 * @param  {Object}         callback.err        Error object containing error code and error message
 */
var notifyEncodingComplete = module.exports.notifyEncodingComplete = function(restCtx, mediaCoreId, callback) {
    // The parameter convention on this differs a bit from the rest of the application because it is molded according to
    // mediacore's spec. It cannot change to become more consistent
    RestUtil.RestRequest(restCtx, '/api/mediacore/encodingCallback', 'POST', {'media_id': mediaCoreId}, callback);
};
