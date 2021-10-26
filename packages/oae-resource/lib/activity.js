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

import * as ActivityAPI from 'oae-activity/lib/api.js';
import * as ActivityModel from 'oae-activity/lib/model.js';
import { AuthzConstants } from 'oae-authz/lib/constants.js';
import { ActivityConstants } from 'oae-activity/lib/constants.js';

/**
 * Post the "accept invitation" activity for the given context and target resource
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Resource}   resource        The resource to which the user in context accepted an invitation
 * @param  {User}       inviterUser     The user who performed the invitation
 */
const postInvitationAcceptActivity = function (ctx, resource, inviterUser) {
  const millis = Date.now();
  // eslint-disable-next-line new-cap
  const actorResource = new ActivityModel.ActivitySeedResource.fromResource(ctx.user());
  // eslint-disable-next-line new-cap
  const objectResource = new ActivityModel.ActivitySeedResource.fromResource(inviterUser);
  // eslint-disable-next-line new-cap
  const targetResource = new ActivityModel.ActivitySeedResource.fromResource(resource);

  const activitySeed = new ActivityModel.ActivitySeed(
    AuthzConstants.activity.ACTIVITY_INVITATION_ACCEPT,
    millis,
    ActivityConstants.verbs.ACCEPT,
    actorResource,
    objectResource,
    targetResource
  );

  ActivityAPI.postActivity(ctx, activitySeed);
};

export { postInvitationAcceptActivity };
