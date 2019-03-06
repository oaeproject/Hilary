const Cassandra = require('oae-util/lib/cassandra');

/**
 * Ensure that the all of the content-related schemas are created. If they already exist, this method will not do anything
 *
 * @param  {Function}         callback       Standard callback function
 * @param  {Object}           callback.err   An error that occurred, if any
 * @api private
 */
const ensureSchema = function(callback) {
  Cassandra.createColumnFamilies(
    {
      Content:
        'CREATE TABLE "Content" ("contentId" text PRIMARY KEY, "tenantAlias" text, "visibility" text, "displayName" text, "description" text, "resourceSubType" text, "createdBy" text, "created" text, "lastModified" text, "latestRevisionId" text, "uri" text, "previews" text, "status" text, "largeUri" text, "mediumUri" text, "smallUri" text, "thumbnailUri" text, "wideUri" text, "etherpadGroupId" text, "etherpadPadId" text, "filename" text, "link" text, "mime" text, "size" text)',
      PreviewItems:
        'CREATE TABLE "PreviewItems" ("revisionId" text, "name" text, "value" text, PRIMARY KEY ("revisionId", "name")) WITH COMPACT STORAGE',
      Revisions:
        'CREATE TABLE "Revisions" ("revisionId" text PRIMARY KEY, "contentId" text, "created" text, "createdBy" text, "filename" text, "mime" text, "size" text, "uri" text, "previewsId" text, "previews" text, "status" text, "largeUri" text, "mediumUri" text, "smallUri" text, "thumbnailUri" text, "wideUri" text, "etherpadHtml" text)',
      RevisionByContent:
        'CREATE TABLE "RevisionByContent" ("contentId" text, "created" text, "revisionId" text, PRIMARY KEY ("contentId", "created")) WITH COMPACT STORAGE'
    },
    callback
  );
};

module.exports = { ensureSchema };
