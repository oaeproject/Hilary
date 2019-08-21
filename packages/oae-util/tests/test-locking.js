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

import assert from 'assert';
import * as Locking from 'oae-util/lib/locking';

describe('Locking', () => {
  /**
   * Verifies acquiring a lock stops others from being able to acquire it. Also verifies that releasing
   * the lock then allows others to acquire it again
   */
  const LOCK_KEY = 99;
  it('verify lock acquisition and release', callback => {
    // Get a lock, make sure it works
    Locking.acquire(LOCK_KEY, 5, (err, token) => {
      assert.ok(!err);
      assert.ok(token);

      // Try again, make sure we don't get a token for it
      Locking.acquire(LOCK_KEY, 5, (err, tokenBad) => {
        assert.ok(err);
        assert.ok(!tokenBad);

        // Release the lock
        Locking.release(LOCK_KEY, token, err => {
          assert.ok(!err);

          // Try again, we should get it this time around
          Locking.acquire(LOCK_KEY, 5, (err, token2) => {
            assert.ok(!err);
            assert.ok(token2);

            // Release the lock again to continue.
            Locking.release(LOCK_KEY, token2, err => {
              assert.ok(!err);
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
    Locking.acquire(null, 5000, (err, token) => {
      assert.strictEqual(err.code, 400);
      assert.ok(!token);

      // Expires validation
      Locking.acquire(LOCK_KEY, null, (err, token) => {
        assert.strictEqual(err.code, 400);
        assert.ok(!token);
        Locking.acquire(LOCK_KEY, 'Not an int', (err, token) => {
          assert.strictEqual(err.code, 400);
          assert.ok(!token);
          Locking.acquire(LOCK_KEY, 3.5, (err, token) => {
            assert.strictEqual(err.code, 400);
            assert.ok(!token);

            Locking.acquire(null, null, (err, token) => {
              assert.strictEqual(err.code, 400);
              assert.ok(!token);

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
    Locking.acquire(LOCK_KEY, 5000, (err, token) => {
      assert.ok(!err);
      assert.ok(token);

      // Try with no token or lockKey
      Locking.release(null, null, err => {
        assert.strictEqual(err.code, 400);

        // Try to release it with no lockKey
        Locking.release(null, token, err => {
          assert.strictEqual(err.code, 400);

          // Try with no token
          Locking.release(LOCK_KEY, null, err => {
            assert.strictEqual(err.code, 400);

            // Sanity check
            Locking.release(LOCK_KEY, token, err => {
              assert.ok(!err);
              callback();
            });
          });
        });
      });
    });
  });

  /**
   * Verifies that locking for longer than the lock expiry results in other nodes being able to steal it
   */
  it('verify a lock expires and stealing an expired lock', callback => {
    // Get a lock, make sure it works
    Locking.acquire(LOCK_KEY, 1, (err, token) => {
      assert.ok(!err);
      assert.ok(token);

      // Try again, make sure we don't get a token for it
      Locking.acquire(LOCK_KEY, 5, (err, tokenBad) => {
        assert.ok(err);
        assert.ok(!tokenBad);

        // Wait until it expires then try and steal it
        setTimeout(Locking.acquire, 1100, LOCK_KEY, 5, (err, tokenGood) => {
          assert.ok(!err);
          assert.ok(tokenGood);

          // Try and release with the wrong token, ensure we get an error
          Locking.release(LOCK_KEY, token, err => {
            assert.ok(err);

            // Make sure that the invalid release token failed to release the lock
            Locking.acquire(LOCK_KEY, 5, (err, tokenBad2) => {
              assert.ok(err);
              assert.ok(!tokenBad2);

              // Release it successfully to continue.
              Locking.release(LOCK_KEY, tokenGood, err => {
                assert.ok(!err);
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
    Locking.acquire(LOCK_KEY, 1, (err, token) => {
      assert.ok(!err);
      assert.ok(token);

      // Try again, make sure we don't get a token for it
      Locking.acquire(LOCK_KEY, 5, (err, tokenBad) => {
        assert.ok(err);
        assert.ok(!tokenBad);

        // Wait until it expires then try and release it. Verify we get an error
        setTimeout(Locking.release, 1100, LOCK_KEY, token, err => {
          assert.ok(err);
          callback();
        });
      });
    });
  });
});
