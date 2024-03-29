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

export const title = 'OAE Email Module';
export const general = {
  name: 'General',
  description: 'General e-mail configuration',
  elements: {
    fromName: new Fields.Text(
      'Sender Name',
      'The name that will appear in the "From" header for emails sent by the system. e.g., "Apereo OAE"'
    ),
    fromAddress: new Fields.Text(
      'Sender Address',
      'The address that will appear in the "From" header for emails sent by the system. e.g., "noreply@example.com"'
    )
  }
};
