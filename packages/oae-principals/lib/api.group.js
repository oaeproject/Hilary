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
import ShortId from 'shortid';

import { logger } from 'oae-logger';
import { setUpConfig } from 'oae-config';

import * as AuthzAPI from 'oae-authz';
import * as AuthzInvitations from 'oae-authz/lib/invitations';
import * as AuthzPermissions from 'oae-authz/lib/permissions';
import * as AuthzUtil from 'oae-authz/lib/util';
import * as LibraryAPI from 'oae-library';
import * as MessageBoxAPI from 'oae-messagebox';
import * as OaeUtil from 'oae-util/lib/util';
import * as ResourceActions from 'oae-resource/lib/actions';
import * as Signature from 'oae-util/lib/signature';
import { Validator as validator } from 'oae-authz/lib/validator';
const {
  isShortString,
  isMediumString,
  makeSureThat,
  otherwise,
  ifNotThenThrow,
  isLoggedInUser,
  isNotEmpty
} = validator;
import pipe from 'ramda/src/pipe';
import isIn from 'validator/lib/isIn';
import { AuthzConstants } from 'oae-authz/lib/constants';
import * as PrincipalsDAO from './internal/dao';
import * as PrincipalsMembersLibrary from './libraries/members';
import PrincipalsEmitter from './internal/emitter';
import * as PrincipalsUtil from './util';

import { PrincipalsConstants } from './constants';

const log = logger('oae-principals');
const Config = setUpConfig('oae-principals');

/**
 * Get the basic profile for a group.
 *
 * @param  {Context}  ctx             Standard context object containing the current user and the current tenant
 * @param  {String}   groupId         An identifier for a group. ex: g:cam:oae-team
 * @param  {Function} callback        Standard callback function
 * @param  {Object}   callback.err    An error that occurred, if any
 * @param  {Group}    callback.group  The group object
 */
const getGroup = function(ctx, groupId, callback) {
  try {
    pipe(
      validator.isGroupId,
      otherwise({
        code: 400,
        msg: 'An invalid group id was specified'
      })
    )(groupId);
  } catch (error) {
    return callback(error);
  }

  return PrincipalsUtil.getPrincipal(ctx, groupId, callback);
};

/**
 * Get a full group profile. In addition to the basic profile, this includes access information such as:
 *  `isManager`: Whether or not the user in context can manage the group
 *  `isMember`: Whether or not the user in context is a member of the group
 *  `canJoin`: Whether or not the user in context can join the group
 *
 * This also differs from `getGroup` in that if the current user is not allowed to access the group, rather than "scrubbing" sensitive information from the group, it will send back a 401 error.
 *
 * @param  {Context}   ctx             Standard context object containing the current user and the current tenant
 * @param  {String}    groupId         The id of the group to get
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @param  {Group}     callback.group  The agumented group object
 */
const getFullGroupProfile = function(ctx, groupId, callback) {
  getGroup(ctx, groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    if (group.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find principal: %s", groupId) });
    }

    // eslint-disable-next-line no-unused-vars
    AuthzPermissions.resolveEffectivePermissions(ctx, group, (err, permissions, effectiveRole) => {
      if (err) {
        return callback(err);
      }

      if (!permissions.canView) {
        return callback({ code: 401, msg: 'You do not have access to this group' });
      }

      const currentUser = ctx.user();
      const currentUserId = currentUser && currentUser.id;
      OaeUtil.invokeIfNecessary(currentUserId, AuthzAPI.hasAnyRole, currentUserId, group.id, (err, hasAnyRole) => {
        if (err) {
          return callback(err);
        }

        group.isMember = permissions.canManage || hasAnyRole;
        group.isManager = permissions.canManage;
        group.canJoin = !hasAnyRole && permissions.canJoin;
        group.canRequest = !hasAnyRole && permissions.canRequest;

        if (group.isMember) {
          // Generate a signature that can be used for push notifications
          group.signature = Signature.createExpiringResourceSignature(ctx, groupId);
        }

        // Only fetch the group creator if there is one
        OaeUtil.invokeIfNecessary(
          group.createdBy,
          PrincipalsUtil.getPrincipal,
          ctx,
          group.createdBy,
          (err, createdBy) => {
            if (err) {
              return callback(err);
            }

            if (createdBy) {
              group.createdBy = createdBy;
            }

            // As part of the group profile, get the top 8 members in the members library
            _getMembersLibrary(ctx, group, hasAnyRole, null, 8, (err, members) => {
              if (err) {
                return callback(err);
              }

              // Add the members list to the full group profile
              group.members = _.filter(members, member => {
                // We should not show any members whose profile is not linkable
                if (member.profile) return member.profile.profilePath;
              });

              PrincipalsEmitter.emit(PrincipalsConstants.events.GET_GROUP_PROFILE, ctx, group);

              if (currentUser && PrincipalsUtil.isUser(currentUserId)) {
                // eslint-disable-next-line no-unused-vars
                PrincipalsDAO.setLatestVisit(currentUser, group, new Date(), (err, results) => {
                  if (err) {
                    return callback(err);
                  }

                  return callback(null, group);
                });
              } else {
                return callback(null, group);
              }
            });
          }
        );
      });
    });
  });
};

/**
 * Get the members of a group and their roles
 *
 * @param  {Context}            ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}             groupId                 The id of the group to get the members for
 * @param  {String}             start                   The group paging token from which to start fetching group members
 * @param  {Number}             limit                   The maximum number of results to return. Default: 10
 * @param  {Function}           callback                Standard callback function
 * @param  {Object}             callback.err            An error that occurred, if any
 * @param  {User[]|Group[]}     callback.members        An array of the direct members of the group
 * @param  {String}             callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 */
const getMembersLibrary = function(ctx, groupId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      validator.isGroupId,
      otherwise({
        code: 400,
        msg: 'An invalid group id was specified'
      })
    )(groupId);
  } catch (error) {
    return callback(error);
  }

  // Ensure that this group exists
  getGroup(ctx, groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    if (group.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find principal: %s", groupId) });
    }

    // Get the members library to which the current user has access
    return _getMembersLibrary(ctx, group, null, start, limit, callback);
  });
};

/**
 * Get the invitations for the specified group
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         groupId                 The id of the group to get the invitations for
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Invitation[]}   callback.invitations    The invitations
 */
const getGroupInvitations = function(ctx, groupId, callback) {
  try {
    pipe(
      validator.isGroupId,
      otherwise({
        code: 400,
        msg: 'A valid group id must be specified'
      })
    )(groupId);
  } catch (error) {
    return callback(error);
  }

  PrincipalsDAO.getPrincipal(groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    return AuthzInvitations.getAllInvitations(ctx, group, callback);
  });
};

/**
 * Resend an invitation email for the specified email and group
 *
 * @param  {Context}        ctx             Standard context object containing the current user and the current tenant
 * @param  {String}         groupId         The id of the group to which the email was invited
 * @param  {String}         email           The email that was previously invited
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
const resendGroupInvitation = function(ctx, groupId, email, callback) {
  try {
    pipe(
      validator.isGroupId,
      otherwise({
        code: 400,
        msg: 'A valid group id must be specified'
      })
    )(groupId);
  } catch (error) {
    return callback(error);
  }

  PrincipalsDAO.getPrincipal(groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    return ResourceActions.resendInvitation(ctx, group, email, callback);
  });
};

/**
 * Get the members library of the given group
 *
 * @param  {Context}            ctx                     Standard context object containing the current user and the current tenant
 * @param  {Group}              group                   The group for which to get the members library
 * @param  {Boolean}            [hasRole]               Whether or not it has already been determined that the current user has explicit access to the group. If truthy, it implies they do. If falsey, it implies that we don't know yet
 * @param  {String}             [start]                 The group paging token from which to start fetching group members. Defaults to the beginning of the library
 * @param  {Number}             [limit]                 The maximum number of results to return. Default: 10
 * @param  {Function}           callback                Standard callback function
 * @param  {Object}             callback.err            An error that occurred, if any
 * @param  {User[]|Group[]}     callback.members        An array of the direct members of the group
 * @param  {String}             callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 * @api private
 */
const _getMembersLibrary = function(ctx, group, hasRole, start, limit, callback) {
  // Ensure proper permissions if we haven't determined that they have an explicit role
  OaeUtil.invokeIfNecessary(
    !hasRole,
    LibraryAPI.Authz.resolveTargetLibraryAccess,
    ctx,
    group.id,
    group,
    (err, hasAccess, visibility) => {
      if (err) {
        return callback(err);
      }

      if (hasRole) {
        // When there is an explicit role, we always have access and can see the private library
        hasAccess = true;
        visibility = AuthzConstants.visibility.PRIVATE;
      } else if (!hasAccess) {
        // We didn't have an explicit role, and `resolveTargetLibraryAccess` determined we don't
        // have access, so bail out
        return callback({
          code: 401,
          msg: "Insufficient privilege to view this group's members list"
        });
      }

      // Get the members from the members library and their basic profile
      PrincipalsMembersLibrary.list(group, visibility, { start, limit }, (err, memberEntries, nextToken) => {
        if (err) {
          return callback(err);
        }

        const memberIds = _.pluck(memberEntries, 'id');
        PrincipalsUtil.getPrincipals(ctx, memberIds, (err, memberProfiles) => {
          if (err) {
            return callback(err);
          }

          const members = _.chain(memberEntries)
            .map(memberEntry => {
              let result;
              if (_.contains(_.keys(memberProfiles), memberEntry.id)) {
                result = {
                  profile: memberProfiles[memberEntry.id],
                  role: memberEntry.role
                };
              }

              return result;
            })
            .compact()
            .value();

          return callback(null, members, nextToken);
        });
      });
    }
  );
};

/**
 * Get the group memberships of a principal
 *
 * @param  {Context}     ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}      principalId             The principal to retrieve all the groups for
 * @param  {String}      start                   The principalId that comes just before the first principal you wish to have in your results
 * @param  {Number}      limit                   The maximum number of results to return. Default: 10
 * @param  {Function}    callback                Standard callback function
 * @param  {Object}      callback.err            An error that occurred, if any
 * @param  {Group[]}     callback.groups         The principal's group memberships, either directly or indirectly
 * @param  {String}      callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 */
const getMembershipsLibrary = function(ctx, principalId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      validator.isPrincipalId,
      otherwise({
        code: 400,
        msg: 'Must specify a valid principalId'
      })
    )(principalId);
  } catch (error) {
    return callback(error);
  }

  PrincipalsDAO.getPrincipal(principalId, (err, principal) => {
    if (err) {
      return callback(err);
    }

    if (principal.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find principal: %s", principalId) });
    }

    LibraryAPI.Authz.resolveTargetLibraryAccess(ctx, principal.id, principal, (err, hasAccess, visibility) => {
      if (err) {
        return callback(err);
      }

      if (!hasAccess) {
        return callback({ code: 401, msg: 'You do not have access to this memberships library' });
      }

      return _getMembershipsLibrary(ctx, principalId, visibility, start, limit, callback);
    });
  });
};

/**
 * Get the group memberships of a principal. This function will keep fetching
 * items from the database until the requested amount of groups have been retrieved.
 * Folders will be filtered out of the results.
 *
 * @param  {Context}     ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}      principalId             The principal to retrieve all the groups for
 * @param  {String}      start                   The principalId that comes just before the first principal you wish to have in your results
 * @param  {Number}      limit                   The maximum number of results to return
 * @param  {Function}    callback                Standard callback function
 * @param  {Object}      callback.err            An error that occurred, if any
 * @param  {Group[]}     callback.groups         The principal's group memberships, either directly or indirectly
 * @param  {String}      callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 * @api private
 */
const _getMembershipsLibrary = function(ctx, principalId, visibility, start, limit, callback, _items) {
  _items = _items || [];

  LibraryAPI.Index.list(
    PrincipalsConstants.library.MEMBERSHIPS_INDEX_NAME,
    principalId,
    visibility,
    { start, limit },
    (err, entries, nextToken) => {
      if (err) {
        return callback(err);
      }

      const groupIds = _.pluck(entries, 'resourceId');
      PrincipalsUtil.getPrincipals(ctx, groupIds, (err, groupsHash) => {
        if (err) {
          return callback(err);
        }

        // Place the groups in the same order as `groupIds`
        const results = _.chain(groupIds)
          .map(groupId => {
            return groupsHash[groupId];
          })
          .compact()
          .value();

        // Append the groups to the retrieved list
        _items = _items.concat(results);

        // If we don't have the required number of items yet and there is a next token,
        // we retrieve the next page
        if (_items.length < limit && nextToken) {
          return _getMembershipsLibrary(ctx, principalId, visibility, nextToken, limit, callback, _items);

          // Otherwise we can return back to the caller
        }

        // Get the exact amount of items
        const pagedItems = _items.slice(0, limit);

        // It's possible that we pulled more items from the database than we're returning
        // to the caller. In that case the `nextToken` is incorrect and needs to be adjusted
        if (pagedItems.length < _items.length) {
          nextToken = _items[limit].lastModified + '#' + _items[limit].id;
        }

        // Emit an event indicating that the memberships library has been retrieved
        PrincipalsEmitter.emit(
          PrincipalsConstants.events.GET_MEMBERSHIPS_LIBRARY,
          ctx,
          principalId,
          visibility,
          start,
          limit,
          pagedItems
        );

        return callback(null, pagedItems, nextToken);
      });
    }
  );
};

/**
 * Get the most recently visited groups for a user
 *
 * @param  {Context}     ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}      principalId             The user to retrieve recent groups for
 * @param  {Number}      limit                   The maximum number of results to return. Default: 5
 * @param  {Function}    callback                Standard callback function
 * @param  {Object}      callback.err            An error that occurred, if any
 * @param  {Group[]}     callback.groups         The user's most recently visited groups
 */
const getRecentGroupsForUserId = function(ctx, principalId, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 5, 1);

  try {
    pipe(
      validator.isPrincipalId,
      otherwise({
        code: 400,
        msg: 'Must specify a valid principalId'
      })
    )(principalId);
  } catch (error) {
    return callback(error);
  }

  if (!PrincipalsDAO.isUser(principalId)) {
    return callback({ code: 400, msg: util.format("Couldn't find user: %s", principalId) });
  }

  PrincipalsDAO.getPrincipal(principalId, (err, principal) => {
    if (err) {
      return callback(err);
    }

    if (principal.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find user: %s", principalId) });
    }

    return _getRecentGroupsForUserId(ctx, principalId, limit, callback);
  });
};

/**
 * Get the most recently visited groups of a user.
 *
 * @param  {Context}     ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}      principalId             The user to retrieve recent groups for
 * @param  {Number}      limit                   The maximum number of results to return
 * @param  {Function}    callback                Standard callback function
 * @param  {Object}      callback.err            An error that occurred, if any
 * @param  {Group[]}     callback.groups         The user's recently visited groups
 * @api private
 */
const _getRecentGroupsForUserId = function(ctx, principalId, limit, callback) {
  PrincipalsDAO.getVisitedGroups(principalId, (err, items) => {
    if (err) {
      return callback(err);
    }

    const sorted = _.sortBy(items, 'latestVisit')
      .reverse()
      .slice(0, 5);
    const groupIds = _.pluck(sorted, 'groupId');

    PrincipalsUtil.getPrincipals(ctx, groupIds, (err, groups) => {
      if (err) {
        return callback(err);
      }

      const results = _.chain(groupIds)
        .map(groupId => {
          return groups[groupId];
        })
        .compact()
        .value();

      return callback(null, results);
    });
  });
};

/**
 * Update the members of a group
 *
 * @param  {Context}     ctx                Standard context object containing the current user and the current tenant
 * @param  {String}      groupId            The id of the group to update the members for
 * @param  {Object}      changes            Object where the keys represent the principal ids which should be updated/added/removed. The value is a string representing the new role. If false is passed in, the membership for that principal will be removed e.g. {'user1': 'manager', 'user2': 'viewer', 'user3': false}
 * @param  {Function}    [callback]         Standard callback function
 * @param  {Object}      [callback.err]     The error that occured, if any
 */
const setGroupMembers = function(ctx, groupId, changes, callback) {
  // Validation
  try {
    pipe(
      validator.isGroupId,
      otherwise({
        code: 400,
        msg: 'Invalid groupId specified'
      })
    )(groupId);

    pipe(
      validator.isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You have to be logged in to be able to update group membership'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  // Ensure each role is restricted to those supported by groups (member and manager). Resource
  // Actions will take care of the other standard checks
  const validRoles = PrincipalsConstants.role.ALL_PRIORITY;
  try {
    // eslint-disable-next-line no-unused-vars
    _.each(changes, (role, memberId) => {
      if (role !== false) {
        pipe(
          isIn,
          otherwise({
            code: 400,
            msg: util.format('Role must be one of %s', validRoles.join(', '))
          })
        )(role, validRoles);
      }
    });
  } catch (error) {
    return callback(error);
  }

  // Check if the group exists
  PrincipalsDAO.getPrincipal(groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    if (group.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find principal: %s", groupId) });
    }

    ResourceActions.setRoles(ctx, group, changes, (err, memberChangeInfo) => {
      if (err) {
        return callback(err);
      }

      if (_.isEmpty(memberChangeInfo.changes)) {
        return callback();
      }

      PrincipalsUtil.touchLastModified(group, (err, updatedGroup) => {
        if (err) {
          return callback(err);
        }

        PrincipalsEmitter.emit(
          PrincipalsConstants.events.UPDATED_GROUP_MEMBERS,
          ctx,
          updatedGroup,
          group,
          memberChangeInfo,
          {},
          errs => {
            if (errs) {
              return callback(_.first(errs));
            }

            return callback();
          }
        );
      });
    });
  });
};

/**
 * Leave a group. For this to be successful, the user must be a part of the group (role does not matter).
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     groupId         The id of the group to leave
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const leaveGroup = function(ctx, groupId, callback) {
  try {
    pipe(
      validator.isGroupId,
      otherwise({
        code: 400,
        msg: 'Invalid groupId specified'
      })
    )(groupId);

    pipe(
      validator.isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You have to be logged in to be able to join a group'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  // Verify the group exists
  PrincipalsDAO.getPrincipal(groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    if (group.deleted) {
      return callback({ code: 404, msg: util.format('Group not found: %s', group.id) });
    }

    AuthzPermissions.canRemoveRole(ctx, ctx.user(), group, (err, memberChangeInfo) => {
      if (err) {
        return callback(err);
      }

      AuthzAPI.updateRoles(group.id, memberChangeInfo.changes, err => {
        if (err) {
          return callback(err);
        }

        PrincipalsEmitter.emit(PrincipalsConstants.events.LEFT_GROUP, ctx, group, memberChangeInfo, errs => {
          if (errs) {
            return callback(_.first(errs));
          }

          return callback();
        });
      });
    });
  });
};

/**
 * Join a group. For this to be successful, the user must not already be a member of the group, and the group
 * must be joinable. If successful, the user will be added to the group with rol 'member'.
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     groupId         The id of the group to join
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const joinGroup = function(ctx, groupId, callback) {
  try {
    pipe(
      validator.isGroupId,
      otherwise({
        code: 400,
        msg: 'Invalid groupId specified'
      })
    )(groupId);

    pipe(
      validator.isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You have to be logged in to be able to join a group'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  // Verify the group exists
  PrincipalsDAO.getPrincipal(groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    if (group.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find principal: %s", groupId) });
    }

    AuthzPermissions.canJoin(ctx, group, (err, memberChangeInfo) => {
      if (err) {
        return callback(err);
      }

      // Apply the changes
      AuthzAPI.updateRoles(group.id, memberChangeInfo.changes, err => {
        if (err) {
          return callback(err);
        }

        PrincipalsUtil.touchLastModified(group, (err, updatedGroup) => {
          if (err) {
            return callback(err);
          }

          // Emit an event indicating that this group was joined by the current user in context
          PrincipalsEmitter.emit(
            PrincipalsConstants.events.JOINED_GROUP,
            ctx,
            updatedGroup,
            group,
            memberChangeInfo,
            errs => {
              if (errs) {
                return callback(_.first(errs));
              }

              return callback();
            }
          );
        });
      });
    });
  });
};

/**
 * Create a new group
 *
 * @param  {Context}   ctx                  Standard context object containing the current user and the current tenant
 * @param  {String}    displayName          The display name of the group
 * @param  {String}    [description]        A longer description for the group
 * @param  {String}    [visibility]         The visibility of the group. Should be one of `AuthzConstants.visibility`'s values. If left undefined, it defaults to the configured tenant default
 * @param  {String}    [joinable]           How the group can be joined. Should be one of `AuthzConstants.joinable`'s values. If left undefined, it defaults to the configured tenant default
 * @param  {Object}    [roles]              A hash where each key is a principal id and the value is one of `PrincipalsConstants.role.ALL_PRIORITY`
 * @param  {Function}  [callback]           Standard callback function
 * @param  {Object}    [callback.err]       An error that occured, if any
 * @param  {Group}     [callback.group]     The created group
 */
const createGroup = function(ctx, displayName, description, visibility, joinable, roles, callback) {
  const tenantAlias = ctx.tenant().alias;

  // Default parameters
  description = MessageBoxAPI.replaceLinks(description) || '';
  visibility = visibility || Config.getValue(tenantAlias, 'group', 'visibility');
  joinable = joinable || Config.getValue(tenantAlias, 'group', 'joinable');
  roles = roles || {};
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err }, 'An error occurred while creating a group');
      }
    };

  // Parameter validation
  try {
    pipe(
      isLoggedInUser,
      ifNotThenThrow({
        code: 401,
        msg: 'Cannot create a group anonymously'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  try {
    pipe(
      isNotEmpty,
      ifNotThenThrow({
        code: 400,
        msg: 'You need to provide a display name for this group'
      }),
      makeSureThat(true, displayName, isShortString),
      ifNotThenThrow({
        code: 400,
        msg: 'A display name can be at most 1000 characters long'
      })
    )(displayName);
  } catch (error) {
    return callback(error);
  }

  try {
    pipe(
      isIn,
      ifNotThenThrow({
        code: 400,
        msg: 'The visibility setting must be one of: ' + _.values(AuthzConstants.visibility)
      })
    )(visibility, _.values(AuthzConstants.visibility));
  } catch (error) {
    return callback(error);
  }

  try {
    pipe(
      isIn,
      ifNotThenThrow({
        code: 400,
        msg: 'The joinable setting must be one of: ' + _.values(AuthzConstants.joinable)
      })
    )(joinable, _.values(AuthzConstants.joinable));
  } catch (error) {
    return callback(error);
  }

  try {
    pipe(
      makeSureThat(Boolean(description), description, isMediumString),
      ifNotThenThrow({
        code: 400,
        msg: 'A description can only be 10000 characters long'
      })
    )(description);
  } catch (error) {
    return callback(error);
  }

  // Ensure all roles are in the set of valid roles. ResourceActions will take care of other
  // standard validations
  const validRoles = PrincipalsConstants.role.ALL_PRIORITY;
  try {
    // eslint-disable-next-line no-unused-vars
    _.each(roles, (role, principalId) => {
      if (role !== false) {
        pipe(
          isIn,
          ifNotThenThrow({
            code: 400,
            msg: util.format('Role must be one of %s', validRoles.join(', '))
          })
        )(role, validRoles);
      }
    });
  } catch (error) {
    return callback(error);
  }

  // Generate the group id
  const groupId = AuthzUtil.toId(AuthzConstants.principalTypes.GROUP, tenantAlias, ShortId.generate());

  // Immediately add the current user as a manager
  roles[ctx.user().id] = AuthzConstants.role.MANAGER;
  const createFn = _.partial(
    PrincipalsDAO.createGroup,
    groupId,
    tenantAlias,
    displayName,
    description,
    visibility,
    joinable,
    ctx.user().id
  );
  ResourceActions.create(ctx, roles, createFn, (err, group, memberChangeInfo) => {
    if (err) {
      return callback(err);
    }

    PrincipalsEmitter.emit(PrincipalsConstants.events.CREATED_GROUP, ctx, group, memberChangeInfo, errs => {
      if (errs) {
        return callback(_.first(errs));
      }

      return callback(null, group);
    });
  });
};

/**
 * Update a group
 *
 * @param  {Context}        ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}         groupId                         The id of the group to update
 * @param  {Object}         profileFields                   Object where the keys represent the profile fields that need to be updated and the values represent the new values for those profile fields
 * @param  {String}         [profileFields.displayName]     Updated display name for the discussion
 * @param  {String}         [profileFields.description]     Updated description for the discussion
 * @param  {String}         [profileFields.visibility]      Updated visibility for the discussion. Should be one of `AuthzConstants.visibility`'s values
 * @param  {String}         [profileFields.joinable]        Updated joinability for the discussion. Should be one of `AuthzConstants.joinable`'s values
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occured, if any
 * @param  {Group}          callback.updatedGroup           The updated group
 */
const updateGroup = function(ctx, groupId, profileFields, callback) {
  // Parameter validation
  const fieldNames = profileFields ? _.keys(profileFields) : [];
  try {
    pipe(
      validator.isGroupId,
      ifNotThenThrow({
        code: 400,
        msg: 'A valid group id must be provided'
      })
    )(groupId);
  } catch (error) {
    return callback(error);
  }

  try {
    pipe(
      validator.isArrayNotEmpty,
      ifNotThenThrow({
        code: 400,
        msg: 'You should specify at least one field'
      })
    )(fieldNames);
  } catch (error) {
    return callback(error);
  }

  try {
    fieldNames.forEach(fieldName => {
      pipe(
        isIn,
        otherwise({
          code: 400,
          msg: fieldName + ' is not a recognized group profile field'
        })
      )(fieldName, ['displayName', 'description', 'visibility', 'joinable']);

      if (fieldName === 'visibility') {
        pipe(
          isIn,
          otherwise({
            code: 400,
            msg: 'The visibility setting must be one of: ' + _.values(AuthzConstants.visibility)
          })
        )(profileFields.visibility, _.values(AuthzConstants.visibility));
      } else if (fieldName === 'joinable') {
        pipe(
          isIn,
          ifNotThenThrow({
            code: 400,
            msg: 'The joinable setting must be one of: ' + _.values(AuthzConstants.joinable)
          })
        )(profileFields.joinable, _.values(AuthzConstants.joinable));
      } else if (fieldName === 'displayName') {
        pipe(
          validator.isNotEmpty,
          ifNotThenThrow({
            code: 400,
            msg: 'A display name cannot be empty'
          })
        )(profileFields.displayName);

        pipe(
          validator.isShortString,
          ifNotThenThrow({
            code: 400,
            msg: 'A display name can be at most 1000 characters long'
          })
        )(profileFields.displayName);
      } else if (fieldName === 'description' && profileFields.description) {
        pipe(
          validator.isMediumString,
          ifNotThenThrow({
            code: 400,
            msg: 'A description can only be 10000 characters long'
          })
        )(profileFields.description);
      }
    });
  } catch (error) {
    return callback(error);
  }

  try {
    pipe(
      validator.isLoggedInUser,
      ifNotThenThrow({
        code: 401,
        msg: 'You have to be logged in to be able to update a group'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  // Ensure the target group exists
  PrincipalsDAO.getPrincipal(groupId, (err, oldStorageGroup) => {
    if (err) {
      return callback(err);
    }

    if (oldStorageGroup.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find principal: %s", groupId) });
    }

    // Check if we can update this group
    AuthzPermissions.canManage(ctx, oldStorageGroup, err => {
      if (err) {
        return callback(err);
      }

      profileFields = _.extend({}, profileFields, {
        lastModified: Date.now().toString(),
        description: profileFields.description ? MessageBoxAPI.replaceLinks(profileFields.description) : ''
      });
      PrincipalsDAO.updatePrincipal(groupId, profileFields, err => {
        if (err) {
          return callback(err);
        }

        // Keep track of the updated storage group model so we can emit it in the UPDATE_GROUP event
        const updatedStorageGroup = _.extend({}, oldStorageGroup, profileFields);

        // Get the user-facing updated group object to return to the user
        // eslint-disable-next-line no-unused-vars
        PrincipalsUtil.getPrincipal(ctx, groupId, (err, updatedGroup) => {
          if (err) {
            return callback(err);
          }

          // Emit the fact that we have updated this group
          PrincipalsEmitter.emit(
            PrincipalsConstants.events.UPDATED_GROUP,
            ctx,
            updatedStorageGroup,
            oldStorageGroup,
            errs => {
              if (errs) {
                return callback(_.first(errs));
              }

              return getFullGroupProfile(ctx, groupId, callback);
            }
          );
        });
      });
    });
  });
};

/**
 * Delete a group
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     groupId         The id of the group to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 */
const deleteGroup = function(ctx, groupId, callback) {
  try {
    pipe(
      validator.isGroupId,
      ifNotThenThrow({
        code: 400,
        msg: 'A valid group id must be provided'
      })
    )(groupId);
  } catch (error) {
    return callback(error);
  }

  PrincipalsDAO.getPrincipal(groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    // Check if the user has permission to delete the group
    AuthzPermissions.canManage(ctx, group, err => {
      if (err) {
        return callback(err);
      }

      // Mark the group as deleted
      PrincipalsDAO.deletePrincipal(groupId, err => {
        if (err) {
          return callback(err);
        }

        // Notify consumers that a group has been deleted
        return PrincipalsEmitter.emit(PrincipalsConstants.events.DELETED_GROUP, ctx, group, callback);
      });
    });
  });
};

/**
 * Restore a group
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     groupId         The id of the group to restore
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 */
const restoreGroup = function(ctx, groupId, callback) {
  try {
    pipe(
      validator.isGroupId,
      ifNotThenThrow({
        code: 400,
        msg: 'A valid group id must be provided'
      })
    )(groupId);
  } catch (error) {
    return callback(error);
  }

  canRestoreGroup(ctx, groupId, (err, canRestore, group) => {
    if (err) {
      return callback(err);
    }

    if (!canRestore) {
      return callback({ code: 401, msg: 'You are not authorized to restore this group' });
    }

    // Unmark the group as deleted
    PrincipalsDAO.restorePrincipal(groupId, err => {
      if (err) {
        return callback(err);
      }

      // Notify consumers that a group has been restored
      return PrincipalsEmitter.emit(PrincipalsConstants.events.RESTORED_GROUP, ctx, group, callback);
    });
  });
};

/**
 * Determine whether or not the user in context can restore a given group
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     groupId                 The group to check
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Boolean}    callback.canRestore     Whether or not the user can restore the group
 * @param  {Group}      callback.group          The group object that was fetched from the database
 */
const canRestoreGroup = function(ctx, groupId, callback) {
  if (!ctx.user()) {
    return callback(null, false);
  }

  // Get the group so we can look at its tenant
  getGroup(ctx, groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    if (!ctx.user().isAdmin(group.tenant.alias)) {
      // Only the global or tenant admin can restore a group
      return callback(null, false);
    }

    return callback(null, true, group);
  });
};

/**
 * Check if the current user can manage any principal in a set of principals. This function
 * returns as soon as one principal that can be managed is found.
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {String[]}   principalIds                The set of principal ids that should be checked
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occured, if any
 * @param  {Boolean}    callback.canManageAny       Whether or not the current user can manage any of the principals
 */
const canManageAny = function(ctx, principalIds, callback) {
  // Anonymous users cannot manage anything
  if (!ctx.user()) {
    return callback(null, false);
  }

  // If the current user's own id is in the set of principals we can return early
  if (_.contains(principalIds, ctx.user().id)) {
    return callback(null, true);
  }

  // Tenant admins can only manage principals who belong to their tenant.
  // If there is one, that is sufficient
  const canAdminOne = _.chain(principalIds)
    .map(principalId => {
      return AuthzUtil.getResourceFromId(principalId).tenantAlias;
    })
    .find(ctx.user().isAdmin)
    .value();
  if (canAdminOne) {
    return callback(null, true);
  }

  // At this point we need to check if the current user can manage any of the groups
  const groupIds = _.filter(principalIds, AuthzUtil.isGroupId);
  return _canManageAnyGroups(ctx, groupIds, callback);
};

/**
 * Check if the current user can manage any groups in the provided list of groups.
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {String[]}   groupIds                    The set of group ids that should be checked
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occured, if any
 * @param  {Boolean}    callback.canManageAny       Whether or not the current user can manage any of the groups
 * @api private
 */
const _canManageAnyGroups = function(ctx, groupIds, callback) {
  if (_.isEmpty(groupIds)) {
    return callback(null, false);
  }

  const groupId = groupIds.pop();
  PrincipalsDAO.getPrincipal(groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    AuthzPermissions.canManage(ctx, group, err => {
      if (err && err.code === 401) {
        // Try the next group
        return _canManageAnyGroups(ctx, groupIds, callback);
      }

      if (err) {
        // A system error occurred
        return callback(err);
      }

      // The manage check succeeded, therefore we can manage at least one
      return callback(null, true);
    });
  });
};

const _validateJoinGroupRequest = function(ctx, groupId, callback) {
  try {
    pipe(
      validator.isGroupId,
      ifNotThenThrow({
        code: 400,
        msg: 'A valid group id must be provided'
      })
    )(groupId);
  } catch (error) {
    return callback(error);
  }

  try {
    pipe(
      validator.isLoggedInUser,
      ifNotThenThrow({
        code: 401,
        msg: 'You have to be logged in to be able to ask to join a group'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  return callback();
};

/**
 * Create a request
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}     groupId                     The group id
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occured, if any
 */
const createRequestJoinGroup = function(ctx, groupId, callback) {
  _validateJoinGroupRequest(ctx, groupId, err => {
    if (err) return callback(err);

    // If the request exists, return
    PrincipalsDAO.createRequestJoinGroup(ctx.user().id, groupId, err => {
      if (err) return callback(err);

      PrincipalsDAO.getPrincipal(groupId, (err, group) => {
        if (err) return callback(err);

        AuthzAPI.getAuthzMembers(groupId, null, null, (err, memberInfos) => {
          if (err) return callback(err);

          // Notify managers that someone asked to be part of this group
          return PrincipalsEmitter.emit(
            PrincipalsConstants.events.REQUEST_TO_JOIN_GROUP,
            ctx,
            group,
            group,
            memberInfos,
            callback
          );
        });
      });
    });
  });
};

/**
 * Get all requests related to a group
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}     groupId                     The group id
 * @param  {String}     start                       The group paging token from which to start fetching group members
 * @param  {Number}     limit                       The maximum number of results to return. Default: 10
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occured, if any
 */
const getJoinGroupRequests = function(ctx, filter, callback) {
  // eslint-disable-next-line no-unused-vars
  let { groupId, start, limit } = filter;
  limit = OaeUtil.getNumberParam(limit, 10, 1);
  _validateJoinGroupRequest(ctx, groupId, err => {
    if (err) return callback(err);

    PrincipalsDAO.getJoinGroupRequests(groupId, (err, requests) => {
      if (err) return callback(err);

      if (_.isEmpty(requests)) return callback();

      // Get only pending request
      const users = _.filter(requests, hash => {
        return hash.status === PrincipalsConstants.requestStatus.PENDING;
      });

      // Return principals
      const userIds = _.map(users, hash => {
        return hash.principalId;
      });

      PrincipalsDAO.getPrincipals(userIds, null, (err, principals) => {
        if (err) return callback(err);
        return callback(null, principals);
      });
    });
  });
};

/**
 * Get a request
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}     groupId                     The group id
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occured, if any
 */
const getJoinGroupRequest = function(ctx, groupId, callback) {
  try {
    pipe(
      validator.isGroupId,
      ifNotThenThrow({
        code: 400,
        msg: 'A valid group id must be provided'
      })
    )(groupId);
  } catch (error) {
    return callback(error);
  }

  try {
    pipe(
      validator.isLoggedInUser,
      ifNotThenThrow({
        code: 401,
        msg: 'You have to be logged in to be able to ask to join a group'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  PrincipalsDAO.getJoinGroupRequest(groupId, ctx.user().id, (err, request) => {
    if (err) {
      return callback(err);
    }

    /**
     * Only return the group join request if it's in pending status because:
     * if in CANCEL status, act as if no request exists
     * if in REJECT status, act as if no request exists
     * if in ACCEPT status, then this is useless
     */
    if (_.isEmpty(request) || request.status !== PrincipalsConstants.requestStatus.PENDING) {
      return callback();
    }

    return callback(null, request);
  });
};

const _validateUpdateJoinGroupByRequest = function(ctx, joinRequest, callback) {
  const { groupId, principalId, role, status } = joinRequest;
  if (role) {
    try {
      pipe(
        isIn,
        ifNotThenThrow({
          code: 400,
          msg: role + ' is not a recognized role group'
        })
      )(role, PrincipalsConstants.role.ALL_PRIORITY);
    } catch (error) {
      return callback(error);
    }
  }

  try {
    pipe(
      validator.isPrincipalId,
      ifNotThenThrow({
        code: 400,
        msg: 'Must specify a valid principalId'
      })
    )(principalId);
  } catch (error) {
    return callback(error);
  }

  try {
    pipe(validator.isGroupId, ifNotThenThrow({ code: 400, msg: 'A valid group id must be provided' }))(groupId);
  } catch (error) {
    return callback(error);
  }

  try {
    pipe(
      isIn,
      ifNotThenThrow({
        code: 400,
        msg: status + ' is not a recognized request status'
      })
    )(status, _.values(PrincipalsConstants.requestStatus));

    pipe(
      validator.isLoggedInUser,
      ifNotThenThrow({
        code: 401,
        msg: 'You have to be logged in to be able to ask to join a group'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  return callback();
};

/**
 * Update a request
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     groupId         The id of the group to join
 * @param  {String}     principalId     The id of the principal who wants to join this group
 * @param  {String}     role            The role validated by the admin
 * @param  {String}     status          The status of the request
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const updateJoinGroupByRequest = function(ctx, joinRequest, callback) {
  let { groupId, principalId, role, status } = joinRequest;
  principalId = principalId || ctx.user().id;

  _validateUpdateJoinGroupByRequest(ctx, { groupId, principalId, role, status }, err => {
    if (err) {
      return callback(err);
    }

    if (!ctx.user()) {
      return callback(null, false);
    }

    PrincipalsDAO.updateJoinGroupByRequest(principalId, groupId, status, err => {
      if (err) {
        return callback(err);
      }

      if (status === PrincipalsConstants.requestStatus.ACCEPT) {
        const changes = {};
        changes[principalId] = role;

        setGroupMembers(ctx, groupId, changes, err => {
          if (err) {
            return callback(err);
          }
        });
      }

      return notifyOfJoinRequestDecision(ctx, { groupId, principalId, status }, callback);
    });
  });
};

const notifyOfJoinRequestDecision = function(ctx, joinRequest, callback) {
  const { groupId, principalId, status } = joinRequest;
  const eventToEmit =
    status === PrincipalsConstants.requestStatus.ACCEPT
      ? PrincipalsConstants.events.REQUEST_TO_JOIN_GROUP_ACCEPTED
      : PrincipalsConstants.events.REQUEST_TO_JOIN_GROUP_REJECTED;
  PrincipalsDAO.getPrincipal(groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    PrincipalsDAO.getPrincipal(principalId, (err, requester) => {
      if (err) {
        return callback(err);
      }

      // Notify the requester of the decision of the request
      return PrincipalsEmitter.emit(eventToEmit, ctx, group, requester, callback);
    });
  });
};

export {
  getGroup,
  getFullGroupProfile,
  getMembersLibrary,
  getGroupInvitations,
  resendGroupInvitation,
  getMembershipsLibrary,
  getRecentGroupsForUserId,
  setGroupMembers,
  leaveGroup,
  joinGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  restoreGroup,
  canRestoreGroup,
  canManageAny,
  createRequestJoinGroup,
  getJoinGroupRequests,
  getJoinGroupRequest,
  updateJoinGroupByRequest
};
