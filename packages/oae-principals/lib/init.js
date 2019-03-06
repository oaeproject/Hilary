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

const AuthenticationAPI = require('oae-authentication');
const { AuthzConstants } = require('oae-authz/lib/constants');
const { Context } = require('oae-context');
const TenantsAPI = require('oae-tenants');
const { User } = require('oae-principals/lib/model');

module.exports = function(config, callback) {
  // Initialize activity capabilities
  require('oae-principals/lib/activity'); // eslint-disable-line import/no-unassigned-import

  // Initialize search capabilities
  require('oae-principals/lib/search'); // eslint-disable-line import/no-unassigned-import

  // Initialize invitations capabilities
  require('oae-principals/lib/invitations'); // eslint-disable-line import/no-unassigned-import

  // Initialize members and memberships library capabilities
  require('oae-principals/lib/libraries/members'); // eslint-disable-line import/no-unassigned-import
  require('oae-principals/lib/libraries/memberships'); // eslint-disable-line import/no-unassigned-import
  // Initialize principals delete capabilities
  require('oae-principals/lib/delete'); // eslint-disable-line import/no-unassigned-import

    return _ensureGlobalAdmin(config, callback);
};

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
  const globalContext = new Context(globalTenant, globalAdmin);

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
