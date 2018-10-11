/*
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

const assert = require('assert');
const _ = require('underscore');

const { Context } = require('oae-context');
const TestsUtil = require('oae-tests/lib/util');

const { SearchConstants } = require('oae-search/lib/constants');
const SearchUtil = require('oae-search/lib/util');

describe('Search Util', () => {
  describe('#getSearchParams', () => {
    /**
     * Test that verifies falsey and empty values to getSearchParams
     */
    it('verify unspecified query params', callback => {
      let params = SearchUtil.getSearchParams();
      assert.ok(_.isObject(params));
      assert.ok(_.isEmpty(params));

      params = SearchUtil.getSearchParams(null);
      assert.ok(_.isObject(params));
      assert.ok(_.isEmpty(params));

      params = SearchUtil.getSearchParams({});
      assert.ok(_.isObject(params));
      assert.ok(_.isEmpty(params));

      return callback();
    });

    /**
     * Test that verifies all parameters are extracted from the hash.
     */
    it('verify all values', callback => {
      const params = SearchUtil.getSearchParams({
        query: {
          q: 'qVal',
          start: 'startVal',
          limit: 'limitVal',
          sort: 'sortVal',
          rogue: 'rogueVal'
        }
      });

      assert.strictEqual(params.q, 'qVal');
      assert.strictEqual(params.start, 'startVal');
      assert.strictEqual(params.limit, 'limitVal');
      assert.strictEqual(params.sort, 'sortVal');
      assert.strictEqual(params.rogue, undefined);
      return callback();
    });

    /**
     * Test that verifies a hash with no values can be specified without an error.
     */
    it('verify empty query params', callback => {
      const params = SearchUtil.getSearchParams({ query: {} });

      assert.strictEqual(params.q, undefined);
      assert.strictEqual(params.start, undefined);
      assert.strictEqual(params.limit, undefined);
      assert.strictEqual(params.sort, undefined);
      assert.strictEqual(params.rogue, undefined);
      return callback();
    });
  });

  describe('#filterOr', () => {
    /**
     * Test that verifies a single parameter filter object is returned in the filter
     */
    it('verify one param', callback => {
      const filter = SearchUtil.filterOr({ param: 'Arbitrary object should be returned' });
      assert.ok(filter);
      assert.ok(!filter.or);
      assert.strictEqual(filter.param, 'Arbitrary object should be returned');
      return callback();
    });

    /**
     * Test that verifies two filter object are returned in the filter
     */
    it('verify two params', callback => {
      const filter = SearchUtil.filterOr(
        { one: 'Arbitrary object should be returned' },
        { other: 'Arbitrary object should be returned' }
      );
      assert.ok(filter);
      assert.ok(filter.or);
      assert.strictEqual(filter.or[0].one, 'Arbitrary object should be returned');
      assert.strictEqual(filter.or[1].other, 'Arbitrary object should be returned');
      return callback();
    });

    /**
     * Test that verifies parameters that are a mix of unspecified and filter objects returns only the filter
     * objects. Order is not important.
     */
    it('verify mixed null params', callback => {
      const filter = SearchUtil.filterOr(null, { key: 'value' }, undefined, { key: 'value' });
      assert.ok(filter);
      assert.ok(filter.or);
      assert.strictEqual(filter.or.length, 2);
      assert.strictEqual(filter.or[0].key, 'value');
      assert.strictEqual(filter.or[1].key, 'value');
      return callback();
    });

    /**
     * Test that verifies no filter object parameters results in an unspecified value being returned
     */
    it('verify empty params', callback => {
      assert.ok(!SearchUtil.filterOr());
      return callback();
    });
  });

  describe('#filterAnd', () => {
    /**
     * Test that verifies a single parameter filter object is returned in the filter
     */
    it('verify one param', callback => {
      const filter = SearchUtil.filterAnd({ param: 'Arbitrary object should be returned' });
      assert.ok(filter);
      assert.ok(!filter.and);
      assert.strictEqual(filter.param, 'Arbitrary object should be returned');
      return callback();
    });

    /**
     * Test that verifies a single parameter filter object is returned in the filter
     */
    it('verify two params', callback => {
      const filter = SearchUtil.filterAnd(
        { one: 'Arbitrary object should be returned' },
        { other: 'Arbitrary object should be returned' }
      );
      assert.ok(filter);
      assert.ok(filter.and);
      assert.strictEqual(filter.and[0].one, 'Arbitrary object should be returned');
      assert.strictEqual(filter.and[1].other, 'Arbitrary object should be returned');
      return callback();
    });

    /**
     * Test that verifies parameters that are a mix of unspecified and filter objects returns only the filter
     * objects. Order is not important.
     */
    it('verify mixed null params', callback => {
      const filter = SearchUtil.filterAnd(null, { key: 'value' }, undefined, { key: 'value' });
      assert.ok(filter);
      assert.ok(filter.and);
      assert.strictEqual(filter.and.length, 2);
      assert.strictEqual(filter.and[0].key, 'value');
      assert.strictEqual(filter.and[1].key, 'value');
      return callback();
    });

    /**
     * Test that verifies no filter object parameters results in an unspecified value being returned
     */
    it('verify empty params', callback => {
      assert.ok(!SearchUtil.filterAnd());
      return callback();
    });
  });

  describe('#filterNot', () => {
    /**
     * Test that verifies a filter object is returned wrapped in a 'not' filter
     */
    it('verify a not filter', callback => {
      const filter = SearchUtil.filterNot({ key: 'value' });
      assert.ok(filter);
      assert.ok(filter.not);
      assert.strictEqual(filter.not.key, 'value');
      return callback();
    });

    /**
     * Test that verifies an falsey value is returned when specifying a falsey parameter to filterNot
     */
    it('verify falsey not filter', callback => {
      assert.ok(!SearchUtil.filterNot());
      return callback();
    });
  });

  describe('#filterTerms', () => {
    /**
     * Test that verifies a single parameter filter object is returned in the filter
     */
    it('verify one term', callback => {
      const filter = SearchUtil.filterTerms('key', ['value']);
      assert.ok(filter);
      assert.ok(filter.terms);
      assert.strictEqual(filter.terms.key.length, 1);
      assert.strictEqual(filter.terms.key[0], 'value');
      return callback();
    });

    /**
     * Test that verifies filter terms with unspecified terms array returns a falsey result
     */
    it('verify unspecified term values', callback => {
      assert.ok(!SearchUtil.filterTerms('key'));
      return callback();
    });

    /**
     * Test that verifies filter terms with empty terms array returns a falsey result
     */
    it('verify empty term values', callback => {
      assert.ok(!SearchUtil.filterTerms('key', []));
      return callback();
    });

    /**
     * Test that verifies if the value is an object, it is treated as a terms lookup by
     * returning the object as-is in the terms filter
     */
    it('verify object for values returns object verbatim', callback => {
      const filter = SearchUtil.filterTerms('key', {
        index: 'test-index',
        type: 'test-type',
        id: 'test-id',
        path: 'test-path',
        routing: 'test-routing'
      });

      assert.ok(filter);
      assert.ok(filter.terms);
      assert.ok(filter.terms.key);
      assert.strictEqual(filter.terms.key.index, 'test-index');
      assert.strictEqual(filter.terms.key.type, 'test-type');
      assert.strictEqual(filter.terms.key.id, 'test-id');
      assert.strictEqual(filter.terms.key.path, 'test-path');
      assert.strictEqual(filter.terms.key.routing, 'test-routing');
      return callback();
    });
  });

  describe('#filterTerm', () => {
    /**
     * Test that verifies a single parameter filter object is returned in the filter
     */
    it('verify with a term', callback => {
      const filter = SearchUtil.filterTerm('key', 'value');
      assert.ok(filter);
      assert.ok(filter.term);
      assert.strictEqual(filter.term.key, 'value');
      return callback();
    });

    /**
     * Test that verifies filter terms with unspecified terms array returns a falsey result
     */
    it('verify unspecified term value', callback => {
      assert.ok(!SearchUtil.filterTerm('key'));
      return callback();
    });
  });

  describe('#filterResources', () => {
    /**
     * Test that verifies creating a resources filter
     */
    it('verify creating a resource filter', callback => {
      // Ensure unspecified resource types searches all undeleted resources
      const filterUnspecifiedResources = SearchUtil.filterResources();
      assert.strictEqual(filterUnspecifiedResources.and.length, 2);
      assert.strictEqual(filterUnspecifiedResources.and[0].term._type, 'resource');
      assert.strictEqual(filterUnspecifiedResources.and[1].not.exists.field, 'deleted');

      // Ensure empty resource types searches all
      const filterEmptyResources = SearchUtil.filterResources([]);
      assert.strictEqual(filterEmptyResources.and.length, 2);
      assert.strictEqual(filterEmptyResources.and[0].term._type, 'resource');
      assert.strictEqual(filterEmptyResources.and[1].not.exists.field, 'deleted');

      // Sanity check with one resource type
      const filterOneResource = SearchUtil.filterResources(['content']);
      assert.strictEqual(filterOneResource.and.length, 3);
      assert.strictEqual(filterOneResource.and[0].term._type, 'resource');
      assert.strictEqual(filterOneResource.and[1].terms.resourceType[0], 'content');
      assert.strictEqual(filterOneResource.and[2].not.exists.field, 'deleted');

      const filterAllDeletedResources = SearchUtil.filterResources(
        null,
        SearchConstants.deleted.ONLY
      );
      assert.strictEqual(filterAllDeletedResources.and.length, 2);
      assert.strictEqual(filterAllDeletedResources.and[0].term._type, 'resource');
      assert.strictEqual(filterAllDeletedResources.and[1].exists.field, 'deleted');

      const filterAllDeletedAndExistingResources = SearchUtil.filterResources(
        null,
        SearchConstants.deleted.BOTH
      );
      assert.strictEqual(filterAllDeletedAndExistingResources.term._type, 'resource');

      return callback();
    });
  });

  describe('#filterExplicitAccess', () => {
    /**
     * Test that verifies anonymous and global admin user have no explicit access
     */
    it('verify anonymous and global admin user receive no filter for explicit access', callback => {
      SearchUtil.filterExplicitAccess(TestsUtil.createGlobalAdminContext(), (err, filter) => {
        assert.ok(!err);
        assert.ok(!filter);

        SearchUtil.filterExplicitAccess(new Context(global.oaeTests.tenants.cam), (err, filter) => {
          assert.ok(!err);
          assert.ok(!filter);
          return callback();
        });
      });
    });
  });

  describe('#createHasChildQuery', () => {
    /**
     * Test that verifies creating a child query
     */
    it('verify creating a has_child query', callback => {
      // Ensure specifying no query string results in no query object
      assert.ok(!SearchUtil.createHasChildQuery('type', null, 'scoreType'));

      const filter = SearchUtil.createHasChildQuery('type', 'childQuery', 'scoreType');
      assert.ok(filter.has_child);

      assert.strictEqual(filter.has_child.type, 'type');
      assert.strictEqual(filter.has_child.query, 'childQuery');
      assert.strictEqual(filter.has_child.score_type, 'scoreType');
      return callback();
    });
  });

  describe('#createQuery', () => {
    /**
     * Test that verifies creating a query
     */
    it('verify createQuery', callback => {
      // Sanity check creating with an object
      SearchUtil.createQuery({});

      assert.throws(() => {
        SearchUtil.createQuery();
      });
      assert.throws(() => {
        SearchUtil.createQuery(null);
      });
      return callback();
    });
  });

  describe('Others', () => {
    /**
     * Test that verifies valid values, invalid values, emptyvalues, null and undefined for SearchUtil.getQueryParam
     */
    it('verify getQueryParam', callback => {
      assert.strictEqual(SearchUtil.getQueryParam('cats', 'dogs'), 'cats');
      assert.strictEqual(SearchUtil.getQueryParam('cats'), 'cats');
      assert.strictEqual(SearchUtil.getQueryParam('', 'cats'), 'cats');
      assert.strictEqual(SearchUtil.getQueryParam('', ''), SearchConstants.query.ALL);
      assert.strictEqual(SearchUtil.getQueryParam(null, 'cats'), 'cats');
      assert.strictEqual(SearchUtil.getQueryParam(null, null), SearchConstants.query.ALL);
      assert.strictEqual(SearchUtil.getQueryParam(undefined, 'cats'), 'cats');
      assert.strictEqual(SearchUtil.getQueryParam(), SearchConstants.query.ALL);
      return callback();
    });

    /**
     * Test that verifies valid values, invalid values, emptyvalues, null and undefined for SearchUtil.getSortDirParam
     */
    it('verify getSortDirParam', callback => {
      const validType = SearchConstants.sort.direction.ASC;
      const validType2 = SearchConstants.sort.direction.DESC;

      assert.strictEqual(SearchUtil.getSortDirParam(validType, validType2), validType);
      assert.strictEqual(SearchUtil.getSortDirParam(validType), validType);
      assert.strictEqual(SearchUtil.getSortDirParam('not-valid', validType), validType);
      assert.strictEqual(
        SearchUtil.getSortDirParam('not-valid', 'not-valid'),
        SearchConstants.sort.direction.ASC
      );
      assert.strictEqual(SearchUtil.getSortDirParam(validType), validType);
      assert.strictEqual(SearchUtil.getSortDirParam(null, validType), validType);
      assert.strictEqual(
        SearchUtil.getSortDirParam(null, null),
        SearchConstants.sort.direction.ASC
      );
      assert.strictEqual(SearchUtil.getSortDirParam(validType), validType);
      assert.strictEqual(SearchUtil.getSortDirParam(undefined, validType), validType);
      assert.strictEqual(SearchUtil.getSortDirParam(), SearchConstants.sort.direction.ASC);
      return callback();
    });

    /**
     * Test that verifies valid values, invalid values, empty values and default values for
     * SearchUtil.getScopeParam
     */
    it('verify getScopeParam', callback => {
      const tenantAlias = global.oaeTests.tenants.cam.alias;
      assert.strictEqual(SearchUtil.getScopeParam(), SearchConstants.general.SCOPE_ALL);
      assert.strictEqual(SearchUtil.getScopeParam('invalid'), SearchConstants.general.SCOPE_ALL);
      assert.strictEqual(
        SearchUtil.getScopeParam('invalid', 'invalid'),
        SearchConstants.general.SCOPE_ALL
      );
      assert.strictEqual(SearchUtil.getScopeParam('invalid', tenantAlias), tenantAlias);
      assert.strictEqual(SearchUtil.getScopeParam(tenantAlias), tenantAlias);
      assert.strictEqual(
        SearchUtil.getScopeParam(tenantAlias, SearchConstants.general.SCOPE_ALL),
        tenantAlias
      );
      assert.strictEqual(
        SearchUtil.getScopeParam(SearchConstants.general.SCOPE_ALL, tenantAlias),
        SearchConstants.general.SCOPE_ALL
      );
      assert.strictEqual(
        SearchUtil.getScopeParam(SearchConstants.general.SCOPE_NETWORK, tenantAlias),
        SearchConstants.general.SCOPE_NETWORK
      );
      assert.strictEqual(
        SearchUtil.getScopeParam(SearchConstants.general.SCOPE_MY, tenantAlias),
        SearchConstants.general.SCOPE_MY
      );
      return callback();
    });
  });
});
