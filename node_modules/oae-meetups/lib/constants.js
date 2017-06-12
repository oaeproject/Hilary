/*!
 * Copyright 2017 Apereo Foundation (AF) Licensed under the
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

 var roles = {
     // Determines not only all known roles, but the ordered priority they take as the "effective" role. (e.g., if
     // you are both a member and a manager, your effective role is "manager", so it must be later in the list)
     'ALL_PRIORITY': ['member', 'manager'],

     'MANAGER': 'manager',
     'MEMBER': 'member'
 };

 var events = {
     'JOIN_MEETUP': 'joinMeetup',
     'CLOSE_MEETUP': 'closeMeetup',
     'END_MEETUP': 'endMeetup'
 };

 var activity = {
     'ACTIVITY_MEETUP_JOIN': 'meetup-join',
     'ACTIVITY_MEETUP_CLOSE': 'meetup-close',
     'ACTIVITY_MEETUP_END': 'meetup-end'
 };

var search = {
    'MAPPING_MEETING_MESSAGE': 'meeting_message'
};

var resourceTypes = {
    'MEETUP': 'meetup',
    'RECORDING': 'recording'
}

module.exports = {
  'roles' : roles,
  'events' : events,
  'activity' : activity,
  'search' : search,
  'resourceTypes' : resourceTypes
}
