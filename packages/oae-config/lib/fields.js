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

import * as OaeUtil from 'oae-util/lib/util.js';

/**
 * A basic field object that contains all the field properties and
 * a way to convert JSON values to and from Cassandra colum values
 *
 * @param  {String}     type                        A unique identifier that defines what type of config element this is. ex: `Bool`, `Text`, etc
 * @param  {String}     name                        The name of the config element
 * @param  {String}     description                 A brief description that explains what this config element will be used for
 * @param  {Object}     defaultValue                The default value for this config element. The type of this value will depend on the `type` of the config element
 * @param  {Object}     [options]                   List of additional configuration options
 * @param  {Boolean}    [options.tenantOverride]    Whether or not tenant admins should be able to override this value for their tenant. Defaults to `true`
 * @param  {Boolean}    [options.suppress]          Whether or not this config element can be retrieved by regular users. Defaults to `false`
 * @param  {Boolean}    [options.globalAdminOnly]   Whether or not this config element is only available to global admin users. Defaults to `false`
 * @api private
 */
const BaseField = function (type, name, description, defaultValue, options) {
  options = options || {};
  const field = {
    type,
    name,
    description,
    defaultValue,
    tenantOverride: options.tenantOverride !== false,
    suppress: options.suppress === true,
    globalAdminOnly: options.globalAdminOnly === true
  };

  /**
   * Given a stored value, convert it to an application value
   *
   * @param  {String}     value       The stored value
   * @return {Object}                 Depending on the field this will return a value that can be used through-out the application. If the field does not override this method, the database value will be returned as-is
   */
  field.deserialize = function (value) {
    return value;
  };

  return field;
};

/**
 * Returns the configuration object for a boolean type field
 *
 * @param  {String}     name                        The name of the element shown in the UI as a header
 * @param  {String}     description                 The description that will be shown next to the element
 * @param  {Boolean}    [defaultValue]              The default value of the element. This will default to `false` when not provided
 * @param  {Object}     [options]                   List of additional configuration options
 * @param  {Boolean}    [options.tenantOverride]    Whether or not tenant admins should be able to override this value for their tenant. Defaults to `true`
 * @param  {Boolean}    [options.suppress]          Whether or not this config element can be retrieved by regular users. Defaults to `false`
 * @param  {Boolean}    [options.globalAdminOnly]   Whether or not this config element is only available to global admin users. Defaults to `false`
 */
const Bool = function (name, description, defaultValue, options) {
  defaultValue = defaultValue || false;
  const field = new BaseField('boolean', name, description, defaultValue, options);

  /*!
   * @return {Boolean}    Convert the given Cassandra column value to a boolean
   * @see BaseField#deserialize
   */
  field.deserialize = function (columnValue) {
    return OaeUtil.castToBoolean(columnValue);
  };

  return field;
};

/**
 * Returns the configuration object for a text input type field
 *
 * @param  {String}     name                        The name of the element shown in the UI as a header
 * @param  {String}     description                 The description that will be shown next to the element
 * @param  {String}     [defaultValue]              The default value of the element. This will default to an empty string when not provided
 * @param  {Object}     [options]                   List of additional configuration options
 * @param  {Boolean}    [options.tenantOverride]    Whether or not tenant admins should be able to override this value for their tenant. Defaults to `true`
 * @param  {Boolean}    [options.suppress]          Whether or not this config element can be retrieved by regular users. Defaults to `false`
 * @param  {Boolean}    [options.globalAdminOnly]   Whether or not this config element is only available to global admin users. Defaults to `false`
 */
const Text = function (name, description, defaultValue, options) {
  defaultValue = defaultValue || '';
  return new BaseField('text', name, description, defaultValue, options);
};

/**
 * Returns the configuration object for a text input type field that needs to be internationalizable
 *
 * @param  {String}     name                        The name of the element shown in the UI as a header
 * @param  {String}     description                 The description that will be shown next to the element
 * @param  {String}     defaultValue                The default value of the element
 * @param  {Object}     [options]                   List of additional configuration options
 * @param  {Boolean}    [options.tenantOverride]    Whether or not tenant admins should be able to override this value for their tenant. Defaults to `true`
 * @param  {Boolean}    [options.suppress]          Whether or not this config element can be retrieved by regular users. Defaults to `false`
 * @param  {Boolean}    [options.globalAdminOnly]   Whether or not this config element is only available to global admin users. Defaults to `false`
 */
const InternationalizableText = function (name, description, defaultValue, options) {
  // The UI always needs an object with a default key in it
  defaultValue = defaultValue || '';
  defaultValue = { default: defaultValue };

  // Construct the base field
  return new BaseField('internationalizableText', name, description, defaultValue, options);
};

/**
 * Returns the configuration object for a radio button group type field
 *
 * @param  {String}     name                        The name of the element shown in the UI as a header
 * @param  {String}     description                 The description that will be shown next to the element
 * @param  {String}     defaultValue                The default value of the element
 * @param  {Array}      group                       An array of options for the radio button group. e.g. {'name': 'choice 1', 'value': 'ch1'}
 * @param  {Object}     [options]                   List of additional configuration options
 * @param  {Boolean}    [options.tenantOverride]    Whether or not tenant admins should be able to override this value for their tenant. Defaults to `true`
 * @param  {Boolean}    [options.suppress]          Whether or not this config element can be retrieved by regular users. Defaults to `false`
 * @param  {Boolean}    [options.globalAdminOnly]   Whether or not this config element is only available to global admin users. Defaults to `false`
 */
const Radio = function (name, description, defaultValue, group, options) {
  const field = new BaseField('radio', name, description, defaultValue, options);
  field.group = group;
  return field;
};

/**
 * Returns the configuration object for a drop down list type field
 *
 * @param  {String}     name                        The name of the element shown in the UI as a header
 * @param  {String}     description                 The description that will be shown next to the element
 * @param  {String}     defaultValue                The default value of the element
 * @param  {Array}      list                        An array of options for the dorp down list. e.g. {'name': 'choice 1', 'value': 'ch1'}
 * @param  {Object}     [options]                   List of additional configuration options
 * @param  {Boolean}    [options.tenantOverride]    Whether or not tenant admins should be able to override this value for their tenant. Defaults to `true`
 * @param  {Boolean}    [options.suppress]          Whether or not this config element can be retrieved by regular users. Defaults to `false`
 * @param  {Boolean}    [options.globalAdminOnly]   Whether or not this config element is only available to global admin users. Defaults to `false`
 */
const List = function (name, description, defaultValue, list, options) {
  const field = new BaseField('list', name, description, defaultValue, options);
  field.list = list;
  return field;
};

export { Bool, Text, InternationalizableText, Radio, List };
