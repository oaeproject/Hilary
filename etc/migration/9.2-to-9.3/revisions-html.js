#!/usr/bin/env node

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

const util = require('util');
const _ = require('underscore');
const cheerio = require('cheerio');

const Cassandra = require('oae-util/lib/cassandra');
const log = require('oae-logger').logger('revisions-migrator');
const OAE = require('oae-util/lib/oae');
const PreviewProcesserAPI = require('oae-preview-processor');

// The application configuration
const { config } = require('../../../config');

// Keep track of when we started the migration process so we can output how
// long the migration took
const start = Date.now();

// Keep track of the total number of revisions we'll be migrating
let total = null;

// Ensure that this application server does NOT start processing any preview images
config.previews.enabled = false;

/**
 * Ensure that the `etherpadHtml` of each collabdoc revision is wrapped in the
 * proper HTML and body tags. Revisions that are not wrapped will be updated
 * and queued for preview processing
 *
 * @param  {Row[]}      rows        An array of cassandra rows to update
 * @param  {Function}   callback    Standard callback function
 * @api private
 */
const _handleRows = function(rows, callback) {
  const queries = [];
  const toReprocess = [];

  _.each(rows, row => {
    const revisionId = row.get('revisionId');
    const contentId = row.get('contentId');
    const etherpadHtml = row.get('etherpadHtml');

    // Check if we're dealing with an Etherpad revision
    if (etherpadHtml) {
      // Check if we're dealing with a pre-8.0 revision
      const $ = cheerio.load(etherpadHtml);
      if ($('body').length === 0) {
        log().info({ contentId, revisionId }, 'Migrating a revision');

        // Wrap the html fragment in an html and body tag
        const wrappedHtml = util.format(
          '<!DOCTYPE HTML><html><body>%s</body></html>',
          etherpadHtml
        );
        const query = Cassandra.constructUpsertCQL('Revisions', 'revisionId', revisionId, {
          etherpadHtml: wrappedHtml
        });
        queries.push(query);

        // Keep track of this revision so we can reprocess it once we've persisted the wrapped HTML
        toReprocess.push({
          contentId,
          revisionId
        });
        total++;
      }
    }
  });

  /**
   * Start the migration
   *
   * @param  {Function}   callback        Standard callback function that gets called when the migration process is over (or errored out)
   * @param  {Object}     callback.err    An error that occurred, if any
   * @api private
   */
  const migrate = function(callback) {
    log().info(
      'Starting migration process, please be patient as this might take a while\nThe process will exit when the migration has been completed'
    );
    return Cassandra.iterateAll(
      ['revisionId', 'contentId', 'etherpadHtml'],
      'Revisions',
      'revisionId',
      { batchSize: 30 },
      _handleRows,
      callback
    );
  };

  function exitIfError(err, message) {
    if (err) {
      log().error({ err }, message);
      return process.exit(err.code);
    }
  }

  // Rather than just initializing the Casandra and RabbitMQ components, we initialize
  // the entire application server. This allows us to re-use some logic such as PP
  // reprocessing and logging
  OAE.init(config, err => {
    exitIfError(err, 'Unable to spin up the application server');

    migrate(err => {
      exitIfError(err, 'Unable to migrate the revisions');

      log().info(
        'Migration completed, migrated %d revisions, it took %d milliseconds',
        total,
        Date.now() - start
      );
      process.exit();
    });
  });

  // Persist the wrapped etherpad html values, if any
  Cassandra.runBatchQuery(queries, err => {
    if (err) {
      return callback(err);
    }

    // Reprocess each revision, if any
    _.each(toReprocess, revision => {
      PreviewProcesserAPI.submitForProcessing(revision.contentId, revision.revisionId);
    });

    // Proceed to the next batch
    return callback();
  });
};
