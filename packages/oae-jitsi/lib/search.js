/*!
 * Copyright 2016 Apereo Foundation (AF) Licensed under the
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

import { format } from 'node:util';
import { logger } from 'oae-logger';

import {
  mergeRight,
  pick,
  union,
  defaultTo,
  map,
  forEach,
  join,
  not,
  pipe,
  reject,
  isEmpty,
  forEachObjIndexed,
  prop,
  head
} from 'ramda';

import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as MessageBoxSearch from 'oae-messagebox/lib/search.js';
import * as SearchAPI from 'oae-search';
import * as TenantsAPI from 'oae-tenants';
import * as MeetingsAPI from 'oae-jitsi';
import * as MeetingsDAO from 'oae-jitsi/lib/internal/dao.js';
import { MeetingsConstants } from 'oae-jitsi/lib/constants.js';

const LAST_MODIFIED = 'lastModified';
const FIELDS = 'fields';
const ID = 'id';
const _EXTRA = '_extra';
const MEETING = 'meeting';
const MEETING_JITSI = 'meeting-jitsi';
const { MAPPING_MEETING_MESSAGE } = MeetingsConstants.search;

const defaultToEmptyObject = defaultTo({});
const log = logger('meeting-jitsi-search');
const defaultToEmptyArray = defaultTo([]);
const compact = reject(pipe(Boolean, not));

/**
 * Initializes the child search documents for the meeting module
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const init = function (callback) {
  return MessageBoxSearch.registerMessageSearchDocument(
    MAPPING_MEETING_MESSAGE,
    [MEETING_JITSI],
    (resources, callback) => _produceMeetingMessageDocuments([...resources], callback),
    callback
  );
};

/**
 * Document producers
 */

/**
 * Produce the necessary meeting message search documents.
 *
 * @see MessageBoxSearch.registerMessageSearchDocument
 * @api private
 */
const _produceMeetingMessageDocuments = function (resources, callback, _documents, _errs) {
  _documents = defaultToEmptyArray(_documents);

  if (isEmpty(resources)) return callback(_errs, _documents);

  const resource = resources.pop();

  if (resource.messages) {
    const documents = MessageBoxSearch.createMessageSearchDocuments(
      MAPPING_MEETING_MESSAGE,
      resource.id,
      resource.messages
    );
    _documents = union(_documents, documents);
    return _produceMeetingMessageDocuments(resources, callback, _documents, _errs);
  }

  // If there were no messages stored on the resource object, we go ahead and index all messages for the meeting
  MessageBoxSearch.createAllMessageSearchDocuments(
    MAPPING_MEETING_MESSAGE,
    resource.id,
    resource.id,
    (error, documents) => {
      if (error) {
        _errs = union(_errs, [error]);
      }

      _documents = union(_documents, documents);
      return _produceMeetingMessageDocuments(resources, callback, _documents, _errs);
    }
  );
};

/**
 * Produces search documents for 'meeting' resources.
 *
 * @see SearchAPI#registerSearchDocumentProducer
 * @api private
 */
const _produceMeetingSearchDocuments = function (resources, callback) {
  _getMeetings(resources, (error, meetings) => {
    if (error) return callback([error]);
    if (isEmpty(meetings)) return callback();

    const docs = map(_produceMeetingSearchDocument, meetings);
    return callback(null, docs);
  });
};

/**
 * Gets a set of meetings.
 *
 * @param  {Object[]}   resources   An array of resources to index.
 * @param  {Function}   callback    Standard callback function
 * @api private
 */
const _getMeetings = function (resources, callback) {
  let meetings = [];
  const meetingIdsToFetch = [];

  forEach((resource) => {
    if (resource.meeting) {
      meetings.push(resource.meeting);
    } else {
      meetingIdsToFetch.push(resource.id);
    }
  }, resources);

  if (isEmpty(meetingIdsToFetch)) return callback(null, meetings);

  MeetingsDAO.getMeetingsById(meetingIdsToFetch, (error, extraMeetings) => {
    if (error) return callback(error);

    // Some meetings might have already been deleted
    extraMeetings = compact(extraMeetings);

    // Add the meetings item that came from Cassandra
    meetings = union(meetings, extraMeetings);

    return callback(null, meetings);
  });
};

/**
 * Given a meeting item, it produces an appropriate search document.
 *
 * @param  {Meeting}     meeting        The meeting item to index.
 * @return {SearchDoc}                  The produced search document.
 * @api private
 */
const _produceMeetingSearchDocument = function (meeting) {
  // Allow full-text search on name and description, but only if they are specified
  const fullText = pipe(compact, join(' '))([meeting.displayName, meeting.description]);

  // Add all properties for the resource document metadata
  const doc = {
    resourceType: MEETING,
    id: meeting.id,
    tenantAlias: meeting.tenant.alias,
    displayName: meeting.displayName,
    visibility: meeting.visibility,
    q_high: meeting.displayName, // eslint-disable-line camelcase
    q_low: fullText, // eslint-disable-line camelcase
    sort: meeting.displayName,
    dateCreated: meeting.created,
    lastModified: meeting.lastModified,
    createdBy: meeting.createdBy,
    _extra: {
      lastModified: meeting.lastModified
    }
  };

  if (meeting.description) {
    doc.description = meeting.description;
  }

  return doc;
};

SearchAPI.registerSearchDocumentProducer(MEETING_JITSI, _produceMeetingSearchDocuments);

/**
 * Document transformers
 */

/**
 * Given an array of meeting search documents, transform them into search documents suitable to be displayed to the user in context.
 *
 * @param  {Context}   ctx             Standard context object containing the current user and the current tenant
 * @param  {Object}    docs            A hash, keyed by the document id, while the value is the document to transform
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @param  {Object}    callback.docs   The transformed docs, in the same form as the `docs` parameter.
 * @api private
 */
const _transformMeetingDocuments = function (_ctx, docs, callback) {
  const transformeDocs = {};

  forEachObjIndexed((doc, docId) => {
    // Extract the extra object from the search document
    const extractExtraObject = pipe(prop(FIELDS), prop(_EXTRA), head, defaultToEmptyObject);

    // Build the transformed result document from the ElasticSearch document
    let result = { id: docId };
    forEachObjIndexed((value, name) => {
      result[name] = head(value);
    }, doc.fields);

    // Take just the `lastModified` from the extra fields, if specified
    result = mergeRight(result, pick(LAST_MODIFIED, extractExtraObject(doc)));

    // Add the full tenant object and profile path
    result = mergeRight(result, {
      tenant: TenantsAPI.getTenant(result.tenantAlias).compact(),
      profilePath: format('/meeting-jitsi/%s/%s', result.tenantAlias, AuthzUtil.getResourceFromId(result.id).resourceId)
    });

    transformeDocs[docId] = result;
  }, docs);

  return callback(null, transformeDocs);
};

SearchAPI.registerSearchDocumentTransformer(MEETING_JITSI, _transformMeetingDocuments);

/**
 * Indexing tasks
 */

/**
 * When a meeting is created, we must index it and all its potential members
 */
MeetingsAPI.emitter.on(MeetingsConstants.events.CREATED_MEETING, (_ctx, meeting, _members) => {
  SearchAPI.postIndexTask(MEETING_JITSI, [{ id: meeting.id }], {
    resource: true,
    children: {
      resource_members: true // eslint-disable-line camelcase
    }
  });
});

/**
 * When a meeting is updated, we must reindex its resource document
 */
MeetingsAPI.emitter.on(MeetingsConstants.events.UPDATED_MEETING, (_ctx, meeting, _updatedMeeting) => {
  SearchAPI.postIndexTask(MEETING_JITSI, [{ id: meeting.id }], {
    resource: true
  });
});

/**
 * When a meeting's membership is updated, we must reindex its members child document
 */
MeetingsAPI.emitter.on(MeetingsConstants.events.UPDATED_MEETING_MEMBERS, (_ctx, meeting) => {
  SearchAPI.postIndexTask(MEETING_JITSI, [{ id: meeting.id }], {
    children: {
      resource_members: true // eslint-disable-line camelcase
    }
  });
});

/**
 * When a meeting is deleted, we must cascade delete its resource document and children
 */
MeetingsAPI.emitter.on(MeetingsConstants.events.DELETED_MEETING, (_ctx, meeting) => {
  SearchAPI.postDeleteTask(meeting.id);
});

/**
 * When a message is added to a meeting, we must index the child message document
 */
MeetingsAPI.emitter.on(MeetingsConstants.events.CREATED_MEETING_MESSAGE, (_ctx, message, meeting) => {
  const resource = {
    id: meeting.id,
    messages: [message]
  };

  SearchAPI.postIndexTask(MEETING_JITSI, [resource], {
    children: {
      'meeting-jitsi_message': true
    }
  });
});

/**
 * When a meeting message is deleted, we must delete the child message document
 */
MeetingsAPI.emitter.on(MeetingsConstants.events.DELETED_MEETING_MESSAGE, (_ctx, message, meeting, _deleteType) =>
  MessageBoxSearch.deleteMessageSearchDocument(MeetingsConstants.search.MAPPING_MEETING_MESSAGE, meeting.id, message)
);

/**
 * Reindex all handler
 */

SearchAPI.registerReindexAllHandler(MEETING_JITSI, (callback) => {
  /*
   * Handles each iteration of the MeetingDAO iterate all method, firing tasks for all meetings to
   * be reindexed.
   *
   * @see MeetingDAO#iterateAll
   * @api private
   */
  const _onEach = function (meetingRows, done) {
    // Batch up this iteration of task resources
    const meetingResources = [];

    forEach((meetingRow) => {
      meetingResources.push({ id: meetingRow.id });
    }, meetingRows);

    log().info('Firing re-indexing task for %s meetings.', meetingResources.length);
    SearchAPI.postIndexTask(MEETING_JITSI, meetingResources, { resource: true, children: true });

    return done();
  };

  MeetingsDAO.iterateAll([ID], 100, _onEach, callback);
});

export { init };
