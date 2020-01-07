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
import _ from 'underscore';

import * as PrincipalsDAO from 'oae-principals/lib/internal/dao';
import * as Signature from 'oae-util/lib/signature';
import * as TenantsAPI from 'oae-tenants';
import * as TenantsUtil from 'oae-tenants/lib/util';
import { Validator as validator } from 'oae-authz/lib/validator';
import pipe from 'ramda/src/pipe';

const TIME_1_MINUTE_IN_SECONDS = 60;

/**
 * Create request information that a global administrator can use to authenticate as themself to a particular tenant.
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}     tenantAlias                 The target tenant alias to which the global admin is trying to authenticate
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.requestInfo        The request info the global admin user can use to POST to a tenant and gain access as themself
 * @param  {String}     callback.requestInfo.url    The full URL to POST to (protocol, host and path) in order to invoke the signed auth request
 * @param  {Object}     callback.requestInfo.body   The signed body of the POST request to send in order to verify the authenticity of the authentication request
 */
const getSignedTenantAuthenticationRequest = function(ctx, tenantAlias, callback) {
  pipe(
    validator.isGlobalAdministratorUser,
    validator.generateError({
      code: 401,
      msg: 'Only global administrators are allowed to authenticate to other tenants'
    }),
    validator.finalize(callback)
  )(ctx);

  pipe(
    validator.isNotEmpty,
    validator.generateError({
      code: 400,
      msg: 'Missing target tenant alias'
    }),
    validator.finalize(callback)
  )(tenantAlias);

  if (ctx.imposter()) {
    return callback({
      code: 401,
      msg: 'You cannot create a signed authentication token to a tenant while impostering another user'
    });
  }

  const targetTenant = TenantsAPI.getTenant(tenantAlias);
  if (!targetTenant) {
    return callback({
      code: 404,
      msg: util.format('There is no tenant with alias "%s"', tenantAlias)
    });
  }

  const data = { tenantAlias, userId: ctx.user().id };
  const signedData = Signature.createExpiringSignature(data, TIME_1_MINUTE_IN_SECONDS, TIME_1_MINUTE_IN_SECONDS);

  // Include the authenticating `userId` in the signed data. It isn't necessary to include the tenant alias in
  // the body, as we can assume that from the target context during the verification phase, so we omit it from
  // the signed data to avoid confusion
  signedData.userId = data.userId;

  return callback(null, {
    url: _getSignedAuthenticationUrl(targetTenant),
    body: _.omit(signedData, 'tenantAlias')
  });
};

/**
 * Create request information that an administrator can use to authenticate themself as a different user.
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}     becomeUserId                The id of the user the administrator is requesting to become
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.requestInfo        The request info that the administrator can use to POST to a tenant and gain access as the `becomeUserId`
 * @param  {String}     callback.requestInfo.url    The full URL to POST to (protocol, host and path) in order to invoke the signed auth request
 * @param  {Object}     callback.requestInfo.body   The signed body of the POST request to send in order to verify the authenticity of the authentication request
 */
const getSignedBecomeUserAuthenticationRequest = function(ctx, becomeUserId, callback) {
  pipe(
    validator.isLoggedInUser,
    validator.generateError({
      code: 401,
      msg: 'Must be authenticated in order to become another user'
    }),
    validator.finalize(callback)
  )(ctx);

  pipe(
    validator.isUserId,
    validator.generateError({
      code: 400,
      msg: 'Must specific a valid user id of a user to become (becomeUserId)'
    }),
    validator.finalize(callback)
  )(becomeUserId);

  if (!ctx.user().isAdmin(ctx.user().tenant.alias)) {
    // Only users who have an admin status can become someone. This check is redundant to
    // the check that verifies the current user is an admin of the target user's tenant,
    // however this can be done before we go to the database
    return callback({ code: 401, msg: 'Only administrators can become a user' });
  }

  if (ctx.imposter()) {
    // If the session is already impostering someone, they cannot imposter someone else.
    // For example: Global admin imposters a tenant administrator, then further imposters
    // another user. In this scenario, you would lose the information that global admin
    // was impostering the tenant admin
    return callback({ code: 401, msg: 'You cannot become a user while impostering another user' });
  }

  // Ensure the user exists and that the current user can become that user
  PrincipalsDAO.getPrincipal(becomeUserId, (err, becomeUser) => {
    if (err) {
      return callback(err);
    }

    if (!ctx.user().isAdmin(becomeUser.tenant.alias)) {
      // The current user must be an admin of the target user's tenant in order to become them
      return callback({ code: 401, msg: 'You are not authorized to become this user' });
    }

    if (becomeUser.isAdmin(becomeUser.tenant.alias) && !ctx.user().isGlobalAdmin()) {
      // If the target user is a tenant admin, only the global admin can become them
      return callback({
        code: 401,
        msg: 'Only global administrators can become other administrators'
      });
    }

    // Authorization and validation is all successful. Create the signature
    const targetTenant = TenantsAPI.getTenant(becomeUser.tenant.alias);
    const data = {
      tenantAlias: targetTenant.alias,
      userId: ctx.user().id,
      becomeUserId
    };
    const signedData = Signature.createExpiringSignature(data, TIME_1_MINUTE_IN_SECONDS, TIME_1_MINUTE_IN_SECONDS);

    // Include the authenticating `userId` and target `becomeUserId` in the signed data. It isn't necessary to
    // include the tenant alias in the body, as we can assume that from the target context during the verification
    // phase, so we omit it from the signed data to avoid confusion
    signedData.userId = data.userId;
    signedData.becomeUserId = data.becomeUserId;

    return callback(null, { url: _getSignedAuthenticationUrl(targetTenant), body: signedData });
  });
};

/**
 * Verify the authenticity of a signed authentication request
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {Object}     body                        The POST data that was sent with the request
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {String}     callback.userId             The id of the user who is performing the authentication (also thought of as "the user who was granted the authentication signature")
 * @param  {String}     [callback.becomeUserId]     The id of the user who the authenticating user should become, if any
 */
const verifySignedAuthenticationBody = function(ctx, body, callback) {
  pipe(
    validator.isUserId,
    validator.generateError({
      code: 400,
      msg: 'Invalid user id provided as the authenticating user'
    }),
    validator.finalize(callback)
  )(body.userId);

  // Verify all the signed data in the request body, except the `signature` and `expires` parameters which are
  // not part of the signed data object. Include the tenant alias to ensure that the signature is being used
  // at the expected target tenant
  const data = _.chain({})
    .extend(body, { tenantAlias: ctx.tenant().alias })
    .omit('signature', 'expires')
    .value();

  // Verify the signature is authentic and not expired
  if (!Signature.verifyExpiringSignature(data, body.expires, body.signature)) {
    return callback({ code: 401, msg: 'Invalid signature credentials' });
  }

  // This is a valid request, extract the data from it so the consumer doesn't have to understand the
  // anatomy of the signature object
  return callback(null, data.userId, data.becomeUserId);
};

/**
 * Get the signed authentication URI (protocol, host, port, path) for a given tenant
 *
 * @param  {Tenant}     tenant  The tenant for which to get the signed authentication URI
 * @return {String}             The signed authentication URI (e.g., "https://my.oaetenant.com:8443/api/auth/signed")
 * @api private
 */
const _getSignedAuthenticationUrl = function(tenant) {
  return util.format('%s/api/auth/signed', TenantsUtil.getBaseUrl(tenant));
};

export {
  getSignedTenantAuthenticationRequest,
  getSignedBecomeUserAuthenticationRequest,
  verifySignedAuthenticationBody
};
