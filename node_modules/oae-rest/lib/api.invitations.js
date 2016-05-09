/*!
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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

var RestUtil = require('./util');

/**
 * Get the invitations for the specified resource
 *
 * @param  {RestContext}        restCtx             Context of the current request
 * @param  {String}             resourceType        The resource type of the resource (i.e., the path part such as "content" for `/api/content`)
 * @param  {String}             resourceId          The id of the resource
 * @param  {Function}           callback            Standard callback function
 * @param  {Object}             callback.err        An error that occurred, if any
 * @param  {InvitationResult}   callback.result     The result of the request, containing the invitations
 */
var getInvitations = module.exports.getInvitations = function(restCtx, resourceType, resourceId, callback) {
    resourceType = RestUtil.encodeURIComponent(resourceType);
    resourceId = RestUtil.encodeURIComponent(resourceId);
    RestUtil.RestRequest(restCtx, '/api/' + resourceType + '/' + resourceId + '/invitations', 'GET', null, callback);
};

/**
 * Resend an invitation for the specified resource and email
 *
 * @param  {RestContext}        restCtx             Context of the current request
 * @param  {String}             resourceType        The resource type of the resource (i.e., the path part such as "content" for `/api/content`)
 * @param  {String}             resourceId          The id of the resource
 * @param  {String}             email               The email associated to the invitation
 * @param  {Function}           callback            Standard callback function
 * @param  {Object}             callback.err        An error that occurred, if any
 */
var resendInvitation = module.exports.resendInvitation = function(restCtx, resourceType, resourceId, email, callback) {
    resourceType = RestUtil.encodeURIComponent(resourceType);
    resourceId = RestUtil.encodeURIComponent(resourceId);
    email = RestUtil.encodeURIComponent(email);
    RestUtil.RestRequest(restCtx, '/api/' + resourceType + '/' + resourceId + '/invitations/' + email + '/resend', 'POST', null, callback);
};

/**
 * Accept an invitation with the specified token
 *
 * @param  {RestContext}                restCtx             Context of the current request
 * @param  {String}                     token               The token that was sent in the invitation email
 * @param  {Function}                   callback            Standard callback function
 * @param  {Object}                     callback.err        An error that occurred, if any
 * @param  {InvitationAcceptResult}     callback.result     The result of accepting the invitation, containing all resources to which the user became a member
 */
var acceptInvitation = module.exports.acceptInvitation = function(restCtx, token, callback) {
    RestUtil.RestRequest(restCtx, '/api/invitation/accept', 'POST', {'token': token}, callback);
};
