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

import process from 'node:process';
import { realpathSync } from 'node:fs';
import { callbackify } from 'node:util';
import { logger } from 'oae-logger';
import * as UIAPI from './api.js';

const log = logger('oae-ui-init');

export const init = function (config, callback) {
  const uiDirectory = realpathSync(config.ui.path);
  // The hashes.json file can be found in the root folder of the optimized build folder
  const hashesPath = uiDirectory + '/hashes.json';

  // let hashes = null;
  // hashes = require(hashesPath);
  callbackify(_importHashes)(hashesPath, (error, hashes) => {
    if (error) {
      hashes = null;
      if (process.env.NODE_ENV === 'production') {
        // Only care about warning for this in production
        log().warn({ err: error }, 'No valid hashes file could be found. Ignoring.');
      } else {
        log().trace({ err: error }, 'No valid hashes file could be found. Ignoring.');
      }
    }

    log().trace({ hashes }, 'Initializing with hash mappings');
    UIAPI.init(uiDirectory, hashes, callback);
  });
};

const _importHashes = (path) =>
  import(path)
    .then((hashes) => hashes)
    .catch((error) => {
      // TODO log here
      throw error;
    });
