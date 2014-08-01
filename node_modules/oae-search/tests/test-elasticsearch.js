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

var assert = require('assert');

var TestsUtil = require('oae-tests/lib/util');

var ElasticSearch = require('oae-search/lib/internal/elasticsearch');

describe('ElasticSearch', function() {

    /**
     * Test that verifies the ability to create, verify (check "exists") and delete an ElasticSearch index
     */
    it('verify create, verify and delete index', function(callback) {
        var indexName = TestsUtil.generateTestElasticSearchName('oaetest-create-verify-delete');
        ElasticSearch.indexExists(indexName, function(err, exists) {
            assert.ok(!err);
            assert.ok(!exists);

            ElasticSearch.createIndex(indexName, {}, function(err) {
                assert.ok(!err);

                ElasticSearch.indexExists(indexName, function(err, exists) {
                    assert.ok(!err);
                    assert.ok(exists);

                    ElasticSearch.deleteIndex(indexName, function(err) {
                        assert.ok(!err);

                        ElasticSearch.indexExists(indexName, function(err, exists) {
                            assert.ok(!err);
                            assert.ok(!exists);
                            return callback();
                        });
                    });
                });
            });
        });
    });

    /**
     * Test that verifies there is no error when trying to create an index that already exists. It should just leave it alone
     */
    it('verify no error creating existing index', function(callback) {
        var indexName = TestsUtil.generateTestElasticSearchName('oaetest-create-nonerror-existing');
        ElasticSearch.indexExists(indexName, function(err, exists) {
            assert.ok(!err);
            assert.ok(!exists);

            ElasticSearch.createIndex(indexName, {}, function(err) {
                assert.ok(!err);

                ElasticSearch.createIndex(indexName, {}, function(err) {
                    assert.ok(!err);

                    ElasticSearch.deleteIndex(indexName, function(err) {
                        assert.ok(!err);
                        return callback();
                    });
                });
            });
        });
    });

    /**
     * Test that verifies there is no error when trying to delete a non-existing index
     */
    it('verify no error deleting non-existing index', function(callback) {
        var indexName = TestsUtil.generateTestElasticSearchName('oaetest-delete-nonerror-existing');
        ElasticSearch.indexExists(indexName, function(err, exists) {
            assert.ok(!err);
            assert.ok(!exists);

            ElasticSearch.deleteIndex(indexName, function(err) {
                assert.ok(!err);
                return callback();
            });
        });
    });

    /**
     * Test that verifies the ability to create and verify the existence of resource mappings
     */
    it('verify put, verify mappings', function(callback) {
        var typeName = TestsUtil.generateTestElasticSearchName('oaetest-put-verify-mappings');
        ElasticSearch.mappingExists(typeName, function(err, exists) {
            assert.ok(!err);
            assert.ok(!exists);

            ElasticSearch.putMapping(typeName, {'testField': {'type': 'string'}}, null, function(err) {
                assert.ok(!err);

                ElasticSearch.mappingExists(typeName, function(err, exists) {
                    assert.ok(!err);
                    assert.ok(exists);
                    return callback();
                });
            });
        });
    });

    /**
     * Test that verifies no error occurrs when trying to create a resource mapping by a name that already exists
     */
    it('verify no error creating existing mapping', function(callback) {
        var typeName = TestsUtil.generateTestElasticSearchName('oaetest-error-creating-existing');
        ElasticSearch.mappingExists(typeName, function(err, exists) {
            assert.ok(!err);
            assert.ok(!exists);

            ElasticSearch.putMapping(typeName, {'testField': {'type': 'string'}}, null, function(err) {
                assert.ok(!err);

                ElasticSearch.putMapping(typeName, {'testField': {'type': 'string'}}, null, function(err) {
                    assert.ok(!err);
                    return callback();
                });
            });
        });
    });
});
