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

import process from 'node:process';
import * as Fields from 'oae-config/lib/fields.js';

export const title = 'OAE Principals Module';
export const recaptcha = {
  name: 'reCaptcha Configuration',
  description: 'Define the reCaptcha settings.',
  elements: {
    enabled: new Fields.Bool('Enabled', 'Enable reCaptcha for user creation', true),
    publicKey: new Fields.Text('Public key', 'Public reCaptcha key', process.env.RECAPTCHA_KEY),
    privateKey: new Fields.Text('Private key', 'Private reCaptcha key', process.env.RECAPTCHA_KEY, {
      suppress: true
    })
  }
};
