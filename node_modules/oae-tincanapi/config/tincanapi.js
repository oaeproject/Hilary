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
    'title': 'OAE TinCan Module',
    'lrs': {
        'name': 'Learning Record Store configuration',
        'description': 'Learning Record Store configuration',
        'elements': {
            'enabled': new Fields.Bool('LRS enabled', 'Learning Record Store integration enabled for tenant', false, {'suppress': true}),
            'username': new Fields.Text('LRS username', 'The LRS username', '3HQ4Q12B57', {'suppress': true}),
            'password': new Fields.Text('LRS password', 'The LRS password', 'Wzoy9WJEqTYpf2E3pAjJTYAzZSmvpT3WO3iF4g3d', {'suppress': true}),
            'endpoint': new Fields.Text('LRS URL', 'The TinCan API REST endpoint', 'https://cloud.scorm.com/tc/3HQ4Q12B57/statements', {'suppress': true})
        }
    }
};
