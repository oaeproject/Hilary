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
import { fromJS } from 'immutable';

import _ from 'underscore';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

describe('Git information', function() {
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

      const submodulePointers = hilaryInfo.get('submodulePointers');
      assert.ok(_.isObject(submodulePointers));
      assert.strictEqual(submodulePointers.size, 3);

      const frontendInfo = repoInfo.get('3akai-ux');
      assert.ok(_.isObject(frontendInfo));
      assert.ok(_.isString(frontendInfo.get('lastCommitId')));
      assert.ok(_.isString(frontendInfo.get('lastCommitDate')));
      assert.ok(_.isString(frontendInfo.get('latestTag')));
      assert.strictEqual(frontendInfo.get('submodulePointers').size, 0);

      const oaeRestInfo = repoInfo.get('oae-rest');
      assert.ok(_.isObject(oaeRestInfo));
      assert.ok(_.isString(oaeRestInfo.get('lastCommitId')));
      assert.ok(_.isString(oaeRestInfo.get('lastCommitDate')));
      assert.ok(_.isString(oaeRestInfo.get('latestTag')));
      assert.strictEqual(oaeRestInfo.get('submodulePointers').size, 0);

      const restjsDocInfo = repoInfo.get('restjsdoc');
      assert.ok(_.isObject(restjsDocInfo));
      assert.ok(_.isString(restjsDocInfo.get('lastCommitId')));
      assert.ok(_.isString(restjsDocInfo.get('lastCommitDate')));
      assert.ok(_.isString(restjsDocInfo.get('latestTag')));
      assert.strictEqual(restjsDocInfo.get('submodulePointers').size, 0);

      // Verify that the latest commit on every submodule repo is where Hilary is pointing
      // this would mean that Hilary submodules are up to date
      assert.strictEqual(submodulePointers.get('3akai-ux'), frontendInfo.get('lastCommitId'));
      assert.strictEqual(submodulePointers.get('packages/oae-rest'), oaeRestInfo.get('lastCommitId'));
      assert.strictEqual(submodulePointers.get('packages/restjsdoc'), restjsDocInfo.get('lastCommitId'));

      callback();
    });
  }
});
