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

import Youtube from 'youtube-api';
import { logger } from 'oae-logger';
import { setUpConfig } from 'oae-config';

import * as LinkProcessorUtil from 'oae-preview-processor/lib/processors/link/util.js';
import * as PreviewUtil from 'oae-preview-processor/lib/util.js';

const log = logger('oae-preview-processor');
const PreviewConfig = setUpConfig('oae-preview-processor');

const YOUTUBE_FULL_REGEX = /^http(s)?:\/\/(www\.)?youtube\.com\/watch/;
const YOUTUBE_SHORT_REGEX = /^http(s)?:\/\/youtu.be\/(.+)/;

/**
 * @borrows Interface.test as YoutubeProcessor.test
 */
const test = function (ctx, contentObject, callback) {
  // Don't bother with non-link content items
  if (contentObject.resourceSubType !== 'link') {
    return callback(null, -1);
  }

  // Check if we're configured to deal with Youtube URLs
  const key = PreviewConfig.getValue('admin', 'youtube', 'key');
  if (!key) {
    return callback(null, -1);
  }

  // Check if it's a Youtube URL
  if (YOUTUBE_FULL_REGEX.test(contentObject.link) || YOUTUBE_SHORT_REGEX.test(contentObject.link)) {
    return callback(null, 10);
  }

  return callback(null, -1);
};

/**
 * @borrows Interface.generatePreviews as YoutubeProcessor.generatePreviews
 */
const generatePreviews = function (ctx, contentObject, callback) {
  // Get the movie identifier
  const id = _getId(contentObject.link);

  Youtube.authenticate({
    type: 'key',
    key: PreviewConfig.getValue('admin', 'youtube', 'key')
  });

  // Get the metadata for this video
  Youtube.videos.list({ part: 'snippet', id }, (error, data) => {
    if (error) {
      log().error({ err: error }, 'Could not talk to the youtube api.');
      return callback({ code: 500, msg: error.message });
    }

    if (data && data.items && data.items[0] && data.items[0].snippet) {
      const { snippet } = data.items[0];

      const options = {
        displayName: snippet.title,
        description: snippet.description
      };

      // Download it
      const thumbnail = snippet.thumbnails.maxres || snippet.thumbnails.default;
      const imageUrl = thumbnail.url;
      const path = ctx.baseDir + '/youtube.jpg';
      PreviewUtil.downloadRemoteFile(imageUrl, path, (error_, path) => {
        if (error_) {
          return callback(error_);
        }

        LinkProcessorUtil.generatePreviewsFromImage(ctx, path, options, callback);
      });
    } else {
      return callback(false, true);
    }
  });
};

/**
 * Gets a YouTube movie identifier out of a url.
 * If the url is 'http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ' will be returned.
 * If the url is 'http://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ' will be returned.
 *
 * @param  {String}     url     The YouTube URL
 * @return {String}             The movie identifier (or null)
 * @api private
 */
const _getId = function (link) {
  const parsedUrl = new URL(link);

  // The full link has the ID in the `v` query parameter
  if (/(www\.)?youtube\.com$/.test(parsedUrl.hostname)) {
    return parsedUrl.searchParams.get('v');

    // The short link has it as its path
  }

  if (parsedUrl.hostname === 'youtu.be') {
    return parsedUrl.pathname.slice(1);

    // Although not really possible, but we return null in all other cases
  }

  return null;
};

export { test, generatePreviews };
