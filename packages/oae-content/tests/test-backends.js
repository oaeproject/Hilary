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
import { forEach, nth, head, last, length } from 'ramda';

import * as BackendsUtil from 'oae-content/lib/backends/util.js';
import * as LocalBackend from 'oae-content/lib/backends/local.js';
import * as RemoteBackend from 'oae-content/lib/backends/remote.js';

const { get, store, remove, getDownloadStrategy } = RemoteBackend;
const { generateUri } = BackendsUtil;

const DIRECT = 'direct';

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
      const uri = generateUri(file, options);
      const result = uri.split('/');

      assert.strictEqual(head(result), 'c', 'The first level of a URI should be the resource type (or unspecified.)');
      assert.strictEqual(
        nth(1, result),
        'camtest',
        'The second level of a URI should be the tenant alias (or unspecified.)'
      );
      assert.strictEqual(last(result), 'testfile.png', 'The last level of the URI should be the filename');
      assert.isAbove(
        result.length,
        3,
        'A URI should have some kind of hashing in it which generated more than 3 levels'
      );

      forEach((eachPart) => {
        assert.isNotEmpty(eachPart, 'Each part of the URI should be non-empty.');
      }, result);
    });

    /**
     * Verify that generating a storage URI takes a `resourceId` and `prefix` into account.
     */
    it('verify uri generation with resourceId and prefix', () => {
      const options = {
        resourceId: 'u:camtest:VT9co9JRpM',
        prefix: 'profilepictures'
      };
      const uri = generateUri(file, options);
      const result = uri.split('/');

      assert.strictEqual(nth(0, result), 'u', 'The first level of a URI should be the resource type (or unspecified.)');
      assert.strictEqual(
        nth(1, result),
        'camtest',
        'The second level of a URI should be the tenant alias (or unspecified.)'
      );
      assert.strictEqual(
        nth(length(result) - 2, result),
        'profilepictures',
        'The second to last level of the URI should be the prefix (if it contains no slashes.)'
      );
      assert.strictEqual(last(result), 'testfile.png', 'The last level of the URI should be the filename');
      assert.isAbove(
        result.length,
        4,
        'A URI should have some kind of hashing in it which generated more than 4 levels if a prefix is specified'
      );

      forEach((eachPart) => {
        assert.isNotEmpty(eachPart, 'Each part of the URI should be non-empty.');
      }, result);
    });

    /**
     * Verify that generating a storage URI can happen without providing a `resourceId`.
     */
    it('verify uri generation without resourceId', () => {
      const options = {};
      const uri = generateUri(file, options);
      const result = uri.split('/');

      assert.strictEqual(
        nth(0, result),
        'unspecified',
        'The first level of a URI should be the resource type (or unspecified.)'
      );
      assert.strictEqual(
        nth(1, result),
        'unspecified',
        'The second level of a URI should be the tenant alias (or unspecified.)'
      );
      assert.strictEqual(last(result), 'testfile.png', 'The last level of the URI should be the filename');
      assert.isAbove(
        result.length,
        3,
        'A URI should have some kind of hashing in it which generated more than 3 levels'
      );

      forEach((eachPart) => {
        assert.isNotEmpty(eachPart, 'Each part of the URI should be non-empty.');
      }, result);
    });

    /**
     * Verify that a short resourceId gets padded.
     */
    it('verify uri generation with short resourceId', () => {
      const options = {
        resourceId: 'c:camtest:abc'
      };
      const uri = generateUri(file, options);
      const result = uri.split('/');

      assert.strictEqual(nth(0, result), 'c', 'The first level of a URI should be the resource type (or unspecified.)');
      assert.strictEqual(
        nth(1, result),
        'camtest',
        'The second level of a URI should be the tenant alias (or unspecified.)'
      );
      assert.strictEqual(last(result), 'testfile.png', 'The last level of the URI should be the filename');
      assert.isAbove(
        result.length,
        3,
        'A URI should have some kind of hashing in it which generated more than 3 levels'
      );

      forEach((eachPart) => {
        assert.isNotEmpty(eachPart, 'Each part of the URI should be non-empty.');
      }, result);
    });
  });

  describe('Remote backend', () => {
    /**
     * Verifies the remote backend is able to return a proper download link
     */
    it('verify remote backend is able to return a download link', (callback) => {
      const uri = 'remote:http://www.apereo.org/favicon.ico';
      const downloadStrategy = getDownloadStrategy(null, uri);

      assert.strictEqual(downloadStrategy.strategy, DIRECT);
      assert.strictEqual(downloadStrategy.target, 'http://www.apereo.org/favicon.ico');

      return callback();
    });

    /**
     * Test that verifies that storing content items is not implemented
     */
    it('verify storing content items is not implemented', (callback) => {
      store(null, { name: 'foo' }, null, (error) => {
        assert.strictEqual(error.code, 501);

        return callback();
      });
    });

    /**
     * Test that verifies that getting content items is not implemented
     */
    it('verify getting content items is not implemented', (callback) => {
      get(null, 'remote#www.google.com', (error) => {
        assert.strictEqual(error.code, 501);

        return callback();
      });
    });

    /**
     * Test that verifies that removing content items is not implemented
     */
    it('verify removing content items is not implemented', (callback) => {
      remove(null, 'remote#www.google.com', (error) => {
        assert.strictEqual(error.code, 501);

        return callback();
      });
    });
  });

  describe('Local backend', () => {
    let _originalRootDir = null;

    before((callback) => {
      // Grab the original root directory before we change it in the tests
      _originalRootDir = LocalBackend.getRootDirectory();

      return callback();
    });

    afterEach((callback) => {
      // Reset the root directory to its original value
      LocalBackend.init(_originalRootDir, (error) => {
        assert.notExists(error);

        return callback();
      });
    });

    describe('#init()', () => {
      /**
       * Test that verifies an error properly bubbles up the stack
       */
      it('verify error handling', (callback) => {
        LocalBackend.init('\0', (error) => {
          assert.strictEqual(error.code, 500);

          return callback();
        });
      });
    });

    describe('#get()', () => {
      /**
       * Test that verifies an error properly bubbles up the stack
       */
      it('verify error handling', (callback) => {
        const uri = 'local#/non/existing/file';

        LocalBackend.get(null, uri, (error, file) => {
          assert.ok(error);
          assert.isNotOk(file);

          return callback();
        });
      });
    });
  });
});
