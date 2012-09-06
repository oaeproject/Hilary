var express = require('express');

var IO = require('oae-util/lib/io');
var OAE = require('oae-util/lib/oae');
var Cassandra = require('oae-util/lib/cassandra');
var tenantAPI = require('oae-tenants');

var config = require('./config').config;

/**
 * Start OAE and run the global administrative interface
 * on port 2000 by default
 */
var startOAE = function() {
    var server = express();
    server.listen(2000);
    registerAPI(server);
    console.log('Starting Sakai OAE');
};

/**
 * Register all necessary REST end points for the global admin interface
 * @param  {Server}    server       Express object representing the global admin interface
 */
var registerAPI = function(server) {
    
    server.get('/whoami', function(req, res, next) {
        res.send('Sakai OAE Global Admin Interface');
    });

    server.get('/create', function(req, res, next) {
        tenantAPI.createTenant(req.query.id, req.query.name, req.query.description, req.query.port, function(err) {
            if (err) {
                return res.send(500, err);
            }
            res.send('New tenant "' + req.query.name + '" has been fired up on port ' + req.query.port);
        });
    });

    server.get('/tenants', function(req, res, next) {
        tenantAPI.getAllTenants(function(tenants, err) {
            if (err) {
                return res.send(500, err);
            }
            res.send(tenants);
        });
    });

    // Create Cassandra database.
    Cassandra.init(config.cassandra, function() {
        startTenants();
    });

};

/**
 * Start up all of the registered tenants
 */
var startTenants = function() {
    tenantAPI.getAllTenants(function(tenants, err) {
        if (err) {
            throw err;
        }
        for (var t = 0; t < tenants.length; t++) {
            tenantAPI.startTenant(tenants[t]);
        }
    });
};

/**
 * For each of the installed OAE-related modules, we check if there is a Cassandra schema that
 * needs to be initialized
 * @param  {String}    module       Id of the module for which the schema needs to be initialized
 */
var runModuleStore = function(module) {
    var path = "node_modules/" + module + "/install/install.js";
    IO.pathExists(path, function(exists) {
        if (exists) {
            require("./" + path);
        }
    });
};

startOAE();
