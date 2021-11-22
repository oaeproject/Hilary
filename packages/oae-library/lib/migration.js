import { callbackify } from 'node:util';
import { createColumnFamilies } from 'oae-util/lib/cassandra.js';

/**
 * Ensure that the all of the library-related schemas are created. If they already exist, this method will not do anything
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
    LibraryIndex:
      'CREATE TABLE "LibraryIndex" ("bucketKey" text, "rankedResourceId" text, "value" text, PRIMARY KEY ("bucketKey", "rankedResourceId")) WITH COMPACT STORAGE'
  });
}

export { ensureSchema };
