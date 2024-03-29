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

import fs from 'node:fs';
import { isResourceACollabDoc, isResourceACollabSheet } from 'oae-content/lib/backends/util.js';
import {
  forEach,
  indexBy,
  union,
  uniq,
  prop,
  assoc,
  pipe,
  map,
  and,
  mergeLeft,
  path,
  compose,
  isEmpty,
  reject,
  not,
  defaultTo,
  head,
  mergeDeepLeft,
  mapObjIndexed,
  forEachObjIndexed
} from 'ramda';

import * as AuthzUtil from 'oae-authz/lib/util.js';
import { logger } from 'oae-logger';
import * as MessageBoxSearch from 'oae-messagebox/lib/search.js';
import * as SearchAPI from 'oae-search';
import * as SearchUtil from 'oae-search/lib/util.js';
import * as TenantsAPI from 'oae-tenants';

import * as ContentAPI from 'oae-content';
import * as ContentDAO from 'oae-content/lib/internal/dao.js';
import * as ContentUtil from 'oae-content/lib/internal/util.js';
import { ContentConstants } from 'oae-content/lib/constants.js';

import * as contentBodySchema from './search/schema/content-body-schema.js';

const { MAPPING_CONTENT_BODY, MAPPING_CONTENT_COMMENT } = ContentConstants.search;
const {
  DELETED_COMMENT,
  DELETED_CONTENT,
  UPDATED_CONTENT_BODY,
  UPDATED_CONTENT_MEMBERS,
  UPDATED_CONTENT_PREVIEW,
  RESTORED_REVISION,
  CREATED_CONTENT,
  UPDATED_CONTENT,
  CREATED_COMMENT
} = ContentConstants.events;

const CONTENT = 'content';
const CONTENT_ID = 'contentId';
const REVISION_ID = 'revisionId';
const RESOURCE_ID = 'resourceId';
const TENANT_ALIAS = 'tenantAlias';
const ETHERCALC_HTML = 'ethercalcHtml';
const ETHERPAD_HTML = 'etherpadHtml';

const { getTenant } = TenantsAPI;
const log = logger('content-search');

const compact = reject(pipe(Boolean, not));
const defaultToEmptyArray = defaultTo([]);
const defaultToEmptyObject = defaultTo({});
const getResourceId = prop(RESOURCE_ID);
const getTenantAlias = prop(TENANT_ALIAS);
const { getSignedDownloadUrl } = ContentUtil;
const { getResourceFromId } = AuthzUtil;

/**
 * Initializes the child search documents for the Content module
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
export function init(callback) {
  const contentBodyChildSearchDocumentOptions = {
    resourceTypes: [CONTENT],
    schema: contentBodySchema,
    producer(resources, callback) {
      return _produceContentBodyDocuments([...resources], callback);
    }
  };

  SearchAPI.registerChildSearchDocument(MAPPING_CONTENT_BODY, contentBodyChildSearchDocumentOptions, (error) => {
    if (error) return callback(error);

    return MessageBoxSearch.registerMessageSearchDocument(
      MAPPING_CONTENT_COMMENT,
      [CONTENT],
      (resources, callback) => _produceContentCommentDocuments([...resources], callback),
      callback
    );
  });
}

/**
 * Indexing tasks
 */

/*!
 * When a content item is created, we must index its resource document and all potential members
 */
ContentAPI.emitter.on(CREATED_CONTENT, (ctx, content, _revision) => {
  SearchAPI.postIndexTask(CONTENT, [{ id: content.id }], {
    resource: true,
    children: {
      resource_members: true // eslint-disable-line camelcase
    }
  });
});

/*!
 * When a content item is updated, we must index its resource document
 */
ContentAPI.emitter.on(UPDATED_CONTENT, (ctx, newContent, _oldContent, _revision) => {
  SearchAPI.postIndexTask(CONTENT, [{ id: newContent.id }], {
    resource: true
  });
});

/*!
 * When a content item's members are updated, we must update its child members document
 */
ContentAPI.emitter.on(UPDATED_CONTENT_MEMBERS, (ctx, content) => {
  SearchAPI.postIndexTask(CONTENT, [{ id: content.id }], {
    children: {
      resource_members: true // eslint-disable-line camelcase
    }
  });
});

/*!
 * When a content item's preview finishes updating, we must reindex its resource document
 */
ContentAPI.emitter.on(UPDATED_CONTENT_PREVIEW, (content) => {
  SearchAPI.postIndexTask(CONTENT, [{ id: content.id }], {
    resource: true,
    children: {
      content_body: true // eslint-disable-line camelcase
    }
  });
});

/*!
 * When a new version of a content item's body is created, we must update its resource document
 */
ContentAPI.emitter.on(
  UPDATED_CONTENT_BODY,
  // eslint-disable-next-line no-unused-vars
  (ctx, newContentObject, oldContentObject, revision) => {
    SearchAPI.postIndexTask(CONTENT, [{ id: newContentObject.id }], {
      resource: true
    });
  }
);

/*!
 * When an older revision for a content item gets restored, we must reindex its resource document
 * as the thumbnail url will be different
 */
ContentAPI.emitter.on(RESTORED_REVISION, (ctx, newContentObject, _oldContentObject, _restoredRevision) => {
  SearchAPI.postIndexTask(CONTENT, [{ id: newContentObject.id }], {
    resource: true
  });
});

/*!
 * When a content item is deleted, we must cascade delete its resource document and all its children
 */
ContentAPI.emitter.on(DELETED_CONTENT, (ctx, contentObject) => {
  SearchAPI.postDeleteTask(contentObject.id);
});

/*!
 * When a comment is created for a content item, we must index the child message document
 */
ContentAPI.emitter.on(CREATED_COMMENT, (ctx, comment, content) => {
  const resource = {
    id: content.id,
    comments: [comment]
  };

  SearchAPI.postIndexTask(CONTENT, [resource], {
    children: {
      content_comment: true // eslint-disable-line camelcase
    }
  });
});

/*!
 * when a comment is deleted on a content item, we must delete the child message document
 */
ContentAPI.emitter.on(DELETED_COMMENT, (ctx, comment, content) =>
  MessageBoxSearch.deleteMessageSearchDocument(MAPPING_CONTENT_COMMENT, content.id, comment)
);

/**
 * Document producers
 */

/**
 * Produce the necessary content comment search documents.
 *
 * @see SearchAPI#registerChildSearchDocument
 * @api private
 */
const _produceContentCommentDocuments = function (resources, callback, _documents, _errs) {
  _documents = defaultToEmptyArray(_documents);

  if (isEmpty(resources)) return callback(_errs, _documents);

  const resource = resources.pop();
  if (resource.comments) {
    const documents = MessageBoxSearch.createMessageSearchDocuments(
      MAPPING_CONTENT_COMMENT,
      resource.id,
      resource.comments
    );
    _documents = union(_documents, documents);
    return _produceContentCommentDocuments(resources, callback, _documents, _errs);
  }

  /**
   * If there were no messages stored on the resource object,
   * we go ahead and index all comments for the content item
   */
  MessageBoxSearch.createAllMessageSearchDocuments(
    MAPPING_CONTENT_COMMENT,
    resource.id,
    resource.id,
    (error, documents) => {
      if (error) {
        _errs = union(_errs, [error]);
      }

      _documents = union(_documents, documents);
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
const _produceContentBodyDocuments = function (resources, callback, _documents, _errs) {
  _documents = _documents || [];
  if (isEmpty(resources)) return callback(_errs, _documents);

  const resource = resources.pop();
  // Get the latest revision
  ContentDAO.Revisions.getRevisions(resource.id, null, 1, null, (error, revisions) => {
    if (error) {
      _errs = union(_errs, [error]);
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

    ContentDAO.Previews.getContentPreview(revision.previewsId, 'plain.txt', (error, preview) => {
      if (error) {
        _errs = union(_errs, [error]);
        return _produceContentBodyDocuments(resources, callback, _documents, _errs);
      }

      const { tenantAlias } = getResourceFromId(revision.previewsId);
      ContentUtil.getStorageBackend(null, preview.uri).get(tenantAlias, preview.uri, (error, file) => {
        if (error) {
          _errs = union(_errs, [error]);
          return _produceContentBodyDocuments(resources, callback, _documents, _errs);
        }

        fs.readFile(file.path, (error, data) => {
          if (!error) {
            const childDoc = SearchUtil.createChildSearchDocument(
              MAPPING_CONTENT_BODY,
              resource.id,
              // eslint-disable-next-line camelcase
              { content_body: data.toString('utf8') }
            );
            _documents.push(childDoc);
          }

          // In all cases, the file should be removed again
          fs.unlink(file.path, (error_) => {
            if (error_) {
              _errs = union(_errs, [error_]);
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
const _produceContentSearchDocuments = function (resources, callback) {
  if (isEmpty(resources)) return callback(null, []);

  const docs = [];
  _getContentItems(resources, (error, contentItems) => {
    // If the content items could not be found, there isn't much we can do
    if (error) return callback([error]);

    if (isEmpty(contentItems)) return callback(null, docs);

    _getRevisionItems(contentItems, (error, revisionsById) => {
      if (error) return callback([error]);

      forEachObjIndexed((contentItem) => {
        docs.push(_produceContentSearchDocument(contentItem, revisionsById[contentItem.latestRevisionId]));
      }, contentItems);

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
const _getRevisionItems = function (contentItems, callback) {
  // Check if we need to fetch revisions
  const revisionsToRetrieve = [];
  forEachObjIndexed((content) => {
    if (isResourceACollabDoc(content.resourceSubType) || isResourceACollabSheet(content.resourceSubType)) {
      revisionsToRetrieve.push(content.latestRevisionId);
    }
  }, contentItems);

  if (isEmpty(revisionsToRetrieve)) return callback(null, {});

  ContentDAO.Revisions.getMultipleRevisions(
    revisionsToRetrieve,
    { fields: [REVISION_ID, ETHERPAD_HTML, ETHERCALC_HTML] },
    (error, revisions) => {
      if (error) return callback(error);

      const revisionsById = indexBy(prop(REVISION_ID), revisions);
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
const _getContentItems = function (resources, callback) {
  /**
   * For indexing resources that have content items attached, return the content item.
   * For those that don't, aggregate the ids so the content items may be fetched
   */
  let contentIdsToFetch = [];
  let contentItems = [];
  forEach((resource) => {
    if (resource.content) {
      contentItems.push(resource.content);
    } else {
      contentIdsToFetch.push(resource.id);
    }
  }, resources);

  // Remove duplicates (if any)
  contentIdsToFetch = uniq(contentIdsToFetch);

  // No content items to be fetched, return what we have
  if (isEmpty(contentIdsToFetch)) return callback(null, contentItems);

  // Get the content objects
  ContentDAO.Content.getMultipleContentItems(contentIdsToFetch, null, (error, extraContentItems) => {
    if (error) return callback(error);

    // Filter the null values from the multiple content items array
    extraContentItems = compact(extraContentItems);

    // Add the content items that came from Cassandra
    contentItems = union(contentItems, extraContentItems);
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
const _produceContentSearchDocument = function (content, revision) {
  // Allow full-text search on name and description, but only if they are specified. We also sort on this text
  let fullText = compact([content.displayName, content.description]).join(' ');
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

SearchAPI.registerSearchDocumentProducer(CONTENT, _produceContentSearchDocuments);

/**
 * Document transformers
 */

/**
 * Given an array of content search documents, transform them into search documents suitable to be displayed to the user in context.
 *
 * @param  {Context}   ctx             Current execution context
 * @param  {Object}    docs            A hash, keyed by the document id, while the value is the document to transform
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @param  {Object}    callback.docs   The transformed docs, in the same form as the `docs` parameter.
 * @api private
 */
const _transformContentDocuments = function (ctx, docs, callback) {
  const transformedDocs = mapObjIndexed((doc, docId) => {
    const scalarFields = map(head, doc.fields);
    const extraFields = compose(defaultToEmptyObject, head, path(['fields', '_extra']))(doc);

    const tenantAlias = getTenantAlias(scalarFields);
    const tenant = getTenant(tenantAlias).compact();
    const resourceId = compose(getResourceId, getResourceFromId)(docId);
    const tenantAndProfileInfo = {
      tenant,
      profilePath: `/content/${tenantAlias}/${resourceId}`
    };
    const { thumbnailUrl } = scalarFields;

    // If applicable, sign the thumbnailUrl so the current user can access it
    const signThumbnail = (result) => {
      if (and(thumbnailUrl, result.lastModified)) {
        return assoc('thumbnailUrl', getSignedDownloadUrl(ctx, thumbnailUrl), result);
      }

      return result;
    };

    return pipe(
      mergeLeft({ id: docId }),
      mergeLeft(scalarFields),
      mergeDeepLeft(tenantAndProfileInfo),
      signThumbnail
    )(extraFields);
  }, docs);

  return callback(null, transformedDocs);
};

// Bind the transformer to the search API
SearchAPI.registerSearchDocumentTransformer(CONTENT, _transformContentDocuments);

/**
 * Reindex all handler
 */

SearchAPI.registerReindexAllHandler(CONTENT, (callback) => {
  /*!
   * Handles each iteration of the ContentDAO iterate all method, firing tasks for all content to
   * be reindexed.
   *
   * @see ContentDAO.Content#iterateAll
   * @api private
   */
  const _onEach = function (contentRows, done) {
    // Batch up this iteration of task resources
    const contentResources = [];
    forEachObjIndexed((contentRow) => {
      contentResources.push({ id: contentRow.contentId });
    }, contentRows);

    log().info('Firing re-indexing task for %s content items.', contentResources.length);
    SearchAPI.postIndexTask(CONTENT, contentResources, { resource: true, children: true });

    return done();
  };

  return ContentDAO.Content.iterateAll([CONTENT_ID], 100, _onEach, callback);
});
