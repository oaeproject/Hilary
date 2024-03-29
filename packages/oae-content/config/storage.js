/*!
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the 'License'); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an 'AS IS'
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import * as Fields from 'oae-config/lib/fields.js';

export const title = 'OAE Content Module';
export const storage = {
  name: 'Storage backend settings',
  description: 'Define the backend storage settings',
  elements: {
    backend: new Fields.Radio(
      'Default storage backend',
      'Default storage backend for file bodies',
      'local',
      [
        {
          name: 'Local',
          value: 'local'
        },
        {
          name: 'Amazon S3',
          value: 'amazons3'
        }
      ],
      { tenantOverride: false, suppress: true, globalAdminOnly: true }
    ),
    'amazons3-access-key': new Fields.Text('Amazon Access Key', 'Your Amazon Access key', '<access-key>', {
      tenantOverride: false,
      suppress: true,
      globalAdminOnly: true
    }),
    'amazons3-secret-key': new Fields.Text('Amazon Secret Key', 'Your Amazon Secret key', '<secret-key>', {
      tenantOverride: false,
      suppress: true,
      globalAdminOnly: true
    }),
    'amazons3-region': new Fields.Text('Amazon S3 Region', 'The region for your S3 bucket', 'us-east-1', {
      tenantOverride: false,
      suppress: true,
      globalAdminOnly: true
    }),
    'amazons3-bucket': new Fields.Text(
      'Amazon S3 Bucket',
      'The Amazon S3 Bucket to store file bodies in',
      'oae-files',
      { tenantOverride: false, suppress: true, globalAdminOnly: true }
    )
  }
};
