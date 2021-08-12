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

import { format } from 'util';
import {
  isResourceACollabDoc,
  isResourceACollabSheet,
  isResourceALink,
  isResourceAFile
} from 'oae-content/lib/backends/util.js';

import _ from 'underscore';

import * as AuthzAPI from 'oae-authz';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as Cassandra from 'oae-util/lib/cassandra.js';
import * as LibraryAPI from 'oae-library';
import { logger } from 'oae-logger';
import * as OaeUtil from 'oae-util/lib/util.js';

import { Content } from 'oae-content/lib/model.js';
import { ContentConstants } from 'oae-content/lib/constants.js';
import * as RevisionsDAO from './dao.revisions.js';

const log = logger('content-dao');

/// ////////////
// Retrieval //
/// ////////////

/**
 * Get a content's basic profile information based on a pooled content id
 *
 * @param  {String}         contentId           The id of the content object we want to retrieve
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Content}        callback.content    Retrieved content object
 */
const getContent = function (contentId, callback) {
  Cassandra.runQuery('SELECT * FROM "Content" WHERE "contentId" = ?', [contentId], (error, rows) => {
    if (error) {
      return callback(error);
    }

    if (_.isEmpty(rows)) {
      return callback({ code: 404, msg: "Couldn't find content: " + contentId }, null);
    }

    return callback(null, _rowToContent(rows[0]));
  });
};

/**
 * Get multiple content basic profiles at the same time based on their content ids.
 *
 * @param  {String[]}       contentIds          Array of content object ids we want to retrieve. The content profiles will be returned in the same order
 * @param  {String[]}       [fields]            The fields to fetch from the content items. If not specified, all will be fetched
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Content[]}      callback.contentObj Retrieved content objects
 */
const getMultipleContentItems = function (contentIds, fields, callback) {
  if (contentIds.length === 0) {
    return callback(null, []);
  }

  let query = null;
  const parameters = [];

  // If `fields` was specified, we select only the fields specified. Otherwise we select all (i.e., *)
  if (fields) {
    // Ensure fields is a proper array
    fields = OaeUtil.toArray(fields);

    // Always fetch the content id
    fields = _.union(fields, ['contentId']);
    query = format('SELECT "%s" FROM "Content" WHERE "contentId" IN ?', fields.join('","'));
  } else {
    query = 'SELECT * FROM "Content" WHERE "contentId" IN ?';
  }

  parameters.push(contentIds);

  Cassandra.runQuery(query, parameters, (error, rows) => {
    if (error) {
      return callback(error);
    }

    // Index each content item by their id to look up for the final ordered array
    const contentItemsById = {};
    _.each(rows, (row) => {
      const content = _rowToContent(row);
      contentItemsById[content.id] = content;
    });

    // Assemble content items into the order provided by the original contentIds array
    const contentItems = _.map(contentIds, (contentId) => {
      return contentItemsById[contentId];
    });

    return callback(null, contentItems);
  });
};

/**
 * Function that gets all of the principals that are directly associated to a piece of content.
 *
 * @param  {String}         contentId           The id of the content object for which we want to get the members
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Object[]}       callback.members    An array of hashes, where the 'id' property of the hash is the principal id, and the 'role' property of the hash is the role of the principal.
 */
const getAllContentMembers = function (contentId, callback) {
  AuthzAPI.getAuthzMembers(contentId, null, 10000, callback);
};

/// ////////////
// Modifiers //
/// ////////////

/**
 * Create a new piece of pooled content
 *
 * @param  {String}         contentId                   The id of the piece of content
 * @param  {String}         revisionId                  The id of the first revision
 * @param  {String}         createdBy                   The id of the user who is creating the content item
 * @param  {String}         resourceSubType             The content type. Possible values are "file", "collabdoc", "collabsheet" and "link"
 * @param  {String}         displayName                 The display name for the piece of content
 * @param  {String}         description                 The description of the piece of content [optional]
 * @param  {String}         visibility                  The visibility setting for the piece of content. Possible values are "public", "loggedin" and "private" [optional]
 * @param  {Object}         otherValues                 JSON object where the keys represent other metadata values that need to be stored, and the values represent the metadata values
 * @param  {Object}         revisionData                JSON object where the keys represent revision columns that need to be stored, and the values represent the revision values
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object}         callback.result             The create content result object
 * @param  {Content}        callback.result.content     JSON object containing the pool id of the created content
 * @param  {Revision}       callback.result.revision    The initial revision object for this content item.
 */
const createContent = function (
  contentId,
  revisionId,
  createdBy,
  resourceSubType,
  displayName,
  description,
  visibility,
  otherValues,
  revisionData,
  callback
) {
  // Use an empty description if no description has been provided
  description = description || '';
  // Default the other values object to an empty object
  otherValues = otherValues || {};

  // Seed the revision first
  RevisionsDAO.createRevision(revisionId, contentId, createdBy, revisionData, (error, revision) => {
    if (error) {
      return callback(error);
    }

    // Get the tenantAlias out of the content model.
    const { tenantAlias } = AuthzUtil.getResourceFromId(contentId);
    const nowString = Date.now().toString();
    // Set the properties
    let parameters = {
      tenantAlias,
      visibility,
      displayName,
      description,
      resourceSubType,
      createdBy,
      created: nowString,
      lastModified: nowString,
      latestRevisionId: revision.revisionId,
      previews: { status: 'pending' }
    };

    // Add the other values into the query
    parameters = _.extend(parameters, otherValues);
    const q = Cassandra.constructUpsertCQL('Content', 'contentId', contentId, parameters);

    // Create the content
    Cassandra.runQuery(q.query, q.parameters, (error_) => {
      if (error_) {
        return callback(error_);
      }

      const contentObject = new Content(
        tenantAlias,
        contentId,
        visibility,
        displayName,
        description,
        resourceSubType,
        parameters.createdBy,
        parameters.created,
        parameters.lastModified,
        revision.revisionId,
        { status: 'pending' }
      );
      return callback(null, contentObject, revision);
    });
  });
};

/**
 * Updates a piece of content in the database.
 *
 * @param  {String}     contentObj              The full (pre-update) content object that is being updated
 * @param  {Object}     profileUpdates          An object where the keys represent the column names and the values the new column values to apply to the content profile
 * @param  {Boolean}    librariesUpdate         Whether or not to update the libraries that this content item sits in
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Content}    callback.content        The new content object
 */
const updateContent = function (contentObject, profileUpdates, librariesUpdate, callback) {
  // Set the lastModified timestamp.
  const oldLastModified = contentObject.lastModified;
  profileUpdates.lastModified = Date.now().toString();

  const q = Cassandra.constructUpsertCQL('Content', 'contentId', contentObject.id, profileUpdates);
  Cassandra.runQuery(q.query, q.parameters, (error) => {
    if (error) {
      return callback(error);
    }

    // Create the new content object by merging in the metadata changes over the old content object
    const newContentObject = _.extend({}, contentObject, profileUpdates);

    // In case the revision ID has changed
    if (newContentObject.resourceSubType === 'file') {
      newContentObject.downloadPath =
        '/api/content/' + newContentObject.id + '/download/' + newContentObject.latestRevisionId;
    }

    if (!librariesUpdate) {
      return callback(null, newContentObject);
    }

    _updateContentLibraries(newContentObject, oldLastModified, newContentObject.lastModified, [], (error) => {
      if (error) {
        return callback(error);
      }

      callback(null, newContentObject);
    });
  });
};

/**
 * Deletes a piece of content from the database and removes it from all the managers/members
 * their libraries.
 *
 * @param  {Content}                contentObj              The piece of content that should be removed
 * @param  {Function}               callback                Standard callback function
 * @param  {Object}                 callback.err            An error that occurred, if any
 * @param  {AuthzPrincipal[]}       callback.members        The set of authz principals who were members of the content item
 */
const deleteContent = function (contentObject, callback) {
  Cassandra.runQuery('DELETE FROM "Content" WHERE "contentId" = ?', [contentObject.id], (error) => {
    if (error) {
      return callback(error);
    }

    getAllContentMembers(contentObject.id, (error, members) => {
      if (error) {
        return callback(error);
      }

      if (_.isEmpty(members)) {
        return callback(null, []);
      }

      const updateMembers = {};
      const libraryRemoveEntries = [];
      _.each(members, (member) => {
        updateMembers[member.id] = false;
        libraryRemoveEntries.push({
          id: member.id,
          rank: contentObject.lastModified,
          resource: contentObject
        });
      });

      // Update the roles CF
      AuthzAPI.updateRoles(contentObject.id, updateMembers, (error_) => {
        if (error_) {
          return callback(error_);
        }

        // Simply remove this item from all member libraries
        LibraryAPI.Index.remove(ContentConstants.library.CONTENT_LIBRARY_INDEX_NAME, libraryRemoveEntries, (error_) => {
          if (error_) {
            // If there was an error updating libraries here, the permissions were still changed, so we should not return an error. Just log it.
            log().warn(
              {
                err: error_,
                contentObj: contentObject,
                libraryRemoveEntries
              },
              'Failed to update user libraries after updating content permissions.'
            );
          }

          return callback(null, members);
        });
      });
    });
  });
};

/// ////////////
// Libraries //
/// ////////////

/**
 * Get a user's or group's content library
 *
 * @param  {String}         principalId         The ID of the principal for which the library should be retrieved.
 * @param  {String}         visibility          Which library should be returned.
 * @param  {String}         start               Determines the point at which content items are returned for paging purposed.  If not provided, the first x elements will be returned
 * @param  {Number}         limit               Number of items to return. Will default to 10 if not provided
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Content[]}      callback.content    Array of basic content profiles representing the requested items in the library
 * @param  {String}         callback.nextToken  The value to use for the `start` parameter to get the next set of results
 */
const getContentLibraryItems = function (principalId, visibility, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10);

  LibraryAPI.Index.list(
    ContentConstants.library.CONTENT_LIBRARY_INDEX_NAME,
    principalId,
    visibility,
    { start, limit },
    (error, entries, nextToken) => {
      if (error) {
        return callback(error);
      }

      const resourceIds = _.pluck(entries, 'resourceId');
      getMultipleContentItems(resourceIds, null, (error, contentItems) => {
        if (error) {
          return callback(error);
        }

        // If the library was stale or dirty, it might contain ids for content
        // items that no longer exist. Remove these from the returned result set
        contentItems = _.compact(contentItems);

        return callback(null, contentItems, nextToken);
      });
    }
  );
};

/**
 * Iterate through all the content items. This will return just the raw content properties that are specified in the `properties`
 * parameter, and only `batchSize` content items at a time. On each iteration of `batchSize` content items, the `onEach` callback
 * will be invoked, and the next batch will not be fetched until you have invoked the `onEach.done` function parameter. When
 * complete (e.g., there are 0 content items left to iterate through or an error has occurred), the `callback` parameter will be
 * invoked.
 *
 * @param  {String[]}   [properties]        The names of the content properties to return in the content objects. If not specified (or is empty array), it returns just the `contentId`s
 * @param  {Number}     [batchSize]         The number of content items to fetch at a time. Defaults to 100
 * @param  {Function}   onEach              Invoked with each batch of content items that are fetched from storage
 * @param  {Object[]}   onEach.contentRow   An array of objects holding the raw content rows that were fetched from storage
 * @param  {Function}   onEach.done         The function to invoke when processing of the current batch is complete
 * @param  {Object}     onEach.done.err     An error that occurred, if any, while processing the current batch. If you specify this error, iteration will finish and the completion callback will be invoked
 * @param  {Function}   [callback]          Invoked when all rows have been iterated, or an error has occurred
 * @param  {Object}     [callback.err]      An error that occurred, while iterating rows, if any
 * @see Cassandra#iterateAll
 */
const iterateAll = function (properties, batchSize, onEach, callback) {
  if (!properties || properties.length === 0) {
    properties = ['contentId'];
  }

  /*!
   * Handles each batch from the cassandra iterateAll method.
   *
   * @see Cassandra#iterateAll
   */
  const _iterateAllOnEach = function (rows, done) {
    // Convert the rows to a hash and delegate action to the caller onEach method
    return onEach(_.map(rows, Cassandra.rowToHash), done);
  };

  Cassandra.iterateAll(properties, 'Content', 'contentId', { batchSize }, _iterateAllOnEach, callback);
};

/**
 * Updates the libraries of all of the members of a piece of content. This will remove the old entry with
 * the old lastModified date/sorting and add the new one. The content item's `lastModified` timestamp will
 * be updated such that it ranked higher in libraries.
 *
 * @param  {Content}    contentObj                  The content object for which the libraries should be updated.
 * @param  {String[]}   removedMembers              An array of principal IDs that should no longer have this item in their library.
 * @param  {Function}   [callback]                  Standard callback function
 * @param  {Object}     [callback.err]              Error object containing the error message
 * @param  {Content}    [callback.newContentObj]    The content object with the updated `lastModified` field. Note that this may be returned even if there is an error as the content-update operation may have succeeded but the library-update operation fails.
 */
const updateContentLibraries = function (contentObject, removedMembers, callback) {
  // Grab hold of the old last modified timestamp to remove columns in the library CF (if any)
  const oldLastModified = contentObject.lastModified;

  // Update the content item with a new timestamp.
  updateContent(contentObject, {}, false, (error, newContentObject) => {
    if (error) {
      return callback(error);
    }

    // Update the libraries.
    _updateContentLibraries(contentObject, oldLastModified, newContentObject.lastModified, removedMembers, (error) => {
      if (error) {
        return callback(error, newContentObject);
      }

      return callback(null, newContentObject);
    });
  });
};

/**
 * Internal function that updates the content libries for a piece of content.
 *
 * @param  {Content}    contentObj          The content object for which the libraries should be updated
 * @param  {Number}     oldLastModified     The timestamp when the content item was last modified. (Note: this is the timestamp that is used in the libraries)
 * @param  {Number}     newLastModified     The new timestamp
 * @param  {String[]}   removedMembers      An array of principal IDs that should no longer have this item in their library.
 * @param  {Function}   [callback]          Standard callback function
 * @param  {Object}     [callback.err]      Error object containing the error message
 */
const _updateContentLibraries = function (contentObject, oldLastModified, newLastModified, removedMembers, callback) {
  // Grab all the current members.
  getAllContentMembers(contentObject.id, (error, members) => {
    if (error) {
      return callback(error);
    }

    // Extract all the member ids from the members response
    const memberIds = _.pluck(members, 'id');

    if (!oldLastModified) {
      // We are creating a new content item. We only care about who is getting added, so
      // insert it into the library index for all members
      const insertEntries = _.map(memberIds, (memberId) => {
        return {
          id: memberId,
          rank: newLastModified,
          resource: contentObject
        };
      });
      return LibraryAPI.Index.insert(ContentConstants.library.CONTENT_LIBRARY_INDEX_NAME, insertEntries, callback);
    }

    // Collect any library index update operations from the member ids that are not removal
    // entries
    const updateEntries = _.chain(memberIds)
      .difference(removedMembers)
      .map((memberId) => {
        return {
          id: memberId,
          newRank: newLastModified,
          oldRank: oldLastModified,
          resource: contentObject
        };
      })
      .value();

    // Collect any library index remove operations from the member ids that are being removed
    const removeEntries = _.map(removedMembers, (removedMemberId) => {
      return {
        id: removedMemberId,
        rank: oldLastModified,
        resource: contentObject
      };
    });

    // Apply the index updates, if any
    OaeUtil.invokeIfNecessary(
      !_.isEmpty(updateEntries),
      LibraryAPI.Index.update,
      ContentConstants.library.CONTENT_LIBRARY_INDEX_NAME,
      updateEntries,
      (error) => {
        if (error) {
          return callback(error);
        }

        // Apply the index removals, if any
        return OaeUtil.invokeIfNecessary(
          !_.isEmpty(removeEntries),
          LibraryAPI.Index.remove,
          ContentConstants.library.CONTENT_LIBRARY_INDEX_NAME,
          removeEntries,
          callback
        );
      }
    );
  });
};

/// ////////////////////
// Utility functions //
/// ////////////////////

/**
 * Creates a Content item from a Cassandra row.
 *
 * @param  {Row}        row     Cassandra Row
 * @return {Content}            Converted content object
 * @api private
 */
const _rowToContent = function (row) {
  const hash = Cassandra.rowToHash(row);

  // Try and parse and apply the previews object of the hash
  _parsePreviews(hash);

  const contentObject = new Content(
    hash.tenantAlias,
    hash.contentId,
    hash.visibility,
    hash.displayName,
    hash.description,
    hash.resourceSubType,
    hash.createdBy,
    hash.created,
    hash.lastModified,
    hash.latestRevisionId,
    hash.previews
  );
  if (isResourceAFile(contentObject.resourceSubType)) {
    contentObject.filename = hash.filename;
    contentObject.size = hash.size ? Number.parseInt(hash.size, 10) : 0;
    contentObject.mime = hash.mime;
  } else if (isResourceALink(contentObject.resourceSubType)) {
    contentObject.link = hash.link;
  } else if (isResourceACollabDoc(contentObject.resourceSubType)) {
    contentObject.etherpadGroupId = hash.etherpadGroupId;
    contentObject.etherpadPadId = hash.etherpadPadId;
  } else if (isResourceACollabSheet(contentObject.resourceSubType)) {
    contentObject.ethercalcRoomId = hash.ethercalcRoomId;
  }

  return contentObject;
};

/**
 * Given a storage hash of a content object, try and parse the previews String JSON blob and replace it on the object. If the
 * previews object is not set or is not a valid JSON object, then `null` will simply be applied as the value.
 *
 * @param  {Object}     hash                The storage hash of a content object
 * @param  {String}     [hash.previews]     The unparsed previews string
 * @api private
 */
const _parsePreviews = function (hash) {
  try {
    if (hash.previews) {
      hash.previews = JSON.parse(hash.previews);
    }
  } catch {
    log().warn({ hash }, 'Could not parse the content previews object');
  }
};

export {
  getContent,
  getMultipleContentItems,
  getAllContentMembers,
  createContent,
  updateContent,
  deleteContent,
  getContentLibraryItems,
  iterateAll,
  updateContentLibraries
};
