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

const assert = require('assert');
const _ = require('underscore');

const MqTestsUtil = require('oae-util/lib/test/mq-util');
const RestAPI = require('oae-rest');

const SearchAPI = require('oae-search');
const ElasticSearch = require('oae-search/lib/internal/elasticsearch');
const { SearchConstants } = require('oae-search/lib/constants');

/**
 * Completely empty out the search index
 *
 * @param  {Function}           callback    Standard callback function
 * @throws {AssertionError}                 Thrown if an error occurs
 */
const deleteAll = function(callback) {
  whenIndexingComplete(() => {
    // Destroy and rebuild the search schema, as well as all documents inside it
    SearchAPI.buildIndex(true, err => {
      assert.ok(!err);
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
const reindexAll = function(globalAdminRestCtx, callback) {
  RestAPI.Search.reindexAll(globalAdminRestCtx, err => {
    assert.ok(!err);

    // When the reindex-all task has completed, we have a guarantee that all index tasks
    // have been recognized by MQ
    return whenIndexingComplete(callback);
  });
};

/**
 * Ensure that the given search completes successfully
 *
 * @see RestAPI.Search#search for the meaning of the method parameters.
 */
const assertSearchSucceeds = function(restCtx, searchType, params, opts, callback) {
  whenIndexingComplete(() => {
    RestAPI.Search.search(restCtx, searchType, params, opts, (err, response) => {
      assert.ok(!err);
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
const assertSearchContains = function(restCtx, searchType, params, opts, containIds, callback) {
  setTimeout(searchAll, 200, restCtx, searchType, params, opts, (err, response) => {
    assert.ok(!err);
    assert.deepStrictEqual(
      _.chain(response.results)
        .pluck('id')
        .intersection(containIds)
        .value()
        .sort(),
      containIds.slice().sort()
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
const assertSearchNotContains = function(
  restCtx,
  searchType,
  params,
  opts,
  notContainIds,
  callback
) {
  searchAll(restCtx, searchType, params, opts, (err, response) => {
    assert.ok(!err);
    assert.ok(
      _.chain(response.results)
        .pluck('id')
        .intersection(notContainIds)
        .isEmpty()
        .value()
    );
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
const assertSearchEquals = function(restCtx, searchType, params, opts, expectedIds, callback) {
  searchAll(restCtx, searchType, params, opts, (err, response) => {
    assert.ok(!err);
    assert.deepStrictEqual(_.pluck(response.results, 'id').sort(), expectedIds.slice().sort());
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
const assertSearchFails = function(restCtx, searchType, params, opts, httpCode, callback) {
  whenIndexingComplete(() => {
    RestAPI.Search.search(restCtx, searchType, params, opts, (err, data) => {
      assert.ok(err);
      assert.strictEqual(err.code, httpCode);
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
const searchAll = function(restCtx, searchType, params, opts, callback) {
  opts = _.extend({}, opts);

  whenIndexingComplete(() => {
    // Search first with a limit of 1. This is to get the total number of documents available to search
    opts.limit = 1;
    searchRefreshed(restCtx, searchType, params, opts, (err, result) => {
      if (err) {
        return callback(err);
      }
      if (result.total === 0) {
        // We got 0 documents, just return the result as-is
        return callback(null, result);
      }

      // An object that will resemble all the results
      const allData = { total: result.total, results: [] };

      // There are more results, search for everything. Don't refresh this time since we already did for the previous query (if specified)
      const getMoreResults = function() {
        opts.start = allData.results.length;
        opts.limit = 25;
        RestAPI.Search.search(restCtx, searchType, params, opts, (err, data) => {
          if (err) {
            return callback(err);
          }
          if (_.isEmpty(data.results)) {
            // There are no more new results coming back which means we've got them all
            return callback(null, allData);
          }

          // Add the new results
          allData.results = allData.results.concat(data.results);

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
const whenIndexingComplete = function(callback) {
  MqTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_REINDEX_ALL, () => {
    MqTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_INDEX_DOCUMENT, () => {
      MqTestsUtil.whenTasksEmpty(SearchConstants.mq.TASK_DELETE_DOCUMENT, () => {
        ElasticSearch.refresh(err => {
          assert.ok(!err);
          return callback();
        });
      });
    });
  });
};

/**
 * Perform a search with the given parameters, but first perform a delay and then a `SearchAPI.Search.refresh`. This is
 * useful for tests, where we need to allow time for an indexing event to take place before performing a validation.
 *
 * @see RestAPI.Search#search for the meaning of the method parameters.
 */
const searchRefreshed = function(restCtx, searchType, params, opts, callback) {
  whenIndexingComplete(() => {
    RestAPI.Search.search(restCtx, searchType, params, opts, callback);
  });
};

module.exports = {
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
