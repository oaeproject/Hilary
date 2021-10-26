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

import _ from 'underscore';
import eachSeries from 'async/eachSeries.js';
import { CronJob } from 'cron';

import { logger } from 'oae-logger';
import { setUpConfig } from 'oae-config';
import * as UserDeletionUtil from 'oae-principals/lib/definitive-deletion.js';
import * as PrincipalsDAO from './internal/dao.js';

const log = logger('oae-principals');
const PrincipalsConfig = setUpConfig('oae-principals');

const DEFAULT_TIMEZONE = 'Etc/UTC';

/**
 * Create a task which will remove users from the Data Archive table by which the date is exceeded
 *
 * @param  {Function}    callback        Standard callback function
 * @api private
 */
const programUserDeletionTask = function (globalContext, callback) {
  let timezone = PrincipalsConfig.getValue(globalContext.tenant().alias, 'timezone', 'timezone');

  if (!timezone) {
    timezone = DEFAULT_TIMEZONE;
  }

  /*
   * Create cron to definitely delete a user
   * Runs every Sunday at 00:00:00 AM.
   */
  const job = new CronJob(
    '00 00 00 * * 6', // '0 */2 * * * *',
    function () {
      const actualDate = new Date();

      // Get list of pricipals which must be deleted
      PrincipalsDAO.getExpiredUser(actualDate, function (error, principalsToDelete) {
        if (error) return callback(error);

        if (_.isEmpty(principalsToDelete)) return;

        const errors = [];
        eachSeries(
          principalsToDelete,
          (principal, done) => {
            PrincipalsDAO.getPrincipal(principal.principalId, (error, principal) => {
              if (error) {
                // If the principal does not exist anymore for some reason, skip the rest
                errors.push(error);
                return done();
              }

              const { alias } = principal.tenant;
              UserDeletionUtil.eliminateUser(globalContext, principal, alias, (error_) => {
                if (error_) {
                  // If there's been any error, save it and move on
                  errors.push(error_);
                }

                done();
              });
            });
          },
          (error_) => {
            if (error_ || errors.length > 0) {
              log().info({ errors }, 'Errors during user definitive elimination: ');
            }

            log().info('Exiting cron task...');
          }
        );
      });
    },
    null,
    true,
    timezone
  );
  return callback(null, job);
};

export { programUserDeletionTask };
