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

import * as ConfigAPI from 'oae-config';
import { logger } from 'oae-logger';
import * as TenantsUtil from 'oae-tenants/lib/util.js';

import * as AuthenticationAPI from 'oae-authentication';
import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationUtil from 'oae-authentication/lib/util.js';

import passport from 'passport-cas';

const CasStrategy = passport.Strategy;

const log = logger('oae-authentication');

const AuthenticationConfig = ConfigAPI.setUpConfig('oae-authentication');

function initCasAuth() {
  const strategy = {};

  /**
   * @see oae-authentication/lib/strategy#shouldBeEnabled
   */
  strategy.shouldBeEnabled = function (tenantAlias) {
    return AuthenticationConfig.getValue(
      tenantAlias,
      AuthenticationConstants.providers.CAS,
      'enabled'
    );
  };

  /**
   * @see oae-authentication/lib/strategy#getPassportStrategy
   */
  strategy.getPassportStrategy = function (tenant) {
    // We fetch the config values *in* the getPassportStrategy so it can be re-configured at run-time.
    const casHost = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.CAS,
      'url'
    );
    const loginPath = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.CAS,
      'loginPath'
    );
    const validatePath = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.CAS,
      'validatePath'
    );
    const mapDisplayName = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.CAS,
      'mapDisplayName'
    ).toLowerCase();
    const mapEmail = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.CAS,
      'mapEmail'
    ).toLowerCase();
    const mapLocale = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.CAS,
      'mapLocale'
    ).toLowerCase();
    const useSaml = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.CAS,
      'useSaml'
    );

    const serverBase = TenantsUtil.getBaseUrl(tenant);

    const passportStrategy = new CasStrategy(
      {
        allow: '',
        appLogoutPath: '/api/auth/logout',
        ssoBaseURL: casHost,
        serverBaseURL: serverBase,
        version: 'CAS3.0',
        loginURL: loginPath,
        passReqToCallback: true,
        serviceURL: '/api/auth/cas/callback',
        validateURL: validatePath,
        useSaml
      },
      (request, casResponse, done) => {
        log().trace(
          {
            tenant,
            casResponse
          },
          'Received CAS authentication callback.'
        );

        const username = casResponse.user;
        let displayName = casResponse.user;
        const options = {
          authoritative: true
        };

        // If the CAS server returned attributes we try to map them to OAE profile parameters
        if (casResponse.attributes) {
          // Try to use a mapped displayname rather than the default CAS id
          const mappedDisplayName = AuthenticationUtil.renderTemplate(
            mapDisplayName,
            casResponse.attributes
          );
          if (mappedDisplayName) {
            displayName = mappedDisplayName;
          }

          // Set the optional profile parameters
          AuthenticationUtil.setProfileParameter(
            options,
            'email',
            mapEmail,
            casResponse.attributes
          );
          AuthenticationUtil.setProfileParameter(
            options,
            'locale',
            mapLocale,
            casResponse.attributes
          );
        }

        AuthenticationUtil.handleExternalGetOrCreateUser(
          request,
          AuthenticationConstants.providers.CAS,
          username,
          null,
          displayName,
          options,
          done
        );
      }
    );
    return passportStrategy;
  };

  /**
   * Sends the user to the configured CAS logout redirect URL
   *
   * @param  {Request}    req     The expressJS request object
   * @param  {Response}   res     The expressJS response object
   */
  strategy.logout = function (request, response) {
    const tenant = request.ctx.tenant();
    const logoutUrl = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.CAS,
      'logoutUrl'
    );

    // If no logout URL is specified, we simply redirect to the index page
    if (!logoutUrl) {
      return response.redirect('/');
    }

    // Otherwise we send the user off to the specified URL
    return response.redirect(logoutUrl);
  };

  // Register our strategy
  AuthenticationAPI.registerStrategy(AuthenticationConstants.providers.CAS, strategy);
}

export { initCasAuth as default };
