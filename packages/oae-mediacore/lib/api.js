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

const ContentAPI = require('oae-content');
const { ContentConstants } = require('oae-content/lib/constants');
const ContentDAO = require('oae-content/lib/internal/dao');
const log = require('oae-logger').logger('oae-mediacore');
const { Validator } = require('oae-util/lib/validator');

const MediaCoreDAO = require('./internal/dao');
const MediaCoreUtil = require('./internal/util');

/**
 * Get the MediaCore embed information for a content item
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}     contentId                   The id of the content whose embed information to get
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.embedInfo          A JSON object containing embed information for the MediaCore-hosted content
 * @param  {String}     callback.embedInfo.html     The HTML fragment that can be used to embed the content item's MediaCore player in a page
 * @param  {String}     callback.embedInfo.url      The URL to the MediaCore-hosted content
 */
const getEmbedInfo = function(ctx, contentId, callback) {
  ContentAPI.getContent(ctx, contentId, (err, content) => {
    if (err) {
      return callback(err);
    }
    if (!content.previews || !content.previews.mediaCoreId) {
      return callback({ code: 400, msg: "This content doesn't have a MediaCore ID" });
    }

    const mediaCoreConfig = MediaCoreUtil.getConfig(content.tenant.alias);

    // Get the embed code from MediaCore
    const getEmbedInfoUrl = util.format('/api2/media/%s/embedcode', content.previews.mediaCoreId);
    MediaCoreUtil.signedRequest(
      content.tenant.alias,
      'get',
      getEmbedInfoUrl,
      null,
      null,
      (err, res, body) => {
        if (err) {
          return callback({ code: 500, msg: 'Error communicating with MediaCore server' });
        }
        if (res.statusCode !== 200) {
          log().error(
            { code: res.statusCode, body },
            'An unexpected error occurred communicating with MediaCore'
          );
          return callback({
            code: 500,
            msg: util.format('There was an unexpected error communicating with the media server')
          });
        }

        let embedInfo = null;
        try {
          embedInfo = JSON.parse(body);
        } catch (error) {
          log().error(
            {
              err: error,
              mediaCoreId: content.previews.mediaCoreId,
              body
            },
            'Error parsing MediaCore response as JSON'
          );
          return callback({ code: 500, msg: 'Error parsing MediaCore response as JSON' });
        }

        // The iframe src comes back unsigned, so we have to sign it and put the new url in
        embedInfo.html = embedInfo.html.replace(/src=["']*([^\s"']*)["']*[\s>]/, (match, url) => {
          url = url.split('?');
          return (
            'src="' +
            MediaCoreUtil.getSignedUrl(
              url[0],
              url[1],
              mediaCoreConfig.keyId,
              mediaCoreConfig.secret
            ) +
            '"' +
            match[match.length - 1]
          );
        });

        return callback(null, embedInfo);
      }
    );
  });
};

/**
 * Update the thumbnail images from MediaCore for a given MediaCore item id. Since this simply updates data
 * from a secure source and does not ingest or release any information, it is not protected with a context
 *
 * @param  {String}     mediaCoreId     The MediaCore item id
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const updateThumbnails = function(mediaCoreId, callback) {
  const validator = new Validator();
  validator
    .check(mediaCoreId, {
      code: 400,
      msg: util.format('Invalid mediaCoreId provided: %s', mediaCoreId)
    })
    .isInt();
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  // Get the content and revision id from the MediaCore id mappings
  MediaCoreDAO.getContentRevisionId(mediaCoreId, (err, contentRevisionId) => {
    if (err) {
      return callback(err);
    }
    if (!contentRevisionId || !contentRevisionId.contentId || !contentRevisionId.revisionId) {
      log().warn('Attempted to update thumbnails for non-existing MediaCore ID: %s', mediaCoreId);
      return callback({ code: 404, msg: 'Non-existing MediaCore ID was provided' });
    }

    // Ensure the content item exists
    ContentDAO.Content.getContent(contentRevisionId.contentId, (err, content) => {
      if (err) {
        return callback(err);
      }

      // Ensure the revision exists
      // eslint-disable-next-line no-unused-vars
      ContentDAO.Revisions.getRevision(contentRevisionId.revisionId, (err, revision) => {
        if (err) {
          return callback(err);
        }

        // const mediaCoreConfig = MediaCoreUtil.getConfig(content.tenant.alias);

        // Get the thumbnail data from MediaCore
        const getThumbsUrl = util.format('/api2/media/%s/thumbs', mediaCoreId);
        MediaCoreUtil.signedRequest(
          content.tenant.alias,
          'get',
          getThumbsUrl,
          null,
          null,
          (err, res, body) => {
            if (err) {
              return callback(err);
            }
            if (res.statusCode !== 200) {
              log().error(
                { code: res.statusCode, body },
                'An unexpected error occurred communicating with MediaCore'
              );
              return callback({
                code: 500,
                msg: util.format(
                  'There was an unexpected error communicating with the media server. Code: %s',
                  res.statusCode
                )
              });
            }

            try {
              body = JSON.parse(body);
            } catch (error) {
              log().error(
                {
                  err: error,
                  mediaCoreId,
                  body
                },
                'Error parsing MediaCore response as JSON'
              );
              return callback({ code: 500, msg: 'Error parsing MediaCore response as JSON' });
            }

            const thumbnailUri = 'remote:' + body.sizes.l;
            const previewMetadata = {
              smallUri: 'remote:' + body.sizes.l,
              mediumUri: 'remote:' + body.sizes['720p'],
              largeUri: 'remote:' + body.sizes['720p'],
              wideUri: 'remote:' + body.sizes['720p'],
              mediaCoreId
            };

            // Store the thumbnail info on the content item
            ContentDAO.Previews.storeMetadata(
              content,
              contentRevisionId.revisionId,
              ContentConstants.previews.DONE,
              thumbnailUri,
              null,
              previewMetadata,
              {},
              err => {
                if (err) {
                  return callback(err);
                }

                // Indicate that we've just updated a preview
                ContentAPI.emitter.emit(ContentConstants.events.UPDATED_CONTENT_PREVIEW, content);

                return callback();
              }
            );
          }
        );
      });
    });
  });
};

module.exports = {
  getEmbedInfo,
  updateThumbnails
};
