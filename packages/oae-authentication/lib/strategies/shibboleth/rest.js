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
import passport from 'passport';

import { logger } from 'oae-logger';
import * as OAE from 'oae-util/lib/oae';

import { AuthenticationConstants } from 'oae-authentication/lib/constants';
import * as AuthenticationUtil from 'oae-authentication/lib/util';
import * as ShibbolethAPI from './api';

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
OAE.tenantRouter.on('post', '/api/auth/shibboleth', (req, res) => {
  if (!ShibbolethAPI.isEnabled(req.tenant.alias)) {
    return res.redirect('/?authentication=disabled');
  }

  // Get the URL to which the user should be redirected and store it in a cookie,
  // so we can retrieve it once the user returns from the identity provider
  const redirectUrl = AuthenticationUtil.validateRedirectUrl(req.body.redirectUrl);
  res.cookie('redirectUrl', redirectUrl);

  // Redirect the user to our SP host
  const serviceProviderUrl = ShibbolethAPI.getServiceProviderUrl(req.ctx);
  res.redirect(serviceProviderUrl);
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
OAE.tenantRouter.on('get', '/api/auth/shibboleth/sp', (req, res, next) => {
  if (ShibbolethAPI.getSPHost() !== req.hostname) {
    return res.status(501).send('This endpoint is not enabled on a regular tenant');
  }

  const { tenantAlias, signature, expires } = req.query;

  // Validate the parameters
  ShibbolethAPI.validateInitiateParameters(tenantAlias, signature, expires, (err, tenant) => {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Keep track of the tenant from which the user originated
    res.cookie('shibboleth', tenantAlias, { signed: true });

    // Get the ID under which this strategy was registered for this tenant
    const strategyId = AuthenticationUtil.getStrategyId(tenant, AuthenticationConstants.providers.SHIBBOLETH);

    // Perform the initial authentication step
    AuthenticationUtil.handleExternalSetup(strategyId, null, req, res, next);
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
OAE.tenantRouter.on('get', '/api/auth/shibboleth/sp/callback', (req, res) => {
  if (ShibbolethAPI.getSPHost() !== req.hostname) {
    return res.status(501).send('This endpoint is not enabled on a regular tenant');
  }

  // Get the alias of the tenant this user originated from
  const tenantAlias = req.signedCookies.shibboleth;

  // Remove the cookie
  res.clearCookie('shibboleth');

  // Get the full tenant object to allow for the full URL to be constructed
  ShibbolethAPI.getShibbolethEnabledTenant(tenantAlias, (err, tenant) => {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // The base url for the tenant
    const tenantUrl = util.format('https://%s', tenant.host);

    // Get the Shibboleth strategy
    const strategyId = AuthenticationUtil.getStrategyId(tenant, AuthenticationConstants.providers.SHIBBOLETH);

    // Validate and authenticate the request
    passport.authenticate(strategyId, {}, (err, user, challenges, status) => {
      if (err) {
        log().error({ err, tenantAlias }, 'Error during Shibboleth authentication');
        return res.redirect(tenantUrl + '/?authentication=failed&reason=error');
      }

      if (!user) {
        // The user's credentials didn't check out. This would rarely occur in a
        // normal situation as external auth providers don't usually redirect with
        // bad parameters in the request, so somebody is probably tampering with it.
        // We bail out immediately
        log().warn({ challenges, status }, 'Possible tampering of external callback request detected');
        return res.redirect(tenantUrl + '/?authentication=failed&reason=tampering');
      }

      // The user's authentication credentials are correct and the user was created
      // or retrieved from the database. Send the user back to their own tenant and pass
      // along their user id
      const redirectUrl = ShibbolethAPI.getAuthenticatedUserRedirectUrl(tenant, user);
      res.redirect(redirectUrl);
    })(req, res);
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
OAE.tenantRouter.on('get', '/api/auth/shibboleth/callback', (req, res, next) => {
  if (!ShibbolethAPI.isEnabled(req.tenant.alias)) {
    return res.redirect('/?authentication=disabled');
  }

  // Get the user from the database
  const { signature, expires, userId } = req.query;
  ShibbolethAPI.getUser(req.tenant, userId, signature, expires, (err, user) => {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    // Log the user in
    const strategyId = AuthenticationUtil.getStrategyId(req.tenant, AuthenticationConstants.providers.SHIBBOLETH);
    return AuthenticationUtil.handleLogin(strategyId, user, req, res, next);
  });
});

export default OAE;
