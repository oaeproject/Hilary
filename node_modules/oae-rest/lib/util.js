/*
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
var events = require('events');
var request = require('request');
var Stream = require('stream').Stream;
var util = require('util');

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
    // If we already have a cookieJar, we can perform the request directly
    if (restCtx.cookieJar) {
        return _RestRequest(restCtx, url, method, data, callback);
    }

    // Otherwise we create a new one
    restCtx.cookieJar = request.jar();

    // Fill the new cookie jar
    fillCookieJar(restCtx, function(err) {
        if (err) {
            return callback(err);
        }

        return _RestRequest(restCtx, url, method, data, callback);
    });
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
        return callback();
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

    var requestOpts = {
        'url': restCtx.host + url,
        'method': method,
        'jar': restCtx.cookieJar,
        'strictSSL': restCtx.strictSSL,
        'followRedirect': restCtx.followRedirect,
        'headers': {}
    };

    if (_.isObject(restCtx.additionalHeaders)) {
        requestOpts.headers = _.extend(requestOpts.headers, restCtx.additionalHeaders);
    }

    var referer = restCtx.host + '/';
    if (restCtx.hostHeader) {
        // Set the host header so the app server can determine the tenant
        requestOpts.headers.host = restCtx.hostHeader;

        // Grab the protocol from the host to create a referer header value
        var protocol = restCtx.host.split(':')[0];
        referer = util.format('%s://%s/', protocol, restCtx.hostHeader);
    }

    // If a referer was explicitly set, we use that
    if (restCtx.refererHeader !== null && restCtx.refererHeader !== undefined) {
        referer = restCtx.refererHeader;
    }

    requestOpts.headers.referer = referer;
    return module.exports.request(requestOpts, data, callback);
};

/**
 * Perform an HTTP request, automatically handling whether or not it should be multipart.
 *
 * @param  {Object}         opts                The opts that would normally be sent to the request module
 * @param  {Object}         data                The request data (e.g., query string values or request body)
 * @param  {Function}       callback            Invoked when the process completes
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {String|Object}  callback.body       The response body received from the request. If this is JSON, a parsed JSON object will be returned, otherwise the response will be returned as a string
 * @param  {Response}       callback.response   The response object that was returned by the request node module
 */
module.exports.request = function(opts, data, callback) {
    data = data || {};
    callback = callback || function() {};

    /*!
     * Expand values and check if we're uploading a file (a stream value). Since:
     *
     *  a) Streams start pumping out data as soon as they're opened in a later process tick
     *  b) We may not necessarily be in the same process tick as the stream was opened
     *
     * ... we allow a function to be sent in which opens the stream only in the 'tick' that
     * the request will be sent. This avoids the possibility of missing some 'data' callbacks
     * from the file stream.
     */
    var hasStream = false;
    _.each(data, function(value, key) {
        if (_.isArray(value)) {
            // For an array, resolve all inner values and reassign it to the data array
            value = _.map(value, function(innerValue) {
                if (_.isFunction(innerValue)) {
                    innerValue = innerValue();
                    if (innerValue instanceof Stream) {
                        hasStream = true;
                    }

                    return innerValue;
                } else {
                    return innerValue;
                }
            });

            data[key] = value;
        } else if (_.isFunction(value)) {
            // Invoke any values that are functions in order to resolve the returned value
            // for the request
            value = value();
            if (value instanceof Stream) {
                hasStream = true;
            }

            data[key] = value;
        } else if (value instanceof Stream) {
            hasStream = true;
        }
    });

    // Sanitize the parameters to not include null / unspecified values
    _.each(data, function(value, key) {
        if (value === null || value === undefined) {
            delete data[key];
        } else if (_.isArray(value)) {
            // Filter out unspecified items from the parameter array, and remove it if it is empty
            value = _.compact(value);
            if (_.isEmpty(value)) {
                delete data[key];
            } else {
                data[key] = value;
            }
        }
    });

    if (!_.isEmpty(data)) {
        if (opts.method === 'GET') {
            opts.qs = data;
        } else if (!hasStream && opts.method !== 'GET') {
            opts.form = data;
        }
    }

    var req = request(opts, function(err, response, body) {
        if (err) {
            emitter.emit('error', err);
            return callback({'code': 500, 'msg': util.format('Something went wrong trying to contact the server:\n%s\n%s', err.message, err.stack)});
        } else if (response.statusCode >= 400) {
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
        _.each(data, function(value, key) {
            // If we're sending parts which have the same name, we have to unroll them
            // before appending them to the form
            if (_.isArray(value)) {
                _.each(value, function(innerValue) {
                    // Stringify Booleans when uploading files
                    if (_.isBoolean(value)) {
                        form.append(key, innerValue.toString());
                    } else {
                        form.append(key, innerValue);
                    }
                });
            // Stringify Booleans when uploading files
            } else if (_.isBoolean(value)) {
                form.append(key, value.toString());
            } else {
                form.append(key, value);
            }
        });
    }
};
