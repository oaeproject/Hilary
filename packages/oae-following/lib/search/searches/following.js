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

const OaeUtil = require('oae-util/lib/util');
const PrincipalsDAO = require('oae-principals/lib/internal/dao');
const SearchUtil = require('oae-search/lib/util');
const { Validator } = require('oae-authz/lib/validator');

const FollowingAuthz = require('oae-following/lib/authz');
const { FollowingConstants } = require('oae-following/lib/constants');

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
module.exports = function(ctx, opts, callback) {
  // Sanitize the search options
  opts = opts || {};
  opts.pathParams = opts.pathParams || [];
  opts.userId = opts.pathParams[0];
  opts.limit = OaeUtil.getNumberParam(opts.limit, 12, 1, 25);

  const validator = new Validator();
  validator
    .check(opts.userId, {
      code: 400,
      msg: 'Must specificy an id of a user to search their following list'
    })
    .isUserId();
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  PrincipalsDAO.getPrincipal(opts.userId, (err, user) => {
    if (err) {
      return callback(err);
    }

    FollowingAuthz.canViewFollowing(ctx, user, err => {
      if (err) {
        return callback(err);
      }

      return _search(ctx, opts, callback);
    });
  });
};

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
const _search = function(ctx, opts, callback) {
  // The query object for the Query DSL
  const query = SearchUtil.createQueryStringQuery(opts.q);

  // The filter object for the Query DSL
  const filter = SearchUtil.filterAnd(
    SearchUtil.filterResources(['user']),
    SearchUtil.createHasChildQuery(
      FollowingConstants.search.MAPPING_RESOURCE_FOLLOWERS,
      SearchUtil.filterTerms('followers', [opts.userId])
    )
  );

  // Wrap the query and filter into the top-level Query DSL "query" object and return it
  return callback(null, SearchUtil.createQuery(query, filter, opts));
};
