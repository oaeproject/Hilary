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

import crypto from 'crypto';
import { format } from 'node:util';
import _ from 'underscore';
import cookieParser from 'cookie-parser';
import cookieSession from 'cookie-session';
import MobileDetect from 'mobile-detect';
import passport from 'passport';
import { Context } from 'oae-context';
import { logger } from 'oae-logger';
import * as TenantsUtil from 'oae-tenants/lib/util.js';
import { getOrCreateUser } from 'oae-authentication';
import { objectifySearchParams } from 'oae-tests';

const log = logger('oae-authentication');

/**
 * Setup the necessary authentication middleware
 *
 * @param  {Object}     config  An object containing the full system configuration (i.e., 'config.js')
 * @param  {Express}    server  An express server
 */
const setupAuthMiddleware = function (config, server) {
  // Tell express how to parse our cookies. All stateful data (e.g., authenticated user id,
  // imposter state) is stored on the user's session cookie. We encrypt that data with this
  // configured `secret`
  server.use(cookieParser(config.cookie.secret));

  // This middleware uses cookieSession to tell express how to write a session (i.e., a cookie
  // with encryption signed by the configured secret). That said, it needs to come before passport
  // authentication (`passport.session()`) because passport needs to know how to write the cookie
  server.use((request, response, next) => {
    const cookieOptions = {
      name: config.cookie.name,
      secret: config.cookie.secret
    };

    // Don't increase the expiry if we are accessing the global admin server
    if (!request.tenant.isGlobalAdminServer) {
      const md = new MobileDetect(request.headers['user-agent']);
      if (md.mobile()) {
        // For mobile clients that aren't accessing the global administration tenant, we
        // bump the cookie expiry to 30 days
        cookieOptions.maxAge = 1000 * 60 * 60 * 24 * 30;
      }
    }

    // Pass through to the actual cookie session middleware
    return cookieSession(cookieOptions)(request, response, next);
  });

  // Now that we know how to parse the cookie, we can extract the user in session, if any. The
  // resulting session information will be located on `req.oaeAuthInfo`
  server.use(passport.initialize({ userProperty: 'oaeAuthInfo' }));

  // Perform the request authentication
  server.use(passport.session());
};

/**
 * Checks whether a provided plain-text password matches a stored hashed password
 *
 * @param  {String}     plainTextPassword   The plain-text password provided by the user
 * @param  {String}     hashedPassword      The hashed password stored for the user
 * @return {Boolean}                        True if the provided password matches the stored hashed password, false if they are different
 */
const hashAndComparePassword = function (plainTextPassword, hashedPassword) {
  // Get the salt of the hashed password
  const salt = hashedPassword.split('$')[0];
  // Check if the provided password with the extracted salt is the same as the stored password
  return hashPassword(plainTextPassword, salt) === hashedPassword;
};

/**
 * Hashes a string using SHA512
 *
 * @param  {String}     password        The passwords that needs to be hashed
 * @param  {String}     salt            A random salt that will be prepended to the password for hashing (optional)
 * @return {String}                     The hashed password
 */
const hashPassword = function (password, salt) {
  // Prepend a random number to prevent rainbow table attacks
  salt = salt || crypto.randomBytes(16).toString('hex');
  password = salt + password;
  return salt + '$' + crypto.createHash('sha512').update(password).digest('hex');
};

/**
 * Get the ID of the authentication strategy for the given tenant
 *
 * @param  {Tenant}     tenant          The tenant for which to create the strategy ID
 * @param  {String}     strategyName    The name of the strategy
 * @return {String}                     The unique ID of the strategy for the tenant
 */
const getStrategyId = function (tenant, strategyName) {
  return format('%s:%s', tenant.alias, strategyName);
};

/**
 * Parses a strategy ID and returns the tenant alias and strategy name
 *
 * @param  {String}     strategyId  The strategy ID to parse
 * @return {Object}                 An object containing the `tenantAlias` and `strategyName`
 */
const parseStrategyId = function (strategyId) {
  const parts = strategyId.split(':');
  const strategyName = parts.pop();
  const tenantAlias = parts.join(':');
  return {
    tenantAlias,
    strategyName
  };
};

/**
 * Outputs a log message for a successful authentication
 *
 * @param  {Request}    req                     The request the user used to login
 * @param  {Object}     authInfo                The authentication object that is returned by the strategy to be stored in `req.authInfo`
 * @param  {User}       authInfo.user           The user who will own the session
 * @param  {User}       [authInfo.imposter]     If the user in session is being impostered, this is the user impostering the owner of the session
 * @param  {String}     strategyName            The name of the strategy used for authn
 */
const logAuthenticationSuccess = function (request, authInfo, strategyName) {
  const tenantAlias = request.tenant.alias;
  const { imposter, user } = authInfo;

  const data = {
    userId: user.id,
    headers: _.omit(request.headers, 'cookie', 'authentication'),
    tenantAdmin: user.isTenantAdmin(tenantAlias),
    globalAdmin: user.isGlobalAdmin(),
    tenantAlias,
    strategyName
  };

  if (imposter) {
    data.imposterId = imposter.id;
  }

  log().info(
    data,
    format(
      'Login for "%s" to tenant "%s" from "%s"',
      user.id,
      tenantAlias,
      request.headers['x-forwarded-for']
    )
  );
};

/**
 * A catch-all error handler for errors that bubbled out of passport strategies.
 *
 * @param  {Request}    req     The ExpressJS request object
 * @param  {Response}   res     The ExpressJS response object
 * @param  {Function}   next    The middleware which should be executed next
 * @return {Function}           A function that can be used as part of the middleware chain
 */
const handlePassportError = function (request, response, next) {
  return function (error) {
    if (error) {
      // An OAE-specific error
      if (error.reason && error.msg) {
        log().warn({ err: error, host: request.hostname }, error.msg);
        return response.redirect('/?authentication=failed&reason=' + error.reason);

        // If someone tried to sign in with a disabled strategy
      }

      if (error.message && error.message.indexOf('Unknown authentication strategy') === 0) {
        log().warn({ host: request.hostname }, 'Authentication attempt with disabled strategy');
        return response.redirect('/?authentication=disabled');

        // Generic error
      }

      log().error({ err: error, host: request.hostname }, 'An error occurred during login');
      return response.redirect('/?authentication=error');
    }

    // If no error ocurred we can move to the next middleware
    return next();
  };
};

/**
 * Authenticate the user with the passed in strategyId.
 * This will also take care of setting up the correct redirect behaviour once the user returns
 * to the application by setting a cookie called `redirectUrl` with the URL the client should be redirect to.
 *
 * @param  {String}     strategyId          The ID that should be used to authenticate the user with. This is the string as returned by `getStrategyId`
 * @param  {Object}     [passportOptions]   Any options that should be passed onto the strategy
 * @param  {Request}    req                 The ExpressJS request object
 * @param  {Response}   res                 The ExpressJS response object
 * @param  {Function}   next                The next middleware that should be executed
 */
const handleExternalSetup = function (strategyId, passportOptions, request, response, next) {
  // Get the generic error handler
  const errorHandler = handlePassportError(request, response, next);

  // Get the URL to which the user should be redirected and store it in a cookie,
  // so we can retrieve it once the user returns from the external authentication source
  const redirectUrl = validateRedirectUrl(request.body.redirectUrl);
  response.cookie('redirectUrl', redirectUrl);

  // Initiate the authentication process
  passport.authenticate(strategyId, passportOptions)(request, response, errorHandler);
};

/**
 * Validate a URL that should be used to redirect the user within OAE after authentication.
 * If no URL is provided or the URL is invalid, `/` will be returned.
 * Only a path within OAE is considered to be a valid redirect URL.
 *
 * @param  {String}     [redirectUrl]   The URL that should be tested
 * @return {String}                     A valid URL
 */
const validateRedirectUrl = function (redirectUrl = '/') {
  // Ensure that we're dealing with an OAE url so that we're not sending the user to a remote site
  if (redirectUrl.charAt(0) !== '/') {
    redirectUrl = '/';
    log().warn({ redirectUrl }, 'Possible Open Redirect attack detected');
  }

  return redirectUrl;
};

/**
 * Get or create the user with the specified details as a user authenticates
 * from an external authentication strategy. Since we trust emails from external
 * authentication strategies, this method takes care of handling whether or not
 * the specified email should be verified, as well as determines if there is any
 * email invitation information that should be taken into consideration
 *
 * Aside from the `req` parameter, this function is simply a wrapper to
 * `AuthenticationAPI.getOrCreateUser`
 *
 * @param  {Request}    req     The express request that holds the authentication info
 * @see AuthenticationAPI.getOrCreateUser
 */
const handleExternalGetOrCreateUser = function (
  request,
  authProvider,
  externalId,
  providerProperties,
  displayName,
  options,
  callback
) {
  if (options.email) {
    // Always trust emails provided by external authentication sources
    options.emailVerified = true;
  } else {
    // If no email was provided by the external authentication provider,
    // we should provide the invitation token to indicate that the user
    // should be created with their email address pre-validated to that
    // associated to the invitation token
    const invitationInfo = _getRequestInvitationInfo(request);
    if (invitationInfo.invitationToken) {
      options.invitationToken = invitationInfo.invitationToken;
    }
  }

  // Require the AuthenticationAPI inline to avoid cross-dependency issues
  // during initialization
  const ctx = new Context(request.tenant);
  return getOrCreateUser(
    ctx,
    authProvider,
    externalId,
    providerProperties,
    displayName,
    options,
    callback
  );
};

/**
 * Handles a callback request for an external authentication strategy.
 * This will take care of authenticating the user into the system, logging
 * a proper statement and redirecting the user to the correct page.
 *
 * @param  {String}     strategyId      The ID of the strategy that should be used to authenticate the user. This is the string as returned by `getStrategyId`
 * @param  {Request}    req             The ExpressJS request object
 * @param  {Response}   res             The ExpressJS response object
 * @param  {Function}   next            The next middleware that should be executed
 */
const handleExternalCallback = function (strategyId, request, response, next) {
  // Get the generic error handler
  const errorHandler = handlePassportError(request, response, next);

  // Authenticate this request with Passport. Because we specify a callback function
  // we will need to manually log the user in the system
  passport.authenticate(strategyId, {}, (error, user, challenges, status) => {
    if (error) {
      return errorHandler(error);
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
      return response.redirect('/?authentication=failed&reason=tampering');
    }

    // The user's authentication credentials are correct, log the user into the system
    handleLogin(strategyId, user, request, response, next);
  })(request, response, errorHandler);
};

/**
 * Log a user onto the system
 *
 * @param  {String}         strategyId          The ID of the strategy that should be used to authenticate the user. This is the string as returned by `getStrategyId`
 * @param  {User}           user                The user that should be logged into the system
 * @param  {Request}        req                 The ExpressJS request object
 * @param  {Response}       res                 The ExpressJS response object
 * @param  {Function}       [next]              In case, this function is called in some middleware, the next function in the chain
 */
const handleLogin = function (strategyId, user, request, response, next) {
  // Get the URL to which the user should be redirected
  const redirectUrl = validateRedirectUrl(request.cookies.redirectUrl);

  // This cookie serves no further purpose, remove it
  response.clearCookie('redirectUrl');

  // Get the generic error handler
  const errorHandler = handlePassportError(request, response, next);

  // Log a message, as he logged in with an external tenant
  const authInfo = {
    user,
    strategyId
  };
  logAuthenticationSuccess(request, authInfo, strategyId);

  // Create a session for this user
  request.logIn(authInfo, (error) => {
    if (error) {
      return errorHandler(error);
    }

    // The user now has a session within Express
    // We can now safely redirect the user into the system
    return response.redirect(redirectUrl);
  });
};

/**
 * Constructs the callback URL for a given strategy by doing a look-up whether or not the tenant is using https.
 * ex: Suppose the passed in tenant uses https and the passed in strategy is 'google', the returned url will be:
 *     https://<tenant host>/api/auth/google/callback
 *
 * @param  {Tenant} tenant      The tenant object
 * @param  {String} strategy    The strategy for this callback url
 * @return {String}             An authentication callback url
 */
const constructCallbackUrl = function (tenant, strategy) {
  const baseUrl = TenantsUtil.getBaseUrl(tenant);
  return baseUrl + '/api/auth/' + strategy + '/callback';
};

/**
 * Set one of the optional user profile parameters.
 * If the template or the result of the rendered template returns an empty string,
 * the profile parameter will not be set.
 *
 * @param  {Object}     profileParameters       The object where the profile parameter should be filled in
 * @param  {String}     profileParameterName    The name of the parameter. ex: `locale`, `email`, `timezone`, etc
 * @param  {String}     template                The template that can be used to generate the value for this profile parameter
 * @param  {Object}     data                    The data that can be used in the template
 */
const setProfileParameter = function (profileParameters, profileParameterName, template, data) {
  const renderedString = renderTemplate(template, data);
  if (renderedString) {
    profileParameters[profileParameterName] = renderedString;
  }
};

/**
 * Render a template that supports some basic variable replacement. Strings between curly braces
 * will be replaced with the value against the `data` key. Undefined variables will be replaced
 * with the empty string. In case the template was empty or an error occurred when rendering the template,
 * an empty string will be returned.
 *
 * e.g.:
 *    ```javascript
 *        var template = '{firstName} {lastName}';
 *        var data = {'firstName': 'John', 'lastName': 'Doe'};
 *        var displayName = renderTemplate(template, data);
 *    ```
 *    Result:
 *        John Doe
 *
 * @param  {String}     template    The template that should be ran
 * @param  {Object}     data        The data that can be used in the template
 * @return {String}                 The rendered template
 */
const renderTemplate = function (template, data) {
  if (!template) {
    return '';
  }

  const matcher = new RegExp(/{([\s\S]+?)}/g);
  const result = template.replace(matcher, (match, variableName) => {
    if (data[variableName]) {
      return data[variableName];
    }

    return '';
  });
  return result;
};

/**
 * Get the invitation info, if any, from the given request's redirect url
 *
 * @param  {Request}    req                             The express request from which to get the invitation info
 * @return {Object}     invitationInfo                  The invitation info, if any
 * @return {String}     invitationInfo.invitationEmail  The email associated to the invitation, if any
 * @return {String}     invitationInfo.invitationToken  The token of authenticity of the invitation
 * @api private
 */
const _getRequestInvitationInfo = function (request) {
  const redirectUrl = validateRedirectUrl(request.cookies.redirectUrl);
  const parsedRedirectUrl = new URL(redirectUrl, 'http://localhost');
  return _.pick(
    objectifySearchParams(parsedRedirectUrl.searchParams),
    'invitationToken',
    'invitationEmail'
  );
};

export {
  setupAuthMiddleware,
  hashAndComparePassword,
  hashPassword,
  getStrategyId,
  parseStrategyId,
  logAuthenticationSuccess,
  handlePassportError,
  handleExternalSetup,
  validateRedirectUrl,
  handleExternalGetOrCreateUser,
  handleExternalCallback,
  handleLogin,
  constructCallbackUrl,
  setProfileParameter,
  renderTemplate
};
