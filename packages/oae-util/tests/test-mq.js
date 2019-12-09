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

import assert from 'assert';
import util from 'util';
import _ from 'underscore';
import ShortId from 'shortid';

import * as MQ from 'oae-util/lib/mq';
import { whenTasksEmpty as waitUntilProcessed, getQueueLength } from 'oae-util/lib/test/mq-util';
import { config } from '../../../config';

describe('MQ', () => {
  /**
   * Verify that re-initializing the MQ doesn't invoke an error
   */
  it('verify re-initialization is safe', callback => {
    // Ensure processing continues, and that MQ is still stable with the tests that follow
    MQ.init(config.mq, err => {
      assert.ok(!err);
      return callback();
    });
  });

  /**
   * We disconnect all clients, make sure they no longer work
   * then we connect again and proceed with the tests
   */
  it('verify quitting all clients works', callback => {
    const connectionNames = [
      MQ.staticConnections.THE_PURGER,
      MQ.staticConnections.THE_CHECKER,
      MQ.staticConnections.THE_PUBLISHER
    ];
    const connectionsToCheck = _.filter(MQ.getAllConnectedClients(), eachClient => {
      return connectionNames.includes(eachClient.queueName);
    });

    assertAllClientsAreDisconnected(connectionsToCheck, () => {
      MQ.init(config.mq, err => {
        assert.ok(!err);
        assertAllClientsAreReady(connectionsToCheck);
        return callback();
      });
    });
  });

  describe('#purge()', () => {
    /**
     * Test that verifies the parameters
     */
    it('verify parameter validation', callback => {
      MQ.purgeQueue('', err => {
        assert.strictEqual(err.code, 400);
        return callback();
      });
    });

    /**
     * Verify that a queue can be purged of its tasks.
     */
    it('verify a queue can be purged', callback => {
      const testQueue = 'testQueue-' + new Date().getTime();

      let counter = 0;
      const increment = (message, done) => {
        counter++;
        return done(new Error(`I want these tasks to be redelivered!`));
      };

      // we need subscribe even though we don't use it,
      // otherwise it won't submit to a queue that hasn't been subscribed
      MQ.subscribe(testQueue, increment, err => {
        assert(!err);
        const allTasks = new Array(10).fill({ foo: 'bar' });
        submitTasksToQueue(testQueue, allTasks, err => {
          assert(!err);

          getQueueLength(`${testQueue}-redelivery`, (err, count) => {
            assert.ok(!err);
            // the redelivery mechanism is asynchronous, so counters must be close to 10
            assert(counter >= 1, 'The number of tasks handled should be at least 1');
            assert(counter <= 10, 'The number of tasks handled should be close to 10');
            assert(count >= 1, 'The number of tasks on redelivery should be at least 1');
            assert(count <= 10, 'The number of tasks on redelivery should be close to 10');

            MQ.purgeQueue(testQueue, err => {
              assert(!err);

              getQueueLength(testQueue, (err, count) => {
                assert.ok(!err);
                assert(count === 0, 'Purged queue should have zero length');
                callback();
              });
            });
          });
        });
      });
    });
  });

  describe('#purgeAll()', () => {
    /**
     * Verify that all known queues can be purged of its tasks.
     */
    it('verify all queues can be purged', callback => {
      const counters = { a: 0, b: 0 };
      const increment = (data, done) => {
        counters[data.queue]++;

        /**
         * By doing this we are making sure the tasks are re-submitted
         * to another queue which is named after the first one: ${queueName}-redelivery
         */
        return done(new Error('I want these tasks to be redelivered!'));
      };

      const testQueueA = 'testQueueA-' + new Date().getTime();
      const testQueueB = 'testQueueB-' + new Date().getTime();
      const allTasksForQueueA = new Array(10).fill({ queue: 'a' });
      const allTasksForQueueB = new Array(10).fill({ queue: 'b' });

      const bothQueues = [`${testQueueA}-redelivery`, `${testQueueB}-redelivery`];

      MQ.subscribe(testQueueA, increment, () => {
        MQ.subscribe(testQueueB, increment, () => {
          submitTasksToQueue(testQueueA, allTasksForQueueA, err => {
            assert(!err);
            waitUntilProcessed(testQueueA, () => {
              assert(counters.a >= 1, 'The number of tasks on redelivery should be at least 1');
              assert(counters.a <= 10, 'The number of tasks on redelivery should be close to 10');
              submitTasksToQueue(testQueueB, allTasksForQueueB, err => {
                assert(!err);
                waitUntilProcessed(testQueueA, () => {
                  assert(counters.b >= 1, 'The number of tasks on redelivery should be at least 1');
                  assert(counters.b <= 10, 'The number of tasks on redelivery should be close to 10');

                  MQ.purgeQueues(bothQueues, err => {
                    assert(!err);
                    getQueueLength(bothQueues[0], (err, count) => {
                      assert.ok(!err);
                      assert(count === 0, 'Purged queues should be zero length');
                      getQueueLength(bothQueues[1], (err, count) => {
                        assert.ok(!err);
                        assert(count === 0, 'Purged queues should be zero length');

                        callback();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  describe('#submit()', () => {
    /**
     * Verify the parameters
     */
    it('verify parameter validation', callback => {
      const data = { text: 'The truth is out there' };
      const queueName = util.format('testQueue-%s', ShortId.generate());

      // A queueName must be provided
      MQ.submit(null, data, err => {
        assert.strictEqual(err.code, 400);

        // A message must be provided
        MQ.submit(queueName, null, err => {
          assert.strictEqual(err.code, 400);

          // Sanity check
          MQ.submit(queueName, data, err => {
            assert.ok(!err);
            return callback();
          });
        });
      });
    });

    /**
     * Verify that submitting a task/message won't even touch redis
     * unless that queue has been bound (subscribed to) before
     */
    it('verify submit doesnt work before subscription', callback => {
      const queueName = util.format('testQueue-%s', ShortId.generate());
      const data = { msg: 'Practice makes perfect' };

      let counter = 0;
      const taskHandler = (message, done) => {
        counter++;

        // make sure there is one task in the queue
        getQueueLength(`${queueName}-processing`, (err, count) => {
          assert.ok(!err);
          assert.strictEqual(count, 1, 'There should be one task on the processing queue');
          done();
        });
      };

      MQ.submit(queueName, JSON.stringify(data), err => {
        assert.ok(!err);
        assert.strictEqual(counter, 0, 'It has not been subscribed so submit wont deliver the message');

        MQ.subscribe(queueName, taskHandler, err => {
          assert.ok(!err);

          MQ.submit(queueName, JSON.stringify(data), err => {
            assert.ok(!err);

            waitUntilProcessed(queueName, () => {
              assert.strictEqual(counter, 1, 'Task handler should have been called once so far');

              callback();
            });
          });
        });
      });
    });

    /**
     * Verify that submitting a task/message won't do anything
     * after unsubscribing to the correspondent queue (which will then be unbound)
     */
    it('verify submit doesnt work after unsubscription', callback => {
      const queueName = util.format('testQueue-%s', ShortId.generate());
      const data = { msg: 'Practice makes perfect' };

      let counter = 0;
      const taskHandler = (message, done) => {
        counter++;

        // make sure there is one task in the queue
        getQueueLength(`${queueName}-processing`, (err, count) => {
          assert.ok(!err);
          assert.strictEqual(count, 1, 'There should be one task on the processing queue');
          done();
        });
      };

      MQ.subscribe(queueName, taskHandler, err => {
        assert.ok(!err);

        MQ.submit(queueName, JSON.stringify(data), err => {
          assert.ok(!err);

          waitUntilProcessed(queueName, () => {
            assert.strictEqual(counter, 1, 'Task handler should have been called once so far');

            MQ.unsubscribe(queueName, err => {
              assert.ok(!err);
              assert.strictEqual(counter, 1, 'Task handler should have been called once so far');

              MQ.submit(queueName, JSON.stringify(data), err => {
                assert.ok(!err);

                waitUntilProcessed(queueName, () => {
                  assert.strictEqual(counter, 1, 'Task handler should have been called once so far');

                  callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Verify that submitting a message or task works, meaning that the listener
     * that is bound to the queue after subscribe is executed
     */
    it('verify submitting a message just works', callback => {
      const queueName = util.format('testQueue-%s', ShortId.generate());
      const data = { msg: 'Practice makes perfect' };

      let counter = 0;
      const taskHandler = (message, done) => {
        counter++;

        assert.strictEqual(message.msg, data.msg, 'Received message should match the one sent');

        // make sure there is one task in the queue
        getQueueLength(`${queueName}-processing`, (err, count) => {
          assert.ok(!err);
          assert.strictEqual(count, 1, 'There should be one task on the processing queue');
          done();
        });
      };

      MQ.subscribe(queueName, taskHandler, err => {
        assert.ok(!err);

        MQ.submit(queueName, JSON.stringify(data), err => {
          assert.ok(!err);

          waitUntilProcessed(queueName, () => {
            assert.strictEqual(counter, 1, 'Task handler should have been called once so far');

            // make sure the queue is Empty, as well the processing and redelivery correspondents
            getQueueLength(queueName, (err, count) => {
              assert.ok(!err);
              assert.strictEqual(count, 0, 'The queue should be empty');
              getQueueLength(`${queueName}-processing`, (err, count) => {
                assert.ok(!err);
                assert.strictEqual(count, 0, 'The queue should be empty');
                getQueueLength(`${queueName}-redelivery`, (err, count) => {
                  assert.ok(!err);
                  assert.strictEqual(count, 0, 'The queue should be empty');

                  callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Verify that submitting many messages will result in all of them
     * being processed aka their listener is executed
     */
    it('verify submitting many messages works', callback => {
      const NUMBER_OF_TASKS = 10;
      let counter = 0;
      const queueName = util.format('testQueue-%s', ShortId.generate());

      const allTasks = new Array(NUMBER_OF_TASKS).fill(null).map(() => {
        return { msg: `Practice ${counter++} times makes perfect` };
      });
      // we'll soon shift/pop the array, so let's keep a clone for later
      const allMessages = allTasks.slice(0);

      counter = 0;
      const taskHandler = (message, done) => {
        assert.strictEqual(
          message.msg,
          allMessages[counter++].msg,
          'It should handle tasks in the same order as submitted'
        );
        return done();
      };

      MQ.subscribe(queueName, taskHandler, err => {
        assert.ok(!err);

        submitTasksToQueue(queueName, allTasks, err => {
          assert.ok(!err);

          waitUntilProcessed(queueName, () => {
            assert.strictEqual(
              counter,
              NUMBER_OF_TASKS,
              'Task handler should have been called once for each message sent'
            );

            // make sure the queue is Empty, as well the processing and redelivery correspondents
            getQueueLength(queueName, (err, count) => {
              assert.ok(!err);
              assert.strictEqual(count, 0, 'The queue should be empty');
              getQueueLength(`${queueName}-processing`, (err, count) => {
                assert.ok(!err);
                assert.strictEqual(count, 0, 'The queue should be empty');
                getQueueLength(`${queueName}-redelivery`, (err, count) => {
                  assert.ok(!err);
                  assert.strictEqual(count, 0, 'The queue should be empty');

                  callback();
                });
              });
            });
          });
        });
      });
    });

    it('verify that a error handler will cause the message to be redelivered', done => {
      const queueName = util.format('testQueue-%s', ShortId.generate());
      const data = { msg: 'You know nothing Jon Snow' };
      let counter = 0;

      const taskHandler = (message, done) => {
        counter++;

        // by returning an error, we are causing the redelivery
        done(new Error('Goodness gracious me!!!'));
      };

      MQ.subscribe(queueName, taskHandler, err => {
        assert.ok(!err);
        MQ.submit(queueName, JSON.stringify(data), err => {
          assert.ok(!err);
          waitUntilProcessed(queueName, () => {
            assert.strictEqual(counter, 1, 'There should be one processed task so far');
            getQueueLength(queueName, (err, count) => {
              assert.ok(!err);
              assert.strictEqual(count, 0, 'The queue should be empty');
              getQueueLength(`${queueName}-processing`, (err, count) => {
                assert.ok(!err);
                assert.strictEqual(count, 0, 'The queue should be empty');
                getQueueLength(`${queueName}-redelivery`, (err, count) => {
                  assert.ok(!err);
                  assert.strictEqual(count, 1, 'There should be one task redelivered for later processing');
                  done();
                });
              });
            });
          });
        });
      });
    });
  });
});

// Recursive submission of an array of tasks to a specific queue
const submitTasksToQueue = (queueName, tasks, done) => {
  if (tasks.length === 0) return done();

  const poppedTask = tasks.shift();
  MQ.submit(queueName, JSON.stringify(poppedTask), () => {
    return submitTasksToQueue(queueName, tasks, done);
  });
};

/**
 * Utility function to make sure each and every client is properly connected
 */
const assertAllClientsAreReady = connectionsToCheck => {
  _.each(connectionsToCheck, eachClient => {
    assert.ok(eachClient.status === 'ready');
  });
};

/**
 * Utility function to make sure each and every client is disconnected
 */
const assertAllClientsAreDisconnected = (clients, done) => {
  if (clients.length === 0) {
    return done();
  }

  const nextClient = clients.shift();
  nextClient.disconnect();
  nextClient.llen('someList', err => {
    assert.ok(err, 'Connection is closed, so no command can be issued');
    assertAllClientsAreDisconnected(clients, done);
  });
};
