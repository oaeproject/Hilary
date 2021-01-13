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

/* eslint-disable camelcase */
import _ from 'underscore';
import { includes, isEmpty } from 'ramda';

import { ContentConstants } from 'oae-content/lib/constants';
import { DiscussionsConstants } from 'oae-discussions/lib/constants';
import { FoldersConstants } from 'oae-folders/lib/constants';
import { SearchConstants } from 'oae-search/lib/constants';

import * as OaeUtil from 'oae-util/lib/util';
import * as SearchUtil from 'oae-search/lib/util';
const {
  filterCreatedBy,
  createHasChildQuery,
  createQueryStringQuery,
  filterResources,
  filterScopeAndAccess,
  filterAnd,
  createFilteredQuery,
  createQuery
} = SearchUtil;

const RESOURCE_TYPES_ACCESS_SCOPED = [
  SearchConstants.general.RESOURCE_TYPE_ALL,
  SearchConstants.general.RESOURCE_TYPE_CONTENT,
  SearchConstants.general.RESOURCE_TYPE_DISCUSSION,
  SearchConstants.general.RESOURCE_TYPE_FOLDER,
  SearchConstants.general.RESOURCE_TYPE_GROUP
];

/**
 * General search that searches a 'general' analyzed field on content, scoping it by user access.
 *
 * In addition to the specific `opts` parameters documented here, there are more generic options available that impact all
 * searches. @see SearchAPI#search for more information.
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {Object}         [opts]                  General search options
 * @param  {String}         [opts.scope]            The scope of the query (One of `SearchConstants.general.SCOPE_*`)
 * @param  {String[]}       [opts.resourceTypes]    An array of resource types to search (e.g., content, user). If not specified, then the search will not filter on resource type at all. Possible resource types are those that have registered producers in SearchAPI#registerSearchDocumentProducer.
 * @param  {String[]}       [opts.createdBy]        An array representing who the results should be created by
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {SearchResult}   callback.results        An object that represents the results of the query
 */
export default function(ctx, opts, callback) {
  // Sanitize custom search options
  opts = opts || {};
  opts.limit = OaeUtil.getNumberParam(opts.limit, 10, 1, 25);
  opts.q = SearchUtil.getQueryParam(opts.q);
  opts.resourceTypes = SearchUtil.getArrayParam(opts.resourceTypes);
  opts.createdBy = SearchUtil.getArrayParam(opts.createdBy);
  opts.searchAllResourceTypes = isEmpty(opts.resourceTypes);

  return _search(ctx, opts, callback);
}

/**
 * Perform the search that searches a 'q' analyzed field on documents, scoping it by user access. This is delegated from the
 * `module.exports` function for convenience, as it will access the members array only if necessary.
 *
 * @param  {Context}       ctx                 Standard context object containing the current user and the current tenant
 * @param  {Object}        opts                General search options
 * @param  {Function}      callback            Standard callback function
 * @param  {Object}        callback.err        An error that occurred, if any
 * @param  {SearchResult}  callback.results    An object that represents the results of the query
 */
const _search = function(ctx, opts, callback) {
  // The query and filter objects for the Query DSL
  const query = _createQuery(ctx, opts);
  const filterByResources = filterResources(opts.resourceTypes);

  filterScopeAndAccess(ctx, opts, _needsFilterByExplicitAccess(ctx, opts), (err, scopeAndAccessFilter) => {
    if (err) return callback(err);

    // Filter by created if needed
    const createdByFilter = filterCreatedBy(ctx, opts.createdBy);

    // Create the filtered query
    const filter = filterAnd(filterByResources, scopeAndAccessFilter, createdByFilter);

    const filteredQuery = createFilteredQuery(query, filter);

    // Give results from the current tenant a slight boost
    const boostingQuery = {
      function_score: {
        score_mode: 'sum',
        boost_mode: 'sum',
        functions: [
          {
            filter: {
              term: {
                tenantAlias: ctx.tenant().alias
              }
            },
            weight: 1.5
          }
        ],
        query: filteredQuery
      }
    };

    // Wrap the query and filter into the top-level Query DSL "query" object
    return callback(null, createQuery(boostingQuery, null, opts));
  });
};

/**
 * Create the ElasticSearch query object for the general search.
 *
 * @param  {Context}    ctx     Standard context object containing the current user and the current tenant
 * @param  {Object}     opts    The general search options, as per the `module.exports` function
 * @return {Object}             The ElasticSearch query
 * @api private
 */
const _createQuery = function(ctx, opts) {
  const includeContent = _includesResourceType(opts, 'content');
  const includeDiscussion = _includesResourceType(opts, 'discussion');
  const includeFolder = _includesResourceType(opts, 'folder');

  if (opts.q === SearchConstants.query.ALL) {
    /**
     * Apparently ES no longer supports `query_string` syntax along with bool type query
     * so all in all I'm adding a `should` with a query_string in it
     */
    return { bool: { should: [createQueryStringQuery(opts.q)], minimum_should_match: 1 } };
  }

  /**
   * If we will be including results that match child documents, we'll want to
   * boost the resource match to avoid the messages dominating resources
   */
  const boost = includeContent || includeDiscussion || includeFolder ? 5 : null;
  const query = {
    bool: {
      should: [createQueryStringQuery(opts.q, null, boost)],
      minimum_should_match: 1
    }
  };

  // For content items, include their comments and body text
  if (includeContent) {
    /**
     * Here we're looking for `discussion_message_body` as that is the
     * default export of `resourceMessagesSchema` defined in `oae-messagebox/lib/search/schema`
     * If the fields do not match, the query will look for the wrong data
     */
    query.bool.should.push(
      createHasChildQuery(
        ContentConstants.search.MAPPING_CONTENT_COMMENT,
        createQueryStringQuery(opts.q, ['discussion_message_body']),
        'max'
      )
    );
    // If the content_body matches that should be boosted over a comment match
    query.bool.should.push(
      createHasChildQuery(
        ContentConstants.search.MAPPING_CONTENT_BODY,
        createQueryStringQuery(opts.q, ['content_body']),
        'max',
        2
      )
    );
  }

  // For discussions, include their messages
  if (includeDiscussion) {
    /**
     * Here we're looking for `discussion_message_body` as that is the
     * default export of `resourceMessagesSchema` defined in `oae-messagebox/lib/search/schema`
     * If the fields do not match, the query will look for the wrong data
     */
    query.bool.should.push(
      SearchUtil.createHasChildQuery(
        DiscussionsConstants.search.MAPPING_DISCUSSION_MESSAGE,
        createQueryStringQuery(opts.q, ['discussion_message_body']),
        'max'
      )
    );
  }

  // For folders, include their comments
  if (includeFolder) {
    query.bool.should.push(
      createHasChildQuery(
        FoldersConstants.search.MAPPING_FOLDER_MESSAGE,
        createQueryStringQuery(opts.q, ['body']),
        'max'
      )
    );
  }

  return query;
};

/**
 * Determines whether or not the search needs to be scoped by the user's explicit access privileges.
 * This is true when:
 *
 *  1 The user is authenticated; and
 *  2 The user is not a global administrator; and
 *  3 The search includes content and groups (users are not filtered by access); and
 *  4 The search is actually specifying a query (e.g., if the search is '*', then we only include implicit access)
 *
 * @param  {Context}   ctx         Standard context object containing the current user and the current tenant
 * @param  {Object}    opts        The (sanitized) search options
 * @return {Boolean}               Whether or not the query specified by this user and options requires filtering by access privileges
 * @api private
 */
const _needsFilterByExplicitAccess = function(ctx, opts) {
  const isAuthenticated = Boolean(ctx.user());
  const isNotGlobalAdmin = !isAuthenticated || !ctx.user().isGlobalAdmin();
  const includesContentOrGroups =
    opts.searchAllResourceTypes ||
    !_.chain(RESOURCE_TYPES_ACCESS_SCOPED)
      .intersection(opts.resourceTypes)
      .isEmpty()
      .value();
  const hasTextQuery = opts.q !== SearchConstants.query.ALL;
  return isAuthenticated && isNotGlobalAdmin && includesContentOrGroups && hasTextQuery;
};

/**
 * Determine whether or not the provided search options determine that the search will include resources of the
 * provided resource type.
 *
 * @param  {Object}     opts            The `opts` object constructed by the query
 * @param  {String}     resourceType    The resource type
 * @return {Boolean}                    `true` if the query will include resources of the provided `resourceType`. `false` otherwise
 * @api private
 */
const _includesResourceType = function(opts, resourceType) {
  return opts.searchAllResourceTypes || includes(resourceType, opts.resourceTypes);
};
