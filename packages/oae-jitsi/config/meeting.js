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

var Fields = require('oae-config/lib/fields');

module.exports = {
    'title': 'OAE Jitsi Module',
    'visibility': {
        'name': 'Default Visibility Value',
        'description': 'Default visibility setting for new meetings',
        'elements': {
            'meeting': new Fields.List('Meetings Visibility', 'Default visibility for a new meeting', 'public', [
                {
                    'name': 'Public',
                    'value': 'public'
                },
                {
                    'name': 'Logged in users',
                    'value': 'loggedin'
                },
                {
                    'name': 'Private',
                    'value': 'private'
                }
            ])
        }
    },
    'server': {
        'name': 'Jitsi Configuration',
        'description': 'Core Configuration',
        'elements': {
            'host': new Fields.Text('Jitsi server address', 'Jitsi server address', ''),
        }
    }
};
