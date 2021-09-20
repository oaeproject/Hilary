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

import * as Fields from 'oae-config/lib/fields.js';

export const title = 'OAE Discussions Module';
export const visibility = {
  name: 'Default Visibility Values',
  description: 'Default visibility setting for new discussions',
  elements: {
    discussion: new Fields.List('Discussion Visibility', 'Default visibility for a new discussion', 'public', [
      {
        name: 'Public',
        value: 'public'
      },
      {
        name: 'Authenticated Users',
        value: 'loggedin'
      },
      {
        name: 'Private',
        value: 'private'
      }
    ])
  }
};
