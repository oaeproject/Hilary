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

import util from 'util';
import _ from 'underscore';

import * as AuthzUtil from 'oae-authz/lib/util';
import * as MessageBoxSearch from 'oae-messagebox/lib/search';
import * as SearchAPI from 'oae-search';
import * as TenantsAPI from 'oae-tenants';
import { logger } from 'oae-logger';
import * as DiscussionsDAO from './internal/dao';
import DiscussionsAPI from './api';
import { DiscussionsConstants } from './constants';

const log = logger('discussions-search');

import { head, concat, mergeDeepWith } from 'ramda';

/**
 * Initializes the child search documents for the Discussions module
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const init = function(callback) {
  return MessageBoxSearch.registerMessageSearchDocument(
    DiscussionsConstants.search.MAPPING_DISCUSSION_MESSAGE,
    ['discussion'],
    (resources, callback) => {
      return _produceDiscussionMessageDocuments(resources.slice(), callback);
    },
    callback
  );
};

/// /////////////////
// INDEXING TASKS //
/// /////////////////

/*!
 * When a discussion is created, we must index it and all its potential members
 */
DiscussionsAPI.on(DiscussionsConstants.events.CREATED_DISCUSSION, (ctx, discussion) => {
  SearchAPI.postIndexTask('discussion', [{ id: discussion.id }], {
    resource: true,
    children: {
      // eslint-disable-next-line camelcase
      resource_members: true
    }
  });
});

/*!
 * When a discussion is updated, we must reindex its resource document
 */
DiscussionsAPI.on(DiscussionsConstants.events.UPDATED_DISCUSSION, (ctx, discussion) => {
  SearchAPI.postIndexTask('discussion', [{ id: discussion.id }], {
    resource: true
  });
});

/*!
 * When a discussion's membership is updated, we must reindex its members child document
 */
DiscussionsAPI.on(DiscussionsConstants.events.UPDATED_DISCUSSION_MEMBERS, (ctx, discussion) => {
  SearchAPI.postIndexTask('discussion', [{ id: discussion.id }], {
    children: {
      // eslint-disable-next-line camelcase
      resource_members: true
    }
  });
});

/*!
 * When a discussion is deleted, we must cascade delete its resource document and children
 */
DiscussionsAPI.on(DiscussionsConstants.events.DELETED_DISCUSSION, (ctx, discussion) => {
  SearchAPI.postDeleteTask(discussion.id);
});

/*!
 * When a message is added to a discussion, we must index the child message document
 */
DiscussionsAPI.on(DiscussionsConstants.events.CREATED_DISCUSSION_MESSAGE, (ctx, message, discussion) => {
  const resource = {
    id: discussion.id,
    messages: [message]
  };

  SearchAPI.postIndexTask('discussion', [resource], {
    children: {
      // eslint-disable-next-line camelcase
      discussion_message: true
    }
  });
});

/*!
 * When a discussion message is deleted, we must delete the child message document
 */
DiscussionsAPI.on(DiscussionsConstants.events.DELETED_DISCUSSION_MESSAGE, (ctx, message, discussion, _) => {
  return MessageBoxSearch.deleteMessageSearchDocument(
    DiscussionsConstants.search.MAPPING_DISCUSSION_MESSAGE,
    discussion.id,
    message
  );
});

/// /////////////////////
// DOCUMENT PRODUCERS //
/// /////////////////////

/**
 * Produce the necessary discussion message search documents.
 *
 * @see MessageBoxSearch.registerMessageSearchDocument
 * @api private
 */
const _produceDiscussionMessageDocuments = function(resources, callback, _documents, _errs) {
  _documents = _documents || [];
  if (_.isEmpty(resources)) {
    return callback(_errs, _documents);
  }

  const resource = resources.pop();
  if (resource.messages) {
    const documents = MessageBoxSearch.createMessageSearchDocuments(
      DiscussionsConstants.search.MAPPING_DISCUSSION_MESSAGE,
      resource.id,
      resource.messages
    );
    _documents = _.union(_documents, documents);
    return _produceDiscussionMessageDocuments(resources, callback, _documents, _errs);
  }

  // If there were no messages stored on the resource object, we go ahead and index all messages for the discussion
  MessageBoxSearch.createAllMessageSearchDocuments(
    DiscussionsConstants.search.MAPPING_DISCUSSION_MESSAGE,
    resource.id,
    resource.id,
    (err, documents) => {
      if (err) {
        _errs = _.union(_errs, [err]);
      }

      _documents = _.union(_documents, documents);
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
const _produceDiscussionSearchDocuments = function(resources, callback) {
  _getDiscussions(resources, (err, discussions) => {
    if (err) {
      return callback([err]);
    }

    // Some discussions might have already been deleted
    discussions = _.compact(discussions);
    if (_.isEmpty(discussions)) {
      return callback();
    }

    const docs = _.map(discussions, _produceDiscussionSearchDocument);
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
const _getDiscussions = function(resources, callback) {
  const discussions = [];
  const discussionIds = [];

  _.each(resources, resource => {
    if (resource.discussion) {
      discussions.push(resource.discussion);
    } else {
      discussionIds.push(resource.id);
    }
  });

  if (_.isEmpty(discussionIds)) {
    return callback(null, discussions);
  }

  DiscussionsDAO.getDiscussionsById(discussionIds, null, callback);
};

/**
 * Given a discussion item, it produces an appropriate search document.
 *
 * @param  {Discussion}     discussion  The discussion item to index.
 * @return {SearchDoc}                  The produced search document.
 * @api private
 */
const _produceDiscussionSearchDocument = function(discussion) {
  // Allow full-text search on name and description, but only if they are specified. We also sort on this text
  const fullText = _.compact([discussion.displayName, discussion.description]).join(' ');

  // Add all properties for the resource document metadata
  const doc = {
    resourceType: 'discussion',
    id: discussion.id,
    tenantAlias: discussion.tenant.alias,
    displayName: discussion.displayName,
    visibility: discussion.visibility,
    // eslint-disable-next-line camelcase
    q_high: discussion.displayName,
    // eslint-disable-next-line camelcase
    q_low: fullText,
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

SearchAPI.registerSearchDocumentProducer('discussion', _produceDiscussionSearchDocuments);

/// ////////////////////////
// DOCUMENT TRANSFORMERS //
/// ////////////////////////

/**
 * Given an array of discussion search documents, transform them into search documents suitable to be displayed to the user in context.
 *
 * @param  {Context}   ctx             Standard context object containing the current user and the current tenant
 * @param  {Object}    docs            A hash, keyed by the document id, while the value is the document to transform
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @param  {Object}    callback.docs   The transformed docs, in the same form as the `docs` parameter.
 * @api private
 */
const _transformDiscussionDocuments = function(ctx, docs, callback) {
  const transformedDocs = {};
  _.each(docs, (doc, docId) => {
    // TODO check this out
    try {
      doc.fields._extra = JSON.parse(doc.fields._extra);
    } catch (error) {
      // TODO log something here
    }

    // Extract the extra object from the search document
    const extra = head(doc.fields._extra || {});

    // Build the transformed result document from the ElasticSearch document
    const result = { id: docId };
    _.each(doc.fields, (value, name) => {
      // Apply the scalar values wrapped in each ElasticSearch document
      // to the transformed search document
      result[name] = _.first(value);
    });
    // const result = mergeDeepWith(concat, { id: docId }, doc.fields);

    // Take just the `lastModified` from the extra fields, if specified
    _.extend(result, _.pick(extra, 'lastModified'));

    // Add the full tenant object and profile path
    _.extend(result, {
      tenant: TenantsAPI.getTenant(result.tenantAlias).compact(),
      profilePath: util.format(
        '/discussion/%s/%s',
        result.tenantAlias,
        AuthzUtil.getResourceFromId(result.id).resourceId
      )
    });

    transformedDocs[docId] = result;
  });

  return callback(null, transformedDocs);
};

// Bind the transformer to the search API
SearchAPI.registerSearchDocumentTransformer('discussion', _transformDiscussionDocuments);

/**
 * Reindex all handler
 */

SearchAPI.registerReindexAllHandler('discussion', callback => {
  /*!
   * Handles each iteration of the DiscussionDAO iterate all method, firing tasks for all discussions to
   * be reindexed.
   *
   * @see DiscussionDAO#iterateAll
   * @api private
   */
  const _onEach = function(discussionRows, done) {
    // Batch up this iteration of task resources
    const discussionResources = [];
    _.each(discussionRows, discussionRow => {
      discussionResources.push({ id: discussionRow.id });
    });

    log().info('Firing re-indexing task for %s discussions.', discussionResources.length);

    SearchAPI.postIndexTask('discussion', discussionResources, { resource: true, children: true });

    done();
  };

  DiscussionsDAO.iterateAll(['id'], 100, _onEach, callback);
});

export { init };
