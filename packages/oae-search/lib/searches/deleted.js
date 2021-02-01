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

import { isEmpty } from 'ramda';
import * as OaeUtil from 'oae-util/lib/util';

import { SearchConstants } from 'oae-search/lib/constants';
import * as SearchUtil from 'oae-search/lib/util';
const { filterAnd, filterResources, createQueryStringQuery, createQuery, filterScopeAndAccess } = SearchUtil;

/**
 * Search that searches through deleted resources
 *
 * In addition to the specific `opts` parameters documented here, there are more generic options available that impact all
 * searches. @see SearchAPI#search for more information.
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {Object}         [opts]                  General search options
 * @param  {String}         [opts.scope]            The scope of the query (One of `SearchConstants.general.SCOPE_*`)
 * @param  {String[]}       [opts.resourceTypes]    An array of resource types to search (e.g., content, user). If not specified, then the search will not filter on resource type at all. Possible resource types are those that have registered producers in SearchAPI#registerSearchDocumentProducer.
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {SearchResult}   callback.results        An object that represents the results of the query
 */
export default function (ctx, options, callback) {
  // Sanitize custom search options
  options = options || {};
  options.limit = OaeUtil.getNumberParam(options.limit, 10, 1, 25);
  options.q = SearchUtil.getQueryParam(options.q);
  options.resourceTypes = SearchUtil.getArrayParam(options.resourceTypes);
  options.searchAllResourceTypes = isEmpty(options.resourceTypes);
  options.sortBy = [{ deleted: SearchConstants.sort.direction.DESC }];

  const user = ctx.user();
  if (!user || !user.isAdmin(user.tenant.alias)) {
    return callback({ code: 401, msg: 'You are not authorized to search deleted items' });
  }

  // Sanitize the scope based on if the user is global or tenant admin
  options.scope = _resolveScope(ctx, options.scope);

  // The query and filter objects for the Query DSL
  const query = { bool: { should: [createQueryStringQuery(options.q)] } };
  const resourcesFilter = filterResources(options.resourceTypes, SearchConstants.deleted.ONLY);

  // Apply the scope and access filters for the deleted search
  filterScopeAndAccess(ctx, options, false, (error, scopeAndAccessFilter) => {
    if (error) {
      return callback(error);
    }

    const filter = filterAnd(resourcesFilter, scopeAndAccessFilter);
    return callback(null, createQuery(query, filter, options));
  });
}

/**
 * Resolve the scope for the search based on who is performing it and how they specified the scope
 *
 * @param  {Context}    ctx         Standard context object containing the current user and the current tenant
 * @param  {String}     [scope]     The scope that was specified in the search request, if any
 * @return {String}                 The scope to use for the search
 * @api private
 */
const _resolveScope = function (ctx, scope) {
  const user = ctx.user();
  if (user.isGlobalAdmin()) {
    return scope || SearchConstants.general.SCOPE_ALL;
  }

  return user.tenant.alias;
};
