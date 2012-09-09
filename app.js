var OAE = require('oae-util/lib/oae');

var config = require('./config').config;
OAE.init(config, function() {
    console.log("All done ... Enjoy!");
});
