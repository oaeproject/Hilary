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

import { assert } from 'chai';
import { toLower, compose, prop, length, head, find, slice, propEq } from 'ramda';

import * as TenantsTestUtil from 'oae-tenants/lib/test/util';
import * as TestsUtil from 'oae-tests';
import * as SearchTestsUtil from 'oae-search/lib/test/util';

const { generateRandomText, createTenantRestContext, createGlobalAdminRestContext } = TestsUtil;
const { assertSearchSucceeds } = SearchTestsUtil;
const {
  generateTestTenantAlias,
  generateTestTenantHost,
  createTenantAndWait,
  stopTenantAndWait,
  generateTestTenants
} = TenantsTestUtil;

const NO_PARAMS = null;
const TENANTS = 'tenants';
const ALIAS = 'alias';

const getAlias = prop('alias');
const resultsWithin = prop('results');
const getDisplayName = prop('displayName');
const getHost = prop('host');
const aliasIsTheSameAsTenants = compose(propEq(ALIAS), getAlias);

describe('Tenants Search', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let asCambridgeAnonymousUser = null;
  // Rest context that can be used every time we need to make a request as a global admin
  let asGlobalAdmin = null;

  /*!
   * Initialize our rest contexts before each test
   */
  beforeEach((callback) => {
    // Fill up anonymous rest context
    asCambridgeAnonymousUser = createTenantRestContext(global.oaeTests.tenants.cam.host);

    // Fill up global admin rest context
    asGlobalAdmin = createGlobalAdminRestContext();

    callback();
  });

  /**
   * Test that verifies tenant search is available on the global admin server
   */
  it('verify tenants search works on the global admin server', (callback) => {
    assertSearchSucceeds(asGlobalAdmin, TENANTS, NO_PARAMS, { q: 'Some querystring' }, (result) => {
      _assertEmptyTenantsSearchResult(result);

      return callback();
    });
  });

  /**
   * Test that verifies tenants search matches a tenant by all expected properties
   */
  it('verify it matches a tenant by alias, display name and host with case-insensitive search', (callback) => {
    const someAlias = generateTestTenantAlias();
    const displayName = generateRandomText();
    const someHost = generateTestTenantHost();

    // Ensure none of the strings match a tenant yet
    assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { q: toLower(someAlias) }, (result) => {
      _assertEmptyTenantsSearchResult(result);

      assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { q: toLower(displayName) }, (result) => {
        _assertEmptyTenantsSearchResult(result);

        assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { q: toLower(someHost) }, (result) => {
          _assertEmptyTenantsSearchResult(result);

          // Create a tenant with the alias, display name and host
          createTenantAndWait(asGlobalAdmin, someAlias, displayName, someHost, NO_PARAMS, (error) => {
            assert.isNotOk(error);

            setTimeout(
              assertSearchSucceeds,
              2000,
              asCambridgeAnonymousUser,
              TENANTS,
              NO_PARAMS,
              { q: toLower(someAlias) },
              (result) => {
                const firstResultFrom = compose(head, resultsWithin);
                const getAliasFromFirstResult = compose(getAlias, firstResultFrom);
                const getDisplayNameFromFirstResult = compose(getDisplayName, firstResultFrom);
                const getHostFromFirstResult = compose(getHost, firstResultFrom);

                // Ensure we get the tenant in all searches now
                assert.strictEqual(result.total, 1);
                assert.strictEqual(getAliasFromFirstResult(result), someAlias);
                assert.strictEqual(getDisplayNameFromFirstResult(result), displayName);
                assert.strictEqual(getHostFromFirstResult(result), toLower(someHost));

                assertSearchSucceeds(
                  asCambridgeAnonymousUser,
                  TENANTS,
                  NO_PARAMS,
                  { q: toLower(displayName) },
                  (result) => {
                    assert.strictEqual(result.total, 1);
                    assert.strictEqual(getAliasFromFirstResult(result), someAlias);
                    assert.strictEqual(getDisplayNameFromFirstResult(result), displayName);
                    assert.strictEqual(getHostFromFirstResult(result), toLower(someHost));

                    assertSearchSucceeds(
                      asCambridgeAnonymousUser,
                      TENANTS,
                      NO_PARAMS,
                      { q: toLower(someHost) },
                      (result) => {
                        assert.strictEqual(result.total, 1);
                        assert.strictEqual(getAliasFromFirstResult(result), someAlias);
                        assert.strictEqual(getDisplayNameFromFirstResult(result), displayName);
                        assert.strictEqual(getHostFromFirstResult(result), toLower(someHost));

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

  /**
   * Test that verifies partial matches get results
   */
  it('verify it matches partial matches', (callback) => {
    generateTestTenants(asGlobalAdmin, 1, (tenant) => {
      const alias = compose(slice(0, 3), toLower, getAlias)(tenant);
      const displayName = compose(slice(0, 3), toLower, getDisplayName)(tenant);
      const host = tenant.host.toLowerCase().slice(0, 3);

      // Take just the first 3 characters of each field and ensure we get the tenant
      assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { q: alias }, (result) => {
        assert.ok(find(aliasIsTheSameAsTenants(tenant), resultsWithin(result)));

        assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { q: displayName }, (result) => {
          assert.ok(find(aliasIsTheSameAsTenants(tenant), resultsWithin(result)));

          assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { q: host }, (result) => {
            assert.ok(find(aliasIsTheSameAsTenants(tenant), resultsWithin(result)));

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
  it('verify tenant updates are persisted and search for disabled tenants', (callback) => {
    generateTestTenants(asGlobalAdmin, 1, (tenant) => {
      // Ensure the tenant can be found in search
      assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { q: getAlias(tenant) }, (result) => {
        assert.ok(find(aliasIsTheSameAsTenants(tenant), resultsWithin(result)));

        // Stop the tenant and ensure it no longer appears
        stopTenantAndWait(asGlobalAdmin, getAlias(tenant), () => {
          assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { q: getAlias(tenant) }, (result) => {
            _assertEmptyTenantsSearchResult(result);

            // Search while enabling disabled tenants and ensure it appears again
            assertSearchSucceeds(
              asCambridgeAnonymousUser,
              TENANTS,
              NO_PARAMS,
              { q: getAlias(tenant), disabled: true },
              (result) => {
                assert.ok(find(propEq(ALIAS, getAlias(tenant)), resultsWithin(result)));

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
  it('verify tenant search paging', (callback) => {
    // Get the first 3 tenants in search
    assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { start: 0, limit: 3 }, (result) => {
      _assertTenantsSearchResult(result);
      assert.lengthOf(resultsWithin(result), 3);
      const tenants = resultsWithin(result);

      // Get just the first, second and third and ensure you get just the one tenant
      assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { start: 0, limit: 1 }, (result) => {
        _assertTenantsSearchResult(result);
        assert.deepStrictEqual(resultsWithin(result), slice(0, 1, tenants));

        assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { start: 1, limit: 1 }, (result) => {
          _assertTenantsSearchResult(result);
          assert.deepStrictEqual(resultsWithin(result), slice(1, 2, tenants));

          assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { start: 2, limit: 1 }, (result) => {
            _assertTenantsSearchResult(result);
            assert.deepStrictEqual(resultsWithin(result), slice(2, 3, tenants));

            // Get 2 at a time and ensure you get the two expected
            assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { start: 0, limit: 2 }, (result) => {
              _assertTenantsSearchResult(result);
              assert.deepStrictEqual(resultsWithin(result), slice(0, 2, tenants));

              assertSearchSucceeds(asCambridgeAnonymousUser, TENANTS, NO_PARAMS, { start: 1, limit: 2 }, (result) => {
                _assertTenantsSearchResult(result);
                assert.deepStrictEqual(resultsWithin(result), slice(1, 3, tenants));

                return callback();
              });
            });
          });
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
const _assertEmptyTenantsSearchResult = (result) => {
  _assertTenantsSearchResult(result);
  assert.strictEqual(result.total, 0);
  assert.lengthOf(resultsWithin(result), 0);
};

/*!
 * Perform a sanity assertion on the tenants earch result object
 *
 * @param  {SearchResult}   result  The search result object
 * @throws {AssertionError}         Thrown if the result object doesn't match the intended format
 */
const _assertTenantsSearchResult = (result) => {
  assert.ok(result);
  assert.isNumber(result.total);
  assert.isArray(resultsWithin(result));
  assert.isAtMost(compose(length, resultsWithin)(result), result.total);
};
