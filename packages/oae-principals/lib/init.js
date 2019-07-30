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

import util from 'util';

import * as AuthenticationAPI from 'oae-authentication';
import * as TenantsAPI from 'oae-tenants';

import { AuthzConstants } from 'oae-authz/lib/constants';
import { Context } from 'oae-context';
import { User } from 'oae-principals/lib/model';

// Initialize activity capabilities
// eslint-disable-next-line no-unused-vars, import/namespace
import * as activity from 'oae-principals/lib/activity';

// Initialize search capabilities
// eslint-disable-next-line no-unused-vars, import/namespace
import * as search from 'oae-principals/lib/search';

// Initialize invitations capabilities
// eslint-disable-next-line no-unused-vars, import/namespace
import * as invitations from 'oae-principals/lib/invitations';

// Initialize members and memberships library capabilities
// eslint-disable-next-line no-unused-vars
import * as members from 'oae-principals/lib/libraries/members';

// eslint-disable-next-line no-unused-vars, import/namespace
import * as memberships from 'oae-principals/lib/libraries/memberships';

// Initialize principals delete capabilities
// eslint-disable-next-line no-unused-vars
import * as deleted from 'oae-principals/lib/delete';
import * as Cron from './cron';

let globalContext = {};

export function init(config, callback) {
  _ensureGlobalAdmin(config, function(err) {
    if (err) return callback(err);

    return Cron.programUserDeletionTask(globalContext, callback);
  });
}

/**
 * Ensure that the default global administrative user exists with username "administrator", and create
 * them if they do not
 *
 * @param  {Object}      config          The server configuration
 * @param  {Function}    callback        Standard callback function
 * @param  {Object}      callback.err    An error that occurred, if any
 * @api private
 */
const _ensureGlobalAdmin = function(config, callback) {
  // Mock a global admin request context so we can create a proper global administrator in the system
  const globalTenant = TenantsAPI.getTenant(config.servers.globalAdminAlias);
  const globalAdminId = util.format('u:%s:admin', globalTenant.alias);
  const globalAdmin = new User(globalTenant.alias, globalAdminId, 'Global Administrator', null, {
    visibility: AuthzConstants.visibility.PRIVATE,
    isGlobalAdmin: true
  });

  globalContext = new Context(globalTenant, globalAdmin);

  // Create the global admin user if they don't exist yet with the username "administrator"
  return AuthenticationAPI.getOrCreateGlobalAdminUser(
    globalContext,
    'administrator',
    'administrator',
    globalAdmin.displayName,
    globalAdmin,
    callback
  );
};
