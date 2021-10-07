#!/usr/bin/env node
/**
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

import process from 'node:process';
import optimist from 'optimist';
import { not, compose, equals } from 'ramda';

import { promiseToRunMigrations } from './etc/migration/migration-runner.js';
import { config } from './config.js';

const isNotTrue = compose(not, equals(true));
const dbConfig = config.cassandra;

const { argv } = optimist
  .usage('$0 [--keyspace <keyspace>]')
  .alias('k', 'keyspace')
  .describe('k', 'Specify the keyspace for running the migrations')
  .default('k', dbConfig.keyspace);

if (argv.help) {
  optimist.showHelp();
  process.exit(0);
}

// If `argv.keyspace` equals `true` then it is not defined, so default it is
if (isNotTrue(argv.keyspace)) {
  dbConfig.keyspace = argv.keyspace;
}

(async function () {
  await promiseToRunMigrations(dbConfig);
  process.exit(0);
})();
