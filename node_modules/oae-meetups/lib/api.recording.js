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

 var _ = require('underscore');

 var ContentAPI = require('oae-content/lib/api');

 var MeetupsDAO = require('./internal/dao');
 var BBBProxy = require('./internal/proxy');

 /**
  * @function createRecording
  * @param  {Context} ctx              Oae-context object
  * @param  {Object} decoded           Object containing decoded video info
  * @param  {Object} groupProfile      Object containing group settings
  * @param  {Recording[]} recordings   Array of recordings
  * @param  {Function} callback        Standard callback function
  * @return {type} {description}
  */
 var createRecording = function(ctx, decoded, groupProfile, recordings, callback) {
     // get the meeting info
     BBBProxy.executeBBBCall(recordings.url, function(err, recordingsInfo) {
         if(recordingsInfo && recordingsInfo.returncode === 'SUCCESS' && recordingsInfo.recordings) {
             var recordings = recordingsInfo.recordings.recording;
             var members = {};
             members[groupProfile.id] = 'viewer';

             // make sure recordings is an array before proceeding
             recordings = [recordings];

             // retrieve the recording with the highest start time
             var recordingMaxTime = _.max(recordings, function(recording) {
                return parseInt(recording.startTime);
             });


             var date = new Date(parseInt(recordingMaxTime.endTime));
             var link = recordingMaxTime.playback.format[0] ? recordingMaxTime.playback.format[0].url : recordingMaxTime.playback.format.url;
             MeetupsDAO.getRecordingById(decoded.record_id, function (err, recording) {
                 if (err) {
                     log().error;
                 } else if (!recording) {
                     ContentAPI.createLink(ctx, groupProfile.displayName + " - " + date.toString(), 'description', 'private', link, members, [], function(err, contentObj) {
                         if (err) {
                             log().error;
                         } else if (contentObj) {
                             MeetupsDAO.createRecording(decoded.record_id, contentObj.id, ctx.user().id, callback);
                         }
                     });
                 }
                 //do nothing if recording
             });
         }
     });
 };

 /**
  * @function deleteRecording
  * @param  {Object} recordingsInfo   Object containing recording info
  * @param  {String} recordingId      Id of recording to delete
  * @param  {Function} callback       Standard callback function
  */
 var deleteRecording = function(recordingsInfo, recordingId, callback) {
     // delete recordings from BBB server
     BBBProxy.executeBBBCall(recordingsInfo.url, function(err, recordingsInfo) {
         if(recordingsInfo && recordingsInfo.returncode === 'SUCCESS') {
             //delete the recording from Cassandra
             MeetupsDAO.deleteRecording(recordingId, function(err) {
                 if (err) {
                     log().error;
                     return callback(err);
                 }

                 return callback(null);
             });
         } else if(err) {
             log().info(recordingsInfo ? recordingsInfo.returncode : 'Failed to retrieve recording info');
             return callback(err);
         }
     });
 };

 module.exports = {
     'createRecording': createRecording,
     'deleteRecording': deleteRecording,
 };

