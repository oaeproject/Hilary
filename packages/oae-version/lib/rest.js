/*!
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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
import * as VersionAPI from './api.js';

const _getVersion = async function (request, response) {
  try {
    const repoInformation = await VersionAPI.getVersion();
    return response.status(200).send(JSON.stringify(repoInformation));
  } catch {
    const message = 'Unable to gather repo information';
    return response.status(500).send(message);
  }
};

/**
 * @REST getVersion
 *
 * Get the version information of the currently running OAE software
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /version
 * @Return      {VersionInfo}                     The currently running versions
 * @HttpResponse                    200           The version information will be returned
 */
OAE.tenantRouter.on('get', '/api/version', _getVersion);
OAE.globalAdminRouter.on('get', '/api/version', _getVersion);
