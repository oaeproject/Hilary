/*!
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import _ from 'underscore';

import { EventEmitter } from 'oae-emitter';
import { logger } from 'oae-logger';
import * as Redis from './redis';
import OaeEmitter from './emitter';
import * as OAE from './oae';
import { Validator } from './validator';

const log = logger('mq');
const emitter = new EventEmitter();

const THE_PURGER = 'purger';
const THE_CHECKER = 'checker';
const THE_PUBLISHER = 'publisher';
const staticConnectionNames = { THE_PURGER, THE_CHECKER, THE_PUBLISHER };
const MQConstants = { staticConnectionNames };

const staticConnections = {
  /**
   * This will hold a connection used only for PURGE operations
   * See `purgeAllQueues` for details
   */
  THE_PURGER: null,
  /**
   * This will hold a connection used only for LLEN operations
   * See `whenTasksEmpty` for details
   * This is only relevant for tests
   */
  THE_CHECKER: null,

  /**
   * This will hold a connection for LPUSHing messages to queues
   * See `submit` for details
   */
  THE_PUBLISHER: null
};

/**
 * Task queueing logic
 *
 * For every queue OAE creates, there are two extra queues (redis lists), *-processing and *-redelivery
 * The way tasks are processed is illustrated below for `oae-activity/activity`, but works the same way for all queues:
 *
 * oae-activity/activity
 * oae-activity/activity-processing
 * oae-search/index
 * oae-search/index-processing
 * oae-search/delete
 * oae-search/delete-processing
 * oae-search/reindex
 * oae-search/reindex-processing
 * oae-content/etherpad-publish
 * oae-content/etherpad-publish-processing
 * oae-content/ethercalc-publish
 * oae-content/ethercalc-publish-processing
 * oae-content/ethercalc-edit
 * oae-content/ethercalc-edit-processing
 * oae-preview-processor/generatePreviews
 * oae-preview-processor/generatePreviews-processing
 * oae-preview-processor/generateFolderPreviews
 * oae-preview-processor/generateFolderPreviews-processing
 * oae-preview-processor/regeneratePreviews
 * oae-preview-processor/regeneratePreviews-processing
 *
 *     ┌──────────────────────────────────────────┬─┐
 *     │           oae-activity/activity          │X│──┐
 *     └──────────────────────────────────────────┴─┘  │
 *                                                     │
 *  ┌──────────────────  brpoplpush   ─────────────────┘
 *  │
 *  │                                                   handler     Λ    returns
 *  │  ┌─┬──────────────────────────────────────────┐   invoked    ╱ ╲    error           lpush   ┌─┬──────────────────────────────────────────┐
 *  └─▷│X│    oae-activity/activity-processing      │────────────▷▕   ▏─────────────▷  ──────────▷│X│    oae-activity/activity-redelivery      │
 *     └─┴──────────────────────────────────────────┘              ╲ ╱                            └─┴──────────────────────────────────────────┘
 *                            △                                     V                                                    │
 *                            │                                     │                                                    │
 *                            │                                                                                          │
 *                            │                                returns OK                                                │
 *                            │                 ┌─┐                                                                      │
 *                            │       lrem (-1) │X│ from            │                                                    │
 *                            │                 └─┘                 ▽                                                    │
 *                            └────────────────────────────────────  ◁───────────────────────────────────────────────────┘
 */

/**
 * Redis configuration which will load from config.js
 */
let redisConfig = null;

/**
 * This object will track the current bindings
 * meaning every time we subscribe to a queue
 * by assigning a listener to it, we set the binding,
 * and every time we unsubscribe, we do the opposite
 */
const queueBindings = {};

/*+
 * This object contains the different redis clients
 * OAE uses. It is currently one per queue (such as oae-activity/activity,
 * oae-search/reindex, oae-preview-processor/generatePreviews, etc)
 * Every time we subscribe, we block that client while listening
 * on the queue, using redis BRPOPLPUSH.
 * See `_getOrCreateSubscriberForQueue` for details
 */
const subscribers = {};

const PRODUCTION_MODE = 'production';

/**
 * This is kind of legacy but still plays a role booting up tests
 * Previously this would be a "reminder" to bind all the queues
 * which of course is no longer necessary
 */
OaeEmitter.on('ready', () => {
  emitter.emit('ready');
});

/**
 * Safely shutdown the MQ service
 * by closing connections safely
 * Check IOredis API for details:
 * https://github.com/luin/ioredis/blob/master/API.md
 */
OAE.registerPreShutdownHandler('mq', null, done => {
  quitAllConnectedClients();
  return done();
});

/**
 * Initialize the Message Queue system so that it can start sending and receiving messages.
 *
 * @function init
 * @param  {Object}    config           The MQ Configuration object
 * @param  {Function}  callback         Standard callback function
 * @param  {Object}    callback.err     An error that occurred, if any
 * @returns {Function}                  Returns a callback
 */
const init = function(config, callback) {
  redisConfig = config;
  let theRedisPurger = staticConnections.THE_PURGER;
  let theRedisChecker = staticConnections.THE_CHECKER;
  let theRedisPublisher = staticConnections.THE_PUBLISHER;

  // redis connection possible statuses
  const hasNotBeenCreated = !theRedisPurger;
  const hasConnectionBeenClosed = theRedisPurger && theRedisPurger.status === 'end';

  // Only init if the connections haven't been opened
  if (hasNotBeenCreated) {
    Redis.createClient(config, (err, client) => {
      if (err) return callback(err);
      theRedisPurger = client;
      theRedisPurger.queueName = MQConstants.staticConnectionNames.THE_PURGER;
      staticConnections.THE_PURGER = theRedisPurger;

      theRedisChecker = client.duplicate();
      theRedisChecker.queueName = MQConstants.staticConnectionNames.THE_CHECKER;
      staticConnections.THE_CHECKER = theRedisChecker;

      theRedisPublisher = client.duplicate();
      theRedisPublisher.queueName = MQConstants.staticConnectionNames.THE_PUBLISHER;
      staticConnections.THE_PUBLISHER = theRedisPublisher;

      // if the flag is set, we purge all queues on startup. ONLY if we're NOT in production mode.
      const shallWePurge = redisConfig.purgeQueuesOnStartup && process.env.NODE_ENV !== PRODUCTION_MODE;
      if (shallWePurge) {
        purgeAllBoundQueues(callback);
      } else {
        return callback();
      }
    });
  } else if (hasConnectionBeenClosed) {
    // Here we assume that if the purger has been disconnected, then all must have been too
    Redis.reconnectAll([theRedisChecker, theRedisPurger, theRedisPublisher], callback);
  } else {
    return callback();
  }
};

/**
 * Sets up the main logic for binding the given `listener` function to the provided queue
 *
 * @function setupListeningForMessages
 * @param  {Queue}      queueName           The queue to which we'll subscribe the listener
 * @param  {Function}   listener            The function that will handle messages delivered from the queue
 * @param  {Object}     listener.data       The data that was sent in the message. This is different depending on the type of job
 * @param  {Function}   listener.callback   The listener callback. This must be invoked in order to acknowledge that the message was handled
 */
const setupListeningForMessages = (queueName, listener) => {
  getOrCreateSubscriberForQueue(queueName, (err, queueSubscriber) => {
    if (err) log().error({ err }, 'Error creating redis client');

    listenForMessages(queueSubscriber, queueName, listener);
  });
};

/**
 * @function listenForMessages
 * @param  {Redis}      queueSubscriber The redis connection which subscribes (and blocks) to the queue
 * @param  {String}     queueName       The queue we're listening to
 * @param  {Function}   taskHandler     The function that will handle messages delivered from the queue
 */
const listenForMessages = (queueSubscriber, queueName, taskHandler) => {
  queueSubscriber.brpoplpush(queueName, getProcessingQueueFor(queueName), 0, (err, queuedMessage) => {
    if (err) {
      log().error({ err }, 'Error while BRPOPLPUSHing redis queue ' + queueName);
      /**
       * If this happens, then most likely this connection has been disconnected
       * and the `queueMessage` is undefined
       * So we just emit that we're done to complete the disconnection process
       */
      emitter.emit(`stoppedListeningTo:${queueName}`);
      return;
    }

    if (queuedMessage) {
      handleMessage(queuedMessage, queueName, taskHandler, () => {
        removeMessageFromQueue(getProcessingQueueFor(queueName), queuedMessage, () => {
          return listenForMessages(queueSubscriber, queueName, taskHandler);
        });
      });
    }
  });
};

/**
 * @function removeMessageFromQueue
 * @param  {String}   processingQueue  A redis processing queue (where the handled messages are at this stage)
 * @param  {String}   queuedMessage   The message we need to remove from the queue
 * @param  {Function} callback        Standard callback function
 */
const removeMessageFromQueue = (processingQueue, queuedMessage, callback) => {
  log().debug(`About to remove a message from ${processingQueue}`);
  staticConnections.THE_PURGER.lrem(processingQueue, -1, queuedMessage, (err, count) => {
    if (err) {
      log().error('Unable to LREM from redis, message is kept on ' + processingQueue);
      return callback(err);
    }

    log().debug(`Removed ${count} message from ${processingQueue}. Resuming worker...`);
    return callback();
  });
};

/**
 * @function handleMessage
 * @param  {String}   queuedMessage The message we're processing
 * @param  {String}   queueName     The redis queue where we originally popped the message from
 * @param  {Function} taskHandler      The function that is bound to the `queueName` redis queue
 * @param  {Function} callback      Standard callback function
 */
const handleMessage = (queuedMessage, queueName, taskHandler, callback) => {
  const message = JSON.parse(queuedMessage);
  taskHandler(message, err => {
    /**
     * Lets set the convention that if the listener function
     * returns the callback with an error, then something went
     * unpexpectadly wrong, and we need to know about it.
     * Hence, we're sending it to a special queue for analysis
     */
    if (err) {
      log().warn(
        { err },
        `Using the redelivery mechanism for a message that failed running ${taskHandler.name} on ${queueName}`
      );
      const redeliveryQueue = getRedeliveryQueueFor(queueName);
      sendToRedeliveryQueue(redeliveryQueue, queuedMessage, err => {
        if (err) log().warn(`Unable to submit a message to ${redeliveryQueue}`);
        log().warn(`Submitted a message to ${redeliveryQueue} following an error`);

        return callback();
      });
    }

    return callback();
  });
};

/**
 * Sends a message which has just failed to be processed to a special queue for later inspection
 *
 * @function _redeliverToSpecialQueue
 * @param  {String} queueName   The queue name for redelivery, which is a redis List
 * @param  {String} message     The message we need to store in the redelivery queue in JSON format
 */
const sendToRedeliveryQueue = (redeliveryQueue, message, callback) => {
  staticConnections.THE_PUBLISHER.lpush(redeliveryQueue, message, err => {
    if (err) return callback(err);
    return callback;
  });
};

/**
 * Binds a listener to a queue, meaning that every time a message is pushed to that queue
 * (which is a redis List) that listener will be executed.
 *
 * @function subscribe
 * @param  {String}   queueName     The queue name we want to subscribe to, which is a redis List
 * @param  {Function} listener      The function we need to run for each task sent to the queue
 * @param  {Function} callback      Standard callback function
 * @param  {Object}   callback.err  An error that occurred, if any
 * @return {Function}               Returns the callback
 */
const subscribe = (queueName, listener, callback) => {
  callback = callback || function() {};
  const validator = new Validator();
  validator.check(queueName, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  if (validator.hasErrors()) return callback(validator.getFirstError());

  const queueIsAlreadyBound = queueBindings[queueName];
  if (queueIsAlreadyBound) return callback();

  // Flag this queue as bound
  queueBindings[queueName] = getProcessingQueueFor(queueName);

  // Start listening for messages asynchronously
  setupListeningForMessages(queueName, listener);

  return callback();
};

/**
 * Unbinds any listener to a specific queue, meaning that if we then submit messages
 * to that queue, they won't be processed. This happens because we do two things here:
 * 1 We flag the queue as unbound, and `submit` respects this flag, so it won't even PUSH
 * 2 We remove the listener associated with the event which is sent when submit PUSHES to the queue
 *
 * @function unsubscribe
 * @param  {String}    queueName       The name of the message queue to unsubscribe from
 * @param  {Function}  done        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @returns {Function}                 Returns callback
 */
const unsubscribe = (queueName, done) => {
  done = done || function() {};
  const validator = new Validator();
  validator.check(queueName, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  if (validator.hasErrors()) return done(validator.getFirstError());

  // Either case, let's update the queue bindings
  delete queueBindings[queueName];

  // Now let's disconnect the subscriber
  if (isConnectionActive(queueName)) {
    return disconnectConnectionAndWait(queueName, done);
  }

  return done();
};

/**
 * @function disconnectConnectionAndWait
 * @param  {String}   queueName The redis list we (un)subscribe to
 * @param  {Function} done      Standard callback function
 */
const disconnectConnectionAndWait = (queueName, done) => {
  // Waiting for the brpoplpush to break and stop worker recursiveness
  emitter.once(`stoppedListeningTo:${queueName}`, () => {
    return done();
  });

  // Disconnect this connection and flag it
  const subscribedClient = subscribers[queueName];
  subscribedClient.disconnect(false);
  subscribedClient.status = 'end';
};

/**
 * @function isConnectionActive
 * @param  {String}   queueName The redis list we (un)subscribe to
 * @return {Boolean}            Whether the connection is open or closed
 */
const isConnectionActive = queueName => {
  return subscribers[queueName] && subscribers[queueName].status !== 'end';
};

/**
 * Gets the map-like object where we keep track of which queues are bound and which aren't
 *
 * @function getBoundQueues
 * @return {Object} An map-like object which contains all the queues (String) that are bound to a listener
 */
const getBoundQueues = function() {
  return queueBindings;
};

/**
 * Submit a message to an exchange
 *
 * @function submit
 * @param  {String}     queueName                   The queue name which is a redis List
 * @param  {String}     message                     The data to send with the message in JSON. This will be received by the worker for this type of task
 * @param  {Function}   [callback]                  Invoked when the job has been submitted
 * @param  {Object}     [callback.err]              Standard error object, if any
 * @returns {Function}                              Returns callback
 */
const submit = (queueName, message, callback) => {
  callback = callback || function() {};
  const validator = new Validator();
  validator.check(queueName, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  validator.check(message, { code: 400, msg: 'No message was provided.' }).notEmpty();
  if (validator.hasErrors()) return callback(validator.getFirstError());

  const queueIsBound = queueBindings[queueName];
  if (queueIsBound) return staticConnections.THE_PUBLISHER.lpush(queueName, message, callback);
  return callback();
};

/**
 * Gets all the active redis clients
 * This includes the `manager`, the `publisher` and the active `subscribers`
 *
 * @function getAllConnectedClients
 * @return {Array} An Array with all the active redis connections
 */
const getAllActiveClients = () => {
  return _.values(subscribers)
    .concat(staticConnections.THE_PURGER)
    .concat(staticConnections.THE_CHECKER)
    .concat(staticConnections.THE_PUBLISHER);
};

/**
 * Purge a queue.
 *
 * @function purgeQueue
 * @param  {String}     queueName       The name of the queue to purge.
 * @param  {Function}   [callback]      Standard callback method
 * @param  {Object}     [callback.err]  An error that occurred purging the queue, if any
 * @returns {Function}                  Returns a callback
 */
const purgeQueue = (queueName, callback) => {
  callback = callback || function() {};
  const validator = new Validator();
  validator.check(queueName, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  if (validator.hasErrors()) return callback(validator.getFirstError());

  const theRedisPurger = staticConnections.THE_PURGER;
  theRedisPurger.del(queueName, err => {
    if (err) return callback(err);

    return callback();
  });
};

/**
 * Purge a list of queues, by calling `purgeQueue` recursively
 *
 * @function purgeQueues
 * @param  {Array} allQueues    An array containing all the queue names we want to purge (which are redis Lists).
 * @param  {Function} done      Standard callback method
 * @return {Function}           Returns callback
 */
const purgeQueues = (allQueues, done) => {
  if (allQueues.length === 0) return done();

  const nextQueueToPurge = allQueues.pop();
  purgeQueue(nextQueueToPurge, () => {
    purgeQueue(getProcessingQueueFor(nextQueueToPurge), () => {
      return purgeQueues(allQueues, done);
    });
  });
};

/**
 * Purges the queues which are currently subscribed (or bound to a listener)
 *
 * @function purgeAllBoundQueues
 * @param  {Function} callback Standard callback method
 */
const purgeAllBoundQueues = callback => {
  const queuesToPurge = _.keys(queueBindings);
  purgeQueues(queuesToPurge, callback);
};

/**
 * Quits (aka disconnect) all active redis clients
 *
 * @function quitAllConnectedClients
 * @param  {Function} done Standard callback function
 * @return {Function} Returns `quitAllClients` method
 */
const quitAllConnectedClients = () => {
  _.each(getAllActiveClients(), each => {
    each.disconnect(false);
  });
};

/**
 * @function createNewClient
 * @param  {String} queueName   The redis list we want to create the client for (in case it's a subscriber)
 * @param  {Function} callback  Standard callback function
 */
const createNewClient = (queueName, callback) => {
  Redis.createClient(redisConfig, (err, client) => {
    if (err) return callback(err);

    client.queueName = queueName;
    subscribers[queueName] = client;
    return callback(null, client);
  });
};

/**
 * @function reconnectClient
 * @param  {String} queueName   The redis list we want to reconnect the client for (in case it's a subscriber)
 * @param  {Function} callback  Standard callback function
 */
const reconnectClient = (queueName, callback) => {
  const subscriber = subscribers[queueName];
  Redis.reconnect(subscriber, err => {
    if (err) return callback(err);

    subscribers[queueName] = subscriber;
    return callback(null, subscriber);
  });
};

/**
 * Fetches the redis connection used to subscribe to a specific queue
 * There is one redis connection per queue
 *
 * @function _getOrCreateSubscriberForQueue
 * @param  {String} queueName   The queue name, which the client is or will be subscribing
 * @param  {Function} callback  Standard callback function
 * @return {Function}           Returns callback
 */
const getOrCreateSubscriberForQueue = (queueName, callback) => {
  const subscriber = subscribers[queueName];
  // redis connection possible statuses:
  const hasNotBeenCreated = !subscriber;
  const hasConnectionBeenClosed = subscriber && subscriber.status === 'end';

  if (hasNotBeenCreated) {
    createNewClient(queueName, callback);
  } else if (hasConnectionBeenClosed) {
    reconnectClient(queueName, callback);
  } else {
    return callback(null, subscribers[queueName]);
  }
};

/**
 * Utility function for getting the name of the corresponding redelivery queue
 * The rule is we just append `-redelivery` to a queueName
 *
 * @function getRedeliveryQueueFor
 * @param  {String} queueName The queue name which we want the corresponding redelivery queue for
 * @return {String} The redelivery queue name
 */
const getRedeliveryQueueFor = queueName => {
  return `${queueName}-redelivery`;
};

/**
 * Utility function for getting the name of the corresponding processiing queue
 * The rule is we just append `-processing` to a queueName
 *
 * @function getProcessingQueueFor
 * @param  {String} queueName The queue name which we want the corresponding processing queue for
 * @return {String} The processing queue name
 */
const getProcessingQueueFor = queueName => {
  return `${queueName}-processing`;
};

export {
  emitter,
  init,
  subscribe,
  unsubscribe,
  purgeQueue,
  purgeQueues,
  purgeAllBoundQueues,
  getBoundQueues,
  submit,
  getAllActiveClients as getAllConnectedClients,
  MQConstants,
  staticConnections,
  getProcessingQueueFor
};
