/*!
 * Copyright 2012 Sakai Foundation (SF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://www.osedu.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

/*!
 * Note: Most of the REST wrappers will take a RestContext (ctx) object as the first parameter. This context
 * parameter specifies the tenant URL we're working on, as well as the user making the request and his password. 
 *
 * It will be of the following form
 * 
 *     RestContext restCtx = {'host': http://oae.sakai.org, 'userId': 'janedoe', 'password': 'foo'}
 * 
 * For anonymous users, `userId` and `password` will be `null` 
 */

// User REST wrappers
module.exports.User = require('./api.user');

// Group REST wrappers
module.exports.Group = require('./api.group');

// User profile REST wrappers
module.exports.Profile = require('./api.profile');

// Authentication REST wrappers
module.exports.Authentication = require('./api.authentication');

// Content REST wrappers
module.exports.Content = require('./api.content');

// Tenant REST wrappers
module.exports.Tenant = require('./api.tenant');

// Config REST wrappers
module.exports.Config = require('./api.config');

// Doc REST wrappers
module.exports.Doc = require('./api.doc');

// UI REST wrappers
module.exports.UI = require('./api.ui');

// Crop REST wrappers
module.exports.Crop = require('./api.crop');

// Search REST wrappers
module.exports.Search = require('./api.search');
