const Cassandra = require('oae-util/lib/cassandra');

/**
 * Ensure that the all of the principal-related schemas are created. If they already exist, this method will not
 * do anything
 *
 * @param  {Function}    callback       Standard callback function
 * @param  {Object}      callback.err   An error that occurred, if any
 * @api private
 */
const ensureSchema = function(callback) {
  // Both user and group information will be stored inside of the Principals CF
  Cassandra.createColumnFamilies(
    {
      Principals:
        'CREATE TABLE "Principals" ("principalId" text PRIMARY KEY, "tenantAlias" text, "displayName" text, "description" text, "email" text, "emailPreference" text, "visibility" text, "joinable" text, "lastModified" text, "locale" text, "publicAlias" text, "largePictureUri" text, "mediumPictureUri" text, "smallPictureUri" text, "admin:global" text, "admin:tenant" text, "notificationsUnread" text, "notificationsLastRead" text, "acceptedTC" text, "createdBy" text, "created" timestamp, "deleted" timestamp)',

      // Map an email address to user ids. An e-mail address can be used by *multiple* users
      PrincipalsByEmail:
        'CREATE TABLE "PrincipalsByEmail" ("email" text, "principalId" text, PRIMARY KEY ("email", "principalId"))',

      // Map a user id to a desired email address and verification token
      PrincipalsEmailToken:
        'CREATE TABLE "PrincipalsEmailToken" ("principalId" text PRIMARY KEY, "email" text, "token" text)',

      // Track user visits to groups they are members of
      UsersGroupVisits:
        'CREATE TABLE "UsersGroupVisits" ("userId" text, "groupId" text, "latestVisit" text, PRIMARY KEY ("userId", "groupId"))',

      // Track requests to join groups
      GroupJoinRequestsByGroup:
        'CREATE TABLE "GroupJoinRequestsByGroup" ("groupId" text, "principalId" text, "created_at" text, "updated_at" text, "status" text, PRIMARY KEY ("groupId", "principalId"))'
    },
    () => {
      Cassandra.runQuery('CREATE INDEX IF NOT EXISTS ON "Principals" ("tenantAlias")', [], () => {
        return callback();
      });
    }
  );
};

module.exports = { ensureSchema };
