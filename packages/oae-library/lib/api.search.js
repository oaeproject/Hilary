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

import { is, contains } from 'ramda';
import { AuthzConstants } from 'oae-authz/lib/constants.js';
import { ContentConstants } from 'oae-content/lib/constants.js';
import { DiscussionsConstants } from 'oae-discussions/lib/constants.js';
import { SearchConstants } from 'oae-search/lib/constants.js';
import { Validator as validator } from 'oae-util/lib/validator.js';

import * as PrincipalsDAO from 'oae-principals/lib/internal/dao.js';
import * as SearchAPI from 'oae-search';
import * as SearchUtil from 'oae-search/lib/util.js';
import * as OaeUtil from 'oae-util/lib/util.js';
import * as LibraryAPI from 'oae-library';

const { isResourceId, unless } = validator;

/**
 * Register a search that searches through a user or group library.
 *
 * @param  {String}     searchName                                          The name under which this search will be available
 * @param  {String[]}   resourceTypes                                       The types of resources this search should return. e.g., discussion or content
 * @param  {Object}     [options]                                           Additional options that describe how this library search should function
 * @param  {Function}   [options.getLibraryOwner]                           A function that allows the library search mechanism to retrieve the owner of the library. Defaults to PrincipalsDAO.getPrincipal
 * @param  {String}     [options.getLibraryOwner.libraryId]                 The id of the library that is being searched
 * @param  {Function}   [options.getLibraryOwner.callback]                  Standard callback function to return the library owner
 * @param  {Object}     [options.getLibraryOwner.callback.err]              An error that occured whilst retrieve the library owner, if any
 * @param  {Object}     [options.getLibraryOwner.callback.libraryOwner]     The owner of the library. This object should have an `id`, `visibility` and optionally an `indexedId` key. In case the `indexedId` is null, the `id` will be used to search for direct members in the search index. Examples of valid objects are plain `User` or `Group`objects
 * @param  {Object}     [options.association]                               The description of the search association document to use for filtering library entities. By default it will choose the "has member" association which covers things like a user's "content library" but not a content item's "members library" as that is the opposite
 * @param  {String}     [options.association.name]                          The name of the resource document type that holds the library association. Default: "resource_members"
 * @param  {String}     [options.association.field]                         The name of the document field that holds the library association. Default: "direct_members"
 * @param  {Object}     [options.searches]                                  Contains functions that can return a search filter per library visibility
 * @param  {Function}   [options.searches.public]                           The function to use to derive the filter for the public library bucket
 * @param  {Context}    [options.searches.public.ctx]                       The context of the current request
 * @param  {User|Group} [options.searches.public.libraryOwner]              An object that represents the owner of this library (e.g., User if it's a user library, etc...)
 * @param  {Object}     [options.searches.public.opts]                      The search options (i.e., the request query string and path variables)
 * @param  {Function}   [options.searches.public.callback]                  Standard callback for the custom search
 * @param  {Object}     [options.searches.public.callback.err]              An error that occurred while creating the filter, if any
 * @param  {Object}     [options.searches.public.callback.filter]           The filter to use for the query, as constructed using the `SearchUtil.filter*` methods
 * @param  {Function}   [options.searches.loggedin]                         The function to use to derive the filter for the loggedin library bucket. See `options.searches.public` parameter for function parameters
 * @param  {Function}   [options.searches.private]                          The function to use to derive the filter for the private library bucket. See `options.searches.public` parameter for function parameters
 */
export const registerLibrarySearch = function (searchName, resourceTypes, options) {
  options = options || {};
  options.searches = options.searches || {};
  options.getLibraryOwner = options.getLibraryOwner || PrincipalsDAO.getPrincipal;

  SearchAPI.registerSearch(searchName, (ctx, options_, callback) => {
    // Sanitize the custom search options
    options_ = options_ || {};
    options_.libraryOwnerId = options_.pathParams[0];
    options_.limit = OaeUtil.getNumberParam(options_.limit, 12, 1, 25);

    try {
      unless(isResourceId, {
        code: 400,
        msg: 'Must specificy an id of a library to search'
      })(options_.libraryOwnerId);
    } catch (error) {
      return callback(error);
    }

    options.getLibraryOwner(options_.libraryOwnerId, (error, libraryOwner) => {
      if (error) {
        return callback(error);
      }

      if (libraryOwner.deleted) {
        return callback({ code: 404, msg: 'The library was not found' });
      }

      options_.libraryIndexedId = libraryOwner.indexedId || options_.libraryOwnerId;

      LibraryAPI.Authz.resolveTargetLibraryAccess(
        ctx,
        options_.libraryIndexedId,
        libraryOwner,
        (error, canAccess, visibility) => {
          if (error) {
            return callback(error);
          }

          if (!canAccess) {
            return callback({
              code: 401,
              msg: 'You are not authorized to access this library search feed'
            });
          }

          const query = {
            bool: {
              should: [
                // Search on basic metadata properties such as display name or description
                SearchUtil.createQueryStringQuery(options_.q)
              ],
              // eslint-disable-next-line camelcase
              minimum_should_match: 1
            }
          };

          // If we're searching for content items we also try to match on content comments and bodies
          if (contains('content', resourceTypes)) {
            query.bool.should.push(
              /**
               * The query we're creating needs to use the `discussion_message_body` field
               * as that is how we're exporting the schema for discussions. See file:
               * `oae-messagebox/lib/search/schema/resourceMessagesSchema`
               */
              SearchUtil.createHasChildQuery(
                ContentConstants.search.MAPPING_CONTENT_COMMENT,
                SearchUtil.createQueryStringQuery(options_.q, ['discussion_message_body']),
                'max'
              ),

              SearchUtil.createHasChildQuery(
                ContentConstants.search.MAPPING_CONTENT_BODY,
                SearchUtil.createQueryStringQuery(options_.q, ['content_body']),
                'max',
                2
              )
            );

            // If we're searching for discussions we also try to match discussion messages
          } else if (contains('discussion', resourceTypes)) {
            query.bool.should.push(
              SearchUtil.createHasChildQuery(
                DiscussionsConstants.search.MAPPING_DISCUSSION_MESSAGE,
                SearchUtil.createQueryStringQuery(options_.q, ['discussion_message_body']),
                'max'
              )
            );
          }

          const filterFunction = is(Function, options.searches[visibility])
            ? options.searches[visibility]
            : _defaultLibraryFilter(resourceTypes, visibility, options.association);
          filterFunction(ctx, libraryOwner, options_, (error, filter) => {
            if (error) {
              return callback(error);
            }

            return callback(null, SearchUtil.createQuery(query, filter, options_));
          });
        }
      );
    });
  });
};

/**
 * Provides a sane default privacy filter for searching libraries.
 * This logic mimicks the library visibility logic such that if a library is requested,
 * only the appropriate items in the visibility bucket are returned
 *
 * @param  {String[]}   resourceTypes           The types of resources to filter by
 * @param  {String}     visibility              The target library visibility to filter as per AuthzConstants#visibility
 * @param  {Object}     [association]           The description of the search association document to use for filtering library entities
 * @param  {String}     [association.name]      The name of the resource document type that holds the library association (e.g., resource_members)
 * @param  {String}     [association.field]     The name of the document field that holds the library association (e.g., direct_members)
 * @return {Function}                           The function that can provide a default search filter, as per the `options.searches.<visibility>` search parameter specifications in Library.Search#registerLibrarySearch
 */
const _defaultLibraryFilter = function (resourceTypes, visibility, association) {
  association = association || {
    name: AuthzConstants.search.MAPPING_RESOURCE_MEMBERS,
    field: 'direct_members'
  };

  return function (ctx, libraryOwner, options, callback) {
    // Only look for resources that are in the user's library
    const baseFilter = SearchUtil.filterAnd(
      SearchUtil.filterTerm('type', SearchConstants.search.MAPPING_RESOURCE),
      SearchUtil.filterTerms('resourceType', resourceTypes),
      SearchUtil.createHasChildQuery(
        association.name,
        SearchUtil.filterTerms(association.field, [options.libraryIndexedId])
      )
    );

    let filter = null;
    if (visibility === AuthzConstants.visibility.PRIVATE) {
      filter = baseFilter;
    } else if (visibility === AuthzConstants.visibility.LOGGEDIN) {
      filter = SearchUtil.filterAnd(
        baseFilter,
        SearchUtil.filterOr(
          SearchUtil.filterTerm('visibility', AuthzConstants.visibility.PUBLIC),
          SearchUtil.filterAnd(
            SearchUtil.filterTerm('tenantAlias', libraryOwner.tenant.alias),
            SearchUtil.filterTerm('visibility', AuthzConstants.visibility.LOGGEDIN)
          )
        )
      );
    } else {
      filter = SearchUtil.filterAnd(baseFilter, SearchUtil.filterTerm('visibility', AuthzConstants.visibility.PUBLIC));
    }

    return callback(null, filter);
  };
};
