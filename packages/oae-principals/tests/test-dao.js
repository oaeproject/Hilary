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

const PrincipalsDAO = require('oae-principals/lib/internal/dao');
const PrincipalsTestUtil = require('oae-principals/lib/test/util');
const RestAPI = require('oae-rest');
const TestsUtil = require('oae-tests');

describe('Principals DAO', () => {
  // Rest contexts that will be used for requests
  let anonymousRestContext = null;
  let camAdminRestContext = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before(callback => {
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    return callback();
  });

  describe('#updatePrincipal', () => {
    /**
     * Test that verifies that updating an email address only removes the
     * email mapping for the user whose email address is being updated
     */
    it('verify updating email address retains duplicate email mappings', callback => {
      // Create 2 users whose email address will be the same
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, mrvisser, simong) => {
        assert.ok(!err);
        const { email } = mrvisser.user;

        // Change Simon's email to be the same as mrvisser
        PrincipalsTestUtil.assertUpdateUserSucceeds(
          simong.restContext,
          simong.user.id,
          { email },
          (simong1, emailToken) => {
            PrincipalsTestUtil.assertVerifyEmailSucceeds(
              simong.restContext,
              simong.user.id,
              emailToken,
              () => {
                // Ensure both users are represented in the user email mapping for the email
                PrincipalsDAO.getUserIdsByEmails([email], (err, userIdsByEmail) => {
                  assert.ok(!err);

                  const ids = userIdsByEmail[email];
                  assert.ok(_.isArray(ids));
                  assert.strictEqual(_.size(ids), 2);
                  assert.ok(_.contains(ids, mrvisser.user.id));
                  assert.ok(_.contains(ids, simong.user.id));

                  // Now change simong's email to something else using the DAO
                  const email1 = TestsUtil.generateTestEmailAddress().toLowerCase();
                  PrincipalsDAO.updatePrincipal(simong.user.id, { email: email1 }, err => {
                    assert.ok(!err);

                    // Ensure mrvisser's email entry still has him mapped
                    PrincipalsDAO.getUserIdsByEmails([email], (err, userIdsByEmail) => {
                      assert.ok(!err);

                      const ids = userIdsByEmail[email];
                      assert.ok(_.isArray(ids));
                      assert.strictEqual(_.size(ids), 1);
                      assert.strictEqual(ids[0], mrvisser.user.id);
                      return callback();
                    });
                  });
                });
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that restricted fields (i.e., admin:global and admin:tenant) cannot be set through
     * updatePrincipal.
     */
    it('verify it does not allow setting of restricted fields', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, mrvisser) => {
        assert.ok(!err);
        mrvisser = mrvisser.user;

        // Sanity check valid update first
        PrincipalsDAO.updatePrincipal(mrvisser.id, { publicAlias: 'haha' }, err => {
          assert.ok(!err);

          PrincipalsDAO.getPrincipal(mrvisser.id, (err, mrvisserRaw) => {
            assert.ok(!err);
            assert.strictEqual(mrvisserRaw.publicAlias, 'haha');

            PrincipalsDAO.updatePrincipal(mrvisser.id, { 'admin:tenant': true }, err => {
              assert.ok(err);
              assert.strictEqual(err.code, 400);
              assert.strictEqual(err.msg, 'Attempted to update an invalid property');

              PrincipalsDAO.updatePrincipal(mrvisser.id, { 'admin:global': true }, err => {
                assert.ok(err);
                assert.strictEqual(err.code, 400);
                assert.strictEqual(err.msg, 'Attempted to update an invalid property');

                PrincipalsDAO.updatePrincipal(
                  mrvisser.id,
                  { 'admin:tenant': true, 'admin:global': true },
                  err => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 400);
                    assert.strictEqual(err.msg, 'Attempted to update an invalid property');

                    return callback();
                  }
                );
              });
            });
          });
        });
      });
    });

    /**
     * Test that verifies that the DAO does not update the lastModified field automatically.
     */
    it('verify it does not set the lastModified field', callback => {
      // Create a user to update
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, mrvisser) => {
        assert.ok(!err);
        mrvisser = mrvisser.user;

        // Update the user using the DAO directly
        const prevLastModified = mrvisser.lastModified;
        PrincipalsDAO.updatePrincipal(mrvisser.id, { publicAlias: 'haha' }, err => {
          assert.ok(!err);

          // Get the user to ensure their lastModified has not changed
          PrincipalsDAO.getPrincipal(mrvisser.id, (err, mrvisserRow) => {
            assert.ok(!err);
            assert.strictEqual(prevLastModified, mrvisser.lastModified);
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
    it('verify PrincipalsDAO iterateAll functionality', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
        assert.ok(!err);

        const mrvisser = users[_.keys(users)[0]].user;
        const mrvisserRestCtx = users[_.keys(users)[0]].restContext;
        let foundUser = false;

        /*!
                 * Verifies that each principal row only has the principalId
                 */
        const _onEach = function(principalRows, done) {
          // Ensure we only get the principalId of the users
          _.each(principalRows, principalRow => {
            assert.strictEqual(
              _.keys(principalRow).length,
              1,
              'Expected to have only one key on the principal row, the principal id'
            );
            assert.ok(principalRow.principalId, 'Expected the row to have principalId');

            // Remember whether or not we found the principal
            if (principalRow.principalId === mrvisser.id) {
              foundUser = true;
            }
          });

          done();
        };

        // Ensure that passing in `null` will result in only the principalId being returned from the principal rows
        PrincipalsDAO.iterateAll(null, 100, _onEach, err => {
          assert.ok(!err, JSON.stringify(err, null, 4));
          assert.ok(foundUser, 'Expected to find the user we just created');

          foundUser = false;

          /*!
                     * Verifies that we only get the principalId and displayName of each principalRow
                     */
          const _onEach = function(principalRows, done) {
            // Ensure we only get the principalId and displayName of the principal
            _.each(principalRows, principalRow => {
              assert.strictEqual(
                _.keys(principalRow).length,
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
            });

            done();
          };

          // Do the same thing but fetch the principalId and the displayName, and ensure they match
          PrincipalsDAO.iterateAll(['principalId', 'displayName'], 100, _onEach, err => {
            assert.ok(!err, JSON.stringify(err, null, 4));
            assert.ok(foundUser, 'Expected to find the user we just created');
            callback();
          });
        });
      });
    });

    /**
     * Test that verifies created user appears in PrincipalsDAO.iterateAll
     */
    it('verify newly created principals are returned in iterateAll', callback => {
      // Create a user to test with
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        user = _.values(user)[0];

        const testUsername = TestsUtil.generateTestUserId();

        // Stores how many principals were in the database before we created a new one
        let numPrincipalsOrig = 0;

        // Count how many principals we currently have in the database
        PrincipalsDAO.iterateAll(
          null,
          1000,
          (principalRows, done) => {
            if (principalRows) {
              numPrincipalsOrig += principalRows.length;
            }

            return done();
          },
          err => {
            assert.ok(!err);

            // Create one new one, and ensure the new number of principals is numPrincipalsOrig + 1
            TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, createdUser) => {
              assert.ok(!err);

              let numPrincipalsAfter = 0;
              let hasNewPrincipal = false;

              // Count the principals we have now, and ensure we iterate over the new user
              PrincipalsDAO.iterateAll(
                null,
                1000,
                (principalRows, done) => {
                  if (principalRows) {
                    numPrincipalsAfter += principalRows.length;
                    _.each(principalRows, principalRow => {
                      if (principalRow.principalId === createdUser.user.id) {
                        hasNewPrincipal = true;
                      }
                    });
                  }

                  return done();
                },
                err => {
                  assert.ok(!err);
                  assert.strictEqual(numPrincipalsOrig + 1, numPrincipalsAfter);
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
});
