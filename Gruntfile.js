#!/usr/bin/env node
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

/* eslint-disable no-use-before-define, camelcase, unicorn/filename-case, no-unused-vars, no-use-extend-native/no-use-extend-native */

module.exports = grunt => {
  const _ = require('underscore');
  const shell = require('shelljs');
  const util = require('util');
  const mocha_grep = process.env.MOCHA_GREP;

  // Timeout used to determine when a test has failed
  const MOCHA_TIMEOUT = 60000;

  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    'mocha-hack': {
      all: {
        src: ['node_modules/oae-tests/runner/beforeTests.js', 'node_modules/oae-*/tests/**/*.js'],
        options: {
          timeout: MOCHA_TIMEOUT,
          ignoreLeaks: false,
          fullStackTrace: true,
          reporter: 'spec',
          // eslint-disable-next-line camelcase
          grep: mocha_grep,
          bail: false,
          slow: 500,
          globals: ['oaeTests']
        }
      }
    },
    clean: ['target/']
  });

  // Override default test task to use mocha-hack
  grunt.registerTask('test', ['mocha-hack']);

  // Make a task for running tests on a single module
  grunt.registerTask('test-module', 'Test a single module', module => {
    const config = {
      src: [
        'node_modules/oae-tests/runner/beforeTests.js',
        'node_modules/' + module + '/tests/**/*.js'
      ],
      options: grunt.config.get('mocha-hack.all.options')
    };
    grunt.config.set('mocha-hack.' + module, config);
    grunt.task.run('mocha-hack:' + module);
  });

  // Bring in tasks from npm
  // Temporary work around till https://github.com/yaymukund/grunt-simple-mocha/issues/16 lands.
  grunt.loadNpmTasks('grunt-mocha-hack');
  grunt.loadNpmTasks('grunt-contrib-clean');

  // Copies the files that need to go in the release.
  // We remove the test files and the Grunt file as it could be potentially
  // devestating to run the tests in a production environment.
  // Example:
  //     grunt release:/tmp/release
  // will copy only those files you really need in order to run Hilary in a folder at `/tmp/release`.
  grunt.registerTask('release', outputDir => {
    if (!outputDir) {
      return grunt.log.writeln('Please provide a path where the files should be copied to'.red);
    }

    shell.exec('bin/package -so ' + outputDir);
  });

  // Default task.
  grunt.registerTask('default', ['check-style', 'test']);
};
