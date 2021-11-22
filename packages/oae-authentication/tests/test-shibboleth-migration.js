/*
 * Copyright 2016 Apereo Foundation (AF) Licensed under the
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

import { format, callbackify } from 'node:util';
import { assert } from 'chai';
import _ from 'underscore';
import csv from 'csv';
import temp from 'temp';
import { flatten, head, map, isEmpty, pipe, pluck } from 'ramda';

import { runBatchQuery, runQuery, rowToHash } from 'oae-util/lib/cassandra.js';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import { logger } from 'oae-logger';
import * as ShibbolethMigrator from '../../../etc/migration/shibboleth_migration/migrate-users-to-shibboleth.js';

const log = logger('oae-authentication');

const { createTenantAdminRestContext } = TestsUtil;

describe('Shibboleth Migration', () => {
  let camAdminRestContext = null;
  let gtAdminRestContext = null;
  let csvStream = null;

  before((callback) => {
    camAdminRestContext = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = createTenantAdminRestContext(global.oaeTests.tenants.gt.host);

    // Set up the fake CSV file for errors
    const fakeStream = temp.createWriteStream();
    fakeStream.on('error', (error) => {
      log().error({ err: error }, 'Error occurred when writing to the warnings file');
    });
    csvStream = csv.stringify({
      columns: ['principal_id', 'email', 'display_name', 'login_id', 'message'],
      header: true,
      quoted: true
    });
    csvStream.pipe(fakeStream);

    return callback();
  });

  after((callback) => {
    // Make sure we close the CSV stream and remove the file
    csvStream.end(() => callback());
  });

  /*!
   * Check that Shibboleth login ID records were created for all users with Google login
   *
   * @param  String           tenantAlias         The tenant we are testing
   * @param  {Object[]}       users               The users we want to check login for
   * @param  {Function}       callback            Invoked when assertions are complete
   * @throws {AssertionError}                     Thrown if the assertions fail
   */
  const _assertHaveShibbolethLoginIds = function (tenantAlias, users, callback) {
    if (isEmpty(users)) return callback();

    const user = users.shift();
    const shibLogin = format('%s:shibboleth:%s', tenantAlias, user.email);

    callbackify(runQuery)(
      'SELECT "loginId" FROM "AuthenticationLoginId" WHERE "loginId" = ?',
      [shibLogin],
      (error, rows) => {
        assert.notExists(error);

        const result = pipe(map(rowToHash), pluck('loginId'), head)(rows);
        assert.strictEqual(result, shibLogin);
        return _assertHaveShibbolethLoginIds(tenantAlias, users, callback);
      }
    );
  };

  /*!
   * Check that no Shibboleth login ID records were created for users without a Google login ID
   *
   * @param  String           tenantAlias         The tenant we are testing
   * @param  {Object[]}       users               The users we want to check login for
   * @param  {Function}       callback            Invoked when assertions are complete
   * @throws {AssertionError}                     Thrown if the assertions fail
   */
  const _assertHaveNoShibbolethLoginIds = function (tenantAlias, users, callback) {
    if (isEmpty(users)) {
      return callback();
    }

    const user = users.shift();
    const shibLogin = format('%s:shibboleth:%s', tenantAlias, user.email);

    callbackify(runQuery)(
      'SELECT "loginId" FROM "AuthenticationLoginId" WHERE "loginId" = ?',
      [shibLogin],
      (error, rows) => {
        assert.notExists(error);
        const result = map(rowToHash, rows);

        assert.ok(isEmpty(result));
        return _assertHaveNoShibbolethLoginIds(tenantAlias, users, callback);
      }
    );
  };

  /*!
   * Create Google authentication records for a set of users
   *
   * @param  String           tenantAlias         The tenant we are testing
   * @param  {Object[]}       users               The users we want to check login for
   * @return {Object[]}       queries             The Cassandra queries to create the records
   */
  const _createGoogleLogins = function (tenantAlias, users) {
    // Create Google logins for users
    const googleLoginIds = map(
      (user) => ({
        userId: user.id,
        loginId: format('%s:google:%s', tenantAlias, user.email)
      }),
      users
    );

    const queries = pipe(
      map((googleLoginId) => [
        {
          query:
            'INSERT INTO "AuthenticationUserLoginId" ("loginId", "userId", "value") VALUES (?, ?, ?)',
          parameters: [googleLoginId.loginId, googleLoginId.userId, '1']
        },
        {
          query: 'INSERT INTO "AuthenticationLoginId" ("loginId", "userId") VALUES (?, ?)',
          parameters: [googleLoginId.loginId, googleLoginId.userId]
        }
      ]),
      flatten
    )(googleLoginIds);

    return queries;
  };

  /**
   * Test that verifies Shibboleth logins are created for a tenant
   */
  it('verify new Shibboleth logins are created', (callback) => {
    TestsUtil.generateTestUsers(camAdminRestContext, 20, (error, users) => {
      assert.notExists(error);
      users = pluck('user', users);

      RestAPI.Tenants.getTenant(camAdminRestContext, null, (error, tenant) => {
        assert.notExists(error);
        const tenantAlias = tenant.alias;
        const queries = _createGoogleLogins(tenantAlias, users);

        callbackify(runBatchQuery)(queries, (error_) => {
          assert.notExists(error_);

          // Run the migration
          ShibbolethMigrator.doMigration(tenantAlias, csvStream, (error /* , errors */) => {
            assert.notExists(error);

            _assertHaveShibbolethLoginIds(tenantAlias, users, () => callback());
          });
        });
      });
    });
  });

  /**
   * Test that verifies no logins are created for users without Google login IDs
   */
  it('verify no Shibboleth logins are created for users without Google IDs', (callback) => {
    TestsUtil.generateTestUsers(gtAdminRestContext, 20, (error, users) => {
      assert.notExists(error);
      users = pluck('user', users);

      // Split the users into a group with and a group without Google IDs
      const googleUsers = _.sample(users, 10);
      const nonGoogleUsers = _.difference(users, googleUsers);

      RestAPI.Tenants.getTenant(gtAdminRestContext, null, (error, tenant) => {
        assert.notExists(error);
        const tenantAlias = tenant.alias;
        const queries = _createGoogleLogins(tenantAlias, googleUsers);

        callbackify(runBatchQuery)(queries, (error_) => {
          assert.notExists(error_);

          // Run the migration
          ShibbolethMigrator.doMigration(tenantAlias, csvStream, (error /* , errors */) => {
            assert.notExists(error);

            _assertHaveShibbolethLoginIds(tenantAlias, googleUsers, () => {
              _assertHaveNoShibbolethLoginIds(tenantAlias, nonGoogleUsers, () => callback());
            });
          });
        });
      });
    });
  });
});
