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

import * as OAE from 'oae-util/lib/oae';
import * as LtiApi from './api.js';

/**
 * @REST getLtiTool
 *
 * Get the specific LTI tool
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /lti/{groupId}/{id}
 * @PathParam   {string}                groupId             The id of the group this LTI tool belongs to
 * @PathParam   {string}                id                  The id of the LTI tool to get
 * @Return      {LtiToolLaunchParams}                       An object containing information required to launch the LTI tool
 * @HttpResponse                        200                 Tool launch info available
 * @HttpResponse                        404                 The LTI tool could not be found
 * @HttpResponse                        401                 The current user does not have access to this LTI tool
 */
OAE.tenantRouter.on('get', '/api/lti/:groupId/:id', (request, response) => {
  LtiApi.getLtiTool(request.ctx, request.params.id, request.params.groupId, (error, tool) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(tool);
  });
});

/**
 * @REST postLtiToolCreate
 *
 * Create a new LTI tool
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /lti/{groupId}/create
 * @PathParam   {string}        groupId                 The id of the group this LTI tool belongs to
 * @FormParam   {string}        url                     The launch URL for the new LTI tool
 * @FormParam   {string}        secret                  The OAUTH secret for the new LTI tool
 * @FormParam   {string}        key                     The OAUTH consumer key for the new LTI tool
 * @FormParam   {string}        [displayName]           The name of the new LTI tool (resource_link_title)
 * @FormParam   {string}        [description]           A description of the new LTI tool (resource_link_description)
 * @Return      {LtiTool}                               The created LTI tool
 * @HttpResponse                201                     LTI tool created
 * @HttpResponse                400                     A valid group id must be provided
 * @HttpResponse                400                     You need to provide a valid ID for this LTI tool
 * @HttpResponse                400                     You need to provide a launch URL for this LTI tool
 * @HttpResponse                400                     You need to provide an OAUTH secret for this LTI tool
 * @HttpResponse                400                     You need to provide an OAUTH consumer key this LTI tool
 * @HttpResponse                401                     Unauthorized
 */
OAE.tenantRouter.on('post', '/api/lti/:groupId/create', (request, response) => {
  const options = {
    displayName: request.body.displayName,
    description: request.body.description
  };
  LtiApi.addLtiTool(
    request.ctx,
    request.params.groupId,
    request.body.url,
    request.body.secret,
    request.body.key,
    options,
    (error, tool) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(201).send(tool);
    }
  );
});

/**
 * @REST getLtiTools
 *
 * Get all LTI tools for a given group
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /lti/{groupId}
 * @PathParam   {string}        groupId                     The id of the group to fetch LTI tools for
 * @Return      {LtiTool[]}                                 A list of LTI tools for the group
 * @HttpResponse                200                         LTI tools available
 * @HttpResponse                400                         Must provide a groupId
 * @HttpResponse                404                         No LTI tools were found for the given group
 */
OAE.tenantRouter.on('get', '/api/lti/:groupId', (request, response) => {
  LtiApi.getLtiTools(request.ctx, request.params.groupId, (error, results) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send({ results });
  });
});

/**
 * @REST deleteLtiTool
 *
 * @Server      tenant
 * @Method      DELETE
 * @Path        /lti/{groupId}/{id}
 * @PathParam   {string}        groupId     The id of the group the LTI tool belongs to
 * @PathParam   {string}        id          The id of the LTI tool to delete
 * @HttpResponse                200         The LTI tool was successfully deleted
 * @HttpResponse                400         An invalid LTI tool id was specified
 * @HttpResponse                401         You do not have access to delete this LTI tool
 * @HttpResponse                404         The LTI tool did not exist
 */
OAE.tenantRouter.on('delete', '/api/lti/:groupId/:id', (request, response) => {
  LtiApi.deleteLtiTool(request.ctx, request.params.id, request.params.groupId, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});
