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

/**
 * This file goes trough all the OAE modules their lib folder and instruments the code.
 * This allows mocha to get useful metrics when running the tests and generate a code coverage report.
 * By default the jscoverage tool instruments each file with it's filename.
 * Because we have files with similar filenames (ex: api.js) we prepend the modulename.
 */

var exec = require('child_process').exec;
var oae = require('oae-util/lib/oae');

oae.getAvailableModules(function(modules) {

    var abortIfError = function(error, stdout, stderr) {
        if (error) {
            console.log(stdout);
            console.log(stderr);
            throw "Couldn't instrument a module. Aborting.";
        }
    };

    var instrument = function(dir, module) {
        exec('jscoverage --no-highlight target/' + dir + '/lib target/' + dir + '/lib-cov', function(error, stdout, stderr) {
            abortIfError(error, stdout, stderr);
            // Replace filenames in instrumentation with entire path.
            exec('find target/' + dir + '/lib-cov/ -type f -exec node tests/replace.js {} "' + module + '/lib" \\;', function(error, stdout, stderr) {
                abortIfError(error, stdout, stderr);
                exec('rm -r target/' + dir + '/lib', function(error, stdout, stderr) {
                    abortIfError(error, stdout, stderr);
                    exec('mv target/' + dir + '/lib-cov target/' + dir + '/lib', abortIfError);
                });
            });
        });
    };

    for (var i = 0; i < modules.length;i++) {
        var dir = 'node_modules/' + modules[i];
        instrument(dir, modules[i]);
    }
});