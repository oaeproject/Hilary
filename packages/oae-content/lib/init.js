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

import mkdirp from 'mkdirp';

import * as Cleaner from 'oae-util/lib/cleaner';
import { logger } from 'oae-logger';
import * as TaskQueue from 'oae-util/lib/taskqueue';

import * as Etherpad from './internal/etherpad';
import * as Ethercalc from './internal/ethercalc';
import * as LocalStorage from './backends/local';
import * as ContentAPI from './api';
import { ContentConstants } from './constants';
import * as ContentSearch from './search';

// Initialize the content library capabilities
// eslint-disable-next-line no-unused-vars
import * as library from './library';

// Initialize activity capabilities
// eslint-disable-next-line no-unused-vars
import * as activity from './activity';

// Ensure that the preview listeners get registered
// eslint-disable-next-line no-unused-vars
import * as previews from './previews';

// Initialize invitations listeners
// eslint-disable-next-line no-unused-vars
import * as invitations from './invitations';

const log = logger('oae-content');

export function init(config, callback) {
  // Initialize the etherpad client.
  Etherpad.refreshConfiguration(config.etherpad);

  // Initialize the ethercalc client
  Ethercalc.refreshConfiguration(config.ethercalc);

  ContentSearch.init(err => {
    if (err) {
      return callback(err);
    }

    // Create the directory where files will be stored.
    mkdirp(config.files.uploadDir, err => {
      if (err && err.code !== 'EEXIST') {
        log().error({ err }, 'Could not create the directory where uploaded files can be stored.');
        return callback(err);
      }

      if (config.files.cleaner.enabled) {
        // Start a timed process that checks the uploaded dir and remove files
        // which should not be there.
        Cleaner.start(config.files.uploadDir, config.files.cleaner.interval);
      }

      LocalStorage.init(config.files.localStorageDirectory, err => {
        if (err) {
          return callback(err);
        }

        // Handle "publish" messages that are sent from Etherpad via RabbitMQ. These messages
        // indicate that a user made edits and has closed the document
        TaskQueue.bind(ContentConstants.queue.ETHERPAD_PUBLISH, ContentAPI.handlePublish, null, err => {
          if (err) {
            return callback(err);
          }

          // Same for Ethercalc - no ack because ack breaks Ethercalc
          TaskQueue.bind(
            ContentConstants.queue.ETHERCALC_EDIT,
            Ethercalc.setEditedBy,
            { subscribe: { ack: false } },
            function(err) {
              if (err) {
                return callback(err);
              }

              TaskQueue.bind(
                ContentConstants.queue.ETHERCALC_PUBLISH,
                ContentAPI.ethercalcPublish,
                { subscribe: { ack: false } },
                function(err) {
                  if (err) {
                    return callback(err);
                  }

                  return callback();
                }
              );
            }
          );
        });
      });
    });
  });
}
