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

/*!
 * This backend is essentially the same as the Local Storage Backend.
 * The only difference is that it will respond with a 200 and the path to the file
 * when asked for a download link.
 * This is so files can be downloaded directly from the app server.
 *
 * This should only be used during unit tests and *NEVER* in production.
 */

import { DownloadStrategy } from '../model';
import * as BackendUtil from './util';
import * as LocalStorage from './local';

/**
 * @borrows Interface.store as TestStorageBackend.store
 */
const store = function(tenantAlias, file, options, callback) {
  LocalStorage.store(tenantAlias, file, options, (err, uri) => {
    if (err) {
      return callback(err);
    }

    uri = uri.replace('local:', 'test:');
    return callback(null, uri);
  });
};

/**
 * @borrows Interface.get as TestStorageBackend.get
 */
const get = function(tenantAlias, uri, callback) {
  LocalStorage.get(tenantAlias, uri, callback);
};

/**
 * @borrows Interface.remove as TestStorageBackend.remove
 */
const remove = function(tenantAlias, uri, callback) {
  LocalStorage.remove(tenantAlias, uri, callback);
};

/**
 * @borrows Interface.getDownloadStrategy as TestStorageBackend.getDownloadStrategy
 */
const getDownloadStrategy = function(tenantAlias, uri) {
  const file = LocalStorage.getRootDirectory() + '/' + BackendUtil.splitUri(uri).location;
  return new DownloadStrategy('test', file);
};

export { store, get, remove, getDownloadStrategy };
