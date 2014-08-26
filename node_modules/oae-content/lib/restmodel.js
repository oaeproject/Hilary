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
 * @RESTModel BasicContent
 *
 * @Required  []
 * @Property  {BasicContentCollabdoc}   (basicContentCollabdoc)     Used when the content item is a collaborative document
 * @Property  {BasicContentFile}        (basicContentFile)          Used when the content item is a file
 * @Property  {BasicContentLink}        (basicContentLink)          Used when the content item is a link
 */

/**
 * @RESTModel BasicContentCollabdoc
 *
 * @Required    [created,createdBy,displayName,etherpadGroupId,etherpadPadId,id,lastModified,latestRevisionId,profilePath,resourceSubType,resourceType,tenant,visibility]
 * @Property    {number}                created                     The timestamp (millis since epoch) at which the collaborative document was created
 * @Property    {string}                createdBy                   The id of the user who created the collaborative document
 * @Property    {string}                description                 A longer description for the collaborative document
 * @Property    {string}                displayName                 The display name of the collaborative document
 * @Property    {string}                etherpadGroupId             The id of the collaborative document's corresponding Etherpad group
 * @Property    {string}                etherpadPadId               The id of the collaborative document's corresponding Etherpad pad
 * @Property    {string}                id                          The id of the collaborative document
 * @Property    {number}                lastModified                The timestamp (millis since epoch) at which the collaborative document was last modified
 * @Property    {string}                latestRevisionId            The id of the current collaborative document revision
 * @Property    {Previews}              previews                    The thumbnails for the collaborative document
 * @Property    {string}                profilePath                 The relative path to the collaborative document
 * @Property    {string}                resourceSubType             The content item type                           [collabdoc]
 * @Property    {string}                resourceType                The resource type of the content item           [content]
 * @Property    {Tenant}                tenant                      The tenant to which this collaborative document is associated
 * @Property    {string}                visibility                  The visibility of the collaborative document    [loggedin,private,public]
 */

/**
 * @RESTModel BasicContentFile
 *
 * @Required    [created,createdBy,displayName,downloadPath,filename,id,lastModified,latestRevisionId,mime,profilePath,resourceSubType,resourceType,size,tenant,visibility]
 * @Property    {number}                created                     The timestamp (millis since epoch) at which the file was created
 * @Property    {string}                createdBy                   The id of the user who created the file
 * @Property    {string}                description                 A longer description for the file
 * @Property    {string}                displayName                 The display name of the file
 * @Property    {string}                downloadPath                The relative path at which the file can be downloaded
 * @Property    {string}                filename                    The original file name of the uploaded file
 * @Property    {string}                id                          The id of the file
 * @Property    {number}                lastModified                The timestamp (millis since epoch) at which the file was last modified
 * @Property    {string}                latestRevisionId            The id of the current file revision
 * @Property    {string}                mime                        The mime type of the file
 * @Property    {Previews}              previews                    The thumbnails for the file
 * @Property    {string}                profilePath                 The relative path to the file
 * @Property    {string}                resourceSubType             The content item type                           [file]
 * @Property    {string}                resourceType                The resource type of the content item           [content]
 * @Property    {number}                size                        The size of the file in bytes
 * @Property    {Tenant}                tenant                      The tenant to which this file is associated
 * @Property    {string}                visibility                  The visibility of the file                      [loggedin,private,public]
 */

/**
 * @RESTModel BasicContentLink
 *
 * @Required    [created,createdBy,displayName,id,lastModified,latestRevisionId,link,resourceSubType,resourceType,tenant,visibility]
 * @Property    {number}                created                     The timestamp (millis since epoch) at which the link was created
 * @Property    {string}                createdBy                   The id of the user who created the link
 * @Property    {string}                description                 A longer description for the link
 * @Property    {string}                displayName                 The display name of the link
 * @Property    {string}                id                          The id of the link
 * @Property    {number}                lastModified                The timestamp (millis since epoch) at which the link was last modified
 * @Property    {string}                latestRevisionId            The id of the current link revision
 * @Property    {string}                link                        The URL to which the link points
 * @Property    {Previews}              previews                    The thumbnails and embed information for the link
 * @Property    {string}                profilePath                 The relative path to the link
 * @Property    {string}                resourceSubType             The content item type                           [link]
 * @Property    {string}                resourceType                The resource type of the content item           [content]
 * @Property    {Tenant}                tenant                      The tenant to which this link is associated
 * @Property    {string}                visibility                  The visibility of the link                      [loggedin,private,public]
 */

/**
 * @RESTModel CollabdocJoinInfo
 *
 * @Required    [url]
 * @Property    {string}                url                         The relative path with which the collaborative document can be embedded
 */

/**
 * @RESTModel CollabdocRevision
 *
 * @Required [contentId,created,createdBy,revisionId]
 * @Property    {string}                contentId                   The id of the collaborative document associated to the revision
 * @Property    {number}                created                     The timestamp (millis since epoch) at which the revision was created
 * @Property    {BasicUser}             createdBy                   The user who created the revision
 * @Property    {string}                etherpadHtml                The full HTML content of the collaborative document
 * @Property    {Previews}              previews                    The thumbnails for the revision
 * @Property    {string}                revisionId                  The id of the revision
 * @Property    {string}                thumbnailUrl                The relative path to the revision thumbnail
 */

/**
 * @RESTModel Content
 *
 * @Required  []
 * @Property  {ContentCollabdoc}        (contentCollabdoc)          Used when the content item is a collaborative document
 * @Property  {ContentFile}             (contentFile)               Used when the content item is a file
 * @Property  {ContentLink}             (contentLink)               Used when the content item is a link
 */

/**
 * @RESTModel ContentCollabdoc
 *
 * @Required    [canShare,created,createdBy,displayName,etherpadGroupId,etherpadPadId,id,isManager,lastModified,latestRevisionId,profilePath,resourceSubType,resourceType,tenant,visibility]
 * @Property    {boolean}               canShare                    Whether the current user is allowed to share the collaborative document
 * @Property    {number}                created                     The timestamp (millis since epoch) at which the collaborative document was created
 * @Property    {BasicUser}             createdBy                   The user who created the collaborative document
 * @Property    {string}                description                 A longer description for the collaborative document
 * @Property    {string}                displayName                 The display name of the collaborative document
 * @Property    {string}                etherpadGroupId             The id of the collaborative document's corresponding Etherpad group
 * @Property    {string}                etherpadPadId               The id of the collaborative document's corresponding Etherpad pad
 * @Property    {string}                id                          The id of the collaborative document
 * @Property    {boolean}               isManager                   Whether the current user is a manager of the collaborative document
 * @Property    {number}                lastModified                The timestamp (millis since epoch) at which the collaborative document was last modified
 * @Property    {CollabdocRevision}     latestRevision              The current collaborative document revision
 * @Property    {string}                latestRevisionId            The id of the current collaborative document revision
 * @Property    {Previews}              previews                    The thumbnails for the collaborative document
 * @Property    {string}                profilePath                 The relative path to the collaborative document
 * @Property    {string}                resourceSubType             The content item type                           [collabdoc]
 * @Property    {string}                resourceType                The resource type of the content item           [content]
 * @Property    {BasicTenant}           tenant                      The tenant to which this collaborative document is associated
 * @Property    {string}                visibility                  The visibility of the collaborative document    [loggedin,private,public]
 */

/**
 * @RESTModel ContentFile
 *
 * @Required    [canShare,created,createdBy,displayName,downloadPath,filename,id,isManager,lastModified,latestRevisionId,mime,profilePath,resourceSubType,resourceType,size,tenant,visibility]
 * @Property    {boolean}               canShare                    Whether the current user is allowed to share the file
 * @Property    {number}                created                     The timestamp (millis since epoch) at which the file was created
 * @Property    {string}                createdBy                   The id of the user who created the file
 * @Property    {string}                description                 A longer description for the file
 * @Property    {string}                displayName                 The display name of the file
 * @Property    {string}                downloadPath                The relative path at which the file can be downloaded
 * @Property    {string}                filename                    The original file name of the uploaded file
 * @Property    {string}                id                          The id of the file
 * @Property    {boolean}               isManager                   Whether the current user is a manager of the file
 * @Property    {number}                lastModified                The timestamp (millis since epoch) at which the file was last modified
 * @Property    {string}                latestRevisionId            The id of the current file revision
 * @Property    {string}                mime                        The mime type of the file
 * @Property    {Previews}              previews                    The thumbnails for the file
 * @Property    {string}                profilePath                 The relative path to the file
 * @Property    {string}                resourceSubType             The content item type                           [file]
 * @Property    {string}                resourceType                The resource type of the content item           [content]
 * @Property    {number}                size                        The size of the file in bytes
 * @Property    {Tenant}                tenant                      The tenant to which this file is associated
 * @Property    {string}                visibility                  The visibility of the file                      [loggedin,private,public]
 */

/**
 * @RESTModel ContentLibrary
 *
 * @Required    [nextToken,results]
 * @Property    {string}                nextToken                   The content paging token needed to retrieve the next set of content library items
 * @Property    {BasicContent[]}        results                     List of content items in the content library
 */

/**
 * @RESTModel ContentLink
 *
 * @Required    [canShare,created,createdBy,displayName,id,isManager,lastModified,latestRevisionId,link,profilePath,resourceSubType,resourceType,tenant,visibility]
 * @Property    {boolean}               canShare                    Whether the current user is allowed to share the link
 * @Property    {number}                created                     The timestamp (millis since epoch) at which the link was created
 * @Property    {string}                createdBy                   The id of the user who created the link
 * @Property    {string}                description                 A longer description for the link
 * @Property    {string}                displayName                 The display name of the link
 * @Property    {string}                id                          The id of the link
 * @Property    {boolean}               isManager                   Whether the current user is a manager of the link
 * @Property    {number}                lastModified                The timestamp (millis since epoch) at which the link was last modified
 * @Property    {string}                latestRevisionId            The id of the current link revision
 * @Property    {string}                link                        The URL to which the link points
 * @Property    {Previews}              previews                    The thumbnails and embed information for the link
 * @Property    {string}                profilePath                 The relative path to the link
 * @Property    {string}                resourceSubType             The content item type                           [link]
 * @Property    {string}                resourceType                The resource type of the content item           [content]
 * @Property    {Tenant}                tenant                      The tenant to which this link is associated
 * @Property    {string}                visibility                  The visibility of the link                      [loggedin,private,public]
 */

/**
 * @RESTModel ContentMembersUpdate
 *
 * @Required    [{principalId}]
 * @Property    {string}                {principalId}               The role to apply to the named principal. If the value is `false`, the principal will be revoked access       [false,manager,member]
 */

/**
 * @RESTModel FileRevision
 *
 * @Required [contentId,created,createdBy,filename,mime,revisionId,size,status]
 * @Property    {string}                contentId                   The id of the file associated to the revision
 * @Property    {number}                created                     The timestamp (millis since epoch) at which the revision was created
 * @Property    {BasicUser}             createdBy                   The user who created the revision
 * @Property    {string}                downloadPath                The relative path at which the revision can be downloaded
 * @Property    {string}                largeUrl                    The relative path to the large-sized revision thumbnail
 * @Property    {string}                filename                    The original file name of the uploaded file
 * @Property    {string}                mediumUrl                   The relative path to the medium-sized revision thumbnail
 * @Property    {string}                mime                        The mime type of the file
 * @Property    {Previews}              previews                    The thumbnails for the file
 * @Property    {string}                revisionId                  The id of the revision
 * @Property    {number}                size                        The size of the file in bytes
 * @Property    {string}                status                      The current preview processing status for the revision      ['done', 'error', 'ignored','pending']
 * @Property    {string}                thumbnailUrl                The relative path to the revision thumbnail
 */

/**
 * @RESTModel LinkRevision
 *
 * @Required [contentId,created,createdBy,revisionId,status]
 * @Property    {string}                contentId                   The id of the link associated to the revision
 * @Property    {number}                created                     The timestamp (millis since epoch) at which the revision was created
 * @Property    {BasicUser}             createdBy                   The user who created the revision
 * @Property    {string}                mediumUrl                   The relative path to the medium-sized revision thumbnail
 * @Property    {Previews}              previews                    The thumbnails for the revision
 * @Property    {string}                revisionId                  The id of the revision
 * @Property    {string}                status                      The current preview processing status for the revision      [done,error,ignored,pending]
 * @Property    {string}                thumbnailUrl                The relative path to the revision thumbnail
 */

/**
 * @RESTModel PreviewFile
 *
 * @Required    [filename,size,uri]
 * @Property    {string}                filename                    The name of the file preview
 * @Property    {string}                size                        The size of the file preview        [large,medium,small,thumbnail,wide]
 * @Property    {string}                uri                         The URI of the file preview
 */

/**
 * @RESTModel PreviewLink
 *
 * @Required    [{previewFile}]
 * @Property    {string}                {previewFile}               The external URL for the named preview
 */

/**
 * @RESTModel PreviewMetadata
 *
 * @Required    []
 * @Property    {number}                pageCount                   The number of pages in the document preview
 */

/**
 * @RESTModel Previews
 *
 * @Required    []
 * @Property    {string}                cssScopeClass               The CSS class used to scope the preview stylesheet to a particular document preview
 * @Property    {boolean}               embeddable                  Whether the link allows embedding
 * @Property    {boolean}               httpsAccessible             Whether the link is accessible via
 * @Property    {string}                largeUrl                    The relative path to the large-sized preview
 * @Property    {string}                mediumUrl                   The relative path to the medium-sized preview
 * @Property    {number}                pageCount                   The number of pages in the document preview
 * @Property    {string}                smallUrl                    The relative path to the small-sized preview
 * @Property    {string}                status                      The preview processing status for the preview      [done,error,ignored,pending]
 * @Property    {number}                total                       The number of properties in the preview metadata
 * @Property    {string}                thumbnailUrl                The relative path to the preview thumbnail
 * @Property    {string}                wideUrl                     The relative path to the wide-sized preview
 */

/**
 * @RESTModel PreviewsList
 *
 * @Required    [files,signature]
 * @Property    {PreviewFile[]}         files                       The content previews
 * @Property    {Signature}             signature                   The access control signature for the previews
 */

/**
 * @RESTModel PreviewSize
 *
 * @Required    [{previewFile}]
 * @Property    {number}                {previewFile}               The size of the named preview
 */

/**
 * @RESTModel Revision
 *
 * @Required  []
 * @Property    {CollabdocRevision}     (collabdocRevision)         Used when the revision is a collaborative document revision
 * @Property    {FileRevision}          (fileRevision)              Used when the revision is a file revision
 * @Property    {LinkRevision}          (linkRevision)              Used when the revision is a link revision
 */

/**
 * @RESTModel Revisions
 *
 * @Required    [nextToken,results]
 * @Property    {string}                nextToken                   The revisions paging token needed to retrieve the next set of revisions
 * @Property    {Revision[]}            results                     List of revisions
 */

/**
 * @RESTModel Signature
 *
 * @Required    [expires, signature]
 * @Property    {number}                expires                     The timestamp (millis since epoch) at which the signature expires
 * @Property    {string}                signature                   The access control signature
 */

/**
 * @RESTModel UpdatedContent
 *
 * @Required    []
 * @Property    {string}                description                 Updated description for the content item
 * @Property    {string}                displayName                 Updated display name for the content item
 */

/**
 * @RESTModel UpdatedPreview
 *
 * @Required    []
 * @Property    {UpdatedContent}        contentMetadata             The updated metadata for the content item
 * @Property    {PreviewLink}           links                       The external links to use as preview images
 * @Property    {PreviewMetadata}       previewMetadata             The updated metadata for the content item
 * @Property    {PreviewSize}           sizes                       The size of the preview images
 */
