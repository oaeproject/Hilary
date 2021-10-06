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

import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationUtil from 'oae-authentication/lib/util.js';

/**
 * Log in using LDAP
 *
 * @param  {Request}    req     The express request object
 * @param  {Response}   res     The express response object
 * @api private
 */
const _handleLDAPAuthentication = function (request, response, next) {
  const strategyId = AuthenticationUtil.getStrategyId(
    request.tenant,
    AuthenticationConstants.providers.LDAP
  );
  const errorHandler = AuthenticationUtil.handlePassportError(request, response, next);
  passport.authenticate(strategyId)(request, response, errorHandler);
};

/**
 * @REST postAuthLdap
 *
 * Log in using LDAP authentication
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /auth/ldap
 * @Return      {User}         The logged in user
 * @HttpResponse                200         The user succesfully logged in
 * @HttpResponse                401         Incorrect credentials were provided
 */
OAE.tenantRouter.on('post', '/api/auth/ldap', _handleLDAPAuthentication, (request, response) =>
  // This callback only gets called when we log in succesfully.
  response.status(200).send(request.ctx.user())
);

export default OAE;
