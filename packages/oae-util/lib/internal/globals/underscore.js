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

import _ from 'underscore';

/*!
 * All OAE-specific mixins are prefixed with `oae`, followed by a short name that is descriptive to
 * what it should do
 */
_.mixin({
  /**
   * Get an object property, gracefully handling the case where the object is null
   *
   * @param  {Object}     source      The source object
   * @param  {String}     key         The key to get
   * @return {Object}                 The value of the key (e.g., `source[key]`)
   */
  oaeGet(source, key) {
    if (!source) {
      return undefined;
    }

    return source[key];
  },

  /**
   * Create an object from a variable list of arguments. This is useful to create objects in one
   * easy method that have keys that aren't static strings. For example:
   *
   *  ```
   *      var myObj = {};
   *      myObj[publicTenant.publicUser.user.id] = 'member';
   *  ```
   *
   *  Can instead be written as:
   *
   *  `var myObj = _.oaeObj(publicTenant.publicUser.user.id, 'member');`
   *
   * @param  {String}     key0        The first key to apply to the object
   * @param  {Object}     value0      The value to assign to the first key
   * @param  {String}     key1...     More pairs of keys and values to initialize the object with
   */
  oaeObj(...args) {
    const result = {};
    _.chain(args)
      .toArray()
      // Group the array of arguments into pairs: [[key0, val0], [key1, val1], ...]
      .groupBy((arg, i) => {
        return Math.floor(i / 2);
      })
      .each(keyAndValue => {
        result[keyAndValue[0]] = keyAndValue[1];
      });
    return result;
  },

  /**
   * Map the keys of the given object using the given mapping function. For example:
   *
   * ```
   *      var myObj = {'a': 1, 'b': 2};
   *      _.oaeMapKeys(myObj, function(key) { return key.toUpperCase(); });
   *      > {'A': 1, 'B': 2}
   * ```
   *
   * @param  {Object}     obj         The object whose keys to map
   * @param  {Function}   f           The mapping function to apply to the keys
   * @param  {String}     f.key       The key of the current entry
   * @param  {Object}     f.value     The value of the current entry
   * @return {Object}                 The object with its keys mapped
   */
  oaeMapKeys(obj, f) {
    const mappedObj = {};
    _.each(obj, (value, key) => {
      mappedObj[f(key, value)] = value;
    });
    return mappedObj;
  },

  /**
   * Extend the source object with only the keys in the `extendWith` object whose value is not
   * `undefined`. This avoids adding unwanted keys when extending with optional properties from
   * another object.
   *
   * For example:
   *
   *  Without underscore:
   *  ```
   *      that.picture = {};
   *       if (opts.smallPictureUri) {
   *           that.picture.smallUri = opts.smallPictureUri;
   *       }
   *       if (opts.mediumPictureUri) {
   *           that.picture.mediumUri = opts.mediumPictureUri;
   *       }
   *       if (opts.largePictureUri) {
   *           that.picture.largeUri = opts.largePictureUri;
   *       }
   *  ```
   *
   *  With `oaeExtendDefined`:
   *  ```
   *      that.picture = _.oaeExtendDefined({}, {
   *          'smallUri': opts.smallPictureUri,
   *          'mediumUri': opts.mediumPictureUri,
   *          'largeUri': opts.largePictureUri
   *      });
   *  ```
   *
   * @param  {Object}     source      The object to extend. This object will be mutated
   * @param  {Object}     extendWith  The object to merge into the source object
   * @return {Object}                 The resulting `source` object
   */
  oaeExtendDefined(source, extendWith) {
    return _.extend(
      source,
      _.omit(extendWith, value => {
        return value === undefined;
      })
    );
  }
});
