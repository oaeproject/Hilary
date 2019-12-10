/*
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

import assert from 'assert';
import _ from 'underscore';
import { fromJS } from 'immutable';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as redis from 'oae-util/lib/redis';

const PATH = 'path';
const PACKAGE_JSON = 'package.json';

describe('Git information', function() {
  before(done => {
    redis.flush(done);
  });

  /**
   * Test that verifies that the git information is returned
   */
  it('verify that the submodules exist and are up to date', function(callback) {
    // Create various rest contexts
    const adminTenantRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    const anonTenantRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    TestsUtil.generateTestUsers(adminTenantRestContext, 1, function(err, users, user) {
      assert.ok(!err);
      const userTenantRestContext = user.restContext;

      // Verify the version information on regular tenancies
      _verifyVersionInformation(anonTenantRestContext, callback);
    });
  });

  /*!
   * Verify the version information
   *
   * @param  {RestContext}        restContext     The rest context to get the version information with
   * @param  {Function}           callback        Standard callback function
   * @throws {AssertionError}                     Thrown if any assertions fail
   */
  function _verifyVersionInformation(restContext, callback) {
    RestAPI.Version.getVersion(restContext, function(err, gitRepoInformation) {
      assert.ok(!err);

      const repoInfo = fromJS(gitRepoInformation);

      const hilaryInfo = repoInfo.get('Hilary');
      assert.ok(_.isObject(hilaryInfo));
      assert.ok(_.isString(hilaryInfo.get('lastCommitId')));
      assert.ok(_.isString(hilaryInfo.get('lastCommitDate')));
      assert.ok(_.isString(hilaryInfo.get('latestTag')));

      const submodules = hilaryInfo.get('submodules');
      assert.ok(_.isObject(submodules));
      assert.strictEqual(submodules.size, 3);

      // oae-rest submodule
      let submoduleName = 'oae-rest';
      let submodulePath = submodules.get(submoduleName).get(PATH);
      assert.strictEqual(submodulePath.size, 1);
      assert.ok(
        submodulePath
          .get(0)
          .get(0)
          .includes(PACKAGE_JSON)
      );
      assert.ok(
        submodulePath
          .get(0)
          .get(0)
          .includes(submoduleName)
      );

      // 3akai-ux submodule
      submoduleName = '3akai-ux';
      submodulePath = submodules.get(submoduleName).get(PATH);
      assert.strictEqual(submodulePath.size, 1);
      assert.ok(
        submodulePath
          .get(0)
          .get(0)
          .includes(PACKAGE_JSON)
      );
      assert.ok(
        submodulePath
          .get(0)
          .get(0)
          .includes(submoduleName)
      );

      // restjsdoc submodule
      submoduleName = 'restjsdoc';
      submodulePath = submodules.get(submoduleName).get(PATH);
      assert.strictEqual(submodulePath.size, 1);
      assert.ok(
        submodulePath
          .get(0)
          .get(0)
          .includes(PACKAGE_JSON)
      );
      assert.ok(
        submodulePath
          .get(0)
          .get(0)
          .includes(submoduleName)
      );

      callback();
    });
  }
});
