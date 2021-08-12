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

import { Bool, Text } from 'oae-config/lib/fields.js';
import { defaultTo } from 'ramda';

const yadaYadaOtherwise = defaultTo('yadayada');

export const title = 'OAE Authentication Module';
export const local = {
  name: 'Local Authentication',
  description: 'Allow local authentication for tenant',
  elements: {
    allowAccountCreation: new Bool(
      'Local Account Creation',
      'Allow users to create their own account',
      true
    ),
    enabled: new Bool('Local Authentication Enabled', 'Allow local authentication for tenant', true)
  }
};
export const google = {
  name: 'Google Authentication',
  description: 'Allow Google authentication for tenant',
  elements: {
    enabled: new Bool(
      'Google Authentication Enabled',
      'Allow Google authentication for tenant',
      false
    ),
    key: new Text(
      'Google client ID',
      'Google client ID',
      yadaYadaOtherwise(process.env.GOOGLE_CLIENT_ID),
      {
        suppress: true
      }
    ),
    secret: new Text(
      'Google client secret',
      'Google client secret',
      yadaYadaOtherwise(process.env.GOOGLE_CLIENT_SECRET),
      {
        suppress: true
      }
    ),
    domains: new Text(
      'Google domain(s)',
      'A comma-separated list of allowed email domains (optional)',
      ''
    )
  }
};
export const twitter = {
  name: 'Twitter Authentication',
  description: 'Allow Twitter authentication for tenant',
  elements: {
    enabled: new Bool(
      'Twitter Authentication Enabled',
      'Allow Twitter authentication for tenant',
      true
    ),
    key: new Text(
      'Twitter consumer key',
      'Twitter consumer key',
      yadaYadaOtherwise(process.env.TWITTER_KEY),
      {
        suppress: true
      }
    ),
    secret: new Text(
      'Twitter consumer secret',
      'Twitter consumer secret',
      yadaYadaOtherwise(process.env.TWITTER_SECRET),
      {
        suppress: true
      }
    )
  }
};
export const facebook = {
  name: 'Facebook Authentication',
  description: 'Allow Facebook authentication for tenant',
  elements: {
    enabled: new Bool(
      'Facebook Authentication Enabled',
      'Allow Facebook authentication for tenant',
      false
    ),
    appid: new Text(
      'Facebook App ID',
      'Facebook App ID',
      yadaYadaOtherwise(process.env.FACEBOOK_APP_ID),
      {
        suppress: true
      }
    ),
    secret: new Text('Secret', 'Secret', yadaYadaOtherwise(process.env.FACEBOOK_APP_SECRET), {
      suppress: true
    })
  }
};
export const shibboleth = {
  name: 'Shibboleth Authentication',
  description: 'Allow Shibboleth authentication for tenant',
  elements: {
    enabled: new Bool(
      'Shibboleth Authentication Enabled',
      'Allow Shibboleth authentication for tenant',
      false
    ),
    name: new Text('Name', 'A name that users will recognize as their identity provider', ''),
    idpEntityID: new Text('Identity Provider entity ID', 'The entity ID of the IdP', '', {
      suppress: true
    }),
    externalIdAttributes: new Text(
      'External ID Attribute',
      'The attribute that uniquely identifies the user. This should be a prioritised space seperated list',
      'persistent-id targeted-id eppn',
      { suppress: true }
    ),
    mapDisplayName: new Text(
      'Display name',
      'The attibute(s) that should be used to construct the displayname. This should be a prioritised space seperated list. e.g., `displayname cn`',
      'displayname cn',
      { suppress: true }
    ),
    mapEmail: new Text(
      'Email',
      'The attibute(s) that should be used to construct the email. This should be a prioritised space seperated list. e.g., `mail email eppn`',
      'mail email eppn',
      { suppress: true }
    ),
    mapLocale: new Text(
      'Locale',
      'The attibute(s) that should be used to construct the locale. This should be a prioritised space seperated list. e.g., `locality locale`',
      'locality locale',
      { suppress: true }
    )
  }
};
export const cas = {
  name: 'CAS Authentication',
  description: 'Allow CAS authentication for tenant',
  elements: {
    enabled: new Bool('CAS Authentication Enabled', 'Allow CAS authentication for tenant', false),
    name: new Text('Name', 'A name that users will recognize as their identity provider', ''),
    url: new Text(
      'Host',
      'The URL at which the CAS server can be reached. This should include http(s)://, any non-standard port and any base path with no trailing slash',
      '',
      { suppress: true }
    ),
    loginPath: new Text(
      'Login Path',
      'The path to which the user should be redirected to start the authentication flow',
      '/login',
      { suppress: true }
    ),
    useSaml: new Bool(
      'Use SAML',
      'Use SAML to get CAS attributes. When using this, you probably need to set the Validate Path to "/samlValidate"',
      false,
      { suppress: true }
    ),
    validatePath: new Text(
      'CAS Validate Path',
      'The CAS validation path such as /serviceValdiate',
      '/serviceValidate',
      { suppress: true }
    ),
    logoutUrl: new Text(
      'Logout URL',
      'The URL to which the user should be redirected when logging out of OAE. This should be a full url including a valid protocol (e.g., https://my.cas.server/cas/logout)',
      '',
      { suppress: true }
    ),
    mapDisplayName: new Text(
      'Display name',
      'The attibute(s) that should be used to construct the displayname. e.g., {first_name} {last_name}',
      '',
      { suppress: true }
    ),
    mapEmail: new Text(
      'Email',
      'The attibute(s) that should be used to construct the email. e.g., {mail}',
      '',
      {
        suppress: true
      }
    ),
    mapLocale: new Text(
      'Locale',
      'The attibute(s) that should be used to construct the locale. e.g., {locale}',
      '',
      {
        suppress: true
      }
    )
  }
};
export const ldap = {
  name: 'LDAP Authentication',
  description: 'Allow LDAP authentication for tenant',
  elements: {
    enabled: new Bool('LDAP Authentication Enabled', 'Allow LDAP authentication for tenant', false),
    url: new Text(
      'Host',
      'The URL at which the LDAP server can be reached. This should include both the protocol and the port. E.g. `ldaps://lookup.example.com:636` (required)',
      '',
      { suppress: true }
    ),
    adminDn: new Text(
      'Admin Distinguished Name',
      'The DN that identifies an admin user that can search for user information. E.g. uid=admin,ou=users,dc=example,dc=com (required)',
      '',
      { suppress: true }
    ),
    adminPassword: new Text(
      'Admin password',
      'The password for the admin DN that can be used to bind to LDAP. (required)',
      '',
      { suppress: true }
    ),
    searchBase: new Text(
      'Base',
      'The base DN under which to search for users. E.g. ou=users,dc=example,dc=com (required)',
      '',
      { suppress: true }
    ),
    searchFilter: new Text(
      'Filter',
      'The LDAP search filter with which to find a user by username, e.g. (uid={{username}}). Use the literal `{{username}}` to have the given username be interpolated in for the LDAP search. (required)',
      '',
      { suppress: true }
    ),
    mapExternalId: new Text(
      'LDAP External ID field',
      'The name of the LDAP field that contains an identifier that uniquely identifies the user in LDAP (required)',
      'uid',
      { suppress: true }
    ),
    mapDisplayName: new Text(
      'LDAP DisplayName field',
      "The name of the LDAP field that contains the user's displayName (required)",
      'cn',
      { suppress: true }
    ),
    mapEmail: new Text(
      'LDAP Email field',
      "The name of the LDAP field that contains the user's email address (optional)",
      '',
      { suppress: true }
    ),
    mapLocale: new Text(
      'LDAP Locale field',
      "The name of the LDAP field that contains the user's locale (optional)",
      '',
      { suppress: true }
    )
  }
};
