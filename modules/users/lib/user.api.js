var express = require('express');

var userModel = require('./user.model.js');

var userCache = {};

module.exports.UserService = function(tenant) {
    
    // Do some random people
    userCache[tenant.id] = userCache[tenant.id] || [];
    userCache[tenant.id].push(new userModel.User(tenant, "Mark", tenant.name));
    userCache[tenant.id].push(new userModel.User(tenant, "John", tenant.name));
    userCache[tenant.id].push(new userModel.User(tenant, "Erik", tenant.name));

    // API calls
    tenant.server.get('/users/list', function(req, res) {
        res.send(userCache[tenant.id]);
    });

    tenant.server.get('/users/listall', function(req, res) {
        res.send(userCache);
    });

    tenant.server.get('/users/create', function(req, res) {
        userCache[tenant.id].push(new userModel.User(tenant, req.query.firstName, req.query.lastName));
        res.send(200);
    });

};
