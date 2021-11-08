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

import { format } from 'node:util';
import fastifyPassport from 'fastify-passport';

import { logger } from 'oae-logger';
import * as OAE from 'oae-util/lib/oae.js';

import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationUtil from 'oae-authentication/lib/util.js';
import * as ShibbolethAPI from './api.js';

const log = logger('shibboleth');

/**
 * @REST postAuthShibbolethTenant
 *
 * Log in using Shibboleth authentication
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /auth/shibboleth
 * @Return      {void}
 */
OAE.tenantRouter.on('post', '/api/auth/shibboleth', (request, response) => {
  if (!ShibbolethAPI.isEnabled(request.tenant.alias)) {
    return response.redirect('/?authentication=disabled');
  }

  // Get the URL to which the user should be redirected and store it in a cookie,
  // so we can retrieve it once the user returns from the identity provider
  const redirectUrl = AuthenticationUtil.validateRedirectUrl(request.body.redirectUrl);
  response.cookie('redirectUrl', redirectUrl);

  // Redirect the user to our SP host
  const serviceProviderUrl = ShibbolethAPI.getServiceProviderUrl(request.ctx);
  response.redirect(serviceProviderUrl);
});

/**
 * @REST getAuthShibbolethSp
 *
 * Forward the user to the configured identity provider
 *
 * @Api         private
 * @Server      tenant
 * @Method      GET
 * @Path        /auth/shibboleth/sp
 * @QueryParam  {string}                [tenantAlias]         The alias of the tenant on which the user wants to authenticate
 * @QueryParam  {string}                [signature]           The signature for the tenant alias
 * @QueryParam  {number}                [expires]             The timestamp (millis since epoch) at which the signature expires
 * @Return      {void}
 */
OAE.tenantRouter.on('get', '/api/auth/shibboleth/sp', (request, response, next) => {
  if (ShibbolethAPI.getSPHost() !== request.hostname) {
    return response.status(501).send('This endpoint is not enabled on a regular tenant');
  }

  const { tenantAlias, signature, expires } = request.query;

  // Validate the parameters
  ShibbolethAPI.validateInitiateParameters(tenantAlias, signature, expires, (error, tenant) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    // Keep track of the tenant from which the user originated
    response.cookie('shibboleth', tenantAlias, { signed: true });

    // Get the ID under which this strategy was registered for this tenant
    const strategyId = AuthenticationUtil.getStrategyId(
      tenant,
      AuthenticationConstants.providers.SHIBBOLETH
    );

    // Perform the initial authentication step
    AuthenticationUtil.handleExternalSetup(strategyId, null, request, response, next);
  });
});

/*!
 * The user comes back from the IdP and lands on our service provider endpoint.
 * If authentication was succesful, the user will be redirected to their tenant at
 * `/api/auth/shibboleth/callback`. This endpoint is NOT accessible from the outside world
 */

/**
 * @REST getAuthShibbolethSpCallback
 *
 * Authenticate the user and redirects back to the originating tenant
 *
 * @Api         private
 * @Server      tenant
 * @Method      GET
 * @Path        /auth/shibboleth/sp/callback
 * @Return      {void}
 */
OAE.tenantRouter.on('get', '/api/auth/shibboleth/sp/callback', (request, response) => {
  if (ShibbolethAPI.getSPHost() !== request.hostname) {
    return response.status(501).send('This endpoint is not enabled on a regular tenant');
  }

  // Get the alias of the tenant this user originated from
  const tenantAlias = request.signedCookies.shibboleth;

  // Remove the cookie
  response.clearCookie('shibboleth');

  // Get the full tenant object to allow for the full URL to be constructed
  ShibbolethAPI.getShibbolethEnabledTenant(tenantAlias, (error, tenant) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    // The base url for the tenant
    const tenantUrl = format('https://%s', tenant.host);

    // Get the Shibboleth strategy
    const strategyId = AuthenticationUtil.getStrategyId(
      tenant,
      AuthenticationConstants.providers.SHIBBOLETH
    );

    // Validate and authenticate the request
    fastifyPassport.authenticate(strategyId, {}, (error, user, challenges, status) => {
      if (error) {
        log().error({ err: error, tenantAlias }, 'Error during Shibboleth authentication');
        return response.redirect(tenantUrl + '/?authentication=failed&reason=error');
      }

      if (!user) {
        // The user's credentials didn't check out. This would rarely occur in a
        // normal situation as external auth providers don't usually redirect with
        // bad parameters in the request, so somebody is probably tampering with it.
        // We bail out immediately
        log().warn(
          { challenges, status },
          'Possible tampering of external callback request detected'
        );
        return response.redirect(tenantUrl + '/?authentication=failed&reason=tampering');
      }

      // The user's authentication credentials are correct and the user was created
      // or retrieved from the database. Send the user back to their own tenant and pass
      // along their user id
      const redirectUrl = ShibbolethAPI.getAuthenticatedUserRedirectUrl(tenant, user);
      response.redirect(redirectUrl);
    })(request, response);
  });
});

/**
 * @REST getAuthShibbolethTenantCallback
 *
 * Redirect an authenticated user to the home page
 *
 * @Api         private
 * @Server      tenant
 * @Method      GET
 * @Path        /auth/shibboleth/callback
 * @QueryParam  {string}                [userId]            The id of the user that needs to be signed in
 * @QueryParam  {string}                [signature]         The signature for the user id
 * @QueryParam  {number}                [expires]           The timestamp (millis since epoch) at which the signature expires
 * @Return      {void}
 */
OAE.tenantRouter.on('get', '/api/auth/shibboleth/callback', (request, response, next) => {
  if (!ShibbolethAPI.isEnabled(request.tenant.alias)) {
    return response.redirect('/?authentication=disabled');
  }

  // Get the user from the database
  const { signature, expires, userId } = request.query;
  ShibbolethAPI.getUser(request.tenant, userId, signature, expires, (error, user) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    // Log the user in
    const strategyId = AuthenticationUtil.getStrategyId(
      request.tenant,
      AuthenticationConstants.providers.SHIBBOLETH
    );
    return AuthenticationUtil.handleLogin(strategyId, user, request, response, next);
  });
});

export { OAE as default };
