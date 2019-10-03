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

/**
 * Redis configuration which will load from config.js
 */
let redisConfig = null;

/**
 * This will hold a connection used only for PURGE operations
 * See `purgeAllQueues` for details
 */
let manager = null;

/**
 * This will hold a connection for LPUSHing messages to queues
 * See `submit` for details
 */
let publisher = null;

/**
 * This object will track the current bindings
 * meaning every time we subscribe to a queue
 * by assigning a listener to it, we set the binding,
 * and every time we unsubscribe, we do the opposite
 */
const bindings = {};

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

// TODO remove after debuggiing
// console.log = () => {};

OaeEmitter.on('ready', () => {
  emitter.emit('ready');
});

const getRedeliveryQueueFor = queueName => {
  return `${queueName}-redelivery`;
};

const getProcessingQueueFor = queueName => {
  return `${queueName}-processing`;
};

/**
 * Initialize the Message Queue system so that it can start sending and receiving messages.
 *
 * @param  {Object}    mqConfig        The MQ Configuration object
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const init = function(config, callback) {
  redisConfig = config;

  // Only init if the connections haven't been opened.
  if (manager === null) {
    Redis.createClient(config, (err, client) => {
      if (err) return callback(err);
      manager = client;

      Redis.createClient(config, (err, client) => {
        if (err) return callback(err);
        publisher = client;

        // if the flag is set, we purge all queues on startup. ONLY if we're NOT in production mode.
        const shallWePurge = redisConfig.purgeQueuesOnStartup && process.env.NODE_ENV !== PRODUCTION_MODE;
        if (shallWePurge) {
          purgeAllQueues(callback);
        }
      });
    });
  }
};

const _getOrCreateSubscriberForQueue = (queueName, callback) => {
  if (subscribers[queueName]) {
    return callback(null, subscribers[queueName]);
  }

  Redis.createClient(redisConfig, (err, client) => {
    if (err) return callback(err);

    subscribers[queueName] = client;
    return callback(null, subscribers[queueName]);
  });
};

/**
 * Stop consuming messages from a queue.
 *
 * @param  {String}    queueName       The name of the message queue to unsubscribe from
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */

/**
 * Subscribe the given `listener` function to the provided queue.
 *
 * @param  {Queue}      queueName           The queue to which we'll subscribe the listener
 * @param  {Object}     subscribeOptions    The options with which we wish to subscribe to the queue
 * @param  {Function}   listener            The function that will handle messages delivered from the queue
 * @param  {Object}     listener.data       The data that was sent in the message. This is different depending on the type of job
 * @param  {Function}   listener.callback   The listener callback. This must be invoked in order to acknowledge that the message was handled
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const collectLatestFromQueue = (queueName, listener) => {
  _getOrCreateSubscriberForQueue(queueName, (err, subscriber) => {
    subscriber.brpoplpush(queueName, getProcessingQueueFor(queueName), 0, (err, queuedMessage) => {
      const message = JSON.parse(queuedMessage);
      listener(message, err => {
        /*
         * Lets set the convention that if the listener function
         * returns the callback with an error, then something went
         * unpexpectadly wrong, and we need to know about it.
         * Hence, we're sending it to a special queue for analysis
         */
        if (err) {
          log().warn(
            { err },
            `Using the redelivery mechanism for a message that failed running ${listener.name} on ${queueName}`
          );
          _redeliverToSpecialQueue(queueName, queuedMessage);
        }

        subscriber.lrem(getProcessingQueueFor(queueName), -1, queuedMessage, err => {
          if (err) log().error('Unable to LREM from redis, message is kept on ' + queueName);

          // remove message from processing queue
          emitter.emit('postHandle', null, queueName, message, null, null);

          /*
            // recursive call itself if there are more tasks to be consumed
            subscriber.llen(queueName, (err, stillQueued) => {
              if (stillQueued > 0) {
                console.log('-> Still ' + stillQueued + ' tasks there, gonna listen from [' + queueName + ']');
                return collectLatestFromQueue(queueName, listener);
              }
            });
            */
        });
      });
    });
  });
};

const _redeliverToSpecialQueue = (queueName, message) => {
  publisher.lpush(getRedeliveryQueueFor(queueName), message, () => {});
};

/*
const collectAllStalledFromQueue = (queueName, listener, done) => {
  // debug
  console.log('Collecting ALL from [' + queueName + '] recursively');

  _getOrCreateSubscriberForQueue(queueName, (err, subscriber) => {
    // recursive so we parse all the tasks on queue
    subscriber.llen(queueName, (err, length) => {
      if (err) console.log(err);

      const areThereMoreTasksToConsume = length > 0;
      if (areThereMoreTasksToConsume) {
        console.log('There are ' + length + ' tasks left to consume... recursive call incoming!');
        collectLatestFromQueue(queueName, listener, () => {
          collectAllStalledFromQueue(queueName, listener, done);
        });
      } else {
        return done();
      }
    });
  });
};
*/

const subscribe = (queueName, listener, callback) => {
  callback = callback || function() {};
  const validator = new Validator();
  validator.check(queueName, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  if (validator.hasErrors()) return callback(validator.getFirstError());

  /**
   * We need to do three different things here:
   * 1 remove all previous listeners, otherwise we'll stack them
   * 2 add a new listener for future tasks submitted (via lpush command event listener)
   * 3 make sure we consume all past events/tasks that haven't been consumed yet
   */

  // make sure the listener isn't repetitive
  /*
  const filtersForThisQueue = _.filter(emitter.listeners(), eachListener => {
    return eachListener === `collectFrom:${queueName}`;
  }).length;

  if (filtersForThisQueue > 1) {
    console.log('\n\nSERIOUS SHIT GOING ON HERE\n\n');
  }
  */

  emitter.on(`collectFrom:${queueName}`, emittedQueue => {
    if (emittedQueue === queueName) {
      collectLatestFromQueue(queueName, listener);
    }
  });

  bindings[queueName] = getProcessingQueueFor(queueName);
  return callback();
};

const unsubscribe = (queueName, callback) => {
  callback = callback || function() {};
  const validator = new Validator();
  validator.check(queueName, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  if (validator.hasErrors()) return callback(validator.getFirstError());

  emitter.removeAllListeners(`collectFrom:${queueName}`);
  delete bindings[queueName];
  return callback();
};

const getBoundQueues = function() {
  // return _.keys(bindings);
  return bindings;
};

/**
 * Submit a message to an exchange
 *
 * @param  {String}     exchangeName                The name of the exchange to submit the message too
 * @param  {String}     routingKey                  The key with which the message can be routed
 * @param  {Object}     [data]                      The data to send with the message. This will be received by the worker for this type of task
 * @param  {Object}     [options]                   A set of options to publish the message with. See https://github.com/postwait/node-amqp#exchangepublishroutingkey-message-options-callback for more information
 * @param  {Function}   [callback]                  Invoked when the job has been submitted, note that this does *NOT* guarantee that the message reached the exchange as that is not supported by amqp
 * @param  {Object}     [callback.err]              Standard error object, if any
 */
const submit = (queueName, message, callback) => {
  callback = callback || function() {};
  const validator = new Validator();
  validator.check(queueName, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  // validator.check(message, { code: 400, msg: 'No message was provided.' }).notEmpty();
  if (validator.hasErrors()) return callback(validator.getFirstError());

  // TODO I dont think the second condition is relevant
  // if (bindings[queueName] || queueName.indexOf('oae-activity-push') !== -1) {

  if (bindings[queueName]) {
    emitter.emit('preSubmit', queueName);

    publisher.lpush(queueName, message, () => {
      emitter.emit(`collectFrom:${queueName}`, queueName);
      return callback();
    });
  } else {
    return callback();
  }
};

const submitJSON = (queueName, message, callback) => {
  submit(queueName, JSON.stringify(message), callback);
};

/**
 * Reject a message through the channel object
 * @function rejectMessage
 * @param  {Object} message  The message to be rejected
 * @param  {Boolean} requeue  Whether the message should be requeued
 * @param  {Function} callback Standard callback function
 */
/*
const rejectMessage = function(message, requeue, callback) {
  channel.reject(message, requeue);
  return callback();
};
*/

/**
 * Safely shutdown the MQ service after all current tasks are completed.
 *
 * @param  {Function}   Invoked when shutdown is complete
 * @api private
 */

// TODO do this or similar
OAE.registerPreShutdownHandler('mq', null, done => {
  done();
});

// Whether or not the "in-memory queue" is already being processed
const isWorking = false;

/*
const subscribeQueue = function(queueName, subscribeOptions, listener, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().warn({ err, queueName, subscribeOptions }, 'An error occurred while subscribing to a queue');
      }
    };

  if (!queues[queueName]) {
    log().error({
      queueName,
      subscribeOptions,
      err: new Error('Tried to subscribe to an unknown queue')
    });
    return callback({ code: 400, msg: 'Tried to subscribe to an unknown queue' });
  }

  channel
    .consume(
      queueName,
      msg => {
        const { headers } = msg.properties;
        const data = JSON.parse(msg.content.toString());
        const deliveryInfo = msg.fields;
        deliveryInfo.queue = queueName;

        log().trace(
          {
            queueName,
            data,
            headers,
            deliveryInfo
          },
          'Received an MQ message.'
        );

        const deliveryKey = util.format('%s:%s', deliveryInfo.queue, deliveryInfo.deliveryTag);

        // When a message arrives that was redelivered, we do not give it to the handler. Auto-acknowledge
        // it and push it into the redelivery queue to be inspected manually
        if (deliveryInfo.redelivered) {
          const redeliveryData = {
            headers,
            deliveryInfo,
            data
          };

          submit(
            MqConstants.REDELIVER_EXCHANGE_NAME,
            MqConstants.REDELIVER_QUEUE_NAME,
            redeliveryData,
            MqConstants.REDELIVER_SUBMIT_OPTIONS,
            err => {
              if (err) {
                log().warn({ err }, 'An error occurred delivering a redelivered message to the redelivery queue');
              }

              MQ.emit('storedRedelivery', queueName, data, headers, deliveryInfo, msg);
            }
          );

          return channelWrapper.ack(msg);
        }

        // Indicate that this server has begun processing a new task
        _incrementProcessingTask(deliveryKey, data, deliveryInfo);
        MQ.emit('preHandle', queueName, data, headers, deliveryInfo, msg);

        try {
          // Pass the message data to the subscribed listener
          listener(data, err => {
            if (err) {
              log().error(
                {
                  err,
                  queueName,
                  data
                },
                'An error occurred processing a task'
              );
            } else {
              log().trace(
                {
                  queueName,
                  data,
                  headers,
                  deliveryInfo
                },
                'MQ message has been processed by the listener'
              );
            }

            // Acknowledge that we've seen the message.
            // Note: We can't use queue.shift() as that only acknowledges the last message that the queue handed to us.
            // This message and the last message are not necessarily the same if the prefetchCount was higher than 1.
            if (subscribeOptions.ack !== false) {
              channelWrapper.ack(msg);
            }

            // Indicate that this server has finished processing the task
            _decrementProcessingTask(deliveryKey, deliveryInfo);
            MQ.emit('postHandle', null, queueName, data, headers, deliveryInfo);
          });
        } catch (error) {
          log().error(
            {
              err: error,
              queueName,
              data
            },
            'Exception raised while handling job'
          );

          // Acknowledge that we've seen the message
          if (subscribeOptions.ack !== false) {
            channelWrapper.ack(msg);
          }

          // Indicate that this server has finished processing the task
          _decrementProcessingTask(deliveryKey, deliveryInfo);
          MQ.emit('postHandle', error, queueName, data, headers, deliveryInfo);
        }
      },
      subscribeOptions
    )
    .then(ok => {
      if (!ok) {
        log().error({ queueName, err: new Error('Error binding worker for queue') });
        return unsubscribeQueue(queueName, () => {
          // Don't overwrite the original error with any binding errors
          return callback({ code: 500, msg: 'Error binding a worker for queue' });
        });
      }

      // Keep the consumerTag so we can unsubscribe later
      queues[queueName].consumerTag = ok.consumerTag;
      return callback();
    });
};
*/

/**
 * Wait until our set of pending tasks has drained. If it takes longer than `maxWaitMillis`, it will
 * dump the pending tasks in the log that are holding things up and force continue.
 *
 * @param  {Number}     maxWaitMillis   The maximum amount of time (in milliseconds) to wait for pending tasks to finish
 * @param  {Function}   callback        Standard callback function
 * @api private
 */
const _waitUntilIdle = function(maxWaitMillis, callback) {};

/**
 * Purge a queue.
 *
 * @param  {String}     queueName       The name of the queue to purge.
 * @param  {Function}   [callback]      Standard callback method
 * @param  {Object}     [callback.err]  An error that occurred purging the queue, if any
 */

/**
 * Create a queue that will be used to hold on to messages that were rejected / failed to acknowledge
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
/*
const _createRedeliveryQueue = function(callback) {
  // Don't declare if we've already declared it on this node
  if (queues[MqConstants.REDELIVER_QUEUE_NAME]) {
    return callback();
  }

  // Declare an exchange with a queue whose sole purpose is to hold on to messages that were "redelivered". Such
  // situations include errors while processing or some kind of client error that resulted in the message not
  // being acknowledged
  declareExchange(MqConstants.REDELIVER_EXCHANGE_NAME, MqConstants.REDELIVER_EXCHANGE_OPTIONS, err => {
    if (err) {
      return callback(err);
    }

    declareQueue(MqConstants.REDELIVER_QUEUE_NAME, MqConstants.REDELIVER_QUEUE_OPTIONS, err => {
      if (err) {
        return callback(err);
      }

      return bindQueueToExchange(
        MqConstants.REDELIVER_QUEUE_NAME,
        MqConstants.REDELIVER_EXCHANGE_NAME,
        MqConstants.REDELIVER_QUEUE_NAME,
        callback
      );
    });
  });
};
*/

/**
 * Record the fact that we have begun processing this task.
 *
 * @param  {String}     deliveryKey         A (locally) unique identifier for this message
 * @param  {Object}     data                The task data
 * @param  {Object}     deliveryInfo        The delivery info from RabbitMQ
 * @api private
 */
const _incrementProcessingTask = function(deliveryKey, data, deliveryInfo) {
  messagesInProcessing[deliveryKey] = { data, deliveryInfo };
  numMessagesInProcessing++;
};

/**
 * Record the fact that we have finished processing this task.
 *
 * @param  {String}     deliveryKey         A (locally) unique identifier for this message
 * @api private
 */
const _decrementProcessingTask = function(deliveryKey) {
  delete messagesInProcessing[deliveryKey];
  numMessagesInProcessing--;

  if (numMessagesInProcessing === 0) {
    emitter.emit('idle');
  } else if (numMessagesInProcessing < 0) {
    // In this case, what likely happened was we overflowed our concurrent tasks, flushed it to 0, then
    // some existing tasks completed. This is the best way I can think of handling it that will "self
    // recover" eventually. Concurrent tasks overflowing is a sign of a leak (i.e., a task is handled
    // but never acknowleged). When this happens there should be a dump of some tasks in the logs and
    // and they should be investigated and resolved.
    numMessagesInProcessing = 0;
  }
};

/**
 * Log a message with the in-processing messages in the log line. This will log at must `NUM_MESSAGES_TO_DUMP`
 * messages.
 *
 * @param  {String}     logMessage
 * @api private
 */
/*
const _dumpProcessingMessages = function(logMessage) {
  log().warn({ messages: _.values(messagesInProcessing).slice(0, NUM_MESSAGES_TO_DUMP) }, logMessage);
};
*/

const noNeedToDeclareQueue = (name, options, callback) => {
  return callback();
};

const noNeedToDeclareExchange = (name, options, callback) => {
  return callback();
};

const noNeedToUnbindQueue = (name, exchangeName, stream, callback) => {
  return callback();
};

const noNeedToBindQueueToExchange = (name, exchangeName, stream, callback) => {
  return callback();
};

const purgeQueue = (queueName, callback) => {
  emitter.emit('prePurge', queueName);
  manager.llen(queueName, (err, count) => {
    manager.del(queueName, err => {
      if (err) return callback(err);

      emitter.emit('postPurge', queueName, 1);

      return callback();
    });
  });
};

const purgeAllQueues = callback => {
  const purgeQueues = (allQueues, done) => {
    if (allQueues.length === 0) {
      return done();
    }

    const nextQueueToPurge = allQueues.pop();
    purgeQueue(nextQueueToPurge, () => {
      purgeQueue(getProcessingQueueFor(nextQueueToPurge), () => {
        return purgeQueues(allQueues, done);
      });
    });
  };

  const queuesToPurge = _.keys(bindings);
  purgeQueues(queuesToPurge, callback);
};

export {
  emitter,
  // rejectMessage,
  init,
  noNeedToDeclareExchange as declareExchange,
  noNeedToDeclareQueue as declareQueue,
  noNeedToUnbindQueue as unbindQueueFromExchange,
  noNeedToBindQueueToExchange as bindQueueToExchange,
  subscribe,
  unsubscribe,
  purgeQueue as purge,
  purgeAllQueues as purgeAll,
  getBoundQueues,
  submit,
  submitJSON
};
