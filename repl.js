/*!
 * Copyright 2017 Apereo Foundation (AF) Licensed under the
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

/*
 * Usage: `node repl.js` and then `PrincipalsAPI.createUser(...);` e.g.
 */

const repl = require("repl").start({});
const promisify = require("repl-promised").promisify;

// import the app models
repl.context.ActivityAPI = require('oae-activity/lib/api.js');
repl.context.AuthenticationAPI = require('oae-authentication/lib/api.js');
repl.context.AuthzAPI = require('oae-authz/lib/api.js');
repl.context.ConfigAPI = require('oae-config/lib/api.js');
repl.context.ContentAPI = require('oae-content/lib/api.js');
repl.context.ContextAPI = require('oae-context/lib/api.js');
repl.context.DiscussionsAPI = require('oae-discussions/lib/api.js');
repl.context.DocAPI = require('oae-doc/lib/api.js');
repl.context.EmailAPI = require('oae-email/lib/api.js');
repl.context.EmitterAPI = require('oae-emitter/lib/api.js');
repl.context.FoldersAPI = require('oae-folders/lib/api.js');
repl.context.FollowingAPI = require('oae-following/lib/api.js');
repl.context.JitsiAPI = require('oae-jitsi/lib/api.js');
repl.context.LibraryAPI = require('oae-library/lib/api.js');
repl.context.LoggerAPI = require('oae-logger/lib/api.js');
repl.context.LtiAPI = require('oae-lti/lib/api.js');
repl.context.MediaCoreAPI = require('oae-mediacore/lib/api.js');
repl.context.MeetupsAPI = require('oae-meetups/lib/api.js');
repl.context.MessageBoxAPI = require('oae-messagebox/lib/api.js');
repl.context.MixPanelAPI = require('oae-mixpanel/lib/api.js');
repl.context.PreviewProcessorAPI = require('oae-preview-processor/lib/api.js');
repl.context.PrincipalsAPI = require('oae-principals/lib/api.js');
repl.context.RestAPI = require('oae-rest/lib/api.js');
repl.context.SearchAPI = require('oae-search/lib/api.js');
repl.context.TelemetryAPI = require('oae-telemetry/lib/api.js');
repl.context.TenantsAPI = require('oae-tenants/lib/api.js');
repl.context.TinCanApiAPI = require('oae-tincanapi/lib/api.js');
repl.context.UiAPI = require('oae-ui/lib/api.js');
repl.context.UserVoiceAPI = require('oae-uservoice/lib/api.js');
repl.context.VersionAPI = require('oae-version/lib/api.js');

promisify(repl);
