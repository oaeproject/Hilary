/*
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
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
var events = require('events');
var request = require('request');
var Stream = require('stream').Stream;
var util = require('util');

// Array of response codes that are considered to be HTTP errors
var errorCodes = [400, 401, 403, 404, 418, 500, 503];

/**
 * ### Events
 *
 * The `RestUtil` emits the following events:
 *
 * * `error(err, [body, response])`: An error occurred with the HTTP request. `err` is the error, the body is the body of the response (if applicable), and the response is the response object (if applicable)
 * * `request(restCtx, url, method, data)`: A request was sent. `restCtx` is the RestContext, `url` is the url of the request, `method` is the HTTP method, and `data` is the data that was sent (either in query string or POST body)
 * * `response(body, response)`: A successful response was received from the server. `body` is the response body and `response` is the express Response object
 */
var RestUtil = module.exports = new events.EventEmitter();
var emitter = RestUtil;

/**
 * Utility wrapper around the native JS encodeURIComponent function, to make sure that
 * encoding null doesn't return "null". In tests, null will often be passed in to validate
 * validation, and there's no need to catch the "null" string everywhere.
 *
 * @param  {String}     uriComponent        The URL part to encode and make URL safe
 * @return {String}                         The encoded URL part. When null was passed in, this will return ''
 */
module.exports.encodeURIComponent = function(uriComponent) {
    return uriComponent === null ? '' : encodeURIComponent(uriComponent);
};

/**
 * Function that will perform a REST request using the Node.js request module. It will check whether
 * or not the request should be authenticated, for which it will check the presence of a Cookie Jar
 * for that user. If no cookie jar exists, the user will be logged in first. After that, the actual
 * request will be made by the internal _RestRequest function
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         url                 The URL of the REST endpoint that should be called
 * @param  {String}         method              The HTTP method that should be used for the request (i.e. GET or POST)
 * @param  {Object}         data                The form data that should be passed into the request [optional]
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        Error object containing the error code and message
 * @param  {String|Object}  callback.body       The response body received from the request. If this is JSON, a parsed JSON object will be returned, otherwise the response will be returned as a string
 * @param  {Response}       callback.response   The response object that was returned by the node module requestjs.
 */
var RestRequest = module.exports.RestRequest = function(restCtx, url, method, data, callback) {
    // If we already have a cookieJar, we can perform the request directly.
    if (restCtx.cookieJar) {
        return _RestRequest(restCtx, url, method, data, callback);
    // Otherwise we create a new one.
    } else {
        restCtx.cookieJar = request.jar();

        // Fill the new cookie jar.
        fillCookieJar(restCtx, function(err) {
            if (err) {
                return callback(err);
            }
            _RestRequest(restCtx, url, method, data, callback);
        });
    }
};

/**
 * Fills the jar for a rest context.
 *
 * @param  {RestContext}     restCtx         Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Function}        callback        Standard callback method.
 * @param  {Object}          callback.err    Standard error object (if any.)
 */
var fillCookieJar = module.exports.fillCookieJar = function(restCtx, callback) {
    // If no user is specified, there is no point in doing a login request.
    if (!restCtx.username) {
        return callback(null);
    }

    // Log the user in
    _RestRequest(restCtx, '/api/auth/login', 'POST', {
        'username': restCtx.username,
        'password': restCtx.userPassword
    }, callback);
};

/**
 * Internal Function that will perform a REST request. If no user is provided, the request will be done anonymously
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {String}         url                 The URL of the REST endpoint that should be called
 * @param  {String}         method              The HTTP method that should be used for the request (i.e. GET or POST)
 * @param  {Object}         data                The form data that should be passed into the request [optional]
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        Error object containing the error code and message
 * @param  {String|Object}  callback.response   The response received from the request. If this is JSON, a parsed JSON object will be returned, otherwise the response will be returned as a string
 * @api private
 */
var _RestRequest = function(restCtx, url, method, data, callback) {
    module.exports.emit('request', restCtx, url, method, data);

    var requestParams = {
        'url': restCtx.host + url,
        'method': method,
        'jar': restCtx.cookieJar
    };

    requestParams.headers = requestParams.headers || {};

    var referer = restCtx.host + '/';
    if (restCtx.hostHeader) {
        // Set the host header so the app server can determine the tenant.
        requestParams.headers.host = restCtx.hostHeader;

        // Grab the protocol from the host to create a referer header value.
        var protocol = restCtx.host.split(':')[0];
        referer = protocol + '://' + restCtx.hostHeader + '/';
    }

    // If a referer was explicitly set, we use that
    if (restCtx.refererHeader !== null && restCtx.refererHeader !== undefined) {
        referer = restCtx.refererHeader;
    }

    requestParams.headers.referer = referer;

    // Expand values and check if we're uploading something (with a stream.)
    // API users need to pass in uploads (=streams) via a function as we do some other things
    // *before* we reach this point.
    // If we would simple pass in a stream the data might already be gone by the time
    // we reach this point.
    var hasStream = false;
    var keys;
    if (data) {
        keys = Object.keys(data);
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

        // Sanitize the parameters to not include null / unspecified values
        _.each(data, function(value, key) {
            if (value === null || value === undefined) {
                delete data[key];
            } else if (_.isArray(value)) {
                // Filter out unspecified items from the parameter array, and remove it if it is empty
                value = _.filter(value, function(el) { return (el !== null && el !== undefined); });
                if (value.length === 0) {
                    delete data[key];
                }
            }
        });

        if (method === 'GET') {
            requestParams.qs = data;
        } else if (!hasStream && method === 'POST') {
            requestParams.form = data;
        }
    }

    var req = request(requestParams, function(err, response, body) {
        if (err) {
            emitter.emit('error', err);
            return callback({'code': 500, 'msg': 'Something went wrong trying to contact the server: ' + err});
        } else if (errorCodes.indexOf(response.statusCode) !== -1) {
            err = {'code': response.statusCode, 'msg': body};
            emitter.emit('error', err, body, response);
            return callback(err);
        }

        // Check if the response body is JSON
        try {
            body = JSON.parse(body);
        } catch (ex) {
            /* This can be ignored, response is not a JSON object */
        }

        emitter.emit('response', body, response);
        return callback(null, body, response);
    });

    if (hasStream) {
        // We append our data in a multi-part way.
        // That way we can support buffer/streams as well.
        var form = req.form();
        for (var j = 0; j < keys.length; j++) {
            var value = data[keys[j]];

            // We can't append null values.
            if (value) {
                // If we're sending parts which have the same name
                // we have to unroll them before appending them to the form.
                if (Array.isArray(value)) {
                    for (var v = 0; v < value.length; v++) {
                        form.append(keys[j], value[v]);
                    }

                // All other value types (string, stream, ..)
                } else {
                    form.append(keys[j], data[keys[j]]);
                }
            }
        }
    }
};
