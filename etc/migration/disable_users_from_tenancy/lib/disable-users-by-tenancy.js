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
var path = require('path');
var util = require('util');

var AuthzConstants = require('oae-authz/lib/constants').AuthzConstants;
var Context = require('oae-context').Context;
var log = require('oae-logger').logger('oae-script-main');
var PrincipalsAPI = require('oae-principals');
var TenantsAPI = require('oae-tenants');
var User = require('oae-principals/lib/model').User;


/**
 * Disable users from the system by updating the deleted flag
 *
 * @function doMigration
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     tenantAlias     Tenant alias we want to delete users from
 * @param  {Function}   callback        Standard callback function
 */
var doMigration = function (ctx, tenantAlias, disabled, callback) {

    ctx = ctx || _createNewContext();

    PrincipalsAPI.deleteOrRestoreUsersByTenancy(ctx, tenantAlias, disabled, function(err, users) {
        if (err) {
            callback(err);
        }

        log().info('Migration successful.');
        callback(null, users);
    });

    function _createNewContext() {
        // Get the config
        var configPath = path.resolve(process.cwd(), 'config.js');
        var config = require(configPath).config;

        var globalTenant = TenantsAPI.getTenant(config.servers.globalAdminAlias);
        var globalAdmin = new User(globalTenant.alias, util.format('u:%s:admin', globalTenant.alias), 'Global Administrator', null, {
            'visibility': AuthzConstants.visibility.PRIVATE,
            'isGlobalAdmin': true
        });
        return new Context(globalTenant, globalAdmin);
    }
};

module.exports = {
    'doMigration': doMigration
};
