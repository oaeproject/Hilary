/*!
 * Copyright 2019 Apereo Foundation (AF) Licensed under the
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

/**
 * This is a simple tool for keeping an eye on redis queues that
 * are relevant to OAE such as activity, search and preview generation
 *
 * To run this as a standalone app on the terminal, do as follows:
 * 1 npm install chalk (it's a dev dependency so it might not have been installed)
 * 2 node -r esm redismon.js
 */
import Redis from 'ioredis';
import _ from 'underscore';
import chalk from 'chalk';

const { log, clear } = console;
const TIMEOUT = 1000;

import { config } from './config';
const connection = new Redis(config.redis);

const queues = {
  'Activity generation': [
    'oae-activity/activity',
    'oae-activity/activity-processing',
    'oae-activity/activity-redelivery'
  ],
  'Search index': ['oae-search/index', 'oae-search/index-processing', 'oae-search/index-redelivery'],
  'Search delete': ['oae-search/delete', 'oae-search/delete-processing', 'oae-search/delete-redelivery'],
  'Search reindex': ['oae-search/reindex', 'oae-search/reindex-processing', 'oae-search/reindex-redelivery'],
  'Etherpad publish': [
    'oae-content/etherpad-publish',
    'oae-content/etherpad-publish-processing',
    'oae-content/etherpad-publish-redelivery'
  ],
  'Ethercalc publish': [
    'oae-content/ethercalc-publish',
    'oae-content/ethercalc-publish-processing',
    'oae-content/ethercalc-publish-redelivery'
  ],
  'Ethercalc edit': [
    'oae-content/ethercalc-edit',
    'oae-content/ethercalc-edit-processing',
    'oae-content/ethercalc-edit-redelibery'
  ],
  'Generate previews': [
    'oae-preview-processor/generatePreviews',
    'oae-preview-processor/generatePreviews-processing',
    'oae-preview-processor/generatePreviews-redelivery'
  ],
  'Generate folder previews': [
    'oae-preview-processor/generateFolderPreviews',
    'oae-preview-processor/generateFolderPreviews-processing',
    'oae-preview-processor/generateFolderPreviews-redelivery'
  ],
  'Regenerate previews': [
    'oae-preview-processor/regeneratePreviews',
    'oae-preview-processor/regeneratePreviews-processing',
    'oae-preview-processor/regeneratePreviews-redelivery'
  ]
};

const showResults = async () => {
  const allKeys = _.keys(queues);
  await printKeys(allKeys);

  setTimeout(() => {
    clear();
    showResults();
  }, TIMEOUT);
};

const printKeys = async allKeys => {
  if (allKeys.length === 0) {
    return;
  }

  const someKey = allKeys.shift();
  await printSomeKey(someKey);
  return printKeys(allKeys);
};

const printSomeKey = async someKey => {
  log(chalk.magenta(`\n   ${someKey}`));
  const allKeyQs = queues[someKey].slice(0);
  await printAllQs(allKeyQs);
};

const printAllQs = async allQs => {
  if (allQs.length === 0) return;

  const someQueue = allQs.shift();
  await printSomeQ(someQueue);
  return printAllQs(allQs);
};

const printSomeQ = async someQ => {
  await connection.llen(someQ).then(count => {
    const qName = someQ.split('/');

    let displayCount = chalk.greenBright;
    let displayQ = chalk.cyanBright;
    if (count > 0) {
      displayCount = chalk.redBright;
      displayQ = chalk.redBright;
    }

    log(`   [${displayCount(count)}] <- [${chalk.yellowBright(qName[0])} / ${displayQ(qName[1])}]`);
  });
};

showResults();
