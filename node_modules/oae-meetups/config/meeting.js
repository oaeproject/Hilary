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
    'title': 'OAE BigBlueButton Module',
    'bbb': {
        'name': 'BigBlueButton Configuration',
        'description': 'Configuration for BigBlueButton conferencing',
        'elements': {
            'enabled': new Fields.Bool('Enabled', 'Enable conferencing with BigBlueButton', false),
            'endpoint': new Fields.Text('Endpoint', 'Your BigBlueButton server URL \n(e.g., http://test-install.blindsidenetworks.com/bigbluebutton/)', 'http://test-install.blindsidenetworks.com/bigbluebutton/', {'suppress': true}),
            'secret': new Fields.Text('Secret', 'Your BigBlueButton shared secret \n(e.g. 8cd8ef52e8e101574e400365b55e11a6)', '8cd8ef52e8e101574e400365b55e11a6', {'suppress': true}),
            'recording': new Fields.Bool('Recording', 'Enable recording capability', false),
            'recordingDefault': new Fields.Bool('Recording Default', 'Recording capability enabled by default in new meetings', false),
            'allModerator': new Fields.Bool('All Moderator', 'Enable all moderator capability', false),
            'allModeratorDefault': new Fields.Bool('All Moderator Default', 'All moderator capability enabled by default in new meetings', false),
        }
    },
    'visibility': {
        'name': 'Default Visibility Values',
        'description': 'Default visibility setting for new meetings',
        'elements': {
            'meeting': new Fields.List('Meetings Visibility', 'Default visibility for a new meeting', 'public', [
                {
                    'name': 'Public',
                    'value': 'public'
                },
                {
                    'name': 'Authenticated Users',
                    'value': 'loggedin'
                },
                {
                    'name': 'Private',
                    'value': 'private'
                }
            ])
        }
    }
};
