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

/* eslint-disable import/no-mutable-exports */
import { logger } from 'oae-logger';
import * as Modules from './modules';
import OaeEmitter from './emitter';
import * as Server from './server';

import * as Shutdown from './internal/shutdown';

const log = logger();

const SHUTDOWN_GRACE_TIME_MILLIS = 60000;
const PRESHUTDOWN_DEFAULT_TIMEOUT_MILLIS = 15000;

/// //////////////////////////
// Configuration variables //
/// //////////////////////////

// Variables in which the global admin server and the tenant server will be cached
let globalAdminServer = null;
let tenantServer = null;
let tenantRouter = null;
let globalAdminRouter = null;

/// ////////////////////////
// Setting up the server //
/// ////////////////////////

/**
 * This function will initialize OAE. First of all, the global  and run the global admin server, as well as execute the application lifecycle of all the
 * OAE modules in the system. This will invoke auxilliary initialization procedures in the proper order specified in the package.json file.
 *
 * When initializing the container, each OAE module that has a lib/init.js file will be required and the export object will be executed
 * directly.
 *
 * After this, the tenant server will be started, which will be used to serve all of the REST request for actual tenants. The current tenant will be
 * determined based on the HOST header in the request.
 *
 * @param  {Object}     config          JSON object containing configuration values for Cassandra, Redis, logging and telemetry
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const init = function(config, callback) {
  callback = callback || function() {};

  log().info('Starting OAE...');

  // Make sure all Dates are in UTC
  process.env.TZ = 'UTC';

  // Set up application-level error handler
  process.on('uncaughtException', err => {
    log().error({ err }, 'An uncaught exception was raised to the application');
    log().error(err.stack);
  });

  // Handle the shutdown signal
  process.on('SIGTERM', () => {
    Shutdown.shutdown(PRESHUTDOWN_DEFAULT_TIMEOUT_MILLIS, SHUTDOWN_GRACE_TIME_MILLIS);
  });

  // Start up the global and tenant servers
  globalAdminServer = Server.setupServer(config.servers.globalAdminPort, config);
  tenantServer = Server.setupServer(config.servers.tenantPort, config);
  tenantRouter = Server.setupRouter(tenantServer);
  globalAdminRouter = Server.setupRouter(globalAdminServer);

  // Initialize the modules and their CFs, as well as registering the Rest endpoints
  Modules.bootstrapModules(config, err => {
    log().info('All modules are bootstrapped, initializing servers');
    if (err) {
      return callback(err);
    }

    Server.postInitializeServer(globalAdminServer, globalAdminRouter);
    Server.postInitializeServer(tenantServer, tenantRouter);

    OaeEmitter.emit('ready');

    log().info('Initialization all done ... Firing up tenants ... Enjoy!');
    return callback();
  });
};

/**
 * Register a handler that is invoked when the application process has been "killed" (SIGTERM). The purpose of the
 * pre-shutdown handler is to gracefully put the system in a state where it does not receive new work. For example:
 *
 *  1. Shut down the web server listeners such that new user web requests are not proxied to this app node; or
 *  2. unbind RabbitMQ task listeners so this node does not receive anymore tasks such as indexing, activity, etc...
 *
 * @param  {String}     name                The name of the handler, it should be unique, so make sure you prefix it with your module
 * @param  {Number}     [maxTimeMillis]     The maximum amount of time to allow for this handler to finish before moving on to shutdown. Default `PRESHUTDOWN_DEFAULT_TIMEOUT_MILLIS` (15 seconds)
 * @param  {Function}   handler             The handler function that will be invoked when the system receives a shutdown signal
 * @param  {Function}   handler.callback    A callback function that the handler should invoke when the pre-shutdown work is finished
 */
const registerPreShutdownHandler = function(name, maxTimeMillis, handler) {
  Shutdown.registerPreShutdownHandler(name, maxTimeMillis, handler);
};

export {
  // OaeEmitter,
  globalAdminServer,
  tenantServer,
  tenantRouter,
  globalAdminRouter,
  init,
  registerPreShutdownHandler
};
