module.exports = function(grunt) {

    var shell = require('shelljs');
    var mocha_grep = process.env['MOCHA_GREP'] || undefined;

    // Project configuration.
    grunt.initConfig({
        pkg: '<json:package.json>',
        lint: {
            files: ['grunt.js', 'node_modules/oae-*/lib/**/*.js', 'node_modules/oae-*/tests/**/*.js']
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

    // Override default test task to use simplemocha
    grunt.registerTask('test', 'simplemocha');
    // Run test coverage and open the report
    grunt.registerTask('test-coverage', 'clean copy:coverage jscoverage test-instrumented showFile:target/coverage.html');
    // Default task.
    grunt.registerTask('default', 'lint test');

};
