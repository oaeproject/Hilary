var express = require('express');

var OAE = require('./util/OAE')
var tenantUtil = require('./util/Tenant');

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

    OAE.initializeKeySpace(function() {
        OAE.getAvailableModules(function(modules) {
            for (var m = 0; m < modules.length; m++) {
                
            }
        });
    });

};

var createNewTenant = function(id, name, port) {
    var tenant = new tenantUtil.Tenant(id, name, port);
    tenantArr.push(tenant);
}

startOAE([]);