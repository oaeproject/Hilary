import { callbackify } from 'node:util';
import { createColumnFamilies } from 'oae-util/lib/cassandra.js';

/**
 * Ensure that the all of the folders schemas are created. If they already exist, this method will not do anything
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
    Folders:
      'CREATE TABLE "Folders" ("id" text PRIMARY KEY, "tenantAlias" text, "groupId" text, "displayName" text, "visibility" text, "description" text, "createdBy" text, "created" bigint, "lastModified" bigint, "previews" text)',
    FoldersGroupId: 'CREATE TABLE "FoldersGroupId" ("groupId" text PRIMARY KEY, "folderId" text)'
  });
}

export { ensureSchema };
