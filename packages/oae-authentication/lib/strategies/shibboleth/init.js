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

import { callbackify } from 'node:util';
import _ from 'underscore';

import { AuthzConstants } from 'oae-authz/lib/constants.js';
import * as Cassandra from 'oae-util/lib/cassandra.js';
import * as ConfigAPI from 'oae-config';
import { logger } from 'oae-logger';

import * as AuthenticationAPI from 'oae-authentication';
import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthenticationUtil from 'oae-authentication/lib/util.js';

import * as ShibbolethAPI from './api.js';
import ShibbolethStrategy from './strategy.js';

const log = logger('oae-authentication');

const AuthenticationConfig = ConfigAPI.setUpConfig('oae-authentication');

function initShibbAuth(config) {
  // Refresh the shibboleth configuration
  ShibbolethAPI.refreshConfiguration(config);

  // Build up the OAE strategy
  const strategy = {};

  /**
   * @see oae-authentication/lib/strategy#shouldBeEnabled
   */
  strategy.shouldBeEnabled = ShibbolethAPI.isEnabled;

  /**
   * @see oae-authentication/lib/strategy#getPassportStrategy
   */
  strategy.getPassportStrategy = function (tenant) {
    // We fetch the config values *in* the getPassportStrategy so it can be re-configured at run-time

    // The entity ID of the Shibboleth IdP
    const idpEntityID = AuthenticationConfig.getValue(
      tenant.alias,
      AuthenticationConstants.providers.SHIBBOLETH,
      'idpEntityID'
    );

    const passportStrategy = new ShibbolethStrategy(
      {
        idpEntityID,
        passReqToCallback: true
      },
      (request, headers, callback) => {
        log().trace(
          {
            tenant,
            headers
          },
          'Received Shibboleth authentication callback'
        );

        // The external ID is configurable in the admin UI as a priority list (similar to
        // how `mod_shib` works). We try to find an attribute in the released set that matches
        // any of the configurable attributes. Rather than relying on `mod_shib`'s `remote_user`
        // attribute, we rely on the configured list as it allows administrators to specify
        // attributes on a per-tenant basis. We use `remote_user` as the fall back value
        const externalId = _getBestAttributeValue(
          tenant.alias,
          'externalIdAttributes',
          headers,
          headers.remote_user
        );
        if (!externalId) {
          log().error(
            { headers, tenant },
            'No suitable attribute was found for the `externalId` attribute'
          );
          return callback({
            code: 500,
            msg: 'No suitable attribute was found for the `externalId` attribute'
          });
        }

        // There are a lot of SAML attributes that may indicate a user's display name. The administrator
        // should provide a suitable priority list to construct the display name. If no suitable value was
        // returned from the mapping, we fall back to the `remote_user` attribute, as this is always provided
        const displayName = _getBestAttributeValue(
          tenant.alias,
          'mapDisplayName',
          headers,
          headers.remote_user
        );

        // Set the optional profile parameters
        const options = {
          authoritative: true
        };

        const invalid = /https?:\/\/|shibboleth!|@/i;
        // Set users whose name resembles a Shibboleth identifier as private (eg. starts with http://)
        if (invalid.test(displayName)) {
          options.visibility = AuthzConstants.visibility.PRIVATE;
        }

        // Get an email address from the provided headers
        options.email = _getBestAttributeValue(tenant.alias, 'mapEmail', headers);

        // Get a locale, if any
        const locale = _getBestAttributeValue(tenant.alias, 'mapLocale', headers, headers.locale);
        if (locale && /^[a-z]{2}_[A-Z]{2}$/.test(locale)) {
          options.locale = locale;
        }

        // Ensure the tenant is set on the request
        request.tenant = tenant;
        AuthenticationUtil.handleExternalGetOrCreateUser(
          request,
          AuthenticationConstants.providers.SHIBBOLETH,
          externalId,
          null,
          displayName,
          options,
          (error, user, loginId, created) => {
            if (error) {
              return callback(error);

              // There is no need to persist the metadata when the user account already exists
            }

            if (!created) {
              return callback(null, user);
            }

            // Remove unneeded headers as we need to serialize it
            delete headers['x-real-ip'];
            delete headers['x-forwarded-for'];
            delete headers.host;
            delete headers['x-nginx-proxy'];
            delete headers['cache-control'];
            delete headers['x-cache-control'];
            delete headers.accept;
            delete headers['user-agent'];
            delete headers.referer;
            delete headers['accept-encoding'];
            delete headers['accept-language'];
            delete headers.cookie;
            delete headers['x-forwarded-host'];
            delete headers['x-forwarded-server'];

            // We store extra information as it might be useful later on
            const metadata = {
              /*
               * The Shib persistent ID is a triple of:
               *    * The IdP's entity ID
               *    * The SP's entity ID
               *    * A randomly generated ID identifying the user
               *  e.g.: https://idp.testshib.org/idp/shibboleth!https://shib-sp.oae-performance.oaeproject.org/shibboleth!wjsKmFPZ7Kjml9HqD0Dbio5vzVo=
               *
               * This ID can be used with the IdP to retrieve profile attributes of the user or to check if that user
               * is still part of the organization. We store it for use it later on.
               * @see https://wiki.shibboleth.net/confluence/display/SHIB2/IdPPersistentNameIdentifier
               */
              persistentId: headers['persistent-id'],

              // The entity ID of the IdP
              identityProvider: headers['shib-identity-provider'],

              // Affiliation information
              affiliation: headers.affiliation,
              unscopedAffiliation: headers['unscoped-affiliation']
            };
            const q = Cassandra.constructUpsertCQL(
              'ShibbolethMetadata',
              'loginId',
              loginId,
              metadata
            );
            if (!q) {
              log().error(
                {
                  loginId,
                  metadata,
                  headers,
                  user
                },
                'Unable to construct a Shibboleth metadata query'
              );
              return callback({ code: 500, msg: 'Unable to store Shibboleth metadata' });
            }

            callbackify(Cassandra.runQuery)(q.query, q.parameters, (error_) => {
              if (error_) {
                return callback(error_);
              }

              return callback(null, user);
            });
          }
        );
      }
    );
    return passportStrategy;
  };

  // Register our strategy
  AuthenticationAPI.registerStrategy(AuthenticationConstants.providers.SHIBBOLETH, strategy);
}

/**
 * Get the value from the attribute that best matches a configured priority list
 *
 * @param  {String}     tenantAlias         The alias of the tenant for which to retrieve the priority list
 * @param  {String}     configKey           The key of the element that holds the priority list
 * @param  {Object}     headers             The headers that were passed along by mod_shib
 * @param  {String}     [defaultValue]      A default value that can be fallen back to
 * @return {String}                         The value of the attribute that best matched the configured priority list
 * @api private
 */
const _getBestAttributeValue = function (tenantAlias, configKey, headers, defaultValue) {
  // Get the priority list from the config
  let priorityList = AuthenticationConfig.getValue(
    tenantAlias,
    AuthenticationConstants.providers.SHIBBOLETH,
    configKey
  );
  priorityList = _.chain(priorityList.split(' ')).compact().uniq().value();

  const attribute = _.find(
    priorityList,
    (attribute) => headers[attribute] && headers[attribute] !== defaultValue
  );

  const value = headers[attribute] || defaultValue;
  return value;
};

export { initShibbAuth as default };
