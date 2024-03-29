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

import * as tz from 'oae-util/lib/tz.js';
import {
  defaultTo,
  trim,
  pipe,
  curry,
  __,
  length,
  reduceWhile,
  compose,
  both,
  either,
  not,
  or,
  type,
  is,
  equals,
  reduce,
  isNil,
  isEmpty,
  gte as greaterOrEqualThan,
  gt as greaterThan
} from 'ramda';
import { isPast, isFuture, toDate } from 'date-fns';

import Validator from 'validator';

const { isURL, isISO31661Alpha2, contains, isLength } = Validator;

/**
 * Private utility functions
 */
const _isString = (value) => is(String, value);

const _isBoolean = (value) => is(Boolean, value);

const _isFunction = (value) => is(Function, value);

const _isArray = (value) => is(Array, value);

const _isNumber = (value) => is(Number, value);

const _isObject = (value) => is(Object, value);

const _isFalse = (value) => equals(value, false);

const _isItLengthy = (interval) => (value) => isLength(value, interval);

/**
 * Composed functions
 */
const toInt = curry(parseInt)(__, 10);
const isZeroOrGreater = greaterOrEqualThan(__, 0);
const isOneOrGreater = greaterThan(__, 0);
const dateIsIntoTheFuture = pipe(toInt, toDate, isFuture);
const dateIsInThePast = pipe(toInt, toDate, isPast);
const defaultToEmptyArray = defaultTo([]);
const defaultToEmptyObject = defaultTo({});
const isRoleValid = curry(compose(not, equals))(__, false);

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
const isDifferent = (a, b) => compose(not, equals)(a, b);

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
const isNotEmpty = (input) => compose(not, isEmpty, trim, defaultTo(''))(input);

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
const notContains = (string, seed) => compose(not, contains)(string, seed);

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
const isDefined = (value) => compose(not, isNil)(value);

/**
 * Checks if a value is present or defined, often used for parameter validation
 * In this case notNull means that it must be defined but also not empty (strings, arrays, etc)
 * This includes empty strings. I know. Dont ask.
 *
 * @function isNotNull
 * @param  {Object} value  Value being checked for not null (defined and not empty)
 * @return {Boolean}       Whether `value` is not null
 *
 * Usage:
 * ````
 * let string = '';
 * let foo = null;
 * let bar = undefined;
 * isNotNull(string); // false
 * isNotNull(foo); // false
 * isNotNull(bar); // false
 * isNotNull([1,2,3]); // true
 * ````
 */
const isNotNull = (value) => both(isDefined, compose(not, isEmpty))(value);

/**
 * @function unless
 * @param  {Function} validation  Validator function to be applied
 * @param  {Error}    error       Error to be thrown in case the validation does not pass
 * @return {Function}             A function to be chained in validation steps
 *
 * Usage:
 * ```
 * let func = unless(isNotNull, new Error());
 * func(null, Error); // throws an error
 * ```
 */
const unless =
  (validation, error) =>
  (...args) => {
    const validationFails = compose(not, validation)(...args);
    if (validationFails) throw error;
  };

/**
 * @function validateInCase
 * @param  {Boolean} condition    Condition that needs to be checked to validate
 * @param  {Function} validation  Validation function to be applied if condition is true
 * @param  {Array} ...args        Extra arguments for validation
 * @return {Boolean}              Result of validation if condition is true, otherwise return true (no error thrown)
 */
const validateInCase =
  (condition, validation) =>
  (value, ...args) =>
    condition ? validation(value, ...args) : true;

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
const getNestedObject = (nestedObject) =>
  reduce((object, key) => (object && object[key] !== 'undefined' ? object[key] : undefined), nestedObject);

/**
 * Check whether or not a context represents a logged in user
 *
 * @function isLoggedInUser
 * @param  {Context}    ctx             Current execution context
 * @param  {String}     [tenantAlias]   The alias of the tenant to verify the context is authenticated to. If unspecified, the check will validate that the context is simply authenticated anywhere
 *
 * Usage:
 * ```
 * isLoggedInUser(ctx);
 * ```
 */
const isLoggedInUser = function (ctx, tenantAlias) {
  const isTenantNotValid = () => compose(not, _isObject)(ctx.tenant());
  const isContextNotValid = () => compose(not, _isObject)(ctx.user());
  const isTenantAliasValid = () => compose(not, isNil)(tenantAlias);
  const isAliasNotValid = () => not(ctx.tenant().alias);
  const isUserIdNotValid = () => not(ctx.user().id);
  const aliasesAreDifferent = () => isDifferent(ctx.tenant().alias, tenantAlias);

  const checkCondition1 = () => compose(not, _isObject)(ctx);
  const checkCondition2 = () => either(isTenantNotValid, isAliasNotValid)();
  const checkCondition3 = () => either(isContextNotValid, isUserIdNotValid)();
  const checkCondition4 = () => both(isTenantAliasValid, aliasesAreDifferent)();

  const allConditions = [checkCondition1, checkCondition2, checkCondition3, checkCondition4];
  const _mustBeFalse = (acc, currentFn) => _isFalse(currentFn());
  const conditionsPassed = reduceWhile(_mustBeFalse, (acc /* , currentFn */) => acc + 1, 0, allConditions);

  return equals(conditionsPassed, length(allConditions));
};

/**
 * Check whether or not a context represents a global administrator
 *
 * @function isGlobalAdministratorUser
 * @param  {Context}    ctx     Current execution context
 *
 * Usage:
 * ```
 * isGlobalAdministratorUser(ctx);
 * ```
 */
const isGlobalAdministratorUser = (ctx) => {
  const isTenantNotAFunction = () => compose(not, _isFunction)(ctx.tenant);
  const isTenantNotAnObject = () => compose(not, _isObject)(ctx.tenant());
  const isUserNotAFunction = () => compose(not, _isFunction)(ctx.user);
  const isUserNotAnObject = () => compose(not, _isObject)(ctx.user());
  const isTenantNotValid = () => either(isTenantNotAFunction, isTenantNotAnObject)();
  const isUserNotValid = () => either(isUserNotAFunction, isUserNotAnObject)();
  const isAliasNotValid = () => not(ctx.tenant().alias);
  const doesUserNotExist = () => not(ctx.user().id);

  const checkCondition1 = () => compose(not, _isObject)(ctx);
  const checkCondition4 = () => compose(not, _isFunction)(ctx.user().isGlobalAdmin);
  const checkCondition2 = () => either(isTenantNotValid, isAliasNotValid)();
  const checkCondition3 = () => either(isUserNotValid, doesUserNotExist)();
  const checkCondition5 = () => isDifferent(ctx.user().isGlobalAdmin(), true);

  const allConditions = [checkCondition1, checkCondition2, checkCondition3, checkCondition4, checkCondition5];
  const _mustBeFalse = (acc, currentFn) => _isFalse(currentFn());
  const conditionsPassed = reduceWhile(_mustBeFalse, (acc /* , currentFn */) => acc + 1, 0, allConditions);

  return equals(conditionsPassed, length(allConditions));
};

/**
 * Check whether or not the passed in object is an actual object
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
const isObject = (object) => _isObject(object);

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
const isModule = (value) => or(equals(type(value), 'Module'), _isObject(value));

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
const isANumber = (value) => _isNumber(value);

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
const isArray = (array) => _isArray(array);

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
const isArrayNotEmpty = (array) => both(_isArray, compose(not, isEmpty))(array);

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
const isArrayEmpty = (array) => both(_isArray, isEmpty)(array);

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
const isBoolean = (value) => _isBoolean(value);

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
const isString = (value) => _isString(value);

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
const isValidTimeZone = function (string) {
  // Only timezones of the following format are supported: `foo/bar[/optional]`
  const isSupportedTimezone = (string) => Boolean(tz.timezone.timezone.zones[string]);
  const hasRightFormat = (string) => string.includes('/');
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
const isShortString = (value = '') => both(_isString, _isItLengthy({ min: 1, max: 1000 }))(value);

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
const isMediumString = (value = '') => both(_isString, _isItLengthy({ min: 1, max: 10_000 }))(value);

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
const isLongString = (value) => both(_isString, _isItLengthy({ min: 1, max: 100_000 }))(value);

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
const isHost = (hostString) =>
  both(isShortString, (string) =>
    // eslint-disable-next-line camelcase
    isURL(string, { allow_trailing_dot: true, require_tld: false })
  )(hostString);

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
const isIso3166Country = (value) => both(_isString, isISO31661Alpha2)(value);

const completeValidations = {
  ...Validator,
  isEmpty, // override the isEmpty method from Validator and use R instead
  isNil,
  isDifferent,
  isDefined,
  isNotEmpty,
  isOneOrGreater,
  isZeroOrGreater,
  toInt,
  notContains,
  dateIsIntoTheFuture,
  dateIsInThePast,
  isRoleValid,
  isNotNull,
  unless,
  validateInCase,
  getNestedObject,
  isIso3166Country,
  isHost,
  isShortString,
  isMediumString,
  isLongString,
  isValidTimeZone,
  isString,
  isBoolean,
  isLoggedInUser,
  isArrayEmpty,
  isArrayNotEmpty,
  isArray,
  isGlobalAdministratorUser,
  isObject,
  isModule,
  isANumber,
  defaultToEmptyArray,
  defaultToEmptyObject
};

export { completeValidations as Validator };
