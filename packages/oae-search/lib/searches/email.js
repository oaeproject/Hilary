/*!
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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

import _ from 'underscore';

import * as OaeUtil from 'oae-util/lib/util';
import * as SearchUtil from 'oae-search/lib/util';
import * as TenantsAPI from 'oae-tenants/lib/api';

import { Validator as validator } from 'oae-util/lib/validator';
const { otherwise } = validator;
import pipe from 'ramda/src/pipe';

/**
 * A search that searches on an exact "email" match, scoping its results by the specified scope and
 * access.
 *
 * In addition to the specific `opts` parameters documented here, there are more generic options available that impact all
 * searches. @see SearchAPI#search for more information.
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {Object}         [opts]              Email search options
 * @param  {String[]}       [opts.q]            The email to search for
 * @param  {String}         [opts.scope]        The scope of the query (One of `SearchConstants.general.SCOPES_ALL`)
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {SearchResult}   callback.results    An object that represents the results of the query
 */
const queryBuilder = function(ctx, opts, callback) {
  // Sanitize custom search options
  opts = opts || {};
  opts.limit = OaeUtil.getNumberParam(opts.limit, 10, 1, 25);

  try {
    pipe(
      validator.isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'Only authenticated users can use email search'
      })
    )(ctx);

    const query = opts.q || '';
    pipe(
      validator.isEmail,
      otherwise({
        code: 400,
        msg: 'An invalid email address has been specified'
      })
    )(query);
  } catch (error) {
    return callback(error);
  }

  // Ensure the email address being searched is lower case so it is case insensitive
  const email = opts.q.toLowerCase();

  const filterResources = SearchUtil.filterResources(['user']);
  const filterInteractingTenants = SearchUtil.filterInteractingTenants(ctx.user().tenant.alias);

  // When searching for users by email, we can ignore profile visibility in lieu of an email
  // exact match. The user profile is still "scrubbed" of private information on its way out,
  // however we enable the ability for a user to share with that profile if they know the email
  // address
  const query = SearchUtil.createEmailQuery(email);
  const queryOpts = _.extend({}, opts, { minScore: 0 });
  const filter = SearchUtil.filterAnd(filterResources, filterInteractingTenants);
  return callback(null, SearchUtil.createQuery(query, filter, queryOpts));
};

/**
 * Add the tenant object of the tenant whose email domain matches
 * the given email address. If no tenant matched, the guest tenant
 * will be returned
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {Object}         [opts]              Email search options
 * @param  {String[]}       [opts.q]            The email to search for
 * @param  {String}         [opts.scope]        The scope of the query (One of `SearchConstants.general.SCOPES_ALL`)
 * @param  {Object}         resuls              The transformed search results
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Object}         callback.results    An object that represents the results of the query
 */
const postProcessor = function(ctx, opts, results, callback) {
  results.tenant = TenantsAPI.getTenantByEmail(opts.q);
  return callback(null, results);
};

export { queryBuilder, postProcessor };
