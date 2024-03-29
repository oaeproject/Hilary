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

import passport from 'passport-ldapauth';

import * as ConfigAPI from 'oae-config';
import { Context } from 'oae-context';
import { logger } from 'oae-logger';

import * as AuthenticationAPI from 'oae-authentication';
import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';

const LDAPStrategy = passport.Strategy;
const log = logger('oae-authentication');

const AuthenticationConfig = ConfigAPI.setUpConfig('oae-authentication');

function initLDAPAuth() {
  const strategy = {};

  /**
   * @see oae-authentication/lib/strategy#shouldBeEnabled
   */
  strategy.shouldBeEnabled = function (tenantAlias) {
    return AuthenticationConfig.getValue(tenantAlias, 'ldap', 'enabled');
  };

  /**
   * @see oae-authentication/lib/strategy#getPassportStrategy
   */
  strategy.getPassportStrategy = function (tenant) {
    // Server config
    const url = AuthenticationConfig.getValue(tenant.alias, 'ldap', 'url');
    const adminDn = AuthenticationConfig.getValue(tenant.alias, 'ldap', 'adminDn');
    const adminPassword = AuthenticationConfig.getValue(tenant.alias, 'ldap', 'adminPassword');
    const searchBase = AuthenticationConfig.getValue(tenant.alias, 'ldap', 'searchBase');
    const searchFilter = AuthenticationConfig.getValue(tenant.alias, 'ldap', 'searchFilter');

    // The LDAP Attribute names
    const mapDisplayName = AuthenticationConfig.getValue(tenant.alias, 'ldap', 'mapDisplayName');
    const mapExternalId = AuthenticationConfig.getValue(tenant.alias, 'ldap', 'mapExternalId');
    const mapEmail = AuthenticationConfig.getValue(tenant.alias, 'ldap', 'mapEmail');
    const mapLocale = AuthenticationConfig.getValue(tenant.alias, 'ldap', 'mapLocale');

    if (!mapExternalId || !mapDisplayName) {
      log().error(
        'The LDAP externalId and displayName attributes must be configured in order for this strategy to be enabled.'
      );
      return false;
    }

    const options = {
      server: {
        url,
        adminDn,
        adminPassword,
        searchBase,
        searchFilter
      }
    };
    const passportStrategy = new LDAPStrategy(options, (profile, done) => {
      log().trace(
        {
          tenant,
          profile
        },
        'Received LDAP authentication callback.'
      );

      // Re-use the username as the external id
      const externalId = profile[mapExternalId];
      const displayName = profile[mapDisplayName];
      const options_ = {};
      if (mapEmail) {
        options_.email = profile[mapEmail];
        if (options_.email) {
          options_.emailVerified = true;
        }
      }

      if (mapLocale) {
        options_.locale = profile[mapLocale];
      }

      const ctx = new Context(tenant, null);
      AuthenticationAPI.getOrCreateUser(
        ctx,
        AuthenticationConstants.providers.LDAP,
        externalId,
        null,
        displayName,
        options_,
        done
      );
    });
    return passportStrategy;
  };

  // Register our strategy.
  AuthenticationAPI.registerStrategy(AuthenticationConstants.providers.LDAP, strategy);
}

export { initLDAPAuth as default };
