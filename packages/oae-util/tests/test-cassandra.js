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

const assert = require('assert');
const _ = require('underscore');

const Cassandra = require('oae-util/lib/cassandra');
const OaeUtil = require('oae-util/lib/util');
const TestsUtil = require('oae-tests/lib/util');

const cassandraLog = require('oae-logger').logger('oae-cassandra');

describe('Utilities', () => {
  describe('Cassandra', () => {
    /**
     * Test that will validate that keyspaces can be created, checked and dropped
     */
    it('verify keyspaces', callback => {
      // Create a key space
      const keyspace = TestsUtil.generateTestCassandraName();
      Cassandra.createKeyspace(keyspace, (err, created) => {
        assert.ok(!err);
        assert.ok(created);

        // Check that the keyspace exists
        Cassandra.keyspaceExists(keyspace, (err, exists) => {
          assert.ok(!err);
          assert.ok(exists);

          // Check that a non-existing keyspace doesn't exist
          const nonExistingKeyspace = TestsUtil.generateTestCassandraName();
          Cassandra.keyspaceExists(nonExistingKeyspace, (err, exists) => {
            assert.ok(!err);
            assert.ok(!exists);

            // Drop the created keyspace
            Cassandra.dropKeyspace(keyspace, (err, dropped) => {
              assert.ok(!err);
              assert.ok(dropped);

              // Check that a non-existing keyspace can't be dropped
              Cassandra.dropKeyspace(keyspace, (err, dropped) => {
                assert.ok(err);
                callback();
              });
            });
          });
        });
      });
    });

    /**
     * Test that it is possible to create, check and drop column families.
     */
    it('verify create, verify and drop column family', callback => {
      // Create a column family
      const name = TestsUtil.generateTestCassandraName();
      Cassandra.createColumnFamily(
        name,
        `CREATE TABLE "${name}" ("keyId" text PRIMARY KEY, "value" text)`,
        (err, created) => {
          assert.ok(!err);
          assert.ok(created);

          // Try and create it again, ensuring nothing gets created
          Cassandra.createColumnFamily(
            name,
            `CREATE TABLE "${name}" ("keyId" text PRIMARY KEY, "value" text) WITH COMPACT STORAGE`,
            (err, created) => {
              assert.ok(!err);
              assert.ok(!created);

              // Drop the table
              Cassandra.dropColumnFamily(name, err => {
                assert.ok(!err);

                // Make sure it's gone by creating a new one in its place and see if something was created
                Cassandra.createColumnFamily(
                  name,
                  `CREATE TABLE "${name}" ("keyId" text PRIMARY KEY, "value" text) WITH COMPACT STORAGE`,
                  (err, created) => {
                    assert.ok(!err);
                    assert.ok(created);

                    // Drop it again
                    Cassandra.dropColumnFamily(name, err => {
                      assert.ok(!err);
                      return callback();
                    });
                  }
                );
              });
            }
          );
        }
      );
    });

    /**
     * Test that it is possible to create, check and drop multiple columnfamilies at once.
     */
    it('verify multiple column families', callback => {
      const name1 = TestsUtil.generateTestCassandraName();
      const name2 = TestsUtil.generateTestCassandraName();

      Cassandra.createColumnFamilies(
        {
          name1: `CREATE TABLE "${name1}" ("keyId" text, "column" text, "value" text, PRIMARY KEY ("keyId", "column")) WITH COMPACT STORAGE`,
          name2: `CREATE TABLE "${name2}" ("keyId" text, "column" text, "value" text, PRIMARY KEY ("keyId", "column")) WITH COMPACT STORAGE`
        },
        err => {
          assert.ok(!err);

          // Ensure both column families exist
          Cassandra.columnFamilyExists(name1, (err, exists) => {
            assert.ok(!err);
            assert.ok(exists);

            Cassandra.columnFamilyExists(name2, (err, exists) => {
              assert.ok(!err);
              assert.ok(exists);

              // Drop them
              Cassandra.dropColumnFamilies([name1, name2], err => {
                assert.ok(!err);

                // Ensure they no longer exist
                Cassandra.columnFamilyExists(name1, (err, exists) => {
                  assert.ok(!err);
                  assert.ok(!exists);

                  Cassandra.columnFamilyExists(name2, (err, exists) => {
                    assert.ok(!err);
                    assert.ok(!exists);
                    callback();
                  });
                });
              });
            });
          });
        }
      );
    });

    /**
     * Test the runQuery function, making sure that null and undefined values are handled appropriately
     */
    it('verify run query', callback => {
      // Create a CF first
      Cassandra.createColumnFamily(
        'testQuery',
        `CREATE TABLE "testQuery" ("keyId" text PRIMARY KEY, "c1" text, "c2" text)`,
        (err, created) => {
          assert.ok(!err);
          assert.ok(created);
          // Check if the CF exists
          Cassandra.columnFamilyExists('testQuery', (err, exists) => {
            assert.ok(!err);
            assert.ok(exists);
            // Try to run a simple insert
            Cassandra.runQuery(
              `INSERT INTO "testQuery" ("keyId", "c1", "c2") VALUES (?, ?, ?)`,
              ['key1', 'value1', 'value2'],
              err => {
                assert.ok(!err);
                // Try to run an invalid insert
                Cassandra.runQuery(
                  `INSERT INTO "testQuery" ("keyId", "c1", "c2") VALUES (?, ?, ?)`,
                  ['key2', 'value', null],
                  err => {
                    assert.ok(err);
                    // Try to run a simple select
                    Cassandra.runQuery(
                      `SELECT * FROM "testQuery" WHERE "keyId" = ?`,
                      ['key1'],
                      (err, rows) => {
                        assert.ok(!err);
                        assert.strictEqual(rows.length, 1);
                        assert.strictEqual(rows[0].get('keyId'), 'key1');
                        // Try to run an invalid select
                        Cassandra.runQuery(
                          `SELECT * FROM "testQuery" WHERE "keyId" = ?`,
                          [null],
                          (err, rows) => {
                            assert.ok(err);
                            callback();
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          });
        }
      );
    });

    /**
     * Test that verifies iterateAll on empty CF invokes callback only once
     */
    it('verify iterateAll on empty column family', callback => {
      Cassandra.createColumnFamily(
        'testIterateAllEmpty',
        'CREATE TABLE "testIterateAllEmpty" ("keyId" text PRIMARY KEY, "colOne" text, "colTwo" text)',
        (err, created) => {
          assert.ok(!err);
          assert.ok(created);

          let numInvoked = 0;

          // Verify the callback is only invoked once, and when it does it is marked complete, without an error
          Cassandra.iterateAll(
            ['colOne', 'colTwo'],
            'testIterateAllEmpty',
            'keyId',
            null,
            (rows, done) => {
              assert.ok(!err, 'Did not expect an error');
              assert.ok(!rows, 'Expected no rows to be specified');
              assert.strictEqual(++numInvoked, 1, 'Expected onEach to only be invoked once');
              done();
            },
            err => {
              assert.ok(!err);
              callback();
            }
          );
        }
      );
    });

    /**
     * Test that verifies iterateAll will return an exception as an error if one is thrown by the onEach
     */
    it('verify iterateAll on exception breaks out of iteration', callback => {
      Cassandra.createColumnFamily(
        'testIterateAllException',
        'CREATE TABLE "testIterateAllException" ("keyId" text PRIMARY KEY, "colOne" text, "colTwo" text)',
        (err, created) => {
          assert.ok(!err);
          assert.ok(created);

          let invoked = false;
          const batch = [];
          batch.push(
            Cassandra.constructUpsertCQL('testIterateAllException', 'keyId', 'key1', {
              colOne: 'one',
              colTwo: 'two'
            })
          );
          Cassandra.runBatchQuery(batch, err => {
            assert.ok(!err);

            Cassandra.iterateAll(
              null,
              'testIterateAllException',
              'keyId',
              null,
              (rows, done) => {
                // Ensure we return only once, and then throw an error to ensure it gets caught
                assert.ok(!invoked);
                assert.ok(rows);

                invoked = true;

                // eslint-disable-next-line no-throw-literal
                throw { message: "I'm an annoying error!" };
              },
              err => {
                // Verify we got the error we threw from the onEach, and that we only invoked once
                assert.ok(err);
                assert.strictEqual(err.code, 500);
                assert.strictEqual(err.msg, "I'm an annoying error!");
                assert.ok(invoked);
                callback();
              }
            );
          });
        }
      );
    });

    /**
     * Test that verifies iterateAll with no column names or specified column names
     */
    it('verify iterateAll column names', callback => {
      Cassandra.createColumnFamily(
        'testIterateAllAllColumns',
        'CREATE TABLE "testIterateAllAllColumns" ("keyId" text PRIMARY KEY, "colOne" text, "colTwo" text)',
        (err, created) => {
          assert.ok(!err);
          assert.ok(created);

          const batch = [];
          batch.push(
            Cassandra.constructUpsertCQL('testIterateAllAllColumns', 'keyId', 'key1', {
              colOne: 'one',
              colTwo: 'two'
            })
          );
          Cassandra.runBatchQuery(batch, err => {
            assert.ok(!err);

            let numInvoked = 0;

            /*!
                     * Verifies that the onEach is invoked only once and that only one row is returned
                     */
            const _onEach = function(rows, done) {
              assert.strictEqual(++numInvoked, 1, 'Expected onEach to only be invoked once');
              assert.ok(rows, 'Expected there to be rows provided to the onEach');
              assert.strictEqual(rows.length, 1, 'Expected there to be exactly one row');

              // Ensure all columns have been fetched
              assert.strictEqual(rows[0].get('keyId'), 'key1', 'Invalid value for keyId');
              assert.strictEqual(rows[0].get('colOne'), 'one', 'Invalid value for colOne');
              assert.strictEqual(rows[0].get('colTwo'), 'two', 'Invalid value for colTwo');

              done();
            };

            // Verify the callback is only invoked once, and when it does it is marked complete, without an error
            Cassandra.iterateAll(null, 'testIterateAllAllColumns', 'keyId', null, _onEach, err => {
              assert.ok(!err);

              numInvoked = 0;

              /*!
                         * Verifies that the onEach is invoked only once, that only one row is returned and it only contains
                         * the colOne column
                         */
              const _onEach = function(rows, done) {
                assert.strictEqual(++numInvoked, 1, 'Expected onEach to only be invoked once');
                assert.ok(rows, 'Expected a rows object to be specified');
                assert.strictEqual(rows.length, 1, 'Expected there to be exactly one row');

                // Verify only colOne is set
                assert.ok(!rows[0].get('keyId'), 'Expected the keyId not to be fetched');
                assert.ok(!rows[0].get('colTwo'), 'expected no colTwo column to be fetched');
                assert.strictEqual(rows[0].get('colOne'), 'one', 'Invalid value for colOne');

                done();
              };

              // Iterate all again with just one column specified and verify only the one column returns
              Cassandra.iterateAll(
                ['colOne'],
                'testIterateAllAllColumns',
                'keyId',
                null,
                _onEach,
                err => {
                  assert.ok(!err, JSON.stringify(err, null, 2));
                  return callback();
                }
              );
            });
          });
        }
      );
    });

    /**
     * Test that verifies exclusive paging in iterateAll
     */
    it('verify iterateAll paging', callback => {
      Cassandra.createColumnFamily(
        'testIterateAllPaging',
        'CREATE TABLE "testIterateAllPaging" ("keyId" text PRIMARY KEY, "colOne" text, "colTwo" text)',
        (err, created) => {
          assert.ok(!err);
          assert.ok(created);

          // Create 10 rows to page through
          const batch = [];
          for (let i = 0; i < 10; i++) {
            batch.push(
              Cassandra.constructUpsertCQL('testIterateAllPaging', 'keyId', 'key' + i, {
                colOne: 'colOne' + i,
                colTwo: 'colTwo' + i
              })
            );
          }

          Cassandra.runBatchQuery(batch, err => {
            assert.ok(!err);

            let numInvoked = 0;
            let allRows = {};

            /*!
                     * Verifies that we receive exactly one row at a time, and aggregates them so we can inspect their
                     * data when finished.
                     */
            const _onEach = function(rows, done) {
              numInvoked++;
              // Store the row so we can verify them all later
              assert.strictEqual(rows.length, 1, 'Expected to only get 1 row at a time');
              allRows[rows[0].get('keyId')] = rows[0];

              done();
            };

            // Verify paging all 10 items by batches of size 1
            Cassandra.iterateAll(
              null,
              'testIterateAllPaging',
              'keyId',
              { batchSize: 1 },
              _onEach,
              err => {
                assert.ok(!err, JSON.stringify(err, null, 4));
                assert.strictEqual(numInvoked, 10, 'Expected to have exactly 10 batches of data');

                // Verify the contents of all the rows
                assert.strictEqual(_.keys(allRows).length, 10, 'Expected exactly 10 distinct rows');
                for (let i = 0; i < 10; i++) {
                  const key = 'key' + i;
                  assert.ok(allRows[key], 'Expected to get a row with key ' + key);
                  assert.strictEqual(
                    allRows[key].get('colOne'),
                    'colOne' + i,
                    'Invalid colOne value'
                  );
                  assert.strictEqual(
                    allRows[key].get('colTwo'),
                    'colTwo' + i,
                    'Invalid colTwo value'
                  );
                }

                // Verify paging of all 10 items by batches of size 5
                numInvoked = 0;
                allRows = {};

                /*!
                         * Verifies that the onEach is invoked with 5 rows at a time, and aggregates them so we can
                         * inspect their data when finished.
                         */
                const _onEach = function(rows, done) {
                  numInvoked++;
                  // Record the rows so we can verify their contents at the end
                  assert.strictEqual(rows.length, 5);
                  for (let i = 0; i < 5; i++) {
                    allRows[rows[i].get('keyId')] = rows[i];
                  }

                  done();
                };

                Cassandra.iterateAll(
                  null,
                  'testIterateAllPaging',
                  'keyId',
                  { batchSize: 5 },
                  _onEach,
                  err => {
                    assert.ok(!err, JSON.stringify(err, null, 4));
                    assert.strictEqual(
                      numInvoked,
                      2,
                      'Expected the onEach to be invoked exactly 2 times'
                    );

                    // Verify the contents of all the rows
                    assert.strictEqual(_.keys(allRows).length, 10);
                    for (let i = 0; i < 10; i++) {
                      const key = 'key' + i;
                      assert.ok(allRows[key]);
                      assert.strictEqual(allRows[key].get('colOne'), 'colOne' + i);
                      assert.strictEqual(allRows[key].get('colTwo'), 'colTwo' + i);
                    }

                    // Verify paging of all 10 items by batches of size 7
                    numInvoked = 0;
                    allRows = {};

                    /*!
                             * Verifies that the onEach is called once with 7 rows, and then once with 3 rows, and aggregates
                             * them so we can inspect their data when finished.
                             */
                    const _onEach = function(rows, done) {
                      numInvoked++;
                      if (numInvoked === 1) {
                        assert.ok(rows);

                        // The first batch should contain exactly 7 rows. Record them to verify the data when done iterating.
                        assert.strictEqual(rows.length, 7);
                        for (let i = 0; i < 7; i++) {
                          allRows[rows[i].get('keyId')] = rows[i];
                        }
                      } else if (numInvoked === 2) {
                        assert.ok(rows);

                        // The second batch should contain exactly 3 rows. Record them to verify the data when done iterating.
                        assert.strictEqual(rows.length, 3);
                        for (let ii = 0; ii < 3; ii++) {
                          allRows[rows[ii].get('keyId')] = rows[ii];
                        }
                      }

                      done();
                    };

                    Cassandra.iterateAll(
                      null,
                      'testIterateAllPaging',
                      'keyId',
                      { batchSize: 7 },
                      _onEach,
                      err => {
                        assert.ok(!err, JSON.stringify(err, null, 4));
                        assert.strictEqual(
                          numInvoked,
                          2,
                          'Expected the onEach callback to be invoked exactly twice'
                        );

                        // Verify the contents of all the rows
                        assert.strictEqual(_.keys(allRows).length, 10);
                        for (let i = 0; i < 10; i++) {
                          const key = 'key' + i;
                          assert.ok(allRows[key]);
                          assert.strictEqual(allRows[key].get('colOne'), 'colOne' + i);
                          assert.strictEqual(allRows[key].get('colTwo'), 'colTwo' + i);
                        }

                        // Finally complete
                        return callback();
                      }
                    );
                  }
                );
              }
            );
          });
        }
      );
    });

    /**
     * Test the runBatchQuery function, making sure that changes from both queries are persisted
     */
    it('verify run batch query', callback => {
      // Create a CF first
      Cassandra.createColumnFamily(
        'testBatchQuery',
        'CREATE TABLE "testBatchQuery" ("keyId" text PRIMARY KEY, "c1" text, "c2" text)',
        (err, created) => {
          assert.ok(!err);
          assert.ok(created);

          // Check if the CF exists
          Cassandra.columnFamilyExists('testBatchQuery', (err, exists) => {
            assert.ok(!err);
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
            Cassandra.runBatchQuery(queries, err => {
              assert.ok(!err);

              // Verify all the rows are in the table
              Cassandra.runQuery(
                'SELECT * FROM "testBatchQuery" WHERE "keyId" IN ?',
                [['key1', 'key2']],
                (err, rows) => {
                  assert.ok(!err);
                  assert.ok(rows.length, 2);
                  assert.strictEqual(rows[0].keys().length, 3);
                  assert.strictEqual(rows[0].values().length, 3);
                  assert.strictEqual(rows[0].get('c1'), 'value1');
                  assert.strictEqual(rows[0].get('c2'), 'value2');

                  assert.strictEqual(rows[1].keys().length, 3);
                  assert.strictEqual(rows[1].values().length, 3);
                  assert.strictEqual(rows[1].get('c1'), 'value3');
                  assert.strictEqual(rows[1].get('c2'), 'value4');

                  // Try running it without any queries
                  Cassandra.runBatchQuery([], err => {
                    assert.ok(!err);
                    callback();
                  });
                }
              );
            });
          });
        }
      );
    });

    /**
     * Test casting to a Boolean
     */
    it('verify casting to a Boolean', callback => {
      Cassandra.createColumnFamily(
        'testBooleans',
        'CREATE TABLE "testBooleans" ("keyId" text PRIMARY KEY, "testbool" text, "testnumbool" text, "teststring" text)',
        (err, created) => {
          assert.ok(!err);
          assert.ok(created);
          Cassandra.runQuery(
            'INSERT INTO "testBooleans" ("keyId", "testbool", "testnumbool", "teststring") VALUES (?, ?, ?, ?)',
            ['testkey', 'true', '0', 'notaboolean'],
            err => {
              assert.ok(!err);
              Cassandra.runQuery(
                'SELECT "testbool", "testnumbool", "teststring" FROM "testBooleans" WHERE "keyId" = ?',
                ['testkey'],
                (err, rows) => {
                  assert.ok(!err);
                  assert.strictEqual(
                    typeof OaeUtil.castToBoolean(_.first(rows).get('testbool')),
                    'boolean'
                  );
                  assert.strictEqual(
                    typeof OaeUtil.castToBoolean(_.first(rows).get('testnumbool')),
                    'boolean'
                  );
                  assert.strictEqual(
                    typeof OaeUtil.castToBoolean(_.first(rows).get('teststring')),
                    'string'
                  );
                  callback();
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test whether the constructUpsertCQL works as expected, making sure that invalid parameters
     * are handled appropriately
     */
    it('verify construct upsert', callback => {
      // Test an invalid call with no provided cf
      const query1 = Cassandra.constructUpsertCQL(null, 'testId', 'testValue', { key1: 'value1' });
      assert.ok(!query1);

      // Test an invalid call with no provided values
      const query2 = Cassandra.constructUpsertCQL('testCF', 'testId', 'testValue', {});
      assert.ok(!query2);

      // Test a valid update with one key-value pair
      const query3 = Cassandra.constructUpsertCQL('testCF', 'testId', 'testValue', {
        key1: 'value1'
      });
      assert.ok(query3);
      assert.strictEqual(query3.query, 'UPDATE "testCF" SET "key1" = ? WHERE "testId" = ?');
      assert.strictEqual(query3.parameters[0], 'value1');
      assert.strictEqual(query3.parameters[1], 'testValue');

      // Test a valid update with multiple key-value pairs
      const query5 = Cassandra.constructUpsertCQL('testCF', 'testId', 'testValue', {
        key1: 'value1',
        key2: 'value2',
        key3: 'value3'
      });
      assert.ok(query5);
      assert.strictEqual(query5.query.indexOf('UPDATE "testCF" SET '), 0);
      assert.ok(query5.query.indexOf('"key1" = ?') !== -1);
      assert.ok(query5.query.indexOf('"key2" = ?') !== -1);
      assert.ok(query5.query.indexOf('"key3" = ?') !== -1);
      assert.ok(query5.query.indexOf(' WHERE "testId" = ?') !== -1);
      assert.ok(_.contains(query5.parameters, 'value1'));
      assert.ok(_.contains(query5.parameters, 'value2'));
      assert.ok(_.contains(query5.parameters, 'value3'));
      assert.strictEqual(query5.parameters[3], 'testValue');

      // Verify TTL is added to the query with proper syntax
      const query7 = Cassandra.constructUpsertCQL(
        'testCF',
        'testId',
        'testValue',
        { key1: 'value1', key2: 'value2', key3: 'value3' },
        500
      );
      assert.ok(query7);
      assert.strictEqual(query7.query.indexOf('UPDATE "testCF" USING TTL 500 SET '), 0);
      assert.ok(query7.query.indexOf('"key1" = ?') !== -1);
      assert.ok(query7.query.indexOf('"key2" = ?') !== -1);
      assert.ok(query7.query.indexOf('"key3" = ?') !== -1);
      assert.ok(query7.query.indexOf(' WHERE "testId" = ?') !== -1);
      assert.ok(_.contains(query7.parameters, 'value1'));
      assert.ok(_.contains(query7.parameters, 'value2'));
      assert.ok(_.contains(query7.parameters, 'value3'));
      assert.strictEqual(query7.parameters[3], 'testValue');

      // Verify a JSON object and JSON array are stringified
      const query8 = Cassandra.constructUpsertCQL(
        'testCF',
        'testId',
        'testValue',
        { key1: { anobject: 'a value' }, key2: ['index0', 'index1'], key3: 'value3' },
        500
      );
      assert.ok(query8);
      assert.strictEqual(query8.query.indexOf('UPDATE "testCF" USING TTL 500 SET '), 0);
      assert.ok(query8.query.indexOf('"key1" = ?') !== -1);
      assert.ok(query8.query.indexOf('"key2" = ?') !== -1);
      assert.ok(query8.query.indexOf('"key3" = ?') !== -1);
      assert.ok(query8.query.indexOf(' WHERE "testId" = ?') !== -1);
      assert.ok(_.contains(query8.parameters, 'value3'));
      assert.ok(query8.parameters[3], 'testValue');

      let hasObject = false;
      let hasArray = false;

      _.each(query8.parameters, param => {
        try {
          param = JSON.parse(param);
        } catch (error) {
          return error;
        }

        if (_.isArray(param)) {
          hasArray = true;
          assert.strictEqual(param[0], 'index0');
          assert.strictEqual(param[1], 'index1');
        } else if (_.isObject(param)) {
          hasObject = true;
          assert.strictEqual(param.anobject, 'a value');
        }
      });

      // Ensure we did have both the object and array in the parameters list
      assert.ok(hasObject);
      assert.ok(hasArray);

      return callback();
    });

    /**
     * Test that verifies the functionality of paging rows in a dynamic column family
     */
    it('verify paging rows of compact storage tables', callback => {
      // Set up column family and data used for paging
      Cassandra.createColumnFamily(
        'VerifyPagedColumnQueryStartAndEnd',
        'CREATE TABLE "VerifyPagedColumnQueryStartAndEnd" ("keyId" text, "columnName" text, "value" text, PRIMARY KEY("keyId", "columnName")) WITH COMPACT STORAGE',
        (err, created) => {
          assert.ok(!err);

          // Need to at least have values beyond 'k' to avoid we overlook 'keyId'
          const batch = _.map(
            ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'],
            columnName => {
              return Cassandra.constructUpsertCQL(
                'VerifyPagedColumnQueryStartAndEnd',
                ['keyId', 'columnName'],
                ['key', columnName],
                { value: '1' }
              );
            }
          );

          Cassandra.runBatchQuery(batch, err => {
            assert.ok(!err);

            // Verify inclusive end works with unbounded start (forward)
            Cassandra.runPagedQuery(
              'VerifyPagedColumnQueryStartAndEnd',
              'keyId',
              'key',
              'columnName',
              null,
              8,
              { end: 'a' },
              (err, rows, nextToken, startMatched) => {
                assert.ok(!err);
                assert.ok(rows);
                assert.strictEqual(startMatched, false);

                assert.strictEqual(rows.length, 1);
                assert.strictEqual(rows[0].get('columnName'), 'a');

                // Verify inclusive end works with bounded start, multiple results full page (forward)
                Cassandra.runPagedQuery(
                  'VerifyPagedColumnQueryStartAndEnd',
                  'keyId',
                  'key',
                  'columnName',
                  null,
                  8,
                  { end: 'j' },
                  (err, rows, nextToken, startMatched) => {
                    assert.ok(!err);
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
                    Cassandra.runPagedQuery(
                      'VerifyPagedColumnQueryStartAndEnd',
                      'keyId',
                      'key',
                      'columnName',
                      null,
                      8,
                      { reversed: true, end: 'm' },
                      (err, rows, nextToken, startMatched) => {
                        assert.ok(!err);
                        assert.ok(rows);
                        assert.strictEqual(startMatched, false);

                        assert.strictEqual(rows.length, 1);
                        assert.strictEqual(rows[0].get('columnName'), 'm');

                        // Verify inclusive end works with bounded start, multiple results full page (forward)
                        Cassandra.runPagedQuery(
                          'VerifyPagedColumnQueryStartAndEnd',
                          'keyId',
                          'key',
                          'columnName',
                          null,
                          8,
                          { reversed: true, end: 'c' },
                          (err, rows, nextToken, startMatched) => {
                            assert.ok(!err);
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

                            return callback();
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          });
        }
      );
    });

    /**
     * Test that ensures the CQL3 bug: https://issues.apache.org/jira/browse/CASSANDRA-6330 is fixed
     */
    it('verify a strict upper bound on range query does not result in one less item than requested with limit', callback => {
      Cassandra.createColumnFamily(
        'VerifyCassandra6330',
        'CREATE TABLE "VerifyCassandra6330" ("keyId" text, "column" text, "value" text, PRIMARY KEY ("keyId", "column")) WITH COMPACT STORAGE',
        (err, created) => {
          assert.ok(!err);

          // Need to at least have values beyond 'k' to avoid we overlook 'keyId'
          const batch = _.map(['a', 'b', 'c', 'd', 'e'], columnName => {
            return Cassandra.constructUpsertCQL(
              'VerifyCassandra6330',
              ['keyId', 'column'],
              ['key', columnName],
              { value: '1' }
            );
          });

          Cassandra.runBatchQuery(batch, err => {
            assert.ok(!err);

            Cassandra.runQuery(
              'SELECT "column" FROM "VerifyCassandra6330" WHERE "keyId" = ? AND "column" < ? ORDER BY "column" DESC LIMIT 2',
              ['key', 'c'],
              (err, rows) => {
                assert.ok(!err);

                // We asked for 2 items, and there were 2 to fetch (a and b), we get both. If the bug were still in effect we'd get 1 as
                // described in https://issues.apache.org/jira/browse/CASSANDRA-6330
                assert.strictEqual(rows.length, 2);

                return callback();
              }
            );
          });
        }
      );
    });

    /**
     * Test that verifies that no extra rows are returned on queries that use LIMIT, which is a bug in some versions of Cassandra 2.x
     *
     * @see https://issues.apache.org/jira/browse/CASSANDRA-7052
     */
    it('verify a strict upper bound on range query results in one more item than requested with limit', callback => {
      Cassandra.createColumnFamily(
        'VerifyCassandra7052',
        'CREATE TABLE "VerifyCassandra7052" ("keyId" text, "column" text, "value" text, PRIMARY KEY ("keyId", "column")) WITH COMPACT STORAGE',
        (err, created) => {
          assert.ok(!err);

          const batch = _.map(['a', 'b', 'c', 'd', 'e'], columnName => {
            return Cassandra.constructUpsertCQL(
              'VerifyCassandra7052',
              ['keyId', 'column'],
              ['key', columnName],
              { value: '1' }
            );
          });

          Cassandra.runBatchQuery(batch, err => {
            assert.ok(!err);

            Cassandra.runQuery(
              'SELECT "column" FROM "VerifyCassandra7052" WHERE "keyId" = ? AND "column" <= ? LIMIT 2',
              ['key', 'e'],
              (err, rows) => {
                assert.ok(!err);

                // We asked for 2 items, if the bug is present we get 3
                assert.strictEqual(rows.length, 2);

                return callback();
              }
            );
          });
        }
      );
    });

    /**
     * Test that verifies the paged column query handles multi-byte characters properly. This is a regression test for
     * https://github.com/oaeproject/Hilary/issues/443
     */
    it('verify multi-byte character in paged column query', callback => {
      Cassandra.createColumnFamily(
        'VerifyMultiBytePagedColumnQuery',
        'CREATE TABLE "VerifyMultiBytePagedColumnQuery" ("keyId" text, "column1" text, "value" text, PRIMARY KEY ("keyId", "column1")) WITH COMPACT STORAGE',
        (err, created) => {
          assert.ok(!err);
          assert.ok(created);

          const stringWithMultiByte = 'Foo O’bar';

          Cassandra.runQuery(
            'INSERT INTO "VerifyMultiBytePagedColumnQuery" ("keyId", "column1", "value") VALUES (?, ?, ?)',
            ['key1', stringWithMultiByte, '1'],
            err => {
              assert.ok(!err);

              Cassandra.runPagedQuery(
                'VerifyMultiBytePagedColumnQuery',
                'keyId',
                'key1',
                'column1',
                null,
                10,
                null,
                (err, rows, nextToken, startMatched) => {
                  assert.ok(!err);
                  assert.strictEqual(rows.length, 1);
                  assert.ok(!nextToken);
                  assert.ok(!startMatched);
                  assert.strictEqual(rows[0].get('column1'), stringWithMultiByte);
                  return callback();
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies truncation of query logging
     */
    it('verify truncation of cassandra query log entries', callback => {
      // Create a large erroneous query whose query and parameters should
      // be truncated
      const invalidQuery = 'SELECT "LLLOOOOLLLLL" FROM "SOMETHING ELSE"';
      const invalidQueryLongerThan300 = invalidQuery + _.range(300).join('');

      const longQueryMoreThan10 = invalidQueryLongerThan300 + '? ? ? ? ? ? ? ? ? ? ? ?';
      const longParamsMoreThan10 = [
        'short enough',
        // Entries longer than 80
        _.range(0, 100).join(''),
        _.range(1, 100).join(''),
        _.range(2, 100).join(''),
        _.range(3, 100).join(''),
        _.range(4, 100).join(''),
        _.range(5, 100).join(''),
        _.range(6, 100).join(''),
        _.range(7, 100).join(''),
        _.range(8, 100).join(''),
        _.range(9, 100).join(''),
        _.range(10, 100).join('')
      ];

      // Run the invalid query then hook into the error log to continue
      // the test
      Cassandra.runQuery(longQueryMoreThan10, longParamsMoreThan10, err => {
        assert.ok(err);
        assert.strictEqual(err.code, 500);
        assert.strictEqual(err.msg, 'An error occurred executing a query');
      });

      // Hook into oae-cassandra's logger error function to ensure we get
      // the truncated data we want
      const cassandraLoggerError = cassandraLog().error;
      cassandraLog().error = function(data, message) {
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

        // Create a failing query with no parameters specified, then
        // hook into the error logger a second time to verify the new
        // log information
        Cassandra.runQuery(invalidQueryLongerThan300, null, err => {
          assert.ok(err);
          assert.strictEqual(err.code, 500);
          assert.strictEqual(err.msg, 'An error occurred executing a query');
        });

        // Hook into cassandra's error log to ensure that the
        // information is truncated as expected
        cassandraLog().error = function(data, message) {
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
          return callback();
        };
      };
    });
  });
});
