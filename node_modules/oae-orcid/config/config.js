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
    'title': 'OAE ORCID Module',
    'api': {
        'name': 'ORCID configuration',
        'description': 'ORCID configuration',
        'elements': {
            'enabled': new Fields.Bool('ORCID enabled', 'ORCID integration enabled for tenant', false),
            'client_id': new Fields.Text('ORCID client ID', 'The ORCID client ID', '', {'suppress': true}),
            'client_secret': new Fields.Text('ORCID client secret', 'The ORCID client secret', '', {'suppress': true}),
            'public': new Fields.Text('ORCID public API', 'The ORCID Public API endpoint', ''),
            'member': new Fields.Text('ORCID member API', 'The ORCID Member API endpoint', '')
        }
    }
};
