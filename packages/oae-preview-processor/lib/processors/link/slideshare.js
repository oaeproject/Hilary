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

import slideshare from 'slideshare';
import { logger } from 'oae-logger';
import { setUpConfig } from 'oae-config';

import * as LinkProcessorUtil from 'oae-preview-processor/lib/processors/link/util.js';
import * as PreviewUtil from 'oae-preview-processor/lib/util.js';

const log = logger('oae-preview-processor');
const PreviewConfig = setUpConfig('oae-preview-processor');

// Regular expression that will be used to check if the provided URL is a SlideShare URL
const SLIDES_REGEX = /^http(s)?:\/\/(www\.)?slideshare\.net\/(\w+)\/(\w+)/;

// The URL where the SlideShare REST API can be reached
let apiUrl = 'https://www.slideshare.net/api/2/';

/**
 * Set the URL where the SlideShare REST API can be reached
 *
 * @param  {String}     _apiUrl     Defines the URL (including protocol and path) where the SlideShare REST API can be reached
 */
const setApiURL = function (_apiUrl) {
  apiUrl = _apiUrl;
};

/**
 * @borrows Interface.test as SlideShareProcessor.test
 */
const test = function (ctx, contentObj, callback) {
  // Don't bother with non-link content items
  if (contentObj.resourceSubType !== 'link') {
    return callback(null, -1);
  }

  // Check if we're configured to deal with SlideShare URLs
  const config = _getConfig();
  if (!config.apiKey || !config.sharedSecret) {
    return callback(null, -1);
  }

  // Check if they are SlideShare URLs
  if (SLIDES_REGEX.test(contentObj.link)) {
    return callback(null, 10);
  }

  return callback(null, -1);
};

/**
 * @borrows Interface.generatePreviews as SlideShareProcessor.generatePreviews
 */
const generatePreviews = function (ctx, contentObj, callback) {
  const config = _getConfig();

  // eslint-disable-next-line new-cap
  const ss = new slideshare(config.apiKey, config.sharedSecret);
  // eslint-disable-next-line camelcase
  ss.api_url = apiUrl;
  ss.getSlideshowByURL(contentObj.link, (response) => {
    if (!response || response.SlideShareServiceError) {
      log().error({ err: response.SlideShareServiceError }, 'Failed to interact with the SlideShare API');
      return callback({ code: 500, msg: 'Failed to interact with the SlideShare API' });

      // Ignore this image if it has no thumbnail
    }

    if (!response.Slideshow || !response.Slideshow.ThumbnailURL) {
      return callback(null, true);
    }

    const result = response.Slideshow;

    // Try to get some optional metadata about this slideshow such as the title and/or description. The display name
    // will only be overridden with the title retrieved from SlideShare when the content item's display name has not been set
    // by the user (i.e. the SlideShare URL is used as the displayName). The description retrieved from SlideShare will only be
    // set on the content item when the content item has no description
    const opts = {};
    if (result.Title && result.Title.length > 0) {
      opts.displayName = result.Title[0];
    }

    if (result.Description && result.Description.length > 0) {
      opts.description = result.Description[0];
    }

    // Download the thumbnail
    const imageUrl = 'http:' + result.ThumbnailURL[0];
    const path = ctx.baseDir + '/slideshare.jpg';
    PreviewUtil.downloadRemoteFile(imageUrl, path, (err, path) => {
      if (err) {
        return callback(err);
      }

      LinkProcessorUtil.generatePreviewsFromImage(ctx, path, opts, callback);
    });
  });
};

/**
 * Get the SlideShare API values that have been configured in the Admin UI
 *
 * @return {Object}     The apiKey and sharedSecret from the Admin UI
 * @api private
 */
const _getConfig = function () {
  return {
    apiKey: PreviewConfig.getValue('admin', 'slideshare', 'apikey'),
    sharedSecret: PreviewConfig.getValue('admin', 'slideshare', 'sharedsecret')
  };
};

export { setApiURL, test, generatePreviews };
