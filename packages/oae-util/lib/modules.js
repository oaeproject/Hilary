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

import process from 'node:process';
import fs, { stat } from 'node:fs';

import { promisify, callbackify } from 'node:util';
import { readFile } from 'node:fs/promises';
import Path from 'node:path';
import _ from 'underscore';

import { logger } from 'oae-logger';
import * as OaeUtil from 'oae-util/lib/util.js';
import { compose, map, prop, sortBy } from 'ramda';

import ora from 'ora';
import * as IO from './io.js';

const { getNodeModulesDir, serial } = OaeUtil;
const log = logger('oae-modules');

// Variable that will be used to cache the available modules
let cachedAvailableModules = [];

/**
 * Module bootstrapping
 */

/**
 * Bootstrap all the OAE modules that are present. This will first execute all of the init.js files for all of the modules which will
 * take care of CF creation, etc., next it will execute all of the rest.js files for all of the modules which will register the REST
 * endpoints on the global admin server and the tenant server
 *
 * @param  {Object}     config          JSON object containing configuration values for Cassandra, Redis, logging and telemetry
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const bootstrapModules = function (config, callback) {
  callbackify(initAvailableModules)((error, modules) => {
    if (error) return callback(error);

    if (_.isEmpty(modules)) {
      return callback(new Error('No modules to install, or error aggregating modules.'));
    }

    log().info('Starting modules: %s', modules.join(', '));

    // Initialize all modules
    callbackify(bootstrapModulesInit)(modules, config, (error_) => {
      if (error_) return callback(error_);

      // Register all endpoints
      return callbackify(bootstrapModulesRest)(modules, callback);
    });
  });
};

/**
 * Initialize all of the modules.
 * This will take care of CF creation, etc. This needs to happen asynchronously
 * as column family creation and
 * refreshing the schema needs to happen asynchronously.
 *
 * @param  {String[]}   modules         An array of modules that should be bootstrapped. These need to be located in the ./node_modules directory
 * @param  {Object}     config          JSON object containing configuration values for Cassandra, Redis, logging and telemetry
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const bootstrapModulesInit = function (modules, config) {
  const MODULE_INIT_FILE = '/lib/init.js';
  let spinner;

  return serial(
    modules.map((moduleName) => {
      const moduleInitPath = Path.join(getNodeModulesDir(), moduleName, MODULE_INIT_FILE);

      return () =>
        new Promise((resolve, reject) => {
          spinner = ora({
            text: `Loading ${moduleName}...`
          }).start();

          promisify(stat)(moduleInitPath)
            .then((stat) => {
              if (stat.isFile()) {
                // ES6 modules cannot have an export default as a function, so init it exported instead
                import(process.cwd() + '/node_modules/' + moduleName + MODULE_INIT_FILE)
                  .then((pkg) => promisify(pkg.init)(config))
                  .then(() => {
                    spinner.succeed(`Loaded module ${moduleName}`);
                    resolve();
                  })
                  .catch((error) => {
                    spinner.fail(`Failed to load module ${moduleName}`);
                    reject(error);
                  });
              }
            })
            .catch((_error) => {
              // There's no init method, skipping
              spinner.succeed(`Loaded module ${moduleName}`);
              resolve();
            });
        });
    })
  )
    .catch((error) => {
      spinner.fail(`Something went wrong when loading modules sequentially!`);
      log().error(error);
    })
    .finally(() => {
      spinner.stop();
    });
};

/**
 * Initialize all of the REST endpoints for all of the modules
 *
 * @param  {String[]}   modules         An array of modules that should be bootstrapped. These need to be located in the ./node_modules directory
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const bootstrapModulesRest = function (modules) {
  const MODULE_REST_FILE = '/lib/rest.js';
  let spinner;

  return serial(
    modules.map((moduleName) => {
      const moduleRestPath = Path.join(getNodeModulesDir(), moduleName, MODULE_REST_FILE);

      return () =>
        new Promise((resolve, reject) => {
          spinner = ora({
            text: `Loading routes for ${moduleName}...`
          }).start();
          promisify(fs.stat)(moduleRestPath)
            .then((stat) => {
              if (stat.isFile()) {
                log().info('REST services for %s have been registered', moduleName);
                import(process.cwd() + '/node_modules/' + moduleName + MODULE_REST_FILE)
                  .then((_restModule) => {
                    spinner.succeed(`Loaded routes for module ${moduleName}`);
                    resolve();
                  })
                  .catch((error) => {
                    spinner.fail(`Failed to load routes for module ${moduleName}`);
                    reject(error);
                  });
              }
            })
            .catch((_error) => {
              // There's no rest module, skipping
              spinner.succeed(`Loaded routes for module ${moduleName}`);
              resolve();
            });
        });
    })
  )
    .catch((error) => {
      spinner.fail(`Something went wrong when loading REST modules sequentially!`);
      log().error(error);
    })
    .finally(() => {
      spinner.stop();
    });
};

/**
 * Available modules
 */

/**
 * Get a list of all of the available modules, ordered by priority, and cache them
 *
 * @param  {Function}   callback                Standard callback function
 * @param  {String[]}   callback.finalModules   Array of strings representing the names of the available modules
 */
const initAvailableModules = function () {
  return promisify(IO.getFileListForFolder)(getNodeModulesDir())
    .then((modules) => modules.filter((each) => each.startsWith('oae-')))
    .then((modules) =>
      Promise.all(
        modules.map(
          (each) =>
            new Promise((resolve, reject) => {
              readFile(Path.join(process.cwd(), 'node_modules', each, 'package.json'), 'utf8')
                .then((data) => JSON.parse(data))
                .then((pkg) => {
                  if (pkg.oae && pkg.oae.priority) {
                    // Found a priority in package.json at oae.priority
                    resolve({ module: pkg.name, priority: pkg.oae.priority });
                  } else {
                    // No priority found, it goes in last
                    resolve({ module: pkg.name, priority: Number.MAX_VALUE });
                  }
                })
                .catch((error) => {
                  reject(error);
                });
            })
        )
      )
    )
    .then((result) => {
      // Order by the startup priority
      const sortByPriority = sortBy(prop('priority'));
      const getModuleName = map(prop('module'));
      const finalModules = compose(getModuleName, sortByPriority)(result);

      // Cache the available modules
      cachedAvailableModules = finalModules;

      return finalModules;
    });
};
/*
    // Aggregate the oae- modules
    for (const module of modules) {
      if (module.slice(0, 4) === 'oae-') {
        // Determine module priority
        const filename = module + '/package.json';
        // const pkg = require(filename);
        import(filename).then((pkg) => {
          if (pkg.oae && pkg.oae.priority) {
            // Found a priority in package.json at oae.priority
            modulePriority[module] = pkg.oae.priority;
          } else {
            // No priority found, it goes in last
            modulePriority[module] = Number.MAX_VALUE;
          }
          finalModules.push(module);
        });
      }
    }
    */

/**
 * Returns the available modules from cache
 *
 * @return {String[]}   Returns an Array of strings representing the names of the available modules
 */
const getAvailableModules = function () {
  return [...cachedAvailableModules];
};

export { initAvailableModules, getAvailableModules, bootstrapModules };
