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

import * as Redis from './redis';
import { Validator } from './validator';

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
    retryCount: -1
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
 * @param  {String}    callback.token  An identifier for the lock that was granted. If unspecified, the lock was already held by someone else
 */
const acquire = function(lockKey, expiresIn, callback) {
  const validator = new Validator();
  validator
    .check(lockKey, {
      code: 400,
      msg: 'The key of the lock to try and acquire needs to be specified'
    })
    .notNull();
  validator
    .check(expiresIn, {
      code: 400,
      msg: 'The maximum number of seconds for which to hold the lock needs to be specified'
    })
    .notNull();
  validator
    .check(expiresIn, {
      code: 400,
      msg: 'The maximum number of seconds for which to hold the lock needs to be an integer'
    })
    .isInt();
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  log().trace({ lockKey }, 'Trying to acquire lock.');

  locker.lock(lockKey, expiresIn * 1000, callback);
};

/**
 * Release a lock
 *
 * @param  {String}     lockKey             The unique key for the lock to release
 * @param  {String}     token               The identifier of the lock that was given when the lock was acquired
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.hadLock    Specifies whether or not we actually released a lock
 */
const release = function(lockKey, token, callback) {
  const validator = new Validator();
  validator
    .check(lockKey, {
      code: 400,
      msg: 'The key of the lock to try and release needs to be specified'
    })
    .notNull();
  validator
    .check(token, {
      code: 400,
      msg: 'The identifier of the lock that was given when the lock was acquired needs to be specified'
    })
    .notNull();
  if (validator.hasErrors()) {
    return callback(validator.getFirstError());
  }

  // the first parameter is not necessary after the
  // migration from redback to redlock
  locker.unlock(token, callback);
};

export { init, acquire, release };
