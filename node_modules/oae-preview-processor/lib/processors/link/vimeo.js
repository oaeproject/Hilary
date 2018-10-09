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
const request = require('request');

const LinkProcessorUtil = require('oae-preview-processor/lib/processors/link/util');
const PreviewUtil = require('oae-preview-processor/lib/util');

const VIMEO_REGEX = /^http(s)?:\/\/(www\.)?vimeo\.com\/(\d+)(\/.*)?$/;

/**
 * @borrows Interface.test as VimeoProcessor.test
 */
const test = function(ctx, contentObj, callback) {
  // Don't bother with non-link content items.
  if (contentObj.resourceSubType !== 'link') {
    return callback(null, -1);
  }

  // Check if it's a Vimeo URL.
  if (VIMEO_REGEX.test(contentObj.link)) {
    return callback(null, 10);
  }
  return callback(null, -1);
};

/**
 * @borrows Interface.generatePreviews as VimeoProcessor.generatePreviews
 */
const generatePreviews = function(ctx, contentObj, callback) {
  const id = _getId(contentObj.link);

  // Do an API request first.
  const apiUrl = util.format('http://vimeo.com/api/v2/video/%s.json', id);
  request(apiUrl, (err, response, body) => {
    if (err || response.statusCode !== 200) {
      return callback(err || { code: response.statusCode, msg: body });
    }

    // Get Thumbnail url.
    const info = JSON.parse(body);

    // Ignoring this video if it has no thumbnail.
    if (_.isEmpty(info) || !info[0].thumbnail_medium) {
      return callback(null, false);
    }

    const opts = {
      displayName: info[0].title,
      description: info[0].description
    };

    // Download it.
    const imageUrl = info[0].thumbnail_medium;
    const path = ctx.baseDir + '/vimeo.png';
    PreviewUtil.downloadRemoteFile(imageUrl, path, (err, path) => {
      if (err) {
        return callback(err);
      }

      LinkProcessorUtil.generatePreviewsFromImage(ctx, path, opts, callback);
    });
  });
};

/**
 * Gets a Vimeo movie identifier out of a url.
 * If the url is 'http://vimeo.com/46651666', '46651666' will be returned.
 *
 * @param  {String} url The Vimeo URL.
 * @return {String}     The movie identifier (or null.)
 * @api private
 */
const _getId = function(url) {
  const match = url.match(VIMEO_REGEX);
  if (match) {
    return match[3];
  }
  return null;
};

module.exports = {
  test,
  generatePreviews
};
