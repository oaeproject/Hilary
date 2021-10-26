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

import { format } from 'node:util';
import _ from 'underscore';
import { not, equals, map, isEmpty, mergeAll, forEachObjIndexed, pipe, isNil } from 'ramda';

import * as cassandra from 'cassandra-driver';

// eslint-disable-next-line no-unused-vars
import * as OAE from 'oae-util/lib/oae.js';
import { logger } from 'oae-logger';
import { telemetry } from 'oae-telemetry';
import * as OaeUtil from 'oae-util/lib/util.js';

const { Row, dataTypes } = cassandra.types;
const differs = pipe(equals, not);
const isNotNil = pipe(isNil, not);
const isNotEmpty = pipe(isEmpty, not);

let log = null;
let Telemetry = null;

const DEFAULT_ITERATEALL_BATCH_SIZE = 100;
let CONFIG = null;
let client = null;

/**
 * Initializes the keyspace in config.keyspace with the CF's in all the modules their schema.js code.
 *
 * @param  {Object}    config          A Configuration object that can be used as the Cassandra client config.
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const init = function (config, callback) {
  callback = callback || function () {};
  CONFIG = config;

  log = logger('oae-cassandra');

  Telemetry = telemetry('cassandra');
  const { keyspace } = CONFIG;
  CONFIG.keyspace = 'system';
  client = _createNewClient(CONFIG.hosts, CONFIG.keyspace);

  client.connect((error) => {
    // Immediately switch the CONFIG keyspace back to the desired keyspace
    CONFIG.keyspace = keyspace;

    if (error) {
      log().error({ err: error }, 'Error connecting to cassandra');
      return callback({ code: 500, msg: 'Error connecting to cassandra' });
    }

    createKeyspace(keyspace, (error) => {
      if (error) {
        close(() => {
          callback(error);
        });
      }

      client = _createNewClient(CONFIG.hosts, keyspace);
      callback();
    });
  });
};

const _createNewClient = function (hosts, keyspace) {
  const loadBalancingPolicy = new cassandra.policies.loadBalancing.RoundRobinPolicy();
  const reconnectionPolicy = new cassandra.policies.reconnection.ConstantReconnectionPolicy(CONFIG.timeout);
  return new cassandra.Client({
    contactPoints: hosts,
    policies: {
      timestampGeneration: null,
      loadBalancing: loadBalancingPolicy,
      reconnection: reconnectionPolicy
    },
    keyspace,
    protocolOptions: { maxVersion: 3 },
    socketOptions: {
      connectTimeout: CONFIG.timeout,
      readTimeout: CONFIG.timeout
    },
    consistency: cassandra.types.consistencies.quorum
  });
};

/**
 * Close all the connections in the connection pool.
 *
 * @param  {Function}  callback  Standard callback function
 */
const close = function (callback) {
  client.shutdown((error) => {
    if (error) {
      log().error({ err: error }, 'Error closing the cassandra connection pool');
      return callback({ code: 500, msg: 'Error closing the cassandra connection pool' });
    }

    return callback();
  });
};

/**
 * Create a keyspace if it does not exist. If it does, then this will have no effect.
 *
 * @param  {String}    name                The name of your keyspace
 * @param  {Function}  callback            Standard callback function
 * @param  {Object}    callback.err        An error that occurred, if any
 * @param  {Boolean}   callback.created    Specifies whether or not a keyspace was actually created.
 */
const createKeyspace = function (keyspace, callback) {
  callback = callback || function () {};
  const config = CONFIG;

  const options = {
    name: keyspace,
    strategyClass: config.strategyClass || 'SimpleStrategy',
    strategyOptions: config.strategyOptions,
    replication: config.replication || 1,
    durable: config.durable
  };

  const query = `CREATE KEYSPACE IF NOT EXISTS "${keyspace}" WITH REPLICATION = { 'class': '${options.strategyClass}', 'replication_factor': ${options.replication} }`;

  client.execute(query, (error) => {
    if (error) return callback(error);
    // Pause for a second to ensure the keyspace gets agreed upon across the cluster.
    setTimeout(callback, 1000, null, true);
  });
};

/**
 * Drops a keyspace
 *
 * @param  {String}    name                The keyspace that should be dropped.
 * @param  {Function}  callback            Standard callback function
 * @param  {Object}    callback.err        An error that occurred, if any
 * @param  {Boolean}   callback.dropped    Whether or not the keyspace was dropped
 */
const dropKeyspace = function (name, callback) {
  callback = callback || function () {};
  runQuery(`DROP KEYSPACE "${name}"`, null, (error) => {
    if (error) {
      return callback(error);
    }

    return callback(null, true);
  });
};

/**
 * Checks if a keyspace exists or not.
 *
 * @param  {String}     name            The name of the keyspace to check
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Boolean}    callback.exists Whether or not the keyspace existed
 */
const keyspaceExists = function (name, callback) {
  const query = `SELECT keyspace_name FROM system.schema_keyspaces WHERE keyspace_name = '${name}'`;

  client.execute(query, (error, results) => {
    if (results.rowLength === 0) {
      return callback(null, false);
    }

    if (error) {
      log().error({ err: error, name }, 'Error while describing cassandra keyspace');
      callback({ code: 500, msg: 'Error while describing cassandra keyspace' });
    }

    return callback(null, true);
  });
};

/**
 * Checks if a CF exists or not.
 *
 * @param  {String}   name     The name of the CF to check.
 * @param  {Function} callback Standard callback function
 */
const columnFamilyExists = function (name, callback) {
  runQuery(
    `SELECT columnfamily_name FROM system.schema_columnfamilies WHERE keyspace_name = ? AND columnfamily_name = ?`,
    [CONFIG.keyspace, name],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      return callback(null, isNotEmpty(rows));
    }
  );
};

/**
 * Drops a Column family. A query will only be performed if the CF exists.
 *
 * @param  {String}   name     The name of CF you wish to drop.
 * @param  {Function} callback Standard callback function
 */
const dropColumnFamily = function (name, callback) {
  // Only drop if it exists
  columnFamilyExists(name, (error, exists) => {
    if (error) {
      return callback(error);
    }

    if (!exists) {
      return callback({
        code: 400,
        msg: 'The table ' + name + ' could not be dropped as it does not exist'
      });
    }

    runQuery(`DROP TABLE "${name}"`, [], (error_) => {
      if (error_) {
        return callback(error_);
      }

      return callback();
    });
  });
};

/**
 * Drop a batch of column families. This is a helper method that will be
 * used by various OAE modules when they are initialized. The column families
 * will only be created when they don't exist yet
 *
 * @param  {Array}         families        Array containing the names of all column families that should be dropped
 * @param  {Function}      callback        Standard callback function
 * @param  {Object}        callback.err    An error that occurred, if any
 */
const dropColumnFamilies = function (families, callback) {
  callback = callback || function () {};
  _dropColumnFamilies(families, callback);
};

/**
 * Synchronously drop a batch of column families. The array passed in here will be altered in order to recursively
 * drop the column families.
 *
 * @param  {Array}      families        Array containing the names of all column families that should be dropped.
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _dropColumnFamilies = function (families, callback) {
  if (isEmpty(families)) {
    return callback();
  }

  const family = families.pop();
  dropColumnFamily(family, (error) => {
    if (error) {
      return callback(error);
    }

    _dropColumnFamilies(families, callback);
  });
};

/**
 * Creates a CF if it doesn't exist yet. This is basically a helper method
 * that allows for quick creation of CF if nescecary.
 * Do NOT use this in a concurrent way as the pooled connection will be shut down!
 *
 * @param  {String}                  name               CF name
 * @param  {String}    cql                The CQL that can be used to create the CF if it doesn't exist.
 * @param  {Function}  callback           Standard callback function
 * @param  {Object}    callback.err       Error object containing the error message
 * @param  {Boolean}   callback.created   Whether or not the column family has actually been created
 */
const createColumnFamily = function (name, cql, callback) {
  callback = callback || function () {};
  columnFamilyExists(name, (error, exists) => {
    if (error) {
      return callback(error);
    }

    if (exists) {
      callback(null, false);
    } else {
      runQuery(cql, false, (error_) => {
        if (error_) {
          return callback(error_);
        }

        callback(null, true);
      });
    }
  });
};

/**
 * Create a batch of column families. This is a helper method that will be
 * used by various OAE modules when they are initialized. The column families
 * will only be created when they don't exist yet
 *
 * @param  {Object}        families        JSON object representing the column families that need to be created. The keys are the names of the CFs, the values are the CQL statements required to create them
 * @param  {Function}      callback        Standard callback function
 * @param  {Object}        callback.err    An error that occurred, if any
 */
const createColumnFamilies = function (families, callback) {
  callback = callback || function () {};
  const keys = _.keys(families);
  _createColumnFamilies(keys, families, callback);
};

/**
 * Internal version of createColumnFamilies that is equiped to create a set of column families synchronously.
 *
 * @param  {String[]}      keys            The key array (keys of the families JSON object) identifying the CF's to create
 * @param  {Object}        families        JSON object representing the column families that need to be created. The keys are the names of the CFs, the values are the CQL statements required to create them
 * @param  {Function}      callback        Standard callback function
 * @param  {Object}        callback.err    An error that occurred, if any
 * @api private
 */
const _createColumnFamilies = function (keys, families, callback) {
  if (isEmpty(keys)) {
    return callback();
  }

  const cfKey = keys.pop();
  createColumnFamily(cfKey, families[cfKey], (error) => {
    if (error) {
      return callback(error);
    }

    _createColumnFamilies(keys, families, callback);
  });
};

/**
 * Run a single Cassandra query.
 *
 * @param  {String}   query         The CQL query
 * @param  {array}    parameters    An array of values that can be interpreted by cassandra. If an element is detected as an array the query and parameters will be fixed.
 * @param  {Function} callback      Standard callback function
 * @param  {Object}   callback.err  An error that occurred, if any
 */
const runQuery = function (query, parameters, callback) {
  if (query.indexOf('SELECT') === 0) {
    Telemetry.incr('read.count');
  } else {
    Telemetry.incr('write.count');
  }

  executeQuery(query, parameters, callback);
};

/**
 * Run an auto paged query
 *
 * @param  {type} query             The CQL query
 * @param  {type} parameters        An array of values that can be interpreted by cassandra
 * @param  {type} callback          Standard callback function
 * @param  {type} callback.err      An error that occurred, if any
 * @param  {type} callback.rows     The rows returned by the CQL query
 */
const runAutoPagedQuery = function (query, parameters, callback) {
  if (query.indexOf('SELECT') === 0) {
    Telemetry.incr('read.count');
  } else {
    Telemetry.incr('write.count');
  }

  const rows = [];
  client
    .stream(query, parameters, { prepare: true })
    .on('readable', function () {
      let row;
      while ((row = this.read())) {
        rows.push(row);
      }
    })
    .on('error', (error) => {
      callback(error);
    })
    .on('end', () => {
      // Emitted when all rows have been retrieved and read
      callback(null, rows);
    });
};

/**
 * Run a batch of Cassandra update and insert queries with consistency QUORUM.
 *
 * @param  {Object[]}   queries             An array of simple hashes. Each hash should contain a query key and parameters key
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const runBatchQuery = function (queries, callback) {
  callback = callback || function () {};

  if (isEmpty(queries)) {
    return callback();
  }

  Telemetry.incr('write.count', queries.length);

  queries = map(
    (eachQueryElement) =>
      mergeAll([
        {
          query: eachQueryElement.query
        },
        { params: eachQueryElement.parameters }
      ]),
    queries
  );

  client.batch(queries, { prepare: true }, (error, result) => {
    if (error) return callback(error);

    return callback(null, result.rows);
  });
};

/**
 * Query a page of data from a given range query
 *
 * Note: This method existed because of restrictions in CQL2 with column slices and was going to be removed
 * when changing to CQL3. However, when moving to CQL3, the bug https://issues.apache.org/jira/browse/CASSANDRA-6330
 * makes this method still useful.
 *
 * Once the issue is fixed, this method should be removed in place of methods simply using CQL3's >, >=, <, <= operators
 * to page data as it is more straight-forward.
 *
 * @param  {String}     tableName               The name of the table to query
 * @param  {String}     keyColumnName           The name of the key column to query
 * @param  {String}     keyColumnValue          The value of the key column to query
 * @param  {String}     rangeColumnName         The name of the column that provides the range of items to query
 * @param  {String}     [start]                 The *exclusive* starting point of the query. If unspecified, will start from the beginning
 * @param  {Number}     [limit]                 The maximum number of columns to fetch. Defaults to 25
 * @param  {Object}     [opts]                  Advanced query options
 * @param  {Boolean}    [opts.reversed]         Whether or not the columns should be queried in reverse direction (highest to lowest). If `true`, the `start` range should be the *high range* from which you wish to start return columns. Defaults to `false`
 * @param  {String}     [opts.end]              The *inclusive* ending point of the query. If unspecified, will query columns to the end of the row
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Row[]}      callback.rows           An array of Cassandra rows representing the queried page
 * @param  {String}     callback.nextToken      The value to use for the `start` parameter to get the next set of results
 * @param  {Boolean}    callback.startMatched   Indicates if the `start` parameter was an exact match to a column that was removed from the result set
 */
const runPagedQuery = function (
  tableName,
  keyColumnName,
  keyColumnValue,
  rangeColumnName,
  start,
  limit,
  options,
  callback
) {
  limit = OaeUtil.getNumberParam(limit, 25);
  options = options || {};

  const startOperator = options.reversed ? '<' : '>';
  const endOperator = options.reversed ? '>=' : '<=';

  let cql = format('SELECT * FROM "%s" WHERE "%s" = ?', tableName, keyColumnName);
  const parameters = [keyColumnValue];

  if (start) {
    cql += format(' AND "%s" %s ?', rangeColumnName, startOperator);
    parameters.push(start);
  }

  if (options.end) {
    cql += format(' AND "%s" %s ?', rangeColumnName, endOperator);
    parameters.push(options.end);
  }

  if (options.reversed) {
    cql += format(' ORDER BY "%s" DESC', rangeColumnName);
  }

  cql += format(' LIMIT %s', limit);

  runQuery(cql, parameters, (error, rows) => {
    if (error) {
      return callback(error);
    }

    if (isEmpty(rows)) {
      return callback(null, [], null, false);
    }

    const results = rows.slice(0, limit);
    const nextToken = results.length === limit ? _.last(results).get(rangeColumnName) : null;

    return callback(null, results, nextToken, false);
  });
};

/**
 * Similar to Cassandra#runPagedQuery, but this will automatically page through all the results and
 * return all the rows that were queried
 *
 * @param  {String}     tableName               The name of the table to query
 * @param  {String}     keyColumnName           The name of the key column to query
 * @param  {String}     keyColumnValue          The value of the key column to query
 * @param  {String}     rangeColumnName         The name of the column that provides the range of items to query
 * @param  {Object}     [opts]                  Advanced query options
 * @param  {String}     [opts.start]            The start at which to fetch pages. By default, will start at the first row
 * @param  {String}     [opts.end]              The end at which to stop fetching pages. By default, will go to the last row
 * @param  {Number}     [opts.batchSize]        The maximum size of the pages to query. Default: 500
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Rows[]}     callback.rows           All the available rows for the query
 */
const runAllPagesQuery = function (
  tableName,
  keyColumnName,
  keyColumnValue,
  rangeColumnName,
  options,
  callback,
  _nextToken,
  _rows
) {
  _rows = _rows || [];
  options = options || {};
  options.batchSize = options.batchSize || 500;

  // The `opts.start` option will only be applied for the first iteration if specified. Subsequent
  // recursive iterations will fall back to `_nextToken`
  const start = options.start || _nextToken;
  runPagedQuery(
    tableName,
    keyColumnName,
    keyColumnValue,
    rangeColumnName,
    start,
    options.batchSize,
    { end: options.end },
    (error, rows, nextToken) => {
      if (error) {
        return callback(error);
      }

      // Append the rows to the accumulated rows array
      _rows = _.union(_rows, rows);

      // Return to the caller if we've fetched all rows
      if (nextToken === null) {
        return callback(null, _rows);
      }

      // Subsequent iterations should not apply the `start` option
      if (options.start) {
        options = _.extend({}, options);
        delete options.start;
      }

      // Recursively fetch the next page
      return runAllPagesQuery(
        tableName,
        keyColumnName,
        keyColumnValue,
        rangeColumnName,
        options,
        callback,
        nextToken,
        _rows
      );
    }
  );
};

/**
 * Iterate through all the rows of a column family in a completely random order. This will return just the columnNames that are
 * specified in the `columnNames` parameter, and at most `batchSize` rows at a time. On each iteration of `batchSize` rows, the
 * `onEach` callback will be executed. When the `onEach.done` function parameter is invoked without an error parameter, then the
 * next batch of rows will be fetched. If an object is provided as the first parameter to `onEach.done`, then iteration will
 * stop and the `callback` method will be invoked with the error.
 *
 * Since it is possible for Cassandra to return rows that were recently deleted as "tombstones", this method can also accept an
 * `opts.slugColumnName` option, which tells the iterator to use that column to determine whether or not the row truly exists. If
 * the value in the slug column that is fetched from storage has no value, then the row is deemed invalid and will not be returned
 * in the result set. While the slug column value will be fetched from the data-store to determine if the row is valid, it will
 * only be returned in the row if specified by the `columnNames` property. Since deleted rows are simply removed from the result
 * set, it is possible for the number of `rows` in each batch to actually be less than the specified batch size.
 *
 * @param  {String[]}   [columnNames]           The names of the columns to return in the rows. If not specified (or is empty array), it selects all columns. This is generally not recommended and should be avoided if possible.
 * @param  {String}     columnFamily            The column family to iterate over.
 * @param  {String}     keyColumnName           The name of the column that represents the key of the row.
 * @param  {Object}     [opts]                  Additional optional parameters
 * @param  {Number}     [opts.batchSize]        The number of rows to fetch at a time. Defaults to 100.
 * @param  {String}     [opts.slugColumnName]   The name of the column to use to check whether or not the row is a "tombstone". If a row is in storage that doesn't have a value for this column, then the row will not be returned in the results.
 * @param  {Function}   onEach                  Invoked with each batch of rows that are fetched from storage. If an exception is thrown in the *same process tick* in which it is invoked, onEach will be invoked with the `err` that was thrown and no more iterations will complete.
 * @param  {Rows}       onEach.rows             A helenus `Rows` object, holding all the rows fetched from storage in this iteration.
 * @param  {Function}   onEach.done             The function to invoke when you are ready to proceed to the next batch of rows
 * @param  {Boolean}    onEach.done.err         Specify this error parameter if there was an error processing the batch of data. Specifying this error will stop iteration and it will be passed directly into the completion `callback`.
 * @param  {Function}   [callback]              Invoked when either all rows have finished being iterated, or there was an error
 * @param  {Object}     [callback.err]          An error that occurred while iterating, if any.
 */
const iterateAll = function (columnNames, columnFamily, keyColumnName, options, onEach, callback) {
  callback =
    callback ||
    function (error) {
      if (error) {
        log().error(
          {
            err: error,
            columnNames,
            columnFamily,
            opts: options
          },
          'Error while iterating over all rows in storage.'
        );
      }
    };

  // Apply default options
  options = options || {};
  options.batchSize = OaeUtil.getNumberParam(options.batchSize, DEFAULT_ITERATEALL_BATCH_SIZE);

  let returnKeyColumn = true;
  if (columnNames) {
    // We will always return the key column in the Cassandra query so we know where to start the
    // next row iteration range
    const extraColumnNames = [keyColumnName];

    // Only return the key column to the caller if they specified to do so
    returnKeyColumn = columnNames.includes(keyColumnName);

    // Add the additional entries to the column names
    columnNames = _.union(columnNames, extraColumnNames);
  }

  return _iterateAll(columnNames, columnFamily, keyColumnName, returnKeyColumn, options.batchSize, onEach, callback);
};

/**
 * Internal version of #iterateAll method. The method contract is the same as `Cassandra#iterateAll`, but this has internal parameters
 * for iteration.
 *
 * @param  {String[]}   [columnNames]       See `columnNames` in `Cassandra#iterateAll`
 * @param  {String}     columnFamily        See `columnFamily` in `Cassandra#iterateAll`
 * @param  {String}     keyColumnName       See `keyColumnName` in `Cassandra#iterateAll`
 * @param  {Boolean}    returnKeyColumn     Whether or not the column specified by `keyColumnName` should be part of the returned rows
 * @param  {Number}     batchSize           See `opts.batchSize` in `Cassandra#iterateAll`
 * @param  {Function}   onEach              See `onEach` in `Cassandra#iterateAll`
 * @param  {Function}   callback            Standard callback function
 * @param  {String}     fromKey             Used for recursion only. Specifies the key from which the next iteration batch should start
 * @api private
 */
const _iterateAll = function (
  columnNames,
  columnFamily,
  keyColumnName,
  returnKeyColumn,
  batchSize,
  onEach,
  callback,
  fromKey
) {
  const columns = [
    { name: 'keyId', type: { code: dataTypes.text } },
    { name: 'colOne', type: { code: dataTypes.text } },
    { name: 'colTwo', type: { code: dataTypes.text } }
  ];

  const query = _buildIterateAllQuery(columnNames, columnFamily, keyColumnName, batchSize, fromKey);
  // Since Cassandra.runQuery jumps into a new process tick, there is no issue over this recursion exceeding stack size with large data-sets
  runQuery(query.query, query.parameters, (error, rows) => {
    if (error) {
      return callback(error);
    }

    if (isEmpty(rows)) {
      // Notify the caller that we've finished
      return callback();
    }

    const requestedRowColumns = [];
    _.each(rows, (row) => {
      // Remember the last key to use for the next iteration
      fromKey = row.get(keyColumnName);

      // Clean the key off the row if it was not requested
      if (!returnKeyColumn) {
        const newRowContent = [];
        _.each(row.keys(), (eachKey) => {
          if (eachKey !== keyColumnName) {
            newRowContent.push({
              key: eachKey,
              value: row.get(eachKey),
              column: _.find(columns, (eachItem) => equals(eachItem.name, eachKey))
            });
          }
        });

        row = new Row(_.pluck(newRowContent, 'column'));
        _.each(newRowContent, (eachNewRowContent) => {
          row[eachNewRowContent.key] = eachNewRowContent.value;
        });
      }

      requestedRowColumns.push(row);
    });
    rows = requestedRowColumns;

    try {
      // Give the rows to the caller. Wrapping in a try / catch so if an error is thrown (in the same processor tick) then
      // we can still catch the error and invoke the callback with it
      onEach(rows, (error_) => {
        if (error_) {
          return callback(error_);
        }

        // Start the next iteration
        _iterateAll(columnNames, columnFamily, keyColumnName, returnKeyColumn, batchSize, onEach, callback, fromKey);
      });
    } catch (error) {
      log().error({ err: error }, 'Error invoking consumer onEach during iterateAll');
      return callback({ code: 500, msg: error.message });
    }
  });
};

/**
 * Build a query that can be used to select `batchSize` rows from a column family starting from key `fromKey`.
 *
 * @param  {String[]}   [columnNames]   The names of the columns to query in the rows. If not specified (or is empty array), it selects all columns.
 * @param  {String}     columnFamily    The column family to query.
 * @param  {String}     keyColumnName   The name of the column that represents the key of the column family.
 * @param  {Number}     batchSize       The number of rows to fetch.
 * @param  {String}     fromKey         The value of the row key from which to start fetching results.
 * @return {Object}                     An object with key `query` that contains the String CQL query, and key `parameters` that holds an array of parameters that fill the query placeholders in the Cassandra query.
 * @api private
 */
const _buildIterateAllQuery = function (columnNames, columnFamily, keyColumnName, batchSize, fromKey) {
  let cql = 'SELECT ';
  const parameters = [];

  cql += _.isEmpty(columnNames)
    ? '*'
    : _.map(columnNames, (columnName) => {
        // Check if `columnName` contains a quote as it might be calling a function
        if (!columnName.includes('"')) {
          return format('"%s"', columnName);

          // Return as-is
        }

        return columnName;
      }).join(', ');

  cql += format(' FROM "%s"', columnFamily);

  if (fromKey) {
    cql += format(' WHERE token("%s") > token(?)', keyColumnName);
    parameters.push(fromKey);
  }

  cql += ' LIMIT ' + batchSize;

  return { query: cql, parameters };
};

/**
 * Convert to given cassandra row to a column hash. Keyed by the column name, with value being the column value.
 *
 * @param  {Row}       row     The cassandra Row to convert to a hash
 * @return {Object}            Return an Object, keyed by the column name, with values being the column value.
 */

const rowToHash = function (row) {
  const result = {};
  forEachObjIndexed((value, name) => {
    /**
     * We filter out null and undefined values,
     * as Cassandra will return these when a query term has not matched against an existing column
     */
    if (isNotNil(value) && differs(value, undefined)) {
      result[name] = value;
    }
  }, row);
  return result;
};

/**
 * Utility method that constructs an update CQL query with a flexible number of columns, that can both
 * be used for inserts and updates. String and Number values will be persisted as their native types,
 * while Objects and Arrays will be stringified.
 *
 * This creates a query with the following form: UPDATE "testCF" SET "field0" = ?, "field1" = ?, "field2" = ? WHERE "rowKey0" = ? AND "rowKey1" = ?
 *
 * @param  {String}             cf          The name of the column family in which we're doing an update/insert
 * @param  {String|String[]}    rowKey      The row key that will be used in the WHERE clause. If an array, the key+value pairs (in same order with `rowValue`) will be `AND` clauses in the WHERE clause of the query
 * @param  {String|String[]}    rowValue    The value of the row key to use in the WHERE clause. If an array, the key+value pairs (in same order with `rowKey`) will be `AND` clauses in the WHERE clause of the query
 * @param  {Object}             values      JSON object where the keys represent the column names of the columns that need to be updated/inserted and the values represent the new column values
 * @param  {Number}             [ttl]       The ttl that should be used for the columns upserted by this query, if any. If not specified, columns upserted will not expire
 * @return {Object}                         Returns a JSON object with a query key that contains the generated CQL query and a parameters key that contains the generated parameter array {query: CQLQuery, parameters: [parameterArray]}
 */
const constructUpsertCQL = function (cf, rowKey, rowValue, values, ttl) {
  // Ensure the upsert CQL does not contain the row key in the SET portion by removing it. This is
  // set automatically by the "WHERE" clause with the row key
  values = _.omit(values, rowKey);

  // Ensure that the column family, a row key and row value, as well as at least one value has been specified
  if (!cf || !rowKey || !rowValue || !_.isObject(values) || _.isEmpty(values)) {
    return false;
  }

  if (_.isArray(rowKey)) {
    // If the row key is an array, the row value should be an array of the same length
    if (!_.isArray(rowValue) || rowKey.length !== rowValue.length) {
      return false;
    }
  } else if (_.isArray(rowValue)) {
    // If the row key was not an array, the row value should also not be an array
    return false;
  }

  // Convert non-array values into an array
  if (!_.isArray(rowKey)) {
    rowKey = [rowKey];
    rowValue = [rowValue];
  }

  // Construct the query
  const q = { query: '', parameters: [] };
  const columns = [];

  // Each entry in the value hash is one column in the cassandra row
  _.each(values, (value, key) => {
    // Stringify objects as JSON
    if (_.isObject(value)) {
      value = JSON.stringify(value);
    }

    if (!_.isUndefined(value) && !_.isNull(value)) {
      columns.push(format('"%s" = ?', key));
      q.parameters.push(value);
    }
  });

  q.query = format('UPDATE "%s"', cf);

  if (_.isNumber(ttl)) {
    q.query += format(' USING TTL %s', ttl);
  }

  const whereClause = [];
  for (const [i, element] of rowKey.entries()) {
    whereClause.push(format('"%s" = ?', element));
    q.parameters.push(rowValue[i]);
  }

  q.query += format(' SET %s WHERE %s', columns.join(', '), whereClause.join(' AND '));

  return q;
};

/**
 * Actually executes a query
 *
 * @param  {String}     query           The query
 * @param  {Object[]}   [parameters]    The parameters that match this query, if applicable
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const executeQuery = function (query, parameters, callback) {
  callback = callback || function () {};
  parameters = parameters || [];

  // Check for null parameters that have been passed in. We have to intercept this
  // because otherwise the query will fail and an "All connections are unhealty"
  // error will start coming back for each Cassandra query
  for (let p = 0; p < parameters.length; p++) {
    if (OaeUtil.isUnspecified(parameters[p])) {
      _logCustomError('Invalid cassandra query specified.', { query, parameters });
      return callback({ code: 400, msg: 'An incorrect query has been attempted' });
    }
  }

  // Copy the parameters if they were specified so we can log on them if there is an error
  const logParameters = parameters ? parameters : null;

  client.execute(query, parameters, { prepare: true }, (error, resultSet) => {
    if (error) {
      log().error(_truncateLogParameters(error, query, logParameters), 'An error occurred executing a cassandra query');
      return callback({ code: 500, msg: 'An error occurred executing a query' });
    }

    log().trace(
      {
        query,
        parameters: logParameters,
        rows: resultSet.rows
      },
      'Executed cassandra query'
    );

    return callback(null, resultSet.rows);
  });
};

/**
 * Describes the keyspace identified by 'keyspace'.
 *
 * @param  {String}     keyspace            The keyspace to describe
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Object}     callback.definition The keyspace definition. If null, then the keyspace does not exist.
 * @api private
 */
// eslint-disable-next-line no-unused-vars
const _describeKeyspace = function (keyspace, callback) {
  const query = `DESCRIBE KEYSPACE ${keyspace}`;
  client.execute(query, (error, definition) => {
    if (error && error.name) {
      if (error.name === 'NotFoundException') {
        callback();
      } else {
        log().error({ err: error }, 'Error while describing cassandra keyspace');
        callback({ code: 500, msg: 'Error while describing cassandra keyspace' });
      }
    } else {
      callback(null, definition);
    }
  });
};

/**
 * Log a custom error with a stack trace so it can be diagnosed in the logs.
 *
 * @param  {String}     msg     The message of the error
 * @param  {Object}     data    Error data to log in the message. Any `err` key on this object will be overridden by the custom error.
 * @api private
 */
const _logCustomError = function (message, data) {
  data = data || {};
  data.err = new Error(message);
  log().error(_truncateLogParameters(data.err, data.query, data.parameters), message);
};

/**
 * Truncate the given cassandra query log parameters to an acceptable size for
 * logging
 *
 * @param  {Error}      err         The Helenus query error
 * @param  {String}     query       The query string of the query
 * @param  {String[]}   params      The query parameters
 * @return {Object}                 The log data object to use when logging these parameters
 * @api private
 */
const _truncateLogParameters = function (error, query, parameters) {
  // We truncate the query string to a maximum
  const queryMaxStringLength = 300;

  // We truncate the params string representation to a maximum. Only if it
  // exceeds the max string length do we apply the length for maximum params
  // array size and individual paramter string length
  const parametersStringMaxLength = 800;
  const parametersArrayMaxLength = 10;
  const parameterStringMaxLength = 80;

  // Truncate the query string if necessary
  query = _truncateString(query, queryMaxStringLength);

  // Truncate the query parameters if necessary
  const parametersString = JSON.stringify(parameters);
  if (parametersString && parametersString.length > parametersStringMaxLength) {
    // Truncate each log parameter if necessary
    parameters = _.map(
      parameters.slice(0, parametersArrayMaxLength),
      _.partial(_truncateString, _, parameterStringMaxLength)
    );
  }

  return {
    err: error,
    query,
    parameters
  };
};

/**
 * Truncate the given string if it is longer than the specified size
 *
 * @param  {String}     str         The string to truncate
 * @param  {Number}     ifOverSize  The string will only be truncated if it is longer than this size
 * @return {String}                 The truncated string. If truncated, there's no guarantee on the new length, but it will be unsubstantially longer than `ifOverSize` (i.e., ~10 characters more)
 * @api private
 */
const _truncateString = function (string, ifOverSize) {
  if (_.isString(string) && string.length > ifOverSize) {
    string = format('%s (and %s more)', string.slice(0, ifOverSize), string.length - ifOverSize);
  }

  return string;
};

const parsePreviewsFromRow = (row) => {
  const hash = rowToHash(row);
  if (hash.previews) {
    try {
      hash.previews = JSON.parse(hash.previews);
    } catch {
      hash.previews = {};
    }
  }

  return hash;
};

export {
  init,
  close,
  createKeyspace,
  dropKeyspace,
  keyspaceExists,
  columnFamilyExists,
  dropColumnFamily,
  dropColumnFamilies,
  createColumnFamily,
  createColumnFamilies,
  runQuery,
  runAutoPagedQuery,
  runBatchQuery,
  runPagedQuery,
  runAllPagesQuery,
  iterateAll,
  rowToHash,
  constructUpsertCQL,
  parsePreviewsFromRow
};
