#!/bin/sh

if [ "$2" == "" ]; then
    echo "Usage: $0 <create schema file> <upgrade schema file> [mocha_grep]"
    exit 1
fi

CREATE_SCHEMA_PATH="$1"
UPGRADE_SCHEMA_PATH="$2"

echo "Dropping oaeTest keyspace"
echo "DROP KEYSPACE \"oaeTest\";" > /tmp/oae_test_setup.cql3
cqlsh -f /tmp/oae_test_setup.cql3

echo "Seeding the initial database schema from $CREATE_SCHEMA_PATH"
cqlsh -f $CREATE_SCHEMA_PATH

echo "Applying schema migration from $UPGRADE_SCHEMA_PATH"
cqlsh -k oaeTest -f $UPGRADE_SCHEMA_PATH

echo "Running unit tests"

# As an auxillary test, we'll put a dummy table in place to ensure we didn't
# wipe away the schema.
echo "CREATE TABLE unit_test_migration (key text PRIMARY KEY, value text);" > /tmp/oae_test_setup.cql3
cqlsh -k oaeTest -f /tmp/oae_test_setup.cql3

# Ensure we don't drop our nicely migrated schema and start from scratch
OAE_TEST_DROP_KEYSPACE_BEFORE=false MOCHA_GREP="${@:3}" sh -c 'grunt test'

# Ensure our dummy table is still there to ensure the migrated schema was not wiped
echo "INSERT INTO unit_test_migration (key, value) VALUES ('key', 'value');" > /tmp/oae_test_setup.cql3
cqlsh -k oaeTest -f /tmp/oae_test_setup.cql3
echo "Result from post-query was $?"
