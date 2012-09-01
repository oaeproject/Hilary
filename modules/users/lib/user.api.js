var express = require('express');

var userModel = require('./user.model.js');

var userServices = {};
var userCache = {};

module.exports.init = function(tenant) {
    
    var that = {};
    
    // Do some random people
    userCache[tenant.id] = userCache[tenant.id] || [];
    userCache[tenant.id].push(new userModel.User(tenant, "Mark", tenant.name));
    userCache[tenant.id].push(new userModel.User(tenant, "John", tenant.name));
    userCache[tenant.id].push(new userModel.User(tenant, "Erik", tenant.name));

    // API functions
    that.listUsers = function() {
        return userCache[tenant.id];
    };

    that.listAllUsers = function() {
        return userCache;
    };

    that.createUser = function(firstName, lastName) {
        userCache[tenant.id].push(new userModel.User(tenant, firstName, lastName));
    };

    that.getUser = function(userId) {
        for (var t in userCache) {
            for (var u = 0; u < userCache[t].length; u++) {
                if (userCache[t][u].id === userId) {
                    return userCache[t][u];
                }
            };
        }
    };

    // REST calls
    tenant.server.get('/users/list', function(req, res) {
        res.send(that.listUsers());
    });

    tenant.server.get('/users/listall', function(req, res) {
        res.send(that.listAllUsers());
    });

    tenant.server.get('/users/create', function(req, res) {
        that.createUser(req.query.firstName, req.query.lastName);
        res.send(200);
    });

    tenant.server.get('/users/get', function(req, res) {
        res.send(that.getUser(req.query.userId));
    });

    tenant.server.get('/users/updateProfile', function(req, res) {
        var user = that.getUser(req.query.userId);
        if (req.query.firstName) {
            user.firstName = req.query.firstName;
        }
        if (req.query.lastName) {
            user.lastName = req.query.lastName;
        }
        res.send(200);
    });

    userServices[tenant.id] = that;
    return that;

};

module.exports.getUserService = function(tenant) {
    if (userServices[tenant.id]) {
        return userServices[tenant.id];
    } else {
        return null;
    }
};