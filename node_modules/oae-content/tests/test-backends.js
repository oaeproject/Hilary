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
const _ = require('underscore');

const BackendsUtil = require('oae-content/lib/backends/util');
const LocalBackend = require('oae-content/lib/backends/local');
const RemoteBackend = require('oae-content/lib/backends/remote');

describe('Content Backends', () => {
  describe('Util', () => {
    const file = { name: 'testfile.png' };

    /**
     * Verify that generating a storage URI takes a `resourceId` into account.
     */
    it('verify uri generation with resourceId', () => {
      const options = {
        resourceId: 'c:camtest:VT9co9JRpM'
      };
      const uri = BackendsUtil.generateUri(file, options);
      const result = uri.split('/');

      assert.strictEqual(
        result[0],
        'c',
        'The first level of a URI should be the resource type (or unspecified.)'
      );
      assert.strictEqual(
        result[1],
        'camtest',
        'The second level of a URI should be the tenant alias (or unspecified.)'
      );
      assert.strictEqual(
        result[result.length - 1],
        'testfile.png',
        'The last level of the URI should be the filename'
      );
      assert.ok(
        result.length > 3,
        'A URI should have some kind of hashing in it which generated more than 3 levels'
      );
      _.each(result, part => {
        assert.ok(part.length > 0, 'Each part of the URI should be non-empty.');
      });
    });

    /**
     * Verify that generating a storage URI takes a `resourceId` and `prefix` into account.
     */
    it('verify uri generation with resourceId and prefix', () => {
      const options = {
        resourceId: 'u:camtest:VT9co9JRpM',
        prefix: 'profilepictures'
      };
      const uri = BackendsUtil.generateUri(file, options);
      const result = uri.split('/');

      assert.strictEqual(
        result[0],
        'u',
        'The first level of a URI should be the resource type (or unspecified.)'
      );
      assert.strictEqual(
        result[1],
        'camtest',
        'The second level of a URI should be the tenant alias (or unspecified.)'
      );
      assert.strictEqual(
        result[result.length - 2],
        'profilepictures',
        'The second to last level of the URI should be the prefix (if it contains no slashes.)'
      );
      assert.strictEqual(
        result[result.length - 1],
        'testfile.png',
        'The last level of the URI should be the filename'
      );
      assert.ok(
        result.length > 4,
        'A URI should have some kind of hashing in it which generated more than 4 levels if a prefix is specified'
      );
      _.each(result, part => {
        assert.ok(part.length > 0, 'Each part of the URI should be non-empty.');
      });
    });

    /**
     * Verify that generating a storage URI can happen without providing a `resourceId`.
     */
    it('verify uri generation without resourceId', () => {
      const options = {};
      const uri = BackendsUtil.generateUri(file, options);
      const result = uri.split('/');

      assert.strictEqual(
        result[0],
        'unspecified',
        'The first level of a URI should be the resource type (or unspecified.)'
      );
      assert.strictEqual(
        result[1],
        'unspecified',
        'The second level of a URI should be the tenant alias (or unspecified.)'
      );
      assert.strictEqual(
        result[result.length - 1],
        'testfile.png',
        'The last level of the URI should be the filename'
      );
      assert.ok(
        result.length > 3,
        'A URI should have some kind of hashing in it which generated more than 3 levels'
      );
      _.each(result, part => {
        assert.ok(part.length > 0, 'Each part of the URI should be non-empty.');
      });
    });

    /**
     * Verify that a short resourceId gets padded.
     */
    it('verify uri generation with short resourceId', () => {
      const options = {
        resourceId: 'c:camtest:abc'
      };
      const uri = BackendsUtil.generateUri(file, options);
      const result = uri.split('/');

      assert.strictEqual(
        result[0],
        'c',
        'The first level of a URI should be the resource type (or unspecified.)'
      );
      assert.strictEqual(
        result[1],
        'camtest',
        'The second level of a URI should be the tenant alias (or unspecified.)'
      );
      assert.strictEqual(
        result[result.length - 1],
        'testfile.png',
        'The last level of the URI should be the filename'
      );
      assert.ok(
        result.length > 3,
        'A URI should have some kind of hashing in it which generated more than 3 levels'
      );
      _.each(result, part => {
        assert.ok(part.length > 0, 'Each part of the URI should be non-empty.');
      });
    });
  });

  describe('Remote backend', () => {
    /**
     * Verifies the remote backend is able to return a proper download link
     */
    it('verify remote backend is able to return a download link', callback => {
      const uri = 'remote:http://www.apereo.org/favicon.ico';
      const downloadStrategy = RemoteBackend.getDownloadStrategy(null, uri);
      assert.strictEqual(downloadStrategy.strategy, 'direct');
      assert.strictEqual(downloadStrategy.target, 'http://www.apereo.org/favicon.ico');
      return callback();
    });

    /**
     * Test that verifies that storing content items is not implemented
     */
    it('verify storing content items is not implemented', callback => {
      RemoteBackend.store(null, { name: 'foo' }, null, err => {
        assert.strictEqual(err.code, 501);

        return callback();
      });
    });

    /**
     * Test that verifies that getting content items is not implemented
     */
    it('verify getting content items is not implemented', callback => {
      RemoteBackend.get(null, 'remote#www.google.com', err => {
        assert.strictEqual(err.code, 501);

        return callback();
      });
    });

    /**
     * Test that verifies that removing content items is not implemented
     */
    it('verify removing content items is not implemented', callback => {
      RemoteBackend.remove(null, 'remote#www.google.com', err => {
        assert.strictEqual(err.code, 501);

        return callback();
      });
    });
  });

  describe('Local backend', () => {
    let _originalRootDir = null;

    before(callback => {
      // Grab the original root directory before we change it in the tests
      _originalRootDir = LocalBackend.getRootDirectory();
      return callback();
    });

    afterEach(callback => {
      // Reset the root directory to its original value
      LocalBackend.init(_originalRootDir, err => {
        assert.ok(!err);
        return callback();
      });
    });

    describe('#init()', () => {
      /**
       * Test that verifies an error properly bubbles up the stack
       */
      it('verify error handling', callback => {
        LocalBackend.init('\0', err => {
          assert.strictEqual(err.code, 500);
          return callback();
        });
      });
    });

    describe('#get()', () => {
      /**
       * Test that verifies an error properly bubbles up the stack
       */
      it('verify error handling', callback => {
        const uri = 'local#/non/existing/file';

        LocalBackend.get(null, uri, (err, file) => {
          assert.ok(err);
          assert.ok(!file);

          return callback();
        });
      });
    });
  });
});
