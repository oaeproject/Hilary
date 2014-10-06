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
 * @RESTModel BasicFolder
 *
 * @Required    [created,createdBy,displayName,id,lastModified,profilePath,resourceType,tenant,visibility]
 * @Property    {number}                created             The timestamp (millis since epoch) at which the folder was created
 * @Property    {string}                createdBy           The id of the user who created the folder
 * @Property    {string}                description         A longer description for the folder
 * @Property    {string}                displayName         The display name of the folder
 * @Property    {string}                id                  The id of the folder
 * @Property    {number}                lastModified        The timestamp (millis since epoch) at which the folder was last modified
 * @Property    {string}                profilePath         The relative path to the folder profile
 * @Property    {string}                resourceType        The resource type of the folder     [folder]
 * @Property    {BasicTenant}           tenant              The tenant to which this folder is associated
 * @Property    {string}                visibility          The visibility of the folder        [loggedin,private,public]
 */

/**
 * @RESTModel Folder
 *
 * @Required    [canAddItem,canManage,canShare,created,createdBy,displayName,id,lastModified,profilePath,resourceType,tenant,visibility]
 * @Property    {boolean}               canAddItem          Whether the current user is allowed to add content items to the folder
 * @Property    {boolean}               canManage           Whether the current user can manage the folder
 * @Property    {boolean}               canShare            Whether the current user is allowed to share the folder
 * @Property    {number}                created             The timestamp (millis since epoch) at which the folder was created
 * @Property    {BasicUser}             createdBy           The user who created the folder
 * @Property    {string}                description         A longer description for the folder
 * @Property    {string}                displayName         The display name of the folder
 * @Property    {string}                id                  The id of the folder
 * @Property    {number}                lastModified        The timestamp (millis since epoch) at which the folder was last modified (or received the last message)
 * @Property    {Previews}              previews            The thumbnails for the folder
 * @Property    {string}                profilePath         The relative path to the folder profile
 * @Property    {string}                resourceType        The resource type of the folder     [folder]
 * @Property    {BasicTenant}           tenant              The tenant to which this folder is associated
 * @Property    {string}                visibility          The visibility of the folder        [loggedin,private,public]
 */

/**
 * @RESTModel FolderContentDelete
 *
 * @Required    [failedContent]
 * @Property    {BasicContent[]}       failedContent        The content items that could not be deleted
 */

/**
 * @RESTModel FolderContentVisibilityUpdate
 *
 * @Required    [failedContent]
 * @Property    {BasicContent[]}        failedContent       The content items that could not be updated
 */

/**
 * @RESTModel FolderMembersUpdate
 *
 * @Required    [{principalId}]
 * @Property    {string}                {principalId}       The role to apply to the named principal. If the value is `false`, the principal will be revoked access       [false,manager,viewer]
 */

/**
 * @RESTModel FoldersLibrary
 *
 * @Required    [nextToken,results]
 * @Property    {string}                nextToken           The folder paging token needed to retrieve the next set of folder library items
 * @Property    {BasicFolder[]}         results             List of folders in the folder library
 */
