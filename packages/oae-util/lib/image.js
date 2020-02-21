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

import { exec } from 'child_process';

import fs from 'fs';
import path from 'path';
import util from 'util';
import gm from 'gm';
import temp from 'temp';
import _ from 'underscore';

import { logger } from 'oae-logger';

import { Validator as validator } from 'oae-util/lib/validator';
const {
  unless,
  validateInCase: bothCheck,
  isObject,
  isZeroOrGreater: zeroOrGreater,
  isGreaterThanZero: oneOrGreater,
  isNotNull,
  toInt,
  isArrayNotEmpty
} = validator;
import { pipe } from 'ramda';

const log = logger('oae-util-image');
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif'];

// const integerIsZeroOrGreater = pipe(toInt, zeroOrGreater);
// const integerIsOneOrGreater = pipe(toInt, oneOrGreater);

/**
 * Auto orients an image (based on the EXIF Orientation data) and stores it in a temporary file
 *
 * @param  {String}     inputPath               The path to the image to auto orient
 * @param  {Object}     [opts]                  Extra options
 * @param  {String}     [opts.outputPath]       If specified, the oriented image will be written to this location. If left undefined, a temporary path will be generated
 * @param  {Boolean}    [opts.removeInput]      If set to `true`, the input image will be removed
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.file           A file object with some metadata of the oriented file
 * @param  {String}     callback.file.path      The path where the file has been written to
 * @param  {String}     callback.file.name      The name of the file
 * @param  {Number}     callback.file.size      The size of the oriented image (in bytes)
 */
const autoOrient = function(inputPath, opts, callback) {
  opts = opts || {};
  const outputPath = opts.outputPath || temp.path({ suffix: getImageExtension(inputPath, '.jpg') });
  gm(inputPath)
    .noProfile()
    .autoOrient()
    .write(outputPath, err => {
      if (err) {
        fs.unlink(outputPath, err => {
          if (err) {
            log().warn({ err, path: outputPath }, 'Could not unlink a file');
          }
        });
        log().error({ err }, 'Could not auto orient the image %s', inputPath);
        return callback({ code: 500, msg: 'Could not auto orient the image' });
      }

      fs.stat(outputPath, (err, stat) => {
        if (err) {
          fs.unlink(outputPath, () => {
            if (err) {
              log().warn({ err, path: outputPath }, 'Could not unlink a file');
            }
          });
          log().error({ err }, 'Could not get the file system information about %s', outputPath);
          return callback({
            code: 500,
            msg: 'Could not retrieve the file information for the cropped file'
          });
        }

        const file = {
          path: outputPath,
          size: stat.size,
          name: path.basename(outputPath)
        };

        // Return without deleting the file if the caller specified to do so
        if (!opts.removeInput) {
          return callback(null, file);
        }

        // Delete the input file now that we've completed
        fs.unlink(inputPath, err => {
          if (err) {
            log().error({ err }, 'Could not unlink the input image');
            return callback({ code: 500, msg: 'Could not unlink the input image' });
          }

          return callback(null, file);
        });
      });
    });
};

/**
 * Crops and resizes an image
 *
 * @param  {String}     imagePath               The path on disk of the image to crop
 * @param  {Number}     selectedArea.x          The x coordinate of the topleft corner to start cropping
 * @param  {Number}     selectedArea.y          The y coordinate of the topleft corner to start cropping
 * @param  {Number}     selectedArea.width      The width of the image that needs to be cropped out
 * @param  {Number}     selectedArea.height     The height of the image that needs to be cropped out
 * @param  {Object[]}   sizes                   An array of image sizes. An image will be generated for each size. Each object needs to specify the width and size for the resized image
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.files          An object where each entry holds a resized file. The keys are of the form `size.width + 'x' + size.height`
 */
const cropAndResize = function(imagePath, selectedArea, sizes, callback) {
  try {
    unless(isNotNull, {
      code: 400,
      msg: 'A path to the image that you want to crop is missing'
    })(imagePath);

    unless(isObject, {
      code: 400,
      msg: 'The coordinates for the area you wish to crop must be specified'
    })(selectedArea);

    const selectedAreaIsDefined = Boolean(selectedArea);
    unless(bothCheck(selectedAreaIsDefined, pipe(toInt, zeroOrGreater)), {
      code: 400,
      msg: 'The x-coordinate needs to be an integer larger than 0'
    })(selectedArea.x);

    unless(bothCheck(selectedAreaIsDefined, pipe(toInt, zeroOrGreater)), {
      code: 400,
      msg: 'The y-coordinate needs to be an integer larger than 0'
    })(selectedArea.y);

    unless(bothCheck(selectedAreaIsDefined, pipe(toInt, oneOrGreater)), {
      code: 400,
      msg: 'The width value must be an integer larger than 0'
    })(selectedArea.width);

    unless(bothCheck(selectedAreaIsDefined, pipe(toInt, oneOrGreater)), {
      code: 400,
      msg: 'The height value must be an integer larger than 1'
    })(selectedArea.height);

    unless(isNotNull, {
      code: 400,
      msg: 'The desired sizes array is missing'
    })(sizes);

    const sizesAreDefined = Boolean(sizes);
    unless(bothCheck(sizesAreDefined, isArrayNotEmpty), {
      code: 400,
      msg: 'The desired sizes array is empty'
    })(sizes);

    for (const element of sizes) {
      unless(bothCheck(sizesAreDefined, pipe(toInt, zeroOrGreater)), {
        code: 400,
        msg: 'The width needs to be a valid integer larger than 0'
      })(element.width);

      unless(bothCheck(sizesAreDefined, oneOrGreater), {
        code: 400,
        msg: 'The height needs to be a valid integer larger than 0'
      })(element.height);
    }
  } catch (error) {
    return callback(error);
  }

  // Crop the image
  _cropImage(imagePath, selectedArea, (err, croppedFile) => {
    if (err) {
      return callback(err);
    }

    const files = {};
    let resized = 0;
    let called = false;

    // Use a foreach so that the callback function of resizeImage has the size on the stack
    sizes.forEach(size => {
      // Resize the image
      _resizeImage(croppedFile.path, { width: size.width, height: size.height }, (err, file) => {
        resized++;
        if (err && !called) {
          called = true;
          return callback(err);
        }

        const key = size.width + 'x' + size.height;
        files[key] = file;
        if (resized === sizes.length && !called) {
          called = true;

          // Remove the cropped one before we call the callback
          fs.unlink(croppedFile.path, err => {
            if (err) {
              called = true;
              return callback({ code: 500, msg: err });
            }

            return callback(null, files);
          });
        }
      });
    });
  });
};

/**
 * Crops a part out of an image
 *
 * @param  {String}     imagePath               The path on disk of the file that needs to be cropped
 * @param  {Object}     selectedArea            The area that needs to be cropped out
 * @param  {Number}     selectedArea.x          The x coordinate of the topleft corner to start cropping
 * @param  {Number}     selectedArea.y          The y coordinate of the topleft corner to start cropping
 * @param  {Number}     selectedArea.width      The width of the box that needs to be cropped out
 * @param  {Number}     selectedArea.height     The height of the box that needs to be cropped out
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.file           A file object with some metadata of the cropped file
 * @param  {String}     callback.file.path      The path where the file has been written to
 * @param  {String}     callback.file.name      The name of the file
 * @param  {Number}     callback.file.size      The size in bytes of the cropped image
 */
const cropImage = function(imagePath, selectedArea, callback) {
  try {
    unless(isNotNull, {
      code: 400,
      msg: 'A path to the image that you want to crop is missing'
    })(imagePath);

    unless(isObject, {
      code: 400,
      msg: 'The coordinates for the area you wish to crop must be specified'
    })(selectedArea);

    const selectedAreaIsDefined = Boolean(selectedArea);
    unless(bothCheck(selectedAreaIsDefined, zeroOrGreater), {
      code: 400,
      msg: 'The x-coordinate needs to be a valid integer'
    })(selectedArea.x);

    unless(bothCheck(selectedAreaIsDefined, zeroOrGreater), {
      code: 400,
      msg: 'The y-coordinate needs to be a valid integer'
    })(selectedArea.y);

    unless(bothCheck(selectedAreaIsDefined, zeroOrGreater), {
      code: 400,
      msg: 'The width value must be an integer larger than 0'
    })(selectedArea.width);

    unless(bothCheck(selectedAreaIsDefined, oneOrGreater), {
      code: 400,
      msg: 'The height value must be an integer larger than 0'
    })(selectedArea.height);
  } catch (error) {
    return callback(error);
  }

  _cropImage(imagePath, selectedArea, callback);
};

/**
 * Internal method that performs the actual cropping
 *
 * @param  {String}     imagePath               The path on disk of the file that needs to be cropped
 * @param  {Object}     selectedArea            The area that needs to be cropped out
 * @param  {Number}     selectedArea.x          The x coordinate of the topleft corner to start cropping
 * @param  {Number}     selectedArea.y          The y coordinate of the topleft corner to start cropping
 * @param  {Number}     selectedArea.width      The width of the box that needs to be cropped out
 * @param  {Number}     selectedArea.height     The height of the box that needs to be cropped out
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.file           A file object with some metadata of the cropped file
 * @param  {String}     callback.file.path      The path where the file has been written to
 * @param  {String}     callback.file.name      The name of the file
 * @param  {Number}     callback.file.size      The size in bytes of the cropped image
 * @api private
 */
const _cropImage = function(imagePath, selectedArea, callback) {
  // Make sure that the pic is big enough
  gm(imagePath).size((err, size) => {
    if (err) {
      log().error({ err }, 'Could not get the image size for the large image');
      return callback({ code: 500, msg: 'Could not get the image size for the large image' });
    }

    // Ensure we do not try and crop outside of the image size boundaries
    if (
      selectedArea.x > size.width ||
      selectedArea.y > size.height ||
      selectedArea.width > size.width - selectedArea.x ||
      selectedArea.height > size.height - selectedArea.y
    ) {
      return callback({ code: 400, msg: 'You cannot crop outside of the image' });
    }

    // Crop it and write it to a temporary file
    const tempPath = temp.path({ suffix: getImageExtension(imagePath, '.jpg') });
    gm(imagePath)
      .crop(selectedArea.width, selectedArea.height, selectedArea.x, selectedArea.y)
      .noProfile()
      .write(tempPath, err => {
        if (err) {
          fs.unlink(tempPath, () => {
            if (err) {
              log().warn({ err, path: tempPath }, 'Could not unlink a file');
            }
          });
          log().error({ err }, 'Could not crop the image %s', imagePath);
          return callback({ code: 500, msg: 'Could not crop the image' });
        }

        fs.stat(tempPath, (err, stat) => {
          if (err) {
            fs.unlink(tempPath, () => {
              if (err) {
                log().warn({ err, path: tempPath }, 'Could not unlink a file');
              }
            });
            log().error({ err }, 'Could not get the file system information about %s', tempPath);
            return callback({
              code: 500,
              msg: 'Could not retrieve the file information for the cropped file'
            });
          }

          const file = {
            path: tempPath,
            size: stat.size,
            name: path.basename(tempPath)
          };

          return callback(null, file);
        });
      });
  });
};

/**
 * Resizes an image to the specified size
 *
 * @param  {String}     imagePath               The path on disk of the file that needs to be resized
 * @param  {Object}     size                    The new size of the image
 * @param  {Number}     size.width              The width that the image should be resized to
 * @param  {Number}     size.height             The height that the image should be resized to
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.file           A file object with some metadata of the resized file
 * @param  {String}     callback.file.path      The path where the file has been written to
 * @param  {String}     callback.file.name      The name of the file
 * @param  {Number}     callback.file.size      The size in bytes of the resized image
 */
const resizeImage = function(imagePath, size, callback) {
  try {
    unless(isNotNull, {
      code: 400,
      msg: 'A path to the image that you want to resize is missing'
    })(imagePath);

    unless(isObject, {
      code: 400,
      msg: 'The size must be specified'
    })(size);

    const sizeIsDefined = Boolean(size);
    unless(bothCheck(sizeIsDefined, oneOrGreater), {
      code: 400,
      msg: 'The width needs to be a valid integer larger than 0'
    })(size.width);

    unless(bothCheck(sizeIsDefined, oneOrGreater), {
      code: 400,
      msg: 'The height needs to be a valid integer larger than 0'
    })(size.height);
  } catch (error) {
    return callback(error);
  }

  _resizeImage(imagePath, size, callback);
};

/**
 * Internal method that resizes an image to the specified size
 *
 * @param  {String}     imagePath               The path on disk of the file that needs to be resized
 * @param  {Object}     size                    The new size of the image
 * @param  {Number}     size.width              The width that the image should be resized to
 * @param  {Number}     size.height             The height that the image should be resized to
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.file           A file object with some metadata of the resized file
 * @param  {String}     callback.file.path      The path where the file has been written to
 * @param  {String}     callback.file.name      The name of the file
 * @param  {Number}     callback.file.size      The size in bytes of the resized image
 * @api private
 */
const _resizeImage = function(imagePath, size, callback) {
  const suffix = size.width + 'x' + size.height + getImageExtension(imagePath, '.jpg');
  const tempPath = temp.path({ suffix });

  gm(imagePath)
    .resize(size.width, size.height)
    .write(tempPath, err => {
      if (err) {
        fs.unlink(tempPath, () => {
          if (err) {
            log().warn({ err, path: tempPath }, 'Could not unlink a file');
          }
        });
        log().error({ err }, 'Could not resize the image %s', imagePath);
        return callback({ code: 500, msg: 'Could not resize the image' });
      }

      fs.stat(tempPath, (err, stat) => {
        if (err) {
          fs.unlink(tempPath, () => {
            if (err) {
              log().warn({ err, path: tempPath }, 'Could not unlink a file');
            }
          });
          log().error({ err }, 'Could not get the file system information for %s', tempPath);
          return callback({
            code: 500,
            msg: 'Could not get the file information for the resized file'
          });
        }

        const file = {
          path: tempPath,
          size: stat.size,
          name: path.basename(tempPath)
        };

        return callback(null, file);
      });
    });
};

/**
 * Get an image extension given a source filename. If the source extension is not a valid extension,
 * the fallback will be used
 *
 * @param  {String}     source      The input file on which to base the extension. e.g., notAnImage.zip
 * @param  {String}     [fallback]  The fallback extension. Defaults to '.jpg'
 * @return {String}                 A proper image extension. e.g., '.jpg'
 */
const getImageExtension = function(source, fallback) {
  fallback = fallback || '.jpg';
  let ext = path.extname(source);
  if (!_.contains(VALID_EXTENSIONS, ext)) {
    ext = fallback;
  }

  return ext;
};

/**
 * Convert an input file to a JPG. The following conversions will take place:
 *
 *  * All animations will be removed, the resulting image will be the very first frame
 *  * All tranparent pixels will be converted to white pixels
 *
 * @param  {String}     inputPath               The path where the image can be found on disk
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.file           A file object with some metadata of the resized file
 * @param  {String}     callback.file.path      The path where the file has been written to
 * @param  {String}     callback.file.name      The name of the file
 * @param  {Number}     callback.file.size      The size of the resized image (in bytes)
 */
const convertToJPG = function(inputPath, callback) {
  try {
    unless(isNotNull, {
      code: 400,
      msg: 'A path to the image that you want to resize is missing'
    })(inputPath);
  } catch (error) {
    return callback(error);
  }

  let conversionPath = inputPath;
  if (inputPath.lastIndexOf('.gif') === inputPath.length - 4) {
    // If we're dealing with a GIF, we use the first frame
    conversionPath = inputPath + '[0]';
  }

  gm(conversionPath).size((err, size) => {
    if (err) {
      log().error({ err }, 'Unable to get size of the image that should be converted to JPG');
      return callback({ code: 500, msg: err });
    }

    /*!
     * The below command is responsible for generating a somewhat decent looking JPG.
     * We superimpose the original image over a white image of the same size to ensure
     * that formats which can contain transparant pixels look reasonably well in a JPG.
     *
     * gm convert -size 220x276 xc:white -compose over img.png -flatten flattened.jpg
     *
     * There doesn't seem to be a good way to execute the proper command with the `gm` module,
     * so we have to do it manually here.
     */
    const outputPath = temp.path({ suffix: '.jpg' });
    const cmd = util.format(
      'gm convert -size %dx%d xc:white -compose over %s -flatten %s',
      size.width,
      size.height,
      conversionPath,
      outputPath
    );

    const now = Date.now();
    log().trace({ cmd }, 'Begin converting image into a JPG');
    exec(cmd, { timeout: 4000 }, err => {
      const durationMs = Date.now() - now;
      if (err) {
        log().error({ err }, 'Unable to convert input image to JPG (Took %sms)', durationMs);
        return callback({ code: 500, msg: 'Failed converting input image to JPG' });
      }

      log().trace('Finished converting image into a JPG (Took %sms)', durationMs);

      fs.stat(outputPath, (err, stat) => {
        if (err) {
          fs.unlink(outputPath, () => {
            if (err) {
              log().warn({ err, path: outputPath }, 'Could not unlink a file');
            }
          });
          log().error({ err }, 'Could not get the file system information about %s', outputPath);
          return callback({
            code: 500,
            msg: 'Could not retrieve the file information for the converted file'
          });
        }

        const file = {
          path: outputPath,
          size: stat.size,
          name: path.basename(outputPath)
        };
        return callback(null, file);
      });
    });
  });
};

export { autoOrient, cropAndResize, cropImage, resizeImage, getImageExtension, convertToJPG };
