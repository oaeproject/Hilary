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

import * as OaeUtil from 'oae-util/lib/util';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao';
import * as SearchUtil from 'oae-search/lib/util';
import * as FollowingAuthz from 'oae-following/lib/authz';

import { Validator as validator } from 'oae-authz/lib/validator';
const { defaultToEmptyArray, defaultToEmptyObject, isUserId, unless } = validator;
import { head } from 'ramda';
import { FollowingConstants } from 'oae-following/lib/constants';

/**
 * Search that searches a user's followers list.
 *
 * In addition to the specific `opts` parameters documented here, there are more generic options available that impact all
 * searches. @see SearchAPI#search for more information.
 *
 * @param  {Context}       ctx                 Standard context object containing the current user and the current tenant
 * @param  {Object}        opts                General search options
 * @param  {String[]}      opts.pathParams     An array of required parameters for the search
 * @param  {String}        opts.pathParams[0]  The user whose followers to search
 * @param  {Function}      callback            Standard callback function
 * @param  {Object}        callback.err        An error that occurred, if any
 * @param  {SearchResult}  callback.results    An object that represents the results of the query
 */
export default function(ctx, opts, callback) {
  // Sanitize the search options
  opts = defaultToEmptyObject(opts);
  opts.pathParams = defaultToEmptyArray(opts.pathParams);
  opts.userId = head(opts.pathParams);
  opts.limit = OaeUtil.getNumberParam(opts.limit, 12, 1, 25);

  try {
    unless(isUserId, {
      code: 400,
      msg: 'Must specificy an id of a user to search their followers'
    })(opts.userId);
  } catch (error) {
    return callback(error);
  }

  PrincipalsDAO.getPrincipal(opts.userId, (err, user) => {
    if (err) {
      return callback(err);
    }

    FollowingAuthz.canViewFollowers(ctx, user, err => {
      if (err) {
        return callback(err);
      }

      return _search(ctx, opts, callback);
    });
  });
}

/**
 * Perform the search that searches a user's followers list
 *
 * @param  {Context}       ctx                 Standard context object containing the current user and the current tenant
 * @param  {Object}        opts                General search options
 * @param  {Function}      callback            Standard callback function
 * @param  {Object}        callback.err        An error that occurred, if any
 * @param  {SearchResult}  callback.results    An object that represents the results of the query
 * @api private
 */
const _search = function(ctx, opts, callback) {
  // The query object for the Query DSL
  const query = SearchUtil.createQueryStringQuery(opts.q);

  // The filter object for the Query DSL
  const filter = SearchUtil.filterAnd(
    SearchUtil.filterResources(['user']),
    SearchUtil.createHasChildQuery(
      FollowingConstants.search.MAPPING_RESOURCE_FOLLOWING,
      SearchUtil.filterTerms('following', [opts.userId])
    )
  );

  // Wrap the query and filter into the top-level Query DSL "query" object and return it
  return callback(null, SearchUtil.createQuery(query, filter, opts));
};
