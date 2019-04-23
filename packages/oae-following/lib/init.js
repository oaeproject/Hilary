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

import * as FollowingSearch from 'oae-following/lib/search';

// Bind some plugins
// eslint-disable-next-line no-unused-vars, import/namespace
import * as activity from 'oae-following/lib/activity';
// eslint-disable-next-line no-unused-vars, import/namespace
import * as principals from 'oae-following/lib/principals';

export function init(config, callback) {
  return FollowingSearch.init(callback);
}
