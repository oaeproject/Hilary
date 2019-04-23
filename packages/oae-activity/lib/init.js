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

import * as ActivityAPI from 'oae-activity';
import * as ActivityPush from './internal/push';

// Register some of the default streams
// eslint-disable-next-line import/no-unassigned-import
import * as Activity from './activity';

// Bind the notification event listeners
// eslint-disable-next-line import/no-unassigned-import
import * as Notifications from './internal/notifications';

// Bind the email event listeners
// eslint-disable-next-line import/no-unassigned-import
import * as Email from './internal/email';

export function init(config, callback) {
  ActivityAPI.refreshConfiguration(config.activity, err => {
    if (err) {
      return callback(err);
    }

    // Configure the push notifications
    ActivityPush.init(callback);
  });
}
