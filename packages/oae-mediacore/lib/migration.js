const Cassandra = require('oae-util/lib/cassandra');

/**
 * Create the schema for the MediaCore preview processor
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const ensureSchema = function(callback) {
  Cassandra.createColumnFamilies(
    {
      MediaCoreContentRevisionIdMap:
        'CREATE TABLE "MediaCoreContentRevisionIdMap" ("mediaCoreId" text PRIMARY KEY, "contentId" text, "revisionId" text)'
    },
    callback
  );
};

module.exports = { ensureSchema };
