/*!
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

import * as TenantsTestUtil from 'oae-tenants/lib/test/util';
import * as TestsUtil from 'oae-tests';
import * as SearchTestsUtil from 'oae-search/lib/test/util';

describe('Tenants Search', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let anonymousRestContext = null;
  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;

  /*!
   * Initialize our rest contexts before each test
   */
  beforeEach(callback => {
    // Fill up anonymous rest context
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    // Fill up global admin rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();

    callback();
  });

  /**
   * Test that verifies tenant search is available on the global admin server
   */
  it('verify tenants search works on the global admin server', callback => {
    SearchTestsUtil.assertSearchSucceeds(globalAdminRestContext, 'tenants', null, { q: 'Some querystring' }, result => {
      _assertEmptyTenantsSearchResult(result);
      return callback();
    });
  });

  /**
   * Test that verifies tenants search matches a tenant by all expected properties
   */
  it('verify it matches a tenant by alias, display name and host with case-insensitive search', callback => {
    const alias = TenantsTestUtil.generateTestTenantAlias();
    const displayName = TestsUtil.generateRandomText();
    const host = TenantsTestUtil.generateTestTenantHost();

    // Ensure none of the strings match a tenant yet
    SearchTestsUtil.assertSearchSucceeds(anonymousRestContext, 'tenants', null, { q: alias.toLowerCase() }, result => {
      _assertEmptyTenantsSearchResult(result);
      SearchTestsUtil.assertSearchSucceeds(
        anonymousRestContext,
        'tenants',
        null,
        { q: displayName.toLowerCase() },
        result => {
          _assertEmptyTenantsSearchResult(result);

          SearchTestsUtil.assertSearchSucceeds(
            anonymousRestContext,
            'tenants',
            null,
            { q: host.toLowerCase() },
            result => {
              _assertEmptyTenantsSearchResult(result);

              // Create a tenant with the alias, display name and host
              TenantsTestUtil.createTenantAndWait(globalAdminRestContext, alias, displayName, host, null, err => {
                assert.ok(!err);

                setTimeout(
                  SearchTestsUtil.assertSearchSucceeds,
                  4000,
                  anonymousRestContext,
                  'tenants',
                  null,
                  { q: alias.toLowerCase() },
                  result => {
                    // Ensure we get the tenant in all searches now
                    assert.strictEqual(result.total, 1);
                    assert.strictEqual(result.results[0].alias, alias);
                    assert.strictEqual(result.results[0].displayName, displayName);
                    assert.strictEqual(result.results[0].host, host.toLowerCase());

                    SearchTestsUtil.assertSearchSucceeds(
                      anonymousRestContext,
                      'tenants',
                      null,
                      { q: displayName.toLowerCase() },
                      result => {
                        assert.strictEqual(result.total, 1);
                        assert.strictEqual(result.results[0].alias, alias);
                        assert.strictEqual(result.results[0].displayName, displayName);
                        assert.strictEqual(result.results[0].host, host.toLowerCase());

                        SearchTestsUtil.assertSearchSucceeds(
                          anonymousRestContext,
                          'tenants',
                          null,
                          { q: host.toLowerCase() },
                          result => {
                            assert.strictEqual(result.total, 1);
                            assert.strictEqual(result.results[0].alias, alias);
                            assert.strictEqual(result.results[0].displayName, displayName);
                            assert.strictEqual(result.results[0].host, host.toLowerCase());
                            return callback();
                          }
                        );
                      }
                    );
                  }
                );
              });
            }
          );
        }
      );
    });
  });

  /**
   * Test that verifies partial matches get results
   */
  it('verify it matches partial matches', callback => {
    TenantsTestUtil.generateTestTenants(globalAdminRestContext, 1, tenant => {
      const alias = tenant.alias.toLowerCase().slice(0, 3);
      const displayName = tenant.displayName.toLowerCase().slice(0, 3);
      const host = tenant.host.toLowerCase().slice(0, 3);

      // Take just the first 3 characters of each field and ensure we get the tenant
      SearchTestsUtil.assertSearchSucceeds(anonymousRestContext, 'tenants', null, { q: alias }, result => {
        assert.ok(_.findWhere(result.results, { alias: tenant.alias }));

        SearchTestsUtil.assertSearchSucceeds(anonymousRestContext, 'tenants', null, { q: displayName }, result => {
          assert.ok(_.findWhere(result.results, { alias: tenant.alias }));

          SearchTestsUtil.assertSearchSucceeds(anonymousRestContext, 'tenants', null, { q: host }, result => {
            assert.ok(_.findWhere(result.results, { alias: tenant.alias }));
            return callback();
          });
        });
      });
    });
  });

  /**
   * Test that verifies tenant updates are persisted in the search index and that disabled tenants
   * can be included or excluded from results when specified
   */
  it('verify tenant updates are persisted and search for disabled tenants', callback => {
    TenantsTestUtil.generateTestTenants(globalAdminRestContext, 1, tenant => {
      // Ensure the tenant can be found in search
      SearchTestsUtil.assertSearchSucceeds(anonymousRestContext, 'tenants', null, { q: tenant.alias }, result => {
        assert.ok(_.findWhere(result.results, { alias: tenant.alias }));

        // Stop the tenant and ensure it no longer appears
        TenantsTestUtil.stopTenantAndWait(globalAdminRestContext, tenant.alias, () => {
          SearchTestsUtil.assertSearchSucceeds(anonymousRestContext, 'tenants', null, { q: tenant.alias }, result => {
            _assertEmptyTenantsSearchResult(result);

            // Search while enabling disabled tenants and ensure it appears again
            SearchTestsUtil.assertSearchSucceeds(
              anonymousRestContext,
              'tenants',
              null,
              { q: tenant.alias, disabled: true },
              result => {
                assert.ok(_.findWhere(result.results, { alias: tenant.alias }));

                return callback();
              }
            );
          });
        });
      });
    });
  });

  /**
   * Test that verifies the paging properties of tenant search
   */
  it('verify tenant search paging', callback => {
    // Get the first 3 tenants in search
    SearchTestsUtil.assertSearchSucceeds(anonymousRestContext, 'tenants', null, { start: 0, limit: 3 }, result => {
      _assertTenantsSearchResult(result);
      assert.strictEqual(result.results.length, 3);
      const tenants = result.results;

      // Get just the first, second and third and ensure you get just the one tenant
      SearchTestsUtil.assertSearchSucceeds(anonymousRestContext, 'tenants', null, { start: 0, limit: 1 }, result => {
        _assertTenantsSearchResult(result);
        assert.deepStrictEqual(result.results, tenants.slice(0, 1));

        SearchTestsUtil.assertSearchSucceeds(anonymousRestContext, 'tenants', null, { start: 1, limit: 1 }, result => {
          _assertTenantsSearchResult(result);
          assert.deepStrictEqual(result.results, tenants.slice(1, 2));
          SearchTestsUtil.assertSearchSucceeds(
            anonymousRestContext,
            'tenants',
            null,
            { start: 2, limit: 1 },
            result => {
              _assertTenantsSearchResult(result);
              assert.deepStrictEqual(result.results, tenants.slice(2, 3));

              // Get 2 at a time and ensure you get the two expected
              SearchTestsUtil.assertSearchSucceeds(
                anonymousRestContext,
                'tenants',
                null,
                { start: 0, limit: 2 },
                result => {
                  _assertTenantsSearchResult(result);
                  assert.deepStrictEqual(result.results, tenants.slice(0, 2));
                  SearchTestsUtil.assertSearchSucceeds(
                    anonymousRestContext,
                    'tenants',
                    null,
                    { start: 1, limit: 2 },
                    result => {
                      _assertTenantsSearchResult(result);
                      assert.deepStrictEqual(result.results, tenants.slice(1, 3));

                      return callback();
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
});

/*!
 * Ensure the given search result object matches the expected format and indicates 0 results
 *
 * @param  {SearchResult}   result  The search result object
 * @throws {AssertionError}         Thrown if the result object doesn't match the intended format or is not empty
 */
const _assertEmptyTenantsSearchResult = function(result) {
  _assertTenantsSearchResult(result);
  assert.strictEqual(result.total, 0);
  assert.strictEqual(result.results.length, 0);
};

/*!
 * Perform a sanity assertion on the tenants earch result object
 *
 * @param  {SearchResult}   result  The search result object
 * @throws {AssertionError}         Thrown if the result object doesn't match the intended format
 */
const _assertTenantsSearchResult = function(result) {
  assert.ok(result);
  assert.ok(_.isNumber(result.total));
  assert.ok(_.isArray(result.results));
  assert.ok(result.results.length <= result.total);
};
