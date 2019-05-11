/*!
 * Copyright 2018 Apereo Foundation (AF) Licensed under the
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

import * as _ from 'underscore';
import * as async from 'async';
import { CronJob } from 'cron';

import { setUpConfig } from 'oae-config';
import * as UserDeletionUtil from 'oae-principals/lib/definitive-deletion';
import * as PrincipalsDAO from './internal/dao';

const PrincipalsConfig = setUpConfig('oae-principals');

const DEFAULT_TIMEZONE = 'Etc/UTC';

/**
 * Create a task which will remove users from the Data Archive table by which the date is exceeded
 *
 * @param  {Function}    callback        Standard callback function
 * @api private
 */
const programUserDeletionTask = function(globalContext, callback) {
  let timezone = PrincipalsConfig.getValue(globalContext.tenant().alias, 'timezone', 'timezone');

  if (!timezone) {
    timezone = DEFAULT_TIMEZONE;
  }

  /*
   * Create cron to definitely delete a user
   * Runs every Sunday at 00:00:00 AM.
   */
  return callback(
    null,
    new CronJob(
      '00 00 00 * * 7',
      function() {
        const actualDate = new Date();

        // Get list of pricipals which must be deleted
        PrincipalsDAO.getExpiredUser(actualDate, function(err, principalsToDelete) {
          if (err) {
            return callback(err);
          }

          if (_.isEmpty(principalsToDelete)) {
            return;
          }

          async.mapSeries(principalsToDelete, function(principal, callback) {
            // Get the principal
            PrincipalsDAO.getPrincipal(principal.principalId, function(err, principal) {
              if (err) {
                return callback(err);
              }

              // Delete user
              UserDeletionUtil.deleteUser(globalContext, principal, principal.tenant.alias, function(err) {
                if (err) {
                  return callback(err);
                }

                return callback();
              });
            });
          });
        });
      },
      null,
      true,
      timezone
    )
  );
};

export { programUserDeletionTask };
