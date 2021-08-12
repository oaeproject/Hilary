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

import * as Cleaner from 'oae-util/lib/cleaner.js';
import { logger } from 'oae-logger';
import * as MQ from 'oae-util/lib/mq.js';

import * as Etherpad from './internal/etherpad.js';
import * as Ethercalc from './internal/ethercalc.js';
import * as LocalStorage from './backends/local.js';
import * as ContentAPI from './api.js';
import { ContentConstants } from './constants.js';
import * as ContentSearch from './search.js';

import * as library from './library.js';
import * as activity from './activity.js';
import * as previews from './previews.js';
import * as invitations from './invitations.js';

const log = logger('oae-content');

export function init(config, callback) {
  // Initialize the etherpad client.
  Etherpad.refreshConfiguration(config.etherpad);

  // Initialize the ethercalc client
  Ethercalc.refreshConfiguration(config.ethercalc);

  ContentSearch.init((error) => {
    if (error) {
      return callback(error);
    }

    // Create the directory where files will be stored.
    fs.mkdir(config.files.uploadDir, { recursive: true }, (error) => {
      if (error && error.code !== 'EEXIST') {
        log().error({ err: error }, 'Could not create the directory where uploaded files can be stored.');
        return callback(error);
      }

      if (config.files.cleaner.enabled) {
        // Start a timed process that checks the uploaded dir and remove files
        // which should not be there.
        Cleaner.start(config.files.uploadDir, config.files.cleaner.interval);
      }

      LocalStorage.init(config.files.localStorageDirectory, (error) => {
        if (error) {
          return callback(error);
        }

        /**
         * Handle "publish" messages that are sent from Etherpad
         * via Redis. These messages indicate that a user made
         * edits and has closed the document
         */
        MQ.subscribe(ContentConstants.queue.ETHERPAD_PUBLISH, ContentAPI.handlePublish, (error) => {
          if (error) {
            return callback(error);
          }

          // Same for Ethercalc - no ack because ack breaks Ethercalc
          MQ.subscribe(ContentConstants.queue.ETHERCALC_EDIT, Ethercalc.setEditedBy, (error) => {
            if (error) return callback(error);

            MQ.subscribe(ContentConstants.queue.ETHERCALC_PUBLISH, ContentAPI.ethercalcPublish, (error) => {
              if (error) return callback(error);

              return callback();
            });
          });
        });
      });
    });
  });
}
