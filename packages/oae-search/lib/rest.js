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
import { format } from 'node:util';
import _ from 'underscore';

import * as OAE from 'oae-util/lib/oae.js';
import * as OaeUtil from 'oae-util/lib/util.js';
import * as TenantsAPI from 'oae-tenants/lib/api.js';
import * as SearchAPI from 'oae-search';
import * as SearchUtil from 'oae-search/lib/util.js';

const REGEX_SEARCH_ENDPOINT = /\/api\/search\/([^/]+)(\/.*)?/;

/**
 * @REST postSearchReindexAll
 *
 * Re-index all data
 *
 * @Server      admin
 * @Method      POST
 * @Path        /search/reindexAll
 * @Return      {void}
 * @HttpResponse                        200                 Reindexing task queued
 * @HttpResponse                        401                 Only global administrator can trigger a full reindex
 */
OAE.globalAdminRouter.on('post', '/api/search/reindexAll', (request, response) => {
  SearchAPI.postReindexAllTask(request.ctx, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST getSearchTenants
 *
 * Search through tenants in the system
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /search/tenants
 * @QueryParam  {number}                [limit]             The maximum number of search results to return. Defaults to returning all matching tenants
 * @QueryParam  {string}                [q]                 The search query. Defaults to returning all tenants
 * @QueryParam  {number}                [start]             The document index from which to start. Defaults to 0
 * @Return      {SearchResponse}                            The retrieved search results
 * @HttpResponse                        200                 Search results available
 */
const _handleSearchTenants = function (request, response) {
  const { q } = request.query;
  const options = _.pick(request.query, 'start', 'limit', 'disabled');

  options.disabled = OaeUtil.castToBoolean(options.disabled);

  response.status(200).send(TenantsAPI.searchTenants(q, options));
};

OAE.tenantRouter.on('get', '/api/search/tenants', _handleSearchTenants);
OAE.globalAdminRouter.on('get', '/api/search/tenants', _handleSearchTenants);

/**
 * @REST getSearch
 *
 * Perform a search
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /search/{searchType}
 * @PathParam   {string}                searchType          The type of search being performed                          [content-library,followers,following,general,members-library,memberships-library]
 * @QueryParam  {number}                [limit]             The maximum number of search results to return
 * @QueryParam  {string}                [q]                 The search query
 * @QueryParam  {string}                [sort]              The sort direction. Defaults to asc                         [asc,desc]
 * @QueryParam  {number}                [start]             The document index from which to start. Defaults to 0
 * @Return      {SearchResponse}                            The retrieved search results
 * @HttpResponse                        200                 Search results available
 * @HttpResponse                        400                 An invalid or unknown search type was specified
 */
const _handleSearchRequest = function (request, response) {
  const searchType = request.params[0];
  if (searchType) {
    request.telemetryUrl = format('/api/search/%s', searchType);
  }

  const pathParameters = request.params[1] ? _.compact(request.params[1].split('/')) : [];
  const options = _.extend({}, request.query, SearchUtil.getSearchParams(request), { pathParams: pathParameters });
  SearchAPI.search(request.ctx, searchType, options, (error, result) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).send(result);
  });
};

OAE.tenantRouter.on('get', REGEX_SEARCH_ENDPOINT, _handleSearchRequest, '/api/search');
OAE.globalAdminRouter.on('get', REGEX_SEARCH_ENDPOINT, _handleSearchRequest, '/api/search');
