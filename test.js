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
var nodeunit = require('nodeunit');
var reporters = require('nodeunit/lib/reporters');

var cassandra = require('oae-util/lib/cassandra');
var OAE = require('oae-util/lib/OAE');
var tenantAPI = require('oae-tenants');

// The Cassandra connection config that should be used for unit tests, using
// a custom keyspace for just the tests
var config = {
    'host': '127.0.0.1',
    'port': 9160,
    'keyspace': 'oaeTest',
    'user': '',
    'pass': '',
    'system': '127.0.0.1:9160',
    'type': 'simple'
};

/**
 * Whenever an uncaught exception is encountered, we catch this here and
 * make sure that the process only quits when all of the necessary clean-up
 * has been done 
 */
process.on('uncaughtException', function(err) {
  finishTests(err);
  return false;
});

/**
 * This is executed once all of the tests for all of the different modules have finished
 * running or when one of the tests has caused an error. It cleans up the test keypsace.
 * @param {Object}      err     Standard error object, containing the error message
 */
var finishTests = function(testErr) {
    // Log the error that has caused the scripts to fail
    if (testErr) {
        console.error(testErr);
    }
    // Clean up after ourselves
    cassandra.dropKeyspace(config.keyspace, function(err) {
        if (err) {
            console.error(err);
        }
        // Finish the process
        process.exit(err || testErr ? 1 : 0);
    });
    
};

/**
 * Create 2 default tenants that can be used for testing our REST endpoints
 * @param {Object}      err     Standard error object, containing the error message for the
 *                              keyspace creation
 */
var setUpTenants = function(err) {
    if (err) {
        console.error(err);
        throw "Error on keyspace creation. Aborting unit tests.";
    }
    console.log("Cassandra set up, running tests.");
    
    tenantAPI.createTenant("camtest", "Cambridge University Test", "Cambridge University Description", 2001, "oae.cam.ac.uk", function() {
        tenantAPI.createTenant("gttest", "Georgia Tech Test", "Georgia Tech Description", 2002, "oae.gatech.edu", setUpTests);
    });
};

/**
 * Check whether or not we want to run the tests for 1 specific module or
 * all modules at the same time and then run the actual test(s)
 */
var setUpTests = function() {
    // Use the default test runner output.
    testrunner = reporters['default'];

    // Runs a set of tests.
    var runTests = function(files) {
        var options = {
            "error_prefix": "\u001B[31m",
            "error_suffix": "\u001B[39m",
            "ok_prefix": "\u001B[32m",
            "ok_suffix": "\u001B[39m",
            "bold_prefix": "\u001B[1m",
            "bold_suffix": "\u001B[22m",
            "assertion_prefix": "\u001B[35m",
            "assertion_suffix": "\u001B[39m"
        };
        testrunner.run(files, options, finishTests);
    };


    if (argv['module']) {
        // Single module.
        var file = 'node_modules/' + argv['module'] + '/tests';
        if (fs.existsSync(file)) {
            console.log("Running the tests for just the " + argv['module'] + " module.");
            runTests([file]);
        } else {
            console.log("\u001B[1m\u001B[31mCouldn't find that module.\u001B[39m\u001B[22m");
        }
    } else {
        // Run the tests for all the modules.
        OAE.getAvailableModules(function(modules) {
            var files = [];
            for (var i = 0; i < modules.length; i++) {
                var file = 'node_modules/' + modules[i] + '/tests';
                if (fs.existsSync(file)) {
                    files.push(file);
                } else {
                    console.warn("\u001B[1m\u001B[31mModule '" + modules[i] + "' has no tests.\u001B[39m\u001B[22m");
                }
            }
    
            // Run them.
            runTests(files);
        });
    }
};

// First set up the keyspace and all of the column families required
// for all of the different OAE modules
OAE.init(config, setUpTenants);