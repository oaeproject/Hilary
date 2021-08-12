/*
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

import { assert } from 'chai';
import { format } from 'util';
import path from 'path';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { keys, equals, indexBy, prop, forEach, find, propSatisfies, not, pluck, has, contains } from 'ramda';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as Swagger from '../lib/swagger.js';

describe('Swagger', () => {
  let asAnonymousUserOnLocalhost = null;
  let asGlobalAdmin = null;

  before((callback) => {
    asAnonymousUserOnLocalhost = TestsUtil.createTenantRestContext(global.oaeTests.tenants.localhost.host);
    asGlobalAdmin = TestsUtil.createGlobalAdminRestContext();

    // Register the test doc
    Swagger.register(path.join(__dirname, '/data/restjsdoc.js'), () => {
      Swagger.addModelsToResources();
      return callback();
    });
  });

  describe('Resource List', () => {
    /**
     * Test that verifies that we get a Swagger resource list with the expected contents
     */
    it('verify get resource list', (callback) => {
      RestAPI.Doc.getSwaggerResources(asAnonymousUserOnLocalhost, (error, resources) => {
        assert.notExists(error);
        assert.isString(resources.apiVersion);
        assert.isString(resources.swaggerVersion);
        assert.isArray(resources.apis);
        forEach((api) => {
          assert.isString(api.path);
        }, resources.apis);
        assert.ok(
          find(propSatisfies(equals('/test'), 'path'), resources.apis),
          'There should be a resource for the "/test" apis'
        );
        return callback();
      });
    });
  });

  describe('API Declarations', () => {
    /**
     * Test that verifies that we can get API declarations for all defined routes
     */
    it('verify get api declarations', (callback) => {
      RestAPI.Doc.getSwaggerResources(asAnonymousUserOnLocalhost, (error, resources) => {
        assert.notExists(error);
        assert.ok(resources.apis);
        let completed = 0;
        forEach((api) => {
          // Strip the leading '/'
          const id = api.path.slice(1);
          RestAPI.Doc.getSwaggerApi(asAnonymousUserOnLocalhost, id, (error, data) => {
            assert.notExists(error);
            assert.ok(data.apiVersion);
            assert.ok(data.swaggerVersion);
            assert.strictEqual(data.basePath, 'http://localhost:2001/api');
            assert.strictEqual(data.resourcePath, id + '/');
            assert.isArray(data.apis);
            assert.isObject(data.models);
            // Verify models
            forEach((model) => {
              assert.isString(model.id, 'Model id must be a String');
              assert.isArray(model.required, 'Model required must be an Array');
              assert.isObject(model.properties, 'Model properties must be an Object');
              forEach((id) => {
                assert.isString(id, 'Required property ids must be Strings');
                assert.ok(model.properties[id], format('Required property "%s" is not defined', id));
              }, model.required);
              forEach((property) => {
                assert.isString(property.type);
                if (property.type === 'array') {
                  assert.isObject(property.items, 'Arrays must have an item type');
                  // Arrays have a type xor $ref
                  assert.ok(
                    has('type', property.items) ^ has('$ref', property.items),
                    'Item must have a type or a $ref but not both'
                  );
                  if (property.items.type) {
                    assert.include(
                      Swagger.Constants.primitives,
                      property.items.type,
                      format('Array item type "%s" is not a primitive type, did you mean $ref', property.items.type)
                    );
                  } else {
                    // Complex type, make sure there's a model for it
                    assert.ok(
                      data.models[property.items.$ref],
                      format('Array item $ref "%s" is not defined in models', property.items.$ref)
                    );
                  }
                } else if (not(contains(property.type, Swagger.Constants.primitives))) {
                  // Complex type, make sure there's a model for it
                  assert.ok(
                    data.models[property.type],
                    format('Property type "%s" is not defined in models', property.type)
                  );
                }
              }, model.properties);
            }, data.models);

            // Verify apis
            forEach((api) => {
              assert.isObject(api, 'APIs must be Objects');
              assert.isString(api.path, 'API paths must be Strings');
              assert.isArray(api.operations, 'API operations must be an Array');
              forEach((operation) => {
                assert.isObject(operation, 'Operations must be Objects');
                assert.isString(operation.path, 'Operation path must be a String');
                const verbs = ['GET', 'POST', 'PUT', 'DELETE'];
                assert.include(
                  verbs,
                  operation.method,
                  format('Operation method "%s" is not one of "GET", "POST", "PUT", or "DELETE"', operation.method)
                );
                assert.isString(operation.nickname, 'Operation nickname must be a String');
                assert.notInclude(
                  operation.nickname,
                  ' ',
                  format('Operation nickname "%s" cannot contain spaces', operation.nickname)
                );
                assert.isString(operation.summary, 'Operation summary must be a String');
                assert.isString(operation.responseClass, 'Operation responseClass must be a String');
                const responseClass = operation.responseClass.replace(/^List\[/, '').replace(/]/, '');
                if (
                  not(contains(responseClass, Swagger.Constants.primitives)) &&
                  responseClass !== 'void' &&
                  responseClass !== 'File'
                ) {
                  assert.ok(
                    data.models[responseClass],
                    format('ResponseClass type "%s" is undefined in models', responseClass)
                  );
                }

                assert.isArray(operation.parameters, 'Operation parameters must be an Array');
                forEach((parameter) => {
                  assert.isString(parameter.name, 'Parameter name must be a String');
                  assert.isString(parameter.description, 'Parameter description must be a String');
                  const dataType = parameter.dataType.replace(/^List\[/, '').replace(/]/, '');
                  if (not(contains(dataType, Swagger.Constants.primitives)) && dataType !== 'File') {
                    assert.ok(
                      data.models[dataType],
                      format('Parameter dataType "%s" is undefined in models', dataType)
                    );
                  }

                  assert.isBoolean(parameter.required, 'Parameter required must be a Boolean');
                  assert.isBoolean(parameter.allowMultiple, 'Parameter allowMultiple must be a Boolean');
                  const parameterTypes = ['body', 'path', 'query', 'form', 'header'];
                  assert.include(
                    parameterTypes,
                    parameter.paramType,
                    format(
                      'Param type "%s" is not one of "body", "path", "query", "form", or "header"',
                      parameter.paramType
                    )
                  );
                  if (parameter.paramType === 'path') {
                    assert.ok(
                      api.path.includes(format('{%s}', parameter.name)),
                      format('Path parameter "%s" does not appear in api path', parameter.name)
                    );
                  }

                  if (contains(parameter.paramType, ['path', 'query', 'header'])) {
                    assert.ok(
                      contains(parameter.dataType, Swagger.Constants.primitives),
                      format('%s parameter "%s" must be of a primitive type', parameter.paramType, parameter.name)
                    );
                  }
                }, operation.parameters);
              }, api.operations);
            }, data.apis);

            completed++;
            if (completed === resources.apis.length) {
              // Verify the "test" api documentation
              RestAPI.Doc.getSwaggerApi(asAnonymousUserOnLocalhost, 'test', (error, data) => {
                assert.notExists(error);
                assert.strictEqual(data.apis.length, 1);
                assert.strictEqual(data.apis[0].operations.length, 1);

                // Verify that the private endpoint isn't published
                assert.notInclude(pluck('path', data.apis), '/test/private');

                // Verify the published endpoints
                const operation = data.apis[0].operations[0];
                assert.strictEqual(data.apis[0].path, '/test/{var}');
                assert.strictEqual(operation.description, 'Test some stuff');
                assert.strictEqual(operation.summary, 'Test some stuff');
                assert.strictEqual(operation.server, 'tenant');
                assert.strictEqual(operation.method, 'POST');
                assert.strictEqual(operation.nickname, 'testEndpoint');
                assert.strictEqual(operation.responseClass, 'List[Test]');
                assert.strictEqual(operation.parameters.length, 9);
                const parameters = indexBy(prop('name'), operation.parameters);

                // Verify a path parameter
                assert.strictEqual(parameters.var.description, 'A path parameter');
                assert.strictEqual(parameters.var.dataType, 'string');
                assert.strictEqual(parameters.var.required, true);
                assert.strictEqual(parameters.var.allowMultiple, false);
                assert.strictEqual(parameters.var.allowableValues.valueType, 'LIST');
                assert.lengthOf(parameters.var.allowableValues.values, 2);
                assert.include(parameters.var.allowableValues.values, 'choice1');
                assert.include(parameters.var.allowableValues.values, 'choice2');
                assert.strictEqual(parameters.var.paramType, 'path');
                // Verify a body parameter
                assert.strictEqual(parameters.var2.description, 'A body parameter');
                assert.strictEqual(parameters.var2.dataType, 'string');
                assert.strictEqual(parameters.var2.required, true);
                assert.strictEqual(parameters.var2.allowMultiple, false);
                assert.strictEqual(parameters.var2.paramType, 'body');
                // Verify a query parameter
                assert.strictEqual(parameters.var3.description, 'A query parameter');
                assert.strictEqual(parameters.var3.dataType, 'number');
                assert.strictEqual(parameters.var3.required, false);
                assert.strictEqual(parameters.var3.allowMultiple, false);
                assert.strictEqual(parameters.var3.paramType, 'query');
                // Verify a required query parameter
                assert.strictEqual(parameters.var4.description, 'A required query parameter');
                assert.strictEqual(parameters.var4.dataType, 'string');
                assert.strictEqual(parameters.var4.required, true);
                assert.strictEqual(parameters.var4.allowMultiple, false);
                assert.strictEqual(parameters.var4.paramType, 'query');
                // Verify a query parameter that can appear multiple times
                assert.strictEqual(parameters.var5.description, 'A query parameter that can appear multiple times');
                assert.strictEqual(parameters.var5.dataType, 'string');
                assert.isFalse(parameters.var5.required);
                assert.isTrue(parameters.var5.allowMultiple);
                assert.strictEqual(parameters.var5.paramType, 'query');

                // Verify a required query parameter that can appear multiple times
                assert.strictEqual(
                  parameters.var6.description,
                  'A required query parameter that can appear multiple times'
                );
                assert.strictEqual(parameters.var6.dataType, 'string');
                assert.isTrue(parameters.var6.required);
                assert.isTrue(parameters.var6.allowMultiple);
                assert.strictEqual(parameters.var6.paramType, 'query');

                // Verify a header parameter
                assert.strictEqual(parameters.var7.description, 'A header parameter');
                assert.strictEqual(parameters.var7.dataType, 'string');
                assert.strictEqual(parameters.var7.required, false);
                assert.strictEqual(parameters.var7.allowMultiple, false);
                assert.strictEqual(parameters.var7.paramType, 'header');

                // Verify a form parameter
                assert.strictEqual(parameters.var8.description, 'A form parameter');
                assert.strictEqual(parameters.var8.dataType, 'File');
                assert.isTrue(parameters.var8.required);
                assert.isFalse(parameters.var8.allowMultiple);
                assert.strictEqual(parameters.var8.paramType, 'form');

                // Verify an optional form parameter
                assert.strictEqual(parameters.var9.description, 'An optional form parameter');
                assert.strictEqual(parameters.var9.dataType, 'string');
                assert.isFalse(parameters.var9.required);
                assert.isFalse(parameters.var9.allowMultiple);
                assert.strictEqual(parameters.var9.paramType, 'form');
                assert.include(parameters.var9.allowableValues.values, 'choice1');
                assert.include(parameters.var9.allowableValues.values, 'choice2');

                // Verify the responseMessages
                const responseMessages = indexBy(prop('code'), operation.responseMessages);
                assert.strictEqual(responseMessages['404'].message, 'Why this endpoint would send a 404');
                assert.strictEqual(responseMessages['302'].message, 'Why this endpoint would redirect');

                // Verify the `Test` model
                assert.lengthOf(keys(data.models), 3);
                assert.strictEqual(data.models.Test.id, 'Test');
                assert.strictEqual(data.models.Test.description, 'A test model');
                assert.lengthOf(data.models.Test.required, 2);
                assert.include(data.models.Test.required, 'test');
                assert.include(data.models.Test.required, 'test2');
                assert.strictEqual(data.models.Test.properties.test.type, 'string');
                assert.strictEqual(data.models.Test.properties.test.description, 'A property');
                assert.strictEqual(data.models.Test.properties.test2.type, 'array');
                assert.strictEqual(data.models.Test.properties.test2.description, 'Array of Test2s');
                assert.strictEqual(data.models.Test.properties.test2.items.$ref, 'Test2');

                // Verify the `Test2` model
                assert.strictEqual(data.models.Test2.id, 'Test2');
                assert.strictEqual(data.models.Test2.description, 'Another test model');
                assert.lengthOf(data.models.Test2.required, 2);
                assert.include(data.models.Test2.required, 'test');
                assert.include(data.models.Test2.required, 'num');
                assert.strictEqual(data.models.Test2.properties.test.type, 'array');
                assert.strictEqual(data.models.Test2.properties.test.description, 'A property');
                assert.strictEqual(data.models.Test2.properties.test.items.type, 'string');
                assert.strictEqual(data.models.Test2.properties.num.type, 'number');
                assert.strictEqual(data.models.Test2.properties.num.description, 'A numeric property');
                assert.strictEqual(data.models.Test2.properties.test3.type, 'Test3');

                // Verify the `Test3` model
                assert.strictEqual(data.models.Test3.id, 'Test3');
                assert.strictEqual(
                  data.models.Test3.description,
                  'Yet another test model\n\nThis one has more than one paragraph of description and a circular reference back to `Test2`'
                );
                assert.lengthOf(data.models.Test3.required, 0);
                assert.strictEqual(data.models.Test3.properties.bool.type, 'boolean');
                assert.strictEqual(data.models.Test3.properties.test2.type, 'Test2');

                // Verify the admin `test` documentation
                RestAPI.Doc.getSwaggerApi(asGlobalAdmin, 'test', (error, data) => {
                  assert.notExists(error);
                  assert.lengthOf(data.apis, 1);
                  assert.lengthOf(data.apis[0].operations, 1);

                  const operation = data.apis[0].operations[0];
                  assert.strictEqual(data.apis[0].path, '/test');
                  assert.strictEqual(operation.description, 'Test some admin stuff');
                  assert.strictEqual(operation.server, 'admin');
                  assert.strictEqual(operation.method, 'GET');
                  assert.strictEqual(operation.path, '/test');
                  assert.strictEqual(operation.nickname, 'testAdminEndpoint');
                  assert.strictEqual(operation.summary, 'Test some admin stuff');
                  assert.strictEqual(operation.responseClass, 'void');
                  return callback();
                });
              });
            }
          });
        }, resources.apis);
      });
    });
  });
});
