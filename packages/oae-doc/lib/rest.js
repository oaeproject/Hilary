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

import * as OAE from 'oae-util/lib/oae.js';
import * as Swagger from 'oae-util/lib/swagger.js';
import { getModuleDocumentation, getModules } from './api.js';

/**
 * @REST getDocType
 *
 * Retrieve the list of available back-end or front-end modules
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /doc/{type}
 * @PathParam   {string}     type         The type of modules to list        [backend, frontend]
 * @Return      {string[]}                The list of available modules for the provided type
 * @HttpResponse             200          List of documentation modules available
 * @HttpResponse             400          Invalid or missing module type. Accepted values are "backend" and "frontend"
 */
const _getDocModulesByType = function (request, response) {
  getModules(request.params.type, function (error, modules) {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).send(modules);
  });
};
