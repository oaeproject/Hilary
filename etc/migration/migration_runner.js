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

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const async = require('async');

const log = require('oae-logger').logger();

const readFolderContents = promisify(fs.readdir);
const checkIfExists = promisify(fs.stat);

const PACKAGES_FOLDER = path.join(process.cwd(), 'packages');
const LIB_FOLDER = 'lib';
const MIGRATION_FILE = 'migration.js';

const lookForMigrations = async function(allModules) {
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
      } catch (e) {
        log().warn('Skipping ' + eachModule);
      }
    }
  }
  return migrationsToRun;
};

const runMigrations = async function(dbConfig, callback) {
  const data = {};

  try {
    Promise.resolve(readFolderContents(PACKAGES_FOLDER))
      .then(allModules => {
        data.allModules = allModules;
        return lookForMigrations(allModules);
      })
      .then(allMigrationsToRun => {
        data.allMigrationsToRun = allMigrationsToRun;
      })
      .then(() => {
        require(path.join(PACKAGES_FOLDER, 'oae-util', LIB_FOLDER, 'cassandra.js')).init(dbConfig, () => {
          async.eachSeries(
            data.allMigrationsToRun,
            (eachMigration, done) => {
              log().info(`Updating schema for ${eachMigration.name}`);
              require(eachMigration.file).ensureSchema(done);
            },
            err => {
              if (err) {
                log().error({ err }, 'Error running migration.');
                callback(err);
              }
              log().info('Migrations complete');
              callback();
            }
          );
        });
      });
  } catch (e) {
    log().error({ err: e }, 'Error running migration.');
    callback(e);
  }
};

module.exports = { runMigrations };
