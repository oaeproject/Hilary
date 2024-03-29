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
 * A model object that represents a set of search results that may be returned to the client from a search request.
 *
 * For example:
 *
 * {
 *      "total": 27233,
 *      "results": [{ ... }, { ... }, ...]
 * }
 *
 * Note that "total" is the complete number of results in the search, and not the number of results in the `results` property
 * of the result object. The `results` property only represents the current page of results.
 *
 * @param  {Number}        total       The total number of results that match the request (not just in this page, in storage)
 * @param  {Object[]}      results     An array of documents that were returned from the search
 * @return {SearchResult}              An object that represents this search result
 */
const SearchResult = function (total, results) {
  const that = {};
  that.total = total;
  that.results = results;
  return that;
};

export { SearchResult };
