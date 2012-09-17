var exec = require('child_process').exec;
var oae = require('oae-util/lib/oae');

oae.getAvailableModules(function(modules) {

    var total_modules = modules.length;
    var instrumented_modules = 0;

    var instrumented = function(error, stdout, stderr) {
        instrumented_modules++;

        if (error) {
            console.log(stdout);
            console.log(stderr);
            throw "Couldn't instrument a module. Aborting.";
        }
    };

    var instrument = function(dir, module) {
        exec('jscoverage --no-highlight target/' + dir + '/lib target/' + dir + '/lib-cov', function(error, stdout, stderr) {
            // Replace filenames in instrumentation with entire path.
            exec('find target/' + dir + '/lib-cov/ -type f -exec ./replace.py {} "' + module + '/lib" \\;', function(error, stdout, stderr) {
                exec('rm -r target/' + dir + '/lib', function(error, stdout, stderr) {
                    exec('mv target/' + dir + '/lib-cov target/' + dir + '/lib', instrumented);
                });
            });
        });
    };

    for (var i = 0; i < modules.length;i++) {
        var dir = 'node_modules/' + modules[i];
        instrument(dir, modules[i]);
    }
});