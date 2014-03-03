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

var OAE = require('oae-util/lib/oae');
var OrcidAPI = require('./api');

/*!
 * Returns an existing ORCID Member by specifying an email address or id
 *
 * Rest Endpoint:
 *
 * _GET_ `/api/orcid/search`
 *
 * * returns JSON object of an existing ORCID member
 */
OAE.tenantRouter.on('get', '/api/orcid/search', function(req, res) {
    OrcidAPI.getOrcidRecord(req.ctx, req.query, function(err, record) {
        if (err) {
            return res.send(err.code, err.msg);
        }
        res.send(200, record);
    });
});

/*!
 * Creates a new ORCID Member record
 *
 * Rest Endpoint:
 *
 * _POST_ `/api/orcid/create`
 */
OAE.tenantRouter.on('post', '/api/orcid/create', function(req, res) {
    OrcidAPI.createOrcidMemberRecord(req.ctx, function(err, orcidId) {
        if (err) {
            return res.send(err.code, err.msg);
        }
        res.send(201, orcidId);
    });
});
