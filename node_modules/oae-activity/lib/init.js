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

const Cassandra = require('oae-util/lib/cassandra');

const ActivityAPI = require('oae-activity');
const ActivityPush = require('./internal/push');

// Register some of the default streams
// eslint-disable-next-line import/no-unassigned-import
require('./activity');

// Bind the notification event listeners
// eslint-disable-next-line import/no-unassigned-import
require('./internal/notifications');

// Bind the email event listeners
// eslint-disable-next-line import/no-unassigned-import
require('./internal/email');

module.exports = function(config, callback) {
  ensureSchema(err => {
    if (err) {
      return callback(err);
    }

    ActivityAPI.refreshConfiguration(config.activity, err => {
      if (err) {
        return callback(err);
      }

      // Configure the push notifications
      ActivityPush.init(callback);
    });
  });
};

/**
 * Ensure that the all of the activity-related schemas are created. If they already exist, this method will not do anything.
 *
 * @param  {Function}    callback       Standard callback function
 * @param  {Object}      callback.err   An error that occurred, if any
 * @api private
 */
const ensureSchema = function(callback) {
  Cassandra.createColumnFamilies(
    {
      ActivityStreams:
        'CREATE TABLE "ActivityStreams" ("activityStreamId" text, "activityId" text, "activity" text, PRIMARY KEY ("activityStreamId", "activityId")) WITH COMPACT STORAGE',
      EmailBuckets:
        'CREATE TABLE "EmailBuckets" ("bucketId" text, "userId" text, PRIMARY KEY ("bucketId", "userId"))'
    },
    callback
  );
};
