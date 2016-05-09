var RestUtil = require('./util');

/**
 * Create a loodle
 *
 * @param restCtx
 * @param displayName
 * @param description
 * @param visibility
 * @param managers
 * @param viewers
 * @param folders
 * @param callback
 */
var createLoodle = module.exports.createLoodle = function (restCtx, displayName, description, visibility, managers, viewers, folders, callback) {

    var params = {
        'resourceSubType': 'loodle',
        'displayName': displayName,
        'description': description,
        'visibility': visibility,
        'link': null,
        'managers': managers,
        'viewers': viewers,
        'folders': folders
    };

    RestUtil.RestRequest(restCtx, '/api/content/create', 'POST', params, callback);

};

/**
 * Get loodle data
 *
 * @param restCtx
 * @param loodleId
 * @param callback
 */
var getLoodle = module.exports.getLoodle = function (restCtx, loodleId, callback) {
    RestUtil.RestRequest(restCtx, '/api/loodle/' + loodleId, 'GET', null, callback);
};

/**
 * Delete a loodle
 *
 * @param restCtx
 * @param contentId
 * @param callback
 */
var deleteLoodle = module.exports.deleteLoodle = function (restCtx, contentId, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + contentId, 'DELETE', null, callback);
};

/**
 * Add a schedule to a loodle
 *
 * @param restCtx
 * @param contentId
 * @param data
 * @param callback
 */
var addSchedule = module.exports.addSchedule = function (restCtx, loodleId, data, callback) {
    RestUtil.RestRequest(restCtx, '/api/loodle/' + loodleId + '/schedule', 'POST', data, callback);
};

/**
 * Delete a schedule from a loodle
 *
 * @param restCtx
 * @param loodleId
 * @param scheduleId
 * @param callback
 */
var deleteSchedule = module.exports.deleteSchedule = function (restCtx, loodleId, scheduleId, callback) {
    RestUtil.RestRequest(restCtx, '/api/loodle/' + loodleId + '/schedule/' + scheduleId, 'DELETE', null, callback);
};

/**
 * Update members of a loodle
 *
 * @param restCtx
 * @param contentId
 * @param changes
 * @param callback
 */
var updateMembers = module.exports.updateMembers = function (restCtx, contentId, changes, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + contentId + '/members', 'POST', changes, callback);
};

/**
 * Update the votes of a loodle
 *
 * @param restCtx
 * @param loodleId
 * @param data
 * @param callback
 */
var updateVotes = module.exports.updateVotes = function (restCtx, loodleId, data, callback) {
    RestUtil.RestRequest(restCtx, '/api/loodle/' + loodleId + '/votes', 'PUT', data, callback);
};





