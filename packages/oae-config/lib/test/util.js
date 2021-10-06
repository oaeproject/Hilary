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

import Counter from 'oae-util/lib/counter.js';
import { Config } from 'oae-rest';
import * as ConfigAPI from 'oae-config';

// Maintains the number of updates that have not yet been refreshed in the application cache
const updateCounter = new Counter();

/**
 * Update the configuration as described by @see RestAPI.Config#updateConfig. In addition, this test utility will bind
 * and listen on an event that waits for the local configuration to be refreshed from cassandra. This is useful to
 * synchronize with the asynchronous nature of this operation so you can continue tests after everything is in sync.
 *
 * For method parameter descriptions, @see RestAPI.Config#updateConfig
 */
const updateConfigAndWait = function (restCtx, tenantAlias, configUpdate, callback) {
  Config.updateConfig(restCtx, tenantAlias, configUpdate, (error) => {
    if (error) {
      return callback(error);
    }

    return whenConfigUpdated(callback);
  });
};

/**
 * Clear the configuration as described by @see RestAPI.Config#clearConfig. In addition, this test utility will bind
 * and listen on an event that waits for the local configuration to be refreshed from cassandra. This is useful to
 * synchronize with the asynchronous nature of this operation so you can continue tests after everything is in sync.
 *
 * For method parameter descriptions, @see RestAPI.Config#clearConfig
 */
const clearConfigAndWait = function (restCtx, tenantAlias, configFields, callback) {
  Config.clearConfig(restCtx, tenantAlias, configFields, (error) => {
    if (error) {
      return callback(error);
    }

    return whenConfigUpdated(callback);
  });
};

/**
 * Invokes the provided function only when the server's configurations are completely up to date
 *
 * @param  {Function}   callback    Standard callback function
 */
const whenConfigUpdated = function (callback) {
  updateCounter.whenZero(callback);
};

/**
 * Increment the number of config updates are currently in the process of updating
 */
const _incrementUpdateCount = function () {
  updateCounter.incr();
};

/**
 * Decrement the number of config updates are currently in the process of updating. If the count
 * reaches 0 as a result of this decrement, the `updated` event will be fired to invoke functions
 * that are waiting for the server's config to be fully updated.
 */
const _decrementUpdateCount = function () {
  updateCounter.decr();
};

// Manage counts of updates and refreshes, to help synchronize configuration updates
ConfigAPI.eventEmitter.on('preUpdate', _incrementUpdateCount);
ConfigAPI.eventEmitter.on('preClear', _incrementUpdateCount);
ConfigAPI.eventEmitter.on('preCache', _incrementUpdateCount);
ConfigAPI.eventEmitter.on('update', _decrementUpdateCount);
ConfigAPI.eventEmitter.on('cached', _decrementUpdateCount);

export { clearConfigAndWait, updateConfigAndWait, whenConfigUpdated };
