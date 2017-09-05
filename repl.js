let repl = require("repl").start({}),
    promisify = require("repl-promised").promisify;

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
