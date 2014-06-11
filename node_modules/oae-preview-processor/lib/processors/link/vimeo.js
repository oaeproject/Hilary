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
var util = require('util');

var IO = require('oae-util/lib/io');
var log = require('oae-logger').logger('oae-preview-processor');
var RestAPI = require('oae-rest');

var LinkProcessorUtil = require('oae-preview-processor/lib/processors/link/util');
var PreviewUtil = require('oae-preview-processor/lib/util');

var VIMEO_REGEX = /^http(s)?:\/\/(www\.)?vimeo\.com\/([0-9]+)(\/.*)?$/;


/**
 * @borrows Interface.test as VimeoProcessor.test
 */
var test = module.exports.test = function(ctx, contentObj, callback) {
    // Don't bother with non-link content items.
    if (contentObj.resourceSubType !== 'link') {
        return callback(null, -1);
    }

    // Check if it's a Vimeo URL.
    if (VIMEO_REGEX.test(contentObj.link)) {
        return callback(null, 10);
    } else {
        return callback(null, -1);
    }
};

/**
 * @borrows Interface.generatePreviews as VimeoProcessor.generatePreviews
 */
var generatePreviews = module.exports.generatePreviews = function(ctx, contentObj, callback) {
    var id = _getId(contentObj.link);

    // Do an API request first.
    var apiUrl = util.format('http://vimeo.com/api/v2/video/%s.json', id);
    request(apiUrl, function(err, response, body) {
        if (err || response.statusCode !== 200) {
            return callback(err || {'code': response.statusCode, 'msg': body});
        }

        // Get Thumbnail url.
        var info = JSON.parse(body);

        // Ignoring this video if it has no thumbnail.
        if (_.isEmpty(info) || !info[0].thumbnail_medium) {
            return callback(null, false);
        }

        var opts = {
            'displayName': info[0].title,
            'description': info[0].description
        };

        // Download it.
        var imageUrl = info[0].thumbnail_medium;
        var path = ctx.baseDir + '/vimeo.png';
        PreviewUtil.downloadRemoteFile(imageUrl, path, function(err, path) {
            if (err) {
                return callback(err);
            }

            LinkProcessorUtil.generatePreviewsFromImage(ctx, path, opts, callback);
        });
    });
};

/**
 * Gets a Vimeo movie identifier out of a url.
 * If the url is 'http://vimeo.com/46651666', '46651666' will be returned.
 *
 * @param  {String} url The Vimeo URL.
 * @return {String}     The movie identifier (or null.)
 * @api private
 */
var _getId = function(url) {
    var match = url.match(VIMEO_REGEX);
    if (match) {
        return match[3];
    } else {
        return null;
    }
};
