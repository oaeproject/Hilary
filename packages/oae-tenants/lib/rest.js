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

import _ from 'underscore';

import * as OAE from 'oae-util/lib/oae.js';
import * as OaeUtil from 'oae-util/lib/util.js';
import * as TenantsAPI from 'oae-tenants/lib/api.js';
import * as TenantNetworksAPI from 'oae-tenants/lib/api.networks.js';

/**
 * Tenant networks
 */

/**
 * @REST getTenantNetworks
 *
 * Get all tenant networks and their associated tenants
 *
 * @Server      admin
 * @Method      GET
 * @Path        /tenantNetworks
 * @Return      {TenantNetworks}                All available tenant networks
 * @HttpResponse                    200         Tenant networks available
 * @HttpResponse                    401         Must be a global administrator user to view tenant networks
 */
OAE.globalAdminRouter.on('get', '/api/tenantNetworks', (request, response) => {
  TenantNetworksAPI.getTenantNetworks(request.ctx, (error, tenantNetworks) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).send(tenantNetworks);
  });
});

/**
 * @REST postTenantNetworkCreate
 *
 * Create a tenant network
 *
 * @Server      admin
 * @Method      POST
 * @Path        /tenantNetwork/create
 * @FormParam   {string}                displayName     The display name of the tenant network
 * @Return      {TenantNetwork}                         The tenant network that was created
 * @HttpResponse                        201             Tenant network created
 * @HttpResponse                        400             A tenant network must contain a display name
 * @HttpResponse                        401             Must be a global administrator user to create a tenant network
 */
OAE.globalAdminRouter.on('post', '/api/tenantNetwork/create', (request, response) => {
  TenantNetworksAPI.createTenantNetwork(request.ctx, request.body.displayName, (error, tenantNetwork) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(201).send(tenantNetwork);
  });
});

/**
 * @REST postTenantNetwork
 *
 * Update a tenant network
 *
 * @Server      admin
 * @Method      POST
 * @Path        /tenantNetwork/{id}
 * @PathParam   {string}                id              The id of the tenant network to update
 * @FormParam   {string}                displayName     The new display name of the tenant network
 * @Return      {TenantNetwork}                         The updated tenant network
 * @HttpResponse                        200             Tenant network updated
 * @HttpResponse                        400             A tenant network must contain a display name
 * @HttpResponse                        400             Must specify a tenant network id
 * @HttpResponse                        401             Must be a global administrator user to update a tenant network
 */
OAE.globalAdminRouter.on('post', '/api/tenantNetwork/:id', (request, response) => {
  TenantNetworksAPI.updateTenantNetwork(
    request.ctx,
    request.params.id,
    request.body.displayName,
    (error, tenantNetwork) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).send(tenantNetwork);
    }
  );
});

/**
 * @REST deleteTenantNetworkId
 *
 * Delete a tenant network
 *
 * @Server      admin
 * @Method      DELETE
 * @Path        /tenantNetwork/{id}
 * @PathParam   {string}                id      The id of the tenant network to delete
 * @HttpResponse                        200     Tenant network deleted
 * @HttpResponse                        400     Must specify a tenant network id
 * @HttpResponse                        401     Must be a global administrator user to delete a tenant network
 */
OAE.globalAdminRouter.on('delete', '/api/tenantNetwork/:id', (request, response) => {
  TenantNetworksAPI.deleteTenantNetwork(request.ctx, request.params.id, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST postTenantNetworkIdAddTenants
 *
 * Add the provided tenant(s) to a tenant network
 *
 * @Server      admin
 * @Method      POST
 * @Path        /tenantNetwork/{id}/addTenants
 * @PathParam   {string}                    id          The id of the tenant network to which to add the provided tenant aliases
 * @FormParam   {string[]}                  alias       The tenant alias(es) to add to the tenant network
 * @Return      {void}
 * @HttpResponse                            200         Tenant added to network
 * @HttpResponse                            400         Must specify a list of tenant aliases to add
 * @HttpResponse                            400         Must specify a tenant network id
 * @HttpResponse                            400         Must specify at least one tenant alias to add
 * @HttpResponse                            400         Tenant with alias ... does not exist
 * @HttpResponse                            401         Must be a global administrator user to update a tenant network
 */
OAE.globalAdminRouter.on('post', '/api/tenantNetwork/:id/addTenants', (request, response) => {
  const tenantAliases = _.isString(request.body.alias) ? [request.body.alias] : request.body.alias;
  TenantNetworksAPI.addTenantAliases(request.ctx, request.params.id, tenantAliases, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * @REST postTenantNetworkIdRemoveTenants
 *
 * Remove the provided tenant(s) from a tenant network
 *
 * @Server      admin
 * @Method      POST
 * @Path        /tenantNetwork/{id}/removeTenants
 * @PathParam   {string}                    id          The id of the tenant network from which to remove the provided tenant aliases
 * @FormParam   {string[]}                  alias       TThe tenant alias(es) to remove from the tenant network
 * @Return      {void}
 * @HttpResponse                            200         Tenant deleted from network
 * @HttpResponse                            400         Must specify a list of tenant aliases to remove
 * @HttpResponse                            400         Must specify a tenant network id
 * @HttpResponse                            400         Must specify at least one tenant alias to remove
 * @HttpResponse                            401         Must be a global administrator user to update a tenant network
 */
OAE.globalAdminRouter.on('post', '/api/tenantNetwork/:id/removeTenants', (request, response) => {
  const tenantAliases = _.isString(request.body.alias) ? [request.body.alias] : request.body.alias;
  TenantNetworksAPI.removeTenantAliases(request.ctx, request.params.id, tenantAliases, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    return response.status(200).end();
  });
});

/**
 * Tenants
 */

/**
 * @REST postTenantCreate
 *
 * Create a new tenant
 *
 * @Server      admin
 * @Method      POST
 * @Path        /tenant/create
 * @FormParam   {string}            alias           The unique alias for the tenant
 * @FormParam   {string}            displayName     A descriptive short name for the tenant
 * @FormParam   {string}            host            The host on which this tenant will be proxying
 * @FormParam   {string[]}          [emailDomains]  The email domain expressions (e.g., *.cam.ac.uk, gmail.com) for users of this tenant (Supports multiple)
 * @FormParam   {string}            [countryCode]   The ISO-3166-1 country code of the country that represents the tenant
 * @Return      {Tenant}                            The created tenant
 * @HttpResponse                    200             Tenant created
 * @HttpResponse                    400             A tenant with the alias already exists
 * @HttpResponse                    400             A tenant with the host already exists
 * @HttpResponse                    400             The email domain expressions conflict with an existing tenant email domain expression
 * @HttpResponse                    400             Missing alias
 * @HttpResponse                    400             Missing tenant displayName
 * @HttpResponse                    400             Missing tenant host
 * @HttpResponse                    400             The tenant alias should not contain a colon
 * @HttpResponse                    400             The tenant alias should not contain a space
 */
OAE.globalAdminRouter.on('post', '/api/tenant/create', (request, response) => {
  const options = _.oaeExtendDefined({}, _.pick(request.body, 'countryCode'));
  options.emailDomains = OaeUtil.toArray(request.body.emailDomains);
  TenantsAPI.createTenant(
    request.ctx,
    request.body.alias,
    request.body.displayName,
    request.body.host,
    options,
    (error, tenant) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      response.status(200).send(tenant);
    }
  );
});

/**
 * @REST getTenants
 *
 * Get a list of all available tenants
 *
 * @Server      admin
 * @Method      GET
 * @Path        /tenants
 * @Return      {Tenants}                       All available tenants
 * @HttpResponse                200             Tenants available
 */
OAE.globalAdminRouter.on('get', '/api/tenants', (request, response) => {
  response.status(200).send(TenantsAPI.getTenants());
});

/**
 * @REST getTenantsByEmail
 *
 * Get the tenants that match an email address based on their configured email domain
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /tenantsByEmail
 * @Return      {Tenant}                        The current tenant
 * @QueryParam  {string}        emails          The emails to match tenants on
 * @HttpResponse                200             The tenants for each email address
 */
OAE.tenantRouter.on('get', '/api/tenantsByEmail', (request, response) => {
  const emails = OaeUtil.toArray(request.query.emails);
  if (_.isEmpty(emails)) {
    return response.status(400).send('Missing emails parameter');
  }

  const tenants = TenantsAPI.getTenantsForEmailDomains(emails);
  return response.status(200).send(tenants);
});

/**
 * @REST getTenant
 *
 * Get the current tenant
 *
 * @Server      admin,tenant
 * @Method      GET
 * @Path        /tenant
 * @Return      {Tenant}                        The current tenant
 * @HttpResponse                200             Current tenant available
 */
const _getCurrentTenant = function (request, response) {
  response.status(200).send(request.ctx.tenant());
};

OAE.globalAdminRouter.on('get', '/api/tenant', _getCurrentTenant);
OAE.tenantRouter.on('get', '/api/tenant', _getCurrentTenant);

/**
 * @REST getTenantAlias
 *
 * Get a tenant by alias
 *
 * @Server      admin
 * @Method      GET
 * @Path        /tenant/{alias}
 * @PathParam   {string}           alias        Alias for the tenant that should be retrieved
 * @Return      {Tenant}                        The requested tenant
 * @HttpResponse                   200          Requested tenant available
 * @HttpResponse                   404          There is no tenant with alias ...
 */
OAE.globalAdminRouter.on('get', '/api/tenant/:alias', (request, response) => {
  const tenant = TenantsAPI.getTenant(request.params.alias);
  if (!tenant) {
    return response.status(404).send('There is no tenant with alias ' + request.params.alias);
  }

  response.status(200).send(tenant);
});

/**
 * @REST postTenant
 *
 * Update the current tenant
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /tenant
 * @FormParam   {string}            [displayName]   Updated tenant display name
 * @FormParam   {string}            [host]          Updated tenant host name
 * @FormParam   {string}            [emailDomains]  Updated tenant email domain expressions
 * @FormParam   {string}            [countryCode]   Updated tenant ISO-3166-1 country code
 * @Return      {void}
 * @HttpResponse                    200             Tenant updated
 * @HttpResponse                    400             ... is not a recognized tenant update field'
 * @HttpResponse                    400             A displayName cannot be empty
 * @HttpResponse                    400             A hostname cannot be empty
 * @HttpResponse                    400             Missing alias
 * @HttpResponse                    400             The hostname has already been taken
 * @HttpResponse                    400             You should at least specify a new displayName or hostname
 * @HttpResponse                    401             Unauthorized users cannot update tenants
 * @HttpResponse                    404             Tenant with alias ... does not exist and cannot be updated
 */
OAE.tenantRouter.on('post', '/api/tenant', (request, response) => {
  const update = _.oaeExtendDefined({}, _.pick(request.body, 'displayName', 'host', 'countryCode'));
  if (_.has(request.body, 'emailDomains')) {
    update.emailDomains = OaeUtil.toArray(request.body.emailDomains);
  }

  TenantsAPI.updateTenant(request.ctx, request.ctx.tenant().alias, update, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
});

/**
 * @REST postTenantStart
 *
 * Start a tenant or tenants
 *
 * @Server      admin
 * @Method      POST
 * @Path        /tenant/start
 * @FormParam   {string[]}          aliases         A tenant alias or array of tenant aliases representing the tenants that should be started
 * @Return      {void}
 * @HttpResponse                    200             Tenant(s) started
 * @HttpResponse                    400             You must provide at least one alias to enable or disable
 * @HttpResponse                    401             You must be a global admin user to enable or disable a tenant
 * @HttpResponse                    404             Tenant with alias ... does not exist and cannot be enabled or disabled
 */
OAE.globalAdminRouter.on('post', '/api/tenant/start', (request, response) => {
  // Sets the tenant to be ENABLED by passing in 'false'
  TenantsAPI.disableTenants(request.ctx, request.body.aliases, false, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
});

/**
 * @REST postTenantStop
 *
 * Stop a tenant or tenants
 *
 * @Server      admin
 * @Method      POST
 * @Path        /tenant/stop
 * @FormParam   {string[]}          aliases         A tenant alias or array of tenant aliases representing the tenants that should be stopped
 * @Return      {void}
 * @HttpResponse                    200             Tenant(s) stopped
 * @HttpResponse                    400             You must provide at least one alias to enable or disable
 * @HttpResponse                    401             You must be a global admin user to enable or disable a tenant
 * @HttpResponse                    404             Tenant with alias ... does not exist and cannot be enabled or disabled
 */
OAE.globalAdminRouter.on('post', '/api/tenant/stop', (request, response) => {
  // Sets the tenant to be disabled by passing in 'true'
  TenantsAPI.disableTenants(request.ctx, request.body.aliases, true, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
});

/**
 * @REST postTenantAlias
 *
 * Update a tenant's metadata
 *
 * @Server      admin
 * @Method      POST
 * @Path        /tenant/{alias}
 * @PathParam   {string}            alias           The alias of the tenant to update
 * @FormParam   {string}            [displayName]   Updated tenant display name
 * @FormParam   {string}            [host]          Updated tenant host name
 * @FormParam   {string[]}          [emailDomains]  Updated tenant email domain expression
 * @FormParam   {string}            [countryCode]   Updated tenant ISO-3166-1 country code
 * @Return      {void}
 * @HttpResponse                    200             Tenant updated
 * @HttpResponse                    400             ... is not a recognized tenant update field'
 * @HttpResponse                    400             A displayName cannot be empty
 * @HttpResponse                    400             A hostname cannot be empty
 * @HttpResponse                    400             Missing alias
 * @HttpResponse                    400             The hostname has already been taken
 * @HttpResponse                    400             You should at least specify a new displayName or hostname
 * @HttpResponse                    401             Unauthorized users cannot update tenants
 * @HttpResponse                    404             Tenant with alias ... does not exist and cannot be updated
 */
OAE.globalAdminRouter.on('post', '/api/tenant/:alias', (request, response) => {
  const update = _.oaeExtendDefined({}, _.pick(request.body, 'displayName', 'host', 'countryCode'));
  if (_.has(request.body, 'emailDomains')) {
    update.emailDomains = OaeUtil.toArray(request.body.emailDomains);
  }

  TenantsAPI.updateTenant(request.ctx, request.params.alias, update, (error) => {
    if (error) {
      return response.status(error.code).send(error.msg);
    }

    response.status(200).end();
  });
});

/// ///////////////////////
// TENANT LANDING PAGES //
/// ///////////////////////

/**
 * @REST getTenantLandingPage
 *
 * Get the information to construct the landing page
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /tenant/landingPage
 * @Return      {LandingPageBlock[]}                The configured landing page
 * @HttpResponse                200                 The landing page information
 */
OAE.tenantRouter.on('get', '/api/tenant/landingPage', (request, response) => {
  const landingPage = TenantsAPI.getLandingPage(request.ctx);
  return response.status(200).send(landingPage);
});
