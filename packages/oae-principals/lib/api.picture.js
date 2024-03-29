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

import fs from 'node:fs';
import { format } from 'node:util';
import _ from 'underscore';
import mime from 'mime';

import { logger } from 'oae-logger';

import * as AuthzPermissions from 'oae-authz/lib/permissions.js';
import * as ContentUtil from 'oae-content/lib/internal/util.js';
import * as ImageUtil from 'oae-util/lib/image.js';
import { Validator as validator } from 'oae-util/lib/validator.js';
import { compose, curry, __, pipe } from 'ramda';
import * as GroupAPI from './api.group.js';
import * as PrincipalsDAO from './internal/dao.js';
import PrincipalsEmitter from './internal/emitter.js';
import * as PrincipalsUtil from './util.js';

import { PrincipalsConstants } from './constants.js';

const {
  validateInCase: bothCheck,
  unless,
  isLoggedInUser,
  isPrincipalId,
  isNotNull,
  isNotEmpty,
  isZeroOrGreater,
  isInt
} = validator;

const log = logger('oae-principals-shared');

const toInt = curry(parseInt)(__, 10);
const zeroOrGreater = pipe(String, toInt, isZeroOrGreater);

/**
 * Store the large picture for a principal that can be re-used later on
 *
 * @param  {Context}        ctx                 Current execution context
 * @param  {String}         principalId         The id of the group to store the large picture for
 * @param  {File}           file                An object representing the picture being upload and where to find it on disk
 * @param  {String}         file.name           The name of the file you wish to store
 * @param  {String}         file.type           The mimetype of the file. Only the following mimetypes can be stored: 'image/jpg', 'image/jpeg', 'image/png', 'image/gif' or 'image/bmp'
 * @param  {String}         file.path           The path on disk where the file is stored
 * @param  {Number}         file.size           The filesize. A maximum of 10MB is imposed
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Group|User}     callback.principal  The basic profile of the user or group whose picture was stored
 */
const storePicture = function (ctx, principalId, file, callback) {
  callback =
    callback ||
    function (error) {
      if (error) {
        log().error({ err: error }, 'Unable to store picture %s for %s', file.path, principalId);
      }
    };

  try {
    const message = 'You have to be logged in to be able to update a picture';
    unless(isLoggedInUser, { code: 401, msg: message })(ctx);

    unless(isPrincipalId, {
      code: 400,
      msg: 'A principal ID must be provided'
    })(principalId);

    unless(isNotNull, {
      code: 400,
      msg: 'A file must be provided'
    })(file);

    const fileIsThere = Boolean(file);
    unless(bothCheck(fileIsThere, compose(isNotEmpty, String)), {
      code: 400,
      msg: 'Missing size on the file object.'
    })(file.size);

    const UPLOAD_LIMIT = 10_485_760;
    unless(
      bothCheck(fileIsThere, (size, max) => size <= max),
      {
        code: 400,
        msg: 'The size of a picture has an upper limit of 10MB.'
      }
    )(file.size, UPLOAD_LIMIT);

    unless(bothCheck(fileIsThere, isNotEmpty), {
      code: 400,
      msg: 'Missing name on the file object.'
    })(file.name);
  } catch (error) {
    return _cleanupOnError(error, file, callback);
  }

  // Check if we can edit this principal
  // eslint-disable-next-line no-unused-vars
  _canManagePrincipal(ctx, principalId, (error, principal) => {
    if (error) {
      return _cleanupOnError(error, file, callback);
    }

    // Detect the mimetype of the file using the file extension, as the one that Express gives us is pulled
    // from the HTTP request. This makes it an untrustworthy piece of information as some browsers are
    // notoriously bad at providing the correct mimetype and it can be spoofed. If the mimetype cannot
    // be determined, the mime utility falls back to application/octet-stream.
    file.type = mime.getType(file.name);

    // Only images can be uploaded
    if (!_.contains(['image/jpg', 'image/jpeg', 'image/gif', 'image/png', 'image/bmp'], file.type)) {
      return callback({ code: 400, msg: 'Only images are accepted files' });
    }

    // Now store and attach the new one
    _storeLargePicture(ctx, principalId, file, (error_) => {
      if (error_) {
        return _cleanupOnError(error_, file, callback);
      }

      return PrincipalsUtil.getPrincipal(ctx, principalId, callback);
    });
  });
};

/**
 * Stores a large picture for a principal and attaches it to the User or Group object in Cassandra. This function
 * assumes that all the parameters have been validated previously. It will auto orient the picture so it can be
 * displayed correctly in all browsers.
 *
 * @param  {Context}        ctx                 Current execution context
 * @param  {String}         principalId         The id of the principal for which we will store the large picture
 * @param  {File}           file                The file to store
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @api private
 */
const _storeLargePicture = function (ctx, principalId, file, callback) {
  // Auto orient the picture so we can display it in the browser.
  ImageUtil.autoOrient(file.path, { removeInput: true }, (error, orientedFile) => {
    if (error) {
      return _cleanupOnError(error, file, callback);
    }

    // Convert it to a JPG
    ImageUtil.convertToJPG(orientedFile.path, (error, convertedFile) => {
      if (error) {
        return _cleanupOnError(error, file, callback);
      }

      // Store the oriented file
      const options = _getProfilePictureStorageOptions(principalId, Date.now(), 'large', '.jpg');
      ContentUtil.getStorageBackend(ctx).store(ctx.tenant().alias, convertedFile, options, (error, largePictureUri) => {
        if (error) {
          return _cleanupOnError(error, convertedFile, callback);
        }

        // By this point the temp file has been removed from disk, no need to clean up in error cases below
        return PrincipalsDAO.updatePrincipal(principalId, { largePictureUri }, callback);
      });
    });
  });
};

/**
 * Crops a square out of the large picture attached to a principal and generates
 * a small and medium sized version of that square.
 *
 * @param  {Context}     ctx                 Current execution context
 * @param  {String}      principalId         The ID of the principal to crop the large picture for
 * @param  {Number}      x                   The x coordinate of the top left corner to start cropping at
 * @param  {Number}      y                   The y coordinate of the top left corner to start cropping at
 * @param  {Number}      width               The width of the square that needs to be cropped out
 * @param  {Function}    callback            Standard callback function
 * @param  {Object}      callback.err        An error that occurred, if any
 * @param  {Group|User}  callback.principal  If the principal for which we cropped the picture was a user, it will be the user's basic profile. If a group, it will be the full group profile
 */
const generateSizes = function (ctx, principalId, x, y, width, callback) {
  callback =
    callback ||
    function (error) {
      if (error) {
        // eslint-disable-next-line no-undef
        log().error({ err: error }, 'Unable to crop picture %s for %s', fileUri, principalId);
      }
    };

  // Parameter validation
  try {
    unless(isLoggedInUser, {
      code: 401,
      msg: 'You have to be logged in to be able to update a picture'
    })(ctx);

    unless(isPrincipalId, {
      code: 400,
      msg: 'A principal id must be provided'
    })(principalId);

    unless(compose(isInt, String), {
      code: 400,
      msg: 'The x value must be a positive integer'
    })(x);

    unless(zeroOrGreater, {
      code: 400,
      msg: 'The x value must be a positive integer'
    })(x);

    unless(compose(isInt, String), {
      code: 400,
      msg: 'The y value must be a positive integer'
    })(y);

    unless(zeroOrGreater, {
      code: 400,
      msg: 'The y value must be a positive integer'
    })(y);

    unless(compose(isInt, String), {
      code: 400,
      msg: 'The width value must be a positive integer'
    })(width);

    unless(compose(isInt, String), {
      code: 400,
      msg: 'The width value must be a positive integer greater than or equal to 10'
    })(width, { gt: 9 });
  } catch (error) {
    return callback(error);
  }

  // Make sure we can edit this principal
  _canManagePrincipal(ctx, principalId, (error, principal) => {
    if (error) {
      return callback(error);
    }

    if (!principal.picture.largeUri) {
      return callback({ code: 400, msg: 'This principal has no large picture' });
    }

    // Generate and store the sizes
    _generateSizes(ctx, principal, x, y, width, (error, principal) => {
      if (error) {
        return callback(error);
      }

      if (PrincipalsUtil.isUser(principalId)) {
        // Emit an event indicating that a user's picture has been set
        PrincipalsEmitter.emit(PrincipalsConstants.events.SET_USER_PICTURE, ctx, principal);

        // Return the full user profile
        return PrincipalsUtil.getPrincipal(ctx, principalId, callback);
      }

      // Emit an event indicating that a group's picture has been set
      PrincipalsEmitter.emit(PrincipalsConstants.events.SET_GROUP_PICTURE, ctx, principal);

      // Return the full group profile
      return GroupAPI.getFullGroupProfile(ctx, principalId, callback);
    });
  });
};

/**
 * Internal method that retrieves the large picture attached to this principal, crops out the desired square
 * and scales that square to a small and medium sized verison.
 *
 * @param  {Context}     ctx                 Current execution context
 * @param  {Group|User}  principal           The principal to crop the large picture for
 * @param  {Number}      x                   The x coordinate of the topleft corner to start cropping
 * @param  {Number}      y                   The y coordinate of the topleft corner to start cropping
 * @param  {Number}      width               The width of the square that needs to be cropped out
 * @param  {Function}    callback            Standard callback function
 * @param  {Object}      callback.err        An error that occurred, if any
 * @param  {Group|User}  callback.principal  The updated principal object
 * @api private
 */
const _generateSizes = function (ctx, principal, x, y, width, callback) {
  // Retrieve the raw image.
  ContentUtil.getStorageBackend(ctx, principal.picture.largeUri).get(
    ctx.tenant().alias,
    principal.picture.largeUri,
    (error, file) => {
      if (error) {
        return callback(error);
      }

      // Get the resized images
      const selectedArea = {
        x: Number.parseInt(x, 10),
        y: Number.parseInt(y, 10),
        width: Number.parseInt(width, 10),
        height: Number.parseInt(width, 10)
      };
      const sizes = [
        {
          width: PrincipalsConstants.picture.size.SMALL,
          height: PrincipalsConstants.picture.size.SMALL
        },
        {
          width: PrincipalsConstants.picture.size.MEDIUM,
          height: PrincipalsConstants.picture.size.MEDIUM
        }
      ];
      ImageUtil.cropAndResize(file.path, selectedArea, sizes, (error, files) => {
        // Remove the temp file first
        file.remove((removalError) => {
          if (error) {
            return callback(error);
          }

          if (removalError) {
            return callback(removalError);
          }

          // File removed, store and save the cropped and resized images
          return _storeCroppedPictures(ctx, principal, files, callback);
        });
      });
    }
  );
};

/**
 * Store the resized files and save their URIs on the principal object.
 *
 * @param  {Context}     ctx                 Current execution context
 * @param  {Group|User}  principal           The principal to crop the large picture for
 * @param  {Object}      files               An object with file objects
 * @param  {Function}    callback            Standard callback function
 * @param  {Object}      callback.err        An error that occurred, if any
 * @param  {Group|User}  callback.principal  The updated principal object
 * @api private
 */
const _storeCroppedPictures = function (ctx, principal, files, callback) {
  const backend = ContentUtil.getStorageBackend(ctx);
  const now = Date.now();

  // Get the the small image
  let key = format('%sx%s', PrincipalsConstants.picture.size.SMALL, PrincipalsConstants.picture.size.SMALL);
  const smallImage = files[key];

  // Store the image with a correct filename. We explicitly add a correct extension as nginx uses it
  // to determine the mimetype
  let options = _getProfilePictureStorageOptions(
    principal.id,
    now,
    'small',
    ImageUtil.getImageExtension(smallImage.name, '.jpg')
  );
  backend.store(ctx.tenant().alias, smallImage, options, (error, smallPictureUri) => {
    if (error) {
      return callback(error);
    }

    // Get the medium image, determine the correct extension and store it
    key = format('%sx%s', PrincipalsConstants.picture.size.MEDIUM, PrincipalsConstants.picture.size.MEDIUM);
    const mediumImage = files[key];

    options = _getProfilePictureStorageOptions(
      principal.id,
      now,
      'medium',
      ImageUtil.getImageExtension(mediumImage.name, '.jpg')
    );
    backend.store(ctx.tenant().alias, mediumImage, options, (error, mediumPictureUri) => {
      if (error) {
        return callback(error);
      }

      // Files stored, save them to the DB
      return _saveCroppedPictureUris(ctx, principal, smallPictureUri, mediumPictureUri, callback);
    });
  });
};

/**
 * Saves the small and medium uris to cassandra and sticks them on the Principal Object
 *
 * @param  {Context}     ctx                 Current execution context
 * @param  {Group|User}  principal           The principal object to update
 * @param  {String}      smallPictureUri     The URI for the small image
 * @param  {String}      mediumPictureUri    The URI for the large image
 * @param  {Object}      callback.err        An error that occurred, if any
 * @param  {Group|User}  callback.principal  The updated principal object
 * @api private
 */
const _saveCroppedPictureUris = function (ctx, principal, smallPictureUri, mediumPictureUri, callback) {
  // Apply the updates to the `principal` object
  const profileFields = { smallPictureUri, mediumPictureUri };
  PrincipalsDAO.updatePrincipal(principal.id, profileFields, (error) => {
    if (error) {
      return callback(error);
    }

    // Get the updated principal
    PrincipalsDAO.getPrincipal(principal.id, (error, newPrincipal) => {
      if (error) {
        return callback(error);
      }

      // Fire the appropriate update event, depending if the principal is a user or a group
      if (PrincipalsUtil.isUser(principal.id)) {
        PrincipalsEmitter.emit(PrincipalsConstants.events.UPDATED_USER, ctx, newPrincipal, principal);
      } else {
        PrincipalsEmitter.emit(PrincipalsConstants.events.UPDATED_GROUP, ctx, newPrincipal, principal);
      }

      return callback(null, newPrincipal);
    });
  });
};

/**
 * Checks if the current user can edit the principal. If they cannot edit the principal, a 401 error object
 * will be returned
 *
 * @param  {Context}     ctx                 Current execution context
 * @param  {String}      principalId         The ID of the principal to check
 * @param  {Function}    callback            Standard callback function
 * @param  {Object}      callback.err        An error that occurred, if any
 * @api private
 */
const _canManagePrincipal = function (ctx, principalId, callback) {
  // Ensure the principal exists
  PrincipalsDAO.getPrincipal(principalId, (error, principal) => {
    if (error) {
      return callback(error);
    }

    // Ensure the current user can manage the principal
    AuthzPermissions.canManage(ctx, principal, (error_) => {
      if (error_) {
        return callback(error_);
      }

      return callback(null, principal);
    });
  });
};

/**
 * Given a resource, timestamp, size and extension, return the storage options that will store
 * the resource picture into the appropriate directory
 *
 * @param  {String}         resourceId  The id of the resource for which to store the profile picture
 * @param  {Number|String}  timestamp   The timestamp (millis since the epoch) at which the picture is being stored
 * @param  {String}         size        The size of the picture, one of `small`, `medium` or `large`
 * @param  {String}         extension   The extension of the picture *including* the preceding period (e.g., `.jpg`)
 * @return {Object}                     The storage options object that can be used in the `StorageBackend.store` method
 * @api private
 */
const _getProfilePictureStorageOptions = function (resourceId, timestamp, size, extension) {
  return {
    resourceId,
    prefix: format('profilepictures/%s', timestamp),
    filename: size + extension
  };
};

/**
 * Removes temp file and logs an error statement.
 *
 * @param  {Object}      error           The error
 * @param  {TempFile}    file            The file that needs to be removed
 * @param  {Function}    callback        Standard callback function
 * @param  {Object}      callback.err    An error that occurred, if any
 */
const _cleanupOnError = function (error, file, callback) {
  // If it's a TempFile who has a remove method
  if (file && file.remove) {
    file.remove((error_) => {
      if (error_) {
        log().warn({ err: error_ }, 'Unable to remove an uploaded image.');
      }

      return callback(error);
    });

    // If it's an express file
  } else if (file && file.path) {
    fs.unlink(file.path, (error_) => {
      if (error_) {
        log().warn({ err: error_ }, 'Unable to remove an uploaded image.');
      }

      return callback(error);
    });
  } else {
    return callback(error);
  }
};

export { storePicture, generateSizes };
