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

import * as SearchAPI from 'oae-search';
import generalSearch from './searches/general';
import deletedSearch from './searches/deleted';
import { queryBuilder, postProcessor } from './searches/email';

export function init(config, callback) {
  // Const { index, hosts } = config.search;
  const destroy = config.search.index.destroyOnStartup === true;

  // Register generic search endpoints
  SearchAPI.registerSearch('general', generalSearch);
  SearchAPI.registerSearch('deleted', deletedSearch);

  SearchAPI.registerSearch('email', queryBuilder, postProcessor);

  SearchAPI.refreshSearchConfiguration(config.search, err => {
    if (err) {
      return callback(err);
    }

    // Build the index and seed the search schema
    return SearchAPI.buildIndex(destroy, callback);
  });
}
