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
import * as Locking from 'oae-util/lib/locking';

describe('Locking', () => {
  /**
   * Verifies acquiring a lock stops others from being able to acquire it. Also verifies that releasing
   * the lock then allows others to acquire it again
   */
  const LOCK_KEY = 99;
  it('verify lock acquisition and release', callback => {
    // Get a lock, make sure it works
    Locking.acquire(LOCK_KEY, 5, (err, lock) => {
      assert.notExists(err);
      assert.ok(lock);

      // Try again, make sure we don't get a token for it
      Locking.acquire(LOCK_KEY, 5, (err, wouldBeLock) => {
        assert.ok(err);
        assert.isNotOk(wouldBeLock);

        // Release the lock
        Locking.release(lock, err => {
          assert.notExists(err);

          // Try again, we should get it this time around
          Locking.acquire(LOCK_KEY, 5, (err, anotherLock) => {
            assert.notExists(err);
            assert.ok(anotherLock);

            // Release the lock again to continue.
            Locking.release(anotherLock, err => {
              assert.notExists(err);
              callback();
            });
          });
        });
      });
    });
  });

  /**
   * Verifies acquiring a lock performs parameter validation
   */
  it('verify lock acquisition parameter validation', callback => {
    // Lock key validation.
    Locking.acquire(null, 5000, (err, lock) => {
      assert.strictEqual(err.code, 400);
      assert.isNotOk(lock);

      // Expires validation
      Locking.acquire(LOCK_KEY, null, (err, anotherLock) => {
        assert.strictEqual(err.code, 400);
        assert.isNotOk(anotherLock);
        Locking.acquire(LOCK_KEY, 'Not an int', (err, yetAnotherLock) => {
          assert.strictEqual(err.code, 400);
          assert.isNotOk(yetAnotherLock);
          Locking.acquire(LOCK_KEY, 3.5, (err, alternativeLock) => {
            assert.strictEqual(err.code, 400);
            assert.isNotOk(alternativeLock);

            Locking.acquire(null, null, (err, indeedLock) => {
              assert.strictEqual(err.code, 400);
              assert.isNotOk(indeedLock);

              // Sanity checking can happen in other test methods.
              callback();
            });
          });
        });
      });
    });
  });

  /**
   * Verifies releasing a lock performs parameter validation
   */
  it('verify lock release parameter validation', callback => {
    // Get a lock, make sure it works
    Locking.acquire(LOCK_KEY, 5000, (err, lock) => {
      assert.notExists(err);
      assert.ok(lock);

      // Try with no lock
      Locking.release(null, err => {
        assert.strictEqual(err.code, 400);

        // Sanity check
        Locking.release(lock, err => {
          assert.notExists(err);
          callback();
        });
      });
    });
  });

  /**
   * Verifies that locking for longer than the lock expiry results in other nodes being able to steal it
   */
  it('verify a lock expires and stealing an expired lock', callback => {
    // Get a lock, make sure it works
    Locking.acquire(LOCK_KEY, 1, (err, lock) => {
      assert.notExists(err);
      assert.ok(lock);

      // Try again, make sure we don't get a token for it
      Locking.acquire(LOCK_KEY, 5, (err, noLock) => {
        assert.ok(err);
        assert.isNotOk(noLock);

        // Wait until it expires then try and steal it
        setTimeout(Locking.acquire, 1100, LOCK_KEY, 5, (err, goodLock) => {
          assert.notExists(err);
          assert.ok(goodLock);

          // Try and release with the wrong lock (expired by now), ensure we get an error
          Locking.release(lock, err => {
            assert.ok(err);

            // Make sure that the invalid release token failed to release the lock
            Locking.acquire(LOCK_KEY, 5, (err, wouldBeLock) => {
              assert.ok(err);
              assert.isNotOk(wouldBeLock);

              // Release it successfully to continue.
              Locking.release(goodLock, err => {
                assert.notExists(err);
                callback();
              });
            });
          });
        });
      });
    });
  });

  /**
   * Verifies that releasing an expired lock does not result in an error
   */
  it('verify releasing expired lock reports that no lock was released', callback => {
    // Get a lock, make sure it works
    Locking.acquire(LOCK_KEY, 1, (err, lock) => {
      assert.notExists(err);
      assert.ok(lock);

      // Try again, make sure we don't get a token for it
      Locking.acquire(LOCK_KEY, 5, (err, noLock) => {
        assert.ok(err);
        assert.isNotOk(noLock);

        // Wait until it expires then try and release it. Verify we get an error
        setTimeout(Locking.release, 1100, lock, err => {
          assert.ok(err);
          callback();
        });
      });
    });
  });
});
