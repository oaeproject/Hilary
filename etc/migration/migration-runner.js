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

/* eslint-disable node/no-unsupported-features/es-syntax */

import fs from 'node:fs';
import path from 'node:path';
import { callbackify, promisify } from 'node:util';
import process from 'node:process';

import ora from 'ora';
import { createKeyspace } from 'oae-util/lib/cassandra.js';
import * as LogAPI from 'oae-logger';

import { reduce } from 'ramda';
import { serial } from 'oae-util/lib/util.js';
import { config } from '../../config.js';

const _createLogger = function (config) {
  LogAPI.refreshLogConfiguration(config.log);
  return LogAPI.logger();
};

const log = _createLogger(config);

const readFolderContents = promisify(fs.readdir);
const checkIfExists = promisify(fs.stat);

const PACKAGES_FOLDER = path.join(process.cwd(), 'packages');
const LIB_FOLDER = 'lib';
const MIGRATION_FILE = 'migration.js';

const lookForMigrations = async function (allModules) {
  const migrationsToRun = [];

  const spinner = ora({
    text: `Looking for migrations...`
  }).start();

  for (const eachModule of allModules) {
    if (eachModule.startsWith('oae-')) {
      const migrationFilePath = path.join(PACKAGES_FOLDER, eachModule, LIB_FOLDER, MIGRATION_FILE);
      try {
        // eslint-disable-next-line no-await-in-loop
        const migrateFileExists = await checkIfExists(migrationFilePath);

        if (migrateFileExists.isFile()) {
          migrationsToRun.push({ name: eachModule, file: migrationFilePath });
          spinner.info(`Stacked migrations for ${eachModule}`);
        }
      } catch {
        spinner.info(`No migrations found for ${eachModule}`);
      }
    }
  }

  spinner.stop();
  return migrationsToRun;
};

const runMigrations = function (dbConfig, callback) {
  callbackify(promiseToRunMigrations)(dbConfig, (error, result) => {
    if (error) return callback(error);

    return callback(result);
  });
};

const promiseToRunMigrations = function (dbConfig) {
  const spinner = ora({
    text: 'Running migrations for keyspace ' + dbConfig.keyspace + '...'
  }).start();
  const data = {};

  return readFolderContents(PACKAGES_FOLDER)
    .then((allModules) => {
      data.allModules = allModules;
      return lookForMigrations(allModules);
    })
    .then((allMigrationsToRun) => {
      data.allMigrationsToRun = allMigrationsToRun;
    })
    .then(() => import(path.join(PACKAGES_FOLDER, 'oae-util', LIB_FOLDER, 'cassandra.js')))
    .then((cassandraModule) => {
      spinner.succeed(`Loaded cassandra driver`);
      const initCassandra = promisify(cassandraModule.init);
      return initCassandra(dbConfig);
    })
    .then(() => bootstrapMigrations(data.allMigrationsToRun))
    .then(() => {
      spinner.succeed('Migrations completed.');

      const createEtherpadKeyspace = createKeyspace;
      return createEtherpadKeyspace('etherpad');
    })
    .then(() => {
      spinner.succeed('Etherpad keyspace created.');
      spinner.info('All set!');
    })
    .catch((error) => {
      spinner.fail('Error running migrations!');
      log().error(error);
    })
    .finally(() => {
      spinner.info('Exiting...');
      spinner.stop();
    });
};

const bootstrapMigrations = (migrations) => {
  let spinner;

  return serial(
    migrations.map(
      (eachMigration) => () =>
        new Promise((resolve, reject) => {
          spinner = ora({
            text: `Running migrations for module ${eachMigration.name}...`
          }).start();

          promisify(fs.stat)(eachMigration.file).then((stat) => {
            if (stat.isFile()) {
              import(eachMigration.file)
                .then((eachModule) => promisify(eachModule.ensureSchema)())
                .then((loadedSchema) => {
                  spinner.succeed(`Schema updated for module ${eachMigration.name}`);
                  resolve(loadedSchema);
                })
                .catch((error) => {
                  spinner.fail(`Failed to update schema for module ${eachMigration.name}`);
                  log().error(error);
                  reject(error);
                });
            }
          });
        })
          .catch((_error) => {
            // there's no migration method, skipping
            spinner.info(`No schema found for module ${eachMigration}`);
          })
          .finally(() => {
            spinner.stop();
          })
    )
  );
};

export { promiseToRunMigrations, runMigrations };
