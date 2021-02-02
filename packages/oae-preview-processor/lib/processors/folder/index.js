/*
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
import Path from 'path';
import { format } from 'util';
import PreviewConstants from 'oae-preview-processor/lib/constants';
import { logger } from 'oae-logger';
import sharp from 'sharp';
import {
  negate,
  prop,
  lte,
  both,
  propSatisfies,
  pathSatisfies,
  pipe,
  filter,
  concat,
  sortBy,
  reject,
  isNil,
  defaultTo,
  compose,
  isEmpty,
  slice,
  clone,
  not
} from 'ramda';

import { AuthzConstants } from 'oae-authz/lib/constants';
import { Context } from 'oae-context';
import { FoldersConstants } from 'oae-folders/lib/constants';

import * as FoldersAPI from 'oae-folders';
import * as ContentUtil from 'oae-content/lib/internal/util';
const { getStorageBackend } = ContentUtil;
import * as FoldersDAO from 'oae-folders/lib/internal/dao';
import * as LibraryAPI from 'oae-library';
import * as TempFile from 'oae-util/lib/tempfile';

const log = logger('folders-previews');

const MONTAGE_PREVIEW_COLUMNS = 3;
const MONTAGE_PREVIEW_ROWS = 3;
const MONTAGE_NUMBER_PREVIEWS = 9;
const BLANK = Path.resolve(__dirname, '../../../static/link/blank.png');

// Auxiliary functions
const isDefined = Boolean;
const isNotDefined = compose(not, isDefined);
const byNewest = compose(negate, prop('lastModified'));
const withThumbnail = both(
  pathSatisfies(isDefined, ['previews']),
  pathSatisfies(isDefined, ['previews', 'thumbnailUri'])
);

/**
 * Generate preview images for a folder
 *
 * @param  {String}     folderId        The id of the folder for which to generate the preview images
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const generatePreviews = function (folderId, callback) {
  _getData(folderId, (error, folder, contentItems) => {
    if (error) return callback(error);
    /**
     * If there are no content items in this folder we can't generate a thumbnail for it.
     * However, we should set an empty previews object as we might have removed all the content item
     * that were used in the old thumbnail
     */
    if (isEmpty(contentItems)) return FoldersDAO.setPreviews(folder, {}, callback);

    // Generate the preview images
    _generatePreviews(folder, contentItems, (error_) => {
      if (error_) return callback(error_);

      FoldersAPI.emitter.emit(FoldersConstants.events.UPDATED_FOLDER_PREVIEWS, folder);
      return callback();
    });
  });
};

/**
 * Given a folder id, get the folder object and a set of content items
 * that are in it which have preview items
 *
 * @param  {String}         folderId                    The id of the folder to retrieve
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Folder}         callback.folder             The folder object for the given folder id
 * @param  {Content[]}      callback.contentItems       A set of (at most 8) content items that are in the folder and have preview items of their own
 * @api private
 */
const _getData = function (folderId, callback) {
  FoldersDAO.getFolder(folderId, (error, folder) => {
    if (error) return callback(error);

    _getContentWithPreviews(folder, (error, contentItems) => {
      if (error) return callback(error);

      return callback(null, folder, contentItems);
    });
  });
};

/**
 * Get some content items that are part of a folder that have preview items of their own.
 * This function will return as soon as it has found 8 items
 *
 * @param  {Folder}         folder                      The folder for which to retrieve the content items
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Content[]}      callback.contentItems       A set of content items that are in the folder and have preview items
 * @api private
 */
const _getContentWithPreviews = function (folder, callback, _contentWithPreviews, _start) {
  _contentWithPreviews = defaultTo([], _contentWithPreviews);

  FoldersDAO.getContentItems(folder.groupId, { start: _start, limit: 20 }, (error, contentItems, nextToken) => {
    if (error) return callback(error);

    // Only use content items that are implicitly visible to those that can see this folder's library
    const implicitlyVisibleOnly = (contentItem) => {
      // If this content item were inserted into the folder's content library, it would be
      // in this visibility bucket (e.g., a public content item would be in the public
      // library)
      const targetBucketVisibility = LibraryAPI.Authz.resolveLibraryBucketVisibility(folder.id, contentItem);
      const targetBucketVisibilityPriority = AuthzConstants.visibility.ALL_PRIORITY.indexOf(targetBucketVisibility);

      // If a user has access to see this visibility of folder implicitly, then they will
      // get this visibility bucket. E.g., if folder is public, we only use content items
      // from the public visibility bucket (i.e., public content items)
      const implicitBucketVisibility = folder.visibility;
      const implicitBucketVisibilityPriority = AuthzConstants.visibility.ALL_PRIORITY.indexOf(implicitBucketVisibility);

      // Only use content items whose target bucket visibility is visibile within the
      // implicit bucket visibility
      return lte(targetBucketVisibilityPriority, implicitBucketVisibilityPriority);
    };

    // Remove null content items. This can happen if libraries are in an inconsistent
    // state. For example, if an item was deleted from the system but hasn't been removed
    // from the libraries, a `null` value would be returned by `getMultipleContentItems`
    // Add them to the set of items we've already retrieved
    _contentWithPreviews = pipe(
      reject(isNil),
      filter(withThumbnail),
      filter(implicitlyVisibleOnly),
      concat(_contentWithPreviews),
      sortBy(byNewest),
      slice(0, MONTAGE_NUMBER_PREVIEWS)
    )(contentItems);

    if (isNotDefined(nextToken)) {
      /**
       * Once we have exhausted all items and kept only the 8 most recent,
       * we return with our results
       */
      return callback(null, _contentWithPreviews);
    }

    // There are more to list, run recursively
    return _getContentWithPreviews(folder, callback, _contentWithPreviews, nextToken);
  });
};

/**
 * Generate the folder preview images given a set of content items that all
 * have thumbnails of their own. Two images will be generated, one thumbnail
 * containing a 2x2 grid and one wide image containing a 4x2 grid. The old
 * preview images will be removed from the storage backend and the new ones
 * will be persisted.
 *
 * @param  {Folder}         folder              The folder for which to generate the preview images
 * @param  {Content[]}      contentItems        The content items that can be used to generate the folder's preview images
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @api private
 */
const _generatePreviews = function (folder, contentItems, callback) {
  // Retrieve the thumbnails
  const ctx = new Context(folder.tenant);
  _retrieveThumbnails(ctx, contentItems.slice(), (error, paths) => {
    if (error) return callback(error);

    // Construct the montages
    _createMontages(paths, (error, thumbnail, wide) => {
      if (error) return callback(error);

      _removeOldPreviews(ctx, folder, (error_) => {
        if (error_) {
          log().error({ err: error_, folderId: folder.id }, 'Unable to remove the old folder previews');
          return callback(error_);
        }

        _storeNewPreviews(ctx, folder, thumbnail, wide, (error, thumbnailUri, wideUri) => {
          if (error) {
            log().error({ err: error, folderId: folder.id }, 'Unable to store the new folder previews');
            return callback(error);
          }

          // Store the metadata
          const previews = {
            thumbnailUri,
            wideUri
          };
          FoldersDAO.setPreviews(folder, previews, (error_) => {
            /**
             * Clean up any temporary files regardless of whether there was an error storing
             * the previews
             * Depending on which backend was used to store the thumbnail or wide images,
             * those files may or may not already be removed
             */
            _removeAll(paths, () => callback(error_));
          });
        });
      });
    });
  });
};

/**
 * Create 2 montages, a 2x2 grid for the thumbnail and a 4x2 grid for the wide image
 *
 * @param  {String[]}   paths                       An array of paths that point to the images that should be used in the grids
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.thumbnail          A file object representing the thumbnail
 * @param  {String}     callback.thumbnail.path     The path where the thumbnail has been written to
 * @param  {String}     callback.thumbnail.name     The file name of the thumbnail
 * @param  {Number}     callback.thumbnail.size     The size in bytes of the thumbnail
 * @param  {Object}     callback.wide               A file object representing the wide image
 * @param  {String}     callback.wide.path          The path where the wide image has been written to
 * @param  {String}     callback.wide.name          The file name of the wide image
 * @param  {Number}     callback.wide.size          The size in bytes of the wide image
 * @api private
 */
const _createMontages = function (paths, callback) {
  // Generate the thumbnail
  const thumbnailSize = {
    width: PreviewConstants.SIZES.IMAGE.THUMBNAIL,
    height: PreviewConstants.SIZES.IMAGE.THUMBNAIL
  };
  // Generate the wide image
  const wideSize = {
    width: PreviewConstants.SIZES.IMAGE.WIDE_WIDTH,
    height: PreviewConstants.SIZES.IMAGE.WIDE_HEIGHT
  };

  const previewPaths = clone(paths);
  _createMontage(thumbnailSize, paths, (error, squaredThumbnail) => {
    if (error) return callback(error);

    _createMontage(wideSize, previewPaths, (error, wideThumbnail) => {
      if (error) return callback(error);

      return callback(null, squaredThumbnail, wideThumbnail);
    });
  });
};

/**
 * Create a montage for the folder by placing all the images that are located in the `paths`
 * array in a grid. The grid size can be specified with the `tile` parameter. This function
 * assumes that the images that should be used in the grid are squares of 324px by 324px.
 *
 * @param  {Object}     tile                    The size of the grid
 * @param  {Number}     tile.columns            The number of columns in the grid
 * @param  {Number}     tile.rows               The number of rows in the grid
 * @param  {Object}     size                    The desired size of the resulting image
 * @param  {Number}     size.width              The width of the resulting image
 * @param  {Number}     size.height             The height of the resulting image
 * @param  {String}     paths                   An array of paths that point to the images that should be used in the grid
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.file           A file object representing the resulting file
 * @param  {String}     callback.file.path      The path where the montage has been written to
 * @param  {String}     callback.file.name      The name of the montage
 * @param  {Number}     callback.file.size      The size in bytes of the montage
 * @api private
 */
const _createMontage = function (size, paths, callback) {
  const allBuffers = [];

  resizeAllPreviews(paths, size, allBuffers, (error, buffers) => {
    if (error) return callback(error);

    const { width, height } = size;
    const { path } = TempFile.createTempFile({ suffix: `${width}x${height}.jpg` });

    sharp(BLANK)
      .composite(buffers)
      .resize(width, height)
      .toFile(path, (error, info) => {
        if (error) {
          log().error({ err: error }, 'Unable to create folder montage');
          return callback({ code: 500, msg: 'Failed to create folder montage' });
        }

        const file = {
          path,
          size: info.size,
          name: Path.basename(path)
        };

        return callback(error, file);
      });
  });
};

/**
 * @function resizeAllPreviews
 * @param  {Array} paths      Array of paths of previews to composite
 * @param  {Object} size       Object with width and height of final montage
 * @param  {Array} allBuffers Array of buffers of previews properly resized
 * @param  {Function} callback   Standard callback function
 */
const resizeAllPreviews = (paths, size, allBuffers, callback) => {
  if (isEmpty(paths)) return callback(null, allBuffers);

  const nextPreview = paths.shift();

  resizePreview(nextPreview, size, allBuffers.length, (error, data) => {
    if (error) return callback(error);

    allBuffers.push(data);
    resizeAllPreviews(paths, size, allBuffers, callback);
  });
};

/**
 * @function resizePreview
 * @param  {String} path        Path of preview to resize
 * @param  {Object} size        Object containing width and height to resize to
 * @param  {Number} gravity     Gravity is the 3x3 square index (0-8)
 * @param  {Function} callback  Standard callback function
 */
const resizePreview = (path, size, gravity, callback) => {
  sharp(path)
    .resize(Math.floor(size.width / MONTAGE_PREVIEW_COLUMNS), Math.floor(size.height / MONTAGE_PREVIEW_ROWS))
    .toBuffer((error, input /* , info */) => {
      if (error) return callback(error);

      const { top, left } = getMontageCoordinates(gravity, size);

      const preview = {
        input,
        top,
        left
      };

      return callback(null, preview);
    });
};

/**
 * @function getMontageCoordinates
 * @param  {Number} gravity     Gravity is the 3x3 square index (0-8)
 * @param  {Object} size        Object containing width and height to resize to
 */
const getMontageCoordinates = (gravity, size) => {
  const row = Math.floor(gravity / MONTAGE_PREVIEW_ROWS);
  const top = Math.floor((size.height / MONTAGE_PREVIEW_ROWS) * row);

  const column = gravity % MONTAGE_PREVIEW_COLUMNS;
  const left = Math.floor((size.width / MONTAGE_PREVIEW_COLUMNS) * column);
  return { top, left };
};

/**
 * Retrieve the content thumbnails
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {Content[]}      contentItems        The content items whose thumbnails should be retrieved
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {String[]}       callback.paths      The paths where the thumbnails can be found
 * @api private
 */
const _retrieveThumbnails = function (ctx, contentItems, callback, _paths) {
  _paths = defaultTo([], _paths);

  // If there is nothing left to retrieve, we return to the caller
  if (isEmpty(contentItems)) return callback(null, _paths);

  // Retrieve the thumbnail for the next content item. Keep in mind
  // that the order of the `_paths` array is important. So we retrieve
  // thumbnails in the same order as they are in the `contentItems` array
  const contentItem = contentItems.shift();
  getStorageBackend(ctx, contentItem.previews.thumbnailUri).get(
    ctx,
    contentItem.previews.thumbnailUri,
    (error, file) => {
      if (error) return callback(error);

      _paths.push(file.path);
      return _retrieveThumbnails(ctx, contentItems, callback, _paths);
    }
  );
};

/**
 * Remove all the files in the given `paths` array
 *
 * @param  {String[]}   paths       The paths to remove
 * @param  {Function}   callback    Standard callback function
 * @api private
 */
const _removeAll = function (paths, callback) {
  if (isEmpty(paths)) return callback();

  const path = paths.pop();
  fs.unlink(path, (/* err */) => _removeAll(paths, callback));
};

/**
 * Remove the old preview images for a folder
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Folder}     folder          The folder for which to remove the old preview images
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _removeOldPreviews = function (ctx, folder, callback) {
  _removeOldPreview(ctx, folder, 'thumbnailUri', (error) => {
    if (error) return callback(error);

    _removeOldPreview(ctx, folder, 'wideUri', callback);
  });
};

/**
 * Remove an old preview for a folder if it exists
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Folder}     folder          The folder for which to remove the old preview image
 * @param  {String}     type            One of `thumbnailUri` or `wideUri`
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _removeOldPreview = function (ctx, folder, type, callback) {
  const hasPreviews = both(propSatisfies(isDefined, 'previews'), pathSatisfies(isDefined, ['previews', type]));
  if (hasPreviews(folder)) {
    getStorageBackend(ctx).remove(ctx, folder.previews[type], callback);
  } else {
    return callback();
  }
};

/**
 * Store the new preview images for a folder
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Folder}     folder          The folder for which to store the preview images
 * @param  {File}       thumbnail       The thumbnail image that should be stored
 * @param  {File}       wide            The wide image that should be stored
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _storeNewPreviews = function (ctx, folder, thumbnail, wide, callback) {
  // Store the files with a unique filename
  let filename = format('thumbnail_%s.jpg', Date.now());
  getStorageBackend(ctx).store(ctx, thumbnail, { filename, resourceId: folder.id }, (error, thumbnailUri) => {
    if (error) return callback(error);

    filename = format('wide_%s.jpg', Date.now());
    getStorageBackend(ctx).store(ctx, wide, { filename, resourceId: folder.id }, (error, wideUri) => {
      if (error) return callback(error);

      return callback(null, thumbnailUri, wideUri);
    });
  });
};

export { generatePreviews };
