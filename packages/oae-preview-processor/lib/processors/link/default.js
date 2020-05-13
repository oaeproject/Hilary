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

import fs from 'fs';
import path from 'path';
import url from 'url';
import PreviewConstants from 'oae-preview-processor/lib/constants';
import sharp from 'sharp';

import {
  both,
  isEmpty,
  head,
  concat,
  split,
  equals,
  add,
  compose,
  slice,
  defaultTo,
  match,
  lastIndexOf,
  not,
  find,
  __,
  propEq,
  includes,
  path as getPath
} from 'ramda';
import request from 'request';

import { logger } from 'oae-logger';

import * as OaeUtil from 'oae-util/lib/util';
const { getNumberParam } = OaeUtil;
import { setUpConfig } from 'oae-config';
import * as LinkProcessorUtil from 'oae-preview-processor/lib/processors/link/util';
import * as puppeteerHelper from 'oae-preview-processor/lib/internal/puppeteer';

const log = logger('oae-preview-processor');
const PrincipalsConfig = setUpConfig('oae-principals');

const screenShottingOptions = {};
const HTTP_HEAD = 'HEAD';

// Auxiliary functions
const increment = add(1);
const isOneOfForbidden = find(__, PreviewConstants.FORBIDDEN.INTERNAL_IPS);
const isDefined = Boolean;

/**
 * Initializes the Default Link Preview Processor
 *
 * @param  {Object}     [_config]                           The config object containing the timeouts for generating an image from a webpage
 * @param  {Number}     [_config.timeout]                   Defines the timeout (in ms) when the screencapturing should be stopped.  Defaults to 30000ms
 * @param  {Function}   callback                            Standard callback function
 * @param  {Object}     callback.err                        An error that occurred, if any
 */
const init = function(_config, callback) {
  _config = defaultTo({}, _config);

  screenShottingOptions.timeout = getNumberParam(_config.screenShotting.timeout, screenShottingOptions.timeout);
  screenShottingOptions.viewport = _config.screenShotting.viewport;

  const chromiumExecutable = _config.screenShotting.binary;
  if (chromiumExecutable) screenShottingOptions.executablePath = chromiumExecutable;

  const sandboxArgs = _config.screenShotting.sandbox;
  if (sandboxArgs) screenShottingOptions.args = [sandboxArgs];

  return callback();
};

/**
 * @borrows Interface.test as DefaultLinkProcessor.test
 */
const test = function(ctx, contentObj, callback) {
  // Don't bother with non-link content items
  const isLink = propEq('resourceSubType', 'link');
  if (isLink(contentObj)) {
    const { link } = contentObj;
    // Only allow HTTP(S) URLs
    const isHTTPS = compose(not, isEmpty, match(/^http(s)?:\/\//));
    if (isHTTPS(link)) {
      // Don't generate previews for internal IPs
      const extractFromLink = slice(__, link);
      const ipAddress = compose(extractFromLink, increment, lastIndexOf('://'))(link);
      const isNotForbidden = compose(not, isOneOfForbidden)(ipAddress);

      // Default to the lowest possible score
      if (isNotForbidden) return callback(null, 1);
    }
  }

  return callback(null, -1);
};

/**
 * @borrows Interface.test as DefaultLinkProcessor.test
 */
const generatePreviews = function(ctx, contentObj, callback) {
  let contentType;
  // Do a head request to check if this site allows for embedding
  const options = {
    url: contentObj.link,
    method: HTTP_HEAD,
    timeout: screenShottingOptions.timeout,
    headers: {
      // Certain webservers will not send an `x-frame-options` header when no browser user agent is not specified
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/32.0.1700.77 Safari/537.36',
      'Accept-Language': PrincipalsConfig.getValue(contentObj.tenant.alias, 'user', 'defaultLanguage')
    }
  };

  request(options, (err, response) => {
    if (err) {
      log().warn(
        { err, contentId: ctx.contentId },
        'An error occurred while checking if this URL allows for iframe embedding'
      );
      ctx.addPreviewMetadata('embeddable', false);
    } else {
      // The link isn't embeddable because the browser will prompt to save the target if the Content-Disposition header is set to attachment
      const isAttachment = compose(equals('attachment'), head, split(';'), getPath(['headers', 'content-disposition']));

      let forcedDownload = both(getPath(['headers', 'content-disposition']), isAttachment)(response);

      // ..or it's type is 'application/octet-stream'
      const isOctectStream = equals(PreviewConstants.TYPES.DEFAULT);
      forcedDownload = defaultTo(
        compose(isOctectStream, getPath(['headers', 'content-type']))(response),
        forcedDownload
      );

      /**
       * See https://developer.mozilla.org/en-US/docs/HTTP/X-Frame-Options
       * There are 3 options for the x-frame-options header:
       *      - DENY
       *      - SAMEORIGIN
       *      - ALLOW-FROM uri
       *
       * All 3 of these would block embedding so as soon as the header is defined,
       * we add some metadata that tells the UI this link cannot be embedded.
       */
      if (defaultTo(forcedDownload, getPath(['headers', 'x-frame-options'], response))) {
        ctx.addPreviewMetadata('embeddable', false);
      } else {
        ctx.addPreviewMetadata('embeddable', true);
      }

      contentType = getPath(['headers', 'content-type'], response);
      ctx.addPreviewMetadata('targetType', contentType);
    }

    /*!
     * Generate a thumbnail
     */
    const generateThumbnail = function() {
      const imgPath = concat(ctx.baseDir, '/webshot.png');
      // If the link target is an image just grab it instead of screenshotting it
      const isImage = includes(__, PreviewConstants.TYPES.IMAGE);
      if (both(isDefined, isImage)(contentType)) {
        const image = fs.createWriteStream(imgPath);
        image.on('close', () => {
          LinkProcessorUtil.generatePreviewsFromImage(ctx, imgPath, null, callback);
        });
        request(contentObj.link)
          .on('error', err => {
            log().error({ err, contentId: ctx.contentId }, 'Could not fetch an image');
            return callback();
          })
          .pipe(image);
      } else {
        // Try to localize the screenshot of the link to the default tenant language
        screenShottingOptions.customHeaders = {
          'Accept-Language': PrincipalsConfig.getValue(contentObj.tenant.alias, 'user', 'defaultLanguage')
        };
        puppeteerHelper.getImage(contentObj.link, imgPath, screenShottingOptions, err => {
          if (err) {
            log().error({ err, contentId: ctx.contentId }, 'Could not generate an image');
            return callback(err);
          }

          // specific callback for image comparison
          const throwComparisonError = (err, callback) => {
            log().error({ err, contentId: ctx.contentId }, 'Could not compare image');
            return callback(err);
          };

          // If the image is solid white don't attach it as a screenshot
          sharp(imgPath).metadata((err, imageMetainfo) => {
            if (err) throwComparisonError(err, callback);
            sharp(path.resolve(__dirname, '../../../static/link/blank.png')).metadata((err, solidWhiteMetainfo) => {
              if (err) throwComparisonError(err, callback);

              const isEqual = equals(imageMetainfo, solidWhiteMetainfo);
              log().trace({ contentId: ctx.contentId, equality: isEqual });

              if (isEqual) {
                log().info({ contentId: ctx.contentId }, 'Not attaching blank screenshot');
                return callback();
              }

              return LinkProcessorUtil.generatePreviewsFromImage(ctx, imgPath, null, callback);
            });
          });
        });
      }
    };

    const urlParts = new URL(contentObj.link);

    // If we previously tried an HTTPS link we can just determine whether the link is embeddable over HTTPS by checking if that request succeeded
    const isHTTPS = equals('https:');
    if (isHTTPS(urlParts.protocol)) {
      const httpsAccessible = not(err);
      ctx.addPreviewMetadata('httpsAccessible', httpsAccessible);
      return generateThumbnail();

      // Otherwise we need to do an extra request
    }

    urlParts.protocol = 'https:';
    const link = url.format(urlParts);
    _checkHttps(link, httpsAccessible => {
      ctx.addPreviewMetadata('httpsAccessible', httpsAccessible);
      return generateThumbnail();
    });
  });
};

/**
 * Check if a link is accessible over HTTPS
 *
 * @param  {String}     link                        The link to check. Note that his link should already have https: as it's protocol
 * @param  {Function}   callback                    Standard callback function
 * @param  {Boolean}    callback.httpsAccessible    Whether or not the link can be reached over HTTPS
 * @api private
 */
const _checkHttps = function(link, callback) {
  const options = {
    url: link,
    method: HTTP_HEAD,
    timeout: screenShottingOptions.timeout
  };
  request(options, (err /* , response */) => {
    if (err) return callback(false);

    return callback(true);
  });
};

export { init, test, generatePreviews };
