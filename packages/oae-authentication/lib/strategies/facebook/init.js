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

import passport from 'passport-facebook';

import * as ConfigAPI from 'oae-config';
import { logger } from 'oae-logger';

import * as AuthenticationAPI from 'oae-authentication';
import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationUtil from 'oae-authentication/lib/util.js';

const FacebookStrategy = passport.Strategy;
const log = logger('oae-authentication');

const AuthenticationConfig = ConfigAPI.setUpConfig('oae-authentication');

function initFacebookAuth() {
  const strategy = {};

  /**
   * @see oae-authentication/lib/strategy#shouldBeEnabled
   */
  strategy.shouldBeEnabled = function (tenantAlias) {
    return AuthenticationConfig.getValue(
      tenantAlias,
      AuthenticationConstants.providers.FACEBOOK,
      'enabled'
    );
  };

  /**
   * @see oae-authentication/lib/strategy#getPassportStrategy
   */
  strategy.getPassportStrategy = function (tenant) {
    // We fetch the config values *in* the getPassportStrategy so it can be re-configured at run-time.
    const clientID = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.FACEBOOK,
      'appid'
    );
    const clientSecret = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.FACEBOOK,
      'secret'
    );

    const passportStrategy = new FacebookStrategy(
      {
        clientID,
        clientSecret,
        passReqToCallback: true,
        profileFields: ['id', 'displayName', 'photos', 'emails'],
        callbackURL: AuthenticationUtil.constructCallbackUrl(
          tenant,
          AuthenticationConstants.providers.FACEBOOK
        )
      },
      (request, accessToken, refreshToken, profile, done) => {
        log().trace({ tenant, profile }, 'Received Facebook authentication callback');

        const externalId = profile.id;
        const { displayName } = profile;
        const options = { locale: profile._json.locale };

        const { picture } = profile._json;
        if (picture && picture.data && picture.data.url && !picture.data.is_silhouette) {
          options.smallPictureUri = 'remote:' + picture.data.url;
          options.mediumPictureUri = 'remote:' + picture.data.url;
        }

        if (profile.emails && profile.emails.length > 0 && profile.emails[0].value) {
          options.email = profile.emails[0].value;
        }

        AuthenticationUtil.handleExternalGetOrCreateUser(
          request,
          AuthenticationConstants.providers.FACEBOOK,
          externalId,
          null,
          displayName,
          options,
          done
        );
      }
    );
    return passportStrategy;
  };

  // Register our strategy.
  AuthenticationAPI.registerStrategy(AuthenticationConstants.providers.FACEBOOK, strategy);
}

export default initFacebookAuth;
