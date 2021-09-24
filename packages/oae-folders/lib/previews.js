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

import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as ContentAPI from 'oae-content';
import Counter from 'oae-util/lib/counter.js';
import * as MQTestUtil from 'oae-util/lib/test/mq-util.js';
import * as PreviewProcessorAPI from 'oae-preview-processor';
import PreviewConstants from 'oae-preview-processor/lib/constants.js';

import * as FoldersAPI from 'oae-folders';
import * as FoldersAuthz from 'oae-folders/lib/authz.js';
import * as FoldersDAO from 'oae-folders/lib/internal/dao.js';
import { ContentConstants } from 'oae-content/lib/constants.js';
import { FoldersConstants } from 'oae-folders/lib/constants.js';
import { logger } from 'oae-logger';

const log = logger('oae-folders-previews');

const previewCounter = new Counter();

/**
 * Invoke a handler when folder-related previews have finished processing. This is necessary because
 * in `_reprocessFoldersThatContainContent`, we don't issue the `MQ.submit` in the same tick that
 * the content update even is fired, therefore we fall into a possible race condition. We need one
 * additional counter (`previewCounter`) so synchronize that process and listen for when it
 * completes. This function abstracts that process
 *
 * @param  {Function}   callback    Invoked when all previews have completed
 */
const whenPreviewsComplete = function (callback) {
  previewCounter.whenZero(() => {
    MQTestUtil.whenTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_FOLDER_PREVIEWS, () => {
      return MQTestUtil.whenTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_FOLDER_PREVIEWS_PROCESSING, () => {
        return MQTestUtil.whenTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, () => {
          return MQTestUtil.whenTasksEmpty(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS_PROCESSING, callback);
        });
      });
    });
  });
};

/**
 * Regenerate the preview for a folder when content items have been added or removed
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Folder}     folder          The folder that was changed
 * @param  {Content[]}  contentItems    The set of content items that were added or removed
 * @api private
 */
const _handleContentChange = function (ctx, folder, contentItems) {
  // Filter out those content items who have no preview items
  const contentItemsWithPreviews = _.filter(contentItems, (contentItem) => {
    return contentItem.previews && contentItem.previews.status === 'done';
  });

  // If there are no content items with a preview there's no point in (re)generating a preview for the folder
  if (!_.isEmpty(contentItemsWithPreviews)) {
    PreviewProcessorAPI.submitFolderForProcessing(folder.id);
  }
};

/*!
 * If a content item gets added to a folder we need to generate previews for the folder
 */
FoldersAPI.emitter.on(FoldersConstants.events.ADDED_CONTENT_ITEMS, (ctx, actionContext, folder, contentItems) => {
  return _handleContentChange(ctx, folder, contentItems);
});

/*!
 * If a content item gets removed from a folder, we need to regenerate the previews for the folder
 */
FoldersAPI.emitter.on(FoldersConstants.events.REMOVED_CONTENT_ITEMS, _handleContentChange);

/*!
 * If a folder's visibility is updated we need to regenerate the previews for the folder
 */
FoldersAPI.emitter.on(FoldersConstants.events.UPDATED_FOLDER, (ctx, newFolder, oldFolder) => {
  if (oldFolder.visibility !== newFolder.visibility) {
    PreviewProcessorAPI.submitFolderForProcessing(newFolder.id);
  }
});

/*!
 * If a content item's preview images are updated we need to generate previews for the folder
 */
ContentAPI.emitter.on(ContentConstants.events.UPDATED_CONTENT_PREVIEW, (content) => {
  _reprocessFoldersThatContainContent(content.id);
});

/*!
 * If a piece of content is removed from the system we need to regenerate previews for the folders it was located in
 */
ContentAPI.emitter.on(ContentConstants.events.DELETED_CONTENT, (ctx, contentObj, members) => {
  previewCounter.incr();

  const groupIds = AuthzUtil.getGroupIds(members);
  FoldersDAO.getFoldersByGroupIds(groupIds, (err, folders) => {
    if (err) {
      log().error(
        { err, contentId: contentObj.id },
        'Unable to regenerate folder preview after removing a piece of content'
      );
      return;
    }

    // Submit each folder for processing
    _.each(folders, (folder) => {
      PreviewProcessorAPI.submitFolderForProcessing(folder.id);
    });

    previewCounter.decr();
  });
});

/*!
 * If a content item's visibility setting changes we need to regenerate the preview items for those folders that contain the content item
 */
ContentAPI.emitter.on(ContentConstants.events.UPDATED_CONTENT, (ctx, newContentObj, oldContentObj) => {
  if (newContentObj.visibility !== oldContentObj.visibility) {
    _reprocessFoldersThatContainContent(newContentObj.id);
  }
});

/**
 * Reprocess the folders that contain a given content item
 *
 * @param  {String}     contentId   The ID of the content item for which the folders should be reprocessed
 * @api private
 */
const _reprocessFoldersThatContainContent = function (contentId) {
  previewCounter.incr();

  // Get all the folders this content item was part of
  FoldersAuthz.getFoldersForContent(contentId, (err, folders) => {
    if (err) {
      log().error({ err, contentId }, 'Unable to get the folders a piece of content resides in');
      previewCounter.decr();
      return;
    }

    // Submit each folder for processing
    _.each(folders, (folder) => {
      PreviewProcessorAPI.submitFolderForProcessing(folder.id);
    });

    previewCounter.decr();
  });
};

export { whenPreviewsComplete };
