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

import { callbackify } from 'node:util';
import { assert } from 'chai';
import _ from 'underscore';

import * as MqTestsUtil from 'oae-util/lib/test/mq-util.js';
import * as RestAPI from 'oae-rest';

import * as SearchAPI from 'oae-search';
import * as ElasticSearch from 'oae-search/lib/internal/elasticsearch.js';
import { SearchConstants } from 'oae-search/lib/constants.js';
import { prop, isEmpty } from 'ramda';

const { buildIndex } = SearchAPI;

/**
 * Completely empty out the search index
 *
 * @param  {Function}           callback    Standard callback function
 * @throws {AssertionError}                 Thrown if an error occurs
 */
const deleteAll = (callback) => {
  whenIndexingComplete(() => {
    // Destroy and rebuild the search schema, as well as all documents inside it
    buildIndex(true, (error) => {
      assert.notExists(error);
      return callback();
    });
  });
};

/**
 * Re-index everything in the search index
 *
 * @param  {RestContext}        globalAdminRestCtx  The global admin rest context
 * @param  {Function}           callback            Standard callback function
 * @throws {AssertionError}                         Thrown if an error occurrs
 */
const reindexAll = (globalAdminRestCtx, callback) => {
  RestAPI.Search.reindexAll(globalAdminRestCtx, (error) => {
    assert.notExists(error);

    /**
     * When the reindex-all task has completed, we have a guarantee that all
     * index tasks have been recognized by MQ
     */
    return whenIndexingComplete(callback);
  });
};

/**
 * Ensure that the given search completes successfully
 *
 * @see RestAPI.Search#search for the meaning of the method parameters.
 */
const assertSearchSucceeds = function (restCtx, searchType, parameters, options, callback) {
  whenIndexingComplete(() => {
    RestAPI.Search.search(restCtx, searchType, parameters, options, (error, response) => {
      assert.notExists(error);
      return callback(response);
    });
  });
};

/**
 * Ensure that the given search contains a document for each id provided in the `containIds` array
 *
 * @param  {RestContext}    restCtx             The REST context with which to invoke the search requests
 * @param  {String}         searchType          The type of search, as per RestAPI.Search#search
 * @param  {String[]}       [params]            The search parameters, as per RestAPI.Search#search
 * @param  {Object}         [opts]              The search options, as per RestAPI.Search#search
 * @param  {String[]}       containIds          The ids that must be found in the search
 * @param  {Function}       callback            Invoked when all assertions succeed
 * @param  {Object}         callback.response   All search documents that were found with the search
 * @throws {AssertionError}                     Thrown if the search fails or not all ids are found in the results
 */
const assertSearchContains = function (restCtx, searchType, parameters, options, containIds, callback) {
  setTimeout(searchAll, 200, restCtx, searchType, parameters, options, (error, response) => {
    assert.notExists(error);
    assert.deepStrictEqual(
      _.chain(response.results).pluck('id').intersection(containIds).value().sort(),
      [...containIds].sort()
    );
    return callback(response);
  });
};

/**
 * Ensure that the given search does not contain any documents for any id provided in the `notContainIds` array
 *
 * @param  {RestContext}    restCtx             The REST context with which to invoke the search requests
 * @param  {String}         searchType          The type of search, as per RestAPI.Search#search
 * @param  {String[]}       [params]            The search parameters, as per RestAPI.Search#search
 * @param  {Object}         [opts]              The search options, as per RestAPI.Search#search
 * @param  {String[]}       notContainIds       The ids that must not be found in the search
 * @param  {Function}       callback            Invoked when all assertions succeed
 * @param  {Object}         callback.response   All search documents that were found with the search
 * @throws {AssertionError}                     Thrown if the search fails or any ids are found in the results
 */
const assertSearchNotContains = function (restCtx, searchType, parameters, options, notContainIds, callback) {
  searchAll(restCtx, searchType, parameters, options, (error, response) => {
    assert.notExists(error);
    assert.ok(_.chain(response.results).pluck('id').intersection(notContainIds).isEmpty().value());
    return callback(response);
  });
};

/**
 * Ensure that the given search contains all the documents (and only the documents) specified by the
 * expected ids
 *
 * @param  {RestContext}    restCtx             The REST context with which to invoke the search requests
 * @param  {String}         searchType          The type of search, as per RestAPI.Search#search
 * @param  {String[]}       [params]            The search parameters, as per RestAPI.Search#search
 * @param  {Object}         [opts]              The search options, as per RestAPI.Search#search
 * @param  {String[]}       expectedIds         The list of document ids we expect to get from the search
 * @param  {Function}       callback            Invoked when all assertions succeed
 * @param  {Object}         callback.response   All search documents that were found with the search
 * @throws {AssertionError}                     Thrown if the search fails or if the results do not match the expected ids
 */
const assertSearchEquals = function (restCtx, searchType, parameters, options, expectedIds, callback) {
  searchAll(restCtx, searchType, parameters, options, (error, response) => {
    assert.notExists(error);
    assert.deepStrictEqual(_.pluck(response.results, 'id').sort(), [...expectedIds].sort());
    return callback(response);
  });
};

/**
 * Ensure that the given search does not contain any documents for any id provided in the `notContainIds` array
 *
 * @param  {RestContext}    restCtx     The REST context with which to invoke the search requests
 * @param  {String}         searchType  The type of search, as per RestAPI.Search#search
 * @param  {String[]}       [params]    The search parameters, as per RestAPI.Search#search
 * @param  {Object}         [opts]      The search options, as per RestAPI.Search#search
 * @param  {Number}         httpCode    The expected HTTP code of the failure
 * @param  {Function}       callback    Invoked when the search fails with the expected http code
 * @throws {AssertionError}             Thrown if the search succeeds, or fails in a manner that was not expected
 */
const assertSearchFails = function (restCtx, searchType, parameters, options, httpCode, callback) {
  whenIndexingComplete(() => {
    RestAPI.Search.search(restCtx, searchType, parameters, options, (error, data) => {
      assert.ok(error);
      assert.strictEqual(error.code, httpCode);
      assert.ok(!data);
      return callback();
    });
  });
};

/**
 * Search for all the documents that match the query. This bypasses paging, meaning all the results will be
 * returned, regardless of the limit set in the `opts`. This is useful for tests where the data-set grows
 * indeterministically with more tests. This test always includes an index refresh, as described by
 * @see #searchRefreshed
 *
 * @see RestAPI.Search#search for the meaning of the method parameters.
 */
const searchAll = function (restCtx, searchType, parameters, options, callback) {
  options = _.extend({}, options);

  whenIndexingComplete(() => {
    // Search first with a limit of 1. This is to get the total number of documents available to search
    options.size = 1;
    searchRefreshed(restCtx, searchType, parameters, options, (error, result) => {
      if (error) return callback(error);

      const totalResults = prop('total', result);

      if (totalResults === 0) {
        // We got 0 documents, just return the result as-is
        return callback(null, result);
      }

      // An object that will resemble all the results
      const allData = { total: totalResults, results: [] };

      // There are more results, search for everything. Don't refresh this time since we already did for the previous query (if specified)
      const getMoreResults = function () {
        options.from = allData.results.length;
        options.size = 25;

        RestAPI.Search.search(restCtx, searchType, parameters, options, (error, data) => {
          if (error) return callback(error);

          // There are no more new results coming back which means we've got them all
          if (isEmpty(data.results)) return callback(null, allData);

          // Add the new results
          allData.results = [...allData.results, ...data.results];

          // Search for more results
          getMoreResults();
        });
      };

      // Start retrieving them all
      getMoreResults();
    });
  });
};

/**
 * Invoke the provided function when all search indexing tasks are completed and search is up to
 * date with all updates that have been fired to it
 *
 * @param  {Function}   callback    Invoked when all search indexing tasks are complete
 */
const whenIndexingComplete = function (callback) {
  MqTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_REINDEX_ALL, () => {
    MqTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_REINDEX_ALL_PROCESSING, () => {
      MqTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_INDEX_DOCUMENT, () => {
        MqTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_INDEX_DOCUMENT_PROCESSING, () => {
          MqTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_DELETE_DOCUMENT, () => {
            MqTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_DELETE_DOCUMENT_PROCESSING, () => {
              callbackify(ElasticSearch.refresh)((error) => {
                assert.notExists(error);
                return callback();
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Perform a search with the given parameters, but first perform a delay and
 * then a `SearchAPI.Search.refresh`. This is
 * useful for tests, where we need to allow time for an indexing event
 * to take place before performing a validation.
 *
 * @see RestAPI.Search#search for the meaning of the method parameters.
 */
const searchRefreshed = function (restCtx, searchType, parameters, options, callback) {
  whenIndexingComplete(() => {
    RestAPI.Search.search(restCtx, searchType, parameters, options, callback);
  });
};

export {
  deleteAll,
  reindexAll,
  assertSearchSucceeds,
  assertSearchContains,
  assertSearchNotContains,
  assertSearchEquals,
  assertSearchFails,
  searchAll,
  whenIndexingComplete,
  searchRefreshed
};
