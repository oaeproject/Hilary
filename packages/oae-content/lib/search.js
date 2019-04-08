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

const { isResourceACollabDoc, isResourceACollabSheet } = require('oae-content/lib/backends/util');

const fs = require('fs');
const util = require('util');
const _ = require('underscore');

const AuthzUtil = require('oae-authz/lib/util');
const log = require('oae-logger').logger('content-search');
const MessageBoxSearch = require('oae-messagebox/lib/search');
const SearchAPI = require('oae-search');
const SearchUtil = require('oae-search/lib/util');
const TenantsAPI = require('oae-tenants');

const ContentAPI = require('oae-content');
const { ContentConstants } = require('oae-content/lib/constants');
const ContentDAO = require('oae-content/lib/internal/dao');
const ContentUtil = require('oae-content/lib/internal/util');

/**
 * Initializes the child search documents for the Content module
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
module.exports.init = function(callback) {
  const contentBodyChildSearchDocumentOptions = {
    resourceTypes: ['content'],
    schema: require('./search/schema/contentBodySchema'),
    producer(resources, callback) {
      return _produceContentBodyDocuments(resources.slice(), callback);
    }
  };

  SearchAPI.registerChildSearchDocument(
    ContentConstants.search.MAPPING_CONTENT_BODY,
    contentBodyChildSearchDocumentOptions,
    err => {
      if (err) {
        return callback(err);
      }

      return MessageBoxSearch.registerMessageSearchDocument(
        ContentConstants.search.MAPPING_CONTENT_COMMENT,
        ['content'],
        (resources, callback) => {
          return _produceContentCommentDocuments(resources.slice(), callback);
        },
        callback
      );
    }
  );
};

/// /////////////////
// INDEXING TASKS //
/// /////////////////

/*!
 * When a content item is created, we must index its resource document and all potential members
 */
// eslint-disable-next-line no-unused-vars
ContentAPI.emitter.on(ContentConstants.events.CREATED_CONTENT, (ctx, content, revision) => {
  SearchAPI.postIndexTask('content', [{ id: content.id }], {
    resource: true,
    children: {
      // eslint-disable-next-line camelcase
      resource_members: true
    }
  });
});

/*!
 * When a content item is updated, we must index its resource document
 */
ContentAPI.emitter.on(
  ContentConstants.events.UPDATED_CONTENT,
  // eslint-disable-next-line no-unused-vars
  (ctx, newContent, oldContent, revision) => {
    SearchAPI.postIndexTask('content', [{ id: newContent.id }], {
      resource: true
    });
  }
);

/*!
 * When a content item's members are updated, we must update its child members document
 */
ContentAPI.emitter.on(ContentConstants.events.UPDATED_CONTENT_MEMBERS, (ctx, content) => {
  SearchAPI.postIndexTask('content', [{ id: content.id }], {
    children: {
      // eslint-disable-next-line camelcase
      resource_members: true
    }
  });
});

/*!
 * When a content item's preview finishes updating, we must reindex its resource document
 */
ContentAPI.emitter.on(ContentConstants.events.UPDATED_CONTENT_PREVIEW, content => {
  SearchAPI.postIndexTask('content', [{ id: content.id }], {
    resource: true,
    children: {
      // eslint-disable-next-line camelcase
      content_body: true
    }
  });
});

/*!
 * When a new version of a content item's body is created, we must update its resource document
 */
ContentAPI.emitter.on(
  ContentConstants.events.UPDATED_CONTENT_BODY,
  // eslint-disable-next-line no-unused-vars
  (ctx, newContentObj, oldContentObj, revision) => {
    SearchAPI.postIndexTask('content', [{ id: newContentObj.id }], {
      resource: true
    });
  }
);

/*!
 * When an older revision for a content item gets restored, we must reindex its resource document
 * as the thumbnail url will be different
 */
ContentAPI.emitter.on(
  ContentConstants.events.RESTORED_REVISION,
  // eslint-disable-next-line no-unused-vars
  (ctx, newContentObj, oldContentObj, restoredRevision) => {
    SearchAPI.postIndexTask('content', [{ id: newContentObj.id }], {
      resource: true
    });
  }
);

/*!
 * When a content item is deleted, we must cascade delete its resource document and all its children
 */
ContentAPI.emitter.on(ContentConstants.events.DELETED_CONTENT, (ctx, contentObj) => {
  SearchAPI.postDeleteTask(contentObj.id);
});

/*!
 * When a comment is created for a content item, we must index the child message document
 */
ContentAPI.emitter.on(ContentConstants.events.CREATED_COMMENT, (ctx, comment, content) => {
  const resource = {
    id: content.id,
    comments: [comment]
  };

  SearchAPI.postIndexTask('content', [resource], {
    children: {
      // eslint-disable-next-line camelcase
      content_comment: true
    }
  });
});

/*!
 * when a comment is deleted on a content item, we must delete the child message document
 */
ContentAPI.emitter.on(ContentConstants.events.DELETED_COMMENT, (ctx, comment, content) => {
  return MessageBoxSearch.deleteMessageSearchDocument(
    ContentConstants.search.MAPPING_CONTENT_COMMENT,
    content.id,
    comment
  );
});

/// /////////////////////
// DOCUMENT PRODUCERS //
/// /////////////////////

/**
 * Produce the necessary content comment search documents.
 *
 * @see SearchAPI#registerChildSearchDocument
 * @api private
 */
const _produceContentCommentDocuments = function(resources, callback, _documents, _errs) {
  _documents = _documents || [];
  if (_.isEmpty(resources)) {
    return callback(_errs, _documents);
  }

  const resource = resources.pop();
  if (resource.comments) {
    const documents = MessageBoxSearch.createMessageSearchDocuments(
      ContentConstants.search.MAPPING_CONTENT_COMMENT,
      resource.id,
      resource.comments
    );
    _documents = _.union(_documents, documents);
    return _produceContentCommentDocuments(resources, callback, _documents, _errs);
  }

  // If there were no messages stored on the resource object, we go ahead and index all comments for the content item
  MessageBoxSearch.createAllMessageSearchDocuments(
    ContentConstants.search.MAPPING_CONTENT_COMMENT,
    resource.id,
    resource.id,
    (err, documents) => {
      if (err) {
        _errs = _.union(_errs, [err]);
      }

      _documents = _.union(_documents, documents);
      return _produceContentCommentDocuments(resources, callback, _documents, _errs);
    }
  );
};

/**
 * Produce the necessary content body search documents.
 *
 * @see SearchAPI#registerChildSearchDocument
 * @api private
 */
const _produceContentBodyDocuments = function(resources, callback, _documents, _errs) {
  _documents = _documents || [];
  if (_.isEmpty(resources)) {
    return callback(_errs, _documents);
  }

  const resource = resources.pop();
  // Get the latest revision
  ContentDAO.Revisions.getRevisions(resource.id, null, 1, null, (err, revisions) => {
    if (err) {
      _errs = _.union(_errs, [err]);
      return _produceContentBodyDocuments(resources, callback, _documents, _errs);
    }

    const revision = revisions[0];

    // Skip revisions that don't have (html) previews
    if (
      !revision.previews ||
      revision.previews.status !== ContentConstants.previews.DONE ||
      !revision.previews.pageCount
    ) {
      log().trace({ id: resource.id, previews: revision.previews }, 'No text to index');

      // Move on to the next resource
      return _produceContentBodyDocuments(resources, callback, _documents, _errs);
    }

    ContentDAO.Previews.getContentPreview(revision.previewsId, 'plain.txt', (err, preview) => {
      if (err) {
        _errs = _.union(_errs, [err]);
        return _produceContentBodyDocuments(resources, callback, _documents, _errs);
      }

      const { tenantAlias } = AuthzUtil.getResourceFromId(revision.previewsId);
      ContentUtil.getStorageBackend(null, preview.uri).get(tenantAlias, preview.uri, (err, file) => {
        if (err) {
          _errs = _.union(_errs, [err]);
          return _produceContentBodyDocuments(resources, callback, _documents, _errs);
        }

        fs.readFile(file.path, (err, data) => {
          if (!err) {
            const childDoc = SearchUtil.createChildSearchDocument(
              ContentConstants.search.MAPPING_CONTENT_BODY,
              resource.id,
              // eslint-disable-next-line camelcase
              { content_body: data.toString('utf8') }
            );
            _documents.push(childDoc);
          }

          // In all cases, the file should be removed again
          fs.unlink(file.path, err => {
            if (err) {
              _errs = _.union(_errs, [err]);
            }

            // Move on to the next file
            _produceContentBodyDocuments(resources, callback, _documents, _errs);
          });
        });
      });
    });
  });
};

/**
 * Produces search documents for 'content' resources.
 *
 * @see SearchAPI#registerSearchDocumentProducer
 * @api private
 */
const _produceContentSearchDocuments = function(resources, callback) {
  if (_.isEmpty(resources)) {
    return callback(null, []);
  }

  const docs = [];
  _getContentItems(resources, (err, contentItems) => {
    if (err) {
      return callback([err]);

      // If the content items could not be found, there isn't much we can do
    }

    if (_.isEmpty(contentItems)) {
      return callback(null, docs);
    }

    _getRevisionItems(contentItems, (err, revisionsById) => {
      if (err) {
        return callback([err]);
      }

      _.each(contentItems, contentItem => {
        docs.push(_produceContentSearchDocument(contentItem, revisionsById[contentItem.latestRevisionId]));
      });

      return callback(null, docs);
    });
  });
};

/**
 * Gets the revision for those content items that happen to be collaborative documents.
 *
 * @param  {Content[]}  contentItems    An array of content items.
 * @param  {Function}   callback        Standard callback function
 * @return {Object}                     An object where the key is a revisionId and the value the corresponding revision. If none of the content items are collaborative documents, the object will be empty.
 * @api private
 */
const _getRevisionItems = function(contentItems, callback) {
  // Check if we need to fetch revisions
  const revisionsToRetrieve = [];
  _.each(contentItems, content => {
    if (isResourceACollabDoc(content.resourceSubType) || isResourceACollabSheet(content.resourceSubType)) {
      revisionsToRetrieve.push(content.latestRevisionId);
    }
  });

  if (_.isEmpty(revisionsToRetrieve)) {
    return callback(null, {});
  }

  ContentDAO.Revisions.getMultipleRevisions(
    revisionsToRetrieve,
    { fields: ['revisionId', 'etherpadHtml', 'ethercalcHtml'] },
    (err, revisions) => {
      if (err) {
        return callback(err);
      }

      const revisionsById = _.indexBy(revisions, 'revisionId');
      return callback(null, revisionsById);
    }
  );
};

/**
 * Retrieves a set of content items given a set of resources.
 *
 * @param  {Object[]}   resources                   An array of objects that represent the content items.
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error object, if any
 * @param  {Content[]}  callback.contentItems       An array of content items that were present in the `resources` object.
 * @api private
 */
const _getContentItems = function(resources, callback) {
  // For indexing resources that have content items attached, return the content item. For those that don't,
  // aggregate the ids so the content items may be fetched
  let contentIdsToFetch = [];
  let contentItems = [];
  _.each(resources, resource => {
    if (resource.content) {
      contentItems.push(resource.content);
    } else {
      contentIdsToFetch.push(resource.id);
    }
  });

  // Remove duplicates (if any)
  contentIdsToFetch = _.uniq(contentIdsToFetch);

  if (_.isEmpty(contentIdsToFetch)) {
    // No content items to be fetched, return what we have
    return callback(null, contentItems);
  }

  // Get the content objects
  ContentDAO.Content.getMultipleContentItems(contentIdsToFetch, null, (err, extraContentItems) => {
    if (err) {
      return callback(err);
    }

    // Filter the null values from the multiple content items array
    extraContentItems = _.compact(extraContentItems);

    // Add the content items that came from Cassandra
    contentItems = _.union(contentItems, extraContentItems);
    return callback(null, contentItems);
  });
};

/**
 * Convert a content item into a resource search document.
 *
 * @param  {Content}    content     The content item to convert
 * @param  {Revision}   revision    The revision associated to the content item.
 * @return {Object}                 A search document
 * @api private
 */
const _produceContentSearchDocument = function(content, revision) {
  // Allow full-text search on name and description, but only if they are specified. We also sort on this text
  let fullText = _.compact([content.displayName, content.description]).join(' ');
  if (isResourceACollabDoc(content.resourceSubType) && revision && revision.etherpadHtml) {
    fullText += ' ' + revision.etherpadHtml;
  } else if (isResourceACollabSheet(content.resourceSubType) && revision && revision.ethercalcHtml) {
    fullText += ` ${revision.ethercalcHtml}`;
  }

  // Add all properties for the resource document metadata
  const doc = {
    resourceSubType: content.resourceSubType,
    id: content.id,
    tenantAlias: content.tenant.alias,
    displayName: content.displayName,
    visibility: content.visibility,
    // eslint-disable-next-line camelcase
    q_high: content.displayName,
    // eslint-disable-next-line camelcase
    q_low: fullText,
    sort: content.displayName,
    dateCreated: content.created,
    lastModified: content.lastModified,
    createdBy: content.createdBy,
    _extra: {
      lastModified: content.lastModified
    }
  };

  if (content.resourceSubType === 'file') {
    doc._extra.mime = content.mime;
  }

  if (content.previews.thumbnailUri) {
    doc.thumbnailUrl = content.previews.thumbnailUri;
  }

  if (content.description) {
    doc.description = content.description;
  }

  return doc;
};

SearchAPI.registerSearchDocumentProducer('content', _produceContentSearchDocuments);

/// ////////////////////////
// DOCUMENT TRANSFORMERS //
/// ////////////////////////

/**
 * Given an array of content search documents, transform them into search documents suitable to be displayed to the user in context.
 *
 * @param  {Context}   ctx             Standard context object containing the current user and the current tenant
 * @param  {Object}    docs            A hash, keyed by the document id, while the value is the document to transform
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @param  {Object}    callback.docs   The transformed docs, in the same form as the `docs` parameter.
 * @api private
 */
const _transformContentDocuments = function(ctx, docs, callback) {
  const transformedDocs = {};
  _.each(docs, (doc, docId) => {
    // Extract the extra object from the search document
    const extra = _.first(doc.fields._extra) || {};

    const result = { id: docId };
    _.each(doc.fields, (value, name) => {
      // Apply the scalar values wrapped in each ElasticSearch document
      // to the transformed search document
      result[name] = _.first(value);
    });

    // Take just the `mime` and `lastModified` from the extra fields, if specified
    _.extend(result, _.pick(extra, 'mime', 'lastModified'));

    // Add the full tenant object and profile path
    _.extend(result, {
      tenant: TenantsAPI.getTenant(result.tenantAlias).compact(),
      profilePath: util.format('/content/%s/%s', result.tenantAlias, AuthzUtil.getResourceFromId(result.id).resourceId)
    });

    // If applicable, sign the thumbnailUrl so the current user can access it
    const thumbnailUrl = _.first(doc.fields.thumbnailUrl);
    if (thumbnailUrl && result.lastModified) {
      result.thumbnailUrl = ContentUtil.getSignedDownloadUrl(ctx, thumbnailUrl);
    }

    transformedDocs[docId] = result;
  });

  return callback(null, transformedDocs);
};

// Bind the transformer to the search API
SearchAPI.registerSearchDocumentTransformer('content', _transformContentDocuments);

/// //////////////////////
// REINDEX ALL HANDLER //
/// //////////////////////

SearchAPI.registerReindexAllHandler('content', callback => {
  /*!
   * Handles each iteration of the ContentDAO iterate all method, firing tasks for all content to
   * be reindexed.
   *
   * @see ContentDAO.Content#iterateAll
   * @api private
   */
  const _onEach = function(contentRows, done) {
    // Batch up this iteration of task resources
    const contentResources = [];
    _.each(contentRows, contentRow => {
      contentResources.push({ id: contentRow.contentId });
    });

    log().info('Firing re-indexing task for %s content items.', contentResources.length);
    SearchAPI.postIndexTask('content', contentResources, { resource: true, children: true });

    return done();
  };

  return ContentDAO.Content.iterateAll(['contentId'], 100, _onEach, callback);
});
