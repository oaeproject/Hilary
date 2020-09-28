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

/* eslint-disable camelcase */
import { assert } from 'chai';

import { getResourceFromId } from 'oae-authz/lib/util';
import { whenTasksEmpty } from 'oae-util/lib/test/mq-util';
import * as RestAPI from 'oae-rest';
import {
  registerChildSearchDocument,
  registerReindexAllHandler,
  registerSearch,
  search,
  registerSearchDocumentProducer,
  registerSearchDocumentTransformer,
  postIndexTask
} from 'oae-search';
import { subscribe, unsubscribe } from 'oae-util/lib/mq';
import {
  createTenantRestContext,
  createGlobalRestContext,
  generateTestUsers,
  createGlobalAdminRestContext,
  createTenantAdminRestContext
} from 'oae-tests/lib/util';
import { SearchConstants } from 'oae-search/lib/constants';

import { compose, forEach, prop, of } from 'ramda';

const { reindexAll } = RestAPI.Search;

const TEXT_TYPE = 'text';
const NO_STORE = 'false';
const NOT_ANALYZED = 'true';
const T = 't';
const EMPTY_OBJECT = {};

const getId = prop('id');
const getResourceType = prop('resourceType');

describe('Search API', () => {
  let asAnonymousUserFromCambridge = null;
  let asGlobalAdmin = null;
  let asTenantAdminOnCambridge = null;

  before(callback => {
    asAnonymousUserFromCambridge = createTenantRestContext(global.oaeTests.tenants.cam.host);
    asGlobalAdmin = createGlobalAdminRestContext();
    asTenantAdminOnCambridge = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // Unbind the current handler, if any
    unsubscribe(SearchConstants.mq.TASK_REINDEX_ALL, err => {
      assert.notExists(err);

      /*!
       * Task handler that will just drain the queue.
       *
       * @see TaskQueue#bind
       */
      const _handleTaskDrain = (data, done) => {
        // Simply callback, which acknowledges messages without doing anything.
        done();
      };

      // Drain the queue
      subscribe(SearchConstants.mq.TASK_REINDEX_ALL, _handleTaskDrain, err => {
        assert.notExists(err);
        callback();
      });
    });
  });

  /**
   * Test that verifies an error is thrown when registering a document transformer that already exists.
   */
  it('verify cannot register non-unique search document transformers', callback => {
    registerSearchDocumentTransformer('test-registerSearchDocumentTransformer', () => {});

    // Try and register a second transformer of the same type, log the error and verify it happened.
    assert.throws(() => {
      registerSearchDocumentTransformer('test-registerSearchDocumentTransformer', () => {});
    }, Error);

    return callback();
  });

  /**
   * Test that verifies an error is thrown when registering a document producer that already exists.
   */
  it('verify cannot register non-unique search document producers', callback => {
    registerSearchDocumentProducer('test-registerSearchDocumentProducer', () => {});

    // Try and register a second producer of the same type
    assert.throws(() => {
      registerSearchDocumentProducer('test-registerSearchDocumentProducer', () => {});
    }, Error);

    return callback();
  });

  /**
   * Test that verifies an error is thrown when registering a search type that already exists.
   */
  it('verify cannot register a non-unique search type', callback => {
    registerSearch('test-registerSearch', () => {});

    // Try and register a second search of the same id, log the error and verify it happened.
    assert.throws(() => {
      registerSearch('test-registerSearch', () => {});
    }, Error);

    return callback();
  });

  /**
   * Test that verifies an error is thrown when registering a reindex all handler that already exists
   */
  it('verify cannot register non-unique search reindex all handler', callback => {
    registerReindexAllHandler('test-registerReindexAllHandler', () => {});

    // Try and register a second handler of the same id, log the error and verify it happened.
    assert.throws(() => {
      registerReindexAllHandler('test-registerReindexAllHandler', () => {});
    }, Error);

    return callback();
  });

  /**
   * Test that verifies an error is thrown when registering a reindex all handler that already exists
   */
  it('verify cannot register non-unique child search document type', callback => {
    const options = {
      schema: {
        test_field_name: {
          type: TEXT_TYPE,
          store: NO_STORE,
          index: NOT_ANALYZED
        }
      },
      producer(resources, callback) {
        return callback(null, []);
      }
    };

    registerChildSearchDocument('test-registerChildSearchDocument', options, err => {
      assert.notExists(err);

      // Try and register a second handler of the same id, log the error and verify it happened.
      registerChildSearchDocument('test-registerChildSearchDocument', options, err => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);

        return callback();
      });
    });
  });

  /**
   * Test that verifies an error occurrs when trying to invoke an invalid search type.
   */
  it('verify cannot search invalid type', callback => {
    search(EMPTY_OBJECT, 'not-a-search-type', EMPTY_OBJECT, (err /* , docs */) => {
      assert.ok(err);
      assert.strictEqual(err.code, 400);

      callback();
    });
  });

  /**
   * Test that verifies when reindex all is triggered through the REST endpoint, a task is triggered.
   */
  it('verify reindex all triggers an mq task', callback => {
    // Unbind the current handler, if any
    unsubscribe(SearchConstants.mq.TASK_REINDEX_ALL, err => {
      assert.notExists(err);

      /*!
       * Simply call the test callback to continue tests. If this is not invoked, the test will timeout
       * and fail.
       *
       * @see TaskQueue#bind
       */
      const _handleTask = function(data, done) {
        done();
        callback();
      };

      // Bind the handler to invoke the callback when the test passes
      subscribe(SearchConstants.mq.TASK_REINDEX_ALL, _handleTask, err => {
        assert.notExists(err);

        // Reprocess previews
        reindexAll(asGlobalAdmin, err => {
          assert.notExists(err);
        });
      });
    });
  });

  /**
   * Test that verifies when previews are reprocessed through the REST endpoint, a task is triggered.
   */
  it('verify non-global admin users cannot trigger reindex all', callback => {
    // Unbind the current handler, if any
    unsubscribe(SearchConstants.mq.TASK_REINDEX_ALL, err => {
      assert.notExists(err);

      /*!
       * Task handler that will fail the test if invoked.
       *
       * @see TaskQueue#bind
       */
      const _handleTaskFail = function(data, done) {
        done();
        assert.fail('Did not expect the task to be invoked.');
      };

      /**
       * Bind a handler to handle the task that invokes an assertion failure,
       * as no task should be triggered from this test
       */
      subscribe(SearchConstants.mq.TASK_REINDEX_ALL, _handleTaskFail, err => {
        assert.notExists(err);

        // Generate a normal user with which to try and reprocess previews
        generateTestUsers(asTenantAdminOnCambridge, 1, (err, users) => {
          assert.notExists(err);

          const { 0: johnDoe } = users;
          const asJohnDoe = johnDoe.restContext;

          // Verify that an anonymous user-tenant user cannot reprocess previews
          reindexAll(asAnonymousUserFromCambridge, err => {
            assert.ok(err);

            /**
             * The user-tenant currently doesn't have this end-point.
             * This assertion simply ensures that no regression comes in
             * here if it is introduced as an endpoint
             */
            assert.strictEqual(err.code, 404);

            // Verify that an anonymous global-tenant user cannot reprocess previews
            reindexAll(createGlobalRestContext(), err => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);

              // Verify that a regular user cannot generate a task
              reindexAll(asJohnDoe, err => {
                assert.ok(err);

                /**
                 * The user-tenant currently doesn't have this end-point.
                 * This assertion simply ensures that no regression comes in here
                 * if it is introduced as an endpoint
                 */
                assert.strictEqual(err.code, 404);

                // Verify that a tenant admin cannot generate a task
                reindexAll(asTenantAdminOnCambridge, err => {
                  assert.ok(err);

                  // The user-tenant currently doesn't have this end-point. This assertion simply ensures
                  // that no regression comes in here if it is introduced as an endpoint
                  assert.strictEqual(err.code, 404);

                  return callback();
                });
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies resourceTypes array filters resource types
   */
  it('verify specifying child document resource types filters the resource types', callback => {
    let invoked = 0;

    registerChildSearchDocument(
      'test_filter_types',
      {
        resourceTypes: of('test_resource_type'),
        schema: {
          test_field_name: {
            type: TEXT_TYPE,
            store: NO_STORE,
            index: NOT_ANALYZED
          }
        },
        producer(resources, callback) {
          invoked++;

          callback(null, []);

          forEach(resource => {
            // Make sure we only ever get content items
            assert.strictEqual(compose(getResourceType, getResourceFromId, getId)(resource), T);
          }, resources);
        }
      },
      err => {
        assert.notExists(err);

        // Send an index task of a document of the proper resource type
        postIndexTask('test_resource_type', of({ id: 't:cam:test' }), { children: true }, err => {
          assert.notExists(err);

          // Send an index task of a document of not the proper resource type
          postIndexTask('not_test_resource_type', of({ id: 'n:cam:test' }), { children: true }, err => {
            assert.notExists(err);

            // Wait for the producers to be invoked
            whenTasksEmpty(SearchConstants.mq.TASK_INDEX_DOCUMENT, () => {
              whenTasksEmpty(SearchConstants.mq.TASK_INDEX_DOCUMENT_PROCESSING, () => {
                // Ensure only the proper resource type invoked the producer
                assert.strictEqual(invoked, 1);

                return callback();
              });
            });
          });
        });
      }
    );
  });

  /**
   * Test that verifies an unspecified resource type array results in all documents sent to a child document producer
   */
  it('verify unspecifyied child document resource type accepts all resource types', callback => {
    let invoked = 0;

    registerChildSearchDocument(
      'test_filter_no_types',
      {
        schema: {
          test_field_name: {
            type: TEXT_TYPE,
            store: NO_STORE,
            index: NOT_ANALYZED
          }
        },
        producer(resources, callback) {
          invoked++;
          return callback(null, []);
        }
      },
      err => {
        assert.notExists(err);

        // Send an index task of a document of the proper resource type
        postIndexTask('test_resource_type', of({ id: 't:cam:test' }), { children: true }, err => {
          assert.notExists(err);

          // Send an index task of a document of not the proper resource type
          postIndexTask('another_test_resource_type', of({ id: 'n:cam:test' }), { children: true }, err => {
            assert.notExists(err);

            // Wait for the producers to be invoked
            whenTasksEmpty(SearchConstants.mq.TASK_INDEX_DOCUMENT, () => {
              whenTasksEmpty(SearchConstants.mq.TASK_INDEX_DOCUMENT_PROCESSING, () => {
                // Ensure only the proper resource type invoked the producer
                assert.strictEqual(invoked, 2);

                return callback();
              });
            });
          });
        });
      }
    );
  });
});
