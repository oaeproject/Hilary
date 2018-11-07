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

const PreviewProcessorAPI = require('oae-preview-processor');

const { ContentConstants } = require('oae-content/lib/constants');
const ContentAPI = require('./api');

ContentAPI.emitter.on(ContentConstants.events.CREATED_CONTENT, (ctx, content, revision) => {
  PreviewProcessorAPI.submitForProcessing(content.id, revision.revisionId);
});

ContentAPI.emitter.on(
  ContentConstants.events.UPDATED_CONTENT,
  (ctx, newContentObj, oldContentObj) => {
    /*
     * This event gets emitted when the content metadata gets updated.
     * We only need to check links here.
     */
    if (newContentObj.resourceSubType === 'link' && newContentObj.link !== oldContentObj.link) {
      PreviewProcessorAPI.submitForProcessing(newContentObj.id, oldContentObj.latestRevisionId);
    }
  }
);

// A collaborative document gets published or a new file body gets uploaded.
ContentAPI.emitter.on(
  ContentConstants.events.UPDATED_CONTENT_BODY,
  // eslint-disable-next-line no-unused-vars
  (ctx, newContentObj, oldContentObj, revision) => {
    PreviewProcessorAPI.submitForProcessing(newContentObj.id, newContentObj.latestRevisionId);
  }
);
