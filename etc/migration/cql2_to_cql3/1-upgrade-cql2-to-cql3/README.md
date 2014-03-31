
The scripts in this directory perform a migration from CQL2 to CQL3 for the 2.1 Cassandra release. 2.1 will not work without these scripts.

To perform the upgrade, do the following:

1. Using cassandra-cli, run the script in 1-cassandra-cli. This adds some column metadata into the Revisions CF that triggers CQL3 to identify it as a static column family rather than a dynamic one
2. Using cqlsh in cql3 mode, run the script 2-cqlsh.cql3 against cassandra. This adds and renames appropriate columns to work with the CQL3 queries