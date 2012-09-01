var IO = require('./IO');

/////////////
// Modules //
/////////////

var MODULES_PATH = "modules";

exports.getAvailableModules = function(callback) {
    IO.getFileListForFolder(MODULES_PATH, callback);
};

//////////////////////
// Cassandra access //
//////////////////////

var CassandraSystem = require('cassandra-client').System;
var CassandraTypes = require('cassandra-client/lib/gen-nodejs/cassandra_types');
var Connection = require('cassandra-client').Connection;

var sys = new CassandraSystem('127.0.0.1:9160');
var con = false;

var KEYSPACE = "oae";

exports.getConnection = function() {
    return con;
};

exports.initializeKeySpace = function(callback) {
    var standard1 = new CassandraTypes.CfDef({keyspace: KEYSPACE, name: 'Standard1', column_type: 'Standard', comparator_type: 'UTF8Type', default_validation_class: 'UTF8Type'});
    var cfLong = new CassandraTypes.CfDef({keyspace: KEYSPACE, name: 'CfLong', column_type: 'Standard', comparator_type: 'LongType', default_validation_class: 'LongType', key_validation_class: 'LongType'});
    var cfInt = new CassandraTypes.CfDef({keyspace: KEYSPACE, name: 'CfInt', column_type: 'Standard', comparator_type: 'IntegerType', default_validation_class: 'IntegerType', key_validation_class: 'IntegerType'});
    var cfUtf8 = new CassandraTypes.CfDef({keyspace: KEYSPACE, name: 'CfUtf8', column_type: 'Standard', comparator_type: 'UTF8Type', default_validation_class: 'UTF8Type', key_validation_class: 'UTF8Type'});
    var cfBytes = new CassandraTypes.CfDef({keyspace: KEYSPACE, name: 'CfBytes', column_type: 'Standard', comparator_type: 'BytesType', default_validation_class: 'BytesType', key_validation_class: 'BytesType'});
    var cfUuid = new CassandraTypes.CfDef({keyspace: KEYSPACE, name: 'CfUuid', column_type: 'Standard', comparator_type: 'TimeUUIDType', default_validation_class: 'TimeUUIDType', key_validation_class: 'TimeUUIDType'});
    var cfUgly = new CassandraTypes.CfDef({keyspace: KEYSPACE, name: 'CfUgly', column_type: 'Standard', comparator_type: 'UTF8Type',
                              default_validation_class: 'LongType', key_validation_class: 'IntegerType',
                              column_metadata: [
                                new CassandraTypes.ColumnDef({name: 'int_col', validation_class: 'IntegerType'}),
                                new CassandraTypes.ColumnDef({name: 'string_col', validation_class: 'UTF8Type'}),
                                new CassandraTypes.ColumnDef({name: 'uuid_col', validation_class: 'TimeUUIDType'})
                              ]});
    var cfCounter = new CassandraTypes.CfDef({keyspace: KEYSPACE, name: 'CfCounter', column_type: 'Standard', comparator_type: 'AsciiType', default_validation_class: 'CounterColumnType', key_validation_class: 'AsciiType'});
    var super1 = new CassandraTypes.CfDef({keyspace: KEYSPACE, name: 'Super1', column_type: 'Super', comparator_type: 'UTF8Type', subcomparator_type: 'UTF8Type'});
    var ksDef = new CassandraTypes.KsDef({
        name: KEYSPACE, 
        strategy_class: 'org.apache.cassandra.locator.SimpleStrategy', 
        strategy_options: {
            'replication_factor': '1'
        }, 
        cf_defs: [standard1, super1, cfInt, cfUtf8, cfLong, cfBytes, cfUuid, cfUgly, cfCounter]
    });
    sys.addKeyspace(ksDef, function(err) {
        if (err) {
            console.log("The keyspace could not be created");
            console.log(err);
        } else {
            console.log("The keyspace has been created");
        }
        con = new Connection({host:'localhost', port:9160, keyspace: KEYSPACE, user:'', pass:''});
        console.log("Connected to Cassandra");
        callback();
    });
};

exports.runQuery = function(query, parameters, callback) {
    con.connect(function(connectErr){
        if (connectErr) {
            console.log("Failed to connect to Cassandra");
            console.log(connectErr);
        } else {
            console.log("Connected to Cassandra");
            con.execute(query, parameters || [], function(queryErr) {
                if (queryErr) {
                    console.log("Query " + query + " has failed");
                } else {
                    console.log("Query " + query + " has succeeded");
                }
                con.close();
            });
        }
    });
};
