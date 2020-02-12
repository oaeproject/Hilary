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

import * as tz from 'oae-util/lib/tz';
import {
  defaultTo,
  trim,
  length,
  reduceWhile,
  pipe,
  both,
  either,
  not,
  or,
  type,
  is,
  equals,
  isNil,
  isEmpty
} from 'ramda';

import Validator from 'validator';

const _isString = value => {
  return is(String, value);
};

const _isBoolean = value => {
  return is(Boolean, value);
};

const _isFunction = value => {
  return is(Function, value);
};

const _isArray = value => {
  return is(Array, value);
};

const _isNumber = value => {
  return is(Number, value);
};

const _isEqualsTo = (value1, value2) => {
  return equals(value1, value2);
};

const _isDifferent = (a, b) => {
  return not(_isEqualsTo(a, b));
};

const _isObject = value => {
  return is(Object, value);
};

const _isFalse = value => {
  return value === false;
};

const _isItLengthy = interval => value => Validator.isLength(value, interval);
/*
const _isTrue = value => {
  return value === true;
};

const _isNull = value => {
  return value === null;
};
*/

// TODO
// isNil
// and / or from R
// Exclamation marks!
// say what???? JSON what
// default instead of || ''
// isNull and isNotNull

/**
 * @function isDifferent
 * @param  {String} input       Value being compared, **which will be converted to a String**
 * @param  {String} notEqualsTo Value being compared to
 * @return {Boolean}            Whether `input` is different to `notEqualsTo`
 *
 * Usage:
 * ```
 * isDifferent('abcd', 'abcde'); // true
 * ```
 */
Validator.isDifferent = (a, b) => {
  return _isDifferent(String(a), b);
};

/**
 * @function isNotEmpty
 * @param  {String} input   Value being checked
 * @return {Boolean}        Whether the `input` is an empty string
 *
 * Usage:
 * ```
 * isNotEmpty('abcd'); // true
 * ```
 */
Validator.isNotEmpty = input => {
  const defaultToEmptyString = defaultTo('');
  return pipe(defaultToEmptyString, trim, isEmpty, not)(input);
};

/**
 * @function notContains
 * @param  {String} string  Value being checked if contains a string `seed`
 * @param  {String} seed    Value being checked if is contained by `string`
 * @return {Boolean}        Whether `string` contains `seed`
 *
 * Usage:
 * ```
 * notContains('abcde', 'org'); // true
 * ```
 */
Validator.notContains = (string, seed) => {
  return not(Validator.contains(string, seed));
};

/**
 * @function isNull
 * @param  {Object} value   Value being compared to null
 * @return {Boolean}        Whether `input` is null or not
 *
 * Usage:
 * ```
 * isNull(true); // false
 * ```
 */
Validator.isNull = value => {
  return !value;
};

/**
 * @function isNotNull
 * @param  {Object} input   Value being compared to null
 * @return {Boolean}        Whether `input` is null or not
 *
 * Usage:
 * ```
 * isNotNull(null); // false
 * ```
 */
Validator.isNotNull = value => {
  return not(Validator.isNull(value));
};

/**
 * @function otherwise
 * @param  {Error} error  Error to be thrown in case the validation does not pass
 * @return {Function}     A function to be chained in validation steps
 *
 * Usage:
 * ```
 * let func = otherwise(new Error());
 * func(false); // throws an error
 * ```
 */
Validator.otherwise = error => {
  return function(validationPassed) {
    if (not(validationPassed)) throw error;
  };
};

/**
 * @function checkIfExists
 * @param  {Function} validation Function used to validate if Boolean(value) is true
 * @return {Boolean} Whether the validation passes or not, in case value exists
 *
 * Usage:
 * ```
 * let func = checkIfExists(isNull);
 * func('someId'); // false, because 'someId' is not null
 * ```
 */
Validator.checkIfExists = validation => {
  return function(value) {
    return value ? validation(value) : true;
  };
};

/**
 * @function makeSureThat
 * @param  {Boolean} condition    Whether we should validate or not
 * @param  {Object}  value        Value to be validated
 * @param  {Function} validation  Function used to validate value if condition is true
 * @return {Function}             A function to be chained in validation steps
 *
 * Usage:
 * ```
 * let func = makeSureThat(true, 'popo', isEmpty);
 * func(); // returns false
 * ```
 */
Validator.makeSureThat = (condition, value, validation) => {
  return function() {
    return condition ? validation(value) : true;
  };
};

/**
 * @function getNestedObject
 * @param  {Object} nestedObj Object being reduced in order to fetch an attribute
 * @return {Function}         A function that gets an attribute from the `nestedObj` if it exists
 *
 * Usage:
 * ```
 * let obj = { something: 'true' }
 * let func = getNestedObject(obj);
 * func(['something']); // returns 'true'
 * ```
 */
Validator.getNestedObject = nestedObj => {
  return attrPath => {
    return attrPath.reduce((obj, key) => (obj && obj[key] !== 'undefined' ? obj[key] : undefined), nestedObj);
  };
};

/// ////////////////////
// Custom validators //
/// ////////////////////

/**
 * Check whether or not a context represents a logged in user
 *
 * @function isLoggedInUser
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     [tenantAlias]   The alias of the tenant to verify the context is authenticated to. If unspecified, the check will validate that the context is simply authenticated anywhere
 *
 * Usage:
 * ```
 * isLoggedInUser(ctx);
 * ```
 */
Validator.isLoggedInUser = function(ctx, tenantAlias) {
  const checkCondition1 = () => {
    return not(_isObject(ctx));
  };

  const checkCondition2 = () => {
    const isTenantNotValid = () => not(_isObject(ctx.tenant()));
    const isAliasNotValid = () => not(ctx.tenant().alias);
    return either(isTenantNotValid, isAliasNotValid)();
  };

  const checkCondition3 = () => {
    const isContextNotValid = () => not(_isObject(ctx.user()));
    const isUserIdNotValid = () => not(ctx.user().id);
    return either(isContextNotValid, isUserIdNotValid)();
  };

  const checkCondition4 = () => {
    const isTenantAliasValid = () => not(isNil(tenantAlias));
    const aliasesAreDifferent = () => _isDifferent(ctx.tenant().alias, tenantAlias);
    return both(isTenantAliasValid, aliasesAreDifferent)();
  };

  const allConditions = [checkCondition1, checkCondition2, checkCondition3, checkCondition4];
  const _mustBeFalse = (acc, currentFn) => _isFalse(currentFn());
  const conditionsPassed = reduceWhile(_mustBeFalse, (acc /* , currentFn */) => acc + 1, 0, allConditions);

  return _isEqualsTo(conditionsPassed, length(allConditions));
};

/**
 * Check whether or not a context represents a global administrator
 *
 * @function isGlobalAdministratorUser
 * @param  {Context}    ctx     Standard context object containing the current user and the current tenant
 *
 * Usage:
 * ```
 * isGlobalAdministratorUser(ctx);
 * ```
 */
Validator.isGlobalAdministratorUser = ctx => {
  const checkCondition1 = () => {
    return not(_isObject(ctx));
  };

  const checkCondition2 = () => {
    const isTenantNotAFunction = () => not(_isFunction(ctx.tenant));
    const isTenantNotAnObject = () => not(_isObject(ctx.tenant()));
    const isTenantNotValid = () => either(isTenantNotAFunction, isTenantNotAnObject)();
    const isAliasNotValid = () => not(ctx.tenant().alias);
    return either(isTenantNotValid, isAliasNotValid)();
  };

  const checkCondition3 = () => {
    const isUserNotAFunction = () => not(_isFunction(ctx.user));
    const isUserNotAnObject = () => not(_isObject(ctx.user()));
    const isUserNotValid = () => either(isUserNotAFunction, isUserNotAnObject)();
    const doesUserNotExist = () => not(ctx.user().id);
    return either(isUserNotValid, doesUserNotExist)();
  };

  const checkCondition4 = () => {
    return not(_isFunction(ctx.user().isGlobalAdmin));
  };

  const checkCondition5 = () => {
    return _isDifferent(ctx.user().isGlobalAdmin(), true);
  };

  const allConditions = [checkCondition1, checkCondition2, checkCondition3, checkCondition4, checkCondition5];
  const _mustBeFalse = (acc, currentFn) => _isFalse(currentFn());
  const conditionsPassed = reduceWhile(_mustBeFalse, (acc /* , currentFn */) => acc + 1, 0, allConditions);

  return _isEqualsTo(conditionsPassed, length(allConditions));
};

/**
 * Check whether or not the passed in object is an actual JSON object
 *
 * @function isObject
 * @param  {Object}     obj   Object that needs to be checked for validity
 *
 * Usage:
 * ```
 * let obj = { foo: 'bar' };
 * isObject(obj); // true
 * ```
 */
Validator.isObject = function(obj) {
  return _isObject(obj);
};

/**
 * Check whether or not the passed value is a Module OR an Object (dont ask)
 *
 * @function isModule
 * @param  {Module}     value   Value that needs to be checked for validity
 *
 * Usage:
 * ```
 * let obj = { foo: 'bar' };
 * isModule(obj); // true
 * ```
 */
Validator.isModule = value => {
  return or(type(value) === 'Module', _isObject(value));
};

/**
 * @function isANumber
 * @param  {Integer} input Value being checked
 * @return {Boolean} Whether `input` is a number or not
 *
 * Usage:
 * ```
 * isANumber('popo'); // false
 * ```
 */
Validator.isANumber = value => {
  return _isNumber(value);
};

/**
 * Check whether or not the passed in object is an actual array
 *
 * @function isArray
 * @param  {Object[]}     arr   Object that needs to be checked for validity
 *
 * Usage:
 * ```
 * let arr = [];
 * isArray(arr); // true
 * ```
 */
Validator.isArray = arr => {
  return _isArray(arr);
};

/**
 * @function isArrayNotEmpty
 * @param  {Array} arr    Array being checked for emptiness
 * @return {Boolean}      Whether the `arr` is an empty array
 *
 * Usage:
 * ```
 * isArrayNotEmpty(new Array()); // false
 * ```
 */
Validator.isArrayNotEmpty = arr => {
  return both(_isArray, pipe(isEmpty, not))(arr);
};

/**
 * @function isArrayEmpty
 * @param  {Array} arr    Array being checked for emptiness
 * @return {Boolean}      Whether the `arr` is an empty array
 *
 * Usage:
 * ```
 * isArrayEmpty(new Array()); // true
 * ```
 */
Validator.isArrayEmpty = arr => {
  return both(_isArray, isEmpty)(arr);
};

/**
 * Check whether or not the passed in object is an actual boolean
 *
 * @function isBoolean
 * @param  {Boolean}     val   Value that needs to be checked for validity
 *
 * Usage:
 * ```
 * let val = false;
 * isBoolean(val); // true
 * ```
 */
Validator.isBoolean = value => {
  return _isBoolean(value);
};

/**
 * Check whether or not the passed in value is defined. Will result in
 * an error if the value is `null` or `undefined`. However other falsey
 * values like `false` and `''` will not trigger a validation error.
 *
 * @function isDefined
 * @param  {Object}     val     Value that needs to be checked if it is defined (i.e., not `null` or `undefined`)
 *
 * Usage:
 * ```
 * let val = true;
 * isDefined(val); // true
 * ```
 */
// TODO optimise with isNil
Validator.isDefined = function(value) {
  // return !_isNull(value) && !_.isUndefined(value);
  return !isNil(value);
};

// TODO JSDoc
// Make this the isDefined default
Validator.isNotNil = input => {
  return !isNil(input);
};

/**
 * Check whether or not the passed in valid is a string
 *
 * @function isString
 * @param  {String} val Value to be checked
 * @return {Boolean}    Whether it's in fact a String or not
 *
 * Usage:
 * ```
 * let val = 'popo';
 * isString(val); // true
 * ```
 */
Validator.isString = function(value) {
  return _isString(value);
};

/**
 * Checks whether or not the provided string is a valid time zone.
 *
 * @function isValidTimeZone
 * @param  {String} string  The string timezone to be checked
 * @return {Boolean}        Whether the provided string is a valid timezone or not
 *
 * Usage:
 * ```
 * let timezone = 'Portugal\Lisbon';
 * isValidTimeZone(timezone); // false
 * ```
 */
Validator.isValidTimeZone = function(string) {
  // Only timezones of the following format are supported: `foo/bar[/optional]`
  const isSupportedTimezone = string => Boolean(tz.timezone.timezone.zones[string]);
  const hasRightFormat = string => string.includes('/');
  return both(isSupportedTimezone, hasRightFormat)(string);
};

/**
 * Checks whether the string that was passed in the `check` method is a short string.
 *
 * A short string should be:
 *     * At least 1 character long
 *     * At most 1000 characters long
 *
 * @function isShortString
 * @param  {String} input Value to be checked
 * @return {Boolean}      Whether `input` is a short string or not
 *
 * Usage:
 * ```
 * let string = 'popo';
 * isShortString(string); // true
 * ```
 */
Validator.isShortString = function(value = '') {
  return both(_isString, _isItLengthy({ min: 1, max: 1000 }))(value);
};

/**
 * Checks whether the string that was passed in the `check` method is a medium string.
 *
 * A medium string should be:
 *     * At least 1 character long
 *     * At most 10000 characters long
 *
 * @function isMediumString
 * @param  {String} input Value to be checked
 * @return {Boolean}      Whether `input` is a medium string or not
 *
 * Usage:
 * ```
 * let string = 'popo';
 * isMediumString(string); // true
 * ```
 */
Validator.isMediumString = function(value = '') {
  return both(_isString, _isItLengthy({ min: 1, max: 10000 }))(value);
};

/**
 * Checks whether the string that was passed in the `check` method is a long string.
 *
 * A long string should be:
 *     * At least 1 character long
 *     * At most 100000 characters long
 *
 * @function isLongString
 * @param  {String} input Value to be checked
 * @return {Boolean}      Whether `input` is a long string or not
 *
 * Usage:
 * ```
 * let string = 'popo';
 * isLongString(string); // true
 * ```
 */
Validator.isLongString = function(value) {
  return both(_isString, _isItLengthy({ min: 1, max: 100000 }))(value);
};

/**
 * Checks whether the string is a valid host
 *
 * @function isHost
 * @param  {String} hostString  String to be checked
 * @return {Boolean}            Whether a string is a valid Host
 *
 * Usage:
 * ```
 * let string = 'oaeproject.org';
 * istHost(string); // true
 * ```
 */
// TODO optimise with FQQN maybe?
Validator.isHost = function(hostString) {
  return both(Validator.isShortString, string =>
    // eslint-disable-next-line camelcase
    Validator.isURL(string, { allow_trailing_dot: true, require_tld: false })
  )(hostString);
};

/**
 * Checks whether the string is a valid iso-3166 country code
 *
 * @function isIso3166Country
 * @param  {String} string  The value being checked
 * @return {Boolean}        Whether the value follows the iso-3166 country code pattern
 *
 * Usage:
 * ```
 * isIso3166Country(string); // maybe
 * ```
 */
Validator.isIso3166Country = function(value) {
  return _isString(value) && Validator.isISO31661Alpha2(value);
};

export { Validator };
