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

import { format } from 'node:util';
import _ from 'underscore';
import { filter, pipe, keys, isEmpty } from 'ramda';

import * as AuthzInvitationsDAO from 'oae-authz/lib/invitations/dao.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import { Context } from 'oae-context';
import Counter from 'oae-util/lib/counter.js';
import * as EmailAPI from 'oae-email';
import * as OaeUtil from 'oae-util/lib/util.js';
import { PrincipalsConstants } from 'oae-principals/lib/constants.js';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao.js';
import PrincipalsEmitter from 'oae-principals/lib/internal/emitter.js';
import * as Sanitization from 'oae-util/lib/sanitization.js';
import { telemetry } from 'oae-telemetry';
import * as TenantsAPI from 'oae-tenants';
import { setUpConfig } from 'oae-config';
import * as TenantsUtil from 'oae-tenants/lib/util.js';
import * as TZ from 'oae-util/lib/tz.js';
import * as UIAPI from 'oae-ui';

import { logger } from 'oae-logger';
import { ActivityConstants } from 'oae-activity/lib/constants.js';
import * as ActivityModel from 'oae-activity/lib/model.js';
import * as ActivityUtil from 'oae-activity/lib/util.js';
import * as ActivitySystemConfig from './config.js';
import * as ActivityTransformer from './transformer.js';
import ActivityEmitter from './emitter.js';
import * as ActivityDAO from './dao.js';
import * as ActivityBuckets from './buckets.js';
import * as ActivityAggregator from './aggregator.js';

const Telemetry = telemetry('activity-email');
const TenantConfig = setUpConfig('oae-tenants');
const log = logger('oae-activity-email');

// The maximum amount of users can be handled during a bucket collection
const MAX_COLLECTION_BATCH_SIZE = 50;

// The amount of milliseconds that go in one hour
const ONE_HOUR_IN_MS = 60 * 60 * 1000;

// The amount of milliseconds that go in two days
const TWO_DAYS_IN_MS = 2 * 24 * ONE_HOUR_IN_MS;

// The amount of milliseconds that go in two weeks
const TWO_WEEKS_IN_MS = 14 * 24 * ONE_HOUR_IN_MS;

// Keeps track of users that are scheduled for email when delivered activities are fired. This is
// helpful to synchronize things like tests so we know when email should be collected
const scheduledEmailsCounter = new Counter();

/*!
 * When activities get delivered to a stream, we check if any were delivered to users their
 * `email` stream and queue the user IDs for email delivery
 */
ActivityEmitter.on(ActivityConstants.events.DELIVERED_ACTIVITIES, (deliveredActivities) => {
  const emailRecipientIds = pipe(
    keys,
    filter(_isEmailRecipientId),
    filter(
      (emailRecipientId) =>
        // Only keep email recipients who have an entry for an email stream delivery
        deliveredActivities[emailRecipientId].email
    )
  )(deliveredActivities);

  // If there were no activities delivered in email streams we can stop here
  if (isEmpty(emailRecipientIds)) {
    return;
  }

  scheduledEmailsCounter.incr();

  // Get the full resource representation of each recipient. For user accounts, we need to know
  // their email preference so we can schedule their email appropriately
  _getEmailRecipientResources(emailRecipientIds, (error, recipients) => {
    if (error) {
      scheduledEmailsCounter.decr();
      return log().error(
        { err: error, emailRecipientIds: recipients },
        'Failed to get the email preference field for all the users in this activity'
      );
    }

    // Filter out recipients that should not get emails
    const recipientsToQueue = _.filter(
      recipients,
      (emailRecipient) =>
        !emailRecipient.deleted &&
        emailRecipient.email &&
        emailRecipient.emailPreference !== PrincipalsConstants.emailPreferences.NEVER
    );

    const emailBuckets = {};
    _.each(recipientsToQueue, (recipient) => {
      const bucketId = _createEmailBucketIdForRecipient(recipient);
      emailBuckets[bucketId] = emailBuckets[bucketId] || [];
      emailBuckets[bucketId].push(recipient.id);
    });

    ActivityDAO.saveQueuedUserIdsForEmail(emailBuckets, (error_) => {
      if (error_) {
        scheduledEmailsCounter.decr();
        return log().error(
          { err: error_, deliveredActivities },
          'Unable to store the IDs of the users who need to receive mail'
        );
      }

      log().trace({ recipientsToQueue }, 'Queued mail for users');
      Telemetry.incr('queued.count', recipientsToQueue.length);
      scheduledEmailsCounter.decr();
    });
  });
});

/// //////////////
// UPDATE-USER //
/// //////////////

/*!
 * When a user changes his email preferences we might need to re-queue the user id in another bucket
 * or take it out of a queue
 */
PrincipalsEmitter.on(PrincipalsConstants.events.UPDATED_USER, (ctx, newUser, oldUser) => {
  // If the user's email preference didn't change we don't have to do anything. Similarly,
  // if the old preference was set to `never` we don't have to do anything either
  if (
    newUser.emailPreference === oldUser.emailPreference ||
    oldUser.emailPreference === PrincipalsConstants.emailPreferences.NEVER
  ) {
    return ActivityEmitter.emit(ActivityConstants.events.UPDATED_USER, ctx, newUser, oldUser);
  }

  // Take the user out of the old bucket
  const oldBucketId = _createEmailBucketIdForRecipient(oldUser);
  ActivityDAO.unqueueUsersForEmail(oldBucketId, [oldUser.id], (error) => {
    if (error) {
      return log().error(
        { err: error, user: oldUser.id },
        'Unable to unqueue a user from an email bucket when they changed their email preference'
      );

      // Users who opt out of email delivery shouldn't be queued for email delivery as they simply should not get email
    }

    if (newUser.emailPreference === PrincipalsConstants.emailPreferences.NEVER) {
      return ActivityEmitter.emit(ActivityConstants.events.UPDATED_USER, ctx, newUser, oldUser);
    }

    // Queue the user for his new email preference. If he has no pending emails,
    // he will be ignored during the collection cycle
    const newBucketId = _createEmailBucketIdForRecipient(newUser);
    const emailBucket = {};
    emailBucket[newBucketId] = [newUser.id];
    ActivityDAO.saveQueuedUserIdsForEmail(emailBucket, (error) => {
      if (error) {
        log().error({ err: error, user: newUser.id }, 'Could not re-queue the user for email');
      }

      return ActivityEmitter.emit(ActivityConstants.events.UPDATED_USER, ctx, newUser, oldUser);
    });
  });
});

/// ////////////////////
// Bucket collection //
/// ////////////////////

/**
 * Perform a full collection of all email buckets. If any bucket is already locked by another process, it will be skipped. When
 * this process completes and the callback is invoked, it will guarantee that:
 *
 * a) This process was not allowed to start another collection cycle, as there were too many occuring; or
 * b) for every bucket that wasn't locked, it was collected until it was empty.
 *
 * This function is most useful for unit tests to ensure that all emails up until a point in time have been aggregated and delivered.
 *
 * @param  {Function}   [callback]      Invoked when collection is complete
 * @param  {Object}     [callback.err]  An error that occurred, if any
 */
const collectAllBuckets = function (callback) {
  callback =
    callback ||
    function (error) {
      if (error) {
        log().error({ err: error }, 'Failed to collect all mail buckets');
      }
    };

  const errs = [];
  let count = 0;

  const allDone = function (error) {
    if (error) {
      errs.push(error);
    }

    count++;
    if (count === 3) {
      return callback(errs[0]);
    }
  };

  // To avoid situations where the collection lock would timeout before the bucket is drained
  // we set the lock timeout to the same interval as the polling frequency. This does mean that
  // if it takes longer than `pollingFrequency` seconds to drain a bucket, the lock will have
  // expired and another activity node could jump in and start processing the same bucket
  const collectionExpiry = ActivitySystemConfig.getConfig().mail.pollingFrequency;
  const { maxConcurrentCollections } = ActivitySystemConfig.getConfig();
  const numberOfBuckets = ActivitySystemConfig.getConfig().numberOfProcessingBuckets;
  ActivityBuckets.collectAllBuckets(
    'email:immediate',
    numberOfBuckets,
    maxConcurrentCollections,
    collectionExpiry,
    _collectImmediateBucket,
    allDone
  );
  ActivityBuckets.collectAllBuckets(
    'email:daily',
    numberOfBuckets,
    maxConcurrentCollections,
    collectionExpiry,
    _collectDailyBucket,
    allDone
  );
  ActivityBuckets.collectAllBuckets(
    'email:weekly',
    numberOfBuckets,
    maxConcurrentCollections,
    collectionExpiry,
    _collectWeeklyBucket,
    allDone
  );
};

/**
 * Collect a bucket that holds user ids who have mail scheduled for immediate delivery
 *
 * @param  {Number}     bucketNumber        The bucket to process
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.finished   Indicates that this bucket is drained or has been skipped in which case it should not be retried either
 * @api private
 */
const _collectImmediateBucket = function (bucketNumber, callback) {
  collectMails(bucketNumber, PrincipalsConstants.emailPreferences.IMMEDIATE, null, null, callback);
};

/**
 * Collect a bucket that holds user ids who have mail scheduled for daily delivery
 *
 * @param  {Number}     bucketNumber        The bucket to process
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.finished   Indicates that this bucket is drained or has been skipped in which case it should not be retried either
 * @api private
 */
const _collectDailyBucket = function (bucketNumber, callback) {
  if (_isDailyCycle()) {
    const now = new TZ.timezone.Date('UTC');
    const dateWithAnHour = new TZ.timezone.Date(now.getTime() + 60 * 60 * 1000, 'UTC');
    return collectMails(
      bucketNumber,
      PrincipalsConstants.emailPreferences.DAILY,
      null,
      dateWithAnHour.getHours(),
      callback
    );
  }

  return callback(null, true);
};

/**
 * Collect a bucket that holds user ids who have mail scheduled for weekly delivery
 *
 * @param  {Number}     bucketNumber        The bucket to process
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.finished   Indicates that this bucket is drained or has been skipped in which case it should not be retried either
 * @api private
 */
const _collectWeeklyBucket = function (bucketNumber, callback) {
  if (_isWeeklyCycle()) {
    const now = new TZ.timezone.Date('UTC');
    const dateWithAnHour = new TZ.timezone.Date(now.getTime() + 60 * 60 * 1000, 'UTC');
    return collectMails(
      bucketNumber,
      PrincipalsConstants.emailPreferences.WEEKLY,
      dateWithAnHour.getDay(),
      dateWithAnHour.getHours(),
      callback
    );
  }

  return callback(null, true);
};

/**
 * Check whether daily aggregate mails should be sent out now
 *
 * @return {Boolean}    Whether or not daily mails should be sent out now
 * @api private
 */
const _isDailyCycle = function () {
  const config = ActivitySystemConfig.getConfig();
  const now = new TZ.timezone.Date('UTC');

  // The date when the *next* mail cycle start
  const end = new TZ.timezone.Date(now.getTime() + config.mail.pollingFrequency * 1000, 'UTC');

  // As daily mails go out on the hour, every hour, all we need to do is
  // check if the hour rolls over in this collection cycle
  return now.getHours() !== end.getHours();
};

/**
 * Check whether weekly aggregate mails should be sent out now
 *
 * @return {Boolean}    Whether or not weekly mails should be sent out now
 * @api private
 */
const _isWeeklyCycle = function () {
  const config = ActivitySystemConfig.getConfig();
  const now = new TZ.timezone.Date('UTC');
  const today = now.getDay();

  // Due to timezones, weekly mails can be sent out a day before, on the configured day or the next day
  if (
    today === (config.mail.weekly.day + 6) % 7 ||
    today === config.mail.weekly.day ||
    today === (config.mail.weekly.day + 1) % 7
  ) {
    // The date when the *next* mail cycle start
    const end = new TZ.timezone.Date(now.getTime() + config.mail.pollingFrequency * 1000, 'UTC');

    // As weekly mails go out on the hour, every hour (on the configured day), all we need to do is
    // check if the hour rolls over in this collection cycle
    return now.getHours() !== end.getHours();
  }

  return false;
};

/**
 * Drain an e-mail bucket by sending the correct e-mail to everybody whose in it.
 *
 * Note that this function is only exported for testing purposes. You should use `collectAllBuckets`
 * as this method will *NOT* perform any locking on the processed bucket.
 *
 * @param  {Number}         bucketNumber            The bucket to process
 * @param  {String}         emailPreference         Which bucket type the users should be retrieved from. One of {@see PrincipalsConstants.emailPreferences}
 * @param  {Number}         [dayOfWeek]             What day of the week the email should be delivered. Only required for WEEKLY emails
 * @param  {Number}         [hour]                  What hour the email should be delivered. Only required for WEEKLY and DAILY emails
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Boolean}        callback.finished       Indicates that this bucket is drained or has been skipped in which case it should not be retried either
 * @param  {Resource[]}     callback.recipients     The recipients (users or email profiles) that received an email
 */
const collectMails = function (bucketNumber, emailPreference, dayOfWeek, hour, callback) {
  const collectionStart = Date.now();
  log().trace(
    'Collecting batch of %s users from bucket number %s:%s',
    MAX_COLLECTION_BATCH_SIZE,
    bucketNumber,
    emailPreference
  );

  // Construct the id of the bucket that needs to be collected
  const bucketId = _createEmailBucketId(bucketNumber, emailPreference, dayOfWeek, hour);

  // Get the timestamp which we consider to be the cut-off point for activities. Older activities will not be included
  const oldestActivityTimestamp = _getCollectionCycleStart(emailPreference);
  _collectMails(bucketId, oldestActivityTimestamp, null, (error, recipients) => {
    if (error) return callback(error);

    Telemetry.incr(format('sent.%s.count', emailPreference), recipients.length);
    Telemetry.appendDuration(format('sent.%s.time', emailPreference), collectionStart);
    return callback(null, true, recipients);
  });
};

/**
 * Internal method that recursively drain an email bucket.
 *
 * Steps:
 *   1.  Get all the users whom we need to mail in this iteration. These are the user IDs in the bucket
 *   2.  Collect all the activities from the users their email streams
 *   3.  Filter the activity streams to those that have no activities within the grace period
 *   4.  Stop aggregating for those email activity streams. This is to ensure that later emails don't include old activities
 *   5.  Unqueue the users from the email buckets
 *   6.  Remove the activities from the activity streams as they are no longer required
 *   7.  Construct the actual emails and send them out
 *
 * @param  {String}     bucketId                    The bucket to collect
 * @param  {Number}     oldestActivityTimestamp     The timestamp for the oldest activity that should be included in the current collection cycle
 * @param  {String}     [start]                     The user id to start paging from
 * @param  {Function}   callback                    Standard callback function
 * @param  {Resource}   callback.recipients         The recipients that received an email
 * @api private
 */
const _collectMails = function (bucketId, oldestActivityTimestamp, start, callback, _collectedRecipients) {
  // Keep track of whom we sent a mail to
  _collectedRecipients = _collectedRecipients || [];

  // 1. Get all the recipients who are queued for email delivery
  ActivityDAO.getQueuedUserIdsForEmail(bucketId, start, MAX_COLLECTION_BATCH_SIZE, (error, recipientIds, nextToken) => {
    if (error) return callback(error);

    if (isEmpty(recipientIds)) return callback(null, []);

    const recipientIdsByActivityStreamIds = _.chain(recipientIds)
      .map((recipientId) => [
        ActivityUtil.createActivityStreamId(recipientId, ActivityConstants.streams.EMAIL),
        recipientId
      ])
      .object()
      .value();

    ActivityDAO.getActivitiesFromStreams(
      _.keys(recipientIdsByActivityStreamIds),
      oldestActivityTimestamp,
      (error, activitiesPerStream) => {
        if (error) return callback(error);

        // Will hold the activities (keyed per stream) who have no activities within the grace period
        const activitiesPerMailableStreams = {};

        // Will hold the user IDs that should receive an email during this collection phase
        const recipientIdsToMail = [];

        // 3. Filter the activity streams to those who have no activities within the grace period
        const threshold = Date.now() - ActivitySystemConfig.getConfig().mail.gracePeriod * 1000;
        _.each(activitiesPerStream, (activities, activityStreamId) => {
          const hasRecentActivity = _.find(activities, (activity) => activity.published > threshold);

          if (!hasRecentActivity) {
            // Keep track of the activities for which we'll send out an e-mail
            activitiesPerMailableStreams[activityStreamId] = activities;

            // Keep track of the id of the user for which we'll send out an e-mail
            recipientIdsToMail.push(recipientIdsByActivityStreamIds[activityStreamId]);
          }
        });

        // 4. Reset aggregation for the those streams we'll be sending out an email for
        // so that the next e-mail doesn't contain the same activities
        ActivityDAO.resetAggregationForActivityStreams(_.keys(activitiesPerMailableStreams), (error_) => {
          if (error_) return callback(error_);

          // 5. Remove the users we'll email from the buckets
          ActivityDAO.unqueueUsersForEmail(bucketId, recipientIdsToMail, (error_) => {
            if (error_) return callback(error_);

            // 6. Delete these activities as we will be pushing them out
            const activitiesPerStreamToDelete = {};
            _.each(activitiesPerMailableStreams, (activities, activityStreamId) => {
              activitiesPerStreamToDelete[activityStreamId] = _.pluck(
                activities,
                ActivityConstants.properties.OAE_ACTIVITY_ID
              );
            });
            ActivityDAO.deleteActivities(activitiesPerStreamToDelete, (error_) => {
              if (error_) return callback(error_);

              // Get all the recipient profiles
              _getEmailRecipientResources(recipientIdsToMail, (error, recipients) => {
                if (error) {
                  log().error(
                    { err: error, recipientIds: recipientIdsToMail },
                    'Failed to get the recipients when sending email'
                  );
                  return callback(error);
                }

                // Keep track of whom we need to email
                const recipientsToMail = _.filter(recipients, (recipient) => {
                  /**
                   * Although it's very unlikely that a user who changed their email preferences would end up here,
                   * we take it into account as it would be really unfortunate to send them any further email.
                   * Additionally, if the email stream for the user was empty (because they marked their notifications as read),
                   * we can'tsend them any mail either
                   */
                  const emailActivityStreamId = ActivityUtil.createActivityStreamId(
                    recipient.id,
                    ActivityConstants.streams.EMAIL
                  );
                  return (
                    recipient.emailPreference !== PrincipalsConstants.emailPreferences.NEVER &&
                    !_.isEmpty(activitiesPerMailableStreams[emailActivityStreamId])
                  );
                });

                // Transform the recipients array so the activities are included
                const toMail = _.map(recipientsToMail, (recipient) => {
                  const emailActivityStreamId = ActivityUtil.createActivityStreamId(
                    recipient.id,
                    ActivityConstants.streams.EMAIL
                  );
                  return {
                    recipient,
                    activities: activitiesPerMailableStreams[emailActivityStreamId]
                  };
                });

                // 7. Send out the emails
                _mailAll(toMail, (error_) => {
                  if (error_) return callback(error_);

                  _collectedRecipients = [..._collectedRecipients, ...recipientsToMail];

                  if (nextToken) {
                    _collectMails(bucketId, oldestActivityTimestamp, nextToken, callback, _collectedRecipients);
                  } else {
                    return callback(null, _collectedRecipients);
                  }
                });
              });
            });
          });
        });
      }
    );
  });
};

/**
 * Mails a set of users
 *
 * @param  {Object[]}   toMail          An object containing the `recipient` and the `activities` they should receive
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _mailAll = function (toMail, callback) {
  if (_.isEmpty(toMail)) {
    return callback();
  }

  const to = toMail.pop();
  _mail(to.recipient, to.activities, (error) => {
    if (error) {
      // Warn that this user is not going to receive an email, however we can continue sending
      // other emails
      log().warn(
        {
          err: error,
          to
        },
        'An error occurred while sending an email to a user'
      );
    }

    return _mailAll(toMail, callback);
  });
};

/**
 * Send a mail to a recipient resource (email or user)
 *
 * @param  {Resource}       recipient       The recipient to mail
 * @param  {Activity[]}     activities      The set of activities that should go in the mail
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 * @api private
 */
const _mail = function (recipient, activities, callback) {
  // Given that we support weekly deliveries, there is a possibility that there are 2 activities
  // present in the activity stream that could aggregate
  const aggregatedActivities = _aggregate(recipient.id, activities);

  // Transform the activities in the activity streams format so we can pass it on to the adapter
  const tenant = TenantsAPI.getTenant(recipient.tenant.alias);
  const timezone = TenantConfig.getValue(tenant.alias, 'timezone', 'timezone');
  const ctx = new Context(tenant, recipient);
  if (!tenant.active) {
    return callback(new Error(format('Tried to email a user in a disabled tenancy %s', tenant.alias)));
  }

  ActivityTransformer.transformActivities(
    ctx,
    aggregatedActivities,
    ActivityConstants.transformerTypes.ACTIVITYSTREAMS,
    (error) => {
      if (error) {
        return callback(error);
      }

      const baseUrl = TenantsUtil.getBaseUrl(tenant);
      let invitationUrl = null;
      if (AuthzUtil.isEmail(recipient.id)) {
        const invitationTokenParameter = encodeURIComponent(recipient.token);
        const invitationEmailParameter = encodeURIComponent(recipient.email);
        const signupRedirectUrl = format(
          '/?invitationToken=%s&invitationEmail=%s',
          invitationTokenParameter,
          invitationEmailParameter
        );

        invitationUrl = format('%s/signup?url=%s', baseUrl, encodeURIComponent(signupRedirectUrl));
      }

      // Transform the activities in a simple model that the templates can use to generate the email
      UIAPI.getActivityAdapter((error, adapter) => {
        if (error) return callback(error);

        const adaptedActivities = adapter.adapt(recipient.id, recipient, aggregatedActivities, Sanitization, {
          resourceHrefOverride: invitationUrl
        });

        // Generate a unique fingerprint for this mail so we don't accidentally send it out multiple times
        // We cannot use the activityId as each activity gets a new ID when routed and/or aggregated
        // See https://github.com/oaeproject/Hilary/pull/759 for more information
        let emailHash = format('%s#', recipient.id);
        _.each(aggregatedActivities, (activity) => {
          emailHash += format('%s:%s#', activity[ActivityConstants.properties.OAE_ACTIVITY_TYPE], activity.published);
        });

        // Construct the data that needs to go into the email template
        const data = {
          activities: adaptedActivities,
          tenant,
          baseUrl,
          invitationUrl,
          skinVariables: UIAPI.getTenantSkinVariables(tenant.alias),
          timezone
        };

        return EmailAPI.sendEmail('oae-activity', 'mail', recipient, data, { hash: emailHash }, callback);
      });
    }
  );
};

/**
 * Aggregate those activities that can be aggregated in the set of passed in activities. Aggregation happens
 * regardless of the time that sits between two activities.
 *
 * @param  {String}         userId          The ID of the user for which these activities are intended
 * @param  {Activity[]}     activities      The set of activities to aggregate
 * @return {Activity[]}                     The aggregated activities
 * @private
 */
const _aggregate = function (userId, activities) {
  // Unroll the `activities` so it does not contain any aggregates
  const unrolledActivities = _unrollActivities(activities);

  // Convert the set of unrolled activities into a set of "routed activities"
  // so we can generate the aggregates for it
  const routedActivities = _.map(unrolledActivities, (activity) => ({
    route: userId,
    activity
  }));

  // Re-aggregate everything
  const aggregates = ActivityAggregator.createAggregates(routedActivities);

  const aggregatedActivityIds = [];
  const aggregatedActivities = [];

  // Pass 1: Select all the multi-aggregates and push them into the aggregated activities set
  _.each(aggregates, (aggregate) => {
    if (aggregate.activityIds.length > 1) {
      _.each(aggregate.activityIds, (aggregatedActivityId) => {
        aggregatedActivityIds.push(aggregatedActivityId);
      });

      aggregatedActivities.push(_createActivityFromAggregate(aggregate));
    }
  });

  // Pass 2: Select all the single-aggregates, filter out those that are consumed in a multi-aggregate and push the remainder in the aggregated activities set
  _.each(aggregates, (aggregate) => {
    if (aggregate.activityIds.length === 1 && !_.contains(aggregatedActivityIds, aggregate.activityIds[0])) {
      aggregatedActivities.push(_createActivityFromAggregate(aggregate));
      aggregatedActivityIds.push(aggregate.activityIds[0]);
    }
  });

  // Return an array of activities sorted in time
  return aggregatedActivities.sort((a, b) => b.published - a.published);
};

/**
 * Invoke the handler the next time there are currently no activity delivery events being handled
 * to schedule email delivery for users. If there are currently no activity delivery events being
 * handled when this is invoked, the handler is invoked immediately
 *
 * @param  {Function}   handler     The handler to invoke when all activity delivery events have been processed
 */
const whenEmailsScheduled = function (handler) {
  scheduledEmailsCounter.whenZero(handler);
};

/**
 * Given an aggregate, return a proper activity
 *
 * @param  {ActivityAggregate}  aggregate   An aggregate containing a single or multiple activities
 * @return {Activity}                       The activity object
 * @api private
 */
const _createActivityFromAggregate = function (aggregate) {
  const actor = ActivityAggregator.createActivityEntity(_.values(aggregate.actors));
  const object = ActivityAggregator.createActivityEntity(_.values(aggregate.objects));
  const target = ActivityAggregator.createActivityEntity(_.values(aggregate.targets));
  return new ActivityModel.Activity(
    aggregate[ActivityConstants.properties.OAE_ACTIVITY_TYPE],
    aggregate.activityIds[0],
    aggregate.verb,
    aggregate.published,
    actor,
    object,
    target
  );
};

/**
 * Unroll a set of activities by expanding aggregated activities into separate distinct
 * aggregates. Note that the unrolled activities will probably *NOT* match the activity
 * from before aggregation.
 *
 * @param  {Activity[]}     aggregatedActivities    A set of activities that contain possible aggregates
 * @return {Activity[]}                             The expanded activities that do not contain aggregates
 * @api private
 */
const _unrollActivities = function (aggregatedActivities) {
  const activities = [];
  _.each(aggregatedActivities, (activity) => {
    const actorEntities = _getEntities(activity.actor);
    const objectEntities = _getEntities(activity.object);
    const targetEntities = _getEntities(activity.target);

    // If the activity contains at most 1 entity for the actor, object and target entities, it
    // hasn't aggregated with other activities, which means we don't have to unroll anything
    if (actorEntities.length <= 1 && objectEntities.length <= 1 && targetEntities.length <= 1) {
      activities.push(activity);
      return;
    }

    // This activity has aggregated with another activity so one (or more) entities are collections
    // that need to be unrolled
    let actor = null;
    let object = null;
    let target = null;
    while (!_.isEmpty(actorEntities) || !_.isEmpty(objectEntities) || !_.isEmpty(targetEntities)) {
      actor = actorEntities.pop() || actor;
      object = objectEntities.pop() || object;
      target = targetEntities.pop() || target;

      const newActivity = new ActivityModel.Activity(
        activity[ActivityConstants.properties.OAE_ACTIVITY_TYPE],
        activity[ActivityConstants.properties.OAE_ACTIVITY_ID],
        activity.verb,
        activity.published,
        actor,
        object,
        target
      );
      activities.push(newActivity);
    }
  });
  return activities;
};

/**
 * Get the set of entities for a given `actor`, `object` or `target` entity. If the entity
 * is null an empty array will be returned. If there's only a single entity available, an
 * array with that single value in it will be returned.
 *
 * @param  {Object}             entity      The entity to return. Either an `ActivityEntity` or an `oae:collection` of `ActivityEntity` objects
 * @return {ActivityEntity[]}               An array of `ActivityEntity` objects
 * @api private
 */
const _getEntities = function (entity) {
  if (!entity) {
    return [];
  }

  if (entity.objectType !== 'collection') {
    return [entity];
  }

  return entity[ActivityConstants.properties.OAE_COLLECTION];
};

/**
 * Get the resource profiles for the given set of email recipient ids. These ids can be both
 * user ids and email addresses. For user ids, the resource profiles will be those persisted in the
 * system for those users, while emails we be a resource profile derived from known information
 * about the email domain
 *
 * @param  {String[]}       emailRecipientIds       The email addresses and user ids to which we would like to get profiles
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Resource[]}     callback.recipients     The recipients profiles derived from the user ids and emails
 * @api private
 */
const _getEmailRecipientResources = function (emailRecipientIds, callback) {
  const recipientIdsPartitioned = _.partition(emailRecipientIds, AuthzUtil.isUserId);
  const userIds = _.first(recipientIdsPartitioned);
  const emails = _.last(recipientIdsPartitioned);

  // If there are any emails, get the invitation tokens that are associated to them
  OaeUtil.invokeIfNecessary(
    !_.isEmpty(emails),
    AuthzInvitationsDAO.getTokensByEmails,
    emails,
    (error, tokensByEmail) => {
      if (error) {
        return callback(error);
      }

      // Derive a resource profile for the email, where the tenant is the tenant whose configured
      // email domain matches the email address
      const emailResources = _.map(emails, (email) => ({
        id: email,
        tenant: TenantsAPI.getTenantByEmail(email),
        email,
        emailPreference: PrincipalsConstants.emailPreferences.IMMEDIATE,
        token: tokensByEmail[email]
      }));

      // If there were user recipients, get the user profiles
      OaeUtil.invokeIfNecessary(
        !_.isEmpty(userIds),
        PrincipalsDAO.getPrincipals,
        userIds,
        ['principalId', 'tenantAlias', 'deleted', 'email', 'emailPreference'],
        (error, usersById) => {
          if (error) {
            return callback(error);
          }

          return callback(null, _.chain(usersById).values().union(emailResources).value());
        }
      );
    }
  );
};

/**
 * Determine if the given route id represents a potential email recipient
 *
 * @param  {String}     routeId     The id of the route
 * @param  {Boolean}                Whether or not the route id is a potential email recipient (i.e., an email address or a user id)
 * @api private
 */
const _isEmailRecipientId = function (routeId) {
  return AuthzUtil.isUserId(routeId) || AuthzUtil.isEmail(routeId);
};

/**
 * Given a recipient (email resource or user), return the approriate email bucket ID
 *
 * @param  {Resource}   recipient   The recipient profile for which to generate an email bucket id
 * @return {String}                 The ID of the email bucket that this user should go in
 * @api private
 */
const _createEmailBucketIdForRecipient = function (recipient) {
  const timezone = TenantConfig.getValue(recipient.tenant.alias, 'timezone', 'timezone');
  const bucketNumber = _getBucketNumber(recipient.id);

  // Gets filled up in case the recipient wants a weekly or daily mail
  let hour = null;
  let dayOfWeek = null;

  // Anything else than immediate delivery needs to be scheduled appropriately
  if (recipient.emailPreference !== PrincipalsConstants.emailPreferences.IMMEDIATE) {
    /*!
     * Take the given timezone into account for daily and/or weekly mails. We try to deliver an e-mail
     * at the configured hour in the given timezone. In order to do this we need the timezone offset
     * between the given timezone and UTC as buckets are always handled in UTC.
     *
     * For example, the given timezone is Miami (UTC-5) and mail needs to be delivered at 13h. The mail
     * needs to leave the server at 18h (UTC time) so it arrives when it's 13h in Miami.
     *
     * For weekly emails, it's entirely possible we need to schedule email delivery on the previous/next day.
     * For example, the given timezone is Islamabad (UTC+5) and mails need to be delivered at 2am. The mail
     * needs to leave the server at 21h (UTC time) so it arrives when it's 2am in Islamabad
     */
    const mailConfig = ActivitySystemConfig.getConfig().mail;

    // Get the offset between the timezone and UTC in hours. `getTimezoneOffset` returns the offset in minutes,
    // which we can ceil as we can be a bit flexible about when the email arrives. `getTimezoneOffset` returns
    // the offset against *UTC*. This is fine as email collection always works with UTC timezones
    const offsetInHours = Math.ceil(new TZ.timezone.Date(timezone).getTimezoneOffset() / 60);

    // Add (or subtract) the offset, if the result is a negative hour, we'll need to send out the email on the day
    // before the configured day, if it's 24 or higher we'll need to send it a day later
    hour = mailConfig[recipient.emailPreference].hour - offsetInHours;
    if (hour < 0) {
      // Rather than doing -1, we do +6 as Javascript can't handle negative modulos
      dayOfWeek = (mailConfig.weekly.day + 6) % 7;
    } else if (hour >= 24) {
      dayOfWeek = (mailConfig.weekly.day + 1) % 7;
    } else {
      dayOfWeek = mailConfig.weekly.day;
    }

    // Ensure that we're dealing with valid 24-hour values. Because Javascript can't handle negative modulos
    // and we might've added a negative offset, we add an extra 24 hours to guarantee a positive result
    hour = (24 + hour) % 24;
  }

  return _createEmailBucketId(bucketNumber, recipient.emailPreference, dayOfWeek, hour);
};

/**
 * Get a timestamp that sits a bit before the oldest activity that should be included in the current
 * collection cycle.
 *
 * @param  {String}     emailPreference     The email preference for which were currently collecting mail
 * @return {Number}                         The timestamp for the oldest activity that should be included in the current collection cycle
 * @api private
 */
const _getCollectionCycleStart = function (emailPreference) {
  if (emailPreference === PrincipalsConstants.emailPreferences.IMMEDIATE) {
    return Date.now() - ONE_HOUR_IN_MS;
  }

  if (emailPreference === PrincipalsConstants.emailPreferences.DAILY) {
    return Date.now() - TWO_DAYS_IN_MS;
  }

  if (emailPreference === PrincipalsConstants.emailPreferences.WEEKLY) {
    return Date.now() - TWO_WEEKS_IN_MS;
  }
};

/**
 * Given a bucket number, an email preference and an hour, return the appropriate email bucket
 *
 * @param  {String}     bucketNumber        The email bucket number
 * @param  {String}     emailPreference     The email preference. One of {@see PrincipalsConstants.emailPreferences}
 * @param  {Number}     [dayOfWeek]         What day of the week the email should be delivered. Only required for WEEKLY emails
 * @param  {Number}     [hour]              What hour the email should be delivered. Only required for WEEKLY and DAILY emails
 * @return {String}                         The ID of the email bucket that this user should go in
 * @api private
 */
const _createEmailBucketId = function (bucketNumber, emailPreference, dayOfWeek, hour) {
  if (emailPreference === PrincipalsConstants.emailPreferences.IMMEDIATE) {
    return format('oae-activity-email:%s:%s', bucketNumber, emailPreference);
  }

  if (emailPreference === PrincipalsConstants.emailPreferences.DAILY) {
    return format('oae-activity-email:%s:%s:%d', bucketNumber, emailPreference, hour);
  }

  if (emailPreference === PrincipalsConstants.emailPreferences.WEEKLY) {
    return format('oae-activity-email:%s:%s:%d:%d', bucketNumber, emailPreference, dayOfWeek, hour);
  }
};

/**
 * Given a user ID, return an appropriate bucket number
 *
 * @param  {String}     userId  The ID of the user for whom to retrieve the email bucket number
 * @return {String}             The email bucket number
 * @api private
 */
const _getBucketNumber = function (userId) {
  const numberOfBuckets = ActivitySystemConfig.getConfig().numberOfProcessingBuckets;
  return ActivityBuckets.getBucketNumber(userId, numberOfBuckets);
};

export { collectAllBuckets, collectMails, whenEmailsScheduled };
