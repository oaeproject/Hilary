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

import util from 'util';
import {
  values,
  isEmpty,
  flatten,
  is,
  ifElse,
  last,
  and,
  lt,
  gt,
  pipe,
  __,
  curry,
  either,
  equals,
  defaultTo,
  isNil
} from 'ramda';

// Auxiliary functions
const isObject = is(Object);
const toInt = curry(parseInt)(__, 10);
const equalsZero = equals(0);
const isDefined = Boolean;

/**
 * GLOBAL UTILS
 */

// Include some global utilities and extensions (e.g., underscore mixins). See the directory
// `oae-util/lib/internal/globals` for all the global definitions
// eslint-disable-next-line import/namespace, no-unused-vars
import * as globals from './internal/globals';

/**
 * OAEUTIL UTILS
 */

/**
 * Checks if the passed in value is a stringified Boolean and returns a Boolean type if there's a match.
 * If the value passed in is not a stringified Boolean the original value is returned.
 *
 * @param  {String}           value   String that will be converted to Boolean if it matches: 'true', 'false', '1' or '0' or returned if there's no match.
 * @return {Boolean|String}           Returns true, false or the original value
 */
const castToBoolean = value => {
  const isFalsy = either(equals('false'), equals('0'))(value);
  const isTruthy = either(equals('true'), equals('1'))(value);

  let result = value;
  if (isFalsy) result = false;
  if (isTruthy) result = true;

  return result;
};

/**
 * Get a numeric parameter as specified by `value`. If `value` is not a valid number (i.e., it cannot be converted to one),
 * then `defaultValue` will be return instead. If a minimum is specified and `value` is smaller than the minimum, the minimum
 * will be returned. If a maximum is specified and `value` is larger than the maximum, the maximum will be returned
 *
 * @param  {String|Number}      value             The value to try and convert to an integer
 * @param  {String|Number}      defaultValue      The value to return if `val` is not a valid integer
 * @param  {Number}             [args.minimum]    A lower bound for `val`. If this is not provided, no bounding will be applied.
 * @param  {Number}             [args.maximum]    An upper bound for `val`. If this is not provided, no bounding will be applied.
 * @return {String|Number}                        `value` converted to an integer, if possible. If not possible `defaultVal` is returned
 */
const getNumberParam = (value, defaultValue, ...args) => {
  const [minimum, maximum] = args;

  const setToDefaultIfUndefined = pipe(toInt, defaultTo(defaultValue));
  value = setToDefaultIfUndefined(value);

  const minLimitIsSet = either(isDefined, equalsZero)(minimum);
  const belowTheLimit = lt(value, minimum);
  if (and(minLimitIsSet, belowTheLimit)) value = minimum;

  const topLimitIsSet = either(isDefined, equalsZero)(maximum);
  const beyondTheLimit = gt(value, maximum);
  if (and(topLimitIsSet, beyondTheLimit)) value = maximum;

  return value;
};

/**
 * Determine if the given parameter is unspecified. This essentially means it is `null` or `undefined`
 *
 * @param  {Anything}   value    The value to check
 * @return {Boolean}            `true` if the value was unspecified, `false` otherwise
 */
const isUnspecified = value => isNil(value);

/**
 * Invoke the given method with the args, only if the first parameter `isNecessary` is a true value. If falsey, the
 * last parameter `callback` will be invoked with no arguments. If not falsey, the provided method will be invoked as-is,
 * including the callback as the final argument. Note that this means that if `isNecessary` is a truish value, this function
 * will not explicitly invoke the final callback parameter, it is up to the provided method to do so.
 *
 * This function is simply a convenience to avoid needing to branch asynchronous calls into if statements. For example, if you
 * want to create/replace a file and write something to it, rather than having to wrestle with something like this:
 *
 *  ```javascript
 *  fs.exists(path, function(err, exists) {
 *      if (exists) {
 *          // First delete the file if it exists so we can start empty
 *          fs.rm(path, function(err) {
 *              fs.write(path, 'mydata', callback);
 *          });
 *      } else {
 *          fs.write(path, 'mydata', callback);
 *      }
 *  });
 *  ```
 *
 * You can instead use this utility function:
 *
 *  ```javascript
 *  fs.exists(path, function(err, exists) {
 *      invokeIfNecessary(exists, fs.rm, path, function(err) {
 *          fs.write(path, 'mydata', callback);
 *      });
 *  });
 *  ```
 *
 * @param  {Boolean}    isNecessary     Whether or not the provided method should be invoked with the given args. If falsey, the method will not be invoked, if not falsey (truesy?) the method will be invoked.
 * @param  {Function}   method          The method to invoke if `isNecessary` is true
 * @param  {...Object}  args            The arguments for the provided method. The final argument should always be the `callback` method that needs to be invoked if `isNecessary` is false. It can be the same callback method invoked if the method is executed.
 */
const invokeIfNecessary = function(isNecessary, whenTrueFn, ...args) {
  const callback = last(args);
  const isItNecessary = () => isNecessary;
  const thenInvokeFn = () => whenTrueFn(...args);
  const otherwiseJustExit = () => callback();

  ifElse(isItNecessary, thenInvokeFn, otherwiseJustExit)();
};

/**
 * Get the path to the node_modules directory
 *
 * @return {String}    The path to the node_modules directory
 */
const getNodeModulesDir = () => util.format('%s/../../../node_modules/', __dirname);

/**
 * Wrap a value in an array. If the value is already an array, no wrapping
 * will take place. If the value is an object, the object's values will be returned
 *
 * @param  {Object}     input     The value to wrap
 * @return {Object[]}             The wrapped value
 * @see http://underscorejs.org/#toArray
 */
const toArray = input => {
  const eitherNilOrEmpty = either(isNil, isEmpty);
  if (eitherNilOrEmpty(input)) input = [];
  if (isObject(input)) input = values(input);

  return flatten([input]);
};

export { castToBoolean, getNumberParam, isUnspecified, invokeIfNecessary, getNodeModulesDir, toArray };
