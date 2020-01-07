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

import fs from 'fs';
import path from 'path';
import util from 'util';
import _ from 'underscore';
import $ from 'cheerio';

import Globalize from 'globalize';
import less from 'less';
import marked from 'marked';
import pipe from 'ramda/src/pipe';
import PropertiesParser from 'properties-parser';
import readdirp from 'readdirp';
import watch from 'watch';

import * as ConfigAPI from 'oae-config';

import * as ContentUtil from 'oae-content/lib/internal/util';
import * as EmitterAPI from 'oae-emitter';
import * as Sanitization from 'oae-util/lib/sanitization';
import * as TZ from 'oae-util/lib/tz';
import { Validator as validator } from 'oae-util/lib/validator';
import { logger } from 'oae-logger';

import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { UIConstants } from './constants';

const log = logger('oae-ui');

// The Config object for the UI module.
const uiConfig = ConfigAPI.setUpConfig('oae-ui');

// The cached skin variables
let cachedSkinVariables = null;
// The cached skins per tenant.
let cachedSkins = {};

// Path to the 3akai-ux repository
let uiDirectory = null;

// A mapping object that maps pre-optimized paths to post-optimized paths in the UI
let hashes = null;

// A dictionary that will hold the content for each file. This will be lazy filled. The first
// time a particular file is requested, it will be cached. After that, the cached version will
// be used
const staticFileCache = {};

// A dictionary that will hold the widget manifests for all widgets. This will be filled upon
// initialization.
let widgetManifestCache = {};

// A dictionary that will hold all the i18n keys keyed by their locale
const i18nKeys = {};

/**
 * The UI API.
 *
 * ## Events
 *
 * * `skinParsed` - Invoked when the skin file has been parsed or re-parsed on the application node.
 */
const UIAPI = new EmitterAPI.EventEmitter();
const emitter = UIAPI;

/// /////////////////
// Initialization //
/// /////////////////

/**
 * This will find all of the widget config files in the UI repository and cache. For development,
 * it will also put watches on the files in the UI repository in order to invalidate the cache
 * when a file has been changed/removed.
 *
 * @param  {String}     uiDirectory     The path to the directory containing the UI repository.
 * @param  {Object}     hashes          A mapping that will map pre-optimized paths to hashed, post-optimized static asset paths
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const init = function(_uiDirectory, _hashes, callback) {
  // Cache the ui directory path and make sure we have the absolute path
  uiDirectory = _uiDirectory;
  hashes = _hashes;

  // Load all the globalize cultures
  // eslint-disable-next-line no-unused-vars
  const globalize = require('globalize/lib/cultures/globalize.cultures');

  // Cache all of the widget manifest files
  cacheWidgetManifests(() => {
    // Monitor the UI repository for changes and refresh the cache.
    // This will only be done in development mode
    if (process.env.NODE_ENV !== 'production') {
      watch.createMonitor(uiDirectory, { ignoreDotFiles: true }, monitor => {
        monitor.on('created', updateFileCaches);
        monitor.on('changed', updateFileCaches);
        monitor.on('removed', updateFileCaches);
      });
    }

    // Cache the base skin file
    _cacheSkinVariables(err => {
      if (err) {
        return callback(err);
      }

      // Ensure the skins are not cached, as they may be invalid now
      cachedSkins = {};

      // Cache the i18n bundles
      return _cacheI18nKeys(callback);
    });
  });
};

ConfigAPI.eventEmitter.on('update', tenantAlias => {
  // Re-generate the skin.
  // Don't delete it from the cache just yet as we might still be serving requests.
  _generateSkin(tenantAlias, err => {
    if (err) {
      log().error({ err, tenantAlias }, 'Could not re-cache the tenant skin after a config update.');
    }

    emitter.emit('skinParsed');
  });
});

/// //////////
// Caching //
/// //////////

/**
 * When a file in the UI repository has changed, we update the static file cache by deleting
 * the record for that file if there is one. The next time the updated/created file will be
 * re-requested, caching will be attempted again. We also check if the changed file is a
 * widget manifest file, and refresh the widget manifest cache if that's the case
 *
 * @param  {String}     filename        The absolute path to the file that has been added/updated/deleted
 * @api private
 */
const updateFileCaches = function(filename) {
  filename = filename.replace(uiDirectory, '');
  // Delete the file from the static file cache, for it to be re-cached when it is requested again
  delete staticFileCache[filename];

  // If the changed file is a widget config file, we re-cache the widget config files
  if (/^\/packages\/(.*?)\/manifest.json$/.test(filename)) {
    cacheWidgetManifests();

    // If the changed file is the base skin file, we re-cache it
  } else if (filename === UIConstants.paths.BASE_SKIN) {
    // The skin file has changed, reset the skin files, they will be lazy loaded
    cachedSkins = {};

    // Retrieve the skin variables.
    _cacheSkinVariables(err => {
      if (err) {
        log().error({ err }, 'Could not cache the skin variables after a file update.');
      }
    });

    // If the changed file is a bundle file, we re-cache it
  } else if (/.*\.properties$/.test(filename)) {
    _cacheBundleFile(filename);
  }
};

/// ////////////////////////////
// Widget config aggregation //
/// ////////////////////////////

/**
 * Get the aggregated list of widget manifests
 *
 * @return {Object}     An object where each key is the widget id and the value is the widget manifest
 */
const getWidgetManifests = function() {
  return widgetManifestCache;
};

/**
 * Cache all widget manifests under the UI's packages directory
 *
 * @api private
 */
const cacheWidgetManifests = function(done) {
  widgetManifestCache = {};

  readdirp(
    // Cache all of the widget config files under packages
    path.join(uiDirectory, 'packages'),
    {
      // Only recurse in folders that contain widgets
      directoryFilter: _widgetDirectoryFilter,

      // We're only interested in the manifest files
      fileFilter: 'manifest.json'
    }
  )
    .on('data', entry => {
      // Extract the widget id from the path
      const widgetId = entry.path
        .split(path.sep)
        .splice(1, 1)
        .join();
      const parentDir = entry.path
        .split(path.sep)
        .splice(0, 2)
        .join(path.sep);

      try {
        const widgetManifest = fs.readFileSync(entry.fullPath, 'utf8');
        widgetManifestCache[widgetId] = JSON.parse(widgetManifest);
      } catch (error) {
        widgetManifestCache[widgetId] = {};
        log().error({ err: error, widgetId, path: entry.fullPath }, 'Could not parse the widget manifest file');
      }

      widgetManifestCache[widgetId].id = widgetId;
      widgetManifestCache[widgetId].path = parentDir + '/';
    })
    .on('warn', err => {
      log().warn({ err }, 'A non-fatal error occured whilst caching a widget manifest');
    })
    .on('error', err => {
      log().error({ err }, 'A fatal error occured whilst caching a widget manifest');
    })
    .on('end', done);
};

/**
 * Filter for the `readdirp` module that filters directories
 * to those directories that are within a valid widget tree
 *
 * @param  {Entry}      entry   A `readdirp` entry object
 * @return {Boolean}            `true` if `readdirp` should further recurse into the directory, `false` otherwise
 * @api private
 */
const _widgetDirectoryFilter = function(entry) {
  return entry.fullPath.includes('/packages/oae-');
};

/// ///////////////
// Static batch //
/// ///////////////

/**
 * Get the content of a set of static files. The returned data is an object where the key is the requested URL and
 * the values are the static file contents. In case the file couldn't be found, null will be returned.
 *
 * @param  {String[]}    files           An array of file paths relative to the UI repository
 * @param  {Function}    callback        Standard callback function
 * @param  {Object}      callback.err    An error that occurred, if any
 * @param  {Object}      callback.data   JSON Object representing the retrieved files
 */
const getStaticBatch = function(files, callback) {
  pipe(
    validator.isArray,
    validator.generateError({
      code: 400,
      msg: 'The files parameter must be an array'
    }),
    validator.finalize(callback)
  )(files);

  // Filter out the duplicate ones
  files = _.uniq(files);
  // Make sure that all provided filenames are real strings
  for (const element of files) {
    pipe(
      validator.isNotEmpty,
      validator.generateError({
        code: 400,
        msg: 'A valid file path needs to be provided'
      }),
      validator.finalize(callback)
    )(element);
    // Make sure that only absolute paths are allowed. All paths that contain a '../' have the potential of
    // exposing private server files
    pipe(
      validator.notContains,
      validator.generateError({
        code: 400,
        msg: 'Only absolute paths are allowed'
      }),
      validator.finalize(callback)
    )(element, '../');
  }

  validator.check(files.length, { code: 400, msg: 'At least one file must be provided' }).min(1);
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  const results = {};
  files.forEach(file => {
    getStaticFile(file, (err, data) => {
      if (err) {
        results[file] = null;
      } else {
        results[file] = data;
      }

      // Check if all of them have returned
      if (_.keys(results).length === files.length) {
        callback(null, results);
      }
    });
  });
};

/**
 * Get the content of a static file and cache it if it hasn't been cached yet. This will only
 * open the file on disk if the file could not be found in the cache.
 *
 * @param  {String}      path            The path for the static file to open. A path should be relative to the UI repository
 * @param  {Function}    callback        Standard callback function
 * @param  {Object}      callback.err    An error that occurred, if any
 * @param  {String}      callback.data   The file content for the requested file
 */
const getStaticFile = function(path, callback) {
  // Try to retrieve the file content from cache
  if (staticFileCache[path]) {
    callback(null, staticFileCache[path]);
  } else {
    cacheFile(path, callback);
  }
};

/**
 * Reads a file's content and cache it.
 *
 * @param  {String}      path                The path for the file that needs to be read
 * @param  {Function}    callback            Standard callback function
 * @param  {Object}      callback.err        An error that occurred, if any
 * @param  {String}      callback.data       The data that sits in the file.
 * @api private
 */
const cacheFile = function(path, callback) {
  fs.readFile(uiDirectory + path, 'utf8', (err, data) => {
    if (err) {
      return callback(err);
    }

    // Cache the file content
    staticFileCache[path] = data;
    callback(null, data);
  });
};

/// ///////////
// SKINNING //
/// ///////////

/**
 * Sorts an array of sections, containing subsubsections, to reflect the order in which they appear in the less file.
 * It also removes the `index` property from each section and its subsections.
 *
 * @param  {Section[]}  The array of sections that should be sorted.
 * @return {Section[]}  The sorted array of sections as they appear in the less file.
 * @api private
 */
const sortSections = function(sections) {
  /*!
   * A comparator that can be used to sort an array of sections or subsections.
   *
   * @param  {Section}    sectionA    First section to compare.
   * @param  {Section}    sectionB    Second section to compare.
   * @return {Number}                 An integer that expresses the relative order of the passed in sections.
   */
  const comparator = function(sectionA, sectionB) {
    return sectionA.index - sectionB.index;
  };

  // Sort the top level sections.
  sections.sort(comparator);

  // Give all of the subsections the same order as the one they have in the LESS file.
  _.each(sections, section => {
    section.subsections = _.values(section.subsections).sort(comparator);

    // Remove the unneeded index property of each section.
    delete section.index;
    // Remove the unneeded index property of each subsection
    _.each(section.subsections, subsection => {
      delete subsection.index;
    });
  });
  return sections;
};

/**
 * Get the skin for the current tenant
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.css    The generated CSS
 */
const getSkin = function(ctx, callback) {
  const tenantAlias = ctx.tenant().alias;
  if (cachedSkins[tenantAlias]) {
    return callback(null, cachedSkins[tenantAlias]);
  }

  _generateSkin(tenantAlias, callback);
};

/**
 * Get the logo URL for the current tenant
 *
 * @param  {Context}  ctx            Standard context object containing the current user and the current tenant
 * @param  {Function} callback       Standard callback function
 * @param  {Object}   callback.err   An error that occurred, if any
 * @param  {String}   callback.logo  The generated URL String
 */
const getLogo = function(ctx, callback) {
  // Get all the default variables in the skin, as well as the tenant overrides
  const tenantAlias = ctx.tenant().alias;
  const allVariables = getTenantSkinVariables(tenantAlias);

  let logo = allVariables['institutional-logo-url'];
  logo = logo.slice(1, logo.length - 1);
  return callback(null, logo);
};

/**
 * Get the LESS variables that are present in the tenant skin.
 * Each variable will be annotated with the tenant value
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     [tenantAlias]       The optional alias of the tenant for which the variables should be retrieved. If no tenant alias is provided, the current tenant will be used
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Object[]}   callback.variables  The LESS skin variables for the tenant skin
 */
const getSkinVariables = function(ctx, tenantAlias, callback) {
  tenantAlias = tenantAlias || ctx.tenant().alias;

  if (!ctx.user() || !ctx.user().isAdmin(tenantAlias)) {
    return callback({ code: 401, msg: 'Only administrators can retrieve the skin variables' });
  }

  const applyTenantValues = function(err, skinVariables) {
    if (err) {
      return callback(err);
    }

    // Get the values for this tenant.
    const tenantVariables = _getTenantSkinVariableValues(tenantAlias);

    // Extend the skin variables into a new object, so we don't overwrite the global object.
    const variables = _.extend({}, skinVariables);

    // Add in the value.
    _.each(tenantVariables, (value, key) => {
      if (key && variables[key]) {
        variables[key].value = value;
      }
    });

    /*!
     * Morph it to a structure that the UI can use.
     *
     * We'll return an array of sections, which are defined in the LESS file through `@section`.
     * Each section can have a number of subsections, used to subdivide variables inside of a given
     * section.
     *
     * By default, each section will have a `main` subsection that contains all of the variables
     * that are not part of a specific subsection. This will be followed by all of the other subsections,
     * which are defined in the LESS file through @subsection.
     *
     * Each subsection will have one or more CSS variables that will be used for skinning through
     * the Admin UI.
     *
     * ex:
     *   [
     *      {
     *          'name': 'Section name A',
     *          'subsections': [
     *              {
     *                  'name': 'main',
     *                  'variables': [ <var A_V1>, <var A_V2>, ... ]
     *              },
     *              {
     *                  'name': <subsection A_S1>,
     *                  'variables': [ <var A_V3>, <var a_V4>, ... ]
     *              },
     *              ...
     *          ]
     *      },
     *      ...
     *   ]
     */
    let sections = {};
    // eslint-disable-next-line no-unused-vars
    _.each(variables, (variable, name) => {
      // Make sure that the section exists
      sections[variable.section.name] = sections[variable.section.name] || {
        name: variable.section.name,
        index: variable.section.index,
        subsections: {}
      };
      // Make sure that the subsection exists
      const section = sections[variable.section.name];
      section.subsections[variable.subsection.name] = section.subsections[variable.subsection.name] || {
        name: variable.subsection.name,
        index: variable.subsection.index,
        variables: []
      };
      // Add the variable to subsection's list of variables
      section.subsections[variable.subsection.name].variables.push(variable);
    });

    // Give the section the the same order as the one it has in the LESS file.
    sections = sortSections(_.values(sections));

    callback(null, sections);
  };

  if (cachedSkinVariables) {
    applyTenantValues(null, cachedSkinVariables);
  } else {
    _cacheSkinVariables(applyTenantValues);
  }
};

/**
 * Get the configured UI directory path
 *
 * @return {String}                     The configured UI directory path
 */
const getUIDirectory = function() {
  return uiDirectory;
};

/**
 * Generates the skin file for a tenant.
 *
 * @param  {String}     tenantAlias     The alias of the tenant for which the skin should be generated.
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.css    The generated CSS.
 * @api private
 */
const _generateSkin = function(tenantAlias, callback) {
  // Get all the default variables in the skin, as well as the tenant overrides
  const allVariables = getTenantSkinVariables(tenantAlias);

  // Parse the less file and supply the tenant values.
  _parseLessFile(allVariables, (err, tree) => {
    if (err) {
      return callback(err);
    }

    // Generate some CSS from the parse tree and cache it.
    // See http://lesscss.org/#usage (Configuration) for more information.
    try {
      cachedSkins[tenantAlias] = tree.toCSS({
        cleancss: true,
        compress: true
      });
    } catch (error) {
      return callback({ code: 500, msg: error.message });
    }

    callback(null, cachedSkins[tenantAlias]);
  });
};

/**
 * Parses a LESS file and return the syntax tree.
 * You can pass in variables with some values that will override any values in the less file.
 * This can be used to set the tenant values and generate a parse tree for a tenant's skin file.
 *
 * @param  {Object}   [variables]       Object where the key is the LESS variable name (without the '@') and the value is the corresponding CSS value.
 * @param  {Object}   callback.err      An error that occurred, if any
 * @param  {Object}   callback.tree     The CSS syntax tree.
 * @api private
 */
const _parseLessFile = function(variables, callback) {
  variables = variables || {};

  // Read the skin file.
  getStaticFile(UIConstants.paths.BASE_SKIN, (err, skin) => {
    if (err) {
      log().error({ err }, 'Could not read the skin file.');
      return callback(err);
    }

    variables = _replaceOptimizedPaths(variables);

    // Overwrite the default values.
    _.each(variables, (value, key) => {
      const re = new RegExp('^(@' + key + '): (.*);$', 'm');
      skin = skin.replace(re, '$1: ' + value + ';');
    });

    // Parse the less file.
    // eslint-disable-next-line new-cap
    const parser = less.Parser({});
    parser.parse(skin, (err, tree) => {
      if (err) {
        log().error({ err }, 'Could not parse the skin file.');
        return callback({ code: 500, msg: err });
      }

      callback(null, tree);
    });
  });
};

/**
 * Parses the skin file and retrieves the annotated LESS variables.
 *
 * @param  {Function}   callback              Standard callback function
 * @param  {Object}     callback.err          An error that occurred, if any
 * @param  {String}     callback.variables    The generated CSS.
 * @api private
 */
const _cacheSkinVariables = function(callback) {
  _parseLessFile(null, (err, tree) => {
    if (err) {
      return callback(err);
    }

    const variables = {};

    /*!
     * Get all the variables out of the skin file.
     * Unfortunately we can't use tree.variables() as that doesn't give us the section and subsection names..
     * We loop over each rule in the less file and apply the following checks
     *
     *   1.  Is this rule a section declaration?
     *
     *       Sections are used to logically group skinning variables.
     *       Sections are defined in the following way:
     *
     *       \/************************
     *         ** @section  Branding **
     *         ************************\/
     *
     *   2.  Is this rule a subsection declaration?
     *
     *       Subsections are used to created logical skinning variable groups inside of
     *       a section. Subsections are defined in the following way:
     *
     *       \/* @subsection  Link colors *\/
     *
     *   3.  Is this rule a variable comment?
     *
     *       Variable comments are rules that come right above a variable declaration.
     *       These are used to give each variable a description.
     *
     *   4.  Is this rule a variable declaration?
     *
     *       Variables that can be re-used troughout the skin.
     *       The 'type' of the variable will be determined by looking at the suffix of the variable name.
     *
     *       Looks like:
     *       \/* The background color for the body *\/    --> variable comment
     *       @body-background-color: #ECEAE5;           --> variable declaration, the variable is of type 'color'.
     */

    let section = 'Default';
    let subsection = 'main';

    const sections = [];
    let subsections = [];

    const sectionRegex = '[*] [@]section[ ]+([^*]+) [*]';
    const subsectionRegex = '[*] [@]subsection[ ]+([^*]+) [*]';

    for (let i = 0; i < tree.rules.length; i++) {
      const rule = tree.rules[i];
      let sectionMatch = null;
      let subsectionMatch = null;

      // Section declaration
      if (rule.value && typeof rule.value === 'string' && (sectionMatch = rule.value.match(sectionRegex))) {
        // Get the name of this section.
        section = sectionMatch[1];
        sections.push(section);
        subsection = 'main';
        subsections = [subsection];

        // Subsection declaration
      } else if (
        rule.value &&
        typeof rule.value === 'string' &&
        (subsectionMatch = rule.value.match(subsectionRegex))
      ) {
        // Get the name of this subsection.
        subsection = subsectionMatch[1];
        subsections.push(subsection);

        // Variable declaration
      } else if (rule.variable === true) {
        // Each variable should have some CSS documentation on top of it
        // that explains what the variable does.
        // This should be defined in the previous rule.
        const docRule = tree.rules[i - 1];
        let description = 'TODO';
        if (docRule && docRule.value && typeof docRule.value === 'string' && docRule.value.slice(0, 2) === '/*') {
          description = docRule.value.replace('/* ', '').replace('*/', '');
        }

        // Strip out the '@' sign from the token to get the variable name.
        const name = rule.name.slice(1);

        // Less variables don't have any type.
        // We determine the type by looking at the suffix in the variable name.
        let type = UIConstants.variables.types.STRING;
        if (name.endsWith('-color')) {
          // If (/-color$/.test(name)) {
          type = UIConstants.variables.types.COLOR;
        }

        if (name.endsWith('-url')) {
          // If (/-url$/.test(name)) {
          type = UIConstants.variables.types.URL;
        }

        variables[name] = {
          name,
          defaultValue: rule.value.toCSS({}),
          description,
          type,
          section: {
            name: section,
            index: sections.indexOf(section)
          },
          subsection: {
            name: subsection,
            index: subsections.indexOf(subsection)
          }
        };
      }
    }

    // Cache the variables.
    cachedSkinVariables = variables;

    callback(null, variables);
  });
};

/**
 * Gets the skin variables for a given tenant.
 *
 * @param  {String}     tenantAlias     The alias of the tenant for which to retrieve the skin values
 * @return {Object}                     The skin values for the given tenant
 */
const getTenantSkinVariables = function(tenantAlias) {
  const defaultVariables = _getDefaultSkinVariableValues();
  const tenantVariables = _getTenantSkinVariableValues(tenantAlias);

  // Merge the default and tenant variables, tenant variables having precedence
  const resolvedVariables = _.extend({}, defaultVariables, tenantVariables);

  // Template the institutional logo url
  _renderDynamicValue(resolvedVariables, 'institutional-logo-url', tenantAlias);

  return resolvedVariables;
};

/**
 * Render the key of the specified object through underscore.js template, with
 * the given data. If the key does not exist on the object, then this function
 * will do nothing
 *
 * @param  {Object}     obj             The arbitrary object whose value to render
 * @param  {String}     key             The key of the specified object to replaced with a rendered version
 * @param  {String}     tenantAlias     The value to use to replace `${tenantAlias}` in the specified property
 * @api private
 */
const _renderDynamicValue = function(obj, key, tenantAlias) {
  const value = obj[key];
  if (_.isString(value)) {
    obj[key] = value.replace(/\$\{tenantAlias\}/g, tenantAlias);
  }
};

/**
 * Retrieves the CSS values that a tenant has specified he wishes to use in the skin.
 * If the tenant values could not be parsed an empty object will be returned.
 *
 * @param  {String} tenantAlias The alias of the tenant for which the values should be retrieved.
 * @return {Object}             The CSS values keyed by the LESS variable name (without the '@'.)
 * @api private
 */
const _getTenantSkinVariableValues = function(tenantAlias) {
  const variables = uiConfig.getValue(tenantAlias, 'skin', 'variables');
  if (!variables || !_.isObject(variables)) {
    return {};
  }

  return variables;
};

/**
 * Retrieves the default CSS values that are embedded in the skin template. If the skin has not been
 * parsed and cached yet, then this returns `null`.
 *
 * @return {Object}    A simple variableName->variableValue mapping of variables that are embedded in the skin file
 * @api private
 */
const _getDefaultSkinVariableValues = function() {
  if (!cachedSkinVariables) {
    return null;
  }

  const defaultVariableValues = {};
  _.each(cachedSkinVariables, (variableMetadata, variableName) => {
    defaultVariableValues[variableName] = variableMetadata.defaultValue;
  });

  return defaultVariableValues;
};

/**
 * Given an object mapping skin variables to values, replace URL values with static application paths that
 * may have been changed due to build optimization. For example, the static asset:
 *
 * `/shared/oae/img/logo.png`
 *
 * during a build optimization could be hashed, adding the hash of the file contents into the filename:
 *
 * `/shared/oae/img/logo.ac879d8f.png`
 *
 * The reason this is done is to ensure user caches are "busted" when the file changes, and allows "infinite"
 * length caching of the resources.
 *
 * So if a user specifies that they want their logo to be "/shared/oae/img/logo.png" in their skin variables,
 * this method needs to know how to map "/shared/oae/img/logo.png" to "/shared/oae/img/logo.ac879d8f.png". To
 * do this, there is a file `hashes.json` in the root directory of the optimized UI build that specifies a
 * JSON object that the optimizer step needs to generate, to identify what the "optimized" path of the file is.
 *
 * @path   {Object}    skinVariables   An object of variableName->variableValue of skin values that we should try and map to the optimized paths
 * @return {Object}                    An object of variableName->variableValue that contains the remapped URL variable values
 * @api private
 */
const _replaceOptimizedPaths = function(skinVariables) {
  const replacedVariables = _.extend({}, skinVariables);

  // If we have a path hashes mapping, we need to replace all URLs with those that have been optimized at build-time
  if (hashes) {
    const urlRegex = /'(.*)'/;
    _.each(skinVariables, (value, key) => {
      const variableMetadata = cachedSkinVariables[key];

      // Try to apply optimized paths if the variable is a valid URL
      if (variableMetadata && variableMetadata.type === UIConstants.variables.types.URL && urlRegex.test(value)) {
        // Strip out the enclosing quotes
        const url = value.replace(urlRegex, '$1').trim();
        if (hashes[url]) {
          // If an optimized mapping exists for this URL, replace it with the quotes
          replacedVariables[key] = util.format("'%s'", hashes[url]);
        }
      }
    });
  }

  return replacedVariables;
};

/**
 * Uploads a logo file for a tenant.
 *
 * @param  {Context}    ctx             Current request context
 * @param  {Object}     file            A file object as returned by express
 * @param  {String}     tenantAlias     The alias of the tenant for which to upload the logo
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.url    The signed URL for the new logo file
 */
const uploadLogoFile = function(ctx, file, tenantAlias, callback) {
  tenantAlias = tenantAlias || ctx.tenant().alias;
  if (!ctx.user() || !ctx.user().isAdmin(tenantAlias)) {
    return callback({ code: 401, msg: 'Only administrators can upload new logos for tenants' });
  }

  const extension = file.name.split('.').pop();
  if (!extension.match(/(gif|jpe?g|png)$/i)) {
    return callback({ code: 500, msg: 'File has an invalid mime type' });
  }

  const options = {
    prefix: util.format('logos/%s', tenantAlias)
  };
  ContentUtil.getStorageBackend(ctx).store(ctx.tenant().alias, file, options, (err, uri) => {
    if (err) {
      return callback(err);
    }

    const signedUrl = ContentUtil.getSignedDownloadUrl(ctx, uri, -1, -1);
    return callback(null, signedUrl);
  });
};

/// ///////
// I18N //
/// ///////

/**
 * Function that will translate a string by replacing all of the internationalization key by its translated value. This
 * original string can be a single internationalization key, or can contain multiple internationalization keys. Parts of
 * the string that are not internationalization keys will remain unchanged. Internationalization keys are identified by
 * the following format: `__MSG__KEY__`.
 *
 * The UI bundles are re-used to achieve the translation.
 *
 * @param  {String}     str             The string to translate
 * @param  {String}     [locale]        The locale into which the string should be translated. If no locale is provided, the `default` locale will be used
 * @param  {Object}     [variables]     Dynamic variables that should replace ${variable} placeholder in a translation. The replacements will happen based on the object keys
 * @return {String}                     The translated string
 */
const translate = function(str, locale, variables) {
  // Replace all __MSG__KEY__ instances with the appropriate translation
  return str.replace(/__MSG__(.*?)__/gm, (match, i18nkey) => {
    let translation = null;

    // If we have an i18nkey for that locale, we use it
    if (locale && i18nKeys[locale] && i18nKeys[locale][i18nkey]) {
      translation = i18nKeys[locale][i18nkey];

      // Otherwise we fall back to the `default` locale
    } else if (i18nKeys.default && i18nKeys.default[i18nkey]) {
      translation = i18nKeys.default[i18nkey];
    }

    // If the key could not be found, we return as is
    if (!translation) {
      return match;
    }

    // Replace all of the dynamic variables
    _.each(variables, (dynamicTranslation, dynamicVariable) => {
      const regex = new RegExp('\\$\\{' + dynamicVariable + '\\}', 'g');
      translation = translation.replace(regex, dynamicTranslation);
    });
    return translation;
  });
};

/**
 * Caches all the UI bundle files in-memory
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _cacheI18nKeys = function(callback) {
  _cacheI18nKeysInDirectory(
    '/shared/oae/bundles',
    entry => {
      return entry;
    },
    err => {
      if (err) return callback(err);

      return _cacheI18nKeysInDirectory('/packages', _widgetDirectoryFilter, callback);
    }
  );
};

/**
 * Caches all the bundle files in a ui directory in-memory
 *
 * @param  {String}     directory           The directory that contains the i18n bundles, relative to the UI root directory
 * @param  {Object}     directoryFilter     A filter to include or exclude directories that should be recursed in. See https://github.com/thlorenz/readdirp#filters for more information
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @api private
 */
const _cacheI18nKeysInDirectory = function(directory, directoryFilter, callback) {
  // Ensure that we don't call our callback twice
  const done = _.once(callback);

  // Get all the bundles in the UI directory tree
  readdirp(
    // Recurse through everything in the specified directory
    uiDirectory + directory,
    {
      // An optional directory filter
      directoryFilter,

      // We're only interested in the properties files
      fileFilter: '*.properties'
    }
  )
    .on('data', entry => {
      _cacheBundleFile(directory + '/' + entry.path, err => {
        if (err) {
          return done(err);
        }
      });
    })
    .on('warn', err => {
      log().warn({ err }, 'A non-fatal error occured whilst reading the i18n bundles');
    })
    .on('error', err => {
      log().error({ err }, 'A fatal error occured whilst reading the i18n bundles');
    })
    .on('end', done);
};

/**
 * Caches an i18n bundle
 *
 * @param  {String}     bundlePath      The path to the bundle file in the UI directory
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _cacheBundleFile = function(bundlePath, callback) {
  callback = callback || function() {};

  // The locale is defined as the string that comes before the extension
  const locale = path.basename(bundlePath, '.properties');

  // Get the bundle's file content
  getStaticFile(bundlePath, (err, data) => {
    if (err) {
      log().error({ err, path: bundlePath }, 'Could not read an i18n bundle');
      return callback({ code: 500, msg: 'Failed to read an i18n bundle file' });
    }

    // Parse the file and add the keys to the locale
    const keys = PropertiesParser.parse(data);
    i18nKeys[locale] = i18nKeys[locale] || {};
    i18nKeys[locale] = _.extend(i18nKeys[locale], keys);
    return callback();
  });
};

/// /////////////
// Templating //
/// /////////////

/**
 * Renders and translates a template
 *
 * @param  {String|Function}    template    The template to render. String-templates will be compiled through `compileTemplate`, function-templates are expected to have run through `compileTemplate` earlier
 * @param  {Object}             data        The data that should be passed into the template renderer
 * @param  {String}             locale      The locale that should be used to translate any i18n keys. Defaults to `en_US` if none is provided
 * @return {String}                         The rendered and translated template
 */
const renderTemplate = function(template, data, locale) {
  data = data || {};
  data.util = data.util || {};
  locale = locale || 'en_US';

  // Pass in some utility functions
  _.extend(data.util, {
    html: {
      /*!
       * @see Sanitization.encodeForHTML
       */
      encodeForHTML(str) {
        return Sanitization.encodeForHTML(str);
      },

      /*!
       * @see Sanitization.encodeForHTMLAttribute
       */
      encodeForHTMLAttribute(str) {
        return Sanitization.encodeForHTMLAttribute(str);
      },

      /*!
       * Returns the text for a given HTML string. If desired, links can be formatted in plain-text.
       * e.g.,
       *     <p>The <a href="/fox">quick brown fox</a> jumped over the <a href="/moon">moon</a>.
       * becomes
       *     The quick brown fox (/fox) jumped over the moon (/moon)
       *
       * @param  {String}     str             The HTML string to parse and extra text from
       * @param  {Boolean}    retainLinks     Set to `true` to convert links to a plain-text link.
       * @return {String}                     The extracted text
       */
      toText(str, retainLinks) {
        const html = $('<div>' + str + '</div>');
        if (retainLinks) {
          html.find('a').replaceWith(function() {
            const href = $(this).attr('href');
            const text = $(this).text();
            if (text && href && href !== '#') {
              return util.format('%s (%s)', text, href);
            }

            return $(this);
          });
        }

        // We need to wrap the string in a `div` element as plain-text would otherwise be lost
        return html.text();
      }
    },
    text: {
      /*!
       * Standard string trimming + strips out HTML comments
       *
       * @param  {String}     str     The string to trim
       * @return {String}             The trimmed string
       */
      trim(str) {
        str = str.replace(/<!--(?:.|\n)*?-->/gm, '');
        str = str.trim();
        return str;
      },

      /*!
       * Truncate a string and append three dots if the length of the string is longer
       * than `maxChars`. Before truncating, the string will be trimmed. If the given
       * string is not longer than `maxChars` characters, the string is returned as-is.
       *
       * @param  {String}     text        The text to truncate
       * @param  {Number}     maxChars    The maximum length of the string before cutting it off and appending three dots
       * @return {String}                 The truncated string
       */
      truncate(text, maxChars) {
        text = data.util.text.trim(text);
        if (text.length > maxChars) {
          text = text.slice(0, maxChars) + '...';
        }

        return text;
      },

      /*!
       * Given plain text content, convert it to an appropriate HTML string. Particularly:
       *
       *  * Escape all HTML characters so the content shows as it is in plain text; and
       *  * Convert all line-breaks to <br/> so that line breaks in the content are preserved
       *
       * @param  {String}     content     The plain-text content to convert to HTML
       * @return {String}                 The HTML version of the content
       */
      toHtml(str) {
        // First escape HTML
        const sanitized = Sanitization.encodeForHTML(str);

        // Honour the new-line characters in the plain text by converting to <br />
        return sanitized.replace(/&#xa;/g, '<br/>');
      },

      /**
       * Get a human readable mimeType description for a content item. Unrecognized mimeTypes
       * will default to the `other` type.
       *
       * @param  {String}     resourceSubType     The resource sub type for which to generate an appropriate description
       * @param  {String}     [mimeType]          In case the `resourceSubType` is a `file` a more detailed description can be returned by providing a mime type
       * @return {String}                         Human readable mimetype description for the provided resource subtype and mime type
       */
      getMimetypeDescription(resourceSubType, mimeType) {
        const descriptor = _getMimeTypeDescriptor();
        return descriptor.getDescription(resourceSubType, mimeType);
      }
    },

    markdown: {
      /*!
       * Convert markdown input into an HTML string
       *
       * @param  {String}     str         The markdown input to convert to HTML
       * @return {String}                 The converted HTML
       */
      toHtml(str) {
        const f = pipe(
          marked,
          marked => {
            const { window } = new JSDOM(marked);
            return { window, content: marked };
          },
          jsdom => {
            const DOMPurify = createDOMPurify(jsdom.window);
            return DOMPurify.sanitize(jsdom.content, { USE_PROFILES: { html: true } });
          }
        );

        return f(str, {
          gfm: true,
          breaks: true
        });
      }
    },

    json: {
      /*!
       * Makes a string safe to embed in a json value
       *
       * @param  {String}     str     The string to place in a json value
       * @return {String}             The safe string
       */
      escape(str) {
        if (!_.isString(str)) {
          return '';
        }

        return JSON.stringify(str).slice(1, -1);
      }
    },

    i18n: {
      /*!
       * Translates a key
       *
       * @param  {String}     key             The i18n key to translate
       * @param  {Object}     [properties]    A set of properties that can be used to translate the key
       * @return {String}                     The translated key
       */
      translate(key, properties) {
        return translate(key, locale, properties);
      },

      /*!
       * Format a date
       *
       * @param  {Date}       date            The date to format
       * @param  {String}     dateFormat      The format in which the date should be formatted. See https://github.com/jquery/globalize/tree/v0.1.1#dates
       * @param  {String}     [timezone]      The timezone the date should be presented in. Defaults to UTC
       * @return {String}                     The formatted date
       */
      formatDate(date, dateFormat, timezone) {
        timezone = timezone || 'UTC';
        // Gloablize requires the locale to use a `-` rather than a `_`
        const globalizeLocale = locale.replace('_', '-');

        // Globalize can't handle our TZ dates, so we'll make a regular Date object that will look like it's from the tenant timezone when serialized in UTC
        const kludgeDate = new TZ.timezone.Date(date.valueOf(), timezone);
        kludgeDate.setMinutes(kludgeDate.getMinutes() + kludgeDate.getTimezoneOffset() * 2);

        // Return a properly formatted date
        const formatted = Globalize.format(kludgeDate, dateFormat, globalizeLocale);
        return formatted.toString();
      }
    },

    ui: {
      /*!
       * Get the optimized path in the UI for a pre-optimized path
       *
       * @param  {String}     path    The pre-optimized path to resolve
       * @return {String}             The optimized path. In case no optimized path could be found, the given path is returned
       */
      getHashedPath
    },

    url: {
      /**
       * Escape all characters except the following: alphabetic, decimal digits, - _ . ! ~ * ' ( )
       *
       * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
       */
      encode: encodeURIComponent,

      /**
       * Ensure that a link is an absolute URL. If a relative link is
       * passed in, it will be prefixed with the base url.
       *
       * @param  {String}     link        The link to check
       * @param  {String}     baseUrl     The base url that can be used to prefix relative urls
       * @return {String}                 The absolute link prefixed with the base url
       */
      ensureAbsoluteLink(link, baseUrl) {
        // If the link is empty or null, we return the empty string. This can happen when
        // we try to link a private user (private users are scrubbed and have no profile path)
        if (!link) {
          return '';

          // If the link already has `http` in it (e.g., twitter profile pics) we return as-is
        }

        if (link.indexOf('http') === 0) {
          return link;

          // Otherwise we prefix it with the base url
        }

        return baseUrl + link;
      },

      /**
       * Ensure that each link in an HTML fragment is an abolute url, If a relative link is
       * found, it will be prefixed with the base url.
       *
       * @param  {String}     str         The html string in which to check for absolute links
       * @param  {String}     baseUrl     The base url that can be used to prefix relative urls
       * @return {String}                 The html in which each link is absolute
       */
      ensureAbsoluteLinks(str, baseUrl) {
        const html = $('<div>' + str + '</div>');
        // eslint-disable-next-line no-unused-vars
        html.find('a').each(function(i, elem) {
          let link = $(this).attr('href');
          link = data.util.url.ensureAbsoluteLink(link, baseUrl);
          $(this).attr('href', link);
        });
        return html.html();
      }
    }
  });

  // Parse and process it with Underscore
  try {
    let compiledTemplate = null;
    if (_.isString(template)) {
      compiledTemplate = compileTemplate(template);
    } else if (_.isFunction(template)) {
      compiledTemplate = template;
    } else {
      log().error('A malformed template was passed in');
      return '';
    }

    // Render the template
    let renderedTemplate = compiledTemplate(data);

    // Remove HTML comments
    renderedTemplate = renderedTemplate.replace(/<!--(?:.|\n)*?-->/gm, '');

    // Translate the template
    const translatedTemplate = translate(renderedTemplate, locale);

    // Trim useless spaces
    return translatedTemplate.trim();
  } catch (error) {
    log().error({ err: error }, 'Unable to render template');
    return '';
  }
};

/**
 * Compile a template to a function. This function allows you to compile a template, cache it and
 * render it multiple times. This is useful when you're often rendering the same template(s).
 *
 * @param  {String}     template    The template to compile
 * @return {Function}               The compiled template
 */
const compileTemplate = function(template) {
  // Support <% include path/to/other/template.jst %>
  template = template.replace(/<%\s*include\s*(.*?)\s*%>/g, (match, path) => {
    if (fs.existsSync(path)) {
      return fs.readFileSync(path, 'utf8');
    }

    log().warn({ path }, 'Could not find an underscore template');
    return '';
  });

  // Compile the template
  return _.template(template);
};

/// ///////////////////
// ACTIVITY ADAPTER //
/// ///////////////////

/**
 * The activity adapter that can be used to adapt activities in a simple view-model
 *
 * @return {Object}    The activity adapter
 */
const getActivityAdapter = function() {
  return _uiRequire('/shared/oae/js/activityadapter.js');
};

/// ////////////
// UTILITIES //
/// ////////////

/**
 * Given a path, get the hashed path. If no hashed path
 * is known for the given path, the path is returned as is
 *
 * @param  {String}     path    The path for which to get the hashed counter part
 * @return {String}             The hashed path, or in case it could not be found, the original path
 */
const getHashedPath = function(path) {
  if (hashes && hashes[path]) {
    return hashes[path];
  }

  return path;
};

/**
 * Get the ISO-3166-1 country information
 *
 * @return {Object}     result                      An object that contains ISO-3166-1 country metadata
 * @return {Object[]}   result.countries            Each country we know about, ordered by `name`
 * @return {String}     result.countries[i].code    The ISO-3166-1 country code of the country
 * @return {String}     result.countries[i].name    The english name of the country
 * @return {String}     [result.countries[i].icon]  The absolute path to an icon, if available
 */
const getIso3166CountryInfo = function() {
  return _uiRequire('/shared/oae/js/iso3166.js');
};

/**
 * The mimetype description that can be used to generate descriptions for files
 *
 * @return {Object}     The mimetype descriptor
 * @api private
 */
const _getMimeTypeDescriptor = function() {
  return _uiRequire('/shared/oae/js/mimetypes.js');
};

/**
 * Require a file from the UI repository
 *
 * @param  {String}     path    The path to the file that should be required. This should start with a `/`
 * @return {Object}             The module as returned by Node.JS's `require` method
 * @api private
 */
const _uiRequire = function(path) {
  path = getHashedPath(path);
  return require(uiDirectory + path);
};

export {
  emitter,
  init,
  getWidgetManifests,
  getStaticBatch,
  getStaticFile,
  getSkin,
  getLogo,
  getSkinVariables,
  getUIDirectory,
  getTenantSkinVariables,
  uploadLogoFile,
  translate,
  renderTemplate,
  compileTemplate,
  getActivityAdapter,
  getHashedPath,
  getIso3166CountryInfo
};
