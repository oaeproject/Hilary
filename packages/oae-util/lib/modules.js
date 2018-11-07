/*!
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

const fs = require('fs');
const async = require('async');
const _ = require('underscore');

const log = require('oae-logger').logger('oae-modules');
const OaeUtil = require('oae-util/lib/util');
const IO = require('./io');
const Swagger = require('./swagger');

// Variable that will be used to cache the available modules
let cachedAvailableModules = [];

/// ///////////////////////
// Module bootstrapping //
/// ///////////////////////

/**
 * Bootstrap all the OAE modules that are present. This will first execute all of the init.js files for all of the modules which will
 * take care of CF creation, etc., next it will execute all of the rest.js files for all of the modules which will register the REST
 * endpoints on the global admin server and the tenant server
 *
 * @param  {Object}     config          JSON object containing configuration values for Cassandra, Redis, logging and telemetry
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const bootstrapModules = function(config, callback) {
  initAvailableModules((err, modules) => {
    if (err) {
      return callback(err);
    }
    if (_.isEmpty(modules)) {
      return callback(new Error('No modules to install, or error aggregating modules.'));
    }

    log().info('Starting modules: %s', modules.join(', '));

    // Initialize all modules
    bootstrapModulesInit(modules, config, err => {
      if (err) {
        return callback(err);
      }
      // Register all endpoints
      return bootstrapModulesRest(modules, callback);
    });
  });
};

/**
 * Initialize all of the modules. This will take care of CF creation, etc. This needs to happen asynchronously as column family creation and
 * refreshing the schema needs to happen asynchronously.
 *
 * @param  {String[]}   modules         An array of modules that should be bootstrapped. These need to be located in the ./node_modules directory
 * @param  {Object}     config          JSON object containing configuration values for Cassandra, Redis, logging and telemetry
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const bootstrapModulesInit = function(modules, config, callback) {
  const MODULE_INIT_FILE = '/lib/init.js';
  async.mapSeries(
    modules,
    (moduleName, done) => {
      const moduleInitPath = OaeUtil.getNodeModulesDir() + moduleName + MODULE_INIT_FILE;

      if (fs.existsSync(moduleInitPath)) {
        require(moduleName + MODULE_INIT_FILE)(config, err => {
          if (err) {
            log().error(err.stack);
            log().error({ err }, 'Error initializing module %s', moduleName);
            return callback(err);
          }
          log().info('Initialized module %s', moduleName);
          done();
        });
      } else {
        done();
      }
    },
    err => {
      if (err) {
        callback(err);
      }
      callback(null);
    }
  );
};

/**
 * Initialize all of the REST endpoints for all of the modules
 *
 * @param  {String[]}   modules         An array of modules that should be bootstrapped. These need to be located in the ./node_modules directory
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const bootstrapModulesRest = function(modules, callback) {
  const complete = _.after(modules.length, callback);
  _.each(modules, module => {
    const path = OaeUtil.getNodeModulesDir() + module + '/lib/rest.js';
    if (fs.existsSync(path)) {
      log().info('REST services for %s have been registered', module);
      require(module + '/lib/rest');
    }
    // Swagger document all modules
    return Swagger.documentModule(module, complete);
  });
};

/// ////////////////////
// Available modules //
/// ////////////////////

/**
 * Get a list of all of the available modules, ordered by priority, and cache them
 *
 * @param  {Function}   callback                Standard callback function
 * @param  {String[]}   callback.finalModules   Array of strings representing the names of the available modules
 */
const initAvailableModules = function(callback) {
  IO.getFileListForFolder(OaeUtil.getNodeModulesDir(), (err, modules) => {
    if (err) {
      return callback(err);
    }

    const finalModules = [];
    const modulePriority = {};

    // Aggregate the oae- modules
    for (let i = 0; i < modules.length; i++) {
      const module = modules[i];
      if (module.substring(0, 4) === 'oae-') {
        // Determine module priority
        const filename = module + '/package.json';
        const pkg = require(filename);
        if (pkg.oae && pkg.oae.priority) {
          // Found a priority in package.json at oae.priority
          modulePriority[module] = pkg.oae.priority;
        } else {
          // No priority found, it goes in last
          modulePriority[module] = Number.MAX_VALUE;
        }

        finalModules.push(module);
      }
    }

    // Order by the startup priority
    finalModules.sort((a, b) => {
      return modulePriority[a] - modulePriority[b];
    });

    // Cache the available modules
    cachedAvailableModules = finalModules;

    callback(null, finalModules);
  });
};

/**
 * Returns the available modules from cache
 *
 * @return {String[]}   Returns an Array of strings representing the names of the available modules
 */
const getAvailableModules = function() {
  return cachedAvailableModules.slice(0);
};

module.exports = {
  initAvailableModules,
  getAvailableModules,
  bootstrapModules
};
