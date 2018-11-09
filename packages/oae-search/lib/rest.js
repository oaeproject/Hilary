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
const util = require('util');
const _ = require('underscore');

const OAE = require('oae-util/lib/oae');
const OaeUtil = require('oae-util/lib/util');
const TenantsAPI = require('oae-tenants/lib/api');

const SearchAPI = require('oae-search');
const SearchUtil = require('oae-search/lib/util');

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
OAE.globalAdminRouter.on('post', '/api/search/reindexAll', (req, res) => {
  SearchAPI.postReindexAllTask(req.ctx, err => {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.status(200).end();
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
const _handleSearchTenants = function(req, res) {
  const { q } = req.query;
  const opts = _.pick(req.query, 'start', 'limit', 'disabled');

  opts.disabled = OaeUtil.castToBoolean(opts.disabled);

  res.status(200).send(TenantsAPI.searchTenants(q, opts));
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
const _handleSearchRequest = function(req, res) {
  const searchType = req.params[0];
  if (searchType) {
    req.telemetryUrl = util.format('/api/search/%s', searchType);
  }

  const pathParams = req.params[1] ? _.compact(req.params[1].split('/')) : [];
  const opts = _.extend({}, req.query, SearchUtil.getSearchParams(req), { pathParams });
  SearchAPI.search(req.ctx, searchType, opts, (err, result) => {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    res.status(200).send(result);
  });
};

OAE.tenantRouter.on('get', REGEX_SEARCH_ENDPOINT, _handleSearchRequest, '/api/search');
OAE.globalAdminRouter.on('get', REGEX_SEARCH_ENDPOINT, _handleSearchRequest, '/api/search');
