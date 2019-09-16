/*
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

import assert from 'assert';

import * as MQ from 'oae-util/lib/mq';

describe.skip('TaskQueue', () => {
  describe('#bind()', () => {
    /**
     * Verify that a bound worker starts receiving tasks.
     */
    it('verify a bound worker can receive a task', callback => {
      const testQueue = 'testQueue-' + new Date().getTime();
      MQ.subscribe(
        testQueue,
        (data, taskCallback) => {
          assert.ok(data);
          assert.strictEqual(data.activity, 'you stink!');
          taskCallback();
          callback();
        },
        () => {
          MQ.submitJSON(testQueue, { activity: 'you stink!' });
        }
      );
    });

    /**
     * Verify that binding a worker when there is already one doesn't invoke an error
     */
    it("verify binding an existing queue doesn't invoke an error", callback => {
      const testQueue = 'testQueue-' + new Date().getTime();
      MQ.subscribe(testQueue, () => {}, () => {
        // Simply make sure the callback gets executed and we can carry on
        MQ.subscribe(testQueue, () => {}, callback);
      });
    });

    /**
     * Verify that processing continues safely when an exception is thrown from within a worker.
     */
    it('verify an exception is caught when thrown from a task handler', callback => {
      const testQueue = 'testQueue-' + new Date().getTime();
      MQ.subscribe(
        testQueue,
        data => {
          throw new Error('Hard-coded exception to verify application remains stable.');
        },
        () => {
          MQ.submitJSON(testQueue, { activity: 'blah' });
          // Simply make sure tests continue normally when the exception is thrown
          callback();
        }
      );
    });
  });

  describe('#unsubscribe()', () => {
    /**
     * Verify that unbinding a non-existing worker does not invoke an error
     */
    it('verify unbind non-existing queue is safe', callback => {
      const testQueue = 'testQueue-' + new Date().getTime();
      // Simply make sure there is no exception
      MQ.unsubscribe(testQueue, callback);
    });

    /**
     * Verify a worker can be bound, then unbound, the rebound and still receive tasks
     */
    it('verify unbinding and then rebinding', callback => {
      const testQueue = 'testQueue-' + new Date().getTime();
      MQ.subscribe(
        testQueue,
        () => {
          // Dead end. if this is the effective method the test will hang and time out
        },
        () => {
          // Now unbind it so we can re-bind with a valid handler
          MQ.unsubscribe(testQueue, () => {
            MQ.subscribe(
              testQueue,
              (data, taskCallback) => {
                assert.ok(data);
                assert.strictEqual(data.activity, 'you stink!');
                taskCallback();
                callback();
              },
              () => {
                MQ.submitJSON(testQueue, { activity: 'you stink!' });
              }
            );
          });
        }
      );
    });
  });
});
