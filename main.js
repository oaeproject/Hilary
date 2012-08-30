var restify = require('restify');

/**
 * Fires up a tenant server
 * @param {Object} tenantObj Data on the tenant
 **/
var startTenant = function(tenantObj) {
    var tenant = restify.createServer({
        'name': tenantObj.name
    });

    tenant.listen(tenantObj.port);

    tenant.get('/whoami', function(req, res, next) {
        res.send(tenantObj.name);
    });
    console.log('Start tenant "' + tenantObj.name + '" on port ' + tenantObj.port);
};

/**
 * Fires up the global server
 * @param {Array} tenantArr Array of tenants
 **/
var startOAE = function(tenantArr) {
    var server = restify.createServer({
        'name': 'Sakai OAE Global Admin Interface'
    });
    server.use(restify.queryParser());
    server.listen(2000);

    console.log('Start global server on port 2000');

    server.get('/whoami', function(req, res, next) {
        res.send('Sakai OAE Global Admin Interface');
    });

    // Spin up a new tenant server
    server.get('/create', function(req, res, next) {
        var tenantObj = {
            'id': req.query.id,
            'name': req.query.name,
            'port': parseInt(req.query.port)
        };

        tenantArr.push(tenantObj);
        startTenant(tenantObj);

        res.send('New tenant "' + tenantObj.name + '" has been fired up on port ' + tenantObj.port);
    });

    server.get('/tenants', function(req, res, next) {
        res.send(tenantArr);
    });

    for (var i = 0; i < tenantArr.length; i++) {
        startTenant(tenantArr[i]);
    }
};

startOAE([{
    'id': 'cambridge',
    'name': 'University of Cambridge',
    'port': 2001
},
{
    'id': 'gt',
    'name': 'Georgia Institute of Technology',
    'port': 2002
}]);