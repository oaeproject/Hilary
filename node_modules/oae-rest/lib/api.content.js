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
var _ = require('underscore');
var RestUtil = require('./util');

/**
 * Get a full content profile through the REST API.
 * 
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       contentId           Content id of the content item we're trying to retrieve
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 * @param  {Content}      callback.content    Content object representing the retrieved content
 */
var getContent = module.exports.getContent = function(restCtx, contentId, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId), 'GET', null, callback);
};

/**
 * Create a new link through the REST API.
 * 
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         name                Display title for the created content item
 * @param  {String}         description         The content item's description
 * @param  {String}         visibility          The content item's visibility. This can be public, loggedin or private
 * @param  {String}         link                The URL that should be stored against this content item
 * @param  {String[]}       managers            Array of user/group ids that should be added as managers to the content item
 * @param  {String[]}       viewers             Array of user/group ids that should be added as viewers to the content item
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Content}        callback.content    Content object representing the created content
 */
var createLink = module.exports.createLink = function(restCtx, name, description, visibility, link, managers, viewers, callback) {
    var params = {
        'contentType': 'link',
        'name': name,
        'description': description,
        'visibility': visibility,
        'link': link,
        'managers': managers,
        'viewers': viewers
    };
    RestUtil.RestRequest(restCtx, '/api/content/create', 'POST', params, callback);
};

/**
 * Create a new file through the REST API.
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         name                Display title for the created content item
 * @param  {String}         description         The content item's description
 * @param  {String}         visibility          The content item's visibility. This can be public, loggedin or private
 * @param  {Function}       fileGenerator       A function that returns a stream which points to a file body.
 * @param  {String[]}       managers            Array of user/group ids that should be added as managers to the content item
 * @param  {String[]}       viewers             Array of user/group ids that should be added as viewers to the content item
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Content}        callback.content    Content object representing the created content
 */
var createFile = module.exports.createFile = function(restCtx, name, description, visibility, fileGenerator, managers, viewers, callback) {
    var params = {
        'contentType': 'file',
        'name': name,
        'description': description,
        'visibility': visibility,
        'file': fileGenerator,
        'managers': managers,
        'viewers': viewers
    };
    RestUtil.RestRequest(restCtx, '/api/content/create', 'POST', params, callback);
};

/**
 * Create a new Sakai Doc through the REST API.
 * 
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       name                Display title for the created content item
 * @param  {String}       description         The content item's description
 * @param  {String}       visibility          The content item's visibility. This can be public, loggedin or private
 * @param  {String[]}     managers            Array of user/group ids that should be added as managers to the content item
 * @param  {String[]}     viewers             Array of user/group ids that should be added as viewers to the content item
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 * @param  {Content}      callback.content    Content object representing the created content
 */
var createSakaiDoc = module.exports.createSakaiDoc = function(restCtx, name, description, visibility, managers, viewers, callback) {
    var params = {
        'contentType': 'sakaidoc',
        'name': name,
        'description': description,
        'visibility': visibility,
        'managers': managers,
        'viewers': viewers
    };
    RestUtil.RestRequest(restCtx, '/api/content/create', 'POST', params, callback);
};

/**
 * Update a content item's metadata through the REST API.
 * 
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       contentId           Content id of the content item we're trying to update
 * @param  {Object}       params              JSON object where the keys represent all of the profile field names we want to update and the values represent the new values for those fields
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 */
var updateContent = module.exports.updateContent = function(restCtx, contentId, params, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId), 'POST', params, callback);
};

/**
 * Delete a content item through the REST API.
 * 
 * @param  {RestContext}   restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}        contentId           Content id of the content item we're trying to delete
 * @param  {Function}      callback            Standard callback method
 * @param  {Object}        callback.err        Error object containing error code and error message
 */
var deleteContent = module.exports.deleteContent = function(restCtx, contentId, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId), 'DELETE', null, callback);
};

/**
 * Get the viewers and managers of a content item through the REST API.
 * 
 * @param  {RestContext}     restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}          contentId           Content id of the content item we're trying to retrieve the members for
 * @param  {String}          start               The principal id to start from (this will not be included in the response)
 * @param  {Number}          limit               The number of members to retrieve.
 * @param  {Function}        callback            Standard callback method
 * @param  {Object}          callback.err        Error object containing error code and error message
 * @param  {User[]|Group[]}  callback.members    Array that contains an object for each member. Each object has a role property that contains the role of the member and a profile property that contains the principal profile of the member
 */
var getMembers = module.exports.getMembers = function(restCtx, contentId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/members', 'GET', params, callback);
};

/**
 * Change the members and managers of a content item through the REST API.
 * 
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       contentId           Content id of the content item we're trying to update the members for
 * @param  {Object}       updatedMembers      JSON Object where the keys are the user/group ids we want to update membership for, and the values are the roles these members should get (manager or viewer). If false is passed in as a role, the principal will be removed as a member
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 */
var updateMembers = module.exports.updateMembers = function(restCtx, contentId, updatedMembers, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/members', 'POST', updatedMembers, callback);
};

/**
 * Share a content item through the REST API.
 * 
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       contentId           Content id of the content item we're trying to share
 * @param  {String[]}     principals          Array of principal ids with who the content should be shared
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 */
var shareContent = module.exports.shareContent = function(restCtx, contentId, principals, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/share', 'POST', {'viewers': principals}, callback);
};

/**
 * Creates a comment on a content item or a reply to another comment if the `replyTo` parameter is specified
 *
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       contentId           Content id of the content item we're trying to comment on
 * @param  {String}       body                The comment to be placed on the content item
 * @param  {String}       [replyTo]           Id of the comment to reply to
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 */
var createComment = module.exports.createComment = function(restCtx, contentId, body, replyTo, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/comments', 'POST', {'body': body, 'replyTo': replyTo}, callback);
};

/**
 * Deletes a comment from a content item
 *
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       contentId           Content id of the content item we're trying to delete a comment from
 * @param  {String}       commentId           The ID of the comment to delete
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 */
var deleteComment = module.exports.deleteComment = function(restCtx, contentId, commentId, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/comments/' + RestUtil.encodeURIComponent(commentId), 'DELETE', null, callback);
};

/**
 * Gets the comments on a content item
 *
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       contentId           Content id of the content item we're trying to get comments for
 * @param  {String}       start               Determines the point at which content items are returned for paging purposed.
 * @param  {Integer}      limit               Number of items to return.
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 * @param  {Comment[]}    callback.comments   Array of comments on the content item
 */
var getComments = module.exports.getComments = function(restCtx, contentId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/comments', 'GET', params, callback);
};

/**
 * Get a principal library through the REST API.
 * 
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         principalId         User or group id for who we want to retrieve the library
 * @param  {String}         start               The content id to start from (this will not be included in the response)
 * @param  {Number}         limit               The number of content items to retrieve.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Content[]}      callback.items      Array of content items representing the content items present in the library
 */
var getLibrary = module.exports.getLibrary = function(restCtx, principalId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/content/library/' + RestUtil.encodeURIComponent(principalId), 'GET', params, callback);
};

/**
 * Get the revisions for a piece of content.
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to retrieve the revisions for
 * @param  {String}         start               The revision id to start from (this will not be included in the response)
 * @param  {Number}         limit               The number of revisions to retrieve.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Content[]}      callback.items      Array of revisions
 */
var getRevisions = module.exports.getRevisions = function(restCtx, contentId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/revisions', 'GET', params, callback);
};

/**
 * Update the filebody for a sakai file.
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to update
 * @param  {Function}       file                A function that returns a stream which points to a file body.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Content[]}      callback.items      Array of revisions
 */
var updateFileBody = module.exports.updateFileBody = function(restCtx, contentId, file, callback) {
    var params = {
        'file': file
    };
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/newversion', 'POST', params, callback);
};

/**
 * Download a file body
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to update
 * @param  {String}         revisionId          Revision id of the content you wish to download, leave null to download the latest version.
 * @param  {Boolean}        followRedirects     Follow redirects that are sent back from the server, defaults to true.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 */
var download = module.exports.download = function(restCtx, contentId, revisionId, followRedirects, callback) {
    var params = {};
    // Only pass in the follow redirects if it's true.
    if (_.isBoolean(followRedirects)) {
        params.options = {};
        params.options['_followRedirects'] = followRedirects;
    }
    var url = '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/download';
    if (revisionId) {
        url += '/' + revisionId;
    }
    RestUtil.RestRequest(restCtx, url, 'GET', params, callback);
};
