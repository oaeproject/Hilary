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

const AuthenticationAPI = require('oae-authentication');
const { AuthenticationConstants } = require('oae-authentication/lib/constants');
const AuthzUtil = require('oae-authz/lib/util');

const MixpanelUtil = require('oae-mixpanel/lib/util');

module.exports = function(client, config) {
  /*!
     * A user logs in
     */
  MixpanelUtil.listen(
    AuthenticationAPI,
    AuthenticationConstants.events.USER_LOGGED_IN,
    (user, strategyName) => {
      // Get the tenant alias from the user id
      const { tenantAlias } = AuthzUtil.getPrincipalFromId(user.id);

      // Don't track events from the global admin server (e.g. preview processing)
      if (tenantAlias === config.servers.globalAdminAlias) {
        return;
      }

      // Create a user profile for this user in Mixpanel
      client.people.set(user.id, {
        // Because of FERPA/legal reasons we don't send the real name of the user
        $name: user.id,

        // Pass along some of the user's data
        tenant: user.tenant.alias,
        strategy: strategyName,
        visibility: user.visibility,
        emailPreference: user.emailPreference
      });

      // Track the authentication event
      const params = {
        // eslint-disable-next-line camelcase
        distinct_id: user.id,
        tenant: tenantAlias,
        strategy: strategyName
      };
      client.track(AuthenticationConstants.events.USER_LOGGED_IN, params);
      client.people.increment(params.distinct_id, AuthenticationConstants.events.USER_LOGGED_IN);
    }
  );

  /*!
     * A user logs out
     */
  MixpanelUtil.listen(AuthenticationAPI, AuthenticationConstants.events.USER_LOGGED_OUT, ctx => {
    const params = MixpanelUtil.getBasicParameters(ctx);
    params.strategy = ctx.authenticationStrategy();
    client.track(AuthenticationConstants.events.USER_LOGGED_OUT, params);
    client.people.increment(params.distinct_id, AuthenticationConstants.events.USER_LOGGED_OUT);
  });

  /*!
     * A user imposters another user
     */
  MixpanelUtil.listen(
    AuthenticationAPI,
    AuthenticationConstants.events.USER_IMPOSTERED,
    (imposter, user) => {
      // Get the tenant alias from the user id
      const { tenantAlias } = AuthzUtil.getPrincipalFromId(imposter.id);
      const params = {
        // eslint-disable-next-line camelcase
        distinct_id: imposter.id,
        impostered: user.id,
        tenant: tenantAlias
      };
      client.track(AuthenticationConstants.events.USER_IMPOSTERED, params);
      client.people.increment(params.distinct_id, AuthenticationConstants.events.USER_IMPOSTERED);
    }
  );
};
