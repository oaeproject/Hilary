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
    'title': 'OAE UserVoice Module',
    'general': {
        'name': 'UserVoice Configuration',
        'description': 'UserVoice integration configuration',
        'elements': {
            'enabled': new Fields.Bool('Enabled', 'UserVoice feedback enabled', false, {'tenantOverride': false, 'suppress': false}),
            'baseUrl': new Fields.Text('Base URL', 'UserVoice account base URL (e.g. https://acme.uservoice.com)', '', {'tenantOverride': false, 'suppress': true}),
            'subdomain': new Fields.Text('Subdomain', 'UserVoice account subdomain (e.g., "acme" for "acme.uservoice.com")', '', {'tenantOverride': false, 'suppress': true}),
            'ssoKey': new Fields.Text('SSO Key', 'UserVoice SSO key for redirecting users to UserVoice', '', {'globalAdminOnly': true, 'tenantOverride': false, 'suppress': true})
        }
    }
};
