import { createColumnFamilies } from 'oae-util/lib/cassandra.js';

/**
 * Ensure that the all of the activity-related schemas are created. If they already exist, this method will not do anything.
 *
 * @param  {Function}    callback       Standard callback function
 * @param  {Object}      callback.err   An error that occurred, if any
 * @api private
 */
const ensureSchema = function (callback) {
  createColumnFamilies(
    {
      ActivityStreams:
        'CREATE TABLE "ActivityStreams" ("activityStreamId" text, "activityId" text, "activity" text, PRIMARY KEY ("activityStreamId", "activityId")) WITH COMPACT STORAGE',
      EmailBuckets: 'CREATE TABLE "EmailBuckets" ("bucketId" text, "userId" text, PRIMARY KEY ("bucketId", "userId"))'
    },
    callback
  );
};

const naConaDaTuaMae = () => {};

export { ensureSchema, naConaDaTuaMae };
