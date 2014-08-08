The scripts in this directory perform a migration for revisioning links. 6.6 will not work without these scripts.

To perform the upgrade, do the following:
 * Using cqlsh in cql3 mode, run the script add_link_to_revision.cql3 against cassandra. This adds the appropriate column to allow for revisioning links
