/*!
* Copyright 2017 Apereo Foundation (AF) Licensed under the
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

/*
* Disable users belonging to a disabled tenancy
* Github issue #1304
*/
var log = require('oae-logger').logger('oae-script-main');
var PrincipalsAPI = require('oae-principals');

/**
 * Disable users from the system by updating the deleted flag
 *
 * @function doMigration
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     tenantAlias     Tenant alias we want to delete users from
 * @param  {Function}   callback        Standard callback function
 */
var doMigration = function (ctx, tenantAlias, disabled, callback) {
    PrincipalsAPI.deleteOrRestoreUsersByTenancy(ctx, tenantAlias, disabled, function(err, users) {
        if (err) {
            callback(err);
        }

        log().info('Migration successful.');
        callback(null, users);
    });
};

module.exports = {
    'doMigration': doMigration
};
