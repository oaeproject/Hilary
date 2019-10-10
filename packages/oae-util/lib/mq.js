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
        } else {
          return callback();
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
        /**
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
        });
      });
    });
  });
};

const _redeliverToSpecialQueue = (queueName, message) => {
  publisher.lpush(getRedeliveryQueueFor(queueName), message, () => {});
};

const subscribe = (queueName, listener, callback) => {
  callback = callback || function() {};
  const validator = new Validator();
  validator.check(queueName, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  if (validator.hasErrors()) return callback(validator.getFirstError());

  // make sure the listener isn't repetitive
  const thisQueueHasBeenSubscribedBefore = emitter.listeners(`collectFrom:${queueName}`).length > 0;
  if (thisQueueHasBeenSubscribedBefore) {
    log().warn(
      `There is already one listener for collectFrom:${queueName} event. Something is not right here, but I will remove the previous listener just in case.`
    );
    emitter.removeAllListeners(`collectFrom:${queueName}`);
  }

  emitter.on(`collectFrom:${queueName}`, emittedQueue => {
    if (emittedQueue === queueName) {
      collectLatestFromQueue(queueName, listener);
    }
  });

  queueBindings[queueName] = getProcessingQueueFor(queueName);
  return callback();
};

const unsubscribe = (queueName, callback) => {
  callback = callback || function() {};
  const validator = new Validator();
  validator.check(queueName, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  if (validator.hasErrors()) return callback(validator.getFirstError());

  emitter.removeAllListeners(`collectFrom:${queueName}`);
  delete queueBindings[queueName];
  return callback();
};

const getBoundQueues = function() {
  return queueBindings;
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

  if (queueBindings[queueName]) {
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
 * Safely shutdown the MQ service after all current tasks are completed.
 *
 * @param  {Function}   Invoked when shutdown is complete
 * @api private
 */

// TODO do this or similar
OAE.registerPreShutdownHandler('mq', null, done => {
  done();
});

/**
 * Purge a queue.
 *
 * @param  {String}     queueName       The name of the queue to purge.
 * @param  {Function}   [callback]      Standard callback method
 * @param  {Object}     [callback.err]  An error that occurred purging the queue, if any
 */
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

  const queuesToPurge = _.keys(queueBindings);
  purgeQueues(queuesToPurge, callback);
};

export {
  emitter,
  init,
  subscribe,
  unsubscribe,
  purgeQueue as purge,
  purgeAllQueues as purgeAll,
  getBoundQueues,
  submit,
  submitJSON
};
