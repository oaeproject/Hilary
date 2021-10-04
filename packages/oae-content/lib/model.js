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

import { format } from 'node:util';
import _ from 'underscore';

import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as TenantsAPI from 'oae-tenants';

/// ////////
// Model //
/// ////////

/**
 * A content item
 *
 * @param  {String}     tenantAlias         The alias of the tenant to which the content item is associated
 * @param  {String}     id                  The id of the content item
 * @param  {String}     visibility          The visibility of the content item. One of `public`, `loggedin`, `private`
 * @param  {String}     displayName         The display name of the content item
 * @param  {String}     description         A longer description for the content item
 * @param  {String}     resourceSubType     The content item type. One of `file`, `collabdoc`, `collabsheet`, `link`
 * @param  {String}     createdBy           The id of the user who created the content item
 * @param  {Number}     created             The timestamp (millis since epoch) at which the content item was created
 * @param  {Number}     lastModified        The timestamp (millis since epoch) at which the content item was last modified
 * @param  {String}     latestRevisionId    The id of the current content item revision
 * @param  {Object}     previews            The thumbnails for the content item
 */
const Content = function (
  tenantAlias,
  id,
  visibility,
  displayName,
  description,
  resourceSubType,
  createdBy,
  created,
  lastModified,
  latestRevisionId,
  previews
) {
  const that = {};
  const { resourceId } = AuthzUtil.getResourceFromId(id);

  that.tenant = TenantsAPI.getTenant(tenantAlias).compact();
  that.id = id;
  that.visibility = visibility;
  that.displayName = displayName;
  that.description = description;
  that.resourceSubType = resourceSubType;
  that.createdBy = createdBy;
  that.created = created;
  that.lastModified = lastModified;
  that.profilePath = '/content/' + tenantAlias + '/' + resourceId;
  that.resourceType = 'content';
  that.latestRevisionId = latestRevisionId;
  that.previews = _.isObject(previews) ? previews : {};

  if (resourceSubType === 'file') {
    that.downloadPath = _getDownloadPath(id, latestRevisionId);
  }

  return that;
};

/**
 * A revision
 *
 * @param  {String}     contentId           The id of the file associated to the revision
 * @param  {String}     revisionId          The id of the revision
 * @param  {String}     createdBy           The user who created the revision
 * @param  {Number}     created             The timestamp (millis since epoch) at which the revision was created
 * @param  {Object}     opts                Any optional parameters (such as filename, mimetype, ..) you wish to pass along. Each key in the opts object will be exposed as a key on the revision object
 * @param  {String}     opts.previewsId     The storage directory of the previews of the revision, within the content item
 * @param  {String}     [opts.filename]     If the revision is a file upload, it would be expected it has a `filename` attribute
 */
const Revision = function (contentId, revisionId, createdBy, created, options) {
  const that = _.extend({}, options);
  that.contentId = contentId;
  that.revisionId = revisionId;
  that.createdBy = createdBy;
  that.created = created;

  // If the revision is a file, we can provide a download path
  if (that.filename) {
    that.downloadPath = _getDownloadPath(contentId, revisionId);
  }

  return that;
};

/**
 * A download strategy instructs the application on how it should deliver a storage item to the user. In all cases, the `strategy` of the download
 * strategy should be a value that exists in `ContentConstants.backend.DOWNLOAD_STRATEGY_*` and the `target` is a value whose format is specific
 * to the particular strategy.
 *
 *  * **DOWNLOAD_STRATEGY_INTERNAL:**   The file should be served to the consumer directly from the application. The value of the target indicates
 *                                      a local file path at which the item can be found by the web server
 *
 *  * **DOWNLOAD_STRATEGY_REDIRECT:**   The user should be securely redirected toward an external URL. The value of the target indicates the target
 *                                      URL of the redirect
 *
 *  * **DOWNLOAD_STRATEGY_DIRECT:**     The user should be linked directly to an external URL without passing through the application. The value of
 *                                      the target indicates the URL of the direct link. Note that since this is "insecure", and external reference
 *                                      should have its own authentication method (e.g., a signature in the target URL) which secures the resource
 *                                      if necessary
 *
 * @param  {String}     strategy        The name of the strategy to use to download the file, as per the method summary
 * @param  {String}     target          The target at which to download the file, as per the method summary
 */
const DownloadStrategy = function (strategy, target) {
  const that = {};
  that.strategy = strategy;
  that.target = target;
  return that;
};

/**
 * Get the URL path that can be used to download the revision identified by the given
 * content and revision id
 *
 * @param  {String}     contentId   The id of the content item for which to create a download path
 * @param  {String}     revisionId  The id of the revision for which to create a download path
 * @return {String}                 The download path for the content revision
 * @api private
 */
const _getDownloadPath = function (contentId, revisionId) {
  return format('/api/content/%s/download/%s', contentId, revisionId);
};

export { Content, Revision, DownloadStrategy };
