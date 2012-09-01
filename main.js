var express = require('express');
var adminui = require('admin-ui');

var OAE = require('./util/OAE')
var tenantUtil = require('./util/Tenant');

var tenantArr = [];

var startOAE = function(tenantArr) {
    var server = express();
    server.listen(2000);
    server.use(express.bodyParser());
    registerAPI(server, tenantArr);

    console.log('Start global server on port 2000');
    
};

var registerAPI = function(server, tennantArr) {
    
    server.get('/whoami', function(req, res, next) {
        res.send('Sakai OAE Global Admin Interface');
    });

    server.get('/tenants', function(req, res, next) {
        res.send(tenantArr);
    });

    server.post('/createtenant', function(req, res) {
        createNewTenant(req.body.id, req.body.name, req.body.port);
        res.send('New tenant "' + req.body.name + '" has been fired up on port ' + req.body.port);
    });

    server.get('/createtenant', function(req, res, next) {
        adminui.generateAdminUI(require('./config/createnewtenant').createNewTenantConfig, function(html) {
            res.send(html);
        })
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