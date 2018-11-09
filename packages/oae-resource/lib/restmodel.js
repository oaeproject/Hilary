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

/**
 * @RESTModel BasicResource
 *
 * @Required  []
 * @Property  {BasicUser}           (basicUser)         Used when the resource is a user
 * @Property  {BasicGroup}          (basicGroup)        Used when the resource is a group
 * @Property  {BasicDiscussion}     (basicDiscussion)   Used when the resource is a discussion
 * @Property  {BasicContent}        (basicContent)      Used when the resource is a content
 * @Property  {BasicFolder}         (basicFolder)       Used when the resource is a folder
 */

/**
 * @RESTModel InvitationAcceptResult
 *
 * @Required  [email,resources]
 * @Property  {string}              email       The email address that was associated to the invitation token
 * @Property  {BasicResource[]}     resources   The resources that the email was invited into
 */

/**
 * @RESTModel InvitationsResponse
 *
 * @Required  [results]
 * @Property  {Invitation[]}        results     The list of invitations
 */
