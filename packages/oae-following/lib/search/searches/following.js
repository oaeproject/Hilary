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

import * as PrincipalsDAO from 'oae-principals/lib/internal/dao';
import * as SearchUtil from 'oae-search/lib/util';
import * as FollowingAuthz from 'oae-following/lib/authz';

import { Validator as validator } from 'oae-authz/lib/validator';
import { FollowingConstants } from 'oae-following/lib/constants';

const { isUserId, unless } = validator;

/**
 * Search that searches through the list of user's that a user follows
 *
 * In addition to the specific `opts` parameters documented here, there are more generic options available that impact all
 * searches. @see SearchAPI#search for more information.
 *
 * @param  {Context}       ctx                 Standard context object containing the current user and the current tenant
 * @param  {Object}        opts                General search options
 * @param  {String[]}      opts.pathParams     An array of required parameters for the search
 * @param  {String}        opts.pathParams[0]  The user whose following list to search
 * @param  {Function}      callback            Standard callback function
 * @param  {Object}        callback.err        An error that occurred, if any
 * @param  {SearchResult}  callback.results    An object that represents the results of the query
 */
function searchFollowing(ctx, options, callback) {
  // Sanitize the search options
  options = SearchUtil.sanitizeSearchParams(options);

  try {
    unless(isUserId, {
      code: 400,
      msg: 'Must specificy an id of a user to search their following list'
    })(options.userId);
  } catch (error) {
    return callback(error);
  }

  PrincipalsDAO.getPrincipal(options.userId, (error, user) => {
    if (error) {
      return callback(error);
    }

    FollowingAuthz.canViewFollowing(ctx, user, (error_) => {
      if (error_) {
        return callback(error_);
      }

      return _search(ctx, options, callback);
    });
  });
}

export default searchFollowing;

/**
 * Perform the search that searches a user's list of followed users
 *
 * @param  {Context}       ctx                 Standard context object containing the current user and the current tenant
 * @param  {Object}        opts                General search options
 * @param  {Function}      callback            Standard callback function
 * @param  {Object}        callback.err        An error that occurred, if any
 * @param  {SearchResult}  callback.results    An object that represents the results of the query
 * @api private
 */
const _search = function (ctx, options, callback) {
  // The query object for the Query DSL
  const query = { bool: { should: [SearchUtil.createQueryStringQuery(options.q)] } };

  // The filter object for the Query DSL
  const filter = SearchUtil.filterAnd(
    SearchUtil.filterResources(['user']),
    SearchUtil.createHasChildQuery(
      FollowingConstants.search.MAPPING_RESOURCE_FOLLOWERS,
      SearchUtil.filterTerms('followers', [options.userId])
    )
  );

  // Wrap the query and filter into the top-level Query DSL "query" object and return it
  return callback(null, SearchUtil.createQuery(query, filter, options));
};
