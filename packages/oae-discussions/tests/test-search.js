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

import * as AuthzUtil from 'oae-authz/lib/util';
import * as RestAPI from 'oae-rest';
import * as SearchTestsUtil from 'oae-search/lib/test/util';
import * as TestsUtil from 'oae-tests';

import { find, equals, propSatisfies } from 'ramda';

describe('Discussion Search', () => {
  // REST contexts we can use to do REST requests
  let asCambridgeAdminUser = null;

  before((done) => {
    asCambridgeAdminUser = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    done();
  });

  /**
   * Search for a discussion in a result set.
   *
   * @param  {Document[]} results         An array of search documents
   * @param  {String}     discussionId    The id of the discussion we should look for.
   * @return {Document}                   The discussion with id `discussionId` (or null if it could not be found).
   */
  const _getDocument = (results, discussionId) => find(propSatisfies(equals(discussionId), 'id'), results);

  describe('Indexing', () => {
    /**
     * A test that verifies a discussion item is indexable and searchable.
     */
    it('verify indexing of a discussion', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeAdminUser, 1, (error, users) => {
        assert.notExists(error);

        const { 0: user } = users;

        const randomText = TestsUtil.generateRandomText(5);
        RestAPI.Discussions.createDiscussion(
          user.restContext,
          randomText,
          randomText,
          'public',
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);

            SearchTestsUtil.searchAll(
              user.restContext,
              'general',
              null,
              { resourceTypes: 'discussion', q: randomText },
              (error, results) => {
                assert.notExists(error);

                const doc = _getDocument(results.results, discussion.id);
                assert.ok(doc);
                assert.strictEqual(doc.displayName, randomText);
                assert.strictEqual(doc.description, randomText);
                assert.strictEqual(
                  doc.profilePath,
                  '/discussion/' +
                    global.oaeTests.tenants.cam.alias +
                    '/' +
                    AuthzUtil.getResourceFromId(discussion.id).resourceId
                );
                callback();
              }
            );
          }
        );
      });
    });

    /**
     * Verifies that updating a discussion, updates the search index
     */
    it('verify updating the metadata for a discussion, updates the index', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeAdminUser, 1, (error, users) => {
        assert.notExists(error);

        const { 0: user } = users;

        const randomText1 = TestsUtil.generateRandomText(5);
        const randomText2 = TestsUtil.generateRandomText(5);

        RestAPI.Discussions.createDiscussion(
          user.restContext,
          randomText1,
          randomText1,
          'public',
          null,
          null,
          (error, discussion) => {
            assert.notExists(error);

            RestAPI.Discussions.updateDiscussion(
              user.restContext,
              discussion.id,
              { displayName: randomText2, description: randomText2 },
              (error_) => {
                assert.notExists(error_);

                SearchTestsUtil.searchAll(
                  user.restContext,
                  'general',
                  null,
                  { resourceTypes: 'discussion', q: randomText2 },
                  (error, results) => {
                    assert.notExists(error);
                    const doc = _getDocument(results.results, discussion.id);
                    assert.ok(doc);
                    assert.strictEqual(doc.displayName, randomText2);
                    assert.strictEqual(doc.description, randomText2);
                    assert.strictEqual(
                      doc.profilePath,
                      '/discussion/' +
                        global.oaeTests.tenants.cam.alias +
                        '/' +
                        AuthzUtil.getResourceFromId(discussion.id).resourceId
                    );
                    callback();
                  }
                );
              }
            );
          }
        );
      });
    });
  });
});
