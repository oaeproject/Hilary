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

import Validator from 'validator';

const HOST_REGEX = /^(?=.{1,255}$)[0-9A-Za-z](?:(?:[0-9A-Za-z]|-){0,61}[0-9A-Za-z])?(?:\.[0-9A-Za-z](?:(?:[0-9A-Za-z]|-){0,61}[0-9A-Za-z])?)*\.?(:\d+)?$/i;

let countriesByCode = null;

// TODO: documentation
Validator.isDifferent = (input, notEqualsTo) => {
  return !Validator.equals(String(input), notEqualsTo);
};

Validator.isNotEmpty = input => {
  input = input || '';
  return !Validator.isEmpty(input.trim());
};

Validator.notContains = (string, seed) => {
  return !Validator.contains(string, seed);
};

Validator.isNull = whatever => {
  return !whatever;
};

Validator.isNotNull = whatever => {
  return !Validator.isNull(whatever);
};

// TODO JSdoc
Validator.otherwise = error => {
  return passed => {
    if (!passed) {
      throw error;
    }
  };
};

// TODO JSdoc
Validator.makeSureThat = (condition, value, validation) => {
  return function() {
    return condition ? validation(value) : true;
  };
};

// TODO JSdoc
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
 * Usage:
 * ```
 * validator.isLoggedInUser(ctx);
 * ```
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     [tenantAlias]   The alias of the tenant to verify the context is authenticated to. If unspecified, the check will validate that the context is simply authenticated anywhere
 */
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
 * Usage:
 * ```
 * validator.isGlobalAdministratorUser(ctx);
 * ```
 *
 * @param  {Context}    ctx     Standard context object containing the current user and the current tenant
 */
Validator.isGlobalAdministratorUser = ctx => {
  if (!_.isObject(ctx)) {
    return false;
  }

  if (!_.isFunction(ctx.tenant) || !_.isObject(ctx.tenant()) || !ctx.tenant().alias) {
    return false;
  }

  if (!_.isFunction(ctx.user) || !_.isObject(ctx.user()) || !ctx.user().id) {
    return false;
  }

  if (!_.isFunction(ctx.user().isGlobalAdmin)) {
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
 * Usage:
 * ```
 * validator.check(null, error).isObject(obj);
 * ```
 *
 * @param  {Object}     obj   Object that needs to be checked for validity
 */
Validator.isObject = function(obj) {
  return _.isObject(obj);
};

Validator.isANumber = input => {
  return Validator.isNumeric(String(input));
};

/**
 * Check whether or not the passed in object is an actual array
 *
 * Usage:
 * ```
 * validator.isArray(arr);
 * ```
 *
 * @param  {Object[]}     arr   Object that needs to be checked for validity
 */
Validator.isArray = function(arr) {
  return _.isArray(arr);
};

Validator.isArrayNotEmpty = arr => {
  return Validator.isArray(arr) && _.size(arr) > 0;
};

Validator.isArrayEmpty = arr => {
  return Validator.isArray(arr) && _.size(arr) === 0;
};

/**
 * Check whether or not the passed in object is an actual boolean
 *
 * Usage:
 * ```
 * validator.isBoolean(val);
 * ```
 *
 * @param  {Boolean}     val   Value that needs to be checked for validity
 */
Validator.isBoolean = function(val) {
  return _.isBoolean(val);
};

/**
 * Check whether or not the passed in value is defined. Will result in
 * an error if the value is `null` or `undefined`. However other falsey
 * values like `false` and `''` will not trigger a validation error.
 *
 * Usage:
 * ```
 * validator.isDefined(val);
 * ```
 *
 * @param  {Object}     val     Value that needs to be checked if it is defined (i.e., not `null` or `undefined`)
 */
Validator.isDefined = function(val) {
  return !_.isNull(val) && !_.isUndefined(val);
};

/**
 * Check whether or not the passed in valid is a string
 *
 * Usage:
 * ```
 * validator.isString(val);
 * ```
 */
Validator.isString = function(val) {
  return _.isString(val);
};

/**
 * Checks whether or not the provided string is a valid time zone.
 *
 * Usage:
 * ```
 * validator.isValidTimeZone(timezone);
 * ```
 */
Validator.isValidTimeZone = function(string) {
  // Only timezones of the following format are supported: `foo/bar[/optional]`
  const unsupportedFormat = !tz.timezone.timezone.zones[string] || !string.includes('/');
  return !unsupportedFormat;
};

/**
 * Checks whether the string that was passed in the `check` method is a short string.
 *
 * A short string should be:
 *     * At least 1 character long
 *     * At most 1000 characters long
 *
 * Usage:
 * ```
 * validator.isShortString(string);
 * ```
 */
Validator.isShortString = function(input = '') {
  return Validator.isLength(input, { min: 1, max: 1000 });
};

/**
 * Checks whether the string that was passed in the `check` method is a medium string.
 *
 * A medium string should be:
 *     * At least 1 character long
 *     * At most 10000 characters long
 *
 * Usage:
 * ```
 * validator.isMediumString(string);
 * ```
 */
Validator.isMediumString = function(input = '') {
  return Validator.isLength(input, { min: 1, max: 10000 });
};

/**
 * Checks whether the string that was passed in the `check` method is a long string.
 *
 * A long string should be:
 *     * At least 1 character long
 *     * At most 100000 characters long
 *
 * Usage:
 * ```
 * validator.isLongString(string);
 * ```
 */
Validator.isLongString = function(string) {
  // this.len(1, 100000);
  return Validator.isLength(string, { min: 1, max: 100000 });
};

/**
 * Checks whether the string is a valid host
 *
 * Usage:
 * ```
 * validator.istHost(string);
 * ```
 */
Validator.isHost = function(hostString) {
  return Validator.isShortString(hostString) && hostString.match(HOST_REGEX);
};

/**
 * Checks whether the string is a valid iso-3166 country code
 *
 * Usage:
 * ```
 * validator.check(isIso3166Country(string);
 * ```
 */
Validator.isIso3166Country = function(string) {
  if (!_.isString(string)) {
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
 * @param  {String}     code    The ISO-3166-1 country code to check
 * @return {Boolean}            Whether or not the code is a known ISO-3166-1 country code
 * @api private
 */
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
