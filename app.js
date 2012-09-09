var OAE = require('oae-util/lib/oae');

var config = require('./config').config;
OAE.init(config.cassandra, function() {
    console.log("All done ... Enjoy!");
});
