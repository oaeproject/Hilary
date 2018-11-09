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
  const shell = require('shelljs');

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
  });

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
};
