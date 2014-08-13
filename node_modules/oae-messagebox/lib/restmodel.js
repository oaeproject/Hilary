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
 * @RESTModel Message
 *
 * @Required    [body,created,id,level]
 * @Property    {string}        body                    The body of the message
 * @Property    {number}        created                 The timestamp (millis since epoch) at which the message was created
 * @Property    {string}        id                      The id of the message
 * @Property    {number}        level                   The depth of the message. The top level is `0`
 * @Property    {BasicUser}     createdBy               The user who created the message
 * @Property    {string}        deleted                 The timestamp (millis since epoch) at which the message was soft deleted
 * @Property    {string}        messageBoxId            The id of the message box in which this message is contained
 * @Property    {string}        replyTo                 The timestamp of the message to which this message is a reply
 * @Property    {string}        threadKey               The thread key for the message
 */

/**
 * @RESTModel MessagesResponse
 *
 * @Required    [nextToken,results]
 * @Property    {string}        nextToken               The message paging token needed to retrieve the next set of messages
 * @Property    {Message[]}     results                 List of messages
 */
