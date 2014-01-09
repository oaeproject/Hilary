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
 * @param  {String}         displayName         Display name for the created content item
 * @param  {String}         [description]       The content item's description
 * @param  {String}         [visibility]        The content item's visibility. This can be public, loggedin or private
 * @param  {String}         link                The URL that should be stored against this content item
 * @param  {String[]}       [managers]          Array of user/group ids that should be added as managers to the content item
 * @param  {String[]}       [viewers]           Array of user/group ids that should be added as viewers to the content item
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Content}        callback.content    Content object representing the created content
 */
var createLink = module.exports.createLink = function(restCtx, displayName, description, visibility, link, managers, viewers, callback) {
    var params = {
        'resourceSubType': 'link',
        'displayName': displayName,
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
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         displayName         Display name for the created content item
 * @param  {String}         [description]       The content item's description (optional)
 * @param  {String}         [visibility]        The content item's visibility. This can be public, loggedin or private and is optional
 * @param  {Function}       fileGenerator       A function that returns a stream which points to a file body
 * @param  {String[]}       [managers]          An optional array of user/group ids that should be added as managers to the content item
 * @param  {String[]}       [viewers]           An optional array of user/group ids that should be added as viewers to the content item
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Content}        callback.content    Content object representing the created content
 */
var createFile = module.exports.createFile = function(restCtx, displayName, description, visibility, fileGenerator, managers, viewers, callback) {
    var params = {
        'resourceSubType': 'file',
        'displayName': displayName,
        'description': description,
        'visibility': visibility,
        'file': fileGenerator,
        'managers': managers,
        'viewers': viewers
    };
    RestUtil.RestRequest(restCtx, '/api/content/create', 'POST', params, callback);
};

/**
 * Create a new collaborative document through the REST API.
 *
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       displayName         Display name for the created content item
 * @param  {String}       [description]       The content item's description
 * @param  {String}       [visibility]        The content item's visibility. This can be public, loggedin or private
 * @param  {String[]}     [managers]          Array of user/group ids that should be added as managers to the content item
 * @param  {String[]}     [viewers]           Array of user/group ids that should be added as viewers to the content item
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 * @param  {Content}      callback.content    Content object representing the created content
 */
var createCollabDoc = module.exports.createCollabDoc = function(restCtx, displayName, description, visibility, managers, viewers, callback) {
    var params = {
        'resourceSubType': 'collabdoc',
        'displayName': displayName,
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
 * @param  {Content}      callback.content    The updated content object
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
 * @param  {Comment}      callback.comment    The created comment
 */
var createComment = module.exports.createComment = function(restCtx, contentId, body, replyTo, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/messages', 'POST', {'body': body, 'replyTo': replyTo}, callback);
};

/**
 * Deletes a comment from a content item
 *
 * @param  {RestContext}  restCtx                  Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       contentId                Content id of the content item we're trying to delete a comment from
 * @param  {String}       created                  The timestamp (in millis since the epoch) that the comment to delete was created
 * @param  {Function}     callback                 Standard callback method
 * @param  {Object}       callback.err             Error object containing error code and error message
 * @param  {Comment}      [callback.softDeleted]   If the comment is not deleted, but instead flagged as deleted because it has replies, this will return a stripped down comment object representing the deleted comment will be returned, with the `deleted` parameter set to `false`.. If the comment has been properly deleted, no comment will be returned.
 */
var deleteComment = module.exports.deleteComment = function(restCtx, contentId, created, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/messages/' + RestUtil.encodeURIComponent(created), 'DELETE', null, callback);
};

/**
 * Gets the comments on a content item
 *
 * @param  {RestContext}  restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}       contentId           Content id of the content item we're trying to get comments for
 * @param  {String}       start               Determines the point at which content items are returned for paging purposed.
 * @param  {Number}       limit               Number of items to return.
 * @param  {Function}     callback            Standard callback method
 * @param  {Object}       callback.err        Error object containing error code and error message
 * @param  {Comment[]}    callback.comments   Array of comments on the content item
 */
var getComments = module.exports.getComments = function(restCtx, contentId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/messages', 'GET', params, callback);
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
 * Removes a piece of content from a principal library.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         principalId         User or group id for who we wish to remove a piece of content from the library
 * @param  {[type]}         contentId           Content id of the content item we're trying to remove from the library
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 */
var removeContentFromLibrary = module.exports.removeContentFromLibrary = function(restCtx, principalId, contentId, callback) {
    var url = '/api/content/library/' + RestUtil.encodeURIComponent(principalId) + '/' + RestUtil.encodeURIComponent(contentId);
    RestUtil.RestRequest(restCtx, url, 'DELETE', null, callback);
};

/**
 * Get the revisions for a piece of content.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to retrieve the revisions for
 * @param  {String}         [start]             The created timestampto start from (this will not be included in the response).
 * @param  {Number}         [limit]             The number of revisions to retrieve.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Revision[]}     callback.items      Array of revisions
 */
var getRevisions = module.exports.getRevisions = function(restCtx, contentId, start, limit, callback) {
    var params = {
        'start': start,
        'limit': limit
    };
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/revisions', 'GET', params, callback);
};

/**
 * Get a specific revision for a piece of content.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to retrieve the revision for
 * @param  {String}         revisionId          The id of the revision to retrieve.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Revision}       callback.revision   Revision object representing the retrieved revision.
 */
var getRevision = module.exports.getRevision = function(restCtx, contentId, revisionId, callback) {
    var url = '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/revisions/' + RestUtil.encodeURIComponent(revisionId);
    RestUtil.RestRequest(restCtx, url, 'GET', null, callback);
};

/**
 * Restore a specific revision for a piece of content.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to restore the revision for
 * @param  {String}         revisionId          The id of the revision to restore.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 */
var restoreRevision = module.exports.restoreRevision = function(restCtx, contentId, revisionId, callback) {
    var url = '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/revisions/' + RestUtil.encodeURIComponent(revisionId) + '/restore';
    RestUtil.RestRequest(restCtx, url, 'POST', null, callback);
};

/**
 * Upload a new version of a file.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to update
 * @param  {Function}       file                A function that returns a stream which points to a file body
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 * @param  {Content}        callback.content    The full content profile of the content item updated
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
    /*!
     * Performs the correct HTTP request to download a file.
     * This function assumes a proper cookiejar can be found on the RestContext objext.
     */
    var downloadFile = function() {
        var url = restCtx.host + '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/download';
        if (revisionId) {
            url += '/' + revisionId;
        }

        var requestParams = {
            'url': url,
            'method': 'GET',
            'jar': restCtx.cookieJar,
            'strictSSL': restCtx.strictSSL
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
    };

    // We can't use the RestUtil.RestRequest utility to wrap our requests as we're dealing with streams.
    // This leads to annoying problems with cookiejars who might or might not be filled up.
    // Check if we have a jar and perform the request if we have one.
    // If we don't have one, try to fill it up.
    if (restCtx.cookieJar) {
        downloadFile();
    } else {
        // No jar was present, create one.
        restCtx.cookieJar = request.jar();

        // If the restContext is not anonymous, we need to fill it up.
        RestUtil.fillCookieJar(restCtx, function(err) {
            if (err) {
                return callback(err);
            }
            downloadFile();
        });
    }
};

/**
 * Publish a collaborative document.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to publish.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 */
var publishCollabDoc = module.exports.publishCollabDoc = function(restCtx, contentId, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/publish', 'POST', null, callback);
};

/**
 * Join a collaborative document.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to join.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message.
 * @param  {String}         callback.url        The URL where the etherpad instance for the collaborative document is available.
 */
var joinCollabDoc = module.exports.joinCollabDoc = function(restCtx, contentId, callback) {
    RestUtil.RestRequest(restCtx, '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/join', 'POST', null, callback);
};

/**
 * Set one or multiple preview items.
 * Note: This method is only useful to a global administrator and should be performed against the global server.
 * The previous previews will be removed.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to retrieve the list of preview items from.
 * @param  {String}         revisionId          Revision id of the content item we're trying to retrieve the list of preview items from.
 * @param  {String}         status              The status of the preview generation. One of 'error', 'done' or 'pending'.
 * @param  {Object}         files               A hash where the key is the filename and the value is a function that returns a stream for a preview item.
 * @param  {Object}         sizes               A hash where the key is the filename and the value is a string that represents the preview size of the item. It should be one of 'small', 'medium', 'large', 'activity' or 'thumbnail'.
 * @param  {Object}         [contentMetadata]   Extra optional content metadata.
 * @param  {Object}         [previewMetadata]   Extra optional preview metadata.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 */
var setPreviewItems = module.exports.setPreviewItems = function(restCtx, contentId, revisionId, status, files, sizes, contentMetadata, previewMetadata, callback) {
    previewMetadata = previewMetadata || {};
    contentMetadata = contentMetadata || {};
    var params = {
        'status': status,
        'sizes': {},
        'links': {},
        'previewMetadata': JSON.stringify(previewMetadata),
        'contentMetadata': JSON.stringify(contentMetadata)
    };

    // Add the files and their sizes to the parameters.
    Object.keys(files).forEach(function(filename) {
        if (_.isString(files[filename])) {
            params.links[filename] = files[filename];
        } else {
            params[filename] = files[filename];
        }
        params.sizes[filename] = sizes[filename];
    });
    params.links = JSON.stringify(params.links);
    params.sizes = JSON.stringify(params.sizes);
    var url = '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/revisions/' + RestUtil.encodeURIComponent(revisionId) + '/previews';
    RestUtil.RestRequest(restCtx, url, 'POST', params, callback);
};

/**
 * Get a list of preview items and a signature to download each one of them.
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId           Content id of the content item we're trying to retrieve the preview items.
 * @param  {String}         revisionId          Revision id of the preview items.
 * @param  {Function}       callback            Standard callback method
 * @param  {Object}         callback.err        Error object containing error code and error message
 */
var getPreviewItems = module.exports.getPreviewItems = function(restCtx, contentId, revisionId, callback) {
    var url = '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/revisions/' + RestUtil.encodeURIComponent(revisionId) + '/previews';
    RestUtil.RestRequest(restCtx, url, 'GET', {}, callback);
};

/**
 * Download a preview item
 *
 * @param  {RestContext}    restCtx                 Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         contentId               Content id of the content item we're trying to download a preview item from.
 * @param  {String}         revisionId              Revision id for the preview item.
 * @param  {String}         previewItem             The preview item.
 * @param  {Object}         signature               A signature that validates this call.
 * @param  {String}         signature.signature     A signature that validates this call.
 * @param  {Number}         signature.expires       When the signature expires (in millis since epoch.)
 * @param  {Number}         signature.lastModified  When the signature expires (in millis since epoch.)
 * @param  {Function}       callback                Standard callback method
 * @param  {Object}         callback.err            Error object containing error code and error message
 * @param  {Object}         callback.body           The body of the response.
 */
var downloadPreviewItem = module.exports.downloadPreviewItem = function(restCtx, contentId, revisionId, previewItem, signature, callback) {
    var url = '/api/content/' + RestUtil.encodeURIComponent(contentId) + '/revisions/' + RestUtil.encodeURIComponent(revisionId) + '/previews/';
    url += RestUtil.encodeURIComponent(previewItem);
    var params = {
        'signature': signature.signature,
        'expires': signature.expires,
        'lastmodified': signature.lastModified
    };
    RestUtil.RestRequest(restCtx, url, 'GET', params, callback);
};

