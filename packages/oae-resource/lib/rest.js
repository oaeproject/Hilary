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

import * as OAE from 'oae-util/lib/oae.js';
import * as ResourceActions from 'oae-resource/lib/actions.js';

/**
 * @REST postInvitationAccept
 *
 * Accept an invitation that was sent by email
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /invitation/accept
 * @BodyParam   {string}                token               The secret invitation token representing the invitation to accept
 * @Return      {InvitationAcceptResult}                    The result of accepting the invitation
 * @HttpResponse                        200                 Invitation was successfully accepted
 * @HttpResponse                        400                 A valid token must be provided
 * @HttpResponse                        401                 You must be authenticated to accept an invitation
 * @HttpResponse                        404                 The token did not reference any existing invitation
 */
OAE.tenantRouter.on('post', '/api/invitation/accept', (request, response) => {
  ResourceActions.acceptInvitation(request.ctx, request.body.token, (error, email, resources) => {
    if (error) return response.status(error.code).send(error.msg);

    return response.status(200).send({ email, resources });
  });
});
