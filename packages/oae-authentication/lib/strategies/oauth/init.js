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

import passportBearer from 'passport-http-bearer';
import passport from 'passport';

import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationUtil from 'oae-authentication/lib/util.js';
import * as OAE from 'oae-util/lib/oae.js';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao.js';
import { telemetry } from 'oae-telemetry';

import * as OAuthDAO from './internal/dao.js';

const BearerStrategy = passportBearer.Strategy;
const Telemetry = telemetry('oauth');

// Used to check if the authorization header starts with "Bearer "
const BEARER_REGEX = /^bearer /i;

function initOAuthAuth() {
  /*!
   * This strategy is used to authenticate users based on an access token (aka a bearer token).
   *
   * @see http://tools.ietf.org/html/rfc6750
   */
  passport.use(
    new BearerStrategy((accessToken, callback) => {
      OAuthDAO.AccessTokens.getAccessToken(accessToken, (error, token) => {
        if (error) {
          return callback(error);
        }

        if (!token) {
          return callback(null, false);
        }

        // The access token exists in the DB, authenticate the request with the associated user ID
        PrincipalsDAO.getPrincipal(token.userId, (error, user) => {
          if (error && error.code === 404) {
            return callback(null, false);
          }

          if (error) {
            return callback(error);
          }

          // Although OAE doesn't use OAuth scopes, we need to pass one in the callback
          return callback(null, { user }, { scope: '*' });
        });
      });
    })
  );

  /*!
   * This middleware will apply "OAuth: Bearer Token" authentication if it detects
   * that there is a token in the request. This needs to run before any other middleware that does something with
   * the user, as this middleware will put the `user` object on the request.
   */
  OAE.tenantServer.use((request, response, next) => {
    if (!_hasAccessToken(request)) {
      // Don't invoke the OAuth workflow if there is no OAuth access token
      return next();
    }

    passport.authenticate(['bearer'], { session: false })(request, response, () => {
      if (request.oaeAuthInfo && request.oaeAuthInfo.user) {
        Telemetry.incr('success');

        // We add the `oauth` strategyName in the authentication info
        request.oaeAuthInfo.strategyId = AuthenticationUtil.getStrategyId(
          request.oaeAuthInfo.user.tenant,
          AuthenticationConstants.providers.OAUTH
        );

        // If the user has authenticated via OAuth, we can skip the CSRF validation check
        request._checkCSRF = false;
      } else {
        Telemetry.incr('fail');
      }

      // In either case, we need to move on to the next middleware
      return next();
    });
  });
}

export default initOAuthAuth;

/**
 * Find an OAuth access token in the HTTP request.
 *
 * @param  {Request}    req     The HTTP request in which to look for the OAuth access token
 * @return {Boolean}            Whether or not the request contains an OAuth access token
 */
const _hasAccessToken = function (request) {
  return (
    (request.query && request.query.access_token) ||
    (request.body && request.body.access_token) ||
    (request.headers &&
      request.headers.authorization &&
      BEARER_REGEX.test(request.headers.authorization))
  );
};
