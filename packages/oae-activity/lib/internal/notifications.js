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

import { pipe, keys, length, equals } from 'ramda';
import Counter from 'oae-util/lib/counter.js';
import { logger } from 'oae-logger';
import { PrincipalsConstants } from 'oae-principals/lib/constants.js';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao.js';

import { ActivityConstants } from 'oae-activity/lib/constants.js';
import * as ActivityUtil from 'oae-activity/lib/util.js';
import ActivityEmitter from './emitter.js';

import * as ActivityDAO from './dao.js';
import * as ActivityAggregator from './aggregator.js';

const log = logger('oae-activity-notifications');

const isZero = equals(0);

/**
 * Tracks the handling of notifications for synchronization to determine when there are no notifications being processed
 */
const notificationsCounter = new Counter();

/*!
 * When a batch of activities are delivered, we check if there are any notifications in there and
 * increment all the target user notification counters.
 */
ActivityEmitter.on(ActivityConstants.events.DELIVERED_ACTIVITIES, (deliveredActivityInfos) => {
  // Figure out by how much to increment user notifications, if at all
  const userIdsIncrBy = {};
  _.each(deliveredActivityInfos, (streams, resourceId) => {
    _.each(streams, (activityInfo, streamType) => {
      if (streamType === 'notification') {
        userIdsIncrBy[resourceId] = userIdsIncrBy[resourceId] || 0;
        userIdsIncrBy[resourceId] += activityInfo.numNewActivities;
      }
    });
  });

  // Keep track of the async operation
  notificationsCounter.incr();

  // All users receiving notifications will have their "notifications unread" counter incremented
  incrementNotificationsUnread(userIdsIncrBy, (error) => {
    if (error) {
      log().error({ err: new Error(error.msg), userIdsIncrBy }, 'Could not mark notifications as unread');
    }

    // Our async operation is over, decrement the counter
    notificationsCounter.decr();
  });
});

/**
 * Marks all notifications as read for a given user.
 *
 * @param  {User}       user                    The user object for which the notifications should be marked as read
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Number}     callback.lastReadTime   The timestamp (millis since epoch) that was persisted as the time at which the notifications were last read
 */
const markNotificationsRead = function (user, callback) {
  // In addition to the notification count, the lastReadTime will help determine which of the notifications are
  // new and which are not.
  const lastReadTime = Date.now();
  const profileFields = {
    notificationsUnread: '0',
    notificationsLastRead: lastReadTime.toString()
  };

  // Clear all the notifications unread to 0
  ActivityDAO.clearNotificationsUnreadCount(user.id, (error) => {
    if (error) return callback(error);

    // Update the notifications values in the basic profile
    PrincipalsDAO.updatePrincipal(user.id, profileFields, (error) => {
      if (error) return callback(error);

      /**
       * We can return here as resetting the activity aggregation and removing the
       * activities from the email activity stream can happen asynchronously
       */
      callback(null, lastReadTime);

      /**
       * Reset the aggregator for this user his notification stream. New notifications will not aggregate
       * with older notifications which will make it clearer to the user which activity is the new one
       */
      const notificationActivityStreamId = ActivityUtil.createActivityStreamId(user.id, 'notification');
      ActivityAggregator.resetAggregationForActivityStreams([notificationActivityStreamId]);

      // By clearing a user's email activity stream when he marks his notifications as read,
      // we avoid sending out a (potential) unnecessary email. This only happens when the user
      // marks his notifications as read between the activity ocurring and the time the email would've gone out
      if (user.emailPreference === PrincipalsConstants.emailPreferences.IMMEDIATE) {
        const emailActivityStreamId = ActivityUtil.createActivityStreamId(user.id, 'email');
        ActivityDAO.clearActivityStream(emailActivityStreamId, (error) => {
          if (error) {
            log().warn({ err: error }, 'Could not clear the email activity stream');
          }
        });
      }
    });
  });
};

/**
 * Increment the notifications unread count for the given user ids.
 *
 * @param  {Object}     userIdIncrs         An object keyed by user id, whose value is the number by which to increment the count
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const incrementNotificationsUnread = function (userIdIncrs, callback) {
  /*!
   * First update the cached new notification counts, then update Cassandra. Some very clear drawbacks here but
   * are considered acceptable:
   *
   *  1.  If 2 nodes increment and then persist to cassandra, and the first incr wins into cassandra, counts are
   *      off by 1. The next time a notification comes around it will be fixed.
   *  2.  If Redis is completely flushed or crashes with no disk storage, kiss all your counts good-bye. Will not
   *      become accurate again for a user until they "mark as read".
   */
  ActivityDAO.incrementNotificationsUnreadCounts(userIdIncrs, (error, newValues) => {
    if (error) return callback(error);

    let todo = pipe(keys, length)(newValues);
    let complete = false;

    if (isZero(todo)) {
      return callback();
    }

    /*!
     * Determines when the process of updating all principal counts in cassandra is complete.
     *
     * @param  {Object}     err     An error that occurred, if any.
     */
    const _monitorUpdatePrincipal = function (error) {
      if (complete) {
        // Nothing to do.
      } else if (error) {
        complete = true;
        return callback(error);
      } else {
        todo--;
        if (isZero(todo)) {
          complete = true;
          return callback();
        }
      }
    };

    // Update all principal profiles with the new count
    _.each(newValues, (newValue, userId) => {
      PrincipalsDAO.updatePrincipal(userId, { notificationsUnread: newValue.toString() }, _monitorUpdatePrincipal);
    });
  });
};

/**
 * Perform an action when the notifications queue becomes empty. This is useful to determine when the notifications
 * are no longer processing, for purposes of gracefully stopping the server or synchronization of processing for
 * tests.
 *
 * @param  {Function}   handler     The function to invoke when there are 0 notifications being processed
 */
const whenNotificationsEmpty = function (handler) {
  notificationsCounter.whenZero(handler);
};

export { markNotificationsRead, incrementNotificationsUnread, whenNotificationsEmpty };
