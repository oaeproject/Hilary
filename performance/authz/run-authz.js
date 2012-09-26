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
var log = require('oae-logger').logger('authz-performance');
var performance = require('./lib/performance');
var config = require('../../config').config;


config.cassandra.keyspace = 'oaePerformanceAuthz';

var scriptsDir = argv['s'];
var numberOfRuns = argv['n'];
var concurrent = argv['c'];
var baseTenantId = 'perf-test-'+new Date().getTime();

oae.init(config, function(err) {
    if (!err) {
        var results = {};
        var model = {};

        // read the data from the model-loader scripts and build the model
        readScript(scriptsDir+'/users/0.txt', 'users', model, function() {
            readScript(scriptsDir+'/worlds/0.txt', 'groups', model, function() {
                extractGroups(model);
                extractMemberships(model);

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
                            log().info({results: results}, 'Performance testing complete.');
                            process.exit(0);
                        }
                    } else {
                        console.log('Error running performance testing phases. Please see the log for more information.');
                        log().error({err: err}, 'Error running performance testing phases.');
                        process.exit(0);
                    }
                }

                runPhases(0, tenantGroups, model, results, trackPhases);
            });
        });
    } else {
        console.log('Error initializing OAE for performance tests. Please see the log for more information.');
        log().error({err: err}, 'Error initializing OAE for performance tests.');
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
}

/**
 * Extract / expand all groups in the given model. The reason they need expanding is to create "role groups" for each
 * top-level group. For example, if group my-group has a set of users that are managers, then there will be a role-group
 * called "my-group-managers" that holds all those users as members. This is to form a group hierarchy for performance
 * testing checks.
 */
var extractGroups = function(model) {
    var subGroups = [];

    // extract the role-based groups, e.g., manager, lecturer, etc...
    model.groups.forEach(function(group) {
        Object.keys(group.roles).forEach(function(role) {
            subGroups.push({
                creator: group.creator,
                id: group.id+'-'+role
            })
        });
    });

    subGroups.forEach(function(subGroup) {
        model.groups.push(subGroup);
    })
}

/**
 * Extract all the group memberships from the model.
 */
var extractMemberships = function(model) {
    var groups = model['groups'];
    var membershipsHash = {}

    groups.forEach(function(group) {
        membershipsHash[group.id] = {};
        if (group.roles) {
            Object.keys(group.roles).forEach(function(role) {

                var roleGroupId = group.id+'-'+role;

                // add the role-group to the group
                membershipsHash[group.id][roleGroupId] = {
                    creatorId: group.creator,
                    groupId: group.id,
                    memberId: roleGroupId,
                    memberType: 'g',
                    role: role
                };

                // seed the role-group's membership hash
                membershipsHash[roleGroupId] = {};

                // add all the user memberships to the role-group
                group.roles[role].users.forEach(function(memberId) {
                    if (memberId !== group.creator) {
                        if (!membershipsHash[roleGroupId][memberId]) {
                            membershipsHash[roleGroupId][memberId] = {
                                creatorId: group.creator,
                                groupId: roleGroupId,
                                memberId: memberId,
                                memberType: 'u',
                                role: 'member'
                            };
                        }
                    }
                });
            });
        }

    });

    var memberships = model['memberships'] = [];
    Object.keys(membershipsHash).forEach(function(groupId) {
        Object.keys(membershipsHash[groupId]).forEach(function(memberId) {
            var membership = membershipsHash[groupId][memberId];
            memberships.push(membership);
        });
    });

}
