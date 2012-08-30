var express = require('express');

var userModel = require('./user.model.js');

module.exports.registerAPI = function(tenant) {
    
    // Do some random people
    var userCache = [];
    userCache.push(new userModel.User(tenant, "Mark", tenant.name));
    userCache.push(new userModel.User(tenant, "John", tenant.name));
    userCache.push(new userModel.User(tenant, "Erik", tenant.name));

    // API calls
    tenant.server.get('/users/list', function(req, res) {
        res.send(userCache);
    });

    tenant.server.get('/users/create', function(req, res) {
        userCache.push(new userModel.User(tenant, req.query.firstName, req.query.lastName));
        res.send(200);
    });

};
