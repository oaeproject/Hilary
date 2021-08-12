import { createColumnFamilies } from 'oae-util/lib/cassandra.js';

/*
 * Ensure that the all of the messages column families are created. If they already exist, this method will not do anything
 *
 * @param  {Function}         callback       Standard callback function
 * @param  {Object}           callback.err   An error that occurred, if any
 * @api private
 */
const ensureSchema = function (callback) {
  createColumnFamilies(
    {
      Messages:
        'CREATE TABLE "Messages" ("id" text PRIMARY KEY, "threadKey" text, "createdBy" text, "body" text, "deleted" text)',
      MessageBoxMessages:
        'CREATE TABLE "MessageBoxMessages" ("messageBoxId" text, "threadKey" text, "value" text, PRIMARY KEY ("messageBoxId", "threadKey")) WITH COMPACT STORAGE',
      MessageBoxMessagesDeleted:
        'CREATE TABLE "MessageBoxMessagesDeleted" ("messageBoxId" text, "createdTimestamp" text, "value" text, PRIMARY KEY ("messageBoxId", "createdTimestamp")) WITH COMPACT STORAGE',
      MessageBoxRecentContributions:
        'CREATE TABLE "MessageBoxRecentContributions" ("messageBoxId" text, "contributorId" text, "value" text, PRIMARY KEY ("messageBoxId", "contributorId")) WITH COMPACT STORAGE'
    },
    callback
  );
};

export { ensureSchema };
