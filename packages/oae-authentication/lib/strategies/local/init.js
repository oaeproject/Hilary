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

import passportLocal from 'passport-local';
import passport from 'passport';

import * as ConfigAPI from 'oae-config';
import { Context } from 'oae-context';
import PrincipalsAPI from 'oae-principals';
import { User } from 'oae-principals/lib/model';

import * as AuthenticationAPI from 'oae-authentication';
import { AuthenticationConstants } from 'oae-authentication/lib/constants';
import * as AuthenticationUtil from 'oae-authentication/lib/util';

const LocalStrategy = passportLocal.Strategy;

const AuthenticationConfig = ConfigAPI.setUpConfig('oae-authentication');

let globalTenantAlias = null;

function initLocalAuth(config) {
  globalTenantAlias = config.servers.globalAdminAlias;

  // Build up the OAE strategy.
  const strategy = {};

  /**
   * @see oae-authentication/lib/strategy#shouldBeEnabled
   */
  strategy.shouldBeEnabled = function (tenantAlias) {
    // The global tenant should always have local login enabled.
    if (tenantAlias === globalTenantAlias) {
      return true;

      // Otherwise we need to check the configuration.
    }

    return AuthenticationConfig.getValue(
      tenantAlias,
      AuthenticationConstants.providers.LOCAL,
      'enabled'
    );
  };

  /**
   * @see oae-authentication/lib/strategy#getPassportStrategy
   */
  strategy.getPassportStrategy = function () {
    const passportStrategy = new LocalStrategy(
      { passReqToCallback: true },
      (request, username, password, done) => {
        const { tenant } = request;

        AuthenticationAPI.checkPassword(tenant.alias, username, password, (error, userId) => {
          if (error && error.code === 401) {
            // The provided password was incorrect
            return done(null, false);
          }

          if (error) {
            // Some internal error occurred
            return done(error);
          }

          // By this point we know that we were succesfully logged in. Retrieve
          // the user account and stick it in the context.
          const ctx = new Context(tenant, new User(tenant.alias, userId));
          PrincipalsAPI.getUser(ctx, userId, (error, user) => {
            if (error) {
              return done(error);
            }

            if (user.deleted) {
              return done(null, false);
            }

            const strategyId = AuthenticationUtil.getStrategyId(
              tenant,
              AuthenticationConstants.providers.LOCAL
            );
            const authObject = { user, strategyId };
            AuthenticationUtil.logAuthenticationSuccess(
              request,
              authObject,
              AuthenticationConstants.providers.LOCAL
            );
            return done(null, authObject);
          });
        });
      }
    );

    return passportStrategy;
  };

  // Register our strategy.
  AuthenticationAPI.registerStrategy(AuthenticationConstants.providers.LOCAL, strategy);

  // The local strategy is the only strategy that we register on the global admin server. As
  // this is a special case, it's OK to hardcode it.
  const globalTenant = { alias: globalTenantAlias };
  const adminLocalPassportStrategyName = AuthenticationUtil.getStrategyId(
    globalTenant,
    AuthenticationConstants.providers.LOCAL
  );
  passport.use(adminLocalPassportStrategyName, strategy.getPassportStrategy(globalTenant));
}

export default initLocalAuth;
