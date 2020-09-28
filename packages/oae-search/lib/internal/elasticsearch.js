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

import { logger } from 'oae-logger';

import { telemetry } from 'oae-telemetry';
import {
  keys,
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

const log = logger('elasticsearchclient');

const Telemetry = telemetry('search');

let index = null;
let client = null;

const returned200 = propEq('statusCode', 200);
const isOne = equals(1);
const firstKeyOf = compose(head, keys);

// const INDEX_RETRY_TIMEOUT = 5;

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

    return client.indices.create(
      {
        index,
        body
      },
      callback
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
      return client.indices.delete(
        {
          index
        },
        callback
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
  return client.indices.exists(
    {
      index
    },
    (err, queryResult) => {
      if (err) return callback(err);

      const result = returned200(queryResult);
      return callback(null, result);
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
  // _exec('refresh', client.refresh(index, null), callback);
  return client.indices.refresh(
    {
      index
    },
    callback
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
  // opts._source = opts._source !== true;

  /**
   * TODO for some reason I have to do this, fuck it
   */
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

    client.indices.putMapping(
      {
        index,
        body
      },
      err => {
        if (err) return callback(err);

        return callback();
      }
    );
  });
};

// TODO JsDoc
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
    err => {
      if (err) return callback(err);

      return callback();
    }
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
  client.indices.getMapping(
    {
      index
    },
    (err, result) => {
      if (err) return callback(err);

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
  return client.search(
    {
      index,
      body,
      storedFields,
      from,
      size
    },
    callback
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

  // Because ES7.x is typeless
  // body.type = typeName;
  // body.type = body._type;
  // delete body._type;
  const { routing } = options;

  return client.index({ id, index, body, routing }, (err, indexedData) => {
    if (err) return callback(err);

    return callback(null, indexedData);
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

  /*
  for (const meta of operations) {
    const keys = _.keys(meta);
    // Verify this is a metadata line, then apply the index

    if (keys.length === 1 && (meta.create || meta.index || meta.delete)) {
      numberOfOperations++;
      const opName = keys[0];
      meta[opName]._index = index;
    }
  } */

  log().trace({ operations: operationsToRun }, 'Performing a bulk set of %s operations.', numberOfOperations);

  return client.bulk(
    {
      index,
      body: operationsToRun
    },
    (err, bulkResponse) => {
      if (err) return callback(err);

      if (bulkResponse.errors) {
        const erroredDocuments = [];
        /**
         * The items array has the same order of the dataset we just indexed.
         * The presence of the `error` key indicates that the operation
         * that we did for the document has failed.
         */
        bulkResponse.items.forEach((action, i) => {
          const operation = Object.keys(action)[0];
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
        // TODO not sure this is how to error log, check it out
        log().error({}, erroredDocuments);
        // TODO probably return callback(err) here? try it out when tests are passing
      }

      return callback();
    }
  );
};

/**
 * TODO jsdoc here
 */
const insertRoutingIntoActionPairs = operationsToRun => {
  const parentIdPath = ['_parent', 'parent'];
  const getParentPath = path(parentIdPath);
  const actionPairs = filter(path(['_parent']));
  const dataPairs = reject(path(['_parent']));

  const parentIds = compose(map(getParentPath), actionPairs)(operationsToRun);

  forEach(eachOperation => {
    const routingId = parentIds.shift();
    eachOperation.index.routing = routingId;
  }, dataPairs(operationsToRun));

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

  return client.delete(
    {
      id,
      index
    },
    callback
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

  return client.deleteByQuery(
    {
      index,
      type,
      q: query
    },
    callback
  );
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
