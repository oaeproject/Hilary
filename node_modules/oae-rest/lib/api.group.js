/*
 * Copyright 2012 Sakai Foundation (SF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://www.osedu.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

var RestUtil = require('./util');

/**
 * Creates a group through the REST API.
 * Optional arguments will only be added if they are defined and will be sent as is.
 * @param {RestContext}            restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                     user credentials
 * @param {String}                 alias               The alias for this group
 * @param {String}                 name                The name for this group
 * @param {String}                 description         The description for this group (Optional)
 * @param {String}                 visibility          The visibility for this group (Optional)
 * @param {String}                 joinable            Whether or not this group is joinable (Optional)
 * @param {Array<String>}          managers            An array of userIds that should be made managers (Optional)
 * @param {Array<String>}          members             An array of userIds that should be made members (Optional)
 * @param {Function(err, resp)}    callback            Standard callback method
 * @param {Object}                 callback.err        Error object containing error code and error message
 * @param {Group}                  callback.response   A Group object representing the created group
 */
var createGroup = module.exports.createGroup = function (restCtx, alias, name, description, visibility, joinable, managers, members, callback) {
    var postData = {
        'alias': alias,
        'name': name,
        'description': description,
        'visibility': visibility,
        'joinable': joinable,
        'managers': managers,
        'members': members
    };
    RestUtil.RestRequest(restCtx, '/api/group/create', 'POST', postData, callback);
};
   
/**
 * Get a group trough the REST API.
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                      user credentials
 * @param {String}                  groupId             The id of the group you wish to retrieve.
 * @param {Function(err, resp)}     callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 * @param {Group}                   callback.response   The group object representing the requested group
 */
var getGroup = module.exports.getGroup = function(restCtx, groupId, callback) {
    RestUtil.RestRequest(restCtx, '/api/group/' + groupId, 'GET', null, callback);
};

/**
 * Updates a group through the REST API.
 * Optional arguments will only be added if they are defined and will be sent as is.
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                      user credentials
 * @param {String}                  groupId             The id of the group you wish to update
 * @param {Object}                  profileFields       Object where the keys represent the profile fields that need to be updated and the
 *                                                      values represent the new values for those profile fields/
 *                                                      e.g. {'name': 'New group name', 'description': 'New group description', 'visibility': 'private', 'joinable': 'no'}
 * @param {Function(err)}           callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 */
var updateGroup = module.exports.updateGroup = function (restCtx, groupId, profileFields, callback) {
    RestUtil.RestRequest(restCtx, '/api/group/' + groupId, 'POST', profileFields, callback);
};


/**
 * Get the members of a group through the REST API.
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                      user credentials
 * @param {String}                  groupId             The id of the group you wish to update
 * @param {String}                  start               The principal id to start from (this will not be included in the response)
 * @param {Number}                  limit               The number of members to retrieve.
 * @param {Function(err, resp)}     callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 * @param {Array<User|Group>}       callback.response   Array of principals representing the group members
 */
var getGroupMembers = module.exports.getGroupMembers = function(restCtx, groupId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/group/' + groupId + '/members', 'GET', params, callback);
};

/**
 * Update the members of a group through the REST API.
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                      user credentials
 * @param {String}                  groupId             The id of the group you wish to update
 * @param {Object}                  members             A hash object where each key is the id of a user or group and the value
 *                                                      is one of 'manager', 'member' or false. In case the value is false,
 *                                                      the member will be deleted.
 * @param {Function(err)}           callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 */
var setGroupMembers = module.exports.setGroupMembers = function(restCtx, groupId, members, callback) {
    RestUtil.RestRequest(restCtx, '/api/group/' + groupId + '/members', 'POST', members, callback);
};

/**
 * Returns all of the groups that a user is a direct and indirect member of through the REST API.
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                      user credentials
 * @param {String}                  userId              The user id for which we want to get all of the memberships
 * @param {String}                  start               The group id to start from (this will not be included in the response)
 * @param {Number}                  limit               The number of members to retrieve
 * @param {Function(err, resp)}     callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 * @param {Array<Group>}            callback.response   An array of groups representing the direct and indirect memberships of the provided user
 */
var getMembershipForUser = module.exports.getMembershipForUser = function(context, userId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/group/memberships/' + userId, 'GET', params, callback);
};












/**
 * Checks whether a group alias exists.
 *
 * @param {Context}                 context             A context object with a valid Tenant and User object
 * @param {String}                  alias               The alias to check.
 * @param {Function(err, exists)}   callback            A callback method
 * @param {Object}                  callback.err        Error object containing error message
 * @param {Boolean}                 callback.exists     The parsed server response.
 *
var exists = module.exports.exists = function(context, alias, callback) {
    RestUtil.switchUser(context, function(err, response, body) {
        request.get('http://' + context.baseUrl + '/api/group/exists/' + alias, function(err, response, body) {
            if (err) {
                return callback(new RestUtil.OaeError('Something went wrong trying to contact the server: ' + err, response));
            } else if (response.statusCode !== 200 && response.statusCode !== 404) {
                return callback(new RestUtil.RestError('Could not verify this group: ' + body, response));
            }
            if (response.statusCode === 200) {
                callback(false, true);
            } else {
                callback(false, false);
            }
        });
    });
}; */