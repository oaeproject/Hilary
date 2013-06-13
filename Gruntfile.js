/*
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
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

    var shell = require('shelljs');
    var mocha_grep = process.env['MOCHA_GREP'] || undefined;

    // Timeout used to determine when a test has failed
    var MOCHA_TIMEOUT = 40000;

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
        'copy': {
            'coverage': {
                'files': {
                    'target/': '**'
                }
            }
        },
        'replace': {
            'jsdoc': {
                'src': ['node_modules/oae-*/**/*.js'],
                'overwrite': true,
                'replacements': [
                    {
                        'from': /@param (\S|\s\s)/,
                        'to': function(matchedWord, index, fullText, regexMatches) {
                            var msg ='@param  should be followed by 2 spaces';
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

    // Make a task for running jscoverage
    grunt.registerTask('jscoverage', 'Run jscoverage on the `target` dir', function() {
        grunt.task.requires('copy:coverage');
        shell.exec('node node_modules/oae-tests/runner/instrument_code.js "' + __dirname + '"');
        grunt.log.writeln('Code instrumented'.green);
    });

    grunt.registerTask('test-instrumented', 'Runs mocha tests on the instrumented code', function() {
        // Mocha can't write to a file and mocha-hack doesn't add that functionality, so we'll just shell.exec it here since we need the output :P
        shell.cd('target');
        // Set a covering environment variable, as this will be used to determine where the UI resides relative to the Hilary folder.
        shell.env['OAE_COVERING'] = true;
        var MODULES = grunt.file.expand({'filter': 'isDirectory'},'node_modules/oae-*/tests').join(' ');
        var output = shell.exec('../node_modules/.bin/mocha --ignore-leaks --timeout ' + MOCHA_TIMEOUT + ' --reporter html-cov node_modules/oae-tests/runner/beforeTests.js ' + MODULES, {silent:true}).output;
        output.to('coverage.html');
        grunt.log.writeln('Code Coverage report generated at target/coverage.html'.cyan);

    });

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
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-text-replace');

    // Override default test task to use mocha-hack
    grunt.registerTask('test', ['mocha-hack']);
    // Run test coverage and open the report
    grunt.registerTask('test-coverage', ['clean', 'copy:coverage', 'jscoverage', 'test-instrumented', 'showFile:coverage.html']);
    // Default task.
    grunt.registerTask('default', ['check-style', 'test']);

};
