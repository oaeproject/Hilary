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

// import util from 'util';
import _ from 'underscore';

import { EventEmitter } from 'oae-emitter';
import { logger } from 'oae-logger';
// import PreviewConstants from 'oae-preview-processor/lib/constants';
import * as Redis from './redis';
import OaeEmitter from './emitter';
import * as OAE from './oae';
import { Validator } from './validator';

const log = logger('mq');

// Create the event emitter
const emitter = new EventEmitter();
let redisConfig = null;

let manager = null;
let publisher = null;

const bindings = {};
const subscribers = {};

const PROCESSING_QUEUE = 'processing';

// TODO remove after debuggiing
console.log = () => {};

OaeEmitter.on('ready', () => {
  // Let ready = true;
  emitter.emit('ready');
});

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
    // Create 3 clients, one for managing redis and 2 for the actual pub/sub communication.
    Redis.createClient(config, (err, client) => {
      if (err) return callback(err);

      manager = client;

      Redis.createClient(config, (err, client) => {
        if (err) return callback(err);

        // subscriber = client;
        subscribers.general = client;

        Redis.createClient(config, (err, client) => {
          if (err) return callback(err);

          publisher = client;
          return callback();
        });
      });
    });
  }
};

const _getOrCreateSubscriberForQueue = (queueName, callback) => {
  if (subscribers[queueName]) {
    // debug
    // console.log('-> Returning existing subscriber for [' + queueName + ']');
    return callback(null, subscribers[queueName]);
  }

  Redis.createClient(redisConfig, (err, client) => {
    if (err) return callback(err);

    // debug
    // console.log('-> Created subscriber for [' + queueName + ']');
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
    // debug
    console.log('Waiting for something to arrive at [' + queueName + ']');
    subscriber.brpoplpush(queueName, PROCESSING_QUEUE, 0, (err, queuedMessage) => {
      // debug
      console.log('Collected latest from [' + queueName + ']');
      const message = JSON.parse(queuedMessage);
      try {
        listener(message, () => {
          subscriber.lrem(PROCESSING_QUEUE, -1, queuedMessage, (err, removedElements) => {
            if (err) console.log(err);

            // debug
            console.log('\n-> Removed ' + removedElements + ' task from PROCESSING queue from [' + queueName + ']...');

            // remove message from processing queue
            console.log('\n-> Sending POSTHANDLE for [' + queueName + ']');
            emitter.emit('postHandle', null, queueName, message, null, null);

            /*
            // recursive call itself because it's a never ending job
            console.log('-> Going to listen from [' + queueName + ']');
            return collectLatestFromQueue(queueName, listener);
            */
          });
        });
      } catch (error) {
        // debug
        console.log('Exception caught, what am I gonna do??');
        console.log(error);
      }
    });
  });
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

  // debug
  console.log('-> Subscribing to [' + queueName + ']');

  /**
   * We need to do three different things here:
   * 1 remove all previous listeners, otherwise we'll stack them
   * 2 add a new listener for future tasks submitted (via lpush command event listener)
   * 3 make sure we consume all past events/tasks that haven't been consumed yet
   */
  emitter.on(`collectFrom:${queueName}`, emittedQueue => {
    if (emittedQueue === queueName) {
      // console.log('-> Going to listen from [' + queueName + ']');
      collectLatestFromQueue(queueName, listener);
    }
  });

  // debug: print all listeners
  console.log();
  console.log(emitter.listeners());
  console.log();

  bindings[queueName] = PROCESSING_QUEUE;
  return callback();
};

const unsubscribe = (queueName, callback) => {
  callback = callback || function() {};
  const validator = new Validator();
  validator.check(queueName, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  if (validator.hasErrors()) return callback(validator.getFirstError());

  // debug
  console.log('-> Unsubscribing to [' + queueName + ']');

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
const submit = function(queueName, message, callback) {
  callback = callback || function() {};
  const validator = new Validator();
  validator.check(queueName, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  // validator.check(message, { code: 400, msg: 'No message was provided.' }).notEmpty();
  if (validator.hasErrors()) return callback(validator.getFirstError());

  // TODO I dont think the second condition is relevant
  if (bindings[queueName] || queueName.indexOf('oae-activity-push') !== -1) {
    console.log('-> Sending PRESUBMIT for [' + queueName + ']');
    emitter.emit('preSubmit', queueName);
    publisher.lpush(queueName, message, () => {
      emitter.emit(`collectFrom:${queueName}`, queueName);
      console.log(`\n-> Just emitted the collectFrom:${queueName} event!!`);
      return callback();
    });
  } else {
    console.log('-> Ignoring submission to unbound [' + queueName + ']...');
    return callback();
  }
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
  console.log('coco');
  done();
});

/**
 * Declare an exchange
 *
 * @param  {String}     exchangeName        The name of the exchange that should be declared
 * @param  {Object}     exchangeOptions     The options that should be used to declare this exchange. See https://github.com/postwait/node-amqp/#connectionexchangename-options-opencallback for a full list of options
 * @param  {Function}   callback            Standard callback function
 */
/*
const declareExchange = function(exchangeName, exchangeOptions, callback) {
  if (!exchangeName) {
    log().error({
      exchangeName,
      err: new Error('Tried to declare an exchange without providing an exchange name')
    });
    return callback({
      code: 400,
      msg: 'Tried to declare an exchange without providing an exchange name'
    });
  }

  if (exchanges[exchangeName]) {
    log().error({ exchangeName, err: new Error('Tried to declare an exchange twice') });
    return callback({ code: 400, msg: 'Tried to declare an exchange twice' });
  }

  channel.assertExchange(exchangeName, exchangeOptions.type, exchangeOptions, (err, ok) => {
    if (err) log().error({ exchangeName, err: new Error('Unable to declare an exchange') });

    exchanges[exchangeName] = ok.exchange;
    return callback();
  });
};
*/

/*
 * Because amqp only supports 1 queue.bind at the same time we need to
 * do them one at a time. To ensure that this is happening, we create a little
 * "in-memory queue" with bind actions that need to happen. This is all rather unfortunate
 * but there is currently no way around this.
 *
 * The reason:
 * Each time you do `Queue.bind(exchangeName, routingKey, callback)`, amqp will set an internal
 * property on the Queue object called `_bindCallback`. Unfortunately this means that whenever you
 * do 2 binds before RabbitMQ has had a chance to respond, the initial callback function will have been overwritten.
 *
 * Example:
 *   Queue.bind('house', 'door', cb1);  // Queue._bindCallback points to cb1
 *   Queue.bind('house', 'roof', cb2);  // Queue._bindCallback points to cb2
 *
 * When RabbitMQ responds with a `queueBindOk` frame for the house->door binding, amqp will execute cb2 and set _bindCallback to null.
 * When RabbitMQ responds with a `queueBindOk` frame for the house->roof binding, amqp will do nothing
 */

// Whether or not the "in-memory queue" is already being processed
const isWorking = false;

/**
 * A function that will pick RabbitMQ queues of the `queuesToBind` queue and bind them.
 * This function will ensure that at most 1 bind runs at the same time.
 */
/*
const _processBindQueue = function(callback) {
  // If there is something to do and we're not already doing something we can do some work
  if (queuesToBind.length > 0 && !isWorking) {
    isWorking = true;

    const todo = queuesToBind.shift();
    channel.bindQueue(todo.queueName, todo.exchangeName, todo.routingKey, err => {
      if (err) {
        log().error({
          queueName: todo.queueName,
          err: new Error('Unable to bind queue to an exchange')
        });
        return todo.callback(err);
      }

      log().trace(
        {
          queueName: todo.queueName,
          exchangeName: todo.exchangeName,
          routingKey: todo.routingKey
        },
        'Bound a queue to an exchange'
      );
      const doPurge = purgeQueuesOnStartup && !startupPurgeStatus[todo.queueName];
      if (doPurge) {
        // Ensure this queue only gets purged the first time we connect
        startupPurgeStatus[todo.queueName] = true;

        // Purge the queue before subscribing the handler to it if we are configured to do so.
        purge(todo.queueName, todo.callback);
      } else {
        todo.callback();
      }

      isWorking = false;
      _processBindQueue(callback);
    });
  }
};
*/

/**
 * Binds a queue to an exchange.
 * The queue will be purged upon connection if the server has been configured to do so.
 *
 * @param  {String}     queueName       The name of the queue to bind
 * @param  {String}     exchangeName    The name of the exchange to bind too
 * @param  {String}     routingKey      A string that should be used to bind the queue too the exchange
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
/*
const bindQueueToExchange = function(queueName, exchangeName, routingKey, callback) {
  if (!queues[queueName]) {
    log().error({
      queueName,
      exchangeName,
      routingKey,
      err: new Error('Tried to bind a non existing queue to an exchange, have you declared it first?')
    });
    return callback({
      code: 400,
      msg: 'Tried to bind a non existing queue to an exchange, have you declared it first?'
    });
  }

  if (!exchanges[exchangeName]) {
    log().error({
      queueName,
      exchangeName,
      routingKey,
      err: new Error('Tried to bind a queue to a non-existing exchange, have you declared it first?')
    });
    return callback({
      code: 400,
      msg: 'Tried to bind a queue to a non-existing exchange, have you declared it first?'
    });
  }

  if (!routingKey) {
    log().error({
      queueName,
      exchangeName,
      routingKey,
      err: new Error('Tried to bind a queue to an existing exchange without specifying a routing key')
    });
    return callback({ code: 400, msg: 'Missing routing key' });
  }

  const todo = {
    queue: queues[queueName].queue,
    queueName,
    exchangeName,
    routingKey,
    callback
  };
  queuesToBind.push(todo);
  _processBindQueue();
};
*/

/**
 * Unbinds a queue from an exchange.
 *
 * @param  {String}     queueName       The name of the queue to unbind
 * @param  {String}     exchangeName    The name of the exchange to unbind from
 * @param  {String}     routingKey      A string that should be used to unbind the queue from the exchange
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
/*
const unbindQueueFromExchange = function(queueName, exchangeName, routingKey, callback) {
  if (!queues[queueName]) {
    log().error({
      queueName,
      exchangeName,
      routingKey,
      err: new Error('Tried to unbind a non existing queue from an exchange, have you declared it first?')
    });
    return callback({
      code: 400,
      msg: 'Tried to unbind a non existing queue from an exchange, have you declared it first?'
    });
  }

  if (!exchanges[exchangeName]) {
    log().error({
      queueName,
      exchangeName,
      routingKey,
      err: new Error('Tried to unbind a queue from a non-existing exchange, have you declared it first?')
    });
    return callback({
      code: 400,
      msg: 'Tried to unbind a queue from a non-existing exchange, have you declared it first?'
    });
  }

  if (!routingKey) {
    log().error({
      queueName,
      exchangeName,
      routingKey,
      err: new Error('Tried to unbind a queue from an exchange without providing a routingKey')
    });
    return callback({ code: 400, msg: 'No routing key was specified' });
  }

  // Queues[queueName].queue.unbind(exchangeName, routingKey);
  channel.unbindQueue(queueName, exchangeName, routingKey, {}, err => {
    if (err) {
      return callback(err);
    }

    log().trace({ queueName, exchangeName, routingKey }, 'Unbound a queue from an exchange');
    return callback();
  });
};
*/

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
 * Stop consuming messages from **ALL** the queues.
 *
 * @param  {Function}   callback    Standard callback function
 * @api private
 */

/*
const submit = function(exchangeName, routingKey, data, options, callback) {
  options = options || {};
  callback = callback || function() {};

  if (!exchanges[exchangeName]) {
    log().error({
      exchangeName,
      routingKey,
      err: new Error('Tried to submit a message to an unknown exchange')
    });
    return callback({ code: 400, msg: 'Tried to submit a message to an unknown exchange' });
  }

  if (!routingKey) {
    log().error({
      exchangeName,
      routingKey,
      err: new Error('Tried to submit a message without specifying a routingKey')
    });
    return callback({
      code: 400,
      msg: 'Tried to submit a message without specifying a routingKey'
    });
  }

  MQ.emit('preSubmit', routingKey);

  channelWrapper.publish(exchangeName, routingKey, data, options, err => {
    if (err) {
      log().error({ exchangeName, routingKey, data, options }, 'Failed to submit a message to an exchange');
      return callback(err);
    }

    return callback();
  });
};
*/

/**
 * Get the names of all the queues that have been declared with the application and currently have a listener bound to it
 *
 * @return {String[]}   A list of all the names of the queues that are declared with the application and currently have a listener bound to it
 */
/*
const getBoundQueueNames = function() {
  return _.chain(queues)
    .keys()
    .filter(queueName => {
      return !_.isUndefined(queues[queueName].consumerTag);
    })
    .value();
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
 * Purges all the known queues.
 * Note: This does *not* purge all the queues that are in RabbitMQ.
 * It only purges the queues that are known to the OAE system.
 *
 * @param  {Function}   [callback]      Standard callback method
 * @param  {Object}     [callback.err]  An error that occurred purging the queue, if any
 */
/*

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
/*
const _incrementProcessingTask = function(deliveryKey, data, deliveryInfo) {
  if (numMessagesInProcessing >= MAX_NUM_MESSAGES_IN_PROCESSING) {
    _dumpProcessingMessages(
      'Reached maximum number of concurrent messages allowed in processing (' +
        MAX_NUM_MESSAGES_IN_PROCESSING +
        '), this probably means there were many messages received that were never acknowledged.' +
        ' Clearing "messages in processing" to avoid a memory leak. Please analyze the set of message information (messages)' +
        ' dumped in this log and resolve the issue of messages not being acknowledged.'
    );

    messagesInProcessing = {};
    numMessagesInProcessing = 0;
  }

  messagesInProcessing[deliveryKey] = { data, deliveryInfo };
  numMessagesInProcessing++;
};
*/

/**
 * Record the fact that we have finished processing this task.
 *
 * @param  {String}     deliveryKey         A (locally) unique identifier for this message
 * @api private
 */
/*
const _decrementProcessingTask = function(deliveryKey) {
  delete messagesInProcessing[deliveryKey];
  numMessagesInProcessing--;

  if (numMessagesInProcessing === 0) {
    MQ.emit('idle');
  } else if (numMessagesInProcessing < 0) {
    // In this case, what likely happened was we overflowed our concurrent tasks, flushed it to 0, then
    // some existing tasks completed. This is the best way I can think of handling it that will "self
    // recover" eventually. Concurrent tasks overflowing is a sign of a leak (i.e., a task is handled
    // but never acknowleged). When this happens there should be a dump of some tasks in the logs and
    // and they should be investigated and resolved.
    numMessagesInProcessing = 0;
  }
};
*/

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
  // debug
  console.log('-> Purging queue ' + queueName);
  emitter.emit('prePurge', queueName);
  manager.del(queueName, err => {
    if (err) return callback(err);

    delete bindings[queueName];
    emitter.emit('postPurge', queueName, 1);

    return callback();
  });
};

const purgeAllQueues = callback => {
  // debug
  console.log('-> Purging all the queues!!!!');

  const purgeThemAll = (allQueues, done) => {
    if (allQueues.length === 0) {
      // purgeQueue(PROCESSING_QUEUE, callback);
      return done();
    }

    purgeQueue(allQueues.pop(), () => {
      return purgeThemAll(allQueues, done);
    });
  };

  const queuesToPurge = _.keys(bindings);
  // _.keys(getBoundQueueNames());
  purgeThemAll(queuesToPurge, callback);
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
  submit
  /*
  isQueueDeclared,
  bindQueueToExchange,
  */
};
