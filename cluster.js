/*
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

var argv = require('optimist')
    .alias('c', 'cpu')
    .describe('c', 'The number of Node.js processes to start in a cluster')
    .default('c', require('os').cpus().length)
    .argv;

var cluster = require('cluster');
var log = require('oae-logger').logger('cluster');
var Validator = require('oae-util/lib/validator').Validator;

// Check whether or not the passed in number of required Node.js processes is a valid number
var validator = new Validator();
validator.check(argv['c'], {'code': 400, 'msg': 'A valid number of Node.js proccesses needs to be supplied'}).isInt();
if (validator.hasErrors()) {
    return log().error(validator.getFirstError());
}

if (cluster.isMaster) {
    // Start up the right number of workers
    for (var c = 0; c < argv['c']; c++) {
        cluster.fork();
    }

    // When one of the worker dies, we respawn it
    cluster.on('death', function(worker) {
        log().error('Worker ' + worker.pid + ' died. Respawning worker.');
        cluster.fork();
    });

} else {
    // Start up a worker
    require('./app.js');
}
