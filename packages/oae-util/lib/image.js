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
import Path from 'path';
const { basename, extname } = Path;
import sharp from 'sharp';

import temp from 'temp';
import { concat, contains, equals, defaultTo, compose, not, pipe, isEmpty, when } from 'ramda';

import { logger } from 'oae-logger';

import { Validator as validator } from 'oae-util/lib/validator';
const {
  unless,
  validateInCase: bothCheck,
  isObject,
  isZeroOrGreater,
  isOneOrGreater,
  isNotNull,
  toInt,
  isArrayNotEmpty
} = validator;

const log = logger('oae-util-image');
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif'];

const isDefined = Boolean;
const isNotDefined = compose(not, isDefined);

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
const autoOrient = function (inputPath, options, callback) {
  options = defaultTo({}, options);
  const outputPath = defaultTo(temp.path({ suffix: getImageExtension(inputPath, '.jpg') }), options.outputPath);
  sharp(inputPath)
    .rotate()
    .toFile(outputPath, (error, info) => {
      if (error) {
        log().error({ err: error }, 'Could not auto orient the image %s', inputPath);
        return callback({ code: 500, msg: 'Could not auto orient the image' });
      }

      const file = {
        path: outputPath,
        size: info.size,
        name: basename(outputPath)
      };

      // Return without deleting the file if the caller specified to do so
      if (isNotDefined(options.removeInput)) return callback(null, file);

      // Delete the input file now that we've completed
      fs.unlink(inputPath, (error) => {
        if (error) {
          log().error({ err: error }, 'Could not unlink the input image');
          return callback({ code: 500, msg: 'Could not unlink the input image' });
        }

        return callback(null, file);
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
const cropAndResize = function (imagePath, selectedArea, sizes, callback) {
  try {
    unless(isNotNull, {
      code: 400,
      msg: 'A path to the image that you want to crop is missing'
    })(imagePath);

    unless(isObject, {
      code: 400,
      msg: 'The coordinates for the area you wish to crop must be specified'
    })(selectedArea);

    const selectedAreaIsDefined = isDefined(selectedArea);
    unless(bothCheck(selectedAreaIsDefined, pipe(toInt, isZeroOrGreater)), {
      code: 400,
      msg: 'The x-coordinate needs to be an integer larger than 0'
    })(selectedArea.x);

    unless(bothCheck(selectedAreaIsDefined, pipe(toInt, isZeroOrGreater)), {
      code: 400,
      msg: 'The y-coordinate needs to be an integer larger than 0'
    })(selectedArea.y);

    unless(bothCheck(selectedAreaIsDefined, pipe(toInt, isOneOrGreater)), {
      code: 400,
      msg: 'The width value must be an integer larger than 0'
    })(selectedArea.width);

    unless(bothCheck(selectedAreaIsDefined, pipe(toInt, isOneOrGreater)), {
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
      unless(bothCheck(sizesAreDefined, pipe(toInt, isZeroOrGreater)), {
        code: 400,
        msg: 'The width needs to be a valid integer larger than 0'
      })(element.width);

      unless(bothCheck(sizesAreDefined, isOneOrGreater), {
        code: 400,
        msg: 'The height needs to be a valid integer larger than 0'
      })(element.height);
    }
  } catch (error) {
    return callback(error);
  }

  _cropImage(imagePath, selectedArea, (error, croppedFile) => {
    if (error) return callback(error);

    const allSizes = {};
    const resizeForAllSizes = (sizes, croppedFile, allSizes, callback) => {
      if (isEmpty(sizes)) return callback(null, allSizes);

      const nextSize = sizes.pop();
      const key = `${nextSize.width}x${nextSize.height}`;
      resizeFor(nextSize, croppedFile, (error, resizedFile) => {
        if (error) return callback(error);

        allSizes[key] = resizedFile;
        return resizeForAllSizes(sizes, croppedFile, allSizes, callback);
      });
    };

    const resizeFor = (size, croppedFile, callback) => {
      const { width, height } = size;
      _resizeImage(croppedFile.path, { width, height }, (error, file) => {
        if (error) return callback(error);

        return callback(null, file);
      });
    };

    resizeForAllSizes(sizes, croppedFile, allSizes, () => {
      fs.unlink(croppedFile.path, (error_) => {
        if (error_) return callback({ code: 500, msg: error_ });

        return callback(null, allSizes);
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
const cropImage = function (imagePath, selectedArea, callback) {
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
    unless(bothCheck(selectedAreaIsDefined, isZeroOrGreater), {
      code: 400,
      msg: 'The x-coordinate needs to be a valid integer'
    })(selectedArea.x);

    unless(bothCheck(selectedAreaIsDefined, isZeroOrGreater), {
      code: 400,
      msg: 'The y-coordinate needs to be a valid integer'
    })(selectedArea.y);

    unless(bothCheck(selectedAreaIsDefined, isZeroOrGreater), {
      code: 400,
      msg: 'The width value must be an integer larger than 0'
    })(selectedArea.width);

    unless(bothCheck(selectedAreaIsDefined, isOneOrGreater), {
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
const _cropImage = function (imagePath, selectedArea, callback) {
  const temporaryPath = temp.path({ suffix: getImageExtension(imagePath, '.jpg') });
  const { width, height, x: left, y: top } = selectedArea;

  sharp(imagePath)
    .extract({ width, height, left, top })
    .toFile(temporaryPath, (error, info) => {
      if (error) {
        log().error({ err: error }, error.message);
        return callback({ code: 500, msg: error.message });
      }

      const file = {
        path: temporaryPath,
        size: info.size,
        name: basename(temporaryPath)
      };

      return callback(null, file);
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
const resizeImage = function (imagePath, size, callback) {
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
    unless(bothCheck(sizeIsDefined, isOneOrGreater), {
      code: 400,
      msg: 'The width needs to be a valid integer larger than 0'
    })(size.width);

    unless(bothCheck(sizeIsDefined, isOneOrGreater), {
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
const _resizeImage = function (imagePath, size, callback) {
  const { width, height } = size;
  const temporaryPath = temp.path({ suffix: `${width}x${height}${getImageExtension(imagePath, '.jpg')}` });

  sharp(imagePath)
    .resize(size.width, size.height)
    .toFile(temporaryPath, (error, info) => {
      if (error) {
        log().error({ err: error }, 'Could not resize the image %s', imagePath);
        return callback({ code: 500, msg: 'Could not resize the image' });
      }

      const file = {
        path: temporaryPath,
        size: info.size,
        name: basename(temporaryPath)
      };

      return callback(null, file);
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
const getImageExtension = function (sourceFile, fallback) {
  fallback = defaultTo('.jpg', fallback);
  let extension = extname(sourceFile);

  const isValidExtension = contains(VALID_EXTENSIONS);

  if (compose(not, isValidExtension)(extension)) extension = fallback;

  return extension;
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
const convertToJPG = function (inputPath, callback) {
  try {
    unless(isNotNull, {
      code: 400,
      msg: 'A path to the image that you want to resize is missing'
    })(inputPath);
  } catch (error) {
    return callback(error);
  }

  const itsAGif = compose(equals('.gif'), extname);
  const conversionPath = when(itsAGif, (filePath) => concat(filePath, '[0]'), inputPath);

  const now = Date.now();
  const outputPath = temp.path({ suffix: '.jpg' });

  log().trace('Begin converting image into a JPG');
  sharp(conversionPath)
    .flatten({ background: 'white' })
    .jpeg()
    .toFile(outputPath, (error, info) => {
      const durationMs = Date.now() - now;
      if (error) {
        log().error({ err: error }, 'Unable to convert input image to JPG (Took %sms)', durationMs);
        return callback({ code: 500, msg: 'Failed converting input image to JPG' });
      }

      log().trace('Finished converting image into a JPG (Took %sms)', durationMs);

      const file = {
        path: outputPath,
        size: info.size,
        name: basename(outputPath)
      };
      return callback(null, file);
    });
};

export { autoOrient, cropAndResize, cropImage, resizeImage, getImageExtension, convertToJPG };
