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

var Cassandra = require('oae-util/lib/cassandra');

module.exports = function(config, callback) {
    require('./activity');

    return _ensureSchema(callback);
};

/**
 * Ensure that the all of the meeting schemas are created. If they already exist, this method will not do anything
 *
 * @param  {Function}         callback       Standard callback function
 * @param  {Object}           callback.err   An error that occurred, if any
 * @api private
 */
var _ensureSchema = function(callback) {
    Cassandra.createColumnFamilies({
        'Meetups': 'CREATE TABLE "Meetups" ("id" text PRIMARY KEY, "tenantAlias" text, "displayName" text, "createdBy" text, "created" text, "record" text)',
        'Recordings': 'CREATE TABLE "Recordings" ("id" text PRIMARY KEY, "contentId" text, "createdBy" text, "created" text)'
    }, callback);
};

