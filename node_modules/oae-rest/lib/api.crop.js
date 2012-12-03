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

var RestUtil = require('./util');

/**
 * Crop the large picture that is associated with a user.
 *
 * @param {RestContext}     restCtx                 Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param {String}          principalId             The ID of the principal we're trying to crop a picture for.
 * @param {Object}          selectedArea            The topleft coordinates and size of the rectangle that should be cropped out
 * @param {Number}          selectedArea.x          The top left x coordinate.
 * @param {Number}          selectedArea.y          The top left y coordinate.
 * @param {Number}          selectedArea.width      The width of the rectangle
 * @param {Number}          selectedArea.height     The height of the rectangle
 * @param {Function}        callback                Standard callback method takes argument `err`
 * @param {Object}          callback.err            Error object containing error code and error message
 */

var cropPicture = module.exports.cropPicture = function(restCtx, principalId, selectedArea, callback) {
    var params = {
        'principalId': principalId,
        'x': selectedArea.x,
        'y': selectedArea.y,
        'width': selectedArea.width,
        'height': selectedArea.height,
    }
    RestUtil.RestRequest(restCtx, '/api/crop', 'POST', params, callback);
};