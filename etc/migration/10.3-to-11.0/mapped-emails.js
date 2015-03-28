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
 *
 * This migration script will try to create a mapping between a user's email address and the user
 * object in the Principals table. Before it does that however, the following checks will be made:
 *   -  Ensure that each user has an email address
 *   -  Ensure that each user's email address is valid
 *   -  Ensure that an email address is only used by 1 user
 *
 * A CSV file with all errors will be created in the current working directory. If any of the above
 * checks fail, you will have to manually address these. How you resolve these issues is up to you.
 *
 * Once you've addressed the raised issues, re-run the script to perform the actual migration
 */

var _ = require('underscore');
var bunyan = require('bunyan');
var csv = require('csv');
var fs = require('fs');

var Cassandra = require('oae-util/lib/cassandra');
var log = require('oae-logger').logger('revisions-migrator');
var OAE = require('oae-util/lib/oae');
var PrincipalsDAO = require('oae-principals/lib/internal/dao');
var Validator = require('oae-util/lib/validator').Validator;

// The application configuration
var config = require('../../../config').config;

// Ensure that this application server does NOT start processing any preview images
config.previews.enabled = false;

// Ensure that we're logging to standard out/err
config.log = {
    'streams': [
        {
            'level': 'info',
            'stream': process.stdout
        }
    ]
};

// Keep track of when we started the migration process so we can output how
// long the migration took
var start = Date.now();

// Keep track of the total number of users and the number of users that were mapped
var totalUsers = 0;
var mappedUsers = 0;

// Spin up the application container. This will allow us to re-use existing APIs
OAE.init(config, function(err) {
    if (err) {
        log().error({'err': err}, 'Unable to spin up the application server');
        return _exit(err.code);
    }

    PrincipalsDAO.iterateAll(['principalId', 'displayName', 'email'], 30, _mapPrincipals, function() {
        if (err) {
            log().error({'err': err}, 'Failed to migrate all users');
            process.exit(1);
        }

        log().info('Migration completed, it took %d milliseconds', (Date.now() - start));
        log().info('Total users: %d, mapped users: %d', totalUsers, mappedUsers);
        process.exit(0);
    });
});

/**
 * Go through a set of rows and map the users who have a valid email address
 *
 * @param  {Object[]}   principals      An array of principal objects to map
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error object, if any
 * @api private
 */
var _mapPrincipals = function(principals, callback) {
    var queries = [];

    _.each(principals, function(principal) {
        var principalId = principal.principalId;
        var displayName = principal.displayName;
        var email = principal.email;

        // We only care about users in this migration process
        if (!PrincipalsDAO.isUser(principalId)) {
            return;
        }
        totalUsers++;

        // Check if the user has an email address
        if (!email) {
            return log().warn({'principalId': principalId}, 'This user has no email address');
        }

        // Check whether the persisted email address is valid
        var validator = new Validator();
        validator.check(email, {'code': 400, 'msg': 'An invalid email address has been persisted'}).isEmail();
        if (validator.hasErrors()) {
            return log().warn({'principalId': principalId, 'email': email}, 'An invalid email address has been persisted');
        }

        // Create a mapping for the valid email address
        queries.push({'query': 'INSERT INTO "PrincipalsByEmail" ("email", "principalId") VALUES (?, ?)', 'parameters': [email, principalId]});
        mappedUsers++;
    });

    // Create the mappings and move on to the next set of principals
    Cassandra.runBatchQuery(queries, callback);
};
