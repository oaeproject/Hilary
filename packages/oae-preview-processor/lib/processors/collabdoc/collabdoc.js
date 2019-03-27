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
const Path = require('path');
const _ = require('underscore');
const cheerio = require('cheerio');

const ImageUtil = require('oae-util/lib/image');
const IO = require('oae-util/lib/io');
const log = require('oae-logger').logger('oae-preview-processor');
const RestAPI = require('oae-rest');
const OaeUtil = require('oae-util/lib/util');

const PreviewConstants = require('oae-preview-processor/lib/constants');
const puppeteerHelper = require('oae-preview-processor/lib/internal/puppeteer');

const screenShottingOptions = {
  viewport: {
    width: PreviewConstants.SIZES.IMAGE.WIDE_WIDTH,
    height: PreviewConstants.SIZES.IMAGE.WIDE_HEIGHT
  }
};
const COLLABDOC = 'collabdoc';
const COLLABSHEET = 'collabsheet';

/**
 * Initializes the CollabDocProcessor
 *
 * @param  {Object}     [_config]                           The config object containing the timeouts for generating an image from a webpage
 * @param  {Number}     [_config.timeout]                   Defines the timeout (in ms) when the screencapturing should be stopped.  Defaults to 30000ms
 * @param  {Function}   callback                            Standard callback function
 * @param  {Object}     callback.err                        An error that occurred, if any
 */
const init = function(_config, callback) {
  _config = _config || {};

  screenShottingOptions.timeout = OaeUtil.getNumberParam(_config.screenShotting.timeout, screenShottingOptions.timeout);

  const chromiumExecutable = _config.screenShotting.binary;
  if (chromiumExecutable) {
    screenShottingOptions.executablePath = chromiumExecutable;
  }

  return callback();
};

// Variable that will be used to lazy-load the collabdoc.html template
let wrapperHtml = null;

// The absolute path to the html & css files
const basePath = Path.normalize(Path.join(__dirname, '/../../../static/collabdoc/'));
const HTML_FILE = Path.join(basePath, 'collabdoc.html');
const CSS_FILE = Path.join(basePath, 'collabdoc.css');
const FILE_URI = 'file://';

/**
 * @borrows Interface.test as CollabDocProcessor.test
 */
const test = function(ctx, contentObj, callback) {
  if (contentObj.resourceSubType === COLLABDOC || contentObj.resourceSubType === COLLABSHEET) {
    callback(null, 10);
  } else {
    callback(null, -1);
  }
};

/**
 * @borrows Interface.generatePreviews as CollabDocProcessor.generatePreviews
 */
const generatePreviews = function(ctx, contentObj, callback) {
  // Do a check to see if this document has been published yet.
  // If there is more then 1 revision it has been published.
  RestAPI.Content.getRevisions(ctx.tenantRestContext, contentObj.id, null, 2, (err, revisions) => {
    if (err) {
      return callback(err);
    }

    if (revisions.results.length === 1) {
      // Only 1 revision => unpublished document.
      // Ignore it for now.
      return callback(null, true);
    }

    // Store whether this document is a collaborative document or spreadsheet
    const type = contentObj.resourceSubType;
    const html = type === COLLABDOC ? 'etherpadHtml' : 'ethercalcHtml';

    // Write the HTML to an HTML file, so a screenshot can be generated as the preview
    _writeCollabHtml(ctx, contentObj.latestRevision[html], type, function(err, collabFilePath) {
      if (err) {
        return callback(err);
      }

      // Generate a screenshot that is suitable to display in the activity feed.
      const collabFileUri = FILE_URI + collabFilePath;
      const imgPath = Path.join(ctx.baseDir, '/wide.png');

      puppeteerHelper.getImage(collabFileUri, imgPath, screenShottingOptions, err => {
        if (err) {
          log().error({ err, contentId: ctx.contentId }, 'Could not generate an image');
          return callback(err);
        }

        ctx.addPreview(imgPath, 'wide');

        // Crop out a thumbnail, manually since we know the image is 1070x500.
        // We'll crop out a top-left box.
        const selectedArea = {
          x: 0,
          y: 0,
          width: PreviewConstants.SIZES.IMAGE.WIDE_HEIGHT,
          height: PreviewConstants.SIZES.IMAGE.WIDE_HEIGHT
        };
        ImageUtil.cropAndResize(
          imgPath,
          selectedArea,
          [
            {
              width: PreviewConstants.SIZES.IMAGE.THUMBNAIL,
              height: PreviewConstants.SIZES.IMAGE.THUMBNAIL
            }
          ],
          (err, files) => {
            if (err) {
              log().error({ err }, 'Could not crop the image');
              return callback(err);
            }

            // Move the files to the thumbnail path
            const key = PreviewConstants.SIZES.IMAGE.THUMBNAIL + 'x' + PreviewConstants.SIZES.IMAGE.THUMBNAIL;
            const thumbnailPath = Path.join(ctx.baseDir, '/thumbnail.png');

            IO.moveFile(files[key].path, thumbnailPath, err => {
              if (err) {
                return callback(err);
              }

              ctx.setThumbnail(thumbnailPath);
              callback();
            });
          }
        );
      });
    });
  });
};

/**
 * Take the provided Collab HTML, wrap into the preview template and store it to disk
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     collabHtml    The HTML to wrap into the preview template
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.path   The path the file has been written to
 * @api private
 */
const _writeCollabHtml = function(ctx, collabHtml, type, callback) {
  _getWrappedCollabHtml(ctx, collabHtml, (err, wrappedHtml) => {
    if (err) {
      return callback(err);
    }

    // Write the resulting HTML to a temporary file on disk
    const collabFilePath =
      type === COLLABDOC ? Path.join(ctx.baseDir, '/etherpad.html') : Path.join(ctx.baseDir, '/ethercalc.html');
    fs.writeFile(collabFilePath, wrappedHtml, err => {
      if (err) {
        log().error({ err, contentId: ctx.contentId }, 'Could not write the collaborative file preview HTML to disk');
        return callback({ code: 500, msg: 'Could not write the collaborative file preview HTML to disk' });
      }

      return callback(null, collabFilePath);
    });
  });
};

/**
 * Wrap provided HTML into an HTML template
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     etherpadHtml    The HTML as retrieved from the API
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.html   Resulting wrapped HTML
 * @api private
 */
const _getWrappedCollabHtml = function(ctx, collabHtml, callback) {
  let htmlFragment = null;
  // Extract the body from the HTML fragment
  try {
    const $ = cheerio.load(collabHtml);
    htmlFragment = $('body').html() || '';
  } catch (error) {
    log().error(
      { err: error, collabHtml, contentId: ctx.contentId },
      'Unable to parse collaborative file preview HTML'
    );
    return callback({ code: 500, msg: 'Unable to parse etherpad HTML' });
  }

  // The data that can be used in the collabdoc preview template
  const templateData = {
    ctx,
    htmlFragment,
    cssFile: CSS_FILE
  };

  // Check if the wrapper HTML has already been loaded to avoid loading it twice
  if (wrapperHtml) {
    callback(null, _.template(wrapperHtml)(templateData));
  } else {
    fs.readFile(HTML_FILE, 'utf8', (err, content) => {
      if (err) {
        log().error({ err, contentId: ctx.contentId }, 'Could not read the collaborative file preview wrapper HTML');
        return callback({ code: 500, msg: 'Could not read the collaborative file preview wrapper HTML' });
      }

      // Cache the wrapped HTML
      wrapperHtml = content;
      callback(null, _.template(wrapperHtml)(templateData));
    });
  }
};

module.exports = {
  init,
  test,
  generatePreviews
};
