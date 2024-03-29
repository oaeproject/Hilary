/**
 * Four column families will be created:
 *
 * - The column family AuthzRoles will keep principal ids (user and groups) as its row keys and will
 * have a column for each of the resources (groups, content, etc.) the user has a role on
 * - The column family AuthzMembers will keep resource ids (groups, content, etc.) as its row keys
 * and will have a column for each of the principals (users and groups) the resource is associated
 * to
 * - The column family AuthzMembershipsCache will keep a cache of all of the direct and indirect
 * memberships for a principal, used to do permission checks. This will be invalidated every time
 * one of these groups is updated
 * - The column family AuthzMembershipsIndirectCache holds a cache of only groups that a principal
 * is strictly a member of indirectly. Meaning, if a user is a member both directly and indirectly,
 * the group will not be a part of indirect cache
 */

import { callbackify } from 'node:util';
import { createColumnFamilies } from 'oae-util/lib/cassandra.js';

/**
 * @param  {Function}         callback       Standard callback function
 * @param  {Object}           callback.err   An error that occurred, if any
 * @api private
 */
const ensureSchema = function (callback) {
  callbackify(_ensureSchema)(callback);
};

async function _ensureSchema() {
  await createColumnFamilies({
    // Deleted schema
    AuthzDeleted: 'CREATE TABLE "AuthzDeleted" ("resourceId" text PRIMARY KEY, "deleted" boolean)',

    // Invitations schema
    AuthzInvitations:
      'CREATE TABLE "AuthzInvitations" ("resourceId" text, "email" text, "inviterUserId" text, "role" text, PRIMARY KEY ("resourceId", "email"))',
    AuthzInvitationsResourceIdByEmail:
      'CREATE TABLE "AuthzInvitationsResourceIdByEmail" ("email" text, "resourceId" text, PRIMARY KEY ("email", "resourceId"))',
    AuthzInvitationsTokenByEmail:
      'CREATE TABLE "AuthzInvitationsTokenByEmail" ("email" text PRIMARY KEY, "token" text)',
    AuthzInvitationsEmailByToken:
      'CREATE TABLE "AuthzInvitationsEmailByToken" ("token" text PRIMARY KEY, "email" text)',

    // Roles schema
    AuthzMembers:
      'CREATE TABLE "AuthzMembers" ("resourceId" text, "memberId" text, "role" text, PRIMARY KEY ("resourceId", "memberId")) WITH COMPACT STORAGE',
    AuthzMembershipsCache:
      'CREATE TABLE "AuthzMembershipsCache" ("principalId" text, "groupId" text, "value" text, PRIMARY KEY ("principalId", "groupId")) WITH COMPACT STORAGE',
    AuthzMembershipsIndirectCache:
      'CREATE TABLE "AuthzMembershipsIndirectCache" ("principalId" text, "groupId" text, "value" text, PRIMARY KEY ("principalId", "groupId")) WITH COMPACT STORAGE',
    AuthzRoles:
      'CREATE TABLE "AuthzRoles" ("principalId" text, "resourceId" text, "role" text, PRIMARY KEY ("principalId", "resourceId")) WITH COMPACT STORAGE'
  });
}

export { ensureSchema };
