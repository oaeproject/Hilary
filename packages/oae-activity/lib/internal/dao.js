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

import crypto from 'crypto';
import util from 'util';
import _ from 'underscore';
import ShortId from 'shortid';

import * as Cassandra from 'oae-util/lib/cassandra';

import { logger } from 'oae-logger';
import * as OaeUtil from 'oae-util/lib/util';

import { ActivityConstants } from 'oae-activity/lib/constants';
import * as ActivitySystemConfig from './config';

const log = logger('oae-activity');

// The redis client that will be used for storing / fetch aggregate entities
let redisClient = null;

/**
 * Initialize the activity DAO.
 *
 * @param  {RedisClient}    redisClient     The redis client to use for aggregation
 */
const init = function(_redisClient) {
  redisClient = _redisClient;
};

/**
 * Get a list of activities from the specified activity stream.
 *
 * @param  {String}         activityStreamId        The ID of the activity stream. ex: `u:cam:abc123#activity`
 * @param  {Number|String}  [start]                 Number of millis since the epoc (stringified or number version) from which to start returning activities. Only activities older than this timestamp will be returned. By default, will start from the newest.
 * @param  {Number}         [limit]                 The number of activities to return. Default: 25
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Activity[]}     callback.activities     The list of activities
 * @param  {String}         callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 */
const getActivities = function(activityStreamId, start, limit, callback) {
  start = start || '';
  limit = OaeUtil.getNumberParam(limit, 25, 1);

  // Selecting with consistency ONE as having great consistency is not critical for activities
  Cassandra.runPagedQuery(
    'ActivityStreams',
    'activityStreamId',
    activityStreamId,
    'activityId',
    start,
    limit,
    { reversed: true },
    (err, rows, nextToken) => {
      if (err) {
        return callback(err);
      }

      const activities = _rowsToActivities(rows);
      return callback(null, activities, nextToken);
    }
  );
};

/**
 * Get a list of activities for a set of activity streams. Note that this method
 * doesn't perform any paging. All the activities for each stream will be retrieved.
 *
 * @param  {String[]}   activityStreamIds               The set of activity stream IDs for which to retrieve the activities
 * @param  {Number}     [start]                         If provided, only activities older than this timestamp will be returned
 * @param  {Function}   callback                        Standard callback function
 * @param  {Object}     callback.err                    An error that occurred, if any
 * @param  {Object}     callback.activitiesPerStream    The list of activities keyed by their activity stream id
 */
const getActivitiesFromStreams = function(activityStreamIds, start, callback) {
  let query = 'SELECT * FROM "ActivityStreams" WHERE "activityStreamId" IN ?';
  const parameters = [activityStreamIds];
  if (start) {
    query += ' AND "activityId" > ?';
    parameters.push(start + ':');
  }

  Cassandra.runQuery(query, parameters, (err, rows) => {
    if (err) {
      return callback(err);
    }

    const activitiesPerStream = {};
    _.each(rows, row => {
      const activityStreamId = row.get('activityStreamId');
      const activityId = row.get('activityId');
      let activityStr = row.get('activity');
      try {
        const activity = JSON.parse(activityStr);
        activitiesPerStream[activityStreamId] = activitiesPerStream[activityStreamId] || [];
        activitiesPerStream[activityStreamId].push(activity);
      } catch (error) {
        activityStr = activityStr.slice(0, 300);
        log().warn({ err: error, activityId, value: activityStr }, 'Error parsing activity from Cassandra');
      }
    });

    return callback(null, activitiesPerStream);
  });
};

/**
 * Deliver the given routed activities to their specified routes. The routed activities should be given in the format:
 *
 * ```
 * {
 *     '<route id 0>': {
 *         '<activity id 0>': {Activity},
 *         '<activity id 1>': {Activity},
 *         ...
 *     },
 *     '<route id 1>': {
 *         ...
 *     },
 *     ...
 * }
 * ```
 *
 * @param  {Object}    routedActivities    An object keyed by the route id (a.k.a., activity stream id), whose value is an object of activities to be delivered, keyed by their activity id.
 * @param  {Function}  callback            Standard callback function
 * @param  {Object}    callback.err        An error that occurred, if any
 */
const deliverActivities = function(routedActivities, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err }, 'Error delivering routed activities.');
      }
    };

  const ttl = ActivitySystemConfig.getConfig().activityTtl;
  const queries = [];
  _.each(routedActivities, (activities, route) => {
    _.each(activities, (activity, activityId) => {
      queries.push({
        query:
          'INSERT INTO "ActivityStreams" ("activityStreamId", "activityId", "activity") VALUES (?, ?, ?) USING TTL ' +
          ttl,
        parameters: [route, activityId, JSON.stringify(activity)]
      });
    });
  });

  Cassandra.runBatchQuery(queries, callback);
};

/**
 * Delete the specified activities from specific routes.
 *
 * @param  {Object}    routeActivityIds    An object keyed by route, whose value is an array of string activityIds that should be deleted from the route
 * @param  {Function}  callback            Standard callback function
 * @param  {Object}    callback.err        An error that occurred, if any
 */
const deleteActivities = function(routeActivityIds, callback) {
  if (_.isEmpty(routeActivityIds)) {
    return callback();
  }

  const queries = [];
  _.each(routeActivityIds, (activityIds, route) => {
    if (_.isEmpty(activityIds)) {
      return;
    }

    _.each(activityIds, activityId => {
      queries.push({
        query: 'DELETE FROM "ActivityStreams" WHERE "activityStreamId" = ? AND "activityId" = ?',
        parameters: [route, activityId]
      });
    });
  });

  Cassandra.runBatchQuery(queries, callback);
};

/**
 * Deletes all the activities in an activity stream
 *
 * @param  {String}     activityStreamId    The ID of the activity stream to clear
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const clearActivityStream = function(activityStreamId, callback) {
  Cassandra.runQuery('DELETE FROM "ActivityStreams" WHERE "activityStreamId" = ?', [activityStreamId], callback);
};

/**
 * Save the given routed activities to the specified queue buckets. A routed activity is essentially an Activity object that
 * is stored along with the route to which it should be delivered:
 *
 * `{ 'route': 'u:oae:mrvisser', 'activity': { <Activity Object> }}`
 *
 * @param  {Object[][]}    activityBuckets     An array whose index represents the bucket number, and whose value represents the array of routed activities to queue into the bucket.
 * @param  {Function}      callback            Standard callback function
 * @param  {Object}        callback.err        An error that occurred, if any
 */
const saveQueuedActivities = function(activityBuckets, callback) {
  if (_.isEmpty(activityBuckets)) {
    return callback();
  }

  log().trace({ activityBuckets }, 'Saving queued activities.');

  // We will batch together one redis update command per bucket that needs to be updated
  const multi = redisClient.multi();

  _.each(activityBuckets, (activityBucket, bucketNumber) => {
    // eslint-disable-next-line unicorn/explicit-length-check
    if (!activityBucket || !activityBucket.length) {
      return;
    }

    // We use a Redis sorted list ("zadd") to stored bucketed queued activities so that we can always collect the oldest first
    // Arguments to zadd start with the key, then each arguments after are ordered pairs of <rank>, <value>. The "rank" specifies
    // the order in which values will be sorted, from lowest to highest.

    // The bucket cache-key as the first argument
    const key = _createBucketCacheKey(bucketNumber);
    const zaddArgs = [];
    _.each(activityBucket, routedActivity => {
      // Append the ordered pair of <rank>, <value> for this routed activity
      zaddArgs.push(routedActivity.activity.published);
      zaddArgs.push(JSON.stringify(routedActivity));
    });

    // Append this bucket zadd command to the batch
    multi.zadd(key, zaddArgs);
  });

  // Finally execute the zadd commands to append the values to bucket's sorted lists
  multi.exec(callback);
};

/**
 * Get the queued activities from the given bucket number for processing.
 *
 * @param  {Number}     bucketNumber                The bucket from which to fetch the queued activities
 * @param  {Number}     limit                       How many routed activities to fetch from the queue
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.routedActivities   The routed activities that were queued in the bucket. The key is the internally created id of the entry (which can be used to later delete the entry), and value is a routed activity, as documented in #saveQueuedActivities
 * @param  {Number}     callback.numToDelete        The number of queued activities that were fetched from storage, and therefore the number of items that should be deleted when the batch of fetched activities have been processed
 */
const getQueuedActivities = function(bucketNumber, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, ActivitySystemConfig.getConfig().collectionBatchSize);

  // Get the first `limit` routed activities from the bucket. Since they are stored in a sorted list in Redis, we use the
  // "zrange" command. The "z" prefix to the command indicates that it is a sorted-list operation.
  redisClient.zrange(_createBucketCacheKey(bucketNumber), 0, limit, (err, routedActivities) => {
    if (err) {
      return callback(err);
    }

    const numToDelete = _.size(routedActivities);

    // The Redis result is each value on a new line, in order of "rank" in
    // the sorted-list. Iterate over those and parse the values in order
    const queuedActivities = {};
    _.each(routedActivities, routedActivity => {
      try {
        // Routed activities are stored as stringified JSON, so we parse them back to objects
        routedActivity = JSON.parse(routedActivity);
        queuedActivities[_createRoutedActivityKey(routedActivity)] = routedActivity;
      } catch (error) {
        let truncatedRoutedActivity = JSON.stringify(routedActivity);
        if (truncatedRoutedActivity) {
          truncatedRoutedActivity = truncatedRoutedActivity.slice(0, 300);
        }

        log().error(
          { err: error, routedActivity: truncatedRoutedActivity },
          'Error trying to parse stored routed activity'
        );
      }
    });

    log().trace({ queuedActivities }, 'Fetched queued activities');

    return callback(null, queuedActivities, numToDelete);
  });
};

/**
 * Delete queued activities from a bucket.
 *
 * @param  {Number}    bucketNumber        The number of the bucket from which to delete the queued activities
 * @param  {Number}    numberToDelete      The number of activities (starting from the earliest) from the earliest set of activities to delete from the bucket
 * @param  {Function}  callback            Standard callback function
 * @param  {Object}    callback.err        An error that occurred, if any
 */
const deleteQueuedActivities = function(bucketNumber, numberToDelete, callback) {
  if (!numberToDelete) {
    return callback();
  }

  log().trace({ bucketNumber, numberToDelete }, 'Deleting queued activities.');

  // Use "zremrangebyrank", which will delete the first "numberToDelete" items in the sorted-list, ordered by their "rank"
  redisClient.zremrangebyrank(_createBucketCacheKey(bucketNumber), 0, numberToDelete - 1, callback);
};

/**
 * Get the aggregation status for the aggregates identified by the given aggregate keys. Can be used to determine if any aggregates
 * are currently aggregating, expired, the id of the last activity delivery, etc... An example status looks like:
 *
 * ```javascript
 *  {
 *      'lastActivity': 'PTeijwe',      // The ID of the last activity that was delivered for the aggregate
 *      'lastUpdated': 123456789,       // The timestamp (millis since epoch) that the last activity matched this aggregate
 *      'lastCollected': 123456780,     // The timestamp (millis since epoch) since the aggregate was last collected
 *      'created': 123448430            // The timestamp (millis since epoch) since the aggregate was created
 *  }
 * ```
 *
 * @param  {String[]}  aggregateKeys               The aggregate keys for which to fetch the aggregate status
 * @param  {Function}  callback                    Standard callback function
 * @param  {Object}    callbcak.err                An error that occurred, if any
 * @param  {Object}    callback.aggregateStatus    An object, keyed by the aggregate key, whose value is the status of the aggregate
 */
const getAggregateStatus = function(aggregateKeys, callback) {
  if (_.isEmpty(aggregateKeys)) {
    return callback(null, {});
  }

  // Fetch each aggregate status by key. This uses a Redis multi-get ("mget"), whose arguments must be an array of all the keys to fetch
  const mgetArgs = [];
  _.each(aggregateKeys, aggregateKey => {
    mgetArgs.push(_createAggregateStatusCacheKey(aggregateKey));
  });

  // Gather the redis keys for the aggregate statii
  redisClient.mget(mgetArgs, (err, results) => {
    if (err) {
      return callback(err);
    }

    // The result is each aggregate status separated by a new line, ordered the same as the keys were in the args. Therefore
    // we iterate over those one-by-one and match the aggregate status result with the aggregate key by index.
    const aggregateStatus = {};
    for (let i = 0; i < results.length; i++) {
      // Match the aggregate status result with the aggregate key by index.
      let result = results[i];
      const aggregateKey = aggregateKeys[i];

      if (result) {
        try {
          // The aggregate status was stored as stringified JSON, so parse it.
          result = JSON.parse(result);
          aggregateStatus[aggregateKey] = result;
        } catch (error) {
          log().warn({ err: error }, 'Found invalid aggregate status entry. Skipping.');
        }
      }
    }

    return callback(null, aggregateStatus);
  });
};

/**
 * Update a set of aggregate status with a new status.
 *
 * @param  {Object}    statusUpdatesByActivityStreamId      A set of objects keyed by aggregate key whose values are the new status information for the aggregate. Each set of aggregate data is keyed by the activity stream id
 * @param  {Function}  callback                             Standard callback function
 * @param  {Object}    callback.err                         An error that occurred, if any
 */
const indexAggregateData = function(statusUpdatesByActivityStreamId, callback) {
  const activityStreamIds = _.keys(statusUpdatesByActivityStreamId);
  if (_.isEmpty(activityStreamIds)) {
    return callback();
  }

  // We will have to execute multiple redis update commands, so we use a multi object which will handle this.
  const multi = redisClient.multi();

  // We use a redis multi-set ("mset") command to set all the aggregate status updates. The arguments take and array of ordered pairs of "key1 value1 key2 value2", which will be stored in msetArgs
  const msetArgs = [];

  // We will need to update the expiry of each aggregate status that is touched, this will hold the keys of the aggregate statuses whose ttl/expiry should be udpated
  const keysToExpire = [];

  // We will need to remove the keys in the set of active aggregate keys per activity stream that expired
  const maxExpiryAgo = Date.now() - ActivitySystemConfig.getConfig().aggregateMaxExpiry * 1000;

  _.each(statusUpdatesByActivityStreamId, (statusUpdatesByActivityStreamId, activityStreamId) => {
    _.each(statusUpdatesByActivityStreamId, (status, aggregateKey) => {
      const statusKey = _createAggregateStatusCacheKey(aggregateKey);

      // Push the key, value pair into the mset arguments and collect the key as it will need to have its ttl updated
      msetArgs.push(statusKey, JSON.stringify(status));
      keysToExpire.push(statusKey);

      // Keep track of which aggregates are active for an activity stream, so we can reset aggregation per stream
      const activeAggregatesForActivityStreamKey = _createActiveAggregatesForActivityStreamKey(activityStreamId);
      multi.zadd(activeAggregatesForActivityStreamKey, Date.now(), aggregateKey);

      // An aggregate will expire after `aggregateMaxExpiry` seconds
      // There is no point in keeping this set around for any longer than that
      multi.expire(activeAggregatesForActivityStreamKey, ActivitySystemConfig.getConfig().aggregateMaxExpiry);

      // Although we expire the set, it might contain expired items
      // Every time we add something in the set, we remove anything that has expired
      multi.zremrangebyscore(activeAggregatesForActivityStreamKey, 0, maxExpiryAgo);
    });
  });

  // Append the mset command to the multi-command
  multi.mset(msetArgs);

  // For each key to expire, append the Redis 'expire' command to the multi-command
  _.each(keysToExpire, key => {
    multi.expire(key, ActivitySystemConfig.getConfig().aggregateIdleExpiry);
  });

  // Finally execute all the appended commands
  multi.exec(callback);
};

/**
 * Delete all the aggregation data associated to the given aggregate keys. This includes both the status and the aggregated entities.
 *
 * @param  {String[]}  aggregateKeys   The aggregate keys whose history to delete
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const deleteAggregateData = function(aggregateKeys, callback) {
  if (_.isEmpty(aggregateKeys)) {
    return callback();
  }

  // The redis delete ("del") command takes an array of keys to delete. We represent this as an array of cache keys that must be deleted
  const aggregateCacheKeysToDelete = _getAggregateCacheKeysForAggregateKeys(aggregateKeys);

  // Delete all the collected cache keys
  redisClient.del(aggregateCacheKeysToDelete, callback);
};

/**
 * Resets the aggregation process for a set of activity streams.
 * This is accomplished by removing all the aggregate entities and statuses from Redis.
 * When the Activity Aggregator performs its next cycle, it will find 0 active aggregates
 * and thus will not be able to aggregate the activity it's processing with anything.
 *
 * @param  {String[]}   activityStreamIds   The set of activity streams that need to have their aggregation cycle reset
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const resetAggregationForActivityStreams = function(activityStreamIds, callback) {
  // 1. Get all the active aggregates for these activity streams
  getActiveAggregateKeysForActivityStreams(activityStreamIds, (err, activeAggregateKeysForActivityStreams) => {
    if (err) {
      log().error({ err, activityStreamIds }, 'Failed to get the active aggregate keys for a set of activity streams');
      return callback(err);
    }

    // 2. Remove the active aggregates
    const multi = redisClient.multi();
    let allActiveAggregateKeys = [];
    _.each(activeAggregateKeysForActivityStreams, (activeAggregateKeys, index) => {
      const activityStream = activityStreamIds[index];
      if (!_.isEmpty(activeAggregateKeys[1])) {
        // As we will be removing these aggregate keys, they will no longer be active for this stream so we can remove them from the "current active aggregate keys" set
        const activeAggregatesForActivityStreamKey = _createActiveAggregatesForActivityStreamKey(activityStream);
        multi.zrem(activeAggregatesForActivityStreamKey, activeAggregateKeys[1]);

        // Keep track of all the active aggregate keys across activitystreams so we can generate the status and entity cache keys
        // This allows us to delete them in one big `del` command
        allActiveAggregateKeys = allActiveAggregateKeys.concat(activeAggregateKeys[1]);
      }
    });

    // Delete all the active aggregate keys if there are any
    const activeAggregateCacheKeysToDelete = _getAggregateCacheKeysForAggregateKeys(allActiveAggregateKeys);
    if (_.isEmpty(activeAggregateCacheKeysToDelete)) {
      return callback();
    }

    multi.del(activeAggregateCacheKeysToDelete);
    multi.exec(err => {
      if (err) {
        log().error({ err, activityStreamIds }, 'Failed to reset aggregation for a set of activity streams');
        return callback({
          code: 500,
          msg: 'Failed to reset aggregation for a set of activity streams'
        });
      }

      return callback();
    });
  });
};

/**
 * Get all the aggregate keys that are currently active for a set of activity streams
 *
 * @param  {String[]}                   activityStreams                                     The set of activity streams for which to retrieve the active aggregate keys
 * @param  {Function}                   callback                                            Standard callback function
 * @param  {Object}                     callback.err                                        An error that occurred, if any
 * @param  {Array.<Array.<String>>}     callback.activeAggregateKeysForActivityStreams      An array of array of active aggregate keys. Each inner array holds the currently active aggregate keys for an activity stream. The array is in the same order as the passed in `activityStreams` array
 */
const getActiveAggregateKeysForActivityStreams = function(activityStreams, callback) {
  const multi = redisClient.multi();
  const maxExpiryAgo = Date.now() - ActivitySystemConfig.getConfig().aggregateMaxExpiry * 1000;
  _.each(activityStreams, activityStream => {
    const activeAggregatesKey = _createActiveAggregatesForActivityStreamKey(activityStream);
    multi.zrangebyscore(activeAggregatesKey, maxExpiryAgo, '+inf');
  });
  multi.exec((err, activeAggregateKeysForActivityStreams) => {
    if (err) {
      log().error({ err, activityStreams }, 'Failed to get the active aggregate keys for a set of activity streams');
      return callback({
        code: 500,
        msg: 'Failed to get the active aggregate keys for a set of activity streams'
      });
    }

    return callback(null, activeAggregateKeysForActivityStreams);
  });
};

/**
 * Get all the entities that have been aggregated for the aggregate key. The resulting object holds all the actors, objects and targets
 * that have been aggregated for the aggregate key. This is an example of how the object is represented:
 *
 * ```javascript
 *  {
 *      '<aggregateKey0>': {
 *          'actors': {
 *              '<entityKey0>': { <Entity> },
 *              '<entityKey1>': { <Entity> }
 *          },
 *          'objects': {
 *              '<entityKey2>': { <Entity> },
 *              '<entityKey3>': { <Entity> }
 *          },
 *          'targets': {
 *              '<entityKey4>': { <Entity> }
 *          }
 *      },
 *      '<aggregateKey1>': { ... },
 *      ...
 *  }
 * ```
 *
 * @param  {String[]}  aggregateKeys               The aggregate keys for which to fetch the aggregated entities
 * @param  {Function}  callback                    Standard callback function
 * @param  {Object}    callback.err                An error that occurred, if any
 * @param  {Object}    callback.aggregatedEntities An object holding the entities that have been aggregated for the entities. See summary for more information
 */
const getAggregatedEntities = function(aggregateKeys, callback) {
  if (_.isEmpty(aggregateKeys)) {
    return callback(null, {});
  }

  /*!
   * Each aggregate key has actors, objects and targets associated to it, and each of those are stored as separate cache entries. For
   * example:
   *
   * ```
   *  "aggregateKey0:actors": {
   *      "<entityKey0>": "<entityIdentity0>",
   *      "<entityKey1>": "<entityIdentity1>"
   *  }
   *
   *  "aggregateKey0:objects": {
   *      "<entityKey2>": "<entityIdentity2>"
   *  }
   *
   *  "aggregateKey0:targets": {
   *      "<entityKey3>": "<entityIdentity3>"
   *  }
   * ```
   *
   * The "aggregateKey0:actors" value is a cache key and its value is a Redis "hash". The entity keys in the hashes represent all
   * entities that have been aggregated for the associated aggregate key + entity type. The value of the hash is a cache key that
   * can be used to fetch the entity that represents the entity keyed by the entity key.
   *
   * To get all the aggregated entities for an aggregate key, we have to use a redis multi command and parse the result. Here is
   * an example:
   *
   * ```
   *  multi
   *  hgetall "aggregateKey0:actors"
   *  hgetall "aggregateKey0:objects"
   *  hgetall "aggregateKey0:targets"
   *  exec
   * ```
   *
   * This fetches all the actors, objects and targets. The result of this will be an array of the results of each command, separated by a new line:
   *
   * ```
   *  [
   *      {
   *          "<entityKey0>": "<entityIdentity0>",
   *          "<entityKey1>": "<entityIdentity1>"
   *      },
   *      { "<entityKey2>": "<entityIdentity2>" },
   *      { "<entityKey3>": "<entityIdentity3>" }
   *  ]
   * ```
   *
   * To construct the result of the query, a second command is needed to fetch the entities that are represented by the entity identities. That is
   * performed using a Redis multi-get ("mget"), by `_fetchEntitiesByIdentities`.
   */

  // Collect all the hgetall commands for the actor, object and targets of each aggregate key and execute it
  const multiGetAggregateEntities = redisClient.multi();
  _.each(aggregateKeys, aggregateKey => {
    multiGetAggregateEntities.hgetall(_createAggregateEntityCacheKey(aggregateKey, 'actors'));
    multiGetAggregateEntities.hgetall(_createAggregateEntityCacheKey(aggregateKey, 'objects'));
    multiGetAggregateEntities.hgetall(_createAggregateEntityCacheKey(aggregateKey, 'targets'));
  });

  // First fetch the references to the aggregated entity objects
  multiGetAggregateEntities.exec((err, results) => {
    if (err) {
      return callback(err);
    }

    log().trace({ results }, 'Multi fetch identities result.');

    // According to https://github.com/luin/ioredis/wiki/Migrating-from-node_redis
    // the hgetall operation now returns {} instead of null, so let's convert that
    results = results.map(eachResult => {
      if (_.isEmpty(eachResult[1])) eachResult[1] = null;
      return eachResult;
    });

    // Collect all the actual identities that are stored in this result. We will use those to fetch the
    // actual entity contents
    const entityIdentities = {};
    _.each(results, result => {
      if (result && !_.isEmpty(result[1])) {
        _.each(result[1], entityIdentity => {
          if (entityIdentity) {
            entityIdentities[entityIdentity] = true;
          }
        });
      }
    });

    // Get the full entity objects using the identities
    _fetchEntitiesByIdentities(_.keys(entityIdentities), (err, entitiesByIdentity) => {
      if (err) {
        return callback(err);
      }

      const aggregateEntities = {};
      _.each(results, (result, i) => {
        if (result) {
          // Every 3 results is a new aggregate key (one for actor, object and target)
          const aggregateKeyIndex = Math.floor(i / 3);

          // Within each set of 3 results, the first is the actor, the second is object and the 3rd is the target. Use % to select the right one
          const entityIndex = i % 3;

          const aggregateKey = aggregateKeys[aggregateKeyIndex];
          let entityType = null;
          if (entityIndex === 0) {
            entityType = 'actors';
          } else if (entityIndex === 1) {
            entityType = 'objects';
          } else if (entityIndex === 2) {
            entityType = 'targets';
          }

          // Seed the aggregate entities for the aggregate key
          aggregateEntities[aggregateKey] = aggregateEntities[aggregateKey] || {
            actors: {},
            objects: {},
            targets: {}
          };

          log().trace({ aggregate: result[1] }, 'Iterating aggregated entity identities to map to full entities');

          _.each(result[1], (identity, entityKey) => {
            // Grab the entity from the identity map that was fetched
            aggregateEntities[aggregateKey][entityType][entityKey] = entitiesByIdentity[identity];
          });
        }
      });

      log().trace({ aggregateEntities }, 'Fetched aggregated entities.');

      return callback(null, aggregateEntities);
    });
  });
};

/**
 * Fetch the entity objects that are referenced by the given array of identities.
 *
 * @param  {String[]}   entityIdentities    The identities that reference the entities to fetch
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @api private
 */
const _fetchEntitiesByIdentities = function(entityIdentities, callback) {
  if (_.isEmpty(entityIdentities)) {
    return callback(null, {});
  }

  const entitiesByIdentity = {};

  // Convert the entity identities into their associated cache keys
  const entityIdentityCacheKeys = _.map(entityIdentities, entityIdentity => {
    return _createEntityIdentityCacheKey(entityIdentity);
  });

  redisClient.mget(entityIdentityCacheKeys, (err, results) => {
    if (err) {
      return callback(err);
    }

    // Parse each entity from storage as they are stored as stringified JSON
    _.each(results, (entityStr, i) => {
      if (entityStr) {
        try {
          entitiesByIdentity[entityIdentities[i]] = JSON.parse(entityStr);
        } catch (error) {
          log().warn({ entityStr }, 'Failed to parse aggregated activity entity from redis. Skipping.');
        }
      }
    });

    log().trace(
      {
        entityIdentities,
        entitiesByIdentity
      },
      'Fetched entities by identity from redis.'
    );

    return callback(null, entitiesByIdentity);
  });
};

/**
 * Save the aggregated entities for the specified aggregates.
 *
 * @param  {Object}    aggregates      An object keyed by aggregateKey whose value is an aggregate object containing the `actors`, `objects` and `targets` entities to add to the aggregated entities
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const saveAggregatedEntities = function(aggregates, callback) {
  if (_.isEmpty(aggregates)) {
    return callback();
  }

  log().trace({ aggregates }, 'Saving aggregate entities.');

  /*!
   * For details on how these are persisted in redis, see the large summary comment within #getAggregatedEntities
   */

  const multi = redisClient.multi();
  _.each(aggregates, (aggregate, aggregateKey) => {
    const hmsetActorArgs = [];
    const hmsetObjectArgs = [];
    const hmsetTargetArgs = [];

    const aggregateActorsKey = _createAggregateEntityCacheKey(aggregateKey, 'actors');
    const aggregateObjectsKey = _createAggregateEntityCacheKey(aggregateKey, 'objects');
    const aggregateTargetsKey = _createAggregateEntityCacheKey(aggregateKey, 'targets');

    // Stores a mapping of identity -> full entity. These are stored by reference to avoid many duplicates consuming memory
    const entitiesByIdentity = {};

    // To set all the entity hash values, we use the Redis Hash Multi-set ("hmset") command. The args for each command starts with
    // the cache key, followed by key-value pairs for the hash key and the hash value.
    if (!_.isEmpty(aggregate.actors)) {
      // First push the cache key
      _.each(aggregate.actors, (actor, actorKey) => {
        const identity = _createEntityIdentity(actor, actorKey);

        // Then push the entity reference (its identity)
        hmsetActorArgs.push(actorKey, identity);

        // Record the entity by its identity, as we will need to store it separately
        entitiesByIdentity[identity] = actor;
      });
    }

    if (!_.isEmpty(aggregate.objects)) {
      // First push the cache key
      _.each(aggregate.objects, (object, objectKey) => {
        const identity = _createEntityIdentity(object, objectKey);

        // Then push the entity reference (its identity)
        hmsetObjectArgs.push(objectKey, identity);

        // Record the entity by its identity, as we will need to store it separately
        entitiesByIdentity[identity] = object;
      });
    }

    if (!_.isEmpty(aggregate.targets)) {
      // First push the cache key
      _.each(aggregate.targets, (target, targetKey) => {
        const identity = _createEntityIdentity(target, targetKey);

        // Then push the entity reference (its identity)
        hmsetTargetArgs.push(targetKey, identity);

        // Record the entity by its identity, as we will need to store it separately
        entitiesByIdentity[identity] = target;
      });
    }

    log().trace(
      {
        actorArgs: hmsetActorArgs,
        objectArgs: hmsetObjectArgs,
        targetArgs: hmsetTargetArgs
      },
      'Setting hmset arguments for saving queued activities.'
    );

    // Append each set operation to the multi command
    if (hmsetActorArgs.length > 0) {
      multi.hmset(aggregateActorsKey, hmsetActorArgs);
    }

    if (hmsetObjectArgs.length > 0) {
      multi.hmset(aggregateObjectsKey, hmsetObjectArgs);
    }

    if (hmsetTargetArgs.length > 0) {
      multi.hmset(aggregateTargetsKey, hmsetTargetArgs);
    }

    // Since we've updated this, we reset the expiry so it will be removed after the idle time
    multi.expire(aggregateActorsKey, ActivitySystemConfig.getConfig().aggregateIdleExpiry);
    multi.expire(aggregateObjectsKey, ActivitySystemConfig.getConfig().aggregateIdleExpiry);
    multi.expire(aggregateTargetsKey, ActivitySystemConfig.getConfig().aggregateIdleExpiry);

    // Set the actual entity object values into redis using an mset
    const msetArgs = [];
    const toExpire = [];
    _.each(entitiesByIdentity, (entity, identity) => {
      const identityCacheKey = _createEntityIdentityCacheKey(identity);
      // Redis mset arguments are: key, value, key1, value1, etc...
      msetArgs.push(identityCacheKey, JSON.stringify(entity));

      // We also collect the redis keys that will need to be expired (see below)
      toExpire.push(identityCacheKey);
    });

    log().trace({ msetArgs }, 'Persisting entities in redis by identity.');

    multi.mset(msetArgs);

    // We need to reset the expiry of each identity-entity pair to the aggregatedMaxExpiry to ensure that the entities
    // live as long as any aggregate referencing it needs it for aggregation. This *cannot* be the aggregateIdleExpiry
    // because an aggregate can be updated with a *different* entity, in which case this entity may expire before the
    // aggregate expires, and that would be bad.
    _.each(toExpire, identityCacheKey => {
      multi.expire(identityCacheKey, ActivitySystemConfig.getConfig().aggregateMaxExpiry);
    });
  });

  // Finally execute the commands
  multi.exec(callback);
};

/**
 * Create a unique string identifier for an activity that was posted at the given publishing date.
 *
 * @param  {Number}    published   The time (millis since the epoch) that the activity was published.
 * @return {String}                A unique identifier for the activity.
 */
const createActivityId = function(published) {
  // An example activity id is: 123456789:PTewoief
  return util.format('%s:%s', published, ShortId.generate());
};

/// /////////
// EMAILS //
/// /////////

/**
 * Queue a set of user IDs for email collection. They will be checked at the appropriate time
 * for email delivery.
 *
 * @param  {Object}     emailBuckets    The user IDs that should be queued for email delivery, keyed by the email bucket id
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const saveQueuedUserIdsForEmail = function(emailBuckets, callback) {
  if (_.isEmpty(emailBuckets)) {
    return callback();
  }

  const queries = [];
  _.each(emailBuckets, (userIds, bucketId) => {
    _.each(userIds, userId => {
      queries.push({
        query: 'INSERT INTO "EmailBuckets" ("bucketId", "userId") VALUES (?, ?)',
        parameters: [bucketId, userId]
      });
    });
  });

  Cassandra.runBatchQuery(queries, callback);
};

/**
 * Get a set of users that are queued in a specific bucket
 *
 * @param  {String}     bucketId                Which bucket to collect
 * @param  {String}     [start]                 The user id to start paging from
 * @param  {Number}     limit                   The number of users ids that should be retrieved
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {String[]}   callback.userIds        The IDs of the users that were in this bucket
 * @param  {String}     callback.nextToken      The value that can be used as the `opts.start` parameter for the next query to get the next page of item
 */
const getQueuedUserIdsForEmail = function(bucketId, start, limit, callback) {
  Cassandra.runPagedQuery(
    'EmailBuckets',
    'bucketId',
    bucketId,
    'userId',
    start,
    limit,
    { end: '|' },
    (err, rows, nextToken) => {
      if (err) {
        return callback(err);
      }

      const userIds = _.map(rows, row => {
        return row.get('userId');
      });

      return callback(null, userIds, nextToken);
    }
  );
};

/**
 * Unqueue a set of users from a bucket
 *
 * @param  {String}     bucketId            The ID of the bucket out of which the users should be unqueued
 * @param  {String[]}   userIds             The IDs of the users that should be unqueued
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const unqueueUsersForEmail = function(bucketId, userIds, callback) {
  if (_.isEmpty(userIds)) {
    return callback();
  }

  const queries = _.map(userIds, userId => {
    return {
      query: 'DELETE FROM "EmailBuckets" WHERE "bucketId" = ? AND "userId" = ?',
      parameters: [bucketId, userId]
    };
  });
  Cassandra.runBatchQuery(queries, callback);
};

/// ////////////////
// NOTIFICATIONS //
/// ////////////////

/**
 * Reset the notifications unread count to 0 in the notifications cache. This *only* updates the cached copy of
 * the count.
 *
 * @param  {String}     userId          The id of the user whose notifications unread count to reset
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const clearNotificationsUnreadCount = function(userId, callback) {
  const cacheKey = _createNotificationCountCacheKey(userId);
  redisClient.del(cacheKey, callback);
};

/**
 * Increment the notifications counts for all the provided users, by the number provided for each user.
 *
 * @param  {Object}     userIdsIncrBy       An object whose key is the userId, and the value is the number by which to increment their notifications unread count
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Object}     callback.newCounts  An object whose key is the userId, and the value is the new count value for each user
 */
const incrementNotificationsUnreadCounts = function(userIdsIncrBy, callback) {
  // Filter out those users whose notification count should be "incremented" by 0
  const userIds = _.chain(userIdsIncrBy)
    .keys()
    .filter(userId => {
      return userIdsIncrBy[userId] !== 0;
    })
    .value();

  // Return back to the caller if there are no real updates to perform
  if (_.isEmpty(userIds)) {
    return callback(null, {});
  }

  // We use a batch of Redis incrby commands to update each count
  const multi = redisClient.multi();
  _.each(userIds, userId => {
    const cacheKey = _createNotificationCountCacheKey(userId);
    multi.incrby(cacheKey, userIdsIncrBy[userId]);
  });

  multi.exec((err, results) => {
    if (err) {
      return callback(err);
    }

    /*!
     * The result is the new counts for the cache keys, separated by new line:
     *
     *  <userId0>
     *  7
     *  <userId1>
     *  3
     * ...
     */
    const newValues = {};
    _.each(results, (newValue, i) => {
      newValues[userIds[i]] = newValue[1];
    });

    return callback(null, newValues);
  });
};

/**
 * Convert Cassandra ActivityStreams rows into an array of activities
 *
 * @param  {Row[]}      columns     The Cassandra rows from which to extract the activities
 * @return {Object}                 The activities that were extracted from the rows
 * @api private
 */
const _rowsToActivities = function(rows) {
  const activities = [];
  _.each(rows, row => {
    const activityId = row.get('activityId');
    let activityStr = row.get('activity');
    try {
      activities.push(JSON.parse(activityStr));
    } catch (error) {
      activityStr = activityStr.slice(0, 300);
      log().warn({ err: error, activityId, value: activityStr }, 'Error parsing activity from Cassandra');
    }
  });
  return activities;
};

/**
 * Given an entity, create an identity key that represents its unique contents.
 *
 * @param  {Object}     The persistent entity for which to create an identity
 * @param  {String}     The key of the entity forwhich to create an identity
 */
const _createEntityIdentity = function(entity, entityKey) {
  const md5sum = crypto.createHash('md5');

  // We're simply using `JSON.stringify`, but is not perfect as object properties could technically be in a different
  // order. Assuming most objects are built in the same way this should be fine, however it would be more correct to
  // use a deep-normalized representation by, say, sorting the keys or something.
  md5sum.update(JSON.stringify(entity));
  return util.format('%s:%s', entityKey, md5sum.digest('hex'));
};

/**
 * Get the storage key for an activity bucket.
 *
 * @param  {Number}     bucketNumber    The number of the bucket whose id to create
 * @api private
 */
const _createBucketCacheKey = function(bucketNumber) {
  // Looks like: oae-activity:bucket:0
  return util.format('oae-activity:bucket:%s', bucketNumber);
};

/**
 * Get the storage key for the status of an aggregate key.
 *
 * @param  {String}     aggregateKey    The aggregate key for which to get the status storage key
 * @return {String}                     The storage key for the aggregate's status entity
 * @api private
 */
const _createAggregateStatusCacheKey = function(aggregateKey) {
  // Looks like oae-activity:aggregate:<aggregateKey>:status
  return util.format('oae-activity:aggregate:%s:status', aggregateKey);
};

/**
 * Get the storage keys for both the status and all the entities associated with a set of aggregate keys.
 *
 * @param  {String[]}   activeAggregateKeys     A set of aggregate keys for which to retrieve the status and entity cache keys
 * @return {String[]}                           The storage keys for the aggregates their status and cached entities
 * @api private
 */
const _getAggregateCacheKeysForAggregateKeys = function(aggregateKeys) {
  const aggregateCacheKeys = [];
  _.each(aggregateKeys, aggregateKey => {
    aggregateCacheKeys.push(_createAggregateStatusCacheKey(aggregateKey));
    aggregateCacheKeys.push(_createAggregateEntityCacheKey(aggregateKey, 'actors'));
    aggregateCacheKeys.push(_createAggregateEntityCacheKey(aggregateKey, 'objects'));
    aggregateCacheKeys.push(_createAggregateEntityCacheKey(aggregateKey, 'targets'));
  });
  return aggregateCacheKeys;
};

/**
 * Get the storage key for the aggregated entities of an aggregate.
 *
 * @param  {String}     aggregateKey    The aggregate key for which to get the entity storage key
 * @param  {String}     entityType      The type of entity for which to generate the storage key. One of "actors", "objects", "targets"
 * @return {String}                     The storage key for the aggregate's aggregated entities
 * @api private
 */
const _createAggregateEntityCacheKey = function(aggregateKey, entityType) {
  // Looks like oae-activity:aggregate:<aggregateKey>:actor:entities
  return util.format('oae-activity:aggregate:%s:%s:entities', aggregateKey, entityType);
};

/**
 * Create the storage key for an entity given its identity.
 *
 * @param  {String}     identity    The entity identity with which to create the cache key
 * @return {String}                 The storage key for the entity with the given identity
 * @api private
 */
const _createEntityIdentityCacheKey = function(identity) {
  return util.format('oae-activity:entity:%s', identity);
};

/**
 * Get the key for a routed activity.
 *
 * @param  {Object}     routedActivity  An object with key `route` for the route to which the activity is being routed, and `activity` representing the activity.
 * @return {String}                     The routed activity key
 * @api private
 */
const _createRoutedActivityKey = function(routedActivity) {
  // Looks like <activityId>:u:cam:dfjDFOij
  return util.format(
    '%s:%s',
    routedActivity.activity[ActivityConstants.properties.OAE_ACTIVITY_ID],
    routedActivity.route
  );
};

/**
 * Get the key that holds the unread count for the user with the provided userId
 *
 * @param  {String}     userId  The id of the user
 * @return {String}             The cache key for the counts of the user
 * @api private
 */
const _createNotificationCountCacheKey = function(userId) {
  return util.format('oae-activity:notification-count:%s', userId);
};

/**
 * Get the key that holds the set of active aggregate keys for an activity stream
 *
 * @param  {String} activityStream The activity stream for which to get the key that holds the active aggregate keys
 * @return {String}                The key that holds the set of active aggregate keys for the activity stream
 * @api private
 */
const _createActiveAggregatesForActivityStreamKey = function(activityStream) {
  return util.format('oae-activity:active-aggregates:%s', activityStream);
};

export {
  init,
  getActivities,
  getActivitiesFromStreams,
  deliverActivities,
  deleteActivities,
  clearActivityStream,
  saveQueuedActivities,
  getQueuedActivities,
  deleteQueuedActivities,
  getAggregateStatus,
  indexAggregateData,
  deleteAggregateData,
  resetAggregationForActivityStreams,
  getActiveAggregateKeysForActivityStreams,
  getAggregatedEntities,
  saveAggregatedEntities,
  createActivityId,
  saveQueuedUserIdsForEmail,
  getQueuedUserIdsForEmail,
  unqueueUsersForEmail,
  clearNotificationsUnreadCount,
  incrementNotificationsUnreadCounts
};
