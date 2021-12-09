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

import * as querystring from 'node:querystring';
import {
  isResourceACollabDoc,
  isResourceACollabSheet,
  isResourceAFile,
  isResourceALink
} from 'oae-content/lib/backends/util.js';

import _ from 'underscore';

import { AuthzConstants } from 'oae-authz/lib/constants.js';
import * as OAE from 'oae-util/lib/oae.js';
import * as OaeUtil from 'oae-util/lib/util.js';

import * as ContentAPI from './api.js';
import { ContentConstants } from './constants.js';

/**
 * Verify the signature information provided by a signed download request and
 * pass it on to the download handler to complete the download request
 *
 * @param  {Request}     req    The Express Request object
 * @param  {Response}    res    The Express Response object
 * @api private
 */
const _handleSignedDownload = function (request, response) {
  ContentAPI.verifySignedDownloadQueryString(request.ctx, request.query, (error, downloadInfo) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return _handleDownload(response, downloadInfo, true);
  });
};

/**
 * @REST postContentCreateCollabdoc
 *
 * Create a new collaborative document
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /content/create
 * @FormParam   {string}            displayName         The display name of the collaborative document
 * @FormParam   {string}            resourceSubType     The content item type                                                                       [collabdoc]
 * @FormParam   {string}            [description]       A longer description for the collaborative document
 * @FormParam   {string[]}          [managers]          Unique identifier(s) for users and groups to add as managers of the collaborative document. The user creating the collaborative document will be added as a manager automatically
 * @FormParam   {string[]}          [editors]           Unique identifier(s) for users and groups to add as editors of the collaborative document
 * @FormParam   {string[]}          [viewers]           Unique identifier(s) for users and groups to add as members of the collaborative document
 * @FormParam   {string[]}          [folders]           Unique identifier(s) for folders to which the collaborative document should be added
 * @FormParam   {string}            [visibility]        The visibility of the collaborative document. Defaults to the configured tenant default     [loggedin,private,public]
 * @Return      {BasicContent}                          The created collaborative document
 * @HttpResponse                    201                 Document created
 * @HttpResponse                    400                 A display name must be provided
 * @HttpResponse                    400                 A display name can be at most 1000 characters long
 * @HttpResponse                    400                 A description can only be 10000 characters long
 * @HttpResponse                    400                 A valid resourceSubType must be provided. This can be "file", "collabdoc" or "link"
 * @HttpResponse                    400                 An invalid content visibility option has been provided. This can be "private", "loggedin" or "public"
 * @HttpResponse                    400                 One or more target members being granted access are not authorized to become members on this content item
 * @HttpResponse                    400                 One or more target members being granted access do not exist
 * @HttpResponse                    400                 The additional members should be specified as an object
 * @HttpResponse                    401                 You have to be logged in to be able to create a content item
 */

/**
 * @REST postContentCreateCollabsheet
 *
 * Create a new collaborative spreadsheet
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /content/create
 * @FormParam   {string}            displayName         The display name of the collaborative spreadsheet
 * @FormParam   {string}            resourceSubType     The content item type                                                                       [spreadsheet]
 * @FormParam   {string}            [description]       A longer description for the collaborative spreadsheet
 * @FormParam   {string[]}          [managers]          Unique identifier(s) for users and groups to add as managers of the collaborative spreadsheet. The user creating the collaborative document will be added as a manager automatically
 * @FormParam   {string[]}          [editors]           Unique identifier(s) for users and groups to add as editors of the collaborative spreadsheet
 * @FormParam   {string[]}          [viewers]           Unique identifier(s) for users and groups to add as members of the collaborative spreadsheet
 * @FormParam   {string[]}          [folders]           Unique identifier(s) for folders to which the collaborative spreadsheet should be added
 * @FormParam   {string}            [visibility]        The visibility of the collaborative spreadsheet. Defaults to the configured tenant default     [loggedin,private,public]
 * @Return      {BasicContent}                          The created collaborative spreadsheet
 * @HttpResponse                    201                 Spreadsheet created
 * @HttpResponse                    400                 A display name must be provided
 * @HttpResponse                    400                 A display name can be at most 1000 characters long
 * @HttpResponse                    400                 A description can only be 10000 characters long
 * @HttpResponse                    400                 A valid resourceSubType must be provided. This can be "file", "collabdoc", "collabsheet" or "link"
 * @HttpResponse                    400                 An invalid content visibility option has been provided. This can be "private", "loggedin" or "public"
 * @HttpResponse                    400                 One or more target members being granted access are not authorized to become members on this content item
 * @HttpResponse                    400                 One or more target members being granted access do not exist
 * @HttpResponse                    400                 The additional members should be specified as an object
 * @HttpResponse                    401                 You have to be logged in to be able to create a content item
 */

/**
 * @REST postContentCreateFile
 *
 * Create new file
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /content/create
 * @FormParam   {string}            displayName         The display name of the file
 * @FormParam   {File}              file                The binary content for the file
 * @FormParam   {string}            resourceSubType     The content item type                                                                [file]
 * @FormParam   {string}            [description]       A longer description for the file
 * @FormParam   {string[]}          [managers]          Unique identifier(s) for users and groups to add as managers of the file. The user creating the file will be added as a manager automatically
 * @FormParam   {string[]}          [viewers]           Unique identifier(s) for users and groups to add as members of the file
 * @FormParam   {string[]}          [folders]           Unique identifier(s) for folders to which the file should be added
 * @FormParam   {string}            [visibility]        The visibility of the file. Defaults to the configured tenant default               [loggedin,private,public]
 * @Return      {BasicContent}                          The created file
 * @HttpResponse                    201                 File uploaded
 * @HttpResponse                    400                 A display name must be provided
 * @HttpResponse                    400                 A display name can be at most 1000 characters long
 * @HttpResponse                    400                 A description can only be 10000 characters long
 * @HttpResponse                    400                 A valid resourceSubType must be provided. This can be "file", "collabdoc", "collabsheet" or "link"
 * @HttpResponse                    400                 An invalid content visibility option has been provided. This can be "private", "loggedin" or "public"
 * @HttpResponse                    400                 One or more target members being granted access are not authorized to become members on this content item
 * @HttpResponse                    400                 One or more target members being granted access do not exist
 * @HttpResponse                    400                 The additional members should be specified as an object
 * @HttpResponse                    401                 Anonymous users are not allowed to upload files
 * @HttpResponse                    401                 You have to be logged in to be able to create a content item
 */

/**
 * @REST postContentCreateLink
 *
 * Create new link
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /content/create
 * @FormParam   {string}            displayName         The display name of the link
 * @FormParam   {string}            link                The URL to which the link points
 * @FormParam   {string}            resourceSubType     The content item type                                                                       [link]
 * @FormParam   {string}            [description]       A longer description for the link
 * @FormParam   {string[]}          [managers]          Unique identifier(s) for users and groups to add as managers of the link. The user creating the link will be added as a manager automatically
 * @FormParam   {string[]}          [viewers]           Unique identifier(s) for users and groups to add as members of the link
 * @FormParam   {string[]}          [folders]           Unique identifier(s) for folders to which the link should be added
 * @FormParam   {string}            [visibility]        The visibility of the link. Defaults to the configured tenant default                       [loggedin,private,public]
 * @Return      {BasicContent}                          The created link
 * @HttpResponse                    201                 Link created
 * @HttpResponse                    400                 A display name must be provided
 * @HttpResponse                    400                 A display name can be at most 1000 characters long
 * @HttpResponse                    400                 A description can only be 10000 characters long
 * @HttpResponse                    400                 A valid link must be provided
 * @HttpResponse                    400                 A valid resourceSubType must be provided. This can be "file", "collabdoc", "collabsheet" or "link"
 * @HttpResponse                    400                 An invalid content visibility option has been provided. This can be "private", "loggedin" or "public"
 * @HttpResponse                    400                 One or more target members being granted access are not authorized to become members on this content item
 * @HttpResponse                    400                 One or more target members being granted access do not exist
 * @HttpResponse                    400                 The additional members should be specified as an object
 * @HttpResponse                    401                 You have to be logged in to be able to create a content item
 */
OAE.tenantRouter.on('post', '/api/content/create', (request, response) => {
  // Ensure proper arrays for the multi-value parameters
  request.body.managers = OaeUtil.toArray(request.body.managers);
  request.body.editors = OaeUtil.toArray(request.body.editors);
  request.body.viewers = OaeUtil.toArray(request.body.viewers);
  request.body.folders = OaeUtil.toArray(request.body.folders);

  // Construct a hash for additional members that maps each user to their role
  const additionalMembers = {};
  _.each(request.body.managers, (userId) => {
    additionalMembers[userId] = AuthzConstants.role.MANAGER;
  });
  _.each(request.body.editors, (userId) => {
    additionalMembers[userId] = AuthzConstants.role.EDITOR;
  });
  _.each(request.body.viewers, (userId) => {
    additionalMembers[userId] = AuthzConstants.role.VIEWER;
  });

  let uploadedFile = null;
  if (request.files && request.files.file) {
    uploadedFile = request.files.file;
  }

  _createContent(
    request.ctx,
    request.body.resourceSubType,
    request.body.displayName,
    request.body.description,
    request.body.visibility,
    request.body.link,
    uploadedFile,
    additionalMembers,
    request.body.folders,
    (error, contentObject) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      // Set the response type to text/plain for file uploads, as the UI uses an iFrame upload mechanism
      // to support IE9 file uploads. If the response type is not set to text/plain, IE9 will try to
      // download the response
      if (request.files && request.files.file) {
        response.set('Content-Type', 'text/plain');
      }

      return response.status(201).send(contentObject);
    }
  );
});

/**
 * Create a piece of content
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         resourceSubType         The type of content to create
 * @param  {String}         displayName             The display name of the content item
 * @param  {String}         [description]           A longer description for the content item
 * @param  {String}         [visibility]            The visibility of the content item. One of `public`, `loggedin`, `private`
 * @param  {String}         [link]                  The URL when creating a content item of resourceSubType `link`
 * @param  {File}           [uploadedFile]          The file object when creating a content item of resourceSubType `file`
 * @param  {String[]}       folders               The ids of folders where the content item should be added to
 * @param  {Object}         additionalMembers       Object where the keys represent principal ids that need to be added to the content upon creation and the values represent the role that principal will have. Possible values are "viewer" and "manager", as well as "editor" for collabdocs or collabsheets
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error object, if any
 * @param  {Content}        callback.content        The created content object
 * @api private
 */
const _createContent = function (
  ctx,
  resourceSubType,
  displayName,
  description,
  visibility,
  link,
  uploadedFile,
  additionalMembers,
  folders,
  callback
) {
  // Link creation
  if (isResourceALink(resourceSubType)) {
    return ContentAPI.createLink(
      ctx,
      {
        displayName,
        description,
        visibility,
        link,
        additionalMembers,
        folders
      },
      callback
    );

    // File creation
  }

  if (isResourceAFile(resourceSubType)) {
    return ContentAPI.createFile(
      ctx,
      { displayName, description, visibility, file: uploadedFile, additionalMembers, folders },
      callback
    );

    // Collaborative document creation
  }

  if (isResourceACollabDoc(resourceSubType)) {
    return ContentAPI.createCollabDoc(ctx, displayName, description, visibility, additionalMembers, folders, callback);

    // Not a recognized file type
  }

  // Collaborative spreadsheet creation
  if (isResourceACollabSheet(resourceSubType)) {
    return ContentAPI.createCollabSheet(
      ctx,
      displayName,
      description,
      visibility,
      additionalMembers,
      folders,
      callback
    );
  }

  return callback({
    code: 400,
    msg: 'Unrecognized resourceSubType. Accepted values are "link", "file", "collabdoc" and "collabsheet"'
  });
};

/**
 * @REST deleteContentContentId
 *
 * Delete a content item
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /content/{contentId}
 * @PathParam   {string}                contentId           The id of the content item to delete
 * @Return      {void}
 * @HttpResponse                        200                 Content deleted
 * @HttpResponse                        400                 A content id must be provided
 * @HttpResponse                        401                 You are not allowed to manage this piece of content
 * @HttpResponse                        401                 You have to be logged in to be able to delete a content item'
 */
OAE.tenantRouter.on('delete', '/api/content/:contentId', (request, response) => {
  ContentAPI.deleteContent(request.ctx, request.params.contentId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
});

/**
 * @REST getContentContentId
 *
 * Get a full content item profile
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /content/{contentId}
 * @PathParam   {string}                contentId           The id of the content item to get
 * @Return      {Content}                                   Full content profile
 * @HttpResponse                        200                 Content available
 * @HttpResponse                        400                 A content id must be provided
 */
OAE.tenantRouter.on('get', '/api/content/:contentId', (request, response) => {
  ContentAPI.getFullContentProfile(request.ctx, request.params.contentId, (error, contentProfile) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).send(contentProfile);
  });
});

/**
 * @REST postContentContentId
 *
 * Update a content item
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /content/{contentId}
 * @PathParam   {string}                contentId           The id of the content item to update
 * @FormParam   {string}                [description]       Updated description for the content item
 * @FormParam   {string}                [displayName]       Updated display name for the content item
 * @FormParam   {string}                [link]              Updated URL for a link
 * @FormParam   {string}                [visibility]        Updated visibility for the discussion           [loggedin,private,public]
 * @Return      {Content}                                   The updated content item
 * @HttpResponse                        200                 Content updated
 * @HttpResponse                        400                 ... is not a recognized content profile field
 * @HttpResponse                        400                 A content id must be provided
 * @HttpResponse                        400                 A display name cannot be empty
 * @HttpResponse                        400                 A display name can be at most 1000 characters long
 * @HttpResponse                        400                 A description can only be 10000 characters long
 * @HttpResponse                        400                 A valid link should be provided
 * @HttpResponse                        400                 An invalid content visibility option has been provided. This can be "private", "loggedin" or "public"
 * @HttpResponse                        400                 This piece of content is not a link
 * @HttpResponse                        400                 You should at least specify a new displayName, description, visibility or link
 * @HttpResponse                        401                 You are not allowed to manage this piece of content
 * @HttpResponse                        401                 You have to be logged in to be able to update a content item
 */
OAE.tenantRouter.on('post', '/api/content/:contentId', (request, response) => {
  ContentAPI.updateContentMetadata(request.ctx, request.params.contentId, request.body, (error, newContentObject) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).send(newContentObject);
  });
});

/**
 * @REST getContentContentIdDownload
 *
 * Download the latest revision of a file
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /content/{contentId}/download
 * @PathParam   {string}                contentId           The id of the file to download
 * @Return      {File}                                      The latest revision of the file
 * @HttpResponse                        200                 Content provided
 * @HttpResponse                        302                 Redirecting to content
 * @HttpResponse                        400                 A valid contentId must be provided
 * @HttpResponse                        400                 Only file content items can be downloaded
 * @HttpResponse                        404                 Content not available
 */
OAE.tenantRouter.on('get', '/api/content/:contentId/download', (request, response) => {
  ContentAPI.getRevisionDownloadInfo(request.ctx, request.params.contentId, null, (error, downloadInfo) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return _handleDownload(response, downloadInfo, false);
  });
});

/**
 * @REST getContentContentIdDownloadRevisionId
 *
 * Download a revision of a file
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /content/{contentId}/download/{revisionId}
 * @PathParam   {string}                contentId           The id of the file to download
 * @PathParam   {string}                revisionId          The id of the revision to download
 * @Return      {File}                                      The specified revision of the file
 * @HttpResponse                        200                 Content provided
 * @HttpResponse                        302                 Redirecting to content
 * @HttpResponse                        400                 A valid contentId must be provided
 * @HttpResponse                        400                 If provided, the revisionId must be valid and pointing to an existing revision
 * @HttpResponse                        400                 No revision id provided and content item does not have a latest revision id
 * @HttpResponse                        400                 Only file content items can be downloaded
 * @HttpResponse                        400                 The revision id provided is not associated with the specified content item
 * @HttpResponse                        404                 Content not available
 */
OAE.tenantRouter.on('get', '/api/content/:contentId/download/:revisionId', (request, response) => {
  ContentAPI.getRevisionDownloadInfo(
    request.ctx,
    request.params.contentId,
    request.params.revisionId,
    (error, downloadInfo) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return _handleDownload(response, downloadInfo, true);
    }
  );
});

/**
 * @REST postContentContentIdNewversion
 *
 * Upload a new version of a file
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /content/{contentId}/newversion
 * @PathParam   {string}            contentId               The id of the file to upload a new version for
 * @FormParam   {File}              file                    The new binary content for the file
 * @Return      {Content}                                   The updated content item
 * @HttpResponse                    200                     New version accepted
 * @HttpResponse                    400                     A content id must be provided
 * @HttpResponse                    400                     This content object is not a file
 * @HttpResponse                    401                     You are not allowed to manage this piece of content
 * @HttpResponse                    401                     You have to be logged in to be able to update a content item
 * @HttpResponse                    404                     Content not available
 */
OAE.tenantRouter.on('post', '/api/content/:contentId/newversion', (request, response) => {
  if (!request.files || !request.files.file) {
    return response.status(400).send('Missing file parameter');
  }

  ContentAPI.updateFileBody(
    request.ctx,
    request.params.contentId,
    request.files.file,
    (error, updatedContentObject) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      // Set the response type to text/plain, as the UI uses an iFrame upload mechanism to support IE9
      // file uploads. If the response type is not set to text/plain, IE9 will try to download the response.
      response.set('Content-Type', 'text/plain');
      response.status(200).send(updatedContentObject);
    }
  );
});

/**
 * @REST postContentContentIdJoin
 *
 * Join a collaborative document or spreadsheet
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /content/{contentId}/join
 * @PathParam   {string}            contentId               The id of the collaborative document to join
 * @Return      {CollabdocJoinInfo}                         Information on how to join the collaborative document
 * @HttpResponse                    200                     Joined collabdoc or spreadsheet
 * @HttpResponse                    400                     This is not a collaborative document or spreadsheet
 * @HttpResponse                    401                     You need to be a manager of this piece of content to be able to join it
 * @HttpResponse                    404                     Content not available
 */
OAE.tenantRouter.on('post', '/api/content/:contentId/join', (request, response) => {
  ContentAPI.joinCollabDoc(request.ctx, request.params.contentId, (error, data) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).send(data);
  });
});

/**
 * @REST postContentContentIdRevisionsRevisionIdPreviews
 *
 * Attach a preview item to a content item
 *
 * @Api         private
 * @Server      tenant
 * @Method      POST
 * @Path        /content/{contentId}/revisions/{revisionId}/previews
 * @PathParam   {string}            contentId               The id of the content item to attach a preview to
 * @PathParam   {string}            revisionId              The id of the revision to attach a preview to
 * @BodyParam   {UpdatedPreview}    body                    Updated preview metadata
 * @FormParam   {File}              file                    The binary content of the preview
 * @Return      {void}
 * @HttpResponse                    201                     Preview added
 * @HttpResponse                    400                     Malformed metadata object. Expected proper JSON for: ...
 * @HttpResponse                    400                     Missing or invalid contentId
 * @HttpResponse                    400                     Missing or invalid revisionId
 * @HttpResponse                    400                     Specified revisionId does not belong to the specifed content item
 * @HttpResponse                    400                     The status parameter must be one of: `done`, `error` or `ignored`
 * @HttpResponse                    401                     Only administrators can attach preview items to a content item
 * @HttpResponse                    404                     Content not available
 */
OAE.tenantRouter.on('post', '/api/content/:contentId/revisions/:revisionId/previews', (request, response) => {
  let contentMetadata = null;
  let previewMetadata = null;
  let sizes = null;
  let files = null;
  try {
    contentMetadata = JSON.parse(request.body.contentMetadata);
    previewMetadata = JSON.parse(request.body.previewMetadata);
    sizes = JSON.parse(request.body.sizes);

    if (request.body.links) {
      files = JSON.parse(request.body.links);
    }
  } catch {
    let invalidField = null;
    if (!contentMetadata) {
      invalidField = 'contentMetadata';
    } else if (!previewMetadata) {
      invalidField = 'previewMetadata';
    } else if (!sizes) {
      invalidField = 'sizes';
    } else if (!files) {
      invalidField = 'links';
    }

    return response.status(400).send('Malformed metadata object. Expected proper JSON for: ' + invalidField);
  }

  if (request.files) {
    files = files || {};
    _.extend(files, request.files);
  }

  ContentAPI.setPreviewItems(
    request.ctx,
    {
      contentId: request.params.contentId,
      revisionId: request.params.revisionId,
      status: request.body.status,
      files,
      sizes,
      contentMetadata,
      previewMetadata
    },
    (error) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(201).end();
    }
  );
});

/**
 * @REST getContentContentIdRevisionsRevisionIdPreviews
 *
 * Get the previews for a revision
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /content/{contentId}/revisions/{revisionId}/previews
 * @PathParam   {string}            contentId               The id of the content item to get the previews for
 * @PathParam   {string}            revisionId              The id of the revision to get the previews for
 * @Return      {PreviewsList}                              The revision previews
 * @HttpResponse                    200                     Previews available
 * @HttpResponse                    400                     A content id must be provided
 * @HttpResponse                    401                     You don't have access to this piece of content
 * @HttpResponse                    404                     Content not available
 */
OAE.tenantRouter.on('get', '/api/content/:contentId/revisions/:revisionId/previews', (request, response) => {
  ContentAPI.getPreviewItems(request.ctx, request.params.contentId, request.params.revisionId, (error, previews) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).send(previews);
  });
});

/**
 * @REST getContentContentIdRevisionsRevisionIdPreviewsItem
 *
 * Download a preview
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /content/{contentId}/revisions/{revisionId}/previews/{item}
 * @PathParam   {string}             contentId              The id of the content item to download the preview for
 * @PathParam   {string}             revisionId             The id of the revision to download the preview for
 * @PathParam   {string}             item                   The preview item to download
 * @QueryParam  {string}             expires                The timestamp (millis since epoch) at which the signature expires
 * @QueryParam  {string}             signature              The access control signature
 * @Return      {File}                                      The preview
 * @HttpResponse                        200                 Preview provided
 * @HttpResponse                        302                 Redirecting to preview
 * @HttpResponse                        400                 A valid contentId must be provided
 * @HttpResponse                        400                 A valid revisionId must be provided
 * @HttpResponse                        400                 Missing preview item
 * @HttpResponse                        400                 No revision id provided and content item does not have a latest revision id
 * @HttpResponse                        400                 Only file content items can be downloaded
 * @HttpResponse                        400                 The revision id provided is not associated with the specified content item
 * @HttpResponse                        401                 Invalid content signature data for accessing previews
 * @HttpResponse                        404                 Preview not available
 */
OAE.tenantRouter.on('get', '/api/content/:contentId/revisions/:revisionId/previews/:item', (request, response) => {
  const signature = {
    signature: request.query.signature,
    expires: request.query.expires,
    lastModified: request.query.lastmodified
  };
  ContentAPI.getSignedPreviewDownloadInfo(
    request.ctx,
    request.params.contentId,
    request.params.revisionId,
    request.params.item,
    signature,
    (error, downloadInfo) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return _handleDownload(response, downloadInfo, true);
    }
  );
});

/**
 * @REST getContentContentIdRevisions
 *
 * Get the revisions for a content item
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /content/{contentId}/revisions
 * @PathParam   {string}            contentId           The id of the content item to get the revisions for
 * @QueryParam  {number}            [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}            [start]             The revision paging token from which to start fetching revisions
 * @Return      {Revisions}                             The revisions for the specified content item
 * @HttpResponse                    200                 Revisions available
 * @HttpResponse                    400                 A valid contentId must be provided
 * @HttpResponse                    400                 A valid limit should be passed in
 * @HttpResponse                    404                 Content not available
 */
OAE.tenantRouter.on('get', '/api/content/:contentId/revisions', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 10, 1, 25);
  ContentAPI.getRevisions(
    request.ctx,
    request.params.contentId,
    request.query.start,
    limit,
    (error, revisions, nextToken) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).send({ results: revisions, nextToken });
    }
  );
});

/**
 * @REST getContentContentIdRevisionsRevisionId
 *
 * Get a revision
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /content/{contentId}/revisions/{revisionId}
 * @PathParam   {string}            contentId           The id of the content item to get the revision for
 * @PathParam   {string}            revisionId          The id of the revision to get
 * @Return      {Revision}                              The revision
 * @HttpResponse                    200                 Revision available
 * @HttpResponse                    400                 A valid contentId must be provided
 * @HttpResponse                    400                 A valid revisionId must be provided
 * @HttpResponse                    404                 Content not available
 */
OAE.tenantRouter.on('get', '/api/content/:contentId/revisions/:revisionId', (request, response) => {
  ContentAPI.getRevision(request.ctx, request.params.contentId, request.params.revisionId, (error, revision) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).send(revision);
  });
});

/**
 * @REST postContentContentIdRevisionsRevisionIdRestore
 *
 * Restore a revision
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /content/{contentId}/revisions/{revisionId}/restore
 * @PathParam   {string}            contentId           The id of the content item to restore the revision for
 * @PathParam   {string}            revisionId          The id of the revision to restore
 * @Return      {Revision}                              The restored revision
 * @HttpResponse                    200                 Revision restored
 * @HttpResponse                    400                 A valid contentId must be provided
 * @HttpResponse                    400                 A valid revisionId must be provided
 * @HttpResponse                    400                 The contentId specified is not the owner of the specified revisionId
 * @HttpResponse                    401                 Manager rights are required to restore a revision
 * @HttpResponse                    404                 Content not available
 */
OAE.tenantRouter.on('post', '/api/content/:contentId/revisions/:revisionId/restore', (request, response) => {
  ContentAPI.restoreRevision(request.ctx, request.params.contentId, request.params.revisionId, (error, newRevision) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).send(newRevision);
  });
});

/**
 * @REST getContentContentIdMembers
 *
 * Get the members of a content item and their roles
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /content/{contentId}/members
 * @PathParam   {string}            contentId           The id of the content item to get the members for
 * @QueryParam  {number}            [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}            [start]             The content paging token from which to start fetching content members
 * @Return      {MembersResponse}                       Members of the specified content item
 * @HttpResponse                    200                 Members available
 * @HttpResponse                    400                 A valid content id must be provided
 * @HttpResponse                    400                 A valid limit should be passed in
 * @HttpResponse                    401                 You are not authorized to access the members of this content item
 * @HttpResponse                    404                 Content not available
 */
OAE.tenantRouter.on('get', '/api/content/:contentId/members', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 10, 1, 25);
  ContentAPI.getContentMembersLibrary(
    request.ctx,
    request.params.contentId,
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
 * @REST postContentContentIdMembers
 *
 * Update the members of a content item
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /content/{contentId}/members
 * @PathParam   {string}                contentId           The id of the content item to update the members for
 * @BodyParam   {ContentMembersUpdate}  body                Object that describes the membership updates to apply to the content item
 * @Return      {void}
 * @HttpResponse                        200                 Members updated
 * @HttpResponse                        400                 A valid content id must be provided
 * @HttpResponse                        400                 A principalId needs to be specified for a role
 * @HttpResponse                        400                 At least one role change needs to be applied
 * @HttpResponse                        400                 Invalid principal id specified: ...
 * @HttpResponse                        400                 Invalid role provided
 * @HttpResponse                        400                 You should specify at least 1 user/group to set content permissions on
 * @HttpResponse                        401                 You are not allowed to manage this piece of content
 * @HttpResponse                        404                 Content not available
 */
OAE.tenantRouter.on('post', '/api/content/:contentId/members', (request, response) => {
  // Parse the incoming false values
  const requestKeys = _.keys(request.body);
  for (const element of requestKeys) {
    request.body[element] = OaeUtil.castToBoolean(request.body[element]);
  }

  ContentAPI.setContentPermissions(request.ctx, request.params.contentId, request.body, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
});

/**
 * @REST getContentContentIdInvitations
 *
 * Get all the invitations associated to a content item
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /content/{contentId}/invitations
 * @PathParam   {string}                contentId           The id of the content item for which to get invitations
 * @Return      {InvitationsResponse}                       The invitations associated to the content item
 * @HttpResponse                        200                 Invitations available
 * @HttpResponse                        400                 A valid content id must be provided
 * @HttpResponse                        401                 You are not allowed to get invitations for this content item
 * @HttpResponse                        404                 Content not available
 */
OAE.tenantRouter.on('get', '/api/content/:contentId/invitations', (request, response) => {
  ContentAPI.getContentInvitations(request.ctx, request.params.contentId, (error, invitations) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send({ results: invitations });
  });
});

/**
 * @REST postContentContentIdInvitationsEmailResend
 *
 * Resend an invitation to a content item
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /content/{contentId}/invitations/{email}/resend
 * @PathParam   {string}                contentId           The id of the content item for which to get invitations
 * @PathParam   {string}                email               The email for which to resend the invitation
 * @Return      {void}
 * @HttpResponse                        200                 Invitation was resent
 * @HttpResponse                        400                 A valid content id must be provided
 * @HttpResponse                        400                 A valid email must be provided
 * @HttpResponse                        401                 You are not allowed to resend invitations for this content item
 * @HttpResponse                        404                 Content not available
 * @HttpResponse                        404                 No invitation for the specified email exists for the content item
 */
OAE.tenantRouter.on('post', '/api/content/:contentId/invitations/:email/resend', (request, response) => {
  ContentAPI.resendContentInvitation(request.ctx, request.params.contentId, request.params.email, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST postContentContentIdShare
 *
 * Share a content item
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /content/{contentId}/share
 * @PathParam   {string}        contentId           The id of the content item to share
 * @FormParam   {string[]}      viewers             Unique identifier(s) for users and groups to share the content item with
 * @Return      {void}
 * @HttpResponse                200                 Content shared
 * @HttpResponse                400                 A valid content id must be provided
 * @HttpResponse                400                 After this operation, the content item would be left without a manager
 * @HttpResponse                400                 At least one role change needs to be applied
 * @HttpResponse                400                 Invalid principal id specified: ...
 * @HttpResponse                400                 One or more target members being granted access are not authorized to become members on this content item
 * @HttpResponse                400                 One or more target members being granted access do not exist
 * @HttpResponse                400                 The content must at least be shared with 1 user or group
 * @HttpResponse                401                 You are not allowed to share this content
 * @HttpResponse                401                 You have to be logged in to be able to share content
 * @HttpResponse                404                 Content not available
 */
OAE.tenantRouter.on('post', '/api/content/:contentId/share', (request, response) => {
  // Make sure viewers is an array
  request.body.viewers = OaeUtil.toArray(request.body.viewers);
  ContentAPI.shareContent(request.ctx, request.params.contentId, request.body.viewers, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
});

/**
 * @REST postContentContentIdMessages
 *
 * Create a new comment on a content item
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /content/{contentId}/messages
 * @PathParam   {string}        contentId           The id of the content item to which to post the comment
 * @FormParam   {string}        body                The body of the comment
 * @FormParam   {string}        [replyTo]           The timestamp of the comment to which this comment is a reply. Not specifying this will create a top level comment
 * @Return      {Message}                           The created comment
 * @HttpResponse                201                 Comment created
 * @HttpResponse                400                 A comment can only be 100000 characters long
 * @HttpResponse                400                 A comment must be provided
 * @HttpResponse                400                 A messageBoxId must be specified.
 * @HttpResponse                400                 If the replyToCreated optional parameter is specified, it cannot be in the future.
 * @HttpResponse                400                 If the replyToCreated optional parameter is specified, it should be an integer.
 * @HttpResponse                400                 If the replyToCreated optional parameter is specified, it should not be null.
 * @HttpResponse                400                 Invalid content resource id provided
 * @HttpResponse                400                 Invalid reply-to timestamp provided
 * @HttpResponse                400                 Reply-to message does not exist
 * @HttpResponse                400                 The body of the message must be specified.
 * @HttpResponse                400                 The createdBy parameter must be a valid user id.
 * @HttpResponse                401                 Only authorized users can post comments
 * @HttpResponse                404                 Could not find principal with id ...
 * @HttpResponse                404                 Content not available
 * @HttpResponse                500                 Failed to create a new message
 */
OAE.tenantRouter.on('post', '/api/content/:contentId/messages', (request, response) => {
  ContentAPI.createComment(
    request.ctx,
    request.params.contentId,
    request.body.body,
    request.body.replyTo,
    (error, message) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(201).send(message);
    }
  );
});

/**
 * @REST getContentContentIdMessages
 *
 * Get the comments for a content item
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /content/{contentId}/messages
 * @PathParam   {string}            contentId           The id of the content item for which to get the comments
 * @QueryParam  {number}            [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}            [start]             The comments paging token from which to start fetching comments
 * @Return      {MessagesResponse}                      The comments on the content item
 * @HttpResponse                    200                 Comments available
 * @HttpResponse                    400                 A messageBoxId must be specified.
 * @HttpResponse                    400                 A timestamp cannot be in the future.
 * @HttpResponse                    400                 A timestamp cannot be null.
 * @HttpResponse                    400                 A timestamp should be an integer.
 * @HttpResponse                    400                 A valid limit should be passed in
 * @HttpResponse                    400                 Invalid content resource id provided
 */
OAE.tenantRouter.on('get', '/api/content/:contentId/messages', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 10, 1, 25);
  ContentAPI.getComments(
    request.ctx,
    request.params.contentId,
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
 * @REST deleteContentContentIdMessagesCreated
 *
 * Delete a comment from a content item
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /content/{contentId}/messages/{created}
 * @PathParam   {string}                contentId           The id of the content item from which to delete the comment
 * @PathParam   {string}                created             The timestamp of the comment that should be deleted
 * @Return      {Message}                                   The deleted comment
 * @HttpResponse                        200                 Comment deleted
 * @HttpResponse                        400                 A content id must be provided
 * @HttpResponse                        400                 A messageBoxId must be specified.
 * @HttpResponse                        400                 A timestamp cannot be in the future.
 * @HttpResponse                        400                 A timestamp cannot be null.
 * @HttpResponse                        400                 A timestamp should be an integer.
 * @HttpResponse                        400                 A valid integer comment created timestamp must be specified
 * @HttpResponse                        400                 If the deleteType is specified it should be one of: ...
 * @HttpResponse                        400                 The createdTimestamp cannot be in the future.
 * @HttpResponse                        400                 The createdTimestamp should be an integer.
 * @HttpResponse                        400                 The createdTimestamp should not be null.
 * @HttpResponse                        401                 Only authorized users can delete comments
 * @HttpResponse                        401                 You do not have access to delete this comment
 * @HttpResponse                        404                 Message not found.
 * @HttpResponse                        404                 The specified comment does not exist
 * @HttpResponse                        404                 The specified message did not exist
 */
OAE.tenantRouter.on('delete', '/api/content/:contentId/messages/:created', (request, response) => {
  ContentAPI.deleteComment(request.ctx, request.params.contentId, request.params.created, (error, deleted) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).send(deleted);
  });
});

/**
 * @REST getContentLibraryPrincipalId
 *
 * Get the content library items for a user or group
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /content/library/{principalId}
 * @PathParam   {string}            principalId         The id of the principal whose content library to fetch
 * @QueryParam  {number}            [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}            [start]             The content paging token from which to start fetching content items
 * @Return      {ContentLibrary}                        The content library items for the specified user or group
 * @HttpResponse                    200                 Library available
 * @HttpResponse                    400                 A user or group id must be provided
 * @HttpResponse                    400                 A valid limit should be passed in
 * @HttpResponse                    401                 You do not have access to this library
 */
OAE.tenantRouter.on('get', '/api/content/library/:principalId', (request, response) => {
  const limit = OaeUtil.getNumberParam(request.query.limit, 12, 1, 25);
  ContentAPI.getContentLibraryItems(
    request.ctx,
    request.params.principalId,
    request.query.start,
    limit,
    (error, items, nextToken) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).send({ results: items, nextToken });
    }
  );
});

/**
 * @REST deleteContentLibraryPrincipalIdContentId
 *
 * Remove a content item from a content library
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /content/library/{principalId}/{contentId}
 * @PathParam   {string}            principalId             The id of the principal from whose content library to remove the content item
 * @PathParam   {string}            contentId               The id of the content item to remove from the library
 * @Return      {void}
 * @HttpResponse                    200                     Content deleted
 * @HttpResponse                    400                     A user or group id must be provided
 * @HttpResponse                    400                     A valid content id must be provided
 * @HttpResponse                    400                     At least one role change needs to be applied
 * @HttpResponse                    400                     Invalid principal id specified: ...
 * @HttpResponse                    400                     Invalid resource id provided.
 * @HttpResponse                    400                     Invalid role provided.
 * @HttpResponse                    400                     The requested change results in a piece of content with no managers
 * @HttpResponse                    400                     The specified piece of content is not in this library
 * @HttpResponse                    401                     You are not authorized to delete a piece of content from this library
 * @HttpResponse                    401                     You must be authenticated to remove a piece of content from a library
 */
OAE.tenantRouter.on('delete', '/api/content/library/:principalId/:contentId', (request, response) => {
  ContentAPI.removeContentFromLibrary(request.ctx, request.params.principalId, request.params.contentId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
});

/**
 * @REST getDownloadSigned
 *
 * Download a content item using an access control signature
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /download/signed
 * @QueryParam  {string}                expires             The timestamp (millis since epoch) at which the signature expires
 * @QueryParam  {string}                signature           The access control signature
 * @Return      {File}                                      The content item
 * @HttpResponse                        200                 Content provided
 * @HttpResponse                        302                 Redirecting to content
 * @HttpResponse                        401                 Invalid signature data for the provided download url
 * @HttpResponse                        404                 Content not available
 */
OAE.globalAdminRouter.on('get', '/api/download/signed', _handleSignedDownload);
OAE.tenantRouter.on('get', '/api/download/signed', _handleSignedDownload);

/**
 * Send the correct HTTP response according to a download strategy. Note that the "direct" download strategy is not being handled here
 * as the direct strategy should not be requested to the application for action, instead its target is delivered to the user verbatim
 * with no signature.
 *
 * @param  {Response}           res                     The Express Response object
 * @param  {Object}             downloadInfo            An object that represents an item that can be downloaded from the application
 * @param  {String}             downloadInfo.filename   The file name of the download
 * @param  {DownloadStrategy}   downloadInfo.strategy   How the application should deliver the download
 * @param  {Boolean}            [expiresMax]            Whether a far future expires response header should be set
 * @api private
 */
const _handleDownload = function (response, downloadInfo, expiresMax) {
  const downloadStrategy = downloadInfo.strategy;

  // A 204 suggest that the LB (nginx, apache, lighthttpd, ..) will be handling the download via the x-sendfile mechanism
  switch (downloadStrategy.strategy) {
    case ContentConstants.backend.DOWNLOAD_STRATEGY_INTERNAL: {
      // Nginx internal download
      response.setHeader('X-Accel-Redirect', downloadStrategy.target);

      // Apache internal download
      response.setHeader('X-Sendfile', downloadStrategy.target);

      // Lighthttpd internal download
      response.setHeader('X-LIGHTTPD-send-file', downloadStrategy.target);

      if (expiresMax) {
        // Add the cache headers manually as some webservers are not
        // able to deal with setting cache headers and internal redirects
        // @see https://github.com/oaeproject/Hilary/issues/995
        response.setHeader('Expires', 'Thu, 31 Dec 2037 23:55:55 GMT');
        response.setHeader('Cache-Control', 'max-age=315360000');
      }

      response.setHeader(
        'Content-Disposition',
        'attachment; filename="' + querystring.escape(downloadInfo.filename) + '"'
      );
      response.status(204).send(downloadStrategy.target);

      // A redirect strategy will invoke a redirect to the target

      break;
    }

    case ContentConstants.backend.DOWNLOAD_STRATEGY_REDIRECT: {
      // We can't guarantee that the backend won't want to update some details about the target over time. e.g., update some tracking
      // variables over time for analytics or additional security. Therefore, we do a temporary redirect (302)
      response.setHeader('Location', downloadStrategy.target);
      return response.status(302).end();

      // The app server will send the file to the client. This should *NOT* be used in production and is only really here for easier unit
      // testing purposes
    }

    case ContentConstants.backend.DOWNLOAD_STRATEGY_TEST: {
      return response.download(downloadStrategy.target);

      // In all other cases we respond with a 404
    }

    default: {
      response.status(404).end();
    }
  }
};
