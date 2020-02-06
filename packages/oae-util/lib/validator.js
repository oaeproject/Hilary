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

import _ from 'underscore';
import * as tz from 'oae-util/lib/tz';
import * as OAEUI from 'oae-ui';
// import { is, equals, isNil, isEmpty } from 'ramda';
import { is, isNil, isEmpty } from 'ramda';

import Validator from 'validator';

const HOST_REGEX = /^(?=.{1,255}$)[0-9A-Za-z](?:(?:[0-9A-Za-z]|-){0,61}[0-9A-Za-z])?(?:\.[0-9A-Za-z](?:(?:[0-9A-Za-z]|-){0,61}[0-9A-Za-z])?)*\.?(:\d+)?$/i;

let countriesByCode = null;

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

/**
const _equalsTo = (value1, value2) => {
  return equals(value1, value2);
};

const _isNull = value => {
  return value === null;
};

  const _isObject = value => {
    return is(Object, value);
  };
  
  */

/**
 * @function isDifferent
 * @param  {String} input       Value being compared
 * @param  {String} notEqualsTo Value being compared to
 * @return {Boolean}            Whether `input` is different to `notEqualsTo`
 *
 * Usage:
 * ```
 * isDifferent('abcd', 'abcde'); // true
 * ```
 */
// TODO optimise with equals
Validator.isDifferent = (input, notEqualsTo) => {
  return !Validator.equals(String(input), notEqualsTo);
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
// TODO optimise with isEmpty from R
Validator.isNotEmpty = input => {
  input = input || '';
  return !Validator.isEmpty(input.trim());
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
  return !Validator.contains(string, seed);
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
  return !Validator.isNull(value);
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
// TODO optimise
Validator.otherwise = error => {
  return passed => {
    if (!passed) {
      throw error;
    }
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
 * validator.isLoggedInUser(ctx);
 * ```
 */
// TODO optimise
Validator.isLoggedInUser = function(ctx, tenantAlias) {
  if (!_.isObject(ctx)) {
    return false;
  }

  if (!_.isObject(ctx.tenant()) || !ctx.tenant().alias) {
    return false;
  }

  if (!_.isObject(ctx.user()) || !ctx.user().id) {
    return false;
  }

  if (tenantAlias && ctx.tenant().alias !== tenantAlias) {
    return false;
  }

  return true;
};

/**
 * Check whether or not a context represents a global administrator
 *
 * @function isGlobalAdministratorUser
 * @param  {Context}    ctx     Standard context object containing the current user and the current tenant
 *
 * Usage:
 * ```
 * validator.isGlobalAdministratorUser(ctx);
 * ```
 */
// TODO optimise
Validator.isGlobalAdministratorUser = ctx => {
  if (!_.isObject(ctx)) {
    return false;
  }

  if (!_isFunction(ctx.tenant) || !_.isObject(ctx.tenant()) || !ctx.tenant().alias) {
    return false;
  }

  if (!_isFunction(ctx.user) || !_.isObject(ctx.user()) || !ctx.user().id) {
    return false;
  }

  if (!_isFunction(ctx.user().isGlobalAdmin)) {
    return false;
  }

  if (ctx.user().isGlobalAdmin() !== true) {
    return false;
  }

  return true;
};

/**
 * Check whether or not the passed in object is an actual JSON object
 *
 * @function isObject
 * @param  {Object}     obj   Object that needs to be checked for validity
 *
 * Usage:
 * ```
 * validator.check(null, error).isObject(obj);
 * ```
 */
// TODO optimise with isObject from R
Validator.isObject = function(obj) {
  return _.isObject(obj);
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
Validator.isANumber = input => {
  return _isNumber(input);
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
 * validator.isArray(arr); // true
 * ```
 */
Validator.isArray = function(arr) {
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
  return _isArray(arr) && !isEmpty(arr);
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
  return _isArray(arr) && isEmpty(arr);
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
 * validator.isBoolean(val); // true
 * ```
 */
Validator.isBoolean = function(val) {
  return _isBoolean(val);
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
 * validator.isDefined(val); // true
 * ```
 */
// TODO optimise with isNil
Validator.isDefined = function(value) {
  return !_.isNull(value) && !_.isUndefined(value);
  // return !isNil(value);
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
 * validator.isString(val); // true
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
 * validator.isValidTimeZone(timezone); // false
 * ```
 */
Validator.isValidTimeZone = function(string) {
  // Only timezones of the following format are supported: `foo/bar[/optional]`
  const isSupportedTimezone = Boolean(tz.timezone.timezone.zones[string]);
  const hasRightFormat = string.includes('/');
  return isSupportedTimezone && hasRightFormat;
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
 * validator.isShortString(string); // true
 * ```
 */
Validator.isShortString = function(value = '') {
  return _isString(value) && Validator.isLength(value, { min: 1, max: 1000 });
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
 * validator.isMediumString(string); // true
 * ```
 */
Validator.isMediumString = function(value = '') {
  return _isString(value) && Validator.isLength(value, { min: 1, max: 10000 });
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
 * validator.isLongString(string); // true
 * ```
 */
Validator.isLongString = function(value) {
  return _isString(value) && Validator.isLength(value, { min: 1, max: 100000 });
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
 * validator.istHost(string); // true
 * ```
 */
// TODO optimise with FQQN maybe?
Validator.isHost = function(hostString) {
  return Validator.isShortString(hostString) && hostString.match(HOST_REGEX);
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
 * validator.check(isIso3166Country(string);
 * ```
 */
// TODO optimise
Validator.isIso3166Country = function(string) {
  if (!_isString(string)) {
    return false;
  }

  if (!_hasCountryCode(string.toUpperCase())) {
    return false;
  }

  return true;
};

/**
 * Determine if the given country code is known
 *
 * @function _hasCountryCode
 * @param  {String}     code    The ISO-3166-1 country code to check
 * @return {Boolean}            Whether or not the code is a known ISO-3166-1 country code
 * @api private
 */
// TODO optimise
const _hasCountryCode = function(code) {
  if (!countriesByCode) {
    // Lazy initialize the country code array so as to not form an cross-
    // dependency on `oae-ui`
    countriesByCode = _.chain(OAEUI.getIso3166CountryInfo().countries)
      .indexBy('code')
      .mapObject(() => {
        return true;
      })
      .value();
  }

  return countriesByCode[code];
};

export { Validator };
