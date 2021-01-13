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

import { telemetry } from 'oae-telemetry';
import { logger } from 'oae-logger';

import {
  keys,
  pipe,
  map,
  inc,
  and,
  head,
  equals,
  length,
  assoc,
  path,
  prop,
  isEmpty,
  compose,
  not,
  propEq,
  filter,
  reject,
  mergeAll,
  forEach,
  assocPath
} from 'ramda';

const { Client } = require('@elastic/elasticsearch');

const log = logger('elasticsearch');
const Telemetry = telemetry('search');

let index = null;
let client = null;

/**
 * Helper functions
 */
const returned200 = propEq('statusCode', 200);
const isOne = equals(1);
const firstKeyOf = compose(head, keys);

/**
 * Constants
 */
const CREATE_INDEX = 'createIndex';
const DELETE_INDEX = 'deleteIndex';
const INDEX_STATUS = 'indexSatus'; // index exists command
const REFRESH = 'refresh';
const PUT_MAPPING = 'putMapping';
const GET_MAPPING = 'getMapping'; // mapping exists command
const SEARCH = 'search';
const RUN_INDEX = 'index';
const BULK = 'bulk';
const DELETE = 'delete'; // del command
const DELETE_BY_QUERY = 'deleteByQuery';

/**
 * Refresh the search configuration with the given options.
 *
 * @param  {String}    index       The index to use
 * @param  {Object}    serverNodes  The server opts with which to configure the client
 */
const refreshSearchConfiguration = function(_index, serverNodes) {
  index = _index;

  client = new Client({ nodes: serverNodes.nodes });
  log().info(
    {
      config: {
        index: _index,
        serverOpts: serverNodes
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
const createIndex = function(index, settings, callback) {
  indexExists(index, (err, indexExists) => {
    if (err) return callback(err);
    if (indexExists) return callback(null, true);

    log().info(
      {
        indexName: index,
        indexSettings: settings
      },
      'Creating new search index.'
    );

    const body = { settings };

    Telemetry.incr('exec.' + CREATE_INDEX + '.count');
    const start = Date.now();
    return client.indices.create(
      {
        index,
        body
      },
      (err, result) => {
        if (err) {
          _logError(CREATE_INDEX, err);
          return callback(err);
        }

        Telemetry.appendDuration('exec.' + CREATE_INDEX + '.time', start);
        return callback(null, result);
      }
    );
  });
};

/**
 * Delete the index with the given name.
 *
 * @param  {String}    indexName       The name of the index to delete
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const deleteIndex = function(index, callback) {
  indexExists(index, (err, indexExists) => {
    if (err) return callback(err);

    if (indexExists) {
      log().info('Deleting index "%s"...', index);

      Telemetry.incr('exec.' + DELETE_INDEX + '.count');
      const start = Date.now();
      return client.indices.delete(
        {
          index
        },
        (err, result) => {
          if (err) {
            _logError(DELETE_INDEX, err);
          }

          Telemetry.appendDuration('exec.' + DELETE_INDEX + '.time', start);
          return callback(null, result);
        }
      );
    }

    return callback();
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
const indexExists = function(index, callback) {
  Telemetry.incr('exec.' + INDEX_STATUS + '.count');
  const start = Date.now();
  return client.indices.exists(
    {
      index
    },
    (err, queryResult) => {
      if (err) {
        _logError(INDEX_STATUS, err);
        return callback(err);
      }

      Telemetry.appendDuration('exec.' + INDEX_STATUS + '.time', start);
      return callback(null, returned200(queryResult));
    }
  );
};

/**
 * Refresh the current index so that all its documents are available for querying.
 *
 * @param  {Function}    callback        Standard callback function
 * @param  {Object}      callback.err    An error that occurred, if any
 */
const refresh = callback => {
  Telemetry.incr('exec.' + REFRESH + '.count');
  const start = Date.now();
  return client.indices.refresh(
    {
      index
    },
    (err, result) => {
      if (err) {
        _logError(REFRESH, err);
        return callback(err);
      }

      Telemetry.appendDuration('exec.' + REFRESH + '.time', start);
      return callback(null, result);
    }
  );
};

/**
 * Create a type mapping that can be searched. The type mappings use the elastic search type
 * mapping specification, as described in the ElasticSearch documentation:
 * http://www.elasticsearch.org/guide/reference/api/admin-indices-put-mapping.html
 *
 * Also, this operation seems to be idempotent... so we don't have to check for previous mappings
 * 
 * Typical body sent is:
 * 
 * ```
 * {
      "properties": {
        "type": { "type": "keyword" },
        "name": { "type": "text" },
        "user_name": { "type": "keyword" },
        "email": { "type": "keyword" },
        "content": { "type": "text" },
        "tweeted_at": { "type": "date" }
      }
  }```
 *
 * @param  {String}    typeName            The name of the type. Should be unique across the application.
 * @param  {Object}    fieldProperties     The field schema properties for the type, as per ElasticSearch mapping spec.
 * @param  {Object}    [opts]              Advanced mapping options
 * @param  {String}    [opts._parent]      The parent document type, if applicable
 * @param  {Boolean}   [opts._source]      Whether or not the `_source` document should be enabled for storage and inclusion in queries. Defaults to `false`.
 * @param  {Function}  callback            Standard callback function
 * @param  {Object}    callback.err        An error that occurred, if any
 */
const putMapping = function(properties, opts, callback) {
  opts = opts || {};

  indexExists(index, (err, exists) => {
    if (err) return callback(err);
    if (not(exists)) return callback();

    /**
     * We're using a custom implementation of type since ES7+ is typeless
     * Type here can be one of the following:
     * - Resource
     * - Resource members
     * - Resource memberships
     * - Discussion message
     * - Content body
     * - Content comment
     * - Folder message
     * - Resource followers
     * - Resource following
     * - Meeting jitsi message
     */
    properties.type = { type: 'keyword' };

    // This must be done because this is Module Object, whatever that is
    properties = mergeAll([properties, {}]);
    const body = {
      properties
    };

    log().info({ typeData: body }, 'Creating new search type mapping');

    Telemetry.incr('exec.' + PUT_MAPPING + '.count');
    const start = Date.now();
    client.indices.putMapping(
      {
        index,
        body
      },
      (err, result) => {
        if (err) {
          _logError(PUT_MAPPING, err);
          return callback(err);
        }

        Telemetry.appendDuration('exec.' + PUT_MAPPING + '.time', start);
        return callback(null, result);
      }
    );
  });
};

/**
 * Creates the ES mapping to link parents and children (resources)
 *
 * @function mapChildrenToParent
 * @param  {type} parentName   parent resource type
 * @param  {type} childrenName children resource type
 * @param  {type} callback     Standard callback function
 */
const mapChildrenToParent = function(parentName, childrenName, callback) {
  if (isEmpty(childrenName)) return callback();

  const relations = assoc(parentName, childrenName, {});
  const body = {
    properties: {
      _parent: {
        type: 'join',
        relations
      }
    }
  };

  client.indices.putMapping(
    {
      index,
      body
    },
    callback
  );
};

/**
 * Determine whether or not the mapping exists.
 *
 * @param  {String}    typeName        The name of the type to map.
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const mappingExists = function(property, callback) {
  Telemetry.incr('exec.' + GET_MAPPING + '.count');
  const start = Date.now();
  client.indices.getMapping(
    {
      index
    },
    (err, result) => {
      if (err) {
        _logError(GET_MAPPING, err);
        return callback(err);
      }

      Telemetry.appendDuration('exec.' + GET_MAPPING + '.time', start);
      const mappingExists = compose(Boolean, prop(property), path(['body', index, 'mappings', 'properties']))(result);

      return callback(null, mappingExists);
    }
  );
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
const search = function(body, options, callback) {
  log().trace({ query: body }, 'Querying elastic search');

  const { storedFields, from, size } = options;
  Telemetry.incr('exec.' + SEARCH + '.count');
  const start = Date.now();

  return client.search(
    {
      index,
      body,
      storedFields,
      from,
      size
    },
    (err, result) => {
      if (err) {
        _logError(SEARCH, err);
        return callback(err);
      }

      Telemetry.appendDuration('exec.' + SEARCH + '.time', start);
      return callback(null, result);
    }
  );
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
const runIndex = function(typeName, id, body, options, callback) {
  log().trace({ id, document: body, options }, 'Indexing a document');

  const { routing } = options;
  Telemetry.incr('exec.' + RUN_INDEX + '.count');
  const start = Date.now();

  return client.index({ id, index, body, routing }, (err, result) => {
    if (err) {
      _logError(RUN_INDEX, err);
      return callback(err);
    }

    Telemetry.appendDuration('exec.' + RUN_INDEX + '.time', start);
    return callback(null, result);
  });
};

/**
 * Index a bulk number of documents in ElasticSearch.
 *
 * @param  {Object[]}  operationsToRun      An array of ordered operations, as per the ElasticSearch Bulk API specification
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const bulk = (operationsToRun, callback) => {
  let numberOfOperations = 0;

  const transformOperations = eachOperation => {
    const operationFields = eachOperation.create || eachOperation.index || eachOperation.delete;
    const justOneOperation = compose(isOne, length, keys)(eachOperation);

    if (and(justOneOperation, operationFields)) {
      numberOfOperations = inc(numberOfOperations);
      eachOperation = assocPath([firstKeyOf(eachOperation), '_index'], index, eachOperation);
    }

    return eachOperation;
  };

  operationsToRun = map(transformOperations, operationsToRun);
  operationsToRun = insertRoutingIntoActionPairs(operationsToRun);

  log().trace({ operations: operationsToRun }, 'Performing a bulk set of %s operations.', numberOfOperations);

  Telemetry.incr('exec.' + BULK + '.count');
  const start = Date.now();
  return client.bulk(
    {
      index,
      body: operationsToRun
    },
    (err, bulkResponse) => {
      if (err) {
        _logError(BULK, err);
        return callback(err);
      }

      Telemetry.appendDuration('exec.' + BULK + '.time', start);

      if (bulkResponse.errors) {
        const erroredDocuments = [];
        /**
         * The items array has the same order of the dataset we just indexed.
         * The presence of the `error` key indicates that the operation
         * that we did for the document has failed.
         */
        bulkResponse.items.forEach((action, i) => {
          const operation = pipe(keys, head)(action);
          if (action[operation].error) {
            erroredDocuments.push({
              /**
               * If the status is 429 it means that you can retry the document,
               *  otherwise it's very likely a mapping error, and you should
               *  fix the document before to try it again.
               */
              status: action[operation].status,
              error: action[operation].error,
              operation: operationsToRun[i * 2],
              document: operationsToRun[i * 2 + 1]
            });
          }
        });
        _logError(BULK, erroredDocuments);
        return callback(err);
      }

      return callback();
    }
  );
};

/**
 * "The routing value is mandatory because parent and child documents must be indexed on the same shard"
 *
 * Elasticsearch 7.x+ bulk operation requires action-data pairs as an input
 * However, the routing field must be put in there for the child-parent
 * relationships to be correctly inserted
 *
 * This function picks the fields related to document parenthood and uses that to fill in the routing
 * field. More info here:
 * https://www.elastic.co/guide/en/elasticsearch/reference/current/parent-join.html
 *
 * @function insertRoutingIntoActionPairs
 * @param  {Array} operationsToRun Array with action/data pairs that go into the ES bulk operation
 */
const insertRoutingIntoActionPairs = operationsToRun => {
  const parentIdPath = ['_parent', 'parent'];
  const getParentPath = path(parentIdPath);

  const cherryPickActionPairs = filter(path(['_parent']));
  const cherryPickDataPairs = reject(path(['_parent']));

  const extractParentIds = compose(map(getParentPath), cherryPickActionPairs);
  const parentIds = extractParentIds(operationsToRun);

  forEach(eachOperation => {
    const routingId = parentIds.shift();
    eachOperation.index.routing = routingId;
  }, cherryPickDataPairs(operationsToRun));

  return operationsToRun;
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

  Telemetry.incr('exec.' + DELETE + '.count');
  const start = Date.now();
  return client.delete(
    {
      id,
      index
    },
    (err, result) => {
      if (err) {
        _logError(DELETE, err);
        return callback(err);
      }

      Telemetry.appendDuration('exec.' + DELETE + '.time', start);
      return callback(null, result);
    }
  );
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
const deleteByQuery = function(type, query, options, callback) {
  log().trace({ typeName: type, query, options }, 'Deleting search documents by query');

  Telemetry.incr('exec.' + DELETE_BY_QUERY + '.count');
  const start = Date.now();
  return client.deleteByQuery(
    {
      index,
      type,
      q: query
    },
    (err, result) => {
      if (err) {
        _logError(DELETE_BY_QUERY, err);
        return callback(err);
      }

      Telemetry.appendDuration('exec.' + DELETE_BY_QUERY + '.time', start);
      return callback(null, result);
    }
  );
};

/**
 * Logs the given error and applies telemetry udpates.
 *
 * @param  {String} callName The name of the call that err'd
 * @param  {Object} err      The error to log.
 * @api private
 */
const _logError = function(fn, err) {
  Telemetry.incr('exec.' + fn + '.error.count');
  log().error({ err }, 'Error executing %s query.', fn);
};

export {
  refreshSearchConfiguration,
  createIndex,
  deleteIndex,
  indexExists,
  refresh,
  putMapping,
  mappingExists,
  search,
  runIndex,
  bulk,
  del,
  deleteByQuery,
  mapChildrenToParent
};
