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

import _ from 'underscore';

import { logger } from 'oae-logger';

import * as AuthzAPI from 'oae-authz';
import * as LibraryAPI from 'oae-library';
import * as MeetingsAPI from 'oae-jitsi';
import * as MeetingsDAO from 'oae-jitsi/lib/internal/dao.js';

import { MeetingsConstants } from 'oae-jitsi/lib/constants.js';

const log = logger('meetings-jitsi-library');

/**
 * Register a library indexer that can provide resources to reindex the meeting library
 */
LibraryAPI.Index.registerLibraryIndex(MeetingsConstants.library.MEETINGS_LIBRARY_INDEX_NAME, {
  pageResources(libraryId, start, limit, callback) {
    // Query all the meeting ids ('m') to which the library owner is directly associated
    AuthzAPI.getRolesForPrincipalAndResourceType(libraryId, 'm', start, limit, (error, roles, nextToken) => {
      if (error) {
        return callback(error);
      }

      const ids = _.pluck(roles, 'id');

      MeetingsDAO.getMeetingsById(ids, (error, meetings) => {
        if (error) {
          return callback(error);
        }

        // Convert all the meetings into the light-weight library items that describe how its placed in a library index
        const resources = _.chain(meetings)
          .compact()
          .map((meeting) => ({ rank: meeting.lastModified, resource: meeting }))
          .value();

        return callback(null, resources, nextToken);
      });
    });
  }
});

/**
 * Configure the meeting library search endpoint
 */
LibraryAPI.Search.registerLibrarySearch('meeting-jitsi-library', ['meeting-jitsi']);

/**
 * When a meeting is created, add the meeting to the member meeting library
 */
MeetingsAPI.emitter.when(MeetingsConstants.events.CREATED_MEETING, (ctx, meeting, memberChangeInfo, callback) => {
  const addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
  _insertLibrary(addedMemberIds, meeting, (error) => {
    if (error) {
      log().warn(
        {
          err: error,
          meetingId: meeting.id,
          memberIds: addedMemberIds
        },
        'An error occurred inserting meeting into meeting libraries after create'
      );
    }

    return callback();
  });
});

/**
 * When a meeting is updated, update all meeting libraries with its updated last modified
 */
MeetingsAPI.emitter.on(MeetingsConstants.events.UPDATED_MEETING, (ctx, updatedMeeting, oldMeeting) => {
  // Get all the member ids of the updated meeting
  _getAllMemberIds(updatedMeeting.id, (error, memberIds) => {
    if (error) {
      return error;
    }

    // Perform the libraries updates
    return _updateLibrary(memberIds, updatedMeeting, oldMeeting.lastModified);
  });
});

/**
 * When a meeting is deleted, remove it from all the meeting libraries
 */
MeetingsAPI.emitter.when(MeetingsConstants.events.DELETED_MEETING, (ctx, meeting, removedMemberIds, callback) => {
  // Remove the meeting from all libraries
  _removeFromLibrary(removedMemberIds, meeting, (error) => {
    if (error) {
      log().warn(
        {
          err: error,
          meetingId: meeting.id,
          memberIds: removedMemberIds
        },
        'An error occurred while removing a deleted meeting from all meeting libraries'
      );
    }

    return callback();
  });
});

/**
 * When meeting members are updated, pass the required updated to its members library
 */
MeetingsAPI.emitter.when(
  MeetingsConstants.events.UPDATED_MEETING_MEMBERS,
  (ctx, meeting, memberChangeInfo, options, callback) => {
    const oldLastModified = meeting.lastModified;

    const addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
    const updatedMemberIds = _.pluck(memberChangeInfo.members.updated, 'id');
    const removedMemberIds = _.pluck(memberChangeInfo.members.removed, 'id');

    // Remove the meeting item from the removed members libraries
    _removeFromLibrary(removedMemberIds, meeting, (error) => {
      if (error) {
        log().warn(
          {
            err: error,
            principalIds: removedMemberIds,
            meetingId: meeting.id
          },
          'Error removing meeting from principal libraries. Ignoring.'
        );
      }

      if (_.isEmpty(updatedMemberIds) && _.isEmpty(addedMemberIds)) {
        return callback();
      }

      // Update the last modified time of the meeting
      _touch(meeting, (error, touchedMeeting) => {
        if (error) {
          log().warn(
            {
              err: error,
              principalIds: removedMemberIds,
              meetingId: meeting.id
            },
            'Error updating meeting last modified date. Ignoring.'
          );
        }

        meeting = touchedMeeting || meeting;

        // Update the meeting rank in the members libraries
        const libraryUpdateIds = _.chain(memberChangeInfo.roles.before).keys().difference(removedMemberIds).value();
        _updateLibrary(libraryUpdateIds, meeting, oldLastModified, (error) => {
          if (error) {
            log().warn(
              {
                err: error,
                principalIds: libraryUpdateIds,
                meetingId: meeting.id
              },
              'Error updating the library index for these users. Ignoring.'
            );
          }

          // Add the meeting item to the added members libraries
          _insertLibrary(addedMemberIds, meeting, (error) => {
            if (error) {
              log().warn(
                {
                  err: error,
                  principalIds: addedMemberIds,
                  meetingIds: meeting.id
                },
                'Error inserting the meeting into new member libraries while adding members. Ignoring.'
              );
            }

            return callback();
          });
        });
      });
    });
  }
);

/**
 * PRIVATE FUNCTIONS
 */

/**
 * Insert a meeting into the meeting libraries of the specified principals
 *
 * @param  {String[]}   principalIds    The ids of the principals whose libraries to update
 * @param  {Meeting}    meeting         The meeting to insert
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _insertLibrary = function (principalIds, meeting, callback) {
  if (_.isEmpty(principalIds) || !meeting) {
    return callback();
  }

  const entries = _.map(principalIds, (principalId) => ({
    id: principalId,
    rank: meeting.lastModified,
    resource: meeting
  }));

  LibraryAPI.Index.insert(MeetingsConstants.library.MEETINGS_LIBRARY_INDEX_NAME, entries, callback);
};

/**
 * Get all the ids of the principals that are members for the specified meeting.
 *
 * @param  {String}     meetingId           The id of the meeting whose member ids to fetch
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String[]}   callback.memberIds  The member ids associated to the meeting
 * @api private
 */
const _getAllMemberIds = function (meetingId, callback) {
  AuthzAPI.getAllAuthzMembers(meetingId, (error, memberIdRoles) => {
    if (error) {
      return callback(error);
    }

    // Return only the ids
    return callback(null, _.pluck(memberIdRoles, 'id'));
  });
};

/**
 * Update a meeting in the meeting libraries of the specified principals
 *
 * @param  {String[]}   principalIds    The ids of the principals whose libraries to update
 * @param  {Meeting}    meeting         The meeting to insert
 * @param  {String}     oldLastModified The meeting record associated to this last-modified timestamp will be removed in favour of the updated one
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _updateLibrary = function (principalIds, meeting, oldLastModified, callback) {
  callback =
    callback ||
    function (error) {
      if (error) {
        log().error(
          {
            err: error,
            principalIds,
            meetingId: meeting.id
          },
          'Error updating meeting for principal libraries'
        );
      }
    };

  if (_.isEmpty(principalIds) || !meeting) {
    return callback();
  }

  const entries = _.map(principalIds, (principalId) => ({
    id: principalId,
    oldRank: oldLastModified,
    newRank: meeting.lastModified,
    resource: meeting
  }));

  LibraryAPI.Index.update(MeetingsConstants.library.MEETINGS_LIBRARY_INDEX_NAME, entries, callback);
};

/**
 * Delete a meeting in the meeting libraries of the specified principals
 *
 * @param  {String[]}   principalIds    The ids of the principals whose libraries to update
 * @param  {Meeting}    meeting         The meeting to remove
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _removeFromLibrary = function (principalIds, meeting, callback) {
  if (_.isEmpty(principalIds) || !meeting) {
    return callback();
  }

  const entries = _.map(principalIds, (principalId) => ({
    id: principalId,
    rank: meeting.lastModified,
    resource: meeting
  }));

  LibraryAPI.Index.remove(MeetingsConstants.library.MEETINGS_LIBRARY_INDEX_NAME, entries, callback);
};

/**
 * Perform a "touch" on a meeting, which updates only the lastModified date of the meeting
 *
 * @param  {Meeting}    meeting              The meeting object to update
 * @param  {Function}   callback             Standard callback function
 * @param  {Object}     callback.err         An error that occurred, if any
 * @param  {Meeting}    [callback.meeting]   The meeting object with the new lastModified date. If not specified, then the meeting was not updated due to rate-limiting.
 * @api private
 */
const _touch = function (meeting, callback) {
  MeetingsDAO.updateMeeting(meeting, { lastModified: Date.now() }, callback);
};
