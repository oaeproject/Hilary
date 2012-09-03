var express = require('express');

var IO = require('oae-util/lib/IO');
var OAE = require('oae-util/lib/OAE');
var tenantUtil = require('oae-util/lib/Tenant');

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
            console.log(modules);
            for (var m = 0; m < modules.length; m++) {
                runModuleStore(modules[m]);
            }
        });
    });

    var runModuleStore = function(module) {
        var path = "node_modules/" + module + "/install/install.js";
        IO.pathExists(path, function(exists) {
            if (exists) {
                require("./" + path);
            }
        });
    };

};

var createNewTenant = function(id, name, port) {
    var tenant = new tenantUtil.Tenant(id, name, port);
    tenantArr.push(tenant);
}

startOAE([]);