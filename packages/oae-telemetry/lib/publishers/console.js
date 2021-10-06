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

import { logger } from 'oae-logger';

const log = logger('telemetry-console');

/**
 * Starts monitoring redis and logs the telemetry data on the console.
 */
const init = function () {};

/**
 * Publishes the given telemetry data to the console.
 *
 * @param  {Object}     data    The telemetry data to publish in the format: `module -> name -> value`
 */
const publish = function (data) {
  _.each(data, (nameValue, module) => {
    _.each(nameValue, (value, name) => {
      if (Array.isArray(value)) {
        value = value.join(', ');
        log().info('%s %s %s', _padString(module, ' ', 20), _padString(name, ' ', 30), value);
      } else if (value > 0) {
        log().info('%s %s %s', _padString(module, ' ', 20), _padString(name, ' ', 30), value);
      }
    });
  });
};

/**
 * Rightpads a string with `char` untill the specified `length` is reached.
 *
 * @param  {String} str     The string to pad
 * @param  {String} char    The character to pad with.
 * @param  {Number} length  The total number of characters this string should have
 * @return {String}         The padded string.
 * @api private
 */
const _padString = function (string_, char, length) {
  while (string_.length < length) {
    string_ += char;
  }

  return string_;
};

export { publish, init };
