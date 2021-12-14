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
/* eslint-disable */
import PrincipalsAPI from 'oae-principals';

import path from 'path';
import util from 'util';
import { logger } from 'oae-logger';

import { User } from 'oae-principals/lib/model.js';
import { AuthzConstants } from 'oae-authz/lib/constants.js';
import { Context } from 'oae-context';

import * as TenantsAPI from 'oae-tenants';

const log = logger('oae-script-main');
/**
 * Disable users from the system by updating the deleted flag
 *
 * @function doMigration
 * @param  {Context}    ctx             Current execution context
 * @param  {String}     tenantAlias     Tenant alias we want to delete users from
 * @param  {Function}   callback        Standard callback function
 */
const doMigration = function (ctx, tenantAlias, disabled, callback) {
  ctx = ctx || _createNewContext();

  PrincipalsAPI.deleteOrRestoreUsersByTenancy(ctx, tenantAlias, disabled, (err, users) => {
    if (err) {
      return callback(err);
    }

    log().info('Migration successful.');
    return callback(null, users);
  });

  function _createNewContext() {
    // Get the config
    // eslint-disable-next-line security/detect-non-literal-require
    const configPath = path.resolve(process.cwd(), 'config.js');
    const { config } = require(configPath);

    const globalTenant = TenantsAPI.getTenant(config.servers.globalAdminAlias);
    const globalAdmin = new User(
      globalTenant.alias,
      util.format('u:%s:admin', globalTenant.alias),
      'Global Administrator',
      null,
      {
        visibility: AuthzConstants.visibility.PRIVATE,
        isGlobalAdmin: true
      }
    );
    return new Context(globalTenant, globalAdmin);
  }
};

export { doMigration };
