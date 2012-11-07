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
 * Perform a general search.
 *
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param {String}                  resourceType        The type of resource to search on (all, content, group or user) (default: all)
 * @param {Object}                  opts                Options for the search
 * @param {String}                  opts.q              The full-text search term (default: *)
 * @param {Number}                  opts.size           The number of items to retrieve. If -1, then return all. (default: -1)
 * @param {Number}                  opts.from           What item to start on in the results (default: 0)
 * @param {String}                  opts.sort           The direction of sorting: asc, or desc (default: asc)
 * @param {Function}                callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 * @param {SearchResult}            callback.result     SearchResult object representing the search result
 */
var searchGeneral = module.exports.searchGeneral = function(restCtx, resourceType, opts, callback) {
    opts = opts || {};
    resourceType = resourceType || 'all';

    opts.q = opts.q || '*';
    opts.size = (opts.size >= 0) ? opts.size : -1;
    opts.from = opts.from || 0;
    opts.sort = opts.sort || 'asc';

    _search(restCtx, '/api/search/general/' + encodeURIComponent(resourceType), 'GET', opts, callback);
};
 
/**
 * Perform a search.
 *
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param {String}                  path                The path of the request
 * @param {String}                  method              The method of the request
 * @param {Object}                  opts                The additional query string parameters
 * @param {Function}                callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 * @param {SearchResult}            callback.result     SearchResult object representing the search result
 */
var _search = function(restCtx, path, method, opts, callback) {
    // refresh first to ensure the index is up to date
    // pause for a little bit to ensure any asynchronous index updates in the event queue have had time to make it to elastic search
    setTimeout(RestUtil.RestRequest, 50, restCtx, '/api/search/_refresh', 'POST', null, function(err) {
        if (err) {
            return callback(new Error('Refreshing the search index has failed. Has refreshing been enabled?'));
        }

        // when getAll is true, it means we want to get all records, regardless of how many. this requires two requests (below)
        var getAll = false;
        if (opts.size === -1) {
            getAll = true;
            opts.size = 1;
        }

        RestUtil.RestRequest(restCtx, path, method, opts, function(err, result) {
            if (err) {
                return callback(err);
            }

            if (!getAll || result.total <= opts.size) {
                // we are either only interested in the specified page, or we've exhausted the results, return what we have
                return callback(null, result);
            } else {
                // we want to get all the results and we did not exhaust them in the first request. query again with the
                // actual total number of documents and return that result
                opts.size = result.total;
                RestUtil.RestRequest(restCtx, path, method, opts, callback);
            }
        });
    })
}