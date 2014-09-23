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

var _ = require('underscore');
var events = require('events');
var fs = require('fs');
var path = require('path');

var log = require('oae-logger').logger('oae-cleaner');

var cleaners = {};

/**
 * ## Events
 *
 * * `cleaned(directory)` - A clean cycle just finished on a directory. The `directory` is provided as an event parameter.
 */
var Cleaner = module.exports = new events.EventEmitter();

/**
 * Starts a cleaning job.
 *
 * @param  {String}     directory   The path to the directory that should be cleaned.
 * @param  {Number}     interval    The interval (in seconds) at which the directory should be cleaned out.
 */
var start = module.exports.start = function(directory, interval) {
    // Take care of double slashes
    directory = path.normalize(directory);
    log().info({ 'interval': interval, 'directory': directory }, 'Starting clean job.');

    // Start it once and than start the interval
    cleanDirectory(interval, directory);
    cleaners[directory] = setInterval(cleanDirectory, interval, interval, directory);
};

/**
 * Stops a cleaning job.
 *
 * @param  {String}     directory   The path to the directory for which the cleaning job should be stopped.
 */
var stop = module.exports.stop = function(directory) {
    if (cleaners[directory]) {
        log().info({ 'directory': directory }, 'Stopping clean job.');
        clearInterval(cleaners[directory]);
    } else {
        log().warn({ 'directory': directory }, 'A request to stop an unknown cleaning job was made.');
    }
};

/**
 * Cleans a directory.
 *
 * @param  {Number} interval    Files who haven't been accessed in this number of seconds will be removed.
 * @param  {String} directory   The path to the directory that should be cleaned.
 * @api private
 */
var cleanDirectory = function(interval, directory) {
    fs.readdir(directory, function(err, files) {
        if (err) {
            return log().error({'err': err, 'directory': directory}, 'Could not list the files.');
        }

        var paths = _.map(files, function(file) {
            return directory + '/' + file;
        });

        var time = Date.now() - (interval * 1000);
        checkFiles(paths, time, function() {
            Cleaner.emit('cleaned', directory);
        });
    });
};

/**
 * Checks if a file is older than a specified time and removes it if it is.
 *
 * @param  {String}     path            The path to the file to check
 * @param  {String}     time            The time (in ms since epoch) when a file is considered outdated.
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
var checkFile = function(path, time, callback) {
    fs.stat(path, function(err, stats) {
        // We can ignore "no such file"-errors as this function intends to remove the file anyway.
        // These errors can ocurr when another method cleans up after themselves right between the cleaner doing a `fs.readdir` and `fs.stat`.
        if (err && err.code === 'ENOENT') {
            // There is nothing further to do if the file has been removed
            return callback();

        // If we get an error that is not a "no such file"-error, something is probably wrong
        } else if (err) {
            log().error({'err': err, 'path': path}, 'Could not get the metadata for a file.');
            return callback(err);
        }

        // Only try to unlink file resources that have expired
        if (stats && stats.isFile() && stats.atime.getTime() < time) {
            log().info({'path': path, 'lastModified': stats.atime.getTime(), 'expires': time}, 'Deleting expired temporary file.');
            fs.unlink(path, function(err) {
                // Only report the error if it's not a "no such file"-error
                if (err && err.code !== 'ENOENT') {
                    log().error({'err': err, 'path': path}, 'Could not delete an expired temporary file.');
                    return callback(err);
                }
                callback();
            });
        } else {
            callback();
        }
    });
};

/**
 * Checks a set of files if they are older than a specified time and removes them if they are.
 *
 * @param  {String[]}   paths           The set of paths to check.
 * @param  {String}     time            The time (in ms since epoch) when a file is considered outdated.
 * @param  {Function}   [callback]      Invoked when all files in the `paths` array have been addressed
 * @api private
 */
var checkFiles = function(paths, time, callback) {
    if (_.isEmpty(paths)) {
        return callback();
    }

    var path = paths.pop();
    checkFile(path, time, function(err) {
        // We don't abort the whole process because a file fails to be checked.
        // Error messagess will have been logged in the `checkFile` method, there is no need to
        // log them here again.
        checkFiles(paths, time, callback);
    });
};
