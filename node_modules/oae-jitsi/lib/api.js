var EmitterAPI = require('oae-emitter');

var meetingsAPI = module.exports = new EmitterAPI.EventEmitter();

module.exports.Meetings = require('./api.meetings');