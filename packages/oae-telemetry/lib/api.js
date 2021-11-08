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

import { callbackify, format } from 'node:util';
import process from 'node:process';
import _ from 'underscore';

import * as EmitterAPI from 'oae-emitter';
import * as Locking from 'oae-util/lib/locking.js';
import { logger } from 'oae-logger';
import * as OaeUtil from 'oae-util/lib/util.js';
import * as Redis from 'oae-util/lib/redis.js';
import { isEmpty, head } from 'ramda';

let locker = null;
let lockerRedisClient = null;
let telemetryConfig = null;

// Will hold the local histogram (duration) data
let stats = null;
let publisher = null;
let publishIntervalId = null;
let resetIntervalId = null;

/**
 * ## TelemetryAPI
 *
 * ### Events
 *
 *  * `reset` - Indicates that the global telemetry counters were just reset
 *  * `publish(data)` - Indicates that data was just published to a telemetry publisher. The data that was published is provided in the event
 */
const TelemetryAPI = new EmitterAPI.EventEmitter();
const emitter = TelemetryAPI;

/**
 * Initializes the Telemetry API so that it can start accepting and publishing metrics to an
 * analysis backend.
 *
 * @param  {Object}     [telemetryConfig]   The object containing the configuration properties. See the `config.telemetry` object in the base `./config.js` for more information
 * @param  {Function} callback        Standard callback function
 */
const init = (_telemetryConfig, callback) => {
  Locking.init((error, _locker) => {
    if (error) return callback(error);

    locker = _locker;
    lockerRedisClient = head(locker.servers);

    _applyTelemetryConfig(_telemetryConfig);
    _resetTelemetry(publishIntervalId, resetIntervalId);
    _initPublish(telemetryConfig, callback);
  });
};

// eslint-disable-next-line node/no-unsupported-features/es-syntax
const importPublisher = (publisherUrl) => import(publisherUrl);

/**
 * Post-initialization for Telemetry API
 *
 * @function _initPublish
 * @param  {Object} telemetryConfig The object containing the configuration properties. See the `config.telemetry` object in the base `./config.js` for more information
 * @param  {Function} callback        Standard callback function
 */
const _initPublish = (telemetryConfig, callback) => {
  if (telemetryConfig.enabled && telemetryConfig.publisher) {
    const publisherUrl =
      process.cwd() + '/node_modules/oae-telemetry/lib/publishers/' + telemetryConfig.publisher + '.js';

    callbackify(importPublisher)(publisherUrl, (error, _publisher) => {
      if (error) callback(error);

      publisher = _publisher;

      publisher.init(telemetryConfig);

      /**
       * Immediately try and reset telemetry counts so if the servers are
       * rebooted it doesn't put off the reset for potentially another
       * full day
       */
      _resetTelemetryCounts((error) => {
        if (error) return callback(error);

        // Begin the publish and reset intervals
        publishIntervalId = setInterval(_publishTelemetryData, telemetryConfig.publishInterval * 1000);
        resetIntervalId = setInterval(_resetTelemetryCounts, telemetryConfig.resetInterval * 1000);

        return callback();
      });
    });
  } else {
    return callback();
  }
};

/**
 * Resets all telemetry counters and timeouts
 *
 * @function _resetTelemetry
 * @param  {Number} publishIntervalId The publish telemetry interval
 * @param  {Number} resetIntervalId   The reset telemetry interval
 */
const _resetTelemetry = (publishIntervalId, resetIntervalId) => {
  _resetLocalHistograms();
  _resetLocalCounts();

  // Clear the publish and reset intervals in case telemetry is now disabled
  clearTimeout(publishIntervalId);
  clearTimeout(resetIntervalId);
};

/**
 * Allows other modules to perform telemetry tasks.
 * ex:
 *
 *     const Telemetry = require('oae-telemetry').telemetry('cassandra');
 *         Telemetry.incr('write.count');
 *
 * @param  {String} module The module.
 */
const telemetry = function (module) {
  return new Telemetry(module);
};

/**
 * The Telemetry object.
 *
 * @param  {String} module A module to namespace counts in.
 * @api private
 */
const Telemetry = function (module) {
  // Holds the exported methods of the object
  const that = {};

  /**
   * Increment the count for this Telemetry item.
   *
   * @param  {String}     name            The name of the item to increment
   * @param  {Number}     [count]         If specified, the metric will be incremented this many times. Default: 1
   */
  that.incr = function (name, count) {
    if (!_enabled()) {
      // Don't do anything if we're not enabled
      return;
    }

    stats.counts[module] = stats.counts[module] || {};
    stats.counts[module][name] = stats.counts[module][name] || 0;
    stats.counts[module][name] += OaeUtil.getNumberParam(count, 1, 1);
  };

  /**
   * Adds a value that is suitable for histogram parsing.
   *
   * @param  {String}  name    The name to append a value on.
   * @param  {Number}  value   The value that should be added.
   */
  that.append = function (name, value) {
    if (!_enabled()) {
      // Don't do anything if we're not enabled
      return;
    }

    stats.histograms[module] = stats.histograms[module] || {};
    stats.histograms[module][name] = stats.histograms[module][name] || [];
    stats.histograms[module][name].push(value);
  };

  /**
   * Appends a timing value for histogram parsing that is a duration (in ms) from the provided `from` time.
   *
   * @param  {String}  name    The name to append the timing value on
   * @param  {Number}  from    The millis from which the duration should be based.
   */
  that.appendDuration = function (name, from) {
    if (!_enabled()) {
      return;
    }

    that.append(name, _duration(from));
  };

  return that;
};

// The telemetry object that will be used to time HTTP requests.
const serverTelemetry = telemetry('server');

/**
 * This method can be used by middleware to count and/or time requests.
 * The property `telemetryUrl` on the request object will be checked to
 * see if any timing/count should occur. If null or undefined only the counter
 * for the total number of requests of that particular HTTP method will be increased.
 * If it is defined (by an API endpoint), his method will:
 *  * increase the amount of requests for that URI by 1.
 *  * increase the amount of requests for that HTTP method by 1.
 *  * measure the time it took for a response to be generated.
 *
 * @param  {Request}    req     The request.
 * @param  {Response}   res     The response
 */
const request = function (request_, response) {
  if (!_enabled()) {
    // Don't do anything if we're not enabled
    return;
  }

  // Count all requests per method type
  serverTelemetry.incr(format('%s.count', request_.method));

  // Do some time measuring
  const start = Date.now();
  response.on('finish', () => {
    if (request_.telemetryUrl) {
      // Build the per-path telemetry keys for count and time
      const requestCountName = format('%s.%s.count', request_.method, request_.telemetryUrl);
      const requestTimeName = format('%s.%s.time', request_.method, request_.telemetryUrl);

      // Record the count and response time for the request
      serverTelemetry.incr(requestCountName);
      serverTelemetry.appendDuration(requestTimeName, start);
    }
  });
};

/**
 * Force reset all of the telemetry data. This includes both the local histograms and the global counts.
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const reset = function (callback) {
  const log = logger('oae-telemetry');

  _resetGlobalCounts(() => {
    _resetLocalHistograms();
    _resetLocalCounts();

    // Also reset the locks
    lockerRedisClient.del(_getTelemetryCountResetLock(), (resetError) => {
      if (resetError) {
        log().error({ err: resetError }, 'Error trying to reset the count reset lock');
      }

      lockerRedisClient.del(_getTelemetryCountPublishLock(), (publishError) => {
        if (publishError) {
          log().error({ err: publishError }, 'Error trying to reset the telemetry publish lock');
        }

        return callback(resetError || publishError);
      });
    });
  });
};

/**
 * Get the current set of telemetry data.
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Object}     callback.data   The current telemetry data
 */
const getTelemetryData = function (callback) {
  _pushCountsToRedis(() => {
    _getCounts((error, countsHash) => {
      if (error) {
        return callback(error);
      }

      return callback(null, _mergeHistograms(countsHash));
    });
  });
};

/**
 * Publish the telemetry data to the telemetry back-end.
 *
 * @api private
 */
const _publishTelemetryData = function () {
  // First push all our locally stored counts to redis
  _pushCountsToRedis(() => {
    // Only get the counts if we successfully acquire a lock for them
    _lockAndGetCounts((countsHash) => {
      const data = _mergeHistograms(countsHash);
      publisher.publish(data);

      _resetLocalHistograms();

      TelemetryAPI.emit('publish', data);
    });
  });
};

/**
 * Reset the telemetry counts if it is time to do so.
 *
 * @param  {Function}    callback    Standard callback function
 * @api private
 */
const _resetTelemetryCounts = function (callback) {
  const log = logger('oae-telemetry');

  callback = callback || function () {};
  Locking.acquire(_getTelemetryCountResetLock(), telemetryConfig.resetInterval, (error /* , token */) => {
    if (error) {
      // We didn't acquire the lock, so don't bother resetting
      log().error({ err: error }, 'Error acquiring lock to reset telemetry data');
      return callback();
    }

    // Reset the local counts as well. This helps defeat race conditions in unit tests and doesn't really
    // cause any more "damage" than the global reset does on its own any way
    _resetLocalCounts();
    _resetGlobalCounts((error_) => {
      if (error_) {
        log().error({ err: error_ }, 'Error resetting the telemetry data');
      } else {
        TelemetryAPI.emit('reset');
      }

      return callback();
    });
  });
};

/**
 * Push the local counts data to redis.
 *
 * @param  {Function}   callback    Standard callback function
 * @api private
 */
const _pushCountsToRedis = function (callback) {
  const log = logger('oae-telemetry');

  if (isEmpty(stats.counts)) {
    return callback();
  }

  const countHashKey = _getTelemetryCountHashKey();
  const multi = Redis.getClient().multi();

  // Iterate through each local count and increment the global redis copy by the amount stored locally
  _.each(stats.counts, (nameValue, module) => {
    _.each(nameValue, (value, name) => {
      multi.hincrby(countHashKey, _getTelemetryCountKey(module, name), value);
    });
  });

  // Reset the counts in this process tick to avoid losing counts
  _resetLocalCounts();

  multi.exec((error) => {
    if (error) {
      log().error({ err: error }, 'Error pushing local counts to redis');
    }

    return callback();
  });
};

/**
 * Get the count metrics from redis if it is time to do so. Since many machines can be collecting stats at a time, this
 * method employs a lock to ensure only one machine within the publishing interval will collect and publish. It does this by
 * using a lock timeout.
 *
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     [callback.counts]   The counts data, a hash of key -> value in the raw manner that they were stored in redis. If not specified, it means either we failed to get the counts or it was not time to do so. If there was an error, it will be logged internally.
 * @api private
 */
const _lockAndGetCounts = function (callback) {
  const log = logger('oae-telemetry');

  // Try and fetch the lock for the duration of the publishing interval
  Locking.acquire(_getTelemetryCountPublishLock(), telemetryConfig.publishInterval, (error /* , token */) => {
    if (error) {
      // Migration from redback to redlock:
      log().error({ err: error }, 'Error acquiring lock to publish telemetry counts');
      // We didn't acquire the lock, so don't bother with the counts
      return callback();
    }

    // Fetch the full counts hash in redis
    _getCounts((error, countsHash) => {
      if (error) {
        return callback();
      }

      // We return without releasing the lock, because the expiry of the lock managers the collection interval, so that if another application
      // server tries to collect 1 second after this, they will fail to get the lock
      return callback(countsHash);
    });
  });
};

/**
 * Get the telemetry counts from redis.
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Object}     callback.counts The raw counts, keyed by the provided count key and the value is the current value of the counts
 * @api private
 */
const _getCounts = function (callback) {
  const log = logger('oae-telemetry');

  Redis.getClient().hgetall(_getTelemetryCountHashKey(), (error, countsHash) => {
    if (error) {
      log().error({ err: error }, 'Error querying telemetry counts from redis');
      return callback(error);
    }

    // Redis will return each value as a string, so we need to cast them to integers
    _.each(countsHash, (value, key) => {
      countsHash[key] = Number.parseInt(value, 10);
    });

    return callback(null, countsHash);
  });
};

/**
 * Force delete the counts data from redis.
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _resetGlobalCounts = function (callback) {
  Redis.getClient().del(_getTelemetryCountHashKey(), callback);
};

/**
 * Merge the given count data with the current histogram data.
 *
 * @param  {Object}  countsHash  The countsHash object fetched from redis
 * @return {Object}              The counts data merged with the telemetry data
 * @api private
 */
const _mergeHistograms = function (countsHash) {
  const mergedData = {};

  // Collect the count metrics if necessary
  if (countsHash) {
    _.each(countsHash, (value, key) => {
      const parts = _getTelemetryCountKeyParts(key);
      mergedData[parts.module] = mergedData[parts.module] || {};
      mergedData[parts.module][parts.name] = value;
    });
  }

  // Overlay the meaningful histogram data
  _.each(stats.histograms, (nameValue, module) => {
    _.each(nameValue, (value, name) => {
      if (value && !_.isEmpty(value)) {
        mergedData[module] = mergedData[module] || {};
        mergedData[module][name] = value;
      }
    });
  });

  return mergedData;
};

/**
 * Apply the user-provided telemetry configuration object to the effective configuration of the API
 *
 * @param  {Object}     [telemetryConfig]   The object containing the configuration properties. See the `config.telemetry` object in the base `./config.js` for more information
 * @api private
 */
const _applyTelemetryConfig = function (_telemetryConfig) {
  telemetryConfig = _.extend({}, _telemetryConfig);
  telemetryConfig.enabled = telemetryConfig.enabled === true;
  telemetryConfig.publishInterval = OaeUtil.getNumberParam(telemetryConfig.publishInterval, 30, 1);
  telemetryConfig.resetInterval = OaeUtil.getNumberParam(telemetryConfig.resetInterval, 86_400, 1);
  telemetryConfig.publisher = telemetryConfig.publisher || 'console';
};

/**
 * Reset the in-memory histogram stats for the next collection interval
 *
 * @api private
 */
const _resetLocalHistograms = function () {
  stats = stats || {};
  stats.histograms = {};
};

/**
 * Reset the in-memory count stats for the next redis push interval
 *
 * @api private
 */
const _resetLocalCounts = function () {
  stats = stats || {};
  stats.counts = {};
};

/**
 * Get the duration (in ms) that has expired from the `from` millis.
 *
 * @param  {Number} from   The number of milliseconds to substract from the current time.
 * @return {Number}        How many milliseconds have elapsed since the `from` time until now.
 * @api private
 */
const _duration = function (from) {
  return Date.now() - from;
};

/**
 * @return {Boolean}    Whether or not the the TelemetryAPI is initialized and has been enabled
 * @api private
 */
const _enabled = function () {
  return telemetryConfig && telemetryConfig.enabled;
};

/**
 * @return {String}     The key for the lock that unlocks access to publish the redis telemetry data
 * @api private
 */
const _getTelemetryCountPublishLock = function () {
  return 'oae-telemetry:counts:publishLock';
};

/**
 * @return {String}     The key for the lock that unlocks access to reset the redis telemetry data
 * @api private
 */
const _getTelemetryCountResetLock = function () {
  return 'oae-telemetry:counts:resetLock';
};

/**
 * @return {String}     The key for the redis hash that holds all of the telemetry count information
 * @api private
 */
const _getTelemetryCountHashKey = function () {
  return 'oae-telemetry:counts:data';
};

/**
 * @return {String}     The hash key for metric associated to this module and name.
 * @api private
 */
const _getTelemetryCountKey = function (module, name) {
  return format('%s:%s', module, name);
};

/**
 * @return {Object}     The object from which a telemetry count key was generated using #_getTelemetryCountKey(module, name)
 * @api private
 */
const _getTelemetryCountKeyParts = function (telemetryCountKey) {
  const split = telemetryCountKey.split(':');
  return {
    module: split.shift(),
    name: split.join(':')
  };
};

export { emitter, init, telemetry, request, reset, getTelemetryData };
