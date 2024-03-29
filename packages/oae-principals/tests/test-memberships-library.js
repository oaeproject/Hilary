/*!
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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

import { callbackify } from 'node:util';
import { assert } from 'chai';
import {
  find,
  reject,
  isNil,
  forEach,
  contains,
  intersection,
  pluck,
  map,
  path,
  last,
  propSatisfies,
  equals
} from 'ramda';

import * as AuthzUtil from 'oae-authz/lib/util.js';
import { runQuery } from 'oae-util/lib/cassandra.js';
import * as LibraryAPI from 'oae-library';
import * as RestAPI from 'oae-rest';
import * as SearchTestsUtil from 'oae-search/lib/test/util.js';
import * as TestsUtil from 'oae-tests';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util.js';

import { PrincipalsConstants } from 'oae-principals/lib/constants.js';

describe('Memberships Library', () => {
  // REST contexts we can use to do REST requests
  let asGlobalAdminOnTenant = null;
  let asCambridgeTenantAdmin = null;
  let asCambridgeAnonymousUser = null;

  before((callback) => {
    asCambridgeAnonymousUser = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    asCambridgeTenantAdmin = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // Authenticate the global admin into a tenant so we can perform user-tenant requests with a global admin to test their access
    RestAPI.Admin.loginOnTenant(TestsUtil.createGlobalAdminRestContext(), 'localhost', null, (error, ctx) => {
      assert.notExists(error);
      asGlobalAdminOnTenant = ctx;
      return callback();
    });
  });

  /**
   * Ensure the `one` array of string ids contains the exact same elements as in the `other` array of string ids
   *
   * @param  {String[]}   one     One array to compare
   * @param  {String[]}   other   The other array to compare
   * @api private
   */
  const _assertArraysEqual = function (one, other) {
    assert.ok(one);
    assert.ok(other);
    assert.strictEqual(one.length, other.length);
    assert.strictEqual(intersection(one, other).length, other.length);
  };

  describe('General', () => {
    /**
     * Test that verifies the memberships library rebuilds when deleted
     */
    it('verify the memberships library automatically rebuilds and pages when purged', (callback) => {
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: branden, 1: simon } = users;

        // We need 110 groups because the paging size while rebuilding is 100
        TestsUtil.generateTestGroups(branden.restContext, 110, (...args) => {
          const groupIds = reject(isNil, map(path(['group', 'id']), last(args)));
          assert.strictEqual(groupIds.length, 110);

          // Sanity check the library to ensure we get all the groups back
          PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds(
            simon.restContext,
            branden.user.id,
            null,
            (membershipsBefore) => {
              // Ensure we get exactly all the same 110 groups back
              const responseIds = pluck('id', membershipsBefore);
              assert.strictEqual(responseIds.length, 110);
              forEach((responseId) => {
                assert.ok(contains(responseId, groupIds));
              }, responseIds);

              // Delete the group memberships library
              LibraryAPI.Index.purge(PrincipalsConstants.library.MEMBERSHIPS_INDEX_NAME, branden.user.id, (error_) => {
                assert.notExists(error_);

                // List the group memberships library, rebuilding the library
                PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds(
                  simon.restContext,
                  branden.user.id,
                  null,
                  (membershipsAfter) => {
                    assert.strictEqual(membershipsAfter.length, 110);

                    // Ensure we get exactly all the same 110 groups back in the same order
                    for (const [i, membershipBefore] of membershipsBefore.entries()) {
                      const membershipAfter = membershipsAfter[i];
                      assert.ok(membershipBefore.id);
                      assert.strictEqual(membershipBefore.id, membershipAfter.id);
                    }

                    return callback();
                  }
                );
              });
            }
          );
        });
      });
    });

    /**
     * Verify the memberships library transitions properly from empty lastModified dates to having lastModified dates
     */
    it('verify migration from group in memberships library without lastModified to group with lastModified', (callback) => {
      // Generate a user who has a library and a user who can see the library
      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: branden, 1: simon } = users;

        // Generate 2 groups to be in branden's library
        TestsUtil.generateTestGroups(branden.restContext, 2, (...args) => {
          const groupIds = reject(isNil, map(path(['group', 'id']), last(args)));

          // Update both groups through a back door to not have a lastModified
          callbackify(runQuery)(
            'DELETE "lastModified" FROM "Principals" WHERE "principalId" IN ?',
            [groupIds],
            (error_) => {
              assert.notExists(error_);

              // Trigger the library to build
              PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds(
                simon.restContext,
                branden.user.id,
                null,
                (memberships) => {
                  assert.strictEqual(memberships.length, 2);
                  const { 0: firstGroup, 1: secondGroup } = memberships;

                  // Update the lastModified of the second group so that it now has a library "rank"
                  callbackify(runQuery)(
                    'UPDATE "Principals" SET "lastModified" = ? WHERE "principalId" = ?',
                    [Date.now().toString(), secondGroup.id],
                    (error_) => {
                      assert.notExists(error_);

                      // The order should not change because the library does not get updated with the direct query
                      PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds(
                        simon.restContext,
                        branden.user.id,
                        null,
                        (memberships) => {
                          assert.strictEqual(memberships[0].id, firstGroup.id);
                          assert.strictEqual(memberships[1].id, secondGroup.id);

                          // Purge the library so we can rebuild it
                          LibraryAPI.Index.purge(
                            PrincipalsConstants.library.MEMBERSHIPS_INDEX_NAME,
                            branden.user.id,
                            (error_) => {
                              assert.notExists(error_);

                              // Since secondGroup now has a lastModified, it should be ranked higher than the firstGroup
                              PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds(
                                simon.restContext,
                                branden.user.id,
                                null,
                                (memberships) => {
                                  assert.strictEqual(memberships[0].id, secondGroup.id);
                                  assert.strictEqual(memberships[1].id, firstGroup.id);
                                  return callback();
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
      });
    });
  });

  describe('Feed', () => {
    /**
     * Test that verifies listing memberships library for non-existing principal results in an error
     */
    it('verify memberships library feed validation', (callback) => {
      // Verify invalid id
      RestAPI.Group.getMembershipsLibrary(
        asCambridgeTenantAdmin,
        'not-a-valid-id',
        null,
        null,
        (error /* , response */) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);

          RestAPI.Group.getMembershipsLibrary(
            asCambridgeTenantAdmin,
            'c:cam:not-a-principal-id',
            null,
            null,
            (error /* , response */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 400);

              RestAPI.Group.getMembershipsLibrary(
                asCambridgeTenantAdmin,
                'g:cam:non-existing-group',
                null,
                null,
                (error /* , response */) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 404);
                  return callback();
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies that all users get the proper library visibility bucket when listing the memberships library
     */
    it('verify memberships library feed visibility', (callback) => {
      TestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant1, publicTenant2, privateTenant1 /* , privateTenant2 */) => {
          /**
           * Add the publicTenant1 public user to all the groups
           * in their own tenant, publicTenant2 and the private tenant
           */
          PrincipalsTestUtil.addUserToAllGroups(
            publicTenant1.publicUser,
            publicTenant1,
            publicTenant2,
            privateTenant1,
            () => {
              // Create a parent group with which we can verify indirect groups existing in the private feed
              TestsUtil.generateTestGroups(publicTenant1.adminRestContext, 1, (error, groups) => {
                assert.notExists(error);
                const { 0: indirectGroup } = groups;
                const changes = {};
                changes[publicTenant1.publicGroup.id] = 'member';
                RestAPI.Group.setGroupMembers(
                  publicTenant1.adminRestContext,
                  indirectGroup.group.id,
                  changes,
                  (error_) => {
                    assert.notExists(error_);

                    const expectedPrivateFeed = [
                      indirectGroup.group.id,
                      publicTenant1.publicGroup.id,
                      publicTenant1.loggedinNotJoinableGroup.id,
                      publicTenant1.loggedinJoinableGroup.id,
                      publicTenant1.privateJoinableGroup.id,
                      publicTenant1.privateNotJoinableGroup.id,
                      publicTenant2.publicGroup.id,
                      publicTenant2.loggedinNotJoinableGroup.id,
                      publicTenant2.loggedinJoinableGroup.id,
                      publicTenant2.privateNotJoinableGroup.id,
                      publicTenant2.privateJoinableGroup.id,
                      privateTenant1.publicGroup.id,
                      privateTenant1.loggedinNotJoinableGroup.id,
                      privateTenant1.loggedinJoinableGroup.id,
                      privateTenant1.privateNotJoinableGroup.id,
                      privateTenant1.privateJoinableGroup.id
                    ];

                    const expectedLoggedinFeed = [
                      indirectGroup.group.id,
                      publicTenant1.publicGroup.id,
                      publicTenant1.loggedinJoinableGroup.id,
                      publicTenant1.loggedinNotJoinableGroup.id,
                      publicTenant2.publicGroup.id,
                      privateTenant1.publicGroup.id
                    ];

                    const expectedPublicFeed = [
                      indirectGroup.group.id,
                      publicTenant1.publicGroup.id,
                      publicTenant2.publicGroup.id,
                      privateTenant1.publicGroup.id
                    ];

                    // Ensure the public user can see all their groups in the library feed
                    PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds(
                      publicTenant1.publicUser.restContext,
                      publicTenant1.publicUser.user.id,
                      null,
                      (memberships) => {
                        _assertArraysEqual(expectedPrivateFeed, pluck('id', memberships));

                        // Ensure tenant admin can see all groups in the memberships library feed
                        PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds(
                          publicTenant1.adminRestContext,
                          publicTenant1.publicUser.user.id,
                          null,
                          (memberships) => {
                            _assertArraysEqual(expectedPrivateFeed, pluck('id', memberships));

                            // Ensure the global admin can see all groups in the memberships library feed
                            PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds(
                              asGlobalAdminOnTenant,
                              publicTenant1.publicUser.user.id,
                              null,
                              (memberships) => {
                                _assertArraysEqual(expectedPrivateFeed, pluck('id', memberships));

                                // Ensure a user from the same tenant can see loggedin feed
                                PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds(
                                  publicTenant1.loggedinUser.restContext,
                                  publicTenant1.publicUser.user.id,
                                  null,
                                  (memberships) => {
                                    _assertArraysEqual(expectedLoggedinFeed, pluck('id', memberships));

                                    // Ensure anonymous user gets the public feed
                                    PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds(
                                      publicTenant1.anonymousRestContext,
                                      publicTenant1.publicUser.user.id,
                                      null,
                                      (memberships) => {
                                        _assertArraysEqual(expectedPublicFeed, pluck('id', memberships));

                                        // Ensure user from another tenant gets the public feed
                                        PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds(
                                          publicTenant2.publicUser.restContext,
                                          publicTenant1.publicUser.user.id,
                                          null,
                                          (memberships) => {
                                            _assertArraysEqual(expectedPublicFeed, pluck('id', memberships));

                                            // Ensure tenant admin from another tenant gets the public feed
                                            PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds(
                                              publicTenant2.adminRestContext,
                                              publicTenant1.publicUser.user.id,
                                              null,
                                              (memberships) => {
                                                _assertArraysEqual(expectedPublicFeed, pluck('id', memberships));
                                                return callback();
                                              }
                                            );
                                          }
                                        );
                                      }
                                    );
                                  }
                                );
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              });
            }
          );
        }
      );
    });

    /**
     * Test that verifies only authorized users can see a user's memberships library
     */
    it('verify memberships library feed authorization', (callback) => {
      TestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant1, publicTenant2 /* , privateTenant1, privateTenant2 */) => {
          // 1. Public user library

          // Ensure anonymous can see it
          RestAPI.Group.getMembershipsLibrary(
            publicTenant1.anonymousRestContext,
            publicTenant1.publicUser.user.id,
            null,
            null,
            (error /* , response */) => {
              assert.notExists(error);

              // Ensure user from another tenant can see it
              RestAPI.Group.getMembershipsLibrary(
                publicTenant2.publicUser.restContext,
                publicTenant1.publicUser.user.id,
                null,
                null,
                (error /* , response */) => {
                  assert.notExists(error);

                  // Ensure user from same tenant can see it
                  RestAPI.Group.getMembershipsLibrary(
                    publicTenant1.privateUser.restContext,
                    publicTenant1.publicUser.user.id,
                    null,
                    null,
                    (error /* , response */) => {
                      assert.notExists(error);

                      // Ensure user themself can see it
                      RestAPI.Group.getMembershipsLibrary(
                        publicTenant1.publicUser.restContext,
                        publicTenant1.publicUser.user.id,
                        null,
                        null,
                        (error /* , response */) => {
                          assert.notExists(error);

                          // Ensure tenant admin can see it
                          RestAPI.Group.getMembershipsLibrary(
                            publicTenant1.adminRestContext,
                            publicTenant1.publicUser.user.id,
                            null,
                            null,
                            (error /* , response */) => {
                              assert.notExists(error);

                              // Ensure global admin can see it
                              RestAPI.Group.getMembershipsLibrary(
                                asGlobalAdminOnTenant,
                                publicTenant1.publicUser.user.id,
                                null,
                                null,
                                (error /* , response */) => {
                                  assert.notExists(error);

                                  // 2. Logged in user library

                                  // Ensure anonymous cannot see it
                                  RestAPI.Group.getMembershipsLibrary(
                                    publicTenant1.anonymousRestContext,
                                    publicTenant1.loggedinUser.user.id,
                                    null,
                                    null,
                                    (error /* , response */) => {
                                      assert.ok(error);
                                      assert.strictEqual(error.code, 401);

                                      // Ensure user from another tenant cannot see it
                                      RestAPI.Group.getMembershipsLibrary(
                                        publicTenant2.publicUser.restContext,
                                        publicTenant1.loggedinUser.user.id,
                                        null,
                                        null,
                                        (error /* , response */) => {
                                          assert.ok(error);
                                          assert.strictEqual(error.code, 401);

                                          // Ensure user from same tenant can see it
                                          RestAPI.Group.getMembershipsLibrary(
                                            publicTenant1.publicUser.restContext,
                                            publicTenant1.loggedinUser.user.id,
                                            null,
                                            null,
                                            (error /* , response */) => {
                                              assert.notExists(error);

                                              // Ensure user themself can see it
                                              RestAPI.Group.getMembershipsLibrary(
                                                publicTenant1.loggedinUser.restContext,
                                                publicTenant1.loggedinUser.user.id,
                                                null,
                                                null,
                                                (error /* , response */) => {
                                                  assert.notExists(error);

                                                  // Ensure tenant admin can see it
                                                  RestAPI.Group.getMembershipsLibrary(
                                                    publicTenant1.adminRestContext,
                                                    publicTenant1.loggedinUser.user.id,
                                                    null,
                                                    null,
                                                    (error /* , response */) => {
                                                      assert.notExists(error);

                                                      // Ensure global admin can see it
                                                      RestAPI.Group.getMembershipsLibrary(
                                                        asGlobalAdminOnTenant,
                                                        publicTenant1.loggedinUser.user.id,
                                                        null,
                                                        null,
                                                        (error /* , response */) => {
                                                          assert.notExists(error);

                                                          // 3. Private user library

                                                          // Ensure anonymous cannot see it
                                                          RestAPI.Group.getMembershipsLibrary(
                                                            publicTenant1.anonymousRestContext,
                                                            publicTenant1.privateUser.user.id,
                                                            null,
                                                            null,
                                                            (error /* , response */) => {
                                                              assert.ok(error);
                                                              assert.strictEqual(error.code, 401);

                                                              // Ensure user from another tenant cannot see it
                                                              RestAPI.Group.getMembershipsLibrary(
                                                                publicTenant2.publicUser.restContext,
                                                                publicTenant1.privateUser.user.id,
                                                                null,
                                                                null,
                                                                (error /* , response */) => {
                                                                  assert.ok(error);
                                                                  assert.strictEqual(error.code, 401);

                                                                  // Ensure user from same tenant can see it
                                                                  RestAPI.Group.getMembershipsLibrary(
                                                                    publicTenant1.publicUser.restContext,
                                                                    publicTenant1.privateUser.user.id,
                                                                    null,
                                                                    null,
                                                                    (error /* , response */) => {
                                                                      assert.ok(error);
                                                                      assert.strictEqual(error.code, 401);

                                                                      // Ensure user themself can see it
                                                                      RestAPI.Group.getMembershipsLibrary(
                                                                        publicTenant1.privateUser.restContext,
                                                                        publicTenant1.privateUser.user.id,
                                                                        null,
                                                                        null,
                                                                        (error /* , response */) => {
                                                                          assert.notExists(error);

                                                                          // Ensure tenant admin can see it
                                                                          RestAPI.Group.getMembershipsLibrary(
                                                                            publicTenant1.adminRestContext,
                                                                            publicTenant1.privateUser.user.id,
                                                                            null,
                                                                            null,
                                                                            (error /* , response */) => {
                                                                              assert.notExists(error);

                                                                              // Ensure global admin can see it
                                                                              RestAPI.Group.getMembershipsLibrary(
                                                                                asGlobalAdminOnTenant,
                                                                                publicTenant1.privateUser.user.id,
                                                                                null,
                                                                                null,
                                                                                (error /* , response */) => {
                                                                                  assert.notExists(error);
                                                                                  return callback();
                                                                                }
                                                                              );
                                                                            }
                                                                          );
                                                                        }
                                                                      );
                                                                    }
                                                                  );
                                                                }
                                                              );
                                                            }
                                                          );
                                                        }
                                                      );
                                                    }
                                                  );
                                                }
                                              );
                                            }
                                          );
                                        }
                                      );
                                    }
                                  );
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });

  describe('Search', () => {
    /*!
     * Get the document with the specified id from the search results.
     *
     * @param  {SearchResult}  results     The search results object
     * @param  {String}        docId       The id of the document to search
     * @return {Object}                    The search document. `null` if it didn't exist
     */
    const _getDocById = (results, docId) => find(propSatisfies(equals(docId), 'id'), results.results);

    /**
     * Test that verifies the validation of the memberships search
     */
    it('verify memberships library search validation', (callback) => {
      SearchTestsUtil.searchAll(
        asCambridgeAnonymousUser,
        'memberships-library',
        ['not-a-valid-user-id'],
        null,
        (error, results) => {
          assert.ok(error);
          assert.strictEqual(error.code, 400);
          assert.isNotOk(results);

          SearchTestsUtil.searchAll(
            asCambridgeAnonymousUser,
            'memberships-library',
            ['u:camtest:not-an-existing-user'],
            null,
            (error /* , results */) => {
              assert.ok(error);
              assert.strictEqual(error.code, 404);

              SearchTestsUtil.searchAll(
                asCambridgeAnonymousUser,
                'memberships-library',
                ['g:camtest:not-an-existing-group'],
                null,
                (error /* , results */) => {
                  assert.ok(error);
                  assert.strictEqual(error.code, 404);

                  return callback();
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies group membership search returns groups, and that unlinking group members results in those results no longer
     * returning in searches.
     */
    it('verify removing member from group removes it from private and non-private library', (callback) => {
      const groupParentAlias = TestsUtil.generateTestUserId('groupParent');
      const groupChildAlias = TestsUtil.generateTestUserId('groupChild');

      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        const { 0: doer, 1: jack } = users;

        // Create a group hierarchy to ensure they all show up in 'jack's group membership search
        RestAPI.Group.createGroup(
          doer.restContext,
          groupParentAlias,
          groupParentAlias,
          'public',
          'no',
          [],
          [],
          (error, groupParent) => {
            assert.notExists(error);

            RestAPI.Group.createGroup(
              doer.restContext,
              groupChildAlias,
              groupChildAlias,
              'public',
              'no',
              [],
              [],
              (error, groupChild) => {
                assert.notExists(error);

                TestsUtil.generateGroupHierarchy(
                  doer.restContext,
                  [groupParent.id, groupChild.id, jack.user.id],
                  'member',
                  (error_) => {
                    assert.notExists(error_);

                    // Search all and ensure the private feed search contains both groups
                    SearchTestsUtil.searchAll(
                      jack.restContext,
                      'memberships-library',
                      [jack.user.id],
                      null,
                      (error, results) => {
                        assert.notExists(error);
                        assert.ok(_getDocById(results, groupChild.id));
                        assert.ok(_getDocById(results, groupParent.id));

                        // Ensure loggedin feed has just the direct group
                        SearchTestsUtil.searchAll(
                          doer.restContext,
                          'memberships-library',
                          [jack.user.id],
                          null,
                          (error, results) => {
                            assert.notExists(error);
                            assert.ok(_getDocById(results, groupChild.id));
                            assert.ok(!_getDocById(results, groupParent.id));

                            // Unlink the hierarchy by removing jack from the 'bottom' group
                            const changes = {};
                            changes[jack.user.id] = false;
                            RestAPI.Group.setGroupMembers(doer.restContext, groupChild.id, changes, (error_) => {
                              assert.notExists(error_);

                              // Verify the private memberships search is now empty
                              SearchTestsUtil.searchAll(
                                jack.restContext,
                                'memberships-library',
                                [jack.user.id],
                                null,
                                (error, results) => {
                                  assert.notExists(error);
                                  assert.strictEqual(results.total, 0);
                                  assert.strictEqual(results.results.length, 0);

                                  // Verify the loggedin memberships search is now empty
                                  SearchTestsUtil.searchAll(
                                    doer.restContext,
                                    'memberships-library',
                                    [jack.user.id],
                                    null,
                                    (error, results) => {
                                      assert.notExists(error);
                                      assert.strictEqual(results.total, 0);
                                      assert.strictEqual(results.results.length, 0);

                                      return callback();
                                    }
                                  );
                                }
                              );
                            });
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies paging works correctly in memberships search.
     */
    it('verify paging works correctly in memberships library search', (callback) => {
      const groupParentAlias = TestsUtil.generateTestUserId('groupParent');
      const groupChildAlias = TestsUtil.generateTestUserId('groupChild');

      TestsUtil.generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);
        // Create a group hierarchy to ensure we have memberships
        const { 0: jack, 1: doer } = users;
        RestAPI.Group.createGroup(
          doer.restContext,
          groupParentAlias,
          groupParentAlias,
          'public',
          'no',
          [],
          [jack.user.id],
          (error /* , groupParent */) => {
            assert.notExists(error);

            RestAPI.Group.createGroup(
              doer.restContext,
              groupChildAlias,
              groupChildAlias,
              'public',
              'no',
              [],
              [jack.user.id],
              (error /* , groupChild */) => {
                assert.notExists(error);

                // Search only 2 documents to get the expected ids for paging afterward
                SearchTestsUtil.searchRefreshed(
                  doer.restContext,
                  'memberships-library',
                  [jack.user.id],
                  { limit: 2, start: 0 },
                  (error, results) => {
                    assert.notExists(error);
                    assert.ok(results.results);
                    assert.ok(results.results.length, 2);

                    // Get the ids of the first 2 expected results.
                    const firstId = results.results[0].id;
                    const secondId = results.results[1].id;

                    assert.ok(firstId);
                    assert.ok(secondId);

                    // Verify page 1 gives the first id. We don't need to refresh since we haven't updated anything since the first refresh.
                    RestAPI.Search.search(
                      doer.restContext,
                      'memberships-library',
                      [jack.user.id],
                      { limit: 1, start: 0 },
                      (error, results) => {
                        assert.notExists(error);
                        assert.ok(results.results);
                        assert.ok(results.results.length, 1);
                        assert.strictEqual(results.results[0].id, firstId);
                        assert.strictEqual(results.results[0].resourceType, 'group');
                        assert.strictEqual(
                          results.results[0].profilePath,
                          '/group/' +
                            results.results[0].tenant.alias +
                            '/' +
                            AuthzUtil.getResourceFromId(results.results[0].id).resourceId
                        );

                        // Verify page 2 gives the second id
                        RestAPI.Search.search(
                          doer.restContext,
                          'memberships-library',
                          [jack.user.id],
                          { limit: 1, start: 1 },
                          (error, results) => {
                            assert.notExists(error);
                            assert.ok(results.results);
                            assert.ok(results.results.length, 1);
                            assert.strictEqual(results.results[0].id, secondId);
                            assert.strictEqual(results.results[0].resourceType, 'group');
                            assert.strictEqual(
                              results.results[0].profilePath,
                              '/group/' +
                                results.results[0].tenant.alias +
                                '/' +
                                AuthzUtil.getResourceFromId(results.results[0].id).resourceId
                            );
                            return callback();
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });

    /**
     * Test that verifies that all users get the proper library visibility when searching the memberships library
     */
    it('verify memberships library search visibility', (callback) => {
      TestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant1, publicTenant2, privateTenant1 /* , privateTenant2 */) => {
          // Add the publicTenant1 public user to all the groups in their own tenant, publicTenant2 and the private tenant
          PrincipalsTestUtil.addUserToAllGroups(
            publicTenant1.publicUser,
            publicTenant1,
            publicTenant2,
            privateTenant1,
            () => {
              const expectedPrivateSearch = [
                publicTenant1.publicGroup.id,
                publicTenant1.loggedinNotJoinableGroup.id,
                publicTenant1.loggedinJoinableGroup.id,
                publicTenant1.privateNotJoinableGroup.id,
                publicTenant1.privateJoinableGroup.id,
                publicTenant2.publicGroup.id,
                publicTenant2.loggedinNotJoinableGroup.id,
                publicTenant2.loggedinJoinableGroup.id,
                publicTenant2.privateNotJoinableGroup.id,
                publicTenant2.privateJoinableGroup.id,
                privateTenant1.publicGroup.id,
                privateTenant1.loggedinNotJoinableGroup.id,
                privateTenant1.loggedinJoinableGroup.id,
                privateTenant1.privateNotJoinableGroup.id,
                privateTenant1.privateJoinableGroup.id
              ];

              const expectedLoggedinSearch = [
                publicTenant1.publicGroup.id,
                publicTenant1.loggedinNotJoinableGroup.id,
                publicTenant1.loggedinJoinableGroup.id,
                publicTenant2.publicGroup.id,
                privateTenant1.publicGroup.id
              ];

              const expectedPublicSearch = [
                publicTenant1.publicGroup.id,
                publicTenant2.publicGroup.id,
                privateTenant1.publicGroup.id
              ];

              // RestCtx, searchType, params, opts, callback

              // Ensure the public user can see all their groups in the library feed
              SearchTestsUtil.searchAll(
                publicTenant1.publicUser.restContext,
                'memberships-library',
                [publicTenant1.publicUser.user.id],
                null,
                (error, response) => {
                  assert.notExists(error);
                  _assertArraysEqual(expectedPrivateSearch, pluck('id', response.results));

                  // Ensure tenant admin can see all groups in the memberships library feed
                  SearchTestsUtil.searchAll(
                    publicTenant1.adminRestContext,
                    'memberships-library',
                    [publicTenant1.publicUser.user.id],
                    null,
                    (error, response) => {
                      assert.notExists(error);
                      _assertArraysEqual(expectedPrivateSearch, pluck('id', response.results));

                      // Ensure the global admin can see all groups in the memberships library feed
                      SearchTestsUtil.searchAll(
                        asGlobalAdminOnTenant,
                        'memberships-library',
                        [publicTenant1.publicUser.user.id],
                        null,
                        (error, response) => {
                          assert.notExists(error);
                          _assertArraysEqual(expectedPrivateSearch, pluck('id', response.results));

                          // Ensure a user from the same tenant can see loggedin feed
                          SearchTestsUtil.searchAll(
                            publicTenant1.loggedinUser.restContext,
                            'memberships-library',
                            [publicTenant1.publicUser.user.id],
                            null,
                            (error, response) => {
                              assert.notExists(error);
                              _assertArraysEqual(expectedLoggedinSearch, pluck('id', response.results));

                              // Ensure anonymous user gets the public feed
                              SearchTestsUtil.searchAll(
                                publicTenant1.anonymousRestContext,
                                'memberships-library',
                                [publicTenant1.publicUser.user.id],
                                null,
                                (error, response) => {
                                  assert.notExists(error);
                                  _assertArraysEqual(expectedPublicSearch, pluck('id', response.results));

                                  // Ensure user from another tenant gets the public feed
                                  SearchTestsUtil.searchAll(
                                    publicTenant2.publicUser.restContext,
                                    'memberships-library',
                                    [publicTenant1.publicUser.user.id],
                                    null,
                                    (error, response) => {
                                      assert.notExists(error);
                                      _assertArraysEqual(expectedPublicSearch, pluck('id', response.results));

                                      // Ensure tenant admin from another tenant gets the public feed
                                      SearchTestsUtil.searchAll(
                                        publicTenant2.adminRestContext,
                                        'memberships-library',
                                        [publicTenant1.publicUser.user.id],
                                        null,
                                        (error, response) => {
                                          assert.notExists(error);
                                          _assertArraysEqual(expectedPublicSearch, pluck('id', response.results));
                                          return callback();
                                        }
                                      );
                                    }
                                  );
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });

    /**
     * Test that verifies only authorized users can see a user's memberships library
     */
    it('verify memberships library search authorization', (callback) => {
      TestsUtil.setupMultiTenantPrivacyEntities(
        (publicTenant1, publicTenant2 /* , privateTenant1, privateTenant2 */) => {
          // 1. Public user library

          // Ensure anonymous can see it
          SearchTestsUtil.searchAll(
            publicTenant1.anonymousRestContext,
            'memberships-library',
            [publicTenant1.publicUser.user.id],
            null,
            (error /* , results */) => {
              assert.notExists(error);

              // Ensure user from another tenant can see it
              SearchTestsUtil.searchAll(
                publicTenant2.publicUser.restContext,
                'memberships-library',
                [publicTenant1.publicUser.user.id],
                null,
                (error /* , results */) => {
                  assert.notExists(error);

                  // Ensure user from same tenant can see it
                  SearchTestsUtil.searchAll(
                    publicTenant1.privateUser.restContext,
                    'memberships-library',
                    [publicTenant1.publicUser.user.id],
                    null,
                    (error /* , results */) => {
                      assert.notExists(error);

                      // Ensure user themself can see it
                      SearchTestsUtil.searchAll(
                        publicTenant1.publicUser.restContext,
                        'memberships-library',
                        [publicTenant1.publicUser.user.id],
                        null,
                        (error /* , results */) => {
                          assert.notExists(error);

                          // Ensure tenant admin can see it
                          SearchTestsUtil.searchAll(
                            publicTenant1.adminRestContext,
                            'memberships-library',
                            [publicTenant1.publicUser.user.id],
                            null,
                            (error /* , results */) => {
                              assert.notExists(error);

                              // Ensure global admin can see it
                              SearchTestsUtil.searchAll(
                                asGlobalAdminOnTenant,
                                'memberships-library',
                                [publicTenant1.publicUser.user.id],
                                null,
                                (error /* , results */) => {
                                  assert.notExists(error);

                                  // 2. Logged in user library

                                  // Ensure anonymous cannot see it
                                  SearchTestsUtil.searchAll(
                                    publicTenant1.anonymousRestContext,
                                    'memberships-library',
                                    [publicTenant1.loggedinUser.user.id],
                                    null,
                                    (error /* , results */) => {
                                      assert.ok(error);
                                      assert.strictEqual(error.code, 401);

                                      // Ensure user from another tenant cannot see it
                                      SearchTestsUtil.searchAll(
                                        publicTenant2.publicUser.restContext,
                                        'memberships-library',
                                        [publicTenant1.loggedinUser.user.id],
                                        null,
                                        (error /* , results */) => {
                                          assert.ok(error);
                                          assert.strictEqual(error.code, 401);

                                          // Ensure user from same tenant can see it
                                          SearchTestsUtil.searchAll(
                                            publicTenant1.publicUser.restContext,
                                            'memberships-library',
                                            [publicTenant1.loggedinUser.user.id],
                                            null,
                                            (error /* , results */) => {
                                              assert.notExists(error);

                                              // Ensure user themself can see it
                                              SearchTestsUtil.searchAll(
                                                publicTenant1.loggedinUser.restContext,
                                                'memberships-library',
                                                [publicTenant1.loggedinUser.user.id],
                                                null,
                                                (error /* , results */) => {
                                                  assert.notExists(error);

                                                  // Ensure tenant admin can see it
                                                  SearchTestsUtil.searchAll(
                                                    publicTenant1.adminRestContext,
                                                    'memberships-library',
                                                    [publicTenant1.loggedinUser.user.id],
                                                    null,
                                                    (error /* , results */) => {
                                                      assert.notExists(error);

                                                      // Ensure global admin can see it
                                                      SearchTestsUtil.searchAll(
                                                        asGlobalAdminOnTenant,
                                                        'memberships-library',
                                                        [publicTenant1.loggedinUser.user.id],
                                                        null,
                                                        (error /* , results */) => {
                                                          assert.notExists(error);

                                                          // 3. Private user library

                                                          // Ensure anonymous cannot see it
                                                          SearchTestsUtil.searchAll(
                                                            publicTenant1.anonymousRestContext,
                                                            'memberships-library',
                                                            [publicTenant1.privateUser.user.id],
                                                            null,
                                                            (error /* , results */) => {
                                                              assert.ok(error);
                                                              assert.strictEqual(error.code, 401);

                                                              // Ensure user from another tenant cannot see it
                                                              SearchTestsUtil.searchAll(
                                                                publicTenant2.publicUser.restContext,
                                                                'memberships-library',
                                                                [publicTenant1.privateUser.user.id],
                                                                null,
                                                                (error /* , results */) => {
                                                                  assert.ok(error);
                                                                  assert.strictEqual(error.code, 401);

                                                                  // Ensure user from same tenant can see it
                                                                  SearchTestsUtil.searchAll(
                                                                    publicTenant1.publicUser.restContext,
                                                                    'memberships-library',
                                                                    [publicTenant1.privateUser.user.id],
                                                                    null,
                                                                    (error /* , results */) => {
                                                                      assert.ok(error);
                                                                      assert.strictEqual(error.code, 401);

                                                                      // Ensure user themself can see it
                                                                      SearchTestsUtil.searchAll(
                                                                        publicTenant1.privateUser.restContext,
                                                                        'memberships-library',
                                                                        [publicTenant1.privateUser.user.id],
                                                                        null,
                                                                        (error /* , results */) => {
                                                                          assert.notExists(error);

                                                                          // Ensure tenant admin can see it
                                                                          SearchTestsUtil.searchAll(
                                                                            publicTenant1.adminRestContext,
                                                                            'memberships-library',
                                                                            [publicTenant1.privateUser.user.id],
                                                                            null,
                                                                            (error /* , results */) => {
                                                                              assert.notExists(error);

                                                                              // Ensure global admin can see it
                                                                              SearchTestsUtil.searchAll(
                                                                                asGlobalAdminOnTenant,
                                                                                'memberships-library',
                                                                                [publicTenant1.privateUser.user.id],
                                                                                null,
                                                                                (error /* , results */) => {
                                                                                  assert.notExists(error);
                                                                                  return callback();
                                                                                }
                                                                              );
                                                                            }
                                                                          );
                                                                        }
                                                                      );
                                                                    }
                                                                  );
                                                                }
                                                              );
                                                            }
                                                          );
                                                        }
                                                      );
                                                    }
                                                  );
                                                }
                                              );
                                            }
                                          );
                                        }
                                      );
                                    }
                                  );
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
});
