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

/* esling-disable no-unused-vars */
import { assert } from 'chai';

import * as RestAPI from 'oae-rest';
import * as SearchTestsUtil from 'oae-search/lib/test/util';
import * as TestsUtil from 'oae-tests';

const { createTenantAdminRestContext } = TestsUtil;

describe('Discussion Library Search', () => {
  // let asCambridgeAnonymousUser = null;
  let asCambridgeAdminUser = null;

  before(done => {
    // asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.cam.host);
    asCambridgeAdminUser = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    done();
  });

  describe('Library search', () => {
    /**
     * A test that verifies a discussion library can be searched through
     */
    it('verify searching through a discussion library', callback => {
      TestsUtil.generateTestUsers(asCambridgeAdminUser, 1, (err, users) => {
        assert.notExists(err);

        const { 0: simong } = users;

        // Create 2 discussions
        const randomTextA = TestsUtil.generateRandomText(25);
        const randomTextB = TestsUtil.generateRandomText(25);

        RestAPI.Discussions.createDiscussion(
          simong.restContext,
          randomTextA,
          randomTextA,
          'public',
          null,
          null,
          (err, discussionA) => {
            assert.notExists(err);

            RestAPI.Discussions.createDiscussion(simong.restContext, randomTextB, randomTextB, 'public', null, null, (
              err /* , discussionB */
            ) => {
              assert.notExists(err);

              // Ensure that the randomTextA discussion returns and scores better than randomTextB
              SearchTestsUtil.searchAll(
                simong.restContext,
                'discussion-library',
                [simong.user.id],
                { q: randomTextA },
                (err, results) => {
                  assert.notExists(err);
                  assert.ok(results.results);

                  const doc = results.results[0];
                  assert.ok(doc);
                  assert.strictEqual(doc.id, discussionA.id);
                  assert.strictEqual(doc.displayName, randomTextA);
                  assert.strictEqual(doc.description, randomTextA);
                  callback();
                }
              );
            });
          }
        );
      });
    });
  });
});
