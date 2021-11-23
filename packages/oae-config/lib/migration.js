import { callbackify } from 'node:util';
import { createColumnFamily } from 'oae-util/lib/cassandra.js';

/**
 * Ensure that the config schema is created.
 * If both the schema and the default config exist, then this method will do nothing.
 *
 * @param  {Function}   callback    Standard callback function
 * @api private
 */
const ensureSchema = function (callback) {
  callbackify(_ensureSchema)(callback);
};

async function _ensureSchema() {
  await createColumnFamily(
    'Config',
    'CREATE TABLE "Config" ("tenantAlias" text, "configKey" text, "value" text, PRIMARY KEY ("tenantAlias", "configKey")) WITH COMPACT STORAGE'
  );
}

export { ensureSchema };
