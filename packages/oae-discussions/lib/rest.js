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

import * as DiscussionsAPI from 'oae-discussions';

import { forEach, forEachObjIndexed } from 'ramda';
import _ from 'underscore';

import { AuthzConstants } from 'oae-authz/lib/constants.js';
import * as OAE from 'oae-util/lib/oae.js';
import * as OaeUtil from 'oae-util/lib/util.js';

/**
 * @REST postDiscussionCreate
 *
 * Create a new discussion
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /discussion/create
 * @FormParam   {string}            description         A longer description for the discussion
 * @FormParam   {string}            displayName         The display name of the discussion
 * @FormParam   {string[]}          [managers]          Unique identifier(s) for users and groups to add as managers of the discussion. The user creating the discussion will be added as a manager automatically
 * @FormParam   {string[]}          [members]           Unique identifier(s) for users and groups to add as members of the discussion
 * @FormParam   {string}            [visibility]        The visibility of the discussion. Defaults to the configured tenant default          [loggedin,private,public]
 * @Return      {BasicDiscussion}                       The created discussion
 * @HttpResponse                    200                 Discussion created
 * @HttpResponse                    400                 Must provide a display name for the discussion
 * @HttpResponse                    400                 Must provide a description for the discussion
 * @HttpResponse                    400                 A display name can be at most 1000 characters long
 * @HttpResponse                    400                 A description can be at most 10000 characters long
 * @HttpResponse                    400                 An invalid discussion visibility option has been provided
 * @HttpResponse                    400                 One or more target members being granted access are not authorized to become members on this discussion
 * @HttpResponse                    400                 One or more target members being granted access do not exist
 * @HttpResponse                    401                 Anonymous users cannot create a discussion
 */
OAE.tenantRouter.on('post', '/api/discussion/create', (request, response) => {
  // Ensure proper arrays for the additional members
  request.body.managers = OaeUtil.toArray(request.body.managers);
  request.body.members = OaeUtil.toArray(request.body.members);

  // Construct a hash for additional members that maps each user to their role
  const roles = {};
  forEach((manager) => {
    roles[manager] = AuthzConstants.role.MANAGER;
  }, request.body.managers);
  forEach((member) => {
    roles[member] = AuthzConstants.role.MEMBER;
  }, request.body.members);

  DiscussionsAPI.Discussions.createDiscussion(
    request.ctx,
    request.body.displayName,
    request.body.description,
    request.body.visibility,
    roles,
    null,
    (error, discussion) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).send(discussion);
    }
  );
});

/**
 * @REST postDiscussionDiscussionId
 *
 * Update a discussion
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /discussion/{discussionId}
 * @PathParam   {string}            discussionId        The id of the discussion to update
 * @FormParam   {string}            [description]       Updated description for the discussion
 * @FormParam   {string}            [displayName]       Updated display name for the discussion
 * @FormParam   {string}            [visibility]        Updated visibility for the discussion           [loggedin,private,public]
 * @Return      {BasicDiscussion}                       The updated discussion
 * @HttpResponse                    200                 Discussion updated
 * @HttpResponse                    400                 A valid discussion id must be provided
 * @HttpResponse                    400                 A display name cannot be empty
 * @HttpResponse                    400                 A description cannot be empty
 * @HttpResponse                    400                 A display name can be at most 1000 characters long
 * @HttpResponse                    400                 A description can only be 10000 characters long
 * @HttpResponse                    400                 An invalid visibility was specified
 * @HttpResponse                    400                 An invalid field was specified
 * @HttpResponse                    400                 You should specify at least one profile field to update
 * @HttpResponse                    401                 You are not authorized to update this discussion
 * @HttpResponse                    404                 Could not find the specified discussion
 */
OAE.tenantRouter.on('post', '/api/discussion/:discussionId', (request, response) => {
  DiscussionsAPI.Discussions.updateDiscussion(
    request.ctx,
    request.params.discussionId,
    request.body,
    (error, discussion) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).send(discussion);
    }
  );
});

/**
 * @REST deleteDiscussionDiscussionId
 *
 * Delete a discussion
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /discussion/{discussionId}
 * @PathParam   {string}        discussionId        The id of the discussion to delete
 * @HttpResponse                200                 Discussion deleted
 * @HttpResponse                400                 A valid discussion id must be provided
 * @HttpResponse                401                 You are not authorized to delete this discussion
 * @HttpResponse                404                 Could not find the specified discussion
 */
OAE.tenantRouter.on('delete', '/api/discussion/:discussionId', (request, response) => {
  DiscussionsAPI.Discussions.deleteDiscussion(request.ctx, request.params.discussionId, (error, message) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(message);
  });
});

/**
 * @REST getDiscussionLibraryPrincipalId
 *
 * Get the discussions library items for a user or group
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /discussion/library/{principalId}
 * @PathParam   {string}                principalId         The id of the principal whose discussion library to fetch
 * @QueryParam  {number}                [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}                [start]             The discussion paging token from which to start fetching discussions
 * @Return      {DiscussionsLibrary}                        The discussions library items for the specified user or group
 * @HttpResponse                        200                 Discussion library available
 * @HttpResponse                        400                 A user or group id must be provided
 * @HttpResponse                        401                 You do not have have access to this library
 */
OAE.tenantRouter.on('get', '/api/discussion/library/:principalId', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 12, 1, 25);
  DiscussionsAPI.Discussions.getDiscussionsLibrary(
    request.ctx,
    request.params.principalId,
    request.query.start,
    limit,
    (error, discussions, nextToken) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).send({ results: discussions, nextToken });
    }
  );
});

/**
 * @REST deleteDiscussionLibraryPrincipalIdDiscussionId
 *
 * Remove a discussion from a discussion library
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /discussion/library/{principalId}/{discussionId}
 * @PathParam   {string}                principalId         The id of the principal from whose discussion library to remove the discussion
 * @PathParam   {string}                discussionId        The id of the discussion to remove from the library
 * @HttpResponse                        200                 Discussion removed from library
 * @HttpResponse                        400                 A user or group id must be provided
 * @HttpResponse                        400                 An invalid discussion id was provided
 * @HttpResponse                        400                 The requested change results in a discussion with no managers
 * @HttpResponse                        400                 The specified discussion is not in this library
 * @HttpResponse                        401                 You are not authorized to remove a discussion from this library
 * @HttpResponse                        404                 Could not find the specified discussion
 */
OAE.tenantRouter.on('delete', '/api/discussion/library/:principalId/:discussionId', (request, response) => {
  DiscussionsAPI.Discussions.removeDiscussionFromLibrary(
    request.ctx,
    request.params.principalId,
    request.params.discussionId,
    (error) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).end();
    }
  );
});

/**
 * @REST getDiscussionDiscussionId
 *
 * Get a full discussion profile
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /discussion/{discussionId}
 * @PathParam   {string}                discussionId        The id of the discussion to get
 * @Return      {Discussion}                                Full discussion profile
 * @HttpResponse                        200                 Discussion profile available
 * @HttpResponse                        400                 discussionId must be a valid resource id
 * @HttpResponse                        401                 You are not authorized to view this discussion
 * @HttpResponse                        404                 Could not find the specified discussion
 */
OAE.tenantRouter.on('get', '/api/discussion/:discussionId', (request, response) => {
  DiscussionsAPI.Discussions.getFullDiscussionProfile(request.ctx, request.params.discussionId, (error, discussion) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).send(discussion);
  });
});

/**
 * @REST postDiscussionDiscussionIdShare
 *
 * Share a discussion
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /discussion/{discussionId}/share
 * @PathParam   {string}                discussionId        The id of the discussion to share
 * @FormParam   {string[]}              members             Unique identifier(s) for users and groups to share the discussion with
 * @Return      {void}
 * @HttpResponse                        200                 Discussion shared
 * @HttpResponse                        400                 A valid discussion id must be provided
 * @HttpResponse                        400                 At least one principal id needs to be passed in
 * @HttpResponse                        400                 Invalid principal id provided
 * @HttpResponse                        400                 One or more target members are not authorized to become members on this discussion
 * @HttpResponse                        400                 The discussion must at least be shared with 1 user or group
 * @HttpResponse                        400                 The member id: ... is not a valid member id
 * @HttpResponse                        401                 You are not authorized to share this discussion
 * @HttpResponse                        404                 Could not find the specified discussion
 */
OAE.tenantRouter.on('post', '/api/discussion/:discussionId/share', (request, response) => {
  let members = OaeUtil.toArray(request.body.members);
  members = _.compact(members);

  DiscussionsAPI.Discussions.shareDiscussion(request.ctx, request.params.discussionId, members, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
});

/**
 * @REST postDiscussionDiscussionIdMembers
 *
 * Update the members of a discussion
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /discussion/{discussionId}/members
 * @PathParam   {string}                    discussionId        The id of the discussion to update the members for
 * @BodyParam   {DiscussionMembersUpdate}   body                Object that describes the membership updates to apply to the discussion
 * @Return      {void}
 * @HttpResponse                            200                 Discussion members updated
 * @HttpResponse                            400                 A valid discussion id must be provided
 * @HttpResponse                            400                 Invalid principal id specified
 * @HttpResponse                            400                 Must specify at least one permission change to apply
 * @HttpResponse                            400                 One or more target members being granted access are not authorized to become members on this discussion
 * @HttpResponse                            400                 The requested change results in a discussion with no managers
 * @HttpResponse                            400                 An invalid role value was specified. Must either be a string, or false
 * @HttpResponse                            400                 You must specify at least one permission change
 * @HttpResponse                            401                 You are not authorized to update the permissions of this discussion
 * @HttpResponse                            404                 Could not find the specified discussion
 */
OAE.tenantRouter.on('post', '/api/discussion/:discussionId/members', (request, response) => {
  // Parse the incoming false values
  const permissionUpdates = {};
  forEachObjIndexed((value, key) => {
    permissionUpdates[key] = OaeUtil.castToBoolean(value);
  }, request.body);

  DiscussionsAPI.Discussions.setDiscussionPermissions(
    request.ctx,
    request.params.discussionId,
    permissionUpdates,
    (error) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).end();
    }
  );
});

/**
 * @REST getDiscussionDiscussionIdMembers
 *
 * Get the members of a discussion and their roles
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /discussion/{discussionId}/members
 * @PathParam   {string}                discussionId        The id of the discussion to get the members for
 * @QueryParam  {number}                [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}                [start]             The discussion paging token from which to start fetching discussion members
 * @Return      {MembersResponse}                           Members of the specified discussion
 * @HttpResponse                        200                 Discussion members available
 * @HttpResponse                        400                 A valid discussion id must be provided
 * @HttpResponse                        401                 You are not authorized to view this discussion
 * @HttpResponse                        404                 Could not find the specified discussion
 */
OAE.tenantRouter.on('get', '/api/discussion/:discussionId/members', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 10, 1, 25);
  DiscussionsAPI.Discussions.getDiscussionMembers(
    request.ctx,
    request.params.discussionId,
    request.query.start,
    limit,
    (error, members, nextToken) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).send({ results: members, nextToken });
    }
  );
});

/**
 * @REST getDiscussionDiscussionIdInvitations
 *
 * Get all the invitations associated to a discussion
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /discussion/{discussionId}/invitations
 * @PathParam   {string}                discussionId        The id of the discussion for which to get invitations
 * @Return      {InvitationsResponse}                       The invitations associated to the discussion
 * @HttpResponse                        200                 Invitations available
 * @HttpResponse                        400                 A valid discussion id must be provided
 * @HttpResponse                        401                 You are not allowed to get invitations for this discussion
 * @HttpResponse                        404                 Discussion not available
 */
OAE.tenantRouter.on('get', '/api/discussion/:discussionId/invitations', (request, response) => {
  DiscussionsAPI.Discussions.getDiscussionInvitations(
    request.ctx,
    request.params.discussionId,
    (error, invitations) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).send({ results: invitations });
    }
  );
});

/**
 * @REST postDiscussionDiscussionIdInvitationsEmailResend
 *
 * Resend an invitation to a discussion
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /discussion/{discussionId}/invitations/{email}/resend
 * @PathParam   {string}                discussionId        The id of the discussion for which to get invitations
 * @PathParam   {string}                email               The email for which to resend the invitation
 * @Return      {void}
 * @HttpResponse                        200                 Invitation was resent
 * @HttpResponse                        400                 A valid discussion id must be provided
 * @HttpResponse                        400                 A valid email must be provided
 * @HttpResponse                        401                 You are not allowed to resend invitations for this discussion
 * @HttpResponse                        404                 Discussion not available
 * @HttpResponse                        404                 No invitation for the specified email exists for the discussion
 */
OAE.tenantRouter.on('post', '/api/discussion/:discussionId/invitations/:email/resend', (request, response) => {
  DiscussionsAPI.Discussions.resendDiscussionInvitation(
    request.ctx,
    request.params.discussionId,
    request.params.email,
    (error) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).end();
    }
  );
});

/**
 * @REST getDiscussionDiscussionIdMessages
 *
 * Get the messages in a discussion
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /discussion/{discussionId}/messages
 * @PathParam   {string}                discussionId        The id of the discussion for which to get the messages
 * @QueryParam  {number}                [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}                [start]             The messages paging token from which to start fetching messages
 * @Return      {MessagesResponse}                          The messages in the discussion
 * @HttpResponse                        200                 Discussion messages available
 * @HttpResponse                        400                 A messageBoxId must be specified
 * @HttpResponse                        400                 A timestamp cannot be in the future.
 * @HttpResponse                        400                 A timestamp cannot be null
 * @HttpResponse                        400                 A timestamp should be an integer
 * @HttpResponse                        400                 Must provide a valid discussion id
 * @HttpResponse                        401                 You are not authorized to view this discussion
 * @HttpResponse                        404                 Could not find the specified discussion
 */
OAE.tenantRouter.on('get', '/api/discussion/:discussionId/messages', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 10, 1, 25);
  DiscussionsAPI.Discussions.getMessages(
    request.ctx,
    request.params.discussionId,
    request.query.start,
    limit,
    (error, messages, nextToken) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).send({ results: messages, nextToken });
    }
  );
});

/**
 * @REST postDiscussionDiscussionIdMessages
 *
 * Create a new message in a discussion
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /discussion/{discussionId}/messages
 * @PathParam   {string}        discussionId        The id of the discussion to which to post the message
 * @FormParam   {string}        body                The body of the message
 * @FormParam   {number}        [replyTo]           The timestamp of the message to which this message is a reply. Not specifying this will create a top level comment
 * @Return      {Message}                           The created message
 * @HttpResponse                200                 Discussion message created
 * @HttpResponse                400                 A discussion body can only be 100000 characters long
 * @HttpResponse                400                 A discussion body must be provided
 * @HttpResponse                400                 A messageBoxId must be specified
 * @HttpResponse                400                 If the replyToCreated optional parameter is specified, it should point to an existing reply
 * @HttpResponse                400                 Invalid discussion id provided
 * @HttpResponse                400                 The body of the message must be specified
 * @HttpResponse                401                 You are not authorized to post messages to this discussion
 * @HttpResponse                404                 Could not find the specified discussion
 */
OAE.tenantRouter.on('post', '/api/discussion/:discussionId/messages', (request, response) => {
  DiscussionsAPI.Discussions.createMessage(
    request.ctx,
    request.params.discussionId,
    request.body.body,
    request.body.replyTo,
    (error, message) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).send(message);
    }
  );
});

/**
 * @REST deleteDiscussionDiscussionIdMessagesCreated
 *
 * Delete a message in a discussion
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /discussion/{discussionId}/messages/{created}
 * @PathParam   {string}                discussionId        The id of the discussion from which to delete the message
 * @PathParam   {number}                created             The timestamp of the message that should be deleted
 * @Return      {Message}                                   When the message has been soft deleted (because it has replies), a stripped down message object representing the deleted message will be returned, with the `deleted` parameter set to `false`. If the message has been removed entirely, no message object will be returned
 * @HttpResponse                        200                 Discussion message deleted
 * @HttpResponse                        400                 A discussion id must be provided
 * @HttpResponse                        400                 A messageBoxId must be specified
 * @HttpResponse                        400                 A valid integer message created timestamp must be specified
 * @HttpResponse                        400                 The createdTimestamp should point to an existing message
 * @HttpResponse                        401                 You are not authorized to delete this message
 * @HttpResponse                        404                 Could not find the specified discussion
 * @HttpResponse                        404                 Could not find the specified message
 */
OAE.tenantRouter.on('delete', '/api/discussion/:discussionId/messages/:created', (request, response) => {
  DiscussionsAPI.Discussions.deleteMessage(
    request.ctx,
    request.params.discussionId,
    request.params.created,
    (error, message) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).send(message);
    }
  );
});
