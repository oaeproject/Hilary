var log = require('oae-logger').logger('oae-jitsi-init');
var Cassandra = require('oae-util/lib/cassandra');

var MeetingSearch = require('./search');

module.exports = function (config, callback) {

    log().info('Initializing the oae-jitsi module');

    _ensureSchema(function (err) {
        if (err) {
            return callback(err);
        }

        // Register the activity functionality
        require('./activity');

        // Register the library functionality
        require('./library');

        return MeetingSearch.init(callback);
    });

};

/**
 * Ensure that all of the meeting-related schemas are created. If they already exist, this method will not do anything.
 * 
 * @param  {Function}         callback       Standard callback function
 * @param  {Object}           callback.err   An error that occurred, if any
 * @api private
 */
var _ensureSchema = function (callback) {

    Cassandra.createColumnFamilies({
        'MeetingsJitsi': 'CREATE TABLE "MeetingsJitsi" ("id" text PRIMARY KEY, "tenantAlias" text, "displayName" text, "visibility" text, "description" text, "createdBy" text, "created" text, "lastModified" text, "chat" boolean, "contactList" boolean)'
    }, callback);

};

