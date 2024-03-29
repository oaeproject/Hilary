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

import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as MessageBoxSearch from 'oae-messagebox/lib/search.js';
import * as SearchAPI from 'oae-search';
import * as TenantsAPI from 'oae-tenants';
import { logger } from 'oae-logger';
import {
  union,
  isEmpty,
  pipe,
  not,
  reject,
  compose,
  map,
  mapObjIndexed,
  prop,
  defaultTo,
  mergeDeepLeft,
  head,
  forEach,
  mergeLeft
} from 'ramda';
import * as DiscussionsDAO from './internal/dao.js';
import DiscussionsAPI from './api.js';
import { DiscussionsConstants } from './constants.js';

const log = logger('discussions-search');

const DISCUSSION = 'discussion';
const ID = 'id';

const defaultToEmptyArray = defaultTo([]);
const defaultToEmptyObject = defaultTo({});
const getResourceId = prop('resourceId');
const { getTenant } = TenantsAPI;
const { getResourceFromId } = AuthzUtil;
const getTenantAlias = prop('tenantAlias');
const compact = reject(pipe(Boolean, not));

/**
 * Initializes the child search documents for the Discussions module
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const init = function (callback) {
  return MessageBoxSearch.registerMessageSearchDocument(
    DiscussionsConstants.search.MAPPING_DISCUSSION_MESSAGE,
    [DISCUSSION],
    (resources, callback) => _produceDiscussionMessageDocuments([...resources], callback),
    callback
  );
};

/**
 * Indexing tasks
 */

/*!
 * When a discussion is created, we must index it and all its potential members
 */
DiscussionsAPI.on(DiscussionsConstants.events.CREATED_DISCUSSION, (ctx, discussion) => {
  SearchAPI.postIndexTask(DISCUSSION, [{ id: discussion.id }], {
    resource: true,
    children: {
      resource_members: true // eslint-disable-line camelcase
    }
  });
});

/*!
 * When a discussion is updated, we must reindex its resource document
 */
DiscussionsAPI.on(DiscussionsConstants.events.UPDATED_DISCUSSION, (ctx, discussion) => {
  SearchAPI.postIndexTask(DISCUSSION, [{ id: discussion.id }], {
    resource: true
  });
});

/*!
 * When a discussion's membership is updated, we must reindex its members child document
 */
DiscussionsAPI.on(DiscussionsConstants.events.UPDATED_DISCUSSION_MEMBERS, (ctx, discussion) => {
  SearchAPI.postIndexTask(DISCUSSION, [{ id: discussion.id }], {
    children: {
      resource_members: true // eslint-disable-line camelcase
    }
  });
});

/*!
 * When a discussion is deleted, we must cascade delete its resource document and children
 */
DiscussionsAPI.on(DiscussionsConstants.events.DELETED_DISCUSSION, (_ctx, discussion) => {
  SearchAPI.postDeleteTask(discussion.id);
});

/*!
 * When a message is added to a discussion, we must index the child message document
 */
DiscussionsAPI.on(DiscussionsConstants.events.CREATED_DISCUSSION_MESSAGE, (_ctx, message, discussion) => {
  const resource = {
    id: discussion.id,
    messages: [message]
  };

  SearchAPI.postIndexTask(DISCUSSION, [resource], {
    children: {
      discussion_message: true // eslint-disable-line camelcase
    }
  });
});

/*!
 * When a discussion message is deleted, we must delete the child message document
 */
DiscussionsAPI.on(DiscussionsConstants.events.DELETED_DISCUSSION_MESSAGE, (ctx, message, discussion) =>
  MessageBoxSearch.deleteMessageSearchDocument(
    DiscussionsConstants.search.MAPPING_DISCUSSION_MESSAGE,
    discussion.id,
    message
  )
);

/**
 * Document producers
 */

/**
 * Produce the necessary discussion message search documents.
 *
 * @see MessageBoxSearch.registerMessageSearchDocument
 * @api private
 */
const _produceDiscussionMessageDocuments = function (resources, callback, _documents, _errs) {
  _documents = defaultToEmptyArray(_documents);

  if (isEmpty(resources)) return callback(_errs, _documents);

  const resource = resources.pop();
  if (resource.messages) {
    const documents = MessageBoxSearch.createMessageSearchDocuments(
      DiscussionsConstants.search.MAPPING_DISCUSSION_MESSAGE,
      resource.id,
      resource.messages
    );
    _documents = union(_documents, documents);
    return _produceDiscussionMessageDocuments(resources, callback, _documents, _errs);
  }

  // If there were no messages stored on the resource object, we go ahead and index all messages for the discussion
  MessageBoxSearch.createAllMessageSearchDocuments(
    DiscussionsConstants.search.MAPPING_DISCUSSION_MESSAGE,
    resource.id,
    resource.id,
    (error, documents) => {
      if (error) {
        _errs = union(_errs, [error]);
      }

      _documents = union(_documents, documents);
      return _produceDiscussionMessageDocuments(resources, callback, _documents, _errs);
    }
  );
};

/**
 * Produces search documents for 'discussion' resources.
 *
 * @see SearchAPI#registerSearchDocumentProducer
 * @api private
 */
const _produceDiscussionSearchDocuments = function (resources, callback) {
  _getDiscussions(resources, (error, discussions) => {
    if (error) return callback([error]);

    // Some discussions might have already been deleted
    discussions = compact(discussions);
    if (isEmpty(discussions)) return callback();

    const docs = map(_produceDiscussionSearchDocument, discussions);
    return callback(null, docs);
  });
};

/**
 * Gets a set of discussions.
 *
 * @param  {Object[]}   resources   An array of resources to index.
 * @param  {Function}   callback    Standard callback function
 * @api private
 */
const _getDiscussions = function (resources, callback) {
  const discussions = [];
  const discussionIds = [];

  forEach((resource) => {
    if (resource.discussion) {
      discussions.push(resource.discussion);
    } else {
      discussionIds.push(resource.id);
    }
  }, resources);

  if (isEmpty(discussionIds)) return callback(null, discussions);

  DiscussionsDAO.getDiscussionsById(discussionIds, null, callback);
};

/**
 * Given a discussion item, it produces an appropriate search document.
 *
 * @param  {Discussion}     discussion  The discussion item to index.
 * @return {SearchDoc}                  The produced search document.
 * @api private
 */
const _produceDiscussionSearchDocument = function (discussion) {
  // Allow full-text search on name and description, but only if they are specified. We also sort on this text
  const fullText = compact([discussion.displayName, discussion.description]).join(' ');

  // Add all properties for the resource document metadata
  const doc = {
    resourceType: 'discussion',
    id: discussion.id,
    tenantAlias: discussion.tenant.alias,
    displayName: discussion.displayName,
    visibility: discussion.visibility,
    q_high: discussion.displayName, // eslint-disable-line camelcase
    q_low: fullText, // eslint-disable-line camelcase
    sort: discussion.displayName,
    dateCreated: discussion.created,
    lastModified: discussion.lastModified,
    createdBy: discussion.createdBy,
    _extra: {
      lastModified: discussion.lastModified
    }
  };

  if (discussion.description) {
    doc.description = discussion.description;
  }

  return doc;
};

SearchAPI.registerSearchDocumentProducer(DISCUSSION, _produceDiscussionSearchDocuments);

/**
 * Document transformers
 */

/**
 * Given an array of discussion search documents, transform them into search documents suitable to be displayed to the user in context.
 *
 * @param  {Context}   ctx             Current execution context
 * @param  {Object}    docs            A hash, keyed by the document id, while the value is the document to transform
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @param  {Object}    callback.docs   The transformed docs, in the same form as the `docs` parameter.
 * @api private
 */
const _transformDiscussionDocuments = function (ctx, docs, callback) {
  const transformedDocs = mapObjIndexed((doc, docId) => {
    const scalarFields = map(head, doc.fields);
    const extraFields = compose(defaultToEmptyObject, head)(doc.fields._extra);

    const tenantAlias = getTenantAlias(scalarFields);
    const tenant = getTenant(tenantAlias).compact();
    const resourceId = compose(getResourceId, getResourceFromId)(docId);
    const tenantAndProfileInfo = {
      tenant,
      profilePath: `/discussion/${tenantAlias}/${resourceId}`
    };

    const result = pipe(
      mergeLeft({ id: docId }),
      mergeLeft(scalarFields),
      mergeLeft({ lastModified: extraFields.lastModified }),
      mergeDeepLeft(tenantAndProfileInfo)
    )(extraFields);

    return result;
  }, docs);

  return callback(null, transformedDocs);
};

// Bind the transformer to the search API
SearchAPI.registerSearchDocumentTransformer(DISCUSSION, _transformDiscussionDocuments);

/**
 * Reindex all handler
 */

SearchAPI.registerReindexAllHandler('discussion', (callback) => {
  /*!
   * Handles each iteration of the DiscussionDAO iterate all method, firing tasks for all discussions to
   * be reindexed.
   *
   * @see DiscussionDAO#iterateAll
   * @api private
   */
  const _onEach = function (discussionRows, done) {
    // Batch up this iteration of task resources
    const discussionResources = [];
    forEach((discussionRow) => {
      discussionResources.push({ id: discussionRow.id });
    }, discussionRows);

    log().info('Firing re-indexing task for %s discussions.', discussionResources.length);
    SearchAPI.postIndexTask(DISCUSSION, discussionResources, { resource: true, children: true });
    done();
  };

  DiscussionsDAO.iterateAll([ID], 100, _onEach, callback);
});

export { init };
