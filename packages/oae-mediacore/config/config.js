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
    'title': 'OAE MediaCore Module',
    'mediacore': {
        'name': 'MediaCore Configuration',
        'description': 'Configuration for MediaCore media processing',
        'elements': {
            'enabled': new Fields.Bool('Enabled', 'Process audio and video uploads with MediaCore', false, {'suppress': true}),
            'url': new Fields.Text('URL', 'The MediaCore URL (e.g., https://mysite.mediacore.tv)', '', {'suppress': true}),
            'keyId': new Fields.Text('Key ID', 'The MediaCore Key ID', '', {'suppress': true}),
            'secret': new Fields.Text('Secret', 'The MediaCore Secret Key', '', {'suppress': true}),
            'collectionId': new Fields.Text('CollectionId', 'The MediaCore Collection ID', '', {'suppress': true})
        }
    }
};
