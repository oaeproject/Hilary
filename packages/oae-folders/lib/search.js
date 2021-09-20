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

import _ from 'underscore';

import * as AuthzSearch from 'oae-authz/lib/search.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as ContentUtil from 'oae-content/lib/internal/util.js';
import { logger } from 'oae-logger';
import * as MessageBoxSearch from 'oae-messagebox/lib/search.js';
import * as SearchAPI from 'oae-search';
import * as TenantsAPI from 'oae-tenants';

import * as FoldersAPI from 'oae-folders';
import { FoldersConstants } from 'oae-folders/lib/constants.js';
import * as FoldersDAO from 'oae-folders/lib/internal/dao.js';

const log = logger('folders-search');

import {
  compose,
  identity,
  assoc,
  __,
  mergeLeft,
  mergeDeepLeft,
  pipe,
  map,
  defaultTo,
  head,
  reject,
  isNil,
  prop,
  mapObjIndexed
} from 'ramda';

const defaultToEmptyObject = defaultTo({});
const getResourceId = prop('resourceId');
const { getTenant } = TenantsAPI;
const { getResourceFromId } = AuthzUtil;
const getTenantAlias = prop('tenantAlias');
const removeFalsy = reject(isNil);

/**
 * Initializes the child search documents for the folders module
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const init = function (callback) {
  return MessageBoxSearch.registerMessageSearchDocument(
    FoldersConstants.search.MAPPING_FOLDER_MESSAGE,
    ['folder'],
    (resources, callback) => {
      return _produceFolderMessageDocuments(resources.slice(), callback);
    },
    callback
  );
};

/*!
 * When a folder is created:
 *   -  fire a task to index the folder
 *   -  fire a task to update the memberships search documents of the
 *      members of the folder
 */
FoldersAPI.emitter.on(FoldersConstants.events.CREATED_FOLDER, (ctx, folder, memberChangeInfo) => {
  // Index the folder. We need to pass the *group id* as the `id` to be indexed as this
  // is what the authz api needs to index the resource members. We also pass in the
  // folder id so we can easily retrieve the full folder object when producing folder documents
  SearchAPI.postIndexTask('folder', [{ id: folder.groupId, folderId: folder.id }], {
    resource: true,
    children: {
      // eslint-disable-next-line camelcase
      resource_members: true
    }
  });

  // Update the membership search documents of the members
  AuthzSearch.fireMembershipUpdateTasks(_.pluck(memberChangeInfo.members.added, 'id'));
});

/*!
 * When a folder is updated we reindex its metadata
 */
FoldersAPI.emitter.on(FoldersConstants.events.UPDATED_FOLDER, (ctx, updatedFolder) => {
  SearchAPI.postIndexTask('folder', [{ id: updatedFolder.groupId, folderId: updatedFolder.id }], {
    resource: true
  });
});

/*!
 * When a folder is deleted we remove it from the index
 */
FoldersAPI.emitter.on(FoldersConstants.events.DELETED_FOLDER, (ctx, folder) => {
  SearchAPI.postDeleteTask(folder.groupId);
});

/*!
 * When the previews for a folder are updated we reindex its metadata
 */
FoldersAPI.emitter.on(FoldersConstants.events.UPDATED_FOLDER_PREVIEWS, (folder) => {
  SearchAPI.postIndexTask('folder', [{ id: folder.groupId, folderId: folder.id }], {
    resource: true
  });
});

/*!
 * When the members of a folder are updated, fire a task to update the memberships search
 * documents of those whose roles have changed
 */
FoldersAPI.emitter.on(FoldersConstants.events.UPDATED_FOLDER_MEMBERS, (ctx, folder, memberChangeInfo, opts) => {
  // Update the members document for this folder
  SearchAPI.postIndexTask('folder', [{ id: folder.groupId, folderId: folder.id }], {
    children: {
      // eslint-disable-next-line camelcase
      resource_members: true
    }
  });

  // Update each of the updated members their membership documents
  const principalIds = _.chain(memberChangeInfo.members.added)
    .union(memberChangeInfo.members.updated)
    .union(memberChangeInfo.members.removed)
    .pluck('id')
    .value();
  AuthzSearch.fireMembershipUpdateTasks(principalIds);
});

/**
 * Index the resource members for a set of content items
 *
 * @param  {Context}        ctx             Standard context object containing the current user and the current tenant
 * @param  {Folder}         folder          The folder where the content items where added to/removed from
 * @param  {Content[]}      contentItems    The content items that were added or removed
 * @api private
 */
const _indexContentResourceMembers = function (ctx, folder, contentItems) {
  const resources = _.map(contentItems, (contentItem) => {
    return { id: contentItem.id };
  });

  SearchAPI.postIndexTask('content', resources, {
    children: {
      // eslint-disable-next-line camelcase
      resource_members: true
    }
  });
};

/*!
 * When content items are added to a folder, fire a task to update the members search document
 * of the content items that were added
 */
FoldersAPI.emitter.on(FoldersConstants.events.ADDED_CONTENT_ITEMS, (ctx, actionContext, folder, contentItems) => {
  return _indexContentResourceMembers(ctx, folder, contentItems);
});

/*!
 * When content items are removed from a folder, fire a task to update the members search document
 * of the content items that were removed
 */
FoldersAPI.emitter.on(FoldersConstants.events.REMOVED_CONTENT_ITEMS, _indexContentResourceMembers);

/*!
 * When a message is added to a folder, we must index the child message document
 */
FoldersAPI.emitter.on(FoldersConstants.events.CREATED_COMMENT, (ctx, message, folder) => {
  const resource = {
    id: folder.groupId,
    messages: [message]
  };
  SearchAPI.postIndexTask('folder', [resource], {
    children: {
      // eslint-disable-next-line camelcase
      folder_message: true
    }
  });
});

/*!
 * When a folder message is deleted, we must delete the child message document
 */
FoldersAPI.emitter.on(FoldersConstants.events.DELETED_COMMENT, (ctx, message, folder, deleteType) => {
  return MessageBoxSearch.deleteMessageSearchDocument(
    FoldersConstants.search.MAPPING_FOLDER_MESSAGE,
    folder.groupId,
    message
  );
});

/// /////////////////////
// DOCUMENT PRODUCERS //
/// /////////////////////

/**
 * Produce the necessary folder message search documents.
 *
 * @see MessageBoxSearch.registerMessageSearchDocument
 */
const _produceFolderMessageDocuments = function (resources, callback, _documents) {
  _documents = _documents || [];
  if (_.isEmpty(resources)) {
    return callback(null, _documents);
  }

  const resource = resources.pop();
  if (resource.messages) {
    const documents = MessageBoxSearch.createMessageSearchDocuments(
      FoldersConstants.search.MAPPING_FOLDER_MESSAGE,
      resource.id,
      resource.messages
    );
    _documents = _.union(_documents, documents);
    return _produceFolderMessageDocuments(resources, callback, _documents);
  }

  // If there were no messages stored on the resource object, we go ahead and index all messages for the folder
  MessageBoxSearch.createAllMessageSearchDocuments(
    FoldersConstants.search.MAPPING_FOLDER_MESSAGE,
    resource.id,
    resource.id,
    (err, documents) => {
      if (err) {
        log().warn({ err, resource }, 'An error occurred producing message search documents');
      }

      _documents = _.union(_documents, documents);
      return _produceFolderMessageDocuments(resources, callback, _documents);
    }
  );
};

/**
 * Produces search documents for `folder` resources.
 *
 * @see SearchAPI#registerSearchDocumentProducer
 * @api private
 */
const _produceFolderSearchDocuments = function (resources, callback) {
  if (_.isEmpty(resources)) {
    return callback(null, []);
  }

  const folderIds = _.map(resources, (resource) => {
    return resource.folderId;
  });

  FoldersDAO.getFoldersByIds(folderIds, (err, folders) => {
    if (err) {
      return callback([err]);
    }

    const docs = _.map(folders, _produceFolderSearchDocument);
    return callback(null, docs);
  });
};

/**
 * Convert a folder into a resource search document
 *
 * @param  {Folder}     folder      The folder to convert
 * @return {Object}                 A search document
 * @api private
 */
const _produceFolderSearchDocument = function (folder) {
  // Allow full-text search on name and description, but only if they are specified. We also sort on this text
  const fullText = _.compact([folder.displayName, folder.description]).join(' ');

  // Add all properties for the resource document metadata. Notice that we use
  // the *group id* as the document identifier. This is done because the authz
  // search indexers will add the members of the folder as a child document of
  // the group id. If we were to use the folder id here, that link would be missing
  // and we wouldn't be able to do explicit access searches through ElasticSearch
  const doc = {
    id: folder.groupId,
    tenantAlias: folder.tenant.alias,
    displayName: folder.displayName,
    visibility: folder.visibility,
    // eslint-disable-next-line camelcase
    q_high: folder.displayName,
    // eslint-disable-next-line camelcase
    q_low: fullText,
    sort: folder.displayName,
    dateCreated: folder.created,
    lastModified: folder.lastModified,
    createdBy: folder.createdBy,
    _extra: {
      folderId: folder.id
    }
  };

  if (folder.previews && folder.previews.thumbnailUri) {
    doc.thumbnailUrl = folder.previews.thumbnailUri;
  }

  if (folder.description) {
    doc.description = folder.description;
  }

  return doc;
};

SearchAPI.registerSearchDocumentProducer('folder', _produceFolderSearchDocuments);

/**
 * Document transformers
 */

/**
 * Given an array of folder search documents, transform them into search documents suitable to be displayed to the user in context.
 *
 * @param  {Context}   ctx             Standard context object containing the current user and the current tenant
 * @param  {Object}    docs            A hash where the keys are the document ids and the values are the documents to transform
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @param  {Object}    callback.docs   The transformed docs, in the same form as the `docs` parameter
 * @api private
 */
const _transformFolderDocuments = function (ctx, docs, callback) {
  const transformedDocs = mapObjIndexed((doc, docId) => {
    const scalarFields = map(head, doc.fields);
    const extraFields = compose(defaultToEmptyObject, head)(doc.fields._extra);

    const tenantAlias = getTenantAlias(scalarFields);
    const tenant = getTenant(tenantAlias).compact();
    const resourceId = compose(getResourceId, getResourceFromId)(extraFields.folderId);
    const tenantAndProfileInfo = {
      tenant,
      profilePath: `/folder/${tenantAlias}/${resourceId}`
    };
    const { thumbnailUrl } = scalarFields;

    // If applicable, sign the thumbnailUrl so the current user can access it
    const signThumbnail = (thumbnailUrl) => {
      if (thumbnailUrl) {
        return assoc('thumbnailUrl', ContentUtil.getSignedDownloadUrl(ctx, thumbnailUrl));
      }

      return identity;
    };

    const result = pipe(
      // Remember, the document id is the *group* id
      mergeLeft({ groupId: docId }),
      mergeLeft({ id: extraFields.folderId }),
      mergeLeft(scalarFields),
      mergeDeepLeft(tenantAndProfileInfo),
      signThumbnail(thumbnailUrl)
    )(extraFields);

    return result;
  }, docs);

  return callback(null, transformedDocs);
};

// Bind the transformer to the search API
SearchAPI.registerSearchDocumentTransformer('folder', _transformFolderDocuments);

/**
 * Reindex all handlers
 */

/*!
 * Binds a reindexAll handler that reindexes all rows from the Folders CF
 */
SearchAPI.registerReindexAllHandler('folder', (callback) => {
  /*!
   * Handles each iteration of the FoldersDAO iterate all method, firing tasks for all folders to
   * be reindexed.
   *
   * @see FoldersDAO#iterateAll
   */
  const _onEach = function (folderRows, done) {
    // Aggregate folder reindexing task resources
    const folderResources = _.map(folderRows, (row) => {
      return {
        id: row.groupId,
        folderId: row.id
      };
    });

    log().info('Firing re-indexing task for %s folders', folderResources.length);

    if (!_.isEmpty(folderResources)) {
      SearchAPI.postIndexTask('folder', folderResources, { resource: true, children: true });
    }

    return done();
  };

  FoldersDAO.iterateAll(['id', 'groupId'], 100, _onEach, callback);
});

export { init };
