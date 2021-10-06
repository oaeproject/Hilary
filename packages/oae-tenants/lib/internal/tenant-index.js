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

import { split, gt, length, ifElse, __, compose, pick, forEachObjIndexed } from 'ramda';
import lunr from 'lunr';

const greaterThanOne = gt(__, 1);
const isTwoOrMoreWords = (words) => compose(greaterThanOne, length)(words);

/**
 * Represents an index where tenants can be indexed and then later full-text searched
 *
 * @param  {Tenant[]}   tenants     The tenants that should be indexed
 */
const TenantIndex = function (tenants) {
  // need to keep track of all indexed tenants to regenerate index whenever we want
  const lunrIndex = _createIndex(tenants);

  return {
    /**
     * Search for a tenant based on a user-input query
     *
     * @param  {String}     query               The query to use to search
     * @return {Object[]}   docs            The search documents
     * @return {String}     docs[i].ref     The "id" of the document (i.e., the tenant alias)
     * @return {Number}     docs[i].score   The search match score, on which the results will be sorted from highest to lowest
     */
    search(query) {
      /**
       * Back with lunr 1.0 we could just search for an entire word like `tenant-ABC`
       * Now with lunr 2.x the `-` (minus) symbol means exclude, and `tenant-ABC` is broken down into
       * `tenant` and EXCLUDES the rest (`-ABC`)
       * As a result, when a word includes a `-` (minus) symbol we need to make it two words instead, plus:
       * make the second word mandatory (in the previous example, that would be `ABC`, thus `+ABC`)
       * When there is just one word, we need to make it a partial match (in the previous example, that would be `tenant`, thus `tenant*`)
       *
       * Weird, right? I know. But it seems to work fine and passes all the existing tests.
       */
      const useAndWithBoth = ifElse(
        isTwoOrMoreWords,
        (word) => word.join(' +'),
        (word) => `${word}*`
      );

      const enhancedQuery = compose(useAndWithBoth, split('-'))(query);
      return lunrIndex.search(enhancedQuery);
    }
  };
};

/**
 * Create the index with the given tenants stored in it
 *
 * @param  {Tenants[]}  tenants     The tenants to add
 * @return {lunr.Index}             The lunr index loaded with the tenants
 * @api private
 */
const _createIndex = function (tenants) {
  /**
   * Create an index that ids its documents by an "alias" field,
   * so we can uniquely update tenants by alias
   */
  const lunrIndex = lunr(function () {
    this.ref('alias');
    this.field('alias');
    this.field('host');
    this.field('displayName');

    /**
     * We need to make sure we replace the '-' before we index
     * as the minus symbol means exclude when searching
     * See https://lunrjs.com/guides/searching.html#term-presence for details
     */

    forEachObjIndexed((eachDoc) => {
      eachDoc = _tenantToDocument(eachDoc);
      this.add(eachDoc);
    }, tenants);
  });
  return lunrIndex;
};

/**
 * Convert a tenant to the lunr tenant document model
 *
 * @param  {Tenant}     tenant  The tenant to convert to a document
 * @return {Object}             The lunr document that represents the tenant
 * @api private
 */
const _tenantToDocument = (tenant) => pick(['alias', 'host', 'displayName'], tenant);

export default TenantIndex;
