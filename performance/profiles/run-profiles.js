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
    .demand('s')
    .alias('s', 'scripts-dir')
    .describe('s', 'The location of generated model-loader scripts')

    .alias('n', 'number-of-runs')
    .describe('n', 'The number of times total the performance test will be run.')
    .default('n', 1)

    .alias('c', 'concurrent')
    .describe('c', 'The number of performance tests that will be run concurrently.')
    .default('c', 1)
    .argv;

var oae = require('oae-util/lib/oae');
var io = require('oae-util/lib/io');
var performance = require('./lib/performance');

var config = require('../../config').config;


config.cassandra.keyspace = 'oaePerformanceProfiles';

var scriptsDir = argv['s'];
var numberOfRuns = argv['n'];
var concurrent = argv['c'];
var baseTenantId = 'perf-test-' + new Date().getTime();

oae.init(config, function(err) {
    if (!err) {
        var results = {};
        var model = {};

        // read the data from the model-loader scripts and build the model
        readScript(scriptsDir + '/users/0.txt', 'users', model, function() {
            // build the batches of concurrent runs
            var tenantGroups = new Array(Math.ceil(numberOfRuns / concurrent));
            for (var i = 0; i < tenantGroups.length; i++) {
                tenantGroups[i] = [];
                for (var j = 0; j < concurrent; j++) {
                    tenantGroups[i].push(baseTenantId+'-'+i+'-'+j);
                }
            }

            var numPhases = tenantGroups.length;
            var phasesComplete = 0;

            // tracks the phase completion to signal when the process is over and output results.
            var trackPhases = function(err) {
                if (!err) {
                    phasesComplete++;
                    if (phasesComplete === numPhases) {
                        console.log(JSON.stringify(results));
                        process.exit(0);
                    }
                } else {
                    console.log(err);
                    process.exit(0);
                }
            }

            runPhases(0, tenantGroups, model, results, trackPhases);
        });
    } else {
        console.log(err);
        process.exit(0);
    }
});

/**
 * Runs all the phases provided by multi-dimensional array 'phases'.
 */
var runPhases = function(phaseId, phases, model, results, callback) {
    var phaseResults = results['phase-'+phaseId] = {};
    var phase = phases.pop();

    phaseResults.phase = phase;

    performance.dataload(phase, model, phaseResults, function(err) {
        console.log('[Phase %s] Finished data-loading.', phaseId);
        if (!err) {
            if (phases.length > 0) {
                // if we have more phases, kick off the next one staggered here
                runPhases(phaseId+1, phases, model, results, callback);
            }
            performance.performanceTest(phase, model, phaseResults, callback);
        } else {
            callback(err);
        }
    })

};

/**
 * Read the provided jsonFile as a list of new-line-delimited JSON objects
 */
var readScript = function(jsonFile, name, model, callback) {
    model[name] = [];
    io.loadJSONFileIntoArray(jsonFile, function(items) {
        items.forEach(function(item) {
            model[name].push(item);
        });
        callback();
    });
};