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

import util from 'util';
import _ from 'underscore';

const libraryIndexes = {};

/**
 * Register a library index with the registry
 * @see Library#Index#registerLibraryIndex
 */
const registerLibraryIndex = function (name, options) {
  options = options || {};

  if (libraryIndexes[name]) {
    throw new Error(util.format('Attempted to register duplicate library index with name "%s"', name));
  } else if (!_.isFunction(options.pageResources)) {
    throw new TypeError(
      util.format('Attempted to register library index "%s" that has no "pageResources" function', name)
    );
  }

  libraryIndexes[name] = options;
};

/**
 * Get a registered library index by name
 *
 * @param  {String}     name        The name of the library index to get
 * @return {Object}                 The library index options object that was registered with this library index
 */
const getRegisteredLibraryIndex = function (name) {
  return libraryIndexes[name];
};

export { registerLibraryIndex, getRegisteredLibraryIndex };
