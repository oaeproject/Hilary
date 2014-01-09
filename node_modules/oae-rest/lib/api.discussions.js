/*!
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

var RestUtil = require('./util');

/**
 * Create a new discussion.
 *
 * @param  {RestContext}    restCtx             The context of the current request
 * @param  {String}         displayName         The display name of the discussion
 * @param  {String}         [description]       A longer description for the discussion
 * @param  {String}         [visibility]        The visibility of the discussion. One of public, loggedin, private. Defaults to the configured tenant default.
 * @param  {String[]}       [managers]          The principal ids of the initial managers of the discussion
 * @param  {String[]}       [members]           The principal ids of the initial members of the discussion
 * @param  {Function}       callback            Invoked when the process completes
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Discussion}     callback.discussion The discussion object that was created
 */
var createDiscussion = module.exports.createDiscussion = function(restCtx, displayName, description, visibility, managers, members, callback) {
    var params = {
        'displayName': displayName,
        'description': description,
        'visibility': visibility,
        'managers': managers,
        'members': members
    };
    RestUtil.RestRequest(restCtx, '/api/discussion/create', 'POST', params, callback);
};

/**
 * Get a discussion's full profile by its id. In addition to the basic profile, the full profile contains
 * the basic profile of the creator, and access information (see parameters)
 *
 * @param  {RestContext}    restCtx                         The context of the current request
 * @param  {String}         discussionId                    The id of the discussion to get
 * @param  {Function}       callback                        Invoked when the process completes
 * @param  {Object}         callback.err                    An error that occurred, if any
 * @param  {Discussion}     callback.discussion             The discussion object requested
 * @param  {User}           callback.discussion.createdBy   The basic profile of the user who created the discussion
 * @param  {Boolean}        callback.discussion.isManager   Specifies if the current user in context is a manager of the discussion
 * @param  {Boolean}        callback.discussion.canShare    Specifies if the current user in context is allowed to share the discussion
 * @param  {Boolean}        callback.discussion.canPost     Specifies if the current user in context is allowed to post messages to the discussion
 */
var getDiscussion = module.exports.getDiscussion = function(restCtx, discussionId, callback) {
    RestUtil.RestRequest(restCtx, '/api/discussion/' + RestUtil.encodeURIComponent(discussionId), 'GET', null, callback);
};

/**
 * Update the metadata of the specified discussion.
 *
 * @param  {RestContext}    restCtx             The context of the current request
 * @param  {String}         discussionId        The id of the discussion to update
 * @param  {Object}         profileFields       An object whose keys are profile field names, and the value is the value to which you wish the field to change. Keys must be one of: displayName, visibility, description
 * @param  {Function}       callback            Invoked when the process completes
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Discussion}     callback.discussion The updated discussion object
 */
var updateDiscussion = module.exports.updateDiscussion = function(restCtx, discussionId, profileFields, callback) {
    RestUtil.RestRequest(restCtx, '/api/discussion/' + RestUtil.encodeURIComponent(discussionId), 'POST', profileFields, callback);
};

/**
 * Deletes a discussion. The discussion will also be removed from all the principal libraries.
 *
 * @param  {RestContext}    restCtx                         The context of the current request
 * @param  {String}         discussionId                    The id of the discussion to delete
 * @param  {Function}       callback                        Invoked when the process completes
 * @param  {Object}         callback.err                    An error that occurred, if any
 */
var deleteDiscussion = module.exports.deleteDiscussion = function(restCtx, discussionId, callback) {
    RestUtil.RestRequest(restCtx, '/api/discussion/' + RestUtil.encodeURIComponent(discussionId), 'DELETE', null, callback);
};

/**
 * Get the discussions library items for the specified principal. Depending on the access of the user in context,
 * either a library of public, loggedin, or all items will be returned.
 *
 * @param  {RestContext}    restCtx                 The context of the current request
 * @param  {String}         principalId             The id of the principal whose discussion library to fetch
 * @param  {String}         [start]                 The discussion ordering token from which to start fetching discussions (see `nextToken` in callback params)
 * @param  {Number}         [limit]                 The maximum number of results to return. Default: 10
 * @param  {Function}       callback                Invoked when the process completes
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Discussion[]}   callback.discussions    The array of discussions fetched
 * @param  {String}         [callback.nextToken]    The token that can be used as the `start` parameter to fetch the next set of tokens (exclusively). If not specified, indicates that the query fetched all remaining results.
 */
var getDiscussionsLibrary = module.exports.getDiscussionsLibrary = function(restCtx, principalId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/discussion/library/' + RestUtil.encodeURIComponent(principalId), 'GET', params, callback);
};

/**
 * Get a list of member profiles associated to a discussion, with their roles.
 *
 * @param  {RestContext}    restCtx                     The context of the current request
 * @param  {String}         discussionId                The id of the discussion whose members to get
 * @param  {String}         [start]                     The id of the principal from which to begin the page of results (exclusively). By default, begins from the first in the list.
 * @param  {Number}         [limit]                     The maximum number of results to return. Default: 10
 * @param  {Function}       callback                    Invoked when the process completes
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object[]}       callback.members            Array that contains an object for each member
 * @param  {String}         callback.members[i].role    The role of the member at index `i`
 * @param  {User|Group}     callback.members[i].profile The principal profile of the member at index `i`
 */
var getDiscussionMembers = module.exports.getDiscussionMembers = function(restCtx, discussionId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/discussion/' + RestUtil.encodeURIComponent(discussionId) + '/members', 'GET', params, callback);
};

/**
 * Update the members of a discussion. This method will ensure that the current user in context has access to change the
 * permissions, as well as ensure the discussion does not end up with no manager members.
 *
 * @param  {RestContext}    restCtx                 The context of the current request
 * @param  {String}         discussionId            The id of the discussion to share
 * @param  {Object}         permissionChanges       An object that describes the permission changes to apply to the discussion. The key is the id of the principal to which to apply the change, and the value is the role to apply to the principal. If the value is `false`, the principal will be revoked access. Acceptable values are: member, manager, or false.
 * @param  {Function}       callback                Invoked when the process completes
 * @param  {Object}         callback.err            An error that occurred, if any
 */
var updateDiscussionMembers = module.exports.updateDiscussionMembers = function(restCtx, discussionId, memberUpdates, callback) {
    RestUtil.RestRequest(restCtx, '/api/discussion/' + RestUtil.encodeURIComponent(discussionId) + '/members', 'POST', memberUpdates, callback);
};

/**
 * Share a discussion with a number of users and groups. The role of the target principals will be `member`. If
 * any principals in the list already have the discussion in their library, then this will have no impact for
 * that user with no error. Only those who do not have the discussion in their library will be impacted.
 *
 * @param  {RestContext}    restCtx         The context of the current request
 * @param  {String}         discussionId    The id of the discussion to share
 * @param  {String[]}       principalIds    The ids of the principals with which the discussion will be shared
 * @param  {Function}       callback        Invoked when the process completes
 * @param  {Object}         callback.err    An error that occurred, if any
 */
var shareDiscussion = module.exports.shareDiscussion = function(restCtx, discussionId, principalIds, callback) {
    var params = {
        'members': principalIds
    };
    RestUtil.RestRequest(restCtx, '/api/discussion/' + RestUtil.encodeURIComponent(discussionId) + '/share', 'POST', params, callback);
};


/**
 * Remove a discussion from a discussion library. This is its own API method due to special permission handling required, as the user
 * is effectively updating a discussions permissions (removing themselves, or removing it from a group they manage), and they might not
 * necessarily have access to update the permissions of the private discussion (e.g., they are only a member). Also, tenant privacy
 * rules do not come into play in this case.
 *
 * @param  {RestContext}    restCtx         The context of the current request
 * @param  {String}         libraryOwnerId  The owner of the library, should be a principal id (either user or group id)
 * @param  {String}         discussionId    The id of the discussion to remove from the library
 * @param  {Function}       callback        Invoked when the method is complete
 * @param  {Object}         callback.err    An error that occurred, if any
 */
var removeDiscussionFromLibrary = module.exports.removeDiscussionFromLibrary = function(restCtx, libraryOwnerId, discussionId, callback) {
    RestUtil.RestRequest(restCtx, '/api/discussion/library/' + RestUtil.encodeURIComponent(libraryOwnerId) + '/' + RestUtil.encodeURIComponent(discussionId), 'DELETE', null, callback);
};

/**
 * Create a new message in the discussion. If `replyTo` is specified, the message will be a reply to the message
 * in the discussion identified by that timestamp.
 *
 * @param  {RestContext}    restCtx                     The context of the current request
 * @param  {String}         discussionId                The id of the discussion to which to post the message
 * @param  {String}         body                        The body of the message to post
 * @param  {String|Number}  [replyTo]                   The created time of the message to which this is a reply, if applicable
 * @param  {Function}       callback                    Invoked when the process completes
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Message}        callback.message            The message object that was created
 */
var createMessage = module.exports.createMessage = function(restCtx, discussionId, body, replyTo, callback) {
    var params = {
        'body': body,
        'replyTo': replyTo
    };
    RestUtil.RestRequest(restCtx, '/api/discussion/' + RestUtil.encodeURIComponent(discussionId) + '/messages', 'POST', params, callback);
};

/**
 * Get a list of messages from the specified discussion.
 *
 * @param  {RestContext}    restCtx                     The context of the current request
 * @param  {String}         discussionId                The id of the discussion whose messages to fetch
 * @param  {String}         [start]                     The `threadKey` of the message from which to start retrieving messages (exclusively). By default, will start fetching from the most recent message
 * @param  {Number}         [limit]                     The maximum number of results to return. Default: 10
 * @param  {Function}       callback                    Invoked when the process completes
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object}         callback.messages           An object containing the messages returned
 * @param  {Message[]}      callback.messages.results   The list of messages retrieved
 */
var getMessages = module.exports.getMessages = function(restCtx, discussionId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/discussion/' + RestUtil.encodeURIComponent(discussionId) + '/messages', 'GET', params, callback);
};

/**
 * Deletes a message from a discussion. Managers of the discussion can delete all messages while people that have access
 * to the discussion can only delete their own messages. Therefore, anonymous users will never be able to delete messages.
 *
 * @param  {RestContext}    restCtx                 The context of the current request
 * @param  {String}         discussionId            The ID of the discussion from which to delete the message
 * @param  {String}         messageCreated          The timestamp (in millis since the epoch) that the message we wish to delete was created
 * @param  {Function}       callback                Invoked when the process completes
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Comment}        [callback.softDeleted]  When the message has been soft deleted (because it has replies), a stripped down message object representing the deleted message will be returned, with the `deleted` parameter set to `false`. If the message has been deleted from the index, no message object will be returned.
 */
var deleteMessage = module.exports.deleteMessage = function(restCtx, discussionId, messageCreated, callback) {
    RestUtil.RestRequest(restCtx, '/api/discussion/' + RestUtil.encodeURIComponent(discussionId) + '/messages/' + RestUtil.encodeURIComponent(messageCreated), 'DELETE', null, callback);
};

