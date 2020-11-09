/*
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the 'License'); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an 'AS IS'
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import { assert } from 'chai';

import { toArray, invokeIfNecessary, getNumberParam } from 'oae-util/lib/util';

describe('OAE Util', () => {
  describe('#getNumberParam', () => {
    it('verify a variety of inputs for getNumberParam', callback => {
      // Verify valid inputs are successful
      assert.strictEqual(getNumberParam(1), 1);
      assert.strictEqual(getNumberParam('1'), 1);

      // Verify invalid inputs fall back to undefined when defaultVal is not defined
      assert.strictEqual(getNumberParam(''), undefined);
      assert.strictEqual(getNumberParam(' '), undefined);
      assert.strictEqual(getNumberParam(true), undefined);
      assert.strictEqual(getNumberParam(false), undefined);
      assert.strictEqual(getNumberParam({}), undefined);
      assert.strictEqual(getNumberParam([]), undefined);
      assert.strictEqual(getNumberParam(null), undefined);
      assert.strictEqual(getNumberParam(undefined), undefined);
      assert.strictEqual(getNumberParam(), undefined);

      // Verify valid inputs do not fall back to valid defaultVal
      assert.strictEqual(getNumberParam(1, 5), 1);
      assert.strictEqual(getNumberParam('1', 5), 1);

      // Verify invalid inputs fall back to defaultVal when valid
      assert.strictEqual(getNumberParam('', 5), 5);
      assert.strictEqual(getNumberParam(' ', 5), 5);
      assert.strictEqual(getNumberParam(true, 5), 5);
      assert.strictEqual(getNumberParam(false, 5), 5);
      assert.strictEqual(getNumberParam({}, 5), 5);
      assert.strictEqual(getNumberParam([], 5), 5);
      assert.strictEqual(getNumberParam(null, 5), 5);
      assert.strictEqual(getNumberParam(undefined, 5), 5);

      // Verify invalid inputs fall back to defaultVal, regardless of its value
      assert.strictEqual(getNumberParam(null, '1'), '1');
      assert.strictEqual(getNumberParam(null, ''), '');
      assert.strictEqual(getNumberParam(null, ' '), ' ');
      assert.strictEqual(getNumberParam(null, true), true);
      assert.strictEqual(getNumberParam(null, false), false);
      assert.strictEqual(getNumberParam(null, { test: 'worked' }).test, 'worked');
      assert.strictEqual(getNumberParam(null, ['test'])[0], 'test');
      assert.strictEqual(getNumberParam(null, null), null);
      assert.strictEqual(getNumberParam(null, undefined), undefined);

      // Verify lower bounding.
      assert.strictEqual(getNumberParam(-10, 2, 0, 5), 0);
      assert.strictEqual(getNumberParam('-10', 2, 0, 5), 0);
      assert.strictEqual(getNumberParam(-10, 2, 1, 5), 1);
      assert.strictEqual(getNumberParam('-10', 2, 1, 5), 1);

      // Verify upper bounding
      assert.strictEqual(getNumberParam(10, 2, 0, 5), 5);
      assert.strictEqual(getNumberParam('10', 2, 0, 5), 5);
      assert.strictEqual(getNumberParam(10, 2, -100, 0), 0);
      assert.strictEqual(getNumberParam('10', 2, -100, 0), 0);

      return callback();
    });
  });

  describe('#invokeIfNecessary', () => {
    /*!
     * The function to use as the invokeIfNecessary method so we can determine whether
     * or not it was invoked
     *
     * @param  {Object}     toReturn    The value to return in the callback
     * @param  {Function}   callback    Standard callback function
     */
    const _toInvoke = (toReturn, callback) => callback(toReturn);

    /**
     * Test that verifies the invokeIfNecessary method does not invoke the given method with a falsey
     * "isNecessary" parameter
     */
    it('verify the method is not invoked with a falsy isNecessary parameter', callback => {
      // Ensure _toInvoke is not called with `false`
      invokeIfNecessary(false, _toInvoke, 'invoked', toReturn => {
        assert.notExists(toReturn);

        // Ensure _toInvoke is not called with `null`
        invokeIfNecessary(null, _toInvoke, 'invoked', toReturn => {
          assert.notExists(toReturn);

          // Ensure _toInvoke is not called with `undefined`
          invokeIfNecessary(undefined, _toInvoke, 'invoked', toReturn => {
            assert.notExists(toReturn);

            // Ensure _toInvoke is not called with the empty string
            invokeIfNecessary('', _toInvoke, 'invoked', toReturn => {
              assert.notExists(toReturn);

              return callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies the invokeIfNecessary method invokes the given method with a truthy
     * "isNecessary" parameter
     */
    it('verify the method is invoked with a truthy isNecessary parameter', callback => {
      // Ensure _toInvoke is called with `true`
      invokeIfNecessary(true, _toInvoke, 'invoked', toReturn => {
        assert.strictEqual(toReturn, 'invoked');

        // Ensure _toInvoke is called with a non-empty string
        invokeIfNecessary('should invoke', _toInvoke, 'invoked', toReturn => {
          assert.strictEqual(toReturn, 'invoked');

          // Ensure _toInvoke is called with 1
          invokeIfNecessary(1, _toInvoke, 'invoked', toReturn => {
            assert.strictEqual(toReturn, 'invoked');

            // Ensure _toInvoke is called with an empty object
            invokeIfNecessary({}, _toInvoke, 'invoked', toReturn => {
              assert.strictEqual(toReturn, 'invoked');

              return callback();
            });
          });
        });
      });
    });
  });

  describe('#toArray', () => {
    /**
     * Test that verifies that toArray validates incoming values properly and returns an Array
     */
    it('verify the method validates incoming values properly and returns an Array', callback => {
      const testObj = {
        key1: 'value1',
        key2: 'value2'
      };

      // Verify that an Array is returned
      assert.isArray(toArray(testObj));
      assert.isArray(toArray(null));
      assert.isArray(toArray([]));
      assert.isArray(toArray(''));
      assert.isArray(toArray());

      // Verify that empty values return empty Arrays
      assert.lengthOf(toArray(null), 0);
      assert.lengthOf(toArray([]), 0);
      assert.lengthOf(toArray(''), 0);
      assert.lengthOf(toArray(), 0);

      // Verify that the Object is correctly transformed to an Array
      assert.strictEqual(toArray(testObj)[0], 'value1');
      assert.strictEqual(toArray(testObj)[1], 'value2');

      return callback();
    });
  });
});
