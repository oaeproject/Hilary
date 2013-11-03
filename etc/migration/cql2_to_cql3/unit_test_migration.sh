#!/bin/sh

if [ "$1" == "" ]; then
    echo "Usage: $0 <create schema file> [mocha_grep]"
    exit 1
fi

echo "Dropping oaeTest keyspace"
echo "DROP KEYSPACE \"oaeTest\";" > /tmp/oae_test_setup.cql3
cqlsh -3 -f /tmp/oae_test_setup.cql3

echo "Seeding the CQL2 database schema"
cqlsh -2 -f $1

echo "Applying schema migration to CQL3"
cassandra-cli -k oaeTest -f etc/migration/cql2_to_cql3/1-upgrade-cql2-to-cql3/1-cassandra-cli
cqlsh -3 -k oaeTest -f etc/migration/cql2_to_cql3/1-upgrade-cql2-to-cql3/2-cqlsh.cql3

echo "Running unit tests"

# As an auxillary test, we'll put a dummy table in place to ensure we didn't
# wipe away the schema.
echo "CREATE TABLE unit_test_migration (key text PRIMARY KEY, value text);" > /tmp/oae_test_setup.cql3
cqlsh -3 -k oaeTest -f /tmp/oae_test_setup.cql3

# Ensure we don't drop our nicely migrated schema and start from scratch
OAE_TEST_DROP_KEYSPACE_BEFORE=false MOCHA_GREP="${@:2}" sh -c 'grunt test'

# Ensure our dummy table is still there to ensure the migrated schema was not wiped
echo "INSERT INTO unit_test_migration (key, value) VALUES ('key', 'value');" > /tmp/oae_test_setup.cql3
cqlsh -3 -k oaeTest -f /tmp/oae_test_setup.cql3
echo "Result from post-query was $?"
