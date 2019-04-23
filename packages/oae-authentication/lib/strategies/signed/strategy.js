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

import * as PrincipalsDAO from 'oae-principals/lib/internal/dao';

import { AuthenticationConstants } from 'oae-authentication/lib/constants';
import * as AuthenticationSignedUtil from 'oae-authentication/lib/strategies/signed/util';
import * as AuthenticationUtil from 'oae-authentication/lib/util';

const Strategy = function() {
  passport.Strategy.call(this);
  this.name = 'signed';
};

/**
 * Inherit from `passport.Strategy`
 */
util.inherits(Strategy, passport.Strategy);

/**
 * Authenticate request based on the contents of request parameters
 *
 * @param  {Request}    req     The Express Request object that is trying to authenticate
 * @api protected
 */
Strategy.prototype.authenticate = function(req) {
  const self = this;

  // Verify and extract the signed body from the request
  AuthenticationSignedUtil.verifySignedAuthenticationBody(req.ctx, req.body, (err, userId, becomeUserId) => {
    if (err) {
      return self.fail(err.msg, err.code);
    }

    // Will hold the user and imposter (if any) for the authentication callback
    let authObj = null;
    let strategyId = null;

    // This is a valid request, get the user and pass it on
    PrincipalsDAO.getPrincipal(userId, (err, user) => {
      if (err && err.code !== 404) {
        // Ensure there wasn't un unexpected error fetching the user
        return self.error(new Error(err.msg));
      }

      if (err && err.code === 404) {
        // Ensure the authenticating user exists
        return self.fail(err.msg, 404);
      }

      if (!becomeUserId) {
        // If the user is not trying to impersonate someone else, we can
        // simply authenticate normally as this user
        strategyId = AuthenticationUtil.getStrategyId(user.tenant, AuthenticationConstants.providers.SIGNED);
        authObj = { user, strategyId };
        AuthenticationUtil.logAuthenticationSuccess(req, authObj, self.name);
        return self.success(authObj);
      }

      // If we get here we are trying to become someone, fetch that person
      // and perform the appropriate permission checks
      PrincipalsDAO.getPrincipal(becomeUserId, (err, becomeUser) => {
        if (err && err.code !== 404) {
          // Ensure there wasn't un unexpected error fetching the target user
          return self.error(new Error(err.msg));
        }

        if (err && err.code === 404) {
          // Ensure the impersonated user exists
          return self.fail(err.msg, 404);
        }

        if (!user.isAdmin(becomeUser.tenant.alias)) {
          // Ensure the authenticated user (impersonator) has the required access to become this user
          return self.fail('You are not authorized to become the target user', 401);
        }

        strategyId = AuthenticationUtil.getStrategyId(user.tenant, AuthenticationConstants.providers.SIGNED);
        authObj = { user: becomeUser, imposter: user, strategyId };
        AuthenticationUtil.logAuthenticationSuccess(req, authObj, self.name);
        return self.success(authObj);
      });
    });
  });
};

/**
 * Expose `Strategy`
 */
export default Strategy;
