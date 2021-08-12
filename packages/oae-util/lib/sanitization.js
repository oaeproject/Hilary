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

import pkg from 'he';
const { encode } = pkg;
import { curry, __, isNil, ifElse } from 'ramda';

const ENCODE_OPTIONS = {};
const EMPTY_STRING = '';
const returnEmpty = () => EMPTY_STRING;
const defaultEncode = curry(encode)(__, ENCODE_OPTIONS);

/**
 * Encode the `value` parameter such that it is safe to be embedded into an HTML page.
 *
 * @param  {String}     value   The input string for which the HTML characters need to be escaped. If unspecified, the empty string will be returned
 * @return {String}             The input string after the HTML characters have been escaped
 */
const encodeForHTML = (value) => ifElse(isNil, returnEmpty, defaultEncode)(value);

/**
 * Encode the given string such that it is safe to be used as an attribute to an HTML tag.
 *
 * @param  {String}     value   The input string for which the non-attribute-safe characters need to be escaped. If unspecified, the empty string will be returned
 * @return {String}             The input string after the HTML attribute characters have been escaped
 */
const encodeForHTMLAttribute = encodeForHTML;

/**
 * Encode the given string such that it is safe to be used as a URL fragment
 *
 * @param  {String}     [value]         The user input string that should be sanitized. If this is not provided, an empty string will be returned
 * @return {String}                     The sanitized user input, ready to be used as a URL fragment
 */
const encodeForURL = (value) => ifElse(isNil, returnEmpty, encodeURIComponent)(value);

export { encodeForHTML, encodeForHTMLAttribute, encodeForURL };
