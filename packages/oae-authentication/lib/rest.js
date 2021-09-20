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

import * as AuthenticationAPI from 'oae-authentication';

/**
 * Authentication providers
 */

import * as cas from './strategies/cas/rest.js';
import * as facebook from './strategies/facebook/rest.js';
import * as google from './strategies/google/rest.js';
import * as ldap from './strategies/ldap/rest.js';
import * as local from './strategies/local/rest.js';
import * as oauth from './strategies/oauth/rest.js';
import * as shibb from './strategies/shibboleth/rest.js';
import * as signed from './strategies/signed/rest.js';
import * as twitter from './strategies/twitter/rest.js';

/**
 * @REST postAuthLogout
 *
 * Log out
 *
 * @Server      admin,tenant
 * @Method      POST
 * @Path        /auth/logout
 * @Return      {void}
 */
OAE.globalAdminRouter.on('post', '/api/auth/logout', AuthenticationAPI.logout);
OAE.tenantRouter.on('post', '/api/auth/logout', AuthenticationAPI.logout);

/**
 * Add two endpoints for REST control
 */
const _getResetPasswordSecret = function (request, response) {
  AuthenticationAPI.getResetPasswordSecret(request.ctx, request.params.username, (error, token) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(token);
  });
};

/**
 * @REST LocalResetInit
 *
 * generate an user token based on a existing username
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /auth/local/reset/secret/{username}
 * @PathParam   {string}        username     			The username for the user
 * @Return      {string}
 * @HttpResponse                200                     Configuration value cleared
 * @HttpResponse                400                     Missing configuration. Example configuration: `"oae-authentication/twitter/enabled"`
 * @HttpResponse                400                     You cannot mix clearing an entire element and an optionalKey
 * @HttpResponse                401                     Only authorized tenant admins can change config values
 * @HttpResponse                401                     User is not allowed to update config value ...
 * @HttpResponse                404                     Config value ... does not exist
 */
OAE.tenantRouter.on('get', '/api/auth/local/reset/secret/:username', _getResetPasswordSecret);

const _resetPassword = function (request, response) {
  AuthenticationAPI.resetPassword(
    request.ctx,
    request.params.username,
    request.body.secret,
    request.body.newPassword,
    (error) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).end();
    }
  );
};

/**
 * @REST LocalResetChange
 *
 * Reset an user's password based on a existing username
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /auth/local/reset/password/{username}
 * @PathParam   {string}        username                The username for the user
 * @FormParam   {string}        newPassword             The password for the user
 * @FormParam   {string}        secret                  The secret for the user
 * @Return      {void}
 * @HttpResponse                200                     Configuration value cleared
 * @HttpResponse                400                     Missing configuration. Example configuration: `"oae-authentication/twitter/enabled"`
 * @HttpResponse                400                     You cannot mix clearing an entire element and an optionalKey
 * @HttpResponse                401                     Only authorized tenant admins can change config values
 * @HttpResponse                401                     User is not allowed to update config value ...
 * @HttpResponse                404                     Config value ... does not exist
 */
OAE.tenantRouter.on('post', '/api/auth/local/reset/password/:username', _resetPassword);

/**
 * Convenience function to handle requesting the user's login ids
 *
 * @param  {Request}    req     The express request
 * @param  {Response}   res     The express response
 * @api private
 */
const _getUserLoginIds = function (request, response) {
  AuthenticationAPI.getUserLoginIds(request.ctx, request.params.userId, (error, loginIds) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(loginIds);
  });
};

/**
 * @REST getAuthLoginIds
 *
 * Get the login ids that are mapped to a user.
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /auth/loginIds/{userId}
 * @PathParam   {string}        userId        The id of the user to return the login ids for
 * @Return      {UserLoginIds}                The user's login ids
 * @HttpResponse                200           User login ids available
 * @HttpResponse                400           A user id must be provided
 * @HttpResponse                401           Only logged in users can request the login ids for a user
 * @HttpResponse                401           You are not authorized to request the login ids for this user
 * @HttpResponse                404           The specified user could not be found
 */
OAE.globalAdminRouter.on('get', '/api/auth/loginIds/:userId', _getUserLoginIds);
OAE.tenantRouter.on('get', '/api/auth/loginIds/:userId', _getUserLoginIds);
