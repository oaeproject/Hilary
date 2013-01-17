module.exports = function(grunt) {

    var shell = require('shelljs');
    var mocha_grep = process.env['MOCHA_GREP'] || undefined;

    var regexErrors = false;

    // Project configuration.
    grunt.initConfig({
        pkg: '<json:package.json>',
        lint: {
            files: ['grunt.js', 'node_modules/oae-*/lib/**/*.js', 'node_modules/oae-*/tests/**/*.js', 'node_modules/oae-*/config/**/*.js']
        },
        watch: {
            files: '<config:lint.files>',
            tasks: 'default'
        },
        jshint: {
            options: {
                node: true,
                sub: true,
                indent: 4,
                //trailing: true,
                quotmark: 'single',
                curly: true,
                white: false,
                strict: false
            },
            globals: {
                exports: true
            }
        },
        simplemocha: {
            all: {
                src: ['node_modules/oae-tests/runner/beforeTests.js', 'node_modules/oae-*/tests/**/*.js'],
                options: {
                    timeout: 30000,
                    ignoreLeaks: true,
                    reporter: 'spec',
                    grep: mocha_grep
                }
            }
        },
        clean: {
            folder: 'target/'
        },
        copy: {
            coverage: {
                files: {
                    'target/': '**'
                }
            }
        },
        replace: {
            jsdoc: {
                src: ['node_modules/oae-*/**/*.js'],
                overwrite: true,
                replacements: [
                    {
                        from: /@param (\S|\s\s)/,
                        to: function(matchedWord, index, fullText, regexMatches) {
                            var msg ='@param should be followed by 2 spaces';
                            return logMatch(msg, matchedWord, index, fullText, regexMatches);
                        }
                    },
                    {
                        from: /@return \s/,
                        to: function(matchedWord, index, fullText, regexMatches) {
                            var msg ='@return should be followed by 1 space';
                            return logMatch(msg, matchedWord, index, fullText, regexMatches);
                        }
                    },
                    {
                        from: /@returns/,
                        to: function(matchedWord, index, fullText, regexMatches) {
                            var msg ='Use @return instead of @returns';
                            return logMatch(msg, matchedWord, index, fullText, regexMatches);
                        }
                    },
                    {
                        from: /@throws \s/,
                        to: function(matchedWord, index, fullText, regexMatches) {
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
    grunt.registerTask('check-style', function() {
        grunt.task.run('replace');
        grunt.task.run('lint');
        grunt.task.run('checkRegexErrors');
    });
    grunt.registerTask('checkRegexErrors', function() {
        grunt.task.requires('replace');
        if (regexErrors) {
            grunt.warn('Style rule validation failed');
        }
    });

    // Make a task for running tests on a single module
    grunt.registerTask('test-module', 'Test a single module', function(module) {
        var config = {
            src: ['node_modules/oae-tests/runner/beforeTests.js', 'node_modules/' + module + '/tests/**/*.js'],
            options: {
                timeout: 30000,
                ignoreLeaks: true,
                reporter: 'spec',
                grep: mocha_grep
            }
        };
        grunt.config.set('simplemocha.' + module, config);
        grunt.task.run('simplemocha:' + module);
    });

    // Make a task for running jscoverage
    grunt.registerTask('jscoverage', 'Run jscoverage on the `target` dir', function() {
        grunt.task.requires('copy:coverage');
        shell.exec('node node_modules/oae-tests/runner/instrument_code.js "' + __dirname + '"');
        grunt.log.writeln('Code instrumented'.green);
    });

    grunt.registerTask('test-instrumented', 'Runs mocha tests on the instrumented code', function() {
        // Mocha can't write to a file and simplemocha doesn't add that functionality, so we'll just shell.exec it here since we need the output :P
        shell.cd('target');
        // Set a covering environment variable, as this will be used to determine where the UI resides relative to the Hilary folder.
        shell.env['OAE_COVERING'] = true;
        var MODULES = grunt.file.expandDirs('node_modules/oae-*/tests').join(' ');
        var output = shell.exec('../node_modules/.bin/mocha --ignore-leaks --timeout 20000 --reporter html-cov node_modules/oae-tests/runner/beforeTests.js ' + MODULES, {silent:true}).output;
        output.to('coverage.html');
        grunt.log.writeln('Code Coverage report generated at ' + 'target/coverage.html'.cyan);

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
            shell.exec(browser + ' coverage.html');
        }
    });

    // Bring in tasks from npm
    grunt.loadNpmTasks('grunt-simple-mocha');
    grunt.loadNpmTasks('grunt-clean');
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-text-replace');

    // Override default test task to use simplemocha
    grunt.registerTask('test', 'simplemocha');
    // Run test coverage and open the report
    grunt.registerTask('test-coverage', 'clean copy:coverage jscoverage test-instrumented showFile:target/coverage.html');
    // Default task.
    grunt.registerTask('default', 'check-style test');

};
