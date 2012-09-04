var argv = require('optimist')
    .usage('Run the Hilary tests.\nUsage: $0')
    .alias('m', 'module')
    .describe('m', 'Only run a specific module. Just specify the module name.')
    .argv;


var path = require('path');
var nodeunit = require('nodeunit');
var reporters = require('nodeunit/lib/reporters');

var OAE = require('oae-util/lib/OAE');
var cassandra = require('oae-util/lib/cassandra');


// The Cassandra connection config that should be used for unit tests.
var config = {
    'host': '127.0.0.1',
    'port': 9160,
    'keyspace': 'unittests',
    'user': '',
    'pass': '',
    'system': '127.0.0.1:9160',
    'type': 'simple'
};
var setUpTests = function(err, created) {
    if (err) {
        throw "Error on keyspace creation. Aborting unit tests.";
    }

    console.log("Cassandra set up, running tests.");

    // Use the default test runner output.
    testrunner = reporters['nested'];

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

        testrunner.run(files, options, function(err) {
            if (err) {
                process.exit(1);
            }
        });
    };


    if (argv['module']) {
        // Single module.
        var file = 'node_modules/' + argv['module'] + '/tests';
        console.log(file);
        if (path.existsSync(file)) {
            console.log("Running the tests for just the " + argv['module'] + " module.");
            runTests([file]);
        } else {
            console.log("\u001B[1m\u001B[31mCouldn't find that module.\u001B[39m\u001B[22m");
        }
    }
    else {
        // Run the tests for all the modules.
        OAE.getAvailableModules(function(modules) {
            var files = [];
            for (var i = 0; i < modules.length; i++) {
                var file = 'node_modules/' + modules[i] + '/tests';
                if (path.existsSync(file)) {
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

cassandra.init(config, setUpTests);