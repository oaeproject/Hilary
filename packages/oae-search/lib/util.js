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
import util from 'util';

import { logger } from 'oae-logger';
import * as AuthzAPI from 'oae-authz';
import * as OaeUtil from 'oae-util/lib/util';
const { invokeIfNecessary } = OaeUtil;
import * as TenantsAPI from 'oae-tenants';
import * as TenantsUtil from 'oae-tenants/lib/util';
import * as SearchModel from 'oae-search/lib/model';

import { SearchConstants } from 'oae-search/lib/constants';
import { AuthzConstants } from 'oae-authz/lib/constants';
import { Validator as validator } from 'oae-util/lib/validator';
import {
  mergeDeepWith,
  mergeDeepRight,
  concat,
  gte,
  equals,
  pluck,
  includes,
  not,
  reject,
  isNil,
  keys,
  prop,
  forEach,
  union,
  isEmpty,
  path,
  defaultTo,
  compose,
  length,
  values,
  either,
  is,
  head
} from 'ramda';

const { isObject, unless } = validator;
const { defaultToEmptyArray, defaultToEmptyObject } = validator;
const log = logger('oae-search-util');

const isArray = is(Array);
const isNotArray = compose(not, isArray);
const removeNils = reject(isNil);
const removeFalsies = reject(either(isNil, isEmpty));

/**
 * Get the standard search parameters from the given request.
 *
 * @param  {Request}    req     The express Request object from which to extract the parameters
 * @return {Object}             The parameters extracted from the request that are relevant for search
 */
const getSearchParams = function(req) {
  if (!req || !req.query) {
    return {};
  }

  /**
   * Note that we do not impose an upper limit on the `limit` parameter.
   * It's up to individual registered search types to do this.
   */
  return {
    q: req.query.q,
    start: req.query.start,
    limit: req.query.limit,
    sort: req.query.sort
  };
};

/**
 * Determine if the given parameter is a valid query parameter. If so, simply return the `val`, otherwise, return `defaultVal`
 *
 * @param  {String}     val             The value to check
 * @param  {String}     [defaultVal]    The value to return if `val` is not valid. Defaults to `SearchConstants.query.ALL`
 * @return {String}                     `val` if it is valid. `defaultVal` otherwise
 */
const getQueryParam = function(val, defaultVal) {
  defaultVal = defaultVal || SearchConstants.query.ALL;
  return val || defaultVal;
};

/**
 * Determine if the given parameter is a valid scope parameter. If so, simply return the `val`, otherwise, return the
 * `defaultVal` parameter
 *
 * @param  {String}     val             The value to check
 * @param  {String}     [defaultVal]    The value to return if `val` is not a valid scope. If not a valid scope, defaults to `SearchConstants.general.SCOPE_TENANT`
 * @return {String}                     `val` if it is valid, `defaultVal` otherwise
 */
const getScopeParam = function(val, defaultVal) {
  defaultVal = defaultVal ? getScopeParam(defaultVal) : SearchConstants.general.SCOPE_ALL;
  if (includes(val, SearchConstants.general.SCOPES_ALL)) {
    // If it is a valid scope type, return the scope as-is
    return val;
  }

  if (TenantsAPI.getTenant(val)) {
    // If it is a valid tenant alias, return the scope as-is
    return val;
  }

  // Otherwise, we default to limiting to the current tenant
  return defaultVal;
};

/**
 * Determine if the given parameter is a valid sort direction parameter.
 * If so, simply return the `val`, otherwise, return `defaultVal`.
 * By default results are sorted in an ascending direction.
 *
 * @param  {String}     val             The value to check
 * @param  {String}     [defaultVal]    The value to return if `val` is not valid. Defaults to `SearchConstants.sort.direction.ASC`
 * @param  {String}     [sortBy]        The value we wish to sort by. If this is `lastModified` or `_score`, sort direction should always be descending
 * @return {String}                     `val` if it is valid. `defaultVal` otherwise
 */
const getSortDirParam = function(val, defaultVal, sortBy) {
  if (equals(sortBy, SearchConstants.sort.field.SCORE) || equals(sortBy, SearchConstants.sort.field.MODIFIED)) {
    return SearchConstants.sort.direction.DESC;
  }

  defaultVal = defaultVal ? getSortDirParam(defaultVal) : SearchConstants.sort.direction.ASC;
  return includes(val, SearchConstants.sort.direction.OPTIONS) ? val : defaultVal;
};

/**
 * Determine if the given parameter is a valid sort field parameter.
 * If so, simply return the `val`, otherwise, return `defaultVal`. By
 * default we use the 'sort' field in the elasticsearch document for sorting results.
 *
 * @param  {String}     val             The value to check
 * @param  {String}     [defaultVal]    The value to return if `val` is not valid. Defaults to `SearchConstants.sort.field.ASC`
 * @return {String}                     `val` if it is valid. `defaultVal` otherwise
 */
const getSortFieldParam = function(val, defaultVal) {
  defaultVal = defaultVal ? getSortFieldParam(defaultVal) : SearchConstants.sort.field.SCORE;
  return includes(val, SearchConstants.sort.field.OPTIONS) ? val : defaultVal;
};

/**
 * Determine if the given parameter is a valid array of items. If so, simply return the `val`,
 * otherwise it will be wrapped into an array. If no `val` is specified, then the `defaultVal` will
 * be used
 *
 * @param  {String|String[]}    val             The value to check and wrap in an array if necessary
 * @param  {String[]}           [defaultVal]    The value to return if `val` is not specified. Defaults to `[]`
 * @return {String[]}                           The representation of `val` as an array. If empty, `defaultVal` will be returned as an array
 */
const getArrayParam = function(val, defaultVal) {
  defaultVal = defaultVal ? getArrayParam(defaultVal) : [];
  if (isNotArray(val)) {
    return getArrayParam([val], defaultVal);
  }

  val = removeFalsies(val);
  return isEmpty(val) ? defaultVal : val;
};

/**
 * Transform the raw search `results` from ElasticSearch into a `SearchResult`
 * that can be returned to the client.
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {Object}         transformers        An object keyed by the resource type, and the value is the transformer object that can transform a set of search documents into client-viewable documents
 * @param  {Object}         results             The search results sent back from ElasticSearch
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {SearchResult}   callback.results    The search results that can be sent to the client
 */
const transformSearchResults = function(ctx, transformers, results, callback) {
  const hits = defaultTo({}, path(['body', 'hits', 'hits'], results));
  const resultsTotalCount = path(['body', 'hits', 'total', 'value'], results);

  if (isEmpty(hits)) return callback(null, new SearchModel.SearchResult(resultsTotalCount, []));

  // Aggregate all the documents to be keyed by type
  const docsByType = {};
  const docIdOrdering = {};

  for (const [i, doc] of hits.entries()) {
    const id = doc._id;
    let type = doc.fields.resourceType;

    // If transformer does not exist, pass it through the default "raw" transformer
    if (!transformers[type]) {
      type = '*';
    }

    if (!docsByType[type]) {
      docsByType[type] = {};
    }

    docsByType[type][id] = doc;
    docIdOrdering[id] = i;
  }

  // Run all the documents through the document transformers for their particular type
  const transformersToRun = compose(length, keys)(docsByType);
  let transformersComplete = 0;
  let transformErr = null;
  let transformedDocs = {};

  const _monitorTransformers = function(err, resourceType, docs) {
    if (transformErr) {
      // Nothing to do, we've already returned because of an error
    } else if (err) {
      transformErr = err;
      return callback(transformErr);
    } else {
      /**
       * If we aren't using the default transformer, ensure the resourceType property
       * by merging it over the doc, it should never change and don't necessarily
       * need to be manually applied by an extension transformer
       */
      if (resourceType !== '*') {
        const docIds = keys(docs);
        for (const element of docIds) {
          const doc = docs[element];
          doc.resourceType = resourceType;
        }
      }

      // Merge the docs into the transformed docs
      transformedDocs = mergeDeepRight(transformedDocs, docs);

      transformersComplete++;
      if (gte(transformersComplete, transformersToRun)) {
        /**
         * We've done all transformations, reorder the docs into the original
         * search ordering and send back the response
         */
        const orderedDocs = values(transformedDocs);

        // Reorder the docs using the ordering hash that was recorded before transformation
        orderedDocs.sort((one, other) => {
          return docIdOrdering[one.id] - docIdOrdering[other.id];
        });

        return callback(null, new SearchModel.SearchResult(resultsTotalCount, orderedDocs));
      }
    }
  };

  /**
   * Execute all transformers asynchronously from one another. `_monitorTransformers`
   * will keep track of their completion
   */
  keys(docsByType).forEach(type => {
    transformers[type](
      ctx,
      docsByType[type],
      (resourceType => {
        // We need to pass the resource type of this iteration on to the monitor
        return function(err, docs) {
          _monitorTransformers(err, resourceType, docs);
        };
      })(type)
    );
  });
};

/**
 * Converts a query and (optionally) a filter into an appropriate ElasticSearch Query DSL object
 *
 * @param  {Object}     query               The ElasticSearch query representation
 * @param  {Object}     [filter]            The ElasticSearch filter to apply. If not specified, then the resulting object will be a simple query
 * @param  {Object}     [opts]              A set of additional options for the query
 * @param  {Number}     [opts.start]        The starting index of the query for paging
 * @param  {Number}     [opts.limit]        The maximum number of documents to return
 * @param  {Object[]}   [opts.sortBy]       A homogenous array (strings and objects) indicating how to sort resources. The objects are as per the ElasticSearch query sort API: http://www.elastic.co/guide/en/elasticsearch/reference/current/search-request-sort.html
 * @param  {String}     [opts.sort]         The sort direction (asc or desc)
 * @param  {Number}     [opts.minScore]     The minimum score for a document to be included in the result set
 * @return {Object}                         A valid ElasticSearch Query object that can be sent as a query
 * @throws {Error}                          Thrown if the `query` parameter is not an object
 */
const createQuery = function(query, filter, opts) {
  opts = opts || {};
  opts.sortBy = getSortFieldParam(opts.sortBy, SearchConstants.sort.field.SCORE);
  const sortBy = {
    [opts.sortBy]: getSortDirParam(opts.sort, SearchConstants.sort.direction.ASC, opts.sortBy)
  };

  try {
    unless(isObject, {
      code: 400,
      msg: 'createQuery expects a query object.'
    })(query);
  } catch (error) {
    log().error({ err: error }, 'Invalid input provided to SearchUtil.createQuery');
    throw error;
  }

  let data = null;
  if (filter) {
    // If we have filters, we need to create a filtered query
    data = { query: createFilteredQuery(query, filter) };
  } else {
    // If it's just a query, we wrap it in a standard query
    data = { query };
  }

  // Strip the opts down to the relevant ElasticSearch parameters
  opts = {
    from: OaeUtil.getNumberParam(opts.start),
    size: OaeUtil.getNumberParam(opts.limit),
    sort: union(
      // The field to sort by, uses _score by default unless other value has been provided
      [sortBy],

      // Final sort is the lowly natural resource sort parameter
      [{ sort: getSortDirParam(opts.sort) }]
    ),
    min_score: is(Number, opts.minScore) ? opts.minScore : SearchConstants.query.MINIMUM_SCORE
  };

  return mergeDeepRight(data, opts);
};

/**
 * Converts a filter and (optionally) a query into an appropriate ElasticSearch Filtered Query DSL
 * object
 *
 * @param  {Object}     [query]     The ElasticSearch query representation. If not specified, all documents that match the provided filter will be returned
 * @param  {Object}     filter      The ElasticSearch filter to apply
 * @return {Object}                 The ElasticSearch Filtered Query object
 */
const createFilteredQuery = (query, filter) => mergeDeepWith(concat, query, filter);

/**
 * Create an ElasticSearch bulk index operation from the given array of documents.
 * This splits up the documents automatically into the
 * meta / document sub-parts, and returns the array of documents that can be sent
 * to the elasticsearchclient to be indexed. This does
 * not support bulk delete operations, as it is only for indexing operations.
 *
 * @param  {Object[]}   docs        An array of documents to be indexed
 * @return {Object[]}   operations  The array of index operations that can be sent to ElasticSearch to perform all the indexing
 */
const createBulkIndexOperations = function(docs) {
  const cmds = [];

  forEach(doc => {
    const meta = {
      index: {
        _id: doc.id
      }
    };

    const parentId = doc._parent;
    /**
     * When indexing parents or children, we need to do this all the time
     */
    doc._parent = {};

    if (parentId) {
      // the _parent field no longer exists on the meta object, instead we need to chenge it
      doc._parent.parent = parentId;
    }

    // This is important because _type no longer works in ES7+
    doc.type = doc.type || SearchConstants.search.MAPPING_RESOURCE;
    doc._parent.name = doc.type;

    // These meta attributes have been promoted and shouldn't be on the core doc anymore
    delete doc.id;

    cmds.push(meta);
    cmds.push(doc);
  }, docs);

  return cmds;
};

/**
 * Create an ElasticSearch "ids" filter, from an array of ids.
 *
 * @param  {String[]}   ids     An array of ids to filter on
 * @return {Object}             An ElasticSearch "ids" filter
 */
const filterIds = function(ids) {
  return {
    ids: {
      values: ids
    }
  };
};

/**
 * Create an ElasticSearch "exists" filter, which checks if the document has the specified field on it.
 *
 * @param  {String}     field   The field that should be present on the document
 * @return {Object}             An ElasticSearch "exists" filter
 */
const filterExists = function(field) {
  return {
    exists: {
      field
    }
  };
};

/**
 * Create an ElasticSearch 'OR' filter, wrapped around multiple other filters.
 *
 * @param  {Object}     args*   The filter objects to "OR" together
 * @return {Object}             An ElasticSearch "OR" filter
 */
const filterOr = function(...args) {
  const filterClauses = removeNils(args);
  if (isEmpty(filterClauses)) return null;

  // If there is only one filter, no need to wrap it in an `or`
  let result;
  const singleFilter = compose(equals(1), length)(filterClauses);
  if (singleFilter) {
    result = head(filterClauses);
  } else {
    result = { bool: { should: filterClauses } };
  }

  return result;
};

/**
 * Create an ElasticSearch 'AND' filter, wrapped around multiple other filters.
 *
 * @param  {Object}     args*   The filter objects to "AND" together
 * @return {Object}             An ElasticSearch "AND" filter
 */
const filterAnd = function(...args) {
  const filterClauses = removeNils(args);
  if (isEmpty(filterClauses)) return null;

  const getMustNots = pluck('must_not');
  const mustNots = compose(removeNils, getMustNots)(filterClauses);
  const exceptMustNots = each => not(isNil(prop('must_not', each)));
  const otherClauses = reject(exceptMustNots, filterClauses);

  // If there is only one filter, no need to wrap it in an `and`
  const singleClause = compose(equals(1), length)(filterClauses);
  let result;
  if (singleClause) {
    result = head(filterClauses);
  } else {
    result = { bool: { must: otherClauses, must_not: mustNots } };
  }

  return result;
};

/**
 * Create an ElasticSearch 'NOT' filter, wrapped around one filter.
 *
 * @param  {Object}     filter  The filter object to negate
 * @return {Object}             An ElasticSearch "NOT" filter
 */
const filterNot = function(filter) {
  if (!filter) return null;

  const result = { must_not: filter };
  return result;
};

/**
 * Create an ElasticSearch 'terms' filter, wrapped around either an array of string values, or a
 * multi-value field of a document stored elsewhere in ElasticSearch.
 *
 * The option for looking up the values in a stored ElasticSearch document is based on the terms
 * lookup feature. For more information, refer to the ElasticSearch documentation:
 *
 *  http://www.elasticsearch.org/guide/en/elasticsearch/reference/current/query-dsl-terms-filter.html#_terms_lookup_mechanism
 *
 * @param  {String}             field   The name of the field this term filters
 * @param  {String[]|Object}    values  The values to filter on. If a string array, it filters based on the provided terms. If an Object, it will use the ElasticSearch Terms Lookup mechanism to fetch the terms from a document
 * @return {Object}                     An ElasticSearch 'terms' filter
 */
const filterTerms = function(field, values) {
  if (isEmpty(values)) return null;

  const filter = { terms: {} };
  if (isArray(values)) {
    // We've been given a static terms array on query
    const terms = removeNils(values);
    if (isEmpty(terms)) return null;

    filter.terms[field] = terms;
  } else {
    // We've been given an ElasticSearch terms lookup path, so apply that rather than a list of values
    filter.terms[field] = values;
  }

  return filter;
};

/**
 * Create an ElasticSearch 'term' filter, wrapped around a value
 *
 * @param  {String}     field   The name of the field this term filters
 * @param  {String}     value   The value to match
 * @return {Object}             An ElasticSearch 'term' filter
 */
const filterTerm = function(field, value) {
  if (!value) return null;

  const filter = { term: {} };
  filter.term[field] = value;
  return filter;
};

/**
 * Create an ElasticSearch filter that will filter to OAE resources by type and state
 *
 * @param  {String[]}   [resourceTypes]     The types of resources to filter by. If unspecified or empty, no resources will be filtered
 * @param  {String}     [deleted]           How to treat deleted resources, as enumerated by SearchConstants#deleted. Default: SearchConstants.deleted.NONE (i.e., only return non-deleted documents)
 * @return {Object}                         The filter that filters to OAE resources of the specified types
 */
const filterResources = (resourceTypes, deleted) => {
  /**
   * By default, we do not include deleted resources.
   * However we allow the consumer to specify
   * if both deleted/undeleted resources or only deleted should be included
   */
  let filterDeleted = filterNot(filterExists('deleted'));
  if (deleted === SearchConstants.deleted.BOTH) {
    filterDeleted = null;
  } else if (deleted === SearchConstants.deleted.ONLY) {
    filterDeleted = filterExists('deleted');
  }

  const filters = [];
  filters.push(filterTerm('type', SearchConstants.search.MAPPING_RESOURCE));
  if (not(isEmpty(resourceTypes))) filters.push(filterTerms('resourceType', resourceTypes));

  const termsFilter = filterTerms('resourceType', resourceTypes);
  return filterAnd(
    // Should only return resource documents
    filterTerm('type', SearchConstants.search.MAPPING_RESOURCE),

    // Should only return resource documents of the specified resource type
    isEmpty(resourceTypes) ? null : termsFilter,

    // Filter according to the deleted directive
    filterDeleted
  );
};

/**
 * Create a filter that narrows results down to only tenants with which the specified tenant alias
 * can interact
 *
 * @param  {String}     tenantAlias     The alias of the tenant for which to filter interacting tenants
 * @return {Object}                     The filter that narrows results down to only tenants with which the specified tenant alias can interact with
 */
const filterInteractingTenants = function(tenantAlias) {
  if (TenantsUtil.isPrivate(tenantAlias)) {
    // A private tenant can only interact with itself
    return filterTerm('tenantAlias', tenantAlias);
  }

  // A public tenant can only interact with public tenants
  const nonInteractingTenants = TenantsAPI.getNonInteractingTenants();
  const nonInteractingTenantAliases = pluck('alias', values(nonInteractingTenants));

  return filterNot(filterTerms('tenantAlias', nonInteractingTenantAliases));
};

/**
 * Create an ElasticSearch filter that will filter to resources of the provided scope to which the
 * current user has access.
 *
 * @param  {Context}    ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}     scope                           The specified scope of the request, as per `SearchConstants.general.SCOPE_*` or the alias of a tenant
 * @param  {Boolean}    needsFilterByExplicitAccess     Whether or not the access filter should take into consideration explicit access
 * @param  {Function}   callback                        Standard callback function
 * @param  {Object}     callback.err                    An error that occurred, if any
 * @param  {Object}     callback.filter                 The ElasticSearch filter that can be used in the search query
 */
const filterScopeAndAccess = function(ctx, scope, needsFilterByExplicitAccess, callback) {
  scope = getScopeParam(scope);

  const tenant = ctx.tenant();
  const user = ctx.user();
  const interactingTenantAliasesFilter = filterInteractingTenants(tenant.alias);
  const implicitAccessFilter = filterImplicitAccess(ctx);

  /**
   * If we are searching SCOPE_MY, we always need to search with explicit access.
   * The main reason for this is because we depend on having explicit access filters
   * in the queries since we don't use implicit access checks
   */
  needsFilterByExplicitAccess = needsFilterByExplicitAccess || scope === SearchConstants.general.SCOPE_MY;

  invokeIfNecessary(needsFilterByExplicitAccess, filterExplicitAccess, ctx, (err, explicitAccessFilter) => {
    if (err) return callback(err);

    const isScopeToAll = equals(scope, SearchConstants.general.SCOPE_ALL);
    const isScopeToInteractionOnly = equals(scope, SearchConstants.general.SCOPE_INTERACT);
    const isScopeToMineOnly = equals(scope, SearchConstants.general.SCOPE_MY);
    const scopeToAllOrNetwork = either(
      equals(SearchConstants.general.SCOPE_NETWORK),
      equals(SearchConstants.general.SCOPE_ALL)
    )(scope);

    if (user && user.isGlobalAdmin() && isScopeToAll) {
      // Global admins can search all public resources, including private tenants'
      return callback(null, filterOr(implicitAccessFilter, explicitAccessFilter));
    }

    if (scopeToAllOrNetwork) {
      /**
       *  When searching network, we care about access and the scope of the tenant network (i.e.,
       *  scope public tenants away from private). All resources outside the network that the
       *  user has explicit access to are included as well
       */
      return callback(
        null,
        filterOr(filterAnd(implicitAccessFilter, interactingTenantAliasesFilter), explicitAccessFilter)
      );
    }

    if (isScopeToInteractionOnly) {
      if (!user) {
        // Anonymous users cannot interact with anything, give an authorization error for this scenario
        return callback({
          code: 401,
          msg: 'Anonymous users are not authorized to interact with any resources'
        });
      }

      /**
       * When scoping for interaction, we care about access and resources that the user can
       * interact with. This is basically the network scope, minus private joinable resources
       * from the user's own tenant
       */
      return callback(
        null,
        filterOr(
          filterAnd(
            implicitAccessFilter,
            interactingTenantAliasesFilter,

            // A user cannot interact with any private resource
            user.isAdmin(user.tenant.alias)
              ? null
              : filterNot(filterTerm('visibility', AuthzConstants.visibility.PRIVATE))
          ),
          explicitAccessFilter
        )
      );
    }

    if (isScopeToMineOnly) {
      if (!user) {
        // Anonymous users cannot interact with anything, give an authorization error for this scenario
        return callback({
          code: 400,
          msg: 'Anonymous users cannot search for their own resources'
        });
      }

      /**
       * When scoping for the things that are "close" to the user, we look at things that are
       * associated to the user directly or indirectly by group access. This includes users
       * who share group memberships with the user
       */
      return callback(null, explicitAccessFilter);
    }

    /**
     * Otherwise, a specific tenant has been specified. In this case we search only for
     * resources of that tenant, even if there is explicit access to resources of other
     * tenants
     */
    return callback(
      null,
      filterAnd(filterOr(implicitAccessFilter, explicitAccessFilter), filterTerm('tenantAlias', scope))
    );
  });
};

/**
 * Create an ElasticSearch filter that will filter to all resources the provided user has access to
 * implicitly using visibility rules.
 *
 * @param  {Context}    ctx     Standard context object containing the current user and the current tenant
 * @return {Object}             The filter that filters the user's access by anything they implicitly have access to in the system. If unspecified, it indicates they have access to everything (i.e., global admin)
 */
const filterImplicitAccess = function(ctx) {
  const user = ctx.user();
  if (user && user.isGlobalAdmin()) {
    // If the user is a global admin, they have implicit access to everything
    return null;
  }

  // Any user can implicitly see any public resource in the system
  const filterPublic = filterTerm('visibility', AuthzConstants.visibility.PUBLIC);

  // If the user is anonymous, short-circuit to only revealing the public content in the system
  if (!user) {
    return filterPublic;
  }

  // The user is authenticated, determine the implicit access for non-public items in the system
  let filterLoggedIn = null;
  let filterPrivate = null;
  if (user.isTenantAdmin(user.tenant.alias)) {
    // Tenant admin can implicitly access all resources in the tenant, but not outside of it
    filterLoggedIn = filterTerm('tenantAlias', user.tenant.alias);
  } else {
    // Regular users can implicitly access all resources in the system that have visibility
    // loggedin, and private groups that are joinable
    filterLoggedIn = filterAnd(
      filterTerm('tenantAlias', user.tenant.alias),
      filterOr(
        filterTerm('visibility', AuthzConstants.visibility.LOGGEDIN),
        filterAnd(
          filterTerm('resourceType', 'group'),
          filterTerms('joinable', [AuthzConstants.joinable.YES, AuthzConstants.joinable.REQUEST])
        )
      )
    );

    // The only private resource a user implicitly has access to is potentially themself
    if (user.visibility === AuthzConstants.visibility.PRIVATE) {
      filterPrivate = filterAnd(
        filterTerm('visibility', AuthzConstants.visibility.PRIVATE),
        filterTerm('_id', user.id)
      );
    }
  }

  return filterOr(filterPublic, filterLoggedIn, filterPrivate);
};

/**
 * Create an ElasticSearch filter that will filter to just items that the user in context has explicit access
 * to. It is assumed that global administrators and anonymous users have explicit access to nothing. In the
 * case of a global administrator, they have implicit access to everything therefore this does not restrict
 * their access in any way.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Object}     callback.filter     The ElasticSearch filter that will filter by explicit access. If unspecified, it implies the user has explicit access to *nothing*
 */
const filterExplicitAccess = function(ctx, callback) {
  const user = ctx.user();
  if (!user) {
    // Anonymous users cannot have explicit access to anything
    return callback();
  }

  // The global admin has implicit access to everything, so explicit access is unnecessary
  if (user.isGlobalAdmin()) return callback();

  /**
   * If we are including indirect access, include all resources where
   * any of the user's groups are directly a member of the resource
   */
  AuthzAPI.getAllIndirectPrincipalMemberships(ctx.user().id, (err, indirectGroupIds) => {
    if (err) return callback(err);

    return callback(
      null,
      createHasChildQuery(
        AuthzConstants.search.MAPPING_RESOURCE_MEMBERS,
        createFilteredQuery(
          null,
          filterOr(
            /**
             * Include all resources that have the current user or
             * the user's *indirect* group memberships as a direct member
             */
            filterTerms('direct_members', union([ctx.user().id], indirectGroupIds)),

            /**
             * Additionally, include all resources that have the current user's *direct*
             * group memberships as a direct member. This is an optimization to avoid
             * the requirement of sending the user's direct membership in the ElasticSearch
             * query. Because of that, only the indirect group membership need to be sent
             * by using the ElasticSearch Terms Lookup filter
             * @see http://www.elasticsearch.org/guide/en/elasticsearch/reference/current/query-dsl-terms-filter.html
             */
            filterTerms('direct_members', {
              index: 'oaetest', // TODO this needs to come out of somewhere, can't be hardcoded
              id: getChildSearchDocumentId(AuthzConstants.search.MAPPING_RESOURCE_MEMBERSHIPS, ctx.user().id),
              path: 'direct_memberships',
              routing: ctx.user().id
            })
          )
        )
      )
    );
  });
};

/**
 * Create an ElasticSearch filter that will filter only the items created by
 * the current user or items NOT created by the current user
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     createdBy           A string used to filter items by
 */
const filterCreatedBy = function(ctx, createdBy) {
  const user = ctx.user();
  if (user && createdBy && createdBy.length === 1) {
    createdBy = createdBy[0];
    if (user.id === createdBy) {
      return filterTerm('createdBy', createdBy);
    }

    return filterNot(filterTerm('createdBy', user.id));
  }

  return null;
};

/**
 * Create a full-text query object (just the query portion, not filter) for ElasticSearch from the provided
 * user input. This ensures that the query will be a safe keyword search that
 * supports both "everything" (e.g., *) and user-input search terms.
 *
 * @param  {String}         q           The user-input query to search with
 * @param  {String[]}       [fields]    The fields of the documents that should be searched through. Defaults to ['q_high^2.0', 'q_low^0.75']
 * @param  {String|Number}  [boost]     An optional boost to apply to the query. If not specified, no boost will be applied
 * @return {Object}                     A Query object that can be used in the query portion of the ElasticSearch Query DSL
 */
const createQueryStringQuery = function(q, fields, boost) {
  if (isEmpty(keys(fields))) {
    fields = ['displayName^3.0', 'q_high^2.0', 'q_low^0.75'];
  }

  let query = null;
  q = getQueryParam(q);
  if (equals(q, SearchConstants.query.ALL)) {
    // We're searching everything, use query_string syntax
    query = {
      query_string: {
        fields,
        query: SearchConstants.query.ALL
      }
    };

    if (boost) {
      query.query_string.boost = boost;
    }
  } else {
    // Build a query that will do a full-text search on the "q" fields, giving favour to matches on the title
    query = {
      multi_match: {
        fields,
        query: q
      }
    };

    if (boost) {
      query.multi_match.boost = boost;
    }
  }

  return query;
};

/**
 * Creates a query that filters based on an exact match of an email
 *
 * @param  {String}     email   The email to search for
 * @return {Object}             A Query object that can be used in the query portion of the ElasticSearch Query DSL
 */
const createEmailQuery = email => createFilteredQuery(null, filterTerm('email', email));

/**
 * Creates a has_child query object that can be used to get those resources that have children of
 * type `type` that match the `query`.
 * @see http://www.elasticsearch.org/guide/reference/query-dsl/has-child-query/
 *
 * @param  {String}     type            The type of children.
 * @param  {Object}     childQuery      A Query object that will filter the children
 * @param  {String}     [scoreType]     The supported score types are max, sum, avg or none. If not specified, the score_type parameter won't be set in the query, so the query can be used in filters. If the score type is set to another value than none, the scores of all the matching child documents are aggregated into the associated parent documents.
 * @param  {Number}     [boost]         The amount of boost that elasticsearch should apply to this query
 * @return {Object}                     A Query object that can be used in the query portion of the ElasticSearch Query DSL
 */
const createHasChildQuery = function(type, childQuery, scoreType, boost) {
  if (!childQuery) {
    return null;
  }

  const query = {
    has_child: {
      type,
      query: childQuery
    }
  };

  /**
   * Because we can't use a has_child query with a scoreType in a filter,
   * we only add the scoreType when it's been defined, so callers can specify
   * when to add it
   */
  if (scoreType) {
    query.has_child.score_mode = scoreType;
  }

  if (boost) {
    query.has_child.boost = boost;
  }

  return query;
};

/**
 * Create a more-like-this query object (just the query portion, not filter)
 * for ElasticSearch from the provided user input.
 * @see http://www.elasticsearch.org/guide/reference/query-dsl/mlt-query.html
 *
 * @param  {String}     like_val    The text that should be fuzzified and to match documents against
 * @param  {String[]}   [fields]    An array of fields that should match the like_val text. If left blank, the "q_high" field will be used
 * @return {Object}                 A Query object that can be used in the query portion of the ElasticSearch Query DSL
 */
const createMoreLikeThisQuery = function(val, fields) {
  fields = isEmpty(keys(fields)) ? ['q_high'] : fields;
  return {
    more_like_this: {
      fields,
      like_text: val,
      min_term_freq: 1,
      min_doc_freq: 1
    }
  };
};

/**
 * Create a search document whose parent is the specified resource document from the given type and fields.
 *
 * @param  {String}     type            The type of the document
 * @param  {String}     resourceId      The id of the resource who is the parent of this document
 * @param  {Object}     fields          The fields to index
 * @param  {String}     [fields.id]     A custom id for the document. If this is not specified, then the empty string is used and it is assumed you probably only want one child of this type per resource. Specifying the id allows you to have many child documents per resource
 */
const createChildSearchDocument = function(type, resourceId, fields) {
  return mergeDeepRight(fields, {
    id: getChildSearchDocumentId(type, resourceId, fields.id),
    type,
    _parent: resourceId
  });
};

/**
 * Create the child search document id for the document described by the given information
 *
 * @param  {String}     type        The type of the search document (e.g., 'content_comment', 'resource_members', etc...)
 * @param  {String}     resourceId  The id of the resource that is a parent to this child document
 * @param  {String}     [childId]   The id of the child item that is unique within the scope of the provided parent resource id. By not specifying a child id, it is assumed you only want one child per parent resource id (e.g., a members document that contains all the members of a content item)
 * @return {String}                 The globally unique id to use for the child document
 */
const getChildSearchDocumentId = function(type, resourceId, childId) {
  return util.format('%s#%s#%s', resourceId, type, childId || '');
};

const sanitizeSearchParams = opts => {
  opts = defaultToEmptyObject(opts);
  opts.pathParams = defaultToEmptyArray(opts.pathParams);
  opts.userId = head(opts.pathParams);
  opts.limit = OaeUtil.getNumberParam(opts.limit, 12, 1, 25);

  return opts;
};

/**
 * Make sure to filter by resources (array)
 */
const filterByResource = resourcesToFilterBy => {
  return { filter: [{ terms: { resourceType: resourcesToFilterBy } }] };
};

/**
 * Filter by interacting tenants to include in query
 *
 * A private tenant can only interact with itself
 * A public tenant can only interact with public tenants
 *
 * @function filterByInteractingTenants
 * @param  {type} const filterByInteractingTenants {description}
 * @return {type} {description}
 */
const filterByInteractingTenants = tenantAlias => {
  const { isPrivate } = TenantsUtil;
  const { getNonInteractingTenants } = TenantsAPI;
  const ALIAS = 'alias';
  const getAlias = pluck(ALIAS);

  if (isPrivate(tenantAlias)) {
    return { must: { terms: { tenantAlias: [tenantAlias] } } };
  }

  // A public tenant can only interact with public tenants
  const tenantsItCannotInteractWith = compose(getAlias, values, getNonInteractingTenants)();
  return { must_not: { terms: { tenantAlias: tenantsItCannotInteractWith } } };
};

/**
 * Return a query for exact match for email
 */
const buildQueryForEmail = email => {
  return { must: { term: { email } } };
};

export {
  filterByResource,
  filterByInteractingTenants,
  buildQueryForEmail,
  sanitizeSearchParams,
  getSearchParams,
  getQueryParam,
  getScopeParam,
  getSortDirParam,
  getSortFieldParam,
  getArrayParam,
  transformSearchResults,
  createQuery,
  createFilteredQuery,
  createBulkIndexOperations,
  filterIds,
  filterExists,
  filterOr,
  filterAnd,
  filterNot,
  filterTerms,
  filterTerm,
  filterResources,
  filterInteractingTenants,
  filterScopeAndAccess,
  filterImplicitAccess,
  filterExplicitAccess,
  filterCreatedBy,
  createQueryStringQuery,
  createEmailQuery,
  createHasChildQuery,
  createMoreLikeThisQuery,
  createChildSearchDocument,
  getChildSearchDocumentId
};
