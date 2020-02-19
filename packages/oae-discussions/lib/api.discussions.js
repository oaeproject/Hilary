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

import _ from 'underscore';
import DiscussionsAPI from 'oae-discussions';

import * as AuthzAPI from 'oae-authz';
import * as AuthzInvitations from 'oae-authz/lib/invitations';
import * as AuthzPermissions from 'oae-authz/lib/permissions';
import * as LibraryAPI from 'oae-library';
import { logger } from 'oae-logger';
import * as MessageBoxAPI from 'oae-messagebox';
import * as OaeUtil from 'oae-util/lib/util';
import * as PrincipalsUtil from 'oae-principals/lib/util';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao';
import * as ResourceActions from 'oae-resource/lib/actions';
import * as Signature from 'oae-util/lib/signature';
import { setUpConfig } from 'oae-config';

import { AuthzConstants } from 'oae-authz/lib/constants';
import { MessageBoxConstants } from 'oae-messagebox/lib/constants';
import { Validator as validator } from 'oae-authz/lib/validator';
const {
  isValidRoleChange,
  otherwise,
  isANumber,
  isDefined,
  isLoggedInUser,
  isPrincipalId,
  isNotEmpty,
  isResourceId,
  isShortString,
  isMediumString,
  isArrayNotEmpty,
  makeSureThatOnlyIf,
  isLongString
} = validator;
import pipe from 'ramda/src/pipe';
import isIn from 'validator/lib/isIn';
import isInt from 'validator/lib/isInt';

import { equals, forEachObjIndexed } from 'ramda';
import * as DiscussionsDAO from './internal/dao';
import { DiscussionsConstants } from './constants';

const log = logger('discussions-api');

const DiscussionsConfig = setUpConfig('oae-discussions');

// Discussion fields that are allowed to be updated
const VISIBILITY = 'visibility';
const DISPLAY_NAME = 'displayName';
const DESCRIPTION = 'description';
const DISCUSSION_UPDATE_FIELDS = [DISPLAY_NAME, DESCRIPTION, VISIBILITY];

/**
 * Create a new discussion
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     displayName         The display name of the discussion
 * @param  {String}     [description]       A longer description for the discussion
 * @param  {String}     [visibility]        The visibility of the discussion. One of public, loggedin, private. Defaults to the configured tenant default
 * @param  {Object}     [roles]             The initial membership of the discussion (the user in context will be a manager regardless of this parameter)
 * @param  {Object}     [opts]              Additional optional parameters
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Discussion} callback.discussion The discussion object that was created
 */
const createDiscussion = function(ctx, displayName, description, visibility, roles, opts, callback) {
  visibility = visibility || DiscussionsConfig.getValue(ctx.tenant().alias, 'visibility', 'discussion');
  roles = roles || {};
  opts = opts || {};

  const allVisibilities = _.values(AuthzConstants.visibility);

  // Verify basic properties
  try {
    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'Anonymous users cannot create a discussion'
      })
    )(ctx);

    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'Must provide a display name for the discussion'
      })
    )(displayName);

    pipe(
      isShortString,
      otherwise({
        code: 400,
        msg: 'A display name can be at most 1000 characters long'
      })
    )(displayName);

    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'Must provide a description for the discussion'
      })
    )(description);

    pipe(
      isMediumString,
      otherwise({
        code: 400,
        msg: 'A description can be at most 10000 characters long'
      })
    )(description);

    pipe(
      isIn,
      otherwise({
        code: 400,
        msg: 'An invalid discussion visibility option has been provided. Must be one of: ' + allVisibilities.join(', ')
      })
    )(visibility, allVisibilities);

    // Verify each role is valid
    forEachObjIndexed((role /* , memberId */) => {
      pipe(
        isIn,
        otherwise({
          code: 400,
          msg: 'The role: ' + role + ' is not a valid member role for a discussion'
        })
      )(role, DiscussionsConstants.role.ALL_PRIORITY);
    }, roles);
  } catch (error) {
    return callback(error);
  }

  // The current user is always a manager
  roles[ctx.user().id] = AuthzConstants.role.MANAGER;

  const createFn = _.partial(
    DiscussionsDAO.createDiscussion,
    ctx.user().id,
    displayName,
    description,
    visibility,
    null
  );
  ResourceActions.create(ctx, roles, createFn, (err, discussion, memberChangeInfo) => {
    if (err) {
      return callback(err);
    }

    DiscussionsAPI.emit(DiscussionsConstants.events.CREATED_DISCUSSION, ctx, discussion, memberChangeInfo, errs => {
      if (errs) {
        return callback(_.first(errs));
      }

      return callback(null, discussion);
    });
  });
};

/**
 * Update a discussion
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     discussionId        The id of the discussion to update
 * @param  {Object}     profileFields       An object whose keys are profile field names, and the value is the value to which you wish the field to change. Keys must be one of: displayName, visibility, discription
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Discussion} callback.discussion The updated discussion object
 */
const updateDiscussion = function(ctx, discussionId, profileFields, callback) {
  const allVisibilities = _.values(AuthzConstants.visibility);

  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A discussion id must be provided'
      })
    )(discussionId);

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You must be authenticated to update a discussion'
      })
    )(ctx);

    pipe(
      isArrayNotEmpty,
      otherwise({
        code: 400,
        msg: 'You should at least one profile field to update'
      })
    )(_.keys(profileFields));

    forEachObjIndexed((value, field) => {
      const fieldIsVisibility = equals(field, VISIBILITY);
      const fieldIsDisplayName = equals(field, DISPLAY_NAME);
      const fieldIsDescription = equals(field, DESCRIPTION);

      pipe(
        isIn,
        otherwise({
          code: 400,
          msg: "The field '" + field + "' is not a valid field. Must be one of: " + DISCUSSION_UPDATE_FIELDS.join(', ')
        })
      )(field, DISCUSSION_UPDATE_FIELDS);
      pipe(
        makeSureThatOnlyIf(fieldIsVisibility, isIn),
        otherwise({
          code: 400,
          msg: 'An invalid visibility was specified. Must be one of: ' + allVisibilities.join(', ')
        })
      )(value, allVisibilities);
      pipe(
        makeSureThatOnlyIf(fieldIsDisplayName, isNotEmpty),
        otherwise({
          code: 400,
          msg: 'A display name cannot be empty'
        })
      )(value);
      pipe(
        makeSureThatOnlyIf(fieldIsDisplayName, isShortString),
        otherwise({
          code: 400,
          msg: 'A display name can be at most 1000 characters long'
        })
      )(value);
      pipe(
        makeSureThatOnlyIf(fieldIsDescription, isNotEmpty),
        otherwise({
          code: 400,
          msg: 'A description cannot be empty'
        })
      )(value);
      pipe(
        makeSureThatOnlyIf(fieldIsDescription, isMediumString),
        otherwise({
          code: 400,
          msg: 'A description can only be 10000 characters long'
        })
      )(value);
    }, profileFields);
  } catch (error) {
    return callback(error);
  }

  _getDiscussion(discussionId, (err, discussion) => {
    if (err) {
      return callback(err);
    }

    AuthzPermissions.canManage(ctx, discussion, err => {
      if (err) {
        return callback(err);
      }

      DiscussionsDAO.updateDiscussion(discussion, profileFields, (err, updatedDiscussion) => {
        if (err) {
          return callback(err);
        }

        // Fill in the full profile, the user has to have been a manager, so these are all true
        updatedDiscussion.isManager = true;
        updatedDiscussion.canPost = true;
        updatedDiscussion.canShare = true;

        DiscussionsAPI.emit(
          DiscussionsConstants.events.UPDATED_DISCUSSION,
          ctx,
          updatedDiscussion,
          discussion,
          errs => {
            if (errs) {
              return callback(_.first(errs));
            }

            return callback(null, updatedDiscussion);
          }
        );
      });
    });
  });
};

/**
 * Deletes the specified discussion.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     discussionId        The id of the discussion to delete
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const deleteDiscussion = function(ctx, discussionId, callback) {
  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A discussion id must be provided'
      })
    )(discussionId);

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You must be authenticated to delete a discussion'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  _getDiscussion(discussionId, (err, discussion) => {
    if (err) {
      return callback(err);
    }

    AuthzPermissions.canManage(ctx, discussion, err => {
      if (err) {
        return callback(err);
      }

      // TODO: Use a "mark as deleted" approach for deleting discussions instead of hard
      // deleting it from the database. This approach wouldn't require accessing and deleting
      // all authz member roles from the discussion
      AuthzAPI.getAllAuthzMembers(discussion.id, (err, memberIdRoles) => {
        if (err) {
          return callback(err);
        }

        const roleChanges = {};
        const removedMemberIds = _.pluck(memberIdRoles, 'id');
        _.each(removedMemberIds, memberId => {
          roleChanges[memberId] = false;
        });

        // Update the authz associations
        AuthzAPI.updateRoles(discussion.id, roleChanges, err => {
          if (err) {
            return callback(err);
          }

          // Remove the actual discussion profile
          DiscussionsDAO.deleteDiscussion(discussion.id, err => {
            if (err) {
              return callback(err);
            }

            DiscussionsAPI.emit(
              DiscussionsConstants.events.DELETED_DISCUSSION,
              ctx,
              discussion,
              removedMemberIds,
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
  });
};

/**
 * Get the discussions library items for a user or group. Depending on the access of the principal in context,
 * either a library of public, loggedin, or all items will be returned.
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         principalId             The id of the principal whose discussion library to fetch
 * @param  {String}         [start]                 The discussion ordering token from which to start fetching discussions (see `nextToken` in callback params)
 * @param  {Number}         [limit]                 The maximum number of results to return. Default: 10
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Discussion[]}   callback.discussions    The array of discussions fetched
 * @param  {String}         [callback.nextToken]    The token that can be used as the `start` parameter to fetch the next set of tokens (exclusively). If not specified, indicates that the query fetched all remaining results.
 */
const getDiscussionsLibrary = function(ctx, principalId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'A user or group id must be provided'
      })
    )(principalId);
  } catch (error) {
    return callback(error);
  }

  // Get the principal
  PrincipalsDAO.getPrincipal(principalId, (err, principal) => {
    if (err) {
      return callback(err);
    }

    // Determine which library visibility the current user should receive
    LibraryAPI.Authz.resolveTargetLibraryAccess(ctx, principal.id, principal, (err, hasAccess, visibility) => {
      if (err) {
        return callback(err);
      }

      if (!hasAccess) {
        return callback({ code: 401, msg: 'You do not have have access to this library' });
      }

      // Get the discussion ids from the library index
      LibraryAPI.Index.list(
        DiscussionsConstants.library.DISCUSSIONS_LIBRARY_INDEX_NAME,
        principalId,
        visibility,
        { start, limit },
        (err, entries, nextToken) => {
          if (err) {
            return callback(err);
          }

          // Get the discussion objects from the discussion ids
          const discussionIds = _.pluck(entries, 'resourceId');
          DiscussionsDAO.getDiscussionsById(discussionIds, null, (err, discussions) => {
            if (err) {
              return callback(err);
            }

            // Emit an event indicating that the discussion library has been retrieved
            DiscussionsAPI.emit(
              DiscussionsConstants.events.GET_DISCUSSION_LIBRARY,
              ctx,
              principalId,
              visibility,
              start,
              limit,
              discussions
            );

            return callback(null, discussions, nextToken);
          });
        }
      );
    });
  });
};

/**
 * Get a discussion basic profile by its id.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     discussionId        The id of the discussion to get
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Discussion} callback.discussion The discussion object requested
 */
const getDiscussion = function(ctx, discussionId, callback) {
  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'discussionId must be a valid resource id'
      })
    )(discussionId);
  } catch (error) {
    return callback(error);
  }

  _getDiscussion(discussionId, (err, discussion) => {
    if (err) {
      return callback(err);
    }

    AuthzPermissions.canView(ctx, discussion, err => {
      if (err) {
        return callback(err);
      }

      return callback(null, discussion);
    });
  });
};

/**
 * Get a full discussion profile. In addition to the basic profile, the full profile contains
 * the basic profile of the creator, and access information (see parameters)
 *
 * @param  {Context}    ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}     discussionId                    The id of the discussion to get
 * @param  {Function}   callback                        Standard callback function
 * @param  {Object}     callback.err                    An error that occurred, if any
 * @param  {Discussion} callback.discussion             The discussion object requested
 * @param  {User}       callback.discussion.createdBy   The basic profile of the user who created the discussion
 * @param  {Boolean}    callback.discussion.isManager   Specifies if the current user in context is a manager of the discussion
 * @param  {Boolean}    callback.discussion.canShare    Specifies if the current user in context is allowed to share the discussion
 * @param  {Boolean}    callback.discussion.canPost     Specifies if the current user in context is allowed to post messages to the discussion
 */
const getFullDiscussionProfile = function(ctx, discussionId, callback) {
  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'discussionId must be a valid resource id'
      })
    )(discussionId);
  } catch (error) {
    return callback(error);
  }

  // Get the discussion object, throwing an error if it does not exist but does not do permission checks
  _getDiscussion(discussionId, (err, discussion) => {
    if (err) {
      return callback(err);
    }

    // Resolve the full discussion access information for the current user
    AuthzPermissions.resolveEffectivePermissions(ctx, discussion, (err, permissions) => {
      if (err) {
        return callback(err);
      }

      if (!permissions.canView) {
        // The user has no effective role, which means they are not allowed to view (this has already taken into
        // consideration implicit privacy rules, such as whether or not the discussion is public).
        return callback({ code: 401, msg: 'You are not authorized to view this discussion' });
      }

      discussion.isManager = permissions.canManage;
      discussion.canShare = permissions.canShare;
      discussion.canPost = permissions.canInteract;

      if (ctx.user()) {
        // Attach a signature that can be used to perform quick access checks
        discussion.signature = Signature.createExpiringResourceSignature(ctx, discussionId);
      }

      // Populate the creator of the discussion
      PrincipalsUtil.getPrincipal(ctx, discussion.createdBy, (err, creator) => {
        if (err) {
          log().warn(
            {
              err,
              userId: discussion.createdBy,
              discussionId: discussion.id
            },
            'An error occurred getting the creator of a discussion. Proceeding with empty user for full profile'
          );
        } else if (creator) {
          discussion.createdBy = creator;
        }

        DiscussionsAPI.emit(DiscussionsConstants.events.GET_DISCUSSION_PROFILE, ctx, discussion);
        return callback(null, discussion);
      });
    });
  });
};

/**
 * Get the members of a discussion and their roles
 *
 * @param  {Context}        ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}         discussionId                    The id of the discussion to get the members for
 * @param  {String}         [start]                         The id of the principal from which to begin the page of results (exclusively). By default, begins from the first in the list
 * @param  {Number}         [limit]                         The maximum number of results to return. Default: 10
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Object[]}       callback.members                Array that contains an object for each member
 * @param  {String}         callback.members[i].role        The role of the member at index `i`
 * @param  {User|Group}     callback.members[i].profile     The principal profile of the member at index `i`
 * @param  {String}         callback.nextToken              The value to provide in the `start` parameter to get the next set of results
 */
const getDiscussionMembers = function(ctx, discussionId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A discussion id must be provided'
      })
    )(discussionId);
  } catch (error) {
    return callback(error);
  }

  getDiscussion(ctx, discussionId, (err /* , discussion */) => {
    if (err) {
      return callback(err);
    }

    // Get the discussion members
    AuthzAPI.getAuthzMembers(discussionId, start, limit, (err, memberRoles, nextToken) => {
      if (err) {
        return callback(err);
      }

      // Get the basic profiles for all of these principals
      const memberIds = _.pluck(memberRoles, 'id');
      PrincipalsUtil.getPrincipals(ctx, memberIds, (err, memberProfiles) => {
        if (err) {
          return callback(err);
        }

        // Merge the member profiles and roles into a single object
        const memberList = _.map(memberRoles, memberRole => {
          return {
            profile: memberProfiles[memberRole.id],
            role: memberRole.role
          };
        });

        return callback(null, memberList, nextToken);
      });
    });
  });
};

/**
 * Get the invitations for the specified discussion
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         discussionId            The id of the discussion to get the invitations for
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Invitation[]}   callback.invitations    The invitations
 */
const getDiscussionInvitations = function(ctx, discussionId, callback) {
  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A valid resource id must be specified'
      })
    )(discussionId);
  } catch (error) {
    return callback(error);
  }

  _getDiscussion(discussionId, (err, discussion) => {
    if (err) {
      return callback(err);
    }

    return AuthzInvitations.getAllInvitations(ctx, discussion, callback);
  });
};

/**
 * Resend an invitation email for the specified email and discussion
 *
 * @param  {Context}        ctx             Standard context object containing the current user and the current tenant
 * @param  {String}         discussionId    The id of the discussion to which the email was invited
 * @param  {String}         email           The email that was previously invited
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
const resendDiscussionInvitation = function(ctx, discussionId, email, callback) {
  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A valid resource id must be specified'
      })
    )(discussionId);
  } catch (error) {
    return callback(error);
  }

  _getDiscussion(discussionId, (err, discussion) => {
    if (err) {
      return callback(err);
    }

    return ResourceActions.resendInvitation(ctx, discussion, email, callback);
  });
};

/**
 * Share a discussion with a number of users and groups. The role of the target principals will be `member`. If
 * any principals in the list already have the discussion in their library, then this will have no impact for
 * that user with no error. Only those who do not have the discussion in their library will be impacted.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     discussionId        The id of the discussion to share
 * @param  {String[]}   principalIds        The ids of the principals with which the discussion will be shared
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const shareDiscussion = function(ctx, discussionId, principalIds, callback) {
  try {
    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You have to be logged in to be able to share a discussion'
      })
    )(ctx);

    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A valid discussion id must be provided'
      })
    )(discussionId);
  } catch (error) {
    return callback(error);
  }

  _getDiscussion(discussionId, (err, discussion) => {
    if (err) {
      return callback(err);
    }

    ResourceActions.share(ctx, discussion, principalIds, AuthzConstants.role.MEMBER, (err, memberChangeInfo) => {
      if (err) {
        return callback(err);
      }

      if (_.isEmpty(memberChangeInfo.changes)) {
        return callback();
      }

      DiscussionsAPI.emit(
        DiscussionsConstants.events.UPDATED_DISCUSSION_MEMBERS,
        ctx,
        discussion,
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
};

/**
 * Set the permissions of a discussion. This method will ensure that the current user in context has access to change the
 * permissions, as well as ensure the discussion does not end up with no manager members.
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     discussionId            The id of the discussion to share
 * @param  {Object}     changes                 An object that describes the permission changes to apply to the discussion. The key is the id of the principal to which to apply the change, and the value is the role to apply to the principal. If the value is `false`, the principal will be revoked access.
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.permissions    An object describing the permissions of the discussion after the change is applied. The key is the principal id and the value is the role that the principal has on the discussion
 */
const setDiscussionPermissions = function(ctx, discussionId, changes, callback) {
  try {
    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You have to be logged in to be able to change discussion permissions'
      })
    )(ctx);

    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A valid discussion id must be provided'
      })
    )(discussionId);

    forEachObjIndexed((role /* , principalId */) => {
      pipe(
        isValidRoleChange,
        otherwise({
          code: 400,
          msg: 'The role change: ' + role + ' is not a valid value. Must either be a string, or false'
        })
      )(role);

      const thereIsARole = Boolean(role);
      pipe(
        makeSureThatOnlyIf(thereIsARole, isIn),
        otherwise({
          code: 400,
          msg:
            'The role: "' +
            role +
            '" is not a valid value. Must be one of: ' +
            DiscussionsConstants.role.ALL_PRIORITY.join(', ') +
            '; or false'
        })
      )(role, DiscussionsConstants.role.ALL_PRIORITY);
    }, changes);
  } catch (error) {
    return callback(error);
  }

  // Get the discussion object, throwing an error if it doesn't exist, but not applying permissions checks
  _getDiscussion(discussionId, (err, discussion) => {
    if (err) {
      return callback(err);
    }

    ResourceActions.setRoles(ctx, discussion, changes, (err, memberChangeInfo) => {
      if (err) {
        return callback(err);
      }

      if (_.isEmpty(memberChangeInfo.changes)) {
        return callback();
      }

      DiscussionsAPI.emit(
        DiscussionsConstants.events.UPDATED_DISCUSSION_MEMBERS,
        ctx,
        discussion,
        memberChangeInfo,
        {},
        errs => {
          if (errs) {
            return callback(_.first(errs));
          }

          return callback(null, memberChangeInfo.roles.after);
        }
      );
    });
  });
};

/**
 * Remove a discussion from a discussion library. This is its own API method due to special permission handling required, as the user
 * is effectively updating a discussions permissions (removing themselves, or removing it from a group they manage), and they might not
 * necessarily have access to update the permissions of the private discussion (e.g., they are only a member). Also, tenant privacy
 * rules do not come into play in this case.
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     libraryOwnerId  The owner of the library, should be a principal id (either user or group id)
 * @param  {String}     discussionId    The id of the discussion to remove from the library
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const removeDiscussionFromLibrary = function(ctx, libraryOwnerId, discussionId, callback) {
  try {
    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You must be authenticated to remove a discussion from a library'
      })
    )(ctx);

    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'A user or group id must be provided'
      })
    )(libraryOwnerId);

    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'An invalid discussion id "' + discussionId + '" was provided'
      })
    )(discussionId);
  } catch (error) {
    return callback(error);
  }

  // Make sure the discussion exists
  _getDiscussion(discussionId, (err, discussion) => {
    if (err) {
      return callback(err);
    }

    PrincipalsDAO.getPrincipal(libraryOwnerId, (err, principal) => {
      if (err) {
        return callback(err);
      }

      AuthzPermissions.canRemoveRole(ctx, principal, discussion, (err, memberChangeInfo) => {
        if (err) {
          return callback(err);
        }

        // All validation checks have passed, finally persist the role change and update the user library
        AuthzAPI.updateRoles(discussionId, memberChangeInfo.changes, err => {
          if (err) {
            return callback(err);
          }

          DiscussionsAPI.emit(
            DiscussionsConstants.events.UPDATED_DISCUSSION_MEMBERS,
            ctx,
            discussion,
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
  });
};

/**
 * Create a new message in a discussion. If `replyToCreatedTimestamp` is specified, the message will be
 * a reply to the message in the discussion identified by that timestamp.
 *
 * @param  {Context}        ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}         discussionId                The id of the discussion to which to post the message
 * @param  {String}         body                        The body of the message
 * @param  {String|Number}  [replyToCreatedTimestamp]   The timestamp of the message to which this message is a reply. Not specifying this will create a top level comment
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Message}        callback.message            The created message
 */
const createMessage = function(ctx, discussionId, body, replyToCreatedTimestamp, callback) {
  try {
    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'Only authenticated users can post on discussions'
      })
    )(ctx);
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'Invalid discussion id provided'
      })
    )(discussionId);
    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'A discussion body must be provided'
      })
    )(body);
    pipe(
      isLongString,
      otherwise({
        code: 400,
        msg: 'A discussion body can only be 100000 characters long'
      })
    )(body);

    const timestampIsDefined = isDefined(replyToCreatedTimestamp);
    pipe(
      makeSureThatOnlyIf(timestampIsDefined, isInt),
      otherwise({
        code: 400,
        msg: 'Invalid reply-to timestamp provided'
      })
    )(replyToCreatedTimestamp);
  } catch (error) {
    return callback(error);
  }

  // Get the discussion, throwing an error if it doesn't exist, avoiding permission checks for now
  _getDiscussion(discussionId, (err, discussion) => {
    if (err) {
      return callback(err);
    }

    // Determine if the current user can post discussion messages to this discussion
    AuthzPermissions.canInteract(ctx, discussion, err => {
      if (err) {
        return callback(err);
      }

      // Create the message
      MessageBoxAPI.createMessage(
        discussionId,
        ctx.user().id,
        body,
        { replyToCreated: replyToCreatedTimestamp },
        (err, message) => {
          if (err) {
            return callback(err);
          }

          // Get a UI-appropriate representation of the current user
          PrincipalsUtil.getPrincipal(ctx, ctx.user().id, (err, createdBy) => {
            if (err) {
              return callback(err);
            }

            message.createdBy = createdBy;

            // The message has been created in the database so we can emit the `created-message` event
            DiscussionsAPI.emit(
              DiscussionsConstants.events.CREATED_DISCUSSION_MESSAGE,
              ctx,
              message,
              discussion,
              errs => {
                if (errs) {
                  return callback(_.first(errs));
                }

                return callback(null, message);
              }
            );
          });
        }
      );
    });
  });
};

/**
 * Delete a message in a discussion. Managers of the discussion can delete all messages while people that have access
 * to the discussion can only delete their own messages. Therefore, anonymous users will never be able to delete messages.
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     discussionId            The id of the discussion from which to delete the message
 * @param  {Number}     messageCreatedDate      The timestamp of the message that should be deleted
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Comment}    [callback.softDeleted]  When the message has been soft deleted (because it has replies), a stripped down message object representing the deleted message will be returned, with the `deleted` parameter set to `false`. If the message has been deleted from the index, no message object will be returned
 */
const deleteMessage = function(ctx, discussionId, messageCreatedDate, callback) {
  try {
    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'Only authenticated users can delete messages'
      })
    )(ctx);
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A discussion id must be provided'
      })
    )(discussionId);
    pipe(
      isInt,
      otherwise({
        code: 400,
        msg: 'A valid integer message created timestamp must be specified'
      })
    )(messageCreatedDate);
  } catch (error) {
    return callback(error);
  }

  // Get the discussion without permissions check
  _getDiscussion(discussionId, (err, discussion) => {
    if (err) {
      return callback(err);
    }

    // Ensure that the message exists. We also need it so we can make sure we have access to deleted it
    MessageBoxAPI.getMessages(discussionId, [messageCreatedDate], { scrubDeleted: false }, (err, messages) => {
      if (err) {
        return callback(err);
      }

      if (!messages[0]) {
        return callback({ code: 404, msg: 'The specified message does not exist' });
      }

      const message = messages[0];

      // Determine if we have access to delete the discussion message
      AuthzPermissions.canManageMessage(ctx, discussion, message, err => {
        if (err) {
          return callback(err);
        }

        // Delete the message using the "leaf" method, which will SOFT delete if the message has replies, or HARD delete if it does not
        MessageBoxAPI.deleteMessage(
          discussionId,
          messageCreatedDate,
          { deleteType: MessageBoxConstants.deleteTypes.LEAF },
          (err, deleteType, deletedMessage) => {
            if (err) {
              return callback(err);
            }

            DiscussionsAPI.emit(
              DiscussionsConstants.events.DELETED_DISCUSSION_MESSAGE,
              ctx,
              message,
              discussion,
              deleteType
            );

            // If a soft-delete occurred, we want to inform the consumer of the soft-delete message model
            if (deleteType === MessageBoxConstants.deleteTypes.SOFT) {
              return callback(null, deletedMessage);
            }

            return callback();
          }
        );
      });
    });
  });
};

/**
 * Get the messages in a discussion
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         discussionId            The id of the discussion for which to get the messages
 * @param  {String}         [start]                 The `threadKey` of the message from which to start retrieving messages (exclusively). By default, will start fetching from the most recent message
 * @param  {Number}         [limit]                 The maximum number of results to return. Default: 10
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Message[]}      callback.messages       The messages in the discussion. Of the type `MessageBoxModel#Message`
 * @param  {String}         callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 */
const getMessages = function(ctx, discussionId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'Must provide a valid discussion id'
      })
    )(discussionId);
    pipe(
      isANumber,
      otherwise({
        code: 400,
        msg: 'Must provide a valid limit'
      })
    )(limit);
  } catch (error) {
    return callback(error);
  }

  // Get the discussion, throwing an error if the user in context doesn't have view access or if it doesn't exist
  getDiscussion(ctx, discussionId, (err /* , discussion */) => {
    if (err) {
      return callback(err);
    }

    // Fetch the messages from the message box
    MessageBoxAPI.getMessagesFromMessageBox(discussionId, start, limit, null, (err, messages, nextToken) => {
      if (err) {
        return callback(err);
      }

      let userIds = _.map(messages, message => {
        return message.createdBy;
      });

      // Remove falsey and duplicate userIds
      userIds = _.uniq(_.compact(userIds));

      // Get the basic principal profiles of the messagers to add to the messages as `createdBy`.
      PrincipalsUtil.getPrincipals(ctx, userIds, (err, users) => {
        if (err) {
          return callback(err);
        }

        // Attach the user profiles to the message objects
        _.each(messages, message => {
          if (users[message.createdBy]) {
            message.createdBy = users[message.createdBy];
          }
        });

        return callback(err, messages, nextToken);
      });
    });
  });
};

/**
 * Get the discussion with the specified id. If it doesn't exist, a 404 error will be thrown. No permission checks
 * will be performed.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     discussionId        The id of the discussion to get
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Discussion} callback.discussion The discussion object requested
 * @api private
 */
const _getDiscussion = function(discussionId, callback) {
  DiscussionsDAO.getDiscussion(discussionId, (err, discussion) => {
    if (err) {
      return callback(err);
    }

    if (!discussion) {
      return callback({ code: 404, msg: 'Could not find discussion: ' + discussionId });
    }

    return callback(null, discussion);
  });
};

export {
  createDiscussion,
  updateDiscussion,
  deleteDiscussion,
  getDiscussionsLibrary,
  getDiscussion,
  getFullDiscussionProfile,
  getDiscussionMembers,
  getDiscussionInvitations,
  resendDiscussionInvitation,
  shareDiscussion,
  setDiscussionPermissions,
  removeDiscussionFromLibrary,
  createMessage,
  deleteMessage,
  getMessages
};
