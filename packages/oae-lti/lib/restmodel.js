/*!
 * Copyright 2017 Apereo Foundation (AF) Licensed under the
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
 * @RESTModel LtiTool
 *
 * @Required  [id, groupId, launchUrl, secret, consumerKey, displayName, description]
 * @Property  {string}     id                     The id for the LTI tool
 * @Property  {string}     groupId                The globally unique id for the group that owns the tool
 * @Property  {string}     launchUrl              The launch UTL for the LTI tool
 * @Property  {string}     secret                 The OAUTH secret for the LTI tool
 * @Property  {date}       consumerKey            The LTI tool OAUTH consumer key
 * @Property  {number}     displayName            The name of the LTI tool (optional)
 * @Property  {number}     description            A description of the LTI tool (optional)
 */

/**
 * @RESTModel LtiLaunchParams
 *
 * @Required  [tool,version, tenantAlias, groupDisplayName, isGroupManager, groupId, principal]
 * @Property  {LtiTool} tool                LtiTool object identifying the tool being launched
 * @Property  {string} version              Hilary version
 * @Property  {string} tenantAlias          The alias of the tenant
 * @Property  {string} groupDisplayName     The displayName for the group the Lti tool is being launched in
 * @Property  {boolean} isGroupManager      Whether the user is a manager of the group of not
 * @Property  {string} groupId              The globally unique id for the group that owns the tool
 * @Property  {Me} principal                The user launching the Lti tool
 */

/**
 * @RESTModel LtiToolLaunchParams
 *
 * @Required  [tool, launchParams]
 * @Property  {LtiTool}           tool           An LtiTool object
 * @Property  {LtiLaunchParams}   launchParams   An LtiLaunchParams object
 */
