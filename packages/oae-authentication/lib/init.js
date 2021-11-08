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

import crypto from 'node:crypto';
import fastifyPassport from 'fastify-passport';
import { Context } from 'oae-context';
import * as OAE from 'oae-util/lib/oae.js';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao.js';
import initCas from './strategies/cas/init.js';
import initFacebook from './strategies/facebook/init.js';
import initGoogle from './strategies/google/init.js';
import initLDAP from './strategies/ldap/init.js';
import { initLocalAuth } from './strategies/local/init.js';
import initOAuth from './strategies/oauth/init.js';
import initShibb from './strategies/shibboleth/init.js';
import initSigned from './strategies/signed/init.js';
import initTwitter from './strategies/twitter/init.js';

import * as AuthenticationAPI from './api.js';
import { AuthenticationConstants } from './constants.js';
import * as AuthenticationUtil from './util.js';

export function init(config, callback) {
  // Attach the Authentication middleware
  AuthenticationUtil.setupAuthMiddleware(config, OAE.globalAdminServer);
  AuthenticationUtil.setupAuthMiddleware(config, OAE.tenantServer);

  // Setup the fastify-passport serializers
  setupPassportSerializers(config.cookie.secret);

  AuthenticationAPI.init(config.servers.globalAdminAlias);

  initCas(config);
  initFacebook(config);
  initGoogle(config);
  initLDAP(config);
  initLocalAuth(config);
  initOAuth(config);
  initShibb(config);
  initSigned(config);
  initTwitter(config);

  /**
   * Add the OAE middleware to the ExpressJS server
   * We do this *AFTER* all the authentication strategies have been initialized
   * so they have a chance to add any middleware that could set the logged in user
   */
  // OAE.tenantServer.use(contextMiddleware);
  // OAE.globalAdminServer.use(contextMiddleware);
  OAE.tenantServer.addHook('preValidation', contextMiddleware);
  OAE.globalAdminServer.addHook('preValidation', contextMiddleware);

  return callback();
}

/**
 * Express.js middleware that will stick an OAE `Context` object on each request at `req.ctx`. This
 * context object will contain the current tenant and currently authenticated user (if any).
 *
 * @param  {Request}    req     The Express.js request
 * @param  {Response}   res     The express.js response
 * @param  {Function}   next    Standard callback function
 */
const contextMiddleware = function (request, _response, next) {
  let user = null;
  let imposter = null;
  const authenticationStrategy = null;

  // If we have an authenticated request, store the user and imposter (if any) in the context
  if (request.oaeAuthInfo && request.oaeAuthInfo.user) {
    ({ user, imposter } = request.oaeAuthInfo);
  }

  request.ctx = new Context(request.tenant, user, authenticationStrategy, null, imposter);
  return next();
};

/**
 * Sets up the serialization methods for passport.
 * This should only be run once.
 *
 * @api private
 */
const setupPassportSerializers = function (cookieSecret) {
  /**
   * Serialize the current user and potential imposter
   * ids into the session cookie
   */
  fastifyPassport.registerUserSerializer((oaeAuthInfo, done) => {
    const toSerialize = {};
    if (oaeAuthInfo.user) {
      toSerialize.userId = oaeAuthInfo.user.id;
      if (oaeAuthInfo.imposter) {
        toSerialize.imposterId = oaeAuthInfo.imposter.id;
      }

      if (oaeAuthInfo.strategyId) {
        toSerialize.strategyId = oaeAuthInfo.strategyId;
      }

      // Emit a logged in event
      if (oaeAuthInfo.imposter) {
        AuthenticationAPI.emitter.emit(
          AuthenticationConstants.events.USER_IMPOSTERED,
          oaeAuthInfo.imposter,
          oaeAuthInfo.user
        );
      } else {
        const { strategyName } = AuthenticationUtil.parseStrategyId(oaeAuthInfo.strategyId);
        AuthenticationAPI.emitter.emit(
          AuthenticationConstants.events.USER_LOGGED_IN,
          oaeAuthInfo.user,
          strategyName
        );
      }
    }

    // Encrypt the serialized information so it cannot be tampered with
    const cookieData = _encryptCookieData(JSON.stringify(toSerialize), cookieSecret);

    // Pass the encrypted cookie data to passport
    return done(null, cookieData);
  });

  /**
   * The user's full session is serialized into a cookie. When passport says "deserialize user", they're
   *  actually saying "deserialize user's session". In which we store the user's id and session imposter,
   * if any
   */
  fastifyPassport.registerUserDeserializer((toDeserialize, callback) => {
    let sessionData = _decryptCookieData(toDeserialize, cookieSecret);

    try {
      // Parse the cookie data into a JSON object
      sessionData = JSON.parse(sessionData);
    } catch {
      // If JSON parsing fails, the user cookie has malformed session data (or it was tampered). We'll
      // just continue with an empty session, which means the user is effectively anonymous
      sessionData = {};
    }

    // If there is no user in the session, we short-circuit with an anonymous session
    if (!sessionData.userId) {
      return callback(null, false);
    }

    // Get the effective user of the session
    PrincipalsDAO.getPrincipal(sessionData.userId, (error, user) => {
      if (error && error.code === 404) {
        // If the user does not exist, the session is toast
        return callback(null, false);
      }

      if (error) {
        // If an unexpected error occurred, return an error
        return callback(error);
      }

      if (user.deleted) {
        // The user has been deleted, the session is toast
        return callback(null, false);
      }

      if (!sessionData.imposterId) {
        // There is no impostering happening here, so we just
        // treat this like a normal session
        return callback(null, { user, strategyId: sessionData.strategyId });
      }

      // If we get here, the session user is being impostered by someone else
      PrincipalsDAO.getPrincipal(sessionData.imposterId, (error, imposterUser) => {
        if (error && error.code === 404) {
          // If the user does not exist, the session is toast
          return callback(null, false);
        }

        if (error) {
          // If an unexpected error occurred, return an error
          return callback(error);
        }

        if (imposterUser.deleted) {
          // Burn any sessions being impostered by a deleted user
          return callback(null, false);
        }

        // Set the user (and potential imposter) on the request so it can be
        // picked up and set on the API context
        return callback(null, {
          user,
          imposter: imposterUser,
          strategyId: sessionData.strategyId
        });
      });
    });
  });
};

/**
 * Encrypt a piece of cookie data to be sent back to the client.
 *
 * @param  {String}     cookieData      The data to encrypt
 * @param  {String}     cookieSecret    The secret string to encrypt the data with
 * @return {String}                     The encrypted data that is safe to return to the client
 * @api private
 */
const _encryptCookieData = function (cookieData, cookieSecret) {
  const cipher = crypto.createCipher('aes-256-cbc', cookieSecret);
  return cipher.update(cookieData, 'utf8', 'base64') + cipher.final('base64');
};

/**
 * Decrypt a piece of cookie data that was provided by the client.
 *
 * @param  {String}     encryptedData   The encrypted data to decrypt
 * @param  {String}     cookieSecret    The secret string to encrypt the data with
 * @return {String}                     The decrypted cookie data
 * @api private
 */
const _decryptCookieData = function (encryptedData, cookieSecret) {
  const decipher = crypto.createDecipher('aes-256-cbc', cookieSecret);
  return decipher.update(encryptedData, 'base64', 'utf8') + decipher.final('utf8');
};
