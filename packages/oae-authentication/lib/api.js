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

import crypto from 'crypto';
import { format } from 'util';
import _ from 'underscore';
import passport from 'passport';

import { AuthzConstants } from 'oae-authz/lib/constants.js';
import * as AuthzInvitationsDAO from 'oae-authz/lib/invitations/dao.js';
import * as Cassandra from 'oae-util/lib/cassandra.js';
import * as ConfigAPI from 'oae-config';
import * as EmitterAPI from 'oae-emitter';
import * as Locking from 'oae-util/lib/locking.js';
import * as EmailAPI from 'oae-email';
import OaeEmitter from 'oae-util/lib/emitter.js';
import * as OaeUtil from 'oae-util/lib/util.js';
import PrincipalsAPI from 'oae-principals';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao.js';
import * as TenantsAPI from 'oae-tenants';
import * as TenantsUtil from 'oae-tenants/lib/util.js';
import { logger } from 'oae-logger';
import { Validator as validator } from 'oae-authz/lib/validator.js';
const {
  validateInCase: bothCheck,
  getNestedObject,
  isLoggedInUser,
  isGlobalAdministratorUser,
  isShortString,
  isEmail,
  isObject,
  isUserId,
  unless,
  isNotEmpty
} = validator;

import { compose, and } from 'ramda';
import isLength from 'validator/lib/isLength.js';
import { getTenantSkinVariables } from 'oae-ui';
import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationUtil from 'oae-authentication/lib/util.js';

import { LoginId } from 'oae-authentication/lib/model.js';

const log = logger('oae-authentication');

let globalTenantAlias = null;

// Holds the strategies for each tenant
const strategies = {};

// When a tenant is created, configure the default authentication strategies
TenantsAPI.emitter.on('created', (tenant) => {
  refreshStrategies(tenant);
});

// When a tenant starts up, configure its authentication strategies
TenantsAPI.emitter.on('start', (tenant) => {
  refreshStrategies(tenant);
});

// When a tenant is refreshed, refresh its authentication strategies
TenantsAPI.emitter.on('refresh', (tenant) => {
  refreshStrategies(tenant);
});

// When the server has started up, we enable all the strategies for all the tenants
OaeEmitter.on('ready', () => {
  _refreshAllTenantStrategies();
});

/**
 * Refresh the tenant authentication strategies when the configuration for a tenant has been updated.
 * In case the configuration of the global admin tenant was updated, all authentication strategies will
 * be refreshed. In case the configuration for an individual tenant was updated, only the authentication
 * strategies for that tenant will be refreshed.
 *
 * @param  {String}     [tenantAlias]       The alias of the tenant for which to refresh the authentication strategies. If `null` or the global tenant alias is specified, all strategies will be refreshed
 * @api private
 */
const _configUpdate = function (tenantAlias) {
  if (!tenantAlias || tenantAlias === globalTenantAlias) {
    // We updated the global tenant, which means we'll have to update all
    // tenant authentication strategies, as they may have changed transiently
    _refreshAllTenantStrategies();
  } else {
    const tenant = TenantsAPI.getTenant(tenantAlias);
    if (!tenant) {
      return log().error(
        { tenantAlias },
        'Error fetching tenant to update authentication configuration'
      );
    }

    refreshStrategies(tenant);
  }
};

ConfigAPI.eventEmitter.on('update', _configUpdate);

/**
 * ### Events
 *
 * The `AuthenticationAPI`, as enumerated in `AuthenticationConstants.events`, emits the following events:
 *
 * * `refreshedStrategies(tenant)`: The authentication strategies have been refreshed with the current configuration. The tenant that was refreshed is returned as a `Tenant` object.
 * * `userImpostered(imposter, user)`: A user was impostered by another user
 * * `userLoggedIn(user, strategyName)`: A user logged into the system. The strategy that was used to log in is provided
 * * `userLoggedOut(ctx)`: A user logged out of the system
 */
const emitter = new EmitterAPI.EventEmitter();
const AuthenticationAPI = emitter;

/**
 * Initializes the configuration of the authentication module.
 *
 * @param  {String} globalTenantAlias   The alias of the global tenant
 */
const init = function (_globalTenantAlias) {
  globalTenantAlias = _globalTenantAlias;
};

/// /////////////////////
/// /////////////////////
// USER ID MANAGEMENT //
/// /////////////////////
/// /////////////////////

/**
 * Determine if a local username already exists
 *
 * @param  {Context}   ctx                Standard context object containing the current user and the current tenant
 * @param  {String}    [tenantAlias]      The alias of the tenant on which to check for existence. Defaults to the current tenant
 * @param  {String}    username           The username to check existence for
 * @param  {Function}  callback           Standard callback function
 * @param  {Object}    callback.err       An error that occurred, if any
 * @param  {Boolean}   callback.exists    Whether or not the username exists on the current tenant
 */
const localUsernameExists = function (ctx, tenantAlias, username, callback) {
  tenantAlias = tenantAlias || ctx.tenant().alias;

  // Create the loginid object first, so it can be passed into the validation
  const loginId = new LoginId(tenantAlias, AuthenticationConstants.providers.LOCAL, username);

  // Parameter validation
  try {
    unless(isNotEmpty, {
      code: 400,
      msg: 'Please specify a username'
    })(username);
    _validateLoginIdForLookup(validator, loginId, callback);
  } catch (error) {
    return callback(error);
  }

  _getUserIdFromLoginId(loginId, (error, userId) => {
    if (error && error.code !== 404) {
      return callback(error);
    }

    if (!userId) {
      return callback(null, false);
    }

    return callback(null, true);
  });
};

/**
 * Get the global administrator with the given username. If no user exists with the given username,
 * create a private user with the provided username, password and profile information and make them
 * a global admin
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     username                The unique username for the global administrator
 * @param  {String}     password                The password for the global administrator
 * @param  {String}     displayName             The display name for the global administrator
 * @param  {String}     [opts]                  Optional user profile parameters
 * @param  {String}     [opts.locale]           The locale for the global administrator
 * @param  {String}     [opts.email]            The email address for the global administrator
 * @param  {string}     [opts.emailPreference]  The email preference for the global administrator
 * @param  {String}     [opts.publicAlias]      The name to show when the global administrator is inaccessible to a user
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {User}       callback.user           The user associated with the provided username
 * @param  {String}     callback.loginId        The *flattened* loginId for this user
 * @param  {Boolean}    callback.created        `true` if a global administrator was created with the provided username, `false` otherwise
 */
const getOrCreateGlobalAdminUser = function (
  ctx,
  username,
  password,
  displayName,
  options,
  callback
) {
  options = options || {};

  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'You must be authenticated to the global admin tenant to create a global administrator user'
    })(ctx, globalTenantAlias);

    unless(isGlobalAdministratorUser, {
      code: 401,
      msg: 'You must be a global administrator to create a global administrator user'
    })(ctx);

    unless(isNotEmpty, {
      code: 400,
      msg: 'You must provide a username'
    })(username);

    unless(isNotEmpty, {
      code: 400,
      msg: 'You must provide a password'
    })(password);

    unless(isNotEmpty, {
      code: 400,
      msg: 'You must provide a display name'
    })(displayName);

    unless(isShortString, {
      code: 400,
      msg: 'A display name can be at most 1000 characters long'
    })(displayName);
  } catch (error) {
    return callback(error);
  }

  // Global admin users always start out private
  options.visibility = AuthzConstants.visibility.PRIVATE;

  // Global admins can only be created by other global administrators,
  // who probably know the email address is accurate
  options.emailVerified = true;

  const providerProperties = { password };
  getOrCreateUser(
    ctx,
    AuthenticationConstants.providers.LOCAL,
    username,
    providerProperties,
    displayName,
    options,
    (error, user, loginId, created) => {
      if (error) {
        return callback(error);
      }

      if (!created) {
        // The user already existed, just return the existing user
        return callback(null, user, loginId, false);
      }

      // The user was created, mark them as a global admin user
      PrincipalsAPI.setGlobalAdmin(ctx, user.id, true, (error_) => {
        if (error_) {
          return callback(error_);
        }

        if (created) {
          log().info({ user, username }, 'Global Admin account created');
        }

        // Fetch the user again to get the updated version of the user
        PrincipalsAPI.getUser(ctx, user.id, (error, user) => {
          if (error) {
            return callback(error);
          }

          return callback(null, user, loginId, true);
        });
      });
    }
  );
};

/**
 * Utility methods that gets a user by the login id. If the user doesn't exist yet, it will be created.
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     authProvider            The authentication provider of the login id
 * @param  {String}     externalId              The desired externalId/username for this user
 * @param  {String}     displayName             The display name for the user
 * @param  {String}     [opts]                  Optional user profile parameters
 * @param  {String}     [opts.locale]           The locale for the user
 * @param  {String}     [opts.email]            The email address for the user
 * @param  {String}     [opts.emailPreference]  The email preference for the user
 * @param  {String}     [opts.visibility]       The visibility of the user. One of: @see AuthzConstants.visibility
 * @param  {String}     [opts.publicAlias]      The name to show when the user is inaccessible to a user
 * @param  {String}     [opts.invitationToken]  If specified indicates that there was an invitation token available when creating the account. If it is for an email that matches the user's specified email, then the email will be considered verified
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {User}       callback.user           The user that was fetched or created
 * @param  {String}     callback.loginId        The *flattened* loginId for this user
 * @param  {Boolean}    callback.created        `true` if the user was created, `false` otherwise
 */
const getOrCreateUser = function (
  ctx,
  authProvider,
  externalId,
  providerProperties,
  displayName,
  options,
  callback
) {
  // Create the expected login id and ensure it is valid for potentially persisting into storage
  const loginId = new LoginId(ctx.tenant().alias, authProvider, externalId, providerProperties);
  try {
    unless(isNotEmpty, {
      code: 400,
      msg: 'You must provide a display name'
    })(displayName);

    unless(isShortString, {
      code: 400,
      msg: 'A display name can be at most 1000 characters long'
    })(displayName);

    _validateLoginIdForPersistence(validator, loginId, callback);
  } catch (error) {
    return callback(error);
  }

  return _getOrCreateUser(ctx, loginId, displayName, options, callback);
};

/**
 * Create a user with the given login id if no user exists for it yet
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {LoginId}    loginId                 The login id to use to fetch or create the user
 * @param  {String}     displayName             The display name for the user
 * @param  {Object}     [opts]                  Optional user profile parameters
 * @param  {String}     [opts.invitationToken]  Will be specified to auto-validate the user's email address. If the user account does not exist yet, and the invitation token is not valid, then account creation will fail
 * @param  {Boolean}    [opts.authoritative]    When `true`, the email domain validation check will be skipped and the user account will be created
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {User}       callback.user           The user that was fetched or created
 * @param  {String}     callback.loginId        The *flattened* loginId for this user
 * @param  {Boolean}    callback.created        `true` if the user was created, `false` otherwise
 * @api private
 */
const _getOrCreateUser = function (ctx, loginId, displayName, options, callback) {
  options = options || {};

  _getUserIdFromLoginId(loginId, (error, userId) => {
    if (error && error.code !== 404) {
      return callback(error);
    }

    if (userId) {
      // The user existed, simply fetch their profile
      PrincipalsDAO.getPrincipal(userId, (error, user) => {
        if (error) {
          return callback(error);
        }

        if (user.deleted) {
          return callback({ code: 401, msg: 'Provided login id belongs to a deleted user' });
        }

        return callback(null, user, _flattenLoginId(loginId), false);
      });
    } else {
      // No user mapped to this login id so we will create a user for it
      log(ctx).trace(
        {
          authProvider: loginId.provider,
          externalId: loginId.externalId,
          displayName,
          opts: options
        },
        'Auto-creating a user on login'
      );

      // Remove invalid email address if they come from authoritative sources. This happens
      // when a Shib or Cas IdP has been misconfigured
      try {
        const isValidEmail = and(options.authoritative, options.email);
        unless(bothCheck(isValidEmail, isEmail), {
          code: 400,
          msg: 'Invalid email'
        })(options.email);
      } catch {
        delete options.email;
      }

      OaeUtil.invokeIfNecessary(
        options.invitationToken,
        AuthzInvitationsDAO.getEmailByToken,
        options.invitationToken,
        (error, email) => {
          if (error) {
            return callback(error);
          }

          if (email && !options.email) {
            // If no email is provided by the auth provider, set the email associated to the
            // token as the verified email
            options.email = email;
            options.emailVerified = true;
          } else if (email && email === options.email) {
            // If an email is provided by the auth provider and it matches that of the
            // invitation token (if any), mark the email as verified
            options.emailVerified = true;
          }

          const isAdmin = ctx.user() && ctx.user().isAdmin(ctx.tenant().alias);

          // If an email address was provided by a non authoritative source (Facebook, Twitter,
          // Google, Local authentication) by a user that is not an administrator we should
          // check whether the email address matches the tenant's configured email domain
          let shouldCheckEmail =
            !_.isEmpty(ctx.tenant().emailDomains) && !isAdmin && !options.authoritative;

          // However, if a user followed a link from an invitation email we do not check whether
          // the email belongs to the configured tenant's email domain. This is to allow for the
          // situation where a tenant's email domain gets changed after a user gets invited
          // but before the user has accepted the invitation
          if (options.invitationToken && options.emailVerified) {
            shouldCheckEmail = false;
          }

          OaeUtil.invokeIfNecessary(
            shouldCheckEmail,
            _validateEmailBelongsToTenant,
            ctx,
            options.email,
            (error_) => {
              if (error_) {
                return callback(error_);
              }

              createUser(ctx, loginId, displayName, options, (error, user) => {
                if (error) {
                  return callback(error);
                }

                return callback(null, user, _flattenLoginId(loginId), true);
              });
            }
          );
        }
      );
    }
  });
};

/**
 * Validate that an email address belongs to the tenant in context
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     email           The email address to validate
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _validateEmailBelongsToTenant = function (ctx, email, callback) {
  // Ensure an email address has been provided
  if (!email) {
    return callback({
      code: 400,
      msg: 'An email address was not provided when a tenant email domain has been configured',
      reason: 'email_missing'
    });
  }

  // Ensure the email address belongs to the current tenant
  const tenant = TenantsAPI.getTenantByEmail(email);
  if (ctx.tenant().alias !== tenant.alias) {
    return callback({
      code: 400,
      msg: 'An email address was provided that does not match the configured email domain',
      reason: 'email_domain_mismatch'
    });
  }

  return callback();
};

/**
 * Create a private tenant administrator user with the provided login id
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {LoginId}    loginId                     The login id that will be associated with the tenant administrator so they may log in
 * @param  {String}     displayName                 The display name for the tenant administrator
 * @param  {Object}     [opts]                      Optional user profile parameters
 * @param  {String}     [opts.email]                The email address for the user
 * @param  {String}     [opts.emailPreference]      The email preference for the tenant administrator. One of: @see PrincipalsConstants.emailPreference
 * @param  {String}     [opts.locale]               The locale for the tenant administrator
 * @param  {String}     [opts.publicAlias]          The name to show when the tenant administrator is inaccessible to a user
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {User}       callback.user               The created tenant administrator
 */
const createTenantAdminUser = function (ctx, loginId, displayName, options, callback) {
  options = options || {};

  try {
    unless(isObject, {
      code: 400,
      msg: 'A LoginId must be provided'
    })(loginId);

    unless(isNotEmpty, {
      code: 400,
      msg: 'You must provide a display name'
    })(displayName);

    unless(isShortString, {
      code: 400,
      msg: 'A display name can be at most 1000 characters long'
    })(displayName);
    _validateLoginIdForPersistence(validator, loginId, callback);
  } catch (error) {
    return callback(error);
  }

  const targetTenant = TenantsAPI.getTenant(loginId.tenantAlias);
  if (!targetTenant) {
    return callback({
      code: 404,
      msg: 'A non-existing tenant was specified as the target for this user'
    });
  }

  if (targetTenant.isGlobalAdminServer) {
    return callback({
      code: 400,
      msg: 'A tenant administrator cannot be created on the global admin tenant'
    });
  }

  if (!ctx.user() || !ctx.user().isAdmin(targetTenant.alias)) {
    return callback({ code: 401, msg: 'Only administrators can create new tenant administrators' });
  }

  // Tenant administrators always start private
  options.visibility = AuthzConstants.visibility.PRIVATE;

  // Tenant administrators can only be created by other administrators,
  // who probably know the email address is accurate
  options.emailVerified = true;

  // Create the user object with their login id
  _createUser(ctx, loginId, displayName, options, (error, user) => {
    if (error) {
      return callback(error);
    }

    // Make the created user a tenant admin
    PrincipalsAPI.setTenantAdmin(ctx, user.id, true, (error_) => {
      if (error_) {
        return callback(error_);
      }

      return callback(null, user);
    });
  });
};

/**
 * Create a user with the provided login id
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {LoginId}    loginId                     The login id that will be associated with the user so they may log in
 * @param  {String}     displayName                 The display name for the user
 * @param  {Object}     [opts]                      Optional user profile parameters
 * @param  {Boolean}    [opts.acceptedTC]           Whether or not the user has accepted the Terms and Conditions
 * @param  {String}     [opts.locale]               The locale for the user
 * @param  {String}     [opts.email]                The email address for the user
 * @param  {String}     [opts.emailPreference]      The email preference for the user. One of: @see PrincipalsConstants.emailPreference
 * @param  {String}     [opts.visibility]           The visibility of the user. One of: @see AuthzConstants.visibility
 * @param  {String}     [opts.publicAlias]          The name to show when the user is inaccessible to a user
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {User}       callback.user               The created user
 */
const createUser = function (ctx, loginId, displayName, options, callback) {
  try {
    unless(isNotEmpty, {
      code: 400,
      msg: 'You must provide a display name'
    })(displayName);

    unless(isShortString, {
      code: 400,
      msg: 'A display name can be at most 1000 characters long'
    })(displayName);
    _validateLoginIdForPersistence(validator, loginId, callback);
  } catch (error) {
    return callback(error);
  }

  const targetTenant = TenantsAPI.getTenant(loginId.tenantAlias);
  if (!targetTenant) {
    return callback({
      code: 404,
      msg: 'A non-existing tenant was specified as the target for this user'
    });
  }

  const isGlobalAdmin = ctx.user() && ctx.user().isGlobalAdmin();
  if (targetTenant.isGlobalAdminServer && !isGlobalAdmin) {
    // Only global admins can create users on the global admin tenant
    return callback({
      code: 401,
      msg: 'Only global administrators may create a user on the global admin tenant'
    });
  }

  if (ctx.tenant().alias !== targetTenant.alias && !isGlobalAdmin) {
    // Only global admins can create users on a tenant other than the current
    return callback({
      code: 401,
      msg: 'Only global administrators may create users on a tenant that is not the current'
    });
  }

  _createUser(ctx, loginId, displayName, options, callback);
};

/**
 * Internal utility function to create a user. Validation on inputs should be performed before
 * calling this function
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {LoginId}    loginId                     The login id that will be associated with the user so they may log in
 * @param  {String}     displayName                 The display name for the user
 * @param  {Object}     [opts]                      Optional user profile parameters
 * @param  {Boolean}    [opts.acceptedTC]           Whether or not the user has accepted the Terms and Conditions
 * @param  {String}     [opts.locale]               The locale for the user
 * @param  {String}     [opts.email]                The email address for the user
 * @param  {String}     [opts.emailPreference]      The email preference for the user. One of: @see PrincipalsConstants.emailPreference
 * @param  {String}     [opts.visibility]           The visibility of the user. One of: @see AuthzConstants.visibility
 * @param  {String}     [opts.publicAlias]          The name to show when the user is inaccessible to a user
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {User}       callback.user               The created user
 * @api private
 */
const _createUser = function (ctx, loginId, displayName, options, callback) {
  // Lock on externalId to make sure we're not already making an account for this user
  const lockKey = loginId.externalId;
  Locking.acquire(lockKey, 15, (error, lock) => {
    if (error) {
      return callback({
        code: 400,
        msg: 'Failed to acquire lock probably because this login id already exists and is already associated to a user'
      });
    }

    // Make sure the loginId is not already associated to a user
    _getUserIdFromLoginId(loginId, (error, userId) => {
      if (error && error.code !== 404) {
        return callback(error);
      }

      if (userId) {
        return callback({
          code: 400,
          msg: 'This login id already exists and is already associated to a user'
        });
      }

      // Hash the user password
      if (loginId.provider === AuthenticationConstants.providers.LOCAL) {
        loginId.properties.password = AuthenticationUtil.hashPassword(loginId.properties.password);
      }

      // Create the user and immediately associate the login id
      PrincipalsAPI.createUser(ctx, loginId.tenantAlias, displayName, options, (error, user) => {
        if (error) {
          Locking.release(lock, () => {
            return callback(error);
          });
          return;
        }

        loginId.userId = user.id;
        _associateLoginId(loginId, user.id, (error_) => {
          // Immediately release the lock, regardless of whether or not
          // association worked
          Locking.release(lock, () => {
            if (error_) {
              return callback(error_);
            }

            log(ctx).info(
              {
                loginId: {
                  tenantAlias: loginId.tenantAlias,
                  provider: loginId.provider,
                  externalId: loginId.externalId
                },
                userId: user.id
              },
              'Created user with a mapped login id'
            );

            return callback(null, user);
          });
        });
      });
    });
  });
};

/**
 * Associate the given Login ID info to the specified user. This makes it possible for the associated user to login with the provided
 * login credentials.
 *
 * @param  {Context}   ctx             Standard context object containing the current user and the current tenant
 * @param  {LoginId}   loginId         The login id to associate to the user
 * @param  {String}    userId          The id of the user to which to associate the login id
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const associateLoginId = function (ctx, loginId, userId, callback) {
  try {
    _validateLoginIdForPersistence(validator, loginId, callback);
    unless(isLoggedInUser, {
      code: 401,
      msg: 'You must be authenticated to associate a login id to a user'
    })(ctx);
    unless(isNotEmpty, {
      code: 400,
      msg: 'You must specify a user id'
    })(userId);
  } catch (error) {
    return callback(error);
  }

  const isAdmin = ctx.user().isAdmin(loginId.tenantAlias);
  const isTargetUser = ctx.user().id === userId;
  if (!isAdmin && !isTargetUser) {
    // Only admin and the user themself can associate a login id to the account
    return callback({
      code: 401,
      msg: 'You cannot associate a login id to a user other than your own'
    });
  }

  _getUserIdFromLoginId(loginId, (error, existingUserIdMapping) => {
    if (error && error.code !== 404) {
      return callback(error);
    }

    if (existingUserIdMapping && !isAdmin) {
      // Only admin can re-associate a login id to another user
      return callback({ code: 401, msg: 'Login ID is already associated to a user' });
    }

    // Verify we don't assign 2 ids of the same provider to a user
    _getUserLoginIds(userId, (error, loginIds) => {
      if (error) {
        return callback(error);
      }

      if (loginIds[loginId.provider]) {
        return callback({
          code: 400,
          msg: 'User already has a login id of type ' + loginId.provider
        });
      }

      // Ensure that the target user exists
      PrincipalsAPI.getUser(ctx, userId, (error, user) => {
        if (error) {
          return callback(error);
        }

        if (user.deleted) {
          return callback({ code: 404, msg: format("Couldn't find principal: ", userId) });
        }

        _associateLoginId(loginId, userId, (error_) => {
          if (error_) {
            return callback(error_);
          }

          log(ctx).info(
            {
              loginId: {
                tenantAlias: loginId.tenantAlias,
                provider: loginId.provider,
                externalId: loginId.externalId
              },
              userId
            },
            'Mapped login id to user account'
          );

          return callback();
        });
      });
    });
  });
};

/**
 * Change a user's local password
 *
 * @param  {Context}    ctx               Standard context object containing the current user and the current tenant
 * @param  {String}     userId            The id of user for which to change the local password
 * @param  {String}     [oldPassword]     The previous password for the user. This is only required when the current user is not an administrator
 * @param  {String}     newPassword       The new password for the user
 * @param  {Function}   callback          Standard callback function
 * @param  {Object}     callback.err      An error that occurred, if any
 */
const changePassword = function (ctx, userId, oldPassword, newPassword, callback) {
  // Parameter validation
  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'You have to be logged in to be able to change a password'
    })(ctx);
    unless(isUserId, {
      code: 400,
      msg: 'A user id must be provided'
    })(userId);
    unless(isNotEmpty, {
      code: 400,
      msg: 'A new password must be provided'
    })(newPassword);
  } catch (error) {
    return callback(error);
  }

  // Ensure the user changing their password exists
  PrincipalsAPI.getUser(ctx, userId, (error, user) => {
    if (error) {
      return callback(error);
    }

    if (user.deleted) {
      return callback({ code: 404, msg: format("Couldn't find principal: ", userId) });
    }

    // Get the local login id for the user
    _getUserLoginIds(userId, (error, loginIds) => {
      if (error) {
        return callback(error);
      }

      // Can only change password on the local account type
      const localLoginId = loginIds[AuthenticationConstants.providers.LOCAL];
      if (!localLoginId) {
        return callback({ code: 400, msg: 'User does not have a local account mapping' });
      }

      // Determine the current user access
      const isAdmin = ctx.user().isAdmin(localLoginId.tenantAlias);
      const isTargetUser = ctx.user().id === userId;
      if (!isAdmin && !isTargetUser) {
        log().info(
          'Failed attempt to change password for user %s by user %s',
          userId,
          ctx.user().id
        );
        return callback({ code: 401, msg: "You're not authorized to change this user's password" });
      }

      if (isAdmin) {
        // If the user is admin we don't care about the old password
        log().info('User %s is changing the password for user %s', ctx.user().id, userId);
        return _changePassword(localLoginId, newPassword, callback);
      }

      // If it's the current user, we need to verify the old password
      checkPassword(localLoginId.tenantAlias, localLoginId.externalId, oldPassword, (error_) => {
        if (error_) {
          // Old password was probably incorrect
          log().error(
            { err: error_ },
            'User %s failed to change password for %s',
            ctx.user().id,
            userId
          );
          return callback(error_);
        }

        log().info('User %s is changing the password for user %s', ctx.user().id, userId);
        return _changePassword(localLoginId, newPassword, callback);
      });
    });
  });
};

/**
 * Checks the password for a specified tenant/username combination
 *
 * @param  {String}    tenantAlias      The alias of the tenant to which the user belongs
 * @param  {String}    username         The local username of the user
 * @param  {String}    password         The password that should be checked
 * @param  {Function}  callback         Standard callback function
 * @param  {Object}    callback.err     An error that occurred, if any
 * @param  {String}    callback.userId  The ID of the user if the passwords match
 */
const checkPassword = function (tenantAlias, username, password, callback) {
  // We can only check password on local authentication
  const loginId = new LoginId(tenantAlias, AuthenticationConstants.providers.LOCAL, username);

  // Parameter validation
  try {
    unless(isNotEmpty, {
      code: 401,
      msg: 'A tenant must be provided'
    })(tenantAlias);

    unless(isNotEmpty, {
      code: 400,
      msg: 'A username must be provided'
    })(username);

    unless(isNotEmpty, {
      code: 400,
      msg: 'A password must be provided'
    })(password);
    _validateLoginIdForLookup(validator, loginId, callback);
  } catch (error) {
    return callback(error);
  }

  Cassandra.runQuery(
    'SELECT "userId", "password" FROM "AuthenticationLoginId" WHERE "loginId" = ?',
    [_flattenLoginId(loginId)],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      if (_.isEmpty(rows)) {
        // No user found with that login id
        return callback({ code: 401, msg: 'No password found for this principal' });
      }

      // Check if the user provided password matches the stored password
      const result = Cassandra.rowToHash(rows[0]);
      const passwordMatches =
        result.userId &&
        result.password &&
        AuthenticationUtil.hashAndComparePassword(password, result.password);
      if (passwordMatches) {
        callback(null, result.userId);
      } else {
        log().info('Invalid password check for user %s', username);
        callback({ code: 401, msg: 'User name and/or password do not match' });
      }
    }
  );
};

/**
 * Gets the userId that is associated to the provided login ID, if any.
 *
 * @param  {String}    tenantAlias     The tenant of the login id
 * @param  {String}    provider        The provider of the login id (e.g., twitter, local, google...)
 * @param  {String}    externalId      The id of the user in the external authentication service
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @param  {String}    callback.userId The id of the user that was associated to the login id, if any
 */
const getUserIdFromLoginId = function (tenantAlias, provider, externalId, callback) {
  const loginId = new LoginId(tenantAlias, provider, externalId);

  try {
    _validateLoginIdForLookup(validator, loginId, callback);
  } catch (error) {
    return callback(error);
  }

  _getUserIdFromLoginId(loginId, callback);
};

/**
 * Get the secret for an existing user's resetpassword request
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     userName        The user's own unique username
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Object}     callback.secret The secret token that will be returned
 */
const getResetPasswordSecret = function (ctx, username, callback) {
  // Default to the current tenant's alias
  const tenantAlias = ctx.tenant().alias;

  // Create the loginid object first, so it can be passed into the validation
  const loginId = new LoginId(tenantAlias, AuthenticationConstants.providers.LOCAL, username);

  // Check if we can get an existing userID using the userName the user provided
  _getUserIdFromLoginId(loginId, (error, userId) => {
    if (error) {
      return callback({ code: 404, msg: 'No user could be found with the provided username' });
    }

    // Get user's object as we will try to send the user an email with token
    PrincipalsDAO.getPrincipal(userId, (error, user) => {
      if (error) {
        return callback(error);
      }

      if (!user.email) {
        log().warn({ userId }, 'Used asked for password reset but has no email address');
        return callback({
          code: 400,
          msg: 'This user has no email address, you will have to ask an admin to reset the password'
        });
      }

      // Generate a secret token
      const secret = crypto.randomBytes(16).toString('hex');

      // The secret is stored for 24 hours
      Cassandra.runQuery(
        'UPDATE "AuthenticationLoginId" USING TTL 86400 SET "secret" = ? WHERE "loginId" = ?',
        [secret, _flattenLoginId(loginId)],
        (error_) => {
          if (error_) {
            log().error({ err: error_ }, 'Error in creating a secret token');
            return callback(error_);
          }

          // Generate the email content with secret token
          const emailData = {
            tenant: ctx.tenant(),
            user,
            username,
            baseUrl: TenantsUtil.getBaseUrl(ctx.tenant()),
            skinVariables: getTenantSkinVariables(ctx.tenant().alias),
            secret
          };

          // Send the email to the user
          EmailAPI.sendEmail('oae-authentication', 'reset', user, emailData, null, callback);
        }
      );
    });
  });
};

/**
 * Reset the password for an user with an existing username and a valid token
 *
 * @param  {Context}    ctx            Standard context object containing the current user and the current tenant
 * @param  {String}     userName       The user's own unique username
 * @param  {String}     token          The token that user generated within 24 hours
 * @param  {String}     newPassword    The new password for the user
 * @param  {Function}   callback       Standard callback function
 * @param  {Object}     callback.err   An error that occurred, if any
 */
const resetPassword = function (ctx, username, secret, newPassword, callback) {
  // Parameter validation
  try {
    unless(isNotEmpty, {
      code: 400,
      msg: 'A username must be provided'
    })(username);

    unless(isNotEmpty, {
      code: 400,
      msg: 'A secret must be provided'
    })(secret);

    unless(isNotEmpty, {
      code: 400,
      msg: 'A new password must be provided'
    })(newPassword);

    unless(isLength, {
      code: 400,
      msg: 'Must specify a password at least 6 characters long'
    })(newPassword, { min: 6 });
  } catch (error) {
    return callback(error);
  }

  // Default to the current tenant's alias
  const tenantAlias = ctx.tenant().alias;

  // Associate the userID with loginID for later operations
  const loginId = new LoginId(tenantAlias, AuthenticationConstants.providers.LOCAL, username);

  // Lookup the database to check whether a token is associated with the current
  Cassandra.runQuery(
    'SELECT "userId", "secret" FROM "AuthenticationLoginId" WHERE "loginId" = ?',
    [_flattenLoginId(loginId)],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      if (_.isEmpty(rows)) {
        // No user found with that login id
        return callback({ code: 401, msg: 'No user found for this login ID' });
      }

      // Get the secret column out of the row
      const dbSecret = rows[0].get('secret');

      // If the secret column was not found or its value didn't match, something is wrong.
      if (!dbSecret || dbSecret !== secret) {
        log().warn({ loginId }, 'Someone tried to use an expired password reset secret');
        return callback({ code: 401, msg: 'The secret was not found or incorrect' });

        // If the secret column was found.
      }

      return _changePassword(loginId, newPassword, callback);
    }
  );
};

/**
 * Hash `newPassword` and store it as the new password for the given `loginId`.
 *
 * @param  {LoginId}   loginId         The login id whose password to change
 * @param  {String}    newPassword     The password to which to change the local login id
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @api private
 */
const _changePassword = function (loginId, newPassword, callback) {
  const hash = AuthenticationUtil.hashPassword(newPassword);
  Cassandra.runQuery(
    'UPDATE "AuthenticationLoginId" SET "password" = ? WHERE "loginId" = ?',
    [hash, _flattenLoginId(loginId)],
    (error) => {
      if (error) {
        log().error({ err: error }, 'Error changing a user password');
        return callback(error);
      }

      return callback();
    }
  );
};

/**
 * Associate the given Login ID info to the specified user. This makes it possible for the associated user to login with the provided
 * login credentials.
 *
 * @param  {LoginId}   loginId         The login id to associate
 * @param  {String}    userId          The id of the user to which to associate the login id
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @api private
 */
const _associateLoginId = function (loginId, userId, callback) {
  loginId.properties = loginId.properties || {};
  const flattenedLoginId = _flattenLoginId(loginId);

  // Sanitize and prepare the columns for the upsert
  delete loginId.properties.loginId;
  loginId.properties.userId = userId;

  const query = Cassandra.constructUpsertCQL(
    'AuthenticationLoginId',
    'loginId',
    flattenedLoginId,
    loginId.properties
  );
  if (query) {
    const queries = [];
    queries.push(query);
    queries.push({
      query:
        'INSERT INTO "AuthenticationUserLoginId" ("userId", "loginId", "value") VALUES (?, ?, ?)',
      parameters: [userId, flattenedLoginId, '1']
    });
    return Cassandra.runBatchQuery(queries, callback);
  }

  log().error(
    {
      loginId,
      userId
    },
    'Error constructing query to associate login id to user'
  );
  return callback({ code: 500, msg: 'Error associating login id to user ' + userId });
};

/**
 * Get the login ids that are mapped to a user.
 *
 * @param  {Context}     ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}      userId              The id of the user
 * @param  {Function}    callback            Standard callback function
 * @param  {Object}      callback.err        An error that occurred, if any
 * @param  {Object}      callback.loginIds   A hash whose keys are the authentication providers, and values are the LoginId objects that are mapped to the user
 */
const getUserLoginIds = function (ctx, userId, callback) {
  // Parameter validation
  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'You have to be logged in to request the login ids for a user'
    })(ctx);
    unless(isUserId, {
      code: 400,
      msg: 'A user id must be provided'
    })(userId);
  } catch (error) {
    return callback(error);
  }

  // Request the user details
  PrincipalsAPI.getUser(ctx, userId, (error, user) => {
    if (error) {
      return callback(error);
    }

    if (!ctx.user().isAdmin(user.tenant.alias)) {
      // Only global administrators and administrators of the tenant the user belongs to can request the login ids
      return callback({
        code: 401,
        msg: 'You are not authorized to request the login ids for this user'
      });
    }

    _getUserLoginIds(userId, (error, _loginIds) => {
      if (error) {
        return callback(error);
      }

      // Only return the strategies and their corresponding external id
      const loginIds = {};
      _.each(_loginIds, (values, strategy) => {
        loginIds[strategy] = values.externalId;
      });

      return callback(null, loginIds);
    });
  });
};

/**
 * Get the login ids that are mapped to a user.
 *
 * @param  {String}      userId              The id of the user
 * @param  {Function}    callback            Standard callback function
 * @param  {Object}      callback.err        An error that occurred, if any
 * @param  {Object}      callback.loginIds   A hash whose keys are the authentication providers, and values are the LoginId objects that are mapped to the user
 * @api private
 */
const _getUserLoginIds = function (userId, callback) {
  if (!userId) {
    return callback(null, {});
  }

  Cassandra.runQuery(
    'SELECT "loginId" FROM "AuthenticationUserLoginId" WHERE "userId" = ?',
    [userId],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      const loginIds = {};
      _.each(rows, (row) => {
        row = Cassandra.rowToHash(row);
        if (row.loginId) {
          const loginId = _expandLoginId(row.loginId);
          loginIds[loginId.provider] = loginId;
        }
      });

      return callback(null, loginIds);
    }
  );
};

/**
 * Gets the userId that is associated to the provided login ID, if any.
 *
 * @param  {LoginId}   loginId         The login id to search
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @param  {String}    callback.userId The id of the user that was associated to the login id, if any
 * @api private
 */
const _getUserIdFromLoginId = function (loginId, callback) {
  Cassandra.runQuery(
    'SELECT "userId" FROM "AuthenticationLoginId" WHERE "loginId" = ?',
    [_flattenLoginId(loginId)],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      if (_.isEmpty(rows)) {
        return callback({ code: 404, msg: 'No user could be found with the provided login id' });
      }

      const result = Cassandra.rowToHash(rows[0]);
      return callback(null, result.userId);
    }
  );
};

/**
 * Flatten a LoginId object into a string representation that can be used for a storage key. This is in the following format:
 *
 * `<tenantAlias>:<authentication provider>:<external id>`
 *
 * @param  {LoginId}   loginId     The login id to flatten
 * @return {String}                The flattened string key representation of the login id
 * @api private
 */
const _flattenLoginId = function (loginId) {
  if (!loginId || !loginId.tenantAlias || !loginId.provider || !loginId.externalId) {
    return null;
  }

  return loginId.tenantAlias + ':' + loginId.provider + ':' + loginId.externalId;
};

/**
 * Expand a flattened key representation of a login id into a LoginId object. This is the opposite of #_flattenLoginId.
 *
 * @param  {String}    loginIdStr  The flat string key representation of the login id
 * @return {LoginId}               The LoginId object that is represented by the flat string
 * @api private
 */
const _expandLoginId = function (loginIdString) {
  if (!loginIdString) {
    return null;
  }

  const loginIdSplit = loginIdString.split(':');
  if (loginIdSplit.length < 3) {
    return null;
  }

  // The externalId can contain *anything*, including colons. keep that in-tact with a slice-and-join.
  return new LoginId(loginIdSplit[0], loginIdSplit[1], loginIdSplit.slice(2).join(':'));
};

/**
 * Verify that the given login ID is suitable to be used to look up a user id mapping.
 *
 * @param  {Validator}       validator   The validator to use to validate the loginId
 * @param  {LoginId}         loginId     The login id to validate
 * @api private
 */
const _validateLoginIdForLookup = function (validator, loginId) {
  // Only validate these if loginId is a valid object
  const ifLoginIsValid = () => Boolean(loginId);
  const getAttribute = getNestedObject(loginId);

  unless(isObject, {
    code: 400,
    msg: 'Must specify a login id'
  })(loginId);

  unless(bothCheck(ifLoginIsValid, isNotEmpty), {
    code: 400,
    msg: 'Must specify a tenant id on the login id'
  })(getAttribute(['tenantAlias']));

  unless(bothCheck(ifLoginIsValid, isNotEmpty), {
    code: 400,
    msg: 'Must specify an authentication provider on the login id'
  })(getAttribute(['provider']));

  unless(bothCheck(ifLoginIsValid, compose(isNotEmpty, String)), {
    code: 400,
    msg: 'Must specify an external id on the login id'
  })(getAttribute(['externalId']));
};

/**
 * Verify that the given login ID is suitable to be persisted to storage.
 *
 * @param  {Validator}       validator   The validator to use to validate the loginId
 * @param  {LoginId}         loginId     The login id to validate
 * @api private
 */
const _validateLoginIdForPersistence = function (validator, loginId, callback) {
  _validateLoginIdForLookup(validator, loginId, callback);

  // Only continue validating if the login id is valid so far
  loginId.properties = loginId.properties || {};
  const password = _.isArray(loginId.properties.password)
    ? loginId.properties.password[0]
    : loginId.properties.password;

  // Custom handling for local authentication (i.e., username and password)
  const isItLocalAuthentication = loginId.provider === AuthenticationConstants.providers.LOCAL;
  unless(bothCheck(isItLocalAuthentication, isLength), {
    code: 400,
    msg: 'Must specify a password at least 6 characters long'
  })(password || '', { min: 6 });
};

/// ////////////////////////////
/// ////////////////////////////
// AUTHENTICATION STRATEGIES //
/// ////////////////////////////
/// ////////////////////////////

/**
 * Register an authentication strategy. A strategy needs to be registered during the start-up phase and will then
 * be made active when the server has fully started up.
 *
 * @param  {String}     strategyName    The name under which this strategy should be registered. This string will be used in the Passport registry mechanism
 * @param  {Strategy}   strategy        The OAE strategy that needs to be registered
 * @throws {Error}                      An error is thrown if another strategy was already registered with the provided strategy name
 */
const registerStrategy = function (strategyName, strategy) {
  if (strategies[strategyName]) {
    throw new Error('Attempted to register duplicate authentication strategy');
  }

  strategies[strategyName] = strategy;
  log().info('Registered authentication strategy "%s"', strategyName);
};

/**
 * Refresh the known passport login strategies for a given tenant. This will be called for all registered tenants upon start-up
 * and when new tenants are being started on the fly.
 *
 * @param  {Tenant} tenant  The tenant for which we want to refresh the authentication capabilities
 */
const refreshStrategies = function (tenant) {
  _.each(strategies, (strategy, strategyName) => {
    // Get the name we used to register this strategy with passport. This is a combination of the tenant and strategy name
    const passportStrategyName = AuthenticationUtil.getStrategyId(tenant, strategyName);

    // Disable the passport strategy if we registered it previously.
    if (passport._strategy(passportStrategyName)) {
      passport.unuse(passportStrategyName);
    }

    // If the tenant wants the strategy enabled, we enable it. We also create a new instance of the passport strategy so that
    // configuration updates to the strategy are taken into account
    if (strategy.shouldBeEnabled(tenant.alias)) {
      passport.use(passportStrategyName, strategy.getPassportStrategy(tenant));
      log().debug(
        {
          tenant: tenant.alias,
          strategy: strategyName,
          passportStrategyName
        },
        'Enabling strategy'
      );
    }
  });

  AuthenticationAPI.emit(AuthenticationConstants.events.REFRESHED_STRATEGIES, tenant);

  log().debug({ tenant }, 'Refreshed authentication strategies for tenant');
};

/**
 * Refreshes all the authentication strategies on all the tenants.
 *
 * @api private
 */
const _refreshAllTenantStrategies = function () {
  const tenants = TenantsAPI.getTenants();

  // Refresh all the tenant auth strategies
  _.each(_.values(tenants), refreshStrategies);
};

/// /////////////////////
/// /////////////////////
// SESSION MANAGEMENT //
/// /////////////////////
/// /////////////////////

/**
 * Log a user out from a session. This method will take care of committing the response object.
 *
 * @param  {Request}    req     The ExpressJS request object
 * @param  {Response}   res     The ExpressJS response object
 */
const logout = function (request, response) {
  if (!request.ctx.user()) {
    return response.status(400).send('You need to be logged in, in order to log out');
  }

  // We need to grab the authentication info before we call `logOut()`
  // as the property would otherwise be removed
  const authInfo = request.oaeAuthInfo;

  // In all cases, we destroy the session within OAE
  request.logout();

  // Emit an event that the user logged out
  AuthenticationAPI.emit(AuthenticationConstants.events.USER_LOGGED_OUT, request.ctx);

  // If the full unique strategy was not made available on the request, there is nothing we can do any further
  if (!authInfo || !authInfo.strategyId) {
    return response.redirect('/');
  }

  // If no strategy name was set on the request we're done
  const passportStrategyName = AuthenticationUtil.parseStrategyId(authInfo.strategyId).strategyName;
  if (!passportStrategyName) {
    return response.redirect('/');
  }

  // If the strategy didn't implement a logout function we're done
  const strategy = strategies[passportStrategyName];
  if (!strategy || !strategy.logout) {
    return response.redirect('/');
  }

  // If the strategy implemented a logout function, they can take care of the further request cycle
  return strategy.logout(request, response);
};

export {
  emitter,
  init,
  localUsernameExists,
  getOrCreateGlobalAdminUser,
  getOrCreateUser,
  createTenantAdminUser,
  createUser,
  associateLoginId,
  changePassword,
  checkPassword,
  getUserIdFromLoginId,
  getResetPasswordSecret,
  resetPassword,
  getUserLoginIds,
  registerStrategy,
  refreshStrategies,
  logout
};
