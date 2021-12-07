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

import { promisify, callbackify } from 'node:util';
import { head, isEmpty, forEach, map, pipe, prop, defaultTo, mergeAll, mergeRight } from 'ramda';
import ShortId from 'shortid';
import { Meeting } from 'oae-jitsi/lib/model.js';

import { getPrincipalFromId, toId } from 'oae-authz/lib/util.js';
import { iterateAll as iterateResults, rowToHash, constructUpsertCQL, runQuery } from 'oae-util/lib/cassandra.js';
import { getNumberParam as toNumber } from 'oae-util/lib/util.js';
import { getTenant } from 'oae-tenants';

const LAST_MODIFIED = 'lastModified';
const MEETINGS_TABLE = 'MeetingsJitsi';
const ID = 'id';
const MEETING_SYMBOL = 'm';

/**
 * PUBLIC FUNCTIONS
 */

/**
 * Create a new meeting.
 */
const createMeeting = function (createdBy, displayName, description, chat, contactList, visibility, callback) {
  const created = Date.now().toString();
  const { tenantAlias } = getPrincipalFromId(createdBy);
  const meetingId = _createMeetingId(tenantAlias);

  const storageHash = {
    tenantAlias,
    createdBy,
    displayName,
    description,
    chat,
    contactList,
    visibility,
    created,
    lastModified: created
  };

  const query = constructUpsertCQL(MEETINGS_TABLE, ID, meetingId, storageHash);
  callbackify(runQuery)(query.query, query.parameters, (error) => {
    if (error) return callback(error);

    return callback(null, _storageHashToMeeting(meetingId, storageHash));
  });
};

/**
 * Get a meeting data.
 */
const getMeeting = function (meetingId, callback) {
  getMeetingsById([meetingId], (error, meetings) => {
    if (error) return callback(error);

    return callback(null, head(meetings));
  });
};

/**
 * Get multiple meetings by their ids
 *
 * @param  {String[]}       meetingIds              The ids of the meetings to get
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Meeting[]}      callback.meetings       The meeting objects requested, in the same order as the meeting ids
 */
const getMeetingsById = function (meetingIds, callback) {
  if (isEmpty(meetingIds)) return callback(null, []);

  const query = 'SELECT * FROM "MeetingsJitsi" WHERE "id" in ?';
  // Create a copy of the meetingIds array, otherwise the runQuery function will empty it
  const parameters = [];
  parameters.push(meetingIds);

  callbackify(runQuery)(query, parameters, (error, rows) => {
    if (error) return callback(error);

    // Convert the retrieved storage hashes into the Meeting model
    const meetings = {};
    pipe(
      map(rowToHash),
      forEach((row) => {
        meetings[row.id] = _storageHashToMeeting(row.id, row);
      })
    )(rows);

    // Order the meetings according to the array of meetings ids
    const orderedMeetings = map((meetingId) => meetings[meetingId], meetingIds);

    return callback(null, orderedMeetings);
  });
};

/**
 * Update a meeting's metadata
 *
 * @param {any} meeting
 * @param {any} profileFields
 * @param {any} callback
 */
const updateMeeting = function (meeting, profileFields, callback) {
  const storageHash = mergeAll([{}, profileFields]);
  const defaultToNow = defaultTo(Date.now());

  storageHash.lastModified = pipe(prop(LAST_MODIFIED), defaultToNow, toString)(storageHash);
  const query = constructUpsertCQL(MEETINGS_TABLE, ID, meeting.id, storageHash);

  callbackify(runQuery)(query.query, query.parameters, (error) => {
    if (error) return callback(error);

    return callback(null, _createUpdatedMeetingFromStorageHash(meeting, storageHash));
  });
};

/**
 * Delete a meeting
 * This does not remove the meeting from its members's libraries.
 *
 * @param {String}      meetingId           The id of the meeting to delete
 * @param {Function}    callback            Standard callback function
 * @param {Object}      callback.err        An error that occured, if any
 */
const deleteMeeting = function (meetingId, callback) {
  callbackify(runQuery)('DELETE FROM "MeetingsJitsi" WHERE id = ?', [meetingId], callback);
};

/**
 * Iterate through all the meetings. This will return just the raw meeting properties that are specified in the `properties`
 * parameter, and only `batchSize` meetings at a time. On each iteration of `batchSize` meetings, the `onEach` callback
 * will be invoked, and the next batch will not be fetched until you have invoked the `onEach.done` function parameter. When
 * complete (e.g., there are 0 meetings left to iterate through or an error has occurred), the `callback` parameter will be
 * invoked.
 *
 * @param  {String[]}   [properties]            The names of the meeting properties to return in the meeting objects. If not specified (or is empty array), it returns just the `meetingId`s
 * @param  {Number}     [batchSize]             The number of meetings to fetch at a time. Defaults to 100
 * @param  {Function}   onEach                  Invoked with each batch of meetings that are fetched from storage
 * @param  {Object[]}   onEach.meetingRows      An array of objects holding the raw meeting rows that were fetched from storage
 * @param  {Function}   onEach.done             The function to invoke when processing of the current batch is complete
 * @param  {Object}     onEach.done.err         An error that occurred, if any, while processing the current batch. If you specify this error, iteration will finish and the completion callback will be invoked
 * @param  {Function}   [callback]              Invoked when all rows have been iterated, or an error has occurred
 * @param  {Object}     [callback.err]          An error that occurred, while iterating rows, if any
 * @see Cassandra#iterateAll
 */
const iterateAll = function (properties, batchSize, onEach, callback) {
  if (isEmpty(properties)) {
    properties = [ID];
  }

  /*
   * Handles each batch from the cassandra iterateAll method
   *
   * @see Cassandra#iterateAll
   */
  const _iterateAllOnEach = function (rows, done) {
    // Convert the rows to a hash and delegate action to the caller onEach method
    return onEach(map(rowToHash, rows), done);
  };

  callbackify(iterateResults)(properties, MEETINGS_TABLE, ID, { batchSize }, promisify(_iterateAllOnEach), callback);
};

/**
 * PRIVATE FUNCTIONS
 */

/**
 * Generate a new unique meeting id
 *
 * @param {any} tenantAlias
 * @returns
 */
const _createMeetingId = function (tenantAlias) {
  return toId(MEETING_SYMBOL, tenantAlias, ShortId.generate());
};

/**
 * Create a meeting model object from its id and the storage hash
 *
 * @param {any} id        The meeting Id
 * @param {any} hash
 * @returns
 */
const _storageHashToMeeting = function (id, hash) {
  const { tenantAlias, created, chat, createdBy, contactList, description, displayName, visibility, lastModified } =
    hash;
  return new Meeting(getTenant(tenantAlias), {
    id,
    createdBy,
    displayName,
    description,
    chat,
    contactList,
    visibility,
    created: toNumber(created),
    lastModified: toNumber(lastModified)
  });
};

/**
 * Create an updated meeting object from the provided one, with updates from the provided storage hash
 *
 * @param {any} meeting
 * @param {any} hash
 * @returns
 */
const _createUpdatedMeetingFromStorageHash = function (meeting, hash) {
  /**
   * Chat and contactList are boolean values, we can make the same processing
   * with them as we do for the other string variables
   * description can be an empty string, same remark
   */
  meeting = mergeRight(meeting, hash);
  const { id, created, chat, createdBy, contactList, description, displayName, visibility, lastModified } = meeting;

  return new Meeting(meeting.tenant, {
    id,
    createdBy,
    displayName,
    description,
    chat,
    contactList,
    visibility,
    created: toNumber(created),
    lastModified: toNumber(lastModified)
  });
};

export { createMeeting, getMeeting, getMeetingsById, updateMeeting, deleteMeeting, iterateAll };
