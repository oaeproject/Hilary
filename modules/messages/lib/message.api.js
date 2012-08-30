var express = require('express');
var messageModel = require('./message.model.js');

var users = require('../../users');

var messageServices = {};
var messageCache = {};

module.exports.startMessageService = function(tenant) {
    
    var that = {};
    var UserService = users.getUserService(tenant);

    // API functions
    that.sendMessage = function(from, to, title, body){
        from = UserService.getUser(from);
        var message = new messageModel.Message(from, to, title, body);
        messageCache[to] = messageCache[to] || [];
        messageCache[to].push(message);
    };

    that.getMessages = function(userId){
        if (messageCache[userId]){
            return messageCache[userId];
        } else {
            return [];
        }
    };
    
    // REST calls
    tenant.server.get('/messages/send', function(req, res) {
        that.sendMessage(req.query.from, req.query.to, req.query.title, req.query.body);
        res.send(200);
    });

    tenant.server.get('/messages/list', function(req, res) {
        res.send(that.getMessages(req.query.userId));
    });

    messageServices[tenant.id] = that;
    return that;

};

module.exports.getMessageService = function(tenant) {
    if (messageServices[tenant.id]) {
        return messageServices[tenant.id];
    } else {
        return null;
    }
};