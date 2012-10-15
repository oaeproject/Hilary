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

var RestUtil = require('./util');

/**
 * Request a profile section from a user's profile through the REST API.
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                      user credentials
 * @param {String}                  userId              User id of the user for who we want to retrieve a profile section
 * @param {String}                  sectionId           Id of the profile section we want to retrieve
 * @param {Function(err, section)}  callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 * @param {Object}                  callback.section    JSON object representing the user's profile section. This will be the same as what
 *                                                      was saved by the user
 */
var getSection = module.exports.getSection = function(restCtx, userId, sectionId, callback) {
    RestUtil.RestRequest(restCtx, '/api/user/' + userId + '/profile/' + sectionId, 'GET', null, callback);
};

/**
 * Get all of the profile sections of a user through the REST API.
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                      user credentials
 * @param {String}                  userId              User id of the user for who we want to retrieve all of the profile section
 * @param {Function(err, sections)} callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 * @param {Object}                  callback.sections   JSON object representing all of the user's profile sections. The keys will be the user
 *                                                      profile section ids, the values will be the actual user profile sections
 */
var getAllSections = module.exports.getAllSections = function(restCtx, userId, callback) {
    RestUtil.RestRequest(restCtx, '/api/user/' + userId + '/profile', 'GET', null, callback);
};

/**
 * Set a profile section through the REST API.
 * @param {RestContext}             restCtx             Standard REST Context object that contains the current tenant URL and the current
 *                                                      user credentials
 * @param {String}                  userId              User id of the user for who we want to set a profile section
 * @param {String}                  sectionId           Id of the profile section we want to set
 * @param {String}                  visibility          Visibility of the profile section. This can be public, loggedin or private
 * @param {Object}                  sectionData         JSON object representing the profile section that needs to be stored. The object
 *                                                      will be stored (and later on retrieved) as is
 * @param {Boolean}                 overwrite           Whether or not values that are already in the profile section but or not in the updated
 *                                                      values should be overwritten or not
 * @param {Function(err)}           callback            Standard callback method
 * @param {Object}                  callback.err        Error object containing error code and error message
 */
var setSection = module.exports.setSection = function(restCtx, userId, sectionId, visibility, sectionData, overwrite, callback) {
    var params = {
        'section': sectionId,
        'data': JSON.stringify(sectionData),
        'visibility': visibility,
        'overwrite': overwrite
    };
    RestUtil.RestRequest(restCtx, '/api/user/' + userId + '/profile', 'POST', params, callback);
};    