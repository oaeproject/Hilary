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

const _ = require('underscore');

const AuthzUtil = require('oae-authz/lib/util');
const ResourceActions = require('oae-resource/lib/actions');
const { ResourceConstants } = require('oae-resource/lib/constants');
const TenantsAPI = require('oae-tenants');

const MixpanelUtil = require('oae-mixpanel/lib/util');

module.exports = function(client) {
  /**
   * One or more invitations were sent out
   */
  MixpanelUtil.listen(
    ResourceActions,
    ResourceConstants.events.INVITED,
    (ctx, invitations, emailTokens) => {
      _.each(invitations, invitation => {
        const params = MixpanelUtil.getBasicParameters(ctx);
        params.inviteToken = emailTokens[invitation.email];

        // The tenant to which the user was invited
        params.tenantTo = TenantsAPI.getTenantByEmail(invitation.email).alias;

        // The email domain of the invited guest
        params.emailDomain = invitation.email.split('@').pop();

        // Determine for which type of resource the guest was invited
        const resource = AuthzUtil.getResourceFromId(invitation.resource.id);
        if (resource.resourceType === 'c') {
          params.resourceType = 'content';
        } else if (resource.resourceType === 'd') {
          params.resourceType = 'discussion';
        } else if (resource.resourceType === 'g') {
          params.resourceType = 'group';
        } else if (resource.resourceType === 'f') {
          params.resourceType = 'folder';
        }

        client.track(ResourceConstants.events.INVITED, params);
        client.people.increment(params.distinct_id, ResourceConstants.events.INVITED);
      });
    }
  );

  /*!
     * One or more invitations were accepted
     */
  MixpanelUtil.listen(
    ResourceActions,
    ResourceConstants.events.ACCEPTED_INVITATION,
    (ctx, invitationHashes, memberChangeInfosByResourceId, inviterUsersById, token) => {
      _.each(invitationHashes, invitation => {
        const params = MixpanelUtil.getBasicParameters(ctx);
        params.inviteToken = token;

        // The tenant from which the inviter invited the user
        params.tenantFrom = inviterUsersById[invitation.inviterUserId].tenant.alias;

        // The tenant to which the user was invited
        params.tenantTo = TenantsAPI.getTenantByEmail(invitation.email).alias;

        // The user who invited this guest
        params.invitedBy = invitation.inviterUserId;

        // The email domain of the invited guest
        params.emailDomain = invitation.email.split('@').pop();

        client.track(ResourceConstants.events.ACCEPTED_INVITATION, params);
        client.people.increment(params.distinct_id, ResourceConstants.events.ACCEPTED_INVITATION);
      });
    }
  );
};
