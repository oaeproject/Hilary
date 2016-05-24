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
 * @RESTModel BasicUser
 *
 * @Required    [displayName,id,lastModified,profilePath,resourceType,tenant,visibility]
 * @Property    {string}            displayName             The display name for the user
 * @Property    {string}            id                      The id of the user
 * @Property    {number}            lastModified            The timestamp (millis since epoch) at which the user was last modified
 * @Property    {PrincipalPicture}  picture                 The thumbnail for the user
 * @Property    {string}            profilePath             The relative path to the user profile
 * @Property    {string}            resourceType            The resource type of the user             [user]
 * @Property    {BasicTenant}       tenant                  The tenant to which this user is associated
 * @Property    {string}            visibility              The visibility of the user                [loggedin,private,public]
 */

/**
 * @RESTModel BasicGroup
 *
 * @Required    [displayName,id,joinable,lastModified,profilePath,resourceType,tenant,visibility]
 * @Property    {string}            description             The description for the group
 * @Property    {string}            displayName             The display name for the group
 * @Property    {string}            id                      The id of the group
 * @Property    {string}            joinable                How the group can be joined               [no,request,yes]
 * @Property    {number}            lastModified            The timestamp (millis since epoch) at which the group was last modified
 * @Property    {PrincipalPicture}  picture                 The thumbnail for the group
 * @Property    {string}            profilePath             The relative path to the group profile
 * @Property    {string}            resourceType            The resource type of the group            [group]
 * @Property    {BasicTenant}       tenant                  The tenant to which this group is associated
 * @Property    {string}            visibility              The visibility of the group               [loggedin,private,public]
 */

/**
 * @RESTModel BasicPrincipal
 *
 * @Required    []
 * @Property    {BasicGroup}        (basicGroup)            Used when the principal is a group
 * @Property    {BasicUser}         (basicUser)             Used when the principal is a user
 */

/**
 * @RESTModel FollowingInfo
 *
 * @Required    [canFollow,isFollowing]
 * @Property    {boolean}           canFollow               Whether or not the current user is allowed to follow the user
 * @Property    {boolean}           isFollowing             Whether or not the current user is following the user
 */

/**
 * @RESTModel Group
 *
 * @Required    [canJoin,displayName,id,isMember,isManager,joinable,lastModified,profilePath,resourceType,tenant,visibility]
 * @Property    {string}            canJoin                 Whether or not the current user can join the group
 * @Property    {BasicUser}         createdBy               The user that created the group
 * @Property    {string}            description             The description for the group
 * @Property    {string}            displayName             The display name for the group
 * @Property    {string}            id                      The id of the group
 * @Property    {boolean}           isManager               Whether or not the current user is a manager of the group
 * @Property    {boolean}           isMember                Whether or not the current user is a member of the group
 * @Property    {string}            joinable                How the group can be joined               [no,request,yes]
 * @Property    {number}            lastModified            The timestamp (millis since epoch) at which the group was last modified
 * @Property    {PrincipalPicture}  picture                 The thumbnail for the group
 * @Property    {string}            profilePath             The relative path to the group profile
 * @Property    {string}            resourceType            The resource type of the group            [group]
 * @Property    {BasicTenant}       tenant                  The tenant to which this group is associated
 * @Property    {string}            visibility              The visibility of the group               [loggedin,private,public]
 */

/**
 * @RESTModel GroupMembersUpdate
 *
 * @Required    []
 * @Property    {boolean}           {principalId}           The role to apply to the named principal. If the value is `false`, the principal will be revoked access       [false,manager,member]
 */

/**
 * @RESTModel Me
 *
 * @Required    [tenant]
 * @Property    {number}            acceptedTC              The timestamp (millis since epoch) at which the user accepted the Terms and Conditions
 * @Property    {boolean}           anon                    Whether or not the current user is anonymous
 * @Property    {string}            authenticationStrategy  The authentication strategy with which the user is authenticated       [cas,facebook,google,ldap,local,oauth,shibboleth,signed,twitter]
 * @Property    {string}            displayName             The display name for the user
 * @Property    {string}            email                   The email address for the user
 * @Property    {string}            emailPreference         The email preference for the user       [daily,immediate,weekly]
 * @Property    {string}            id                      The id of the user
 * @Property    {boolean}           isGlobalAdmin           Whether or not the user is a global administrator
 * @Property    {boolean}           isTenantAdmin           Whether or not the user is a tenant administrator
 * @Property    {number}            lastModified            The timestamp (millis since epoch) at which the user was last modified
 * @Property    {string}            locale                  The locale for the user
 * @Property    {boolean}           needsToAcceptTC         Whether or not the user needs to accept the Terms and Conditions before the system can be used
 * @Property    {number}            notificationsLastRead   The timestamp (millis since epoch) at which the user last read its notification stream
 * @Property    {number}            notificationsUnread     The number of unread notifications for the user
 * @Property    {PrincipalPicture}  picture                 The thumbnail for the user
 * @Property    {string}            profilePath             The relative path to the user profile
 * @Property    {string}            publicAlias             The name to show when the user is inaccessible to a user
 * @Property    {string}            resourceType            The resource type of the user            [user]
 * @Property    {BasicTenant}       tenant                  The tenant to which this user is associated
 * @Property    {string}            visibility              The visibility of the user               [loggedin,private,public]
 */

/**
 * @RESTModel MembershipsResponse
 *
 * @Required    [nextToken,results]
 * @Property    {string}            nextToken               The membership paging token needed to retrieve the next set of group memberships
 * @Property    {BasicGroup[]}      results                 The principal's group memberships, either directly or indirectly
 */

/**
 * @RESTModel MembersResponse
 *
 * @Required    [nextToken,results]
 * @Property    {string}            nextToken               The members paging token needed to retrieve the next set of members
 * @Property    {BasicPrincipal[]}  results                 The members of the entity
 */

/**
 * @RESTModel RecentGroupsResponse
 *
 * @Required    [results]
 * @Property    {BasicGroup[]}      results                 The users's recently visited groups
 */

/**
 * @RESTModel Principal
 *
 * @Required    []
 * @Property    {Group}             (group)                 Used when the principal is a group
 * @Property    {User}              (user)                  Used when the principal is a user
 */

/**
 * @RESTModel PrincipalPicture
 *
 * @Required    []
 * @Property    {string}            large                   The path for the large principal thumbnail
 * @Property    {string}            medium                  The path for the medium principal thumbnail
 * @Property    {string}            small                   The path for the small principal thumbnail
 */

/**
 * @RESTModel TermsAndConditions
 *
 * @Required    [lastUpdate,text]
 * @Property    {number}            lastUpdate              The timestamp (millis since epoch) at which the Terms and Conditions were last modified
 * @Property    {string}            text                    The text for the Terms and Conditions
 */

/**
 * @RESTModel User
 *
 * @Required    [displayName,id,lastModified,profilePath,resourceType,tenant,visibility]
 * @Property    {string}            displayName             The display name for the user
 * @Property    {FollowingInfo}     following               The following status of the current user for the user
 * @Property    {string}            id                      The id for the user
 * @Property    {number}            lastModified            The timestamp (millis since epoch) at which the user was last modified
 * @Property    {PrincipalPicture}  picture                 The thumbnail for the user
 * @Property    {string}            profilePath             The relative path to the user profile
 * @Property    {string}            resourceType            The resource type of the user            [user]
 * @Property    {BasicTenant}       tenant                  The tenant to which this user is associated
 * @Property    {string}            visibility              The visibility of the user               [loggedin,private,public]
 */

