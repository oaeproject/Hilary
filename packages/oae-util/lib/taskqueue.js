/*!
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
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

import * as MQ from './mq';

/**
 * ## The Task Queue API.
 *
 * This is a thin wrapper around the MQ utility abstracting most of the
 * pain of Exchanges, Queues, bindings, etc..
 *
 * It can be used as a simple task queue where tasks can be submitted to
 * and consumed from.
 */

/**
 * A task queue is a simple queue where messages are considered tasks.
 * A queue will be created for each unique `taskQueueId`
 *
 * @param  {String}     taskQueueId             The task queue to which the consumer should be bound
 * @param  {Function}   listener                A function that will be executed each time a task is received
 * @param  {Object}     listener.data           The data that is present in the task
 * @param  {Function}   listener.callback       A function that should be executed when the task has been completed
 * @param  {Object}     [options]               A set of options that can help with either declaring the queue or subscribing to it
 * @param  {Object}     [options.queue]         A set of options that can override the `Constants.DEFAULT_TASK_QUEUE_OPTS`.
 * @param  {Object}     [options.subscribe]     A set of options that can override the `Constants.DEFAULT_TASK_QUEUE_SUBSCRIBE_OPTS`.
 * @param  {Function}   callback                Standard callback function
 */
const bind = (taskQueueId, listener, options, callback) => {
  MQ.subscribe(taskQueueId, listener, callback);
};

/**
 * Stop consuming tasks from the task queue.
 *
 * @param  {String}     taskQueueId     The name of the task queue to stop consuming messages from.
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const unbind = function(taskQueueId, callback) {
  MQ.unsubscribe(taskQueueId, callback);
};

/**
 * Submits a task to the queue.
 *
 * @param  {String}     taskQueueId     The name of the task queue where the data should be submitted to
 * @param  {Object}     taskData        The data that should be made available to the consumer of this task
 * @param  {Function}   callback        Standard callback function
 */
const submit = function(taskQueueId, taskData, callback) {
  MQ.submit(taskQueueId, JSON.stringify(taskData), callback);
};

export { bind, unbind, submit };
