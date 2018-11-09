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

const fs = require('fs');
const util = require('util');
const request = require('request');
const _ = require('underscore');

const log = require('oae-logger').logger('oae-mediacore');
const PreviewConstants = require('oae-preview-processor/lib/constants');

const MediaCoreConfig = require('oae-config').config('oae-mediacore');
const MediaCoreDAO = require('./internal/dao');
const MediaCoreUtil = require('./internal/util');

/**
 * @borrows Interface.test as Videos.test
 */
const test = function(ctx, content, callback) {
  if (
    content.resourceSubType === 'file' &&
    MediaCoreConfig.getValue(content.tenant.alias, 'mediacore', 'enabled')
  ) {
    if (_isVideo(ctx.revision.mime) || _isAudio(ctx.revision.mime)) {
      return callback(null, 20);
    }
  }

  return callback(null, -1);
};

/**
 * @borrows Interface.generatePreviews as Videos.generatePreviews
 */
const generatePreviews = function(ctx, content, callback) {
  // If this revision has already been sent to MediaCore and processed, do not re-upload it. Instead just
  // regenerate the thumbnail images from the MediaCore API
  const { revision } = ctx;
  if (revision.previews && revision.previews.mediaCoreId) {
    return _addMetadata(ctx, content, revision.previews.mediaCoreId, callback);
  }

  // Download the video file
  ctx.download((err, path) => {
    if (err) {
      log().error({ err }, 'Error downloading previews');
      return callback(err);
    }

    const tenantAlias = content.tenant.alias;

    // Create a media item
    MediaCoreUtil.signedRequest(
      tenantAlias,
      'post',
      '/api2/media',
      null,
      {
        // eslint-disable-next-line camelcase
        collection_id: MediaCoreUtil.getConfig(tenantAlias).collectionId,
        title: content.displayName,
        // eslint-disable-next-line camelcase
        byline: content.createdBy.displayName,
        description: null,
        tags: null
      },
      (err, res, body) => {
        if (
          _checkError(err, 'Error POSTing to create the MediaCore video item', res, body, callback)
        ) {
          return;
        }

        const mediaId = body.id;

        // Save the mediaId to Cassandra so we can use it to refresh thumbnails later
        MediaCoreDAO.saveContentRevisionId(
          mediaId.toString(),
          ctx.contentId,
          ctx.revisionId,
          err => {
            if (err) {
              return callback(err);
            }

            // Ask MediaCore to let us upload a file to the media item
            MediaCoreUtil.signedRequest(
              tenantAlias,
              'post',
              util.format('/api2/media/%s/files', mediaId),
              null,
              {
                // eslint-disable-next-line camelcase
                upload_name: revision.filename,
                // eslint-disable-next-line camelcase
                upload_size: revision.size
              },
              (err, res, body) => {
                if (
                  _checkError(
                    err,
                    'Error POSTing to create the MediaCore video file',
                    res,
                    body,
                    callback
                  )
                ) {
                  return;
                }

                // The upload protocol is an entity returned from MediaCore that indicates how a file should be posted to
                // the server for a particular media item. It will be used later to determine what information to send
                const uploadProtocol = body.upload.protocols.form_data;

                // Tell MediaCore to "publish" the media item
                MediaCoreUtil.signedRequest(
                  tenantAlias,
                  'post',
                  util.format('/api2/media/%s/publish', mediaId),
                  null,
                  null,
                  (err, res, body) => {
                    if (
                      _checkError(
                        err,
                        'Error POSTing to publish the MediaCore item',
                        res,
                        body,
                        callback
                      )
                    ) {
                      return;
                    }

                    // Upload the file as multipart/form-data
                    const uploadReq = request.post(uploadProtocol.upload_url, (err, res, body) => {
                      if (
                        _checkError(
                          err,
                          'Error uploading the MediaCore video file to MediaCore',
                          res,
                          body,
                          callback
                        )
                      ) {
                        return;
                      }

                      // Notify MediaCore that we're done uploading the file
                      if (uploadProtocol.postprocess_url) {
                        MediaCoreUtil.signedRequest(
                          tenantAlias,
                          'post',
                          uploadProtocol.postprocess_url,
                          null,
                          {
                            // eslint-disable-next-line camelcase
                            response_status: res.statusCode,
                            // eslint-disable-next-line camelcase
                            response_body: body
                          },
                          (err, res, body) => {
                            if (
                              _checkError(
                                err,
                                'Error POSTing to notify MediaCore the file has completed uploading',
                                res,
                                body,
                                callback
                              )
                            ) {
                              return;
                            }

                            _addMetadata(ctx, content, mediaId, callback);
                          }
                        );
                      } else {
                        _addMetadata(ctx, content, mediaId, callback);
                      }
                    });

                    // Add the body parameters to the multi-part upload form
                    const form = uploadReq.form();
                    _.each(uploadProtocol.upload_post_params, (value, key) => {
                      form.append(key, value);
                    });

                    form.append(uploadProtocol.upload_file_param, fs.createReadStream(path));
                  }
                );
              }
            );
          }
        );
      }
    );
  });
};

/**
 * Determine whether or not the given mimeType is that of a video
 *
 * @param  {String}     mimeType        The mimetype to test
 * @return {Boolean}                    `true` or `false`, indicating whether or not the given mime type indicates a video file
 * @api private
 */
const _isVideo = function(mimeType) {
  return PreviewConstants.TYPES.VIDEO.indexOf(mimeType) !== -1;
};

/**
 * Determine whether or not the given mimeType is that of an audio
 *
 * @param  {String}     mimeType        The mimetype to test
 * @return {Boolean}                    `true` or `false`, indicating whether or not the given mime type indicates an audio file
 * @api private
 */
const _isAudio = function(mimeType) {
  return PreviewConstants.TYPES.AUDIO.indexOf(mimeType) !== -1;
};

/**
 * Fetch and apply the preview metadata (image uris and mediaCoreId) to the preview context.
 *
 * @param  {PreviewContext}     ctx                 The preview context on which to set the thumbnails
 * @param  {String}             mediaCoreId         The id of the MediaCore item that maps to the revision
 * @param  {Function}           callback            Standard callback function
 * @param  {Object}             callback.err        An error that occurred, if any
 * @api private
 */
const _addMetadata = function(ctx, content, mediaCoreId, callback) {
  ctx.addPreviewMetadata('mediaCoreId', mediaCoreId);

  // Get thumbnail urls
  MediaCoreUtil.signedRequest(
    content.tenant.alias,
    'get',
    util.format('/api2/media/%s/thumbs', mediaCoreId),
    null,
    null,
    (err, res, body) => {
      if (_checkError(err, 'Error getting the thumbnail urls', res, body, callback)) {
        return;
      }

      try {
        body = JSON.parse(body);
      } catch (error) {
        log().error(
          { err: error, body },
          'Received invalid response from MediaCore when getting thumbnail urls'
        );
        return callback({ code: 500, msg: error.message });
      }

      ctx.addPreview(body.sizes.l, 'thumbnail');
      ctx.addPreview(body.sizes.l, 'small');
      ctx.addPreview(body.sizes['720p'], 'medium');
      ctx.addPreview(body.sizes['720p'], 'large');
      ctx.addPreview(body.sizes['720p'], 'wide');

      return callback();
    }
  );
};

/**
 * Check if the given response indicates an error that occurred. If so, this method will invoke the callback and
 * return `true`. Otherwise, `false` will be returned without invoking the callback.
 *
 * @param  {Object}     err             An error that occurred, if any
 * @param  {Response}   response        The ExpressJS response to check for errors
 * @param  {String}     body            The body of the response
 * @param  {String}     message         The log message for the log entry if this is an error
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @return {Boolean}                    `true` if the input represents an error, `false` otherwise
 * @api private
 */
const _checkError = function(err, message, res, body, callback) {
  if (err) {
    log().error({ err }, message);
    callback(err);
    return true;
  }
  if (res.statusCode >= 400) {
    const responseErr = { code: res.statusCode, msg: message, body };
    log().error({ err: responseErr }, message);
    callback(responseErr);
    return true;
  }

  return false;
};

module.exports = {
  test,
  generatePreviews
};
