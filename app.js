var express = require('express');

var tenantUtil = require('oae-util/lib/Tenant');
var cassandra = require('oae-util/lib/cassandra');

var config = require('./config').config;



var tenantArr = [];

var startOAE = function(tenantArr) {
    var server = express();
    server.listen(2000);
    registerAPI(server, tenantArr);

    console.log('Start global server on port 2000');
    
};

var registerAPI = function(server, tennantArr) {
    
    server.get('/whoami', function(req, res, next) {
        res.send('Sakai OAE Global Admin Interface');
    });

    server.get('/create', function(req, res, next) {
        createNewTenant(req.query.id, req.query.name, req.query.port);
        res.send('New tenant "' + req.query.name + '" has been fired up on port ' + req.query.port);
    });

    server.get('/tenants', function(req, res, next) {
        res.send(tenantArr);
    });

};

var createNewTenant = function(id, name, port) {
    var tenant = new tenantUtil.Tenant(id, name, port);
    tenantArr.push(tenant);
    tenantUtil.startTenant(tenant);
};

// Create Cassandra database.
cassandra.init(config.cassandra);

startOAE([]);
createNewTenant('cam', 'Cambridge', 2001);