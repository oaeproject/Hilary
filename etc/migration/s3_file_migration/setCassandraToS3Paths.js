/*!
 * Copyright 2017 Apereo Foundation (AF) Licensed under the
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

/*
 * Map user accounts created with Shibboleth to the earlier ones
 * created with Google auth - Shibboleth EPPN should match email account.
 */

const _ = require('underscore');
const async = require('async');

const Cassandra = require('oae-util/lib/cassandra');
const log = require('oae-logger').logger('oae-script-main');

let csvStream = {};
let errors = 0;

let storageType = 'amazons3';

// All the tables and columns that hold storage type in Cassandra
const storageTypeTables = [
    {'name': 'Content', 'primaryKey': 'contentId', 'columns': 'previews'},
    {'name': 'Folders', 'primaryKey': 'id', 'columns': 'previews'},
    {'name': 'PreviewItems', 'primaryKey': ['revisionId', 'name'], 'columns': 'value'},
    {'name': 'Config', 'primaryKey': ['tenantAlias', 'configKey'], 'columns': 'value'},
    {'name': 'Revisions', 'primaryKey': 'revisionId', 'columns': ['previews', 'largeUri', 'mediumUri', 'smallUri', 'thumbnailUri', 'wideUri', 'uri']},
    {'name': 'Principals', 'primaryKey': 'principalId', 'columns': ['largePictureUri', 'mediumPictureUri', 'smallPictureUri']}
];

/**
 * Write errors to a CSV file
 *
 * @param  {String}     table                   The table in which the error occurred
 * @param  {String}     column                  The column in which the error occurred
 * @param  {String}     value                   The value for which the error occurred
 * @param  {String}     message                 A short message detailing the issue
 * @api private
 */
function _writeErrorRow(table, column, value, message) {
    csvStream.write({
        'table': table,
        'column': column,
        'value': value,
        'message': message
    });
    errors++;
}

/**
 * Migrate Cassandra column families to new storage type
 *
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.errorCount     Whether there were errors in the migration
 */
const doMigration = module.exports.doMigration = function(stream, type, callback) {
    csvStream = stream;
    storageType = type;
    _updateStorageTypeInCassandra(storageTypeTables, function(err) {
        if (err) {
            log().error({'err':err}, 'Encountered error when updating records to new storage type in Cassandra');
            return callback(err);
        }

        return callback(null, errors);
    });
};

/**
 * Get all the columns that contain reference to storage type in Cassandra and update them
 *
 * @param  {Object}     tables                  Object containing column families and columns to be updated
 * @param  {Function}   callback                Invoked when all columns have been updated
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
const _updateStorageTypeInCassandra = function(tables, callback) {
    async.each(tables, function(table, done) {
        log().info(`Fetching column family ${table.name}...`);
        _fetchValueFromCassandra(table.name, function(err, rows) {
            if (err) {
                done(err);
            } else if (rows) {
                log().info(`Fetched ${rows.length} values from ${table.name}`);
                _updateColumnsInCassandra(table.primaryKey, table.name, table.columns, rows, done);
            }
        });
    }, callback);
};

/**
 * Fetch all the rows from a particular table in Cassandra
 *
 * @param  {Object}     table                   The column family for which rows should be fetched
 * @param  {Function}   callback                Invoked when rows have been fetched
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
const _fetchValueFromCassandra = function(table, callback) {
    Cassandra.runAutoPagedQuery(`SELECT * FROM "${table}"`, null, function(err, rows) {
        if (err) {
            log().error({'err': err}, `Failed to fetch records from Cassandra for ${table}`);
            callback(err);
        }
        return callback(null, rows);
    });
};

/**
 * Update all the rows with the new storage type in Cassandra
 *
 * @param  {String}     primaryKey              The primary key column for this table
 * @param  {String}     table                   The table to be updated
 * @param  {String}     columns                 The column(s) with values that need updating
 * @param  {String}     rows                    The rows that should be updated with the new storage type
 * @param  {Function}   callback                Invoked when rows have been fetched
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
const _updateColumnsInCassandra = function(primaryKey, table, columns, rows, callback) {
     async.each(rows, function(row, done) {
        let changes = false;
        let values = [];
        let query = `UPDATE "${table}" SET `;
        _.each(columns, function(column, i) {
            let value = _replaceLocalWithAmazonS3(row[column]);
            if (value && value !== row[column]) {
                changes = true;
                values.push(value);
                query = i === columns.length - 1 ? query + `"${column}" = ? ` : query + `"${column}" = ?, `;
            }
        });
        query = _.isArray(primaryKey) ? query + `WHERE "${primaryKey[0]}" = '${row[primaryKey[0]]}' AND "${primaryKey[1]}" = '${row[primaryKey[1]]}'` : query + `WHERE "${primaryKey}" = '${row[primaryKey]}'`;
        if (changes) {
            Cassandra.runQuery(query, values, function(err, results) {
                if (err) {
                    log().error({'err': err}, 'Failed to update storage type in Cassandra');
                    _writeErrorRow(table, columns, row, 'Failed to update storage type in Cassandra for this row');
                }
                log().info(`Updated ${table}, ${columns}`);
                done();
            });
        }
        done();
    }, callback);
};

/**
 * Replace all instances of `local` with `amazons3` or vice versa
 *
 * @param  {String}     toReplace               The value that should be replaced
 * @api private
 */
const _replaceLocalWithAmazonS3 = function(toReplace) {
    if (toReplace) {
        toReplace = storageType === 'amazons3' ? toReplace.replace(/local/g, storageType) : toReplace.replace(/amazons3/g, storageType);
    }
    return toReplace;
};
