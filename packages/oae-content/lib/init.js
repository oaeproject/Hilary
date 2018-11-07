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

const mkdirp = require('mkdirp');

const Cassandra = require('oae-util/lib/cassandra');
const Cleaner = require('oae-util/lib/cleaner');
const log = require('oae-logger').logger('oae-content');
const TaskQueue = require('oae-util/lib/taskqueue');

const ContentAPI = require('./api');
const { ContentConstants } = require('./constants');
const ContentSearch = require('./search');
const Etherpad = require('./internal/etherpad');
const LocalStorage = require('./backends/local');

module.exports = function(config, callback) {
  // Initialize the content library capabilities
  // eslint-disable-next-line import/no-unassigned-import
  require('./library');

  // Initialize activity capabilities
  // eslint-disable-next-line import/no-unassigned-import
  require('./activity');

  // Ensure that the preview listeners get registered
  // eslint-disable-next-line import/no-unassigned-import
  require('./previews');

  // Initialize invitations listeners
  // eslint-disable-next-line import/no-unassigned-import
  require('./invitations');

  // Initialize the etherpad client.
  Etherpad.refreshConfiguration(config.etherpad);

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
        TaskQueue.bind(
          ContentConstants.queue.ETHERPAD_PUBLISH,
          ContentAPI.handlePublish,
          null,
          err => {
            if (err) {
              return callback(err);
            }

            return ensureSchema(callback);
          }
        );
      });
    });
  });
};

/**
 * Ensure that the all of the content-related schemas are created. If they already exist, this method will not do anything
 *
 * @param  {Function}         callback       Standard callback function
 * @param  {Object}           callback.err   An error that occurred, if any
 * @api private
 */
const ensureSchema = function(callback) {
  Cassandra.createColumnFamilies(
    {
      Content:
        'CREATE TABLE "Content" ("contentId" text PRIMARY KEY, "tenantAlias" text, "visibility" text, "displayName" text, "description" text, "resourceSubType" text, "createdBy" text, "created" text, "lastModified" text, "latestRevisionId" text, "uri" text, "previews" text, "status" text, "largeUri" text, "mediumUri" text, "smallUri" text, "thumbnailUri" text, "wideUri" text, "etherpadGroupId" text, "etherpadPadId" text, "filename" text, "link" text, "mime" text, "size" text)',
      PreviewItems:
        'CREATE TABLE "PreviewItems" ("revisionId" text, "name" text, "value" text, PRIMARY KEY ("revisionId", "name")) WITH COMPACT STORAGE',
      Revisions:
        'CREATE TABLE "Revisions" ("revisionId" text PRIMARY KEY, "contentId" text, "created" text, "createdBy" text, "filename" text, "mime" text, "size" text, "uri" text, "previewsId" text, "previews" text, "status" text, "largeUri" text, "mediumUri" text, "smallUri" text, "thumbnailUri" text, "wideUri" text, "etherpadHtml" text)',
      RevisionByContent:
        'CREATE TABLE "RevisionByContent" ("contentId" text, "created" text, "revisionId" text, PRIMARY KEY ("contentId", "created")) WITH COMPACT STORAGE'
    },
    callback
  );
};
