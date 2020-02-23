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

import * as PrincipalsDAO from 'oae-principals/lib/internal/dao';
import * as Signature from 'oae-util/lib/signature';
import * as TenantsAPI from 'oae-tenants/lib/api';
import { Validator as validator } from 'oae-util/lib/validator';
const { isDefined, unless, dateIsIntoTheFuture, isNotEmpty, isInt } = validator;
import { compose } from 'ramda';

import { AuthenticationConstants } from 'oae-authentication/lib/constants';
import { setUpConfig } from 'oae-config';

const AuthenticationConfig = setUpConfig('oae-authentication');

let config = null;

/**
 * Refresh the shibboleth configuration
 *
 * @param  {Object}     _config     The configuration object as defined in `config.js`
 */
const refreshConfiguration = function(_config) {
  config = _config;
};

/**
 * Get the hostname of the "tenant" that is exposing the SP logic
 *
 * @return {String}     The hostname of the "tenant" that is exposing the SP logic
 */
const getSPHost = function() {
  return config.servers.shibbolethSPHost;
};

/**
 * Whether or not the Shibboleth authentication strategy is enabled for a given tenant
 *
 * @param  {String}     tenantAlias     The alias of the tenant for which to check if the Shibboleth strategy is enabled
 * @return {Boolean}                    `true` if the strategy is enabled, `false` otherwise
 */
const isEnabled = function(tenantAlias) {
  return AuthenticationConfig.getValue(tenantAlias, AuthenticationConstants.providers.SHIBBOLETH, 'enabled');
};

/**
 * Get the url to the Shibboleth Service Provider.
 *
 * @param  {Context}    ctx     Standard context object containing the current user and the current tenant
 * @return {String}             The URL to the Shibboleth Service Provider
 */
const getServiceProviderUrl = function(ctx) {
  // The URL at which the Shibboleth SP software (`Apache` + `mod_shib`) is running
  const spURL = util.format('https://%s', getSPHost());

  // Generate a signature
  const data = { tenantAlias: ctx.tenant().alias };
  const signature = Signature.createExpiringSignature(data, 60, 60);

  // Create and return the full URL
  return util.format(
    '%s/api/auth/shibboleth/sp?tenantAlias=%s&signature=%s&expires=%s',
    spURL,
    ctx.tenant().alias,
    signature.signature,
    signature.expires
  );
};

/**
 * Validate the given `tenantAlias` and `signature` parameters. This method will ensure
 * that a tenant with the given `tenantAlias` exists and has enabled Shibboleth as
 * one of their authentication strategies.
 *
 * @param  {String}     tenantAlias         The alias of the tenant to validate and retrieve
 * @param  {String}     signature           The signature for the tenant alias
 * @param  {Number}     expires             When the signature expires (in ms since epoch)
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error object, if any
 * @param  {Tenant}     callback.tenant     The full tenant object for the given tenant alias
 */
const validateInitiateParameters = function(tenantAlias, signature, expires, callback) {
  try {
    unless(isNotEmpty, {
      code: 400,
      msg: 'Missing tenant alias parameter'
    })(tenantAlias);

    unless(isNotEmpty, {
      code: 400,
      msg: 'Missing signature parameter'
    })(signature);

    unless(compose(isNotEmpty, String), {
      code: 400,
      msg: 'Missing expires parameter'
    })(expires);

    unless(isDefined, {
      code: 400,
      msg: 'Invalid expires parameter'
    })(expires);

    unless(isInt, {
      code: 400,
      msg: 'Invalid expires parameter'
    })(expires);

    unless(dateIsIntoTheFuture, {
      code: 400,
      msg: 'Invalid expires parameter'
    })(expires);
  } catch (error) {
    return callback(error);
  }

  const data = { tenantAlias };
  const isValid = Signature.verifyExpiringSignature(data, expires, signature);
  if (!isValid) {
    return callback({ code: 401, msg: 'Invalid or missing signature parameters' });
  }

  return getShibbolethEnabledTenant(tenantAlias, callback);
};

/**
 * Given a `tenantAlias`, get the full tenant object. This method
 * will perform some extra validation such as checking whether a tenant
 * with that tenant alias exists and whether Shibboleth is enabled for
 * the specified tenant
 *
 * @param  {String}     tenantAlias         The alias of the tenant to retrieve
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error object, if any
 * @param  {Tenant}     callback.tenant     The full tenant object for the given tenant alias
 */
const getShibbolethEnabledTenant = function(tenantAlias, callback) {
  const tenant = TenantsAPI.getTenant(tenantAlias);
  if (!tenant) {
    return callback({ code: 400, msg: 'An unknown tenant was specified' });
  }

  if (!isEnabled(tenant.alias)) {
    return callback({ code: 400, msg: 'Shibboleth is not enabled for this tenant' });
  }

  return callback(null, tenant);
};

/**
 * Get the URL to which a user should be redirected to once `mod_shib` has
 * validated the request. This URL will contain a signed user ID
 *
 * @param  {Tenant}     tenant      The tenant to which the users should be redirected back
 * @param  {User}       user        The user object identifying the user who should be authenticated on the tenant
 * @return {String}                 The full URL to which the user should be redirected
 */
const getAuthenticatedUserRedirectUrl = function(tenant, user) {
  const data = { userId: user.id };
  const signature = Signature.createExpiringSignature(data, 60, 60);
  return util.format(
    'https://%s/api/auth/shibboleth/callback?userId=%s&signature=%s&expires=%s',
    tenant.host,
    user.id,
    signature.signature,
    signature.expires
  );
};

/**
 * Get a user by its ID. A signature is passed in that will be validated prior
 * to retrieving the user object
 *
 * @param  {Tenant}     tenant              The tenant on which the user resides
 * @param  {String}     userId              The id of the user that should be retrieved
 * @param  {String}     signature           The signature for the tenant alias
 * @param  {Number}     expires             When the signature expires (in ms since epoch)
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error object, if any
 * @param  {User}       callback.user       The retrieved user
 */
const getUser = function(tenant, userId, signature, expires, callback) {
  try {
    unless(isNotEmpty, {
      code: 400,
      msg: 'Missing user id parameter'
    })(userId);

    unless(isNotEmpty, {
      code: 400,
      msg: 'Missing signature parameter'
    })(signature);

    unless(compose(isNotEmpty, String), {
      code: 400,
      msg: 'Missing expires parameter'
    })(expires);

    unless(isDefined, {
      code: 400,
      msg: 'Invalid expires parameter'
    })(expires);

    unless(isInt, {
      code: 400,
      msg: 'Invalid expires parameter'
    })(expires);

    unless(dateIsIntoTheFuture, {
      code: 400,
      msg: 'Invalid expires parameter'
    })(expires);
  } catch (error) {
    return callback(error);
  }

  const data = { userId };
  const isValid = Signature.verifyExpiringSignature(data, expires, signature);
  if (!isValid) {
    return callback({ code: 401, msg: 'Invalid or missing signature parameters' });
  }

  // Ensure shibboleth is enabled on this tenant
  getShibbolethEnabledTenant(tenant.alias, err => {
    if (err) {
      return callback(err);
    }

    // Get the user object
    PrincipalsDAO.getPrincipal(userId, (err, user) => {
      if (err) {
        return callback(err);
      }

      if (user.deleted) {
        return callback({
          code: 401,
          msg: util.format('Target user has been deleted: %s', userId)
        });
      }

      return callback(null, user);
    });
  });
};

export {
  refreshConfiguration,
  getSPHost,
  isEnabled,
  getServiceProviderUrl,
  validateInitiateParameters,
  getShibbolethEnabledTenant,
  getAuthenticatedUserRedirectUrl,
  getUser
};
