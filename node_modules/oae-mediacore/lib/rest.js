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

const OAE = require('oae-util/lib/oae');
const OaeServer = require('oae-util/lib/server');

const MediaCoreAPI = require('./api');

// Since the MediaCore encoding callback has its own authenticity handling, we can skip CSRF attack
// checking on that path
OaeServer.addSafePathPrefix('/api/mediacore/encodingCallback');

/**
 * @REST getMediacoreEmbedInfo
 *
 * Get the MediaCore embed information for a content item
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /mediacore/embed/{contentId}
 * @PathParam   {string}                contentId           The id of the content whose embed information to get
 * @Return      {MediacoreEmbedInfo}                        An object containing embed information for the MediaCore-hosted content
 * @HttpResponse                        200                 Embed info available
 * @HttpResponse                        400                 This content doesn't have a MediaCore ID
 * @HttpResponse                        404                 The content item could not be found
 * @HttpResponse                        500                 There was an unexpected error communicating with the media server
 */
OAE.tenantRouter.on('get', '/api/mediacore/embed/:contentId', (req, res) => {
  MediaCoreAPI.getEmbedInfo(req.ctx, req.params.contentId, (err, embedInfo) => {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.status(200).send(embedInfo);
  });
});

/**
 * @REST postMediacoreEncodingCallback
 *
 * Update the thumbnail images from MediaCore for a given MediaCore item id
 *
 * @Api         private
 * @Server      tenant
 * @Method      POST
 * @Path        /mediacore/encodingCallback
 * @FormParam   {string}          mediaId     The MediaCore item id
 * @Return      {void}
 * @HttpResponse                  200          Images updated
 * @HttpResponse                  400          Invalid mediaCoreId provided: ...
 * @HttpResponse                  404          Non-existing MediaCore ID was provided
 * @HttpResponse                  500          There was an unexpected error communicating with the media server
 */
OAE.tenantRouter.on('post', '/api/mediacore/encodingCallback', (req, res) => {
  MediaCoreAPI.updateThumbnails(req.body.mediaId, err => {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.status(200).end();
  });
});
