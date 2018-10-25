/*!
 * Copyright 2016 Apereo Foundation (AF) Licensed under the
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

const _ = require('underscore');

const OaeUtil = require('oae-util/lib/util');
const PrincipalsDAO = require('oae-principals/lib/internal/dao');

const log = require('oae-logger').logger('lowerCaseEmails-migrator');

// The batch size of principals to migrate
const BATCH_SIZE = 30;

/**
 * Lower-case the emails in this set of principals
 *
 * @param  {Principal[]}    principals          The principals whose emails to make lower case
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Number}         callback.nSkipped   The number of principals that were skipped (groups, no mixed-case email)
 * @param  {Number}         callback.nUpdated   The number of users whose emails were updated
 * @param  {Number}         callback.nFailed    The number of users that attempted to be migrated but failed
 * @api private
 */
// eslint-disable-next-line complexity
const _lowerCaseEmailsRecursive = function(...args) {
  let [principals, callback, _nSkipped, _nUpdated, _nFailed] = args;
  principals = principals.slice();
  _nSkipped = _nSkipped || 0;
  _nUpdated = _nUpdated || 0;
  _nFailed = _nFailed || 0;
  if (_.isEmpty(principals)) {
    return callback(null, _nSkipped, _nUpdated, _nFailed);
  }

  // Check if the principal is all lower case. If not, we persist and update
  // for it
  const principal = principals.shift();
  const newEmail = _.isString(principal.email) ? principal.email.toLowerCase() : principal.email;
  const shouldUpdate = principal.email !== newEmail;
  OaeUtil.invokeIfNecessary(
    shouldUpdate,
    PrincipalsDAO.updatePrincipal,
    principal.principalId,
    { email: newEmail },
    err => {
      if (err) {
        log().warn({ err, principal }, 'Failed to migrate a user email');
        _nFailed++;
      } else if (shouldUpdate) {
        log().info(
          { before: principal.email, after: newEmail },
          'Email migrated for user "%s"',
          principal.displayName
        );
        _nUpdated++;
      } else {
        _nSkipped++;
      }

      return _lowerCaseEmailsRecursive(principals, callback, _nSkipped, _nUpdated, _nFailed);
    }
  );
};

/**
 * Perform the lower-casing migration
 *
 * @param  {Object}     stats   The stats object whose stats to update as the migration occurrs. This object is updated in place
 * @api private
 */
const _lowerCaseEmails = function(stats) {
  // The function to pass into iterateAll that proesses all batches of
  // principals
  return function(principals, callback) {
    _lowerCaseEmailsRecursive(principals, (err, nSkipped, nUpdated, nFailed) => {
      if (err) {
        return callback(err);
      }

      // Update the stats from this iteration
      stats.nSkipped += nSkipped;
      stats.nUpdated += nUpdated;
      stats.nFailed += nFailed;

      log().info(
        {
          nSkipped,
          nUpdated,
          nFailed,
          total: stats
        },
        'Finished migrating a batch of %s principals',
        BATCH_SIZE
      );
      return callback();
    });
  };
};

/**
 * Migrate email addresses that are mixed case to be lower case
 *
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.stats              The migration stats
 * @param  {Number}     callback.stats.nSkipped     The number of principals that were skipped (groups, no mixed-case email)
 * @param  {Number}     callback.stats.nUpdated     The number of users whose emails were updated
 * @param  {Number}     callback.stats.nFailed      The number of users that attempted to be migrated but failed
 */
const doMigration = function(callback) {
  const stats = { nSkipped: 0, nUpdated: 0, nFailed: 0 };
  PrincipalsDAO.iterateAll(
    ['principalId', 'displayName', 'email'],
    BATCH_SIZE,
    _lowerCaseEmails(stats),
    err => {
      if (err) {
        return callback(err);
      }

      return callback(null, stats);
    }
  );
};

module.exports = {
  doMigration
};
