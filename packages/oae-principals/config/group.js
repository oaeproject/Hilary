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

var Fields = require('oae-config/lib/fields');

module.exports = {
    'title': 'OAE Principals Module',
    'group': {
        'name': 'Default Group Values',
        'description': 'Default values for new groups',
        'elements': {
            'visibility': new Fields.List('Default Visibility', 'Default visibility for new groups', 'public', [
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
            ]),
            'joinable': new Fields.List('Default joinability', 'Default joinability for new groups', 'no', [
                {
                    'name': 'Users can automatically join',
                    'value': 'yes'
                },
                {
                    'name': 'Users can request to join',
                    'value': 'request'
                },
                {
                    'name': 'Users cannot join',
                    'value': 'no'
                }
            ])
        }
    }
};
