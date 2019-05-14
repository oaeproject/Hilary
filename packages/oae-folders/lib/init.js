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

import * as FoldersSearch from './search';

// Register activity, library, previews and search functionality
// eslint-disable-next-line no-unused-vars, import/namespace
import * as activity from './activity';
// eslint-disable-next-line no-unused-vars
import * as library from './library';
// eslint-disable-next-line no-unused-vars
import * as previews from './previews';
// eslint-disable-next-line no-unused-vars, import/namespace
import * as invitations from './invitations';

export function init(config, callback) {
  return FoldersSearch.init(callback);
}
