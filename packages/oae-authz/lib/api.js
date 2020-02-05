/*!
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import util from 'util';
import _ from 'underscore';

import * as Cassandra from 'oae-util/lib/cassandra';
import * as OaeUtil from 'oae-util/lib/util';
import * as TenantsUtil from 'oae-tenants/lib/util';

import { AuthzConstants } from 'oae-authz/lib/constants';
import AuthzGraph from 'oae-authz/lib/internal/graph';
import * as AuthzUtil from 'oae-authz/lib/util';
import { Validator as validator } from 'oae-authz/lib/validator';
const {
  otherwise,
  isArrayNotEmpty,
  isValidRole,
  isPrincipalId,
  isNotEmpty,
  isNonUserResourceId,
  isValidRoleChange
} = validator;
import pipe from 'ramda/src/pipe';

import { logger } from 'oae-logger';

const log = logger('oae-authz-api');

/// //////////////////////
// ROLES & PERMISSIONS //
/// //////////////////////

/**
 * Determine the direct role assigned to a principal on a specified resource.
 *
 * @param  {String}     principalId     The principal id. This can be a user or a group
 * @param  {String}     resourceId      The resource id. This can be a group as well.
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.role   The role of the principal on the resource. If the principal has no role or there is an error performing the check, role will be null.
 * @api private
 */
const _getDirectRole = function(principalId, resourceId, callback) {
  getDirectRoles([principalId], resourceId, (err, roles) => {
    if (err) {
      return callback(err);
    }

    return callback(null, roles[principalId]);
  });
};

/**
 * Determine the role assigned to the given principals directly on the specified resource instance.
 *
 * @param  {String[]}     principalIds    Array of principal ids. These can be user or group ids
 * @param  {String}       resourceId      The resource id. This can be a group as well.
 * @param  {Function}     callback        Standard callback function
 * @param  {Object}       callback.err    An error that occurred, if any
 * @param  {Object}       callback.roles  A hash keyed by principal id, with value set to the role they have directly on the resource. If the principal has no role or there is an error performing the check, role will be null.
 **/
const getDirectRoles = function(principalIds, resourceId, callback) {
  try {
    pipe(
      isArrayNotEmpty,
      otherwise({
        code: 400,
        msg: 'At least one principal id needs to be passed in'
      })
    )(principalIds);

    pipe(
      isNonUserResourceId,
      otherwise({
        code: 400,
        msg: 'Invalid non-user resource id provided'
      })
    )(resourceId);

    _.each(principalIds, principalId => {
      pipe(
        isPrincipalId,
        otherwise({
          code: 400,
          msg: 'Invalid principal id provided'
        })
      )(principalId);
    });
  } catch (error) {
    return callback(error);
  }

  Cassandra.runQuery(
    'SELECT "memberId", "role" FROM "AuthzMembers" WHERE "resourceId" = ? AND "memberId" IN ?',
    [resourceId, principalIds],
    (err, rows) => {
      if (err) {
        return callback(err);
      }

      const roles = {};
      _.each(rows, row => {
        row = Cassandra.rowToHash(row);
        roles[row.memberId] = row.role;
      });

      return callback(null, roles);
    }
  );
};

/**
 * Given a principal and a resource, determine all the effective roles that the principal has on the resource, by virtue of direct
 * association and indirect group inheritance.
 *
 * @param  {String}       principalId       The principal id. This can be a user or a group
 * @param  {String}       resourceId        The resource id. This can be a group as well.
 * @param  {Function}     callback          Standard callback function
 * @param  {Object}       callback.err      An error that occurred, if any
 * @param  {String[]}     callback.roles    An array containing all the roles the principal has on the resource.
 */
const getAllRoles = function(principalId, resourceId, callback) {
  try {
    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'Invalid principal id provided.'
      })
    )(principalId);

    pipe(
      isNonUserResourceId,
      otherwise({
        code: 400,
        msg: 'Invalid non-user resource id provided.'
      })
    )(resourceId);
  } catch (error) {
    return callback(error);
  }

  // Get the direct role of the user
  _getDirectRole(principalId, resourceId, (err, directRole) => {
    if (err) {
      return callback(err);
    }

    // Get the indirect roles of the user.
    _getIndirectRoles(principalId, resourceId, (err, roles) => {
      if (err) {
        return callback(err);
      }

      // Add the direct role (if any.)
      if (directRole) {
        roles.push(directRole);
      }

      callback(null, roles);
    });
  });
};

/**
 * Given a principal and a resource, determine all the roles that the principal has on the resource, by virtue of
 * indirect group inheritance.
 *
 * @param  {String}       principalId     The principal id. This can be a user or a group
 * @param  {String}       resourceId      The resource id. This can be a group as well.
 * @param  {Function}     callback        Standard callback function
 * @param  {Object}       callback.err    An error that occurred, if any
 * @param  {String[]}     callback.roles  An array containing all the roles the principal has on the resource by virtue of indirect group inheritance.
 * @api private
 */
const _getIndirectRoles = function(principalId, resourceId, callback) {
  // Get the groups that are directly associated to the resource
  _getResourceGroupMembers(resourceId, (err, groups) => {
    if (err) {
      return callback(err);
    }

    if (_.isEmpty(groups)) {
      return callback(null, []);
    }

    // Check whether any of these groups are part of the user's direct memberships
    const groupIds = _.keys(groups);

    // Make sure that the user's memberships have been exploded and cached
    _checkGroupMembershipsForUser(principalId, groupIds, (err, memberships) => {
      if (err) {
        return callback(err);
      }

      // Add the roles of the matching groups
      const allRoles = [];
      for (const element of memberships) {
        if (!_.contains(allRoles, groups[element])) {
          allRoles.push(groups[element]);
        }
      }

      return callback(null, allRoles);
    });
  });
};

/**
 * Get all of the groups that are directly associated to a resource.
 *
 * @param  {String}       resourceId      The resource id. This can be a group as well.
 * @param  {Function}     callback        Standard callback function
 * @param  {Object}       callback.err    An error that occurred, if any
 * @param  {Object}       callback.roles  A JSON object where the keys are the group ids of the groups directly associated to the resource and the value is the role of that group
 * @api private
 */
const _getResourceGroupMembers = function(resourceId, callback) {
  // Get the groups that are directly associated to the resource
  const start = AuthzConstants.principalTypes.GROUP + ':';
  const end = start + '|';

  Cassandra.runPagedQuery('AuthzMembers', 'resourceId', resourceId, 'memberId', start, 10000, { end }, (err, rows) => {
    if (err) {
      return callback(err);
    }

    // Convert all roles to an object mapping memberId -> role
    const associatedGroups = {};
    _.each(rows, row => {
      row = Cassandra.rowToHash(row);
      associatedGroups[row.memberId] = row.role;
    });

    return callback(null, associatedGroups);
  });
};

/**
 * Determines whether or not a principal has the specified role directly or indirectly on a given resource.
 *
 * @param  {String}      principalId         The principal id. This can be a user or a group.
 * @param  {String}      resourceId          The resource id. This can be a group as well
 * @param  {String}      role                The role to check
 * @param  {Function}    callback            Standard callback function
 * @param  {Object}      callback.err        An error that occurred, if any
 * @param  {Boolean}     callback.hasRole    Whether or not the principal has the specified role on the resource
 */
const hasRole = function(principalId, resourceId, role, callback) {
  try {
    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'Invalid principal id provided'
      })
    )(principalId);

    pipe(
      isNonUserResourceId,
      otherwise({
        code: 400,
        msg: 'Invalid non-user resource id provided'
      })
    )(resourceId);

    pipe(
      isValidRole,
      otherwise({
        code: 400,
        msg: 'Invalid role provided'
      })
    )(role);
  } catch (error) {
    return callback(error);
  }

  _hasRole(principalId, resourceId, role, callback);
};

/**
 * Determines whether or not a principal has any role directly or indirectly on a given resource.
 *
 * @param  {String}      principalId         The principal id. This can be a user or a group.
 * @param  {String}      resourceId          The resource id. This can be a group as well
 * @param  {Function}    callback            Standard callback function
 * @param  {Object}      callback.err        An error that occurred, if any
 * @param  {Boolean}     callback.hasRole    Whether or not the principal has a role on the resource
 */
const hasAnyRole = function(principalId, resourceId, callback) {
  try {
    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'Invalid principal id provided'
      })
    )(principalId);

    pipe(
      isNonUserResourceId,
      otherwise({
        code: 400,
        msg: 'Invalid non-user resource id provided'
      })
    )(resourceId);
  } catch (error) {
    return callback(error);
  }

  _hasRole(principalId, resourceId, null, callback);
};

/**
 * Determines whether or not a principal has the specified role directly or indirectly on a given resource.
 *
 * @param  {String}       principalId         The principal id. This can be a user or a group.
 * @param  {String}       resourceId          The resource id. This can be a group as well
 * @param  {String}       role                The role to check. If the role is null, we check for any role
 * @param  {Function}     callback            Standard callback function
 * @param  {Object}       callback.err        An error that occurred, if any
 * @param  {Boolean}      callback.hasRole    Whether or not the principal has the specified role on the resource
 * @api private
 */
const _hasRole = function(principalId, resourceId, role, callback) {
  // Check for a direct role first
  _getDirectRole(principalId, resourceId, (err, directRole) => {
    if (err) {
      return callback(err);
    }

    if (directRole && (role === null || directRole === role)) {
      return callback(null, true);
    }

    // If no direct role assignment is found, we try to find a role through an indirect membership
    _getIndirectRoles(principalId, resourceId, (err, roles) => {
      if (err) {
        return callback(err);
      }

      // If a role is found and we are just looking for any role
      if (roles.length > 0 && role === null) {
        return callback(null, true);
        // If we are looking for a specific role and that specific role is present
      }

      if (_.contains(roles, role)) {
        return callback(null, true);
        // If the specified role cannot be found
      }

      callback(null, false);
    });
  });
};

/**
 * Assign one or multiple principals a role on a resource instance. If the user already has a role, it will simply be updated. When
 * false is passed in as a role, the role for that principal will be removed.
 *
 * @param  {String}     resourceId                              The resource id
 * @param  {Object}     changes                                 An object keyed by principal id, whose values are the role changes to apply on the resource
 * @param  {Function}   callback                                Standard callback function
 * @param  {Object}     callback.err                            An error that occurred, if any
 * @param  {String}     callback.userGroupMembershipsChanged    An array of user ids whose group memberships have been changed as a result of this role change. This is only relevant if the `resourceId` is a group
 */
const updateRoles = function(resourceId, changes, callback) {
  const roleChanges = _.keys(changes);

  try {
    pipe(
      isNonUserResourceId,
      otherwise({
        code: 400,
        msg: 'Invalid non-user resource id provided'
      })
    )(resourceId);

    pipe(
      isArrayNotEmpty,
      otherwise({
        code: 400,
        msg: 'At least one role change needs to be applied'
      })
    )(roleChanges);

    for (const principalId of roleChanges) {
      pipe(
        isPrincipalId,
        otherwise({
          code: 400,
          msg: 'Invalid principal id specified: ' + principalId
        })
      )(principalId);

      pipe(
        isValidRoleChange,
        otherwise({
          code: 400,
          msg: 'Invalid role provided'
        })
      )(changes[principalId]);
    }
  } catch (error) {
    return callback(error);
  }

  return _updateRoles(resourceId, changes, callback);
};

/**
 * Assign multiple principals a role on a resource instance. If the user already has a role, it will simply be updated. When
 * false is passed in as a role, the role for that principal will be removed.
 *
 * @param  {String}     resourceId                              The resource id
 * @param  {Object}     changes                                 An object keyed by principal id, whose values are the role changes to apply on the resource
 * @param  {Function}   callback                                Standard callback function
 * @param  {Object}     callback.err                            An error that occurred, if any
 * @param  {String}     callback.userGroupMembershipsChanged    An array of user ids whose group memberships have been changed as a result of this role change. This is only relevant if the `resourceId` is a group
 * @api private
 */
const _updateRoles = function(resourceId, changes, callback) {
  // Aggregate all role changes queries to the AuthzRoles and AuthzMembers tables. These are the
  // canonical data-tables that represent resource membership
  let queries = _.chain(changes)
    .map((role, principalId) => {
      if (role) {
        // A role has been assigned, so we apply an update to both the roles and inverse
        // members index
        return [
          {
            query: 'UPDATE "AuthzRoles" SET "role" = ? WHERE "principalId" = ? AND "resourceId" = ?',
            parameters: [role, principalId, resourceId]
          },
          {
            query: 'UPDATE "AuthzMembers" SET "role" = ? WHERE "resourceId" = ? AND "memberId" = ?',
            parameters: [role, resourceId, principalId]
          }
        ];
      }

      if (role === false) {
        // A role has been removed, so we remove it from both the roles and inverse
        // members index
        return [
          {
            query: 'DELETE FROM "AuthzRoles" WHERE "principalId" = ? AND "resourceId" = ?',
            parameters: [principalId, resourceId]
          },
          {
            query: 'DELETE FROM "AuthzMembers" WHERE "resourceId" = ? AND "memberId" = ?',
            parameters: [resourceId, principalId]
          }
        ];
      }

      return [];
    })
    .flatten()
    .value();

  // Start determining which users need to be invalidated from the caches. Caches only need to be
  // cleared when group memberships have been updated, therefore it is only relevant when the
  // `resourceId` here was a group
  let usersToInvalidate = [];
  const groupsToInvalidate = {};
  if (AuthzUtil.isGroupId(resourceId)) {
    _.each(changes, (change, principalId) => {
      if (AuthzUtil.isUserId(principalId)) {
        // We invalidate all user rows from the authz membership caches because their
        // memberships have potentially changed
        usersToInvalidate.push(principalId);
      } else if (AuthzUtil.isGroupId(principalId)) {
        // Queue all groups to have their member users (direct or indirect) invalidated from
        // the authz caches
        groupsToInvalidate[principalId] = true;
      }
    });
  }

  // Get the full members graph of all groups combined whose membership has changed. If the
  // `resourceId` was not a group, then the `groupsToInvalidate` will be empty. This means that
  // the `graph` returned will be empty and there will be no recursive members list. In this case
  // most of the operations below will naturally be no-ops and we'll eventually just execute the
  // queries we have
  getAuthzMembersGraph(_.keys(groupsToInvalidate), (err, graph) => {
    if (err) {
      return callback(err);
    }

    // Extract just the user ids from the nodes and combine them with the users who had direct
    // role changes
    usersToInvalidate = _.chain(graph.getNodes())
      .pluck('id')
      .filter(AuthzUtil.isUserId)
      .union(usersToInvalidate)
      .value();

    // Create a cache invalidation query for each user we need to invalidate, joining it with
    // the list of memberships update queries we already need to execute
    queries = _.union(queries, _getInvalidateMembershipsCacheQueries(usersToInvalidate));

    // Finally execute all the queries and return the final list of invalidated users to the
    // caller
    Cassandra.runBatchQuery(queries, err => {
      if (err) {
        return callback(err);
      }

      return callback(null, usersToInvalidate);
    });
  });
};

/// ////////////////
// AUTHZ MEMBERS //
/// ////////////////

/**
 * Get all the direct members of a resource and their role on the resource.
 *
 * @param  {String}      resourceId              A unique identifier for a resource. ex: g:cam-oae-team or c:cam:XCDSasD
 * @param  {Function}    callback                Standard callback function
 * @param  {Object}      callback.err            An error that occurred, if any
 * @param  {Object[]}    callback.members        Array of objects for each of the direct member of the resource. Each object has an 'id' key containing the principal id of the member and a 'role' key containing the role of that principal
 * @param  {String}      callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 */

// eslint-disable-next-line no-unused-vars
const getAllAuthzMembers = function(resourceId, callback, _members, _nextToken) {
  Cassandra.runAllPagesQuery('AuthzMembers', 'resourceId', resourceId, 'memberId', null, (err, rows) => {
    if (err) {
      return callback(err);
    }

    const members = _.chain(rows)
      .map(Cassandra.rowToHash)
      .map(hash => {
        return { id: hash.memberId, role: hash.role };
      })
      .value();
    return callback(null, members);
  });
};

/**
 * Get a page of direct members of a resource and their role on the resource.
 *
 * @param  {String}      resourceId              A unique identifier for a resource. ex: g:cam-oae-team or c:cam:XCDSasD
 * @param  {String}      start                   The principal id that comes just before the first principal you wish to have in your results.
 * @param  {Number}      limit                   The number of members you wish to retrieve.
 * @param  {Function}    callback                Standard callback function
 * @param  {Object}      callback.err            An error that occurred, if any
 * @param  {Object[]}    callback.members        Array of objects for each of the direct member of the resource. Each object has an 'id' key containing the principal id of the member and a 'role' key containing the role of that principal
 * @param  {String}      callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 */
const getAuthzMembers = function(resourceId, start, limit, callback) {
  start = start || '';
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      isNonUserResourceId,
      otherwise({
        code: 400,
        msg: 'Invalid non-user resource id provided'
      })
    )(resourceId);
  } catch (error) {
    return callback(error);
  }

  Cassandra.runPagedQuery(
    'AuthzMembers',
    'resourceId',
    resourceId,
    'memberId',
    start,
    limit,
    null,
    (err, rows, nextToken) => {
      if (err) {
        return callback(err);
      }

      // Build the members array from the rows
      const members = _.map(rows, row => {
        row = Cassandra.rowToHash(row);
        return { id: row.memberId, role: row.role };
      });

      return callback(null, members, nextToken);
    }
  );
};

/**
 * Given a list of groups, we check if a user is a direct or indirect member of any of these. This is done by first checking whether or
 * not the user's membership list has been exploded. If so, we do a direct match against that exploded list. If the user's memberships
 * have not yet been exploded, we explode the user's memberships, do a direct match against the retrieved list and then cache the exploded
 * list
 *
 * @param  {String}      userId                 Id of the user for which we're checking whether or not he is a member of a set of groups
 * @param  {String[]}    groupIds               Array of group ids for which we're checking if the user is a member
 * @param  {Function}    callback               Standard callback function
 * @param  {Object}      callback.err           An error that occurred, if any
 * @param  {String[]}    callback.memberships   Array of group ids containing all the groups from the provided list that the user is a member of
 * @api private
 */
const _checkGroupMembershipsForUser = function(userId, groupIds, callback) {
  // Check if the memberships cache is populated
  Cassandra.runQuery(
    'SELECT "groupId" FROM "AuthzMembershipsCache" WHERE "principalId" = ? LIMIT 1',
    [userId],
    (err, rows) => {
      if (err) {
        return callback(err);
      }

      // There are columns in the cache, so we use it as-is
      if (rows.length === 1) {
        Cassandra.runQuery(
          'SELECT "groupId" FROM "AuthzMembershipsCache" WHERE "principalId" = ? AND "groupId" IN ?',
          [userId, groupIds],
          (err, rows) => {
            if (err) {
              return callback(err);
            }

            const memberships = _.map(rows, row => {
              return row.get('groupId');
            });

            return callback(null, memberships);
          }
        );

        // There are no columns, we need to explode the user's group memberships
      } else {
        _explodeGroupMemberships(userId, (err, graph) => {
          if (err) {
            return callback(err);
          }

          // The memberships are the nodes flattened from the graph, with the subject user
          // removed
          const allMemberships = _.chain(graph.getNodes())
            .pluck('id')
            .without(userId)
            .value()
            .sort();
          const memberships = _.intersection(groupIds, allMemberships);
          return callback(null, memberships);
        });
      }
    }
  );
};

/**
 * Get all the Authz groups of which a principal is a member. This includes all group ancestors to which the user is indirectly a member.
 * Once these have been retrieved, they will be cached inside of Cassandra for fast permission checks
 *
 * @param  {String}     principalId     The principal id for whom we want to explode the group memberships
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {AuthzGraph} callback.graph  The full memberships graph of the user
 * @api private
 */
const _explodeGroupMemberships = function(principalId, callback) {
  // Get the full exploded membership list for the user
  _getAuthzGroupMembershipsGraph([principalId], (err, graph) => {
    if (err) {
      return callback(err);
    }

    // Create a collection of all memberships and just the indirect memberships
    const allMemberships = [];
    const indirectMemberships = [];
    _.chain(graph.getNodes())
      .pluck('id')
      .without(principalId)
      .each(groupId => {
        allMemberships.push(groupId);
        if (!graph.getEdge(principalId, groupId)) {
          // A group membership is indirect if there is no membership edge that links it
          // directly to the target principal
          indirectMemberships.push(groupId);
        }
      });

    // We should not cache anything for groups into the memberships caches. So break early to
    // avoid that
    if (AuthzUtil.isGroupId(principalId) || _.isEmpty(allMemberships)) {
      return callback(null, graph);
    }

    // Save the full memberships cache to cassandra for this principal
    const authzMembershipsCacheQueries = _.map(allMemberships, groupId => {
      // For each group, get the direct members (nodes for which there is an "inbound" edge)
      // that are relevant in the memberships graph and their roles. We will JSON encode and
      // store them in the cache so that we can reconstruct the graph quickly
      const memberRoles = _.chain(graph.getInEdgesOf(groupId))
        .map(edge => {
          return { memberId: edge.from.id, role: edge.role };
        })
        .value();

      return {
        query: 'INSERT INTO "AuthzMembershipsCache" ("principalId", "groupId", "value") VALUES (?, ?, ?)',
        parameters: [principalId, groupId, JSON.stringify(memberRoles)]
      };
    });

    const authzMembershipsIndirectCacheQueries = _.map(indirectMemberships, groupId => {
      return {
        query: 'INSERT INTO "AuthzMembershipsIndirectCache" ("principalId", "groupId", "value") VALUES (?, ?, ?)',
        parameters: [principalId, groupId, '1']
      };
    });

    // Update both the full memberships cache and the dedicated indirect cache with the exploded memberships
    Cassandra.runBatchQuery(_.union(authzMembershipsCacheQueries, authzMembershipsIndirectCacheQueries), err => {
      if (err) {
        return callback(err);
      }

      return callback(null, graph);
    });
  });
};

/**
 * Get the full members AuthzGroup for a collection of resources. The notion of "full" indicates
 * that it will first get all direct users and groups that have access to the resource then
 * recursively continue to gather all users and groups that have indirect access VIA other groups.
 * The graph has the following guarantees:
 *
 *  * The nodes in the graph represent principals, except for any nodes representing the provided
 *    `resourceIds` that are not groups (e.g., a members graph for a content item will have a node
 *    representing the content item resource itself)
 *  * The resulting graph will always contain the nodes representing the given `resourceIds`, even
 *    if they have no members
 *  * Each node has an `id` property which indicates the resource id (e.g., "c:cam:Foo.docx",
 *    "u:oae:branden")
 *  * The inbound edges of each node denote a "has member" relationship
 *      * i.e., (Branden) --> (Foo.docx) indicates that the "Foo.docx" document "has member"
 *        "Branden"
 *  * The outbound edges then obviously denote a "is member of" relationship
 *      * i.e., (Branden) --> (Foo.docx) indicates that "Branden" "is a member of" the "Foo.docx"
 *        document
 *  * Each edge has a `role` property which indicates the role the source principal has in the
 *    target resource/principal
 *
 * @param  {String[]}       resourceIds     The ids of the resources whose full members graph to get
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 * @param  {AuthzGraph}     callback.graph  The members graph of the given resource
 */
const getAuthzMembersGraph = function(resourceIds, callback, _graph, _resourceIds) {
  _graph = _graph || new AuthzGraph();
  _resourceIds = _resourceIds || resourceIds.slice();
  if (_.isEmpty(_resourceIds)) {
    return callback(null, _graph);
  }

  // Get the next resource
  const resourceId = _resourceIds.shift();

  // Always include the given resource ids as nodes in the graph, even if they have no members
  _graph.addNode(resourceId);

  // Get the members of the current resource
  getAuthzMembers(resourceId, null, 10000, (err, members) => {
    if (err) {
      return callback(err);
    }

    // Add each member to the current members graph and associate the appropriate edges
    _.each(members, member => {
      const node = _graph.addNode(member.id);
      _graph.addEdge(member.id, resourceId, { role: member.role });

      // Queue new groups whose members to recursively look up, but only if they haven't
      // already been queued
      if (AuthzUtil.isGroupId(member.id) && node && !_.contains(_resourceIds, member.id)) {
        _resourceIds.push(member.id);
      }
    });

    // Recursively work through getting the members of resources in the `_resourceIds` array
    return getAuthzMembersGraph(resourceIds, callback, _graph, _resourceIds);
  });
};

/**
 * Get the full memberships AuthzGraph for a principal. The graph has the following guarantees:
 *
 *  * The nodes in the graph represent principals
 *  * The resulting graph will always contain a node representing the given `principalId`, even if
 *    they have no memberships
 *  * Each node has an `id` property which indicates the principal id (e.g., "u:oae:branden",
 *    "g:oae:developers")
 *  * The inbound edges of each node denote a "has member" relationship
 *      * i.e., (Branden) --> (OAE Developers) indicates that the "OAE Developers" group "has
 *        member" "Branden"
 *  * The outbound edges then obviously denote a "is member of" relationship
 *      * i.e., (Branden) --> (OAE Developers) indicates that "Branden" "is member of" the "OAE
 *        Developers" group
 *  * Each edge has a `role` property which indicates the role the source principal has in the
 *    target principal
 *
 * @param  {String}         principalId     The id of the principal whose full membership graph to get
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 * @param  {AuthzGraph}     callback.graph  The memberships graph of the given principal
 */
const getPrincipalMembershipsGraph = function(principalId, callback) {
  try {
    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'Invalid principal id provided'
      })
    )(principalId);
  } catch (error) {
    return callback(error);
  }

  // First try the full memberships cache
  Cassandra.runAllPagesQuery('AuthzMembershipsCache', 'principalId', principalId, 'groupId', null, (err, rows) => {
    if (err) {
      return callback(err);
    }

    if (_.isEmpty(rows)) {
      // If we have no cached memberships, go to the memberships CFs to try and resolve it
      // recursively
      return _explodeGroupMemberships(principalId, callback);
    }

    // We had some group memberships, so we construct the graph based on the encoded group
    // members stored in the cache
    const graph = new AuthzGraph();

    // Seed the graph with the principal whose memberships graph we're building
    graph.addNode(principalId);

    // Keep a list of errors encountered while parsing the encoded memberships graph from
    // the memberships cache
    const graphParseErrs = [];

    // For every entry in the memberships cache, we need to extract its relevant members and
    // create the membership relations
    _.each(rows, row => {
      // The id of a group that the `principalId` is directly or indirectly a member
      const groupId = row.get('groupId');

      // This is the stored members information for the group. It is of the form:
      // `{'memberId': 'g:oae:another-group', 'role': 'manager'}`
      let memberRoles = {};
      try {
        memberRoles = JSON.parse(row.get('value'));
      } catch (error) {
        // Accumulate any parse errors we come by
        graphParseErrs.push({
          err: error,
          groupId,
          value: row.get('value')
        });
      }

      graph.addNode(groupId);
      _.each(memberRoles, memberRole => {
        graph.addNode(memberRole.memberId);
        graph.addEdge(memberRole.memberId, groupId, { role: memberRole.role });
      });
    });

    // Fail the request if we cannot parse the encoded memberships graph
    if (!_.isEmpty(graphParseErrs)) {
      _.each(graphParseErrs, graphParseErr => {
        log().error(graphParseErr, 'An error occurred parsing a memberships graph from the authz memberships cache');
      });
      return callback({ code: 500, msg: 'An unexpected error occurred' });
    }

    return callback(null, graph);
  });
};

/**
 * Gets all the Authz groups of which a principal (either user or group) is a member. This includes all group ancestors to
 * which the user is indirectly a member.
 *
 * @param  {String}         principalId         The principal id for which to retrieve all the group memberships
 * @param  {String}         start               Determines the point at which group memberships members are returned for paging purposes.  If not provided, the first x elements will be returned
 * @param  {Number}         limit               Number of group memberships to return. Will default to 10 if not provided
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {String[]}       callback.groups     An array of group ids representing the groups to which the user belongs, either directly or indirectly
 * @param  {String}         callback.nextToken  The value to provide in the `start` parameter to get the next set of results
 */
const getPrincipalMemberships = function(principalId, start, limit, callback) {
  start = start || '';
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'Invalid principal id provided'
      })
    )(principalId);
  } catch (error) {
    return callback(error);
  }

  Cassandra.runPagedQuery(
    'AuthzMembershipsCache',
    'principalId',
    principalId,
    'groupId',
    start,
    limit,
    null,
    (err, rows, nextToken, startMatched) => {
      if (err) {
        return callback(err);
      }

      if (startMatched || !_.isEmpty(rows)) {
        // If we received some groups from the memberships cache, it means it is valid and we can
        // use the data we have
        const groupIds = _.map(rows, row => {
          return row.get('groupId');
        });

        return callback(null, groupIds, nextToken);
      }

      // If no rows were fetched, we must populate the cache, and we can use the graph we have
      // from the cache result
      _explodeGroupMemberships(principalId, (err, graph) => {
        if (err) {
          return callback(err);
        }

        // Flatten the graph nodes into just their ids, and remove the current principal
        const allMemberships = _.chain(graph.getNodes())
          .pluck('id')
          .without(principalId)
          .value()
          .sort();
        let startIndex = 0;
        if (start) {
          // We don't want to include the start element, so pick the next element as the start
          startIndex = _.indexOf(allMemberships, start) + 1;
        }

        const memberships = allMemberships.slice(startIndex, startIndex + limit);

        nextToken = null;
        if (memberships.length === limit && !_.isEmpty(memberships)) {
          nextToken = _.last(memberships);
        }

        return callback(null, memberships, nextToken);
      });
    }
  );
};

/**
 * Gets all the Authz group ids of which a principal is an indirect member
 *
 * @param  {String}         principalId             The principal id for which to retrieve all the indirect group memberships
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {String[]}       callback.groupIds       An array of group ids representing all the indirect groups to which the user belongs
 */
const getAllIndirectPrincipalMemberships = function(principalId, callback, _groupIds, _nextToken) {
  try {
    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'Invalid principal id provided'
      })
    )(principalId);
  } catch (error) {
    return callback(error);
  }

  _groupIds = _groupIds || [];
  if (_nextToken === null) {
    return callback(null, _groupIds);
  }

  getIndirectPrincipalMemberships(principalId, _nextToken, 100, (err, groupIds, nextToken) => {
    if (err) {
      return callback(err);
    }

    return getAllIndirectPrincipalMemberships(principalId, callback, _.union(_groupIds, groupIds), nextToken);
  });
};

/**
 * Gets all the Authz groups of which a principal is an indirect member
 *
 * @param  {String}         principalId             The principal id for which to retrieve all the indirect group memberships
 * @param  {String}         start                   Determines the point at which indirect group memberships members are returned for paging purposes.  If not provided, the first x elements will be returned
 * @param  {Number}         limit                   Number of indirect group memberships to return. Will default to 10 if not provided
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {String[]}       callback.groupIds       An array of group ids representing the indirect groups to which the user belongs
 * @param  {String}         callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 */
const getIndirectPrincipalMemberships = function(principalId, start, limit, callback) {
  start = start || '';
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'Invalid principal id provided'
      })
    )(principalId);
  } catch (error) {
    return callback(error);
  }

  // Note that indirect memberships for group principals aren't cached at the moment, so this will
  // still function properly but be less efficient than it could be. Since there is no use-case
  // currently to get indirect memberships of a group, this inefficiency is not an issue
  return _getIndirectPrincipalMembershipsFromCache(principalId, start, limit, callback);
};

/**
 * Get the indirect memberships for a user by looking in the cache. This method
 * only works for users
 *
 * @param  {String}         principalId             The principal id for which to retrieve all the indirect group memberships
 * @param  {String}         start                   Determines the point at which indirect group memberships members are returned for paging purposes.  If not provided, the first x elements will be returned
 * @param  {Number}         limit                   Number of indirect group memberships to return. Will default to 10 if not provided
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {String[]}       callback.groupIds       An array of group ids representing the indirect groups to which the user belongs
 * @param  {String}         callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 * @api private
 */
const _getIndirectPrincipalMembershipsFromCache = function(principalId, start, limit, callback) {
  Cassandra.runPagedQuery(
    'AuthzMembershipsIndirectCache',
    'principalId',
    principalId,
    'groupId',
    start,
    limit,
    null,
    (err, rows, nextToken, startMatched) => {
      if (err) {
        return callback(err);
      }

      if (startMatched || !_.isEmpty(rows)) {
        // If we received some groups from the memberships cache, it means it is valid and we
        // can use the data we have
        const groupIds = _.map(rows, row => {
          return row.get('groupId');
        });

        return callback(null, groupIds, nextToken);
      }

      // If no rows were fetched, we must populate the cache, and we can use the data we have from
      // the population
      return _getIndirectPrincipalMembershipsByExplosion(principalId, start, limit, callback);
    }
  );
};

/**
 * Get the indirect memberships for a principal by exploding its group hierarchy
 *
 * @param  {String}         principalId             The principal id for which to retrieve all the indirect group memberships
 * @param  {String}         start                   Determines the point at which indirect group memberships members are returned for paging purposes.  If not provided, the first x elements will be returned
 * @param  {Number}         limit                   Number of indirect group memberships to return. Will default to 10 if not provided
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {String[]}       callback.groups         An array of group ids representing the indirect groups to which the user belongs
 * @param  {String}         callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 * @api private
 */
const _getIndirectPrincipalMembershipsByExplosion = function(principalId, start, limit, callback) {
  _explodeGroupMemberships(principalId, (err, graph) => {
    if (err) {
      return callback(err);
    }

    // Filter the memberships to only groups that are indirectly associated to the user
    const indirectMemberships = _.chain(graph.getNodes())
      .filter(node => {
        const isPrincipalId = node.id === principalId;
        const isDirect = graph.getEdge(principalId, node.id);

        // Reject any node that is the principal themself or directly associated to them
        return !isPrincipalId && !isDirect;
      })
      .pluck('id')
      .value()
      .sort();

    // We don't want to include the start element, so pick the next element as the start
    const startIndex = start ? _.indexOf(indirectMemberships, start) + 1 : 0;

    // Slice the desired number of memberships out of the indirect memberships list
    const memberships = indirectMemberships.slice(startIndex, startIndex + limit);

    // Determine what, if applicable, the nextToken should be based on the number of memberships
    let nextToken = null;
    if (memberships.length === limit && !_.isEmpty(memberships)) {
      nextToken = _.last(memberships);
    }

    return callback(null, memberships, nextToken);
  });
};

/**
 * Create a full group memberships graph that contains all direct and indirect memberships for all
 * the provided principals. The resulting graph is guaranteed to contain all provided principal ids,
 * even if some or all of them don't have any memberships. The result is a graph that is possibly
 * several disjoint graphs, as it's not necessary that all provided principals have a memberships
 * graph that intersect with eachother
 *
 * @param  {String[]}       principalIds    The ids of the principals whose memberships graphs to get
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 * @param  {AuthzGraph}     callback.graph  The graph of memberships for all provided principal ids
 * @api private
 */
const _getAuthzGroupMembershipsGraph = function(principalIds, callback, _graph) {
  if (!_graph) {
    // Seed our graph with the initial principal ids as nodes. We assume no membership
    // relationships between them at this point
    _graph = new AuthzGraph();
    _.each(principalIds, principalId => {
      _graph.addNode(principalId);
    });
  }

  if (_.isEmpty(principalIds)) {
    // When there are no more principals to get memberships for, we're done
    return callback(null, _graph);
  }

  // For this group of principals, get all groups to which they have direct access
  getRolesForPrincipalsAndResourceType(principalIds, AuthzConstants.resourceTypes.GROUP, (err, principalParentRole) => {
    if (err) {
      return callback(err);
    }

    // For each group membership, add an entry to the graph, keeping track of the role. For all
    // new groups found, we have to recursively fetch their memberships
    const nextPrincipalIds = [];
    _.each(principalParentRole, (parentRole, principalId) => {
      _.each(parentRole, (role, parentGroupId) => {
        // Add the group as a node in the graph
        const node = _graph.addNode(parentGroupId);
        if (node) {
          // If `_graph.addNode` returned a node entry, then we have run into this group
          // for the first time. Add it to the set of principals for which we have to
          // recursively fetch membership
          nextPrincipalIds.push(parentGroupId);
        }

        // Add the membership relationship to the graph. The "outbound" relationship
        // indicates "member of" while the "inbound" relationship indicates "has member"
        _graph.addEdge(principalId, parentGroupId, { role });
      });
    });

    // We've loaded the relationships into the graph, continue to the next set of unvisited
    // principals
    return _getAuthzGroupMembershipsGraph(nextPrincipalIds, callback, _graph);
  });
};

/**
 * Get the queries that, when executed, will invalidate the memberships cache for all the users in
 * the `userIds` array
 *
 * @param  {String[]}   userIds     The ids of the users for which to create the invalidate queries
 * @return {Object[]}               The Cassandra queries that can be used to invalidate the memberships cache for the users
 * @api private
 */
const _getInvalidateMembershipsCacheQueries = function(userIds) {
  return _.chain(userIds)
    .map(userId => {
      return [
        {
          query: 'DELETE FROM "AuthzMembershipsCache" WHERE "principalId" = ?',
          parameters: [userId]
        },
        {
          query: 'DELETE FROM "AuthzMembershipsIndirectCache" WHERE "principalId" = ?',
          parameters: [userId]
        }
      ];
    })
    .flatten()
    .value();
};

/**
 * Get all roles available for the given principal on any resource of type `resourceType`. This is
 * a version of `getRolesForPrincipalAndResourceType` that fetches all pages.
 *
 * For parameters, see AuthzAPI#getRolesForPrincipalAndResourceType. This method uses all but the
 * `start` and `limit`, as they are not relevant when fetching all entries.
 */
const getAllRolesForPrincipalAndResourceType = function(principalId, resourceType, callback) {
  try {
    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'Invalid principal id specified: ' + principalId
      })
    )(principalId);

    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'A resourceType needs to be provided'
      })
    )(resourceType);
  } catch (error) {
    return callback(error);
  }

  // We append a '|' to the "end" range, as | has a high ASCII alphabetical ordering. This may not suffice if resourceIds have
  // multi-byte characters, which is technically possible. Unfortunately, I don't think there is a better way to do this with
  // CQL.
  const start = util.format('%s:', resourceType);
  const end = util.format('%s:|', resourceType);

  Cassandra.runAllPagesQuery('AuthzRoles', 'principalId', principalId, 'resourceId', { start, end }, (err, rows) => {
    if (err) {
      return callback(err);
    }

    const roles = _.map(rows, row => {
      return {
        id: row.get('resourceId'),
        role: row.get('role')
      };
    });

    return callback(null, roles);
  });
};

/**
 * Get the roles the provided principal has on resources of the given resource type.
 *
 * @param  {String}     principalId             The principal whose roles to fetch
 * @param  {String}     resourceType            The resource type of the resources to search for, as determined by Resource.resourceType
 * @param  {String}     [start]                 The starting resourceId from which to start fetching roles. Default: Starts from the first resource id
 * @param  {Number}     [limit]                 The maximum number of resources to fetch. Default: 10
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object[]}   callback.roles          An array of objects that indicate each resource the principal is associated to, and what the role is on that resource
 * @param  {String}     callback.roles[i].id    The id of the resource to which the principal is associated
 * @param  {String}     callback.roles[i].role  The role the principal has on the resource
 * @param  {String}     callback.nextToken      A value that can be used as the `start` parameter for another invokation that will fetch the next page of items
 */
const getRolesForPrincipalAndResourceType = function(principalId, resourceType, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'Invalid principal id specified: ' + principalId
      })
    )(principalId);

    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'A resourceType needs to be provided'
      })
    )(resourceType);
  } catch (error) {
    return callback(error);
  }

  // We append a '|' to the "end" range, as | has a high ASCII alphabetical ordering. This may not suffice if resourceIds have
  // multi-byte characters, which is technically possible. Unfortunately, I don't think there is a better way to do this with
  // CQL.
  start = start || resourceType;
  start += ':';

  const end = resourceType + ':|';

  Cassandra.runPagedQuery(
    'AuthzRoles',
    'principalId',
    principalId,
    'resourceId',
    start,
    limit,
    { end },
    (err, rows, nextToken) => {
      if (err) {
        return callback(err);
      }

      // Build the response roles array
      const roles = _.map(rows, row => {
        return {
          id: row.get('resourceId'),
          role: row.get('role')
        };
      });

      return callback(null, roles, nextToken);
    }
  );
};

/**
 * Get all principal roles associated to the resourceType for all the principals in the array of
 * principal ids. This can be performed on multiple principals at once.
 *
 * The structure of the resulting entries is a 2-level hash, where the first set of keys are the
 * provided principal ids, the 2nd level of keys are the resource ids on which the principal has
 * a role, and the value is the actual role.
 *
 * Example: If you request roles for the principal ids: [u:cam:mrvisser, u:cam:simong] for resource
 * type 'g', you could have the following result:
 *
 *  {
 *      'u:cam:mrvisser': {
 *          'g:cam:group-a': 'member',
 *          'g:cam:group-b': 'member'
 *      },
 *      'u:cam:simong': {
 *          'g:gat:foo-group': 'manager',
 *          'g:cam:bar-group': 'member'
 *      }
 *  }
 *
 * @param  {String[]}       principalIds        The array of principal ids to query for
 * @param  {String}         resourceType        The resource type of the resources to search for, as determined by Resource.resourceType
 * @param  {Number}         limit               The maximum number of resources to return per user. Default: 1000 (because this is typically used for batch collection of memberships)
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Object}         callback.entries    A JSON Object representing the roles associated to the users
 */
const getRolesForPrincipalsAndResourceType = function(principalIds, resourceType, callback) {
  principalIds = principalIds || [];

  try {
    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'A resourceType needs to be provided'
      })
    )(resourceType);

    pipe(
      isArrayNotEmpty,
      otherwise({
        code: 400,
        msg: 'At least one principal Id needs to be passed in'
      })
    )(principalIds);

    for (const principalId of principalIds) {
      pipe(
        isPrincipalId,
        otherwise({
          code: 400,
          msg: 'Invalid principal id specified: ' + principalId
        })
      )(principalId);
    }
  } catch (error) {
    return callback(error);
  }

  // We append a '|' to the "end" range, as | has a high ASCII alphabetical ordering. This may not suffice if resourceIds have
  // multi-byte characters, which is technically possible. Unfortunately, I don't think there is a better way to do this with
  // CQL.
  const start = resourceType + ':';
  const end = start + '|';

  let finished = false;
  let numCompleted = 0;
  const entries = {};
  _.each(principalIds, principalId => {
    Cassandra.runAllPagesQuery('AuthzRoles', 'principalId', principalId, 'resourceId', { start, end }, (err, rows) => {
      if (err) {
        if (!finished) {
          finished = true;
          return callback(err);
        }
      }

      numCompleted++;

      // Aggregate all resources from all the resource roles into the entries hash
      _.each(rows, row => {
        const resourceId = row.get('resourceId');
        const role = row.get('role');

        entries[principalId] = entries[principalId] || {};
        entries[principalId][resourceId] = entries[principalId][resourceId] || {};
        entries[principalId][resourceId] = role;
      });

      // If this was the final response we were waiting for, invoke the callback
      if (!finished && numCompleted === principalIds.length) {
        finished = true;
        return callback(null, entries);
      }
    });
  });
};

/**
 * Determine what the membership of a resource would be after applying the specified permission changes to it.
 *
 * @param  {String}         [resourceId]            The id of the resource to check. If unspecified, the computation will be performed as though we start from an empty members list
 * @param  {MemberRoles}    memberRoles             The member role changes to simulate on the existing resourcing members
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {IdChangeInfo}   callback.idChangeInfo   The id change info, describing the member id changes made to the resource members
 */
const computeMemberRolesAfterChanges = function(resourceId, memberRoles, opts, callback) {
  // When the resource id is not specified, we perform the computation as though the members list is empty
  OaeUtil.invokeIfNecessary(resourceId, getAuthzMembers, resourceId, null, 10000, (err, memberIdsWithRoleBefore) => {
    if (err) {
      return callback(err);
    }

    // Convert the member ids + role array into the permission change object
    const memberRolesBefore = _.chain(memberIdsWithRoleBefore)
      .indexBy('id')
      .mapObject(memberIdWithRole => {
        return memberIdWithRole.role;
      })
      .value();
    return callback(null, AuthzUtil.computeRoleChanges(memberRolesBefore, memberRoles, opts));
  });
};

/**
 * Determine the **effective** role a user has in a resource. Though a user can have multiple roles on a resource
 * by virtue of indirect group membership, this determines the highest level of access granted. This check is not only
 * implicit, but includes explicit role membership lookup. Therefore, its output alone can be used as an authoritative
 * source of access information.
 *
 * @param  {User}       [user]                  The user for which to check access. If unspecified, implies an anonymous user
 * @param  {Resource}   resource                The resource against which to check for access
 * @param  {String}     [resource.authzId]      If specified, this will be used as the id in authz to check for membership (e.g., a group id for a folder)
 * @param  {String[]}   rolesPriority           An array of roles expressing the ordering of roles in order of least powerful to most powerful
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {String}     callback.effectiveRole  The effective role of the user in context, as determined by the rolesPriority
 * @param  {Boolean}    callback.canInteract    Whether or not the user can interact
 */
const resolveEffectiveRole = function(user, resource, rolesPriority, callback) {
  resolveImplicitRole(user, resource, rolesPriority, (err, implicitRole, canInteract) => {
    if (err) {
      return callback(err);
    }

    if (implicitRole === _.last(rolesPriority)) {
      // We already have the highest role, use it
      return callback(null, implicitRole, canInteract);
    }

    if (!user) {
      // We are anonymous so cannot have any explicit access or interact. Use only our implicitRole if we have one
      return callback(null, implicitRole, canInteract, implicitRole);
    }

    if (AuthzUtil.isUserId(resource.id)) {
      // No explicit association exists from a user to another user, therefore we can use the implicit result
      return callback(null, implicitRole, canInteract);
    }

    // If we get here, it would be prudent to check if this user has granted access to the target resource
    getAllRoles(user.id, AuthzUtil.getAuthzId(resource), (err, roles) => {
      if (err) {
        return callback(err);
      }

      if (_.isEmpty(roles)) {
        // We have no explicit role, so we fall back to the implicit access
        return callback(null, implicitRole, canInteract);
      }

      // The resolved role is the one at the highest index of the passed in rolesPriority array.
      let highestIndex = _.indexOf(rolesPriority, implicitRole);
      _.each(roles, role => {
        highestIndex = Math.max(highestIndex, _.indexOf(rolesPriority, role));
      });

      // The `canInteract` parameter is true because we can always interact if we have an explicit role
      return callback(null, rolesPriority[highestIndex], true);
    });
  });
};

/**
 * Determine the highest **implicit** role that the user in context has on a resource. Implicit means that the
 * user is granted access based on simple privacy / visibility / tenant rules associated to the context. Some
 * examples:
 *  (In all examples the rolesPriority is defined as ['viewer', 'manager'])
 *
 *  *   If the user in context is an admin, they will implicitly have manager access of the resource, even if they
 *      don't have an explicit manager role membership on the resource;
 *  *   If the resource has visibility "public", all contexts (anonymous or authenticated) have implicit "viewer"
 *      role on a resource
 *  *   If the resource has visibility "private", no user context (except administrator) can have implicit "viewer"
 *      as that can only be determined through an **explicit** role check
 *
 * Therefore, the output from this call is the **minimum** effective permissions the current context has on a resource,
 * since there is no concept of a "deny" permission. If this method returns that there is no implicit role, it is still
 * possible that the user has been explicitly granted a membership role. If this method returns that there is an implicit
 * "viewer" role, it is possible that the user has been explicitly granted a role of "manager".
 *
 * The `canInteract` determines if the user can implicitly "interact" with the resource through potential tenant privacy
 * boundaries (e.g., share it, add it to their library, post a message on it). Like `implicitRole`, it is also a minimal
 * implicit check. So if this results in `false`, it is still possible that a user has an explicit manager role on the
 * resource which grants it ability to interact.
 *
 * To get a context's explicit effective role, please use #resolveEffectiveRole instead.
 *
 * @param  {Principal}  [principal]             The user or group for which to check access. If unspecified, indicates an anonymous user
 * @param  {Resource}   resource                The resource against which to check for access
 * @param  {String[]}   rolesPriority           An array of roles expressing the ordering of roles in order of least powerful to most powerful
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {String}     callback.implicitRole   The implicit (minimum) role the user in context has on the resource. An anonymous user has no role.
 * @param  {Boolean}    callback.canInteract    Determines whether or not the user in context can implicitly interact with the resource
 */
const resolveImplicitRole = function(principal, resource, rolesPriority, callback) {
  if (!principal) {
    // This is an anonymous user
    if (resource.visibility === AuthzConstants.visibility.PUBLIC) {
      // We have lowest implicit role (i.e., "viewer") if we are anonymous with a public
      // resource, but no interaction abilities
      return callback(null, _.first(rolesPriority), false);
    }

    // Anonymous has no implicit access on loggedin or private items
    return callback();
  }

  const principalId = AuthzUtil.getAuthzId(principal);
  const resourceId = AuthzUtil.getAuthzId(resource);

  // We have an authenticated principal
  if (AuthzUtil.isUserId(principalId)) {
    if (principalId === resourceId) {
      // The user themself has highest implicit access on themself
      return callback(null, _.last(rolesPriority), true);
    }

    if (principal.isAdmin(resource.tenant.alias)) {
      // An admin of the resource's tenant has highest implicit access on the resource
      return callback(null, _.last(rolesPriority), true);
    }
  } else if (principalId === resourceId) {
    // Checking a group implicitly against itself. This is a bit of a weird case. Maybe a
    // user is sharing a group with a group, so we're doing an implicit access check for a
    // group on itself to ensure we don't violate resource->target principal tenant
    // boundaries. I don't think we need to implicitly reject anything. We need to indicate
    // that a group has *some* implicit access and interaction to itself, but lets not
    // give out highest access like we do w/ users just in case
    return callback(null, _.first(rolesPriority), true);
  }

  // Determine if the principal's and resource's tenants can interact with one another
  const tenantsCanInteract = TenantsUtil.canInteract(principal.tenant.alias, resource.tenant.alias);
  if (resource.visibility === AuthzConstants.visibility.PUBLIC) {
    // A principal has implicit view access with any public resource. However they can only
    // interact with it if their tenants are interactable
    return callback(null, _.first(rolesPriority), tenantsCanInteract);
  }

  // The resource is not public
  if (
    AuthzUtil.isUserId(principalId) &&
    (resource.joinable === AuthzConstants.joinable.YES || resource.joinable === AuthzConstants.joinable.REQUEST) &&
    tenantsCanInteract
  ) {
    // An authenticated user can see and interact with a resource they have the
    // capability to join. The same cannot be said for groups though (i.e., I can't
    // share something with a private, joinable group of which I am not a member)
    return callback(null, _.first(rolesPriority), tenantsCanInteract);
  }

  if (resource.visibility === AuthzConstants.visibility.LOGGEDIN && principal.tenant.alias === resource.tenant.alias) {
    // A principal has lowest implicit role and can view a loggedin, non-joinable
    // resource only if they are logged in to its tenant
    return callback(null, _.first(rolesPriority), true);
  }

  // The resource is private and not joinable, and the principal is not an admin user,
  // therefore there is no way we can grant any implicit access on this resource
  return callback();
};

export {
  getDirectRoles,
  getAllRoles,
  hasAnyRole,
  updateRoles,
  getAllAuthzMembers,
  getAuthzMembers,
  getAuthzMembersGraph,
  getPrincipalMembershipsGraph,
  getPrincipalMemberships,
  getAllIndirectPrincipalMemberships,
  getIndirectPrincipalMemberships,
  getAllRolesForPrincipalAndResourceType,
  getRolesForPrincipalAndResourceType,
  getRolesForPrincipalsAndResourceType,
  computeMemberRolesAfterChanges,
  resolveEffectiveRole,
  resolveImplicitRole,
  hasRole
};
