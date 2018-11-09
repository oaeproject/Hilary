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
 * @RESTModel OAuthClient
 *
 * @Required    [displayName,id,secret,userId]
 * @Property    {string}            displayName             The name of the OAuth client
 * @Property    {string}            id                      The id of the OAuth client
 * @Property    {string}            secret                  The secret for the OAuth client
 * @Property    {string}            userId                  The id of the user associated to the OAuth client
 */

/**
 * @RESTModel OAuthClientList
 *
 * @Required    [results]
 * @Property    {OAuthClient[]}     results                 List of OAuth clients
 */

/**
 * @RESTModel UserLoginIds
 *
 * @Required    []
 * @Property    {string}            <strategyName>          For each strategy name (e.g., twitter, cas, local, ...) for which the user has an authentication method, the value is the external id of the user for that strategy (e.g., twitter handle, cas id, username, respectively)
 */
