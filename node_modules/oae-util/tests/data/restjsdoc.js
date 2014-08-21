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

/**
 * @REST testEndpoint
 *
 * Test some stuff
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /test/{var}
 * @PathParam   {string}            var         A path parameter  [choice1, choice2]
 * @BodyParam   {string}            var2        A body parameter
 * @QueryParam  {number}            [var3]      A query parameter
 * @QueryParam  {string}            var4        A required query parameter
 * @QueryParam  {string[]}          [var5]      A query parameter that can appear multiple times
 * @QueryParam  {string[]}          var6        A required query parameter that can appear multiple times
 * @HeaderParam {string}            [var7]      A header parameter
 * @FormParam   {File}              var8        A form parameter
 * @FormParam   {string}            [var9]      An optional form parameter [choice1, choice2]
 * @Return      {Test[]}                        The return value
 * @HttpResponse                    404         Why this endpoint would send a 404
 * @HttpResponse                    302         Why this endpoint would redirect
 */

/**
 * @REST testAdminEndpoint
 *
 * Test some admin stuff
 *
 * @Server      admin
 * @Method      GET
 * @Path        /test
 */

/**
 * @REST testPrivateEndpoint
 *
 * A private endpoint
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /test/private
 * @Api         private
 */

/**
 * @RESTModel Test
 *
 * A test model
 *
 * @Required    [test, test2]
 * @Property    {string}        test    A property
 * @Property    {Test2[]}       test2   Array of Test2s
 */

/**
 * @RESTModel Test2
 *
 * Another test model
 *
 * @Required    [test, num]
 * @Property    {string[]}      test    A property
 * @Property    {number}        num     A numeric property
 * @Property    {Test3}         test3   Another level of nesting
 */

/**
 * @RESTModel Test3
 *
 * Yet another test model
 *
 * This one has more than one paragraph of description and a circular reference back to `Test2`
 *
 * @Required    []
 * @Property    {boolean}       bool    A boolean property
 * @Property    {Test2}         test2   Circular reference
 */
