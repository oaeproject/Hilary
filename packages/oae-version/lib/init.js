/*!
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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

var fs = require('fs');

var VersionAPI = require('./api');

/**
 * Initialize the version module
 *
 * @see {oae-util/lib/oae}
 */
module.exports = function(config, callback) {
    VersionAPI.init(fs.realpathSync(config.ui.path));
    return callback();
};
