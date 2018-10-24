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

const assert = require('assert');
const util = require('util');
const path = require('path');
const _ = require('underscore');

const RestAPI = require('oae-rest');
const { RestContext } = require('oae-rest/lib/model');
const TestsUtil = require('oae-tests');
const Swagger = require('../lib/swagger');

describe('Swagger', () => {
  let anonymousRestContext = null;
  let globalAdminRestContext = null;

  before(callback => {
    anonymousRestContext = TestsUtil.createTenantRestContext(
      global.oaeTests.tenants.localhost.host
    );
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
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
    it('verify get resource list', callback => {
      RestAPI.Doc.getSwaggerResources(anonymousRestContext, (err, resources) => {
        assert.ok(!err);
        assert.ok(_.isString(resources.apiVersion));
        assert.ok(_.isString(resources.swaggerVersion));
        assert.ok(_.isArray(resources.apis));
        _.each(resources.apis, api => {
          assert.ok(_.isString(api.path));
        });
        assert.ok(
          _.findWhere(resources.apis, { path: '/test' }),
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
    it('verify get api declarations', callback => {
      RestAPI.Doc.getSwaggerResources(anonymousRestContext, (err, resources) => {
        assert.ok(!err);
        assert.ok(resources.apis);
        let completed = 0;
        _.each(resources.apis, api => {
          // Strip the leading '/'
          const id = api.path.substr(1);
          RestAPI.Doc.getSwaggerApi(anonymousRestContext, id, (err, data) => {
            assert.ok(!err);
            assert.ok(data.apiVersion);
            assert.ok(data.swaggerVersion);
            assert.strictEqual(data.basePath, 'http://localhost:2001/api');
            assert.strictEqual(data.resourcePath, id + '/');
            assert.ok(_.isArray(data.apis));
            assert.ok(_.isObject(data.models));
            // Verify models
            _.each(data.models, model => {
              assert.ok(_.isString(model.id), 'Model id must be a String');
              assert.ok(_.isArray(model.required), 'Model required must be an Array');
              assert.ok(_.isObject(model.properties), 'Model properties must be an Object');
              _.each(model.required, id => {
                assert.ok(_.isString(id), 'Required property ids must be Strings');
                assert.ok(
                  model.properties[id],
                  util.format('Required property "%s" is not defined', id)
                );
              });
              _.each(model.properties, property => {
                assert.ok(_.isString(property.type));
                if (property.type === 'array') {
                  assert.ok(_.isObject(property.items), 'Arrays must have an item type');
                  // Arrays have a type xor $ref
                  assert.ok(
                    _.has(property.items, 'type') ^ _.has(property.items, '$ref'),
                    'Item must have a type or a $ref but not both'
                  );
                  if (property.items.type) {
                    assert.ok(
                      _.contains(Swagger.Constants.primitives, property.items.type),
                      util.format(
                        'Array item type "%s" is not a primitive type, did you mean $ref',
                        property.items.type
                      )
                    );
                  } else {
                    // Complex type, make sure there's a model for it
                    assert.ok(
                      data.models[property.items.$ref],
                      util.format(
                        'Array item $ref "%s" is not defined in models',
                        property.items.$ref
                      )
                    );
                  }
                } else if (!_.contains(Swagger.Constants.primitives, property.type)) {
                  // Complex type, make sure there's a model for it
                  assert.ok(
                    data.models[property.type],
                    util.format('Property type "%s" is not defined in models', property.type)
                  );
                }
              });
            });

            // Verify apis
            _.each(data.apis, api => {
              assert.ok(_.isObject(api), 'APIs must be Objects');
              assert.ok(_.isString(api.path), 'API paths must be Strings');
              assert.ok(_.isArray(api.operations), 'API operations must be an Array');
              _.each(api.operations, operation => {
                assert.ok(_.isObject(operation), 'Operations must be Objects');
                assert.ok(_.isString(operation.path), 'Operation path must be a String');
                const verbs = ['GET', 'POST', 'PUT', 'DELETE'];
                assert.ok(
                  _.contains(verbs, operation.method),
                  util.format(
                    'Operation method "%s" is not one of "GET", "POST", "PUT", or "DELETE"',
                    operation.method
                  )
                );
                assert.ok(_.isString(operation.nickname), 'Operation nickname must be a String');
                assert.ok(
                  !_.contains(operation.nickname, ' '),
                  util.format('Operation nickname "%s" cannot contain spaces', operation.nickname)
                );
                assert.ok(_.isString(operation.summary), 'Operation summary must be a String');
                assert.ok(
                  _.isString(operation.responseClass),
                  'Operation responseClass must be a String'
                );
                const responseClass = operation.responseClass
                  .replace(/^List\[/, '')
                  .replace(/\]/, '');
                if (
                  !_.contains(Swagger.Constants.primitives, responseClass) &&
                  responseClass !== 'void' &&
                  responseClass !== 'File'
                ) {
                  assert.ok(
                    data.models[responseClass],
                    util.format('ResponseClass type "%s" is undefined in models', responseClass)
                  );
                }

                assert.ok(_.isArray(operation.parameters), 'Operation parameters must be an Array');
                _.each(operation.parameters, parameter => {
                  assert.ok(_.isString(parameter.name), 'Parameter name must be a String');
                  assert.ok(
                    _.isString(parameter.description),
                    'Parameter description must be a String'
                  );
                  const dataType = parameter.dataType.replace(/^List\[/, '').replace(/\]/, '');
                  if (!_.contains(Swagger.Constants.primitives, dataType) && dataType !== 'File') {
                    assert.ok(
                      data.models[dataType],
                      util.format('Parameter dataType "%s" is undefined in models', dataType)
                    );
                  }
                  assert.ok(
                    _.isBoolean(parameter.required),
                    'Parameter required must be a Boolean'
                  );
                  assert.ok(
                    _.isBoolean(parameter.allowMultiple),
                    'Parameter allowMultiple must be a Boolean'
                  );
                  const paramTypes = ['body', 'path', 'query', 'form', 'header'];
                  assert.ok(
                    _.contains(paramTypes, parameter.paramType),
                    util.format(
                      'Param type "%s" is not one of "body", "path", "query", "form", or "header"',
                      parameter.paramType
                    )
                  );
                  if (parameter.paramType === 'path') {
                    assert.ok(
                      api.path.indexOf(util.format('{%s}', parameter.name)) !== -1,
                      util.format('Path parameter "%s" does not appear in api path', parameter.name)
                    );
                  }

                  if (_.contains(['path', 'query', 'header'], parameter.paramType)) {
                    assert.ok(
                      _.contains(Swagger.Constants.primitives, parameter.dataType),
                      util.format(
                        '%s parameter "%s" must be of a primitive type',
                        parameter.paramType,
                        parameter.name
                      )
                    );
                  }
                });
              });
            });

            completed++;
            if (completed === resources.apis.length) {
              // Verify the "test" api documentation
              RestAPI.Doc.getSwaggerApi(anonymousRestContext, 'test', (err, data) => {
                assert.ok(!err);
                assert.strictEqual(data.apis.length, 1);
                assert.strictEqual(data.apis[0].operations.length, 1);

                // Verify that the private endpoint isn't published
                assert.ok(!_.contains(_.pluck(data.apis, 'path'), '/test/private'));

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
                const params = _.indexBy(operation.parameters, 'name');
                // Verify a path parameter
                assert.strictEqual(params.var.description, 'A path parameter');
                assert.strictEqual(params.var.dataType, 'string');
                assert.strictEqual(params.var.required, true);
                assert.strictEqual(params.var.allowMultiple, false);
                assert.strictEqual(params.var.allowableValues.valueType, 'LIST');
                assert.strictEqual(params.var.allowableValues.values.length, 2);
                assert.ok(_.contains(params.var.allowableValues.values, 'choice1'));
                assert.ok(_.contains(params.var.allowableValues.values, 'choice2'));
                assert.strictEqual(params.var.paramType, 'path');
                // Verify a body parameter
                assert.strictEqual(params.var2.description, 'A body parameter');
                assert.strictEqual(params.var2.dataType, 'string');
                assert.strictEqual(params.var2.required, true);
                assert.strictEqual(params.var2.allowMultiple, false);
                assert.strictEqual(params.var2.paramType, 'body');
                // Verify a query parameter
                assert.strictEqual(params.var3.description, 'A query parameter');
                assert.strictEqual(params.var3.dataType, 'number');
                assert.strictEqual(params.var3.required, false);
                assert.strictEqual(params.var3.allowMultiple, false);
                assert.strictEqual(params.var3.paramType, 'query');
                // Verify a required query parameter
                assert.strictEqual(params.var4.description, 'A required query parameter');
                assert.strictEqual(params.var4.dataType, 'string');
                assert.strictEqual(params.var4.required, true);
                assert.strictEqual(params.var4.allowMultiple, false);
                assert.strictEqual(params.var4.paramType, 'query');
                // Verify a query parameter that can appear multiple times
                assert.strictEqual(
                  params.var5.description,
                  'A query parameter that can appear multiple times'
                );
                assert.strictEqual(params.var5.dataType, 'string');
                assert.strictEqual(params.var5.required, false);
                assert.strictEqual(params.var5.allowMultiple, true);
                assert.strictEqual(params.var5.paramType, 'query');
                // Verify a required query parameter that can appear multiple times
                assert.strictEqual(
                  params.var6.description,
                  'A required query parameter that can appear multiple times'
                );
                assert.strictEqual(params.var6.dataType, 'string');
                assert.strictEqual(params.var6.required, true);
                assert.strictEqual(params.var6.allowMultiple, true);
                assert.strictEqual(params.var6.paramType, 'query');
                // Verify a header parameter
                assert.strictEqual(params.var7.description, 'A header parameter');
                assert.strictEqual(params.var7.dataType, 'string');
                assert.strictEqual(params.var7.required, false);
                assert.strictEqual(params.var7.allowMultiple, false);
                assert.strictEqual(params.var7.paramType, 'header');
                // Verify a form parameter
                assert.strictEqual(params.var8.description, 'A form parameter');
                assert.strictEqual(params.var8.dataType, 'File');
                assert.strictEqual(params.var8.required, true);
                assert.strictEqual(params.var8.allowMultiple, false);
                assert.strictEqual(params.var8.paramType, 'form');
                // Verify an optional form parameter
                assert.strictEqual(params.var9.description, 'An optional form parameter');
                assert.strictEqual(params.var9.dataType, 'string');
                assert.strictEqual(params.var9.required, false);
                assert.strictEqual(params.var9.allowMultiple, false);
                assert.strictEqual(params.var9.paramType, 'form');
                assert.ok(_.contains(params.var9.allowableValues.values, 'choice1'));
                assert.ok(_.contains(params.var9.allowableValues.values, 'choice2'));

                // Verify the responseMessages
                const responseMessages = _.indexBy(operation.responseMessages, 'code');
                assert.strictEqual(
                  responseMessages['404'].message,
                  'Why this endpoint would send a 404'
                );
                assert.strictEqual(
                  responseMessages['302'].message,
                  'Why this endpoint would redirect'
                );

                // Verify the `Test` model
                assert.strictEqual(_.size(data.models), 3);
                assert.strictEqual(data.models.Test.id, 'Test');
                assert.strictEqual(data.models.Test.description, 'A test model');
                assert.strictEqual(data.models.Test.required.length, 2);
                assert.ok(_.contains(data.models.Test.required, 'test'));
                assert.ok(_.contains(data.models.Test.required, 'test2'));
                assert.strictEqual(data.models.Test.properties.test.type, 'string');
                assert.strictEqual(data.models.Test.properties.test.description, 'A property');
                assert.strictEqual(data.models.Test.properties.test2.type, 'array');
                assert.strictEqual(
                  data.models.Test.properties.test2.description,
                  'Array of Test2s'
                );
                assert.strictEqual(data.models.Test.properties.test2.items.$ref, 'Test2');

                // Verify the `Test2` model
                assert.strictEqual(data.models.Test2.id, 'Test2');
                assert.strictEqual(data.models.Test2.description, 'Another test model');
                assert.strictEqual(data.models.Test2.required.length, 2);
                assert.ok(_.contains(data.models.Test2.required, 'test'));
                assert.ok(_.contains(data.models.Test2.required, 'num'));
                assert.strictEqual(data.models.Test2.properties.test.type, 'array');
                assert.strictEqual(data.models.Test2.properties.test.description, 'A property');
                assert.strictEqual(data.models.Test2.properties.test.items.type, 'string');
                assert.strictEqual(data.models.Test2.properties.num.type, 'number');
                assert.strictEqual(
                  data.models.Test2.properties.num.description,
                  'A numeric property'
                );
                assert.strictEqual(data.models.Test2.properties.test3.type, 'Test3');

                // Verify the `Test3` model
                assert.strictEqual(data.models.Test3.id, 'Test3');
                assert.strictEqual(
                  data.models.Test3.description,
                  'Yet another test model\n\nThis one has more than one paragraph of description and a circular reference back to `Test2`'
                );
                assert.strictEqual(data.models.Test3.required.length, 0);
                assert.strictEqual(data.models.Test3.properties.bool.type, 'boolean');
                assert.strictEqual(data.models.Test3.properties.test2.type, 'Test2');

                // Verify the admin `test` documentation
                RestAPI.Doc.getSwaggerApi(globalAdminRestContext, 'test', (err, data) => {
                  assert.ok(!err);
                  assert.strictEqual(data.apis.length, 1);
                  assert.strictEqual(data.apis[0].operations.length, 1);
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
        });
      });
    });
  });
});
