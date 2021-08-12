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

import * as MQ from 'oae-util/lib/mq.js';

/**
 * Fetches the length of a queue (which is a redis list)
 *
 * @function getQueueLength
 * @param  {String}   queueName The queue we want to know the length of
 * @param  {Function} callback  Standard callback function
 */
const getQueueLength = (queueName, callback) => {
  MQ.staticConnections.THE_CHECKER.llen(queueName, (err, count) => {
    if (err) return callback(err);

    return callback(null, count);
  });
};

/**
 * Invoke the given handler only if the local counter of tasks of the given name indicates that the task queue is completely
 * empty. If it is not empty now, then the handler will be invoked when it becomes empty.
 *
 * This is ONLY useful in a local development environment where one application node is firing and handling all tasks.
 *
 * @param  {String}     queueName   The name of the task to listen for empty events
 * @param  {Function}   handler     The handler to invoke when the task queue is empty
 * @returns {Function}              Returns the execution of the handler function when counter equals zero
 */
const whenTasksEmpty = function (queueName, done) {
  isQueueEmpty(queueName, (err, isEmpty) => {
    if (err) return done(err);
    if (isEmpty) return done();

    setTimeout(whenTasksEmpty, 100, queueName, done);
  });
};

/**
 * Makes sure it waits until both the `queueName` and the `queueName-processing` queues are empty
 *
 * This is ONLY useful in a local development environment where one application node is firing and handling all tasks.
 *
 * @function whenBothTasksEmpty
 * @param  {String}     queueName   The name of the task to listen for empty events
 * @param  {Function}   handler     The handler to invoke when the task queue is empty
 */
const whenBothTasksEmpty = (queueName, done) => {
  whenTasksEmpty(queueName, () => {
    whenTasksEmpty(MQ.getProcessingQueueFor(queueName), done);
  });
};

/**
 * @function isQueueEmpty
 * @param  {String} queueName  The queue name we're checking the size of (which is a redis List)
 * @param  {Object} someRedisConnection A redis client which is used solely for subscribing to this queue
 * @param  {Function} done     Standar callback function
 */
const isQueueEmpty = (queueName, done) => {
  MQ.staticConnections.THE_CHECKER.llen(queueName, (err, stillQueued) => {
    if (err) done(err);
    return done(null, stillQueued === 0);
  });
};

export { getQueueLength, whenTasksEmpty, whenBothTasksEmpty };
