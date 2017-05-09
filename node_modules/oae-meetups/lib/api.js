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

var EmitterAPI = require('oae-emitter');

/**
 * ### Events
 *
 * The `MeetingsAPI`, as enumerated in `MeetingsConstants.events`, emits the following events:
 *
 * * `createdMeeting(ctx, meeting, members)`: A new meeting was created.
 * * `createdMeetingMessage(ctx, message, meeting)`: A new message was posted to a meeting.
 * * `deletedMeeting(ctx, meeting)`: A meeting has been deleted.
 * * `deletedMeetingMessage(ctx, message, meeting, deleteType)`: A message was removed from a meeting.
 * * `getMeetingLibrary(ctx, principalId, visibility, start, limit, meetings)`: A meeting library was retrieved.
 * * `getMeetingProfile(ctx, meeting)`: A meeting profile was retrieved.
 * * `updatedMeeting(ctx, oldMeeting, newMeeting)`: An existing meeting's metadata has been updated.
 * * `updatedMeetingMembers(ctx, meeting, memberUpdates, newMemberIds, updatedMemberIds, removedMemberIds)`: The members and/or managers for a meeting have been altered.
 */
var MeetupsAPI = module.exports = new EmitterAPI.EventEmitter();

module.exports.Meetups = require('./api.meetups');
module.exports.Bbb = require('./api.bbb');
