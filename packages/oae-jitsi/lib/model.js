/*!
 * Copyright 2016 Apereo Foundation (AF) Licensed under the
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

const Meeting = function (tenant, meetingData) {
  const { id, createdBy, displayName, description, chat, contactList, visibility, created, lastModified } = meetingData;

  const { resourceId } = AuthzUtil.getResourceFromId(id);
  const that = {};
  that.tenant = tenant;
  that.id = id;
  that.createdBy = createdBy;
  that.displayName = displayName;
  that.description = description;
  that.chat = chat;
  that.contactList = contactList;
  that.visibility = visibility;
  that.created = created;
  that.lastModified = lastModified;
  that.profilePath = format('/meeting-jitsi/%s/%s', tenant.alias, resourceId);
  that.resourceType = 'meeting-jitsi';

  return that;
};

export { Meeting };
