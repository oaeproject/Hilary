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

var redback = require('redback');
var ShortId = require('shortid');

var log = require('oae-logger').logger('oae-util-locking');
var Redis = require('./redis');
var Validator = require('./validator').Validator;

var lock = null;

/**
 * Initialize the Redis based locking
 */
var init = module.exports.init = function() {
    lock = redback.use(Redis.getClient()).createLock('oae');
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
var acquire = module.exports.acquire = function(lockKey, expiresIn, callback) {
    var validator = new Validator();
    validator.check(lockKey, {'code': 400, 'msg': 'The key of the lock to try and acquire needs to be specified'}).notNull();
    validator.check(expiresIn, {'code': 400, 'msg': 'The maximum number of seconds for which to hold the lock needs to be specified'}).notNull();
    validator.check(expiresIn, {'code': 400, 'msg': 'The maximum number of seconds for which to hold the lock needs to be an integer'}).isInt();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    log().trace({'lockKey': lockKey}, 'Trying to acquire lock.');

    lock.acquire(lockKey, expiresIn, callback);
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
var release = module.exports.release = function(lockKey, token, callback) {
    var validator = new Validator();
    validator.check(lockKey, {'code': 400, 'msg': 'The key of the lock to try and release needs to be specified'}).notNull();
    validator.check(token, {'code': 400, 'msg': 'The identifier of the lock that was given when the lock was acquired needs to be specified'}).notNull();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    lock.release(lockKey, token, callback);
};
