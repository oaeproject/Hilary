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

import redis from 'redis';
import { logger } from 'oae-logger';

const log = logger('oae-redis');

let client = null;
let isDown = false;
const retryTimeout = 5;

/**
 * Initialize this Redis utility.
 *
 * @param  {Object}   redisConfig     The redis configuration object
 * @param  {Function} callback          Standard callback function
 */
const init = function(redisConfig, callback) {
  createClient(redisConfig, (err, _client) => {
    if (err) {
      return callback(err);
    }

    client = _client;
    return callback();
  });
};

const _selectIndex = function(client, _config, callback) {
  // Select the correct DB index.
  const dbIndex = _config.dbIndex || 0;
  client.select(dbIndex, err => {
    if (err) {
      log().error({ err }, "Couldn't select the redis DB index '%s'", dbIndex);
      return callback(err);
    }

    return callback(null, client);
  });
};

/**
 * Creates a redis connection from a defined set of configuration.
 *
 * @param  {Object}   config      A redis configuration object
 * @param  {Function} callback      Standard callback function
 * @return {RedisClient}            A redis client that is configured with the given configuration
 */
const createClient = function(_config, callback) {
  const connectionOptions = {
    port: _config.port,
    host: _config.host,
    // eslint-disable-next-line camelcase
    retry_strategy: () => {
      log().error('Error connecting to redis, retrying in ' + retryTimeout + 's...');
      isDown = true;
      return retryTimeout * 1000;
    }
  };
  const client = redis.createClient(connectionOptions);

  // Register an error handler.
  client.on('error', () => {
    log().error('Error connecting to redis...');
  });

  client.on('ready', () => {
    if (isDown) {
      log().error('Reconnected to redis \\o/');
    }

    isDown = false;
  });

  // Authenticate (if required, redis allows for async auth)
  _authenticateRedis(client, _config, callback);
};

const _authenticateRedis = (client, _config, callback) => {
  const isAuthenticationEnabled = _config.pass && _config.pass !== '';

  if (isAuthenticationEnabled) {
    client.auth(_config.pass, err => {
      if (err) {
        log().error({ err }, "Couldn't authenticate with redis.");
        return callback(err);
      }

      _selectIndex(client, _config, callback);
    });
  }

  _selectIndex(client, _config, callback);
};

/**
 * @return {RedisClient} A redis client that gets created when the app starts up.
 */
const getClient = function() {
  return client;
};

/**
 * Flushes all messages from the system that we're currently pushing to.
 *
 * @param  {Function} callback       Standard callback function
 * @param  {Object}   callback.err   An error that occurred, if any
 */
const flush = function(callback) {
  const done = err => {
    if (err) {
      return callback({ code: 500, msg: err });
    }

    callback();
  };

  if (client) {
    client.flushdb([], done);
  } else {
    done('Unable to flush redis. Try initializing it first.');
  }
};

export { createClient, getClient, flush, init };
