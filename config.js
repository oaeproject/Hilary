var config = {};

// Cassandra related config information.
config.cassandra = {
    'type': 'pool', // pool or simple
    'hosts': ['127.0.0.1:9160'], 
    'port': 9160, 
    'keyspace': 'oae',
    'system': '127.0.0.1:9160',
    'user': '', 
    'pass': ''
};



module.exports.config = config;