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

import { assert } from 'chai';
import { describe, before, it } from 'mocha';
import { fromJS } from 'immutable';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as redis from 'oae-util/lib/redis';

const { getVersion } = RestAPI.Version;

const PATH = 'path';
const PACKAGE_JSON = 'package.json';

const { createTenantRestContext } = TestsUtil;

describe('Git information', () => {
  before((done) => {
    redis.flush(done);
  });

  /**
   * Test that verifies that the git information is returned
   */
  it('verify that the submodules exist and are up to date', (callback) => {
    // Create various rest contexts
    const asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.cam.host);

    // Verify the version information on regular tenancies
    _verifyVersionInformation(asCambridgeAnonymousUser, callback);
  });

  /*!
   * Verify the version information
   *
   * @param  {RestContext}        restContext     The rest context to get the version information with
   * @param  {Function}           callback        Standard callback function
   * @throws {AssertionError}                     Thrown if any assertions fail
   */
  function _verifyVersionInformation(restContext, callback) {
    getVersion(restContext, (error, gitRepoInformation) => {
      assert.notExists(error);

      const repoInfo = fromJS(gitRepoInformation);

      const hilaryInfo = repoInfo.get('Hilary');
      assert.isObject(hilaryInfo);
      assert.isString(hilaryInfo.get('lastCommitId'));
      assert.isString(hilaryInfo.get('lastCommitDate'));
      assert.isString(hilaryInfo.get('latestTag'));

      const submodules = hilaryInfo.get('submodules');
      assert.isObject(submodules);
      assert.strictEqual(submodules.size, 3);

      // oae-rest submodule
      let submoduleName = 'oae-rest';
      let submodulePath = submodules.get(submoduleName).get(PATH);

      assert.strictEqual(submodulePath.size, 1);
      assert.ok(submodulePath.get(0).get(0).includes(PACKAGE_JSON));
      assert.ok(submodulePath.get(0).get(0).includes(submoduleName));

      // 3akai-ux submodule
      submoduleName = '3akai-ux';
      submodulePath = submodules.get(submoduleName).get(PATH);
      assert.strictEqual(submodulePath.size, 1);
      assert.ok(submodulePath.get(0).get(0).includes(PACKAGE_JSON));
      assert.ok(submodulePath.get(0).get(0).includes(submoduleName));

      // restjsdoc submodule
      submoduleName = 'restjsdoc';
      submodulePath = submodules.get(submoduleName).get(PATH);
      assert.strictEqual(submodulePath.size, 1);
      assert.ok(submodulePath.get(0).get(0).includes(PACKAGE_JSON));
      assert.ok(submodulePath.get(0).get(0).includes(submoduleName));

      return callback();
    });
  }
});
