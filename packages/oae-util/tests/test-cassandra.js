/*
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the 'License'); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an 'AS IS'
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import { assert } from 'chai';
import { equals, of, is, forEach, map, head, keys, range } from 'ramda';
import * as OaeUtil from 'oae-util/lib/util.js';
import * as TestsUtil from 'oae-tests/lib/util.js';

import { logger } from 'oae-logger';
import {
  columnFamilyExists,
  createColumnFamily,
  dropColumnFamily,
  dropColumnFamilies,
  createKeyspace,
  runPagedQuery,
  runBatchQuery,
  createColumnFamilies,
  runQuery,
  iterateAll,
  constructUpsertCQL,
  keyspaceExists,
  dropKeyspace
} from '../lib/cassandra.js';

const isArray = is(Array);
const isObject = is(Object);

const cassandraLog = logger('oae-cassandra');

describe('Utilities', () => {
  describe('Cassandra', () => {
    /**
     * Test that will validate that keyspaces can be created, checked and dropped
     */
    it('verify keyspaces', async () => {
      // Create a key space
      const keyspace = TestsUtil.generateTestCassandraName();
      const created = await createKeyspace(keyspace);
      assert.ok(created);

      // Check that the keyspace exists
      let exists = await keyspaceExists(keyspace);
      assert.ok(exists);

      // Check that a non-existing keyspace doesn't exist
      const nonExistingKeyspace = TestsUtil.generateTestCassandraName();
      exists = await keyspaceExists(nonExistingKeyspace);
      assert.isNotOk(exists);

      // Drop the created keyspace
      const dropped = await dropKeyspace(keyspace);
      assert.ok(dropped);

      // Check that a non-existing keyspace can't be dropped
      try {
        await dropKeyspace(keyspace);
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(JSON.parse(error.message).code, 500);
      }
    });

    /**
     * Test that it is possible to create, check and drop column families.
     */
    it('verify create, verify and drop column family', async () => {
      // Create a column family
      const name = TestsUtil.generateTestCassandraName();
      let created = await createColumnFamily(name, `CREATE TABLE "${name}" ("keyId" text PRIMARY KEY, "value" text)`);
      assert.ok(created);

      // Try and create it again, ensuring nothing gets created
      created = await createColumnFamily(
        name,
        `CREATE TABLE "${name}" ("keyId" text PRIMARY KEY, "value" text) WITH COMPACT STORAGE`
      );
      assert.isNotOk(created);

      // Drop the table
      await dropColumnFamily(name);

      /**
       * Make sure it's gone by creating a new one in its place and see
       * if something was created
       */
      created = await createColumnFamily(
        name,
        `CREATE TABLE "${name}" ("keyId" text PRIMARY KEY, "value" text) WITH COMPACT STORAGE`
      );
      assert.ok(created);

      // Drop it again
      await dropColumnFamily(name);
    });

    /**
     * Test that it is possible to create, check and drop multiple columnfamilies at once.
     */
    it('verify multiple column families', async () => {
      const name1 = TestsUtil.generateTestCassandraName();
      const name2 = TestsUtil.generateTestCassandraName();

      await createColumnFamilies({
        name1: `CREATE TABLE "${name1}" ("keyId" text, "column" text, "value" text, PRIMARY KEY ("keyId", "column")) WITH COMPACT STORAGE`,
        name2: `CREATE TABLE "${name2}" ("keyId" text, "column" text, "value" text, PRIMARY KEY ("keyId", "column")) WITH COMPACT STORAGE`
      });

      // Ensure both column families exist
      let exists = await columnFamilyExists(name1);
      assert.ok(exists);

      exists = await columnFamilyExists(name2);
      assert.ok(exists);

      // Drop them
      await dropColumnFamilies([name1, name2]);

      // Ensure they no longer exist
      exists = await columnFamilyExists(name1);
      assert.isNotOk(exists);

      exists = await columnFamilyExists(name2);
      assert.isNotOk(exists);
    });

    /**
     * Test the runQuery function, making sure that null and undefined values
     * are handled appropriately
     */
    it('verify run query', async () => {
      // Create a CF first
      const created = await createColumnFamily(
        'testQuery',
        `CREATE TABLE "testQuery" ("keyId" text PRIMARY KEY, "c1" text, "c2" text)`
      );
      assert.ok(created);

      // Check if the CF exists
      const exists = await columnFamilyExists('testQuery');
      assert.ok(exists);

      // Try to run a simple insert
      await runQuery(`INSERT INTO "testQuery" ("keyId", "c1", "c2") VALUES (?, ?, ?)`, ['key1', 'value1', 'value2']);

      // Try to run an invalid insert
      try {
        await runQuery(`INSERT INTO "testQuery" ("keyId", "c1", "c2") VALUES (?, ?, ?)`, ['key2', 'value', null]);
      } catch (error) {
        assert.exists(error);
      }

      // Try to run a simple select
      const rows = await runQuery(`SELECT * FROM "testQuery" WHERE "keyId" = ?`, ['key1']);
      assert.lengthOf(rows, 1);
      assert.strictEqual(rows[0].get('keyId'), 'key1');

      // Try to run an invalid select
      try {
        await runQuery(`SELECT * FROM "testQuery" WHERE "keyId" = ?`, [null]);
      } catch (error) {
        assert.exists(error);
      }
    });

    /**
     * Test that verifies iterateAll on empty CF invokes callback only once
     */
    it('verify iterateAll on empty column family', async () => {
      const created = await createColumnFamily(
        'testIterateAllEmpty',
        'CREATE TABLE "testIterateAllEmpty" ("keyId" text PRIMARY KEY, "colOne" text, "colTwo" text)'
      );
      assert.ok(created);

      let numberInvoked = 0;

      // Verify the callback is only invoked once, and when it does it is marked complete, without an error
      await iterateAll(['colOne', 'colTwo'], 'testIterateAllEmpty', 'keyId', null, (rows) => {
        assert.isNotOk(rows, 'Expected no rows to be specified');
        assert.strictEqual(++numberInvoked, 1, 'Expected onEach to only be invoked once');
      });
    });

    /**
     * Test that verifies iterateAll will return an exception as an error
     * if one is thrown by the onEach
     */
    it('verify iterateAll on exception breaks out of iteration', async () => {
      const created = await createColumnFamily(
        'testIterateAllException',
        'CREATE TABLE "testIterateAllException" ("keyId" text PRIMARY KEY, "colOne" text, "colTwo" text)'
      );

      assert.ok(created);

      let invoked = false;
      const batch = [];
      batch.push(
        constructUpsertCQL('testIterateAllException', 'keyId', 'key1', {
          colOne: 'one',
          colTwo: 'two'
        })
      );
      await runBatchQuery(batch);

      try {
        await iterateAll(null, 'testIterateAllException', 'keyId', null, (rows) => {
          // Ensure we return only once, and then throw an error to ensure it gets caught
          assert.isNotOk(invoked);
          assert.ok(rows);

          invoked = true;

          // eslint-disable-next-line no-throw-literal
          throw { message: "I'm an annoying error!" };
        });
      } catch (error) {
        // Verify we got the error we threw from the onEach, and that we only invoked once
        assert.ok(error);
        assert.strictEqual(JSON.parse(error.message).code, 500);
        assert.strictEqual(JSON.parse(error.message).msg, "I'm an annoying error!");
        assert.ok(invoked);
      }
    });

    /**
     * Test that verifies iterateAll with no column names or specified column names
     */
    it('verify iterateAll column names', async () => {
      const created = await createColumnFamily(
        'testIterateAllAllColumns',
        'CREATE TABLE "testIterateAllAllColumns" ("keyId" text PRIMARY KEY, "colOne" text, "colTwo" text)'
      );
      assert.ok(created);

      await runBatchQuery(
        of(
          constructUpsertCQL('testIterateAllAllColumns', 'keyId', 'key1', {
            colOne: 'one',
            colTwo: 'two'
          })
        )
      );

      let numberInvoked = 0;

      /*!
       * Verifies that the onEach is invoked only once and that only one row is returned
       */
      let _onEach = function (rows) {
        assert.strictEqual(++numberInvoked, 1, 'Expected onEach to only be invoked once');
        assert.ok(rows, 'Expected there to be rows provided to the onEach');
        assert.strictEqual(rows.length, 1, 'Expected there to be exactly one row');

        // Ensure all columns have been fetched
        assert.strictEqual(rows[0].get('keyId'), 'key1', 'Invalid value for keyId');
        assert.strictEqual(rows[0].get('colOne'), 'one', 'Invalid value for colOne');
        assert.strictEqual(rows[0].get('colTwo'), 'two', 'Invalid value for colTwo');
      };

      /**
       * Verify the callback is only invoked once,
       * and when it does it is marked complete, without an error
       */
      await iterateAll(null, 'testIterateAllAllColumns', 'keyId', null, _onEach);
      numberInvoked = 0;

      /*!
       * Verifies that the onEach is invoked only once,
       * that only one row is returned and it only contains
       * the colOne column
       */
      _onEach = function (rows) {
        assert.strictEqual(++numberInvoked, 1, 'Expected onEach to only be invoked once');
        assert.ok(rows, 'Expected a rows object to be specified');
        assert.strictEqual(rows.length, 1, 'Expected there to be exactly one row');

        // Verify only colOne is set
        assert.isNotOk(rows[0].get('keyId'), 'Expected the keyId not to be fetched');
        assert.isNotOk(rows[0].get('colTwo'), 'expected no colTwo column to be fetched');
        assert.strictEqual(rows[0].get('colOne'), 'one', 'Invalid value for colOne');
      };

      // Iterate all again with just one column specified and verify only the one column returns

      try {
        await iterateAll(['colOne'], 'testIterateAllAllColumns', 'keyId', null, _onEach);
      } catch (error) {
        assert.isNotOk(error, JSON.stringify(error, null, 2));
      }
    });

    /**
     * Test that verifies exclusive paging in iterateAll
     */
    it('verify iterateAll paging', async () => {
      const created = await createColumnFamily(
        'testIterateAllPaging',
        'CREATE TABLE "testIterateAllPaging" ("keyId" text PRIMARY KEY, "colOne" text, "colTwo" text)'
      );
      assert.ok(created);

      const batch = [...Array.from({ length: 10 })].map((_eachQuery, counter) =>
        constructUpsertCQL('testIterateAllPaging', 'keyId', 'key' + counter, {
          colOne: 'colOne' + counter,
          colTwo: 'colTwo' + counter
        })
      );
      await runBatchQuery(batch);

      let numberInvoked = 0;
      let allRows = {};

      /*!
       * Verifies that we receive exactly one row at a time,
       * and aggregates them so we can inspect their
       * data when finished.
       */
      let _onEach = function (rows) {
        numberInvoked++;
        // Store the row so we can verify them all later
        assert.lengthOf(rows, 1, 'Expected to only get 1 row at a time');
        allRows[head(rows).get('keyId')] = head(rows);
      };

      // Verify paging all 10 items by batches of size 1
      try {
        await iterateAll(null, 'testIterateAllPaging', 'keyId', { batchSize: 1 }, _onEach);
        assert.strictEqual(numberInvoked, 10, 'Expected to have exactly 10 batches of data');
      } catch {
        assert.isNotOk(error__, JSON.stringify(error__, null, 4));
      }

      // Verify the contents of all the rows
      assert.lengthOf(keys(allRows), 10, 'Expected exactly 10 distinct rows');
      for (let i = 0; i < 10; i++) {
        const key = 'key' + i;
        assert.ok(allRows[key], 'Expected to get a row with key ' + key);
        assert.strictEqual(allRows[key].get('colOne'), 'colOne' + i, 'Invalid colOne value');
        assert.strictEqual(allRows[key].get('colTwo'), 'colTwo' + i, 'Invalid colTwo value');
      }

      // Verify paging of all 10 items by batches of size 5
      numberInvoked = 0;
      allRows = {};

      /*!
       * Verifies that the onEach is invoked with 5 rows at a time,
       * and aggregates them so we can
       * inspect their data when finished.
       */
      _onEach = function (rows) {
        numberInvoked++;
        // Record the rows so we can verify their contents at the end
        assert.lengthOf(rows, 5);
        for (let i = 0; i < 5; i++) {
          allRows[rows[i].get('keyId')] = rows[i];
        }
      };

      try {
        await iterateAll(null, 'testIterateAllPaging', 'keyId', { batchSize: 5 }, _onEach);
        assert.strictEqual(numberInvoked, 2, 'Expected the onEach to be invoked exactly 2 times');
      } catch {
        // assert.isNotOk(error__, JSON.stringify(error__, null, 4));
      }

      // Verify the contents of all the rows
      assert.lengthOf(keys(allRows), 10);
      for (let i = 0; i < 10; i++) {
        const key = 'key' + i;
        assert.ok(allRows[key]);
        assert.strictEqual(allRows[key].get('colOne'), 'colOne' + i);
        assert.strictEqual(allRows[key].get('colTwo'), 'colTwo' + i);
      }

      // Verify paging of all 10 items by batches of size 7
      numberInvoked = 0;
      allRows = {};

      const isOne = equals(1);
      const isTwo = equals(2);

      /*!
       * Verifies that the onEach is called once with 7 rows,
       * and then once with 3 rows, and aggregates
       * them so we can inspect their data when finished.
       */
      _onEach = function (rows) {
        numberInvoked++;
        assert.ok(rows);
        /**
         * The first batch should contain exactly 7 rows.
         * Record them to verify the data when done iterating.
         */
        if (isOne(numberInvoked)) {
          assert.lengthOf(rows, 7);
          for (let i = 0; i < 7; i++) {
            allRows[rows[i].get('keyId')] = rows[i];
          }

          /**
           * The second batch should contain exactly 3 rows.
           * Record them to verify the data when done iterating.
           */
        } else if (isTwo(numberInvoked)) {
          assert.lengthOf(rows, 3);
          for (let ii = 0; ii < 3; ii++) {
            allRows[rows[ii].get('keyId')] = rows[ii];
          }
        }
      };

      try {
        await iterateAll(null, 'testIterateAllPaging', 'keyId', { batchSize: 7 }, _onEach);
        assert.strictEqual(numberInvoked, 2, 'Expected the onEach callback to be invoked exactly twice');
      } catch (error) {
        assert.isNotOk(error, JSON.stringify(error, null, 4));
      }

      // Verify the contents of all the rows
      assert.lengthOf(keys(allRows), 10);
      for (let i = 0; i < 10; i++) {
        const key = 'key' + i;
        assert.ok(allRows[key]);
        assert.strictEqual(allRows[key].get('colOne'), 'colOne' + i);
        assert.strictEqual(allRows[key].get('colTwo'), 'colTwo' + i);
      }
    });

    /**
     * Test the runBatchQuery function, making sure that changes from both queries are persisted
     */
    it('verify run batch query', async () => {
      // Create a CF first
      const created = await createColumnFamily(
        'testBatchQuery',
        'CREATE TABLE "testBatchQuery" ("keyId" text PRIMARY KEY, "c1" text, "c2" text)'
      );

      assert.ok(created);

      // Check if the CF exists
      const exists = await columnFamilyExists('testBatchQuery');
      assert.ok(exists);

      // Run a batched query
      const queries = [
        {
          query: 'INSERT INTO "testBatchQuery" ("keyId", "c1", "c2") VALUES (?, ?, ?)',
          parameters: ['key1', 'value1', 'value2']
        },
        {
          query: 'INSERT INTO "testBatchQuery" ("keyId", "c1", "c2") VALUES (?, ?, ?)',
          parameters: ['key2', 'value3', 'value4']
        }
      ];
      await runBatchQuery(queries);

      // Verify all the rows are in the table
      const rows = await runQuery('SELECT * FROM "testBatchQuery" WHERE "keyId" IN ?', [['key1', 'key2']]);

      assert.ok(rows.length, 2);
      assert.lengthOf(rows[0].keys(), 3);
      assert.lengthOf(rows[0].values(), 3);
      assert.strictEqual(rows[0].get('c1'), 'value1');
      assert.strictEqual(rows[0].get('c2'), 'value2');

      assert.lengthOf(rows[1].keys(), 3);
      assert.lengthOf(rows[1].values(), 3);
      assert.strictEqual(rows[1].get('c1'), 'value3');
      assert.strictEqual(rows[1].get('c2'), 'value4');

      // Try running it without any queries
      await runBatchQuery([]);
    });

    /**
     * Test casting to a Boolean
     */
    it('verify casting to a Boolean', async () => {
      const created = await createColumnFamily(
        'testBooleans',
        'CREATE TABLE "testBooleans" ("keyId" text PRIMARY KEY, "testbool" text, "testnumbool" text, "teststring" text)'
      );

      assert.ok(created);
      await runQuery(
        'INSERT INTO "testBooleans" ("keyId", "testbool", "testnumbool", "teststring") VALUES (?, ?, ?, ?)',
        ['testkey', 'true', '0', 'notaboolean']
      );

      const rows = await runQuery(
        'SELECT "testbool", "testnumbool", "teststring" FROM "testBooleans" WHERE "keyId" = ?',
        ['testkey']
      );
      assert.strictEqual(typeof OaeUtil.castToBoolean(head(rows).get('testbool')), 'boolean');
      assert.strictEqual(typeof OaeUtil.castToBoolean(head(rows).get('testnumbool')), 'boolean');
      assert.strictEqual(typeof OaeUtil.castToBoolean(head(rows).get('teststring')), 'string');
    });

    /**
     * Test whether the constructUpsertCQL works as expected,
     * making sure that invalid parameters are handled appropriately
     */
    it('verify construct upsert', async () => {
      // Test an invalid call with no provided cf
      const query1 = constructUpsertCQL(null, 'testId', 'testValue', { key1: 'value1' });
      assert.isNotOk(query1);

      // Test an invalid call with no provided values
      const query2 = constructUpsertCQL('testCF', 'testId', 'testValue', {});
      assert.isNotOk(query2);

      // Test a valid update with one key-value pair
      const query3 = constructUpsertCQL('testCF', 'testId', 'testValue', {
        key1: 'value1'
      });
      assert.ok(query3);
      assert.strictEqual(query3.query, 'UPDATE "testCF" SET "key1" = ? WHERE "testId" = ?');
      assert.strictEqual(query3.parameters[0], 'value1');
      assert.strictEqual(query3.parameters[1], 'testValue');

      // Test a valid update with multiple key-value pairs
      const query5 = constructUpsertCQL('testCF', 'testId', 'testValue', {
        key1: 'value1',
        key2: 'value2',
        key3: 'value3'
      });
      assert.ok(query5);
      assert.strictEqual(query5.query.indexOf('UPDATE "testCF" SET '), 0);
      assert.include(query5.query, '"key1" = ?');
      assert.include(query5.query, '"key2" = ?');
      assert.include(query5.query, '"key3" = ?');
      assert.include(query5.query, ' WHERE "testId" = ?');
      assert.include(query5.parameters, 'value1');
      assert.include(query5.parameters, 'value2');
      assert.include(query5.parameters, 'value3');
      assert.strictEqual(query5.parameters[3], 'testValue');

      // Verify TTL is added to the query with proper syntax
      const query7 = constructUpsertCQL(
        'testCF',
        'testId',
        'testValue',
        { key1: 'value1', key2: 'value2', key3: 'value3' },
        500
      );
      assert.ok(query7);
      assert.strictEqual(query7.query.indexOf('UPDATE "testCF" USING TTL 500 SET '), 0);
      assert.ok(query7.query.includes('"key1" = ?'));
      assert.ok(query7.query.includes('"key2" = ?'));
      assert.ok(query7.query.includes('"key3" = ?'));
      assert.ok(query7.query.includes(' WHERE "testId" = ?'));
      assert.include(query7.parameters, 'value1');
      assert.include(query7.parameters, 'value2');
      assert.include(query7.parameters, 'value3');
      assert.strictEqual(query7.parameters[3], 'testValue');

      // Verify a JSON object and JSON array are stringified
      const query8 = constructUpsertCQL(
        'testCF',
        'testId',
        'testValue',
        { key1: { anobject: 'a value' }, key2: ['index0', 'index1'], key3: 'value3' },
        500
      );
      assert.ok(query8);
      assert.strictEqual(query8.query.indexOf('UPDATE "testCF" USING TTL 500 SET '), 0);
      assert.ok(query8.query.includes('"key1" = ?'));
      assert.ok(query8.query.includes('"key2" = ?'));
      assert.ok(query8.query.includes('"key3" = ?'));
      assert.ok(query8.query.includes(' WHERE "testId" = ?'));
      assert.include(query8.parameters, 'value3');
      assert.ok(query8.parameters[3], 'testValue');

      let hasObject = false;
      let hasArray = false;

      forEach((parameter) => {
        try {
          parameter = JSON.parse(parameter);
        } catch (error) {
          return error;
        }

        if (isArray(parameter)) {
          hasArray = true;
          assert.strictEqual(parameter[0], 'index0');
          assert.strictEqual(parameter[1], 'index1');
        } else if (isObject(parameter)) {
          hasObject = true;
          assert.strictEqual(parameter.anobject, 'a value');
        }
      }, query8.parameters);

      // Ensure we did have both the object and array in the parameters list
      assert.ok(hasObject);
      assert.ok(hasArray);
    });

    /**
     * Test that verifies the functionality of paging rows in a dynamic column family
     */
    it('verify paging rows of compact storage tables', async () => {
      // Set up column family and data used for paging
      await createColumnFamily(
        'VerifyPagedColumnQueryStartAndEnd',
        'CREATE TABLE "VerifyPagedColumnQueryStartAndEnd" ("keyId" text, "columnName" text, "value" text, PRIMARY KEY("keyId", "columnName")) WITH COMPACT STORAGE'
      );

      // Need to at least have values beyond 'k' to avoid we overlook 'keyId'
      const someLetters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'];
      const batch = map(
        (columnName) =>
          constructUpsertCQL('VerifyPagedColumnQueryStartAndEnd', ['keyId', 'columnName'], ['key', columnName], {
            value: '1'
          }),
        someLetters
      );

      await runBatchQuery(batch);

      // Verify inclusive end works with unbounded start (forward)
      let result = await runPagedQuery('VerifyPagedColumnQueryStartAndEnd', 'keyId', 'key', 'columnName', null, 8, {
        end: 'a'
      });
      let { rows, nextToken, startMatched } = result;

      assert.ok(rows);
      assert.strictEqual(startMatched, false);

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].get('columnName'), 'a');

      /**
       *  Verify inclusive end works with bounded start,
       * multiple results full page (forward)
       */
      result = await runPagedQuery('VerifyPagedColumnQueryStartAndEnd', 'keyId', 'key', 'columnName', null, 8, {
        end: 'j'
      });
      rows = result.rows;
      nextToken = result.nextToken;
      startMatched = result.startMatched;

      assert.ok(rows);
      assert.strictEqual(startMatched, false);

      assert.strictEqual(rows.length, 8);
      assert.strictEqual(rows[0].get('columnName'), 'a');
      assert.strictEqual(rows[1].get('columnName'), 'b');
      assert.strictEqual(rows[2].get('columnName'), 'c');
      assert.strictEqual(rows[3].get('columnName'), 'd');
      assert.strictEqual(rows[4].get('columnName'), 'e');
      assert.strictEqual(rows[5].get('columnName'), 'f');
      assert.strictEqual(rows[6].get('columnName'), 'g');
      assert.strictEqual(rows[7].get('columnName'), 'h');
      assert.strictEqual(nextToken, 'h');

      // Verify inclusive end works with unbounded start (reversed)
      result = await runPagedQuery('VerifyPagedColumnQueryStartAndEnd', 'keyId', 'key', 'columnName', null, 8, {
        reversed: true,
        end: 'm'
      });
      rows = result.rows;
      nextToken = result.nextToken;
      startMatched = result.startMatched;

      assert.ok(rows);
      assert.strictEqual(startMatched, false);

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].get('columnName'), 'm');

      /**
       * Verify inclusive end works with bounded start,
       * multiple results full page (forward)
       */
      result = await runPagedQuery('VerifyPagedColumnQueryStartAndEnd', 'keyId', 'key', 'columnName', null, 8, {
        reversed: true,
        end: 'c'
      });
      rows = result.rows;
      nextToken = result.nextToken;
      startMatched = result.startMatched;

      assert.ok(rows);
      assert.strictEqual(startMatched, false);

      assert.strictEqual(rows.length, 8);
      assert.strictEqual(rows[0].get('columnName'), 'm');
      assert.strictEqual(rows[1].get('columnName'), 'l');
      assert.strictEqual(rows[2].get('columnName'), 'k');
      assert.strictEqual(rows[3].get('columnName'), 'j');
      assert.strictEqual(rows[4].get('columnName'), 'i');
      assert.strictEqual(rows[5].get('columnName'), 'h');
      assert.strictEqual(rows[6].get('columnName'), 'g');
      assert.strictEqual(rows[7].get('columnName'), 'f');
      assert.strictEqual(nextToken, 'f');
    });

    /**
     * Test that ensures the CQL3 bug: https://issues.apache.org/jira/browse/CASSANDRA-6330 is fixed
     */
    it('verify a strict upper bound on range query does not result in one less item than requested with limit', async () => {
      await createColumnFamily(
        'VerifyCassandra6330',
        'CREATE TABLE "VerifyCassandra6330" ("keyId" text, "column" text, "value" text, PRIMARY KEY ("keyId", "column")) WITH COMPACT STORAGE'
      );

      // Need to at least have values beyond 'k' to avoid we overlook 'keyId'
      const batch = map(
        (columnName) =>
          constructUpsertCQL('VerifyCassandra6330', ['keyId', 'column'], ['key', columnName], {
            value: '1'
          }),
        ['a', 'b', 'c', 'd', 'e']
      );

      await runBatchQuery(batch);

      const rows = await runQuery(
        'SELECT "column" FROM "VerifyCassandra6330" WHERE "keyId" = ? AND "column" < ? ORDER BY "column" DESC LIMIT 2',
        ['key', 'c']
      );

      /**
       * We asked for 2 items, and there were 2 to fetch (a and b), we get both.
       * If the bug were still in effect we'd get 1 as
       */
      // described in https://issues.apache.org/jira/browse/CASSANDRA-6330
      assert.lengthOf(rows, 2);
    });

    /**
     * Test that verifies that no extra rows are returned on queries that use LIMIT,
     * which is a bug in some versions of Cassandra 2.x
     *
     * @see https://issues.apache.org/jira/browse/CASSANDRA-7052
     */
    it('verify a strict upper bound on range query results in one more item than requested with limit', async () => {
      await createColumnFamily(
        'VerifyCassandra7052',
        'CREATE TABLE "VerifyCassandra7052" ("keyId" text, "column" text, "value" text, PRIMARY KEY ("keyId", "column")) WITH COMPACT STORAGE'
      );

      const batch = map(
        (columnName) =>
          constructUpsertCQL('VerifyCassandra7052', ['keyId', 'column'], ['key', columnName], {
            value: '1'
          }),
        ['a', 'b', 'c', 'd', 'e']
      );

      await runBatchQuery(batch);

      const rows = await runQuery(
        'SELECT "column" FROM "VerifyCassandra7052" WHERE "keyId" = ? AND "column" <= ? LIMIT 2',
        ['key', 'e']
      );

      // We asked for 2 items, if the bug is present we get 3
      assert.lengthOf(rows, 2);
    });

    /**
     * Test that verifies the paged column query handles multi-byte characters properly.
     * This is a regression test for
     * https://github.com/oaeproject/Hilary/issues/443
     */
    it('verify multi-byte character in paged column query', async () => {
      const created = await createColumnFamily(
        'VerifyMultiBytePagedColumnQuery',
        'CREATE TABLE "VerifyMultiBytePagedColumnQuery" ("keyId" text, "column1" text, "value" text, PRIMARY KEY ("keyId", "column1")) WITH COMPACT STORAGE'
      );

      assert.ok(created);

      const stringWithMultiByte = 'Foo O’bar';

      await runQuery('INSERT INTO "VerifyMultiBytePagedColumnQuery" ("keyId", "column1", "value") VALUES (?, ?, ?)', [
        'key1',
        stringWithMultiByte,
        '1'
      ]);

      const { rows, nextToken, startMatched } = await runPagedQuery(
        'VerifyMultiBytePagedColumnQuery',
        'keyId',
        'key1',
        'column1',
        null,
        10,
        null
      );

      assert.lengthOf(rows, 1);
      assert.isNotOk(nextToken);
      assert.isNotOk(startMatched);
      assert.strictEqual(rows[0].get('column1'), stringWithMultiByte);
    });

    /**
     * Test that verifies truncation of query logging
     */
    it('verify truncation of cassandra query log entries', async () => {
      /**
       * Create a large erroneous query whose query and parameters should
       * be truncated
       */
      const invalidQuery = 'SELECT "LLLOOOOLLLLL" FROM "SOMETHING ELSE"';
      const invalidQueryLongerThan300 = invalidQuery + range(0, 300).join('');

      const longQueryMoreThan10 = invalidQueryLongerThan300 + '? ? ? ? ? ? ? ? ? ? ? ?';
      const longParametersMoreThan10 = [
        'short enough',
        // Entries longer than 80
        range(0, 100).join(''),
        range(1, 100).join(''),
        range(2, 100).join(''),
        range(3, 100).join(''),
        range(4, 100).join(''),
        range(5, 100).join(''),
        range(6, 100).join(''),
        range(7, 100).join(''),
        range(8, 100).join(''),
        range(9, 100).join(''),
        range(10, 100).join('')
      ];

      // Run the invalid query then hook into the error log to continue the test
      try {
        await runQuery(longQueryMoreThan10, longParametersMoreThan10);
      } catch (error) {
        assert.ok(error);
        assert.strictEqual(JSON.parse(error.message).code, 500);
        assert.strictEqual(JSON.parse(error.message).msg, 'An error occurred executing a query');
      }

      // Hook into oae-cassandra's logger error function to ensure we get the truncated data we want
      const cassandraLoggerError = cassandraLog().error;
      cassandraLog().error = async function (data, message) {
        try {
          assert.strictEqual(message, 'An error occurred executing a cassandra query');
          assert.strictEqual(data.err.name, 'ResponseError');
          assert.strictEqual(
            data.query,
            'SELECT "LLLOOOOLLLLL" FROM "SOMETHING ELSE"01234567891011121314151617181920212223242526272829303132333435363738394041424344454647484950515253545556575859606162636465666768697071727374757677787980818283848586878889909192939495969798991001011021031041051061071081091101111121131141151161171181191201211 (and 556 more)'
          );
          assert.strictEqual(data.parameters.length, 10);
          assert.strictEqual(data.parameters[0], 'short enough');
          assert.strictEqual(
            data.parameters[1],
            '01234567891011121314151617181920212223242526272829303132333435363738394041424344 (and 110 more)'
          );
          assert.strictEqual(
            data.parameters[2],
            '12345678910111213141516171819202122232425262728293031323334353637383940414243444 (and 109 more)'
          );
          assert.strictEqual(
            data.parameters[3],
            '23456789101112131415161718192021222324252627282930313233343536373839404142434445 (and 108 more)'
          );
          assert.strictEqual(
            data.parameters[4],
            '34567891011121314151617181920212223242526272829303132333435363738394041424344454 (and 107 more)'
          );
          assert.strictEqual(
            data.parameters[5],
            '45678910111213141516171819202122232425262728293031323334353637383940414243444546 (and 106 more)'
          );
          assert.strictEqual(
            data.parameters[6],
            '56789101112131415161718192021222324252627282930313233343536373839404142434445464 (and 105 more)'
          );
          assert.strictEqual(
            data.parameters[7],
            '67891011121314151617181920212223242526272829303132333435363738394041424344454647 (and 104 more)'
          );
          assert.strictEqual(
            data.parameters[8],
            '78910111213141516171819202122232425262728293031323334353637383940414243444546474 (and 103 more)'
          );
          assert.strictEqual(
            data.parameters[9],
            '89101112131415161718192021222324252627282930313233343536373839404142434445464748 (and 102 more)'
          );
        } catch (error) {
          cassandraLog().error = cassandraLoggerError;
          throw error;
        }

        /**
         * Create a failing query with no parameters specified, then
         * hook into the error logger a second time to verify the new
         * log information
         */
        try {
          await runQuery(invalidQueryLongerThan300, null);
        } catch (error) {
          assert.ok(error);
          assert.strictEqual(JSON.parse(error.message).code, 500);
          assert.strictEqual(JSON.parse(error.message).msg, 'An error occurred executing a query');
        }

        /**
         * Hook into cassandra's error log to ensure that the
         * information is truncated as expected
         */
        cassandraLog().error = function (data, message) {
          try {
            assert.strictEqual(message, 'An error occurred executing a cassandra query');
            assert.strictEqual(data.err.name, 'ResponseError');
            assert.strictEqual(
              data.query,
              'SELECT "LLLOOOOLLLLL" FROM "SOMETHING ELSE"01234567891011121314151617181920212223242526272829303132333435363738394041424344454647484950515253545556575859606162636465666768697071727374757677787980818283848586878889909192939495969798991001011021031041051061071081091101111121131141151161171181191201211 (and 533 more)'
            );
            assert.strictEqual(data.parameters.length, 0);
          } catch (error) {
            cassandraLog().error = cassandraLoggerError;
            throw error;
          }

          cassandraLog().error = cassandraLoggerError;
        };
      };
    });
  });
});
