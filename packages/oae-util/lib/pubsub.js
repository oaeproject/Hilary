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

import _ from 'underscore';
import { EventEmitter } from 'oae-emitter';
import PreviewConstants from 'oae-preview-processor/lib/constants';
import * as Redis from './redis';
import { Validator } from './validator';

/*!
 * This module abstracts most of the redis publish/subscribe functions away.
 * It will listen to all channels and emit an event for each message it receives.
 * The redis channel name will be the event name and the message it's only argument.
 */

// Create the event emitter
const emitter = new EventEmitter();
let manager = null;
// this object will contain all subscribers, one for each channel basically plus another for general use
const subscribers = {};
let publisher = null;
const queues = {};
let redisConfig = null;
console.log = () => {};

/**
 * Initializes the connection to redis.
 */
const init = function(config, callback) {
  redisConfig = config;
  // Only init if the connections haven't been opened.
  if (manager === null) {
    // Create 3 clients, one for managing redis and 2 for the actual pub/sub communication.
    Redis.createClient(config, (err, client) => {
      if (err) {
        return callback(err);
      }

      manager = client;
      manager.monitor((err, monitor) => {
        monitor.on('monitor', (time, args, source, database) => {
          // console.log(`${time}: ${args} : ${source} : ${database}`);
        });
      });
      Redis.createClient(config, (err, client) => {
        if (err) {
          return callback(err);
        }

        // subscriber = client;
        subscribers.general = client;
        subscribers.general.monitor((err, monitor) => {
          monitor.on('monitor', (time, args, source, database) => {
            // console.log(`${time}: ${args} : ${source} : ${database}`);
          });
        });
        Redis.createClient(config, (err, client) => {
          if (err) {
            return callback(err);
          }

          publisher = client;
          publisher.monitor((err, monitor) => {
            monitor.on('monitor', (time, args, source, database) => {
              // console.log(`${time}: ${args} : ${source} : ${database}`);
            });
          });

          // Listen to all channels and emit them as events.
          subscribers.general.on('pmessage', (pattern, channel, message) => {
            // debug
            // console.log('Listening on ' + channel + ': ' + message);
            console.log(`-> Emitting message: [${pattern}|${channel}|${message}]`);
            emitter.emit(channel, message);
          });
          // subscribers.general.psubscribe('oae-*', callback);
          subscribers.general.psubscribe(
            ['oae-tests', 'oae-search*', 'oae-tenants', 'oae-tenant-networks', 'oae-config'],
            callback
          );
        });
      });
    });
  }
};

const _getOrCreateSubscriberForChannel = (channel, callback) => {
  if (subscribers[channel]) {
    // debug
    console.log('-> Subscriber for [' + channel + '] exists, returning it');
    return callback(null, subscribers[channel]);
  }

  Redis.createClient(redisConfig, (err, client) => {
    if (err) return callback(err);

    // debug
    console.log('-> Subscriber for [' + channel + '] created, returning it');
    subscribers[channel] = client;
    return callback(null, subscribers[channel]);
  });
};

/**
 * Broadcast a message accross a channel.
 * This can be used to publish messages to all the app nodes.
 *
 * @param  {String}    channel          The channel you wish to publish on. ex: 'oae-tenants'
 * @param  {String}    message          The message you wish to send on a channel. ex: 'start 2000'
 * @param  {Function}  callback         Standard callback function
 * @param  {Object}    callback.err     An error that occurred, if any
 */
const publish = function(channel, message, callback) {
  callback = callback || function() {};
  const validator = new Validator();
  validator.check(channel, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  validator.check(message, { code: 400, msg: 'No message was provided.' }).notEmpty();
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  /*
  if (_.isObject(message)) {
    message = JSON.stringify(message);
  }
  */

  emitter.emit('preSubmit', channel);
  publisher.publish(channel, message, callback);
};

const unsubscribe = (channel, callback) => {
  const validator = new Validator();
  validator.check(channel, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  // get the proper subscriber
  _getOrCreateSubscriberForChannel(channel, (err, subscriber) => {
    subscriber.unsubscribe(channel, () => {
      console.log('Unsubscribing to [' + channel + ']');
      subscriber.removeAllListeners('message');
      // debug
      if (channel === PreviewConstants.MQ.TASK_GENERATE_PREVIEWS) {
        console.log('  -> Gonna UNbind a function to the onMessage event for [' + channel + ']\n');
      }

      delete queues[channel];
      console.log('  √ Marking [' + channel + '] as UNBOUND ');
      return callback();
    });
  });
};

const subscribe = (channel, listener, callback) => {
  callback = callback || function() {};
  const validator = new Validator();
  validator.check(channel, { code: 400, msg: 'No channel was provided.' }).notEmpty();
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  // if this has been suscribed already, then leave
  const thisChannelisAlreadyBound = Boolean(queues[channel]);
  if (thisChannelisAlreadyBound) {
    // debug
    console.log('NOT subscribing to [' + channel + "] because it's already there");
    return callback();
  }

  // get the proper subscriber
  _getOrCreateSubscriberForChannel(channel, (err, subscriber) => {
    subscriber.subscribe(channel, (err, count) => {
      // debug
      console.log('Subscribing to [' + channel + ']');

      if (err) return callback(err);

      // debug
      if (channel === PreviewConstants.MQ.TASK_GENERATE_PREVIEWS) {
        console.log('  -> Gonna bind a function to the onMessage event for [' + channel + ']\n');
      }

      subscriber.on('message', (whichChannel, message) => {
        if (whichChannel === channel) {
          // debug
          if (channel === PreviewConstants.MQ.TASK_GENERATE_PREVIEWS) {
            console.log('\nHeard something from [' + channel + ']');
            // console.log('=> ' + message + '\n');
          }

          message = JSON.parse(message);
          try {
            listener(message, () => {
              // queues[queueName].consumerTag = ok.consumerTag;
              queues[whichChannel] = Date.now();

              // debug
              console.log('-> Sending POSTHANDLE for ' + whichChannel);
              emitter.emit('postHandle', null, whichChannel, message, null, null);
              // return callback();
            });
          } catch (error) {
            // debug
            console.log('Exception caught, what am I gonna do??');
          }
        }
      });
      // add to bound queues
      if (channel === PreviewConstants.MQ.TASK_GENERATE_PREVIEWS) {
        console.log('  √ Marking [' + channel + '] as BOUND ');
      }

      queues[channel] = Date.now();
      return callback();
    });
  });
};

const getBoundQueueNames = function() {
  return _.keys(queues);
};

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

const noNeedToPurge = (queueName, callback) => {
  emitter.emit('prePurge', queueName);
  emitter.emit('postPurge', queueName, 1);
  return callback();
};

const noNeedToPurgeAll = callback => {
  return callback();
};

export {
  noNeedToDeclareExchange as declareExchange,
  noNeedToDeclareQueue as declareQueue,
  noNeedToUnbindQueue as unbindQueueFromExchange,
  noNeedToBindQueueToExchange as bindQueueToExchange,
  noNeedToPurge as purge,
  noNeedToPurgeAll as purgeAll,
  getBoundQueueNames,
  publish,
  init,
  emitter,
  subscribe,
  unsubscribe
};
