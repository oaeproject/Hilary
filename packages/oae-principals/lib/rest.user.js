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
import process from 'node:process';
import { setUpConfig } from 'oae-config';

import * as AuthenticationAPI from 'oae-authentication';
import * as OAE from 'oae-util/lib/oae.js';
import * as OaeUtil from 'oae-util/lib/util.js';

import { Recaptcha } from 'recaptcha';
import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import { LoginId } from 'oae-authentication/lib/model.js';
import { prop, is, pipe } from 'ramda';
import PrincipalsAPI from './api.js';

const PrincipalsConfig = setUpConfig('oae-principals');

/**
 * @REST getUserTermsAndConditions
 *
 * Get the Terms and Conditions
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /user/termsAndConditions
 * @QueryParam  {string}                [locale]        The locale in which the Terms and Conditions should be retrieved. Defaults to the default Terms and Conditions
 * @Return      {TermsAndConditions}                    The Terms and Conditions
 * @HttpResponse                        200             Terms and conditions available
 */
OAE.tenantRouter.on('get', '/api/user/termsAndConditions', (request, response) => {
  const termsAndConditions = PrincipalsAPI.getTermsAndConditions(request.ctx, request.query.locale);
  response.status(200).send(termsAndConditions);
});

/**
 * @REST postUserUserIdTermsAndConditions
 *
 * Accept the Terms and Conditions
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /user/{userId}/termsAndConditions
 * @PathParam   {string}        userId                  The id of the user accepting the Terms and Conditions
 * @Return      {BasicUser}                             The updated user
 * @HttpResponse                200                     Terms and conditions acceptance noted
 * @HttpResponse                400                     Invalid userId passed in
 * @HttpResponse                400                     The Terms and Conditions are not enabled, there is no need to accept them
 * @HttpResponse                401                     Only logged in users can accept the Terms and Conditions
 * @HttpResponse                401                     You are not authorized to accept the Terms and Conditions on behalf of this user
 */
OAE.tenantRouter.on('post', '/api/user/:userId/termsAndConditions', (request, response) => {
  PrincipalsAPI.acceptTermsAndConditions(request.ctx, request.params.userId, (error, user) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(user);
  });
});

/**
 * @REST postUserCreateGlobalAdminUser
 *
 * Create a new global administrator with local authentication
 *
 * @Server      admin
 * @Method      POST
 * @Path        /user/createGlobalAdminUser
 * @FormParam   {string}        displayName             The display name for the global administrator
 * @FormParam   {string}        password                The password for the global administrator
 * @FormParam   {string}        username                The unique username for the global administrator
 * @FormParam   {string}        email                   The email address for the global administrator
 * @FormParam   {string}        [emailPreference]       The email preference for the global administrator   [daily,immediate,weekly]
 * @FormParam   {string}        [locale]                The locale for the global administrator
 * @FormParam   {string}        [publicAlias]           The name to show when the global administrator is inaccessible to a user
 * @Return      {BasicUser}                             The created global administrator
 * @HttpResponse                201                     Global administrator created
 * @HttpResponse                400                     A display name can be at most 1000 characters long
 * @HttpResponse                400                     A user with username ... already exists
 * @HttpResponse                400                     You must provide a display name
 * @HttpResponse                400                     You must provide a password
 * @HttpResponse                400                     You must provide a username
 * @HttpResponse                401                     You do not have sufficient rights to make someone an admin
 * @HttpResponse                401                     You must be a global administrator to create a global administrator user
 */
OAE.globalAdminRouter.on('post', '/api/user/createGlobalAdminUser', (request, response) => {
  const options = _getOptionalProfileParameters(request.body);

  // Create the user as global admin
  AuthenticationAPI.getOrCreateGlobalAdminUser(
    request.ctx,
    request.body.username,
    request.body.password,
    request.body.displayName,
    options,
    (error, user, loginId, created) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      if (!created) {
        return response.status(400).send(format('A user with username "%s" already exists', request.body.username));
      }

      return response.status(201).send(user);
    }
  );
});

/**
 * @REST postUserTenantAliasCreateTenantAdminUser
 *
 * Create a new tenant administrator with local authentication
 *
 * @Server      admin
 * @Method      POST
 * @Path        /user/{tenantAlias}/createTenantAdminUser
 * @PathParam   {string}        tenantAlias             The alias of the tenant for which to create a tenant administrator
 * @FormParam   {string}        displayName             The display name for the tenant administrator
 * @FormParam   {string}        password                The password for the tenant administrator
 * @FormParam   {string}        username                The unique username for the tenant administrator
 * @FormParam   {string}        email                   The email address for the tenant administrator
 * @FormParam   {boolean}       [acceptedTC]            Whether or not the tenant administrator has accepted the Terms and Conditions
 * @FormParam   {string}        [emailPreference]       The email preference for the tenant administrator   [daily,immediate,weekly]
 * @FormParam   {string}        [locale]                The locale for the tenant administrator
 * @FormParam   {string}        [publicAlias]           The name to show when the tenant administrator is inaccessible to a user
 * @Return      {BasicUser}                             The created tenant administrator
 * @HttpResponse                201                     Tenant administrator created
 * @HttpResponse                400                     A display name can be at most 1000 characters long
 * @HttpResponse                400                     A display name must be provided
 * @HttpResponse                400                     The specified email preference is invalid
 * @HttpResponse                400                     The specified visibility setting is unknown
 * @HttpResponse                401                     Only administrators can create new tenant administrators
 * @HttpResponse                401                     You do not have sufficient rights to make someone an admin
 * @HttpResponse                404                     A non-existing tenant was specified as the target for this user
 */

/**
 * @REST postUserCreateTenantAdminUser
 *
 * Create a new tenant administrator with local authentication
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /user/createTenantAdminUser
 * @FormParam   {string}        displayName             The display name for the tenant administrator
 * @FormParam   {string}        password                The password for the tenant administrator
 * @FormParam   {string}        username                The unique username for the tenant administrator
 * @FormParam   {string}        email                   The email address for the global administrator
 * @FormParam   {boolean}       [acceptedTC]            Whether or not the tenant administrator has accepted the Terms and Conditions
 * @FormParam   {string}        [emailPreference]       The email preference for the tenant administrator   [daily,immediate,weekly]
 * @FormParam   {string}        [locale]                The locale for the tenant administrator
 * @FormParam   {string}        [publicAlias]           The name to show when the tenant administrator is inaccessible to a user
 * @Return      {BasicUser}                             The created tenant administrator
 * @HttpResponse                201                     Tenant administrator created
 * @HttpResponse                400                     A display name can be at most 1000 characters long
 * @HttpResponse                400                     A display name must be provided
 * @HttpResponse                400                     The specified email preference is invalid
 * @HttpResponse                400                     The specified visibility setting is unknown
 * @HttpResponse                401                     Only administrators can create new tenant administrators
 * @HttpResponse                401                     You do not have sufficient rights to make someone an admin
 */
const _handleCreateTenantAdminUser = function (request, response) {
  const { ctx } = request;
  const tenantAlias = request.params.tenantAlias || ctx.tenant().alias;
  const loginId = new LoginId(tenantAlias, AuthenticationConstants.providers.LOCAL, request.body.username, {
    password: request.body.password
  });
  const options = _getOptionalProfileParameters(request.body);

  // Create the user as a tenant administrator
  AuthenticationAPI.createTenantAdminUser(ctx, loginId, request.body.displayName, options, (error, user) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(201).send(user);
  });
};

OAE.globalAdminRouter.on('post', '/api/user/:tenantAlias/createTenantAdminUser', _handleCreateTenantAdminUser);
OAE.tenantRouter.on('post', '/api/user/createTenantAdminUser', _handleCreateTenantAdminUser);

/**
 * @REST postUserTenantAliasCreate
 *
 * Create a new user with local authentication
 *
 * @Server      admin
 * @Method      POST
 * @Path        /user/{tenantAlias}/create
 * @PathParam   {string}        tenantAlias             The alias of the tenant for which to create a user
 * @FormParam   {string}        displayName             The display name for the user
 * @FormParam   {string}        password                The password for the user
 * @FormParam   {string}        username                The unique username for the user
 * @FormParam   {string}        email                   The email address for the user
 * @FormParam   {boolean}       [acceptedTC]            Whether or not the user has accepted the Terms and Conditions
 * @FormParam   {string}        [emailPreference]       The email preference for the user       [daily,immediate,weekly]
 * @FormParam   {string}        [locale]                The locale for the user
 * @FormParam   {string}        [publicAlias]           The name to show when the user is inaccessible to a user
 * @FormParam   {string}        [visibility]            The visibility of the user              [loggedin,private,public]
 * @Return      {BasicUser}                             The created user
 * @HttpResponse                201                     User created
 * @HttpResponse                400                     A display name must be provided
 * @HttpResponse                400                     A display name can be at most 1000 characters long
 * @HttpResponse                400                     The specified email preference is invalid
 * @HttpResponse                400                     The specified visibility setting is unknown
 * @HttpResponse                401                     Only global administrators may create a user on the global admin tenant
 * @HttpResponse                401                     Only global administrators may create users on a tenant that is not the current
 * @HttpResponse                404                     A non-existing tenant was specified as the target for this user
 */
OAE.globalAdminRouter.on('post', '/api/user/:tenantAlias/create', (request, response) => {
  const loginId = new LoginId(
    request.params.tenantAlias,
    AuthenticationConstants.providers.LOCAL,
    request.body.username,
    {
      password: request.body.password
    }
  );
  const options = {
    visibility: request.body.visibility,
    email: request.body.email,
    emailPreference: request.body.emailPreference,
    locale: request.body.locale || request.ctx.locale(),
    timezone: request.body.timezone,
    publicAlias: request.body.publicAlias,
    acceptedTC: request.body.acceptedTC === 'true'
  };

  AuthenticationAPI.createUser(request.ctx, loginId, request.body.displayName, options, (error, newUser) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(201).send(newUser);
  });
});

/**
 * @REST postUserCreate
 *
 * Create a new user with local authentication
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /user/create
 * @FormParam   {string}        displayName             The display name for the user
 * @FormParam   {string}        password                The password for the user
 * @FormParam   {string}        username                The unique username for the user
 * @FormParam   {string}        email                   The email address for the user
 * @FormParam   {boolean}       [acceptedTC]            Whether or not the user has accepted the Terms and Conditions
 * @FormParam   {string}        [emailPreference]       The email preference for the user       [daily,immediate,weekly]
 * @FormParam   {string}        [locale]                The locale for the user
 * @FormParam   {string}        [publicAplias]           The name to show when the user is inaccessible to a user
 * @FormParam   {string}        [visibility]            The visibility of the user              [loggedin,private,public]
 * @Return      {BasicUser}                             The created user
 * @HttpResponse                201                     User created
 * @HttpResponse                400                     A display name must be provided
 * @HttpResponse                400                     A display name can be at most 1000 characters long
 * @HttpResponse                400                     Invalid reCaptcha token
 * @HttpResponse                400                     The specified email preference is invalid
 * @HttpResponse                400                     The specified visibility setting is unknown
 * @HttpResponse                400                     The specified username already exists
 * @HttpResponse                400                     You need to accept the Terms and Conditions
 * @HttpResponse                401                     Unauthorized
 */
OAE.tenantRouter.on('post', '/api/user/create', (request, response) => {
  const { ctx } = request;
  const tenant = ctx.tenant();
  const user = ctx.user();
  const options = _getOptionalProfileParameters(request.body);

  // We enforce an email address, the API will take care of validating the actual value
  if (!options.email) {
    return response.status(400).send('A valid email address is required when creating a local account');
  }

  options.invitationToken = request.body.invitationToken;

  const getErrorCode = (error) => {
    if (is(Error, error)) {
      const parseError = pipe(prop('message'), JSON.parse);
      return {
        responseErrorCode: pipe(parseError, prop('code'))(error),
        responseErrorMessage: pipe(parseError, prop('msg'))(error)
      };
    }

    return { responseErrorCode: error.code, responseErrorMessage: error.msg };
  };

  /*!
   * Create a local user account
   */
  const createUser = function () {
    AuthenticationAPI.getOrCreateUser(
      ctx,
      AuthenticationConstants.providers.LOCAL,
      request.body.username,
      { password: request.body.password },
      request.body.displayName,
      options,
      (error, newUser, loginId, created) => {
        if (error) {
          /**
           * Again, we need to deal with both Error and Object instances
           */
          const { responseErrorCode, responseErrorMessage } = getErrorCode(error);
          return response.status(responseErrorCode).send(responseErrorMessage);
        }

        if (!created) {
          return response.status(400).send('A user with that username already exists').end();
        }

        return response.status(201).send(newUser);
      }
    );
  };

  if (user) {
    if (user.isAdmin(tenant.alias)) {
      // If the current user is an admin, the reCaptcha verification can be skipped
      return createUser();
    }

    // Non-admin users cannot create accounts
    return response.status(401).end();
  }

  if (options.invitationToken) {
    // Bypass recaptcha if an invitation token is provided. The process of creating a user will
    // fail if the invitation token is not valid
    return createUser();
  }

  // Check if the Terms and Conditions has been agreed to (if applicable)
  const needsTermsAndConditionsAgreement = PrincipalsConfig.getValue(tenant.alias, 'termsAndConditions', 'enabled');
  if (needsTermsAndConditionsAgreement && options.acceptedTC !== true) {
    return response.status(400).send('You need to accept the Terms and Conditions');
  }

  // Check if we need to validate with reCaptcha
  const needsReCaptcha = PrincipalsConfig.getValue(tenant.alias, 'recaptcha', 'enabled');
  if (!needsReCaptcha) {
    return createUser();
  }

  // An anonymous user, do the recaptcha check
  const recaptchaData = {
    remoteip: request.connection.remoteAddress,
    challenge: request.body.recaptchaChallenge,
    response: request.body.recaptchaResponse
  };
  const recaptchaPublicKey = PrincipalsConfig.getValue(tenant.alias, 'recaptcha', 'publicKey');
  const recaptchaPrivateKey = PrincipalsConfig.getValue(tenant.alias, 'recaptcha', 'privateKey');
  const recaptcha = new Recaptcha(recaptchaPublicKey, recaptchaPrivateKey, recaptchaData);
  // eslint-disable-next-line no-unused-vars
  recaptcha.verify((success, error) => {
    if (success) {
      return createUser();
    }

    return response.status(400).send('Invalid reCaptcha token');
  });
});

/**
 * Convenience function to handle deleting a user
 *
 * @param  {Request}    req     The express request
 * @param  {Response}   res     The express response
 * @api private
 */
const _handleDeleteUser = function (request, response) {
  PrincipalsAPI.deleteUser(request.ctx, request.params.userId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
};

/**
 * @REST deleteUserUserId
 *
 * @Server      admin,tenant
 * @Method      DELETE
 * @Path        /user/{userId}
 * @PathParam   {string}        userId      The id of the user to delete
 * @HttpResponse                200         The user was successfully deleted
 * @HttpResponse                400         An invalid user id was specified
 * @HttpResponse                401         You do not have access to delete this user
 * @HttpResponse                404         The user did not exist
 */
OAE.tenantRouter.on('delete', '/api/user/:userId', _handleDeleteUser);
OAE.globalAdminRouter.on('delete', '/api/user/:userId', _handleDeleteUser);

/**
 * Convenience function to handle restoring a user
 *
 * @param  {Request}    req     The express request
 * @param  {Response}   res     The express response
 * @api private
 */
const _handleRestoreUser = function (request, response) {
  PrincipalsAPI.restoreUser(request.ctx, request.params.userId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
};

/**
 * @REST restoreUserUserId
 *
 * @Server      admin,tenant
 * @Method      POST
 * @Path        /user/{userId}
 * @PathParam   {string}        userId      The id of the user to restore
 * @HttpResponse                200         The user was successfully restored
 * @HttpResponse                400         An invalid user id was specified
 * @HttpResponse                401         You do not have access to restore this user
 * @HttpResponse                404         The user did not exist
 */
OAE.tenantRouter.on('post', '/api/user/:userId/restore', _handleRestoreUser);
OAE.globalAdminRouter.on('post', '/api/user/:userId/restore', _handleRestoreUser);

/**
 * @REST getMe
 *
 * Get the me feed for the current user
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /me
 * @Return      {Me}            The me feed for the current user
 * @HttpResponse        200     Me data available
 * @HttpResponse        401     You need to be authenticated to retrieve your user information
 */
const _handleGetMe = function (request, response) {
  PrincipalsAPI.getMe(request.ctx, (error, meData) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(meData);
  });
};

OAE.globalAdminRouter.on('get', '/api/me', _handleGetMe);
OAE.tenantRouter.on('get', '/api/me', _handleGetMe);

/**
 * @REST postUserImport
 *
 * Import users using a CSV file
 *
 * @Server      admin
 * @Method      POST
 * @Path        /user/import
 * @FormParam   {string}            authenticationStrategy  The authentication strategy with which the provided external ids should be associated        [cas,facebook,google,ldap,local,oauth,shibboleth,twitter]
 * @FormParam   {File}              file                    The CSV file to import
 * @FormParam   {string}            tenantAlias             The alias of the tenant for which the users should imported
 * @FormParam   {boolean}           [forceProfileUpdate]    Whether or not the user information should be updated, even when other user information is already present
 * @HttpResponse                    200                     File accepted for processing
 * @HttpResponse                    400                     A CSV file must be provided
 * @HttpResponse                    400                     A valid authentication strategy must be provided
 * @HttpResponse                    400                     An existing tenant alias must be provided
 * @HttpResponse                    401                     Only authorized admins can import users
 */

/**
 * @REST postUserImportTenant
 *
 * Import users using a CSV file
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /user/import
 * @FormParam   {string}            authenticationStrategy  The authentication strategy with which the provided external ids should be associated        [cas,facebook,google,ldap,local,oauth,shibboleth,signed,twitter]
 * @FormParam   {File}              file                    The CSV file to import
 * @FormParam   {boolean}           [forceProfileUpdate]    Whether or not the user information should be updated, even when other user information is already present
 * @HttpResponse                    200                     File accepted for processing
 * @HttpResponse                    400                     A CSV file must be provided
 * @HttpResponse                    400                     A valid authentication strategy must be provided
 * @HttpResponse                    400                     An existing tenant alias must be provided
 * @HttpResponse                    401                     Only authorized admins can import users
 */
const _handleImportUsers = function (request, response) {
  const forceProfileUpdate = request.body.forceProfileUpdate === 'true';
  PrincipalsAPI.importUsers(
    request.ctx,
    request.body.tenantAlias,
    request.files.file,
    request.body.authenticationStrategy,
    forceProfileUpdate,
    (error) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      // Set the response type to text/plain, as the UI uses an iFrame upload mechanism to support IE9
      // file uploads. If the response type is not set to text/plain, IE9 will try to download the response
      response.set('Content-Type', 'text/plain');
      return response.status(200).end();
    }
  );
};

OAE.globalAdminRouter.on('post', '/api/user/import', _handleImportUsers);
OAE.tenantRouter.on('post', '/api/user/import', _handleImportUsers);

/**
 * @REST postUserIdAdmin
 *
 * Update the tenant administrator status for a user
 *
 * @Server      admin,tenant
 * @Method      POST
 * @Path        /user/{userId}/admin
 * @PathParam   {string}        userId                      The id of the user to update the tenant administrator status for
 * @FormParam   {boolean}       admin                       Whether or not the user should become a tenant administrator
 * @Return      {void}
 * @HttpResponse                200                         User status updated
 * @HttpResponse                400                         Must provide a user id
 * @HttpResponse                400                         The provided principalId is not a user
 * @HttpResponse                400                         The provided userId is not a user identifier
 * @HttpResponse                401                         You do not have sufficient rights to make someone an admin
 */
const _handleSetTenantAdmin = function (request, response) {
  PrincipalsAPI.setTenantAdmin(request.ctx, request.params.userId, request.body.admin, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
};

OAE.globalAdminRouter.on('post', '/api/user/:userId/admin', _handleSetTenantAdmin);
OAE.tenantRouter.on('post', '/api/user/:userId/admin', _handleSetTenantAdmin);

/**
 * @REST postUserId
 *
 * Update a user
 *
 * @Server      admin,tenant
 * @Method      POST
 * @Path        /user/{userId}
 * @PathParam   {string}        userId                      The id of the user to update
 * @FormParam   {string}        [email]                     The updated email for the user
 * @FormParam   {string}        [emailPreference]           The updated email preference for the user      [daily,immediate,weekly]
 * @FormParam   {string}        [locale]                    The updated locale for the user
 * @FormParam   {string}        [publicAlias]               The updated name to show when the user is inaccessible to a user
 * @FormParam   {string}        [visibility]                The updated visibility of the user            [loggedin,private,public]
 * @Return      {BasicUser}                                 The updated user
 * @HttpResponse                200                         User updated
 * @HttpResponse                400                         A display name cannot be empty
 * @HttpResponse                400                         A display name can be at most 1000 characters long
 * @HttpResponse                400                         A valid user id must be provided
 * @HttpResponse                400                         An invalid visibility option has been specified
 * @HttpResponse                400                         At least one basic profile field should be specified
 * @HttpResponse                400                         Restricted property was attempted to be set
 * @HttpResponse                400                         The specified emailPreference is invalid
 * @HttpResponse                401                         You are not authorized to update this user's profile
 * @HttpResponse                404                         The specified user could not be found
 */
const _handleUpdateUser = function (request, response) {
  PrincipalsAPI.updateUser(request.ctx, request.params.userId, request.body, (error, user) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(user);
  });
};

OAE.globalAdminRouter.on('post', '/api/user/:userId', _handleUpdateUser);
OAE.tenantRouter.on('post', '/api/user/:userId', _handleUpdateUser);

/**
 * @REST getUserId
 *
 * Get a full user profile
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /user/{userId}
 * @PathParam   {string}        userId                      The id of the user to get
 * @Return      {User}                                      Full user profile
 * @HttpResponse                200                         User profile available
 * @HttpResponse                400                         Must provide a user id
 * @HttpResponse                400                         The provided userId is not a user identifier
 * @HttpResponse                404                         The specified user could not be found
 */
const _handleGetFullProfile = function (request, response) {
  PrincipalsAPI.getFullUserProfile(request.ctx, request.params.userId, (error, user) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(user);
  });
};

OAE.globalAdminRouter.on('get', '/api/user/:userId', _handleGetFullProfile);
OAE.tenantRouter.on('get', '/api/user/:userId', _handleGetFullProfile);

/**
 * @REST getUserIdMemberships
 *
 * Get the group memberships of a principal
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /user/{userId}/memberships
 * @PathParam   {string}        userId                      The id of the principal for which to get the group memberships
 * @QueryParam  {number}        [limit]                     The maximum number of results to return. Default: 10
 * @QueryParam  {string}        [start]                     The paging token from which to start fetching group memberships
 * @Return      {MembershipsResponse}                       The principal's group memberships, either directly or indirectly
 * @HttpResponse                200                         Group memberships available
 * @HttpResponse                400                         Must specify a valid principalId
 * @HttpResponse                401                         You do not have access to this memberships library
 * @HttpResponse                404                         The specified user could not be found
 */
OAE.tenantRouter.on('get', '/api/user/:userId/memberships', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 10, 1, 25);
  PrincipalsAPI.getMembershipsLibrary(
    request.ctx,
    request.params.userId,
    request.query.start,
    limit,
    (error, memberships, nextToken) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).send({ results: memberships, nextToken });
    }
  );
});

/**
 * @REST postUserIdPicture
 *
 * Store the large picture for a user
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /user/{userId}/picture
 * @PathParam   {string}        userId                      The id of the user to store the large picture for
 * @FormParam   {File}          file                        Image that should be stored as the large user picture
 * @Return      {BasicUser}                                 The updated user
 * @HttpResponse                200                         Picture updated
 * @HttpResponse                400                         A file must be provided
 * @HttpResponse                400                         A principal ID must be provided
 * @HttpResponse                400                         Only images are accepted files
 * @HttpResponse                400                         The size of a picture has an upper limit of 10MB.
 * @HttpResponse                401                         You have to be logged in to be able to update a picture
 * @HttpResponse                404                         The specified user could not be found
 */
OAE.tenantRouter.on('post', '/api/user/:userId/picture', (request, response) => {
  request.files = request.files || {};
  PrincipalsAPI.storePicture(request.ctx, request.params.userId, request.files.file, (error, principal) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    // Set the response type to text/plain, as the UI uses an iFrame upload mechanism to support IE9
    // file uploads. If the response type is not set to text/plain, IE9 will try to download the response.
    response.set('Content-Type', 'text/plain');
    return response.status(200).send(principal);
  });
});

/**
 * @REST postUserEmailVerify
 *
 * Verify an email token
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /user/{userId}/email/verify
 * @PathParam   {string}        userId                      The id of the user to verify the email address for
 * @FormParam   {string}        token                       The token with which to verify the email address
 * @HttpResponse                200                         The token was valid and the email address for the user that was associated with it is verified
 * @HttpResponse                400                         A token was not specified
 * @HttpResponse                404                         The token was not associated with a user
 */
OAE.tenantRouter.on('post', '/api/user/:userId/email/verify', (request, response) => {
  PrincipalsAPI.verifyEmail(request.ctx, request.params.userId, request.body.token, (error, user) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(user);
  });
});

/**
 * @REST postUserIdEmailResend
 *
 * Send a new email token to a user
 *
 * @Server      admin,tenant
 * @Method      POST
 * @Path        /user/{userId}/email/resend
 * @PathParam   {string}        userId                      The id of the user to who a new email token should be sent
 * @HttpResponse                200                         The token was sent
 * @HttpResponse                400                         Invalid user id or the email address is already verified
 * @HttpResponse                401                         You do not have sufficient rights to resend a token for a user
 */
const _handleResendEmailToken = function (request, response) {
  PrincipalsAPI.resendEmailToken(request.ctx, request.params.userId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
};

OAE.globalAdminRouter.on('post', '/api/user/:userId/email/resend', _handleResendEmailToken);
OAE.tenantRouter.on('post', '/api/user/:userId/email/resend', _handleResendEmailToken);

/**
 * @REST getUserIdEmailToken
 *
 * Check whether a user has a pending email token
 *
 * @Server      admin,tenant
 * @Method      POST
 * @Path        /user/{userId}/email/token
 * @PathParam   {string}        userId                      The id of the user to for which to check whether they have a pending email token
 * @HttpResponse                200                         If there is a pending token, the address for which it is valid is returned. Otherwise, `null` is returned in its place
 * @HttpResponse                400                         Invalid user id
 * @HttpResponse                401                         You do not have sufficient rights to check whether the user has a pending token
 */
const _getEmailToken = function (request, response) {
  PrincipalsAPI.getEmailToken(request.ctx, request.params.userId, (error, email) => {
    if (error && error.code !== 404) {
      return response.status(error.code).send(error.msg);
    }

    if (error) {
      email = null;
    }

    return response.status(200).send({ email });
  });
};

OAE.globalAdminRouter.on('get', '/api/user/:userId/email/token', _getEmailToken);
OAE.tenantRouter.on('get', '/api/user/:userId/email/token', _getEmailToken);

/**
 * @REST deleteUserIdEmailToken
 *
 * Delete a pending email token for a user
 *
 * @Server      admin,tenant
 * @Method      DELETE
 * @Path        /user/{userId}/email/token
 * @PathParam   {string}        userId                      The id of the user to for which to delete the pending email token
 * @HttpResponse                200                         The token has been deleted
 * @HttpResponse                400                         Invalid user id
 * @HttpResponse                401                         You do not have sufficient rights to delete this user's email token
 * @HttpResponse                404                         There is no pending token for the user
 */
const _deleteEmailToken = function (request, response) {
  PrincipalsAPI.deleteEmailToken(request.ctx, request.params.userId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
};

OAE.globalAdminRouter.on('delete', '/api/user/:userId/email/token', _deleteEmailToken);
OAE.tenantRouter.on('delete', '/api/user/:userId/email/token', _deleteEmailToken);

/**
 * Extract the optional user profile parameters from the given set of request parameters
 *
 * @param  {Object}     parameters  The parameters from which to extract the profile information
 * @return {Object}                 The relevant parameters for user profiles
 * @api private
 */
const _getOptionalProfileParameters = function (parameters) {
  return {
    visibility: parameters.visibility,
    email: parameters.email,
    emailPreference: parameters.emailPreference,
    locale: parameters.locale,
    publicAlias: parameters.publicAlias,
    acceptedTC: parameters.acceptedTC === 'true'
  };
};

/**
 * @REST getRecentGroupsForUserId
 *
 * Get the recently visited groups of a principal
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /user/{userId}/recent
 * @PathParam   {string}        userId                      The id of the principal for which to get the recent groups
 * @Return      {RecentGroupsResponse}                      The principal's recently visited groups
 * @HttpResponse                200                         Recent groups available
 * @HttpResponse                400                         Must specify a valid principalId
 * @HttpResponse                401                         You do not have access to this principal's groups
 * @HttpResponse                404                         The specified user could not be found
 */
OAE.tenantRouter.on('get', '/api/user/:userId/groups/recent', (request, response) => {
  const limit = 5;
  PrincipalsAPI.getRecentGroupsForUserId(request.ctx, request.params.userId, limit, (error, results) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send({ results });
  });
});

/**
 * @REST getUsersForTenant
 *
 * Get all users for a given tenant
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /tenants/{tenantAlias}/users
 * @PathParam   {string}        tenantAlias                 The id of the user to get
 * @Return      {User[]}                                    A list of users for the tenant
 * @HttpResponse                200                         Users available
 * @HttpResponse                400                         Must provide a tenantAlias
 * @HttpResponse                404                         No users were found for the given tenantAlias
 */
const _getUsersForTenant = function (request, response) {
  PrincipalsAPI.getAllUsersForTenant(request.ctx, request.params.tenantAlias, (error, users) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(users);
  });
};

OAE.globalAdminRouter.on('get', '/api/tenants/:tenantAlias/users', _getUsersForTenant);
OAE.tenantRouter.on('get', '/api/tenants/:tenantAlias/users', _getUsersForTenant);

/**
 * @REST exportData
 *
 * Download personnal data of a principal
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /user/{userId}/export/{exportType}
 * @PathParam   {string}        userId                      The id of the principal for which to get his datas
 * @PathParam   {string}        exportType                  Export type can be 'personal-data', 'content' or 'shared'
 * @Return      {File}                                      Zip file with all personal data related to a user
 */
OAE.tenantRouter.on('get', '/api/user/:userId/export/:exportType', (request, response) => {
  PrincipalsAPI.exportData(request.ctx, request.params.userId, request.params.exportType, async (error, zipFile) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    const filename = 'myData.zip';
    response.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    response.setHeader('Content-Type', 'application/zip');
    response.writeHead(200);

    const nodebuffer = await zipFile.generateAsync({
      type: 'nodebuffer',
      platform: process.platform,
      streamFiles: true
    });
    response.end(nodebuffer);
  });
});
