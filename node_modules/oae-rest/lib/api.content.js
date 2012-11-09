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
var fs = require('fs');
var request = require('request');

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
 * @param  {String}         [description]       The content item's description
 * @param  {String}         [visibility]        The content item's visibility. This can be public, loggedin or private
 * @param  {String}         link                The URL that should be stored against this content item
 * @param  {String[]}       [managers]          Array of user/group ids that should be added as managers to the content item
 * @param  {String[]}       [viewers]           Array of user/group ids that should be added as viewers to the content item
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
 * @param  {String}         [description]       The content item's description (optional)
 * @param  {String}         [visibility]        The content item's visibility. This can be public, loggedin or private and is optional.
 * @param  {Function}       fileGenerator       A function that returns a stream which points to a file body.
 * @param  {String[]}       [managers]          An optional array of user/group ids that should be added as managers to the content item
 * @param  {String[]}       [viewers]           An optional array of user/group ids that should be added as viewers to the content item
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
 * @param  {String}       [description]       The content item's description
 * @param  {String}       [visibility]        The content item's visibility. This can be public, loggedin or private
 * @param  {String[]}     [managers]          Array of user/group ids that should be added as managers to the content item
 * @param  {String[]}     [viewers]           Array of user/group ids that should be added as viewers to the content item
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
 * @param  {Object}       callback.response   If the comment is not deleted, but instead flagged as deleted because it has replies, this will return {'deleted': false}. If the comment has been properly deleted, this will return {'deleted': true}.
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
 * Download a file body to a path.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to download
 * @param  {String}         revisionId          Revision id of the content you wish to download, leave null to download the latest version.
 * @param  {String}         path                The path where the file can be stored. It's up to the caller to remove the file (if any) on errors.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Response}       callback.response   The requestjs response object.
 */
var download = module.exports.download = function(restCtx, contentId, revisionId, path, callback) {
    // We can't use the RestUtil.RestRequest utility to wrap our requests as we're dealing with streams.
    RestUtil.getJar(restCtx, function(err, jar) {
        if (err) {
            return callback(err);
        }

        var url = restCtx.host + '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/download';
        if (revisionId) {
            url += '/' + revisionId;
        }

        var requestParams = {
            'url': url,
            'method': 'GET',
            'jar': jar
        };
        if (restCtx.hostHeader) {
            requestParams.headers = {
                'host': restCtx.hostHeader
            };
        }
        var called = false;
        var response = null;
        var writeStream = fs.createWriteStream(path);
        writeStream.once('close', function() {
            // We got the file successfully.
            // Destroy the stream and notify the caller.
            writeStream.removeAllListeners();
            writeStream.destroy();
            if (!called) {
                called = true;
                callback(null, response);
            }
        });

        writeStream.once('error', function(err) {
            // Something went wrong with trying to store the file on disk.
            // Destroy the stream and notify the caller.
            writeStream.removeAllListeners();
            writeStream.destroy();

            if (!called) {
                called = true;
                callback(err, response);
            }
        });

        // Make the request
        var req = request(requestParams);

        // Pipe the response to the stream.
        req.pipe(writeStream);

        // requestjs emits a 'response' event with the response object.
        // In combination with the writeStream and requestjs `end` event we can call the callback with the
        // appropriate error and response parameters.
        req.on('response', function(_response) {
            response = _response;
        });

        req.on('end', function() {
            // If we get anything besides a 200 or 204, it's an error.
            if ([200, 204].indexOf(response.statusCode) === -1 && !called) {
                called = true;
                callback({'code': response.statusCode, 'msg': 'Unable to download the file.'});
            }
        });
    });
};


/**
 * Add one or multiple preview items.
 * Note: This method is only useful to a global administrator and should be performed against the global server.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to retrieve the list of preview items from.
 * @param  {String}         status              The status of the preview generation. One of 'error', 'done' or 'pending'.
 * @param  {Object}         files               A hash where the key is the filename and the value is a sub-object which has 2 keys. A sub-object should have a key 'file' which maps to a function that returns a stream for a preview item and a key 'size' which has a value 'small', 'normal', 'large' or 'thumbnail'.
 * @param  {Object}         [metadata]          Extra optional metadata.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 */
var addPreviewItems = module.exports.addPreviewItems = function(restCtx, contentId, status, files, metadata, callback) {
    metadata = metadata || {};
    var params = {
        'status': status
    };
    // The files
    var keys = Object.keys(files);
    for (var i = 0; i < keys.length; i++) {
        params[keys[i]] = files[keys[i]].file;
        params['size_' + keys[i]] = files[keys[i]].size;
    }
    // any extra metadata.
    var meta_keys = Object.keys(metadata);
    for (var i = 0; i < meta_keys.length; i++) {
        params[meta_keys[i]] = metadata[meta_keys[i]];
    }
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/previews', 'POST', params, callback);
};

/**
 * Get a list of preview items and a signature to download each one of them.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to retrieve the preview items.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 */
var getPreviewItems = module.exports.getPreviewItems = function(restCtx, contentId, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/previews', 'GET', {}, callback);
};

/**
 * Download a preview item
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to download a preview item from.
 * @param  {String}         previewItem         The preview item.
 * @param  {String}         signature           The signature as returned by `getPreviewItems`.
 * @param  {Number}         expires             The timestamp when the signature expires.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Object}         callback.body       The body of the response.
 */
var downloadPreviewItem = module.exports.downloadPreviewItem = function(restCtx, contentId, previewItem, signature, expires, callback) {
    var url = '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/previews/';
    url += RestUtil.encodeURIComponent(previewItem);
    var params = {
        'signature': signature,
        'expires': expires
    };
    RestUtil.RestRequest(restCtx, url, 'GET', params, callback);
};
