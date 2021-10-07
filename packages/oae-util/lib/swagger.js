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

import fs from 'node:fs';
import { format } from 'node:util';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import OaeEmitter from 'oae-util/lib/emitter.js';

import { logger } from 'oae-logger';

import _ from 'underscore';
import clone from 'clone';
import readdirp from 'readdirp';
import * as restjsdoc from 'restjsdoc/lib/restjsdoc.js';
import * as TenantsUtil from 'oae-tenants/lib/util.js';
import { Validator as validator } from 'oae-util/lib/validator.js';
import { equals, forEachObjIndexed } from 'ramda';
import isIn from 'validator/lib/isIn.js';
import * as SwaggerParamTypes from './swagger-param-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const { validateInCase: bothCheck, isNotEmpty, notContains, unless } = validator;

const log = logger('oae-swagger');

const Constants = {
  apiVersion: '0.1',
  swaggerVersion: '1.2',
  basePath: '/api/',
  paramTypes: ['path', 'query', 'body', 'form', 'header'],
  primitives: [
    'integer',
    'long',
    'float',
    'double',
    'string',
    'byte',
    'boolean',
    'date',
    'dateTime',
    'int32',
    'int64',
    'number',
    'date-time'
  ]
};

// A "model" in Swagger is a schema for JSON object. This object holds all the models that have been described using the @RESTModel documentation annotation. Once registered, REST endpoint documentation can refer to these as input parameter types and return types
const models = {};
// A "resource" in Swagger is a schema for a REST endpoint. These objects hold all the resources that have been described for the user and admin tenants using the @REST documentation annotation. Once registered, REST endpoint documentation will be made available via the swagger documentation endpoints
const tenantResources = {};
const adminResources = {};

/**
 * Iterate over all resources and populate their models
 */
const addModelsToResources = function () {
  _.each(adminResources, (resource) => {
    _addModelsToResource(resource);
  });
  _.each(tenantResources, (resource) => {
    _addModelsToResource(resource);
  });
};

// Finalize swagger objects after all modules have been parsed
OaeEmitter.on('ready', addModelsToResources);

/**
 * Finds all the *.js files in a module's `lib` directory and runs them through the restjsdoc parser
 *
 * @param  {String}     moduleName  The oae module to be swagger documented
 * @param  {Function}   callback    Standard callback function
 */
const documentModule = function (moduleName, callback) {
  const files = [];
  // __dirname will be .../node_modules/oae-util/lib so other modules are 2 levels above here
  readdirp(format('%s/../../%s/lib', __dirname, moduleName), { fileFilter: '*.js' })
    .on('data', (entry) => {
      files.push(entry.fullPath);
    })
    .on('error', (error) => {
      // Modules are not required to have a lib folder, so we don't log "No Entry" errors
      if (error.code !== 'ENOENT') {
        log().warn({ err: error }, 'Problem recursing directories while documenting ' + moduleName);
      }

      return callback();
    })
    .on('end', () => {
      if (_.isEmpty(files)) {
        return callback();
      }

      const done = _.after(files.length, callback);
      _.each(files, (file) => {
        register(file, (error) => {
          if (error) {
            log().warn({ err: error }, 'Problem opening a file while documenting ' + moduleName);
          }

          return done();
        });
      });
    });
};

/**
 * Read the restjsdoc from a file and register its contents with swagger
 *
 * @param  {String}     filePath        The full path to the file to be documented
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const register = function (filePath, callback) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      return callback(error);
    }

    try {
      const doc = restjsdoc.parse(data);
      // Add all models to both servers
      _.each(doc.models, (model, modelName) => {
        model.id = modelName;
        _.each(model.properties, (property) => {
          // RestJSDoc arrays look like `type[]` so unArray will just be the bare `type`
          const unArray = property.type.replace(/\[]$/, '');
          /*!
           * If the property.type doesn't match unArray then it was an array so we need to transform it to
           * swagger model notation like:
           *
           *      property = {
           *          'type': 'array',
           *          'items': { 'type': 'string' }
           *      }
           *
           * for primitive types and:
           *
           *      property = {
           *          'type': 'array',
           *          'items': { '$ref': 'Model' }
           *      }
           *
           * for complex types
           */
          if (property.type !== unArray) {
            property.type = 'array';
            property.items = _.contains(Constants.primitives, unArray) ? { type: unArray } : { $ref: unArray };
          }

          if (property.validValues) {
            property.enum = property.validValues;
          }
        });
        models[modelName] = model;
      });

      // Convert the restjsdoc objects to swagger objects
      _.each(doc.endpoints, (endpoint) => {
        // If the endpoint is marked as private, it should not be added to the swagger output
        if (endpoint.api === 'private') {
          return;
        }

        endpoint.summary = endpoint.description;
        endpoint.responseClass = endpoint.return ? _convertRJDArrayDefToSwagger(endpoint.return.type) : 'void';

        endpoint.parameters = [];
        _.each(endpoint.pathParams, (pathParameter) => {
          endpoint.parameters.push(
            SwaggerParamTypes.path(
              pathParameter.name,
              pathParameter.description,
              _convertRJDArrayDefToSwagger(pathParameter.type),
              _constructSwaggerValue(pathParameter.validValues),
              pathParameter.defaultValue
            )
          );
        });
        _.each(endpoint.queryParams, (queryParameter) => {
          // Query params don't take true arrays, so if the type is something like `string[]` we need to say it's `string` and set the `isMultiple` flag on the parameter
          const isMultiple = /\[]$/.test(queryParameter.type);
          const type = isMultiple ? queryParameter.type.slice(0, -2) : queryParameter.type;
          endpoint.parameters.push(
            SwaggerParamTypes.query(
              queryParameter.name,
              queryParameter.description,
              type,
              queryParameter.required,
              isMultiple,
              _constructSwaggerValue(queryParameter.validValues),
              queryParameter.defaultValue
            )
          );
        });
        _.each(endpoint.bodyParams, (bodyParameter) => {
          endpoint.parameters.push(
            SwaggerParamTypes.body(
              bodyParameter.name,
              bodyParameter.description,
              _convertRJDArrayDefToSwagger(bodyParameter.type),
              bodyParameter.defaultValue
            )
          );
        });
        _.each(endpoint.headerParams, (headerParameter) => {
          endpoint.parameters.push(
            SwaggerParamTypes.header(
              headerParameter.name,
              headerParameter.description,
              _convertRJDArrayDefToSwagger(headerParameter.type),
              headerParameter.required
            )
          );
        });
        _.each(endpoint.formParams, (formParameter) => {
          endpoint.parameters.push(
            SwaggerParamTypes.form(
              formParameter.name,
              formParameter.description,
              _convertRJDArrayDefToSwagger(formParameter.type),
              formParameter.required,
              _constructSwaggerValue(formParameter.validValues),
              formParameter.defaultValue
            )
          );
        });

        // Add any http response messages
        endpoint.responseMessages = endpoint.httpResponses;

        // Add the endpoint to the appropriate server
        _.each(endpoint.server.split(','), (server) => {
          if (server === 'tenant') {
            _addSwaggerEndpoint(endpoint, tenantResources);
          } else if (server === 'admin') {
            _addSwaggerEndpoint(endpoint, adminResources);
          } else {
            log().warn('Tried to register swagger docs for unknown server "' + endpoint.server + '"');
          }
        });
      });
    } catch {
      /**
       * Esprima is lagging behind and does not support some of the most recent ES20xx features
       * Because of that, there have been some parsing errors showing up
       * And I don't want them there, because they are not errors per se
       * So yeah.
       * Check this issue for more information: https://github.com/jquery/esprima/issues/1953
       */
      // log().warn({}, format('Could not parse restjsdoc in %s', filePath));
    }

    return callback();
  });
};

/**
 * Use swagger to document a route on the associated server
 *
 * @param  {Object}     spec        The swagger spec for the route
 * @param  {Object}     resources   The swagger resources to append the spec to
 */
const _addSwaggerEndpoint = function (spec, resources) {
  // The path will be specified like `/foo/bar` so we want `foo` as the `apiRootPath`
  const apiRootPath = spec.path.split('/')[1];
  // Get the /api root resource
  resources[apiRootPath] = resources[apiRootPath] || {
    apiVersion: Constants.apiVersion,
    swaggerVersion: Constants.swaggerVersion,
    basePath: Constants.basePath,
    resourcePath: apiRootPath + '/',
    apis: [],
    models: {}
  };
  const root = resources[apiRootPath];

  // If the api is already defined just append to it, otherwise create it
  let api = _.findWhere(root.apis, { path: spec.path });

  if (!api) {
    api = { path: spec.path, operations: [] };
    root.apis.push(api);
  }

  _appendToApi(root, api, spec);
};

/**
 * Add a spec to an existing swagger api
 *
 * @param  {Object}     rootResource    The swagger resource this api belongs under
 * @param  {Object}     api             The api of the resource this spec belongs to
 * @param  {Object}     spec            The swagger spec to append
 */
const _appendToApi = function (rootResource, api, spec) {
  try {
    unless(isNotEmpty, {
      msg: 'Nickname must exist',
      path: api.path
    })(spec.nickname);

    unless(notContains, {
      path: api.path,
      msg: 'Nicknames cannot contain spaces: ' + spec.nickname
    })(spec.nickname, ' ');

    // Parse and validate params
    forEachObjIndexed((parameter) => {
      unless(isIn, {
        path: api.path,
        name: parameter.name,
        msg: 'Invalid param type: ' + parameter.paramType
      })(parameter.paramType, Constants.paramTypes);

      const pathIsValid = equals(parameter.paramType, 'path');
      unless(bothCheck(pathIsValid, isIn), {
        path: api.path,
        name: parameter.name,
        msg: 'Invalid path'
      })(parameter.name, api.path);
    }, spec.params);
  } catch (error) {
    return log().warn(
      { swaggerValidationErrors: error },
      'Some swagger documentation could not be parsed, the server will start but those routes may be undocumented'
    );
  }

  api.operations.push(spec);
};

/**
 * Convert RestJsDoc array syntax `type[]` to swagger syntax `List[type]`. If given a bare `type` it is returned unmodified
 *
 * @param  {String}     def     The RestJsDoc array definition like type[] or bare type
 * @return {String}             The swagger array definition like List[type] or bare type
 * @api private
 */
const _convertRJDArrayDefToSwagger = function (def) {
  if (/\[]$/.test(def)) {
    def = format('List[%s]', def.slice(0, -2));
  }

  return def;
};

/**
 * Convert a javascript array into a swagger value object. Swagger value objects can represent arrays or ranges,
 * but we only support arrays. Value objects are used to enumerate the allowable values for path and query parameters.
 *
 * @param  {String[]}   array   The array to be converted
 * @return {Object}             A swagger value object representing the array or null if the value passed in wasn't an array
 * @api private
 */
const _constructSwaggerValue = function (array) {
  return _.isArray(array) ? { valueType: 'LIST', values: array } : null;
};

/**
 * Get the swagger resources list
 *
 * @param  {Context}        ctx     Standard context object containing the current user and the current tenant
 * @return {ResourceList}           See https://github.com/wordnik/swagger-spec/blob/master/versions/1.2.md#51-resource-listing
 */
const getResources = function (ctx) {
  const resources = _getSwaggerResources(ctx);
  const paths = _.keys(resources).sort();
  const apis = _.map(paths, (key) => ({ path: '/' + key }));
  const swaggerResources = {
    apiVersion: Constants.apiVersion,
    swaggerVersion: Constants.swaggerVersion,
    apis
  };
  return swaggerResources;
};

/**
 * Get the swagger api declaration for a resource
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     swaggerResourcePath     The resource path
 * @return {ApiDeclaration}                     See https://github.com/wordnik/swagger-spec/blob/master/versions/1.2.md#52-api-declaration
 */
const getApi = function (ctx, swaggerResourcePath) {
  const resources = _getSwaggerResources(ctx);
  const url = TenantsUtil.getBaseUrl(ctx.tenant()) + '/api';
  const api = clone(resources[swaggerResourcePath]);
  api.basePath = url;
  return api;
};

/**
 * Find all the models that a resource needs and add them to its model list
 *
 * @param  {Resource}   resource    The resource to process
 */
const _addModelsToResource = function (resource) {
  let requiredModelNames = [];
  // Collect the list of models that this resource references
  _.each(resource.apis, (api) => {
    _.each(api.operations, (operation) => {
      _addModelNamesFromBody(operation, requiredModelNames);
      _addModelNamesFromResponse(operation, requiredModelNames);
      requiredModelNames = _.uniq(requiredModelNames);
    });
  });

  // Add required models to resource
  _.each(requiredModelNames, (modelName) => {
    _recurseModel(resource, modelName);
  });
};

/**
 * Get all the swagger resources for the appropriate tenant
 *
 * @param  {Context}    ctx     Standard context object containing the current user and the current tenant
 * @return {Object}             An object containing all the swagger resource info associated to the tenant
 * @api private
 */
const _getSwaggerResources = function (ctx) {
  return ctx.tenant().isGlobalAdminServer ? adminResources : tenantResources;
};

/**
 * Recurse the models a model references adding them to a resource
 *
 * @param  {Resource}   resource    The swagger resource the models should be added to
 * @param  {String}     modelName   The model to be added
 * @api private
 */
const _recurseModel = function (resource, modelName) {
  const model = models[modelName];
  if (!model) {
    // The referenced type was either a primitive or it referenced a model that doesn't exist. No need to recursively look for model references
    return;
  }

  if (resource.models[modelName]) {
    // This model type has already been visited. Don't recurse over it again or else we'll have an infinite loop
    return;
  }

  log().trace({ resource, model }, 'Recursively adding model "%s" to resource "%s"', modelName, resource.path);
  resource.models[modelName] = model;
  _.each(model.properties, (property) => {
    const { type } = property;
    // If the type of the property is an array, and the array elements are a model object (in contrast to a primitive), recursively add the models it may reference to the resource as well
    if (type === 'array') {
      if (property.items && property.items.$ref) {
        const ref = property.items.$ref;
        if (!resource.models[ref]) {
          return _recurseModel(resource, ref);
        }
      }
      // If the type of the property is a model object and hasn't been added to this resource, recursively add the models it may reference to the resource as well
    } else if (!_.contains(Constants.primitives, type) && !resource.models[type]) {
      return _recurseModel(resource, type);
    }
  });
};

/**
 * Parse the body parameters and add all referenced models to the model list
 *
 * @param  {String}     operation   The operation object from the swagger api declaration to parse
 * @param  {String[]}   modelNames  The list of referenced models, any newly referenced models will be appended
 * @api private
 */
const _addModelNamesFromBody = function (operation, modelNames) {
  _.each(operation.parameters, (parameter) => {
    // Body params are the only params that can have complex types and we only need to bother with the ones that list a type
    if (parameter.paramType === 'body' && parameter.dataType) {
      const model = _unwrapSwaggerType(parameter.dataType);
      modelNames.push(model);
    }
  });
};

/**
 * Parse the response type and add all referenced models to the model list
 *
 * @param  {String}     operation   The operation object from the swagger api declaration to parse
 * @param  {String[]}   modelNames  The list of referenced models, any newly referenced models will be appended
 * @api private
 */
const _addModelNamesFromResponse = function (operation, modelNames) {
  let responseModel = operation.responseClass;
  if (responseModel) {
    responseModel = _unwrapSwaggerType(responseModel);
    modelNames.push(responseModel);
  }
};

/**
 * Get the bare `type` of swagger style `List[type]` or `type`
 *
 * @param  {String}     type    The type declaration to be unwrapped
 * @return {String}             The unwrapped type declaration
 */
const _unwrapSwaggerType = function (type) {
  return type.replace(/^List\[/, '').replace(/]/, '');
};

export { Constants, addModelsToResources, documentModule, register, getResources, getApi };
