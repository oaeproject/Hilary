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

import * as OAE from 'oae-util/lib/oae';
import * as OaeUtil from 'oae-util/lib/util';

import * as UIAPI from './api.js';

/**
 * @REST getUiWidgets
 *
 * Get the aggregated list of widget manifests
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /ui/widgets
 * @Return      {WidgetConfigs}                 Object containing the list aggregated widget manifests
 * @HttpResponse                200             widget manifests available
 */
const _getWidgetManifests = function (request, response) {
  const widgetConfigs = UIAPI.getWidgetManifests();
  response.status(200).send(widgetConfigs);
};

OAE.globalAdminRouter.on('get', '/api/ui/widgets', _getWidgetManifests);
OAE.tenantRouter.on('get', '/api/ui/widgets', _getWidgetManifests);

/**
 * @REST getUiStaticbatch
 *
 * Get the content of a set of static files
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /ui/staticbatch
 * @QueryParam  {string[]}      files           Path of the file to retrieve
 * @Return      {StaticBatch}                   Object representing the retrieved files
 * @HttpResponse                200             Static content available
 * @HttpResponse                400             A valid file path needs to be provided
 * @HttpResponse                400             At least one file must be provided
 * @HttpResponse                400             Only absolute paths are allowed
 * @HttpResponse                400             The files parameter must be an array
 */
const _getStaticBatch = function (request, response) {
  const files = OaeUtil.toArray(request.query.files);

  UIAPI.getStaticBatch(files, (error, results) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(results);
  });
};

OAE.globalAdminRouter.on('get', '/api/ui/staticbatch', _getStaticBatch);
OAE.tenantRouter.on('get', '/api/ui/staticbatch', _getStaticBatch);

/**
 * @REST getUiSkin
 *
 * Get the skin for the current tenant
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /ui/skin
 * @Return      {string}                        Skin CSS file for the current tenant
 * @Produces    [text/css]
 * @HttpResponse                200             UI skin available
 */
const _getSkin = function (request, response) {
  UIAPI.getSkin(request.ctx, (error, css) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.set('Content-Type', 'text/css');
    return response.status(200).send(css);
  });
};

OAE.globalAdminRouter.on('get', '/api/ui/skin', _getSkin);
OAE.tenantRouter.on('get', '/api/ui/skin', _getSkin);

/**
 * @REST getUiLogo
 *
 * Get the logo for the current tenant
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /ui/logo
 * @Return      {string}                        Logo URL for the current tenant
 * @HttpResponse                200             UI logo available
 */
const _getLogo = function (request, response) {
  UIAPI.getLogo(request.ctx, (error, css) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(css);
  });
};

OAE.tenantRouter.on('get', '/api/ui/logo', _getLogo);

/**
 * @REST getUiSkinVariables
 *
 * Get the LESS variables that are present in the tenant skin
 *
 * @Server      admin
 * @Method      GET
 * @Path        /ui/skin/variables
 * @QueryParam  {string}        tenant          The alias of the tenant for which the variables should be retrieved
 * @Return      {SkinVariables}                 The LESS skin variables for the tenant skin
 * @HttpResponse                200             UI skin variables available
 * @HttpResponse                401             Only administrators can retrieve the skin variables
 */
OAE.globalAdminRouter.on('get', '/api/ui/skin/variables', (request, response) => {
  UIAPI.getSkinVariables(request.ctx, request.query.tenant, (error, variables) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send({ results: variables });
  });
});

/**
 * @REST getUiSkinVariables
 *
 * Get the LESS variables that are present in the tenant skin
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /ui/skin/variables
 * @Return      {SkinVariables}                 The LESS skin variables for the tenant skin
 * @HttpResponse                200             UI skin variables available
 * @HttpResponse                401             Only administrators can retrieve the skin variables
 */
OAE.tenantRouter.on('get', '/api/ui/skin/variables', (request, response) => {
  UIAPI.getSkinVariables(request.ctx, null, (error, variables) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send({ results: variables });
  });
});

/**
 * @REST uploadLogo
 *
 * Upload a new logo for a tenant
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /ui/skin/logo
 * @Return      {string}                           Non-expiring path to new logo
 * @HttpResponse                201             New logo was uploaded
 * @HttpResponse                401             Only administrators can upload a logo for tenant
 */
const _uploadLogo = function (request, response) {
  if (!request.files && !request.files.file) {
    return response.status(400).send('Missing file parameter');
  }

  UIAPI.uploadLogoFile(request.ctx, request.files.file, request.body.tenant, (error, url) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send({ url });
  });
};

OAE.globalAdminRouter.on('post', '/api/ui/skin/logo', _uploadLogo);
OAE.tenantRouter.on('post', '/api/ui/skin/logo', _uploadLogo);
