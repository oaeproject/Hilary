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
  it('verify create, verify and delete index', async () => {
    const indexName = generateTestElasticSearchName('oaetest-create-verify-delete');

    let exists = await indexExists(indexName);
    assert.ok(not(exists));

    await createIndex(indexName, {});

    exists = await indexExists(indexName);
    assert.ok(exists);

    await deleteIndex(indexName);

    exists = await indexExists(indexName);
    assert.ok(not(exists));
  });

  /**
   * Test that verifies there is no error when trying to create an index that already exists. It should just leave it alone
   */
  it('verify no error creating existing index', async () => {
    const indexName = generateTestElasticSearchName('oaetest-create-nonerror-existing');

    const exists = await indexExists(indexName);
    assert.ok(not(exists));

    await createIndex(indexName, {});
    await createIndex(indexName, {});

    await deleteIndex(indexName);
  });

  /**
   * Test that verifies there is no error when trying to delete a non-existing index
   */
  it('verify no error deleting non-existing index', async () => {
    const indexName = generateTestElasticSearchName('oaetest-delete-nonerror-existing');

    const exists = await indexExists(indexName);
    assert.ok(not(exists));

    await deleteIndex(indexName);
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
