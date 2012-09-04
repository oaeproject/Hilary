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
var KEYSPACE = "oae";
//var con = new PooledConnection({hosts: ['localhost:9160'], keyspace: KEYSPACE, 'user': '', 'pass': ''});
//var con = new Connection({hosts: 'localhost', 'port': 9160, keyspace: KEYSPACE, 'user': '', 'pass': ''});

exports.getConnection = function() {
    return new Connection({hosts: 'localhost', 'port': 9160, keyspace: KEYSPACE, 'user': '', 'pass': ''});;
};

exports.initializeKeySpace = function(callback) {
    var ksDef = new CassandraTypes.KsDef({
        name: KEYSPACE, 
        strategy_class: 'org.apache.cassandra.locator.SimpleStrategy', 
        strategy_options: {
            'replication_factor': '1'
        }, 
        cf_defs: []
    });
    sys.addKeyspace(ksDef, function(err) {
        if (err) {
            console.log("The keyspace could not be created");
            console.log(err);
        } else {
            console.log("The keyspace has been created");
        }
    });
};


fixQuery = function(query, parameters) {
    var fixedQuery = "";
    var fixedParameters = [];
    var q = query.indexOf('?');
    var from = 0;
    var i = 0;
    while (q >= 0) {
        fixedQuery += query.slice(from, q);

        // If we passed in an array add n-1 more question marks.
        if (Array.isArray(parameters[i])) {
            for (var c = 0; c < parameters[i].length - 1;c++) {
                fixedQuery += "?, ";
                fixedParameters.push(parameters[i][c]);
            }
            fixedParameters.push(parameters[i][parameters[i].length - 1]);
        }
        else {
            fixedParameters.push(parameters[i]);
        }
        fixedQuery += '?';


        // Next one.
        from = q+1;
        q = query.indexOf('?', from);
        i++;
    }

    // Append the request of the query.
    fixedQuery += query.slice(from);
    return {'query': fixedQuery, 'parameters': fixedParameters};
};


exports.runQuery = function(query, parameters, callback) {
    var fixed = fixQuery(query, parameters);
    var con = exports.getConnection();
    con.connect(function(err){
        if (err) {
            console.log("Failed to connect to Cassandra");
            console.log(err);
        } else {
            con.execute(fixed.query, fixed.parameters, function(err, rows) {
                con.close(function() {
                    callback(err, rows);
                });
            });
        }
    });
};
