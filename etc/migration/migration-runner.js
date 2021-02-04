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

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import PrettyStream from 'bunyan-prettystream';
import * as LogAPI from 'oae-logger';
import { promise } from 'readdirp';
const { eachSeries } = require('async');

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
        log().warn('Skipping ' + eachModule);
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

// Just.. just look the other way. Please.
const runMigrations = async function (dbConfig, callback) {
  await promiseToRunMigrations(dbConfig);
  callback();
};

const promiseToRunMigrations = async function (dbConfig) {
  log().info('Running migrations for keyspace ' + dbConfig.keyspace + '...');
  const data = {};

  try {
    await readFolderContents(PACKAGES_FOLDER)
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
        const allImports = data.allMigrationsToRun.map((eachMigration) => {
          const func = (callback) => {
            import(eachMigration.file).then((eachModule) => {
              eachModule.ensureSchema(callback);
            });
          };
          return { func, name: eachMigration.name };
        });

        return allImports;
      })
      .then((allImports) => {
        const promiseToRunMigrations = promisify(sequentiallyRunMigrations);
        return promiseToRunMigrations(allImports);
      })
      .then(() => {
        log().info('Migrations completed. Creating etherpad keyspace next.');

        const createEtherpadKeyspace = promisify(createKeyspace);
        return createEtherpadKeyspace('etherpad');
      })
      .then(() => {
        log().info('Etherpad keyspace created.');
      })
      .finally(() => {
        log().info('All set. Exiting...');
      });
  } catch (error) {
    log().error({ err: error }, 'Error running migration.');
  }
};

export { promiseToRunMigrations, runMigrations };
