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

/* eslint-disable unicorn/filename-case */
import { compose, pick, mapObjIndexed } from 'ramda';
import lunr from 'lunr';
import { Validator as validator } from 'oae-util/lib/validator';

const { isArray } = validator;

/**
 * Represents an index where tenants can be indexed and then later full-text searched
 *
 * @param  {Tenant[]}   tenants     The tenants that should be indexed
 */
const TenantIndex = function(tenants) {
  const lunrIndex = _createIndex(tenants);
  return {
    /**
     * Search for a tenant based on a user-input query
     *
     * @param  {String}     q               The query to use to search
     * @return {Object[]}   docs            The search documents
     * @return {String}     docs[i].ref     The "id" of the document (i.e., the tenant alias)
     * @return {Number}     docs[i].score   The search match score, on which the results will be sorted from highest to lowest
     */
    search(q) {
      return lunrIndex.search(q);
    },

    /**
     * Add / update the given tenants in the search index
     * Since lunr v2.0 indexes are immutable so updating just means creating it again
     *
     * @param  {Tenant|Tenant[]}    tenants     The tenants to add or update in the index
     */
    update(tenants) {
      tenants = isArray(tenants) ? tenants : [tenants];
      _createIndex(tenants);
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
const _createIndex = function(tenants) {
  // Create an index that ids its documents by an "alias" field, so we can uniquely update
  // tenants by alias
  const lunrIndex = lunr(function() {
    this.ref('alias');
    this.field('alias');
    this.field('host');
    this.field('displayName');

    const that = this;
    mapObjIndexed(
      compose(eachDoc => that.add(eachDoc), _tenantToDocument),
      tenants
    );
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
const _tenantToDocument = tenant => pick(['alias', 'host', 'displayName'], tenant);

export default TenantIndex;
