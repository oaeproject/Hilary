/*
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

var argv = require('optimist')
    .usage('Run the Hilary tests.\nUsage: $0')
    .alias('m', 'module')
    .describe('m', 'Only run a specific module. Just specify the module name.')
    .argv;

var fs = require('fs');
var cassandra = require('oae-util/lib/cassandra');
var OAE = require('oae-util/lib/oae');


// The Cassandra connection config that should be used for unit tests, using
// a custom keyspace for just the tests
var config = {
    'hosts': ['127.0.0.1:9160'],
    'keyspace': 'oaeTest',
    'user': '',
    'pass': '',
    'system': '127.0.0.1:9160'
};

/**
 * Whenever an uncaught exception is encountered, we catch this here and
 * make sure that the process only quits when all of the necessary clean-up
 * has been done
 */
process.on('uncaughtException', function(err) {
  finishTests(function() {});
  return false;
});

/**
 * This is executed once all of the tests for all of the different modules have finished
 * running or when one of the tests has caused an error. It cleans up the test keypsace.
 * @param {Object}      err     Standard error object, containing the error message
 */
var finishTests = function(callback) {
    // Clean up after ourselves
    cassandra.dropKeyspace(config.keyspace, function(err) {
        if (err) {
            console.error(err);
        }
        callback();
    });

};

/**
 * Create 2 default tenants that can be used for testing our REST endpoints
 * @param {Object}      err     Standard error object, containing the error message for the
 *                              keyspace creation
 */
var setUpTenants = function(err, callback) {
    if (err) {
        console.error(err);
        throw "Error on keyspace creation. Aborting unit tests.";
    }

    var tenantAPI = require('oae-tenants');
    tenantAPI.createTenant("camtest", "Cambridge University Test", "Cambridge University Description", 2001, "oae.cam.ac.uk", function() {
        tenantAPI.createTenant("gttest", "Georgia Tech Test", "Georgia Tech Description", 2002, "oae.gatech.edu", function() {
            // If we're in coverage mode we've disabled initial log output.
            // Re-enable it to run the tests. If a tests outputs something
            // it's an indicitation that something has gone wrong.
            callback();
        });
    });
};

if (process.env.OAE_COVERING) {
    // If we're running in coverage mode we supress log output.
    console.log = function() {};
}
// First set up the keyspace and all of the column families required
// for all of the different OAE modules
before(function(callback) {
    OAE.init(config, function(err) {
        setUpTenants(err, callback);
    });
});

beforeEach(function() {
    if (process.env.OAE_COVERING) {
        // If we're running in coverage mode we supress log output.
        console.log = function() {};
    }
});


// Drop the keyspace after all the tests are done.
after(function(callback) {
    finishTests(callback);
});