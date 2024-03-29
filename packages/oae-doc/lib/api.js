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

import { stat as doesFileExist, readFile } from 'node:fs';
import _ from 'underscore';
import dox from 'dox';

import { getFileListForFolder } from 'oae-util/lib/io.js';
import * as modules from 'oae-util/lib/modules.js';
import * as OaeUtil from 'oae-util/lib/util.js';
import { Validator as validator } from 'oae-util/lib/validator.js';
import isIn from 'validator/lib/isIn.js';

import { logger } from 'oae-logger';

const { unless, isNotEmpty } = validator;

const log = logger('oae-doc');

// Variable that will be used to cache the back-end and front-end documentation
const cachedDocs = {
  backend: {},
  frontend: {}
};

/**
 * Initialize the docs by fetching all the back-end modules and front-end APIs, parsing
 * their documentation and caching it.
 *
 * @param  {Object}     uiConfig         JSON object containing UI configuration values, like the path to the UI directory
 * @param  {Function}   callback         Standard callback function
 */
const initializeDocs = function (uiConfig, callback) {
  // Initialize the front-end documentation
  _initializeFrontendDocs(uiConfig, (error) => {
    if (error) {
      return callback(error);
    }

    // Initialize the back-end documentation
    _initializeBackendDocs(modules.getAvailableModules(), callback);
  });
};

/**
 * Initialize the front-end docs by fetching the list of available API files, parsing
 * their documentation and caching it.
 *
 * @param  {Object}     uiConfig         JSON object containing UI configuration values, like the path to the UI directory
 * @param  {Function}   callback         Standard callback function
 * @param  {Object}     callback.err     An error that occurred, if any
 * @api private
 */
const _initializeFrontendDocs = function (uiConfig, callback) {
  let baseDir = uiConfig.path;
  // When we are running with an optimized UI build, we cannot use these files for documentation parsing as all of the
  // JSDocs will be stripped out of these files. However, in that case an `original` folder should exist as a sibling
  // from the base UI directory. This folder will contain the original source code files, which is what we want to use
  // for generating documentation. If the `original` folder does not exist, we assume that we are not running on an
  // optimized build and use the source files in the provided base UI directory.
  const originalDir = baseDir + '/../original';
  doesFileExist(originalDir, (error, exists) => {
    baseDir = exists ? originalDir : baseDir;

    // Only parse the API files. We don't parse any other UI files yet.
    const dir = baseDir + '/shared/oae/api';
    const exclude = ['oae.api.js', 'oae.bootstrap.js', 'oae.core.js'];

    _parseDocs(dir, exclude, (error, docs) => {
      if (error) {
        return callback(error);
      }

      cachedDocs.frontend = docs;
      callback();
    });
  });
};

/**
 * Internal method to recursively parse all the given backend docs. All jsdocs inside `/lib` will be parsed and
 * cached in the `cachedDocs` hash. When this method completes, the `modules` array will have all elements
 * removed as part of the recursion.
 *
 * @param  {String[]}   modules         The modules whose docs to parse
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _initializeBackendDocs = function (backendModules, callback) {
  if (_.isEmpty(backendModules)) {
    return callback();
  }

  // Shift off a module to parse its docs
  const module = backendModules.shift();
  const dir = OaeUtil.getNodeModulesDir() + module + '/lib';
  _parseDocs(dir, null, (error, docs) => {
    if (error) {
      return callback(error);
    }

    // Cache the doc info in memory and recurse
    cachedDocs.backend[module] = docs;
    return _initializeBackendDocs(backendModules, callback);
  });
};

/**
 * Parse the JSDocs of all of the JavaScript files in a directory into a JSON object,
 * using Dox (https://github.com/visionmedia/dox).
 *
 * @param  {String}     dir             The path to the directory in which we want to parse the JSDocs
 * @param  {String[]}   [exclude]       List of filenames that should be excluded from parsing
 * @param  {Function}   [callback]      Standard callback function
 * @param  {Object}     [callback.err]  Error object containing error code and error message
 * @param  {Object}     [callback.docs] JSON Object where the keys are the file names and the values are the parsed JSDocs
 * @api private
 */
const _parseDocs = function (dir, exclude, callback) {
  // Get all of the files in the provided base directory
  getFileListForFolder(dir, (error, fileNames) => {
    if (error) {
      log().warn({ err: error, dir }, 'Failed getting file list to parse dox documentation.');
      return callback({ code: 404, msg: 'No documentation for this module was found' });
    }

    // Filter out all non-javascript and excluded files
    fileNames = _filterFiles(fileNames, exclude);

    let done = 0;
    const doc = {};

    _.each(fileNames, (fileName) => {
      (function (fileName) {
        // Read each of the files in the provided directory
        readFile(dir + '/' + fileName, 'utf8', (error, data) => {
          done++;
          if (error) {
            log().error({ err: error }, 'Failed reading ' + dir + '/' + fileName);
          } else {
            // Parse the JSDocs using Dox
            try {
              doc[fileName] = dox.parseComments(data);
            } catch (error) {
              log().warn(
                {
                  err: error,
                  data
                },
                'Failed parsing comment data with dox for file %s. Ignoring.',
                dir + '/' + fileName
              );
            }
          }

          if (done === fileNames.length) {
            return callback(error, doc);
          }
        });
      })(fileName);
    });

    if (_.isEmpty(fileNames)) {
      callback();
    }
  });
};

/**
 * Utility function that filters out all non-javascript files, folders and all excluded files,
 * as we don't want to  generate documentation for these.
 *
 * @param  {String[]}   fileNames           The unfiltered array of filenames that needs to be filtered
 * @param  {String[]}   [exclude]           Array of filenames that should be filtered out
 * @return {String[]}                       The returned filtered array of filenames
 * @api private
 */
const _filterFiles = function (fileNames, exclude) {
  return _.filter(fileNames, (fileName) => {
    if (fileName.includes('.js') && _.indexOf(exclude, fileName) === -1) {
      return true;
    }

    return false;
  });
};

/**
 * Retrieve the list of available modules
 *
 * @param  {String}     type                The type of modules to list. Accepted values are `backend` and `frontend`
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String[]}   callback.modules    The list of available modules for the provided type
 */
const getModules = function (type, callback) {
  if (!cachedDocs[type]) {
    return callback({
      code: 400,
      msg: 'Invalid module type. Accepted values are "backend" and "frontend"'
    });
  }

  callback(null, _.keys(cachedDocs[type]));
};

/**
 * Retrieve the documentation for a particular module
 *
 * @param  {String}     moduleId        The module to get the documentation for
 * @param  {String}     type            The type of the module to get the documentation for. Accepted values are `backend` and `frontend`
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Object}     callback.doc    The parsed Dox documentation for the requested module
 */
const getModuleDocumentation = function (moduleId, type, callback) {
  try {
    unless(isNotEmpty, {
      code: 400,
      msg: 'Missing module id'
    })(moduleId);

    unless(isNotEmpty, {
      code: 400,
      msg: 'Missing module type'
    })(type);

    unless(isIn, {
      code: 400,
      msg: 'Invalid module type. Accepted values are "backend" and "frontend"'
    })(type, ['backend', 'frontend']);
  } catch (error) {
    return callback(error);
  }

  // Return the parsed docs from cache
  if (cachedDocs[type] && cachedDocs[type][moduleId]) {
    return callback(null, cachedDocs[type][moduleId]);
  }

  return callback({ code: 404, msg: 'No documentation for this module was found' });
};

export { getModules, initializeDocs, getModuleDocumentation };
