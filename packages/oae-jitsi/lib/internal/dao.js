import _ from 'underscore';
import ShortId from 'shortid';
import { Meeting } from 'oae-jitsi/lib/model';

import * as AuthzUtil from 'oae-authz/lib/util';
import * as Cassandra from 'oae-util/lib/cassandra';
import * as OaeUtil from 'oae-util/lib/util';
import * as TenantsAPI from 'oae-tenants';

/**
 * PUBLIC FUNCTIONS
 */

/**
 * Create a new meeting.
 */
const createMeeting = function(createdBy, displayName, description, chat, contactList, visibility, callback) {
  const created = Date.now().toString();

  const { tenantAlias } = AuthzUtil.getPrincipalFromId(createdBy);
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

  const query = Cassandra.constructUpsertCQL('MeetingsJitsi', 'id', meetingId, storageHash);
  Cassandra.runQuery(query.query, query.parameters, err => {
    if (err) {
      return callback(err);
    }

    return callback(null, _storageHashToMeeting(meetingId, storageHash));
  });
};

/**
 * Get a meeting data.
 */
const getMeeting = function(meetingId, callback) {
  getMeetingsById([meetingId], (err, meetings) => {
    if (err) {
      return callback(err);
    }

    return callback(null, meetings[0]);
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
const getMeetingsById = function(meetingIds, callback) {
  if (_.isEmpty(meetingIds)) {
    return callback(null, []);
  }

  const query = 'SELECT * FROM "MeetingsJitsi" WHERE "id" in ?';
  // Create a copy of the meetingIds array, otherwise the runQuery function will empty it
  const parameters = [];
  parameters.push(meetingIds);

  Cassandra.runQuery(query, parameters, (err, rows) => {
    if (err) {
      return callback(err);
    }

    // Convert the retrieved storage hashes into the Meeting model
    const meetings = {};
    _.chain(rows)
      .map(Cassandra.rowToHash)
      .each(row => {
        meetings[row.id] = _storageHashToMeeting(row.id, row);
      });

    // Order the meetings according to the array of meetings ids
    const orderedMeetings = _.map(meetingIds, meetingId => {
      return meetings[meetingId];
    });

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
const updateMeeting = function(meeting, profileFields, callback) {
  const storageHash = _.extend({}, profileFields);
  storageHash.lastModified = storageHash.lastModified || Date.now();
  storageHash.lastModified = storageHash.lastModified.toString();

  const query = Cassandra.constructUpsertCQL('MeetingsJitsi', 'id', meeting.id, storageHash);
  Cassandra.runQuery(query.query, query.parameters, err => {
    if (err) {
      return callback(err);
    }

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
const deleteMeeting = function(meetingId, callback) {
  Cassandra.runQuery('DELETE FROM "MeetingsJitsi" WHERE id = ?', [meetingId], callback);
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
const iterateAll = function(properties, batchSize, onEach, callback) {
  if (_.isEmpty(properties)) {
    properties = ['id'];
  }

  /*
   * Handles each batch from the cassandra iterateAll method
   *
   * @see Cassandra#iterateAll
   */
  const _iterateAllOnEach = function(rows, done) {
    // Convert the rows to a hash and delegate action to the caller onEach method
    return onEach(_.map(rows, Cassandra.rowToHash), done);
  };

  Cassandra.iterateAll(properties, 'MeetingsJitsi', 'id', { batchSize }, _iterateAllOnEach, callback);
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
const _createMeetingId = function(tenantAlias) {
  return AuthzUtil.toId('m', tenantAlias, ShortId.generate());
};

/**
 * Create a meeting model object from its id and the storage hash
 *
 * @param {any} meetingId
 * @param {any} hash
 * @returns
 */
const _storageHashToMeeting = function(meetingId, hash) {
  return new Meeting(
    TenantsAPI.getTenant(hash.tenantAlias),
    meetingId,
    hash.createdBy,
    hash.displayName,
    hash.description,
    hash.chat,
    hash.contactList,
    hash.visibility,
    OaeUtil.getNumberParam(hash.created),
    OaeUtil.getNumberParam(hash.lastModified)
  );
};

/**
 * Create an updated meeting object from the provided one, with updates from the provided storage hash
 *
 * @param {any} meeting
 * @param {any} hash
 * @returns
 */
const _createUpdatedMeetingFromStorageHash = function(meeting, hash) {
  // Chat and contactList are boolean values, we can make the same processing
  // with them as we do for the other string variables
  // description can be an empty string, same remark
  let chat = null;
  let contactList = null;
  let description = null;

  if (typeof hash.chat === 'undefined') {
    chat = meeting.chat;
  } else {
    chat = hash.chat;
  }

  if (typeof hash.contactList === 'undefined') {
    contactList = meeting.contactList;
  } else {
    contactList = hash.contactList;
  }

  if (typeof hash.description === 'undefined') {
    description = meeting.description;
  } else {
    description = hash.description;
  }

  return new Meeting(
    meeting.tenant,
    meeting.id,
    meeting.createdBy,
    hash.displayName || meeting.displayName,
    description,
    chat,
    contactList,
    hash.visibility || meeting.visibility,
    OaeUtil.getNumberParam(meeting.created),
    OaeUtil.getNumberParam(hash.lastModified || meeting.lastModified)
  );
};

export { createMeeting, getMeeting, getMeetingsById, updateMeeting, deleteMeeting, iterateAll };
