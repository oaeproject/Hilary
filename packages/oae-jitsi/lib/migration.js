import { callbackify } from 'node:util';
import { createColumnFamilies } from 'oae-util/lib/cassandra.js';

/**
 * Ensure that all of the meeting-related schemas are created. If they already exist, this method will not do anything.
 *
 * @param  {Function}         callback       Standard callback function
 * @param  {Object}           callback.err   An error that occurred, if any
 * @api private
 */
const ensureSchema = function (callback) {
  callbackify(_ensureSchema)(callback);
};

async function _ensureSchema() {
  await createColumnFamilies({
    MeetingsJitsi:
      'CREATE TABLE "MeetingsJitsi" ("id" text PRIMARY KEY, "tenantAlias" text, "displayName" text, "visibility" text, "description" text, "createdBy" text, "created" text, "lastModified" text, "chat" boolean, "contactList" boolean)'
  });
}

export { ensureSchema };
