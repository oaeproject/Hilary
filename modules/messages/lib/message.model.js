var express = require('express');

///////////
// Model //
///////////

module.exports.Message = function(from, to, title, body) {
    
    var that = {};

    that.id = "" + Math.round(Math.random() * 1000000);
    that.from = from;
    that.to = to;
    that.title = title;
    that.body = body;

    return that;
    
};