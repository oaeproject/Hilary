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

export const title = 'OAE Principals Module';
export const user = {
  name: 'Default User Values',
  description: 'Default values for new users',
  elements: {
    delete: new Fields.Text('Months before deletion', 'Months before the definitive deletion of a user', '2'),
    visibility: new Fields.List('Default Visibility', 'Default visibility for new users', 'public', [
      {
        name: 'Public',
        value: 'public'
      },
      {
        name: 'Logged in users',
        value: 'loggedin'
      },
      {
        name: 'Private',
        value: 'private'
      }
    ]),
    emailPreference: new Fields.List(
      'Default Email Preference',
      'Default email preference for new users',
      'immediate',
      [
        {
          name: 'Immediate',
          value: 'immediate'
        },
        {
          name: 'Daily',
          value: 'daily'
        },
        {
          name: 'Weekly',
          value: 'weekly'
        },
        {
          name: 'Never',
          value: 'never'
        }
      ]
    ),
    defaultLanguage: new Fields.List('Default language', 'Default UI language', 'en_GB', [
      {
        name: 'Afrikaans',
        value: 'af_ZA'
      },
      {
        name: 'Català',
        value: 'ca_ES'
      },
      {
        name: 'Cymraeg',
        value: 'cy_GB'
      },
      {
        name: 'Deutsch',
        value: 'de_DE'
      },
      {
        name: 'English (UK)',
        value: 'en_GB'
      },
      {
        name: 'English (US)',
        value: 'en_US'
      },
      {
        name: 'Español',
        value: 'es_ES'
      },
      {
        name: 'Français',
        value: 'fr_FR'
      },
      {
        name: 'हिन्दी',
        value: 'hi_IN'
      },
      {
        name: 'Italiano',
        value: 'it_IT'
      },
      {
        name: 'Nederlands',
        value: 'nl_NL'
      },
      {
        name: 'Polski',
        value: 'pl_PL'
      },
      {
        name: 'Português',
        value: 'pt_PT'
      },
      {
        name: 'Português do Brasil',
        value: 'pt_BR'
      },
      {
        name: 'Русский',
        value: 'ru_RU'
      },
      {
        name: 'Svenska',
        value: 'sv_SE'
      },
      {
        name: 'Türkçe',
        value: 'tr_TR'
      },
      {
        name: 'Valencià',
        value: 'val_ES'
      },
      {
        name: '中文',
        value: 'zh_CN'
      }
    ])
  }
};
