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
const Cassandra = require('oae-util/lib/cassandra');
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

  _ensureSchema(err => {
    if (err) {
      return callback(err);
    }

    return _ensureGlobalAdmin(config, callback);
  });
};

/**
 * Ensure that the all of the principal-related schemas are created. If they already exist, this method will not
 * do anything
 *
 * @param  {Function}    callback       Standard callback function
 * @param  {Object}      callback.err   An error that occurred, if any
 * @api private
 */
const _ensureSchema = function(callback) {
  // Both user and group information will be stored inside of the Principals CF
  Cassandra.createColumnFamilies(
    {
      Principals:
        'CREATE TABLE "Principals" ("principalId" text PRIMARY KEY, "tenantAlias" text, "displayName" text, "description" text, "email" text, "emailPreference" text, "visibility" text, "joinable" text, "lastModified" text, "locale" text, "publicAlias" text, "largePictureUri" text, "mediumPictureUri" text, "smallPictureUri" text, "admin:global" text, "admin:tenant" text, "notificationsUnread" text, "notificationsLastRead" text, "acceptedTC" text, "createdBy" text, "created" timestamp, "deleted" timestamp)',

      // Map an email address to user ids. An e-mail address can be used by *multiple* users
      PrincipalsByEmail:
        'CREATE TABLE "PrincipalsByEmail" ("email" text, "principalId" text, PRIMARY KEY ("email", "principalId"))',

      // Map a user id to a desired email address and verification token
      PrincipalsEmailToken:
        'CREATE TABLE "PrincipalsEmailToken" ("principalId" text PRIMARY KEY, "email" text, "token" text)',

      // Track user visits to groups they are members of
      UsersGroupVisits:
        'CREATE TABLE "UsersGroupVisits" ("userId" text, "groupId" text, "latestVisit" text, PRIMARY KEY ("userId", "groupId"))'
    },
    err => {
      if (err) {
        return callback(err);
      }
      Cassandra.runQuery(
        'CREATE INDEX IF NOT EXISTS ON "Principals" ("tenantAlias")',
        [],
        callback
      );
    }
  );
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
