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
 * @RESTModel SearchContent
 *
 * @Required  [displayName,id,lastModified,profilePath,resourceSubType,resourceType,tenant,tenantAlias,visibility]
 * @Property  {string}              description         A longer description for the content item
 * @Property  {string}              displayName         The display name of the content item
 * @Property  {string}              id                  The id of the content item
 * @Property  {number}              lastModified        The timestamp (millis since epoch) at which the content item was last modified
 * @Property  {string}              mime                The mime type of the content item
 * @Property  {string}              profilePath         The relative path to the user profile
 * @Property  {string}              resourceSubType     The content item type                           [collabdoc,file,link]
 * @Property  {string}              resourceType        The resource type of the content item           [content]
 * @Property  {BasicTenant}         tenant              The tenant to which this content item is associated
 * @Property  {string}              tenantAlias         The alias of the tenant to which this content item is associated
 * @Property  {string}              thumbnailUrl        The relative path to the thumbnail image of the user
 * @Property  {string}              visibility          The visibility of the content item              [loggedin,private,public]
 */

/**
 * @RESTModel SearchDiscussion
 *
 * @Required  [description,displayName,id,lastModified,profilePath,resourceType,tenant,tenantAlias,visibility]
 * @Property  {string}              description         A longer description for the discussion
 * @Property  {string}              displayName         The display name of the discussion
 * @Property  {string}              id                  The id of the discussion
 * @Property  {string}              lastModified        The timestamp (millis since epoch) at which the discussion was last modified (or received the last message)
 * @Property  {string}              profilePath         The relative path to the discussion profile
 * @Property  {string}              resourceType        The resource type of the discussion             [discussion]
 * @Property  {BasicTenant}         tenant              The tenant to which this discussion is associated
 * @Property  {string}              tenantAlias         The alias of the tenant to which this discussion is associated
 * @Property  {string}              visibility          The visibility of the discussion                [loggedin,private,public]
 */

/**
 * @RESTModel SearchGroup
 *
 * @Required  [displayName,id,joinable,profilePath,resourceType,tenant,tenantAlias,visibility]
 * @Property  {string}              displayName         The display name of the group
 * @Property  {string}              id                  The id of the group
 * @Property  {string}              joinable            Whether the group is joinable                  [no,yes]
 * @Property  {string}              profilePath         The relative path to the group profile
 * @Property  {string}              resourceType        The resource type of the group                 [group]
 * @Property  {BasicTenant}         tenant              The tenant to which this group is associated
 * @Property  {string}              tenantAlias         The alias of the tenant to which this group is associated
 * @Property  {string}              thumbnailUrl        The relative path to the thumbnail image of the group
 * @Property  {string}              visibility          The visibility of the group                    [loggedin,private,public]
 */

/**
 * @RESTModel SearchResponse
 *
 * @Required  [total, results]
 * @Property  {number}              total               The total number of search results
 * @Property  {SearchResult[]}      results             List of search results
 */

/**
 * @RESTModel SearchResult
 *
 * @Required  []
 * @Property  {SearchContent}       (searchContent)     Used when the search result is a content item
 * @Property  {SearchDiscussion}    (searchDiscussion)  Used when the search result is a discussion
 * @Property  {SearchGroup}         (searchGroup)       Used when the search result is a group
 * @Property  {SearchUser}          (searchUser)        Used when the search result is a user
 */

/**
 * @RESTModel SearchUser
 *
 * @Required  [displayName,id,profilePath,resourceType,tenant,tenantAlias,visibility]
 * @Property  {string}              displayName         The display name of the user
 * @Property  {string}              id                  The id of the user
 * @Property  {string}              profilePath         The relative path to the user profile
 * @Property  {string}              resourceType        The resource type of the user                   [user]
 * @Property  {BasicTenant}         tenant              The tenant to which this user is associated
 * @Property  {string}              tenantAlias         The alias of the tenant to which this user is associated
 * @Property  {string}              thumbnailUrl        The relative path to the thumbnail image of the user
 * @Property  {string}              visibility          The visibility of the user                      [loggedin,private,public]
 */
