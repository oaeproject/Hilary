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

import * as Cleaner from 'oae-util/lib/cleaner.js';
import * as PreviewAPI from './api.js';
// eslint-disable-next-line no-unused-vars
import * as activity from './activity.js';

const log = logger('oae-preview-processor');

/**
 * Starts listening for new pieces of content that should be handled.
 */
export function init(config, callback) {
  // Create the previews directory and periodically clean it.
  fs.mkdir(config.previews.tmpDir, { recursive: true }, (error) => {
    if (error) {
      log().error({ err: error }, 'Could not create the previews directory');
      return callback({ code: 500, msg: 'Could not create the previews directory' });
    }

    // Periodically clean that directory.
    Cleaner.start(config.previews.tmpDir, config.files.cleaner.interval);

    PreviewAPI.refreshPreviewConfiguration(config, callback);
  });
}
