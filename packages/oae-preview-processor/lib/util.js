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
import util from 'util';
import PreviewConstants from 'oae-preview-processor/lib/constants';
import sharp from 'sharp';
import request from 'request';
import _ from 'underscore';

import * as ImageUtil from 'oae-util/lib/image';
import * as IO from 'oae-util/lib/io';

import { logger } from 'oae-logger';

const log = logger('oae-preview-processor');

/**
 * Downloads a file that is not located on the OAE server and stores it on disk.
 * The callback method will be called when the file has been fully retrieved or when an error occurs.
 *
 * @param  {String}   url               The URL of the file to download.
 * @param  {String}   path              The path on disk where the file should be stored.
 * @param  {Function} callback          Standard callback function
 * @param  {Object}   callback.err      An error that occurred, if any
 * @param  {String}   callback.path     The path on disk where the file is stored.
 */
const downloadRemoteFile = function(url, path, callback) {
  let called = false;
  const stream = fs.createWriteStream(path);
  stream.on('close', () => {
    IO.destroyStream(stream);
    if (!called) {
      called = true;
      callback(null, path);
    }
  });
  stream.on('error', err => {
    IO.destroyStream(stream);
    log().error({ err, url }, 'Unable to download the file due to a streaming error');
    if (!called) {
      called = true;
      callback({
        code: 500,
        msg: 'The stream errored out when trying to save a remote file: ' + err
      });
    }
  });

  // Download it.
  log().trace('Downloading %s to %s', url, path);
  // Create a new jar so we don't accidentally leak a session.
  const opts = {
    url,
    jar: request.jar()
  };
  // eslint-disable-next-line no-unused-vars
  const req = request(opts, (err, response) => {
    if (err) {
      log().error({ err, url }, 'Unable to download the file due to a request error.');
      if (!called) {
        called = true;
        callback({ code: 500, msg: 'Unable to download the file.' });
      }
    }
  });

  // Pipe the file too the stream
  req.pipe(stream);
};

/**
 * Given an input image, this function will generate the following images:
 *     - A small image (original format, in case of a GIF, only the first frame will be used)
 *     - A medium image (original format, in case of a GIF, only the first frame will be used)
 *     - A large image (original format, in case of a GIF, only the first frame will be used)
 *     - A small thumbnail image (jpg)
 *     - A wide thumbnail image (jpg)
 *
 * @param  {PreviewContext}     ctx                     The current preview context. It allows you to make requests to the app server to retrieve extra metadata
 * @param  {Content}            path                    The path that points towards the input image.
 * @param  {Object}             [options]               A set of options that can be specified
 * @param  {String}             [options.cropMode]      The crop mode that should be used when cropping the image to generate a thumbnail. Either 'TOP' or 'CENTER'. If left undefined, top will be chosen for portrait images and center for landscape images
 * @param  {Boolean}            [options.removeInput]   Whether or not the input image should be removed. Defaults to false.
 * @param  {Function}           callback                Standard callback function
 * @param  {Object}             callback.err            An error that occurred, if any
 */
const generatePreviewsFromImage = function(ctx, path, options, callback) {
  options = options || {};
  options.removeInput = _.isBoolean(options.removeInput) ? options.removeInput : false;

  // Generate an image that has its orientation fixed up. We do this up front to make all the cropping/resizing logic easier
  // and to make the whole preview process more performant (orienting images is very slow).
  // We also re-use the extension if one is available
  const extension = ImageUtil.getImageExtension(path, '.jpg');
  const fixedPath = util.format('%s/fixed%s', ctx.baseDir, extension);
  const opts = {
    outputPath: fixedPath,
    removeInput: options.removeInput
  };
  // eslint-disable-next-line no-unused-vars
  ImageUtil.autoOrient(path, opts, (err, fixedFile) => {
    if (err) {
      return callback(err);
    }

    // Generate different sizes.
    const sizes = [
      {
        width: PreviewConstants.SIZES.IMAGE.LARGE,
        height: PreviewConstants.SIZES.IMAGE.LARGE,
        size: 'large'
      },
      {
        width: PreviewConstants.SIZES.IMAGE.MEDIUM,
        height: PreviewConstants.SIZES.IMAGE.MEDIUM,
        size: 'medium'
      },
      {
        width: PreviewConstants.SIZES.IMAGE.SMALL,
        height: PreviewConstants.SIZES.IMAGE.SMALL,
        size: 'small'
      }
    ];
    _resizeImages(ctx, fixedPath, sizes, err => {
      if (err) {
        return callback(err);
      }

      // Intelligently crop out a part of the image.
      _cropThumbnail(ctx, fixedPath, options.cropMode, callback);
    });
  });
};

/**
 * Resizes an image to one or multiple different sizes.
 *
 * @param  {PreviewContext}      ctx             The preview context associated to this file.
 * @param  {String}              path            The path where the image can be found on disk.
 * @param  {Object[]}            sizes           An array of size object. Each object should have a `width`, `height` and `size` key, the `prefix` key is optional.
 * @param  {Function}            callback        Standard callback function
 * @param  {Object}              callback.err    An error that occurred, if any
 * @api private
 */
const _resizeImages = function(ctx, path, sizes, callback) {
  let todo = sizes.length;
  let called = false;

  // Get the source size first, so we don't accidentally upscale an image that is smaller than the target size.
  sharp(path).metadata((err, metainfo) => {
    if (err) {
      called = true;
      log().error({ err, path, contentId: ctx.content.id }, 'Could not retrieve the size for this image.');
      return callback({ code: 500, msg: err.message });
    }

    sizes.forEach(size => {
      let ratio = metainfo.height / size.height;
      // If both sides are smaller we don't have to do anything.
      if (size.width > metainfo.width && size.height > metainfo.height) {
        ratio = 1;

        // If only the width is larger, we scale it down width-wise
      } else if (metainfo.width > size.width && metainfo.height < size.height) {
        ratio = metainfo.width / size.width;

        // If only the height is larger, we scale it down height-wise
      } else if (metainfo.width < size.width && metainfo.height > size.height) {
        ratio = metainfo.height / size.height;
      }

      // Scale the size
      size.width = Math.floor(metainfo.width / ratio);
      size.height = Math.floor(metainfo.height / ratio);

      // Perform the actual resize.
      _resize(ctx, path, size, err => {
        todo--;
        if (err) {
          if (!called) {
            called = true;
            return callback(err);
          }
        }

        if (todo === 0 && !called) {
          called = true;
          callback();
        }
      });
    });
  });
};

/**
 * Resizes an image to the specified size.
 * The image will be stored at basedir/previews/filename.<size name>.<extension>.
 * The filename will be a concatenation of `size.prefix`, `size.size` and `.extension`.
 * If the input image is a GIF image, the first frame will be cut out and resized.
 *
 * @param  {PreviewContext}      ctx             The preview context associated to this file
 * @param  {String}              path            The path where the image can be found on disk
 * @param  {Object}              size            A size object
 * @param  {Number}              size.width      The width in pixels
 * @param  {Number}              size.height     The height in pixels
 * @param  {String}              size.size       The size of the desired image. One of 'small', 'medium' or 'large'
 * @param  {String}              [size.prefix]   The prefix that should be used in the filename. The end filename will look like <prefix><size>.<extension> . If no prefix is specified, jpg will be used
 * @param  {Function}            callback        Standard callback function
 * @param  {Object}              callback.err    An error that occurred, if any
 * @api private
 */
const _resize = function(ctx, path, size, callback) {
  let inputPath = path;
  if (path.lastIndexOf('.gif') === path.length - 4) {
    // If we're dealing with a GIF, we use the first frame
    inputPath = path + '[0]';
  }

  log().trace({ contentId: ctx.contentId }, 'Resizing image %s to %s x %s', inputPath, size.width, size.height);
  ImageUtil.resizeImage(inputPath, size, (err, file) => {
    if (err) {
      return callback(err);
    }

    // Move the resized image to the base directory for this piece of content
    const prefix = size.prefix || '';
    const extension = ImageUtil.getImageExtension(path, '.jpg');
    const outputPath = ctx.baseDir + '/' + prefix + size.size + extension;
    IO.moveFile(file.path, outputPath, err => {
      if (err) {
        return callback(err);
      }

      // Add it to the set of previews that should be attached to it
      ctx.addPreview(outputPath, size.size);
      callback();
    });
  });
};

/**
 * Intelligently crops out thumbnail images.
 * Two images will be cropped out.
 *   - thumbnail
 *       A square small image to display in list views
 *   - wide
 *       A rectangle that can be used in activity feeds
 *
 * Since these images usually appear in other places than the content profile, these will be strictly `jpg` images
 * so no annoying animations are visible.
 *
 * It's assumed that the EXIF orientation has been fixed by this point.
 *
 * If no cropMode is defined, one will be determined based on the size of the input image.
 * In landscape mode we crop out a box the size of the image height in the (horizontal) center of the image
 * In portrait mode we crop out a box the size of the image width at the top of the image.
 *
 * @param  {PreviewContext}     ctx             The preview context associated to this file.
 * @param  {String}             path            The path where the image can be found on disk.
 * @param  {String}             [cropMode]      Either 'TOP' or 'CENTER'. If left undefined, top will be chosen for portrait images and center for landscape images
 * @param  {Function}           callback        Standard callback function
 * @param  {Object}             callback.err    An error that occurred, if any
 * @api private
 */
const _cropThumbnail = function(ctx, path, cropMode, callback) {
  // Do a proper JPG conversion so we don't end up with `thumbnail.jpg` which are really GIFs masking as JPGs
  ImageUtil.convertToJPG(path, (err, jpgFile) => {
    if (err) {
      return callback(err);
    }

    // Crop the square thumbnail. We *always* crop a thumbnail, if the source image is too small, we'll just have to stretch it
    const opts = {
      allowStretching: true,
      cropMode
    };
    _cropIntelligently(
      ctx,
      jpgFile.path,
      PreviewConstants.SIZES.IMAGE.THUMBNAIL,
      PreviewConstants.SIZES.IMAGE.THUMBNAIL,
      opts,
      'thumbnail.jpg',
      (err, thumbnailPath) => {
        if (err) {
          return callback(err);
        }

        if (!thumbnailPath) {
          // If we weren't able to generate the thumbnail, that means the source image is too small. There is no point in trying to render the large rectangle
          return callback();
        }

        // If the source image is smaller then the target rectangle, the path will be null
        if (thumbnailPath) {
          ctx.setThumbnail(thumbnailPath);
        }

        // Now, crop the large rectangle for activity feeds. We only create this if the source image is large enough
        opts.allowStretching = false;
        _cropIntelligently(
          ctx,
          jpgFile.path,
          PreviewConstants.SIZES.IMAGE.WIDE_WIDTH,
          PreviewConstants.SIZES.IMAGE.WIDE_HEIGHT,
          opts,
          'wide.jpg',
          (err, widePath) => {
            if (err) {
              return callback(err);
            }

            // If the source image is smaller then the target rectangle, the path will be null
            if (widePath) {
              ctx.addPreview(widePath, 'wide');
            }

            callback();
          }
        );
      }
    );
  });
};

/**
 * Crops a subimage out of a base image.
 * In landscape mode we crop out a box the size of the image height in the (horizontal) center of the image
 * In portrait mode we crop out a box the size of the image width at the top of the image.
 *
 * @param  {PreviewContext}     ctx                     The preview context associated to this file.
 * @param  {String}             path                    The path where the image can be found on disk.
 * @param  {Number}             width                   The desired width of the subimage.
 * @param  {Number}             height                  The desired height of the subimage.
 * @param  {Object}             [opts]                  Optional arguments
 * @param  {Boolean}            [opts.allowStretching]  Allowed for the cropped image to be stretched in case the source image is not large enough. If stretching is not allowed and the source image is not large enough, the cropped image will not be generated
 * @param  {String}             [opts.cropMode]         Either 'TOP' or 'CENTER'. If left undefined, top will be chosen for portrait images and center for landscape images
 * @param  {String}             filename                The filename of the generated subimage. The file will be moved to the basedir of the current preview context.
 * @param  {Function}           callback                Standard callback function
 * @param  {Object}             callback.err            An error that occurred, if any
 * @param  {String}             callback.path           The full path where the subimage can be found. If the base image was too small, this will be null (no error, will be passed)
 * @api private
 */
const _cropIntelligently = function(ctx, path, width, height, opts, filename, callback) {
  log().trace({ contentId: ctx.contentId }, 'Cropping image: %s', path);
  opts = opts || {};
  sharp(path).metadata((err, metainfo) => {
    if (err) {
      log().error({ err }, 'Could not get the image size for the large image.');
      return callback({ code: 500, msg: 'Could not get the image size for the large image.' });
    }

    const imageWidth = metainfo.width;
    const imageHeight = metainfo.height;

    // Ignore if the image is too small.
    if (!opts.allowStretching && (imageWidth < width || imageHeight < height)) {
      return callback(null, null);
    }

    // Find the smallest ratio
    const widthRatio = imageWidth / width;
    const heightRatio = imageHeight / height;
    const ratio = widthRatio < heightRatio ? widthRatio : heightRatio;

    const cropWidth = Math.floor(width * ratio);
    const cropHeight = Math.floor(height * ratio);

    if (!opts.cropMode) {
      // In landscape mode we crop out a box the size of the image height in the (absolute) center of the image.
      if (imageWidth > imageHeight) {
        opts.cropMode = 'CENTER';

        // In portrait mode we crop out a box the size of the image width at the top of the image.
        // This is to get the top of the page for content items such as PDFs, Office files, ...
      } else {
        opts.cropMode = 'TOP';
      }
    }

    // TOP cropMode
    const selectedArea = {
      x: 0,
      y: 0,
      width: cropWidth,
      height: cropHeight
    };

    if (opts.cropMode === 'CENTER') {
      selectedArea.x = Math.floor((imageWidth - cropWidth) / 2);
      selectedArea.y = Math.floor((imageHeight - cropHeight) / 3);
    }

    // Crop the correct square.
    ImageUtil.cropAndResize(path, selectedArea, [{ width, height }], (err, files) => {
      if (err) {
        log().error({ err }, 'Could not crop the image.');
        return callback(err);
      }

      // Move the files to the thumbnail path
      const key = width + 'x' + height;
      const croppedPath = ctx.baseDir + '/' + filename;
      IO.moveFile(files[key].path, croppedPath, err => {
        if (err) {
          return callback(err);
        }

        callback(null, croppedPath);
      });
    });
  });
};

const test = (contentObj, fileTypeIsValid) => {
  let testCode = null;
  if (contentObj.resourceSubType === 'file' && fileTypeIsValid) {
    testCode = 10;
  } else {
    testCode = -1;
  }

  return testCode;
};

export { downloadRemoteFile, generatePreviewsFromImage, test };
