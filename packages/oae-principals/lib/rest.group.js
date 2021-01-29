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

import { AuthzConstants } from 'oae-authz/lib/constants';

import * as OAE from 'oae-util/lib/oae';
import * as OaeUtil from 'oae-util/lib/util';
import PrincipalsAPI from './api.js';

/**
 * @REST postGroupCreate
 *
 * Create a new group
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /group/create
 * @FormParam   {string}        displayName             The display name of the group
 * @FormParam   {string}        [description]           A longer description for the group
 * @FormParam   {string}        [joinable]              How the group can be joined            [no,request,yes]
 * @FormParam   {string[]}      [managers]              Unique identifier(s) for users and groups to add as manager of the group. The user creating the group will be added as a manager automatically
 * @FormParam   {string[]}      [members]               Unique identifier(s) for users and groups to add as members of the group
 * @FormParam   {string}        [visibility]            The visibility of the group. Defaults to the configured tenant default           [loggedin,private,public]
 * @Return      {BasicGroup}                            The created group
 * @HttpResponse                201                     Group created
 * @HttpResponse                400                     You need to provide a display name for this group
 * @HttpResponse                400                     A display name can be at most 1000 characters long
 * @HttpResponse                400                     A description can only be 10000 characters long
 * @HttpResponse                400                     One or more target members being granted access do not exist
 * @HttpResponse                400                     Only valid principal IDs are accepted
 * @HttpResponse                400                     Invalid joinable setting was provided
 * @HttpResponse                400                     Invalid visibility setting was provided
 * @HttpResponse                401                     Cannot create a group anonymously
 */
OAE.tenantRouter.on('post', '/api/group/create', (request, response) => {
  const managers = OaeUtil.toArray(request.body.managers);
  const members = OaeUtil.toArray(request.body.members);

  // Construct a single hash that will contain the permissions
  const memberHash = {};
  _.each(managers, (userId) => {
    memberHash[userId] = AuthzConstants.role.MANAGER;
  });
  _.each(members, (userId) => {
    memberHash[userId] = AuthzConstants.role.MEMBER;
  });

  PrincipalsAPI.createGroup(
    request.ctx,
    request.body.displayName,
    request.body.description,
    request.body.visibility,
    request.body.joinable,
    memberHash,
    (error, group) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(201).send(group);
    }
  );
});

/**
 * @REST deleteGroupGroupId
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /group/{groupId}
 * @PathParam   {string}        groupId             The id of the group to delete
 * @Return      {Group}                             The basic group profile of the deleted group
 * @HttpResponse                200                 The group was successfully deleted
 * @HttpResponse                400                 An invalid group id was specified
 * @HttpResponse                401                 You do not have access to delete this group
 * @HttpResponse                404                 The group did not exist
 */
OAE.tenantRouter.on('delete', '/api/group/:groupId', (request, response) => {
  PrincipalsAPI.deleteGroup(request.ctx, request.params.groupId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST restoreGroupGroupId
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /group/{groupId}
 * @PathParam   {string}        groupId             The id of the group to restore
 * @HttpResponse                200                 The group was successfully restored
 * @HttpResponse                400                 An invalid group id was specified
 * @HttpResponse                401                 You do not have access to restore this group
 * @HttpResponse                404                 The group did not exist
 */
OAE.tenantRouter.on('post', '/api/group/:groupId/restore', (request, response) => {
  PrincipalsAPI.restoreGroup(request.ctx, request.params.groupId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST getGroupGroupId
 *
 * Get a full group profile
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /group/{groupId}
 * @PathParam   {string}        groupId             The id of the group to get
 * @HttpResponse                200                 Group profile available
 * @HttpResponse                401                 You do not have access to this group
 * @HttpResponse                404                 The specified group could not be found
 */
OAE.tenantRouter.on('get', '/api/group/:groupId', (request, response) => {
  PrincipalsAPI.getFullGroupProfile(request.ctx, request.params.groupId, (error, group) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(group);
  });
});

/**
 * @REST postGroupGroupId
 *
 * Update a group
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /group/{groupId}
 * @PathParam   {string}        groupId             The id of the group to update
 * @FormParam   {string}        [description]       Updated description for the group
 * @FormParam   {string}        [displayName]       Updated display name for the group
 * @FormParam   {string}        [joinable]          Updated joinability for the group            [no,request,yes]
 * @FormParam   {string}        [visibility]        Updated visibility for the group             [loggedin,private,public]
 * @Return      {BasicGroup}                        The updated group
 * @HttpResponse                200                 Group updated
 * @HttpResponse                400                 A display name cannot be empty
 * @HttpResponse                400                 A display name can be at most 1000 characters long
 * @HttpResponse                400                 A description can only be 10000 characters long
 * @HttpResponse                400                 A valid group id must be provided
 * @HttpResponse                400                 Invalid joinable setting was provided
 * @HttpResponse                400                 Invalid visibility setting was provided
 * @HttpResponse                400                 You should specify at least one known field
 * @HttpResponse                401                 You are not authorized to update this group
 * @HttpResponse                404                 The specified group could not be found
 */
OAE.tenantRouter.on('post', '/api/group/:groupId', (request, response) => {
  // Get the fields we wish to update.
  PrincipalsAPI.updateGroup(request.ctx, request.params.groupId, request.body, (error, updatedGroup) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).send(updatedGroup);
  });
});

/**
 * @REST getGroupGroupIdMembers
 *
 * Get the members library of a group and their roles
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /group/{groupId}/members
 * @PathParam   {string}            groupId             The id of the group to get the members for
 * @QueryParam  {number}            [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}            [start]             The group paging token from which to start fetching group members
 * @Return      {MembersResponse}                       Members of the specified group
 * @HttpResponse                    200                 Members available
 * @HttpResponse                    400                 An invalid group id was specified
 * @HttpResponse                    401                 Insufficient privilege to view this group's members list
 * @HttpResponse                    404                 The specified group could not be found
 */
OAE.tenantRouter.on('get', '/api/group/:groupId/members', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 10, 1, 25);
  PrincipalsAPI.getMembersLibrary(
    request.ctx,
    request.params.groupId,
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
 * @REST postGroupGroupIdMembers
 *
 * Update the members of a group
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /group/{groupId}/members
 * @PathParam   {string}                groupId         The id of the group to update the members for
 * @BodyParam   {GroupMembersUpdate}    body            Object that describes the membership updates to apply to the group
 * @Return      {void}
 * @HttpResponse                        200             Members updated
 * @HttpResponse                        400             An invalid role has been passed in
 * @HttpResponse                        400             At least one role change needs to be applied
 * @HttpResponse                        400             Invalid groupId specified
 * @HttpResponse                        400             Invalid principal specified as member for this group.
 * @HttpResponse                        400             One or more target members being granted access do not exist
 * @HttpResponse                        400             The requested operation would leave the group without a manager
 * @HttpResponse                        400             You cannot make the group a member of itself
 * @HttpResponse                        400             You should specify at least 1 user/group on which to update group membership
 * @HttpResponse                        401             You are not authorized to make a set of principals a member of the group
 * @HttpResponse                        401             You are not authorized to update the members of this group
 * @HttpResponse                        404             The specified group could not be found
 */
OAE.tenantRouter.on('post', '/api/group/:groupId/members', (request, response) => {
  // Convert the string 'false' to a proper boolean
  const members = request.body;
  const principals = _.keys(members);
  for (const element of principals) {
    if (members[element] === 'false') {
      members[element] = false;
    }
  }

  PrincipalsAPI.setGroupMembers(request.ctx, request.params.groupId, members, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
});

/**
 * @REST getGroupGroupIdInvitations
 *
 * Get all the invitations associated to a group
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /group/{groupId}/invitations
 * @PathParam   {string}                groupId             The id of the group for which to get invitations
 * @Return      {InvitationsResponse}                       The invitations associated to the group
 * @HttpResponse                        200                 Invitations available
 * @HttpResponse                        400                 A valid group id must be provided
 * @HttpResponse                        401                 You are not allowed to get invitations for this group
 * @HttpResponse                        404                 Group not available
 */
OAE.tenantRouter.on('get', '/api/group/:groupId/invitations', (request, response) => {
  PrincipalsAPI.getGroupInvitations(request.ctx, request.params.groupId, (error, invitations) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send({ results: invitations });
  });
});

/**
 * @REST postGroupGroupIdInvitationsEmailResend
 *
 * Resend an invitation to a group
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /group/{groupId}/invitations/{email}/resend
 * @PathParam   {string}                groupId             The id of the group for which to get invitations
 * @PathParam   {string}                email               The email for which to resend the invitation
 * @Return      {void}
 * @HttpResponse                        200                 Invitation was resent
 * @HttpResponse                        400                 A valid group id must be provided
 * @HttpResponse                        400                 A valid email must be provided
 * @HttpResponse                        401                 You are not allowed to resend invitations for this group
 * @HttpResponse                        404                 Group not available
 * @HttpResponse                        404                 No invitation for the specified email exists for the group
 */
OAE.tenantRouter.on('post', '/api/group/:groupId/invitations/:email/resend', (request, response) => {
  PrincipalsAPI.resendGroupInvitation(request.ctx, request.params.groupId, request.params.email, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST postGroupGroupIdJoin
 *
 * Join a group
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /group/{groupId}/join
 * @PathParam   {string}        groupId                 The id of the group to join
 * @Return      {void}
 * @HttpResponse                200                     Group joined
 * @HttpResponse                400                     Invalid groupId specified
 * @HttpResponse                400                     You are already a member of this group
 * @HttpResponse                401                     You cannot join this group
 * @HttpResponse                401                     You have to be logged in to be able to join a group
 */
OAE.tenantRouter.on('post', '/api/group/:groupId/join', (request, response) => {
  PrincipalsAPI.joinGroup(request.ctx, request.params.groupId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
});

/**
 * @REST postGroupGroupIdLeave
 *
 * Leave a group
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /group/{groupId}/leave
 * @PathParam   {string}        groupId                 The id of the group to leave
 * @Return      {void}
 * @HttpResponse                200                     Group left
 * @HttpResponse                400                     Cannot leave a group of which you aren't a member
 * @HttpResponse                400                     Invalid groupId specified
 * @HttpResponse                400                     The requested operation would leave the group without a manager
 * @HttpResponse                401                     You have to be logged in to be able to leave a group
 */
OAE.tenantRouter.on('post', '/api/group/:groupId/leave', (request, response) => {
  PrincipalsAPI.leaveGroup(request.ctx, request.params.groupId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
});

/**
 * @REST postGroupGroupIdPicture
 *
 * Store the large picture for a group
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /group/{groupId}/picture
 * @PathParam   {string}        groupId                 The id of the group to store the large picture for
 * @FormParam   {File}          file                    Image that should be stored as the large group picture
 * @Return      {BasicGroup}                            The updated group
 * @HttpResponse                200                     Picture updated
 * @HttpResponse                400                     A file must be provided
 * @HttpResponse                400                     A valid group id must be provided
 * @HttpResponse                400                     Only images are accepted files
 * @HttpResponse                400                     The size of a picture has an upper limit of 10MB
 * @HttpResponse                401                     You have to be a group manager to update its picture
 */
OAE.tenantRouter.on('post', '/api/group/:groupId/picture', (request, response) => {
  request.files = request.files || {};
  PrincipalsAPI.storePicture(request.ctx, request.params.groupId, request.files.file, (error, principal) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    // Set the response type to text/plain, as the UI uses an iFrame upload mechanism to support IE9
    // file uploads. If the response type is not set to text/plain, IE9 will try to download the response.
    response.set('Content-Type', 'text/plain');
    response.status(200).send(principal);
  });
});

/**
 * @REST postGroupGroupIdRequestJoinCreate
 *
 * Create a request
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /group/{groupId}/join-request
 * @PathParam   {string}        groupId                 The group id that the user requested to join
 * @Return      {void}
 * @HttpResponse                200                     Request created
 * @HttpResponse                400                     Invalid groupId specified
 * @HttpResponse                401                     You have to be logged in to be able to create a request to join a group
 */
OAE.tenantRouter.on('post', '/api/group/:groupId/join-request', (request, response) => {
  PrincipalsAPI.createRequestJoinGroup(request.ctx, request.params.groupId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST getGroupGroupIdRequestJoin
 *
 * Get a request
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /group/{groupId}/join-request/mine
 * @PathParam   {string}        groupId                 The group id that the user requested to join
 * @Return      {Object}        request                 A request
 * @HttpResponse                200                     Request returned
 * @HttpResponse                400                     Invalid groupId specified
 * @HttpResponse                401                     You have to be logged in to be able to create a request to join a group
 */
OAE.tenantRouter.on('get', '/api/group/:groupId/join-request/mine', (request, response) => {
  PrincipalsAPI.getJoinGroupRequest(request.ctx, request.params.groupId, (error, request) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(request);
  });
});

/**
 * @REST getGroupGroupIdRequestJoinAll
 *
 * Get requests
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /group/{groupId}/join-request/all
 * @PathParam   {string}        groupId                 The group id that the user requested to join
 * @Return      {Object[]}      requests                List of requests for a group
 * @HttpResponse                200                     List returned
 * @HttpResponse                400                     Invalid groupId specified
 * @HttpResponse                401                     You have to be logged in to be able to create a request to join a group
 */
OAE.tenantRouter.on('get', '/api/group/:groupId/join-request/all', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 10, 1, 25);

  PrincipalsAPI.getJoinGroupRequests(
    request.ctx,
    {
      groupId: request.params.groupId,
      start: request.query.start,
      limit
    },
    (error, requests, nextToken) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).send({ results: requests, nextToken });
    }
  );
});

/**
 * @REST putGroupGroupIdRequestJoin
 *
 * Update a request
 *
 * @Server      tenant
 * @Method      PUT
 * @Path        /group/{groupId}/join-request
 * @PathParam   {string}        groupId                 The group id that the user requested to join
 * @Return      {void}
 * @HttpResponse                200                     Request accepted
 * @HttpResponse                400                     Invalid groupId specified
 * @HttpResponse                400                     Invalid role specified
 * @HttpResponse                400                     Invalid status specified
 * @HttpResponse                401                     You have to be logged in to be able to leave a group
 */
OAE.tenantRouter.on('put', '/api/group/:groupId/join-request', (request, response) => {
  PrincipalsAPI.updateJoinGroupByRequest(
    request.ctx,
    {
      groupId: request.params.groupId,
      principalId: request.body.principalId,
      role: request.body.role,
      status: request.body.status
    },
    (error) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).end();
    }
  );
});
