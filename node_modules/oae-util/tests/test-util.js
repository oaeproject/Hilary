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

const assert = require('assert');

const OaeUtil = require('oae-util/lib/util');

describe('OAE Util', () => {
  describe('#getNumberParam', () => {
    it('verify a variety of inputs for getNumberParam', callback => {
      // Verify valid inputs are successful
      assert.strictEqual(OaeUtil.getNumberParam(1), 1);
      assert.strictEqual(OaeUtil.getNumberParam('1'), 1);

      // Verify invalid inputs fall back to undefined when defaultVal is not defined
      assert.strictEqual(OaeUtil.getNumberParam(''), undefined);
      assert.strictEqual(OaeUtil.getNumberParam(' '), undefined);
      assert.strictEqual(OaeUtil.getNumberParam(true), undefined);
      assert.strictEqual(OaeUtil.getNumberParam(false), undefined);
      assert.strictEqual(OaeUtil.getNumberParam({}), undefined);
      assert.strictEqual(OaeUtil.getNumberParam([]), undefined);
      assert.strictEqual(OaeUtil.getNumberParam(null), undefined);
      assert.strictEqual(OaeUtil.getNumberParam(undefined), undefined);
      assert.strictEqual(OaeUtil.getNumberParam(), undefined);

      // Verify valid inputs do not fall back to valid defaultVal
      assert.strictEqual(OaeUtil.getNumberParam(1, 5), 1);
      assert.strictEqual(OaeUtil.getNumberParam('1', 5), 1);

      // Verify invalid inputs fall back to defaultVal when valid
      assert.strictEqual(OaeUtil.getNumberParam('', 5), 5);
      assert.strictEqual(OaeUtil.getNumberParam(' ', 5), 5);
      assert.strictEqual(OaeUtil.getNumberParam(true, 5), 5);
      assert.strictEqual(OaeUtil.getNumberParam(false, 5), 5);
      assert.strictEqual(OaeUtil.getNumberParam({}, 5), 5);
      assert.strictEqual(OaeUtil.getNumberParam([], 5), 5);
      assert.strictEqual(OaeUtil.getNumberParam(null, 5), 5);
      assert.strictEqual(OaeUtil.getNumberParam(undefined, 5), 5);

      // Verify invalid inputs fall back to defaultVal, regardless of its value
      assert.strictEqual(OaeUtil.getNumberParam(null, '1'), '1');
      assert.strictEqual(OaeUtil.getNumberParam(null, ''), '');
      assert.strictEqual(OaeUtil.getNumberParam(null, ' '), ' ');
      assert.strictEqual(OaeUtil.getNumberParam(null, true), true);
      assert.strictEqual(OaeUtil.getNumberParam(null, false), false);
      assert.strictEqual(OaeUtil.getNumberParam(null, { test: 'worked' }).test, 'worked');
      assert.strictEqual(OaeUtil.getNumberParam(null, ['test'])[0], 'test');
      assert.strictEqual(OaeUtil.getNumberParam(null, null), null);
      assert.strictEqual(OaeUtil.getNumberParam(null, undefined), undefined);

      // Verify lower bounding.
      assert.strictEqual(OaeUtil.getNumberParam(-10, 2, 0, 5), 0);
      assert.strictEqual(OaeUtil.getNumberParam('-10', 2, 0, 5), 0);
      assert.strictEqual(OaeUtil.getNumberParam(-10, 2, 1, 5), 1);
      assert.strictEqual(OaeUtil.getNumberParam('-10', 2, 1, 5), 1);

      // Verify upper bounding
      assert.strictEqual(OaeUtil.getNumberParam(10, 2, 0, 5), 5);
      assert.strictEqual(OaeUtil.getNumberParam('10', 2, 0, 5), 5);
      assert.strictEqual(OaeUtil.getNumberParam(10, 2, -100, 0), 0);
      assert.strictEqual(OaeUtil.getNumberParam('10', 2, -100, 0), 0);

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
    const _toInvoke = function(toReturn, callback) {
      return callback(toReturn);
    };

    /**
     * Test that verifies the invokeIfNecessary method does not invoke the given method with a falsey
     * "isNecessary" parameter
     */
    it('verify the method is not invoked with a falsey isNecessary parameter', callback => {
      // Ensure _toInvoke is not called with `false`
      OaeUtil.invokeIfNecessary(false, _toInvoke, 'invoked', toReturn => {
        assert.ok(!toReturn);

        // Ensure _toInvoke is not called with `null`
        OaeUtil.invokeIfNecessary(null, _toInvoke, 'invoked', toReturn => {
          assert.ok(!toReturn);

          // Ensure _toInvoke is not called with `undefined`
          OaeUtil.invokeIfNecessary(undefined, _toInvoke, 'invoked', toReturn => {
            assert.ok(!toReturn);

            // Ensure _toInvoke is not called with the empty string
            OaeUtil.invokeIfNecessary('', _toInvoke, 'invoked', toReturn => {
              assert.ok(!toReturn);

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
      OaeUtil.invokeIfNecessary(true, _toInvoke, 'invoked', toReturn => {
        assert.strictEqual(toReturn, 'invoked');

        // Ensure _toInvoke is called with a non-empty string
        OaeUtil.invokeIfNecessary('should invoke', _toInvoke, 'invoked', toReturn => {
          assert.strictEqual(toReturn, 'invoked');

          // Ensure _toInvoke is called with 1
          OaeUtil.invokeIfNecessary(1, _toInvoke, 'invoked', toReturn => {
            assert.strictEqual(toReturn, 'invoked');

            // Ensure _toInvoke is called with an empty object
            OaeUtil.invokeIfNecessary({}, _toInvoke, 'invoked', toReturn => {
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
      assert.ok(Array.isArray(OaeUtil.toArray(testObj)));
      assert.ok(Array.isArray(OaeUtil.toArray(null)));
      assert.ok(Array.isArray(OaeUtil.toArray([])));
      assert.ok(Array.isArray(OaeUtil.toArray('')));
      assert.ok(Array.isArray(OaeUtil.toArray()));

      // Verify that empty values return empty Arrays
      assert.strictEqual(OaeUtil.toArray(null).length, 0);
      assert.strictEqual(OaeUtil.toArray([]).length, 0);
      assert.strictEqual(OaeUtil.toArray('').length, 0);
      assert.strictEqual(OaeUtil.toArray().length, 0);

      // Verify that the Object is correctly transformed to an Array
      assert.strictEqual(OaeUtil.toArray(testObj)[0], 'value1');
      assert.strictEqual(OaeUtil.toArray(testObj)[1], 'value2');

      return callback();
    });
  });
});
