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

import * as AuthenticationAPI from 'oae-authentication';
import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationUtil from 'oae-authentication/lib/util.js';

/**
 * @REST postAuthLogin
 *
 * Log in using local authentication
 *
 * @Server      admin,tenant
 * @Method      POST
 * @Path        /auth/login
 * @FormParam   {string}        password                    The password for the user
 * @FormParam   {string}        username                    The username for the user
 * @Return      {User}                                      The logged in user
 * @HttpResponse                200                         Login succeeded
 * @HttpResponse                401                         Unauthorized
 */
const _handleLocalAuthentication = function (request, response, next) {
  const strategyId = AuthenticationUtil.getStrategyId(
    request.tenant,
    AuthenticationConstants.providers.LOCAL
  );
  const errorHandler = AuthenticationUtil.handlePassportError(request, response, next);
  passport.authenticate(strategyId)(request, response, errorHandler);
};

/**
 * Callback after the user has logged in using local authentication
 *
 * @param  {Request}            req                         The express request object
 * @param  {User}               req.oaeAuthInfo.user        The authenticated user
 * @param  {Response}           res                         The express response object
 * @api private
 */
const _handleLocalAuthenticationSuccess = function (request, response) {
  // Simply return a 200 response with the user object
  response.status(200).send(request.oaeAuthInfo.user);
};

OAE.globalAdminRouter.on('post', '/api/auth/login', [
  _handleLocalAuthentication,
  _handleLocalAuthenticationSuccess
]);
OAE.tenantRouter.on('post', '/api/auth/login', [
  _handleLocalAuthentication,
  _handleLocalAuthenticationSuccess
]);

/**
 * @REST postUserIdPassword
 *
 * Change a user's local password
 *
 * @Server      admin,tenant
 * @Method      POST
 * @Path        /user/{userId}/password
 * @PathParam   {string}        userId                      The id of user for which to change the local password
 * @FormParam   {string}        newPassword                 The new password for the user
 * @FormParam   {string}        [oldPassword]               The previous password for the user. This is only required when the current user is not an administrator
 * @Return      {void}
 * @HttpResponse                200                         Password changed
 * @HttpResponse                400                         A new password must be provided
 * @HttpResponse                400                         A password must be provided
 * @HttpResponse                400                         A user id must be provided
 * @HttpResponse                400                         A username must be provided
 * @HttpResponse                400                         User does not have a local account mapping
 * @HttpResponse                401                         You have to be logged in to be able to change a password
 * @HttpResponse                401                         You're not authorized to change this user's password
 */
const _handleChangePassword = function (request, response) {
  AuthenticationAPI.changePassword(
    request.ctx,
    request.params.userId,
    request.body.oldPassword,
    request.body.newPassword,
    (error) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.sendStatus(200);
    }
  );
};

OAE.globalAdminRouter.on('post', '/api/user/:userId/password', _handleChangePassword);
OAE.tenantRouter.on('post', '/api/user/:userId/password', _handleChangePassword);

/**
 * Determine if a local username already exists
 *
 * @param  {Request}            req                         The express request object
 * @param  {Context}            req.ctx                     The context of the current request
 * @param  {String}             req.params.username         The username to check existence for
 * @param  {String}             [req.params.tenantAlias]    The alias of the tenant on which to check for existence. Defaults to the current tenant
 * @param  {Response}           res                         The express response object
 * @api private
 */
const _handleLocalUsernameExists = function (request, response) {
  AuthenticationAPI.localUsernameExists(
    request.ctx,
    request.params.tenantAlias,
    request.params.username,
    (error, exists) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      // If the login id doesn't exist, we send back a 404
      if (exists) {
        return response.sendStatus(200);
      }

      return response.sendStatus(404);
    }
  );
};

/**
 * @REST getAuthTenantAliasExistsUsername
 *
 * Determine if a local username already exists
 *
 * @Server      admin
 * @Method      GET
 * @Path        /auth/{tenantAlias}/exists/{username}
 * @PathParam   {string}        tenantAlias                 The alias of the tenant on which to check for existence
 * @FormParam   {string}        username                    The username to check existence for
 * @Return      {void}
 * @HttpResponse                200                         Username does exist
 * @HttpResponse                400                         Please specify a username
 * @HttpResponse                404                         Username does not exist
 */
OAE.globalAdminRouter.on(
  'get',
  '/api/auth/:tenantAlias/exists/:username',
  _handleLocalUsernameExists
);

/**
 * @REST getAuthExistsUsername
 *
 * Determine if a local username already exists
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /auth/exists/{username}
 * @FormParam   {string}        username                    The username to check existence for
 * @Return      {void}
 * @HttpResponse                200                         Username does exist
 * @HttpResponse                400                         Please specify a username
 * @HttpResponse                404                         Username does not exist
 */
OAE.tenantRouter.on('get', '/api/auth/exists/:username', _handleLocalUsernameExists);

export { OAE as default };
