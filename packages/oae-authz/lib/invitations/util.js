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

import * as OaeUtil from 'oae-util/lib/util.js';

import * as AuthzInvitationsDAO from 'oae-authz/lib/invitations/dao.js';
import * as AuthzModel from 'oae-authz/lib/model.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';

/**
 * Given an authz resource id and proposed email role changes, compute the EmailChangeInfo object
 * that describes how the roles would change
 *
 * @param  {String}             authzResourceId             The authz resource id against which to compute
 * @param  {EmailRoles}         changes                     The role changes to compute
 * @param  {Object}             [opts]                      Optional arguments
 * @param  {Boolean}            [opts.promoteOnly]          If `true`, indicates that only promotions should be considered. Demotions and removals will be disregarded from the canonical list of changes
 * @param  {Function}           [callback]                  Standard callback function
 * @param  {Object}             [callback.err]              An error that occurred, if any
 * @param  {EmailChangeInfo}    [callback.emailChangeInfo]  The computed change information
 */
const computeInvitationRolesAfterChanges = function (authzResourceId, changes, options, callback) {
  // If no resource id is provided, we treat this invocation as though the invitations list is
  // empty (i.e., a resource is currently being created with invitations)
  OaeUtil.invokeIfNecessary(
    authzResourceId,
    AuthzInvitationsDAO.getAllInvitationsByResourceId,
    authzResourceId,
    (error, invitations) => {
      if (error) {
        return callback(error);
      }

      const invitationRolesBefore = _.chain(invitations)
        .indexBy('email')
        .mapObject((invitation) => invitation.role)
        .value();
      const idChangeInfo = AuthzUtil.computeRoleChanges(invitationRolesBefore, changes, options);
      return callback(null, AuthzModel.EmailChangeInfo.fromIdChangeInfo(idChangeInfo));
    }
  );
};

export { computeInvitationRolesAfterChanges };
