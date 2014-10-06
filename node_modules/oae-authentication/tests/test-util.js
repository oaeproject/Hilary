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

var _ = require('underscore');
var assert = require('assert');

var AuthenticationUtil = require('oae-authentication/lib/util');

describe('Authentication - util', function() {

    describe('#setProfileParameter', function() {

        /**
         * Test that verifies the basic functionality of the setProfileParameter function
         */
        it('verify it sets a profile parameter with a dynamic template', function(callback) {
            var template = '{firstName} {lastName}';
            var data = {'firstName': 'John', 'lastName': 'Doe'};
            var profileParameters = {
                'initial': true
            };
            var profileParameterName = 'displayName';
            AuthenticationUtil.setProfileParameter(profileParameters, profileParameterName, template, data);

            // Assert the displayName was added
            assert.strictEqual(profileParameters['displayName'], 'John Doe');

            // Assert that an initial value was not removed
            assert.strictEqual(profileParameters['initial'], true);

            // Assert that only one key was added
            assert.strictEqual(_.keys(profileParameters).length, 2);

            // Assert that the data object is still intact
            assert.strictEqual(_.keys(data).length, 2);
            assert.strictEqual(data['firstName'], 'John');
            assert.strictEqual(data['lastName'], 'Doe');

            // Assert that the template is still intact
            assert.strictEqual(template, '{firstName} {lastName}');

            return callback();
        });
    });

    describe('#renderTemplate', function() {

        /**
         * Test that verifies you can provide a template without any variables
         */
        it('verify a template without variables can be rendered', function(callback) {
            var result = AuthenticationUtil.renderTemplate('wicked template', {'foo': 'bar'});
            assert.strictEqual(result, 'wicked template');
            return callback();
        });

        /**
         * Test that verifies an empty templates returns an empty string
         */
        it('verify an empty template returns an empty string', function(callback) {
            // Verify an empty template returns null
            var result = AuthenticationUtil.renderTemplate('', {'foo': 'bar'});
            assert.strictEqual(result, '');
            return callback();
        });

        /**
         * Test that verifies that multiple variables can be specified
         */
        it('verify multiple variables can be specified', function(callback) {
            var template = '{var1}{var2}{var3}';
            var data = {
                'var1': 'foo',
                'var2': 'bar',
                'var3': 'baz'
            };
            var result = AuthenticationUtil.renderTemplate(template, data);
            assert.strictEqual(result, 'foobarbaz');
            return callback();
        });

        /**
         * Test that verifies that a variable can be used more than once
         */
        it('verify a variable can be used more than once', function(callback) {
            var template = '{var1}{var1}{var1}';
            var data = {
                'var1': 'foo',
                'var2': 'bar',
                'var3': 'baz'
            };
            var result = AuthenticationUtil.renderTemplate(template, data);
            assert.strictEqual(result, 'foofoofoo');
            return callback();
        });

        /**
         * Test that verifies unmatched variables are replaced with an empty string
         */
        it('verify unmatched variables are replaced with an empty string', function(callback) {
            var template = '{var1}{var2}{var3}';
            var data = {};
            var result = AuthenticationUtil.renderTemplate(template, data);
            assert.strictEqual(result, '');
            return callback();
        });

        /**
         * Test that verifies the data object and template string remain the same
         */
        it('verify the data object and template string remain the same', function(callback) {
            var data = {'var1': 'foo'};
            var template = '{var1}';
            var result = AuthenticationUtil.renderTemplate(template, data);
            assert.strictEqual(result, 'foo');

            assert.strictEqual(_.keys(data).length, 1);
            assert.strictEqual(data['var1'], 'foo');
            assert.strictEqual(template, '{var1}');
            return callback();
        });
    });
});
