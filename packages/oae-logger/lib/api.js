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

import { format } from 'node:util';
import process from 'node:process';
import _ from 'underscore';
import bunyan from 'bunyan';

import * as T from 'oae-telemetry/lib/api.js';

// The logger to use when no logger is specified
const SYSTEM_LOGGER_NAME = 'system';

// Logger state variables to record active loggers and current configuration
let config = null;
const loggers = {};

/**
 * Refresh the log configuration of all the cached logs with that of the provided log configuration.
 *
 * @param  {Object}     newConfig   The new configuration to apply to all the loggers
 */
const refreshLogConfiguration = function (newConfig) {
  logger('oae-logger')().info('Refreshing log configuration');
  config = newConfig;
  _refreshLogConfigurations();
};

/**
 * Create / retrieve a logger with the provided name.
 *
 * @param  {String}     name   The name of the logger, this name will be used to identify this logger for potentially custom log configuration
 * @return {Function}          A function that can be used to retrieve the logger takes argument `ctx`
 */
const logger = function (name = SYSTEM_LOGGER_NAME) {
  // Lazy-load the logger and cache it so new loggers don't have to be recreated all the time
  if (!loggers[name]) {
    loggers[name] = _createLogger(name);
  }

  // Return a function that returns the logger. this is the only way we can reserve the ability to refresh the logger
  // configuration on the fly. At the moment the "ctx" param is not used, however it is planned to be able to have
  // tenant/user-specific configuration or ctx-specific information in the log entries
  // eslint-disable-next-line no-unused-vars
  return function (ctx) {
    return loggers[name];
  };
};

/**
 * Update all the existing loggers to be configured with the current configuration.
 *
 * @api private
 */
const _refreshLogConfigurations = function () {
  _.each(loggers, (logger, name) => {
    loggers[name] = _createLogger(name);
  });
};

/**
 * Create a logger with the provided name.
 *
 * @param  {String}     name    The name to assign to the created logger
 * @return {Object}     logger  The logging object
 * @api private
 */
const _createLogger = function (name) {
  const _config = _.extend({}, config || _resolveBootstrapLoggerConfig());
  _config.name = name;

  // Construct a Logger object
  const logger = bunyan.createLogger(_config);

  // Wrap the error function so we can keep track of error counts
  logger.error = _wrapErrorFunction(name, logger.error);
  return logger;
};

/**
 * Determine what the default bootstrap logger configuration should be.
 *
 * @return {Object}    The log configuration to use by default
 * @api private
 */
const _resolveBootstrapLoggerConfig = function () {
  const bootstrapConfig = {
    streams: [
      {
        level: process.env.OAE_BOOTSTRAP_LOG_LEVEL || 'debug'
      }
    ],
    serializers: {
      err: bunyan.stdSerializers.err
    }
  };

  const bootstrapLogFile = process.env.OAE_BOOTSTRAP_LOG_FILE;
  if (bootstrapLogFile) {
    bootstrapConfig.streams[0].path = bootstrapLogFile;
  } else {
    bootstrapConfig.streams[0].stream = process.stdout;
  }

  return bootstrapConfig;
};

/**
 * Wrap the error logger function so we can count errors with the telemetry api
 *
 * @param  {String}     loggerName                The name of the logger for which the error logger will be wrapped
 * @param  {Function}   errorFunction       The error logger to wrap
 * @return {Function}                       A wrapped error logger
 * @api private
 */
const _wrapErrorFunction = function (loggerName, errorFunction) {
  /*!
   * Keep track of the error count with the telemetry API before handing control back to Bunyan
   */
  const wrapperErrorFunction = function (...args) {
    const Telemetry = T.telemetry('logger');

    // Increase the general error count that keeps track of the number of errors throughout the application
    Telemetry.incr('error.count');

    // Increase the error count for this specific logger
    Telemetry.incr(format('error.%s.count', loggerName));

    // Pass control back to bunyan who can log the message
    return errorFunction.apply(this, args);
    // });
  };

  return wrapperErrorFunction;
};

export { refreshLogConfiguration, logger };
