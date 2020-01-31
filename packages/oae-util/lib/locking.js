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

import Redlock from 'redlock';

import { logger } from 'oae-logger';

import pipe from 'ramda/src/pipe';
import isInt from 'validator/lib/isInt';
import * as Redis from './redis';
import { Validator as validator } from './validator';

const log = logger('oae-util-locking');

let locker = null;

/**
 * Initialize the Redis based locking
 */
const init = function() {
  locker = new Redlock([Redis.getClient()], {
    /**
     * From https://www.npmjs.com/package/redlock#how-do-i-check-if-something-is-locked:
     *
     * Redlock cannot tell you with certainty if a resource is currently locked.
     * For example, if you are on the smaller side of a network partition you will fail to acquire a lock,
     * but you don't know if the lock exists on the other side; all you know is that you can't
     * guarantee exclusivity on yours.
     *
     * That said, for many tasks it's sufficient to attempt a lock with retryCount=0, and treat a
     * failure as the resource being "locked" or (more correctly) "unavailable",
     * With retryCount=-1 there will be unlimited retries until the lock is aquired.
     */
    retryDelay: 500, // the time in ms between attempts
    retryJitter: 500, // the max time in ms randomly added to retries to improve performance under high contention
    retryCount: 0 // the max number of times Redlock will attempt to lock a resource before erroring
  });
};

/**
 * Try and acquire a temporary lock with the specified key. The lock key should be unique to your module, so it
 * would be best to namespace it accordingly. For example:
 *
 *  "oae-activity:bucket:lock"
 *
 * @param  {String}    lockKey         The key of the lock to try and acquire
 * @param  {Number}    expiresIn       Maximum number of seconds for which to hold the lock
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @param  {Object}    callback.lock   An object which is the actual Lock that was granted
 * @returns {Function}                 Returns a callback
 */
const acquire = function(lockKey, expiresIn, callback) {
  try {
    pipe(
      validator.isDefined,
      validator.generateError({
        code: 400,
        msg: 'The key of the lock to try and acquire needs to be specified'
      })
    )(lockKey);

    pipe(
      validator.isDefined,
      validator.generateError({
        code: 400,
        msg: 'The maximum number of seconds for which to hold the lock needs to be specified'
      })
    )(expiresIn);

    pipe(
      isInt,
      validator.generateError({
        code: 400,
        msg: 'The maximum number of seconds for which to hold the lock needs to be an integer'
      })
    )(String(expiresIn));
  } catch (error) {
    return callback(error);
  }

  log().trace({ lockKey }, 'Trying to acquire lock.');

  locker.lock(lockKey, expiresIn * 1000, (err, lock) => {
    if (err) {
      log().warn({ err }, 'Unable to lock for ' + lockKey);
      return callback(err);
    }

    return callback(null, lock);
  });
};

/**
 * Release a lock
 *
 * @param   {Object}     lock                Lock to be released
 * @param   {Function}   callback            Standard callback function
 * @param   {Object}     callback.err        An error that occurred, if any
 * @param   {Boolean}    callback.hadLock    Specifies whether or not we actually released a lock
 * @returns {Function}                      Returns a callback
 */
const release = function(lock, callback) {
  try {
    pipe(
      validator.isNotNull,
      validator.generateError({
        code: 400,
        msg: 'The key of the lock to try and release needs to be specified'
      })
    )(lock);
  } catch (error) {
    return callback(error);
  }

  // the first parameter is not necessary after the
  // migration from redback to redlock
  locker.unlock(lock, err => {
    if (err) {
      log().error({ err }, 'Unable to release the lock ' + lock.value);
      return callback(err);
    }

    return callback();
  });
};

export { init, acquire, release };
