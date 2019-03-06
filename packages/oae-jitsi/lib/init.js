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

const log = require('oae-logger').logger('oae-jitsi-init');

const MeetingSearch = require('./search');

module.exports = function(config, callback) {
  log().info('Initializing the oae-jitsi module');

  // Register the activity functionality
  // eslint-disable-next-line no-unused-vars
  const activity = require('./activity');

  // Register the library functionality
  // eslint-disable-next-line no-unused-vars
  const library = require('./library');

  return MeetingSearch.init(callback);
};
