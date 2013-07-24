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
 * Reprocess the preview of a revision of a particular content item.
 *
 * @param  {RestContext}    restCtx         The rest context
 * @param  {String}         contentId       The id of the content item whose revision to reprocess
 * @param  {String}         revisionId      The id of the revision whose preview to reprocess
 * @param  {Function}       callback        Invoked when the processing job has been triggered
 * @param  {Object}         callback.err    An error that occurred, if any
 */
var reprocessPreview = module.exports.reprocessPreview = function(restCtx, contentId, revisionId, callback) {
    contentId = RestUtil.encodeURIComponent(contentId);
    revisionId = RestUtil.encodeURIComponent(revisionId);
    RestUtil.RestRequest(restCtx, '/api/content/' + contentId + '/revision/'+ revisionId + '/reprocessPreview', 'POST', null, callback);
};
