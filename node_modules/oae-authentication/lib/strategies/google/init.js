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

const util = require('util');
const _ = require('underscore');
const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;

const ConfigAPI = require('oae-config');
const log = require('oae-logger').logger('oae-authentication');

const AuthenticationAPI = require('oae-authentication');

const AuthenticationConfig = ConfigAPI.config('oae-authentication');
const { AuthenticationConstants } = require('oae-authentication/lib/constants');
const AuthenticationUtil = require('oae-authentication/lib/util');

module.exports = function() {
  const strategy = {};

  /**
   * @see oae-authentication/lib/strategy#shouldBeEnabled
   */
  strategy.shouldBeEnabled = function(tenantAlias) {
    return AuthenticationConfig.getValue(
      tenantAlias,
      AuthenticationConstants.providers.GOOGLE,
      'enabled'
    );
  };

  /**
   * @see oae-authentication/lib/strategy#getPassportStrategy
   */
  strategy.getPassportStrategy = function(tenant) {
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
      .map(domain => {
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
      (req, accessToken, refreshToken, profile, done) => {
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
            const err = {
              code: 400,
              msg: util.format(
                'You tried to sign in with an email address that belongs to a domain (%s) that is not allowed access',
                emailDomain
              ),
              reason: 'domain_not_allowed'
            };
            return done(err);
          }
        }

        // Re-use the email address as the externalId
        const externalId = email;
        const { displayName } = profile;

        // We ignore the locale returned by google because it only specifies
        // the language, but not the region which isn't very useful
        const opts = { email };
        const { picture } = profile._json;
        if (picture) {
          opts.smallPictureUri = 'remote:' + picture;
          opts.mediumPictureUri = 'remote:' + picture;
        }

        AuthenticationUtil.handleExternalGetOrCreateUser(
          req,
          AuthenticationConstants.providers.GOOGLE,
          externalId,
          null,
          displayName,
          opts,
          done
        );
      }
    );
    return passportStrategy;
  };

  // Register our strategy.
  AuthenticationAPI.registerStrategy(AuthenticationConstants.providers.GOOGLE, strategy);
};
