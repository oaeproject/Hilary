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

import { callbackify } from 'node:util';
import process from 'node:process';
import Redis from 'ioredis';
import { logger } from 'oae-logger';

import { defaultTo, equals, not } from 'ramda';

let client = null;
let isDown = false;
const retryTimeout = 5;
const TRUE = 'true';

/**
 * Initialize this Redis utility.
 *
 * @param  {Object}   redisConfig     The redis configuration object
 * @param  {Function} callback          Standard callback function
 */
const init = function (redisConfig, callback) {
  callbackify(promiseToInit)(redisConfig, callback);
};

async function promiseToInit(redisConfig) {
  client = await createClient(redisConfig);
  return client;
}

/**
 * Creates a redis connection from a defined set of configuration.
 *
 * @param  {Object}   _config      A redis configuration object
 * @return {RedisClient}            A redis client that is configured with the given configuration
 */
const createClient = async function (_config) {
  const log = logger('oae-redis');
  const onTestingEnvironment = equals(TRUE, process.env.OAE_TESTS_RUNNING);
  const notOnTestingEnvironment = not(onTestingEnvironment);

  const connectionOptions = {
    port: _config.port,
    host: _config.host,
    db: defaultTo(0, _config.dbIndex),
    password: _config.pass,
    lazyConnect: true,
    /**
     * If we are running tests, then we need to tell redis connections NOT to
     * auto-subscribe and NOT to resume previous BRPOPs and such blocking commands
     */
    autoResendUnfulfilledCommands: notOnTestingEnvironment,
    autoResubscribe: notOnTestingEnvironment,
    /**
     * By default, ioredis will try to reconnect when the connection to Redis
     * is lost except when the connection is closed
     *
     * Check https://github.com/luin/ioredis#auto-reconnect
     */
    retryStrategy: () => {
      log().error('Error connecting to redis, retrying in ' + retryTimeout + 's...');
      isDown = true;
      if (notOnTestingEnvironment) return retryTimeout * 1000;

      return null;
    },
    /**
     * Besides auto-reconnect when the connection is closed,
     * ioredis supports reconnecting on the specified errors by the reconnectOnError option.
     */
    reconnectOnError: () => true
  };

  const redisClient = new Redis(connectionOptions);

  /**
   * lazyConnect was true, let's do it manually then
   */
  await redisClient.connect();

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

  return redisClient;
};

/**
 * @return {RedisClient} A redis client that gets created when the app starts up.
 */
const getClient = () => client;

/**
 * Flushes all messages from the system that we're currently pushing to.
 */
const flush = async function () {
  if (client) {
    await client.flushall();
  } else {
    throw new Error(JSON.stringify({ code: 500, msg: 'Unable to flush redis. Try initializing it first.' }));
  }
};

/**
 * Reconnect a previously closed redis connection
 *
 * @param {Object} connection A redis client created by ioredis (which should be closed)
 */
const reconnect = (connection) => connection.connect();

/**
 * @function reconnectAll
 * @param  {Array} connections Array of connections to reconnect one after the other
 */
const reconnectAll = (connections, done) => {
  callbackify(promiseToReconnectAll)(connections, done);
};

async function promiseToReconnectAll(connections) {
  const promises = connections.map(
    (eachConnection) =>
      new Promise((resolve, reject) => {
        eachConnection.connect().then(resolve).catch(reject);
      })
  );

  await Promise.all(promises);
}

export { createClient, getClient, flush, init, reconnect, reconnectAll };
