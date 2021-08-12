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

import request from 'request';
import { compose, nth, split, defaultTo, startsWith, forEachObjIndexed } from 'ramda';

import * as OAE from 'oae-util/lib/oae.js';

import * as PreviewProcessorAPI from 'oae-preview-processor';

const HTTP_POST = 'post';
const HTTP_GET = 'get';

// Auxiliary functions
const isContentFilter = startsWith('content_');
const isRevisionFilter = startsWith('revision_');
const defaultToEmptyObject = (x) => defaultTo({}, x);
const first = nth(1);

/**
 * @REST postContentReprocessPreviews
 *
 * Reprocess previews for the content items that match a set of filters
 *
 * @Server      admin
 * @Method      POST
 * @Path        /content/reprocessPreviews
 * @FormParam   {String[]}          [content_createdBy]           Filter content based on who it was created by
 * @FormParam   {string[]}          [content_resourceSubType]     Filter content based on its resourceSubType                                               [collabdoc,collabsheet,file,link]
 * @FormParam   {string[]}          [content_previewsStatus]      Filter content based on the status of the previews processing                             [ignored,error]
 * @FormParam   {string[]}          [content_tenant]              Filter content based on the tenant where it was created
 * @FormParam   {number}            [revision_createdAfter]       Filter those revisions who were created after a certain timestamp in ms since epoch
 * @FormParam   {number}            [revision_createdBefore]      Filter those revisions who were created before a certain timestamp in ms since epoch
 * @FormParam   {string[]}          [revision_createdBy]          Filter the revisions based on who it was created by
 * @FormParam   {string[]}          [revision_mime]               Filter based on the mime type of a file
 * @FormParam   {string[]}          [revision_previewsStatus]     Filter the revisions based on their previews status                                       [ignored,error]
 * @Return      {void}
 * @HttpResponse                    200                           Previews queued for reprocessing
 * @HttpResponse                    400                           At least one filter must be specified
 * @HttpResponse                    401                           Must be a global administrator to reprocess previews
 */

OAE.globalAdminRouter.on(HTTP_POST, '/api/content/reprocessPreviews', (httpRequest, httpResponse) => {
  httpRequest.telemetryUrl = '/api/content/reprocessPreviews';
  const filters = {};

  forEachObjIndexed((value, name) => {
    const actualFilterKey = compose(first, split('_'))(name);
    if (isContentFilter(name)) {
      filters.content = defaultToEmptyObject(filters.content);
      filters.content[actualFilterKey] = value;
    } else if (isRevisionFilter(name)) {
      filters.revision = defaultToEmptyObject(filters.revision);
      filters.revision[actualFilterKey] = value;
    }
  }, httpRequest.body);

  PreviewProcessorAPI.reprocessPreviews(httpRequest.ctx, filters, (err) => {
    if (err) return httpResponse.status(err.code).send(err.msg);

    httpResponse.status(200).end();
  });
});

/*!
 * Reprocess the preview of a revision
 *
 * @param  {Request}    The express request
 * @param  {Response}   The express response
 * @api private
 */
const _handleReprocessPreview = function (httpRequest, httpResponse) {
  PreviewProcessorAPI.reprocessPreview(
    httpRequest.ctx,
    httpRequest.params.contentId,
    httpRequest.params.revisionId,
    (err) => {
      if (err) return httpResponse.status(err.code).send(err.msg);

      httpResponse.status(200).end();
    }
  );
};

/**
 * @REST postContentContentIdRevisionRevisionIdReprocessPreview
 *
 * Reprocess the preview for a single content item's revision
 *
 * @Server      admin,tenant
 * @Method      POST
 * @Path        /content/{contentId}/revision/{revisionId}/reprocessPreview
 * @PathParam   {string}        contentId       The id of the content item for which to reprocess the preview
 * @PathParam   {string}        revisionId      The id of the revision to reprocess
 * @Return      {void}
 * @HttpResponse                200             Preview queued for reprocessing
 * @HttpResponse                400             A content id must be provided
 * @HttpResponse                400             A revision id must be provided
 * @HttpResponse                401             You must be admin of the content item's tenant to reprocess its previews
 */
OAE.globalAdminRouter.on(
  HTTP_POST,
  '/api/content/:contentId/revision/:revisionId/reprocessPreview',
  _handleReprocessPreview
);
OAE.tenantRouter.on(
  HTTP_POST,
  '/api/content/:contentId/revision/:revisionId/reprocessPreview',
  _handleReprocessPreview
);

/**
 * @REST getLongurlExpand
 *
 * Expand a short URL into its long URL form
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /longurl/expand
 * @QueryParam  {string}        url             The short URL that should be expanded
 * @Return      {LongUrl}
 * @HttpResponse                200             The long URL
 * @HttpResponse                500             The URL could not be expanded
 */
OAE.tenantRouter.on(HTTP_GET, '/api/longurl/expand', async (httpRequest, httpResponse) => {
  const url = decodeURIComponent(httpRequest.query.url);

  request({ url, followRedirect: false }, (err, redirectResponse) => {
    if (err) return console.error(err);

    const unshortenedUrl = redirectResponse.headers.location;
    const data = {
      'long-url': unshortenedUrl
    };
    return httpResponse.status(200).send(data);
  });
});
