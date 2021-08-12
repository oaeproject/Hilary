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
import { format } from 'util';

import * as IO from 'oae-util/lib/io.js';
import { logger } from 'oae-logger';
import * as TempFile from 'oae-util/lib/tempfile.js';

import { ContentConstants } from '../constants.js';
import { DownloadStrategy } from '../model.js';
import * as BackendUtil from './util.js';

const log = logger('local-storage');

let _rootDir = null;

/**
 * An implementation that will store files on a local directory.
 * Unless the directory you're writing to is a mounted NFS/Samba share,
 * you probably don't want to use this in production as it would restrict
 * you from scaling your app servers horizontally.
 */

/**
 * Initializes the local storage backend with its root directory.
 *
 * @param  {String}     rootDir         The directory where files can be stored
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const init = function (rootDir, callback) {
  _rootDir = Path.resolve(rootDir);
  _ensureDirectoryExists(_rootDir, (error) => {
    if (error) {
      log().error({ dir: _rootDir, err: error }, 'Could not create/find the local storage directory');
      return callback(error);
    }

    callback();
  });
};

/**
 * Get the root directory where files will be stored.
 *
 * @return {String}     The root directory where files will be stored
 */
const getRootDirectory = function () {
  return _rootDir;
};

/// //////////////////
// Storage methods //
/// //////////////////

/**
 * @borrows Interface.store as Local.store
 */
const store = function (tenantAlias, file, options, callback) {
  options = options || {};

  // Generate the uri for this file
  const uri = BackendUtil.generateUri(file, options);

  // Get the paths on disk where we'll store the file
  const destPath = format('%s/%s', getRootDirectory(), uri);
  const destDir = Path.dirname(destPath);

  // Make sure the directory tree exists by creating them if necessary
  _ensureDirectoryExists(destDir, (error) => {
    if (error) {
      log().error({ err: error }, 'Error ensuring directories exist %s', destDir);
      return callback(error);
    }

    // Move the file
    log().trace('Moving %s to %s', file.path, destPath);
    IO.moveFile(file.path, destPath, (error) => {
      if (error) {
        log().error({ err: error }, 'Error moving %s to %s', file.path, destPath);
        return callback(error);
      }

      return callback(null, 'local:' + uri);
    });
  });
};

/**
 * @borrows Interface.get as Local.get
 */
const get = function (tenantAlias, uri, callback) {
  // Construct the path where the file is stored
  const path = format('%s/%s', getRootDirectory(), BackendUtil.splitUri(uri).location);

  // Copy it to a temp folder
  const filename = Path.basename(path);
  const temporary = TempFile.createTempFile({ suffix: filename });
  IO.copyFile(path, temporary.path, (error) => {
    if (error) {
      log().error({ err: error }, 'Error getting %s', path);
      return callback(error);
    }

    // Get the file size and pass it on
    temporary.update(callback);
  });
};

/**
 * @borrows Interface.remove as Local.remove
 */
const remove = function (tenantAlias, uri, callback) {
  // Construct the path where the file is stored
  const path = format('%s/%s', getRootDirectory(), BackendUtil.splitUri(uri).location);

  // Unlink it
  fs.unlink(path, (error) => {
    // If no file existed at the given path, we do not pass back an error
    // as the intent was to remove a file at that path
    if (error && error.code === 'ENOENT') {
      log().warn({ uri, path }, 'Tried to remove a file that was no longer there');
      return callback();

      // Otherwise we pass back an error
    }

    if (error) {
      log().error({ err: error }, 'Error removing %s', path);
      return callback({ code: 500, msg: 'Unable to remove the file: ' + error });
    }

    return callback();
  });
};

/**
 * @borrows Interface.getDownloadStrategy as Local.getDownloadStrategy
 */
const getDownloadStrategy = function (tenantAlias, uri) {
  return new DownloadStrategy(
    ContentConstants.backend.DOWNLOAD_STRATEGY_INTERNAL,
    '/files/' + BackendUtil.splitUri(uri).location
  );
};

/// //////////////////
// Private methods //
/// //////////////////

/**
 * Creates the directory structure and applies the correct file mode.
 *
 * @param  {String}   dir            The absolute path to the directory that needs to exist
 * @param  {Function} callback       Standard callback function
 * @param  {Object}   callback.err   An error that occurred, if any
 * @param  {Object}   callback.path  The path of the folder just created
 * @api private
 */
const _ensureDirectoryExists = function (dir, callback) {
  try {
    fs.mkdir(dir, { recursive: true }, (error) => {
      if (error) return callback({ code: 500, msg: 'Unable to create directory recursively' });
      // if (err) throw { code: 500, error: 'Unable to create directory recursively' };
      return callback(null, dir);
    });
  } catch {
    return callback({ code: 500, msg: 'Unable to create directory recursively' });
  }
};

export { init, getRootDirectory, store, get, remove, getDownloadStrategy };
