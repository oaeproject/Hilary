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
import * as TenantsAPI from 'oae-tenants';

/**
 * The Group model.
 *
 * @param  {String}     tenantAlias                 The alias of the tenant this group belongs to
 * @param  {String}     id                          The globally unique principalId for this group. e.g.: g:cam:math-101
 * @param  {String}     displayName                 The display name of the group
 * @param  {Object}     [opts]                      Optional additional group properties
 * @param  {String}     [opts.visibility]           The visibility of the group
 * @param  {String}     [opts.joinable]             How the group can be joined
 * @param  {Date}       [opts.deleted]              The date and time the group was deleted, if deleted
 * @param  {String}     [opts.description]          A longer description for the group
 * @param  {Number}     [opts.lastModified]         The lastModified date of the group
 * @param  {Number}     [opts.created]              The create date of the group
 * @param  {String}     [opts.createdBy]            The id of the user that created the group
 * @param  {String}     [opts.smallPictureUri]      The uri of the small picture. It will be made available at user.picture.smallUri
 * @param  {String}     [opts.mediumPictureUri]     The uri of the medium picture. It will be made available at user.picture.mediumUri
 * @param  {String}     [opts.largePictureUri]      The uri of the large picture. It will be made available at user.picture.largeUri
 */
export const Group = function (tenantAlias, id, displayName, options) {
  options = options || {};
  const { resourceId } = AuthzUtil.getResourceFromId(id);

  const that = {};
  that.id = id;
  that.displayName = displayName;
  that.tenant = TenantsAPI.getTenant(tenantAlias).compact();
  that.visibility = options.visibility;
  that.joinable = options.joinable;
  that.deleted = options.deleted;
  that.description = options.description;
  that.lastModified = options.lastModified;
  that.resourceType = 'group';
  that.created = options.created;
  that.createdBy = options.createdBy;
  that.picture = _.oaeExtendDefined(
    {},
    {
      smallUri: options.smallPictureUri,
      mediumUri: options.mediumPictureUri,
      largeUri: options.largePictureUri
    }
  );

  // Only set the profile path if the group has not been deleted
  if (!options.deleted) {
    that.profilePath = '/group/' + tenantAlias + '/' + resourceId;
  }

  return that;
};
