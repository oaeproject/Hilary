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

/**
 * Load a user his content library.
 * Exposes the first item in the library as `content_library_first_item`.
 *
 * @param  {Session}    session A session
 * @param  {String}     user    A variable that represents a user id.
 * @return {Object}             An object that holds the new dynamic variables you can use in this session.
 *                              In this case the key `firstItemid` will hold the variable that represents the content ID
 *                              of the first item in this user his library list.
 */
var load = module.exports.load = function(session, user) {
    var tx = session.addTransaction('library');
    
    // Each page does a me feed request.
    tx.addRequest('GET', '/api/me');

    // Get the library.
    var req = tx.addRequest('GET', '/api/content/library/' + user);
    req.addDynamicVariable('content_library_first_item', 'json', '$.results[0].contentId');
    return {
        'firstItemId': '%%_content_library_first_item%%'
    };
};