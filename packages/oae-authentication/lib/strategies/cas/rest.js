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

import * as OAE from 'oae-util/lib/oae.js';

import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationUtil from 'oae-authentication/lib/util.js';

/**
 * @REST postAuthCas
 *
 * Log in using CAS authentication
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /auth/cas
 * @Return      {void}
 * @HttpResponse                302         The user will be redirected to the CAS server where they can log in
 * @HttpResponse                400         The CAS authentication strategy is disabled for this tenant
 */
OAE.tenantRouter.on('post', '/api/auth/cas', (request, response, next) => {
  // Get the ID under which we registered this strategy for this tenant
  const strategyId = AuthenticationUtil.getStrategyId(
    request.tenant,
    AuthenticationConstants.providers.CAS
  );

  // Perform the initial authentication step
  AuthenticationUtil.handleExternalSetup(strategyId, null, request, response, next);
});

/**
 * @REST getAuthCasCallback
 *
 * Callback URL after the user has logged in using CAS authentication
 *
 * @Api         private
 * @Server      tenant
 * @Method      POST
 * @Path        /auth/cas/callback
 * @Return      {void}
 */
OAE.tenantRouter.on('get', '/api/auth/cas/callback', (request, response, next) => {
  // Get the ID under which we registered this strategy for this tenant
  const strategyId = AuthenticationUtil.getStrategyId(
    request.tenant,
    AuthenticationConstants.providers.CAS
  );

  // Log the user in
  AuthenticationUtil.handleExternalCallback(strategyId, request, response, next);
});

export { OAE as default };
