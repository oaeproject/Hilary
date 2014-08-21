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
 * @RESTModel Activity
 *
 * @Required    [oae:activityId,oae:activityType,actor,object,published,verb]
 * @Property    {string}                    oae:activityId              The id of the activity
 * @Property    {string}                    oae:activityType            The activity type           [content-add-to-library,content-comment,content-create,content-update,content-update-member-role,content-update-visibility,content-restored-revision,content-revision,content-share,discussion-add-to-library,discussion-create,discussion-message,discussion-share,discussion-update,discussion-update-member-role,discussion-update-visibility,following-follow,group-add-member,group-create,group-join,group-update,group-update-member-role,group-update-visibility,user-update]
 * @Property    {Actor}                     actor                       The entity that instigated the activity
 * @Property    {Object}                    object                      The object of the activity
 * @Property    {number}                    published                   The timestamp (millis since epoch) at which the activity was published
 * @Property    {Target}                    target                      The target of the activity
 * @Property    {string}                    verb                        The verb for the activity   [add,create,follow,join,post,share,update]
 */

/**
 * @RESTModel ActivityContent
 *
 * @Required    []
 * @Property    {ActivityContentCollabdoc}  (activityContentCollabdoc)  Used when the activity entity is a collaborative document
 * @Property    {ActivityContentFile}       (activityContentFile)       Used when the activity entity is a file
 * @Property    {ActivityContentLink}       (activityContentLink)       Used when the activity entity is a link
 */

/**
 * @RESTModel ActivityContentCollabdoc
 *
 * @Required    [displayName,id,oae:id,oae:profilePath,oae:resourceSubType,oae:revisionId,oae:tenant,oae:visibility,objectType,url]
 * @Property    {string}                    displayName                 The display name for the collaborative document
 * @Property    {string}                    id                          The API URL for the collaborative document
 * @Property    {ActivityImage}             image                       The thumbnail for the collaborative document
 * @Property    {string}                    oae:id                      The id of the collaborative document
 * @Property    {string}                    oae:profilePath             The relative path to the collaborative document
 * @Property    {string}                    oae:resourceSubType         The content item type                           [collabdoc]
 * @Property    {string}                    oae:revisionId              The id of the current collaborative document revision
 * @Property    {BasicTenant}               oae:tenant                  The tenant to which this collaborative document is associated
 * @Property    {string}                    oae:visibility              The visibility of the collaborative document    [loggedin,private,public]
 * @Property    {ActivityImage}             oae:wideImage               The wide thumbnail for the file
 * @Property    {string}                    objectType                  The type of activity entity                     [content]
 * @Property    {string}                    url                         The URL to the collaborative docuemnt profile
 */

/**
 * @RESTModel ActivityContentFile
 *
 * @Required    [displayName,id,oae:id,oae:mimeType,oae:profilePath,oae:resourceSubType,oae:revisionId,oae:tenant,oae:visibility,objectType,url]
 * @Property    {string}                    displayName                 The display name for the file
 * @Property    {string}                    id                          The API URL for the file
 * @Property    {ActivityImage}             image                       The thumbnail for the file
 * @Property    {string}                    oae:id                      The id of the file
 * @Property    {string}                    oae:mimeType                The mime type of the file
 * @Property    {string}                    oae:profilePath             The relative path to the file profile
 * @Property    {string}                    oae:resourceSubType         The content item type                       [file]
 * @Property    {string}                    oae:revisionId              The id of the current file revision
 * @Property    {BasicTenant}               oae:tenant                  The tenant to which this file is associated
 * @Property    {string}                    oae:visibility              The visibility of the file                  [loggedin,private,public]
 * @Property    {ActivityImage}             oae:wideImage               The wide thumbnail for the file
 * @Property    {string}                    objectType                  The type of activity entity                 [content]
 * @Property    {string}                    url                         The URL to the file profile
 */

/**
 * @RESTModel ActivityContentLink
 *
 * @Required    [displayName,id,oae:id,oae:profilePath,oae:resourceSubType,oae:revisionId,oae:tenant,oae:visibility,objectType,url]
 * @Property    {string}                    displayName                 The display name for the link
 * @Property    {string}                    id                          The API URL for the link
 * @Property    {ActivityImage}             image                       The thumbnail for the link
 * @Property    {string}                    oae:id                      The id of the link
 * @Property    {string}                    oae:profilePath             The relative path to the link profile
 * @Property    {string}                    oae:resourceSubType         The content item type                       [link]
 * @Property    {string}                    oae:revisionId              The id of the current link revision
 * @Property    {BasicTenant}               oae:tenant                  The tenant to which this link is associated
 * @Property    {string}                    oae:visibility              The visibility of the link                  [loggedin,private,public]
 * @Property    {string}                    objectType                  The type of activity entity                 [content]
 * @Property    {string}                    url                         The URL to the link profile
 */

/**
 * @RESTModel ActivityDiscussion
 *
 * @Required    [displayName,id,oae:id,oae:profilePath,oae:tenant,oae:visibility,objectType,url]
 * @Property    {string}                    displayName                 The display name for the discussion
 * @Property    {string}                    id                          The API URL for the discussion
 * @Property    {string}                    oae:id                      The id of the link
 * @Property    {string}                    oae:profilePath             The relative path to the discussion profile
 * @Property    {BasicTenant}               oae:tenant                  The tenant to which this discussion is associated
 * @Property    {string}                    oae:visibility              The visibility of the discussion            [loggedin,private,public]
 * @Property    {string}                    objectType                  The type of activity entity                 [discussion]
 * @Property    {string}                    url                         The URL to the discussion profile
 */

/**
 * @RESTModel ActivityGroup
 *
 * @Required    [displayName,id,oae:id,oae:joinable,oae:profilePath,oae:tenant,oae:visibility,objectType,url]
 * @Property    {string}                    displayName                 The display name for the group
 * @Property    {string}                    id                          The API URL for the group
 * @Property    {ActivityImage}             image                       The thumbnail for the group
 * @Property    {string}                    oae:id                      The id of the group
 * @Property    {string}                    oae:joinable                How the group can be joined                 [no,request,yes]
 * @Property    {string}                    oae:profilePath             The relative path to the group profile
 * @Property    {BasicTenant}               oae:tenant                  The tenant to which this group is associated
 * @Property    {ActivityImage}             oae:thumbnail               The thumbnail for the group
 * @Property    {string}                    oae:visibility              The visibility of the group                 [loggedin,private,public]
 * @Property    {string}                    objectType                  The type of activity entity                 [group]
 * @Property    {string}                    url                         The URL to the group profile
 */

/**
 * @RESTModel ActivityMessage
 *
 * @Required    [author,content,id,oae:id,oae:messageBoxId,oae:tenant,oae:threadKey,objectType,published,url]
 * @Property    {ActivityUser}              author                      The author of the comment
 * @Property    {string}                    content                     The body of the message
 * @Property    {string}                    id                          The API URL for the message
 * @Property    {ActivityMessage}           inReplyTo                   The message to which this message is a reply
 * @Property    {string}                    oae:id                      The id of the message
 * @Property    {string}                    oae:messageBoxId            The id of the message box in which this message is contained
 * @Property    {BasicTenant}               oae:tenant                  The tenant to which this message is associated
 * @Property    {string}                    oae:threadKey               The thread key for the message
 * @Property    {string}                    objectType                  The type of activity entity                 [content-comment, discussion-message]
 * @Property    {number}                    published                   The timestamp (millis since epoch) at which the message was created
 * @Property    {string}                    url                         The URL to the entity profile
 */

/**
 * @RESTModel ActivityImage
 *
 * @Required    [height,url,width]
 * @Property    {number}                    height                      The height of the activity image in pixels
 * @Property    {string}                    url                         The path for the activity image
 * @Property    {number}                    width                       The width of the activity image in pixels
 */

/**
 * @RESTModel ActivityStream
 *
 * @Required    [items,nextToken]
 * @Property    {Activity[]}                items                       The activity items
 * @Property    {string}                    nextToken                   The activity paging token needed to retrieve the next set of activity items
 */

/**
 * @RESTModel ActivityUser
 *
 * @Required    [displayName,id,oae:id,oae:profilePath,oae:tenant,oae:visibility,objectType,url]
 * @Property    {string}                    displayName                 The display name for the user
 * @Property    {string}                    id                          The API URL for the user
 * @Property    {ActivityImage}             image                       The thumbnail for the user
 * @Property    {string}                    oae:id                      The id of the user
 * @Property    {string}                    oae:profilePath             The relative path to the user profile
 * @Property    {BasicTenant}               oae:tenant                  The tenant to which this user is associated
 * @Property    {ActivityImage}             oae:thumbnail               The thumbnail for the user
 * @Property    {string}                    oae:visibility              The visibility of the user                  [loggedin,private,public]
 * @Property    {string}                    objectType                  The type of activity entity                 [user]
 * @Property    {string}                    url                         The URL to the user profile
 */

/**
 * @RESTModel Actor
 *
 * @Required    []
 * @Property    {Collection}                (collection)                Used when the activity has multiple actors
 * @Property    {ActivityUser}              (activityUser)              Used when the actor is a user
 */

/**
 * @RESTModel Collection
 *
 * @Required    [oae:collection,objectType]
 * @Property    {Object[]}                  oae:collection              The activity entities
 * @Property    {string}                    objectType                  The object type                 [collection]
 */

/**
 * @RESTModel NotificationsRead
 *
 * @Required    [lastReadTime]
 * @Property    {number}                    lastReadTime                The timestamp (millis since epoch) that was persisted as the time at which the notifications were last read
 */

/**
 * @RESTModel Object
 *
 * @Required    []
 * @Property    {Collection}                (collection)                Used when the activity has multiple objects
 * @Property    {ActivityContent}           (activityContent)           Used when the object is a content item
 * @Property    {ActivityDiscussion}        (activityDiscussion)        Used when the object is a discussion
 * @Property    {ActivityGroup}             (activityGroup)             Used when the object is a group
 * @Property    {ActivityMessage}           (activityMessage)           Used when the object is a message
 * @Property    {ActivityUser}              (activityUser)              Used when the object is a user
 */

/**
 * @RESTModel Target
 *
 * @Required    []
 * @Property    {Collection}                (collection)                Used when the activity has multiple targets
 * @Property    {ActivityContent}           (activityContent)           Used when the target is a content item
 * @Property    {ActivityDiscussion}        (activityDiscussion)        Used when the target is a discussion
 * @Property    {ActivityGroup}             (activityGroup)             Used when the target is a group
 * @Property    {ActivityUser}              (activityUser)              Used when the target is a user
 */
