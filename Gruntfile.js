/*
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
 */

module.exports = function(grunt) {
    var _ = require('underscore');
    var path = require('path');
    var shell = require('shelljs');
    var util = require('util');
    var mocha_grep = process.env['MOCHA_GREP'] || undefined;

    // Timeout used to determine when a test has failed
    var MOCHA_TIMEOUT = 60000;

    var regexErrors = false;

    // Project configuration.
    grunt.initConfig({
        'pkg': grunt.file.readJSON('package.json'),
        'jslint': {
            'files': [
                'Gruntfile.js',
                'node_modules/oae-*/lib/**/*.js',
                'node_modules/oae-*/tests/**/*.js',
                'node_modules/oae-*/config/**/*.js'
            ]
        },
        'jshint': {
            'options': {
                'node': true,
                'sub': true,
                'indent': 4,
                'trailing': true,
                'quotmark': 'single',
                'curly': true,
                'white': false,
                'strict': false,
                'globals': {
                    'it': true,
                    'describe': true,
                    'before': true,
                    'beforeEach': true,
                    'after': true,
                    'afterEach': true
                }
            },
            'files': '<%= jslint.files %>'
        },
        'mocha-hack': {
            'all': {
                'src': ['node_modules/oae-tests/runner/beforeTests.js', 'node_modules/oae-*/tests/**/*.js'],
                'options': {
                    'timeout': MOCHA_TIMEOUT,
                    'ignoreLeaks': true,
                    'reporter': 'spec',
                    'grep': mocha_grep,
                    'bail': false,
                    'slow': 500
                }
            }
        },
        'clean': ['target/'],
        'replace': {
            'check-style': {
                'src': ['node_modules/oae-*/**/*.js'],
                'overwrite': true,
                'replacements': [
                    {
                        'from': /@param (\S|\s\s)/,
                        'to': function(matchedWord, index, fullText, regexMatches) {
                            var msg ='@param should be followed by 2 spaces';
                            return logMatch(msg, matchedWord, index, fullText, regexMatches);
                        }
                    },
                    {
                        'from': /@return \s/,
                        'to': function(matchedWord, index, fullText, regexMatches) {
                            var msg ='@return should be followed by 1 space';
                            return logMatch(msg, matchedWord, index, fullText, regexMatches);
                        }
                    },
                    {
                        'from': /@returns/,
                        'to': function(matchedWord, index, fullText, regexMatches) {
                            var msg ='Use @return instead of @returns';
                            return logMatch(msg, matchedWord, index, fullText, regexMatches);
                        }
                    },
                    {
                        'from': /@throws \s/,
                        'to': function(matchedWord, index, fullText, regexMatches) {
                            var msg ='@throws should be followed by 1 space';
                            return logMatch(msg, matchedWord, index, fullText, regexMatches);
                        }
                    },
                    {
                        'from': /(tenant|globalAdmin)Server\.(get|post|put|head|del)\((.*)/,
                        'to': function(matchedWord, index, fullText, regexMatches) {
                            var msg = 'Do not use the tenantServer or globalAdminServer to bind routes. Use the Router object like this:\n\n  ' + regexMatches[0] + 'Router.on(\'' + regexMatches[1] + '\', ' + regexMatches[2];
                            return logMatch(msg, matchedWord, index, fullText, regexMatches);
                        }
                    }
                ]
            }
        }
    });

    // Utility function for logging regex matches
    var logMatch = function(msg, matchedWord, index, fullText, regexMatches) {
        var lineNum = fullText.substring(0, index).match(/\n/g).length + 1;
        var line = fullText.split('\n')[lineNum - 1];
        grunt.log.writeln(msg.red + ': ' + lineNum + ': ' + line);
        regexErrors = true;
        return matchedWord;
    };

    // Task to run the regex task and fail if it matches anything
    grunt.registerTask('check-style', ['replace', 'jshint', 'checkRegexErrors']);
    grunt.registerTask('checkRegexErrors', function() {
        grunt.task.requires('replace');
        if (regexErrors) {
            grunt.warn('Style rule validation failed');
        }
    });

    // Override default test task to use mocha-hack
    grunt.registerTask('test', ['mocha-hack']);

    // Make a task for running tests on a single module
    grunt.registerTask('test-module', 'Test a single module', function(module) {
        var config = {
            'src': ['node_modules/oae-tests/runner/beforeTests.js', 'node_modules/' + module + '/tests/**/*.js'],
            'options': {
                'timeout': MOCHA_TIMEOUT,
                'ignoreLeaks': true,
                'reporter': 'spec',
                'grep': mocha_grep
            }
        };
        grunt.config.set('mocha-hack.' + module, config);
        grunt.task.run('mocha-hack:' + module);
    });

    // Runs the unit tests and dumps some coverage data
    grunt.registerTask('test-instrumented', function(report) {
        // If no report format was provided, we default to `lcov` which generates lcov and html
        report = report || 'lcov';

        // Get the modules that should be excluded
        var nonOaeModules = grunt.file.expand({'filter': 'isDirectory'}, 'node_modules/*', '!node_modules/oae-*');
        var nonOaeModulesParameters = _.map(nonOaeModules, function(module) {
            return util.format('-x %s/\\*\\*', module);
        });

        // Exclude the tests from the coverage reports
        var oaeModules = grunt.file.expand({'filter': 'isDirectory'}, 'node_modules/oae-*');
        var testDirectories = _.map(oaeModules, function(directory) {
            return util.format('-x %s/tests/\\*\\*', directory);
        });
        var testUtilDirectories = _.map(oaeModules, function(directory) {
            return util.format('-x %s/lib/test/\\*\\*', directory);
        });

        // Exclude the config directories
        var configDirectories = _.map(oaeModules, function(module) {
            return util.format('-x %s/config/\\*\\*', module);
        });

        // Build up one big set of exlusion filters
        var excludeFilters = _.union(nonOaeModulesParameters, testDirectories, testUtilDirectories, configDirectories);
        excludeFilters.push('-x Gruntfile.js');

        var cmd = util.format('node_modules/.bin/istanbul cover --verbose --dir target --no-default-excludes %s --report %s ./node_modules/grunt-cli/bin/grunt', excludeFilters.join(' '), report);
        var code = shell.exec(cmd).code;
        if (code !== 0) {
            process.exit(code);
        }
    });

    // Sends a coverage report to coveralls.io
    grunt.registerTask('coveralls', function() {
        // This assumes we're executing within the context of Travis CI
        // If not, you'll have to add a .converalls.yml file with `repo_token: ...` in it
        shell.exec('cat ./target/lcov.info | ./node_modules/coveralls/bin/coveralls.js');
    });

    // Run test coverage and open the report
    grunt.registerTask('test-coverage', ['clean', 'test-instrumented', 'showFile:target/lcov-report/index.html']);

    // Run test coverage
    grunt.registerTask('test-coverage-coveralls', ['clean', 'test-instrumented:lcovonly', 'coveralls']);

    // Make a task to open the browser
    grunt.registerTask('showFile', 'Open a file with the OS default viewer', function(file) {
        var browser = shell.env['BROWSER'];
        if (! browser) {
            if (process.platform === 'linux') {
                browser = 'xdg-open';
            } else if (process.platform === 'darwin') {
                browser = 'open';
            } else if (process.platform === 'win32') {
                browser = 'explorer.exe';
            }
        }
        if (browser) {
            shell.exec(browser + ' '  + ( file || 'target/coverage.html' ));
        }
    });

    // Bring in tasks from npm
    // Temporary work around till https://github.com/yaymukund/grunt-simple-mocha/issues/16 lands.
    grunt.loadNpmTasks('grunt-mocha-hack');
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-clean');
    grunt.loadNpmTasks('grunt-text-replace');

    // Copies the files that need to go in the release.
    // We remove the test files and the Grunt file as it could be potentially
    // devestating to run the tests in a production environment.
    // Example:
    //     grunt release:/tmp/release
    // will copy only those files you really need in order to run Hilary in a folder at `/tmp/release`.
    grunt.registerTask('release', function(outputDir) {
        if (!outputDir) {
            return grunt.log.writeln('Please provide a path where the files should be copied to'.red);
        }

        shell.exec('bin/package -so ' + outputDir);
    });

    // Default task.
    grunt.registerTask('default', ['check-style', 'test']);

};
