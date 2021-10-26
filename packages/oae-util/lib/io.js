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

import fs from 'node:fs';

import { logger } from 'oae-logger';

const log = logger('IO');

/**
 * Get a list of all of the files and folders inside of a folder. Hidden files and folder (starting with
 * '.', like .DS_STORE) will be excluded from the returned list.
 *
 * @param  {String}      foldername         Path of the folder for which we should get the containing files and folders
 * @param  {Function}    callback           Standard callback function
 * @param  {Object}      callback.err       An error that occurred, if any
 * @param  {String[]}    callback.files     Array containing all of the file and foldernames that exist inside of the given folder
 */
const getFileListForFolder = function (foldername, callback) {
  fs.stat(foldername, (error, stat) => {
    if (error) {
      return callback(null, []);
    }

    if (!stat.isDirectory()) {
      return callback(null, []);
    }

    fs.readdir(foldername, (error, files) => {
      if (error) {
        return callback(error);
      }

      const finalFiles = [];
      for (const element of files) {
        if (element.slice(0, 1) !== '.') {
          finalFiles.push(element);
        }
      }

      callback(null, finalFiles);
    });
  });
};

/**
 * Copy a file
 *
 * @param  {String}   source        Path to the source file that needs to be copied
 * @param  {String}   dest          Path to the destination to which the file needs to be coppied
 * @param  {Function} callback      Standard callback function
 * @param  {Object}   callback.err  An error that occurred, if any
 */
const copyFile = function (source, dest, callback) {
  const ins = fs.createReadStream(source);
  const outs = fs.createWriteStream(dest);
  // Clean up if there's an error reading the source file
  ins.once('error', (error) => {
    destroyStream(outs);
    log().error({ err: error }, "Wasn't able to copy the file %s to %s.", source, dest);
    callback({ code: 500, msg: error });
  });
  // Clean up if there's an error writing the destination file
  outs.once('error', (error) => {
    ins.removeAllListeners('error');
    outs.removeAllListeners('close');
    ins.destroy();
    log().error({ err: error }, "Wasn't able to copy the file %s to %s.", source, dest);
    callback({ code: 500, msg: error });
  });
  outs.once('close', () => {
    callback(null);
  });
  ins.pipe(outs);
};

/**
 * Move a file. This will try to rename it first. In case this has to go across partitions, this will
 * fall back to copy and delete
 *
 * @param  {String}   source        Path to the source file that needs to be moved
 * @param  {String}   dest          Path to the destination to which the file needs to be moved
 * @param  {Function} callback      Standard callback function
 * @param  {Object}   callback.err  An error that occurred, if any
 */
const moveFile = function (source, dest, callback) {
  fs.rename(source, dest, (error) => {
    if (error) {
      // The `EXDEV` error will be thrown when a file is being moved across partitions
      // In that case, we copy and delete the file instead of moving it
      if (error.code !== 'EXDEV') {
        log().error({ err: error }, "Wasn't able to rename the file  %s to %s.", source, dest);
        return callback({ code: 500, msg: error });
      }

      copyFile(source, dest, (error) => {
        if (error) {
          return callback({ code: 500, msg: error });
        }

        fs.unlink(source, callback);
      });
    } else {
      callback(null);
    }
  });
};

/**
 * Destroy a stream and remove all the listeners.
 *
 * @param  {Stream}  stream  The stream to destroy
 */
const destroyStream = function (stream) {
  stream.removeAllListeners('error');
  stream.removeAllListeners('close');
  stream.destroy();
};

/**
 * Test whether or not the given path exists by checking with the file system.
 *
 * This mimics the now deprecated `fs.exists()` function without suffering from
 * the same race condition.
 *
 * @param  {String}     path                The path to test
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.exists     Whether the path points to an existing file or directory
 */
const exists = function (path, callback) {
  fs.open(path, 'r', (error) => {
    if (error) {
      if (error.code === 'ENOENT') {
        return callback(null, false);
      }

      log().error(
        {
          err: error,
          path
        },
        'Unable to check whether a file or folder exists'
      );
      return callback({ code: 500, msg: 'Could not check whether a file or folder exists' });
    }

    return callback(null, true);
  });
};

export { getFileListForFolder, copyFile, moveFile, destroyStream, exists };
