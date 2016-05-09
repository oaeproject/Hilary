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

/**
 * Selectively reprocess content previews.
 * A valid request will test each content and/or revision against the provided filters. All the filters are ANDed together and
 * only those content items who pass all the `content_*` filters will be selected. Further more if you've
 * specified any `revision_*` filters, only the revisions that match these revisions will be selected for reprocessing.
 *
 * It's strongly recommended that you be as specific as possible as this is not a light-weight operation.
 *
 * A filter which allow for multiple values (ex: filtering based on mime) will check if the content/revision item matches against
 * one of the provided values.
 *
 * @param  {RestContext}    globalAdminRestContext              A global administration context that can be used to reprocess all preview items. This context must be bound to the global admin server, not a user tenant
 * @param  {Object}         filters                             A set of filters that can be used to filter the content and/or revisions that need reprocessing
 * @param  {String[]}       filters.content_createdBy           Filter content based on who it was created by. This should be the user ID of the person who create the piece of conte
 * @param  {String[]}       filters.content_resourceSubType     Filter content based on its resourceSubType. Possible values are any combination of `file`, `link`, or `collabdoc`
 * @param  {String[]}       filters.content_previewsStatus      Filter content based on the preview processing status. Possible values are any combination of `error`, `ignored`, `pending` or `done`
 * @param  {String[]}       filters.revision_mime               Filter based on the mime type of a file. Only useful in combination with `content_resourceSubType: file`
 * @param  {Number}         filters.revision_createdAfter       Filter those revisions who were created after a certain timestamp. The value of the timestamp should be specified in ms since epoch
 * @param  {Number}         filters.revision_createdBefore      Filter those revisions who were created before a certain timestamp. The value of the timestamp should be specified in ms since epoch
 * @param  {String[]}       filters.revision_createdBy          Filter the revisions based on who created them. This should be the user ID of the person who created the revision
 * @param  {Function}       callback                            Invoked when the request completes. The actuall reprocessing happens async
 */
var reprocessPreviews = module.exports.reprocessPreviews = function(globalAdminRestContext, filters, callback) {
    RestUtil.RestRequest(globalAdminRestContext, '/api/content/reprocessPreviews', 'POST', filters, callback);
};

/**
 * Expand a short URL
 *
 * @param  {RestContext}    restCtx                         The rest context
 * @param  {String}         url                             The URL to expand
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Object}         callback.data                   The returned data
 * @param  {String}         callback.data['long-url']       The expanded URL
 */
var expandUrl = module.exports.expandUrl = function(restCtx, url, callback) {
    var data = {
        'url': RestUtil.encodeURIComponent(url)
    };
    RestUtil.RestRequest(restCtx, '/api/longurl/expand', 'GET', data, callback);
};
