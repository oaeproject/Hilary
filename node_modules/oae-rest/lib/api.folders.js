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

var _ = require('underscore');

var RestUtil = require('./util');

/**
 * Get a folder by its id
 *
 * @param  {RestContext}    restCtx             The context of the current request
 * @param  {String}         folderId            The id of the folder to retrieve
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error object, if any
 * @param  {Folder}         callback.folder     The retrieved folder
 */
var getFolder = module.exports.getFolder = function(restCtx, folderId, callback) {
    RestUtil.RestRequest(restCtx, '/api/folder/' + RestUtil.encodeURIComponent(folderId), 'GET', null, callback);
};

/**
 * Create a folder
 *
 * @param  {RestContext}    restCtx             The context of the current request
 * @param  {String}         displayName         The name for the new folder
 * @param  {String}         description         The description for the new folder
 * @param  {String}         visibility          The visibliity for the new visibility
 * @param  {String[]}       managers            The ids of the users and/or groups who can manage the new folder
 * @param  {String[]}       viewers             The ids of the users and/or groups who can view the new folder
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error object, if any
 * @param  {Folder}         callback.folder     The created folder
 */
var createFolder = module.exports.createFolder = function(restCtx, displayName, description, visibility, managers, viewers, callback) {
    var params = {
        'displayName': displayName,
        'description': description,
        'visibility': visibility,
        'managers': managers,
        'viewers': viewers
    };
    RestUtil.RestRequest(restCtx, '/api/folder', 'POST', params, callback);
};

/**
 * Update a folder
 *
 * @param  {Restcotext}    restCtx                         The context of the current request
 * @param  {String}         folderId                        The id of the folder that should be updated
 * @param  {Object}         updates                         The updates that should be made
 * @param  {String}         [updates.displayName]           The new display name for the folder
 * @param  {String}         [updates.description]           The new description for the folder
 * @param  {String}         [updates.visibility]            The new visibility for the folder
 * @param  {String}         [updates.applyVisibilityOn]     Expresses whether the visibility should be applied on the content items in the folder. One of `folder` or `folderAndContent`
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error object, if any
 */
var updateFolder = module.exports.updateFolder = function(restCtx, folderId, updates, callback) {
    RestUtil.RestRequest(restCtx, '/api/folder/' + RestUtil.encodeURIComponent(folderId), 'POST', updates, callback);
};

/**
 * Update a folder's content items
 *
 * @param  {RestContext}    restCtx                         The context of the current request
 * @param  {String}         folderId                        The id of the folder whose content items should be updated
 * @param  {String}         visibility                      The new visibility for the content items in the folder
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error object, if any
 */
var updateFolderContentVisibility = module.exports.updateFolderContentVisibility = function(restCtx, folderId, visibility, callback) {
    var params = {'visibility': visibility};
    var url = '/api/folder/' + RestUtil.encodeURIComponent(folderId) + '/contentvisibility';
    RestUtil.RestRequest(restCtx, url, 'POST', params, callback);
};

/**
 * Delete a folder
 *
 * @param  {RestContext}    restCtx                         The context of the current request
 * @param  {String}         folderId                        The id of the folder that should be removed
 * @param  {Boolean}        deleteContent                   whether or not to delete the content in the folder as well
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error object, if any
 */
var deleteFolder = module.exports.deleteFolder = function(restCtx, folderId, deleteContent, callback) {
    var params = {
        'deleteContent': deleteContent
    };
    RestUtil.RestRequest(restCtx, '/api/folder/' + RestUtil.encodeURIComponent(folderId), 'DELETE', params, callback);
};

/**
 * Share a folder with one or more users and groups
 *
 * @param  {RestContext}    restCtx             The context of the current request
 * @param  {String}         folderId            The id of the folder that should be shared
 * @param  {String[]}       principalIds        The ids of the users and/or groups with whom the folder should be shared
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error object, if any
 */
var shareFolder = module.exports.shareFolder = function(restCtx, folderId, principalIds, callback) {
    RestUtil.RestRequest(restCtx, '/api/folder/' + RestUtil.encodeURIComponent(folderId) + '/share', 'POST', {'viewers': principalIds}, callback);
};

/**
 * Update a folder's members
 *
 * @param  {RestContext}    restCtx             The context of the current request
 * @param  {String}         folderId            The id of the folder for which the members should be updated
 * @param  {Object}         memberUpdates       An object where the keys hold the user and/or group ids and the values hold the new role for the principal. Setting a value to `false` will remove the user/group
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error object, if any
 */
var updateFolderMembers = module.exports.updateFolderMembers = function(restCtx, folderId, memberUpdates, callback) {
    RestUtil.RestRequest(restCtx, '/api/folder/' + RestUtil.encodeURIComponent(folderId) + '/members', 'POST', memberUpdates, callback);
};

/**
 * Get the members for a folder
 *
 * @param  {RestContext}    restCtx                         The context of the current request
 * @param  {String}         folderId                        The id of the folder for which the members should be updated
 * @param  {String}         [start]                         The id of the principal from which to begin the page of results (exclusively). By default, begins from the first in the list.
 * @param  {Number}         [limit]                         The maximum number of results to return. Default: 10
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error object, if any
 * @param  {Object[]}       callback.members                Array that contains an object for each member
 * @param  {String}         callback.members[i].role        The role of the member at index `i`
 * @param  {User|Group}     callback.members[i].profile     The principal profile of the member at index `i`
 */
var getFolderMembers = module.exports.getFolderMembers = function(restCtx, folderId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/folder/' + RestUtil.encodeURIComponent(folderId) + '/members', 'GET', params, callback);
};

/**
 * Get the folders that a principal is a member or manager for
 *
 * @param  {RestContext}    restCtx                         The context of the current request
 * @param  {String}         principalId                     The id of the principal for whom to retrieve the folders
 * @param  {String}         [start]                         The id of the folder from which to begin the page of results (exclusively). By default, begins from the first in the list.
 * @param  {Number}         [limit]                         The maximum number of results to return. Default: 10
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error object, if an
 * @param  {Object}         callback.result                 Holds the result set
 * @param  {Folder[]}       callback.result.results         Holds the returned folder
 * @param  {String}         callback.result.nextToken       Holds the folder id that should be used if the next page of folders needs to be retrieved
 */
var getFoldersLibrary = module.exports.getFoldersLibrary = function(restCtx, principalId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/folder/library/' + RestUtil.encodeURIComponent(principalId), 'GET', params, callback);
};

/**
 * Get the folders the current user manages
 *
 * @param  {RestContext}    restCtx             The context of the current request
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error object, if any
 * @param  {Folder[]}       callback.folders    The folders the current user manages
 */
var getManagedFolders = module.exports.getManagedFolders = function(restCtx, callback) {
    RestUtil.RestRequest(restCtx, '/api/folder/managed', 'GET', null, callback);
};

/**
 * Remove a folder from a principal library
 *
 * @param  {RestContext}    restCtx         The context of the current request
 * @param  {String}         principalId     The id of the principal from which to remove the folder
 * @param  {String}         folderId        The id of the folder that needs to be removed
 * @param  {String[]}       contentIds      One or more ids of content items that should be added to the folder
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error object, if any
 */
var removeFolderFromLibrary = module.exports.removeFolderFromLibrary = function(restCtx, principalId, folderId, callback) {
    var url = '/api/folder/library';
    url += '/' + RestUtil.encodeURIComponent(principalId);
    url += '/' + RestUtil.encodeURIComponent(folderId);
    RestUtil.RestRequest(restCtx, url, 'DELETE', null, callback);
};

/**
 * Add one or more content items to a folder
 *
 * @param  {RestContext}    restCtx         The context of the current request
 * @param  {String}         folderId        The id of the folder that the content items need to be added to
 * @param  {String[]}       contentIds      One or more ids of content items that should be added to the folder
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error object, if any
 */
var addContentItemsToFolder = module.exports.addContentItemsToFolder = function(restCtx, folderId, contentIds, callback) {
    RestUtil.RestRequest(restCtx, '/api/folder/' + RestUtil.encodeURIComponent(folderId) + '/library', 'POST', {'contentIds': contentIds}, callback);
};

/**
 * Remove one or more content items from a folder
 *
 * @param  {RestContext}    restCtx         The context of the current request
 * @param  {String}         folderId        The id of the folder that the content items need to be removed from
 * @param  {String[]}       contentIds      One or more ids of content items that should be removed from the folder
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error object, if any
 */
var removeContentItemsFromFolder = module.exports.removeContentItemsFromFolder = function(restCtx, folderId, contentIds, callback) {
    RestUtil.RestRequest(restCtx, '/api/folder/' + RestUtil.encodeURIComponent(folderId) + '/library', 'DELETE', {'contentIds': contentIds}, callback);
};

/**
 * Get the content items in a folder
 *
 * @param  {RestContext}    restCtx                         The context of the current request
 * @param  {String}         folderId                        The id of the folder that should be listed
 * @param  {String}         [start]                         The id of the content item from which to begin the page of results (exclusively). By default, begins from the first in the list.
 * @param  {Number}         [limit]                         The maximum number of results to return. Default: 10
 * @param  {Function}       callback                        Standard callback function
 * @param  {Object}         callback.err                    An error object, if any
 * @param  {Object}         callback.result                 Holds the result set
 * @param  {Content[]}      callback.result.results         Holds the returned content items
 * @param  {String}         callback.result.nextToken       Holds the content id that should be used if the next page of content items needs to be retrieved
 */
var getFolderContentLibrary = module.exports.getFolderContentLibrary = function(restCtx, folderId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/folder/' + RestUtil.encodeURIComponent(folderId) + '/library', 'GET', params, callback);
}
;
/**
 * Create a new message in the folder. If `replyTo` is specified, the message will be a reply to the message
 * in the folder identified by that timestamp.
 *
 * @param  {RestContext}    restCtx                     The context of the current request
 * @param  {String}         folderId                    The id of the folder to which to post the message
 * @param  {String}         body                        The body of the message to post
 * @param  {String|Number}  [replyTo]                   The created time of the message to which this is a reply, if applicable
 * @param  {Function}       callback                    Invoked when the process completes
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Message}        callback.message            The message object that was created
 */
var createMessage = module.exports.createMessage = function(restCtx, folderId, body, replyTo, callback) {
    var params = {
        'body': body,
        'replyTo': replyTo
    };
    RestUtil.RestRequest(restCtx, '/api/folder/' + RestUtil.encodeURIComponent(folderId) + '/messages', 'POST', params, callback);
};

/**
 * Get a list of messages from the specified folder.
 *
 * @param  {RestContext}    restCtx                     The context of the current request
 * @param  {String}         folderId                    The id of the folder whose messages to fetch
 * @param  {String}         [start]                     The `threadKey` of the message from which to start retrieving messages (exclusively). By default, will start fetching from the most recent message
 * @param  {Number}         [limit]                     The maximum number of results to return. Default: 10
 * @param  {Function}       callback                    Invoked when the process completes
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object}         callback.messages           An object containing the messages returned
 * @param  {Message[]}      callback.messages.results   The list of messages retrieved
 */
var getMessages = module.exports.getMessages = function(restCtx, folderId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/folder/' + RestUtil.encodeURIComponent(folderId) + '/messages', 'GET', params, callback);
};

/**
 * Deletes a message from a folder. Managers of the folder can delete all messages while people that have access
 * to the folder can only delete their own messages. Therefore, anonymous users will never be able to delete messages.
 *
 * @param  {RestContext}    restCtx                 The context of the current request
 * @param  {String}         folderId                The ID of the folder from which to delete the message
 * @param  {String}         messageCreated          The timestamp (in millis since the epoch) that the message we wish to delete was created
 * @param  {Function}       callback                Invoked when the process completes
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Comment}        [callback.softDeleted]  When the message has been soft deleted (because it has replies), a stripped down message object representing the deleted message will be returned, with the `deleted` parameter set to `false`. If the message has been deleted from the index, no message object will be returned.
 */
var deleteMessage = module.exports.deleteMessage = function(restCtx, folderId, messageCreated, callback) {
    RestUtil.RestRequest(restCtx, '/api/folder/' + RestUtil.encodeURIComponent(folderId) + '/messages/' + RestUtil.encodeURIComponent(messageCreated), 'DELETE', null, callback);
};
