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

import passport from 'passport';

import * as OAE from 'oae-util/lib/oae.js';
import * as OaeServer from 'oae-util/lib/server.js';

import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationSignedUtil from 'oae-authentication/lib/strategies/signed/util.js';
import * as AuthenticationUtil from 'oae-authentication/lib/util.js';

// Ensure that the signed auth URL bypass CSRF validation.
// It has its own authenticity handling.
OaeServer.addSafePathPrefix('/api/auth/signed');

/**
 * @REST getAuthSignedTenant
 *
 * Get the request information for a global administrator to log into a tenant
 *
 * @Server      admin
 * @Method      GET
 * @Path        /auth/signed/tenant
 * @QueryParam  {string}            tenant          The alias of the tenant on which to log in
 * @Return      {SignedAuthInfo}                    Request information needed to log into the tenant
 * @HttpResponse                    200             request information available
 * @HttpResponse                    400             Missing target tenant alias
 * @HttpResponse                    401             Only global administrators are allowed to authenticate to other tenants
 * @HttpResponse                    401             You cannot create a signed authentication token to a tenant while impostering another user
 * @HttpResponse                    404             There is no tenant with alias ...
 */
OAE.globalAdminRouter.on('get', '/api/auth/signed/tenant', (request, response) => {
  AuthenticationSignedUtil.getSignedTenantAuthenticationRequest(
    request.ctx,
    request.query.tenant,
    (error, requestInfo) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).send(requestInfo);
    }
  );
});

/*!
 * Convenience function to handle the `/api/auth/signed/become` routes for both
 * the admin router and tenant router
 *
 * @param  {Request}    req     Express Request object of the request
 * @param  {Response}   res     Express Response object on which to send the response
 */
const _getBecomeUserAuthenticationRequestInfo = function (request, response) {
  AuthenticationSignedUtil.getSignedBecomeUserAuthenticationRequest(
    request.ctx,
    request.query.becomeUserId,
    (error, requestInfo) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).send(requestInfo);
    }
  );
};

/**
 * @REST getAuthSignedBecome
 *
 * Get the request information for an administrator to become a user
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /auth/signed/become
 * @QueryParam  {string}            becomeUserId    The id of the user to become
 * @Return      {SignedAuthInfo}                    Request information needed to become the user
 * @HttpResponse                    200             request information available
 * @HttpResponse                    400             Must specific a valid user id of a user to become becomeUserId
 * @HttpResponse                    401             Must be authenticated in order to become another user
 * @HttpResponse                    401             Only administrators can become a user
 * @HttpResponse                    401             Only global administrators can become other administrators
 * @HttpResponse                    401             You are not authorized to become this user
 * @HttpResponse                    401             You cannot become a user while impostering another user
 */
OAE.globalAdminRouter.on('get', '/api/auth/signed/become', _getBecomeUserAuthenticationRequestInfo);
OAE.tenantRouter.on('get', '/api/auth/signed/become', _getBecomeUserAuthenticationRequestInfo);

/**
 * @REST postAuthSigned
 *
 * Log in using signed authentication
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /auth/signed
 * @BodyParam   {SignedAuthBody}    body            The request information acquired from the `GET /api/auth/signed/*` endpoint
 * @Return      {void}
 * @HttpResponse                200                 Login succeeded
 * @HttpResponse                401                 Unauthorized
 */
OAE.tenantRouter.on('post', '/api/auth/signed', (request, response, next) => {
  // Get the ID under which we registered this strategy for this tenant
  const strategyId = AuthenticationUtil.getStrategyId(
    request.tenant,
    AuthenticationConstants.providers.SIGNED
  );

  // Authenticate this request using the information
  passport.authenticate(strategyId, { successRedirect: '/', failureRedirect: '/' })(
    request,
    response,
    next
  );
});

export { OAE as default };
