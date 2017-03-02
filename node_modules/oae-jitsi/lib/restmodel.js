/*!
 * Copyright 2016 Apereo Foundation (AF) Licensed under the
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
 * @RESTModel BasicMeeting
 *
 * @Required    [created,createdBy,description,displayName,id,lastModified,profilePath,resourceType,tenant,visibility]
 * @Property    {number}                created             The timestamp (millis since epoch) at which the meeting was created
 * @Property    {string}                createdBy           The id of the user who created the meeting
 * @Property    {string}                description         A longer description for the meeting
 * @Property    {string}                displayName         The display name of the meeting
 * @Property    {string}                id                  The id of the meeting
 * @Property    {number}                lastModified        The timestamp (millis since epoch) at which the meeting was last modified (or received the last message)
 * @Property    {string}                profilePath         The relative path to the meeting profile
 * @Property    {string}                resourceType        The resource type of the meeting     [meeting]
 * @Property    {BasicTenant}           tenant              The tenant to which this meeting is associated
 * @Property    {string}                visibility          The visibility of the meeting        [loggedin,private,public]
 */

/**
 * @RESTModel Meeting
 *
 * @Required    [canPost,canShare,created,createdBy,description,displayName,id,isManager,lastModified,profilePath,resourceType,tenant,visibility]
 * @Property    {boolean}               canPost             Whether the current user is allowed to post messages to the meeting
 * @Property    {boolean}               canShare            Whether the current user is allowed to share the meeting
 * @Property    {number}                created             The timestamp (millis since epoch) at which the meeting was created
 * @Property    {BasicUser}             createdBy           The user who created the meeting
 * @Property    {string}                description         A longer description for the meeting
 * @Property    {string}                displayName         The display name of the meeting
 * @Property    {string}                id                  The id of the meeting
 * @Property    {boolean}               isManager           Whether the current user is a manager of the meeting
 * @Property    {number}                lastModified        The timestamp (millis since epoch) at which the meeting was last modified (or received the last message)
 * @Property    {string}                profilePath         The relative path to the meeting profile
 * @Property    {string}                resourceType        The resource type of the meeting     [meeting]
 * @Property    {BasicTenant}           tenant              The tenant to which this meeting is associated
 * @Property    {string}                visibility          The visibility of the meeting        [loggedin,private,public]
 */

/**
 * @RESTModel MeetingMembersUpdate
 *
 * @Required    [{principalId}]
 * @Property    {string}                {principalId}       The role to apply to the named principal. If the value is `false`, the principal will be revoked access       [false,manager,member]
 */

/**
 * @RESTModel MeetingsLibrary
 *
 * @Required  [nextToken,results]
 * @Property    {string}             nextToken           The meeting paging token needed to retrieve the next set of meeting library items
 * @Property    {BasicMeeting[]}     results             List of meetings in the meeting library
 */
