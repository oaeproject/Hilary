/*!
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

import * as PrincipalsUtil from 'oae-principals/lib/util';

import * as AuthzInvitationsDAO from 'oae-authz/lib/invitations/dao';
import * as AuthzPermissions from 'oae-authz/lib/permissions';
import * as AuthzUtil from 'oae-authz/lib/util';

import { Invitation } from 'oae-authz/lib/invitations/model';

/**
 * Get all the invitations for the specified resource
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {Resource}       resource                The resource for which to fetch invitations
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Invitation[]}   callback.invitations    The invitations for the resource
 */
const getAllInvitations = function(ctx, resource, callback) {
  AuthzPermissions.canManage(ctx, resource, err => {
    if (err) {
      return callback(err);
    }

    const resourceAuthzId = AuthzUtil.getAuthzId(resource);
    AuthzInvitationsDAO.getAllInvitationsByResourceId(resourceAuthzId, (err, invitationHashes) => {
      if (err) {
        return callback(err);
      }

      return _invitationsFromHashes(ctx, resource, invitationHashes, callback);
    });
  });
};

/**
 * Convert all the invitation hashes into a full invitation model object
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {Resource}       resource                The resource for which to convert the invitation hashes
 * @param  {Object[]}       invitationHashes        The list of invitation storage hashes to convert
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Invitation[]}   callback.invitations    The invitations for the resource
 * @api private
 */
const _invitationsFromHashes = function(ctx, resource, invitationHashes, callback) {
  const inviterUserIds = _.chain(invitationHashes)
    .pluck('inviterUserId')
    .uniq()
    .value();
  PrincipalsUtil.getPrincipals(ctx, inviterUserIds, (err, principalsById) => {
    if (err) {
      return callback(err);
    }

    const invitations = _.map(invitationHashes, invitationHash => {
      const inviterUser = principalsById[invitationHash.inviterUserId];
      return new Invitation(resource, invitationHash.email, inviterUser, invitationHash.role);
    });

    return callback(null, invitations);
  });
};

export { getAllInvitations };
