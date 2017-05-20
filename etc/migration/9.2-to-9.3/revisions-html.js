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

var _ = require('underscore');
var cheerio = require('cheerio');
var util = require('util');

var Cassandra = require('oae-util/lib/cassandra');
var log = require('oae-logger').logger('revisions-migrator');
var OAE = require('oae-util/lib/oae');
var PreviewProcesserAPI = require('oae-preview-processor');

// The application configuration
var config = require('../../../config').config;

// Keep track of when we started the migration process so we can output how
// long the migration took
var start = Date.now();

// Keep track of the total number of revisions we'll be migrating
var total = null;

// Ensure that this application server does NOT start processing any preview images
config.previews.enabled = false;

// Rather than just initializing the Casandra and RabbitMQ components, we initialize
// the entire application server. This allows us to re-use some logic such as PP
// reprocessing and logging
OAE.init(config, function(err) {
    if (err) {
        log().error({'err': err}, 'Unable to spin up the application server');
        process.exit(err.code);
    }

    migrate(function(err) {
        if (err) {
            log().error({'err': err}, 'Unable to migrate the revisions');
            process.exit(err.code);
        }

        log().info('Migration completed, migrated %d revisions, it took %d milliseconds', total, (Date.now() - start));
        process.exit();
    });
});


/**
 * Ensure that the `etherpadHtml` of each collabdoc revision is wrapped in the
 * proper HTML and body tags. Revisions that are not wrapped will be updated
 * and queued for preview processing
 *
 * @param  {Row[]}      rows        An array of cassandra rows to update
 * @param  {Function}   callback    Standard callback function
 * @api private
 */
var _handleRows = function(rows, callback) {
    var queries = [];
    var toReprocess = [];

    _.each(rows, function(row) {
        var revisionId = row.get('revisionId');
        var contentId = row.get('contentId');
        var etherpadHtml = row.get('etherpadHtml');

        // Check if we're dealing with an Etherpad revision
        if (etherpadHtml) {

            // Check if we're dealing with a pre-8.0 revision
            var $ = cheerio.load(etherpadHtml);
            if ($('body').length === 0) {
                log().info({'contentId': contentId, 'revisionId': revisionId}, 'Migrating a revision');

                // Wrap the html fragment in an html and body tag
                var wrappedHtml = util.format('<!DOCTYPE HTML><html><body>%s</body></html>', etherpadHtml);
                var query = Cassandra.constructUpsertCQL('Revisions', 'revisionId', revisionId, {'etherpadHtml': wrappedHtml});
                queries.push(query);

                // Keep track of this revision so we can reprocess it once we've persisted the wrapped HTML
                toReprocess.push({
                    'contentId': contentId,
                    'revisionId': revisionId
                });
                total++;
            }
        }
    });

    // Persist the wrapped etherpad html values, if any
    Cassandra.runBatchQuery(queries, function(err) {
        if (err) {
            return callback(err);
        }

        // Reprocess each revision, if any
        _.each(toReprocess, function(revision) {
            PreviewProcesserAPI.submitForProcessing(revision.contentId, revision.revisionId);
        });

        // Proceed to the next batch
        return callback();
    });
};

/**
 * Start the migration
 *
 * @param  {Function}   callback        Standard callback function that gets called when the migration process is over (or errored out)
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
var migrate = function(callback) {
    log().info('Starting migration process, please be patient as this might take a while\nThe process will exit when the migration has been completed');
    return Cassandra.iterateAll(['revisionId', 'contentId', 'etherpadHtml'], 'Revisions', 'revisionId', {'batchSize': 30}, _handleRows, callback);
};
