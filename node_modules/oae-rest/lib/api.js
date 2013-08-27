/*!
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
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

/*!
 * Define the REST API wrappers for the different modules of the application.
 *
 * Note: Most of the REST wrappers will take a RestContext (ctx) object as the first parameter. This context
 * parameter specifies the tenant URL we're working on, as well as the user making the request and his password.
 *
 * It will be of the following form:
 *
 *     `{'host': http://oae.oaeproject.org, 'userId': 'janedoe', 'password': 'foo'}`
 *
 * For anonymous users, `userId` and `password` will be `null`.
 */

module.exports.Activity = require('./api.activity');
module.exports.Admin = require('./api.admin');
module.exports.Authentication = require('./api.authentication');
module.exports.Config = require('./api.config');
module.exports.Content = require('./api.content');
module.exports.Crop = require('./api.crop');
module.exports.Discussions = require('./api.discussions');
module.exports.Doc = require('./api.doc');
module.exports.Following = require('./api.following');
module.exports.Group = require('./api.group');
module.exports.Previews = require('./api.previews');
module.exports.Profile = require('./api.profile');
module.exports.Search = require('./api.search');
module.exports.Tenants = require('./api.tenants');
module.exports.UI = require('./api.ui');
module.exports.User = require('./api.user');
