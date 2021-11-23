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

import assert from 'node:assert';
import { callbackify, format } from 'node:util';
import _ from 'underscore';

import * as ActivityAggregator from 'oae-activity/lib/internal/aggregator.js';
import * as ActivityEmail from 'oae-activity/lib/internal/email.js';
import * as ActivityNotifications from 'oae-activity/lib/internal/notifications.js';
import * as Cassandra from 'oae-util/lib/cassandra.js';
import * as MqTestsUtil from 'oae-util/lib/test/mq-util.js';
import * as EmailAPI from 'oae-email';

import { ActivityConstants } from 'oae-activity/lib/constants.js';

/**
 * Send and return a single email message.
 * This helper utility will ensure that the activity / notifications queue
 * is cleaned out to avoid a different email being triggered and the wrong message being inspected.
 *
 * For parameters, @see EmailAPI#sendEmail
 */
const sendEmail = function (templateModule, templateId, toUser, data, options, callback) {
  // Wait for all pending activities to fire, be collected, and then for all associated notifications to complete. This
  // is to avoid any notifications from other tests firing the debugSent event, which will result in us returning the
  // wrong message here.
  MqTestsUtil.whenTasksEmpty(ActivityConstants.mq.TASK_ACTIVITY, () => {
    MqTestsUtil.whenTasksEmpty(ActivityConstants.mq.TASK_ACTIVITY_PROCESSING, () => {
      ActivityAggregator.collectAllBuckets(() => {
        ActivityNotifications.whenNotificationsEmpty(() => {
          // Send the email, and return the error if one occurs, otherwise the message will be returned
          EmailAPI.sendEmail(templateModule, templateId, toUser, data, options, (error, info) => {
            if (error) return callback(error);

            callback(null, info);
          });
        });
      });
    });
  });
};

/**
 * Start collecting email, providing the ability to stop and retrieved collected
 * emails during the collecting period.
 *
 * @param  {Function}   startCallback                               Invoked when collection has started
 * @param  {Function}   startCallback.stop                          The function to invoke when you wish to stop collecting email
 * @param  {Function}   startCallback.stop.stopCallback             Invoked when collection has stopped
 * @param  {Object[]}   startCallback.stop.stopCallback.messages    The messages that were collected during the collection time
 */
const startCollectingEmail = function (startCallback) {
  // Start by ensuring we don't get emails that started before this collection
  // period
  collectAndFetchAllEmails(() => {
    // Start collecting any new emails

    const messages = [];

    /*!
     * Handle the debugSent event, filling up the messages array with the
     * messages we receive
     */
    const _handleDebugSent = function (info) {
      messages.push(JSON.parse(info.message));
    };

    // Handler that simply collects the messages that are sent in this collection cycle into an array
    EmailAPI.emitter.on('debugSent', _handleDebugSent);

    // Invoke the consumers start callback, providing them the stop function
    // they can invoke to get the collected messages
    startCallback((stopCallback) => {
      // When the consumer invokes the stop callback, we need to make sure
      // all asyncronous processing completes to make sure we got all
      // messages sent in this time
      collectAndFetchAllEmails(() => {
        // Finally remove our listener and return the collected messages
        // to the consumer
        EmailAPI.emitter.removeListener('debugSent', _handleDebugSent);
        return stopCallback(messages);
      });
    });
  });
};

/**
 * Continuously poll for email until at least one shows up in the queue
 *
 * @param  {Function}   callback            Invoked when an email has arrived
 * @param  {Object[]}   callback.messages   The array of mails that were sent out
 */
const waitForEmail = function (callback) {
  collectAndFetchAllEmails((messages) => {
    if (!_.isEmpty(messages)) {
      return callback(messages);
    }

    return setTimeout(waitForEmail, 100, callback);
  });
};

/**
 * Collect the queued activities and fetch the emails that come out of it
 *
 * @param  {Function}   callback            Standard callback function
 * @param  {Object[]}   callback.messages   An array of mails that were sent out
 */
const collectAndFetchAllEmails = function (callback) {
  const messages = [];

  // Ensure no notifications from other tests are still processing
  MqTestsUtil.whenTasksEmpty(ActivityConstants.mq.TASK_ACTIVITY, () => {
    MqTestsUtil.whenTasksEmpty(ActivityConstants.mq.TASK_ACTIVITY_PROCESSING, () => {
      ActivityNotifications.whenNotificationsEmpty(() => {
        // Wait for any message that was sent to finish its asynchronous work
        EmailAPI.whenAllEmailsSent(() => {
          /*!
           * Handle the debugSent event, filling up the messages array with the messages we receive
           */
          const _handleDebugSent = function (info) {
            messages.push(JSON.parse(info.message));
          };

          /**
           * Handler that simply collects the messages that are sent in this collection
           * cycle into an array
           */
          EmailAPI.emitter.on('debugSent', _handleDebugSent);

          // Collect the activity buckets, which will aggregate any pending activities into the proper email activity streams
          ActivityAggregator.collectAllBuckets(() => {
            // Ensure all scheduling of email delivery has been completed
            ActivityEmail.whenEmailsScheduled(() => {
              // Collect and send the emails
              ActivityEmail.collectAllBuckets(() => {
                // Wait for any message that was sent to finish its asynchronous
                // work
                EmailAPI.whenAllEmailsSent(() => {
                  EmailAPI.emitter.removeListener('debugSent', _handleDebugSent);

                  // SMTP specifications have a requirement that no line in an email body
                  // should surpass 999 characters, including the CR+LF character. This check
                  // ensures no email has an html content line longer than 500 chars, which
                  // accounts for post-processing things such as SendGrid changing the links
                  // to extremely long values (e.g., ~400 characters long) for click-tracking
                  //
                  // @see https://github.com/oaeproject/Hilary/issues/1168

                  _.each(messages, (message) => {
                    _assertEmailTemplateFieldValid(message, 'subject');
                    _assertEmailTemplateFieldValid(message, 'html');
                    _assertEmailTemplateFieldValid(message, 'text');
                    _.each(message.html.split('\n'), (line) => {
                      assert.ok(
                        line.length <= 550,
                        format(
                          'Expected no email line to be more than 50 characters, but found: (%s) %s',
                          line.length,
                          line
                        )
                      );
                      assert.ok(
                        line.split('<a').length < 3,
                        format('Expected no email line to have more than 1 link, but found: %s', line)
                      );
                    });
                  });

                  return callback(messages);
                });
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Collect the queued activities and fetch the emails for a particular preference and bucket number
 * that come out of it
 *
 * @param  {Number}     bucketNumber        The bucket number to collect
 * @param  {String}     emailPreference     The email preference to collect. One of: immediate, daily, weekly
 * @param  {Number}     [dayOfWeek]         The 0-indexed (0 = Sunday) day of the week for which to collect. Only useful for weekly collection
 * @param  {Number}     [hourOfDay]         The 0-indexed hour of the day for which to collect. Only useful for daily and weekly collection
 * @param  {Function}   callback            Standard callback function
 * @param  {Object[]}   callback.messages   An array of mails that were sent out
 */
const collectAndFetchEmailsForBucket = function (bucketNumber, emailPreference, dayOfWeek, hourOfDay, callback) {
  const messages = [];

  // Ensure no notifications from other tests are still processing
  MqTestsUtil.whenTasksEmpty(ActivityConstants.mq.TASK_ACTIVITY, () => {
    MqTestsUtil.whenTasksEmpty(ActivityConstants.mq.TASK_ACTIVITY_PROCESSING, () => {
      ActivityNotifications.whenNotificationsEmpty(() => {
        /*!
         * Handle the debugSent event, filling up the messages array with the messages we receive
         */
        const _handleDebugSent = function (info) {
          messages.push(JSON.parse(info.message));
        };

        // Handler that simply collects the messages that are sent in this collection cycle into an array
        EmailAPI.emitter.on('debugSent', _handleDebugSent);

        // Collect the activity buckets, which will aggregate any pending activities into the proper email activity streams
        ActivityAggregator.collectAllBuckets(() => {
          // Collect and send the emails
          ActivityEmail.collectMails(bucketNumber, emailPreference, dayOfWeek, hourOfDay, (error) => {
            assert.ok(!error);
            EmailAPI.emitter.removeListener('debugSent', _handleDebugSent);
            return callback(messages);
          });
        });
      });
    });
  });
};

/**
 * Clear all pending emails
 *
 * @param  {Function}   callback    Standard callback function
 * @throws {Error}                  An assertion error is thrown if there is an issue clearing the emails
 */
const clearEmailCollections = function (callback) {
  MqTestsUtil.whenTasksEmpty(ActivityConstants.mq.TASK_ACTIVITY, () => {
    MqTestsUtil.whenTasksEmpty(ActivityConstants.mq.TASK_ACTIVITY_PROCESSING, () => {
      // Force an activity collection so all emails get scheduled
      ActivityAggregator.collectAllBuckets(() => {
        // Clear the scheduled emails from the buckets
        callbackify(Cassandra.runQuery)('TRUNCATE "EmailBuckets"', [], (error) => {
          assert.ok(!error);

          return callback();
        });
      });
    });
  });
};

/**
 * Ensure the specified field for the message is a valid well-templated string
 *
 * @param  {Object}         mail        The mail message object
 * @param  {String}         fieldName   The field name of the message to check
 * @throws {AssertionError}             Thrown if the field content is not valid
 */
const _assertEmailTemplateFieldValid = function (mail, fieldName) {
  const content = mail[fieldName];
  assert.ok(
    _.isString(content),
    format('Expected email field "%s" be a string, but was: %s', fieldName, JSON.stringify(content, null, 2))
  );
  assert.strictEqual(
    content.indexOf('__MSG__'),
    -1,
    format('Email field "%s" contained "__MSG__" placeholder: %s', fieldName, content)
  );
};

export {
  clearEmailCollections,
  collectAndFetchEmailsForBucket,
  collectAndFetchAllEmails,
  waitForEmail,
  startCollectingEmail,
  sendEmail
};
