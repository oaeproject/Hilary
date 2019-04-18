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

import _ from 'underscore';
import { logger } from 'oae-logger';

const log = logger('oae-util-shutdown');

// Variables that track the shutdown status of the system
const preShutdownHandlers = {};
let shuttingDown = false;

/**
 * Register a handler that is invoked when the application process has been "killed" (SIGTERM).
 * @see OAE#registerPreShutdownHandler
 */
const registerPreShutdownHandler = function(name, maxTimeMillis, handler) {
  preShutdownHandlers[name] = { maxTimeMillis, handler };
};

/**
 * Perform a graceful shutdown of the system. The technique for shutdown right now is basically:
 *
 *  1.  Pre-shutdown. All modules that have registered pre-shutdown handlers have an opportunity to stop any
 *      listeners or processes that accept or invoke new work for the system; then
 *  2.  wait for a grace-time to shut down, as specified by `graceTimeoutMillis`.
 *
 * @param  {Number}     defaultPreShutdownTimeoutMillis     Each handler has an opportunity to register themselves with a timeout. If one registers without a timeout, this value is put in its place.
 * @param  {Number}     graceTimeoutMillis                  Maximum amount of time to wait for an app server to complete all processing before exiting the process
 */
const shutdown = function(defaultPreShutdownTimeoutMillis, graceTimeoutMillis) {
  if (!shuttingDown) {
    shuttingDown = true;
    log().info('Received shutdown signal, server is shutting down.');
    _preShutdown(defaultPreShutdownTimeoutMillis, () => {
      // Give a grace time to allow current processes to complete, then quit the process
      log().info(
        'System has stopped accepting new requests. Waiting %ss for current requests to complete. Send SIGTERM again to kill if you know that all processing has completed.',
        graceTimeoutMillis / 1000
      );

      // Handles the impatient sys-admin's follow-up SIGTERM to short-circuit the grace time
      process.on('SIGTERM', _exit);

      // Wait for the grace-time to kill the process.
      setTimeout(_exit, graceTimeoutMillis);
    });
  }
};

/**
 * Execute the pre-shutdown handlers that are registered with the module.
 *
 * @param  {Number}     defaultTimeoutMillis    For handlers that don't specify a timeout, this is the default amount of time to allow for pre-shutdown
 * @param  {Function}   callback                Standard callback function
 * @api private
 */
const _preShutdown = function(defaultTimeoutMillis, callback) {
  const todo = _.keys(preShutdownHandlers).length;
  let done = 0;
  _.each(preShutdownHandlers, handlerInfo => {
    let timeoutHandle = null;
    let complete = false;

    /*!
     * Keeps track of which pre-shutdown hooks have completed, including those that may have
     * timed out. Invokes the callback when all handlers have been accounted for.
     */
    const _monitorPreShutdown = function() {
      if (!complete) {
        complete = true;
        clearTimeout(timeoutHandle);

        done++;
        if (done === todo) {
          return callback();
        }
      }
    };

    // Set a timeout and invoke the handler. Whichever finishes first will tell _monitorPreShutdown they have finished.
    timeoutHandle = setTimeout(_monitorPreShutdown, handlerInfo.maxTimeMillis || defaultTimeoutMillis);
    handlerInfo.handler(_monitorPreShutdown);
  });
};

/**
 * Exit the process VIA `process.exit`.
 * @api private
 */
const _exit = function() {
  log().info('Exiting.');
  process.exit();
};

export { registerPreShutdownHandler, shutdown };
