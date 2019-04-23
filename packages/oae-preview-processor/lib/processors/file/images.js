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

import PreviewConstants from 'oae-preview-processor/lib/constants';
import * as PreviewUtil from 'oae-preview-processor/lib/util';

/**
 * @borrows Interface.test as Images.test
 */
const test = function(ctx, contentObj, callback) {
  if (contentObj.resourceSubType === 'file' && PreviewConstants.TYPES.IMAGE.indexOf(ctx.revision.mime) !== -1) {
    callback(null, 10);
  } else {
    callback(null, -1);
  }
};

/**
 * @borrows Interface.generatePreviews as Images.generatePreviews
 */
const generatePreviews = function(ctx, contentObj, callback) {
  // Download the file
  ctx.download((err, path) => {
    if (err) {
      return callback(err);
    }

    PreviewUtil.generatePreviewsFromImage(ctx, path, {}, callback);
  });
};

export { test, generatePreviews };
