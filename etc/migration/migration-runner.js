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

import { createKeyspace } from 'oae-util/lib/cassandra.js';
import { config } from '../../config.js';
import ora from 'ora';

import fs from 'fs';
import path from 'path';
import { callbackify, promisify } from 'util';
import PrettyStream from 'bunyan-prettystream';
import * as LogAPI from 'oae-logger';

import { eachSeries } from 'async';

const _createLogger = function (config) {
  const prettyLog = new PrettyStream();
  prettyLog.pipe(process.stdout);
  config.log.streams[0].stream = prettyLog;
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

  for (const eachModule of allModules) {
    if (eachModule.startsWith('oae-')) {
      const migrationFilePath = path.join(PACKAGES_FOLDER, eachModule, LIB_FOLDER, MIGRATION_FILE);
      try {
        // eslint-disable-next-line no-await-in-loop
        const migrateFileExists = await checkIfExists(migrationFilePath);

        if (migrateFileExists.isFile()) {
          migrationsToRun.push({ name: eachModule, file: migrationFilePath });
        }
      } catch {
        // log().warn('Skipping ' + eachModule);
      }
    }
  }

  return migrationsToRun;
};

const sequentiallyRunMigrations = (migrations, callback) => {
  eachSeries(
    migrations,
    (eachMigration, done) => {
      log().info(`Updating schema for ${eachMigration.name}`);
      eachMigration.func(done);
    },
    (error) => {
      if (error) {
        log().error({ err: error }, 'Error running migration.');
        callback(error);
      }

      callback();
    }
  );
};

const runMigrations = function (dbConfig, callback) {
  // await promiseToRunMigrations(dbConfig);
  callbackify(promiseToRunMigrations)(dbConfig, (error, result) => {
    if (error) return callback(error);

    return callback(result);
  });
};

const promiseToRunMigrations = function (dbConfig) {
  log().info('Running migrations for keyspace ' + dbConfig.keyspace + '...');
  const data = {};

  return readFolderContents(PACKAGES_FOLDER)
    .then((allModules) => {
      data.allModules = allModules;
      return lookForMigrations(allModules);
    })
    .then((allMigrationsToRun) => {
      data.allMigrationsToRun = allMigrationsToRun;
    })
    .then(() => {
      return import(path.join(PACKAGES_FOLDER, 'oae-util', LIB_FOLDER, 'cassandra.js'));
    })
    .then((cassandraModule) => {
      const initCassandra = promisify(cassandraModule.init);
      return initCassandra(dbConfig);
    })
    .then(() => {
      return bootstrapMigrations(data.allMigrationsToRun);
    })
    .then(() => {
      log().info('Migrations completed. Creating etherpad keyspace next.');

      const createEtherpadKeyspace = promisify(createKeyspace);
      return createEtherpadKeyspace('etherpad');
    })
    .then(() => {
      log().info('Etherpad keyspace created.');
    })
    .catch((e) => {
      // TODO log something here
      console.log(e);
    })
    .finally(() => {
      log().info('All set. Exiting...');
    });
};

const bootstrapMigrations = (migrations) => {
  let spinner;

  function serial(funcs) {
    return funcs.reduce(
      (promise, func) => promise.then((result) => func().then(Array.prototype.concat.bind(result))),
      Promise.resolve([])
    );
  }

  return serial(
    migrations.map((eachMigration) => {
      return () => {
        return new Promise((resolve, reject) => {
          spinner = ora({
            text: `Running migrations for module ${eachMigration.name}...`
          }).start();

          promisify(fs.stat)(eachMigration.file).then((stat) => {
            if (stat.isFile()) {
              import(eachMigration.file)
                .then((eachModule) => {
                  return promisify(eachModule.ensureSchema)();
                })
                .then((x) => {
                  spinner.succeed(`Schema updated for module ${eachMigration.name}`);
                  resolve(x);
                })
                .catch((e) => {
                  spinner.fail(`Failed to update schema for module ${eachMigration.name}`);
                  reject(e);
                });
            }
          });
        })
          .catch((e) => {
            // there's no migration method, skipping
            spinner.succeed(`No schema found for module ${eachModule}`);
            resolve();
          })
          .finally(() => {
            spinner.stop();
            return;
          });
      };
    })
  );
};

export { promiseToRunMigrations, runMigrations };
