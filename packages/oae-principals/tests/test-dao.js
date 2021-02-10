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
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util';
import * as TestsUtil from 'oae-tests';

import { forEach, length, keys } from 'ramda';

describe('Principals DAO', () => {
  let asCambridgeTenantAdmin = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before((callback) => {
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    return callback();
  });

  describe('#updatePrincipal', () => {
    /**
     * Test that verifies that updating an email address only removes the
     * email mapping for the user whose email address is being updated
     */
    it('verify updating email address retains duplicate email mappings', (callback) => {
      // Create 2 users whose email address will be the same
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge } = users;
        const { email } = homer.user;

        // Change Marge's email to be the same as Homer
        PrincipalsTestUtil.assertUpdateUserSucceeds(
          marge.restContext,
          marge.user.id,
          { email },
          (simong1, emailToken) => {
            PrincipalsTestUtil.assertVerifyEmailSucceeds(marge.restContext, marge.user.id, emailToken, () => {
              // Ensure both users are represented in the user email mapping for the email
              PrincipalsDAO.getUserIdsByEmails([email], (error, userIdsByEmail) => {
                assert.notExists(error);

                const ids = userIdsByEmail[email];
                assert.isArray(ids);
                assert.lengthOf(ids, 2);
                assert.include(ids, homer.user.id);
                assert.include(ids, marge.user.id);

                // Now change marge's email to something else using the DAO
                const email1 = TestsUtil.generateTestEmailAddress().toLowerCase();
                PrincipalsDAO.updatePrincipal(marge.user.id, { email: email1 }, (error_) => {
                  assert.notExists(error_);

                  // Ensure homer's email entry still has him mapped
                  PrincipalsDAO.getUserIdsByEmails([email], (error, userIdsByEmail) => {
                    assert.notExists(error);

                    const ids = userIdsByEmail[email];
                    assert.isArray(ids);
                    assert.lengthOf(ids, 1);
                    assert.strictEqual(ids[0], homer.user.id);
                    return callback();
                  });
                });
              });
            });
          }
        );
      });
    });

    /**
     * Test that verifies that restricted fields (i.e., admin:global and admin:tenant) cannot be set through
     * updatePrincipal.
     */
    it('verify it does not allow setting of restricted fields', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        let { 0: mrvisser } = users;
        mrvisser = mrvisser.user;

        // Sanity check valid update first
        PrincipalsDAO.updatePrincipal(mrvisser.id, { publicAlias: 'haha' }, (error_) => {
          assert.notExists(error_);

          PrincipalsDAO.getPrincipal(mrvisser.id, (error, mrvisserRaw) => {
            assert.notExists(error);
            assert.strictEqual(mrvisserRaw.publicAlias, 'haha');

            PrincipalsDAO.updatePrincipal(mrvisser.id, { 'admin:tenant': true }, (error_) => {
              assert.ok(error_);
              assert.strictEqual(error_.code, 400);
              assert.strictEqual(error_.msg, 'Attempted to update an invalid property');

              PrincipalsDAO.updatePrincipal(mrvisser.id, { 'admin:global': true }, (error_) => {
                assert.ok(error_);
                assert.strictEqual(error_.code, 400);
                assert.strictEqual(error_.msg, 'Attempted to update an invalid property');

                PrincipalsDAO.updatePrincipal(mrvisser.id, { 'admin:tenant': true, 'admin:global': true }, (error_) => {
                  assert.ok(error_);
                  assert.strictEqual(error_.code, 400);
                  assert.strictEqual(error_.msg, 'Attempted to update an invalid property');

                  return callback();
                });
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the DAO does not update the lastModified field automatically.
     */
    it('verify it does not set the lastModified field', (callback) => {
      // Create a user to update
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);
        let { 0: mrvisser } = users;
        mrvisser = mrvisser.user;

        // Update the user using the DAO directly
        const previousLastModified = mrvisser.lastModified;
        PrincipalsDAO.updatePrincipal(mrvisser.id, { publicAlias: 'haha' }, (error_) => {
          assert.notExists(error_);

          // Get the user to ensure their lastModified has not changed
          PrincipalsDAO.getPrincipal(mrvisser.id, (error_ /* , mrvisserRow */) => {
            assert.notExists(error_);
            assert.strictEqual(previousLastModified, mrvisser.lastModified);
            return callback();
          });
        });
      });
    });
  });

  describe('#iterateAll', () => {
    /**
     * Test that verifies the iterateAll functionality of the principal DAO
     */
    it('verify PrincipalsDAO iterateAll functionality', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        let { 0: mrvisser } = users;
        mrvisser = mrvisser.user;
        let foundUser = false;

        /*!
         * Verifies that each principal row only has the principalId
         */
        const _onEach = function (principalRows, done) {
          // Ensure we only get the principalId of the users
          forEach((principalRow) => {
            assert.strictEqual(
              length(keys(principalRow)),
              1,
              'Expected to have only one key on the principal row, the principal id'
            );
            assert.ok(principalRow.principalId, 'Expected the row to have principalId');

            // Remember whether or not we found the principal
            if (principalRow.principalId === mrvisser.id) {
              foundUser = true;
            }
          }, principalRows);

          done();
        };

        /**
         * Ensure that passing in `null` will result in only the principalId
         * being returned from the principal rows
         */
        PrincipalsDAO.iterateAll(null, 100, _onEach, (error_) => {
          assert.ok(!error_, JSON.stringify(error_, null, 4));
          assert.ok(foundUser, 'Expected to find the user we just created');

          foundUser = false;

          /*!
           * Verifies that we only get the principalId and displayName of each principalRow
           */
          const _onEach = function (principalRows, done) {
            // Ensure we only get the principalId and displayName of the principal
            forEach((principalRow) => {
              assert.strictEqual(
                length(keys(principalRow)),
                2,
                'Expected to have only two keys on the principal row, the principal id and displayName'
              );
              assert.ok(principalRow.principalId, 'Expected the row to have principalId');

              // Remember whether or not we found the user
              if (principalRow.principalId === mrvisser.id) {
                // Verify the displayName is accurate
                assert.strictEqual(principalRow.displayName, mrvisser.displayName);
                foundUser = true;
              }
            }, principalRows);

            done();
          };

          // Do the same thing but fetch the principalId and the displayName, and ensure they match
          PrincipalsDAO.iterateAll(['principalId', 'displayName'], 100, _onEach, (error_) => {
            assert.ok(!error_, JSON.stringify(error_, null, 4));
            assert.ok(foundUser, 'Expected to find the user we just created');

            return callback();
          });
        });
      });
    });

    /**
     * Test that verifies created user appears in PrincipalsDAO.iterateAll
     */
    it('verify newly created principals are returned in iterateAll', (callback) => {
      // Stores how many principals were in the database before we created a new one
      let numberPrincipalsOrig = 0;

      // Count how many principals we currently have in the database
      PrincipalsDAO.iterateAll(
        null,
        1000,
        (principalRows, done) => {
          if (principalRows) {
            numberPrincipalsOrig += principalRows.length;
          }

          return done();
        },
        (error) => {
          assert.notExists(error);

          // Create one new one, and ensure the new number of principals is numPrincipalsOrig + 1
          TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
            assert.notExists(error);

            const { 0: createdUser } = users;

            let numberPrincipalsAfter = 0;
            let hasNewPrincipal = false;

            // Count the principals we have now, and ensure we iterate over the new user
            PrincipalsDAO.iterateAll(
              null,
              1000,
              (principalRows, done) => {
                if (principalRows) {
                  numberPrincipalsAfter += principalRows.length;
                  forEach((principalRow) => {
                    if (principalRow.principalId === createdUser.user.id) {
                      hasNewPrincipal = true;
                    }
                  }, principalRows);
                }

                return done();
              },
              (error_) => {
                assert.notExists(error_);
                assert.strictEqual(numberPrincipalsOrig + 1, numberPrincipalsAfter);
                assert.ok(hasNewPrincipal);
                return callback();
              }
            );
          });
        }
      );
    });
  });
});
