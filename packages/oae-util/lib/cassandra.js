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

import { format, callbackify } from 'node:util';
import _ from 'underscore';
import {
  keys as getKeys,
  not,
  equals,
  of,
  map,
  isEmpty,
  mergeAll,
  forEachObjIndexed,
  __,
  pipe,
  isNil,
  defaultTo,
  concat
} from 'ramda';

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

const defaultToEmptyArray = defaultTo([]);
const isZero = equals(0);

const LT_SIGN = '<';
const LTE_SIGN = '<=';
const GT_SIGN = '>';
const GTE_SIGN = '>=';

/**
 * Initializes the keyspace in config.keyspace with the CF's in all the modules their schema.js code.
 *
 * @param  {Object}    config          A Configuration object that can be used as the Cassandra client config.
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const init = function (config, callback) {
  callbackify(promiseToInit)(config, callback);
};

const promiseToInit = async function (config) {
  CONFIG = config;

  log = logger('oae-cassandra');

  Telemetry = telemetry('cassandra');
  const { keyspace } = CONFIG;
  CONFIG.keyspace = 'system';
  client = _createNewClient(CONFIG.hosts, CONFIG.keyspace);

  try {
    await client.connect();
    // Immediately switch the CONFIG keyspace back to the desired keyspace
    CONFIG.keyspace = keyspace;

    await createKeyspace(keyspace);
    client = _createNewClient(CONFIG.hosts, keyspace);
  } catch (error) {
    log().error({ err: error }, 'Error connecting to cassandra');
    await close();
    throw new Error(JSON.stringify({ code: 500, msg: 'Error connecting to cassandra' }));
  }
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
async function close() {
  try {
    client.shutdown();
  } catch (error) {
    log().error({ err: error }, 'Error closing the cassandra connection pool');
    throw new Error(JSON.stringify({ code: 500, msg: 'Error closing the cassandra connection pool' }));
  }
}

/**
 * Create a keyspace if it does not exist. If it does, then this will have no effect.
 *
 * @param  {String}    name                The name of your keyspace
 * @param  {Function}  callback            Standard callback function
 * @param  {Object}    callback.err        An error that occurred, if any
 * @param  {Boolean}   callback.created    Specifies whether or not a keyspace was actually created.
 */
async function createKeyspace(keyspace) {
  const config = CONFIG;

  const options = {
    name: keyspace,
    strategyClass: config.strategyClass || 'SimpleStrategy',
    strategyOptions: config.strategyOptions,
    replication: config.replication || 1,
    durable: config.durable
  };

  const query = `CREATE KEYSPACE IF NOT EXISTS "${keyspace}" WITH REPLICATION = { 'class': '${options.strategyClass}', 'replication_factor': ${options.replication} }`;

  const result = await client.execute(query);
  /**
   * Pause for a second to ensure the keyspace gets agreed upon across the cluster.
   * eslint-disable-next-line no-promise-executor-return
   */
  await new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });

  return result;
}

/**
 * Drops a keyspace
 *
 * @param  {String}    name                The keyspace that should be dropped.
 */
async function dropKeyspace(name) {
  await runQuery(`DROP KEYSPACE "${name}"`, null);
  return true;
}

/**
 * Checks if a keyspace exists or not.
 *
 * @param  {String}     name            The name of the keyspace to check
 */
async function keyspaceExists(name) {
  const query = `SELECT keyspace_name FROM system.schema_keyspaces WHERE keyspace_name = '${name}'`;

  try {
    const { rows } = await client.execute(query);
    if (isEmpty(rows)) return false;

    return true;
  } catch (error) {
    log().error({ err: error, name }, 'Error while describing cassandra keyspace');
    throw new Error(JSON.stringify({ code: 500, msg: 'Error while describing cassandra keyspace' }));
  }
}

/**
 * Checks if a CF exists or not.
 *
 * @param  {String}   name     The name of the CF to check.
 */
async function columnFamilyExists(name) {
  const rows = await runQuery(
    `SELECT columnfamily_name FROM system.schema_columnfamilies WHERE keyspace_name = ? AND columnfamily_name = ?`,
    [CONFIG.keyspace, name]
  );

  // return and(isNotEmpty, isNotNil)(rows);

  return pipe(defaultToEmptyArray, isNotEmpty)(rows);
}

/**
 * Drops a Column family. A query will only be performed if the CF exists.
 *
 * @param  {String}   name     The name of CF you wish to drop.
 */
async function dropColumnFamily(name) {
  // Only drop if it exists
  const exists = columnFamilyExists(name);
  if (!exists) {
    return new Error(
      JSON.stringify({
        code: 400,
        msg: 'The table ' + name + ' could not be dropped as it does not exist'
      })
    );
  }

  await runQuery(`DROP TABLE "${name}"`, []);
}

/**
 * Drop a batch of column families. This is a helper method that will be
 * used by various OAE modules when they are initialized. The column families
 * will only be created when they don't exist yet
 *
 * @param  {Array}         families        Array containing the names of all column families that should be dropped
 */
const dropColumnFamilies = async (families) => {
  await _dropColumnFamilies(families);
};

/**
 * Synchronously drop a batch of column families. The array passed in here will be altered in order to recursively
 * drop the column families.
 *
 * @param  {Array}      families        Array containing the names of all column families that should be dropped.
 * @api private
 */
async function _dropColumnFamilies(families) {
  if (isEmpty(families)) return;

  const family = families.pop();
  await dropColumnFamily(family);
  await _dropColumnFamilies(families);
}

/**
 * Creates a CF if it doesn't exist yet. This is basically a helper method
 * that allows for quick creation of CF if nescecary.
 * Do NOT use this in a concurrent way as the pooled connection will be shut down!
 *
 * @param  {String}                  name               CF name
 * @param  {String}    cql                The CQL that can be used to create the CF if it doesn't exist.
 */
async function createColumnFamily(name, cql) {
  const exists = await columnFamilyExists(name);
  if (exists) return false;
  await runQuery(cql, false);

  return true;
}

/**
 * Create a batch of column families. This is a helper method that will be
 * used by various OAE modules when they are initialized. The column families
 * will only be created when they don't exist yet
 *
 * @param  {Object}        families        JSON object representing the column families that need to be created. The keys are the names of the CFs, the values are the CQL statements required to create them
 */
async function createColumnFamilies(families) {
  const keys = getKeys(families);
  await _createColumnFamilies(keys, families);
}

/**
 * Internal version of createColumnFamilies that is equiped to create a set of column families synchronously.
 *
 * @param  {String[]}      keys            The key array (keys of the families JSON object) identifying the CF's to create
 * @param  {Object}        families        JSON object representing the column families that need to be created. The keys are the names of the CFs, the values are the CQL statements required to create them
 * @api private
 */
async function _createColumnFamilies(keys, families) {
  if (isEmpty(keys)) return;

  const cfKey = keys.pop();
  await createColumnFamily(cfKey, families[cfKey]);
  return _createColumnFamilies(keys, families);
}

/**
 * Run a single Cassandra query.
 *
 * @param  {String}   query         The CQL query
 * @param  {array}    parameters    An array of values that can be interpreted by cassandra. If an element is detected as an array the query and parameters will be fixed.
 */
function runQuery(query, parameters) {
  if (isZero(query.indexOf('SELECT'))) {
    Telemetry.incr('read.count');
  } else {
    Telemetry.incr('write.count');
  }

  return executeQuery(query, parameters);
}

/**
 * Run an auto paged query
 *
 * @param  {type} query             The CQL query
 * @param  {type} parameters        An array of values that can be interpreted by cassandra
 */
function runAutoPagedQuery(query, parameters, callback) {
  if (isZero(query.indexOf('SELECT'))) {
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
      throw error;
    })
    .on('end', () => {
      callback(null, rows);
    });
}

/**
 * Run a batch of Cassandra update and insert queries with consistency QUORUM.
 *
 * @param  {Object[]}   queries             An array of simple hashes. Each hash should contain a query key and parameters key
 */
async function runBatchQuery(queries) {
  if (isEmpty(queries)) return;

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

  const result = await client.batch(queries, { prepare: true });
  return result.rows;
}

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
 */
async function runPagedQuery(tableName, keyColumnName, keyColumnValue, rangeColumnName, start, limit, options) {
  const refinedParameters = refineParameters({ limit, options });
  limit = refinedParameters.limit;
  options = refinedParameters.options;
  const { startOperator, endOperator } = refinedParameters;

  const parameters = pipe(of, applyStartParameters(start), applyEndParameters(options))(keyColumnValue);

  let cql = `SELECT * FROM "${tableName}" WHERE "${keyColumnName}" = ?`;
  cql = pipe(
    applyStartPage(start, rangeColumnName, startOperator),
    applyEndPage(options, rangeColumnName, endOperator),
    applyOrderBy(options, rangeColumnName),
    applyLimit(limit)
  )(cql);

  const rows = await runQuery(cql, parameters);

  if (isEmpty(rows)) return { rows: [], nextToken: null, startMatched: false };
  const results = rows.slice(0, limit);
  const nextToken = results.length === limit ? _.last(results).get(rangeColumnName) : null;

  return { rows: results, nextToken, startMatched: false };
}

const applyStartPage = (start, rangeColumnName, startOperator) => {
  if (start) {
    return concat(__, ` AND "${rangeColumnName}" ${startOperator} ?`);
  }

  return concat('');
};

const applyEndPage = (options, rangeColumnName, endOperator) => {
  if (options.end) {
    return concat(__, ` AND "${rangeColumnName}" ${endOperator} ?`);
  }

  return concat('');
};

const applyOrderBy = (options, rangeColumnName) => {
  if (options.reversed) {
    return concat(__, ` ORDER BY "${rangeColumnName}" DESC`);
  }

  return concat('');
};

const applyLimit = (limit) => concat(__, ` LIMIT ${limit}`);

const applyStartParameters = (start) => {
  if (start) {
    return concat(__, of(start));
  }

  return concat([]);
};

const applyEndParameters = (options) => {
  if (options.end) {
    return concat(__, of(options.end));
  }

  return concat([]);
};

const refineParameters = (parameters) => {
  let { limit, options } = parameters;

  limit = OaeUtil.getNumberParam(limit, 25);
  options = defaultTo({}, options);

  let startOperator;
  let endOperator;
  if (options.reversed) {
    startOperator = LT_SIGN;
    endOperator = GTE_SIGN;
  } else {
    startOperator = GT_SIGN;
    endOperator = LTE_SIGN;
  }

  return { limit, options, startOperator, endOperator };
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
 */
async function runAllPagesQuery(tableName, keyColumnName, keyColumnValue, rangeColumnName, options, _nextToken, _rows) {
  _rows = _rows || [];
  options = options || {};
  options.batchSize = options.batchSize || 500;

  // The `opts.start` option will only be applied for the first iteration if specified. Subsequent
  // recursive iterations will fall back to `_nextToken`
  const start = options.start || _nextToken;
  const { rows, nextToken } = await runPagedQuery(
    tableName,
    keyColumnName,
    keyColumnValue,
    rangeColumnName,
    start,
    options.batchSize,
    { end: options.end }
  );

  // Append the rows to the accumulated rows array
  _rows = _.union(_rows, rows);

  // Return to the caller if we've fetched all rows
  if (isNil(nextToken)) return _rows;

  // Subsequent iterations should not apply the `start` option
  if (options.start) {
    options = _.extend({}, options);
    delete options.start;
  }

  // Recursively fetch the next page
  return runAllPagesQuery(tableName, keyColumnName, keyColumnValue, rangeColumnName, options, nextToken, _rows);
}

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
 */
function iterateAll(columnNames, columnFamily, keyColumnName, options, onEach) {
  // Apply default options
  options = options || {};
  options.batchSize = OaeUtil.getNumberParam(options.batchSize, DEFAULT_ITERATEALL_BATCH_SIZE);

  let returnKeyColumn = true;
  if (columnNames) {
    /**
     * We will always return the key column in the Cassandra query so we know where to start the
     * next row iteration range
     */
    const extraColumnNames = [keyColumnName];

    // Only return the key column to the caller if they specified to do so
    returnKeyColumn = columnNames.includes(keyColumnName);

    // Add the additional entries to the column names
    columnNames = _.union(columnNames, extraColumnNames);
  }

  return _iterateAll(columnNames, columnFamily, keyColumnName, returnKeyColumn, options.batchSize, onEach);
}

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
 * @param  {String}     fromKey             Used for recursion only. Specifies the key from which the next iteration batch should start
 * @api private
 */
async function _iterateAll(columnNames, columnFamily, keyColumnName, returnKeyColumn, batchSize, onEach, fromKey) {
  const columns = [
    { name: 'keyId', type: { code: dataTypes.text } },
    { name: 'colOne', type: { code: dataTypes.text } },
    { name: 'colTwo', type: { code: dataTypes.text } }
  ];

  const query = _buildIterateAllQuery(columnNames, columnFamily, keyColumnName, batchSize, fromKey);
  // Since runQuery jumps into a new process tick, there is no issue over this recursion exceeding stack size with large data-sets
  let rows = await runQuery(query.query, query.parameters);

  // Notify the caller that we've finished
  if (isEmpty(rows)) return;

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
    /**
     * Give the rows to the caller. Wrapping in a try / catch so if an error is thrown
     * (in the same processor tick) then we can still catch the error
     * and invoke the callback with it
     */
    onEach(rows, async (error_) => {
      if (error_) return error_;

      // Start the next iteration
      await _iterateAll(columnNames, columnFamily, keyColumnName, returnKeyColumn, batchSize, onEach, fromKey);
    });
  } catch (error) {
    log().error({ err: error }, 'Error invoking consumer onEach during iterateAll');
    throw new Error(JSON.stringify({ code: 500, msg: error.message }));
  }
}

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
  /**
   * Ensure the upsert CQL does not contain the row key in the SET portion by removing it. This is
   * set automatically by the "WHERE" clause with the row key
   */
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
 * @api private
 */
async function executeQuery(query, parameters) {
  parameters = parameters || [];

  /**
   * Check for null parameters that have been passed in. We have to intercept this
   * because otherwise the query will fail and an "All connections are unhealty"
   * error will start coming back for each Cassandra query
   */
  for (let p = 0; p < parameters.length; p++) {
    if (OaeUtil.isUnspecified(parameters[p])) {
      _logCustomError('Invalid cassandra query specified.', { query, parameters });
      throw new Error(JSON.stringify({ code: 400, msg: 'An incorrect query has been attempted' }));
    }
  }

  // Copy the parameters if they were specified so we can log on them if there is an error
  const logParameters = parameters ? parameters : null;

  try {
    const resultSet = await client.execute(query, parameters, { prepare: true });
    log().trace(
      {
        query,
        parameters: logParameters,
        rows: resultSet.rows
      },
      'Executed cassandra query'
    );
    return resultSet.rows;
  } catch (error) {
    log().error(_truncateLogParameters(error, query, logParameters), 'An error occurred executing a cassandra query');
    throw new Error(JSON.stringify({ code: 500, msg: 'An error occurred executing a query' }));
  }
}

/**
 * Describes the keyspace identified by 'keyspace'.
 *
 * @param  {String}     keyspace            The keyspace to describe
 * @api private
 */
// eslint-disable-next-line no-unused-vars
function _describeKeyspace(keyspace) {
  const query = `DESCRIBE KEYSPACE ${keyspace}`;
  try {
    return client.execute(query);
  } catch (error) {
    if (error.name !== 'NotFoundException') {
      log().error({ err: error }, 'Error while describing cassandra keyspace');
      throw new Error(JSON.stringify({ code: 500, msg: 'Error while describing cassandra keyspace' }));
    }
  }
}

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
