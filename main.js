var express = require('express');

var tenants = require('./modules/tenants');

var tenantArr = [];

var startOAE = function(tenantArr) {
    var server = express();
    server.listen(2000);
    registerAPI(server);

    console.log('Start global server on port 2000');

    for (var i = 0; i < tenantArr.length; i++) {
        createNewTenant(tenantArr[i].id, tenantArr[i].name, tenantArr[i].port);
    }
    
};

var registerAPI = function(server) {
    server.use("/static", express.static(__dirname + '/static'));

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
    var tenant = new tenants.Tenant(id, name, port);
    tenantArr.push(tenant);
}

startOAE([{"id": "cambridge", "name": "Cambridge University", "port": 2001}, {"id": "gt", "name": "Georgia Tech", "port": 2002}]);