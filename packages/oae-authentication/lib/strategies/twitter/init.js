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

import twitterPassport from 'passport-twitter';

import * as ConfigAPI from 'oae-config';
import { logger } from 'oae-logger';

import * as AuthenticationAPI from 'oae-authentication';
import { AuthenticationConstants } from 'oae-authentication/lib/constants';
import * as AuthenticationUtil from 'oae-authentication/lib/util';

const TwitterStrategy = twitterPassport.Strategy;

const log = logger('oae-authentication');

const AuthenticationConfig = ConfigAPI.setUpConfig('oae-authentication');

export default function() {
  const strategy = {};

  /**
   * @see oae-authentication/lib/strategy#shouldBeEnabled
   */
  strategy.shouldBeEnabled = function(tenantAlias) {
    return AuthenticationConfig.getValue(tenantAlias, AuthenticationConstants.providers.TWITTER, 'enabled');
  };

  /**
   * @see oae-authentication/lib/strategy#getPassportStrategy
   */
  strategy.getPassportStrategy = function(tenant) {
    // We fetch the config values *in* the getPassportStrategy so it can be re-configured at run-time.
    const consumerKey = AuthenticationConfig.getValue(tenant.alias, AuthenticationConstants.providers.TWITTER, 'key');
    const consumerSecret = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.TWITTER,
      'secret'
    );

    const passportStrategy = new TwitterStrategy(
      {
        consumerKey,
        consumerSecret,
        callbackURL: AuthenticationUtil.constructCallbackUrl(tenant, AuthenticationConstants.providers.TWITTER),
        passReqToCallback: true
      },
      (req, token, tokenSecret, profile, done) => {
        log().trace(
          {
            tenant,
            profile
          },
          'Received Twitter authentication callback.'
        );

        // Use the Twitter handle to register this user.
        // Unfortunately Twitter doesn't hand out the e-mail address.
        // @see https://dev.twitter.com/discussions/4019
        const { displayName, username } = profile;
        const opts = {};
        let picture = profile._json.profile_image_url_https;
        if (picture) {
          // Use the better quality image
          // @see https://dev.twitter.com/docs/user-profile-images-and-banners
          picture = picture.replace(/_normal\.(.*)$/, '_bigger.$1');
          opts.smallPictureUri = 'remote:' + picture;
          opts.mediumPictureUri = 'remote:' + picture;
        }

        AuthenticationUtil.handleExternalGetOrCreateUser(
          req,
          AuthenticationConstants.providers.TWITTER,
          username,
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
  AuthenticationAPI.registerStrategy(AuthenticationConstants.providers.TWITTER, strategy);
}
