/*
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

import { assert } from 'chai';

import * as Pubsub from 'oae-util/lib/pubsub.js';

describe('Pubsub', () => {
  describe('#publish()', () => {
    it('verify missing channel parameter', (callback) => {
      Pubsub.publish(undefined, 'some message', (error) => {
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify missing message parameter', (callback) => {
      Pubsub.publish('oae-tests', undefined, (error) => {
        assert.strictEqual(error.code, 400);
        callback();
      });
    });

    it('verify publication', (callback) => {
      const channel = 'oae-tests';
      const message = 'This message will go to all the nodes in the cluster.';
      Pubsub.emitter.on(channel, (receivedMessage) => {
        assert.strictEqual(receivedMessage, message);
        callback();
      });
      Pubsub.publish(channel, message, (error) => {
        assert.notExists(error);
      });
    });
  });
});
