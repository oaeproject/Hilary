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

import * as ConfigAPI from 'oae-config';
import * as OAE from 'oae-util/lib/oae.js';
import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationUtil from 'oae-authentication/lib/util.js';

const AuthenticationConfig = ConfigAPI.setUpConfig('oae-authentication');

/**
 * @REST postAuthGoogle
 *
 * Log in using Google authentication
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /auth/google
 * @Return      {void}
 * @HttpResponse                302         The user will be redirected to Google where they can log in
 * @HttpResponse                400         The authentication strategy is disabled for this tenant
 */
OAE.tenantRouter.on('post', '/api/auth/google', (request, response, next) => {
  // Get the ID under which we registered this strategy for this tenant
  const strategyId = AuthenticationUtil.getStrategyId(
    request.tenant,
    AuthenticationConstants.providers.GOOGLE
  );

  const options = {
    // To avoid authenticating with the wrong Google account, we give the user the opportunity to select or add
    // the correct account during the OAuth authentication cycle
    prompt: 'select_account'
  };

  // If there's only one allowed domain, add that to options as the hosted domain
  // @see https://developers.google.com/identity/protocols/OpenIDConnect#authenticationuriparameters
  const domains = AuthenticationConfig.getValue(
    request.tenant.alias,
    AuthenticationConstants.providers.GOOGLE,
    'domains'
  ).split(',');

  if (domains && domains.length === 1) {
    options.hd = domains[0];
  }

  // Perform the initial authentication step
  AuthenticationUtil.handleExternalSetup(strategyId, options, request, response, next);
});

/**
 * @REST getAuthGoogleCallback
 *
 * Callback URL after the user has logged in using Google authentication
 *
 * @Api         private
 * @Server      tenant
 * @Method      POST
 * @Path        /auth/google/callback
 * @Return      {void}
 */
OAE.tenantRouter.on('get', '/api/auth/google/callback', (request, response, next) => {
  // Get the ID under which we registered this strategy for this tenant
  const strategyId = AuthenticationUtil.getStrategyId(
    request.tenant,
    AuthenticationConstants.providers.GOOGLE
  );

  // Log the user in
  AuthenticationUtil.handleExternalCallback(strategyId, request, response, next);
});

export { OAE as default };
