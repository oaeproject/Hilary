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

import fs from 'fs';
import { basename } from 'path';
import util from 'util';
import * as ContentUtils from 'oae-content/lib/backends/util';
import _ from 'underscore';
import mime from 'mime';
import ShortId from 'shortid';

import * as AuthzAPI from 'oae-authz';
import * as AuthzInvitations from 'oae-authz/lib/invitations';
import * as AuthzPermissions from 'oae-authz/lib/permissions';
import * as AuthzUtil from 'oae-authz/lib/util';
import { setUpConfig } from 'oae-config';
import * as EmitterAPI from 'oae-emitter';
import * as LibraryAPI from 'oae-library';
import { logger } from 'oae-logger';

import { getFoldersByIds } from 'oae-folders/lib/internal/dao';
import * as MessageBoxAPI from 'oae-messagebox';
import * as OaeUtil from 'oae-util/lib/util';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao';
import * as PrincipalsUtil from 'oae-principals/lib/util';
import * as ResourceActions from 'oae-resource/lib/actions';
import * as Signature from 'oae-util/lib/signature';
import { MessageBoxConstants } from 'oae-messagebox/lib/constants';
import { Context } from 'oae-context';
import isUrl from 'validator/lib/isURL';
import isInt from 'validator/lib/isInt';
import isIn from 'validator/lib/isIn';
import { Validator as validator } from 'oae-util/lib/validator';
const {
  validateInCase: bothCheck,
  unless,
  isOneOrGreater,
  isDefined,
  isANumber,
  isResourceId,
  isLoggedInUser,
  isNotNull,
  isShortString,
  isNotEmpty,
  isMediumString,
  isArrayNotEmpty,
  isPrincipalId,
  isLongString
} = validator;
import {
  startsWith,
  values,
  path,
  defaultTo,
  curry,
  __,
  equals,
  not,
  and,
  compose,
  forEach,
  forEachObjIndexed,
  both,
  either,
  isEmpty
} from 'ramda';
import { AuthzConstants } from 'oae-authz/lib/constants';
import { ContentConstants } from './constants';
import * as ContentDAO from './internal/dao';
import * as ContentMembersLibrary from './internal/membersLibrary';
import * as ContentUtil from './internal/util';
import * as Ethercalc from './internal/ethercalc';
import * as Etherpad from './internal/etherpad';

const Config = setUpConfig('oae-content');
const log = logger('oae-content');

const COLLABDOC = 'collabdoc';
const COLLABSHEET = 'collabsheet';
const DISPLAY_NAME = 'displayName';
const DESCRIPTION = 'description';
const VISIBILITY = 'visibility';
const LINK = 'link';
const HTTP_PROTOCOL = 'http://';
const HTTPS_PROTOCOL = 'https://';

// Auxiliary functions
const toArray = x => [x];
const isNotDefined = compose(not, isDefined);
const errorCodeEquals = err => equals(err.code, 401);
const isOtherThanUnauthorized = compose(not, errorCodeEquals);
const isNotCollabdoc = compose(not, ContentUtils.isResourceACollabDoc);
const isNotCollabsheet = compose(not, ContentUtils.isResourceACollabSheet);
const isHttp = startsWith(HTTP_PROTOCOL);
const isNotHttp = compose(not, isHttp);
const isHttps = startsWith(HTTPS_PROTOCOL);
const isNotHttps = compose(not, isHttps);

/**
 * ### Events
 *
 * The `ContentAPI`, as enumerated in `ContentConstants.events`, emits the following events:
 *
 * `createdComment(ctx, comment, content)`: A new comment was posted for a content item. The `ctx`, `comment` and commented `content` object are provided.
 * `createdContent(ctx, content)`: A new content item was created. The `ctx` and the `content` object that was created are both provided.
 * `deletedComment(ctx, comment, content, deleteType)`: An existing comment has been deleted on a content item. The `ctx`, `content` and target `comment` object are provided.
 * `deletedContent(ctx, contentObj, members)`: A content item was deleted. The 'ctx', the deleted 'contentObj' and the list of authz principals that had this content item in their library
 * `downloadedContent(ctx, content, revision)`: A content item was downloaded. The `ctx`, `content` and the `revision` are all provided.
 * `editedCollabdoc(ctx, contentObj)`: A collaborative document was edited by a user without resulting in a new revision. This happens if the revision-creation was already triggered by another user leaving the document
 * `editedCollabsheet(ctx, contentObj)`: A collaborative spreadsheet was edited by a user without resulting in a new revision. This happens if the revision-creation was already triggered by another user leaving the spreadsheet
 * `getContentLibrary(ctx, principalId, visibility, start, limit, contentObjects)`: A content library was retrieved.
 * `getContentProfile(ctx, content)`: A content profile was retrieved. The `ctx` and the `content` are both provided.
 * `restoredContent(ctx, newContentObj, oldContentObj, restoredRevision)`: An older revision for a content item has been restored.
 * `updatedContent(ctx, newContentObj, oldContentObj)`: A content item was updated. The `ctx`, the updated content object and the content before was updated are provided.
 * `updatedContentBody(ctx, newContentObj, oldContentObj, revision)`: A content item's file body was updated. The `ctx` of the request, the `newContentObj` object after being updated, the `oldContentObj` object before the update, and the revision object.
 * `updatedContentMembers(ctx, content, memberUpdates, addedMemberIds, updatedMemberIds, removedMemberIds)`: A content's members list was updated. The `ctx`, full `content` object of the updated content, and the hash of principalId -> role that outlines the changes that were made are provided, as well as arrays containing the ids of the added members, updated members and removed members that resulted from the change
 * `updatedContentPreview(content)`: A content item's preview has been updated
 */
const emitter = new EmitterAPI.EventEmitter();

/// ////////////////////////////////
// Retrieving a piece of content //
/// ////////////////////////////////

/**
 * Get a content's basic profile information based on a pooled content id.
 * An access-check will be run to determine if the user can view this piece of content.
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         contentId               The id of the content object we want to retrieve
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Content}        callback.contentObj     Retrieved content object
 */
const getContent = (ctx, contentId, callback) => {
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A content id must be provided'
    })(contentId);
  } catch (error) {
    return callback(error);
  }

  ContentDAO.Content.getContent(contentId, (err, contentObj) => {
    if (err) return callback(err);

    AuthzPermissions.canView(ctx, contentObj, err => {
      if (err) return callback(err);

      ContentUtil.augmentContent(ctx, contentObj);
      return callback(null, contentObj);
    });
  });
};

/**
 * Get a full content item profile. Next to the basic content profile, this will include the created date, the profile of
 * the user who originally created the content, and a isManager property specifying whether or not the current user can
 * manage the content.
 *
 * @param  {Context}        ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}         contentId                   The id of the content item to get
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Content}        callback.contentProfile     Full content profile
 */
const getFullContentProfile = (ctx, contentId, callback) => {
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A content id must be provided'
    })(contentId);
  } catch (error) {
    return callback(error);
  }

  getContent(ctx, contentId, (err, contentObj) => {
    if (err) return callback(err);

    // Check whether the user is a manager
    let isManager = true;
    AuthzPermissions.canManage(ctx, contentObj, err => {
      if (both(isDefined, isOtherThanUnauthorized)(err)) return callback(err);
      if (isDefined(err)) isManager = false;

      return _getFullContentProfile(ctx, contentObj, isManager, callback);
    });
  });
};

/**
 * Add the `isManager` flag, `createdBy` user object, `canShare` flag as well as `latestRevision` and `isEditor` in case it's a collaborative document.
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {Content}    contentObj                  The content object to add the extra profile information on.
 * @param  {Boolean}    isManager                   Whether or not the current user is a manager of the piece of content.
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Content}    callback.contentProfile     Full content profile
 */
const _getFullContentProfile = (ctx, contentObj, isManager, callback) => {
  // Store the isManager property.
  contentObj.isManager = isManager;

  // Get the user object for the createdBy property
  PrincipalsUtil.getPrincipal(ctx, contentObj.createdBy, (err, createdBy) => {
    if (err) return callback(err);

    contentObj.createdBy = createdBy;

    // Check if the user can share this content item
    let canShare = true;
    AuthzPermissions.canShare(ctx, contentObj, null, AuthzConstants.role.VIEWER, err => {
      if (both(isDefined, isOtherThanUnauthorized)(err)) return callback(err);
      if (isDefined(err)) canShare = false;

      // Specify on the return value if the current user can share the content item
      contentObj.canShare = canShare;

      // For any other than collabdoc or collabsheet, we simply return with the share information
      if (both(isNotCollabdoc, isNotCollabsheet)(contentObj.resourceSubType)) {
        emitter.emit(ContentConstants.events.GET_CONTENT_PROFILE, ctx, contentObj);
        return callback(null, contentObj);
      }

      // If the content item is a collaborative document, add the latest revision data and isEditor
      _getRevision(ctx, contentObj, contentObj.latestRevisionId, (err, revision) => {
        if (err) return callback(err);

        contentObj.latestRevision = revision;
        AuthzPermissions.canEdit(ctx, contentObj, err => {
          if (both(isDefined, isOtherThanUnauthorized)(err)) return callback(err);

          if (err) {
            contentObj.isEditor = false;
          } else {
            contentObj.isEditor = true;
          }

          emitter.emit(ContentConstants.events.GET_CONTENT_PROFILE, ctx, contentObj);
          return callback(null, contentObj);
        });
      });
    });
  });
};

/**
 * Creating a new piece of content //
 */

/**
 * Create a new link
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         displayName             The display name of the link
 * @param  {String}         [description]           A longer description for the link
 * @param  {String}         [visibility]            The visibility of the link. One of `public`, `loggedin`, `private`
 * @param  {String}         link                    The URL for the link
 * @param  {Object}         [additionalMembers]     Object where the keys represent principal ids that need to be added to the content upon creation and the values represent the role that principal will have. Possible values are "viewer" and "manager"
 * @param  {String[]}       [folders]               The ids of the folders to which this link should be added
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Content}        callback.content        The created link
 */
const createLink = (ctx, displayName, description, visibility, link, additionalMembers, folders, callback) => {
  callback = defaultTo(function() {}, callback);

  // Setting content to default if no visibility setting is provided
  visibility = defaultTo(Config.getValue(ctx.tenant().alias, 'visibility', 'links'), visibility);

  // Check if the link property is present. All other validation will be done in the _createContent function
  try {
    unless(isUrl, {
      code: 400,
      msg: 'A valid link must be provided'
    })(link, { require_tld: false }); // eslint-disable-line camelcase

    unless(isLoggedInUser, {
      code: 401,
      msg: 'You have to be logged in to be able to create a content item'
    })(ctx);
  } catch (error) {
    return callback(error);
  }

  // Make sure the URL starts with a protocol
  if (both(isNotHttp, isNotHttps)(link)) {
    link = HTTP_PROTOCOL.concat(link);
  }

  const contentId = _generateContentId(ctx.tenant().alias);
  const revisionId = _generateRevisionId(contentId);

  _createContent(
    ctx,
    contentId,
    revisionId,
    'link',
    displayName,
    description,
    visibility,
    additionalMembers,
    folders,
    { link },
    {},
    (err, content, revision, memberChangeInfo) => {
      if (err) return callback(err);

      emitter.emit(ContentConstants.events.CREATED_CONTENT, ctx, content, revision, memberChangeInfo, folders, errs => {
        if (errs) {
          return callback(_.first(errs));
        }

        return callback(null, content);
      });
    }
  );
};

/**
 * Create a new file
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         displayName             The display name of the file
 * @param  {String}         [description]           A longer description for the file
 * @param  {String}         [visibility]            The visibility of the file. One of `public`, `loggedin`, `private`
 * @param  {Object}         file                    A file object as returned by express
 * @param  {Object}         [additionalMembers]     Object where the keys represent principal ids that need to be added to the content upon creation and the values represent the role that principal will have. Possible values are "viewer" and "manager"
 * @param  {String[]}       [folders]               The ids of the folders to which this file should be added
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Content}        callback.content        The created file
 */
const createFile = (ctx, displayName, description, visibility, file, additionalMembers, folders, callback) => {
  // Wrap the callback function into a function that cleans up the file in case something went wrong
  const cleanUpCallback = _getCleanUpCallback({ file }, callback);

  // Try to create the file
  return _createFile(ctx, displayName, description, visibility, file, additionalMembers, folders, cleanUpCallback);
};

/**
 * Returns a function that will call the provided callback function.
 * In case the returned function gets called with an error object, the passed in file object will
 * be removed from the file system.
 *
 * @param  {Object}    files                The ExpressJS files object
 * @param  {Function}  callback             Standard callback function
 * @param  {Object}    callback.err         An error that occurred, if any
 * @param  {Content}   callback.content     JSON object containing the pool id of the created content
 * @return {Function}                       A function that removes the file on disk in case something went wrong
 * @api private
 */
const _getCleanUpCallback = (files, callback) => {
  return function(...args) {
    // Remember the arguments so we can pass them to the callback later.
    const callbackArguments = args;

    // The first argument is always the error object.
    const err = callbackArguments[0];

    if (and(isDefined(err), isDefined(files))) {
      // Something went wrong with a request that has uploaded files associated to it.
      // In that case we try to remove the files.
      const fileObjects = values(files);
      _cleanupUploadedFiles(fileObjects, () => callback.apply(this, callbackArguments));
    } else {
      // If we get here, the request might have failed, but it didn't contain an uploaded file.
      return callback.apply(this, callbackArguments);
    }
  };
};

/**
 * Recursively iterates trough an array of uploaded files and removes them.
 *
 * @param  {Object[]}   files       An array of ExpressJS file objects
 * @param  {Function}   callback    Standard callback function
 * @api private
 */
const _cleanupUploadedFiles = (files, callback) => {
  if (isEmpty(files)) return callback();

  const file = files.pop();
  if (file && file.path) {
    fs.access(file.path, fs.constants.F_OK, exists => {
      if (!exists) {
        return _cleanupUploadedFiles(files, callback);
      }

      fs.unlink(file.path, unlinkErr => {
        if (unlinkErr) {
          log().warn({ err: unlinkErr, file }, 'Could not remove the uploaded file.');
        }

        return _cleanupUploadedFiles(files, callback);
      });
    });
  } else {
    return _cleanupUploadedFiles(files, callback);
  }
};

/**
 * Create a new file
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         displayName             The display name of the file
 * @param  {String}         [description]           A longer description for the file
 * @param  {String}         [visibility]            The visibility of the file. One of `public`, `loggedin`, `private`
 * @param  {Object}         file                    A file object as returned by express
 * @param  {Object}         [additionalMembers]     Object where the keys represent principal ids that need to be added to the content upon creation and the values represent the role that principal will have. Possible values are "viewer" and "manager"
 * @param  {String[]}       [folders]               The ids of the folders to which this file should be added
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Content}        callback.content        The created file
 * @api private
 */
const _createFile = function(ctx, displayName, description, visibility, file, additionalMembers, folders, callback) {
  callback = defaultTo(function() {}, callback);

  // Setting content to default if no visibility setting is provided
  visibility = defaultTo(Config.getValue(ctx.tenant().alias, 'visibility', 'files'), visibility);

  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'Anonymous users are not allowed to upload files'
    })(ctx);

    unless(isNotNull, {
      code: 400,
      msg: 'Missing file parameter'
    })(file);

    unless(isNotEmpty, {
      code: 400,
      msg: 'A display name must be provided'
    })(displayName);

    unless(isShortString, {
      code: 400,
      msg: 'A display name can be at most 1000 characters long'
    })(displayName);

    unless(bothCheck(Boolean(description), isMediumString), {
      code: 400,
      msg: 'A content description can be at most 10000 characters long'
    })(description);

    const fileIsDefined = Boolean(file);
    unless(bothCheck(fileIsDefined, isNotNull), {
      code: 400,
      msg: 'Missing size on the file object'
    })(file.size);

    unless(bothCheck(fileIsDefined, isANumber), {
      code: 400,
      msg: 'Invalid size on the file object'
    })(file.size);

    unless(bothCheck(fileIsDefined, isOneOrGreater), {
      code: 400,
      msg: 'Invalid size on the file object'
    })(file.size);

    unless(bothCheck(fileIsDefined, isNotEmpty), {
      code: 400,
      msg: 'Missing name on the file object'
    })(file.name);
  } catch (error) {
    return callback(error);
  }

  // Generate a content ID that can be used when storing the file.
  const contentId = _generateContentId(ctx.tenant().alias);
  const revisionId = _generateRevisionId(contentId);

  // Detect the mimetype of the file using the file extension, as the one that Express gives us is pulled
  // from the HTTP request. This makes it an untrustworthy piece of information as some browsers are
  // notoriously bad at providing the correct mimetype and it can be spoofed. If the mimetype cannot
  // be determined, the mime utility falls back to application/octet-stream.
  file.type = mime.getType(file.name);

  // We store the uploaded file in a location identified by the content id, then further identified by the revision id
  const options = { resourceId: contentId, prefix: revisionId };
  ContentUtil.getStorageBackend(ctx).store(ctx.tenant().alias, file, options, (err, uri) => {
    if (err) return callback(err);

    // Create the content and revision object.
    const otherValues = {
      mime: file.type,
      size: file.size.toString(),
      filename: file.name
    };
    const revisionData = _.extend({}, otherValues, { uri });
    _createContent(
      ctx,
      contentId,
      revisionId,
      'file',
      displayName,
      description,
      visibility,
      additionalMembers,
      folders,
      otherValues,
      revisionData,
      (err, content, revision, memberChangeInfo) => {
        if (err) return callback(err);

        content.filename = file.name;
        content.size = file.size;
        content.mime = file.type;

        emitter.emit(
          ContentConstants.events.CREATED_CONTENT,
          ctx,
          content,
          revision,
          memberChangeInfo,
          folders,
          errs => {
            if (errs) {
              return callback(_.first(errs));
            }

            return callback(null, content);
          }
        );
      }
    );
  });
};

/**
 * Create a collaborative document as a pooled content item
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         displayName             The display name of the collaborative document
 * @param  {String}         [description]           A longer description for the collaborative document
 * @param  {String}         [visibility]            The visibility of the collaborative document. One of `public`, `loggedin`, `private`
 * @param  {Object}         [additionalMembers]     Object where the keys represent principal ids that need to be added to the content upon creation and the values represent the role that principal will have. Possible values are "viewer", "editor" and "manager"
 * @param  {String[]}       [folders]               The ids of the folders to which this collaborative document should be added
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Content}        callback.content        The created collaborative document
 */
const createCollabDoc = (ctx, displayName, description, visibility, additionalMembers, folders, callback) => {
  callback = defaultTo(() => {}, callback);

  // Setting content to default if no visibility setting is provided
  visibility = defaultTo(Config.getValue(ctx.tenant().alias, 'visibility', 'collabdocs'), visibility);

  const contentId = _generateContentId(ctx.tenant().alias);
  const revisionId = _generateRevisionId(contentId);
  Etherpad.createPad(contentId, (err, ids) => {
    if (err) return callback(err);

    _createContent(
      ctx,
      contentId,
      revisionId,
      COLLABDOC,
      displayName,
      description,
      visibility,
      additionalMembers,
      folders,
      ids,
      {},
      (err, content, revision, memberChangeInfo) => {
        if (err) return callback(err);

        content.etherpadPadId = ids.etherpadPadId;
        content.etherpadGroupId = ids.etherpadGroupId;

        emitter.emit(
          ContentConstants.events.CREATED_CONTENT,
          ctx,
          content,
          revision,
          memberChangeInfo,
          folders,
          errs => {
            if (errs) {
              return callback(_.first(errs));
            }

            return callback(null, content);
          }
        );
      }
    );
  });
};

/**
 * Create a collaborative sheet as a pooled content item
 * @param  {Context} ctx                     Standard context object containing the current user and the current tenant
 *
 * @param  {String} displayName             The display name of the collaborative spreadsheet
 * @param  {String} [description]           A longer description for the collaborative spreadsheet
 * @param  {String} [visibility]            The visibility of the collaborative spreadsheet.One of`public`, `loggedin`, `private`
 * @param  {Object} [additionalMembers]     Object where the keys represent principal ids that need to be added to the content upon creation and the values represent the role that principal will have.Possible values are "viewer", "editor" and "manager"
 * @param  {String[]} [folders]               The ids of the folders to which this collaborative spreadsheet should be added
 * @param  {Function} callback                Standard callback function* @param  { Object } callback.err            An error that occurred, if any
 * @param  {Content} callback.content        The created collaborative spreadsheet
 */
const createCollabSheet = function(ctx, displayName, description, visibility, additionalMembers, folders, callback) {
  callback = callback || function() {};

  // Setting content to default if no visibility setting is provided
  visibility = visibility || Config.getValue(ctx.tenant().alias, 'visibility', 'collabsheets');

  const contentId = _generateContentId(ctx.tenant().alias);
  const revisionId = _generateRevisionId(contentId);

  Ethercalc.createRoom(contentId, function(err, roomId) {
    if (err) return callback(err);

    _createContent(
      ctx,
      contentId,
      revisionId,
      COLLABSHEET,
      displayName,
      description,
      visibility,
      additionalMembers,
      folders,
      { ethercalcRoomId: roomId },
      {},
      function(err, content, revision, memberChangeInfo) {
        if (err) return callback(err);

        content.ethercalcRoomId = roomId;

        emitter.emit(
          ContentConstants.events.CREATED_CONTENT,
          ctx,
          content,
          revision,
          memberChangeInfo,
          folders,
          function(err) {
            if (err) return callback(_.first(err));

            return callback(null, content);
          }
        );
      }
    );
  });
};

/**
 * Create a new piece of pooled content
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         contentId           The id of the content item
 * @param  {Strign}         revisionId          The id of the revision for the content item
 * @param  {String}         resourceSubType     The content item type. One of `file`, `collabdoc`, `collabsheet`, `link`
 * @param  {String}         displayName         The display name of the content item
 * @param  {String}         [description]       A longer description for the content item
 * @param  {String}         visibility          The visibility of the collaborative document. One of `public`, `loggedin`, `private`
 * @param  {Object}         roles               Object where the keys represent principal ids that need to be added to the content upon creation and the values represent the role that principal will have. Possible values are "viewer" and "manager", as well as "editor" for collabdocs and collabsheets
 * @param  {String}         folderIds             The ids of the folders to which this content item should be added
 * @param  {Object}         otherValues         JSON object where the keys represent other metadata values that need to be stored, and the values represent the metadata values
 * @param  {Object}         revisionData        JSON object where the keys represent revision columns that need to be stored, and the values represent the revision values
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Content}        callback.content    The created content item
 * @param  {Revision}       callback.revision   The created revision
 * @api private
 */
const _createContent = function(
  ctx,
  contentId,
  revisionId,
  resourceSubType,
  displayName,
  description,
  visibility,
  roles,
  folderIds,
  otherValues,
  revisionData,
  callback
) {
  callback = callback || function() {};

  // Use an empty description if no description has been provided
  description = description || '';
  // Make sure the otherValues and roles are valid objects
  roles = roles || {};
  otherValues = otherValues || {};

  // Parameter validation
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A content ID must be provided'
    })(contentId);

    unless(isNotEmpty, {
      code: 400,
      msg: 'A display name must be provided'
    })(displayName);

    unless(isShortString, {
      code: 400,
      msg: 'A display name can be at most 1000 characters long'
    })(displayName);

    unless(bothCheck(Boolean(description), isMediumString), {
      code: 400,
      msg: 'A description can only be 10000 characters long'
    })(description);

    unless(isIn, {
      code: 400,
      msg: 'An invalid content visibility option has been provided. This can be "private", "loggedin" or "public"'
    })(visibility, _.values(AuthzConstants.visibility));

    unless(isIn, {
      code: 400,
      msg: 'A valid resourceSubType must be provided. This can be "file", "collabdoc" or "link"'
    })(resourceSubType, ContentConstants.resourceSubTypes);

    unless(isLoggedInUser, {
      code: 401,
      msg: 'You have to be logged in to be able to create a content item'
    })(ctx);

    // Ensure all roles applied are valid. Editor is only valid for collabdocs
    const validRoles = [AuthzConstants.role.VIEWER, AuthzConstants.role.MANAGER];
    if (ContentUtils.isResourceACollabDoc(resourceSubType) || ContentUtils.isResourceACollabSheet(resourceSubType)) {
      validRoles.push(AuthzConstants.role.EDITOR);
    }

    forEach(role => {
      unless(isIn, {
        code: 400,
        msg: util.format('Invalid role "%s" specified. Must be one of %s', role, validRoles.join(', '))
      })(role, validRoles);
    }, roles);
  } catch (error) {
    return callback(error);
  }

  // Ensure the specified folders exist and can be managed by the current user
  canManageFolders(ctx, folderIds, (err, folders) => {
    if (err) {
      return callback(err);
    }

    // The current user always becomes a manager
    roles[ctx.user().id] = AuthzConstants.role.MANAGER;

    // Create the resource
    const createFn = _.partial(
      ContentDAO.Content.createContent,
      contentId,
      revisionId,
      ctx.user().id,
      resourceSubType,
      displayName,
      description,
      visibility,
      otherValues,
      revisionData
    );
    ResourceActions.create(ctx, roles, createFn, (err, content, revision, memberChangeInfo) => {
      if (err) {
        return callback(err);
      }

      // Add the content item to the specified folders, if any
      _addContentItemToFolders(ctx, content, folders, err => {
        if (err) {
          log().warn({ err, contentId: content.id, folders }, 'Could not add a content item to a folder');
        }

        return callback(null, content, revision, memberChangeInfo);
      });
    });
  });
};

/**
 * Retrieve the specified folders ensuring that they exist and
 * that the current user can manage all of them.
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String[]}       folderIds               The ids of the folders to retrieve
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error object, if any
 * @param  {Folder[]}       callback.folders        The basic folder objects for the given folder ids
 * @api private
 */
const canManageFolders = function(ctx, folderIds, callback) {
  if (_.isEmpty(folderIds)) {
    return callback(null, []);
  }

  try {
    folderIds.forEach(folderId => {
      // Validate the folder id
      unless(isResourceId, {
        code: 400,
        msg: 'Invalid folder id specified'
      })(folderId);
    });
  } catch (error) {
    return callback(error);
  }

  getFoldersByIds(folderIds, (err, folders) => {
    if (err) {
      return callback(err);
    }

    if (folders.length !== folderIds.length) {
      return callback({ code: 400, msg: 'One or more folders do not exist' });
    }

    // Ensure that the user can manage all the folder items
    _canManageAllFolders(ctx, folders.slice(), err => {
      if (err) {
        return callback(err);
      }

      return callback(null, folders);
    });
  });
};

/**
 * Check whether the current user can manage a set of folders. This operation
 * is destructive to the `folders` array.
 *
 * @param  {Context}        ctx             Standard context object containing the current user and the current tenant
 * @param  {Folder[]}       folders         The set of folders to check
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error object, if any
 * @api private
 */
const _canManageAllFolders = function(ctx, folders, callback) {
  if (folders.length === 0) {
    return callback();
  }

  // We have to require the FoldersAuthz module inline
  // as we'd get a dependency cycle otherwise
  const folder = folders.pop();
  AuthzPermissions.canManage(ctx, folder, err => {
    if (err) {
      return callback(err);
    }

    return _canManageAllFolders(ctx, folders, callback);
  });
};

/**
 * Add a content item to a set of folders. This operation
 * is destructive to the `folders` array.
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {Content}        content             The content item that should be added to the folders
 * @param  {Folder[]}       folders             A set of folders where the content item should be added to
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error object, if any
 * @api private
 */
const _addContentItemToFolders = function(ctx, content, folders, callback) {
  if (folders.length === 0) {
    return callback();
  }

  // We have to require the FoldersAPI inline
  // as we'd get a dependency cycle otherwise
  const folder = folders.pop();
  require('oae-folders')._addContentItemsToFolderLibrary(ctx, 'content-create', folder, [content], err => {
    if (err) {
      return callback(err);
    }

    _addContentItemToFolders(ctx, content, folders, callback);
  });
};

/// //////////////////////////
// Collaborative documents //
/// //////////////////////////

/**
 * Publish a collaborative document. When a document is published the following happens:
 *
 *     -  The HTML for this pad is retrieved
 *     -  A new revision is created with this HTML
 *     -  The content object is updated with this HTML
 *     -  The content item gets bumped to the top of all the libraries it resides in
 *     -  An `updatedContent` event is fired so activities and PP images can be generated
 *
 * Note that this function does *NOT* perform any permission checks. It's assumed that
 * this function deals with messages coming from Redis. Producers of those messages
 * are expected to perform the necessary permissions checks. In the typical case
 * where Etherpad is submitting edit messages, the authorization happens by virtue of the app
 * server constructing a session in Etherpad.
 *
 * @param  {Object}     data                The message as sent by Etherpad
 * @param  {String}     data.contentId      The content id of the collaborative document that was published
 * @param  {String}     data.userId         The id of the user that published the document
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const handlePublish = function(data, callback) {
  callback = defaultTo(function(err) {
    if (err) {
      log().error({ err, data }, 'Error handling etherpad edit');
    }
  }, callback);

  log().trace({ data }, 'Got an etherpad edit');

  PrincipalsDAO.getPrincipal(data.userId, (err, user) => {
    if (err) return callback(err);

    const ctx = new Context(user.tenant, user);

    ContentDAO.Content.getContent(data.contentId, (err, contentObj) => {
      if (err) return callback(err);

      // Get the latest html from etherpad
      Etherpad.getHTML(contentObj.id, contentObj.etherpadPadId, (err, currentHtmlContent) => {
        if (err) return callback(err);

        // Get the latest OAE revision and compare the html that in Etherpad.
        // We only need to create a new revision if there is an actual update
        ContentDAO.Revisions.getRevision(contentObj.latestRevisionId, (err, latestRevision) => {
          if (err) return callback(err);

          const extractContents = path(toArray('etherpadHtml'));
          const equalsCurrentContents = curry(Etherpad.isContentEqual)(currentHtmlContent);
          const isItCurrentlyEmpty = () => Etherpad.isContentEmpty(currentHtmlContent);

          const hasNotChangedContent = compose(equalsCurrentContents, extractContents);
          const hasNoPreviousRevisions = both(compose(not, isDefined, extractContents), isItCurrentlyEmpty);

          /**
           * This situation can occur if 2 users were editting a collaborative document together,
           * one of them leaves, the other one keeps idling (but doesn't make further chances)
           * for a while and then leaves as well. There is no need to generate another revision
           * as we already have one with the latest HTML.
           * We do however raise an event so we can generate an "edited document"-activity
           * for this user as well
           */
          if (either(hasNotChangedContent, hasNoPreviousRevisions)(latestRevision)) {
            emitter.emit(ContentConstants.events.EDITED_COLLABDOC, ctx, contentObj);
            return callback();
          }

          // Otherwise we create a new revision
          const newRevisionId = _generateRevisionId(contentObj.id);
          ContentDAO.Revisions.createRevision(
            newRevisionId,
            contentObj.id,
            data.userId,
            { etherpadHtml: currentHtmlContent },
            (err, revision) => {
              if (err) {
                log().error(
                  { err, contentId: contentObj.id },
                  'Could not create a revision for this collaborative document'
                );
                return callback({
                  code: 500,
                  msg: 'Could not create a revision for this collaborative document'
                });
              }

              // Update the content so we can easily retrieve it.
              // This will also bump the collab doc to the top of the library lists
              ContentDAO.Content.updateContent(
                contentObj,
                { latestRevisionId: revision.revisionId },
                true,
                (err, newContentObj) => {
                  if (err) {
                    log().error(
                      { err, contentId: contentObj.id },
                      'Could not update the main Content CF this collaborative document'
                    );
                    return callback({
                      code: 500,
                      msg: 'Could not update this collaborative document'
                    });
                  }

                  // Add the revision on the content object so the UI doesn't have to
                  // do another request to get the HTML
                  newContentObj.latestRevision = revision;

                  // Emit an event for activities and preview processing
                  emitter.emit(ContentConstants.events.UPDATED_CONTENT_BODY, ctx, newContentObj, contentObj, revision);
                  return callback();
                }
              );
            }
          );
        });
      });
    });
  });
};

/**
 * Publish a collaborative spreadsheet. When a sheet is published the following happens:
 *
 *     -  The HTML for this room is retrieved
 *     -  A new revision is created with this HTML
 *     -  The content object is updated with this HTML
 *     -  The content item gets bumped to the top of all the libraries it resides in
 *     -  An `updatedContent` event is fired so activities and PP images can be generated
 *
 * Note that this function does *NOT* perform any permission checks. It's assumed that this
 * function deals with messages coming from Redis. Producers of those messages are expected
 * to perform the necessary permissions checks. In the typical case where Ethercalc is submitting
 * edit messages, the authorization happens by virtue of the app server constructing a session
 * in Ethercalc.
 *
 * @param  {Object}     data                The message as sent by Ethercalc
 * @param  {String}     data.roomId         The id for the Ethercalc room that has been published
 * @param  {String}     data.userId         The id of the user that published the document
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const ethercalcPublish = function(data, callback) {
  callback = defaultTo(function(err) {
    if (err) log().error({ err, data }, 'Error handling ethercalc edit');
  }, callback);

  ContentDAO.Ethercalc.hasUserEditedSpreadsheet(data.contentId, data.userId, function(err, hasEdited) {
    if (err) callback(err);

    // No edits have been made
    if (not(hasEdited)) return callback();

    log().trace({ data }, 'Got an ethercalc edit');
    ContentDAO.Content.getContent(data.contentId, (err, contentObj) => {
      if (err) return callback(err);

      const roomId = contentObj.ethercalcRoomId;
      PrincipalsDAO.getPrincipal(data.userId, (err, principal) => {
        if (err) return callback(err);

        const ctx = Context.fromUser(principal);
        Ethercalc.getHTML(roomId, (err, currentHtmlContent) => {
          if (err) return callback(err);

          /**
           * Get the latest OAE revision and compare the html to what's in Ethercalc.
           * We only need to create a new revision if there is an actual update
           */
          ContentDAO.Revisions.getRevision(contentObj.latestRevisionId, (err, latestRevision) => {
            if (err) return callback(err);

            const extractContents = path(toArray('ethercalcHtml'));
            const equalsCurrentContents = curry(Ethercalc.isContentEqual)(currentHtmlContent);
            const isItCurrentlyEmpty = () => Ethercalc.isContentEmpty(currentHtmlContent);

            const hasNotChangedContent = compose(equalsCurrentContents, extractContents);
            const hasNoPreviousRevisions = both(compose(not, isDefined, extractContents), isItCurrentlyEmpty);

            if (either(hasNotChangedContent, hasNoPreviousRevisions)(latestRevision)) {
              emitter.emit(ContentConstants.events.EDITED_COLLABDOC, ctx, contentObj);
              return callback();
            }

            // Otherwise we create a new revision
            const newRevisionId = _generateRevisionId(contentObj.id);
            Ethercalc.getRoom(roomId, (err, snapshot) => {
              if (err) return callback(err);

              ContentDAO.Revisions.createRevision(
                newRevisionId,
                contentObj.id,
                data.userId,
                {
                  ethercalcHtml: currentHtmlContent,
                  ethercalcSnapshot: snapshot
                },
                (err, revision) => {
                  if (err) {
                    log().error(
                      {
                        err,
                        contentId: contentObj.id
                      },
                      'Could not create a revision for this collaborative spreadsheet'
                    );
                    return callback({
                      code: 500,
                      msg: 'Could not create a revision for this collaborative spreadsheet'
                    });
                  }

                  // eslint-disable-next-line no-unused-vars
                  Ethercalc.getRoom(roomId, (err, snapshot) => {
                    if (err) {
                      log().error(
                        {
                          err,
                          contentId: contentObj.id
                        },
                        'Failed to fetch Ethercalc snapshot for this collaborative spreadsheet'
                      );
                      return callback({
                        code: 500,
                        msg: 'Failed to fetch Ethercalc snapshot for this collaborative spreadsheet'
                      });
                    }

                    // Update the content so we can easily retrieve it.
                    // This will also bump the collabsheet to the top of the library lists
                    ContentDAO.Content.updateContent(
                      contentObj,
                      {
                        latestRevisionId: revision.revisionId
                      },
                      true,
                      (err, newContentObj) => {
                        if (err) {
                          log().error(
                            {
                              err,
                              contentId: contentObj.id
                            },
                            'Could not update the main content this collaborative spreadsheet'
                          );
                          return callback({
                            code: 500,
                            msg: 'Could not update this collaborative spreadsheet'
                          });
                        }

                        // Add the revision on the content object so the UI doesn't have to do another request to get the HTML
                        newContentObj.latestRevision = revision;

                        // Emit an event for activities and preview processing
                        emitter.emit(
                          ContentConstants.events.UPDATED_CONTENT_BODY,
                          ctx,
                          newContentObj,
                          contentObj,
                          revision
                        );
                        return callback();
                      }
                    );
                  });
                }
              );
            });
          });
        });
      });
    });
  });
};

/**
 * Join a collaborative document or spreadsheet.
 * Only users who have manager permissions on the collaborative document can join the pad/room
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     contentId       The ID of the collaborative document or spreadsheet that should be joined
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Object}     callback.url    JSON object containing the url where the pad/room is accessible
 */
const joinCollabDoc = function(ctx, contentId, callback) {
  // Parameter validation
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A content id must be provided'
    })(contentId);
  } catch (error) {
    return callback(error);
  }

  // Check if we have access to this piece of content.
  _canEdit(ctx, contentId, (err, contentObj) => {
    if (err) return callback(err);

    if (ContentUtils.isResourceACollabDoc(contentObj.resourceSubType)) {
      // Join the pad
      Etherpad.joinPad(ctx, contentObj, (err, data) => {
        if (err) return callback(err);

        ContentDAO.Etherpad.saveAuthorId(data.author.authorID, ctx.user().id, err => {
          if (err) return callback(err);

          return callback(null, { url: data.url });
        });
      });
    } else if (ContentUtils.isResourceACollabSheet(contentObj.resourceSubType)) {
      Ethercalc.joinRoom(ctx, contentObj, function(err, data) {
        if (err) return callback(err);

        callback(null, data);
      });
    } else {
      return callback({ code: 400, msg: 'This is not a collaborative document nor a spreadsheet' });
    }
  });
};

/// //////////////////////////////
// Removing a piece of content //
/// //////////////////////////////

/**
 * Delete a content item
 *
 * @param  {Context}   ctx               Standard context object containing the current user and the current tenant
 * @param  {String}    contentId         The id of the content item to delete
 * @param  {Function}  callback          Standard callback function
 * @param  {Object}    callback.err      An error that occurred, if any
 */
const deleteContent = function(ctx, contentId, callback) {
  callback = callback || function() {};

  // Parameter validation
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A content id must be provided'
    })(contentId);

    unless(isLoggedInUser, {
      code: 401,
      msg: 'You have to be logged in to be able to delete a content item'
    })(ctx);
  } catch (error) {
    return callback(error);
  }

  const done = (ctx, contentObj, members, callback) => {
    emitter.emit(ContentConstants.events.DELETED_CONTENT, ctx, contentObj, members, function(err) {
      if (err) {
        return callback(_.first(err));
      }

      return callback();
    });
  };

  // Fist check whether or not the current user is a manager of the piece of content
  _canManage(ctx, contentId, (err, contentObj) => {
    if (err) {
      return callback(err);
    }

    // Delete the content
    ContentDAO.Content.deleteContent(contentObj, (err, members) => {
      if (err) {
        return callback(err);
      }

      if (ContentUtils.isResourceACollabSheet(contentObj.resourceSubType)) {
        Ethercalc.deleteRoom(contentObj.ethercalcRoomId, function(err) {
          if (err) {
            return callback(err);
          }

          log().info({ contentId }, 'Deleted an Ethercalc room');
          done(ctx, contentObj, members, callback);
        });
      } else {
        done(ctx, contentObj, members, callback);
      }
    });
  });
};

/// /////////////////////////
// Content access control //
/// /////////////////////////

/**
 * Share a content item. This only be possible when the current user is a manager of the content, or if the current user is logged
 * in and the content item is public or visible to logged in users only. In case that the content is shared with principals that
 * are already content members, no updates to the existing role of those principals will be made
 *
 * @param  {Context}   ctx               Standard context object containing the current user and the current tenant
 * @param  {String}    contentId         The id of the content item to share
 * @param  {String[]}  principalIds      Array of principal ids with whom the content will be shared. By default, they will all be made members.
 * @param  {Function}  callback          Standard callback function
 * @param  {Object}    callback.err      An error that occurred, if any
 */
const shareContent = function(ctx, contentId, principalIds, callback) {
  // Parameter validation
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A content id must be provided'
    })(contentId);

    unless(isLoggedInUser, {
      code: 401,
      msg: 'You have to be logged in to be able to share content'
    })(ctx);
  } catch (error) {
    return callback(error);
  }

  // Check if the content item exists
  ContentDAO.Content.getContent(contentId, (err, content) => {
    if (err) {
      return callback(err);
    }

    ResourceActions.share(ctx, content, principalIds, AuthzConstants.role.VIEWER, (err, memberChangeInfo) => {
      if (err) {
        return callback(err);
      }

      if (_.isEmpty(memberChangeInfo.changes)) {
        return callback();
      }

      emitter.emit(ContentConstants.events.UPDATED_CONTENT_MEMBERS, ctx, content, memberChangeInfo, {}, errs => {
        if (errs) {
          return callback(_.first(errs));
        }

        return callback();
      });
    });
  });
};

/**
 * Ensure that the content item exists and the user in context can manage it
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         contentId           The id of the content object we want to check
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Content}        callback.content    The basic profile of the content item
 * @api private
 */
const _canManage = function(ctx, contentId, callback) {
  ContentDAO.Content.getContent(contentId, (err, content) => {
    if (err) {
      return callback(err);
    }

    AuthzPermissions.canManage(ctx, content, err => {
      if (err) {
        return callback(err);
      }

      ContentUtil.augmentContent(ctx, content);
      return callback(null, content);
    });
  });
};

/**
 * Check whether or not the current user can edit a piece of content
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         contentId           The id of the content object we want to check
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Content}        callback.content    The basic profile of the content item
 */
const _canEdit = function(ctx, contentId, callback) {
  ContentDAO.Content.getContent(contentId, (err, content) => {
    if (err) {
      return callback(err);
    }

    AuthzPermissions.canEdit(ctx, content, err => {
      if (err) {
        return callback(err);
      }

      return callback(null, content);
    });
  });
};

/**
 * Update, add or remove the role of a set of principals on a piece of content
 *
 * @param  {Context}         ctx            Standard context object containing the current user and the current tenant
 * @param  {String}          contentId      The id of the content item to update the members for
 * @param  {Object}          changes        Object where the keys represent the principal ids for which the content permissions should be updated/added/removed. The value is a string representing the new role. If false is passed in, the permissions for that principal will be removed e.g. {'user1': 'manager', 'user2': 'viewer', 'user3': false}
 * @param  {Function}        callback       Standard callback function
 * @param  {Object}          callback.err   An error that occurred, if any
 */
const setContentPermissions = function(ctx, contentId, changes, callback) {
  // Parameter validation
  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'You have to be logged in to be able to create a content item'
    })(ctx);

    unless(isResourceId, {
      code: 400,
      msg: 'A content id must be provided'
    })(contentId);
  } catch (error) {
    return callback(error);
  }

  // Check if the content exists
  getContent(ctx, contentId, (err, content) => {
    if (err) {
      return callback(err);
    }

    // Ensure all roles applied are valid. Editor is only valid for collabdocs and collabsheets
    const validRoles = [AuthzConstants.role.VIEWER, AuthzConstants.role.MANAGER];
    if (
      ContentUtils.isResourceACollabDoc(content.resourceSubType) ||
      ContentUtils.isResourceACollabSheet(content.resourceSubType)
    ) {
      validRoles.push(AuthzConstants.role.EDITOR);
    }

    try {
      const isOneOfValidRoles = compose(curry(isIn)(__, validRoles), String);
      forEachObjIndexed((role /* , principalId */) => {
        const roleAintFalse = not(equals(role, false));
        unless(bothCheck(roleAintFalse, isOneOfValidRoles), {
          code: 400,
          msg: util.format('Invalid role "%s" specified. Must be one of %s', role, validRoles.join(', '))
        })(role);
      }, changes);
    } catch (error) {
      return callback(error);
    }

    ResourceActions.setRoles(ctx, content, changes, (err, memberChangeInfo) => {
      if (err) {
        return callback(err);
      }

      if (_.isEmpty(memberChangeInfo.changes)) {
        return callback();
      }

      emitter.emit(ContentConstants.events.UPDATED_CONTENT_MEMBERS, ctx, content, memberChangeInfo, {}, errs => {
        if (errs) {
          return callback(_.first(errs));
        }

        return callback();
      });
    });
  });
};

/**
 * Remove a content item from a content library. This is its own API method due to special permission handling required, as the user
 * is effectively updating a content permissions (removing themselves, or removing it from a group they manage), and they might not
 * necessarily have access to update the permissions of the private content (e.g., they are only a member). Also, tenant privacy
 * rules do not come into play in this case.
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     libraryOwnerId  The id of the principal from whose content library to remove the content item
 * @param  {String}     contentId       The id of the content item to remove from the library
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const removeContentFromLibrary = function(ctx, libraryOwnerId, contentId, callback) {
  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'You must be authenticated to remove a piece of content from a library'
    })(ctx);

    unless(isPrincipalId, {
      code: 400,
      msg: 'A user or group id must be provided'
    })(libraryOwnerId);

    unless(isResourceId, {
      code: 400,
      msg: 'A valid content id must be provided'
    })(contentId);
  } catch (error) {
    return callback(error);
  }

  // Make sure the content exists
  ContentDAO.Content.getContent(contentId, (err, content) => {
    if (err) {
      return callback(err);
    }

    // Ensure the library owner exists
    PrincipalsDAO.getPrincipal(libraryOwnerId, (err, libraryOwner) => {
      if (err) {
        return callback(err);
      }

      // Ensure the user can remove the content item from the library owner's resource
      AuthzPermissions.canRemoveRole(ctx, libraryOwner, content, (err, memberChangeInfo) => {
        if (err) {
          return callback(err);
        }

        // All validation checks have passed, finally persist the role change and update the user library
        AuthzAPI.updateRoles(contentId, memberChangeInfo.changes, err => {
          if (err) {
            return callback(err);
          }

          emitter.emit(ContentConstants.events.UPDATED_CONTENT_MEMBERS, ctx, content, memberChangeInfo, {}, errs => {
            if (errs) {
              return callback(_.first(errs));
            }

            return callback();
          });
        });
      });
    });
  });
};

/**
 * Get the members of a content item and their roles
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         contentId           The id of the content item to get the members for
 * @param  {String}         start               The content paging token from which to start fetching content members. If not provided, the first x elements will be returned
 * @param  {Number}         limit               The maximum number of results to return. Default: 10
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Object[]}       callback.members    Array that contains an object for each member. Each object has a role property that contains the role of the member and a profile property that contains the principal profile of the member
 * @param  {String}         callback.nextToken  The value to provide in the `start` parameter to get the next set of results
 */
const getContentMembersLibrary = function(ctx, contentId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A content id must be provided'
    })(contentId);

    unless(isANumber, {
      code: 400,
      msg: 'A valid limit should be passed in'
    })(limit);
  } catch (error) {
    return callback(error);
  }

  ContentDAO.Content.getContent(contentId, (err, content) => {
    if (err) {
      return callback(err);
    }

    // Determine if and how the current user should access the content members library
    LibraryAPI.Authz.resolveTargetLibraryAccess(ctx, content.id, content, (err, hasAccess, visibility) => {
      if (err) {
        return callback(err);
      }

      if (!hasAccess) {
        return callback({
          code: 401,
          msg: 'You are not authorized to access the members of this content item'
        });
      }

      // Get the members of the content item from the members library
      ContentMembersLibrary.list(content, visibility, { start, limit }, (err, memberIds, nextToken) => {
        if (err) {
          return callback(err);
        }

        if (_.isEmpty(memberIds)) {
          return callback(null, [], nextToken);
        }

        // Get the roles of the members on the content item
        AuthzAPI.getDirectRoles(memberIds, content.id, (err, memberRoles) => {
          if (err) {
            return callback(err);
          }

          // Get the member profiles
          PrincipalsUtil.getPrincipals(ctx, memberIds, (err, memberProfiles) => {
            if (err) {
              return callback(err);
            }

            const memberList = _.chain(memberIds)
              .map(memberId => {
                const memberProfile = memberProfiles[memberId];
                const memberRole = memberRoles[memberId];
                if (memberProfile && memberRole) {
                  return {
                    profile: memberProfile,
                    role: memberRole
                  };
                }

                return null;
              })
              .compact()
              .value();

            return callback(null, memberList, nextToken);
          });
        });
      });
    });
  });
};

/**
 * Get the invitations for the specified content item
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         contentId               The id of the content item to get the invitations for
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Invitation[]}   callback.invitations    The invitations
 */
const getContentInvitations = function(ctx, contentId, callback) {
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A valid resource id must be specified'
    })(contentId);
  } catch (error) {
    return callback(error);
  }

  ContentDAO.Content.getContent(contentId, (err, content) => {
    if (err) {
      return callback(err);
    }

    return AuthzInvitations.getAllInvitations(ctx, content, callback);
  });
};

/**
 * Resend an invitation email for the specified email and content item
 *
 * @param  {Context}        ctx             Standard context object containing the current user and the current tenant
 * @param  {String}         contentId       The id of the content item to which the email was invited
 * @param  {String}         email           The email that was previously invited
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
const resendContentInvitation = function(ctx, contentId, email, callback) {
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A valid resource id must be specified'
    })(contentId);
  } catch (error) {
    return callback(error);
  }

  ContentDAO.Content.getContent(contentId, (err, content) => {
    if (err) {
      return callback(err);
    }

    return ResourceActions.resendInvitation(ctx, content, email, callback);
  });
};

/// //////////////////////////
// Update content metadata //
/// //////////////////////////

/**
 * Update the file body that is associated with a file content item.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     contentId           The id of the file to upload a new version for
 * @param  {File}       file                An expressjs File object that holds the data for the file that needs updating
 * @param  {Function}   [callback]          Standard callback function
 * @param  {Object}     [callback.err]      An error that occurred, if any
 * @param  {Content}    [callback.content]  The updated content item
 */
const updateFileBody = function(ctx, contentId, file, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err }, 'Error updating the filebody for %s', contentId);
      }
    };

  // Wrap the callback function into a function that cleans up the file in case something went wrong
  const cleanUpCallback = _getCleanUpCallback({ file }, callback);

  // Perform the update
  return _updateFileBody(ctx, contentId, file, cleanUpCallback);
};

/**
 * Update the file body that is associated with an uploaded file.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     contentId           The id of the file to upload a new version for
 * @param  {File}       file                An expressjs File object that holds the data for the file that needs updating.
 * @param  {Function}   [callback]          Standard callback function
 * @param  {Object}     [callback.err]      An error that occurred, if any
 * @param  {Content}    [callback.content]  The updated content item
 * @api private
 */
const _updateFileBody = function(ctx, contentId, file, callback) {
  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'You have to be logged in to be able to update a content item'
    })(ctx);

    unless(isResourceId, {
      code: 400,
      msg: 'A content id must be provided'
    })(contentId);

    unless(isNotNull, {
      code: 400,
      msg: 'Missing file parameter.'
    })(file);

    const fileIsDefined = Boolean(file);
    unless(bothCheck(fileIsDefined, isNotNull), {
      code: 400,
      msg: 'Missing size on the file object.'
    })(file.size);

    unless(bothCheck(fileIsDefined, isANumber), {
      code: 400,
      msg: 'Invalid size on the file object.'
    })(file.size);

    unless(bothCheck(fileIsDefined, isOneOrGreater), {
      code: 400,
      msg: 'Invalid size on the file object.'
    })(file.size);

    unless(bothCheck(fileIsDefined, isNotEmpty), {
      code: 400,
      msg: 'Missing name on the file object.'
    })(file.name);
  } catch (error) {
    return callback(error);
  }

  _canManage(ctx, contentId, (err, contentObj) => {
    if (err) {
      return callback(err);
    }

    if (contentObj.resourceSubType !== 'file') {
      return callback({ code: 400, msg: 'This content object is not a file.' });
    }

    // Create a revision id ahead of time for the new revision, so we know where to store the file body for it
    const revisionId = _generateRevisionId(contentId);

    // Detect the mimetype of the file using the file extension, as the one that Express gives us is pulled
    // from the HTTP request. This makes it an untrustworthy piece of information as some browsers are
    // notoriously bad at providing the correct mimetype and it can be spoofed. If the mimetype cannot
    // be determined, the mime utility falls back to application/octet-stream.
    file.type = mime.getType(file.name);

    // Store the file, using the current time as the folder name
    const options = { resourceId: contentObj.id, prefix: revisionId };
    ContentUtil.getStorageBackend(ctx).store(ctx.tenant().alias, file, options, (err, uri) => {
      if (err) {
        return callback(err);
      }

      // Create the revision
      const opts = {
        mime: file.type,
        size: file.size.toString(),
        filename: file.name,
        uri
      };

      ContentDAO.Revisions.createRevision(revisionId, contentObj.id, ctx.user().id, opts, (err, revision) => {
        if (err) {
          return callback(err);
        }

        // Set the new filesize, filename and mimetype on the Content object so the UI
        // can retrieve all the relevant metadata in 1 Cassandra query
        opts.latestRevisionId = revision.revisionId;

        // We have to set the previews status back to pending
        opts.previews = { status: ContentConstants.previews.PENDING };
        ContentDAO.Content.updateContent(contentObj, opts, true, (err, updatedContentObj) => {
          if (err) {
            return callback(err);
          }

          emitter.emit(ContentConstants.events.UPDATED_CONTENT_BODY, ctx, updatedContentObj, contentObj, revision);

          // Output a full content profile
          return _getFullContentProfile(ctx, updatedContentObj, true, callback);
        });
      });
    });
  });
};

/**
 * Attaches preview items to, or set the status of, a revision of a piece of content. This can only be used by a global admin and should technically only
 *  be executed by the preview processor.
 *
 * @param  {Context}     ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}      contentId           The ID of the content item.
 * @param  {String}      revisionId          The revision ID of the content item.
 * @param  {String}      status              The result of the preview processing operation. It should be one of the values of ContentConstants.previews.
 * @param  {Object}      [files]             An object whose key that represents the preview "name" (e.g., page1.html, large.png, etc...) and the value is either an ExpressJS File object or a string representing an external URL at which to reference a preview item. When listing preview items, the items will be ordered ALPHABETICALLY according to the keys in this object.
 * @param  {Object}      [sizes]             Each key maps a filename to a preview size.
 * @param  {Object}      [contentMetadata]   An object that holds optional content metadata, data like displayName for example can be passed in here.
 * @param  {Object}      [previewMetadata]   An object that holds optional preview metadata, data like pageCount for example can be passed in here.
 * @param  {Function}    callback            Standard callback function
 * @param  {Object}      callback.err        An error that occurred, if any
 */
const setPreviewItems = function(
  ctx,
  contentId,
  revisionId,
  status,
  files,
  sizes,
  contentMetadata,
  previewMetadata,
  callback
) {
  files = files || {};
  sizes = sizes || {};
  contentMetadata = contentMetadata || {};
  previewMetadata = previewMetadata || {};

  // Wrap the callback method, which takes care of cleaning up the files if something goes wrong
  const cleanUpCallback = _getCleanUpCallback(files, callback);

  const validStatuses = _.values(ContentConstants.previews);
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'Missing or invalid contentId'
    })(contentId);

    unless(isResourceId, {
      code: 400,
      msg: 'Missing or invalid revisionId'
    })(revisionId);

    unless(isIn, {
      code: 400,
      msg: 'The status parameter must be one of: ' + validStatuses.join(', ')
    })(status, validStatuses);
  } catch (error) {
    return callback(error);
  }

  ContentDAO.Content.getContent(contentId, (err, contentObj) => {
    if (err) {
      return cleanUpCallback(err);
    }

    // Ensure the user is an administrator of the content item's tenant before continuing further
    if (!ctx.user() || !(ctx.user().isGlobalAdmin() || ctx.user().isTenantAdmin(contentObj.tenant.alias))) {
      return cleanUpCallback({
        code: 401,
        msg: 'Only administrators can attach preview items to a content item'
      });
    }

    ContentDAO.Revisions.getRevision(revisionId, (err, revision) => {
      if (err) {
        return cleanUpCallback(err);
      }

      // Ensure that the revision supplied is a revision of the specified content item
      try {
        unless(equals, {
          code: 400,
          msg: 'Specified revisionId does not belong to the specifed content item'
        })(revision.contentId, contentId);
      } catch (error) {
        return cleanUpCallback(error);
      }

      const fileData = {};
      const fileKeys = Object.keys(files);
      let todo = fileKeys.length;

      // The storage URI for the thumbnail image. Will be set to the appropriate preview uri in a later loop
      let thumbnailUri = null;

      if (status === ContentConstants.previews.ERROR || todo === 0) {
        // Preview generation failed or no files were uploaded, store that information in the database
        return ContentDAO.Previews.storeMetadata(
          contentObj,
          revisionId,
          status,
          thumbnailUri,
          contentMetadata,
          previewMetadata,
          fileData,
          err => {
            emitter.emit(ContentConstants.events.UPDATED_CONTENT_PREVIEW, contentObj);
            return callback(err);
          }
        );
      }

      // Preview generation was successful, store the files

      // We store the previews in a location within the content item, in the preview directory specified for the revision
      const storePrefix = 'previews/' + revision.previewsId;
      let called = false;

      /*!
       * Convenience method that handles the completion of storing a preview item to backend storage. When all
       * items have completed and invoked this method, it will call the final callback to exit this method.
       *
       * @param  {Object}     err     An error that occurred, if any
       */
      const _finishIteration = function(err) {
        // If we have already called back (e.g., because of an error), ignore this invokation
        if (called) {
          return;
        }

        // Always decrement todo, whether or not there is an error
        todo--;

        // If we had an error, exit immediately
        if (err) {
          called = true;
          return cleanUpCallback(err);
        }

        if (todo === 0 && !called) {
          // All files have been stored, store the metadata and exit
          called = true;
          log().trace({ data: fileData }, 'Storing %d content preview files', fileKeys.length);
          ContentDAO.Previews.storeMetadata(
            contentObj,
            revisionId,
            status,
            thumbnailUri,
            contentMetadata,
            previewMetadata,
            fileData,
            err => {
              if (err) {
                return callback(err);
              }

              // Indicate that we've just updated a preview
              emitter.emit(ContentConstants.events.UPDATED_CONTENT_PREVIEW, contentObj);

              return callback();
            }
          );
        }
      };

      // Iterate each preview item, store it and record it in the `previewMetadata` hash
      fileKeys.forEach(key => {
        const size = sizes[key];
        if (!size) {
          todo--;
          log().warn('Ignoring file %s as it has no size associated to it', key);
          return;
        }

        // Store the file with a regular storage backend
        const options = { resourceId: contentObj.id, prefix: storePrefix };
        _storePreview(ctx, files[key], options, (err, uri) => {
          if (err) {
            return _finishIteration(err);
          }

          // Remember the thumbnail uri separately so we can stick it on the main content object
          if (size === 'thumbnail') {
            thumbnailUri = uri;

            // Remember the small, medium and large URIs so we can stick it on the previews object
          } else if (size === 'small') {
            previewMetadata.smallUri = uri;
          } else if (size === 'medium') {
            previewMetadata.mediumUri = uri;
          } else if (size === 'large') {
            previewMetadata.largeUri = uri;
          } else if (size === 'wide') {
            previewMetadata.wideUri = uri;
          }

          // Aggregate the file info so it can be stored in Cassandra after all preview bodies have been stored
          fileData[files[key].name] = size + '#' + uri;
          return _finishIteration();
        });
      });
    });
  });
};

/**
 * Verifies the signature for a preview item that is associated to a piece of content.
 * If the signature is valid, an object will be returned that the REST handlers can use
 * to redirect the user to the actual file.
 *
 * @param  {Context}            ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}             contentId                       The content ID that the preview item is associated with
 * @param  {String}             revisionId                      The revision ID that the preview item is associated with
 * @param  {String}             previewItem                     The preview item that needs to be retrieved
 * @param  {Object}             signatureData                   The signature data to check, as created by `Signature.createExpiringResourceSignature`
 * @param  {Function}           callback                        Standard callback function
 * @param  {Object}             callback.err                    An error that occurred, if any
 * @param  {Object}             callback.downloadInfo           An object containing information necessary for downloading the preview
 * @param  {String}             callback.downloadInfo.filename  The filename to suggest to the client for the download
 * @param  {DownloadStrategy}   callback.downloadInfo.strategy  The DownloadStrategy that details how to download the preview
 */
const getSignedPreviewDownloadInfo = function(ctx, contentId, revisionId, previewItem, signatureData, callback) {
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'Missing content ID'
    })(contentId);

    unless(isResourceId, {
      code: 400,
      msg: 'Missing revision ID'
    })(revisionId);

    unless(isNotEmpty, {
      code: 400,
      msg: 'Missing preview item'
    })(previewItem);
  } catch (error) {
    return callback(error);
  }

  if (!Signature.verifyExpiringResourceSignature(ctx, contentId, signatureData.expires, signatureData.signature)) {
    return callback({ code: 401, msg: 'Invalid content signature data for accessing previews' });
  }

  ContentDAO.Previews.getContentPreview(revisionId, previewItem, (err, preview) => {
    if (err) {
      return callback(err);
    }

    const downloadStrategy = ContentUtil.getStorageBackend(ctx, preview.uri).getDownloadStrategy(
      ctx.tenant().alias,
      preview.uri
    );
    return callback(null, { filename: previewItem, strategy: downloadStrategy });
  });
};

/**
 * Get the revisions for a revision
 *
 * @param  {Context}     ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}      contentId           The id of the content item to get the previews for
 * @param  {String}      revisionId          The id of the revision to get the previews for
 * @param  {Function}    callback            Standard callback function
 * @param  {Object}      callback.err        An error that occurred, if any
 * @param  {Object}      callback.results    Object with a key `files` that holds an array of strings that are the filenames for previews and a key `signature` which holds the signature and expires parameters that should be sent when retrieving the preview bodies.
 */
const getPreviewItems = function(ctx, contentId, revisionId, callback) {
  getContent(ctx, contentId, (err, content) => {
    if (err) {
      return callback(err);
    }

    ContentDAO.Previews.getContentPreviews(revisionId, (err, previews) => {
      if (err) {
        return callback(err);
      }

      // Generate an expiring signature
      const signature = Signature.createExpiringResourceSignature(ctx, content.id);
      const result = {
        files: previews,
        signature
      };

      callback(null, result);
    });
  });
};

/**
 * Update a content item. This can only be done by the manager of that piece of content.
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         contentId               The id of the content item to update
 * @param  {Object}         profileFields           Object where the keys represent the profile fields that need to be updated and the values represent the new values for those profile fields e.g. {'displayName': 'New content name', 'description': 'New content description', 'visibility': 'private'}
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Content}        callback.newContentObj  The updated content item
 */
const updateContentMetadata = function(ctx, contentId, profileFields, callback) {
  callback = callback || function() {};

  const fieldNames = profileFields ? _.keys(profileFields) : [];
  // Parameter validation
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A content id must be provided'
    })(contentId);

    // Check that at a minimum name or description have been provided
    unless(isArrayNotEmpty, {
      code: 400,
      msg: 'You should at least specify a new displayName, description, visibility or link'
    })(fieldNames);

    fieldNames.forEach(fieldName => {
      unless(isIn, {
        code: 400,
        msg: fieldName + ' is not a recognized content profile field'
      })(fieldName, [DISPLAY_NAME, DESCRIPTION, VISIBILITY, LINK]);

      const fieldIsDisplayName = equals(fieldName, DISPLAY_NAME);
      const fieldIsDescription = and(equals(fieldName, DESCRIPTION), profileFields.description);
      const fieldIsLink = equals(fieldName, LINK);

      unless(bothCheck(fieldIsDisplayName, isNotEmpty), {
        code: 400,
        msg: 'A display name cannot be empty'
      })(profileFields.displayName);

      unless(bothCheck(fieldIsDisplayName, isShortString), {
        code: 400,
        msg: 'A display name can be at most 1000 characters long'
      })(profileFields.displayName);

      unless(bothCheck(fieldIsDescription, isMediumString), {
        code: 400,
        msg: 'A description can only be 10000 characters long'
      })(profileFields.description);

      unless(bothCheck(fieldIsLink, isUrl), {
        code: 400,
        msg: 'A valid link should be provided'
      })(profileFields.link);
    });

    const fieldIsVisibility = Boolean(profileFields.visibility);
    unless(bothCheck(fieldIsVisibility, isIn), {
      code: 400,
      msg: 'An invalid content visibility option has been provided. This can be "private", "loggedin" or "public"'
    })(profileFields.visibility, _.values(AuthzConstants.visibility));

    unless(isLoggedInUser, {
      code: 401,
      msg: 'You have to be logged in to be able to update a content item'
    })(ctx);
  } catch (error) {
    return callback(error);
  }

  // First check whether or not the current user is a manager of the piece of content
  _canManage(ctx, contentId, (err, oldContentObj) => {
    if (err) {
      return callback(err);
    }

    if (profileFields.link) {
      if (oldContentObj.resourceSubType !== 'link') {
        return callback({ code: 400, msg: 'This piece of content is not a link' });
      }

      if (profileFields.link !== oldContentObj.link) {
        // Reset the previews object so we don't show the old preview items while the new link is still being processed
        profileFields.previews = { status: ContentConstants.previews.PENDING };
      }
    }

    ContentDAO.Content.updateContent(oldContentObj, profileFields, true, (err, newContentObj) => {
      if (err) {
        return callback(err);
      }

      emitter.emit(ContentConstants.events.UPDATED_CONTENT, ctx, newContentObj, oldContentObj);

      // Add the isManager, createdBy, .. properties.
      _getFullContentProfile(ctx, newContentObj, true, callback);
    });
  });
};

// TODO: Split this out once we reorganize the content API
/// ////////////////////////
// Comment functionality //
/// ////////////////////////

/**
 * Create a new comment on a content item. Returns an error if saving the comment goes wrong or the user doesn't have access.
 * Only logged in users who can see the content are able to post comments.
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}     contentId                   The id of the content item to which to post the comment
 * @param  {String}     body                        The body of the comment
 * @param  {String}     [replyToCreatedTimestamp]   The timestamp of the comment to which this comment is a reply. Not specifying this will create a top level comment
 * @param  {Function}   [callback]                  Standard callback function
 * @param  {Object}     [callback.err]              An error that occurred, if any
 * @param  {Comment}    [callback.comment]          The created comment
 */
const createComment = function(ctx, contentId, body, replyToCreatedTimestamp, callback) {
  callback = callback || function() {};

  // Parameter validation
  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'Only authorized users can post comments'
    })(ctx);

    unless(isResourceId, {
      code: 400,
      msg: 'Invalid content resource id provided'
    })(contentId);

    unless(isNotEmpty, {
      code: 400,
      msg: 'A comment must be provided'
    })(body);

    unless(isLongString, {
      code: 400,
      msg: 'A comment can only be 100000 characters long'
    })(body);

    unless(bothCheck(both(isNotEmpty, isDefined)(replyToCreatedTimestamp), isInt), {
      code: 400,
      msg: 'Invalid reply-to timestamp provided'
    })(replyToCreatedTimestamp);
  } catch (error) {
    return callback(error);
  }

  // Verify the user has access to the content object
  getContent(ctx, contentId, (err, contentObj) => {
    if (err) {
      return callback(err);
    }

    MessageBoxAPI.createMessage(
      contentId,
      ctx.user().id,
      body,
      { replyToCreated: replyToCreatedTimestamp },
      (err, message) => {
        if (err) {
          return callback(err);
        }

        // Get a UI-appropriate representation of the current user
        PrincipalsUtil.getPrincipal(ctx, ctx.user().id, (err, createdBy) => {
          if (err) {
            return callback(err);
          }

          message.createdBy = createdBy;
          emitter.emit(ContentConstants.events.CREATED_COMMENT, ctx, message, contentObj);
          return callback(null, message);
        });
      }
    );
  });
};

/**
 * Get the comments for a content item. Everyone who has access to the content item will be able to retrieve the list of comments.
 *
 * @param  {Context}    ctx                  Standard context object containing the current user and the current tenant
 * @param  {String}     contentId            The id of the content item for which to get the comments
 * @param  {String}     start                The comments paging token from which to start fetching comments
 * @param  {Number}     limit                The maximum number of results to return. Default: 10
 * @param  {Function}   callback             Standard callback function
 * @param  {Object}     callback.err         An error that occurred, if any
 * @param  {Comment[]}  callback.comments    The comments on the content item
 * @param  {String}     callback.nextToken   The value to provide in the `start` parameter to get the next set of results
 */
const getComments = function(ctx, contentId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  // Parameter validation
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'Invalid content resource id provided'
    })(contentId);

    unless(isANumber, {
      code: 400,
      msg: 'A valid limit should be passed in'
    })(limit);
  } catch (error) {
    return callback(error);
  }

  // eslint-disable-next-line no-unused-vars
  getContent(ctx, contentId, (err, contentObj) => {
    if (err) {
      return callback(err);
    }

    MessageBoxAPI.getMessagesFromMessageBox(contentId, start, limit, null, (err, comments, nextToken) => {
      if (err) {
        return callback(err);
      }

      // Get information on the commenters
      const userIds = _.chain(comments)
        .pluck('createdBy')
        .compact()
        .uniq()
        .value();

      // Get the basic principal profiles of the commenters to add to the comments as `createdBy`.
      PrincipalsUtil.getPrincipals(ctx, userIds, (err, principals) => {
        if (err) {
          return callback(err);
        }

        _.each(comments, comment => {
          const principal = principals[comment.createdBy];
          if (principal) {
            comment.createdBy = principal;
          }
        });

        return callback(err, comments, nextToken);
      });
    });
  });
};

/**
 * Delete a comment from a content item. Managers of the content can delete all comments whilst people that have access
 * to the content can only delete their own comments. Therefore, anonymous users will never be able to delete comments.
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     contentId               The id of the content item from which to delete the comment
 * @param  {String}     commentCreatedDate      The timestamp of the comment that should be deleted
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Comment}    [callback.softDeleted]  When the comment has been soft deleted (because it has replies), a stripped down comment object representing the deleted comment will be returned, with the `deleted` parameter set to `false`. If the comment has been deleted from Cassandra, no comment object will be returned.
 */
const deleteComment = function(ctx, contentId, commentCreatedDate, callback) {
  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'Only authorized users can delete comments'
    })(ctx);

    unless(isResourceId, {
      code: 400,
      msg: 'A content id must be provided'
    })(contentId);

    unless(isInt, {
      code: 400,
      msg: 'A valid integer comment created timestamp must be specified'
    })(commentCreatedDate);
  } catch (error) {
    return callback(error);
  }

  getContent(ctx, contentId, (err, content) => {
    if (err) {
      return callback(err);
    }

    MessageBoxAPI.getMessages(contentId, [commentCreatedDate], null, (err, messages) => {
      if (err) {
        return callback(err);
      }

      if (_.isEmpty(messages) || !messages[0]) {
        return callback({ code: 404, msg: 'The specified comment does not exist' });
      }

      // Ensure the user has access to manage the message
      const message = messages[0];
      AuthzPermissions.canManageMessage(ctx, content, message, err => {
        if (err) {
          return callback(err);
        }

        return _deleteComment(ctx, content, message, callback);
      });
    });
  });
};

/**
 * Delete the comment (either hard or soft, depending on if there are any replies) with the given timestamp from the
 * message box with the given id.
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {Content}        content                 The content object on which a comment should be deleted
 * @param  {Message}        commentToDelete         The comment to delete
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Message}        [callback.comment]      If the comment was soft-deleted, this will be the model of the scrubbed deleted comment
 */
const _deleteComment = function(ctx, content, commentToDelete, callback) {
  const messageBoxId = content.id;
  // Delete the comment using the "leaf" method, which will SOFT delete if the message has replies, or HARD delete if it does not
  MessageBoxAPI.deleteMessage(
    messageBoxId,
    commentToDelete.created,
    { deleteType: MessageBoxConstants.deleteTypes.LEAF },
    (err, deleteType, deletedComment) => {
      if (err) {
        return callback(err);
      }

      // If the comment was hard deleted, it is not returned from the delete message endpoint. However if there is a soft delete and
      // it is returned, we want to return the new version of the comment
      deletedComment = deletedComment || commentToDelete;

      // Notify consumers that the comment was deleted
      emitter.emit(ContentConstants.events.DELETED_COMMENT, ctx, deletedComment, content, deleteType);

      if (deleteType === MessageBoxConstants.deleteTypes.SOFT) {
        // If a soft-delete occurred, we want to inform the consumer of the soft-delete message model
        return callback(null, deletedComment);
      }

      return callback();
    }
  );
};

/// ////////////////////////
// Library functionality //
/// ////////////////////////

/**
 * Get the content library items for a user or group. If the user requests their own library or the library of a group they're a member of,
 * the full list will be returned. If the user is logged in but not a manager of the library, the :loggedin stream will be returned, containing
 * only content that's visible to logged in people or the public. In case of an anonymous user, the :public stream will be returned, containing
 * only content that is public
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         principalId         The id of the principal whose content library to fetch
 * @param  {String}         start               The content paging token from which to start fetching content items. If not provided, the first x elements will be returned
 * @param  {Number}         limit               The maximum number of results to return. Default: 10
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Content[]}      callback.content    The content library items for the specified user or group
 * @param  {String}         callback.nextToken  The value to provide in the `start` parameter to get the next set of results
 */
const getContentLibraryItems = function(ctx, principalId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    unless(isPrincipalId, {
      code: 400,
      msg: 'A user or group id must be provided'
    })(principalId);

    unless(isANumber, {
      code: 400,
      msg: 'A valid limit should be passed in'
    })(limit);
  } catch (error) {
    return callback(error);
  }

  // Get the principal
  PrincipalsDAO.getPrincipal(principalId, (err, principal) => {
    if (err) {
      return callback(err);
    }

    // Determine which library visibility we need to fetch
    LibraryAPI.Authz.resolveTargetLibraryAccess(ctx, principal.id, principal, (err, hasAccess, visibility) => {
      if (err) {
        return callback(err);
      }

      if (!hasAccess) {
        return callback({ code: 401, msg: 'You do not have access to this library' });
      }

      ContentDAO.Content.getContentLibraryItems(
        principalId,
        visibility,
        start,
        limit,
        (err, contentObjects, nextToken) => {
          if (err) {
            return callback(err);
          }

          _.each(contentObjects, contentObj => {
            ContentUtil.augmentContent(ctx, contentObj);
          });

          // Emit an event indicating that the content library has been retrieved
          emitter.emit(
            ContentConstants.events.GET_CONTENT_LIBRARY,
            ctx,
            principalId,
            visibility,
            start,
            limit,
            contentObjects
          );

          return callback(null, contentObjects, nextToken);
        }
      );
    });
  });
};

/// ////////////
// Revisions //
/// ////////////

/**
 * Get the revisions for a content item
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         contentId           The id of the content item to get the revisions for
 * @param  {Number}         [start]             The revision paging token from which to start fetching revisions
 * @param  {Number}         [limit]             The maximum number of results to return. Default: 10
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Revision[]}     callback.revisions  The revisions for the specified content item
 * @param  {String}         callback.nextToken  The value to provide in the `start` parameter to get the next set of results
 */
const getRevisions = function(ctx, contentId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A contentId must be provided'
    })(contentId);

    unless(isANumber, {
      code: 400,
      msg: 'A valid limit should be passed in'
    })(limit);
  } catch (error) {
    return callback(error);
  }

  // Check if the user has access on this contentId
  getContent(ctx, contentId, (err, contentObj) => {
    if (err) {
      return callback(err);
    }

    // All columns except etherpadHtml
    const opts = {
      fields: [
        'contentId',
        'created',
        'createdBy',
        'filename',
        'mediumUri',
        'mime',
        'previews',
        'previewsId',
        'revisionId',
        'size',
        'thumbnailUri',
        'uri',
        'wideUri'
      ]
    };

    return _getRevisions(ctx, contentObj, start, limit, opts, callback);
  });
};

/**
 * Internal method that retrieves revisions and augments them with the principal profile who created it.
 * This method performs no access checks.
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {Content}        contentObj          The content object for which we need to retrieve the revisions.
 * @param  {Number}         [start]             The revision paging token from which to start fetching revisions
 * @param  {Number}         [limit]             The maximum number of results to return. Default: 10
 * @param  {Object}         [opts]              Additional options
 * @param  {String[]}       [opts.fields]       The columns to get from cassandra if not specified all will be fetched
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Revision[]}     callback.revisions  Array that contains an object for each revision.
 * @param  {String}         callback.nextToken  The value to provide in the `start` parameter to get the next set of results
 * @api private
 */
const _getRevisions = function(ctx, contentObj, start, limit, opts, callback) {
  // Page the query.
  ContentDAO.Revisions.getRevisions(contentObj.id, start, limit, opts, (err, revisions, nextToken) => {
    if (err) {
      return callback(err);
    }

    const userIds = _.map(revisions, revisions => {
      return revisions.createdBy;
    });
    PrincipalsUtil.getPrincipals(ctx, userIds, (err, users) => {
      if (err) {
        return callback(err);
      }

      // Add the user profiles to the revisions.
      _.each(revisions, revision => {
        if (users[revision.createdBy]) {
          revision.createdBy = users[revision.createdBy];
          _augmentRevision(ctx, revision, contentObj);
        }
      });

      return callback(null, revisions, nextToken);
    });
  });
};

/**
 * Get a revision
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         contentId           The id of the content item to get the revision for
 * @param  {String}         [revisionId]        The id of the revision to get. If unspecified, the latest revision will be retrieved
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Revision}       callback.revision   The revision
 */
const getRevision = function(ctx, contentId, revisionId, callback) {
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A valid contentId must be provided'
    })(contentId);

    const revisionIdIsDefined = Boolean(revisionId);
    unless(bothCheck(revisionIdIsDefined, isResourceId), {
      code: 400,
      msg: 'A valid revisionId must be provided'
    })(revisionId);
  } catch (error) {
    return callback(error);
  }

  // Check if the user has access to this content item
  getContent(ctx, contentId, (err, content) => {
    if (err) {
      return callback(err);
    }

    // The user has access, get the revision and augment it with a downloadload link
    // if this piece of content is a file
    return _getRevision(ctx, content, revisionId, callback);
  });
};

/**
 * Get the download strategy information for downloading a revision
 *
 * @param  {Context}            ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}             contentId                       The id of the content item for which we want to get the revision download information
 * @param  {String}             [revisionId]                    The id of the revision whose download information to retrieve. If unspecified, the latest revision download information will be retrieved
 * @param  {Function}           callback                        Standard callback function
 * @param  {Object}             callback.err                    An error that occurred, if any
 * @param  {Object}             callback.downloadInfo           An object containing information necessary for downloading the revision
 * @param  {String}             callback.downloadInfo.filename  The filename to suggest to the client for the download
 * @param  {DownloadStrategy}   callback.downloadInfo.strategy  The DownloadStrategy that details how to download the revision
 */
const getRevisionDownloadInfo = function(ctx, contentId, revisionId, callback) {
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A valid contentId must be provided'
    })(contentId);

    unless(bothCheck(Boolean(revisionId), isResourceId), {
      code: 400,
      msg: 'A valid revisionId must be provided'
    })(revisionId);
  } catch (error) {
    return callback(error);
  }

  // Check if the user has access to this content item
  getContent(ctx, contentId, (err, content) => {
    if (err) {
      return callback(err);
    }

    if (content.resourceSubType !== 'file') {
      return callback({ code: 400, msg: 'Only file content items can be downloaded' });
    }

    // Ensure we can resolve a revision id
    revisionId = revisionId || content.latestRevisionId;
    if (!revisionId) {
      return callback({
        code: 400,
        msg: 'No revision id provided and content item does not have a latest revision id'
      });
    }

    // Get the revision that the user wishes to download
    ContentDAO.Revisions.getRevision(revisionId, (err, revision) => {
      if (err) {
        return callback(err);
      }

      if (content.id !== revision.contentId) {
        // It's possible that the user specified a revision id that belonged to a different content item. Yikes!
        return callback({
          code: 400,
          msg: 'The revision id provided is not associated with the specified content item'
        });
      }

      // Emit an event indicating that a content item is downloaded
      emitter.emit(ContentConstants.events.DOWNLOADED_CONTENT, ctx, content, revision);

      return callback(null, {
        filename: revision.filename,
        strategy: ContentUtil.getStorageBackend(ctx, revision.uri).getDownloadStrategy(ctx.tenant().alias, revision.uri)
      });
    });
  });
};

/**
 * Internal method for retrieving a specific revision.
 * It's assumed that the parameters have been properly validated beforehand.
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {Content}        contentObj          The content object for which we need to retrieve a revision.
 * @param  {String}         [revisionId]        The id of the revision to get. If unspecified, the latest will be retrieved
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Revision}       callback.revision   The revision
 * @api private
 */
const _getRevision = function(ctx, contentObj, revisionId, callback) {
  if (revisionId) {
    ContentDAO.Revisions.getRevision(revisionId, (err, revisionObj) => {
      if (err) {
        return callback(err);

        // Double check that this revision is really attached to the specified contentId.
        // This is to counter that someone tries to get the revision of a piece of content he has no access to.
        // Ex: Alice has access to c:cam:aliceDoc but not to c:cam:bobDoc which has revision rev:cam:foo
        // doing getRevision(ctx, 'c:cam:aliceDoc', 'rev:cam:foo', ..) should return this error.
      }

      if (revisionObj.contentId !== contentObj.id) {
        return callback({
          code: 400,
          msg: 'This revision ID is not associated with the specified piece of content.'
        });
      }

      _augmentRevision(ctx, revisionObj, contentObj);
      return callback(null, revisionObj);
    });
  } else {
    // Get the latest one.
    _getRevisions(ctx, contentObj, null, 1, null, (err, revisions) => {
      if (err) {
        return callback(err);
      }

      if (_.isEmpty(revisions)) {
        return callback({ code: 404, msg: 'No revision found for ' + contentObj.id });
      }

      // There is no need to augment the revisions here as that has already happened
      return callback(null, revisions[0]);
    });
  }
};

/**
 * Convert the given revision to a model that can be returned to the consumer from the API
 *
 * @param  {Context}    ctx         Standard context object containing the current user and the current tenant
 * @param  {Revision}   revision    The revision to augment
 * @param  {Content}    contentObj  The content object that the revision is attached to
 * @api private
 */
// eslint-disable-next-line no-unused-vars
const _augmentRevision = function(ctx, revision, contentObj) {
  // Replace the thumbnail URI with a signed download URL
  if (revision.thumbnailUri) {
    revision.thumbnailUrl = _getPictureDownloadUrlFromUri(ctx, revision.thumbnailUri, revision.id);
    delete revision.thumbnailUri;
  }

  // Replace the medium picture URI with a signed download URL
  if (revision.mediumUri) {
    revision.mediumUrl = _getPictureDownloadUrlFromUri(ctx, revision.mediumUri, revision.id);
    delete revision.mediumUri;
  }
};

/**
 * Takes a revision and makes it the "current" revision by creating a new one and copying the existing revision's fields.
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         contentId           The id of the content item to restore the revision for
 * @param  {String}         revisionId          The id of the revision to restore
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Revision}       callback.revision   The restored revision
 */
const restoreRevision = function(ctx, contentId, revisionId, callback) {
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'A valid contentId must be provided'
    })(contentId);

    unless(isResourceId, {
      code: 400,
      msg: 'A valid revisionId must be provided'
    })(revisionId);
  } catch (error) {
    return callback(error);
  }

  // Make sure the user is a manager of this piece of content and the revision exists.
  _canManage(ctx, contentId, (err, contentObj) => {
    if (err) {
      return callback(err);
    }

    ContentDAO.Revisions.getRevision(revisionId, (err, revision) => {
      if (err) {
        return callback(err);
      }

      if (contentObj.id !== revision.contentId) {
        return callback({
          code: 400,
          msg: 'The contentId specified is not the owner of the specified revisionId'
        });
      }

      // Create a new revision by copying from the specified revision
      const newRevisionId = _generateRevisionId(contentId);
      ContentDAO.Revisions.createRevision(newRevisionId, contentId, ctx.user().id, revision, (err, newRevision) => {
        if (err) {
          return callback(err);
        }

        /*!
         * We need to update the content item in the Content CF.
         * We do so by copying all the non-standard fields from the revision
         * to the Content CF.
         */
        const blacklist = [
          'revisionId',
          'contentId',
          'createdBy',
          'created',
          'etherpadHtml',
          'previewsId',
          'downloadPath'
        ];
        const updates = _.omit(revision, blacklist);

        // We also need to update the latest revisionID in the content CF.
        updates.latestRevisionId = newRevisionId;

        ContentDAO.Content.updateContent(contentObj, updates, true, (err, newContentObj) => {
          if (err) {
            return callback(err);
          }

          // Provide user-level data such as signed URLs for the consumer
          _augmentRevision(ctx, newRevision, newContentObj);

          // Emit an event
          emitter.emit(ContentConstants.events.RESTORED_REVISION, ctx, newContentObj, contentObj, revision);

          // If this piece of content is a collaborative document,
          // we need to set the text in etherpad.
          if (ContentUtils.isResourceACollabDoc(contentObj.resourceSubType)) {
            Etherpad.setHTML(contentObj.id, contentObj.etherpadPadId, revision.etherpadHtml, err => {
              if (err) {
                return callback(err);
              }

              return callback(null, newRevision);
            });
          } else {
            return callback(null, newRevision);
          }
        });
      });
    });
  });
};

/**
 * Verifies if a uri and signature match up and returns an object that the REST handlers can use to redirect users
 * to the actual download page.
 *
 * @param  {Context}            ctx                             Standard context object containing the current user and the current tenant
 * @param  {Object}             qs                              The query string object of the download request as generated by `ContenUtil.getSignedDownloadUrl`
 * @param  {Object}             callback.err                    An error that occurred, if any
 * @param  {Object}             callback.downloadInfo           An object containing information necessary for downloading the signed download
 * @param  {String}             callback.downloadInfo.filename  The filename to suggest to the client for the download
 * @param  {DownloadStrategy}   callback.downloadInfo.strategy  The DownloadStrategy that details how to download the file
 */
const verifySignedDownloadQueryString = function(ctx, qs, callback) {
  const uri = ContentUtil.verifySignedDownloadQueryString(qs);
  if (!uri) {
    return callback({ code: 401, msg: 'Invalid signature data for the provided download url' });
  }

  const downloadStrategy = ContentUtil.getStorageBackend(ctx, uri).getDownloadStrategy(ctx.tenant().alias, uri);
  return callback(null, { strategy: downloadStrategy, filename: basename(uri) });
};

/// ////////////////////
// Utility functions //
/// ////////////////////

/**
 * Store the preview reference (if necessary), producing the backend URI that can be used to
 * download it afterward.
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String|Stream}  previewReference    Either a string indicating the external URL of the preview, or a stream indicating its location on disk for upload to back-end storage
 * @param  {Object}         [options]           The storage options indicating the `resourceId` of the content object and the storage prefix. Only applicable if the preview reference is a stream
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {String}         callback.uri        The URI to use to reference this preview in the future
 * @api private
 */
const _storePreview = function(ctx, previewReference, options, callback) {
  if (_.isString(previewReference)) {
    // If the reference is a string, it is simply an external link to some file. We will use a remote uri
    // to reference it
    return callback(null, 'remote:' + previewReference);
  }

  // Otherwise, it is expected to be a stream reference to a file on disk, in which case we want to store it
  // using the tenant default storage mechanism
  ContentUtil.getStorageBackend(ctx).store(ctx.tenant().alias, previewReference, options, callback);
};

/**
 * Get the download url from a storage uri
 *
 * @param  {Context}    ctx         Standard context object containing the current user and the current tenant
 * @param  {String}     uri         The storage URI
 * @param  {String}     [parentId]  For logging purposes, the owner of this URI in case the URI is invalid
 * @return {String}                 A reference that can be used directly in a link to download the file
 * @api private
 */
const _getPictureDownloadUrlFromUri = function(ctx, uri, parentId) {
  try {
    return ContentUtil.getSignedDownloadUrl(ctx, uri);
  } catch {
    // The backend was probably not found, we will fail safely here
    log(ctx).warn({ parentId }, 'Could not find storage backend for uri: %s', uri);
    return null;
  }
};

/**
 * Create a permission change object with the provided member ids whose roles are all set to the
 * provided `role`
 *
 * @param  {String[]}           memberIds   The ids of the members for whom to make the permission changes
 * @param  {String|Boolean}     role        The role to apply, or `false` if the intention is to remove the member from the content item
 * @return {Object}                         An object whose keys are the member ids and values are the specified role
 * @api private
 */
// eslint-disable-next-line no-unused-vars
const _makeAllPermissionChanges = function(memberIds, role) {
  const roleChanges = {};
  _.each(memberIds, memberId => {
    roleChanges[memberId] = role;
  });
  return roleChanges;
};

/**
 * Generates a new content ID.
 *
 * @param  {String}     tenantAlias     The tenant alias for the content item
 * @return {String}                     The new content ID.
 * @api private
 */
const _generateContentId = function(tenantAlias) {
  return AuthzUtil.toId('c', tenantAlias, ShortId.generate());
};

/**
 * Generates a new revision ID for a content item by ID.
 *
 * @param  {String}     contentId   The ID of the content item for which to generate a new revision ID
 * @return {String}                 The new revision ID
 * @api private
 */
const _generateRevisionId = function(contentId) {
  const { tenantAlias } = AuthzUtil.getResourceFromId(contentId);
  return AuthzUtil.toId('rev', tenantAlias, ShortId.generate());
};

export {
  getContent,
  getFullContentProfile,
  createLink,
  createFile,
  createCollabSheet,
  createCollabDoc,
  handlePublish,
  joinCollabDoc,
  deleteContent,
  shareContent,
  setContentPermissions,
  removeContentFromLibrary,
  getContentMembersLibrary,
  getContentInvitations,
  resendContentInvitation,
  updateFileBody,
  setPreviewItems,
  getSignedPreviewDownloadInfo,
  getPreviewItems,
  updateContentMetadata,
  createComment,
  getComments,
  deleteComment,
  getContentLibraryItems,
  getRevisions,
  getRevision,
  getRevisionDownloadInfo,
  restoreRevision,
  verifySignedDownloadQueryString,
  ethercalcPublish,
  emitter
};
