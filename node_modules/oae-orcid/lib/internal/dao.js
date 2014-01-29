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

var Cassandra = require('oae-util/lib/cassandra');
var log = require('oae-logger').logger('oae-orcid');

/**
 * Updates a user profile by associating an ORCID id
 *
 * @param  {String}     principalId     The id of the user that wants to associate an ORCID id (e.g. u:cam:gy8DOuwVYF)
 * @param  {String}     orcidId         The ORCID id that needs to be associated with (e.g. 0000-0002-8987-5721)
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    The thrown error
 */
var updateOrcidId = module.exports.updateOrcidId = function(principalId, orcidId, callback) {

    // Construct a query for creating a new association between a user and an ORCID id
    var q = Cassandra.constructUpsertCQL('OrcidMembers', 'principalId', principalId, {'orcidId': orcidId}, 'QUORUM');
    if (!q) {
        return callback({'code': 500, 'msg': 'Could not create a proper CQL query'});
    }

    // Link the ORCID id to the user's profile
    Cassandra.runQuery(q.query, q.parameters, callback);
};

/**
 * Returns the ORCID id from a user
 *
 * @param  {String}     principalId         The id of the user that wants to associate an ORCID id (e.g. u:cam:gy8DOuwVYF)
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        The thrown error
 * @param  {String}     callback.orcidId    The user's orcidId
 */
var getOrcidIdFromUser = module.exports.getOrcidIdFromUser = function(principalId, callback) {

    // First check if the user already has associated an ORCID id with his profile
    Cassandra.runQuery('SELECT * FROM OrcidMembers USING CONSISTENCY QUORUM WHERE principalId = ?', [principalId], function(err, rows) {
        if (err) {
            return callback({'code': err.code, 'msg': err.msg});
        }

        // Return an empty result if no ORCID id was found
        if (rows[0].count <= 1) {
            return callback();
        }

        // Return the user's ORCID id
        return callback(null, rows[0][1]['value']);
    });
};
