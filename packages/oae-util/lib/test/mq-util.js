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

import PreviewConstants from 'oae-preview-processor/lib/constants';
import Counter from 'oae-util/lib/counter';
import * as MQ from 'oae-util/lib/mq';
// import * as pubSub from 'oae-util/lib/pubsub';

// Track when counts for a particular type of task return to 0
const queueCounters = {};

MQ.emitter.on('preSubmit', channel => {
  // Technically, the routing key is not the same as the queue, all the Task Queues in OAE however
  // use the same routing key as their destination queue name
  // debug
  // console.log('Incrementing on ' + channel);
  _increment(channel);
});

MQ.emitter.on('postHandle', (err, channel) => {
  // debug
  // console.log('Decrementing on ' + channel);
  _decrement(channel, 1);
});

MQ.emitter.on('postPurge', (name, count) => {
  // _decrement(name, count);
  count = _get(name);
  // debug
  console.log(count + ' tasks to delete on [' + name + ']');
  _decrement(name, count); // decrements until 0
});

/**
 * Invoke the given handler only if the local counter of tasks of the given name indicates that the task queue is completely
 * empty. If it is not empty now, then the handler will be invoked when it becomes empty.
 *
 * This is ONLY useful in a local development environment where one application node is firing and handling all tasks.
 *
 * @param  {String}     name        The name of the task to listen for empty events
 * @param  {Function}   handler     The handler to invoke when the task queue is empty
 */
const whenTasksEmpty = function(name, handler) {
  if (!queueCounters[name] || !_hasQueue(name)) {
    // debug
    if (name === PreviewConstants.MQ.TASK_GENERATE_PREVIEWS) console.log('Tasks empty for ' + name);
    return handler();
  }

  // debug
  // if (name === PreviewConstants.MQ.TASK_GENERATE_PREVIEWS) console.log('Waiting for Zero counter found for ' + name);
  // Bind the handler to the counter for this queue
  queueCounters[name].whenZero(handler);
};

/**
 * Increment the count for a task of the given name
 *
 * @param  {String}     name    The name of the task whose count to increment
 * @api private
 */
const _increment = function(name) {
  if (_hasQueue(name)) {
    // debug
    if (name === PreviewConstants.MQ.TASK_GENERATE_PREVIEWS) {
      console.log('Incrementing for [' + name + ']');
    }

    queueCounters[name] = queueCounters[name] || new Counter();
    queueCounters[name].incr();
  }

  // pubSub.getBoundQueueNames[name] = Date.now();
};

const _get = name => {
  if (_hasQueue(name)) {
    queueCounters[name] = queueCounters[name] || new Counter();
    return queueCounters[name].get();
  }

  return 0;
};

/**
 * Determines if MQ has a handler bound for a task by the given name.
 *
 * @return {Boolean}    Whether or not there is a task bound
 * @api private
 */
const _hasQueue = function(name) {
  // return _.contains(_.keys(queueCounters), name);
  return _.contains(MQ.getBoundQueueNames(), name);
};

/**
 * Decrement the count for a task of the given name, firing any `whenTasksEmpty` handlers that are
 * waiting for the count to reach 0, if appropriate
 *
 * @param  {String}     name    The name of the task whose count to decrement
 * @api private
 */
const _decrement = function(name, count) {
  // debug
  if (name === PreviewConstants.MQ.TASK_GENERATE_PREVIEWS && count !== 0)
    console.log('Decrementing ' + count + ' for [' + name + ']');

  queueCounters[name] = queueCounters[name] || new Counter();
  queueCounters[name].decr(count);
};

export { whenTasksEmpty };
