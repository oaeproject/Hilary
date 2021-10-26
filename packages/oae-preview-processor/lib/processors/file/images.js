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

import PreviewConstants from 'oae-preview-processor/lib/constants.js';
import * as PreviewUtil from 'oae-preview-processor/lib/util.js';

/**
 * @borrows Interface.test as Images.test
 */
const test = function (ctx, contentObject, callback) {
  const imageTypeIsValid = PreviewConstants.TYPES.IMAGE.includes(ctx.revision.mime);
  callback(null, PreviewUtil.test(contentObject, imageTypeIsValid));
};

/**
 * @borrows Interface.generatePreviews as Images.generatePreviews
 */
const generatePreviews = function (ctx, contentObject, callback) {
  // Download the file
  ctx.download((error, path) => {
    if (error) {
      return callback(error);
    }

    PreviewUtil.generatePreviewsFromImage(ctx, path, {}, callback);
  });
};

export { test, generatePreviews };
