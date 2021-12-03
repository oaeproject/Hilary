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

import { callbackify } from 'node:util';
import { assert } from 'chai';

import { generateTestElasticSearchName } from 'oae-tests/lib/util.js';
import {
  putMapping,
  mappingExists,
  indexExists,
  createIndex,
  deleteIndex
} from 'oae-search/lib/internal/elasticsearch.js';

import { not, assoc } from 'ramda';

const NO_OPTIONS = null;

describe('ElasticSearch', () => {
  /**
   * Test that verifies the ability to create, verify (check "exists") and delete an ElasticSearch index
   */
  it('verify create, verify and delete index', (callback) => {
    const indexName = generateTestElasticSearchName('oaetest-create-verify-delete');

    callbackify(indexExists)(indexName, (error, exists) => {
      assert.ok(not(error));
      assert.ok(not(exists));

      callbackify(createIndex)(indexName, {}, (error_) => {
        assert.ok(not(error_));

        callbackify(indexExists)(indexName, (error, exists) => {
          assert.ok(not(error));
          assert.ok(exists);

          callbackify(deleteIndex)(indexName, (error_) => {
            assert.ok(not(error_));

            callbackify(indexExists)(indexName, (error, exists) => {
              assert.ok(not(error));
              assert.ok(not(exists));

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
  it('verify no error creating existing index', (callback) => {
    const indexName = generateTestElasticSearchName('oaetest-create-nonerror-existing');

    callbackify(indexExists)(indexName, (error, exists) => {
      assert.ok(not(error));
      assert.ok(not(exists));

      callbackify(createIndex)(indexName, {}, (error_) => {
        assert.ok(not(error_));

        callbackify(createIndex)(indexName, {}, (error_) => {
          assert.ok(not(error_));

          callbackify(deleteIndex)(indexName, (error_) => {
            assert.ok(not(error_));

            callback();
          });
        });
      });
    });
  });

  /**
   * Test that verifies there is no error when trying to delete a non-existing index
   */
  it('verify no error deleting non-existing index', (callback) => {
    const indexName = generateTestElasticSearchName('oaetest-delete-nonerror-existing');

    callbackify(indexExists)(indexName, (error, exists) => {
      assert.ok(not(error));
      assert.ok(not(exists));

      callbackify(deleteIndex)(indexName, (error_) => {
        assert.ok(not(error_));

        callback();
      });
    });
  });

  /**
   * Test that verifies the ability to create and verify the existence of resource mappings
   */
  it('verify put, verify mappings', async () => {
    const fieldName = generateTestElasticSearchName('oaetest-put-verify-mappings');

    let exists = await mappingExists(fieldName);
    assert.isFalse(exists);

    const fieldProperties = assoc(fieldName, { type: 'text' }, {});
    await putMapping(fieldProperties, NO_OPTIONS);

    exists = await mappingExists(fieldName);
    assert.ok(exists);
  });

  /**
   * Test that verifies no error occurrs when trying to create a resource mapping
   * by a name that already exists
   */
  it('verify no error creating existing mapping', async () => {
    const fieldName = generateTestElasticSearchName('oaetest-error-creating-existing');

    const exists = await mappingExists(fieldName);
    assert.ok(not(exists));

    const fieldProperties = assoc(fieldName, { type: 'text' }, {});
    await putMapping(fieldProperties, NO_OPTIONS);

    await putMapping(fieldProperties, NO_OPTIONS);
  });
});
