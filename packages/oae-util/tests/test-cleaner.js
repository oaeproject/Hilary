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

import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { assert } from 'chai';
import shell from 'shelljs';
import { head, equals } from 'ramda';

import * as Cleaner from 'oae-util/lib/cleaner.js';

describe('Content', () => {
  describe('Cleaner', () => {
    let dir = process.env.TMP || process.env.TMPDIR || process.env.TEMP || path.join(process.cwd(), 'tmp');
    dir = path.join(dir, 'oae', 'tests');

    // We need to normalize as some OSes (like Mac OS X) return a path with double slashes.
    dir = path.normalize(dir);

    /**
     * Sets up a directory with some dummy files.
     */
    beforeEach((callback) => {
      fs.mkdir(dir, { recursive: true }, (error) => {
        assert.notExists(error);

        // Dump some files in there.
        fs.writeFileSync(path.join(dir, 'a'), 'someFile', 'utf8');
        fs.writeFileSync(path.join(dir, 'b'), 'anotherFile', 'utf8');
        fs.writeFileSync(path.join(dir, 'c'), 'yetAnotherFile', 'utf8');

        // Making sure every file is at least 1s old
        setTimeout(callback, 1000);
      });
    });

    /**
     * In case one of the tests fails, we stop the cleaner here.
     */
    afterEach(() => {
      Cleaner.stop(dir);
    });

    /**
     * Remove our test directory if all tests are done.
     */
    after(() => {
      shell.rm('-rf', dir);
    });

    /**
     * Verify that the files get removed.
     */
    it('verify files get removed', (callback) => {
      Cleaner.start(dir, 0);
      const onCleaned = (cleanedDir) => {
        if (equals(cleanedDir, dir)) {
          Cleaner.emitter.removeListener('cleaned', onCleaned);
          fs.readdir(dir, (error, files) => {
            assert.notExists(error);
            assert.lengthOf(files, 0);
            callback();
          });
        }
      };

      Cleaner.emitter.on('cleaned', onCleaned);
    });

    /**
     * Verify that only old files get removed.
     */
    it('verify only old files get removed', (callback) => {
      // Create a brand new file.
      fs.writeFileSync(path.join(dir, 'd'), 'lastFile', 'utf8');

      // Remove files that are older than a second (a, b and c)
      Cleaner.start(dir, 1);

      // Stop removing immediately (ie: run only once)
      Cleaner.stop(dir);

      const onCleaned = (cleanedDir) => {
        if (equals(cleanedDir, dir)) {
          Cleaner.emitter.removeListener('cleaned', onCleaned);
          fs.readdir(dir, (error, files) => {
            assert.notExists(error);
            assert.lengthOf(files, 1);
            assert.strictEqual(head(files), 'd');
            callback();
          });
        }
      };

      Cleaner.emitter.on('cleaned', onCleaned);
    });
  });
});
