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

var PrincipalsAPI = require('oae-principals');

var OrcidDAO = require('oae-orcid/lib/internal/dao');

/*!
 * Register a full user profile decorator that adds the user's ORCID id (if available)
 */
PrincipalsAPI.registerFullUserProfileDecorator('orcid', function(ctx, user, callback) {
    if (!ctx.user() || !user) {
        return callback();
    } else if (ctx.user().id !== user.id) {
        return callback();
    }

    // Return the user's ORCID id (if available)
    OrcidDAO.getOrcidIdFromUser(ctx.user().id, function(err, orcidId) {
        if (err) {
            return callback(err);
        }
        return callback(null, {'id': orcidId});
    });
});
