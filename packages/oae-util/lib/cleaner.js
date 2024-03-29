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
import path from 'node:path';
import _ from 'underscore';

import * as EmitterAPI from 'oae-emitter';
import { logger } from 'oae-logger';
import { compose, not, isNil, ifElse } from 'ramda';

const log = logger('oae-cleaner');

const cleaners = {};

/**
 * ## Events
 *
 * * `cleaned(directory)` - A clean cycle just finished on a directory. The `directory` is provided as an event parameter.
 */
const Cleaner = new EmitterAPI.EventEmitter();
export { Cleaner as emitter };

/**
 * Starts a cleaning job.
 *
 * @param  {String}     directory   The path to the directory that should be cleaned.
 * @param  {Number}     interval    The interval (in seconds) at which the directory should be cleaned out.
 */
const start = (directory, interval) => {
  // Take care of double slashes
  directory = path.normalize(directory);
  log().info({ interval, directory }, 'Starting clean job.');

  // Start it once and than start the interval
  cleanDirectory(interval, directory);
  cleaners[directory] = setInterval(cleanDirectory, interval, interval, directory);
};

/**
 * Stops a cleaning job.
 *
 * @param  {String}     directory   The path to the directory for which the cleaning job should be stopped.
 */
const stop = (directory) => {
  const isValid = compose(not, isNil);
  ifElse(
    isValid,
    () => {
      log().info({ directory }, 'Stopping clean job.');
      clearInterval(cleaners[directory]);
    },
    () => {
      log().warn({ directory }, 'A request to stop an unknown cleaning job was made.');
    }
  )(cleaners[directory]);
};

/**
 * Cleans a directory.
 *
 * @param  {Number} interval    Files who haven't been accessed in this number of seconds will be removed.
 * @param  {String} directory   The path to the directory that should be cleaned.
 * @api private
 */
const cleanDirectory = function (interval, directory) {
  fs.readdir(directory, (error, files) => {
    if (error) {
      return log().error({ err: error, directory }, 'Could not list the files.');
    }

    const paths = _.map(files, (file) => directory + '/' + file);

    const time = Date.now() - interval * 1000;
    checkFiles(paths, time, () => {
      Cleaner.emit('cleaned', directory);
    });
  });
};

/**
 * Checks if a file is older than a specified time and removes it if it is.
 *
 * @param  {String}     path            The path to the file to check
 * @param  {String}     time            The time (in ms since epoch) when a file is considered outdated.
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const checkFile = function (path, time, callback) {
  fs.stat(path, (error, stats) => {
    // We can ignore "no such file"-errors as this function intends to remove the file anyway.
    // These errors can ocurr when another method cleans up after themselves right between the cleaner doing a `fs.readdir` and `fs.stat`.
    if (error && error.code === 'ENOENT') {
      // There is nothing further to do if the file has been removed
      return callback();

      // If we get an error that is not a "no such file"-error, something is probably wrong
    }

    if (error) {
      log().error({ err: error, path }, 'Could not get the metadata for a file.');
      return callback(error);
    }

    // Only try to unlink file resources that have expired
    if (stats && stats.isFile() && stats.atime.getTime() < time) {
      log().info({ path, lastModified: stats.atime.getTime(), expires: time }, 'Deleting expired temporary file.');
      fs.unlink(path, (error_) => {
        // Only report the error if it's not a "no such file"-error
        if (error_ && error_.code !== 'ENOENT') {
          log().error({ err: error_, path }, 'Could not delete an expired temporary file.');
          return callback(error_);
        }

        callback();
      });
    } else {
      callback();
    }
  });
};

/**
 * Checks a set of files if they are older than a specified time and removes them if they are.
 *
 * @param   {String[]}   paths           The set of paths to check.
 * @param   {String}     time            The time (in ms since epoch) when a file is considered outdated.
 * @param   {Function}   [callback]      Invoked when all files in the `paths` array have been addressed
 * @returns {Function}                   Returns a callback depending on logic
 * @api private
 */
const checkFiles = function (paths, time, callback) {
  if (_.isEmpty(paths)) {
    return callback();
  }

  const path = paths.pop();
  checkFile(path, time, () => {
    /*
     * We don't abort the whole process because a file fails to be checked.
     * Error messages will have been logged in the `checkFile` method, there is no need to
     * log them here again.
     */
    checkFiles(paths, time, callback);
  });
};

export { start, stop };
