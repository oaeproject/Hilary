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
import _ from 'underscore';
import clone from 'clone';

import * as Modules from 'oae-util/lib/modules';
import * as Cassandra from 'oae-util/lib/cassandra';
import * as EmitterAPI from 'oae-emitter';
import * as IO from 'oae-util/lib/io';
import * as OaeUtil from 'oae-util/lib/util';
import * as Pubsub from 'oae-util/lib/pubsub';
import { logger } from 'oae-logger';
import { Validator as validator } from 'oae-util/lib/validator';
// const { makeSureThat, ifNotThenThrow } = validator;
import pipe from 'ramda/src/pipe';

const log = logger('oae-config');

// Will be used to cache the global OAE config
let config = null;

const cachedGlobalSchema = {};
let cachedTenantSchema = {};

let cachedTenantConfigValues = {};

/**
 * The Configuration API.
 *
 * ## Events
 *
 * When the configuration has been updated for a tenant different than the global
 * admin tenant, the tenant alias will be passed into all of the events below.
 *
 * * `cached(tenantAlias)`:         The configuration for a tenant has been re-cached
 * * `update(tenantAlias)`:         The configuration for a tenant has been updated
 * * `preCache(tenantAlias)`:       The configuration for a tenant is about to be re-cached
 * * `preClear(tenantAlias)`:       The configuration for a tenant is about to be cleared
 * * `preUpdate(tenantAlias)`:      The configuration for a tenant is about to be updated
 */
const eventEmitter = new EmitterAPI.EventEmitter();

/// ///////////////////////
// Pubsub notifications //
/// ///////////////////////

/*!
 * Catch a published Redis PubSub message from the oae-config module and refreshes the cached configuration for the tenant (in case
 * only a tenant config value was updated) or for all tenants (in case the global admin configuration has been updated)
 *
 * @param  {String}  tenantAlias  The message sent out to the cluster, provides the alias of the tenant for which a config value changed (e.g. `cam`)
 */
Pubsub.emitter.on('oae-config', tenantAlias => {
  // Update the tenant configuration that was updated
  updateTenantConfig(tenantAlias, err => {
    if (err) {
      return log().error({ err, tenantAlias }, 'Error refreshing cached configuration after update');
    }

    eventEmitter.emit('update', tenantAlias);
  });
});

/// ///////////////////
// Get config value //
/// ///////////////////

/**
 * Get a function that allows retrieving of config values for a given module
 *
 * @param  {String}     moduleId    The ID of the module to get the configuration for
 * @return {Function}   getValue    Function that returns the cached a cached config value from the provided module
 * @throws {Error}                  Error thrown when no module id has been provided
 */
const setUpConfig = function(moduleId) {
  // Parameter validation
  if (!moduleId) {
    throw new Error('A module id must be provided');
  }

  return {
    /**
     * Get a configuration value for the current module. This will return a cached value. This internal function will
     * also return suppressed values, as they will be necessary for usage inside of the internal APIs
     *
     * @param  {String}                         tenantAlias             The alias of the tenant for which to get the config value
     * @param  {String}                         featureKey              The feature to get the element's value for. e.g., `twitter`
     * @param  {String}                         elementKey              The element to get the config value for. e.g., `enabled`
     * @return {Boolean|String|Number|Object}   cachedConfiguration     The requested config value e.g. `true`. This will be null if the config element cannot be found
     */
    getValue(tenantAlias, featureKey, elementKey) {
      const configValueInfo = _resolveConfigValueInfo(tenantAlias, moduleId, featureKey, elementKey);
      if (configValueInfo) {
        return configValueInfo.value;
      }

      return null;
    },

    /**
     * Get the timestamp for when a configuration value was last updated
     *
     * @param  {String}     tenantAlias     The alias of the tenant for which to get the config value's last updated timestamp
     * @param  {String}     feature         The feature to get the element's last updated timestamp for. e.g., `twitter`
     * @param  {String}     element         The element for which to get the config value's last updated timestamp. e.g., `enabled`
     * @return {Date}                       The timestamp when the config value was last updated. If the element could not be found, the epoch date (0 milliseconds) will be returned
     */
    getLastUpdated(tenantAlias, feature, element) {
      const configValueInfo = _resolveConfigValueInfo(tenantAlias, moduleId, feature, element);
      const lastUpdated = configValueInfo && configValueInfo.timestamp;
      return lastUpdated || new Date(0);
    }
  };
};

/**
 * Get the full cached config schema. This can only be retrieved by either global or tenant
 * admins, as it might contain sensitive data
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Object}     callback.schema     The config schema
 */
const getSchema = function(ctx, callback) {
  if (!ctx.user() || !ctx.user().isAdmin(ctx.tenant().alias)) {
    return callback({ code: 401, msg: 'Only global and tenant admin can get the config schema' });
  }

  if (ctx.user().isGlobalAdmin()) {
    return callback(null, cachedGlobalSchema);
  }

  return callback(null, cachedTenantSchema);
};

/**
 * Get the full config feed for a tenant from cache, containing all the config values for that tenant. Admin users will receive
 * all config values, including those for suppressed fields. Non-admin users will receive all of the non-suppressed config values
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     tenantAlias         The alias of the tenant for which to get the configuration
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Object}     callback.config     JSON object representing the full cached tenant config
 */
const getTenantConfig = function(ctx, tenantAlias, callback) {
  // Parameter validation
  try {
    pipe(
      validator.isNotEmpty,
      validator.generateError({
        code: 400,
        msg: 'Missing tenant parameter'
      })
    )(tenantAlias);
  } catch (error) {
    return callback(error);
  }

  const isGlobalAdmin = ctx.user() && ctx.user().isGlobalAdmin();
  const isTenantAdmin = ctx.user() && ctx.user().isTenantAdmin(tenantAlias);

  // Build the tenant configuration based on all available elements
  const tenantConfig = {};
  _.each(cachedGlobalSchema, (module, moduleKey) => {
    _.each(module, (feature, featureKey) => {
      _.each(feature.elements, (element, elementKey) => {
        if (!isGlobalAdmin && !isTenantAdmin && element.suppress) {
          return;
        }

        if (isTenantAdmin && element.globalAdminOnly) {
          return;
        }

        // The current user can see this value, so get the value info (value and timestamp)
        // to populate it in the tenant configuration response
        const configValueInfo = _resolveConfigValueInfo(tenantAlias, moduleKey, featureKey, elementKey);

        // Finally set the value on the tenant configuration
        tenantConfig[moduleKey] = tenantConfig[moduleKey] || {};
        tenantConfig[moduleKey][featureKey] = tenantConfig[moduleKey][featureKey] || {};
        tenantConfig[moduleKey][featureKey][elementKey] = configValueInfo.value;
      });
    });
  });

  return callback(null, tenantConfig);
};

/**
 * Resolve the effective value of the specified config element for the given tenant
 *
 * @param  {String}     tenantAlias                 The alias of the tenant for which to get the config value
 * @param  {String}     moduleKey                   The module of the config element
 * @param  {String}     featureKey                  The feature of the config element
 * @param  {String}     elementKey                  The config element key
 * @return {Object}     configValueInfo             The config info object
 * @return {Object}     configValueInfo.value       The configured value of this element for the specified tenant
 * @return {Date}       configValueInfo.timestamp   When the value was last updated. If never updated, then this date will be the epoch
 * @api private
 */
const _resolveConfigValueInfo = function(tenantAlias, moduleKey, featureKey, elementKey) {
  const element = _element(moduleKey, featureKey, elementKey);
  if (!element) {
    return null;
  }

  // The tenant config values will override the admin config values, which will override the
  // hard-coded element defaults
  const adminConfigValues = cachedTenantConfigValues[config.servers.globalAdminAlias] || {};
  const tenantConfigValues = cachedTenantConfigValues[tenantAlias] || {};

  const configKey = _generateColumnKey(moduleKey, featureKey, elementKey);

  // Find the effective value for the config key
  let configValue = null;
  if (_.has(tenantConfigValues, configKey)) {
    // If there is a tenant-level config value set, use it
    configValue = tenantConfigValues[configKey];
  } else if (_.has(adminConfigValues, configKey)) {
    // If there is no tenant-level value set and a global value set, use it
    configValue = adminConfigValues[configKey];
  } else {
    // If there are no overrides set, we use the element's hard-coded default value
    configValue = {
      timestamp: new Date(0),
      value: element.defaultValue
    };
  }

  return configValue;
};

/// /////////////////
// Initialization //
/// /////////////////

/**
 * Initialize and cache the configuration schema, as well as the list of config values for all tenants
 *
 * @param  {Object}     config          An object containing the full system configuration (i.e., `config.js`)
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const initConfig = function(_config, callback) {
  // Default callback
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err }, 'An error occured whilst initializing the configuration');
      }
    };

  config = _config;

  // Cache the config schema
  _cacheSchema(() => {
    _cacheAllTenantConfigs(callback);
  });
};

/**
 * Update the cached configuration for the specified tenant alias
 *
 * @param  {String}     tenantAlias     The alias of the tenant for which to refresh the cached configuration
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const updateTenantConfig = function(tenantAlias, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err, tenantAlias }, 'An error occured while caching a tenant config');
      }
    };

  eventEmitter.emit('preCache', tenantAlias);
  _getPersistentTenantConfig(tenantAlias, (err, persistentConfig) => {
    if (err) {
      return callback(err);
    }

    cachedTenantConfigValues[tenantAlias] = persistentConfig;

    eventEmitter.emit('cached', tenantAlias);
    return callback();
  });
};

/**
 * Cache all of the module config descriptors. First of all, all of the available modules are retrieved
 * and modules that don't have a configuration file in the config directory are filtered out. Every file
 * in the /config directory of a module is read and will be added to the globally cached schema object.
 * It's assumed that the files contains valid JSON. If multiple configuration files exist in one module
 * they will be merged together
 *
 * @param  {Function}   callback    Standard callback function
 * @api private
 */
const _cacheSchema = function(callback) {
  // Get the available module
  const modules = Modules.getAvailableModules();
  const toDo = modules.length;
  let done = 0;
  let complete = false;

  /*!
   * Get the configuration files for a given module and create the schema for global and tenant administrators
   * when all configuration files have been loaded
   *
   * @param  {String}     module      The module we're getting the configuration for. e.g., `oae-principals`
   */
  const getModuleSchema = function(module) {
    const dir = OaeUtil.getNodeModulesDir() + module + '/config/';
    // Get a list of the available config files
    IO.getFileListForFolder(dir, (err, configFiles) => {
      if (complete) {
        return;
      }

      if (err) {
        complete = true;
        return callback(err);
      }

      // Require all of them
      for (const element of configFiles) {
        const configFile = require(module + '/config/' + element);
        cachedGlobalSchema[module] = _.extend(cachedGlobalSchema[module] || {}, configFile);
      }

      done++;
      if (done === toDo) {
        // Clone the cached global schema and filter out elements that are only visible to the global admin users
        cachedTenantSchema = clone(cachedGlobalSchema);
        // Loop over all modules
        _.each(cachedTenantSchema, (mod, moduleKey) => {
          // Loop over all features per module
          _.each(mod, (feature, featureKey) => {
            // Loop over all elements per feature
            _.each(feature.elements, (element, elementKey) => {
              // If the value is only visible to global admins remove it from the object
              if (element.globalAdminOnly) {
                delete cachedTenantSchema[moduleKey][featureKey].elements[elementKey];
              }
            });
          });
        });

        complete = true;
        return callback();
      }
    });
  };

  for (const element of modules) {
    getModuleSchema(element);
  }
};

/**
 * Cache the config values for the global admin and all of the available tenants. For each of them, this will take the
 * config schema and its default values, overlay it with the value set on the global admin and then overlay it with the
 * value set for that tenant
 *
 * @param  {Function}   [callback]      Standard callback function
 * @param  {Object}     [callback.err]  An error that occurred, if any
 * @api private
 */
const _cacheAllTenantConfigs = function(callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err }, 'An error occured whilst caching all tenant configs');
      }
    };

  // Indicate that config values are about to be re-cached
  eventEmitter.emit('preCache');

  _getAllPersistentTenantConfigs((err, persistentConfigsByTenantAlias) => {
    if (err) {
      return callback(err);
    }

    cachedTenantConfigValues = persistentConfigsByTenantAlias;

    // Indicate that all the config values are re-cached
    eventEmitter.emit('cached');
    return callback();
  });
};

/**
 * Get all the tenant configurations in the database, bypassing any tenant configuration cache we
 * have available
 *
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.tenantConfigs  An object keyed by tenant alias, whose value is a key value pair of `configKey->value` for each stored configuration value for the tenant
 */
const _getAllPersistentTenantConfigs = function(callback) {
  Cassandra.runAutoPagedQuery(
    'SELECT "tenantAlias", "configKey", "value", WRITETIME("value") FROM "Config"',
    null,
    (err, rows) => {
      if (err) {
        return callback(err);
      }

      return callback(null, _rowsToConfig(rows));
    }
  );
};

/**
 * Get the tenant configuration in the database, bypassing any tenant configuration cache we have
 * available
 *
 * @param  {String}     alias                   The tenant alias for the tenant whose config to get
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.tenantConfig   An object keyed by configKey whose value is the value set for the tenant
 */
const _getPersistentTenantConfig = function(alias, callback) {
  Cassandra.runQuery(
    'SELECT "tenantAlias", "configKey", "value", WRITETIME("value") FROM "Config" WHERE "tenantAlias" = ?',
    [alias],
    (err, rows) => {
      if (err) {
        return callback(err);
      }

      return callback(null, _rowsToConfig(rows)[alias] || {});
    }
  );
};

/**
 * Given an array of "Config" table rows, index them by tenant alias and deserialize their values
 * according to the config element type
 *
 * @param  {Row[]}  rows    The "Config" table rows to process
 * @return {Object}         An object keyed by tenant alias, whose value is a key value pair of `configKey->value` for each stored configuration value for the tenant
 * @api private
 */
const _rowsToConfig = function(rows) {
  const persistentConfig = {};

  _.each(rows, row => {
    const hash = Cassandra.rowToHash(row);
    const key = hash.configKey;
    let { value } = hash;
    const timestamp = new Date(Math.floor(hash['writetime(value)'] / 1000));

    if (_.isString(value)) {
      const parsedKey = _parseColumnKey(key);
      const element = _element(parsedKey.module, parsedKey.feature, parsedKey.element);

      // If we have stray config values in the database matching to elements that don't exist
      // anymore, simply ignore them
      if (element) {
        try {
          value = _deserializeConfigValue(element, hash.value);

          persistentConfig[hash.tenantAlias] = persistentConfig[hash.tenantAlias] || {};
          persistentConfig[hash.tenantAlias][key] = {
            value,
            timestamp
          };
        } catch (error) {
          log().error({ err: error, key, value }, 'Failed to parse configuration value from database');
        }
      }
    }
  });

  return persistentConfig;
};

/**
 * Deserialize the given value according to the element that represents it
 *
 * @param  {Field}      element     The element for which the value is set
 * @param  {String}     value       The storage value to be deserialized
 * @return {Object}                 The deserialized result, depending on the element type
 * @api private
 */
const _deserializeConfigValue = function(element, value) {
  // If the value starts with a `{` it's probably an element that has optional keys. So we
  // convert it to an object
  if (value[0] === '{') {
    try {
      value = JSON.parse(value);
    } catch {
      // It's perfectly possible that a value started with a `{` that doesn't use the
      // optional keys
    }
  }

  // Deserialize the value using the schema element
  if (_.isObject(value)) {
    _.each(value, (val, optionalKey) => {
      value[optionalKey] = element.deserialize(val);
    });
  } else {
    value = element.deserialize(value);
  }

  return value;
};

/// //////////////////////
// Update config value //
/// //////////////////////

/**
 * Determine if the current user is allowed to update the configuration value. This effectively enforces
 * the following rules:
 *
 *  * A tenant administrator cannot update a configuration value whose `tenantOverride` property is set to `true`; and
 *  * A tenant administrator cannot update a configuration value whose `globalAdminOnly` property is set to `true`
 *
 * This method does not ensure that the current context is a tenant administrator. That should be done in prior
 * validation logic.
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     tenantAlias     The alias of the tenant on which to update the configuration value
 * @param  {String}     moduleId        The ID of the configuration module the user wants to update a value of
 * @param  {String}     feature         The ID of the feature the user wants to update a value of
 * @param  {String}     element         The ID of the element the user wants to update a value of
 * @return {Boolean}                    Returns `true` if the user is allowed to update the configuration value, `false` if not allowed
 * @api private
 */
const _canUpdateConfigValue = function(ctx, tenantAlias, moduleId, feature, element) {
  const configElement = _element(moduleId, feature, element);
  if (!configElement) {
    return false;
  }

  // If `tenantOverride=false` is specified and the user is a tenant administrator only,
  // the tenant administrator is not allowed to change the configuration option
  if (!configElement.tenantOverride && !ctx.user().isGlobalAdmin()) {
    return false;
  }

  // If `globalAdminOnly` is specified and the user is a not a global admin, the user
  // is not allowed to change the configuration option
  if (configElement.globalAdminOnly && !ctx.user().isGlobalAdmin()) {
    return false;
  }

  return true;
};

/**
 * Update a configuration value for a particular tenant
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     tenantAlias     The alias of the tenant on which to update the configuration value
 * @param  {Object}     configValues    The configuration to store. The keys represent the `module/feature/element/[optionalKey]` combination and the values represent their new config value
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const updateConfig = function(ctx, tenantAlias, configValues, callback) {
  if (!ctx.user() || !ctx.user().isAdmin(tenantAlias)) {
    return callback({ code: 401, msg: 'Only authorized tenant admins can change config values' });
  }

  const configFieldNames = _.keys(configValues);

  try {
    pipe(
      validator.isNotEmpty,
      validator.generateError({
        code: 400,
        msg: 'Missing tenantid'
      })
    )(tenantAlias);

    pipe(
      validator.isArrayNotEmpty,
      validator.generateError({
        code: 400,
        msg: 'Missing configuration. Example configuration: {"oae-authentication/twitter/enabled": false}'
      })
    )(configFieldNames);
  } catch (error) {
    return callback(error);
  }

  // Since we can return out of this loop, we use `for` instead of `_.each`
  for (const configFieldName of configFieldNames) {
    const configFieldValue = configValues[configFieldName];

    try {
      pipe(
        validator.isDefined,
        validator.generateError({
          code: 400,
          msg: util.format('The configuration value for "%s" must be specified', configFieldName)
        })
      )(configFieldValue);
    } catch (error) {
      return callback(error);
    }

    const parts = configFieldName.split('/');
    if (!_element(parts[0], parts[1], parts[2])) {
      return callback({
        code: 404,
        msg: util.format('Config key "%s" does not exist', configFieldName)
      });
    }

    if (!_canUpdateConfigValue(ctx, tenantAlias, parts[0], parts[1], parts[2])) {
      return callback({
        code: 401,
        msg: util.format('User is not allowed to update config value "%s"', configFieldName)
      });
    }
  }

  // Aggregate the values into module/feature/element column keys
  const aggregatedValues = {};
  _.each(configValues, (value, key) => {
    // A key looks like module/feature/element/optionalKey
    const parts = key.split('/');
    const module = parts[0];
    const feature = parts[1];
    const element = parts[2];
    const optionalKey = parts[3];

    // Trim all string values that are input into the API
    if (_.isString(value)) {
      value = value.trim();
    }

    const storageKey = _generateColumnKey(module, feature, element);
    if (optionalKey) {
      const currentConfigValue = _resolveConfigValueInfo(tenantAlias, module, feature, element).value;

      // If we specified an optional key, we're only partially updating an element's value
      // We need to merge it with the existing value
      aggregatedValues[storageKey] = aggregatedValues[storageKey] || _.extend({}, currentConfigValue) || {};
      aggregatedValues[storageKey][optionalKey] = value;
    } else {
      aggregatedValues[storageKey] = value;
    }
  });

  // Gather all the queries needed to update the config for a batch query
  const queries = [];
  _.each(aggregatedValues, (value, key) => {
    if (_.isObject(value)) {
      value = JSON.stringify(value);
    }

    queries.push({
      query: 'UPDATE "Config" SET "value" = ? WHERE "tenantAlias" = ? AND "configKey" = ?',
      parameters: [value, tenantAlias, key]
    });
  });

  // Indicate that configuration is about to be updated
  eventEmitter.emit('preUpdate', tenantAlias);

  // Perform all the config field updates
  Cassandra.runBatchQuery(queries, err => {
    if (err) {
      return callback(err);
    }

    Pubsub.publish('oae-config', tenantAlias);
    return callback();
  });
};

/**
 * Clear a configuration value so that it is no longer set, reverting it back to the default
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     tenantAlias     The alias of the tenant on which the configuration value should be cleared
 * @param  {String[]}   configFields    An array of config elements whose values should be cleared in the form `oae-authentication/twitter/enabled`
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const clearConfig = function(ctx, tenantAlias, configFields, callback) {
  if (!ctx.user() || !ctx.user().isAdmin(tenantAlias)) {
    return callback({ code: 401, msg: 'Only authorized tenant admins can change config values' });
  }

  try {
    pipe(
      validator.isNotEmpty,
      validator.generateError({
        code: 400,
        msg: 'Missing tenant alias'
      })
    )(tenantAlias);

    pipe(
      validator.isArrayNotEmpty,
      validator.generateError({
        code: 400,
        msg: 'Missing configuration. Example configuration: ["oae-authentication/twitter/enabled"]'
      })
    )(configFields);
  } catch (error) {
    return callback(error);
  }

  // Sort the config fields alphabetically so we can do the mixed element/optionalKey check
  configFields = configFields.sort();
  for (let i = 0; i < configFields.length; i++) {
    // Check that we're not clearing both the entire element and one if its optional keys
    if (i > 0) {
      try {
        pipe(
          validator.isDifferent,
          validator.generateError({
            code: 400,
            msg: 'You cannot mix clearing an entire element and an optionalKey'
          })
        )(configFields[i].indexOf(configFields[i - 1] + '/'), '0');
      } catch (error) {
        return callback(error);
      }
    }

    const configField = configFields[i].split('/');
    if (!_element(configField[0], configField[1], configField[2])) {
      return callback({
        code: 404,
        msg: util.format('Config value "%s" does not exist', configFields[i])
      });
    }

    if (!_canUpdateConfigValue(ctx, tenantAlias, configField[0], configField[1], configField[2])) {
      return callback({
        code: 401,
        msg: util.format('User is not allowed to update config value "%s"', configFields[i])
      });
    }
  }

  // Keep track of what changes that should happen to the row
  const rowChanges = {};
  _.each(configFields, key => {
    const parts = key.split('/');
    const module = parts[0];
    const feature = parts[1];
    const element = parts[2];
    const optionalKey = parts[3];

    const columnKey = _generateColumnKey(module, feature, element);

    // If no optional key was specified, we can delete the entire column

    if (optionalKey) {
      const currentConfigValue = _resolveConfigValueInfo(tenantAlias, module, feature, element).value;

      // It's possible we've already deleted an optional key within this element
      const value = rowChanges[columnKey] || _.extend({}, currentConfigValue);

      // Delete the key
      if (value[optionalKey]) {
        delete value[optionalKey];
      }

      // Keep track of the new value for this element, as the next configField might be an optional key for this element
      rowChanges[columnKey] = value;
    } else {
      rowChanges[columnKey] = false;

      // If we're clearing an optional key, we need to delete that key from the hash and store the updated value
    }
  });

  const queries = _.map(rowChanges, (value, columnName) => {
    if (!value) {
      return {
        query: 'DELETE FROM "Config" WHERE "tenantAlias" = ? AND "configKey" = ?',
        parameters: [tenantAlias, columnName]
      };
    }

    if (_.isObject(value)) {
      value = JSON.stringify(value);
    }

    return {
      query: 'UPDATE "Config" SET "value" = ? WHERE "tenantAlias" = ? AND "configKey" = ?',
      parameters: [value, tenantAlias, columnName]
    };
  });

  // Indicate that config values are about to be cleared
  eventEmitter.emit('preClear', tenantAlias);

  Cassandra.runBatchQuery(queries, err => {
    if (err) {
      return callback(err);
    }

    Pubsub.publish('oae-config', tenantAlias);
    return callback();
  });
};

/**
 * Get the config element, if specified
 *
 * @param  {String}     moduleId    The ID of the configuration module to check
 * @param  {String}     feature     The ID of the feature to check
 * @param  {String}     element     The ID of the element to check
 * @return {Boolean}                Returns `true` if the configuration element exists, `false` otherwise
 * @api private
 */
const _element = function(moduleId, feature, element) {
  return (
    cachedGlobalSchema[moduleId] &&
    cachedGlobalSchema[moduleId][feature] &&
    cachedGlobalSchema[moduleId][feature].elements &&
    cachedGlobalSchema[moduleId][feature].elements[element]
  );
};

/**
 * Generate a string that can be used as a column name using the given `module`, `feature` and `element` names
 *
 * @param  {String}     module      The name of the module. e.g., `oae-authentication`
 * @param  {String}     feature     The feature to get the element's column name for. e.g., `twitter`
 * @param  {String}     element     The element to get the column name for. e.g., `enabled`
 * @return {String}                 A string that can be used as a column name to store a value for this element in Cassandra
 * @api private
 */
const _generateColumnKey = function(module, feature, element) {
  return util.format('%s/%s/%s', module, feature, element);
};

/**
 * Parse the given column key (e.g., `oae-module/feature/element`) into an object separating the
 * 3 parts of the key.
 *
 * This is the inverse of `_generateColumnKey`
 *
 * @param  {String}     columnKey       The config column key
 * @return {Object}     parsed          The object representing the config key parts
 * @return {String}     parsed.module   The id of the module
 * @return {String}     parsed.feature  The id of the feature
 * @return {String}     parsed.element  The id of the element
 * @api private
 */
const _parseColumnKey = function(columnKey) {
  const split = columnKey.split('/');
  return {
    module: split[0],
    feature: split[1],
    element: split[2]
  };
};

export {
  eventEmitter,
  setUpConfig,
  getSchema,
  getTenantConfig,
  initConfig,
  updateTenantConfig,
  updateConfig,
  clearConfig
};
