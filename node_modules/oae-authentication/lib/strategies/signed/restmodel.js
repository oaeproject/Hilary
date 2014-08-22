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
 * @RESTModel SignedAuthInfo
 *
 * @Required    [body,url]
 * @Property    {SignedAuthBody}    body            The POST request body
 * @Property    {string}            url             The URL to authenticate to
 */

/**
 * @RESTModel SignedAuthBody
 *
 * @Required    [expires,signature,userId]
 * @Property    {number}            expires         The timestamp (millis since epoch) at which the signed request information expires
 * @Property    {string}            signature       The signature for the signed request
 * @Property    {string}            userId          The id of the user to authenticate as
 */
