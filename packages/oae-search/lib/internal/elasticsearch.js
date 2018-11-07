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

const _ = require('underscore');
const ElasticSearchClient = require('elasticsearchclient');
const log = require('oae-logger').logger('elasticsearchclient');
const Telemetry = require('oae-telemetry').telemetry('search');

let index = null;
let client = null;

/**
 * Refresh the search configuration with the given options.
 *
 * @param  {String}    index       The index to use
 * @param  {Object}    serverOpts  The server opts with which to configure the client
 */
const refreshSearchConfiguration = function(_index, serverOpts) {
  index = _index;
  client = new ElasticSearchClient(serverOpts);
  log().info(
    {
      config: {
        index: _index,
        serverOpts
      }
    },
    'Refreshed search configuration.'
  );
};

/**
 * Create an index with the specified name.
 *
 * @param  {String}      indexName       The name of the index
 * @param  {Object}      settings        The settings of the ElasticSearch index
 * @param  {Function}    callback        Standard callback function
 * @param  {Object}      callback.err    An error that occurred, if any
 */
const createIndex = function(indexName, settings, callback) {
  indexExists(indexName, (err, exists) => {
    if (err) {
      return callback(err);
    }

    if (exists) {
      return callback();
    } else {
      log().info(
        {
          indexName,
          indexSettings: settings
        },
        'Creating new search index.'
      );

      _exec('createIndex', client.createIndex(indexName, settings, null), callback);
    }
  });
};

/**
 * Delete the index with the given name.
 *
 * @param  {String}    indexName       The name of the index to delete
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const deleteIndex = function(indexName, callback) {
  indexExists(indexName, (err, exists) => {
    if (err) {
      return callback(err);
    }

    if (exists) {
      log().info('Deleting index "%s"', indexName);
      _exec('deleteIndex', client.deleteIndex(indexName, null), callback);
    } else {
      return callback();
    }
  });
};

/**
 * Determine whether or not the specified index exists.
 *
 * @param  {String}      indexName       The name of the index to test
 * @param  {Function}    callback        Standard callback function
 * @param  {Object}      callback.err    An error that occurred, if any
 * @param  {Boolean}     callback.exists Whether or not the index exists
 */
const indexExists = function(indexName, callback) {
  _exec('indexStatus', client.status(indexName, null), err => {
    if (err && err.error === 'IndexMissingException[[' + indexName + '] missing]') {
      return callback(null, false);
    }
    if (err) {
      return callback(err);
    }
    return callback(null, true);
  });
};

/**
 * Refresh the current index so that all its documents are available for querying.
 *
 * @param  {Function}    callback        Standard callback function
 * @param  {Object}      callback.err    An error that occurred, if any
 */
const refresh = function(callback) {
  _exec('refresh', client.refresh(index, null), callback);
};

/**
 * Create a type mapping that can be searched. The type mappings use the elastic search type mapping specification, as described
 * in the ElasticSearch documentation: http://www.elasticsearch.org/guide/reference/api/admin-indices-put-mapping.html
 *
 * @param  {String}    typeName            The name of the type. Should be unique across the application.
 * @param  {Object}    fieldProperties     The field schema properties for the type, as per ElasticSearch mapping spec.
 * @param  {Object}    [opts]              Advanced mapping options
 * @param  {String}    [opts._parent]      The parent document type, if applicable
 * @param  {Boolean}   [opts._source]      Whether or not the `_source` document should be enabled for storage and inclusion in queries. Defaults to `false`.
 * @param  {Function}  callback            Standard callback function
 * @param  {Object}    callback.err        An error that occurred, if any
 */
const putMapping = function(typeName, fieldProperties, opts, callback) {
  opts = opts || {};
  opts._source = opts._source !== true;

  mappingExists(typeName, (err, exists) => {
    if (err) {
      return callback(err);
    }
    if (exists) {
      return callback();
    }

    const data = {};
    data[typeName] = {
      _source: {
        enabled: opts._source
      },
      properties: fieldProperties
    };

    if (opts._parent) {
      data[typeName]._parent = { type: opts._parent };
    }

    log().info({ typeData: data }, 'Creating new search type mapping');

    return _exec('putMapping', client.putMapping(index, typeName, data), callback);
  });
};

/**
 * Determine whether or not the mapping exists.
 *
 * @param  {String}    typeName        The name of the type to map.
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const mappingExists = function(typeName, callback) {
  _exec('getMapping', client.getMapping(index, typeName, null), (err, data) => {
    if (err) {
      return callback(err);
    }

    return callback(null, !_.isEmpty(data));
  });
};

/**
 * Search ElasticSearch using the given query.
 *
 * @param  {Object}    query           The query object
 * @param  {Object}    options         Options to send with the query
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @param  {Object}    callback.data   The response of the query
 */
const search = function(query, options, callback) {
  log().trace({ query }, 'Querying elastic search');
  return _exec('search', client.search(index, query, options), callback);
};

/**
 * Index the given document in ElasticSearch.
 *
 * @param  {String}    typeName        The type of document to index
 * @param  {String}    id              The id of the document to index
 * @param  {Object}    doc             The document to index
 * @param  {Object}    options         The querystring options to send with the index call
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
index = function(typeName, id, doc, options, callback) {
  log().trace({ typeName, id, document: doc, options }, 'Indexing a document');
  return _exec('index', client.index(index, typeName, doc, id, options), callback);
};

/**
 * Index a bulk number of documents in ElasticSearch.
 *
 * @param  {Object[]}  operations      An array of ordered operations, as per the ElasticSearch Bulk API specification
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const bulk = function(operations, callback) {
  let numOps = 0;
  for (let i = 0; i < operations.length; i++) {
    const meta = operations[i];
    const keys = _.keys(meta);
    // Verify this is a metadata line, then apply the index
    if (keys.length === 1 && (meta.create || meta.index || meta.delete)) {
      numOps++;
      const opName = keys[0];
      meta[opName]._index = index;
    }
  }

  log().trace({ operations }, 'Performing a bulk set of %s operations.', numOps);
  return _exec('bulk', client.bulk(operations, null), callback);
};

/**
 * Delete the document identified by the document id from the index.
 *
 * @param  {String}    typeName        The type of document to delete
 * @param  {Object}    id              The id of the document to delete
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const del = function(typeName, id, callback) {
  log().trace({ typeName, documentId: id }, 'Deleting an index document.');
  return _exec('delete', client.deleteDocument(index, typeName, id, null), callback);
};

/**
 * Delete all documents matched by the given query
 *
 * @param  {String}     typeName        The type of document to delete
 * @param  {Object}     query           The query to invoke to match the documents to delete
 * @param  {Object}     options         The querystring to send with the delete call
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const deleteByQuery = function(typeName, query, options, callback) {
  log().trace({ typeName, query, options }, 'Deleting search documents by query');
  return _exec('deleteByQuery', client.deleteByQuery(index, typeName, query, options), callback);
};

/**
 * Execute a call to the ElasticSearchClient API.
 *
 * @param  {String}              name            The name of the method
 * @param  {ElasticSearchCall}   call            The call object that will be executed
 * @param  {Function}            callback        Standard callback function
 * @param  {Object}              callback.err    An error that occurred, if any
 * @param  {Object}              callback.data   The search response data, if any
 * @api private
 */
const _exec = function(name, call, callback) {
  callback = callback || function() {};

  Telemetry.incr('exec.' + name + '.count');
  const start = Date.now();
  let data = null;

  // Grab the data
  call.data(_data => {
    data = _data;
  });

  // When finished, call the callback with the data
  call.done(() => {
    // Data should always be JSON, I think.
    try {
      data = JSON.parse(data);
      log().trace({ call: name, data }, 'Search execution completed.');
    } catch (error) {
      log().trace({ call: name, data }, 'Search execution completed.');
      _logError(name, error);
      return callback(new Error('Non-JSON body returned in response.'));
    }

    // ElasticSearch returns an object with an error attribute if there is an error
    if (data.error) {
      // We don't implicitly log this because it could be intended
      return callback(data);
    }

    Telemetry.appendDuration('exec.' + name + '.time', start);
    return callback(null, data);
  });

  // When there is an error, call the callback with the error
  call.error(err => {
    _logError(name, err);
    return callback(err);
  });

  call.exec();
};

/**
 * Logs the given error and applies telemetry udpates.
 *
 * @param  {String} callName The name of the call that err'd
 * @param  {Object} err      The error to log.
 * @api private
 */
const _logError = function(callName, err) {
  Telemetry.incr('exec.' + callName + '.error.count');
  log().error({ err }, 'Error executing %s query.', callName);
};

module.exports = {
  refreshSearchConfiguration,
  createIndex,
  deleteIndex,
  indexExists,
  refresh,
  putMapping,
  mappingExists,
  search,
  index,
  bulk,
  del,
  deleteByQuery
};
