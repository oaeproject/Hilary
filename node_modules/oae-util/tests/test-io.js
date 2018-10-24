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

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const IO = require('oae-util/lib/io');

const datadir = path.join(__dirname, '/data/');

describe('IO', () => {
  describe('#copyFile()', callback => {
    /**
     * Test that verifies that copyFiles creates a new file with the same contents as the original
     */
    it('verify a new file is created with duplicate content', callback => {
      const sourceFile = datadir + 'banditos.txt';
      const destFile = datadir + 'refreshments.txt';

      // Verify that the dest file doesn't already exist
      fs.stat(destFile, err => {
        assert.ok(err);
        assert.strictEqual(err.code, 'ENOENT');

        IO.copyFile(sourceFile, destFile, err => {
          assert.ok(!err);
          // Verify that the source and dest files contain the same data
          fs.readFile(sourceFile, 'utf8', (err, sourceText) => {
            assert.ok(!err);
            fs.readFile(destFile, 'utf8', (err, destText) => {
              assert.ok(!err);
              assert.strictEqual(sourceText, destText);
              callback();
            });
          });
        });
      });
    });
  });

  describe('#moveFile()', callback => {
    /**
     * Test that verifies that moveFile renames a file
     */
    it('verify a file is renamed', callback => {
      const sourceFile = datadir + 'refreshments.txt';
      const destFile = datadir + 'refreshments-banditos.txt';
      IO.moveFile(sourceFile, destFile, err => {
        assert.ok(!err);

        // Verify that the source file is removed
        fs.stat(sourceFile, err => {
          assert.strictEqual(err.code, 'ENOENT');

          // Verify that the source and dest files contain the same data
          fs.readFile(datadir + 'banditos.txt', 'utf8', (err, sourceText) => {
            assert.ok(!err);
            fs.readFile(destFile, 'utf8', (err, destText) => {
              assert.ok(!err);
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
      stream.on('error', err => {
        assert.fail('This listener should have been removed.');
      });
      stream.on('close', () => {
        assert.fail('This listener should have been removed.');
      });

      // Destroy the stream, the above listeners should NOT be called.
      IO.destroyStream(stream);

      // Register a new error listener as the the test would otherwise fail.
      stream.on('error', err => {});
      stream.emit('error');
      stream.emit('close');
    });
  });

  describe('#exists()', () => {
    /**
     * Test that verifies that files and folders can be checked
     */
    it('verify files and folder can be checked', callback => {
      IO.exists(__filename, (err, exists) => {
        assert.ok(!err);
        assert.strictEqual(exists, true);

        IO.exists(__dirname, (err, exists) => {
          assert.ok(!err);
          assert.strictEqual(exists, true);

          // eslint-disable-next-line no-path-concat
          IO.exists(__filename + 'non-existing-file', (err, exists) => {
            assert.ok(!err);
            assert.strictEqual(exists, false);

            return callback();
          });
        });
      });
    });
  });
});
