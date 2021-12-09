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

import { pipe, concat, join } from 'ramda';

import { getResourceFromId } from 'oae-authz/lib/util.js';

const FOLDER = 'folder';
const SLASH = '/';

const slasher = join(SLASH);
const toAbsolutePath = concat(SLASH);

/**
 * A model object that represents a folder
 *
 * @param  {Tenant}     tenant          The tenant to which the folder belongs
 * @param  {String}     id              The resource id of the folder
 * @param  {String}     groupId         The id of the authz group that this folder represents in the authz indexes
 * @param  {String}     createdBy       The id of the user who created the folder
 * @param  {String}     displayName     The display name of the folder
 * @param  {String}     description     The description of the folder
 * @param  {String}     visibility      The visibility of the folder
 * @param  {Number}     created         The timestamp (millis since epoch) that the folder was created
 * @param  {Number}     lastModified    The timestamp (millis since epoch) that the folder was last modified
 * @param  {Object}     previews        The previews object for this folder
 */
const Folder = function (tenant, folderData) {
  const { id, groupId, createdBy, displayName, description, visibility, created, lastModified, previews } = folderData;

  const turnIntoAbsolutePath = pipe(slasher, toAbsolutePath);

  const { resourceId } = getResourceFromId(id);
  const profilePath = turnIntoAbsolutePath([FOLDER, tenant.alias, resourceId]);
  const resourceType = FOLDER;

  return {
    tenant,
    id,
    groupId,
    createdBy,
    displayName,
    description,
    visibility,
    created,
    lastModified,
    previews,
    profilePath,
    resourceType
  };
};

export { Folder };
