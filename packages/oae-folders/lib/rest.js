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

import { AuthzConstants } from 'oae-authz/lib/constants.js';
import * as OAE from 'oae-util/lib/oae.js';
import * as OaeUtil from 'oae-util/lib/util.js';

import * as FoldersAPI from 'oae-folders';

/**
 * @REST postFolder
 *
 * Create a new folder
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /folder
 * @FormParam   {string}            displayName         The display name of the folder
 * @FormParam   {string}            [description]       A longer description for the folder
 * @FormParam   {string}            [visibility]        The visibility of the folder. Defaults to the configured tenant default     [loggedin,private,public]
 * @FormParam   {string[]}          [managers]          Unique identifier(s) for users and groups to add as managers of the folder. The user creating the folder will be added as a manager automatically
 * @FormParam   {string[]}          [viewers]           Unique identifier(s) for users and groups to add as viewers of the folder
 * @Return      {BasicFolder}                           The created folder
 * @HttpResponse                    201                 The folder was created
 * @HttpResponse                    400                 A display name must be provided and can be at most 1000 characters long
 * @HttpResponse                    400                 A description can be at most 10000 characters long
 * @HttpResponse                    400                 An invalid visibility was provided
 * @HttpResponse                    400                 One or more of the members you're trying to add can not be added due to tenant/visibility boundaries
 * @HttpResponse                    401                 Anonymous users cannot create folders
 */
OAE.tenantRouter.on('post', '/api/folder', (request, response) => {
  const managerIds = OaeUtil.toArray(request.body.managers);
  const viewerIds = OaeUtil.toArray(request.body.viewers);

  // Hold the user roles to initialize the folder with
  const roles = {};

  // Apply the manager roles
  _.each(managerIds, (managerId) => {
    roles[managerId] = AuthzConstants.role.MANAGER;
  });

  // Apply the viewer roles
  _.each(viewerIds, (viewerId) => {
    roles[viewerId] = AuthzConstants.role.VIEWER;
  });

  FoldersAPI.createFolder(
    request.ctx,
    request.body.displayName,
    request.body.description,
    request.body.visibility,
    roles,
    (error, folder) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(201).send(folder);
    }
  );
});

/**
 * @REST getFolderManaged
 *
 * Get the folders the current user manages
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /folder/managed
 * @Return      {FoldersLibrary}                The folders the current user manages
 * @HttpResponse                    200         The folders the current user manages are returned
 * @HttpResponse                    401         Anonymous users don't manage any folders
 */
OAE.tenantRouter.on('get', '/api/folder/managed', (request, response) => {
  FoldersAPI.getManagedFolders(request.ctx, (error, results, nextToken) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send({ results, nextToken });
  });
});

/**
 * @REST getFolderFolderId
 *
 * Get a full folder profile
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /folder/{folderId}
 * @PathParam   {string}            folderId            The id of the folder to get
 * @Return      {Folder}                                Full folder profile
 * @HttpResponse                    200                 The full folder profile is returned
 * @HttpResponse                    400                 An invalid folder id was provided
 * @HttpResponse                    401                 You're not allowed to access this folder
 */
OAE.tenantRouter.on('get', '/api/folder/:folderId', (request, response) => {
  FoldersAPI.getFullFolderProfile(request.ctx, request.params.folderId, (error, folder) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(folder);
  });
});

/**
 * @REST postFolderFolderId
 *
 * Update a folder
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /folder/{folderId}
 * @PathParam   {string}            folderId            The id of the folder to update
 * @FormParam   {string}            [description]       Updated description for the folder
 * @FormParam   {string}            [displayName]       Updated display name for the folder
 * @FormParam   {string}            [visibility]        Updated visibility for the folder           [loggedin,private,public]
 * @Return      {Folder}                                Full folder profile
 * @HttpResponse                    200                 The folder is updated and its full profile is returned
 * @HttpResponse                    400                 An invalid folder id was provided
 * @HttpResponse                    400                 An invalid display name was provided
 * @HttpResponse                    400                 An invalid description was provided
 * @HttpResponse                    400                 An invalid visibility was provided
 * @HttpResponse                    401                 You're not allowed to update this folder
 */
OAE.tenantRouter.on('post', '/api/folder/:folderId', (request, response) => {
  FoldersAPI.updateFolder(request.ctx, request.params.folderId, request.body, (error, updatedFolder) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(updatedFolder);
  });
});

/**
 * @REST postFolderFolderIdContentVisibility
 *
 * Update the visibility of the content items in a folder
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /folder/{folderId}
 * @PathParam   {string}            folderId            The id of the folder to update
 * @FormParam   {string}            visibility          Updated visibility for the content items in the folder           [loggedin,private,public]
 * @Return      {FolderContentVisibilityUpdate}         The content items for which the visibility could not be updated
 * @HttpResponse                    200                 The operation has completed. A set of content items that could not be updated are provided
 * @HttpResponse                    400                 An invalid folder id was provided
 * @HttpResponse                    400                 An invalid visibility was provided
 * @HttpResponse                    401                 You're not allowed to update this folder
 */
OAE.tenantRouter.on('post', '/api/folder/:folderId/contentvisibility', (request, response) => {
  FoldersAPI.updateFolderContentVisibility(
    request.ctx,
    request.params.folderId,
    request.body.visibility,
    (error, failedContent) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      const data = { failedContent };
      return response.status(200).send(data);
    }
  );
});

/**
 * @REST deleteFolderFolderId
 *
 * Delete a folder
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /folder/{folderId}
 * @PathParam   {string}            folderId            The id of the folder to delete
 * @FormParam   {string}            deleteContent       Whether the content items in the folder should be deleted
 * @Return      {FolderContentDelete}                   The content items that could not be deleted
 * @HttpResponse                    200                 The folder has been deleted
 * @HttpResponse                    400                 An invalid folder id has been specified
 * @HttpResponse                    401                 You're not allowed to delete this folder
 * @HttpResponse                    404                 The folder did not exist
 */
OAE.tenantRouter.on('delete', '/api/folder/:folderId', (request, response) => {
  const deleteContent = OaeUtil.castToBoolean(request.body.deleteContent);
  FoldersAPI.deleteFolder(request.ctx, request.params.folderId, deleteContent, (error, failedContent) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    const data = { failedContent };
    return response.status(200).send(data);
  });
});

/**
 * @REST postFolderFolderIdShare
 *
 * Share a folder
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /folder/{folderId}/share
 * @PathParam   {string}            folderId            The id of the folder to share
 * @FormParam   {string[]}          members             Unique identifier(s) for users and groups to share the folder with
 * @Return      {void}
 * @HttpResponse                    200                 The folder has been shared
 * @HttpResponse                    400                 An invalid folder id has been specified
 * @HttpResponse                    400                 An invalid set of principals has been provided
 * @HttpResponse                    401                 You're not allowed to share this folder
 */
OAE.tenantRouter.on('post', '/api/folder/:folderId/share', (request, response) => {
  const viewers = OaeUtil.toArray(request.body.viewers);
  FoldersAPI.shareFolder(request.ctx, request.params.folderId, viewers, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST postFolderFolderIdMembers
 *
 * Update the members of a folder
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /folder/{folderId}/members
 * @PathParam   {string}                    folderId            The id of the folder to update the members for
 * @BodyParam   {FolderMembersUpdate}       body                Object that describes the membership updates to apply to the folder
 * @Return      {void}
 * @HttpResponse                            200                 The members of the folder have been updated
 * @HttpResponse                            400                 An invalid folder id has been specified
 * @HttpResponse                            400                 Invalid role updates have been provided
 * @HttpResponse                            401                 You're not allowed to update the permissions for this folder
 */
OAE.tenantRouter.on('post', '/api/folder/:folderId/members', (request, response) => {
  // Parse the incoming false values
  const permissionUpdates = {};
  _.each(request.body, (value, key) => {
    permissionUpdates[key] = OaeUtil.castToBoolean(value);
  });

  FoldersAPI.setFolderPermissions(request.ctx, request.params.folderId, permissionUpdates, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST getFolderFolderIdMembers
 *
 * Get the members of a folder and their roles
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /folder/{folderId}/members
 * @PathParam   {string}                folderId            The id of the folder to get the members for
 * @QueryParam  {number}                [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}                [start]             The folder paging token from which to start fetching folder members
 * @Return      {MembersResponse}                           Members of the specified folder
 * @HttpResponse                    200                     The members of this folder are returned
 * @HttpResponse                    400                     An invalid folder id has been specified
 * @HttpResponse                    401                     You're not allowed to list the members of this folder
 */
OAE.tenantRouter.on('get', '/api/folder/:folderId/members', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 10, 1, 25);
  FoldersAPI.getFolderMembers(
    request.ctx,
    request.params.folderId,
    request.query.start,
    limit,
    (error, members, nextToken) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).send({ results: members, nextToken });
    }
  );
});

/**
 * @REST getFolderFolderIdInvitations
 *
 * Get all the invitations associated to a folder
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /folder/{folderId}/invitations
 * @PathParam   {string}                folderId            The id of the folder for which to get invitations
 * @Return      {InvitationsResponse}                       The invitations associated to the folder
 * @HttpResponse                        200                 Invitations available
 * @HttpResponse                        400                 A valid folder id must be provided
 * @HttpResponse                        401                 You are not allowed to get invitations for this folder
 * @HttpResponse                        404                 Folder not available
 */
OAE.tenantRouter.on('get', '/api/folder/:folderId/invitations', (request, response) => {
  FoldersAPI.getFolderInvitations(request.ctx, request.params.folderId, (error, invitations) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send({ results: invitations });
  });
});

/**
 * @REST postFolderFolderIdInvitationsEmailResend
 *
 * Resend an invitation to a folder
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /folder/{folderId}/invitations/{email}/resend
 * @PathParam   {string}                folderId            The id of the folder for which to get invitations
 * @PathParam   {string}                email               The email for which to resend the invitation
 * @Return      {void}
 * @HttpResponse                        200                 Invitation was resent
 * @HttpResponse                        400                 A valid folder id must be provided
 * @HttpResponse                        400                 A valid email must be provided
 * @HttpResponse                        401                 You are not allowed to resend invitations for this folder
 * @HttpResponse                        404                 Folder not available
 * @HttpResponse                        404                 No invitation for the specified email exists for the folder
 */
OAE.tenantRouter.on('post', '/api/folder/:folderId/invitations/:email/resend', (request, response) => {
  FoldersAPI.resendFolderInvitation(request.ctx, request.params.folderId, request.params.email, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST getFolderLibraryPrincipalId
 *
 * Get the folder library items for a user or group
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /folder/library/{principalId}
 * @PathParam   {string}                principalId         The id of the principal for which to retrieve the folders
 * @QueryParam  {number}                [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}                [start]             The folder paging token from which to start fetching folders
 * @Return      {FoldersLibrary}                            The folder library items for the specified user or group
 * @HttpResponse                        200                 The library of folders for the given principal is returned
 * @HttpResponse                        400                 An invalid principal id has been specified
 * @HttpResponse                        401                 You're not allowed to list this folder library
 */
OAE.tenantRouter.on('get', '/api/folder/library/:principalId', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 12, 1, 25);
  FoldersAPI.getFoldersLibrary(
    request.ctx,
    request.params.principalId,
    request.query.start,
    limit,
    (error, results, nextToken) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).send({ results, nextToken });
    }
  );
});

/**
 * @REST deleteFolderLibraryPrincipalIdLibraryId
 *
 * Remove a folder from a folder library
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /folder/library/{principalId}/{folderId}
 * @PathParam   {string}            principalId             The id of the principal from whose folder library to remove the folder
 * @PathParam   {string}            folderId                The id of the folder to remove from the library
 * @Return      {void}
 * @HttpResponse                    200                     The folder has been removed from the principal's folder library
 * @HttpResponse                    400                     An invalid principal id has been specified
 * @HttpResponse                    400                     An invalid folder id has been specified
 * @HttpResponse                    401                     You're not allowed to delete this folder from the principal's library
 */
OAE.tenantRouter.on('delete', '/api/folder/library/:principalId/:folderId', (request, response) => {
  FoldersAPI.removeFolderFromLibrary(request.ctx, request.params.principalId, request.params.folderId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST postFolderFolderIdLibrary
 *
 * Add content items to a folder
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /folder/{folderId}/library
 * @PathParam   {string}                    folderId            The id of the folder to add content items to
 * @FormParam   {string[]}                  contentIds          The ids of the content items that should be added to the folder
 * @Return      {void}
 * @HttpResponse                            200                 The content items have been added to the folder
 * @HttpResponse                            400                 An invalid folder id has been specified
 * @HttpResponse                            400                 One or more invalid content ids have been specified
 * @HttpResponse                            400                 You do not have access to one or more of the specified content items
 * @HttpResponse                            401                 You're not allowed to add content items to this folder
 * @HttpResponse                            404                 The folder or one or more content items do not exist
 */
OAE.tenantRouter.on('post', '/api/folder/:folderId/library', (request, response) => {
  const contentIds = OaeUtil.toArray(request.body.contentIds);
  FoldersAPI.addContentItemsToFolder(request.ctx, request.params.folderId, contentIds, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST deleteFolderFolderIdLibrary
 *
 * Remove content items from a folder
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /folder/{folderId}/library
 * @PathParam   {string}                    folderId            The id of the folder to remove content items from
 * @BodyParam   {string[]}                  contentIds          The ids of the content items that should be removed from the folder
 * @Return      {void}
 * @HttpResponse                            200                 The content items have been removed from the folder
 * @HttpResponse                            400                 An invalid folder id has been specified
 * @HttpResponse                            400                 One or more invalid content ids have been specified
 * @HttpResponse                            401                 You're not allowed to remove content items from this folder
 * @HttpResponse                            404                 The folder or one or more content items do not exist
 */
OAE.tenantRouter.on('delete', '/api/folder/:folderId/library', (request, response) => {
  const contentIds = OaeUtil.toArray(request.body.contentIds);
  FoldersAPI.removeContentItemsFromFolder(request.ctx, request.params.folderId, contentIds, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST getFolderFolderIdLibrary
 *
 * Get the content items in a folder
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /folder/{folderId}/library
 * @PathParam   {string}                folderId            The id of the folder for which to retrieve the content library
 * @QueryParam  {number}                [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}                [start]             The folder paging token from which to start fetching content items
 * @Return      {ContentLibrary}                            The content items in the folder
 * @HttpResponse                        200                 The content items in the folder
 * @HttpResponse                        400                 An invalid folder id has been specified
 * @HttpResponse                        400                 You do not have access to one or more of the specified content items
 * @HttpResponse                        401                 You're not allowed to list the content items in this folder
 */
OAE.tenantRouter.on('get', '/api/folder/:folderId/library', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 12, 1, 25);
  FoldersAPI.getFolderContentLibrary(
    request.ctx,
    request.params.folderId,
    request.query.start,
    limit,
    (error, results, nextToken) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).send({ results, nextToken });
    }
  );
});

/**
 * @REST getFolderFolderIdMessages
 *
 * Get the messages for a folder
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /folder/{folderId}/messages
 * @PathParam   {string}                folderId            The id of the folder for which to get the messages
 * @QueryParam  {number}                [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}                [start]             The messages paging token from which to start fetching messages
 * @Return      {MessagesResponse}                          The messages in the folder
 * @HttpResponse                        200                 Folder messages available
 * @HttpResponse                        400                 A messageBoxId must be specified
 * @HttpResponse                        400                 Must provide a valid folder id
 * @HttpResponse                        401                 You are not authorized to view this folder
 * @HttpResponse                        404                 Could not find the specified folder
 */
OAE.tenantRouter.on('get', '/api/folder/:folderId/messages', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 10, 1, 25);
  FoldersAPI.getMessages(
    request.ctx,
    request.params.folderId,
    request.query.start,
    limit,
    (error, messages, nextToken) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).send({ results: messages, nextToken });
    }
  );
});

/**
 * @REST postFolderFolderIdMessages
 *
 * Create a new message in a folder
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /folder/{folderId}/messages
 * @PathParam   {string}        folderId            The id of the folder to which to post the message
 * @FormParam   {string}        body                The body of the message
 * @FormParam   {number}        [replyTo]           The timestamp of the message to which this message is a reply. Not specifying this will create a top level message
 * @Return      {Message}                           The created message
 * @HttpResponse                200                 Folder message created
 * @HttpResponse                400                 A folder message can only be 100000 characters long
 * @HttpResponse                400                 A folder message must be provided
 * @HttpResponse                400                 A messageBoxId must be specified
 * @HttpResponse                400                 If the replyToCreated optional parameter is specified, it should point to an existing reply
 * @HttpResponse                400                 Invalid folder id provided
 * @HttpResponse                400                 The body of the message must be specified
 * @HttpResponse                401                 You are not authorized to post messages to this folder
 * @HttpResponse                404                 Could not find the specified folder
 */
OAE.tenantRouter.on('post', '/api/folder/:folderId/messages', (request, response) => {
  FoldersAPI.createMessage(
    request.ctx,
    request.params.folderId,
    request.body.body,
    request.body.replyTo,
    (error, message) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).send(message);
    }
  );
});

/**
 * @REST deleteFolderFolderIdMessagesCreated
 *
 * Delete a message in a folder
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /folder/{folderId}/messages/{created}
 * @PathParam   {string}                folderId            The id of the folder from which to delete the message
 * @PathParam   {number}                created             The timestamp of the message that should be deleted
 * @Return      {Message}                                   When the message has been soft deleted (because it has replies), a stripped down message object representing the deleted message will be returned, with the `deleted` parameter set to `false`. If the message has been removed entirely, no message object will be returned
 * @HttpResponse                        200                 Folder message deleted
 * @HttpResponse                        400                 A folder id must be provided
 * @HttpResponse                        400                 A messageBoxId must be specified
 * @HttpResponse                        400                 A valid integer message created timestamp must be specified
 * @HttpResponse                        400                 The createdTimestamp should point to an existing message
 * @HttpResponse                        401                 You are not authorized to delete this message
 * @HttpResponse                        404                 Could not find the specified folder
 * @HttpResponse                        404                 Could not find the specified message
 */
OAE.tenantRouter.on('delete', '/api/folder/:folderId/messages/:created', (request, response) => {
  FoldersAPI.deleteMessage(request.ctx, request.params.folderId, request.params.created, (error, message) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(message);
  });
});
