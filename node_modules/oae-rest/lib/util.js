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

var request = require('request');
var Stream = require('stream').Stream

// Array of response codes that are considered to be HTTP errors
var errorCodes = [400, 401, 403, 404, 500, 503];
// Variable that will keep track of a cookie jar per user, so we can continue to
// use the user's session throughout the tests
var cookies = {};

/**
 * Function that will perform a REST request using the Node.js request module. It will check whether
 * or not the request should be authenticated, for which it will check the presence of a Cookie Jar
 * for that user. If no cookie jar exists, the user will be logged in first. After that, the actual
 * request will be made by the internal _RestRequest function
 * @param  {RestContext}                 restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                          user credentials
 * @param  {String}         url                 The URL of the REST endpoint that should be called
 * @param  {String}         method              The HTTP method that should be used for the request (i.e. GET or POST)
 * @param  {Object}         data                The form data that should be passed into the request [optional]       
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        Error object containing the error code and message
 * @param  {String|Object}  callback.response   The response received from the request. If this is JSON, a parsed JSON object will be returned, otherwise the response will be returned as a string
 */
var RestRequest = module.exports.RestRequest = function(restCtx, url, method, data, callback) {
    // Check if the request should be done by a logged in user
    if (restCtx.userId) {
        // Check if we already have a stored session for this user
        if (cookies[restCtx.baseUrl + '-' + restCtx.userId]) {
            _RestRequest(restCtx, url, method, data, callback);
        // Otherwise, we log the user in first
        } else {
            // Set up an empty cookie jar for this user
            cookies[restCtx.baseUrl + '-' + restCtx.userId] = request.jar();
            // Log the user in
            _RestRequest(restCtx, '/api/auth/login', 'POST', {
                'username': restCtx.userId,
                'password': restCtx.userPassword
            }, function(err, response) {
                if (err) {
                    return callback(err);
                }
                // Execute the original REST request
                _RestRequest(restCtx, url, method, data, callback);
            });
        }
    // Just make the request
    } else {
        _RestRequest(restCtx, url, method, data, callback);
    }
};

/**
 * Internal Function that will perform a REST request. If no user is provided, the request will be done anonymously
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         url                 The URL of the REST endpoint that should be called
 * @param  {String}         method              The HTTP method that should be used for the request (i.e. GET or POST)
 * @param  {Object}         data                The form data that should be passed into the request [optional]       
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        Error object containing the error code and message
 * @param  {String|Object}  callback.response   The response received from the request. If this is JSON, a parsed JSON object will be returned, otherwise the response will be returned as a string
 */
var _RestRequest = function(restCtx, url, method, data, callback) {
    var j = request.jar();
    if (restCtx.userId) {
        // Create a composite of URL and userid to make sure that userids
        // don't collide accross tenants
        j = cookies[restCtx.baseUrl + '-' + restCtx.userId];
    }
    var requestParams = {
        'url': restCtx.baseUrl + url,
        'method': method,
        'jar': j
    }

    // Expand values and check if we're uploading something (with a stream.)
    // API users need to pass in uploads (=streams) via a function as we do some other things
    // *before* we reach this point.
    // If we would simple pass in a stream the data might already be gone by the time
    // we reach this point.
    var hasStream = false;
    if (data) {
        var keys = Object.keys(data);
        for (var i = 0; i < keys.length; i++) {
            if (typeof data[keys[i]] === 'function') {
                data[keys[i]] = data[keys[i]]();
            }
            if (data[keys[i]] instanceof Stream) {
                hasStream = true;
            }
        }
    }

    // Add the request data, if there is any
    if (data) {
        if (method === 'GET') {
            requestParams.qs = data;
        } else if (!hasStream && method === 'POST') {
            requestParams.form = data;
        }
    }

    var req = request(requestParams, function(error, response, body) {
        if (error) {
            return callback({'code': 500, 'msg': 'Something went wrong trying to contact the server: ' + error});
        } else if (errorCodes.indexOf(response.statusCode) !== -1) {
            return callback({'code': response.statusCode, 'msg': body});
        }
        // Check if the response body is JSON
        try {
            body = JSON.parse(body);
        } catch (err) {
            /* This can be ignored, response is not a JSON object */
        }

        // Pass the response to the caller.
        callback(false, body);
    });
    if (hasStream) {
        // We append our data in a multi-part way.
        // That way we can support buffer/streams as well.
        var form = req.form();
        for (var i = 0; i < keys.length; i++) {
            var value = data[keys[i]];

            // We can't append null values.
            if (value) {
                // If we're sending parts which have the same name
                // we have to unroll them before appending them to the form.
                if (Array.isArray(value)) {
                    for (var v = 0; v < value.length; v++) {
                        form.append(keys[i], value[v]);
                    }

                // All other value types (string, stream, ..)
                } else {
                    form.append(keys[i], data[keys[i]]);
                }
            }
        }
    }
};
