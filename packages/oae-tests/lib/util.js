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

import path from 'node:path';
import stream from 'node:stream';
import { format } from 'node:util';
import process from 'node:process';
import { assert } from 'chai';

import async from 'async';
import _ from 'underscore';

import bodyParser from 'body-parser';
import clone from 'clone';
import express from 'express';
import ShortId from 'shortid';
import {
  __,
  concat,
  dropLast,
  last,
  toLower,
  not,
  prop,
  head,
  compose,
  defaultTo,
  dec as decrement,
  equals
} from 'ramda';

import * as AuthenticationAPI from 'oae-authentication';
import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as Cassandra from 'oae-util/lib/cassandra.js';
import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import { Context } from 'oae-context';
import * as LibraryAPI from 'oae-library';

import { LoginId } from 'oae-authentication/lib/model.js';
import multipart from 'oae-util/lib/middleware/multipart.js';
import * as MQ from 'oae-util/lib/mq.js';
import * as OAE from 'oae-util/lib/oae.js';
import * as OaeUtil from 'oae-util/lib/util.js';
import * as PreviewAPI from 'oae-preview-processor/lib/api.js';
import PrincipalsAPI from 'oae-principals';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao.js';
import * as Redis from 'oae-util/lib/redis.js';
import * as RestAPI from 'oae-rest';
import { RestContext } from 'oae-rest/lib/model.js';
import * as RestUtil from 'oae-rest/lib/util.js';
import * as SearchTestUtil from 'oae-search/lib/test/util.js';
import { Tenant } from 'oae-tenants/lib/model.js';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util.js';
import { User } from 'oae-principals/lib/model.js';

import { logger } from 'oae-logger';
import { config } from '../../../config.js';
import { testingContext } from './context.js';

let migrationRunner;
(async function () {
  migrationRunner = await import(path.join(process.cwd(), 'etc/migration/migration-runner.js'));
})();
// const migrationRunner = require(path.join(process.cwd(), 'etc/migration/migration-runner.js'));

const log = logger('before-tests');
const requestLog = logger('request-log');

const { setGroupMembers } = RestAPI.Group;
const { whenIndexingComplete } = SearchTestUtil;
const { createGroup, getGroup } = RestAPI.Group;

/**
 * The name of the session cookie
 */
const CONFIG_COOKIE_NAME = 'a-non-default-cookie-name';
const NOT_JOINABLE = 'no';
const JOINABLE = 'yes';
const JOINABLE_BY_REQUEST = 'request';
const PUBLIC = 'public';
const LOGGEDIN = 'loggedin';
const PRIVATE = 'private';
const NO_ALIAS = null;
const NO_OPTIONS = {};
const YES = 'yes';
const NO_MANAGERS = [];
const NO_MEMBERS = [];
const STANDARD_PASSWORD = 'password';

const { setEmailAddress } = PrincipalsDAO;
const { createUser } = RestAPI.User;
const { getTenant } = RestAPI.Tenants;
const isZero = equals(0);
const atLeastOne = defaultTo(1);

/**
 * Create a new express test server on some port between 2500 and 3500
 *
 * @param  {Function}   callback            Standard callback function
 * @param  {Express}    callback.app        The ExpressJS app object
 * @param  {HttpServer} callback.server     The HTTP Server object that is listening
 * @param  {Number}     callback.port       The port on which the server is listening
 */
const createTestServer = function (callback, _attempts) {
  _attempts = OaeUtil.getNumberParam(_attempts, 0);
  if (_attempts === 10) {
    assert.fail('Could not start a test web server in 10 attempts');
  }

  const port = 2500 + Math.floor(Math.random() * 1000);
  const app = express();

  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json());
  app.use(multipart());

  // Try and listen on the specified port
  const server = app.listen(port + _attempts);

  // When the server successfully begins listening, invoke the callback
  server.once('listening', () => {
    server.removeAllListeners('error');
    return callback(app, server, port + _attempts);
  });

  // If there is an error connecting, try another port
  server.once('error', () => {
    server.removeAllListeners('listening');
    return createTestServer(callback, _attempts + 1);
  });
};

/**
 * Clear all the data from the Cassandra column families
 *
 * @param  {Function}   callback    Standard callback function
 * @throws {Error}                  An assertion error is thrown if an unexpected error occurs
 */
const clearAllData = function (callback) {
  const columnFamiliesToClear = [
    'Content',
    'Discussions',
    'Folders',
    'Principals',
    'PrincipalsByEmail',
    'AuthenticationLoginId',
    'AuthenticationUserLoginId'
  ];

  /*!
   * Once all column families have been truncated, we re-populate the administrators
   */
  const truncated = _.after(columnFamiliesToClear.length, () => {
    // Flush the data from redis, so we can recreate our admins
    // And by doing that we also clean the preview processing queues
    // instead of waiting on them to be empty
    Redis.flush((error) => {
      assert.notExists(error);

      // Mock a global admin request context so we can create a proper global administrator in the system
      const globalContext = createGlobalAdminContext();

      // Create the global admin user if they don't exist yet with the username "administrator"
      const options = {
        email: generateTestEmailAddress()
      };
      AuthenticationAPI.getOrCreateGlobalAdminUser(
        globalContext,
        'administrator',
        'administrator',
        'Global Administrator',
        options,
        (error) => {
          assert.notExists(error);

          // Re-create the tenant administrators
          return _setUpTenantAdmins(callback);
        }
      );
    });
  });

  SearchTestUtil.whenIndexingComplete(() => {
    LibraryAPI.Index.whenUpdatesComplete(() => {
      // Truncate each column family
      _.each(columnFamiliesToClear, (cf) => {
        const query = format('TRUNCATE "%s"', cf);

        Cassandra.runQuery(query, [], (error) => {
          assert.notExists(error);
          return truncated();
        });
      });
    });
  });
};

/**
 * Create 3 default tenants that can be used for testing the REST endpoints
 * These tenants will be exposed on a global `oaeTests` object.
 *
 * @param  {Function}       callback    Standard callback function
 * @throws {Error}                      An assertion error is thrown when an unexpected error occurs
 */
const setUpTenants = function (callback) {
  global.oaeTests = { tenants: {} };

  testingContext.oaeTests = { coco: 'xixi ' };

  // Create the Global Tenant admin context to authenticate with
  global.oaeTests.tenants.global = new Tenant('admin', 'Global tenant', 'localhost:3000', {
    isGlobalAdminServer: true
  });
  const globalAdminRestContext = createGlobalAdminRestContext();

  // Create the Cambridge tenant
  TenantsTestUtil.createTenantAndWait(
    globalAdminRestContext,
    'camtest',
    'Cambridge University Test',
    'cambridge.oae.com',
    { emailDomains: 'cam.ac.uk' },
    (error, tenant) => {
      assert.notExists(error);
      global.oaeTests.tenants.cam = tenant;

      // Create the Georgia Tech tenant
      TenantsTestUtil.createTenantAndWait(
        globalAdminRestContext,
        'gttest',
        'Georgia Tech Test',
        'gt.oae.com',
        { emailDomains: 'gatech.edu' },
        (error, tenant) => {
          assert.notExists(error);
          global.oaeTests.tenants.gt = tenant;

          /**
           * Create a tenant with a hostname set to 'localhost:3001' (ie: the host/port
           * combination where the server is running on). This allows tests to use
           * the cross tenant sign authentication
           */
          TenantsTestUtil.createTenantAndWait(
            globalAdminRestContext,
            'localhost',
            'Tenant with a hostname set to localhost',
            'localhost:3001',
            null,
            (error, tenant) => {
              assert.notExists(error);
              global.oaeTests.tenants.localhost = tenant;

              // Set up the tenant admins
              _setUpTenantAdmins(callback);
            }
          );
        }
      );
    }
  );
};

/**
 * Create a tenant admin for each of the created tenants
 *
 * @param  {Object}     callback        Standard callback
 * @throws {Error}                      An assertion error is thrown when an unexpected error occurs
 * @api private
 */
const _setUpTenantAdmins = (callback) => {
  const camTenant = global.oaeTests.tenants.cam;
  const gtTenant = global.oaeTests.tenants.gt;
  const localTenant = global.oaeTests.tenants.localhost;

  _setupTenantAdmin(camTenant, (error) => {
    assert.ok(!error, JSON.stringify(error));

    _setupTenantAdmin(gtTenant, (error) => {
      assert.notExists(error);

      _setupTenantAdmin(localTenant, (error) => {
        assert.notExists(error);

        return callback();
      });
    });
  });
};

/**
 * Create a tenant admin for the specified tenant.
 *
 * @param  {Tenant}     tenant          The tenant to create an admin on
 * @param  {Function}   callback        Standard callback function
 * @throws {Error}                      An assertion error is thrown when an unexpected error occurs
 * @api private
 */
const _setupTenantAdmin = function (tenant, callback) {
  const adminLoginId = new LoginId(tenant.alias, AuthenticationConstants.providers.LOCAL, 'administrator', {
    password: 'administrator'
  });
  const displayName = generateRandomText(2);
  const email = generateTestEmailAddress(null, tenant.emailDomains[0]);

  const ctx = createTenantAdminContext(tenant);
  AuthenticationAPI.createUser(ctx, adminLoginId, displayName, { email }, (error, createdUser) => {
    assert.notExists(error);

    return PrincipalsAPI.setTenantAdmin(ctx, createdUser.id, true, callback);
  });
};

/**
 * Generate a number of random users that can be used inside of tests
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Number}         total               The total number of test users that need to be created. If not provided, a single test user will be created
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Object}         callback.response   Object where the keys are the user ids of the created users and the values are objects with a key 'user' that contains the user object and a key 'restContext' that contains the Rest Context object for that user
 * @param  {Object}         callback.user1      An object with key `user` containing the User object, and `restContext` containing that user's rest context for one of the users that was created
 * @param  {Object}         [callback.user2]    Another user that was created
 * @param  {Object}         [callback....]      Each user that was generated as new callback arguments
 */
const generateTestUsers = (restCtx, numberOfUsers, ...args) => {
  const callback = last(args);
  const createdUsers = compose(defaultTo([]), head, dropLast(1))(args);
  numberOfUsers = atLeastOne(numberOfUsers);

  if (isZero(numberOfUsers)) {
    whenIndexingComplete(() => callback(null, createdUsers));
  } else {
    generateSingleTestUser(restCtx, (error, user) => {
      if (error) return callback(error);

      createdUsers.push({
        user,
        restContext: new RestContext(restCtx.host, {
          hostHeader: restCtx.hostHeader,
          username: user.username,
          userPassword: STANDARD_PASSWORD,
          strictSSL: restCtx.strictSSL
        })
      });

      // Recursively continue creating users
      numberOfUsers = decrement(numberOfUsers);
      return generateTestUsers(restCtx, numberOfUsers, createdUsers, callback);
    });
  }
};

/**
 * Generate a single user
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Function}       callback            Standard callback function
 */
const generateSingleTestUser = (restCtx, callback) => {
  /*
   * Ensure that the provided rest context has been authenticated before trying to use it to create users
   */
  _ensureAuthenticated(restCtx, (error) => {
    if (error) return callback(error);

    /**
     * Get the tenant information so we can generate an email address that
     * belongs to the configured tenant email domain (if any)
     */
    getTenant(restCtx, NO_ALIAS, (error, tenant) => {
      if (error) return callback(error);

      const username = generateTestUserId('random-user');
      const displayName = generateTestGroupId('random-user');
      const email = generateTestEmailAddress(username, compose(head, prop('emailDomains'))(tenant));

      createUser(restCtx, username, 'password', displayName, email, NO_OPTIONS, (error, user) => {
        if (error) return callback(error);

        // Manually verify the user their email address
        setEmailAddress(user, toLower(email), (error, user) => {
          assert.notExists(error);

          user.username = username;

          return callback(null, user);
        });
      });
    });
  });
};

/**
 * Generate a number of random groups that can be used inside of tests
 *
 * @param  {RestContext}    restContext                     Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Number}         numberOfGroups                  The total number of test groups that need to be created. If not provided, a single test group will be created
 * @param  {Array}          args.createdGroups              Array of already created groups to add more groups to (recursiveness)
 * @param  {Function}       args.callback                   Standard callback function
 * @param  {Object}         args.callback.err               An error that occurred, if any
 * @param  {Object}         args.callback.groups            An array with all the groups created
 * @throws {AssertionError}                                 Thrown if there is an error creating the groups
 */
const generateTestGroups = (restContext, numberOfGroups, ...args) => {
  const callback = last(args);
  const createdGroups = compose(defaultTo([]), head, dropLast(1))(args);

  if (isZero(numberOfGroups)) {
    whenIndexingComplete(() => callback(null, createdGroups));
  } else {
    generateSingleTestGroup(restContext, (error, group) => {
      if (error) return callback(error);
      createdGroups.push({ restContext, group });

      // Recursively continue creating users
      numberOfGroups = decrement(numberOfGroups);
      return generateTestGroups(restContext, numberOfGroups, createdGroups, callback);
    });
  }
};

/**
 * Generate a random group that can be used inside of tests
 *
 * @param  {RestContext}    restCtx             Standard REST Context object that contains the current tenant URL and the current user credentials
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Object}         callback.group      Group created
 */
const generateSingleTestGroup = (restContext, callback) => {
  // Create the next group and store its full group profile
  createGroup(
    restContext,
    generateTestGroupId('random-title'),
    generateTestGroupId('random-description'),
    PUBLIC,
    YES,
    NO_MANAGERS,
    NO_MEMBERS,
    (error, group) => {
      assert.ok(not(error));
      getGroup(restContext, group.id, (error, fullGroupProfile) => {
        assert.ok(not(error));

        return callback(null, fullGroupProfile);
      });
    }
  );
};

/**
 * Create a new tenant with a tenant administrator user.
 *
 * @param  {String}        tenantAlias                     The tenant alias of the tenant to create
 * @param  {String}        tenantHost                      The host of the tenant to create
 * @param  {Function}      callback                        Standard callback function
 * @param  {Object}        callback.err                    An error that occurred, if any
 * @param  {Object}        callback.tenant                 The tenant data object
 * @param  {RestContext}   callback.tenantAdminRestContext The rest context that can be used to make requests on behalf of the tenant administrator
 * @param  {User}          callback.tenantAdmin            The user object representing the tenant
 */
const createTenantWithAdmin = function (tenantAlias, tenantHost, callback) {
  const adminCtx = createGlobalAdminRestContext();
  TenantsTestUtil.createTenantAndWait(
    adminCtx,
    tenantAlias,
    tenantAlias,
    tenantHost,
    { emailDomains: tenantHost },
    (error, tenant) => {
      if (error) {
        return callback(error);
      }

      // Disable reCaptcha so we can create a user
      ConfigTestUtil.updateConfigAndWait(
        adminCtx,
        tenantAlias,
        { 'oae-principals/recaptcha/enabled': false },
        (error_) => {
          if (error_) {
            return callback(error_);
          }

          // Create the user and make them a tenant administrator
          const anonymousCtx = createTenantRestContext(tenantHost);
          const email = generateTestEmailAddress('administrator', 'domain.' + tenantHost).toLowerCase();
          RestAPI.User.createUser(
            anonymousCtx,
            'administrator',
            'administrator',
            'Tenant Administrator',
            email,
            null,
            (error, tenantAdmin) => {
              if (error) {
                return callback(error);
              }

              // Verify their email address
              PrincipalsDAO.setEmailAddress(tenantAdmin, email, (error, tenantAdmin) => {
                if (error) {
                  return callback(error);
                }

                RestAPI.User.setTenantAdmin(adminCtx, tenantAdmin.id, true, (error_) => {
                  if (error_) {
                    return callback(error_);
                  }

                  // Re-enable reCaptcha
                  const tenantAdminRestCtx = createTenantAdminRestContext(tenantHost);
                  ConfigTestUtil.updateConfigAndWait(
                    tenantAdminRestCtx,
                    null,
                    { 'oae-principals/recaptcha/enabled': true },
                    (error_) => {
                      if (error_) {
                        return callback(error_);
                      }

                      return callback(null, tenant, tenantAdminRestCtx, tenantAdmin);
                    }
                  );
                });
              });
            }
          );
        }
      );
    }
  );
};

/**
 * Create a group hierarchy, starting from the 0th group in the array as the highest level down to the last group as the lowest level.
 *
 * @param  {Context}     restCtx         The context of the REST request
 * @param  {String[]}    groupIds        An array of group IDs that describe the hierarchy to create. If there are 0 or 1 groupIds, this method effectively does nothing. If there are 2 groupIds, the group at groupId[1] becomes a member of groupId[0]. And so on.
 * @param  {String}      role            The role to assign to the group membership
 * @param  {Function}    callback        Invoked when all memberships have been linked
 */
const generateGroupHierarchy = (restCtx, groupIds, role, callback) => {
  if (groupIds.length <= 1) return callback();

  const membershipChanges = {};
  membershipChanges[groupIds[1]] = role;
  setGroupMembers(restCtx, groupIds[0], membershipChanges, (error) => {
    assert.notExists(error);

    // Recurse, removing the first group
    return generateGroupHierarchy(restCtx, groupIds.slice(1), role, callback);
  });
};

/**
 * Generate a unique Cassandra object name. This will ensure a unique name that does not contain
 * any `-` characters as per Cassandra naming requirements (keyspace, CF, etc...)
 *
 * @param  {String}     [seed]  The seed / prefix of the name. Defaults to "name"
 * @return {String}             A unique Cassandra object name
 */
const generateTestCassandraName = (seed = 'name') => format('%s_%s', seed, ShortId.generate().replace(/-/g, '_'));

/**
 * Generate a unique ElasticSearch object name. This will ensure a unique name that does not contain
 * any upper-case characters as per ElasticSearch naming requirements (indexes, etc...)
 *
 * @param  {String}     [seed]  The seed / prefix of the name. Defaults to "name"
 * @return {String}             A unique ElasticSearch object name
 */
const generateTestElasticSearchName = (seed = 'name') => format('%s_%s', seed, ShortId.generate().toLowerCase());

/**
 * Generate a random unique user id that can be used inside of tests
 *
 * @param  {String}     [seed]  String that should be used as the first part of the generated user id. Defaults to "user"
 * @return {String}             A random user id
 */
const generateTestUserId = (seed = 'user') => format('%s-%s', seed, ShortId.generate());

/**
 * Generate a random unique group id that can be used inside of tests
 *
 * @param  {String}     [seed]  String that should be used as the first part of the generated group id. Defaults to "group"
 * @return {String}             A random group id
 */
const generateTestGroupId = (seed = 'group') => format('%s-%s', seed, ShortId.generate());

/**
 * Generate a unique and random email address based on an optional seed
 *
 * @param  {String}     [seed]      The seed / prefix of the email address. Defaults to "email"
 * @param  {String}     [domain]    The domain on which to put the email. Defaults to "oae-email.com"
 * @return {String}                 A random email address
 */
const generateTestEmailAddress = (seed = 'email', domain = 'oae-email.com') =>
  format('%s_%s@%s', seed, ShortId.generate(), domain);

/**
 * Create a Rest Context object that represents an anonymous or logged in user and can be used for tests
 *
 * @param  {String}         host             Tenant URL for the tenant on which we want to perform a REST call
 * @param  {String}         [username]       Username for the user performing the request. This should be null for an anonymous user
 * @param  {String}         [password]       Password for the user performing the request. This should be null for an anonymous user
 * @return {RestContext}                     Rest Context object that represents the anonymous or logged in user user on the provided tenant
 */
const createTenantRestContext = function (host, username, password) {
  return new RestContext('http://localhost:3001', {
    username,
    userPassword: password,
    hostHeader: host
  });
};

/**
 * Create a Rest Context object that represents an admin user for a teant and can be used for tests
 *
 * @param  {String}         host             Tenant URL for the tenant on which we want to perform a REST call
 * @return {RestContext}                     Rest Context object that represents the admin user on the provided tenant
 */
const createTenantAdminRestContext = function (host) {
  return createTenantRestContext(host, 'administrator', 'administrator');
};

/**
 * Create a Rest Context object that represents an anonymous or logged in user on the global admin server
 * and can be created for tests
 *
 * @param  {String}         [username]       Username for the user performing the request. This should be null for an anonymous user.
 * @param  {String}         [password]       Password for the user performing the request. This should be null for an anonymous user
 * @return {RestContext}                     Rest Context object that represents the anonymous or logged in user on the global admin server
 */
const createGlobalRestContext = function (username, password) {
  return new RestContext('http://localhost:3000', {
    username,
    userPassword: password
  });
};

/**
 * Create a Rest Context object that represents the admin user on the global admin server and can be created
 * for tests
 *
 * @return {RestContext}                     Rest Context object that represents the global admin user on the provided tenant
 */
const createGlobalAdminRestContext = function () {
  return createGlobalRestContext('administrator', 'administrator');
};

/**
 * Create an API Context object that represents a tenant admin of the given tenant.
 *
 * @param  {Tenant}    tenant  The tenant for which the context should be an administrator
 * @return {Context}           The api context that represents an administrator of the tenant
 */
const createTenantAdminContext = function (tenant) {
  const email = format('tenant-admin-%s', tenant.alias);
  return new Context(
    tenant,
    new User(tenant.alias, 'u:' + tenant.alias + ':admin', 'Tenant Administrator', email, {
      isTenantAdmin: true
    })
  );
};

/**
 * Create an API Context object that represents a global administrator.
 *
 * @return {Context}           The api context that represents an administrator of the tenant
 */
const createGlobalAdminContext = function () {
  const globalTenant = global.oaeTests.tenants.global;
  const globalAdminId = 'u:' + globalTenant.alias + ':admin';
  const globalUser = new User(globalTenant.alias, globalAdminId, 'Global Administrator', 'admin@example.com', {
    visibility: PRIVATE,
    isGlobalAdmin: true
  });
  return new Context(globalTenant, globalUser);
};

/**
 * Given a rest context, get the user object of the user associated to it.
 *
 * @param  {RestContext}    restCtx         The rest context of the user to fetch
 * @param  {Function}       callback        Standard callback function
 * @param  {User}           callback.user   The user associated to the request context
 * @throws {Error}                          Throws an assertion error if there is an issue fetching the user
 */
const getUserFromRestContext = function (restCtx, callback) {
  RestAPI.User.getMe(restCtx, (error, me) => {
    assert.notExists(error);
    RestAPI.User.getUser(restCtx, me.id, (error, user) => {
      assert.notExists(error);
      return callback(user);
    });
  });
};

/**
 * Generate a number of random resource ids
 *
 * @param  {Number}     n                       The number of resource ids to generate
 * @param  {String}     [resourceType]          The character indicating the type of resource. Default: "g"
 * @param  {String}     [tenantAlias]           The alias of the tenant to which this id belongs. Default: "oae"
 * @param  {Function}   [callback]              A function whose parameters are the individual generated resource ids
 * @param  {String}     [callback.resourceId1]  The id of the first resource id generated
 * @param  {String}     [callback...]           Subsequent resource ids as additional parameters
 * @return {String[]}                           Returns all generated resource ids
 */
const generateResourceIds = function (n, resourceType, tenantAlias, callback) {
  resourceType = resourceType || 'g';
  tenantAlias = tenantAlias || 'oae';
  callback = callback || function () {};

  const resourceIds = [];
  for (let i = 0; i < n; i++) {
    resourceIds.push(format('%s:%s:%s', resourceType, tenantAlias, ShortId.generate()));
  }

  callback.apply(this, resourceIds);

  return resourceIds;
};

/**
 * Generate a string that contains `numberOfWords` words.
 * The words are random alphanumerical strings of 12 characters.
 *
 * @param  {Number} [numberOfWords]     The amount of words you wish to generate. Default: 1
 * @return {String}                     A randomly generated string with `numberOfWords` in it
 */
const generateRandomText = function (numberOfWords) {
  numberOfWords = OaeUtil.getNumberParam(numberOfWords, 1, 1);
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const text = [];
  for (let i = 0; i < numberOfWords; i++) {
    const wordLength = 12;
    let word = '';
    for (let l = 0; l < wordLength; l++) {
      const letter = Math.floor(Math.random() * alphabet.length);
      word += alphabet[letter];
    }

    text.push(word);
  }

  return text.join(' ');
};

/**
 * Returns a function that returns a readable stream that will emit data until
 * the provided number of bytes has been emitted. This stream can be used in
 * requestjs to perform file upload requests.
 *
 * @param  {String}     filename    A filename that should be set on the stream
 * @param  {Number}     bytes       The number of bytes that should be published over the stream
 * @return {Function}               A function that returns the stream
 */
const createFileReadableStream = function (filename, size) {
  return function () {
    // We'll implement a readable stream that generates the data
    const rs = new stream.Stream();

    // RequestJS uses the `path` property of `fs.streams` to determine the filename, so we fake one
    rs.path = '/foo/bar/' + filename;

    // When we add a stream to request it gets delayed first, so we need to implement the `pause` method
    rs.pause = function () {};

    // Once `resume` has been called we can start emitting data
    rs.resume = function () {
      /**
       * Generate dummy data to be written out in the stream
       *
       * @param  {Number} toGenerate   The amount of data to generate
       * @return {String}              A string with exactly `toGen` characters in it
       */
      const generateData = function (toGenerate) {
        let data = '';
        for (let i = 0; i < toGenerate; i++) {
          data += '0';
        }

        return data;
      };

      // Generate 1K of data (if `size` is larger than 1024) as it is a lot faster to emit 10 * 1024 of a largish string
      // than it is to emit 10 * 1024 * 1024 of a character
      const toGenerate = size > 1024 ? 1024 : 1;
      const data = generateData(toGenerate);

      // Emit data in increments of 1024 or 1 byte(s)
      let bytes = 0;
      for (bytes = 0; bytes < size; bytes += data.length) {
        rs.emit('data', data);
      }

      // If we were emitting data in increments of 1024 bytes there is a possibility that we still need to emit some data
      if (bytes < size) {
        rs.emit('data', generateData(size - bytes));
      }

      // Signal to the listener that we're done emitting data
      rs.emit('end');
    };

    return rs;
  };
};

/**
 * Set up 2 public tenants and 2 private tenants, each with a public, loggedin and private set of users.
 * The resulting model looks like:
 *
 * ```
 *  {
 *      "publicTenant": {
 *          "tenant": <Tenant>,
 *          "anonymousRestContext": <RestContext>,
 *          "adminRestContext": <RestContext> (of the tenant admin),
 *          "adminUser": {
 *              "user": <User>,
 *              "restContext": <RestContext>
 *          },
 *          "publicUser": {
 *              "user": <User>,
 *              "restContext": <RestContext>
 *          },
 *          "loggedinUser": { ... },
 *          "privateUser": { ... },
 *          "publicGroup": <Group>,
 *          "loggedinGroup": <Group>,
 *          "privateGroup": <Group>
 *      },
 *      "publicTenant1": { ... },
 *      "privateTenant": { ... },
 *      "privateTenant1": { ... }
 *  }
 * ```
 *
 * @param  {Function}   callback    Standard callback function
 * @throws {Error}                  An assertion error is thrown if something does not get created properly
 */
const setupMultiTenantPrivacyEntities = function (callback) {
  _createMultiPrivacyTenants((publicTenant, publicTenant1, privateTenant, privateTenant1) => {
    _setupTenant(publicTenant, () => {
      _setupTenant(publicTenant1, () => {
        _setupTenant(privateTenant, () => {
          _setupTenant(privateTenant1, () => callback(publicTenant, publicTenant1, privateTenant, privateTenant1));
        });
      });
    });
  });
};

/**
 * Set up tenants of all privacies
 *
 * @param  {Function}   callback                Standard callback function
 * @param  {Tenant}     callback.publicTenant   A public tenant
 * @param  {Tenant}     callback.publicTenant1  Another public tenant
 * @param  {Tenant}     callback.privateTenant  A private tenant
 * @param  {Tenant}     callback.privateTenant1 Another private tenant
 * @throws {Error}                              An assertion error is thrown if something does not get created properly
 * @api private
 */
const _createMultiPrivacyTenants = function (callback) {
  const publicTenantAlias = TenantsTestUtil.generateTestTenantAlias(PUBLIC);
  const publicTenant1Alias = TenantsTestUtil.generateTestTenantAlias('public1');
  const privateTenantAlias = TenantsTestUtil.generateTestTenantAlias(PRIVATE);
  const privateTenant1Alias = TenantsTestUtil.generateTestTenantAlias('private1');

  _createPublicTenant(publicTenantAlias, PUBLIC, (tenant, tenantAdmin) => {
    const publicTenant = {
      tenant,
      adminUser: tenantAdmin,
      adminRestContext: tenantAdmin.restContext,
      anonymousRestContext: createTenantRestContext(tenant.host)
    };

    _createPublicTenant(publicTenant1Alias, PUBLIC, (tenant, tenantAdmin) => {
      const publicTenant1 = {
        tenant,
        adminUser: tenantAdmin,
        adminRestContext: tenantAdmin.restContext,
        anonymousRestContext: createTenantRestContext(tenant.host)
      };

      _createPrivateTenant(privateTenantAlias, (tenant, tenantAdmin) => {
        const privateTenant = {
          tenant,
          adminUser: tenantAdmin,
          adminRestContext: tenantAdmin.restContext,
          anonymousRestContext: createTenantRestContext(tenant.host)
        };

        _createPrivateTenant(privateTenant1Alias, (tenant, tenantAdmin) => {
          const privateTenant1 = {
            tenant,
            adminUser: tenantAdmin,
            adminRestContext: tenantAdmin.restContext,
            anonymousRestContext: createTenantRestContext(tenant.host)
          };

          return callback(publicTenant, publicTenant1, privateTenant, privateTenant1);
        });
      });
    });
  });
};

/**
 * Prepare the given tenant according to the spec from #setupMultiTenantPrivacyEntities
 *
 * @param  {Tenant}     tenant          The tenant to setup
 * @param  {Function}   callback        Standard callback function
 * @throws {Error}                      An assertion error is thrown if something does not get created properly
 * @api private
 */
const _setupTenant = function (tenant, callback) {
  _createMultiPrivacyUsers(tenant, (publicUser, loggedinUser, privateUser) => {
    tenant.publicUser = publicUser;
    tenant.loggedinUser = loggedinUser;
    tenant.privateUser = privateUser;
    _createMultiPrivacyGroups(tenant, (allGroups) => {
      const {
        publicGroup,
        loggedinJoinableGroupByRequest,
        privateJoinableGroupByRequest,
        loggedinNotJoinableGroup,
        privateNotJoinableGroup,
        loggedinJoinableGroup,
        privateJoinableGroup
      } = allGroups;
      tenant.publicGroup = publicGroup;
      tenant.loggedinJoinableGroupByRequest = loggedinJoinableGroupByRequest;
      tenant.loggedinNotJoinableGroup = loggedinNotJoinableGroup;
      tenant.privateJoinableGroupByRequest = privateJoinableGroupByRequest;
      tenant.privateNotJoinableGroup = privateNotJoinableGroup;
      tenant.loggedinJoinableGroup = loggedinJoinableGroup;
      tenant.privateJoinableGroup = privateJoinableGroup;
      return callback();
    });
  });
};

/**
 * Set up users of all privacies using the given rest context.
 *
 * @param  {Tenant}         tenant          The tenant on which to create the users
 * @param  {Function}       callback        Standard callback function
 * @throws {Error}                          An assertion error is thrown if something does not get created properly
 * @api private
 */
const _createMultiPrivacyUsers = function (tenant, callback) {
  _createUserWithVisibility(tenant, PUBLIC, (publicUser) => {
    _createUserWithVisibility(tenant, LOGGEDIN, (loggedinUser) => {
      _createUserWithVisibility(tenant, PRIVATE, (privateUser) => callback(publicUser, loggedinUser, privateUser));
    });
  });
};

/**
 * Create a user with the specified visibility
 *
 * @param  {Tenant}         tenant              The tenant on which to create the user
 * @param  {String}         visibility          The visibility of the user
 * @param  {Function}       callback            Standard callback function
 * @param  {User}           callback.user       The created user
 * @param  {RestContext}    callback.restCtx    The RestContext of the user
 * @throws {Error}                              An assertion error is thrown if something does not get created properly
 * @api private
 */
const _createUserWithVisibility = function (tenant, visibility, callback) {
  const randomId = format('%s-%s', visibility, ShortId.generate());
  const username = 'username-' + randomId;
  const password = 'password-' + randomId;
  const displayName = 'displayName-' + randomId;
  const publicAlias = 'publicAlias-' + randomId;
  const email = generateTestEmailAddress(null, tenant.tenant.emailDomains[0]);
  RestAPI.User.createUser(
    tenant.adminRestContext,
    username,
    password,
    displayName,
    email,
    { visibility, publicAlias },
    (error, user) => {
      assert.notExists(error);
      return callback({
        user,
        restContext: createTenantRestContext(tenant.adminRestContext.hostHeader, username, password)
      });
    }
  );
};

/**
 * Set up groups of all privacies using the given rest context.
 *
 * @param  {Tenant}         tenant          The tenant on which to create the groups
 * @param  {Function}       callback        Standard callback function
 * @throws {Error}                          An assertion error is thrown if something does not get created properly
 * @api private
 */
const _createMultiPrivacyGroups = function (tenant, callback) {
  const groupsToBeCreated = _getGroupsToBeCreated(tenant);
  async.eachOfSeries(
    groupsToBeCreated,
    (eachGroup, key, done) => {
      _createGroupWithVisibility(tenant, eachGroup, (createdGroup) => {
        groupsToBeCreated[key] = createdGroup;
        done();
      });
    },
    () => {
      callback(groupsToBeCreated);
    }
  );
};

const _getGroupsToBeCreated = function (tenant) {
  return {
    publicGroup: { visibility: PUBLIC, memberPrincipalId: tenant.publicUser.user.id, joinable: JOINABLE_BY_REQUEST },
    loggedinJoinableGroupByRequest: {
      visibility: LOGGEDIN,
      memberPrincipalId: tenant.loggedinUser.user.id,
      joinable: JOINABLE_BY_REQUEST
    },
    privateJoinableGroupByRequest: {
      visibility: PRIVATE,
      memberPrincipalId: tenant.privateUser.user.id,
      joinable: JOINABLE_BY_REQUEST
    },
    loggedinNotJoinableGroup: {
      visibility: LOGGEDIN,
      memberPrincipalId: tenant.loggedinUser.user.id,
      joinable: NOT_JOINABLE
    },
    privateNotJoinableGroup: {
      visibility: PRIVATE,
      memberPrincipalId: tenant.privateUser.user.id,
      joinable: NOT_JOINABLE
    },
    loggedinJoinableGroup: {
      visibility: LOGGEDIN,
      memberPrincipalId: tenant.loggedinUser.user.id,
      joinable: JOINABLE
    },
    privateJoinableGroup: { visibility: PRIVATE, memberPrincipalId: tenant.privateUser.user.id, joinable: JOINABLE }
  };
};

/**
 * Create a group with the specified visibility.
 * The group will be created by the tenant admin and an extra member can be specified
 * with the `memberPrincipalId` parameter.
 *
 * @param  {Tenant}         tenant              The tenant on which to create the groups
 * @param  {String}         visibility          The visibility of the user
 * @param  {String}         memberPrincipalId   The ID of the principal which should be added as a member.
 * @param  {Function}       callback            Standard callback function
 * @param  {User}           callback.group      The created group
 * @throws {Error}                              An assertion error is thrown if something does not get created properly
 * @api private
 */
const _createGroupWithVisibility = function (tenant, group, callback) {
  const { visibility, memberPrincipalId, joinable } = group;
  const randomId = format('%s-%s', visibility, ShortId.generate());
  const displayName = 'displayName-' + randomId;
  const description = 'description-' + randomId;
  RestAPI.Group.createGroup(
    tenant.adminRestContext,
    displayName,
    description,
    visibility,
    joinable,
    [],
    [memberPrincipalId],
    (error, newGroup) => {
      assert.notExists(error);
      return callback(newGroup);
    }
  );
};

/**
 * Create a private tenant with the given alias
 *
 * @param  {String}         tenantAlias                 The alias of the tenant
 * @param  {Function}       callback                    Standard callback function
 * @param  {Tenant}         callback.tenant             The created tenant object
 * @param  {Object}         callback.tenantAdmin        The user info object containing the user profile and REST context of the tenant admin user
 * @throws {Error}                                      An assertion error is thrown if there is an issue creating the tenant
 * @api private
 */
const _createPrivateTenant = function (tenantAlias, callback) {
  _createPublicTenant(tenantAlias, PRIVATE, (tenant, tenantAdmin) => {
    // Only global admins can update tenant privacy, so use that
    ConfigTestUtil.updateConfigAndWait(
      createGlobalAdminRestContext(),
      tenant.alias,
      { 'oae-tenants/tenantprivacy/tenantprivate': true },
      (error) => {
        assert.notExists(error);
        return callback(tenant, tenantAdmin);
      }
    );
  });
};

/**
 * Create a public tenant with the given alias
 *
 * @param  {String}         tenantAlias                 The alias of the tenant
 * @param  {String}         hostSeed                    The host seed to use to generate the tenant to help identify ids in test logs (e.g., 'private')
 * @param  {Function}       callback                    Standard callback function
 * @param  {Tenant}         callback.tenant             The created tenant object
 * @param  {Object}         callback.tenantAdmin        The user info object containing the user profile and REST context of the tenant admin user
 * @throws {Error}                                      An assertion error is thrown if there is an issue creating the tenant
 * @api private
 */
const _createPublicTenant = function (tenantAlias, hostSeed, callback) {
  createTenantWithAdmin(
    tenantAlias,
    TenantsTestUtil.generateTestTenantHost(hostSeed, generateRandomText()),
    (error, tenant, tenantAdminRestCtx, tenantAdminUser) => {
      assert.notExists(error);
      return callback(tenant, { user: tenantAdminUser, restContext: tenantAdminRestCtx });
    }
  );
};

/**
 * Ensure the provided rest context is authenticated by executing a request to the me feed
 *
 * @param  {RestContext}    restCtx         The REST context to ensure is authenticated
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 * @api private
 */
const _ensureAuthenticated = function (restCtx, callback) {
  if (restCtx.cookieJar) {
    return callback();
  }

  // eslint-disable-next-line no-unused-vars
  RestAPI.User.getMe(restCtx, (error, me) => {
    if (error) {
      return callback(error);
    }

    return callback();
  });
};

/**
 * Create the initial test configuration
 *
 * @return {Object}    config    JSON object containing configuration values for Cassandra, Redis, logging and telemetry
 */
const createInitialTestConfig = async function () {
  /**
   * Require the configuration file, from here on the configuration should be
   * passed around instead of required
   */

  const defaultToLocal = defaultTo('local');
  const preffixPath = concat(`${process.cwd()}/`);
  const suffixExtension = concat(__, '.js');

  const environment = compose(suffixExtension, preffixPath, defaultToLocal)(process.env.NODE_ENV);

  // let envConfig;
  async function loadConfig() {
    let envConfig = await import(environment);
    envConfig = envConfig.config;
    let mergedConfig = _.extend({}, config, envConfig);

    // Streams can't be deep copied so we stash them in a variable, delete them from the config
    // and add them to the final config
    const logConfig = mergedConfig.log;
    delete mergedConfig.log;
    mergedConfig = clone(mergedConfig);
    mergedConfig.log = logConfig;

    // The Cassandra connection config that should be used for unit tests, using
    // a custom keyspace for just the tests
    mergedConfig.cassandra.keyspace = 'oaeTest';

    // We'll stick all our redis data in a separate DB index.
    mergedConfig.redis.dbIndex = 1;

    // Log everything (except mocha output) to tests.log
    mergedConfig.log.streams = [
      {
        level: mergedConfig.test.level || 'info',
        path: mergedConfig.test.path || './tests.log'
      }
    ];

    // Unit test will purge the rabbit mq queues when they're connected
    mergedConfig.mq.purgeQueuesOnStartup = true;

    // In order to speed up some of the tests and to avoid mocha timeouts, we reduce the default time outs
    mergedConfig.previews.office.timeout = 30_000;
    mergedConfig.previews.screenShotting.timeout = 30_000;

    mergedConfig.search.index.name = 'oaetest';
    // eslint-disable-next-line camelcase
    mergedConfig.search.index.settings.number_of_shards = 1;
    // eslint-disable-next-line camelcase
    mergedConfig.search.index.settings.number_of_replicas = 0;

    /**
     * This is a low-level setting. Some store implementations have poor concurrency
     * or disable optimizations for heap memory usage. We recommend sticking to the defaults.
     * https://www.elastic.co/guide/en/elasticsearch/reference/7.x/index-modules-store.html
     *
     * mergedConfig.search.index.settings.store = { type: 'memory' };
     */

    mergedConfig.search.index.destroyOnStartup = true;

    // Disable the poller so it only collects manually
    mergedConfig.activity.collectionPollingFrequency = -1;
    mergedConfig.activity.mail.pollingFrequency = 3600;
    mergedConfig.activity.numberOfProcessingBuckets = 1;

    mergedConfig.servers.serverInternalAddress = null;
    mergedConfig.servers.globalAdminAlias = 'admin';
    mergedConfig.servers.globalAdminHost = 'localhost:3000';
    mergedConfig.servers.guestTenantAlias = 'guest';
    mergedConfig.servers.guestTenantHost = 'guest.oae.com';
    mergedConfig.servers.useHttps = false;

    // Force emails into debug mode
    mergedConfig.email.debug = true;

    // Set mail grace period to 0 so emails are sent immediately
    mergedConfig.activity.mail.gracePeriod = 0;

    // Disable mixpanel tracking
    mergedConfig.mixpanel.enabled = false;

    // Explicitly use a different cookie
    mergedConfig.cookie.name = CONFIG_COOKIE_NAME;

    return mergedConfig;
  }

  return loadConfig();
};

/**
 * Bind request logging for oae-rest unit test debugging.
 *
 * @api private
 */
const _bindRequestLogger = function () {
  // const requestLog = require('oae-logger').logger('request-log');
  RestUtil.emitter.on('request', (restCtx, url, method, data) => {
    requestLog().trace(
      {
        restCtx,
        url,
        method,
        data
      },
      'Performing REST request'
    );
  });

  RestUtil.emitter.on('response', (body, response) => {
    requestLog().trace({ res: response, body }, 'REST Request complete');
  });

  RestUtil.emitter.on('error', (error, body, response) => {
    requestLog().error(
      {
        err: error,
        res: response,
        body
      },
      'An error occurred sending a REST request'
    );
  });
};

/**
 * Set up Hilary so tests can be executed.
 *     - Initialize Cassandra
 *     - Drop the Cassandra keyspace if required
 *     - Flush the Redis DB index
 *     - Initialize the application modules
 *     - Disable the preview processor
 *
 * @param  {Object}      config                    JSON object containing configuration values for Cassandra, Redis, logging and telemetry
 * @param  {Boolean}     dropKeyspaceBeforeTest    Whether or not we should drop the keyspace before the test.
 * @param  {Function}    callback                  Standard callback function
 */
const setUpBeforeTests = function (config, dropKeyspaceBeforeTest, callback) {
  Cassandra.init(config.cassandra, (error) => {
    if (error) return callback(new Error(error.msg || error.message));

    const done = function (error) {
      if (error) return callback(new Error(error.msg));

      // Run migrations otherwise keyspace is empty
      migrationRunner.runMigrations(config.cassandra, () => {
        Cassandra.close(() => {
          // Initialize the application modules
          OAE.init(config, (error_) => {
            if (error_) return callback(new Error(error_.msg));

            _bindRequestLogger();
          });

          /**
           * Defer the test setup until after the task handlers are successfully bound and all the queues are drained.
           * This will always be fired after OAE.init has successfully finished.
           */
          MQ.emitter.on('ready', (error_) => {
            if (error_) return callback(new Error(error_.msg));

            // Set up a couple of test tenants
            setUpTenants((error_) => {
              if (error_) return callback(new Error(error_.msg));

              log().info('Disabling the preview processor during tests');
              PreviewAPI.disable((error_) => {
                if (error_) return callback(new Error(error_.msg));

                return callback();
              });
            });
          });
        });
      });
    };

    if (dropKeyspaceBeforeTest) {
      log().info('Dropping keyspace "%s" to clean up before tests', config.cassandra.keyspace);
      Cassandra.dropKeyspace(config.cassandra.keyspace, done);
    } else {
      done();
    }
  });
};

/**
 * Flush the Redis DB index and purge Rabbit MQ after the tests complete
 *
 * @param  {Function}    callback    Standard callback function
 */
const cleanUpAfterTests = (callback) => {
  Redis.flush((error) => {
    if (error) log().error({ err: error }, 'Error flushing Redis data after test completion');

    return callback();
  });
};

const cleanAllQueues = (callback) => {
  MQ.purgeAllBoundQueues((error) => {
    if (error) log().error({ err: error }, 'Error purging redis queues');

    return callback();
  });
};

/*
 * Whether or not the current process is part of an integration test. An integration
 * test can be disabled by setting the environment variable `OAE_TEST_INTEGRATION` to
 * `false`. Unless the environment variable is set to false, an integration test is
 * assumed and this  method will return `true`
 *
 * @return {Boolean}    `true` when the current process is part of an integration test, `false` otherwise
 */
const isIntegrationTest = function () {
  return process.env.OAE_TEST_INTEGRATION !== 'false';
};

export {
  CONFIG_COOKIE_NAME,
  createTestServer,
  clearAllData,
  setUpTenants,
  generateTestUsers,
  generateTestGroups,
  createTenantWithAdmin,
  generateGroupHierarchy,
  generateTestCassandraName,
  generateTestElasticSearchName,
  generateTestUserId,
  generateTestGroupId,
  generateTestEmailAddress,
  createTenantRestContext,
  createTenantAdminRestContext,
  createGlobalRestContext,
  createGlobalAdminRestContext,
  createTenantAdminContext,
  createGlobalAdminContext,
  getUserFromRestContext,
  generateResourceIds,
  generateRandomText,
  createFileReadableStream,
  setupMultiTenantPrivacyEntities,
  createInitialTestConfig,
  setUpBeforeTests,
  cleanUpAfterTests,
  cleanAllQueues,
  isIntegrationTest
};
