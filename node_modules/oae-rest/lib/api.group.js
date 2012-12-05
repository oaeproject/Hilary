/*!
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
 * 
 * @param  {RestContext}       restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}            alias               The alias for this group
 * @param  {String}            name                The name for this group
 * @param  {String}            [description]       The description for this group
 * @param  {String}            [visibility]        The visibility for this group. This can be 'public', 'loggedin' or 'private'
 * @param  {String}            [joinable]          Whether or not this group is joinable. This can be 'yes', 'no', or 'request'
 * @param  {String[]}          [managers]          An array of userIds that should be made managers
 * @param  {String[]}          [members]           An array of userIds that should be made members
 * @param  {Function}          callback            Standard callback method takes arguments `err` and `resp`
 * @param  {Object}            callback.err        Error object containing error code and error message
 * @param  {Group}             callback.response   A Group object representing the created group
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
 * 
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       groupId             The id of the group you wish to retrieve.
 * @param  {Function}     callback            Standard callback method takes arguments `err` and `resp`
 * @param  {Object}       callback.err        Error object containing error code and error message
 * @param  {Group}        callback.response   The group object representing the requested group
 */
var getGroup = module.exports.getGroup = function(restCtx, groupId, callback) {
    RestUtil.RestRequest(restCtx, '/api/group/' + RestUtil.encodeURIComponent(groupId), 'GET', null, callback);
};

/**
 * Updates a group through the REST API.
 * Optional arguments will only be added if they are defined and will be sent as is.
 * 
 * @param  {RestContext}    restCtx                       Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         groupId                       The id of the group you wish to update
 * @param  {Object}         profileFields                 Object where the keys represent the profile fields that need to be updated and the values represent the new values for those profile fieldss
 * @param  {String}         [profileFields.name]          New name for the group
 * @param  {String}         [profileFields.description]   New description for the group
 * @param  {String}         [profileFields.visibility]    New visibility setting for the group. The possible values are 'private', 'loggedin' and 'public'
 * @param  {String}         [profileFields.joinable]      New joinability setting for the group. The possible values are 'yes', 'no' and 'request'
 * @param  {Function}       callback                      Standard callback method takes argument `err`
 * @param  {Object}         callback.err                  Error object containing error code and error message
 */
var updateGroup = module.exports.updateGroup = function (restCtx, groupId, profileFields, callback) {
    RestUtil.RestRequest(restCtx, '/api/group/' + RestUtil.encodeURIComponent(groupId), 'POST', profileFields, callback);
};

/**
 * Get the members of a group through the REST API.
 * 
 * @param  {RestContext}        restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}             groupId             The id of the group you wish to update
 * @param  {String}             start               The principal id to start from (this will not be included in the response)
 * @param  {Number}             limit               The number of members to retrieve.
 * @param  {Function}           callback            Standard callback method takes arguments `err` and `resp`
 * @param  {Object}             callback.err        Error object containing error code and error message
 * @param  {User[]|Group[]}     callback.response   Array of principals representing the group members
 */
var getGroupMembers = module.exports.getGroupMembers = function(restCtx, groupId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/group/' + RestUtil.encodeURIComponent(groupId) + '/members', 'GET', params, callback);
};

/**
 * Update the members of a group through the REST API.
 * 
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         groupId             The id of the group you wish to update
 * @param  {Object}         members             A hash object where each key is the id of a user or group and the value is one of 'manager', 'member' or false. In case the value is false, the member will be deleted.
 * @param  {Function}       callback            Standard callback method takes argument `err`
 * @param  {Object}         callback.err        Error object containing error code and error message
 */
var setGroupMembers = module.exports.setGroupMembers = function(restCtx, groupId, members, callback) {
    RestUtil.RestRequest(restCtx, '/api/group/' + RestUtil.encodeURIComponent(groupId) + '/members', 'POST', members, callback);
};

/**
 * Returns all of the groups that a user is a direct and indirect member of through the REST API.
 * 
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       userId              The user id for which we want to get all of the memberships
 * @param  {String}       start               The group id to start from (this will not be included in the response)
 * @param  {Number}       limit               The number of members to retrieve
 * @param  {Function}     callback            Standard callback method takes arguments `err` and `resp`
 * @param  {Object}       callback.err        Error object containing error code and error message
 * @param  {Group[]}      callback.response   An array of groups representing the direct and indirect memberships of the provided user
 */
var memberOf = module.exports.memberOf = function(restCtx, userId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/user/' + RestUtil.encodeURIComponent(userId) + '/memberships', 'GET', params, callback);
};

/**
 * Checks whether a group alias exists through the REST API.
 * 
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         alias               The group alias to check.
 * @param  {Function}       callback            Standard callback method takes arguments `err` and `exists`
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Boolean}        callback.exists     True if the group already exists, false if it doesn't
 */
var exists = module.exports.exists = function(restCtx, alias, callback) {
    RestUtil.RestRequest(restCtx, '/api/group/exists/' + RestUtil.encodeURIComponent(alias), 'GET', null, function(err) {
        if (err) {
            callback(null, false);
        } else {
            callback(null, true);
        }
    });
};
