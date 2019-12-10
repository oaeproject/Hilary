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
import assert from 'assert';
import _ from 'underscore';

import * as AuthzUtil from 'oae-authz/lib/util';
import * as MQTestsUtil from 'oae-util/lib/test/mq-util';
import * as RestAPI from 'oae-rest';
import * as SearchAPI from 'oae-search';
import * as MQ from 'oae-util/lib/mq';
import * as TestsUtil from 'oae-tests/lib/util';

import { SearchConstants } from 'oae-search/lib/constants';

describe('Search API', () => {
  // REST Contexts we will use to execute requests
  let anonymousRestContext = null;
  let globalAdminRestContext = null;
  let camAdminRestContext = null;

  before(callback => {
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // Unbind the current handler, if any
    MQ.unsubscribe(SearchConstants.mq.TASK_REINDEX_ALL, err => {
      assert.ok(!err);

      /*!
       * Task handler that will just drain the queue.
       *
       * @see TaskQueue#bind
       */
      const _handleTaskDrain = function(data, mqCallback) {
        // Simply callback, which acknowledges messages without doing anything.
        mqCallback();
      };

      // Drain the queue
      MQ.subscribe(SearchConstants.mq.TASK_REINDEX_ALL, _handleTaskDrain, err => {
        assert.ok(!err);
        callback();
      });
    });
  });

  /**
   * Test that verifies an error is thrown when registering a document transformer that already exists.
   */
  it('verify cannot register non-unique search document transformers', callback => {
    SearchAPI.registerSearchDocumentTransformer('test-registerSearchDocumentTransformer', () => {});

    // Try and register a second transformer of the same type, log the error and verify it happened.
    assert.throws(() => {
      SearchAPI.registerSearchDocumentTransformer('test-registerSearchDocumentTransformer', () => {});
    }, Error);

    return callback();
  });

  /**
   * Test that verifies an error is thrown when registering a document producer that already exists.
   */
  it('verify cannot register non-unique search document producers', callback => {
    SearchAPI.registerSearchDocumentProducer('test-registerSearchDocumentProducer', () => {});

    // Try and register a second producer of the same type
    assert.throws(() => {
      SearchAPI.registerSearchDocumentProducer('test-registerSearchDocumentProducer', () => {});
    }, Error);

    return callback();
  });

  /**
   * Test that verifies an error is thrown when registering a search type that already exists.
   */
  it('verify cannot register a non-unique search type', callback => {
    SearchAPI.registerSearch('test-registerSearch', () => {});

    // Try and register a second search of the same id, log the error and verify it happened.
    assert.throws(() => {
      SearchAPI.registerSearch('test-registerSearch', () => {});
    }, Error);

    return callback();
  });

  /**
   * Test that verifies an error is thrown when registering a reindex all handler that already exists
   */
  it('verify cannot register non-unique search reindex all handler', callback => {
    SearchAPI.registerReindexAllHandler('test-registerReindexAllHandler', () => {});

    // Try and register a second handler of the same id, log the error and verify it happened.
    assert.throws(() => {
      SearchAPI.registerReindexAllHandler('test-registerReindexAllHandler', () => {});
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
          type: 'string',
          store: 'no',
          index: 'not_analyzed'
        }
      },
      producer(resources, callback) {
        return callback(null, []);
      }
    };

    SearchAPI.registerChildSearchDocument('test-registerChildSearchDocument', options, err => {
      assert.ok(!err);

      // Try and register a second handler of the same id, log the error and verify it happened.
      SearchAPI.registerChildSearchDocument('test-registerChildSearchDocument', options, err => {
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
    SearchAPI.search({}, 'not-a-search-type', {}, (err, docs) => {
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
    MQ.unsubscribe(SearchConstants.mq.TASK_REINDEX_ALL, err => {
      assert.ok(!err);

      /*!
       * Simply call the test callback to continue tests. If this is not invoked, the test will timeout
       * and fail.
       *
       * @see TaskQueue#bind
       */
      const _handleTask = function(data, mqCallback) {
        mqCallback();
        callback();
      };

      // Bind the handler to invoke the callback when the test passes
      MQ.subscribe(SearchConstants.mq.TASK_REINDEX_ALL, _handleTask, err => {
        assert.ok(!err);

        // Reprocess previews
        RestAPI.Search.reindexAll(globalAdminRestContext, err => {
          assert.ok(!err);
        });
      });
    });
  });

  /**
   * Test that verifies when previews are reprocessed through the REST endpoint, a task is triggered.
   */
  it('verify non-global admin users cannot trigger reindex all', callback => {
    // Unbind the current handler, if any
    MQ.unsubscribe(SearchConstants.mq.TASK_REINDEX_ALL, err => {
      assert.ok(!err);

      /*!
       * Task handler that will fail the test if invoked.
       *
       * @see TaskQueue#bind
       */
      const _handleTaskFail = function(data, mqCallback) {
        mqCallback();
        assert.fail('Did not expect the task to be invoked.');
      };

      // Bind a handler to handle the task that invokes an assertion failure, as no task should be triggered from this test
      MQ.subscribe(SearchConstants.mq.TASK_REINDEX_ALL, _handleTaskFail, err => {
        assert.ok(!err);

        // Generate a normal user with which to try and reprocess previews
        TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
          assert.ok(!err);

          const userRestCtx = users[_.keys(users)[0]].restContext;

          // Verify that an anonymous user-tenant user cannot reprocess previews
          RestAPI.Search.reindexAll(anonymousRestContext, err => {
            assert.ok(err);

            // The user-tenant currently doesn't have this end-point. This assertion simply ensures
            // that no regression comes in here if it is introduced as an endpoint
            assert.strictEqual(err.code, 404);

            // Verify that an anonymous global-tenant user cannot reprocess previews
            RestAPI.Search.reindexAll(TestsUtil.createGlobalRestContext(), err => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);

              // Verify that a regular user cannot generate a task
              RestAPI.Search.reindexAll(userRestCtx, err => {
                assert.ok(err);

                // The user-tenant currently doesn't have this end-point. This assertion simply ensures
                // that no regression comes in here if it is introduced as an endpoint
                assert.strictEqual(err.code, 404);

                // Verify that a tenant admin cannot generate a task
                RestAPI.Search.reindexAll(camAdminRestContext, err => {
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

    SearchAPI.registerChildSearchDocument(
      'test_filter_types',
      {
        resourceTypes: ['test_resource_type'],
        schema: {
          test_field_name: {
            type: 'string',
            store: 'no',
            index: 'not_analyzed'
          }
        },
        producer(resources, callback) {
          invoked++;

          callback(null, []);

          _.each(resources, resource => {
            // Make sure we only ever get content items
            assert.strictEqual(AuthzUtil.getResourceFromId(resource.id).resourceType, 't');
          });
        }
      },
      err => {
        assert.ok(!err);

        // Send an index task of a document of the proper resource type
        SearchAPI.postIndexTask('test_resource_type', [{ id: 't:cam:test' }], { children: true }, err => {
          assert.ok(!err);

          // Send an index task of a document of not the proper resource type
          SearchAPI.postIndexTask('not_test_resource_type', [{ id: 'n:cam:test' }], { children: true }, err => {
            // Wait for the producers to be invoked
            MQTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_INDEX_DOCUMENT, () => {
              MQTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_INDEX_DOCUMENT_PROCESSING, () => {
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

    SearchAPI.registerChildSearchDocument(
      'test_filter_no_types',
      {
        schema: {
          test_field_name: {
            type: 'string',
            store: 'no',
            index: 'not_analyzed'
          }
        },
        producer(resources, callback) {
          invoked++;
          return callback(null, []);
        }
      },
      err => {
        assert.ok(!err);

        // Send an index task of a document of the proper resource type
        SearchAPI.postIndexTask('test_resource_type', [{ id: 't:cam:test' }], { children: true }, err => {
          assert.ok(!err);

          // Send an index task of a document of not the proper resource type
          SearchAPI.postIndexTask('another_test_resource_type', [{ id: 'n:cam:test' }], { children: true }, err => {
            // Wait for the producers to be invoked
            MQTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_INDEX_DOCUMENT, () => {
              MQTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_INDEX_DOCUMENT_PROCESSING, () => {
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
