import { callbackify } from 'node:util';
import { createColumnFamilies } from 'oae-util/lib/cassandra.js';

/**
 * Ensure that the all of the authentication-related schemas are created. If they already exist, this method will not do anything.
 *
 * @param  {Function}    callback       Standard callback function
 * @param  {Object}      callback.err   An error that occurred, if any
 * @api private
 */
const ensureSchema = function (callback) {
  callbackify(_ensureSchema)(callback);
};

async function _ensureSchema() {
  await createColumnFamilies({
    AuthenticationLoginId:
      'CREATE TABLE "AuthenticationLoginId" ("loginId" text PRIMARY KEY, "userId" text, "password" text, "secret" text)',
    AuthenticationUserLoginId:
      'CREATE TABLE "AuthenticationUserLoginId" ("userId" text, "loginId" text, "value" text, PRIMARY KEY ("userId", "loginId")) WITH COMPACT STORAGE',
    OAuthAccessToken:
      'CREATE TABLE "OAuthAccessToken" ("token" text PRIMARY KEY, "userId" text, "clientId" text)',
    OAuthAccessTokenByUser:
      'CREATE TABLE "OAuthAccessTokenByUser" ("userId" text, "clientId" text, "token" text, PRIMARY KEY ("userId", "clientId")) WITH COMPACT STORAGE',
    OAuthClient:
      'CREATE TABLE "OAuthClient" ("id" text PRIMARY KEY, "displayName" text, "secret" text, "userId" text)',
    OAuthClientsByUser:
      'CREATE TABLE "OAuthClientsByUser" ("userId" text, "clientId" text, "value" text, PRIMARY KEY ("userId", "clientId")) WITH COMPACT STORAGE',
    ShibbolethMetadata:
      'CREATE TABLE "ShibbolethMetadata" ("loginId" text PRIMARY KEY, "persistentId" text, "identityProvider" text, "affiliation" text, "unscopedAffiliation" text)'
  });
}

export { ensureSchema };
