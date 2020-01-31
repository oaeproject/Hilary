/*
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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

import { logger } from 'oae-logger';

import * as AuthzAPI from 'oae-authz';
import * as AuthzInvitationsDAO from 'oae-authz/lib/invitations/dao';
import * as AuthzModel from 'oae-authz/lib/model';
import * as AuthzPermissions from 'oae-authz/lib/permissions';
import * as AuthzUtil from 'oae-authz/lib/util';
import * as EmitterAPI from 'oae-emitter';
import * as OaeUtil from 'oae-util/lib/util';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao';
import * as PrincipalsUtil from 'oae-principals/lib/util';
import * as ResourceActivity from 'oae-resource/lib/activity';

import { Invitation } from 'oae-authz/lib/invitations/model';
import { AuthzConstants } from 'oae-authz/lib/constants';
import { Validator as validator } from 'oae-authz/lib/validator';
const { otherwise } = validator;
import pipe from 'ramda/src/pipe';
import { ResourceConstants } from 'oae-resource/lib/constants';

const log = logger('oae-resource-actions');

const ResourceActions = new EmitterAPI.EventEmitter();

/**
 * Validate and create a resource using the given `createFn` function, while performing the role
 * changes afterward.
 *
 *  TODO:   Passing in a `createFn` is not an ideal pattern. Would be better to have a central
 *          registry for handling CRUD operations on resources, however it is outscoped ATM
 *
 * @param  {Context}            ctx                         Standard context object containing the current user and the current tenant
 * @param  {Object}             roles                       The roles, keyed by a share target expression (e.g., principal id, email address, or `email:userId` expression), whose value is the role the target should have on the resource
 * @param  {Function}           createFn                    The function to use to create the actual resource
 * @param  {Object}             createFn.err                An error that occurred while creating the resource, if any
 * @param  {Resource}           createFn.resource           The first argument should always be the resource that was created (i.e., the resource that will have the roles associated to it)
 * @param  {...Object}          createFn.additionalArgs     Any additional arguments you need to return when creating the resource (e.g., a content revision)
 * @param  {Function}           callback                    Standard callback function
 * @param  {Object}             callback.err                An error that occurred, if any
 * @param  {...Object}          callback.createFnResults    The result(s) of the create function (e.g., the created resource), one after another as separate arguments
 * @param  {MemberChangeInfo}   callback.memberChangeInfo   The member change info object that describes the resource members
 * @param  {EmailChangeInfo}    callback.emailChangeInfo    The email change info object that describes the resource invitations
 */
const create = function(ctx, roles, createFn, callback) {
  try {
    pipe(
      validator.isLoggedInUser,
      otherwise({
        code: 400,
        msg: 'Only authenticated users can create a new resource'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  // Ensure all member ids are valid members
  const memberIds = _.keys(roles);
  try {
    _.each(memberIds, memberId => {
      pipe(
        validator.isValidShareTarget,
        otherwise({
          code: 400,
          msg:
            'Members must be either an email, a principal id, or an email combined with a user id separated by a ":" (e.g., me@myemail.com:u:oae:abc123)'
        })
      )(memberId);
    });
  } catch (error) {
    return callback(error);
  }

  // Ensure there is at least one manager member in the list of roles
  const firstManagerRole = _.find(roles, (role, memberId) => {
    return AuthzUtil.isPrincipalId(memberId) && role === AuthzConstants.role.MANAGER;
  });

  try {
    pipe(
      validator.isValidRole,
      otherwise({
        code: 400,
        msg: 'There must be at least one manager specified when creating a resource'
      })
    )(firstManagerRole);
  } catch (error) {
    return callback(error);
  }

  // Get the target resources being added as members and invitations to the new resource
  _getTargetRoles(roles, (err, targetRolesById) => {
    if (err) {
      return callback(err);
    }

    const targetRoles = _.values(targetRolesById);

    // Determine that the current user can perform this create action given the target members
    AuthzPermissions.canCreate(ctx, targetRoles, (err, memberChangeInfo, emailChangeInfo) => {
      if (err) {
        return callback(err);
      }

      // Perform the create action
      createFn((...args) => {
        const [err, resource] = args;
        if (err) {
          return callback(err);
        }

        // Get all the results of the create function. There could be more than just the
        // main resource (e.g., content, revision) and we should retain them all
        const createFnResults = args.slice(1);

        // Apply the changes to the authz members, if any
        _applyMemberChanges(ctx, resource, memberChangeInfo, err => {
          if (err) {
            return callback(err);
          }

          // Apply the changes to the authz invitations, if any
          _applyInvitationChanges(ctx, resource, emailChangeInfo, err => {
            if (err) {
              return callback(err);
            }

            // Return to the caller, appending the members and emails changes to the
            // create operation results
            const args = _.union([null], createFnResults, [memberChangeInfo, emailChangeInfo]);
            return callback(...args);
          });
        });
      });
    });
  });
};

/**
 * Validate and share the resource with the target principals and emails
 *
 * @param  {Context}            ctx                         Standard context object containing the current user and the current tenant
 * @param  {Resource}           resource                    The resource to share
 * @param  {String[]}           targetIds                   The share target expressions (e.g., principal id, email address, or `email:userId` expression) describing the targets to share with
 * @param  {String}             role                        The share role for this resource (e.g., "viewer", "member")
 * @param  {Function}           callback                    Standard callback function
 * @param  {Object}             callback.err                An error that occurred, if any
 * @param  {MemberChangeInfo}   callback.memberChangeInfo   Describes the resource member updates
 * @param  {EmailChangeInfo}    callback.emailChangeInfo    Describes the resource invitation updates
 */
const share = function(ctx, resource, targetIds, role, callback) {
  try {
    pipe(
      validator.isLoggedInUser,
      otherwise({
        code: 400,
        msg: 'Only authenticated users can share a resource'
      })
    )(ctx);

    pipe(
      validator.isValidRole,
      otherwise({
        code: 400,
        msg: 'Must specify a valid role'
      })
    )(role);

    pipe(
      validator.isResource,
      otherwise({
        code: 400,
        msg: 'An invalid resource was provided'
      })
    )(resource);

    pipe(
      validator.isArrayNotEmpty,
      otherwise({
        code: 400,
        msg: 'At least one user to share with should be specified'
      })
    )(targetIds);
  } catch (error) {
    return callback(error);
  }

  let resourceAuthzId = null;
  let resourceId = null;
  if (resource) {
    resourceAuthzId = AuthzUtil.getAuthzId(resource);
    resourceId = resource.id;
  }

  try {
    _.each(targetIds, targetId => {
      pipe(
        validator.isValidShareTarget,
        otherwise({
          code: 400,
          msg:
            'Members must be either an email, a principal id, or an email combined with a user id separated by a ":" (e.g., me@myemail.com:u:oae:abc123)'
        })
      )(targetId);

      pipe(
        validator.isDifferent,
        otherwise({
          code: 400,
          msg: 'You cannot share a resource with itself'
        })
      )(targetId, resourceAuthzId);

      pipe(
        validator.isDifferent,
        otherwise({
          code: 400,
          msg: 'You cannot share a resource with itself'
        })
      )(targetId, resourceId);
    });
  } catch (error) {
    return callback(error);
  }

  // Split the targets into principal profiles and emails
  _getTargets(targetIds, (err, targetsByTargetId) => {
    if (err) {
      return callback(err);
    }

    const targets = _.values(targetsByTargetId);

    // Determine if the share violates any privacy or access
    AuthzPermissions.canShare(ctx, resource, targets, role, (err, memberChangeInfo, emailChangeInfo) => {
      if (err) {
        return callback(err);
      }

      // Apply the changes to the authz members, if any
      _applyMemberChanges(ctx, resource, memberChangeInfo, err => {
        if (err) {
          return callback(err);
        }

        // Apply the changes to the authz invitations, if any
        _applyInvitationChanges(ctx, resource, emailChangeInfo, err => {
          if (err) {
            return callback(err);
          }

          return callback(null, memberChangeInfo, emailChangeInfo);
        });
      });
    });
  });
};

/**
 * Validate and set the member and invitation roles on the resource
 *
 * @param  {Context}            ctx                         Standard context object containing the current user and the current tenant
 * @param  {Resource}           resource                    The resource whose roles to set
 * @param  {Object}             roles                       The roles, keyed by a share target (e.g., principal id or email address), whose value is the role the target should have
 * @param  {Function}           callback                    Standard callback function
 * @param  {Object}             callback.err                An error that occurred, if any
 * @param  {MemberChangeInfo}   callback.memberChangeInfo   Describes the resource member updates
 * @param  {EmailChangeInfo}    callback.emailChangeInfo    Describes the resource invitation updates
 */
const setRoles = function(ctx, resource, roles, callback) {
  try {
    pipe(
      validator.isLoggedInUser,
      otherwise({
        code: 400,
        msg: 'Only authenticated users can share a resource'
      })
    )(ctx);

    pipe(
      validator.isResource,
      otherwise({
        code: 400,
        msg: 'An invalid resource was provided'
      })
    )(resource);

    pipe(
      validator.isArrayNotEmpty,
      otherwise({
        code: 400,
        msg: 'At least one role update should be specified'
      })
    )(_.keys(roles));
  } catch (error) {
    return callback(error);
  }

  let resourceAuthzId = null;
  let resourceId = null;
  if (resource) {
    resourceAuthzId = AuthzUtil.getAuthzId(resource);
    resourceId = resource.id;
  }

  try {
    _.each(roles, (role, memberId) => {
      pipe(
        validator.isValidShareTarget,
        otherwise({
          code: 400,
          msg:
            'Members must be either an email, a principal id, or an email combined with a user id separated by a ":" (e.g., me@myemail.com:u:oae:abc123)'
        })
      )(memberId);

      pipe(
        validator.isDifferent,
        otherwise({
          code: 400,
          msg: 'You cannot share a resource with itself'
        })
      )(memberId, resourceAuthzId);

      pipe(
        validator.isDifferent,
        otherwise({
          code: 400,
          msg: 'You cannot share a resource with itself'
        })
      )(memberId, resourceId);

      pipe(
        validator.isValidRoleChange,
        otherwise({
          code: 400,
          msg: 'An invalid role was provided'
        })
      )(role);
    });
  } catch (error) {
    return callback(error);
  }

  // Split the targets into principal profiles and emails
  _getTargetRoles(roles, (err, targetRolesById) => {
    if (err) {
      return callback(err);
    }

    const targetRoles = _.values(targetRolesById);

    // Permission check to ensure the current user is allowed to set these roles
    AuthzPermissions.canSetRoles(ctx, resource, targetRoles, (err, memberChangeInfo, emailChangeInfo) => {
      if (err) {
        return callback(err);
      }

      // Apply the changes to the authz members, if any
      _applyMemberChanges(ctx, resource, memberChangeInfo, err => {
        if (err) {
          return callback(err);
        }

        // Apply the changes to the authz invitations, if any
        _applyInvitationChanges(ctx, resource, emailChangeInfo, err => {
          if (err) {
            return callback(err);
          }

          return callback(null, memberChangeInfo, emailChangeInfo);
        });
      });
    });
  });
};

/**
 * Resend the email invitation for the given resource and email
 *
 * @param  {Context}            ctx             Standard context object containing the current user and the current tenant
 * @param  {Resource}           resource        The resource for which to resend the invitation
 * @param  {String}             email           The email that was invited into the resource
 * @param  {Function}           callback        Standard callback function
 * @param  {Object}             callback.err    An error that occurred, if any
 */
const resendInvitation = function(ctx, resource, email, callback) {
  try {
    pipe(
      validator.isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'Only authenticated users can resend an invitation'
      })
    )(ctx);

    pipe(
      validator.isResource,
      otherwise({
        code: 400,
        msg: 'A valid resource must be provided'
      })
    )(resource);

    pipe(
      validator.isEmail,
      otherwise({
        code: 400,
        msg: 'A valid email must be provided'
      })
    )(email);
  } catch (error) {
    return callback(error);
  }

  email = email.toLowerCase();

  // Only managers can resend invitations
  AuthzPermissions.canManage(ctx, resource, err => {
    if (err) {
      return callback(err);
    }

    // Get the invitation storage hash for which to resend an invitation
    const resourceAuthzId = AuthzUtil.getAuthzId(resource);
    AuthzInvitationsDAO.getInvitation(resourceAuthzId, email, (err, invitationHash) => {
      if (err) {
        return callback(err);
      }

      // Get the email token for the specified email
      AuthzInvitationsDAO.getOrCreateTokensByEmails([email], (err, tokensByEmail) => {
        if (err) {
          return callback(err);
        }

        // Re-emit the invite event
        const emailRoles = _.object([[email, invitationHash.role]]);
        _emitInvited(ctx, resource, emailRoles, tokensByEmail, callback);
      });
    });
  });
};

/**
 * Perform the action for a user to accept an email invitation, giving them access to a heterogenous
 * set of resources to which the email was invited
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         token               The private token to use to authenticate the invitation
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {String}         callback.email      The email address that was associated to the token
 * @param  {Resource[]}     callback.resources  The resources to which the user's access changed (user could have been added or promoted) while accepting this invitation
 */
const acceptInvitation = function(ctx, token, callback) {
  try {
    pipe(
      validator.isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'Only authenticated users can accept an invitation'
      })
    )(ctx);

    pipe(
      validator.isNotEmpty,
      otherwise({
        code: 400,
        msg: 'An invitation token must be specified'
      })
    )(token);
  } catch (error) {
    return callback(error);
  }

  // Perform the accept action
  _acceptInvitation(ctx, token, (err, email, invitationHashes, memberChangeInfosByResourceId) => {
    if (err) {
      return callback(err);
    }

    // Get the profiles of all the users that performed invitations to this user
    const inviterUserIds = _.pluck(invitationHashes, 'inviterUserId');
    PrincipalsDAO.getPrincipals(inviterUserIds, null, (err, inviterUsersById) => {
      if (err) {
        log().warn(
          {
            err,
            inviterUserIds
          },
          'Failed to get inviter users after an email invitation was accepted'
        );

        // If we can't get the inviter users, we can't reliably send invitation
        // events. However, we have still successfully accepted the invitation
        return callback(null, email);
      }

      // If the user doesn't have a verified email, lets give them this one since we know it's
      // legit with this token
      _ensureVerifiedEmail(ctx, email, err => {
        if (err) {
          // Whine in the logs if this fails, but it's not critical so we can still
          // otherwise succeed
          log().warn(
            {
              err,
              user: ctx.user(),
              email
            },
            'An error occurred while trying to auto-validate the email address of a user accepting an invitation'
          );
        }

        // Fire the event for accepting an invitation. This allows resource modules to
        // update search, activity, libraries, etc... regarding the changes that have been
        // made
        ResourceActions.emit(
          ResourceConstants.events.ACCEPTED_INVITATION,
          ctx,
          invitationHashes,
          memberChangeInfosByResourceId,
          inviterUsersById,
          token,
          (errs, results) => {
            if (errs) {
              _.each(errs, err => {
                log().warn({ err }, 'An error occurred while handling an "accept invitation" event');
              });
            }

            const fullResources = _.chain(results)
              .flatten()
              .filter(resource => {
                return !resource.deleted;
              })
              .value();
            const fullResourcesByAuthzId = _.indexBy(fullResources, AuthzUtil.getAuthzId);

            // Post the accept invitation activities
            // TODO: Ideally we would do this in an event handler, but we've already emitted
            // our event, but couldn't get the resources associated to the activities until
            // after we emit it. There needs to be a resource registry where we can better
            // abstract over these things so we can handle multi-resource actions like this
            // better
            _.each(invitationHashes, invitationHash => {
              const resource = fullResourcesByAuthzId[invitationHash.resourceId];
              const inviterUser = inviterUsersById[invitationHash.inviterUserId];
              if (resource) {
                ResourceActivity.postInvitationAcceptActivity(ctx, resource, inviterUser);
              }
            });

            // Provide only the base resource properties for the user accepting the
            // invitation
            const baseResources = _.map(fullResources, resource => {
              return _.pick(resource, [
                'id',
                'tenant',
                'resourceType',
                'displayName',
                'visibility',
                'joinable',
                'profilePath'
              ]);
            });

            return callback(null, email, baseResources);
          }
        );
      });
    });
  });
};

/**
 * Ensure that the user in context has a verified email. If they currently don't have one associated
 * to their profile, the specified email address will be set as it is verified from an invitation
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     email           The email to set if there is no verified email associated to the user in context
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _ensureVerifiedEmail = function(ctx, email, callback) {
  if (ctx.user().email) {
    // If the user already has a verified email, don't reset it
    return callback();
  }

  return PrincipalsUtil.verifyEmailAddress(ctx, ctx.user(), email, callback);
};

/**
 * Perform an accept action with the validated information
 *
 * @param  {Context}    ctx                                     Standard context object containing the current user and the current tenant
 * @param  {String}     token                                   The invitation token being accepted
 * @param  {Function}   callback                                Standard callback function
 * @param  {Object}     callback.err                            An error that occurred, if any
 * @param  {String}     callback.email                          The email address that was associated to the invitation token
 * @param  {Object[]}   callback.invitationHashes               The raw invitation storage objects that were accepted
 * @param  {Object}     callback.memberChangeInfosByResourceId  The member change infos describing the members changes that were actually applied for each resource id
 * @api private
 */
const _acceptInvitation = function(ctx, token, callback) {
  // Get the email address that this token validates on behalf of
  AuthzInvitationsDAO.getEmailByToken(token, (err, email) => {
    if (err) {
      return callback(err);
    }

    // Get all the invitations that have been sent for this email address
    AuthzInvitationsDAO.getAllInvitationsByEmail(email, (err, invitationHashes) => {
      if (err) {
        return callback(err);
      }

      // Build the requested member role changes to associate the user accepting this
      // invitation. There will be at most one role change per resource, as a user can only
      // be invited to a resource once
      const memberRolesByResourceId = {};
      _.each(invitationHashes, invitationHash => {
        const { resourceId } = invitationHash;
        memberRolesByResourceId[resourceId] = memberRolesByResourceId[resourceId] || {};
        memberRolesByResourceId[resourceId][ctx.user().id] = invitationHash.role;
      });

      // Apply the changes to authz, while determining the actual net authz changes for the
      // user. For example, if they are accepting an invitation to another one of their email
      // addresses, and their account already has manager access to the resource, the role
      // change will be rejected because they shouldn't be demoted due to an invitation
      _applyAllMemberChanges(memberRolesByResourceId, (err, idChangeInfosByResourceId) => {
        if (err) {
          return callback(err);
        }

        const membersById = _.object([[ctx.user().id, ctx.user()]]);
        const memberChangeInfosByResourceId = _.mapObject(idChangeInfosByResourceId, idChangeInfo => {
          // Map the id change infos into member change infos
          return AuthzModel.MemberChangeInfo.fromIdChangeInfo(idChangeInfo, membersById);
        });

        // Remove all invitations for the email
        AuthzInvitationsDAO.deleteInvitationsByEmail(email, err => {
          if (err) {
            log().warn(
              {
                err,
                email
              },
              'Failed to delete invitations after an email invitation has been accepted'
            );
          }

          return callback(null, email, invitationHashes, memberChangeInfosByResourceId);
        });
      });
    });
  });
};

/**
 * Given a merged representation of `MemberRoles` and `EmailRoles`, derive their associated share
 * targets, with principal profiles expanded (if any), and their associated roles applied
 *
 * @param  {IdRoles}        roles                       Indicate the role changes being applied. Some keys will be principal ids and some will be emails
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {ShareTarget[]}  callback.targetRolesById    The share targets, keyed by their original target id, with their desired roles applied
 * @api private
 */
const _getTargetRoles = function(roles, callback) {
  _getTargets(_.keys(roles), (err, targetsById) => {
    if (err) {
      return callback(err);
    }

    // Apply the roles to each share target
    _.each(targetsById, (target, targetId) => {
      target.role = roles[targetId];
    });

    return callback(null, targetsById);
  });
};

/**
 * Given a list of share target expressions, fetch the principal profiles and respond with a
 * complete list of `ShareTarget` object representations that omit roles
 *
 * @param  {String[]}       targetIds               A list of share target expressions
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Object}         callback.targetsById    An object keyed by the target id whose value is the actual ShareTarget parsed from the target ids
 * @api private
 */
const _getTargets = function(targetIds, callback) {
  // Map the original target ids to each parsed target
  const targetsById = {};

  // Emails are lower-cased, but we still need to keep track of the original target id so that the
  // consumer can, for example, remap each share target to associated roles. So, for each email
  // target, keep track of the lower-case -> original-case mapping so that we can re-associate
  // users we have found by email to their original target ids
  const emailCaseMapping = {};

  // Gathers all emails we need to use to fetch user accounts that are being shared with directly
  // by email
  const emails = [];

  // Populate the parsed targets and emails to share with
  _.each(targetIds, targetId => {
    const target = AuthzUtil.parseShareTarget(targetId);
    if (target) {
      targetsById[targetId] = target;
      if (!target.principalId) {
        emails.push(target.email);
        emailCaseMapping[target.email] = targetId;
      }
    }
  });

  const innerCallback = function(err, userIdsByEmails) {
    if (err) {
      return callback(err);
    }

    // For each email for which we have a distinct user account, assign the principal id to the
    // target, as we will associate the share to that user account
    _.each(emails, email => {
      const originalTargetId = emailCaseMapping[email];
      const userIds = userIdsByEmails[email];
      if (_.size(userIds) === 1) {
        targetsById[originalTargetId].principalId = _.first(userIds);
      }
    });

    // Expand all our principals into principal profiles. If there are no principals associated
    // to the share targets, we short-circuit with just our email targets
    const principalIds = _.chain(targetsById)
      .pluck('principalId')
      .uniq()
      .compact()
      .value();
    if (_.isEmpty(principalIds)) {
      // If there are no principal profiles to expand, just return
      return callback(null, targetsById);
    }

    PrincipalsDAO.getExistingPrincipals(principalIds, null, (err, principalsById) => {
      if (err) {
        return callback(err);
      }

      // Update each target in place to swap out its `principalId` for the full `principal`
      // profile
      _.each(targetsById, target => {
        const { principalId } = target;
        if (principalId) {
          target.principal = principalsById[principalId];
          delete target.principalId;
        }
      });

      return callback(null, targetsById);
    });
  };

  // For all email targets, see if there is already an account associated with them. If so, they
  // will be pre-validated user share targets
  if (_.isEmpty(emails)) {
    innerCallback();
  } else {
    PrincipalsDAO.getUserIdsByEmails(emails, innerCallback);
  }
};

/**
 * Apply the given `MemberRoles` changes for each specified resource id
 *
 * @param  {Object}     memberRolesByResourceId             An object keyed by resource id, whose values are the `MemberRoles` objects to apply to change their access
 * @param  {Function}   callback                            Standard callback function
 * @param  {Object}     callback.err                        An error that occurred, if any
 * @param  {Object}     callback.idChangeInfosByResourceId  An object keyed by resource id, whose values are the `MemberChangeInfo` objects that describe the canonical changes to apply to the member roles
 * @api private
 */
const _applyAllMemberChanges = function(memberRolesByResourceId, callback) {
  if (_.isEmpty(memberRolesByResourceId)) {
    return callback(null, {});
  }

  const idChangeInfosByResourceId = {};
  const _done = _.chain(memberRolesByResourceId)
    .size()
    .after(() => {
      return callback(null, idChangeInfosByResourceId);
    })
    .value();

  _.each(memberRolesByResourceId, (memberRoles, resourceId) => {
    // First determine what changes to actually apply. If someone accepts an invitation and they
    // already have manager role, an invitation that invited them as viewer should not demote
    // their role. Therefore, we only take into consideration promotions, similar to share
    AuthzAPI.computeMemberRolesAfterChanges(resourceId, memberRoles, { promoteOnly: true }, (err, idChangeInfo) => {
      if (err) {
        log().warn({ err }, 'An error occurred computing member role changes when an invitation was accepted');
        return _done();
      }

      if (_.isEmpty(idChangeInfo.changes)) {
        // Ignore any resource where its invitation change should not be applied
        return _done();
      }

      // Perform the actual changes in the resource roles. When an invitation is created, it
      // is the authz id that is persisted as the resource id in the invitations schema.
      // Therefore, we can safely use this resource id to update the roles in the authz api
      AuthzAPI.updateRoles(resourceId, idChangeInfo.changes, err => {
        if (err) {
          log().warn({ err }, 'An error occurred applying member role changes when an invitation was accepted');
          return _done();
        }

        // Record this as a change that was made
        idChangeInfosByResourceId[resourceId] = idChangeInfo;

        return _done();
      });
    });
  });
};

/**
 * Apply the member role changes provided by the member change info object
 *
 * @param  {Context}            ctx                 Standard context object containing the current user and the current tenant
 * @param  {Resource}           resource            The resource for which to make the role changes
 * @param  {MemberChangeInfo}   memberChangeInfo    The member change info to apply
 * @param  {Function}           callback            Standard callback function
 * @param  {Object}             callback.err        An error that occurred, if any
 * @api private
 */
const _applyMemberChanges = function(ctx, resource, memberChangeInfo, callback) {
  if (_.isEmpty(memberChangeInfo.changes)) {
    return callback();
  }

  const authzResourceId = AuthzUtil.getAuthzId(resource);
  return AuthzAPI.updateRoles(authzResourceId, memberChangeInfo.changes, callback);
};

/**
 * Apply the invitation role changes provided by the email change info object
 *
 * @param  {Context}            ctx                 Standard context object containing the current user and the current tenant
 * @param  {Resource}           resource            The resource for which to make the role changes
 * @param  {EmailChangeInfo}    emailChangeInfo     The email change info to apply
 * @param  {Function}           callback            Standard callback function
 * @param  {Object}             callback.err        An error that occurred, if any
 * @api private
 */
const _applyInvitationChanges = function(ctx, resource, emailChangeInfo, callback) {
  const addedEmailRoles = _.pick(emailChangeInfo.changes, emailChangeInfo.emails.added);
  const updatedEmailRoles = _.omit(emailChangeInfo.changes, emailChangeInfo.emails.added);
  const authzResourceId = AuthzUtil.getAuthzId(resource);
  OaeUtil.invokeIfNecessary(
    !_.isEmpty(updatedEmailRoles),
    AuthzInvitationsDAO.updateInvitationRoles,
    authzResourceId,
    updatedEmailRoles,
    err => {
      if (err) {
        return callback(err);
      }

      OaeUtil.invokeIfNecessary(
        !_.isEmpty(addedEmailRoles),
        AuthzInvitationsDAO.createInvitations,
        authzResourceId,
        addedEmailRoles,
        ctx.user().id,
        (err, emailTokens) => {
          if (err) {
            return callback(err);
          }

          return _emitInvited(ctx, resource, addedEmailRoles, emailTokens, callback);
        }
      );
    }
  );
};

/**
 * Emit the `ResourceConstants.events.INVITED` event for the given email invitation role changes
 * that were applied
 *
 * @param  {Context}        ctx             Standard context object containing the current user and the current tenant
 * @param  {Resource}       resource        The resource whose invitations were updated
 * @param  {EmailRoles}     emailRoles      The email role changes that were applied to the authz invitations of the resource
 * @param  {Object}         emailTokens     An object keyed by email, whose value is the associated email token that can be used to accept the invitation
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 * @api private
 */
const _emitInvited = function(ctx, resource, emailRoles, emailTokens, callback) {
  if (_.isEmpty(emailRoles)) {
    return callback();
  }

  // Get a list of full invitation objects that describe the invitations
  const invitations = _.map(emailRoles, (role, email) => {
    return new Invitation(resource, email, ctx.user(), role);
  });

  // Emit the invitations that were sent along with the email tokens that can be used to accept
  // them
  ResourceActions.emit(ResourceConstants.events.INVITED, ctx, invitations, emailTokens, errs => {
    if (errs) {
      log().warn(
        {
          errs,
          resourceId: resource.id,
          emailRoles
        },
        'An error occurred while emitting invited event after inviting users'
      );
    }

    return callback();
  });
};

export { ResourceActions as emitter, create, share, setRoles, resendInvitation, acceptInvitation };
