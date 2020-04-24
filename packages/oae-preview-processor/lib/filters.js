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

import { toArray } from 'oae-util/lib/util';
import {
  equals,
  not,
  both,
  compose,
  isEmpty,
  path,
  forEach,
  filter,
  contains,
  gt,
  lt,
  head,
  forEachObjIndexed,
  curry,
  __,
  map,
  ifElse,
  pipe
} from 'ramda';

// Auxiliary functions
const isDefined = Boolean;
const isNotDefined = compose(not, isDefined);
const greaterThanZero = curry(gt)(__, 0);
const returnItself = x => x;
const contentIsNotDefined = filters => compose(not, isDefined, path(['content']))(filters);
const revisionIsNotDefined = filters => compose(not, isDefined, path(['revision']))(filters);
const statusIsDefined = previews => path(['status'], previews);

const RESOURCE_SUBTYPE = 'resourceSubType';
const resourceSubType = {
  key: RESOURCE_SUBTYPE,
  columnName: RESOURCE_SUBTYPE
};
const previewStatusFilter = {
  key: 'previewsStatus',
  columnName: 'previews'
};
const contentIdFilter = {
  key: 'contentId'
};
const createdByFilter = {
  key: 'createdBy'
};
const createdAfterFilter = {
  key: 'createdAfter'
};
const createdBeforeFilter = {
  key: 'createdBefore'
};
const tenantFilter = {
  key: 'tenant',
  columnName: 'tenantAlias'
};

/**
 * Allows for validation and applying of filters when triggering a "reprocessing" previews task
 *
 * @param  {Object}         filters                             The object containing all the content and revision filters
 * @param  {Object}         filters.content                     The object containing the content filters
 * @param  {String[]}       [filters.content.createdBy]         Filter content based on who it was created by
 * @param  {String[]}       [filters.content.previewsStatus]    Filter content based on the status of the previews processing
 * @param  {String[]}       [filters.content.resourceSubType]   Filter content based on its resourceSubType
 * @param  {String[]}       [filters.content.tenant]            Filter content based on the tenant where it was created
 * @param  {String[]}       [filters.revision.mime]             Filter based on the mime type of a file. Only useful in combination with `content_resourceSubType: file`
 * @param  {Number}         [filters.revision.createdAfter]     Filter those revisions who were created after a certain timestamp. The value of the timestamp should be specified in ms since epoch
 * @param  {Number}         [filters.revision.createdBefore]    Filter those revisions who were created before a certain timestamp. The value of the timestamp should be specified in ms since epoch
 * @param  {String[]}       [filters.revision.createdBy]        Filter the revisions based on who it was created by
 * @param  {String[]}       [filters.revision.previewsStatus]   Filter the revisions based on their previews status
 * @return {Object}                                             Returns an object that contains the necessary methods to do validation and filtering
 */
const FilterGenerator = function(filters) {
  const errors = [];
  let needsRevisions = false;
  const contentCheckers = [];
  const revisionCheckers = [];
  const columnNames = ['contentId', 'latestRevisionId', 'previews'];

  // Loop over the filters and check if there are errors
  if (isEmpty(filters) || both(contentIsNotDefined, revisionIsNotDefined)(filters)) {
    errors.push({ code: 400, msg: 'Missing or invalid filters object' });
  }

  const contentFilters = filters.content;
  const revisionFilters = filters.revision;

  /**
   * Loop over all the filters and check their validity
   * At the same we construct all the functions that are
   * required to do in-app filtering
   */
  forEachObjIndexed((filterValue, filterKey) => {
    const filterContains = curry(contains)(__, toArray(filterValue));
    if (equals(filterKey, resourceSubType.key)) {
      // We'll need the resourceSubType column if we want to run this filter
      columnNames.push(resourceSubType.columnName);

      // Construct the filter function
      contentCheckers.push(content => filterContains(content.resourceSubType));
    } else if (equals(filterKey, previewStatusFilter.key)) {
      // We'll need the previews column if we want to run this filter
      columnNames.push(previewStatusFilter.columnName);

      // Construct the filter function
      contentCheckers.push(content => {
        if (both(isDefined, statusIsDefined)(content.previews)) {
          return filterContains(content.previews.status);
        }

        // If the previews object is missing, something is seriously wrong and we should reprocess it
        return true;
      });
    } else if (equals(filterKey, createdByFilter.key)) {
      contentCheckers.push(content => filterContains(content.createdBy));
    } else if (equals(filterKey, tenantFilter.key)) {
      columnNames.push(tenantFilter.columnName);
      contentCheckers.push(content => filterContains(content.tenantAlias));
    } else if (equals(filterKey, contentIdFilter.key)) {
      contentCheckers.push(content => equals(content.contentId, filterValue));
    } else {
      errors.push({ code: 400, msg: 'Unknown content filter' });
    }
  }, contentFilters);

  // Revisions
  forEachObjIndexed((filterValue, filterKey) => {
    const filterContains = curry(contains)(__, toArray(filterValue));
    if (equals(filterKey, 'mime')) {
      needsRevisions = true;
      revisionCheckers.push(revision => {
        if (isNotDefined(revision.mime)) return false;

        // Check if the mime type is in the desired set of mimetypes
        return filterContains(revision.mime);
      });
    } else if (equals(filterKey, previewStatusFilter.key)) {
      needsRevisions = true;
      revisionCheckers.push(revision => {
        if (both(isDefined, statusIsDefined)(revision.previews)) {
          return filterContains(revision.previews.status);
        }

        // If the previews object is missing, something is seriously wrong and we should reprocess it
        return true;
      });
    } else if (equals(filterKey, createdByFilter.key)) {
      needsRevisions = true;
      revisionCheckers.push(revision => filterContains(revision.createdBy));
    } else if (equals(filterKey, createdAfterFilter.key)) {
      needsRevisions = true;
      const createdAfter = curry(gt)(__, Number.parseInt(filterValue, 10));
      revisionCheckers.push(revision => createdAfter(revision.created));
    } else if (equals(filterKey, createdBeforeFilter.key)) {
      needsRevisions = true;
      const createdBefore = curry(lt)(__, Number.parseInt(filterValue, 10));
      revisionCheckers.push(revision => createdBefore(revision.created));
    } else {
      errors.push({ code: 400, msg: 'Unknown revision filter' });
    }
  }, revisionFilters);

  const that = {};

  /**
   * Whether or not the passed in filters contain errors
   *
   * @return {Boolean}    `true` if the filters contain errors
   */
  that.hasErrors = () => compose(not, isEmpty)(errors);

  /**
   * Get the first error in the list of errors
   *
   * @return {Object}     Standard error object containing a `code` and `msg`.
   */
  that.getFirstError = () => head(errors);

  /**
   * Get all the errors
   *
   * @return {Object[]}   An array of standard error objects
   */
  that.getErrors = () => errors;

  /**
   * Whether or not revisions need to be retrieved to do proper filtering
   *
   * @return {Boolean}    `true` if the revisions should be retrieved
   */
  that.needsRevisions = () => needsRevisions;

  /**
   * Returns the names of the columns that should be retrieved when iterating over
   * the Content rows
   *
   * @return {String[]}   The names of the columns that should be retrieved
   */
  that.getContentColumnNames = () => columnNames;

  /**
   * Filter an array of content items
   *
   * @param  {Content[]}  content     The array of content items to filter
   * @return {Content[]}              The filtered array of content items
   */
  that.filterContent = content => {
    const allFilters = map(each => filter(each), contentCheckers);

    return ifElse(
      () => isEmpty(allFilters),
      returnItself,
      content => pipe(...allFilters)(content)
    )(content);
  };

  /**
   * Filter the revisions on a content items.
   * If there are no revisions left for a content item, it will be removed from the array
   *
   * @param  {Content[]}  content     An array of content items for which to filter the revisions. It's assumed that the revisions are available at `content[i].revisions`
   * @return {Content[]}              A filtered array of content items
   */
  that.filterRevisions = content => {
    let allFilters = [];
    forEach(eachContentItem => {
      allFilters = [];
      forEach(eachRevisionChecker => {
        allFilters.push(filter(eachRevisionChecker));
      }, revisionCheckers);

      eachContentItem.revisions = ifElse(
        () => isEmpty(allFilters),
        returnItself,
        revisions => pipe(...allFilters)(revisions)
      )(eachContentItem.revisions);
    }, content);

    // Remove all those content items who no longer have a matching revision
    content = filter(contentItem => greaterThanZero(contentItem.revisions.length), content);
    return content;
  };

  return that;
};

export { FilterGenerator };
