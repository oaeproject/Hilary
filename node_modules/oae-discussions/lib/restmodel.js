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

/**
 * @RESTModel BasicDiscussion
 *
 * @Required    [created,createdBy,description,displayName,id,lastModified,profilePath,resourceType,tenant,visibility]
 * @Property    {number}                created             The timestamp (millis since epoch) at which the discussion was created
 * @Property    {string}                createdBy           The id of the user who created the discussion
 * @Property    {string}                description         A longer description for the discussion
 * @Property    {string}                displayName         The display name of the discussion
 * @Property    {string}                id                  The id of the discussion
 * @Property    {number}                lastModified        The timestamp (millis since epoch) at which the discussion was last modified (or received the last message)
 * @Property    {string}                profilePath         The relative path to the discussion profile
 * @Property    {string}                resourceType        The resource type of the discussion     [discussion]
 * @Property    {BasicTenant}           tenant              The tenant to which this discussion is associated
 * @Property    {string}                visibility          The visibility of the discussion        [loggedin,private,public]
 */

/**
 * @RESTModel Discussion
 *
 * @Required    [canPost,canShare,created,createdBy,description,displayName,id,isManager,lastModified,profilePath,resourceType,tenant,visibility]
 * @Property    {boolean}               canPost             Whether the current user is allowed to post messages to the discussion
 * @Property    {boolean}               canShare            Whether the current user is allowed to share the discussion
 * @Property    {number}                created             The timestamp (millis since epoch) at which the discussion was created
 * @Property    {BasicUser}             createdBy           The user who created the discussion
 * @Property    {string}                description         A longer description for the discussion
 * @Property    {string}                displayName         The display name of the discussion
 * @Property    {string}                id                  The id of the discussion
 * @Property    {boolean}               isManager           Whether the current user is a manager of the discussion
 * @Property    {number}                lastModified        The timestamp (millis since epoch) at which the discussion was last modified (or received the last message)
 * @Property    {string}                profilePath         The relative path to the discussion profile
 * @Property    {string}                resourceType        The resource type of the discussion     [discussion]
 * @Property    {BasicTenant}           tenant              The tenant to which this discussion is associated
 * @Property    {string}                visibility          The visibility of the discussion        [loggedin,private,public]
 */

/**
 * @RESTModel DiscussionMembersUpdate
 *
 * @Required    [{principalId}]
 * @Property    {string}                {principalId}       The role to apply to the named principal. If the value is `false`, the principal will be revoked access       [false,manager,member]
 */

/**
 * @RESTModel DiscussionsLibrary
 *
 * @Required  [nextToken,results]
 * @Property    {string}                nextToken           The discussion paging token needed to retrieve the next set of discussion library items
 * @Property    {BasicDiscussion[]}     results             List of discussions in the discussion library
 */
