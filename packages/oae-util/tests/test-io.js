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

import { assert } from 'chai';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import * as IO from 'oae-util/lib/io.js';

const datadir = path.join(__dirname, '/data/');

describe('IO', () => {
  describe('#copyFile()', () => {
    /**
     * Test that verifies that copyFiles creates a new file with the same contents as the original
     */
    it('verify a new file is created with duplicate content', (callback) => {
      const sourceFile = datadir + 'banditos.txt';
      const destFile = datadir + 'refreshments.txt';

      // Verify that the dest file doesn't already exist
      fs.stat(destFile, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, 'ENOENT');

        IO.copyFile(sourceFile, destFile, (error) => {
          assert.notExists(error);
          // Verify that the source and dest files contain the same data
          fs.readFile(sourceFile, 'utf8', (error, sourceText) => {
            assert.notExists(error);
            fs.readFile(destFile, 'utf8', (error, destText) => {
              assert.notExists(error);
              assert.strictEqual(sourceText, destText);
              callback();
            });
          });
        });
      });
    });
  });

  describe('#moveFile()', () => {
    /**
     * Test that verifies that moveFile renames a file
     */
    it('verify a file is renamed', (callback) => {
      const sourceFile = datadir + 'refreshments.txt';
      const destFile = datadir + 'refreshments-banditos.txt';
      IO.moveFile(sourceFile, destFile, (error) => {
        assert.notExists(error);

        // Verify that the source file is removed
        fs.stat(sourceFile, (error) => {
          assert.strictEqual(error.code, 'ENOENT');

          // Verify that the source and dest files contain the same data
          fs.readFile(datadir + 'banditos.txt', 'utf8', (error, sourceText) => {
            assert.notExists(error);
            fs.readFile(destFile, 'utf8', (error, destText) => {
              assert.notExists(error);
              assert.strictEqual(sourceText, destText);
              fs.unlink(destFile, callback);
            });
          });
        });
      });
    });
  });

  describe('#destroyStream()', () => {
    /**
     * Test that verifies that a stream is fully destroyed.
     */
    it('verify a stream is properly destroyed.', () => {
      const stream = fs.createReadStream('.');

      // Register our pre-destroy listener.
      stream.on('error', (error) => {
        assert.notExists(error);
        assert.fail('This listener should have been removed.');
      });
      stream.on('close', () => {
        assert.fail('This listener should have been removed.');
      });

      // Destroy the stream, the above listeners should NOT be called.
      IO.destroyStream(stream);

      // Register a new error listener as the the test would otherwise fail.
      stream.on('error', () => {});
      stream.emit('error');
      stream.emit('close');
    });
  });

  describe('#exists()', () => {
    /**
     * Test that verifies that files and folders can be checked
     */
    it('verify files and folder can be checked', (callback) => {
      IO.exists(__filename, (error, exists) => {
        assert.notExists(error);
        assert.strictEqual(exists, true);

        IO.exists(__dirname, (error, exists) => {
          assert.notExists(error);
          assert.strictEqual(exists, true);

          IO.exists(path.join(__dirname, 'non-existing-file'), (error, exists) => {
            assert.notExists(error);
            assert.strictEqual(exists, false);

            return callback();
          });
        });
      });
    });
  });
});
