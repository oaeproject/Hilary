var argv = require('optimist')
    .usage('Run the Hilary tests.\nUsage: $0')
    .alias('m', 'module')
    .describe('m', 'Only run a specific module. Just specify the module name.')
    .argv;

var fs = require('fs');
var nodeunit = require('nodeunit');
var reporters = require('nodeunit/lib/reporters');

var OAE = require('oae-util/lib/OAE');
var cassandra = require('oae-util/lib/cassandra');

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
 * This is executed once all of the tests for all of the different modules have finished
 * running or when one of the tests has caused an error. It cleans up the test keypsace.
 * @param {Object}      err     Standard error object, containing the error message
 */
var finishTests = function(err) {
    // Log the error that has caused the scripts to fail
    if (err) {
        console.error(err);
    }
    // Clean up after ourselves
    // TODO
    // Finish the process
    process.exit(err ? 1 : 0);
};

/**
 * Check whether or not we want to run the tests for 1 specific module or
 * all modules at the same time and then run the actual test(s)
 * @param {Object}      err     Standard error object, containing the error message for the
 *                              keyspace creation
 */
var setUpTests = function(err) {
    if (err) {
        console.error(err);
        throw "Error on keyspace creation. Aborting unit tests.";
    }

    console.log("Cassandra set up, running tests.");

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
        var finishedTests = 0;

        testrunner.run(files, options, function(err) {
            finishedTests++;
            if (finishedTests === files.length || err) {
                finishTests(err);
            }
        });
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
cassandra.init(config, setUpTests);