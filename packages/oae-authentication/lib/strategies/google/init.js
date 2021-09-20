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

import { format } from 'util';
import _ from 'underscore';
import passport from 'passport-google-oauth';

import * as ConfigAPI from 'oae-config';
import { logger } from 'oae-logger';

import * as AuthenticationAPI from 'oae-authentication';
import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationUtil from 'oae-authentication/lib/util.js';

const GoogleStrategy = passport.OAuth2Strategy;
const log = logger('oae-authentication');

const AuthenticationConfig = ConfigAPI.setUpConfig('oae-authentication');

function initGoogleAuth() {
  const strategy = {};

  /**
   * @see oae-authentication/lib/strategy#shouldBeEnabled
   */
  strategy.shouldBeEnabled = function (tenantAlias) {
    return AuthenticationConfig.getValue(
      tenantAlias,
      AuthenticationConstants.providers.GOOGLE,
      'enabled'
    );
  };

  /**
   * @see oae-authentication/lib/strategy#getPassportStrategy
   */
  strategy.getPassportStrategy = function (tenant) {
    // We fetch the config values *in* the getPassportStrategy so it can be re-configured at run-time.
    const key = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.GOOGLE,
      'key'
    );
    const secret = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.GOOGLE,
      'secret'
    );
    let domains = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.GOOGLE,
      'domains'
    ).split(',');

    // Ensure we can do simple string comparisons by filtering empty domains and trimming out spaces
    domains = _.chain(domains)
      .map((domain) => {
        return domain.trim().toLowerCase();
      })
      .compact()
      .value();

    // Set passport options
    const options = {
      clientID: key,
      clientSecret: secret,
      passReqToCallback: true,
      scope: ['profile', 'email'],
      callbackURL: AuthenticationUtil.constructCallbackUrl(
        tenant,
        AuthenticationConstants.providers.GOOGLE
      )
    };

    const passportStrategy = new GoogleStrategy(
      options,
      (request, accessToken, refreshToken, profile, done) => {
        log().trace(
          {
            tenant,
            profile
          },
          'Received Google authentication callback'
        );

        const email = profile.emails[0].value;

        // Ensure the email belongs to a domain we allow
        if (!_.isEmpty(domains)) {
          const emailDomain = email.split('@')[1];
          if (!_.contains(domains, emailDomain)) {
            const error = {
              code: 400,
              msg: format(
                'You tried to sign in with an email address that belongs to a domain (%s) that is not allowed access',
                emailDomain
              ),
              reason: 'domain_not_allowed'
            };
            return done(error);
          }
        }

        // Re-use the email address as the externalId
        const externalId = email;
        const { displayName } = profile;

        // We ignore the locale returned by google because it only specifies
        // the language, but not the region which isn't very useful
        const options_ = { email };
        const { picture } = profile._json;
        if (picture) {
          options_.smallPictureUri = 'remote:' + picture;
          options_.mediumPictureUri = 'remote:' + picture;
        }

        AuthenticationUtil.handleExternalGetOrCreateUser(
          request,
          AuthenticationConstants.providers.GOOGLE,
          externalId,
          null,
          displayName,
          options_,
          done
        );
      }
    );
    return passportStrategy;
  };

  // Register our strategy.
  AuthenticationAPI.registerStrategy(AuthenticationConstants.providers.GOOGLE, strategy);
}

export default initGoogleAuth;
