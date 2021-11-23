import { callbackify } from 'node:util';
import { createColumnFamilies } from 'oae-util/lib/cassandra.js';

/**
 * Create the schema for Learning Tools Interoperability tools
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const ensureSchema = function (callback) {
  callbackify(_ensureSchema)(callback);
};

async function _ensureSchema() {
  await createColumnFamilies({
    LtiTools:
      'CREATE TABLE "LtiTools" ("id" text, "groupId" text, "launchUrl" text, "secret" text, "oauthConsumerKey" text, "displayName" text, "description" text, PRIMARY KEY ("groupId", "id"))'
  });
}

export { ensureSchema };
