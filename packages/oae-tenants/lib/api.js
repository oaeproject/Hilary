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

import util from 'util';
import { logger } from 'oae-logger';

import _ from 'underscore';
import async from 'async';

// We have to require the config api inline, as this would
// otherwise lead to circular require calls
import { setUpConfig, eventEmitter } from 'oae-config';
// We have to require the UI api inline, as this would
// otherwise lead to circular require calls
import * as UIAPI from 'oae-ui';
import * as UserAPI from 'oae-principals/lib/api.user';
import * as Cassandra from 'oae-util/lib/cassandra';
import * as EmitterAPI from 'oae-emitter';
import * as OAE from 'oae-util/lib/oae';
import * as OaeUtil from 'oae-util/lib/util';
import * as Pubsub from 'oae-util/lib/pubsub';
import { Validator } from 'oae-util/lib/validator';
import TenantEmailDomainIndex from './internal/emailDomainIndex';
import TenantIndex from './internal/tenantIndex';
import * as TenantNetworksDAO from './internal/dao.networks';
import * as TenantsUtil from './util';

import { Tenant } from './model';

const TenantsConfig = setUpConfig('oae-tenants');

const log = logger('oae-tenants');

// Caches the server configuration as specified in the config.js file
let serverConfig = null;

// Caches the available tenants, keyed by their alias
let tenants = {};

// Caches the available tenants, keyed by their hostname. This will be used for
// quick look-ups when checking whether or not a hostname is associated to a tenant
let tenantsByHost = {};

// Caches all tenants that cannot interact externally
let tenantsNotInteractable = {};

// Caches the available tenants sorted by alias
let tenantsSorted = [];

// Caches the global administration tenant object
let globalTenant = null;

// Caches a search index for all tenants in the system
let tenantSearchIndex = null;

// Caches an email domain index for all tenants in the system
let tenantEmailDomainIndex = null;

/**
 * ### Events
 *
 * The `TenantsAPI` emits the following events:
 *
 * * `cached`: The tenants have been cached
 * * `created(tenant)`: A tenant has been created
 * * `preCache`: An operation triggered an update of the cache. The `cached` event will be emitted once the tenants have been re-cached
 * * `refresh(tenant)`: A request has been received to "refresh" the metadata of a tenant
 * * `start(tenant)`: A request has been received to "start" a tenant
 * * `stop(tenant)`: A request has been received to "stop" a tenant
 */
const TenantsAPI = new EmitterAPI.EventEmitter();

/*!
 * Listen for cluster wide requests involving tenants
 *
 * @param  {String}  message    A brief command in the form of `start cam`, `stop cam` or `refresh cam`
 */
Pubsub.emitter.on('oae-tenants', message => {
  const args = message.split(' ');
  const cmd = args.shift();
  const alias = args.shift();

  _updateCachedTenant(alias, err => {
    if (err) {
      log().error({ err, cmd, alias }, 'An error occurred while refreshing a tenant after update');
    }

    TenantsAPI.emit(cmd, getTenant(alias));
  });
});

/*!
 * Listen for configuration update events. If a tenant is made public or private, we need to update
 * their cached status in the tenantsNotInteractable cache
 */
eventEmitter.on('update', alias => {
  return _updateCachedTenant(alias);
});

/**
 * Initialize the middleware that will put the tenant object onto the request and cache all of the registered
 * tenants
 *
 * @param  {Object}         serverConfig        Server configuration object containing global admin tenant information
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 */
const init = function(_serverConfig, callback) {
  // Cache the server configuration
  serverConfig = _serverConfig;

  // This middleware adds the tenant to each request on the global admin server
  OAE.globalAdminServer.use((req, res, next) => {
    req.tenant = globalTenant;
    return next();
  });

  // This middleware adds the tenant to each request on the user tenant server
  OAE.tenantServer.use((req, res, next) => {
    if (serverConfig.shibbolethSPHost && req.headers.host === serverConfig.shibbolethSPHost) {
      req.tenant = new Tenant('shib-sp', 'Shibboleth SP hardcoded host', serverConfig.shibbolethSPHost, {
        active: true
      });
    } else {
      req.tenant = getTenantByHost(req.headers.host);
    }

    // We stop the request if we can't find a tenant associated to the current hostname
    if (!req.tenant) {
      res.setHeader('Connection', 'Close');
      return res.status(418).send('This hostname is not associated to any tenant');
    }

    // Check whether or not the tenant has been disabled
    if (!req.tenant.active) {
      // If the tenant has been stopped, there is no point in keeping connections open
      res.setHeader('Connection', 'Close');
      return res.status(503).send('This server is currently disabled. Please check back later.');
    }

    return next();
  });

  // Cache the available tenants
  _cacheTenants(err => {
    if (err) {
      return callback(err);
    }

    TenantNetworksDAO.init();

    // Check if a guest tenant is created
    const { guestTenantHost, guestTenantAlias } = serverConfig;
    const guestTenant = getTenant(guestTenantAlias);
    if (guestTenant) {
      return callback();
    }

    // If the guest tenant doesn't exist yet, create it
    _createTenant(guestTenantAlias, 'Guest tenant', guestTenantHost, null, err => {
      if (err) {
        return callback(err);
      }

      return callback();
    });
  });
};

/**
 * Get a list of all available tenants from cache. The global admin tenant will be excluded from the resulting tenant list
 *
 * @param  {Boolean}    [excludeDisabled]   Whether or not disabled tenants should be included. By default, all tenants will be returned
 * @return {Object}                         An object keyed by tenant alias holding all the tenants
 */
const getTenants = function(excludeDisabled) {
  excludeDisabled = OaeUtil.castToBoolean(excludeDisabled);

  const filteredTenants = {};
  _.each(tenants, (tenant, tenantAlias) => {
    // Exclude all disabled tenants when `exludeDisabled` has been provided
    if (!tenant.isGlobalAdminServer && (!excludeDisabled || tenant.active)) {
      filteredTenants[tenantAlias] = _copyTenant(tenant);
    }
  });

  return filteredTenants;
};

/**
 * Get a list of all tenants that cannot be interacted with. It includes only disabled tenants,
 * deleted tenants and tenants that are configured to be "private"
 *
 * @return {Tenant[]}   The list of tenants that cannot be interacted with
 */
const getNonInteractingTenants = function() {
  return _.map(tenantsNotInteractable, _copyTenant);
};

/**
 * Search for tenants based on a full-text search query
 *
 * @param  {String}         [q]                 The full-text query to perform. If unspecified, all tenants will be returned
 * @param  {Object}         [opts]              Optional arguments
 * @param  {Number}         [opts.start]        The index at which to begin returning results
 * @param  {Number}         [opts.limit]        The maximum number of results to return. If unspecified, returns all results
 * @param  {Boolean}        [opts.disabled]     If `true`, will include tenants that are disabled or deleted. Otherwise, they are ommitted from results
 * @return {SearchResult}                       The search result object containing the tenants
 */
const searchTenants = function(q, opts) {
  q = _.isString(q) ? q.trim() : null;
  opts = opts || {};
  opts.start = OaeUtil.getNumberParam(opts.start, 0);

  // Determine if we should included disabled/deleted tenants
  const includeDisabled = _.isBoolean(opts.disabled) ? opts.disabled : false;

  // Create a sorted result of tenants based on the user's query. If there was no query, we will
  // pull the pre-sorted list of tenants from the global cache
  let results = null;
  if (q) {
    results = _.chain(tenantSearchIndex.search(q))
      .sortBy('ref')
      .sortBy('score')
      .pluck('ref')
      .map(getTenant)
      .value();
  } else {
    results = tenantsSorted;
  }

  results = _.filter(results, result => {
    if (result.isGlobalAdminServer) {
      return false;
    }

    if (!includeDisabled) {
      return result.active && !result.deleted;
    }

    return true;
  });

  // Keep track of how many results we had in total
  const total = _.size(results);

  // Determine the end of our page slice
  opts.limit = OaeUtil.getNumberParam(opts.limit, total);
  const end = opts.start + opts.limit;

  // Cut down to just the requested page, and clone the tenants to avoid tenants being updated
  // in the cache
  results = results.slice(opts.start, end);
  results = _.map(results, _copyTenant);

  return {
    total,
    results
  };
};

/**
 * Get a tenant by alias from cache
 *
 * @param  {String}         tenantAlias         Alias for the tenant that should be retrieved
 * @return {Tenant}                             Tenant object associated to the provided tenant alias
 */
const getTenant = function(tenantAlias) {
  return _copyTenant(tenants[tenantAlias]);
};

/**
 * Get a tenant by host name from cache
 *
 * @param  {String}         tenantHost          Host name for the tenant that should be retrieved
 * @return {Tenant}                             Tenant object associated to the provided tenant host
 */
const getTenantByHost = function(tenantHost) {
  return _copyTenant(tenantsByHost[tenantHost.toLowerCase()]);
};

/**
 * Get a tenant whose configured email domain matches the specified email domain. If a host is
 * provided, it will simply match on the host. If an email address is provided (i.e., contains a @),
 * then the match is provided on only the host portion of the email address.
 *
 * If no tenant matches the specified email, then the guest tenant is returned as it implicitly
 * matches all email domains.
 *
 * @param  {String}     emailOrDomain   The email address or domain with which to lookup the tenant
 * @return {Tenant}                     The tenant that matches the domain, if any
 */
const getTenantByEmail = function(emailOrDomain) {
  const domain = _.last(emailOrDomain.split('@'));
  const tenantAlias = tenantEmailDomainIndex.match(domain);

  // Default to the guest tenant
  const guestTenant = tenants[serverConfig.guestTenantAlias];
  const tenant = tenants[tenantAlias] || guestTenant;

  // If the tenant is disabled, return guest tenant
  if (!tenant.active) {
    return guestTenant;
  }

  return _copyTenant(tenant);
};

/**
 * Get the tenants for a set of email addresses or domains
 *
 * @param  {String[]}   emailsOrDomains     The email addresses or domains to get the tenants for
 * @return {Object}                         An object mapping each email or domain to its tenant or the guest tenant
 */
const getTenantsForEmailDomains = function(emailsOrDomains) {
  const mappedTenants = {};
  _.each(emailsOrDomains, emailOrDomain => {
    mappedTenants[emailOrDomain] = getTenantByEmail(emailOrDomain);
  });

  return mappedTenants;
};

/**
 * Fetch the available tenants and cache them
 *
 * @param  {Function}       [callback]          Standard callback function
 * @param  {Object}         [callback.err]      Error object containing the error code and message
 * @api private
 */
const _cacheTenants = function(callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err }, 'Failed to re-cache the tenants');
      }
    };

  // Get the available tenants
  const queryAllTenants = 'SELECT * FROM "Tenant"';
  Cassandra.runAutoPagedQuery(queryAllTenants, false, (err, rows) => {
    if (err) {
      return callback(err);
    }

    // Reset the previously cached tenants
    tenants = {};
    tenantsByHost = {};
    tenantsNotInteractable = {};

    // Build the email domain index for all tenants
    tenantEmailDomainIndex = new TenantEmailDomainIndex();

    // Create a dummy tenant object that can serve as the global admin tenant object
    globalTenant = new Tenant(serverConfig.globalAdminAlias, 'Global admin server', serverConfig.globalAdminHost, {
      isGlobalAdminServer: true
    });

    // Cache it as part of the available tenants
    tenants[globalTenant.alias] = globalTenant;
    tenantsByHost[globalTenant.host] = globalTenant;
    tenantsNotInteractable[globalTenant.alias] = globalTenant;

    _.chain(rows)
      .map(Cassandra.rowToHash)
      .map(hash => {
        return _storageHashToTenant(hash.alias, hash);
      })
      .each(tenant => {
        // Cache all tenants
        tenants[tenant.alias] = tenant;
        tenantsByHost[tenant.host] = tenant;

        // Insert the tenant into the email domain index
        _.each(tenant.emailDomains, emailDomain => {
          tenantEmailDomainIndex.update(tenant.alias, emailDomain);
        });

        // Keep a cache of all tenants that are private and disabled so we know which ones
        // cannot be interacted with
        if (!tenant.active || tenant.deleted || TenantsUtil.isPrivate(tenant.alias)) {
          tenantsNotInteractable[tenant.alias] = tenant;
        }
      })
      .value();

    // Cache the sorted list
    tenantsSorted = _.sortBy(tenants, 'alias');

    // Build the search index for all tenants
    tenantSearchIndex = new TenantIndex(tenants);

    // Indicate that all tenants have been cached
    TenantsAPI.emit('cached');

    return callback(null, tenants);
  });
};

/**
 * Fetch the tenant and update it's entry in the cache
 *
 * @param  {String}         tenantAlias         The alias of the tenant to be re-cached
 * @param  {Function}       [callback]          Standard callback function
 * @param  {Object}         [callback.err]      Error object containing the error code and message
 * @api private
 */
const _updateCachedTenant = function(tenantAlias, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err, tenantAlias }, 'Failed to re-cache the specified tenant');
      }
    };

  // Get the available tenants
  Cassandra.runQuery('SELECT * FROM "Tenant" WHERE "alias" = ?', [tenantAlias], (err, rows) => {
    if (err) {
      return callback(err);
    }

    if (_.isEmpty(rows)) {
      TenantsAPI.emit('cached');
      return callback();
    }

    const hash = Cassandra.rowToHash(rows[0]);
    const tenant = _storageHashToTenant(tenantAlias, hash);

    // Remove the old tenant from the tenantsByHost cache if it previously existed. If the host
    // was updated, we want to make sure it gets removed here
    const oldTenant = tenants[tenantAlias];
    if (oldTenant) {
      delete tenantsByHost[oldTenant.host];

      // Remove the old email domains
      _.each(oldTenant.emailDomains, emailDomain => {
        tenantEmailDomainIndex.delete(emailDomain);
      });
    }

    // Re-cache the tenant we pulled from storage
    tenants[tenant.alias] = tenant;
    tenantsByHost[tenant.host] = tenant;

    // Update the tenant in the email domain index
    _.each(tenant.emailDomains, emailDomain => {
      const conflictingTenantAlias = tenantEmailDomainIndex.update(tenantAlias, emailDomain);
      if (conflictingTenantAlias) {
        log().warn(
          {
            tenant,
            oldTenant,
            conflictingTenantAlias
          },
          'Failed to update tenant in the email domain index due to a conflicting domain'
        );
      }
    });

    // Synchronize the cache of all tenants that are private and disabled so we know which ones
    // cannot be interacted with
    if (tenant.isGlobalAdminServer || !tenant.active || tenant.deleted || TenantsUtil.isPrivate(tenant.alias)) {
      tenantsNotInteractable[tenant.alias] = tenant;
    } else {
      delete tenantsNotInteractable[tenant.alias];
    }

    // Insert at the correct location in the sorted list
    let index = _.findIndex(tenantsSorted, tenant => {
      return tenant.alias === tenantAlias;
    });
    if (index === -1) {
      index = _.sortedIndex(tenantsSorted, tenant, 'alias');
      tenantsSorted.splice(index, 0, tenant);
    } else {
      tenantsSorted[index] = tenant;
    }

    // Update the tenant in the search index
    tenantSearchIndex.update(tenant);

    // Indicate that all tenants have been cached
    TenantsAPI.emit('cached');

    return callback(null, tenants);
  });
};

/**
 * Create a new tenant and spin it up on the fly
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     alias                   The unique alias for the tenant
 * @param  {String}     displayName             A descriptive short name for the tenant
 * @param  {String}     host                    The host on which this tenant will be proxying (e.g. oae.cam.ac.uk or oae.gatech.edu)
 * @param  {Object}     [opts]                  Optional arguments
 * @param  {String}     [opts.emailDomains]     The email domains for this tenant
 * @param  {String}     [opts.countryCode]      The ISO-3166-1 country code of the country that represents the tenant
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Tenant}     callback.tenant         The created tenant
 */
const createTenant = function(ctx, alias, displayName, host, opts, callback) {
  opts = opts || {};

  // Validate that the user in context is the global admin
  const validator = new Validator();
  validator
    .check(null, { code: 401, msg: 'Only global administrators can create new tenants' })
    .isGlobalAdministratorUser(ctx);
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  // Defer the rest of the validation to the internal version of this method that does not take
  // into consideration the current context
  return _createTenant(alias, displayName, host, opts, callback);
};

/**
 * Create a new tenant and spin it up on the fly, without performing any permission checks
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     alias                   The unique alias for the tenant
 * @param  {String}     displayName             A descriptive short name for the tenant
 * @param  {String}     host                    The host on which this tenant will be proxying (e.g. oae.cam.ac.uk or oae.gatech.edu)
 * @param  {Object}     [opts]                  Optional arguments
 * @param  {String}     [opts.emailDomains]     The email domains for this tenant
 * @param  {String}     [opts.countryCode]      The ISO-3166-1 country code of the country that represents the tenant
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Tenant}     callback.tenant         The created tenant
 * @api private
 */
const _createTenant = function(alias, displayName, host, opts, callback) {
  opts = opts || {};

  const validator = new Validator();
  validator.check(alias, { code: 400, msg: 'Missing alias' }).notEmpty();
  validator.check(alias, { code: 400, msg: 'The tenant alias should not contain a space' }).notContains(' ');
  validator.check(alias, { code: 400, msg: 'The tenant alias should not contain a colon' }).notContains(':');
  validator.check(displayName, { code: 400, msg: 'Missing tenant displayName' }).notEmpty();
  validator.check(host, { code: 400, msg: 'Missing tenant host' }).notEmpty();
  validator.check(host, { code: 400, msg: 'Invalid hostname' }).isHost();
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  // Make sure alias and host are the proper case
  alias = alias.toLowerCase();
  host = host.toLowerCase();

  // Ensure there are no conflicts
  validator.check(host, { code: 400, msg: 'This hostname is reserved' }).not(serverConfig.shibbolethSPHost);
  validator
    .check(getTenant(alias), {
      code: 400,
      msg: util.format('A tenant with the alias "%s" already exists', alias)
    })
    .isNull();
  validator
    .check(getTenantByHost(host), {
      code: 400,
      msg: util.format('A tenant with the host "%s" already exists', host)
    })
    .isNull();

  // Ensure only valid optional fields are set
  _.each(opts, (val, key) => {
    validator
      .check(key, { code: 400, msg: util.format('Invalid field: %s', key) })
      .isIn(['emailDomains', 'countryCode']);
    if (key === 'emailDomains') {
      validator
        .check(null, {
          code: 400,
          msg: 'One or more email domains were passed in, but not as an array'
        })
        .isArray(val);
      if (!validator.hasErrors()) {
        // Ensure the tenant email domains are all lower case
        opts[key] = _.map(opts[key], emailDomain => {
          return emailDomain.trim().toLowerCase();
        });
        _validateEmailDomains(validator, opts[key]);
      }
    } else if (key === 'countryCode' && opts[key]) {
      // Ensure the country code is upper case
      opts[key] = opts[key].toUpperCase();
      validator
        .check(opts[key], {
          code: 400,
          msg: 'The country code must be a valid ISO-3166 country code'
        })
        .isIso3166Country();
    }
  });
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  // Create the tenant
  const tenant = new Tenant(alias, displayName, host, opts);
  const q = Cassandra.constructUpsertCQL('Tenant', 'alias', alias, _tenantToStorageHash(tenant));
  Cassandra.runQuery(q.query, q.parameters, err => {
    if (err) {
      return callback(err);
    }

    // This event is not strictly necessary as it will be emitted by our PubSub publisher
    // as well. We emit it before we return to the caller so our unit tests can keep track
    // of config updates BEFORE the REST request completes. If we didn't there would be a
    // short period between the REST request returning and the config re-caching where the
    // config would be out-of-date. The length of this period is determined by how fast Redis
    // can broadcast the pubsub messages. When the system is under load and suffering from IO
    // starvation (such as during unit tests) this could lead to intermittent test failures.
    // The downside of emitting this event here is that it will lead to authentication strategies
    // and config elements being recached twice
    TenantsAPI.emit('created', tenant);

    // Indicate that a caching operation is pending
    TenantsAPI.emit('preCache');

    // Send a message to all the app servers in the cluster notifying them that the tenant should be started
    Pubsub.publish('oae-tenants', 'created ' + tenant.alias, err => {
      if (err) {
        return callback(err);
      }

      return callback(null, tenant);
    });
  });
};

/**
 * Update a tenant's metadata
 *
 * @param  {Context}    ctx                             Standard context object containing the current user and the current tenant
 * @param  {String}     alias                           The alias of the tenant to update
 * @param  {Object}     tenantUpdates                   Object where the keys represents the metadata identifiers and the values represent the new metadata values
 * @param  {String}     [tenantUpdates.displayName]     Updated tenant display name
 * @param  {String}     [tenantUpdates.host]            Updated tenant host name
 * @param  {String}     [tenantUpdates.emailDomains]    Updated tenant email domains
 * @param  {String}     [tenantUpdates.countryCode]     Updated tenant ISO-3166-1 country code
 * @param  {Function}   callback                        Standard callback function
 * @param  {Object}     callback.err                    An error that occurred, if any
 */
const updateTenant = function(ctx, alias, tenantUpdates, callback) {
  if (!ctx.user() || !ctx.user().isAdmin(ctx.user().tenant.alias)) {
    return callback({ code: 401, msg: 'Unauthorized users cannot update tenants' });
  }

  const validator = new Validator();
  validator.check(alias, { code: 400, msg: 'Missing alias' }).notEmpty();
  validator
    .check(getTenant(alias), {
      code: 404,
      msg: util.format('Tenant with alias "%s" does not exist and cannot be updated', alias)
    })
    .notNull();

  // Short-circuit validation if the tenant did not exist
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  // Check that at least either a new display name or hostname have been provided
  const updateFields = tenantUpdates ? _.keys(tenantUpdates) : [];
  validator
    .check(updateFields.length, {
      code: 400,
      msg: 'You should at least specify a new displayName or hostname'
    })
    .min(1);
  _.each(tenantUpdates, (updateValue, updateField) => {
    validator
      .check(updateField, {
        code: 400,
        msg: util.format('"%s" is not a recognized tenant update field', updateField)
      })
      .isIn(['displayName', 'host', 'emailDomains', 'countryCode']);
    if (updateField === 'displayName') {
      validator.check(updateValue, { code: 400, msg: 'A displayName cannot be empty' }).notEmpty();
    } else if (updateField === 'host') {
      // Ensure the tenant host name is all lower case
      updateValue = updateValue.toLowerCase();
      tenantUpdates[updateField] = updateValue;

      // Validate the lower-cased version
      validator.check(updateValue, { code: 400, msg: 'Invalid host' }).isHost();
      validator.check(updateValue, { code: 400, msg: 'A hostname cannot be empty' }).notEmpty();
      validator
        .check(getTenantByHost(updateValue), {
          code: 400,
          msg: 'The hostname has already been taken'
        })
        .isNull();
      validator
        .check(updateValue, { code: 400, msg: 'This hostname is reserved' })
        .not(serverConfig.shibbolethSPHost.toLowerCase());
    } else if (updateField === 'emailDomains') {
      // Ensure the tenant email domains are all lower case
      updateValue = _.map(updateValue, emailDomain => {
        return emailDomain.trim().toLowerCase();
      });

      tenantUpdates[updateField] = updateValue.join(',');

      // Only a global admin can update the email domain
      validator
        .check(null, { code: 401, msg: 'Only a global administrator can update the email domain' })
        .isGlobalAdministratorUser(ctx);

      // Validate the lower-cased version
      _validateEmailDomains(validator, updateValue, alias);
    } else if (updateField === 'countryCode' && tenantUpdates[updateField]) {
      // Ensure the country code is upper case
      tenantUpdates[updateField] = tenantUpdates[updateField].toUpperCase();
      validator
        .check(tenantUpdates[updateField], {
          code: 400,
          msg: 'The country code must be a valid ISO-3166 country code'
        })
        .isIso3166Country();
    }
  });
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  const q = Cassandra.constructUpsertCQL('Tenant', 'alias', alias, tenantUpdates);
  Cassandra.runQuery(q.query, q.parameters, err => {
    if (err) {
      return callback(err);
    }

    // Indicate that a caching operation is pending
    TenantsAPI.emit('preCache');

    // Emit a cluster-wide event to let the app servers re-cache the tenant's metadata
    Pubsub.publish('oae-tenants', 'refresh ' + alias, callback);
  });
};

/**
 * Disable or enable a tenant
 *
 * @param  {Context}      ctx             Standard context object containing the current user and the current tenant
 * @param  {String[]}     aliases         An array of aliases representing the tenants that should be stopped
 * @param  {Boolean}      disabled        True if the tenant needs to be disabled
 * @param  {Function}     [callback]      Callback function executed when request is completed
 * @param  {Object}       callback.err    An error that occurred, if any
 */
const disableTenants = function(ctx, aliases, disabled, callback) {
  callback = callback || function() {};
  aliases = _.isArray(aliases) ? aliases : [aliases];
  aliases = _.compact(aliases);

  const validator = new Validator();
  validator
    .check(null, {
      code: 401,
      msg: 'You must be a global admin user to enable or disable a tenant'
    })
    .isGlobalAdministratorUser(ctx);
  validator
    .check(aliases.length, {
      code: 400,
      msg: 'You must provide at least one alias to enable or disable'
    })
    .min(1);
  _.each(aliases, alias => {
    validator
      .check(getTenant(alias), {
        code: 404,
        msg: util.format('Tenant with alias "%s" does not exist and cannot be enabled or disabled', alias)
      })
      .notNull();
  });
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  // Store the "active" flag in cassandra
  const queries = _.map(aliases, alias => {
    return {
      query: 'UPDATE "Tenant" SET "active" = ? WHERE "alias" = ?',
      parameters: [!disabled, alias]
    };
  });

  Cassandra.runBatchQuery(queries, err => {
    if (err) {
      return callback(err);
    }

    // Broadcast the message accross the cluster so we can start/stop the tenants
    const cmd = disabled ? 'stop' : 'start';

    async.mapSeries(
      aliases,
      (eachAlias, transformed) => {
        // Disable or restore users from those tenancies too
        UserAPI.deleteOrRestoreUsersByTenancy(ctx, eachAlias, disabled, err => {
          if (err) {
            transformed(err);
          } else {
            // Indicate that a caching operation is pending
            TenantsAPI.emit('preCache');

            // Broadcast an event around the cluster to start or stop a tenant
            Pubsub.publish('oae-tenants', cmd + ' ' + eachAlias, transformed);
          }
        });
      },
      // eslint-disable-next-line no-unused-vars
      (err, results) => {
        if (err) {
          callback(err);
        }

        return callback();
      }
    );
  });
};

/// ///////////////////////
// TENANT LANDING PAGES //
/// ///////////////////////

/**
 * Get the configured landing page for the current tenant
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @return {Object[]}                           The configured landing page blocks for the current tenant
 */
const getLandingPage = function(ctx) {
  const landingPage = [];
  for (let i = 1; i <= 12; i++) {
    const blockName = util.format('block_%d', i);

    // Construct the block
    const block = _getLandingPageBlock(ctx, blockName);

    // If the type is not configured, there's no value in returning this block
    if (block.type && block.type !== 'empty') {
      landingPage.push(block);
    }
  }

  return landingPage;
};

/**
 * Get a landing page block
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}         blockName           The name of the block. Formatted as `block_i`
 * @return {Object}                             A landing page block
 * @api private
 */
const _getLandingPageBlock = function(ctx, blockName) {
  const block = {};

  // Get the block's information from the tenant config
  _setLandingPageBlockAttribute(ctx, block, blockName, 'type');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'xs');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'sm');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'md');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'lg');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'minHeight');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'horizontalAlign');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'verticalAlign');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'bgColor');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'titleColor');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'textColor');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'text');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'icon');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'imgUrl');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'videoUrl');
  _setLandingPageBlockAttribute(ctx, block, blockName, 'videoPlaceholder');

  // Use the correct `text` value, if any
  if (block.text) {
    const locale = ctx.resolvedLocale();
    block.text = block.text[locale] || block.text.default;
  }

  // If any URLs are configured, we try to resolve them in the hashed UI files
  if (block.imgUrl) {
    block.imgUrl = UIAPI.getHashedPath(block.imgUrl);
  }

  if (block.videoPlaceholder) {
    block.videoPlaceholder = UIAPI.getHashedPath(block.videoPlaceholder);
  }

  return block;
};

/**
 * Set an attribute value on a landing page block
 *
 * @param  {Context}        ctx                 Standard context object containing the current user and the current tenant
 * @param  {Object}         block               The block on which to set an attribute
 * @param  {String}         blockName           The name of the block. Formatted as `block_i`
 * @param  {String}         attributeName       The name of the attribute to set on the block
 * @api private
 */
const _setLandingPageBlockAttribute = function(ctx, block, blockName, attributeName) {
  // Set the attribute value
  block[attributeName] = TenantsConfig.getValue(ctx.tenant().alias, blockName, attributeName);
};

/// ////////////
// UTILITIES //
/// ////////////

/**
 * Ensure that the given email domain does not conflict with any existing tenant domains. If this
 * validation is part of an update, the update tenant alias should be specified so that any conflict
 * in email domain with the tenant being updated can be ignored. Any validation errors will result
 * in the errors being added to the provided `validator`, therefore this does not `return` or
 * `throw` anything.
 *
 * @param  {Validator}  validator               The Validator object
 * @param  {String[]}   emailDomains            The email domain expressions to verify
 * @param  {String}     [updateTenantAlias]     The alias of the tenant being updated, if any
 * @api private
 */
const _validateEmailDomains = function(validator, emailDomains, updateTenantAlias) {
  _.each(emailDomains, emailDomain => {
    // Check whether it's a valid domain
    validator.check(emailDomain, { code: 400, msg: 'Invalid email domain' }).isHost();

    const matchingTenantAlias = tenantEmailDomainIndex.conflict(updateTenantAlias, emailDomain);
    const matchingTenant = tenants[matchingTenantAlias];
    const matchingEmailDomains = matchingTenant && matchingTenant.emailDomains;

    const err = {
      code: 400,
      msg: util.format(
        'The email domain "%s" conflicts with existing email domains: %s',
        emailDomain,
        matchingEmailDomains
      )
    };
    validator.check(matchingTenant, err).isNull();
  });
};

/**
 * Create a new version of the tenant with the same information.
 *
 * @param  {Tenant}     tenant      The tenant whose data to copy to a new tenant object
 * @return {Tenant}                 A copy of the tenant object that was provided, such that modifying its properties is safe
 * @api private
 */
const _copyTenant = function(tenant) {
  if (!tenant) {
    return null;
  }

  // Copy the tenant by converting it to a storage hash and then back
  const tenantCopy = _storageHashToTenant(tenant.alias, _tenantToStorageHash(tenant));
  tenantCopy.isGlobalAdminServer = tenant.isGlobalAdminServer;

  return tenantCopy;
};

/**
 * Map a storage hash from Cassandra to a tenant object
 *
 * @param  {String}     alias   The alias of the tenant whose hash is being turned into a tenant
 * @param  {Object}     hash    The storage hash to be mapped
 * @return {Tenant}             A tenant corresponding to the row
 * @api private
 */
const _storageHashToTenant = function(alias, hash) {
  let emailDomains = [];
  if (hash.emailDomains) {
    emailDomains = _.map(hash.emailDomains.split(','), emailDomain => {
      return emailDomain.trim().toLowerCase();
    });
  }

  return new Tenant(alias, hash.displayName, hash.host.toLowerCase(), {
    emailDomains,
    countryCode: hash.countryCode,
    active: hash.active,
    isGuestTenant: alias === serverConfig.guestTenantAlias
  });
};

/**
 * Given a tenant, convert it into a storage hash. Note that since the alias is technically not
 * part of the storage object since it is the primary key, that it is not included in the storage
 * hash and is treated separately
 *
 * @param  {Tenant}     tenant  The tenant to convert into a simple storage hash
 * @return {Object}             The simple storage hash object
 * @api private
 */
const _tenantToStorageHash = function(tenant) {
  const hash = _.pick(tenant, 'displayName', 'host', 'emailDomains', 'countryCode', 'active');
  if (hash.emailDomains) {
    hash.emailDomains = hash.emailDomains.join(',');
  }

  return hash;
};

export {
  TenantsAPI as emitter,
  init,
  getTenants,
  getNonInteractingTenants,
  searchTenants,
  getTenant,
  getTenantByHost,
  getTenantByEmail,
  getTenantsForEmailDomains,
  createTenant,
  updateTenant,
  disableTenants,
  getLandingPage
};
