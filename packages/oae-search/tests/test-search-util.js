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

import { assert } from 'chai';

import { Context } from 'oae-context';
import { SearchConstants } from 'oae-search/lib/constants';

import * as TestsUtil from 'oae-tests/lib/util';
import * as SearchUtil from 'oae-search/lib/util';

const { createGlobalAdminContext } = TestsUtil;

const {
  filterExplicitAccess,
  filterResources,
  getSearchParams,
  filterTerm,
  filterTerms,
  filterNot,
  filterOr,
  filterAnd,
  createHasChildQuery,
  getQueryParam,
  getScopeParam,
  getSortDirParam,
  createQuery
} = SearchUtil;

import { compose, prop, last, path, head, nth, of } from 'ramda';

const TYPE = 'type';
const SCORE_TYPE = 'scoreType';
const CHILD_QUERY = 'childQuery';
const RESOURCE = 'resource';
const CONTENT = 'content';
const DELETED = 'deleted';
const VALUE = 'value';
const KEY = 'key';
const NOT_VALID = 'not-valid';
const INVALID = 'invalid';
const CATS = 'cats';
const DOGS = 'dogs';

const mustConditions = path(['bool', 'must']);
const mustNotConditions = path(['bool', 'must_not']);
const shouldConditions = path(['bool', 'should']);

const getKey = path(['terms', KEY]);
const termType = path(['term', 'type']);
const existsField = path(['exists', 'field']);
const termsResourceType = path(['terms', 'resourceType']);

describe('Search Util', () => {
  describe('#getSearchParams', () => {
    /**
     * Test that verifies falsey and empty values to getSearchParams
     */
    it('verify unspecified query params', callback => {
      let params = getSearchParams();
      assert.isObject(params);
      assert.isEmpty(params);

      params = getSearchParams(null);
      assert.isObject(params);
      assert.isEmpty(params);

      params = getSearchParams({});
      assert.isObject(params);
      assert.isEmpty(params);

      return callback();
    });

    /**
     * Test that verifies all parameters are extracted from the hash.
     */
    it('verify all values', callback => {
      const params = getSearchParams({
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
      const params = getSearchParams({ query: {} });

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
      const filter = filterOr({ param: 'Arbitrary object should be returned' });

      assert.exists(filter);
      assert.notExists(shouldConditions(filter));
      assert.strictEqual(filter.param, 'Arbitrary object should be returned');

      return callback();
    });

    /**
     * Test that verifies two filter object are returned in the filter
     */
    it('verify two params', callback => {
      const filter = filterOr(
        { one: 'Arbitrary object should be returned' },
        { other: 'Arbitrary object should be returned' }
      );

      assert.exists(filter);
      assert.ok(shouldConditions(filter));
      assert.strictEqual(head(shouldConditions(filter)).one, 'Arbitrary object should be returned');
      assert.strictEqual(last(shouldConditions(filter)).other, 'Arbitrary object should be returned');

      return callback();
    });

    /**
     * Test that verifies parameters that are a mix of unspecified and filter objects returns only the filter
     * objects. Order is not important.
     */
    it('verify mixed null params', callback => {
      const filter = filterOr(null, { key: VALUE }, undefined, { key: VALUE });

      assert.exists(filter);
      assert.exists(shouldConditions(filter));
      assert.lengthOf(shouldConditions(filter), 2);
      assert.strictEqual(head(shouldConditions(filter)).key, VALUE);
      assert.strictEqual(last(shouldConditions(filter)).key, VALUE);

      return callback();
    });

    /**
     * Test that verifies no filter object parameters results in an unspecified value being returned
     */
    it('verify empty params', callback => {
      assert.notExists(filterOr());

      return callback();
    });
  });

  describe('#filterAnd', () => {
    /**
     * Test that verifies a single parameter filter object is returned in the filter
     */
    it('verify one param', callback => {
      const filter = filterAnd({ param: 'Arbitrary object should be returned' });

      assert.exists(filter);
      assert.notExists(mustConditions(filter));
      assert.strictEqual(filter.param, 'Arbitrary object should be returned');

      return callback();
    });

    /**
     * Test that verifies a single parameter filter object is returned in the filter
     */
    it('verify two params', callback => {
      const filter = filterAnd(
        { one: 'Arbitrary object should be returned' },
        { other: 'Arbitrary object should be returned' }
      );

      assert.exists(filter);
      assert.exists(mustConditions(filter));
      assert.strictEqual(head(mustConditions(filter)).one, 'Arbitrary object should be returned');
      assert.strictEqual(last(mustConditions(filter)).other, 'Arbitrary object should be returned');

      return callback();
    });

    /**
     * Test that verifies parameters that are a mix of unspecified and filter objects returns only the filter
     * objects. Order is not important.
     */
    it('verify mixed null params', callback => {
      const filter = filterAnd(null, { key: VALUE }, undefined, { key: VALUE });

      assert.ok(filter);
      assert.ok(mustConditions(filter));
      assert.lengthOf(mustConditions(filter), 2);
      assert.strictEqual(head(mustConditions(filter)).key, VALUE);
      assert.strictEqual(last(mustConditions(filter)).key, VALUE);

      return callback();
    });

    /**
     * Test that verifies no filter object parameters results in an unspecified value being returned
     */
    it('verify empty params', callback => {
      assert.notExists(filterAnd());

      return callback();
    });
  });

  describe('#filterNot', () => {
    /**
     * Test that verifies a filter object is returned wrapped in a 'not' filter
     */
    it('verify a not filter', callback => {
      const filter = filterNot({ key: VALUE });
      const mustNot = prop('must_not', filter);

      assert.exists(filter);
      assert.exists(mustNot);
      assert.strictEqual(mustNot.key, VALUE);

      return callback();
    });

    /**
     * Test that verifies an falsey value is returned when specifying a falsey parameter to filterNot
     */
    it('verify falsey not filter', callback => {
      assert.notExists(filterNot());

      return callback();
    });
  });

  describe('#filterTerms', () => {
    /**
     * Test that verifies a single parameter filter object is returned in the filter
     */
    it('verify one term', callback => {
      const filter = filterTerms(KEY, [VALUE]);

      assert.ok(filter);
      assert.ok(filter.terms);
      assert.lengthOf(getKey(filter), 1);
      assert.strictEqual(head(getKey(filter)), VALUE);

      return callback();
    });

    /**
     * Test that verifies filter terms with unspecified terms array returns a falsey result
     */
    it('verify unspecified term values', callback => {
      const filter = filterTerms(KEY);

      assert.isNotOk(getKey(filter));

      return callback();
    });

    /**
     * Test that verifies filter terms with empty terms array returns a falsey result
     */
    it('verify empty term values', callback => {
      assert.isNotOk(filterTerms(KEY, []));

      return callback();
    });

    /**
     * Test that verifies if the value is an object, it is treated as a terms lookup by
     * returning the object as-is in the terms filter
     */
    it('verify object for values returns object verbatim', callback => {
      const filter = filterTerms(KEY, {
        index: 'test-index',
        type: 'test-type',
        id: 'test-id',
        path: 'test-path',
        routing: 'test-routing'
      });

      const filterTermsKey = path(['terms', 'key'], filter);
      const getIndex = prop('index', filterTermsKey);
      const getType = prop('type', filterTermsKey);
      const getId = prop('id', filterTermsKey);
      const getPath = prop('path', filterTermsKey);
      const getRouting = prop('routing', filterTermsKey);

      assert.exists(filter);
      assert.exists(filter.terms);
      assert.exists(filter.terms.key);
      assert.strictEqual(getIndex, 'test-index');
      assert.strictEqual(getType, 'test-type');
      assert.strictEqual(getId, 'test-id');
      assert.strictEqual(getPath, 'test-path');
      assert.strictEqual(getRouting, 'test-routing');

      return callback();
    });
  });

  describe('#filterTerm', () => {
    /**
     * Test that verifies a single parameter filter object is returned in the filter
     */
    it('verify with a term', callback => {
      const filter = filterTerm(KEY, VALUE);

      assert.exists(filter);
      assert.exists(filter.term);
      assert.strictEqual(filter.term.key, VALUE);

      return callback();
    });

    /**
     * Test that verifies filter terms with unspecified terms array returns a falsey result
     */
    it('verify unspecified term value', callback => {
      assert.isNotOk(filterTerm(KEY));

      return callback();
    });
  });

  const getTermTypeOnMustConditions = compose(termType, head, mustConditions);
  const getExistsFieldOnMustNotConditions = compose(existsField, head, mustNotConditions);
  describe('#filterResources', () => {
    /**
     * Test that verifies creating a resources filter
     */
    it('verify creating a resource filter', callback => {
      // Ensure unspecified resource types searches all undeleted resources
      const filterUnspecifiedResources = filterResources();
      assert.lengthOf(mustConditions(filterUnspecifiedResources), 2);
      assert.lengthOf(mustNotConditions(filterUnspecifiedResources), 1);

      assert.strictEqual(RESOURCE, getTermTypeOnMustConditions(filterUnspecifiedResources));
      assert.strictEqual(DELETED, getExistsFieldOnMustNotConditions(filterUnspecifiedResources));

      // Ensure empty resource types searches all
      const filterEmptyResources = filterResources([]);
      assert.lengthOf(mustConditions(filterEmptyResources), 1);
      assert.lengthOf(mustNotConditions(filterEmptyResources), 1);

      assert.strictEqual(RESOURCE, getTermTypeOnMustConditions(filterEmptyResources));
      assert.strictEqual(DELETED, getExistsFieldOnMustNotConditions(filterEmptyResources));

      // Sanity check with one resource type
      const filterOneResource = filterResources(of(CONTENT));
      assert.lengthOf(mustConditions(filterOneResource), 2);
      assert.lengthOf(mustNotConditions(filterOneResource), 1);

      assert.strictEqual(RESOURCE, getTermTypeOnMustConditions(filterOneResource));
      assert.strictEqual(CONTENT, compose(head, termsResourceType, nth(1), mustConditions)(filterOneResource));
      assert.strictEqual(DELETED, getExistsFieldOnMustNotConditions(filterOneResource));

      const filterAllDeletedResources = filterResources(null, SearchConstants.deleted);
      assert.lengthOf(mustConditions(filterAllDeletedResources), 2);
      assert.lengthOf(mustNotConditions(filterAllDeletedResources), 1);

      assert.isNotOk(compose(termsResourceType, nth(1), mustConditions)(filterAllDeletedResources));
      assert.strictEqual(RESOURCE, getTermTypeOnMustConditions(filterAllDeletedResources));
      assert.strictEqual(DELETED, getExistsFieldOnMustNotConditions(filterAllDeletedResources));

      const filterAllDeletedAndExistingResources = filterResources(null, SearchConstants.deleted.BOTH);
      assert.lengthOf(mustConditions(filterAllDeletedAndExistingResources), 2);
      assert.strictEqual(RESOURCE, getTermTypeOnMustConditions(filterAllDeletedAndExistingResources));

      return callback();
    });
  });

  describe('#filterExplicitAccess', () => {
    const index = 'oaeTest';

    /**
     * Test that verifies anonymous and global admin user have no explicit access
     */
    it('verify anonymous and global admin user receive no filter for explicit access', callback => {
      filterExplicitAccess(createGlobalAdminContext(), index, (err, filter) => {
        assert.isNotOk(err);
        assert.isNotOk(filter);

        filterExplicitAccess(new Context(global.oaeTests.tenants.cam), index, (err, filter) => {
          assert.isNotOk(err);
          assert.isNotOk(filter);

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
      assert.isNotOk(createHasChildQuery(TYPE, null, SCORE_TYPE));

      const filter = createHasChildQuery(TYPE, CHILD_QUERY, SCORE_TYPE);
      assert.ok(filter.has_child);

      assert.strictEqual(filter.has_child.type, TYPE);
      assert.strictEqual(filter.has_child.query, CHILD_QUERY);
      assert.strictEqual(filter.has_child.score_mode, SCORE_TYPE);

      return callback();
    });
  });

  describe('#createQuery', () => {
    /**
     * Test that verifies creating a query
     */
    it('verify createQuery', callback => {
      // Sanity check creating with an object
      createQuery({});

      assert.throws(() => {
        createQuery();
      });
      assert.throws(() => {
        createQuery(null);
      });

      return callback();
    });
  });

  describe('Others', () => {
    /**
     * Test that verifies valid values, invalid values, emptyvalues, null and undefined
     * for SearchUtil.getQueryParam
     */
    it('verify getQueryParam', callback => {
      assert.strictEqual(getQueryParam(CATS, DOGS), CATS);
      assert.strictEqual(getQueryParam(CATS), CATS);
      assert.strictEqual(getQueryParam('', CATS), CATS);
      assert.strictEqual(getQueryParam('', ''), SearchConstants.query.ALL);
      assert.strictEqual(getQueryParam(null, CATS), CATS);
      assert.strictEqual(getQueryParam(null, null), SearchConstants.query.ALL);
      assert.strictEqual(getQueryParam(undefined, CATS), CATS);
      assert.strictEqual(getQueryParam(), SearchConstants.query.ALL);

      return callback();
    });

    /**
     * Test that verifies valid values, invalid values, emptyvalues, null and undefined
     * for SearchUtil.getSortDirParam
     */
    it('verify getSortDirParam', callback => {
      const oneValidType = SearchConstants.sort.direction.ASC;
      const anotherValidType = SearchConstants.sort.direction.DESC;

      assert.strictEqual(getSortDirParam(oneValidType, anotherValidType), oneValidType);
      assert.strictEqual(getSortDirParam(oneValidType), oneValidType);
      assert.strictEqual(getSortDirParam(NOT_VALID, oneValidType), oneValidType);
      assert.strictEqual(getSortDirParam(NOT_VALID, NOT_VALID), SearchConstants.sort.direction.ASC);
      assert.strictEqual(getSortDirParam(oneValidType), oneValidType);
      assert.strictEqual(getSortDirParam(null, oneValidType), oneValidType);
      assert.strictEqual(getSortDirParam(null, null), SearchConstants.sort.direction.ASC);
      assert.strictEqual(getSortDirParam(oneValidType), oneValidType);
      assert.strictEqual(getSortDirParam(undefined, oneValidType), oneValidType);
      assert.strictEqual(getSortDirParam(), SearchConstants.sort.direction.ASC);

      return callback();
    });

    /**
     * Test that verifies valid values, invalid values, empty values and default values for
     * SearchUtil.getScopeParam
     */
    it('verify getScopeParam', callback => {
      const tenantAlias = global.oaeTests.tenants.cam.alias;
      assert.strictEqual(getScopeParam(), SearchConstants.general.SCOPE_ALL);
      assert.strictEqual(getScopeParam(INVALID), SearchConstants.general.SCOPE_ALL);
      assert.strictEqual(getScopeParam(INVALID, INVALID), SearchConstants.general.SCOPE_ALL);
      assert.strictEqual(getScopeParam(INVALID, tenantAlias), tenantAlias);
      assert.strictEqual(getScopeParam(tenantAlias), tenantAlias);
      assert.strictEqual(getScopeParam(tenantAlias, SearchConstants.general.SCOPE_ALL), tenantAlias);
      assert.strictEqual(
        getScopeParam(SearchConstants.general.SCOPE_ALL, tenantAlias),
        SearchConstants.general.SCOPE_ALL
      );
      assert.strictEqual(
        getScopeParam(SearchConstants.general.SCOPE_NETWORK, tenantAlias),
        SearchConstants.general.SCOPE_NETWORK
      );
      assert.strictEqual(
        getScopeParam(SearchConstants.general.SCOPE_MY, tenantAlias),
        SearchConstants.general.SCOPE_MY
      );

      return callback();
    });
  });
});
