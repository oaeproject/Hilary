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

import assert from 'assert';

import * as TestsUtil from 'oae-tests/lib/util';
import * as ElasticSearch from 'oae-search/lib/internal/elasticsearch';

import { assoc } from 'ramda';

describe('ElasticSearch', function() {
  /**
   * Test that verifies the ability to create, verify (check "exists") and delete an ElasticSearch index
   */
  it('verify create, verify and delete index', callback => {
    const indexName = TestsUtil.generateTestElasticSearchName('oaetest-create-verify-delete');

    ElasticSearch.indexExists(indexName, (err, exists) => {
      assert.ok(!err);
      assert.ok(!exists);

      ElasticSearch.createIndex(indexName, {}, err => {
        assert.ok(!err);

        ElasticSearch.indexExists(indexName, (err, exists) => {
          assert.ok(!err);
          assert.ok(exists);

          ElasticSearch.deleteIndex(indexName, err => {
            assert.ok(!err);

            ElasticSearch.indexExists(indexName, (err, exists) => {
              assert.ok(!err);
              assert.ok(!exists);

              callback();
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies there is no error when trying to create an index that already exists. It should just leave it alone
   */
  it('verify no error creating existing index', callback => {
    const indexName = TestsUtil.generateTestElasticSearchName('oaetest-create-nonerror-existing');

    ElasticSearch.indexExists(indexName, (err, exists) => {
      assert.ok(!err);
      assert.ok(!exists);

      ElasticSearch.createIndex(indexName, {}, err => {
        assert.ok(!err);

        ElasticSearch.createIndex(indexName, {}, err => {
          assert.ok(!err);

          ElasticSearch.deleteIndex(indexName, err => {
            assert.ok(!err);

            callback();
          });
        });
      });
    });
  });

  /**
   * Test that verifies there is no error when trying to delete a non-existing index
   */
  it('verify no error deleting non-existing index', callback => {
    const indexName = TestsUtil.generateTestElasticSearchName('oaetest-delete-nonerror-existing');

    ElasticSearch.indexExists(indexName, (err, exists) => {
      assert.ok(!err);
      assert.ok(!exists);

      ElasticSearch.deleteIndex(indexName, err => {
        assert.ok(!err);

        callback();
      });
    });
  });

  /**
   * Test that verifies the ability to create and verify the existence of resource mappings
   */
  it('verify put, verify mappings', callback => {
    const fieldName = TestsUtil.generateTestElasticSearchName('oaetest-put-verify-mappings');

    ElasticSearch.mappingExists(fieldName, (err, exists) => {
      assert.ok(!err);
      assert.ok(!exists);

      const fieldProperties = assoc(fieldName, { type: 'text' }, {});

      ElasticSearch.putMapping(null, fieldProperties, null, err => {
        assert.ok(!err);

        ElasticSearch.mappingExists(fieldName, (err, exists) => {
          assert.ok(!err);
          assert.ok(exists);

          callback();
        });
      });
    });
  });

  /**
   * Test that verifies no error occurrs when trying to create a resource mapping
   * by a name that already exists
   */
  it('verify no error creating existing mapping', callback => {
    const fieldName = TestsUtil.generateTestElasticSearchName('oaetest-error-creating-existing');

    ElasticSearch.mappingExists(fieldName, (err, exists) => {
      assert.ok(!err);
      assert.ok(!exists);

      const fieldProperties = assoc(fieldName, { type: 'text' }, {});

      ElasticSearch.putMapping(null, fieldProperties, null, err => {
        assert.ok(!err);

        ElasticSearch.putMapping(null, fieldProperties, null, err => {
          assert.ok(!err);

          callback();
        });
      });
    });
  });
});
