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
    'title': 'OAE Google Analytics Module',
    'google-analytics': {
        'name': 'Google Analytics configuration',
        'description': 'Google Analytics configuration',
        'elements': {
            'globalEnabled': new Fields.Bool('Global GA enabled', 'Global Google Analytics enabled', false, {'tenantOverride': false}),
            'globalTrackingId': new Fields.Text('Global GA tracking-ID', 'The Global Google Analytics tracking-ID', '', {'tenantOverride': false}),
            'tenantEnabled': new Fields.Bool('Tenant GA enabled', 'Google Analytics enabled for tenant', false),
            'tenantTrackingId': new Fields.Text('Tenant GA tracking-ID', 'The Google Analytics tenant tracking-ID', '')
        }
    }
};
