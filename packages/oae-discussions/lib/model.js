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

import * as AuthzUtil from 'oae-authz/lib/util.js';

/**
 * A model object that represents a discussion object.
 *
 * @param  {Tenant}         tenant          The tenant to which this discussion is associated
 * @param  {String}         id              The id of the discussion
 * @param  {String}         createdBy       The id of the user who created the discussion
 * @param  {String}         displayName     The display name of the discussion
 * @param  {String}         description     A longer description of the discussion
 * @param  {String}         visibility      The visibility of the discussion. Should be one of public, private, loggedin
 * @param  {Number}         created         The timestamp (millis since epoch) at which the discussion was created
 * @param  {Number}         lastModified    The timestamp (millis since epoch) at which the discussion was last modified (or received the last message)
 * @return {Discussion}                     The discussion with the data provided
 */
const Discussion = function (tenant, discussionData) {
  const { id, createdBy, displayName, description, visibility, created, lastModified } = discussionData;
  const { resourceId } = AuthzUtil.getResourceFromId(id);
  const that = {};
  that.tenant = tenant;
  that.id = id;
  that.createdBy = createdBy;
  that.displayName = displayName;
  that.description = description;
  that.visibility = visibility;
  that.created = created;
  that.lastModified = lastModified;
  that.profilePath = format('/discussion/%s/%s', tenant.alias, resourceId);
  that.resourceType = 'discussion';
  return that;
};

export { Discussion };
