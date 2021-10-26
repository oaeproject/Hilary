/*!
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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

import process from 'node:process';
import { assert } from 'chai';
import _ from 'underscore';
import * as EmitterAPI from 'oae-emitter';

import { union } from 'ramda';

const { EventEmitter } = EmitterAPI;

describe('EventEmitter', () => {
  describe('#on', () => {
    /**
     * Test that verifies that all `on` handlers are invoked just like a regular EventEmitter
     */
    it('verify all "on" handlers are invoked with specified arguments', (callback) => {
      const emitter = new EventEmitter();

      let results = [];

      emitter.on('a', (...args) => {
        results = union(results, args);
      });

      emitter.on('b', (...args) => {
        results = union(results, args);
      });

      emitter.emit('a', 1, 2, 3);
      emitter.emit('b', 2, 3, 4);
      emitter.emit('a', 3, 4, 5);
      emitter.emit('c', 4, 5, 6);

      assert.deepStrictEqual(results.sort(), [1, 2, 3, 4, 5]);

      return callback();
    });
  });

  describe('#when', () => {
    /**
     * Test that verifies that both `on` and `when` handlers are invoked with the supplied
     * arguments
     */
    it('verify all "on" and "when" handlers are invoked with specified arguments', (callback) => {
      const emitter = new EventEmitter();

      let results = [];

      emitter.on('a', (arg) => {
        results.push('a1' + arg);
      });

      emitter.when('a', (arg, done) => {
        results.push('a2' + arg);
        return done();
      });

      emitter.when('a', (arg, done) => {
        process.nextTick(() => {
          results.push('a3' + arg);

          return done();
        });
      });

      emitter.on('b', (arg) => {
        results.push('b1' + arg);
      });

      emitter.when('b', (arg, done) => {
        process.nextTick(() => {
          results.push('b2' + arg);

          return done();
        });
      });

      emitter.emit('a', 1, () => {
        emitter.emit('a', 2, () => {
          emitter.emit('b', 3, () => {
            emitter.emit('a', 5, () => {
              results = _.uniq(results).sort();
              assert.deepStrictEqual(results, [
                'a11',
                'a12',
                'a15',
                'a21',
                'a22',
                'a25',
                'a31',
                'a32',
                'a35',
                'b13',
                'b23'
              ]);
              return callback();
            });
          });
        });
      });
    });
  });

  describe('#emit', () => {
    /**
     * Test that verifies that the handler callback gets invoked, even if there are no handlers
     */
    it('verify callback is invoked with no listeners', (callback) => {
      new EventEmitter().emit('a', 'blah', 'blah', () => {
        new EventEmitter().emit('a', 5, () => {
          new EventEmitter().emit(
            'a',
            {},
            [],
            () => {},
            () => new EventEmitter().emit('a', callback)
          );
        });
      });
    });

    /**
     * Test that verifies that the handler callback gets invoked when there are only `on`
     * listeners bound to the emitter
     */
    it('verify callback is invoked with only "on" listeners', (callback) => {
      const emitter = new EventEmitter();

      emitter.on('a', () => {});
      emitter.on('b', () => {});

      new EventEmitter().emit('a', 'blah', 'blah', () => {
        new EventEmitter().emit('a', 5, () => {
          new EventEmitter().emit(
            'a',
            {},
            [],
            () => {},
            () => new EventEmitter().emit('a', callback)
          );
        });
      });
    });

    /**
     * Test that verifies that the handler callback gets invoked when there are only `when`
     * handlers bound to the emitter
     */
    it('verify callback is invoked with only "when" handlers', (callback) => {
      const emitter = new EventEmitter();

      emitter.when('a', (arg0, arg1, arg2, done) => done());

      emitter.when('b', (arg0, arg1, arg2, done) => done());

      new EventEmitter().emit('a', 'blah', 'blah', 'blah', () => {
        new EventEmitter().emit('a', 5, 4, 3, () => {
          new EventEmitter().emit(
            'a',
            {},
            [],
            () => {},
            () => new EventEmitter().emit('a', null, undefined, false, callback)
          );
        });
      });
    });

    /**
     * Test that verifies that the handler callback gets invoked only after all `when` handlers
     * have finished processing and invoked their callbacks
     */
    it('verify callback is invoked with both "on" and "when" handlers', (callback) => {
      const emitter = new EventEmitter();

      let successfulACounter = 0;

      emitter.on('a', (/* arg0, arg1, arg2, done */) => {});
      emitter.when('a', (arg0, arg1, arg2, done) => {
        process.nextTick(() => {
          successfulACounter++;

          return done();
        });
      });

      emitter.emit('a', 'blah', 'blah', 'blah', (errs) => {
        assert.notExists(errs);
        assert.strictEqual(successfulACounter, 1);
        emitter.emit('a', 5, 4, 3, (errs) => {
          assert.notExists(errs);
          assert.strictEqual(successfulACounter, 2);
          emitter.emit(
            'a',
            {},
            [],
            () => {},
            (errs) => {
              assert.notExists(errs);
              assert.strictEqual(successfulACounter, 3);

              emitter.emit('a', null, undefined, false, (errs) => {
                assert.notExists(errs);
                assert.strictEqual(successfulACounter, 4);

                return callback();
              });
            }
          );
        });
      });
    });

    /**
     * Test that verifies that handler errors will be aggregated and supplied to the emit
     * callback
     */
    it('verify errors from "when" handlers are aggregated', (callback) => {
      const emitter = new EventEmitter();

      let successfulACounter = 0;

      emitter.when('a', (done) => {
        process.nextTick(() => {
          successfulACounter++;
          return done();
        });
      });

      emitter.when('a', (done) => {
        process.nextTick(() => done('a1'));
      });

      emitter.when('a', (done) => {
        process.nextTick(() => {
          successfulACounter++;
          return done();
        });
      });

      emitter.when('a', (done) => {
        process.nextTick(() => done('a2'));
      });

      emitter.when('a', (done) => {
        process.nextTick(() => {
          successfulACounter++;
          return done();
        });
      });

      emitter.emit('a', (errs) => {
        assert.isArray(errs);
        assert.deepStrictEqual(errs.sort(), ['a1', 'a2']);
        assert.strictEqual(successfulACounter, 3);

        return callback();
      });
    });
  });
});
