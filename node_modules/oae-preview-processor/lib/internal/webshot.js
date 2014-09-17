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
var request = require('request');
var webshot = require('webshot');

var log = require('oae-logger').logger('oae-preview-processor');

// Default webshot options.
var defaultOptions = {
    'renderDelay': 7500,
    'timeout': 30000,
    'script': function() {
        // A script that will be executed when the page loads.
        // If there is no background color defined, we set it to white.
        if (!document.body.style.backgroundColor) {
            document.body.style.backgroundColor = '#ffffff';
        }
    }
};

/**
 * Takes a snapshot of the provided url by loading it in a headless browser. All javascript and CSS stylesheets will be applied.
 * The URL can be anything, including file://<..> URLs. This is to allow generating images for local files.
 * and generate preview images of those. It's up to the caller to sanitize their input!
 *
 * @param  {String}         url             The URL to generate images for. This method will not verify that the URL does not point to sensitive information on the filesystem, such as /etc/passwd, and thus could end up generating an image of the password file if not used properly.
 * @param  {String}         path            The path where the generated image should be stored.
 * @param  {Object}         options         The options object that will be passed into the webshot module.
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
var getImage = module.exports.getImage = function(url, path, options, callback) {
    log().trace({'url': url, 'path': path}, 'Generating image for an url.');

    var _options = _.extend({}, defaultOptions, options);
    webshot(url, path, _options, function(err) {
        if (err) {
            log().error({'err': err}, 'Could not generate a screenshot.');
            return callback({'code': 500, 'msg': err.message});
        }

        callback(null);
    });
};
