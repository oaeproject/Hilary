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

import Redis from 'ioredis';
import { logger } from 'oae-logger';

const log = logger('oae-redis');
import { equals, not } from 'ramda';

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
    if (err) return callback(err);

    client = _client;
    return callback(null, client);
  });
};

/**
 * Creates a redis connection from a defined set of configuration.
 *
 * @param  {Object}   _config      A redis configuration object
 * @param  {Function} callback      Standard callback function
 * @return {RedisClient}            A redis client that is configured with the given configuration
 */
const createClient = function(_config, callback) {
  const onTestingEnvironment = equals('true', process.env.OAE_TESTS_RUNNING);
  const notOnTestingEnvironment = not(onTestingEnvironment);

  const connectionOptions = {
    port: _config.port,
    host: _config.host,
    db: _config.dbIndex || 0,
    password: _config.pass,
    /**
     * If we are running tests, then we need to tell redis connections NOT to
     * auto-subscribe and NOT to resume previous BRPOPs and such blocking commands
     */
    autoResendUnfulfilledCommands: notOnTestingEnvironment,
    autoResubscribe: notOnTestingEnvironment,
    // By default, ioredis will try to reconnect when the connection to Redis is lost except when the connection is closed
    // Check https://github.com/luin/ioredis#auto-reconnect
    retryStrategy: () => {
      log().error('Error connecting to redis, retrying in ' + retryTimeout + 's...');
      isDown = true;
      if (notOnTestingEnvironment) {
        return retryTimeout * 1000;
      }

      return null;
    },
    reconnectOnError: () => {
      // Besides auto-reconnect when the connection is closed, ioredis supports reconnecting on the specified errors by the reconnectOnError option.
      return true;
    }
  };

  const redisClient = Redis.createClient(connectionOptions);

  // Register an error handler.
  redisClient.on('close', () => {
    log().error('Closing connection to redis...');
  });

  redisClient.on('end', () => {
    log().error(
      'All connections have been closed and no more reconnections will be made, or the connection has failed to establish.'
    );
  });

  redisClient.on('error', () => {
    log().error('Error connecting to redis...');
    isDown = true;
  });

  redisClient.on('ready', () => {
    if (isDown) {
      log().info('Reconnected to redis \\o/');
    }

    isDown = false;
  });

  return callback(null, redisClient);
};

/**
 * @return {RedisClient} A redis client that gets created when the app starts up.
 */
const getClient = () => client;

/**
 * Flushes all messages from the system that we're currently pushing to.
 *
 * @param  {Function} callback       Standard callback function
 * @param  {Object}   callback.err   An error that occurred, if any
 */
const flush = function(callback) {
  const done = err => {
    if (err) return callback({ code: 500, msg: err });

    return callback();
  };

  if (client) {
    client.flushdb(done);
  } else {
    done('Unable to flush redis. Try initializing it first.');
  }
};

/**
 * Reconnect a previously closed redis connection
 *
 * @param {Object} connection A redis client created by ioredis (which should be closed)
 * @param {Function} done Standard callback function
 */
const reconnect = (connection, done) => {
  connection.connect(() => {
    return done();
  });
};

/**
 * @function reconnectAll
 * @param  {Array} connections Array of connections to reconnect one after the other
 * @param {Function} done Standard callback function
 */
const reconnectAll = (connections, done) => {
  if (connections.length === 0) {
    return done();
  }

  const someConnection = connections.shift();
  return reconnect(someConnection, done);
};

export { createClient, getClient, flush, init, reconnect, reconnectAll };
