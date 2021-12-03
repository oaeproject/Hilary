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

import { Client } from '@elastic/elasticsearch';

const log = logger('elasticsearch');
const Telemetry = telemetry('search');

let index = null;
let client = null;

/**
 * Helper functions
 */
const returned200 = propEq('statusCode', 200);
const isOne = equals(1);
const justTheOne = compose(isOne, length, keys);
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
const refreshSearchConfiguration = function (_index, serverNodes) {
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
 */
const createIndex = async function (index, settings) {
  const indexDoesExist = await indexExists(index);
  if (indexDoesExist) return true;

  log().info(
    {
      indexName: index,
      indexSettings: settings
    },
    'Creating new search index.'
  );

  const body = { settings };
  const start = Date.now();
  let result;

  try {
    Telemetry.incr('exec.' + CREATE_INDEX + '.count');
    result = await client.indices.create({
      index,
      body
    });
  } catch (error) {
    _logError(CREATE_INDEX, error);
    throw error;
  } finally {
    Telemetry.appendDuration('exec.' + CREATE_INDEX + '.time', start);
  }

  return result;
};

/**
 * Delete the index with the given name.
 *
 * @param  {String}    indexName       The name of the index to delete
 */
const deleteIndex = async function (index) {
  const indexDoesExist = await indexExists(index);

  if (indexDoesExist) {
    log().info('Deleting index "%s"...', index);

    const start = Date.now();
    let result;

    try {
      Telemetry.incr('exec.' + DELETE_INDEX + '.count');
      result = await client.indices.delete({
        index
      });
    } catch (error) {
      _logError(DELETE_INDEX, error);
    } finally {
      Telemetry.appendDuration('exec.' + DELETE_INDEX + '.time', start);
    }

    return result;
  }
};

/**
 * Determine whether or not the specified index exists.
 *
 * @param  {String}      indexName       The name of the index to test
 */
const indexExists = async function (index) {
  const start = Date.now();
  let queryResult;

  try {
    Telemetry.incr('exec.' + INDEX_STATUS + '.count');
    queryResult = await client.indices.exists({
      index
    });
  } catch (error) {
    _logError(INDEX_STATUS, error);
    throw error;
  } finally {
    Telemetry.appendDuration('exec.' + INDEX_STATUS + '.time', start);
  }

  return returned200(queryResult);
};

/**
 * Refresh the current index so that all its documents are available for querying.
 */
const refresh = async () => {
  const start = Date.now();
  let result;

  try {
    Telemetry.incr('exec.' + REFRESH + '.count');
    result = await client.indices.refresh({
      index
    });
  } catch (error) {
    _logError(REFRESH, error);
    throw error;
  } finally {
    Telemetry.appendDuration('exec.' + REFRESH + '.time', start);
  }

  return result;
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
 */
const putMapping = async function (properties, _options = {}) {
  const exists = await indexExists(index);
  if (not(exists)) return;

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
  properties = mergeAll([properties, {}]);
  properties.type = { type: 'keyword' };

  // This must be done because this is Module Object, whatever that is
  const body = {
    properties
  };

  log().info({ typeData: body }, 'Creating new search type mapping');

  const start = Date.now();
  let result;

  try {
    Telemetry.incr('exec.' + PUT_MAPPING + '.count');
    result = await client.indices.putMapping({
      index,
      body
    });
  } catch (error) {
    _logError(PUT_MAPPING, error);
    throw error;
  } finally {
    Telemetry.appendDuration('exec.' + PUT_MAPPING + '.time', start);
  }

  return result;
};

/**
 * Creates the ES mapping to link parents and children (resources)
 *
 * @function mapChildrenToParent
 * @param  {type} parentName   parent resource type
 * @param  {type} childrenName children resource type
 */
const mapChildrenToParent = function (parentName, childrenName) {
  if (isEmpty(childrenName)) return;

  const relations = assoc(parentName, childrenName, {});
  const body = {
    properties: {
      _parent: {
        type: 'join',
        relations
      }
    }
  };

  return client.indices.putMapping({
    index,
    body
  });
};

/**
 * Determine whether or not the mapping exists.
 *
 * @param  {String}    typeName        The name of the type to map.
 */
const mappingExists = async function (property) {
  const start = Date.now();
  let result;

  try {
    Telemetry.incr('exec.' + GET_MAPPING + '.count');
    result = await client.indices.getMapping({
      index
    });
  } catch (error) {
    _logError(GET_MAPPING, error);
    throw error;
  } finally {
    Telemetry.appendDuration('exec.' + GET_MAPPING + '.time', start);
  }

  const doesMappingExist = compose(Boolean, prop(property), path(['body', index, 'mappings', 'properties']));
  return doesMappingExist(result);
};

/**
 * Search ElasticSearch using the given query.
 *
 * @param  {Object}    query           The query object
 * @param  {Object}    options         Options to send with the query
 */
const search = async function (body, options) {
  log().trace({ query: body }, 'Querying elastic search');

  const { storedFields, from, size } = options;
  const start = Date.now();
  let result;

  try {
    Telemetry.incr('exec.' + SEARCH + '.count');
    result = await client.search({
      index,
      body,
      storedFields,
      from,
      size
    });
  } catch (error) {
    _logError(SEARCH, error);
    throw error;
  } finally {
    Telemetry.appendDuration('exec.' + SEARCH + '.time', start);
  }

  return result;
};

/**
 * Index the given document in ElasticSearch.
 *
 * @param  {String}    typeName        The type of document to index
 * @param  {String}    id              The id of the document to index
 * @param  {Object}    doc             The document to index
 * @param  {Object}    options         The querystring options to send with the index call
 */
const runIndex = async function (_typeName, id, body, options) {
  log().trace({ id, document: body, options }, 'Indexing a document');

  const { routing } = options;
  const start = Date.now();
  let result;

  try {
    Telemetry.incr('exec.' + RUN_INDEX + '.count');
    result = await client.index({ id, index, body, routing });
  } catch (error) {
    _logError(RUN_INDEX, error);
    throw error;
  } finally {
    Telemetry.appendDuration('exec.' + RUN_INDEX + '.time', start);
  }

  return result;
};

/**
 * Index a bulk number of documents in ElasticSearch.
 *
 * @param  {Object[]}  operationsToRun      An array of ordered operations, as per the ElasticSearch Bulk API specification
 */
const transformEachOperation = (eachOperation) => {
  const operationFields = eachOperation.create || eachOperation.index || eachOperation.delete;
  const justOneOperation = justTheOne(eachOperation);
  let numberOfOperations = 0;

  if (and(justOneOperation, operationFields)) {
    numberOfOperations = inc(numberOfOperations);
    eachOperation = assocPath([firstKeyOf(eachOperation), '_index'], index, eachOperation);
  }

  log().trace('Performing a bulk set of %s operations.', numberOfOperations);
  return eachOperation;
};

const _reportErrors = (bulkResponse, error, operationsToRun) => {
  if (bulkResponse.errors) {
    const erroredDocuments = [];
    /**
     * The items array has the same order of the dataset we just indexed.
     * The presence of the `error` key indicates that the operation
     * that we did for the document has failed.
     */
    for (const [i, action] of bulkResponse.items.entries()) {
      const operation = pipe(keys, head)(action);
      if (action[operation].error) {
        erroredDocuments.push({
          /**
           * If the status is 429 it means that you can retry the document,
           * otherwise it's very likely a mapping error, and you should
           * fix the document before to try it again.
           */
          status: action[operation].status,
          error: action[operation].error,
          operation: operationsToRun[i * 2],
          document: operationsToRun[i * 2 + 1]
        });
      }
    }

    _logError(BULK, erroredDocuments);
    throw error;
  }
};

const bulk = async (operationsToRun) => {
  const start = Date.now();
  let bulkResponse;

  const transformOperations = map(transformEachOperation);
  operationsToRun = pipe(transformOperations, insertRoutingIntoActionPairs)(operationsToRun);
  log().trace({ operations: operationsToRun }, 'Performing a bulk set of operations.');

  try {
    Telemetry.incr('exec.' + BULK + '.count');
    bulkResponse = await client.bulk({
      index,
      body: operationsToRun
    });
  } catch (error) {
    _logError(BULK, error);
    _reportErrors(bulkResponse, error, operationsToRun);
  } finally {
    Telemetry.appendDuration('exec.' + BULK + '.time', start);
  }
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
const insertRoutingIntoActionPairs = (operationsToRun) => {
  const parentIdPath = ['_parent', 'parent'];
  const getParentPath = path(parentIdPath);

  const cherryPickActionPairs = filter(path(['_parent']));
  const cherryPickDataPairs = reject(path(['_parent']));

  const extractParentIds = compose(map(getParentPath), cherryPickActionPairs);
  const parentIds = extractParentIds(operationsToRun);

  forEach((eachOperation) => {
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
 */
const del = async function (typeName, id) {
  log().trace({ typeName, documentId: id }, 'Deleting an index document.');

  const start = Date.now();
  let result;

  try {
    Telemetry.incr('exec.' + DELETE + '.count');
    result = await client.delete({
      id,
      index
    });
  } catch (error) {
    _logError(DELETE, error);
    throw error;
  } finally {
    Telemetry.appendDuration('exec.' + DELETE + '.time', start);
  }

  return result;
};

/**
 * Delete all documents matched by the given query
 *
 * @param  {String}     typeName        The type of document to delete
 * @param  {Object}     query           The query to invoke to match the documents to delete
 * @param  {Object}     options         The querystring to send with the delete call
 */
const deleteByQuery = async function (type, query, options) {
  log().trace({ typeName: type, query, options }, 'Deleting search documents by query');

  const start = Date.now();
  let result;

  try {
    Telemetry.incr('exec.' + DELETE_BY_QUERY + '.count');
    result = await client.deleteByQuery({
      index,
      type,
      q: query
    });
  } catch (error) {
    _logError(DELETE_BY_QUERY, error);
    throw error;
  } finally {
    Telemetry.appendDuration('exec.' + DELETE_BY_QUERY + '.time', start);
  }

  return result;
};

/**
 * Logs the given error and applies telemetry udpates.
 *
 * @param  {String} callName The name of the call that err'd
 * @param  {Object} err      The error to log.
 * @api private
 */
const _logError = function (fn, error) {
  Telemetry.incr('exec.' + fn + '.error.count');
  log().error({ err: error }, 'Error executing %s query.', fn);
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
