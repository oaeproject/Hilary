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
 * @RESTModel BasicTenant
 *
 * @Required    [alias,displayName]
 * @Property    {string}        alias                   The unique alias of the tenant
 * @Property    {string}        displayName             A descriptive name for the tenant
 */

/**
 * @RESTModel Tenant
 *
 * @Required    [alias,displayName,host]
 * @Property    {string}        alias                   The unique alias of the tenant
 * @Property    {string}        displayName             A descriptive name for the tenant
 * @Property    {string}        host                    The host on which this tenant is proxying
 * @Property    {boolean}       active                  Whether or not the tenant is active
 * @Property    {boolean}       isGlobalAdminServer     Whether or not the tenant is the global admin tenant.
 */

/**
 * @RESTModel TenantNetwork
 *
 * @Required  [displayName, id]
 * @Property  {string}              displayName         The display name of the tenant network
 * @Property  {string}              id                  The unique id of the tenant network
 * @Property  {Tenant[]}            tenants             Tenants associated with tenant network
 */

/**
 * @RESTModel TenantNetworks
 *
 * @Required  []
 * @Property  {TenantNetwork}       {id}                The unique id of the tenant network
 */

/**
 * @RESTModel Tenants
 *
 * @Required  []
 * @Property  {Tenant}              {tenantAlias}       Information for named tenant
 */

/**
 * @RESTModel LandingPageBlock
 *
 * @Required  [lg, md, sm, type, xs]
 * @Property  {string}              bgColor                 Background color for the block
 * @Property  {string}              icon                    Icon for the block
 * @Property  {string}              imgUrl                  Image URL
 * @Property  {string}              lg                      Block width at large resolution
 * @Property  {string}              md                      Block width at medium resolution
 * @Property  {string}              minHeight               Minimum height for the block in pixels
 * @Property  {string}              sm                      Block width at small resolution
 * @Property  {string}              text                    Text content for the block
 * @Property  {string}              textColor               Text color for the block
 * @Property  {string}              titleColor              Title color for the block
 * @Property  {string}              type                    The block type
 * @Property  {string}              videoPlaceholder        Video placeholder URL
 * @Property  {string}              videoUrl                Video URL
 * @Property  {string}              xs                      Block width at extra small resolution
 */
