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

import _ from 'underscore';
import { logger } from 'oae-logger';

import * as EmitterAPI from 'oae-emitter';
import * as SearchUtil from 'oae-search/lib/util';

import { gt, length, equals, defaultTo, forEach, assoc } from 'ramda';

import { Validator as validator } from 'oae-util/lib/validator';
const { isEmpty, unless, isNotEmpty, isArray, isObject, isArrayNotEmpty } = validator;

import { SearchConstants } from 'oae-search/lib/constants';
import { SearchResult } from 'oae-search/lib/model';

const { transformSearchResults } = SearchUtil;

import * as MQ from 'oae-util/lib/mq';
import * as client from './internal/elasticsearch';

const log = logger('oae-search');

// Holds the currently configured index to which we will perform all requested operations, as per
// the `config.search.index` configuration object in config.js
let index = null;

// Indicates whether or not the search indexing handler has been bound to the task queue
let boundIndexWorkers = false;

const resourceChildren = [];
const childSearchDocuments = {};
const reindexAllHandlers = {};
const searches = {};
const searchDocumentProducers = {};
const searchDocumentTransformers = {
  /*!
   * A default document transformer that simply returns the stored fields of the document, plus the id.
   * @see registerSearchDocumentTransformer
   */
  '*'(ctx, docs, callback) {
    const result = _.map(docs, doc => {
      return _.extend({}, doc.fields, { id: doc._id });
    });
    return callback(null, result);
  }
};

/**
 * ### Events
 *
 * The `SearchAPI`, as enumerated in `SearchConstants.events`, emits the following events:
 *
 * * `search(ctx, searchType, opts, results)`: A search request was made
 */
const SearchAPI = new EmitterAPI.EventEmitter();

/**
 * Register a transformer with the search API that will transform search documents into a model that can be returned to the
 * UI for the user. The document transformers are given the raw ElasticSearch search documents after they have been retrieved
 * from ElasticSearch. Once the registered transformer has processed and returned the documents, the final search results are
 * sent back to the client.
 *
 * ## ElasticSearch Document Model
 *
 * In lieue of better official examples of what an ElasticSearch document looks like, here is an example with some additional
 * documentation:
 *
 * ```json
 *  {
 *    "_index": "oaetest",
 *    "_type": "resource",
 *    "_id": "c:camtest:lkVkhpLBh6",
 *    "_score": 1.5683944,
 *    "fields": {
 *      "resourceSubType": [
 *        "collabdoc"
 *      ],
 *      "_extra": [
 *        "{\"lastModified\":\"1399243141900\"}"
 *      ],
 *      "visibility": [
 *        "private"
 *      ],
 *      "tenantAlias": [
 *        "camtest"
 *      ],
 *      "description": [
 *        "description"
 *      ],
 *      "displayName": [
 *        "collabdoc-eyQJnaUr3a"
 *      ],
 *      "resourceType": [
 *        "content"
 *      ]
 *    },
 *    "sort": [
 *      1.5683944,
 *      "collabdoc-eyQJnaUr3a description Most modern calendars mar the sweet simplicity of our lives by reminding us that each day that passes is the anniversary of some perfectly uninteresting event.<br>"
 *    ]
 *  }
 * ```
 *
 * Explanation:
 *
 *  * All you need to know about document metadata (fields prefixed with `_`) can be found here: http://www.elasticsearch.org/guide/en/elasticsearch/guide/current/document.html
 *  * The "fields" object is where the document fields that are labeled as "stored" in the search type mapping are returned
 *  * Each element within field is an array even if it is a primitive such as "string". If the field type is not an array, then its return type is an array with 1 element
 *  * The "sort" value indicates what values contributed to the sorting of the document. The documents are returned in sorted order, however the sort field will indicate the primary, secondary, tertiary, etc... sorting values
 *
 * @param  {String}    typeName                    The type of document this transformer acts upon
 * @param  {Function}  transformer                 The function that will transform an array of search documents into an array of view objects
 * @param  {Context}   transformer.ctx             The context of the currently authenticated user
 * @param  {Object}    transformer.docs            The raw ElasticSearch search documents, keyed by document `id`, that were returned in the search. Everything you need to know about an ElasticSearch document can be found here: http://www.elasticsearch.org/guide/en/elasticsearch/guide/current/document.html
 * @param  {Function}  transformer.callback        The callback function the transformer should execute to indicate it has completed processing
 * @param  {Object}    transformer.callback.err    An error that occurred while transforming the docs, if any
 * @param  {Object}    transformer.callback.docs   The view model, keyed by document _id, that were translated from the hash of search documents
 * @throws {Error}                                 An error that is thrown if there is already a transformer registered for the given type
 */
const registerSearchDocumentTransformer = function(typeName, transformer) {
  if (searchDocumentTransformers[typeName]) {
    throw new Error('Document transformer for type ' + typeName + ' already exists');
  }

  searchDocumentTransformers[typeName] = transformer;
};

/**
 * Register a producer with the search API that will produce search documents to be added to the search index. There can only be one
 * producer per resource type. When a new indexing task is submitted for a resource that is of `typeName` resource type, then this
 * producer will have an opportunity to produce documents to be indexed.
 *
 * @param  {String}    typeName                     The resource type that this indexer indexes
 * @param  {Function}  producer                     A function that will produce documents to be indexed
 * @param  {Object[]}  producer.resourceData        An array of objects that represent the data that drives the producer. The format of the actual data object will generally be different for different resource types
 * @param  {Function}  producer.callback            The callback function that should be invoked when the indexer has produced the documents
 * @param  {Object}    producer.callback.errs       A set of errors that occurred while creating the documents, if any
 * @param  {Object[]}  producer.callback.docs       The documents to be indexed
 * @throws {Error}                                  An error that is thrown if there is already a producer registered for the given type
 */
const registerSearchDocumentProducer = function(typeName, producer) {
  if (searchDocumentProducers[typeName]) {
    throw new Error('Document producer for type ' + typeName + ' already exists');
  }

  searchDocumentProducers[typeName] = producer;
};

/**
 * Register a search with the Search API that will process search input and produce a query to run against elastic search. Once the query
 * is created by the search registered here, the search will be sent to ElasticSearch and and all results will be passed through the
 * document transformers. @see #registerSearchDocumentTransformer for more information.
 * Finally, the entire result object can be processed by the search
 *
 * @param  {String}    typeName                            The name of the search. Once registered, this search can be invoked by using this `typeName` in the `search` method.
 * @param  {Function}  queryBuilder                        The search function that will be invoked when a search is performed. This function is responsible for generating a query as per the ElasticSearch Query DSL and returning it in the callback.
 * @param  {Context}   queryBuilder.ctx                    The context of the search being performed
 * @param  {Object}    queryBuilder.opts                   The search opts that are specific to the search
 * @param  {String[]}  [queryBuilder.opts.params]          An array of search parameters that are specific to the search (i.e., for ordered path parameters)
 * @param  {Function}  queryBuilder.callback               The callback function that should be invoked when the search has created the query
 * @param  {Object}    queryBuilder.callback.err           An error that occurred while creating the query. Pass an error parameter to indicate an error occurred, if it was successful, this parameter should be left `null`
 * @param  {Object}    queryBuilder.callback.queryData     The Query DSL object representing the query, as per the ElasticSearch documentation; If not specified, short-circuits the process to return 0 results.
 * @param  {Function}  [postProcessor]                     The function that will be invoked to post process the entire result object
 * @param  {Context}   postProcessor.ctx                   The context of the search being performed
 * @param  {Object}    postProcessor.opts                  The search opts that are specific to the search
 * @param  {Object}    postProcessor.results               The search results to process
 * @param  {Function}  postProcessor.callback              The callback function that should be invoked when the results have been processed
 * @param  {Object}    postProcessor.callback.err          An error that occurred while processing the results. Pass an error parameter to indicate an error occurred, if it was successful, this parameter should be left `null`
 * @param  {Object}    postProcessor.callback.results      The processed results
 * @throws {Error}                                         An error that is thrown if there is already a search registered by the given name
 */
const registerSearch = function(typeName, queryBuilder, postProcessor) {
  if (searches[typeName]) {
    throw new Error('Search type ' + typeName + ' already exists');
  }

  searches[typeName] = {
    queryBuilder,
    postProcessor:
      postProcessor ||
      function(ctx, opts, results, callback) {
        return callback(null, results);
      }
  };
};

/**
 * Register a handler for a reindex all operation. When a full re-index has been triggered, this handler will be invoked.
 *
 * @param  {String}     handlerId               The id of the handler invoked
 * @param  {Function}   handler                 The handler function that will be invoked when a full re-index has been triggered
 * @param  {Function}   handler.callback        The callback function that should be invoked when reindexing has been completed
 * @param  {Object}     handler.callback.err    An error that occurred during reindexing, if any
 */
const registerReindexAllHandler = function(handlerId, handler) {
  if (reindexAllHandlers[handlerId]) {
    throw new Error('Reindex-all handler with id ' + handlerId + ' already exists');
  }

  reindexAllHandlers[handlerId] = handler;
};

/**
 * Create a child search document mapping in the OAE index that is a child of the main resource schema.
 *
 * @param  {String}     name                                The unique name of the document mapping
 * @param  {Object}     options                             The options for the child search document
 * @param  {String[]}   [options.resourceTypes]             A list of resource types for which this producer produces child documents. If unspecified, the producer will be invoked for all resource types
 * @param  {Function}   options.producer                    A function that will produce documents to be indexed
 * @param  {Object[]}   options.producer.resourceData       An array of objects that represent the data that drives the producer. The format of the actual data object will generally be different for different resource types
 * @param  {Function}   options.producer.callback           The callback function that should be invoked when the indexer has produced the documents
 * @param  {Object}     options.producer.callback.errs      Any errors that occurred while creating the documents, if any
 * @param  {Object[]}   options.producer.callback.docs      The documents to be indexed
 * @param  {Object}     options.schema                      The elasticsearch mapping object that defines the child search document fields
 * @param  {Function}   [callback]                          Standard callback function, invoked when the child search document mapping has been created
 * @param  {Object}     [callback.err]                      An error that occurred, if any
 */
const registerChildSearchDocument = function(name, options, callback) {
  if (childSearchDocuments[name]) {
    const err = new Error('Child search document mapping with name "' + name + '" already exists');
    log().error({ err, name }, 'Attempted to register duplicate child search document');
    return callback({ code: 400, msg: err.message });
  }

  // Determine the resource types we will support
  let resourceTypes = null;
  if (_.isArray(options.resourceTypes) && !_.isEmpty(options.resourceTypes)) {
    resourceTypes = {};
    _.each(options.resourceTypes, resourceType => {
      resourceTypes[resourceType] = true;
    });
  }

  childSearchDocuments[name] = {
    schema: options.schema,
    producer: options.producer,
    resourceTypes
  };

  // The callback defaults to a function that simply logs the fact that an error occurred
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err }, 'An unexpected error occurred while creating a child search document mapping');
      }
    };

  // Add this child to the list to later be mapped to the resource parent
  resourceChildren.push(name);

  return _createChildSearchDocumentMapping(name, options.schema, callback);
};

/**
 * Refresh the search configuration with the given options.
 *
 * @param  {Object}     searchConfig    The search configuration object, as per `config.js`
 * @param  {Function}   callback        Standard callback function
 */
const refreshSearchConfiguration = function(searchConfig, callback) {
  index = searchConfig.index;
  const processIndexJobs = searchConfig.processIndexJobs !== false;

  client.refreshSearchConfiguration(index.name, { nodes: searchConfig.nodes });

  if (processIndexJobs && !boundIndexWorkers) {
    boundIndexWorkers = true;
    MQ.subscribe(SearchConstants.mq.TASK_INDEX_DOCUMENT, _handleIndexDocumentTask, () => {
      MQ.subscribe(SearchConstants.mq.TASK_DELETE_DOCUMENT, _handleDeleteDocumentTask, () => {
        return MQ.subscribe(SearchConstants.mq.TASK_REINDEX_ALL, _handleReindexAllTask, callback);
      });
    });
  } else if (!processIndexJobs && boundIndexWorkers) {
    boundIndexWorkers = false;
    MQ.unsubscribe(SearchConstants.mq.TASK_INDEX_DOCUMENT, () => {
      MQ.unsubscribe(SearchConstants.mq.TASK_DELETE_DOCUMENT, () => {
        return MQ.unsubscribe(SearchConstants.mq.TASK_REINDEX_ALL, callback);
      });
    });
  } else {
    // If we get here, there was no state change in handling indexing, so we don't need to do anything.
    return callback();
  }
};

/**
 * Build the search index to use for indexing and searching documents.
 * If `destroy` is `true`, the current index and all its
 * data will be destroyed. This will leave an empty search index that needs to be reindexed!
 *
 * @param  {Boolean}    [destroy]       Whether or not to first destroy / delete the index before rebuilding. Default: `false`
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const buildIndex = function(destroy, callback) {
  _ensureIndex(index.name, index.settings, destroy, err => {
    if (err) return callback(err);

    // Create the resource document mapping
    // TODO make sure we need this timeout?
    // setTimeout(() => _ensureSearchSchema(callback), 2000);
    return _ensureSearchSchema(callback);
  });
};

/**
 * Perform a search
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         searchType          The type of search to perform (e.g., 'general')
 * @param  {Object}         opts                A hash describing the search parameters
 * @param  {String[]}       [opts.pathParams]   An array of path parameters for the search. The requirements of the path parameters are specific to the type of search being performed
 * @param  {String}         [opts.q]            The search query
 * @param  {Number}         [opts.limit]        The maximum number of search results to return
 * @param  {Number}         [opts.start]        The document index from which to start
 * @param  {String}         [opts.sort]         The sort direction. One of 'asc' or 'desc'
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Object}         callback.result     The retrieved search results
 */
const search = function(ctx, searchType, opts, callback) {
  const registeredSearch = searches[searchType];
  if (!registeredSearch) {
    return callback({ code: 400, msg: 'Search "' + searchType + '" is not a valid search type.' });
  }

  // Invoke the search plugin to get the query object
  // registeredSearch.queryBuilder(ctx, opts, (err, queryData) => {
  // TODO experiment because I need the index down the line
  opts.index = index;
  registeredSearch.queryBuilder(ctx, opts, (err, queryBody) => {
    if (err) return callback(err);
    if (!queryBody) callback(null, new SearchResult(0, []));

    // Query only the document fields stored in the index, and not the _source and others
    opts.storedFields = '*';

    // Perform the search with the query data
    client.search(queryBody, opts, (err, elasticSearchResponse) => {
      if (err) {
        log().error({ err }, 'An unexpected error occurred performing a search');
        return callback({ code: 500, msg: 'An unexpected error occurred performing the search' });
      }

      // We pull the '_extra' field out and parse it into JSON
      // const hitsPath = ['body', 'hits', 'hits'];
      // const extraFields = path(['fields', '_extra']);
      // const hitsWithin = path(hitsPath);
      /*
      assocPath(
        hitsPath,
        map(eachHit => {
          return map(eachField => JSON.parse(eachField), extraFields(eachHit));
        }, hitsWithin(elasticSearchResponse)),
        elasticSearchResponse
      );
      */

      _.each(elasticSearchResponse.body.hits.hits, hit => {
        try {
          hit.fields._extra[0] = JSON.parse(hit.fields._extra[0]);
          // hit.fields._extra = JSON.parse(hit.fields._extra[0]);
        } catch (error) {
          log().warn({ err: error, hit }, 'Failed to parse _extra field of search document into JSON. Ignoring');
        }
      });

      transformSearchResults(ctx, searchDocumentTransformers, elasticSearchResponse, (err, transformedResults) => {
        if (err) return callback(err);

        // Ensure we scrub any `_extra` field from all results
        _.each(transformedResults.results, doc => {
          delete doc._extra;
        });

        SearchAPI.emit(SearchConstants.events.SEARCH, ctx, searchType, opts, transformedResults);

        // Perform post-processing (if any)
        return registeredSearch.postProcessor(ctx, opts, transformedResults, callback);
      });
    });
  });
};

/**
 * Submits a task that will re-index all search documents in storage. This task is permission protected to
 * the global admin user as the impact of reindexing all documents can stress the system.
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const postReindexAllTask = function(ctx, callback) {
  if (!ctx.user() || !ctx.user().isGlobalAdmin()) {
    return callback({ code: 401, msg: 'Only global administrator can trigger a full reindex.' });
  }

  MQ.submit(SearchConstants.mq.TASK_REINDEX_ALL, JSON.stringify({}), callback);
};

/**
 * Submits a task that will index the specified set of resource and child documents.
 *
 * @param  {String}             resourceType        The resource type of all resources specified in each of the index tasks
 * @param  {Object[]}           resources           The resources to use to produce the search documents to index
 * @param  {Object}             resources[i].id     The id of the resource. This is the only required parameter of the resource object, but there can be more depending on what data is needed by the associated document producers
 * @param  {Object}             index               Specifies what aspects of the resource should be indexed
 * @param  {Boolean}            [index.resource]    Specifies if the main resource document should be indexed. Default: `false`
 * @param  {Object|Boolean}     [index.children]    If `true`, will reindex all known child document types for this resource type. If an object, each key specifies which child document types should produce documents for this index task. If unspecified, no children will be reindexed
 * @param  {Function}           [callback]          Standard callback function, invoked when the task has been submit
 * @param  {Object}             [callback.err]      An error that occurred, if any
 */
const postIndexTask = function(resourceType, resources, index, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error(
          {
            err,
            resourceType,
            resources,
            index
          },
          'An error occurred while posting a search indexing task'
        );
      }
    };

  try {
    const code = 400;
    let msg = 'Must specify a resource type';
    unless(isNotEmpty, { code, msg })(resourceType);
    msg = '"resources" parameter must be an array';
    unless(isArray, { code, msg })(resources);
    msg = '"index" parameter must be an object';
    unless(isObject, { code, msg })(index);
    msg = '"resources" parameter must be an array with one or more entries';
    unless(isArrayNotEmpty, { code, msg })(resources);
    msg = 'Each index resource must have an id';
    resources.forEach(resource => {
      unless(isNotEmpty, { code, msg })(resource.id);
    });
  } catch (error) {
    return callback(error);
  }

  return MQ.submit(
    SearchConstants.mq.TASK_INDEX_DOCUMENT,
    JSON.stringify({ resourceType, resources, index }),
    callback
  );
};

/**
 * Submits a task that will delete a search document with the specified id
 *
 * @param  {Object}     id              The id of the parent resource document to delete
 * @param  {Object}     children        An object whose key is the child document type, and values are an array of string document ids of children to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const postDeleteTask = function(id, children, callback) {
  return MQ.submit(SearchConstants.mq.TASK_DELETE_DOCUMENT, JSON.stringify({ id, children }), callback);
};

/**
 * Ensure that the index identified by the index name exists.
 *
 * @param  {String}     indexName               The name of the index
 * @param  {Object}     indexSettings           The settings of the index
 * @param  {Object[]}   indexSettings.hosts     An array of hosts (e.g., `[{ "host": "localhost", "port": 9200 }]`) to use
 * @param  {Boolean}    destroy                 If true, the index will be destroyed if it exists, then recreated
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
const _ensureIndex = function(indexName, indexSettings, destroy, callback) {
  if (destroy) {
    log().info('Destroying index "%s"', indexName);
    client.deleteIndex(indexName, err => {
      if (err) return callback(err);

      client.createIndex(indexName, indexSettings, err => {
        if (err) {
          log().error({ err }, 'Error recreating index "%s" after deletion.', indexName);
          return callback(err);
        }

        /**
         * Create the children / parent relationship, which must be done as a one-off operation
         * Check the documentation:
         * https://www.elastic.co/guide/en/elasticsearch/reference/current/parent-join.html#_multiple_children_per_parent
         */
        // TODO move this somewhere up
        // TODO there are constants for all of these, we should use them
        const resourceChildren = [
          'discussion_message',
          'resource_members',
          'resource_memberships',
          'content_body',
          'content_comment',
          'folder_message',
          'resource_followers',
          'resource_following',
          'meeting-jitsi_message'
        ];
        client.mapChildrenToParent(SearchConstants.search.MAPPING_RESOURCE, resourceChildren, err => {
          if (err) return callback(err);

          log().info('Recreated index "%s" after deletion', indexName);
          return callback();
        });
      });
    });
  } else {
    client.createIndex(indexName, indexSettings, err => {
      if (err) {
        log().error({ err }, 'Error creating index "%s"', indexName);
        return callback(err);
      }

      return callback();
    });
  }
};

/**
 * Ensure the OAE search schema is created.
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
// TODO fix this fucking mess, callback comes last!!!
const _ensureSearchSchema = function(callback, _names) {
  if (!_names) {
    return client.putMapping(require('./schema/resourceSchema'), null, err => {
      if (err) return callback(err);

      return _ensureSearchSchema(callback, _.keys(childSearchDocuments));
    });
  }

  if (_.isEmpty(_names)) return callback();

  // TODO not sure why this exists, I don't think it's ever ran...
  const name = _names.shift();
  return _createChildSearchDocumentMapping(name, childSearchDocuments[name].schema, err => {
    if (err) return callback(err);

    // Recursively create the next child document schema mapping
    return _ensureSearchSchema(callback, _names);
  });
};

/**
 * Create a search document mapping that is a child of the resource search document mapping.
 *
 * @param  {String}     name            The name of the search document mapping
 * @param  {Object}     schema          The schema object, as per the elasticsearch mapping schema
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _createChildSearchDocumentMapping = function(name, schema, callback) {
  /*!
   * The below elastic search options mean:
   *
   *  * `_parent: ...` establishes a parent-child relationship from the resource document to its child documents
   *
   * For more information, please see the elasticsearch mapping documentation:
   * http://www.elasticsearch.org/guide/reference/mapping/
   */
  // const opts = { _parent: SearchConstants.search.MAPPING_RESOURCE };

  client.putMapping(schema, null, callback);
};

/**
 * When bound to an TaskQueue reindex-all task, this method will reindex all resource in the search engine.
 *
 * @param  {Object}     data            The task data
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _handleReindexAllTask = function(data, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err, data }, 'Error handling reindex-all task');
      }
    };

  if (_.isEmpty(reindexAllHandlers)) {
    return callback();
  }

  // Invoke all handlers and return to the caller when they have all completed (or we get an error)
  let numToProcess = _.keys(reindexAllHandlers).length;
  let complete = false;
  _.each(reindexAllHandlers, (handler /* , handlerId */) => {
    handler(err => {
      if (complete) {
        // Do nothing, we've already returned to the caller
        return;
      }

      if (err) {
        complete = true;
        return callback(err);
      }

      numToProcess--;
      if (numToProcess === 0) {
        log().info({ handlers: _.keys(reindexAllHandlers) }, 'Finished submitting all items for re-indexing');
        complete = true;
        return callback();
      }
    });
  });
};

/**
 * When bound to an TaskQueue delete document task, this method will delete the resource from the search engine.
 *
 * @param  {Object}     data                The task data
 * @param  {String}     [data.id]           The id of the document to delete
 * @param  {Object}     [data.children]     An object keyed by `documentType`, whose value is an array of strings specifying the ids of individual child documents to be deleted from the search index
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @api private
 */
const _handleDeleteDocumentTask = function(data, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err, data }, 'Error handling search document delete task.');
      }
    };

  const deletes = [];

  // If there is a top-level resource specified, we delete its document and all known children
  if (data.id) {
    // Delete the resource with the provided id
    deletes.push({
      deleteType: 'id',
      documentType: SearchConstants.search.MAPPING_RESOURCE,
      id: data.id
    });

    // Delete all child documents whose parent is the provided resource
    _.each(childSearchDocuments, (options, documentType) => {
      deletes.push({
        deleteType: 'query',
        documentType,
        query: {
          term: {
            _parent: data.id
          }
        }
      });
    });
  }

  // For each specified sets of children document ids, delete them
  if (data.children) {
    _.each(data.children, (ids, documentType) => {
      _.each(ids, id => {
        deletes.push({
          deleteType: 'id',
          documentType,
          id
        });
      });
    });
  }

  // Delete the resource document, plus all its children and any requested children
  return _deleteAll(deletes, callback);
};

/**
 * Perform all delete operations
 *
 * @param  {Object[]}   deletes                     The delete operations to perform
 * @param  {String}     deletes[i].deleteType       The type of delete to perform, either "id" or "query"
 * @param  {String}     deletes[i].documentType     The type of document this should be applied to. Only documents of this type will be deleted
 * @param  {String}     [deletes[i].id]             The id of the document to delete, only relevant if this is a delete operation of type "id"
 * @param  {Object}     [deletes[i].query]          The query that matches the documents to delete. Only relevant if this is a delete operation of type "query"
 * @param  {Function}   callback                    Standard callback function
 * @api private
 */
const _deleteAll = function(deletes, callback) {
  if (isEmpty(deletes)) return callback();

  const del = deletes.shift();

  /*!
   * Invoke the _deleteAll method recursively when the requested delete operation has been
   * performed
   *
   * @param  {Object}     err     An error that occurred, if any
   */
  const _handleDocumentsDeleted = err => {
    if (err) log().error({ err, operation: del }, 'Error deleting a document from the search index');

    return _deleteAll(deletes, callback);
  };

  // Perform the appropriate delete operations
  if (del.deleteType === 'id') {
    return client.del(del.documentType, del.id, _handleDocumentsDeleted);
  }

  if (del.deleteType === 'query') {
    const query = { query: del.query };
    return client.deleteByQuery(del.documentType, query, null, _handleDocumentsDeleted);
  }
};

/**
 * When bound to am TaskQueue index document task, this method will index the resource
 * document(s) as described by the task data.
 *
 * @param  {Object}             data            The task data. See SearchAPI#postIndexTask for more information
 * @param  {Function}           callback        Standard callback function
 * @param  {Object}             callback.err    An error that occurred, if any
 * @api private
 */
const _handleIndexDocumentTask = function(data, callback) {
  const isTrue = equals(true);

  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err, data }, 'Error handling search indexing task.');
      }
    };

  log().trace({ data }, 'Received index document task');

  const resourcesToIndex = {};
  const resourceChildrenToIndex = {};
  forEach(resource => {
    data.index = defaultTo({}, data.index);
    data.index.children = defaultTo({}, data.index.children);

    /**
     * If the children property is set to boolean true, it indicates all known
     * child documents for this resource type should be indexed for the resource
     */
    if (isTrue(data.index.children)) {
      data.index.children = {};
      _.each(childSearchDocuments, (options, documentType) => {
        // Only include this child if it is specified to be a child of this resource type
        if (!options.resourceTypes || options.resourceTypes[data.resourceType]) {
          data.index.children[documentType] = true;
        }
      });
    }

    // Keep track of all core resource documents that need to be indexed
    if (data.index.resource) {
      // TODO totally guessing here...
      resource.type = 'resource';

      resourcesToIndex[data.resourceType] = resourcesToIndex[data.resourceType] || [];
      resourcesToIndex[data.resourceType].push(resource);
    }

    // Keep track of all child documents that need to be indexed
    _.chain(data.index.children)
      .keys()
      .each(documentType => {
        resourceChildrenToIndex[documentType] = resourceChildrenToIndex[documentType] || [];
        resourceChildrenToIndex[documentType].push(resource);
      });
  }, data.resources);

  /**
   * Create the children / parent relationship, which must be done as a one-off operation
   * Check the documentation:
   * https://www.elastic.co/guide/en/elasticsearch/reference/current/parent-join.html#_multiple_children_per_parent
   */
  // TODO this is not the ideal place to do this, but let's go with it for now
  // client.mapChildrenToParent(SearchConstants.search.MAPPING_RESOURCE, resourceChildren, err => {
  // if (err) return callback(err);
  // resourceChildren = [];

  _produceAllResourceDocuments(resourcesToIndex, (err, resourceDocs) => {
    if (err) return callback(err);

    log().trace({ data, resourceDocs }, 'Produced top-level resource docs');

    _produceAllChildDocuments(resourceChildrenToIndex, (err, childResourceDocs) => {
      if (err) return callback(err);

      log().trace({ data, childResourceDocs }, 'Produced child resource docs');

      const allDocs = _.union(resourceDocs, childResourceDocs);
      if (isEmpty(allDocs)) return callback();

      if (gt(length(allDocs), 1)) {
        const ops = SearchUtil.createBulkIndexOperations(allDocs);
        client.bulk(ops, err => {
          if (err) {
            log().error({ err, ops }, 'Error indexing %s documents', allDocs.length);
          } else {
            log().debug('Successfully indexed %s documents', allDocs.length);
          }

          return callback(err);
        });
      } else {
        const doc = allDocs[0];
        const { id } = doc;
        let opts = {};

        /*
          if (doc._parent) {
            opts.parent = doc._parent;
          }
          */

        // TODO oh, shit
        /*
          if (doc._parent) {
            doc._parent = doc._type;
            // "my_join_field": "question"
            // opts.parent = doc._parent;
          } else {
            doc._parent = {
              name: doc._type
              parent: doc._parent
              // "name": "answer", 
              // "parent": "1"
            }
          }
          */

        // TODO debug
        // one has got to do this when indexing docs with join
        // https://www.elastic.co/guide/en/elasticsearch/reference/7.x/parent-join.html
        //  "my_join_field": "question"
        if (doc._type) doc.type = doc._type;
        delete doc._type;
        doc._parent = { name: doc.type, parent: doc._parent };

        // TODO experiment to overcome the routing issue
        /**
         * It is required to index the lineage of a parent in the same shard so you
         * must always route child documents using their greater parent id.
         */
        opts = assoc('routing', doc._parent.parent, opts);

        // These properties go in the request metadata, not the actual document
        delete doc.id;
        // TODO came up with this for some reason, now some tests do not work without it. Sigh
        // if (doc.resourceType === 'user') delete doc._parent;

        client.runIndex(doc._type, id, doc, opts, err => {
          if (err) {
            log().error({ err, id, doc, opts }, 'Error indexing a document');
          } else {
            log().debug('Successfully indexed a document');
          }

          return callback(err);
        });
      }
    });
  });
  // });
};

/**
 * Produce all resource search documents defined within `resourcesToIndex`
 *
 * @param  {Object}     resourcesToIndex        An object of form {resourceType -> resources}, containing the resources to produce for indexing
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object[]}   callback.documents      The resource search documents that were produced
 * @api private
 */
const _produceAllResourceDocuments = function(resourcesToIndex, callback, _resourceTypes, _documents) {
  _resourceTypes = _resourceTypes || _.keys(resourcesToIndex);
  _documents = _documents || [];

  if (_.isEmpty(_resourceTypes)) return callback(null, _documents);

  // Select the next resourceType from the list whose documents to produce
  const resourceType = _resourceTypes.shift();
  const searchDocumentProducer = searchDocumentProducers[resourceType];

  if (searchDocumentProducer) {
    searchDocumentProducer(resourcesToIndex[resourceType], (errs, documents) => {
      // Some resources might have triggered an error. We log those here,
      // but we try to include any documents that were generated
      _.each(errs, err => {
        log().error({ err }, 'Error producing search documents from resources');
      });

      documents = _.map(documents, doc => {
        const newDoc = _.extend({}, doc, {
          type: SearchConstants.search.MAPPING_RESOURCE,
          resourceType
        });
        if (newDoc._extra) {
          newDoc._extra = JSON.stringify(newDoc._extra);
        }

        log().trace({ before: doc, after: newDoc }, 'Converted resource document');
        return newDoc;
      });

      // Union current documents with the ones we just produced and continue recursively
      _documents = _.union(_documents, documents);
      return _produceAllResourceDocuments(resourcesToIndex, callback, _resourceTypes, _documents);
    });
  } else {
    log().warn(
      'Ignoring %s documents of type "%s", which do not have an associated document producer',
      resourcesToIndex[resourceType].length,
      resourceType
    );
    return _produceAllResourceDocuments(resourcesToIndex, callback, _resourceTypes, _documents);
  }
};

/**
 * Produce all resource child search documents defined within `resourceChildrenToIndex`
 *
 * @param  {Object}     resourceChildrenToIndex     An object of form {documentType -> resources}, containing the resources whose children should be produced for indexing
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object[]}   callback.documents          The resource child search documents that were produced
 * @api private
 */
const _produceAllChildDocuments = function(resourceChildrenToIndex, callback, _documentTypes, _documents) {
  _documentTypes = _documentTypes || _.keys(resourceChildrenToIndex);
  _documents = _documents || [];

  if (isEmpty(_documentTypes)) return callback(null, _documents);

  // Select the next documentType from the list whose child documents to produce
  const documentType = _documentTypes.shift();
  const childSearchDocumentProducer = childSearchDocuments[documentType].producer;
  if (childSearchDocumentProducer) {
    childSearchDocumentProducer(resourceChildrenToIndex[documentType], (errs, documents) => {
      // Some resources might have triggered an error. We log those here,
      // but we try to include any documents that were generated
      _.each(errs, err => {
        log().error({ err }, 'Error producing child search documents from resources');
      });

      _documents = _.union(_documents, documents);
      return _produceAllChildDocuments(resourceChildrenToIndex, callback, _documentTypes, _documents);
    });
  } else {
    log().warn(
      'Ignoring %s documents of type "%s", which do not have an associated child document producer',
      resourceChildrenToIndex[documentType].length,
      documentType
    );
    return _produceAllResourceDocuments(resourceChildrenToIndex, callback, _documentTypes, _documents);
  }
};

export {
  SearchAPI as emitter,
  registerSearchDocumentTransformer,
  registerSearchDocumentProducer,
  registerSearch,
  registerReindexAllHandler,
  registerChildSearchDocument,
  refreshSearchConfiguration,
  buildIndex,
  search,
  postReindexAllTask,
  postIndexTask,
  postDeleteTask
};
